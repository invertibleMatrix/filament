// @ts-check
// What Overview reads of the open chat beyond its session view (proposal_ux §4.6): what its agents changed, as git says
// it. A widget never fetches (Facade D17): the page reads each here, once per state of
// the chat — its turns, and whether one runs — and keeps the answer. While a newer read is on its way the older answer
// stands, so a tile never blinks empty; another chat's answer is never shown; a read that fails answers what `failed`
// makes of its error, so a tile says why rather than "Reading…" for ever.

/**
 * @template T
 * @param {(chain: string) => Promise<T>} read  the read itself
 * @param {() => void} onLand  an answer landed: what shows it paints again
 * @param {(e: unknown) => T} failed  what a failed read answers
 * @returns {{ get: (chain: string, state: string) => T | null }}  `get`: the answer for the chat, or null until its
 *   first lands — asking again whenever the state moved
 */
export function keyedRead(read, onLand, failed) {
  /** The chat and state asked for last. */
  let asked = "";
  /** The answer that landed last, and the chat it is for. @type {{ chain: string, value: T } | null} */
  let held = null;
  return {
    get(chain, state) {
      if (!chain) return null;
      const key = `${chain}\n${state}`;
      if (key !== asked) {
        asked = key;
        const land = (/** @type {T} */ value) => {
          if (asked !== key) return;
          held = { chain, value };
          onLand();
        };
        read(chain).then(land, (e) => land(failed(e)));
      }
      return held && held.chain === chain ? held.value : null;
    },
  };
}

/** The state a chat's reads follow: how many turns it has, and whether one runs now. @param {any} chat */
export const chatState = (chat) => `${(chat?.turns || []).length}:${chat?.live ? "live" : "idle"}`;
