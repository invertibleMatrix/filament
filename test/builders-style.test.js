// @ts-check
// "Teams, improved and kept" (11-03), the Builders team: the four teams that built — 10x Engineer, Methodical, Architect
// and One-Shot — are one team, Builders, and the owner's of 11-04: one lead that leads one way, its card's words saying
// how — the shortest path that works, planned and checked — the same words on every run. A team may name a check: one
// command line given to every member that changes files as a brief's check is, and told to its lead. What a person kept
// that names one of the four keys is never converted: it falls back as a team that is gone does, and says in words that
// Builders does that team's work. What a person kept that names how a lead led — a session's engine.teamStyle, a team's
// `style` in teams.json — is read past: the team leads as its card says.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED_TEAMS, createTeamStore } from "../src/services/teams.js";
import { SHIPPED_CARDS, createAgentCardStore } from "../src/services/agent-cards.js";
import { checkCommandsProblem, uncheckedWords } from "../src/app/agent/grants.js";
import { engine } from "../src/app/pipeline/stages/engine.js";
import { engineProblem } from "../src/app/engine.js";
import { BESIDE_TOOL, besideCall } from "../src/app/agent/beside-tool.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { startAnatomy } from "../src/app/sessions/draft-start.js";
import { agentTeamsOf, applyPatch, readLayer } from "../src/services/session-settings.js";
import { checkFlow, flowOf } from "../src/core/flow.js";
import { createSavedFlows } from "../src/services/saved-flows.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { defaultConfig } from "../src/config.js";
import { BRIEF, leadOf, teamStore, watched } from "./helpers/team.js";
import { membersOf } from "./helpers/roster.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** How the Builders lead leads, the second paragraph of its card's words (the owner's of 11-04). */
const HOW_WORDS =
  "How you lead: the shortest path that works, planned and checked. Before any order goes out, write the plan: the few changes that make the goal true, in order, each with the check that proves it done, and where two parts meet, the interface between them and what neither may change. Anything the goal does not need waits: no refactors, options or polish along the way. Measure instead of guessing: a Scout's numbers before a design choice. Tasks that touch different files and need nothing of each other go out at once, each with its own files; a task that builds on another waits until that one passes its check. When every task is in, order one review of the whole: one name for one idea, every interface used as the plan says.";
/** The four paragraphs a Builders lead was handed one of, as the four teams' Leads said them: none is a lead's words. */
const OLD_WAYS = Object.freeze([
  "You lead like a 10x engineer: the shortest path that works, measured.",
  "You lead methodically: a plan first, then one verified step at a time.",
  "You lead as an architect: boundaries first.",
  "You lead in one shot: split the whole goal up front into tasks that do not depend on each other, and launch them all at once.",
]);
/** What a lead reads of its team's check `c`. @param {string} c */
const CHECK_WORDS = (c) =>
  `Your team's check is \`${c}\`. Ask for it in the check of each brief you give a worker that changes files: Filament gives it to every such worker, which may run it in its own worktree without asking, and runs it itself when that worker reports, before you hear of it.`;
/** The four teams that built, each with its name. */
const FOLDED = Object.freeze([
  ["10x-engineer", "10x Engineer"],
  ["methodical", "Methodical"],
  ["architect", "Architect"],
  ["one-shot", "One-Shot"],
]);
/** @param {string} name */
const foldedSays = (name) => `Builders does ${name}'s work: pick Builders`;
/** What a team's save says of a field it does not hold. @param {string} k */
const UNKNOWN_FIELD = (k) =>
  `unknown field \`${k}\`: a team has a name, a lead, members, the models its workers run on, its lead's models, readOnly, what a main agent's fire does (fired) and its check`;

/** A folder of its own, removed after the run. */
const made = /** @type {string[]} */ ([]);
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-builders-"));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// (fails before: yes — four teams built, each led by a Lead of its own: 10x Engineer, Methodical, Architect, One-Shot)
describe("one Builders team", () => {
  test("ships beside BugHunters, led by its own Lead, its crew the four seats with one set of lines, and no check", () => {
    assert.deepEqual(Object.keys(SHIPPED_TEAMS), ["builders", "bughunters"]);
    const leads = Object.entries(SHIPPED_CARDS).filter(([, c]) => "partOf" in c && c.partOf).map(([tag, c]) => [tag, c.name, /** @type {any} */ (c).partOf]);
    assert.deepEqual(leads, [["buildlead", "Builders", "builders"], ["huntlead", "BugHunters", "bughunters"]]);
    const cards = createAgentCardStore({ dataDir: null });
    for (const tag of ["tenx", "methodical", "architect", "oneshot"]) assert.equal(cards.find(tag), null, `@${tag} ships no more`);
    const store = teamStore();
    const t = /** @type {any} */ (store.find("builders"));
    assert.deepEqual([t.key, t.name, t.lead, t.check, t.shipped, "style" in t], ["builders", "Builders", { tag: "buildlead", name: "Builders" }, null, true, false]);
    assert.deepEqual(t.members.map((/** @type {any} */ m) => [m.tag, m.card ?? null, m.name, m.may, m.line]), [
      ["scout", "reviewer", "Scout", "read", "Report what you read as facts with their file and line, and say plainly what you could not confirm."],
      ["builder", null, "Builder", "edit", "Make the smallest change that meets your acceptance check: no refactors, renames or cleanups along the way. Before you report, run that check yourself where you can, and say what it printed."],
      ["tester", "builder", "Tester", "edit", "Run the acceptance check exactly as written and report its real output: a pass or a failure as printed, never a summary of one."],
      ["reviewer", null, "Reviewer", "read", "Check the change against its acceptance check: what it claims, what the diff shows with file and line, and what is missing."],
    ]);
    for (const [key] of FOLDED) assert.equal(store.find(key), null, `${key} is no team`);
    // Its lead's first paragraph: facts with file and line, the check run and its real output, the smallest change.
    const thinks = String(SHIPPED_CARDS.buildlead.thinks);
    for (const w of ["the file and line", "the check it ran and that check's real output", "the smallest change that meets that check"]) assert.ok(thinks.includes(w), w);
  });
});

