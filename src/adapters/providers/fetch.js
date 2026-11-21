// @ts-check
// The fetch a call to a provider goes through (HarnessV3-FailurePoints §4 A): Node's own, without its dispatcher's two
// hidden clocks, 300 s for a reply's head and 300 s between two chunks of its body. They failed a provider's call that
// was still working, and named it unreachable ("upstream zai unreachable: UND_ERR_HEADERS_TIMEOUT", `muxab4ol`). A call
// ends when the provider answers, when the provider or the network fails it, or when its caller's signal ends it.
// The request goes to Node's own global dispatcher, asked for no head and no body limit: no transport of Filament's own.
// The dispatcher's key is undici's, not a documented Node API. Should a Node version drop it, `fetchLimitsLifted` says
// so, the composition root says it once at start, and calls keep Node's limits.

const GLOBAL = Symbol.for("undici.globalDispatcher.1");

/** Whether Node's global dispatcher is where Filament reaches for it: fetch loads it, so it is touched first. */
export function fetchLimitsLifted() {
  void globalThis.fetch;
  return typeof (/** @type {any} */ (globalThis)[GLOBAL]?.dispatch) === "function";
}

/** Each request handed to Node's own dispatcher, with no limit on its head or between the chunks of its body. */
const unbounded = {
  /** @param {any} opts @param {any} handler */
  dispatch: (opts, handler) => /** @type {any} */ (globalThis)[GLOBAL].dispatch({ ...opts, headersTimeout: 0, bodyTimeout: 0 }, handler),
};

/**
 * `fetch`, waiting as long as the provider takes.
 * @param {string | URL} url @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function providerFetch(url, init = {}) {
  return fetch(url, fetchLimitsLifted() ? /** @type {RequestInit} */ ({ ...init, dispatcher: unbounded }) : init);
}
