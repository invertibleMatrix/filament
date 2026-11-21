// The archive: Filament's own byte-exact record of what happened. One SQLite file (node:sqlite, WAL) holding
// projects → chains (conversations) → turns (one user message, the work it caused, the final answer). Every message
// is stored once by content hash, AES-256-GCM encrypted at rest when a key is given. A plaintext FTS5 copy of user
// inputs and final answers (capped) serves session search. Also home to compaction summaries, links between rows,
// the learned-item index and the injection log. Schema and API: docs/memory-architecture.md §5 and §5.1.
import * as sqlite from "node:sqlite";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { textOfMessage, messageKind, messagePieces, callLog, callsRead, withoutAskLine } from "../../core/messages.js";
import { sha256 } from "../../core/hash.js";
import { lazy } from "../../core/lazy.js";
import { pinHashOf } from "../../core/fold.js";
import { tallyOfWork } from "../../core/tool-vocab.js";
import { tokensForChars } from "../../core/tokens.js";
import { headChars, tailChars } from "../../core/text.js";
import { normalizeCwd, projectIdOf, projectNameOf } from "../../core/project-id.js";
import { cryptLayer } from "../mcp-servers.js";
import { hasUnspaced, shortUnspaced, trigramsOf } from "./words.js";

export const SCHEMA_VERSION = 17;
/**
 * The archive's upgrade steps (the owner's of 11-05: an update must not cost a person their history), oldest first: each
 * takes a file at `from` to `from + 1`. A file at an older version opens once a step leads from it to SCHEMA_VERSION,
 * every one: copied aside first, then upgraded in one transaction, so a step that fails leaves the file as it was. A
 * step runs on the file as its version left it, before this build's SCHEMA (CREATE … IF NOT EXISTS) adds what is new. A
 * file older than the first step — written before the clean slate of 17 (AH-C1) — or newer than this build is
 * refused. A change to SCHEMA that bumps SCHEMA_VERSION adds its step here, and a test that upgrades a file to it.
 * @typedef {{ from: number, up: (db: import("node:sqlite").DatabaseSync) => void }} UpgradeStep
 * @type {readonly UpgradeStep[]}
 */
export const UPGRADES = Object.freeze([]);
/**
 * The steps that take a file at `found` to `to`, in order, or null where one is missing.
 * @param {number} found @param {number} to @param {readonly UpgradeStep[]} steps
 */
export function upgradePath(found, to, steps) {
  if (!Number.isInteger(found) || found >= to) return null;
  /** @type {UpgradeStep[]} */
  const path = [];
  for (let v = found; v < to; v++) {
    const step = steps.find((s) => s.from === v);
    if (!step) return null;
    path.push(step);
  }
  return path;
}
/** Filament's own folder: the checkout, or the installed app's `resources/app`. */
const OWN_FOLDER = fileURLToPath(new URL("../../../", import.meta.url));
/**
 * How a person starts over from an archive another build wrote, in words for where Filament runs (HarnessV3-AtHome
 * AH-C1): `npm run reset` where its script is, as in a checkout; the installed app ships no scripts/
 * (electron-builder.yml), and there memory's folder, set to a new one in the console, opens a new archive.
 * @param {string} [root]  Filament's own folder
 */
