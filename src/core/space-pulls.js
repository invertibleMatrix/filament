// @ts-check
// A board's pull (the Space Apps plan of 10-29, decision 7): the issues of Linear, GitHub or Jira on a Space's board,
// read through a connector the project's chats have — a tool its server marks read-only, as an app's source reads one —,
// each row a card in the column its state maps to. A card moved on the board stands there while the service still says
// the state it had: the service wins once it says another. A move goes back to the service only when the person says
// so, once or always for that board, through a tool of the same connector, with the card's key and the state its
// column maps from. Pure: a pull checked in words that name its part, the cards a service's answer puts on the board,
// the guesses the Pull sheet starts from, a move's args. No AI reads or writes any of it.
import { TOOL_ARGS_BYTES, at } from "./dashboard-sources.js";
import { COLUMNS, COLUMN_WORDS, isColumn, weekStart } from "./space.js";

/** The services a pull reads, as the Pull sheet offers them; `other` is any connector, set up by hand. */
export const PULL_SERVICES = Object.freeze(/** @type {const} */ (["linear", "github", "jira", "other"]));
/** How much a pull holds: how many a Space keeps, a field's length, how many states its map names, moved cards kept. */
export const PULL_LIMITS = Object.freeze({ pulls: 6, title: 60, name: 128, path: 200, states: 40, state: 80, moved: 200, rows: 500 });
/** How often a pull is read again while its board is seen. */
export const PULL_EVERY_MS = 300_000;
/** The most cards one pull puts on the board, as a kept dashboard's feed (core/space-feeds.js FED_TASKS_MAX). */
export const PULL_CARDS_MAX = 50;

/**
 * @typedef {typeof PULL_SERVICES[number]} PullService
 * @typedef {import("./space.js").Column} Column
 * @typedef {{ tool: string, args: Record<string, unknown> }} PullBack  how a move goes back: a tool of the same connector,
 *   its args with "{key}" for the card's key, "{state}" for the state its column maps from and "{<name>}" for the
 *   pull's own arg of that name, each as a whole value
 * @typedef {{ column: Column, from: string, at: number }} PullMoved  a card moved on the board: its column, the state the
 *   service had for it then — it stands while the service says that one —, and when
 * @typedef {{ id: string, service: PullService, title: string, connection: string, tool: string,
 *   args: Record<string, unknown>, rows: string, key: string, name: string, state: string, url: string, line: string,
 *   columns: Record<string, Column>, back: PullBack | null, always: boolean, at: number,
 *   moved: Record<string, PullMoved> }} SpacePull  a pull as a Space keeps it: its service and the words it goes by, the
 *   connector and its read-only tool with its args, the paths in its answer — the list (`rows`), each item's key, title
 *   (`name`), state, link (`url`) and line —, the map of each state to a column, how a move goes back (none for Jira in
 *   v1), whether a move goes back without asking (`always`), when it was set up, the cards moved on the board
 * @typedef {{ key: string, title: string, state: string, url: string, line: string }} PullRow  an item of its answer
 * @typedef {{ key: string, title: string, state: string, url: string, line: string, column: Column, moved: boolean }} PullCard
 */

/**
 * What the Pull sheet starts from for each service: the tool that lists, its args, the paths in its answer, how a move
 * goes back. The connector is the project's whose name holds one of `match`. Each path is a guess the first Read once
 * checks: one its answer does not have is guessed again from what it has (`pullGuess`).
 */
