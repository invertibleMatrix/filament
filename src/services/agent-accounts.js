// @ts-check
// Each coding agent's account and how much of its plan is left (HarnessV3-ACP AC3-6), as the agent itself said it
// (AC-D15): who it runs as, its plan's windows with their last readings, its extra usage or credits, and when and from
// where each came. Kept per upstream in agent-accounts.json, so a restart, or a page opened later, still says who ran
// and as of when. The bridges feed it (`report`, through their `onAccount`, wired at the composition root), and so do
// an agent's CLI and its turns where the agent doesn't say who it runs as itself (app/agent-logins.js); the admin routes
// read it out with each window's state, its pace, the fullest one, and when a spent plan is free again.
// Nothing here guesses: what an agent didn't say stays unsaid.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAgentUpstream } from "../core/schema.js";
import { mergeWindows, SAME_PERIOD_MS, sameIdentity } from "../core/agent-limits.js";

/** @typedef {import("../core/agent-limits.js").Identity} Identity */
/** @typedef {import("../core/agent-limits.js").PlanWindow} PlanWindow */
/** @typedef {import("../core/agent-limits.js").ExtraUsage} ExtraUsage */
/** @typedef {import("../core/agent-limits.js").Credits} Credits */
/** @typedef {import("../core/agent-limits.js").ResetCredits} ResetCredits */
/** @typedef {import("../core/agent-limits.js").AccountReport} AccountReport */

/** How many readings a window keeps, for its pace. */
const READINGS = 6;
/** From this share a window warns (AC-D17's amber); at 100 it is spent. */
const WARN_PERCENT = 80;

/**
 * A window as kept: the agent's, when and from where it was last heard, and its readings in order.
 * @typedef {PlanWindow & { at: number, source: string, readings: { at: number, usedPercent: number, resetsAt: number | null }[] }} KeptWindow
 */

/**
 * An upstream's account as kept, and when the agent last said anything of it.
 * @typedef {{ identity: Identity | null, identityAt: number | null, identitySource: string | null,
 *   windows: KeptWindow[], extra: ExtraUsage | null, credits: Credits | null, resetCredits: ResetCredits | null,
 *   reached: string | null, noWindows: string | null, at: number }} KeptAccount
 */

/**
 * A window's state now: `reset` once its reset time has passed (its reading is of a period that ended), `spent` at
 * 100 % or at the agent's refusal, `warning` from 80 % or at the agent's warning, else `ok`.
 * @param {PlanWindow} w @param {number} now
 * @returns {"ok" | "warning" | "spent" | "reset"}
 */
function windowState(w, now) {
  if (w.resetsAt != null && w.resetsAt <= now) return "reset";
  if (w.status === "rejected" || (w.usedPercent ?? 0) >= 100) return "spent";
  if (w.status === "warning" || (w.usedPercent ?? 0) >= WARN_PERCENT) return "warning";
  return "ok";
}

/**
 * When a window runs out at the pace its readings in this period show, or null: the first and the newest reading of
 * the period, rising, a minute or more apart, and an end that comes before the reset (≈ on the page). A window spent
 * or reset has no pace.
 * @param {KeptWindow} w @param {number} now
 * @returns {number | null}
 */
function paceOf(w, now) {
  const state = windowState(w, now);
  if (state === "spent" || state === "reset" || w.usedPercent == null) return null;
  const period = w.readings.filter((r) => (r.resetsAt == null && w.resetsAt == null) || (r.resetsAt != null && w.resetsAt != null && Math.abs(r.resetsAt - w.resetsAt) <= SAME_PERIOD_MS));
  if (period.length < 2) return null;
  const first = period[0];
  const last = period[period.length - 1];
  const rise = last.usedPercent - first.usedPercent;
  const span = last.at - first.at;
  if (rise <= 0 || span < 60_000) return null;
  const end = Math.round(last.at + ((100 - last.usedPercent) / rise) * span);
  return end > now && (w.resetsAt == null || end < w.resetsAt) ? end : null;
}

/** The order of concern: a spent window first, then one that warns, then the rest. */
const RANK = /** @type {Record<string, number>} */ ({ spent: 3, warning: 2, ok: 1, reset: 0 });

/**
 * Whether a plan's extra usage takes the sends its spent windows refuse: on (in use, or /usage says it can cover sends,
 * and neither says it cannot), not refused or switched off by its own word, under its monthly limit, and its own
 * window (Claude's `overage`) not spent.
 * @param {ExtraUsage | null} x @param {{ id: string }[]} spent
 */
const extraCovers = (x, spent) =>
  !!x && (x.enabled === true || (x.enabled !== false && x.using === true)) && x.status !== "rejected" && !x.off && !(x.limit != null && x.spent != null && x.spent >= x.limit) && !spent.some((w) => w.id === "overage");

