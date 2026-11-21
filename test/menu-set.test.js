// @ts-check
// A menu given its items again while it is open (ui.js `menu`'s `set`; the Start's folder menu opens at once and takes
// the server's word as it comes): the rows that stay are the elements they were — the one the pointer is on keeps its
// light, a press acts as the newest items say, a submenu opens beside the row on the page —, and a row whose item left
// goes (the owner's of 11-01: a part made anew under a resting pointer blinked, and a press that began on it never
// clicked).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/lib/ui.js").menu} */
let menu;
const g = /** @type {any} */ (globalThis);
before(async () => {
  doc = stubDocument();
  // A menu listens for its keys on the window.
  g.window.addEventListener ||= () => {};
  g.window.removeEventListener ||= () => {};
  ({ menu } = await import("../src/ui/harness/lib/ui.js"));
});
after(() => doc.restore());

// (fails before: yes — a menu had no `set`: its items stood as it opened)
test("a menu given its items again keeps the rows that stay, lit where they were, each press the newest items'", () => {
  /** @type {string[]} */
  const did = [];
  const anchor = /** @type {any} */ (doc.document.createElement("button"));
  doc.document.body.append(anchor);
  const m = menu([
    { key: "a", label: "A", onClick: () => did.push("a") },
    { key: "b", label: "B", onClick: () => did.push("b, as it opened") },
  ], { anchor });
  const el = /** @type {any} */ (m.el);
  const [a, b] = el.querySelectorAll(".zc-menu-item");
  b.dispatch("pointerenter");
  assert.equal(b.hasAttribute("data-highlighted"), true, "the pointer lights B");
  m.set([
    { key: "c", label: "C", onClick: () => did.push("c") },
    { key: "b", label: "B, said again", submenu: [{ label: "Deeper", onClick: () => did.push("deeper") }] },
  ]);
  const rows = el.querySelectorAll(".zc-menu-item");
  assert.deepEqual(rows.map((/** @type {any} */ r) => r.textContent), ["C", "B, said again"]);
  assert.equal(rows[1], b, "B's row is the element it was");
  assert.equal(a.isConnected, false, "A's item left: its row goes");
  assert.deepEqual(rows.map((/** @type {any} */ r) => r.hasAttribute("data-highlighted")), [false, true], "B stays lit under the pointer");
  b.dispatch("click");
  const menus = () => doc.document.body.querySelectorAll(".zc-menu").length;
  assert.equal(menus(), 2, "its press acts as the newest items say: a submenu, beside it");
  b.dispatch("click");
  assert.equal(menus(), 1, "a second press on the row that stands closes the submenu it opened");
  rows[0].dispatch("click");
  assert.deepEqual(did, ["c"], "C's press is C's");
  assert.equal(menus(), 0, "a press closes the menu");
  anchor.remove();
});

// A row that is not there is written as a null in a menu's list, and a null is a line: a project's menu drew three
// lines one under another after Open its Space, one over its first row where it has no Space, two before Archive
// (seen in the page, 11-12). A line stands only between two rows.
// (fails before: yes — every null and every separator was a line, wherever it fell)
test("a menu draws a line only between two rows: never first, never last, never two together — and so after a set", () => {
  const anchor = /** @type {any} */ (doc.document.createElement("button"));
  doc.document.body.append(anchor);
  const shape = (/** @type {any} */ el) => el.children.map((/** @type {any} */ c) => (c.classList.contains("zc-menu-sep") ? "—" : c.textContent));
  const m = menu([null, { key: "a", label: "A" }, null, null, { type: "separator" }, { key: "b", label: "B" }, { type: "label", label: "More" }, { type: "separator" }, null], { anchor });
  assert.deepEqual(shape(m.el), ["A", "—", "B", "More"]);
  m.set([{ type: "separator" }, { key: "b", label: "B" }, null, { type: "separator" }, { key: "c", label: "C" }, null]);
  assert.deepEqual(shape(m.el), ["B", "—", "C"]);
  m.set([null, { type: "separator" }]);
  assert.deepEqual(shape(m.el), [], "lines alone are no menu");
  m.close();
  anchor.remove();
});

// (fails before: yes — the owner's of 11-05: a menu said nothing of its going, so a page that held its anchor while it
// was open — Settings › Coding agents — could not tell when to let go)
test("a menu says it went, once, whichever way it went: a pick, a second press on its anchor, its close", () => {
  /** @type {string[]} */
  const did = [];
  const anchor = /** @type {any} */ (doc.document.createElement("button"));
  doc.document.body.append(anchor);
  const picked = menu([{ label: "A", onClick: () => did.push("a") }], { anchor, onClose: () => did.push("gone") });
  /** @type {any} */ (picked.el).querySelectorAll(".zc-menu-item")[0].dispatch("click");
  assert.deepEqual(did, ["gone", "a"], "a pick closes it first, then runs");
  const again = menu([{ label: "B" }], { anchor, onClose: () => did.push("gone again") });
  menu([{ label: "B" }], { anchor, onClose: () => did.push("never opened") });
  assert.deepEqual(did.slice(2), ["gone again"], "a second press on its anchor closes it, and opens none");
  again.close();
  const third = menu([{ label: "C" }], { anchor, onClose: () => did.push("closed") });
  third.close();
  third.close();
  assert.deepEqual(did.slice(3), ["closed"], "said once");
  anchor.remove();
});
