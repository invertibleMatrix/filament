// Upstream health board and candidate ordering: cooldowns after failures, latency/cost/quota-aware selection,
// and the state the dashboard shows as "healthy / cooling down / rate limited".
import { estimateCost } from "../core/pricing.js";
import { OUT_HOLD_MS } from "../core/provider-cause.js";

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
/** How long a ceiling learned from a 429 holds: ten minutes after the last 429 that taught it (HarnessV3-AtHome AH-F5). */
export const LEARNED_CEILING_MS = 600_000;
/**
 * The longest a ceiling holds: each refusal at the same number again doubles its hold, to an hour at most (the owner's
 * word of 10-23: Z.ai refused the 8th GLM-5.3 Flash call every ten minutes, each time the ceiling of 7 lifted to 40).
 */
export const LEARNED_HOLD_MOST_MS = 3_600_000;
/** How long a ceiling confirmed by two refusals is kept with none since: a day, then the number set rules again. */
export const LEARNED_KEPT_MS = 86_400_000;

/**
 * The ceiling a provider showed for one of its models, and where it came from: a 429's on that model — when it was
 * learned and when it next changes — or the requests limit the provider's rate-limit headers state. A 429's that the
 * provider confirmed, refusing the same number again (`times` refusals in a row since `since`), says how many the
 * provider takes (`takes`) and whether one more is being tried (`probing`, its `cap` above `takes`).
 * @typedef {{ cap: number, from: "429", at: number, liftsAt: number, takes?: number, times?: number, since?: number, probing?: boolean }
 *   | { cap: number, from: "headers" }} ObservedCeiling
 */
/**
 * What a 429 taught a model: the number the provider took (`cap`, one fewer than were in flight when it refused), the
 * newest such refusal (`at`), how long the number holds after it (`hold`), and how many refusals in a row taught that
 * same number (`times`, the first at `since`).
 * @typedef {{ cap: number, at: number, hold: number, times: number, since: number }} Learned
 */

