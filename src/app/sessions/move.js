// @ts-check
// A chat moved to another place of its repository, its own uncommitted files with it (HarnessV4_Git_Plan §12): into a
// new worktree made for it, or a place the repository has. What goes is what its agents changed there and nothing else
// (GW-D69): each file as its agent left it (GW-D80), whose whole uncommitted change is theirs (GW-D87), carried by
// git's own restore from snapshots (GW-D82), all or nothing (GW-D71), under the chat's turn lock (GW-D83). The move is
// kept in the chat's meta (GW-D86) and as two rounds of the chat's changes, out of one place and into the other
// (GW-D88); it goes back while no turn has run since (GW-D79). The agent is told at its next turn (core/move-note.js,
// GW-D72).
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeCwd } from "../../core/project-id.js";
import { blobsAt, blobsAtEach, blobsNow, dirtyOf, toLastCommit, writeAs } from "../../adapters/git/carry.js";
import { ownChangesOf } from "../../adapters/git/changes.js";
import { NO_LOCKS, parsePorcelainV2, placeInfo } from "../../adapters/git/inspect.js";
import { folderThere } from "../../adapters/git/folder-there.js";
import { makeWorktree, planWorktree, takeBack, worktreesOf } from "../../adapters/git/places.js";
import { git, placeOf, refNameOf, snapshotTree } from "../../adapters/git/snapshot.js";
import { runningShellsOf } from "../../adapters/tools/hands.js";
import { folderVerdict, newFolderRefusal, shareKeptOut } from "../agent/turn.js";
import { refusal } from "./service.js";

/**
 * A folder looked at off the server's thread first, a moment at most (inspect.js `folderThere`): one on a drive or share
 * that does not answer is refused in words, never looked at again on the thread, which would wait as long as the share.
 * A share the folder rules keep out is not asked: the fence refuses it unasked.
 * @param {any} cfg @param {string} folder
 */
const answering = async (cfg, folder) => {
  if (folder && !shareKeptOut(cfg, folder) && (await folderThere(folder)) === null) throw refusal(503, `${folder} does not answer: its drive or share is offline, or too slow to say`);
};

/** The turn lock's window while a chat moves: a send then waits for the move, as it waits for a coding agent's own turn. */
export const MOVE_WINDOW = "move";
/** The lock holder's client while a chat moves: the page's waiting line names it. */
const MOVE_CLIENT = "the move to another folder";
/** Where a move's snapshots are kept, so git holds every byte it carried (GW-D86). */
const MOVE_REF_PREFIX = "refs/filament/moves/";
/** Why one of the chat's files stays where it is, in the sheet's words. */
export const STAYS = Object.freeze({
  also: "someone else changed it too",
  changed: "changed since its agent last wrote it",
  mixed: "not all of its uncommitted change is its agents'",
  committed: "committed",
  odd: "not a plain file",
});
/** The ignored names the sheet shows at most (GW-D73). */
const IGNORED_MAX = 5;

/**
 * @typedef {import("../../adapters/git/changes.js").OwnFile} OwnFile
 * @typedef {{ path: string, oldPath: string | null, status: string, added: number, removed: number, agent: string }}
 *   MovedFile
 * @typedef {object} MoveRecord  one move of a chat, kept in its meta's `moves` (GW-D86)
 * @property {string} id
 * @property {number} at
 * @property {number} atTurn  the chat's newest turn when it moved: the next is the first in the new place
 * @property {{ place: string, cwd: string, branch: string | null, head: string | null }} from
 * @property {{ place: string, cwd: string, branch: string | null }} to
 * @property {{ name: string, branch: string, folder: string, main: string, commit: string } | null} made  the worktree
 *   the move made, which Move back takes back
 * @property {MovedFile[]} files
 * @property {string[]} [copy]  what the project's worktree template copies into the worktree the move made (FOC-67)
 * @property {{ from: string | null, fromAfter: string | null, toBefore: string | null, toAfter: string | null }} snaps
 * @property {{ turnId: number, seqs: number[] } | null} rounds  the rounds it recorded (GW-D88)
 * @property {{ cwd: string | null, worktree: string | null, places: string[] | null }} was  the chat's meta before it
 * @property {boolean} told  the agent's turn that heard of it ran to its end
 */

