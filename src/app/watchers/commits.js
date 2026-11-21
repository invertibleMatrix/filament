// @ts-check
// A branch's new commits as a watcher's trigger (the plan of 11-11, its w3). Each watcher of a commit trigger that is on
// and not paused has its branch watched — in its place, its project's folder where it names none, a place not whole read
// from that folder —, one watch for every watcher of the same branch there (adapters/git/watch.js `watchBranch`: within
// moments of a commit, whichever worktree made it). A place is followed only where it is a folder of its project
// (`placeAmong`, of the folders `foldersOf` says: its own, those it added, its repository's worktrees), whoever kept
// it: any other is the watcher's trouble, and no branch there is read. Each keeps the commit it last looked at on its
// cursor (`watchHead`): a move from there is heard as one event — the commits added, newest first, what a rewrite
// dropped, a move back, the branch made or deleted —; the first look is where it listens from. So a restart catches up
// from where it was, and what came while it was paused or off is not made up: resumed, it looks anew. Pause all holds
// its looks, its head kept, so what came meanwhile is heard once it is off. A read that failed, or a look that threw,
// is tried again a minute later, and is the watcher's trouble meanwhile — as a branch that cannot be read is —, kept on
// its cursor (`watchTrouble`) for its row to say, until a look goes well.
// Never its own: a commit a chat it would wake made in its branch's repository — any routine's run, as no run wakes a
// watcher; the chat that proposed it, where it wakes that chat — is no news to it. A chat's own is what was made while
// a command of it that could have made it ran: the branch came to its tip here in such a command's time — when, its
// reflog says, else the moment the tip was read — and the commit's own time falls in one too, and only since the
// branch's tip before it was first seen. Those times are the keeper's (`own`, app/watchers/own-times.js, which hears
// the bus and the hands' list, and says what each is): a command's from its call's start to its end, less the while
// it waits for the person's answer; a background command's first two minutes and, once it ended, its last two —
// whole where it ran four or less: such a command is mostly a server, a watcher of tests or a tail, up for hours and
// committing nothing, and one that commits does so near its end (`npm test && git commit`) or is short —; a whole
// turn only where its commands are not all said. A tip that came while a background command is listed past its first
// two minutes is judged once the hands say it ended, or the keeper's hold later (`endOf`): what a step near its end
// committed is its own, though a look came before that end was said.
// A call its engine vouches for as only reading (the gate's own reading of a command, an MCP tool its server marks
// read-only), a file's edit and a read are none: what lands while a chat thinks, reads or edits is news, whoever made
// it. So a commit pulled, merged or brought in later is news whoever made it and whenever: one made long before, and
// one made elsewhere while such a command ran here. The cost: a commit the person makes in the same repository in the
// very seconds a chat's own command runs, or in a background command's first or last two minutes, is taken for that
// chat's; a commit a background command makes past its first two minutes, looked at while it still runs — in the
// middle of a long script, or more than the keeper's hold before its end —, is news, heard once; and what a coding
// agent runs unsaid (its own hooks, its own background shells) makes news of its commits. A move longer than the
// commits read is never its own: those past them are not judged.
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { resolveInside } from "../../adapters/tools/fs-fence.js";
import { branchCameAt, commitsBetween, commitsMade, commonDirOf, watchBranch } from "../../adapters/git/watch.js";
import { NO_BRANCH, watchEventOf } from "../../core/watchers.js";
import { normalizeCwd } from "../../core/project-id.js";
import { SHELL_EDGE_MS } from "./own-times.js";

/**
 * A commit's time, and its reflog's, is in whole seconds, cut down: one second's slack before a time of a chat's own
 * takes in a commit made in its first second; as much is kept after it, though a command's end is said after what it
 * made.
 */
const SLACK_MS = 1000;
/** A tip with no reflog came when it was read: up to a poll of the watch after the command that moved it, and the read. */
const READ_SLACK_MS = 2000;
/** How long a look whose read failed waits to be tried again. */
const RETRY_MS = 60_000;
/** The folders whose repository is known, at most; the tips a branch remembers when it came to. */
const FOLDERS_KEPT = 200;
const TIPS_KEPT = 50;

/**
 * @typedef {import("../../core/routines.js").Routine} Routine
 * @typedef {{ place: string, branch: string, w: import("../../adapters/git/watch.js").BranchWatch | null, head: string | null | undefined,
 *   tips: Map<string, number>, startedAt: number, busy: Promise<void>, retry: ReturnType<typeof setTimeout> | null, trouble: string | null }} Watched
 *   a branch watched: its tip as last read (undefined before the first read, null where the branch is not there); each
 *   tip it came to, newest last, with when it last came to it (`NO_BRANCH` where it was not there); when the watch began;
 *   why it cannot be read now, null while it can
 */

