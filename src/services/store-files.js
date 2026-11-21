// @ts-check
// A store's file of another build's version (r-itself, 11-12). The way back (`filament update --back`) starts one
// build on the data folder another wrote, and a store that reads one version of its file must not start empty over a
// file of another and save over it: the build that wrote it runs again. One rule here, read by each such store
// (`readStoreFile`) and by the updater (`unreadBy`, cli/update.js):
// - A file whose version this build does not read is set aside before anything is saved over it: renamed beside itself
//   to `<file>.v<its version>.<when>`, a name no other file has. Nothing removes it.
// - A build that finds a file of its own version set aside so takes the newest back, where none is in place or the one
//   in place is another build's (set aside in its turn): each build finds what it saved, and nothing is merged. Where
//   a file of its own version is in place too and the two differ, both are kept: it reads the one in place and marks
//   the other `.kept`, which nothing looks at again.
// - Each is said once, in the log, in words the person can act on.
// A file that names no version is none of this: its store says it could not be read.
// It imports nothing of Filament's: the updater reads a kept build's own copy of this file for what that build reads.
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * A store whose file says its version: the file in the data folder (`file`), or the folder each of whose `.json` files
 * is one (`dir`); the one version this build reads and writes; what the store starts with where it has none.
 * @typedef {{ file?: string, dir?: string, version: number, starts: string }} StoreFile
 */

const USAGE = { version: 2, starts: "a new usage file" };

/** The stores that read a versioned file, as this build reads them: each reads its own row. */
export const STORE_FILES = Object.freeze({
  teams: /** @type {StoreFile} */ ({ file: "teams.json", version: 2, starts: "no saved teams" }),
  agents: /** @type {StoreFile} */ ({ file: "agents.json", version: 1, starts: "no saved agents" }),
  spaces: /** @type {StoreFile} */ ({ dir: "spaces", version: 1, starts: "an empty Space" }),
  usage: /** @type {StoreFile} */ ({ file: "daily-usage.json", ...USAGE }),
  memoryUsage: /** @type {StoreFile} */ ({ file: "memory-usage.json", ...USAGE }),
  telemetry: /** @type {StoreFile} */ ({ file: "telemetry.json", version: 1, starts: "a new anonymous id and no counts" }),
});

/**
 * What a build that carries no such table reads, and does with a file of another version (`does` goes on "it …"):
 * every build from before this one — the first server build, of 11-08, read these versions already.
 * @type {Readonly<Record<string, { file?: string, dir?: string, version: number, does: string }>>}
 */
export const STORE_FILES_BEFORE = Object.freeze({
  teams: { file: "teams.json", version: 2, does: "starts with no saved teams, and its next save writes over the file" },
  agents: { file: "agents.json", version: 1, does: "starts with no saved agents, and its next save writes over the file" },
  spaces: { dir: "spaces", version: 1, does: "moves the file to one .broken name, over a file moved there before, and starts an empty Space" },
  usage: { file: "daily-usage.json", version: 2, does: "moves the file to one .broken name, over a file moved there before, and starts a new usage file" },
  memoryUsage: { file: "memory-usage.json", version: 2, does: "moves the file to one .broken name, over a file moved there before, and starts a new usage file" },
  telemetry: { file: "telemetry.json", version: 1, does: "starts again where it keeps one, and its next save writes over the file" },
});

/** A file's version as a name can carry it: a number's or a short word's; null where it names none. @param {any} raw @returns {string | null} */
const labelOf = (raw) => {
  const v = raw?.version;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && /^[\w-]{1,24}$/.test(v) ? v : null;
};

