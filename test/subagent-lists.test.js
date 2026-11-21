// @ts-check
// HarnessV4_Tasks E23: a sub-agent named by its model, its provider and its effort. The registry's half: the list a
// launch takes its model from and counts on — one list for every agent of a chat since U13-D14 (10-20: the crews' own
// list, Workers, E23-D6, is gone) — the effort it runs at and the name its request carries (D5), a lead naming its
// worker's model (D9), a list of models that launches nothing (D4), a fork that names either (case 13), and `/subagent`'s
// words for them. The match itself: model-choice.test.js; a coding agent's tool: agents-coder-launch.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BRIEF, TEAM, leadOf, watched } from "./helpers/team.js";
import { MEMBERS } from "./helpers/roster.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";
import { globalLayer, resolveSettings } from "../src/services/session-settings.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

/** A side agent the developer launches, its card naming no model. @param {string} prompt @param {Record<string, any>} [more] @returns {any} */
const SIDE = (prompt, more = {}) => ({ origin: "owner", chainId: "c1", prompt, as: "reviewer", ...more });
const LEVELS = ["low", "medium", "high"];
const ORDER = ["low", "medium", "high", "xhigh", "max"];
/**
 * E23's context, as server.js wires it, on two models: Kimi K3 as a person says it — at Moonshot, else OpenRouter's —
 * each model taking low to high, its level on its name; and the list a launcher reads, with each model's seats.
 */
const NAMED = {
  chooseModel: async (/** @type {string} */ name, /** @type {string | null} */ provider) =>
    name === "Kimi K3"
      ? { ok: true, model: provider === "OpenRouter" ? "openrouter/moonshotai/kimi-k3" : "moonshot/kimi-k3", upstream: provider === "OpenRouter" ? "openrouter" : "moonshot", note: provider ? "" : "OpenRouter serves Kimi K3 too: name provider to choose." }
      : { ok: false, error: `no model like "${name}": the nearest is moonshot/kimi-k3 — list_models lists them` },
  effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted) => {
    if (!wanted) return { level: null, wire: model, levels: LEVELS, spelled: false };
    const level = [...LEVELS].reverse().find((l) => ORDER.indexOf(l) <= ORDER.indexOf(wanted)) || LEVELS[0];
    return { level, wire: `${model}@${level}`, levels: LEVELS, spelled: false };
  },
  modelList: async (/** @type {{ provider?: string | null }} */ ask, /** @type {(m: string) => string} */ seats) => `${ask.provider ?? "Every provider"}: moonshot/kimi-k3 — ${seats("moonshot/kimi-k3") || "in neither list"}`,
};

/** Each model's facts as server.js reads them: every name lands at one source, `u`. @param {string} model */
const AT_U = (model) => ({ problem: null, limit: null, at: { upstream: "u", model } });

