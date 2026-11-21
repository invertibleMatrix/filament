// @ts-check
// The overlay stack (src/ui/harness/lib/ui.js): a popover tells its owner it went, once, whichever way it went — its
// own close, Esc, a press outside it, a second open on its anchor (M6-7: a widget pill dismissed by Esc took two clicks
// to open again). The module keeps its keys only where a window runs, so this file stands one up first — a small DOM,
// enough to build and place a popover — and loads the module after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** @type {Record<string, ((e: any) => void)[]>} */
const winListeners = {};
class FakeNode {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === "#text" ? 3 : 1;
    /** @type {FakeNode[]} */
    this.childNodes = [];
    /** @type {FakeNode | null} */
    this.parentNode = null;
    /** @type {Record<string, string>} */
    this.attrs = {};
    /** @type {Record<string, string>} */
    this.style = {};
    this.className = "";
    this.offsetWidth = 300;
    this.offsetHeight = 200;
  }
  /** @param {...FakeNode} kids */
  append(...kids) {
    for (const k of kids) {
      k.parentNode?.removeChild(k);
      k.parentNode = this;
      this.childNodes.push(k);
    }
  }
  /** @param {FakeNode} k */
  removeChild(k) {
    const i = this.childNodes.indexOf(k);
    if (i >= 0) this.childNodes.splice(i, 1);
    k.parentNode = null;
    return k;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  /** @param {FakeNode | null} n */
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  get isConnected() {
    /** @type {FakeNode} */
    let x = this;
    while (x.parentNode) x = x.parentNode;
    return x === doc.body;
  }
  /** @param {string} k @param {any} v */
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  addEventListener() {}
  /** @param {string} k */
  hasAttribute(k) {
    return k in this.attrs;
  }
  focus() {
    doc.activeElement = this;
  }
  /** The first button under it: all a dialog asks for its first focus. @param {string} sel */
  querySelector(sel) {
    if (!/button/.test(sel)) return null;
    for (const k of this.childNodes) {
      if (k.tagName === "BUTTON") return k;
      const deep = k.querySelector?.(sel);
      if (deep) return deep;
    }
    return null;
  }
  getBoundingClientRect() {
    return { top: 600, bottom: 620, left: 100, right: 180, width: 80, height: 20 };
  }
}
/** @type {{ body: FakeNode, activeElement: FakeNode | null, createElement: (t: string) => FakeNode, createTextNode: (s: string) => FakeNode }} */
const doc = {
  body: new FakeNode("body"),
  activeElement: null,
  createElement: (/** @type {string} */ t) => new FakeNode(t),
  createTextNode: (/** @type {string} */ s) => Object.assign(new FakeNode("#text"), { text: s }),
};
/** @type {any} */ (globalThis).document = doc;
/** @type {any} */ (globalThis).HTMLElement = FakeNode;
/** @type {any} */ (globalThis).window = { innerWidth: 1200, innerHeight: 800, addEventListener: (/** @type {string} */ t, /** @type {any} */ fn) => (winListeners[t] ||= []).push(fn) };
const { popover, dialog, closeOverlays } = await import("../src/ui/harness/lib/ui.js");

/** What the window hears: the overlay stack's own keys and presses. @param {string} type @param {any} ev */
const fire = (type, ev) => {
  for (const fn of winListeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...ev });
};
/** A popover on a fresh anchor, its closes counted. */
const opened = () => {
  const anchor = new FakeNode("button");
  doc.body.append(anchor);
  const content = new FakeNode("div");
  const heard = { closes: 0 };
  const p = popover(/** @type {any} */ (anchor), /** @type {any} */ (content), { onClose: () => heard.closes++ });
  return { anchor, content, heard, p };
};

test("Esc closes the popover on top, and its owner hears it once", () => {
  const { heard, p } = opened();
  assert.ok(p.el.isConnected);
  fire("keydown", { key: "Escape" });
  assert.equal(p.el.isConnected, false);
  assert.equal(heard.closes, 1);
  p.close();
  assert.equal(heard.closes, 1, "a close after it went says nothing more");
});

