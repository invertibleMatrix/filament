// @ts-check
// A Dashboard (HarnessV4_Artifacts_Plan E18 step 7, AF-D11, AFC-122..AFC-134): the agent's tiles, drawn in the
// harness's look from the tables they read — large numbers, bar and line charts, tables — in rows, in the order
// written, whose lines fill: one tile a line in a narrow pane, up to four numbers or two charts on a whole screen, a
// wide tile a row alone. A tile that reads one of Filament's own numbers (AF-D12) asks the Dashboard's own address for
// it, which answers only the feeds its tiles name (AFC-130), and reads it again each time Filament says it changed
// (AFC-131); its header says what it reads and when it last read it. Opened
// from its download, it shows the numbers as they were kept, and says when (AFC-133). A card's still preview reads
// once and follows nothing. A tile that reads one of its own sources (HarnessV4_Space_Plan S2) asks its address for
// the rows Filament's command read, where this version is kept in a project's Space — at once, at the source's every
// while the page is seen, and each time Filament says it read it again; a source that could not be read keeps its last
// rows, marked with their time. Not kept, it draws the rows the agent read, and says so. A status tile shows one row's
// value as words, with its age and its tone. A table of its own source's rows (S3) gives each row the buttons its
// tile names — which only ask: the harness draws Filament's sheet, in its Space's tab alone — off, each saying why, where
// they may not press; and a ⋯ with Ask an agent about this… and Copy row.
import { setHtml } from "../lib/dom.js";
import { FILL_MARK, LEAVE_MARK, framed, fullScreen, pageContent, part, still, tell } from "./type-page.js";
import { barChart, formatValue, lineChart, numberOf } from "./charts.js";

/** Filament's numbers a tile may read, in words (core's FEEDS). */
export const FEED_WORDS = Object.freeze({
  "usage-by-day": "usage by day",
  "usage-by-model": "usage by model",
  "usage-by-minute": "usage by minute",
  "calls-now": "calls now",
  "sessions-by-day": "sessions by day",
});
/** Whether a tile's `from` is one of Filament's numbers. @param {unknown} from */
const isFeedName = (from) => typeof from === "string" && Object.prototype.hasOwnProperty.call(FEED_WORDS, from);

/**
 * What a Dashboard reads of Filament's numbers (core's feedAsks): each feed a tile names, with its days, each once.
 * @param {any} content @returns {{ feed: string, days: number | null }[]}
 */
export function feedAsks(content) {
  /** @type {Map<string, { feed: string, days: number | null }>} */
  const asks = new Map();
  for (const t of Array.isArray(content?.tiles) ? content.tiles : []) {
    if (!isFeedName(t?.from)) continue;
    const ask = { feed: t.from, days: Number.isInteger(t.days) ? t.days : null };
    asks.set(feedKey(ask), ask);
  }
  return [...asks.values()];
}
/** A feed with its days as one name (core's feedKey). @param {{ feed: string, days: number | null }} ask */
export const feedKey = ({ feed, days }) => (days == null ? feed : `${feed}:${days}`);

/**
 * @typedef {{ rows: Record<string, unknown>[], columns: Map<string, string> | null, error?: string, reading?: boolean,
 *   asOf?: number, at?: number, held?: string }} Source  a table a tile reads: its rows, each column's own format where it
 *   has one (a feed's), or why it has none; where its last read failed, or it waits for the person's Keep (`held`, why),
 *   when its rows were read; `at`, when they were
 */

/** The key that names a source's row (core's ROW_KEY): no column a table shows. */
const ROW_KEY = "__key";

/**
 * The source a tile reads, by name: one of the dashboard's own sources, one of its tables, or a feed with its days.
 * @param {any} t @param {Set<string>} own  the names of its own sources
 */
const sourceOf = (t, own) =>
  isFeedName(t.from) ? feedKey({ feed: t.from, days: Number.isInteger(t.days) ? t.days : null }) : own.has(t.from) ? `source:${t.from}` : `table:${t.from}`;

/**
 * A moment as the header says it, on the 24-hour clock the harness around it says (found at E35 S5a's live look: "read
 * 12:50:19 AM" in a Space whose own lines said "00:49"). @param {number} at @param {boolean} [day]
 */
