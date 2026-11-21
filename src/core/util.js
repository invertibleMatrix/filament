// @ts-check
// Small pure helpers with no better home.

/** `n` forced into [lo, hi]; anything that is not a number counts as 0. @param {unknown} n @param {number} lo @param {number} hi */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));

/** A version: dotted numbers, maybe a pre-release after them (`1.2.0`, `0.76.0-beta.1`). */
const VERSION = /^(\d+(?:\.\d+)*)(-.+)?$/;
/**
 * Whether version `a` is newer than `b` (HarnessV3-ACP AF3): their dotted numbers compared in turn, then a release is
 * newer than its pre-release (`1.2.0-beta.1`). Anything that isn't a version is never newer.
 * @param {string | null | undefined} a @param {string | null | undefined} b
 */
export function newerVersion(a, b) {
  const x = VERSION.exec(String(a));
  const y = VERSION.exec(String(b));
  if (!x || !y) return false;
  const xs = x[1].split(".").map(Number);
  const ys = y[1].split(".").map(Number);
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const d = (xs[i] || 0) - (ys[i] || 0);
    if (d) return d > 0;
  }
  return !x[2] && !!y[2];
}
/**
 * Whether version `v` is `from` or a later one (HarnessV3-ACP AC-R2). Where either isn't a version, it is not.
 * @param {string | null | undefined} v @param {string | null | undefined} from
 */
export const versionFrom = (v, from) => VERSION.test(String(v)) && VERSION.test(String(from)) && !newerVersion(from, v);

