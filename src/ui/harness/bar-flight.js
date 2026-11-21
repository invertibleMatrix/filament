// @ts-check
// The left bar's moves (the Designer's of 10-27, "one chat, one place"): a chat rises out of its project into Now when
// its work starts and goes home after its quiet minute, and the bar draws its lists anew whole each time. Before a draw
// the bar notes where each of its marked parts stands (`data-flip`); after it, every part that moved slides from where
// it stood (FLIP), and a chat that changed place is carried between the two over the bar — a lifted copy picked up
// where it stood, set down where it lands, the row itself shown once it is there — as each list clips what scrolls out
// of it. A place scrolled out of view is met at its list's edge, and a folded project's chat rises out of its head and
// drops back into it: the list never scrolls by itself. Motion Reduced: a short fade where a chat lands; Off: nothing.
// A part that goes simply goes, and a draw that brings or takes many at once (a filter, the archive) has no motion.
// The pointer on the bar, or on a menu it opened, holds the moves; a press on its rows holds their redraw (`barHold`).

/** A part's place before a draw: its box, itself, the box of the list that scrolls it, and whether it stands in Now. */
/** @typedef {{ r: DOMRect, el: Element, box: DOMRect | null, inNow: boolean }} Place */
/** @typedef {{ left: number, top: number, width: number, height: number }} Box */

/** Aqua's spring (`--aq-ease`): quick away, settling in. */
const EASE = "cubic-bezier(0.25, 1, 0.5, 1)";
const FLIGHT_MS = 420;
const SLIDE_MS = 300;
/** More parts than this coming or going in one draw is a new list, drawn still. */
const MOST = 24;
/** The list that scrolls the bar's parts: Now and the projects in one (the owner's of 11-01). */
const LISTS = ".sess-scroll";

/** The developer's Motion: full, reduced or off (theme.js sets it on the page). @returns {string} */
export const motion = () => (typeof document === "undefined" ? "off" : document.documentElement?.dataset?.motion || "full");

/**
 * The parts landing now, by their `data-flip`: each is kept out of sight by a rule of the flight layer's own until its
 * copy sets it down — a draw in mid-flight (Now's round line moving on) makes the row anew, and the new one must not
 * stand there before its copy does.
 * @type {Map<string, number>}
 */
const landing = new Map();
/** The rule that keeps them out of sight. @type {HTMLStyleElement | null} */
let landingRule = null;
/** @param {HTMLElement} layer */
function paintLanding(layer) {
  const rule = landingRule || document.createElement("style");
  if (!landingRule) {
    landingRule = rule;
    layer.append(rule);
  }
  rule.textContent = [...landing.keys()].map((k) => `.side-frame [data-flip="${CSS.escape(k)}"]`).join(", ") + (landing.size ? " { visibility: hidden; }" : "");
}

/** Whether a box is drawn at all: a part in a closed fold measures nothing. @param {Box} r */
const drawn = (r) => r.width > 0 || r.height > 0;

/**
 * Where each of the bar's marked parts stands now; nothing where the page cannot move them, or Motion is off.
 * @param {HTMLElement} root @returns {Map<string, Place>}
 */
export function notePlaces(root) {
  /** @type {Map<string, Place>} */
  const out = new Map();
  if (typeof root.animate !== "function" || motion() === "off") return out;
  for (const el of Array.from(root.querySelectorAll("[data-flip]"))) {
    const r = el.getBoundingClientRect();
    if (!drawn(r)) continue;
    out.set(String(el.getAttribute("data-flip")), { r, el, box: el.closest(LISTS)?.getBoundingClientRect() || null, inNow: !!el.closest(".now-slot") });
  }
  return out;
}

/**
 * Each marked part from where it stood to where it stands.
 * @param {HTMLElement} root @param {HTMLElement} layer  the bar's flight layer, over both lists
 * @param {Map<string, Place>} before  `notePlaces` before the draw
 * @param {{ homeOf?: (chain: string) => Element | null }} [o]  `homeOf`: the folded project's head a chat with no row of
 *   its own in the list goes into and comes out of; null where there is none
 */
