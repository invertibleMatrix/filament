// @ts-check
// What a Dashboard and a Design are made of (HarnessV4_Artifacts_Plan E18 step 7, AF-D11): the agent writes their
// content as data — a Dashboard's tiles and the tables they read, a Design's screens and the style they share — which
// Filament's own pages draw. Pure: the content checked, in words that name what is wrong (AFC-124, AFC-139), as it is
// kept in one JSON file; and Filament's own numbers a Dashboard may name (AF-D12, AFC-128), each a feed with its
// columns.
import { VISUAL_SERIES } from "./visual-look.js";
import { columnsOf, fetchSecrets, sourcesOf } from "./dashboard-sources.js";
import { feedsFault } from "./space-feeds.js";
import { secretsOf } from "./app-secrets.js";
import { hooksOf } from "./app-hooks.js";
import { appToolsOf } from "./app-tools.js";

/**
 * The kinds of tile a Dashboard draws (AF-D11): a number, a bar or line chart, a table; and a status (HarnessV4_Space_Plan
 * S2) — one row's field as words, with its age and a tone.
 */
export const TILE_KINDS = Object.freeze(["number", "bar", "line", "table", "status"]);
/** Which row a status tile reads. */
export const STATUS_ROWS = Object.freeze(["first", "last"]);
/** How a number tile reads a column of its rows; `sum` when it names none. */
export const NUMBER_OF = Object.freeze(["sum", "mean", "last", "max", "min", "count"]);
/**
 * The formats a tile shows a value in (AFC-126), and a feed's columns are in: a plain number when it names none; a day
 * (`2026-10-16`), a moment, and words as written besides.
 */
export const FORMATS = Object.freeze(["number", "usd", "percent", "tokens", "ms", "seconds", "tps", "date", "time", "text"]);
/** The most columns a chart draws, a color each: the look's series. */
export const SERIES_MAX = VISUAL_SERIES;
/** The days a feed by day reads when its tile names none, and the most it reads. */
export const FEED_DAYS = 30;
export const FEED_DAYS_MAX = 400;
/** A table's name: letters, digits, - and _. */
const TABLE_NAME = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * @typedef {{ words: string, days: boolean, columns: readonly (readonly [string, string])[] }} Feed  one of Filament's
 *   numbers: what it is in words, whether a tile gives it `days`, and its columns, each with the format it is shown in
 */

/**
 * Filament's own numbers a Dashboard may read (AF-D12, your yes of 10-16), each read-only, by its name in a tile's
 * `from`: the model calls of every tool and the harness's — memory's own aside — by day and by model, kept for 400
 * days; the last hour by minute; the calls in flight now, each with its tokens per second; and the developer's
 * sessions by the day they began, with the turns of each day.
 * @type {Readonly<Record<string, Feed>>}
 */
export const FEEDS = Object.freeze({
  "usage-by-day": {
    words: "usage by day",
    days: true,
    columns: [
      ["day", "date"], ["requests", "number"], ["errors", "number"], ["input", "tokens"], ["output", "tokens"],
      ["cacheRead", "tokens"], ["cacheWrite", "tokens"], ["tokens", "tokens"], ["cost", "usd"], ["listCost", "usd"],
      ["cacheHitRate", "percent"], ["tps", "tps"], ["firstByteMs", "ms"],
    ],
  },
  "usage-by-model": {
    words: "usage by model",
    days: true,
    columns: [
      ["model", "text"], ["upstream", "text"], ["requests", "number"], ["errors", "number"], ["output", "tokens"],
      ["tokens", "tokens"], ["cost", "usd"], ["tps", "tps"], ["firstByteMs", "ms"],
    ],
  },
  "usage-by-minute": {
    words: "usage by minute",
    days: false,
    columns: [["minute", "time"], ["requests", "number"], ["errors", "number"], ["input", "tokens"], ["output", "tokens"], ["firstByteMs", "ms"]],
  },
  "calls-now": {
    words: "calls now",
    days: false,
    columns: [["model", "text"], ["upstream", "text"], ["phase", "text"], ["seconds", "seconds"], ["output", "tokens"], ["tps", "tps"]],
  },
  "sessions-by-day": {
    words: "sessions by day",
    days: true,
    columns: [["day", "date"], ["sessions", "number"], ["turns", "number"]],
  },
});
/** The feeds' names, in their order. */
export const FEED_NAMES = Object.freeze(Object.keys(FEEDS));
/** Whether a name is one of Filament's feeds. @param {unknown} name */
export const isFeed = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(FEEDS, name);

