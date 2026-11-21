// @ts-check
// How many agents run on a model at once across Filament (team_v2_plan TV2-D8, TV2-D9; P2): one number per model at
// each source that serves it — the upstream a routed name lands on, a provider's key or a coding agent's account — kept
// as `agentLoop.subagents.slots`, a list of { upstream, model, n } rows, `model` as that upstream receives it, set on
// the model's row under its provider or its coding agent. Every chat's agents and every lead's workers share them: a
// launch takes a free slot. A row caps agents only — Filament's gate on requests reads what the provider showed, never
// a row (the owner's word of 11-05) — and a model with no row has no cap at all; a model served by two sources is two
// rows. A provider's "too many requests" lowers what a model lends for a while (`slotWords`); refused at the same
// number again, it says how many the provider takes, and one more is tried after (`confirmedWords`). Pure: where a name
// lands and how many run are handed in.
import { durationWords } from "./text.js";

/** The most one row may say. */
export const SLOTS_MOST = 64;
/** How many rows the list holds at most. */
export const SLOTS_ROWS = 64;

/**
 * @typedef {{ upstream: string, model: string, n: number }} SlotRow  `model`: the name its upstream receives
 * @typedef {object} Slot  a model's slots at its source, as a launch reads them
 * @property {string} key  its row's identity (`slotKey`)
 * @property {string} upstream
 * @property {string} model  the name its upstream receives
 * @property {number | null} set  the row's number, null where none is set
 * @property {number} cap  how many agents may run on it at once now: the row's, else no cap (Infinity), cut to a
 *   ceiling its provider showed for a while
 * @property {Lowered | null} lowered  that ceiling, where it cuts
 * @property {number} running  how many agents run on it now, across every chat
 */

/**
 * A ceiling a provider showed, as a slot reads it: its number, who said it and when it next changes; one the provider
 * confirmed with a second refusal also how many it takes, how often it refused one more, since when, and whether one
 * more is being tried (services/health.js `ObservedCeiling`). Filament hands in a 429's alone (`learnedCeiling`, the
 * review of 11-05): "headers" stays for a caller that states one itself.
 * @typedef {{ cap: number, from: "headers" | "429", liftsAt?: number, takes?: number, times?: number, since?: number, probing?: boolean }} Lowered
 */

/** A count's place in words: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. @param {number} n */
export const ordinal = (n) => {
  const k = Math.floor(n);
  const tail = k % 100 >= 11 && k % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] || "th");
  return `${k}${tail}`;
};

/**
 * A ceiling its provider confirmed, in words, or "" for one a single refusal taught: "its provider takes about 7 at once
 * on this account: it refused the 8th 3 times in 59 min", and while one more is tried, "trying one more at a time: its
 * provider refused the 8th 3 times in 59 min".
 * @param {Lowered | { takes?: number, times?: number, since?: number, probing?: boolean } | null | undefined} c @param {number} [now]
 */
export function confirmedWords(c, now = Date.now()) {
  if (!c || !(Number(c.times) >= 2) || !(Number(c.takes) > 0)) return "";
  const takes = Number(c.takes);
  const refused = `refused the ${ordinal(takes + 1)} ${c.times} times${c.since ? ` in ${durationWords(Math.max(0, now - c.since))}` : ""}`;
  return c.probing ? `trying one more at a time: its provider ${refused}` : `its provider takes about ${takes} at once on this account: it ${refused}`;
}

/** A row's identity: its upstream and its model, the model compared as written any case. @param {unknown} upstream @param {unknown} model */
export const slotKey = (upstream, model) => `${String(upstream ?? "")}\0${String(model ?? "").trim().toLowerCase()}`;

/**
 * What is wrong with a list as it would be stored, in words; null for one that holds.
 * @param {unknown} v @returns {string | null}
 */
export function slotsProblem(v) {
  if (!Array.isArray(v)) return "must be a list of { upstream, model, n } rows: how many agents run on a model at once at each source";
  if (v.length > SLOTS_ROWS) return `holds at most ${SLOTS_ROWS} rows`;
  const seen = new Set();
  for (const [i, r] of v.entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return `[${i}] must be { upstream, model, n }`;
    const extra = Object.keys(r).filter((k) => !["upstream", "model", "n"].includes(k));
    if (extra.length) return `[${i}] holds ${extra.map((k) => `"${k}"`).join(", ")}: a row is { upstream, model, n }`;
    if (typeof r.upstream !== "string" || !r.upstream.trim()) return `[${i}].upstream must name the source: the upstream's id`;
    if (typeof r.model !== "string" || !r.model.trim()) return `[${i}].model must be the model's name as that upstream receives it`;
    if (!Number.isInteger(r.n) || r.n < 1 || r.n > SLOTS_MOST) return `[${i}].n must be a whole number from 1 to ${SLOTS_MOST}`;
    const k = slotKey(r.upstream.trim(), r.model);
    if (seen.has(k)) return `names "${r.model}" at "${r.upstream}" twice: each model has one row at each source`;
    seen.add(k);
  }
  return null;
}

