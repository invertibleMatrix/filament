// @ts-check
// What floats over the page and stayed on it for good (the owner's of 10-28, "those buttons sometimes don't go away"):
// a tooltip (src/ui/harness/lib/ui.js) went only on its control's pointer leave or a press, and a control drawn again —
// the left bar draws its heads again as a chat's status changes — or moved from under the pointer hears no leave, so
// "Add project" stood over the bar; and the selection's Add to chat (conversation/quote-button.js) went only on the
// next mouse-up inside the transcript, so a click in the composer, a key or a scroll left it where the selection was.
// This file stands up a small DOM — listeners, a pointer that hovers one element, a selection the test sets — and loads
// the modules after it.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

/** The element under the pointer, as `:hover` reads it. @type {any} */
let hovered = null;
/** The intervals set, run by hand as time passes. @type {Map<number, () => void>} */
const timers = new Map();
let nextTimer = 1;
const tick = () => {
  for (const fn of [...timers.values()]) fn();
};
/** @type {Record<string, ((e: any) => void)[]>} */
const docListeners = {};

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
    /** @type {Record<string, string>} */
    this.dataset = {};
    this.className = "";
    this.innerHTML = "";
    this.text = "";
    this.offsetWidth = 80;
    this.offsetHeight = 24;
    /** @type {Record<string, ((e: any) => void)[]>} */
    this.listeners = {};
    this.rect = { top: 300, bottom: 320, left: 100, right: 120, width: 20, height: 20 };
    const self = this;
    this.classList = {
      /** @param {string} c */
      add(c) {
        if (!self.classList.contains(c)) self.className = `${self.className} ${c}`.trim();
      },
      /** @param {string} c */
      remove(c) {
        self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" ");
      },
      /** @param {string} c */
      contains: (c) => self.className.split(/\s+/).includes(c),
    };
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
  get parentElement() {
    return this.parentNode;
  }
  /** @param {string} k @param {any} v */
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  /** @param {string} t @param {(e: any) => void} fn */
  addEventListener(t, fn) {
    (this.listeners[t] ||= []).push(fn);
  }
  /** @param {string} t @param {Record<string, any>} [ev] */
  dispatch(t, ev = {}) {
    const e = { type: t, target: this, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() {}, ...ev };
    for (const fn of this.listeners[t] || []) fn(e);
    return e;
  }
  /** Only `:hover`: the pointer's element or one inside this one. @param {string} sel */
  matches(sel) {
    if (sel !== ":hover") throw new Error(`no selector ${sel} in this DOM`);
    return this.contains(hovered);
  }
  /** The nearest of these classes, itself first. @param {string} sel */
  closest(sel) {
    const want = sel.split(",").map((s) => s.trim().replace(/^\./, ""));
    for (let x = /** @type {FakeNode | null} */ (this); x; x = x.parentNode) if (want.some((c) => x?.classList.contains(c))) return x;
    return null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  get textContent() {
    return this.nodeType === 3 ? this.text : this.childNodes.map((k) => k.textContent).join("");
  }
}
const doc = {
  body: new FakeNode("body"),
  activeElement: null,
  createElement: (/** @type {string} */ t) => new FakeNode(t),
  createTextNode: (/** @type {string} */ s) => Object.assign(new FakeNode("#text"), { text: s }),
  /** @param {FakeNode} n */
  contains: (n) => doc.body.contains(n),
  /** @param {string} t @param {(e: any) => void} fn */
  addEventListener: (t, fn) => (docListeners[t] ||= []).push(fn),
};
/** The selection the page holds, as the test sets it. */
const selection = {
  text: "",
  /** @type {FakeNode | null} */
  anchorNode: null,
  rect: { top: 400, bottom: 416, left: 200, right: 260, width: 60, height: 16 },
  cleared: 0,
  get rangeCount() {
    return this.anchorNode ? 1 : 0;
  },
  toString() {
    return this.text;
  },
  getRangeAt() {
    return { getBoundingClientRect: () => selection.rect };
  },
  removeAllRanges() {
    selection.cleared++;
    selection.text = "";
    selection.anchorNode = null;
  },
};
/** @type {any} */ (globalThis).document = doc;
/** @type {any} */ (globalThis).HTMLElement = FakeNode;
/** @type {any} */ (globalThis).window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  getSelection: () => selection,
  setInterval: (/** @type {() => void} */ fn) => (timers.set(nextTimer, fn), nextTimer++),
  clearInterval: (/** @type {number} */ id) => timers.delete(id),
};
const { tooltip } = await import("../src/ui/harness/lib/ui.js");
const { quoteButton } = await import("../src/ui/harness/conversation/quote-button.js");

const tips = () => doc.body.childNodes.filter((n) => n.classList.contains("zc-tooltip"));
const tipWords = () => tips().map((t) => t.textContent);
/** A control on the page with its tooltip. @param {string} title */
const control = (title) => {
  const b = new FakeNode("button");
  doc.body.append(b);
  tooltip(/** @type {any} */ (b), { title });
  return b;
};
/** The pointer comes onto `b`. @param {FakeNode} b */
const enter = (b) => {
  hovered = b;
  b.dispatch("pointerenter");
};
// Each test on a clean page: what one that failed left is not the next one's.
beforeEach(() => {
  for (const k of [...doc.body.childNodes]) k.remove();
  timers.clear();
  hovered = null;
  Object.assign(selection, { text: "", anchorNode: null, cleared: 0 });
  for (const k of Object.keys(docListeners)) delete docListeners[k];
});