// (fails before: yes — one pool served the side agents, a team's workers and the graph's tasks alike, E15 step 8)
describe("one list for every agent of a chat (U13-D14)", () => {
  test("a team's worker takes the chat's list, and every agent counts against its model's limit (case 17)", async () => {
    const w = watched({ sub: { pool: [{ model: "m-pool" }] }, slots: [{ upstream: "u", model: "m-pool", n: 2 }], facts: AT_U });
    const l = leadOf(w.registry, w.dir);
    const worker = await l.tools.agent(l.call(BRIEF));
    assert.equal(worker.ok, true, worker.text);
    assert.equal(w.registry.get(String(worker.agentId))?.model, "m-pool");
    assert.equal(w.registry.launch(SIDE("look")).ok, true);
    assert.deepEqual([w.registry.limit("c1"), w.registry.limit("c1", "workers")], [{ max: 2, running: 2 }, { max: 2, running: 2 }], "one list, one count");
    assert.equal(String(/** @type {any} */ (w.registry.launch(SIDE("again"))).error), "The limit is 2 at once, and 2 are running. Wait for one to finish.");
  });

  // (fails before: yes — a crews' list, set, took a team's workers and counted apart: the chat ran more than its number)
  test("a crews' list or a number an older configuration still holds is read by nothing: the worker runs on the chat's list, counted with the rest", async () => {
    const w = watched({ sub: { pool: [{ model: "m-side" }], workers: [{ model: "m-work", seats: 2 }], most: 2 }, slots: [{ upstream: "u", model: "m-side", n: 2 }], facts: AT_U });
    const l = leadOf(w.registry, w.dir);
    const one = await l.tools.agent(l.call(BRIEF));
    assert.equal(one.ok, true, one.text);
    assert.equal(w.registry.get(String(one.agentId))?.model, "m-side");
    assert.match(one.text, /1 running\.$/, "the chat's count");
    const side = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.equal(w.registry.get(side.id)?.model, "m-side");
    const two = await l.tools.agent(l.call({ ...BRIEF, description: "Fix the lexer" }));
    assert.equal(two.ok, true, two.text);
    assert.match(two.text, /There is no room for it now \(m-side, 2 of 2 busy\): it waits/, "a lead's worker waits for its model's room");
    assert.deepEqual(w.registry.modelsOf("c1", MEMBERS, "m-lead").pool.map((/** @type {any} */ r) => r.model), ["m-side"], "the lead's lines name the chat's list");
  });

  test("the lead's lines read the chat's list: a change to it reaches the workers (cases 17, 18)", () => {
    /** @type {Record<string, unknown>} */
    const sub = { pool: [{ model: "m-side" }] };
    const w = watched({ sub });
    assert.deepEqual(w.registry.modelsOf("c1", MEMBERS, "m-lead").pool.map((/** @type {any} */ r) => r.model), ["m-side"]);
    sub.pool = [{ model: "m-other" }, { model: "m-side" }];
    assert.deepEqual(w.registry.modelsOf("c1", MEMBERS, "m-lead").pool.map((/** @type {any} */ r) => r.model), ["m-other", "m-side"]);
  });
});

// (fails before: yes — the owner's word of 11-05: a chat had a number of its own, 4 unless set, and each model 4 across
// Filament unless set; "if no limit is set from provider's model then limit is considered to be unlimited")
describe("no number of the chat's own: each model's limit, set on its row, and none where none is set", () => {
  test("rows are an order; with no limit on its models a chat runs every agent it launches, a team's workers and the rest", async () => {
    const w = watched({ sub: { pool: [{ model: "m-side" }, { model: "m-two" }] }, facts: AT_U });
    const l = leadOf(w.registry, w.dir);
    const worker = await l.tools.agent(l.call(BRIEF));
    assert.equal(worker.ok, true, worker.text);
    const sides = ["look", "again", "and again"].map((p) => /** @type {any} */ (w.registry.launch(SIDE(p))));
    assert.deepEqual(sides.map((x) => x.ok), [true, true, true]);
    assert.deepEqual([worker.agentId, ...sides.map((x) => x.id)].map((id) => w.registry.get(String(id))?.model), ["m-side", "m-side", "m-side", "m-side"], "the first of the list takes them all");
    assert.deepEqual(w.registry.limit("c1"), { max: Infinity, running: 4 });
  });

  test("a row's old seats, and a chat's old number, say nothing", () => {
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 2 }], most: 1 }, facts: AT_U });
    assert.deepEqual(w.registry.limit("c1"), { max: Infinity, running: 0 });
    const of = (/** @type {any} */ most, /** @type {any} */ session = {}) => resolveSettings({ global: globalLayer({ agentLoop: { subagents: { most } } }), session }).effective.subagents.most;
    assert.deepEqual([of(6), of(6, { subagents: { most: 3 } })], [undefined, undefined], "no setting holds one");
  });

  test("a model at its limit passes the next launch to the next row; a limit on every row is the chat's room", () => {
    const w = watched({ sub: { pool: [{ model: "m-a" }, { model: "m-b" }] }, slots: [{ upstream: "u", model: "m-a", n: 1 }, { upstream: "u", model: "m-b", n: 2 }], facts: AT_U });
    assert.deepEqual(w.registry.limit("c1"), { max: 3, running: 0 });
    const ids = [SIDE("one"), SIDE("two"), SIDE("three")].map((s) => /** @type {any} */ (w.registry.launch(s)).id);
    assert.deepEqual(ids.map((id) => w.registry.get(id)?.model), ["m-a", "m-b", "m-b"]);
    assert.equal(String(/** @type {any} */ (w.registry.launch(SIDE("four"))).error), "The limit is 3 at once, and 3 are running. Wait for one to finish.");
  });
});

