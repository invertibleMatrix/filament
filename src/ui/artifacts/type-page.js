// @ts-check
// What Filament's own pages for its types share (HarnessV4_Artifacts_Plan E18 steps 6 and 7, AF-D11): a Doc, a deck, a
// Dashboard and a Design. They run on the artifact's own address — framed by the harness, or alone in a browser — after
// Filament's look and small script, and draw the agent's content, which Filament wrote into the page as data
// (`#filament-content`), never as HTML (AFC-109). Inside the harness a page tells it things and hears it — a draft of
// the text being edited beside it (AFC-115), whether its frame fills the screen (AFC-112) — and follows its theme.
// Nothing here runs as the module loads: the page's own module calls it.

/** @typedef {Record<string, any> & { type: string, title: string }} Content  the type, the title and what it draws */

/** Whether the harness frames the page: its theme, its drafts and the full screen come from there. */
export const framed = () => window.parent !== window;

/** Whether the page is a card's still preview on the Artifacts page (AFC-113): nothing in it moves or takes a key. */
export const still = () => document.documentElement.hasAttribute("data-still");

/** What Filament wrote into the page: its type and title, and what it draws (a Doc's Markdown, a Dashboard's content…). @returns {Content} */
export function pageContent() {
  const el = document.getElementById("filament-content");
  try {
    const c = JSON.parse(el?.textContent || "{}");
    return { ...c, type: String(c.type || ""), title: String(c.title || document.title) };
  } catch {
    return { type: "", title: document.title };
  }
}

/** Tell the harness something, as Filament's small script does; only where it frames the page. @param {Record<string, unknown>} m */
export function tell(m) {
  if (!framed()) return;
  try {
    parent.postMessage({ ...m, filament: "artifact" }, "*");
  } catch {
    // A harness that is gone hears nothing.
  }
}

/**
 * Hear the harness: a draft of the text being edited (`draft`: `{ markdown, at }`, AFC-115), or whether its frame
 * fills the screen (`fullscreen`: `{ on }`, AFC-112). Only the frame's own parent is heard. Listening for drafts, the
 * page says it is ready for one: a draft sent while it loaded found no one listening, and is sent again.
 * @param {"draft" | "fullscreen"} kind @param {(m: any) => void} fn
 */
export function hear(kind, fn) {
  if (!framed()) return;
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source === parent && m && m.filament === kind) fn(m);
  });
  if (kind === "draft") tell({ kind: "ready" });
}

/** Whether the page is dark now, as Filament's small script marks it. */
export const darkNow = () => document.documentElement.getAttribute("data-theme") === "dark";
/** Follow each change of the page's theme: a diagram or a chart draws again in the other (AFC-110). @param {() => void} fn */
export function onTheme(fn) {
  let was = darkNow();
  new MutationObserver(() => {
    if (darkNow() === was) return;
    was = darkNow();
    fn();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/**
 * The page fills the screen, or leaves it (AFC-112, AFC-114): inside the harness by asking it, as only Filament's own
 * pages may; alone in a browser, by the browser's. `changed` hears each change, wherever it came from.
 * @param {(on: boolean) => void} changed
 */
export function fullScreen(changed) {
  let full = false;
  /** @param {boolean} on */
  const filled = (on) => {
    full = on;
    changed(on);
  };
  document.addEventListener("fullscreenchange", () => filled(!!document.fullscreenElement));
  hear("fullscreen", (m) => filled(!!m.on));
  return {
    on: () => full,
    /** @param {boolean} on */
    set(on) {
      if (framed()) return tell({ kind: "fullscreen", on });
      if (on) void document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) void document.exitFullscreen();
    },
  };
}

/** A small mark of the page's own, by its paths (24 by 24, drawn with the text's color). @param {string} paths */
export const mark = (paths) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/** The marks of filling the screen and leaving it. */
export const FILL_MARK = mark('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>');
export const LEAVE_MARK = mark('<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>');

/** An element of the page's own. @param {string} tag @param {string} [cls] @param {string} [text] */
export function part(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