export class HealthBoard {
  constructor({ cooldownBaseMs = 10_000, cooldownMaxMs = 300_000 } = {}) {
    this.cooldownBaseMs = cooldownBaseMs;
    this.cooldownMaxMs = cooldownMaxMs;
    this.state = new Map(); // upstream id -> { failures, cooldownUntil, lastError, lastOkAt, ttftEma, totalEma, rateLimit, quota, learned, wall }
    this.rr = new Map(); // route match -> round-robin counter
  }
  configure({ cooldownBaseMs, cooldownMaxMs }) {
    if (cooldownBaseMs) this.cooldownBaseMs = cooldownBaseMs;
    if (cooldownMaxMs) this.cooldownMaxMs = cooldownMaxMs;
  }
  #s(id) {
    let s = this.state.get(id);
    if (!s) {
      s = {
        failures: 0,
        cooldownUntil: 0,
        lastError: null,
        lastOkAt: null,
        ttftEma: null,
        totalEma: null,
        rateLimit: null,
        quota: null,
        learned: new Map(), // model -> Learned: the ceiling a 429 on that model taught
        wall: null, // the provider said it cannot serve this account (TG2-D54): core/provider-cause.js's Wall
      };
      this.state.set(id, s);
    }
    return s;
  }

  available(id, now = Date.now()) {
    const s = this.state.get(id);
    return !s || s.cooldownUntil <= now;
  }
  cooldownLeftMs(id, now = Date.now()) {
    const s = this.state.get(id);
    return s && s.cooldownUntil > now ? s.cooldownUntil - now : 0;
  }

  recordSuccess(id, { ttftMs, totalMs } = {}) {
    const s = this.#s(id);
    s.failures = 0;
    s.cooldownUntil = 0;
    s.lastOkAt = Date.now();
    // A call that succeeded there says it serves again, whatever it said before (TG2-D54).
    s.wall = null;
    if (s.retryAfter != null) s.retryAfter = null;
    const ema = (old, v) => (v == null ? old : old == null ? v : Math.round(old * 0.7 + v * 0.3));
    s.ttftEma = ema(s.ttftEma, ttftMs);
    s.totalEma = ema(s.totalEma, totalMs);
  }
  // Only failures that look like the upstream's fault (rate limits, 5xx, unreachable, stalled) earn a cooldown.
  recordFailure(id, { status, message, retryable } = {}) {
    const s = this.#s(id);
    s.lastError = {
      at: new Date().toISOString(),
      status: status || null,
      message: String(message || "").slice(0, 200),
    };
    const isRetryable = retryable ?? (status == null || RETRYABLE.has(status));
    if (!isRetryable) return { cooledDown: false };
    s.failures++;
    const wait = Math.min(this.cooldownMaxMs, this.cooldownBaseMs * 2 ** Math.max(0, s.failures - 1));
    s.cooldownUntil = Date.now() + wait;
    return { cooledDown: true, waitMs: wait, failures: s.failures };
  }
  recordMeta(id, meta) {
    if (!meta) return;
    const s = this.#s(id);
    const rl = {};
    const num = (k) => {
      const v = meta[k];
      return v == null ? null : Number(v);
    };
    const reqLeft = num("anthropic-ratelimit-requests-remaining") ?? num("x-ratelimit-remaining-requests");
    const tokLeft =
      num("anthropic-ratelimit-tokens-remaining") ??
      num("x-ratelimit-remaining-tokens") ??
      num("anthropic-ratelimit-input-tokens-remaining");
    const reqLimit = num("anthropic-ratelimit-requests-limit") ?? num("x-ratelimit-limit-requests");
    const tokLimit =
      num("anthropic-ratelimit-tokens-limit") ??
      num("x-ratelimit-limit-tokens") ??
      num("anthropic-ratelimit-input-tokens-limit");
    const reset =
      meta["anthropic-ratelimit-requests-reset"] ||
      meta["anthropic-ratelimit-tokens-reset"] ||
      meta["x-ratelimit-reset-requests"] ||
      null;
    if (reqLeft != null || tokLeft != null) {
      rl.requestsRemaining = reqLeft;
      rl.tokensRemaining = tokLeft;
      rl.requestsLimit = reqLimit;
      rl.tokensLimit = tokLimit;
      rl.resetAt = reset;
      rl.at = Date.now();
      s.rateLimit = rl;
    }
    if (meta["retry-after"] != null) {
      const n = Number(meta["retry-after"]);
      if (Number.isFinite(n)) s.retryAfter = n;
    } else if (s.retryAfter != null) s.retryAfter = null; // a later success/meta without Retry-After clears a stale wait
  }
  /**
   * What a 429 taught one model's lane, as it stands now. Its number holds for its hold after the newest refusal. Then
   * one the provider refused only once lifts, and is remembered for as long again, so a refusal at the same number
   * confirms it; one it confirmed is tried one higher, and one more each hold that passes with no refusal (`probing`),
   * until a day passed with none. `cap` null: remembered, cutting nothing. Null once forgotten.
   * @param {any} s @param {string} model @param {number} now
   * @returns {{ e: Learned, cap: number | null, liftsAt: number | null, probing: boolean } | null}
   */
  #learned(s, model, now) {
    const k = String(model);
    /** @type {Learned | undefined} */
    const e = s.learned.get(k);
    if (!e) return null;
    const lifts = e.at + e.hold;
    if (now < lifts) return { e, cap: e.cap, liftsAt: lifts, probing: false };
    if (e.times >= 2 && now < e.at + LEARNED_KEPT_MS) {
      const step = Math.floor((now - lifts) / e.hold);
      return { e, cap: e.cap + 1 + step, liftsAt: lifts + (step + 1) * e.hold, probing: true };
    }
    if (e.times < 2 && now < lifts + e.hold) return { e, cap: null, liftsAt: null, probing: false };
    s.learned.delete(k);
    return null;
  }
  /**
   * A learned ceiling as it is said: the plain one a single refusal taught, or, once the provider confirmed it, how
   * many it takes, how often it refused one more, since when, and whether one more is being tried.
   * @param {{ e: Learned, cap: number | null, liftsAt: number | null, probing: boolean }} l @returns {ObservedCeiling}
   */
  static #said(l) {
    const plain = { cap: /** @type {number} */ (l.cap), from: /** @type {const} */ ("429"), at: l.e.at, liftsAt: /** @type {number} */ (l.liftsAt) };
    return l.e.times >= 2 ? { ...plain, takes: l.e.cap, times: l.e.times, since: l.e.since, probing: l.probing } : plain;
  }
  /**
   * The ceiling the provider showed for a model (W7), or null: a 429's on that model while it holds, and the requests
   * limit its rate-limit headers state — the lower when both, said with where it came from (HarnessV3-AtHome AH-F5).
   * It is the only ceiling a lane holds to (dispatch/attempt.js). A 429's is the model's own, as its lane is
   * (HarnessV4_Tasks E15, AG-261): a pool that runs two
   * models of one provider reads each row's alone.
   * @param {string} id @param {string} model @param {number} [now]
   * @returns {ObservedCeiling | null}
   */
  observedCeiling(id, model, now = Date.now()) {
    const s = this.state.get(id);
    if (!s) return null;
    const fromHeader = s.rateLimit?.requestsLimit;
    const header = fromHeader != null && Number.isFinite(fromHeader) && fromHeader > 0 ? Math.floor(fromHeader) : null;
    const l = this.#learned(s, model, now);
    if (l && l.cap != null && (header == null || l.cap <= header)) return HealthBoard.#said(l);
    return header != null ? { cap: header, from: "headers" } : null;
  }
  /**
   * The ceiling a 429 taught for a model while it holds, or null: what an agent's slot holds to. The requests limit
   * the headers state counts requests a minute, no agents at once (the review of 11-05), so only a call's lane reads
   * it (observedCeiling).
   * @param {string} id @param {string} model @param {number} [now]
   * @returns {ObservedCeiling | null}
   */
  learnedCeiling(id, model, now = Date.now()) {
    const s = this.state.get(id);
    // Kept under the name as sent; asked for by a row's, in any case — of holds under two spellings, the lowest that
    // holds (the review of 11-05).
    const low = String(model).toLowerCase();
    /** @type {{ e: Learned, cap: number | null, liftsAt: number | null, probing: boolean } | null} */
    let l = null;
    for (const k of s ? [...s.learned.keys()].filter((x) => String(x).toLowerCase() === low) : []) {
      const h = this.#learned(/** @type {any} */ (s), k, now);
      if (h && h.cap != null && (!l || /** @type {number} */ (h.cap) < /** @type {number} */ (l.cap))) l = h;
    }
    return l ? HealthBoard.#said(l) : null;
  }
  /**
   * A 429 about this account's rate, on one model — an overloaded provider's teaches nothing (dispatch/verdict.js).
   * `inflight` calls of that model were running at the provider, the refused one among them, so the model takes one
   * fewer: at most N-1, at least 1. A ceiling that still holds only goes lower, and each such 429 holds it its hold
   * again (HarnessV3-AtHome AH-F5). A refusal at the same number it learned before — after its lift, or at the one
   * more tried — confirms it: its hold doubles, to an hour at most, and after it one more is tried rather than the
   * number set (the owner's word of 10-23). Another number is learned anew. Another model's calls there are not
   * counted and its lane is not capped: counted across the provider and held against each model, the number could
   * not go down while two models shared the load (AG-261).
   * @param {string} id @param {string} model @param {number} inflight @param {number} [now]
   * @returns {number} the model's ceiling now
   */
  note429(id, model, inflight, now = Date.now()) {
    const s = this.#s(id);
    const n = Number.isFinite(inflight) && inflight >= 1 ? Math.floor(inflight) : 1;
    const cap = n > 1 ? n - 1 : 1;
    const was = this.#learned(s, model, now);
    const e = was?.e || null;
    const held = !!was && was.cap != null && !was.probing;
    /** @type {Learned} */
    const next =
      e && cap === e.cap
        ? { cap, at: now, hold: Math.min(e.hold * 2, LEARNED_HOLD_MOST_MS), times: e.times + 1, since: e.since }
        : e && held && cap > e.cap
          ? { ...e, at: now }
          : { cap, at: now, hold: LEARNED_CEILING_MS, times: 1, since: now };
    s.learned.set(String(model), next);
    return next.cap;
  }
  recordQuota(id, quota) {
    this.#s(id).quota = { ...quota, at: Date.now() };
  }
  /**
   * The provider said it cannot serve this account (HarnessV3-TaskGraph-v2 TG2-D54): its allowance is spent (`out`) or
   * it refuses the account or its key (`account`). Held, with its words, since now: an out until its reset where it
   * said one Filament could read, else for `OUT_HOLD_MS`; an account until it is fixed. A success there, Reset, a
   * change of the upstream and, for a coding agent, its sign-in or its window's new period lift it.
   * @param {string} id
   * @param {{ kind: "out" | "account", said?: string | null, status?: number | null, resets?: number | null, as?: import("../core/agent-limits.js").Identity | null }} w
   *   `as`: for a coding agent, whom it said it runs as now — its sign-in lifts an account only where it says another
   * @param {number} [now]
   * @returns {import("../core/provider-cause.js").Wall}
   */
  noteWall(id, { kind, said = "", status = null, resets = null, as = null }, now = Date.now()) {
    const s = this.#s(id);
    const reset = resets != null && resets > now ? resets : null;
    s.wall = { kind, said: String(said || "").replace(/\s+/g, " ").trim().slice(0, 300), status: status ?? null, at: now, until: kind === "out" ? reset ?? now + OUT_HOLD_MS : null, reset, as: as ?? null };
    return s.wall;
  }
  /**
   * The provider's wall while it holds: null for none, and once an out's time is up.
   * @param {string} id @param {number} [now] @returns {import("../core/provider-cause.js").Wall | null}
   */
  wallOf(id, now = Date.now()) {
    const s = this.state.get(id);
    const w = s?.wall;
    if (!w) return null;
    if (w.until != null && w.until <= now) {
      s.wall = null;
      return null;
    }
    return w;
  }
  /** It serves again, as a fix of the developer's or its agent's own report says (TG2-D54): the wall goes. @param {string} id @param {"out" | "account"} [kind]  only a wall of this kind */
  liftWall(id, kind) {
    const s = this.state.get(id);
    if (s?.wall && (!kind || s.wall.kind === kind)) s.wall = null;
  }
  reset(id) {
    const s = this.#s(id);
    s.failures = 0;
    s.cooldownUntil = 0;
    s.learned.clear();
    s.retryAfter = null;
    s.wall = null;
  }

  /**
   * Every upstream's state for the health table. `ceilings`: each model's learned ceiling while it cuts, with how long
   * until it next changes, in the order they were first learned — one the provider confirmed with how often it refused
   * (`times`) and whether one more is being tried (`probing`). @param {number} [now]
   */
  snapshot(now = Date.now()) {
    const out = {};
    for (const [id, s] of this.state) {
      const { learned, wall: _held, ...rest } = s;
      const wall = this.wallOf(id, now);
      out[id] = {
        ...rest,
        // A provider that cannot serve this account (TG2-D54), while it holds, with how long it still does (null: until fixed).
        wall: wall ? { ...wall, leftMs: wall.until != null ? wall.until - now : null } : null,
        ceilings: [...learned.keys()].flatMap((model) => {
          const l = this.#learned(s, model, now);
          if (!l || l.cap == null || l.liftsAt == null) return [];
          return [{ model, cap: l.cap, liftsInMs: l.liftsAt - now, ...(l.e.times >= 2 ? { times: l.e.times, probing: l.probing } : {}) }];
        }),
        coolingDown: s.cooldownUntil > now,
        cooldownLeftMs: Math.max(0, s.cooldownUntil - now),
        rateLimitedSoon: !!(
          s.rateLimit &&
          ((s.rateLimit.requestsRemaining != null && s.rateLimit.requestsRemaining <= 2) ||
            (s.rateLimit.tokensRemaining != null &&
              s.rateLimit.tokensLimit &&
              s.rateLimit.tokensRemaining / s.rateLimit.tokensLimit < 0.05))
        ),
        quotaExceeded: !!s.quota?.exceeded,
      };
    }
    return out;
  }

  // Order candidates for one request. Cooled-down and quota-exceeded upstreams go last but are still tried, and so does
  // one that said it cannot serve this account while that holds (TG2-D54).
  order(candidates, { strategy = "in_order", routeKey = "", cfg, modelFor } = {}) {
    const now = Date.now();
    const ready = [],
      parked = [];
    for (const c of candidates) {
      const s = this.state.get(c.upstream);
      const blocked = (s && s.cooldownUntil > now) || (strategy === "quota_aware" && s?.quota?.exceeded) || !!this.wallOf(c.upstream, now);
      (blocked ? parked : ready).push(c);
    }
    let ordered = ready;
    switch (strategy) {
      case "random": {
        ordered = [...ready];
        for (let i = ordered.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        }
        break;
      } // Fisher-Yates: sort() with a random comparator is biased
      case "round_robin": {
        const n = this.rr.get(routeKey) || 0;
        this.rr.set(routeKey, n + 1);
        if (ready.length) ordered = ready.map((_, i) => ready[(i + n) % ready.length]);
        break;
      }
      case "least_latency": {
        const lat = (c) => {
          const s = this.state.get(c.upstream);
          return s?.ttftEma ?? 2500;
        };
        ordered = [...ready].sort((a, b) => lat(a) - lat(b));
        break;
      }
      case "least_cost": {
        const cost = (c) => {
          const m = modelFor ? modelFor(c) : c.upstreamModel;
          const p = estimateCost(
            m,
            { input: 1000, output: 1000 },
            (cfg?.upstreams || []).find((u) => u.id === c.upstream)?.pricing || null,
          );
          return p == null ? Number.POSITIVE_INFINITY : p;
        };
        ordered = [...ready].sort((a, b) => cost(a) - cost(b));
        break;
      }
      case "quota_aware": {
        const score = (c) => {
          const s = this.state.get(c.upstream);
          if (!s) return 0;
          let n = 0;
          if (s.rateLimit) {
            if (s.rateLimit.requestsRemaining != null && s.rateLimit.requestsRemaining <= 2) n += 2;
            if (
              s.rateLimit.tokensRemaining != null &&
              s.rateLimit.tokensLimit &&
              s.rateLimit.tokensRemaining / s.rateLimit.tokensLimit < 0.05
            )
              n += 2;
          }
          if (s.quota?.usagePercent >= 0.95) n += 1;
          return n;
        };
        ordered = [...ready].sort((a, b) => score(a) - score(b));
        break;
      }
      default:
        break; // in_order
    }
    return { ordered: [...ordered, ...parked], parked: parked.map((c) => c.upstream) };
  }
}

