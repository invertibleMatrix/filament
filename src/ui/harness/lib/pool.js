// @ts-check
// A chat's list of models for its agents, as the page holds it (HarnessV4_Tasks E15 step 8): the rows of the setting
// `subagents.pool`, the chip's line, the edits its editor makes — each a new list, the stored one never touched — and
// the words beside a row. Since U13-D14, D15 (10-20) it is the one list — a team's crew and a plan's tasks run on it too
// — and always an order: a row holds no count; what caps it is each model's limit at its provider, where one is set, and
// what its provider showed — no number caps a chat (the owner's word of 11-05). Without a document. The rules a launch
// follows are the server's (core/pool.js); what a row takes now is asked of it (POST /api/subagents/seats).
import { AGENT_LEVELS, levelWords, prettyModel, vendorOf } from "./families.js";

/** How many rows a pool holds at most (core/pool.js's). */
export const POOL_ROWS = 8;
/** The pool of a session that never chose one: the main agent's model, no count (core/pool.js's). @type {readonly Readonly<{ model: string, seats?: number }>[]} */
export const DEFAULT_POOL = Object.freeze([Object.freeze({ model: "" })]);
/** The nameless row, in words. */
export const MAIN_ROW = "Your chat's model";

/**
 * @typedef {{ model: string, seats: number, effort?: string }} PoolRow  `model`: a routed name, "" for the main agent's
 *   model; `effort`: how hard its agents think on it (the owner's word of 11-05: rows are model · account · effort) —
 *   "model" its model's own, none the default: the main agent's
 */
/**
 * @typedef {object} SeatFacts  a row as the server reads it now
 * @property {string} model @property {boolean} named @property {boolean} own
 * @property {number} seats @property {number} lent @property {number} running
 * @property {string | null} problem @property {string} lends
 * @property {{ cap: number, from: string, liftsAt?: number } | null} limit
 * @property {{ input: number, output: number } | null} price
 * @property {{ key?: string, upstream?: string, model?: string, cap: number | null, running: number, set: number | null } | null} [shared]
 *   its model's slots across Filament (team_v2_plan TV2-D8): where its name lands, the number set there (`cap` null:
 *   no limit), what runs
 */

/** A model's name as two rows are compared. @param {unknown} name */
const nameOf = (name) => String(name ?? "").trim().replace(/^agent\//, "");

/** The efforts a row may say (core/pool.js's `SUBAGENT_EFFORTS`). */
const ROW_EFFORTS = Object.freeze(["model", ...AGENT_LEVELS]);
/** A row's effort as kept: one a row may say, else none. @param {unknown} e */
const effortOf = (e) => (typeof e === "string" && ROW_EFFORTS.includes(e) ? { effort: e } : {});
/** Whether a stored value is a list of rows: an old row's seats, whatever they say, are none of it (core/pool.js's). @param {unknown} v */
const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && typeof r.model === "string");

/**
 * A stored value as rows: the value where it is a pool, else the default. Every row is a place in the order (U13-D15),
 * holding no count — an older row's count is none of its.
 * @param {unknown} v @returns {PoolRow[]}
 */
export function poolRows(v) {
  return (isRows(v) ? /** @type {any[]} */ (v) : DEFAULT_POOL).map((r) => ({ model: nameOf(r.model), seats: Infinity, ...effortOf(r.effort) }));
}
/** A chat's list as a write patches it (U13-D15): an order. @param {Record<string, any>} _flat @param {PoolRow[]} rows */
export function poolPatch(_flat, rows) {
  return { subagents: { pool: orderOf(rows) } };
}
/** The rows as an order (U13-D12): each its model and the effort it says, no count. @param {PoolRow[]} rows */
export const orderOf = (rows) => rows.map((r) => ({ model: r.model, ...effortOf(r.effort) }));
/** Whether a list is the one every session starts from, as an order: the main agent's model alone. @param {PoolRow[]} rows */
export const isMainOnly = (rows) => rows.length === 1 && !rows[0].model;

