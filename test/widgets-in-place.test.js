// @ts-check
// The widgets drawn again as their figures move keep the elements under the pointer (the owner's of 11-01: "when i
// hover over my mouse over some interactive elements like buttons then those are just suppose to highlight only once
// they quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have
// to press more than once"). A pill's face, an open popover's live parts and an Overview tile are drawn again at every
// frame of a streaming reply; they were made anew each time — a tile's Stop, the Cache popover's lifetime choice, the
// Team popover's Back, a popover page's buttons and the field typed in on it new elements under a resting pointer, whose
// hover started over and where a press that began on the old one never clicked. Drawn in place (dom.js
// `morphChildren`), each is the element that stood, its words and its handler the newest draw's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { KNOBS } from "../src/services/session-settings.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/lib/dom.js").h} */
let h;
/** @type {typeof import("../src/ui/harness/widgets/frame.js")} */
let frame;
/** @type {typeof import("../src/ui/harness/widgets/kit.js")} */
let kit;
/** @type {typeof import("../src/ui/harness/widgets/cache.js")} */
let cache;
/** @type {typeof import("../src/ui/harness/widgets/team.js")} */
let team;
/** @type {typeof import("../src/ui/harness/widgets/context.js")} */
let context;
before(async () => {
  doc = stubDocument();
  ({ h } = await import("../src/ui/lib/dom.js"));
  frame = await import("../src/ui/harness/widgets/frame.js");
  kit = await import("../src/ui/harness/widgets/kit.js");
  cache = await import("../src/ui/harness/widgets/cache.js");
  team = await import("../src/ui/harness/widgets/team.js");
  context = await import("../src/ui/harness/widgets/context.js");
});
after(() => doc.restore());

/** The same element, never compared by its shape. @param {any} now @param {any} was @param {string} what */
const same = (now, was, what) => assert.ok(now != null && now === was, `${what}: the element that stood`);
/** The page's popover, as far as a widget reads it: its body put on the page, taken off as it closes. @type {any} */
const popover = (/** @type {any} */ _anchor, /** @type {any} */ body) => {
  doc.document.body.append(body);
  return { el: body, close: () => body.remove() };
};
/** A button by its words. @param {any} at @param {string} label @returns {any} */
const button = (at, label) => at.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;

/**
 * A widget context over a fixed session view, every action a no-op unless the test records it.
 * @param {any} view @param {Record<string, any>} [over] @returns {any}
 */
const ctxOf = (view, over = {}) => ({
  view: () => view,
  hasSession: () => true,
  knobs: () => KNOBS,
  presets: () => ({ presets: {} }),
  models: () => [],
  live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false }),
  turns: () => [],
  write: () => {},
  preview: async () => null,
  subagents: { rows: () => [], models: () => [], sessionModel: () => "m" },
  team: { open: () => {}, back: () => {}, wait: () => null },
  ...over,
});

test("a pill's face and its open popover's Now, drawn again as their figures move, keep their parts; a press acts on the newest draw", () => {
  let n = 1;
  /** @type {string[]} */
  const did = [];
  const pill = frame.featureWidget({
    id: "run",
    label: "Run",
    state: () => `step ${n}`,
    face: (m) => [m("span", { class: "face-num" }, String(n)), m("span", { class: "face-dot" })],
    liveNow: true,
    now: () => {
      const at = n;
      return h("div", { class: "now-row" }, h("span", {}, `At step ${at}`), h("button", { type: "button", onclick: () => did.push(`stop at ${at}`) }, "Stop"));
    },
  }, { popover });
  doc.document.body.append(pill.el);
  const num = /** @type {any} */ (pill.el.querySelector(".face-num"));
  const dot = pill.el.querySelector(".face-dot");
  pill.show();
  const body = doc.document.body;
  const stop = button(body, "Stop");
  const title = body.querySelector(".widget-title");
  n = 2;
  pill.paint();
  same(pill.el.querySelector(".face-num"), num, "the face's figure");
  assert.equal(num.textContent, "2", "its words the newest");
  same(pill.el.querySelector(".face-dot"), dot, "the face's dot");
  same(button(body, "Stop"), stop, "the Now section's Stop");
  same(body.querySelector(".widget-title"), title, "the popover's title");
  assert.equal(title.textContent, "Run: step 2");
  stop.dispatch("click");
  assert.deepEqual(did, ["stop at 2"], "the press is the newest draw's");
  pill.close();
});

test("an Overview tile drawn again keeps its Stop and its words' parts", () => {
  let n = 1;
  /** @type {string[]} */
  const did = [];
  const tile = frame.featureTile({
    id: "agents",
    label: "Agents",
    state: () => String(n),
    tileSub: () => `${n} at work`,
    tile: (m) => {
      const at = n;
      return m("div", { class: "tile-body" }, m("span", { class: "tile-n" }, String(at)), m("button", { type: "button", onclick: () => did.push(`stop ${at}`) }, "Stop"));
    },
  }, { popover });
  doc.document.body.append(tile.el);
  const stop = button(tile.el, "Stop");
  const figure = /** @type {any} */ (tile.el.querySelector(".tile-n"));
  n = 3;
  tile.paint();
  same(button(tile.el, "Stop"), stop, "the tile's Stop");
  same(tile.el.querySelector(".tile-n"), figure, "the tile's figure");
  assert.equal(figure.textContent, "3");
  assert.equal(tile.el.querySelector(".ov-tile-sub")?.textContent, "3 at work");
  stop.dispatch("click");
  assert.deepEqual(did, ["stop 3"]);
  tile.el.remove();
});

