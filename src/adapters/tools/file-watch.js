// @ts-check
// A folder's files watched (the plan of 11-11, its v2-a): which of the files a caller's `match` takes appeared, changed
// or went under a folder, told in one batch once none of them moved for the settle. What it knows is a walk's: each
// matching file's size and time, by its path, held against the walk before — no file is opened, and nothing a file
// holds is read. fs.watch is a hint and no more: a change it says brings the next walk within moments, and a walk each
// minute besides finds what no hint said. So where fs.watch is not to be had — it throws, it errors, the folder is on
// the network, where it is not asked for and the walk comes each half minute — the walk alone goes on, and nothing is
// said of it. What moved is told once a walk finds every file as the walk before left it, the settle apart: a storm of
// saves, or a copy of many files, is one batch of what stands at its end, and a file made and removed inside it is none.
// Files that keep moving are told as they stand after ten minutes (`MOVING_MOST_MS`), and again as long after: one
// written without end — a log — silences none of the others.
// The walk is the file hands' (hands.js `glob`): the folders its caller names are passed over below where it begins,
// `.git` always; a link is listed by its own name, size and time and never followed, the folder it begins at included;
// a folder that cannot be read is passed over; past its most files — counted as they are met, matching or not — it
// stops, and says so (`WALK_MAX_FILES`). The first look that goes well is where it listens from; after a time away
// (`since`) it tells, as changed, each file written since, by its time alone.
// The costs: each watch walks its folder each minute and after each burst of hints — a listing of every folder not
// passed over and a look at each match's size and time —, a hint of any file there, matching or not, since a hint
// does not say whether it names a file or a folder of them. A write that leaves a file's size and time as they were is
// not seen, nor one made and undone between two walks. A storm longer than ten minutes is told in pieces, a piece each
// ten minutes. Past the most files, those past them by path are not watched; a file that goes is not told (it may only have fallen past the cap) and one that appears is told only where it was
// written since the last batch. A file brought in with an old time is told while it is watched, and not after a time
// away; what went in a time away is never told. On Windows fs.watch holds its folder open: the folders above a watched
// one cannot be renamed or moved meanwhile, as under any editor that watches a folder.
import { watch as fsWatch } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { onNetwork } from "../git/watch.js";

/** The most files a walk looks at, as the file hands' glob (hands.js `GLOB_WALK_MAX_FILES`). */
export const WALK_MAX_FILES = 20_000;
/** How often a folder is walked besides its hints, for a change no hint said. */
export const SAFETY_WALK_MS = 60_000;
/** How often a folder on the network is walked: no fs.watch is asked of it. */
export const SLOW_WALK_MS = 30_000;
/** How long after a hint its walk comes: a burst of them is one walk. */
export const HINT_MS = 250;
/** How long files that keep moving wait to be told, at most: one written without end silences none of the others. */
export const MOVING_MOST_MS = 600_000;
/** How many of a folder's matches have their size and time looked at side by side. */
const LOOKS_AT_ONCE = 16;

/**
 * @typedef {{ size: number, mtimeMs: number }} FileLook  a file as a walk saw it: its size, and when it was last written
 * @typedef {{ path: string, size: number, mtimeMs: number }} FileMoved  a file told, by its path from where the walk begins
 * @typedef {{ name: string, isDirectory: () => boolean, isFile: () => boolean, isSymbolicLink: () => boolean }} Entry
 * @typedef {{ readdir: (dir: string) => Promise<Entry[]>, lstat: (path: string) => Promise<FileLook> }} WalkFs  the
 *   disk as a walk reads it: a folder's entries, and a file's own size and time — a link's, never what it leads to
 * @typedef {{ files: Map<string, FileLook>, over: boolean, rooted: boolean }} Walked  each match by its path from
 *   where the walk begins; `over`: there were more files than it looks at; `rooted`: the folder it begins at is there
 * @typedef {{ at: number, first: boolean, away: boolean, added: FileMoved[], changed: FileMoved[], removed: (FileMoved & { gone: { from: number, to: number } })[] }} Batch
 *   what moved, each list by path, as of the look begun at `at`. `first`: the look it listens from — nothing of it is
 *   news but, after a time away (`away`), the files written since, as `changed`. A file gone is as it was last seen,
 *   `gone` the while it went in: from the look that last saw it to the end of the first that did not
 * @typedef {{ ok: true, over: boolean, max: number } | { ok: false, gone: boolean, error: string }} Looked  how a look
 *   went: well — `over`, past the `max` files it looks at —, or not: `gone`, its folder is not there or is no folder;
 *   `error`, the failure's first line
 */