/** @param {string} p */
const realOf = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
/** `inner` is `outer` or in it. @param {string} outer @param {string} inner */
const within = (outer, inner) => {
  const r = relative(resolve(outer), resolve(inner));
  return !r || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
};
/** @param {string | null | undefined} a @param {string | null | undefined} b */
const same = (a, b) => (a ?? null) === (b ?? null);
/** A file's paths: a rename goes with its old path. @param {{ path: string, oldPath: string | null }} f */
const pathsOf = (f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]);
/** A place's name as the sheet and the agent read it. @param {string} place */
const nameOf = (place) => basename(resolve(place));

/**
 * A move as the conversation's row shows it (GW-D77): from where to where, its files; `undoable` while no turn has run
 * since and it is the chat's newest (GW-D79).
 * @param {MoveRecord} m @param {{ newest: boolean, turns: number }} o
 */
export const movedBoundary = (m, { newest, turns }) => ({
  type: "moved",
  id: m.id,
  at: m.at,
  afterTurn: m.atTurn,
  from: nameOf(m.from.cwd),
  to: nameOf(m.to.cwd),
  branch: m.to.branch,
  files: m.files.length,
  undoable: newest && turns === m.atTurn,
});

/**
 * The folder the chat moved to since its turn `n` ended — the name of the newest move's, where it came after that
 * turn — else null: why a coding agent has no session of the chat where it works now (its sessions are by folder).
 * @param {any} meta @param {number | null | undefined} n
 */
export function movedSince(meta, n) {
  const m = Array.isArray(meta?.moves) ? meta.moves.at(-1) : null;
  return m && Number(m.atTurn) >= (Number(n) || 0) ? nameOf(m.to.cwd) : null;
}

/**
 * `copies` copy a project's worktree template into a worktree a move made, `templateOf` names a place's list
 * (HarnessV4_Four_Plan E19); absent, nothing is copied. `moved`: told once a chat's folder changed, a move's or its
 * taking back (the sessions service's `copyMoved`: a chat out of the copy Run on placed for it leaves it).
 * @param {{ memory: any, config: { get: () => any },
 *   sessionTurns?: import("../../services/session-turns.js").SessionTurns | null, cwdOf: (chain: any) => string,
 *   busyOf: (chain: any) => string | null, log?: (level: string, msg: string) => void, now?: () => number,
 *   copies?: import("./copies.js").WorktreeCopies | null, templateOf?: (place: string) => string[], moved?: (chainId: string) => void }} deps
 */