// (fails before: yes — its card's words were one paragraph, and the team handed its lead a style's paragraph after them:
// Methodical's, where nothing chose another)
describe("the Builders lead leads one way", () => {
  test("its card's second paragraph says how, and the team hands its lead its card's words alone: no other way's paragraph", () => {
    const thinks = String(SHIPPED_CARDS.buildlead.thinks);
    assert.deepEqual(thinks.split("\n\n").slice(1), [HOW_WORDS], "the one way, its second paragraph");
    assert.equal(SHIPPED_CARDS.buildlead.goodFor, "Builds it with its workers: planned, run in parallel where it can, each claim checked");
    const persona = String(teamStore().find("builders")?.persona);
    assert.equal(persona, thinks, "its lead's words are its card's");
    for (const w of OLD_WAYS) assert.ok(!persona.includes(w), w);
  });

  test("a save that names a style is refused as any field a team does not hold; a copy leads as its lead's card says", () => {
    const store = teamStore();
    assert.throws(() => store.update("builders", { style: "one-shot" }), { status: 400, message: UNKNOWN_FIELD("style") });
    assert.throws(() => store.create({ name: "Mine", lead: "builder", members: [{ tag: "reviewer" }], style: "architect" }), { status: 400, message: UNKNOWN_FIELD("style") });
    const copy = store.create({ from: "builders" });
    assert.deepEqual([copy.name, copy.lead.tag, copy.persona], ["Builders copy", "buildlead", SHIPPED_CARDS.buildlead.thinks]);
  });
});

// (fails before: yes — teams.json's style was a team's own, and its lead led in it: the architect's paragraph after its words)
describe("a teams.json kept with a style", () => {
  test("a team of yours that names one loads and leads as its lead's card says; a shipped team's style is skipped and named, the rest of it kept", () => {
    const dir = folder();
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "builder", members: [{ tag: "reviewer", line: "" }], style: "architect" } }, shipped: { builders: { style: "10x", models: ["m-strong"] } } }));
    /** @type {string[]} */
    const logs = [];
    const store = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => logs.push(m) });
    const mine = /** @type {any} */ (store.find("mine"));
    assert.deepEqual([mine?.name, mine?.lead.tag, mine?.persona, "style" in mine], ["Mine", "builder", SHIPPED_CARDS.builder.thinks, false], "loaded, its lead's words alone");
    assert.deepEqual(store.held(), [], "held for nothing");
    const builders = /** @type {any} */ (store.find("builders"));
    assert.deepEqual([builders.models, builders.persona], [["m-strong"], SHIPPED_CARDS.buildlead.thinks], "what else was set on it is kept");
    assert.match(logs.join("\n"), /teams: 1 team in teams\.json could not be read and was skipped: shipped builders \(style\)/);
    // The next save writes the team as the store holds it: no style.
    store.update("mine", { check: "node --version" });
    const file = JSON.parse(readFileSync(join(dir, "teams.json"), "utf8"));
    assert.deepEqual([file.teams.mine.check, "style" in file.teams.mine, file.shipped?.builders?.style], ["node --version", false, undefined]);
  });
});

// (fails before: yes — engine.teamStyle was a knob: the engine handed the lead that style, the board weighed it)
describe("a session's settings kept with engine.teamStyle", () => {
  test("its layer reads as if it held none: the engine hands Builders' lead the team alone, the board weighs the team alone", async () => {
    const LAYER = { engine: { mode: "team", team: "builders", teamStyle: "10x" } };
    assert.deepEqual(readLayer(LAYER, "session"), { "engine.mode": "team", "engine.team": "builders" });
    const teams = teamStore();
    const cfg = { ...defaultConfig(), experimental: { ...defaultConfig().experimental, teams: true }, agentLoop: { ...defaultConfig().agentLoop, enabled: true }, upstreams: [{ id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true }], routes: [{ match: "m-*", upstream: "u", upstreamModel: "{model}", enabled: true }] };
    /** The agent a harness turn on m-1 resolves to, under these engine settings. @param {any} e */
    const agentOf = async (e) => {
      /** @type {any} */
      const ctx = { memory: { sit: { settings: { engine: e }, composed: true } }, pre: { api: "session" }, house: false, body: { model: "m-1" }, agent: null };
      await engine(ctx, /** @type {any} */ ({ config: () => cfg, memory: {}, teams }));
      return ctx.agent;
    };
    assert.deepEqual(await agentOf(LAYER.engine), { model: "m-1", team: "builders" });
    assert.deepEqual(await agentOf({ mode: "team", team: "bughunters", teamStyle: "10x" }), { model: "m-1", team: "bughunters" });
    const led = startAnatomy({ cfg, eff: { model: { name: "m-1" }, engine: LAYER.engine }, cwd: folder(), projectId: "p1", teams });
    assert.deepEqual([led.who.team, "style" in led.who, "styles" in led.who], ["builders", false, false]);
    // A write to such a layer keeps what it does not name; one that names the style is refused, as any setting that is none.
    const moved = applyPatch(LAYER, { patch: { engine: { team: "bughunters" } } });
    assert.deepEqual([moved.errors, moved.changes.map((c) => [c.path, c.to])], [[], [["engine.team", "bughunters"]]]);
    assert.deepEqual(applyPatch(LAYER, { patch: { engine: { teamStyle: "one-shot" } } }).errors, ['unknown setting "engine.teamStyle"']);
    assert.deepEqual(applyPatch(LAYER, { unset: ["engine.teamStyle"] }).errors, ['unknown setting "engine.teamStyle"']);
  });
});

