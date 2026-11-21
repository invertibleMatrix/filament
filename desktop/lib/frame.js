// @ts-check
// The window's frame (the owner's of 10-28, after Claude's and Codex's desktop apps; on every system the owner's of
// 11-08): the system's title bar goes, and Filament's own top row is the title bar — its empty parts drag the window.
// Windows draws its minimize, maximize and close over that row's right end (Electron's title bar overlay: the snap
// layouts on maximize, the red close, a double-click that maximizes, the window's menu on a right-click, all as the
// system has them), and Linux Electron's own, both in the colours the page tells it (harness-preload.cjs
// `filamentApp.titleBar`). A Mac's close, minimize and zoom stand at the row's left end, centred in it, in the system's
// own colours; the page leaves them their room (html.app-frame-left, src/ui/harness/lib/app-frame.js).

/** The harness's top row, as harness.css's --bar-h has it. */
export const BAR_H = 48;
/** A popped pane's top row: its tile's head (panes.css .tile-head). */
export const PANE_BAR_H = 38;
/** The chrome's colours until the page says its own: the sidebar's and its buttons', dark and light (aqua.css). */
const CHROME = { dark: { color: "#1e1e21", symbolColor: "#a1a1aa" }, light: { color: "#e6e6eb", symbolColor: "#52525b" } };

/** How tall macOS draws its window buttons' frame: centred in the row by it. */
const LIGHTS_H = 16;
/** Where a Mac's buttons start from the row's left end. */
const LIGHTS_X = 16;

/**
 * A harness window's frame, for its BrowserWindow options: none of the system's, Filament drawing its own.
 * @param {{ platform?: string, dark?: boolean, pane?: boolean }} [o]  `pane`: a popped pane's window
 * @returns {{ titleBarStyle: "hidden", titleBarOverlay: { color: string, symbolColor: string, height: number }, trafficLightPosition?: { x: number, y: number } }}
 */
export function frameOf({ platform = process.platform, dark = true, pane = false } = {}) {
  const height = pane ? PANE_BAR_H : BAR_H;
  const frame = /** @type {const} */ ({ titleBarStyle: "hidden", titleBarOverlay: { ...CHROME[dark ? "dark" : "light"], height } });
  return platform === "darwin" ? { ...frame, trafficLightPosition: { x: LIGHTS_X, y: Math.round((height - LIGHTS_H) / 2) } } : frame;
}

/**
 * The colours a page asks the window's controls to wear, as Electron takes them — two #rrggbb — or null for anything
 * else: what a page sends is never handed on unread.
 * @param {any} c
 * @returns {{ color: string, symbolColor: string } | null}
 */
export function overlayColors(c) {
  const hex = (/** @type {any} */ v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  const color = hex(c?.color),
    symbolColor = hex(c?.symbolColor);
  return color && symbolColor ? { color, symbolColor } : null;
}
