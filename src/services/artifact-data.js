// @ts-check
// What an artifact's page keeps (HarnessV4_Artifacts_Plan E18 step 5, AF-D7): collections of small JSON records, each a
// JSON object with an `id`, kept by Filament beside the artifact's versions — `artifacts/<name>/data/<collection>.json`
// — so the data is the artifact's, the same in the side pane, the full view and a browser tab, and no version changes
// it (AFC-91); deleting the artifact takes it. The page reaches it at its own address (`filament.db`), the agent with
// the tool's `read_db` and `write_db`; each change is told to the pages that follow it (`follow`) and to the harness. A
// change is all or nothing (AFC-95), written beside the collection's file and renamed into place. A file that does not
// read is said in words, never thrown over (AFC-96). One process writes the data folder, and its writes here are
// synchronous, so two changes at once are one after the other. A collection keeps 64 MB at most, and an artifact's
// collections 256 MB together.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Where an artifact keeps its data, inside its folder. */
const DATA_DIR = "data";
/** The collection file's shape; a file of another is not this store's to read. */
const FILE_VERSION = 1;
/** A collection's name: letters, digits, `-` and `_`, starting with a letter or a digit; one name whatever its case. */
const COLLECTION = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** The longest id a record may be given. */
const ID_MAX = 200;
/**
 * The most bytes one collection's file holds, 64 MB. Each change reads the file and writes it whole, so a collection is
 * kept small enough for that; and far under what Node reads back as one string (`MAX_STRING_LENGTH`, 512 MB), past
 * which the file does not read and the collection's every record is lost with it.
 */
export const COLLECTION_MAX_BYTES = 64 * 1048576;
/** The most bytes an artifact's collections hold together, 256 MB: its data on the disk, however many collections. */
export const DATA_MAX_BYTES = 256 * 1048576;

/**
 * @typedef {Record<string, unknown> & { id: string | number }} DataRecord  a record as kept: a JSON object with its id
 * @typedef {{ set?: unknown[], update?: unknown[], delete?: unknown[] }} DataChange
 *   `set`: records added, or replaced whole where their id is there (one with no id is given one, AFC-87); `update`:
 *   each an id with the fields to change; `delete`: ids
 * @typedef {{ set: DataRecord[], updated: DataRecord[], deleted: (string | number)[], missing: (string | number)[] }} DataDone
 *   what a change did: `missing`, the ids a delete named that were not there (AFC-88)
 * @typedef {{ ok: false, status: number, error: string }} DataRefused  in words the page and the agent act on
 * @typedef {{ collection: string, from: string }} DataNews  a change, told: which collection, and who made it — a
 *   page's own mark, "agent", or "developer"
 */

