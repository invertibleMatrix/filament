// @ts-check
// The desktop app's own title bar (the owner's of 10-28, after Claude's and Codex's desktop apps). Where the window
// draws its controls over the page — Windows' and Linux's minimize, maximize and close at the right end, a Mac's at the
// left (html.app-frame-left); Electron's title bar overlay, which the page reads as the Window Controls Overlay — the
// page's top row is the window's title bar: html.app-frame says so to the CSS, which lays the row out and marks what
// drags the window (harness.css, "the desktop app's own title bar"), and the window is told the row's colours as the
// page opens and whenever its theme changes, for its controls to wear them (desktop/lib/frame.js). In a browser
// nothing here applies.

/** Whether the window's own controls stand over this page. @param {any} [nav] */
export function appFrame(nav = globalThis.navigator) {
  return nav?.windowControlsOverlay?.visible === true;
}

/** Three channels, 0–255, as #rrggbb. @param {number[]} ch */
const hex = (ch) => `#${ch.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/**
 * A computed colour as #rrggbb: rgb() and rgba(), #rgb and #rrggbb read here, any other the page's own canvas reads
 * (`doc`). A see-through one is read as the eye sees it over `over`, the ground it lies on — the sidebar's buttons are
 * inked oklab(0.87 0 0 / 0.6) — and is none without a ground; so is one unread.
 * @param {string} css @param {any} [doc] @param {string} [over]  an opaque ground
 * @returns {string | null}
 */
export function hexOf(css, doc, over) {
  const s = String(css || "").trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(s);
  if (short) return `#${[...short[1]].map((c) => c + c).join("")}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const ground = over ? hexOf(over) : null;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (rgb) {
    const ch = rgb.slice(1, 4).map(Number);
    const a = rgb[4] == null ? 1 : rgb[5] ? Number(rgb[4]) / 100 : Number(rgb[4]);
    if (a >= 1) return hex(ch);
    if (!ground) return null;
    const g = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
    return hex(ch.map((v, i) => v * a + g[i] * (1 - a)));
  }
  // color(srgb …), oklab(…) and the rest: one pixel painted with the ground, then with it, read back.
  try {
    const c = doc?.createElement?.("canvas");
    const g = c?.getContext?.("2d", { willReadFrequently: true });
    if (!g) return null;
    c.width = c.height = 1;
    g.clearRect?.(0, 0, 1, 1);
    // One the canvas cannot paint leaves its fill as it was: none, never the ground read back.
    g.fillStyle = "#010203";
    g.fillStyle = s;
    if (g.fillStyle === "#010203") return null;
    if (ground) {
      g.fillStyle = ground;
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = s;
    }
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
    return a < 255 ? null : hex([r, gr, b]);
  } catch {
    return null;
  }
}

/**
 * The chrome's colours, kept: `--app-chrome` set and `say` told the colours `colors` reads — as the page opens
 * (`paint`), and again whenever they change once `watch` is called (a theme's classes or attributes on html, the
 * system's light and dark, the page's load).
 * @param {{ colors: () => { color: string, symbolColor: string }, win: any, doc: any, say: (c: { color: string, symbolColor: string }) => void }} o
 */
