// @ts-check
// The event bus: everything that happens in the running app that a surface may want to watch — a request record
// finishing, an operation, an agent turn's progress — is published once, by topic, and every subscriber sees it in
// publication order. Delivery is synchronous, so a subscriber that renders an event onto a client's wire writes the
// same bytes in the same order it did when the producer called it directly. Every entry is numbered by one monotonic
// `seq`. The bus keeps nothing it delivered: a run's events have the run log's own ring and file (services/runs.js).

/** @typedef {import("../core/ports.js").EventBus} EventBus */
/** @typedef {import("../core/ports.js").BusEntry} BusEntry */

/** @returns {EventBus} */
export function createEventBus() {
  let seq = 0;
  /** @type {Map<string, Set<(payload: any, entry: BusEntry) => void>>} */
  const subscribers = new Map();
  const listenersOf = (topic) => subscribers.get(topic) || new Set();
  return {
    publish(topic, payload) {
      const entry = { seq: ++seq, ts: Date.now(), topic, payload };
      for (const fn of [...listenersOf(topic), ...listenersOf("*")]) fn(payload, entry);
      return entry;
    },
    subscribe(topic, fn) {
      let set = subscribers.get(topic);
      if (!set) subscribers.set(topic, (set = new Set()));
      set.add(fn);
      // Called again, or after the topic emptied and filled anew, it touches only its own set: the topic's newer
      // subscribers keep hearing it.
      return () => {
        set.delete(fn);
        if (!set.size && subscribers.get(topic) === set) subscribers.delete(topic);
      };
    },
  };
}
