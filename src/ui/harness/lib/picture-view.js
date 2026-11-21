// @ts-check
// A picture whole, over the page (HarnessV4_Tasks U9): a call's thumbnail opened. A click anywhere but the picture,
// Escape or the close button puts it away, and the page under it stays as it was; "Open in a new tab" gives the file
// itself, to save or zoom.
import { h } from "../../lib/dom.js";

/** The address a kept picture is served at: Filament's own, so it loads at once (V4-D138's chip guards other sites). @param {string} ref */
export const pictureUrl = (ref) => `/api/runs/images/${encodeURIComponent(String(ref || ""))}`;

/** The types a picture you send is drawn in from the page's own bytes (V4-D301, V4-D303), as a call's are kept (U9):
 *  the four raster ones, never an SVG. */
export const SENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The pictures this page loaded, and the ones it found gone, by address (`pictureThumb`): the latest few hundred. */
const loaded = /** @type {Set<string>} */ (new Set());
const lost = /** @type {Set<string>} */ (new Set());
const SEEN_KEPT = 500;
/** A picture's address, kept in `seen` as its newest: the one kept longest goes past SEEN_KEPT. @param {Set<string>} seen @param {string} src */
const keep = (seen, src) => {
  seen.delete(src);
  seen.add(src);
  if (seen.size > SEEN_KEPT) seen.delete(/** @type {string} */ (seen.values().next().value));
};
/** Whether this page found a picture gone: a card drawn again says so from the first. @param {string} src */
export const pictureLost = (src) => lost.has(src);

/**
 * One picture's thumbnail (HarnessV4_Tasks U9): a button to the keyboard as to the mouse — Tab reaches it, Enter or
 * Space opens it whole over the page as a click does. `onGone`: it did not load (swept). Until it lands it is
 * `loading`, and one alone holds a screenshot's place (harness.css, V4-D220): it showed as an empty pill, its border
 * round nothing, while the page's other reads held the connections. A call's pictures and the ones you send (V4-D301)
 * are drawn alike. One this page loaded is drawn whole, one it found gone is drawn `gone`: a thumbnail drawn again into
 * the one on the page (dom.js `morph`) loads nothing again, so it draws as that one stands. `set`: the pictures it is one
 * of, which the viewer steps through from it.
 * @param {string} src @param {string} alt @param {(img: HTMLElement) => void} onGone @param {PictureSet | null} [set]
 */
export function pictureThumb(src, alt, onGone, set = null) {
  const open = (/** @type {Event} */ e) => {
    e.preventDefault();
    e.stopPropagation();
    showPicture(src, alt, /** @type {HTMLElement} */ (e.target), set);
  };
  const img = h("img", {
    class: `tool-shot${lost.has(src) ? " gone" : loaded.has(src) ? "" : " loading"}`,
    src,
    alt,
    title: "Open it whole",
    loading: "lazy",
    tabindex: "0",
    role: "button",
    "aria-label": alt ? `Open ${alt} whole` : "Open the picture whole",
    onclick: open,
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    },
    onload: (/** @type {Event} */ e) => {
      keep(loaded, src);
      /** @type {HTMLElement} */ (e.target).classList.remove("loading");
    },
    onerror: (/** @type {Event} */ e) => {
      keep(lost, src);
      /** @type {HTMLElement} */ (e.target).classList.remove("loading");
      onGone(/** @type {HTMLElement} */ (e.target));
    },
  });
  // One the page holds already (the same picture drawn again) is whole at once: no placeholder's shape before it, which
  // made each picture shrink and grow back (the owner's words of 10-18).
  const shown = /** @type {HTMLImageElement} */ (img);
  if (shown.complete && shown.naturalWidth > 0) img.classList.remove("loading");
  return img;
}

/**
 * A picture held in the page (a `data:` address: one you sent, V4-D301) opens in a new tab as a file of its own:
 * Chrome opens no data: address there. The file is let go of a minute later; the tab keeps what it showed.
 * @param {Event} e @param {string} src
 */