/**
 * A stored value as rows: each row that holds, each model once at each source, the first SLOTS_ROWS — a list its check
 * refuses (one written by hand, or saved before the check was kept) keeps the rows that hold, so a write builds on them
 * (the review of 11-05: read as none, every limit went, and the next write kept its own row alone). None where it is no
 * list.
 * @param {unknown} v @returns {SlotRow[]}
 */
export function slotsOf(v) {
  if (!Array.isArray(v)) return [];
  /** @type {SlotRow[]} */
  const out = [];
  const seen = new Set();
  for (const r of v) {
    if (out.length >= SLOTS_ROWS) break;
    if (!r || typeof r !== "object" || typeof r.upstream !== "string" || !r.upstream.trim() || typeof r.model !== "string" || !r.model.trim()) continue;
    if (!Number.isInteger(r.n) || r.n < 1 || r.n > SLOTS_MOST) continue;
    const k = slotKey(r.upstream.trim(), r.model);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ upstream: r.upstream.trim(), model: r.model.trim(), n: r.n });
  }
  return out;
}

/**
 * The number a row sets for a model at its source, or null where none does.
 * @param {SlotRow[]} rows @param {string} upstream @param {string} model
 */
export function slotSet(rows, upstream, model) {
  const k = slotKey(upstream, model);
  return rows.find((r) => slotKey(r.upstream, r.model) === k)?.n ?? null;
}

/**
 * The list with one row set, or taken out (`n` null: the default again).
 * @param {SlotRow[]} rows @param {string} upstream @param {string} model @param {number | null} n @returns {SlotRow[]}
 */
export function withSlot(rows, upstream, model, n) {
  const k = slotKey(upstream, model);
  const at = rows.findIndex((r) => slotKey(r.upstream, r.model) === k);
  if (n == null) return at < 0 ? rows : rows.filter((_, i) => i !== at);
  const row = { upstream, model, n };
  return at < 0 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
}

/**
 * A model's slots now: its row's number, else no cap, cut to a lower ceiling a 429 of its provider's taught (never its
 * rate-limit headers', a minute's requests: health.learnedCeiling), with how many agents run on it.
 * @param {SlotRow[]} rows @param {{ upstream: string, model: string }} at  where its name lands
 * @param {{ seen: Lowered | null, running: number }} o
 * @returns {Slot}
 */
export function slotOf(rows, at, { seen, running }) {
  const set = slotSet(rows, at.upstream, at.model);
  const n = set ?? Infinity;
  const confirmed = seen && Number(seen.times) >= 2 ? { takes: seen.takes, times: seen.times, since: seen.since, probing: !!seen.probing } : {};
  const lowered = seen && Number(seen.cap) > 0 && seen.cap < n ? { cap: Math.floor(seen.cap), from: seen.from, ...(seen.liftsAt ? { liftsAt: seen.liftsAt } : {}), ...confirmed } : null;
  return { key: slotKey(at.upstream, at.model), upstream: at.upstream, model: at.model, set, cap: lowered ? lowered.cap : n, lowered, running: Math.max(0, Math.floor(running) || 0) };
}

/** Whether a slot has room for one more agent. @param {Slot | null | undefined} s */
export const slotFree = (s) => !s || s.running < s.cap;

/**
 * A slot in words, for a refusal, a wait and the Library's row: "20 of 20 busy", and why fewer than set, with how long
 * a provider's ceiling holds.
 * @param {Slot} s @param {number} [now]
 */
export function slotWords(s, now = Date.now()) {
  const busy = Number.isFinite(s.cap) ? `${s.running} of ${s.cap} busy` : `${s.running} running`;
  if (!s.lowered) return busy;
  const from = s.set != null ? `lowered from ${s.set}` : "no limit set";
  if (s.lowered.from === "429") {
    const sure = confirmedWords(s.lowered, now);
    if (sure) return `${busy}: ${from}, ${sure}`;
    const mins = s.lowered.liftsAt ? Math.max(1, Math.ceil((s.lowered.liftsAt - now) / 60_000)) : 0;
    return `${busy}: ${from}, its provider said too many${mins ? `, for ${mins} more minute${mins === 1 ? "" : "s"}` : ""}`;
  }
  return s.set != null ? `${busy}: lowered from ${s.set} to its provider's rate limit` : `${busy}: its provider's rate limit`;
}