const momentWords = (at, day) =>
  new Date(at).toLocaleString("en-US", day ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** A moment as "as of" says it: its time today, else its day too. @param {number} at */
const asOfWords = (at) =>
  new Date(at).toDateString() === new Date().toDateString() ? new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : momentWords(at, true);

/**
 * A row's moment in ms, written whole or as a count of seconds or of ms; null where it is no moment.
 * @param {unknown} v
 */
export function momentOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v !== "string" || !v.trim()) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return momentOf(Number(v));
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : at;
}
/** How long ago a moment was: "just now", "12 min ago", "3 h ago", "Oct 22". @param {number} at @param {number} now */
export function agoWords(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** A moment written whole, to the minute: "2026-10-24T12:00:00Z", "2026-10-24 12:00". */
const WRITTEN_MOMENT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
/**
 * A table's moment as people say it (the mock's screen 8): "just now", "12 min ago", "2 h ago", "14:05" earlier today,
 * "Yesterday 18:20", "Oct 22 11:05"; null where the value is no moment written whole.
 * @param {unknown} v @param {number} now
 */
export function cellMoment(v, now) {
  if (typeof v !== "string" || !WRITTEN_MOMENT.test(v.trim())) return null;
  const at = Date.parse(v.trim());
  if (!Number.isFinite(at)) return null;
  const clock = new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const s = Math.round((now - at) / 1000);
  if (s >= 0 && s < 6 * 3600) return agoWords(at, now);
  const day = new Date(at).toDateString();
  if (day === new Date(now).toDateString()) return clock;
  // The calendar's yesterday, which a night the clocks change makes 23 or 25 hours long.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toDateString()) return `Yesterday ${clock}`;
  return `${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock}`;
}
/**
 * A column that names a thing by its number — a run, a PR, an id —, shown as written: "8812", not "8,812". `runId` and
 * `run_id` are; `paid` and `valid` are not (found by the Hunter on the mock pass: the i flag made every "…id" an id).
 * @param {string} col
 */
const idColumn = (col) => /^(id|run|number|no|pr|issue|build|pid|job|#)$|_id$/i.test(col) || /[a-z0-9](Id|ID)$/.test(col);
/** Whether a row is one a tone names: each of its columns equal. @param {Record<string, unknown>} row @param {unknown} match */
const isTone = (row, match) =>
  !!match && typeof match === "object" && Object.entries(match).every(([c, v]) => row[c] === v || (row[c] != null && v != null && String(row[c]) === String(v)));
/** Words with a row's values in them: {column} each. @param {string} words @param {Record<string, unknown>} row */
export const wordsOf = (words, row) => words.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, c) => (row[c] == null ? "—" : String(row[c])));
/** Words joined: "a, b and c". @param {string[]} xs */
const joined = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * @typedef {{ actions: Record<string, any>, off: string | null, title: string }} Press  what a table of its own source's
 *   rows presses: its dashboard's buttons, why they are off where they are, the dashboard's title
 */
/** Whether a button is on a row: each column of its `only` equal, not each of its `except` (core's actionOnRow). @param {any} a @param {Record<string, unknown>} r */
export const onRow = (a, r) => (!a?.only || isTone(r, a.only)) && (!a?.except || !isTone(r, a.except));
/**
 * Why a dashboard's buttons are off where its page is, in their tooltip's words; null where they press: in its Space's
 * tab, kept, unpaused, this version live.
 * @param {{ shown: boolean, live: boolean, inSpace: boolean, off?: unknown }} o  `shown`: in the harness's frame, not
 *   a download or a page alone; `off`: why it does not read, as Filament says ("draft", "paused")
 */
export function pressOff({ shown, live, inSpace, off }) {
  if (!shown) return "Press it in its Space's tab: Filament asks there first";
  if (!live) return off === "paused" ? "It is paused: resume it to press its buttons" : "Keep it first: its buttons run once it is kept";
  return inSpace ? null : "Press it in its Space's tab: Filament asks there first";
}
/** A row in words, each column it shows: what Copy row copies and Ask an agent about this… carries. @param {string[]} cols @param {Record<string, unknown>} r */
export const rowWords = (cols, r) => cols.map((c) => `${c}: ${r[c] == null || r[c] === "" ? "—" : String(r[c])}`);

/**
 * How a tile shows each column (AFC-126): the format it gives that column, or the one it gives its values — never over
 * a column of days, moments or words — or the column's own, or as written where it names a thing by its number (a
 * run, a PR), or a plain number.
 * @param {any} t @param {Map<string, string> | null} columns  each column's own format, where the source has them
 * @returns {(col: string) => string}
 */
const formatsOf = (t, columns) => (col) => {
  const own = columns?.get(col);
  if (t.format && typeof t.format === "object" && typeof t.format[col] === "string") return t.format[col];
  if (typeof t.format === "string" && own !== "date" && own !== "time" && own !== "text") return t.format;
  return own || (idColumn(col) ? "id" : "number");
};
/** How a chart shows the column its rows are named by: as a day, a moment, or as written. @param {string} format */
const xFormatOf = (format) => (format === "date" || format === "time" ? format : "text");