function chromeOf({ colors, win, doc, say }) {
  const html = doc.documentElement;
  let said = "";
  let watching = false;
  const paint = () => {
    const c = colors();
    const color = hexOf(c.color, doc),
      symbolColor = color ? hexOf(c.symbolColor, doc, color) : null;
    if (!color || !symbolColor || `${color} ${symbolColor}` === said) return;
    said = `${color} ${symbolColor}`;
    html.style.setProperty("--app-chrome", color);
    say({ color, symbolColor });
  };
  const watch = () => {
    if (watching) return;
    watching = true;
    // The theme's stylesheets may still be loading as the shell is drawn: once more when the page has loaded.
    win.addEventListener?.("load", paint);
    new win.MutationObserver(paint).observe(html, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    win.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", paint);
  };
  return { paint, watch };
}

/**
 * The page as the window's title bar, where the window's controls stand over it: html.app-frame on, the chrome's colour
 * (`--app-chrome`) set, and the window told the colours `colors` reads — as the page opens, and again whenever they
 * change (a theme's classes or attributes on html, the system's light and dark). Leaving full screen and coming back
 * (the controls hidden and shown) turns html.app-frame off and on. A page built while they stood over nothing — loaded
 * again in a minimized window, as Filament restarted under it — is the title bar from the moment they show: `onShown`,
 * each time they do, for the shell to give the header the bar's place. The room they take, told the app as they move:
 * it lends it to the other machines' pages in the window, which cannot read it (`startLentFrame`). False where no
 * controls stand over the page yet.
 * @param {{ colors: () => { color: string, symbolColor: string }, win?: any, doc?: any, onShown?: () => void }} o
 * @returns {boolean}
 */
export function startAppFrame({ colors, win = globalThis.window, doc = globalThis.document, onShown }) {
  const wco = win?.navigator?.windowControlsOverlay;
  if (!wco) return false;
  const html = doc.documentElement;
  const chrome = chromeOf({ colors, win, doc, say: (c) => win.filamentApp?.titleBar?.(c) });
  const follow = () => {
    const on = appFrame(win.navigator);
    const rect = on ? wco.getTitlebarAreaRect?.() : null;
    html.classList.toggle("app-frame", on);
    // A Mac's buttons stand at the row's left end, where its title bar area starts after them (harness.css).
    html.classList.toggle("app-frame-left", on && Number(rect?.x) > 0);
    if (!on) return;
    if (rect && Number(rect.width) > 0) win.filamentApp?.frameArea?.({ left: Number(rect.x) || 0, right: Math.max(0, (Number(win.innerWidth) || 0) - (Number(rect.x) || 0) - Number(rect.width)) });
    chrome.paint();
    chrome.watch();
    onShown?.();
  };
  wco.addEventListener?.("geometrychange", follow);
  follow();
  return appFrame(win.navigator);
}

/**
 * Another machine's page in the desktop app's window (the owner's of 11-08: the machine switcher in the rail's place):
 * the window's controls stand over it too, but no Window Controls Overlay reaches a view of the window's own, so the
 * app lends it the room they take (its `filamentMachines`, desktop/lib/rail.js `lentFrame`): html.app-frame on, a Mac's
 * buttons' room at the left (html.app-frame-left, `--wco-l`) or Windows' at the right (`--wco-r`), the chrome's colours
 * told the app for the controls to wear while it shows, and `onShown` as with the window's own. None lent — full
 * screen — and the page is no title bar while it lasts. Where the window's own overlay reaches the page all the same
 * (Windows' does, the drive of 11-08), its room is read there (`startAppFrame`) and nothing is lent over it — but its
 * colours are still told through this bridge: such a page has no `filamentApp`. Nothing where no bridge is (a browser)
 * or it is This computer's (no `titleBar`). False where none can be lent.
 * @param {{ colors: () => { color: string, symbolColor: string }, bridge?: any, win?: any, doc?: any, onShown?: () => void }} o
 * @returns {boolean}
 */
export function startLentFrame({ colors, bridge = /** @type {any} */ (globalThis.window)?.filamentMachines, win = globalThis.window, doc = globalThis.document, onShown }) {
  if (!bridge || typeof bridge.onState !== "function" || typeof bridge.titleBar !== "function") return false;
  const html = doc.documentElement;
  const chrome = chromeOf({ colors, win, doc, say: (c) => bridge.titleBar(c) });
  bridge.onState((/** @type {any} */ s) => {
    if (appFrame(win?.navigator)) {
      chrome.paint();
      chrome.watch();
      return;
    }
    const f = s?.frame;
    const on = !!f && typeof f === "object";
    const px = (/** @type {any} */ v) => `${Math.max(0, Number(v) || 0)}px`;
    html.classList.toggle("app-frame", on);
    html.classList.toggle("app-frame-left", on && Number(f.left) > 0);
    html.style.setProperty("--wco-l", on ? px(f.left) : "");
    html.style.setProperty("--wco-r", on ? px(f.right) : "");
    if (!on) return;
    chrome.paint();
    chrome.watch();
    onShown?.();
  });
  return true;
}
