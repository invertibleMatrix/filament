// @ts-check
// The harness's primitives: button, menu, popover, sheet, dialog, confirm, tooltip, toast, pills,
// collapsible, resizeHandle, fileChip, diffCount. Each returns elements built with h(); trusted markup (icons)
// goes through { html } only. Geometry lives in zc.css classes and the .zc-* component rules in harness.css.
import { h, morphChildren, on, standing } from "../../lib/dom.js";
import { ICONS, icon } from "./icons.js";
import { toastSaid } from "./page-said.js";
import { onRedrawn } from "./keep-focus.js";

/** A leading icon span, sized by the parent's font/CSS. @param {keyof typeof ICONS | undefined} name @param {string} [cls] */
const ic = (name, cls = "") => (name ? h("span", { class: `${cls || "zc-ic"}`.trim(), html: icon(name) }) : null);

/**
 * Button. variant: default | outline | secondary | ghost | destructive | warning | link.
 * size: default | xs | sm | lg | icon | icon-xs | icon-sm | icon-md | icon-lg (icon sizes stay square).
 * key: what it does among its siblings (`data-key`), so a draw in place never draws another button over it.
 * @param {{ variant?: string, size?: string, icon?: keyof typeof ICONS, label?: string, title?: string, kbd?: string,
 *   disabled?: boolean, type?: string, class?: string, onClick?: (e: MouseEvent) => void, ariaExpanded?: boolean,
 *   key?: string }} o
 */
export function button(o = {}) {
  const cls = ["zc-btn", `zc-btn-v-${o.variant || "default"}`, `zc-btn-s-${o.size || "default"}`, o.class || ""].join(" ").trim();
  const b = h("button", {
    class: cls,
    type: o.type || "button",
    ...(o.title ? { title: o.title } : {}),
    ...(o.disabled ? { disabled: "" } : {}),
    ...(o.ariaExpanded != null ? { "aria-expanded": o.ariaExpanded ? "true" : "false" } : {}),
    ...(o.key != null ? { "data-key": o.key } : {}),
    // Heard as `h`'s own, so a draw in place (`morph`) hands the button the newest draw's press.
    onclick: o.onClick,
  });
  if (o.icon) b.append(h("span", { class: "zc-btn-ic", html: icon(o.icon) }));
  if (o.label) b.append(h("span", { class: "zc-btn-label" }, o.label));
  if (o.kbd) b.append(h("span", { class: "zc-btn-kbd" }, o.kbd));
  return b;
}

/**
 * The open overlay stack: outside pointer and Esc close the topmost; tooltips never open over a menu. An overlay with a
 * `guard` (a dialog holding edits of its own) is asked first, and stays when it says no — it may ask the person, and
 * close itself on their word.
 */
const overlayStack = [];
/** @param {boolean} [force]  the page under it is going: no guard is asked */
function closeTopOverlay(force = false) {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return false;
  if (!force && top.guard && !top.guard()) return true;
  overlayStack.pop();
  top.close();
  return true;
}
/** @param {{ el: HTMLElement }} o */
const isTop = (o) => overlayStack[overlayStack.length - 1] === o;
/** Close every open overlay, the top one first: the page under them is going (a new route). */
export function closeOverlays() {
  while (closeTopOverlay(true));
}
/**
 * Close any open overlay anchored to `anchor` (toggle semantics for trigger buttons; a trigger moved elsewhere on the
 * page, as the header's crumb moves into the sidebar). @param {HTMLElement | null | undefined} anchor
 */
export function closeOverlaysFor(anchor) {
  if (!anchor) return false;
  let closed = false;
  for (let i = overlayStack.length - 1; i >= 0; i--) {
    if (overlayStack[i].anchor === anchor) {
      overlayStack[i].close();
      closed = true;
    }
  }
  return closed;
}
/**
 * Close the menus and popovers whose trigger was drawn again: their anchor was on the page as they opened and is gone
 * now. One left open points at nothing, and the new trigger in its place, another element, would open a second beside
 * it. Asked as a menu or a popover opens, and after each redraw that keeps the focus (keep-focus.js).
 */
