// @ts-check
// Import app… and the apps a project's folder brings (the Space Apps plan of 10-29, phase 4): an app comes as a folder
// — its app.json and its page —, from a .zip (an app's download from Filament, or its folder zipped) or already in the
// project, under `.filament/apps/`. An import unpacks into `<project>/.filament/apps/<name>/`, beside one there already,
// never over it, as a starter is copied: its download's look taken out again, its copies of the web kept beside its
// page (`KEPT_WEB`), the folder its commands name put where it now is. Then it is published as a draft of the project's
// Space (app/agent/artifacts.js `publishFolderApp`), with those copies, so it draws offline as its download did: nothing
// runs until the person keeps it, and it carries no secret's value — a download has none.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_JSON, CONTENT_JSON, PAGE_FILE, artifactPath, isTextData, pageUnalone } from "../core/artifacts.js";
import { FOLDER_MARK, KEPT_WEB, pathsWith, textsWith, unpinnedText } from "../core/app-folder.js";
import { PINNED_TEXT, PINS_FILE, WEB_DIR, isWebFile, pinsOf } from "../core/web-pins.js";
import { unzipOf } from "./zip.js";
import { APPS_FOLDER } from "./app-starters.js";

/** A folder's name from an app's title: "Build pipeline" → "build-pipeline". @param {string} title */
export const folderNameOf = (title) =>
  String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "app";

/**
 * An app's folder from a .zip: its files with app.json and the page at its top, or inside its one top folder; or why
 * not, in words. A download's own parts — Filament's content.json, the look written into each page — are taken out,
 * each address pointed back at the web as its version keeps it; its copies of the web and their pins are kept under
 * `KEPT_WEB` — none, where one is named as no file here may be. A Mac's `__MACOSX/` and `.DS_Store` are no files of it;
 * a path named twice in two cases, or a name Windows keeps for a device, is refused before anything is written.
 * @param {Buffer} buf @param {{ maxBytes: number }} o
 * @returns {{ ok: true, files: { path: string, data: Buffer }[], json: Record<string, any>, top: string } | { ok: false, error: string }}
 */
export function appFromZip(buf, { maxBytes }) {
  const z = unzipOf(buf, { maxBytes });
  if (!z.ok) return { ok: false, error: `Not imported: ${z.error}.` };
  // What a Mac's Compress adds beside a folder, and in it: no file of the app's.
  const own = z.files.filter((f) => f.path.split("/")[0] !== "__MACOSX" && f.path.split("/").at(-1) !== ".DS_Store");
  // Its one top folder, where every file is inside one (a folder zipped whole).
  const tops = new Set(own.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
  const top = tops.size === 1 && !tops.has("") ? [...tops][0] : "";
  const inside = top ? own.map((f) => ({ path: f.path.slice(top.length + 1), data: f.data })) : own;
  // Windows keeps one file for two names in two cases, so one would be written over the other.
  /** @type {Map<string, string>} */
  const named = new Map();
  for (const f of inside) {
    const was = named.get(f.path.toLowerCase());
    if (was) return { ok: false, error: `Not imported: it names ${was} twice (as ${was} and ${f.path}), which Windows keeps as one file.` };
    named.set(f.path.toLowerCase(), f.path);
  }
  const jsonFile = inside.find((f) => f.path === APP_JSON);
  if (!jsonFile) return { ok: false, error: `Not imported: it holds no ${APP_JSON}${top ? ` in ${top}/` : " at its top"}. An app's download from Filament has one, and so has an app's folder: zip the folder that holds ${APP_JSON} and ${PAGE_FILE}.` };
  if (!inside.some((f) => f.path === PAGE_FILE)) return { ok: false, error: `Not imported: it holds no ${PAGE_FILE} beside ${APP_JSON}, which is the app's page.` };
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(jsonFile.data.toString("utf8"));
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `Not imported: its ${APP_JSON} does not read as JSON (${e.message}).` };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, error: `Not imported: its ${APP_JSON} is no object of the app's title, sources and actions.` };
  const pins = pinsOf(inside.find((f) => f.path === PINS_FILE)?.data);
  /** @type {{ path: string, data: Buffer }[]} */
  const files = [];
  // Whether a copy of the web it carried cannot be a file here (`aux.js`, which a version kept before 10-29 could keep):
  // then none is kept, and its page loads them from the web — one missing would break what names it.
  let webRefused = false;
  for (const f of inside) {
    // Filament's content.json, which its app.json says again.
    if (f.path === CONTENT_JSON) continue;
    // The copies of the web its download carried, kept beside its page for its draft to keep again.
    const web = isWebFile(f.path);
    const p = artifactPath(web ? f.path.slice(WEB_DIR.length + 1) : f.path);
    if (!p.ok && web) {
      webRefused = true;
      continue;
    }
    if (!p.ok) return { ok: false, error: `Not imported: ${p.error}.` };
    if (web) {
      files.push({ path: `${KEPT_WEB}/${p.path}`, data: f.data });
      continue;
    }
    if (!PINNED_TEXT.test(f.path) || !isTextData(f.data)) {
      files.push({ path: p.path, data: f.data });
      continue;
    }
    let text = f.data.toString("utf8");
    if (/\.html?$/i.test(f.path)) text = pageUnalone(text);
    if (Object.keys(pins).length) text = unpinnedText(text, pins, f.path);
    files.push({ path: p.path, data: Buffer.from(text, "utf8") });
  }
  return { ok: true, files: webRefused ? files.filter((f) => !f.path.startsWith(`${KEPT_WEB}/`)) : files, json, top };
}