/** When a file was set aside, as its name says it: 20261112T093005Z. @param {number} at */
const stampOf = (at) => `${new Date(at).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

/** The name a file of version `label` is set aside under, beside `file`: one no file has. @param {string} file @param {string} label @param {number} at */
export const asideName = (file, label, at) => {
  const name = `${file}.v${label}.${stampOf(at)}`;
  let free = name;
  for (let n = 2; existsSync(free); n++) free = `${name}-${n}`;
  return free;
};

/**
 * The files of `version` set aside beside `file`, the newest first: by when each was, as its name says.
 * @param {string} file @param {number} version @returns {string[]} their names
 */
export const asidesOf = (file, version) => {
  const head = `${basename(file)}.v${version}.`;
  /** @type {{ name: string, when: string, n: number }[]} */
  const found = [];
  let names;
  try {
    names = readdirSync(dirname(file));
  } catch {
    return [];
  }
  for (const name of names) {
    const m = name.startsWith(head) ? /^(\d{8}T\d{6}Z)(?:-(\d+))?$/.exec(name.slice(head.length)) : null;
    if (m) found.push({ name, when: m[1], n: Number(m[2]) || 1 });
  }
  return found.sort((a, b) => (a.when === b.when ? b.n - a.n : a.when < b.when ? 1 : -1)).map((f) => f.name);
};

/**
 * The files in the folder `dir` that have one of `version` set aside beside them, by name: what a store of a folder
 * of files reads once as it starts, so each is taken back whether or not anything asks for it.
 * @param {string} dir @param {number} version @returns {string[]}
 */
export const setAsideIn = (dir, version) => {
  try {
    const names = readdirSync(dir).flatMap((n) => {
      const m = /^(.+)\.v([\w-]+)\.\d{8}T\d{6}Z(?:-\d+)?$/.exec(n);
      return m && m[2] === String(version) ? [m[1]] : [];
    });
    return [...new Set(names)];
  } catch {
    return [];
  }
};

/**
 * A file of another version kept beside itself under `asideName`: moved there, or (`copy`) copied, the file left in
 * place — the updater's, for a build that would save over it. A move that fails is a copy; → the name it has there.
 * @param {string} file @param {string} label @param {{ now?: () => number, copy?: boolean }} [o]
 */
export function setAside(file, label, { now = Date.now, copy = false } = {}) {
  const aside = asideName(file, label, now());
  if (!copy)
    try {
      renameSync(file, aside);
      return basename(aside);
    } catch {}
  copyFileSync(file, aside);
  return basename(aside);
}

/**
 * A store's file read as this build reads it: its JSON, of `version` or naming none (the store's own check says what
 * that is). One of another version is set aside first, and one of this version set aside before taken back (the
 * header). Where no file is in place then, ENOENT is thrown, as reading a file that is not there throws it; a file
 * that does not parse throws as it did.
 * @param {string} file
 * @param {{ version: number, starts: string }} store  its row of `STORE_FILES`
 * @param {(level: string, msg: string) => void} [log]  each line starts with the file's name: the store adds its own
 * @param {{ now?: () => number, swept?: boolean }} [o]  `swept`: the folder's files set aside were read as the store
 *   started (`setAsideIn`), so a file in place that reads, or none, looks at nothing beside it
 * @returns {any}
 */
export function readStoreFile(file, { version, starts }, log = () => {}, { now = Date.now, swept = false } = {}) {
  const name = basename(file);
  const dir = dirname(file);
  /** @param {any} e */
  const whyNot = (e) => e?.code || e?.message || String(e);
  /** @type {any} */
  let raw = null;
  /** @type {any} */
  let none = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (/** @type {any} */ e) {
    if (e?.code !== "ENOENT") throw e;
    none = e;
  }
  const label = none ? null : labelOf(raw);
  // One that names no version is the store's to refuse: nothing beside it is looked at.
  if (!none && label === null) return raw;
  /** Another build's file, as it was set aside in this read. @type {string | null} */
  let other = null;
  const others = `${name} is version ${label}, which this Filament does not read (it reads version ${version}): another build of Filament saved it.`;
  if (!none && label !== String(version)) {
    none = Object.assign(new Error(`ENOENT: ${name} is another build's`), { code: "ENOENT" });
    try {
      other = setAside(file, /** @type {string} */ (label), { now });
    } catch (e) {
      log("warn", `${others} It could not be set aside (${whyNot(e)}), and this build starts with ${starts}: its next save writes over the file — stop Filament and copy the file away first to keep it.`);
      throw none;
    }
    // Still in place: it was copied, not moved. What this build saved before stays beside it until it can be.
    if (existsSync(file)) {
      log("warn", `${others} A copy is kept beside it as ${other}, and this build starts with ${starts}: its next save writes over the file itself. The build that saved it takes the copy back when it runs again.`);
      throw none;
    }
  }
  const own = swept && other === null ? [] : asidesOf(file, version);
  if (none) {
    let back = own.shift() ?? null;
    if (back)
      try {
        renameSync(join(dir, back), file);
      } catch (e) {
        log("warn", `${back}, which this build saved before another build of Filament ran, could not be put back as ${name} (${whyNot(e)}): it stays beside it, and this build starts with ${starts}.`);
        back = null;
      }
    if (other) {
      const kept = `${others} It is kept beside it as ${other}, with nothing saved over it,`;
      log("warn", back ? `${kept} and ${back}, which this build saved before, is ${name} again. Nothing was merged: what was saved since is in ${other}.` : `${kept} and this build starts with ${starts}. The build that saved it takes it back when it runs again.`);
    } else if (back) log("info", `${back}, which this build saved before another build of Filament ran, is ${name} again.`);
    if (!back) throw none;
    raw = JSON.parse(readFileSync(file, "utf8"));
  }
  // One of this version in place, and one set aside before: both kept, and where they differ said, once — the one
  // beside it is marked, and nothing looks at it again.
  for (const kept of own) {
    const at = join(dir, kept);
    try {
      const same = readFileSync(at).equals(readFileSync(file));
      renameSync(at, `${at}.kept`);
      if (!same) log("warn", `${kept} holds what this build saved before another build of Filament ran, and ${name} was saved since: both are kept, and nothing was merged. Filament reads ${name}; the other is ${kept}.kept now — to use it instead, stop Filament and rename it to ${name}.`);
    } catch {}
  }
  return raw;
}

/**
 * What a data folder holds that a build does not read: each file of `stores` (a folder's, each of its `.json` files)
 * whose version is another than its row's. A file that is not there, does not parse or names no version is none.
 * @param {string} dataDir
 * @param {Record<string, { file?: string, dir?: string, version: number }>} stores  a build's `STORE_FILES`, or `STORE_FILES_BEFORE`
 * @returns {{ key: string, name: string, path: string, found: string, reads: number }[]}  `name` under the data folder
 */
export function unreadBy(dataDir, stores) {
  /** @type {{ key: string, name: string, path: string, found: string, reads: number }[]} */
  const out = [];
  for (const [key, s] of Object.entries(stores)) {
    if (!s || typeof s.version !== "number") continue;
    /** @type {string[]} */
    let names = [];
    if (typeof s.file === "string") names = [s.file];
    else if (typeof s.dir === "string")
      try {
        const dir = s.dir;
        names = readdirSync(join(dataDir, dir)).filter((f) => f.endsWith(".json")).sort().map((f) => `${dir}/${f}`);
      } catch {}
    for (const name of names) {
      const path = join(dataDir, name);
      let found = null;
      try {
        found = labelOf(JSON.parse(readFileSync(path, "utf8")));
      } catch {}
      if (found !== null && found !== String(s.version)) out.push({ key, name, path, found, reads: s.version });
    }
  }
  return out;
}