export function playMoves(root, layer, before, o = {}) {
  const mo = motion();
  if (!before.size || mo === "off" || typeof root.animate !== "function") return;
  /** @type {Map<string, Element>} */
  const after = new Map();
  for (const el of Array.from(root.querySelectorAll("[data-flip]"))) if (drawn(el.getBoundingClientRect())) after.set(String(el.getAttribute("data-flip")), el);
  const came = [...after.keys()].filter((k) => !before.has(k));
  const went = [...before.keys()].filter((k) => !after.has(k));
  if (came.length + went.length > MOST) return;
  const base = layer.getBoundingClientRect();
  /** The place a chat's folded project's head stands, before the draw where it stood then. @param {string} key */
  const headOf = (key) => {
    const head = key.startsWith("chat:") ? o.homeOf?.(key.slice(5)) || null : null;
    if (!head) return null;
    const had = before.get(String(head.getAttribute("data-flip")));
    return { head, place: had || { r: head.getBoundingClientRect(), el: head, box: head.closest(LISTS)?.getBoundingClientRect() || null, inNow: false } };
  };
  for (const [k, el] of after) {
    const r = el.getBoundingClientRect();
    const b = before.get(k);
    if (b) {
      if (b.inNow !== !!el.closest(".now-slot")) carry(layer, base, mo, { r: b.r, box: b.box, el: b.el }, /** @type {HTMLElement} */ (el), r, false);
      else slide(el, b.r, r, mo);
      continue;
    }
    // New here: a chat out of its folded project rises from the folder's head; anything else fades in.
    const from = el.closest(".now-slot") ? headOf(k) : null;
    if (from) {
      carry(layer, base, mo, { r: from.place.r, box: from.place.box, el: null }, /** @type {HTMLElement} */ (el), r, true);
      bump(from.head);
    } else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: mo === "full" ? 200 : 120, easing: "ease-out" });
  }
  // Gone from here: a chat going home into its folded project drops into the folder's head.
  if (mo !== "full") return;
  for (const k of went) {
    const b = /** @type {Place} */ (before.get(k));
    const to = b.inNow ? headOf(k) : null;
    if (!to) continue;
    const at = to.head.getBoundingClientRect();
    const z = edge(at, to.head.closest(LISTS)?.getBoundingClientRect() || null) || at;
    const g = lifted(layer, base, b.el, b.r);
    g.animate([{ transform: "none" }, { transform: `translate(${z.left - b.r.left}px, ${z.top - b.r.top}px) scale(0.6)` }], { duration: FLIGHT_MS, easing: EASE });
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS, easing: "ease-in", fill: "forwards" }).finished.then(() => g.remove(), () => g.remove());
    setTimeout(() => bump(to.head), FLIGHT_MS * 0.7);
  }
}

/** A part that moved within its list, from where it stood. @param {Element} el @param {Box} a @param {Box} r @param {string} mo */
function slide(el, a, r, mo) {
  const dx = a.left - r.left;
  const dy = a.top - r.top;
  if (mo !== "full" || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return;
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: EASE });
}

/**
 * Where a part scrolled out of its list's view meets it: at the list's edge, inside it, with the way it slips under.
 * Null while the part is in view.
 * @param {Box} r @param {Box & { bottom?: number } | null} box
 * @returns {(Box & { drift: number }) | null}
 */
function edge(r, box) {
  if (!box) return null;
  const mid = r.top + r.height / 2;
  const bottom = box.top + box.height;
  if (mid < box.top) return { left: r.left, top: box.top, width: r.width, height: r.height, drift: -10 };
  if (mid > bottom) return { left: r.left, top: bottom - r.height, width: r.width, height: r.height, drift: 10 };
  return null;
}

/** A lifted copy of a part at a box, on the flight layer. @param {HTMLElement} layer @param {Box} base @param {Element} src @param {Box} r */
function lifted(layer, base, src, r) {
  const g = document.createElement("div");
  g.className = "lb-ghost";
  g.setAttribute("aria-hidden", "true");
  Object.assign(g.style, { left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const copy = /** @type {Element} */ (src.cloneNode(true));
  for (const x of [copy, ...Array.from(copy.querySelectorAll("[data-flip], [tabindex], [id]"))]) {
    x.removeAttribute("data-flip");
    x.removeAttribute("tabindex");
    x.removeAttribute("id");
  }
  g.append(copy);
  layer.append(g);
  return g;
}

/**
 * A chat carried between Now and its project: picked up where it stood (`from.el`, none when it rises out of a folded
 * head), set down where it lands. Where either end is scrolled out of view the flight meets its list's edge.
 * @param {HTMLElement} layer @param {Box} base @param {string} mo
 * @param {{ r: Box, box: Box | null, el: Element | null }} from @param {HTMLElement} el @param {Box} r @param {boolean} fromHead
 */
function carry(layer, base, mo, from, el, r, fromHead) {
  if (mo !== "full") {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
    return;
  }
  const src = edge(from.r, from.box);
  const dst = edge(r, el.closest(LISTS)?.getBoundingClientRect() || null);
  if (src && dst) return; // out of view at both ends: nothing to see
  const a = src || from.r;
  const z = dst || r;
  if (from.el && !src) {
    const out = lifted(layer, base, from.el, from.r);
    out.animate([{ transform: "none" }, { transform: `translate(${z.left - from.r.left}px, ${z.top - from.r.top + (dst ? dst.drift : 0)}px)` }], { duration: FLIGHT_MS, easing: EASE });
    out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS * 0.55, easing: "ease-out", fill: "forwards" }).finished.then(() => out.remove(), () => out.remove());
  }
  const inn = lifted(layer, base, el, z);
  // Out of sight until set down, by its key: whatever row stands there then (a draw may make it anew meanwhile). Hidden
  // in the frame the flight starts in, before that frame is painted, never sooner: a page that draws no frames — the
  // agent's browser, parked where no one looks — never sets a flight down, and the chat that left Now stood nowhere in
  // sight there, gone from Now and hidden under its project (the live look of 10-27). There it stands where it lands.
  // Nor once it is set down: a window hidden as the flight went — minimized, covered — finishes it first when it draws
  // again, and runs that frame after, which hid the row for good (the owner's blank space in a project, 10-30).
  const key = String(el.getAttribute("data-flip"));
  const mine = (landing.get(key) || 0) + 1;
  let down = false;
  if (!dst) {
    requestAnimationFrame(() => {
      if (down) return;
      landing.set(key, mine);
      paintLanding(layer);
    });
  }
  const flight = inn.animate([
    { transform: `translate(${a.left - z.left}px, ${a.top - z.top + (src ? src.drift : 0)}px)${fromHead ? " scale(0.6)" : ""}` },
    { transform: dst ? `translate(0px, ${dst.drift}px)` : "none" },
  ], { duration: FLIGHT_MS, easing: EASE });
  inn.animate(dst ? [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], { duration: dst ? FLIGHT_MS : FLIGHT_MS * 0.6, easing: "ease-out", fill: "forwards" });
  const end = () => {
    down = true;
    inn.remove();
    // A later flight of the same row owns its landing now.
    if (dst || landing.get(key) !== mine) return;
    landing.delete(key);
    paintLanding(layer);
    const now = layer.parentElement?.querySelector(`[data-flip="${CSS.escape(key)}"]`);
    if (now) ring(now);
  };
  flight.finished.then(end, end);
}

