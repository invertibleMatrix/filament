// @ts-check
// A folder's files as a watcher's trigger (the plan of 11-11, its v2-a). Each watcher of a file trigger that is on and
// not paused has its folder watched (adapters/tools/file-watch.js `watchFolder`: a walk that holds each matching file's
// size and time against the walk before, fs.watch only a hint): its place — a place not whole read from its project's
// folder —, else that folder, and from there the folders its glob names before any of its marks (core/watchers.js
// `globHead`), so a glob of one folder walks that folder alone. A place is watched only where it is a folder of its
// project (app/watchers/commits.js `placeAmong`, of the folders `foldersOf` says, read once for each time it is
// switched on or resumed), and never inside a repository's own .git: any other is the watcher's trouble, and nothing
// there is read. One that is no folder yet is looked for again each minute.
// The first look is where it listens from. After it, the files that appeared, changed or went — those its trigger
// listens for (`on`) — are one event once none of them moved for its settle: how many and how, where, and their names,
// never what they hold. Each look told is kept on its cursor (`watchLooked`), so a start after a stop tells, as
// changed while Filament was not running, the files written since — by their time alone: a file that went meanwhile,
// and one brought in with an old time, cannot be known then. What moved while it was paused or off, or under Pause
// all, is not made up: it takes its first look again, and Pause all lets go of the look it kept.
// Its trouble — its place gone or no folder, outside the project, a walk that failed, more files than it looks at —
// is kept on its cursor (`watchTrouble`) for its row to say, until a look goes well.
// Never its own: a file a chat it would wake wrote — any routine's run, as no run wakes a watcher; the chat that
// proposed it, where it wakes that chat — is no news to it. A chat's own is a file written, by its time, in the while
// of a call of that chat that says it writes that file; and a file in the folder that chat works in, written in the
// while of a call of it that says only that it writes, or in one of its own times — a command's, a background
// command's edges, a whole turn where its commands are not all said (the keeper's, app/watchers/own-times.js). A file
// that went is judged by the while it went in: from the look that last saw it to the first that did not. Only what
// was written since the look before is judged: a file brought in with an older time is news, whoever made it.
// The costs: a file the person saves in the very seconds of such a call, in that chat's folder — or the very file it
// names —, is taken for the chat's, and a file they remove within the looks around such a call, a minute apart at
// most; what a chat's command writes outside the folder it works in, what a background command writes past its edges,
// and what a coding agent runs unsaid, is news, heard once. A start tells the files a chat wrote just before the stop:
// the keeper's times end with Filament. Each look that found files moved is a write of its Space's document, heard or
// its own. A hearing that could not be kept is tried again each minute, the looks after it waiting their turn.
import { join, relative, isAbsolute, sep } from "node:path";
import { fileKey, keptFromAgents } from "../../adapters/tools/fs-fence.js";
import { watchFolder } from "../../adapters/tools/file-watch.js";
import { globToRegExp } from "../../core/path-glob.js";
import { FILE_SKIPS, globHead, watchEventOf } from "../../core/watchers.js";
import { placeAmong } from "./commits.js";

/**
 * A file's time is cut to whole seconds on some disks, to two on others, and a call's end is said after what it wrote:
 * as much slack around a chat's own while takes those in.
 */
const SLACK_MS = 2000;
/** How long a watcher whose folder is not there, or whose hearing could not be kept, waits to be tried again. */
const RETRY_MS = 60_000;

/**
 * @typedef {import("../../core/routines.js").Routine} Routine
 * @typedef {Extract<import("../../core/watchers.js").Trigger, { kind: "file" }>} FileTrigger
 * @typedef {import("../../adapters/tools/file-watch.js").Batch} Batch
 * @typedef {{ project: string, id: string, title: string, sig: string, from: number, t: FileTrigger, folders: readonly string[] | null, root: string, where: string,
 *   w: import("../../adapters/tools/file-watch.js").FolderWatch | null, at: number | null, owed: Batch[], busy: Promise<void>, retry: ReturnType<typeof setTimeout> | null, said: string }} Followed
 *   a watcher followed: its trigger and its cursor's start as it was taken up (`sig`: what lets it go where it changes);
 *   its project's folders once read; the folder its walk begins at, and that folder as an event names it, from its
 *   project's folder; its watch, null until its place is found; the look it last told from, null before its first;
 *   the batches not yet heard, oldest first; why its place is watched nowhere, as the log said it last
 */

