// @ts-check
// Filament's own numbers for a Dashboard (HarnessV4_Artifacts_Plan E18 step 7, AF-D12, your yes of 10-16): the feeds a
// Dashboard's tiles may name, each read-only, answered on the Dashboard's own address (http/artifacts.js) and kept in
// its download as they were (AFC-133). The model calls by day and by model come from the durable daily usage, the last
// hour by minute and the calls in flight from the records, the sessions by day from the archive; each change is told,
// at most once a second, so an open Dashboard follows without being loaded again (AFC-131).
import { FEEDS, FEED_DAYS, FEED_DAYS_MAX, feedAsks, feedKey, isFeed } from "../core/artifact-content.js";
import { isModelCall } from "../core/turn-facts.js";
import { isMemoryRecord, localDay } from "./daily-usage.js";

/** How often, at most, the pages that follow are told what changed. */
const SAY_EVERY_MS = 1000;
/** How long a call writes before its speed is said: over less, one burst reads as thousands of tokens a second. */
const SPEED_AFTER_MS = 1000;
/** What a finished call changes, and what a call that starts or writes does. */
const FINISHED = Object.freeze(["usage-by-day", "usage-by-model", "usage-by-minute", "calls-now", "sessions-by-day"]);
const MOVING = Object.freeze(["usage-by-minute", "calls-now"]);

/**
 * @typedef {{ name: string, format: string }} FeedColumn
 * @typedef {{ ok: true, rows: Record<string, unknown>[], columns: FeedColumn[] } | { ok: false, status: number, error: string }} FeedRead
 *   a feed's rows and columns, or why not: `status` as an address answers it
 * @typedef {ReturnType<typeof createFeeds>} Feeds
 */

/**
 * @param {{ usage: import("./records.js").UsageStore, archive: () => any, now?: () => number }} o
 *   `archive`: memory's archive, read at each call — none where memory keeps no session record
 */
