// @ts-check
// One SQLite database per app (the Space Apps plan of 10-29, "Storage": `filament.db`'s collections, then a database of
// its own for big tables), pure: what a page's SQL may be, what it may reach, and how its rows come back. The query
// runs in a process of its own (services/app-sql-child.js), never in Filament's: a query that runs without end is
// ended by ending that process, as a worker thread cannot stop SQLite mid-query (measured on Node 24).

/** A statement's longest text, in characters. */
export const SQL_MAX_CHARS = 100_000;
/** The most values a statement is given. */
export const SQL_PARAMS_MAX = 1000;
/** The most rows a query answers with; more are said, not sent. */
export const SQL_ROWS_MAX = 5000;
/** How long one statement may run before its process is ended, and the statement with it. */
export const SQL_TIMEOUT_MS = 10_000;
/** An app's database's cap, in MB: a write past it is refused. */
export const SQL_DB_MAX_MB = 1024;
/** An answer's most bytes, as near as its values say: one past it is refused, never carried through Filament's own process. */
export const SQL_ANSWER_MAX_BYTES = 16 * 1024 * 1024;
/** The most statements one app has waiting their turn: one more is refused rather than held. */
export const SQL_WAITING_MAX = 50;
/** Where each app's database is, under the data folder: `<name>.sqlite`. */
export const SQL_DIR = "app-sql";

/** The PRAGMAs a page may run: those that read a table's shape, and its own version number. */
export const PRAGMAS_READ = Object.freeze(["table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list", "user_version"]);

/** What an app's SQL reaches, in a refusal's words. */
export const SQL_REACH = "An app's SQL reaches its own database alone: no ATTACH or DETACH, no VACUUM, no extension, and no PRAGMA but table_info, table_xinfo, table_list, index_list, index_info, index_xinfo, foreign_key_list and user_version";
/** A statement's request's most bytes, its values with it: a page's big data goes in many statements, never one. */
export const SQL_BODY_MAX = 1024 * 1024;

/** Comments and blanks, as SQLite skips them. */
const BLANK = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$))*/;

/** A statement's text less its leading comments and blanks. @param {string} sql */
export const bareOf = (sql) => String(sql).replace(BLANK, "");

/**
 * Why a page's statement is not run before SQLite reads it, or null: none, too long, or a VACUUM — whose copy, its own
 * or one INTO a file elsewhere, SQLite makes by attaching it, which the authorizer refuses in its own words; here, in
 * plainer ones. A VACUUM a leading `;` hides from this is refused by the authorizer all the same.
 * @param {unknown} sql @param {unknown} params
 * @returns {string | null}
 */
export function sqlRefusal(sql, params) {
  if (typeof sql !== "string" || !bareOf(sql).trim()) return "Give the statement to run: { sql, params }.";
  if (sql.length > SQL_MAX_CHARS) return `A statement is ${SQL_MAX_CHARS.toLocaleString("en-US")} characters at most; this one is ${sql.length.toLocaleString("en-US")}.`;
  if (/^vacuum\b/i.test(bareOf(sql))) return `Not run: ${SQL_REACH}.`;
  if (params !== undefined && params !== null) {
    const values = Array.isArray(params) ? params : typeof params === "object" ? Object.values(params) : null;
    if (!values) return "params is a list of values, or an object of them by name.";
    if (values.length > SQL_PARAMS_MAX) return `A statement is given ${SQL_PARAMS_MAX} values at most.`;
    if (values.some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v))) return "Each value is text, a number, true or false, or null.";
  }
  return null;
}

/** Whether what follows a statement SQLite read is nothing but blanks and comments: one statement at a time. @param {string} sql @param {string} first */
export const aloneIn = (sql, first) => !bareOf(sql.slice(first.length)).trim();

/** What a still preview's statement that would change its app's database is answered: a preview reads alone. */
export const SQL_STILL = "Not run: a still preview of the app reads its database and changes nothing";

/**
 * The authorizer's answer for what a statement asks of SQLite (its action and first two arguments): no other database
 * attached or detached, no extension loaded, a PRAGMA that reads a table's shape alone. Every other action is the page's
 * — but for a statement that may only read (`reading`, a still preview's): a select, the reads and functions it makes,
 * and a PRAGMA that reads, nothing that changes the database, a temporary table's included.
 * @param {number} action @param {string | null} a @param {string | null} b @param {Record<string, number>} c  node:sqlite's constants
 * @param {boolean} [reading]
 * @returns {boolean} whether it may
 */
export function sqlMay(action, a, b, c, reading = false) {
  if (reading && ![c.SQLITE_SELECT, c.SQLITE_READ, c.SQLITE_FUNCTION, c.SQLITE_RECURSIVE, c.SQLITE_PRAGMA].includes(action)) return false;
  if (action === c.SQLITE_ATTACH || action === c.SQLITE_DETACH) return false;
  if (action === c.SQLITE_PRAGMA) return PRAGMAS_READ.includes(String(a || "").toLowerCase()) && (String(a).toLowerCase() !== "user_version" || b == null || (!reading && /^\d+$/.test(String(b))));
  if (action === c.SQLITE_FUNCTION) return !/^load_extension$/i.test(String(b || ""));
  return true;
}

/**
 * A value as the page reads it: text, a number, null — an integer past a double's range as its digits, bytes as
 * `{ blob: base64 }`.
 * @param {unknown} v
 */
export function valueOut(v) {
  if (typeof v === "bigint") return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Uint8Array) return { blob: Buffer.from(v).toString("base64") };
  return v ?? null;
}

/** How many bytes a value out takes in its answer, as JSON writes it in UTF-8 — a control character as six, an emoji as four. @param {unknown} v */
export const sizeOut = (v) => (typeof v === "string" ? Buffer.byteLength(JSON.stringify(v)) : v && typeof v === "object" && "blob" in v ? String(/** @type {any} */ (v).blob).length + 12 : 24);

/** An answer past SQL_ANSWER_MAX_BYTES, in words. */
export const SQL_TOO_BIG = `Not sent: its answer is past ${SQL_ANSWER_MAX_BYTES / 1024 / 1024} MB. Ask for fewer rows or columns (LIMIT), or a blob's length() rather than the blob.`;

/**
 * SQLite's own words for a failure, as the page reads them: a refusal of its authorizer said as what its SQL reaches,
 * a full database as its cap.
 * @param {string} message @param {number} maxMb
 */
export function sqlFailure(message, maxMb) {
  const m = String(message || "it failed").replace(/\.$/, "");
  if (/not authorized|authorization denied/i.test(m)) return `Not run: ${SQL_REACH}.`;
  if (/database or disk is full/i.test(m)) return `Not kept: its database is at its cap of ${maxMb} MB.`;
  return `Not run: ${m}.`;
}
