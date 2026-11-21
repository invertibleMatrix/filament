// @ts-check
// Filament's footprint in a repository (the footprint plan, Phase 7), pure: what Filament keeps there — its copies, its
// refs under `refs/filament/` by kind, the branches it made for its routines' runs — and for each whether the person's
// Clean up takes it, why it stays, or whether it goes only where the person ticks it. Many Filaments, each with its own
// data folder, work in one repository and share its refs; so nothing goes unless something durable shows this
// Filament's data folder made it — its archive's chats, live or deleted (`gone_chains`), and the helpers they kept; a
// copy's record naming this data folder —, or that the data folder that made it is gone. Of that, only what nothing
// needs goes: a copy at rest whose helper's work does not wait; a helper's refs once nothing of its work waits, and a
// mark's hold no chat can undo; the Undo points and ways back of chats this Filament deleted, where no chat here names
// them; a routine run's branch with no worktree whose every commit its base has; a folder a Clean up moved aside and
// could not remove all the way. Refs no record shows to be this Filament's are listed apart, by chat or helper, and go
// only where the person ticks them — never one holding work that waits —, and so do a deleted chat's where a memory
// backup kept here holds the chat (a restore would bring it back without them) or one of them was written after the
// delete (another Filament working from a copy of this data folder may have it still). Those of a chat this archive
// never had, written since it began keeping the chats it deletes, are another Filament's, and say so. Whatever is in
// use, waits, or cannot be told stays, and says why.

export const REF_PREFIX = "refs/filament/";
export const SUBAGENT_REFS = `${REF_PREFIX}subagents/`;
export const SNAPSHOT_REFS = `${REF_PREFIX}snapshots/`;
export const MOVE_REFS = `${REF_PREFIX}moves/`;
/** What a deleted chat's fork held as its worktree went (adapters/git/places.js `forkKeptRef`, the owner's of 11-09). */
export const FORK_REFS = `${REF_PREFIX}forks/`;
/** A helper's id, as its refs and its copy are named. */
const HELPER = /^sa_[0-9a-f]{8}$/;
/** What the sheet says of a group no record shows to be this Filament's, which goes only where the person ticks it. */
const NOT_OURS = "no record shows this Filament made it";
/** What it says of a group of a chat this Filament's archive never had, written since it began keeping its deletes. */
const OTHERS = "another Filament's: written since this Filament began keeping the chats it deletes, for a chat it neither has nor deleted";
/** What it says of a folder a Clean up moved aside and could not remove all the way. */
const LEFT_WHY = "a Clean up moved it aside to remove it, and its removal stopped part way: no Filament uses it";

/** @typedef {"subagents" | "snapshots" | "moves" | "forks" | "other"} RefKind */
/** @typedef {"helper" | "spare" | "check"} CopyKind */
/**
 * @typedef {{ ref: string, commit: string, tree: string | null, date: number | null }} RefRead  a ref, its commit, that
 *   commit's tree (null: no commit) and its committer's time in seconds
 */
/**
 * @typedef {object} CopyFact  one copy as `copiesOf` reads it (adapters/git/worktree.js), with its disk
 * @property {string} name
 * @property {{ state: "busy" | "parked" | "free", agent: string, at: number, home?: string, unsaved?: { error: string, at: number } } | null} meta
 *   Filament's record of it; `home`, the data folder that wrote it; `unsaved`, why its work could not be kept on its
 *   helper's refs, and since when
 * @property {boolean} whole  its checkout is whole
 * @property {boolean} claimed  this Filament works in it now
 * @property {boolean} othersHold  another living Filament holds it
 * @property {number | null} bytes  null: not measured
 * @property {boolean} partial  its measure was cut short: at least `bytes`
 */
/**
 * @typedef {object} Standing  what the sub-agent registry knows of a helper (`known`), and whether its chat is here
 * @property {string} chainId @property {boolean} running @property {boolean} inUse  its copy is in use
 * @property {boolean} held  its chat's task graph still asks for it @property {boolean} waits  its chat says its work waits
 * @property {boolean} undo  its mark as applied can still be undone @property {boolean} here  its chat is here
 */
