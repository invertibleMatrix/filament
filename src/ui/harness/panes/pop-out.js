// @ts-check
// Pop out (HarnessV4_BrowserSize_Plan BS4), the page's half: a tile's pane in a window of its own — the harness page
// itself, showing that one tab (`?pane=`), so the pane keeps all it reads in the main window — and the main window's
// word of which tabs are out: it draws "In its own window" in their place (BS-D8). A popped window keeps its own chat;
// its Follow the main window has it show the chat the main window shows, heard over a channel between the windows
// (proposal_ux question 5). The desktop app's alone: a browser's tab has no windows of the app's to pop into.

/**
 * The tab a popped window shows alone, read from its address, or "" in the harness's own window.
 * @param {string} [search]  the page's `location.search`
 */
export function popTabOf(search = String(/** @type {any} */ (globalThis).location?.search || "")) {
  try {
    return new URLSearchParams(search).get("pane") || "";
  } catch {
    return "";
  }
}

/**
 * The app's Pop out bridge (harness-preload.cjs), or null outside the desktop app.
 * @param {any} [w]
 * @returns {{ popOut: (tab: string, route: string) => Promise<boolean>, bringBack: (tab: string) => void,
 *   popped?: () => Promise<string[]>, onPopped?: (fn: (tabs: string[]) => void) => () => void } | null}
 */
export function popBridgeOf(w = /** @type {any} */ (globalThis).window) {
  const b = w?.filamentPanes;
  return b && typeof b.popOut === "function" && typeof b.bringBack === "function" ? b : null;
}

/**
 * The tabs out, as the app says them — asked once, then heard as they change — and the acts on them: `out`, a tab in
 * a window of its own at a chat's route (or, out already, its window shown); `back`, its window closed.
 * @param {NonNullable<ReturnType<typeof popBridgeOf>>} bridge @param {() => void} onChange  the tabs out moved
 */
export function createPopped(bridge, onChange) {
  /** @type {Set<string>} */
  let out = new Set();
  /** @param {unknown} tabs */
  const heard = (tabs) => {
    if (!Array.isArray(tabs)) return;
    const next = new Set(tabs.map(String));
    if (next.size === out.size && [...next].every((t) => out.has(t))) return;
    out = next;
    onChange();
  };
  void Promise.resolve(bridge.popped?.()).then(heard, () => {});
  const unhear = bridge.onPopped?.(heard) || null;
  return {
    /** @param {string} id */
    has: (id) => out.has(id),
    /** @param {string} id @param {string} route */
    out: (id, route) => void Promise.resolve(bridge.popOut(id, route)).catch(() => {}),
    /** @param {string} id */
    back: (id) => bridge.bringBack(id),
    stop: () => unhear?.(),
  };
}

/** The channel between the harness's windows: the main one says its chat on it; a popped one asks it, and hands it a tab to open. */
export const MAIN_LINE = "filament-harness-main";

/**
 * The line between the harness's windows: what one posts, the others hear. A page with no BroadcastChannel has none.
 * @param {any} [Channel]
 * @returns {{ post: (m: any) => void, on: (fn: (m: any) => void) => () => void }}
 */
export function mainLine(Channel = /** @type {any} */ (globalThis).BroadcastChannel) {
  if (typeof Channel !== "function") return { post: () => {}, on: () => () => {} };
  const ch = new Channel(MAIN_LINE);
  return {
    post: (m) => {
      try {
        ch.postMessage(m);
      } catch {}
    },
    on: (fn) => {
      const heard = (/** @type {any} */ e) => fn(e?.data);
      ch.addEventListener("message", heard);
      return () => ch.removeEventListener("message", heard);
    },
  };
}

/** A route of the main window's a popped window follows: a chat's, or a new chat's. @param {unknown} route */
export const followable = (route) => typeof route === "string" && /^#\/(task\/[^\s/]+(\/[a-z]+)?)?$/.test(route);

/** Follow the main window: the popped window's own, off unless turned on (proposal_ux question 5), kept through its reload. */
const FOLLOW_KEY = "filament.pop.follow";
/** @param {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void } | null} [store] */
export function followSwitch(store = /** @type {any} */ (globalThis).sessionStorage || null) {
  let on = false;
  try {
    on = store?.getItem(FOLLOW_KEY) === "1";
  } catch {}
  return {
    get: () => on,
    /** @param {boolean} v */
    set: (v) => {
      on = !!v;
      try {
        store?.setItem(FOLLOW_KEY, on ? "1" : "0");
      } catch {}
    },
  };
}