// (fails before: yes — the team tool took a style, said it on its fire, and its status named each team's own)
describe("the team tool names no style", () => {
  test("its send takes the team, the ask and the models; its status names each team as it is named", async () => {
    assert.equal(/** @type {any} */ (BESIDE_TOOL.input_schema.properties).style, undefined);
    assert.doesNotMatch(JSON.stringify(BESIDE_TOOL), /style/i);
    /** @type {any[]} */
    const fired = [];
    const at = {
      chain: "c1",
      fire: async (/** @type {any} */ input) => {
        fired.push(input);
        return /** @type {any} */ ({ team: { key: "builders", name: "Builders" }, verify: false, notify: false });
      },
      list: () => [],
      teams: () => [{ key: "builders", name: "Builders", line: "Builds it", mine: true }, { key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs", mine: true }],
    };
    // A call that names a style anyway, as a model's habit might: the send goes as one that names none.
    const r = await besideCall({ action: "send", team: "builders", ask: "Build the parser", style: "10x" }, at);
    assert.deepEqual([fired[0], r.ok && r.text.startsWith("Builders started beside this chat.")], [{ team: "builders", ask: "Build the parser" }, true], JSON.stringify(r));
    const s = /** @type {any} */ (await besideCall({ action: "status" }, at));
    assert.match(s.text, /^- `builders` Builders — Builds it$/m);
    assert.match(s.text, /^- `bug-hunter` Bug Hunter — Finds bugs$/m);
  });
});

// (fails before: yes — a team named no check: its builders ran what their briefs gave, and its lead heard of none)
describe("the team's check", () => {
  test("one command line, judged as a task graph's check is, told to its lead", () => {
    const store = teamStore();
    const t = store.update("builders", { check: "node --version" });
    assert.equal(t.check, "node --version");
    assert.equal(t.persona, `${SHIPPED_CARDS.buildlead.thinks}\n\n${CHECK_WORDS("node --version")}`, "its lead is told it, after its words");
    assert.throws(() => store.update("builders", { check: "npm test\nnpm run lint" }), { status: 400, message: "check is one command line, up to 400 characters, that proves a worker's change sound — or null for none." });
    assert.equal(store.update("builders", { check: null }).check, null, "put back as it ships: none");
    // Its command judged as a task graph's check is (grants.js), handed to the store as server.js hands it.
    const judged = createTeamStore({ dataDir: null, cards: createAgentCardStore({ dataDir: null }), checkProblem: (/** @type {string} */ c) => checkCommandsProblem([c]) });
    assert.throws(() => judged.update("builders", { check: "npm install left-pad" }), { status: 400, message: /^The team's check cannot be kept: check's `npm install left-pad` installs packages/ });
    assert.throws(() => judged.update("builders", { check: "npm test; npm run lint" }), { status: 400, message: /joins its parts with ;/ });
    assert.equal(judged.update("builders", { check: "npm test && npm run lint" }).check, "npm test && npm run lint");
  });

  test("given to each member that changes files as its brief's check is, never to one that reads; one the session cannot run is said to the lead", async () => {
    const store = teamStore();
    const team = /** @type {any} */ (store.update("builders", { check: "node --version" }));
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 8 }] } });
    const l = leadOf(w.registry, w.dir);
    const built = await l.tools.agent({ ...l.call({ ...BRIEF, role: "builder" }), team });
    assert.equal(built.ok, true, built.text);
    const tested = await l.tools.agent({ ...l.call({ ...BRIEF, role: "tester", description: "Test the parser", check: ["node -e 1"] }), team });
    const scouted = await l.tools.agent({ ...l.call({ ...BRIEF, role: "scout", description: "Map the parser" }), team });
    // A session where Filament runs no check: the worker goes without it, and its lead hears why.
    const ro = await l.tools.agent({ ...l.call({ ...BRIEF, role: "builder", description: "Fix it read-only" }), mode: "read-only", team });
    assert.equal(ro.ok, true, ro.text);
    const runs = [await w.run(1), await w.run(2), await w.run(3), await w.run(4)];
    for (const r of runs) r.attach();
    /** What a launch's run was handed of its team. @param {any} r */
    const teamOf = async (r) => {
      await until(() => w.registry.hostOf(String(r.agentId)), "its run");
      return /** @type {any} */ (w.registry.hostOf(String(r.agentId))).team;
    };
    assert.deepEqual([(await teamOf(built)).check, (await teamOf(tested)).check, (await teamOf(scouted)).check, (await teamOf(ro)).check], ["node --version", "node --version", undefined, undefined], "each member that changes files; none that reads, nor where the session runs no check");
    // Its folder shares the developer's — no worktree — so the check grants nothing there, and the launch says so, as a brief's.
    assert.match(built.text, /check does nothing here: it works in your folder, not a worktree of its own/);
    assert.ok(!/check does nothing here/.test(String(scouted.text)), "a member that reads was given no check");
    assert.match(ro.text, /Your team's check `node --version` is not given to it: this session is read-only, so Filament runs no check in it\. Keep working/);
    for (const r of runs) r.finish({ status: "done", report: "Done." });
    for (const r of [built, tested, scouted, ro]) await w.registry.settled(String(r.agentId));
  });
});

