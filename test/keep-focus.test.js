// @ts-check
// A view that draws itself again whole keeps the keyboard's place (src/ui/harness/lib/keep-focus.js; HarnessV4_Tasks
// U4): the Plan view rebuilds its nodes on every pulse of a run, and the control that had the focus was gone with them.
// The rules run here on a small tree of this file's own: children, a parent, attributes, a focus.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { controlSign, pathUnder, nodeAt, keepingFocus } from "../src/ui/harness/lib/keep-focus.js";

/** @type {{ activeElement: any }} */
const doc = { activeElement: null };

/** @param {string} tag @param {Record<string, string>} [attrs] @param {...any} kids */
const el = (tag, attrs = {}, ...kids) => {
  /** @type {any} */
  const node = {
    tagName: tag.toUpperCase(),
    attrs,
    children: /** @type {any[]} */ ([]),
    parentElement: null,
    text: "",
    get textContent() { return node.text + node.children.map((/** @type {any} */ k) => k.textContent).join(""); },
    getAttribute: (/** @type {string} */ k) => attrs[k] ?? null,
    contains: (/** @type {any} */ x) => { for (let at = x; at; at = at.parentElement) if (at === node) return true; return false; },
    focus: (/** @type {any} */ o) => { doc.activeElement = node; node.focused = o; },
    replaceChildren: (/** @type {any[]} */ ...next) => {
      for (const k of node.children) k.parentElement = null;
      node.children = next;
      for (const k of next) k.parentElement = node;
    },
  };
  for (const k of kids) {
    if (typeof k === "string") node.text += k;
    else { node.children.push(k); k.parentElement = node; }
  }
  return node;
};

/** The view as one draw makes it: a bar with two tabs, a card with its buttons. @param {{ second?: string, extra?: boolean }} [o] */
const drawn = ({ second = "Send back", extra = false } = {}) => [
  el("div", { class: "pv-bar" }, el("button", { role: "radio" }, "Graph"), el("button", { role: "radio" }, "Checklist")),
  el("div", { class: "pv-inner" }, ...(extra ? [el("p", {}, "A note above")] : []), el("div", { class: "tg-card" }, el("button", { title: "Open the run's log" }, "Log"), el("button", {}, second))),
];

describe("a view that draws itself again whole keeps the keyboard's place", () => {
  // (fails before: the module did not exist — a pulse rebuilt the Plan view's nodes, and the focus fell to the page)
  test("the focus goes back to the control that sits where the focused one sat, when it is the same one", () => {
    const root = el("div", { class: "plan-view" });
    root.replaceChildren(...drawn());
    const sendBack = root.children[1].children[0].children[1];
    sendBack.focus();
    assert.deepEqual(pathUnder(root, sendBack), [1, 0, 1]);
    assert.equal(controlSign(sendBack), "button|||Send back");
    keepingFocus(root, () => root.replaceChildren(...drawn()), doc);
    const now = root.children[1].children[0].children[1];
    assert.notEqual(now, sendBack, "a new node");
    assert.equal(doc.activeElement, now, "and it has the focus");
    assert.deepEqual(now.focused, { preventScroll: true }, "put back without moving the page");
    // A control named by its label keeps it whatever its words say now.
    const log = root.children[1].children[0].children[0];
    log.focus();
    keepingFocus(root, () => root.replaceChildren(...drawn()), doc);
    assert.equal(doc.activeElement, root.children[1].children[0].children[0]);
    assert.equal(controlSign(doc.activeElement), "button|||Open the run's log");
  });

  // (fails before: the module did not exist)
  test("a control that is gone, or another one now, is let go: the focus never lands where the person did not put it", () => {
    const root = el("div", { class: "plan-view" });
    root.replaceChildren(...drawn());
    const sendBack = root.children[1].children[0].children[1];
    sendBack.focus();
    // The same place holds another control now.
    keepingFocus(root, () => root.replaceChildren(...drawn({ second: "Start fresh" })), doc);
    assert.equal(doc.activeElement, sendBack, "nothing was focused in its place");
    // The tree moved: the place holds something else.
    root.replaceChildren(...drawn());
    root.children[1].children[0].children[1].focus();
    const before = doc.activeElement;
    keepingFocus(root, () => root.replaceChildren(...drawn({ extra: true })), doc);
    assert.equal(doc.activeElement, before);
    // The tree is gone below the place.
    root.replaceChildren(...drawn());
    root.children[1].children[0].children[1].focus();
    keepingFocus(root, () => root.replaceChildren(), doc);
    assert.equal(nodeAt(root, [1, 0, 1]), null);
    // The focus elsewhere on the page, or none, or no document: the redraw alone.
    const outside = el("input");
    outside.focus();
    let drew = 0;
    keepingFocus(root, () => { drew++; root.replaceChildren(...drawn()); }, doc);
    keepingFocus(root, () => { drew++; }, null);
    doc.activeElement = root;
    keepingFocus(root, () => { drew++; }, doc);
    assert.equal(drew, 3);
    assert.equal(pathUnder(root, root), null);
    assert.equal(pathUnder(root, outside), null);
  });

  // (fails before: yes — the host cleared the view and drew it again on each pulse, bare)
  test("the Plan view's redraws keep it: the host's on each pulse, and the view's own when the session's answer lands", () => {
    const host = readFileSync("src/ui/harness/views/host.js", "utf8");
    assert.match(host, /const drawPlan = \(\) => keepingFocus\(planEl, drawPlanNow\);/);
    assert.match(host, /const drawPlanNow = \(\) => \{\s+const reading = readNewest\(\);\s+const shows = viewOf\(chat\) === "plan";\s+if \(shows && reading && planView\?\.chat === chat\) return;/);
    assert.match(host, /if \(planView && planView\.chat === chat\) return planView\.paint\(\);/, "built once per chat, painted in place after");
    const plan = readFileSync("src/ui/harness/views/plan.js", "utf8");
    // Held while the canvas is dragged (canvas-pan.js), the draw asked meanwhile coming as it ends.
    assert.match(plan, /const paint = \(\) => \{\s+if \(holding\) return void \(due = true\);\s+if \(!gone\(\)\) keepingFocus\(body, paintNow\);\s+\};/);
    assert.match(plan, /function paintNow\(\) \{\s+d = read\(\);/);
  });
});