function openHeld(e, src) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(src);
  if (!m) return;
  e.preventDefault();
  const raw = atob(m[2]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The pictures a viewer steps through, and where in them it opens: a turn's (its strip), a call's (its card).
 * @typedef {{ list: { src: string, alt: string }[], at: number }} PictureSet
 */

/**
 * Open a picture over the page; one already open gives way. Closed, the keyboard's place goes back to `opener` (the
 * thumbnail it came from) while that is still on the page. One of a `set` steps through the others — ← and →, or its
 * Previous and Next — and says where it stands, "12 / 90" (the owner's of 11-05: a turn's 90 pictures, one by one).
 * @param {string} src @param {string} [alt] @param {HTMLElement | null} [opener] @param {PictureSet | null} [set]
 * @returns {HTMLElement}
 */
export function showPicture(src, alt = "", opener = null, set = null) {
  document.body.querySelector(".picture-view")?.remove();
  // A picture this page found swept is stepped past, as its strip drops it: the one opened stands whatever it is.
  const from = set ? set.list[Math.min(Math.max(0, set.at || 0), set.list.length - 1)] : null;
  const kept = set ? set.list.filter((p) => p === from || !lost.has(p.src)) : [];
  const list = kept.length > 1 ? kept : null;
  let at = list && from ? list.indexOf(from) : 0;
  const close = () => {
    view.remove();
    if (opener?.isConnected) opener.focus?.();
  };
  const stop = (/** @type {Event} */ e) => e.stopPropagation();
  const img = h("img", { src, alt, onclick: stop, onerror: (/** @type {Event} */ e) => keep(lost, String(/** @type {HTMLElement} */ (e.target).getAttribute("src") || "")) });
  const name = h("span", { class: `picture-view-name${alt ? "" : " hidden"}` }, alt);
  const count = list ? h("span", { class: "picture-view-count" }) : null;
  const open = h("a", { class: "picture-view-open", target: "_blank", rel: "noopener" }, "Open in a new tab");
  const step = (/** @type {number} */ by, /** @type {string} */ words) =>
    h("button", { type: "button", class: "picture-view-step", title: `${words} (${by < 0 ? "←" : "→"})`, "aria-label": words, onclick: () => go(at + by) }, by < 0 ? "‹" : "›");
  const prev = list ? step(-1, "Previous") : null;
  const next = list ? step(1, "Next") : null;
  /** The picture `src` drawn, with its name and its place in the set. @param {string} src @param {string} alt */
  const draw = (src, alt) => {
    img.setAttribute("src", src);
    img.setAttribute("alt", alt);
    name.textContent = alt;
    name.classList.toggle("hidden", !alt);
    view.setAttribute("aria-label", alt || "Picture");
    open.setAttribute("href", src);
    open.onclick = src.startsWith("data:") ? (/** @type {Event} */ e) => openHeld(e, src) : null;
    if (!list || !count || !prev || !next) return;
    count.textContent = `${at + 1} / ${list.length}`;
    // The button pressed to the end goes disabled and lets the keyboard go: the viewer takes it back, its keys with it.
    const had = document.activeElement;
    /** @type {HTMLButtonElement} */ (prev).disabled = at === 0;
    /** @type {HTMLButtonElement} */ (next).disabled = at === list.length - 1;
    if ((had === prev && at === 0) || (had === next && at === list.length - 1)) view.focus?.();
  };
  /** @param {number} i */
  const go = (i) => {
    if (!list || i < 0 || i >= list.length) return;
    at = i;
    draw(list[i].src, list[i].alt);
  };
  /** @type {HTMLElement} */
  const view = h(
    "div",
    {
      class: "picture-view",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": alt || "Picture",
      tabindex: "-1",
      onclick: close,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        const by = e.key === "Escape" ? 0 : list && e.key === "ArrowLeft" ? -1 : list && e.key === "ArrowRight" ? 1 : null;
        if (by == null) return;
        e.preventDefault();
        if (by) go(at + by);
        else close();
      },
    },
    img,
    h("div", { class: "picture-view-bar", onclick: stop },
      prev, count, next, name, open,
      h("button", { type: "button", class: "picture-view-close", title: "Close (Esc)", "aria-label": "Close", onclick: close }, "Close")),
  );
  draw(src, alt);
  document.body.append(view);
  view.focus?.();
  return view;
}
