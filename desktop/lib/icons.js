// @ts-check
// The app's icons per system (the owner's of 11-07: macOS and Linux beside Windows), from its tray/ folder: Windows
// takes its .ico on its windows, and in its tray an .ico of its own — the ∫ stroke alone, bolder and brighter, drawn at
// each size a screen's scale asks for (the owner's of 11-10: the logo's .ico held to 16 px looked faint and pixelated
// at 200%), which Electron reads from the file at the size Windows asks, so the image is never resized here; macOS's
// menu bar a template — the logo's ∫ in black on clear, which macOS tints for a light or dark bar, its @2x beside it
// for Retina (Electron reads both by the name's Template and @2x) — and its windows wear the app's own icon, so none
// is named; Linux a small colour logo in its tray and a larger one on its windows. Made from the owner's icon.png by
// scripts/make-icons.py. Plain Node (NA-D13).
import { join } from "node:path";

/**
 * The tray's icon and the windows' for a system: paths under the app's folder; `window` none where the system takes
 * the app's own.
 * @param {string} root  the app's folder @param {string} [platform]
 * @returns {{ tray: string, window?: string }}
 */
export function iconsOf(root, platform = process.platform) {
  if (platform === "win32") return { tray: join(root, "tray", "filament-tray.ico"), window: join(root, "tray", "filament.ico") };
  if (platform === "darwin") return { tray: join(root, "tray", "filament-trayTemplate.png") };
  return { tray: join(root, "tray", "filament-tray.png"), window: join(root, "tray", "filament-window.png") };
}
