// @ts-check
// Whether this browser is still let in, asked when the events stream is refused (the owner's remote Filament of 11-06):
// a device revoked on the machine it reaches, or signed out in another tab, finds its stream refused and every call
// with it. The admin gate's refusal of a caller it does not know says so (`pair`), and the page goes to the pairing
// page rather than sit on one that reads nothing. Where it goes is this page's own word, never the answer's: an
// address in an answer is never followed (the review of 35049d31f — a path checked by hand let `/\t/host` through, which
// the URL parser reads as another site). This computer, and a device still paired, are answered, and stay; a server
// that does not answer is no refusal.

/** Where a browser this Filament does not know pairs (http/guards.js PAIR_PAGE). */
export const PAIR_PAGE = "/ui/pair.html";

/**
 * @param {{ fetchImpl?: typeof fetch, go?: (path: string) => void, inApp?: boolean }} [o]  `inApp`: this page is the
 *   desktop app's own window (its bridge, `filamentApp`), whose owner session the app makes again as Filament starts
 * @returns {Promise<boolean>} whether the page went
 */
export async function leaveIfRefused({ fetchImpl = fetch, go = (p) => location.assign(p), inApp = !!(/** @type {any} */ (globalThis).filamentApp) } = {}) {
  try {
    const r = await fetchImpl("/api/remote/me");
    if (r.ok) return false;
    const body = await r.json().catch(() => null);
    if (!body || typeof body !== "object" || !("pair" in body)) return false;
    // The app's own window told it needs the owner key: its session is a Filament's that started again, and the app
    // hands it the new one as that Filament answers (desktop/main.js `ownerSession`) — it stays, and its stream retries.
    if (inApp && /** @type {any} */ (body).ownerKey === true) return false;
    go(PAIR_PAGE);
    return true;
  } catch {
    return false;
  }
}
