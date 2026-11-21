// @ts-check
// Memory's metrics (the memory plan's b4): what memory showed and what of it the work used, by layer and by day, read
// from the injection log the archive keeps on disk — counts and ids, never words — so the figures outlive a restart
// (the benchmark's are the last requests in the process's memory). Pure: the archive's rows in (`rollupRows`), the
// rollup out. A record to read; nothing in Filament ranks or picks by it.
import { localDay } from "../daily-usage.js";

/** The days the rollup reads unless asked for others, and the most it reads (the log is kept as long as the archive). */
export const METRIC_DAYS = 30;
export const METRIC_DAYS_MAX = 365;
/** The layers memory shows through, in the order the page draws them; any other kind the log holds follows, by name. */
export const LAYERS = Object.freeze(["briefing", "turn", "pitfall", "thread", "erratum", "brief"]);
/** Whose a memory is, by its origin, as the rollup groups them. */
export const ORIGIN_GROUPS = Object.freeze(["person", "agent", "finding", "learner", "other"]);
/** @param {string | null | undefined} origin @returns {string} */
export const originGroup = (origin) => {
  const o = String(origin || "");
  if (o === "person" || o === "owner" || o === "correction") return "person";
  if (o === "model") return "agent";
  if (o === "agent" || o === "subagent") return "finding";
  if (o === "learner") return "learner";
  return "other";
};

/** The machine's own calendar day of a stamp, as the pages read one. @param {number} ms */
const dayOfStamp = (ms) => localDay(new Date(ms));
/** @param {number} used @param {number} judged */
const rate = (used, judged) => (judged ? Math.round((used / judged) * 1000) / 1000 : null);

/**
 * The rollup.
 * @param {{ injections: any[], ids: any[], items: any[], quiet?: any[] }} rows  the archive's (`injections.rollupRows`)
 * @param {{ since: number, days: number, fades?: (item: { kind: string, status: string }) => boolean, dayOf?: (ms: number) => string }} o
 *   `fades`: whether an item of that kind and status may fade for going unused (the brain's rule)
 */
export function memoryMetrics({ injections, ids, items, quiet = [] }, { since, days, fades = () => true, dayOf = dayOfStamp }) {
  /** Each injection's ids, as the junction holds them. @type {Map<number, { ref: string, used: number | null }[]>} */
  const byInjection = new Map();
  for (const r of ids) {
    const inj = Number(r.injection_id);
    const list = byInjection.get(inj) || [];
    list.push({ ref: String(r.memory_id), used: r.used == null ? null : Number(r.used) });
    byInjection.set(inj, list);
  }
  const item = new Map(items.map((it) => [`i${it.id}`, it]));
  /** @type {Map<string, { layer: string, injections: number, shown: number, judged: number, used: number, tokens: number, turns: Set<string>, again: number }>} */
  const layers = new Map();
  /** @type {Map<string, { day: string, shown: number, judged: number, used: number, tokens: number }>} */
  const daily = new Map();
  /** @type {Map<string, { origin: string, shown: number, judged: number, used: number }>} */
  const origins = new Map(ORIGIN_GROUPS.map((g) => [g, { origin: g, shown: 0, judged: 0, used: 0 }]));
  /** What each session was shown so far, for the showings that came again. @type {Map<string, Set<string>>} */
  const seenIn = new Map();
  for (const inj of injections) {
    const kind = String(inj.kind || "other");
    const L = layers.get(kind) || { layer: kind, injections: 0, shown: 0, judged: 0, used: 0, tokens: 0, turns: new Set(), again: 0 };
    layers.set(kind, L);
    const day = dayOf(Number(inj.created_at));
    const D = daily.get(day) || { day, shown: 0, judged: 0, used: 0, tokens: 0 };
    daily.set(day, D);
    L.injections++;
    L.tokens += Number(inj.tokens || 0);
    D.tokens += Number(inj.tokens || 0);
    if (inj.chain_id != null && inj.turn_id != null) L.turns.add(`${inj.chain_id}:${inj.turn_id}`);
    const seen = inj.chain_id != null ? seenIn.get(String(inj.chain_id)) || new Set() : null;
    if (seen) seenIn.set(String(inj.chain_id), seen);
    for (const { ref, used } of byInjection.get(Number(inj.id)) || []) {
      L.shown++;
      D.shown++;
      if (seen?.has(ref)) L.again++;
      seen?.add(ref);
      const O = /** @type {any} */ (origins.get(item.has(ref) ? originGroup(item.get(ref).origin) : "other"));
      O.shown++;
      if (used == null) continue;
      L.judged++;
      D.judged++;
      O.judged++;
      if (used === 1) {
        L.used++;
        D.used++;
        O.used++;
      }
    }
  }
  const order = (/** @type {string} */ k) => (LAYERS.includes(k) ? LAYERS.indexOf(k) : LAYERS.length);
  const shownItems = [...item.values()];
  const corrected = shownItems.filter((it) => it.status === "superseded" || it.superseded_by != null).length;
  return {
    since,
    days,
    layers: [...layers.values()]
      .sort((a, b) => order(a.layer) - order(b.layer) || a.layer.localeCompare(b.layer))
      .map(({ turns, ...L }) => ({ ...L, usedRate: rate(L.used, L.judged), turns: turns.size, tokensPerTurn: turns.size ? Math.round(L.tokens / turns.size) : null })),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).map((D) => ({ ...D, usedRate: rate(D.used, D.judged) })),
    origins: [...origins.values()].filter((O) => O.shown).map((O) => ({ ...O, usedRate: rate(O.used, O.judged) })),
    // The memories shown in the window that a correction has replaced since: served, then found wrong.
    corrected: { shown: shownItems.length, corrected, rate: rate(corrected, shownItems.length) },
    // The memories whose last three judged showings went unused and that may fade: the turn blocks leave them out now.
    faded: quiet.filter((it) => it.status !== "superseded" && it.status !== "dismissed" && fades({ kind: String(it.kind || ""), status: String(it.status || "") })).length,
  };
}
