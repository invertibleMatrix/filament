// @ts-check
// An app's folder source, read (the Space Apps plan of 10-29, more reads): a folder of the project listed, read only —
// a row per file or folder, `depth` deep, those whose name matches its pattern —, each its path from the project's
// folder, its name, its kind, its size and when it last changed. Never above the project's folder: its real path is
// checked, and a link inside is listed, never followed.
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** The most entries one read looks at, however deep: a folder of more says the first ones, and `more`. */
export const FOLDER_SEEN_MAX = 5000;

/** Two characters alike, case aside. @param {string} a @param {string} b */
const same = (a, b) => a === b || a.toLowerCase() === b.toLowerCase();

/**
 * A file name's pattern as a test: `*` any run, `?` one character, case aside. Matched by two places that only move on,
 * going back to the last `*` alone: a regular expression of many stars backtracked for ever on a long name, in the
 * walk that holds Filament (found reviewing the Space work, 10-29).
 * @param {string} m
 */
const patternOf = (m) => ({
  /** @param {string} name */
  test(name) {
    let p = 0;
    let n = 0;
    let star = -1;
    let from = 0;
    while (n < name.length) {
      if (m[p] === "*") {
        star = p++;
        from = n;
      } else if (p < m.length && (m[p] === "?" || same(m[p], name[n]))) {
        p++;
        n++;
      } else if (star >= 0) {
        // The last star takes one more character; what follows it is tried from there.
        p = star + 1;
        n = ++from;
      } else return false;
    }
    while (m[p] === "*") p++;
    return p === m.length;
  },
});

/**
 * A folder read: its rows as JSON — `more` where it stopped at FOLDER_SEEN_MAX with entries it never looked at —, or
 * why not in words.
 * @param {import("../core/dashboard-sources.js").FolderRead} f @param {string} root  the project's folder
 * @param {AbortSignal} [signal]
 * @returns {Promise<import("../core/dashboard-sources.js").CommandOut>}
 */
export async function listFolder(f, root, signal) {
  /** @type {string} */
  let top;
  /** @type {string} */
  let base;
  try {
    top = realpathSync(root);
    base = realpathSync(resolve(top, f.path));
  } catch (/** @type {any} */ e) {
    return { ok: false, error: e?.code === "ENOENT" ? `${f.path} is not in the project's folder` : `${f.path} could not be read (${e?.code || e?.message || e})` };
  }
  if (base !== top && !base.startsWith(top.endsWith(sep) ? top : top + sep)) return { ok: false, error: `${f.path} leads out of the project's folder` };
  if (!statSync(base).isDirectory()) return { ok: false, error: `${f.path} is a file, not a folder` };
  const test = f.match ? patternOf(f.match) : null;
  /** @type {{ path: string, name: string, kind: string, size: number | null, modified: string }[]} */
  const rows = [];
  let seen = 0;
  let more = false;
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (signal?.aborted) return;
      if (seen >= FOLDER_SEEN_MAX) {
        more = true;
        return;
      }
      seen++;
      const full = join(dir, e.name);
      const folder = e.isDirectory();
      if (!test || test.test(e.name)) {
        try {
          const st = lstatSync(full);
          rows.push({
            path: relative(top, full).split(sep).join("/"),
            name: e.name,
            kind: folder ? "folder" : e.isSymbolicLink() ? "link" : "file",
            size: folder ? null : st.size,
            modified: st.mtime.toISOString(),
          });
        } catch {}
      }
      if (folder && depth > 1) walk(full, depth - 1);
    }
  };
  walk(base, f.depth);
  if (signal?.aborted) return { ok: false, error: "it was stopped" };
  return { ok: true, out: JSON.stringify(rows), more };
}
