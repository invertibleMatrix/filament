// @ts-check
// A chat's watchers, said to its page (the plan of 11-11, its w8): the line over a chat's box names the watchers that
// watch it and those that wake it. The list is core's (`chatWatchers`), from every Space's routines. A chat's
// transcript carries it (`of`); after that, each change of a Space that moves a chat's list is said whole on the
// events feed (`moved`, heard on the bus's `space`) — to the chats whose list moved alone, so a Space's other changes
// say nothing of them. A chat's name that changes with no Space changing is said at the next change, or read.
// So are the turns of a chat its watchers reviewed, by their numbers (`reviews`; core/watchers.js `reviewsByTurn`),
// for the chip under each: the transcript carries them, and `moved` says a chat's whole map again where it moved. Here
// too is what a watcher's turn in a chat is drawn from: a guidance turn's parts, from what its Space keeps of it
// (`guide`), and what woke a chat, from what its turn keeps (`woke`).
import { chatWatchers } from "../core/routines.js";
import { reviewsByTurn, triggerChat } from "../core/watchers.js";

/**
 * A guidance turn's parts, for its card: its `title` and the reviewer's `text`; `chat`, the chat whose agent wrote it
 * (the one its watcher wakes, or a run's); and, while its watcher is switched on, the watcher by its id and Space and
 * whether it is paused: what the card's Pause writes to.
 * @typedef {{ title: string, text: string, chat?: string, watcher?: string, project?: string, paused?: boolean }} GuideParts
 * What woke a chat, for its turn's capsule: the watcher by its id and Space, its title then, and what it heard.
 * @typedef {{ id: string, project: string, title: string, words: import("../core/space.js").NamedWords }} Woke
 */

/**
 * @param {{ spaces: Pick<import("../services/spaces.js").SpaceStore, "routinesAll"> & Partial<Pick<import("../services/spaces.js").SpaceStore, "projects" | "get" | "pausedSince">>,
 *   nameOf: (chain: string) => string,
 *   publish: (chain: string, watchers: import("../core/routines.js").ChatWatcher[]) => void,
 *   publishReviews?: (chain: string, reviews: Record<string, import("../core/watchers.js").TurnReview[]>) => void,
 *   now?: () => number, log?: (level: string, msg: string) => void }} deps  `nameOf`: a chat's name as the person's
 *   pages say it; `publish`: a chat's whole list, to the pages; `publishReviews`: a chat's reviews, whole, to them
 */
export function createChatWatchers({ spaces, nameOf, publish, publishReviews = () => {}, now = Date.now, log = () => {} }) {
  /** What each chat was last told, as JSON; a chat told of none is not kept. @type {Map<string, string>} */
  const told = new Map();
  /**
   * The reviews each chat's transcript read, as its Spaces keep them, as JSON — "[]" where it read none: a chat whose
   * page never read them is told of none. @type {Map<string, string>}
   */
  const read = new Map();
  /** Each Space with its project. */
  const docs = () => (spaces.projects?.() || []).map((project) => ({ project, doc: spaces.get?.(project) }));
  /** Every Space's reviews by their chat, each with its Space's project. */
  const reviewed = () => {
    /** @type {Map<string, { project: string, v: import("../core/watchers.js").Review }[]>} */
    const by = new Map();
    for (const { project, doc } of docs())
      for (const v of doc?.reviews || []) {
        const rows = by.get(v.chain) || [];
        if (!rows.length) by.set(v.chain, rows);
        rows.push({ project, v });
      }
    return by;
  };
  return {
    /**
     * A chat's watchers now, as its transcript says them: kept as told, so the change after is said to it — a Filament
     * just started has said nothing on the feed yet, and a watcher removed then names no chat any more.
     * @param {string} chain
     */
    of(chain) {
      const list = chatWatchers(spaces.routinesAll(), chain, { nameOf, pausedAll: !!spaces.pausedSince?.() });
      if (list.length) told.set(chain, JSON.stringify(list));
      else told.delete(chain);
      return list;
    },
    /**
     * A chat's reviews now, by its turns' numbers, as its transcript says them: kept as read, so the change after is
     * said to it. @param {string} chain
     */
    reviews(chain) {
      const rows = reviewed().get(chain) || [];
      read.set(chain, JSON.stringify(rows));
      return reviewsByTurn(rows, now());
    },
    /**
     * The parts of the guidance that began a chat's turn, from what a Space keeps of it by the turn's number; null
     * where none keeps it (a Space keeps its newest). @param {string} chain @param {number} turn
     * @returns {GuideParts | null}
     */
    guide(chain, turn) {
      for (const { project, doc } of docs()) {
        const g = (doc?.guidance || []).find((x) => x.to === chain && x.how === "turn" && x.turn === turn);
        if (!g) continue;
        const r = doc?.routines.find((x) => x.id === g.watcher && x.state === "on");
        const said = { title: g.title, text: g.text, chat: g.from };
        return r ? { watcher: r.id, project, ...said, paused: r.paused } : said;
      }
      return null;
    },
    /**
     * What woke a chat, as its turn keeps it (app/routines.js `wakeChat`), each chat it names by its name now; null
     * for a turn that keeps none. @param {unknown} kept @returns {Woke | null}
     */
    woke(kept) {
      const k = /** @type {any} */ (kept);
      if (!k || typeof k.id !== "string" || typeof k.project !== "string" || !Array.isArray(k.words)) return null;
      const words = k.words.flatMap((/** @type {any} */ w) => (typeof w === "string" ? [w] : typeof w?.chain === "string" ? [{ chain: w.chain, name: nameOf(w.chain) }] : []));
      return { id: k.id, project: k.project, title: String(k.title ?? ""), words };
    },
    /**
     * A Space changed: each chat a watcher names, and each that was told of one, is told its list where it is another
     * now; each chat that read its reviews is told them where they moved. Heard inside the Space's own write: a
     * failure here is logged and stops nothing.
     */
    moved() {
      try {
        const rows = spaces.routinesAll();
        const pausedAll = !!spaces.pausedSince?.();
        const chains = new Set(told.keys());
        for (const { r } of rows) {
          if (!r.trigger || r.state === "removed") continue;
          const watched = triggerChat(r.trigger);
          if (watched) chains.add(watched);
          if ((r.wakes || "new") === "chat") chains.add(r.madeIn);
        }
        for (const chain of chains) {
          const list = chatWatchers(rows, chain, { nameOf, pausedAll });
          const said = list.length ? JSON.stringify(list) : "";
          if (said === (told.get(chain) || "")) continue;
          if (said) told.set(chain, said);
          else told.delete(chain);
          publish(chain, list);
        }
        if (!read.size) return;
        const by = reviewed();
        for (const [chain, had] of read) {
          const mine = by.get(chain) || [];
          const kept = JSON.stringify(mine);
          if (kept === had) continue;
          read.set(chain, kept);
          publishReviews(chain, reviewsByTurn(mine, now()));
        }
      } catch (/** @type {any} */ e) {
        log("warn", `watchers: the chats were not told of a change (${String(e?.message || e).slice(0, 160)})`);
      }
    },
  };
}
