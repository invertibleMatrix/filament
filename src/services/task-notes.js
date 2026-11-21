// @ts-check
// What the agent keeps behind its task graph (HarnessV4_TaskNotes_Plan E33): behind each task — and behind the graph
// itself, for what the whole work needs — notes, each a long text under a title of its own, and files copied in (a
// screenshot, a picture an agent drew, a document). They live on disk with the chat, never in its record nor in the
// conversation (TN-D1): a compaction or a restart loses none of them, and none weighs on the context until it is read.
// Each graph keeps its own — a new graph whose ids repeat an old one's starts with nothing — and a deleted chat takes
// its with it. One folder a task: `<dir>/<chat>/<graph's start>/<task, or _graph>/`, its `index.json` saying what it
// holds, its notes in `notes/`, its files in `files/`. Every write is whole or not at all.
import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

/** How much may be kept (TN cases 13): refused past each, in words. */
export const NOTES_LIMITS = Object.freeze({ title: 120, text: 200_000, notes: 50, files: 20, fileBytes: 10 * 1024 * 1024, chainBytes: 200 * 1024 * 1024 });
/** The folder of what is kept behind the graph itself: no task's id starts with `_`. */
const GRAPH = "_graph";
/** A chat's id, a graph's start and a task's id as folder names: anything else is no folder of this store's. */
const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * @typedef {{ title: string, n: number, chars: number, at: number, by: string, first: string }} NoteRow  one note, as its
 *   index lists it: its file is `notes/<n>.md`; `first` its first line, for a list
 * @typedef {{ name: string, bytes: number, at: number, by: string }} FileRow  one file, as its index lists it
 * @typedef {{ seq: number, notes: NoteRow[], files: FileRow[] }} Index
 * @typedef {{ notes: number, files: number, bytes: number, titles: string[] }} Count  what one task holds: `titles`, its
 *   notes' titles and its files' names, in the order kept — what the graph's words after a compaction name (11-09)
 */

/** The characters a kept file's name is made of (`fileName`): any other in a name given is a `_`. */
const NAME_CHARS = /^[A-Za-z0-9._ ()+,=@-]{1,120}$/;
/**
 * Whether a name is one `fileName` gives, the one rule for a kept file's name: one plain name of its characters — a
 * person's screenshot's, its spaces, capitals and dots kept — never a path: no separator, and not dots and spaces
 * alone, which name the folder it is in or the one above (`.`, `..`, and on Windows `. .` too).
 * @param {unknown} n @returns {n is string}
 */
const isFileName = (n) => typeof n === "string" && NAME_CHARS.test(n) && /[^. ]/.test(n);