/** Whether a value is a JSON object. @param {unknown} x @returns {x is Record<string, any>} */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";
/** A list in words: "a, b or c". @param {readonly string[]} xs @param {string} [last] */
const listWords = (xs, last = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs.at(-1)}`);

/**
 * @typedef {{ tiles: any[], tables: Record<string, Record<string, unknown>[]>, sources?: Record<string, any>, watch?: any[],
 *   actions?: Record<string, any>, lanes?: any, tasks?: any }} DashboardContent
 *   `sources` and `watch`: what it reads and watches by itself once kept in a Space (HarnessV4_Space_Plan S2); a table
 *   of a source's name holds that source's sample rows; `lanes` and `tasks`: what its sources' rows put on its Space's
 *   lanes and board once kept (S4c, core/space-feeds.js)
 * @typedef {{ title: string, size: string, height?: number, html: string }} Screen
 * @typedef {{ style: string, screens: Screen[] }} DesignContent
 */

/**
 * A Dashboard's content from a publish (AFC-122, AFC-124): its tiles and tables as given, the sources and watches it
 * reads by itself once kept (HarnessV4_Space_Plan S2) and the buttons on its tables' rows (S3), or what is wrong, in
 * words that name the tile by its place and title, or the source, the watch or the button. `reads`: the feeds its
 * tiles name, each once, in their order (AF-D12).
 * @param {any} input  the publish's `tiles`, `tables`, `sources`, `watch` and `actions`
 * @returns {{ ok: true, content: DashboardContent, reads: string[] } | { ok: false, error: string }}
 */
export function dashboardOf(input) {
  const tiles = input?.tiles;
  if (!Array.isArray(tiles) || !tiles.length)
    return { ok: false, error: `a dashboard needs tiles: a list of at least one — ${listWords([...TILE_KINDS])}` };
  const tables = input?.tables ?? {};
  if (!isObject(tables)) return { ok: false, error: 'tables is an object of named tables, each a list of rows: {"signups":[{"week":"W1","n":12}]}' };
  for (const [name, rows] of Object.entries(tables)) {
    if (!TABLE_NAME.test(name)) return { ok: false, error: `the table "${name}" needs a name of letters, digits, - and _ (40 at most)` };
    if (isFeed(name)) return { ok: false, error: `the table ${name} has the name of one of Filament's numbers: name it otherwise` };
    if (!Array.isArray(rows) || rows.some((r) => !isObject(r)))
      return { ok: false, error: `the table ${name} is a list of rows, each an object of its columns ({"week":"W1","n":12})` };
  }
  const own = sourcesOf(input);
  if (!own.ok) return own;
  const sources = own.sources || {};
  for (const name of Object.keys(sources))
    if (isFeed(name)) return { ok: false, error: `the source ${name} has the name of one of Filament's numbers: name it otherwise` };
  // A secret is an app's: a dashboard has none to fill a fetch with.
  const sealed = Object.entries(sources).find(([, s]) => fetchSecrets(s.fetch).length);
  if (sealed) return { ok: false, error: `the source ${sealed[0]} names a secret ({secret.${fetchSecrets(sealed[1].fetch)[0]}}): secrets are an app's — publish it as an app, with secrets` };
  /** @type {string[]} */
  const reads = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const title = isObject(t) && typeof t.title === "string" ? t.title.trim() : "";
    const fault = tileFault(t, tables, sources, own.actions || {});
    if (fault) return { ok: false, error: `tile ${i + 1}${title ? ` (${title})` : ""} ${fault}` };
    if (isFeed(t.from) && !reads.includes(t.from)) reads.push(t.from);
  }
  // What it feeds into its Space (S4c): a line on a lane per branch, a card on the board per row — of its own sources.
  const feeds = feedsFault(input, sources, tables);
  if (feeds) return { ok: false, error: feeds };
  return {
    ok: true,
    content: {
      tiles,
      tables,
      ...(own.sources ? { sources: own.sources } : {}),
      ...(own.watch ? { watch: own.watch } : {}),
      ...(own.actions ? { actions: own.actions } : {}),
      ...(input?.lanes != null ? { lanes: input.lanes } : {}),
      ...(input?.tasks != null ? { tasks: input.tasks } : {}),
    },
    reads,
  };
}