/**
 * @typedef {object} BranchFact  a branch Filament made for a routine's run
 * @property {string} name @property {string} routine  its routine's title @property {string} commit
 * @property {string | null} worktree  the folder it is checked out in
 * @property {number | null} uncommitted  files uncommitted there; null without a worktree, or unread
 * @property {string | null} base  the branch it is compared with
 * @property {number | null} ahead  commits it holds its base lacks; null where git could not tell
 */
/**
 * @typedef {object} ChatsKnown  the archive's word on the chats a ref is named for, as the ref spells them
 * @property {(owner: string) => boolean} here  a chat Filament has
 * @property {(owner: string) => number | null} deletedAt  when this Filament's archive deleted the chat, in ms; null: it
 *   did not
 * @property {number | null} since  when the archive began keeping the chats it deletes, in ms: a chat whose refs were
 *   written since, that it neither has nor deleted, is another Filament's
 */
/**
 * @typedef {{ name: string, bytes: number | null, partial: boolean }} LeftFact  a folder a Clean up moved aside out of
 *   the copies' names and could not remove all the way, with its disk
 */
/**
 * @typedef {object} FootprintFacts
 * @property {CopyFact[]} copies
 * @property {LeftFact[]} left
 * @property {RefRead[]} refs
 * @property {ReadonlyMap<string, Standing>} standing  by helper: those the registry knows
 * @property {ReadonlyMap<string, number>} deletedHelpers  the helpers whose threads the chats this archive deleted kept,
 *   each with when its chat was deleted (the latest, where several kept it), in ms
 * @property {ReadonlySet<string>} inUse  the copies Filament's helpers and checks work in now, by name
 * @property {ChatsKnown | null} chats  null: Filament's record of its chats is not open
 * @property {ReadonlySet<string>} named  the snapshot refs a chat here names (a fork names its source's)
 * @property {number | null} heldSince  since when a memory backup kept here may hold memory as it was, in ms: a chat
 *   deleted since would come back with a restore; null: none is kept
 * @property {{ own: (home: string) => boolean, gone: (home: string) => boolean }} homes  whether a data folder a copy's
 *   record names is this Filament's, and whether another one is gone
 * @property {BranchFact[]} branches
 */
/**
 * @typedef {{ name: string, kind: CopyKind, state: string | null, agent: string | null, chat: string | null,
 *   home: string | null, at: number | null, inUse: boolean, waits: boolean, bytes: number | null, partial: boolean,
 *   unsaved: { error: string, at: number } | null, goes: boolean, why: string }} CopyRow  `at`: its record's last use,
 *   which a Clean up's press sends back; `unsaved`: its work could not be kept on its helper's refs, why and since when
 * @typedef {LeftFact & { goes: boolean, why: string }} LeftRow
 * @typedef {{ kind: RefKind, owner: string | null, part: string, refs: RefRead[], goes: boolean, tick: boolean,
 *   others: boolean, why: string }} RefGroup
 *   refs of one helper's or one chat's that go or stay together, for one reason; `part`: a helper's `work`, `mark` or
 *   `other`, a chat's `undo`, `named` or `other`, a deleted chat's fork's `kept`; `tick`: it goes only where the person
 *   ticks it; `others`: another Filament's, which the sheet's "All" leaves out
 * @typedef {BranchFact & { goes: boolean, why: string }} BranchRow
 * @typedef {{ copies: CopyRow[], left: LeftRow[], groups: RefGroup[], branches: BranchRow[] }} FootprintPlan
 */

/**
 * A ref's kind and whose it is: a helper's (`subagents/<id>/<leaf>`), a chat's Undo point (`snapshots/<chat>/…`) or way
 * back from a move (`moves/<chat>/…`), what a deleted chat's fork held (`forks/<chat>/kept`), or another; `rest`, what
 * follows the owner.
 * @param {string} ref @returns {{ kind: RefKind, owner: string | null, rest: string }}
 */
