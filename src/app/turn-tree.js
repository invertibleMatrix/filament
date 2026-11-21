// @ts-check
// One turn's working-tree snapshots (WP-J.2) and what each of its agents changed (HarnessV4_Git_Plan step 1), as the
// agent loop and the coding agents' turns take them: onto the session's chain, by the archive turn the request opened.
//
// A place is the top folder of a repository or worktree. The chat's folder is one; any other a write lands in becomes
// one and stays the chat's (GW-D3). A turn begins with a snapshot of each — what was there before it, work not yet
// committed or edits by hand since the last turn, is never the turn's — written only when the place differs from where
// the chain left it, with no ref (`keep: false`): the turn's next snapshot is its child, which keeps it.
//
// The loop snapshots the places a round's hands will write in just before they run (`before`), the folder and every
// followed place where a command or a helper runs (GW-D4); every round that wrote snapshots them again after (`take`),
// and a helper's report that says it wrote, as it is delivered, before the next round's hands run. A round's
// record, per place and per agent, names the snapshots around it and the files its own calls named, so a turn's
// changes are its agents' own files — never what someone else wrote in the folder meanwhile, which a diff of the whole
// folder counted as the turn's (§1.2). A coding agent runs its hands without waiting for Filament: its rounds start
// from the place's previous snapshot.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { placeOf, snapshotTree } from "../adapters/git/snapshot.js";

/** How long the starting point may take: the turn's first model call, or the agent's prompt, waits for it. */
const BEGIN_TIMEOUT_MS = 30_000;

/**
 * @typedef {{ timeoutMs?: number, signal?: AbortSignal | null }} Leash
 * @typedef {import("../adapters/git/snapshot.js").SnapshotResult} SnapshotResult
 * @typedef {import("../core/types.js").RoundChange} RoundChange
 * @typedef {{ by: string, paths: string[], command?: boolean }} Writes  a helper's own writes in a folder it shares
 *   with the session, or a change Filament applied there for it: absolute paths; `command`, it ran commands as well
 * @typedef {{ rows: RoundChange[], snapshots: { place: string, ref: string, commit: string }[], errors: { place: string, error: string, timedOut?: boolean }[] }} Taken
 *   a round's record: its rows as kept, the snapshots it wrote under a ref, and each place it could not snapshot this
 *   round, or as the turn began or before the round's hands ran (the turn says each place once, and once more where
 *   its snapshot then ran past its time: `timedOut`)
 * @typedef {Record<string, { from: string | null, base: RoundChange["base"], hands: Record<string, { paths: string[], command: boolean }> }>} Waiting
 *   what rounds whose snapshot of a place failed wrote there, by place, as a pause parks it (`missed`)
 * @typedef {{ begin: (leash?: Leash) => Promise<void>, before: (round: number, o?: { paths?: string[], command?: boolean } & Leash) => Promise<void>, take: (round: number, o?: { own?: string[], command?: boolean, writes?: Writes[] } & Leash) => Promise<Taken>, next: () => Record<string, string>, waiting: () => Waiting | null }} TurnTree
 */

/** A place's key in a ref's name: worktrees of one repository share their refs, so each place's snapshots are apart. @param {string} place */
const placeKey = (place) => createHash("sha1").update(place.toLowerCase()).digest("hex").slice(0, 8);

/**
 * A path inside a place, as git names it there; null when the place does not hold it.
 * @param {string} place @param {string} path  absolute
 */