/**
 * Where a commit watcher's place is, held to its project's folders — `folders`: the project's own first, then those it
 * added and its repository's worktrees —: one of them or a folder inside one, by its path and by where its links lead
 * (tools/fs-fence.js `resolveInside`). A place not whole is read against the project's own. Refused in words, for the
 * agent that names it and for the row of a watcher that kept it.
 * @param {readonly string[]} folders @param {string} place
 * @returns {{ ok: true, place: string } | { ok: false, error: string }}
 */
export function placeAmong(folders, place) {
  const [own, ...more] = folders;
  if (!own) return { ok: false, error: `place "${place}" cannot be checked: its project has no folder` };
  let abs = "";
  try {
    abs = resolveInside(own, place, { reads: more });
  } catch {
    return { ok: false, error: `place "${place}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project's folder` };
  }
  try {
    if (statSync(abs).isDirectory()) return { ok: true, place: abs };
  } catch {
    // Not there: said below.
  }
  return { ok: false, error: `place "${place}" is no folder on this machine` };
}

/**
 * @param {{ store: { get: (project: string) => { routines: Routine[] }, routinesAll: () => { project: string, r: Routine }[], pausedSince: () => number | null, archived?: (project: string) => boolean,
 *     watchHead: (project: string, id: string, head: string, was?: { from: number, head: string | null } | null) => boolean,
 *     watchTrouble: (project: string, id: string, why: string | null) => boolean },
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<number> | number,
 *   folderOf: (project: string) => string | null, chatOf: (chain: string) => { run: boolean, folder: string | null } | null,
 *   own: Pick<import("./own-times.js").OwnTimes, "chatsSince" | "endOf">,
 *   foldersOf?: ((project: string) => Promise<readonly string[]> | readonly string[]) | null,
 *   watch?: typeof watchBranch, between?: typeof commitsBetween, made?: typeof commitsMade, cameAt?: typeof branchCameAt, commonOf?: (folder: string) => Promise<string | null>,
 *   now?: () => number, log?: (level: string, msg: string) => void, retryMs?: number }} deps
 *   `folderOf`: a project's folder; `chatOf`: whether a chat is a routine's run, and the folder it works in; `own`:
 *   the keeper of each chat's own times (app/watchers/own-times.js), which whoever made it has hear the bus and stops.
 *   `foldersOf`: a project's folders, its own first (the server's: with those it added and its repository's
 *   worktrees), which a watcher's place is held to; without it a place is taken as it is kept (a test's stand-in).
 */
