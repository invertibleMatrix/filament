// @ts-check
// The settings document of the chat a page shows, read again when the events feed says it moved (BUG-10 P9). DOM-free:
// app.js wires it.

/**
 * Read the settings document again when the events feed says it moved (`settings`, with the new hash): never when the
 * page holds that hash already (it wrote it), and one read at a time — a burst of changes folds into one more read
 * after the one in flight (BUG-10 P9).
 * @param {{ held: () => string | null, read: () => Promise<unknown> }} o
 * @returns {(hash: string | null | undefined) => void}
 */
export function settingsFollower({ held, read }) {
  /** @type {Promise<unknown> | null} */
  let reading = null;
  /** @type {string | null | undefined} the newest hash heard while a read was in flight */
  let owed;
  const want = (/** @type {string | null | undefined} */ hash) => {
    if (hash && hash === held()) return;
    if (reading) {
      owed = hash ?? null;
      return;
    }
    reading = Promise.resolve()
      .then(read)
      .catch(() => {})
      .finally(() => {
        reading = null;
        if (owed === undefined) return;
        const next = owed;
        owed = undefined;
        want(next);
      });
  };
  return want;
}