function closeOrphans() {
  for (let i = overlayStack.length - 1; i >= 0; i--) {
    const o = overlayStack[i];
    if (o?.anchorWasOn && o.anchor?.isConnected === false) o.close();
  }
}
onRedrawn(closeOrphans);
// The overlay stack's own keys. Guarded so the module stays importable where the page does not run — the
// DOM-free tests import the widget frame, which brings this module's popover and menu.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlayStack.length) {
      e.stopPropagation();
      closeTopOverlay();
    }
  }, true);
  window.addEventListener("pointerdown", (e) => {
    const top = overlayStack[overlayStack.length - 1];
    if (!top) return;
    const t = /** @type {Node} */ (e.target);
    if (top.contains && top.contains(t)) return;
    if (top.anchor && top.anchor.contains(t)) return;
    closeTopOverlay();
  }, true);
}

/** Place a fixed overlay next to its anchor, flipping above/left when the window edge is near. */
function placeOverlay(el, anchor, o = {}) {
  document.body.append(el);
  positionOverlay(el, anchor, o);
}

/**
 * Where an overlay stands against its anchor, measured now — without moving it in the document, so the focus inside
 * it holds (a popover whose content changed height places itself again through this).
 * @param {HTMLElement} el @param {HTMLElement} anchor @param {{ side?: string, align?: string, offset?: number }} [o]
 */
function positionOverlay(el, anchor, { side = "bottom", align = "start", offset = 4 } = {}) {
  const r = anchor.getBoundingClientRect();
  // Measured whole: a height held to the room it had when last placed lets go first.
  el.style.maxHeight = "";
  el.style.overflowY = "";
  const w = el.offsetWidth;
  let hgt = el.offsetHeight;
  let top;
  let left;
  if (side === "right") {
    left = r.right - offset;
    if (left + w > window.innerWidth - 8) left = r.left - w + offset;
    top = r.top - 4;
    if (top + hgt > window.innerHeight - 8) top = window.innerHeight - hgt - 8;
    if (top < 8) top = 8;
  } else {
    top = side === "top" ? r.top - hgt - offset : r.bottom + offset;
    if (side === "bottom" && top + hgt > window.innerHeight - 8) top = r.top - hgt - offset;
    // Either side gives way to the other when it has no room: an overlay never covers its own anchor.
    if (side === "top" && top < 8 && r.bottom + offset + hgt <= window.innerHeight - 8) top = r.bottom + offset;
    // Neither side has room (a tall picker by an anchor mid-window): the side with more, the overlay held to it — its
    // list scrolls — rather than pushed over its anchor.
    const above = r.top - offset - 8;
    const below = window.innerHeight - 8 - r.bottom - offset;
    if (hgt > above && hgt > below && Math.max(above, below) > 0) {
      el.style.maxHeight = `${Math.floor(Math.max(above, below))}px`;
      // What cannot shrink to it scrolls rather than loses its foot (a picker whose list shrinks never needs to).
      el.style.overflowY = "auto";
      hgt = el.offsetHeight;
      top = above > below ? r.top - hgt - offset : r.bottom + offset;
    }
    if (top < 8) top = 8;
    left = align === "end" ? r.right - w : r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
  }
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
  // The side it landed on, after any give-way: the arrival rises from below an anchor it sits above, drops toward one
  // it sits below.
  el.setAttribute("data-side", side === "right" ? "right" : top + hgt <= r.top + 1 ? "top" : "bottom");
}

/**
 * Dropdown / context menu. Items: { type?: "item"|"label"|"separator"|"radio"|"check"|"switch", label, icon, tone, desc,
 * note, kbd, checked, disabled, inset, variant, onClick, submenu }. A switch is a setting that is on or off, its track on
 * the row's right (a check is one choice ticked among others). A `note` is a word at the row's end ("later"). Keyboard: ↑/↓ move, Enter activates, → opens a submenu,
 * ← / Esc close. Closes on outside click and on activation. `width` is in px. `set` gives an open menu its items again,
 * drawn into the rows that stand — an item's `key` keeps its row, else the next row of its kind in order —, so a menu
 * that opens at once from what the page knows takes the server's word without a row made anew under the pointer.
 * `onClose` hears it go, once, whichever way it went — so a page that holds its anchor while it is open lets go.
 * @param {any[]} items
 * @param {{ anchor?: HTMLElement, align?: "start"|"end", side?: "top"|"bottom"|"right", width?: number, onClose?: () => void }} [o]
 * @returns {{ el: HTMLElement, close: () => void, set: (items: any[]) => void }}
 */