/**
 * @param {{ store: { get: (project: string) => { routines: Routine[] }, routinesAll: () => { project: string, r: Routine }[], pausedSince: () => number | null, archived?: (project: string) => boolean,
 *     watchLooked: (project: string, id: string, at: number | null, was?: { from: number } | null) => boolean,
 *     watchTrouble: (project: string, id: string, why: string | null) => boolean },
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<number> | number,
 *   folderOf: (project: string) => string | null, chatOf: (chain: string) => { run: boolean, folder: string | null } | null,
 *   own: Pick<import("./own-times.js").OwnTimes, "chatsSince" | "timesOf" | "writesOf">,
 *   foldersOf?: ((project: string) => Promise<readonly string[]> | readonly string[]) | null,
 *   watch?: typeof watchFolder, now?: () => number, log?: (level: string, msg: string) => void, retryMs?: number }} deps
 *   `folderOf`: a project's folder; `chatOf`: whether a chat is a routine's run, and the folder it works in; `own`:
 *   the keeper of each chat's own times and file-writing calls (app/watchers/own-times.js), which whoever made it has
 *   hear the bus and stops. `foldersOf`: a project's folders, its own first (the server's: with those it added and its
 *   repository's worktrees), which a watcher's place is held to; without it, its own alone.
 */