test("a press outside closes it; a press inside it or on its anchor does not; the owner hears the close", () => {
  const { anchor, content, heard, p } = opened();
  fire("pointerdown", { target: content });
  fire("pointerdown", { target: anchor });
  assert.ok(p.el.isConnected, "a press inside, or on the anchor whose own click toggles it, leaves it open");
  assert.equal(heard.closes, 0);
  fire("pointerdown", { target: doc.body });
  assert.equal(p.el.isConnected, false);
  assert.equal(heard.closes, 1);
});

test("a second open on the same anchor closes the first, and its owner hears it; its own close is heard too", () => {
  const { anchor, heard, p } = opened();
  const again = popover(/** @type {any} */ (anchor), /** @type {any} */ (new FakeNode("div")), { onClose: () => assert.fail("the toggle opens nothing") });
  assert.equal(again.el.isConnected, false, "the toggle: nothing new is open");
  assert.equal(p.el.isConnected, false);
  assert.equal(heard.closes, 1);
  const other = opened();
  other.p.close();
  assert.equal(other.heard.closes, 1);
  fire("keydown", { key: "Escape" });
  assert.equal(other.heard.closes, 1, "nothing left on the stack for Esc to close");
});

// (fails before: yes — found at E35 S5a's live look: a row of the Space's Needs you drawn again under its open Not now ▾
// menu, and Enter on the new button opened a second menu beside the first)
test("a trigger drawn again: what it opened goes as the next opens; one whose trigger was never on the page stays", () => {
  const { anchor, heard, p } = opened();
  anchor.remove();
  const next = opened();
  assert.equal(p.el.isConnected, false, "its trigger is gone from the page: it goes");
  assert.equal(heard.closes, 1);
  assert.ok(next.p.el.isConnected);
  const loose = popover(/** @type {any} */ (new FakeNode("button")), /** @type {any} */ (new FakeNode("div")), {});
  const third = opened();
  assert.ok(loose.el.isConnected && next.p.el.isConnected && third.p.el.isConnected, "a trigger never on the page is no trigger drawn again");
  closeOverlays();
});

