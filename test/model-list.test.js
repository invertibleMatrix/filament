// @ts-check
// A list of models in the Library's editors (library/model-list.js) — an agent's, a team's lead's and its crew's —,
// each row at its effort (the owner's word of 11-05: "make sure to include reasoning effort across every model picker"):
// a chip beside each row's model offers the levels that model takes, its pick kept by the model's name and dropped as
// the model leaves the list; a row with none thinks as the main agent does, in the chat it runs in. DOM-free: the fake
// `h`, a stand-in model picker and menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effortsIn, modelList } from "../src/ui/harness/library/model-list.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { fakeH } from "./helpers/fake-dom.js";
import { modelSelects } from "./helpers/team-view.js";
import { all, every } from "./helpers/agents-page.js";

const member = (/** @type {string} */ id) => ({ id, effort: null, speed: null, thinking: null, window: null });
/** Grok takes three levels; GLM is none of the catalogue's: every agent level. */
const FAMILIES = [{ id: "grok", upstream: "x", kind: "model", members: [member("grok-4.6")], effort: { via: "setting", levels: ["low", "medium", "high"] }, speed: null, thinking: null, window: null }];

/** @param {{ models: string[], efforts?: Record<string, string> }} o */
const rig = (o) => {
  const pickers = modelSelects();
  /** @type {any[][]} */
  const menus = [];
  let changed = 0;
  const l = modelList({
    m: /** @type {any} */ (fakeH), models: o.models, most: 6, catalogue: () => [], pick: /** @type {any} */ (pickers.make), changed: () => { changed++; },
    ...(o.efforts ? { efforts: o.efforts } : {}), families: () => FAMILIES, menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); }),
  });
  const el = /** @type {any} */ (l.el);
  /** Each row's chip: its label and its words. */
  const chips = () => every(el, "ec").map((c) => [c.attrs["aria-label"], c.querySelector(".ec-words").textContent]);
  /** A row's chip, by its model. @param {string} name */
  const chipOf = (name) => every(el, "tset-model-row").find((r) => r.attrs["data-model"] === name)?.querySelector(".ec");
  return { l, el, pickers, menus, chips, chipOf, changed: () => changed };
};

// (fails before: yes — the owner's word of 11-05: a Library list's rows named a model alone)
test("each row's chip says its effort, the main agent's where none is set; its menu offers the levels its model takes; a pick is kept by the model's name", () => {
  /** @type {Record<string, string>} */
  const efforts = { "grok-4.6": "high" };
  const r = rig({ models: ["grok-4.6", "glm-5.3"], efforts });
  assert.deepEqual(r.chips(), [[`How hard it thinks on ${prettyModel("grok-4.6")}`, "High"], [`How hard it thinks on ${prettyModel("glm-5.3")}`, "The main agent's"]]);
  r.chipOf("grok-4.6").dispatch("click");
  assert.deepEqual(r.menus[0].filter((x) => x.type === "radio").map((x) => [x.label, x.checked]), [["The default: The main agent's", false], ["The model's own", false], ["Low", false], ["Medium", false], ["High", true]]);
  assert.equal(r.menus[0].find((x) => x.type === "radio").desc, "As the main agent thinks in the chat it runs in, unless that chat sets its own");
  r.menus[0].find((x) => x.label === "Low").onClick();
  r.chipOf("glm-5.3").dispatch("click");
  assert.ok(r.menus[1].some((x) => x.label === "Max"), "a model the catalogue does not know: every level");
  r.menus[1].find((x) => x.label === "Max").onClick();
  assert.deepEqual([efforts, r.changed()], [{ "grok-4.6": "low", "glm-5.3": "max" }, 2]);
  r.chipOf("grok-4.6").dispatch("click");
  r.menus[2].find((x) => x.label === "The default: The main agent's").onClick();
  assert.deepEqual(efforts, { "glm-5.3": "max" }, "the default: none kept");
});

// (fails before: yes)
test("a model taken out, or picked over, takes its effort with it; a list given none shows no chip", () => {
  /** @type {Record<string, string>} */
  const efforts = { "grok-4.6": "high", "glm-5.3": "max" };
  const models = ["grok-4.6", "glm-5.3"];
  const r = rig({ models, efforts });
  /** @type {any} */ (all(r.el, (x) => x.attrs?.["aria-label"] === `Take ${prettyModel("glm-5.3")} out`)[0]).dispatch("click");
  assert.deepEqual([models, efforts], [["grok-4.6"], { "grok-4.6": "high" }]);
  r.pickers.made.findLast((p) => p.name === "grok-4.6").o.onChange("kimi-k2");
  assert.deepEqual([models, efforts, r.chips().map(([, w]) => w)], [["kimi-k2"], {}, ["The main agent's"]]);
  assert.deepEqual(rig({ models: ["grok-4.6"] }).chips(), [], "a member's one model: no effort of its own here");
  assert.deepEqual(effortsIn(["a", "b"], { b: "low", c: "high" }), { b: "low" }, "what an editor sends: the list's own, in its order");
});