export const PULL_PRESETS = Object.freeze([
  {
    service: "linear",
    title: "Linear",
    match: ["linear"],
    tool: "list_issues",
    args: { assignee: "me", limit: 50 },
    rows: "",
    key: "identifier",
    name: "title",
    state: "status",
    url: "url",
    line: "",
    back: { tool: "update_issue", args: { id: "{key}", state: "{state}" } },
  },
  {
    service: "github",
    title: "GitHub",
    match: ["github"],
    tool: "list_issues",
    args: { owner: "", repo: "", state: "OPEN" },
    rows: "",
    key: "number",
    name: "title",
    state: "state",
    url: "html_url",
    line: "",
    back: { tool: "update_issue", args: { owner: "{owner}", repo: "{repo}", issue_number: "{key}", state: "{state}" } },
  },
  {
    service: "jira",
    title: "Jira",
    match: ["atlassian", "jira"],
    tool: "searchJiraIssuesUsingJql",
    args: { cloudId: "", jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
    rows: "issues",
    key: "key",
    name: "fields.summary",
    state: "fields.status.name",
    url: "",
    line: "",
    back: null,
  },
  { service: "other", title: "", match: [], tool: "", args: {}, rows: "", key: "", name: "", state: "", url: "", line: "", back: null },
]);

/** The paths a guess tries, in its order, where the service's own is not in the answer. */
const GUESS = Object.freeze({
  key: ["identifier", "key", "number", "iid", "id"],
  name: ["title", "summary", "fields.summary", "name"],
  state: ["status", "state.name", "status.name", "state", "fields.status.name"],
  url: ["url", "html_url", "web_url", "link", "permalink"],
  line: ["assignee.name", "assignee.displayName", "assignee", "fields.assignee.displayName", "assignee.login"],
});
/** Where a service's answer may keep its list, tried in order before any other list it holds. */
const LIST_NAMES = ["issues", "nodes", "items", "results", "data", "values", "edges"];

/** Whether a value is a JSON object. @param {unknown} x @returns {x is Record<string, any>} */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";
/** A refusal in words. @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });
/** A value as a card's words: a scalar as text, anything else none. @param {unknown} v */
const text = (v) => (v == null || typeof v === "object" ? "" : String(v).trim());

/**
 * The column a service's state puts a card in, by its words: done, closed, merged or cancelled in Done; in review,
 * blocked or waiting in Waits for you; in progress or started in Doing; anything else Planned.
 * @param {string} state @returns {Column}
 */
export function guessColumn(state) {
  const s = String(state || "").toLowerCase();
  if (/\b(done|closed|complete|completed|merged|resolved|fixed|cancell?ed|duplicate|won'?t)\b/.test(s)) return "done";
  if (/review|block|wait|\bqa\b|testing|verif|approv/.test(s)) return "waits";
  if (/progress|doing|started|active|develop|working|\bwip\b/.test(s)) return "doing";
  return "planned";
}

/** The column a pull puts a state in: its map's, else the guess for a state it did not see when it was set up. @param {SpacePull} p @param {string} state */
export const columnOf = (p, state) => (Object.prototype.hasOwnProperty.call(p.columns, state) ? p.columns[state] : guessColumn(state));

/**
 * The state a move to a column sets in the service: the first its map puts there, a cancelled or duplicate one last
 * (Done names "Done" before "Canceled"); null where none does.
 * @param {SpacePull} p @param {Column} column @returns {string | null}
 */
export function toState(p, column) {
  const states = Object.entries(p.columns).filter(([, c]) => c === column).map(([s]) => s);
  const last = (/** @type {string} */ s) => (/cancel|duplicate|won'?t|abandon/i.test(s) ? 1 : 0);
  return states.sort((a, b) => last(a) - last(b))[0] ?? null;
}

/** A card's key as its service says it: an issue of GitHub "#42", Linear's and Jira's as they are. @param {{ service: string }} p @param {string} key */
export const keyWords = (p, key) => (p.service === "github" && /^\d+$/.test(key) ? `#${key}` : key);

/**
 * The lane Start a chat on this names after a card's key: "lin-42", an issue of GitHub "issue-42".
 * @param {{ service: string }} p @param {string} key
 */
export function laneOfKey(p, key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return p.service === "github" && /^\d+$/.test(slug) ? `issue-${slug}` : slug || "issue";
}

/**
 * What is wrong with a pull as the Pull sheet sends it, in words that name the part; "" where nothing is.
 * @param {any} input
 */
export function pullFault(input) {
  if (!isObject(input)) return "a pull is a JSON object: { service, title, connection, tool, args, rows, key, name, state?, url?, line?, columns, back?, always? }";
  if (!PULL_SERVICES.includes(input.service)) return `a pull's service is one of ${PULL_SERVICES.join(", ")}`;
  const title = text(input.title);
  if (!title) return "a pull needs a title: the service's name, as its cards say where they are from";
  if (title.length > PULL_LIMITS.title) return `a pull's title is ${PULL_LIMITS.title} characters at most`;
  if (typeof input.connection !== "string" || !input.connection.trim() || input.connection.length > PULL_LIMITS.name) return "a pull reads through a connector of the project's: name it";
  if (typeof input.tool !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.tool.trim())) return "a pull reads with a tool of its connector: name it, as list_issues";
  if (!isObject(input.args)) return 'a pull\'s args are a JSON object, the tool\'s arguments: {"assignee":"me"}';
  if (JSON.stringify(input.args).length > TOOL_ARGS_BYTES) return `a pull's args are ${TOOL_ARGS_BYTES} characters of JSON at most`;
  for (const k of /** @type {const} */ (["rows", "key", "name", "state", "url", "line"])) {
    const v = input[k];
    if (v != null && (typeof v !== "string" || v.length > PULL_LIMITS.path)) return `a pull's ${k} is a path in its tool's answer, ${PULL_LIMITS.path} characters at most`;
  }
  if (!text(input.key)) return "a pull needs a key: the path in each item that names it, as identifier (LIN-42)";
  if (!text(input.name)) return "a pull needs a name: the path in each item that titles its card, as title";
  if (input.columns != null) {
    if (!isObject(input.columns)) return 'a pull\'s columns are an object of each state and its column: {"In Progress":"doing"}';
    const states = Object.entries(input.columns);
    if (states.length > PULL_LIMITS.states) return `a pull's columns name ${PULL_LIMITS.states} states at most`;
    for (const [s, c] of states) {
      if (!s.trim() || s.length > PULL_LIMITS.state) return `a state in a pull's columns is ${PULL_LIMITS.state} characters at most, and not empty`;
      if (!isColumn(c)) return `"${s}" goes to ${JSON.stringify(c)}, which is no column: one of ${COLUMNS.join(", ")}`;
    }
  }
  if (input.back != null) {
    if (!isObject(input.back) || typeof input.back.tool !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.back.tool.trim()))
      return 'a pull\'s back is how a move goes back: {"tool":"update_issue","args":{"id":"{key}","state":"{state}"}}';
    if (!isObject(input.back.args)) return "a pull's back has args: a JSON object, with {key} and {state} where they go";
    if (JSON.stringify(input.back.args).length > TOOL_ARGS_BYTES) return `a pull's back args are ${TOOL_ARGS_BYTES} characters of JSON at most`;
    if (!JSON.stringify(input.back.args).includes('"{key}"')) return 'a pull\'s back names the card nowhere: give "{key}" as the value its tool takes the issue by';
  }
  if (input.always != null && typeof input.always !== "boolean") return "always is true or false";
  return "";
}

/**
 * Whether a pull as its sheet sends it lets more go back into its service than the one kept (the press,
 * http/admin/press.js): Always asked for where the kept one is not so, or a way back — the tool that moves a card, its
 * arguments, the connection it goes through — that is new, or not the kept one's. A pull with no way back, the same
 * one again — Always kept as it is, so its sheet's other fields are saved from a browser — and one taken away ask for
 * nothing more.
 * @param {any} input @param {{ connection: string, back: PullBack | null, always: boolean } | null} was  the pull kept under its id; none for a new one
 */
export function pullAsksLess(input, was) {
  if (input?.always === true && !was?.always) return true;
  if (!isObject(input?.back)) return false;
  const way = (/** @type {unknown} */ connection, /** @type {any} */ back) => JSON.stringify([text(connection), text(back?.tool), back?.args ?? null]);
  return !was?.back || way(input.connection, input.back) !== way(was.connection, was.back);
}

/**
 * A pull as a Space keeps it, from the sheet's fields or its file; null where it does not read as one. Its moved cards
 * kept as they read, the newest `PULL_LIMITS.moved`.
 * @param {any} raw @returns {SpacePull | null}
 */
export function pullKept(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || pullFault(raw)) return null;
  /** @type {Record<string, Column>} */
  const columns = {};
  for (const [s, c] of Object.entries(isObject(raw.columns) ? raw.columns : {})) columns[s] = /** @type {Column} */ (c);
  /** @type {[string, PullMoved][]} */
  const moved = [];
  for (const [k, m] of Object.entries(isObject(raw.moved) ? raw.moved : {}))
    if (k && isObject(m) && isColumn(m.column) && typeof m.from === "string") moved.push([k, { column: m.column, from: m.from, at: Number(m.at) || 0 }]);
  moved.sort((a, b) => a[1].at - b[1].at);
  return {
    id: raw.id,
    service: raw.service,
    title: text(raw.title),
    connection: raw.connection.trim(),
    tool: raw.tool.trim(),
    args: raw.args,
    rows: String(raw.rows ?? "").trim(),
    key: String(raw.key).trim(),
    name: String(raw.name).trim(),
    state: String(raw.state ?? "").trim(),
    url: String(raw.url ?? "").trim(),
    line: String(raw.line ?? "").trim(),
    columns,
    back: isObject(raw.back) ? { tool: raw.back.tool.trim(), args: raw.back.args } : null,
    always: raw.always === true && isObject(raw.back),
    at: Number(raw.at) || 0,
    moved: Object.fromEntries(moved.slice(-PULL_LIMITS.moved)),
  };
}

/**
 * A tool's answer read into a pull's rows: its list at `rows`, each item's key, title, state, link and line at their
 * paths; an item with no key or no title is no card. Or what is wrong, in words.
 * @param {SpacePull} p @param {string} out  the tool's data, as JSON text (core/dashboard-sources.js `toolData`)
 * @returns {{ ok: true, rows: PullRow[] } | { ok: false, error: string }}
 */
export function pullRows(p, out) {
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    return no("it answered words, not JSON");
  }
  const list = at(json, p.rows);
  if (!Array.isArray(list)) return no(p.rows ? `its list (${p.rows}) is no list: Read once in its sheet shows where its list is` : "it answered no list: name where its list is in its sheet");
  /** @type {PullRow[]} */
  const rows = [];
  for (const item of list.slice(0, PULL_LIMITS.rows)) {
    if (!isObject(item)) continue;
    const key = text(at(item, p.key));
    const title = text(at(item, p.name));
    if (!key || !title) continue;
    rows.push({ key, title: title.slice(0, 200), state: p.state ? text(at(item, p.state)).slice(0, PULL_LIMITS.state) : "", url: p.url ? webLink(at(item, p.url)) : "", line: p.line ? text(at(item, p.line)).slice(0, 200) : "" });
  }
  return { ok: true, rows };
}

