// @ts-check
// Filament's anonymous telemetry (the owner's of 11-10): on by default in an official build — one whose build-info.json
// says `official: true`, which the release CI's builds alone write (`officialBuild`) —, off by default in any other and
// in a checkout; said at the first start; the setting `telemetry.enabled` turns it on or off whatever the build's
// default, and DO_NOT_TRACK or FILAMENT_TELEMETRY=0 off (core/telemetry-payload.js `whyOff`). What leaves the machine
// is built by core/telemetry-payload.js alone, from values picked out of fixed lists: this service only gathers a day's
// facts raw, keeps what it counted itself, and sends. Two events: "app opened" at each start, and once a day the
// summary of a day Filament ran on, timed at that day's end so the day counts as one it was used. Kept in
// <dataDir>/telemetry.json: an id of its own — never machine.json's, which pairing shows other Filaments —, the days
// counted and not sent yet, the events not delivered yet (a few days' worth at the most), and the last body sent, which
// Settings › Data and privacy shows as it went. Nothing is sent, counted or kept while it is off, nor before the person
// has been shown the notice (`telemetry.noticeSeen`). A failed send waits for the next hour's look; it never holds a
// start or a stop.
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appOpened, dailySummary, whyOff } from "../core/telemetry-payload.js";
import { localDay } from "./daily-usage.js";
import { STORE_FILES, readStoreFile } from "./store-files.js";

/** Where the events go: Filament's relay, which drops the address they came from and passes them on. */
export const TELEMETRY_URL = "https://t.filamentdev.com/e";
/** How often it looks for a day to send and events still waiting. */
export const LOOK_MS = 3600_000;
/** The longest a send may take. */
const SEND_MS = 10_000;
/** The most days a summary is sent for after a gap (a machine off for a week sends its last days alone). */
const BACKLOG_DAYS = 3;
/** The most events kept waiting for the relay: older ones go first. */
const PENDING_MAX = 20;

/**
 * Whether the Filament in the folder `root` is an official build: its build-info.json says `official: true` — a
 * server's at the folder's top (scripts/dist-server.mjs), the desktop app's in desktop/ (desktop/lib/build-info.js),
 * each written so by a build with FILAMENT_OFFICIAL_BUILD=1 alone. A checkout has neither.
 * @param {string} root
 */
export function officialBuild(root) {
  for (const file of [join(root, "build-info.json"), join(root, "desktop", "build-info.json")])
    try {
      if (JSON.parse(readFileSync(file, "utf8"))?.official === true) return true;
    } catch {}
  return false;
}

/**
 * The day before `day`, YYYY-MM-DD. @param {string} day @param {number} [n]
 */
const shift = (day, n = -1) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
};
/** A day's last minute on this machine's clock, as an ISO time: a day's summary is timed at it. @param {string} day */
const endOf = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 0).toISOString();
};

/**
 * @typedef {{ event: string, timestamp: string, properties: Record<string, unknown> }} SentEvent
 * @typedef {{ runs: Record<string, { upstream: string | null, sub: boolean, n: number }>, graphChats: string[] }} DayCount
 * @typedef {{ version: 1, id: string | null, since: string | null, sentThrough: string | null, days: Record<string, DayCount>, pending: SentEvent[], last: { at: number, body: any } | null }} State
 */

/**
 * @param {{
 *   dataDir?: string | null, armed?: boolean, onByDefault?: boolean, config: { get: () => any }, usage: { dailyStore: { list: (span?: any) => any[] } },
 *   events: { subscribe: (topic: string, fn: (payload: any, entry: any) => void) => () => void },
 *   features?: () => Record<string, unknown>, context: () => import("../core/telemetry-payload.js").TelemetryEnv, markSeen?: () => void,
 *   env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, url?: string, now?: () => number,
 *   every?: (fn: () => void, ms: number) => any, stopEvery?: (t: any) => void, log?: (level: string, msg: string) => void,
 * }} o  `armed`: whether this Filament may send at all — bin/filament.js's, never a test's (server.js); `onByDefault`:
 *   whether it sends where the person chose nothing — an official build's (`officialBuild`);
 *   `features`: the day's switches and counts (core/telemetry-payload.js FEATURE_*); `context`: the build and machine.
 */
