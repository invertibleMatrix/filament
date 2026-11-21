// @ts-check
// The tray's card (HarnessV3-Native NA-D9, NA3b): where its window stands by the tray, what its page may ask of the app
// (among it, a chat of its Now opened in the harness), and the page the app draws itself while Filament gives none —
// starting, could not start, its port another's. The card itself is Filament's page (`/ui/tray-card.html`). Plain Node
// (NA-D13); main.js opens the window.

/** The card's window, in screen points. */
export const CARD_SIZE = Object.freeze({ width: 420, height: 600 });
/** What the card's page may ask of the app: no other word is heard. */
export const CARD_ACTS = Object.freeze(["harness", "dashboard", "restart", "hide", "open"]);
/** A chat's place in the harness, as a row of the card's Now opens it: `#/task/<chain>` or one of its views, no other. */
const HARNESS_ROUTE = /^#\/task\/[A-Za-z0-9%._~!*'()-]{1,256}(\/(chat|overview|side|team|plan))?$/;
/** The route `open` names, where it is one of the harness's chats; else null. @param {unknown} route */
export const harnessRoute = (route) => (typeof route === "string" && HARNESS_ROUTE.test(route) ? route : null);
/** Between the card and the edge of the screen's work area. */
const GAP = 8;
/** How soon after the card hid as it lost the focus a click on the tray is the click that took it. */
export const BLUR_CLICK_MS = 400;

/**
 * What a click on the tray does to the card: hides it where it shows, else opens it — but one that took the focus from
 * the card, which hid it (a click anywhere else hides the card, the owner's of 11-08; Windows gives the taskbar the
 * focus before the tray hears its click), leaves it hidden. "hide", "open" or "none".
 * @param {{ shown: boolean, blurredAt: number, now: number }} o  `blurredAt`: when it last hid so
 */
export function trayClick({ shown, blurredAt, now }) {
  if (shown) return "hide";
  return now - blurredAt < BLUR_CLICK_MS ? "none" : "open";
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * Where the card stands: by the tray icon, inside the work area of the screen it is on — over the icon where the
 * taskbar is at the foot, under it at the top, beside it at a side; at the work area's corner nearest the foot and the
 * right where the tray gives no place (an empty rectangle).
 * @param {Rect | null | undefined} tray @param {Rect} work @param {{ width: number, height: number }} [size]
 * @returns {Rect}
 */
export function cardPlace(tray, work, size = CARD_SIZE) {
  const width = Math.min(size.width, work.width - 2 * GAP);
  const height = Math.min(size.height, work.height - 2 * GAP);
  const minX = work.x + GAP;
  const maxX = work.x + work.width - width - GAP;
  const minY = work.y + GAP;
  const maxY = work.y + work.height - height - GAP;
  const fence = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.round(Math.max(lo, Math.min(hi, v)));
  if (!tray || !(tray.width > 0 && tray.height > 0)) return { x: maxX, y: maxY, width, height };
  const cx = tray.x + tray.width / 2;
  const cy = tray.y + tray.height / 2;
  // A taskbar at a side: the icon stands outside the work area, left or right of it.
  if (tray.x >= work.x + work.width) return { x: maxX, y: fence(cy - height / 2, minY, maxY), width, height };
  if (tray.x + tray.width <= work.x) return { x: minX, y: fence(cy - height / 2, minY, maxY), width, height };
  const x = fence(cx - width / 2, minX, maxX);
  return { x, y: cy < work.y + work.height / 2 ? minY : maxY, width, height };
}

/**
 * Whether a word from the card's page is one the app hears: one of its acts, from Filament's own page in the card's
 * window — a page that left Filament (none can: the window is pinned to it) or another window is not heard.
 * `open` is heard with a chat's route alone (`harnessRoute`).
 * @param {unknown} act @param {string | undefined} from  the asking frame's address @param {string} origin  Filament's
 * @param {unknown} [route]  `open`'s
 */
export function cardHears(act, from, origin, route) {
  if (typeof act !== "string" || !CARD_ACTS.includes(act)) return false;
  if (act === "open" && !harnessRoute(route)) return false;
  try {
    return new URL(String(from || "")).origin === origin;
  } catch {
    return false;
  }
}

/**
 * What the card says while Filament gives no page of its own, by the app's state.
 * @param {string} state  the supervisor's, or `gone` (the Filament the app attached to does not answer)
 * @param {number} port
 * @returns {{ title: string, line: string }}
 */
export function downWords(state, port) {
  switch (state) {
    case "late":
      return { title: "Filament is still starting", line: "Slower than usual. What it says is in server.log, in the app's folder." };
    case "restarting":
      return { title: "Filament is restarting", line: "Back in a few seconds." };
    case "stopping":
      return { title: "Filament is stopping", line: "It finishes what is in flight first." };
    case "taken":
      return { title: "Filament is not running", line: `Port ${port} is another program's. Choose Restart Filament in the tray once it is free.` };
    case "failed":
      return { title: "Filament could not start", line: "What it said is in server.log. Choose Restart Filament in the tray to try again." };
    case "gone":
      return { title: "Filament does not answer", line: `Nothing answers on port ${port}. If nothing does soon, the app starts Filament itself.` };
    case "stopped":
      return { title: "Filament is not running", line: "Choose Restart Filament in the tray to start it." };
    default:
      return { title: "Filament is starting", line: "The card shows once it answers." };
  }
}

/** @param {string} s */
export const esc = (s) => s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));

/** Filament's mark on its blue tile, as the app's own pages draw it. @param {number} tile  its side, in px */
export const markTile = (tile) =>
  `<span class="tile" style="width:${tile}px;height:${tile}px;border-radius:${Math.round(tile * 0.27)}px"><svg width="${Math.round(tile * 0.6)}" height="${Math.round(tile * 0.6)}" viewBox="0 0 32 32"><path d="M9 16h5m4 0h5M14 10l4 12" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg></span>`;

/**
 * The page the card's window shows while Filament gives none: its head and one sentence, in the card's own look and
 * theme, as a `data:` address (it needs nothing of Filament's). Esc and the tray hide it as they hide the card.
 * @param {{ title: string, line: string }} words @param {boolean} dark
 */
export function downPage(words, dark) {
  const c = dark
    ? { bg: "#1d1d20", text: "rgba(255,255,255,0.93)", quiet: "rgba(235,235,245,0.6)", card: "rgba(255,255,255,0.055)" }
    : { bg: "#fbfbfd", text: "rgba(0,0,0,0.88)", quiet: "rgba(60,60,67,0.66)", card: "rgba(255,255,255,0.72)" };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Filament</title><style>
html,body{margin:0;height:100%;background:${c.bg};color:${c.text};font:13px/1.35 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.card{display:flex;flex-direction:column;gap:14px;padding:16px;-webkit-app-region:drag;height:100%;box-sizing:border-box}
.head{display:flex;align-items:center;gap:11px}
.tile{background:linear-gradient(180deg,#38bdf8,#0284c7);display:grid;place-items:center;flex:none}
.title{font-size:14px;font-weight:650}.sub{font-size:11.5px;color:${c.quiet}}
.box{background:${c.card};border-radius:11px;padding:12px}.box b{display:block;font-weight:600;margin-bottom:3px}.box span{color:${c.quiet}}
</style></head><body><div class="card"><div class="head">${markTile(30)}<div><div class="title">Filament</div><div class="sub">the app's tray card</div></div></div><div class="box" role="status"><b>${esc(words.title)}</b><span>${esc(words.line)}</span></div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