// (fails before: yes — a key that was a team was "no team", with no word of the team that does its work)
describe("what a person kept that names one of the four", () => {
  test("a session's engine.team says it on its turn: no team, and that Builders does its work", () => {
    const cfg = { agentLoop: { enabled: true }, experimental: { teams: true } };
    const teams = teamStore();
    for (const [key, name] of FOLDED)
      assert.equal(engineProblem({ mode: "team", team: key }, cfg, teams), `engine.team names \`${key}\`, which is no team — ${foldedSays(name)} (/team lists them)`);
    assert.equal(engineProblem({ mode: "team", team: "nobody" }, cfg, teams), "engine.team names `nobody`, which is no team (/team lists them)", "any other name as it was said");
    const draft = startAnatomy({ cfg: { ...defaultConfig(), experimental: { ...defaultConfig().experimental, teams: true }, agentLoop: { ...defaultConfig().agentLoop, enabled: true }, upstreams: [{ id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true }], routes: [{ match: "m-*", upstream: "u", upstreamModel: "{model}", enabled: true }] }, eff: { model: { name: "m-1" }, engine: { mode: "team", team: "architect" } }, cwd: folder(), projectId: "p1", teams });
    assert.equal(draft.who.problem, `it names the team "architect", and there is no such team — ${foldedSays("Architect")}`);
  });

  test("teams.json's shipped entries for the four are skipped and named in the log; a team of yours led by one of their Leads is held, saying so", () => {
    const dir = folder();
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "tenx", members: [{ tag: "builder", line: "" }] } }, shipped: { methodical: { models: ["m-cheap"] }, "10x-engineer": { name: "Fast" }, builders: { models: ["m-strong"] } } }));
    /** @type {string[]} */
    const logs = [];
    const store = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => logs.push(m) });
    assert.deepEqual(store.find("builders")?.models, ["m-strong"], "a team that ships keeps what was set on it");
    assert.equal(store.find("methodical"), null, "nothing read as Builders");
    assert.match(logs.join("\n"), new RegExp(`skipped: shipped methodical \\(${foldedSays("Methodical")}\\), shipped 10x-engineer \\(${foldedSays("10x Engineer")}\\)`));
    assert.deepEqual(store.held(), [{ key: "mine", name: "Mine", why: "Builders does 10x Engineer's work: make another card the lead, or pick Builders in this team's place" }]);
  });

  test("a saved flow's team box for one of the four loads as kept, and needs a team in the same words", () => {
    const dir = folder();
    const steps = [{ why: "First", boxes: [{ id: "plan", kind: "agent", agent: "product", words: "Plan it", needs: [] }] }, { why: "Then", boxes: [{ id: "build", kind: "team", agent: "architect", words: "Build it", needs: ["plan"] }] }];
    writeFileSync(join(dir, "flows-saved.json"), JSON.stringify({ version: 1, flows: { old: { name: "Old", steps, at: 1 } } }));
    const kept = /** @type {any} */ (createSavedFlows({ dataDir: dir }).find("old"));
    assert.equal(kept.steps[1].boxes[0].agent, "architect", "kept as it was saved");
    const teams = teamStore().list().map((t) => ({ key: t.key, name: t.name, readOnly: t.readOnly }));
    const cards = createAgentCardStore({ dataDir: null }).list().filter((c) => !c.partOf).map((c) => ({ tag: c.tag, name: c.name }));
    const roster = { cards, teams };
    const flow = flowOf({ title: kept.name, goal: "Ship it", steps: kept.steps }, roster, { id: "f1", chainId: "c1", at: 1 });
    assert.equal(checkFlow(flow, roster), `the box for "architect" needs a team — ${foldedSays("Architect")}`);
    // The flow that ships builds with Builders.
    const shipped = /** @type {any} */ (createSavedFlows({ dataDir: null }).list().find((f) => f.shipped));
    assert.ok(JSON.stringify(shipped.steps).includes('"kind":"team","agent":"builders"'), JSON.stringify(shipped.steps));
  });

  test("the teams a chat's agent may start: a list naming only one of the four is the default again; one beside it drops it", () => {
    const teams = teamStore();
    const known = (/** @type {string} */ k) => teams.find(k)?.key ?? null;
    assert.deepEqual(agentTeamsOf({ subagents: { teams: ["methodical"] } }, known), ["bughunters"]);
    assert.deepEqual(agentTeamsOf({ subagents: { teams: ["one-shot", "builders"] } }, known), ["builders"]);
  });

  // (fails before: no — a guard: a team chat's card and a kept worker read as they were kept already; nothing of either
  // is converted, and so it stays)
  test("a team chat and a worker kept from one of the four load as kept, their threads readable", async () => {
    // A team beside a chat, fired as Methodical: its card names its team as it was, and its result reads.
    const chain = { id: "t1", kind: "team", model: "m-1", title: "Methodical on the parser", meta: { beside: { team: "methodical", name: "Methodical", ask: "Fix the parser", at: 5, firedBy: "you" } } };
    const beside = createTeamsBeside(/** @type {any} */ ({
      archive: () => ({ getChain: (/** @type {string} */ id) => (id === "t1" ? chain : id === "main" ? { id: "main", kind: "chat", meta: {} } : null), mainOf: () => "main", besideOf: () => [chain.id], chainHead: () => chain }),
      sessions: { besideFacts: () => ({ busy: false, asking: null, last: { text: "Fixed in parse.js.", final: true, n: 1, endedAt: 9 } }), settingsOf: () => ({ effective: { engine: { mode: "team", team: "methodical" } } }) },
      teams: teamStore(),
      registry: () => ({ list: () => [] }),
      postTurn: async () => ({ status: 200, body: {} }),
      reach: { busy: () => false, post: async () => ({ status: 200, body: {} }), steer: () => ({ ok: true }) },
      remove: async () => {},
      events: { publish: () => {} },
    }));
    const row = /** @type {any} */ (beside.row("t1"));
    assert.deepEqual([row.team, row.result?.text, row.state], [{ key: "methodical", name: "Methodical" }, "Fixed in parse.js.", "done"]);
    // A fire of one of the four says that Builders does its work: its main chat is there, so the refusal is the team's.
    // (fails before: yes — the review of 11-03: the fake's main chat was missing, so its 404 was "no such session")
    await assert.rejects(() => beside.fire("main", { team: "architect", ask: "x" }), { status: 404, message: `no team answers to "architect": ${foldedSays("Architect")}` });
    // A worker of One-Shot's, kept from before: it loads after a restart, its team as it was and its thread as it ran.
    const root = folder();
    /** @type {any[]} */
    const kept = [];
    /** @param {any} [context] */
    const registryOf = (context = {}) => {
      /** @type {ReturnType<typeof createSubagentRegistry>} */
      const registry = createSubagentRegistry({
        config: () => ({ agentLoop: {} }),
        log: () => {},
        events: { publish: () => {} },
        runs: null,
        now: Date.now,
        context: {
          settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
          session: () => ({ cwd: root, model: "m", projectId: "p1" }),
          view: async () => ({ text: "", turns: 1 }),
          brief: async () => null,
          modelProblem: () => null,
          mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
          saveThread: (/** @type {string} */ _c, /** @type {any} */ t) => void kept.push(structuredClone(t)),
          ...context,
        },
        call: async ({ body, headers = {} }) => {
          const id = headers["x-filament-subagent"];
          registry.attach(id, "run-1");
          registry.finish(id, { status: "done", error: null, report: "Wrote the slice.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Wrote the slice." }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: ["run-1"] });
          return { ok: true, status: 200, json: { content: [{ type: "text", text: "Wrote the slice." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: "run-1", upstream: "m", retryAfter: null, shouldRetry: null };
        },
      });
      return registry;
    };
    const first = registryOf();
    const r = /** @type {any} */ (first.launch({ origin: "owner", chainId: "c1", prompt: "write the slice", description: "Write the slice", worker: "reviewer", may: "read", background: true }));
    assert.ok(r.ok, JSON.stringify(r));
    await r.done;
    const thread = { ...structuredClone(kept.at(-1)), team: { key: "one-shot", name: "One-Shot", role: "builder", place: "builder", words: "Write and run the tests for your own slice; other workers own the rest." } };
    const again = registryOf({ loadThreads: () => [thread] });
    const back = /** @type {any} */ (again.list("c1").find((s) => s.id === r.id));
    assert.deepEqual([back?.team?.key, back?.team?.name, back?.status], ["one-shot", "One-Shot", "done"], "it loads as it was kept");
    assert.equal(again.detail(r.id)?.exchanges[0].report, "Wrote the slice.", "its thread reads as it was");
  });
});

