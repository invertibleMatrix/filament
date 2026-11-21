// @ts-check
// What a kept dashboard feeds into its Space (HarnessV4_Space_Plan S4c, the mock's screen 1, pins 4 and 6): a line on
// the lane whose branch a row of one of its sources names — a pull request and its checks —, and a card on the board
// for each row of another — an issue. Both show rows Filament already reads for the dashboard (S2): nothing new runs,
// and nothing of a service is Filament's — the agent names the source, the columns and the words. They are layout, as
// tiles are (SG-D19): a version that changes only these is live at once, and Keep grants nothing for them.
import { columnsOf, matchesRow, rowKey } from "./dashboard-sources.js";

/** The most lines a lane shows from its Space's dashboards, and the most cards one dashboard puts on the board. */
export const LANE_LINES_MAX = 2;
export const FED_TASKS_MAX = 50;
/** A board column a fed card may stand in, by its row's value; Planned where none says. */
const FED_COLUMNS = /** @type {const} */ (["doing", "waits", "done"]);

/**
 * @typedef {{ from: string, branch: string, words: string, bad: Record<string, unknown> | null,
 *   good: Record<string, unknown> | null }} LaneFeed  a line per branch from a source's rows: the column holding the
 *   branch's name, its words with {column}s, when it is red or green
 * @typedef {{ from: string, title: string, line: string | null, column: string | null, doing: string[],
 *   waits: string[], done: string[] }} TaskFeed  a card per row of a source: the columns of its title and its line, and
 *   the column whose value says where it stands
 * @typedef {{ branch: string, words: string, tone: "bad" | "good" | "", key: string }} LaneLine  a row's line on the
 *   lane of its branch
 * @typedef {{ key: string, title: string, line: string, column: "planned" | "doing" | "waits" | "done",
 *   row: Record<string, unknown> }} FedCard  a row's card on the board, and the row (which buttons fit it)
 */

/** Whether a value is a JSON object. @param {unknown} x @returns {x is Record<string, any>} */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";
/** A placeholder in a feed's words: a column of its row. */
const PLACEHOLDER = /\{([A-Za-z0-9_-]+)\}/g;

/**
 * Words with a row's values in them, {column} each, as a status tile's words are (ui/artifacts/dashboard.js
 * `wordsOf`); a value cut at 80 characters.
 * @param {string} words @param {Record<string, unknown>} row
 */
export function feedWords(words, row) {
  return words.replace(PLACEHOLDER, (_, c) => {
    const v = row[c];
    const s = v == null || v === "" ? "—" : String(v);
    return s.length > 80 ? `${s.slice(0, 79)}…` : s;
  });
}

/**
 * What is wrong with a dashboard's `lanes` and `tasks`, in words that name the part; "" where nothing is. Each reads
 * one of the dashboard's own sources, by its columns — named by the source, else its sample rows' (`tables`), else
 * not checked.
 * @param {any} input  the publish's `lanes` and `tasks` @param {Record<string, any>} sources @param {Record<string, Record<string, unknown>[]>} tables
 */
