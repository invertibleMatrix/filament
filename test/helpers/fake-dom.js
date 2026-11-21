// @ts-check
// A recording stand-in for the page's `h`, with the small element surface the widget frame and the widgets use
// (classes, attributes, listeners, children, focus, scrolling into view). The widget tests inject it — and a recording
// popover — so the frame, the widgets and the host run without a DOM.

/**
 * @param {string} tag @param {Record<string, any>} [attrs] @param {any[]} [kids]
 * @returns {any}
 */
const fakeNode = (tag, attrs = {}, kids = []) => {
  const cls = new Set(String(attrs.class || "").split(/\s+/).filter(Boolean));
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") (listeners[k.slice(2)] ||= []).push(v);
  }
  /** @type {any} */
  const node = {
    tag,
    attrs,
    kids,
    classList: {
      /** @param {string} c @param {boolean} [on] */
      toggle: (c, on) => {
        const has = cls.has(c);
        if (on === undefined) {
          if (cls.has(c)) cls.delete(c);
          else cls.add(c);
        } else if (on) cls.add(c);
        else cls.delete(c);
        return has;
      },
      /** @param {string} c */
      add: (c) => cls.add(c),
      /** @param {string} c */
      remove: (c) => cls.delete(c),
      /** @param {string} c */
      contains: (c) => cls.has(c),
    },
    /** @param {string} k @param {any} v */
    setAttribute: (k, v) => { node.attrs[k] = v; },
    /** @param {string} k */
    hasAttribute: (k) => k in node.attrs,
    /** @param {string} k */
    removeAttribute: (k) => { delete node.attrs[k]; },
    /** @param {string} k @param {boolean} [on] */
    toggleAttribute: (k, on) => {
      const has = k in node.attrs;
      if (on === undefined ? !has : on) node.attrs[k] = "";
      else delete node.attrs[k];
      return has;
    },
    /** @param {string} type @param {Function} fn */
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    /** Heard on the node, as a page's is (`currentTarget`). @param {string} type @param {Record<string, any>} [ev] */
    dispatch: (type, ev = {}) => { for (const fn of listeners[type] || []) fn({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {}, ...ev }); },
    /** The first descendant carrying a class. @param {string} sel */
    querySelector: (sel) => {
      const want = String(sel).replace(/^\./, "");
      /** @param {any} n @returns {any} */
      const walk = (n) => {
        for (const k of n.kids || []) {
          if (k && typeof k === "object") {
            if (String(k.attrs?.class || "").split(/\s+/).includes(want)) return k;
            const r = walk(k);
            if (r) return r;
          }
        }
        return null;
      };
      return walk(node);
    },
    focus: () => { node.focused = true; },
    /** Where the page asked to be scrolled to show this node. @param {any} [o] */
    scrollIntoView: (o) => { node.scrolledIntoView = o ?? {}; },
    /** @param {...any} next */
    replaceChildren: (...next) => { node.kids = next.flat().map((k) => (k === null || k === undefined ? "null" : k)); },
    /** @param {...any} next */
    append: (...next) => { node.kids.push(...next.flat().map((k) => (k === null || k === undefined ? "null" : k))); },
    remove: () => {},
    indeterminate: false,
    checked: false,
    /** The inline style a page sets by property (`el.style.display = "none"`) or as a custom property
     *  (`el.style.setProperty("--tone", …)`). @type {Record<string, any>} */
    style: {
      /** @param {string} k @param {string} v */
      setProperty(k, v) { this[k] = String(v); },
    },
  };
  // An input's value starts as its value attribute, as a browser's does (a select's is its chosen option's: set it).
  if (tag === "input" && attrs.value != null) node.value = String(attrs.value);
  return node;
};

/** The recording `h`: children flattened, empty ones dropped, as the page's does. @param {string} tag @param {Record<string, any>} [attrs] @param {...any} kids */
export const fakeH = (tag, attrs = {}, ...kids) => fakeNode(tag, attrs, kids.flat(2).filter((k) => k !== null && k !== undefined && k !== false));

/**
 * The stand-in's draw into a host, where the page draws in place (dom.js `morphChildren`): its nodes keep no identity
 * to patch, so the host's children are the draw's. @param {any} host @param {any[]} nodes
 */
export const fakeDrawIn = (host, nodes) => host.replaceChildren(...nodes);

/**
 * The tooltips of the task graph's tasks under a node, in order: on the Plan a task is one line, and the rest of what it
 * is — what it does now, who does it, what found it — is its tooltip's (views/task-graph.js). @param {any} el
 * @returns {string[]}
 */
export const tipsOf = (el) => {
  /** @type {string[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes("tg-node") && n.attrs.title) out.push(String(n.attrs.title));
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};

/** Every text under a node, joined with "|". @param {any} el */
export const textOf = (el) => {
  /** @type {string[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (n == null) return;
    if (typeof n !== "object") { out.push(String(n)); return; }
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out.join("|");
};

/** Every button under a node, in order. @param {any} el @returns {any[]} */
export const buttonsOf = (el) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.tag === "button") out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};

/**
 * A popover that records what it was asked to show. Its close is the real one's contract: `o.onClose` hears it once,
 * however it went (a test closes it the way Esc or a press outside would: `pops[i].close()`).
 * @returns {{ popover: (anchor: any, body: any, o: any) => any, pops: any[] }}
 */
export function recordingPopover() {
  /** @type {any[]} */
  const pops = [];
  const popover = (/** @type {any} */ anchor, /** @type {any} */ body, /** @type {any} */ o) => {
    const p = { el: body, anchor, body, o, closed: false, placed: 0, kidsWhenPlaced: body?.querySelector?.(".pool-rows")?.kids?.length ?? null, close() { if (p.closed) return; p.closed = true; o?.onClose?.(); }, place() { p.placed++; } };
    pops.push(p);
    return p;
  };
  return { popover, pops };
}
