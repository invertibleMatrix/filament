// @ts-check
// A small document for the page's own `h` (src/ui/lib/dom.js), so a card, a row or a pane can be built in node and read
// back: each element keeps its tag, its classes, its attributes, its listeners and its children, and answers the few
// selectors the page uses (`.class`, `tag`, `tag.class`, `[attr]`, a list of them). Markup set as HTML is kept as
// given, not parsed: a test reads it as text; markup added at an element's end is a node of its own. A popover opens on it too: a field keeps its value, every box measures
// nothing, and a window stands while the document does, sized as a laptop's; a selector may name an attribute's value
// and an ancestor (`.tp-meter [aria-checked='true']`), as its focus does.

/** @typedef {StubElement | StubText} StubNode */

class StubText {
  /** @param {string} data */
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
    /** @type {StubElement | null} */
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
}

/** One compound selector: a tag, classes and an attribute (the value it holds, when it names one), any of them. @param {string} sel */
const parseOne = (sel) => {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=(['"])(.*)\4)?\])?$/.exec(sel.trim());
  if (!m) throw new Error(`the stub document reads no selector like ${sel}`);
  return { tag: m[1] ? m[1].toUpperCase() : null, classes: m[2] ? m[2].slice(1).split(".") : [], attr: m[3] || null, value: m[5] ?? null };
};

/** A selector's compounds, the outermost ancestor's first: split at its spaces, never inside brackets. @param {string} sel */
const compounds = (sel) => {
  const out = [""];
  let depth = 0;
  for (const ch of sel.trim()) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (out[out.length - 1]) out.push("");
    } else out[out.length - 1] += ch;
  }
  return out.filter(Boolean).map(parseOne);
};

