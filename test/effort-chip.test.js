// @ts-check
// An agent's effort beside its model (the owner's word of 11-05: "include reasoning effort across every model
// picker"): one chip, the composer's pattern, its menu the default — what it inherits, said —, "The model's own" where
// the row takes it, then the levels the model beside it takes; every agent level where the catalogue does not know it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeH } from "./helpers/fake-dom.js";
import { FITS_BELOW, chipChoices, effortChip } from "../src/ui/harness/lib/effort-chip.js";
import { AGENT_LEVELS, levelsIn } from "../src/ui/harness/lib/families.js";

const member = (/** @type {string} */ id) => ({ id, effort: null, speed: null, thinking: null, window: null });
const FAMILIES = [
  { id: "brain-a", upstream: "m", kind: "model", members: [member("brain-a")], effort: { via: "setting", levels: ["none", "minimal", "low", "high", "max"] }, speed: null, thinking: null, window: null },
  { id: "brain-b", upstream: "n", kind: "model", members: [member("brain-b")], effort: null, speed: null, thinking: null, window: null },
];
const INHERIT = { level: "high", desc: "The main agent's effort" };

// (fails before: yes — no chip offered an agent's effort beside a model a card, a team or this chat's rows name)
test("its choices: the default with what it inherits, the model's own, then the levels its model takes — every agent level where the catalogue does not know it", () => {
  assert.deepEqual([levelsIn(FAMILIES, "brain-a"), levelsIn(FAMILIES, "brain-b"), levelsIn(FAMILIES, "brain-z"), levelsIn(FAMILIES, "")], [["low", "high", "max"], [], null, null]);
  const ids = (/** @type {any} */ o) => chipChoices({ inherit: INHERIT, own: true, ...o }).map((c) => c.id);
  assert.deepEqual(ids({ level: "", levels: ["low", "high", "max"] }), ["", "model", "low", "high", "max"]);
  assert.deepEqual(ids({ level: "", levels: null }), ["", "model", ...AGENT_LEVELS], "a model it does not know");
  assert.deepEqual(ids({ level: "", levels: [] }), [""], "one that takes none");
  assert.deepEqual(chipChoices({ level: "", levels: null, inherit: INHERIT, own: false }).map((c) => c.id), ["", ...AGENT_LEVELS], "a row that takes no model's own");
  const fitted = chipChoices({ level: "medium", levels: ["low", "high", "max"], inherit: INHERIT, own: true });
  assert.deepEqual(fitted.map((c) => [c.id, c.on, c.desc]), [["", false, "The main agent's effort"], ["model", false, "The level its model takes by itself"], ["low", false, ""], ["medium", true, FITS_BELOW], ["high", false, ""], ["max", false, ""]], "a level picked that it does not take stays, said as the server fits it");
  assert.equal(chipChoices({ level: "", levels: null, inherit: INHERIT, own: true })[0].name, "The default: High");
});

// (fails before: yes)
test("the chip: its level in words, the default's quieter; a pick goes to its caller; its menu reads the model beside it at each open", () => {
  /** @type {any[]} */
  const menus = [];
  /** @type {string[]} */
  const picks = [];
  let model = "brain-a";
  const chip = effortChip({ label: "How hard Reviewer thinks", onChange: (l) => picks.push(l), model: () => model, families: () => FAMILIES, inherit: () => INHERIT, mk: fakeH, menu: /** @type {any} */ ((items, o) => (menus.push({ items, o }), { el: null, close() {}, set() {} })) });
  const el = /** @type {any} */ (chip.el);
  const words = () => el.querySelector(".ec-words").textContent;
  assert.deepEqual([words(), chip.el.classList.contains("is-default"), chip.value()], ["High", true, ""]);
  // (fails before: yes — the review of 5ff8bcb56: a screen reader heard its name alone, never the level picked)
  assert.equal(el.attrs.title, "How hard Reviewer thinks: High", "its level said beside its name");
  el.attrs.onclick();
  const radios = menus[0].items.filter((/** @type {any} */ i) => i.type === "radio");
  assert.deepEqual(radios.map((/** @type {any} */ r) => r.label), ["The default: High", "The model's own", "Low", "High", "Max"]);
  assert.equal(menus[0].o.anchor, chip.el);
  radios.at(-1).onClick();
  assert.deepEqual([picks, words(), chip.el.classList.contains("is-default"), chip.value(), el.attrs.title], [["max"], "Max", false, "max", "How hard Reviewer thinks: Max"]);
  model = "brain-b";
  el.attrs.onclick();
  assert.deepEqual(menus[1].items.filter((/** @type {any} */ i) => i.type === "radio").map((/** @type {any} */ r) => r.label), ["The default: High", "Max"], "one that takes none: its default, and the level kept");
  assert.equal(menus[1].items.at(-1).label, "This model takes no effort setting: it thinks as it does");
  chip.set("");
  assert.deepEqual([words(), chip.value(), picks.length], ["High", "", 1], "set tells no one");
});
