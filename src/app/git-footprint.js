// @ts-check
// Filament's footprint in a repository (the footprint plan, Phase 7), read and cleaned up: its copies, its refs under
// `refs/filament/` and the branches it made for its routines' runs, each with whether Clean up takes it, why it stays,
// or whether it goes only ticked (core/footprint.js). Read from git and the disk (adapters/git/footprint.js, worktree.js
// `copiesOf`); from the sub-agent registry, its word on each helper the refs and copies name (`known`) and the copies
// its helpers and checks use now; from the archive, which chats Filament has, which it deleted — when, with the
// helpers they kept (`goneChains`) — since when it keeps its deletes (`goneSince`), and which Undo points a fork names;
// from memory's backups, since when one kept may hold a chat (`backups`); from the Spaces, the routines whose project is
// in the repository. What this Filament's data folder made is told by those records and by a copy's own (`home`), never
// by another Filament's beat: many Filaments share a repository's refs. A read under way serves every ask, and its
// answer serves them for `READ_KEPT_MS`. Clean up runs on the person's press only (GW-D1), with the plan the sheet
// showed: it reads everything again, takes what is in both, and says what went and what stayed, with why — one at a
// time per repository.
import { existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { refNameOf } from "../adapters/git/snapshot.js";
import { copiesHomeOf, copiesOf, letGoCopy, sweepAside, waitingTaskWork } from "../adapters/git/worktree.js";
import { dropBranch, dropRefGroups, filamentRefs, folderBytes, gitCommonOf, routineBranches } from "../adapters/git/footprint.js";
import { fewAtOnce } from "../core/at-once.js";
import { footprintAnswer, planFootprint, pressedTakes, refKind } from "../core/footprint.js";
import { normalizeCwd } from "../core/project-id.js";
import { runOfBranch, runSlug } from "../core/routines.js";

/** How long one read measures its copies' disk at most, and how many entries: past either, "at least". */
const MEASURE_MS = 3000;
const MEASURE_ENTRIES = 300_000;
/** The copies one read measures at once. */
const MEASURES_AT_ONCE = 2;
/** A copy's measure serves the reads after it while its record says it was not used since, this long at most. */
const SIZE_KEPT_MS = 10 * 60_000;
/** The measures kept at most. */
const SIZES_MOST = 500;
/** How long a read's answer serves the asks after it (the Space's opening, its ⟳, the sheet's). */
const READ_KEPT_MS = 3000;

/**
 * @typedef {{ known: (ids: readonly string[]) => Map<string, { chainId: string, running: boolean, inUse: boolean,
 *   held: boolean, waits: boolean, undo: boolean }>, treesInUse: () => string[] }} Registry  the sub-agent registry's part
 * @typedef {{ chainIds: () => string[], hasChain: (id: string) => boolean, snapshotRefsNamed: () => Set<string>,
 *   goneChains: () => Map<string, { helpers: string[], at: number }>, goneSince: () => number }} ArchiveReads
 * @typedef {{ kind: string, why: string, count: number }} Stayed
 */

/**
 * @param {{ home: string, subagents?: Registry | null, archive?: () => ArchiveReads | null, backups?: () => number | null,
 *   routines?: () => { title: string, folder: string | null }[], log?: (level: string, msg: string) => void }} deps
 *   `home`: this Filament's data folder, as its copies' records name it (`copiesHomeOf`); `backups`: since when a memory
 *   backup kept may hold a chat, in ms (null: none is kept); `routines`: every Space's routines, each with its
 *   project's folder
 */
export function createFootprint({ home, subagents = null, archive = () => null, backups = () => null, routines = () => [], log = () => {} }) {
  const own = copiesHomeOf(home) ? normalizeCwd(copiesHomeOf(home)) : null;
  /** Each copy's last measure, by its folder and its record's word of its last use. @type {Map<string, { bytes: number, partial: boolean, at: number }>} */
  const sizes = new Map();
  /** Each copy's newest measure, busy or at rest, by its folder alone: what `measured` says. @type {Map<string, { bytes: number, partial: boolean }>} */
  const newest = new Map();
  /** The repositories a Clean up runs in now. @type {Set<string>} */
  const cleaning = new Set();
  /** Each folder's read under way, or its last, with when it ended. @type {Map<string, { p: Promise<any>, done: number }>} */
  const reads = new Map();
  /** Whether a data folder a copy's record names is this Filament's. @param {string} h */
  const isOwn = (h) => own != null && normalizeCwd(h) === own;
  /**
   * Whether a data folder a copy's record names is gone, so a Filament that ran from it can run no more: the folder that
   * held it is there and it is not. One whose place cannot be read — a drive not mounted, another user's folders, a
   * path of another system — may still be some Filament's.
   * @param {string} h
   */
  const gone = (h) => !isOwn(h) && isAbsolute(h) && dirname(h) !== h && existsSync(dirname(h)) && !existsSync(h);

  /**
   * The routines' titles by their runs' branches' spelling (`runSlug`), of the routines whose project's folder is in the
   * repository whose git folder is `common`; a few folders asked at once.
   * @param {string} common
   */
  async function slugsIn(common) {
    const list = routines().filter((r) => r.folder && r.title);
    const folders = [...new Set(list.map((r) => String(r.folder)))];
    const commons = await fewAtOnce(folders, (f) => gitCommonOf(f));
    const here = new Set(folders.filter((_, i) => commons[i] === common));
    return new Map(list.filter((r) => here.has(String(r.folder))).map((r) => [runSlug(r.title), r.title]));
  }

  /**
   * Each copy's disk — its folder and git's record of it —, within one budget for the read, `MEASURES_AT_ONCE` copies
   * at a time. A copy at rest whose record has not moved since its last measure is not measured again within
   * `SIZE_KEPT_MS`, one cut short too; a busy one is measured each time, its record standing while it works, and so is
   * a folder a Clean up left, which has no record.
   * @param {{ dest: string, record: string | null, meta: { state: string, at: number } | null }[]} copies
   */
  async function measure(copies) {
    const budget = { until: Date.now() + MEASURE_MS, entries: MEASURE_ENTRIES };
    return fewAtOnce(
      copies,
      async (c) => {
        const busy = c.meta?.state === "busy" || !c.meta;
        const key = `${c.dest}\n${c.meta?.state ?? ""}\n${c.meta?.at ?? ""}`;
        const had = busy ? null : sizes.get(key);
        if (had && Date.now() - had.at < SIZE_KEPT_MS) return had;
        const mine = await folderBytes(c.dest, budget);
        const record = c.record ? await folderBytes(c.record, budget) : { bytes: 0, partial: false };
        const got = { bytes: mine.bytes + record.bytes, partial: mine.partial || record.partial, at: Date.now() };
        const dest = normalizeCwd(c.dest);
        newest.delete(dest);
        newest.set(dest, { bytes: got.bytes, partial: got.partial });
        if (newest.size > SIZES_MOST) newest.delete(/** @type {string} */ (newest.keys().next().value));
        if (!busy) {
          sizes.set(key, got);
          if (sizes.size > SIZES_MOST) sizes.delete(/** @type {string} */ (sizes.keys().next().value));
        }
        return got;
      },
      MEASURES_AT_ONCE,
    );
  }

  /**
   * Everything the plan is made from, read now; `measure` false leaves the copies' disk unread (a press's read).
   * @param {string} root @param {{ measure?: boolean }} [o]
   * @returns {Promise<{ ok: true, repo: string, facts: import("../core/footprint.js").FootprintFacts } | { ok: false, error: string }>}
   */
  async function facts(root, { measure: measured = true } = {}) {
    const [refs, copies, common] = await Promise.all([filamentRefs(root), copiesOf(root), gitCommonOf(root)]);
    if (!refs.ok) return refs;
    if (!copies.ok) return copies;
    if (!common) return { ok: false, error: "git could not name the repository's git folder" };
    const ids = [...new Set([
      ...refs.refs.map((r) => refKind(r.ref)).filter((k) => k.kind === "subagents" && k.owner).map((k) => String(k.owner)),
      ...copies.copies.map((c) => c.meta?.agent || "").filter(Boolean),
    ])];
    const a = archive();
    const known = ids.length ? subagents?.known(ids) || new Map() : new Map();
    const standing = new Map([...known].map(([id, s]) => [id, { ...s, here: !!a?.hasChain(s.chainId) }]));
    const goneChats = a ? a.goneChains() : new Map();
    /** When each chat this archive deleted went, by its refs' spelling; the latest where two spell alike. @type {Map<string, number>} */
    const goneByRef = new Map();
    /** When each helper's chat went, the latest where several kept its thread. @type {Map<string, number>} */
    const deletedHelpers = new Map();
    for (const [id, g] of goneChats) {
      const name = refNameOf(id);
      goneByRef.set(name, Math.max(goneByRef.get(name) ?? 0, g.at));
      for (const h of g.helpers) deletedHelpers.set(h, Math.max(deletedHelpers.get(h) ?? 0, g.at));
    }
    const here = a ? new Set(a.chainIds().map((id) => refNameOf(id))) : null;
    const since = a ? a.goneSince() : NaN;
    // A fork's turns name its source's Undo points: asked only where a chat's refs here are not a chat's Filament has.
    const owners = refs.refs.map((r) => refKind(r.ref)).filter((k) => k.kind === "snapshots" && k.owner);
    const named = a && here && owners.some((k) => !here.has(String(k.owner))) ? a.snapshotRefsNamed() : new Set();
    const slugs = await slugsIn(common);
    const branches = slugs.size ? await routineBranches(root, (b) => runOfBranch(b, slugs)) : { ok: /** @type {const} */ (true), branches: [] };
    if (!branches.ok) log("warn", `git footprint: the routines' branches in ${refs.repo} were not read: ${branches.error}`);
    const asMeasured = [...copies.copies, ...copies.left.map((l) => ({ dest: l.dest, record: null, meta: null }))];
    const sized = measured ? await measure(asMeasured) : asMeasured.map(() => null);
    const n = copies.copies.length;
    return {
      ok: true,
      repo: refs.repo,
      facts: {
        copies: copies.copies.map((c, i) => ({ name: c.name, meta: c.meta, whole: c.whole, claimed: c.claimed, othersHold: c.othersHold, bytes: sized[i]?.bytes ?? null, partial: !!sized[i]?.partial })),
        left: copies.left.map((l, i) => ({ name: l.name, bytes: sized[n + i]?.bytes ?? null, partial: !!sized[n + i]?.partial })),
        refs: refs.refs,
        standing,
        deletedHelpers,
        inUse: new Set(subagents?.treesInUse() || []),
        chats: here ? { here: (o) => here.has(o), deletedAt: (o) => goneByRef.get(o) ?? null, since: Number.isFinite(since) ? since : null } : null,
        named,
        heldSince: backups(),
        homes: { own: isOwn, gone },
        branches: branches.ok ? branches.branches : [],
      },
    };
  }

  /**
   * A repository's footprint as the page shows it, or why it could not be read: with `refs`, each ref of a group that
   * goes or goes ticked, and the commit it was read at — the sheet's plan, which its press sends back. A read under way
   * serves every ask, and its answer serves them for `READ_KEPT_MS`.
   * @param {string} root @param {{ refs?: boolean }} [o]
   */
  async function read(root, { refs = false } = {}) {
    const had = reads.get(root);
    /** @type {Promise<any>} */
    let p;
    if (had && (!had.done || Date.now() - had.done < READ_KEPT_MS)) p = had.p;
    else {
      const entry = { p: /** @type {Promise<any>} */ (Promise.resolve(null)), done: 0 };
      entry.p = facts(root)
        .then((f) => (f.ok ? { ok: true, repo: f.repo, plan: planFootprint(f.facts) } : { ok: false, error: f.error }))
        .finally(() => {
          entry.done = Date.now();
        });
      reads.set(root, entry);
      if (reads.size > 100) reads.delete(/** @type {string} */ (reads.keys().next().value));
      p = entry.p;
    }
    const got = await p;
    if (!got.ok) return { ok: false, error: got.error };
    return { ok: true, error: null, repo: got.repo, ...footprintAnswer(got.plan, { refs }) };
  }

  /**
   * What the reads so far measured of some copies (worktree.js `copiesOf`'s), measuring nothing: their disk summed,
   * `partial` where a measure was cut short — or null where one of them was never measured. What is still open in a
   * chat says their size by it (server.js).
   * @param {readonly { dest: string }[]} copies @returns {{ bytes: number, partial: boolean } | null}
   */
  function measured(copies) {
    let bytes = 0;
    let partial = false;
    for (const c of copies) {
      const m = newest.get(normalizeCwd(c.dest));
      if (!m) return null;
      bytes += m.bytes;
      partial ||= m.partial;
    }
    return { bytes, partial };
  }

  /**
   * Clean up (the footprint plan), with the plan the sheet showed (`pressed`): the repository read again, then only what
   * is in both that plan and what goes now (`pressedTakes`) taken — a copy let go under its claim where its record is the
   * one read, a folder an earlier Clean up left removed, every group's refs dropped in one step where each still points
   * where it was read (else group by group), a branch the same way. What went, what stayed by kind and why, and `left`:
   * the folders of copies that went whose removal stopped part way, which the next Clean up tries again.
   * @param {string} root @param {import("../core/footprint.js").PressedPlan} pressed
   * @returns {Promise<{ ok: true, went: { copies: string[], left: string[], refs: Record<string, number>, branches: string[] }, stayed: Stayed[], left: string[] } | { ok: false, status: number, error: string }>}
   */
  async function clean(root, pressed) {
    const key = await gitCommonOf(root);
    if (!key) return { ok: false, status: 409, error: "not in a git repository" };
    if (cleaning.has(key)) return { ok: false, status: 409, error: "a Clean up runs in this repository already" };
    cleaning.add(key);
    try {
      const f = await facts(root, { measure: false });
      if (!f.ok) return { ok: false, status: 409, error: f.error };
      const takes = pressedTakes(planFootprint(f.facts), pressed);
      /** @type {{ copies: string[], left: string[], refs: Record<string, number>, branches: string[] }} */
      const went = { copies: [], left: [], refs: { subagents: 0, snapshots: 0, moves: 0, forks: 0, other: 0 }, branches: [] };
      /** @type {Map<string, Stayed>} */
      const stayed = new Map(takes.stayed.map((s) => [`${s.kind}\n${s.why}`, { ...s }]));
      /** @param {string} kind @param {string} why @param {number} n */
      const stays = (kind, why, n) => {
        const k = `${kind}\n${why}`;
        const had = stayed.get(k) || { kind, why, count: 0 };
        had.count += n;
        stayed.set(k, had);
      };
      /** @type {string[]} */
      const left = [];
      const inUse = () => new Set(subagents?.treesInUse() || []);
      for (const c of takes.copies) {
        const r = await letGoCopy(f.repo, c.name, { keep: inUse, at: Number(c.at), homes: (h) => (h ? isOwn(h) || gone(h) : !c.home) });
        if (!r.ok) stays("copies", r.error, 1);
        else {
          went.copies.push(c.name);
          if (r.left) left.push(r.left);
        }
      }
      for (const l of takes.left) {
        const r = await sweepAside(f.repo, l.name);
        if (r.ok) went.left.push(l.name);
        else stays("left", r.error, 1);
      }
      const dropped = await dropRefGroups(f.repo, takes.groups.map((g) => g.refs));
      takes.groups.forEach(({ group, refs }, i) => {
        const r = dropped[i];
        if (r.ok) went.refs[group.kind] += refs.length;
        else stays(group.kind, `git kept them: ${r.error}`, refs.length);
      });
      for (const b of takes.branches) {
        const r = await dropBranch(f.repo, b);
        if (r.ok) went.branches.push(b.name);
        else stays("branches", r.error, 1);
      }
      // What was read before is no answer now: the next read reads again.
      reads.clear();
      const refsWent = Object.values(went.refs).reduce((n, x) => n + x, 0);
      /** @param {number} n @param {string} one @param {string} more */
      const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
      log("info", `git footprint: Clean up in ${f.repo} on the person's press: ${many(went.copies.length, "copy", "copies")}, ${many(went.left.length, "leftover folder", "leftover folders")}, ${many(refsWent, "ref", "refs")} and ${many(went.branches.length, "branch", "branches")} went`);
      return { ok: true, went, stayed: [...stayed.values()], left };
    } finally {
      cleaning.delete(key);
    }
  }

  return { read, clean, measured };
}

/**
 * The work of helpers of chats this Filament deleted that still waits on a repository's refs (the owner's of 11-09):
 * what a chat's delete left, cheap, for the person to apply or let go (adapters/git/worktree.js `letGoTaskWork`) — each
 * helper with its chat, when that chat was deleted (the latest, where several kept its thread), its base and its work,
 * and when the work was captured. No repository: answered in words.
 * @param {string} folder @param {{ archive: () => Pick<ArchiveReads, "goneChains"> | null }} deps
 * @returns {Promise<{ ok: true, repo: string, work: { id: string, chainId: string, deletedAt: number, base: string, head: string, at: number | null }[] } | { ok: false, error: string }>}
 */
export async function deletedChatsWork(folder, { archive }) {
  const waiting = await waitingTaskWork(folder);
  if (!waiting.ok) return waiting;
  /** Each helper's deleted chat, the latest. @type {Map<string, { chainId: string, at: number }>} */
  const chatOf = new Map();
  for (const [chainId, g] of archive()?.goneChains() || new Map())
    for (const h of g.helpers) if ((chatOf.get(h)?.at ?? -1) < g.at) chatOf.set(h, { chainId, at: g.at });
  /** @type {{ id: string, chainId: string, deletedAt: number, base: string, head: string, at: number | null }[]} */
  const work = [];
  for (const w of waiting.work) {
    const c = chatOf.get(w.id);
    if (c) work.push({ ...w, chainId: c.chainId, deletedAt: c.at });
  }
  return { ok: true, repo: waiting.repo, work };
}