export function createChatMove({ memory, config, sessionTurns = null, cwdOf, busyOf, log = () => {}, now = Date.now, copies = null, templateOf = () => [], moved = () => {} }) {
  /** The chats moving now: a second click is told so. @type {Set<string>} */
  const moving = new Set();
  const archive = () => {
    if (!memory.archive) throw new Error(`no archive: ${memory.archiveWhy()}`);
    return memory.archive;
  };
  /** @param {string} id */
  const chainOf = (id) => {
    const chain = archive().getChain(String(id || ""));
    if (!chain) throw new Error("no such session");
    return chain;
  };
  /** Why a worktree made from `from` could not be worked in, as `newFolderRefusal` says it. @param {string} from */
  const refuse = (from) => (/** @type {string} */ folder) => newFolderRefusal(config.get(), folder, { from });

  /**
   * Which of the chat's files in a place go, and which stay with why (GW-D69, GW-D80, GW-D87).
   * @param {any} chain @param {string} place
   * @returns {Promise<{ goes: OwnFile[], stays: (OwnFile & { why: string })[], now: Map<string, string | null> }>}
   */
  async function sortFiles(chain, place) {
    const rounds = memory.roundsOf(chain.id).rounds.filter((/** @type {any} */ r) => r.place === place);
    if (!rounds.length) return { goes: [], stays: [], now: new Map() };
    const own = await ownChangesOf(rounds, { alone: memory.placesAlone(chain.id, [place]) });
    if (own.errors.length) throw refusal(409, `its changes there could not be read: ${own.errors[0].error}`);
    /** @type {Map<string, OwnFile>} */
    const byPath = new Map();
    for (const f of own.files) {
      const had = byPath.get(f.path);
      byPath.set(f.path, had ? { ...had, also: true } : f);
    }
    const files = [...byPath.values()];
    const paths = [...new Set(files.flatMap(pathsOf))];
    const newest = memory.lastInPlace(chain.id, place);
    const [current, last, head] = await Promise.all([blobsNow(place, paths), blobsAt(place, newest || "HEAD", paths), blobsAt(place, "HEAD", paths)]);
    if (!current.ok || !last.ok || !head.ok) throw refusal(409, `its files there could not be read: ${[current, last, head].map((r) => (r.ok ? "" : r.error)).find(Boolean)}`);
    // What each file held as its agents worked on it: before the first round that named it, and after each round
    // that did. A last commit holding one of those took the agents' own work.
    /** @type {Map<string, Set<string>>} */
    const states = new Map();
    /** @param {string | null} commit @param {string} p */
    const note = (commit, p) => {
      if (commit) states.set(commit, new Set([...(states.get(commit) || []), p]));
    };
    for (const f of files) for (const p of pathsOf(f)) note(f.from, p);
    for (const r of rounds) for (const p of r.own) if (paths.includes(p)) note(r.after, p);
    // All of them in one git call: one each was a git process a snapshot, which made a long chat's read last a minute.
    const at = await blobsAtEach(place, new Map([...states].map(([commit, ps]) => [commit, [...ps]])));
    if (!at.ok) throw refusal(409, `its files there could not be read: ${at.error}`);
    const held = at.held;
    /**
     * What its agents' work held of `p`: from before it began, and after each of its rounds.
     * @param {OwnFile} f @param {string} p
     */
    const theirs = (f, p) => {
      const out = [f.from ? (held.get(f.from)?.get(p) ?? null) : null];
      for (const r of rounds) if (r.after && r.own.includes(p)) out.push(held.get(r.after)?.get(p) ?? null);
      return out;
    };
    const odd = new Set(current.odd);
    /** @type {OwnFile[]} */
    const goes = [];
    /** @type {(OwnFile & { why: string })[]} */
    const stays = [];
    for (const f of files) {
      const ps = pathsOf(f);
      const why = f.also
        ? STAYS.also
        : ps.some((p) => odd.has(p))
          ? STAYS.odd
          : ps.some((p) => !same(current.blobs.get(p), last.blobs.get(p)))
            ? STAYS.changed
            : ps.every((p) => same(current.blobs.get(p), head.blobs.get(p)))
              ? STAYS.committed
              : ps.some((p) => !theirs(f, p).some((b) => same(b, head.blobs.get(p))))
                ? STAYS.mixed
                : null;
      if (why) stays.push({ ...f, why });
      else goes.push(f);
    }
    return { goes, stays, now: current.blobs };
  }

  /**
   * Where the chat would go and what would go with it, read now (GW-D84): the sheet's answer, and the click's check.
   * `to`: `{ name, made? }` for a new worktree (`made`: a name the page made, which gives way to a free one), or
   * `{ place }` for a place of the repository. `blocked`: why Move cannot run, in words. `locked`: read by the move
   * itself, under the turn lock it took once the chat was free.
   * @param {any} chain @param {{ name?: string, made?: boolean, place?: string }} to @param {{ locked?: boolean }} [o]
   */
  async function planOf(chain, to, { locked = false } = {}) {
    const cwd = cwdOf(chain);
    await answering(config.get(), cwd);
    const v = folderVerdict(config.get(), cwd);
    if (!v.ok) throw refusal(409, `the chat's folder cannot be worked in (${cwd || "none"}): a chat moves from a folder of a repository`);
    const here = await placeInfo(v.root);
    if (!here.ok || !here.place) throw refusal(409, `${here.error || "not in a git repository"}: a chat moves between a repository's folder and its worktrees`);
    if (!here.head) throw refusal(409, "its branch has no commit yet: a worktree starts at a commit");
    const place = here.place;
    const below = relative(resolve(place), realOf(v.root));
    const rel = below && !below.startsWith("..") ? below.split(sep).join("/") : "";
    /** @type {string[]} */
    const blocked = [];
    const busy = locked ? null : busyOf(chain);
    if (busy) blocked.push(busy);
    const { goes, stays, now: blobs } = await sortFiles(chain, place);
    const carry = [...new Set(goes.flatMap(pathsOf))];
    const under = (/** @type {string} */ dir) => carry.some((p) => p.startsWith(`${dir}/`));
    const lacks = (/** @type {string} */ where) => `${rel} would not be in ${where}: the chat works in that folder of its repository`;
    /** @type {any} */
    let target;
    if (to?.place) {
      const list = await worktreesOf(place);
      if (!list.ok) throw refusal(409, list.error || "the repository's worktrees could not be read");
      const w = list.worktrees.find((x) => normalizeCwd(x.path) === normalizeCwd(String(to.place)));
      if (!w) throw refusal(404, `not a folder or worktree of this repository: ${to.place}`);
      if (normalizeCwd(w.path) === normalizeCwd(place)) throw refusal(409, "the chat works there already");
      if (w.prunable != null) throw refusal(409, `${w.path} is gone: git would prune it`);
      await answering(config.get(), w.path);
      const fence = folderVerdict(config.get(), w.path);
      if (!fence.ok) throw refusal(403, `Filament's agent may not work in ${w.path}`);
      const there = await placeInfo(w.path);
      target = { new: false, place: w.path, name: nameOf(w.path), branch: there.branch, head: there.head, cwd: rel ? join(resolve(w.path), rel) : resolve(w.path) };
      if (carry.length) {
        const [mine, theirs, dirty] = await Promise.all([blobsAt(place, "HEAD", carry), blobsAt(w.path, "HEAD", carry), dirtyOf(w.path, carry)]);
        if (!mine.ok || !theirs.ok || !dirty.ok) throw refusal(409, `the files could not be compared: ${[mine, theirs, dirty].map((r) => (r.ok ? "" : r.error)).find(Boolean)}`);
        const differs = carry.filter((p) => !same(mine.blobs.get(p), theirs.blobs.get(p)));
        if (differs.length) blocked.push(`${differs.slice(0, 3).join(", ")}${differs.length > 3 ? ` and ${differs.length - 3} more` : ""} differ${differs.length === 1 ? "s" : ""} between the two commits: pick a new worktree, or move ${differs.length === 1 ? "it" : "them"} by hand`);
        if (dirty.dirty.length) blocked.push(`${dirty.dirty.slice(0, 3).join(", ")}${dirty.dirty.length > 3 ? ` and ${dirty.dirty.length - 3} more` : ""} ha${dirty.dirty.length === 1 ? "s" : "ve"} uncommitted changes in ${target.name}`);
      }
      if (rel && !existsSync(join(resolve(w.path), rel)) && !under(rel)) blocked.push(lacks(target.name));
    } else {
      const name = String(to?.name || "").trim();
      let plan = await planWorktree(place, name, { refuse: refuse(place) });
      if (plan.ok && plan.taken && to?.made === true && plan.free) plan = await planWorktree(place, plan.free, { refuse: refuse(place) });
      if (!plan.ok) throw refusal(409, plan.error);
      target = { new: true, name: plan.name, branch: plan.branch, folder: plan.folder, cwd: plan.folder && rel ? join(plan.folder, rel) : plan.folder, bad: plan.bad, taken: plan.taken, free: plan.free, refused: plan.refused };
      if (plan.bad) blocked.push(`“${plan.name}” is no branch name: ${plan.bad}`);
      else if (plan.taken) blocked.push(`${plan.taken === "folder" ? `the folder ${plan.folder}` : `the branch ${plan.name}`} is there already${plan.free ? `; ${plan.free} is free` : ""}`);
      if (plan.refused) blocked.push(plan.refused);
      if (rel && !under(rel)) {
        const kind = await git(["cat-file", "-t", `HEAD:${rel}`], { cwd: place });
        if (!(kind.code === 0 && kind.out.trim() === "tree")) blocked.push(lacks("the new worktree"));
      }
    }
    // Everyone else's uncommitted files, which stay (GW-D69), and what git ignores, which no move carries (GW-D73).
    const st = await git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--ignored"], { cwd: place });
    const listed = st.code === 0 ? parsePorcelainV2(st.out).files : [];
    const mineHere = new Set([...carry, ...stays.flatMap(pathsOf)]);
    const others = listed.filter((f) => f.kind !== "ignored" && !mineHere.has(f.path) && !(f.oldPath && mineHere.has(f.oldPath))).length;
    const ignored = listed.filter((f) => f.kind === "ignored").map((f) => f.path);
    const running = runningShellsOf(chain.id)
      .filter((s) => within(place, s.cwd))
      .map((s) => ({ id: s.id, command: s.command, startedAt: s.startedAt }));
    return {
      chain,
      from: { place, cwd: resolve(cwd), name: nameOf(place), branch: here.branch, head: here.head, rel },
      to: target,
      goes,
      stays,
      carry,
      blobs,
      others,
      ignored: { names: ignored.slice(0, IGNORED_MAX), more: Math.max(0, ignored.length - IGNORED_MAX) },
      running,
      blocked,
    };
  }

  /** A plan as the sheet reads it. @param {Awaited<ReturnType<typeof planOf>>} p */
  const shown = (p) => ({
    from: { place: p.from.place, cwd: p.from.cwd, name: p.from.name, branch: p.from.branch },
    to: p.to,
    goes: p.goes.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status, added: f.added, removed: f.removed, binary: f.binary, agent: f.agent, ...(f.via ? { via: f.via } : {}) })),
    stays: p.stays.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status, agent: f.agent, why: f.why })),
    others: p.others,
    ignored: p.ignored,
    running: p.running,
    blocked: p.blocked,
  });

  /**
   * The sheet's read (GW-D84). @param {string} chainId @param {{ name?: string, made?: boolean, place?: string }} to
   */
  async function read(chainId, to) {
    return shown(await planOf(chainOf(chainId), to));
  }

  /**
   * Move the chat (GW-D71): checked again under its turn lock, then its place snapshotted, the target made or
   * snapshotted, the files written there from the snapshot, checked unchanged where they were, put back to the last
   * commit there, both places snapshotted after, the rounds recorded, the chat's folder set. A step that fails undoes
   * the ones before it. `files`: the paths the sheet showed going: a list that changed since is refused with the new
   * read. `to.copy`: what a new worktree gets a copy of (HarnessV4_Four_Plan FOC-67); left out, the project's list.
   * @param {string} chainId
   * @param {{ to: { name?: string, made?: boolean, place?: string, copy?: string[] }, files?: string[] | null }} o
   */
  async function move(chainId, { to, files = null }) {
    const chain = chainOf(chainId);
    if (moving.has(chain.id)) throw refusal(409, "the chat is moving already");
    const busy = busyOf(chain);
    if (busy) throw refusal(409, `not moved: ${busy}`);
    const got = sessionTurns ? sessionTurns.acquire(chain.key, { window: MOVE_WINDOW, client: MOVE_CLIENT }) : { ok: true, token: null };
    if (!got.ok) throw refusal(409, "not moved: a turn of this chat began");
    moving.add(chain.id);
    try {
      return await moveHeld(chainOf(chain.id), to, files);
    } finally {
      moving.delete(chain.id);
      if (sessionTurns && got.token) sessionTurns.release(chain.key, got.token);
    }
  }

  /** @param {any} chain @param {{ name?: string, made?: boolean, place?: string, copy?: string[] }} to @param {string[] | null} files */
  async function moveHeld(chain, to, files) {
    const p = await planOf(chain, to, { locked: true });
    if (p.blocked.length) throw refusal(409, `not moved: ${p.blocked[0]}`, { plan: shown(p) });
    if (files && [...files].sort().join("\0") !== p.goes.map((f) => f.path).sort().join("\0"))
      throw refusal(409, "not moved: what goes changed since the sheet was read — read it again", { plan: shown(p) });
    const paths = p.carry;
    const id = randomUUID();
    const refs = `${MOVE_REF_PREFIX}${refNameOf(chain.id)}/${id}`;
    /** What a failed step's undo leaves, in words. @type {(() => Promise<string | null>)[]} */
    const undo = [];
    /** @param {string} why */
    const fail = async (why) => {
      const left = [];
      for (const step of undo.reverse()) {
        const stays = await step().catch((/** @type {any} */ e) => String(e?.message || e));
        if (stays) left.push(stays);
      }
      log(left.length ? "warn" : "info", `move: chat ${chain.id} not moved (${why})${left.length ? `; ${left.join("; ")}` : ""}`);
      return refusal(409, `not moved: ${why}${left.length ? ` (${left.join("; ")})` : ""}`);
    };
    /**
     * Each path's blob in `place` against the snapshot's, or the first that differs.
     * @param {string} place @param {string} commit
     */
    const differing = async (place, commit) => {
      const [current, at] = await Promise.all([blobsNow(place, paths), blobsAt(place, commit, paths)]);
      if (!current.ok || !at.ok) return { error: current.ok ? (at.ok ? "" : at.error) : current.error };
      return { path: paths.find((x) => !same(current.blobs.get(x), at.blobs.get(x))) || null };
    };
    // The chat's place as it stands: every carried byte is read from this commit.
    let from = null;
    if (paths.length) {
      const snap = await snapshotTree(p.from.place, { name: `move ${id}`, ref: `${refs}/from` });
      if (!snap.ok || !snap.at) throw await fail(`its folder could not be snapshotted: ${snap.error}`);
      from = snap.at;
      // Each file as the check read it, or the move stops (GWC-167).
      const at = await blobsAt(p.from.place, from, paths);
      if (!at.ok) throw await fail(at.error);
      const changed = paths.find((x) => !same(at.blobs.get(x), p.blobs.get(x)));
      if (changed) throw await fail(`${changed} changed as the move began`);
    }
    // Where it goes: a new worktree, or a place that has nothing uncommitted on its paths.
    /** @type {Extract<Awaited<ReturnType<typeof makeWorktree>>, { ok: true }> | null} */
    let made = null;
    /** @type {string} */
    let place;
    let toBefore = null;
    if (p.to.new) {
      const m = await makeWorktree(p.from.place, String(p.to.name), { refuse: refuse(p.from.place) });
      if (!m.ok) throw refusal(409, `not moved: ${m.error}`, m.free ? { free: m.free } : {});
      made = m;
      undo.push(() => takeBack(m));
      place = (await placeOf(m.folder)).place || m.folder;
      toBefore = m.commit;
      log("info", `git: the worktree ${m.folder} made on branch ${m.branch} for chat ${chain.id}'s move`);
    } else {
      place = String(p.to.place);
      if (paths.length) {
        const dirty = await dirtyOf(place, paths);
        if (!dirty.ok) throw await fail(dirty.error);
        if (dirty.dirty.length) throw await fail(`${dirty.dirty[0]} has uncommitted changes in ${p.to.name} now`);
        const snap = await snapshotTree(place, { name: `move ${id} into`, ref: `${refs}/to-before` });
        if (!snap.ok) throw await fail(`${p.to.name} could not be snapshotted: ${snap.error}`);
        toBefore = snap.at || null;
      }
    }
    const target = place;
    if (paths.length && from) {
      const source = from;
      const wrote = await writeAs(target, source, paths);
      if (!p.to.new) undo.push(async () => ((await toLastCommit(target, paths)).ok ? null : `its files stay in ${p.to.name}, uncommitted`));
      if (!wrote.ok) throw await fail(`git could not write its files in ${p.to.name}: ${wrote.error}`);
      const changed = await differing(p.from.place, source);
      if (changed.error) throw await fail(changed.error);
      if (changed.path) throw await fail(`${changed.path} changed in ${p.from.name} during the move`);
      const out = await toLastCommit(p.from.place, paths);
      if (!out.ok) {
        const back = await writeAs(p.from.place, source, paths);
        throw await fail(`git could not take its files out of ${p.from.name}: ${out.error}${back.ok ? "" : `; they are as the snapshot ${source.slice(0, 10)} holds them there only in part`}`);
      }
    }
    // Done: nothing below undoes the move. Both places snapshotted after it, for its rounds.
    /** @type {MoveRecord["snaps"]} */
    const snaps = { from, fromAfter: null, toBefore, toAfter: null };
    /** @type {MoveRecord["rounds"]} */
    let rounds = null;
    const turnN = archive().newestTurnN(chain.id);
    if (paths.length && from && toBefore) {
      const [a, b] = await Promise.all([
        snapshotTree(p.from.place, { name: `move ${id} out`, ref: `${refs}/from-after`, previous: from }),
        snapshotTree(target, { name: `move ${id} in`, ref: `${refs}/to-after`, previous: toBefore }),
      ]);
      snaps.fromAfter = a.ok ? a.at || null : null;
      snaps.toAfter = b.ok ? b.at || null : null;
      const turnId = turnN ? archive().getTurns(chain.id, { from: turnN, to: turnN })[0]?.id : null;
      if (turnId && snaps.fromAfter && snaps.toAfter) {
        /** @type {Map<string, string[]>} */
        const byAgent = new Map();
        for (const f of p.goes) byAgent.set(f.agent, [...(byAgent.get(f.agent) || []), ...pathsOf(f)]);
        /** @type {number[]} */
        const seqs = [];
        for (const [agent, own] of byAgent) {
          for (const r of [
            { place: p.from.place, before: from, after: snaps.fromAfter },
            { place: target, before: toBefore, after: snaps.toAfter },
          ]) {
            const seq = memory.recordRoundChange(turnId, { ...r, round: null, agent, base: "move", own, command: false });
            if (seq != null) seqs.push(seq);
          }
        }
        rounds = { turnId, seqs };
      } else log("warn", `move: chat ${chain.id}'s changes tab keeps its files in ${p.from.name}: ${!turnId ? "no turn to file the move on" : "a place could not be snapshotted after the move"}`);
    }
    const meta = chain.meta || {};
    const was = { cwd: typeof meta.cwd === "string" && meta.cwd ? meta.cwd : null, worktree: meta.tree?.worktree ? String(meta.tree.worktree) : null, places: Array.isArray(meta.places) ? meta.places.map(String) : null };
    const cwd = p.from.rel ? join(resolve(target), p.from.rel) : resolve(target);
    // A new worktree gets its project's template copied in (HarnessV4_Four_Plan FOC-67): the paths the sheet left on,
    // else the project's list; the chat's next turn waits for it (FO-D36), and its agent is told what comes.
    const copy = made ? (Array.isArray(to?.copy) ? to.copy.map(String) : templateOf(p.from.place)) : [];
    /** @type {MoveRecord} */
    const rec = {
      id,
      at: now(),
      atTurn: turnN,
      from: { place: p.from.place, cwd: p.from.cwd, branch: p.from.branch, head: p.from.head },
      to: { place: target, cwd, branch: made ? made.branch : p.to.branch },
      made: made ? { name: made.name, branch: made.branch, folder: made.folder, main: made.main, commit: made.commit } : null,
      files: p.goes.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status, added: f.added, removed: f.removed, agent: f.agent })),
      ...(copy.length ? { copy } : {}),
      snaps,
      rounds,
      was,
      told: false,
    };
    // The old place is followed no more, and the new one is the chat's folder (GW-D76).
    const places = (was.places || []).filter((x) => normalizeCwd(x) !== normalizeCwd(p.from.place) && normalizeCwd(x) !== normalizeCwd(target));
    archive().mergeMeta(chain.id, {
      cwd,
      places: places.length ? places : undefined,
      moves: [...(Array.isArray(meta.moves) ? meta.moves : []), rec],
      ...(was.worktree ? { tree: { ...meta.tree, worktree: cwd } } : {}),
    });
    memory.sessionLists?.clear?.();
    moved(chain.id);
    log("info", `move: chat ${chain.id} moved from ${p.from.cwd} to ${cwd} with ${rec.files.length} file(s)`);
    if (made && copy.length) copies?.start(chain.id, { from: p.from.place, to: made.folder, paths: copy });
    return { ok: true, move: movedBoundary(rec, { newest: true, turns: turnN }), cwd, running: p.running };
  }

  /**
   * Take the chat's newest move back (GW-D79): only while no turn has run since, its files are still as it carried
   * them, and the old place has nothing uncommitted on their paths nor a commit that changed them. The worktree the
   * move made goes too, where it holds nothing else.
   * @param {string} chainId @param {string} id
   */
  async function back(chainId, id) {
    const chain = chainOf(chainId);
    /** @type {MoveRecord[]} */
    const moves = Array.isArray(chain.meta?.moves) ? chain.meta.moves : [];
    const rec = moves.find((m) => m.id === id);
    if (!rec) throw refusal(404, "no such move of this chat");
    if (moves.at(-1)?.id !== id) throw refusal(409, "only the chat's newest move goes back");
    if (archive().newestTurnN(chain.id) !== rec.atTurn) throw refusal(409, `a turn ran in ${nameOf(rec.to.cwd)} since: move the chat with Move to a worktree… instead`);
    if (moving.has(chain.id)) throw refusal(409, "the chat is moving already");
    const busy = busyOf(chain);
    if (busy) throw refusal(409, `not moved back: ${busy}`);
    const got = sessionTurns ? sessionTurns.acquire(chain.key, { window: MOVE_WINDOW, client: MOVE_CLIENT }) : { ok: true, token: null };
    if (!got.ok) throw refusal(409, "not moved back: a turn of this chat began");
    moving.add(chain.id);
    try {
      return await backHeld(chainOf(chain.id), rec);
    } finally {
      moving.delete(chain.id);
      if (sessionTurns && got.token) sessionTurns.release(chain.key, got.token);
    }
  }

  /** @param {any} chain @param {MoveRecord} rec */
  async function backHeld(chain, rec) {
    const paths = [...new Set(rec.files.flatMap(pathsOf))];
    const fromName = nameOf(rec.from.cwd);
    const toName = nameOf(rec.to.cwd);
    // A place gone since — the worktree a Remove moved the chat out of (the owner's of 11-09) — takes no chat back,
    // files or none: its folder would name nothing.
    await Promise.all([answering(config.get(), rec.from.place), answering(config.get(), rec.to.place)]);
    if (!existsSync(rec.from.place)) throw refusal(409, `not moved back: ${rec.from.place} is gone`);
    if (paths.length && rec.snaps.from) {
      if (!existsSync(rec.to.place) || !existsSync(rec.from.place)) throw refusal(409, `not moved back: ${existsSync(rec.to.place) ? rec.from.place : rec.to.place} is gone`);
      const [there, carried, headNow, headThen] = await Promise.all([
        blobsNow(rec.to.place, paths),
        blobsAt(rec.to.place, rec.snaps.from, paths),
        blobsAt(rec.from.place, "HEAD", paths),
        blobsAt(rec.from.place, String(rec.from.head), paths),
      ]);
      if (!there.ok || !carried.ok || !headNow.ok || !headThen.ok)
        throw refusal(409, `not moved back: ${[there, carried, headNow, headThen].map((r) => (r.ok ? "" : r.error)).find(Boolean)}`);
      const changed = paths.find((x) => !same(there.blobs.get(x), carried.blobs.get(x)));
      if (changed) throw refusal(409, `not moved back: ${changed} changed in ${toName} since the move`);
      // The old place is looked at last, just before its files are written: an edit saved there while the rest was read
      // stops it.
      const dirty = await dirtyOf(rec.from.place, paths);
      if (!dirty.ok) throw refusal(409, `not moved back: ${dirty.error}`);
      if (dirty.dirty.length) throw refusal(409, `not moved back: ${dirty.dirty[0]} has uncommitted changes in ${fromName} now`);
      const committed = paths.find((x) => !same(headNow.blobs.get(x), headThen.blobs.get(x)));
      if (committed) throw refusal(409, `not moved back: a commit in ${fromName} changed ${committed} since the move`);
      const wrote = await writeAs(rec.from.place, rec.snaps.from, paths);
      if (!wrote.ok) {
        await toLastCommit(rec.from.place, paths);
        throw refusal(409, `not moved back: git could not write its files in ${fromName}: ${wrote.error}`);
      }
      const out = await toLastCommit(rec.to.place, paths);
      if (!out.ok) {
        await toLastCommit(rec.from.place, paths);
        throw refusal(409, `not moved back: git could not take its files out of ${toName}: ${out.error}`);
      }
    }
    // The worktree the move made goes where nothing else is in it: no file uncommitted, no commit of its own.
    let left = null;
    if (rec.made) {
      // A template still copying in would write into the worktree as it goes: it ends first, said so on its row.
      await copies?.stop(chain.id, "the chat moved back");
      const [st, tip] = await Promise.all([
        git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: rec.made.folder }),
        git(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { cwd: rec.made.folder }),
      ]);
      const clean = st.code === 0 && !parsePorcelainV2(st.out).files.some((f) => f.kind !== "ignored");
      if (!clean) left = `the worktree ${rec.made.folder} stays: it has uncommitted changes of its own`;
      else if (tip.out.trim() !== rec.made.commit) left = `the worktree ${rec.made.folder} stays: its branch has commits of its own`;
      else left = await takeBack(rec.made);
    }
    if (rec.rounds) memory.dropRoundChanges(rec.rounds.turnId, rec.rounds.seqs);
    const meta = chain.meta || {};
    archive().mergeMeta(chain.id, {
      cwd: rec.was.cwd ?? undefined,
      places: rec.was.places ?? undefined,
      moves: (Array.isArray(meta.moves) ? meta.moves : []).filter((/** @type {MoveRecord} */ m) => m.id !== rec.id),
      ...(meta.tree?.worktree || rec.was.worktree ? { tree: { ...meta.tree, worktree: rec.was.worktree ?? undefined } } : {}),
    });
    memory.sessionLists?.clear?.();
    moved(chain.id);
    log(left ? "warn" : "info", `move: chat ${chain.id} moved back to ${rec.from.cwd}${left ? `; ${left}` : ""}`);
    return { ok: true, cwd: cwdOf(chainOf(chain.id)), left };
  }

  return { read, move, back };
}