/**
 * An App's content from a publish: the sources, watches and buttons beside its own page (the owner's of 10-29), as a
 * Dashboard's are checked, or what is wrong, in words. Its page draws what they read; Filament's own numbers are a
 * Dashboard's alone.
 * `howto` and `state` (the Space Apps plan of 10-29) are its builder's words for the agents that use it — how its
 * buttons go together, and what each source or collection means —: words, so no part of a Keep. `secrets`: the
 * secrets its commands are handed, each with a line on what it is for — their names are part of a Keep, their values
 * typed in Filament's sheet (core/app-secrets.js). `hooks`: the collections a POST from this computer lands in, each
 * with a line on what sends there — their names are part of a Keep, which gives each its address (core/app-hooks.js).
 * `tools`: the commands it offers its Space's agents, each with its arguments — part of a Keep (core/app-tools.js).
 * `glance`: up to `GLANCE_MAX` status lines over its own sources, each a status tile's (`kind` "status" kept with it),
 * which Home's At a glance shows once switched on — words, so no part of a Keep, as a dashboard's tiles are not.
 * @param {any} input  the publish's `sources`, `watch`, `actions`, `howto`, `state`, `secrets`, `hooks` and `glance`
 * @returns {{ ok: true, content: { sources?: Record<string, any>, watch?: any[], actions?: Record<string, any>, howto?: string, state?: Record<string, string>, secrets?: Record<string, string>, hooks?: Record<string, string>, glance?: Record<string, any>[] } } | { ok: false, error: string }}
 */