export function menu(items, { anchor, align = "start", side = "bottom", width = 0, onClose } = {}) {
  // Toggle: a second click on the same trigger closes instead of stacking a duplicate.
  if (anchor && closeOverlaysFor(anchor)) return { el: /** @type {HTMLElement} */ (document.createElement("div")), close: () => {}, set: () => {} };
  closeOrphans();
  const el = h("div", { class: "zc-menu", role: "menu" });
  if (width) el.style.width = `${width}px`;
  /** @type {HTMLElement[]} */
  let rows = [];
  /** @type {any[]} */
  let rowItems = [];
  let hi = -1;

  const paintHi = () => {
    rows.forEach((r, i) => {
      if (i === hi) r.setAttribute("data-highlighted", "");
      else r.removeAttribute("data-highlighted");
    });
  };
  /** @param {number} dir */
  const move = (dir) => {
    if (!rows.length) return;
    let i = hi;
    for (let n = 0; n < rows.length; n++) {
      i = (i + dir + rows.length) % rows.length;
      if (!rows[i].hasAttribute("disabled")) break;
    }
    hi = i;
    paintHi();
    rows[hi].scrollIntoView({ block: "nearest" });
  };

  /** @type {any} */
  let self = null;
  let gone = false;
  const close = () => {
    el.remove();
    window.removeEventListener("keydown", onKey, true);
    const i = overlayStack.indexOf(self);
    if (i >= 0) overlayStack.splice(i, 1);
    if (gone) return;
    gone = true;
    onClose?.();
  };

  /** @param {any} item @param {HTMLElement} row */
  const activate = (item, row) => {
    if (item.disabled) return;
    if (item.submenu) {
      menu(item.submenu, { anchor: row, side: "right" });
      return;
    }
    // Activation closes the whole menu tree (this menu and any ancestor/submenu).
    for (let i = overlayStack.length - 1; i >= 0; i--) {
      if (overlayStack[i].el.classList.contains("zc-menu")) overlayStack[i].close();
    }
    item.onClick?.();
  };

  /**
   * The rows of `list`, drawn into those that stand: the first draw makes them, a `set` keeps each row an item keeps,
   * its words and its press the newest list's, and the row the pointer or the keys were on stays the one lit.
   * @param {any[]} list
   */
  const draw = (list) => {
    const lit = rows[hi] || null;
    /** @type {any[]} */
    const kids = [];
    /** @type {HTMLElement[]} */
    const made = [];
    /** @type {any[]} */
    const madeItems = [];
    // A line stands only between two things: a list writes a row that is not there as a null, and a null is a line,
    // so a line asked for is kept until something follows it — never first, never last, never two together (a
    // project's menu drew three under Open its Space, 11-12).
    let line = false;
    /** @param {any} kid */
    const put = (kid) => {
      if (line && kids.length) kids.push(h("div", { class: "zc-menu-sep", role: "separator" }));
      line = false;
      kids.push(kid);
    };
    for (const item of list) {
      if (!item || item.type === "separator") {
        line = true;
        continue;
      }
      if (item.type === "label") {
        put(h("div", { class: "zc-menu-label" }, item.label));
        continue;
      }
      if (item.type === "node" && item.node) {
        put(item.node);
        continue;
      }
      const idx = made.length;
      made.push(rowOf(item, idx));
      madeItems.push(item);
      put(made[idx]);
    }
    morphChildren(el, kids);
    rows = made.map((r) => standing(r));
    rowItems = madeItems;
    hi = lit ? rows.indexOf(lit) : -1;
    paintHi();
  };

  /** One item's row, the `idx`th. @param {any} item @param {number} idx @returns {HTMLElement} */
  const rowOf = (item, idx) => {
    const isCheckable = item.type === "radio" || item.type === "check";
    const isSwitch = item.type === "switch";
    const row = h("button", {
      class: `zc-menu-item${isCheckable ? " has-check" : ""}${isSwitch ? " has-switch" : ""}${item.desc ? " has-desc" : ""}${item.variant === "destructive" ? " destructive" : ""}`,
      type: "button",
      role: item.type === "radio" ? "menuitemradio" : item.type === "check" || isSwitch ? "menuitemcheckbox" : "menuitem",
      ...(item.key != null ? { "data-key": String(item.key) } : {}),
      ...(item.disabled ? { disabled: "" } : {}),
      ...(item.inset && !isCheckable ? { "data-inset": "" } : {}),
      ...(isCheckable || isSwitch ? { "aria-checked": item.checked ? "true" : "false" } : {}),
      onpointerenter: () => { hi = idx; paintHi(); },
    },
      // A `tone` draws the icon on a small tile in that color, the way System Settings lists its panes.
      item.tone && item.icon ? h("span", { class: "zc-menu-tile", style: `--tone:${item.tone}`, html: icon(item.icon) }) : ic(item.icon, "zc-menu-ic"),
      item.desc
        ? h("span", { class: "zc-menu-text" }, h("span", { class: "zc-menu-label-line" }, item.label), h("span", { class: "zc-menu-desc" }, item.desc))
        : h("span", { class: "zc-menu-text" }, item.label),
      item.note ? h("span", { class: "zc-menu-note" }, item.note) : null,
      item.kbd ? h("kbd", { class: "zc-menu-kbd" }, item.kbd) : null,
      item.submenu ? h("span", { class: "zc-menu-sub", html: ICONS.chevronRight }) : null,
      isCheckable ? h("span", { class: "zc-menu-check", html: item.checked ? ICONS.check : "" }) : null,
      isSwitch ? h("span", { class: `zc-menu-switch${item.checked ? " on" : ""}`, "aria-hidden": "true" }) : null);
    // The row on the page, which a later `set` may have drawn this one into: a submenu stands beside it.
    on(row, "click", () => activate(item, standing(row)));
    return row;
  };
  draw(items);

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (!self || !isTop(self)) return; // a submenu owns the keys while it is open
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); move(-1); }
    else if (e.key === "Enter" || e.key === " ") {
      if (hi >= 0) { e.preventDefault(); e.stopPropagation(); rows[hi].click(); }
    } else if (e.key === "ArrowRight" && hi >= 0) {
      if (rowItems[hi]?.submenu) { e.preventDefault(); rows[hi].click(); }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  self = { el, close, anchor: anchor || null, anchorWasOn: anchor?.isConnected === true, contains: (/** @type {Node} */ n) => el.contains(n) };
  overlayStack.push(self);
  if (anchor) placeOverlay(el, anchor, { side, align });
  return {
    el,
    close,
    set: (/** @type {any[]} */ list) => {
      draw(list);
      if (anchor && el.isConnected) positionOverlay(el, anchor, { side, align });
    },
  };
}

