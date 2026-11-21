// @ts-check
// A mode a coding agent's turn sets is the one its name renders, and a turn held to reading takes none in which its agent
// asks nobody (the second read of 11-12; the press of a mode however it is named is press-modes.test.js's). A chat on a
// plain name whose route renders `…@bypassPermissions` runs its agent in that mode as surely as one named so: a watcher's
// wake there is refused, as one named so is, and a thread or a team beside a chat on such a name is refused as one named
// with its mode is. A /plan's turn, and a team's that changes no file, set no such mode on their agent, whatever the name
// says: the switch that holds them hears every call. A sub-agent asks as its chat's turns run, as rendered. One rule reads
// the name for all of them (engine.js `agentTurnModel`), the one acp-turn.js renders the agent's model by. Through a real
// Filament, a fake provider and the fake coding agent, whose mode sets are recorded.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { routineFields } from "../src/core/routines.js";
import { agentModeOf, agentTurnModel } from "../src/app/engine.js";
import { normalizeConfig } from "../src/services/config/store.js";

/** The routes a name may take to the Claude-like agent: as named, a route that renders a mode, one that renders none. */
const ROUTES = [
  { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
  { match: "claudeish/*", upstream: "claudeish", upstreamModel: "{1}", enabled: true },
  { match: "quiet/*", upstream: "claudeish", upstreamModel: "{1}@bypassPermissions", enabled: true },
  { match: "fixed/*", upstream: "claudeish", upstreamModel: "default", enabled: true },
];

describe("the name a coding agent's turn sends, as its route renders it", () => {
  const cfg = normalizeConfig({
    upstreams: [
      { id: "m", name: "m", type: "anthropic", baseUrl: "https://api.example.invalid", apiKey: "s", enabled: true },
      { id: "claudeish", name: "claudeish", type: "acp", acp: { command: "claudeish" } },
    ],
    routes: [...ROUTES, { match: "vertex/*", upstream: "m", upstreamModel: "claude-sonnet@{1}", enabled: true }],
  });
  // (fails before: yes — there was no such rule: the service read a mode off the chat's name, acp-turn off what it rendered)
  test("its mode, the session it goes on with and the model, read off what the route renders; a provider's id with an @ sets no agent's mode", () => {
    assert.deepEqual(agentTurnModel(cfg, "quiet/default"), { upstream: "claudeish", model: "default", resume: null, mode: "bypassPermissions" });
    assert.deepEqual(agentTurnModel(cfg, "claudeish/default@plan"), { upstream: "claudeish", model: "default", resume: null, mode: "plan" });
    assert.deepEqual(agentTurnModel(cfg, "fixed/x@bypassPermissions"), { upstream: "claudeish", model: "default", resume: null, mode: null });
    assert.deepEqual(agentTurnModel(cfg, "claudeish/default#3716601d@bypassPermissions"), { upstream: "claudeish", model: "default", resume: "3716601d", mode: "bypassPermissions" });
    assert.equal(agentTurnModel(cfg, "nowhere/x"), null);
    assert.deepEqual(["quiet/default", "claudeish/default@bypassPermissions", "claudeish/default", "fixed/x@bypassPermissions", "vertex/20250514", "m-1"].map((n) => agentModeOf(cfg, n)), ["bypassPermissions", "bypassPermissions", null, null, null, null]);
  });
});

describe("a turn held to reading, and a mode set by a route, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-held-modes-"));
  const calls = join(root, "..", `${root.split(/[\\/]/).pop()}-calls.jsonl`);
  before(async () => {
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace", ...args], { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "hello agent\n");
    git("add", ".");
    git("commit", "-q", "-m", "First");
    up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("MODEL ANSWER", { model: String(call.body?.model || "") }) : undefined));
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
          { id: "claudeish", name: "claudeish", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_CALLS: calls, FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ROUTES;
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root, calls);
  });

  /** A chat in the repository on a model, its own switch at `mode`. @param {string} model @param {any} [settings] */
  const chat = async (model, settings = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { loop: { permissions: "auto" }, ...settings } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** The modes Filament set on the agent so far, in order. @returns {string[]} */
  const modesSet = () =>
    (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
      .filter((c) => c.method === "session/set_mode")
      .map((c) => c.modeId);
  /** A turn sent whole, and its record once written. @param {string} id @param {any} body */
  const turned = async (id, body) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, ...body } });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const rid = String(r.headers.get("x-filament-request-id"));
    return until(async () => {
      const x = await shim.record(rid);
      return x?.acp?.run ? x : null;
    }, "the record");
  };
  /** The record's notes. @param {any} rec @returns {string[]} */
  const notesOf = (rec) => [...(rec.priorChanges || []), ...(rec.changes || [])].map(String);
  const HELD = (/** @type {string} */ name) => `acp: mode bypassPermissions not taken from its model's name (${name}): the turn is held to reading, and in that mode its agent asks nobody`;

  // (fails before: yes — the service read the mode off the chat's name, which shows none: the wake went (200), and its
  // turn set the agent to bypassPermissions, in which it asks nobody)
  test("a watcher's wake of a chat on a plain name whose route sets a mode in which its agent asks nobody is refused, as one named so is: its failure in words, what it heard kept, no turn begun", async () => {
    const id = await chat("quiet/default");
    const project = String(shim.app.memory.archive?.getChain(id)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", wakes: "chat", trigger: { kind: "turn", chat: "c-none", turns: "all" } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const w = spaces.routinePropose(project, f.fields, { chain: id, byName: "Lead", model: "quiet/default", nameOf: () => "Lead" }).id;
    spaces.routineOn(project, w);
    const of = () => spaces.get(project).routines.find((/** @type {any} */ x) => x.id === w);
    assert.equal(spaces.watchHeard(project, w, [{ id: "turn:c-none:1", kind: "turn", at: Date.now(), chain: "c-none", summary: "Turn 1 of a chat ended: nothing changed" }]), 1);
    const from = modesSet().length;
    const r = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(w)}/run`, { method: "POST", body: {} });
    const ran = /** @type {any} */ ({ status: r.status, ...(await r.json()) });
    const WHY = "cannot be held to reading: its agent asks Filament nothing before it acts, in the mode its model's name sets (bypassPermissions)";
    assert.deepEqual([ran.status, String(ran.error).endsWith(WHY)], [502, true], JSON.stringify(ran));
    assert.deepEqual([of()?.last?.state, String(of()?.last?.why).endsWith(WHY)], ["failed", true], JSON.stringify(of()?.last));
    assert.equal(of()?.pending?.events.length, 1, "what it heard waits");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal((tr.turns || []).length, 0, "no turn began in that chat");
    assert.deepEqual(modesSet().slice(from), [], "its agent was set to no mode");
  });

  // (fails before: yes — the /plan's turn set the agent to bypassPermissions, by its name or by its route: its read-only
  // switch then heard of no call)
  test("a /plan's turn sets no mode in which its agent asks nobody, named or set by its route, and the record says so; the chat's next turn of the person's runs in it as before", async () => {
    for (const model of ["claudeish/default@bypassPermissions", "quiet/default"]) {
      const id = await chat(model);
      const from = modesSet().length;
      const rec = await turned(id, { content: "Plan the login flow.", plan: true });
      assert.ok(!modesSet().slice(from).includes("bypassPermissions"), `${model}: ${modesSet().slice(from).join(", ")}`);
      assert.ok(notesOf(rec).includes(HELD(model)), notesOf(rec).join("\n"));
      const then = modesSet().length;
      const next = await turned(id, { content: "Go on." });
      assert.ok(modesSet().slice(then).includes("bypassPermissions"), `${model}: the person's own turn runs in the mode its name sets`);
      assert.ok(!notesOf(next).some((n) => n.includes("not taken")), notesOf(next).join("\n"));
    }
    // A mode in which it plans is taken as named.
    const planned = await chat("claudeish/default@plan");
    const from = modesSet().length;
    const rec = await turned(planned, { content: "Plan it.", plan: true });
    assert.ok(modesSet().slice(from).includes("plan"), modesSet().slice(from).join(", "));
    assert.ok(!notesOf(rec).some((n) => n.includes("not taken")), notesOf(rec).join("\n"));
  });

  // (fails before: yes — BugHunters' lead, held to reading by its team, was set to bypassPermissions by its chat's name)
  test("a team that changes no file leads its turn with no mode in which its agent asks nobody, whatever its chat's name sets", async () => {
    const id = await chat("claudeish/default@bypassPermissions", { engine: { mode: "team", team: "bughunters" }, subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const from = modesSet().length;
    const rec = await turned(id, { content: "hello" });
    assert.ok(notesOf(rec).some((n) => n.startsWith("acp: claudeish leads team BugHunters")), notesOf(rec).join("\n"));
    assert.ok(!modesSet().slice(from).includes("bypassPermissions"), modesSet().slice(from).join(", "));
    assert.ok(notesOf(rec).includes(HELD("claudeish/default@bypassPermissions")), notesOf(rec).join("\n"));
  });

  // (fails before: yes — the sub-agent's rule read its chat's mode off the chat's name: a chat on `fixed/x@bypassPermissions`,
  // whose route renders no mode and whose own turns ask, let its sub-agent run in bypassPermissions)
  test("a sub-agent takes a mode in which its agent asks nobody only where its chat's own turns run in it, as rendered: a name that shows one its route drops is no such chat; a route that sets one is", async () => {
    /** A sub-agent launched in a chat, as its row launches one: its run's record. @param {string} id @param {string} model */
    const launched = async (id, model) => {
      const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
      const r = await shim.api(at, { method: "POST", body: { prompt: "hello", description: "a helper", model, deliver: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const sa = (await r.json()).subagent.id;
      const done = await until(async () => (await (await shim.api(at)).json()).subagents.find((/** @type {any} */ s) => s.id === sa && s.status !== "running") || null, "the sub-agent's end", { timeoutMs: 30_000 });
      assert.equal(done.status, "done", JSON.stringify(done));
      return until(async () => {
        const x = await shim.record(String(done.exchanges[0].runId));
        return x?.acp?.run ? x : null;
      }, "the record");
    };
    const shows = await chat("fixed/x@bypassPermissions", { loop: { permissions: "ask" } });
    let from = modesSet().length;
    const rec = await launched(shows, "claudeish/default@bypassPermissions");
    assert.deepEqual(modesSet().slice(from).filter((m) => m === "bypassPermissions"), [], "the agent was never set to ask nobody");
    assert.ok(notesOf(rec).some((n) => n.startsWith("acp: mode bypassPermissions not taken from its model's name (claudeish/default@bypassPermissions): a sub-agent's run asks as its chat does")), notesOf(rec).join("\n"));
    // A chat whose route sets the mode runs its turns in it: its sub-agent on the same name runs as it does.
    const routed = await chat("quiet/default", { loop: { permissions: "ask" } });
    from = modesSet().length;
    const same = await launched(routed, "quiet/default");
    assert.ok(modesSet().slice(from).includes("bypassPermissions"), modesSet().slice(from).join(", "));
    assert.ok(!notesOf(same).some((n) => n.includes("not taken")), notesOf(same).join("\n"));
  });

  // (fails before: yes — the team started (200): its lead's name shows no mode, and its route sets bypassPermissions)
  test("a team beside a chat on a lead's model whose route sets its coding agent's mode is refused in words; on its main chat's own model it starts", async () => {
    const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
    const fire = (/** @type {string} */ id, /** @type {any} */ body) => shim.api(`${S(id)}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt in the login code", ...body } });
    const teamsOf = async (/** @type {string} */ id) => (await (await shim.api(`${S(id)}/beside`)).json()).teams;
    const stopAll = async (/** @type {string} */ id) => {
      for (const t of await teamsOf(id)) await shim.api(`${S(id)}/beside/${encodeURIComponent(t.id)}/stop`, { method: "POST", body: {} });
    };
    const main = await chat("claudeish/default");
    const r = await fire(main, { model: "quiet/default" });
    const said = await r.json();
    await stopAll(main);
    assert.equal(r.status, 400, JSON.stringify(said));
    assert.equal(said.error, "quiet/default sets its coding agent's mode (bypassPermissions) by its route, and a team beside a chat asks as that chat does: pick another model for its lead");
    assert.deepEqual(await teamsOf(main), [], "no team's chat was made");
    // The main chat's own model, its route's mode and all, is the person's: its team's lead runs on the same.
    const own = await chat("quiet/default");
    const ok = await fire(own, {});
    const started = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(started));
    assert.equal(started.team.on.lead, "quiet/default");
    await stopAll(own);
  });
});
