// @ts-check
// A read asked again and again while one is on its way (the performance audit of 10-29): the agents' list at every
// sub-agent's message, an agent's thread at every one of its own. Each ask read anew beside the reads still on their
// way, the older answers dropped as they landed — a burst of messages sent out reads faster than they came back. Here
// one read is on its way at a time, and one at most waits behind it, which every ask meanwhile shares: whoever awaits
// an ask has a read that started after it. DOM-free: it runs the read it is given.

/**
 * @param {() => Promise<void>} read
 * @returns {{ ask: () => Promise<void>, reset: () => void }}  `reset`: what it reads changed (another session) — the
 *   read on its way is left to land unheeded, the one behind it is dropped, and the next ask reads at once
 */
export function oneBehind(read) {
  /** @type {Promise<void> | null} */
  let inFlight = null;
  /** @type {Promise<void> | null} */
  let behind = null;
  const start = () => {
    const done = read().finally(() => {
      if (inFlight === done) inFlight = null;
    });
    inFlight = done;
    return done;
  };
  return {
    ask() {
      if (!inFlight) return start();
      if (behind) return behind;
      // After the one on its way, however it ended.
      const next = () => {
        if (behind !== after) return;
        behind = null;
        return start();
      };
      const after = inFlight.then(next, next);
      behind = after;
      return after;
    },
    reset() {
      inFlight = null;
      behind = null;
    },
  };
}
