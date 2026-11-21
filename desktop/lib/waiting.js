// @ts-check
// A window the app opens while its Filament gives no page yet (the owner's of 10-31: after an install, "it takes quite a
// lot of time to show up on full screen but the tray icon shows up way before that and in the mean time users will be
// confused nothing happened"): it shows at once, where it stood, with the app's own page in it — Filament is starting, or
// what holds it —, and Filament's page comes into it at Filament's first answer. Plain Node (NA-D13); main.js opens the
// window and loads the page.
import { downWords, esc, markTile } from "./card.js";

/** The states Filament is on its way through: a start that has not answered, a restart, a stop. */
const UNDER_WAY = Object.freeze(["starting", "late", "restarting", "stopping"]);

/** Whether Filament is on its way in `state` (the supervisor's): the page spins. @param {string} state */
export const underWay = (state) => UNDER_WAY.includes(state);

/**
 * What the window says while Filament gives no page, by the app's state: as the card says it, but that Filament opens
 * here.
 * @param {string} state @param {number} port
 * @returns {{ title: string, line: string }}
 */
export function waitWords(state, port) {
  if (state === "starting") return { title: "Filament is starting", line: "It opens here as soon as it is ready." };
  return downWords(state, port);
}

/**
 * The window's page while Filament gives none: Filament's mark, what holds it, and a spinner while it is on its way, in
 * the window's own colours — a `data:` address, as it needs nothing of Filament's, and nothing runs in it. `bar`: the
 * window's top row where Windows draws its controls over the page (lib/frame.js), in the colour they wear; it drags the
 * window as Filament's own top row does. `version`: the app's, under it all.
 * @param {{ title: string, line: string }} words
 * @param {{ dark: boolean, busy: boolean, bar?: { height: number, color: string } | null, version?: string }} o
 */
export function waitPage(words, { dark, busy, bar = null, version = "" }) {
  const c = dark
    ? { bg: "#1e1e1e", text: "rgba(255,255,255,0.93)", quiet: "rgba(235,235,245,0.6)", track: "rgba(255,255,255,0.14)" }
    : { bg: "#ffffff", text: "rgba(0,0,0,0.88)", quiet: "rgba(60,60,67,0.66)", track: "rgba(0,0,0,0.1)" };
  const top = bar ? Math.max(0, Math.round(bar.height)) : 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Filament</title><style>
html,body{margin:0;height:100%;background:${c.bg};color:${c.text};font:13px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none;cursor:default}
.bar{height:${top}px;background:${bar ? bar.color : c.bg};-webkit-app-region:drag}
.main{box-sizing:border-box;height:calc(100% - ${top}px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 24px 64px}
.tile{background:linear-gradient(180deg,#38bdf8,#0284c7);display:grid;place-items:center;margin-bottom:6px}
.title{font-size:17px;font-weight:650}.line{max-width:440px;text-align:center;color:${c.quiet}}
.spin{width:20px;height:20px;margin-top:10px;box-sizing:border-box;border-radius:50%;border:2px solid ${c.track};border-top-color:#38bdf8;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
.version{position:fixed;left:0;right:0;bottom:16px;text-align:center;font-size:11.5px;color:${c.quiet}}
</style></head><body><div class="bar"></div><div class="main" role="status" aria-live="polite">${markTile(44)}<div class="title">${esc(words.title)}</div><div class="line">${esc(words.line)}</div>${busy ? '<div class="spin" aria-hidden="true"></div>' : ""}</div>${version ? `<div class="version">Filament ${esc(version)}</div>` : ""}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