// (fails before: yes — no launch set an effort: a sub-agent thought as the main agent's thinking setting said)
describe("a launch's effort (E23-D5)", () => {
  // (fails before: yes — the owner's word of 11-05: a launch that named none ran at max, or at the setting for agents;
  // "with nothing set, sub-agents use the main agent's model and effort")
  test("the main agent's effort unless said, each model at the highest it takes, on the name its request carries; none set, none sent; model sends none", async () => {
    /** @type {Record<string, unknown>} */
    const main = { effort: "max" };
    const w = watched({ sub: { pool: [{ model: "m-side" }] }, model: main, extra: NAMED });
    const max = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.equal(w.registry.get(max.id)?.effort, "high", "max the main agent's, high its highest");
    assert.equal((await w.run(1)).body.model, "agent/m-side@high");
    main.effort = "low";
    const low = /** @type {any} */ (w.registry.launch(SIDE("look again")));
    assert.equal(w.registry.get(low.id)?.effort, "low", "the main agent's where the launch names none");
    delete main.effort;
    const unset = /** @type {any} */ (w.registry.launch(SIDE("as the chat is")));
    assert.equal(w.registry.get(unset.id)?.effort, null, "the main agent names none: none");
    assert.equal((await w.run(3)).body.model, "agent/m-side", "nothing sent: the model's own default");
    const own = /** @type {any} */ (w.registry.launch(SIDE("as it is", { effort: "model" })));
    assert.equal(w.registry.get(own.id)?.effort, null);
    assert.equal((await w.run(4)).body.model, "agent/m-side", "nothing sent: the model's own default");
    assert.equal(/** @type {any} */ (w.registry.launch(SIDE("hard", { effort: "turbo" }))).error, "effort must be one of model, low, medium, high, xhigh, max");
  });

  // (fails before: yes — the review of 11-05: the main agent's effort was read from its setting alone, so a level its
  // model's name spells — a family whose ids spell their levels, or Filament's suffix — reached no agent)
  test("the main agent's effort spelled in its model's name is the one a launch inherits; its setting first", async () => {
    const SPELLS = {
      ...NAMED,
      effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted, /** @type {boolean} */ asked) => {
        const at = /-(low|medium|high|xhigh|max)$/.exec(model);
        if (at && !asked) return { level: at[1], wire: model, levels: LEVELS, spelled: true };
        return NAMED.effortOf(model.replace(/-(low|medium|high|xhigh|max)$/, ""), wanted);
      },
    };
    /** @type {Record<string, unknown>} */
    const main = { name: "m-session-high" };
    const w = watched({ sub: { pool: [{ model: "m-side" }] }, model: main, extra: SPELLS });
    const spelt = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.equal(w.registry.get(spelt.id)?.effort, "high", "its name's level");
    main.effort = "low";
    const set = /** @type {any} */ (w.registry.launch(SIDE("look again")));
    assert.equal(w.registry.get(set.id)?.effort, "low", "its setting beats its name, as on the wire");
  });

  // (fails before: yes — the review of 11-05: an effort the main agent's setting gives was inherited as not asked, so on
  // the main agent's own model a level its name spells beat it, where on the wire the setting beats the name)
  test("the main agent's setting holds on its own model over a level its name spells, as on the wire; on another model, that name's", () => {
    /** @type {Record<string, string>} */
    const SPELT = { "m-session": "low", "m-other": "low" };
    const SPELLS = {
      ...NAMED,
      effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted, /** @type {boolean} */ asked) =>
        SPELT[model] && !asked ? { level: SPELT[model], wire: model, levels: LEVELS, spelled: true } : NAMED.effortOf(model, wanted),
    };
    const w = watched({ sub: { pool: [{ model: "" }, { model: "m-other" }] }, model: { effort: "high" }, extra: SPELLS });
    const own = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.deepEqual([w.registry.get(own.id)?.model, w.registry.get(own.id)?.effort], ["m-session", "high"], "its own model: its setting");
    const other = /** @type {any} */ (w.registry.launch(SIDE("look there", { model: "m-other" })));
    assert.deepEqual([w.registry.get(other.id)?.model, w.registry.get(other.id)?.effort], ["m-other", "low"], "another's name: its level");
    assert.deepEqual([w.registry.mainEffort("c1", "m-session"), w.registry.mainEffort("c1", "m-other")], [{ level: "high", asked: true }, { level: "high", asked: false }], "as a team beside reads it for its lead");
  });

  // (fails before: yes — the review of 11-05: its own model was told by the name less its effort's suffix, so on
  // m-session-max the main agent's setting beat the max its name spells)
  test("its own model is the very name it runs on: a name that spells a level past it keeps that level", () => {
    const SPELLS = {
      ...NAMED,
      effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted, /** @type {boolean} */ asked) => {
        const at = /-(low|medium|high|xhigh|max)$/.exec(model);
        if (at && !asked) return { level: at[1], wire: model, levels: LEVELS, spelled: true };
        return NAMED.effortOf(model.replace(/-(low|medium|high|xhigh|max)$/, ""), wanted);
      },
    };
    const w = watched({ model: { effort: "low" }, extra: SPELLS, rules: { effort: { suffixes: ORDER } } });
    assert.deepEqual([w.registry.mainEffort("c1", "m-session"), w.registry.mainEffort("c1", "M-Session"), w.registry.mainEffort("c1", "agent/m-session"), w.registry.mainEffort("c1", "m-session-max")], [
      { level: "low", asked: true },
      { level: "low", asked: true },
      { level: "low", asked: true },
      { level: "low", asked: false },
    ]);
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a row of the chat's list
  // named its model alone)
  test("a row's effort is its agents' where the launch names none, over the main agent's; the launch's own, and a Brief's pick for a crew, over it", async () => {
    const w = watched({ sub: { pool: [{ model: "m-side", effort: "low" }, { model: "m-two" }] }, model: { effort: "high" }, extra: NAMED });
    const row = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.deepEqual([w.registry.get(row.id)?.model, w.registry.get(row.id)?.effort], ["m-side", "low"], "its row's");
    assert.equal((await w.run(1)).body.model, "agent/m-side@low");
    const two = /** @type {any} */ (w.registry.launch(SIDE("look there", { model: "m-two" })));
    assert.equal(w.registry.get(two.id)?.effort, "high", "a row that says none: the main agent's");
    const own = /** @type {any} */ (w.registry.launch(SIDE("hard", { effort: "medium" })));
    assert.equal(w.registry.get(own.id)?.effort, "medium", "the launch's own");
    const crew = watched({ sub: { pool: [{ model: "m-work", effort: "low" }] }, engine: { teamEffort: "high" }, extra: NAMED });
    const l = leadOf(crew.registry, crew.dir);
    const worker = await l.tools.agent(l.call(BRIEF));
    assert.equal(crew.registry.get(String(worker.agentId))?.effort, "high", "the Brief's pick for the crew");
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a card's models were
  // names alone)
  test("a card's model that says how hard it thinks on it: its agent's where the launch names none, over the main agent's", () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "sec", name: "Sec", goodFor: "Breaks in", models: [{ model: "m-a", effort: "low" }, "m-b"] });
    const w = watched({ card: (tag) => cards.find(tag), model: { effort: "high" }, extra: NAMED });
    const a = /** @type {any} */ (w.registry.launch(SIDE("look", { as: "sec" })));
    assert.deepEqual([w.registry.get(a.id)?.model, w.registry.get(a.id)?.effort], ["m-a", "low"], "its row's");
    const b = /** @type {any} */ (w.registry.launch(SIDE("look there", { as: "sec", model: "m-b" })));
    assert.deepEqual([w.registry.get(b.id)?.model, w.registry.get(b.id)?.effort], ["m-b", "high"], "named past its card: the main agent's");
  });

  // (fails before: yes — the review of 11-05: one that started by itself ran on its list's row at the main agent's effort)
  test("one that starts by itself runs on its list's row at the row's effort", () => {
    const w = watched({ sub: { pool: [{ model: "m-side", effort: "low" }] }, model: { effort: "high" }, extra: NAMED });
    const self = /** @type {any} */ (w.registry.launch(SIDE("look back", { origin: "self", why: "the turn ended" })));
    assert.equal(self.ok, true, self.error);
    assert.deepEqual([w.registry.get(self.id)?.model, w.registry.get(self.id)?.effort], ["m-side", "low"]);
  });

  // (fails before: yes — the review of 11-05: a launch that named one of its card's own models dropped the effort its
  // card says for it, where a model of the chat's list kept its row's)
  test("a launch that names one of its card's models, or of this chat's rows for it, runs at that row's effort where it names none", () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "sec", name: "Sec", goodFor: "Breaks in", models: [{ model: "m-a", effort: "low" }, { model: "m-b", effort: "medium" }] });
    const w = watched({ card: (tag) => cards.find(tag), model: { effort: "high" }, extra: NAMED });
    const b = /** @type {any} */ (w.registry.launch(SIDE("look", { as: "sec", model: "m-b" })));
    assert.deepEqual([w.registry.get(b.id)?.model, w.registry.get(b.id)?.effort], ["m-b", "medium"], "its card's row for it");
    const own = /** @type {any} */ (w.registry.launch(SIDE("look hard", { as: "sec", model: "m-b", effort: "low" })));
    assert.equal(w.registry.get(own.id)?.effort, "low", "the launch's own");
    const mine = watched({ card: (tag) => cards.find(tag), model: { effort: "high" }, sub: { byCard: { sec: [{ model: "m-c", effort: "low" }] } }, extra: NAMED });
    const c = /** @type {any} */ (mine.registry.launch(SIDE("look", { as: "sec", model: "m-c" })));
    assert.deepEqual([mine.registry.get(c.id)?.model, mine.registry.get(c.id)?.effort], ["m-c", "low"], "this chat's row for it");
    const b2 = /** @type {any} */ (mine.registry.launch(SIDE("look", { as: "sec", model: "m-b" })));
    assert.equal(mine.registry.get(b2.id)?.effort, "high", "its card's list stands aside for this chat's");
  });

  // (fails before: yes — the owner's plan of 11-05: a chat could set no agent's models of its own, only one list for all)
  test("this chat's rows for a card: before its card's models, each with its effort; \"\" the main agent's model; the launch's own model over them", () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "sec", name: "Sec", goodFor: "Breaks in", models: [{ model: "m-a", effort: "low" }] });
    const w = watched({ card: (tag) => cards.find(tag), model: { effort: "high" }, sub: { byCard: { sec: [{ model: "m-c", effort: "medium" }, { model: "m-a" }] } }, extra: NAMED });
    const a = /** @type {any} */ (w.registry.launch(SIDE("look", { as: "sec" })));
    assert.deepEqual([w.registry.get(a.id)?.model, w.registry.get(a.id)?.effort], ["m-c", "medium"], "this chat's first row, at its effort");
    const named = /** @type {any} */ (w.registry.launch(SIDE("look there", { as: "sec", model: "m-b" })));
    assert.deepEqual([w.registry.get(named.id)?.model, w.registry.get(named.id)?.effort], ["m-b", "high"], "the launch's own model, at the main agent's");
    const plain = /** @type {any} */ (w.registry.launch(SIDE("look plain")));
    assert.equal(w.registry.get(plain.id)?.model, "m-session", "another card: as ever");
    const main = watched({ card: (tag) => cards.find(tag), sub: { byCard: { sec: [{ model: "", effort: "xhigh" }] } }, extra: NAMED });
    const m = /** @type {any} */ (main.registry.launch(SIDE("look", { as: "sec" })));
    assert.deepEqual([main.registry.get(m.id)?.model, main.registry.get(m.id)?.effort], ["m-session", "high"], "the main agent's model, at the highest it takes at or below xhigh");
    const bad = watched({ card: (tag) => cards.find(tag), sub: { byCard: { sec: [{ model: "m-gone" }] } }, problem: (model) => (model === "m-gone" ? "its provider is off" : null), extra: NAMED });
    const no = /** @type {any} */ (bad.registry.launch(SIDE("look", { as: "sec" })));
    assert.deepEqual([no.ok, no.error], [false, `Sec cannot run on "m-gone": its provider is off — this chat names that model for it (its Agents tab)`]);
  });

  // (fails before: yes — the review of 11-05: its lead read its member's card's model, where the member runs on this
  // chat's rows for that card)
  test("its lead's words name the model a member runs on: this chat's first row for its card, before its card's", () => {
    const cards = createAgentCardStore({ dataDir: null });
    const w = watched({ card: (tag) => cards.find(tag), sub: { byCard: { builder: [{ model: "m-c" }], reviewer: [{ model: "" }] } }, extra: NAMED });
    const said = w.registry.modelsOf("c1", MEMBERS, "m-lead", undefined, null);
    const byCard = Object.fromEntries(said.members.map((m) => [m.tag, m.model]));
    assert.deepEqual([byCard.builder, byCard.reviewer], ["m-c", "m-lead"], JSON.stringify(said.members));
  });

  // (fails before: yes — the owner's plan of 11-05: a chat could set no team's models of its own)
  test("this chat's rows for a team's workers: before the team's models, each with its effort; its Brief's pick over them", async () => {
    const team = { ...TEAM, models: ["m-team"] };
    const w = watched({ model: { effort: "high" }, sub: { byTeam: { architect: { workers: [{ model: "Kimi K3", effort: "low" }] } } }, extra: NAMED });
    const l = leadOf(w.registry, w.dir);
    const worker = await l.tools.agent({ ...l.call(BRIEF), team });
    assert.equal(worker.ok, true, worker.text);
    assert.deepEqual([w.registry.get(String(worker.agentId))?.model, w.registry.get(String(worker.agentId))?.effort], ["moonshot/kimi-k3", "low"], "this chat's row");
    assert.deepEqual(await w.registry.teamRows(team, "c1"), [{ model: "moonshot/kimi-k3", effort: "low", seats: Infinity }]);
    const other = await w.registry.teamRows({ ...team, key: "builders" }, "c1");
    assert.equal(other, null, "another team: its own models, none of which runs here");
    const picked = watched({ sub: { byTeam: { architect: { workers: [{ model: "Kimi K3" }] } } }, engine: { teamWorkers: "Kimi K3 OpenRouter" }, extra: { ...NAMED, chooseModel: async (/** @type {string} */ name) => (name === "Kimi K3 OpenRouter" ? { ok: true, model: "openrouter/moonshotai/kimi-k3" } : NAMED.chooseModel(name, null)) } });
    assert.deepEqual(await picked.registry.teamRows(team, "c1"), [{ model: "openrouter/moonshotai/kimi-k3", seats: Infinity }], "the Brief's pick");
    const mainRow = watched({ sub: { byTeam: { architect: { workers: [{ model: "" }] } } }, extra: NAMED });
    assert.deepEqual(await mainRow.registry.teamRows(team, "c1"), [{ model: "m-session", seats: Infinity }], "\"\": its chat's own model");
  });

  // (fails before: yes — the review of 11-05: two rows of one model, "" and its name, took the first row's effort, none,
  // where the chat's list takes the first that says one)
  test("two of this chat's rows on one model: its effort the first of them says, for a card's agent and a team's workers", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "sec", name: "Sec", goodFor: "Breaks in" });
    const rows = [{ model: "" }, { model: "m-session", effort: "low" }];
    const session = { chooseModel: async (/** @type {string} */ name) => (name === "m-session" ? { ok: true, model: "m-session" } : NAMED.chooseModel(name, null)) };
    const w = watched({ card: (tag) => cards.find(tag), model: { effort: "high" }, sub: { byCard: { sec: rows }, byTeam: { architect: { workers: rows } } }, extra: { ...NAMED, ...session } });
    const a = /** @type {any} */ (w.registry.launch(SIDE("look", { as: "sec" })));
    assert.deepEqual([w.registry.get(a.id)?.model, w.registry.get(a.id)?.effort], ["m-session", "low"], "a card's agent");
    assert.deepEqual(await w.registry.teamRows({ ...TEAM, models: [] }, "c1"), [{ model: "m-session", effort: "low", seats: Infinity }], "a team's workers");
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a team's models were
  // names alone)
  test("a team's model that says how hard its worker thinks on it: its worker's where its lead and its Brief name none, over the main agent's", async () => {
    const team = { ...TEAM, models: ["Kimi K3"], efforts: { "Kimi K3": "low" } };
    const w = watched({ model: { effort: "high" }, extra: NAMED });
    const l = leadOf(w.registry, w.dir);
    const worker = await l.tools.agent({ ...l.call(BRIEF), team });
    assert.equal(worker.ok, true, worker.text);
    assert.deepEqual([w.registry.get(String(worker.agentId))?.model, w.registry.get(String(worker.agentId))?.effort], ["moonshot/kimi-k3", "low"], "its row's");
    const picked = watched({ model: { effort: "high" }, engine: { teamEffort: "medium" }, extra: NAMED });
    const p = leadOf(picked.registry, picked.dir);
    const crew = await p.tools.agent({ ...p.call(BRIEF), team });
    assert.equal(crew.ok, true, crew.text);
    assert.equal(picked.registry.get(String(crew.agentId))?.effort, "medium", "the Brief's pick for the crew over it");
  });

  // (fails before: yes — the owner's 10-21: a team's Brief picked no effort for its crew, which thought as the session
  // said for every agent)
  test("a team's worker whose lead names no effort runs at its Brief's pick for the crew, over the main agent's; one its lead names wins; an agent on the side keeps the main agent's", async () => {
    const w = watched({ sub: { pool: [{ model: "m-work" }] }, model: { effort: "low" }, engine: { teamEffort: "max" }, extra: NAMED });
    const l = leadOf(w.registry, w.dir);
    const picked = await l.tools.agent(l.call(BRIEF));
    assert.equal(picked.ok, true, picked.text);
    assert.equal(w.registry.get(String(picked.agentId))?.effort, "high", "max picked, high its highest");
    const named = await l.tools.agent(l.call({ ...BRIEF, description: "Fix the lexer", effort: "medium" }));
    assert.equal(w.registry.get(String(named.agentId))?.effort, "medium", "its lead's word for one worker");
    const side = /** @type {any} */ (w.registry.launch(SIDE("look")));
    assert.equal(w.registry.get(side.id)?.effort, "low", "no team's: the main agent's");
  });

  test("a fork runs as the main agent's request does: naming a model or an effort is refused in words (case 13)", async () => {
    const w = watched({ extra: NAMED });
    const d = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: null, model: "m-session", thinking: null, fork: () => ({ body: { model: "m-session", max_tokens: 100, system: "SYS", tools: [], messages: [{ role: "user", content: "fix it" }] }, headers: {} }) });
    const run = (/** @type {Record<string, any>} */ input) => d.subagents.run({ id: "tu-1", input: { description: "Look", prompt: "look", context: "fork", run_in_background: true, ...input }, emit: () => {}, signal: /** @type {any} */ (null) });
    await assert.rejects(run({ model: "Kimi K3", effort: "high" }), { message: "a fork runs as the main agent's request does, its model and effort with it — leave model and effort out, or choose another context" });
    assert.equal(w.registry.list("c1").length, 0, "nothing started");
  });
});