class StubElement {
  /** @param {string} tag */
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    /** @type {Map<string, string>} */
    this.attrs = new Map();
    /** @type {StubNode[]} */
    this.childNodes = [];
    /** @type {StubElement | null} */
    this.parentNode = null;
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    /** Its inline style; a custom property set through `setProperty` is kept under its own name. @type {Record<string, any>} */
    this.style = {
      /** @param {string} k @param {string} v */
      setProperty: (k, v) => { this.style[k] = String(v); },
      /** @param {string} k */
      removeProperty: (k) => { delete this.style[k]; },
    };
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** Markup set as HTML, kept as given. @type {string | null} */
    this.html = null;
    /** The width the page would measure; a test sets it. */
    this.clientWidth = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    /** A field's value: an `INPUT`'s, a `TEXTAREA`'s or a `SELECT`'s; declared here, set below for a field alone. @type {any} */
    this.value;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(this.tagName)) {
      // A field's value follows its value attribute until something sets the value — typed, as a browser's does.
      /** @type {any} */
      let value = "";
      let typed = false;
      Object.defineProperty(this, "value", { get: () => value, set: (v) => { value = v; typed = true; }, enumerable: true, configurable: true });
      this.#valueAttr = (/** @type {string} */ v) => void (typed || (value = v));
    }
  }
  /** Its value attribute moved: a field not typed in shows it. @type {(v: string) => void} */
  #valueAttr = () => {};
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  /** Its boxes: one where it stands on the page and nothing holding it is put away (`.hidden`, display: none), else none. */
  getClientRects() {
    /** @type {any} */
    let n = this;
    for (; n; n = n.parentNode) if (n.classList?.contains("hidden")) return [];
    return this.isConnected ? [this.getBoundingClientRect()] : [];
  }
  focus() {}
  select() {}
  scrollIntoView() {}
  /** @param {StubNode | null} n */
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  get classList() {
    const own = () => this.className.split(/\s+/).filter(Boolean);
    /** @param {string[]} list */
    const set = (list) => (this.className = [...new Set(list)].join(" "));
    return {
      /** @param {...string} c */
      add: (...c) => set([...own(), ...c]),
      /** @param {...string} c */
      remove: (...c) => set(own().filter((x) => !c.includes(x))),
      /** @param {string} c */
      contains: (c) => own().includes(c),
      /** @param {string} c @param {boolean} [on] */
      toggle: (c, on) => {
        const want = on === undefined ? !own().includes(c) : on;
        set(want ? [...own(), c] : own().filter((x) => x !== c));
        return want;
      },
    };
  }
  /** A field's value attribute is its value too, as a browser's is for a field not typed in. @param {string} k @param {unknown} v */
  setAttribute(k, v) {
    if (k === "class") this.className = String(v);
    else this.attrs.set(k, String(v));
    if (k === "value" && this.tagName === "INPUT") this.#valueAttr(String(v));
  }
  /** @param {string} k */
  getAttribute(k) {
    return k === "class" ? this.className : this.attrs.get(k) ?? null;
  }
  /** @param {string} k */
  hasAttribute(k) {
    return k === "class" ? !!this.className : this.attrs.has(k);
  }
  /** @param {string} k */
  removeAttribute(k) {
    if (k === "class") this.className = "";
    else this.attrs.delete(k);
  }
  /** Its attributes, as a page's element lists them: its classes first, where it has any. */
  get attributes() {
    const all = this.className ? [["class", this.className], ...this.attrs] : [...this.attrs];
    return all.map(([name, value]) => ({ name, localName: name, value, namespaceURI: null }));
  }
  /** @param {string} k @param {boolean} [on] */
  toggleAttribute(k, on) {
    const want = on === undefined ? !this.attrs.has(k) : on;
    if (want) this.attrs.set(k, "");
    else this.attrs.delete(k);
    return want;
  }
  get open() {
    return this.attrs.has("open");
  }
  set open(on) {
    if (on) this.attrs.set("open", "");
    else this.attrs.delete("open");
  }
  /** A listener added `once` goes as it hears its first event, as the page's. @param {string} type @param {Function} fn @param {any} [opts] */
  addEventListener(type, fn, opts) {
    /** @type {Function & { of?: Function }} */
    const heard = opts?.once ? Object.assign((/** @type {any[]} */ ...a) => (this.removeEventListener(type, heard), fn(...a)), { of: fn }) : fn;
    (this.listeners[type] ||= []).push(heard);
  }
  /** @param {string} type @param {Function} fn */
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((/** @type {any} */ f) => f !== fn && f.of !== fn);
  }
  /** Hand an event to the element's listeners: heard on it, as a page's is (`currentTarget`). @param {string} type @param {Record<string, any>} [ev] */
  dispatch(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn({ type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...ev });
  }
  /** A page's event (`new Event(…)`) handed to the element's listeners as `dispatch` hands one. @param {Event} ev */
  dispatchEvent(ev) {
    this.dispatch(ev.type, { preventDefault: () => ev.preventDefault() });
    return !ev.defaultPrevented;
  }
  /** @param {unknown} n @returns {StubNode} */
  #adopt(n) {
    const node = n instanceof StubElement || n instanceof StubText ? n : new StubText(String(n));
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    return node;
  }
  /** @param {...unknown} nodes */
  append(...nodes) {
    this.html = null;
    for (const n of nodes) this.childNodes.push(this.#adopt(n));
  }
  /** @param {StubNode} n */
  appendChild(n) {
    this.append(n);
    return n;
  }
  /** @param {StubNode} n @param {StubNode | null} ref */
  insertBefore(n, ref) {
    const node = this.#adopt(n);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return n;
  }
  /** @param {StubNode} n */
  removeChild(n) {
    this.childNodes = this.childNodes.filter((x) => x !== n);
    n.parentNode = null;
    return n;
  }
  /** @param {...unknown} nodes */
  replaceChildren(...nodes) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  /** @param {...unknown} nodes */
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.childNodes.indexOf(this);
    const fresh = nodes.map((n) => (n instanceof StubElement || n instanceof StubText ? n : new StubText(String(n))));
    for (const n of fresh) if (n.parentNode) n.parentNode.removeChild(n);
    parent.childNodes.splice(at, 1, ...fresh);
    for (const n of fresh) n.parentNode = parent;
    this.parentNode = null;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  /** Nodes set right after this one in its parent, as the page's. @param {...unknown} nodes */
  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const fresh = nodes.map((n) => (n instanceof StubElement || n instanceof StubText ? n : new StubText(String(n))));
    for (const n of fresh) if (n.parentNode) n.parentNode.removeChild(n);
    parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, ...fresh);
    for (const n of fresh) n.parentNode = parent;
  }
  /**
   * Markup added at the end, as the page adds a markdown block: kept as given in one node of its own (`html`), not
   * parsed — the node a block makes. @param {string} where @param {string} html
   */
  insertAdjacentHTML(where, html) {
    if (where !== "beforeend") throw new Error(`the stub document adds markup at the end only, not ${where}`);
    const part = new StubElement("div");
    part.html = String(html);
    this.append(part);
  }
  get lastChild() {
    return this.childNodes.at(-1) || null;
  }
  /** A copy, as the page's: tag, classes, attributes, markup and (deep) children; listeners stay behind. @param {boolean} [deep] */
  cloneNode(deep = false) {
    const c = new StubElement(this.tagName);
    c.className = this.className;
    for (const [k, v] of this.attrs) c.attrs.set(k, v);
    if (deep) for (const n of this.childNodes) c.append(n instanceof StubElement ? n.cloneNode(true) : new StubText(n.data));
    c.html = this.html;
    return c;
  }
  /** @returns {StubElement[]} */
  get children() {
    return /** @type {StubElement[]} */ (this.childNodes.filter((n) => n instanceof StubElement));
  }
  /** @returns {string} */
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v) {
    this.replaceChildren(String(v ?? ""));
  }
  get innerHTML() {
    return this.html ?? "";
  }
  set innerHTML(v) {
    this.replaceChildren();
    this.html = String(v);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    return this.children.at(-1) || null;
  }
  get isConnected() {
    /** @type {StubElement} */
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === stubDoc.body;
  }
  /** @param {string} sel */
  matches(sel) {
    return sel.split(",").some((one) => {
      const chain = compounds(one);
      if (!chain.length || !this.#fits(chain[chain.length - 1])) return false;
      // Each compound before the last is an ancestor's, the nearest last.
      let at = chain.length - 2;
      for (let n = this.parentNode; n && at >= 0; n = n.parentNode) if (n.#fits(chain[at])) at--;
      return at < 0;
    });
  }
  /** @param {ReturnType<typeof parseOne>} s */
  #fits(s) {
    if (s.tag && s.tag !== this.tagName) return false;
    if (s.attr && !this.attrs.has(s.attr)) return false;
    if (s.attr && s.value !== null && this.attrs.get(s.attr) !== s.value) return false;
    return s.classes.every((c) => this.classList.contains(c));
  }
  /** @param {string} sel @returns {StubElement[]} */
  querySelectorAll(sel) {
    // `:scope > x`: this element's own children alone, as the page finds the screen it drew over a frame.
    const own = /^:scope\s*>\s*(\S+)$/.exec(String(sel).trim());
    if (own) return this.children.filter((k) => k.matches(own[1]));
    /** @type {StubElement[]} */
    const out = [];
    /** @param {StubElement} el */
    const walk = (el) => {
      for (const k of el.children) {
        if (k.matches(sel)) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  /** @param {string} sel */
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  /** @param {string} sel @returns {StubElement | null} */
  closest(sel) {
    /** @type {StubElement | null} */
    let n = this;
    while (n && !n.matches(sel)) n = n.parentNode;
    return n;
  }
}

const stubDoc = {
  body: new StubElement("body"),
  /** The page's root, apart from the body as on the page: what the page says of itself (its theme, what Appearance
   * hides) is said here, and nothing drawn hangs from it. */
  documentElement: new StubElement("html"),
  /** @param {string} tag */
  createElement: (tag) => new StubElement(tag),
  /** @param {string} text */
  createTextNode: (text) => new StubText(text),
  /** The page's own reads of itself (a toast finds its stack): the body holds everything. @param {string} sel */
  querySelector: (sel) => stubDoc.body.querySelector(sel),
  /** @param {string} sel */
  querySelectorAll: (sel) => stubDoc.body.querySelectorAll(sel),
  /** The page's listeners on the document itself (md.js's press on a picture's chip, the box's selectionchange), heard
   * by nothing here, as the window's. */
  addEventListener() {},
  removeEventListener() {},
};

/**
 * The stub document in place of the page's, and a window beside it where none stands: `restore` puts back what was
 * there (nothing, in node).
 * @returns {{ document: typeof stubDoc, restore: () => void }}
 */
export function stubDocument() {
  const g = /** @type {any} */ (globalThis);
  const had = Object.prototype.hasOwnProperty.call(g, "document");
  const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
  const prev = g.document;
  const prevWindow = g.window;
  g.document = stubDoc;
  if (!hadWindow) g.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  stubDoc.body.replaceChildren();
  return {
    document: stubDoc,
    restore: () => {
      if (had) g.document = prev;
      else delete g.document;
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
    },
  };
}