/** A number tile's value from its rows (AFC-123): `of` its field — sum, mean, last, max, min — or the rows' count. @param {any} t @param {Record<string, unknown>[]} rows */
function numberFrom(t, rows) {
  const of = t.of ?? "sum";
  if (of === "count") return rows.length;
  const values = rows.map((r) => numberOf(r[t.field])).filter((v) => v != null);
  if (!values.length) return null;
  if (of === "last") return /** @type {number} */ (values.at(-1));
  if (of === "max") return Math.max(...values);
  if (of === "min") return Math.min(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  return of === "mean" ? sum / values.length : sum;
}

/**
 * The tiles as rows, in the order written: a wide tile a row alone, and so a table with buttons on its rows, which
 * need the room (the mock's screen 8); a run of numbers one row, four a line at most on a wide page and two where there
 * is room; a run of charts and tables one row, two a line on a wide page. How many a line is as even as it goes — five
 * numbers go three and two — and a row's lines fill, so no tile leaves a hole beside it.
 * @param {any[]} tiles @returns {{ tiles: any[], wide: number, mid: number }[]}
 */
function rowsOf(tiles) {
  /** @type {{ kind: string, tiles: any[] }[]} */
  const runs = [];
  for (const t of tiles) {
    const kind = t.wide || (t.kind === "table" && Array.isArray(t.actions) && t.actions.length) ? "" : t.kind === "number" || t.kind === "status" ? "number" : "chart";
    const last = runs.at(-1);
    if (kind && last?.kind === kind) last.tiles.push(t);
    else runs.push({ kind, tiles: [t] });
  }
  /** How many a line for `n`, `most` at most, the lines as even as they go. @param {number} n @param {number} most */
  const perLine = (n, most) => Math.ceil(n / Math.ceil(n / most));
  return runs.map((r) => ({
    tiles: r.tiles,
    wide: perLine(r.tiles.length, r.kind === "number" ? 4 : r.kind ? 2 : 1),
    mid: perLine(r.tiles.length, r.kind === "number" ? 2 : 1),
  }));
}

function startDashboard() {
  const quiet = still();
  const data = pageContent();
  const content = data.content && typeof data.content === "object" ? data.content : { tiles: [], tables: {} };
  /** @type {any[]} */
  const tiles = Array.isArray(content.tiles) ? content.tiles : [];
  /** @type {Record<string, Record<string, unknown>[]>} */
  const tables = content.tables && typeof content.tables === "object" ? content.tables : {};
  const v = Number(data.v) || 0;
  /** @type {{ at: number, feeds: Record<string, any> } | null} */
  const kept = data.snapshot && typeof data.snapshot === "object" ? data.snapshot : null;
  // Its own address is http on this machine and https on the network's artifacts address (the owner's remote Filament
  // of 11-06, Part 4), where its feeds and sources sit under its path — Filament's small script says it (`data-base`).
  // A file opened alone is away.
  const away = location.protocol !== "http:" && location.protocol !== "https:";
  const base = document.querySelector("script[data-base]")?.getAttribute("data-base") || "";
  const asks = feedAsks(content);
  /** Its own sources, each a command Filament runs once it is kept in a project's Space. @type {Record<string, any>} */
  const own = content.sources && typeof content.sources === "object" ? content.sources : {};
  const ownNames = Object.keys(own);
  /** Whether this version reads its sources: kept in a Space, unpaused, its grant the one kept. */
  const live = !kept && !away && data.space?.live === true;
  /** Whether it is a tab of its Space, whose bar and cards say its sources' failures: its own line is left out. */
  const inSpace = !kept && new URLSearchParams(location.search).get("in") === "space";
  /** What a table of its own source's rows presses (S3). @type {Press} */
  const press = {
    actions: content.actions && typeof content.actions === "object" ? content.actions : {},
    off: pressOff({ shown: !kept && !away && !quiet && framed(), live, inSpace, off: data.space?.off }),
    title: String(data.title || ""),
  };

  const title = part("h1", "dash-title", data.title);
  const sub = part("p", "dash-sub");
  const fault = part("p", "dash-fault");
  fault.hidden = true;
  const head = part("header", "dash-head");
  const words = part("div", "dash-words");
  words.append(title);
  head.append(words);
  if (asks.length || ownNames.length) words.append(sub, fault);
  const grid = part("main", "dash-grid");
  document.body.append(head, grid);
  // A tab of its Space: the tab names it and its bar and foot say what it reads, so its own head stays out of sight
  // (the mock's screen 8); F still fills the screen.
  if (inSpace) document.body.classList.add("in-space");
  if (quiet) document.body.classList.add("is-still");
  else {
    const fill = /** @type {HTMLButtonElement} */ (part("button", "dash-btn"));
    fill.type = "button";
    const said = (/** @type {boolean} */ on) => {
      setHtml(fill, on ? LEAVE_MARK : FILL_MARK);
      fill.setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
      fill.title = `${on ? "Leave full screen" : "Full screen"} (F)`;
      document.body.classList.toggle("is-full", on);
    };
    const screen = fullScreen(said);
    said(false);
    fill.addEventListener("click", () => screen.set(!screen.on()));
    head.append(fill);
    addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "f" && e.key !== "F")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      screen.set(!screen.on());
    });
  }

  /** @type {Map<string, Source>} */
  const sources = new Map();
  for (const [name, rows] of Object.entries(tables)) sources.set(`table:${name}`, { rows: Array.isArray(rows) ? rows : [], columns: null });
  // A source's rows: read by Filament where it is live, else the table of its name, the rows the agent read.
  const ownSet = new Set(ownNames);
  for (const name of ownNames)
    sources.set(`source:${name}`, live ? { rows: [], columns: null, reading: true } : { rows: Array.isArray(tables[name]) ? tables[name] : [], columns: null });

  /** Each tile's element and how it draws, by the source it reads. @type {{ from: string, draw: () => void }[]} */
  const drawn = [];
  const placed = rowsOf(tiles).flatMap((r) => {
    const row = part("div", "dash-row");
    row.style.setProperty("--wide", String(r.wide));
    row.style.setProperty("--mid", String(r.mid));
    grid.append(row);
    return r.tiles.map((t) => ({ t, row }));
  });
  placed.forEach(({ t, row }) => {
    const el = part("section", "tile");
    const body = part("div", "tile-body");
    el.append(part("h2", "tile-title", String(t.title ?? "")), body);
    if (t.note) el.append(part("p", "tile-note", String(t.note)));
    row.append(el);
    const from = t.kind === "number" && t.from == null ? "" : sourceOf(t, ownSet);
    // A table of its own source's rows has its buttons and each row's ⋯; a card's still preview has neither.
    const rowsPress = t.kind === "table" && ownSet.has(t.from) && !quiet ? press : null;
    const draw = () => drawTile(t, body, from ? sources.get(from) : undefined, rowsPress);
    drawn.push({ from, draw });
    if (t.kind === "bar" || t.kind === "line") {
      let width = 0;
      new ResizeObserver(() => {
        if (body.clientWidth === width) return;
        width = body.clientWidth;
        draw();
      }).observe(body);
    } else draw();
  });
  /** Draw again the tiles that read a source. @param {string} key */
  const redraw = (key) => drawn.filter((d) => d.from === key).forEach((d) => d.draw());

  // Filament's numbers: kept in a download, read on its address, or neither.
  let readAt = 0;
  let following = "";
  /** When its own sources were last read, and each one's failure in words. */
  let ownAt = 0;
  /** @type {Map<string, string>} */
  const faults = new Map();
  const sayRead = () => {
    /** @type {string[]} */
    const said = [];
    if (asks.length) {
      const what = `Filament's ${joined(asks.map((a) => FEED_WORDS[/** @type {keyof typeof FEED_WORDS} */ (a.feed)]).filter((w, i, all) => all.indexOf(w) === i))}`;
      if (kept) said.push(`${what}, as of ${momentWords(kept.at, true)}: kept in this file`);
      else if (away) said.push(`${what}: read at this dashboard's address, while Filament runs`);
      else said.push(`Reads ${what}${readAt ? ` · read ${momentWords(readAt)}` : ""}`);
    }
    if (ownNames.length) {
      if (live) said.push(`Reads ${joined(ownNames)} by itself${ownAt ? ` · read ${momentWords(ownAt)}` : ""}`);
      else said.push(`Sample rows of ${joined(ownNames)} the agent read · ${data.space?.why || "nothing reads until it is kept in a project's Space"}`);
    }
    if (following) said.push(following);
    sub.textContent = said.join(" · ");
    fault.textContent = [...faults.values()].join(" ");
    fault.hidden = inSpace || !faults.size;
  };
  /** @type {Set<string>} */
  const reading = new Set();
  /** @type {Set<string>} */
  const again = new Set();
  /** Read one feed now, once at a time: a change heard while it reads reads it again after. @param {{ feed: string, days: number | null }} ask */
  const read = async (ask) => {
    const key = feedKey(ask);
    if (reading.has(key)) {
      again.add(key);
      return;
    }
    reading.add(key);
    const q = new URLSearchParams({ v: String(v) });
    if (ask.days != null) q.set("days", String(ask.days));
    /** @type {Source} */
    let got;
    try {
      const r = await fetch(`${base}/_filament/feeds/${encodeURIComponent(ask.feed)}?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Filament answered ${r.status}`);
      got = { rows: Array.isArray(j.rows) ? j.rows : [], columns: new Map((j.columns || []).map((/** @type {any} */ c) => [String(c.name), String(c.format)])) };
      readAt = Number(j.at) || Date.now();
    } catch (/** @type {any} */ e) {
      got = { ...(sources.get(key) || { rows: [], columns: null }), error: `${FEED_WORDS[/** @type {keyof typeof FEED_WORDS} */ (ask.feed)]} could not be read: ${String(e?.message || e).replace(/\.$/, "")}.` };
    }
    reading.delete(key);
    sources.set(key, got);
    sayRead();
    redraw(key);
    if (again.delete(key)) void read(ask);
  };
  for (const ask of asks) {
    const key = feedKey(ask);
    if (kept) {
      const k = kept.feeds?.[key];
      sources.set(key, k?.ok ? { rows: k.rows, columns: new Map((k.columns || []).map((/** @type {any} */ c) => [String(c.name), String(c.format)])) } : { rows: [], columns: null, error: k?.error ? `${k.error}.` : "These numbers were not kept in this file." });
    } else if (away) sources.set(key, { rows: [], columns: null, error: "Filament's numbers are read at this dashboard's address, while Filament runs." });
    else {
      sources.set(key, { rows: [], columns: null, reading: true });
      void read(ask);
    }
    redraw(key);
  }
  sayRead();
  if (asks.length && !kept && !away && !quiet) {
    const stream = new EventSource(`${base}/_filament/feed-changes?v=${v}`);
    stream.onopen = () => {
      following = "following";
      sayRead();
    };
    stream.onerror = () => {
      following = stream.readyState === EventSource.CLOSED ? "not following: Filament did not answer" : "reconnecting";
      sayRead();
    };
    stream.onmessage = (e) => {
      let names = [];
      try {
        names = JSON.parse(e.data).feeds || [];
      } catch {
        return;
      }
      for (const ask of asks) if (names.includes(ask.feed)) void read(ask);
    };
  }

  // Its own sources, where this version is kept in a Space: each asked of Filament, which runs its command when its rows
  // are older than its every and else answers them as last read.
  if (!live || !ownNames.length) return;
  /** Read one source now, once at a time. @param {string} name */
  const readOwn = async (name) => {
    const key = `source:${name}`;
    if (reading.has(key)) {
      again.add(key);
      return;
    }
    reading.add(key);
    const had = sources.get(key) || { rows: [], columns: null };
    /** @type {Source} */
    let got;
    try {
      const r = await fetch(`${base}/_filament/sources/${encodeURIComponent(name)}?v=${v}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || `Filament answered ${r.status}`), { off: j.off });
      const at = Number(j.at) || 0;
      got = { rows: Array.isArray(j.rows) ? j.rows : [], columns: null, ...(at ? { at } : {}) };
      if (j.error) {
        got.asOf = at || undefined;
        if (!at) got.error = `Couldn't read ${name}: ${String(j.error).replace(/\.$/, "")}.`;
        faults.set(
          name,
          `Couldn't read ${name} at ${asOfWords(Number(j.errorAt) || Date.now())}: ${String(j.error).replace(/\.$/, "")}.${at ? ` Showing what it read at ${asOfWords(at)}.` : ""}${j.stopped ? ` It stopped after ${j.fails} failures in a row: read it again from its Space.` : ""}`,
        );
      } else faults.delete(name);
      if (at) ownAt = Math.max(ownAt, at);
    } catch (/** @type {any} */ e) {
      const said = String(e?.message || e).replace(/\.$/, "");
      // Held — a script it runs waits for the person's Keep —: no failure; its Space's bar says it and offers Keep….
      // What it read before stands as read then, its buttons off until then (found by the review of 10-31).
      const held = e?.off === "held";
      got = held
        ? { ...had, reading: false, held: `${said}.`, ...(had.rows.length ? { asOf: had.asOf || had.at, error: undefined } : { error: `${said}.` }) }
        : { ...had, reading: false, held: undefined, error: had.rows.length ? undefined : `${name} could not be read: ${said}.` };
      if (held) faults.delete(name);
      else faults.set(name, `${name} could not be read: ${said}.`);
    }
    reading.delete(key);
    sources.set(key, got);
    sayRead();
    redraw(key);
    if (again.delete(key)) void readOwn(name);
  };
  for (const name of ownNames) void readOwn(name);
  if (quiet) return;
  // At each source's every while the page is seen, and as it is seen again.
  /** @type {Record<string, number>} */
  const every = data.space?.every && typeof data.space.every === "object" ? data.space.every : {};
  for (const name of ownNames) {
    const ms = Math.max(60_000, Number(every[name]) || 120_000);
    setInterval(() => {
      if (document.visibilityState !== "hidden") void readOwn(name);
    }, ms);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") for (const name of ownNames) void readOwn(name);
  });
  // Each time Filament read one again — a Refresh in the Space, a watch's look — its rows as now read.
  const stream = new EventSource(`${base}/_filament/source-changes?v=${v}`);
  stream.onmessage = (e) => {
    let source = "";
    try {
      source = String(JSON.parse(e.data).source || "");
    } catch {
      return;
    }
    if (ownSet.has(source)) void readOwn(source);
  };
}