/**
 * An app from a .zip unpacked into the project: `<cwd>/.filament/apps/<name>/`, its name from its title — or `-2`… beside
 * one there already. Its app.json's `{{folder}}`, and the folder its commands named where it was zipped whole from
 * `.filament/apps/`, are written as its folder here.
 * @param {Buffer} buf @param {string} cwd  the project's folder @param {{ maxBytes: number }} o
 * @returns {{ ok: true, folder: string, title: string } | { ok: false, error: string }}
 */
export function importApp(buf, cwd, { maxBytes }) {
  if (!cwd || !existsSync(cwd)) return { ok: false, error: `Not imported: ${cwd || "the project's folder"} is not a folder on this machine.` };
  const got = appFromZip(buf, { maxBytes });
  if (!got.ok) return got;
  const title = typeof got.json.title === "string" && got.json.title.trim() ? got.json.title.trim() : got.top || "Imported app";
  const base = folderNameOf(got.top || title);
  let name = base;
  for (let n = 2; existsSync(join(cwd, ...APPS_FOLDER.split("/"), name)); n++) name = `${base}-${n}`;
  const folder = `${APPS_FOLDER}/${name}`;
  let json = /** @type {Record<string, any>} */ (textsWith(got.json, FOLDER_MARK, folder));
  if (got.top) json = /** @type {Record<string, any>} */ (pathsWith(json, `${APPS_FOLDER}/${got.top}`, folder));
  const to = join(cwd, ...folder.split("/"));
  for (const f of got.files) {
    const target = join(to, ...f.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.path === APP_JSON ? `${JSON.stringify(json, null, 2)}\n` : f.data);
  }
  return { ok: true, folder, title };
}

/**
 * The copies of the web an app's folder keeps (`KEPT_WEB`, written by an import), as a publish takes what it fetched
 * (app/agent/artifacts.js `pinnedFor`): each file as its version keeps it under `_filament/web/`, and its pins. Null
 * where it keeps none, or more than `maxBytes`: its page then loads them from the web.
 * @param {string} dir  the app's folder on the disk @param {number} maxBytes
 * @returns {import("./web-pins.js").Pinned | null}
 */
export function keptWebIn(dir, maxBytes) {
  const at = join(dir, KEPT_WEB);
  let pins;
  try {
    pins = pinsOf(readFileSync(join(at, "pins.json")));
  } catch {
    return null;
  }
  if (!Object.keys(pins).length) return null;
  /** @type {{ path: string, data: Buffer }[]} */
  const files = [];
  let total = 0;
  /** @param {string} from @param {string} rel */
  const walk = (from, rel) => {
    for (const d of readdirSync(from, { withFileTypes: true })) {
      const path = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(from, d.name), path);
      else if (d.isFile() && path !== "pins.json" && artifactPath(path).ok) {
        const data = readFileSync(join(from, d.name));
        total += data.length;
        files.push({ path: `${WEB_DIR}/${path}`, data });
      }
    }
  };
  try {
    walk(at, "");
  } catch {
    return null;
  }
  return total > maxBytes ? null : { files, pins, failed: [], late: 0 };
}

/** A folder as two are compared: `/`, no trailing one, one case. @param {string} f */
const folderKey = (f) => String(f || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Of the apps a project's folder holds, those no app of Filament's came from yet: by the folder a version was published
 * from (its `by.dir`), or — one published before that was kept — by its title among the Space's apps.
 * @param {ReturnType<typeof folderApps>} found
 * @param {readonly { versions: readonly { by: { dir?: string } }[] }[]} artifacts @param {readonly string[]} titles
 */
export function notYetAdded(found, artifacts, titles) {
  const dirs = new Set(artifacts.flatMap((a) => a.versions.map((v) => v.by.dir || "").filter(Boolean).map(folderKey)));
  return found.filter((f) => !dirs.has(folderKey(f.where)) && !titles.includes(f.title));
}

/**
 * The apps a project's folder holds under `.filament/apps/`: each folder with an app.json and a page, its title from
 * its app.json (its folder's name where that says none), and where it really is on the disk.
 * @param {string} cwd
 * @returns {{ folder: string, where: string, title: string, description: string }[]}
 */
export function folderApps(cwd) {
  const at = join(cwd || "", ...APPS_FOLDER.split("/"));
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(at, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {{ folder: string, where: string, title: string, description: string }[]} */
  const out = [];
  for (const d of entries) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const dir = join(at, d.name);
    if (!existsSync(join(dir, PAGE_FILE))) continue;
    /** @type {any} */
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, APP_JSON), "utf8"));
    } catch {
      continue;
    }
    out.push({
      folder: `${APPS_FOLDER}/${d.name}`,
      where: realpathSync(dir),
      title: typeof json?.title === "string" && json.title.trim() ? json.title.trim() : d.name,
      description: typeof json?.description === "string" ? json.description.trim() : "",
    });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}