// (fails before: yes — a lead's agent tool had no model field: its workers ran on the pool's or their card's)
describe("a lead names its worker's model (E23-D9)", () => {
  test("as a person says it: that model at its effort, said in the launch's answer with who else serves it; one that cannot run is refused in words (case 16)", async () => {
    const w = watched({ sub: { pool: [{ model: "m-work", seats: 2 }] }, extra: NAMED });
    const l = leadOf(w.registry, w.dir);
    const r = await l.tools.agent(l.call({ ...BRIEF, model: "Kimi K3", effort: "xhigh" }));
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^Launched builder sa_[0-9a-f]{8} \("Fix the parser"\) on moonshot\/kimi-k3 at high \(its highest; xhigh asked\) in the background\. OpenRouter serves Kimi K3 too: name provider to choose\. /);
    assert.match(r.text, /1 running\.$/, "a model the list does not name counts in the chat all the same (case 15)");
    assert.equal((await w.run(1)).body.model, "agent/moonshot/kimi-k3@high");
    assert.match(r.note, /^agent: launched builder sa_[0-9a-f]{8} \(moonshot\/kimi-k3 at high\) for team Architect in the background$/);
    const at = await l.tools.agent(l.call({ ...BRIEF, description: "Fix the lexer", model: "Kimi K3", provider: "OpenRouter" }));
    assert.equal(w.registry.get(String(at.agentId))?.model, "openrouter/moonshotai/kimi-k3", "the provider named");
    const no = await l.tools.agent(l.call({ ...BRIEF, model: "Kimmy" }));
    assert.deepEqual([no.ok, no.text], [false, 'Not launched: no model like "Kimmy": the nearest is moonshot/kimi-k3 — list_models lists them.']);
    assert.deepEqual([(await l.tools.agent(l.call({ ...BRIEF, effort: "turbo" }))).text], ["Not launched: effort must be one of model, low, medium, high, xhigh, max."], "read from the brief alone");
  });

  test("list_models answers with the models and their room on the chat's list, launches nothing, and reads no brief", async () => {
    const at = (/** @type {string} */ model) => ({ problem: null, limit: null, at: { upstream: "moonshot", model } });
    const w = watched({ sub: { pool: [{ model: "moonshot/kimi-k3" }] }, slots: [{ upstream: "moonshot", model: "moonshot/kimi-k3", n: 3 }], facts: at, extra: NAMED });
    const l = leadOf(w.registry, w.dir);
    const r = await l.tools.agent(l.call({ list_models: true, provider: "Moonshot" }));
    assert.deepEqual([r.ok, r.text], [true, "Moonshot: moonshot/kimi-k3 — on the chat's list, 3 of 3 free"], "its limit across Filament, set on its row");
    // (the owner's word of 11-05: no limit set, none — 4 by default before)
    const bare = watched({ sub: { pool: [{ model: "moonshot/kimi-k3" }] }, facts: at, extra: NAMED });
    const lb = leadOf(bare.registry, bare.dir);
    assert.equal((await lb.tools.agent(lb.call({ list_models: true, provider: "Moonshot" }))).text, "Moonshot: moonshot/kimi-k3 — on the chat's list", "no limit set: no room to say");
    assert.equal(w.registry.list("c1").length, 0, "nothing launched");
  });

});