export const isRetryableStatus = (status) => RETRYABLE.has(status);

/**
 * A lane's ceiling now — null for none — and when it lifts by itself (null: it does not).
 * @typedef {() => { cap: number | null, liftsAt: number | null }} LaneCeiling
 */
/** @typedef {{ id: string, what: string }} SlotHolder  a call holding a slot: its record, and what it is in words */
/** @typedef {{ release: () => void, waitedMs: number, queued: boolean }} Slot */

// Per-model lanes of the calls in flight (W7; HarnessV3-AtHome AH-F5). Every call through the front door holds its
// lane while it runs, capped or not: a ceiling counts the calls really in flight, and a call that waits can say what
// holds the slots. Under a ceiling the lane runs at most that many and the rest wait — background calls (a
// sub-agent's rounds and forks) behind the others, each first come first served. The ceiling is asked again whenever
// a slot frees and when it says it lifts, so a learned ceiling that lifts lets its waiters go. A wait has no deadline
// (HarnessV3-FailurePoints §4 A): aborting the wait signal drops a waiter without taking a slot, and a call whose signal
// has already ended takes none, its lane free or full. Key is `${upstreamId}\0${model}` so the same model at two
// providers is two lanes.
export class ConcurrencyGate {
  constructor() {
    this.lanes = new Map();
  }
  #lane(key) {
    let L = this.lanes.get(key);
    if (!L) {
      L = { inflight: 0, holders: new Map(), wait: [], timer: null };
      this.lanes.set(key, L);
    }
    return L;
  }
  /**
   * The calls in flight at an upstream: one model's, which is what a 429 on it counts, or every model's.
   * @param {string} upstreamId @param {string} [model]
   */
  inflightAt(upstreamId, model) {
    if (model != null) return this.lanes.get(`${upstreamId}\0${model}`)?.inflight ?? 0;
    let n = 0;
    for (const [k, L] of this.lanes) if (k.startsWith(`${upstreamId}\0`)) n += L.inflight;
    return n;
  }
  /** What holds a lane's slots, in the order the calls took them. @param {string} upstreamId @param {string} model @returns {SlotHolder[]} */
  holdersOf(upstreamId, model) {
    const L = this.lanes.get(`${upstreamId}\0${model || ""}`);
    return L ? [...L.holders.values()].filter(Boolean) : [];
  }
  /**
   * A slot in the lane of `model` at `upstreamId`, taken at once when the lane has room and nobody waits ahead,
   * else waited for; none for a call whose signal has already ended. `onQueued` hears what holds the slots when the call
   * starts to wait.
   * @param {string} upstreamId @param {string} model @param {LaneCeiling} ceiling
   * @param {{ signal?: AbortSignal | null, background?: boolean, holder?: SlotHolder | null, onQueued?: ((holders: SlotHolder[]) => void) | null }} [o]
   * @returns {Slot | Promise<Slot>}
   */
  acquire(upstreamId, model, ceiling, { signal = null, background = false, holder = null, onQueued = null } = {}) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("aborted before it took a concurrency slot"), { name: "AbortError" }));
    const key = `${upstreamId}\0${model || ""}`;
    const L = this.#lane(key);
    const take = () => {
      const held = {};
      L.inflight++;
      L.holders.set(held, holder);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        L.inflight = Math.max(0, L.inflight - 1);
        L.holders.delete(held);
        this.#pump(L);
      };
    };
    this.#pump(L); // a ceiling that lifted a moment ago lets its waiters go first
    if (!L.wait.length && fits(L, ceiling())) return { release: take(), waitedMs: 0, queued: false };
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const waiter = { background, ceiling, go: () => {}, onAbort: () => {} };
      const fail = (/** @type {Error} */ why) => {
        signal?.removeEventListener("abort", waiter.onAbort);
        const i = L.wait.indexOf(waiter);
        if (i >= 0) L.wait.splice(i, 1);
        reject(why);
      };
      waiter.onAbort = () => fail(Object.assign(new Error("aborted while waiting for a concurrency slot"), { name: "AbortError" }));
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      waiter.go = () => {
        signal?.removeEventListener("abort", waiter.onAbort);
        resolve({ release: take(), waitedMs: Date.now() - t0, queued: true });
      };
      L.wait.push(waiter);
      onQueued?.([...L.holders.values()].filter(Boolean));
      this.#pump(L); // with a waiter, the lane looks again when its ceiling says it lifts
    });
  }
  /**
   * Hand freed slots to the waiters: the next foreground one first, else the next background one, while the lane's
   * ceiling has room. When it has none and says when it lifts, the lane looks again then.
   */
  #pump(L) {
    if (L.timer) clearTimeout(L.timer);
    L.timer = null;
    while (L.wait.length) {
      const i = L.wait.findIndex((w) => !w.background);
      const next = L.wait[i >= 0 ? i : 0];
      const c = next.ceiling();
      if (!fits(L, c)) {
        if (c.liftsAt != null) {
          L.timer = setTimeout(() => this.#pump(L), Math.max(0, c.liftsAt - Date.now()));
          L.timer.unref?.();
        }
        return;
      }
      L.wait.splice(L.wait.indexOf(next), 1);
      next.go();
    }
  }
}

/** Whether a lane has room under a ceiling: none set, or fewer calls in flight than it allows. */
function fits(L, { cap }) {
  return !(Number(cap) > 0) || L.inflight < Math.floor(Number(cap));
}

// W8 D1: an AbortError whose origin is NOT the client's hang-up was recorded as a retryable 502 and cooled down a
// healthy upstream. Classify here, once, so every catch agrees. AbortSignal.timeout rejects with an abort-shaped error
// too ("The operation was aborted due to timeout"): a deadline of Filament's own (a probe's) is no hang-up.
export function isAbortError(e) {
  if (!e) return false;
  if (e.name === "TimeoutError" || e.cause?.name === "TimeoutError") return false;
  return (
    e.name === "AbortError" ||
    e.code === "ABORT_ERR" ||
    /operation was aborted/i.test(String(e.message || ""))
  );
}
export function requestWasAborted(e, clientAbort) {
  return !!clientAbort?.signal?.aborted || isAbortError(e);
}