/**
 * Popover: a floating card next to an anchor. `onClose` hears it go, once, whichever way it went — its own close, Esc,
 * a press outside it, a second click on its anchor — so an owner that keeps it open never holds one that is gone.
 * @param {HTMLElement} anchor @param {HTMLElement} content
 * `side: "right"`: beside the anchor, as a submenu stands (the rail's Now).
 * @param {{ side?: "top"|"bottom"|"right", align?: "start"|"end", width?: number, label?: string, onClose?: () => void }} [o]
 * @returns {{ el: any, close: () => void, place?: () => void }}
 */
export function popover(anchor, content, o = {}) {
  if (anchor && closeOverlaysFor(anchor)) return { el: /** @type {HTMLElement} */ (document.createElement("div")), close: () => {} };
  closeOrphans();
  const el = h("div", { class: "zc-popover", role: "dialog", ...(o.label ? { "aria-label": o.label } : {}) }, content);
  // A card wider than the default popover (the meter's) says so; the default stays 288px. Never wider than the window
  // less the 8px each side the placing keeps: the model picker's 580px ran off a narrow window's edge.
  if (o.width) el.style.width = `min(${o.width}px, calc(100vw - 16px))`;
  /** @type {any} */
  let self = null;
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    el.remove();
    const i = overlayStack.indexOf(self);
    if (i >= 0) overlayStack.splice(i, 1);
    o.onClose?.();
  };
  self = { el, close, anchor, anchorWasOn: anchor?.isConnected === true, contains: (/** @type {Node} */ n) => el.contains(n) };
  overlayStack.push(self);
  placeOverlay(el, anchor, o);
  // `place`: measured and placed again, for content that changed its height (an instrument's second page).
  return { el, close, place: () => { if (el.isConnected) positionOverlay(el, anchor, o); } };
}

/** Keep Tab and Shift+Tab inside a modal's box — among its visible controls: the wrap would dead-end on a hidden one
 *  (the command center hides its title row, close button and all). @param {HTMLElement} root @param {HTMLElement} box */