export function createTelemetry({ dataDir = null, armed = false, onByDefault = false, config, usage, events, features = () => ({}), context, markSeen = () => {}, env = process.env, fetchImpl = fetch, url = TELEMETRY_URL, now = () => Date.now(), every = setInterval, stopEvery = clearInterval, log = () => {} }) {
  const file = dataDir ? join(dataDir, "telemetry.json") : null;
  /** @type {State} */
  let state = { version: 1, id: null, since: null, sentThrough: null, days: {}, pending: [], last: null };
  if (file)
    try {
      // One of another build's version is set aside first, never saved over (r-itself, 11-12; services/store-files.js).
      const j = readStoreFile(file, STORE_FILES.telemetry, (level, msg) => log(level, `[telemetry] ${msg}`), { now });
      if (j?.version === 1)
        state = {
          version: 1,
          id: typeof j.id === "string" && j.id ? j.id : null,
          since: typeof j.since === "string" ? j.since : null,
          sentThrough: typeof j.sentThrough === "string" ? j.sentThrough : null,
          days: j.days && typeof j.days === "object" ? j.days : {},
          pending: Array.isArray(j.pending) ? j.pending.slice(-PENDING_MAX) : [],
          last: j.last && typeof j.last === "object" ? j.last : null,
        };
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `[telemetry] ${file} could not be read (${e?.message || e}): it starts again`);
    }
  const save = () => {
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 1));
      renameSync(tmp, file);
    } catch (/** @type {any} */ e) {
      log("warn", `[telemetry] could not keep ${file}: ${e?.message || e}`);
    }
  };

  /** Why nothing is sent now, or null: not armed, off (the environment, the setting, or the build's default), or the notice not shown yet. */
  const why = () => {
    if (!armed) return "not-armed";
    const cfg = config.get();
    const off = whyOff(cfg, env, onByDefault);
    if (off) return off;
    return cfg?.telemetry?.noticeSeen === true ? null : "notice";
  };
  /** Counting goes on while the notice waits: the day it is shown is counted whole. Off, nothing is kept. */
  const counting = () => {
    const w = why();
    return w === null || w === "notice";
  };
  const today = () => localDay(new Date(now()));
  /** @param {string} day @returns {DayCount} */
  const dayOf = (day) => (state.days[day] ||= { runs: {}, graphChats: [] });
  /** Counted since the file was last kept. */
  let dirty = false;

  /** @param {any} payload */
  const heard = (payload) => {
    try {
      if (!counting() || !payload || typeof payload !== "object") return;
      if (payload.type === "run-start") {
        const meta = payload.meta || {};
        // A turn the loop goes on with after a restart is the same turn: counted once, when it began.
        if (meta.resumed) return;
        const upstream = typeof meta.upstream === "string" ? meta.upstream : null;
        const sub = payload.kind === "subagent";
        const key = `${upstream || ""}|${sub ? 1 : 0}`;
        const runs = dayOf(today()).runs;
        (runs[key] ||= { upstream, sub, n: 0 }).n++;
        dirty = true;
      } else if (payload.type === "graph" && typeof payload.chainId === "string") {
        const d = dayOf(today());
        if (!d.graphChats.includes(payload.chainId)) {
          d.graphChats.push(payload.chainId);
          dirty = true;
        }
      }
    } catch {}
  };

  /** @param {SentEvent} e */
  const queue = (e) => {
    state.pending.push(e);
    if (state.pending.length > PENDING_MAX) state.pending = state.pending.slice(-PENDING_MAX);
  };
  /** The summaries owed: each day since telemetry began, before today, not sent yet, and run on — the last few. */
  const owedDays = () => {
    const t = today();
    return Object.keys(state.days)
      .filter((d) => d < t && (!state.sentThrough || d > state.sentThrough) && (!state.since || d >= state.since))
      .sort()
      .slice(-BACKLOG_DAYS);
  };
  /** @param {string} day */
  const summaryOf = (day) => {
    const cfg = config.get();
    const count = state.days[day] || { runs: {}, graphChats: [] };
    const usageDay = usage.dailyStore.list({ from: day, to: day })[0] || null;
    let f = {};
    try {
      f = features() || {};
    } catch {}
    const facts = { day, usage: usageDay, upstreams: Array.isArray(cfg?.upstreams) ? cfg.upstreams : [], runs: Object.values(count.runs), features: { ...f, graphChats: count.graphChats.length } };
    return { ...dailySummary(facts, context()), timestamp: endOf(day) };
  };

  let opened = false;
  /** @type {Promise<void> | null} */
  let sending = null;
  /** Send what is owed, if it may: the start's "app opened", the days' summaries, the events still waiting. */
  async function look() {
    if (sending) return sending;
    sending = (async () => {
      if (dirty) {
        dirty = false;
        if (counting()) save();
      }
      if (why()) return;
      if (!state.id) state.id = randomUUID();
      if (!state.since) state.since = today();
      dayOf(today());
      if (!opened) {
        opened = true;
        queue({ ...appOpened(context()), timestamp: new Date(now()).toISOString() });
      }
      const days = owedDays();
      for (const d of days) queue(summaryOf(d));
      if (days.length) state.sentThrough = days[days.length - 1];
      // Days older than what is owed are of no use any more.
      for (const d of Object.keys(state.days)) if (d < shift(today(), -BACKLOG_DAYS - 1)) delete state.days[d];
      save();
      if (!state.pending.length) return;
      const body = { id: state.id, sentAt: new Date(now()).toISOString(), events: state.pending };
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(SEND_MS) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        state.pending = [];
        state.last = { at: now(), body };
        save();
      } catch (/** @type {any} */ e) {
        log("debug", `[telemetry] not sent (${e?.message || e}): tried again within the hour`);
      }
    })().finally(() => {
      sending = null;
    });
    return sending;
  }

  /** @type {(() => void) | null} */
  let unsubscribe = null;
  /** @type {any} */
  let timer = null;
  return {
    /** Starts listening and looks once now, then each hour. A Filament not armed starts nothing. */
    start() {
      if (!armed || timer) return;
      unsubscribe = events.subscribe("*", heard);
      timer = every(() => void look(), LOOK_MS);
      timer?.unref?.();
      void look();
    },
    /** Stops: what was counted is kept for the next start; nothing waits on the network. */
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (timer) stopEvery(timer);
      timer = null;
      if (dirty && counting()) save();
      dirty = false;
    },
    /** Look now (after the notice is shown, or the switch turned on). */
    look,
    /** The notice was said where the person reads it (a terminal's start lines): kept as shown, then a look. */
    told() {
      try {
        markSeen();
      } catch (/** @type {any} */ e) {
        log("warn", `[telemetry] the notice could not be kept as shown: ${e?.message || e}`);
      }
      void look();
    },
    /** What Settings shows: on or why not, whether it sends where nothing is chosen, and the body last sent, as it went. */
    view() {
      const w = why();
      return { on: w === null, why: w, armed, onByDefault, last: state.last, waiting: state.pending.length };
    },
  };
}

/** @typedef {ReturnType<typeof createTelemetry>} Telemetry */