export function refKind(ref) {
  for (const [kind, prefix] of /** @type {const} */ ([["subagents", SUBAGENT_REFS], ["snapshots", SNAPSHOT_REFS], ["moves", MOVE_REFS], ["forks", FORK_REFS]])) {
    if (!ref.startsWith(prefix)) continue;
    const [owner, ...rest] = ref.slice(prefix.length).split("/");
    return { kind, owner: owner || null, rest: rest.join("/") };
  }
  return { kind: "other", owner: null, rest: ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : ref };
}

/** A copy's kind by its name: a helper's own, a spare made ahead, or a check's or a task's lane. @param {string} name @returns {CopyKind} */
export const copyKind = (name) => (HELPER.test(name) ? "helper" : /^spare-/.test(name) ? "spare" : "check");

/** The words for why one stays, the first that holds, or null. @param {Standing | undefined} s */
const busyWords = (s) => (!s ? null : s.running ? "its sub-agent is at work" : s.inUse ? "its sub-agent's copy is in use" : s.held ? "its chat's task graph still asks for its sub-agent" : null);

/**
 * Whether a helper's refs say its work waits: a base and a work whose trees differ. @param {RefRead | undefined} base
 * @param {RefRead | undefined} work
 */
const refsWait = (base, work) => !!base && !!work && base.tree !== work.tree;

/** The newest commit's time among refs, in seconds, or null. @param {RefRead[]} refs */
const newestOf = (refs) => refs.reduce((/** @type {number | null} */ n, r) => (r.date != null && (n == null || r.date > n) ? r.date : n), null);

/**
 * Why the refs of a chat this Filament deleted — or of a helper whose thread it kept — go only ticked, or null where
 * they go: one of them was written after the delete, so another Filament working from a copy of this data folder may
 * have the chat still; or a memory backup kept here was taken before the delete, and its restore would bring the chat
 * back without them.
 * @param {FootprintFacts} f @param {number} at  the delete's time, in ms @param {RefRead[]} refs
 */
function keptBack(f, at, refs) {
  const newest = newestOf(refs);
  if (newest != null && newest * 1000 > at) return "you deleted its chat, but some of these were written since: another Filament working from a copy of this data folder may have it still";
  if (f.heldSince != null && at >= f.heldSince) return "you deleted its chat after a memory backup kept here was taken: restoring that backup would bring the chat back without these";
  return null;
}

/**
 * Each copy, and whether Clean up takes it: one at rest — free, or parked for a helper nothing of whose work waits —
 * that nothing works in or holds, whose record is whole and shows it this Filament's — naming this data folder, or,
 * written before records named one, naming a helper this Filament knows — or names a data folder that is gone.
 * @param {FootprintFacts} f @param {Map<string, RefRead[]>} helperRefs
 * @returns {CopyRow[]}
 */
function copyRows(f, helperRefs) {
  return f.copies.map((c) => {
    const agent = c.meta?.agent || null;
    const s = agent ? f.standing.get(agent) : undefined;
    const refs = agent ? helperRefs.get(agent) || [] : [];
    const leaf = (/** @type {string} */ n) => refs.find((r) => r.ref.endsWith(`/${n}`));
    const waits = !!agent && (refsWait(leaf("base"), leaf("work")) || !!s?.waits);
    const inUse = c.claimed || f.inUse.has(c.name) || c.meta?.state === "busy" || !!s?.running || !!s?.inUse;
    const home = c.meta?.home || null;
    const goneHome = !!home && !f.homes.own(home) && f.homes.gone(home);
    const ours = home ? f.homes.own(home) || goneHome : !!agent && (f.standing.has(agent) || f.deletedHelpers.has(agent));
    /** @param {boolean} goes @param {string} why */
    const row = (goes, why) => ({ name: c.name, kind: copyKind(c.name), state: c.meta?.state ?? null, agent, chat: s?.chainId || null, home, at: c.meta?.at ?? null, inUse, waits, bytes: c.bytes, partial: c.partial, unsaved: c.meta?.unsaved ?? null, goes, why });
    if (!c.meta) return row(false, "Filament has no record of it yet: it may still be being made");
    if (!c.whole) return row(false, "its checkout is not whole: it may still be being made");
    if (c.othersHold) return row(false, "another Filament that works in this repository holds it");
    if (c.meta.state === "busy" && c.meta.unsaved) return row(false, `its sub-agent's work in it could not be kept on its refs (${c.meta.unsaved.error}): it stays as it is until it can be`);
    if (c.claimed || f.inUse.has(c.name)) return row(false, "in use now");
    if (c.meta.state === "busy") return row(false, "it is at work, or was left at work as a Filament stopped: what it holds goes onto its sub-agent's refs the next time a sub-agent starts here");
    if (!ours) return row(false, home ? `another Filament's: its data folder ${home} made it` : NOT_OURS);
    const busy = c.meta.state === "parked" ? busyWords(s) : null;
    if (busy) return row(false, busy);
    if (c.meta.state === "parked" && waits) return row(false, "it holds its sub-agent's work, which waits to be applied or discarded");
    const why = c.meta.state === "parked" ? "its sub-agent's work no longer waits" : "free: nothing of it is anyone's";
    return row(true, goneHome ? `${why}; the data folder that made it is gone` : why);
  });
}

