// @ts-check
// The Flows row's pane drawn again keeps the rows and buttons under the pointer (the owner's of 11-01: "when i hover
// over my mouse over some interactive elements like buttons then those are just suppose to highlight only once they
// quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to
// press more than once"). The home was placed anew whole at each key typed into What is it for, each press on a start
// and each read of the saved flows: a start's row, its Forget and New flow new elements under a resting pointer, whose
// hover started over and where a press that began on the old one never clicked. Drawn in place (dom.js
// `morphChildren`), each keyed by what it is, they are the elements that stood.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { FLOW_HOME } from "../src/ui/harness/lib/flow.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/views/flow.js")} */
let views;
before(async () => {
  doc = stubDocument();
  views = await import("../src/ui/harness/views/flow.js");
});
after(() => doc.restore());

const settle = () => new Promise((r) => setImmediate(r));
/** A saved flow of the person's own, one step of the PM's. @param {string} key @param {string} name */
const saved = (key, name) => ({ key, name, shipped: false, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "plan" }] }] });
const SHIPPED = { key: "plan-check-build-hunt", name: "Plan, check, build, hunt", shipped: true, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "plan" }] }, { boxes: [{ kind: "review", agent: "", words: "" }] }] };

/** The pane over saved flows the test moves. */
const paneOf = () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {string[]} */
  const created = [];
  let loads = 0;
  const at = { saved: /** @type {any[]} */ ([SHIPPED, saved("mine", "Mine")]) };
  const routes = new Proxy({}, { get: (_, name) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true, flow: { id: "fl-1" } }); } });
  /** @type {any} */
  const io = {
    rows: () => [],
    cards: () => [{ tag: "pm", name: "PM" }],
    teams: () => [],
    press: (/** @type {any} */ fn) => fn(routes),
    saved: () => at.saved,
    loadSaved: () => { loads++; },
    created: (/** @type {any} */ f) => created.push(f.id),
  };
  const p = views.createFlowPane(io, /** @type {any} */ ({ card: () => doc.document.createElement("div") }));
  const el = /** @type {any} */ (p.el);
  doc.document.body.append(el);
  const chat = { chainId: "c1" };
  p.paint(chat, FLOW_HOME);
  return { el, calls, created, at, loads: () => loads, paint: () => p.paint(chat, FLOW_HOME) };
};
/** The starts' rows. @param {any} el @returns {any[]} */
const rows = (el) => el.querySelectorAll('[role="radio"]');
/** A button by its words. @param {any} at @param {RegExp} words @returns {any} */
const button = (at, words) => at.querySelectorAll("button").find((/** @type {any} */ b) => words.test(b.textContent)) || null;

// (fails before: yes — the home was placed anew whole at each draw: its rows, Forget and New flow new elements)
test("drawn again as the saved flows are read and as the field is typed in, the starts' rows, Forget and New flow stand, and a press on each lands", async () => {
  const v = paneOf();
  try {
    const [nothing, shipped, mine] = rows(v.el);
    const forget = button(v.el, /^Forget$/);
    const make = button(v.el, /New flow$/);
    const goal = v.el.querySelector("textarea");
    assert.ok(nothing && shipped && mine && forget && make && goal, "a row for Nothing and each saved flow, Mine's Forget, New flow and the field");
    assert.equal(make.hasAttribute("disabled"), true, "nothing typed: New flow waits");
    // The saved flows are read again, one more among them: the rows that stood stand, the new one after them.
    v.at.saved = [...v.at.saved, saved("other", "Other")];
    v.paint();
    assert.deepEqual(rows(v.el).slice(0, 3), [nothing, shipped, mine], "the rows that stood");
    assert.equal(rows(v.el).length, 4);
    assert.equal(button(v.el, /^Forget$/), forget, "Mine's Forget");
    assert.equal(button(v.el, /New flow$/), make, "New flow");
    assert.equal(v.el.querySelector("textarea"), goal, "the field");
    // Words typed: New flow wakes, the button it was.
    goal.value = "plan the desktop app";
    goal.dispatch("input");
    assert.equal(button(v.el, /New flow$/), make);
    assert.equal(make.hasAttribute("disabled"), false, "with words, New flow is live");
    assert.equal(v.el.querySelector("textarea").value, "plan the desktop app", "the words typed stay in the field that stood");
    // A press on the shipped flow's row picks it, in the row that stood.
    shipped.dispatch("click");
    assert.equal(rows(v.el)[1], shipped);
    assert.deepEqual(rows(v.el).map((/** @type {any} */ r) => r.getAttribute("aria-checked")), ["false", "true", "false", "false"]);
    assert.equal(shipped.classList.contains("is-on"), true);
    // A press on Mine's Forget forgets it, and reads the saved flows again.
    forget.dispatch("click");
    await settle();
    assert.deepEqual(v.calls.at(-1), ["forget", "mine"]);
    assert.equal(v.loads(), 1);
    // A press on New flow drafts from the start picked, with the words typed.
    make.dispatch("click");
    await settle();
    assert.deepEqual(v.calls.at(-1), ["create", { saved: "plan-check-build-hunt", goal: "plan the desktop app" }]);
    assert.deepEqual(v.created, ["fl-1"]);
  } finally {
    v.el.remove();
  }
});
