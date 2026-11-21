// @ts-check
// DOM construction for every browser surface (the admin dashboard, later the harness page). Trusted
// markup (SVG icons, already-escaped markdown) is assigned here and nowhere else.

/**
 * @param {string} sel
 * @param {ParentNode} [el]
 * @returns {any}
 */
export const $ = (sel, el = document) => el.querySelector(sel);

/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...any} children
 * @returns {any}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") setHtml(el, v);
    else if (k.startsWith("on")) {
      if (v) on(el, k.slice(2), v);
    } else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * The handlers `h` and `on` gave an element, by event type. Each type is heard through one listener of the element's
 * own, which calls the handler its entry holds now: `morph` keeps an element and hands it the handlers of the draw it
 * stands for, so a press acts on what the newest draw showed.
 * @type {WeakMap<object, Map<string, { fn: any, relay: (e: any) => any }>>}
 */
const handlersOf = new WeakMap();

/**
 * Listen on an element as `h`'s `on…` attributes do — one handler for each event, the last given — so that `morph`
 * carries it to the element it keeps. A listener added with `addEventListener` stays with the element it was added to.
 * @param {any} el @param {string} type @param {any} fn  a function, called on the element, or an object with `handleEvent`
 */
export function on(el, type, fn) {
  let own = handlersOf.get(el);
  if (!own) handlersOf.set(el, (own = new Map()));
  const had = own.get(type);
  if (had) {
    had.fn = fn;
    return;
  }
  const entry = { fn, relay: (/** @type {any} */ e) => (typeof entry.fn === "function" ? entry.fn.call(el, e) : entry.fn?.handleEvent?.(e)) };
  own.set(type, entry);
  el.addEventListener(type, entry.relay);
}

/**
 * A drawing that never comes back taken apart: each element under `el` out of its parent, and every handler `h` and `on`
 * gave it taken back. What a frame still owes one of them — a scroll it was told of, an animation turning on it — holds
 * that element alone till the frame comes, never the drawing it was in nor what its handlers close over: a window that
 * got no frames (hidden, covered, the screen locked) kept every drawing a page threw away meanwhile, whole (the owner's
 * of 11-17). @param {any} el
 */
export function takeApart(el) {
  for (const k of Array.from(/** @type {any[]} */ (el?.children || []))) {
    takeApart(k);
    k.remove();
  }
  const own = handlersOf.get(el);
  if (!own) return;
  for (const [type, entry] of own) el.removeEventListener(type, entry.relay);
  handlersOf.delete(el);
}

/** `live` hears what `next` was given to hear, and nothing else it heard through `on`. @param {any} live @param {any} next */
function carryHandlers(live, next) {
  const mine = handlersOf.get(live);
  const theirs = handlersOf.get(next);
  if (mine) {
    for (const [type, entry] of mine) {
      if (theirs?.has(type)) continue;
      live.removeEventListener(type, entry.relay);
      mine.delete(type);
    }
  }
  if (theirs) for (const [type, entry] of theirs) on(live, type, entry.fn);
}

/** The markup `h`'s `html` or `setHtml` gave an element, as given: `morph` sets it again only where it differs. @type {WeakMap<object, string>} */
const markupOf = new WeakMap();

/** An element's key among its siblings (`data-key`): a row kept by it as the list moves. @param {any} n @returns {string | null} */
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute("data-key") : null);

/**
 * Whether `next` may be drawn into `live`: the same kind of node — an element of the same tag — and the same key. An
 * element that paints its own parts (`data-self`: a card whose buttons and words its own paint keeps, from what it
 * holds) is never drawn into, nor drawn into another: its handlers act on the parts it made, so it stands as itself —
 * passed again as itself — or another takes its place.
 * @param {any} live @param {any} next
 */
const sameKind = (live, next) =>
  live.nodeType === next.nodeType &&
  (live.nodeType !== 1 ||
    (live.tagName === next.tagName && live.namespaceURI === next.namespaceURI && keyOf(live) === keyOf(next) && !live.hasAttribute("data-self") && !next.hasAttribute("data-self")));

/** `live`'s attributes made `next`'s: those it lacks go, those that differ are set. @param {any} live @param {any} next */
function patchAttributes(live, next) {
  for (const x of Array.from(/** @type {any[]} */ (live.attributes || []))) {
    const keep = x.namespaceURI ? next.hasAttributeNS(x.namespaceURI, x.localName) : next.hasAttribute(x.name);
    if (keep) continue;
    if (x.namespaceURI) live.removeAttributeNS(x.namespaceURI, x.localName);
    else live.removeAttribute(x.name);
  }
  for (const x of Array.from(/** @type {any[]} */ (next.attributes || []))) {
    if (x.namespaceURI) {
      if (live.getAttributeNS(x.namespaceURI, x.localName) !== x.value) live.setAttributeNS(x.namespaceURI, x.name, x.value);
    } else if (live.getAttribute(x.name) !== x.value) live.setAttribute(x.name, x.value);
  }
}

/** A field's value and tick as the draw has them — save the field being typed in, which keeps what is typed. @param {any} live @param {any} next */
function patchField(live, next) {
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(live.tagName) || live === globalThis.document?.activeElement || live.type === "file") return;
  if (live.value !== next.value) live.value = next.value;
  if (live.checked !== next.checked) live.checked = next.checked;
}

/**
 * The element that stands for one a draw made and `morph` drew into it, by the one made: what a draw asks for after it
 * is drawn — a picture, a diff, a count — lands in the element on the page (`standing`).
 * @type {WeakMap<object, any>}
 */