/** Whether two lists are the same order, each row at the same effort. @param {PoolRow[]} a @param {PoolRow[]} b */
export const samePool = (a, b) => a.length === b.length && a.every((r, i) => r.model === b[i].model && (r.effort || "") === (b[i].effort || ""));
/** Whether a list is the one every session starts from: your chat's model alone. @param {PoolRow[]} rows */
export const isDefaultPool = (rows) => isMainOnly(rows);

/** A row's effort in words: "The model's own", "High". @param {string} e */
const effortWords = (e) => (e === "model" ? "The model's own" : levelWords(e));
/**
 * The list in a line, for its chip, in its order: "GLM-5.3 (High) · GLM-5.3 Flash" (U13-D15: no count) — a row's
 * effort where it says one. The nameless row reads the main agent's model where the page knows it, else "Your chat's
 * model".
 * @param {PoolRow[]} rows @param {string} [main]
 */
export function poolLine(rows, main = "") {
  return rows.map((r) => `${r.model ? prettyModel(r.model) : main ? prettyModel(main) : MAIN_ROW}${r.effort ? ` (${effortWords(r.effort)})` : ""}`).join(" · ");
}

/**
 * The model a launch that names none takes first, as the page can say it before the launch: the first row's, the main
 * agent's for the nameless row.
 * @param {PoolRow[]} rows @param {string} [main]
 */
export const poolFirst = (rows, main = "") => rows[0]?.model || main;

/**
 * What a card that names no model runs on here, as the page names it before the launch (AG-260): the seat the server
 * says a launch would take now — the first row from the top that can run and has a free seat, the main agent's model
 * for the row that stands for it — and the first row until the server has said, or where no seat is free.
 * @param {PoolRow[]} rows @param {string} [main] @param {{ model: string, own: boolean } | null} [next]
 */
export const poolNext = (rows, main = "", next = null) => (next ? (next.own && main) || next.model : poolFirst(rows, main));

/**
 * Where the pool in force comes from, for the note beside its chip and its tooltip: the chat's own list, else none —
 * a list is a chat's own alone, and with none its agents run on its model, as its main agent does (the owner's plan
 * of 11-05).
 * @param {PoolRow[]} _rows @param {string} [source]  the settings layer: session, else none of the chat's
 * @returns {{ note: string, title: string, own: boolean }}  `own`: the chat's own list, the one "Use the default" clears
 */
export function poolFrom(_rows, source = "default") {
  if (source === "session")
    return { note: "this chat's own", title: "This chat's own list. An agent takes the first model with room, from the top; a card with a model of its own runs on that model", own: true };
  return { note: "this chat's model", title: "None set: its agents run on this chat's model, as its main agent does, unless a card names one. A change here is this chat's own", own: false };
}

// ---- the editor's edits: each returns a new list, or the same one where the edit does not apply -----------------------

