// @ts-check
// Approval by content: the bytes of the project's scripts a command runs, pinned by a hash when the person approves it
// — a dashboard's Keep (services/dashboard-runner.js), a script watcher's Switch on (app/watchers/script.js) — and read
// again before it runs. A script is pinned with the code beside it, in its folder and the folders under it: what it
// imports, a helper an agent could rewrite. One changed since, gone, or new beside it is not as approved, and what
// reads these says so in its own words. What this costs: a script's imports from elsewhere than beside it, the packages
// it loads and the program that runs it (node, python) are not pinned, and a folder's code past `BESIDE_MAX` files is
// not looked through.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SCRIPT_FILE } from "../core/dashboard-sources.js";

/**
 * The project's file a command's part names, by its path in the project with `/` between folders, and where it is on
 * the disk; null where it names none inside the project.
 * @param {string} folder @param {string} part
 */
export const inProject = (folder, part) => {
  const file = resolve(folder, part);
  const rel = relative(folder, file);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return { path: rel.split(sep).join("/"), file };
};
/** A file's bytes as a hash, or null where it is no file that reads. @param {string} file */
export const hashOf = (file) => {
  try {
    return statSync(file).isFile() ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
  } catch {
    return null;
  }
};
/** Folders whose code is no script's own: installed packages, a repository's, caches — and any folder named with a dot. */
const NOT_BESIDE = new Set(["node_modules", "__pycache__", "venv", "dist", "build", "target", "vendor"]);
/** The most files beside one script an approval pins: past them, the rest of its folder is not looked through. */
export const BESIDE_MAX = 400;
/**
 * The code beside a script of the project: each file named as code (core's SCRIPT_FILE) in its folder and the folders
 * under it — what it imports, a helper the agent could rewrite — by its path in the project, sorted, BESIDE_MAX at most.
 * A script at the project's top has that folder's own files alone: the whole project is not its own. The review of the
 * app tools found it: in Edit mode a tool that reads runs unasked, and its kept script ran the helper beside it that the
 * agent had just changed.
 * @param {string} folder  the project's @param {string} path  the script's, in the project @returns {{ path: string, file: string }[]}
 */
export function codeBeside(folder, path) {
  const top = dirname(path) === ".";
  /** @type {{ path: string, file: string }[]} */
  const found = [];
  /** @param {string} rel */
  const look = (rel) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries = [];
    try {
      entries = readdirSync(join(folder, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (found.length >= BESIDE_MAX) return;
      const p = rel === "." ? e.name : `${rel}/${e.name}`;
      if (e.isFile() && SCRIPT_FILE.test(e.name)) found.push({ path: p, file: join(folder, p) });
      else if (e.isDirectory() && !top && !e.name.startsWith(".") && !NOT_BESIDE.has(e.name)) look(p);
    }
  };
  look(dirname(path));
  return found;
}
/** Whether a pinned path is beside the script at `path`, as codeBeside finds it. @param {string} pinned @param {string} path */
const isBeside = (pinned, path) => {
  const dir = dirname(path);
  const name = pinned.split("/").at(-1) || "";
  if (!SCRIPT_FILE.test(name)) return false;
  if (dir === ".") return !pinned.includes("/");
  return pinned.startsWith(`${dir}/`) && !pinned.slice(dir.length + 1).split("/").slice(0, -1).some((f) => f.startsWith(".") || NOT_BESIDE.has(f));
};

/**
 * What an approval pins: each script of the project among a command's parts that may name one (core's scriptParts, a
 * script watcher's own), by its path, its bytes' hash, and the code beside it (`codeBeside`). A system command — none
 * of its parts a file of the project — pins nothing.
 * @param {readonly string[]} parts @param {string | null} folder
 * @param {(file: string) => string | null} [hash]  how a file's bytes are hashed (a runner's keeps them for its looks)
 * @returns {Record<string, string>}
 */
export function pinsOf(parts, folder, hash = hashOf) {
  /** @type {Record<string, string>} */
  const pins = {};
  if (!folder) return pins;
  for (const part of parts) {
    const at = inProject(folder, part);
    const bytes = at && hash(at.file);
    if (!at || !bytes) continue;
    pins[at.path] = bytes;
    for (const b of codeBeside(folder, at.path)) {
      const h = hash(b.file);
      if (h) pins[b.path] = h;
    }
  }
  return pins;
}
/**
 * The scripts among a command's parts that are not as their approval pinned them: changed since, gone, or a file the
 * approval did not see — by their path in the project, each once. The code beside a script is judged with it: a file
 * there at this look, or one the approval pinned there.
 * @param {Record<string, string> | undefined} pins @param {readonly string[]} parts @param {string | null} folder
 * @param {(file: string) => string | null} [hash]  how a file's bytes are hashed: read each time, unless a list's look
 * @returns {string[]}
 */
export function scriptsChanged(pins = {}, parts, folder, hash = hashOf) {
  if (!folder) return [];
  /** @type {Set<string>} */
  const changed = new Set();
  for (const part of parts) {
    const at = inProject(folder, part);
    if (!at) continue;
    const bytes = hash(at.file);
    // A part that names no file, and named none the approval pinned, runs no script of the project.
    if (bytes === null && !Object.hasOwn(pins, at.path)) continue;
    if (bytes !== pins[at.path]) changed.add(at.path);
    const beside = new Set([...codeBeside(folder, at.path).map((b) => b.path), ...Object.keys(pins).filter((p) => p !== at.path && isBeside(p, at.path))]);
    beside.delete(at.path);
    for (const p of beside) if (hash(join(folder, ...p.split("/"))) !== (Object.hasOwn(pins, p) ? pins[p] : null)) changed.add(p);
  }
  return [...changed];
}
