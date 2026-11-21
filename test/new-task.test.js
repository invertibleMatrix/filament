// @ts-check
// HarnessV3-NewTask: the New Task board's answer — the first request of a session not born yet, weighed part by part
// (NT-D5), from the functions the turn itself uses (NT-D6), the engine the name reaches (NT-D8), and nothing written
// or called to answer it (NT-D11). The board's page half is in new-task-board.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { teamStore } from "./helpers/team.js";
import { defaultConfig } from "../src/config.js";
import { draftEngine, startAnatomy } from "../src/app/sessions/draft-start.js";
import { harnessRunsLoop } from "../src/app/engine.js";
import { usableWindow } from "../src/app/sessions/compaction.js";
import { estimateTokens } from "../src/core/tokens.js";
import { recallToolDef } from "../src/app/memory-tools.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { TEAMS_OFF_WHY } from "../src/core/teams-on.js";

const AGENTS = "Always run the tests before you say a change is done.\nNever push to main.\n".repeat(6);

describe("the board's answer: POST /api/sessions/draft-start", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-newtask-"));
    writeFileSync(join(root, "AGENTS.md"), AGENTS);
    mkdirSync(join(root, "skills", "deploy"), { recursive: true });
    writeFileSync(join(root, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship a build to staging\ntriggers: [ship it]\n---\nRun the build, then copy dist/ to the staging box, then smoke-test /health.\n".repeat(1));
    up = await fakeUpstream(() => anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "Done." }], usage: { input_tokens: 30, output_tokens: 7 } }));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 3, output: 15, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    // In Library › Skills, on at no place: the draft's settings turn it on.
    assert.equal((await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "skills")] } })).status, 200);
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  /** @param {any} body */
  const draft = async (body) => {
    const r = await shim.api("/api/sessions/draft-start", { method: "POST", body });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return j;
  };
  const SETTINGS = { skills: { on: [{ name: "deploy" }] }, instructions: { session: "Answer in plain English." } };

  // (fails before: there was no such answer — the preset cards said nothing about the first request)
  test("every part of the first request, on the window's scale with the compaction line; nothing written, no model called", async () => {
    up.reset();
    const projectsBefore = (await (await shim.api("/api/memory/projects")).json()).projects?.length ?? 0;
    const sessionsBefore = (await (await shim.api("/api/sessions")).json()).sessions?.length ?? 0;
    const d = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "fix the flaky test" });
    assert.equal(d.engine.kind, "loop", "a plain route in the harness runs on the agent loop");
    assert.equal(d.window.tokens, 200000);
    assert.equal(d.line.percent, 85);
    assert.equal(d.line.tokens, usableWindow(200000, { thresholdPercent: 85 }));
    const part = Object.fromEntries(d.parts.map((/** @type {any} */ p) => [p.id, p.tokens]));
    assert.deepEqual(d.parts.map((/** @type {any} */ p) => p.id), ["prompt", "instructions", "skills", "tools", "memory", "message"]);
    for (const id of ["prompt", "instructions", "skills", "tools", "message"]) assert.ok(part[id] > 0, `${id} weighs something: ${JSON.stringify(d.parts)}`);
    assert.equal(part.message, estimateTokens("fix the flaky test"), "the message is the server's own estimate");
    assert.ok(part.instructions >= estimateTokens(AGENTS), "the instruction file is all there");
    assert.deepEqual(d.instructions.files.map((/** @type {any} */ f) => f.file), ["AGENTS.md"]);
    assert.equal(d.instructions.files[0].chars, AGENTS.length);
    assert.deepEqual(d.instructions.missing, ["CLAUDE.md", ".filament/instructions.md"], "the defaults it looked for and did not find");
    assert.equal(d.instructions.sessionChars, "Answer in plain English.".length);
    // The system prompt split three ways adds up to what the loop sends: with no memory tools on this app's turn, the
    // prompt, the instructions, the skills and the tools are the loop's fixed part and the recall tool, which memory
    // offers on every request of the chat.
    assert.deepEqual([d.tools.memory, d.tools.recall], [0, true]);
    const extra = part.prompt + part.instructions + part.skills + part.tools - d.loopFixed;
    assert.ok(Math.abs(extra - estimateTokens(JSON.stringify(recallToolDef("anthropic")))) <= 2, `${extra}: ${JSON.stringify(d.parts)}`);
    assert.equal(part.memory, 0, "autopilot is off in this app: memory records the turns and adds nothing to the request");
    assert.deepEqual(d.skills.list.map((/** @type {any} */ s) => s.name), ["deploy"]);
    assert.deepEqual(d.skills.triggered, []);
    assert.ok(d.tools.offered.includes("read") && d.tools.offered.includes("agent"), d.tools.offered.join(","));
    assert.deepEqual(d.tools.off, []);
    assert.equal("context.strategy" in d.flat, false, "no choice of how earlier turns go: every turn whole until a compaction");
    assert.deepEqual(d.flat["skills.on"], [{ name: "deploy" }]);
    assert.equal(d.sources["skills.on"], "session", "a held change is marked as this task's");
    assert.equal(up.received.length, 0, "no model was called (NT-D11)");
    assert.equal((await (await shim.api("/api/memory/projects")).json()).projects?.length ?? 0, projectsBefore, "no project row conjured");
    assert.equal((await (await shim.api("/api/sessions")).json()).sessions?.length ?? 0, sessionsBefore, "no session created");
  });

  // (fails before: yes — with no model chosen the card read "No skill is on here yet" while two were on, and a skill
  // turned off here was named among those on)
  test("no model chosen yet: the skills on here are still named, and one turned off is not among them", async () => {
    const d = await draft({ cwd: root, model: "", settings: { skills: { on: [{ name: "deploy" }, { name: "lint", enabled: false }] } }, text: "hi" });
    assert.notEqual(d.engine.kind, "agent");
    assert.deepEqual([d.skills.on, d.skills.list.map((/** @type {any} */ s) => s.name)], [["deploy"], ["deploy"]]);
  });

  // (the owner's of 11-07: a tag is the agent's to load on demand — before, it rode the message whole)
  test("live as you type: a message that tags a skill as $<name> names it, its words alone, its trigger alone names none; switching a tool off takes it out", async () => {
    const plain = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "please fix it" });
    const ship = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "$deploy ship it to staging" });
    const skills = (/** @type {any} */ d) => d.parts.find((/** @type {any} */ p) => p.id === "skills").tokens;
    const message = (/** @type {any} */ d) => d.parts.find((/** @type {any} */ p) => p.id === "message").tokens;
    assert.deepEqual(ship.skills.triggered, ["deploy"]);
    assert.equal(skills(ship), skills(plain), "the prompt's skills are the same bytes whatever the message calls");
    assert.ok(message(ship) < message(plain) + 20, `nothing of the tagged skill rides the message (${message(plain)} → ${message(ship)})`);
    const word = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "ship it to staging" });
    assert.deepEqual([word.skills.triggered, skills(word)], [[], skills(plain)], "a trigger word is read by the model on the skill's line (the memory upgrade's a4)");
    const off = await draft({ cwd: root, model: "brain-model", settings: { ...SETTINGS, loop: { tools: { bash: false, agent: false } } }, text: "please fix it" });
    assert.ok(!off.tools.offered.includes("bash") && !off.tools.offered.includes("agent"));
    assert.deepEqual(off.tools.off, ["bash", "agent"]);
    const tools = (/** @type {any} */ d) => d.parts.find((/** @type {any} */ p) => p.id === "tools").tokens;
    assert.ok(tools(off) < tools(plain), "fewer tools, fewer tokens");
    const mem = await draft({ cwd: root, model: "brain-model", settings: { ...SETTINGS, memory: { enabled: false } }, text: "x" });
    assert.equal(mem.memory.on, false);
    assert.equal(mem.parts.find((/** @type {any} */ p) => p.id === "memory").tokens, 0, "muted: memory adds nothing");
    assert.equal(mem.memory.autopilot, false, "this app's autopilot is off (startApp), and the answer says so");
  });

  // (fails before: the loop assembled its prompt inline — no second caller could weigh it without copying it)
  test("what the board shows is what the loop sends: its fixed figure on the session's first turn equals the board's", async () => {
    const d = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "fix the flaky test" });
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", settings: SETTINGS, autoTitle: true } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = (await created.json()).id;
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fix the flaky test", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const runId = r.headers.get("x-filament-request-id");
    const ev = (await (await shim.api(`/api/runs/${encodeURIComponent(String(runId))}/events?limit=500`)).json()).events || [];
    const win = ev.find((/** @type {any} */ e) => e.type === "window");
    assert.ok(win, `the loop said its window: ${JSON.stringify(ev.map((/** @type {any} */ e) => e.type))}`);
    assert.equal(win.fixed, d.loopFixed, "the loop's system prompt + tools, as the board weighed them before the session existed");
    assert.equal(win.window, d.window.tokens);
    assert.equal(win.usable, d.line.tokens);
    const sent = up.received.find((c) => c.kind === "anthropic");
    const tools = (sent?.body?.tools || []).map((/** @type {any} */ t) => t.name);
    for (const name of d.tools.offered) assert.ok(tools.includes(name), `${name} was offered on the wire too: ${tools.join(",")}`);
  });

  // (fails before: yes — the design pass of 10-24, UX5: the answer said what each setting is, never what it was before
  // the draft changed it, so a tool family's ↺ could not put its chips back, and a switch flipped back stayed a change)
  test("base: what the start gives each setting the draft changes, before the change — nothing for a setting it leaves", async () => {
    const d = await draft({ cwd: root, model: "brain-model", settings: { ...SETTINGS, loop: { tools: { bash: false } } }, text: "x" });
    assert.deepEqual(Object.keys(d.base).sort(), ["instructions.session", "loop.tools", "skills.on"], "the changed settings, the model's name not among them");
    assert.equal(d.base["loop.tools"], null, "the start switches no tool off");
    assert.deepEqual(d.base["skills.on"], []);
    assert.deepEqual(d.flat["loop.tools"], { bash: false }, "the answer's own value is the draft's");
    assert.deepEqual((await draft({ cwd: root, model: "brain-model", text: "x" })).base, {});
  });

  test("a folder that does not exist is refused in words; a body without one is a 400", async () => {
    const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: join(root, "nope") } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /does not exist/);
    const r2 = await shim.api("/api/sessions/draft-start", { method: "POST", body: { model: "brain-model" } });
    assert.equal(r2.status, 400);
  });

  // Every tool from the first message (team_v2_plan TV2-D7): a project's chat has its Space's tool from its first turn,
  // whether anyone wrote to the Space yet or not, and the board weighs it as the turn sends it. Its switch on the Tools
  // card leaves it out, and the board says so.
  // (fails before: yes — the tool waited until the project's Space was in use, and came mid-session)
  test("a project's chat has the space tool from its first message: the board weighs it as the turn sends it", async () => {
    // Once its project's Space is made from its menu (10-29): until then, none.
    const p = await (await shim.api("/api/memory/projects", { method: "POST", body: { cwd: root } })).json();
    const none = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "fix the flaky test" });
    assert.ok(!none.tools.offered.includes("space"), none.tools.offered.join(","));
    assert.deepEqual(none.tools.off, [], "not a switch the person turned");
    assert.equal((await shim.api(`/api/space/${p.id}`, { method: "POST" })).status, 200);
    const d = await draft({ cwd: root, model: "brain-model", settings: SETTINGS, text: "fix the flaky test" });
    assert.ok(d.tools.offered.includes("space"), d.tools.offered.join(","));
    assert.deepEqual(d.tools.off, [], "not a switch the person turned");
    const off = await draft({ cwd: root, model: "brain-model", settings: { ...SETTINGS, loop: { tools: { space: false } } }, text: "fix the flaky test" });
    assert.ok(!off.tools.offered.includes("space"));
    assert.deepEqual(off.tools.off, ["space"], "the person's switch");
    assert.ok(d.loopFixed > off.loopFixed);
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", settings: SETTINGS, autoTitle: true } });
    const id = (await created.json()).id;
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fix the flaky test", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const ev = (await (await shim.api(`/api/runs/${encodeURIComponent(String(r.headers.get("x-filament-request-id")))}/events?limit=500`)).json()).events || [];
    assert.equal(ev.find((/** @type {any} */ e) => e.type === "window")?.fixed, d.loopFixed);
    const sent = up.received.find((c) => c.kind === "anthropic");
    // The Space, then the team tool (team_v2_plan §5.5), the flow tool (HarnessV4_OneAgent_Plan OA3) and the thread tool (th3): last of the
    // loop's own, so the tools before them keep their bytes; report after them while the graph is on, for a task
    // started as the agent's fork (the owner's words of 10-26); the web's and the browser after it, on in a new chat
    // (HarnessV4_AgentTools_Plan AT-D1); the skill tool, where skills are listed (HarnessV4_SpacesPlugins_Plan B4); the
    // recall tool memory adds last, on every request of the chat.
    assert.deepEqual((sent?.body?.tools || []).slice(-11).map((/** @type {any} */ t) => t.name), ["space", "team", "flow", "thread", "report", "web_fetch", "web_search", "browser", "come_back", "skill", "filament_recall"]);
    assert.ok(d.tools.offered.includes("skill"), "the board names it as the turn sends it");
  });
});

