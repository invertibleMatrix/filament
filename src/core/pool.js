// @ts-check
// A session's list of models for its agents on the side (HarnessV4_Tasks E15 step 8, V4-D285): a short list of models
// in the developer's order. A launch that names no model takes the first row from the top that can run and has room;
// the next row takes it where one is full.
//
// A row with no name is the main agent's model (AG-232): the default pool is that one row. Filament caps nothing of its
// own (the owner's word of 11-05: no number per chat, none per row): what holds a row is its model's limit at its
// source, where one is set (core/slots.js), and what a 429 of its provider's taught — and nothing runs
// where its model cannot run an agent (AG-234); on the main agent's own model, where its provider showed a limit, one
// call stays the main agent's (AG-235). The lent number is computed at each launch (AG-242), so a limit that lifts is
// used at the next. A row's old stored `seats` count says nothing any more. Pure: the facts of a model are handed in.

import { SUBAGENT_EFFORTS } from "./schema.js";
import { confirmedWords, slotFree, slotWords } from "./slots.js";

/** How many rows a pool holds at most. */
export const POOL_ROWS = 8;
/**
 * The pool of a session that never chose one: the main agent's model.
 * @type {readonly Readonly<{ model: string, seats?: number }>[]}
 */
export const DEFAULT_POOL = Object.freeze([Object.freeze({ model: "" })]);

/**
 * @typedef {{ model: string, effort?: string, seats?: number }} PoolRow  `model`: a routed name, "" for the main agent's
 *   model; `effort`: how hard its agents think where their launch names none (one of SUBAGENT_EFFORTS; left out, the main
 *   agent's — the owner's word of 11-05: "model · account · effort"); `seats`: Infinity, as every row lends — what holds
 *   it is its model's limit
 * @typedef {{ cap: number, from: "card" | "headers" | "429", liftsAt?: number, takes?: number, times?: number, since?: number, probing?: boolean }} PoolLimit
 *   how many agents the model's provider takes at once, and who said so; a 429's holds until `liftsAt`. Filament hands in
 *   only what a 429 taught (since 10-20 a price card's maxConcurrency caps nothing; since the review of 11-05 a
 *   provider's rate-limit headers, a minute's requests, hold none); "card" and "headers" stay for the facts a caller
 *   states itself
 * @typedef {{ problem: string | null, limit: PoolLimit | null, shared?: import("./slots.js").Slot | null }} ModelFacts
 *   `problem`: why the model cannot run an agent now, null when it can; `shared`: its slots across Filament, null where
 *   it lands nowhere
 * @typedef {object} Seat  a row as a launch reads it
 * @property {string} model  the model's name — the main agent's for a row that names none
 * @property {string | null} effort  how hard its agents think, as its row says; null, as their launch or the main agent
 * @property {string} key  what its names share: two rows of one key are one row
 * @property {boolean} named  the row names its model
 * @property {boolean} own  it is the main agent's model
 * @property {number} seats  as stored
 * @property {number} lent  how many of them can run now
 * @property {number} running  how many run on this model now
 * @property {string | null} problem
 * @property {PoolLimit | null} limit
 * @property {import("./slots.js").Slot | null} shared  its model's slots across Filament
 */

