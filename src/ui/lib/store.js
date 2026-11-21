// @ts-check
// Preference keys for every browser surface. Prefixed so a future Electron shell can keep the same
// names without colliding with other origins; get/set swallow quota and privacy-mode failures.

const PREFIX = "filament.";

export const store = {
  /** @param {string} k */
  get: (k) => {
    try {
      return localStorage.getItem(PREFIX + k);
    } catch {
      return null;
    }
  },
  /**
   * @param {string} k
   * @param {string} v
   */
  set: (k, v) => {
    try {
      localStorage.setItem(PREFIX + k, v);
    } catch {}
  },
};
