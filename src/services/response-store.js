// @ts-check
// Responses a client may continue with `previous_response_id`: id → { items, model, at }. Bounded and time-limited;
// kept in memory only, so a restart forgets them (the client is told so when it asks for one).

/** @typedef {import("../core/ports.js").Clock} Clock */

export class ResponseStore {
  /** @param {{ ttlMs?: number, max?: number, now?: Clock }} [opts] */
  constructor({ ttlMs = 60 * 60 * 1000, max = 500, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    /** @type {Map<string, { items: any[], model?: string, at: number }>} */
    this.map = new Map();
  }
  /** @param {string} id @param {{ items: any[], model?: string }} entry */
  put(id, entry) {
    this.sweep();
    this.map.set(id, { ...entry, at: this.now() });
    while (this.map.size > this.max) this.map.delete(/** @type {string} */ (this.map.keys().next().value));
  }
  /** @param {string} id */
  get(id) {
    this.sweep();
    return this.map.get(id) || null;
  }
  sweep() {
    const cut = this.now() - this.ttlMs;
    for (const [k, v] of this.map) if (v.at < cut) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
}
