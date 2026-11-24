// @ts-check
// Whether a folder is there, asked off the server's thread with a bound wait: a folder on a share or drive gone offline
// answers a stat for as long as its system waits on the share, and a look at it on the thread held every request and
// stream that long. A share's root is looked at before any folder on it, once for all of them, so a share that does not
// answer holds one of Node's few file threads, never one for each folder; one folder that hangs on a share that answers
// (a dead link) is that folder's alone.
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";

/**
 * How long a folder's stat is waited for (`folderThere`). A folder on a network mount gone offline — a mapped drive, an
 * SMB or NFS share — answers none for as long as its system waits on the share, a minute and more: asked on the
 * server's thread, as a check of whether it is there was, it held every request and stream that long, and a desk asks
 * its chats' folders' remotes every minute.
 */
export const FOLDER_STAT_MS = 2000;
/**
 * How many stats may be under way at once, answered or not yet: each holds one of the threads Node's file calls share
 * (four) until it answers, so one is always left for the server's other file reads. An ask past them waits for one to
 * end, within its own wait.
 */
export const FOLDER_STATS_HUNG = 3;
/** How long a share whose root answered is taken as answering: its folders are asked side by side meanwhile. */
export const SHARE_ANSWERED_MS = FOLDER_STAT_MS;

/** A stat's error that says the folder is not there. */
const GONE = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"]);
/** One that says it is there, and not Filament's to look in: the fence says so in its own words. */
const THERE = new Set(["EACCES", "EPERM"]);

/**
 * @typedef {{ answer: Promise<boolean | null>, late: boolean }} Stat
 *   Stat  a stat under way: true, false (gone), or null (no turn for it, or an error that says nothing of the folder —
 *   a share's timeout, a host not reached); `late`: an asker waited it out, and it has not answered yet
 */

/** The stats under way, by path — a folder's, or a share's root —, so each is asked once however often it is read. @type {Map<string, Stat>} */
const statting = new Map();
/**
 * By share (`shareOf`): its root's look under way (`look`), when its root last answered (`at`), and whether it was
 * there (`was`). @type {Map<string, { look: Stat | null, at: number, was: boolean }>}
 */
const shares = new Map();

/** How many stats are under way now (`FOLDER_STATS_HUNG` at most), and the asks waiting for one to end, in turn. */
let underWay = 0;
/** @type {Array<() => void>} */
const waiting = [];

/** A turn to stat within `ms`: true once one is free, false where none frees by then. @param {number} ms @returns {Promise<boolean>} */
const turn = (ms) => {
  if (underWay < FOLDER_STATS_HUNG && !waiting.length) {
    underWay++;
    return Promise.resolve(true);
  }
  return new Promise((r) => {
    const go = () => {
      clearTimeout(timer);
      underWay++;
      r(true);
    };
    const timer = setTimeout(() => {
      const i = waiting.indexOf(go);
      if (i >= 0) waiting.splice(i, 1);
      r(false);
    }, Math.max(0, ms));
    timer.unref?.();
    waiting.push(go);
  });
};
/** A stat ended: the next ask waiting takes its turn. */
const ended = () => {
  underWay--;
  waiting.shift()?.();
};

/**
 * A path's stat, the one under way joined, else started once a turn frees within `ms`.
 * @param {string} path @param {number} ms @param {(path: string) => Promise<unknown>} statOf @returns {Stat}
 */
const ask = (path, ms, statOf) => {
  const under = statting.get(path);
  if (under) return under;
  /** @type {Stat} */
  const it = { answer: Promise.resolve(null), late: false };
  it.answer = turn(ms).then((got) =>
    !got
      ? null
      : Promise.resolve()
          .then(() => statOf(path))
          .then(
            () => true,
            (/** @type {any} */ e) => (GONE.has(e?.code) ? false : THERE.has(e?.code) ? true : null),
          )
          .finally(ended),
  );
  statting.set(path, it);
  // Once it answers at last, however late, the path is asked anew.
  void it.answer.then(() => {
    if (statting.get(path) === it) statting.delete(path);
  });
  return it;
};

/**
 * A stat's answer, or null where it has none within `ms` — at once where it is late already. One an asker waited out is
 * late: its path, and its share where it is the share's root, are not answering until it does.
 * @param {Stat} it @param {number} ms @returns {Promise<boolean | null>}
 */
const within = async (it, ms) => {
  if (it.late) return null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<null>} */
  const waited = new Promise((r) => (timer = setTimeout(() => ((it.late = true), r(null)), Math.max(0, ms))));
  try {
    return await Promise.race([it.answer, waited]);
  } finally {
    clearTimeout(timer);
  }
};