/**
 * A helper's refs in groups: its work (`base`, `work`), its mark's hold (`marked-base`, `marked-work`), any other. One
 * this Filament knows — its registry, or the threads of a chat its archive deleted — goes where nothing of it waits; one
 * no record shows to be this Filament's goes only where the person ticks it, and never with work that waits; so does
 * one of a deleted chat's that a backup holds, or that was written to since the delete (`keptBack`).
 * @param {string} id @param {RefRead[]} refs @param {FootprintFacts} f @param {CopyRow | undefined} copy
 * @returns {RefGroup[]}
 */
function helperGroups(id, refs, f, copy) {
  const s = f.standing.get(id);
  const deletedAt = s ? undefined : f.deletedHelpers.get(id);
  const ours = !!s || deletedAt != null;
  const by = (/** @type {string} */ n) => refs.find((r) => r.ref === `${SUBAGENT_REFS}${id}/${n}`);
  const base = by("base");
  const wk = by("work");
  const work = /** @type {RefRead[]} */ ([base, wk].filter(Boolean));
  const mark = /** @type {RefRead[]} */ ([by("marked-base"), by("marked-work")].filter(Boolean));
  const other = refs.filter((r) => !work.includes(r) && !mark.includes(r));
  /** @type {RefGroup[]} */
  const out = [];
  /** @param {string} part @param {RefRead[]} rs @param {boolean} goes @param {string} why @param {boolean} [tick] */
  const group = (part, rs, goes, why, tick = false) => {
    if (rs.length) out.push({ kind: "subagents", owner: id, part, refs: rs, goes, tick, others: false, why });
  };
  /** One of this Filament's that goes — only ticked where its deleted chat may come back, or be had elsewhere. @param {string} part @param {RefRead[]} rs @param {string} why */
  const goes = (part, rs, why) => {
    const kept = deletedAt != null ? keptBack(f, deletedAt, rs) : null;
    if (kept) group(part, rs, false, kept, true);
    else group(part, rs, true, why);
  };
  const busy = !HELPER.test(id) ? "Filament does not know a sub-agent by that name" : busyWords(s);
  if (work.length) {
    if (busy) group("work", work, false, busy);
    else if (work.some((r) => !r.tree)) group("work", work, false, "git does not read it as a commit");
    else if (refsWait(base, wk)) group("work", work, false, ours ? "its work waits to be applied or discarded" : `its work waits to be applied or discarded; ${NOT_OURS}`);
    else if (!base) group("work", work, false, "its work has no base to tell what of it waits");
    else if (!wk && copy && !copy.goes) group("work", work, false, "its copy may hold work not kept on its refs yet");
    else if (s?.waits) group("work", work, false, "its chat says its work waits");
    else if (ours) goes("work", work, "nothing of its work waits");
    else group("work", work, false, `nothing of its work waits; ${NOT_OURS}: another Filament's sub-agent may be at work`, true);
  }
  if (mark.length) {
    if (busy) group("mark", mark, false, busy);
    else if (s?.undo) group("mark", mark, false, "its mark as applied can still be undone in its chat");
    else if (ours) goes("mark", mark, s?.here ? "its mark as applied can no longer be undone" : "no chat keeps its sub-agent, so nothing can undo its mark");
    else group("mark", mark, false, `a mark's hold ${NOT_OURS}: another Filament may still undo it`, true);
  }
  group("other", other, false, "Filament does not know what this ref is for");
  return out;
}

