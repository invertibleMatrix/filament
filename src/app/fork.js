// @ts-check
// The save-state fork with its working tree (plan WP-J.2): the archive half forks the conversation (J.1); this adds
// the files. When the fork turn has a snapshot (the agent loop wrote one after a round that wrote), the caller may
// ask for a worktree: the snapshot commit checked out, detached, beside the repository — or into a folder they name.
// The conversation fork always happens; a worktree that cannot be made is said in words on the result, never a 500.
// The worktree is Filament's, marked for its chat (places.js `markFork`), and goes when that chat is deleted
// (`dropForksOf`, the owner's of 11-09), what it held kept on a ref first.
import { addWorktree } from "../adapters/git/snapshot.js";
import { forkHeldBack, forksOf, markFork, removeFork } from "../adapters/git/places.js";
import { reposOf } from "../adapters/git/worktree.js";
import { normalizeCwd } from "../core/project-id.js";

/**
 * @typedef {object} ForkArgs
 * @property {number} atTurn
 * @property {boolean | string} [worktree]  true: a sibling folder of the repository; a string: that folder
 */

/**
 * @param {{ memory: any }} deps
 * @param {string} chainId
 * @param {ForkArgs} args
 */
export async function forkSession({ memory }, chainId, { atTurn, worktree = false }) {
  const fork = memory.forkSession(chainId, { atTurn });
  if (!worktree) return fork;
  const tree = fork.tree || { snapshotRef: null };
  if (!tree.snapshotRef)
    return {
      ...fork,
      tree: { ...tree, worktree: null, note: `turn ${atTurn} has no working-tree snapshot (the loop wrote nothing under it, or the folder has no git); the conversation is forked, the files are not` },
    };
  const project = memory.archive?.getProject?.(memory.archive.getChain(fork.chainId)?.project_id);
  const folder = project?.cwd;
  if (!folder)
    return { ...fork, tree: { ...tree, worktree: null, note: "the session's project has no folder on record, so there is nowhere to check the snapshot out from" } };
  // From here on the fork exists: whatever fails is a note on the result, never a throw that would leave the caller a
  // fork it was not told of.
  let w;
  try {
    w = await addWorktree(folder, {
      ref: tree.snapshotRef,
      dest: typeof worktree === "string" && worktree.trim() ? worktree.trim() : null,
      suffix: fork.chainId,
    });
  } catch (/** @type {any} */ e) {
    return { ...fork, tree: { ...tree, worktree: null, note: `the worktree could not be made: ${String(e?.message || e).slice(0, 200)}` } };
  }
  if (!w.ok) return { ...fork, tree: { ...tree, worktree: null, note: w.error } };
  markFork(w.path, { chain: fork.chainId, commit: w.commit });
  try {
    const saved = memory.setSessionWorktree(fork.chainId, w.path);
    return { ...fork, tree: { ...saved, commit: w.commit } };
  } catch (/** @type {any} */ e) {
    return { ...fork, tree: { ...tree, worktree: w.path, commit: w.commit, note: `the worktree is at ${w.path} but the session's row could not record it: ${String(e?.message || e).slice(0, 200)}` } };
  }
}

/**
 * The forks' worktrees of deleted chats go (the owner's of 11-09): in each repository the folders are in, each fork
 * marked for one of the chats (places.js `forksOf`) is removed — what it held that its commit did not kept first on
 * `refs/filament/forks/<chat>/kept`, said in the log with where, and what git ignored there, which went with it. One
 * whose folder someone uses — a chat at work there, its own chat still at work, a project or another chat in it —, a
 * locked one, one holding submodules, or one whose content could not be kept, stays (`forkHeldBack`), and the log says
 * why; `busy`, only its own chat's work keeps it, which that work's end lets go (the review of 11-09). What went and what
 * stayed; nothing throws.
 * @param {readonly string[]} chainIds
 * @param {{ folders: readonly string[], log?: (level: string, msg: string) => void,
 *   chatsIn?: (paths: string[]) => Map<string, { id: string, name: string }[]>, projects?: () => string[],
 *   atWork?: () => Set<string> }} o  `chatsIn`: the chats in each folder (memory's); `projects`: the projects' folders;
 *   `atWork`: the chats at work now
 * @returns {Promise<{ gone: { chain: string, path: string, kept: string | null }[], stayed: { chain: string, path: string, why: string, busy: boolean }[] }>}
 */
export async function dropForksOf(chainIds, { folders, log = () => {}, chatsIn = () => new Map(), projects = () => [], atWork = () => new Set() }) {
  const ids = new Set(chainIds.map(String));
  /** @type {{ chain: string, path: string, kept: string | null }[]} */
  const gone = [];
  /** @type {{ chain: string, path: string, why: string, busy: boolean }[]} */
  const stayed = [];
  if (!ids.size) return { gone, stayed };
  /**
   * Who uses a fork's folder now: why it stays, and whether its own chat's work alone keeps it. `chats`: the chats in
   * its folder, as `chatsIn` read them.
   * @param {import("../adapters/git/places.js").Fork} f @param {Map<string, { id: string, name: string }[]>} [chats]
   */
  const usedBy = (f, chats = chatsIn([f.path])) => {
    const k = normalizeCwd(f.path);
    const busy = atWork();
    const others = {
      chats: (chats.get(f.path) || []).map((c) => ({ name: c.name, atWork: busy.has(String(c.id)) })),
      projects: projects().filter((p) => normalizeCwd(p) === k || normalizeCwd(p).startsWith(`${k}/`)),
    };
    const why = forkHeldBack(f, { ...others, own: busy.has(f.chain) });
    return { why, busy: !!why && !forkHeldBack(f, others) };
  };
  const { repos } = await reposOf(folders).catch(() => ({ repos: [] }));
  for (const r of repos) {
    try {
      const read = await forksOf(r.repo);
      if (!read.ok) continue;
      const mine = read.forks.filter((x) => ids.has(x.chain));
      if (!mine.length) continue;
      // Who uses each folder, read as the removals start, and again just before each moves, what it holds kept by then
      // — which can take a minute: none of them is moved away under anyone.
      const chats = chatsIn(mine.map((f) => f.path));
      for (const f of mine) {
        let use = usedBy(f, chats);
        const done = use.why ? { ok: /** @type {const} */ (false), error: use.why, inUse: /** @type {const} */ (true) } : await removeFork(read.main || read.common, f, { using: () => (use = usedBy(f)).why });
        if (!done.ok) {
          stayed.push({ chain: f.chain, path: f.path, why: done.error, busy: !!done.inUse && use.busy });
          log("warn", `forks: the worktree ${f.path} of deleted chat ${f.chain} stays: ${done.error}`);
          continue;
        }
        gone.push({ chain: f.chain, path: f.path, kept: done.kept });
        const ignored = done.ignored?.names.length ? `; what git ignored there went with it: ${done.ignored.names.map((n) => (n.link ? `${n.path} (a link, removed as one)` : n.path)).join(", ")}${done.ignored.more ? ` and ${done.ignored.more} more` : ""}` : "";
        log("info", `forks: the worktree ${f.path} of deleted chat ${f.chain} removed${done.kept ? `; what it held is kept on ${done.kept} in ${r.repo}` : ""}${ignored}${done.left ? `; what could not be deleted is at ${done.left}` : ""}`);
      }
    } catch (/** @type {any} */ e) {
      log("warn", `forks: the forks of deleted chats in ${r.repo} could not be read (${e?.message || e})`);
    }
  }
  return { gone, stayed };
}
