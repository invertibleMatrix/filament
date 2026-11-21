// @ts-check
// Project identity: one folder, one id, wherever the folder is first seen. Live traffic (the brain's `projectOf`), the
// importers and the archive's own `chainForKey` all derive it here — two rules for the same folder is how the archive
// grew two `filament` projects (sha1 of the raw path beside sha256 of the normalised one, 2026-09-22, HarnessV2 §2 F1).
// The id is the first 12 hex characters of the SHA-256 of the normalised path: back-slashes forward, no trailing slash,
// lower-cased (Windows paths are case-insensitive, and the same folder arrives spelled both ways).
import { shortHash } from "./hash.js";

export const NO_PROJECT_ID = "none";

/**
 * The path as the id sees it. Empty in → empty out.
 * @param {unknown} cwd
 */
export function normalizeCwd(cwd) {
  const s = String(cwd ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return s.toLowerCase();
}

/**
 * The folder's project id, or "none" for no folder.
 * @param {unknown} cwd
 */
export function projectIdOf(cwd) {
  const norm = normalizeCwd(cwd);
  return norm ? shortHash(norm, 12) : NO_PROJECT_ID;
}

/**
 * The folder's display name: its last segment, in the spelling the caller gave. Empty for no folder.
 * @param {unknown} cwd
 */
export function projectNameOf(cwd) {
  const s = String(cwd ?? "")
    .trim()
    .replace(/[\\/]+$/, "");
  if (!s) return "";
  return s.split(/[\\/]/).filter(Boolean).pop() || s;
}
