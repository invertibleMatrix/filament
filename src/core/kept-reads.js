// @ts-check
// Reads answered at once from the last one (the slowness of 11-02): a git mark's read is several processes, seconds
// each in a large repository, and the page waited on it with one of its six connections while its other reads queued.
// A read kept answers every ask at once; past `freshMs` an ask starts the read again behind it, one under way at a time,
// and an answer that differs from the one kept is told (`onMoved`) with every spelling it was asked by, so the page asks
// again and is answered at once. Only a key with nothing kept yet waits for its read; `fresh` reads anew and waits.

/**
 * @typedef {{ has: boolean, value: any, sig: string, at: number, started: number, landed: number,
 *   p: Promise<any> | null, asked: Set<string> }} Kept
 */

/** The spellings one key keeps, for the page to know its own by. */
const ASKED_MOST = 8;

/**
 * @param {{ freshMs: number, most?: number, onMoved?: (key: string, asked: string[]) => void }} o
 */
export function keptReads({ freshMs, most = 200, onMoved = () => {} }) {
  /** @type {Map<string, Kept>} */
  const reads = new Map();
  /**
   * A read of `key` begun now; its answer kept unless a read begun after it landed first, and told where it moved what
   * was kept.
   * @param {string} key @param {Kept} e @param {() => Promise<any>} read
   */
  const start = (key, e, read) => {
    const n = ++e.started;
    const p = new Promise((land) => land(read()))
      .then((value) => {
        if (n < e.landed) return e.value;
        const sig = JSON.stringify(value);
        const moved = e.has && sig !== e.sig;
        Object.assign(e, { has: true, value, sig, at: Date.now(), landed: n });
        if (moved && reads.get(key) === e) onMoved(key, [...e.asked]);
        return value;
      })
      .finally(() => {
        if (e.p === p) e.p = null;
      });
    e.p = p;
    return p;
  };
  return {
    /**
     * `key`'s answer: the one kept, at once — read again behind it once `freshMs` old —, else its read's.
     * @param {string} key @param {() => Promise<any>} read
     * @param {{ asked?: string, fresh?: boolean }} [o]  `asked`: the spelling the page asked by
     * @returns {Promise<any>}
     */
    get(key, read, { asked = "", fresh = false } = {}) {
      let e = reads.get(key);
      if (e) reads.delete(key);
      else e = { has: false, value: null, sig: "", at: 0, started: 0, landed: 0, p: null, asked: new Set() };
      reads.set(key, e);
      while (reads.size > most) reads.delete(/** @type {string} */ (reads.keys().next().value));
      if (asked && !e.asked.has(asked)) {
        e.asked.add(asked);
        if (e.asked.size > ASKED_MOST) e.asked.delete(/** @type {string} */ (e.asked.values().next().value));
      }
      if (fresh) return start(key, e, read);
      if (!e.has) return e.p || start(key, e, read);
      if (!e.p && Date.now() - e.at >= freshMs) start(key, e, read).catch(() => {});
      return Promise.resolve(e.value);
    },
    /** Every read forgotten: a worktree removed or put back, which each read of its repository may name. */
    forget() {
      reads.clear();
    },
    /** How many keys are kept. */
    size: () => reads.size,
  };
}