/**
 * One tile, drawn from the source it reads (AFC-123..AFC-127): what it shows, or that it is being read, could not be,
 * or has no rows yet.
 * @param {any} t @param {HTMLElement} body @param {Source | undefined} src
 * @param {Press | null} [press]  a table of its own source's rows: its buttons
 */
function drawTile(t, body, src, press = null) {
  // A chart the keyboard reads keeps its row through a new read of its numbers.
  const kept = body.contains(document.activeElement) ? Number(body.dataset.key) || 0 : -1;
  body.replaceChildren();
  if (t.kind === "number" && t.from == null) {
    const v = t.value;
    body.append(part("p", "tile-number", typeof v === "number" ? formatValue(v, typeof t.format === "string" ? t.format : "number") : String(v ?? "—")));
    return;
  }
  if (!src) return void body.append(part("p", "tile-empty", `${t.from} is not there.`));
  if (src.error) body.append(part("p", "tile-error", src.error));
  if (src.reading && !src.rows.length) return void body.append(part("p", "tile-empty", "Reading…"));
  const rows = src.rows;
  const formatOf = formatsOf(t, src.columns);
  // Rows a failed read left, or that wait for the person's Keep: the time they were read, on top — and why, where they
  // wait, as no failure line says it (found by the review of 10-31) —, and what they draw faint.
  body.classList.toggle("is-stale", !!src.asOf);
  if (src.asOf) body.append(part("p", "tile-stale", `as of ${asOfWords(src.asOf)}${src.held ? " · waits for your Keep" : ""}`));
  if (t.kind === "status") return void statusOf(t, body, rows, formatOf);
  if (t.kind === "number") {
    const n = numberFrom(t, rows);
    body.prepend(part("p", "tile-number", n == null ? "—" : formatValue(n, t.of === "count" ? "number" : formatOf(t.field))));
    staleOnTop(body);
    return;
  }
  if (!rows.length) {
    if (!src.error) body.append(part("p", "tile-empty", "No rows yet."));
    return;
  }
  if (t.kind === "table") return void body.append(tableOf(t, rows, src.columns, formatOf, press, src.asOf, src.held));
  const ys = typeof t.y === "string" ? [t.y] : Array.isArray(t.y) ? t.y : [];
  const width = body.clientWidth;
  if (!width) return;
  const chartIn = { rows, x: String(t.x), ys, width, xFormat: xFormatOf(formatOf(t.x)), formatOf };
  const chart = t.kind === "bar" ? barChart(chartIn) : lineChart(chartIn);
  const box = part("div", "chart-box");
  setHtml(box, chart.svg);
  const tip = part("div", "chart-tip");
  tip.hidden = true;
  box.append(tip);
  if (ys.length > 1) {
    const legend = part("div", "chart-legend");
    ys.forEach((y, i) => {
      const item = part("span", "chart-key");
      item.append(part("i", `swatch series-${i + 1}`), document.createTextNode(y));
      legend.append(item);
    });
    body.append(legend);
  }
  body.append(box);
  const svg = /** @type {SVGSVGElement} */ (box.querySelector("svg"));
  /** The row under the pointer marked, and its values in the tip. @param {number} i @param {number} x @param {number} y */
  const point = (i, x, y) => {
    svg.classList.toggle("hovering", i >= 0);
    for (const e of Array.from(svg.querySelectorAll("[data-i]"))) e.classList.toggle("on", e.getAttribute("data-i") === String(i));
    tip.hidden = i < 0;
    if (i < 0) return;
    const r = rows[i];
    tip.replaceChildren(part("b", "", formatValue(r[t.x], chartIn.xFormat)));
    ys.forEach((col, s) => {
      const line = part("span", "chart-tip-line");
      line.append(part("i", `swatch series-${s + 1}`), document.createTextNode(`${ys.length > 1 ? `${col} ` : ""}${formatValue(r[col], formatOf(col))}`));
      tip.append(line);
    });
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(box.clientWidth - w, x + 12 + w > box.clientWidth ? x - w - 12 : x + 12))}px`;
    tip.style.top = `${Math.max(0, Math.min(box.clientHeight - tip.offsetHeight, y - 12))}px`;
  };
  svg.addEventListener("pointermove", (e) => {
    const at = svg.getBoundingClientRect();
    const x = e.clientX - at.left;
    const y = e.clientY - at.top;
    point(chart.at(x, y), x, y);
  });
  svg.addEventListener("pointerleave", () => point(-1, 0, 0));
  // The keyboard reads it too (AFC-123): Tab to the chart, then the arrows go from row to row.
  let key = -1;
  /** @param {number} i */
  const keyTo = (i) => {
    key = Math.max(0, Math.min(rows.length - 1, i));
    body.dataset.key = String(key);
    point(key, ...chart.spot(key));
  };
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", `${t.title}: ${rows.length} rows; the arrow keys read each`);
  svg.addEventListener("focus", () => keyTo(key < 0 ? 0 : key));
  svg.addEventListener("blur", () => point(-1, 0, 0));
  if (kept >= 0) {
    key = kept;
    svg.focus();
  }
  svg.addEventListener("keydown", (e) => {
    const back = chart.across ? "ArrowUp" : "ArrowLeft";
    const on = chart.across ? "ArrowDown" : "ArrowRight";
    if (e.key === back) keyTo(key - 1);
    else if (e.key === on) keyTo(key + 1);
    else if (e.key === "Home") keyTo(0);
    else if (e.key === "End") keyTo(rows.length - 1);
    else return;
    e.preventDefault();
  });
}

/**
 * A status tile (HarnessV4_Space_Plan S2): its row's value as words, large — the first row, or the last —, the words
 * under it with the row's values, how long ago its moment was, and its tone: bad red, good green, the value the word
 * that says it.
 * @param {any} t @param {HTMLElement} body @param {Record<string, unknown>[]} rows @param {(col: string) => string} formatOf
 */
function statusOf(t, body, rows, formatOf) {
  const row = t.row === "last" ? rows.at(-1) : rows[0];
  if (!row) return void (body.querySelector(".tile-error") || body.append(part("p", "tile-empty", "No rows yet.")));
  const value = row[t.field];
  const f = formatOf(t.field);
  const shown = value == null || value === "" ? "—" : f !== "text" && f !== "date" && f !== "time" && numberOf(value) != null ? formatValue(value, f) : String(value);
  const tone = isTone(row, t.bad) ? "bad" : isTone(row, t.good) ? "good" : "";
  const big = part("p", `tile-status${tone ? ` is-${tone}` : ""}`, shown);
  if (tone) big.setAttribute("aria-label", `${shown}, ${tone === "bad" ? "bad" : "good"}`);
  body.prepend(big);
  const at = t.age ? momentOf(row[t.age]) : null;
  const under = [typeof t.words === "string" ? wordsOf(t.words, row) : "", at != null ? agoWords(at, Date.now()) : ""].filter(Boolean).join(" · ");
  if (under) big.after(part("p", "tile-status-words", under));
  staleOnTop(body);
}
/** A tile's "as of" over what it draws, whatever drew first. @param {HTMLElement} body */
function staleOnTop(body) {
  const stale = body.querySelector(":scope > .tile-stale");
  if (stale) body.prepend(stale);
}

/**
 * A table tile (AFC-127): its columns, or every column the rows have, in their order; a number right-aligned in its
 * format. A table of its own source's rows (`press`) ends each row with its buttons and a ⋯.
 * @param {any} t @param {Record<string, unknown>[]} rows @param {Map<string, string> | null} columns
 * @param {(col: string) => string} formatOf @param {Press | null} [press] @param {number} [asOf]  where its last read
 *   failed, when its rows were read: its buttons are off until it is read again
 * @param {string} [held]  why its source waits for the person's Keep: its buttons are off until then
 */
function tableOf(t, rows, columns, formatOf, press = null, asOf = 0, held = "") {
  /** @type {string[]} */
  const cols = Array.isArray(t.columns) ? t.columns : columns ? [...columns.keys()] : [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== ROW_KEY);
  const table = part("table", "tile-table");
  const head = part("tr");
  for (const c of cols) head.append(part("th", "", c));
  if (press) {
    const th = part("th", "row-acts");
    th.setAttribute("aria-label", "Buttons");
    head.append(th);
  }
  const thead = part("thead");
  thead.append(head);
  const tbody = part("tbody");
  const now = Date.now();
  for (const r of rows) {
    const tr = part("tr");
    for (const c of cols) {
      const f = formatOf(c);
      const figure = f !== "text" && f !== "date" && f !== "time" && numberOf(r[c]) != null;
      // A moment written whole, in words unless the tile asks for it as written (the mock's screen 8); its own on hover.
      const moment = f !== "text" && f !== "time" ? cellMoment(r[c], now) : null;
      const td = part("td", figure ? "num" : "", moment ?? formatValue(r[c], figure ? f : f === "date" || f === "time" ? f : "text"));
      if (moment) td.title = String(r[c]);
      tr.append(td);
    }
    if (press) tr.append(rowActs(t, r, cols, press, asOf, held));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = part("div", "tile-table-wrap");
  wrap.append(table);
  return wrap;
}

/**
 * A row's buttons — those its tile names and its `only` / `except` allow — and its ⋯. A press only asks the harness,
 * which draws Filament's sheet; off, each says why in its tooltip.
 * @param {any} t @param {Record<string, unknown>} r @param {string[]} cols @param {Press} press @param {number} asOf
 * @param {string} [held]
 */
function rowActs(t, r, cols, press, asOf, held = "") {
  const td = part("td", "row-acts");
  const key = typeof r[ROW_KEY] === "string" ? r[ROW_KEY] : "";
  for (const name of Array.isArray(t.actions) ? t.actions : []) {
    const a = press.actions[name];
    if (!a || !onRow(a, r)) continue;
    const why =
      press.off ||
      held ||
      (asOf ? `Read it again first: these rows are ${Math.max(1, Math.round((Date.now() - asOf) / 60_000))} min old` : !key ? "This row has no key to name it to Filament" : "");
    const b = /** @type {HTMLButtonElement} */ (part("button", "row-act", String(a.label)));
    b.type = "button";
    b.title = why || "Filament's sheet shows what it runs; nothing runs before you press there";
    if (why) b.setAttribute("aria-disabled", "true");
    b.addEventListener("click", () => {
      if (!why) tell({ kind: "act", action: name, key });
    });
    td.append(b);
  }
  const more = /** @type {HTMLButtonElement} */ (part("button", "dash-btn row-more", "⋯"));
  more.type = "button";
  more.title = "More for this row";
  more.setAttribute("aria-label", "More for this row");
  more.setAttribute("aria-haspopup", "menu");
  more.addEventListener("click", () => rowMenu(more, t, r, cols, press));
  td.append(more);
  return td;
}

/**
 * A row's ⋯ (S3): Ask an agent about this… — its words into the harness's box, nothing sent — where the harness frames
 * the page, and Copy row. Esc, a click elsewhere or a choice closes it.
 * @param {HTMLElement} anchor @param {any} t @param {Record<string, unknown>} r @param {string[]} cols @param {Press} press
 */
function rowMenu(anchor, t, r, cols, press) {
  document.querySelector(".row-menu")?.remove();
  const words = rowWords(cols, r);
  const box = part("div", "row-menu");
  box.setAttribute("role", "menu");
  /** @param {Event} e */
  const outside = (e) => {
    if (!(e.target instanceof Node) || (!box.contains(e.target) && e.target !== anchor)) close(false);
  };
  /** @param {KeyboardEvent} e */
  const esc = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close(true);
  };
  /** @param {boolean} focus */
  const close = (focus) => {
    box.remove();
    removeEventListener("pointerdown", outside, true);
    removeEventListener("keydown", esc, true);
    if (focus) anchor.focus();
  };
  /** @param {string} label @param {(b: HTMLButtonElement) => void} fn */
  const item = (label, fn) => {
    const b = /** @type {HTMLButtonElement} */ (part("button", "", label));
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => fn(b));
    box.append(b);
  };
  if (framed())
    item("Ask an agent about this…", () => {
      close(true);
      tell({ kind: "ask", text: `About a row of “${t.title}” in the dashboard “${press.title}”: ${words.join(", ")}. ` });
    });
  item("Copy row", (b) => {
    void navigator.clipboard?.writeText(words.join("\n")).then(
      () => {
        b.textContent = "Copied";
        setTimeout(() => close(true), 600);
      },
      () => void (b.textContent = "Couldn't copy: the browser said no"),
    );
  });
  document.body.append(box);
  const at = anchor.getBoundingClientRect();
  box.style.top = `${Math.max(8, Math.min(innerHeight - box.offsetHeight - 8, at.bottom + 4))}px`;
  box.style.left = `${Math.max(8, at.right - box.offsetWidth)}px`;
  /** @type {HTMLElement | null} */ (box.querySelector("button"))?.focus();
  addEventListener("pointerdown", outside, true);
  addEventListener("keydown", esc, true);
}

startDashboard();
