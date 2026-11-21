// @ts-check
// Node's fetch hands every request to its global dispatcher, kept under undici's key: a test reads what each request
// asked of it. A call to a provider asks for no limit on its reply's head nor between the chunks of its body
// (adapters/providers/fetch.js, HarnessV3-FailurePoints §4 A); a fetch as it is asks for neither, so Node's 300 s stand.

const SLOT = Symbol.for("undici.globalDispatcher.1");

/** @typedef {{ origin: string, path: string, headersTimeout: number | undefined, bodyTimeout: number | undefined }} Dispatched */

/**
 * Run `fn` with Node's global dispatcher watched: each request it is handed is recorded, then passed on — or, with
 * `refuse`, failed at once, so no request leaves the machine (a provider whose hosts are fixed).
 * @param {() => Promise<unknown>} fn @param {{ refuse?: boolean }} [o]
 * @returns {Promise<Dispatched[]>}
 */
export async function watchDispatches(fn, { refuse = false } = {}) {
  void globalThis.fetch;
  const g = /** @type {any} */ (globalThis);
  const own = g[SLOT];
  /** @type {Dispatched[]} */
  const seen = [];
  g[SLOT] = {
    /** @param {any} opts @param {any} handler */
    dispatch(opts, handler) {
      seen.push({ origin: String(opts.origin), path: String(opts.path), headersTimeout: opts.headersTimeout, bodyTimeout: opts.bodyTimeout });
      if (!refuse) return own.dispatch(opts, handler);
      queueMicrotask(() => handler.onError(new Error("no request leaves this test")));
      return true;
    },
  };
  try {
    await fn();
  } finally {
    g[SLOT] = own;
  }
  return seen;
}
