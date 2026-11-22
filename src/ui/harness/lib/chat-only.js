// @ts-check
// The chat alone (the remote desk of 11-22): another machine's desktop app shows a chat of this Filament's in its own
// window's main area, beside its own left bar, and asks this page for it with `?only=chat`. The page then is that chat
// and its box, its header and its panes — no sidebar, no collapsed rail, no full-frame screen (Settings, the Library, a
// Space, the artifacts): a screen asked for there goes to the app's whole page of this machine where the app can open
// one (`filamentMachines.full`), else a toast says where, and the chat stays. `?theme=` says the desk's look, which the
// page wears without keeping it: this machine's own pages keep theirs.

/** Whether the page shows one chat alone, as another machine's desk asks. @param {string} [search]  the page's `location.search` */
export function chatOnlyOf(search = String(/** @type {any} */ (globalThis).location?.search || "")) {
  try {
    const p = new URLSearchParams(search);
    // A popped pane's window is its own thing: the two never stand together.
    return p.get("only") === "chat" && !p.get("pane");
  } catch {
    return false;
  }
}

/** The look the desk asks the page to wear, light or dark, else none. @param {string} [search] @returns {"light" | "dark" | null} */
export function themeHintOf(search = String(/** @type {any} */ (globalThis).location?.search || "")) {
  try {
    const v = new URLSearchParams(search).get("theme");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The app's way to this machine's whole page at a route, where another machine's desk shows this page (its machine
 * view's preload), else null: the page then goes back to its chat.
 * @param {any} [w] @returns {((route: string) => void) | null}
 */
export function fullPageOf(w = globalThis) {
  const full = w?.filamentMachines?.full;
  return typeof full === "function" ? (route) => void full(String(route)) : null;
}