export function createFeeds({ usage, archive, now = () => Date.now() }) {
  /** The last `days` days, the oldest first, by this machine's own days. @param {number} days */
  const daysBack = (days) =>
    Array.from({ length: days }, (_, i) => {
      // Noon, so a day of 23 or 25 hours is still one day.
      const d = new Date(now());
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - (days - 1 - i));
      return localDay(d);
    });

  /** @type {Record<string, (days: number) => Record<string, unknown>[]>} */
  const readers = {
    "usage-by-day": (days) => {
      const span = daysBack(days);
      const kept = new Map(usage.dailyStore.list({ from: span[0] }).map((/** @type {any} */ d) => [d.day, d]));
      return span.map((day) => {
        const d = kept.get(day);
        return {
          day,
          requests: d?.requests ?? 0,
          errors: d?.errors ?? 0,
          input: d?.input ?? 0,
          output: d?.output ?? 0,
          cacheRead: d?.cacheRead ?? 0,
          cacheWrite: d?.cacheWrite ?? 0,
          tokens: d?.totalTokens ?? 0,
          cost: d?.cost ?? 0,
          listCost: d?.listCost ?? 0,
          cacheHitRate: d?.cacheHitRate ?? 0,
          tps: d?.avgTps ?? null,
          firstByteMs: d?.avgTtftMs ?? null,
        };
      });
    },
    "usage-by-model": (days) =>
      usage.dailyStore.aggregate({ from: daysBack(days)[0] }).rows.map((/** @type {any} */ r) => ({
        model: r.model,
        upstream: r.upstream,
        requests: r.requests,
        errors: r.errors,
        output: r.output,
        tokens: r.totalTokens,
        cost: r.cost,
        tps: r.avgTps,
        firstByteMs: r.avgTtftMs,
      })),
    "usage-by-minute": () =>
      usage.timeline(60, { calls: true }).map((b) => ({
        minute: new Date(b.t).toISOString(),
        requests: b.requests,
        errors: b.errors,
        input: b.input,
        output: b.output,
        firstByteMs: b.ttftMs,
      })),
    // Model calls alone, as by the day: a turn's parent is none, nor is memory's own call. The speed is the speed so
    // far, its output over the time since its first byte: an upstream may send in bursts (GLM 5.3's came some two
    // seconds apart), so the speed over the last second is 0 between them and the composer's, which leaves pauses
    // out, counts none.
    "calls-now": () =>
      usage
        .live()
        .filter((/** @type {any} */ r) => !isMemoryRecord(r) && isModelCall(r))
        .map((/** @type {any} */ r) => ({
          model: String(r.upstreamModel || r.model || "?"),
          upstream: String(r.upstream || ""),
          phase: r.phase === "streaming" ? "writing" : "waiting",
          seconds: Math.round((Number(r.elapsedMs) || 0) / 100) / 10,
          output: r.liveOutTokens || 0,
          tps: r.streamMs >= SPEED_AFTER_MS ? r.liveTps : null,
        })),
    "sessions-by-day": (days) => {
      const a = archive();
      if (!a?.sessionsByDay) throw new Error("Filament keeps no record of sessions here: memory's archive is off");
      const span = daysBack(days);
      const [y, m, d] = span[0].split("-").map(Number);
      const kept = new Map(a.sessionsByDay(new Date(y, m - 1, d).getTime()).map((/** @type {any} */ r) => [r.day, r]));
      return span.map((day) => ({ day, sessions: kept.get(day)?.sessions ?? 0, turns: kept.get(day)?.turns ?? 0 }));
    },
  };

  /** @type {Set<(names: string[]) => void>} */
  const followers = new Set();
  /** @type {Set<string>} */
  let due = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let saidAt = 0;
  const say = () => {
    timer = null;
    saidAt = Date.now();
    const names = [...due];
    due = new Set();
    for (const f of [...followers]) {
      try {
        f(names);
      } catch {
        // A page that went away mid-word is not told again: its stream's close stops it.
      }
    }
  };
  /** @param {any} ev  the records' event: a call started, wrote, or finished */
  const heard = (ev) => {
    const names = ev?.type === "finish" ? FINISHED : ev?.type === "start" || ev?.type === "progress" ? MOVING : null;
    if (!names) return;
    for (const n of names) due.add(n);
    if (timer) return;
    timer = setTimeout(say, Math.max(0, SAY_EVERY_MS - (Date.now() - saidAt)));
    timer.unref?.();
  };

  /**
   * One feed's rows and columns now (AFC-129), or why not, in words: a feed by day reads `days` days, 30 unless given.
   * @param {string} name @param {{ days?: unknown }} [o]
   * @returns {FeedRead}
   */
  const read = (name, { days } = {}) => {
    if (!isFeed(name)) return { ok: false, status: 404, error: `Filament has no numbers named ${name}` };
    const feed = FEEDS[name];
    const n = days == null || days === "" ? FEED_DAYS : Number(days);
    if (feed.days && (!Number.isInteger(n) || n < 1 || n > FEED_DAYS_MAX)) return { ok: false, status: 400, error: `days is a whole number from 1 to ${FEED_DAYS_MAX}` };
    try {
      return { ok: true, rows: readers[name](n), columns: feed.columns.map(([c, format]) => ({ name: c, format })) };
    } catch (/** @type {any} */ e) {
      return { ok: false, status: 500, error: `${feed.words} could not be read: ${String(e?.message || e)}` };
    }
  };

  return {
    read,
    /**
     * A Dashboard's numbers as they are now, for its download (AFC-133): each feed its tiles read, by `feedKey`, and
     * the moment they were read.
     * @param {unknown} content  the Dashboard's content, as kept
     * @returns {{ at: number, feeds: Record<string, FeedRead> }}
     */
    snapshot(content) {
      /** @type {Record<string, FeedRead>} */
      const feeds = {};
      for (const ask of feedAsks(content)) feeds[feedKey(ask)] = read(ask.feed, { days: ask.days });
      return { at: now(), feeds };
    },
    /**
     * Be told which feeds changed (AFC-131), at most once a second; the returned function stops it.
     * @param {(names: string[]) => void} fn
     */
    follow(fn) {
      followers.add(fn);
      if (followers.size === 1) usage.on("event", heard);
      return () => {
        if (!followers.delete(fn) || followers.size) return;
        usage.off("event", heard);
        if (timer) clearTimeout(timer);
        timer = null;
        due = new Set();
      };
    },
  };
}
