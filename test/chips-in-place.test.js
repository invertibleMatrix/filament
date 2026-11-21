// @ts-check
// The message box's chips drawn again at each view of the chat keep the elements under the pointer (the owner's of
// 11-01: "when i hover over my mouse over some interactive elements like buttons then those are just suppose to
// highlight only once they quite a lot of time they start blinking … and during that sometimes the clicks even don't
// pass through so i have to press more than once"). The tune chip's glyph, the model chip's tile and the mode chip's
// face were made anew at every paint, and the open tuning popover at every view of the chat — its levels new elements
// under a resting pointer, the level it lit ahead of a press gone dark —, and the model picker's tabs and rows at each
// press and word typed. Drawn in place (dom.js `morphChildren`), each is the element that stood.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/composer/effort.js")} */
let effort;
/** @type {typeof import("../src/ui/harness/composer/model.js")} */
let model;
/** @type {typeof import("../src/ui/harness/composer/mode.js")} */
let mode;
before(async () => {
  doc = stubDocument();
  effort = await import("../src/ui/harness/composer/effort.js");
  model = await import("../src/ui/harness/composer/model.js");
  mode = await import("../src/ui/harness/composer/mode.js");
});
after(() => doc.restore());

/** The same element, never compared by its shape. @param {any} now @param {any} was @param {string} what */
const same = (now, was, what) => assert.ok(now != null && now === was, `${what}: the element that stood`);
/** A family as `/api/models` folds one. @param {Record<string, any>} o @returns {any} */
const fam = (o) => ({ kind: "model", members: [{ id: o.id, effort: null, speed: null, thinking: null, window: null }], effort: null, speed: null, thinking: null, window: null, ...o });

test("the tune chip and its open popover, drawn again at a view of the chat, keep their parts; the level the pointer rests on stays lit, and its press tunes", () => {
  const body = /** @type {any} */ (doc.document.body);
  body.replaceChildren();
  /** @type {string[]} */
  const tuned = [];
  const c = effort.createEffortControl({ onTune: (_t, changed) => tuned.push(changed) });
  body.append(c.el);
  const opus = fam({ id: "claude-opus-5-5", upstream: "anthropic", effort: { via: "setting", levels: ["low", "medium", "high"], default: "high" } });
  const tuning = { effort: "medium", speed: "standard", thinking: "off", window: 0 };
  c.setFamily(opus, tuning);
  const glyph = /** @type {any} */ (c.el).querySelector(".tune-glyph-art");
  c.open();
  const high = body.querySelectorAll(".tp-level")[2];
  const caption = body.querySelector(".tp-caption");
  high.dispatch("pointerenter");
  assert.ok(high.classList.contains("is-preview"), "the pointer on High lights the meter to it");
  const saying = caption.textContent;
  // The chat's view comes in while the pointer rests there.
  c.setFamily(opus, tuning);
  c.setNote("this session");
  same(/** @type {any} */ (c.el).querySelector(".tune-glyph-art"), glyph, "the chip's glyph");
  same(body.querySelectorAll(".tp-level")[2], high, "High");
  same(body.querySelector(".tp-caption"), caption, "the meter's caption");
  assert.ok(high.classList.contains("is-preview"), "the level under the pointer stays lit");
  assert.equal(caption.textContent, saying, "and the caption says it still");
  high.dispatch("click");
  assert.deepEqual(tuned, ["effort"]);
  same(body.querySelectorAll(".tp-level")[2], high, "High, chosen");
  assert.equal(high.getAttribute("aria-checked"), "true", "the choice painted on the level that stood");
  high.dispatch("pointerleave");
  assert.ok(!body.querySelectorAll(".tp-level").some((/** @type {any} */ b) => b.classList.contains("is-preview")), "the pointer gone, nothing lit ahead");
});

test("the model chip's tile stays at a view of the chat; the picker's tab pressed and a row a search keeps stay", () => {
  const body = /** @type {any} */ (doc.document.body);
  body.replaceChildren();
  const s = /** @type {any} */ (model.createModelSelect({ onPick: () => {} }));
  body.append(s.el);
  s.setFamilies([fam({ id: "cc/haiku", upstream: "cc", label: "Haiku 4.5" }), fam({ id: "cc/opus", upstream: "cc" }), fam({ id: "gpt-5.5", upstream: "openai" })]);
  s.set("cc/haiku");
  const tile = s.el.querySelector(".model-chip-tile").firstElementChild;
  s.setNote("this session");
  s.setModels([]);
  same(s.el.querySelector(".model-chip-tile").firstElementChild, tile, "the chip's tile");
  s.el.onclick({ stopPropagation() {} });
  const opus = body.querySelectorAll(".mp-row")[1];
  const search = body.querySelector(".mp-search-input");
  search.value = "opus";
  search.oninput();
  same(body.querySelector(".mp-row"), opus, "the row the search keeps");
  search.value = "";
  search.oninput();
  const second = body.querySelectorAll(".mp-source")[1];
  second.dispatch("click");
  same(body.querySelectorAll(".mp-source")[1], second, "the tab pressed");
  assert.ok(second.classList.contains("is-on"), "and it is the one on");
});

test("the mode chip's face stays as the chat's mode and its turn move", () => {
  const body = /** @type {any} */ (doc.document.body);
  body.replaceChildren();
  const sw = mode.createModeSwitch();
  const chip = /** @type {any} */ (sw.el);
  body.append(chip);
  const label = chip.querySelector(".mode-label");
  const icon = chip.querySelector(".mode-ic");
  sw.set("auto");
  sw.setLive(true);
  sw.setNote("this session");
  same(chip.querySelector(".mode-label"), label, "the chip's words");
  same(chip.querySelector(".mode-ic"), icon, "the chip's shield");
  assert.equal(label.textContent, "Full access");
});