describe("which engine a name reaches (NT-D8)", () => {
  const cfgWith = (/** @type {(c: any) => void} */ f) => {
    const c = defaultConfig();
    c.upstreams = [
      { id: "api", name: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true },
      { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true },
    ];
    c.routes = [
      { match: "brain-*", upstream: "api", upstreamModel: "{model}", enabled: true },
      { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    ];
    c.agentLoop = { ...c.agentLoop, enabled: true };
    f(c);
    return c;
  };
  test("the loop for a plain route, the agent's own for a coding agent, the model where the loop does not run it", () => {
    const cfg = cfgWith(() => {});
    assert.deepEqual(draftEngine(cfg, "brain-model"), { kind: "loop", model: "brain-model" });
    assert.deepEqual(draftEngine(cfg, "coder-one"), { kind: "agent", model: "coder-one" });
    assert.equal(draftEngine(cfg, "nothing-routes").kind, "none");
    assert.equal(draftEngine(cfg, "").kind, "none");
    // A route whose own upstream is switched off: the loop does not run it.
    const upOff = cfgWith((c) => { c.upstreams[0].enabled = false; });
    assert.deepEqual(draftEngine(upOff, "brain-model"), { kind: "model", model: "brain-model" });
    // (fails before: no — a guard the mutation pass asked for: no test drafted an `agent/` name)
    assert.deepEqual(draftEngine(cfg, "agent/brain-model"), { kind: "loop", model: "brain-model" });
    // (fails before: yes — a stored `agentLoop.enabled: false` ran the model as plain chat and drafted no `agent/` name;
    // the loop has no switch now, the owner's of 11-09)
    const stored = cfgWith((c) => { c.agentLoop.enabled = false; });
    assert.deepEqual([draftEngine(stored, "brain-model"), draftEngine(stored, "agent/brain-model")], [{ kind: "loop", model: "brain-model" }, { kind: "loop", model: "brain-model" }]);
  });
  test("one rule for the parse stage and the board: harnessRunsLoop", () => {
    const cfg = cfgWith(() => {});
    assert.equal(harnessRunsLoop(cfg, "brain-model"), true);
    assert.equal(harnessRunsLoop(cfg, "coder-one"), false, "a coding agent's route has hands of its own");
    assert.equal(harnessRunsLoop(cfg, "nothing-routes"), false);
    assert.equal(harnessRunsLoop(cfgWith((c) => { c.upstreams[0].enabled = false; }), "brain-model"), false, "a route whose own upstream is off");
    assert.equal(harnessRunsLoop(cfgWith((c) => { c.agentLoop.enabled = false; }), "brain-model"), true, "a stored off is no word now");
    const parse = readFileSync("src/app/pipeline/stages/parse.js", "utf8");
    assert.match(parse, /pre\?\.api === "session" && harnessRunsLoop\(cfg, body\.model, ctx\.requested\.base\)\) ctx\.agent = parseAgentModel\(`agent\/\$\{body\.model\}`\);/, "the parse stage asks the same function");
    const turn = readFileSync("src/app/agent/turn.js", "utf8");
    // Another machine's agents' chat, fenced (no Full control), reads its prompt from the document without the person's
    // own instruction files (`instrDoc`); every other chat's is the document itself.
    assert.match(turn, /const instrDoc = fenced && doc\?\.instructions\?\.userFiles\?\.length \? \{ \.\.\.doc, instructions: \{ \.\.\.doc\.instructions, userFiles: \[\] \} \} : doc;/);
    assert.match(turn, /const sys = loopSystem\(\{ cfg, doc: forked \? null : instrDoc, root, readerModel, off, web, mcp: mcpLine, host, lead: leadTeam \? \{ name: leadTeam\.name, persona: leadTeam\.persona, members: leadTeam\.members, models: leadModels, readOnly: !!leadTeam\.readOnly, held: !leadTeam\.readOnly && fixedMode === "read-only" \} : null, requestSystem: sysText, environment: envSaid, model, window: loopWindow, graph: graphOn, asks: asks\.length > 0, supervise: superviseOn, noTools: wordsOnly, added: wordsOnly \? \[\] : added\.folders, browser: browserOn, skillSet: forked \? null : skillsBase, hooksSaid: startSaid, instructionsKept \}\);/, "the loop assembles its prompt through loopSystem");
    assert.match(turn, /const fullSystem = forked \? forked\.system : sys\.text;/);
  });
});

