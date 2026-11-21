// @ts-check
// Outputs (HarnessV4_Four_Plan E20): the files a chat's agents wrote that git does not show you — outside any
// repository, or inside one that git ignores (FO-D21, FO-D22). Read from the rounds its turns recorded, which name
// every file the agents' write and edit calls landed — Filament's own agent, its helpers and a coding agent alike — and
// each file looked at as it stands now (FO-D23): one now inside a repository git sees is git's, and leaves the list;
// one no longer where it was written is named apart. Read only.
import { statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { placeOf } from "../../adapters/git/snapshot.js";
import { ignoredOf } from "../../adapters/git/inspect.js";

/**
 * @typedef {object} OutputFile
 * @property {string} path  where it was written, whole
 * @property {string} name
 * @property {string} folder
 * @property {number} size  bytes
 * @property {number} mtimeMs  when it last changed
 * @property {string} agent  who wrote it last: "" for the chat's own agent, else a helper's id
 * @property {number | null} turn  the newest turn that wrote it
 * @property {string | null} ignoredIn  the repository whose git ignores it; null for a file outside any
 * @typedef {object} Outputs
 * @property {OutputFile[]} files  newest first, by the round that last wrote each
 * @property {{ path: string, agent: string, turn: number | null }[]} gone  written outside any repository, and no
 *   longer there
 * @property {{ place: string, error: string }[]} errors  a place git could not read, in words
 * @typedef {{ path: string, agent: string, turn: number | null, at: number }} Written
 */

/** A path as two spellings of one file compare: whole, one separator, and on Windows one case. @param {string} p */
const keyOf = (p) => {
  const r = resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** The file at a path, or null where none is. @param {string} path */
const fileAt = (path) => {
  try {
    const st = statSync(path);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
};

/**
 * A path inside a place as git names it there; null where the place does not hold it.
 * @param {string} place @param {string} path
 */
const inside = (place, path) => {
  const r = relative(place, path);
  return r && !isAbsolute(r) && !r.startsWith("..") ? r.split(/[\\/]/).join("/") : null;
};

/**
 * @param {import("../../core/types.js").RoundChange[]} rounds  the chat's, in the order taken
 * @returns {Promise<Outputs>}
 */
export async function outputsOf(rounds) {
  /**
   * Each file written, by the last round that named it: whole, who, which turn, and that round's order.
   * @type {Map<string, Written & { place: string }>}
   */
  const written = new Map();
  rounds.forEach((r, at) => {
    for (const p of r.own || []) {
      const path = resolve(r.place ? join(r.place, String(p)) : String(p));
      written.set(keyOf(path), { path, place: r.place || "", agent: r.agent || "", turn: r.turn ?? null, at });
    }
  });
  /** @type {Outputs} */
  const out = { files: [], gone: [], errors: [] };
  /** @type {(Written & { ignoredIn: string | null })[]} */
  const kept = [];
  /**
   * The files inside a repository, by it and their path in it: its git says which it ignores.
   * @type {Map<string, Map<string, Written>>}
   */
  const byPlace = new Map();
  /** @param {string} place @param {string | null} rel @param {Written} w */
  const ask = (place, rel, w) => {
    if (!rel) return;
    const m = byPlace.get(place) || new Map();
    byPlace.set(place, m.set(rel, w));
  };
  /**
   * Where each folder is now, asked once.
   * @type {Map<string, Promise<{ place: string | null, outside: boolean, error: string }>>}
   */
  const placed = new Map();
  for (const w of written.values()) {
    if (!fileAt(w.path)) {
      // A file git sees that is gone is git's to show as deleted; one outside any repository is named here.
      if (!w.place) out.gone.push({ path: w.path, agent: w.agent, turn: w.turn });
      continue;
    }
    if (w.place) {
      ask(w.place, inside(w.place, w.path), w);
      continue;
    }
    const dir = keyOf(dirname(w.path));
    let p = placed.get(dir);
    if (!p) placed.set(dir, (p = placeOf(w.path)));
    const now = await p;
    if (now.place) ask(now.place, inside(now.place, w.path), w);
    else kept.push({ ...w, ignoredIn: null });
  }
  for (const [place, files] of byPlace) {
    const r = await ignoredOf(place, [...files.keys()]);
    if (r.error) out.errors.push({ place, error: r.error });
    for (const rel of r.ignored) {
      const w = files.get(rel);
      if (w) kept.push({ ...w, ignoredIn: place });
    }
  }
  kept.sort((a, b) => b.at - a.at);
  for (const w of kept) {
    const st = fileAt(w.path);
    if (st) out.files.push({ path: w.path, name: basename(w.path), folder: dirname(w.path), size: st.size, mtimeMs: Math.round(st.mtimeMs), agent: w.agent, turn: w.turn, ignoredIn: w.ignoredIn });
  }
  return out;
}
