// @ts-check
// The cache-churn watch. A prompt cache only pays when a request's prefix matches what the provider cached before;
// whatever re-materializes nearly the whole conversation on every request — cache writes at 1.25× input price, or
// whole prefixes at full input — is how one long session on an expensive model quietly ran up a three-digit bill
// (2026-09-27: 99 requests, 17.3M tokens re-written, $128). The provider's own columns say it plainly: the cache
// read pinned at a small floor while write (or input) covers most of the prefix, leg after leg. `churnLegOf`
// classifies one finished record (pure, one owner of the rule); `createCacheChurnWatch` keeps the last few legs per session and says it when the pattern holds — a
// note on the very request that crossed the line, and an alert for the dashboard banner. A session's first big write
// is a cold start (any new endpoint or strategy pays it once) and never counts.
import { billedByChildren } from "../core/turn-facts.js";
import { cacheSaid } from "../core/cache-facts.js";

/** The rules as constants, not knobs: they encode "a bill, not noise" and are not worth a settings row. */
export const CHURN_RULES = Object.freeze({
  legs: 4, // how many finished legs the window holds
  needed: 3, // how many of them must have churned
  share: 0.6, // a leg churned when write + input covers this share of its prompt
  minPrefix: 20_000, // a smaller prompt churns for pennies; the alarm is for bills
  minRewritten: 200_000, // and the churned legs together must have re-written at least this
  cooldownMs: 10 * 60_000, // one verdict per session per window; the next needs a fresh run of legs
});

/**
 * One finished request's cache shape, or null when it says nothing (not a model call on a session, no tokens, a usage
 * that said no cache numbers — nothing says its prompt was written again —, or a prompt too small to be worth anyone's
 * attention). A parent whose children bill (an agent turn — its tokens are the client-facing mirror) stays out: its
 * ticks are the records that really hit the provider.
 * @param {any} rec a finished request record
 * @returns {{ chain: string, read: number, write: number, input: number, prefix: number, rewritten: number, churned: boolean } | null}
 */
export function churnLegOf(rec) {
  const t = rec?.tokens;
  if (!t || rec.memoryFor || rec.local || rec.memory?.command || billedByChildren(rec)) return null;
  const chain = rec.memory?.chain;
  if (!chain || rec.status !== "ok" || !cacheSaid(t)) return null;
  const read = Number(t.cacheRead) || 0;
  const write = Number(t.cacheWrite) || 0;
  const input = Number(t.input) || 0;
  const prefix = read + write + input;
  if (prefix < CHURN_RULES.minPrefix) return null;
  const rewritten = write + input;
  return { chain, read, write, input, prefix, rewritten, churned: rewritten >= CHURN_RULES.share * prefix };
}

/**
 * Whether a window of legs says churn, and the numbers to say it with. Pure. `legs` is oldest-first, the cold start
 * already left out by the caller. Null when the pattern does not hold.
 * @param {{ churned: boolean, rewritten: number }[]} legs
 * @param {typeof CHURN_RULES} [rules]
 * @returns {{ legs: number, avg: number, rewritten: number } | null}
 */
export function churnVerdict(legs, rules = CHURN_RULES) {
  const last = legs.slice(-rules.legs);
  if (last.length < rules.legs) return null;
  const churned = last.filter((l) => l.churned);
  if (churned.length < rules.needed) return null;
  const rewritten = churned.reduce((n, l) => n + l.rewritten, 0);
  if (rewritten < rules.minRewritten) return null;
  return { legs: churned.length, avg: Math.round(rewritten / churned.length), rewritten };
}

/** The note a triggering record carries: what happened and the ways out. @param {{ legs: number, avg: number, rewritten: number }} v */
export const churnNote = (v) =>
  `cache: ${v.legs} of the last ${CHURN_RULES.legs} requests re-cached ~${v.avg.toLocaleString("en-US")} tokens each (≈${(v.rewritten / 1e6).toFixed(1)}M rewritten) — the client resends a changing history, so the prompt cache never holds. A cheaper model caps the cost.`;

/**
 * The stateful half: feed it finished records (the records store calls it inside `finish`, before the record
 * persists, so the returned note rides the triggering request). One watch per server; per-session windows inside.
 * @param {{ onAlert?: (kind: string, text: string, key: string) => void, now?: () => number }} [o]
 */
export function createCacheChurnWatch({ onAlert = () => {}, now = () => Date.now() } = {}) {
  /** @type {Map<string, { legs: any[], cold: boolean, firedAt: number }>} */
  const byChain = new Map();
  // A long-lived proxy meets unbounded chains; the map is re-set on every leg (Map order = access order), so
  // dropping the oldest keys past the cap keeps memory flat and forgets only sessions long gone.
  const CHAIN_CAP = 2_048;
  return {
    /** @param {any} rec @returns {string | null} the note for this record, when it crossed the line */
    note(rec) {
      const leg = churnLegOf(rec);
      if (!leg) return null;
      const st = byChain.get(leg.chain) || { legs: [], cold: true, firedAt: 0 };
      byChain.delete(leg.chain);
      byChain.set(leg.chain, st);
      if (byChain.size > CHAIN_CAP) {
        const oldest = byChain.keys().next().value;
        if (oldest !== undefined) byChain.delete(oldest);
      }
      if (st.cold) {
        // The first big write a session pays (a new endpoint, a new strategy, a restart) is a cold start, not churn.
        st.cold = false;
        return null;
      }
      st.legs.push(leg);
      if (st.legs.length > CHURN_RULES.legs) st.legs.shift();
      const v = churnVerdict(st.legs);
      if (!v || now() - st.firedAt < CHURN_RULES.cooldownMs) return null;
      st.firedAt = now();
      st.legs = []; // re-armed: the next verdict needs a fresh run of legs, not the same four
      // The key carries the episode (firedAt): the banner dedupes a key forever, and a session that churns AGAIN
      // after the cooldown must be re-announced, not silently swallowed by the first episode's key.
      onAlert("cache", churnNote(v), `cache-churn:${leg.chain}:${st.firedAt}`);
      return churnNote(v);
    },
  };
}