export function appOf(input) {
  const own = sourcesOf(input);
  if (!own.ok) return own;
  for (const name of Object.keys(own.sources || {}))
    if (isFeed(name)) return { ok: false, error: `the source ${name} has the name of one of Filament's numbers: name it otherwise` };
  const howto = input?.howto == null ? null : typeof input.howto === "string" ? input.howto.trim() : undefined;
  if (howto === undefined || (howto != null && (!howto || howto.length > HOWTO_MAX)))
    return { ok: false, error: `howto is a few lines for the agents that use it, ${HOWTO_MAX} characters at most ("To ship: press Test & build; once it is green, Install")` };
  /** @type {Record<string, string> | null} */
  let state = null;
  if (input?.state != null) {
    const s = input.state;
    if (!isObject(s) || !Object.keys(s).length || Object.keys(s).length > STATE_MAX)
      return { ok: false, error: `state is an object of each source or collection an agent reads and a line on what it means, ${STATE_MAX} at most: {"runs":"CI's runs, the newest first"}` };
    for (const [k, v] of Object.entries(s)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return { ok: false, error: `state names ${JSON.stringify(k.slice(0, 40))}: a source's or a collection's name, of letters, digits, - and _` };
      if (typeof v !== "string" || !v.trim() || v.length > STATE_LINE_MAX) return { ok: false, error: `state's ${k} is no line: what it means, ${STATE_LINE_MAX} characters at most` };
    }
    state = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v).trim()]));
  }
  const secrets = secretsOf(input?.secrets);
  if (!secrets.ok) return secrets;
  // A fetch fills only the secrets its app declares (more reads, 10-29): the person typed those, and keeps their names.
  for (const [name, s] of Object.entries(own.sources || {})) {
    const odd = fetchSecrets(s.fetch).find((n) => !Object.prototype.hasOwnProperty.call(secrets.secrets || {}, n));
    if (odd) return { ok: false, error: `the source ${name} names {secret.${odd}}, which secrets does not declare: add it there with a line on what it is for` };
  }
  const hooks = hooksOf(input?.hooks);
  if (!hooks.ok) return hooks;
  // Its tools (the owner's of 11-05): what it offers its Space's agents, which they list and run through the space tool.
  const tools = appToolsOf(input?.tools);
  if (!tools.ok) return tools;
  // Its glance (phase 3): a few status lines over its own sources, which Home's At a glance shows once switched on.
  /** @type {Record<string, any>[] | null} */
  let glance = null;
  if (input?.glance != null) {
    const g = input.glance;
    const sources = own.sources || {};
    if (!Array.isArray(g) || !g.length || g.length > GLANCE_MAX)
      return { ok: false, error: `glance is a list of status lines over its own sources, ${GLANCE_MAX} at most: [{"title":"CI","from":"runs","field":"conclusion","bad":{"conclusion":"failure"}}]` };
    glance = [];
    for (let i = 0; i < g.length; i++) {
      const t = isObject(g[i]) ? { ...g[i], kind: "status" } : g[i];
      const title = isObject(t) && typeof t.title === "string" ? t.title.trim() : "";
      const at = `glance's line ${i + 1}${title ? ` (${title})` : ""}`;
      if (isObject(t) && typeof t.from === "string" && !Object.prototype.hasOwnProperty.call(sources, t.from))
        return { ok: false, error: `${at} reads ${t.from}, which is none of its own sources${Object.keys(sources).length ? ` (${Object.keys(sources).join(", ")})` : ": an app with a glance reads a source"}` };
      const fault = tileFault(t, {}, sources);
      if (fault) return { ok: false, error: `${at} ${fault}` };
      glance.push(/** @type {Record<string, any>} */ (t));
    }
  }
  return {
    ok: true,
    content: {
      ...(own.sources ? { sources: own.sources } : {}),
      ...(own.watch ? { watch: own.watch } : {}),
      ...(own.actions ? { actions: own.actions } : {}),
      ...(howto ? { howto } : {}),
      ...(state ? { state } : {}),
      ...(secrets.secrets ? { secrets: secrets.secrets } : {}),
      ...(hooks.hooks ? { hooks: hooks.hooks } : {}),
      ...(tools.tools ? { tools: tools.tools } : {}),
      ...(glance ? { glance } : {}),
    },
  };
}
/** How many status lines an app's glance may hold. */
export const GLANCE_MAX = 4;
/** How long an app's `howto` may be, how many sources and collections its `state` says, and each one's line. */
export const HOWTO_MAX = 600;
export const STATE_MAX = 20;
export const STATE_LINE_MAX = 200;

/** What is wrong with a tile's format: one of the formats, or an object of a column's. @param {unknown} f */
function formatFault(f) {
  if (f == null) return "";
  const known = (/** @type {unknown} */ x) => typeof x === "string" && FORMATS.includes(x);
  if (typeof f === "string") return known(f) ? "" : `has the format ${JSON.stringify(f)}: give ${listWords([...FORMATS])}`;
  if (!isObject(f)) return "has a format that is neither a format's name nor an object of each column's";
  const bad = Object.entries(f).find(([, x]) => !known(x));
  return bad ? `has the format ${JSON.stringify(bad[1])} for ${bad[0]}: give ${listWords([...FORMATS])}` : "";
}