function trapFocus(root, box) {
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = Array.from(box.querySelectorAll("button, input, textarea, select, a[href], [tabindex]")).filter((x) => !x.hasAttribute("disabled") && x.getAttribute("tabindex") !== "-1" && x.getClientRects().length > 0);
    if (!f.length) return;
    const first = /** @type {HTMLElement} */ (f[0]);
    const last = /** @type {HTMLElement} */ (f[f.length - 1]);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/**
 * Sheet: a panel that slides in from the window's right edge over a dimmed page, the way a macOS inspector sheet
 * opens. It takes over from whatever overlay was open (a popover would otherwise float over the dim); Esc, the close
 * button and a click on the page close it, Tab stays inside it, and focus goes back to whatever opened it. The
 * caller builds the title bar's contents (`head`), the body (the one scroll container) and an optional footer that
 * stays put under it.
 * @param {{ label: string, head: HTMLElement, body: HTMLElement, foot?: HTMLElement | null, class?: string, onClose?: () => void }} o
 * @returns {{ el: HTMLElement, scroller: HTMLElement, close: () => void }}
 */
export function sheet(o) {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const closeBtn = button({ icon: "x", size: "icon-sm", variant: "ghost", title: "Close (Esc)", class: "zc-sheet-x" });
  const scroller = h("div", { class: "zc-sheet-body" }, o.body);
  const panel = h("aside", { class: `zc-sheet glass${o.class ? ` ${o.class}` : ""}`, role: "dialog", "aria-modal": "true", "aria-label": o.label },
    h("header", { class: "zc-sheet-head" }, o.head, closeBtn),
    scroller,
    o.foot ? h("footer", { class: "zc-sheet-foot" }, o.foot) : null);
  const overlay = h("div", { class: "zc-sheet-overlay" }, panel);
  /** @type {any} */
  let self = null;
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    const i = overlayStack.indexOf(self);
    if (i >= 0) overlayStack.splice(i, 1);
    invoker?.focus?.();
    o.onClose?.();
  };
  closeBtn.addEventListener("click", close);
  trapFocus(overlay, panel);
  closeOverlays();
  self = { el: overlay, close, anchor: null, contains: (/** @type {Node} */ n) => panel.contains(n) };
  overlayStack.push(self);
  document.body.append(overlay);
  closeBtn.focus();
  return { el: overlay, scroller, close };
}

/**
 * Dialog: overlay + centred card, focus trap, Esc closes. `glyph`: a tile before the title (a team's, on its sheet).
 * `guard`: asked before Esc, ×, a click outside or an unforced `close()` takes it away — false keeps it open (a sheet
 * with edits of its own asks the person, and closes itself on their word with `close(true)`). `cls`: the card's own
 * kind (the command center's, an editor's), which its looks are written against. Opened from inside a popover — a
 * command's Stop in the status popover — it stands over it and leaves it open: closed, the person is back where they
 * pressed, or in that popover where a redraw took the pressed control away while it asked (the Designer's of 10-28).
 * It never stands taller than the window: its body is the part that scrolls, its title and its actions always in
 * sight (the owner's Clean up of 11-09 ran off the window, its buttons out of reach). The body is marked so, not
 * wrapped: what is written against `.zc-dialog > .x` still finds it.
 * @param {{ title: string, glyph?: HTMLElement | null, description?: string, body?: HTMLElement | null, wide?: boolean,
 *   actions?: { label: string, variant?: string, onClick?: () => void }[], onClose?: () => void, guard?: () => boolean,
 *   cls?: string }} o
 * @returns {{ el: HTMLElement, close: (force?: boolean) => void }}
 */
