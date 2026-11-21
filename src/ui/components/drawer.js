// @ts-check
// The slide-over panel the admin dashboard uses for a request, a template preview, or a rule
// override. The harness page does not import this — it has no admin chrome.

import { $, h } from "../lib/dom.js";

/**
 * The open drawer's close guard, what hears it close, and where the focus goes back to when it closes.
 * @type {{ guard: (() => boolean) | null, onClose: (() => void) | null, back: HTMLElement | null }}
 */
const open = { guard: null, onClose: null, back: null };

/** Whether the drawer holds a sheet with edits of its own (one opened with a guard): the configuration under it stays put. */
export const drawerHolds = () => !!open.guard;

/**
 * The drawer is a modal dialog (index.html): opening it moves the focus to its title, closing it gives the focus back
 * to what had it. A sheet that holds edits of its own passes `guard`, asked before any close but a forced one (×,
 * Escape, a page's closeDrawer()); false keeps the drawer open. `onClose` hears it close, once, whichever way.
 * @param {string} title
 * @param {Node} content
 * @param {{ guard?: () => boolean, onClose?: () => void }} [opts]
 */
export function openDrawer(title, content, opts = {}) {
  const d = $("#drawer");
  const head = h("h2", { id: "drawer-title", tabindex: "-1" }, title);
  $("#drawer-body").replaceChildren(head, content);
  if (d.classList.contains("hidden")) open.back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const was = open.onClose;
  open.onClose = null;
  was?.();
  open.guard = opts.guard || null;
  open.onClose = opts.onClose || null;
  d.classList.remove("hidden");
  requestAnimationFrame(() => {
    d.classList.add("open");
    head.focus({ preventScroll: true });
  });
}

/** @param {{ force?: boolean }} [opts] @returns {boolean} whether it closed */
export function closeDrawer(opts = {}) {
  if (!opts.force && open.guard && !open.guard()) return false;
  open.guard = null;
  const heard = open.onClose;
  open.onClose = null;
  heard?.();
  const d = $("#drawer");
  d.classList.remove("open");
  setTimeout(() => {
    if (!d.classList.contains("open")) d.classList.add("hidden");
  }, 200);
  const back = open.back;
  open.back = null;
  if (back?.isConnected) back.focus({ preventScroll: true });
  return true;
}

export function bindDrawer() {
  $("#drawer-close").onclick = () => closeDrawer();
  // Tab stays inside the dialog: past its last control it comes round to the first, and back.
  $("#drawer").addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== "Tab") return;
    const inner = /** @type {HTMLElement} */ ($("#drawer .drawer-inner"));
    const stops = /** @type {HTMLElement[]} */ (Array.from(inner.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))).filter((x) => !(/** @type {any} */ (x).disabled) && x.offsetParent !== null);
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || !inner.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !inner.contains(at))) { e.preventDefault(); first.focus(); }
  });
}

/**
 * A template-preview / apply table: from → to, or a sentence when nothing would change.
 * @param {any[]} [changes]
 * @param {any[]} [errors]
 */
export function diffView(changes = [], errors = []) {
  return h(
    "div",
    {},
    errors?.length ? h("p", { class: "err" }, errors.join("; ")) : null,
    changes.length
      ? h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", {}, "setting"), h("th", {}, "from"), h("th", {}, "to"))),
          h(
            "tbody",
            {},
            ...changes.map((d) =>
              h(
                "tr",
                {},
                h("td", {}, h("code", {}, d.path)),
                h("td", {}, h("code", {}, JSON.stringify(d.from))),
                h("td", {}, h("code", {}, JSON.stringify(d.to))),
              ),
            ),
          ),
        )
      : h("p", { class: "muted" }, "No changes: this template is already in effect."),
  );
}