describe("startAnatomy, unit by unit", () => {
  const cfgOf = (/** @type {(c: any) => void} */ f = () => {}) => {
    const c = defaultConfig();
    // Settings › Experimental's Teams switch on: these say who runs a session where a team may; off is said by name.
    c.experimental = { ...c.experimental, teams: true };
    c.upstreams = [
      { id: "api", name: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true },
      { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true },
    ];
    c.routes = [
      { match: "brain-*", upstream: "api", upstreamModel: "{model}", enabled: true },
      { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    ];
    c.agentLoop = { ...c.agentLoop, enabled: true, readerModel: "" };
    c.memory = { ...(c.memory || {}), enabled: true, autopilot: { enabled: true, briefingTokens: 1200, turnTokens: 300, tools: true } };
    f(c);
    return c;
  };
  const memory = {
    archive: { projects: () => [{ id: "p1", items: 7, dossier: 3 }] },
  };
  const cwd = tmpdir();
  const memOf = (/** @type {any} */ a) => a.parts.find((/** @type {any} */ p) => p.id === "memory");

  // (fails before: yes — step 6: the answer said nothing of who may run the session before its first message)
  test("who runs the session (AG-173): the teams there are, the one that leads and how its orders go out; why no team can lead, by draftEngine's own rules; a team the start names that is none", () => {
    const teams = teamStore();
    teams.create({ name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words." }] });
    const eff = { model: { name: "brain-model" } };
    const of = (/** @type {any} */ e = eff, cfg = cfgOf()) => startAnatomy({ cfg, eff: e, cwd, projectId: "p1", memory: null, teams });
    const plain = of().who;
    assert.deepEqual(plain.teams.map((t) => [t.key, t.shipped, t.lead.tag, t.members.map((m) => m.tag).join(" ")]), [
      ["builders", true, "buildlead", "scout builder tester reviewer"],
      ["bughunters", true, "huntlead", "hunter checker"],
      ["docs", false, "product", "builder"],
    ]);
    assert.deepEqual(plain.teams.at(-1), {
      key: "docs", name: "Docs", line: "Is it worth building, its smallest version, and where it lives on the page", shipped: false, check: null,
      lead: { tag: "product", name: "Product" }, members: [{ tag: "builder", name: "Builder", may: "edit", place: "builder" }],
      leadModel: null, leadModels: [], readOnly: false, models: [],
    }, "a team as the page lists it: no persona, no member's words; its lead's models, first choice first (the owner's 10-19 list)");
    assert.deepEqual({ ...plain, teams: null }, { teams: null, asked: false, team: null, off: null, problem: null });
    // A team the start names leads: by its key or its name as written; a coding agent leads as itself (case 33). A team
    // mode an older Filament saved changes nothing.
    const led = of({ ...eff, engine: { mode: "team", team: "Docs", teamMode: "validate" } });
    assert.deepEqual([led.engine.kind, led.who.asked, led.who.team, "mode" in led.who, led.who.off, led.who.problem], ["team", true, "docs", false, null, null]);
    // (fails before: yes — the owner's of 11-17) Settings › Experimental's Teams switch off: no team is listed or leads,
    // and `off` says why, never that the team named is none.
    const alone = of({ ...eff, engine: { mode: "team", team: "Docs" } }, cfgOf((c) => { c.experimental.teams = false; }));
    assert.deepEqual([alone.engine.kind, alone.who.teams, alone.who.asked, alone.who.team, alone.who.off, alone.who.problem], ["loop", [], true, null, TEAMS_OFF_WHY, null]);
    const coder = of({ model: { name: "coder-one" }, engine: { mode: "team", team: "builders" } });
    assert.deepEqual([coder.engine.kind, coder.who.team, coder.who.off], ["agent", "builders", null]);
    // Why no team can lead (case 32), each where draftEngine itself gives none.
    const NOT_RUN = "Filament's agent loop does not run brain-model, and a team works on it";
    const AGENT_OFF = "the agent tool is off for this chat (the Tools card), and a lead launches its workers with it";
    const upOff = cfgOf((c) => { c.upstreams[0].enabled = false; });
    const asks = { mode: "team", team: "docs" };
    /** @type {[any, any, string][]} */
    const cases = [
      [{}, cfgOf(), "no model chosen yet"],
      [{ model: { name: "nothing-routes" } }, cfgOf(), 'no route matches "nothing-routes" — add one on the Routes page'],
      [eff, upOff, NOT_RUN],
      [{ ...eff, loop: { tools: { agent: false } } }, cfgOf(), AGENT_OFF],
      [{ model: { name: "coder-one" }, loop: { tools: { agent: false } } }, cfgOf(), AGENT_OFF],
    ];
    for (const [e, cfg, why] of cases) {
      assert.deepEqual([of(e, cfg).who.off, of(e, cfg).who.asked], [why, false], why);
      const asked = of({ ...e, engine: asks }, cfg);
      assert.deepEqual([asked.engine.team, asked.who.asked, asked.who.team, asked.who.off, asked.who.problem], [undefined, true, null, why, null], `asked: ${why}`);
    }
    // Where nothing is said to be off, any team named leads: the row's second choice never offers what cannot be.
    for (const e of [eff, { model: { name: "agent/brain-model" } }, { model: { name: "coder-one" } }])
      for (const t of plain.teams) assert.equal(of({ ...e, engine: { mode: "team", team: t.key } }).who.team, t.key, `${e.model.name} · ${t.key}`);
    // A team the start names that is none; a start that asks for a team and names none.
    assert.deepEqual({ ...of({ ...eff, engine: { mode: "team", team: "gone" } }).who, teams: null },
      { teams: null, asked: true, team: null, off: null, problem: 'it names the team "gone", and there is no such team' });
    assert.equal(of({ ...eff, engine: { mode: "team" } }).who.problem, "it names no team");
    // With no team store the list is empty, and the agent itself runs it.
    assert.deepEqual(startAnatomy({ cfg: cfgOf(), eff, cwd, projectId: "p1", memory: null }).who, { teams: [], asked: false, team: null, off: null, problem: null });
  });

  test("memory's share (NT-D5): a ceiling only when memory is on, ready and on autopilot — the briefing plus a first message's recall (the turn block's own room)", () => {
    const eff = { model: { name: "brain-model" } };
    const a = startAnatomy({ cfg: cfgOf(), eff, cwd, projectId: "p1", memory });
    assert.deepEqual(memOf(a), { id: "memory", tokens: 1200 + 300, upTo: true });
    assert.deepEqual([a.memory.briefing, a.memory.recall, a.memory.tools], [1200, 300, true]);
    assert.ok(a.tools.memory > 0, "memory's tools ride the loop's request");
    assert.deepEqual(a.memory.knows, { memories: 7, dossier: 3 });
    assert.equal("abilities" in a, false, "abilities are gone: skills took their place");
    const autopilotOff = startAnatomy({ cfg: cfgOf((c) => { c.memory.autopilot.enabled = false; }), eff, cwd, projectId: "p1", memory });
    assert.equal(memOf(autopilotOff).tokens, 0, "recording only: nothing added");
    assert.equal(autopilotOff.tools.memory, 0);
    const muted = startAnatomy({ cfg: cfgOf(), eff: { ...eff, memory: { enabled: false } }, cwd, projectId: "p1", memory });
    assert.equal(memOf(muted).tokens, 0, "muted for the task: nothing added");
    const noBriefing = startAnatomy({ cfg: cfgOf(), eff: { ...eff, memory: { briefing: false } }, cwd, projectId: "p1", memory });
    assert.equal(memOf(noBriefing).tokens, 450, "with no briefing to recall on its words, the first message's recall has half again");
    const noTurnBlock = startAnatomy({ cfg: cfgOf(), eff: { ...eff, memory: { turnBlock: false } }, cwd, projectId: "p1", memory });
    assert.equal(memOf(noTurnBlock).tokens, 1200);
    const notReady = startAnatomy({ cfg: cfgOf(), eff, cwd, projectId: "p1", memory: null });
    assert.deepEqual([memOf(notReady).tokens, notReady.memory.knows], [0, { memories: 0, dossier: null }]);
  });

  test("a coding agent's draft weighs what memory hands it through its own channels — the briefing, the recall, memory's tools — never the recall tool", () => {
    const eff = { model: { name: "coder-one" } };
    const a = startAnatomy({ cfg: cfgOf(), eff, cwd, projectId: "p1", memory });
    assert.equal(a.engine.kind, "agent");
    assert.deepEqual(memOf(a), { id: "memory", tokens: 1200 + 300, upTo: true });
    assert.ok(a.tools.memory > 0, "memory's tools reach it over Filament's MCP server");
    assert.equal(a.tools.recall, false, "the recall tool reads what only the loop leaves");
    assert.equal("captureOnly" in a.memory, false);
  });

  // (fails before: no — a guard the mutation pass asked for: no draft had the task graph on)
  test("a draft weighs the task graph its first turn sends — always on: the tasks tool and the prompt's section", () => {
    const a = startAnatomy({ cfg: cfgOf(), eff: { model: { name: "brain-model" } }, cwd, projectId: "p1", memory: null });
    assert.ok(a.tools.offered.includes("tasks"), a.tools.offered.join(", "));
    const prompt = a.parts.find((/** @type {any} */ p) => p.id === "prompt")?.tokens ?? 0;
    assert.ok(prompt > estimateTokens(PROMPT.graph), "the prompt part weighs the graph's section");
  });

  // (fails before: yes — the owner's look of 10-24: the board said none of Filament's switches reach a coding agent,
  // while the browser, pictures, artifacts, the Space, teams and flows ride its MCP server on the chat's own switches)
  test("a coding agent's draft: what Filament hands it on the chat's own switches, and whose hands do its files", () => {
    const coder = (/** @type {any} */ eff, cfg = cfgOf(), projectId = "p1") => startAnatomy({ cfg, eff: { model: { name: "coder-one" }, ...eff }, cwd, projectId, memory: null }).tools;
    const all = coder({ plugins: { browser: true } });
    assert.deepEqual([all.adds, all.hands], [["browser", "show_visual", "artifact", "space", "team", "flow", "thread"], "own"]);
    assert.deepEqual(coder({ plugins: { browser: true } }, cfgOf((c) => { c.experimental.teams = false; })).adds, ["browser", "show_visual", "artifact", "space", "flow", "thread"], "(fails before: yes) no team tool while Settings › Experimental's Teams switch is off");
    assert.deepEqual(coder({ plugins: { browser: true }, loop: { tools: { show_visual: false, team: false, browser: false } } }).adds, ["artifact", "space", "flow", "thread"], "each on its own switch");
    assert.deepEqual(coder({}).adds, ["show_visual", "artifact", "space", "team", "flow", "thread"], "the browser on its plugin's switch");
    assert.deepEqual(coder({}, cfgOf(), "none").adds, ["show_visual", "artifact", "team", "flow", "thread"], "no project, no Space");
    const native = cfgOf((c) => { c.upstreams[1] = { ...c.upstreams[1], id: "claude-code", acp: { command: "claude-agent-acp", clientBridge: "native" } }; c.routes[1].upstream = "claude-code"; });
    assert.equal(coder({}, native).hands, "native", "Claude Code switches its own off for Filament's");
    const cannot = cfgOf((c) => { c.upstreams[1] = { ...c.upstreams[1], acp: { clientBridge: "native" } }; });
    assert.equal(coder({}, cannot).hands, "own", "an agent that cannot keeps its own: native behaves as full");
    assert.equal(startAnatomy({ cfg: cfgOf(), eff: { model: { name: "brain-model" } }, cwd, projectId: "p1", memory: null }).tools.adds, undefined, "the loop's tools are its own switches");
  });

  test("the reader behind delegate_read is offered under the loop's own rule: a model the loop would refuse leaves it out", () => {
    const eff = { model: { name: "brain-model" } };
    const offered = (/** @type {string} */ reader, /** @type {any} */ problem = () => null) =>
      startAnatomy({ cfg: cfgOf((c) => { c.agentLoop.readerModel = reader; }), eff, cwd, projectId: "p1", memory: null, modelProblem: problem }).tools.offered.includes("delegate_read");
    assert.equal(offered(""), false, "no reader, no tool");
    assert.equal(offered("brain-small"), true);
    assert.equal(offered("brain-small", () => "a coding agent"), false, "a refused reader");
    assert.equal(offered("agent/brain-small"), false, "the loop itself is never its own reader");
  });
});

test("the board's answer reads files and never writes one (NT-D11)", () => {
  const src = readFileSync("src/app/sessions/draft-start.js", "utf8");
  assert.ok(!/writeFileSync|mkdirSync|rmSync|appendFileSync|renameSync/.test(src));
});