/** One row up (-1) or down (+1). @param {PoolRow[]} rows @param {number} i @param {-1 | 1} by */
export function movedRow(rows, i, by) {
  const to = i + by;
  if (!rows[i] || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
}
/** The last row stays: a session with no seat could run nobody. @param {PoolRow[]} rows @param {number} i */
export const withoutRow = (rows, i) => (rows.length > 1 && rows[i] ? rows.filter((_, k) => k !== i) : rows);
/**
 * Why a model cannot be added, or null: the list is full, or already has it.
 * @param {PoolRow[]} rows @param {string} model  "" for the main agent's
 */
export function addProblem(rows, model) {
  if (rows.length >= POOL_ROWS) return `A pool holds at most ${POOL_ROWS} models`;
  const name = nameOf(model);
  return rows.some((r) => r.model === name) ? `${name ? prettyModel(name) : MAIN_ROW} is already in the list: move its row up` : null;
}
/** A model added at the end of the order. @param {PoolRow[]} rows @param {string} model */
export const withRow = (rows, model) => (addProblem(rows, model) ? rows : [...rows, { model: nameOf(model), seats: Infinity }]);
/**
 * A row's effort changed: a level, "model" its model's own, "" the default — the main agent's.
 * @param {PoolRow[]} rows @param {number} i @param {string} level
 */
export function withEffort(rows, i, level) {
  const r = rows[i];
  const e = effortOf(level).effort || "";
  if (!r || (r.effort || "") === e) return rows;
  return rows.map((x, k) => (k === i ? { model: x.model, seats: x.seats, ...effortOf(e) } : x));
}
/** A row's model changed for another the list does not hold, its effort kept. @param {PoolRow[]} rows @param {number} i @param {string} model */
export function withModel(rows, i, model) {
  const name = nameOf(model);
  return rows[i] && rows[i].model !== name && !rows.some((r) => r.model === name) ? rows.map((r, k) => (k === i ? { ...r, model: name } : r)) : rows;
}

// ---- a row's words ------------------------------------------------------------------------------------------------------

/** "$0.60" · "$15". @param {number} n */
const usd = (n) => `$${n >= 10 ? Math.round(n) : Number(n.toFixed(2)).toString()}`;
/** A model's price per million tokens, or "" where no card prices it. @param {SeatFacts["price"] | undefined} p */
export const priceWords = (p) => (p && (p.input || p.output) ? `${usd(p.input)} in · ${usd(p.output)} out` : "");

/**
 * The line under a row, or null: why it cannot run (the warning tone); that its model is full across your chats and the
 * next on the list takes the agent; or why it takes fewer now — its provider said too many.
 * @param {SeatFacts | null | undefined} f
 * @returns {{ text: string, tone: "warn" | "info" } | null}
 */
export function rowNote(f) {
  if (!f) return null;
  if (f.problem) return { text: `${sentenceOf(f.problem)}: skipped until it can run`, tone: "warn" };
  const s = f.shared;
  if (s && s.cap != null && s.running >= s.cap) return { text: `All ${s.cap} at a time on this model are busy across your chats: the next on the list takes the agent`, tone: "info" };
  if (f.lends) return { text: sentenceOf(f.lends), tone: "info" };
  return null;
}
/** A reason with its first letter raised and no full stop. @param {string} s */
const sentenceOf = (s) => {
  const t = String(s || "").trim().replace(/\.$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

// ---- one per model family (AG-241) ----------------------------------------------------------------------------------------

/**
 * The pool's models by family, in its order: the first model of each maker, the main agent's for the nameless row.
 * A model whose maker the page does not know is a family of its own.
 * @param {PoolRow[]} rows @param {string} [main]
 * @returns {{ family: string, model: string }[]}
 */
export function poolFamilies(rows, main = "") {
  /** @type {{ family: string, model: string }[]} */
  const out = [];
  for (const r of rows) {
    const model = r.model || nameOf(main);
    if (!model) continue;
    const v = vendorOf(model);
    const family = v.key === "other" ? `other:${model.toLowerCase()}` : v.key;
    if (!out.some((f) => f.family === family)) out.push({ family, model });
  }
  return out;
}

/**
 * Where an agent's model came from, for the line beside it, and what its launch passed, or null for a model of its
 * own: `seat` is the server's (`{ pooled, named, skipped }`). Only a model a row of the list named is said to be
 * from the pool: the row that names none is the main agent's model, which an agent ran on before there was a list.
 * @param {{ pooled?: boolean, named?: boolean, skipped?: { model: string, why: string }[] } | null | undefined} seat
 * @returns {{ from: string, skipped: string[] } | null}
 */
export function seatWords(seat) {
  if (!seat?.pooled) return null;
  return { from: seat.named ? "from the pool" : "", skipped: (seat.skipped || []).map((s) => `Skipped ${prettyModel(s.model)}: ${String(s.why || "").replace(/\.$/, "")}`) };
}