// (fails before: yes — the owner's "Add project" over the left bar: the head drawn again under the pointer, its tip left)
test("a tooltip whose control is drawn again under the pointer goes by itself, and its watch stops", () => {
  const old = control("Add project");
  enter(old);
  assert.deepEqual(tipWords(), ["Add project"]);
  old.remove();
  const again = control("Add project");
  hovered = again;
  tick();
  assert.deepEqual(tipWords(), [], "the control it stood for is off the page: it goes, though no leave came");
  assert.equal(timers.size, 0, "nothing left watching");
});

// (fails before: yes — a control moved from under a still pointer hears no leave until the pointer moves)
test("a tooltip whose control moved from under the pointer goes; one still under it stays until the leave or a press", () => {
  const b = control("New Space…");
  enter(b);
  tick();
  assert.deepEqual(tipWords(), ["New Space…"], "under the pointer still: it stays");
  hovered = doc.body;
  tick();
  assert.deepEqual(tipWords(), []);
  enter(b);
  b.dispatch("pointerleave");
  assert.deepEqual([tipWords(), timers.size], [[], 0]);
  enter(b);
  b.dispatch("pointerdown");
  assert.deepEqual([tipWords(), timers.size], [[], 0]);
});

// (fails before: yes — two enters without a leave between, or a second control's, left two tips, the first for good)
test("one tooltip at a time: a second control's takes the first's place, and a second enter never doubles it", () => {
  const a = control("Add project");
  const b = control("Filter");
  enter(a);
  enter(a);
  assert.deepEqual(tipWords(), ["Add project"]);
  enter(b);
  assert.deepEqual(tipWords(), ["Filter"]);
  assert.equal(timers.size, 1);
  b.dispatch("pointerleave");
  a.dispatch("pointerleave");
  assert.deepEqual([tipWords(), timers.size], [[], 0]);
});

/** A transcript in its host, a message row in it with words, and the Add to chat button. */
const transcript = () => {
  const host = new FakeNode("div");
  host.rect = { top: 100, bottom: 700, left: 50, right: 850, width: 800, height: 600 };
  const scroller = new FakeNode("div");
  scroller.rect = { top: 100, bottom: 700, left: 50, right: 850, width: 800, height: 600 };
  const row = new FakeNode("div");
  row.className = "a";
  const words = doc.createTextNode("the words picked");
  row.append(words);
  scroller.append(row);
  const composer = new FakeNode("textarea");
  /** @type {[string, string][]} */
  const quoted = [];
  const btn = /** @type {any} */ (quoteButton({ host: /** @type {any} */ (host), scroller: /** @type {any} */ (scroller), limit: 1000, onQuote: (t, k) => quoted.push([t, k]) }));
  host.append(scroller, btn);
  doc.body.append(host, composer);
  /** The person selects the row's words. */
  const pick = () => {
    selection.text = "the words picked";
    selection.anchorNode = words;
    selection.rect = { top: 400, bottom: 416, left: 200, right: 260, width: 60, height: 16 };
    scroller.dispatch("mouseup");
  };
  const selectionChanged = () => {
    for (const fn of docListeners.selectionchange || []) fn({ type: "selectionchange" });
  };
  return { host, scroller, btn, composer, quoted, pick, selectionChanged, shown: () => !btn.classList.contains("hidden") };
};

// (fails before: yes — the button went only on the next mouse-up inside the transcript, or its own click)
test("Add to chat goes once its selection does: a click elsewhere, a key, a selection moved out of the transcript", () => {
  const t = transcript();
  assert.equal(t.shown(), false);
  t.pick();
  assert.equal(t.shown(), true);
  assert.deepEqual([t.btn.style.left, t.btn.style.top], ["150px", "264px"], "over the selection, in the host's frame");
  selection.text = "";
  t.selectionChanged();
  assert.equal(t.shown(), false, "the selection collapsed (a click in the composer): it goes");
  t.pick();
  selection.anchorNode = t.composer;
  t.selectionChanged();
  assert.equal(t.shown(), false, "the selection is in the composer now: not the transcript's to add");
});

// (fails before: yes — it stayed where the selection was as the transcript scrolled under it)
test("Add to chat follows its selection as the transcript scrolls, and goes when the selection is out of view", () => {
  const t = transcript();
  t.pick();
  selection.rect = { top: 300, bottom: 316, left: 200, right: 260, width: 60, height: 16 };
  t.scroller.dispatch("scroll");
  assert.deepEqual([t.shown(), t.btn.style.top], [true, "164px"]);
  selection.rect = { top: 40, bottom: 56, left: 200, right: 260, width: 60, height: 16 };
  t.scroller.dispatch("scroll");
  assert.equal(t.shown(), false, "scrolled out of the transcript's view: it goes");
});

test("a press on Add to chat keeps the selection for its click, which adds the words and takes the button", () => {
  const t = transcript();
  t.pick();
  const down = t.btn.dispatch("mousedown");
  assert.equal(down.defaultPrevented, true, "the press does not clear the selection, which would take the button before its click");
  t.btn.dispatch("click");
  assert.deepEqual(t.quoted, [["the words picked", "Assistant message"]]);
  assert.equal(t.shown(), false);
  assert.equal(selection.cleared > 0, true);
});
