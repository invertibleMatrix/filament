// @ts-check
// Where each of the desktop app's windows stood, kept in `<dataDir>\desktop\windows.json` (HarnessV3-Native NA-D8):
// opened again there — unless no screen shows it any more (a monitor unplugged), when it opens at its usual size on the
// main screen. Plain Node (NA-D13).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {Rect & { maximized?: boolean }} Placed
 */

/** How much of a window a screen must show for it to open there again. */
const SEEN = { width: 120, height: 60 };

/** @param {unknown} v @returns {v is number} */
const num = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Where a window opens: where it stood, if a screen still shows enough of it; else `size` centred on the first screen
 * (the main one).
 * @param {unknown} saved @param {readonly Rect[]} screens  each screen's work area, the main one first
 * @param {{ width: number, height: number }} size
 * @returns {Placed}
 */
export function placeOf(saved, screens, size) {
  const s = /** @type {any} */ (saved);
  if (s && num(s.x) && num(s.y) && num(s.width) && num(s.height) && s.width >= 200 && s.height >= 150) {
    const shown = screens.some((a) => Math.min(s.x + s.width, a.x + a.width) - Math.max(s.x, a.x) >= SEEN.width && Math.min(s.y + s.height, a.y + a.height) - Math.max(s.y, a.y) >= SEEN.height);
    if (shown) return { x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height), maximized: s.maximized === true };
  }
  const a = screens[0] || { x: 0, y: 0, width: size.width, height: size.height };
  const width = Math.min(size.width, a.width);
  const height = Math.min(size.height, a.height);
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height, maximized: false };
}

/** Every window's place as kept: an empty record where none is, or it does not read. @param {string} file @returns {Record<string, unknown>} */
export function readPlaces(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Keep one window's place, written whole through a temporary file. @param {string} file @param {string} name @param {Placed} place */
export function keepPlace(file, name, place) {
  const all = { ...readPlaces(file), [name]: place };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2));
  renameSync(`${file}.tmp`, file);
}
