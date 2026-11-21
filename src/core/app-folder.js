// @ts-check
// An app as a folder that travels (the Space Apps plan of 10-29, phase 4, "Import app…"): the `app.json` its download
// carries — its title, description and icon, and what its content says it reads, watches, runs, takes and shows —, with
// the folder it was published from written as `{{folder}}`, so it runs from wherever it is imported; and its files'
// addresses on the library hosts pointed back at the web, as its download had pointed them at the copies kept beside
// them. Pure: services/app-import.js reads the .zip and writes the folder.
import { WEB_DIR, relativeRef } from "./web-pins.js";

/** Where an app's folder is named in its app.json's commands: a starter's mark, filled as it is copied or imported. */
export const FOLDER_MARK = "{{folder}}";
/**
 * Where an imported app's folder keeps the copies of the web its download carried, and their `pins.json`, as a version
 * keeps them under `_filament/web/`: a folder of Filament's that is no file of its page, which its draft keeps again.
 */
export const KEPT_WEB = ".filament-web";
/** What of an app's content its app.json says, in this order. */
export const APP_JSON_KEYS = Object.freeze(["sources", "watch", "actions", "howto", "state", "secrets", "hooks", "glance"]);

/**
 * Every text in a JSON value with one string put for another. @param {unknown} v @param {string} from @param {string} to
 * @returns {unknown}
 */
export function textsWith(v, from, to) {
  if (!from) return v;
  if (typeof v === "string") return v.split(from).join(to);
  if (Array.isArray(v)) return v.map((x) => textsWith(x, from, to));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, textsWith(x, from, to)]));
  return v;
}

/**
 * Every text in a JSON value with a folder put for another where it is a path, never inside a word or a sentence: the
 * whole text, or its parts at the start of a path (`app/x`, `./app/x`, `app\x`) — and, a folder of several parts being
 * no word, wherever it ends too (`cd .filament/apps/runs && …`).
 * @param {unknown} v @param {string} from @param {string} to @returns {unknown}
 */
export function pathsWith(v, from, to) {
  if (!from) return v;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = new RegExp(`(?<=(?:^|[^\\w.\\-/\\\\])(?:\\.[/\\\\])?)${escaped}(?=[/\\\\]${from.includes("/") ? "|(?![\\w.\\-])" : ""})`, "g");
  /** @param {unknown} x @returns {unknown} */
  const put = (x) => {
    if (typeof x === "string") return x === from ? to : x.replace(at, () => to);
    if (Array.isArray(x)) return x.map(put);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, put(y)]));
    return x;
  };
  return put(v);
}

/**
 * The app.json an app's download carries: its record's words and its content's parts; `folder`, the folder it was
 * published from as its commands name it (from the project's top, with "/"), written `{{folder}}` where it is a path.
 * @param {{ title: string, description?: string, icon?: string, content: Record<string, unknown>, folder?: string | null }} o
 */
export function appJsonOf({ title, description = "", icon = "", content, folder = null }) {
  /** @type {Record<string, unknown>} */
  const out = { title, ...(description ? { description } : {}), ...(icon ? { icon } : {}) };
  for (const k of APP_JSON_KEYS) if (content[k] != null) out[k] = folder ? pathsWith(content[k], folder, FOLDER_MARK) : content[k];
  // A glance line is kept with its kind, which app.json leaves out (core/artifact-content.js puts it back).
  if (Array.isArray(out.glance)) out.glance = out.glance.map((t) => (t && typeof t === "object" ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== "kind")) : t));
  return out;
}

/**
 * A file's text as it was published, from its download: each address its download pointed at a copy beside it
 * (`pinnedText` with `relativeRef`) put back. @param {string} text @param {Readonly<Record<string, string>>} pins
 * @param {string} path  the file's own path in the app
 */
export function unpinnedText(text, pins, path) {
  // The longest first: a copy's path that begins another's is not put back inside it.
  const refs = Object.entries(pins).map(([address, kept]) => [relativeRef(path, `${WEB_DIR}/${kept}`), address]).sort((a, b) => b[0].length - a[0].length);
  let out = String(text);
  for (const [ref, address] of refs) out = out.split(ref).join(address);
  return out;
}
