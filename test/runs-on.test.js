// @ts-check
// Who runs on what (the owner's plan of 11-05: three places at most — a card or a team in Library, this chat's Agents
// tab, a launch's pick): each agent and each team's lead and workers, the list it runs on in this chat and whose it is,
// and the writes of this chat's own rows (`subagents.byCard`, `subagents.byTeam`).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CREW_NOTE, LEAD_FOOT, RUNS_FOOT, createRunsOn, rowsAhead, runsOnLines, runsOnSub, runsOnWrite } from "../src/ui/harness/widgets/runs-on.js";
import { poolLine } from "../src/ui/harness/lib/pool.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { runsOnSubOf } from "./helpers/team-view.js";

const CARDS = [
  { tag: "security", name: "Security", models: ["zai/glm-5.3", "kimi-k2"], efforts: { "kimi-k2": "high" } },
  { tag: "docs", name: "Docs", model: null },
  { tag: "reviewer", name: "Reviewer", model: null },
];
/** Rows of one model, for the writes in flight. */
const FLASH_ROWS = [{ model: "zai/glm-5.3-flash" }];
const TEAMS = [{ key: "builders", name: "Builders", models: [], leadModels: ["opus-5.5"], leadEfforts: { "opus-5.5": "xhigh" } }];

/** @param {Record<string, any>} [o] */
const io = (o = {}) => {
  /** @type {any[]} */
  const writes = [];
  const st = { byCard: o.byCard ?? {}, byTeam: o.byTeam ?? {} };
  return {
    writes,
    st,
    io: {
      cards: () => CARDS,
      teams: () => TEAMS,
      byCard: () => st.byCard,
      byTeam: () => st.byTeam,
      setByCard: (/** @type {any} */ next) => { writes.push(["byCard", next]); st.byCard = next || {}; },
      setByTeam: (/** @type {any} */ next) => { writes.push(["byTeam", next]); st.byTeam = next || {}; },
      everyone: () => o.pool ?? [{ model: "zai/glm-5.3-flash" }],
      main: () => "glm-5.3",
      models: () => [],
    },
  };
};