test("a new route closes every overlay, the top one first, and each owner hears it (M6-7)", () => {
  const order = /** @type {string[]} */ ([]);
  const a = popover(/** @type {any} */ (new FakeNode("button")), /** @type {any} */ (new FakeNode("div")), { onClose: () => order.push("a") });
  const b = popover(/** @type {any} */ (new FakeNode("button")), /** @type {any} */ (new FakeNode("div")), { onClose: () => order.push("b") });
  closeOverlays();
  assert.deepEqual(order, ["b", "a"]);
  assert.equal(a.el.isConnected || b.el.isConnected, false);
  fire("keydown", { key: "Escape" });
  assert.deepEqual(order, ["b", "a"], "nothing left open");
  // The page closes them before it draws the new route: a shortcut to Settings left the memory popover over it.
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /window\.addEventListener\("hashchange", \(\) => \{\s*closeOverlays\(\);\s*const route = parseRoute\(location\.hash\);/);
});

// (fails before: yes — the model picker asked 580px and took it, past a 420px window's right edge)
test("a popover that asks a width never takes more than the window less its margins; one that asks none keeps its own", () => {
  const wide = popover(/** @type {any} */ (new FakeNode("button")), /** @type {any} */ (new FakeNode("div")), { width: 580 });
  assert.equal(wide.el.style.width, "min(580px, calc(100vw - 16px))");
  const plain = popover(/** @type {any} */ (new FakeNode("button")), /** @type {any} */ (new FakeNode("div")));
  assert.equal(plain.el.style.width, undefined);
  closeOverlays();
});

// (fails before: yes — the welcome tour's model picker, 540 px tall by a chip mid-window, was pushed to the window's
// top and covered its own chip)
test("a popover with room on neither side takes the roomier one, held to its room, and never covers its anchor", () => {
  const make = doc.createElement;
  // Its elements 600 px tall, less where a max-height holds them.
  doc.createElement = (/** @type {string} */ t) => {
    const n = make(t);
    Object.defineProperty(n, "offsetHeight", { get: () => Math.min(600, parseFloat(n.style.maxHeight) || 600) });
    return n;
  };
  try {
    const mid = new FakeNode("button");
    mid.getBoundingClientRect = () => ({ top: 300, bottom: 320, left: 100, right: 180, width: 80, height: 20 });
    const tall = popover(/** @type {any} */ (mid), /** @type {any} */ (new FakeNode("div")), { side: "top" });
    // Above: 300 − 4 − 8 = 288; below: 800 − 8 − 320 − 4 = 468.
    assert.deepEqual([tall.el.style.maxHeight, tall.el.style.overflowY, tall.el.style.top, tall.el.attrs["data-side"]], ["468px", "auto", "324px", "bottom"], "below, held to its 468 px, scrolling what cannot shrink");
    // Placed again with room above, it lets go of the hold.
    mid.getBoundingClientRect = () => ({ top: 700, bottom: 720, left: 100, right: 180, width: 80, height: 20 });
    tall.place?.();
    assert.deepEqual([tall.el.style.maxHeight, tall.el.style.overflowY, tall.el.style.top], ["", "", "96px"], "placed again where it fits: whole, above");
    closeOverlays();
    const low = new FakeNode("button");
    low.getBoundingClientRect = () => ({ top: 700, bottom: 720, left: 100, right: 180, width: 80, height: 20 });
    const up = popover(/** @type {any} */ (low), /** @type {any} */ (new FakeNode("div")), { side: "top" });
    assert.deepEqual([up.el.style.maxHeight, up.el.style.top, up.el.attrs["data-side"]], ["", "96px", "top"], "room above: its whole height, nothing held");
    closeOverlays();
  } finally {
    doc.createElement = make;
  }
});

/** A rule's z-index in harness.css, by one selector of its list. @param {string} css @param {string} sel */
const zOf = (css, sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim());
    const z = /z-index:\s*(\d+)/.exec(m[2]);
    if (sels.includes(sel) && z) return Number(z[1]);
  }
  return NaN;
};

// (fails before: yes — the owner's screenshot of 10-28: a command's Stop, pressed in the status popover, asked its
// confirm under that popover, which drew over the dim at 60 to the dialog's 56)
test("a confirm asked from inside a popover stands over it; Esc goes back to the popover, the focus where it was", () => {
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  const dz = zOf(css, ".zc-dialog-overlay");
  assert.ok(dz >= zOf(css, ".zc-popover") && dz >= zOf(css, ".zc-menu"), `a dialog's layer (${dz}) is the popovers' and menus' own, or over it`);
  const { content, heard, p } = opened();
  const stop = new FakeNode("button");
  content.append(stop);
  stop.focus();
  const d = dialog({ title: "Stop “npm test”?", actions: [{ label: "Cancel" }, { label: "Stop" }] });
  const kids = doc.body.childNodes;
  assert.ok(kids.indexOf(/** @type {any} */ (d.el)) > kids.indexOf(p.el), "drawn after the popover: on one layer, over it");
  fire("pointerdown", { target: d.el.childNodes[0] });
  assert.ok(p.el.isConnected && d.el.isConnected, "a press in the confirm closes neither");
  fire("keydown", { key: "Escape" });
  assert.equal(d.el.isConnected, false);
  assert.ok(p.el.isConnected, "Esc steps back one: the popover stays");
  assert.equal(heard.closes, 0);
  assert.equal(doc.activeElement, stop, "the focus is back on the Stop that was pressed");
  // The popover redrew while it asked (its commands re-read every 2 s): the pressed Stop is gone, so the focus goes back
  // to the popover, not the page.
  const again = new FakeNode("button");
  content.append(again);
  again.focus();
  const d2 = dialog({ title: "Stop “npm test”?" });
  again.remove();
  d2.close();
  assert.equal(doc.activeElement, p.el);
  assert.equal(p.el.attrs.tabindex, "-1");
  closeOverlays();
});