const standsFor = new WeakMap();

/**
 * The element on the page that stands for `el`, one a draw made: the element `morph` kept in its place, or `el` itself
 * where it came in as itself, or stands already. A read that lands after its draw fills this one — the element it was
 * made with may have been spent by the draw.
 * @template T
 * @param {T} el
 * @returns {T}
 */
export function standing(el) {
  return standsFor.get(/** @type {any} */ (el)) ?? el;
}

/**
 * `live` made to look and act as `next`, of the same kind (`sameKind`), every element of it that stands kept. An
 * element whose draw says `data-placed` keeps its children: its owner places them, or a read that lands after the draw
 * fills them (`standing`).
 * @param {any} live @param {any} next
 */
function patch(live, next) {
  standsFor.set(next, live);
  if (live.nodeType !== 1) {
    if (live.data !== next.data) live.data = next.data;
    return;
  }
  patchAttributes(live, next);
  carryHandlers(live, next);
  if (!next.hasAttribute("data-placed")) {
    const markup = markupOf.get(next);
    if (markup === undefined) markupOf.delete(live);
    else if (markupOf.get(live) !== markup) setHtml(live, markup);
    morphChildren(live, Array.from(next.childNodes));
  }
  patchField(live, next);
}

/**
 * Draw `next` — a node made for this draw — over `live` in place: where it is the same kind of node (an element of the
 * same tag and `data-key`), `live` stays and takes `next`'s attributes, words, handlers and children, each child kept
 * the same way; else `next` takes `live`'s place. A part drawn anew whole would put a new element under a resting
 * pointer — its hover starts over, and a press that began on the old one ends on another, so it never clicks (the
 * owner's of 11-01: buttons blinking under the pointer, clicks lost). `next` is spent: its nodes may be moved into
 * `live`. → the node that stands.
 * @param {any} live @param {any} next
 * @returns {any}
 */
export function morph(live, next) {
  if (live === next) return live;
  if (!sameKind(live, next)) {
    live.replaceWith(next);
    return next;
  }
  patch(live, next);
  return live;
}

/**
 * Make `parent`'s children `wanted`, in order, as `morph` draws one: each node made for this draw is drawn over the
 * child that stands for the same thing — the one of its `data-key`, or, with no key, the next of its tag in order —, and
 * comes in as itself where none does; a child nothing stands for leaves. A node passed that is `parent`'s child already
 * stays itself, and so does one already in the document elsewhere, moved here: an element a caller keeps is passed as
 * itself, never inside a node made for the draw. Only what is out of place moves (`placeChildren`). Words are taken as
 * `h` takes a child's.
 * @param {any} parent
 * @param {any[]} wanted
 */
export function morphChildren(parent, wanted) {
  const nodes = wanted
    .flat()
    .filter((n) => n !== null && n !== undefined && n !== false)
    .map((n) => (n.nodeType ? n : document.createTextNode(String(n))));
  const itself = new Set(nodes.filter((n) => n.parentNode === parent || n.isConnected));
  /** @type {Map<string, any>} */
  const keyed = new Map();
  /** @type {any[]} */
  const loose = [];
  for (const k of Array.from(/** @type {any[]} */ (parent.childNodes))) {
    if (itself.has(k)) continue;
    const key = keyOf(k);
    if (key === null) loose.push(k);
    else if (!keyed.has(key)) keyed.set(key, k);
  }
  let from = 0;
  const out = nodes.map((n) => {
    if (itself.has(n)) return n;
    const key = keyOf(n);
    let match = null;
    if (key !== null) {
      const k = keyed.get(key);
      if (k && sameKind(k, n)) {
        match = k;
        keyed.delete(key);
      }
    } else {
      for (let j = from; j < loose.length; j++) {
        if (!sameKind(loose[j], n)) continue;
        match = loose[j];
        from = j + 1;
        break;
      }
    }
    if (!match) return n;
    patch(match, n);
    return match;
  });
  placeChildren(parent, out);
}

/**
 * Make `parent`'s children exactly `wanted`, in order, moving only the nodes that are out of place. A node that is
 * detached and inserted again restarts its CSS animations, so a child already where it belongs is never touched —
 * `replaceChildren` detaches every child, even the ones it puts back.
 * @param {Node} parent
 * @param {Node[]} wanted
 */
export function placeChildren(parent, wanted) {
  const keep = new Set(wanted);
  for (const n of Array.from(parent.childNodes)) if (!keep.has(n)) parent.removeChild(n);
  for (let i = 0; i < wanted.length; i++) {
    const at = parent.childNodes[i] || null;
    if (at !== wanted[i]) parent.insertBefore(wanted[i], at);
  }
}

/**
 * The field that has the focus gives it up, as a press elsewhere takes it: an input, a text area or a select whose value
 * was changed fires its `change` on the way, which is where a form keeps the edit. A key that acts on the edits (the
 * console's Ctrl+S) moves no focus, so it calls this first. Any other element keeps the focus.
 * @param {{ activeElement: any }} [doc]
 */
export function commitFocused(doc = document) {
  const el = doc.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(String(el.tagName)) && typeof el.blur === "function") el.blur();
}

/**
 * Assign already-escaped markup. Callers must have gone through `esc` / `md` / `mdDoc` first. Kept as given, for `morph`
 * to weigh against a draw's.
 * @param {HTMLElement} el
 * @param {string} html
 */
export function setHtml(el, html) {
  el.innerHTML = html;
  markupOf.set(el, String(html));
}
