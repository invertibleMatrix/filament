// @ts-check
// The shelf (the Space Apps plan of 10-29, "Runtime and offline"): browser libraries every artifact's address serves at
// `/_filament/lib/`, from `src/ui/harness/vendor/shelf/` (vendored, as the harness's own libraries are) as `scripts/vendor-shelf.mjs` built it, so an app's page loads them with no
// network. What it holds is its `shelf.json`: each library with its version, its ES module, its classic script and
// global where it has one, and the words the artifact guide names it by; and every file under it, the only paths served.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OWN_PREFIX } from "../core/artifacts.js";

/** Where the shelf sits on every artifact's address. */
export const SHELF_AT = `/${OWN_PREFIX}/lib/`;
/** Where its files sit in the checkout. */
export const SHELF_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "harness", "vendor", "shelf");

/**
 * @typedef {{ name: string, version: string, with?: string, license: string, module: string, script?: string, global?: string, addons?: string[], words: string }} ShelfLibrary
 */

/** What the shelf holds, read once. @type {{ libraries: ShelfLibrary[], files: string[] } | null} */
let held = null;
/** @returns {{ libraries: readonly ShelfLibrary[], files: readonly string[] }} */
export function shelf() {
  if (!held) {
    try {
      const said = JSON.parse(readFileSync(join(SHELF_DIR, "shelf.json"), "utf8"));
      held = { libraries: Array.isArray(said?.libraries) ? said.libraries : [], files: Array.isArray(said?.files) ? said.files : [] };
    } catch {
      held = { libraries: [], files: [] };
    }
  }
  return held;
}

/** A shelf file by its path under `SHELF_AT`, or null for any path the shelf does not list. @param {string} path */
export const shelfPath = (path) => (shelf().files.includes(path) ? join(SHELF_DIR, ...path.split("/")) : null);

/** The shelf as the artifact guide says it: one line a library, with where its module and script are. */
export function shelfLines() {
  return shelf().libraries.map((l) => {
    const script = l.script ? `; a classic script setting ${l.global}: ${SHELF_AT}${l.script}` : "";
    const addons = l.addons?.length ? `; ${l.addons.map((a) => `${SHELF_AT}${a}`).join(", ")}` : "";
    return `- ${l.name} ${l.version}${l.with ? ` with ${l.with}` : ""} — ${l.words}: \`import … from "${SHELF_AT}${l.module}"\`${addons}${script}`;
  });
}
