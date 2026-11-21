// @ts-check
// Header maps as Filament reads them: lower-cased names, multi-valued headers joined — one shape for every lookup.

/**
 * The mark on every answer of Filament's own server but its model endpoints', "1": an app's fetch knows another
 * Filament on this computer by it, at whatever port it listens on, and reads none of it (adapters/tools/source-fetch.js).
 */
export const FILAMENT_MARK = "x-filament";

/**
 * @param {Record<string, string | string[] | undefined>} headers  Node's `req.headers`
 * @returns {Record<string, string>}
 */
export function lowerHeaders(headers) {
  /** @type {Record<string, string>} */
  const h = {};
  for (const [k, v] of Object.entries(headers))
    if (v !== undefined) h[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
  return h;
}
