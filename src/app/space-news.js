// @ts-check
// What happened, filling itself (HarnessV4_Space_Plan S1, SG-D4): when a chat of a project ends a turn, Filament reads
// the project's places as git says them and writes its own lines in the project's Space — the chat finished, in which
// place, and what that place holds now; a lane made, a lane removed, a branch whose commits are all on its base. One
// chat's lines within the hour grow into one, and a turn whose end failed is counted once with its retry's
// (core/space.js `noteFinished`). Read on a turn's end, never on a timer; the ends that come together are read once,
// each of them a line's turn.
// A helper's chat, an archived one or one of no project writes nothing. Filament's own reading, no model: what git
// says, in Filament's words.
import { placeFacts, placeName, placesNews } from "../core/space.js";

/** How long a turn's end waits before the places are read: the turn lets go of the chat, and ends close together go as one read. */
export const NEWS_SETTLE_MS = 1_500;

/**
 * A place as git reads it (adapters/git/places.js `PlaceRead`): its folder, branch, base, how far ahead, what is not
 * committed; `missing` where its folder is gone.
 * @typedef {{ path: string, name?: string, main?: boolean, ok: boolean, missing?: boolean, branch?: string | null,
 *   base?: string | null, onBase?: boolean, ahead?: number | null, uncommitted?: { files: number } | null }} NewsPlace
 */

/**
 * What the news reads. `chat`: a chat as the archive keeps it — its project, its name, whether it is one the lists show
 * (not a helper's, not archived), the Space of your own it was handed from (`from`, HarnessV4_SpacesPlugins_Plan A4) —
 * or null; `nameOf`: a project's name as its line says it; `folderOf`: a project's folder; `places`: the places of the
 * repository a folder is in, read whole, or why not; `chatsIn`: for each folder, the chats whose folder is in it (`home`).
 * @typedef {{ store: import("../services/spaces.js").SpaceStore,
 *   chat: (chain: string) => { project: string | null, name: string, listed: boolean, from?: string | null } | null,
 *   nameOf?: (project: string) => string | null,
 *   folderOf: (project: string) => string | null,
 *   places: (folder: string) => Promise<{ ok: true, places: NewsPlace[] } | { ok: false, error: string }>,
 *   chatsIn: (folders: string[]) => Map<string, { id: string, name: string, home: boolean }[]>,
 *   log?: (level: string, msg: string) => void, settleMs?: number }} NewsDeps
 */

/** @param {NewsDeps} deps */
export function createSpaceNews({ store, chat, nameOf = () => null, folderOf, places, chatsIn, log = () => {}, settleMs = NEWS_SETTLE_MS }) {
  /** Each project's chats whose turns ended and wait for the read, each with its ends in order: the turn's number, where one was said, and whether that end failed. @type {Map<string, Map<string, { turn: number | null, failed: boolean }[]>>} */
  const ended = new Map();
  /** The projects read now; a turn that ends meanwhile is read after. @type {Set<string>} */
  const reading = new Set();
  /** The projects whose read waits for the ends close together to come. @type {Set<string>} */
  const waiting = new Set();
  /** The reads under way, for the tests to wait on. @type {Set<Promise<void>>} */
  const running = new Set();

  /**
   * One project's ended chats, read and written: each chat's line with its home place's facts, the lanes' news, the
   * places as now read. A repository git cannot read still has each chat's line, with no place.
   * @param {string} project
   */
  async function readProject(project) {
    reading.add(project);
    try {
      for (;;) {
        const chains = [...(ended.get(project) || new Map())];
        ended.delete(project);
        if (!chains.length) return;
        const folder = folderOf(project);
        const read = folder ? await places(folder) : { ok: /** @type {const} */ (false), error: "the project has no folder" };
        const list = read.ok ? read.places : [];
        const homes = read.ok ? chatsIn(list.map((p) => p.path)) : new Map();
        /** The place a chat's folder is in, of this read. @param {string} chain */
        const homeOf = (chain) => list.find((p) => (homes.get(p.path) || []).some((c) => c.id === chain && c.home)) || null;
        const finished = [];
        for (const [chain, ends] of chains) {
          const c = chat(chain);
          if (!c || !c.listed || c.project !== project) continue;
          const p = homeOf(chain);
          for (const { turn, failed } of ends) finished.push({ chain, name: c.name, place: p ? placeName(p) : null, facts: p ? placeFacts(p) : null, turn, failed });
        }
        const before = store.get(project).seen;
        const news = read.ok ? placesNews(before, list) : { lines: [], seen: null };
        store.happened(project, { finished, lines: news.lines, seen: news.seen });
      }
    } catch (/** @type {any} */ e) {
      log("warn", `space: what happened in ${project} was not written (${String(e?.message || e).slice(0, 160)})`);
    } finally {
      reading.delete(project);
      // A turn that ended while a read failed is read on its own.
      if (ended.get(project)?.size) soon(project);
    }
  }

  /** The project's read, once the ends close together have come; one already on its way takes the new end too. @param {string} project */
  function soon(project) {
    if (reading.has(project) || waiting.has(project)) return;
    waiting.add(project);
    const p = new Promise((r) => setTimeout(r, settleMs).unref?.()).then(() => {
      waiting.delete(project);
      return readProject(project);
    });
    running.add(p);
    void p.finally(() => running.delete(p));
  }

  return {
    /**
     * A chat's turn ended (the turn lock let go of it, or memory said a client's chat, which no lock holds, ended one):
     * its project's places are read once the ends close together have come. `turn`: the number of the turn that ended,
     * where it is said — a client's chat says it — and `failed`, whether that end was a request that failed: the retry
     * that goes on with such a turn ends it again, and that is the turn's line again, never a turn more. An end that
     * names no turn — a lock let go, at a turn's end, a move's, a pause's request's alike — is the chat's end once among
     * the ends close together. A chat of no project, or one Filament keeps no Space for, is let be.
     * @param {string} chain @param {number | null} [turn] @param {boolean} [failed]
     */
    ended(chain, turn = null, failed = false) {
      const c = chat(chain);
      if (!c?.listed) return;
      // Handed from a Space of your own to run elsewhere (A4): that Space's What happened says it finished, and where —
      // its own line, grown within the hour as any chat's is. A Space deleted since is let be.
      if (c.from && c.from !== c.project && store.has(c.from))
        try {
          if (store.get(c.from).own) store.happened(c.from, { finished: [{ chain, name: c.name, place: (c.project && nameOf(c.project)) || "a folder of no project", facts: null, turn, failed }] });
        } catch (/** @type {any} */ e) {
          log("warn", `space: what happened in ${c.from} was not written (${String(e?.message || e).slice(0, 160)})`);
        }
      // A project with no Space (10-29: none until the person makes one) has no What happened to write in.
      if (!c.project || !store.has(c.project)) return;
      const chats = ended.get(c.project) || new Map();
      const ends = chats.get(chain) || [];
      if (turn != null || !ends.length) chats.set(chain, [...ends, { turn, failed }]);
      ended.set(c.project, chats);
      soon(c.project);
    },
    /** Every read under way, ended (the tests'). */
    settled: async () => {
      while (running.size) await Promise.all([...running]);
    },
  };
}

/** @typedef {ReturnType<typeof createSpaceNews>} SpaceNews */
