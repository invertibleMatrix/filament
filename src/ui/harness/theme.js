// @ts-check
// Browser-only look: Zai Dark / Zai Light / System, the UI font size and the code font size — the
// appearance prefs (filament.harness.theme / uiFontSize / codeFontSize, through prefs.js). Ctrl+Shift+L
// cycles the theme; Ctrl+= / Ctrl+- / Ctrl+0 step or reset the UI font size.
import { prefs } from "./prefs.js";
import { matchShortcut } from "./shortcuts.js";
import { repaintFences } from "./lib/highlighter.js";

const THEMES = ["system", "light", "dark"];
const MOTIONS = ["full", "reduced", "off"];
const MIN_FONT = 12;
const MAX_FONT = 20;
/** The sidebar's font-size menu steps (the sidebar builds its radio items from this list). */
const FONTS = [12, 13, 14, 15, 16, 17, 18, 19, 20];

/** A size inside the 12–20 fence. @param {number} n */
const fenced = (n) => Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(Number(n) || 14)));

/** The theme chosen, else the system's (the owner's of 11-09). @returns {"system"|"light"|"dark"} */
export function themePref() {
  const v = String(prefs.get("theme") || "system");
  return THEMES.includes(v) ? /** @type {"system"|"light"|"dark"} */ (v) : "system";
}

/** @param {"system"|"light"|"dark"} v */
export function setThemePref(v) {
  prefs.set("theme", v);
  applyTheme();
}

export function uiFontSize() {
  return fenced(Number(prefs.get("uiFontSize")) || 14);
}

/** @param {number} n */
export function setUiFontSize(n) {
  prefs.set("uiFontSize", fenced(n));
  applyTheme();
}

export function codeFontSize() {
  return fenced(Number(prefs.get("codeFontSize")) || 14);
}

/** @param {number} n */
export function setCodeFontSize(n) {
  prefs.set("codeFontSize", fenced(n));
  applyTheme();
}

/** Interface motion: Full (every slide and fade), Reduced (short, no travel), Off (none). A system
 * reduced-motion preference starts it at Reduced until the developer chooses. @returns {"full"|"reduced"|"off"} */
export function motionPref() {
  const v = String(prefs.get("motion") || "");
  if (MOTIONS.includes(v)) return /** @type {"full"|"reduced"|"off"} */ (v);
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

/** @param {"full"|"reduced"|"off"} v */
export function setMotionPref(v) {
  prefs.set("motion", MOTIONS.includes(v) ? v : "full");
  applyTheme();
}

export function applyTheme() {
  const pref = themePref();
  const dark = pref === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : pref === "dark";
  const html = document.documentElement;
  html.classList.toggle("theme-zai-dark", dark);
  html.classList.toggle("theme-zai-light", !dark);
  html.style.setProperty("--ui-font-size", `${uiFontSize()}px`);
  html.style.setProperty("--code-font-size", `${codeFontSize()}px`);
  html.dataset.motion = motionPref();
}

export function watchTheme() {
  applyTheme();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (themePref() !== "system") return;
    applyTheme();
    // The fences coloured for the theme before restyle with it, as a switch in Settings does (the bug round of 10-23).
    repaintFences();
  });
  window.addEventListener("keydown", (e) => {
    const id = matchShortcut(e);
    if (id === "theme") {
      e.preventDefault();
      const i = THEMES.indexOf(themePref());
      setThemePref(/** @type {"system"|"light"|"dark"} */ (THEMES[(i + 1) % THEMES.length]));
    } else if (id === "zoom-in") {
      e.preventDefault();
      setUiFontSize(uiFontSize() + 1);
    } else if (id === "zoom-out") {
      e.preventDefault();
      setUiFontSize(uiFontSize() - 1);
    } else if (id === "zoom-reset") {
      e.preventDefault();
      setUiFontSize(14);
    }
  });
}

export { THEMES, MOTIONS, FONTS, MIN_FONT, MAX_FONT, fenced as clampFontSize };