export function dialog(o) {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // The overlay the press came from, if any: the focus's place to go back to when its control is gone.
  const host = invoker ? [...overlayStack].reverse().find((x) => x.contains?.(invoker)) || null : null;
  const overlay = h("div", { class: "zc-dialog-overlay" });
  const closeBtn = button({ icon: "x", size: "icon-sm", variant: "ghost", title: "Close", class: "zc-dialog-x" });
  const title = h("h2", { class: "zc-dialog-title" }, o.title);
  o.body?.classList.add("zc-dialog-body");
  const card = h("div", { class: `zc-dialog${o.wide ? " wide" : ""}${o.cls ? ` ${o.cls}` : ""}`, role: "dialog", "aria-modal": "true", "aria-label": o.title },
    h("div", { class: "flex justify-between items-start gap-2" },
      o.glyph ? h("div", { class: "zc-dialog-head" }, o.glyph, title) : title,
      closeBtn),
    o.description ? h("p", { class: "zc-dialog-desc" }, o.description) : null,
    o.body || undefined,
    (o.actions?.length)
      ? h("div", { class: "zc-dialog-foot" },
          ...o.actions.map((a) => button({ label: a.label, variant: a.variant || "default", onClick: () => { a.onClick?.(); } })))
      : null);
  overlay.append(card);
  /** @type {any} */
  let self = null;
  const gone = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    const i = overlayStack.indexOf(self);
    if (i >= 0) overlayStack.splice(i, 1);
    if (invoker?.isConnected || !host?.el?.isConnected) invoker?.focus?.();
    else {
      if (!host.el.hasAttribute("tabindex")) host.el.setAttribute("tabindex", "-1");
      host.el.focus();
    }
    o.onClose?.();
  };
  const close = (force = false) => {
    if (!force && o.guard && !o.guard()) return;
    gone();
  };
  closeBtn.addEventListener("click", () => close());
  trapFocus(overlay, card);
  self = { el: overlay, close: gone, guard: o.guard || null, anchor: null, contains: (/** @type {Node} */ n) => overlay.contains(n) };
  overlayStack.push(self);
  document.body.append(overlay);
  const firstBtn = card.querySelector(".zc-dialog-foot button") || card.querySelector("button");
  if (firstBtn) /** @type {HTMLElement} */ (firstBtn).focus();
  return { el: overlay, close };
}

/**
 * Confirm: Cancel (outline) + confirm (default or destructive). @returns {Promise<boolean>}
 * @param {{ title: string, description?: string, confirmLabel?: string, destructive?: boolean }} o
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    let done = false;
    const d = dialog({
      title: o.title,
      description: o.description,
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => { done = true; d.close(); resolve(false); } },
        {
          label: o.confirmLabel || "Confirm",
          variant: o.destructive ? "destructive" : "default",
          onClick: () => { done = true; d.close(); resolve(true); },
        },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/** The tooltip on the page, if one is: one shows at a time. @type {{ hide: () => void } | null} */
let tipShown = null;

/**
 * Tooltip: instant, above the control with a 2px offset,
 * kbd chip, never over an open menu. A `kbd` that can be rebound, and a title that names a choice made elsewhere, are
 * read when the tip shows. One shows at a time. A control drawn again under the pointer, or moved from under it, hears
 * no leave — the left bar draws its heads again as a chat's status changes, and "Add project" stood over it for good
 * (the owner's of 10-28) —, so a shown tip watches its control and goes once it is off the page or not under the pointer.
 * @param {HTMLElement} el
 * @param {{ title: string | (() => string), kbd?: string | (() => string) }} o
 */
export function tooltip(el, o) {
  /** @type {HTMLElement | null} */
  let tipRef = null;
  /** @type {any} */
  let watch = 0;
  const hide = () => {
    if (watch) { window.clearInterval(watch); watch = 0; }
    if (tipRef) { tipRef.remove(); tipRef = null; }
    if (tipShown === self) tipShown = null;
  };
  const self = { hide };
  const show = () => {
    tipShown?.hide();
    if (!document.contains(el) || overlayStack.some((x) => x.el?.classList?.contains("zc-menu"))) return;
    const kbd = typeof o.kbd === "function" ? o.kbd() : o.kbd;
    const tip = /** @type {HTMLElement} */ (h("div", { class: "zc-tooltip", role: "tooltip" },
      h("span", { class: "zc-tooltip-title" }, typeof o.title === "function" ? o.title() : o.title),
      kbd ? h("span", { class: "zc-kbd" }, kbd) : null));
    tipRef = tip;
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    let left = r.left + r.width / 2 - w / 2;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    let top = r.top - tip.offsetHeight - 2;
    if (top < 8) top = r.bottom + 2;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tipShown = self;
    watch = window.setInterval(() => {
      if (!el.isConnected || !el.matches(":hover")) hide();
    }, 250);
  };
  el.addEventListener("pointerenter", show);
  el.addEventListener("pointerleave", hide);
  el.addEventListener("pointerdown", hide);
  return { hide };
}

/** How long a toast with an action stays: long enough to reach its button. */
const TOAST_ACTION_MS = 8000;

/**
 * Toast: bottom-right stack, 200ms in/out. `action`: one button after its words — a button's result handed to an
 * agent (HarnessV4_Space_Plan S5d) —, which takes the toast with it; such a toast stays 8 s. `ms`: how long it stays,
 * where it needs longer to read.
 * @param {string} msg @param {string} [kind] @param {{ action?: { label: string, title?: string, onClick: () => void }, ms?: number }} [o]
 */