export function createFileWatch({ store, heard, folderOf, chatOf, own: keeper, foldersOf = null, watch = watchFolder, now = Date.now, log = () => {}, retryMs = RETRY_MS }) {
  /** Each watcher followed, by its project and id. @type {Map<string, Followed>} */
  const followed = new Map();
  let stopped = false;
  /** The starts and the hearings queued and not yet done (`settled`). @type {Set<Promise<void>>} */
  const working = new Set();

  /** @param {string} project @param {string} id */
  const keyOf = (project, id) => `${project}\n${id}`;
  /** A watcher's trouble kept on its cursor, or taken off it (`why` null): never thrown from. @param {Followed} f @param {string | null} why */
  const troubled = (f, why) => {
    try {
      store.watchTrouble(f.project, f.id, why);
    } catch (/** @type {any} */ e) {
      log("warn", `watchers: a watcher's trouble could not be kept (${e?.message || e})`);
    }
  };
  /**
   * A followed watcher as it is: on, not paused, on the cursor it was taken up with, no Pause all and its project not
   * archived — else null: what its folder did is then none of its news.
   * @param {Followed} f
   */
  const liveOf = (f) => {
    const r = store.get(f.project).routines.find((x) => x.id === f.id);
    return r && r.state === "on" && !r.paused && r.seen && r.seen.from === f.from && !store.pausedSince() && !store.archived?.(f.project) ? r : null;
  };
  /** One more piece of a watcher's work, after what it has under way. @param {Followed} f @param {() => Promise<void>} work */
  const queue = (f, work) => {
    const p = f.busy.then(work).catch((/** @type {any} */ e) => log("warn", `watchers: a watcher's folder was not followed (${e?.message || e})`));
    f.busy = p;
    working.add(p);
    void p.then(() => working.delete(p));
    return p;
  };
  /** Its work taken up again later, once: a place looked for, a hearing kept. @param {string} key @param {Followed} f @param {() => Promise<void>} work */
  const retrySoon = (key, f, work) => {
    if (f.retry || stopped || followed.get(key) !== f) return;
    f.retry = setTimeout(() => {
      f.retry = null;
      if (!stopped && followed.get(key) === f) void queue(f, work);
    }, retryMs);
    f.retry.unref?.();
  };
  /** @param {number} n */
  const counted = (n) => n.toLocaleString("en-US");

  /**
   * Where a watcher's files are read from: its place among its project's folders (`placeAmong`), those read once for
   * it; its project's own folder where it names none. With the folders its fence is judged by.
   * @param {Followed} f
   * @returns {Promise<{ ok: true, place: string, bases: readonly string[] } | { ok: false, error: string }>}
   */
  async function placeOf(f) {
    const folder = folderOf(f.project);
    if (!f.t.place) return folder ? { ok: true, place: folder, bases: [folder] } : { ok: false, error: "its project has no folder on this machine" };
    if (!f.folders) {
      try {
        f.folders = foldersOf ? [...(await foldersOf(f.project))] : folder ? [folder] : [];
      } catch (/** @type {any} */ e) {
        return { ok: false, error: `place "${f.t.place}" cannot be checked: its project's folders could not be read (${e?.message || e})` };
      }
    }
    const v = placeAmong(f.folders, f.t.place);
    return v.ok ? { ok: true, place: v.place, bases: f.folders } : v;
  }

  /**
   * A watcher's folder found and watched; where it is none of its project's, is not there or is inside .git, its
   * trouble — and, but for .git, looked for again later.
   * @param {string} key @param {Followed} f
   */
  async function start(key, f) {
    const v = await placeOf(f);
    if (stopped || followed.get(key) !== f || f.w) return;
    if (!v.ok) {
      // Said once in the log while it stands, however often it is looked for.
      if (f.said !== v.error) log("warn", `watchers: “${f.title}” of ${f.project} watches no folder: ${v.error}`);
      f.said = v.error;
      troubled(f, v.error);
      return retrySoon(key, f, () => start(key, f));
    }
    const head = globHead(f.t.glob);
    const lead = head.join("/");
    f.root = join(v.place, ...head);
    // As an event names it: from the project's folder where it is inside it, whole where it is another of its folders.
    const own = folderOf(f.project);
    const rel = own ? relative(own, f.root) : f.root;
    f.where = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? f.root : rel.split(sep).join("/");
    if (keptFromAgents(f.root, v.bases) === ".git") return troubled(f, `${f.where} is inside a repository's own .git folder, which no watcher looks at`);
    const re = globToRegExp(f.t.glob);
    f.w = watch(v.place, {
      under: lead,
      match: (path) => re.test(lead ? `${lead}/${path}` : path),
      skip: FILE_SKIPS,
      settleMs: f.t.settleSec * 1000,
      since: f.at,
      now,
      onMoved: (batch) => {
        if (stopped || followed.get(key) !== f) return;
        f.owed.push(batch);
        void queue(f, () => hear(key, f));
      },
      // Its trouble while its folder cannot be looked at whole; gone as a look goes well.
      onLooked: (looked) => {
        if (stopped || followed.get(key) !== f) return;
        const folder = f.t.place ?? "its project's folder";
        troubled(
          f,
          !looked.ok
            ? looked.gone
              ? `${folder} is no folder on this machine now`
              : `its folder could not be read: ${looked.error}`
            : looked.over
              ? `more than ${counted(looked.max)} files under ${f.where || "its project's folder"}: it watches the first ${counted(looked.max)}, by their paths`
              : null,
        );
      },
    });
  }

  /**
   * What makes a file a watcher's own (the head's rule): the chats it would wake, each with the folder it works in, its
   * own times and its file-writing calls, as the keeper has them.
   * @param {Routine} r @param {number} since  the look what moved is held against
   */
  function ownOf(r, since) {
    /** @type {Set<string>} */
    const chains = new Set();
    if (r.wakes === "chat" && r.madeIn) chains.add(r.madeIn);
    // The keeper lists the chats that ran a command; one that only wrote files is a routine's run, by its row's last.
    for (const c of keeper.chatsSince(since - SLACK_MS)) chains.add(c.chain);
    for (const x of store.routinesAll()) if (x.r.last?.chain) chains.add(x.r.last.chain);
    const chats = [...chains].flatMap((chain) => {
      const c = chatOf(chain);
      if (!c?.folder || !(c.run || (r.wakes === "chat" && chain === r.madeIn))) return [];
      return [{ folder: c.folder, base: fileKey(c.folder, "."), times: keeper.timesOf(chain), writes: keeper.writesOf(chain) }];
    });
    /** Whether a while of a chat's, with its slack, holds a moment, or meets another while. @param {{ from: number, to: number | null }} t @param {number} from @param {number} [to] */
    const meets = (t, from, to = from) => to >= t.from - SLACK_MS && from <= (t.to ?? Infinity) + SLACK_MS;
    /**
     * @param {string} path  from the folder the walk begins at @param {string} root
     * @param {number} from @param {number} [to]  when it was written; or the while it went in
     */
    return (path, root, from, to = from) =>
      chats.some((c) => {
        const key = fileKey(c.folder, join(root, path));
        if (c.writes.some((w) => w.paths?.some((p) => fileKey(c.folder, p) === key) && meets(w, from, to))) return true;
        if (!key.startsWith(c.base.endsWith(sep) ? c.base : c.base + sep)) return false;
        return c.times.some((t) => meets(t, from, to)) || c.writes.some((w) => !w.paths && meets(w, from, to));
      });
  }

  /**
   * The oldest batch not yet heard: its watcher's cursor moved to its look, and — but for a first look with no time
   * away behind it — what it holds of the moves its trigger listens for, its own left out, heard as one event.
   * @param {Followed} f @param {Batch} batch
   */
  async function hearOne(f, batch) {
    const r = liveOf(f);
    if (!r) return;
    const after = f.at ?? r.seen?.from ?? batch.at;
    const on = f.t.on;
    // After a time away a file is told by its time alone: whether it is new there or written again cannot be known.
    const lists = {
      added: on.includes("added") ? batch.added : [],
      changed: (batch.away ? on.includes("added") || on.includes("changed") : on.includes("changed")) ? batch.changed : [],
      removed: on.includes("removed") ? batch.removed : [],
    };
    if (lists.added.length || lists.changed.length || lists.removed.length) {
      const mine = ownOf(r, after);
      // Written before the look it is held against, a file was brought in, not written, since: news.
      const written = (/** @type {{ path: string, mtimeMs: number }} */ x) => x.mtimeMs < after - SLACK_MS || !mine(x.path, f.root, x.mtimeMs);
      const added = lists.added.filter(written).map((x) => x.path);
      const changed = lists.changed.filter(written).map((x) => x.path);
      const removed = lists.removed.filter((x) => !mine(x.path, f.root, x.gone.from, x.gone.to)).map((x) => x.path);
      if (added.length || changed.length || removed.length)
        await heard(f.project, f.id, [watchEventOf({ kind: "file", at: now(), after, place: f.root, glob: f.t.glob, where: f.where, added, changed, removed, away: batch.away }, f.t, () => "")]);
    }
    f.at = Math.max(f.at ?? 0, batch.at);
    store.watchLooked(f.project, f.id, f.at, { from: f.from });
  }
  /** Each batch not yet heard, oldest first; one that could not be kept stays, and is tried again later. @param {string} key @param {Followed} f */
  async function hear(key, f) {
    while (f.owed.length && !stopped && followed.get(key) === f && !f.retry) {
      try {
        await hearOne(f, f.owed[0]);
      } catch (/** @type {any} */ e) {
        if (stopped) return;
        log("warn", `watchers: “${f.title}” of ${f.project} could not keep what its files did (${e?.message || e}); it is tried again in a minute`);
        return retrySoon(key, f, () => hear(key, f));
      }
      f.owed.shift();
    }
  }

  /** A watcher followed no more: its watch stopped, nothing of it waiting. @param {string} key */
  const letGo = (key) => {
    const f = followed.get(key);
    if (!f) return;
    f.w?.stop();
    if (f.retry) clearTimeout(f.retry);
    f.retry = null;
    followed.delete(key);
  };

  /**
   * Each file watcher that is on and not paused has its folder watched; each other one is let go, and one whose trigger
   * changed or that was resumed is taken up anew, its first look where it listens from. Under Pause all none is
   * watched, and each lets go of the look it kept: with Pause all off again it takes its first look again. So with one
   * of a project the person archived (r-itself, 11-12; the store's `archived`), until they bring it back.
   */
  function sync() {
    if (stopped) return;
    const held = !!store.pausedSince();
    /** @type {Map<string, { project: string, r: Routine, t: FileTrigger, sig: string }>} */
    const wanted = new Map();
    for (const { project, r } of store.routinesAll()) {
      if (r.trigger?.kind !== "file" || r.state !== "on" || r.paused || !r.seen) continue;
      if (!held && !store.archived?.(project)) {
        wanted.set(keyOf(project, r.id), { project, r, t: r.trigger, sig: `${JSON.stringify(r.trigger)}\n${r.seen.from}` });
        continue;
      }
      if (r.seen.fileAt == null) continue;
      try {
        store.watchLooked(project, r.id, null);
      } catch (/** @type {any} */ e) {
        log("warn", `watchers: a watcher's last look could not be let go (${e?.message || e})`);
      }
    }
    for (const [key, f] of [...followed]) if (wanted.get(key)?.sig !== f.sig) letGo(key);
    for (const [key, { project, r, t, sig }] of wanted) {
      if (followed.has(key)) continue;
      /** @type {Followed} */
      const f = { project, id: r.id, title: r.title, sig, from: r.seen?.from ?? 0, t, folders: null, root: "", where: "", w: null, at: r.seen?.fileAt ?? null, owed: [], busy: Promise.resolve(), retry: null, said: "" };
      followed.set(key, f);
      void queue(f, () => start(key, f));
    }
  }

  return {
    sync,
    /** A watcher's folder is looked at, and what the look tells is heard (the tests'). @param {string} project @param {string} id */
    look: async (project, id) => {
      const f = followed.get(keyOf(project, id));
      if (!f) return;
      await f.busy;
      await f.w?.look();
      await f.busy;
    },
    /** The watchers whose folder is watched, each with the folder its walk begins at (the tests'). */
    watched: () => new Map([...followed].flatMap(([k, f]) => (f.w ? [/** @type {[string, string]} */ ([k, f.root])] : []))),
    /** Every start, every walk and every hearing under way, done (the tests'). */
    settled: async () => {
      do {
        while (working.size) await Promise.all([...working]);
        await Promise.all([...followed.values()].map((f) => f.w?.settled()));
      } while (working.size);
    },
    /** Every watch stopped (the server's stop). */
    stop() {
      stopped = true;
      for (const key of [...followed.keys()]) letGo(key);
    },
  };
}

/** @typedef {ReturnType<typeof createFileWatch>} FileWatch */