/**
 * What is wrong with one tile, as the words after its name; "" where nothing is.
 * @param {unknown} t @param {Record<string, Record<string, unknown>[]>} tables @param {Record<string, any>} [sources]
 * @param {Record<string, any>} [actions]  its buttons, by name
 */
function tileFault(t, tables, sources = {}, actions = {}) {
  if (!isObject(t)) return 'is no object: a tile is {"kind":"number","title":"Spent","value":120}';
  if (!TILE_KINDS.includes(t.kind)) return `${t.kind == null ? "has no kind" : `is a kind Filament does not draw (${JSON.stringify(t.kind)})`}: give ${listWords([...TILE_KINDS])}`;
  if (typeof t.title !== "string" || !t.title.trim()) return "has no title: a few words above it";
  if (t.note != null && typeof t.note !== "string") return "has a note that is no text";
  if (t.wide != null && typeof t.wide !== "boolean") return "has wide that is neither true nor false";
  const format = formatFault(t.format);
  if (format) return format;
  if (t.actions != null) {
    if (t.kind !== "table") return "has actions, which only a table tile takes: the buttons on its rows";
    const names = Object.keys(actions);
    if (!Array.isArray(t.actions) || t.actions.some((a) => typeof a !== "string")) return "has actions that are no list of its buttons' names";
    const gone = t.actions.find((a) => !Object.prototype.hasOwnProperty.call(actions, a));
    if (gone !== undefined) return `has the button ${gone}, which is none of the dashboard's actions${names.length ? ` (${names.join(", ")})` : ""}`;
    const other = t.actions.find((a) => actions[a].on !== t.from);
    if (other !== undefined) return `has the button ${other}, which acts on ${actions[other].on}, not on ${t.from}, the rows it shows`;
  }
  if (t.kind === "number" && t.from == null)
    return typeof t.value === "number" || typeof t.value === "string" ? "" : "has neither value nor from: a number tile shows value, or reads a column of a table by from and field";
  if (t.value != null) return t.kind === "number" ? "has value and from: a number tile shows one or the other" : "has value, which only a number tile shows";
  const tableNames = Object.keys(tables).filter((n) => !Object.prototype.hasOwnProperty.call(sources, n));
  const sourceNames = Object.keys(sources);
  const readable = `${sourceNames.length ? `its sources (${sourceNames.join(", ")}), ` : ""}${tableNames.length ? `the tables (${tableNames.join(", ")}) or ` : ""}Filament's numbers (${FEED_NAMES.join(", ")})`;
  if (typeof t.from !== "string" || !t.from) return `has no from: it reads one of ${readable}`;
  const feed = isFeed(t.from) ? FEEDS[t.from] : null;
  const source = Object.prototype.hasOwnProperty.call(sources, t.from) ? sources[t.from] : null;
  // A source's sample rows are the table of its name, where the agent gave one.
  const rows = Object.prototype.hasOwnProperty.call(tables, t.from) ? tables[t.from] : source ? [] : null;
  if (!feed && !rows) return `reads ${t.from}, which is none of ${readable}`;
  if (t.days != null) {
    const daily = FEED_NAMES.filter((n) => FEEDS[n].days);
    if (!feed?.days) return `has days, which only ${listWords(daily)} take`;
    if (!Number.isInteger(t.days) || t.days < 1 || t.days > FEED_DAYS_MAX) return `has days ${JSON.stringify(t.days)}: a whole number from 1 to ${FEED_DAYS_MAX}`;
  }
  // A source names its columns by its paths or its fields; one that does not has the columns of its sample rows.
  const named = source ? columnsOf(source) : null;
  const cols = feed ? feed.columns.map((c) => c[0]) : named || [...new Set((rows || []).flatMap((r) => Object.keys(r)))];
  // A table with no rows yet has no columns to check: its tile says it has none.
  const has = (/** @type {unknown} */ c) => typeof c === "string" && (cols.includes(c) || (!named && !!rows && !rows.length));
  const missing = (/** @type {unknown} */ c, /** @type {string} */ what) => `${what} ${JSON.stringify(c)}, which ${t.from} does not have: its columns are ${cols.join(", ")}`;
  if (t.kind === "status") {
    if (t.days != null) return "has days, which a status tile does not take";
    if (t.row != null && !STATUS_ROWS.includes(t.row)) return `reads the row ${JSON.stringify(t.row)}: give ${listWords([...STATUS_ROWS])}`;
    if (typeof t.field !== "string") return `has no field: the column of ${t.from} whose value it shows (${cols.join(", ")})`;
    if (!has(t.field)) return missing(t.field, "shows the field");
    if (t.words != null && (typeof t.words !== "string" || t.words.length > 200)) return 'has words that are no line of text: words under the value, with {column} for a value ("{message}")';
    if (t.age != null && !has(t.age)) return missing(t.age, "takes its age from");
    for (const tone of ["bad", "good"]) {
      const m = t[tone];
      if (m == null) continue;
      if (!isObject(m) || !Object.keys(m).length || Object.values(m).some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v)))
        return `has ${tone} that is no object of a column and its value: {"status":"failure"}`;
      const gone = Object.keys(m).find((c) => !has(c));
      if (gone) return missing(gone, `has ${tone} on`);
    }
    return "";
  }
  if (t.kind === "number") {
    const of = t.of ?? "sum";
    if (!NUMBER_OF.includes(of)) return `has of ${JSON.stringify(t.of)}: give ${listWords([...NUMBER_OF])}`;
    if (of === "count" && t.field == null) return "";
    if (typeof t.field !== "string") return `has no field: the column of ${t.from} it reads (${cols.join(", ")})`;
    return has(t.field) ? "" : missing(t.field, "reads the field");
  }
  if (t.kind === "table") {
    if (t.columns == null) return "";
    if (!Array.isArray(t.columns) || !t.columns.length || t.columns.some((c) => typeof c !== "string")) return "has columns that are no list of column names";
    const gone = t.columns.find((c) => !has(c));
    return gone === undefined ? "" : missing(gone, "shows the column");
  }
  if (typeof t.x !== "string") return `has no x: the column of ${t.from} ${t.kind === "bar" ? "its bars are named by" : "its line runs along"} (${cols.join(", ")})`;
  if (!has(t.x)) return missing(t.x, "has x");
  const ys = typeof t.y === "string" ? [t.y] : t.y;
  if (!Array.isArray(ys) || !ys.length || ys.some((y) => typeof y !== "string")) return `has no y: the column whose numbers it draws, or a list of up to ${SERIES_MAX}`;
  if (ys.length > SERIES_MAX) return `draws ${ys.length} columns: ${SERIES_MAX} at most, a color each`;
  const gone = ys.find((y) => !has(y));
  return gone === undefined ? "" : missing(gone, "has y");
}