/**
 * A chat's refs of one kind in groups: those of a chat here, or named by one (a fork names its source's Undo points),
 * stay; those of a chat this Filament deleted go, only ticked where a memory backup holds it or one was written since
 * (`keptBack`); those of a chat no record shows to be this Filament's go only where the person ticks them — another
 * Filament's chats may be among them, and one written since the archive began keeping its deletes is another's. Where
 * Filament's record of its chats is not open, every one stays.
 * @param {"snapshots" | "moves"} kind @param {string} owner @param {RefRead[]} refs @param {FootprintFacts} f
 * @returns {RefGroup[]}
 */
function chatGroups(kind, owner, refs, f) {
  /** @param {string} part @param {RefRead[]} rs @param {boolean} goes @param {string} why @param {boolean} [tick] @param {boolean} [others] @returns {RefGroup[]} */
  const one = (part, rs, goes, why, tick = false, others = false) => (rs.length ? [{ kind, owner, part, refs: rs, goes, tick, others, why }] : []);
  const loose = refs.filter((r) => !refKind(r.ref).rest);
  const named = refs.filter((r) => refKind(r.ref).rest && f.named.has(r.ref));
  const rest = refs.filter((r) => !loose.includes(r) && !named.includes(r));
  const restOf = () => {
    if (!f.chats) return one("undo", rest, false, "Filament's record of its chats is not open, so it cannot tell whose these are");
    if (f.chats.here(owner)) return one("undo", rest, false, "its chat is here");
    const at = f.chats.deletedAt(owner);
    if (at != null) {
      const kept = keptBack(f, at, rest);
      return kept ? one("undo", rest, false, kept, true) : one("undo", rest, true, "you deleted its chat");
    }
    const newest = newestOf(rest);
    if (f.chats.since != null && newest != null && newest * 1000 > f.chats.since) return one("undo", rest, false, OTHERS, true, true);
    return one("undo", rest, false, `${NOT_OURS}: another Filament's chat may be among these`, true);
  };
  return [
    ...restOf(),
    ...one("named", named, false, "a chat here names it: a fork keeps its source's"),
    ...one("other", loose, false, "it is not named for a chat"),
  ];
}

/**
 * What a deleted chat's fork held as its worktree went (`forks/<chat>/kept`, the owner's of 11-09): edits, files or
 * commits nothing else keeps, so — unlike a deleted chat's Undo points — they go only where the person ticks them,
 * whoever's chat it was; said as this Filament's deleted chat, or another Filament's, as `chatGroups` tells them. While
 * its chat is here, or Filament's record of its chats is not open, they stay.
 * @param {string} owner @param {RefRead[]} refs @param {FootprintFacts} f
 * @returns {RefGroup[]}
 */
function forkGroups(owner, refs, f) {
  /** @param {boolean} tick @param {string} why @param {boolean} [others] @returns {RefGroup[]} */
  const one = (tick, why, others = false) => [{ kind: "forks", owner, part: "kept", refs, goes: false, tick, others, why }];
  if (!f.chats) return one(false, "Filament's record of its chats is not open, so it cannot tell whose these are");
  if (f.chats.here(owner)) return one(false, "its chat is here");
  const held = "what its fork's folder held as its chat was deleted: edits, files or commits nothing else keeps";
  if (f.chats.deletedAt(owner) != null) return one(true, `${held}; you deleted its chat`);
  const newest = newestOf(refs);
  if (f.chats.since != null && newest != null && newest * 1000 > f.chats.since) return one(true, `${held}; ${OTHERS}`, true);
  return one(true, `${held}; ${NOT_OURS}`);
}

