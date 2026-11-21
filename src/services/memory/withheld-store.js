// @ts-check
// Where memory's withheld exchanges live (BUG-11): the withheld messages content-addressed in the archive (encrypted
// at rest like every message there), a small table of anchor → fingerprints, and an in-process LRU in front of both,
// so a request whose anchors are all known costs no query. Anchors are unique to one reply, so the store is global —
// a fork of a session that carries the merged message is restored too, as it should be. Kept without an age limit:
// dropping an entry would flip a far-back message to its merged form and cost the cache from there on.
import { describeExchange } from "../../core/withheld.js";

const ANCHORS_MAX = 20_000;
const HYDRATED_MAX = 2_000;
/** @type {WeakMap<object, ReturnType<typeof createWithheldStore>>} */
const stores = new WeakMap();

/** The store over one archive, made once. @param {any} archive */
export function withheldStoreFor(archive) {
  if (!archive || typeof archive.putWithheld !== "function") return null;
  let s = stores.get(archive);
  if (!s) stores.set(archive, (s = createWithheldStore(archive)));
  return s;
}

/** @param {any} archive */
export function createWithheldStore(archive) {
  /** @type {Map<string, any | null>} anchor → entry, or null when the archive has none (asked once) */
  const anchors = new Map();
  /** @type {Map<string, any[]>} the entry's message hashes → the messages */
  const hydrated = new Map();
  /** @template V @param {Map<string, V>} map @param {string} k @param {V} v @param {number} max */
  const remember = (map, k, v, max) => {
    map.delete(k);
    map.set(k, v);
    if (map.size > max) map.delete(/** @type {string} */ (map.keys().next().value));
  };
  return {
    /**
     * Record one exchange when its reply ended. False when it cannot be found again (no anchor), has nothing to put
     * back, or a withheld message is too large to keep whole (restoring a truncated copy would be worse than none).
     * @param {{ format: "anthropic" | "openai", prefix: any[], head: any[], final: any[], rounds: number, lead?: string[] }} x
     *   `lead`: the lines Filament may place in front of the reply (the memory cue) — BUG-11a
     */
    put({ format, prefix, head, final, rounds, lead = [] }) {
      const d = describeExchange({ format, head, final, lead });
      if (!d || !Array.isArray(prefix) || !prefix.length) return false;
      /** @type {string[]} */
      const hashes = [];
      for (const m of prefix) {
        const r = archive.putMessage(m?.role || "assistant", m);
        if (r.truncated) return false;
        hashes.push(r.hash);
      }
      const entry = { ...d.shape, rounds: Number(rounds) || 1, prefix: hashes };
      archive.putWithheld(d.anchors, JSON.stringify(entry));
      for (const a of d.anchors) remember(anchors, a, entry, ANCHORS_MAX);
      remember(hydrated, hashes.join(","), structuredClone(prefix), HYDRATED_MAX);
      return true;
    },
    /**
     * The entries for these anchors, their withheld messages loaded.
     * @param {string[]} list
     * @returns {Map<string, { shape: any, prefix: any[] }>}
     */
    lookup(list) {
      /** @type {Map<string, any>} */
      const found = new Map();
      /** @type {string[]} */
      const miss = [];
      for (const a of list) {
        if (anchors.has(a)) {
          const e = anchors.get(a);
          if (e) found.set(a, e);
        } else miss.push(a);
      }
      if (miss.length) {
        const got = archive.withheldFor(miss);
        for (const a of miss) {
          const e = got.get(a) || null;
          remember(anchors, a, e, ANCHORS_MAX);
          if (e) found.set(a, e);
        }
      }
      /** @type {Map<string, { shape: any, prefix: any[] }>} */
      const out = new Map();
      for (const [a, e] of found) {
        if (!Array.isArray(e?.prefix) || !e.prefix.length) continue;
        const key = e.prefix.join(",");
        let msgs = hydrated.get(key);
        if (!msgs) {
          const loaded = e.prefix.map((/** @type {string} */ h) => archive.getMessage(h)?.message);
          if (loaded.some((/** @type {any} */ m) => !m || m._filament_truncated)) continue;
          msgs = loaded;
          remember(hydrated, key, loaded, HYDRATED_MAX);
        }
        out.set(a, { shape: e, prefix: /** @type {any[]} */ (msgs) });
      }
      return out;
    },
  };
}
