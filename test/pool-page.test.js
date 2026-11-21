// @ts-check
// HarnessV4_Tasks E15 step 8 (AG-240; U13-D14, D15): the list as the page holds it — the rows of `subagents.pool`, an
// order, the chat's one number, the chip's line, the edits the editor makes, the words beside a row — and the chip with
// its editor on the fake DOM: the list is written once, when the editor closes, if it changed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/core/pool.js";
import {
  DEFAULT_POOL, MAIN_ROW, POOL_ROWS, addProblem, isDefaultPool, movedRow, poolFamilies, poolFirst, poolLine, poolNext, poolPatch, poolRows,
  poolFrom, priceWords, rowNote, samePool, seatWords, withEffort, withModel, withRow, withoutRow,
} from "../src/ui/harness/lib/pool.js";
import { POOL_FOOT, POOL_UNSAVED, createPoolChip } from "../src/ui/harness/widgets/pool.js";
import { askedState, cardFacts, cardState } from "../src/ui/harness/conversation/agent-card.js";
import { fakeH, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";

const GLM = { model: "zai/glm-5.3", seats: 4 };
const FLASH = { model: "zai/glm-5.3-flash", seats: 3 };
const MAIN = { model: "", seats: 2 };
/** A row as the page holds it: a place in the order (U13-D15). @param {string} model */
const at = (model) => ({ model, seats: Infinity });
const settle = () => new Promise((r) => setImmediate(r));

describe("the list's rows on the page", () => {
  // (fails before: yes — the owner's plan of 11-05: a list is a chat's own alone; the chip said "as in Library", a
  // project's or a preset's, though none of them holds one any more)
  test("where the list in force comes from: this chat's own, else none — its agents on this chat's model", () => {
    const own = poolFrom([GLM, MAIN], "session");
    assert.deepEqual([own.note, own.own], ["this chat's own", true]);
    assert.match(own.title, /a card with a model of its own runs on that model$/);
    for (const source of ["default", "global", "project", "preset", undefined]) {
      const none = poolFrom([MAIN], source);
      assert.deepEqual([none.note, none.own], ["this chat's model", false], String(source));
      assert.equal(none.title, "None set: its agents run on this chat's model, as its main agent does, unless a card names one. A change here is this chat's own");
    }
  });

  // (fails before: yes — the owner's word of 11-05, "Fallback rows: model · account · effort": the page read a row's
  // model alone, so an edit on the Agents tab wrote the list back without each row's effort)
  test("a row says how hard its agents think on it: read, kept through every edit, written, and said in the line", () => {
    const rows = poolRows([{ model: "zai/glm-5.3", effort: "high" }, { model: "", effort: "model" }, { model: "zai/glm-5.3-flash", effort: "loud" }]);
    assert.deepEqual(rows, [{ model: "zai/glm-5.3", seats: Infinity, effort: "high" }, { model: "", seats: Infinity, effort: "model" }, at("zai/glm-5.3-flash")], "one no row may say is none");
    assert.deepEqual(poolPatch({}, movedRow(withModel(rows, 0, "zai/glm-5.2"), 0, 1)).subagents.pool, [{ model: "", effort: "model" }, { model: "zai/glm-5.2", effort: "high" }, { model: "zai/glm-5.3-flash" }]);
    const low = withEffort(rows, 2, "low");
    assert.deepEqual([low[2], withEffort(low, 2, "")[2], withEffort(rows, 0, "high") === rows, withEffort(rows, 0, "loud")[0]], [{ ...at("zai/glm-5.3-flash"), effort: "low" }, at("zai/glm-5.3-flash"), true, at("zai/glm-5.3")]);
    assert.deepEqual([samePool(rows, low), samePool(rows, poolRows(poolPatch({}, rows).subagents.pool))], [false, true], "an effort changed is an edit; the list written reads back the same");
    assert.equal(poolLine(low, "glm-5.3"), "GLM-5.3 (High) · GLM-5.3 (The model's own) · GLM-5.3 Flash (Low)");
  });

  // (fails before: yes — step 8: the page had no pool)
  test("the page's limits and its default are the server's", () => {
    assert.deepEqual([POOL_ROWS, DEFAULT_POOL], [core.POOL_ROWS, core.DEFAULT_POOL]);
    assert.equal(core.poolProblem(poolRows(undefined)), null, "what the page shows for no value is a pool the server stores");
  });

  // (fails before: yes — U13-D15 of 10-20: a row held a count of its own; now every row is a place in the order, and
  // since the owner's word of 11-05 nothing of Filament's own caps them: a model's limit does)
  test("a stored value as rows: a pool as it is, Filament's own prefix dropped, each row a place in the order; anything else is the default", () => {
    assert.deepEqual(poolRows([GLM, { model: "agent/claude-code/sonnet", seats: 1 }]), [at("zai/glm-5.3"), at("claude-code/sonnet")]);
    assert.deepEqual(poolRows([{ model: "x" }, MAIN]), [at("x"), at("")]);
    for (const bad of [undefined, null, "glm", [], [{ model: 1, seats: 1 }], [null]])
      assert.deepEqual(poolRows(bad), [at("")], JSON.stringify(bad));
    assert.deepEqual(poolRows([{ model: "x", seats: 0 }, { model: "y", seats: 1.5 }]), [at("x"), at("y")], "an old row's count, whatever it says, is none of the list's");
    assert.notEqual(poolRows(undefined)[0], DEFAULT_POOL[0], "a list of its own: an edit never reaches the default");
    assert.deepEqual([isDefaultPool(poolRows(undefined)), isDefaultPool([GLM]), isDefaultPool([{ model: "", seats: 5 }])], [true, false, true], "your chat's model alone, whatever count an older list held");
    assert.deepEqual([samePool([GLM, FLASH], [GLM, FLASH]), samePool([GLM, FLASH], [FLASH, GLM]), samePool([GLM], [GLM, FLASH])], [true, false, false], "the order is part of the list");
  });

  // (fails before: yes — the owner's word of 11-05: a list written kept a number of the chat's own, four unless set)
  test("a list written is an order alone: no number of the chat's goes with it", () => {
    assert.deepEqual(poolPatch({ "subagents.pool": [GLM, FLASH] }, [at("zai/glm-5.3-flash"), at("zai/glm-5.3")]), { subagents: { pool: [{ model: "zai/glm-5.3-flash" }, { model: "zai/glm-5.3" }] } });
    assert.deepEqual(poolPatch({}, [at(""), at("kimi-k2")]), { subagents: { pool: [{ model: "" }, { model: "kimi-k2" }] } });
  });

  // (fails before: yes — U13-D15: each model said its count, "GLM-5.3 × 4")
  test("the chip's line names each model as every chip does, in order, the nameless row by the main agent's model where the page knows it", () => {
    assert.equal(poolLine([GLM, FLASH]), "GLM-5.3 · GLM-5.3 Flash");
    assert.equal(poolLine([MAIN, GLM], "kimi-k2"), "Kimi K2 · GLM-5.3");
    assert.equal(poolLine([MAIN]), MAIN_ROW);
    assert.deepEqual([poolFirst([GLM, MAIN], "kimi-k2"), poolFirst([MAIN, GLM], "kimi-k2"), poolFirst([MAIN])], ["zai/glm-5.3", "kimi-k2", ""]);
  });

  // (fails before: yes — AG-260: the page named the pool's first row whatever the server would give, so a first row
  // that cannot run was promised, and warned of, for a launch the next row runs. Seen in a browser)
  test("what a card that names no model runs on: the seat the server says a launch takes now, the first row until it has said", () => {
    assert.equal(poolNext([GLM, MAIN], "kimi-k2"), "zai/glm-5.3", "the list has not answered: the first row");
    assert.equal(poolNext([GLM, MAIN], "kimi-k2", { model: "flash", own: false }), "flash", "the first row cannot run, or is full");
    assert.equal(poolNext([GLM, MAIN], "kimi-k2", { model: "m-old", own: true }), "kimi-k2", "the main agent's row: the model the composer names now");
    assert.equal(poolNext([GLM, MAIN], "", { model: "m-main", own: true }), "m-main");
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.equal(app.split("chat?.chainId ? subagentStore.nextSeat() : null)").length - 1, 2, "the Side tab's facts and the ask line's");
    assert.doesNotMatch(app, /poolFirst\(/);
    assert.match(app, /if \(change\.patch\?\.subagents\?\.pool \|\| change\.unset\?\.some\(\(p\) => p === "subagents\.pool"\)\) void subagentStore\.refresh\(\);/,
      "a list that changed is read again");
  });

  // (fails before: yes — the E26 closing drive, 10-22: in a team's chat the list's editor said "up to 4 at once in this
  // chat" while the server ran the team's number; the owner's word of 11-05: no chat has a number)
  test("no chat's number anywhere: the page reads none, the list route says none", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.doesNotMatch(app, /subagentStore\.most\(\)|"subagents\.most"/);
    const store = readFileSync("src/ui/harness/lib/subagents.js", "utf8");
    assert.doesNotMatch(store, /\bmost = /);
    const route = readFileSync("src/http/admin/sessions.js", "utf8");
    assert.match(route, /const seats = reg\.seatsNow\(r\.params\.id\);[\s\S]*limit: seats\.limit, nextSeat: seats\.nextSeat,/);
  });

  test("each edit is a new list, and the same one where it does not apply", () => {
    const rows = [GLM, FLASH];
    assert.deepEqual(movedRow(rows, 1, -1), [FLASH, GLM]);
    assert.deepEqual(movedRow(rows, 0, 1), [FLASH, GLM]);
    assert.deepEqual([movedRow(rows, 0, -1), movedRow(rows, 1, 1)], [rows, rows], "the ends stay");
    assert.deepEqual(withoutRow(rows, 0), [FLASH]);
    assert.equal(withoutRow([GLM], 0)[0], GLM, "the last row stays: a session with no model could run nobody");
    assert.deepEqual(withRow(rows, "agent/kimi-k2"), [GLM, FLASH, at("kimi-k2")]);
    assert.deepEqual(withRow(rows, ""), [GLM, FLASH, at("")]);
    assert.equal(withRow(rows, "zai/glm-5.3"), rows);
    assert.equal(addProblem(rows, "zai/glm-5.3"), "GLM-5.3 is already in the list: move its row up");
    assert.equal(addProblem([MAIN], ""), `${MAIN_ROW} is already in the list: move its row up`);
    const full = Array.from({ length: POOL_ROWS }, (_, i) => ({ model: `m${i}`, seats: 1 }));
    assert.equal(addProblem(full, "one-more"), `A pool holds at most ${POOL_ROWS} models`);
    assert.equal(withRow(full, "one-more"), full);
    assert.deepEqual(withModel(rows, 1, "kimi-k2"), [GLM, { model: "kimi-k2", seats: 3 }], "the row keeps its place");
    assert.deepEqual([withModel(rows, 1, "zai/glm-5.3"), withModel(rows, 1, "zai/glm-5.3-flash")], [rows, rows], "a model the list holds has one row");
    assert.deepEqual(rows, [GLM, FLASH], "the list handed in is never touched");
  });

  test("a row's words: its price per million tokens, and under it why it cannot run, that its model is full across your chats, or why it takes fewer now", () => {
    assert.deepEqual([priceWords({ input: 0.6, output: 2.2 }), priceWords({ input: 15, output: 75 }), priceWords({ input: 0, output: 0 }), priceWords(null)], ["$0.6 in · $2.2 out", "$15 in · $75 out", "", ""]);
    /** @type {any} */
    const seat = { model: "zai/glm-5.3", named: true, own: false, seats: 32, lent: 32, running: 0, problem: null, lends: "", limit: null, price: null };
    assert.equal(rowNote(seat), null, "a row that takes what it may says nothing");
    assert.equal(rowNote(null), null);
    assert.deepEqual(rowNote({ ...seat, lent: 2, lends: "2 at once: its provider takes 2" }), { text: "2 at once: its provider takes 2", tone: "info" });
    assert.deepEqual(rowNote({ ...seat, shared: { cap: 4, running: 4, set: null } }), { text: "All 4 at a time on this model are busy across your chats: the next on the list takes the agent", tone: "info" });
    assert.deepEqual(rowNote({ ...seat, lent: 0, problem: "signed out.", lends: "anything" }), { text: "Signed out: skipped until it can run", tone: "warn" }, "why it cannot run comes first");
  });

  // (fails before: yes — AG-241: there was no reading of a pool by maker)
  test("one per model family: the first model of each maker, in the pool's order; a maker the page does not know is a family of its own", () => {
    const rows = [GLM, FLASH, { model: "claude-code/sonnet", seats: 1 }, MAIN, { model: "weird-x", seats: 1 }, { model: "weird-y", seats: 1 }];
    assert.deepEqual(poolFamilies(rows, "kimi-k2"), [
      { family: "zhipu", model: "zai/glm-5.3" }, { family: "anthropic", model: "claude-code/sonnet" }, { family: "moonshot", model: "kimi-k2" },
      { family: "other:weird-x", model: "weird-x" }, { family: "other:weird-y", model: "weird-y" },
    ]);
    assert.deepEqual(poolFamilies([MAIN]), [], "the nameless row with no main agent's model names nobody");
    assert.deepEqual(poolFamilies([MAIN, GLM], "zai/glm-5.3-flash"), [{ family: "zhipu", model: "zai/glm-5.3-flash" }], "the main agent's model stands for its maker where it comes first");
  });

  // (fails before: yes — AG-236: nothing said a model was the pool's choice, or which rows a launch passed)
  test("an agent's model line: from the pool where a row of the list named its model, and what its launch passed; nothing for a model of its own", () => {
    assert.equal(seatWords(null), null);
    assert.equal(seatWords({ pooled: false, named: true }), null);
    assert.deepEqual(seatWords({ pooled: true, named: true }), { from: "from the pool", skipped: [] });
    assert.deepEqual(seatWords({ pooled: true, named: false }), { from: "", skipped: [] }, "the row that names none is the main agent's model: nothing new to say");
    assert.deepEqual(seatWords({ pooled: true, named: false, skipped: [{ model: "zai/glm-5.3", why: "signed out." }] }), { from: "", skipped: ["Skipped GLM-5.3: signed out"] },
      "a row passed on the way to it is said all the same");
  });
});

// (fails before: yes — AG-236: a card said its model and nothing of where it came from)
describe("an agent's card in the chat", () => {
  const SEAT = { pooled: true, named: true, skipped: [{ model: "zai/glm-5.3", why: "signed out" }] };
  /** The list's row of an agent at work. @param {any} [o] @returns {any} */
  const row = (o = {}) => ({ id: "sa_1", status: "running", model: "zai/glm-5.3-flash", seat: SEAT, exchanges: [{ status: "running", startedAt: 1_000, endedAt: null }, { status: "running", startedAt: 9_000, endedAt: null }], ...o });
  const now = { known: true, now: 60_000 };

  test("from the pool after the model, where a row of the list named it; the rows its launch passed on its first exchange's card only", () => {
    const first = cardState({ agentId: "sa_1", exchange: 0, at: 1_000 }, null, { ...now, row: row() });
    assert.deepEqual([first.model, first.seat], ["zai/glm-5.3-flash", { from: "from the pool", skipped: ["Skipped GLM-5.3: signed out"] }]);
    assert.equal(cardFacts(first), "GLM-5.3 Flash · from the pool");
    const again = cardState({ agentId: "sa_1", exchange: 1, at: 9_000 }, null, { ...now, row: row() });
    assert.deepEqual(again.seat, { from: "from the pool", skipped: [] }, "asked again: the same agent on the same model, nothing passed anew");
    const done = cardState({ agentId: "sa_1", exchange: 0, at: 1_000 }, { status: "done", answer: "Fine.", tokensIn: 4_000, tokensOut: 100, spentUsd: 0.01, ms: 9_000, model: "zai/glm-5.3-flash" }, { ...now, row: row() });
    assert.equal(cardFacts(done), "GLM-5.3 Flash · from the pool · 4.1k · $0.0100 · 9s");
  });

  test("the main agent's own model says nothing new, a row passed on the way to it is said; a model of the card's own, and a card the list no longer holds, say nothing", () => {
    const own = cardState({ agentId: "sa_1", exchange: 0 }, null, { ...now, row: row({ seat: { ...SEAT, named: false } }) });
    assert.deepEqual([cardFacts(own), own.seat?.skipped], ["GLM-5.3 Flash", ["Skipped GLM-5.3: signed out"]]);
    assert.equal(cardState({ agentId: "sa_1", exchange: 0 }, null, { ...now, row: row({ seat: null }) }).seat, null);
    assert.equal(cardState({ agentId: "sa_1", exchange: 0, model: "zai/glm-5.3-flash" }, null, { ...now, row: null }).seat, null);
  });

  test("the card of an agent the main agent launched says it too", () => {
    const s = askedState({ model: "", exchange: 0 }, { running: true, listed: false, row: row() });
    assert.deepEqual([s.model, cardFacts(s), s.seat?.skipped], ["zai/glm-5.3-flash", "GLM-5.3 Flash · from the pool", ["Skipped GLM-5.3: signed out"]]);
  });
});

describe("the list's chip and its editor", () => {
  /**
   * A chip over a stored list, with the editor's stand-ins: `pops` the editors opened, `pickers` the model pickers a
   * row or "Add a model" made, `asked` the lists the server was asked about.
   * @param {{ rows?: any, source?: string, main?: string, facts?: any, label?: any, inherit?: { level: string, desc: string } }} [o]
   */
  const rig = (o = {}) => {
    const { popover, pops } = recordingPopover();
    /** @type {any[]} */
    const pickers = [];
    /** @type {any[]} */
    const calls = [];
    /** @type {any[]} */
    const asked = [];
    const st = { rows: o.rows };
    /** The menus a row's effort chip opened, each its items. @type {any[][]} */
    const menus = [];
    const modelSelect = (/** @type {any} */ cb) => {
      const p = { cb, el: fakeH("span", { class: "model-select" }), name: "", models: /** @type {any[]} */ ([]), set(/** @type {string} */ n) { p.name = n; }, setModels(/** @type {any[]} */ m) { p.models = m; }, setFamilies() {}, setAccounts() {} };
      pickers.push(p);
      return p;
    };
    const chip = createPoolChip({
      rows: () => st.rows,
      ...(o.source ? { source: () => String(o.source) } : {}),
      main: () => o.main || "",
      models: () => [{ id: "zai/glm-5.3" }, { id: "kimi-k2" }],
      ...(o.facts ? { facts: async (/** @type {any} */ rows) => { asked.push(rows); return o.facts(rows); } } : {}),
      ...(o.label ? { label: o.label } : {}),
      ...(o.inherit ? { inherit: ((i) => () => i)(o.inherit) } : {}),
      onChange: (rows) => { calls.push(["change", rows]); st.rows = rows; },
      onUseDefault: () => calls.push(["default"]),
    }, { h: /** @type {any} */ (fakeH), popover: /** @type {any} */ (popover), modelSelect: /** @type {any} */ (modelSelect), menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); }) });
    chip.paint();
    const el = /** @type {any} */ (chip.el);
    /** The open editor's rows as text, one per row. */
    const rowsText = () => pops.at(-1).body.querySelector(".pool-rows").kids.map(textOf);
    /** A button of the open editor by its accessible name, in row `i`. @param {number} i @param {string} name */
    const act = (i, name) => buttonsOf(pops.at(-1).body.querySelector(".pool-rows").kids[i]).find((b) => b.attrs["aria-label"] === name);
    /** Row `i`'s effort chip in the open editor. @param {number} i */
    const effortIn = (i) => pops.at(-1).body.querySelector(".pool-rows").kids[i].querySelector(".ec");
    return { chip, el, pops, pickers, calls, asked, st, rowsText, act, menus, effortIn };
  };

  // (fails before: yes — the owner's word of 11-05, "include reasoning effort across every model picker": a row of the
  // list said its model alone, and an edit wrote it back without the effort it said)
  test("each row says how hard its agents think on its model, the main agent's by default; a pick is written as the editor closes, every other row's kept", () => {
    const r = rig({ rows: [{ ...GLM, effort: "low" }, MAIN], source: "session", main: "kimi-k2", inherit: { level: "high", desc: "The main agent's effort, as this chat sets it" } });
    assert.equal(textOf(r.el), "GLM-5.3 (Low) · Kimi K2");
    r.el.dispatch("click");
    const [low, inherited] = [r.effortIn(0), r.effortIn(1)];
    assert.deepEqual([low.attrs.title, inherited.attrs.title, low.classList.contains("is-default"), inherited.classList.contains("is-default")], ["How hard it thinks on GLM-5.3: Low", "How hard it thinks on Kimi K2: High", false, true]);
    inherited.dispatch("click");
    const items = r.menus[0];
    assert.equal(items.find((/** @type {any} */ x) => x.checked)?.label, "The default: High", "the main agent's");
    items.find((/** @type {any} */ x) => x.label === "Max").onClick();
    r.pops[0].close();
    assert.deepEqual(r.calls, [["change", [{ model: "zai/glm-5.3", seats: Infinity, effort: "low" }, { model: "", seats: Infinity, effort: "max" }]]]);
  });

  // (fails before: yes — the chip painted as it was made. The Team view is made before the page's session state is,
  // so the page threw at its start: seen in a browser, where no test had looked)
  test("the chip reads nothing as it is made: its first paint is its owner's, as every later one", () => {
    const early = () => { throw new Error("read before the page's state was there"); };
    const chip = createPoolChip({ rows: early, source: early, main: early, models: early, label: early, onChange: early, onUseDefault: early },
      { h: /** @type {any} */ (fakeH), popover: /** @type {any} */ (recordingPopover().popover), modelSelect: /** @type {any} */ (early) });
    assert.equal(textOf(/** @type {any} */ (chip.el)), "", "made, and empty");
    assert.throws(() => chip.paint(), /read before the page's state was there/, "a paint is what reads");
  });

  test("the chip says the list in a line, and its tooltip where it comes from; a paint reads the stored list again", () => {
    const r = rig({ rows: [GLM, MAIN], source: "session", main: "kimi-k2" });
    assert.equal(textOf(r.el), "GLM-5.3 · Kimi K2");
    assert.deepEqual([r.el.attrs.class, r.el.attrs["aria-haspopup"]], ["pool-chip", "dialog"]);
    // (fails before: yes — the tooltip said where the list comes from only; a narrow place cuts the line itself)
    assert.match(r.el.attrs.title, /^GLM-5\.3 · Kimi K2\nThis chat's own list\. An agent takes the first model with room/);
    r.st.rows = [FLASH];
    r.chip.paint();
    assert.equal(textOf(r.el), "GLM-5.3 Flash");
    // A list that is nobody's own (the global one) names no layer: the tooltip says how a launch takes a model.
    assert.equal(rig({ rows: [GLM] }).el.attrs.title, `GLM-5.3\n${POOL_FOOT}`);
    assert.equal(textOf(rig().el), MAIN_ROW, "no value stored: the one row every session starts from");
  });

  // (fails before: yes — U13-D15 of 10-20: with no number set, each row held a count of its own, stepped and written)
  test("the editor lists each model in the order a launch takes them, no number in its head and no count on a row; the moves and a row taken out edit a draft, written once as the editor closes", () => {
    const r = rig({ rows: [GLM, FLASH, MAIN], source: "session", main: "kimi-k2" });
    assert.equal(textOf(r.el), "GLM-5.3 · GLM-5.3 Flash · Kimi K2", "no count in the line");
    r.el.dispatch("click");
    const pop = r.pops[0];
    assert.deepEqual([pop.o.label, pop.o.width, pop.anchor], ["What this chat's agents run on", 560, r.el]);
    assert.equal(textOf(pop.body.querySelector(".pool-head")), "What this chat's agents run on|this chat's own", "no number of the chat's");
    assert.deepEqual(r.rowsText(), ["1", "2", `3|${MAIN_ROW}|Kimi K2`], "a named row's model is a picker of its own; the nameless row says whose model it is");
    assert.deepEqual([r.act(0, "One more at once"), pop.body.querySelector(".pool-step")], [undefined, null], "no stepper");
    assert.deepEqual(r.pickers.slice(0, 2).map((p) => [p.name, p.models.length]), [["zai/glm-5.3", 2], ["zai/glm-5.3-flash", 2]]);
    assert.equal(textOf(pop.body.querySelector(".pool-foot")), POOL_FOOT);
    // The ends are off: the first row cannot go earlier, the last cannot go later.
    assert.deepEqual([r.act(0, "Use it earlier").attrs.disabled, r.act(2, "Use it later").attrs.disabled, r.act(0, "Use it later").attrs.disabled], ["", "", undefined]);
    r.act(2, "Use it earlier").dispatch("click");
    r.act(0, "Take GLM-5.3 out").dispatch("click");
    assert.deepEqual(r.rowsText(), [`1|${MAIN_ROW}|Kimi K2`, "2"]);
    assert.deepEqual(r.calls, [], "nothing is written while the editor is open");
    pop.close();
    assert.deepEqual(r.calls, [["change", [at(""), at("zai/glm-5.3-flash")]]]);
    pop.close();
    assert.equal(r.calls.length, 1, "once");
    // Opened and closed with nothing moved: nothing written, though the stored rows held counts.
    const q = rig({ rows: [GLM] });
    q.el.dispatch("click");
    assert.equal(textOf(q.pops[0].body.querySelector(".pool-head")), "What this chat's agents run on");
    q.pops[0].close();
    assert.deepEqual(q.calls, []);
  });

  // (fails before: yes — the editor was placed empty and never again: a row added grew it downward, across the box it
  // hangs over. Seen in a browser)
  test("the editor is drawn before it is placed, and placed again when an edit or the server's answer changes its height", async () => {
    const r = rig({ rows: [GLM, FLASH], source: "session", facts: async () => ({ seats: [], total: 7 }) });
    r.el.dispatch("click");
    const pop = r.pops[0];
    assert.equal(pop.kidsWhenPlaced, 2, "its rows were there when the popover measured it");
    await new Promise((done) => setImmediate(done));
    assert.equal(pop.placed, 1, "the server's answer may add a note under a row");
    r.act(1, "Take GLM-5.3 Flash out").dispatch("click");
    assert.equal(pop.placed, 2, "a row less");
  });

  // (fails before: yes — the head kept saying where the stored list came from, and nothing said an edit is saved
  // as the editor closes: there is no Save to look for)
  test("the head says where the stored list comes from, and, once the list on screen differs, that it is saved when you close", () => {
    const r = rig({ rows: [GLM, FLASH], source: "session" });
    r.el.dispatch("click");
    const head = () => textOf(r.pops[0].body.querySelector(".pool-head"));
    assert.equal(head(), "What this chat's agents run on|this chat's own");
    r.act(0, "Use it later").dispatch("click");
    assert.equal(head(), `What this chat's agents run on|${POOL_UNSAVED}`);
    r.act(1, "Use it earlier").dispatch("click");
    assert.equal(head(), "What this chat's agents run on|this chat's own", "back to the stored list: nothing to save");
    // A list that is nobody's own (the global one, on Settings) has no layer to name, and says the same once changed.
    const g = rig({ rows: [GLM, FLASH] });
    g.el.dispatch("click");
    assert.equal(textOf(g.pops[0].body.querySelector(".pool-head")), "What this chat's agents run on");
    g.act(0, "Use it later").dispatch("click");
    assert.equal(textOf(g.pops[0].body.querySelector(".pool-head")), `What this chat's agents run on|${POOL_UNSAVED}`);
  });

  test("the last row stays; an editor closed as it opened writes nothing", () => {
    const r = rig({ rows: [{ model: "zai/glm-5.3", seats: 1 }] });
    r.chip.open();
    const last = "The last row stays: a session with no model could run nobody";
    assert.equal(r.act(0, last).attrs.disabled, "");
    r.act(0, last).dispatch("click");
    r.pops[0].close();
    assert.deepEqual(r.calls, [], "back where it started: the same list");
  });

  test("Add a model puts a row at the end, and the main agent's model has a button while the list lacks its row; a row's picker changes its model in place; a full list says so", () => {
    const r = rig({ rows: [GLM] });
    r.chip.open();
    const adds = () => r.pops[0].body.querySelector(".pool-add");
    assert.equal(textOf(adds()), `Add a model|${MAIN_ROW}`);
    // The picker "Add a model" holds is the last one a draw made.
    r.pickers.at(-1).cb.onChange("kimi-k2");
    r.pickers.at(-1).cb.onChange("kimi-k2");
    assert.deepEqual(r.rowsText(), ["1", "2"], "a model the list holds is added once");
    buttonsOf(adds()).find((b) => textOf(b) === MAIN_ROW).dispatch("click");
    assert.deepEqual(r.rowsText(), ["1", "2", `3|${MAIN_ROW}`]);
    assert.equal(textOf(adds()), "Add a model", "its row is in the list: no second one");
    // The first row's own picker (the first a draw makes) names another model.
    const drawn = r.pickers.length;
    r.act(0, "Use it later").dispatch("click");
    r.pickers[drawn].cb.onChange("zai/glm-5.3-flash");
    r.pops[0].close();
    assert.deepEqual(r.calls, [["change", [at("zai/glm-5.3-flash"), at("zai/glm-5.3"), at("")]]]);
    const full = rig({ rows: Array.from({ length: POOL_ROWS }, (_, i) => ({ model: `m${i}`, seats: 1 })) });
    full.chip.open();
    assert.equal(textOf(full.pops[0].body.querySelector(".pool-add")), `A pool holds at most ${POOL_ROWS} models`);
  });

  test("the editor asks what the rows on screen take now, at opening and after each edit: a row's price, and under a row why it cannot run or takes fewer; a late answer for older rows is dropped", async () => {
    /** @type {((v: any) => void)[]} */
    const held = [];
    // Each row's note says where it stood when asked, so an answer for an older order shows.
    const answer = (/** @type {any[]} */ rows) => ({
      total: 4,
      seats: rows.map((x, i) => ({
        model: x.model || "main-model", named: !!x.model, own: !x.model, seats: x.seats, lent: x.seats, running: 0,
        problem: x.model === "kimi-k2" ? "no route matches it" : null,
        lends: x.model === "kimi-k2" ? "" : `Asked as row ${i + 1}`,
        limit: null, price: x.model === "zai/glm-5.3" ? { input: 0.6, output: 2.2 } : null,
      })),
    });
    const r = rig({ rows: [GLM, { model: "kimi-k2", seats: 2 }, MAIN], facts: (/** @type {any[]} */ rows) => new Promise((res) => { held.push(() => res(answer(rows))); }) });
    r.chip.open();
    const pop = r.pops[0];
    held.shift()?.(undefined);
    await settle();
    assert.deepEqual(r.asked, [[at("zai/glm-5.3"), at("kimi-k2"), at("")]]);
    assert.deepEqual(r.rowsText(), ["1|$0.6 in · $2.2 out|Asked as row 1", "2|No route matches it: skipped until it can run", `3|${MAIN_ROW}|Asked as row 3`]);
    const rows = pop.body.querySelector(".pool-rows").kids;
    assert.deepEqual(rows.map((/** @type {any} */ x) => x.attrs.class), ["pool-row", "pool-row is-off", "pool-row"]);
    assert.deepEqual([rows[0].querySelector(".pool-note").attrs.class, rows[1].querySelector(".pool-note").attrs.class], ["pool-note is-info", "pool-note is-warn"]);
    // Two edits, answered out of order: only the answer for the rows on screen is drawn.
    r.act(0, "Use it later").dispatch("click");
    r.act(1, "Use it later").dispatch("click");
    assert.equal(r.asked.length, 3);
    const [first, second] = held.splice(0, 2);
    second(undefined);
    await settle();
    const now = ["1|No route matches it: skipped until it can run", `2|${MAIN_ROW}|Asked as row 2`, "3|$0.6 in · $2.2 out|Asked as row 3"];
    assert.deepEqual(r.rowsText(), now);
    first(undefined);
    await settle();
    assert.deepEqual(r.rowsText(), now, "the answer for the order before came late: not drawn");
    // An answer after the editor closed draws nothing and throws nothing.
    r.act(0, "Use it later").dispatch("click");
    pop.close();
    held.shift()?.(undefined);
    await settle();
    assert.deepEqual(r.calls, [["change", [at(""), at("kimi-k2"), at("zai/glm-5.3")]]]);
  });

  test("a server that does not answer leaves the rows as stored; the head's label is the caller's, read at each opening", async () => {
    let label = "Members run on";
    const r = rig({ rows: [GLM], facts: () => Promise.reject(new Error("Filament is not answering")), label: () => label });
    r.chip.open();
    await settle();
    assert.deepEqual([r.pops[0].o.label, r.rowsText(), r.pops[0].body.querySelector(".pool-total")], ["Members run on", ["1"], null]);
    r.pops[0].close();
    label = "Models for agents";
    r.chip.open();
    assert.equal(textOf(r.pops[1].body.querySelector(".pool-title")), "Models for agents");
  });

  test("Use the default closes the editor and is said once: the draft's edits are dropped, not written", () => {
    const r = rig({ rows: [GLM, FLASH], source: "session" });
    r.chip.open();
    r.act(0, "Use it later").dispatch("click");
    buttonsOf(r.pops[0].body).find((b) => textOf(b) === "Use the default").dispatch("click");
    assert.deepEqual([r.pops[0].closed, r.calls], [true, [["default"]]]);
  });
});