/**
 * The feeds a kept Dashboard reads (AF-D12): those its tiles name, each once, in their order — what its address answers
 * its page, and what its view says it reads.
 * @param {unknown} content  the Dashboard's content, as kept
 */
export function feedsOf(content) {
  const tiles = isObject(content) && Array.isArray(content.tiles) ? content.tiles : [];
  return [...new Set(tiles.map((t) => (isObject(t) ? t.from : null)).filter(isFeed))];
}

/**
 * What a kept Dashboard's page reads of Filament's numbers (AFC-129, AFC-133): each feed a tile names with the days that
 * tile gives — none where it gives none, and the feed reads its own — each once, in their order. Its page asks for each
 * by `feedKey`, and a download keeps each under it.
 * @param {unknown} content
 * @returns {{ feed: string, days: number | null }[]}
 */
export function feedAsks(content) {
  const tiles = isObject(content) && Array.isArray(content.tiles) ? content.tiles : [];
  /** @type {Map<string, { feed: string, days: number | null }>} */
  const asks = new Map();
  for (const t of tiles) {
    if (!isObject(t) || !isFeed(t.from)) continue;
    const ask = { feed: t.from, days: Number.isInteger(t.days) ? t.days : null };
    asks.set(feedKey(ask), ask);
  }
  return [...asks.values()];
}
/** A feed asked for with its days, as one name: `usage-by-day:7`, or `calls-now`. @param {{ feed: string, days: number | null }} ask */
export const feedKey = ({ feed, days }) => (days == null ? feed : `${feed}:${days}`);