/**
 * A routine run's branch, and whether Clean up takes it: one with no worktree whose every commit its base has.
 * @param {BranchFact} b @returns {BranchRow}
 */
function branchRow(b) {
  /** @param {boolean} goes @param {string} why */
  const row = (goes, why) => ({ ...b, goes, why });
  if (b.worktree) return row(false, b.uncommitted ? `it has a worktree, with ${b.uncommitted} file${b.uncommitted === 1 ? "" : "s"} uncommitted` : "it has a worktree: remove that first");
  if (!b.base) return row(false, "no base branch to compare it with");
  if (b.ahead == null) return row(false, `git could not compare it with ${b.base}`);
  if (b.ahead) return row(false, `it holds ${b.ahead} commit${b.ahead === 1 ? "" : "s"} ${b.base} lacks`);
  return row(true, `${b.base} has every commit of it`);
}

/**
 * The plan of a repository's footprint: each copy, each folder a Clean up left, each group of refs and each routine
 * run's branch, with whether Clean up takes it, why it stays, or whether it goes only where the person ticks it.
 * @param {FootprintFacts} f @returns {FootprintPlan}
 */
export function planFootprint(f) {
  /** @type {Map<string, RefRead[]>} */
  const helpers = new Map();
  /** @type {Map<string, { kind: "snapshots" | "moves", owner: string, refs: RefRead[] }>} */
  const chats = new Map();
  /** @type {Map<string, RefRead[]>} */
  const forks = new Map();
  /** @type {RefRead[]} */
  const other = [];
  for (const r of f.refs) {
    const k = refKind(r.ref);
    if (k.kind === "subagents" && k.owner) helpers.set(k.owner, [...(helpers.get(k.owner) || []), r]);
    else if (k.kind === "forks" && k.owner && k.rest === "kept") forks.set(k.owner, [...(forks.get(k.owner) || []), r]);
    else if ((k.kind === "snapshots" || k.kind === "moves") && k.owner) {
      const key = `${k.kind}\n${k.owner}`;
      const had = chats.get(key) || { kind: k.kind, owner: k.owner, refs: [] };
      had.refs.push(r);
      chats.set(key, had);
    } else other.push(r);
  }
  const copies = copyRows(f, helpers);
  return {
    copies,
    left: f.left.map((l) => ({ ...l, goes: true, why: LEFT_WHY })),
    groups: [
      ...[...helpers].flatMap(([id, refs]) => helperGroups(id, refs, f, copies.find((c) => c.name === id))),
      ...[...chats.values()].flatMap((c) => chatGroups(c.kind, c.owner, c.refs, f)),
      ...[...forks].flatMap(([owner, refs]) => forkGroups(owner, refs, f)),
      ...(other.length ? [{ kind: /** @type {RefKind} */ ("other"), owner: null, part: "other", refs: other, goes: false, tick: false, others: false, why: "Filament does not know what keeps these" }] : []),
    ],
    branches: f.branches.map(branchRow),
  };
}

/**
 * The plan as the page reads it: the copies with their disk and totals; the folders a Clean up left, with theirs; the
 * refs by kind, each kind's count, what goes and what goes only ticked, its groups by owner — with their newest commit's
 * time, whether another Filament's and, with `refs`, each ref and the commit it was read at (the sheet's, which its
 * press sends back) —; the branches; how many things in all Clean up takes.
 * @param {FootprintPlan} p @param {{ refs?: boolean }} [o]
 */