/** A file's name as this store keeps it: its last part, plain characters, never empty or dots alone. @param {string} name */
export function fileName(name) {
  const n = basename(String(name || "").replace(/\\/g, "/"))
    .replace(/[^A-Za-z0-9._ ()+,=@-]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return isFileName(n) ? n : "file";
}
/** A title on one line, its spaces squashed. @param {unknown} t */
export const titleOf = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
/** Its first line, short, for a list. @param {string} text */
const firstOf = (text) => {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};
/** A title matched as the agent gives it: case and spacing aside. @param {string} a @param {string} b */
const same = (a, b) => titleOf(a).toLowerCase() === titleOf(b).toLowerCase();

/**
 * @param {{ dir: string | null, now?: () => number, log?: (level: string, msg: string) => void }} o  `dir`: where it
 *   keeps them — `<dataDir>/task-notes`; null keeps nothing, every keep refused in words
 */
export function createTaskNotes({ dir, now = Date.now, log = () => {} }) {
  /** @param {string} chain @param {number} graph @param {string | null} task */
  const folder = (chain, graph, task) => {
    const g = String(Math.trunc(Number(graph) || 0));
    const t = task || GRAPH;
    if (!dir || !SAFE.test(chain) || !SAFE.test(g) || !SAFE.test(t)) return null;
    return join(dir, chain, g, t);
  };
  // This store is the only writer of its folders, and every graph's page asks what each of its tasks holds at each
  // change of the graph: each folder's index is read from disk once, and kept as it is written after — as is what each
  // graph's folder holds and what each chat keeps in all. A hand edit to the folders is not seen until Filament starts
  // again. A read that failed for another reason than the file not being there, or not being JSON, is not kept: it is
  // tried again, and no keep writes an index over the notes it could not see.
  /** Each task folder's index, by its folder. @type {Map<string, Index>} */
  const indexes = new Map();
  /** The task folders each graph's folder holds, by that folder: listed once. @type {Map<string, Set<string>>} */
  const listed = new Map();
  /** What each chat keeps, every graph and task of it: walked once. @type {Map<string, number>} */
  const totals = new Map();
  /**
   * An index's rows of a kind as this store writes them: a note's number a whole number (`notes/<n>.md`), a file's name
   * one `fileName` gives (`files/<name>`), each read, written over and removed by that — so no code past this read
   * holds a row that is a path. One left out is said in the log, once, as an index is read from disk once; the index
   * loses it at its next write, and its file, if any, stays where it is.
   * @param {string} f  the task's folder @param {unknown} rows @param {"note" | "file"} kind @returns {any[]}
   */
  const rowsOf = (f, rows, kind) =>
    (Array.isArray(rows) ? rows : []).filter((r) => {
      if (kind === "note" ? Number.isSafeInteger(r?.n) && r.n > 0 : isFileName(r?.name)) return true;
      const shown = JSON.stringify(String(kind === "note" ? r?.title : r?.name).slice(0, 64));
      const at = dir ? relative(dir, f).split(sep).join("/") : f;
      log("warn", `task notes: ${at}/index.json lists a ${kind} whose ${kind === "note" ? "number" : "name"} is none this store makes (its ${kind === "note" ? "title" : "name"}: ${shown}). It is left out, and nothing is read, written or removed by it.`);
      return false;
    });
  /**
   * A task folder's index, or why it could not be read just now: what a keep must not write over.
   * @param {string | null} f @returns {Index | { unread: string }}
   */
  const readIndex = (f) => {
    if (!f) return { seq: 0, notes: [], files: [] };
    const kept = indexes.get(f);
    if (kept) return kept;
    /** @type {Index} */
    let ix;
    try {
      const j = JSON.parse(readFileSync(join(f, "index.json"), "utf8"));
      ix = { seq: Number(j.seq) || 0, notes: rowsOf(f, j.notes, "note"), files: rowsOf(f, j.files, "file") };
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT" && !(e instanceof SyntaxError)) return { unread: String(e?.code || e?.message || e) };
      ix = { seq: 0, notes: [], files: [] };
    }
    indexes.set(f, ix);
    return ix;
  };
  /** What a task folder's index lists: nothing while it cannot be read. @param {string | null} f @returns {Index} */
  const indexOf = (f) => {
    const ix = readIndex(f);
    return "unread" in ix ? { seq: 0, notes: [], files: [] } : ix;
  };
  /** A keep refused while its folder's index could not be read. @param {string | null} task @param {string} why */
  const unreadWords = (task, why) => `what ${task || "the graph"} keeps could not be read just now (${why}), so nothing was kept over it: keep it again`;
  /** How much an index says its task keeps. @param {Index} ix */
  const bytesOf = (ix) => ix.notes.reduce((s, n) => s + (Number(n.chars) || 0), 0) + ix.files.reduce((s, x) => s + (Number(x.bytes) || 0), 0);
  /** A folder's names of this store's: none where the folder is not there, null where it could not be listed. @param {string} p */
  const listOf = (p) => {
    try {
      return readdirSync(p).filter((n) => SAFE.test(n));
    } catch (/** @type {any} */ e) {
      return e?.code === "ENOENT" ? [] : null;
    }
  };
  /** The task folders a graph's folder holds. @param {string} g @returns {Set<string>} */
  const tasksIn = (g) => {
    const kept = listed.get(g);
    if (kept) return kept;
    const names = listOf(g);
    if (!names) return new Set();
    const set = new Set(names);
    listed.set(g, set);
    return set;
  };
  /** Whole or not at all. @param {string} path @param {string | Uint8Array} data */
  const put = (path, data) => {
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, data);
      renameSync(tmp, path);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };
  /**
   * A task's folder's index written, and kept as written: its graph's folder holds the task from now on, and its chat's
   * total moves by what the task keeps more or less.
   * @param {string} chain @param {string} f @param {Index} ix
   */
  const saveIndex = (chain, f, ix) => {
    const was = indexOf(f);
    put(join(f, "index.json"), JSON.stringify(ix, null, 1));
    indexes.set(f, ix);
    listed.get(dirname(f))?.add(basename(f));
    const total = totals.get(chain);
    if (total !== undefined) totals.set(chain, total - bytesOf(was) + bytesOf(ix));
  };
  /** How much a chat keeps, every graph and task of it. @param {string} chain */
  const chainBytes = (chain) => {
    if (!dir || !SAFE.test(chain)) return 0;
    const kept = totals.get(chain);
    if (kept !== undefined) return kept;
    const root = join(dir, chain);
    const graphs = listOf(root);
    let total = 0;
    // Kept only where every folder was listed and every index read: one that failed is tried again next time.
    let whole = graphs !== null;
    for (const g of graphs || []) {
      for (const t of tasksIn(join(root, g))) {
        total += bytesOf(indexOf(join(root, g, t)));
        whole &&= indexes.has(join(root, g, t));
      }
      whole &&= listed.has(join(root, g));
    }
    if (whole) totals.set(chain, total);
    return total;
  };
  /** Why one more of `bytes` would pass what a chat keeps, or null. @param {string} chain @param {number} bytes @param {number} freed */
  const overChain = (chain, bytes, freed) =>
    chainBytes(chain) - freed + bytes > NOTES_LIMITS.chainBytes ? `this chat keeps ${Math.round(NOTES_LIMITS.chainBytes / 1048576)} MB of notes and files at most: forget some first` : null;

  return {
    /** Whether it keeps anything: a store with no folder refuses every keep. */
    on: !!dir,
    /**
     * What a task holds — or the graph itself, `task` null — notes and files, in the order kept.
     * @param {string} chain @param {number} graph @param {string | null} task
     * @returns {{ notes: NoteRow[], files: FileRow[] }}
     */
    list(chain, graph, task) {
      const ix = indexOf(folder(chain, graph, task));
      return { notes: ix.notes.map((n) => ({ ...n })), files: ix.files.map((x) => ({ ...x })) };
    },
    /**
     * What each task of a graph holds, by its id — the graph's own under "" — for the graph's words and its page; a task
     * that holds nothing is not there.
     * @param {string} chain @param {number} graph @returns {Record<string, Count>}
     */
    counts(chain, graph) {
      const root = folder(chain, graph, null);
      if (!root) return {};
      /** @type {Record<string, Count>} */
      const out = {};
      const g = dirname(root);
      for (const t of tasksIn(g)) {
        const ix = indexOf(join(g, t));
        if (!ix.notes.length && !ix.files.length) continue;
        out[t === GRAPH ? "" : t] = { notes: ix.notes.length, files: ix.files.length, bytes: bytesOf(ix), titles: [...ix.notes.map((n) => n.title), ...ix.files.map((x) => x.name)] };
      }
      return out;
    },
    /**
     * A note kept whole under its title; one of that title, case and spacing aside, is replaced (TN-D3). → how many
     * characters the one it replaced had, or null; a refusal in words where a limit stops it.
     * @param {string} chain @param {number} graph @param {string | null} task @param {{ title: string, text: string, by: string }} n
     * @returns {{ ok: true, replaced: number | null } | { ok: false, error: string }}
     */
    keepNote(chain, graph, task, { title, text, by }) {
      const f = folder(chain, graph, task);
      if (!f) return { ok: false, error: "nothing can be kept here: this Filament keeps no notes" };
      const ix = readIndex(f);
      if ("unread" in ix) return { ok: false, error: unreadWords(task, ix.unread) };
      const was = ix.notes.find((n) => same(n.title, title)) || null;
      if (!was && ix.notes.length >= NOTES_LIMITS.notes) return { ok: false, error: `${task ? `${task} holds` : "the graph holds"} ${NOTES_LIMITS.notes} notes already: forget one, or keep this under one's title` };
      const over = overChain(chain, text.length, was?.chars || 0);
      if (over) return { ok: false, error: over };
      mkdirSync(join(f, "notes"), { recursive: true });
      const n = was ? was.n : ix.seq + 1;
      put(join(f, "notes", `${n}.md`), text);
      const row = { title: titleOf(title), n, chars: text.length, at: now(), by, first: firstOf(text) };
      saveIndex(chain, f, { seq: Math.max(ix.seq, n), notes: was ? ix.notes.map((x) => (x === was ? row : x)) : [...ix.notes, row], files: ix.files });
      return { ok: true, replaced: was ? was.chars : null };
    },
    /**
     * A file kept under its own name (`fileName`); one of that name is replaced. → the name it is kept under, and the size
     * of the one it replaced; a refusal in words where a limit stops it.
     * @param {string} chain @param {number} graph @param {string | null} task @param {{ name: string, data: Uint8Array, by: string }} x
     * @returns {{ ok: true, name: string, replaced: number | null } | { ok: false, error: string }}
     */
    keepFile(chain, graph, task, { name, data, by }) {
      const f = folder(chain, graph, task);
      if (!f) return { ok: false, error: "nothing can be kept here: this Filament keeps no notes" };
      const kept = fileName(name);
      if (data.length > NOTES_LIMITS.fileBytes) return { ok: false, error: `${kept} is ${Math.round(data.length / 1048576)} MB: a file kept here is ${Math.round(NOTES_LIMITS.fileBytes / 1048576)} MB at most` };
      const ix = readIndex(f);
      if ("unread" in ix) return { ok: false, error: unreadWords(task, ix.unread) };
      const was = ix.files.find((x) => x.name.toLowerCase() === kept.toLowerCase()) || null;
      if (!was && ix.files.length >= NOTES_LIMITS.files) return { ok: false, error: `${task ? `${task} holds` : "the graph holds"} ${NOTES_LIMITS.files} files already: forget one first` };
      const over = overChain(chain, data.length, was?.bytes || 0);
      if (over) return { ok: false, error: over };
      mkdirSync(join(f, "files"), { recursive: true });
      if (was && was.name !== kept) rmSync(join(f, "files", was.name), { force: true });
      put(join(f, "files", kept), data);
      const row = { name: kept, bytes: data.length, at: now(), by };
      saveIndex(chain, f, { seq: ix.seq, notes: ix.notes, files: was ? ix.files.map((x) => (x === was ? row : x)) : [...ix.files, row] });
      return { ok: true, name: kept, replaced: was ? was.bytes : null };
    },
    /**
     * A note by its title, or a file by its name, taken away. → which it was, or null where neither is kept.
     * @param {string} chain @param {number} graph @param {string | null} task @param {string} key
     * @returns {"note" | "file" | null}
     */
    forget(chain, graph, task, key) {
      const f = folder(chain, graph, task);
      if (!f) return null;
      const ix = indexOf(f);
      const note = ix.notes.find((n) => same(n.title, key));
      if (note) {
        rmSync(join(f, "notes", `${note.n}.md`), { force: true });
        saveIndex(chain, f, { ...ix, notes: ix.notes.filter((n) => n !== note) });
        return "note";
      }
      const file = ix.files.find((x) => x.name.toLowerCase() === titleOf(key).toLowerCase() || x.name.toLowerCase() === fileName(key).toLowerCase());
      if (file) {
        rmSync(join(f, "files", file.name), { force: true });
        saveIndex(chain, f, { ...ix, files: ix.files.filter((x) => x !== file) });
        return "file";
      }
      return null;
    },
    /**
     * A note whole, by its title. @param {string} chain @param {number} graph @param {string | null} task @param {string} title
     * @returns {(NoteRow & { text: string }) | null}
     */
    note(chain, graph, task, title) {
      const f = folder(chain, graph, task);
      const row = f ? indexOf(f).notes.find((n) => same(n.title, title)) : null;
      if (!f || !row) return null;
      try {
        return { ...row, text: readFileSync(join(f, "notes", `${row.n}.md`), "utf8") };
      } catch {
        return null;
      }
    },
    /**
     * A file kept, by its name: where it is on disk and its size. @param {string} chain @param {number} graph
     * @param {string | null} task @param {string} name @returns {(FileRow & { path: string }) | null}
     */
    file(chain, graph, task, name) {
      const f = folder(chain, graph, task);
      const key = titleOf(name).toLowerCase();
      const row = f ? indexOf(f).files.find((x) => x.name.toLowerCase() === key || x.name.toLowerCase() === fileName(name).toLowerCase()) : null;
      if (!f || !row) return null;
      const path = join(f, "files", row.name);
      try {
        return statSync(path).isFile() ? { ...row, path } : null;
      } catch {
        return null;
      }
    },
    /**
     * What a chat's graph keeps, behind it and its tasks, copied to another chat's under the same graph (the owner's plan
     * mode of 11-06, piece E: a plan carried into a new chat) — each file its own copy, shared on disk only where the
     * disk clones it, so a keep in either chat never reaches the other's. → how many files. Throws where a copy failed.
     * @param {string} from @param {string} to @param {number} graph
     */
    copy(from, to, graph) {
      const g = String(Math.trunc(Number(graph) || 0));
      if (!dir || !SAFE.test(from) || !SAFE.test(to) || !SAFE.test(g)) return 0;
      let n = 0;
      /** @param {string} a @param {string} b */
      const walk = (a, b) => {
        /** @type {import("node:fs").Dirent[]} */
        let names;
        try {
          names = readdirSync(a, { withFileTypes: true });
        } catch (/** @type {any} */ e) {
          if (e?.code === "ENOENT") return;
          throw e;
        }
        mkdirSync(b, { recursive: true });
        for (const e of names) {
          if (e.isDirectory()) walk(join(a, e.name), join(b, e.name));
          else if (e.isFile()) {
            copyFileSync(join(a, e.name), join(b, e.name), constants.COPYFILE_FICLONE);
            n++;
          }
        }
      };
      walk(join(dir, from, g), join(dir, to, g));
      // What this store knew of the chat it went to is read again.
      const root = join(dir, to);
      for (const kept of [indexes, listed]) for (const f of kept.keys()) if (f === root || f.startsWith(root + sep)) kept.delete(f);
      totals.delete(to);
      return n;
    },
    /** Everything a chat kept, gone with it (TN cases 12). @param {string} chain */
    drop(chain) {
      if (!dir || !SAFE.test(chain)) return;
      const root = join(dir, chain);
      rmSync(root, { recursive: true, force: true });
      for (const kept of [indexes, listed]) for (const f of kept.keys()) if (f.startsWith(root + sep)) kept.delete(f);
      totals.delete(chain);
    },
  };
}

/** @typedef {ReturnType<typeof createTaskNotes>} TaskNotes */
