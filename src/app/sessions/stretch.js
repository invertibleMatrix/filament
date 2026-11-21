// @ts-check
// A chat's work stretch (the owner's of 11-03: "if you have any background command running and you end your turn, it
// should not reset the time but accumulate that time"): it begins with a turn begun while nothing of the chat's was
// open, and goes on through every turn that ended while something whose end wakes its agent was — a background command
// running, a sub-agent working for its main agent (a graph's tasks among them), its coding agent's own background
// task, a team beside it whose result goes to it by itself — or while a turn that wakes it was on its way. Now counts
// the chat's time from the stretch's start, the waits between its turns in it, and keeps the chat under Working between
// them, saying what it waits for (ui/harness/lib/now.js).
// It ends where nothing keeps it: at the end of a turn that leaves nothing, or between turns, once the last of it ends
// with no turn coming — the person stopped it, or what ended wakes nobody (the person's Stop, a restart's word, a
// refused wake). Every end is said. Its start is kept with the chat (`workSince` in its meta) only while it outlasts a
// turn: a turn a restart cuts there leaves it to the turn that goes on with it, and one that begins and ends with
// nothing open writes nothing.
// A turn begins a new stretch where nothing is open — unless what it waited on woke it: a command's end, a report, a
// team's result, its coding agent's own task, a cut turn going on.

/**
 * What keeps a chat's stretch going between its turns: how many of its commands run, of its sub-agents work for its
 * main agent, of its coding agent's own background tasks run, of its teams beside it will send their result by
 * themselves, and of its task graph's checks Filament runs, whose verdict wakes its agent (the owner's of 11-06) — and
 * whether a turn that wakes its agent is on its way (`coming`).
 * @typedef {{ commands: number, agents: number, tasks: number, teams: number, checks: number, coming: boolean }} Waits
 */
/**
 * A stretch going, as the page is told it: its chat, its start, and, between its turns, what it waits for.
 * @typedef {{ chainId: string, since: number, waits?: StretchWaits }} StretchRow
 * @typedef {Omit<Waits, "coming">} StretchWaits
 */
/**
 * Where a chat's meta is (memory's archive), read at each call: none where memory keeps no archive.
 * @typedef {{ metaOf: (chainId: string, keys: readonly string[]) => Record<string, any> | null, mergeMeta: (chainId: string, patch: Record<string, any>) => any }} StretchArchive
 */

/** @param {Waits} w */
const goesOn = (w) => w.coming || w.commands + w.agents + w.tasks + w.teams + (w.checks || 0) > 0;
/** @param {Waits} w @returns {StretchWaits} */
const said = (w) => ({ commands: w.commands, agents: w.agents, tasks: w.tasks, teams: w.teams, checks: w.checks || 0 });

/**
 * The chats' work stretches. `waits`: what keeps a chat's going now; `moved`: a stretch began, went on with a turn or
 * past its end — what it waits for then —, or ended (null).
 * @param {{ archive: () => StretchArchive | null, waits: (chainId: string) => Waits, moved?: (chainId: string, since: number | null, waits?: StretchWaits) => void, now?: () => number }} o
 */
export function createStretches({ archive, waits, moved = () => {}, now = Date.now }) {
  /** The stretches going in this process, by chat: its start, and whether the chat's meta keeps it. @type {Map<string, { since: number, kept: boolean }>} */
  const going = new Map();
  /** The start the chat's meta keeps, 0 for none. @param {string} chainId */
  const keptOf = (chainId) => Number(archive()?.metaOf(chainId, ["workSince"])?.workSince) || 0;
  /** The stretch is over: the meta lets go of it where it kept it, and its end is said. @param {string} chainId @param {boolean} kept */
  const end = (chainId, kept) => {
    going.delete(chainId);
    if (kept) archive()?.mergeMeta(chainId, { workSince: undefined });
    moved(chainId, null);
  };
  return {
    /**
     * A turn of the chat begins: it goes on with the stretch where something is open or on its way, or what it waited on
     * woke it (`woken`); else one begins with it, and one the meta kept from before is let go of. → the stretch's start.
     * @param {string} chainId @param {{ woken?: boolean }} [o]
     */
    began(chainId, { woken = false } = {}) {
      const had = going.get(chainId);
      const was = had ? had.since : keptOf(chainId);
      const kept = had ? had.kept : was > 0;
      if (was > 0 && (woken || goesOn(waits(chainId)))) {
        going.set(chainId, { since: was, kept });
        moved(chainId, was);
        return was;
      }
      if (kept) archive()?.mergeMeta(chainId, { workSince: undefined });
      const since = now();
      going.set(chainId, { since, kept: false });
      moved(chainId, since);
      return since;
    },
    /**
     * A turn of the chat ended: its stretch ends with it where nothing keeps it; else it outlasts the turn — kept with the
     * chat, once — and what it waits for is said. @param {string} chainId
     */
    ended(chainId) {
      const g = going.get(chainId);
      if (!g) return;
      const w = waits(chainId);
      if (!goesOn(w)) return end(chainId, g.kept);
      if (!g.kept) {
        archive()?.mergeMeta(chainId, { workSince: g.since });
        g.kept = true;
      }
      moved(chainId, g.since, said(w));
    },
    /** Something of the chat's ended, or a wake came to nothing, while no turn of it runs: its stretch ends where nothing keeps it. @param {string} chainId */
    settle(chainId) {
      const g = going.get(chainId);
      if (g && !goesOn(waits(chainId))) end(chainId, g.kept);
    },
    /**
     * The stretches going now, each chat's start — and, between its turns, what it waits for. One a turn of the chat
     * runs (`running`) goes on whatever is open; one with neither is over, and ends here.
     * @param {(chainId: string) => boolean} running
     * @returns {StretchRow[]}
     */
    going(running) {
      /** @type {StretchRow[]} */
      const out = [];
      for (const [chainId, g] of [...going]) {
        if (running(chainId)) {
          out.push({ chainId, since: g.since });
          continue;
        }
        const w = waits(chainId);
        if (goesOn(w)) out.push({ chainId, since: g.since, waits: said(w) });
        else end(chainId, g.kept);
      }
      return out;
    },
  };
}
/** @typedef {ReturnType<typeof createStretches>} Stretches */