// ---------------------------------------------------------------------------------------------------
// A graph task's worker on a team with a check
// ---------------------------------------------------------------------------------------------------

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
/** A folder holding a repository of one commit. */
const repoOf = () => {
  const dir = folder();
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
const DONE = { status: "done", did: "Wrote it.", met: true, evidence: "it ran", left: "" };
/**
 * A registry over `dir`: each worker's run ends with the next report of `reports` (done, naming no command, where none
 * is left); each request, with its sub-agent as the registry holds it then, and each graph task's end kept.
 * @param {string} dir
 */
const registryOver = (dir) => {
  /** @type {any[]} */
  const ends = [];
  /** @type {any[]} */
  const reports = [];
  /** @type {any[]} */
  const posts = [];
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: /** @type {any[]} */ ([]) } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: (/** @type {any} */ e) => ends.push(e),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      posts.push({ body, host: registry.hostOf(id) });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      registry.finish(id, { status: "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: reports.shift() || DONE });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, ends, reports, posts, doc };
};
/**
 * Builders' builder on a graph task t2, launched as the runner launches one: its team's check `teamCheck`, its task's
 * own `check` or none. @param {ReturnType<typeof registryOver>} r @param {string} dir @param {string} teamCheck
 * @param {string[]} [check] @returns {any}
 */
const teamTask = (r, dir, teamCheck, check = []) =>
  r.registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t2", description: "t2: Write it", team: { key: "builders", name: "Builders", role: "builder", place: "builder", words: "", check: teamCheck }, background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, task: { id: "t2", review: false }, requestId: "turn-1", files: { writes: ["a.txt"] }, ...(check.length ? { grants: { check, mayRun: [] } } : {}) });
const READ_ONLY = "this session is read-only, so Filament runs no check in it";

describe("a graph task's worker on a team with a check", () => {
  // (fails before: yes — its task's check held its team's, so a send-back, which puts its task's check as it stands now,
  // took its team's away: Filament ran the planner's alone)
  test("sent back, it keeps its team's check beside its task's as it stands now: Filament runs both on each report", async () => {
    const dir = repoOf();
    const r = registryOver(dir);
    const l = teamTask(r, dir, "node -e 0", ["node -e 1"]);
    assert.ok(l.ok, JSON.stringify(l));
    await until(() => r.ends.length === 1, "the first end", { timeoutMs: 60_000 });
    assert.deepEqual(r.ends[0].task.check.commands, ["node -e 1", "node -e 0"]);
    const back = r.registry.resumeTask(l.id, { chainId: "c1", prompt: "GO ON", requestId: "turn-2", check: ["node -e 2"] });
    assert.ok(back.ok, JSON.stringify(back));
    await until(() => r.ends.length === 2, "the second end", { timeoutMs: 60_000 });
    assert.deepEqual([r.ends[1].task.check.commands, r.posts[1].host.grants?.check], [["node -e 2", "node -e 0"], ["node -e 2", "node -e 0"]], "the planner's change, and its team's");
    // Its task has none at this point: its team's still runs.
    r.registry.resumeTask(l.id, { chainId: "c1", prompt: "GO ON AGAIN", requestId: "turn-3", check: [] });
    await until(() => r.ends.length === 3, "the third end", { timeoutMs: 60_000 });
    assert.deepEqual(r.ends[2].task.check.commands, ["node -e 0"]);
  });

  // (fails before: yes — its team's check counted as its task's, so the commands its report named were never taken)
  test("its task has no check of its own: the commands its report names are taken, and Filament runs them with its team's", async () => {
    const dir = repoOf();
    const r = registryOver(dir);
    r.reports.push({ ...DONE, checked: ["node -e 3"] });
    assert.ok(teamTask(r, dir, "node -e 0").ok);
    await until(() => r.ends.length === 1, "its end", { timeoutMs: 60_000 });
    assert.deepEqual([r.ends[0].task.taken, r.ends[0].task.check.commands], [["node -e 3"], ["node -e 3", "node -e 0"]]);
  });

  // (fails before: yes — a graph task's worker took its team's check unvetted, and its launch said nothing of it)
  test("a session that does not let Filament run its team's check: its worker goes without it, and its launch says why", async () => {
    const dir = repoOf();
    const r = registryOver(dir);
    r.doc.loop.permissions = "read-only";
    const l = teamTask(r, dir, "node -e 0");
    assert.deepEqual([l.ok, l.unchecked], [true, { check: "node -e 0", why: READ_ONLY }]);
    await until(() => r.ends.length === 1, "its end", { timeoutMs: 60_000 });
    assert.deepEqual([r.posts[0].host.grants?.check, r.ends[0].task.check], [undefined, null], "nothing granted, nothing to run");
    assert.doesNotMatch(JSON.stringify(r.posts[0].body.messages[0]), /your team lets you run|node -e 0/);
    // A rule of the session's that refuses it, as a graph task's check is refused.
    const ruled = registryOver(dir);
    ruled.doc.loop.rules = [{ tool: "bash", pattern: "node -e 0", verdict: "deny" }];
    const d = teamTask(ruled, dir, "node -e 0", ["node -e 1"]);
    assert.equal(d.unchecked?.why, "this session's rule bash(node -e 0) deny refuses it");
    await until(() => ruled.ends.length === 1, "its end", { timeoutMs: 60_000 });
    assert.deepEqual(ruled.ends[0].task.check.commands, ["node -e 1"], "its task's own runs");
  });

  // (fails before: yes — its lead read a planner's words: "Check's `node -e 0` is refused by this session's rule …")
  test("why a member went without its team's check reads as a sentence: a rule that refuses it, a rule that asks first, the folder it names", async () => {
    const dir = repoOf();
    const r = registryOver(dir);
    /** The words its lead reads of a launch in a session with `rules`, its team's check `check`. @param {any[]} rules @param {string} [check] */
    const told = async (rules, check = "node -e 0") => {
      r.doc.loop.rules = rules;
      const ended = r.ends.length;
      const l = teamTask(r, dir, check);
      await until(() => r.ends.length > ended, "its end", { timeoutMs: 60_000 });
      return uncheckedWords(l.unchecked);
    };
    assert.equal(await told([{ tool: "bash", pattern: "node -e 0", verdict: "deny" }]), "Your team's check `node -e 0` is not given to it: this session's rule bash(node -e 0) deny refuses it.");
    assert.equal(await told([{ tool: "bash", pattern: "node -e 0", verdict: "ask" }]), "Your team's check `node -e 0` is not given to it: this session's rule bash(node -e 0) ask asks first, and Filament runs a check without asking.");
    const named = `node ${join(dir, "a.js")}`;
    assert.equal(await told([], named), `Your team's check \`${named}\` is not given to it: it names your folder (${dir}), and Filament runs it in a copy of the folder, where the same files are at the same paths.`);
    // A planner's words for a graph task's check stay its own.
    r.doc.loop.rules = [{ tool: "bash", pattern: "node -e 0", verdict: "deny" }];
    assert.equal(r.registry.checkProblem("c1", ["node -e 0"]), "check's `node -e 0` is refused by this session's rule bash(node -e 0) deny: leave it out");
  });

  // (fails before: yes — the runner said nothing of a team's check its worker went without)
  test("the runner tells the lead which worker of its graph went without its team's check, and why", () => {
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    /** @type {any[]} */
    const launches = [];
    /** @type {any[]} */
    const told = [];
    const registry = {
      launch: (/** @type {any} */ spec) => (launches.push(spec), { ok: true, id: `sa-${launches.length}`, done: new Promise(() => {}), ...(spec.team?.check ? { unchecked: { check: spec.team.check, why: READ_ONLY } } : {}) }),
      resumeTask: () => ({ ok: false, error: "no" }),
      slots: () => 4,
      tell: (/** @type {string} */ _c, /** @type {any} */ d) => told.push(d),
      stop: () => ({ ok: true }),
      resumable: () => null,
      checkProblem: () => null,
      guard: () => {},
    };
    const archive = {
      /** @param {string} id @param {readonly string[]} keys */
      metaOf: (id, keys) => {
        const c = chains.get(id);
        return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
      },
      mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => {
        const c = chains.get(id);
        c.meta = structuredClone({ ...c.meta, ...patch });
        return c.meta;
      },
      openGraphs: () => [],
    };
    const crew = membersOf();
    let t = 1000;
    const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => crew, log: () => {}, now: () => t++ });
    const add = { action: "add", goal: "Ship", tasks: [
      { id: "t1", name: "Map it", by: "scout", goal: "Know a.txt", steps: ["Read a.txt"], acceptance: "a.txt is known" },
      { id: "t2", name: "Write it", by: "builder", writes: ["a.txt"], goal: "a.txt says two", steps: ["Write it"], acceptance: "a.txt says two" },
    ] };
    assert.ok(runner.apply("c1", add, { crew }).ok);
    runner.attach("c1", { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: { key: "builders", name: "Builders", members: crew, check: "npm test" } });
    assert.deepEqual(launches.map((s) => s.team.check ?? null), [null, "npm test"], "its builder's launch names the check; its scout's none");
    assert.deepEqual(told.map((d) => d.text).filter((s) => s.includes("check")), ["[Filament: Your team's check `npm test` is not given to t2's builder sa-2: this session is read-only, so Filament runs no check in it.]"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// A real turn: a session led by Builders, with the team's check
// ---------------------------------------------------------------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let repo;
/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** What the conversation holds from the newest typed message on. @param {any[]} messages */
const turnSoFar = (messages) => {
  let at = 0;
  messages.forEach((m, i) => {
    if (m?.role === "user" && /TURN: /.test(textOf(m.content))) at = i;
  });
  return JSON.stringify(messages.slice(at));
};
/** A lead's system prompt's block of its team: its team's name and its lead's words, up to how a lead works. @param {string} sys */
const teamPart = (sys) => sys.slice(sys.indexOf(String(PROMPT.headTeam)), sys.indexOf(String(PROMPT.headLead)));

describe("a session Builders leads", () => {
  before(async () => {
    repo = folder();
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const system = sysOf(b);
      const now = turnSoFar(b.messages || []);
      const model = String(b.model || "");
      const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
      const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
      const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
      if (system.includes(String(PROMPT.workerRole))) return say("BUILT: a.txt reads one.");
      if (system.includes(String(PROMPT.leadRole))) {
        if (now.includes("TURN: build it")) {
          if (/\[Filament: your builder sa_[0-9a-f]{8}/.test(now)) return say("LEAD SAW THE BUILDER");
          if (/Launched builder sa_/.test(now)) return use("toolu_wait", "wait", { seconds: 60 });
          return use("toolu_build", "agent", { role: "builder", description: "Read a", goal: "know what a.txt holds", steps: ["Read a.txt"], acceptance: "a.txt is read" });
        }
        return say("LEAD ANSWER");
      }
      return say("SOLO ANSWER");
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg, { dataDir }) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [repo], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        // A teams.json kept with a style: a team of yours that names one, and Builders given one in place.
        writeFileSync(join(dataDir, "teams.json"), JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "builder", members: [{ tag: "reviewer", line: "" }], style: "architect", createdAt: 1, updatedAt: 1 } }, shipped: { builders: { style: "10x" } } }));
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir);
  });

  /** One harness turn, answered whole. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return textOf((await r.json()).content);
  };
  /** @param {string} id @param {any} change */
  const settle = async (id, change) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** A new session in the repository. */
  const session = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: repo, model: "m-1", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** The session's settings answer. @param {string} id */
  const settingsOf = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
  /** The lead's system prompt for the turn whose typed message is `typed`. @param {number} mark @param {string} typed */
  const leadSystem = (mark, typed) => {
    const c = up.received.slice(mark).find((x) => sysOf(x.body).includes(String(PROMPT.leadRole)) && JSON.stringify(x.body.messages).includes(typed));
    assert.ok(c, `no lead's request for "${typed}"`);
    return sysOf(c.body);
  };

  // (fails before: yes — the lead read the paragraph of the style that held as its turn started, after its card's words)
  test("the lead reads its card's words and the team's check, the same on every turn; a builder's brief carries the check, which Filament runs", async () => {
    const set = await shim.api("/api/teams/builders", { method: "PUT", body: { check: "node --version" } });
    assert.equal(set.status, 200, await set.clone().text());
    const id = await session();
    await settle(id, { patch: { engine: { mode: "team", team: "builders" } } });
    const settings = await settingsOf(id);
    assert.deepEqual([settings.engine?.team, "style" in settings.engine, "styles" in settings.engine], ["builders", false, false]);
    let mark = up.received.length;
    assert.equal(await turn(id, "TURN: build it"), "LEAD SAW THE BUILDER");
    const sys = leadSystem(mark, "TURN: build it");
    assert.ok(sys.includes(`# Your team: Builders\n${SHIPPED_CARDS.buildlead.thinks}\n\n${CHECK_WORDS("node --version")}`), sys);
    for (const w of OLD_WAYS) assert.ok(!sys.includes(w), w);
    // The builder's first message: Filament's note says its team lets it run the check, which Filament runs on its report.
    const worker = up.received.slice(mark).find((x) => sysOf(x.body).includes(String(PROMPT.workerRole)));
    const opening = JSON.stringify(worker?.body.messages[0]);
    assert.match(opening, /your team lets you run these commands in your worktree without waiting for anyone's answer — each as written, or followed by more words: `node --version`/);
    assert.match(opening, /When you report, Filament runs your check — `node --version` — in your worktree before your lead hears of it/);
    const answered = up.received.slice(mark).filter((x) => sysOf(x.body).includes(String(PROMPT.leadRole))).map((x) => JSON.stringify(x.body.messages)).join("\n");
    assert.match(answered, /Filament runs its check — `node --version` — once it reports/, "the lead's launch says so too");
    assert.match(answered, /Filament ran its check after it reported: `node --version` passed \(exit 0/, "and its report says Filament ran it");
    // The next turn: its lead reads the same words, byte for byte.
    mark = up.received.length;
    assert.equal(await turn(id, "TURN: and then?"), "LEAD ANSWER");
    assert.equal(teamPart(leadSystem(mark, "TURN: and then?")), teamPart(sys));
  });

  // (fails before: yes — `/team builders 10x` handed the session to Builders, its lead leading in the 10x style)
  test("/team builders 10x names no team: it says so and writes nothing; /team builders hands the session to Builders", async () => {
    const id = await session();
    const told = await turn(id, "/team builders 10x");
    assert.match(told, /^There is no team called `builders 10x`\. The teams: `builders` \(Builders\), `bughunters` \(BugHunters\)[^;]*; `\/team` says what each does\.$/);
    const settings = await settingsOf(id);
    assert.notEqual(settings.engine?.mode, "team", "the session's turns still go to its agent");
    assert.match(await turn(id, "/team builders"), /^Team \*\*Builders\*\* answers this chat's turns from the next message on/);
    const led = await settingsOf(id);
    assert.deepEqual([led.engine?.mode, led.engine?.team], ["team", "builders"]);
  });

  // (fails before: yes — a stored engine.teamStyle and a team's stored style were followed: the lead led in that style)
  test("a session kept with engine.teamStyle, under a teams.json kept with a style: both load, and the lead's turn runs on its card's words", async () => {
    // Read without refusal: yours as it was saved, Builders as it ships.
    const read = await (await shim.api("/api/teams")).json();
    const mine = /** @type {any} */ ((read.saved || []).find((/** @type {any} */ t) => t.key === "mine"));
    assert.deepEqual([mine?.name, mine?.lead?.tag, "style" in (mine || {})], ["Mine", "builder", false], JSON.stringify(read.saved));
    assert.equal("styles" in read, false);
    // The session's stored layer, as a session saved before holds it: written to the archive as it stands.
    const id = await session();
    /** @type {any} */ (shim.app.memory).archive.setChainSettings(id, { engine: { mode: "team", team: "builders", teamStyle: "10x" } });
    const settings = await settingsOf(id);
    assert.deepEqual([settings.engine?.mode, settings.engine?.team, settings.engine?.problem ?? null, "style" in settings.engine], ["team", "builders", null, false]);
    let mark = up.received.length;
    assert.equal(await turn(id, "TURN: hello builders"), "LEAD ANSWER");
    const sys = leadSystem(mark, "TURN: hello builders");
    assert.ok(sys.includes(`# Your team: Builders\n${SHIPPED_CARDS.buildlead.thinks}`), sys);
    for (const w of OLD_WAYS) assert.ok(!sys.includes(w), w);
    // A write to that layer goes through; the style it holds stays inert.
    await settle(id, { patch: { engine: { team: "mine" } } });
    mark = up.received.length;
    assert.equal(await turn(id, "TURN: hello mine"), "LEAD ANSWER");
    const own = leadSystem(mark, "TURN: hello mine");
    assert.ok(own.includes(`# Your team: Mine\n${SHIPPED_CARDS.builder.thinks}`), own);
    for (const w of OLD_WAYS) assert.ok(!own.includes(w), w);
  });

  // (fails before: yes — a session saved naming the Architect team was told only that no team answered to it)
  test("a session saved with engine.team architect: its turn goes to its agent, and the settings answer says Builders does its work", async () => {
    const id = await session();
    await settle(id, { patch: { engine: { mode: "team", team: "architect" } } });
    assert.equal(await turn(id, "TURN: hello"), "SOLO ANSWER");
    const settings = await settingsOf(id);
    assert.equal(settings.engine?.problem, `engine.team names \`architect\`, which is no team — ${foldedSays("Architect")} (/team lists them)`);
    // `/team` says the same, with the command that picks it.
    const told = await turn(id, "/team 10x-engineer");
    assert.ok(told.includes(`There is no team called \`10x-engineer\` — ${foldedSays("10x Engineer")} (\`/team builders\`)`), told);
    // A fire beside the chat: one of the four is no team, in the same words.
    const gone = await shim.api(`/api/sessions/${encodeURIComponent(id)}/beside`, { method: "POST", body: { team: "one-shot", ask: "x" } });
    assert.equal(gone.status, 404);
    assert.match(String((await gone.json()).error), new RegExp(foldedSays("One-Shot")));
  });
});
