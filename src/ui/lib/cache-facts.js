// @ts-check
// A prompt's cache numbers, and whether it has any: the page's copy of src/core/cache-facts.js, which the server's
// ledgers, facts and clocks read — the layers keep the page and the server apart, so each has its own, and
// test/cache-facts.test.js holds the two equal. A usage that carried cache numbers is marked where it was read
// (`cacheSeen`); a share is taken of the tokens so marked alone, and a usage with none has no share: what is not known
// is never 0%.

/** A usage's prompt: everything its provider counted going in. @param {any} t */
export const promptOf = (t) => (Number(t?.input) || 0) + (Number(t?.cacheRead) || 0) + (Number(t?.cacheWrite) || 0);

/**
 * Whether a usage's reader was given any of its cache fields: one left out says nothing, one that says 0 says the
 * cache was counted and held none of the prompt.
 * @param {...unknown} fields
 */
export const saysCache = (...fields) => fields.some((v) => v != null);

/**
 * The prompt tokens of a usage whose cache numbers were said: all of one call's where its usage carried them
 * (`cacheSeen: true`); a sum's count of them, never more than its prompt; and of a usage kept before either was
 * written, all of it where it read or wrote any — its figures are the only word on it.
 * @param {any} t  `{ input, cacheRead, cacheWrite, cacheSeen? }`
 */
export function seenPrompt(t) {
  const all = promptOf(t);
  if (t?.cacheSeen === true) return all;
  if (typeof t?.cacheSeen === "number") return Math.max(0, Math.min(all, t.cacheSeen));
  return Number(t?.cacheRead) > 0 || Number(t?.cacheWrite) > 0 ? all : 0;
}

/** Whether a usage said its cache numbers, for any of its prompt. @param {any} t */
export const cacheSaid = (t) => seenPrompt(t) > 0;

/** Whether a request read from its provider's cache or wrote to it: the cache's life runs from one that did. @param {any} t */
export const cacheTouched = (t) => Number(t?.cacheRead) > 0 || Number(t?.cacheWrite) > 0;

/**
 * The share of a prompt read from the cache, 0..1, of the tokens whose cache numbers were said; null where none were.
 * @param {any} t
 */
export function hitOf(t) {
  const seen = seenPrompt(t);
  return seen > 0 ? Math.min(1, (Number(t.cacheRead) || 0) / seen) : null;
}

/**
 * The share of a request's prompt the cache holds once it has run: what it read plus what it wrote — a cold start
 * reads nothing and writes the prefix, and the next request reads what it wrote. Null where no cache numbers were said.
 * @param {any} t
 */
export function carriedOf(t) {
  const seen = seenPrompt(t);
  return seen > 0 ? Math.min(1, ((Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0)) / seen) : null;
}

/**
 * A sum's count of the prompt tokens whose cache numbers were said (`cacheSeen`), with one more usage added: what the
 * sum held before any count was kept is counted by its figures, once.
 * @param {any} sum  the sum so far, `{ input, cacheRead, cacheWrite, cacheSeen? }` @param {any} t  the usage added
 */
export const seenWith = (sum, t) => seenPrompt(sum) + seenPrompt(t);
