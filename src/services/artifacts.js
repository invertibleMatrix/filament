// @ts-check
// The artifacts' store (HarnessV4_Artifacts_Plan E18, step 1): a folder `artifacts/` in the data folder, one folder per
// artifact by its name — its record (`artifact.json`: its title, description, icon and type, each version with who made
// it and its files, and the version each session last read or published, AF-D5) and a folder per version, `v1/`,
// `v2/`…, holding that version's files whole. A version's folder is written beside the record and renamed into place,
// and only then does the record name it: a write the disk refuses leaves the artifact as it was. A record that does not
// read is skipped and said, never thrown over (AFC-60). One process writes its data folder, and its writes here are
// synchronous, so two publishes at once are one after the other (AFC-30). The store also reads a project's folder for
// a publish by its path (AFC-6), only from inside the folders it is given.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PAGE_FILE, artifactPath, isArtifactName, nameFor } from "../core/artifacts.js";
import { createArtifactData } from "./artifact-data.js";

export const ARTIFACTS_DIR = "artifacts";
const RECORD = "artifact.json";
/** What a deleted artifact's folder keeps: its title and when (AFC-46). */
const GONE = "deleted.json";
/** The record's shape; a record of another is not this store's to read. */
const RECORD_VERSION = 1;

/**
 * @typedef {{ chain: string | null, model: string, folder: string, helper: string | null, call: string | null,
 *   exchange?: number, from?: number, visual?: string, edited?: number, dir?: string, project?: string }} Maker
 *   who made a version: the session (its chain), the model, the project folder it worked in, the helper of the
 *   session's that did, and the call that published it — which a chat read again finds its card by (AF-D38).
 *   `exchange`: which of the helper's exchanges, whose card names it (AFC-100); `from`: the developer made that version
 *   the newest again (AFC-79), and no session made this one; `visual`: the developer kept that visual of the chat as
 *   this version (AFC-101), and no model made it; `edited`: the developer edited that version's Markdown into this one
 *   (AFC-115); `dir`: the folder it was published from, as it really is on the disk (Import app…, 10-29); `project`:
 *   the project whose Space the developer added it to, with no chat (an app imported, or one its folder brings)
 * @typedef {{ path: string, bytes: number }} FileEntry
 * @typedef {{ v: number, at: number, by: Maker, files: FileEntry[] }} Version
 * @typedef {{ name: string, title: string, description: string, icon: string, type: string, createdAt: number,
 *   updatedAt: number, versions: Version[], seen: Record<string, number>, pinned: boolean, viewedAt: number }} Artifact
 *   `pinned` and `viewedAt` (0: never opened) are the developer's (AFC-13, AFC-14)
 * @typedef {{ path: string, data: Buffer }} FileIn
 * @typedef {{ ok: true, artifact: Artifact, version: Version } | { ok: false, stale: Artifact } | { ok: false, error: string }} Published
 * @typedef {{ title: string, deletedAt: number }} Deleted  what is kept of a deleted artifact
 * @typedef {"renamed" | "pinned" | "deleted"} Change  the developer's change to an artifact, other than a version
 */

