// @ts-check
// A property read on first use (HarnessV4_Tasks C29). What a long session's rows name — a turn's messages, a
// compaction's summary — is opened when something reads it, never because the row was listed: a composition costs
// what the copy holds, whatever the archive has grown to.

/**
 * Give `obj` the property `key`, whose value `load` reads the first time it is asked for. From then on — or once it is
 * assigned — it is a plain property holding that value. It is enumerable from the start, so a spread, a comparison or
 * a serialization reads it like any other.
 * @template {object} T @template {string} K @template V
 * @param {T} obj @param {K} key @param {() => V} load
 * @returns {T & Record<K, V>}
 */
export function lazy(obj, key, load) {
  const settle = (/** @type {V} */ value) => void Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get() {
      const value = load();
      settle(value);
      return value;
    },
    set(value) {
      settle(value);
    },
  });
  return /** @type {any} */ (obj);
}

/**
 * `{ ...obj, ...patch }`, its properties in the same order, but what `obj` has not read yet (`lazy`) left unread until
 * the copy's is: a spread reads every one of them — a turn cut off by a restart, copied with its own final line, opened
 * every message of its work at each listing of the session's turns (the owner's of 11-17: a chat's sizes held the
 * server 12 s, 5,772 messages opened at each of its views and read by none).
 * @template {object} T
 * @template {object} P
 * @param {T} obj @param {P} patch
 * @returns {Omit<T, keyof P> & P}
 */
export function lazyOver(obj, patch) {
  /** @type {any} */
  const out = {};
  /** @type {any} */
  const over = patch;
  for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
    if (!d.enumerable) continue;
    if (Object.hasOwn(over, key)) out[key] = over[key];
    else if (d.get) lazy(out, key, () => /** @type {any} */ (obj)[key]);
    else out[key] = d.value;
  }
  for (const key of Object.keys(over)) if (!Object.hasOwn(out, key)) out[key] = over[key];
  return out;
}