export function feedsFault(input, sources, tables) {
  for (const part of /** @type {const} */ (["lanes", "tasks"])) {
    const f = input?.[part];
    if (f == null) continue;
    const example = part === "lanes"
      ? '{"from":"prs","branch":"branch","words":"PR #{number} {title} · checks {checks}","bad":{"checks":"failing"}}'
      : '{"from":"issues","title":"title","line":"labels","column":"state","doing":["In Progress"],"done":["Done"]}';
    if (!isObject(f)) return `${part} is no object: ${example}`;
    const names = Object.keys(sources);
    if (typeof f.from !== "string" || !Object.prototype.hasOwnProperty.call(sources, f.from))
      return `${part} reads ${f.from == null ? "nothing" : JSON.stringify(f.from)}: from names one of its sources${names.length ? ` (${names.join(", ")})` : ", and it has none"}`;
    const named = columnsOf(sources[f.from]);
    const sample = Object.prototype.hasOwnProperty.call(tables, f.from) ? tables[f.from] : [];
    const cols = named || [...new Set(sample.flatMap((r) => Object.keys(r)))];
    // A source that names no columns and has no sample rows is not checked: its rows say their own.
    const has = (/** @type {unknown} */ c) => typeof c === "string" && !!c && (cols.includes(c) || (!named && !sample.length));
    const missing = (/** @type {unknown} */ c, /** @type {string} */ what) => `${part} ${what} ${JSON.stringify(c)}, which ${f.from} does not have: its columns are ${cols.join(", ")}`;
    /** @param {string} key @param {string} what */
    const column = (key, what) => (typeof f[key] !== "string" || !f[key] ? `${part} has no ${key}: ${what}` : has(f[key]) ? "" : missing(f[key], `has ${key}`));
    if (part === "lanes") {
      const fault = column("branch", `the column of ${f.from} that holds a branch's name`);
      if (fault) return fault;
      if (typeof f.words !== "string" || !f.words.trim() || f.words.length > 200) return 'lanes has no words: the line a lane shows, 200 characters at most, with {column} for a value ("PR #{number} · checks {checks}")';
      const gone = [...f.words.matchAll(PLACEHOLDER)].map((m) => m[1]).find((c) => !has(c));
      if (gone) return missing(`{${gone}}`, "has in its words");
      for (const tone of ["bad", "good"]) {
        const m = f[tone];
        if (m == null) continue;
        if (!isObject(m) || !Object.keys(m).length || Object.values(m).some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v)))
          return `lanes has ${tone} that is no object of a column and its value: {"checks":"failing"}`;
        const off = Object.keys(m).find((c) => !has(c));
        if (off) return missing(off, `has ${tone} on`);
      }
      continue;
    }
    const fault = column("title", `the column of ${f.from} a card is titled by`);
    if (fault) return fault;
    if (f.line != null && !has(f.line)) return missing(f.line, "has line");
    const lists = FED_COLUMNS.filter((k) => f[k] != null);
    if (f.column != null && !has(f.column)) return missing(f.column, "has column");
    if (lists.length && f.column == null) return `tasks has ${lists.join(" and ")} but no column: the column of ${f.from} whose value says where a card stands`;
    for (const k of lists) {
      const into = k === "waits" ? "Waits" : k === "doing" ? "Doing" : "Done";
      if (!Array.isArray(f[k]) || !f[k].length || f[k].some((/** @type {unknown} */ v) => typeof v !== "string" && typeof v !== "number"))
        return `tasks has ${k} that is no list of the values that put a card in ${into}`;
      // An empty value would match every row whose column is empty: in Done, those rows left the board unsaid (found by
      // the Hunter on S4c).
      if (f[k].some((/** @type {string | number} */ v) => !String(v).trim()))
        return `tasks has ${k} with an empty value: each is a value of ${f.column} that puts a card in ${into}`;
    }
  }
  return "";
}

/** A feed's `lanes` as kept, or null. @param {any} f @returns {LaneFeed | null} */
export function laneFeedOf(f) {
  if (!isObject(f) || typeof f.from !== "string" || typeof f.branch !== "string" || typeof f.words !== "string") return null;
  return { from: f.from, branch: f.branch, words: f.words, bad: isObject(f.bad) ? f.bad : null, good: isObject(f.good) ? f.good : null };
}

/** A feed's `tasks` as kept, or null. @param {any} f @returns {TaskFeed | null} */
export function taskFeedOf(f) {
  if (!isObject(f) || typeof f.from !== "string" || typeof f.title !== "string") return null;
  const list = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.map(String) : []);
  return {
    from: f.from,
    title: f.title,
    line: typeof f.line === "string" ? f.line : null,
    column: typeof f.column === "string" ? f.column : null,
    doing: list(f.doing),
    waits: list(f.waits),
    done: list(f.done),
  };
}

/**
 * The lines a source's rows put on lanes: the first row of each branch, in the source's order, red where `bad`
 * matches, green where `good` does.
 * @param {LaneFeed} f @param {Record<string, unknown>[]} rows
 * @returns {LaneLine[]}
 */