/** A model's name as two rows are compared: Filament's own `agent/` prefix says nothing of the model. @param {unknown} name */
export const poolName = (name) => String(name ?? "").trim().replace(/^agent\//, "");

/**
 * What is wrong with a pool as it would be stored, in words; null for one that holds.
 * @param {unknown} v @returns {string | null}
 */
export function poolProblem(v) {
  if (!Array.isArray(v)) return 'must be a list of { model, effort? } rows: the models sub-agents run on, in order — model "" is the main agent\'s';
  if (!v.length) return "needs one row at least: a session with no seat could run no agent";
  if (v.length > POOL_ROWS) return `holds at most ${POOL_ROWS} rows`;
  const seen = new Set();
  for (const [i, r] of v.entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return `[${i}] must be { model, effort? }`;
    const extra = Object.keys(r).filter((k) => k !== "model" && k !== "effort" && k !== "seats");
    if (extra.length) return `[${i}] holds ${extra.map((k) => `"${k}"`).join(", ")}: a row is { model, effort? }`;
    if (typeof r.model !== "string") return `[${i}].model must be a model's name, or "" for the main agent's model`;
    if (r.effort != null && !SUBAGENT_EFFORTS.includes(r.effort)) return `[${i}].effort must be one of ${SUBAGENT_EFFORTS.join(", ")}, or left out for the main agent's`;
    const name = poolName(r.model);
    if (seen.has(name)) return `names ${name ? `"${name}"` : "the main agent's model"} twice: each model has one row`;
    seen.add(name);
  }
  return null;
}

/** How many agents, or teams, a chat sets rows of its own for at most. */
export const CHAT_ROWS_MOST = 64;
/**
 * A key of a chat's own rows: an agent's tag — a plugin's agent's too, `<plugin>:<name>` — or a team's key, lower-case
 * as each is (the review of 11-05: one with capitals matched none). @param {string} k
 */
const keyed = (k) => /^[a-z0-9][a-z0-9._:-]{0,128}$/.test(k);

/**
 * What is wrong with a chat's own rows for its agents, by card (`subagents.byCard`, the owner's plan of 11-05): each
 * tag a list of rows as the chat's list holds (`poolProblem`) — model "" the main agent's — in words; null for one that
 * holds. @param {unknown} v @returns {string | null}
 */
export function byCardProblem(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "must be { tag: [{ model, effort? }] }: the models each agent runs on in this chat, in order";
  const tags = Object.keys(v);
  if (tags.length > CHAT_ROWS_MOST) return `holds at most ${CHAT_ROWS_MOST} agents`;
  for (const t of tags) {
    if (!keyed(t)) return `"${t}" is no agent's tag`;
    const p = poolProblem(/** @type {Record<string, unknown>} */ (v)[t]);
    if (p) return `["${t}"] ${p}`;
  }
  return null;
}

/**
 * What is wrong with a chat's own rows for its teams (`subagents.byTeam`): each key its lead's and its workers', each
 * where it sets them a list as the chat's list holds — in words; null for one that holds. @param {unknown} v
 * @returns {string | null}
 */
export function byTeamProblem(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "must be { key: { lead?, workers? } }: the models each team's lead and workers run on in this chat, each in order";
  const keys = Object.keys(v);
  if (keys.length > CHAT_ROWS_MOST) return `holds at most ${CHAT_ROWS_MOST} teams`;
  for (const k of keys) {
    if (!keyed(k)) return `"${k}" is no team's key`;
    const o = /** @type {Record<string, unknown>} */ (v)[k];
    if (!o || typeof o !== "object" || Array.isArray(o)) return `["${k}"] must be { lead?, workers? }, each a list of { model, effort? } rows`;
    const extra = Object.keys(o).filter((x) => x !== "lead" && x !== "workers");
    if (extra.length) return `["${k}"] holds ${extra.map((x) => `"${x}"`).join(", ")}: a team's rows are { lead?, workers? }`;
    for (const part of /** @type {const} */ (["lead", "workers"])) {
      const rows = /** @type {Record<string, unknown>} */ (o)[part];
      const p = rows === undefined ? null : poolProblem(rows);
      if (p) return `["${k}"].${part} ${p}`;
    }
  }
  return null;
}

/**
 * A stored value as rows: the value where it holds, else the default pool. Every row lends as many as its model takes:
 * the list is an order (U13-D15), and what caps a row is its model's limit (core/slots.js) and what its provider showed.
 * @param {unknown} v @returns {PoolRow[]}
 */
export function poolOf(v) {
  const rows = poolProblem(v) ? DEFAULT_POOL : /** @type {any[]} */ (v);
  return rows.map((r) => ({ model: poolName(r.model), ...(r.effort ? { effort: String(r.effort) } : {}), seats: Infinity }));
}

/**
 * A list as it is kept in the config: each row's model by its plain name, and its effort where it says one — an old
 * row's seats are dropped, as they say nothing. The value is one `poolProblem` passes.
 * @param {unknown} v @returns {{ model: string, effort?: string }[]}
 */
export const poolKept = (v) => /** @type {any[]} */ (v).map((r) => ({ model: poolName(r.model), ...(r.effort ? { effort: String(r.effort) } : {}) }));

/**
 * The rows as a launch reads them. A row that names the main agent's model and the row that names none are one
 * model: they stand as one seat row, at the first one's place, with the seats of both.
 * A session whose main agent's model is not known yet keeps that row with no model: it lends its seats, and a launch
 * that takes it says there is no model to run on.
 * @param {PoolRow[]} rows
 * @param {{ main: string, facts: (model: string) => ModelFacts, running: (key: string) => number, key?: (model: string) => string }} o
 *   `main`: the main agent's model; `running`: how many agents that take a seat run on a model now, by its key;
 *   `key`: what two names of one model share (a name less its effort suffix), the name itself where none is given
 * @returns {Seat[]}
 */
export function seatsOf(rows, { main, facts, running, key = (m) => m }) {
  const own = poolName(main);
  /** @type {Seat[]} */
  const out = [];
  for (const r of rows) {
    const model = poolName(r.model) || own;
    const k = model ? key(model) : "";
    const had = out.find((s) => s.key === k);
    if (had) {
      had.named = had.named || !!poolName(r.model);
      // Its effort: the first row of it that says one (the review of 11-05).
      if (!had.effort && r.effort) had.effort = String(r.effort);
      continue;
    }
    out.push({ model, effort: r.effort ? String(r.effort) : null, key: k, named: !!poolName(r.model), own: !!own && k === key(own), seats: Infinity, lent: 0, running: 0, problem: null, limit: null, shared: null });
  }
  for (const s of out) {
    /** @type {ModelFacts} */
    const f = s.model ? facts(s.model) : { problem: null, limit: null };
    s.problem = f.problem || null;
    s.limit = f.limit && Number(f.limit.cap) > 0 ? f.limit : null;
    s.shared = f.shared || null;
    s.running = s.model ? Math.max(0, Math.floor(Number(running(s.key)) || 0)) : 0;
    // The main agent's own call is one of its model's calls: where the model has a limit, one stays the main agent's —
    // and one seat stays whatever the limit, since an agent's call waits its turn at the provider.
    const room = s.limit ? (s.own ? Math.max(1, s.limit.cap - 1) : s.limit.cap) : Infinity;
    s.lent = s.problem ? 0 : Math.min(s.seats, room);
  }
  return out;
}

/**
 * How many agents the pool runs at once now: what its rows lend, each cut to its model's number across Filament (U13-D15:
 * with no counts of its own, a row holds as many as its model's slots).
 * @param {Seat[]} seats
 */
export const poolTotal = (seats) => seats.reduce((n, s) => n + Math.min(s.lent, s.shared ? s.shared.cap : Infinity), 0);

/** Whether a row has a free seat now: one of its own, and one of its model's slots across Filament. @param {Seat} s */
export const seatFree = (s) => !s.problem && s.running < s.lent && slotFree(s.shared);

/**
 * How many more agents the pool can start now: each row's free seats, cut to its model's free slots.
 * @param {Seat[]} seats
 */
export const poolRoom = (seats) => seats.reduce((n, s) => n + (s.problem ? 0 : Math.max(0, Math.min(s.lent - s.running, s.shared ? s.shared.cap - s.shared.running : Infinity))), 0);

/**
 * The model a launch the pool is full for waits on, where it may wait (a team's worker, team_v2_plan §5.7): the model it
 * named, else the first row from the top that can run — or null where none can.
 * @param {Seat[]} seats @param {{ want?: string, key?: (model: string) => string }} [o]
 */
export function waitSeat(seats, { want = "", key = (m) => m } = {}) {
  const name = poolName(want);
  if (name) return seats.find((x) => x.key === key(name))?.problem ? null : name;
  return seats.find((s) => !s.problem && s.model)?.model || null;
}
/**
 * The seat a launch takes.
 * - `want` "" — a launch that names no model, of a card that names none: the first row from the top that can run and
 *   has a free seat; the rows it passed because they cannot run are `skipped` — the row that names no model, the main
 *   agent's, a coding agent's helpers' too (the owner's of 11-06).
 * - `want` a model — a card's own, or the launch's: that model's seat where the pool lists it, refused where they
 *   are all taken (`who` is who asks for it, for the words); a model the pool does not list takes no row's seat.
 * @param {Seat[]} seats
 * @param {{ want?: string, who?: string, key?: (model: string) => string, of?: string }} [o]  `key`:
 *   as `seatsOf`'s; `of`: the list in a refusal's words — a session's workers' list (HarnessV4_Tasks E23-D6), else its pool
 * @returns {{ ok: true, model: string, pooled: boolean, skipped: { model: string, why: string }[] } | { ok: false, error: string }}
 */
export function takeSeat(seats, { want = "", who = "", key = (m) => m, of = "this session's pool" } = {}) {
  const name = poolName(want);
  if (name) {
    const s = seats.find((x) => x.key === key(name));
    if (!s) return { ok: true, model: name, pooled: false, skipped: [] };
    // Why it cannot run is the launch's own check to say, in its own words.
    if (s.problem || seatFree(s)) return { ok: true, model: name, pooled: true, skipped: [] };
    if (s.running < s.lent) return { ok: false, error: `${who ? `${who} runs on ${name}, and` : `${name}:`} ${slotsBusy(/** @type {import("./slots.js").Slot} */ (s.shared))}. Wait for one to finish.` };
    return { ok: false, error: `${who ? `${who} runs on ${name}:` : `${name}:`} ${fullWords(s)}. Wait for one to finish.` };
  }
  const rows = seats;
  const skipped = rows.filter((s) => s.problem).map((s) => ({ model: s.model, why: String(s.problem) }));
  const free = rows.find(seatFree);
  if (free) return { ok: true, model: free.model, pooled: true, skipped: skipped.filter((k) => rows.findIndex((s) => s.model === k.model) < rows.indexOf(free)) };
  if (!rows.length) return { ok: false, error: `${of} names no model for an agent` };
  if (skipped.length === rows.length) return { ok: false, error: `no model of ${of} can run an agent now: ${skipped.map((k) => `${k.model} (${k.why})`).join("; ")}` };
  return { ok: false, error: `every model of ${of} is busy: ${rows.filter((s) => !s.problem).map((s) => (s.running < s.lent && s.shared ? `${s.model} ${slotsBusy(s.shared)}` : `${s.model}: ${fullWords(s)}`)).join("; ")}. Wait for one to finish.` };
}

/**
 * A model's slots all busy, in a refusal's words: "its slots across Filament are busy (20 of 20 busy; set on its row
 * under its provider in Settings)". @param {import("./slots.js").Slot} s
 */
export const slotsBusy = (s) => `its slots across Filament are busy (${slotWords(s)}; ${s.set != null ? "set on its row under its provider in Settings" : "held by its provider"})`;

/**
 * A row whose agents run as many as it takes now, in words: "2 running, as many as it takes at once now (its provider
 * takes 2)". @param {Seat} s @param {number} [now]
 */
const fullWords = (s, now = Date.now()) => `${s.running} running, as many as it takes at once now${s.limit ? ` (${whyFewer(s, now)})` : ""}`;

/** What holds a model's agents back, in words: the limit its provider showed, a 429's with how long it holds. @param {Seat} s @param {number} now */
function whyFewer(s, now) {
  const limit = /** @type {PoolLimit} */ (s.limit);
  if (limit.from === "429") {
    const sure = confirmedWords(limit, now);
    if (sure) return sure;
    const mins = limit.liftsAt ? Math.max(1, Math.ceil((limit.liftsAt - now) / 60_000)) : 0;
    return `its provider said too many${mins ? `, for ${mins} more minute${mins === 1 ? "" : "s"}` : ""}`;
  }
  const takes = limit.from === "headers" ? `its provider's rate limit says ${limit.cap}` : `its provider takes ${limit.cap}`;
  return s.own && s.lent < limit.cap ? `${takes}, and the main agent runs on it too` : takes;
}

/**
 * Why a model runs fewer agents than a row holds, in words, or "": "1 at once: its provider said too many, for 5 more
 * minutes". @param {Seat} s @param {number} [now]
 */
export function lendsWords(s, now = Date.now()) {
  if (s.problem || !s.limit || s.lent >= s.seats) return "";
  return `${s.lent} at once: ${whyFewer(s, now)}`;
}

/**
 * What a refusal at the session's limit adds about its rows, or "": each model that lends fewer seats for a while, and
 * each that cannot run — so the session's agent sees why the limit is not the number it knew.
 * @param {Seat[]} seats @param {number} [now]
 */
export function poolNote(seats, now = Date.now()) {
  const parts = [];
  for (const s of seats) {
    if (s.problem) parts.push(`${s.model} cannot run an agent now (${s.problem})`);
    else if (s.limit?.from === "429" && s.lent < s.seats) parts.push(`${s.model} runs ${lendsWords(s, now)}`);
  }
  return parts.length ? ` ${parts.join(". ")}.` : "";
}

/**
 * The list in a line, in its order: "GLM-5.3 · GLM-5.3 Flash" (U13-D15: a row's count is never said). `pretty` writes
 * a model's name as the page does; a row that names none reads `mainWords`.
 * @param {PoolRow[]} rows @param {{ pretty?: (model: string) => string, mainWords?: string }} [o]
 */
export function poolLine(rows, { pretty = (m) => m, mainWords = "the main agent's model" } = {}) {
  return rows.map((r) => (poolName(r.model) ? pretty(poolName(r.model)) : mainWords)).join(" · ");
}