/** A collection's name as it is kept, or null where it is not one (AFC-89). @param {unknown} c */
export const collectionName = (c) => {
  const n = typeof c === "string" ? c.trim().toLowerCase() : "";
  return COLLECTION.test(n) ? n : null;
};
/** Whether a file in the data folder is a collection's: its name, as kept, and `.json`. @param {string} f */
const isCollectionFile = (f) => f.endsWith(".json") && collectionName(f.slice(0, -5)) === f.slice(0, -5);
/** A cap in a refusal's words. @param {number} bytes */
const capWords = (bytes) => (bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.round(bytes / 1024)} KB`);
/** The rule a collection's name follows, in words. */
export const COLLECTION_RULE = "a collection's name is letters, digits, - and _, 40 at most, starting with a letter or a digit (expenses)";

/** A record's id as given — a string or a whole number — or null where it is none. @param {unknown} id */
const idOf = (id) => {
  if (typeof id === "number") return Number.isSafeInteger(id) ? id : null;
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s && s.length <= ID_MAX ? s : null;
};
/** Two ids are one where they read the same: a page's 3 is the agent's "3". @param {unknown} a @param {unknown} b */
const sameId = (a, b) => String(a) === String(b);
/** Whether a value is a JSON object, as against a list, a string or nothing. @param {unknown} x */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";
/** Eight characters of a new id, from [a-z0-9]. */
const newId = () => [...randomBytes(8)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/**
 * @param {{ store: { dir: string, get: (name: string) => unknown, deleted: (name: string) => unknown },
 *   log?: (level: string, msg: string) => void, onChange?: (name: string, news: DataNews) => void, maxBytes?: number,
 *   maxTotalBytes?: number }} o
 *   `store`: the artifacts' store, whose folder this is — data is kept only for an artifact that is there; `onChange`:
 *   told of each change, after the pages that follow it are; `maxBytes`: one collection's most, as its file is written;
 *   `maxTotalBytes`: an artifact's collections' most, together
 */
export function createArtifactData({ store, log = () => {}, onChange = () => {}, maxBytes = COLLECTION_MAX_BYTES, maxTotalBytes = DATA_MAX_BYTES }) {
  /** The pages following each artifact's data. @type {Map<string, Set<(news: DataNews) => void>>} */
  const followers = new Map();
  /** The files already said to be broken, so each is said once. @type {Set<string>} */
  const saidBroken = new Set();

  /** A change kept, told: a listener's failure is said in the log, never undoes it. @param {string} name @param {DataNews} news */
  const tell = (name, news) => {
    for (const fn of followers.get(name) || []) {
      try {
        fn(news);
      } catch (/** @type {any} */ e) {
        log("warn", `artifacts: ${name}'s ${news.collection} changed, but telling a page that follows it failed (${e?.message || e})`);
      }
    }
    try {
      onChange(name, news);
    } catch (/** @type {any} */ e) {
      log("warn", `artifacts: ${name}'s ${news.collection} changed, but telling the harness failed (${e?.message || e})`);
    }
  };

  /** The artifact's data folder, or a refusal where there is no such artifact. @param {string} name @returns {string | DataRefused} */
  const home = (name) => {
    if (store.get(name)) return join(store.dir, name, DATA_DIR);
    return store.deleted(name)
      ? { ok: false, status: 410, error: `${name} was deleted, and its data with it` }
      : { ok: false, status: 404, error: `there is no artifact named ${name}` };
  };

  /**
   * A collection's records, [] where it has none yet, or what is wrong with its file (AFC-96).
   * @param {string} dir @param {string} name @param {string} c @returns {DataRecord[] | DataRefused}
   */
  const read = (dir, name, c) => {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, `${c}.json`), "utf8"));
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return [];
      return broken(name, c, e.message);
    }
    if (raw?.version !== FILE_VERSION || !Array.isArray(raw.records) || !raw.records.every((/** @type {unknown} */ r) => isObject(r) && idOf(/** @type {any} */ (r).id) !== null))
      return broken(name, c, "its file is not one Filament reads");
    return raw.records;
  };
  /** @param {string} name @param {string} c @param {string} why @returns {DataRefused} */
  const broken = (name, c, why) => {
    const key = `${name}/${c}`;
    if (!saidBroken.has(key)) {
      saidBroken.add(key);
      log("warn", `artifacts: ${name}'s data ${c} could not be read (${why})`);
    }
    return { ok: false, status: 500, error: `${c} could not be read from Filament's store (${why}); its other collections are as they were` };
  };
  /**
   * A collection's file as it is written, or null where it is more than one string holds (JSON.stringify's RangeError).
   * @param {DataRecord[]} records @returns {string | null}
   */
  const textOf = (records) => {
    try {
      return JSON.stringify({ version: FILE_VERSION, records });
    } catch (e) {
      if (e instanceof RangeError) return null;
      throw e;
    }
  };
  /** How many bytes a collection's file holds, 0 where it has none. @param {string} dir @param {string} c */
  const sizeOf = (dir, c) => {
    try {
      return statSync(join(dir, `${c}.json`)).size;
    } catch {
      return 0;
    }
  };
  /** How many bytes an artifact's collections hold together, a file that does not read counted as it lies. @param {string} dir */
  const keptBytes = (dir) => {
    let files;
    try {
      files = readdirSync(dir);
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return 0;
      throw e;
    }
    return files.filter(isCollectionFile).reduce((n, f) => n + sizeOf(dir, f.slice(0, -5)), 0);
  };
  /** A collection written whole, beside its file first. @param {string} dir @param {string} c @param {string} text */
  const write = (dir, c, text) => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${c}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, text);
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };
  /** Where a collection's records are, or a refusal. @param {string} name @param {unknown} collection */
  const opened = (name, collection) => {
    const c = collectionName(collection);
    if (!c) return /** @type {DataRefused} */ ({ ok: false, status: 400, error: `${JSON.stringify(collection ?? "")} is no collection: ${COLLECTION_RULE}` });
    const dir = home(name);
    if (typeof dir !== "string") return dir;
    const records = read(dir, name, c);
    return Array.isArray(records) ? { ok: /** @type {const} */ (true), c, dir, records } : records;
  };

  return {
    /**
     * The collections an artifact keeps, each with how many records it holds — or that it could not be read — by name.
     * @param {string} name
     * @returns {{ ok: true, collections: ({ name: string, count: number } | { name: string, error: string })[] } | DataRefused}
     */
    collections(name) {
      const dir = home(name);
      if (typeof dir !== "string") return dir;
      let files;
      try {
        files = readdirSync(dir).filter(isCollectionFile);
      } catch (/** @type {any} */ e) {
        if (e?.code === "ENOENT") return { ok: true, collections: [] };
        throw e;
      }
      return {
        ok: true,
        collections: files.sort().map((f) => {
          const c = f.slice(0, -5);
          const records = read(dir, name, c);
          return Array.isArray(records) ? { name: c, count: records.length } : { name: c, error: records.error };
        }),
      };
    },
    /** A collection's records, in the order they were first kept. @param {string} name @param {unknown} collection */
    list(name, collection) {
      const o = opened(name, collection);
      return o.ok ? { ok: /** @type {const} */ (true), collection: o.c, records: o.records } : o;
    },
    /**
     * One record by its id, null where the collection has none of it.
     * @param {string} name @param {unknown} collection @param {unknown} id
     * @returns {{ ok: true, record: DataRecord | null } | DataRefused}
     */
    get(name, collection, id) {
      const o = opened(name, collection);
      if (!o.ok) return o;
      const want = idOf(id);
      return { ok: true, record: want === null ? null : o.records.find((r) => sameId(r.id, want)) || null };
    },
    /**
     * A change to one collection, all or nothing (AFC-95): its sets, then its updates, then its deletes. A record that
     * is not a JSON object, an id that is none, or an update of an id it has not got refuses the whole change, in words
     * that name it (AFC-88, AFC-89); a delete of one it has not got is said, not refused. One that would leave the
     * collection bigger than it was, and past its cap or the artifact's collections past theirs together, is refused
     * too, 413. Then told, with who made it.
     * @param {string} name @param {unknown} collection @param {DataChange} change @param {string} from
     * @returns {{ ok: true, collection: string, done: DataDone } | DataRefused}
     */
    change(name, collection, change, from) {
      const o = opened(name, collection);
      if (!o.ok) return o;
      const records = [...o.records];
      /** @type {DataDone} */
      const done = { set: [], updated: [], deleted: [], missing: [] };
      /** @param {string} error @returns {DataRefused} */
      const refuse = (error) => ({ ok: false, status: 400, error: `Nothing was kept: ${error}` });
      for (const [i, r] of (change.set || []).entries()) {
        if (!isObject(r)) return refuse(`set's record ${i + 1} is not a JSON object ({ "amount": 12 }), so it cannot be kept`);
        const given = /** @type {Record<string, unknown>} */ (r);
        const id = given.id === undefined || given.id === null || given.id === "" ? null : idOf(given.id);
        if (id === null && given.id !== undefined && given.id !== null && given.id !== "") return refuse(`set's record ${i + 1} has the id ${JSON.stringify(given.id)}: an id is words of ${ID_MAX} characters at most, or a whole number`);
        let made = id;
        while (made === null) {
          const fresh = newId();
          if (!records.some((x) => sameId(x.id, fresh))) made = fresh;
        }
        const kept = /** @type {DataRecord} */ ({ ...given, id: made });
        const at = records.findIndex((x) => sameId(x.id, made));
        if (at >= 0) records[at] = kept;
        else records.push(kept);
        done.set.push(kept);
      }
      for (const [i, u] of (change.update || []).entries()) {
        if (!isObject(u)) return refuse(`update ${i + 1} is not a JSON object: give its id and the fields to change ({ "id": "r1", "amount": 30 })`);
        const fields = /** @type {Record<string, unknown>} */ (u);
        const id = idOf(fields.id);
        if (id === null) return refuse(`update ${i + 1} names no record: give its id with the fields to change`);
        const at = records.findIndex((x) => sameId(x.id, id));
        if (at < 0) return refuse(`${o.c} has no record ${JSON.stringify(id)} to update; set adds one`);
        const kept = /** @type {DataRecord} */ ({ ...records[at], ...fields, id: records[at].id });
        records[at] = kept;
        done.updated.push(kept);
      }
      for (const [i, d] of (change.delete || []).entries()) {
        const id = idOf(d);
        if (id === null) return refuse(`delete's id ${i + 1} (${JSON.stringify(d)}) is no id`);
        const at = records.findIndex((x) => sameId(x.id, id));
        if (at < 0) done.missing.push(id);
        else {
          records.splice(at, 1);
          done.deleted.push(id);
        }
      }
      if (done.set.length || done.updated.length || done.deleted.length) {
        const text = textOf(records);
        const bytes = text === null ? Infinity : Buffer.byteLength(text);
        const was = sizeOf(o.dir, o.c);
        // Past a cap the data may still shrink: a change that leaves its collection no bigger than it was goes through.
        if (text === null || (bytes > was && bytes > maxBytes))
          return { ok: false, status: 413, error: `Nothing was kept: ${o.c} would be more than ${capWords(maxBytes)}, the most one collection keeps; delete records it no longer needs, or keep some in another collection` };
        if (bytes > was && keptBytes(o.dir) - was + bytes > maxTotalBytes)
          return { ok: false, status: 413, error: `Nothing was kept: ${name}'s collections would be more than ${capWords(maxTotalBytes)} together, the most one artifact keeps; delete records it no longer needs` };
        write(o.dir, o.c, text);
        saidBroken.delete(`${name}/${o.c}`);
        tell(name, { collection: o.c, from });
      }
      return { ok: true, collection: o.c, done };
    },
    /**
     * Follow an artifact's data: told of each change to it, whoever made it (AFC-92). The returned function stops it.
     * @param {string} name @param {(news: DataNews) => void} fn
     */
    follow(name, fn) {
      const set = followers.get(name) || new Set();
      set.add(fn);
      followers.set(name, set);
      return () => {
        set.delete(fn);
        if (!set.size) followers.delete(name);
      };
    },
  };
}

/** @typedef {ReturnType<typeof createArtifactData>} ArtifactData */