export function startOverWords(root = OWN_FOLDER) {
  return existsSync(join(root, "scripts", "reset.mjs"))
    ? "Run `npm run reset` for a clean slate: it keeps how Filament is reached, your upstreams and your routes, and starts everything else over."
    : "To start memory over, set its folder to a new, empty one (in the console: Memory → Settings → Engine and folder): a new archive opens there, without the sessions and memories this one holds, and this one stays as it is.";
}
// What a chain is to the people reading the list (HarnessV2 D4): a conversation someone had, a fork of one, a loop's
// own tick, a sub-agent transcript an import brought along, or an outside agent's session over `/mcp/memory`
// (HarnessV3-Memory M7-D40: what it was shown, so errata reach it).
export const CHAIN_KINDS = Object.freeze(["interactive", "fork", "tick", "subagent", "mcp", "team"]);
const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, cwd TEXT, name TEXT, first_seen INT, last_seen INT, settings_json TEXT);
CREATE TABLE IF NOT EXISTS local_texts (chain_id TEXT, hash TEXT, kind TEXT, created_at INT, PRIMARY KEY (chain_id, hash)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chains (id TEXT PRIMARY KEY, key TEXT UNIQUE, project_id TEXT, client TEXT, model TEXT, title TEXT, started_at INT, last_at INT, turns INT DEFAULT 0, parent_id TEXT, state_json TEXT, briefing TEXT, meta_json TEXT, kind TEXT DEFAULT 'interactive', preview TEXT, settings_json TEXT);
CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY, chain_id TEXT, n INT, started_at INT, ended_at INT, request_ids_json TEXT, model TEXT, upstream TEXT, user_hash TEXT, final_hash TEXT, work_json TEXT, input_chars INT, output_chars INT, summary TEXT, meta_json TEXT);
CREATE TABLE IF NOT EXISTS messages (hash TEXT PRIMARY KEY, role TEXT, kind TEXT, bytes INT, truncated INT, body BLOB, created_at INT);
CREATE TABLE IF NOT EXISTS compactions (id INTEGER PRIMARY KEY, chain_id TEXT, from_turn INT, to_turn INT, summary_hash TEXT, kind TEXT, window TEXT, created_at INT, method TEXT, detail_json TEXT);
CREATE TABLE IF NOT EXISTS trim_slices (hash TEXT PRIMARY KEY, summary_hash TEXT, tokens INT, chars INT, model TEXT, created_at INT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS links (src TEXT, dst TEXT, type TEXT, weight REAL, created_at INT, PRIMARY KEY (src, dst, type));
CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, project_id TEXT, chain_id TEXT, turn_id INT, kind TEXT, text TEXT, text_norm TEXT, status TEXT, importance REAL, memory_id TEXT, created_at INT, updated_at INT, origin TEXT, superseded_by INTEGER, invalid_reason TEXT, invalid_at INT, slot TEXT, slot_value TEXT, slot_multi INT);
CREATE TABLE IF NOT EXISTS item_events (id INTEGER PRIMARY KEY, item_id INTEGER, at INT, action TEXT, by TEXT, reason TEXT, detail_json TEXT, run_id INTEGER, undone_at INT);
CREATE TABLE IF NOT EXISTS blocks (chain_id TEXT, hash TEXT, block TEXT, nth INTEGER DEFAULT 1, kind TEXT DEFAULT 'turn', created_at INT, PRIMARY KEY (chain_id, hash)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS injections (id INTEGER PRIMARY KEY, request_id TEXT, chain_id TEXT, turn_id INT, kind TEXT, ids_json TEXT, tokens INT, used INT, created_at INT);
CREATE TABLE IF NOT EXISTS injection_ids (injection_id INTEGER, memory_id TEXT, used INT, PRIMARY KEY (injection_id, memory_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS withheld (anchor TEXT PRIMARY KEY, entry TEXT, created_at INT) WITHOUT ROWID;
CREATE VIRTUAL TABLE IF NOT EXISTS fts_text USING fts5(chain_id UNINDEXED, turn_id UNINDEXED, role UNINDEXED, text);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_tri USING fts5(chain_id UNINDEXED, turn_id UNINDEXED, role UNINDEXED, text, tokenize='trigram');
CREATE INDEX IF NOT EXISTS chains_project ON chains (project_id, last_at);
CREATE INDEX IF NOT EXISTS turns_chain ON turns (chain_id, n);
CREATE INDEX IF NOT EXISTS items_project ON items (project_id, status);
CREATE INDEX IF NOT EXISTS injections_request ON injections (request_id);
CREATE INDEX IF NOT EXISTS injection_ids_memory ON injection_ids (memory_id, injection_id);
CREATE TABLE IF NOT EXISTS memory_last_used (memory_id TEXT PRIMARY KEY, at INT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS item_near (item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, run_id INT, at INT NOT NULL);
CREATE INDEX IF NOT EXISTS items_memory ON items (memory_id);
CREATE INDEX IF NOT EXISTS item_events_item ON item_events (item_id, id);
CREATE TABLE IF NOT EXISTS engine_outbox (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, op TEXT NOT NULL, args_json TEXT, attempts INT NOT NULL DEFAULT 0, last_error TEXT, next_at INT NOT NULL DEFAULT 0, created_at INT, done_at INT, dead INT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS engine_outbox_open ON engine_outbox (done_at, item_id, id);
CREATE TABLE IF NOT EXISTS item_anchors (item_id INTEGER NOT NULL, path TEXT NOT NULL, name TEXT, kind TEXT, hash TEXT, size INT, mtime INT, head TEXT, symbols_json TEXT, state TEXT, at INT, checked_at INT, PRIMARY KEY (item_id, path)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS injections_chain ON injections (chain_id, id);
CREATE TABLE IF NOT EXISTS curator_runs (id INTEGER PRIMARY KEY, project_id TEXT, reason TEXT, model TEXT, calls INT NOT NULL DEFAULT 0, actions INT NOT NULL DEFAULT 0, started_at INT, ended_at INT, error TEXT, detail_json TEXT, undone_at INT, undone_by TEXT);
CREATE INDEX IF NOT EXISTS curator_runs_project ON curator_runs (project_id, id);
CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, key TEXT NOT NULL, item_ids_json TEXT, proposal_json TEXT, reason TEXT, run_id INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at INT, decided_at INT, decided_by TEXT, outcome_json TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_key ON inbox (key);
CREATE INDEX IF NOT EXISTS inbox_open ON inbox (status, project_id, id);
CREATE TABLE IF NOT EXISTS dossiers (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, version INT NOT NULL, sections_json TEXT NOT NULL, cites_json TEXT, basis TEXT, model TEXT, run_id INTEGER, created_at INT, undone_at INT);
CREATE INDEX IF NOT EXISTS dossiers_project ON dossiers (project_id, version);
CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, topic TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, version INT NOT NULL, sections_json TEXT NOT NULL, cites_json TEXT, sources_json TEXT, basis TEXT, model TEXT, run_id INTEGER, created_at INT, undone_at INT);
CREATE INDEX IF NOT EXISTS pages_project ON pages (project_id, topic, version);
CREATE TABLE IF NOT EXISTS item_triggers (item_id INTEGER NOT NULL, tool TEXT NOT NULL, shape TEXT NOT NULL, args TEXT NOT NULL DEFAULT '', unless TEXT, source TEXT NOT NULL, at INT, PRIMARY KEY (item_id, tool, shape, args)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS item_triggers_shape ON item_triggers (tool, shape);
CREATE TABLE IF NOT EXISTS claim_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, at INT NOT NULL, item_id INTEGER, action TEXT NOT NULL, project_id TEXT, from_project TEXT, chain_id TEXT, by TEXT);
CREATE INDEX IF NOT EXISTS claim_feed_item ON claim_feed (item_id);
CREATE TABLE IF NOT EXISTS outcomes (id INTEGER PRIMARY KEY, at INT NOT NULL, chain_id TEXT NOT NULL, turn_id INT, request_id TEXT, kind TEXT NOT NULL, agent TEXT, model TEXT NOT NULL, did TEXT NOT NULL, counts_json TEXT NOT NULL, ended TEXT NOT NULL, corrected TEXT, corrected_at INT, rounds INT NOT NULL, calls INT NOT NULL, tokens_in INT NOT NULL, tokens_out INT NOT NULL, usd REAL, ms INT NOT NULL);
CREATE INDEX IF NOT EXISTS outcomes_chain ON outcomes (chain_id, turn_id);
CREATE INDEX IF NOT EXISTS outcomes_at ON outcomes (at);
CREATE TABLE IF NOT EXISTS round_changes (chain_id TEXT NOT NULL, turn_id INTEGER NOT NULL, seq INTEGER NOT NULL, place TEXT NOT NULL, round INT, agent TEXT NOT NULL DEFAULT '', before_commit TEXT, after_commit TEXT, base TEXT NOT NULL, own_json TEXT NOT NULL DEFAULT '[]', command INT NOT NULL DEFAULT 0, at INT, PRIMARY KEY (turn_id, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS round_changes_chain ON round_changes (chain_id, turn_id);
CREATE INDEX IF NOT EXISTS round_changes_place ON round_changes (place, at);
CREATE TABLE IF NOT EXISTS gone_chains (id TEXT PRIMARY KEY, helpers_json TEXT NOT NULL DEFAULT '[]', at INT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS turn_legs (turn_id INTEGER PRIMARY KEY, names TEXT NOT NULL, n INT NOT NULL);
CREATE TRIGGER IF NOT EXISTS turn_legs_gone AFTER DELETE ON turns BEGIN DELETE FROM turn_legs WHERE turn_id = OLD.id; END;
CREATE INDEX IF NOT EXISTS items_dedup ON items (project_id, kind, text_norm);
CREATE INDEX IF NOT EXISTS items_slot ON items (project_id, slot);
CREATE INDEX IF NOT EXISTS chains_kind_last ON chains (kind, last_at);
CREATE INDEX IF NOT EXISTS item_events_run ON item_events (run_id, id);
CREATE INDEX IF NOT EXISTS item_events_acts ON item_events (json_extract(detail_json, '$.chain'), id) WHERE action IN ('fired', 'followed');
`;
// The turn rows written through this connection since it opened (`turnsVersion`), kept by SQLite itself: each row begun
// or changed — by any statement, through any of the archive's writers — takes the next write's number, and a write a
// transaction rolls back is taken back with it. TEMP, so nothing of it is in the file. A turn that goes leaves no mark
// here: a reader learns the turns that stand from their ids (`turnOutline`).
const TURN_WRITES = `
CREATE TEMP TABLE turn_writes (seq INTEGER PRIMARY KEY AUTOINCREMENT, turn_id INTEGER NOT NULL UNIQUE);
CREATE TEMP TRIGGER turn_begun AFTER INSERT ON main.turns BEGIN DELETE FROM turn_writes WHERE turn_id = NEW.id; INSERT INTO turn_writes (turn_id) VALUES (NEW.id); END;
CREATE TEMP TRIGGER turn_changed AFTER UPDATE ON main.turns BEGIN DELETE FROM turn_writes WHERE turn_id = NEW.id; INSERT INTO turn_writes (turn_id) VALUES (NEW.id); END;
`;
// The messages' running totals (`counts`), kept by SQLite itself in the file: each message written or deleted, by any
// statement through any connection, moves them, and a transaction that rolls back takes its moves back. Summed at read
// time they are a pass over every message — 2.3 GB on the owner's archive, seconds of the server's one thread. Messages
// are content-addressed, never changed in place. A file whose messages were written before its totals row has the row
// `counted` = 0, and its messages are counted whole once on a thread of their own (`archive-count.js`); a file with no
// messages yet has nothing to count.
const MESSAGE_TOTALS = `
CREATE TABLE IF NOT EXISTS message_totals (id INTEGER PRIMARY KEY CHECK (id = 1), rows INT NOT NULL DEFAULT 0, bytes INT NOT NULL DEFAULT 0, counted INT NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS message_kept AFTER INSERT ON messages BEGIN UPDATE message_totals SET rows = rows + 1, bytes = bytes + COALESCE(NEW.bytes, 0) WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS message_dropped AFTER DELETE ON messages BEGIN UPDATE message_totals SET rows = rows - 1, bytes = bytes - COALESCE(OLD.bytes, 0) WHERE id = 1; END;
INSERT OR IGNORE INTO message_totals (id, counted) SELECT 1, NOT EXISTS (SELECT 1 FROM messages);
`;
/** How long the claims feed keeps a change (HarnessV3-Memory M7-D32): a subscriber away longer reads everything again. */
export const FEED_DAYS = 30;
// An item is a claim (HarnessV3-Memory MD-1): `superseded` is retired by a named replacement, `dismissed` retired on
// its own; neither is deleted, and either can be restored. What made the item is its `origin`; a sub-agent's or an
// outside agent's finding (HarnessV3-Memory M7-D19, M7-D47) names its finder on its `created` event.
export const ITEM_STATUSES = ["inferred", "confirmed", "dismissed", "superseded"];
/** Retired: no longer served, kept with its history. @param {string | null | undefined} status */
export const isRetired = (status) => status === "dismissed" || status === "superseded";
export const ITEM_ORIGINS = ["person", "correction", "capture", "model", "learner", "import", "owner", "subagent", "agent"];
// An untitled chain is labelled by the head of its first user message (HarnessV2 D13).
export const PREVIEW_CHARS = 80;
/** A session named by its first message: that message's first line, trimmed, at most 80 characters. @param {string} text */
export const firstLineTitle = (text) => String(text || "").split("\n")[0].trim().slice(0, PREVIEW_CHARS);
/**
 * The person's own words in a user message, for its chain's label and name: the leading text blocks Filament placed
 * there (a sub-agent's report, a launch or restart notice, all "[Filament: …]") left out. Found on F4's hand test: a
 * session whose first message carried a queued report was named "[Filament: sub-agent …".
 * @param {any} message @returns {string}
 */
export function ownTextOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return textOfMessage(message);
  let i = 0;
  while (i < content.length && content[i]?.type === "text" && /^\s*\[Filament:/.test(String(content[i].text || ""))) i++;
  return textOfMessage({ ...message, content: content.slice(i) });
}
// Bound on the slice-summary cache. Rows are content-addressed and shared across sessions, so this is a
// cache size, not a record of history: the oldest are evicted on write and a later pass simply re-summarizes.
export const TRIM_SLICE_CAP = 5000;
// How many chains' shown claims the archive keeps between their checks (`anchors.shownIn`): a cache, not a record — a
// chain that went reads its injection log whole at its next check.
const SHOWN_CHAINS = 256;
// How many places in turns' work the archive keeps (`workFrom`): a cache, not a record — a place gone is found again by
// opening the work up to it.
const PLACES_KEPT = 256;
// How many turns' counts of tool legs an opening keeps (`toolLegs`): a cache, not a record — a turn gone from it is read
// from the file's (`turn_legs`), else counted again from its messages' kinds.
export const LEGS_KEPT = 4096;
// How many of the page's sends a turn keeps the names of (`beginTurn`'s `send`): each try of its message is one.
const SENDS_KEPT = 20;

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const parseJson = (s, dflt) => {
  if (s == null) return dflt;
  try {
    return JSON.parse(s);
  } catch {
    return dflt;
  }
};
const plain = (row) => (row ? { ...row } : null); // node:sqlite rows have a null prototype; callers (and deepEqual) want plain objects
/**
 * A list of ids or hashes a query matches against, bound as ONE parameter: `x ${IN_LIST}` with `listParam(values)`.
 * An `IN (?, ?, …)` is a prepared statement per length of list, each kept while the archive is open, and fails past
 * SQLite's 32,766 parameters; this is one statement, and SQLite still looks each value up by the column's index (a
 * list subquery). Each value is the one `JSON.stringify` keeps — a number stays a number, a string text — and compares
 * as that value bound alone would.
 */
const IN_LIST = "IN (SELECT value FROM json_each(?))";
/** @param {readonly (string | number)[]} values */
const listParam = (values) => JSON.stringify(values);
/** @typedef {import("../../core/types.js").RoundChange} RoundChange */
/**
 * @typedef {{ id: string, title: string, code: string, loading?: string[], by?: string | null, exchange?: number | null, round?: number | null, madeIn?: string }} VisualIn
 *   a visual as it is kept (HarnessV4_Visuals_Plan VS-D9): `by` the helper that drew it, where one did, and `exchange`
 *   which of its exchanges; `madeIn` the app it was drawn in where that is not Filament (an imported chat's, VS-D15)
 */
/** A visual's code, its title and its lines as the message it is kept in. @param {VisualIn} v */
const visualMessage = (v) => ({ visual: { title: String(v.title), code: String(v.code), loading: Array.isArray(v.loading) ? v.loading.map(String) : [] } });
/** An item event with its detail read. @param {any} r */
const eventRow = (r) => {
  const { detail_json, ...rest } = plain(r);
  return { ...rest, detail: parseJson(detail_json, null) };
};
/** A curator pass with what it did read. @param {any} r */
const runRow = (r) => {
  if (!r) return null;
  const { detail_json, ...rest } = plain(r);
  return { ...rest, detail: parseJson(detail_json, null) };
};
/** An inbox question with its claims, proposal and outcome read. @param {any} r */
const inboxRow = (r) => {
  if (!r) return null;
  const { item_ids_json, proposal_json, outcome_json, ...rest } = plain(r);
  return { ...rest, itemIds: parseJson(item_ids_json, []), proposal: parseJson(proposal_json, null), outcome: parseJson(outcome_json, null) };
};
/** An outcome with its call counts read. @param {any} r */
const outcomeRow = (r) => {
  const { counts_json, ...rest } = plain(r);
  return { ...rest, counts: parseJson(counts_json, null) };
};
/** A dossier version with its sections and cites read. @param {any} r */
const dossierRow = (r) => {
  if (!r) return null;
  const { sections_json, cites_json, ...rest } = plain(r);
  return { ...rest, sections: parseJson(sections_json, []), cites: parseJson(cites_json, []) };
};
/** A topic page's version with its sections, cites and sources read. @param {any} r */
const pageRow = (r) => {
  if (!r) return null;
  const { sources_json, ...rest } = /** @type {any} */ (dossierRow(r));
  return { ...rest, sources: parseJson(sources_json, []) };
};
const toBuf = (b) => (Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength)); // BLOBs read back as Uint8Array
const estTokens = tokensForChars;
const when = (t) => new Date(t || 0).toISOString().slice(0, 16).replace("T", " ");
// Cuts by UTF-16 units keep an emoji's pair whole (the hunt of 11-08): half of one is no text, and a view's text rides
// a request — a tool result every later one carries.
const cap = (s, n) => (s.length > n ? headChars(s, n) + "…" : s);
// What a turn shows the learner of Filament's notices that rode with the user's message (`turnsToRead` with `words`):
// under a head that says whose they are, and enough of them to follow the answer.
const RODE_HEAD = "With the message, a notice Filament wrote — not the user's words:";
const RODE_CHARS = 1500;
// What opens a turn of another machine's agents' chat (`agentsChat`), as memory's readers show it — the learner's
// (`turnsToRead`) and the curator's grounding — in place of a "User:" line: their agents' words, never the person's.
export const AGENTS_SAID = "Another machine's agents, not the user, wrote:";
// What the summary view keeps of a turn (the owner's of 11-08): an answer's head and its end — a reply says what is
// left to do at its end, which a head alone cut off — and of Filament's notices each one's first line, as a finished
// background command's output filled a turn's whole line.
const GIST_HEAD = 400;
const GIST_END = 400;
const NOTE_CHARS = 300;
const NOTES_HEAD = "With the message, Filament's notices, their first lines:";
/** An answer's last GIST_END characters, from a line's start where that leaves a quarter of them. @param {string} a */
const endOf = (a) => {
  if (a.length <= GIST_END) return a;
  const end = tailChars(a, GIST_END);
  const nl = end.indexOf("\n");
  return (nl >= 0 && end.length - nl > GIST_END / 4 ? end.slice(nl + 1) : end).trimStart();
};
/** An answer's head and end. @param {string} a */
const gistOf = (a) => (a.length <= GIST_HEAD + GIST_END + 40 ? a : `${headChars(a, GIST_HEAD)} … ${endOf(a)}`);
const NOTES_MOST = 6;
/** A text's first line. @param {string} s */
const firstLine = (s) => cap(String(s).trim().split("\n")[0].trim(), NOTE_CHARS);
/** Each notice's first line, NOTES_MOST at most. @param {readonly string[]} notices */
const firstLines = (notices) =>
  [...notices.slice(0, NOTES_MOST).map(firstLine), ...(notices.length > NOTES_MOST ? [`(${notices.length - NOTES_MOST} more)`] : [])].join("\n");
// Whether a view carries a turn. A turn Filament answered itself (`@mem`, `/help`, a refusal — `meta.command`) is about
// Filament, not the conversation: no view carries it, as the session composer (`modelTurns`) leaves it out of every
// request. Rewound turns stay out of every rendering (D11): the views feed @mem load, agent seeds, the memory tools and
// the learner, and a dropped line must not ride back in as live history. (Search still finds them, labelled rewound.)
export const viewed = (/** @type {any} */ t) => !t.meta?.command && !t.meta?.rewound;
/** Whether a turn was kept apart as it was begun (`beginTurn`'s `apart`): memory reads it for no other chat or call. @param {any} t */
export const apartTurn = (t) => !!t?.meta?.apart;
/** A key of a row's meta column in SQL, null where the column holds no JSON. @param {string} col @param {string} key */
const jsonAt = (col, key) => `(CASE WHEN json_valid(${col}) THEN json_extract(${col}, '$.${key}') END)`;
// A short human-readable preview of a stored message: its text, or the tool calls it makes when it has no text.
function previewOf(msg, capChars = 400) {
  const t = textOfMessage(msg);
  if (t.trim()) return cap(t, capChars);
  const calls = Array.isArray(msg?.content)
    ? msg.content
        .filter((b) => b?.type === "tool_use")
        .map((b) => `${b.name} ${JSON.stringify(b.input ?? {}).slice(0, 120)}`)
    : Array.isArray(msg?.tool_calls)
      ? msg.tool_calls.map(
          (c) => `${c.function?.name || c.name} ${String(c.function?.arguments || "").slice(0, 120)}`,
        )
      : [];
  return calls.length ? cap(calls.join("; "), capChars) : "";
}
// Cut a string at a UTF-8 byte budget without leaving half a character behind.
const capBytes = (s, n) => Buffer.from(s, "utf8").toString("utf8", 0, n).replace(/�+$/, "");
/**
 * The bytes of the pictures and files (PDFs, documents) a message carries as base64 — its own blocks' and its tool
 * results', in Anthropic's blocks or an OpenAI client's parts. The cap on a kept message does not count them: a message large for what was
 * attached to it is kept whole, so the chat's next turn sends it again as it was.
 * @param {any} msg @returns {number}
 */
function mediaBytes(msg) {
  let n = 0;
  /** @param {unknown} blocks */
  const walk = (blocks) => {
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if ((b?.type === "image" || b?.type === "document") && b.source?.type === "base64" && typeof b.source.data === "string") n += b.source.data.length;
      else if (b?.type === "image_url" && /^data:/.test(String(b.image_url?.url || ""))) n += String(b.image_url.url).length;
      else if (b?.type === "file" && /^data:/.test(String(b.file?.file_data || ""))) n += String(b.file.file_data).length;
      else if (b?.type === "tool_result") walk(b.content);
    }
  };
  walk(msg?.content);
  return n;
}
// What a grep shows of a turn that has the words (the filament-agent plan's Phase 4): its first few places, each the
// words with up to 80 characters before them and 120 after.
const GREP_PLACES = 3;
/** A word as a pattern that matches it as written. @param {string} w */
const literal = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The line a grep shows of a match in `s`, its whitespace squashed. @param {string} s @param {RegExpMatchArray} m */
const around = (s, m) => {
  const a = Math.max(0, Number(m.index) - 80);
  const b = Math.min(s.length, Number(m.index) + m[0].length + 120);
  return `${a ? "…" : ""}${s.slice(a, b).replace(/\s+/g, " ").trim()}${b < s.length ? "…" : ""}`;
};

// The message readers (textOfMessage, messageKind, …) live in core/messages.js; re-exported here for the callers
// that learned them from the archive.
export { textOfMessage, messageKind } from "../../core/messages.js";
// Free text → an FTS5 expression that cannot error. Each whitespace-separated word becomes a quoted phrase, so
// punctuation inside code tokens is safe and keeps its adjacency (`usage.js:227` is the phrase usage js 227,
// `rm -rf` is "rm" OR "-rf" → rm, rf). Words without a letter or digit are dropped. Phrases are OR-joined: bm25 ranks
// rows matching more of them higher. Returns null when nothing is searchable (the caller falls back to a substring scan).
export function ftsExpression(query) {
  const words = [
    ...new Set(
      String(query || "")
        .split(/\s+/)
        .filter((w) => /[\p{L}\p{N}]/u.test(w)),
    ),
  ];
  return words.length ? words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" OR ") : null;
}
// Keep the newest entries that fit the token budget, walking newest → oldest and stopping at the first overflow; the
// newest entry is always kept so a caller never gets nothing back. `entryAt(i)` makes the i-th of `count` entries
// (oldest first) when the walk reaches it, so what the budget leaves out is never read; the kept leave oldest → newest.
function fitBudget(count, entryAt, budgetTokens, reserved = 0) {
  let used = reserved;
  const kept = [];
  for (let i = count - 1; i >= 0; i--) {
    const entry = entryAt(i);
    const cost = estTokens(entry.chars);
    if (kept.length && used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(entry);
  }
  return { kept, tokens: used };
}
const normItem = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.!?;:,]+$/, "")
    .trim();

export class Archive {
  #stmts = new Map();
  #inTx = false;
  #closed = false;
  /** The count of this file's messages under way on a thread of its own (`MESSAGE_TOTALS`): its stop, and its end. @type {{ stop: Int32Array, done: Promise<void> } | null} */
  #counting = null;
  /**
   * Whether each chain read so far is the harness's own (`meta.native === true`), by its id: the one thing of its meta
   * `chainHead` reads, kept so a head never parses a meta that grows with the chat. Every writer that can change it
   * drops it (`updateMeta`, `setMeta`, the deletes); the others rewrite the meta with their own key changed alone.
   * @type {Map<string, boolean>}
   */
  #native = new Map();
  /**
   * The archive items each chain's injection log showed it by their `i<n>` refs, as read through its row `through`
   * (`#itemsShownIn`), by chain id: a check reads the rows logged since the last one, never the whole log again. The
   * chains checked longest ago go past `SHOWN_CHAINS`. A chain's entry goes with its rows (the deletes), and every
   * entry when a transaction rolls back.
   * @type {Map<string, { through: number, items: Set<number> }>}
   */
  #shown = new Map();
  /** The open questions that would retire a claim, by its id (`inbox.asking`); null until read after an inbox write. @type {Map<number, any> | null} */
  #asking = null;
  /** The name of each content block of a message `turnBodies` opened (`contentName`), by the block. @type {WeakMap<object, string>} */
  #contentNames = new WeakMap();
  /**
   * Where a turn's work first holds what a reader looks for (`workFrom`), by the turn's row and the reader's key: the
   * message's place, and the names of the work up to it, digested, which prove the place at each use — a turn's work
   * may be set anew (`setWork`), and a message's bytes never change once kept. Those looked for longest ago go past
   * `PLACES_KEPT`.
   * @type {Map<string, { at: number, names: string }>}
   */
  #places = new Map();
  /**
   * Each turn's count of tool legs (`toolLegs`), by the turn's row: the count, and the names of its work, digested, which
   * prove it at each use — a turn's work may be set anew (`setWork`), and a message's kind never changes once kept, nor is
   * one dropped: nothing deletes from `messages`, and whatever comes to delete one or change a kind must empty `#legs`
   * and `turn_legs`. Kept only
   * where the archive held every message of the work: one it does not hold yet may be kept later, and count. Those
   * counted longest ago go past `LEGS_KEPT`. `filed`: the file holds this count for these names too (`turn_legs`).
   * @type {Map<number, { names: string, n: number, filed: boolean }>}
   */
  #legs = new Map();
  /** This opening's mark on the versions of its turns (`turnsVersion`): another opening's — before a restart — are never taken for its own. */
  #turnsMark = randomBytes(4).toString("hex");
  /** Told after each row the claims feed gets (HarnessV3-Memory M7-D32), inside the writer's transaction: the service relays it, deferred. @type {(() => void) | null} */
  onClaimChange = null;
  /**
   * The Space of your own that shows a project, or null — the Space whose connectors and plugins its chats get. The
   * Spaces are not the archive's: the service relays the server's answer (session-settings.js `spaceLayerOf`).
   * @type {(projectId: string) => string | null}
   */
  spaceOf = () => null;
  /**
   * Whether another machine's agents' device holds Full control here (services/devices.js `fullControl`), read as it
   * stands: the devices are not the archive's, and the service relays the server's answer. None: no device does.
   * @type {(deviceId: string) => boolean}
   */
  fullControlOf = () => false;
  // `key`: 32-byte Buffer (bodies encrypted) or null (plaintext). `secretKey`: what seals the credentials a settings
  // layer holds (an MCP server's, HarnessV4_Settings_Plan HS-D8) — Filament's secret key, so they are sealed whether
  // or not the bodies are; `key` when not given. `index: false` skips the FTS copy (privacy.searchIndex).
  // `now` is injectable so tests get deterministic timestamps.
  /** @param {{ file?: string, key?: Buffer | null, secretKey?: Buffer | null, caps?: Record<string, number>, now?: () => number, index?: boolean, upgrades?: readonly UpgradeStep[] }} [o] */
  // `blockKeyOf`: memory's key of a message, which its blocks are kept under (brain.js `messageHash`) — a fork copies
  // the blocks of the messages it copies by it; without it a fork copies none. `upgrades`: the steps an older file
  // takes (UPGRADES; a test's own).
  constructor({ file, key = null, secretKey = undefined, caps = {}, now = () => Date.now(), index = true, blockKeyOf = null, upgrades = UPGRADES } = {}) {
    if (!file) throw new Error("Archive: a database file is required");
    for (const k of [key, secretKey])
      if (k != null && !(Buffer.isBuffer(k) && k.length === 32)) throw new Error("Archive: a key must be a 32-byte Buffer or null");
    this.file = file;
    this.key = key;
    this.secretKey = secretKey === undefined ? key : secretKey;
    this.now = now;
    this.index = index;
    this.caps = { messageBytes: 1048576, inputChars: 4000, ...caps };
    /** @type {((message: any) => string) | null} */
    this.blockKeyOf = blockKeyOf;
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000;");
    // The archive opens at this build's version (HarnessV3-AtHome AH-C1), or at an older one its steps upgrade
    // (`UPGRADES`). A file another build wrote with no way here is refused before anything in it is touched, in words
    // that say how to start over where Filament runs (`startOverWords`).
    const found = this.#versionOnFile();
    const path = found != null && found !== SCHEMA_VERSION ? upgradePath(found, SCHEMA_VERSION, upgrades) : null;
    if (found != null && found !== SCHEMA_VERSION && !path) {
      this.db.close();
      throw new Error(
        `${file} was written by another build of Filament (archive version ${found}; this build reads version ${SCHEMA_VERSION}). ${startOverWords()}`,
      );
    }
    /** The version this file was upgraded from as it opened, and where its copy as it was is kept; null where none was. @type {{ from: number, copy: string | null } | null} */
    this.upgraded = found != null && path ? { from: found, copy: this.#upgrade(file, found, path) } : null;
    // Under WAL, NORMAL syncs at checkpoints rather than at every commit: a crash of the process loses nothing, and
    // only a power loss or the OS's own crash can take back the last commits (SQLite's recommended setting for WAL,
    // the owner's choice). FULL made every commit wait on the disk, and a turn commits many times.
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
    this.db.exec(SCHEMA);
    this.db.exec(TURN_WRITES);
    const meta = Object.fromEntries(
      this.db
        .prepare("SELECT key, value FROM schema_meta")
        .all()
        .map((r) => [r.key, r.value]),
    );
    if (!meta.version) {
      const ins = this.#q("INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, ?)");
      ins.run("version", String(SCHEMA_VERSION));
      ins.run("encrypted", key ? "1" : "0");
      meta.encrypted = key ? "1" : "0";
    }
    // Mixing plaintext and encrypted bodies in one file would turn every read into a guess: refuse a mode change up front.
    if (meta.encrypted != null && meta.encrypted !== (key ? "1" : "0")) {
      this.db.close();
      throw new Error(
        meta.encrypted === "1"
          ? `${file} is an encrypted archive; open it with its key`
          : `${file} is a plaintext archive; open it without a key`,
      );
    }
    this.db.exec(MESSAGE_TOTALS);
    // The claims feed's name (HarnessV3-Memory M7-D32), made with the store: an id from another store is never read as
    // this one's.
    if (!this.schemaMetaGet("feed")) this.schemaMetaSet("feed", randomBytes(6).toString("hex"));
    /** @type {string} */
    this.feedEpoch = String(this.schemaMetaGet("feed"));
    // When this file began keeping the chats it deletes (`gone_chains`, the footprint plan): from then on every chat it
    // had is either here or there. A file with no stamp is stamped as it opens.
    if (!Number.isFinite(this.schemaMetaGet("goneSince"))) this.schemaMetaSet("goneSince", this.now());
    // When this file began keeping who begins each turn (`meta.by`, core/turn-by.js): a turn begun since with no mark is
    // the person's, whatever its words; one begun before is read by Filament's lines as they read. Stamped as it opens.
    if (!Number.isFinite(this.schemaMetaGet("bySince"))) this.schemaMetaSet("bySince", this.now());
    this.items = {
      add: (o) => this.#itemAdd(o),
      list: (o) => this.#itemList(o),
      get: (id) => this.#itemGet(id),
      byMemoryId: (m) => this.#itemsByMemoryId(m),
      /** The item with this text in the project and kind (the dedupe key), or null. @param {string | null} projectId @param {string} kind @param {string} text */
      withText: (projectId, kind, text) =>
        plain(this.#q("SELECT * FROM items WHERE project_id IS ? AND kind = ? AND text_norm = ?").get(projectId, kind, normItem(text))) || null,
      /** The standing claims in a slot of a project, oldest first. @param {string | null} projectId @param {string} slot */
      inSlot: (projectId, slot) =>
        this.#q("SELECT * FROM items WHERE project_id IS ? AND slot = ? AND status NOT IN ('dismissed', 'superseded') ORDER BY id").all(projectId, slot).map(plain),
      /**
       * Key a claim to a slot (its value may be unknown: a correction's replacement), or unkey it (null: an undone
       * keying, M4-1). @param {number} id @param {{ slot: string, value?: string | null, multi?: boolean } | null} s
       */
      setSlot: (id, s) =>
        this.#q("UPDATE items SET slot = ?, slot_value = ?, slot_multi = ?, updated_at = ? WHERE id = ?").run(
          s ? s.slot : null,
          s ? (s.value ?? null) : null,
          s ? (s.multi ? 1 : 0) : null,
          this.now(),
          id,
        ).changes > 0,
      /** Every claim of these kinds, whatever its standing, as its id, kind and words: what is read again when the reading of words for triggers changes (M5-2). @param {string[]} kinds @returns {{ id: number, kind: string, text: string }[]} */
      texts: (kinds) => this.#q(`SELECT id, kind, text FROM items WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY id`).all(...kinds).map(plain),
      /**
       * A project's corrections since `since` (the memory plan's f4): the claims the user's word put in place of another
       * (origin `correction`) in a session - one made on a page names no session of its own - each with the words of the
       * claim it replaced, oldest first. A claim on file the user was heard correcting to is the correction of the
       * session that heard it, then (its `heard` event's chain and time), not of the one it was first said in.
       * @param {string | null} projectId @param {number} since @returns {{ id: number, chain_id: string | null, text: string, old: string | null, created_at: number }[]}
       */
      correctionsSince: (projectId, since) =>
        this.#q(
          `WITH c AS (SELECT n.*, (SELECT e.id FROM item_events e WHERE e.item_id = n.id AND e.action = 'heard' AND e.undone_at IS NULL AND json_extract(e.detail_json, '$.chain') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS heard FROM items n WHERE n.project_id IS ? AND n.origin = 'correction')
           SELECT c.id, COALESCE(json_extract(h.detail_json, '$.chain'), c.chain_id) AS chain_id, c.text, COALESCE(h.at, c.created_at) AS created_at, (SELECT o.text FROM items o WHERE o.superseded_by = c.id ORDER BY o.id DESC LIMIT 1) AS old
           FROM c LEFT JOIN item_events h ON h.id = c.heard WHERE (h.id IS NOT NULL OR c.turn_id IS NOT NULL) AND COALESCE(h.at, c.created_at) >= ? ORDER BY COALESCE(h.at, c.created_at), c.id`,
        )
          .all(projectId, since)
          .map((r) => ({ id: Number(r.id), chain_id: r.chain_id == null ? null : String(r.chain_id), text: String(r.text ?? ""), old: r.old == null ? null : String(r.old), created_at: Number(r.created_at) || 0 })),
      /**
       * A project's suspicions since `since` (f4): each standing `suspected` event a session's learner filed, with the
       * why it gives, that the curator has not cleared since (a `cleared` event of its claim after it, as `eventCounts`
       * reads it) — its session, why, and the claim's words — oldest first.
       * @param {string | null} projectId @param {number} since @returns {{ id: number, item_id: number, chain: string | null, why: string, text: string, at: number }[]}
       */
      suspicionsSince: (projectId, since) =>
        this.#q(
          `SELECT e.id, e.item_id, e.at, json_extract(e.detail_json, '$.chain') AS chain, json_extract(e.detail_json, '$.why') AS why, i.text FROM items i JOIN item_events e ON e.item_id = i.id
           WHERE i.project_id IS ? AND e.action = 'suspected' AND e.undone_at IS NULL AND e.at >= ? AND COALESCE(json_extract(e.detail_json, '$.why'), '') <> ''
             AND e.id > COALESCE((SELECT MAX(c.id) FROM item_events c WHERE c.item_id = e.item_id AND c.action = 'cleared' AND c.undone_at IS NULL), 0)
           ORDER BY e.id`,
        )
          .all(projectId, since)
          .map((r) => ({ id: Number(r.id), item_id: Number(r.item_id), chain: r.chain == null ? null : String(r.chain), why: String(r.why ?? ""), text: String(r.text ?? ""), at: Number(r.at) || 0 })),
      /**
       * The standing claims of every project, and of none, in the slots about the user that this project's standing
       * claims hold (the memory plan's f5: subject "user"), oldest first. @param {string} projectId
       */
      inUserSlots: (projectId) =>
        this.#q(
          "SELECT * FROM items WHERE slot IN (SELECT DISTINCT slot FROM items WHERE project_id IS ? AND slot LIKE 'user · %' AND status NOT IN ('dismissed', 'superseded')) AND status NOT IN ('dismissed', 'superseded') ORDER BY id",
        )
          .all(projectId)
          .map(plain),
      /**
       * Where every standing claim stands now, cheaply: how many there are and the newest change among all claims — what
       * a cache over their words is keyed by. @returns {string}
       */
      standingStamp: () => {
        const r = this.#q("SELECT COUNT(*) AS n, MAX(updated_at) AS u, MAX(id) AS m FROM items WHERE status NOT IN ('dismissed', 'superseded')").get();
        return `${r?.n ?? 0}:${r?.u ?? 0}:${r?.m ?? 0}`;
      },
      /** Every standing claim's words, every project's (b4: how rare each word is across memory). @returns {string[]} */
      standingTexts: () => this.#q("SELECT text FROM items WHERE status NOT IN ('dismissed', 'superseded')").all().map((r) => String(r.text || "")),
      /** A project's standing claims (or the global ones: null), oldest first: what the curator reads (M4). @param {string | null} projectId */
      standing: (projectId) =>
        this.#q("SELECT * FROM items WHERE project_id IS ? AND status NOT IN ('dismissed', 'superseded') ORDER BY id").all(projectId).map(plain),
      /**
       * Whether a project's standing claims (or the global ones: null) changed after `since`: one filed (a reworded claim
       * is one filed in its place) or said again (a live `evidence` event) — what a curator pass waits for (the memory
       * plan's m1). The curator's own keying and the engine's copy are no change: a pass does not make the next one due.
       * @param {string | null} projectId @param {number} since
       */
      changedSince: (projectId, since) =>
        !!this.#q(
          `SELECT 1 FROM items i WHERE i.project_id IS ? AND i.status NOT IN ('dismissed', 'superseded') AND (
             (i.created_at > ? AND COALESCE(i.origin, '') <> 'curator')
             OR EXISTS (SELECT 1 FROM item_events e WHERE e.item_id = i.id AND e.action = 'evidence' AND e.at > ? AND e.undone_at IS NULL)
           ) LIMIT 1`,
        ).get(projectId, since, since),
      /**
       * When a scope's first standing claim was filed, 0 for none: before its first curator pass, its wait counts from
       * there (the memory plan's m1). @param {string | null} projectId @returns {number}
       */
      firstStandingAt: (projectId) =>
        Number(this.#q("SELECT MIN(created_at) AS at FROM items WHERE project_id IS ? AND status NOT IN ('dismissed', 'superseded')").get(projectId)?.at) || 0,
      /**
       * The claims a dossier rendered from claims may show (HarnessV3-Memory M4-7, M4-D11): a project's standing facts,
       * conventions, decisions, preferences, rules, procedures (M5-6) and threads filed after `since` that earned a
       * place — an open thread, the user's word (said, corrected or confirmed: the brain's `userBacked`), or said again
       * by another session (a live `evidence` event) — less the user's own rules, preferences and conventions (L0 shows
       * them); `triggered` says it is a pitfall (it has a trigger, M5-D1). The most important first, at most `limit`,
       * so a render reads a bounded number of rows however much the project holds; filtered before the limit, so no
       * number of claims that did not earn a place crowds out one that did.
       * @param {string} projectId @param {{ since?: number, limit?: number }} [o]
       */
      dossierPool: (projectId, { since = 0, limit = 300 } = {}) =>
        this.#q(
          `SELECT * FROM (SELECT *, (SELECT COUNT(*) FROM item_events e WHERE e.item_id = items.id AND e.action = 'evidence' AND e.undone_at IS NULL) AS evidence,
             (origin IN ('person', 'owner', 'correction', 'capture') OR status = 'confirmed') AS users,
             EXISTS (SELECT 1 FROM item_triggers t WHERE t.item_id = items.id) AS triggered
           FROM items WHERE project_id = ? AND status NOT IN ('dismissed', 'superseded') AND kind IN ('fact', 'convention', 'decision', 'preference', 'rule', 'procedure', 'thread') AND created_at > ?)
           WHERE NOT (users AND kind IN ('rule', 'preference', 'convention')) AND (kind = 'thread' OR users OR evidence > 0)
           ORDER BY importance DESC, id DESC LIMIT ?`,
        )
          .all(projectId, since, limit)
          .map(plain),
      /**
       * A project's standing procedures (M5-6), the most important first, at most `limit`: what a briefing with no task
       * to match a goal against shows whole (the owner's of 10-29).
       * @param {string} projectId @param {{ limit?: number }} [o]
       */
      procedures: (projectId, { limit = 20 } = {}) =>
        this.#q("SELECT * FROM items WHERE project_id = ? AND kind = 'procedure' AND status NOT IN ('dismissed', 'superseded') ORDER BY importance DESC, id DESC LIMIT ?")
          .all(projectId, limit)
          .map(plain),
      /** The items this one superseded. @param {number} id @returns {number[]} */
      replacing: (id) => this.#q("SELECT id FROM items WHERE superseded_by = ? ORDER BY id").all(id).map((r) => Number(r.id)),
      /**
       * The user's word of some kinds, the constitution's candidates (HarnessV3-Memory M3-6): a project's standing items
       * and the global ones (no project) that the person or the owner said, corrected or confirmed, or that are their own
       * words an agent quoted (`capture`, the memory plan's d3) — the brain's `userBacked` — oldest first, each with how many other sessions said it (`evidence`). `rows()` reads them as the
       * caller goes, so one that stops early decodes no more; `count` is how many there are.
       * @param {string | null} projectId @param {string[]} kinds
       * @returns {{ count: number, rows: () => Iterable<any> }}
       */
      usersWord: (projectId, kinds) => {
        const where = `(project_id IS ? OR project_id IS NULL) AND kind IN (${kinds.map(() => "?").join(",")}) AND status NOT IN ('dismissed', 'superseded') AND (origin IN ('person', 'owner', 'correction', 'capture') OR status = 'confirmed')`;
        const q = this.#q(`SELECT *, (SELECT COUNT(*) FROM item_events e WHERE e.item_id = items.id AND e.action = 'evidence' AND e.undone_at IS NULL) AS evidence FROM items WHERE ${where} ORDER BY id`);
        return {
          count: Number(this.#q(`SELECT COUNT(*) AS n FROM items WHERE ${where}`).get(projectId, ...kinds)?.n ?? 0),
          rows: function* () {
            for (const r of q.iterate(projectId, ...kinds)) yield plain(r);
          },
        };
      },
      /** The other sessions that said each of a project's claims again (its `evidence` events not undone, M2-5): item id → chain ids. @param {string} projectId @returns {Map<number, string[]>} */
      evidenceChains: (projectId) => {
        const m = new Map();
        const rows = this.#q(
          "SELECT e.item_id AS id, json_extract(e.detail_json, '$.chain') AS chain FROM item_events e JOIN items i ON i.id = e.item_id WHERE i.project_id IS ? AND e.action = 'evidence' AND e.undone_at IS NULL ORDER BY e.id",
        ).all(projectId);
        for (const r of rows) m.set(Number(r.id), [...(m.get(Number(r.id)) || []), String(r.chain)]);
        return m;
      },
      /**
       * How many standing items of these kinds each project holds, the global ones under null (HarnessV3-Memory M6-5:
       * the claim browser's list of where claims live). @param {string[]} kinds @returns {Map<string | null, number>}
       */
      scopeCounts: (kinds) =>
        new Map(
          this.#q(`SELECT project_id AS p, COUNT(*) AS n FROM items WHERE kind IN (${kinds.map(() => "?").join(",")}) AND status NOT IN ('dismissed', 'superseded') GROUP BY project_id`)
            .all(...kinds)
            .map((r) => [r.p == null ? null : String(r.p), Number(r.n)]),
        ),
      setStatus: (id, s, o) => this.#itemSetStatus(id, s, o),
      events: (id) => this.#itemEvents(id),
      /**
       * What a claim's confidence reads from its history (HarnessV3-Memory M3-6), for many claims in one statement: the
       * other sessions that said it (`evidence`, and when the last one did: `lastSaid`), the suspicions on it
       * (`suspected`: a session found it wrong, the memory plan's d4) and whether the turn it came from bears it out
       * (`grounded`, the curator's check of f2: holds); an undone one (M4-D6) does not count.
       * @param {number[]} ids @returns {Map<number, { evidence: number, suspected: number, grounded: number, lastSaid: number | null }>}
       */
      eventCounts: (ids) => {
        const m = new Map();
        const list = [...new Set((ids || []).filter((x) => Number.isInteger(x)))];
        if (!list.length) return m;
        for (const r of this.#q(
          `SELECT item_id AS id, action, COUNT(*) AS n, MAX(at) AS last FROM item_events e WHERE item_id ${IN_LIST} AND action IN ('evidence', 'suspected', 'grounded') AND undone_at IS NULL AND (action <> 'grounded' OR json_extract(detail_json, '$.verdict') = 'holds') AND (action <> 'suspected' OR id > COALESCE((SELECT MAX(c.id) FROM item_events c WHERE c.item_id = e.item_id AND c.action = 'cleared' AND c.undone_at IS NULL), 0)) GROUP BY item_id, action`,
        ).all(listParam(list))) {
          const c = m.get(Number(r.id)) || { evidence: 0, suspected: 0, grounded: 0, lastSaid: null };
          c[r.action] = Number(r.n);
          if (r.action === "evidence") c.lastSaid = Number(r.last);
          m.set(Number(r.id), c);
        }
        return m;
      },
      note: (id, action, o) => this.#itemEvent(id, action, o),
      /**
       * A trigger's last act in a conversation (HarnessV3-Memory M6-2, M7-3, M7-D63): `fired` when its reminder was said
       * there and not followed since, `followed` when it was, `kept` when its right way was taken there before it ever
       * fired, null when none of these. A conversation is a session's own, or a sub-agent's in it (the act's
       * `conversation`).
       * @param {number} itemId @param {string} conversation @param {string} shape @param {string} args @returns {"fired" | "followed" | "kept" | null}
       */
      lastAct: (itemId, conversation, shape, args) =>
        this.#q(
          "SELECT action FROM item_events WHERE item_id = ? AND action IN ('fired', 'followed', 'kept') AND COALESCE(json_extract(detail_json, '$.conversation'), json_extract(detail_json, '$.chain')) = ? AND json_extract(detail_json, '$.shape') = ? AND COALESCE(json_extract(detail_json, '$.args'), '') = ? ORDER BY id DESC LIMIT 1",
        ).get(itemId, conversation, shape, args)?.action ?? null,
      /**
       * Whether a claim's reminder was said in a conversation (`fired`; the act names its `conversation`, else its
       * `chain`, as `lastAct` reads it): one look at that claim's acts there, not its whole history, which grows with
       * every act. `bare`: only a reminder said with no right way (its `unless` empty, as
       * `!detail.unless` reads it: SQLite gives a JSON value out truthy where it is). A fired act's detail is JSON or
       * none: the acts index (`item_events_acts`) reads it.
       * @param {number} itemId @param {string} conversation @param {{ bare?: boolean }} [o] @returns {boolean}
       */
      firedIn: (itemId, conversation, { bare = false } = {}) => {
        const rows = this.#q(
          "SELECT json_extract(detail_json, '$.unless') AS unless FROM item_events WHERE item_id = ? AND action = 'fired' AND COALESCE(json_extract(detail_json, '$.conversation'), json_extract(detail_json, '$.chain')) = ?",
        ).all(itemId, conversation);
        return bare ? rows.some((r) => !r.unless) : rows.length > 0;
      },
      /** The reminders said in a session and the ones followed (M6-1), oldest first. @param {string} chainId */
      actsIn: (chainId) =>
        this.#q("SELECT * FROM item_events WHERE json_extract(detail_json, '$.chain') = ? AND action IN ('fired', 'followed') ORDER BY id").all(chainId).map(eventRow),
      /**
       * How often each claim's reminders were said and followed (M6-1), and its right way kept with no reminder said
       * (M7-D63), in all and by trigger (its shape and args, joined by a newline). @param {number[]} ids
       * @returns {Map<number, { fired: number, followed: number, kept: number, triggers: Map<string, { fired: number, followed: number, kept: number }> }>}
       */
      actCounts: (ids) => {
        const m = new Map();
        const list = [...new Set((ids || []).filter((x) => Number.isInteger(x)))];
        if (!list.length) return m;
        for (const r of this.#q(
          `SELECT item_id AS id, action, json_extract(detail_json, '$.shape') AS shape, COALESCE(json_extract(detail_json, '$.args'), '') AS args, COUNT(*) AS n FROM item_events WHERE item_id ${IN_LIST} AND action IN ('fired', 'followed', 'kept') GROUP BY item_id, action, shape, args`,
        ).all(listParam(list))) {
          const c = m.get(Number(r.id)) || { fired: 0, followed: 0, kept: 0, triggers: new Map() };
          c[r.action] += Number(r.n);
          if (r.shape != null) {
            const key = `${r.shape}\n${r.args}`;
            const t = c.triggers.get(key) || { fired: 0, followed: 0, kept: 0 };
            t[r.action] += Number(r.n);
            c.triggers.set(key, t);
          }
          m.set(Number(r.id), c);
        }
        return m;
      },
      /** The claims filed from one turn (M6-1), oldest first. @param {string} chainId @param {number} turnId */
      ofTurn: (chainId, turnId) => this.#q("SELECT * FROM items WHERE chain_id = ? AND turn_id = ? ORDER BY id").all(chainId, turnId).map(plain),
      setMemoryId: (id, m) => this.#itemSet(id, "memory_id", m),
      /** Who a claim is known from (`ITEM_ORIGINS`): a note the person is since quoted saying is theirs (the memory plan's d1). @param {number} id @param {string} origin */
      setOrigin: (id, origin) => {
        if (!ITEM_ORIGINS.includes(origin)) throw new Error(`Archive: bad item origin ${origin}`);
        return this.#itemSet(id, "origin", origin);
      },
      countsByChain: (ids) => this.#itemCountsByChain(ids),
    };
    this.outbox = {
      add: (itemId, op, args) => this.#outboxAdd(itemId, op, args),
      ready: (now, limit) => this.#outboxReady(now, limit),
      done: (id) => this.#outboxDone(id),
      retry: (id, error, nextAt) => this.#outboxRetry(id, error, nextAt),
      dead: (id, error) => this.#outboxDead(id, error),
      nextAt: () => this.#q("SELECT MIN(next_at) AS t FROM engine_outbox WHERE done_at IS NULL").get()?.t ?? null,
      status: () => this.#outboxStatus(),
      forItem: (itemId) => this.#q("SELECT * FROM engine_outbox WHERE item_id = ? ORDER BY id").all(itemId).map(plain),
      prune: (before) => this.#q("DELETE FROM engine_outbox WHERE done_at IS NOT NULL AND done_at < ?").run(before).changes,
    };
    // HarnessV3-Memory M3-3: the files and folders a claim names, as they were when it was anchored, and the state each
    // was last seen in (ok, changed, gone, symbol: a symbol the claim names gone from the file).
    this.anchors = {
      /** A claim's anchors, as `anchorsFor` made them; its card shows them (M7-D32). @param {number} itemId @param {any[]} rows */
      add: (itemId, rows) =>
        this.#tx(() => {
          this.#anchorsAdd(itemId, rows);
          if (rows?.length) this.#feedRow(itemId, "anchored");
        }),
      /** A claim anchored afresh: the old anchors replaced by these (a claim proved right against the files as they are). @param {number} itemId @param {any[]} rows */
      replace: (itemId, rows) =>
        this.#tx(() => {
          this.#q("DELETE FROM item_anchors WHERE item_id = ?").run(itemId);
          this.#anchorsAdd(itemId, rows);
        }),
      /** A claim's anchors, oldest first. @param {number} itemId */
      of: (itemId) =>
        this.#q("SELECT * FROM item_anchors WHERE item_id = ? ORDER BY at, path")
          .all(itemId)
          .map((r) => {
            const { symbols_json, ...rest } = plain(r);
            return { ...rest, symbols: parseJson(symbols_json, []) };
          }),
      /**
       * A project's standing claims of one kind that have anchors (M5-5): each claim once per anchor, with the anchor's
       * absolute path, the path as the claim named it and its kind (`anchor_path`, `anchor_name`, `anchor_kind`).
       * @param {string} projectId @param {string} kind
       */
      ofKind: (projectId, kind) =>
        this.#q(
          `SELECT i.*, a.path AS anchor_path, a.name AS anchor_name, a.kind AS anchor_kind FROM item_anchors a JOIN items i ON i.id = a.item_id
           WHERE i.project_id = ? AND i.kind = ? AND i.status NOT IN ('dismissed', 'superseded') ORDER BY i.id, a.path`,
        )
          .all(projectId, kind)
          .map(plain),
      /** The state an anchor was seen in now. @param {number} itemId @param {string} path @param {string} state */
      setState: (itemId, path, state) => this.#q("UPDATE item_anchors SET state = ?, checked_at = ? WHERE item_id = ? AND path = ?").run(state, this.now(), itemId, path).changes > 0,
      /** The anchored claims a session was shown, by item id. @param {string} chainId @returns {number[]} */
      shownIn: (chainId) =>
        this.#q(`SELECT DISTINCT item_id AS id FROM item_anchors WHERE item_id ${IN_LIST} ORDER BY item_id`)
          .all(listParam(this.#itemsShownIn(chainId)))
          .map((r) => Number(r.id)),
      /**
       * The paths the anchors of the claims a session was shown check (`shownIn`'s claims), each once, of the standing
       * ones (a retired claim's files are not looked at): what is stat'ed ahead, off the event loop, before they are
       * checked. @param {string} chainId @returns {string[]}
       */
      pathsShownIn: (chainId) =>
        this.#q(
          `SELECT DISTINCT a.path FROM item_anchors a JOIN items c ON c.id = a.item_id WHERE a.item_id ${IN_LIST} AND c.status NOT IN ('dismissed', 'superseded')`,
        )
          .all(listParam(this.#itemsShownIn(chainId)))
          .map((r) => String(r.path)),
    };
    // HarnessV3-Memory M4-1: the curator's passes. Each is a row its actions name (`item_events.run_id`), so a pass can
    // be undone; undoing marks the events it reverses (M4-D6), and an undone event stops counting.
    this.curator = {
      /**
       * A pass begins. `owner`: who runs it (HarnessV3-Readiness RD1 e), kept in its detail until its end overwrites it,
       * so a pass a killed Filament left open can be told from one still running. Every pass names one.
       * @param {{ projectId: string | null, reason: string, model?: string | null, owner: { host: string, pid: number, instance: string } }} o @returns {number}
       */
      start: ({ projectId, reason, model = null, owner }) => {
        if (!owner) throw new Error("a curator pass names its owner");
        return Number(
          this.#q("INSERT INTO curator_runs (project_id, reason, model, started_at, detail_json) VALUES (?, ?, ?, ?, ?)").run(projectId, reason, model, this.now(), JSON.stringify({ owner }))
            .lastInsertRowid,
        );
      },
      /** The passes not ended, oldest first: running, or left open by a Filament that was killed. */
      open: () => this.#q("SELECT * FROM curator_runs WHERE ended_at IS NULL ORDER BY id").all().map(runRow),
      /** A pass ends: the model calls it made, the actions it took, its error, and what each step did (counts). */
      end: (/** @type {number} */ id, { calls = 0, actions = 0, error = null, detail = null } = {}) =>
        this.#q("UPDATE curator_runs SET calls = ?, actions = ?, error = ?, detail_json = ?, ended_at = ? WHERE id = ?").run(
          calls,
          actions,
          error == null ? null : String(error).slice(0, 300),
          detail ? JSON.stringify(detail) : null,
          this.now(),
          id,
        ).changes > 0,
      /** The model calls a pass has made so far, written as it makes them (M7-D70): a pass cut short still counts. */
      count: (/** @type {number} */ id, /** @type {number} */ calls) => this.#q("UPDATE curator_runs SET calls = ? WHERE id = ?").run(calls, id).changes > 0,
      /** @param {number} id */
      get: (id) => runRow(this.#q("SELECT * FROM curator_runs WHERE id = ?").get(id)),
      /** A project's passes, or every project's (`projectId` undefined), newest first. */
      list: ({ projectId = /** @type {string | null | undefined} */ (undefined), limit = 20 } = {}) =>
        (projectId === undefined
          ? this.#q("SELECT * FROM curator_runs ORDER BY id DESC LIMIT ?").all(limit)
          : this.#q("SELECT * FROM curator_runs WHERE project_id IS ? ORDER BY id DESC LIMIT ?").all(projectId, limit)
        ).map(runRow),
      /** When a project's last pass began (0: never). @param {string | null} projectId */
      lastStart: (projectId) => Number(this.#q("SELECT MAX(started_at) AS t FROM curator_runs WHERE project_id IS ?").get(projectId)?.t ?? 0),
      /** A pass's actions still standing (not undone), newest first. @param {number} runId */
      events: (runId) =>
        this.#q("SELECT * FROM item_events WHERE run_id = ? AND undone_at IS NULL ORDER BY id DESC")
          .all(runId)
          .map(eventRow),
      /** One event, by its id. @param {number} id */
      event: (id) => {
        const r = this.#q("SELECT * FROM item_events WHERE id = ?").get(id);
        return r ? eventRow(r) : null;
      },
      /** An event reversed: marked, never deleted. @param {number} id */
      undoneEvent: (id) => this.#q("UPDATE item_events SET undone_at = ? WHERE id = ? AND undone_at IS NULL").run(this.now(), id).changes > 0,
      /** A pass undone, and by whom. @param {number} id @param {string} by */
      undone: (id, by) => this.#q("UPDATE curator_runs SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL").run(this.now(), by, id).changes > 0,
      /**
       * Which of these claims the merge looked up by meaning (the memory plan's f6: `item_near`, one row a claim, the pass
       * that did). @param {number[]} ids @returns {Set<number>}
       */
      nearLooked: (ids) => {
        const out = new Set();
        for (let i = 0; i < ids.length; i += 500) {
          const part = ids.slice(i, i + 500);
          for (const r of this.#q(`SELECT item_id FROM item_near WHERE item_id IN (${part.map(() => "?").join(", ")})`).all(...part)) out.add(Number(r.item_id));
        }
        return out;
      },
      /** These claims looked up by meaning in a pass — those that still stand on file. @param {number[]} ids @param {number | null} runId */
      lookedNear: (ids, runId) => {
        const put = this.#q(
          "INSERT INTO item_near (item_id, run_id, at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM items WHERE id = ?) ON CONFLICT(item_id) DO UPDATE SET run_id = excluded.run_id, at = excluded.at",
        );
        for (const id of ids) put.run(id, runId, this.now(), id);
      },
      /** A pass undone: the claims it looked up by meaning are looked up again. @param {number} runId */
      undoneNear: (runId) => this.#q("DELETE FROM item_near WHERE run_id = ?").run(runId).changes,
      /** These claims looked up by meaning again: one standing again, or a pair's verdict undone. @param {number[]} ids */
      forgetNear: (ids) => {
        const drop = this.#q("DELETE FROM item_near WHERE item_id = ?");
        for (const id of ids) if (Number.isInteger(Number(id))) drop.run(Number(id));
      },
    };
    // HarnessV3-Memory M4-6: the review inbox — what the curator would do to the user's word, asked instead of done.
    // A question is raised once per key, ever: a rejected one never comes back.
    this.inbox = {
      /**
       * @param {{ projectId: string | null, kind: string, key: string, itemIds?: number[], proposal: any, reason: string, run?: number | null }} q
       * @returns {{ id: number, raised: boolean }}
       */
      add: ({ projectId, kind, key, itemIds = [], proposal, reason, run = null }) =>
        this.#tx(() => {
          const had = this.#q("SELECT id FROM inbox WHERE key = ?").get(key);
          if (had) return { id: Number(had.id), raised: false };
          const r = this.#q(
            "INSERT INTO inbox (project_id, kind, key, item_ids_json, proposal_json, reason, run_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
          ).run(projectId, kind, key, JSON.stringify(itemIds), JSON.stringify(proposal), String(reason).slice(0, 400), run, this.now());
          this.#asking = null;
          // Each claim it names shows it is asked about (M7-D32).
          for (const id of this.#questionClaims({ itemIds, proposal })) this.#feedRow(id, "asked");
          return { id: Number(r.lastInsertRowid), raised: true };
        }),
      /** @param {number} id */
      get: (id) => inboxRow(this.#q("SELECT * FROM inbox WHERE id = ?").get(id)),
      /** Whether a question with this key was ever raised. @param {string} key */
      has: (key) => !!this.#q("SELECT 1 AS x FROM inbox WHERE key = ?").get(key),
      /** Every question of these kinds a project was ever asked, whatever its status, oldest first (f4). @param {string[]} kinds @param {string | null} projectId */
      ofKinds: (kinds, projectId) =>
        this.#q(`SELECT * FROM inbox WHERE kind IN (${kinds.map(() => "?").join(",")}) AND project_id IS ? ORDER BY id`)
          .all(...kinds, projectId)
          .map(inboxRow),
      /**
       * Questions in a status, oldest first: a project's and the global ones, or every project's (`projectId` undefined).
       * @param {{ projectId?: string | null, status?: string, limit?: number }} [o]
       */
      list: ({ projectId = undefined, status = "open", limit = 50 } = {}) =>
        (projectId === undefined
          ? this.#q("SELECT * FROM inbox WHERE status = ? ORDER BY id LIMIT ?").all(status, limit)
          : this.#q("SELECT * FROM inbox WHERE status = ? AND (project_id IS ? OR project_id IS NULL) ORDER BY id LIMIT ?").all(status, projectId, limit)
        ).map(inboxRow),
      /** The open questions of a project and the global ones. @param {string | null} projectId */
      count: (projectId) => Number(this.#q("SELECT COUNT(*) AS n FROM inbox WHERE status = 'open' AND (project_id IS ? OR project_id IS NULL)").get(projectId)?.n ?? 0),
      /**
       * Close an open question: accepted, rejected, or withdrawn (its pass undone, or its claims changed since).
       * @param {number} id @param {{ status: "accepted" | "rejected" | "withdrawn", by: string, outcome?: any }} o
       */
      decide: (id, { status, by, outcome = null }) =>
        this.#tx(() => {
          const closed =
            this.#q("UPDATE inbox SET status = ?, decided_at = ?, decided_by = ?, outcome_json = ? WHERE id = ? AND status = 'open'").run(
              status,
              this.now(),
              by,
              outcome == null ? null : JSON.stringify(outcome),
              id,
            ).changes > 0;
          if (!closed) return false;
          this.#asking = null;
          // Each claim it named is no longer asked about (M7-D32).
          for (const c of this.#questionClaims(inboxRow(this.#q("SELECT * FROM inbox WHERE id = ?").get(id)))) this.#feedRow(c, "decided", { by });
          return true;
        }),
      /**
       * The open questions that would retire a claim, by the claim's id: what a line serving it says it is in question
       * for (brain `#standing`). Read on every ranked claim, so it is kept until an inbox write.
       * @returns {Map<number, any>}
       */
      asking: () =>
        (this.#asking ??= new Map(
          this.#q("SELECT * FROM inbox WHERE status = 'open' AND kind = 'retire' ORDER BY id")
            .all()
            .map(inboxRow)
            .map((q) => [Number(q.proposal?.id), q]),
        )),
      /**
       * The open questions that would put a claim in another's place, by the claim that would come in: what its card
       * says it waits on (brain `#card`, M6-7). Read once a view. @returns {Map<number, any>}
       */
      awaiting: () =>
        new Map(
          this.#q("SELECT * FROM inbox WHERE status = 'open' ORDER BY id")
            .all()
            .map(inboxRow)
            .filter((q) => q.proposal?.replacement != null)
            .map((q) => [Number(q.proposal.replacement), q]),
        ),
      /** The open questions a pass raised. @param {number} runId */
      byRun: (runId) => this.#q("SELECT * FROM inbox WHERE run_id = ? AND status = 'open' ORDER BY id").all(runId).map(inboxRow),
      /**
       * The open questions about a claim: what they would retire or correct, what would replace it, or the claim they
       * would keep in every project (`pick`, the memory plan's f5). @param {number} itemId
       */
      about: (itemId) =>
        this.#q("SELECT * FROM inbox WHERE status = 'open' ORDER BY id")
          .all()
          .map(inboxRow)
          .filter((q) => Number(q.proposal?.id) === itemId || Number(q.proposal?.replacement) === itemId || Number(q.proposal?.pick) === itemId),
    };
    // HarnessV3-Memory M4-7: a project's dossier, versioned — a view over its standing claims, each line citing them.
    this.dossiers = {
      /**
       * A new version of a project's dossier. `basis`: what it was written from (the standing claims and sessions), so a
       * pass writes a new one only when that moved.
       * @param {{ projectId: string, sections: any[], cites: number[], basis: string, model?: string | null, run?: number | null }} d
       * @returns {{ id: number, version: number }}
       */
      add: ({ projectId, sections, cites, basis, model = null, run = null }) =>
        this.#tx(() => {
          const version = Number(this.#q("SELECT COALESCE(MAX(version), 0) AS v FROM dossiers WHERE project_id = ?").get(projectId)?.v ?? 0) + 1;
          const r = this.#q("INSERT INTO dossiers (project_id, version, sections_json, cites_json, basis, model, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
            projectId,
            version,
            JSON.stringify(sections),
            JSON.stringify(cites),
            basis,
            model,
            run,
            this.now(),
          );
          // Its lines cite claims: a page that shows them reads it again (M7-D32).
          this.#feedRow(null, "dossier", { projectId, by: "curator" });
          return { id: Number(r.lastInsertRowid), version };
        }),
      /** A project's newest version not undone, or null. @param {string} projectId */
      latest: (projectId) => dossierRow(this.#q("SELECT * FROM dossiers WHERE project_id = ? AND undone_at IS NULL ORDER BY version DESC LIMIT 1").get(projectId)),
      /** @param {number} id */
      get: (id) => dossierRow(this.#q("SELECT * FROM dossiers WHERE id = ?").get(id)),
      /** The versions a pass wrote. @param {number} runId */
      byRun: (runId) => this.#q("SELECT * FROM dossiers WHERE run_id = ? AND undone_at IS NULL ORDER BY id").all(runId).map(dossierRow),
      /** A version undone with its pass: the one before it is the latest again. @param {number} id */
      undone: (id) =>
        this.#tx(() => {
          if (!(this.#q("UPDATE dossiers SET undone_at = ? WHERE id = ? AND undone_at IS NULL").run(this.now(), id).changes > 0)) return false;
          this.#feedRow(null, "dossier", { projectId: this.#q("SELECT project_id FROM dossiers WHERE id = ?").get(id)?.project_id ?? null });
          return true;
        }),
    };
    // A project's topic pages (the memory plan's f7), versioned like its dossier: a topic's standing claims folded into
    // lines, each citing them. `topic`: the rule's key that groups the claims (`about:<subject>`, `dir:<folder>`);
    // `slug`: the name a page is asked for by (`page:<slug>`), kept by its topic from its first version; `sources`: the
    // claims it was written from, each `[id, a hash of its words]`, so a pass tells how far its topic moved since.
    const latestPages = `SELECT * FROM pages p WHERE p.project_id = ? AND p.undone_at IS NULL AND p.version = (SELECT MAX(q.version) FROM pages q WHERE q.project_id = p.project_id AND q.topic = p.topic AND q.undone_at IS NULL)`;
    this.pages = {
      /**
       * A new version of a topic's page. @param {{ projectId: string, topic: string, slug: string, title: string, sections: any[], cites: number[], sources: [number, string][], basis: string, model?: string | null, run?: number | null }} p
       * @returns {{ id: number, version: number }}
       */
      add: ({ projectId, topic, slug, title, sections, cites, sources, basis, model = null, run = null }) =>
        this.#tx(() => {
          const version = Number(this.#q("SELECT COALESCE(MAX(version), 0) AS v FROM pages WHERE project_id = ? AND topic = ?").get(projectId, topic)?.v ?? 0) + 1;
          const r = this.#q(
            "INSERT INTO pages (project_id, topic, slug, title, version, sections_json, cites_json, sources_json, basis, model, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(projectId, topic, slug, title, version, JSON.stringify(sections), JSON.stringify(cites), JSON.stringify(sources), basis, model, run, this.now());
          return { id: Number(r.lastInsertRowid), version };
        }),
      /** A topic's newest version not undone, or null. @param {string} projectId @param {string} topic */
      latest: (projectId, topic) => pageRow(this.#q("SELECT * FROM pages WHERE project_id = ? AND topic = ? AND undone_at IS NULL ORDER BY version DESC LIMIT 1").get(projectId, topic)),
      /** Each topic's newest version not undone, by slug. @param {string} projectId */
      list: (projectId) => this.#q(`${latestPages} ORDER BY p.slug`).all(projectId).map(pageRow),
      /** The page asked for by its slug, its newest version not undone, or null. @param {string} projectId @param {string} slug */
      bySlug: (projectId, slug) => pageRow(this.#q(`${latestPages} AND p.slug = ? LIMIT 1`).get(projectId, slug)),
      /**
       * The slug a topic's page goes by: the one its first version took, else `want`, numbered where another topic of
       * the project took it. @param {string} projectId @param {string} topic @param {string} want
       */
      slugFor: (projectId, topic, want) => {
        const had = this.#q("SELECT slug FROM pages WHERE project_id = ? AND topic = ? ORDER BY version LIMIT 1").get(projectId, topic)?.slug;
        if (had) return String(had);
        const taken = new Set(this.#q("SELECT DISTINCT slug FROM pages WHERE project_id = ? AND topic != ?").all(projectId, topic).map((r) => String(r.slug)));
        let slug = want;
        for (let n = 2; taken.has(slug); n++) slug = `${want}-${n}`;
        return slug;
      },
      /** @param {number} id */
      get: (id) => pageRow(this.#q("SELECT * FROM pages WHERE id = ?").get(id)),
      /** The versions a pass wrote. @param {number} runId */
      byRun: (runId) => this.#q("SELECT * FROM pages WHERE run_id = ? AND undone_at IS NULL ORDER BY id").all(runId).map(pageRow),
      /** A version undone with its pass: the one before it is its topic's latest again. @param {number} id */
      undone: (id) => this.#q("UPDATE pages SET undone_at = ? WHERE id = ? AND undone_at IS NULL").run(this.now(), id).changes > 0,
    };
    // HarnessV3-Memory M5-1: the tool calls a claim is said on (a pitfall is a claim with a trigger, M5-D1): a shape,
    // with `args`, the words that make a call of it the mistaken one (M5-D31, '' for every call of the shape). `source`
    // says where a trigger came from: "words", read from the claim's own words (M5-2), or "seen", a failure the miner
    // saw put right (M5-4).
    this.triggers = {
      /**
       * A claim's triggers from one source, replaced by these.
       * @param {number} itemId @param {"words" | "seen"} source @param {{ tool: string, shape: string, args?: string, unless?: string | null }[]} rows
       */
      set: (itemId, source, rows) =>
        this.#tx(() => {
          const was = JSON.stringify(this.#q("SELECT tool, shape, args, unless FROM item_triggers WHERE item_id = ? AND source = ? ORDER BY tool, shape, args").all(itemId, source));
          this.#q("DELETE FROM item_triggers WHERE item_id = ? AND source = ?").run(itemId, source);
          const ins = this.#q("INSERT OR IGNORE INTO item_triggers (item_id, tool, shape, args, unless, source, at) VALUES (?, ?, ?, ?, ?, ?, ?)");
          for (const t of rows) ins.run(itemId, t.tool, t.shape, t.args ?? "", t.unless ?? null, source, this.now());
          // A card shows its triggers: read anew to the same ones, nothing changed (M7-D32).
          if (JSON.stringify(this.#q("SELECT tool, shape, args, unless FROM item_triggers WHERE item_id = ? AND source = ? ORDER BY tool, shape, args").all(itemId, source)) !== was)
            this.#feedRow(itemId, "triggers");
        }),
      /** A claim's triggers. @param {number} itemId */
      of: (itemId) => this.#q("SELECT tool, shape, args, unless, source, at FROM item_triggers WHERE item_id = ? ORDER BY tool, shape, args").all(itemId).map(plain),
      /**
       * The standing claims of a project, or global, with a trigger on this tool and one of these shapes: each claim
       * once per trigger, with the trigger (`trigger_shape`, `trigger_args`, `trigger_unless`).
       * @param {string | null} projectId @param {string} tool @param {string[]} shapes
       */
      matching: (projectId, tool, shapes) =>
        shapes.length
          ? this.#q(
              `SELECT i.*, t.shape AS trigger_shape, t.args AS trigger_args, t.unless AS trigger_unless FROM item_triggers t JOIN items i ON i.id = t.item_id
               WHERE t.tool = ? AND t.shape ${IN_LIST} AND (i.project_id IS ? OR i.project_id IS NULL) AND i.status NOT IN ('dismissed', 'superseded')
               ORDER BY i.id, t.shape, t.args`,
            )
              .all(tool, listParam(shapes), projectId)
              .map(plain)
          : [],
      /**
       * The standing claims of a project, or global, with a trigger on any of these tools (HarnessV3-Memory M7-1: the
       * pitfalls of the tools a worker has), each claim once, oldest first.
       * @param {string | null} projectId @param {string[]} tools
       */
      onTools: (projectId, tools) =>
        tools.length
          ? this.#q(
              `SELECT i.* FROM items i WHERE EXISTS (SELECT 1 FROM item_triggers t WHERE t.item_id = i.id AND t.tool ${IN_LIST})
               AND (i.project_id IS ? OR i.project_id IS NULL) AND i.status NOT IN ('dismissed', 'superseded') ORDER BY i.id`,
            )
              .all(listParam(tools), projectId)
              .map(plain)
          : [],
    };
    // HarnessV3-Memory M7-D32: the claims feed — every change a claim's card shows, and a dossier's, in order, by an id
    // never reused (AUTOINCREMENT), written by the write it tells of. The file's own sequence, named: the connection's
    // TEMP turn writes (`TURN_WRITES`) keep a sqlite_sequence of their own, which an unnamed one would find first.
    const fed = () => Number(this.#q("SELECT seq FROM main.sqlite_sequence WHERE name = 'claim_feed'").get()?.seq ?? 0);
    this.feed = {
      /**
       * Where the feed stands: its epoch, the newest id given (0: none yet), and the newest a prune took (0: none). An id
       * at or past `pruned` still finds every row after it; a claim's delete takes its own rows and says `deleted`.
       * @returns {{ epoch: string, last: number, pruned: number }}
       */
      position: () => ({ epoch: this.feedEpoch, last: fed(), pruned: Number(this.schemaMetaGet("feedPruned") ?? 0) }),
      /**
       * The rows after `after`, oldest first, at most `limit`; with `project`, those of its claims and dossier, of the
       * global claims, and of a claim moved out of it. `through`: how far it looked, the cursor of the next read.
       * @param {{ after?: number, limit?: number, project?: string }} [o]
       * @returns {{ rows: any[], through: number }}
       */
      after: ({ after = 0, limit = 200, project = undefined } = {}) => {
        const rows = (
          project === undefined
            ? this.#q("SELECT * FROM claim_feed WHERE id > ? ORDER BY id LIMIT ?").all(after, limit)
            : this.#q("SELECT * FROM claim_feed WHERE id > ? AND (project_id IS ? OR project_id IS NULL OR from_project IS ?) ORDER BY id LIMIT ?").all(after, project, project, limit)
        ).map(plain);
        return { rows, through: rows.length === limit ? Number(rows[rows.length - 1].id) : Math.max(after, fed()) };
      },
      /**
       * The rows written before `before` taken (FEED_DAYS), oldest first and none after one kept; the newest id taken is
       * kept as `pruned` (every row up to it is gone, so the next prune's is newer). → how many went.
       * @param {number} before
       */
      prune: (before) =>
        this.#tx(() => {
          const top = Number(this.#q("SELECT MAX(id) AS n FROM claim_feed WHERE at < ?").get(before)?.n ?? 0);
          if (!top) return 0;
          this.schemaMetaSet("feedPruned", top);
          return this.#q("DELETE FROM claim_feed WHERE id <= ?").run(top).changes;
        }),
    };
    // HarnessV3-Memory M7-4: how each finished piece of an agent's work went, as counts, never words (M7-D48). A row is
    // its session's: its project is the session's as it stands, so a moved session takes its rows, and they go with the
    // session (M7-D51).
    this.outcomes = {
      /**
       * One outcome, now, not corrected yet. → its id.
       * @param {{ chain: string, turn: number | null, request: string | null, kind: string, agent: string | null, model: string, did: string, counts: any, ended: string, rounds: number, calls: number, tokensIn: number, tokensOut: number, usd: number | null, ms: number }} o
       */
      add: (o) =>
        Number(
          this.#q(
            "INSERT INTO outcomes (at, chain_id, turn_id, request_id, kind, agent, model, did, counts_json, ended, rounds, calls, tokens_in, tokens_out, usd, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(this.now(), o.chain, o.turn, o.request, o.kind, o.agent, o.model, o.did, JSON.stringify(o.counts), o.ended, o.rounds, o.calls, o.tokensIn, o.tokensOut, o.usd, o.ms).lastInsertRowid,
        ),
      /**
       * The user's correction (M7-D50): the harness turn's outcome on the turn whose reply the message of `turnId`
       * answers (`turnBefore`), not corrected yet, is corrected by the user, now — never an older turn's. → how many
       * were marked. @param {string} chainId @param {number} turnId
       */
      correctTurn: (chainId, turnId) => {
        const before = this.turnBefore(chainId, turnId);
        return before
          ? this.#q("UPDATE outcomes SET corrected = 'user', corrected_at = ? WHERE chain_id = ? AND turn_id = ? AND kind = 'turn' AND corrected IS NULL").run(this.now(), chainId, before.id).changes
          : 0;
      },
      /**
       * The lead's correction (M7-D50): a worker's outcome, by the request its run made, not corrected yet, is
       * corrected by its lead, now — a follow-up that says what fell short. → how many were marked.
       * @param {string} chainId @param {string} requestId
       */
      correctWorker: (chainId, requestId) =>
        this.#q("UPDATE outcomes SET corrected = 'lead', corrected_at = ? WHERE chain_id = ? AND request_id = ? AND kind = 'worker' AND corrected IS NULL").run(this.now(), chainId, requestId).changes,
      /**
       * The outcomes written since `since`, oldest first, each with its session's project; in `project` when one is
       * named, of `kind` when one is. @param {{ since: number, project?: string | null, kind?: string | null }} o
       */
      list: ({ since, project = null, kind = null }) =>
        this.#q(
          "SELECT o.*, c.project_id AS project_id FROM outcomes o JOIN chains c ON c.id = o.chain_id WHERE o.at >= ? AND (? IS NULL OR c.project_id = ?) AND (? IS NULL OR o.kind = ?) ORDER BY o.id",
        )
          .all(since, project, project, kind, kind)
          .map(outcomeRow),
      /**
       * The turns of a project the user corrected since `since` (the memory plan's f4), oldest first: each one's session
       * and turn. @param {{ since: number, project: string | null }} o @returns {{ chain_id: string, turn_id: number, at: number }[]}
       */
      correctedSince: ({ since, project }) =>
        this.#q(
          "SELECT o.chain_id, o.turn_id, o.at FROM outcomes o JOIN chains c ON c.id = o.chain_id WHERE o.at >= ? AND o.kind = 'turn' AND o.corrected = 'user' AND o.turn_id IS NOT NULL AND c.project_id IS ? ORDER BY o.id",
        )
          .all(since, project)
          .map((r) => ({ chain_id: String(r.chain_id), turn_id: Number(r.turn_id), at: Number(r.at) || 0 })),
      /** Those written before `before` taken (OUTCOME_DAYS). → how many went. @param {number} before */
      prune: (before) => this.#q("DELETE FROM outcomes WHERE at < ?").run(before).changes,
    };
    this.injections = {
      add: (o) => this.#injAdd(o),
      markUsed: (r, u, ids) => this.#injMarkUsed(r, u, ids),
      recent: (l) => this.#injRecent(l),
      neverUsedCount: (id) => this.#injNeverUsed(id),
      /**
       * How each memory's showings in a turn's related memory were judged (the memory plan's d5): the showings judged,
       * those used, and the sessions of the judged ones. A briefing's are not counted: a dossier line shows the claims it
       * cites in its own words, which the reply is judged against, once a session. A ref never shown in a turn's block is
       * not in the map. @param {string[]} refs @returns {Map<string, { judged: number, used: number, sessions: number }>}
       */
      judged: (refs) => this.#injJudged(refs),
      forRequest: (r) => this.#injForRequest(r),
      forChain: (c, l) => this.#injForChain(c, l),
      chainsShown: (refs, since) => this.#injChainsShown(refs, since),
      /**
       * The ids a session was shown since `since` (HarnessV3-Memory M7-1: what its sub-agent hears was corrected since),
       * each once, the most recently shown first; with `through`, only what it was shown up to that turn (its id), a
       * request on no turn included (the memory plan's d4). @param {string} chainId @param {number} since
       * @param {number | null} [through] @returns {string[]}
       */
      shownIn: (chainId, since, through = null) =>
        (through == null
          ? this.#q("SELECT j.memory_id AS ref, MAX(i.id) AS last FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.chain_id = ? AND i.created_at >= ? GROUP BY j.memory_id ORDER BY last DESC").all(String(chainId), since)
          : this.#q("SELECT j.memory_id AS ref, MAX(i.id) AS last FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.chain_id = ? AND i.created_at >= ? AND (i.turn_id IS NULL OR i.turn_id <= ?) GROUP BY j.memory_id ORDER BY last DESC").all(String(chainId), since, through)
        ).map((r) => String(r.ref)),
      /**
       * What one turn's requests were shown (HarnessV3-Memory M6-1), oldest first: each injection's layer and tokens, and
       * the ids it carried in the order it showed them, each with whether the reply used it (null: not judged yet).
       * @param {string} chainId @param {number} turnId
       * @returns {{ kind: string, tokens: number, ids: { ref: string, used: boolean | null }[] }[]}
       */
      ofTurn: (chainId, turnId) => {
        const used = this.#q("SELECT memory_id AS ref, used FROM injection_ids WHERE injection_id = ?");
        return this.#q("SELECT id, kind, tokens, ids_json FROM injections WHERE chain_id = ? AND turn_id = ? ORDER BY id")
          .all(chainId, turnId)
          .map((r) => {
            const judged = new Map(used.all(r.id).map((u) => [String(u.ref), u.used == null ? null : !!u.used]));
            return { kind: String(r.kind ?? ""), tokens: Number(r.tokens || 0), ids: parseJson(r.ids_json, []).map((/** @type {any} */ ref) => ({ ref: String(ref), used: judged.get(String(ref)) ?? null })) };
          });
      },
      /** A session's briefing as it was logged when built: its turn, ids and tokens, or null. @param {string} chainId */
      briefingOf: (chainId) => {
        const r = this.#q("SELECT turn_id, ids_json, tokens FROM injections WHERE chain_id = ? AND kind = 'briefing' ORDER BY id DESC LIMIT 1").get(chainId);
        return r ? { turnId: r.turn_id == null ? null : Number(r.turn_id), ids: parseJson(r.ids_json, []), tokens: Number(r.tokens || 0) } : null;
      },
      creditLatest: (ref) => this.#injCreditLatest(ref),
      /**
       * Memories a session's agent looked up again (its search answered them): each one's latest showing in that session
       * counts as a use. → the refs credited, each once; one never shown there is not. @param {string} chainId @param {string[]} refs
       */
      creditShownIn: (chainId, refs, kind = null) => this.#injCreditShownIn(chainId, refs, kind),
      /**
       * How often each memory was shown since `since`, how many of those showings were judged, and how many used.
       * @param {string[]} refs @param {number} since @returns {Map<string, { shown: number, judged: number, used: number }>}
       */
      useCounts: (refs, since) => this.#injUseCounts(refs, since),
      /**
       * Per memory, its last `last` judged showings of `kind`, newest first: how many were judged (at most `last`) and
       * used (the memory plan's f3: a rate that moves on new verdicts alone, never as time passes).
       * @param {string[]} refs @param {string} kind @param {number} last @returns {Map<string, { judged: number, used: number }>}
       */
      recentUse: (refs, kind, last) => this.#injRecentUse(refs, kind, last),
      /** These memories were used now, with no showing to credit (a fork's, whose briefing was its parent's): their last use (f3). @param {string[]} refs */
      usedNow: (refs) => this.#usedNow((refs || []).map(String).filter(Boolean)),
      /**
       * Per memory, the sessions whose briefing showed it after it was last used (ever, if never), its showing judged
       * and not used (the memory plan's f3: what leaves the dossier); a memory with none is absent. A use is placed by
       * when it was judged (`memory_last_used`), not by the showing it credits: a session's later reply that credits its
       * briefing's showing is a use after the briefings of sessions begun meanwhile. A use judged before that time was
       * kept is placed at its showing. @param {string[]} refs @returns {Map<string, number>}
       */
      briefedSinceUse: (refs) => this.#injBriefedSinceUse(refs),
      /** The log since `since` as the metrics read it: injections, their ids, and the archive items those name. @param {number} since */
      rollupRows: (since) => this.#injRollupRows(since),
    };
    // Counted as it opens, so a page that asks later finds the figures there.
    if (!this.#q("SELECT counted FROM message_totals WHERE id = 1").get()?.counted) this.#countMessages();
    this.#fillTrigrams();
  }

  /**
   * An older file taken to SCHEMA_VERSION by `path`: a copy of it as it was first, beside it (`<file>.v<found>.bak`),
   * then every step and the new version in one transaction. → where the copy is (null for an archive in memory). A step
   * that fails rolls all of them back, the copy goes (the file is as it was), and the file is refused in words.
   * @param {string} file @param {number} found @param {readonly UpgradeStep[]} path
   */
  #upgrade(file, found, path) {
    let copy = null;
    if (file !== ":memory:") {
      copy = existsSync(`${file}.v${found}.bak`) ? `${file}.v${found}.${this.now()}.bak` : `${file}.v${found}.bak`;
      try {
        this.db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      } catch (/** @type {any} */ e) {
        this.db.close();
        throw new Error(`${file} is archive version ${found}, and this build reads version ${SCHEMA_VERSION}: its copy as it was could not be made (${e?.message || e}), so it was not upgraded — the file is as it was.`);
      }
    }
    let at = found;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (const step of path) {
        step.up(this.db);
        at = step.from + 1;
      }
      this.db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'version'").run(String(SCHEMA_VERSION));
      this.db.exec("COMMIT");
    } catch (/** @type {any} */ e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      this.db.close();
      if (copy) rmSync(copy, { force: true });
      throw new Error(`${file} is archive version ${found}, and its upgrade to version ${at + 1} failed (${e?.message || e}): nothing of it was kept, and the file is as it was. ${startOverWords()}`);
    }
    return copy;
  }

  /** The version a file says it was written at, or null for a new file (no `schema_meta` yet, or no version in it). */
  #versionOnFile() {
    try {
      const v = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get()?.value;
      return v == null ? null : Number(v);
    } catch {
      return null;
    }
  }
  #q(sql) {
    let s = this.#stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.#stmts.set(sql, s);
    }
    return s;
  }
  // One write transaction per public call; nested calls join the outer one.
  /**
   * Several writes as one: all or none. Synchronous — the archive is. Nested calls join the outer transaction.
   * @template T @param {() => T} fn @returns {T}
   */
  transaction(fn) {
    return this.#tx(fn);
  }
  #tx(fn) {
    if (this.#inTx) return fn();
    // Open only once it began: a BEGIN that throws (a busy file, an I/O error) leaves no transaction for the
    // process's later writes to join.
    this.db.exec("BEGIN IMMEDIATE");
    this.#inTx = true;
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      // The row ids the rollback took back are given out again: what a check read inside it may never have been.
      this.#shown.clear();
      throw e;
    } finally {
      this.#inTx = false;
    }
  }

  // ---- cleanup: delete a session or a whole project, move a session to the project it belongs to --------------------
  // Message rows are content-addressed and shared across chains, so they stay; orphaned rows are harmless.
  // An owner's delete takes a claim's whole record with it: its events, anchors, triggers and memory's questions about it
  // (HarnessV3-Memory M4-6) — a question left open about a claim nobody can read any more would be asked for ever, and
  // would keep the deleted words. On the claims feed (M7-D32) a claim's earlier rows go with its record and `deleted`
  // says it went; each other claim an open question it was in named is told the question went (`decided`). → how many
  // items went.
  #dropItems(where, arg) {
    const sel = `SELECT id FROM items WHERE ${where}`;
    const gone = new Set(this.#q(sel).all(arg).map((r) => Number(r.id)));
    const asked = this.#q(`SELECT * FROM inbox WHERE status = 'open' AND EXISTS (SELECT 1 FROM json_each(inbox.item_ids_json) j WHERE j.value IN (${sel}))`).all(arg).map(inboxRow);
    this.#q(`DELETE FROM item_events WHERE item_id IN (${sel})`).run(arg);
    this.#q(`DELETE FROM item_anchors WHERE item_id IN (${sel})`).run(arg);
    this.#q(`DELETE FROM item_triggers WHERE item_id IN (${sel})`).run(arg);
    this.#q(`DELETE FROM item_near WHERE item_id IN (${sel})`).run(arg);
    this.#q(`DELETE FROM inbox WHERE EXISTS (SELECT 1 FROM json_each(inbox.item_ids_json) j WHERE j.value IN (${sel}))`).run(arg);
    this.#q(`DELETE FROM claim_feed WHERE item_id IN (${sel})`).run(arg);
    this.#q(`INSERT INTO claim_feed (at, item_id, action, project_id, chain_id, by) SELECT ?, id, 'deleted', project_id, chain_id, 'owner' FROM items WHERE ${where} ORDER BY id`).run(this.now(), arg);
    for (const q of asked) for (const id of this.#questionClaims(q)) if (!gone.has(id)) this.#feedRow(id, "decided", { by: "owner" });
    if (gone.size) this.#claimChanged();
    this.#asking = null;
    return this.#q(`DELETE FROM items WHERE ${where}`).run(arg).changes;
  }
  /**
   * The chats a delete takes, kept by their ids (the footprint plan) with the helpers whose threads they kept
   * (`meta.subagentThreads`) — what shows that the refs a repository holds of them, and of those helpers, were this
   * archive's own once they are gone. No word a chat held is kept: a delete takes its text. Written in the delete's own
   * step.
   * @param {string} where  over `chains c` @param {string} arg
   */
  #noteGone(where, arg) {
    const threads = "json_each(CASE WHEN json_valid(c.meta_json) THEN c.meta_json ELSE '{}' END, '$.subagentThreads')";
    this.#q(
      `INSERT OR REPLACE INTO gone_chains (id, helpers_json, at) SELECT c.id, (SELECT json_group_array(json_extract(t.value, '$.id')) FROM ${threads} t WHERE json_extract(t.value, '$.id') IS NOT NULL), ? FROM chains c WHERE ${where}`,
    ).run(this.now(), arg);
  }
  deleteChain(chainId) {
    return this.#tx(() => {
      const ch = this.#q("SELECT * FROM chains WHERE id = ?").get(String(chainId));
      if (!ch) return null;
      const memoryIds = this.#q("SELECT memory_id FROM items WHERE chain_id = ? AND memory_id IS NOT NULL")
        .all(ch.id)
        .map((r) => r.memory_id);
      const out = {
        id: ch.id,
        key: ch.key ?? null,
        project: ch.project_id ?? null,
        title: ch.title || null,
        items: this.#dropItems("chain_id = ?", ch.id),
        turns: this.#q("DELETE FROM turns WHERE chain_id = ?").run(ch.id).changes,
        compactions: this.#q("DELETE FROM compactions WHERE chain_id = ?").run(ch.id).changes,
        blocks: this.#q("DELETE FROM blocks WHERE chain_id = ?").run(ch.id).changes,
        links: this.#q("DELETE FROM links WHERE src = ? OR dst = ?").run(ch.id, ch.id).changes,
        injections: this.#q("DELETE FROM injections WHERE chain_id = ?").run(ch.id).changes,
      };
      this.#q("DELETE FROM local_texts WHERE chain_id = ?").run(ch.id);
      this.#q("DELETE FROM outcomes WHERE chain_id = ?").run(ch.id); // how its work went is the session's record (M7-D51)
      this.#q("DELETE FROM round_changes WHERE chain_id = ?").run(ch.id); // what its turns changed, the same
      this.#q("DELETE FROM injection_ids WHERE injection_id NOT IN (SELECT id FROM injections)").run();
      this.#q("DELETE FROM fts_text WHERE chain_id = ?").run(ch.id); // the search index would otherwise grow forever on deleted chains
      this.#q("DELETE FROM fts_tri WHERE chain_id = ?").run(ch.id);
      this.#noteGone("c.id = ?", ch.id);
      this.#q("DELETE FROM chains WHERE id = ?").run(ch.id);
      this.#native.delete(String(ch.id));
      this.#shown.delete(String(ch.id));
      out.memoryIds = memoryIds;
      return out;
    });
  }
  deleteProject(projectId) {
    return this.#tx(() => {
      const p = this.#q("SELECT * FROM projects WHERE id = ?").get(String(projectId));
      if (!p) return null;
      const rows = this.#q("SELECT id, key FROM chains WHERE project_id = ?").all(p.id);
      const chains = rows.map((r) => r.id);
      const memoryIds = this.#q("SELECT memory_id FROM items WHERE project_id = ? AND memory_id IS NOT NULL")
        .all(p.id)
        .map((r) => r.memory_id);
      const ids = listParam(chains); // an empty list matches nothing
      const out = {
        id: p.id,
        name: p.name || p.cwd || p.id,
        chains: chains.length,
        turns: this.#q(`DELETE FROM turns WHERE chain_id ${IN_LIST}`).run(ids).changes,
        compactions: this.#q(`DELETE FROM compactions WHERE chain_id ${IN_LIST}`).run(ids).changes,
        blocks: this.#q(`DELETE FROM blocks WHERE chain_id ${IN_LIST}`).run(ids).changes,
        items: this.#dropItems("project_id = ?", p.id),
        links: this.#q(`DELETE FROM links WHERE src ${IN_LIST} OR dst ${IN_LIST}`).run(ids, ids).changes,
      };
      this.#q(`DELETE FROM injections WHERE chain_id ${IN_LIST}`).run(ids);
      this.#q(`DELETE FROM local_texts WHERE chain_id ${IN_LIST}`).run(ids);
      this.#q(`DELETE FROM outcomes WHERE chain_id ${IN_LIST}`).run(ids); // same reason as deleteChain
      this.#q(`DELETE FROM round_changes WHERE chain_id ${IN_LIST}`).run(ids); // same reason as deleteChain
      this.#q("DELETE FROM injection_ids WHERE injection_id NOT IN (SELECT id FROM injections)").run();
      this.#q(`DELETE FROM fts_text WHERE chain_id ${IN_LIST}`).run(ids); // same reason as deleteChain: the index must not outlive the rows
      this.#q(`DELETE FROM fts_tri WHERE chain_id ${IN_LIST}`).run(ids);
      this.#noteGone("c.project_id = ?", p.id);
      this.#q("DELETE FROM chains WHERE project_id = ?").run(p.id);
      for (const id of chains) {
        this.#native.delete(String(id));
        this.#shown.delete(String(id));
      }
      // Its dossiers and topic pages hold its claims' words, and its questions theirs (the global ones that cite none of
      // its claims stay). Its curator passes stay: counts only, and the day's model budget must not come back with a delete.
      this.#q("DELETE FROM dossiers WHERE project_id = ?").run(p.id);
      this.#q("DELETE FROM pages WHERE project_id = ?").run(p.id);
      // A claim elsewhere that one of its open questions named is told the question went (M7-D32).
      for (const q of this.#q("SELECT * FROM inbox WHERE project_id = ? AND status = 'open'").all(p.id).map(inboxRow))
        for (const id of this.#questionClaims(q)) if (this.#q("SELECT 1 AS x FROM items WHERE id = ?").get(id)) this.#feedRow(id, "decided", { by: "owner" });
      this.#q("DELETE FROM inbox WHERE project_id = ?").run(p.id); // the open-question map was cleared by #dropItems above
      this.#q("DELETE FROM projects WHERE id = ?").run(p.id);
      // The project went (M7-D32): `deleted` with no claim, in it, so a page that lists it reads its scopes again, though
      // it held no claim and no dossier.
      this.#feedRow(null, "deleted", { projectId: p.id, by: "owner" });
      out.memoryIds = memoryIds;
      out.keys = rows.map((r) => r.key);
      out.chainIds = chains;
      return out;
    });
  }
  moveChain(chainId, projectId) {
    return this.#tx(() => {
      const p = this.#q("SELECT * FROM projects WHERE id = ?").get(String(projectId));
      if (!p) return { error: "no such project" };
      const ch = this.#q("SELECT * FROM chains WHERE id = ?").get(String(chainId));
      if (!ch) return { error: "no such session" };
      const was = this.#q("SELECT id, project_id FROM items WHERE chain_id = ? ORDER BY id").all(ch.id);
      const items = this.#q("UPDATE items SET project_id = ?, updated_at = ? WHERE chain_id = ?").run(
        p.id,
        this.now(),
        ch.id,
      ).changes;
      this.#q("UPDATE chains SET project_id = ? WHERE id = ?").run(p.id, ch.id);
      // Each claim it carries to another project says so in its history (HarnessV3-Memory M7-D33).
      for (const r of was)
        if ((r.project_id ?? null) !== p.id)
          this.#itemEvent(Number(r.id), "moved", { by: "owner", reason: "its session was moved to another project", detail: { from: r.project_id ?? null, to: p.id, session: ch.id } });
      return { id: ch.id, from: ch.project_id ?? null, to: p.id, items };
    });
  }
  // ---- fork: a new chain that is this one through turn `atTurn` ------------------------------------------------------
  // Messages are content-addressed, so the fork's turn rows point at the SAME message hashes — no body is copied. What
  // comes along: the turns ≤ atTurn (their search-index rows too), the memory blocks on those messages as the source
  // held them at the cut (the fork re-attaches byte for byte, so the provider's cached prefix survives the fork), the
  // compactions that end within
  // the kept turns, the briefing (built once at the session's start, stable after), the settings layer (the session's
  // choices with it), and the meta the fork inherits — mute, the briefing's item ids, and the learner's cursor clamped
  // to atTurn (a state learned from turns the fork does not have is NOT inherited). The fork is linked
  // `forked` → source; it gets no parent_id and no `continues` link on purpose: those make the source an ANCESTOR, and
  // recall would then walk into the turns the fork rewound away from. `key` is the fork's chain key (unique), the
  // caller's to mint. → the new chain row, or { error }.
  /**
   * @param {string} chainId
   * @param {{ atTurn: number, key?: string, title?: string | null }} opts
   * @returns {any}
   */
  forkChain(chainId, { atTurn, key, title = null, turns: turnList = null, unmark = null }) {
    const at = Number(atTurn);
    if (!Number.isInteger(at) || at < 1) return { error: "atTurn must be a turn number, 1 or more" };
    if (!key) return { error: "a chain key for the fork is required" };
    return this.#tx(() => {
      const src = this.getChain(String(chainId));
      if (!src) return { error: "no such session" };
      if (this.#q("SELECT 1 FROM chains WHERE key = ?").get(String(key))) return { error: "a session with that key exists" };
      // `turns` names the turns to copy exactly (a rewound line's fork: the live turns before the line plus the
      // line itself, gaps where earlier lines left them); without it the fork is the prefix up to `atTurn`.
      const turns = turnList
        ? this.getTurns(src.id).filter((x) => turnList.includes(x.n)).sort((a, b) => a.n - b.n)
        : this.getTurns(src.id, { to: at });
      if (!turns.length) return { error: "the session has no turns to fork from" };
      const last = turns[turns.length - 1].n;
      if (last < at) return { error: `the session has ${last} turn(s); cannot fork at turn ${at}` };
      // A turn still open (no final answer yet) would be copied open for good — nothing closes a fork's copy when the
      // source finishes — and its user text would pass for a tool-loop leg of the fork's first request.
      if (turns[turns.length - 1].ended_at == null)
        return { error: `turn ${at} is still open (no final answer yet); fork at a finished turn` };
      const t = this.now();
      const id = this.#newChainId(t);
      const srcMeta = src.meta || {};
      const learnedThrough = Math.min(Number(srcMeta.learnedThrough) || 0, at);
      // The session's settings layer travels whole (HarnessV3 Step 1).
      const settingsJson = src.settings_json ?? null;
      // The working tree as the fork turn left it (WP-J.2): the newest snapshot among the kept turns, null when the
      // source never wrote under the loop (or had no git). The worktree itself is the caller's to check out.
      const tree = this.treeAtTurn(src.id, at);
      // The privacy flags travel with the fork (written before the turns are copied, so the copies' index writes are
      // gated the same way the source's were): what the developer kept out of the index and the learner stays out.
      // The session's choices travel in the settings layer (`settingsJson` above), not the meta. The turns kept apart
      // stay apart in the copies (their meta travels), and so does a name such a turn gave — the source's, or its first
      // message, which name the fork where no title is given (`namedApart`). A fork of another machine's agents' chat is
      // theirs too (`agentDevice`, the remote-agents plan's f-fence2): its folders are none of the person's (`chatFolders`).
      const firstApart = !title && !src.title && apartTurn({ meta: parseJson(turns[0]?.meta_json, null) });
      const meta = {
        muted: srcMeta.muted,
        agentDevice: typeof srcMeta.agentDevice === "string" ? srcMeta.agentDevice : undefined,
        agentFrom: typeof srcMeta.agentDevice === "string" && typeof srcMeta.agentFrom === "string" ? srcMeta.agentFrom : undefined,
        noIndex: srcMeta.noIndex,
        noLearn: srcMeta.noLearn,
        namedApart: srcMeta.namedApart || firstApart || undefined,
        briefingIds: srcMeta.briefingIds,
        briefingTries: srcMeta.briefingTries,
        learnedThrough: learnedThrough || undefined,
        fork: { from: src.id, atTurn: at, at: t },
        tree: tree ? { snapshotRef: tree.snapshotRef, commit: tree.commit, turn: tree.turn } : { snapshotRef: null },
      };
      for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
      const state = src.state && (Number(srcMeta.learnedThrough) || 0) <= at ? src.state : null;
      const finished = turns.filter((x) => x.ended_at != null).length;
      this.#q(
        "INSERT INTO chains (id, key, project_id, client, model, title, started_at, last_at, turns, parent_id, state_json, briefing, meta_json, kind, preview, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'fork', ?, ?)",
      ).run(
        id,
        String(key),
        src.project_id,
        src.client,
        src.model,
        // Named after the source: its title, else its first message (clipped), so the fork row says what it forked.
        title ?? `${src.title || (this.firstUserText(chainId) || "").slice(0, 48) || "untitled"} (fork at turn ${at})`,
        t,
        t,
        finished,
        state ? JSON.stringify(state) : null,
        src.briefing,
        JSON.stringify(meta),
        src.preview ?? null,
        // The fork works under the settings its source had (HarnessV2 §5.7 `fork.settings: inherit` is the default).
        settingsJson,
      );
      const ins = this.#q(
        "INSERT INTO turns (chain_id, n, started_at, ended_at, request_ids_json, model, upstream, user_hash, final_hash, work_json, input_chars, output_chars, summary, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const x of turns) {
        // `unmark` (a rewound line's fork, D11): the line being opened loses its mark in the copies, so it is
        // live in the new session. Every other rewound mark travels with its turn — a normal fork renders the
        // same live line as its source.
        let metaJson = x.meta_json;
        if (unmark) {
          const m = parseJson(metaJson, null);
          if (m?.rewound?.line === unmark) {
            delete m.rewound;
            metaJson = Object.keys(m).length ? JSON.stringify(m) : null;
          }
        }
        const r = ins.run(
          id,
          x.n,
          x.started_at,
          x.ended_at,
          x.request_ids_json,
          x.model,
          x.upstream,
          x.user_hash,
          x.final_hash,
          x.work_json,
          x.input_chars,
          x.output_chars,
          x.summary,
          metaJson,
        );
        const turnId = Number(r.lastInsertRowid);
        for (const [hash, role] of [
          [x.user_hash, "user"],
          [x.final_hash, "assistant"],
        ]) {
          if (!hash) continue;
          const m = this.getMessage(hash);
          if (m) this.#fts(id, turnId, role, textOfMessage(withoutAskLine(m.message)));
        }
      }
      // The blocks memory placed on the copied messages, under its own key of each (`blockKeyOf`) — a session loaded
      // onto one beside it, under that key and its `#load` mark — as the source held them when it last sent the fork's
      // history: the fork's goes out as the source's did. A turn's leg is its own (its tool call's id is in it): its
      // blocks come whenever they were written. A person message's words may come again: a block on them comes where it
      // was written before a turn the fork does not copy began, or before the newest copied turn that sent them ended —
      // memory writes it once its awaits are done, and a side turn may open meanwhile. One written later sits on a
      // message the fork never sent — a later repeat of a kept one, or the live line's after a rewind — and stays behind.
      // A block keeps the time it was written, so a fork of the fork reads it as this one did. Bodies are opened only
      // where there are blocks to match: the person messages, then the turns' legs for a block none of those carries.
      const copiedNs = new Set(turns.map((x) => x.n));
      const lastStart = Math.max(...turns.map((x) => Number(x.started_at)));
      const movedOn = this.#q("SELECT n, started_at FROM turns WHERE chain_id = ? AND started_at > ?")
        .all(src.id, lastStart)
        .filter((x) => !copiedNs.has(x.n))
        .reduce((m, x) => Math.min(m, Number(x.started_at)), Number.MAX_SAFE_INTEGER);
      const blocks = this.blockKeyOf ? this.#q("SELECT hash, block, nth, kind, created_at FROM blocks WHERE chain_id = ?").all(src.id) : [];
      /** Memory's key of a copied message, null where its body is not whole. @param {string} h */
      const keyOf = (h) => {
        const m = this.getMessage(h);
        return m && !m.truncated ? this.blockKeyOf(m.message) : null;
      };
      const base = (/** @type {any} */ b) => String(b.hash).split("#")[0];
      /** Each copied person message's key, and when the newest copied turn that sent it ended (0 where none did). */
      const said = new Map();
      if (blocks.length)
        for (const x of turns) {
          const k = x.user_hash ? keyOf(x.user_hash) : null;
          if (k) said.set(k, Math.max(said.get(k) ?? 0, Number(x.ended_at) || 0));
        }
      const legs = new Set();
      if (blocks.some((b) => !said.has(base(b)))) for (const x of turns) for (const h of x.work || []) legs.add(keyOf(h));
      /** Whether a block on a copied person message is the copied turn's own. @param {any} b */
      const saidThen = (b) => said.has(base(b)) && (Number(b.created_at) < movedOn || Number(b.created_at) <= said.get(base(b)));
      let copiedBlocks = 0;
      for (const b of blocks) {
        if (!legs.has(base(b)) && !saidThen(b)) continue;
        this.#q(
          "INSERT OR IGNORE INTO blocks (chain_id, hash, block, nth, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, b.hash, b.block, b.nth || 1, b.kind || "turn", b.created_at ?? t);
        copiedBlocks++;
      }
      // Filament's own texts travel with the fork (D11): the fork continues the conversation, so its recorded
      // replies and cues keep matching the history any window resends.
      this.#q(
        "INSERT OR IGNORE INTO local_texts (chain_id, hash, kind, created_at) SELECT ?, hash, kind, ? FROM local_texts WHERE chain_id = ?",
      ).run(id, t, src.id);
      // A compaction with no end turn (an import's whole-chain summary) stands for everything, so it comes along
      // only when the fork IS everything — a cut at the last turn.
      const wholeChain = at >= (this.#q("SELECT MAX(n) AS n FROM turns WHERE chain_id = ?").get(src.id)?.n || 0);
      // A fold compaction the cut runs through comes along clamped to the cut: its marks are on the turns
      // the fork copies, and the row is what lets the fork's history say so — and undo it. (A summary cut through
      // stays behind, as always: its text stands for turns the fork does not have.) So does the summary a coding
      // agent wrote in the middle of a turn past the cut (`detail.during`): it stands for the start of that turn too.
      const compactions = this.#q(
        "SELECT id, from_turn, to_turn, summary_hash, kind, window, method, detail_json FROM compactions WHERE chain_id = ? AND ((to_turn IS NOT NULL AND to_turn <= ?) OR (to_turn IS NULL AND ?) OR (summary_hash IS NULL AND method = 'fold' AND from_turn <= ? AND to_turn > ?)) ORDER BY id",
      )
        .all(src.id, at, wholeChain ? 1 : 0, at, at)
        .filter((c) => !(Number(parseJson(c.detail_json, null)?.during) > at));
      /** The source's row ids → the fork's, for the marks its turns carry. @type {Map<number, number>} */
      const rowIds = new Map();
      for (const c of compactions) {
        const copy = this.#nextCompactionId();
        this.#q(
          "INSERT INTO compactions (id, chain_id, from_turn, to_turn, summary_hash, kind, window, created_at, method, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(copy, id, c.from_turn, c.to_turn != null && c.to_turn > at ? at : c.to_turn, c.summary_hash, c.kind, c.window ?? null, t, c.method, c.detail_json ?? null);
        rowIds.set(Number(c.id), copy);
      }
      // A compaction mark names its row: in the fork it names the fork's copy of it.
      for (const ft of this.#q("SELECT id, meta_json FROM turns WHERE chain_id = ?").all(id)) {
        const m = parseJson(ft.meta_json, null);
        const was = Number(m?.compacted?.id);
        if (!rowIds.has(was)) continue;
        m.compacted = { ...m.compacted, id: rowIds.get(was) };
        this.#q("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(m), ft.id);
      }
      this.link(id, src.id, "forked", 1);
      return {
        ...this.getChain(id),
        forkedFrom: src.id,
        atTurn: at,
        copied: { turns: turns.length, blocks: copiedBlocks, compactions: compactions.length },
      };
    });
  }

  /**
   * Open a rewound line as its own session (D11): the live turns before the line plus the line itself, the line's
   * mark removed from the copies so it is live in the new session. The fork's key is `n:line-…`, minted here — it
   * names no client conversation, so it can never collide with one — and the fork is the harness's own chat
   * (`native`), in the source's folder. → the fork row, or { error }.
   * @param {string} chainId @param {string} line
   * @returns {any}
   */
  forkLine(chainId, line) {
    const turns = this.getTurns(chainId);
    const marked = turns.filter((t) => t.meta?.rewound?.line === String(line || ""));
    if (!marked.length) return { error: "no such rewound line" };
    const from = Math.min(...marked.map((t) => t.n));
    const at = Math.max(...marked.map((t) => t.n));
    const keep = turns.filter((t) => t.n < from && !t.meta?.rewound).map((t) => t.n);
    const r = this.forkChain(chainId, {
      atTurn: at,
      key: `n:line-${randomBytes(6).toString("hex")}`,
      turns: [...keep, ...marked.map((t) => t.n)],
      unmark: String(line),
    });
    if (r?.error) return r;
    const cwd = this.getChain(chainId)?.meta?.cwd;
    this.mergeMeta(r.id, { native: true, ...(typeof cwd === "string" && cwd ? { cwd } : {}) });
    return { ...r, ...this.getChain(r.id) };
  }
  // Body at rest: 12-byte IV + 16-byte GCM tag + ciphertext when a key is set, UTF-8 plaintext otherwise.
  #seal(text) {
    const buf = Buffer.from(text, "utf8");
    if (!this.key) return buf;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }
  #open(blob, hash) {
    const buf = toBuf(blob);
    if (!this.key) return buf.toString("utf8");
    try {
      const d = createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    } catch {
      throw new Error(`Archive: could not decrypt message ${hash} (wrong key?)`);
    }
  }
  #fts(chainId, turnId, role, text) {
    if (!(this.index && text && !this.#indexOff(chainId))) return;
    const kept = text.slice(0, this.caps.inputChars);
    this.#q("INSERT INTO fts_text (chain_id, turn_id, role, text) VALUES (?, ?, ?, ?)").run(chainId, turnId, role, kept);
    // A text in a script written without spaces goes into the trigram index too (the memory plan's c1): fts_text's
    // tokenizer reads a run of it as one word, so nothing but the whole run would find it.
    if (hasUnspaced(kept)) this.#q("INSERT INTO fts_tri (chain_id, turn_id, role, text) VALUES (?, ?, ?, ?)").run(chainId, turnId, role, kept);
  }
  /**
   * Fills the trigram index from the search index once, for a file written before it (the memory plan's c1): the rows
   * whose text holds a script written without spaces. Marked in schema_meta (`trigramFilled`), so it runs once.
   */
  #fillTrigrams() {
    if (this.schemaMetaGet("trigramFilled") === 1) return;
    this.db.function("filament_unspaced", { deterministic: true }, (/** @type {any} */ t) => (hasUnspaced(String(t ?? "")) ? 1 : 0));
    this.#tx(() => {
      this.#q("DELETE FROM fts_tri").run();
      this.#q("INSERT INTO fts_tri (chain_id, turn_id, role, text) SELECT chain_id, turn_id, role, text FROM fts_text WHERE filament_unspaced(text)").run();
      this.schemaMetaSet("trigramFilled", 1);
    });
  }
  /** Whether the chain opted out of the search index (`meta.noIndex`, the mirror of a session's `memory.index: false`). */
  #indexOff(chainId) {
    const row = this.#q("SELECT json_extract(meta_json, '$.noIndex') AS off FROM chains WHERE id = ?").get(chainId);
    return !!row?.off;
  }
  /**
   * Put a chain's text in the search index or take it out (HarnessV2 §5.5 `memory.index`). Off: its rows are deleted
   * and `meta.noIndex` keeps later turns out. On: the flag goes and every turn's user and final text is indexed again
   * from the archived messages. Returns the rows now in the index for the chain; null when there is no such chain.
   * @param {string} chainId @param {boolean} on
   */
  setChainIndexed(chainId, on) {
    return this.#tx(() => {
      const id = String(chainId);
      if (!this.#q("SELECT 1 FROM chains WHERE id = ?").get(id)) return null;
      this.#q("DELETE FROM fts_text WHERE chain_id = ?").run(id);
      this.#q("DELETE FROM fts_tri WHERE chain_id = ?").run(id);
      this.mergeMeta(id, { noIndex: on ? undefined : true });
      if (on && this.index)
        for (const t of this.#q("SELECT id, user_hash, final_hash FROM turns WHERE chain_id = ? ORDER BY n").all(id)) {
          for (const [role, hash] of [["user", t.user_hash], ["assistant", t.final_hash]]) {
            const m = hash ? this.getMessage(hash) : null;
            if (m) this.#fts(id, t.id, role, textOfMessage(withoutAskLine(m.message)));
          }
        }
      return Number(this.#q("SELECT COUNT(*) AS n FROM fts_text WHERE chain_id = ?").get(id)?.n || 0);
    });
  }

  // ---- messages (content-addressed) ------------------------------------------------------------------------------
  // Stores the raw message once per sha256 of its JSON. Bodies over caps.messageBytes, its base64 pictures and files
  // not counted (`mediaBytes`), are kept as a marker `{ _filament_truncated: true, bytes, head }` (head = the first cap bytes of the
  // JSON) with truncated=1; the hash is still that of the full text, so a repeated oversize message is stored once too.
  putMessage(role, msg) {
    const json = JSON.stringify(msg === undefined ? null : msg);
    const hash = sha256(json);
    const bytes = Buffer.byteLength(json);
    const have = this.#q("SELECT kind, bytes, truncated FROM messages WHERE hash = ?").get(hash);
    if (have) return { hash, bytes: have.bytes, truncated: !!have.truncated, kind: have.kind, isNew: false };
    const kind = messageKind(msg, role);
    const truncated = bytes - mediaBytes(msg) > this.caps.messageBytes ? 1 : 0;
    const body = truncated
      ? JSON.stringify({ _filament_truncated: true, bytes, head: capBytes(json, this.caps.messageBytes) })
      : json;
    this.#q(
      "INSERT OR IGNORE INTO messages (hash, role, kind, bytes, truncated, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(hash, role, kind, bytes, truncated, this.#seal(body), this.now());
    return { hash, bytes, truncated: !!truncated, kind, isNew: true };
  }
  // The stored kind of many messages at once (text, tool_use, tool_result, thinking, …) without opening a body: what
  // the counts of a session's work are made from. → Map hash → kind; hashes this archive does not hold are absent.
  /** @param {readonly string[]} hashes @returns {Map<string, string>} */
  messageKinds(hashes) {
    const out = new Map();
    const list = [...new Set((hashes || []).filter(Boolean))];
    if (!list.length) return out;
    for (const r of this.#q(`SELECT hash, kind FROM messages WHERE hash ${IN_LIST}`).all(listParam(list))) out.set(r.hash, r.kind);
    return out;
  }
  /**
   * The tool legs of turns' work: the messages of kind `tool_use` in each turn's work, a name the work holds twice
   * counted twice. A turn counted before, its work the same, counts as it did — as this opening keeps it, else as the
   * file does (`turn_legs`), which keeps a turn's count across starts once the turn is over: ended, or a later turn
   * after it (the newest may be at work still, its work growing at each read; it is filed once over) —; the rest are
   * read from the stored kinds in one ask (`messageKinds`) — a long chat's work is tens of thousands of messages, each a
   * lookup cold on disk at a chat's first open (the owner's of 11-17: a page's read of TinyQuest held the server 10 s
   * in them, and each start of Filament read them all again).
   * @param {readonly { id?: number, work?: unknown, ended_at?: unknown }[]} turns  a chain's, oldest first (`getTurns`)
   * @returns {number}
   */
  toolLegs(turns) {
    const list = turns || [];
    let n = 0;
    /** @type {{ id: number | undefined, work: string[], names: string, over: boolean }[]} */
    const unread = [];
    /** The counts the file is to keep: turns over, not filed yet for these names. @type {{ id: number, entry: { names: string, n: number, filed: boolean } }[]} */
    const toFile = [];
    list.forEach((t, i) => {
      const work = Array.isArray(t?.work) ? /** @type {string[]} */ (t.work) : [];
      if (!work.length) return;
      const names = sha1(work.join("\n"));
      const over = t.ended_at != null || i < list.length - 1;
      const kept = t.id != null ? this.#legs.get(t.id) : undefined;
      if (kept && kept.names === names) {
        this.#keepLegs(/** @type {number} */ (t.id), kept);
        n += kept.n;
        if (over && !kept.filed) toFile.push({ id: /** @type {number} */ (t.id), entry: kept });
      } else unread.push({ id: t.id, work, names, over });
    });
    if (unread.length) {
      const ids = unread.flatMap((u) => (u.id != null ? [u.id] : []));
      /** @type {Map<number, { names: string, n: number }>} */
      const filed = new Map();
      if (ids.length) for (const r of this.#q(`SELECT turn_id, names, n FROM turn_legs WHERE turn_id ${IN_LIST}`).all(listParam(ids))) filed.set(Number(r.turn_id), { names: String(r.names), n: Number(r.n) });
      const rest = unread.filter((u) => {
        const f = u.id != null ? filed.get(u.id) : undefined;
        if (!f || f.names !== u.names) return true;
        n += f.n;
        this.#keepLegs(/** @type {number} */ (u.id), { names: u.names, n: f.n, filed: true });
        return false;
      });
      const kinds = rest.length ? this.messageKinds(rest.flatMap((u) => u.work)) : new Map();
      for (const u of rest) {
        let legs = 0;
        let held = true;
        for (const h of u.work) {
          const kind = kinds.get(h);
          if (kind === undefined) held = false;
          else if (kind === "tool_use") legs++;
        }
        n += legs;
        if (!held || u.id == null) continue;
        const entry = { names: u.names, n: legs, filed: false };
        this.#keepLegs(u.id, entry);
        if (u.over) toFile.push({ id: u.id, entry });
      }
    }
    if (toFile.length) {
      // A file that takes no write now (busy) keeps nothing: this opening has the counts, and files them at a later read.
      try {
        this.#tx(() => {
          const put = this.#q("INSERT OR REPLACE INTO turn_legs (turn_id, names, n) VALUES (?, ?, ?)");
          for (const f of toFile) put.run(f.id, f.entry.names, f.entry.n);
        });
        for (const f of toFile) f.entry.filed = true;
      } catch {}
    }
    return n;
  }
  /** A turn's count kept by this opening, the newest used; the one used longest ago goes past `LEGS_KEPT`. @param {number} id @param {{ names: string, n: number, filed: boolean }} entry */
  #keepLegs(id, entry) {
    this.#legs.delete(id);
    this.#legs.set(id, entry);
    if (this.#legs.size > LEGS_KEPT) this.#legs.delete(/** @type {number} */ (this.#legs.keys().next().value));
  }
  // ---- memory's withheld exchanges (BUG-11) ------------------------------------------------------------------------
  // anchor (a tool call's id, a thinking signature's hash) → the exchange's fingerprints and its withheld messages'
  // hashes (the messages themselves are rows of `messages`, sealed like every other). Hashes only: no content here.
  /** @param {readonly string[]} anchors @param {string} entryJson */
  putWithheld(anchors, entryJson) {
    const st = this.#q("INSERT OR REPLACE INTO withheld (anchor, entry, created_at) VALUES (?, ?, ?)");
    const at = this.now();
    for (const a of anchors || []) st.run(String(a), String(entryJson), at);
  }
  /** @param {readonly string[]} anchors @returns {Map<string, any>} anchor → entry, for the anchors it holds */
  withheldFor(anchors) {
    const out = new Map();
    const list = [...new Set((anchors || []).map(String))];
    if (!list.length) return out;
    for (const r of this.#q(`SELECT anchor, entry FROM withheld WHERE anchor ${IN_LIST}`).all(listParam(list))) {
      try {
        out.set(r.anchor, JSON.parse(r.entry));
      } catch {}
    }
    return out;
  }
  // What each turn's start said on its message (agent/turn-said.js), as the turn keeps it in `meta.said`: how many of
  // the words went ahead of it, and the stored message that holds them (sealed like any other) — every later turn puts
  // them back on the turn's own message, so its bytes are the ones cached. A turn rewound away says nothing any more.
  /** @param {string} chainId @returns {{ n: number, head: number, hash: string }[]} */
  saidOf(chainId) {
    const out = [];
    const m = (/** @type {string} */ path) => `CASE WHEN json_valid(meta_json) THEN meta_json -> '${path}' END`;
    for (const r of this.#q(`SELECT n, said FROM (SELECT n, ${m("$.said")} AS said, ${m("$.rewound")} AS rewound FROM turns WHERE chain_id = ?) WHERE said IS NOT NULL AND rewound IS NULL ORDER BY n`).all(String(chainId))) {
      const s = parseJson(r.said, null);
      if (s && typeof s.hash === "string") out.push({ n: Number(r.n), head: Math.max(0, Number(s.head) || 0), hash: s.hash });
    }
    return out;
  }
  // The turns a rewind took out of the conversation, each with when (`meta.rewound.at`, this archive's clock), oldest
  // first: a summary written before a rewind that took a turn it stands for stands no more (sessions/service.js
  // `compactionsOf`).
  /** @param {string} chainId @returns {{ n: number, at: number }[]} */
  rewoundOf(chainId) {
    const m = (/** @type {string} */ path) => `CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '${path}') END`;
    return this.#q(`SELECT n, at FROM (SELECT n, ${m("$.rewound.at")} AS at FROM turns WHERE chain_id = ?) WHERE at IS NOT NULL ORDER BY n`)
      .all(String(chainId))
      .map((/** @type {any} */ r) => ({ n: Number(r.n), at: Number(r.at) || 0 }));
  }
  // The chain's turns as a request's messages are matched to them (agent/turn-said.js `turnsOf`): each standing turn's
  // number and its message's pin (`meta.key`), oldest first — a turn rewound away is none of them.
  /** @param {string} chainId @returns {{ id: string, n: number, key: string }[]} */
  turnPinsOf(chainId) {
    const m = (/** @type {string} */ path) => `CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '${path}') END`;
    return this.#q(`SELECT id, n, key FROM (SELECT id, n, ${m("$.key")} AS key, ${m("$.rewound")} AS rewound FROM turns WHERE chain_id = ?) WHERE rewound IS NULL AND key IS NOT NULL ORDER BY n`)
      .all(String(chainId))
      .map((/** @type {any} */ r) => ({ id: String(r.id), n: Number(r.n), key: String(r.key) }));
  }
  // → { hash, role, kind, bytes, truncated, createdAt, message } with the body decrypted and parsed, or null.
  getMessage(hash) {
    const r = this.#q("SELECT * FROM messages WHERE hash = ?").get(hash);
    if (!r) return null;
    return {
      hash: r.hash,
      role: r.role,
      kind: r.kind,
      bytes: r.bytes,
      truncated: !!r.truncated,
      createdAt: r.created_at,
      message: JSON.parse(this.#open(r.body, hash)),
    };
  }

  // ---- projects and chains ---------------------------------------------------------------------------------------
  // Read-only chain lookup by key, or null. One resolver (HarnessV3 Step 3 D2): the chain whose own key it is. Unlike
  // `chainForKey` this NEVER creates a chain or touches a project row, which is what makes it safe to call from a path
  // that does not archive anything itself (an ACP agent turn, which gets memory through the MCP server instead).
  // Creating an empty chain there would leave junk in the archive and make "was there anything to seed from?"
  // unanswerable afterwards.
  chainIdForKey(key) {
    if (!key) return null;
    return this.#q("SELECT id FROM chains WHERE key = ?").get(String(key))?.id || null;
  }
  // First sight of a chain key creates its project (`project` = an explicit id, else the folder's id under the one
  // rule in core/project-id.js, else "none") and the chain; later calls refresh last_at, model and client. `kind` is
  // one of CHAIN_KINDS (default interactive) and is set only when the chain is created. → chain row (+ isNew).
  /**
   * @param {string} key
   * @param {{ project?: string | null, cwd?: string | null, client?: string | null, model?: string | null, parentId?: string | null, meta?: any, kind?: string | null }} [o]
   */
  chainForKey(
    key,
    { project = null, cwd = null, client = null, model = null, parentId = null, meta = null, kind = null } = {},
  ) {
    if (!key) throw new Error("Archive: chain key is required");
    if (kind != null && !CHAIN_KINDS.includes(kind)) throw new Error(`Archive: unknown chain kind ${kind}`);
    return this.#tx(() => {
      const t = this.now();
      const projectId = project || projectIdOf(cwd);
      const name = cwd ? projectNameOf(cwd) || cwd : project;
      // The folder names the project: a request that brings one refreshes the name from it — its spelling, the id it
      // stood in with —; one that brings only an id keeps the name the row has (the id stands in only until a folder is
      // seen). A name given to the project (`setProjectName`: a Space of your own's) is never the folder's again.
      this.#q(
        "INSERT INTO projects (id, cwd, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, cwd = COALESCE(excluded.cwd, projects.cwd), name = CASE WHEN excluded.cwd IS NOT NULL AND (projects.name IS NULL OR projects.name = projects.id OR lower(projects.name) = lower(excluded.name)) THEN excluded.name ELSE COALESCE(projects.name, excluded.name) END",
      ).run(projectId, cwd, name, t, t);
      // The one resolver decides whether the key names a chain (D2).
      const haveId = this.chainIdForKey(key);
      if (haveId) {
        this.#q(
          "UPDATE chains SET last_at = ?, model = COALESCE(?, model), client = COALESCE(?, client) WHERE id = ?",
        ).run(t, model, client, haveId);
        return this.#keyedChain(haveId, false);
      }
      const id = this.#newChainId(t);
      this.#q(
        "INSERT INTO chains (id, key, project_id, client, model, title, started_at, last_at, turns, parent_id, state_json, briefing, meta_json, kind) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, NULL, NULL, ?, ?)",
      ).run(id, key, projectId, client, model, t, t, parentId, meta ? JSON.stringify(meta) : null, kind || "interactive");
      return this.#keyedChain(id, true);
    });
  }
  /**
   * The chain `chainForKey` answers with: its row as `getChain` reads it, with `isNew` — its state, meta and settings
   * opened when first read (core/lazy.js), from the row as it was read here. A live request looks its chain up several
   * times (memory, its view, its commands) and most lookups read its id and head alone (memory reads the stored meta's
   * text itself): a meta that grows with the chat is not parsed, nor the settings' credentials opened, for them.
   * @param {string} chainId @param {boolean} isNew
   */
  #keyedChain(chainId, isNew) {
    const c = this.#q("SELECT * FROM chains WHERE id = ?").get(chainId);
    if (!c) return { isNew };
    const row = { ...c, kind: c.kind || "interactive" };
    lazy(row, "state", () => parseJson(c.state_json, null));
    lazy(row, "meta", () => parseJson(c.meta_json, null));
    lazy(row, "settings", () => cryptLayer(parseJson(c.settings_json, null), this.secretKey, "open"));
    return Object.assign(row, { isNew });
  }
  /** Retype a chain (memory marks a loop's tick after creation). @param {string} chainId @param {string} kind */
  setChainKind(chainId, kind) {
    if (!CHAIN_KINDS.includes(kind)) throw new Error(`Archive: unknown chain kind ${kind}`);
    return this.#q("UPDATE chains SET kind = ? WHERE id = ?").run(kind, String(chainId)).changes > 0;
  }
  /**
   * The chain's own settings layer (`settings_json`), `{}` when none or no such chain. Its MCP servers' credentials
   * are kept sealed with `secretKey` and come back open (HarnessV4_Settings_Plan HS-D8).
   * @param {string} chainId
   */
  chainSettings(chainId) {
    const row = this.#q("SELECT settings_json FROM chains WHERE id = ?").get(String(chainId));
    return cryptLayer((row && parseJson(row.settings_json, null)) || {}, this.secretKey, "open");
  }
  /**
   * Every chain's own settings layer as stored, its credentials left sealed: what a look across the chats reads where
   * it needs no secret — a server's address (app/sessions/mcp-servers.js `addressNamed`, found by the Hunter on S4b).
   * @returns {{ id: string, settings: Record<string, unknown> }[]}
   */
  chainLayers() {
    return this.#q("SELECT id, settings_json FROM chains WHERE settings_json IS NOT NULL").all()
      .map((/** @type {any} */ r) => ({ id: String(r.id), settings: parseJson(r.settings_json, null) || {} }));
  }
  /**
   * Whether any chat's or project's own settings layer chooses memory's tools (`memory.tools`, nested or dotted), on or
   * off: what a request memory could not read asks before it is given memory's tools by the config alone, its chat not
   * known (memory-prepare.js, t420). A layer that is no JSON chooses nothing.
   */
  memoryToolsChosen() {
    const chosen = (/** @type {string} */ table) =>
      this.#q(
        `SELECT 1 FROM ${table} WHERE settings_json IS NOT NULL AND CASE WHEN json_valid(settings_json) THEN coalesce(json_type(settings_json, '$.memory.tools'), json_type(settings_json, '$."memory.tools"')) END IS NOT NULL LIMIT 1`,
      ).get();
    return !!(chosen("chains") || chosen("projects"));
  }
  /**
   * Replace the chain's settings layer whole (the resolver merges layers; the archive stores documents). `null`
   * clears it. False when there is no such chain.
   * @param {string} chainId @param {Record<string, unknown> | null} settings
   */
  setChainSettings(chainId, settings) {
    return (
      this.#q("UPDATE chains SET settings_json = ? WHERE id = ?").run(
        settings ? JSON.stringify(cryptLayer(settings, this.secretKey, "seal")) : null,
        String(chainId),
      ).changes > 0
    );
  }
  // 8 base36 chars: 4 from the time (seconds) so ids sort roughly by age, 4 random; regenerated on the rare collision.
  #newChainId(t) {
    for (;;) {
      const id =
        Math.floor(t / 1000)
          .toString(36)
          .slice(-4)
          .padStart(4, "0") + randomBytes(4).readUInt32BE(0).toString(36).padStart(4, "0").slice(-4);
      if (!this.#q("SELECT 1 FROM chains WHERE id = ?").get(id)) return id;
    }
  }
  #chainRow(c) {
    return (
      c && {
        ...c,
        kind: c.kind || "interactive",
        state: parseJson(c.state_json, null),
        meta: parseJson(c.meta_json, null),
        settings: cryptLayer(parseJson(c.settings_json, null), this.secretKey, "open"),
      }
    );
  }
  getChain(chainId) {
    return this.#chainRow(plain(this.#q("SELECT * FROM chains WHERE id = ?").get(chainId)));
  }
  /**
   * Whether the archive holds the chain: what a caller that only checks it is there asks, without the row read whole
   * (its meta grows with the chat, and its settings layer is opened). @param {string} chainId
   */
  hasChain(chainId) {
    return !!this.#q("SELECT 1 AS x FROM chains WHERE id = ?").get(chainId);
  }
  /**
   * When the chain was last active (its `last_at`; 0 when it has none), or null when there is no such chain: what the
   * learner's idle check reads of each chat it waits on, without the row read whole. @param {string} chainId
   */
  lastAt(chainId) {
    const row = this.#q("SELECT last_at FROM chains WHERE id = ?").get(chainId);
    return row ? Number(row.last_at) || 0 : null;
  }
  /**
   * A chain's head — who it is, where it stands, what it runs on, how many turns it has had, and whether the harness
   * made it (`native`: `meta.native === true`) — or null when there is none: what resolving its settings and naming its
   * live turn read, without its meta parsed or its settings layer opened. The columns are read as they are now;
   * `native` is kept per chain (`#native`) until a write can change it.
   * @param {string} chainId
   * @returns {{ id: string, key: string, project_id: string | null, model: string | null, kind: string, turns: number | null, native: boolean } | null}
   */
  chainHead(chainId) {
    const row = this.#q("SELECT id, key, project_id, client, model, kind, turns FROM chains WHERE id = ?").get(chainId);
    if (!row) return null;
    const id = String(row.id);
    let native = this.#native.get(id);
    if (native === undefined) {
      // JSON's own true, as `meta.native === true` reads it; a meta that does not parse is none (`parseJson`).
      const r = this.#q("SELECT CASE WHEN json_valid(meta_json) THEN json_type(meta_json, '$.native') = 'true' ELSE 0 END AS native FROM chains WHERE id = ?").get(id);
      native = !!r?.native;
      this.#native.set(id, native);
    }
    return { id, key: /** @type {string} */ (row.key), project_id: /** @type {string | null} */ (row.project_id), client: /** @type {string | null} */ (row.client), model: /** @type {string | null} */ (row.model), kind: String(row.kind || "interactive"), turns: /** @type {number | null} */ (row.turns), native };
  }
  /** The chain a chain was started from (a sub-agent's, the chat that launched it), or null: its column alone. @param {string} chainId */
  parentIdOf(chainId) {
    const row = /** @type {any} */ (this.#q("SELECT parent_id FROM chains WHERE id = ?").get(String(chainId)));
    return row?.parent_id ? String(row.parent_id) : null;
  }
  /**
   * Named keys of a chain's meta, each as `meta[key]` reads it (absent where it has none), or null when there is no
   * such chain: SQLite takes them out of the stored JSON, so a meta that grows with the chat is never parsed here whole.
   * A key is a plain name.
   * @param {string} chainId @param {readonly string[]} keys @returns {Record<string, any> | null}
   */
  metaOf(chainId, keys) {
    for (const k of keys) if (!/^[A-Za-z_$][\w$]*$/.test(k)) throw new Error(`Archive: "${k}" is no meta key metaOf reads`);
    const cols = keys.map((k, i) => `CASE WHEN json_valid(meta_json) THEN meta_json -> '$.${k}' END AS k${i}`).join(", ");
    const row = this.#q(`SELECT 1 AS x${cols ? `, ${cols}` : ""} FROM chains WHERE id = ?`).get(chainId);
    if (!row) return null;
    /** @type {Record<string, any>} */
    const out = {};
    keys.forEach((k, i) => {
      const v = row[`k${i}`];
      if (v != null) out[k] = JSON.parse(String(v));
    });
    return out;
  }
  /** Every chain's id: which chats Filament has, as its footprint in a repository asks of the refs named for one. */
  chainIds() {
    return this.#q("SELECT id FROM chains").all().map((r) => String(r.id));
  }
  /**
   * The chats this archive deleted (`#noteGone`), by id: the helpers whose threads each kept — the footprint plan's proof
   * that their refs in a repository were this data folder's own.
   * @returns {Map<string, { helpers: string[], at: number }>}
   */
  goneChains() {
    return new Map(
      this.#q("SELECT id, helpers_json, at FROM gone_chains").all().map((r) => {
        const helpers = parseJson(r.helpers_json, []);
        return [String(r.id), { helpers: Array.isArray(helpers) ? helpers.filter((h) => typeof h === "string") : [], at: Number(r.at) || 0 }];
      }),
    );
  }
  /**
   * When this archive began keeping the chats it deletes (`gone_chains`), in ms: a chat whose refs were written since,
   * that it neither has nor deleted, was never this data folder's.
   * @returns {number}
   */
  goneSince() {
    return Number(this.schemaMetaGet("goneSince"));
  }
  /**
   * When this archive began keeping who begins each turn (`meta.by`), in ms: a turn begun since with no mark is the
   * person's; one begun before is read by its words (sessions/service.js `unmarkedBy`).
   * @returns {number}
   */
  bySince() {
    return Number(this.schemaMetaGet("bySince"));
  }
  /**
   * The snapshot refs a chat here names that may be another chat's: a fork's — its turns, copied from its source with
   * their trees (`setTurnTree`), and its own (`meta.tree`) name its source's. Every other chat's turns name its own refs
   * alone. Filament's footprint keeps each of these, whichever chat's it is; only the forks' rows are read.
   * @returns {Set<string>}
   */
  snapshotRefsNamed() {
    const forks = "SELECT id FROM chains WHERE kind = 'fork'";
    /** @type {Set<string>} */
    const out = new Set();
    for (const r of [
      ...this.#q(`SELECT ${jsonAt("meta_json", "tree.snapshotRef")} AS ref FROM turns WHERE chain_id IN (${forks}) AND instr(meta_json, 'snapshotRef') > 0`).all(),
      ...this.#q(`SELECT ${jsonAt("meta_json", "tree.snapshotRef")} AS ref FROM chains WHERE kind = 'fork'`).all(),
    ])
      if (r.ref) out.add(String(r.ref));
    return out;
  }
  /**
   * The threads the chats keep of the sub-agents named (`meta.subagentThreads`, the sessions service's), each with the
   * chat that keeps it — whichever chat launched it: what Filament's footprint asks of the helpers a repository's refs
   * and copies name. One pass over the chats that keep threads at all, each thread's id looked up in the ids asked
   * (`IN_LIST`), however many are asked. As kept: their texts stay hashes.
   * @param {readonly string[]} agentIds @returns {{ chainId: string, thread: any }[]}
   */
  threadsNamed(agentIds) {
    const ids = [...new Set(agentIds.map(String))];
    if (!ids.length) return [];
    const each = "json_each(CASE WHEN json_valid(c.meta_json) THEN c.meta_json ELSE '{}' END, '$.subagentThreads')";
    /** @type {{ chainId: string, thread: any }[]} */
    const out = [];
    for (const r of this.#q(`SELECT c.id AS chain, t.value AS thread FROM chains c, ${each} t WHERE instr(c.meta_json, 'subagentThreads') > 0 AND json_extract(t.value, '$.id') ${IN_LIST}`).all(listParam(ids))) {
      const thread = parseJson(r.thread, null);
      if (thread && typeof thread === "object") out.push({ chainId: String(r.chain), thread });
    }
    return out;
  }
  /**
   * The chats that keep a thread of a sub-agent on another machine (`remote`) with an exchange whose end was never kept
   * (`outcome` null): a process here ended while its turn there ran. One pass over the chats that keep threads at all.
   * @returns {string[]}
   */
  chainsCutThere() {
    const each = "json_each(CASE WHEN json_valid(c.meta_json) THEN c.meta_json ELSE '{}' END, '$.subagentThreads')";
    const open = "SELECT 1 FROM json_each(t.value, '$.exchanges') x WHERE json_type(x.value, '$.outcome') IS NULL OR json_type(x.value, '$.outcome') = 'null'";
    return this.#q(`SELECT DISTINCT c.id AS chain FROM chains c, ${each} t WHERE instr(c.meta_json, 'subagentThreads') > 0 AND json_type(t.value, '$.remote') = 'object' AND EXISTS (${open})`)
      .all()
      .map((r) => String(r.chain));
  }
  getProject(projectId) {
    return plain(this.#q("SELECT * FROM projects WHERE id = ?").get(projectId));
  }
  /**
   * The project's settings object (`settings_json`), `{}` when none or no such project; its MCP servers' credentials
   * open, as a chain's are (`chainSettings`).
   * @param {string} projectId
   */
  projectSettings(projectId) {
    const row = this.#q("SELECT settings_json FROM projects WHERE id = ?").get(projectId);
    return cryptLayer((row && parseJson(row.settings_json, null)) || {}, this.secretKey, "open");
  }
  /**
   * Merge `patch` into the project's settings (top-level keys replaced). The row must exist; false when it does not.
   * @param {string} projectId @param {Record<string, unknown>} patch
   */
  setProjectSettings(projectId, patch) {
    return this.#tx(() => {
      const row = this.#q("SELECT settings_json FROM projects WHERE id = ?").get(projectId);
      if (!row) return false;
      const next = cryptLayer({ ...(parseJson(row.settings_json, null) || {}), ...patch }, this.secretKey, "seal");
      this.#q("UPDATE projects SET settings_json = ? WHERE id = ?").run(JSON.stringify(next), projectId);
      return true;
    });
  }
  /**
   * Record one of Filament's own texts for a chain (D11): the SHA-256 of the normalized text (`\n` line endings,
   * trimmed) with its kind (`reply` for a whole answer, `prefix` for a cue placed in front of one). Content-addressed
   * like everything else — no text is stored, so the record stays content-free.
   * @param {string} chainId @param {string} hash @param {"reply" | "prefix"} kind
   */
  addLocalText(chainId, hash, kind) {
    return (
      this.#q(
        "INSERT OR IGNORE INTO local_texts (chain_id, hash, kind, created_at) VALUES (?, ?, ?, ?)",
      ).run(String(chainId), String(hash), kind === "prefix" ? "prefix" : "reply", this.now()).changes > 0
    );
  }
  /** Every recorded text of a chain as `[{ hash, kind }]`, newest first. @param {string} chainId */
  localTexts(chainId) {
    return this.#q("SELECT hash, kind FROM local_texts WHERE chain_id = ? ORDER BY created_at DESC, hash").all(
      String(chainId),
    );
  }
  /**
   * A project's chains, newest first: of `kinds` only when named (a person's sessions are `LISTED_KINDS`, brain.js),
   * else every one. @param {string} projectId @param {{ limit?: number, kinds?: readonly string[] | null }} [o]
   */
  chainsForProject(projectId, { limit = 10, kinds = null } = {}) {
    const only = kinds?.length ? ` AND COALESCE(kind, 'interactive') IN (${kinds.map(() => "?").join(",")})` : "";
    return this.#q(`SELECT * FROM chains WHERE project_id = ?${only} ORDER BY last_at DESC, started_at DESC LIMIT ?`)
      .all(projectId, ...(kinds?.length ? kinds.map(String) : []), limit)
      .map((c) => this.#chainRow(plain(c)));
  }
  /**
   * The id of the most recently active chain — of a project where named, of `kinds` where named — or null: read as its
   * id alone, its meta never parsed (memory's model asks it on a turn, the memory plan's m1).
   * @param {{ project?: string | null, kinds?: readonly string[] | null }} [o] @returns {string | null}
   */
  newestChainId({ project = null, kinds = null } = {}) {
    const where = [];
    const args = [];
    if (project) {
      where.push("project_id = ?");
      args.push(String(project));
    }
    if (kinds?.length) {
      where.push(`COALESCE(kind, 'interactive') IN (${kinds.map(() => "?").join(",")})`);
      args.push(...kinds.map(String));
    }
    const row = this.#q(`SELECT id FROM chains ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_at DESC, started_at DESC LIMIT 1`).get(...args);
    return row ? String(/** @type {any} */ (row).id) : null;
  }
  /**
   * The session list in one statement (HarnessV2 Phase 1): chains joined to their project, filtered in SQL by kind,
   * project, client and the archived flag, newest first. `ids` narrows to a set (a search's hits) and then keeps
   * the caller's order. Rows carry `projectName`/`projectCwd` beside the chain columns. `offset` skips the rows a list
   * read a page at a time has had already, in that order.
   * @param {{ ids?: string[] | null, project?: string | null, kinds?: readonly string[] | null, client?: string | null,
   *   archived?: "exclude" | "only" | "all", limit?: number, offset?: number }} [o]
   */
  listChains({ ids = null, project = null, kinds = null, client = null, archived = "exclude", limit = 50, offset = 0 } = {}) {
    const where = [];
    const args = [];
    if (ids) {
      if (!ids.length) return [];
      where.push(`c.id ${IN_LIST}`);
      args.push(listParam(ids.map(String)));
    }
    if (project) {
      where.push("c.project_id = ?");
      args.push(String(project));
    }
    if (kinds && kinds.length) {
      where.push(`COALESCE(c.kind, 'interactive') IN (${kinds.map(() => "?").join(",")})`);
      args.push(...kinds.map(String));
    }
    if (client) {
      where.push("c.client = ?");
      args.push(String(client));
    }
    // `archived` lives in meta_json; a row with no meta or invalid JSON counts as not archived.
    const flag = "CASE WHEN c.meta_json IS NOT NULL AND json_valid(c.meta_json) THEN COALESCE(json_extract(c.meta_json, '$.archived'), 0) ELSE 0 END";
    if (archived === "exclude") where.push(`${flag} = 0`);
    else if (archived === "only") where.push(`${flag} != 0`);
    const sql = `SELECT c.*, p.name AS projectName, p.cwd AS projectCwd FROM chains c LEFT JOIN projects p ON p.id = c.project_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.last_at DESC, c.started_at DESC LIMIT ? OFFSET ?`;
    const skip = Math.max(0, Math.floor(Number(offset) || 0));
    const rows = this.#q(sql)
      .all(...args, ids ? Math.max(limit, ids.length) : limit, ids ? 0 : skip)
      .map((c) => this.#chainRow(plain(c)));
    if (!ids) return rows;
    const order = new Map(ids.map((id, i) => [String(id), i]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(skip, skip + limit);
  }
  /**
   * The chats whose name — their title, else their first words (`preview`), as the sidebar shows them — holds `query`,
   * any case, newest first: a chat is found by the name the person sees (the owner's word of 11-02: the `@` panel found
   * a chat by its turns' words alone). `apartToo` false leaves out a name a turn kept apart gave (`meta.namedApart`).
   * @param {string} query @param {{ project?: string | null, kinds?: readonly string[] | null, limit?: number, apartToo?: boolean }} [o]
   * @returns {string[]}
   */
  chainsNamed(query, { project = null, kinds = null, limit = 20, apartToo = true } = {}) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return [];
    const name = apartToo ? "COALESCE(c.title, c.preview)" : `CASE WHEN ${jsonAt("c.meta_json", "namedApart")} IS NULL THEN COALESCE(c.title, c.preview) END`;
    const where = [`instr(lower(${name}), ?) > 0`];
    const args = [q];
    if (project) {
      where.push("c.project_id = ?");
      args.push(String(project));
    }
    if (kinds && kinds.length) {
      where.push(`COALESCE(c.kind, 'interactive') IN (${kinds.map(() => "?").join(",")})`);
      args.push(...kinds.map(String));
    }
    return this.#q(`SELECT c.id FROM chains c WHERE ${where.join(" AND ")} ORDER BY c.last_at DESC, c.started_at DESC LIMIT ?`)
      .all(...args, Math.max(1, Math.floor(Number(limit) || 20)))
      .map((r) => String(r.id));
  }
  /**
   * The chats of `kinds`, archived ones left out, whose folder (their own, else their project's) is one of `folders`
   * or inside one, or whose agents wrote in one (`meta.places`): a repository's worktrees' chats (HarnessV4_Git_Plan
   * GW-D39, GW-D47). Paths compare as the project id sees them (`normalizeCwd`). Each: its id, its name (its title,
   * else its first words) and whether a turn kept apart gave it (`namedApart`, `meta.namedApart`), whether it is a chat
   * of Filament's own (`own`, `meta.native`) or a client's session, its folder and its places; a routine's run, its
   * routine's title (HarnessV4_Space_Plan S6).
   * @param {string[]} folders @param {readonly string[]} kinds
   * @returns {{ id: string, name: string, namedApart: boolean, own: boolean, cwd: string | null, places: string[], routine: string }[]}
   */
  chatsTouching(folders, kinds) {
    const keys = folders.map(normalizeCwd).filter(Boolean);
    if (!keys.length || !kinds.length) return [];
    const inside = (/** @type {unknown} */ p) => {
      const n = normalizeCwd(p);
      return !!n && keys.some((k) => n === k || n.startsWith(`${k}/`));
    };
    const projects = this.#q("SELECT id, cwd FROM projects").all().map(plain).filter((p) => inside(p.cwd)).map((p) => String(p.id));
    const listed = `COALESCE(c.kind, 'interactive') IN (${kinds.map(() => "?").join(",")})`;
    const meta = "c.meta_json IS NOT NULL AND json_valid(c.meta_json)";
    const archived = `CASE WHEN ${meta} THEN COALESCE(json_extract(c.meta_json, '$.archived'), 0) ELSE 0 END`;
    const placed = `(${meta} AND json_type(c.meta_json, '$.places') = 'array')`;
    // A chat's folder is its own where it kept one, else its project's (GW-D47): a chat in a worktree stands in its
    // main folder's project.
    const owned = `(${meta} AND json_type(c.meta_json, '$.cwd') = 'text')`;
    const sql = `SELECT c.id, c.title, c.preview, COALESCE(CASE WHEN ${owned} THEN json_extract(c.meta_json, '$.cwd') END, p.cwd) AS cwd,
      CASE WHEN ${placed} THEN json_extract(c.meta_json, '$.places') END AS places,
      CASE WHEN ${meta} THEN json_extract(c.meta_json, '$.routine.title') END AS routine,
      ${jsonAt("c.meta_json", "namedApart")} AS namedApart, ${jsonAt("c.meta_json", "native")} AS native
      FROM chains c LEFT JOIN projects p ON p.id = c.project_id
      WHERE ${listed} AND ${archived} = 0 AND (${placed} OR ${owned}${projects.length ? ` OR c.project_id ${IN_LIST}` : ""})`;
    return this.#q(sql)
      .all(...kinds.map(String), ...(projects.length ? [listParam(projects)] : []))
      .map(plain)
      .map((r) => ({ ...r, places: (parseJson(r.places, []) || []).map(String) }))
      .filter((r) => inside(r.cwd) || r.places.some(inside))
      .map((r) => ({ id: String(r.id), name: String(r.title || r.preview || "").replace(/\s+/g, " ").trim(), namedApart: !!r.namedApart, own: !!r.native, cwd: r.cwd || null, places: r.places, routine: typeof r.routine === "string" ? r.routine : "" }));
  }
  /**
   * Every folder a chat works in — its own, the places its agents wrote in — and every project's, each once as kept:
   * what a view-only device may read (http/admin/remote.js `viewFolderRefusal`). `person`: the chats the person started
   * alone — none another machine's agents started (`meta.agentDevice`, sessions.js) — and the projects one of those, or
   * none, is in: where those agents may start a chat (remote.js `agentFolderRefusal`) — a chat made from one of theirs,
   * whose own meta does not say so, theirs as well (`theirs`: its parent, the chat it forked, the chat a team's runs
   * beside, up the line; the remote-agents plan's f-fence2). `agentDevice`: the chats that device started alone, and no
   * project: where it reads a file.
   * @param {{ person?: boolean, agentDevice?: string }} [o]
   * @returns {string[]}
   */
  chatFolders({ person = false, agentDevice = "" } = {}) {
    const meta = "c.meta_json IS NOT NULL AND json_valid(c.meta_json)";
    /** The chats another machine's agents started, and every chat made from one of them, down the line. */
    const theirs = `WITH RECURSIVE theirs(id) AS (
        SELECT c.id FROM chains c WHERE (CASE WHEN ${meta} THEN json_type(c.meta_json, '$.agentDevice') IS 'text' ELSE 0 END)
        UNION
        SELECT c.id FROM chains c JOIN theirs t ON c.parent_id = t.id
          OR (CASE WHEN ${meta} THEN json_extract(c.meta_json, '$.fork.from') IS t.id ELSE 0 END)
          OR EXISTS (SELECT 1 FROM links l WHERE l.src = c.id AND l.dst = t.id AND l.type = 'beside')
      )`;
    /** A chat of theirs: 1 or 0, never NULL. */
    const agents = "(c.id IN (SELECT id FROM theirs))";
    const which = agentDevice ? `WHERE (CASE WHEN ${meta} THEN json_extract(c.meta_json, '$.agentDevice') IS ? ELSE 0 END)` : person ? `WHERE NOT ${agents}` : "";
    const rows = this.#q(
      `${person && !agentDevice ? theirs : ""} SELECT DISTINCT CASE WHEN ${meta} AND json_type(c.meta_json, '$.cwd') = 'text' THEN json_extract(c.meta_json, '$.cwd') END AS cwd,
        CASE WHEN ${meta} AND json_type(c.meta_json, '$.places') = 'array' THEN json_extract(c.meta_json, '$.places') END AS places
      FROM chains c ${which}`,
    )
      .all(...(agentDevice ? [String(agentDevice)] : []))
      .map(plain);
    const projects = agentDevice
      ? []
      : person
        ? this.#q(`${theirs} SELECT p.cwd FROM projects p WHERE NOT EXISTS (SELECT 1 FROM chains c WHERE c.project_id = p.id AND ${agents}) OR EXISTS (SELECT 1 FROM chains c WHERE c.project_id = p.id AND NOT ${agents})`).all()
        : this.#q("SELECT cwd FROM projects").all();
    const out = new Set(projects.map(plain).map((p) => String(p.cwd || "")));
    for (const r of rows) {
      if (typeof r.cwd === "string") out.add(r.cwd);
      for (const p of parseJson(r.places, []) || []) out.add(String(p));
    }
    out.delete("");
    return [...out];
  }
  /**
   * The chats any of these agents' devices started (`meta.agentDevice`, sessions.js), each with its folder: those that
   * worked in a copy let go go with it (services/copies.js `onCleared`). @param {readonly string[]} devices
   * @returns {{ id: string, cwd: string | null }[]}
   */
  agentChats(devices) {
    const ids = devices.map(String).filter(Boolean);
    if (!ids.length) return [];
    const meta = "c.meta_json IS NOT NULL AND json_valid(c.meta_json)";
    return this.#q(
      `SELECT c.id, CASE WHEN ${meta} AND json_type(c.meta_json, '$.cwd') = 'text' THEN json_extract(c.meta_json, '$.cwd') END AS cwd
      FROM chains c WHERE (CASE WHEN ${meta} THEN json_extract(c.meta_json, '$.agentDevice') ELSE NULL END) IN (SELECT value FROM json_each(?))`,
    )
      .all(JSON.stringify(ids))
      .map(plain)
      .map((r) => ({ id: String(r.id), cwd: typeof r.cwd === "string" ? r.cwd : null }));
  }
  /**
   * Whether a chat is another machine's agents' (`meta.agentDevice`, sessions.js) — it, or one up its line: the chat it
   * was made from, forked from, or a team's runs beside, as `chatFolders` reads theirs (the remote-agents plan's
   * f-fence2): the words that open its turns are their agents', never the person's, to memory (fc-word) — fenced or Full
   * control alike, as no grant of their device is read. A meta that does not parse names no device.
   * @param {string} chainId @returns {boolean}
   */
  agentsChat(chainId) {
    const meta = "c.meta_json IS NOT NULL AND json_valid(c.meta_json)";
    const r = this.#q(
      `WITH RECURSIVE line(id) AS (
        SELECT ?
        UNION SELECT c.parent_id FROM chains c JOIN line l ON c.id = l.id WHERE c.parent_id IS NOT NULL
        UNION SELECT json_extract(c.meta_json, '$.fork.from') FROM chains c JOIN line l ON c.id = l.id WHERE (CASE WHEN ${meta} THEN json_type(c.meta_json, '$.fork.from') IS 'text' ELSE 0 END)
        UNION SELECT k.dst FROM links k JOIN line l ON k.src = l.id WHERE k.type = 'beside'
      )
      SELECT 1 AS x FROM chains c JOIN line l ON c.id = l.id WHERE (CASE WHEN ${meta} THEN json_type(c.meta_json, '$.agentDevice') IS 'text' ELSE 0 END) LIMIT 1`,
    ).get(String(chainId));
    return !!r;
  }
  /**
   * Whether a chat runs fenced as another machine's agents' (fc-memory): its meta names their device (`agentDevice`,
   * kept on a chat made from theirs too) and that device holds no Full control here (`fullControlOf`), read at each
   * call. A meta that cannot be read is theirs and fenced, as server.js reads it; a chat of the person's is none.
   * @param {string} chainId @returns {boolean}
   */
  fenced(chainId) {
    let device;
    try {
      device = this.metaOf(String(chainId), ["agentDevice"])?.agentDevice;
    } catch {
      return true;
    }
    return typeof device === "string" && this.fullControlOf(device) !== true;
  }
  /**
   * The developer's sessions by the day they began and the turns of each day, from `since` on, by this machine's days
   * (a Dashboard's feed, HarnessV4_Artifacts_Plan AF-D12): chats and their forks — no tick, helper or tool's chain.
   * Only the days that have either. @param {number} since  ms
   * @returns {{ day: string, sessions: number, turns: number }[]}
   */
  sessionsByDay(since) {
    const own = "COALESCE(c.kind, 'interactive') IN ('interactive', 'fork')";
    const day = (/** @type {string} */ col) => `date(${col} / 1000, 'unixepoch', 'localtime')`;
    /** @type {Map<string, { day: string, sessions: number, turns: number }>} */
    const out = new Map();
    const at = (/** @type {string} */ d) => out.get(d) || out.set(d, { day: d, sessions: 0, turns: 0 }).get(d);
    for (const r of this.#q(`SELECT ${day("c.started_at")} AS day, COUNT(*) AS n FROM chains c WHERE c.started_at >= ? AND ${own} GROUP BY 1`).all(since))
      /** @type {any} */ (at(String(r.day))).sessions = Number(r.n) || 0;
    for (const r of this.#q(`SELECT ${day("t.started_at")} AS day, COUNT(*) AS n FROM turns t JOIN chains c ON c.id = t.chain_id WHERE t.started_at >= ? AND ${own} GROUP BY 1`).all(since))
      /** @type {any} */ (at(String(r.day))).turns = Number(r.n) || 0;
    return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
  }
  recentChains({ limit = 20 } = {}) {
    return this.#q("SELECT * FROM chains ORDER BY last_at DESC, started_at DESC LIMIT ?")
      .all(limit)
      .map((c) => this.#chainRow(plain(c)));
  }
  /**
   * The newest chains as `recentChains` orders them, each its id, key and project alone: what a look through them for
   * one to borrow from reads, without each row's meta, state and settings opened. @param {number} limit
   * @returns {{ id: string, key: string, project_id: string | null }[]}
   */
  recentHeads(limit) {
    return this.#q("SELECT id, key, project_id FROM chains ORDER BY last_at DESC, started_at DESC LIMIT ?").all(limit).map((c) => ({ id: String(c.id), key: /** @type {string} */ (c.key), project_id: /** @type {string | null} */ (c.project_id) }));
  }
  /**
   * The chains whose key starts with `prefix`: an import's chains carry their source's (`cc:` for Claude Code), so
   * this is every chat that came from that agent. @param {string} prefix
   */
  chainsWithKeyPrefix(prefix) {
    const p = String(prefix);
    return this.#q("SELECT * FROM chains WHERE substr(key, 1, ?) = ?")
      .all(p.length, p)
      .map((c) => this.#chainRow(plain(c)));
  }
  /**
   * The chain's first user text, for a row label when the chain has no title. Read from the search index (the one
   * plain-text copy), so a chain indexed with the index off has none — null, never a decrypted body.
   * @param {string} chainId @returns {string | null}
   */
  firstUserText(chainId) {
    if (!this.index) return null;
    // A command Filament answered is no message of the person's to the model (backlog 18).
    const row = this.#q(
      "SELECT f.text AS text FROM fts_text f JOIN turns t ON t.id = f.turn_id WHERE f.chain_id = ? AND f.role = 'user' AND COALESCE(json_extract(t.meta_json, '$.command'), 0) = 0 ORDER BY t.n LIMIT 1",
    ).get(chainId);
    return row?.text ? String(row.text) : null;
  }
  setState(chainId, state) {
    const s = state ? { ...state, updatedAt: state.updatedAt ?? this.now() } : null;
    this.#q("UPDATE chains SET state_json = ? WHERE id = ?").run(s ? JSON.stringify(s) : null, chainId);
    return s;
  }
  setTitle(chainId, title) {
    this.#q("UPDATE chains SET title = ? WHERE id = ?").run(title ?? null, chainId);
  }
  /** The chain's model column alone — a settings change, not a request, so `last_at` and the project stay put. */
  setChainModel(chainId, model) {
    this.#q("UPDATE chains SET model = ? WHERE id = ?").run(model ?? null, chainId);
  }
  setBriefing(chainId, text) {
    this.#q("UPDATE chains SET briefing = ? WHERE id = ?").run(text ?? null, chainId);
  }
  rekeyChain(chainId, newKey) {
    this.#q("UPDATE chains SET key = ? WHERE id = ?").run(newKey, chainId);
  }
  setMeta(chainId, meta) {
    this.#q("UPDATE chains SET meta_json = ? WHERE id = ?").run(meta ? JSON.stringify(meta) : null, chainId);
    this.#native.delete(String(chainId));
  }
  /**
   * The chain's meta as it is NOW, changed by `change` in place and written back, in one transaction: read once and
   * written once, however much `change` does — a writer that would read the chain whole and then merge (two parses of
   * a meta that grows with the chat) does it here instead. → the meta as written, or null when there is no such chain.
   * @param {string} chainId @param {(meta: Record<string, any>) => void} change
   * @returns {Record<string, any> | null}
   */
  updateMeta(chainId, change) {
    return this.#tx(() => {
      const id = String(chainId);
      const row = this.#q("SELECT meta_json FROM chains WHERE id = ?").get(id);
      if (!row) return null;
      const meta = parseJson(row.meta_json, null) || {};
      const native = meta.native === true;
      change(meta);
      if ((meta.native === true) !== native) this.#native.delete(id);
      this.#q("UPDATE chains SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
      return meta;
    });
  }
  // A few keys onto the chain's meta as it is NOW. For a writer that read the meta before an await: writing its stale
  // copy back whole would undo whatever landed meanwhile (a goal accepted, a
  // ledger entry). Synchronous read-then-write sites need no such care.
  /** @param {string} chainId @param {Record<string, any>} patch  `undefined` deletes a key */
  mergeMeta(chainId, patch) {
    return this.updateMeta(chainId, (meta) => {
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === undefined) delete meta[k];
        else meta[k] = v;
      }
    });
  }
  // The chains whose task graph is open (HarnessV3-TaskGraph G2-9): as Filament starts, its runner fails what a restart
  // cut in each.
  /** @returns {{ id: string, graph: any }[]} */
  openGraphs() {
    return this.#q("SELECT id, json_extract(meta_json, '$.graph') AS graph FROM chains WHERE json_extract(meta_json, '$.graph') IS NOT NULL AND json_extract(meta_json, '$.graph.closed') IS NULL")
      .all()
      .map((r) => ({ id: String(r.id), graph: JSON.parse(String(r.graph)) }));
  }
  // The chains whose background commands ran as Filament last stopped (`shellsRunning`, kept while they run): as it
  // starts, each chat is told which its stop ended.
  /** @returns {{ id: string, shells: any[] }[]} */
  shellsRunning() {
    return this.#q("SELECT id, shells FROM (SELECT id, CASE WHEN json_valid(meta_json) THEN meta_json -> '$.shellsRunning' END AS shells FROM chains) WHERE shells IS NOT NULL")
      .all()
      .map((r) => ({ id: String(r.id), shells: [JSON.parse(String(r.shells))].flat() }));
  }
  // The threads whose start is not settled (app/threads.js `threadStart`, kept from before a thread's brief is posted
  // until its turn began — with notify, until its first reply went to its starter): as Filament starts, its runner takes
  // back one that never got its brief, and owes the others their reply again.
  /** @returns {{ id: string, start: any }[]} */
  threadStarts() {
    return this.#q("SELECT id, start FROM (SELECT id, CASE WHEN json_valid(meta_json) THEN meta_json -> '$.threadStart' END AS start FROM chains) WHERE start IS NOT NULL")
      .all()
      .map((r) => ({ id: String(r.id), start: JSON.parse(String(r.start)) }))
      .filter((r) => r.start && typeof r.start === "object");
  }
  // The chains Filament may owe a wake as it starts again (sessions/owed-wakes.js, the nudge map of 11-10): what waited
  // for their agent and their timers (`owedWakes`), a driving goal's round (`goalOwed`), or a report or letter in their
  // queue that wakes them (`subagentQueue`'s `wakes`).
  /** @returns {{ id: string, owed: any, goal: boolean, queued: boolean }[]} */
  owedWakes() {
    return this.#q(
      "SELECT id, owed, goal, queue FROM (SELECT id, CASE WHEN json_valid(meta_json) THEN meta_json -> '$.owedWakes' END AS owed, CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.goalOwed') END AS goal, CASE WHEN json_valid(meta_json) THEN meta_json -> '$.subagentQueue' END AS queue FROM chains) WHERE owed IS NOT NULL OR goal IS NOT NULL OR queue IS NOT NULL",
    )
      .all()
      .map((r) => {
        const queue = r.queue == null ? [] : [JSON.parse(String(r.queue))].flat();
        return { id: String(r.id), owed: r.owed == null ? null : JSON.parse(String(r.owed)), goal: Number(r.goal) === 1, queued: queue.some((e) => e?.wakes === true) };
      })
      .filter((r) => r.owed || r.goal || r.queued);
  }
  // One entry onto a list in the chain's meta, as it is NOW (like mergeMeta), keeping the newest `max`.
  /** @param {string} chainId @param {string} key @param {any} entry @param {number} max */
  appendMeta(chainId, key, entry, max) {
    const meta = this.updateMeta(chainId, (m) => {
      m[key] = [...(Array.isArray(m[key]) ? m[key] : []), entry].slice(-Math.max(1, max));
    });
    return meta ? entry : null;
  }
  // The chain's newest turn number (0 before its first); `ended`: of the newest turn that finished.
  /** @param {string} chainId @param {{ ended?: boolean }} [o] */
  newestTurnN(chainId, { ended = false } = {}) {
    return Number(this.#q(`SELECT MAX(n) AS n FROM turns WHERE chain_id = ?${ended ? " AND ended_at IS NOT NULL" : ""}`).get(String(chainId))?.n) || 0;
  }
  setParent(chainId, parentId) {
    this.#q("UPDATE chains SET parent_id = ? WHERE id = ?").run(parentId ?? null, chainId);
  }
  // The chain's memory blocks, one row per message hash — never capped, never rewritten as a whole: each new
  // block is a single INSERT, and every resend reads exactly what was first sent (prompt-cache stability).
  // `nth` is the 1-based occurrence of the hash among user messages when the block was created, so a later
  // duplicate of the same text does not get an older twin's block (that would change already-sent history).
  blocksFor(chainId) {
    const out = {};
    for (const r of this.#q("SELECT hash, block, nth, kind FROM blocks WHERE chain_id = ?").all(
      String(chainId),
    ))
      out[r.hash] = { text: r.block, nth: r.nth || 1, kind: r.kind || "turn" };
    return out;
  }
  setBlock(chainId, hash, text, nth = 1, kind = "turn") {
    this.#q(
      "INSERT OR REPLACE INTO blocks (chain_id, hash, block, nth, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      String(chainId),
      String(hash),
      String(text),
      Math.max(1, nth | 0),
      String(kind || "turn"),
      this.now(),
    );
  }

  // ---- turns -----------------------------------------------------------------------------------------------------
  // `userMessage` is the message that started the turn (the newest user message that is not a tool result). A request
  // whose person message has the same identity as the chain's newest, still-open turn is another leg of the same tool
  // loop → isNew:false; so is a second send of the message a request of its window runs right now, which memory tells
  // (`joinsRunning`): it is that request's turn, the window's newest with the message still marked `meta.running`
  // and on the line, whatever turns opened since (a side request of its window, alongside it). A mark alone joins
  // nothing — a turn a restart cut off keeps its mark. Anything else opens turn n+1. The user text goes into the search index once, when the turn opens.
  // The identity is D3's: the message's trimmed text (`pinHashOf`), not its bytes — a client that re-serializes the
  // message between legs (a cache_control marker moved or dropped) stays the same conversation, and repeated texts
  // ("continue") are still told apart by searching in order at alignment.
  // Each turn is stamped (Step 3 D3/D4): `meta.window` — where it was typed, `harness` or the window's conversation
  // key (null on Filament's own housekeeping writes, which no window typed); `meta.format` — the wire format its
  // messages are stored in; `meta.key` — the pin identity itself, so alignment needs no message bodies; `meta.engine`
  // — who answered it (HarnessV3-AtHome AH-O7, app/engine.js `turnEngine`): the agent loop alone or a team's lead,
  // written when the turn opens and kept by its later legs.
  /**
   * The pin identity of an archived turn (D3), the one answer beginTurn, turnForUser and alignment share: its
   * `meta.key` stamp, written when the turn opened. "" for a turn without one, which matches no person message.
   * @param {{ id: number, user_hash?: string | null, meta?: Record<string, any> | null }} turn
   */
  pinOfTurn(turn) {
    return turn?.meta?.key ? String(turn.meta.key) : "";
  }
  // `startedAt` is when a turn recorded after the fact began: a command Filament answered is written with its answer,
  // but began when its request arrived — a compaction it wrote is undoable until the next message (HarnessV3-Launch
  // RD-D4). Otherwise the turn begins now. `own`: a coding agent began the turn by itself (HarnessV3-ACP AC3-9) —
  // whose, and the background tasks it answers; its message is Filament's words, never the chain's label. `running`: a
  // request runs the turn from now on, opened or gone on with — `meta.running` is when it began, and the request's
  // record closing clears it (memory `turnStopped`). One still there after a restart ran at it (`cutOffBefore`,
  // HarnessV3-FailurePoints finding 3). `alongside`: the turn came alongside its window's turn (memory's `alongside`,
  // `alignHistory`) — a turn of its own, built on none of that one (`meta.alongside`). `joinsRunning`: a request of the
  // window with the same message runs now, as memory tells it too. `send`: the page's own name for the send — each the
  // turn holds is on it (`meta.sends`, the newest `SENDS_KEPT`), a try going on in it adding its own. `apart`: the chat's
  // turns are its own alone as the turn is begun or gone on with, why in words (Memory settings leave the chat out, or
  // turn capture is off in a chat Filament composes) — the turn stays apart for good (`meta.apart`): memory reads it for
  // no other chat or call whatever the settings say later (`apartToo`), and one that names the chat — its preview, or
  // its title — leaves the chat named by words memory gives no other (`meta.namedApart`). `brief`: its message is a
  // thread's brief (core/threads.js), the starter's agent's words posted by Filament (`meta.brief`): none of the
  // person's to quote (`personTurns`), and drawn as a brief wherever it stands in its chat. `by`: who began the turn where
  // it is not the person (core/turn-by.js, `meta.by`): none of theirs to quote, and kept by a try going on in its row.
  beginTurn(chainId, { requestId = null, model = null, upstream = null, client = null, window = null, format = null, engine = null, userMessage, command = false, startedAt = null, own = null, running = false, alongside = false, joinsRunning = false, send = null, apart = null, brief = false, by = null } = {}) {
    if (userMessage === undefined) throw new Error("Archive: beginTurn needs a userMessage");
    return this.#tx(() => {
      const t = this.now();
      const user = this.putMessage("user", userMessage);
      const text = textOfMessage(userMessage);
      const pin = pinHashOf(userMessage);
      // The turn this message goes on with: the chain's newest, still open — or, for a second send of a running
      // request's message, the window's newest that request runs.
      const cols = "SELECT id, n, user_hash, ended_at, request_ids_json, meta_json FROM turns WHERE chain_id = ?";
      const newest = this.#q(`${cols} ORDER BY n DESC LIMIT 1`).get(chainId);
      let sameMeta = newest ? parseJson(newest.meta_json, null) || {} : {};
      let same = newest && newest.ended_at == null && this.pinOfTurn({ id: newest.id, user_hash: newest.user_hash, meta: sameMeta }) === pin ? newest : null;
      if (!same && joinsRunning) {
        const m = (/** @type {string} */ path) => `CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '${path}') END`;
        same =
          this.#q(`${cols} AND ${m("$.running")} IS NOT NULL AND ${m("$.rewound")} IS NULL AND ${m("$.key")} = ? AND ${m("$.window")} IS ? ORDER BY n DESC LIMIT 1`).get(
            chainId,
            pin,
            window == null ? null : String(window),
          ) || null;
        sameMeta = same ? parseJson(same.meta_json, null) || {} : {};
      }
      this.#q("UPDATE chains SET last_at = ? WHERE id = ?").run(t, chainId);
      if (same) {
        const ids = parseJson(same.request_ids_json, []);
        if (requestId && !ids.includes(requestId)) ids.push(requestId);
        if (running) sameMeta.running = startedAt ?? t;
        // A request that runs the turn from now on starts it again — a failed try's retry: its start is the turn's newest
        // (`meta.lastStart`), and what was made between the tries is behind it (`lastStartedAt`).
        if (running) sameMeta.lastStart = startedAt ?? t;
        const sends = Array.isArray(sameMeta.sends) ? sameMeta.sends : [];
        if (send && !sends.includes(String(send))) sameMeta.sends = [...sends, String(send)].slice(-SENDS_KEPT);
        if (apart && !sameMeta.apart) sameMeta.apart = String(apart);
        if (brief) sameMeta.brief = true;
        if (by && !sameMeta.by) sameMeta.by = String(by);
        this.#q(
          "UPDATE turns SET request_ids_json = ?, model = COALESCE(?, model), upstream = COALESCE(?, upstream), meta_json = ? WHERE id = ?",
        ).run(JSON.stringify(ids), model, upstream, JSON.stringify(sameMeta), same.id);
        return { turnId: same.id, n: same.n, isNew: false };
      }
      const n = (newest?.n || 0) + 1;
      // Which client ran the turn rides in the turn's meta — one shared session across clients (HarnessV3 §8) reads
      // it to know whose window the turn belongs to. Null on Filament's own housekeeping writes.
      const meta = { key: pin };
      if (client) meta.client = String(client);
      if (window) meta.window = String(window);
      if (format) meta.format = String(format);
      if (engine) meta.engine = engine;
      // A message Filament answered itself (`/set …`, `/goal …`): a turn of the transcript, never the chain's label.
      if (command) meta.command = true;
      if (own) meta.own = own;
      if (running) meta.running = startedAt ?? t;
      if (alongside) meta.alongside = true;
      if (send) meta.sends = [String(send)];
      if (apart) meta.apart = String(apart);
      if (brief) meta.brief = true;
      if (by) meta.by = String(by);
      const r = this.#q(
        "INSERT INTO turns (chain_id, n, started_at, request_ids_json, model, upstream, user_hash, work_json, input_chars, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)",
      ).run(
        chainId,
        n,
        startedAt ?? t,
        JSON.stringify(requestId ? [requestId] : []),
        model,
        upstream,
        user.hash,
        text.length,
        JSON.stringify(meta),
      );
      const turnId = Number(r.lastInsertRowid);
      // The chain's window list (D2): the turn's window is on it, with its client. Built from the chain's turns when it
      // has none yet (its earlier turns named no window), so the list exists from the first stamped turn on.
      if (window) this.#stampWindow(chainId, String(window), client ? String(client) : null);
      this.#fts(chainId, turnId, "user", textOfMessage(withoutAskLine(userMessage)));
      // The row's label until a title exists — written once, from the first message that reached the model (a
      // command Filament answered labels nothing: backlog 18), and only where the plaintext index is on (same line).
      const ownText = own ? "" : ownTextOf(userMessage);
      let named = false;
      if (!command && this.index && ownText.trim())
        named =
          Number(
            this.#q("UPDATE chains SET preview = ? WHERE id = ? AND preview IS NULL").run(
              cap(ownText.replace(/\s+/g, " ").trim(), PREVIEW_CHARS),
              chainId,
            ).changes,
          ) > 0;
      // A harness session asked to be named by its first message (`autoTitle`): that message's first line, the first
      // time one reaches the model. The title is kept whether or not the index is on, as the create call's was. The ask
      // is read as its one key of the meta, which grows with the chat: the meta is opened whole once, to take it off. A
      // title it gave is marked Filament's (`autoNamed`), which the side model may name again once (app/chat-namer.js).
      if (!command && ownText.trim() && this.metaOf(chainId, ["autoTitle"])?.autoTitle) {
        const c = this.#q("SELECT title, meta_json FROM chains WHERE id = ?").get(chainId);
        const cm = parseJson(c?.meta_json, null);
        if (cm?.autoTitle) {
          if (!c.title) {
            this.#q("UPDATE chains SET title = ? WHERE id = ?").run(firstLineTitle(ownText), chainId);
            named = true;
            cm.autoNamed = true;
          }
          delete cm.autoTitle;
          this.#q("UPDATE chains SET meta_json = ? WHERE id = ?").run(JSON.stringify(cm), chainId);
        }
      }
      if (named && apart) this.#setMetaKey(chainId, "namedApart", true);
      return { turnId, n, isNew: true };
    });
  }
  // meta.windows upkeep inside a caller's transaction: `{ [window]: { client } }`. A turn of a window the kept list
  // already names with its client writes nothing; otherwise the list is read and written as its one key
  // (`#setMetaKey`), the rest of the meta, which grows with the chat, left as it is stored.
  #stampWindow(chainId, window, client) {
    const kept = this.metaOf(String(chainId), ["windows"]);
    if (!kept) return;
    const stored = kept.windows && typeof kept.windows === "object" ? kept.windows : null;
    const windows = stored || this.#windowsFromTurns(chainId).windows;
    const named = client ?? windows[window]?.client ?? null;
    if (stored && Object.hasOwn(stored, window) && stored[window]?.client === named) return;
    windows[window] = { client: named };
    this.#setMetaKey(String(chainId), "windows", windows);
  }
  /**
   * One key of a chain's meta written in place by SQLite (`json_set`), the rest of the stored text kept byte for byte:
   * the meta as parsing it, setting the key and `JSON.stringify` would write it (the key where it stood, or last when
   * new), without the meta opened whole. A meta that is no JSON object reads as none (`parseJson(...) || {}`) and
   * becomes the key alone. Not for `native`, which `chainHead` keeps (`#native`). A key is a plain name.
   * @param {string} chainId @param {string} key @param {any} value
   */
  #setMetaKey(chainId, key, value) {
    if (!/^[A-Za-z_$][\w$]*$/.test(key) || key === "native") throw new Error(`Archive: "${key}" is no meta key #setMetaKey writes`);
    const json = JSON.stringify(value);
    this.#q(
      `UPDATE chains SET meta_json = CASE WHEN json_valid(meta_json) AND json_type(meta_json) = 'object' THEN json_set(meta_json, '$.${key}', json(?)) ELSE json_object('${key}', json(?)) END WHERE id = ?`,
    ).run(json, json, chainId);
  }
  /**
   * Keys of a chain's meta written in place (`#setMetaKey`), the rest of its stored text kept and never opened whole:
   * what a request writes of a meta that grows with the chat (brain.js `applyGoal`'s pin). A key whose value is
   * undefined is left as it stands.
   * @param {string} chainId @param {Record<string, any>} patch
   */
  setMetaKeys(chainId, patch) {
    this.#tx(() => {
      for (const [k, v] of Object.entries(patch || {})) if (v !== undefined) this.#setMetaKey(String(chainId), k, v);
    });
  }
  // The chain's window list (D2), as it stands — built from the turns the first time it is needed and persisted, then
  // kept up to date by beginTurn. → { [window]: { client } }
  // A list kept is read as its one key of the meta, with no lock taken: every transcript read asks, and the meta grows
  // with the chat. A chain with no turn has none to build, and writes nothing; only one with turns and no list kept
  // yet takes the writer's way, which builds the list and writes it.
  windowsOf(chainId) {
    const kept = this.metaOf(String(chainId), ["windows"]);
    if (!kept) return {};
    if (kept.windows && typeof kept.windows === "object" && Object.keys(kept.windows).length) return kept.windows;
    if (!this.#q("SELECT 1 AS x FROM turns WHERE chain_id = ? LIMIT 1").get(String(chainId))) return {};
    return this.#tx(() => {
      const row = this.#q("SELECT meta_json FROM chains WHERE id = ?").get(String(chainId));
      if (!row) return {};
      const meta = parseJson(row.meta_json, null) || {};
      if (meta.windows && typeof meta.windows === "object" && Object.keys(meta.windows).length) return meta.windows;
      const built = this.#windowsFromTurns(chainId);
      if (built.changed) {
        meta.windows = built.windows;
        this.#q("UPDATE chains SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), String(chainId));
      }
      return built.windows;
    });
  }
  // D1's rule for a turn no window named (Filament's own housekeeping writes): `harness` when the harness ran it (the client stamp or a
  // composed stamp says so), else the chain's own key. One owner — the window list, the composer and the lining up
  // of a client's history (memory `alignHistory`) all read it.
  // @param {{ meta?: Record<string, any> } | null} turn @param {{ key?: string | null } | null} chain
  static turnWindow(turn, chain) {
    const m = turn?.meta || {};
    return m.client === "harness" || m.composed ? "harness" : chain?.key ?? "unknown";
  }
  // D1's rule over the archived turns; changed=false when there was nothing to build from (a chain with no turns
  // keeps no list until its first stamped turn opens). A turn with no client of its own takes the chain's.
  #windowsFromTurns(chainId) {
    const chain = this.#q("SELECT key, client FROM chains WHERE id = ?").get(String(chainId));
    /** @type {Record<string, { client: string | null }>} */
    const windows = {};
    let any = false;
    for (const r of this.#q("SELECT meta_json FROM turns WHERE chain_id = ? ORDER BY n").all(String(chainId))) {
      const meta = parseJson(r.meta_json, null);
      const m = meta || {};
      const w = Archive.turnWindow({ meta }, chain);
      const mine = w === "harness";
      windows[w] = { client: m.client ?? windows[w]?.client ?? (mine ? null : chain?.client ?? null) };
      any = true;
    }
    return { windows, changed: any };
  }
  // The turn a tool-loop leg continues (HarnessV2 F6): the chain's newest turn, when its person message and the
  // leg's newest person-speaking message share D3's identity — open or already closed, since a proxied client's loop
  // closes the turn at every leg's reply and the next leg reopens it with the work so far. Only the newest turn
  // qualifies (as `beginTurn`'s dedupe does): a leg whose text matches an older turn ("continue", "go") must not
  // reopen that one. Byte-exact hashing served here until Step 3: a client that re-serializes the person message
  // between legs (its cache_control marker moved) broke it, and the leg went unarchived — the pin identity holds.
  // With `window` (Step 3): the newest turn OF THAT WINDOW — on a shared session the chain's newest may be another
  // window's, and a leg of this window's turn must still archive its work; the look-alike rule applies within the
  // window. A window runs loops beside each other too (a side request alongside its turn, each a turn of its own), so
  // past the window's newest, the leg's turn is the window's newest with its person message while that turn's loop is
  // still open — its newest reply called a tool, or it has none yet: whatever turns opened since, a leg of a loop at
  // work finds its turn, and a look-alike of a turn that answered never reopens it. A turn no window named belongs to
  // the chain's own window, as D9's by-kind rule says.
  turnForUser(chainId, userMessage, { window = null } = {}) {
    const id = String(chainId);
    const pin = pinHashOf(userMessage);
    /** @param {any} row */
    const same = (row) => !!row && this.pinOfTurn({ id: row.id, user_hash: row.user_hash, meta: parseJson(row.meta_json, null) }) === pin;
    /** @param {any} row */
    const found = (row) => ({ turnId: row.id, n: row.n, endedAt: row.ended_at ?? null });
    if (window == null) {
      const row = this.#q("SELECT id, n, ended_at, user_hash, meta_json FROM turns WHERE chain_id = ? ORDER BY n DESC LIMIT 1").get(id);
      return same(row) ? found(row) : null;
    }
    // The window's turns: its stamped turns, or a turn no window named, standing for the chain's own window.
    const mine = "t.chain_id = ? AND (json_extract(t.meta_json, '$.window') = ? OR (json_extract(t.meta_json, '$.window') IS NULL AND c.key = ?))";
    const newest = this.#q(`SELECT t.id, t.n, t.ended_at, t.user_hash, t.meta_json FROM turns t JOIN chains c ON c.id = t.chain_id WHERE ${mine} ORDER BY t.n DESC LIMIT 1`).get(id, String(window), String(window));
    if (same(newest)) return found(newest);
    const row = this.#q(
      `SELECT t.id, t.n, t.ended_at, t.user_hash, t.meta_json, t.final_hash, m.kind AS final_kind FROM turns t JOIN chains c ON c.id = t.chain_id LEFT JOIN messages m ON m.hash = t.final_hash WHERE ${mine} AND CASE WHEN json_valid(t.meta_json) THEN json_extract(t.meta_json, '$.key') END = ? ORDER BY t.n DESC LIMIT 1`,
    ).get(id, String(window), String(window), pin);
    return same(row) && (row.final_hash == null || row.final_kind === "tool_use") ? found(row) : null;
  }
  /**
   * A window's loops of one person message that wait on their tools (memory's `alongside`): its turns on the line with
   * that pin (`pinOfTurn`) whose newest reply called a tool, and past which the conversation has not gone on — no newer
   * turn of the window on the line came beside nothing (`meta.alongside`) and is no command's — oldest first: each its
   * number and the replies its loop's last request held, the legs of its work (`meta.tally`). The window's turns as
   * `turnForUser` reads them: its stamped turns, or a turn no window named, standing for the chain's own window. Read off
   * the rows by SQLite: no message is opened.
   * @param {string} chainId @param {string} window @param {string} pin
   * @returns {{ n: number, legs: number }[]}
   */
  loopsWaiting(chainId, window, pin) {
    const m = (/** @type {string} */ t, /** @type {string} */ path) => `CASE WHEN json_valid(${t}.meta_json) THEN json_extract(${t}.meta_json, '${path}') END`;
    const mine = (/** @type {string} */ t) => `(${m(t, "$.window")} = ? OR (${m(t, "$.window")} IS NULL AND c.key = ?))`;
    const onLine = (/** @type {string} */ t) => `${m(t, "$.rewound")} IS NULL`;
    const w = String(window);
    return this.#q(
      `SELECT t.n, ${m("t", "$.tally.legs")} AS legs FROM turns t JOIN chains c ON c.id = t.chain_id JOIN messages f ON f.hash = t.final_hash
       WHERE t.chain_id = ? AND ${m("t", "$.key")} = ? AND ${mine("t")} AND ${onLine("t")} AND f.kind = 'tool_use'
       AND NOT EXISTS (SELECT 1 FROM turns u WHERE u.chain_id = t.chain_id AND u.n > t.n AND ${mine("u")} AND ${onLine("u")} AND ${m("u", "$.alongside")} IS NULL AND ${m("u", "$.command")} IS NULL)
       ORDER BY t.n`,
    )
      .all(String(chainId), String(pin), w, w, w, w)
      .map((r) => ({ n: Number(r.n), legs: Number(r.legs) || 0 }));
  }
  /**
   * Whether a loop of a window waits on its tools (memory's `turnStopped`): the window's newest turn on the line that
   * came beside nothing and is no command's ended its newest reply on a tool call. The window's turns as `loopsWaiting`
   * reads them. Read off the rows by SQLite: no message is opened.
   * @param {string} chainId @param {string} window
   */
  loopWaits(chainId, window) {
    const m = (/** @type {string} */ path) => `CASE WHEN json_valid(t.meta_json) THEN json_extract(t.meta_json, '${path}') END`;
    const w = String(window);
    const row = this.#q(
      `SELECT f.kind FROM turns t JOIN chains c ON c.id = t.chain_id LEFT JOIN messages f ON f.hash = t.final_hash
       WHERE t.chain_id = ? AND (${m("$.window")} = ? OR (${m("$.window")} IS NULL AND c.key = ?)) AND ${m("$.rewound")} IS NULL
       AND ${m("$.alongside")} IS NULL AND ${m("$.command")} IS NULL ORDER BY t.n DESC LIMIT 1`,
    ).get(String(chainId), w, w);
    return row?.kind === "tool_use";
  }
  /**
   * The turn of a chain one of whose requests this was (HarnessV3-Memory M7-1: the turn that launched a sub-agent, so
   * what memory says at the sub-agent's calls is that turn's), or null. @param {string} chainId @param {string | null} requestId
   * @returns {number | null}  the turn's row id
   */
  turnOfRequest(chainId, requestId) {
    const row = this.#q("SELECT t.id FROM turns t, json_each(t.request_ids_json) j WHERE t.chain_id = ? AND j.value = ? ORDER BY t.n DESC LIMIT 1").get(String(chainId), String(requestId));
    return row ? Number(row.id) : null;
  }
  // Everything between the user message and the final answer (tool calls, tool results, thinking), in order; hashes
  // already on the turn are not repeated, so replaying a whole loop leg is harmless. → the turn's work hashes.
  // The work's tool legs and calls are counted as it is written (`meta.tally`, core/tool-vocab.js `tallyOfWork`):
  // a page heads the turn's work with them, and reading them opens no message.
  addWork(turnId, messages) {
    return this.#tx(() => {
      const row = this.#q("SELECT work_json, meta_json FROM turns WHERE id = ?").get(turnId);
      if (!row) throw new Error(`Archive: no turn ${turnId}`);
      const work = parseJson(row.work_json, []);
      const seen = new Set(work);
      /** @type {any[]} */
      const added = [];
      for (const m of messages || []) {
        const role =
          m?.role || (m?.type === "tool_result" || m?.type === "function_call_output" ? "user" : "assistant");
        const { hash } = this.putMessage(role, m);
        if (!seen.has(hash)) {
          seen.add(hash);
          work.push(hash);
          added.push(m);
        }
      }
      const meta = parseJson(row.meta_json, null) || {};
      const more = tallyOfWork(added);
      meta.tally = { legs: (Number(meta.tally?.legs) || 0) + more.legs, calls: (Number(meta.tally?.calls) || 0) + more.calls };
      this.#q("UPDATE turns SET work_json = ?, meta_json = ? WHERE id = ?").run(JSON.stringify(work), JSON.stringify(meta), turnId);
      return work;
    });
  }
  // The turn's work replaced whole, in the order given (an import re-run closing a loop an earlier run saw cut short:
  // the call that stood as the final takes its place before its result). → the turn's work hashes.
  setWork(turnId, messages) {
    return this.#tx(() => {
      const row = this.#q("SELECT meta_json FROM turns WHERE id = ?").get(turnId);
      if (!row) throw new Error(`Archive: no turn ${turnId}`);
      /** @type {string[]} */
      const work = [];
      const seen = new Set();
      /** @type {any[]} */
      const kept = [];
      for (const m of messages || []) {
        const role =
          m?.role || (m?.type === "tool_result" || m?.type === "function_call_output" ? "user" : "assistant");
        const { hash } = this.putMessage(role, m);
        if (seen.has(hash)) continue;
        seen.add(hash);
        work.push(hash);
        kept.push(m);
      }
      const meta = { ...(parseJson(row.meta_json, null) || {}), tally: tallyOfWork(kept) };
      this.#q("UPDATE turns SET work_json = ?, meta_json = ? WHERE id = ?").run(JSON.stringify(work), JSON.stringify(meta), turnId);
      return work;
    });
  }
  /**
   * A stretch of a turn's work, in order: the messages at `from` up to (not including) `to`, and how many the turn
   * has. Only those are opened; one the archive no longer holds is null, so a place in the list stays that place.
   * @param {number} turnId @param {{ from?: number, to?: number | null }} [o]
   * @returns {{ total: number, messages: any[] }}
   */
  turnWork(turnId, { from = 0, to = null } = {}) {
    const row = this.#q("SELECT work_json FROM turns WHERE id = ?").get(turnId);
    if (!row) throw new Error(`Archive: no turn ${turnId}`);
    const work = parseJson(row.work_json, []);
    return { total: work.length, messages: work.slice(from, to ?? undefined).map((/** @type {string} */ h) => this.getMessage(h)?.message ?? null) };
  }
  // The final assistant message closes the turn: final_hash, ended_at, output_chars (given, else the text length), the
  // answer's text in the search index (replacing an earlier one if a turn is finished twice) and chains.turns = finished turns.
  finishTurn(turnId, { finalMessage, requestId = null, outputChars = null } = {}) {
    return this.#tx(() => {
      const row = this.#q("SELECT id, chain_id, n, request_ids_json, ended_at FROM turns WHERE id = ?").get(
        turnId,
      );
      if (!row) throw new Error(`Archive: no turn ${turnId}`);
      const t = this.now();
      const fin = this.putMessage(finalMessage?.role || "assistant", finalMessage);
      const text = textOfMessage(finalMessage);
      const ids = parseJson(row.request_ids_json, []);
      if (requestId && !ids.includes(requestId)) ids.push(requestId);
      this.#q(
        "UPDATE turns SET final_hash = ?, ended_at = ?, output_chars = ?, request_ids_json = ? WHERE id = ?",
      ).run(fin.hash, t, outputChars ?? text.length, JSON.stringify(ids), turnId);
      this.#q("DELETE FROM fts_text WHERE turn_id = ? AND role = 'assistant'").run(turnId);
      this.#q("DELETE FROM fts_tri WHERE turn_id = ? AND role = 'assistant'").run(turnId);
      this.#fts(row.chain_id, turnId, "assistant", text);
      // Counter, not a COUNT subquery: finishing the same turn twice must not double-count (W3.9).
      if (row.ended_at == null)
        this.#q("UPDATE chains SET turns = COALESCE(turns, 0) + 1, last_at = ? WHERE id = ?").run(
          t,
          row.chain_id,
        );
      else this.#q("UPDATE chains SET last_at = ? WHERE id = ?").run(t, row.chain_id);
      return { turnId, n: row.n, hash: fin.hash };
    });
  }
  /**
   * The model that answered a turn, where the turn opened without one (an import that read it before its answer was
   * written). @param {number} turnId @param {string} model
   */
  setTurnModel(turnId, model) {
    this.#q("UPDATE turns SET model = ? WHERE id = ?").run(String(model), turnId);
  }
  setTurnSummary(turnId, summary) {
    this.#q("UPDATE turns SET summary = ? WHERE id = ?").run(summary ?? null, turnId);
  }
  // The working-tree snapshot taken while this turn ran (WP-J.2): the newest one wins, so a fork at the turn rewinds
  // the files to where the turn left them. Ids only — the commit and the ref, never a path list.
  /** @param {number} turnId @param {{ ref: string, commit: string, round?: number | null }} o */
  setTurnTree(turnId, { ref, commit, round = null }) {
    const row = this.#q("SELECT meta_json FROM turns WHERE id = ?").get(turnId);
    if (!row) throw new Error(`Archive: no turn ${turnId}`);
    const meta = parseJson(row.meta_json, null) || {};
    meta.tree = { snapshotRef: String(ref), commit: String(commit), at: this.now(), ...(round != null ? { round } : {}) };
    // A snapshot of the folder holds all the turn wrote there before it: what an earlier one failed to hold is in it.
    delete meta.treeUnheld;
    this.#q("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), turnId);
    return meta.tree;
  }
  // The snapshot in force at turn `atTurn` of a chain: the newest turn ≤ atTurn that has one, or null — with what that
  // turn and the ones after it wrote in the folder that no snapshot holds (`unheld`, each turn's newest first), where
  // any did.
  /** @param {string} chainId @param {number} atTurn */
  treeAtTurn(chainId, atTurn) {
    const rows = this.#q("SELECT n, meta_json FROM turns WHERE chain_id = ? AND n <= ? ORDER BY n DESC").all(
      String(chainId),
      Number(atTurn),
    );
    /** @type {{ turn: number, round: number, files: string[], command: boolean }[]} */
    const unheld = [];
    for (const r of rows) {
      const meta = parseJson(r.meta_json, null);
      if (meta?.treeUnheld) unheld.push({ ...meta.treeUnheld, turn: r.n });
      const t = meta?.tree;
      if (t?.snapshotRef) return { ...t, turn: r.n, ...(unheld.length ? { unheld } : {}) };
    }
    return null;
  }
  // One writing round of a turn in one place, for one agent (HarnessV4_Git_Plan step 1): what the turn changed is read
  // from these — the files its agents' own calls named, between the snapshots around their hands — never from a diff
  // of the whole folder, which counts everyone's edits and sees no other folder.
  /** @param {number} turnId @param {RoundChange} c */
  addRoundChange(turnId, { place, round = null, agent = "", before = null, after = null, base, own = [], command = false }) {
    const row = this.#q("SELECT chain_id FROM turns WHERE id = ?").get(turnId);
    if (!row) throw new Error(`Archive: no turn ${turnId}`);
    const seq = Number(this.#q("SELECT MAX(seq) AS m FROM round_changes WHERE turn_id = ?").get(turnId)?.m ?? 0) + 1;
    this.#q(
      "INSERT INTO round_changes (chain_id, turn_id, seq, place, round, agent, before_commit, after_commit, base, own_json, command, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(row.chain_id, turnId, seq, String(place), round == null ? null : Number(round), String(agent || ""), before ? String(before) : null, after ? String(after) : null, String(base), JSON.stringify([...own].map(String)), command ? 1 : 0, this.now());
    return seq;
  }
  // What an Apply wrote in a chat with no turn yet — a sub-agent launched before any message (found driving the Apply,
  // 10-29): the chat's own row, turn 0, which `roundChangesIn` reads by its place and no turn's rounds count.
  /** @param {string} chainId @param {RoundChange} c */
  addChainChange(chainId, { place, agent = "", own = [], base }) {
    if (!this.getChain(String(chainId))) throw new Error(`Archive: no chain ${chainId}`);
    const seq = Number(this.#q("SELECT MAX(seq) AS m FROM round_changes WHERE turn_id = 0").get()?.m ?? 0) + 1;
    this.#q(
      "INSERT INTO round_changes (chain_id, turn_id, seq, place, round, agent, before_commit, after_commit, base, own_json, command, at) VALUES (?, 0, ?, ?, NULL, ?, NULL, NULL, ?, ?, 0, ?)",
    ).run(String(chainId), seq, String(place), String(agent || ""), String(base), JSON.stringify([...own].map(String)), this.now());
    return seq;
  }
  // Rows `addRoundChange` wrote, taken back: a chat's move undone (HarnessV4_Git_Plan GW-D79) drops the rounds that
  // carried its files.
  /** @param {number} turnId @param {number[]} seqs */
  dropRoundChanges(turnId, seqs) {
    const del = this.#q("DELETE FROM round_changes WHERE turn_id = ? AND seq = ?");
    this.#tx(() => {
      for (const seq of seqs) del.run(turnId, Number(seq));
    });
  }
  /** @param {any} r @returns {RoundChange} */
  #roundChange(r) {
    return {
      place: r.place,
      round: r.round,
      agent: r.agent || "",
      before: r.before_commit || null,
      after: r.after_commit || null,
      base: r.base,
      own: parseJson(r.own_json, []),
      command: !!r.command,
      ...(r.n != null ? { turn: r.n } : {}),
    };
  }
  /**
   * A chain's writing rounds, in the order taken: turn `turn`'s, or every turn's where `turn` is null — a fork's own
   * turns only, the source's stay the source's.
   * @param {string} chainId @param {{ turn?: number | null }} [o] @returns {RoundChange[]}
   */
  roundChanges(chainId, { turn = null } = {}) {
    const one = turn != null;
    return this.#q(`SELECT c.*, t.n FROM round_changes c JOIN turns t ON t.id = c.turn_id WHERE c.chain_id = ?${one ? " AND t.n = ?" : ""} ORDER BY t.n, c.seq`)
      .all(String(chainId), ...(one ? [Number(turn)] : []))
      .map((r) => this.#roundChange(r));
  }
  /**
   * The writing rounds in one place since a moment, every chain's, the newest first (the Changes tab, 10-29): who wrote
   * which of its files, read by its index on (place, at).
   * @param {string} place @param {number} since
   * @returns {{ chain: string, agent: string, own: string[], at: number, command: boolean }[]}
   */
  roundChangesIn(place, since) {
    return this.#q("SELECT chain_id, agent, own_json, at, command FROM round_changes WHERE place = ? AND at >= ? ORDER BY at DESC LIMIT 5000")
      .all(String(place), Number(since))
      .map((r) => ({ chain: String(r.chain_id), agent: r.agent || "", own: parseJson(r.own_json, []), at: Number(r.at) || 0, command: !!r.command }));
  }
  /**
   * The newest snapshot a chain's turns left in a place: the next one's parent there.
   * @param {string} chainId @param {string} place @returns {string | null}
   */
  lastInPlace(chainId, place) {
    return this.#q("SELECT after_commit FROM round_changes WHERE chain_id = ? AND place = ? AND after_commit IS NOT NULL ORDER BY turn_id DESC, seq DESC LIMIT 1").get(String(chainId), String(place))?.after_commit || null;
  }
  // The composer's marks on a turn (HarnessV2 §4, §6.6): `settingsHash` (the document in force), `compacted` (the
  // shape a compaction left it in), `results` (per-result policy marks), `paused` (the parked question). One merge,
  // `undefined` deletes a key; `tree` keeps its own writer above.
  /** @param {number} turnId @param {Record<string, any>} patch */
  mergeTurnMeta(turnId, patch) {
    return this.#tx(() => {
      const row = this.#q("SELECT meta_json FROM turns WHERE id = ?").get(turnId);
      if (!row) throw new Error(`Archive: no turn ${turnId}`);
      const meta = parseJson(row.meta_json, null) || {};
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === undefined) delete meta[k];
        else meta[k] = v;
      }
      this.#q("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), turnId);
      return meta;
    });
  }
  /** A turn's meta, read light — no bodies — the facts fold's read (Facade D2). → the meta object, or null. */
  turnMeta(turnId) {
    const row = this.#q("SELECT meta_json FROM turns WHERE id = ?").get(turnId);
    return row ? parseJson(row.meta_json, null) || {} : null;
  }
  // ---- a turn's visuals (HarnessV4_Visuals_Plan VS-D9) ------------------------------------------------------------
  // A picture an agent drew in a turn, kept as it drew it: its code is a message of its own (content-addressed, sealed
  // like every other), and the turn's meta lists it — its id, title, who drew it, its round and size — so a page knows
  // a turn's visuals without opening a body. Kept as the call is made, so a running turn's are there too. One bigger
  // than a message the archive keeps whole is not kept at all: the caller says so to the agent.
  /**
   * @param {number} turnId
   * @param {VisualIn} v
   * @returns {{ ok: true, bytes: number, n: number } | { ok: false, bytes: number, cap: number }}  `n`: the turn's number in
   *   its session, which a page asks for the visual by
   */
  addTurnVisual(turnId, v) {
    const msg = visualMessage(v);
    const whole = Buffer.byteLength(JSON.stringify(msg));
    if (whole > this.caps.messageBytes) return { ok: false, bytes: whole, cap: this.caps.messageBytes };
    return this.#tx(() => {
      const row = this.#q("SELECT meta_json, n FROM turns WHERE id = ?").get(turnId);
      if (!row) throw new Error(`Archive: no turn ${turnId}`);
      const meta = parseJson(row.meta_json, null) || {};
      const listed = this.#listVisual(meta, msg, v);
      this.#q("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), turnId);
      return { ok: true, bytes: listed.bytes, n: Number(row.n) };
    });
  }
  /**
   * A picture a helper drew that no turn launched — one the developer asked, one that started by itself (VS-D48): kept
   * as a turn's is, listed on its session instead.
   * @param {string} chainId @param {VisualIn} v
   * @returns {{ ok: true, bytes: number } | { ok: false, bytes: number, cap: number }}
   */
  addChainVisual(chainId, v) {
    const msg = visualMessage(v);
    const whole = Buffer.byteLength(JSON.stringify(msg));
    if (whole > this.caps.messageBytes) return { ok: false, bytes: whole, cap: this.caps.messageBytes };
    return this.#tx(() => {
      const row = this.#q("SELECT meta_json FROM chains WHERE id = ?").get(String(chainId));
      if (!row) throw new Error(`Archive: no session ${chainId}`);
      const meta = parseJson(row.meta_json, null) || {};
      const listed = this.#listVisual(meta, msg, v);
      this.#q("UPDATE chains SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), String(chainId));
      return { ok: true, bytes: listed.bytes };
    });
  }
  /**
   * A visual's code kept as a message, and listed in `meta.visuals` in its place: one with the same id is replaced.
   * @param {any} meta @param {{ visual: { title: string, code: string, loading: string[] } }} msg @param {VisualIn} v
   */
  #listVisual(meta, msg, v) {
    const { hash } = this.putMessage("assistant", msg);
    const id = String(v.id);
    const bytes = Buffer.byteLength(msg.visual.code);
    const kept = (Array.isArray(meta.visuals) ? meta.visuals : []).filter((/** @type {any} */ x) => x?.id !== id);
    meta.visuals = [...kept, { id, title: msg.visual.title, hash, bytes, at: this.now(), ...(v.by ? { by: String(v.by) } : {}), ...(v.by && Number.isInteger(v.exchange) ? { exchange: Number(v.exchange) } : {}), ...(v.round != null ? { round: Number(v.round) } : {}), ...(v.madeIn ? { madeIn: String(v.madeIn) } : {}) }];
    return { bytes };
  }
  /**
   * One visual of a turn, whole — as the turn's meta lists it, with its code and its lines while it is drawn — or null
   * where the turn has none by that id.
   * @param {number} turnId @param {string} id
   * @returns {{ id: string, title: string, code: string, loading: string[], bytes: number, at: number, by?: string, round?: number } | null}
   */
  turnVisual(turnId, id) {
    return this.#visualIn(this.turnMeta(turnId)?.visuals, id);
  }
  /**
   * One visual a session keeps of its own (`addChainVisual`), whole, or null.
   * @param {string} chainId @param {string} id @returns {ReturnType<Archive["turnVisual"]>}
   */
  chainVisual(chainId, id) {
    return this.#visualIn(this.getChain(String(chainId))?.meta?.visuals, id);
  }
  /** @param {any} listed @param {string} id */
  #visualIn(listed, id) {
    const v = Array.isArray(listed) ? listed.find((x) => x?.id === String(id)) : null;
    const kept = v ? this.getMessage(v.hash)?.message?.visual : null;
    if (!v || !kept) return null;
    const { hash: _hash, ...facts } = v;
    return { ...facts, code: String(kept.code ?? ""), loading: Array.isArray(kept.loading) ? kept.loading : [] };
  }
  /** A `schema_meta` row's value, decoded. @param {string} key @returns {any} */
  schemaMetaGet(key) {
    const row = this.#q("SELECT value FROM schema_meta WHERE key = ?").get(String(key));
    return row ? parseJson(row.value, null) : null;
  }
  /** schemaMetaGet's writer — a JSON value under a key. @param {string} key @param {any} value */
  schemaMetaSet(key, value) {
    this.#q("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)").run(String(key), JSON.stringify(value));
  }
  // A chain's turns with their messages, oldest first — what the composer renders. Each entry carries the stored
  // bytes (`user`, `work[]`, `final`; `final` null while the turn is open) beside the row's marks. The bytes are
  // opened when they are first read (core/lazy.js), a turn at a time: listing a long session's turns opens none, and
  // a composition opens those its copy holds. `finished` is the row's own word that the turn has its final answer, so
  // nothing is opened to know it; `workCount` is how many messages its work has, known the same way.
  // `after`, `last` and `written` choose the turns in the query itself (`getTurns`). `open` opens their bodies at once, in
  // one read of the messages for all of them, where the caller reads every one: "ends" the person's message and the
  // final answer, "all" the work too; what it leaves stays lazy. Each content block of a message it opens carries its
  // name (`contentName`).
  /**
   * @param {string} chainId
   * @param {{ from?: number | null, to?: number | null, ns?: number[] | null, after?: number | null, last?: number | null, written?: number | null, open?: "ends" | "all" | null }} [o]
   */
  turnBodies(chainId, { from = null, to = null, ns = null, after = null, last = null, written = null, open = null } = {}) {
    // `ns` names the turns to decrypt by number: a turn of a long session (its work, a visual, a recall) is read
    // alone, never the whole session.
    const wanted = ns ? new Set(ns) : null;
    const rows = wanted
      ? wanted.size
        ? this.getTurns(chainId, { from: Math.min(...wanted), to: Math.max(...wanted) }).filter((t) => wanted.has(t.n))
        : []
      : this.getTurns(chainId, { from, to, after, last, written });
    /** @type {Map<string, string> | null} */
    const texts = open
      ? this.#messageTexts(rows.flatMap((t) => [t.user_hash, t.final_hash, ...(open === "all" ? t.work : [])]))
      : null;
    // Each reference parsed apart, as `getMessage` does: two turns that hold the same message hold two copies of it.
    const opened = (/** @type {Map<string, string>} */ m, /** @type {any} */ h) => {
      const s = h == null ? undefined : m.get(String(h));
      return s === undefined ? undefined : JSON.parse(s);
    };
    /** A message as opened, its content blocks named (`contentName`). @param {any} msg @param {any} h */
    const named = (msg, h) => {
      if (Array.isArray(msg?.content))
        msg.content.forEach((/** @type {any} */ b, /** @type {number} */ j) => {
          if (b && typeof b === "object") this.#contentNames.set(b, `${h}:${j}`);
        });
      return msg;
    };
    return rows.map((t) => {
      const body = {
        turnId: /** @type {number} */ (t.id),
        n: /** @type {number} */ (t.n),
        startedAt: t.started_at,
        endedAt: t.ended_at,
        requestIds: t.requestIds,
        summary: t.summary || null,
        // The model the turn was asked of, as its request named it: what a compaction by the model that answered last
        // runs as, after the person picked another (the owner's of 11-08).
        model: t.model ?? null,
        meta: /** @type {Record<string, any>} */ (t.meta || {}),
        finished: t.final_hash != null,
        workCount: /** @type {number} */ (t.work.length),
      };
      const userOf = () => named(texts ? opened(texts, t.user_hash) : this.getMessage(t.user_hash)?.message, t.user_hash) ?? null;
      const workOf = () => /** @type {any[]} */ (t.work.map((/** @type {string} */ h) => named(texts && open === "all" ? opened(texts, h) : this.getMessage(h)?.message, h)).filter(Boolean));
      const finalOf = () => (t.final_hash ? (named(texts ? opened(texts, t.final_hash) : this.getMessage(t.final_hash)?.message, t.final_hash) ?? null) : null);
      if (!texts) {
        const listed = lazy(lazy(lazy(body, "user", userOf), "work", workOf), "final", finalOf);
        // Its work from a message on, opened alone (`workFrom`); where none holds what was looked for, the work it opened
        // is the turn's, read once. A turn whose work is opened already answers from it, opening nothing. Not
        // enumerable: a copy of the turn — a spread, `lazyOver` — has none, and reads its work whole.
        const one = (/** @type {string} */ h) => named(this.getMessage(h)?.message, h);
        const unread = () => !!Object.getOwnPropertyDescriptor(listed, "work")?.get;
        const whole = (/** @type {any[]} */ work) => void (unread() && (listed.work = work));
        /** @param {string} key @param {(m: any) => boolean} holds */
        const workFrom = (key, holds) => {
          if (unread()) return this.#workFrom(t, key, holds, one, whole);
          const work = Array.isArray(listed.work) ? listed.work : [];
          const at = work.findIndex(holds);
          return at < 0 ? null : work.slice(at);
        };
        Object.defineProperty(listed, "workFrom", { value: workFrom, enumerable: false, configurable: true });
        return listed;
      }
      const user = userOf();
      if (open === "all") return { ...body, user, work: workOf(), final: finalOf() };
      return Object.assign(lazy(Object.assign(body, { user }), "work", workOf), { final: finalOf() });
    });
  }
  /**
   * The name of a content block of a message `turnBodies` opened: the message's hash and the block's place in it, the
   * same for every copy of it opened, and for no block of other words — a message's stored bytes never change once
   * kept (none is updated or deleted). What it weighs is kept by it across reads (tokens.js `createBlockWeights`).
   * Undefined for any other object.
   * @param {object} block @returns {string | undefined}
   */
  contentName(block) {
    return this.#contentNames.get(block);
  }
  /**
   * Many messages' stored text at once, opened (decrypted where the archive is), by hash: one query, where `getMessage`
   * reads one. Hashes the archive does not hold are absent; each is opened once however often it is named.
   * @param {readonly (string | null | undefined)[]} hashes @returns {Map<string, string>}
   */
  #messageTexts(hashes) {
    /** @type {Map<string, string>} */
    const out = new Map();
    const list = [...new Set(hashes.filter((h) => h != null).map(String))];
    if (!list.length) return out;
    for (const r of this.#q(`SELECT hash, body FROM messages WHERE hash ${IN_LIST}`).all(listParam(list))) out.set(String(r.hash), this.#open(r.body, r.hash));
    return out;
  }
  /**
   * A turn's work from the first of its messages `holds` is true of, opened — that message first, and those the archive
   * does not hold left out, as its work read whole has them —, or null where none is. The place is kept under the turn
   * and `key`, which names what `holds` looks for (`#places`): the first look opens the messages before it, as reading
   * the work whole does; a later one, while the turn's work up to it is the same messages, those from it on alone (the
   * owner's of 11-17: each read of a long chat's views opened the 3,616 messages of the turn its coding agent compacted
   * its own context in, to keep the 146 after the cut). A place behind a message the archive did not hold is not kept:
   * held later, that one might be the first. Where none holds it, every message was opened: `whole` is handed them.
   * @param {any} t  the turn's row @param {string} key @param {(m: any) => boolean} holds @param {(h: string) => any} one
   * @param {(work: any[]) => void} whole
   * @returns {any[] | null}
   */
  #workFrom(t, key, holds, one, whole) {
    const names = /** @type {string[]} */ (t.work);
    const id = `${t.id}\u0000${key}`;
    const upTo = (/** @type {number} */ at) => sha1(names.slice(0, at + 1).join("\n"));
    const kept = this.#places.get(id);
    if (kept) {
      this.#places.delete(id);
      const first = kept.at < names.length && upTo(kept.at) === kept.names ? one(names[kept.at]) : null;
      if (first && holds(first)) {
        this.#places.set(id, kept);
        return [first, ...names.slice(kept.at + 1).map(one).filter(Boolean)];
      }
    }
    /** @type {any[]} */
    const before = [];
    let held = true;
    for (let i = 0; i < names.length; i++) {
      const m = one(names[i]);
      if (!m) held = false;
      if (!m || !holds(m)) {
        if (m) before.push(m);
        continue;
      }
      if (held) {
        this.#places.set(id, { at: i, names: upTo(i) });
        if (this.#places.size > PLACES_KEPT) this.#places.delete(/** @type {string} */ (this.#places.keys().next().value));
      }
      return [m, ...names.slice(i + 1).map(one).filter(Boolean)];
    }
    whole(before);
    return null;
  }
  /** The newest turn without a final answer, or null. @param {string} chainId */
  openTurn(chainId) {
    const r = this.#q("SELECT * FROM turns WHERE chain_id = ? AND final_hash IS NULL ORDER BY n DESC LIMIT 1").get(chainId);
    return this.#turnRow(plain(r));
  }
  #turnRow(r) {
    return (
      r && {
        ...r,
        requestIds: parseJson(r.request_ids_json, []),
        work: parseJson(r.work_json, []),
        meta: parseJson(r.meta_json, null),
      }
    );
  }
  getTurn(turnId) {
    return this.#turnRow(plain(this.#q("SELECT * FROM turns WHERE id = ?").get(turnId)));
  }
  /**
   * The session's turn whose reply the message of `turnId` answers: the newest before it that the conversation carries
   * (`viewed`) — a turn Filament answered itself, or one rewound, is none (the bug report's L18) — or null.
   * @param {string} chainId @param {number} turnId
   */
  turnBefore(chainId, turnId) {
    const q = this.#q("SELECT * FROM turns WHERE chain_id = ? AND n < (SELECT n FROM turns WHERE id = ?) ORDER BY n DESC");
    for (const r of q.iterate(chainId, turnId)) {
      const t = this.#turnRow(plain(r));
      if (viewed(t)) return t;
    }
    return null;
  }
  /**
   * The session's turn whose message answers the reply of `turnId`: the oldest after it the conversation carries
   * (`viewed`), or null — `turnBefore` the other way (the memory plan's f4: what the person said to a reply they
   * corrected). @param {string} chainId @param {number} turnId
   */
  turnAfter(chainId, turnId) {
    const q = this.#q("SELECT * FROM turns WHERE chain_id = ? AND n > (SELECT n FROM turns WHERE id = ?) ORDER BY n");
    for (const r of q.iterate(chainId, turnId)) {
      const t = this.#turnRow(plain(r));
      if (viewed(t)) return t;
    }
    return null;
  }
  /**
   * How a session stands to memory's reads for another chat or call: its turns, how many of them were kept apart
   * (`beginTurn`'s `apart`), and whether such a turn named it (`meta.namedApart`).
   * @param {string} chainId @returns {{ turns: number, apart: number, namedApart: boolean }}
   */
  apartOf(chainId) {
    const r = this.#q(`SELECT COUNT(*) AS turns, SUM(CASE WHEN ${jsonAt("meta_json", "apart")} IS NULL THEN 0 ELSE 1 END) AS apart FROM turns WHERE chain_id = ?`).get(String(chainId));
    return { turns: Number(r?.turns) || 0, apart: Number(r?.apart) || 0, namedApart: !!this.metaOf(String(chainId), ["namedApart"])?.namedApart };
  }
  // Turns of a chain by number (inclusive bounds, both optional), oldest first; messages come via getMessage(hash).
  // `after`: only the turns numbered past it; `last`: only the newest that many of those — chosen by the query, so a
  // page that asks for one turn of a long chat reads one row. A `last` that is not a whole count of one or more
  // (below one, endless) is no bound; a fraction counts its whole part. `written`: only the turns begun or changed past
  // that write (`turnsWrittenAt` of a version `turnsVersion` gave).
  /** @param {string} chainId @param {{ from?: number | null, to?: number | null, after?: number | null, last?: number | null, written?: number | null }} [o] */
  getTurns(chainId, { from = null, to = null, after = null, last = null, written = null } = {}) {
    const bounds = "chain_id = ? AND (? IS NULL OR n >= ?) AND (? IS NULL OR n <= ?) AND (? IS NULL OR n > ?) AND (? IS NULL OR id IN (SELECT turn_id FROM temp.turn_writes WHERE seq > ?))";
    const args = [chainId, from, from, to, to, after, after, written, written];
    const rows = last != null && Number.isFinite(last) && last >= 1
      ? this.#q(`SELECT * FROM turns WHERE ${bounds} ORDER BY n DESC LIMIT ?`).all(...args, Math.floor(last)).reverse()
      : this.#q(`SELECT * FROM turns WHERE ${bounds} ORDER BY n`).all(...args);
    return rows.map((r) => this.#turnRow(plain(r)));
  }
  /**
   * Every turn of a chain in outline, oldest first: its id and number, when it started and ended, its newest request's
   * id (`request`, the last of `requestIds`), and the few marks a transcript reads across all of them — its settings
   * hash, what it carried (`carried`), the rewound line it is on, the window it belongs to (`turnWindow`'s rule) and
   * whether Filament answered it (`command`, truthy or not as `meta.command` reads) — taken out of each meta by SQLite,
   * so no message is opened and no meta parsed whole here, however long the chat. Each mark reads as `meta[key]` does;
   * absent, undefined. A turn with no request, or a request list that is no list, has no `request`.
   * @param {string} chainId
   * @returns {{ id: number, n: number, startedAt: any, endedAt: any, request: any, command: boolean, settingsHash: any, carried: any, rewoundLine: any, window: string }[]}
   */
  /**
   * A chain's turns as a quote of the person is looked for in them (the memory plan's d1): newest first, at most
   * `last`, each its id, number, start and opening message's hash — only a turn that is the person's to quote: not
   * answered by a command nor rewound (`viewed`), not kept apart (`apartTurn`), not begun by a coding agent (`meta.own`),
   * not opened by a thread's brief (`meta.brief`), nor begun by anyone but the person (`meta.by`, core/turn-by.js). A turn
   * from before turns were marked that Filament began holds no mark, and is passed over by none of these. Each mark is
   * taken out of the meta by SQLite and read as `meta[key]` reads, truthy or not: no meta parsed whole.
   * @param {string} chainId @param {{ last?: number }} [o]
   * @returns {{ id: number, n: number, startedAt: number, userHash: string }[]}
   */
  personTurns(chainId, { last = 500 } = {}) {
    const marks = ["command", "rewound", "apart", "own", "brief", "by"];
    const sql = `SELECT id, n, started_at, user_hash, ${marks.map((k) => `CASE WHEN json_valid(meta_json) THEN meta_json -> '$.${k}' END AS m_${k}`).join(", ")}
      FROM turns WHERE chain_id = ? AND user_hash IS NOT NULL ORDER BY n DESC LIMIT ?`;
    const on = (/** @type {any} */ v) => v != null && !!JSON.parse(String(v));
    return this.#q(sql)
      .all(String(chainId), Math.max(1, Math.floor(Number(last) || 1)))
      .filter((/** @type {any} */ r) => !marks.some((k) => on(r[`m_${k}`])))
      .map((/** @type {any} */ r) => ({ id: Number(r.id), n: Number(r.n), startedAt: Number(r.started_at) || 0, userHash: String(r.user_hash) }));
  }
  turnOutline(chainId) {
    const chain = this.#q("SELECT key FROM chains WHERE id = ?").get(chainId);
    // A composed stamp counts for the window where it is truthy (`turnWindow`): an object, an array or true always
    // is; a number or a string by its value.
    // A meta that does not parse is none (`parseJson`): every mark of it reads as absent.
    const sql = `SELECT id, n, started_at, ended_at,
        CASE WHEN json_valid(request_ids_json) AND json_type(request_ids_json) = 'array' THEN request_ids_json -> '$[#-1]' END AS request,
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.command') END AS command,
        CASE WHEN json_valid(meta_json) THEN meta_json -> '$.settingsHash' END AS settings_hash,
        CASE WHEN json_valid(meta_json) THEN meta_json -> '$.carried' END AS carried,
        CASE WHEN json_valid(meta_json) THEN meta_json -> '$.rewound.line' END AS rewound_line,
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.client') END AS client,
        CASE WHEN json_valid(meta_json) THEN json_type(meta_json, '$.composed') END AS composed_type,
        CASE WHEN json_valid(meta_json) AND json_type(meta_json, '$.composed') IN ('integer', 'real', 'text') THEN json_extract(meta_json, '$.composed') END AS composed_value
      FROM turns WHERE chain_id = ? ORDER BY n`;
    const val = (/** @type {any} */ v) => (v == null ? undefined : JSON.parse(String(v)));
    return this.#q(sql).all(chainId).map((r) => {
      const composed = r.composed_type === "object" || r.composed_type === "array" || r.composed_type === "true" || !!r.composed_value;
      return {
        id: /** @type {number} */ (r.id),
        n: /** @type {number} */ (r.n),
        startedAt: r.started_at,
        endedAt: r.ended_at,
        request: val(r.request),
        command: !!r.command,
        settingsHash: val(r.settings_hash),
        carried: val(r.carried),
        rewoundLine: val(r.rewound_line),
        window: Archive.turnWindow({ meta: { client: r.client, composed } }, chain ? { key: /** @type {string} */ (chain.key) } : null),
      };
    });
  }
  /**
   * Every turn of a chain as lining a window's history up with the archive reads it (memory `alignHistory`), oldest
   * first: its number, whether it has its final answer, whether Filament answered it (`command`) and whether it is on a
   * rewound line — each as its `meta[key]` reads, truthy or not — its pin (`pinOfTurn`) and the window it belongs to: its
   * own stamp, else `turnWindow`'s rule. Taken out of each meta by SQLite, as `turnOutline`'s marks are: no message is
   * opened and no meta parsed whole, however long the chat — the lining up runs on each of its turns.
   * @param {string} chainId
   * @returns {{ n: number, finished: boolean, command: boolean, rewound: boolean, pin: string, window: any }[]}
   */
  turnMarks(chainId) {
    const chain = this.#q("SELECT key FROM chains WHERE id = ?").get(chainId);
    // A value as SQLite gives it out reads as truthy exactly where the JSON value does (an object or an array as its
    // text, true as 1, false as 0, null as NULL); a stamp is read as JSON, so a window's null falls to the rule.
    const sql = `SELECT n, final_hash,
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.command') END AS command,
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.rewound') END AS rewound,
        CASE WHEN json_valid(meta_json) THEN meta_json -> '$.key' END AS pin_key,
        CASE WHEN json_valid(meta_json) THEN meta_json -> '$.window' END AS window,
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.client') END AS client,
        CASE WHEN json_valid(meta_json) THEN json_type(meta_json, '$.composed') END AS composed_type,
        CASE WHEN json_valid(meta_json) AND json_type(meta_json, '$.composed') IN ('integer', 'real', 'text') THEN json_extract(meta_json, '$.composed') END AS composed_value
      FROM turns WHERE chain_id = ? ORDER BY n`;
    const val = (/** @type {any} */ v) => (v == null ? undefined : JSON.parse(String(v)));
    return this.#q(sql).all(chainId).map((r) => {
      const composed = r.composed_type === "object" || r.composed_type === "array" || r.composed_type === "true" || !!r.composed_value;
      return {
        n: /** @type {number} */ (r.n),
        finished: !!r.final_hash,
        command: !!r.command,
        rewound: !!r.rewound,
        pin: this.pinOfTurn({ meta: { key: val(r.pin_key) } }),
        window: val(r.window) ?? Archive.turnWindow({ meta: { client: r.client, composed } }, chain ? { key: /** @type {string} */ (chain.key) } : null),
      };
    });
  }
  /**
   * How many rows have been written through this archive since it opened (SQLite's `total_changes`): it moves with
   * every write, so a reader can tell that nothing was written between two moments.
   */
  writes() {
    return Number(this.#q("SELECT total_changes() AS n").get()?.n) || 0;
  }
  /**
   * Where the archive's turns stand, as a version: this opening's mark and the number of the newest turn write through
   * it (`TURN_WRITES`). A chain read at one version is read again as the turns begun or changed past it (`getTurns`'
   * `written`, `turnsWrittenAt`), and only those: no other turn is read, and no message of one is opened.
   * @returns {string}
   */
  turnsVersion() {
    return `${this.#turnsMark}.${Number(this.#q("SELECT MAX(seq) AS n FROM temp.turn_writes").get()?.n) || 0}`;
  }
  /**
   * The write a version `turnsVersion` gave stands at, for `getTurns`' `written`; null for any other — another
   * opening's, before a restart, or none —, whose reader reads the turns whole.
   * @param {unknown} version @returns {number | null}
   */
  turnsWrittenAt(version) {
    const m = /^([0-9a-f]+)\.(\d+)$/.exec(String(version ?? ""));
    return m && m[1] === this.#turnsMark ? Number(m[2]) : null;
  }
  /**
   * When a turn of the chain last started, as its newest row says it: that turn's first start, or that of a request that
   * went on in it since (`meta.lastStart`, a failed try's retry, which goes on in the newest open row) — or 0 before its
   * first. One row is read, by the chain's index: the rows behind it started before it. @param {string} chainId
   */
  lastStartedAt(chainId) {
    const again = "CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.lastStart') END";
    return Math.max(0, Number(this.#q(`SELECT MAX(started_at, COALESCE(${again}, 0)) AS t FROM turns WHERE chain_id = ? ORDER BY n DESC LIMIT 1`).get(chainId)?.t) || 0);
  }

  // ---- compactions and links -------------------------------------------------------------------------------------
  /**
   * A summary standing in for turns fromTurn..toTurn (turn numbers); the text is stored like any message (encrypted).
   * `window` says who compacted (D4): `harness`, or the compacting window's conversation key; null when unknown.
   * `method` says how (summary, fold, or own: a coding agent's own compaction): every row names one. A row with
   * `summaryText: null` carries no summary at all (a fold compaction): it lists in the history but never stands for its
   * turns — the composer takes a head only from rows with text.
   * `detail` is what the compaction did, in figures (before → after, who wrote it), for the words that report it.
   * `attached` is what came back after a summary (HarnessV3-AtHome AH-D9 b: files read again, the plan, the task
   * graph): its text is stored like the summary, as its own message, and the detail names it (`attached.hash`) with
   * what it holds.
   * @param {string} chainId
   * @param {{ fromTurn?: number | null, toTurn?: number | null, summaryText: string | null, kind?: string, window?: string | null, method: string, detail?: any,
   *   attached?: { text: string, files: readonly { shown: boolean }[], plan: boolean, graph?: boolean, tokens: number } | null }} o
   * @returns {{ id: number, hash: string | null }}
   */
  addCompaction(chainId, { fromTurn, toTurn, summaryText, kind = "compaction", window = null, method, detail = null, attached = null }) {
    if (!method) throw new Error("a compaction row names its method (summary, fold or own)");
    return this.#tx(() => {
      const m = summaryText === null ? null : this.putMessage("system", { role: "system", content: String(summaryText ?? "") });
      const back = attached?.text ? this.putMessage("system", { role: "system", content: String(attached.text) }) : null;
      const files = Array.isArray(attached?.files) ? attached.files : [];
      const said = back
        ? { ...(detail || {}), attached: { hash: back.hash, shown: files.filter((f) => f.shown).length, named: files.filter((f) => !f.shown).length, plan: !!attached.plan, ...(attached.graph ? { graph: true } : {}), tokens: Number(attached.tokens) || 0 } }
        : detail;
      const id = this.#nextCompactionId();
      this.#q(
        "INSERT INTO compactions (id, chain_id, from_turn, to_turn, summary_hash, kind, window, created_at, method, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, chainId, fromTurn ?? null, toTurn ?? null, m?.hash ?? null, kind, window ? String(window) : null, this.now(), String(method), said ? JSON.stringify(said) : null);
      return { id, hash: m?.hash ?? null };
    });
  }
  /**
   * The next compaction row's id: past every id given before, an undone row's too. A coding agent's session is kept on
   * the compaction it stands on by its id (HarnessV3-ACP AC5-1), so an id given again would put a chat back on the
   * session an undo let go. The newest id given is kept in `schema_meta` (SQLite gives a deleted row's id again).
   */
  #nextCompactionId() {
    const top = Number(this.#q("SELECT MAX(id) AS id FROM compactions").get()?.id) || 0;
    const id = Math.max(top, Number(this.schemaMetaGet("compactionIdGiven")) || 0) + 1;
    this.schemaMetaSet("compactionIdGiven", id);
    return id;
  }
  /**
   * A compaction that reshapes turns instead of summarizing them (fold): its row — no summary text — and each
   * turn's mark (`meta.compacted`, the shape the turn renders at from now on), in one transaction.
   * @param {string} chainId
   * @param {{ turnIds: number[], shape: string, kind: string, method: string, fromTurn: number, toTurn: number, window?: string | null, detail?: any }} o
   * @returns {{ id: number, marked: number }}
   */
  compactTurns(chainId, { turnIds, shape, kind, method, fromTurn, toTurn, window = null, detail = null }) {
    return this.#tx(() => {
      const { id } = this.addCompaction(chainId, { fromTurn, toTurn, summaryText: null, kind, window, method, detail });
      const at = this.now();
      let marked = 0;
      for (const turnId of turnIds) {
        this.mergeTurnMeta(turnId, { compacted: { shape: String(shape), id, at } });
        marked++;
      }
      return { id, marked };
    });
  }
  /**
   * The id of a chain's newest compaction, 0 for none: the head memory pins the goal its system prompt carries to (brain.js
   * `goalPinned`). Ids only grow, so one undone, or a new one made, moves it. `window`: of the compactions of that window
   * of the chain, and those that name none — another window's conversation goes on as it was.
   * @param {string} chainId @param {string | null} [window] @returns {number}
   */
  newestCompactionId(chainId, window = null) {
    const row = window
      ? this.#q("SELECT MAX(id) AS id FROM compactions WHERE chain_id = ? AND (window IS NULL OR window = ?)").get(String(chainId), String(window))
      : this.#q("SELECT MAX(id) AS id FROM compactions WHERE chain_id = ?").get(String(chainId));
    return Number(row?.id) || 0;
  }
  getCompactions(chainId) {
    return this.#q("SELECT * FROM compactions WHERE chain_id = ? ORDER BY id")
      .all(chainId)
      .map((row) => {
        const { detail_json: d, ...rest } = plain(row);
        return { ...rest, detail: parseJson(d, null) };
      });
  }
  /**
   * Figures of a compaction known only after its row was written (HarnessV4_Tasks U3-11: what its calls cost, once
   * their records finished), merged over the detail the row kept. False when the row is gone (undone meanwhile).
   * @param {number} id @param {Record<string, any>} figures
   */
  mergeCompactionDetail(id, figures) {
    return this.#tx(() => {
      const row = this.#q("SELECT detail_json FROM compactions WHERE id = ?").get(Number(id));
      if (!row) return false;
      this.#q("UPDATE compactions SET detail_json = ? WHERE id = ?").run(JSON.stringify({ ...(parseJson(row.detail_json, null) || {}), ...figures }), Number(id));
      return true;
    });
  }
  /**
   * Undo a compaction: its row goes, and with a fold compaction the marks that name it — its turns go whole again, and
   * a summary's turns come back from under it. A summary's text stays in the message
   * store (content-addressed; nothing reads it once its row is gone). One transaction. The row
   * removed, with how many turns lost their mark, or null when the chain has no such row.
   * @param {string} chainId @param {number} id
   */
  undoCompaction(chainId, id) {
    return this.#tx(() => {
      const row = this.#q("SELECT * FROM compactions WHERE chain_id = ? AND id = ?").get(chainId, Number(id));
      if (!row) return null;
      this.#q("DELETE FROM compactions WHERE id = ?").run(Number(id));
      let unmarked = 0;
      for (const t of this.#q("SELECT id, meta_json FROM turns WHERE chain_id = ?").all(chainId)) {
        const m = parseJson(t.meta_json, null);
        if (Number(m?.compacted?.id) !== Number(id)) continue;
        delete m.compacted;
        this.#q("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(m), t.id);
        unmarked++;
      }
      const { detail_json: d, ...rest } = plain(row);
      return { ...rest, detail: parseJson(d, null), unmarked };
    });
  }
  // Compactions with their summary text decrypted and capped, for the session detail page.
  compactionsWithText(chainId) {
    return this.getCompactions(chainId).map((c) => {
      const m = c.summary_hash ? this.getMessage(c.summary_hash) : null;
      return { ...c, text: m ? cap(textOfMessage(m.message), 2000) : null };
    });
  }

  // ---- slice summaries (content-addressed, global) ----------------------------------------------------------------
  // A slice summary is keyed by the hash of the exact text that produced it, so a second summary of the same session
  // (or of any session containing the same excerpt) never pays for it twice, and a restart finds the work already done. The
  // rows are deliberately NOT chained to a session: the same 40 turns summarized twice are the same summary. Deleting
  // a session therefore keeps them; they are bounded by TRIM_SLICE_CAP instead (oldest evicted on write).
  trimSlice(hash) {
    const r = this.#q("SELECT * FROM trim_slices WHERE hash = ?").get(String(hash));
    if (!r) return null;
    const m = r.summary_hash ? this.getMessage(r.summary_hash) : null;
    return m
      ? {
          hash: r.hash,
          summary: textOfMessage(m.message),
          tokens: r.tokens || 0,
          chars: r.chars || 0,
          model: r.model || null,
          createdAt: r.created_at,
        }
      : null;
  }
  trimSlicePut(hash, { summaryText, tokens = null, model = null }) {
    if (!hash || !summaryText) return null;
    return this.#tx(() => {
      const h = String(hash);
      // First write wins. The key is the hash of the exact text that produced the summary, so a second write is the
      // same work repeated: skipping it keeps a second summary byte-identical and avoids re-encrypting
      // a body for no reason.
      const have = this.#q("SELECT tokens FROM trim_slices WHERE hash = ?").get(h);
      if (have) return { hash: h, tokens: have.tokens || 0, cached: true };
      const text = String(summaryText);
      const m = this.putMessage("system", { role: "system", content: text });
      this.#q(
        "INSERT OR IGNORE INTO trim_slices (hash, summary_hash, tokens, chars, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        h,
        m.hash,
        Number.isFinite(tokens) ? tokens | 0 : estTokens(text.length),
        text.length,
        model ? String(model).slice(0, 120) : null,
        this.now(),
      );
      const n = Number(this.#q("SELECT COUNT(*) AS n FROM trim_slices").get().n || 0);
      if (n > TRIM_SLICE_CAP)
        this.#q(
          "DELETE FROM trim_slices WHERE hash IN (SELECT hash FROM trim_slices ORDER BY created_at LIMIT ?)",
        ).run(n - TRIM_SLICE_CAP);
      return { hash: h, tokens: estTokens(text.length), cached: false };
    });
  }
  // Every project with its aggregate counts and its dossier's version (HarnessV3-Memory M4-7; null before the curator
  // wrote one), for the Projects page and the harness's tree. `archived` is the display flag the harness's project menu
  // sets (kept under settings_json.display, beside the project's settings layer).
  projects() {
    return this.#q(
      `SELECT p.id, p.cwd, p.name, p.first_seen, p.last_seen, p.settings_json,
        (SELECT COUNT(*) FROM chains c WHERE c.project_id = p.id) AS chains,
        (SELECT COALESCE(SUM(c.turns), 0) FROM chains c WHERE c.project_id = p.id) AS turns,
        (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status NOT IN ('dismissed', 'superseded')) AS items,
        (SELECT MAX(d.version) FROM dossiers d WHERE d.project_id = p.id AND d.undone_at IS NULL) AS dossier
      FROM projects p ORDER BY p.last_seen DESC`,
    )
      .all()
      .map(plain)
      .map((r) => {
        const settings = parseJson(r.settings_json, null) || {};
        const { settings_json, ...rest } = r;
        return { ...rest, archived: !!settings.display?.archived };
      });
  }
  /**
   * A project row for a folder under the one id rule — created on first sight, touched after. The caller validates
   * the folder (the archive does not look at the disk); `name` defaults to the folder's last segment.
   * @param {string} cwd @param {{ name?: string | null }} [o]
   */
  ensureProject(cwd, { name = null } = {}) {
    const c = String(cwd || "").trim().replace(/[\\/]+$/, "");
    if (!c) throw new Error("Archive: a folder is required to name a project");
    return this.#tx(() => {
      const t = this.now();
      const id = projectIdOf(c);
      this.#q(
        "INSERT INTO projects (id, cwd, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, cwd = COALESCE(projects.cwd, excluded.cwd), name = COALESCE(projects.name, excluded.name)",
      ).run(id, c, name || projectNameOf(c) || c, t, t);
      return this.getProject(id);
    });
  }
  /**
   * A project's name changed (HarnessV4_SpacesPlugins_Plan A1: a Space of your own renamed): every list that names the
   * project says its new name. → whether there was such a project.
   * @param {string} projectId @param {string} name
   */
  setProjectName(projectId, name) {
    const n = String(name || "").trim();
    if (!n) return false;
    return this.#tx(() => this.#q("UPDATE projects SET name = ? WHERE id = ?").run(n, String(projectId)).changes > 0);
  }
  /** The project's display flag: an archived project leaves the harness's tree but keeps everything. @param {string} projectId @param {boolean} on */
  setProjectArchived(projectId, on) {
    return this.#tx(() => {
      const row = this.#q("SELECT settings_json FROM projects WHERE id = ?").get(String(projectId));
      if (!row) return false;
      const s = parseJson(row.settings_json, null) || {};
      const display = { ...(s.display || {}) };
      if (on) display.archived = true;
      else delete display.archived;
      if (Object.keys(display).length) s.display = display;
      else delete s.display;
      this.#q("UPDATE projects SET settings_json = ? WHERE id = ?").run(
        Object.keys(s).length ? JSON.stringify(s) : null,
        String(projectId),
      );
      return true;
    });
  }
  /**
   * Whether a project is archived (`setProjectArchived`), by its id: its flag alone, taken out of the stored settings
   * by SQLite — one row by its key, nothing parsed. What its Space asks before anything of it runs by itself
   * (r-itself, 11-12). @param {string} projectId
   */
  projectArchived(projectId) {
    return !!this.#q(`SELECT ${jsonAt("settings_json", "display.archived")} AS archived FROM projects WHERE id = ?`).get(String(projectId))?.archived;
  }
  /**
   * The same, of a chain's project: what the rule for the turns Filament starts by itself asks at each one
   * (sessions/service.js `notByItself`), without the chain's meta or its project's settings read whole. False for a
   * chain of no project, and where there is no such chain. @param {string} chainId
   */
  projectArchivedOf(chainId) {
    return !!this.#q(`SELECT ${jsonAt("p.settings_json", "display.archived")} AS archived FROM chains c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`).get(String(chainId))?.archived;
  }
  // Chains whose parent is this one: the sessions that continued it (compactions, continuation links).
  chainsChildren(chainId, { limit = 60 } = {}) {
    return this.#q("SELECT * FROM chains WHERE parent_id = ? ORDER BY started_at LIMIT ?")
      .all(chainId, limit)
      .map((c) => this.#chainRow(plain(c)));
  }
  // One turn opened up: the user message, the work in order, the final answer, each as a capped preview
  // plus its kind (no full bodies; the Rendered full view already shows raw JSON when needed).
  turnDetail(turnId) {
    const t = this.getTurn(turnId);
    if (!t) return null;
    const load = (hash) => {
      if (!hash) return null;
      const m = this.getMessage(hash);
      return m
        ? { kind: m.kind, bytes: m.bytes, truncated: !!m.truncated, preview: previewOf(m.message) }
        : null;
    };
    return {
      n: t.n,
      chainId: t.chain_id,
      startedAt: t.started_at,
      endedAt: t.ended_at,
      summary: t.summary || null,
      user: load(t.user_hash),
      final: load(t.final_hash),
      workCount: (t.work || []).length,
      work: (t.work || []).map((h) => load(h)).filter(Boolean),
    };
  }
  // Typed edge between any two ids (chains, turns as "turn:<id>", items, memory ids …); repeating it updates the weight.
  link(src, dst, type, weight = 1) {
    this.#q(
      "INSERT INTO links (src, dst, type, weight, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(src, dst, type) DO UPDATE SET weight = excluded.weight",
    ).run(src, dst, type, weight, this.now());
    return { src, dst, type, weight };
  }
  linksFor(id) {
    return this.#q("SELECT * FROM links WHERE src = ? OR dst = ? ORDER BY weight DESC, created_at")
      .all(id, id)
      .map(plain);
  }
  /**
   * The chats of teams that run beside this one (team_v2_plan §5.3): their `beside` links to it, the newest first.
   * @param {string} mainId @returns {string[]}
   */
  besideOf(mainId) {
    return this.#q("SELECT src FROM links WHERE dst = ? AND type = 'beside' ORDER BY created_at DESC, rowid DESC")
      .all(String(mainId))
      .map((r) => String(r.src));
  }
  /**
   * A chat's threads (core/threads.js): the chat whose agent started it (`from`, null for none), and the threads its
   * own agent started, the newest first.
   * @param {string} id @returns {{ from: string | null, started: string[] }}
   */
  threadsOf(id) {
    const from = this.#q("SELECT dst FROM links WHERE src = ? AND type = 'thread' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(String(id));
    const started = this.#q("SELECT src FROM links WHERE dst = ? AND type = 'thread' ORDER BY created_at DESC, rowid DESC").all(String(id));
    return { from: from ? String(from.dst) : null, started: started.map((r) => String(r.src)) };
  }
  /**
   * The chat each of these is a thread of (core/threads.js), by the thread's id, in one read: the sessions list's rows,
   * which the sidebar draws under their starters. One that is no thread is not in it.
   * @param {string[]} ids @returns {Map<string, string>}
   */
  threadStarters(ids) {
    const m = new Map();
    const list = (ids || []).filter(Boolean).map(String);
    if (!list.length) return m;
    for (const r of this.#q(`SELECT src, dst FROM links WHERE type = 'thread' AND src ${IN_LIST} ORDER BY created_at, rowid`).all(listParam(list)))
      m.set(String(r.src), String(r.dst));
    return m;
  }
  /** The chat a team's chat runs beside, or null. @param {string} teamId @returns {string | null} */
  mainOf(teamId) {
    const r = this.#q("SELECT dst FROM links WHERE src = ? AND type = 'beside' LIMIT 1").get(String(teamId));
    return r ? String(r.dst) : null;
  }

  // ---- search ----------------------------------------------------------------------------------------------------
  // FTS5 over user inputs and final answers, best bm25 first (score = -bm25, higher is better). A query without a
  // single letter or digit (or one FTS5 still refuses) falls back to a case-insensitive substring scan, newest first.
  // `notChainId` excludes a chain IN SQL rather than in the caller: the autopilot always excludes the session it is
  // serving, and filtering afterwards meant fetching `limit` rows, building a snippet for each, and throwing all of
  // them away whenever the current session dominated the index — the common case early in a project's life.
  // `kinds` keeps the chains of those kinds only (recall quotes a person's sessions, never Filament's own, M7-3).
  // `apartToo` false leaves out the turns kept apart (`beginTurn`'s `apart`), and the title of a chat such a turn named
  // (`meta.namedApart`): memory's reads for another chat or call. The person's own search reads them.
  // `role` says whose words a row holds: "user" the person's, "assistant" an answer's — and "agents" the words that open
  // a turn of another machine's agents' chat (`agentsChat`), theirs, never the person's (the remote-agents plan's fc-word).
  // → [{ chainId, turnId, n, role, snippet, at, projectId, title, hash, score }]
  searchInputs(query, { project = null, limit = 20, notChainId = null, distinct = false, kinds = null, apartToo = true } = {}) {
    const q = String(query ?? "").trim();
    if (!q) return [];
    const title = apartToo ? "c.title" : `CASE WHEN ${jsonAt("c.meta_json", "namedApart")} IS NULL THEN c.title END`;
    const cols =
      `fts_text.chain_id AS chainId, fts_text.turn_id AS turnId, fts_text.role AS role, t.n AS n, t.started_at AS at, c.project_id AS projectId, ${title} AS title, CASE fts_text.role WHEN 'user' THEN t.user_hash ELSE t.final_hash END AS hash, t.meta_json`;
    const joins =
      "FROM fts_text JOIN turns t ON t.id = fts_text.turn_id JOIN chains c ON c.id = fts_text.chain_id";
    const narrow = `${notChainId ? " AND fts_text.chain_id != ?" : ""}${kinds ? ` AND COALESCE(c.kind, 'interactive') IN (${kinds.map(() => "?").join(",")})` : ""}${apartToo ? "" : ` AND ${jsonAt("t.meta_json", "apart")} IS NULL`}`;
    const tail = [...(notChainId ? [notChainId] : []), ...(kinds || [])];
    const expr = ftsExpression(q);
    let rows = null;
    if (expr)
      try {
        rows = this.#q(
          `SELECT ${cols}, snippet(fts_text, 3, '[', ']', '…', 12) AS snippet, -bm25(fts_text) AS score ${joins} WHERE fts_text MATCH ?${narrow} AND (? IS NULL OR c.project_id = ?) ORDER BY bm25(fts_text) LIMIT ?`,
        ).all(expr, ...tail, project, project, limit);
      } catch {
        rows = null;
      }
    /** A row the substring scan found, its snippet around `needle`. @param {any} row @param {string} needle */
    const around = ({ text, ...r }, needle) => {
      const i = text.toLowerCase().indexOf(needle.toLowerCase());
      const s = Math.max(0, i - 60),
        e = i + needle.length + 60;
      return {
        ...r,
        snippet: (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : ""),
        score: 0,
      };
    };
    if (!rows)
      rows = this.#q(
        `SELECT ${cols}, fts_text.text AS text ${joins} WHERE instr(lower(fts_text.text), lower(?)) > 0${narrow} AND (? IS NULL OR c.project_id = ?) ORDER BY t.started_at DESC LIMIT ?`,
      )
        .all(q, ...tail, project, project, limit)
        .map((r) => around(r, q));
    // A script written without spaces (the memory plan's c1): fts_text reads a run of it as one word, so its runs are
    // searched in the trigram index by their trigrams — a run of two, which no trigram holds, by its letters — and the
    // better-scored row of a turn's text stands.
    const grams = trigramsOf(q);
    const short = grams.length ? [] : shortUnspaced(q);
    if (grams.length || short.length) {
      const tri = (/** @type {string} */ s) => s.replaceAll("fts_text", "fts_tri");
      /** @type {any[]} */
      let more = [];
      try {
        more = grams.length
          ? this.#q(
              `SELECT ${tri(cols)}, snippet(fts_tri, 3, '[', ']', '…', 12) AS snippet, -bm25(fts_tri) AS score ${tri(joins)} WHERE fts_tri MATCH ?${tri(narrow)} AND (? IS NULL OR c.project_id = ?) ORDER BY bm25(fts_tri) LIMIT ?`,
            ).all(grams.map((g) => `"${g.replace(/"/g, '""')}"`).join(" OR "), ...tail, project, project, limit)
          : this.#q(
              `SELECT ${tri(cols)}, fts_tri.text AS text ${tri(joins)} WHERE (${short.map(() => "instr(lower(fts_tri.text), ?) > 0").join(" OR ")})${tri(narrow)} AND (? IS NULL OR c.project_id = ?) ORDER BY t.started_at DESC LIMIT ?`,
            )
              .all(...short, ...tail, project, project, limit)
              .map((r) => around(r, short.find((w) => String(r.text).toLowerCase().includes(w)) || short[0]));
      } catch {
        more = [];
      }
      if (more.length) {
        /** @type {Map<string, any>} */
        const best = new Map();
        for (const r of [...rows, ...more]) {
          const k = `${r.chainId}:${r.turnId}:${r.role}`;
          if (!best.has(k) || Number(r.score) > Number(best.get(k).score)) best.set(k, r);
        }
        rows = [...best.values()].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, limit);
      }
    }
    // `distinct`: the same message under two chains (a fork and its source share every kept turn) is one hit, the
    // best-ranked row standing for the text — what recall wants, so it never injects a turn twice. The Sessions search
    // leaves it off: there, both sessions containing the text are the answer.
    // A rewound line's hits say so (D11): search still finds them; the label is what the reader sees. Whose chat each is
    // is read once a chat, for the chats the hits are in.
    /** @type {Map<string, boolean>} */
    const theirs = new Map();
    const agents = (/** @type {string} */ id) => {
      if (!theirs.has(id)) theirs.set(id, this.agentsChat(id));
      return theirs.get(id);
    };
    const labelled = rows.map((r) => {
      const meta = parseJson(r.meta_json, null) || {};
      const row = { ...r };
      delete row.meta_json;
      return { ...row, ...(row.role === "user" && agents(String(row.chainId)) ? { role: "agents" } : {}), ...(meta.rewound ? { rewound: true } : {}) };
    });
    if (!distinct) return labelled.map(plain);
    const seen = new Set();
    return labelled.map(plain).filter((r) => {
      const k = r.hash ? `${r.role}:${r.hash}` : `t:${r.turnId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ---- views -----------------------------------------------------------------------------------------------------
  // Past material within a token budget (chars ÷ 4), oldest turns dropped first, the newest turn always kept:
  //   full    → { messages } the raw user, work and final messages of the kept turns, in order
  //   chat    → { text } "### Turn n (time)" / "User: …" (capped at inputChars) / "Assistant: <final text>"
  //   summary → like chat, the assistant part being turns.summary and the answer's end, else the answer's head and end
  //             (`gistOf`), with the work count; an own turn's opener and Filament's notices by their first lines
  //   compact → the newest compaction summary, then the chat view of the turns after it (plain chat when there is none)
  // Every result carries turns (kept), total (in range), dropped, from/to (turn numbers) and tokens.
  //   page    → { text } what the page told the person (its notes, errors, status lines), oldest first: `#pageView`
  // `apartToo` false renders the session for another chat or call: the turns kept apart (`beginTurn`'s `apart`) stay out,
  // and so do a summary written over any of them, what the page said in a session that has them, and the title such a
  // turn named (`meta.namedApart`). The chat's own reads — its agent's seed, the person's views — render them all.
  // `words` (memory's `wordsOfMessage`) tells the summary view's user line the person's words from Filament's notices.
  // `newestFirst` lays the chat and summary views' turns out newest first, as recall's list does (the owner's of 11-08:
  // the older a turn, the less it bears on where the session stands).
  // `standIn` gives the chat and summary views a turn's line in place of its own words, where the caller has one for it
  // (recall's list: a turn the model's provider refused, whose words sent again are refused again — the hunt of 11-08).
  render(chainId, { view = "chat", budgetTokens = 4000, fromTurn = null, toTurn = null, apartToo = true, words = null, newestFirst = false, standIn = null } = {}) {
    const chain = this.getChain(chainId);
    if (!chain) return null;
    /** The numbers of the session's turns kept apart, where they stay out; null where the render reads them. */
    const apartNs = apartToo ? null : new Set(this.getTurns(chainId).filter(apartTurn).map((t) => t.n));
    const named = apartNs && chain.meta?.namedApart ? { ...chain, title: null } : chain;
    if (view === "page") {
      if (apartNs?.size)
        return { view: "page", chainId: chain.id, title: named.title, total: 0, lines: 0, dropped: 0, tokens: 0, text: "(what the page said is not shown: some of this session's turns are kept apart from memory)" };
      return this.#pageView(named, budgetTokens);
    }
    let mode = view,
      from = fromTurn,
      head = null;
    if (view === "compact") {
      mode = "chat";
      // The head the session composer sends (`compactionHead` over the rows it reads, app/sessions): the summary that
      // reaches the furthest turn, the newest of two that reach the same. A fold compaction carries none,
      // and a preview no window adopted (door `now`) is no compaction (the bug report's L17). The summary a coding agent wrote
      // in the middle of a turn (`detail.during`) stands for that turn's start too: the turn follows it whole here.
      const during = (/** @type {any} */ c) => (Number(c.detail?.during) > 0 ? Number(c.detail.during) : 0);
      /** Whether a summary was written over a turn kept apart, where those stay out. @param {any} c */
      const overApart = (c) => !!apartNs && [...apartNs].some((n) => n <= Math.max(Number(c.to_turn) || 0, during(c)));
      const comp =
        this.getCompactions(chainId)
          .filter((c) => c.detail?.door !== "now" && c.summary_hash && (Number(c.to_turn) > 0 || during(c)) && !overApart(c))
          .map((c) => ({ c, m: this.getMessage(c.summary_hash) }))
          .filter((x) => x.m)
          .sort((x, y) => Number(y.c.to_turn) - Number(x.c.to_turn) || Number(y.c.id) - Number(x.c.id))[0] || null;
      if (comp) {
        const whole = Number(comp.c.to_turn) > 0 ? `turns ${comp.c.from_turn}-${comp.c.to_turn}` : "";
        const part = during(comp.c) ? `the start of turn ${during(comp.c)}` : "";
        head = `### Summary of ${[whole, part].filter(Boolean).join(" and ")}\n${textOfMessage(comp.m.message)}`;
        from = Math.max(from ?? 0, (comp.c.to_turn ?? 0) + 1);
      }
    }
    const turns = this.getTurns(chainId, { from, to: toTurn }).filter((t) => viewed(t) && !apartNs?.has(t.n));
    const base = { view, chainId, title: named.title, total: turns.length };
    const shape = (kept, tokens, extra) => ({
      ...base,
      ...extra,
      turns: kept.length,
      dropped: turns.length - kept.length,
      from: kept[0]?.t.n ?? null,
      to: kept.at(-1)?.t.n ?? null,
      tokens,
    });
    if (mode === "full") {
      const { kept, tokens } = fitBudget(
        turns.length,
        (i) => {
          const t = turns[i];
          const messages = [
            this.getMessage(t.user_hash),
            ...t.work.map((h) => this.getMessage(h)),
            t.final_hash && this.getMessage(t.final_hash),
          ]
            .filter(Boolean)
            .map((m) => m.message);
          return { t, messages, chars: JSON.stringify(messages).length };
        },
        budgetTokens,
      );
      // One turn bigger than the budget, kept as the newest is (`fitBudget`), is cut to its message and the newest of its
      // work that fits, Filament's line saying where (the owner's of 11-10: a turn of 157 calls came whole, past every
      // budget, and memory's load refused it every time — nothing of it could be handed over).
      if (kept.length === 1 && tokens > budgetTokens) {
        const [{ t, messages }] = kept;
        const [whole, ...rest] = messages;
        const weigh = (/** @type {any} */ m) => estTokens(JSON.stringify(m).length);
        const line = (/** @type {number} */ left) => ({ role: "user", content: [{ type: "text", text: `(Filament: ${left} earlier message${left === 1 ? "" : "s"} of turn ${t.n}'s work left out to fit the ${budgetTokens.toLocaleString("en-US")}-token budget: load it with a larger budget_tokens, view summary, or grep it for what they said)` }] });
        // A message too big on its own keeps its start, up to half the budget, and says the rest went.
        const half = Math.floor(budgetTokens / 2);
        const capped = weigh(whole) > half;
        const words = (Array.isArray(whole?.content) ? whole.content : [{ type: "text", text: String(whole?.content ?? "") }]).filter((/** @type {any} */ p) => p?.type === "text").map((/** @type {any} */ p) => p.text).join("\n");
        const first = capped
          ? { ...whole, content: [{ type: "text", text: `${headChars(words, Math.floor(words.length * (half / weigh(whole))))}\n…(Filament: the rest of this message left out to fit the ${budgetTokens.toLocaleString("en-US")}-token budget)` }] }
          : whole;
        let used = weigh(first) + weigh(line(rest.length));
        let from = rest.length;
        while (from > 0 && used + weigh(rest[from - 1]) <= budgetTokens) used += weigh(rest[--from]);
        const left = from;
        if (!left && !capped) return shape(kept, used - weigh(line(rest.length)), { messages });
        const cut = [first, ...(left ? [line(left)] : []), ...rest.slice(from)];
        return shape(kept, left ? used : used - weigh(line(rest.length)), { messages: cut, cut: { turn: t.n, left, ...(capped ? { message: true } : {}) } });
      }
      return shape(kept, tokens, { messages: kept.flatMap((e) => e.messages) });
    }
    if (mode !== "chat" && mode !== "summary") throw new Error(`Archive: unknown view ${view}`);
    const { kept, tokens } = fitBudget(
      turns.length,
      (i) => {
        const t = turns[i];
        const own = standIn?.(t);
        if (own != null) {
          const text = `### Turn ${t.n} (${when(t.started_at)})\n${own}`;
          return { t, text, chars: text.length };
        }
        const parts = mode === "summary" && words && !t.meta?.own ? words(this.getMessage(t.user_hash)?.message) : null;
        const text = this.#turnText(t, mode === "summary", 0, parts);
        return { t, text, chars: text.length };
      },
      budgetTokens,
      head ? estTokens(head.length) : 0,
    );
    const dropped = turns.length - kept.length;
    const omitted = dropped ? `(${dropped} earlier turn${dropped === 1 ? "" : "s"} omitted)` : null;
    const texts = kept.map((e) => e.text);
    const parts = (newestFirst ? [head, ...texts.reverse(), omitted] : [head, omitted, ...texts]).filter(Boolean);
    return shape(kept, tokens, { text: parts.join("\n\n") });
  }
  /**
   * The turns a learning run reads (HarnessV3-Memory M7-D28, M7-D29): each turn numbered `fromTurn` or later, up to the
   * newest finished one (a turn still running is left for a later run), oldest first, as the chat view renders it, with
   * the newest `calls` calls its work made between the person's words and the answer. Turns no view carries are left
   * out, and so are the turns kept apart (`beginTurn`'s `apart`), which no summarizer is sent; `through` is the newest
   * finished turn's number all the same, so a run whose span holds only those can move its cursor past them. Null
   * without the chain.
   * `words` (HarnessV4_Tasks C12) tells a user message's own words from Filament's notices that rode with it: the
   * turn's "User:" line is then the person's words alone — the cap is spent on them, not on a client's reminders ahead
   * of them — and the notices follow it, said as Filament's.
   * Another machine's agents' chat (`agentsChat`) has no "User:" line: what opens its turns is their agents' words, said
   * as theirs (the remote-agents plan's fc-word).
   * @param {string} chainId
   * @param {{ fromTurn?: number, calls?: number, words?: ((message: any) => { said: string, rode: string }) | null }} [o]
   * @returns {{ turns: { n: number, id: number, startedAt: number | null, text: string }[], through: number } | null}
   */
  turnsToRead(chainId, { fromTurn = 1, calls = 0, words = null } = {}) {
    if (!this.getChain(chainId)) return null;
    const all = this.getTurns(chainId, { from: fromTurn });
    const through = all.reduce((n, t) => (t.final_hash ? Math.max(n, t.n) : n), fromTurn - 1);
    const agents = this.agentsChat(chainId);
    return {
      turns: all
        .filter((t) => t.n <= through && viewed(t) && !apartTurn(t))
        .map((t) => ({ n: t.n, id: t.id, startedAt: t.started_at ?? null, text: this.#turnText(t, false, calls, words && !t.meta?.own ? words(this.getMessage(t.user_hash)?.message) : null, agents) })),
      through,
    };
  }
  /**
   * What the page told the person about a session (the filament-agent plan's Phase 4b), as the session keeps it
   * (`pageSaid` in its meta, each text a message of its own): a line each, its time (UTC, to the second), its kind and
   * its words, oldest first, within the budget — the oldest dropped first. `total` lines kept, `lines` shown.
   * @param {any} chain @param {number} budgetTokens
   */
  #pageView(chain, budgetTokens) {
    const said = Array.isArray(chain.meta?.pageSaid) ? chain.meta.pageSaid : [];
    const { kept, tokens } = fitBudget(
      said.length,
      (i) => {
        const l = said[i];
        const text = `- ${new Date(Number(l.at) || 0).toISOString().slice(0, 19).replace("T", " ")} ${l.kind}: ${textOfMessage(this.getMessage(l.hash)?.message)}`;
        return { text, chars: text.length };
      },
      budgetTokens,
    );
    const dropped = said.length - kept.length;
    const text = said.length
      ? [`### What the page told the user (UTC, oldest first)`, dropped ? `(${dropped} earlier line${dropped === 1 ? "" : "s"} omitted)` : null, ...kept.map((e) => e.text)].filter(Boolean).join("\n")
      : "(nothing the page said is kept for this session)";
    return { view: "page", chainId: chain.id, title: chain.title, total: said.length, lines: kept.length, dropped, tokens, text };
  }
  /**
   * A turn as the chat or summary view renders it; with `calls`, its newest calls before the answer (M7-D29). With
   * `parts` (the learner's reading, `turnsToRead`) the user's line is their own words alone, and Filament's notices that
   * rode with the message follow it, said as Filament's — in the summary view by their first lines, as is what opened
   * an own turn. `agents`: the turn is another machine's agents' chat's (`agentsChat`): its words are theirs.
   * @param {any} t @param {boolean} summary @param {number} [calls] @param {{ said: string, rode: string, notices?: string[] } | null} [parts] @param {boolean} [agents]
   */
  #turnText(t, summary, calls = 0, parts = null, agents = false) {
    // The summary view keeps a long message's head and end, as an answer's (the review of 11-08: a chat of long pasted
    // messages fitted five turns in recall's list).
    const said = (/** @type {string} */ s) => (summary ? gistOf(s) : cap(s, this.caps.inputChars));
    const user = parts ? said(parts.said) || "(no words of their own)" : said(textOfMessage(withoutAskLine(this.getMessage(t.user_hash)?.message))) || "(no text)";
    const rode = !parts?.rode ? "" : summary ? `${NOTES_HEAD}\n${firstLines(parts.notices ?? [parts.rode])}\n` : `${RODE_HEAD} ${cap(parts.rode, RODE_CHARS)}\n`;
    const fin = t.final_hash ? this.getMessage(t.final_hash) : null;
    let a = fin ? textOfMessage(fin.message) : "";
    if (summary) {
      const work = t.work.length ? `(work: ${this.#toolCalls(t.work)} tool calls)` : "";
      // A turn with no answer says why, where its record knows (the hunt of 11-08: its work count alone read as a turn
      // that ended): it failed — what it had said, then the cause, as the history's line on it (shapes.js
      // `failedLine`) —, a restart cut it off before its reply (`meta.cut`, app/sessions/cut-turns.js), else none was
      // recorded.
      const failed = t.meta?.failed;
      const none = fin ? "" : failed ? [gistOf(String(failed.text || "")), `[this turn failed: ${failed.cause}]`].filter(Boolean).join(" ") : t.meta?.cut ? "(cut off before its reply)" : "(no final answer recorded)";
      a = [t.summary ? (a ? `${t.summary} Its answer ends: ${endOf(a)}` : t.summary) : gistOf(a), none, work].filter(Boolean).join(" ");
    }
    const log = calls ? callLog(t.work.map((/** @type {string} */ h) => this.getMessage(h)?.message)) : [];
    const read = callsRead(log, calls);
    const did = log.length ? `Calls, oldest first (${read.count}):\n${read.lines.join("\n")}\n` : "";
    // A turn the agent began by itself (HarnessV3-ACP AC3-9): what opened it is no word of the user's. Nor is what opened
    // a turn of another machine's agents' chat: their agents' words (fc-word).
    const opener = t.meta?.own ? `No user message — the assistant went on by itself: ${summary ? firstLine(user) : user}` : agents ? `${AGENTS_SAID} ${user}` : `User: ${user}`;
    return `### Turn ${t.n} (${when(t.started_at)})\n${opener}\n${rode}${did}Assistant: ${a || (fin ? "(no text)" : "(no final answer recorded)")}`;
  }
  /**
   * Where words were said in a session (the filament-agent plan's Phase 4): each turn a view carries, newest first, read
   * whole — the words of the message that opened it (the user's, or Filament's when the agent went on by itself), the
   * assistant's, each call's name and input, each result's text — for `text`: its words as written, in any case, any
   * run of whitespace between them. A turn that has them: its number, when it began, how many times, and its first few
   * places. `limit` turns at most; `more` says older turns have them too (go on with `toTurn` below the last one
   * shown). `searched` is how many turns were read, `tokens` what the answer costs. Null without the chain. `apartToo`
   * false reads none of the turns kept apart, and no title such a turn named, as `render`'s.
   * @param {string} chainId
   * @param {{ text: string, limit?: number, fromTurn?: number | null, toTurn?: number | null, apartToo?: boolean }} o
   */
  grep(chainId, { text, limit = 10, fromTurn = null, toTurn = null, apartToo = true }) {
    const words = String(text ?? "").trim();
    if (!words) throw new Error("grep: no text to look for");
    const chain = this.getChain(chainId);
    if (!chain) return null;
    const title = !apartToo && chain.meta?.namedApart ? null : chain.title;
    const re = new RegExp(words.split(/\s+/).map(literal).join("\\s+"), "gi");
    /** @param {any} m @param {string} who */
    const placesOf = (m, who) => messagePieces(m).map((p) => ({ where: p.kind === "text" ? who : p.kind, s: p.text }));
    const matches = [];
    let searched = 0;
    let more = false;
    for (const t of this.getTurns(chainId, { from: fromTurn, to: toTurn }).filter((x) => viewed(x) && (apartToo || !apartTurn(x))).reverse()) {
      searched++;
      const places = [
        ...placesOf(withoutAskLine(this.getMessage(t.user_hash)?.message), t.meta?.own ? "filament" : "user"),
        ...[...t.work, t.final_hash]
          .filter(Boolean)
          .map((h) => this.getMessage(h)?.message)
          .flatMap((m) => placesOf(m, m?.role === "user" ? "user" : "assistant")),
      ];
      let hits = 0;
      const shown = [];
      for (const { where, s } of places) {
        const found = [...s.matchAll(re)];
        hits += found.length;
        if (found.length && shown.length < GREP_PLACES) shown.push({ where, line: around(s, found[0]) });
      }
      if (!hits) continue;
      if (matches.length === limit) {
        more = true;
        break;
      }
      matches.push({ turn: t.n, when: when(t.started_at), hits, places: shown });
    }
    return { session: chainId, title, text: words, searched, matches, more, tokens: estTokens(JSON.stringify(matches).length) };
  }
  // Tool-call messages among the work hashes, from the kind column (no decryption needed).
  #toolCalls(hashes) {
    if (!hashes.length) return 0;
    return this.#q(`SELECT COUNT(*) AS n FROM messages WHERE kind = 'tool_use' AND hash ${IN_LIST}`).get(listParam(hashes)).n;
  }

  // ---- learned items ---------------------------------------------------------------------------------------------
  // Same project + kind + normalised text (case, whitespace, trailing punctuation) is one item → { id, deduped }.
  #itemAdd({
    projectId = null,
    chainId = null,
    turnId = null,
    kind,
    text,
    status = "inferred",
    importance = 0.6,
    memoryId = null,
    origin = null,
    slot = null,
    finder = null,
    quoted = null,
  } = {}) {
    if (!kind || !text) throw new Error("Archive: items.add needs kind and text");
    if (!ITEM_STATUSES.includes(status)) throw new Error(`Archive: bad item status ${status}`);
    if (origin != null && !ITEM_ORIGINS.includes(origin)) throw new Error(`Archive: bad item origin ${origin}`);
    return this.#tx(() => {
      const norm = normItem(text);
      const dup = this.#q("SELECT id FROM items WHERE project_id IS ? AND kind = ? AND text_norm = ?").get(
        projectId,
        kind,
        norm,
      );
      if (dup) return { id: dup.id, deduped: true };
      const t = this.now();
      const r = this.#q(
        "INSERT INTO items (project_id, chain_id, turn_id, kind, text, text_norm, status, importance, memory_id, created_at, updated_at, origin, slot, slot_value, slot_multi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(projectId, chainId, turnId, kind, String(text), norm, status, importance, memoryId, t, t, origin, slot?.slot ?? null, slot?.value ?? null, slot ? (slot.multi ? 1 : 0) : null);
      const id = Number(r.lastInsertRowid);
      // `quoted`: the person's words an agent quoted to file it as theirs (the memory plan's d1), and who filed it.
      this.#itemEvent(id, "created", { by: origin, detail: { status, kind, ...(slot ? { slot: slot.slot, value: slot.value ?? null } : {}), ...(finder ? { finder } : {}), ...(quoted ? { quote: quoted.quote, turn: quoted.turn ?? null, filedBy: quoted.by } : {}) } });
      return { id, deduped: false };
    });
  }
  #itemList({ projectId, chainId, status, kind, limit = 100 } = {}) {
    const where = [],
      args = [];
    if (projectId !== undefined) {
      where.push("project_id IS ?");
      args.push(projectId);
    }
    if (chainId !== undefined) {
      where.push("chain_id IS ?");
      args.push(chainId);
    }
    if (status) {
      where.push("status = ?");
      args.push(status);
    }
    if (kind) {
      where.push("kind = ?");
      args.push(kind);
    }
    return this.#q(
      `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
      .all(...args, limit)
      .map(plain);
  }
  #itemGet(id) {
    return plain(this.#q("SELECT * FROM items WHERE id = ?").get(id));
  }
  // The archive items mirrored as one engine memory (normally one; a text remembered twice can share it).
  #itemsByMemoryId(memoryId) {
    if (!memoryId) return [];
    return this.#q("SELECT * FROM items WHERE memory_id = ?").all(String(memoryId)).map(plain);
  }
  #itemSet(id, col, value) {
    return (
      this.#q(`UPDATE items SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value ?? null, this.now(), id)
        .changes > 0
    );
  }
  // A status change with its reason, written to the item and to its history in one transaction. Retiring stamps
  // when and why (and, for `superseded`, by which item); bringing an item back clears the three. `finder`: the agent
  // that changed it, named on its history (HarnessV3-Memory M7-D47).
  #itemSetStatus(id, status, { by = null, reason = null, replacement = null, run = null, finder = null, quiet = false } = {}) {
    if (!ITEM_STATUSES.includes(status)) throw new Error(`Archive: bad item status ${status}`);
    return this.#tx(() => {
      const cur = this.#q("SELECT status FROM items WHERE id = ?").get(id);
      if (!cur) return false;
      const t = this.now();
      const retired = isRetired(status);
      this.#q("UPDATE items SET status = ?, updated_at = ?, invalid_at = ?, invalid_reason = ?, superseded_by = ? WHERE id = ?").run(
        status,
        t,
        retired ? t : null,
        retired ? (reason ?? null) : null,
        status === "superseded" ? (replacement ?? null) : null,
        id,
      );
      if (cur.status !== status || reason)
        this.#itemEvent(id, "status", { by, reason, run, detail: { from: cur.status, to: status, ...(replacement ? { replacement } : {}), ...(finder ? { finder } : {}), ...(quiet ? { quiet: true } : {}) } });
      return true;
    });
  }
  #anchorsAdd(itemId, rows) {
    const ins = this.#q(
      "INSERT OR REPLACE INTO item_anchors (item_id, path, name, kind, hash, size, mtime, head, symbols_json, state, at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const t = this.now();
    for (const a of rows || [])
      ins.run(itemId, a.path, a.name ?? null, a.kind, a.hash ?? null, a.size ?? null, a.mtime ?? null, a.head ?? null, JSON.stringify(a.symbols || []), a.state || "ok", t, t);
  }
  // `run`: the curator's pass that made it (M4-1), so the pass can be undone. The claims feed gets its row in the same
  // transaction (M7-D32). Returns the event's id.
  #itemEvent(itemId, action, { by = null, reason = null, detail = null, run = null } = {}) {
    return this.#tx(() => {
      const id = Number(
        this.#q("INSERT INTO item_events (item_id, at, action, by, reason, detail_json, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          itemId,
          this.now(),
          action,
          by,
          reason == null ? null : String(reason).slice(0, 300),
          detail ? JSON.stringify(detail) : null,
          run,
        ).lastInsertRowid,
      );
      this.#feedRow(itemId, action, { by, fromProject: action === "moved" ? (detail?.from ?? null) : null });
      return id;
    });
  }
  /**
   * A row on the claims feed (HarnessV3-Memory M7-D32), in the caller's transaction: a change a claim's card shows, with
   * the claim's project and session as it stands; or a dossier's, or a project gone (`itemId` null), in the project
   * given. `fromProject`: the project a claim moved out of.
   * @param {number | null} itemId @param {string} action
   * @param {{ by?: string | null, projectId?: string | null, fromProject?: string | null }} [o]
   */
  #feedRow(itemId, action, { by = null, projectId = null, fromProject = null } = {}) {
    const it = itemId != null ? this.#q("SELECT project_id, chain_id FROM items WHERE id = ?").get(itemId) : null;
    this.#q("INSERT INTO claim_feed (at, item_id, action, project_id, from_project, chain_id, by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      this.now(),
      itemId,
      action,
      it ? (it.project_id ?? null) : projectId,
      fromProject,
      it?.chain_id ?? null,
      by,
    );
    this.#claimChanged();
  }
  /** The service told the feed moved (`onClaimChange`); a relay that throws never fails the write. */
  #claimChanged() {
    try {
      this.onClaimChange?.();
    } catch {
      /* the relay is the service's: a write never fails on it */
    }
  }
  /** The claims a question names (HarnessV3-Memory M7-D32): its `itemIds` and its proposal's claim and replacement, each once. @param {any} q  an inbox row as read */
  #questionClaims(q) {
    const ids = [...(q?.itemIds || []), q?.proposal?.id, q?.proposal?.replacement].map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)];
  }
  /** An item's history, oldest first. @param {number} id */
  #itemEvents(id) {
    return this.#q("SELECT * FROM item_events WHERE item_id = ? ORDER BY id").all(id).map(eventRow);
  }
  // Learned-but-not-dismissed item counts for a batch of chains, one GROUP BY: chain id → n.
  #itemCountsByChain(chainIds) {
    const m = new Map();
    const ids = (chainIds || []).filter(Boolean);
    if (!ids.length) return m;
    for (const r of this.#q(
      `SELECT chain_id, COUNT(*) AS n FROM items WHERE status NOT IN ('dismissed', 'superseded') AND chain_id ${IN_LIST} GROUP BY chain_id`,
    ).all(listParam(ids)))
      m.set(r.chain_id, Number(r.n || 0));
    return m;
  }

  // ---- engine outbox (HarnessV3-Memory M2-2) ------------------------------------------------------------------------
  // What the engine still has to be told about an item: `mirror` (store its copy), `invalidate`, `restore`. A row is
  // written beside the archive change it follows (`transaction`), and EngineOutbox sends the rows in order, item by item.
  #outboxAdd(itemId, op, args = {}) {
    if (!["mirror", "invalidate", "restore"].includes(op)) throw new Error(`Archive: bad outbox op ${op}`);
    const t = this.now();
    return Number(
      this.#q("INSERT INTO engine_outbox (item_id, op, args_json, next_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
        itemId,
        op,
        JSON.stringify(args || {}),
        t,
        t,
      ).lastInsertRowid,
    );
  }
  // The rows due now, oldest first — except a row whose item has an earlier row still waiting: one item's writes go
  // in the order they were made.
  #outboxReady(now, limit = 100) {
    return this.#q(
      `SELECT o.* FROM engine_outbox o WHERE o.done_at IS NULL AND o.next_at <= ?
         AND NOT EXISTS (SELECT 1 FROM engine_outbox e WHERE e.item_id = o.item_id AND e.done_at IS NULL AND e.id < o.id)
       ORDER BY o.id LIMIT ?`,
    )
      .all(now, limit)
      .map((r) => {
        const { args_json, ...rest } = plain(r);
        return { ...rest, args: parseJson(args_json, {}) };
      });
  }
  #outboxDone(id) {
    this.#q("UPDATE engine_outbox SET done_at = ? WHERE id = ?").run(this.now(), id);
  }
  #outboxRetry(id, error, nextAt) {
    this.#q("UPDATE engine_outbox SET attempts = attempts + 1, last_error = ?, next_at = ? WHERE id = ?").run(String(error ?? "").slice(0, 300), nextAt, id);
  }
  #outboxDead(id, error) {
    this.#q("UPDATE engine_outbox SET attempts = attempts + 1, last_error = ?, done_at = ?, dead = 1 WHERE id = ?").run(String(error ?? "").slice(0, 300), this.now(), id);
  }
  #outboxStatus() {
    const r = this.#q(
      "SELECT COUNT(*) AS waiting, SUM(attempts > 0) AS retrying, MIN(created_at) AS oldest FROM engine_outbox WHERE done_at IS NULL",
    ).get();
    const dead = this.#q("SELECT COUNT(*) AS n FROM engine_outbox WHERE dead = 1").get().n;
    const last = this.#q("SELECT last_error FROM engine_outbox WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    return { waiting: Number(r.waiting || 0), retrying: Number(r.retrying || 0), dead: Number(dead || 0), oldestAt: r.oldest ?? null, lastError: last?.last_error ?? null };
  }

  // ---- injection log ---------------------------------------------------------------------------------------------
  // What was injected for a request (ids only, never content); `used` stays null until markUsed decides.
  #injAdd({ requestId, chainId = null, turnId = null, kind, ids = [], tokens = 0 } = {}) {
    return this.#tx(() => {
      const list = (ids || []).map(String);
      const id = Number(
        this.#q(
          "INSERT INTO injections (request_id, chain_id, turn_id, kind, ids_json, tokens, used, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
        ).run(requestId ?? null, chainId, turnId, kind ?? null, JSON.stringify(list), tokens | 0, this.now())
          .lastInsertRowid,
      );
      // The junction is what makes "how often was this memory ignored" an indexed lookup instead of a scan of
      // every injection row (the old instr(ids_json,…) prefilter could not use an index and grew without bound).
      const ins = this.#q("INSERT OR IGNORE INTO injection_ids (injection_id, memory_id) VALUES (?, ?)");
      for (const m of list) ins.run(id, m);
      return id;
    });
  }
  // The request's verdict (did the reply use any of it — what the activity pages count) and, per id, which items the
  // reply itself echoed (MD-11): one item's echo no longer credits its neighbours.
  // A use credited while the turn ran — its agent looked the memory up again (`creditShownIn`) — stands: the reply's
  // verdict never takes it back.
  #injMarkUsed(requestId, used, usedIds = null) {
    return this.#tx(() => {
      const rows = used == null ? [] : this.#q("SELECT j.injection_id AS inj, j.memory_id AS id, j.used AS used FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.request_id = ?").all(requestId);
      const credited = rows.some((r) => r.used === 1);
      const n = this.#q("UPDATE injections SET used = ? WHERE request_id = ?").run(used == null ? null : used || credited ? 1 : 0, requestId).changes;
      if (used != null) {
        const hit = new Set((usedIds || []).map(String));
        const upd = this.#q("UPDATE injection_ids SET used = ? WHERE injection_id = ? AND memory_id = ?");
        for (const r of rows) upd.run(hit.has(String(r.id)) || r.used === 1 ? 1 : 0, r.inj, r.id);
        this.#usedNow(rows.filter((r) => hit.has(String(r.id))).map((r) => String(r.id)));
      }
      return n;
    });
  }
  /** `kind`: the latest showing of that kind alone (a briefing's, f3). @param {string} chainId @param {string[]} refs @param {string | null} [kind] @returns {string[]} */
  #injCreditShownIn(chainId, refs, kind = null) {
    const list = [...new Set((refs || []).map(String).filter(Boolean))];
    if (!chainId || !list.length) return [];
    return this.#tx(() => {
      const latest = kind
        ? this.#q("SELECT MAX(j.injection_id) AS inj FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id = ? AND i.chain_id = ? AND i.kind = ?")
        : this.#q("SELECT MAX(j.injection_id) AS inj FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id = ? AND i.chain_id = ?");
      const mark = this.#q("UPDATE injection_ids SET used = 1 WHERE injection_id = ? AND memory_id = ?");
      const whole = this.#q("UPDATE injections SET used = 1 WHERE id = ?");
      /** @type {string[]} */
      const credited = [];
      for (const ref of list) {
        const inj = (kind ? latest.get(ref, String(chainId), kind) : latest.get(ref, String(chainId)))?.inj;
        if (inj == null) continue;
        mark.run(inj, ref);
        whole.run(inj);
        credited.push(ref);
      }
      this.#usedNow(credited);
      return credited;
    });
  }
  /** When these memories were used: now, kept per memory as its last use (f3). @param {string[]} refs */
  #usedNow(refs) {
    if (!refs.length) return;
    const put = this.#q("INSERT INTO memory_last_used (memory_id, at) VALUES (?, ?) ON CONFLICT(memory_id) DO UPDATE SET at = MAX(at, excluded.at)");
    const at = this.now();
    for (const ref of new Set(refs)) put.run(ref, at);
  }
  /** @param {string[]} refs @param {string} kind @param {number} last */
  #injRecentUse(refs, kind, last) {
    const list = [...new Set((refs || []).map(String).filter(Boolean))];
    /** @type {Map<string, { judged: number, used: number }>} */
    const out = new Map();
    for (let k = 0; k < list.length; k += 400) {
      const part = list.slice(k, k + 400);
      for (const r of this.#q(
        `SELECT ref, COUNT(*) AS judged, SUM(used) AS used FROM (SELECT j.memory_id AS ref, j.used AS used, ROW_NUMBER() OVER (PARTITION BY j.memory_id ORDER BY j.injection_id DESC) AS rn
           FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id IN (${part.map(() => "?").join(", ")}) AND j.used IS NOT NULL AND i.kind = ?) WHERE rn <= ? GROUP BY ref`,
      ).all(...part, kind, last))
        out.set(String(r.ref), { judged: Number(r.judged) || 0, used: Number(r.used) || 0 });
    }
    return out;
  }
  /** @param {string[]} refs @param {number} since */
  #injUseCounts(refs, since) {
    const list = [...new Set((refs || []).map(String).filter(Boolean))];
    /** @type {Map<string, { shown: number, judged: number, used: number }>} */
    const out = new Map();
    for (let k = 0; k < list.length; k += 400) {
      const part = list.slice(k, k + 400);
      for (const r of this.#q(
        `SELECT j.memory_id AS ref, COUNT(*) AS shown, SUM(j.used IS NOT NULL) AS judged, SUM(j.used = 1) AS used FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id IN (${part.map(() => "?").join(", ")}) AND i.created_at >= ? GROUP BY j.memory_id`,
      ).all(...part, since))
        out.set(String(r.ref), { shown: Number(r.shown || 0), judged: Number(r.judged || 0), used: Number(r.used || 0) });
    }
    return out;
  }
  /** @param {string[]} refs */
  #injBriefedSinceUse(refs) {
    const list = [...new Set((refs || []).map(String).filter(Boolean))];
    /** @type {Map<string, number>} */
    const out = new Map();
    for (let k = 0; k < list.length; k += 400) {
      const part = list.slice(k, k + 400);
      // Each memory's last use found once, materialized (its kept time, or its newest used showing's), then its briefings
      // after it.
      for (const r of this.#q(
        `WITH r(ref) AS (VALUES ${part.map(() => "(?)").join(", ")}),
         last AS MATERIALIZED (SELECT r.ref AS ref, MAX(COALESCE((SELECT u.at FROM memory_last_used u WHERE u.memory_id = r.ref), 0),
                    COALESCE((SELECT i.created_at FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id = r.ref AND j.used = 1 ORDER BY j.injection_id DESC LIMIT 1), 0)) AS at FROM r)
         SELECT l.ref AS ref, COUNT(DISTINCT i.chain_id) AS n FROM last l
           JOIN injection_ids j ON j.memory_id = l.ref AND j.used = 0
           JOIN injections i ON i.id = j.injection_id
          WHERE i.kind = 'briefing' AND i.created_at > l.at
          GROUP BY l.ref`,
      ).all(...part))
        out.set(String(r.ref), Number(r.n) || 0);
    }
    return out;
  }
  /**
   * The injections since `since`, the ids each carried and whether each was used, and the archive items those ids name
   * (`i<n>`): their kind, origin and status, and whether a newer one replaced them.
   * @param {number} since
   */
  #injRollupRows(since) {
    const injections = this.#q("SELECT id, chain_id, turn_id, kind, tokens, used, created_at FROM injections WHERE created_at >= ? ORDER BY id").all(since);
    const ids = this.#q("SELECT j.injection_id, j.memory_id, j.used FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.created_at >= ?").all(since);
    const items = this.#q(
      "SELECT it.id, it.kind, it.origin, it.status, it.superseded_by FROM items it WHERE it.id IN (SELECT DISTINCT CAST(substr(j.memory_id, 2) AS INTEGER) FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.created_at >= ? AND j.memory_id GLOB 'i[0-9]*')",
    ).all(since);
    // The archive items whose last three judged showings went unused, over every day kept — whether one fades now is not
    // a window's question — with their kind and status, which say whether it may fade.
    const quiet = this.#q(
      `SELECT it.id, it.kind, it.status FROM (SELECT memory_id, COUNT(*) AS n, SUM(used) AS u FROM (SELECT memory_id, used, ROW_NUMBER() OVER (PARTITION BY memory_id ORDER BY injection_id DESC) AS rn FROM injection_ids WHERE used IS NOT NULL AND memory_id GLOB 'i[0-9]*') WHERE rn <= 3 GROUP BY memory_id) q
       JOIN items it ON it.id = CAST(substr(q.memory_id, 2) AS INTEGER) WHERE q.n = 3 AND q.u = 0`,
    ).all();
    return { injections, ids, items, quiet };
  }
  #injForRequest(requestId) {
    return this.#q("SELECT * FROM injections WHERE request_id = ? ORDER BY id")
      .all(String(requestId))
      .map((r) => ({ ...r, ids: parseJson(r.ids_json, []), used: r.used == null ? null : !!r.used }));
  }
  #injRecent(limit = 50) {
    return this.#q("SELECT * FROM injections ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((r) => ({ ...r, ids: parseJson(r.ids_json, []), used: r.used == null ? null : !!r.used }));
  }
  // One session's injections, newest first, plus the totals over ALL of them (the page is capped, the counts are not).
  #injForChain(chainId, limit = 50) {
    const rows = this.#q("SELECT * FROM injections WHERE chain_id = ? ORDER BY id DESC LIMIT ?")
      .all(String(chainId), limit)
      .map((r) => ({ ...r, ids: parseJson(r.ids_json, []), used: r.used == null ? null : !!r.used }));
    const totals = this.#q(
      "SELECT COUNT(*) AS n, COALESCE(SUM(tokens), 0) AS tokens, SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) AS used, SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) AS unused FROM injections WHERE chain_id = ?",
    ).get(String(chainId));
    return {
      rows,
      total: Number(totals?.n || 0),
      tokens: Number(totals?.tokens || 0),
      used: Number(totals?.used || 0),
      unused: Number(totals?.unused || 0),
    };
  }
  // How many times in a row (newest first) an id was injected and then judged not used — by its own echo, not the
  // request's; unjudged injections are skipped.
  // The sessions shown any of these ids since `since`, newest first (errata, HarnessV3-Memory M1-7). One memory may
  // have been shown by more than one id (`i<n>`, its engine row's): the caller names them all.
  /** @param {string[]} refs @param {number} since */
  #injChainsShown(refs, since) {
    const list = [...new Set((refs || []).map(String).filter(Boolean))].slice(0, 8);
    if (!list.length) return [];
    return this.#q(
      `SELECT i.chain_id AS chainId, MAX(i.created_at) AS at FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE j.memory_id IN (${list.map(() => "?").join(", ")}) AND i.created_at >= ? AND i.chain_id IS NOT NULL GROUP BY i.chain_id ORDER BY at DESC LIMIT 50`,
    )
      .all(...list, since)
      .map((r) => r.chainId);
  }
  // A memory proved right where it was last shown: that showing counts as a use (it resets the fade).
  /** @param {string} ref */
  #injCreditLatest(ref) {
    return this.#q(
      "UPDATE injection_ids SET used = 1 WHERE memory_id = ? AND injection_id = (SELECT MAX(injection_id) FROM injection_ids WHERE memory_id = ?)",
    ).run(String(ref), String(ref)).changes;
  }
  /** @param {string[]} refs */
  #injJudged(refs) {
    /** @type {Map<string, { judged: number, used: number, sessions: number }>} */
    const out = new Map();
    const list = [...new Set((refs || []).map(String).filter(Boolean))];
    for (let i = 0; i < list.length; i += 400) {
      const part = list.slice(i, i + 400);
      for (const r of this.#q(
        `SELECT j.memory_id AS ref, SUM(CASE WHEN j.used IS NOT NULL THEN 1 ELSE 0 END) AS judged, SUM(CASE WHEN j.used = 1 THEN 1 ELSE 0 END) AS used, COUNT(DISTINCT CASE WHEN j.used IS NOT NULL THEN i.chain_id END) AS sessions FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.kind = 'turn' AND j.memory_id IN (${part.map(() => "?").join(", ")}) GROUP BY j.memory_id`,
      ).all(...part))
        out.set(String(r.ref), { judged: Number(r.judged) || 0, used: Number(r.used) || 0, sessions: Number(r.sessions) || 0 });
    }
    return out;
  }
  #injNeverUsed(memoryId) {
    let n = 0;
    for (const r of this.#q(
      "SELECT used FROM injection_ids WHERE memory_id = ? ORDER BY injection_id DESC LIMIT 400",
    ).all(String(memoryId))) {
      if (r.used == null) continue;
      if (r.used) break;
      n++;
    }
    return n;
  }
  /**
   * The archive items a chain was ever shown by their `i<n>` refs, as its injection log has them (M3-3: the claims whose
   * files its turns check). The rows logged since the chain's last check are read and added to what that check found
   * (`#shown`), so a check costs what was logged since, not the log of a long session whole; the log keeps every row,
   * which a turn's view and the totals read.
   * @param {string} chainId @returns {number[]}
   */
  #itemsShownIn(chainId) {
    const id = String(chainId);
    const seen = this.#shown.get(id) || { through: 0, items: new Set() };
    const through = Number(this.#q("SELECT MAX(id) AS last FROM injections WHERE chain_id = ?").get(id)?.last) || 0;
    if (through > seen.through)
      for (const r of this.#q(
        "SELECT DISTINCT CAST(substr(j.memory_id, 2) AS INTEGER) AS id FROM injections i JOIN injection_ids j ON j.injection_id = i.id WHERE i.chain_id = ? AND i.id > ? AND i.id <= ? AND j.memory_id GLOB 'i[0-9]*'",
      ).all(id, seen.through, through))
        seen.items.add(Number(r.id));
    seen.through = through;
    this.#shown.delete(id);
    this.#shown.set(id, seen);
    if (this.#shown.size > SHOWN_CHAINS) this.#shown.delete(/** @type {string} */ (this.#shown.keys().next().value));
    return [...seen.items];
  }

  // ---- maintenance -----------------------------------------------------------------------------------------------
  // Consistent copy of the live database: the online backup API (module-level `backup` in Node 24, an instance method
  // in some builds) overwrites an existing target in place; the VACUUM INTO fallback needs it gone first. → { file, bytes }
  async backupTo(file) {
    mkdirSync(dirname(file), { recursive: true });
    if (typeof sqlite.backup === "function") await sqlite.backup(this.db, file);
    else if (typeof this.db.backup === "function") await this.db.backup(file);
    else {
      rmSync(file, { force: true });
      this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    }
    return { file, bytes: statSync(file).size };
  }
  // Chains by kind, and how many carry a session-layer document — the Feature board's archive-side numbers.
  /** @returns {{ byKind: Record<string, number>, withSettings: number, compactionsByKind: Record<string, number> }} */
  chainCounts() {
    /** @type {Record<string, number>} */
    const byKind = {};
    for (const r of this.#q("SELECT COALESCE(kind, 'interactive') AS kind, COUNT(*) AS n FROM chains GROUP BY kind").all()) byKind[String(r.kind)] = Number(r.n) || 0;
    /** @type {Record<string, number>} */
    const compactionsByKind = {};
    for (const r of this.#q("SELECT COALESCE(kind, 'compaction') AS kind, COUNT(*) AS n FROM compactions GROUP BY kind").all()) compactionsByKind[String(r.kind)] = Number(r.n) || 0;
    return {
      byKind,
      withSettings: Number(this.#q("SELECT COUNT(*) AS n FROM chains WHERE settings_json IS NOT NULL AND settings_json != '' AND settings_json != '{}'").get().n || 0),
      compactionsByKind,
    };
  }
  /** How many chains the archive holds: the chains' own rows counted, no message read (what memory's open says). */
  chainTotal() {
    return Number(this.#q("SELECT COUNT(*) AS n FROM chains").get().n || 0);
  }
  /**
   * Every table's size. The messages' count and bytes are their running totals (`MESSAGE_TOTALS`), read from one row;
   * each other table is counted, a COUNT(*) SQLite answers from the smallest index it has. While a file's messages are
   * first counted their two figures are null and `counting` says so; a count that failed leaves them null, unsaid,
   * until the next opening counts again.
   * @returns {{ projects: number, chains: number, turns: number, messages: number | null, bytes: number | null, items: number, compactions: number, trimSlices: number, injections: number, counting?: true }}
   */
  counts() {
    const one = (sql) => Number(this.#q(sql).get().n || 0);
    const kept = this.#q("SELECT rows, bytes, counted FROM message_totals WHERE id = 1").get();
    const counted = !!kept?.counted;
    return {
      projects: one("SELECT COUNT(*) AS n FROM projects"),
      chains: one("SELECT COUNT(*) AS n FROM chains"),
      turns: one("SELECT COUNT(*) AS n FROM turns"),
      messages: counted ? Number(kept.rows) : null,
      bytes: counted ? Number(kept.bytes) : null,
      items: one("SELECT COUNT(*) AS n FROM items"),
      compactions: one("SELECT COUNT(*) AS n FROM compactions"),
      trimSlices: one("SELECT COUNT(*) AS n FROM trim_slices"),
      injections: one("SELECT COUNT(*) AS n FROM injections"),
      ...(counted || !this.#counting ? {} : { counting: /** @type {const} */ (true) }),
    };
  }
  /**
   * Counts the messages of a file written before its totals row, on a thread of its own (`archive-count.js`); what it
   * finds goes into the row as the thread answers. One that fails, or whose thread does not start, leaves the row
   * uncounted, and the file is counted at its next opening. A database in memory is never such a file: it starts
   * with its row.
   */
  #countMessages() {
    if (this.#closed || this.file === ":memory:") return;
    const stop = new Int32Array(new SharedArrayBuffer(4));
    /** @type {Worker} */
    let worker;
    try {
      worker = new Worker(new URL("./archive-count.js", import.meta.url), { workerData: { file: this.file, stop }, execArgv: ["--no-warnings"] });
    } catch {
      return;
    }
    // The count never keeps a process that is done from ending.
    worker.unref();
    const done = new Promise((resolve) => {
      worker.on("message", (/** @type {{ rows: number, bytes: number }} */ r) => {
        if (this.#closed) return;
        try {
          this.#q("UPDATE message_totals SET rows = rows + ?, bytes = bytes + ?, counted = 1 WHERE id = 1 AND counted = 0").run(r.rows, r.bytes);
        } catch {
          // Not written (the file busy past its wait): uncounted, as a count that failed.
        }
      });
      worker.on("error", () => {});
      worker.on("exit", () => {
        this.#counting = null;
        resolve(undefined);
      });
    });
    this.#counting = { stop, done };
  }
  /** Settles when the count of this file's messages under way ends (at once without one): `counts` has their figures then, unless it failed. */
  async messagesCounted() {
    await this.#counting?.done;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#counting) Atomics.store(this.#counting.stop, 0, 1);
    this.#stmts.clear();
    this.db.close();
  }
}