/** A link a card may open: an address on the web, else none. @param {unknown} v */
const webLink = (v) => {
  const s = text(v);
  return /^https?:\/\/[^\s]+$/i.test(s) && s.length <= 2000 ? s : "";
};

/**
 * The cards a pull's rows put on the board, `PULL_CARDS_MAX` at most, in its answer's order: each in the column its
 * state maps to — or where the person moved it, while the service still says the state it had then. A row in Done is
 * no card (the board's Done is this week's, and the service closed it at a moment Filament does not know), but one the
 * person moved to Done this week, which stays there while the service agrees. `more`: the open rows past the most;
 * `done`: those kept off as done.
 * @param {SpacePull} p @param {readonly PullRow[]} rows @param {number} now
 * @returns {{ cards: PullCard[], more: number, done: number }}
 */
export function pullCards(p, rows, now) {
  const week = weekStart(now);
  /** @type {PullCard[]} */
  const placed = [];
  for (const r of rows) {
    const mapped = columnOf(p, r.state);
    const m = Object.prototype.hasOwnProperty.call(p.moved, r.key) ? p.moved[r.key] : null;
    const stands = !!m && (m.from === r.state || (m.column === "done" && mapped === "done" && m.at >= week));
    const column = stands && m ? m.column : mapped;
    // Moved to Done on the board this week: shown there, as a typed task done this week is.
    if (column === "done" && !(stands && m && m.at >= week)) continue;
    placed.push({ ...r, column, moved: stands && column !== mapped });
  }
  const open = placed.filter((c) => c.column !== "done");
  const shown = [...open.slice(0, PULL_CARDS_MAX), ...placed.filter((c) => c.column === "done")];
  return { cards: shown, more: Math.max(0, open.length - PULL_CARDS_MAX), done: rows.length - placed.length };
}