/** How long the mount table read is used before it is read again. */
const MOUNTS_MS = 10_000;
/** The mount points Linux lists (/proc/self/mounts, read from memory, never a disk); none elsewhere. */
let mounts = { at: -Infinity, list: /** @type {string[]} */ ([]) };
const mountPoints = () => {
  if (process.platform !== "linux") return [];
  if (Date.now() - mounts.at < MOUNTS_MS) return mounts.list;
  /** @type {string[]} */
  let list = [];
  try {
    list = readFileSync("/proc/self/mounts", "utf8")
      .split("\n")
      .map((l) => l.split(" ")[1])
      .filter(Boolean)
      .map((m) => m.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  } catch {}
  mounts = { at: Date.now(), list };
  return list;
};

/** Windows' system drive, where its own disk is. */
const SYSTEM_DRIVE = String(process.env.SystemDrive || "C:").toUpperCase();

/**
 * The share or mount a folder is on, as its path and the system say: a UNC share (\\server\share, its long forms
 * \\?\UNC\server\share too), a drive (D:), the deepest mount point Linux lists above it but its root, a volume under
 * /Volumes; else the folder itself, on the system's own disk. A share gone offline hangs a stat of every folder on it,
 * and of none elsewhere. @param {string} folder
 */
export function shareOf(folder) {
  const f = String(folder).replace(/^[\\/]{2}[?.][\\/](UNC[\\/])?/i, (_, unc) => (unc ? "\\\\" : ""));
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.exec(f);
  if (unc) return unc[0].replace(/\//g, "\\").toLowerCase();
  const drive = /^[A-Za-z]:/.exec(f)?.[0].toUpperCase();
  // The system's own disk is no share: a stat there that hangs is a link of its own to one (a dead junction), and each
  // folder there is its own.
  if (drive) return drive === SYSTEM_DRIVE ? String(folder) : drive;
  const p = f.replace(/\/+$/, "") || "/";
  const under = mountPoints()
    .filter((m) => m !== "/" && (p === m || p.startsWith(`${m}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return under || /^\/Volumes\/[^/]+/.exec(p)?.[0] || String(folder);
}

/** The path a share's look asks: its root. @param {string} share */
const rootOf = (share) => (/^[A-Z]:$/.test(share) ? `${share}\\` : share);

/**
 * Whether a folder is known not to answer now: its stat, or its share's root's, is under way past its wait. Asked of
 * nothing: a check on the server's thread that holds it for no time. @param {string} folder
 */
export const folderHung = (folder) => {
  const f = String(folder);
  return !!statting.get(f)?.late || !!shares.get(shareOf(f))?.look?.late;
};

/**
 * Whether a folder is there, asked off the server's thread and waited for `ms` at most: true, false (gone), or null
 * where it has not answered by then — it goes on, and the folder read again meanwhile is null at once. On a share
 * (`shareOf`), its root is asked first, once for every folder on it within `SHARE_ANSWERED_MS`: where the root does not
 * answer, no folder there is asked; where it is not there, nor is the folder. At most `FOLDER_STATS_HUNG` stats are
 * under way at once. `statOf`: the stat (the tests').
 * @param {string} folder @param {{ ms?: number, statOf?: (path: string) => Promise<unknown> }} [o]
 * @returns {Promise<boolean | null>}
 */
export async function folderThere(folder, { ms = FOLDER_STAT_MS, statOf = stat } = {}) {
  const f = String(folder);
  const by = Date.now() + ms;
  const left = () => by - Date.now();
  const under = statting.get(f);
  if (under) return within(under, ms);
  const share = shareOf(f);
  if (share !== f) {
    const s = shares.get(share) ?? { look: null, at: -Infinity, was: true };
    shares.set(share, s);
    if (s.look?.late) return null;
    if (Date.now() - s.at > SHARE_ANSWERED_MS) {
      if (!s.look) {
        const look = ask(rootOf(share), ms, statOf);
        s.look = look;
        void look.answer.then((a) => {
          if (s.look === look) s.look = null;
          if (a !== null) Object.assign(s, { at: Date.now(), was: a });
        });
      }
      if ((await within(s.look, left())) === null) return null;
    }
    if (!s.was) return false;
  }
  // Late at the asker's own end, so a folder that has not answered by then is known not to at once.
  const rest = left();
  if (rest <= 0) return null;
  return within(ask(f, rest, statOf), rest);
}
