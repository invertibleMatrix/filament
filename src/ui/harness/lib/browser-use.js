// @ts-check
// Each chat's browser as Filament tells it, for the line over the box (conversation/browser-line.js; the owner's of
// 11-02). Filament says each move on the events feed (`browser`: app/browser/registry.js `moved`); a chat the page has
// heard nothing of is read once (`GET /sessions/:id/browser`), and the feed's word wins over a read it overtook. When the
// feed comes back (`hello`) what it said while it was down is not said again: every chat is forgotten, to be read anew,
// and a read still on its way from before lands nowhere. A chat seen resting marks the moment: what its agents did with
// the browser before counts no more (`restedAt`), so a turn that never touches the browser is not said to use it.

/** @typedef {import("../conversation/browser-line.js").BrowserUse} BrowserUse */

/** A chat's browser as the feed or the read says it. @param {any} x @returns {BrowserUse} */
export const useOf = (x) => ({
  busy: x?.busy || null,
  droveAt: x?.droveAt ?? null,
  taken: !!x?.taken,
  available: x?.available !== false,
  last: x?.last || null,
});

/** What a chat's browser counts as where it could not be read: at rest, until the feed says otherwise. */
const UNREAD = useOf({ available: true });

/**
 * @param {{ read: (chain: string) => Promise<any>, onMoved: (chain: string | null) => void, now?: () => number }} o
 *   `read`: the chat's browser from Filament; `onMoved`: a chat's moved — null: every chat's, the feed came back
 */
export function createBrowserUse({ read, onMoved, now = Date.now }) {
  /** @type {Map<string, BrowserUse>} */
  const uses = new Map();
  /** @type {Set<string>} */
  const reading = new Set();
  /** When each chat was last seen resting. @type {Map<string, number>} */
  const rested = new Map();
  /** The feed's comings back: a read asked before the last one lands nowhere. */
  let era = 0;
  return {
    /** @param {string} chain @returns {BrowserUse | null} */
    of: (chain) => uses.get(chain) || null,
    /** @param {string} chain */
    restedAt: (chain) => rested.get(chain) || 0,
    /** The chat is seen resting now. @param {string} chain */
    rests(chain) {
      rested.set(chain, now());
    },
    /** The chat's browser, read once where the page has heard nothing of it. @param {string} chain */
    want(chain) {
      if (!chain || uses.has(chain) || reading.has(chain)) return;
      reading.add(chain);
      const asked = era;
      read(chain)
        .then(useOf, () => UNREAD)
        .then((use) => {
          if (asked !== era) return;
          reading.delete(chain);
          if (!uses.has(chain)) uses.set(chain, use);
          onMoved(chain);
        });
    },
    /** A message of the events feed. @param {any} msg */
    heard(msg) {
      if (msg?.type === "hello") {
        era++;
        uses.clear();
        reading.clear();
        onMoved(null);
        return;
      }
      if (msg?.type !== "browser" || !msg.chainId) return;
      const chain = String(msg.chainId);
      uses.set(chain, useOf(msg));
      onMoved(chain);
    },
  };
}
