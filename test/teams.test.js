// @ts-check
// HarnessV3-AtHome P2 step 2: teams as data, end to end. A session's engine is the model, the agent loop or a team
// (engine.mode, engine.team); the engine's answers learn teams; `/team` lists them, hands a session to one and gives
// it back, from any chat; /api/teams lists, saves, duplicates, edits and deletes them; the settings answer lists them
// and says whether the chosen one can run. The pure half runs the owners; the live half runs the app against a
// scripted provider, as an outside client's chat and as the harness.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { engineFor, engineProblem } from "../src/app/engine.js";
import { draftEngine, startAnatomy } from "../src/app/sessions/draft-start.js";
import { defaultConfig } from "../src/config.js";
import { parseTeamCommand } from "../src/app/commands/parse.js";
import { chatCommandOf } from "../src/app/commands/recognize.js";
import { commandCatalog } from "../src/app/commands/registry.js";
import { ENGINE_MODES, KNOBS, sessionEngineOf } from "../src/services/session-settings.js";
import { settingChangeWords } from "../src/ui/harness/lib/labels.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { teamStore } from "./helpers/team.js";

/** A team of yours as a save names it: Product in charge of a builder. */
const OWN = { lead: "product", members: [{ tag: "builder" }] };
/** Teams on, as Settings › Experimental's switch puts them (core/teams-on.js): off, no team leads a chat. */
const on = { experimental: { teams: true } };
/** A configuration from before the loop lost its switch (the owner's of 11-09): its off is no word now. */
const off = { ...on, agentLoop: { enabled: false } };
/** The four members every shipped team has, as the settings answer names them: Reviewer seated as the Scout, Builder, Builder seated as the Tester, Reviewer. */
const FOUR = [
  { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", card: "builder", name: "Tester", may: "edit", place: "builder" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
/** Product's good-for: what a team it leads says of how it works. */
const PRODUCT_LINE = "Is it worth building, its smallest version, and where it lives on the page";

// ---------------------------------------------------------------------------------------------------
// The owners, pure
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the engine was the model or the agent loop; teams did not exist)
describe("a team as the session's engine", () => {
  // (and the owner's rule of 10-31: the `agent` mode, which sent an outside client's turns to the loop, is gone, and the
  // engine is the harness's alone)
  test("the knobs: engine.mode is model or team; engine.team names the team — both the session's mode, obeyed where Filament runs the session", () => {
    assert.deepEqual(ENGINE_MODES, ["model", "team"]);
    assert.deepEqual(KNOBS["engine.mode"].options, ["model", "team"]);
    assert.equal(KNOBS["engine.mode"].reach, "filament");
    const k = KNOBS["engine.team"];
    assert.deepEqual([k.type, k.default, k.nullable, k.scope, k.reach], ["string", null, true, "mode", "filament"]);
    assert.equal(sessionEngineOf({ engine: { mode: "agent" } }).mode, "model", "an old saved `agent` falls back to the default");
    assert.deepEqual(sessionEngineOf({ engine: { mode: "team", team: " builders " } }), { mode: "team", team: "builders", agentOff: false });
    assert.deepEqual(sessionEngineOf({ engine: { mode: "crew", team: 7 } }), { mode: "model", team: null, agentOff: false });
    assert.deepEqual(sessionEngineOf(null), { mode: "model", team: null, agentOff: false });
    // (fails before: yes — the plan's p6 kept engine.teamStyle beside engine.team; the owner's of 11-04: Builders' lead
    // leads one way) No knob for how a lead leads, and one a session kept is read as nothing.
    assert.equal(KNOBS["engine.teamStyle"], undefined);
    assert.deepEqual(sessionEngineOf({ engine: { mode: "team", team: "builders", teamStyle: "10x" } }), { mode: "team", team: "builders", agentOff: false });
  });

  // (fails before: yes — a team's orders could wait for the developer's approval, under engine.teamMode validate)
  test("a team's orders run at once: no setting holds them, and a team mode an older Filament saved is read as nothing", () => {
    assert.equal(KNOBS["engine.teamMode"], undefined);
    assert.deepEqual(sessionEngineOf({ engine: { mode: "team", team: "builders", teamMode: "validate" } }), { mode: "team", team: "builders", agentOff: false });
  });

  test("engineProblem: a team leads only on the agent loop, and only a team that exists", () => {
    const teams = teamStore();
    assert.equal(engineProblem({ mode: "team", team: "builders" }, on, teams), null);
    assert.equal(engineProblem({ mode: "team", team: "Builders" }, on, teams), null, "a team's name finds it too");
    // (fails before: yes — a stored off said the loop was off; it has no switch now, the owner's of 11-09)
    assert.equal(engineProblem({ mode: "team", team: "builders" }, off, teams), null, "the loop is always on");
    assert.equal(engineProblem({ mode: "team", team: "builders", agentOff: true }, on, teams), "engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it");
    assert.equal(engineProblem({ mode: "team", team: null }, on, teams), "engine.mode is team but engine.team names no team (/team lists them)");
    assert.equal(engineProblem({ mode: "team", team: "nobody" }, on, teams), "engine.team names `nobody`, which is no team (/team lists them)");
    assert.equal(engineProblem({ mode: "model", team: "nobody" }, on, teams), null, "a team named but not chosen is no problem");
  });

  test("engineFor: a team's lead takes the session's turns on the model the turn names — the harness's, an explicit agent/ name — with the record's words", () => {
    const teams = teamStore();
    const arch = { mode: "team", team: "builders" };
    const note = (/** @type {string} */ m) => `engine: team Builders answers this session's turns (engine.team), its lead on ${m}`;
    assert.deepEqual(engineFor(arch, on, { model: "m-1", agent: null }, teams), { agent: { model: "m-1", team: "builders" }, note: note("m-1") });
    assert.deepEqual(engineFor(arch, on, { model: "m-1", agent: { model: "m-1" } }, teams), { agent: { model: "m-1", team: "builders" }, note: note("m-1") }, "the harness: its loop runs as the lead");
    assert.deepEqual(engineFor(arch, on, { model: "agent/m-2", agent: { model: "m-2" } }, teams), { agent: { model: "m-2", team: "builders" }, note: note("m-2") });
    assert.deepEqual(engineFor({ mode: "team", team: "BugHunters" }, on, { model: "m-1", agent: null }, teams).agent, { model: "m-1", team: "bughunters" }, "the key, whatever name found it");
    assert.deepEqual(engineFor({ mode: "team", team: "nobody" }, on, { model: "m-1", agent: null }, teams), {
      note: "engine: engine.team names `nobody`, which is no team (/team lists them) — the request went to m-1 as named",
    });
    assert.deepEqual(engineFor({ ...arch, agentOff: true }, on, { model: "m-1", agent: null }, teams), {
      note: "engine: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — the request went to m-1 as named",
    });
  });

  test("the New Task board's engine: a team when the draft's document chooses one that can lead; the loop when it cannot", () => {
    const teams = teamStore();
    const cfg = {
      ...on,
      agentLoop: { enabled: true },
      upstreams: [{ id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true }],
      routes: [{ match: "brain-*", upstream: "u", upstreamModel: "{model}", enabled: true }],
    };
    const arch = { mode: "team", team: "builders" };
    assert.deepEqual(draftEngine(cfg, "brain-model", arch, teams), { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } });
    assert.deepEqual(draftEngine(cfg, "agent/brain-model", arch, teams), { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } });
    assert.deepEqual(draftEngine(cfg, "brain-model", { mode: "team", team: "nobody" }, teams), { kind: "loop", model: "brain-model" });
    assert.deepEqual(draftEngine(cfg, "brain-model", { mode: "model", team: null }, teams), { kind: "loop", model: "brain-model" });
    // (fails before: yes — a stored off ran the model as plain chat; the loop is always on now, the owner's of 11-09)
    assert.deepEqual(draftEngine({ ...cfg, agentLoop: { enabled: false } }, "brain-model", arch, teams), { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } });
    // (fails before: no — a guard the mutation pass asked for: no draft named a coding agent's route, or weighed a team)
    const withAgent = {
      ...cfg,
      upstreams: [...cfg.upstreams, { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true }],
      routes: [...cfg.routes, { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }],
    };
    // (fails before: yes — HarnessV4_Tasks B12: the draft of a session a coding agent leads named no team, and weighed
    // nothing of Filament's side of its first request)
    assert.deepEqual(draftEngine(withAgent, "coder-one", arch, teams), { kind: "agent", model: "coder-one", team: { key: "builders", name: "Builders" } }, "a coding agent leads as itself: its route stays its own, with the team it leads");
    assert.deepEqual(draftEngine(withAgent, "coder-one", { mode: "team", team: "nobody" }, teams), { kind: "agent", model: "coder-one" });
    assert.deepEqual(draftEngine(withAgent, "coder-one", null, teams), { kind: "agent", model: "coder-one" });
    const agentCfg = { ...defaultConfig(), ...withAgent, agentLoop: { ...defaultConfig().agentLoop, enabled: true, readerModel: "" } };
    const leads = startAnatomy({ cfg: agentCfg, eff: { model: { name: "coder-one" }, engine: arch }, cwd: tmpdir(), projectId: "p1", teams });
    const alone = startAnatomy({ cfg: agentCfg, eff: { model: { name: "coder-one" } }, cwd: tmpdir(), projectId: "p1", teams });
    const part = (/** @type {any} */ a, /** @type {string} */ id) => a.parts.find((/** @type {any} */ p) => p.id === id).tokens;
    assert.deepEqual([part(alone, "prompt"), alone.tools.offered, alone.loopFixed], [0, [], 0], "an agent alone: Filament adds no prompt and no tools of its own");
    assert.ok(part(leads, "prompt") > 100, `the lead's part is weighed (${part(leads, "prompt")})`);
    assert.deepEqual([leads.tools.offered, leads.tools.mcp, leads.loopFixed], [["agent", "worker", "wait", "envelope", "tasks"], [], 0], "its team's tools and its task graph's, and no loop's furniture");
    assert.ok(part(leads, "tools") > part(alone, "tools"));
    const graphed = startAnatomy({ cfg: agentCfg, eff: { model: { name: "coder-one" }, engine: arch, tasks: { graph: true } }, cwd: tmpdir(), projectId: "p1", teams });
    assert.ok(graphed.tools.offered.length >= 3);
    const full = { ...defaultConfig(), ...cfg, agentLoop: { ...defaultConfig().agentLoop, enabled: true, readerModel: "" } };
    const led = startAnatomy({ cfg: full, eff: { model: { name: "brain-model" }, engine: arch }, cwd: tmpdir(), projectId: "p1", teams });
    const solo = startAnatomy({ cfg: full, eff: { model: { name: "brain-model" } }, cwd: tmpdir(), projectId: "p1", teams });
    assert.deepEqual(led.engine, { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } });
    assert.ok(led.loopFixed > 0 && led.loopFixed !== solo.loopFixed, "a team's lead is the loop with a lead's prompt and tools (team-lead.test.js weighs them)");
  });

  test("/team is a chat command of its own; the catalogue lists it, and the memory prefix carries it no more", () => {
    assert.deepEqual(parseTeamCommand("/team"), { arg: "" });
    assert.deepEqual(parseTeamCommand("  /team 10x Engineer \nmore words"), { arg: "10x Engineer" });
    assert.deepEqual(parseTeamCommand("/teams"), { arg: "" });
    assert.equal(parseTeamCommand("/teamwork"), null);
    assert.equal(parseTeamCommand("tell the /team"), null);
    const memory = /** @type {any} */ ({ viewConfig: () => ({ command: "/view" }) });
    assert.deepEqual(chatCommandOf("/team architect", { memory, situated: false }), { kind: "team", cmd: { arg: "architect" } });
    const group = commandCatalog(on).groups.find((g) => g.id === "team");
    assert.ok(group, "a group of its own");
    assert.deepEqual(group.commands.map((c) => c.command), ["/team", "/team <name>", "/team off"]);
    assert.match(commandCatalog(on).groups.find((g) => g.id === "memory")?.intro || "", /Answered by Filament, the upstream not called, in every chat — an outside client's included, memory on or off/);
    assert.doesNotMatch(commandCatalog(on).groups.find((g) => g.id === "memory")?.intro || "", /swallow/, "the memory prefix carries no settings commands");
  });

  test("the change card's words for the engine and the team", () => {
    assert.equal(settingChangeWords("engine.mode", "team"), "Engine: a team");
    assert.equal(settingChangeWords("engine.mode", "model"), "Engine: the model");
    assert.equal(settingChangeWords("engine.team", "architect"), "Team: architect");
    assert.equal(settingChangeWords("engine.team", undefined), "Team: none");
  });
});