export function toast(msg, kind = "", o = {}) {
  /** @type {HTMLElement | null} */
  let stack = document.querySelector(".zc-toast-stack");
  if (!stack) {
    stack = /** @type {HTMLElement} */ (h("div", { class: "zc-toast-stack" }));
    document.body.append(stack);
  }
  const a = o.action;
  const t = h("div", { class: `zc-toast ${kind}${a ? " has-action" : ""}`.trim() }, msg);
  const gone = () => {
    t.classList.remove("show");
    window.setTimeout(() => t.remove(), 220);
  };
  if (a) t.append(h("button", { class: "ghost sm zc-toast-act", type: "button", ...(a.title ? { title: a.title } : {}), onclick: () => { gone(); a.onClick(); } }, a.label));
  stack.append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  window.setTimeout(gone, o.ms ?? (a ? TOAST_ACTION_MS : kind === "err" ? 6000 : 3000));
  toastSaid(msg, kind);
}

/**
 * Tabs (pill list): sliding indicator, 200ms. options: { id, label, icon, title } — `title`, what it shows, on hover.
 * @param {{ id: string, label: string, icon?: keyof typeof ICONS, title?: string }[]} options
 * @param {{ active: string, onChange: (id: string) => void }} o
 */
export function pills(options, o) {
  const ind = h("span", { class: "zc-pill-ind", "aria-hidden": "true" });
  const list = h("div", { class: "zc-pills", role: "tablist" }, ind);
  /** @type {Map<string, HTMLElement>} */
  const btns = new Map();
  const paint = () => {
    const on = btns.get(o.active);
    for (const [id, b] of btns) b.classList.toggle("on", id === o.active);
    if (on) {
      ind.style.width = `${on.offsetWidth}px`;
      ind.style.transform = `translateX(${on.offsetLeft}px)`;
    }
  };
  for (const opt of options) {
    const b = h("button", { class: "zc-pill", type: "button", role: "tab", onclick: () => { o.active = opt.id; o.onChange(opt.id); paint(); } },
      ic(opt.icon), h("span", {}, opt.label));
    if (opt.title) tooltip(b, { title: opt.title });
    btns.set(opt.id, b);
    list.append(b);
  }
  requestAnimationFrame(paint);
  return { el: list, setActive: (id) => { o.active = id; paint(); }, repaint: paint };
}

/**
 * Collapsible: trigger row with a trailing chevron (opacity 0 until hover, rotates when open); the body
 * animates height 300ms. @param {HTMLElement} trigger @param {HTMLElement} content @param {{ open?: boolean }} [o]
 */
export function collapsible(trigger, content, o = {}) {
  const chev = h("span", { class: "zc-chev", html: ICONS.chevronRight });
  const head = h("button", { class: "zc-collapsible-trigger", type: "button", "aria-expanded": o.open ? "true" : "false" }, trigger, chev);
  const body = h("div", { class: "zc-collapsible-body" }, h("div", { class: "zc-collapsible-inner" }, content));
  const el = h("div", { class: `zc-collapsible${o.open ? " open" : ""}` }, head, body);
  head.addEventListener("click", () => {
    const open = !el.classList.contains("open");
    el.classList.toggle("open", open);
    head.setAttribute("aria-expanded", open ? "true" : "false");
  });
  return { el, get open() { return el.classList.contains("open"); } };
}

/**
 * Resizable handle: a transparent 4px strip drawing a 1px masked indicator on hover/focus/drag; arrows
 * move 16px, Home/End min/max. Width transitions are off while dragging. `min`/`max` may be functions so a
 * window resize re-fences the bounds. `invert` is for a handle on the right of the thing it sizes: there the
 * panel grows when the pointer moves left, so the drag delta flips sign.
 * @param {{ axis: "x"|"y", min: number | (() => number), max: number | (() => number), get: () => number, set: (px: number) => void, onEnd?: () => void, invert?: boolean }} o
 */