export function footprintAnswer(p, { refs = false } = {}) {
  const sum = (/** @type {{ bytes: number | null }[]} */ cs) => cs.reduce((n, c) => n + (c.bytes || 0), 0);
  const goingCopies = p.copies.filter((c) => c.goes);
  const kinds = /** @type {RefKind[]} */ (["subagents", "snapshots", "moves", "forks", "other"]).map((kind) => {
    const groups = p.groups.filter((g) => g.kind === kind);
    const count = (/** @type {(g: RefGroup) => boolean} */ which) => groups.filter(which).reduce((n, g) => n + g.refs.length, 0);
    return {
      kind,
      count: count(() => true),
      goes: count((g) => g.goes),
      tick: count((g) => g.tick),
      groups: groups.map((g) => ({
        owner: g.owner,
        part: g.part,
        count: g.refs.length,
        newest: newestOf(g.refs),
        goes: g.goes,
        tick: g.tick,
        others: g.others,
        why: g.why,
        ...(refs && (g.goes || g.tick) ? { refs: g.refs.map((r) => ({ ref: r.ref, commit: r.commit })) } : {}),
      })),
    };
  });
  const refsGo = kinds.reduce((n, k) => n + k.goes, 0);
  const branchesGo = p.branches.filter((b) => b.goes).length;
  return {
    copies: {
      count: p.copies.length,
      bytes: sum(p.copies),
      partial: p.copies.some((c) => c.partial),
      goes: goingCopies.length,
      goesBytes: sum(goingCopies),
      goesPartial: goingCopies.some((c) => c.partial),
      items: p.copies,
    },
    left: { count: p.left.length, bytes: sum(p.left), partial: p.left.some((l) => l.partial), items: p.left },
    refs: { count: kinds.reduce((n, k) => n + k.count, 0), goes: refsGo, tick: kinds.reduce((n, k) => n + k.tick, 0), kinds },
    branches: { count: p.branches.length, goes: branchesGo, items: p.branches.map(({ name, routine, commit, worktree, uncommitted, base, ahead, goes, why }) => ({ name, routine, commit, worktree, uncommitted, base, ahead, goes, why })) },
    goes: goingCopies.length + p.left.length + refsGo + branchesGo,
  };
}

/**
 * @typedef {{ copies: { name: string, at: number }[], left: { name: string }[], refs: { ref: string, commit: string }[], branches: { name: string, commit: string }[] }} PressedPlan
 *   what a Clean up's press sends: the copies, the folders a Clean up left, the refs and branches the sheet showed going
 *   — and the ref groups the person ticked —, each as it was read
 */

/**
 * A press's plan as its request carries it, checked: each copy by its name and its record's last use, each folder a
 * Clean up left by its name, each ref under `refs/filament/` with the commit it was read at, each branch with its commit
 * — or why it is no plan, in words.
 * @param {unknown} v
 * @returns {{ ok: true, plan: PressedPlan } | { ok: false, error: string }}
 */
export function pressedPlanOf(v) {
  const p = /** @type {any} */ (v);
  const no = (/** @type {string} */ error) => ({ ok: /** @type {const} */ (false), error });
  if (!p || typeof p !== "object") return no("plan is the plan the sheet showed: { copies, refs, branches }, each as it was read");
  const list = (/** @type {unknown} */ x) => (Array.isArray(x) ? x : null);
  const copies = list(p.copies ?? []);
  const left = list(p.left ?? []);
  const refs = list(p.refs ?? []);
  const branches = list(p.branches ?? []);
  if (!copies || !left || !refs || !branches) return no("plan's copies, left, refs and branches are lists");
  const commit = (/** @type {unknown} */ c) => typeof c === "string" && /^[0-9a-f]{40,64}$/.test(c);
  if (!copies.every((c) => typeof c?.name === "string" && Number.isFinite(c?.at))) return no("each copy of the plan is { name, at }, as the sheet read it");
  if (!left.every((l) => typeof l?.name === "string")) return no("each folder a Clean up left is { name }, as the sheet read it");
  if (!refs.every((r) => typeof r?.ref === "string" && r.ref.startsWith(REF_PREFIX) && commit(r.commit))) return no(`each ref of the plan is { ref, commit }, a ref under ${REF_PREFIX} and the commit it was read at`);
  if (!branches.every((b) => typeof b?.name === "string" && commit(b.commit))) return no("each branch of the plan is { name, commit }, as the sheet read it");
  return {
    ok: true,
    plan: {
      copies: copies.map((c) => ({ name: String(c.name), at: Number(c.at) })),
      left: left.map((l) => ({ name: String(l.name) })),
      refs: refs.map((r) => ({ ref: String(r.ref), commit: String(r.commit) })),
      branches: branches.map((b) => ({ name: String(b.name), commit: String(b.commit) })),
    },
  };
}