// ---------------------------------------------------------------------------------------------------
// The live app
// ---------------------------------------------------------------------------------------------------

describe("teams on the live app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @param {any} content */
  const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
  /** The harness sessions by the names the tests give them, each made at its first turn. @type {Map<string, string>} */
  const sessions = new Map();
  /**
   * A turn of the harness chat `sid` names — a team answers a harness session's turns alone (the owner's rule of 10-31:
   * an outside client's go to the model it names).
   * @param {string} sid @param {string} content
   */
  const say = async (sid, content) => {
    let id = sessions.get(sid);
    if (!id) {
      id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
      sessions.set(sid, id);
    }
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const json = await r.json();
    return { status: r.status, json, text: textOf(json?.content), id: String(r.headers.get("x-filament-request-id")) };
  };
  /** @param {string} sid */
  const chainOf = (sid) => String(sessions.get(sid));
  /** @param {string} chainId */
  const settingsOf = async (chainId) => (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`)).json();
  /** @param {string} id */
  const recordOf = async (id) => (await shim.api(`/api/requests/${encodeURIComponent(id)}`)).json();
  /** The dashboard's agent-loop switch, and the global sub-agent model. @param {any} loop */
  const setLoop = async (loop) => {
    const st = await (await shim.api("/api/state")).json();
    const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, agentLoop: { ...st.config.agentLoop, ...loop } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The chat's agent tool, which a team's lead launches its workers with: off, no team can lead (engineProblem).
   *  @param {string} sid @param {boolean} on */
  const agentTool = async (sid, on) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainOf(sid))}/settings`, { method: "PATCH", body: on ? { unset: ["loop.tools"] } : { patch: { loop: { tools: { agent: false } } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body) => {
    const r = await shim.api(`/api${path}`, { method, ...(body === undefined ? {} : { body }) });
    return { status: r.status, json: await r.json() };
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-teams-live-"));
    up = await fakeUpstream(async (call) => anthropicReply("MODEL ANSWER", { model: String(call.body?.model || "") }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        // The log keeps every record's line: a command's record must name its session there.
        cfg.observability.logFile = "requests.jsonl";
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });

  // (fails before: yes — /api/teams did not exist)
  test("/api/teams: the shipped teams and yours, each with its lead and members; a save, a Duplicate, an edit and a delete, each in the op log", async () => {
    const first = await call("GET", "/teams");
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.shipped.map((/** @type {any} */ t) => t.key), ["builders", "bughunters"]);
    // (fails before: yes — a team had no line, HarnessV3-Views VW-D10)
    assert.equal(first.json.shipped[0].line, "Builds it with its workers: planned, run in parallel where it can, each claim checked");
    // (fails before: yes — HarnessV4_Tasks E15 step 6: a team was a persona and four fixed roles, no card)
    assert.deepEqual([first.json.shipped[0].lead, first.json.shipped[0].members.map((/** @type {any} */ m) => [m.tag, m.name, m.may])], [{ tag: "buildlead", name: "Builders" }, [["scout", "Scout", "read"], ["builder", "Builder", "edit"], ["tester", "Tester", "edit"], ["reviewer", "Reviewer", "read"]]]);
    // (fails before: yes — E15 step 8: the read named one model, `workerModel`)
    // (the owner's word of 11-05: a list for agents is a chat's own alone, so none is read here)
    assert.deepEqual([first.json.saved, Object.hasOwn(first.json, "pool"), Object.hasOwn(first.json, "workerModel"), Object.hasOwn(first.json, "roles")], [[], false, false, false]);
    // (fails before: yes — the page could not count a line against the limit a save checks, HarnessV3-Views V5-3; the
    // plan's p6: nor a team's check)
    // (the owner's word of 11-05: no most, nor a total for one run)
    assert.deepEqual(first.json.limits, { name: 40, line: 2000, members: 12, models: 6, check: 400 });
    // (fails before: yes — the plan's p6 listed the ways Builders' lead could lead beside the teams; the owner's of 11-04:
    // it leads one way) The answer lists the teams alone.
    assert.deepEqual([Object.hasOwn(first.json, "styles"), first.json.shipped.some((/** @type {any} */ t) => Object.hasOwn(t, "style"))], [false, false]);

    // (fails before: yes — HarnessV4_Tasks C9: a team's save is no config change, so the feed said nothing, and a page
    // showing a session kept the teams it had read) Each write is said on the feed.
    /** @type {any[]} */
    const heard = [];
    const unhear = /** @type {any} */ (shim.app).events.subscribe("config", (/** @type {any} */ p) => p?.type === "teams-changed" && heard.push(p.key));
    const made = await call("POST", "/teams", { name: "Careful", lead: "product", members: [{ tag: "builder", name: "Tester", line: "Run everything twice." }] });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.deepEqual([made.json.ok, made.json.team.key, made.json.saved.map((/** @type {any} */ t) => t.key)], [true, "careful", ["careful"]]);
    const dup = await call("POST", "/teams", { from: "builders" });
    assert.deepEqual([dup.status, dup.json.team.name, dup.json.team.from], [200, "Builders copy", "builders"]);
    const edited = await call("PUT", "/teams/careful", { lead: "enduser" });
    assert.deepEqual([edited.status, edited.json.team.lead, edited.json.team.members.map((/** @type {any} */ m) => [m.tag, m.line])], [200, { tag: "enduser", name: "End user" }, [["tester", "Run everything twice."]]]);
    const gone = await call("DELETE", "/teams/builders-copy");
    assert.deepEqual([gone.status, gone.json.removed, gone.json.saved.map((/** @type {any} */ t) => t.key)], [200, "builders-copy", ["careful"]]);
    unhear();
    assert.deepEqual(heard, ["careful", "builders-copy", "careful", "builders-copy"], "a save, a Duplicate, an edit and a delete");

    const ops = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
    for (const title of ["team `careful` created", "team `builders-copy` created (a Duplicate of `builders`)", "team `careful` edited", "team `builders-copy` deleted"])
      assert.ok(ops.includes(title), `${title}\n${ops.join("\n")}`);
  });

  // (fails before: yes — /api/teams did not exist)
  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA3: a shipped team's lead was a 403)
  test("/api/teams: a shipped team's lead set in place and put back, said in the op log; it refuses in words a shipped team's delete, a team nobody made, a body that is no team", async () => {
    const shippedEdit = await call("PUT", "/teams/builders", { lead: "product" });
    assert.deepEqual([shippedEdit.status, shippedEdit.json.team.lead.tag, shippedEdit.json.team.set], [200, "product", ["lead"]]);
    const putBack = await call("PUT", "/teams/builders", { lead: null });
    assert.deepEqual([putBack.status, putBack.json.team.lead.tag, putBack.json.team.tuned], [200, "buildlead", false]);
    const titles = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
    assert.ok(titles.includes("shipped team `builders` edited: lead put back as it ships"), titles.join("\n"));
    // (fails before: yes — the plan's p6: a team named no check) Builders' check set and cleared; a check that installs
    // refused in words.
    const checked = await call("PUT", "/teams/builders", { check: "npm test" });
    assert.deepEqual([checked.status, checked.json.team.check, checked.json.team.set], [200, "npm test", ["check"]]);
    const checkedBack = await call("PUT", "/teams/builders", { check: null });
    assert.deepEqual([checkedBack.status, checkedBack.json.team.check, checkedBack.json.team.tuned], [200, null, false]);
    const installs = await call("PUT", "/teams/builders", { check: "npm install left-pad" });
    assert.equal(installs.status, 400);
    assert.match(installs.json.error, /^The team's check cannot be kept: check's `npm install left-pad` installs packages/);
    // How a team that ships runs is yours: set, listed as set, and given back.
    const tuned = await call("PUT", "/teams/bughunters", { models: ["GLM 5.3 Flash"], leadModel: "Claude Opus 5.5" });
    assert.deepEqual([tuned.status, tuned.json.team.models, tuned.json.team.leadModel, tuned.json.team.tuned], [200, ["GLM 5.3 Flash"], "Claude Opus 5.5", true]);
    const hunt = (await call("GET", "/teams")).json.shipped.find((/** @type {any} */ t) => t.key === "bughunters");
    assert.deepEqual([hunt.models, hunt.leadModel], [["GLM 5.3 Flash"], "Claude Opus 5.5"]);
    const back = await call("PUT", "/teams/bughunters", { models: [], leadModel: null });
    assert.deepEqual([back.status, back.json.team.tuned], [200, false]);
    const shippedDelete = await call("DELETE", "/teams/builders");
    assert.deepEqual([shippedDelete.status, shippedDelete.json.error], [403, "`builders` is a shipped team: it cannot be deleted."]);
    assert.deepEqual([(await call("DELETE", "/teams/nobody")).status, (await call("PUT", "/teams/nobody", { lead: "product" })).status], [404, 404]);
    const noName = await call("POST", "/teams", OWN);
    assert.equal(noName.status, 400);
    assert.match(noName.json.error, /^A team needs a name/);
    // Any card may lead a team or sit in its crew (U13-D1): a doer at its head, an advisor in its crew.
    const upside = await call("POST", "/teams", { name: "Upside Down", lead: "builder", members: [{ tag: "product" }] });
    assert.deepEqual([upside.status, upside.json.team?.lead?.tag ?? upside.json.team?.lead, upside.json.team?.members?.map((/** @type {any} */ m) => m.tag)], [200, "builder", ["product"]]);
    const list = await call("POST", "/teams", [1, 2]);
    assert.deepEqual([list.status, list.json.error], [400, "a JSON object is required: { name, lead, members: [{ tag, name?, line?, model?, effort? }] }, or { from, name? } to Duplicate a team"]);
    const r = await fetch(`${shim.url}/api/teams`, { method: "POST", headers: { ...shim.headers, "content-type": "text/plain", origin: shim.url }, body: JSON.stringify({ name: "Sneaky", ...OWN }) });
    assert.equal(r.status, 415, "a browser's form post is no admin write");
    assert.equal((await call("GET", "/teams")).json.saved.some((/** @type {any} */ t) => t.key === "sneaky"), false);
  });

  // (fails before: yes — the owner's word of 11-05: `PUT /api/subagents/pool` set a list every chat started from; a list
  // for agents is a chat's own alone, its own model where it names none)
  test("no route writes a list every chat starts from, nor a chat's number, nor a crews' list", async () => {
    const pool = await call("PUT", "/subagents/pool", { pool: [{ model: "m-cheap" }] });
    assert.equal(pool.status, 404, JSON.stringify(pool.json));
    assert.equal((await call("PUT", "/subagents/most", { most: null })).status, 404, "no route writes a chat's number");
    // (fails before: yes — U13-D14 of 10-20: a team's workers had a list of their own, set apart; it is gone)
    assert.equal((await shim.api("/api/subagents/workers", { method: "PUT", body: { workers: null } })).status, 404, "no route writes a crews' list");
    assert.ok(!("workers" in (await call("GET", "/teams")).json), "and none is read");
  });

  // (fails before: yes — /team did not exist, and a chat's turns could only go to the model or the agent loop; the
  // owner's rule of 10-31: a team answers a harness session's turns alone)
  test("/team in a harness chat: the list, a team that takes the session's turns from the next message, and off", async () => {
    const sid = "teams-zc";
    assert.equal((await say(sid, "warm up")).text, "MODEL ANSWER");
    const list = await say(sid, "/team");
    assert.match(list.text, /^\*\*Teams\*\* — this chat's turns go to your agent\.$/m);
    // (fails before: yes — HarnessV4_Tasks E15 step 6, case 34: the list named no lead and no member)
    assert.match(list.text, /^- `builders` \*\*Builders\*\* \(shipped\) — Builds it with its workers: planned, run in parallel where it can, each claim checked\. Builders leads Scout, Builder, Tester, Reviewer\.$/m);
    assert.match(list.text, /^- `bughunters` \*\*BugHunters\*\* \(shipped\) — Finds bugs and checks claims, fixing nothing: each finding checked against the code\. BugHunters leads Hunter, Checker\.$/m);
    assert.match(list.text, /^A team is a lead on this chat's model — it plans, briefs and checks — and the workers it hands the work to\. Its workers run on this chat's own model \(this chat lists none, subagents\.pool\), each on the first with room, unless the team, the lead or a worker's card names a model\.$/m);

    const use = await say(sid, "/team Builders");
    assert.match(use.text, /^Team \*\*Builders\*\* answers this chat's turns from the next message on: its lead runs on the chat's model, its workers on this chat's own model\.$/m);
    assert.match(use.text, /The next request starts a fresh prompt cache, once\./);
    // (fails before: yes — the page draws the answer's card in the text's place, and the card said "2 settings changed"
    // over its rows: nothing of what changed for the person) Its card leads with it, in the band's words; the rows stay.
    const useCard = (await recordOf(use.id)).card;
    assert.equal(useCard.lead, "Builders is in charge of this chat: its lead takes your agent's place and answers from your next message. Back to your agent, on the band at the chat's top, hands the chat back.");
    assert.deepEqual(useCard.changes.map((/** @type {any} */ c) => [c.path, c.to]), [["engine.mode", "team"], ["engine.team", "builders"]]);
    const chainId = chainOf(sid);
    const doc = await settingsOf(chainId);
    assert.deepEqual([doc.effective.engine.mode, doc.effective.engine.team], ["team", "builders"]);
    assert.match((await say(sid, "/team builders")).text, /^Team \*\*Builders\*\* already answers this chat's turns; nothing was written\.$/);
    assert.match((await say(sid, "/team")).text, /^- `builders` \*\*Builders\*\* \(shipped\) \*\*· leads this chat\*\* — /m);
    assert.match((await say(sid, "/team")).text, /^\*\*Teams\*\* — this chat's turns go to team \*\*Builders\*\*\.$/m);
    // (fails before: yes — /team named a mode that held the lead's orders, and validate and autonomous were its words)
    assert.doesNotMatch((await say(sid, "/team")).text, /^Orders:/m);
    // (fails before: yes — an unknown name was answered "`/team` lists them", naming none) It names the teams there are.
    const teamsNow = (await call("GET", "/teams")).json;
    const THERE_ARE = `The teams: ${[...teamsNow.shipped, ...teamsNow.saved].map((/** @type {any} */ t) => `\`${t.key}\` (${t.name})`).join(", ")}; \`/team\` says what each does.`;
    assert.match(THERE_ARE, /^The teams: `builders` \(Builders\), `bughunters` \(BugHunters\)/, "the two that ship, then yours");
    for (const word of ["validate", "autonomous"]) {
      assert.equal((await say(sid, `/team ${word}`)).text, `There is no team called \`${word}\`. ${THERE_ARE}`);
      assert.equal((await settingsOf(chainId)).effective.engine.team, "builders", `${word} wrote nothing`);
    }
    assert.equal("teamMode" in (await settingsOf(chainId)).effective.engine, false);

    const turn = await say(sid, "plan the work");
    assert.equal(turn.status, 200);
    const rec = await recordOf(turn.id);
    assert.equal(rec.upstream, "agent-loop", "the team's lead is the agent loop");
    assert.equal(rec.agent?.model, "m-1");
    assert.ok(rec.changes.includes("engine: team Builders answers this session's turns (engine.team), its lead on m-1"), rec.changes.join("\n"));

    assert.equal((await say(sid, "/team nobody")).text, `There is no team called \`nobody\`. ${THERE_ARE}`);
    const back = await say(sid, "/team off");
    assert.match(back.text, /^This chat's turns go to your agent again, from the next message on \(unset: engine\.mode, engine\.team\)\.$/m);
    assert.equal((await recordOf(back.id)).card.lead, "Your agent has this chat again: it answers from your next message, and the whole conversation stays.");
    assert.match((await say(sid, "/team off")).text, /^No team answers this chat: its turns already go to your agent\.$/);
    // (fails before: yes — a team that changes no file took the chat in Builders' words, with nothing of its lead and
    // its workers only reading there)
    const hunt = await say(sid, "/team bughunters");
    assert.equal((await recordOf(hunt.id)).card.lead, "BugHunters is in charge of this chat: its lead takes your agent's place and answers from your next message. It changes no file: its lead and its workers only read here, whatever this chat's permission mode says. Back to your agent, on the band at the chat's top, hands the chat back.");
    await say(sid, "/team off");
    const after = await recordOf((await say(sid, "and now")).id);
    assert.deepEqual([after.upstream, after.agent?.team ?? null], ["agent-loop", null], "the agent answers again, no team leading");
  });

  // (fails before: yes — the engine stage read the session's document off memory's situation alone: in a harness chat
  // memory leaves out, the team /team set never led a turn, though the command said it answers from the next message on)
  test("in a harness chat memory leaves out, the team /team sets leads its turns", async () => {
    const st = await (await shim.api("/api/state")).json();
    const memory = { ...st.config.memory, capture: { ...st.config.memory.capture, excludeModels: ["m-out"] } };
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory } })).status, 200);
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-out", preset: "plain" } })).json()).id);
      /** @param {string} content */
      const turn = async (content) => {
        const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
        assert.equal(r.status, 200, await r.clone().text());
        return { text: textOf((await r.json())?.content), id: String(r.headers.get("x-filament-request-id")) };
      };
      assert.match((await turn("/team Builders")).text, /^Team \*\*Builders\*\* answers this chat's turns from the next message on/m);
      const rec = await recordOf((await turn("plan the work")).id);
      assert.equal(rec.upstream, "agent-loop", "the team's lead is the agent loop");
      assert.equal(rec.agent?.team?.key, "builders", "the loop ran as the team's lead");
      assert.ok(rec.changes.includes("engine: team Builders answers this session's turns (engine.team), its lead on m-out"), rec.changes.join("\n"));
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — /team in a harness chat memory leaves out, on a coding agent, added "It cannot lead yet:
  // "coder-out" goes to the coding agent upstream "cli", which leads a team only in a chat memory works in, …", as such an
  // agent led no team there until its turn rode the chat's session)
  test("in a harness chat memory leaves out on a coding agent, /team says its team answers from the next message on, as in any chat", async () => {
    const st = await (await shim.api("/api/state")).json();
    const memory = { ...st.config.memory, capture: { ...st.config.memory.capture, excludeModels: ["coder-out"] } };
    const upstreams = [...st.config.upstreams, { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true }];
    const routes = [...st.config.routes, { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory, upstreams, routes } })).status, 200);
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder-out", preset: "plain" } })).json()).id);
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/team Builders", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const said = textOf((await r.json())?.content);
      assert.match(said, /^Team \*\*Builders\*\* answers this chat's turns from the next message on/m);
      assert.doesNotMatch(said, /cannot lead/);
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — for a harness chat Memory settings leave out, on a coding agent with a team, the page's engine
  // said no team leads, `active` false and its `problem` "…which leads a team only in a chat memory works in…", and the
  // board named no team, as its turns then ran alone; they are led now, and the page and the board say so, as where
  // memory works in the chat)
  test("in a harness chat Memory settings leave out on a coding agent, the page's engine and the New Task board say what its turns do: its team leads, as where memory works in the chat", async () => {
    const st = await (await shim.api("/api/state")).json();
    const upstreams = [...st.config.upstreams, { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true }];
    const routes = [...st.config.routes, { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
    /** Memory's capture lists as given. @param {any} capture */
    const capture = async (capture) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: { ...st.config.memory, capture: { ...st.config.memory.capture, ...capture } }, upstreams, routes } })).status, 200);
    const { engineStamp, crewOf } = await import("../src/ui/harness/lib/team.js");
    try {
      await capture({});
      const made = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder-out", preset: "plain", settings: { engine: { mode: "team", team: "builders" } } } })).json();
      const id = String(made.id);
      const engine = async () => (await settingsOf(id)).engine;
      const draft = async () => {
        const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "coder-out", settings: { engine: { mode: "team", team: "builders" } } } });
        assert.equal(r.status, 200, await r.clone().text());
        return r.json();
      };
      const leads = await engine();
      assert.deepEqual([leads.active, leads.problem, engineStamp(leads)?.team, crewOf(leads)], [true, null, "builders", "team"], "where memory works in the chat, the coding agent leads its team");
      assert.deepEqual([(await draft()).engine.team?.key, (await draft()).who.off], ["builders", null]);
      /** @type {[any, string][]} */
      const exclusions = [
        [{ excludeModels: ["coder-out"] }, 'model "coder-out" is excluded in Memory settings'],
        [{ excludeClients: ["harness"] }, 'client "harness" is excluded in Memory settings'],
        [{ excludeFolders: [String(made.cwd)] }, "the working folder is excluded in Memory settings"],
      ];
      for (const [lists, why] of exclusions) {
        await capture(lists);
        const e = await engine();
        assert.deepEqual([e.mode, e.team, e.active, e.problem, e.leftOut], ["team", "builders", true, null, why], why);
        // The page reads them: its stamp names the team, and the team plans the graph.
        assert.deepEqual([engineStamp(e)?.team, crewOf(e)], ["builders", "team"], why);
        // The server's own words in the chat, through the pipeline, say the same.
        const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/team", stream: false } });
        assert.equal(r.status, 200, await r.clone().text());
        assert.ok(textOf((await r.json())?.content).startsWith("**Teams** — this chat's turns go to team **Builders**."), why);
        const d = await draft();
        assert.deepEqual([d.engine.kind, d.engine.team?.key, d.who.off, d.memory.out], ["agent", "builders", null, why], `the board: ${why}`);
      }
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the owner's decision of 11-01, exclusion follows the chat: a team's chat beside a chat Memory
  // settings leave out was judged on its own model and folder alone — memory took its turns, the main chat's record
  // its first carries among them. Its coding agent leads there now, as the page says: before, `active` false and the
  // problem "…which leads a team only in a chat memory works in…")
  test("a team's chat beside a chat Memory settings leave out is left out with it: memory stays out of its turns, and its coding agent leads its team, the page naming why memory leaves the chat out", async () => {
    const st = await (await shim.api("/api/state")).json();
    const upstreams = [...st.config.upstreams, { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true }];
    const routes = [...st.config.routes, { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
    /** Memory's capture lists as given. @param {any} capture */
    const capture = async (capture) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: { ...st.config.memory, capture: { ...st.config.memory.capture, ...capture } }, upstreams, routes } })).status, 200);
    try {
      await capture({});
      const main = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-out", preset: "plain" } })).json()).id);
      const team = shim.app.sessions.create({ cwd: root, model: "coder-lead", kind: "team", beside: main, settings: { engine: { mode: "team", team: "builders" } }, preset: null });
      const engine = async () => (await settingsOf(team.id)).engine;
      /** Why memory leaves the team chat's turn out, as the pipeline's situate reads it. */
      const turnOut = () => shim.app.memory.excludedWhy({ format: "anthropic", body: { model: "coder-lead", messages: [{ role: "user", content: "the ask" }] }, headers: { "x-filament-client": "harness", "x-filament-chain": team.id }, model: "coder-lead", cwdHint: root });
      const leads = await engine();
      assert.deepEqual([leads.active, leads.problem, turnOut()], [true, null, null], "beside a chat memory works in, its coding agent leads its team");
      await capture({ excludeModels: ["m-out"] });
      const why = 'model "m-out" is excluded in Memory settings';
      assert.equal(turnOut(), why, "its turn: memory stays out, for the main chat's reason");
      const e = await engine();
      assert.deepEqual([e.active, e.problem, e.leftOut], [true, null, why]);
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the owner's rules of 10-31: the memory prefix carried `team` and the settings commands, for
  // clients that swallow `/`, which a plain proxy with memory gives none of them)
  test("/team help says each form; @mem team is no alias: memory's prefix answers with its own help, and no team takes the session", async () => {
    const sid = "teams-mem";
    await say(sid, "warm up");
    const help = (await say(sid, "/team help")).text;
    assert.match(help, /^- `\/team off` — give the chat back to your agent\.$/m);
    assert.match(help, /The lead's orders run at once, and an apply commits nothing; your messages reach it at its next round\.$/m);
    assert.ok(!/\/team (validate|autonomous)/.test(help), "no mode to switch");
    assert.ok(!help.includes("@mem"), "no alias named");
    const alias = await say(sid, "@mem team one-shot");
    assert.match(alias.text, /\*\*Memory commands\*\*/);
    const { engine } = await (await shim.api(`/api/sessions/${encodeURIComponent(String(sessions.get(sid)))}/settings`)).json();
    assert.notEqual(engine.mode, "team", "no team took the session");
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 6: /team spoke of one model for every worker, whoever a team's members were)
  test("/team with a team of yours: its lead and members in the list, and a member whose card names a model is said to run on it", async () => {
    const sid = "teams-own-model";
    await say(sid, "warm up");
    const card = await call("POST", "/agents", { tag: "translator", name: "Translator", goodFor: "Turns a page into another language", may: "copy", model: "m-9" });
    assert.equal(card.status, 200, JSON.stringify(card.json));
    const made = await call("POST", "/teams", { name: "Docs", lead: "product", members: [{ tag: "builder" }, { tag: "translator" }] });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    try {
      assert.match((await say(sid, "/team")).text, /^- `docs` \*\*Docs\*\* — Is it worth building, its smallest version, and where it lives on the page\. Product leads Builder, Translator\.$/m);
      const use = await say(sid, "/team docs");
      assert.match(use.text, /^Team \*\*Docs\*\* answers this chat's turns from the next message on: its lead runs on the chat's model, its workers on this chat's own model — Translator on m-9, as its card says\.$/m);
      // Two members with a model of their own: each named.
      assert.equal((await call("PUT", "/agents/translator", { model: "m-8" })).status, 200);
      const second = await call("POST", "/agents", { tag: "pagecheck", name: "Checker", goodFor: "Checks a page", may: "read", model: "m-7" });
      assert.equal(second.status, 200, JSON.stringify(second.json));
      assert.equal((await call("PUT", "/teams/docs", { members: [{ tag: "translator" }, { tag: "pagecheck" }] })).status, 200);
      await say(sid, "/team off");
      assert.match((await say(sid, "/team docs")).text, /its workers on this chat's own model — Translator on m-8, Checker on m-7, as their cards say\.$/m);
    } finally {
      await say(sid, "/team off");
      await call("DELETE", "/teams/docs");
      await call("DELETE", "/agents/translator");
      await call("DELETE", "/agents/pagecheck");
    }
  });

  // (fails before: yes — the settings answer's engine had no teams; and, HarnessV3-Views VW-D10, no team its line)
  test("the settings answer's engine lists the teams and says whether the chosen one can run", async () => {
    const sid = "teams-answer";
    await say(sid, "warm up");
    const chainId = chainOf(sid);
    const engine = async () => (await settingsOf(chainId)).engine;
    const before = await engine();
    assert.deepEqual([before.mode, before.active, before.team, before.problem], ["model", false, null, null]);
    // (the plan's p6: one team builds; the owner's of 11-04: its lead leads one way, and the answer names no way of leading)
    assert.deepEqual(before.teams.slice(0, 1), [
      { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, check: null, lead: { tag: "buildlead", name: "Builders" }, members: FOUR, leadModel: null, leadModels: [], readOnly: false, models: [] },
    ]);
    assert.deepEqual(["style" in before, "styles" in before], [false, false]);
    await say(sid, "/team builders");
    const under = await engine();
    assert.deepEqual([under.mode, under.active, under.team, under.problem, "style" in under], ["team", true, "builders", null, false]);
    await agentTool(sid, false);
    try {
      const stopped = await engine();
      assert.deepEqual([stopped.active, stopped.problem], [false, "engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it"]);
    } finally {
      await agentTool(sid, true);
    }
  });

  // (fails before: yes — engine.team did not exist, so /unset could never leave the session's engine unable to run)
  test("/unset engine.team under a team says the engine cannot run, and why; a deleted team says so on the next turn", async () => {
    const sid = "teams-unset";
    await say(sid, "warm up");
    assert.equal((await call("POST", "/teams", { name: "Short Lived", ...OWN })).status, 200);
    await say(sid, "/team short lived");
    const unset = await say(sid, "/unset engine.team");
    assert.ok(unset.text.includes("This session's engine cannot run yet: engine.mode is team but engine.team names no team (/team lists them) — until it can, its turns go to the session's model."), unset.text);
    await say(sid, "/team short-lived");
    assert.equal((await call("DELETE", "/teams/short-lived")).status, 200);
    const rec = await recordOf((await say(sid, "carry on")).id);
    assert.deepEqual([rec.upstream, rec.agent?.team ?? null], ["agent-loop", null], "the agent answers: no team leads");
    assert.ok(rec.changes.includes("engine: engine.team names `short-lived`, which is no team (/team lists them) — the request went to m-1 as named"), rec.changes.join("\n"));
    assert.match((await say(sid, "/team")).text, /^\*\*Teams\*\* — this chat's turns go to your agent: its team cannot lead — engine\.team names `short-lived`, which is no team \(\/team lists them\)\.$/m);
  });

  // (fails before: yes — /team did not exist, and the harness's turns ran on its own agent alone)
  test("the harness: /team says your agent answers; a team's lead takes the next turn", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json();
    /** @param {string} content */
    const turn = async (content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200);
      return { text: textOf((await r.json()).content), id: String(r.headers.get("x-filament-request-id")) };
    };
    assert.match((await turn("/team")).text, /^\*\*Teams\*\* — this chat's turns go to your agent\.$/m);
    assert.match((await turn("/team builders")).text, /^Team \*\*Builders\*\* answers this chat's turns from the next message on/m);
    const rec = await recordOf((await turn("plan it")).id);
    assert.ok(rec.changes.includes("engine: team Builders answers this session's turns (engine.team), its lead on m-1"), rec.changes.join("\n"));
    assert.match((await turn("/team off")).text, /^This chat's turns go to your agent again, from the next message on \(unset: engine\.mode, engine\.team\)\.$/m);
  });

  // (fails before: yes — the review of 9b24f7d27: what a Brief picked for its crew outlived its team — /team off and
  // /team <another> kept it, and the next team's workers ran on it, the picker hidden from the settings editors)
  test("/team off and /team <name> drop what a Brief picked for its crew", async () => {
    const sid = "teams-picks";
    await say(sid, "warm up");
    const chainId = chainOf(sid);
    const pick = async () => {
      await say(sid, "/set engine.teamWorkers m-2");
      await say(sid, "/set engine.teamEffort low");
    };
    await say(sid, "/team builders");
    await pick();
    assert.match((await say(sid, "/team off")).text, /\(unset: engine\.mode, engine\.team, engine\.teamWorkers, engine\.teamEffort\)\./);
    await pick();
    // (fails before: yes — d-send's follow-up: its card said a team that changes no file only reads in the chat it leads,
    // and the answer's words, which the chat's record keeps, said nothing of it)
    const reads = (await say(sid, "/team bughunters")).text;
    assert.ok(reads.split("\n")[1] === "It changes no file: its lead and its workers only read here, whatever this chat's permission mode says.", reads);
    assert.ok(!(await say(sid, "/team builders")).text.includes("changes no file"), "a team that writes says nothing of it");
    await say(sid, "/team bughunters");
    const e = (await settingsOf(chainId)).effective.engine;
    assert.deepEqual([e.team, e.teamWorkers ?? null, e.teamEffort ?? null], ["bughunters", null, null]);
    // (fails before: yes — the review of 11-05: the team that leads already dropped them too, and said it switched)
    await pick();
    assert.match((await say(sid, "/team bughunters")).text, /already answers this chat's turns; nothing was written\./);
    const kept = (await settingsOf(chainId)).effective.engine;
    assert.deepEqual([kept.team, kept.teamWorkers, kept.teamEffort], ["bughunters", "m-2", "low"]);
    // (fails before: yes — the review of a072feeea: one that cannot lead said it already answers, and never why; the
    // review of 8a278df79: it dropped the Brief's pick, and a second /team for it said it already answers)
    await agentTool(sid, false);
    try {
      for (let i = 0; i < 2; i++) {
        const again = await say(sid, "/team bughunters");
        assert.equal(again.text, "Team **BugHunters** is this chat's team, but it cannot lead yet: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — until it can, this chat's turns go to your agent; nothing was written.");
      }
      const held = (await settingsOf(chainId)).effective.engine;
      assert.deepEqual([held.team, held.teamWorkers, held.teamEffort], ["bughunters", "m-2", "low"], "the Brief's pick stays");
    } finally {
      await agentTool(sid, true);
    }
    // (fails before: yes — the review of f91f08190: a team the chat names by its name, as /set may write it, leads as
    // the same team, yet /team <its key> wrote it again and dropped the Brief's pick)
    await say(sid, "/set engine.team BugHunters");
    assert.match((await say(sid, "/team bughunters")).text, /^Team \*\*BugHunters\*\* already answers this chat's turns; nothing was written\.$/);
    const named = (await settingsOf(chainId)).effective.engine;
    assert.deepEqual([named.team, named.teamWorkers, named.teamEffort], ["BugHunters", "m-2", "low"]);
  });

  // (fails before: yes — a chat command's record named its session only after the record was written, so the log's
  // line and the live feed's event never carried it, and a restart dropped /team, /preset and /set from the session's
  // requests)
  test("a chat command's record names its session in the line the log keeps: /team, /preset and /set", async () => {
    const sid = "teams-logged";
    await say(sid, "warm up");
    const chainId = chainOf(sid);
    const ids = [(await say(sid, "/team builders")).id, (await say(sid, "/preset plain")).id, (await say(sid, "/set stubChars 200")).id];
    const file = join(shim.dataDir, "requests.jsonl");
    /** @type {any[]} */
    let lines = [];
    // The log appends behind the reply: wait for the three lines.
    for (let i = 0; i < 100 && !ids.every((id) => lines.some((l) => l.id === id)); i++) {
      await new Promise((r) => setTimeout(r, 20));
      lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    }
    for (const id of ids) assert.equal(lines.find((l) => l.id === id)?.memory?.chain, chainId, id);
  });

  // (fails before: no — a guard the mutation pass asked for: `/team list`, `/team ?`, where the members' models come
  // from, and a team chosen while the loop is off went unread)
  test("/team's other words: list and ?, the pool's source, and a team the loop cannot run yet", async () => {
    const sid = "teams-words";
    await say(sid, "warm up");
    assert.match((await say(sid, "/team list")).text, /^\*\*Teams\*\* — this chat's turns go to your agent\.$/m);
    assert.match((await say(sid, "/team off")).text, /^No team answers this chat: its turns already go to your agent\.$/);
    assert.match((await say(sid, "/team ?")).text, /^\*\*\/team\*\* — which team answers this chat's turns\.$/m);
    // (fails before: yes — the owner's word of 11-05: a list your global settings held was every chat's) The chat's own
    // list alone; one your global settings still hold says nothing.
    await setLoop({ subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
    try {
      assert.match((await say(sid, "/team")).text, /Its workers run on this chat's own model \(this chat lists none, subagents\.pool\), each on the first with room, unless the team, the lead or a worker's card names a model\.$/m);
    } finally {
      await setLoop({ subagents: { pool: [{ model: "" }] } });
    }
    const own = await shim.api(`/api/sessions/${encodeURIComponent(chainOf(sid))}/settings`, { method: "PATCH", body: { patch: { subagents: { pool: [{ model: "m-cheap" }] } } } });
    assert.equal(own.status, 200, await own.clone().text());
    assert.match((await say(sid, "/team")).text, /Its workers run on m-cheap \(this chat's list, subagents\.pool\), each on the first with room/m);
    await agentTool(sid, false);
    try {
      const use = await say(sid, "/team builders");
      assert.ok(use.text.includes("It cannot lead yet: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — until it can, this chat's turns go to your agent."), use.text);
      // Its card leads with that, never with a team in charge that is not.
      assert.equal((await recordOf(use.id)).card.lead, "Builders cannot run this chat yet: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — until it can, your agent answers.");
    } finally {
      await agentTool(sid, true);
    }
  });

  // (fails before: no — a guard the mutation pass asked for: /set's engine line and /subagent's reach were asked
  // without the teams)
  test("under a team, /set engine.team to another team says no doubt, and /subagent sends its report to the team's lead", async () => {
    const sid = "teams-reach";
    await say(sid, "warm up");
    await say(sid, "/team builders");
    const set = await say(sid, "/set engine.team bughunters");
    assert.doesNotMatch(set.text, /cannot run/, set.text);
    assert.equal((await settingsOf(chainOf(sid))).effective.engine.team, "bughunters");
    const launched = await say(sid, "/subagent look around");
    assert.match(launched.text, /^Launched sub-agent `sa_[0-9a-f]{8}` .*\. Its report goes to this session's agent; /, launched.text);
    // Its run ends before the app does.
    const id = String(/`(sa_[0-9a-f]{8})`/.exec(launched.text)?.[1]);
    const path = `/api/sessions/${encodeURIComponent(chainOf(sid))}/subagents/${id}`;
    for (let i = 0; i < 250 && (await (await shim.api(path)).json()).subagent?.status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
    assert.notEqual((await (await shim.api(path)).json()).subagent?.status, "running");
  });

  // (fails before: no — a guard the mutation pass asked for: an edit's body, a saved team in the settings answer, and the
  // New Task board's draft under a team went unread)
  test("an edit's body that is no object; a saved team in the settings answer; the New Task board's draft under a team", async () => {
    assert.equal((await call("POST", "/teams", { name: "Board Team", ...OWN })).status, 200);
    try {
      const put = await call("PUT", "/teams/board-team", ["lead"]);
      assert.deepEqual([put.status, put.json.error], [400, "a JSON object is required: { name?, lead?, members?, models?, leadModels?, readOnly?, fired?, check? }, the fields to change — models and leadModels each names, or { model, effort } rows; of a shipped team, each given null is put back as it ships, and { reset: true } puts back all"]);
      const sid = "teams-board";
      await say(sid, "warm up");
      const { engine } = await settingsOf(chainOf(sid));
      const listed = engine.teams;
      assert.deepEqual(listed.find((/** @type {any} */ t) => t.key === "board-team"), { key: "board-team", name: "Board Team", line: PRODUCT_LINE, shipped: false, check: null, lead: { tag: "product", name: "Product" }, members: [{ tag: "builder", name: "Builder", may: "edit", place: "builder" }], leadModel: null, leadModels: [], readOnly: false, models: [] });
      // (fails before: yes — the review of 11-03: the page had no word for a seat's id where no team that leads names it)
      assert.deepEqual(engine.shippedCrew, [{ tag: "scout", card: "reviewer", name: "Scout" }, { tag: "builder" }, { tag: "tester", card: "builder", name: "Tester" }, { tag: "reviewer" }], "the crew every shipped team seats");
      const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "m-1", settings: { engine: { mode: "team", team: "board-team" } }, text: "plan it" } });
      const draft = await r.json();
      assert.equal(r.status, 200, JSON.stringify(draft));
      assert.deepEqual(draft.engine, { kind: "team", model: "m-1", team: { key: "board-team", name: "Board Team" } });
      assert.ok(draft.loopFixed > 0, "a team's lead sends the loop's prompt and tools");
    } finally {
      assert.equal((await call("DELETE", "/teams/board-team")).status, 200);
    }
  });
});

// (fails before: yes — HarnessV4_Tasks C9: the page had no ear for a team's save; another tab's Team view and widget
// kept the old team until their next read)
// (and the copies hunt of 2026-10-23: the box's @ list read the teams once, so a team made later was no @team there)
test("the page reads the open chat's settings document and the teams again when the feed says a team changed", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /if \(msg\?\.type !== "teams-changed"\) return;\n {2}void readTeams\(\);\n {2}const chat = chatOf\(state\.currentId\);\n {2}if \(chat\?\.chainId\) refreshSessionDoc\(chat\);/);
});