export function resizeHandle(o) {
  const lo = () => (typeof o.min === "function" ? o.min() : o.min);
  const hi = () => (typeof o.max === "function" ? o.max() : o.max);
  const dir = o.invert ? -1 : 1;
  const el = h("div", { class: `zc-resize ${o.axis}`, role: "separator", tabindex: "0", "aria-orientation": o.axis === "x" ? "vertical" : "horizontal" });
  let start = 0;
  let startPos = 0;
  /** @param {PointerEvent} e */
  const onMove = (e) => {
    const d = (o.axis === "x" ? e.clientX : e.clientY) - startPos;
    o.set(Math.min(hi(), Math.max(lo(), start + dir * d)));
  };
  /** @param {PointerEvent} e */
  const onUp = (e) => {
    el.classList.remove("drag");
    try { el.releasePointerCapture(e.pointerId); } catch {}
    el.removeEventListener("pointermove", onMove);
    o.onEnd?.();
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    start = o.get();
    startPos = o.axis === "x" ? e.clientX : e.clientY;
    el.classList.add("drag");
    try { el.setPointerCapture(e.pointerId); } catch {} // synthetic or stale pointers have no capture
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp, { once: true });
    el.addEventListener("pointercancel", onUp, { once: true });
  });
  el.addEventListener("keydown", (e) => {
    const cur = o.get();
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); o.set(Math.max(lo(), cur - dir * 16)); o.onEnd?.(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); o.set(Math.min(hi(), cur + dir * 16)); o.onEnd?.(); }
    else if (e.key === "Home") { e.preventDefault(); o.set(lo()); o.onEnd?.(); }
    else if (e.key === "End") { e.preventDefault(); o.set(hi()); o.onEnd?.(); }
  });
  return { el };
}

/**
 * File chip: 16px file-type icon + truncated path leaf; clickable chips open the viewer.
 * @param {{ icon?: keyof typeof ICONS, name: string, path?: string, onClick?: () => void }} o
 */
export function fileChip(o) {
  const chip = h("span", { class: "zc-filechip" },
    ic(o.icon || "file"),
    h("span", { class: "zc-filechip-name" }, o.name),
    o.path ? h("span", { class: "zc-filechip-path" }, o.path) : null);
  if (o.onClick) {
    chip.classList.add("link");
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    chip.addEventListener("click", () => o.onClick?.());
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onClick?.(); }
    });
  }
  return chip;
}

/**
 * A unified diff as rows: the heads before its first hunk, then each hunk's head and its lines, a line's sign in the
 * gutter alone. A patch the backend clipped says so; a binary file says it cannot be previewed. Neither is rendered as
 * an empty diff.
 * @param {string} patch
 * @param {{ truncated?: boolean, binary?: boolean, h?: typeof h }} [o]  `h`: the element maker (a test's fake DOM)
 * @returns {HTMLElement}
 */
export function diffView(patch, o = {}) {
  const mk = o.h || h;
  if (o.binary) return mk("p", { class: "pane-note" }, "Binary diff preview is unavailable.");
  const rows = String(patch || "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
  let hunks = false;
  const body = mk("div", { class: "diff-view" },
    ...rows.map((l) => {
      hunks ||= l.startsWith("@@");
      const kind = l.startsWith("@@") ? "hunk" : !hunks ? "head" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx";
      const gutter = kind === "add" ? "+" : kind === "del" ? "−" : "";
      const signed = kind === "add" || kind === "del" || (kind === "ctx" && l.startsWith(" "));
      return mk("div", { class: `diff-line ${kind}` }, mk("span", { class: "diff-gutter" }, gutter), mk("span", { class: "diff-text" }, signed ? l.slice(1) : l));
    }));
  return mk("div", { class: "diff-wrap" },
    rows.length ? body : mk("p", { class: "pane-note" }, "No changes."),
    o.truncated ? mk("p", { class: "pane-note" }, "Diff has been truncated.") : null);
}

/**
 * `+N -N`: mono, tabular, ASCII minus; zeros omitted. The digits
 * flip once when they change.
 * @param {{ added?: number, removed?: number }} o
 */
export function diffCount(o = {}) {
  const el = h("span", { class: "zc-diff" });
  const paint = (a, r) => {
    el.replaceChildren(...[
      a ? h("span", { class: "zc-diff-add" }, `+${a}`) : null,
      r ? h("span", { class: "zc-diff-del" }, `-${r}`) : null,
    ].filter(Boolean));
  };
  paint(o.added || 0, o.removed || 0);
  return {
    el,
    /** @param {number} a @param {number} r */
    update(a, r) {
      if (a === (o.added || 0) && r === (o.removed || 0)) return;
      o = { added: a, removed: r };
      paint(a, r);
      el.classList.remove("flip");
      void el.offsetWidth;
      el.classList.add("flip");
    },
  };
}
