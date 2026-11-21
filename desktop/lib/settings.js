// @ts-check
// The desktop app's own choices, kept in `<dataDir>\desktop\settings.json` (HarnessV3-Native NA3): whether it shows
// notifications, and whether the installed app updates itself (lib/updates.js). Filament's config is not the app's to
// write. Plain Node (NA-D13).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {{ notify: boolean, updates: boolean }} Settings
 */

/** As a first start finds them. @type {Readonly<Settings>} */
export const SETTINGS = Object.freeze({ notify: true, updates: true });

/** The app's choices as kept; each one that is missing or does not read is its first-start value. @param {string} file @returns {Settings} */
export function readSettings(file) {
  /** @type {any} */
  let v = null;
  try {
    v = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  const s = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return { notify: typeof s.notify === "boolean" ? s.notify : SETTINGS.notify, updates: typeof s.updates === "boolean" ? s.updates : SETTINGS.updates };
}

/** Keep a choice, written whole through a temporary file. @param {string} file @param {Partial<Settings>} patch @returns {Settings} */
export function keepSettings(file, patch) {
  const all = { ...readSettings(file), ...patch };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2));
  renameSync(`${file}.tmp`, file);
  return all;
}