const within = (place, path) => {
  const r = relative(place, path);
  return r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`) ? r.split(sep).join("/") : null;
};

/**
 * @param {{ memory: any, chainId: string, turnId: number, turnNo: number, root: string, from?: Record<string, string> | null, waiting?: Waiting | null }} o
 *   `turnId`: the archive row the records go under; `turnNo`: the chain's turn number, which names the refs; `root`:
 *   the chat's folder; `from`: where each place stood when a paused turn parked, and `waiting` what its failed
 *   snapshots left to name — the turn that answers the pause continues there
 * @returns {TurnTree}
 */
export function createTurnTree({ memory, chainId, turnId, turnNo, root, from = null, waiting = null }) {
  /** The newest snapshot this turn has of each place. @type {Map<string, string>} */
  const last = new Map(from && typeof from === "object" ? Object.entries(from).filter(([, c]) => typeof c === "string" && c) : []);
  /** The places whose snapshot ran past its time this turn, with why: tried no more, as each try would wait as long. @type {Map<string, string>} */
  const broken = new Map();
  /**
   * What the rounds whose snapshot of a place failed wrote there, until a round's snapshot of it holds them: where the
   * first of them started (`from`, with its `base`; null where none is known) and each agent's files and commands.
   * @type {Map<string, { from: string | null, base: RoundChange["base"], hands: Map<string, { paths: string[], command: boolean }> }>}
   */
  const missed = new Map(
    Object.entries(waiting && typeof waiting === "object" ? waiting : {}).map(([place, m]) => [
      place,
      { from: typeof m?.from === "string" ? m.from : null, base: m?.base || "head", hands: new Map(Object.entries(m?.hands || {})) },
    ]),
  );
  /**
   * What the turn wrote in its folder that no snapshot holds: the newest round whose snapshot of the folder failed, or
   * found it left (its snapshot past its time), the files the rounds since named there and whether one ran a command.
   * It is on the turn's record (`recordTreeUnheld`), so a fork from the turn says its files miss them; a snapshot of
   * the folder after holds all of it.
   * @type {{ round: number, files: string[], command: boolean } | null}
   */
  let unheld = null;
  /** @param {number} round @param {string[]} files @param {boolean} command */
  const holdsNot = (round, files, command) => {
    if (!unheld && !files.length && !command) return;
    unheld = { round, files: [...new Set([...(unheld?.files || []), ...files])], command: !!unheld?.command || command };
    memory.recordTreeUnheld?.(turnId, unheld);
  };
  /** A snapshot that failed as the turn began or before a round's hands ran, said with the next round's record. @type {Taken["errors"]} */
  const unsaid = [];
  /** What each path's place is, once asked. @type {Map<string, Promise<{ place: string | null, outside: boolean, error: string }>>} */
  const places = new Map();
  /**
   * The open round's starting snapshots, by place (`before`): each taken once, by whichever hand asks first — the
   * sub-agents of one round start together, and a later one's snapshot would hold what an earlier one wrote.
   * @type {{ round: number, at: Map<string, Promise<string | null>> }}
   */
  let held = { round: 0, at: new Map() };
  /** The snapshots one after another: two git runs on one repository at once are never asked for. */
  let queue = /** @type {Promise<unknown>} */ (Promise.resolve());
  /** @type {Promise<string | null> | null} */
  let folderAsked = null;
  const folder = () => (folderAsked ||= placeOf(root).then((p) => p.place));
  /** @param {string} path */
  const placeOfPath = (path) => {
    let p = places.get(path);
    if (!p) places.set(path, (p = placeOf(path)));
    return p;
  };
  /** The folder and the places the chat follows. */
  const followed = async () => {
    const f = await folder();
    // One whose folder is gone holds nothing to snapshot, and is no failure to say.
    const rest = /** @type {string[]} */ (memory.placesOf?.(chainId) || []).filter((p) => existsSync(p));
    return [...new Set([...(f ? [f] : []), ...rest])];
  };
  /**
   * A place a write landed in becomes the chat's (GW-D3); one a refused write only named does not.
   * @param {string} place
   */
  const follow = async (place) => {
    if (place !== (await folder())) memory.followPlace?.(chainId, place);
  };
  /** @param {string} place */
  const lastOf = (place) => last.get(place) || memory.lastInPlace?.(chainId, place) || null;
  /** A snapshot's name in the folder; another place's carries its key (`snap`). @param {string} what */
  const refName = (what) => `${chainId}/${turnNo}-${what}`;
  /** Why git could not tell a file's place, said once a turn. @type {Set<string>} */
  const unplaced = new Set();
  /**
   * One snapshot of a place, from where it last stood. One that failed — a file written while git read it, a ref
   * another git held — is tried again at the next: the place's snapshot after that one holds what the failed one
   * missed (`take` names its files then, `missed`). One that ran past its time leaves the place for the rest of the
   * turn (null) — save on the turn's start's shorter leash (`leave` false): a round's own may hold. `from`: the
   * commit it is the child of, where not the place's newest (null: HEAD).
   * @param {string} place @param {{ name: string, message: string, keep: boolean, leave?: boolean, from?: string | null } & Leash} o @returns {Promise<SnapshotResult | null>}
   */
  const snap = async (place, { name, message, keep, leave = true, from: parent, timeoutMs, signal = null }) => {
    if (broken.has(place)) return null;
    const f = await folder();
    const s = await snapshotTree(place, { name: place === f ? name : `${name}-in-${placeKey(place)}`, previous: parent === undefined ? lastOf(place) : parent, message, keep, signal, ...(timeoutMs ? { timeoutMs } : {}) });
    if (!s.ok) {
      if (s.timedOut && leave) broken.set(place, s.error || "unknown");
      return s;
    }
    if (s.at) last.set(place, s.at);
    return s;
  };

  return {
    /** The folder and each followed place as the turn begins, where they differ from where the chain left them. */
    async begin({ timeoutMs = BEGIN_TIMEOUT_MS, signal = null } = {}) {
      for (const place of await followed()) {
        const s = await snap(place, { name: refName("start"), message: `Filament: the working tree as session ${chainId}'s turn ${turnNo} began`, keep: false, leave: false, timeoutMs, signal });
        // One the request's end abandoned is the stop's to say.
        if (s && !s.ok && !signal?.aborted) unsaid.push({ place, error: s.error || "unknown", ...(s.timedOut ? { timedOut: true } : {}) });
      }
    },
    /**
     * The places a round's hand is about to write in, as they stand before it runs: each once a round. `paths` the
     * files its write or edit names (absolute); `command`, it runs a command, which may write anywhere.
     */
    async before(round, { paths = [], command = false, timeoutMs, signal = null } = {}) {
      if (held.round !== round) held = { round, at: new Map() };
      const open = held.at;
      /** @type {string[]} */
      const targets = command ? await followed() : [];
      for (const path of paths) {
        const p = await placeOfPath(path);
        if (p.place) targets.push(p.place);
      }
      /** @type {Promise<string | null>[]} */
      const waits = [];
      for (const place of new Set(targets)) {
        let at = open.get(place);
        if (!at) {
          at = queue.then(async () => {
            const s = await snap(place, { name: refName(`${round}-before`), message: `Filament: the working tree before session ${chainId}'s turn ${turnNo}, round ${round}`, keep: false, timeoutMs, signal });
            if (s && !s.ok && !signal?.aborted) unsaid.push({ place, error: s.error || "unknown", ...(s.timedOut ? { timedOut: true } : {}) });
            return s?.ok && s.at ? s.at : null;
          });
          queue = at.catch(() => null);
          open.set(place, at);
        }
        waits.push(at);
      }
      await Promise.all(waits);
    },
    /**
     * The places a round wrote in, after it, and its record: per place, a row for its own agent (`own`: what its write
     * and edit calls named, absolute; `command`, it ran one) and one per helper (`writes`). A file outside any
     * repository is kept by its path, with no snapshot. A round that names nothing it wrote snapshots the folder.
     */
    async take(round, { own = [], command = false, writes = [], timeoutMs, signal = null } = {}) {
      /** @type {Taken} */
      const out = { rows: [], snapshots: [], errors: unsaid.splice(0) };
      const f = await folder();
      const open = held.round === round ? held.at : new Map();
      held = { round: 0, at: new Map() };
      /** The round's starting snapshot of each place that has one. @type {Map<string, string>} */
      const at = new Map();
      for (const [place, taking] of open) {
        const c = await taking.catch(() => null);
        if (c) at.set(place, c);
      }
      /** @type {{ agent: string, paths: string[], command: boolean }[]} */
      const hands = [{ agent: "", paths: own, command }, ...writes.map((w) => ({ agent: String(w.by), paths: w.paths, command: !!w.command }))];
      /** Each agent's files by place ("" outside any repository). @type {Map<string, Map<string, string[]>>} */
      const named = new Map();
      for (const hand of hands) {
        for (const path of hand.paths) {
          const p = await placeOfPath(path);
          if (!p.place && !p.outside) {
            if (!unplaced.has(p.error)) out.errors.push({ place: path, error: p.error });
            unplaced.add(p.error);
            continue;
          }
          const place = p.place || "";
          const files = named.get(place) || new Map();
          named.set(place, files);
          const name = place ? within(place, path) : path;
          if (name) files.set(hand.agent, [...(files.get(hand.agent) || []), name]);
        }
      }
      // A place snapshotted before a write the fence then refused is no target: nothing landed there.
      const kept = await followed();
      /** @type {Set<string>} */
      const targets = new Set([...[...at.keys()].filter((p) => kept.includes(p)), ...[...named.keys()].filter(Boolean)]);
      if (hands.some((h) => h.command)) for (const place of kept) targets.add(place);
      if (!targets.size && !named.has("") && f) targets.add(f);
      // A place an earlier round could not snapshot is snapshotted now, with what that round wrote there.
      for (const place of missed.keys()) targets.add(place);
      for (const place of targets) {
        if (named.has(place)) await follow(place);
        const prev = at.get(place) || lastOf(place);
        const m = missed.get(place);
        // Where a failed round's writes wait, the snapshot is the child of where that round started: this round's
        // starting snapshot holds them, and one of this round that changed nothing would keep them under no ref.
        const s = await snap(place, { name: refName(String(round)), message: `Filament snapshot: session ${chainId}, turn ${turnNo}, round ${round}`, keep: true, ...(m ? { from: m.from } : {}), timeoutMs, signal });
        if (!s?.ok) {
          if (place === f) holdsNot(round, [...(named.get(place)?.values() || [])].flat(), hands.some((h) => h.command));
          if (!s) continue;
          out.errors.push({ place, error: s.error || "unknown", ...(s.timedOut ? { timedOut: true } : {}) });
          const w = m || { from: prev, base: at.has(place) ? "round" : prev ? "last" : "head", hands: new Map() };
          missed.set(place, w);
          for (const hand of hands) {
            const mine = named.get(place)?.get(hand.agent) || [];
            if (!mine.length && !hand.command) continue;
            const had = w.hands.get(hand.agent) || { paths: [], command: false };
            w.hands.set(hand.agent, { paths: [...had.paths, ...mine], command: had.command || hand.command });
          }
          continue;
        }
        missed.delete(place);
        if (s.changed && s.ref && s.commit) {
          out.snapshots.push({ place, ref: s.ref, commit: s.commit });
          if (place === f) memory.recordTreeSnapshot?.(turnId, { ref: s.ref, commit: s.commit, round });
        } else if (place === f && unheld) memory.recordTreeUnheld?.(turnId, null);
        if (place === f) unheld = null;
        // A failed round's start the repository no longer has (or none known): from HEAD, as the snapshot is.
        const carried = !!m?.from && s.parent === m.from;
        /** @type {RoundChange["base"]} */
        const base = m ? (carried ? m.base : "head") : at.has(place) ? "round" : prev && s.parent === prev ? "last" : "head";
        const before = m ? s.parent || null : at.get(place) || s.parent || null;
        const after = s.at || null;
        if (after === before) continue;
        /** Each agent's hand here, with what it wrote in the rounds that failed before. @type {Map<string, { paths: string[], command: boolean }>} */
        const here = new Map();
        for (const hand of hands) {
          const had = here.get(hand.agent) || m?.hands.get(hand.agent) || { paths: [], command: false };
          here.set(hand.agent, { paths: [...had.paths, ...(named.get(place)?.get(hand.agent) || [])], command: had.command || hand.command });
        }
        for (const [agent, had] of m?.hands || []) if (!here.has(agent)) here.set(agent, had);
        for (const [agent, { paths, command: ran }] of here) {
          if (!paths.length && !ran) continue;
          out.rows.push({ place, round, agent, before, after, base, own: [...new Set(paths)], command: ran });
        }
      }
      for (const [agent, paths] of named.get("") || [])
        out.rows.push({ place: "", round, agent, before: null, after: null, base: "none", own: [...new Set(paths)], command: false });
      for (const row of out.rows) memory.recordRoundChange?.(turnId, row);
      return out;
    },
    /** Where each place stands as the turn goes on: a pause parks it, and the turn that answers continues there. */
    next: () => Object.fromEntries(last),
    /** What failed snapshots left to name, as a pause parks it (`Waiting`); null where nothing waits. */
    waiting: () =>
      missed.size
        ? Object.fromEntries([...missed].map(([place, m]) => [place, { from: m.from, base: m.base, hands: Object.fromEntries(m.hands) }]))
        : null,
  };
}