/**
 * What a press takes: only what is both in the plan the sheet showed (`pressed`) and goes in the repository read again
 * at the press — a copy whose record was not used since, a folder a Clean up left still there, a ref still at the
 * commit it was read at, in a group that goes or one the person ticked — a helper's group whole or not at all —, a
 * branch still at its commit. Everything else stays, with why: what the read at the press keeps, what moved since the
 * sheet's read, what the sheet did not show going.
 * @param {FootprintPlan} p  the read at the press @param {PressedPlan} pressed
 * @returns {{ copies: CopyRow[], left: LeftRow[], groups: { group: RefGroup, refs: RefRead[] }[], branches: BranchRow[],
 *   stayed: { kind: string, why: string, count: number }[] }}
 */
export function pressedTakes(p, pressed) {
  /** @type {Map<string, { kind: string, why: string, count: number }>} */
  const stayed = new Map();
  /** @param {string} kind @param {string} why @param {number} n */
  const stays = (kind, why, n) => {
    if (!n) return;
    const k = `${kind}\n${why}`;
    const had = stayed.get(k) || { kind, why, count: 0 };
    had.count += n;
    stayed.set(k, had);
  };
  const sentCopies = new Map(pressed.copies.map((c) => [c.name, c.at]));
  /** @type {CopyRow[]} */
  const copies = [];
  for (const c of p.copies) {
    if (!sentCopies.has(c.name)) stays("copies", c.goes ? "the sheet you pressed on did not show it going" : c.why, 1);
    else if (!c.goes) stays("copies", c.why, 1);
    else if (sentCopies.get(c.name) !== c.at) stays("copies", "it was used since you read it", 1);
    else copies.push(c);
  }
  stays("copies", "it is gone already", pressed.copies.filter((s) => !p.copies.some((c) => c.name === s.name)).length);
  const sentLeft = new Set(pressed.left.map((l) => l.name));
  const left = p.left.filter((l) => sentLeft.has(l.name));
  stays("left", "the sheet you pressed on did not show it going", p.left.length - left.length);
  stays("left", "it is gone already", [...sentLeft].filter((n) => !p.left.some((l) => l.name === n)).length);
  const sentRefs = new Map(pressed.refs.map((r) => [r.ref, r.commit]));
  /** @type {{ group: RefGroup, refs: RefRead[] }[]} */
  const groups = [];
  let seen = 0;
  for (const g of p.groups) {
    const sent = g.refs.filter((r) => sentRefs.has(r.ref));
    seen += sent.length;
    if (!g.goes && !g.tick) {
      stays(g.kind, g.why, g.refs.length);
      continue;
    }
    const same = sent.filter((r) => sentRefs.get(r.ref) === r.commit);
    // A helper's refs go as a pair or not at all: its work's base left without its work, or half of a mark's hold, is a
    // ref nothing could tell the use of again.
    if (g.kind === "subagents" && same.length && same.length < g.refs.length) {
      stays(g.kind, "part of it moved since you read it, and a sub-agent's refs go together", g.refs.length);
      continue;
    }
    stays(g.kind, "it moved since you read it", sent.length - same.length);
    stays(g.kind, g.tick ? "you did not tick it" : "the sheet you pressed on did not show it going", g.refs.length - sent.length);
    if (same.length) groups.push({ group: g, refs: same });
  }
  stays("refs", "it is gone already", pressed.refs.length - seen);
  const sentBranches = new Map(pressed.branches.map((b) => [b.name, b.commit]));
  /** @type {BranchRow[]} */
  const branches = [];
  for (const b of p.branches) {
    if (!sentBranches.has(b.name)) stays("branches", b.goes ? "the sheet you pressed on did not show it going" : b.why, 1);
    else if (!b.goes) stays("branches", b.why, 1);
    else if (sentBranches.get(b.name) !== b.commit) stays("branches", "it moved since you read it", 1);
    else branches.push(b);
  }
  return { copies, left, groups, branches, stayed: [...stayed.values()] };
}