export function laneLines(f, rows) {
  /** @type {Map<string, LaneLine>} */
  const by = new Map();
  for (const r of rows) {
    const branch = r[f.branch] == null ? "" : String(r[f.branch]).trim();
    if (!branch || by.has(branch)) continue;
    const tone = f.bad && matchesRow(r, f.bad) ? "bad" : f.good && matchesRow(r, f.good) ? "good" : "";
    by.set(branch, { branch, words: feedWords(f.words, r), tone, key: rowKey(r) });
  }
  return [...by.values()];
}

/**
 * A row's moment in ms, written whole or as a count of seconds or of ms; null where it is no moment (the dashboard
 * page's `momentOf`, ui/artifacts/dashboard.js).
 * @param {unknown} v @returns {number | null}
 */
export function momentOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v !== "string" || !v.trim()) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return momentOf(Number(v));
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : at;
}

/**
 * @typedef {{ title: string, value: unknown, format: string, words: string, tone: "bad" | "good" | "", at: number | null }} StatusLine
 *   a status tile as Your Space's At a glance says it: its value as its row has it and the format its tab shows it in,
 *   the words under it, its tone, and its row's moment
 */

/**
 * A status tile's line from the rows Filament read (HarnessV4_Space_Plan S5b, S5-D7), as its tab says it
 * (ui/artifacts/dashboard.js `statusOf`): the first row, or the last; its field's value and format — the tile's own for
 * that column, or its one format, else a plain number —; its words with the row's values; red where `bad` matches,
 * green where `good` does; its age's moment. Null where there is no row.
 * @param {any} t @param {Record<string, unknown>[]} rows
 * @returns {StatusLine | null}
 */
export function statusLine(t, rows) {
  const row = t.row === "last" ? rows.at(-1) : rows[0];
  if (!row) return null;
  const field = String(t.field);
  const format = isObject(t.format) && typeof t.format[field] === "string" ? t.format[field] : typeof t.format === "string" ? t.format : "number";
  const tone = isObject(t.bad) && matchesRow(row, t.bad) ? "bad" : isObject(t.good) && matchesRow(row, t.good) ? "good" : "";
  return {
    title: String(t.title || ""),
    value: row[field] ?? null,
    format,
    words: typeof t.words === "string" ? feedWords(t.words, row) : "",
    tone,
    at: typeof t.age === "string" ? momentOf(row[t.age]) : null,
  };
}

/**
 * The cards a source's rows put on the board, `FED_TASKS_MAX` at most, in its order: each its title and line, in the
 * column its row's value names — Planned where none does; a value and the lists' compared as words, their spaces at
 * either end aside. A row its value marks done is no card (found by the Hunter on S4c): the board's Done is this
 * week's, and the service closed it at a moment Filament does not know — a month's closed issues filled "Done this
 * week" and, ahead of the open ones in the source's order, took the cards. `more`: the open rows past the most; `done`:
 * the rows kept off as done.
 * @param {TaskFeed} f @param {Record<string, unknown>[]} rows
 * @returns {{ cards: FedCard[], more: number, done: number }}
 */
export function taskCards(f, rows) {
  const titled = rows.filter((r) => r[f.title] != null && String(r[f.title]).trim());
  const lists = Object.fromEntries(FED_COLUMNS.map((k) => [k, f[k].map((v) => String(v).trim())]));
  /** @param {Record<string, unknown>} r */
  const where = (r) => {
    const v = f.column ? r[f.column] : null;
    if (v == null) return "planned";
    const s = String(v).trim();
    return /** @type {FedCard["column"]} */ (FED_COLUMNS.find((k) => lists[k].includes(s)) || "planned");
  };
  const placed = titled.map((r) => ({ r, column: where(r) }));
  const open = placed.filter((x) => x.column !== "done");
  const cards = open.slice(0, FED_TASKS_MAX).map(({ r, column }) => ({
    key: rowKey(r),
    title: String(r[f.title]).trim().slice(0, 200),
    line: f.line && r[f.line] != null ? String(r[f.line]).slice(0, 200) : "",
    column,
    row: r,
  }));
  return { cards, more: open.length - cards.length, done: placed.length - open.length };
}