/** An account nobody has spoken of yet. @param {number} at @returns {KeptAccount} */
const blank = (at) => ({ identity: null, identityAt: null, identitySource: null, windows: [], extra: null, credits: null, resetCredits: null, reached: null, noWindows: null, at });

/**
 * @param {{ file?: string | null, log?: (level: string, msg: string) => void, now?: () => number }} [o]
 */
export function createAgentAccounts({ file = null, log = () => {}, now = () => Date.now() } = {}) {
  /** @type {Map<string, KeptAccount>} */
  const byUpstream = new Map();
  if (file)
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      for (const [id, a] of Object.entries(j.accounts || {})) byUpstream.set(id, { ...blank(0), .../** @type {KeptAccount} */ (a) });
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `[accounts] could not read ${file} (${e.message}); each agent's account is read again as it reports`);
    }

  /** @type {Set<(upstreamId: string) => void>} */
  const listeners = new Set();
  const save = () => {
    if (!file) return;
    try {
      // Written beside the file, then put in its place: a write cut short leaves every account it held, never torn.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, accounts: Object.fromEntries(byUpstream) }, null, 1));
      renameSync(tmp, file);
    } catch (/** @type {any} */ e) {
      log("warn", `[accounts] could not keep the agents' accounts: ${e.message}`);
    }
  };
  /** @param {string} id */
  const changed = (id) => {
    save();
    for (const fn of listeners)
      try {
        fn(id);
      } catch {
        /* a listener's failure never stops a report */
      }
  };

  /**
   * What an agent said of its account, folded into what is kept. Another identity than the one kept takes the
   * windows, the extra usage and the credits with it: they were the other account's. A report that changes nothing
   * is not written.
   * @param {string} upstreamId @param {AccountReport} r
   */
  const report = (upstreamId, r) => {
    const t = now();
    const was = byUpstream.get(upstreamId);
    const a = was ? structuredClone(was) : blank(t);
    if (r.identity) {
      if (a.identity && !sameIdentity(a.identity, r.identity)) Object.assign(a, { windows: [], extra: null, credits: null, resetCredits: null, reached: null });
      a.identity = r.identity;
      a.identityAt = t;
      a.identitySource = r.source;
    }
    if (r.noWindows !== undefined) a.noWindows = r.noWindows;
    if (r.windows?.length) {
      const heard = new Set(r.windows.map((w) => w.id));
      // A whole reading's windows are the plan's: one it no longer names is gone.
      a.windows = mergeWindows(r.whole ? a.windows.filter((w) => heard.has(w.id)) : a.windows, r.windows).map((w) => {
        const kept = /** @type {KeptWindow | undefined} */ (a.windows.find((k) => k.id === w.id));
        if (!heard.has(w.id)) return /** @type {KeptWindow} */ (w);
        const readings = [...(kept?.readings || [])];
        const lastR = readings[readings.length - 1];
        if (w.usedPercent != null && (!lastR || lastR.usedPercent !== w.usedPercent || lastR.resetsAt !== w.resetsAt))
          readings.push({ at: t, usedPercent: w.usedPercent, resetsAt: w.resetsAt });
        return { ...w, at: t, source: r.source, readings: readings.slice(-READINGS) };
      });
    }
    // Each of Claude's channels says its own part of its extra usage (core/agent-limits.js ExtraUsage): what one says
    // joins what the other said.
    if (r.extra) a.extra = { ...a.extra, ...r.extra };
    if (r.credits) a.credits = r.credits;
    if (r.resetCredits) a.resetCredits = r.resetCredits;
    if (r.reached !== undefined) a.reached = r.reached;
    a.at = t;
    // A report that repeats what is kept (Codex's come beside every token tick) only says it still holds: the ages move
    // on here, and nothing is written or told.
    const same = !!was && JSON.stringify(stripTimes(was)) === JSON.stringify(stripTimes(a));
    byUpstream.set(upstreamId, a);
    if (!same) changed(upstreamId);
  };

  /**
   * Someone is signed in, as nobody said whom (a sign-in that ended well, a turn its agent served, a CLI that says only
   * yes): kept as that — no identity, and where the word came from (`identitySource`) — over an account kept as signed
   * out and where nothing was kept, so a page can say someone is signed in before, or without, the agent saying who.
   * Whoever is kept by name stays, and so does a word already kept that someone is. Anything else kept stays.
   * @param {string} upstreamId @param {string} source
   */
  const signedIn = (upstreamId, source) => {
    const was = byUpstream.get(upstreamId);
    if (was?.identity ? was.identity.kind !== "none" : !!was?.identitySource) return;
    const t = now();
    byUpstream.set(upstreamId, { ...(was || blank(t)), identity: null, identityAt: t, identitySource: source, at: t });
    changed(upstreamId);
  };

  /**
   * Nothing is known of who is signed in: an account kept as signed out, on a word nothing can confirm, is let go of —
   * neither nobody nor someone, until its agent, its CLI or a turn says. Anything else kept stays — save where whoever
   * is kept goes (`whoever`: a key kept in the place of theirs, which nothing has tried): someone signed in, by name or
   * not, is let go of too, and their plan's windows, extra usage and credits with them, as another identity's report
   * takes them.
   * @param {string} upstreamId @param {{ whoever?: boolean }} [o]
   */
  const unknown = (upstreamId, { whoever = false } = {}) => {
    const was = byUpstream.get(upstreamId);
    const someone = !!was && (was.identity ? was.identity.kind !== "none" : !!was.identitySource);
    if (was?.identity?.kind !== "none" && !(whoever && someone)) return;
    const t = now();
    const theirs = someone ? { windows: [], extra: null, credits: null, resetCredits: null, reached: null } : {};
    byUpstream.set(upstreamId, { .../** @type {KeptAccount} */ (was), ...theirs, identity: null, identityAt: t, identitySource: null, at: t });
    changed(upstreamId);
  };

  /**
   * An upstream's account as the page reads it: the identity (signed out where its kind is `none`; none, with where
   * the word came from, where someone is signed in as nobody said whom — `signedIn`), each window with its state and
   * pace, the fullest window's id, whether the plan is spent (a spent window extra usage does not cover,
   * or the agent's word) and when it is free again (every spent window reset; null where one has no reset, or the agent
   * said it stopped without a window to show it), whether extra usage covers its spent windows, the extra usage, the
   * credits, why there are no windows, and the ages. A window that bounds only some models (`models`, Antigravity's
   * groups) spends none of the account: it shows spent, and the others' models still have room.
   * @param {string} upstreamId
   */
  const view = (upstreamId) => {
    const a = byUpstream.get(upstreamId);
    if (!a) return null;
    const t = now();
    const windows = a.windows.map((w) => {
      const { readings, ...rest } = w;
      return { ...rest, state: windowState(w, t), pace: paceOf(w, t) };
    });
    const fullest = windows
      .filter((w) => w.state !== "reset")
      .sort((x, y) => RANK[y.state] - RANK[x.state] || (y.usedPercent ?? 0) - (x.usedPercent ?? 0))[0];
    const spent = windows.filter((w) => w.state === "spent" && !w.models?.length);
    const freeAt = spent.length && spent.every((w) => w.resetsAt != null) ? Math.max(...spent.map((w) => /** @type {number} */ (w.resetsAt))) : null;
    // Codex's word that a rate limit was reached speaks of the period it was heard in: once a window that was running
    // then has reset, the windows say the rest. A workspace out of credits or at its spend limit stays until Codex says
    // otherwise.
    const reached = a.reached === "rate_limit_reached" && a.windows.some((w) => w.resetsAt != null && w.resetsAt > a.at && w.resetsAt <= t) ? null : a.reached;
    // A window spent past which extra usage pays still reads spent; the account has room.
    const covers = spent.length > 0 && extraCovers(a.extra, spent);
    return {
      identity: a.identity,
      signedOut: a.identity?.kind === "none",
      identityAt: a.identityAt,
      identitySource: a.identitySource,
      windows,
      fullest: fullest?.id ?? null,
      spent: (spent.length > 0 && !covers) || !!reached,
      extraCovers: covers,
      freeAt,
      extra: a.extra,
      credits: a.credits,
      resetCredits: a.resetCredits,
      reached,
      noWindows: a.noWindows,
      at: a.at,
    };
  };

  return {
    report,
    signedIn,
    unknown,
    view,
    /**
     * Let go of what agents no longer configured said: an upstream removed, or no longer an agent, takes its account
     * with it. Called at start and on every save of the config.
     * @param {{ id: string, type?: string }[]} upstreams
     */
    retain(upstreams) {
      const agents = new Set(upstreams.filter(isAgentUpstream).map((u) => u.id));
      const gone = [...byUpstream.keys()].filter((id) => !agents.has(id));
      if (!gone.length) return;
      for (const id of gone) byUpstream.delete(id);
      log("info", `[accounts] let go of ${gone.join(", ")}'s account: no longer configured`);
      save();
    },
    /** Hear each change, by upstream id; returns the unsubscribe. @param {(upstreamId: string) => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** What a report changed, with the times it was heard left out: a report that repeats the numbers is no change. @param {KeptAccount} a */
const stripTimes = (a) => ({
  ...a,
  identityAt: null,
  at: 0,
  windows: a.windows.map((w) => ({ ...w, at: 0, readings: w.readings.map((r) => ({ ...r, at: 0 })) })),
});

/** @typedef {ReturnType<typeof createAgentAccounts>} AgentAccounts */
