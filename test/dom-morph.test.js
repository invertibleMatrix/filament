// @ts-check
// The page's update in place (src/ui/lib/dom.js `morph`, `morphChildren`, `on`; the owner's of 11-01: "when i hover
// over … buttons … they start blinking … quickly highlight and then unhighlight and cycle goes on and during that
// sometimes the clicks even don't pass through"). A part drawn again keeps every element that still stands for the same
// thing — the one under the pointer keeps its hover, a press that began on it ends on it — and the element kept acts on
// the newest draw: its attributes, its words and its handlers are the new draw's.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { h, morph, morphChildren, on, setHtml, standing } from "../src/ui/lib/dom.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => {
  doc = stubDocument();
});
afterEach(() => doc.restore());

/** The words under a node. @param {any} el */
const text = (el) => String(el.textContent);

describe("morph: a part drawn again keeps its elements", () => {
  // (fails before: yes — dom.js had no update in place: every list was drawn with replaceChildren, a new element each draw)
  test("a row drawn again is the same element, with the new draw's class, words, attributes and handler", () => {
    const heard = /** @type {string[]} */ ([]);
    const list = h("div", {}, h("div", { "data-key": "a", class: "row is-works", title: "old", onclick: () => heard.push("old") }, "working"));
    const row = list.childNodes[0];
    morphChildren(list, [h("div", { "data-key": "a", class: "row is-done", onclick: () => heard.push("new") }, "finished")]);
    assert.equal(list.childNodes[0], row, "the same element");
    assert.equal(row.className, "row is-done");
    assert.equal(text(row), "finished");
    assert.equal(row.getAttribute("title"), null, "an attribute the new draw lacks goes");
    row.dispatch("click");
    assert.deepEqual(heard, ["new"], "the press acts on the newest draw");
    assert.equal(row.listeners.click.length, 1, "one listener per event, never one per draw");
  });

  test("rows keep themselves by their key as the list moves: kept ones moved, new ones in, gone ones out", () => {
    const list = h("ul", {}, ...["a", "b", "c"].map((k) => h("li", { "data-key": k }, k)));
    const [a, , c] = list.childNodes;
    morphChildren(list, ["c", "a", "d"].map((k) => h("li", { "data-key": k }, `${k}!`)));
    assert.deepEqual(list.childNodes.map(text), ["c!", "a!", "d!"]);
    assert.equal(list.childNodes[0], c);
    assert.equal(list.childNodes[1], a);
    assert.equal(a.parentNode, list);
  });

  test("a row of another tag, or another key, is a new element", () => {
    const list = h("div", {}, h("div", { "data-key": "a" }, "a"), h("span", {}, "x"));
    const [a, x] = list.childNodes;
    morphChildren(list, [h("button", { "data-key": "a" }, "a"), h("span", { "data-key": "x" }, "x")]);
    assert.notEqual(list.childNodes[0], a);
    assert.equal(list.childNodes[0].tagName, "BUTTON");
    assert.notEqual(list.childNodes[1], x, "a keyed row never takes the place of one with no key");
  });

  test("rows with no key are kept in their order by their tag; words are patched in their own text node", () => {
    const line = h("p", {}, h("b", {}, "2"), " agents ", h("i", {}, "working"));
    const [b, words, i] = line.childNodes;
    morphChildren(line, [h("b", {}, "3"), " agents ", h("i", {}, "idle")]);
    assert.deepEqual([line.childNodes[0], line.childNodes[1], line.childNodes[2]], [b, words, i]);
    assert.equal(text(line), "3 agents idle");
  });

  test("morph keeps the element and its whole subtree, the handlers within carried down", () => {
    const heard = /** @type {string[]} */ ([]);
    const live = h("section", { class: "now" }, h("button", { class: "go", onclick: () => heard.push("1") }, "Go"));
    const btn = live.childNodes[0];
    const kept = morph(live, h("section", { class: "now is-busy" }, h("button", { class: "go", onclick: () => heard.push("2") }, "Go")));
    assert.equal(kept, live);
    assert.equal(live.childNodes[0], btn);
    assert.equal(live.className, "now is-busy");
    btn.dispatch("click");
    assert.deepEqual(heard, ["2"]);
  });

  test("morph of another tag puts the new element in the old one's place", () => {
    const parent = h("div", {}, h("p", {}, "x"));
    const p = parent.childNodes[0];
    const next = h("section", {}, "y");
    assert.equal(morph(p, next), next);
    assert.equal(parent.childNodes[0], next);
  });

  test("a handler the new draw lacks is gone, one it adds is heard", () => {
    const heard = /** @type {string[]} */ ([]);
    const list = h("div", {}, h("div", { "data-key": "a", onclick: () => heard.push("click") }));
    const row = list.childNodes[0];
    morphChildren(list, [h("div", { "data-key": "a", onkeydown: () => heard.push("key") })]);
    row.dispatch("click");
    row.dispatch("keydown");
    assert.deepEqual(heard, ["key"]);
    assert.equal((row.listeners.click || []).length, 0);
  });

  test("a handler given with on() rides the element as h's do", () => {
    const heard = /** @type {string[]} */ ([]);
    const mk = (/** @type {string} */ v) => {
      const el = h("div", { "data-key": "a" });
      on(el, "contextmenu", () => heard.push(v));
      return el;
    };
    const list = h("div", {}, mk("first"));
    const row = list.childNodes[0];
    morphChildren(list, [mk("second")]);
    row.dispatch("contextmenu");
    assert.deepEqual(heard, ["second"]);
  });

  test("a handler is called on the element it is heard on, with the event", () => {
    /** @type {any[]} */
    const got = [];
    const el = h("button", { onclick(/** @type {any} */ e) { got.push(this, e.type); } });
    el.dispatch("click");
    assert.deepEqual(got, [el, "click"]);
  });

  test("markup given whole is set again only where it differs", () => {
    const live = h("span", { class: "ic", html: "<svg>a</svg>" });
    morph(live, h("span", { class: "ic", html: "<svg>a</svg>" }));
    assert.equal(live.innerHTML, "<svg>a</svg>");
    let sets = 0;
    const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(live), "innerHTML");
    Object.defineProperty(live, "innerHTML", { get: () => real?.get?.call(live), set: (v) => { sets++; real?.set?.call(live, v); }, configurable: true });
    morph(live, h("span", { class: "ic", html: "<svg>a</svg>" }));
    assert.equal(sets, 0, "the same markup is left as it is");
    morph(live, h("span", { class: "ic", html: "<svg>b</svg>" }));
    assert.deepEqual([sets, live.innerHTML], [1, "<svg>b</svg>"]);
    const shown = h("span", {});
    setHtml(shown, "<svg>c</svg>");
    morph(shown, h("span", { html: "<svg>c</svg>" }));
    assert.equal(shown.innerHTML, "<svg>c</svg>");
  });

  test("a field being typed in keeps what is typed; one that is not takes the draw's value", () => {
    const live = h("div", {}, h("input", { "data-key": "q", value: "a" }), h("input", { "data-key": "r", value: "a" }));
    const [q, r] = live.childNodes;
    q.value = "typed";
    r.value = "typed too";
    /** @type {any} */ (doc.document).activeElement = q;
    try {
      morphChildren(live, [h("input", { "data-key": "q", value: "b" }), h("input", { "data-key": "r", value: "b" })]);
    } finally {
      delete (/** @type {any} */ (doc.document)).activeElement;
    }
    assert.deepEqual([q.value, r.value], ["typed", "b"]);
  });

  test("an element passed as itself stays itself, where it is or moved", () => {
    const keep = h("div", { class: "slot" }, "kept");
    const list = h("div", {}, h("div", { class: "slot" }, "other"), keep);
    const other = list.childNodes[0];
    morphChildren(list, [keep, h("div", { class: "slot" }, "new")]);
    assert.equal(list.childNodes[0], keep);
    assert.equal(text(keep), "kept", "never drawn over by the draw's other rows");
    assert.equal(list.childNodes[1], other, "the row of no key takes the next of its tag");
    assert.equal(text(other), "new");
  });

  test("an element marked data-placed keeps its children: its owner, or a read that landed, put them there", () => {
    const live = h("details", { class: "group" }, h("summary", {}, "2 calls"), h("div", { class: "kids", "data-placed": "" }));
    const kids = live.childNodes[1];
    const a = h("div", { class: "row" }, "a");
    kids.append(a);
    morph(live, h("details", { class: "group is-done" }, h("summary", {}, "3 calls"), h("div", { class: "kids done", "data-placed": "" })));
    assert.deepEqual([live.className, text(live.childNodes[0]), kids.className], ["group is-done", "3 calls", "kids done"]);
    assert.deepEqual(kids.childNodes, [a], "its rows stand as they were placed");
  });

  test("standing: a read that lands after the draw fills the element that stands for the one it was asked for", () => {
    const live = h("div", { class: "card" }, h("div", { class: "shot", "data-placed": "" }));
    const next = h("div", { class: "card" }, h("div", { class: "shot", "data-placed": "" }));
    const fresh = next.childNodes[0];
    morph(live, next);
    assert.equal(standing(fresh), live.childNodes[0]);
    standing(fresh).append(h("img", { src: "x.png" }));
    assert.equal(live.childNodes[0].childNodes.length, 1);
    // A second draw over the first: its parts stand for the same elements still.
    const third = h("div", { class: "card" }, h("div", { class: "shot", "data-placed": "" }));
    const fresher = third.childNodes[0];
    morph(live, third);
    assert.equal(standing(fresher), live.childNodes[0]);
    assert.equal(standing(live.childNodes[0]), live.childNodes[0], "an element that stands stands for itself");
    const replaced = h("div", {}, h("p", {}, "x"));
    const p2 = h("section", {}, "y");
    morph(replaced.childNodes[0], p2);
    assert.equal(standing(p2), p2, "a new element in another's place stands for itself");
  });

  test("an element that paints its own parts (data-self) is never drawn into: it stays as itself, or another takes its place", () => {
    const card = h("div", { class: "card", "data-self": "" }, h("button", {}, "Hide"));
    const list = h("div", {}, card, h("div", { class: "row" }, "a"));
    const row = list.childNodes[1];
    morphChildren(list, [card, h("div", { class: "row" }, "b")]);
    assert.deepEqual([list.childNodes[0], list.childNodes[1]], [card, row], "passed as itself, it stays");
    const other = h("div", { class: "card", "data-self": "" }, h("button", {}, "Stop"));
    morphChildren(list, [other, h("div", { class: "row" }, "b")]);
    assert.equal(list.childNodes[0], other, "another card takes its place, never drawn into it");
    assert.equal(text(card), "Hide", "the card that stood is as it was");
    const plain = h("div", { class: "row" }, "c");
    morph(list.childNodes[0], plain);
    assert.equal(list.childNodes[0], plain, "nor is a card drawn into a plain row: the row takes its place");
  });

  test("nothing in the list is moved or touched where the draw is the same", () => {
    const list = h("div", {}, ...["a", "b"].map((k) => h("div", { "data-key": k, class: "row" }, h("span", {}, k))));
    const before = [...list.childNodes];
    /** @type {string[]} */
    const moves = [];
    const insert = list.insertBefore.bind(list);
    const remove = list.removeChild.bind(list);
    list.insertBefore = (/** @type {any} */ n, /** @type {any} */ ref) => (moves.push("insert"), insert(n, ref));
    list.removeChild = (/** @type {any} */ n) => (moves.push("remove"), remove(n));
    morphChildren(list, ["a", "b"].map((k) => h("div", { "data-key": k, class: "row" }, h("span", {}, k))));
    assert.deepEqual(moves, []);
    assert.deepEqual(list.childNodes, before);
  });
});
