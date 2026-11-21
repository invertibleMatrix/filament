// @ts-check
// Teams behind Settings › Experimental's switch, off by default (the owner's of 11-17: teams are "still untested and
// not fully done", and only confuse people). Off: no team starts and nothing offers one — the team tool, `/team`, a
// flow's team box, the Library's page named Agents —, a chat set to be led by a team is answered by its own agent with
// its setting kept, and a team at work finishes: a team's own chat beside a main one is still led by its team, and the
// check Then verify sends on its result still starts. The server's words and the page's agree (core/teams-on.js,
// src/ui/lib/teams-on.js).
// (fails before: yes — teams had no switch)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as server from "../src/core/teams-on.js";
import * as page from "../src/ui/lib/teams-on.js";
import { defaultConfig } from "../src/config.js";
import { engineFor, engineProblem } from "../src/app/engine.js";
import { draftEngine } from "../src/app/sessions/draft-start.js";
import { engine } from "../src/app/pipeline/stages/engine.js";
import { commandCatalog, commandsMarkdown } from "../src/app/commands/registry.js";
import { checkFlow, flowAskLine, rosterWords } from "../src/core/flow.js";
import { serverInstructions } from "../src/http/mcp.js";
import { BESIDE_OFF, BESIDE_TEAMS_OFF, besideAtOf } from "../src/app/agent/beside-tool.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { teamStore } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const ON = { experimental: { teams: true } };
const OFF = { experimental: { teams: false } };
const TEAMS_OFF = "Teams are off: turn them on in Settings › Experimental (Teams)";

describe("the switch and its words", () => {
  test("off by default, on only where it says true; the server's words and the page's agree", () => {
    assert.equal(defaultConfig().experimental.teams, false);
    for (const cfg of [undefined, null, {}, { experimental: {} }, OFF, { experimental: { teams: "yes" } }, { experimental: { teams: 1 } }]) {
      assert.equal(server.teamsOn(cfg), false, JSON.stringify(cfg));
      assert.equal(page.teamsOn(cfg), false, JSON.stringify(cfg));
      assert.equal(server.agentsPage(cfg), "Library › Agents");
      assert.equal(page.agentsPage(cfg), server.agentsPage(cfg));
    }
    assert.deepEqual([server.teamsOn(ON), page.teamsOn(ON), server.agentsPage(ON), page.agentsPage(ON), page.agentsLabel(ON), page.agentsLabel(OFF)], [true, true, "Library › Agents and teams", "Library › Agents and teams", "Agents and teams", "Agents"]);
    assert.equal(server.TEAMS_OFF, TEAMS_OFF);
    assert.equal(server.TEAMS_OFF_WHY, "teams are off in Settings › Experimental (Teams)");
    const teams = teamStore();
    assert.deepEqual([server.leadingTeams(ON, false, teams), server.leadingTeams(OFF, true, teams), server.leadingTeams(OFF, false, teams)], [teams, teams, null], "a team's own chat keeps its team");
  });
});