/** @type {WalkFs} */
const DISK = { readdir: (dir) => readdir(dir, { withFileTypes: true }), lstat: (path) => lstat(path) };
/** Timers that keep no process up. @type {{ set: (fn: () => void, ms: number) => unknown, clear: (timer: any) => void }} */
const TIMERS = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clear: (t) => clearTimeout(t),
};
/**
 * fs.watch of a folder and all below it, keeping no process up: each change by its path from the folder, "" where the
 * system names none. Thrown from where it is not to be had.
 * @param {string} dir @param {(name: string) => void} onHint @param {() => void} onError @returns {{ close: () => void }}
 */
const hintOf = (dir, onHint, onError) => {
  const w = fsWatch(dir, { recursive: true, persistent: false }, (_event, name) => onHint(name == null ? "" : String(name)));
  w.on("error", onError);
  return w;
};

/** A repository's own folder, or the file a worktree has in its place, by its name. @param {string} name */
const isGit = (name) => name.toLowerCase() === ".git";
/** A folder that is not there, or is no folder. @param {any} e */
const isGone = (e) => e?.code === "ENOENT" || e?.code === "ENOTDIR";

/**
 * The files under a folder that `match` takes, each with its size and time. It begins at `under`, a path of folders
 * below `place`, each found by its own name among its folder's entries — in another case where none has it exactly —
 * and none of them a link: where one is not there, nothing matches (`rooted` false). Below it, a folder's own files
 * come first, by name, then its folders in order; a folder named in `skip`, and `.git`, is not entered; a link is
 * listed as a file and never followed; a folder that cannot be read is passed over. The files met are counted,
 * matching or not: past `max` it stops (`over`), so what it looks at is the same files at each walk while none moves.
 * Thrown from where `place` itself cannot be read.
 * @param {string} place
 * @param {{ under?: string, match: (path: string) => boolean, skip?: readonly string[], max?: number, fs?: WalkFs }} o
 *   `match`: by a file's path from where the walk begins, its names joined with /
 * @returns {Promise<Walked>}
 */
export async function walkFiles(place, { under = "", match, skip = [], max = WALK_MAX_FILES, fs = DISK }) {
  const passed = new Set(skip);
  /** @type {Map<string, FileLook>} */
  const files = new Map();
  let root = place;
  let entries = await fs.readdir(place);
  for (const name of under.split("/").filter(Boolean)) {
    const e = entries.find((x) => x.name === name) ?? entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!e || !e.isDirectory()) return { files, over: false, rooted: false };
    root = join(root, e.name);
    try {
      entries = await fs.readdir(root);
    } catch (/** @type {any} */ err) {
      if (isGone(err)) return { files, over: false, rooted: false };
      throw err;
    }
  }
  let met = 0;
  let over = false;
  /** @param {string} dir @param {string} rel  its path from the root, "" for the root @param {Entry[]} list */
  const walk = async (dir, rel, list) => {
    const sorted = [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    /** @type {{ path: string, full: string }[]} */
    const here = [];
    for (const e of sorted) {
      if (e.isDirectory() || !(e.isFile() || e.isSymbolicLink()) || isGit(e.name)) continue;
      if (met >= max) {
        over = true;
        break;
      }
      met += 1;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (match(path)) here.push({ path, full: join(dir, e.name) });
    }
    for (let i = 0; i < here.length; i += LOOKS_AT_ONCE)
      await Promise.all(
        here.slice(i, i + LOOKS_AT_ONCE).map(async (f) => {
          // One gone since its folder was listed is not there.
          const s = await fs.lstat(f.full).catch(() => null);
          if (s) files.set(f.path, { size: s.size, mtimeMs: s.mtimeMs });
        }),
      );
    for (const e of sorted) {
      if (over) return;
      if (!e.isDirectory() || isGit(e.name) || passed.has(e.name)) continue;
      const below = await fs.readdir(join(dir, e.name)).catch(() => null);
      if (below) await walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, below);
    }
  };
  await walk(root, "", entries);
  return { files, over, rooted: true };
}