/** Four characters of a new name, from [a-z0-9]. */
const fourOf = () =>
  [...randomBytes(4)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/**
 * @param {{ dataDir: string, log?: (level: string, msg: string) => void, now?: () => number, four?: () => string,
 *   onPublished?: (a: Artifact, v: Version) => void, onChanged?: (name: string, change: Change) => void,
 *   onData?: (name: string, news: import("./artifact-data.js").DataNews) => void }} o
 *   `onPublished`: told of each version kept, whoever kept it — every view open on it follows (AF-D37);
 *   `onChanged`: told of the developer's rename, pin and delete, which the views follow too (AFC-83); `onData`: told
 *   of each change to an artifact's data (`data`, step 5), which its view's line follows (AFC-97)
 */
export function createArtifactStore({ dataDir, log = () => {}, now = () => Date.now(), four = fourOf, onPublished = () => {}, onChanged = () => {}, onData = () => {} }) {
  const dir = join(dataDir, ARTIFACTS_DIR);
  /** The records already said to be broken, so a list says each once. @type {Set<string>} */
  const saidBroken = new Set();
  /**
   * A version kept, told: a listener's failure is said in the log, and never undoes or fails what was kept.
   * @param {Artifact} a @param {Version} v
   */
  const tell = (a, v) => {
    try {
      onPublished(a, v);
    } catch (/** @type {any} */ e) {
      log("warn", `artifacts: ${a.name} v${v.v} was kept, but telling the open views failed (${e?.message || e})`);
    }
  };
  /** A change kept, told as a version is. @param {string} name @param {Change} change */
  const changed = (name, change) => {
    try {
      onChanged(name, change);
    } catch (/** @type {any} */ e) {
      log("warn", `artifacts: ${name} was ${change}, but telling the open views failed (${e?.message || e})`);
    }
  };

  /**
   * Each record that reads, as this store last read or wrote it, by its name: a list (every transcript a page asks for
   * reads it) and a look at one read a record off the disk once, not at each ask. The store is the one writer of its
   * records (`save`, `remove`), and each write keeps its entry as a read of the file would make it. A record that is
   * not there, or does not read, is kept nowhere: it is read again at each ask.
   * @type {Map<string, Artifact>}
   */
  const records = new Map();
  /** A record as the store keeps it — its own, never handed out: `record` copies it. @param {string} name @returns {Artifact | null | "broken"} */
  const kept = (name) => {
    if (!isArtifactName(name)) return null;
    const had = records.get(name);
    if (had) return had;
    const a = fromDisk(name);
    if (a && a !== "broken") records.set(name, a);
    return a;
  };
  /** An artifact's record, null where there is none, or "broken" where it does not read: a copy, the caller's to change. @param {string} name @returns {Artifact | null | "broken"} */
  const record = (name) => {
    const a = kept(name);
    return a && a !== "broken" ? structuredClone(a) : a;
  };
  /** A record read off the disk. @param {string} name @returns {Artifact | null | "broken"} */
  const fromDisk = (name) => {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, name, RECORD), "utf8"));
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return null;
      return broken(name, e.message);
    }
    return shaped(name, raw);
  };
  /** A record's JSON as the store reads it. @param {string} name @param {any} raw @returns {Artifact | "broken"} */
  const shaped = (name, raw) => {
    const ok =
      raw?.version === RECORD_VERSION &&
      raw.name === name &&
      typeof raw.title === "string" &&
      Array.isArray(raw.versions) &&
      raw.versions.length > 0 &&
      raw.versions.every((/** @type {any} */ v, /** @type {number} */ i) => v?.v === i + 1 && Array.isArray(v.files));
    if (!ok) return broken(name, "its record is not one this store reads");
    const { version: _v, ...a } = raw;
    return /** @type {Artifact} */ ({ ...a, description: String(a.description || ""), icon: String(a.icon || "page"), type: String(a.type || "page"), seen: a.seen && typeof a.seen === "object" ? a.seen : {}, pinned: a.pinned === true, viewedAt: Number(a.viewedAt) || 0 });
  };
  /** @param {string} name @param {string} why @returns {"broken"} */
  const broken = (name, why) => {
    if (!saidBroken.has(name)) {
      saidBroken.add(name);
      log("warn", `artifacts: ${name} could not be read (${why}); it is left out`);
    }
    return "broken";
  };
  /** Write a record whole, beside it first; kept as a read of the file makes it. @param {Artifact} a */
  const save = (a) => {
    const file = join(dir, a.name, RECORD);
    const tmp = `${file}.${process.pid}.tmp`;
    const text = JSON.stringify({ version: RECORD_VERSION, ...a }, null, 2);
    try {
      writeFileSync(tmp, text);
      renameSync(tmp, file);
    } catch (e) {
      // What the file holds now is the disk's to say: the next read reads it.
      records.delete(a.name);
      rmSync(tmp, { force: true });
      throw e;
    }
    const back = shaped(a.name, JSON.parse(text));
    if (back === "broken") records.delete(a.name);
    else records.set(a.name, back);
  };
  /** A version's files, written beside the artifact's folder and renamed into place. @param {string} name @param {number} v @param {FileIn[]} files */
  const writeVersion = (name, v, files) => {
    const home = join(dir, name);
    const tmp = join(home, `.v${v}.${process.pid}.${fourOf()}.tmp`);
    const target = join(home, `v${v}`);
    try {
      for (const f of files) {
        const at = join(tmp, ...f.path.split("/"));
        mkdirSync(join(at, ".."), { recursive: true });
        writeFileSync(at, f.data);
      }
      mkdirSync(tmp, { recursive: true });
      // A folder of this number that no record names is a write a crash cut short: this one takes its place.
      rmSync(target, { recursive: true, force: true });
      renameSync(tmp, target);
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  };
  /**
   * The next version of an artifact, its files whole: kept, then told. `who`, a reader, has seen it; null for the
   * developer, who is no reader (AF-D5).
   * @param {Artifact} a @param {FileIn[]} files @param {Maker} by @param {string | null} who
   * @param {{ title?: string, description?: string, icon?: string, type?: string }} [meta]
   *   empty ones keep the artifact's
   * @returns {{ ok: true, artifact: Artifact, version: Version }}
   */
  const append = (a, files, by, who, meta = {}) => {
    const at = now();
    const version = { v: /** @type {Version} */ (a.versions.at(-1)).v + 1, at, by, files: files.map((f) => ({ path: f.path, bytes: f.data.length })) };
    writeVersion(a.name, version.v, files);
    const next = {
      ...a,
      title: meta.title || a.title,
      description: meta.description ?? a.description,
      icon: meta.icon || a.icon,
      type: meta.type || a.type,
      updatedAt: at,
      versions: [...a.versions, version],
      seen: who === null ? a.seen : { ...a.seen, [who]: version.v },
    };
    save(next);
    tell(next, version);
    return { ok: true, artifact: next, version };
  };
  /**
   * Every file of a version, read whole (a download, AFC-82; a version made the newest again, AFC-79); null where
   * there is no such version or one of its files is gone from the disk.
   * @param {string} name @param {number} v @returns {FileIn[] | null}
   */
  const versionFiles = (name, v) => {
    const a = kept(name);
    const version = a && a !== "broken" ? a.versions.find((x) => x.v === v) : null;
    if (!version) return null;
    try {
      return version.files.map((f) => ({ path: f.path, data: readFileSync(join(dir, name, `v${v}`, ...f.path.split("/"))) }));
    } catch {
      return null;
    }
  };

  const api = {
    /** Where the store keeps its artifacts. */
    dir,
    /** An artifact by its name, or null; a broken record reads as none. @param {string} name @returns {Artifact | null} */
    get(name) {
      const a = record(name);
      return a === "broken" ? null : a;
    },
    /** Whether a name's record is there but does not read (AFC-60). @param {string} name */
    broken: (name) => kept(name) === "broken",
    /** Every artifact that reads, the most recently changed first. @returns {Artifact[]} */
    list() {
      let names;
      try {
        names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && isArtifactName(d.name)).map((d) => d.name);
      } catch (/** @type {any} */ e) {
        if (e?.code === "ENOENT") return [];
        throw e;
      }
      /** @type {Artifact[]} */
      const out = [];
      for (const n of names) {
        const a = record(n);
        if (a && a !== "broken") out.push(a);
      }
      return out.sort((x, y) => y.updatedAt - x.updatedAt || x.name.localeCompare(y.name));
    },
    /**
     * A new artifact (no `name`), or the next version of one, its files whole (AF-D5). A publish over a version the
     * publisher (`who`: a session, or one helper of it) has not read or published is refused with the artifact as it
     * stands, and that refusal counts as its read (AFC-31); the developer (null) is no reader, and keeps a visual as
     * one (AFC-101). The title, description, icon and type given replace the artifact's; a new version's empty ones
     * keep them.
     * @param {{ name?: string | null, title?: string, description?: string, icon?: string, type?: string, files: FileIn[], by: Maker, who: string | null }} p
     * @returns {Published}
     */
    publish(p) {
      if (p.name) {
        const a = record(p.name);
        if (a === "broken") return { ok: false, error: `${p.name} could not be read from Filament's store, so nothing was published over it` };
        if (!a) return { ok: false, error: `there is no artifact named ${p.name}` };
        const newest = /** @type {Version} */ (a.versions.at(-1)).v;
        if (p.who !== null && (a.seen[p.who] ?? 0) < newest) {
          a.seen[p.who] = newest;
          save(a);
          return { ok: false, stale: a };
        }
        return append(a, p.files, p.by, p.who, p);
      }
      let name = nameFor(p.title || "", four());
      while (existsSync(join(dir, name))) name = nameFor(p.title || "", four());
      mkdirSync(join(dir, name), { recursive: true });
      const at = now();
      const version = { v: 1, at, by: p.by, files: p.files.map((f) => ({ path: f.path, bytes: f.data.length })) };
      /** @type {Artifact} */
      const a = { name, title: p.title || name, description: p.description || "", icon: p.icon || "page", type: p.type || "page", createdAt: at, updatedAt: at, versions: [version], seen: p.who === null ? {} : { [p.who]: 1 }, pinned: false, viewedAt: 0 };
      try {
        writeVersion(name, 1, p.files);
        save(a);
      } catch (e) {
        records.delete(name);
        rmSync(join(dir, name), { recursive: true, force: true });
        throw e;
      }
      tell(a, version);
      return { ok: true, artifact: a, version };
    },
    /** Note that `who` has read an artifact as it stands now: its newest version. @param {string} name @param {string} who */
    seen(name, who) {
      const a = kept(name);
      if (!a || a === "broken") return;
      const newest = /** @type {Version} */ (a.versions.at(-1)).v;
      if (a.seen[who] === newest) return;
      save({ ...a, seen: { ...a.seen, [who]: newest } });
    },
    /**
     * One file of a version, or null where the version has no such file.
     * @param {string} name @param {number} v @param {string} path  as the version lists it
     * @returns {Buffer | null}
     */
    file(name, v, path) {
      const a = kept(name);
      const version = a && a !== "broken" ? a.versions.find((x) => x.v === v) : null;
      if (!version?.files.some((f) => f.path === path)) return null;
      try {
        return readFileSync(join(dir, name, `v${v}`, ...path.split("/")));
      } catch {
        return null;
      }
    },
    files: versionFiles,
    /**
     * An old version made the newest again, by the developer (AFC-28, AFC-79): its files whole as the next version,
     * made by no session. Every chat that read the newest is a version behind now, so its next publish is refused
     * and handed this one (AF-D5).
     * @param {string} name @param {number} v
     * @returns {{ ok: true, artifact: Artifact, version: Version } | { ok: false, error: string }}
     */
    restore(name, v) {
      const a = record(name);
      if (a === "broken") return { ok: false, error: `${name} could not be read from Filament's store` };
      if (!a) return { ok: false, error: `there is no artifact named ${name}` };
      const newest = a.versions.length;
      if (!Number.isInteger(v) || v < 1 || v > newest) return { ok: false, error: `${a.title} has no version ${v}: it has 1 to ${newest}` };
      if (v === newest) return { ok: false, error: `v${v} is ${a.title}'s newest already` };
      const files = versionFiles(name, v);
      if (!files) return { ok: false, error: `v${v} of ${a.title} could not be read from the disk` };
      return append(a, files, { chain: null, model: "", folder: "", helper: null, call: null, from: v }, null);
    },
    /**
     * The developer's rename or pin (AFC-13, AFC-32): its address, versions and times stay. Null where there is no
     * such artifact.
     * @param {string} name @param {{ title?: string, pinned?: boolean }} c @returns {Artifact | null}
     */
    update(name, c) {
      const a = record(name);
      if (!a || a === "broken") return null;
      const next = { ...a, ...(c.title !== undefined ? { title: c.title } : {}), ...(c.pinned !== undefined ? { pinned: c.pinned } : {}) };
      save(next);
      changed(name, c.title !== undefined ? "renamed" : "pinned");
      return next;
    },
    /** Note that the artifact's page was opened, in the harness or a browser (AFC-14). @param {string} name */
    viewed(name) {
      const a = kept(name);
      if (a && a !== "broken") save({ ...a, viewedAt: now() });
    },
    /**
     * Delete an artifact: the developer's alone (AF-D14, AFC-46). Every version, file and record goes. Its title and
     * when stay in its folder, so its address says it was deleted and its name is never made again (AF-D20). A
     * record that does not read can be deleted too. Whether there was one to delete.
     * @param {string} name @returns {boolean}
     */
    remove(name) {
      const a = record(name);
      if (!a) return false;
      const home = join(dir, name);
      const note = join(home, GONE);
      const tmp = `${note}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ title: a === "broken" ? name : a.title, deletedAt: now() }));
      renameSync(tmp, note);
      try {
        for (const e of readdirSync(home)) if (e !== GONE) rmSync(join(home, e), { recursive: true, force: true });
      } finally {
        // Its record went with the rest — or, where a removal failed part way, is the disk's to say.
        records.delete(name);
      }
      saidBroken.delete(name);
      changed(name, "deleted");
      return true;
    },
    /**
     * What is kept of a deleted artifact, or null for a name never deleted.
     * @param {string} name @returns {Deleted | null}
     */
    deleted(name) {
      if (!isArtifactName(name)) return null;
      try {
        const d = JSON.parse(readFileSync(join(dir, name, GONE), "utf8"));
        return { title: String(d?.title || name), deletedAt: Number(d?.deletedAt) || 0 };
      } catch {
        return null;
      }
    },
  };
  // What their pages keep (AF-D7): beside each artifact's versions, the same whatever version shows, gone with it.
  return { ...api, data: createArtifactData({ store: api, log, onChange: onData }) };
}

/** @typedef {ReturnType<typeof createArtifactStore>} ArtifactStore */

/** Names a folder's walk leaves out by themselves: what a project keeps beside its pages, never a page's own. */
const LEFT_DIRS = new Set(["node_modules"]);
/** How many of the left-out entries the answer names one by one. */
const LEFT_NAMED = 10;

/**
 * A project's folder as a publish's files (AFC-6, AFC-63): every file under it, by its path inside it, with
 * `index.html` at its top as the page. Hidden entries, `node_modules` and links are left out and named. The folder must
 * sit inside one of `within` (the session's folder, and the folders it adds), as it really is on the disk; a folder
 * over `maxBytes` is refused, as Filament takes no call larger.
 * @param {string} folder  as the agent named it: absolute, or relative to the first of `within`
 * @param {{ within: readonly string[], maxBytes: number }} o
 * @returns {{ ok: true, files: FileIn[], left: string[], where: string } | { ok: false, error: string }}
 */
export function readFolder(folder, { within, maxBytes }) {
  const roots = within.filter(Boolean);
  if (!roots.length) return { ok: false, error: "this session has no project folder to publish from" };
  const asked = resolve(roots[0], String(folder || "."));
  let real;
  try {
    real = realpathSync(asked);
  } catch {
    return { ok: false, error: `${folder} is not a folder on this machine` };
  }
  const inside = roots.some((r) => {
    let base;
    try {
      base = realpathSync(r);
    } catch {
      return false;
    }
    const rel = relative(base, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!inside) return { ok: false, error: `${folder} is outside this session's folders (${roots.join(", ")}): only a folder inside them can be published` };
  try {
    if (!lstatSync(real).isDirectory()) return { ok: false, error: `${folder} is a file, not a folder: publish its page by html, or name the folder that holds it` };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `${folder} could not be read (${e.message})` };
  }
  /** @type {FileIn[]} */
  const files = [];
  /** @type {string[]} */
  const left = [];
  let total = 0;
  /** @param {string} at @param {string} rel */
  const walk = (at, rel) => {
    for (const d of readdirSync(at, { withFileTypes: true })) {
      const path = rel ? `${rel}/${d.name}` : d.name;
      if (d.name.startsWith(".") || (d.isDirectory() && LEFT_DIRS.has(d.name))) {
        left.push(d.isDirectory() ? `${path}/` : path);
        continue;
      }
      if (d.isSymbolicLink()) {
        left.push(`${path} (a link)`);
        continue;
      }
      if (d.isDirectory()) {
        walk(join(at, d.name), path);
        continue;
      }
      if (!d.isFile()) continue;
      const p = artifactPath(path);
      if (!p.ok) throw Object.assign(new Error(p.error), { refused: true });
      const data = readFileSync(join(at, d.name));
      total += data.length;
      if (total > maxBytes) throw Object.assign(new Error(`${folder} holds more than Filament takes in one publish (${Math.round(maxBytes / 1048576)} MB, server.maxBodyBytes): publish the folder that holds only the built page`), { refused: true });
      files.push({ path: p.path, data });
    }
  };
  try {
    walk(real, "");
  } catch (/** @type {any} */ e) {
    return { ok: false, error: e.refused ? e.message : `${folder} could not be read (${e.message})` };
  }
  if (!files.some((f) => f.path === PAGE_FILE)) {
    const top = files.filter((f) => !f.path.includes("/")).map((f) => f.path);
    return { ok: false, error: `${folder} has no ${PAGE_FILE} at its top, which is the page: ${top.length ? `it holds ${top.slice(0, LEFT_NAMED).join(", ")}${top.length > LEFT_NAMED ? ` and ${top.length - LEFT_NAMED} more` : ""}` : "it holds no files of its own"}` };
  }
  return { ok: true, files: files.sort((x, y) => (x.path === PAGE_FILE ? -1 : y.path === PAGE_FILE ? 1 : x.path.localeCompare(y.path))), left, where: real };
}

/** The left-out entries in words: the first ten, then how many more. @param {string[]} left */
export const leftWords = (left) => `${left.slice(0, LEFT_NAMED).join(", ")}${left.length > LEFT_NAMED ? ` and ${left.length - LEFT_NAMED} more` : ""}`;