/**
 * The sizes a screen is drawn at (AFC-135): its width and the height it has when it names none, in CSS pixels — a
 * phone's, a tablet's held upright, a laptop's.
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
export const SCREEN_SIZES = Object.freeze({ phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] });
/** The size a screen is when it names none. */
export const SCREEN_SIZE = "desktop";
/** The least and the most height a screen may name: a dialog's, a long page's. */
export const SCREEN_HEIGHT_MIN = 120;
export const SCREEN_HEIGHT_MAX = 10000;

/**
 * A Design's content from a publish (AFC-135, AFC-139): the style its screens share and each screen — its title, size,
 * height where it names one, and its HTML — or what is wrong, in words that name the screen by its place and title.
 * @param {any} input  the publish's `screens` and `style`
 * @returns {{ ok: true, content: DesignContent } | { ok: false, error: string }}
 */
export function designOf(input) {
  const screens = input?.screens;
  if (!Array.isArray(screens) || !screens.length)
    return { ok: false, error: 'a design needs screens: a list of at least one, such as {"title":"Home","size":"phone","html":"<main>…</main>"}' };
  if (input.style != null && typeof input.style !== "string") return { ok: false, error: "style is the CSS every screen shares, as text" };
  const sizes = Object.entries(SCREEN_SIZES).map(([n, [w]]) => `${n} (${w} wide)`);
  /** @type {Screen[]} */
  const out = [];
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const title = isObject(s) && typeof s.title === "string" ? s.title.trim() : "";
    const which = `screen ${i + 1}${title ? ` (${title})` : ""}`;
    if (!isObject(s)) return { ok: false, error: `${which} is no object: a screen is {"title":"Home","size":"phone","html":"…"}` };
    if (!title) return { ok: false, error: `${which} has no title: a word or two above it (Home)` };
    const size = s.size ?? SCREEN_SIZE;
    if (typeof size !== "string" || !Object.prototype.hasOwnProperty.call(SCREEN_SIZES, size))
      return { ok: false, error: `${which} has the size ${JSON.stringify(s.size)}: give ${listWords(sizes)}` };
    if (s.height != null && (!Number.isInteger(s.height) || s.height < SCREEN_HEIGHT_MIN || s.height > SCREEN_HEIGHT_MAX))
      return { ok: false, error: `${which} has the height ${JSON.stringify(s.height)}: a whole number of pixels from ${SCREEN_HEIGHT_MIN} to ${SCREEN_HEIGHT_MAX}, or none for its size's (${SCREEN_SIZES[size][1]})` };
    if (typeof s.html !== "string" || !s.html.trim()) return { ok: false, error: `${which} has no html: the screen, a whole HTML document or what goes inside its <body>` };
    out.push({ title, size, ...(s.height != null ? { height: s.height } : {}), html: s.html });
  }
  return { ok: true, content: { style: typeof input.style === "string" ? input.style : "", screens: out } };
}

/** A screen's size in words, as its label and the agent read it: "phone, 390 × 844". @param {Screen} s */
export const screenWords = (s) => `${s.size}, ${SCREEN_SIZES[s.size]?.[0] ?? "?"} × ${s.height ?? SCREEN_SIZES[s.size]?.[1] ?? "?"}`;
