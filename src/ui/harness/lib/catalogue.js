// @ts-check
// The model picker's catalogue, kept fresh (HarnessV3 §15 item 93). What each model can do (its reasoning levels, fast mode and what it costs,
// its context windows) is tuned on the console's Upstreams page; a save there reaches the page as the bus's
// config-changed, and the keeper decides when that — or a tab coming back, or a copy simply growing old — re-reads.

// With no model in it, the harness sends the developer to the console's provider catalogue with its add flow open
// (HarnessV3-Launch LD-D4), in one named window: a second click comes back to the console already open.
export const CONSOLE_WINDOW = "filament-console";
export const CONNECT_URL = "/ui/?add=1#destinations";

/**
 * @param {{
 *   read: () => Promise<any>,
 *   paint: (catalogue: any) => void,
 *   before?: () => unknown,
 *   now?: () => number,
 *   wait?: number,
 * }} o `read` fetches the catalogue, `paint` shows it, `before` runs ahead of a refresh's read (its failure never keeps
 *   the read from happening), `wait` is the quiet time a burst of refreshes is folded into (ms).
 */
export function createCatalogueKeeper(o) {
  const now = o.now || Date.now;
  // A copy that never landed is as stale as it gets.
  let at = -Infinity;
  let seq = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const load = () => {
    const n = ++seq;
    return o.read().then((catalogue) => {
      // Two reads in flight answer in any order: only the newest is painted.
      if (n !== seq) return catalogue;
      o.paint(catalogue);
      at = now();
      return catalogue;
    });
  };
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      Promise.resolve().then(() => o.before?.()).catch(() => {}).finally(() => load().catch(() => {}));
    }, o.wait ?? 400);
  };
  const olderThan = (/** @type {number} */ ms) => now() - at > ms;
  const refreshIfOlder = (/** @type {number} */ ms) => {
    if (olderThan(ms)) refresh();
  };
  return { load, refresh, olderThan, refreshIfOlder };
}