describe("a chat set to be led by a team, while teams are off", () => {
  const teams = teamStore();
  const led = { mode: "team", team: "builders" };
  const cfg = {
    ...defaultConfig(),
    agentLoop: { ...defaultConfig().agentLoop, enabled: true },
    upstreams: [
      { id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true },
      { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true },
    ],
    routes: [
      { match: "brain-*", upstream: "u", upstreamModel: "{model}", enabled: true },
      { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    ],
  };
  const on = { ...cfg, experimental: { ...defaultConfig().experimental, teams: true } };

  test("its own agent answers, said why, the setting kept; a team's own chat is still led by its team; other engines are untouched", () => {
    assert.equal(engineProblem(led, cfg, teams), "teams are off in Settings › Experimental (Teams)");
    assert.equal(engineProblem(led, cfg, teams, true), null, "a team's own chat");
    assert.equal(engineProblem(led, on, teams), null);
    assert.equal(engineProblem({ mode: "agent" }, cfg, teams), null);
    assert.deepEqual(engineFor(led, cfg, { model: "brain-model", agent: null }, teams), { note: "engine: teams are off in Settings › Experimental (Teams) — the request went to brain-model as named" });
    assert.equal(engineFor(led, cfg, { model: "brain-model", agent: null }, teams, true).agent?.team, "builders");
    assert.deepEqual(engineFor(led, cfg, { model: "coder-one", agent: null }, teams, true).lead, { team: "builders" }, "a coding agent leads a team's own chat");
    assert.equal(engineFor(led, cfg, { model: "coder-one", agent: null }, teams).lead, undefined);
    assert.deepEqual(draftEngine(cfg, "brain-model", led, teams), { kind: "loop", model: "brain-model" });
    assert.deepEqual(draftEngine(cfg, "brain-model", led, teams, true), { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } });
    assert.deepEqual(draftEngine(on, "brain-model", led, teams).kind, "team");
  });

  test("the engine stage reads a team's own chat from its chain, a coding agent's own cycle too", async () => {
    /** A harness turn of chat `chain` on `model`, `own` a coding agent's own cycle. @param {string} chain @param {string} model @param {boolean} [own] */
    const turnOf = async (chain, model, own = false) => {
      /** @type {any} */
      const ctx = { memory: { sit: null, settingsOnly: { settings: { engine: led } }, session: { chain } }, pre: { api: "session", ...(own ? { ownCycle: true } : {}) }, house: own, body: { model }, agent: null };
      const memory = { archive: { getChain: (/** @type {string} */ id) => ({ id, kind: id === "team-chat" ? "team" : "interactive" }) } };
      await engine(ctx, /** @type {any} */ ({ config: () => cfg, memory, teams }));
      return { lead: ctx.lead || null, team: ctx.agent?.team || null, notes: ctx.notes || [] };
    };
    assert.deepEqual(await turnOf("main", "brain-model"), { lead: null, team: null, notes: ["engine: teams are off in Settings › Experimental (Teams) — the request went to brain-model as named"] });
    assert.deepEqual(await turnOf("team-chat", "brain-model"), { lead: null, team: "builders", notes: ["engine: team Builders answers this session's turns (engine.team), its lead on brain-model"] });
    assert.deepEqual(await turnOf("team-chat", "coder-one", true), { lead: { team: "builders" }, team: null, notes: [] }, "its lead's own cycle stays its lead's");
    assert.deepEqual(await turnOf("main", "coder-one", true), { lead: null, team: null, notes: [] }, "a main chat's own cycle is its agent's");
  });
});