/** A walk's files, by path. @param {Map<string, FileLook>} files @returns {FileMoved[]} */
const byPath = (files) => [...files].map(([path, f]) => ({ path, size: f.size, mtimeMs: f.mtimeMs })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
/** Whether two walks saw the same files, each as it was. @param {Map<string, FileLook>} a @param {Map<string, FileLook>} b */
const sameFiles = (a, b) => a.size === b.size && [...a].every(([path, f]) => b.get(path)?.size === f.size && b.get(path)?.mtimeMs === f.mtimeMs);

/**
 * A folder watched: `onMoved` hears its first look that went well, and after it each batch of what moved, once still
 * for `settleMs`; `onLooked`, how its looks go, said where that changes: its folder gone or unread, read again, past
 * its most files or under them. `look` walks now (a walk under way is that look); `settled`, once no walk is under
 * way; `mode`, whether an fs.watch hints it ("hint") or the walk goes alone ("walk"); `stop` ends it, leaving no timer
 * and no fs.watch.
 * @param {string} place
 * @param {{ under?: string, match: (path: string) => boolean, skip?: readonly string[], settleMs: number, since?: number | null,
 *   onMoved: (batch: Batch) => void, onLooked?: (looked: Looked) => void, max?: number, safetyMs?: number, slowMs?: number, hintMs?: number, mostMs?: number,
 *   network?: boolean, now?: () => number, timers?: typeof TIMERS, watch?: typeof hintOf, walk?: typeof walkFiles }} o
 *   `under`, `match`, `skip`, `max`: the walk's (`walkFiles`); `since`: when it was last looked at before a time away —
 *   its first look tells the files written since; `mostMs`: how long files that keep moving wait to be told, at most;
 *   `network`: no fs.watch, a walk each `slowMs`; `now`, `timers`, `watch`, `walk`: the clock, the timers, fs.watch
 *   and the walk (the tests' stand-ins)
 */
export function watchFolder(place, { under = "", match, skip = [], settleMs, since = null, onMoved, onLooked = () => {}, max = WALK_MAX_FILES, safetyMs = SAFETY_WALK_MS, slowMs = SLOW_WALK_MS, hintMs = HINT_MS, mostMs = MOVING_MOST_MS, network = onNetwork(place), now = Date.now, timers = TIMERS, watch = hintOf, walk = walkFiles }) {
  const root = under ? join(place, under) : place;
  const passed = new Set(skip);
  const every = network ? slowMs : safetyMs;
  let stopped = false;
  /** The files as the last walk that went well saw them; null before the first. @type {Map<string, FileLook> | null} */
  let known = null;
  /** The files as they were last told, when that look began, and whether it was past the most files. @type {Map<string, FileLook>} */
  let told = new Map();
  let toldAt = 0;
  let toldOver = false;
  /** When a walk last found the files other than the walk before left them; null while they are as told. @type {number | null} */
  let movedAt = null;
  /** When a walk first found them moved since they were last told; null while they are as told. @type {number | null} */
  let movingSince = null;
  /** Each file told and seen no more: the while it went in. @type {Map<string, { from: number, to: number }>} */
  const went = new Map();
  /** When the last walk that went well began, when the last walk ended, and how long it took. */
  let lookedAt = 0;
  let endedAt = 0;
  let took = 0;
  /** What `onLooked` heard last. */
  let said = "";
  /** The fs.watch that hints, and whether one was asked and is not to be had while the folder stands. @type {{ close: () => void } | null} */
  let hint = null;
  let hintless = false;
  /** The walk that waits: its timer and when it comes. @type {unknown} */
  let timer = null;
  /** @type {number | null} */
  let dueAt = null;
  /** @type {Promise<void> | null} */
  let walking = null;
  /** A hint came while a walk was under way. */
  let again = false;

  /** @param {Looked} looked */
  const say = (looked) => {
    const sig = JSON.stringify(looked);
    if (sig === said) return;
    said = sig;
    try {
      onLooked(looked);
    } catch {
      // Its hearer's own: the watch goes on.
    }
  };
  /** @param {Batch} batch */
  const tell = (batch) => {
    try {
      onMoved(batch);
    } catch {
      // Its hearer's own: the watch goes on.
    }
  };
  const unhint = () => {
    const h = hint;
    hint = null;
    try {
      h?.close();
    } catch {
      // Closed already.
    }
  };
  /** The next walk, `ms` from now: one that waits is brought forward, never put off. @param {number} ms */
  const walkIn = (ms) => {
    const at = now() + Math.max(0, ms);
    if (stopped || (dueAt !== null && dueAt <= at)) return;
    if (dueAt !== null) timers.clear(timer);
    dueAt = at;
    timer = timers.set(() => {
      dueAt = null;
      void look();
    }, Math.max(0, ms));
  };
  /** How long after now a hint's walk comes: within moments, and after a walk no sooner than ten times what it took. */
  const hintIn = () => Math.max(hintMs, endedAt + Math.max(hintMs, 10 * took) - now());
  /**
   * A change the system says: a walk soon. None for a path through a folder the walk passes over, nor while it waits
   * for the files to be still — that walk is set. @param {string} name  its path from the watched folder, "" where unsaid
   */
  const hinted = (name) => {
    if (stopped || movedAt !== null) return;
    if (name.split(/[\\/]+/).some((n) => n && (isGit(n) || passed.has(n)))) return;
    if (walking) again = true;
    else walkIn(hintIn());
  };
  /** An fs.watch asked of the folder the walk begins at; where it is not to be had the walk goes alone. */
  const hintFrom = () => {
    /** @type {{ close: () => void } | null} */
    let h = null;
    try {
      h = watch(root, hinted, () => {
        hintless = true;
        if (h && hint === h) unhint();
      });
      // One that errored as it was asked is let go.
      if (hintless) h.close();
      else hint = h;
    } catch {
      hintless = true;
    }
  };

  /**
   * What a walk saw, held against the walk before and against what was last told.
   * @param {Walked} seen @param {number} began @param {number} ended
   */
  const found = (seen, began, ended) => {
    say({ ok: true, over: seen.over, max });
    // Its folder gone, its fs.watch is let go: asked anew once it is there.
    if (!seen.rooted) {
      unhint();
      hintless = false;
    } else if (!hint && !hintless && !network) hintFrom();
    const files = seen.files;
    if (!known) {
      known = told = files;
      toldAt = lookedAt = began;
      toldOver = seen.over;
      // A file dated past this look is none: it would be told at each start until its date came.
      const changed = since == null ? [] : byPath(files).filter((f) => f.mtimeMs > since && f.mtimeMs <= ended);
      return tell({ at: began, first: true, away: since != null, added: [], changed, removed: [] });
    }
    const same = sameFiles(known, files);
    for (const path of known.keys()) if (!files.has(path) && told.has(path)) went.set(path, { from: lookedAt, to: ended });
    for (const path of files.keys()) went.delete(path);
    known = files;
    lookedAt = began;
    if (!same) {
      movedAt = ended;
      movingSince ??= ended;
      // Moving for longer than it waits at most: what stands is told, so files that never rest silence none.
      if (ended - movingSince < mostMs) return;
    } else if (movedAt === null || began - movedAt < settleMs) return;
    // Past the most files, at this look or at the one last told: a file not seen may only lie past them, and one seen
    // may only have come inside them — told where it was written since.
    const capped = toldOver || seen.over;
    const was = told;
    const added = byPath(files).filter((f) => !was.has(f.path) && (!capped || f.mtimeMs > toldAt));
    const changed = byPath(files).filter((f) => was.has(f.path) && (was.get(f.path)?.size !== f.size || was.get(f.path)?.mtimeMs !== f.mtimeMs));
    const removed = capped ? [] : byPath(was).filter((f) => !files.has(f.path)).map((f) => ({ ...f, gone: went.get(f.path) ?? { from: toldAt, to: ended } }));
    told = files;
    toldAt = began;
    toldOver = seen.over;
    movedAt = movingSince = null;
    went.clear();
    if (added.length || changed.length || removed.length) tell({ at: began, first: false, away: false, added, changed, removed });
  };

  /** One walk, and what it saw taken in; a walk under way is the one asked for. @returns {Promise<void>} */
  function look() {
    if (stopped) return Promise.resolve();
    if (walking) return walking;
    if (dueAt !== null) timers.clear(timer);
    dueAt = null;
    again = false;
    walking = (async () => {
      const began = now();
      try {
        const seen = await walk(place, { under, match, skip, max });
        if (stopped) return;
        endedAt = now();
        took = endedAt - began;
        found(seen, began, endedAt);
      } catch (/** @type {any} */ e) {
        if (stopped) return;
        endedAt = now();
        took = endedAt - began;
        // Its folder gone, its fs.watch is let go: asked anew once it is there.
        if (isGone(e)) {
          unhint();
          hintless = false;
        }
        say({ ok: false, gone: isGone(e), error: String(e?.message || e).split(/\r?\n/)[0].slice(0, 200) });
        // Walked again at its own pace, whatever waited to be still.
        return void walkIn(every);
      }
      // Still to be told: once the settle is over. A hint meanwhile: a walk soon. Else at its own pace.
      walkIn(movedAt !== null ? movedAt + settleMs - now() : again ? hintIn() : every);
    })().finally(() => {
      walking = null;
    });
    return walking;
  }
  void look();

  return {
    look,
    settled: async () => {
      while (walking) await walking;
    },
    mode: () => (hint ? "hint" : "walk"),
    stop() {
      stopped = true;
      if (dueAt !== null) timers.clear(timer);
      dueAt = null;
      unhint();
    },
  };
}

/** @typedef {ReturnType<typeof watchFolder>} FolderWatch */
