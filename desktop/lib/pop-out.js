// @ts-check
// Pop out (HarnessV4_BrowserSize_Plan BS4): a pane of the harness in a window of its own — the harness page itself,
// showing that one pane (`?pane=`), so every pane keeps all it reads in the main window. One window per tab; its place
// kept in windows.json, a tool pane's under its own name and every file's, artifact's or thread's under one, so the
// file does not grow a name per file (BS-D7: kept, never opened again by itself at the app's start). Plain Node
// (NA-D13).

/** A popped window's first size, before it has a place of its own. */
export const POP_SIZE = Object.freeze({ width: 1100, height: 760 });
/** The longest tab id a window is opened for (a file's tab names its folder and path). */
export const POP_TAB_MAX = 2000;
/** The longest chat route it opens at. */
const ROUTE_MAX = 400;

/**
 * A tab id as the harness sent it, or null where it is none: a string, not empty, not too long, no control character.
 * @param {unknown} v @returns {string | null}
 */
export function popTab(v) {
  const s = typeof v === "string" ? v : "";
  // eslint-disable-next-line no-control-regex
  return s && s.length <= POP_TAB_MAX && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
}

/**
 * Where windows.json keeps a popped window's place: a tool pane's own (`pop:browser`), every item's one (`pop:item`).
 * @param {string} tab
 */
export const popPlaceName = (tab) => (/^[a-z][a-z-]{0,39}$/.test(tab) ? `pop:${tab}` : "pop:item");

/**
 * The chat route a popped window opens at: one of the harness's own hash routes, else none (it opens at the harness's
 * start, a new chat).
 * @param {unknown} route @returns {string}
 */
export const popRoute = (route) => (typeof route === "string" && route.length <= ROUTE_MAX && /^#\/[\w\-./%:~]*$/.test(route) ? route : "");

/**
 * A popped window's address: the harness page, the tab it shows alone, the chat it opens at.
 * @param {string} origin  Filament's @param {string} tab @param {unknown} route
 */
export const popUrl = (origin, tab, route) => `${origin}/ui/harness.html?pane=${encodeURIComponent(tab)}${popRoute(route)}`;