export function createCommitWatch({ store, heard, folderOf, chatOf, own: keeper, foldersOf = null, watch = watchBranch, between = commitsBetween, made = commitsMade, cameAt = branchCameAt, commonOf = commonDirOf, now = Date.now, log = () => {}, retryMs = RETRY_MS }) {
  /** Each branch watched, by its place and name. @type {Map<string, Watched>} */
  const branches = new Map();
  /** Each folder's repository, as a key (`normalizeCwd` of its common folder), once read. @type {Map<string, Promise<string | null>>} */
  const repos = new Map();
  let stopped = false;

  /** @param {string} place @param {string} branch */
  const keyOf = (place, branch) => `${place}\n${branch}`;
  /** Whether a watcher looks at its branch: a commit trigger's, on, not paused. @param {Routine | undefined} r */
  const watches = (r) => r?.trigger?.kind === "commit" && r.state === "on" && !r.paused;
  /**
   * Each placed watcher's place as judged against its project's folders (`placeAmong`), by `judgedKey`: where it is,
   * or why it is followed nowhere; null while its judgment is under way (`judging`).
   * @type {Map<string, { ok: true, place: string } | { ok: false, error: string } | null>}
   */
  const places = new Map();
  /** @type {Set<Promise<void>>} */
  const judging = new Set();
  /**
   * A placed watcher's judgment's key: its place is judged anew where it changed, and each time the watcher is switched
   * on or resumed (its cursor's start), so a folder added to the project since is found.
   * @param {string} project @param {Routine} r
   */
  const judgedKey = (project, r) => `${project}\n${r.id}\n${r.trigger?.kind === "commit" ? r.trigger.place : ""}\n${r.seen?.from ?? ""}`;
  /**
   * Where a watcher's branch is: its place — one not whole read from its project's folder —, else that folder. A place
   * is one its project's folders hold, as judged (`judgePlaces`): null until it is, and where it is refused.
   * @param {string} project @param {Routine} r
   */
  const placeOf = (project, r) => {
    if (r.trigger?.kind !== "commit") return null;
    const folder = folderOf(project);
    const place = r.trigger.place;
    if (!place) return folder;
    if (foldersOf) {
      const v = places.get(judgedKey(project, r));
      return v?.ok ? v.place : null;
    }
    return isAbsolute(place) ? place : folder ? resolve(folder, place) : null;
  };
  /** The watchers of one branch now. @param {string} key */
  const watchersOf = (key) => store.routinesAll().filter(({ project, r }) => watches(r) && r.trigger?.kind === "commit" && keyOf(placeOf(project, r) || "", r.trigger.branch) === key);
  /** A folder's repository, as a key. @param {string} folder */
  const repoOf = (folder) => {
    let p = repos.get(folder);
    if (!p) {
      // One that could not be read is asked again at the next look: a folder made a repository since, a drive back.
      p = commonOf(folder)
        .then((c) => (c ? normalizeCwd(c) : null))
        .catch(() => null)
        .then((c) => {
          if (!c) repos.delete(folder);
          return c;
        });
      repos.set(folder, p);
      for (const k of repos.keys()) {
        if (repos.size <= FOLDERS_KEPT) break;
        repos.delete(k);
      }
    }
    return p;
  };

  /**
   * The times, since `since`, of the chats a watcher would wake that work in its branch's repository — a commit made in
   * one of them is its own (`ownAt`) —, and their background commands listed now, each by its key for the keeper's
   * wait (`endOf`).
   * @param {Routine} r @param {Watched} b @param {number} since
   */
  async function timesFor(r, b, since) {
    const repo = await repoOf(b.place);
    /** @type {{ from: number, to: number | null }[]} */
    const times = [];
    /** @type {{ key: string, from: number }[]} */
    const running = [];
    if (!repo) return { times, running };
    for (const chat of keeper.chatsSince(since - SLACK_MS)) {
      const c = chatOf(chat.chain);
      if (!c?.folder || !(c.run || (r.wakes === "chat" && chat.chain === r.madeIn))) continue;
      if ((await repoOf(c.folder)) !== repo) continue;
      times.push(...chat.times);
      running.push(...chat.running);
    }
    return { times, running };
  }
  /**
   * Whether a moment falls in one of `times`, since `since`; `after`: the slack past a time's end.
   * @param {readonly { from: number, to: number | null }[]} times @param {number} since @param {number} at @param {number} [after]
   */
  const ownAt = (times, since, at, after = SLACK_MS) => at >= since - SLACK_MS && times.some((t) => at >= t.from - SLACK_MS && at <= (t.to ?? Infinity) + after);
  /** A watcher's trouble kept on its cursor, or taken off it (`why` null): never thrown from. @param {string} project @param {string} id @param {string | null} why */
  const troubled = (project, id, why) => {
    try {
      store.watchTrouble(project, id, why);
    } catch (/** @type {any} */ e) {
      log("warn", `watchers: a watcher's trouble could not be kept (${e?.message || e})`);
    }
  };

  /**
   * Each watcher of a branch looks at its tip: the first look is where it listens from; a move since its last is heard,
   * its own commits left out, and its head kept.
   * @param {string} key
   */
  async function look(key) {
    const b = branches.get(key);
    if (!b || b.head === undefined || stopped) return;
    const head = b.head ?? NO_BRANCH;
    for (const { project, r } of watchersOf(key)) {
      // Pause all holds every look: what it sees then is heard once it is off.
      if (stopped || store.pausedSince()) return;
      // So does its project's archive, for its own (r-itself, 11-12): heard once the person brings the project back.
      if (store.archived?.(project)) continue;
      try {
        // As it is now: switched off, paused or resumed meanwhile.
        const now0 = store.get(project).routines.find((x) => x.id === r.id);
        if (!now0 || !watches(now0) || !now0.seen || now0.seen.head === head) continue;
        const was = { from: now0.seen.from, head: now0.seen.head ?? null };
        if (!was.head) {
          if (store.watchHead(project, now0.id, head, was) && now0.seen.trouble) troubled(project, now0.id, null);
          continue;
        }
        const from = was.head === NO_BRANCH ? null : was.head;
        // The tip this look began at, for every watcher of it: a later one is the next look's.
        const to = head === NO_BRANCH ? null : head;
        const m = !to ? { ok: /** @type {const} */ (true), gone: false, added: [], more: 0, dropped: 0 } : from ? await between(b.place, from, to) : await made(b.place, b.branch, to);
        if (stopped) return;
        if (!m.ok) {
          log("warn", `watchers: “${now0.title}” of ${project} could not read ${b.branch}'s move (${m.error}); it looks again in a minute`);
          troubled(project, now0.id, m.error);
          retrySoon(key);
          continue;
        }
        // As it is after the read: a resume or Pause all meanwhile leaves the move to the look that comes after.
        const w = store.get(project).routines.find((x) => x.id === r.id);
        if (!w || !watches(w) || !w.seen || w.seen.from !== was.from || (w.seen.head ?? null) !== was.head || store.pausedSince()) continue;
        const at = now();
        // Its own only since the branch came to the tip it moved from: what was made before that and brought in now is
        // news. A tip from before the watch began (a restart's catch-up): since then.
        const since = b.tips.get(was.head) ?? b.startedAt;
        let mine = await timesFor(w, b, since);
        if (stopped) return;
        // …and only where the branch came to this tip here in an own time — a commit, a rewrite, a move back or a
        // deletion while a command of a chat of its ran —: when, its reflog says; where it says nothing, when the tip
        // was read, which is after the command that moved it.
        const any = mine.times.length > 0 || mine.running.length > 0;
        const logged = m.gone || !any || !to ? null : await cameAt(b.place, b.branch, to).catch(() => null);
        const came = m.gone || !any ? null : (logged ?? b.tips.get(head) ?? at);
        if (stopped) return;
        /** The move judged by `times`: the commits of it not its own, and whether it is its own. @param {readonly { from: number, to: number | null }[]} times */
        const judged = (times) => {
          const here = came != null && ownAt(times, since, came, logged != null ? SLACK_MS : READ_SLACK_MS);
          const others = m.gone ? [] : here ? m.added.filter((c) => !ownAt(times, since, c.at)) : m.added;
          // Its own move is no news to it: every commit of it its own — none past those read, which are not judged.
          return { others, own: here && !m.gone && !others.length && !m.more };
        };
        let { others, own } = judged(mine.times);
        // A tip that came while a background command of such a chat is listed past its first two minutes is judged once
        // the hands say that command ended, or the keeper's hold later: a step after its commit (a push, a line printed,
        // its output held by what it started) keeps it listed as the look comes, and its last two minutes are its own
        // once it ended.
        const ends = own || m.gone || came == null || m.more ? [] : mine.running.filter((x) => came > x.from + SHELL_EDGE_MS);
        if (ends.length) {
          await keeper.endOf(ends.map((x) => x.key));
          if (stopped) return;
          const v = store.get(project).routines.find((x) => x.id === r.id);
          if (!v || !watches(v) || !v.seen || v.seen.from !== was.from || (v.seen.head ?? null) !== was.head || store.pausedSince()) continue;
          mine = await timesFor(w, b, since);
          if (stopped) return;
          ({ others, own } = judged(mine.times));
        }
        if (!own) {
          const e = watchEventOf(
            { kind: "commit", at, after: w.seen.headAt ?? w.seen.from, place: b.place, branch: b.branch, from, to, added: others.map((c) => ({ sha: c.sha, subject: c.subject })), more: m.gone ? 0 : m.more, dropped: m.gone ? 0 : m.dropped, gone: m.gone },
            w.trigger ?? { kind: "commit", branch: b.branch },
            () => "",
          );
          await heard(project, w.id, [e]);
        }
        if (store.watchHead(project, w.id, head, was) && w.seen.trouble) troubled(project, w.id, null);
      } catch (/** @type {any} */ e) {
        if (stopped) return;
        // Tried again as a read that failed is: its head is not kept, so the move is the next look's.
        log("warn", `watchers: “${r.title}” of ${project} did not look at its branch (${e?.message || e}); it looks again in a minute`);
        troubled(project, r.id, String(e?.message || e));
        retrySoon(key);
      }
    }
  }

  /** A look at a branch queued after the one under way. @param {string} key */
  const lookSoon = (key) => {
    const b = branches.get(key);
    if (!b) return Promise.resolve();
    b.busy = b.busy.then(() => look(key)).catch(() => {});
    return b.busy;
  };
  /** A look tried again a minute later, once. @param {string} key */
  const retrySoon = (key) => {
    const b = branches.get(key);
    if (!b || b.retry) return;
    b.retry = setTimeout(() => {
      b.retry = null;
      void lookSoon(key);
    }, retryMs);
    b.retry.unref?.();
  };

  /**
   * Each placed watcher that looks has its place judged against its project's folders, once for each time it is
   * switched on or resumed: followed where it is one of them, the branches set again as that is known; any other is the
   * watcher's trouble, kept on its cursor for its row to say. Folders that could not be read are asked again at the
   * next `sync`.
   * @param {NonNullable<typeof foldersOf>} folders
   */
  function judgePlaces(folders) {
    /** @type {Set<string>} */
    const live = new Set();
    for (const { project, r } of store.routinesAll()) {
      if (!watches(r) || r.trigger?.kind !== "commit" || !r.trigger.place) continue;
      const key = judgedKey(project, r);
      live.add(key);
      if (places.has(key)) continue;
      places.set(key, null);
      const place = r.trigger.place;
      /** @type {Promise<void>} */
      const p = Promise.resolve()
        .then(() => folders(project))
        .then(
          (list) => ({ v: placeAmong(list, place), kept: true }),
          (e) => ({ v: { ok: /** @type {const} */ (false), error: `place "${place}" cannot be checked: its project's folders could not be read (${e?.message || e})` }, kept: false }),
        )
        .then(({ v, kept }) => {
          if (stopped) return;
          // As it is now: switched off, changed or resumed meanwhile, this judgment is of a watcher that is no more.
          const w = store.routinesAll().find((x) => x.project === project && x.r.id === r.id)?.r;
          if (!w || !watches(w) || judgedKey(project, w) !== key) return;
          if (kept) places.set(key, v);
          else places.delete(key);
          if (v.ok) return void sync();
          log("warn", `watchers: “${r.title}” of ${project} follows no branch: ${v.error}`);
          troubled(project, r.id, v.error);
        })
        .catch((/** @type {any} */ e) => log("warn", `watchers: a watcher's place was not judged (${e?.message || e})`))
        .then(() => void judging.delete(p));
      judging.add(p);
    }
    for (const k of [...places.keys()]) if (!live.has(k)) places.delete(k);
  }

  /** Each branch a watcher looks at is watched, each other one let go; each watched looks again (one resumed starts over). */
  function sync() {
    if (stopped) return;
    if (foldersOf) judgePlaces(foldersOf);
    /** @type {Map<string, { place: string, branch: string }>} */
    const wanted = new Map();
    for (const { project, r } of store.routinesAll()) {
      if (!watches(r) || r.trigger?.kind !== "commit") continue;
      const place = placeOf(project, r);
      if (place) wanted.set(keyOf(place, r.trigger.branch), { place, branch: r.trigger.branch });
    }
    for (const [key, b] of branches) {
      if (wanted.has(key)) continue;
      b.w?.stop();
      if (b.retry) clearTimeout(b.retry);
      branches.delete(key);
    }
    for (const [key, { place, branch }] of wanted) {
      const had = branches.get(key);
      if (had) {
        // A watcher that came to a branch not read now has its trouble too.
        if (had.trouble) for (const { project, r } of watchersOf(key)) troubled(project, r.id, had.trouble);
        void lookSoon(key);
        continue;
      }
      /** @type {Watched} */
      const b = { place, branch, w: null, head: undefined, tips: new Map(), startedAt: now(), busy: Promise.resolve(), retry: null, trouble: null };
      branches.set(key, b);
      b.w = watch(place, branch, {
        onHead: (head) => {
          const tip = head ?? NO_BRANCH;
          b.tips.delete(tip);
          b.tips.set(tip, now());
          for (const k of b.tips.keys()) {
            if (b.tips.size <= TIPS_KEPT) break;
            b.tips.delete(k);
          }
          b.head = head;
          void lookSoon(key);
        },
        // Its watchers' trouble while it cannot be read; gone as it reads again.
        onError: (error) => {
          if (stopped) return;
          if (error) log("warn", `watchers: ${branch} in ${place} could not be read (${error})`);
          b.trouble = error;
          for (const { project, r } of watchersOf(key)) troubled(project, r.id, error);
        },
      });
    }
  }

  return {
    sync,
    /** A branch's watchers look now (the tests'). @param {string} place @param {string} branch */
    look: (place, branch) => lookSoon(keyOf(place, branch)),
    /** The branches watched, each with the tip it last read (the tests'). */
    watched: () => new Map([...branches].map(([k, b]) => [k, b.head])),
    /** Every place's judgment and every look under way, settled (the tests'). */
    settled: async () => {
      while (judging.size) await Promise.all([...judging]);
      await Promise.all([...branches.values()].map((b) => b.busy));
    },
    /** Every watch stopped (the server's stop). */
    stop() {
      stopped = true;
      for (const b of branches.values()) {
        b.w?.stop();
        if (b.retry) clearTimeout(b.retry);
      }
      branches.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createCommitWatch>} CommitWatch */