// (fails before: yes — `/subagent` took model= alone, one word, and a follow-up dropped it unread)
describe("/subagent (E23-D1, D5)", () => {
  test("model, provider and effort before the task, a name with spaces in quotes; a follow-up that names them is not understood", () => {
    const c = /** @type {any} */ (parseSubagentCommand('/subagent model="Kimi K3" provider=openrouter effort=high find the bug'));
    assert.deepEqual([c.action, c.model, c.provider, c.effort, c.prompt], ["launch", "Kimi K3", "openrouter", "high", "find the bug"]);
    const plain = /** @type {any} */ (parseSubagentCommand("/subagent model=kimi-k3 look"));
    assert.deepEqual([plain.model, plain.provider, plain.effort, plain.prompt], ["kimi-k3", null, null, "look"]);
    const f = /** @type {any} */ (parseSubagentCommand("/subagent ask sa_0123abcd effort=max check again"));
    assert.deepEqual([f.action, f.arg], ["unknown", "ask (a follow-up runs on the model and the effort its launch gave it: leave effort= out, or launch a new sub-agent)"]);
    assert.deepEqual([/** @type {any} */ (parseSubagentCommand("/btw why?")).effort, /** @type {any} */ (parseSubagentCommand("/btw why?")).provider], [null, null]);
  });
});