/** A row set down rings once. @param {Element} el */
function ring(el) {
  el.classList.remove("lb-landed");
  void (/** @type {HTMLElement} */ (el).offsetWidth);
  el.classList.add("lb-landed");
  el.addEventListener("animationend", () => el.classList.remove("lb-landed"), { once: true });
}

/**
 * What keeps the bar still under the person's hand. The pointer on the bar holds its moves — a row never jumps away
 * under an aim — until it rests `rest` ms or leaves; a menu the bar opened is the bar's too, though the page draws it
 * outside (the Hunter's find of 10-27: moving into a chat's menu played the moves, and its row flew from under it). A
 * press on its rows, the list's or Now's, holds their redraw until it ends, `press` ms at most: a row drawn anew under a
 * press loses its click, which goes to what the press and the release share (the Hunter's find of 10-27: Now's rows were
 * not held, and its round line moves on often).
 * @param {HTMLElement} host  the bar @param {HTMLElement[]} rows  the parts a press on holds: the list and Now's slots
 * @param {{ rest: number, press: number, onLeave: () => void, onRelease: () => void }} o
 */
export function barHold(host, rows, o) {
  let pointerIn = false;
  let movedAt = 0;
  let pressedAt = 0;
  const moved = () => { movedAt = Date.now(); };
  /** The bar's menus the pointer went into. @type {WeakSet<Element>} */
  const menus = new WeakSet();
  /** The pointer gone from the bar or one of its menus: still on the bar where it went into either. @param {PointerEvent} e */
  const left = (e) => {
    const into = /** @type {Element | null} */ (e.relatedTarget);
    const menu = into?.closest?.(".zc-menu");
    if (menu) {
      if (!menus.has(menu)) {
        menus.add(menu);
        menu.addEventListener("pointermove", moved);
        menu.addEventListener("pointerleave", /** @type {EventListener} */ (left));
      }
      return;
    }
    if (into && host.contains(into)) return;
    pointerIn = false;
    o.onLeave();
  };
  host.addEventListener("pointerenter", () => { pointerIn = true; moved(); });
  host.addEventListener("pointermove", moved);
  host.addEventListener("pointerleave", left);
  for (const el of rows) el.addEventListener("pointerdown", () => { pressedAt = Date.now(); });
  const released = () => {
    if (!pressedAt) return;
    pressedAt = 0;
    o.onRelease();
  };
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, released, true);
  window.addEventListener("blur", released);
  return {
    /** Until when the bar's moves wait: 0 while the pointer is off the bar and its menus. */
    held: () => (pointerIn ? movedAt + o.rest : 0),
    /** Whether a press on its rows holds their redraw. */
    pressing: () => !!pressedAt && Date.now() - pressedAt < o.press,
  };
}

/** A folded project's count ticks as a chat drops in or rises out. @param {Element} head */
function bump(head) {
  const n = head.querySelector(".proj-count");
  if (!n) return;
  n.classList.remove("lb-bump");
  void (/** @type {HTMLElement} */ (n).offsetWidth);
  n.classList.add("lb-bump");
  n.addEventListener("animationend", () => n.classList.remove("lb-bump"), { once: true });
}
