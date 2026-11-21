// @ts-check
// A call through the front door that waits for a slot at its provider (health.js's gate), told to the code that made
// it — HarnessV3-AtHome AH-F5. Filament's own calls name themselves with the house header `x-filament-call`
// (app/internal-call.js); the dispatch says when one starts to wait, in words, and when it gets its slot. The caller
// lives in this process, so the news goes in-process: one listener per call, gone when the call ends. The same way,
// each memory call Filament ran inside the call (the owner's of 10-29): its model never hands the caller those, and the
// request's record keeps none of their words.

/**
 * A wait for a slot, as the dispatch says it: the words, and what they are made of — the provider, the model, the
 * ceiling in force and the calls holding its slots.
 * @typedef {{ words: string, upstream: string, model: string, cap: number, holders: import("./health.js").SlotHolder[] }} QueueNews
 */
/**
 * A memory call Filament ran inside the call: the model's call — its id, name and input — and what it returned, how long
 * that took, and whether it said an error.
 * @typedef {{ id: string, name: string, input: any, output: string, ok: boolean, ms: number }} MemoryCall
 */
/** @typedef {{ queued: (news: QueueNews) => void, slot: () => void, memory?: (call: MemoryCall) => void }} QueueListener */

/** @type {Map<string, QueueListener>} */
const listeners = new Map();

/**
 * Tell a listener, if the call has one. A listener's failure is its caller's: it never fails the dispatch.
 * @param {string} id @param {(l: QueueListener) => void} tell
 */
function told(id, tell) {
  const l = id ? listeners.get(id) : undefined;
  if (!l) return;
  try {
    tell(l);
  } catch {}
}

export const callWaits = {
  /**
   * Hear a call's waits for a slot until the returned function is called.
   * @param {string} id @param {QueueListener} listener
   */
  listen(id, listener) {
    listeners.set(id, listener);
    return () => {
      if (listeners.get(id) === listener) listeners.delete(id);
    };
  },
  /** The call starts to wait, said in words. @param {string} id @param {QueueNews} news */
  queued: (id, news) => told(id, (l) => l.queued(news)),
  /** The call has its slot. @param {string} id */
  slot: (id) => told(id, (l) => l.slot()),
  /** Filament ran a memory call inside the call. @param {string} id @param {MemoryCall} call */
  memory: (id, call) => told(id, (l) => l.memory?.(call)),
};