/**
 * The cards moved on the board a pull keeps after a read: those still standing — the service says the state they had,
 * or Done for one moved there this week —, the newest `PULL_LIMITS.moved`; a key its answer no longer has is kept,
 * as its row may come back.
 * @param {SpacePull} p @param {readonly PullRow[]} rows @param {number} now @returns {Record<string, PullMoved>}
 */
export function movedKept(p, rows, now) {
  const week = weekStart(now);
  const by = new Map(rows.map((r) => [r.key, r]));
  /** @type {[string, PullMoved][]} */
  const kept = [];
  for (const [k, m] of Object.entries(p.moved)) {
    const r = by.get(k);
    if (!r || m.from === r.state || (m.column === "done" && columnOf(p, r.state) === "done" && m.at >= week)) kept.push([k, m]);
  }
  return Object.fromEntries(kept.sort((a, b) => a[1].at - b[1].at).slice(-PULL_LIMITS.moved));
}

/**
 * A move's args for its tool: the pull's `back.args` with "{key}" the card's key, "{state}" the state it goes to and
 * "{<name>}" the pull's own arg of that name, each where it stands as a whole value, nested values too.
 * @param {SpacePull} p @param {string} key @param {string} state @returns {Record<string, unknown>}
 */
export function backArgs(p, key, state) {
  /** @type {Record<string, unknown>} */
  const fills = { ...p.args, key, state };
  /** @param {unknown} v @returns {unknown} */
  const fill = (v) => {
    if (typeof v === "string") {
      const m = /^\{([A-Za-z0-9_-]+)\}$/.exec(v);
      return m && Object.prototype.hasOwnProperty.call(fills, m[1]) ? fills[m[1]] : v;
    }
    if (Array.isArray(v)) return v.map(fill);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return /** @type {Record<string, unknown>} */ (fill(p.back?.args || {}));
}

/**
 * Each column's state a move there sets, for the ask's words ("Move LIN-42 to In Progress in Linear too?"); null for a
 * column no state maps to, and all null where a move cannot go back.
 * @param {SpacePull} p @returns {Record<Column, string | null>}
 */
export function backStates(p) {
  return /** @type {Record<Column, string | null>} */ (Object.fromEntries(COLUMNS.map((c) => [c, p.back ? toState(p, c) : null])));
}

/** The leaf paths of an item, to three deep, its scalar values only: what a pull's paths may name. @param {unknown} item */
function leaves(item) {
  /** @type {string[]} */
  const out = [];
  /** @param {unknown} v @param {string} path @param {number} depth */
  const walk = (v, path, depth) => {
    if (isObject(v)) {
      if (depth < 3) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    } else if (!Array.isArray(v) && v != null && path) out.push(path);
  };
  walk(item, "", 0);
  return out;
}

/**
 * Where an answer keeps its list: the path a preset names where it is one, the answer itself where it is one, else the
 * first list of objects it holds two deep — those named as lists usually are first.
 * @param {unknown} json @param {string} want @returns {string | null}
 */
function listPath(json, want) {
  if (want && Array.isArray(at(json, want))) return want;
  if (Array.isArray(json)) return "";
  if (!isObject(json)) return null;
  const isList = (/** @type {unknown} */ v) => Array.isArray(v) && v.some(isObject);
  /** @type {string[]} */
  const found = [];
  for (const [k, v] of Object.entries(json)) {
    if (isList(v)) found.push(k);
    else if (isObject(v)) for (const [k2, v2] of Object.entries(v)) if (isList(v2)) found.push(`${k}.${k2}`);
  }
  const named = (/** @type {string} */ p) => LIST_NAMES.indexOf(String(p.split(".").at(-1)));
  return found.sort((a, b) => (named(a) < 0 ? 99 : named(a)) - (named(b) < 0 ? 99 : named(b)))[0] ?? null;
}

/**
 * What the Pull sheet shows after Read once: where the answer keeps its list and how many items it holds, the paths
 * its items have, each path guessed — the preset's where the answer has it —, the states its items say and the column
 * each is guessed to; or what is wrong, in words.
 * @param {string} out  the tool's data as JSON text @param {{ rows?: string, key?: string, name?: string, state?: string, url?: string, line?: string }} [preset]
 * @returns {{ ok: true, rows: string, count: number, fields: string[], key: string, name: string, state: string, url: string, line: string,
 *   states: string[], columns: Record<string, Column>, sample: string } | { ok: false, error: string }}
 */
export function pullGuess(out, preset = {}) {
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    return no("it answered words, not JSON");
  }
  const rows = listPath(json, preset.rows || "");
  if (rows == null) return no("its answer holds no list of items: is this the tool that lists them?");
  const list = /** @type {unknown[]} */ (at(json, rows)).filter(isObject);
  if (!list.length) return { ok: true, rows, count: 0, fields: [], key: preset.key || "", name: preset.name || "", state: preset.state || "", url: preset.url || "", line: preset.line || "", states: [], columns: {}, sample: "" };
  const fields = [...new Set(list.slice(0, 5).flatMap(leaves))].slice(0, 80);
  /** @param {keyof typeof GUESS} k */
  const pick = (k) => {
    const own = preset[k];
    if (own && fields.includes(own)) return own;
    return GUESS[k].find((p) => fields.includes(p)) || "";
  };
  const state = pick("state");
  const states = state ? [...new Set(list.map((item) => text(at(item, state))).filter(Boolean))].slice(0, PULL_LIMITS.states) : [];
  return {
    ok: true,
    rows,
    count: list.length,
    fields,
    key: pick("key"),
    name: pick("name"),
    state,
    url: pick("url"),
    line: pick("line"),
    states,
    columns: Object.fromEntries(states.map((s) => [s, guessColumn(s)])),
    sample: JSON.stringify(list[0], null, 1).slice(0, 1500),
  };
}

/**
 * A move gone back, as What happened says it: "You moved LIN-42 to In Progress in Linear."
 * @param {SpacePull} p @param {string} key @param {string} state
 */
export const movedWords = (p, key, state) => `You moved ${keyWords(p, key)} to ${state} in ${p.title}.`;

/** A column as the board heads it. @param {Column} c */
export const columnWords = (c) => COLUMN_WORDS[c];