describe("what offers a team, while teams are off", () => {
  test("the catalogue has no /team group, and names the Library's page Agents; docs/COMMANDS.md keeps /team, saying it waits for its switch", () => {
    const off = commandCatalog({});
    const on = commandCatalog(ON);
    assert.equal(off.groups.some((g) => g.id === "team"), false);
    assert.equal(on.groups.some((g) => g.id === "team"), true);
    const said = (/** @type {any} */ cat) => JSON.stringify(cat);
    assert.ok(said(off).includes("(Library › Agents: `product`"), "the /subagent as= line");
    assert.ok(said(off).includes("Your work, Agents, Everything else"), "the /welcome line");
    assert.ok(said(on).includes("(Library › Agents and teams: `product`") && said(on).includes("Your work, Agents and teams, Everything else"));
    const intro = (/** @type {any} */ cat, /** @type {string} */ id) => String(cat.groups.find((/** @type {any} */ g) => g.id === id)?.intro || "");
    assert.deepEqual([intro(off, "flow").includes("a flow: your agents in steps"), intro(on, "flow").includes("a flow: your agents and teams in steps")], [true, true], "the flows' intro");
    assert.deepEqual([intro(off, "welcome").includes("meet the agents, and"), intro(on, "welcome").includes("meet the agents and teams, and")], [true, true], "the tour's intro");
    const md = commandsMarkdown();
    assert.match(md, /Teams \(\/team\)/);
    assert.match(md, /these are answered while Settings › Experimental's Teams switch is on, and off, `\/team` says so and `\/team off` still gives a chat back/);
  });

  test("a flow: a team box that has not started is refused, one that ran or runs stays; the roster's words and the /flow line name no team", () => {
    const roster = { cards: [{ tag: "pm", name: "PM" }, { tag: "builder", name: "Builder" }], teams: [{ key: "builders", name: "Builders" }] };
    /** @param {string} [state] */
    const flow = (state) => ({ goal: "plan and build", steps: [{ boxes: [{ id: "plan", kind: "agent", agent: "pm", name: "PM", words: "Plan.", needs: [] }] }, { boxes: [{ id: "build", kind: "team", agent: "builders", name: "Builders", words: "Build.", needs: ["plan"], ...(state ? { state } : {}) }] }] });
    const refusal = "Builders (step 2) is a team, and teams are off in Settings › Experimental (Teams): put one of the person's agents in its place, or turn teams on";
    assert.equal(checkFlow(/** @type {any} */ (flow()), /** @type {any} */ (roster), { teams: false }), refusal);
    assert.equal(checkFlow(/** @type {any} */ (flow("waits")), /** @type {any} */ (roster), { teams: false }), refusal);
    for (const state of ["working", "asking", "done", "failed", "stopped"]) assert.equal(checkFlow(/** @type {any} */ (flow(state)), /** @type {any} */ (roster), { teams: false }), null, state);
    assert.equal(checkFlow(/** @type {any} */ (flow()), /** @type {any} */ (roster)), null, "on");
    const none = { ...roster, teams: [] };
    assert.equal(rosterWords(/** @type {any} */ (none), { teams: false }), "Their agents (a box's \"agent\"):\n- pm: PM, reads only\n- builder: Builder, reads only");
    assert.match(rosterWords(/** @type {any} */ (roster)), /Their teams \(a box's "team"\):\n- builders: Builders, writes$/);
    const line = flowAskLine(/** @type {any} */ (none), { teams: false });
    assert.doesNotMatch(line, /team/i);
    assert.match(line, /— their agents in steps beside this chat — with Filament's flow tool[\s\S]*A box is one of their agents \("agent": its tag\), or the person's own review/);
    assert.doesNotMatch(flowAskLine(/** @type {any} */ (none), { teams: false, off: "switch" }), /team/i);
    assert.match(flowAskLine(/** @type {any} */ (roster)), /one of their teams \("team": its key\)/);
  });

  test("Filament's MCP instructions: the flow tool designs a flow of the person's agents", () => {
    assert.match(serverInstructions({ cwd: "/p", flow: true, teams: false }), /Its `flow` designs a flow of the person's agents when they ask for one with \/flow\./);
    assert.match(serverInstructions({ cwd: "/p", flow: true }), /Its `flow` designs a flow of the person's agents and teams when/);
  });

  test("the main agent's team tool: not listed, and a call a coding agent still holds is told teams are off", async () => {
    let on = false;
    const deps = {
      fire: async () => assert.fail("nothing is sent"),
      note: async () => assert.fail("nothing is noted"),
      list: () => [],
      lead: () => null,
      teams: () => [],
      fires: () => true,
      on: () => true,
      teamsOn: () => on,
    };
    assert.equal(besideAtOf(deps, "c1"), null);
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => null, membersOf: () => null, beside: /** @type {any} */ (deps) });
    const ctx = (/** @type {any} */ o) => /** @type {any} */ ({ cwd: "/p", upstream: "u", chain: "c1", turn: null, graph: false, ...o });
    assert.equal(tools.list(ctx({ beside: true })).some((t) => t.name === "team"), false);
    assert.equal(tools.teamsOn?.(), false);
    assert.deepEqual(await tools.call("team", { action: "send", team: "bughunters", ask: "hunt" }, ctx({ beside: true })), { text: BESIDE_TEAMS_OFF, isError: true });
    assert.deepEqual(await tools.call("team", { action: "status" }, ctx({})), { text: BESIDE_OFF, isError: true }, "a session never given it");
    assert.equal(BESIDE_TEAMS_OFF, "Not run: teams are off here. The person turns them on in Settings › Experimental (Teams). Do the work yourself.");
    on = true;
    assert.equal(tools.list(ctx({ beside: true })).some((t) => t.name === "team"), true);
    assert.equal(tools.teamsOn?.(), true);
  });
});

describe("teams beside a chat, while teams are off", () => {
  /** A runner of teams beside over a main chat `main` and a team's chat `t1` beside it, its switch `w.on`. */
  const rig = () => {
    const w = {
      on: true,
      /** @type {Record<string, any>} */
      meta: {},
    };
    const main = { id: "main", kind: "interactive", meta: w.meta };
    const done = { id: "t1", kind: "team", model: "m-1", meta: { beside: { team: "builders", name: "Builders", ask: "build it", at: 5, firedBy: "you" } } };
    const beside = createTeamsBeside(/** @type {any} */ ({
      archive: () => ({
        getChain: (/** @type {string} */ id) => (id === "main" ? main : id === "t1" ? done : null),
        mainOf: (/** @type {string} */ id) => (id === "t1" ? "main" : null),
        besideOf: () => ["t1"],
        chainHead: (/** @type {string} */ id) => (id === "main" ? main : done),
        mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => (id === "main" ? Object.assign(w.meta, patch) : null),
      }),
      sessions: { besideFacts: () => ({ busy: false, asking: null, last: { text: "Built.", final: true, n: 1, endedAt: 9 } }), settingsOf: () => ({ effective: {} }) },
      teams: teamStore(),
      registry: () => ({ list: () => [] }),
      postTurn: async () => ({ status: 200, body: {} }),
      reach: { busy: () => false, post: async () => ({ status: 200, body: {} }), steer: () => ({ ok: true }) },
      remove: async () => {},
      events: { publish: () => {} },
      teamsOn: () => w.on,
    }));
    return { w, beside };
  };

  test("none is sent — the person's, the main agent's, a flow's box —; the check Then verify sends on a team's result still starts", async () => {
    const { w, beside } = rig();
    w.on = false;
    for (const input of [{ team: "bughunters", ask: "hunt" }, { team: "bughunters", ask: "hunt", by: "agent" }, { team: "builders", ask: "build", by: "flow" }, { team: "bughunters", ask: "check", of: "t1" }])
      await assert.rejects(beside.fire("main", input), (/** @type {any} */ e) => e.status === 400 && e.message === TEAMS_OFF, JSON.stringify(input));
    // Past the switch, Then verify's check is refused for what it names, never for the switch.
    await assert.rejects(beside.fire("main", { team: "nobody", ask: "check", of: "t1", auto: true }), (/** @type {any} */ e) => e.status === 404 && /no team answers to "nobody"/.test(e.message));
    await assert.rejects(beside.fire("t1", { team: "bughunters", ask: "hunt" }), /a team beside sends no team of its own/, "a team's own chat, as ever");
  });

  test("a message names no team while they are off, and the chat keeps none: turned on again, a team an older message named is not the agent's", () => {
    const { w, beside } = rig();
    assert.deepEqual(beside.heard("main", "ask the Builders to build it"), ["builders"]);
    assert.ok(beside.agentMay("main").includes("builders"));
    assert.deepEqual(beside.usesOf(["builders"]), [{ key: "builders", name: "Builders" }]);
    w.on = false;
    assert.deepEqual(beside.heard("main", "ask the Builders again", { add: true }), []);
    assert.deepEqual(w.meta.heardTeams, [], "stored, so a restart reads none");
    assert.deepEqual(beside.usesOf(["builders", "@bughunters"]), []);
    w.on = true;
    assert.equal(beside.agentMay("main").includes("builders"), false);
  });
});

describe("the switch through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** Each request a model was sent with tools: its system, its tools' names and what it said. @type {{ system: string, tools: string[], said: string }[]} */
  const seen = [];
  /** @param {any} content */
  const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-teams-switch-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const said = JSON.stringify(call.body.messages || []);
      seen.push({ system: JSON.stringify(call.body.system || ""), tools: call.body.tools.map((/** @type {any} */ t) => String(t.name)), said });
      if (said.includes("<main-chat")) return anthropicReply("Found: parse.js:3 reads a field of null.", { model: "m-1" });
      return anthropicReply("Done.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const made = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
  /** A turn of chat `id`: its text, and the request a model was sent for it. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const from = seen.length;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const json = await r.json();
    assert.equal(r.status, 200, JSON.stringify(json));
    return { text: textOf(json?.content), sent: seen.slice(from), rec: await (await shim.api(`/api/requests/${encodeURIComponent(String(r.headers.get("x-filament-request-id")))}`)).json() };
  };
  /** @param {boolean} teams */
  const flip = async (teams) => {
    const st = await (await shim.api("/api/state")).json();
    const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, experimental: { ...st.config.experimental, teams } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const LEAD = "# Your team:";

  test("switched off: no team is sent and the team tool goes; a team at work is still led by its team; a chat set to a team is its agent's until they are on again; /team says so", async () => {
    const sid = await made();
    const first = await say(sid, "build the parser");
    assert.ok(first.sent[0]?.tools.includes("team"), "on: the main agent's team tool");
    const fired = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "find bugs in the parser", model: "m-1" } });
    const firedBody = await fired.json();
    assert.equal(fired.status, 200, JSON.stringify(firedBody));
    const team = firedBody.team;
    await until(async () => ((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || []).find((/** @type {any} */ t) => t.id === team.id && t.state === "done"), "the hunt's result");
    const ledId = await made();
    assert.match((await say(ledId, "/team builders")).text, /^Team \*\*Builders\*\* answers this chat's turns from the next message on/m);
    assert.ok((await say(ledId, "plan the work")).sent[0]?.system.includes(`${LEAD} Builders`), "on: its lead answers");

    await flip(false);
    const refused = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt again", model: "m-1" } });
    assert.deepEqual([refused.status, (await refused.json()).error], [400, TEAMS_OFF]);
    const next = await say(sid, "go on");
    assert.equal(next.sent[0]?.tools.includes("team"), false, "off: no team tool");
    assert.equal(next.sent[0]?.system.includes(LEAD), false);
    assert.equal((await say(sid, "/team")).text, `${TEAMS_OFF}.`);
    assert.equal((await say(sid, "/team builders")).text, `${TEAMS_OFF}.`);
    // A team's own chat beside: its team leads it until its work is done.
    assert.ok((await say(team.id, "look once more")).sent[0]?.system.includes(`${LEAD} BugHunters`), "the team's own chat");
    // A chat set to a team: its agent answers, said on its record; the setting kept.
    const solo = await say(ledId, "and now?");
    assert.equal(solo.sent[0]?.system.includes(LEAD), false);
    assert.equal(solo.rec.upstream, "agent-loop");
    assert.equal(solo.rec.agent?.team, undefined);
    assert.ok(solo.rec.changes.includes("engine: teams are off in Settings › Experimental (Teams) — the request went to m-1 as named"), solo.rec.changes.join("\n"));
    const doc = await (await shim.api(`/api/sessions/${ledId}/settings`)).json();
    assert.deepEqual([doc.effective.engine.mode, doc.effective.engine.team], ["team", "builders"]);
    assert.equal((await say(ledId, "/team")).text, `${TEAMS_OFF}. This chat's settings name a team, which leads it again once teams are on: until then your agent answers it, and \`/team off\` clears the setting.`);
    // What the page reads of each chat's engine: the band over a chat its team leads, and the teams its agent may send.
    const engineOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${id}/settings`)).json()).engine;
    assert.equal((await engineOf(ledId)).problem, "teams are off in Settings › Experimental (Teams)");
    assert.equal((await engineOf(team.id)).problem, null, "a team's own chat");
    assert.deepEqual((await engineOf(sid)).agentTeams, []);

    await flip(true);
    assert.ok((await say(ledId, "and once more")).sent[0]?.system.includes(`${LEAD} Builders`), "on again: its team leads it");
    await flip(false);
    assert.match((await say(ledId, "/team off")).text, /^This chat's turns go to your agent again, from the next message on \(unset: /, "/team off still gives a chat back");
    const after = await (await shim.api(`/api/sessions/${ledId}/settings`)).json();
    assert.notEqual(after.effective.engine?.mode, "team");
  });
});