describe("who runs on what", () => {
  // (fails before: yes — the owner's plan of 11-05: a chat set a card's or a team's models nowhere but in Library)
  test("each agent, and each team's lead and workers: this chat's own rows, else Library's, else this chat's list — the main agent's model for a lead", () => {
    const { io: o } = io({ byCard: { reviewer: [{ model: "kimi-k2", effort: "low" }] }, byTeam: { builders: { workers: [{ model: "" }] } } });
    const lines = runsOnLines(o);
    assert.deepEqual(lines.map((l) => [l.id, l.part, l.whose, l.rows]), [
      ["card:security", "", "library", [{ model: "zai/glm-5.3" }, { model: "kimi-k2", effort: "high" }]],
      ["card:docs", "", "everyone", [{ model: "zai/glm-5.3-flash" }]],
      ["card:reviewer", "", "chat", [{ model: "kimi-k2", effort: "low" }]],
      ["lead:builders", "Lead", "library", [{ model: "opus-5.5", effort: "xhigh" }]],
      ["workers:builders", "Workers", "chat", [{ model: "" }]],
    ]);
    assert.equal(runsOnSub(lines), "2 set in this chat");
    const none = runsOnLines(io({ byTeam: { builders: { workers: [{ model: "" }] } } }).io).find((l) => l.kind === "lead");
    assert.deepEqual([runsOnSub(runsOnLines(io().io)), runsOnLines({ ...io().io, teams: () => [{ key: "x", name: "X" }] }).find((l) => l.kind === "lead")?.whose, none?.whose], ["As in Library, else this chat's list", "main", "library"]);
  });

  // (fails before: yes — the review of 11-05: a lead line skipped its card's models, the team in charge had a lead line
  // nothing read, and a crew beside a chat with no list of its own said this chat's list while it ran on its lead's model)
  test("each line says what the server runs: a lead's card after its team's; no lead line for the team in charge; a crew beside a chat with no list of its own on its lead's; a coding agent's places on its own model", () => {
    const cards = [...CARDS, { tag: "buildlead", name: "Build lead", models: ["kimi-k2"], efforts: { "kimi-k2": "max" } }];
    const teams = [{ key: "builders", name: "Builders", models: [], lead: { tag: "buildlead" } }, { key: "ops", name: "Ops", lead: { tag: "docs" } }];
    const base = { ...io().io, cards: () => cards, teams: () => teams };
    const KIMI = [{ model: "kimi-k2", effort: "max" }];
    const FLASH = [{ model: "zai/glm-5.3-flash" }];
    const NAMELESS = [{ model: "" }];
    /** @param {Record<string, any>} o */
    const of = (o) => runsOnLines({ ...base, ...o }).filter((l) => l.kind !== "card").map((l) => [l.id, l.whose, l.rows]);
    assert.deepEqual(of({}), [["lead:builders", "card", KIMI], ["workers:builders", "everyone", FLASH], ["lead:ops", "main", NAMELESS], ["workers:ops", "everyone", FLASH]], "a list of its own goes along");
    const bare = { ownList: () => false, everyone: () => undefined };
    assert.deepEqual(of(bare), [["lead:builders", "card", KIMI], ["workers:builders", "lead", KIMI], ["lead:ops", "main", NAMELESS], ["workers:ops", "lead", NAMELESS]], "none: its own chat's, its lead's model");
    assert.deepEqual(of({ ...bare, leading: () => "builders" }), [["workers:builders", "everyone", NAMELESS], ["lead:ops", "main", NAMELESS], ["workers:ops", "lead", NAMELESS]], "the team in charge: its lead is the main agent");
    // (fails before: yes — the owner's of 11-06: in a coding agent's chat Builder's and Reviewer's places skipped the
    // nameless row, and a place with none named said its launch named the model; they run on the agent's own model now,
    // as the loop's run on its main agent's)
    const always = cards.map((c) => (c.tag === "docs" || c.tag === "reviewer" ? { ...c, always: true } : c));
    // As the Agents tab once told it a coding agent's chat (`coder`, `asks`), which it reads no more.
    const told = /** @type {any} */ ({ coder: () => true, asks: () => [] });
    const places = runsOnLines({ ...base, ...told, cards: () => always, everyone: () => NAMELESS, byCard: () => ({ docs: [{ model: "" }], reviewer: [{ model: "" }, { model: "kimi-k2" }] }) });
    assert.deepEqual(places.filter((l) => l.kind === "card").map((l) => [l.id, l.whose, l.rows]), [
      ["card:security", "library", [{ model: "zai/glm-5.3" }, { model: "kimi-k2", effort: "high" }]],
      ["card:docs", "chat", NAMELESS],
      ["card:reviewer", "chat", [{ model: "" }, { model: "kimi-k2" }]],
      ["card:buildlead", "library", KIMI],
    ]);
    /** @type {any[]} */
    const chips = [];
    const poolChip = (/** @type {any} */ cio) => {
      const c = { io: cio, el: fakeH("button", { class: "pool-chip" }), paint() {}, open() {} };
      chips.push(c);
      return c;
    };
    const r = createRunsOn({ ...base, ...told, cards: () => always, everyone: () => NAMELESS }, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r.paint();
    /** @type {any} */ (r.el).querySelector(".runs-on-head").dispatch("click");
    const docsChip = chips.find((c) => c.io.label === "What Docs runs on in this chat");
    assert.deepEqual([docsChip.io.main(), docsChip.io.mainWords, docsChip.io.line()], ["glm-5.3", undefined, null], "the nameless row is the main agent's model");
  });

  // (fails before: yes — the review of 8a278df79: the Brief's line opened on the pick's rows, so an edit there wrote the
  // pick, its effort too, into this chat's rows, which the server reads only once the pick goes; and Use the default
  // dropped nothing of this chat's)
  test("the Brief's line says the pick; its editor holds this chat's rows for the crew, which hold once the pick goes", () => {
    const teams = [{ key: "builders", name: "Builders", models: ["zai/glm-5.3"] }];
    const { io: o, writes } = io({ byTeam: { builders: { workers: [{ model: "kimi-k2" }] } } });
    const base = { ...o, cards: () => [], teams: () => teams, leading: () => "builders", pick: () => ({ model: "", effort: "high" }) };
    const [line] = runsOnLines(base);
    assert.deepEqual([line.whose, line.rows, line.after], ["brief", [{ model: "kimi-k2", effort: "high" }], { whose: "chat", rows: [{ model: "kimi-k2" }] }]);
    /** @type {any[]} */
    const chips = [];
    const poolChip = (/** @type {any} */ cio) => {
      const c = { io: cio, el: fakeH("button", { class: "pool-chip" }), paint() {}, open() {} };
      chips.push(c);
      return c;
    };
    const r = createRunsOn(base, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r.paint();
    /** @type {any} */ (r.el).querySelector(".runs-on-head").dispatch("click");
    const [workers] = chips;
    assert.deepEqual([workers.io.rows(), workers.io.line(), runsOnSubOf(r.el, workers)], [[{ model: "kimi-k2" }], poolLine(/** @type {any} */ ([{ model: "kimi-k2", effort: "high" }]), "glm-5.3"), "Workers · The Brief's"]);
    // (fails before: yes — the review of f91f08190: the folded row counted none of this chat's rows under the pick)
    assert.equal(runsOnSub(runsOnLines(base)), "1 set in this chat");
    workers.io.onChange([{ model: "zai/glm-5.3", seats: Infinity }]);
    workers.io.onUseDefault();
    assert.deepEqual(writes, [["byTeam", { builders: { workers: [{ model: "zai/glm-5.3" }] } }], ["byTeam", null]]);
    // None of this chat's under it: nothing to drop.
    const bare = { ...io().io, cards: () => [], teams: () => teams, leading: () => "builders", pick: () => ({ model: "m-2", effort: "" }) };
    const [only] = runsOnLines(bare);
    assert.deepEqual([only.rows, only.after], [[{ model: "m-2" }], { whose: "library", rows: [{ model: "zai/glm-5.3" }] }]);
    chips.length = 0;
    const { io: o2, writes: none } = io();
    const r2 = createRunsOn({ ...bare, setByTeam: o2.setByTeam }, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r2.paint();
    /** @type {any} */ (r2.el).querySelector(".runs-on-head").dispatch("click");
    chips[0].io.onUseDefault();
    assert.deepEqual([none, runsOnSub(runsOnLines(bare))], [[], "As in Library, else this chat's list"], "Library's under the pick: nothing to drop");
  });

  // (fails before: yes — the review of 1cf449e2f: a lead that is part of its team (Build lead) is no card a chat names,
  // so its models were never found; the Brief's pick for the crew in charge was not said; a crew beside the chat said
  // the main agent's effort where its rows say none, while its team's chat thinks as its lead)
  test("a lead's card is found among every card; the crew in charge says the Brief's pick first; a crew beside thinks as its lead", () => {
    const part = { tag: "buildlead", name: "Build lead", models: ["kimi-k2"], efforts: { "kimi-k2": "max" }, partOf: "builders" };
    const teams = [{ key: "builders", name: "Builders", models: ["zai/glm-5.3"], lead: { tag: "buildlead" } }];
    const base = { ...io().io, teams: () => teams, card: (/** @type {string} */ tag) => (tag === "buildlead" ? part : null) };
    const of = (/** @type {Record<string, any>} */ o) => runsOnLines({ ...base, ...o }).filter((l) => l.kind !== "card").map((l) => [l.id, l.whose, l.rows, l.inherits]);
    assert.deepEqual(of({}), [["lead:builders", "card", [{ model: "kimi-k2", effort: "max" }], undefined], ["workers:builders", "library", [{ model: "zai/glm-5.3" }], "max"]]);
    const inCharge = { leading: () => "builders" };
    assert.deepEqual(of({ ...inCharge, pick: () => ({ model: "m-2", effort: "low" }) }), [["workers:builders", "brief", [{ model: "m-2", effort: "low" }], undefined]]);
    assert.deepEqual(of({ ...inCharge, pick: () => ({ model: "", effort: "high" }) }), [["workers:builders", "brief", [{ model: "zai/glm-5.3", effort: "high" }], undefined]], "an effort alone: each row at it");
    assert.deepEqual(of({ pick: () => ({ model: "m-2", effort: "low" }) }).map(([id, whose]) => [id, whose]), [["lead:builders", "card"], ["workers:builders", "library"]], "a pick is the crew in charge's alone");
    /** @type {any[]} */
    const chips = [];
    const poolChip = (/** @type {any} */ cio) => {
      const c = { io: cio, el: fakeH("button", { class: "pool-chip" }), paint() {}, open() {} };
      chips.push(c);
      return c;
    };
    const r = createRunsOn({ ...base, cards: () => [], inherit: () => ({ level: "medium", desc: "The main agent's effort" }) }, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r.paint();
    /** @type {any} */ (r.el).querySelector(".runs-on-head").dispatch("click");
    const [lead, workers] = chips;
    assert.deepEqual([lead.io.foot, workers.io.foot, lead.io.inherit().level, workers.io.inherit()], [LEAD_FOOT, RUNS_FOOT, "medium", { level: "max", desc: "Its lead's effort: the team's chat thinks as its lead" }]);
  });

  // (fails before: yes — the review of 11-05: Use the default with nothing of this chat's wrote anyway, and the editor's
  // foot said a card's model beat the rows this chat sets for it)
  test("Use the default writes only where this chat has rows; the editor's foot says this chat's come first; a crew's tooltip names what comes before its rows", () => {
    const { io: o, writes } = io();
    /** @type {any[]} */
    const chips = [];
    const poolChip = (/** @type {any} */ cio) => {
      const c = { io: cio, el: fakeH("button", { class: "pool-chip" }), paint() {}, open() {} };
      chips.push(c);
      return c;
    };
    const r = createRunsOn({ ...o, cards: () => CARDS.map((c) => (c.tag === "docs" ? { ...c, always: true } : c)), everyone: () => [{ model: "" }] }, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r.paint();
    /** @type {any} */ (r.el).querySelector(".runs-on-head").dispatch("click");
    const [security, docs, , , workers] = chips;
    docs.io.onUseDefault();
    security.io.onUseDefault();
    assert.deepEqual(writes, [], "Library's hold already: nothing to drop");
    assert.deepEqual([security.io.foot, docs.io.line(), security.io.line()], [RUNS_FOOT, null, null]);
    assert.ok(workers.io.from().title.endsWith(CREW_NOTE), workers.io.from().title);
    assert.ok(!security.io.from().title.includes(CREW_NOTE));
  });

  // (fails before: yes — the review of 11-05: the Agents tab built a second edit on the settings the server had answered
  // last, so an edit made while the first was on its way dropped the first)
  test("a write not answered yet is read until its answer is in, unless a newer one took its place; each chat's apart", async () => {
    const ahead = rowsAhead();
    /** @type {((v?: any) => void)[]} */
    const answers = [];
    const go = () => new Promise((r) => { answers.push(r); });
    const first = ahead.write("c1 subagents.byCard", { docs: FLASH_ROWS }, go);
    assert.deepEqual([ahead.read("c1 subagents.byCard", null), ahead.read("c2 subagents.byCard", "its own")], [{ docs: FLASH_ROWS }, "its own"]);
    const second = ahead.write("c1 subagents.byCard", { docs: FLASH_ROWS, reviewer: FLASH_ROWS }, go);
    answers[0]();
    await first;
    assert.deepEqual(ahead.read("c1 subagents.byCard", { docs: FLASH_ROWS }), { docs: FLASH_ROWS, reviewer: FLASH_ROWS }, "the first's answer leaves the newer");
    answers[1]();
    await second;
    assert.equal(ahead.read("c1 subagents.byCard", "as the server says"), "as the server says");
    await assert.rejects(ahead.write("c1 subagents.byCard", {}, () => Promise.reject(new Error("refused"))), /refused/);
    assert.equal(ahead.read("c1 subagents.byCard", "as the server says"), "as the server says", "a write that failed goes too");
  });

  test("a line set writes the whole map, each row at its effort; one dropped leaves the others, and none left is no map", () => {
    const { io: o } = io({ byCard: { reviewer: [{ model: "kimi-k2" }] }, byTeam: { builders: { lead: [{ model: "opus-5.5" }], workers: [{ model: "" }] } } });
    const [security, , reviewer, lead, workers] = runsOnLines(o);
    assert.deepEqual(runsOnWrite(o, security, [{ model: "zai/glm-5.3", effort: "max" }]), { byCard: { reviewer: [{ model: "kimi-k2" }], security: [{ model: "zai/glm-5.3", effort: "max" }] } });
    assert.deepEqual(runsOnWrite(o, reviewer, null), { byCard: null });
    assert.deepEqual(runsOnWrite(o, lead, null), { byTeam: { builders: { workers: [{ model: "" }] } } });
    assert.deepEqual(runsOnWrite({ ...o, byTeam: () => ({ builders: { workers: [{ model: "" }] } }) }, workers, null), { byTeam: null });
  });

  test("folded under one row that says how many are set here; opened, a row each with its list's chip, whose editor writes this chat's own", () => {
    const { io: o, writes } = io({ byCard: { reviewer: [{ model: "kimi-k2" }] } });
    /** @type {any[]} */
    const chips = [];
    const poolChip = (/** @type {any} */ cio) => {
      const c = { io: cio, el: fakeH("button", { class: "pool-chip" }), painted: 0, paint() { c.painted++; }, open() {} };
      chips.push(c);
      return c;
    };
    const r = createRunsOn(o, { h: /** @type {any} */ (fakeH), poolChip: /** @type {any} */ (poolChip) });
    r.paint();
    const el = /** @type {any} */ (r.el);
    const head = el.querySelector(".runs-on-head");
    const list = el.querySelector(".runs-on-list");
    assert.deepEqual([textOf(head), list.classList.contains("hidden"), chips.length, head.attrs["aria-expanded"]], ["Who runs on what|1 set in this chat", true, 0, "false"], "folded: no chip made");
    head.dispatch("click");
    assert.deepEqual([list.classList.contains("hidden"), head.attrs["aria-expanded"], chips.length, chips.every((c) => c.painted === 1)], [false, "true", 5, true]);
    // Whose list it is, under each row's name (the look of 11-05: on the chip it pushed the list out).
    assert.deepEqual(chips.map((c) => [runsOnSubOf(el, c), c.io.label, "tag" in c.io]), [
      ["Library", "What Security runs on in this chat", false],
      ["Everyone else", "What Docs runs on in this chat", false],
      ["This chat", "What Reviewer runs on in this chat", false],
      ["Lead · Library", "What the Builders team's lead runs on in this chat", false],
      ["Workers · Everyone else", "What the Builders team's workers run on in this chat", false],
    ]);
    chips[1].io.onChange([{ model: "kimi-k2", seats: Infinity, effort: "low" }]);
    chips[2].io.onUseDefault();
    chips[4].io.onChange([{ model: "zai/glm-5.3", seats: Infinity }]);
    assert.deepEqual(writes, [
      ["byCard", { reviewer: [{ model: "kimi-k2" }], docs: [{ model: "kimi-k2", effort: "low" }] }],
      ["byCard", { docs: [{ model: "kimi-k2", effort: "low" }] }],
      ["byTeam", { builders: { workers: [{ model: "zai/glm-5.3" }] } }],
    ]);
    r.paint();
    assert.equal(chips.length, 10, "what it says changed: drawn again");
    r.paint();
    assert.equal(chips.length, 10, "nothing changed: the chips stand, an open editor's anchor with them");
  });
});