test("a popover's page drawn again keeps its buttons and the field being typed in; a page pushed keeps its slide through a repaint", () => {
  let n = 1;
  /** @type {string[]} */
  const did = [];
  const p = kit.pages(h);
  doc.document.body.append(p.el);
  p.open(() => {
    const at = n;
    return h("div", { class: "page" }, h("input", { class: "field", type: "text" }), h("button", { type: "button", onclick: () => did.push(`save ${at}`) }, `Save ${at}`));
  });
  const field = p.el.querySelector(".field");
  // The field being typed in has the focus.
  const page = /** @type {any} */ (doc.document);
  page.activeElement = field;
  field.value = "half typed";
  const save = p.el.querySelector("button");
  n = 2;
  p.repaint();
  same(p.el.querySelector(".field"), field, "the field");
  assert.equal(field.value, "half typed", "what was typed stays");
  page.activeElement = null;
  same(p.el.querySelector("button"), save, "Save");
  assert.equal(save.textContent, "Save 2");
  save.dispatch("click");
  assert.deepEqual(did, ["save 2"]);
  p.push(() => h("div", { class: "page2" }, h("button", { class: "inst-back", type: "button" }, "Back")));
  const back = p.el.querySelector(".inst-back");
  p.repaint();
  same(p.el.querySelector(".inst-back"), back, "the pushed page's Back");
  assert.ok(p.el.firstElementChild.classList.contains("inst-page-in-fwd"), "the page drawn again keeps the way it came in");
  p.el.remove();
});

test("the open Cache popover drawn again keeps its lifetime choice; a press on it writes, and the chosen one is painted on the button that stood", () => {
  const now = Date.now();
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: now - 60_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const view = { settings: { usage, effective: { context: { results: "keep" } }, cache: { ttl: "5m", from: "rules", settable: true } } };
  const turns = [{ n: 1, facts: { tokens: { input: 100, cacheRead: 0, cacheWrite: 900, cacheWrite1h: 0 } } }];
  /** @type {any[]} */
  const writes = [];
  const pill = frame.featureWidget(cache.cacheWidget(ctxOf(view, { write: (/** @type {any} */ c) => writes.push(c), turns: () => turns }), {}), { popover });
  doc.document.body.append(pill.el);
  pill.show();
  const body = doc.document.body.querySelector(".widget-pop-cache");
  const hour = button(body, "1 hour");
  const five = button(body, "5 min");
  assert.equal(five.getAttribute("aria-checked"), "true");
  pill.paint();
  same(button(body, "1 hour"), hour, "1 hour");
  same(button(body, "5 min"), five, "5 min");
  hour.dispatch("click");
  assert.deepEqual(writes, [{ patch: { model: { cacheTtl: "1h" } } }], "the press writes the chat's setting");
  view.settings.cache = { ttl: "1h", from: "chat", settable: true };
  pill.paint();
  same(button(body, "1 hour"), hour, "1 hour, once chosen");
  assert.equal(hour.getAttribute("aria-checked"), "true", "the choice painted on the button that stood");
  assert.equal(five.getAttribute("aria-checked"), "false");
  pill.close();
  pill.el.remove();
});

test("the open Team popover drawn again keeps Back to your agent, and its press goes back", () => {
  const FOUR = [{ tag: "scout", name: "Scout", may: "read", place: "scout" }, { tag: "builder", name: "Builder", may: "edit", place: "builder" }];
  const teams = [{ key: "architect", name: "Architect", line: "Boundaries first", shipped: true, lead: { tag: "architect", name: "Architect" }, members: FOUR }];
  const view = { settings: { engine: { mode: "team", team: "architect", teams }, effective: { engine: {} }, usage: { usd: 0.42 } } };
  /** @type {string[]} */
  const did = [];
  const pill = frame.featureWidget(team.teamWidget(ctxOf(view, { team: { open: () => {}, back: () => did.push("back"), wait: () => null } })), { popover });
  doc.document.body.append(pill.el);
  pill.show();
  const body = doc.document.body.querySelector(".widget-pop-team");
  const back = button(body, "Back to your agent");
  pill.paint();
  pill.paint();
  same(button(body, "Back to your agent"), back, "Back to your agent");
  back.dispatch("click");
  assert.deepEqual(did, ["back"]);
  pill.el.remove();
});

test("the context line's chip drawn again keeps its parts", () => {
  const line = context.lineControl(h, { percent: () => 80, window: () => 200_000, onSet: () => {}, toast: () => {} });
  doc.document.body.append(line.chip);
  line.paint({ tokens: 150_000, percent: 75 });
  const chev = line.chip.querySelector(".inst-line-chev");
  line.paint({ tokens: 160_000, percent: 80 });
  same(line.chip.querySelector(".inst-line-chev"), chev, "the chip's chevron");
  assert.ok(line.chip.textContent.includes("80%"), line.chip.textContent);
  line.chip.remove();
});
