// @ts-check
// The page's own events, stood in under node: ui/lib/put-away.js listens on the window for the page being put away
// (`pagehide`) and brought back (`pageshow`), loads a page brought back afresh (`location.reload()`) and reports a
// failure as the page does (`reportError`). Installed before the first stream is held — the module listens from its
// first hold on, once — and `putAway` / `bringBack` fire the events as the browser does when it moves the page into
// the back/forward cache and out.

export function pageEvents() {
  /** @type {Map<string, ((e: { type: string, persisted: boolean }) => void)[]>} */
  const on = new Map();
  /** @param {string} type */
  const fire = (type) => {
    for (const fn of on.get(type) || []) fn({ type, persisted: true });
  };
  const page = {
    reloads: 0,
    /** @type {unknown[]} */
    reported: [],
    /** The events listened for, in the order first listened. */
    listening: () => [...on.keys()],
    putAway: () => fire("pagehide"),
    bringBack: () => fire("pageshow"),
  };
  const g = /** @type {any} */ (globalThis);
  g.addEventListener = (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => {
    on.set(type, [...(on.get(type) || []), fn]);
  };
  g.location = { reload: () => void (page.reloads += 1) };
  g.reportError = (/** @type {unknown} */ err) => void page.reported.push(err);
  return page;
}
