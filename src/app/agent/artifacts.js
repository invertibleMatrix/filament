// @ts-check
// The agent's artifacts (HarnessV4_Artifacts_Plan, E18): a page it makes that lives outside the chat — in the
// developer's Artifacts list, under an address of its own on this machine, kept with every version (AF-D2, AF-D5). One
// tool of Filament's own, `artifact`, the same for both engines (AF-D1): the loop offers it, and a coding agent reaches
// it over Filament's MCP server or as Cursor's custom tools (agent-tools.js). Its actions: `guide` (Filament's rules for
// a type), `publish` (a new artifact, or the next version of one, whole), `read` (a version whole), `list`, and
// `read_db` and `write_db` (what a page keeps in `filament.db`, step 5). A publish over a version its session has not
// read is refused, the artifact handed back to build on (AF-D5); its data has no such guard, so the guide says to read
// it first and change records by update. A page is the agent's HTML; a doc or slides its Markdown (step 6), a
// dashboard its tiles and the tables they read — Filament's own numbers among them (AF-D12) — and a design its screens
// (step 7), each drawn by a page of Filament's own (AF-D11); a next version keeps its type. An agent cannot delete an
// artifact (AFC-47): that is the developer's.
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix } from "node:path";
import { shelfLines } from "../../services/shelf.js";
import { VISUAL_HOSTS } from "../../core/visual-look.js";
import { PINNED_TEXT, PINS_FILE, isWebFile, webAddressesIn } from "../../core/web-pins.js";
import { createWebPins } from "../../services/web-pins.js";
import {
  ARTIFACT_DESCRIPTION_MAX,
  ARTIFACT_ICONS,
  ARTIFACT_TITLE_MAX,
  ARTIFACT_TYPES,
  APP_JSON,
  CONTENT_FILE,
  CONTENT_JSON,
  PAGE_FILE,
  artifactAddress,
  artifactNameOfHost,
  artifactPath,
  isEditable,
  isTextData,
  isTextFile,
  isTyped,
} from "../../core/artifacts.js";
import {
  FEEDS,
  FEED_DAYS,
  FEED_DAYS_MAX,
  FEED_NAMES,
  FORMATS,
  GLANCE_MAX,
  HOWTO_MAX,
  NUMBER_OF,
  SCREEN_HEIGHT_MAX,
  SCREEN_HEIGHT_MIN,
  SCREEN_SIZE,
  SCREEN_SIZES,
  SERIES_MAX,
  STATUS_ROWS,
  TILE_KINDS,
  appOf,
  dashboardOf,
  designOf,
  feedsOf,
  screenWords,
} from "../../core/artifact-content.js";
import { ASK_MAX, COMMAND_BYTES, COMMAND_MS, FILAMENT_READS, FOLDER_DEPTH_MAX, SOURCE_EVERY_MS, VERIFY_MAX, WATCH_EVERY_MS, everyWords } from "../../core/dashboard-sources.js";
import { HOOK_BYTES, HOOK_ROWS_MAX } from "../../core/app-hooks.js";
import { TOOLS_MAX, TOOL_ARGS_MAX } from "../../core/app-tools.js";
import { SQL_BODY_MAX, SQL_DB_MAX_MB, SQL_ROWS_MAX, SQL_TIMEOUT_MS } from "../../core/app-sql.js";
import { leftWords, readFolder } from "../../services/artifacts.js";
import { keptWebIn } from "../../services/app-import.js";
import { APP_JSON_KEYS, KEPT_WEB } from "../../core/app-folder.js";
import { lookRules } from "./visuals.js";

export const ARTIFACT = "artifact";
/** What the tool does, in the order its description gives them. */
export const ARTIFACT_ACTIONS = Object.freeze(["guide", "publish", "read", "list", "read_db", "write_db"]);
/** A call where the session makes no artifacts: switched off, or nothing of Filament's shows its chat (AFC-5). */
export const ARTIFACTS_OFF = "Not run: artifacts are off in this session.";

export const ARTIFACT_TOOL = Object.freeze({
  name: ARTIFACT,
  description:
    "Make a page, doc, slides, dashboard, design or app the person keeps: it lives outside the chat, in their Artifacts list, under an address of its own on this machine, with every version kept. Make one for something they will use again (a tracker, a calculator, a report, a small tool), not for a picture inside your answer (show_visual draws that). " +
    "Actions: guide gives Filament's rules for a type; read it before your first publish of that type in a session. " +
    "publish makes a new artifact, or the next version of one by its id, whole: html (or folder, with files beside it) for a page or an app, markdown for a doc or slides, tiles and tables for a dashboard, screens and style for a design, as the guides say. " +
    "read gives one whole, its page and files. list gives each one's title, name and address. " +
    "read_db reads what a page keeps in filament.db; write_db changes one collection, all or nothing, with set, update and delete. " +
    "To change an artifact, read it, then publish it whole with its id: a publish over a version this session has not read is refused and hands you the newest to build on. The person sees each publish in the chat and can open it; you are told only that it was published.",
  input_schema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: [...ARTIFACT_ACTIONS], description: "guide, publish, read, list, read_db or write_db." },
      type: {
        type: "string",
        enum: [...ARTIFACT_TYPES],
        description:
          "guide: the type whose rules to give. publish: what a new artifact is: page (the default; you write the HTML), doc or slides (you write Markdown; Filament draws a document or a deck), dashboard (you write tiles and the tables they read; Filament draws numbers, charts and tables), design (you write screens in HTML; Filament lays them on a canvas at a phone's, a tablet's or a desktop's size) or app (you write the page, with the commands it reads and the buttons it runs, which run in a project's Space once the person keeps it there). A next version keeps its type.",
      },
      id: { type: "string", description: "publish (a next version), read, read_db and write_db: the artifact's name, as list and its address give it (expense-tracker-k3f9), or its address." },
      title: { type: "string", description: `publish: two to four words, sentence case (Expense tracker); ${ARTIFACT_TITLE_MAX} characters at most. A new artifact needs one; a next version keeps its title unless you give another.` },
      description: { type: "string", description: "publish: one line, what it does." },
      icon: { type: "string", description: `publish: one word for its mark: ${ARTIFACT_ICONS.join(", ")}.` },
      html: { type: "string", description: "publish, a page or an app: the page, a whole HTML document or what goes inside its <body>." },
      markdown: { type: "string", description: "publish, a doc or slides: the whole of it in Markdown, which Filament draws (in place of html)." },
      files: {
        type: "array",
        description: "publish, a page or an app: text files beside it, which it loads by relative paths (app.js, css/style.css, data.json).",
        items: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
      },
      folder: { type: "string", description: "publish, a page or an app: a folder in the project whose index.html is the page, published with every file beside it, in place of html and files." },
      tiles: {
        type: "array",
        description: `publish, a dashboard: its tiles in their order, each with kind (${TILE_KINDS.join(", ")}) and title, and what it reads; its guide says how.`,
        items: { type: "object", required: ["kind", "title"], properties: { kind: { type: "string", enum: [...TILE_KINDS] }, title: { type: "string" } } },
      },
      tables: { type: "object", description: 'publish, a dashboard: the tables its tiles read, each by its name, a list of rows: {"weeks":[{"week":"W1","signups":12}]}.' },
      sources: { type: "object", description: "publish, a dashboard or an app for a project's Space: what it reads by itself once the developer keeps it, each by its name (a command or a connection's tool, and how its answer reads); its guide says how." },
      watch: { type: "array", description: "publish, a dashboard or an app for a project's Space: rules over its sources that write a line in the Space's What happened, or a row in its Needs you; its guide says how.", items: { type: "object" } },
      actions: { type: "object", description: "publish, a dashboard or an app for a project's Space: buttons on its sources' rows, each by its name (a command or a connection's tool the developer runs from Filament's own sheet); its guide says how." },
      lanes: { type: "object", description: "publish, a dashboard for a project's Space: a line on each lane whose branch a row of one of its sources names (a pull request and its checks); its guide says how." },
      tasks: { type: "object", description: "publish, a dashboard for a project's Space: a card on the Space's board for each row of one of its sources (an issue); its guide says how." },
      screens: {
        type: "array",
        description: `publish, a design: its screens, left to right, each with its title, size (${Object.keys(SCREEN_SIZES).join(", ")}) and html.`,
        items: {
          type: "object",
          required: ["title", "html"],
          properties: { title: { type: "string" }, size: { type: "string", enum: Object.keys(SCREEN_SIZES) }, height: { type: "integer" }, html: { type: "string" } },
        },
      },
      style: { type: "string", description: "publish, a design: the CSS every screen shares." },
      version: { type: "integer", minimum: 1, description: "read: an older version; the newest when left out." },
      query: { type: "string", description: "list: words a title or description holds." },
      collection: { type: "string", description: "read_db: the collection whose records to give; its collections when left out. write_db: the one to change." },
      set: { type: "array", description: "write_db: records to keep, each a JSON object; one with an id replaces that record whole, one without is added with an id Filament gives it.", items: { type: "object" } },
      update: {
        type: "array",
        description: "write_db: each a record's id with the fields to change; the rest of the record stays.",
        items: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
      delete: { type: "array", description: "write_db: the ids of the records to remove.", items: { type: "string" } },
    },
  },
});

/**
 * Where a call stands: who it is for the versions each has read (`who`: a session, or a helper of it), who a version it
 * publishes is made by — the call aside, which each call names — the folders a folder may be published from, the port
 * Filament listens on now, and the most a folder may hold.
 * `pinned`: what a publish's page names from the library hosts, fetched before the call (`pinnedFor`), kept in its version.
 * `who` null: the developer's own publish (Import app…), which no read of a session's precedes.
 * @typedef {{ who: string | null, by: Omit<import("../../services/artifacts.js").Maker, "call">, within: readonly string[], port: number, maxBytes: number,
 *   pinned?: import("../../services/web-pins.js").Pinned | null }} ArtifactAt
 * @typedef {{ type: "artifact", name: string, v: number, title: string, address: string }} ArtifactEvent  the live event a
 *   publish is said by, which the page follows (step 2)
 */

/**
 * Whether a run is offered the tool (AF-D3): in a session the harness draws, its own agent — a team's lead in its seat
 * among them — and an agent it sends or asks by its tag (a PM's notes, a Designer's mocks: OA1); never an agent that
 * started by itself (`self`): nobody asked it for a thing to keep.
 * @param {{ composed: boolean, host: { self?: boolean } | null }} o
 */
export const artifactsMakeHere = ({ composed, host }) => composed && (!host || !host.self);

/** A type with its article: "a page", "an app". @param {string} type */
const typeArticle = (type) => `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;
/** A size in the agent's words. @param {number} bytes */
const sizeWords = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`);
/** A moment as the agent reads it. @param {number} ms */
const when = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
/** A folder as two sessions' folders are compared. @param {string} f */
const folderKey = (f) => String(f || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** An artifact's name from the id an agent gives: its name, or its address. @param {unknown} id */
function nameOf(id) {
  const s = typeof id === "string" ? id.trim() : "";
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      return artifactNameOfHost(new URL(s).hostname) || "";
    } catch {
      return "";
    }
  }
  return s.toLowerCase().replace(/\.art\.localhost.*$/, "");
}

/**
 * One call of the artifact tool, answered in words the agent acts on; a refusal is the call's error. A publish that
 * kept a version says so on the run (`event`), and the version names the call (`call`: its id, where it is known).
 * @param {any} input @param {ArtifactAt} at @param {import("../../services/artifacts.js").ArtifactStore} store
 * @param {string | null} [call]
 * @returns {{ ok: true, text: string, event?: ArtifactEvent } | { ok: false, error: string }}
 */
export function artifactCall(input, at, store, call = null) {
  const action = typeof input?.action === "string" ? input.action.trim().toLowerCase() : "";
  if (!ARTIFACT_ACTIONS.includes(action)) return { ok: false, error: `artifact takes an action: ${ARTIFACT_ACTIONS.join(", ")}${action ? `; ${action} is none of them` : ""}.` };
  if (action === "guide") return guideOf(input?.type);
  if (action === "list") return { ok: true, text: listWords(store, at, typeof input?.query === "string" ? input.query : "") };
  if (action === "read") {
    const name = nameOf(input?.id);
    if (!name) return { ok: false, error: "read needs id: the artifact's name, as list gives it, or its address." };
    const a = store.get(name);
    if (!a) return { ok: false, error: `There is no artifact named ${name}: list shows them.` };
    const newest = a.versions.length;
    const v = input?.version == null ? newest : Number(input.version);
    if (!Number.isInteger(v) || v < 1 || v > newest) return { ok: false, error: `${a.title} has no version ${input.version}: it has 1 to ${newest}.` };
    if (at.who) store.seen(name, at.who);
    return { ok: true, text: readWords(store, a, v, at) };
  }
  if (action === "read_db" || action === "write_db") {
    const name = nameOf(input?.id);
    if (!name) return { ok: false, error: `${action} needs id: the artifact's name, as list gives it, or its address.` };
    const a = store.get(name);
    if (!a) return { ok: false, error: `There is no artifact named ${name}: list shows them.` };
    return action === "read_db" ? readDb(store, a, input?.collection) : writeDb(store, a, input);
  }
  return publish(input, at, store, call);
}

/**
 * An app's folder in a project published by the developer as a draft of its Space, with no chat (Import app…, the
 * Space Apps plan of 10-29): as an agent publishes a folder — its app.json read, its page's files checked —, its version
 * made by no session, its `project` that Space's. Nothing of it runs until it is kept.
 * @param {{ store: import("../../services/artifacts.js").ArtifactStore, folder: string, cwd: string, project: string, maxBytes: number, port: number }} o
 *   `folder`: from the project's top (`.filament/apps/pipeline`)
 * @returns {{ ok: true, name: string, v: number, title: string } | { ok: false, error: string }}
 */
export function publishFolderApp({ store, folder, cwd, project, maxBytes, port }) {
  // The copies of the web its download carried, kept by its import: its draft draws offline as its download did.
  const pinned = keptWebIn(join(cwd, ...folder.split("/")), maxBytes);
  const r = artifactCall({ action: "publish", type: "app", folder }, { who: null, by: { chain: null, model: "", folder: cwd, helper: null, project }, within: [cwd], port, maxBytes, pinned }, store);
  if (!r.ok) return r;
  if (!r.event) return { ok: false, error: "Not published: Filament kept no version" };
  return { ok: true, name: r.event.name, v: r.event.v, title: r.event.title };
}

/** Each store's fetcher of what its pages name from the web, by the folder it keeps fetched files in. @type {Map<string, import("../../services/web-pins.js").WebPins>} */
const webPins = new Map();

/**
 * Vendor on publish (the Space Apps plan of 10-29): what a publish's page — its html and files, or its folder — names
 * on the library hosts, fetched before the call is answered, for the version to keep (`ArtifactAt.pinned`); fetched
 * files are kept beside the store, so a later version, or one published with no network, keeps the same bytes. Null for
 * any other call, a typed artifact's, and a page that names none. `signal`: the turn's stop, which ends the fetching.
 * @param {any} input @param {ArtifactAt} at @param {import("../../services/artifacts.js").ArtifactStore} store @param {AbortSignal | null} [signal]
 * @returns {Promise<import("../../services/web-pins.js").Pinned | null>}
 */
export async function pinnedFor(input, at, store, signal = null) {
  if (String(input?.action ?? "").trim().toLowerCase() !== "publish") return null;
  /** @type {string[]} */
  const texts = [];
  if (typeof input?.html === "string") texts.push(input.html);
  if (Array.isArray(input?.files)) for (const f of input.files) if (typeof f?.content === "string" && PINNED_TEXT.test(String(f?.path || ""))) texts.push(f.content);
  if (typeof input?.folder === "string" && input.folder.trim()) {
    const r = readFolder(input.folder.trim(), { within: at.within, maxBytes: at.maxBytes });
    if (r.ok) for (const f of r.files) if (PINNED_TEXT.test(f.path)) texts.push(f.data.toString("utf8"));
  }
  const addresses = [...new Set(texts.flatMap(webAddressesIn))];
  if (!addresses.length) return null;
  const dir = join(dirname(store.dir), "web-pins");
  let pins = webPins.get(dir);
  if (!pins) webPins.set(dir, (pins = createWebPins({ dir })));
  return pins.pin(addresses, { texts, signal });
}

/**
 * A page's files with what it names from the web kept beside them (`pinnedFor`): each fetched file under
 * `_filament/web/`, and `pins.json`, each address the page's files name and the file kept for it — the page's own
 * files as written. `kept`: the addresses kept; `failed`: those its files name that were not, and why.
 * @param {import("../../services/artifacts.js").FileIn[]} files @param {import("../../services/web-pins.js").Pinned} pinned
 */
function keptFromWeb(files, pinned) {
  const named = new Set(files.filter((f) => PINNED_TEXT.test(f.path)).flatMap((f) => webAddressesIn(Buffer.from(f.data).toString("utf8"))));
  const pins = Object.fromEntries(Object.entries(pinned.pins).filter(([a]) => named.has(a)));
  const failed = pinned.failed;
  if (!Object.keys(pins).length) return { files, kept: [], bytes: 0, count: 0, failed };
  const web = pinned.files;
  return {
    files: [...files, ...web, { path: PINS_FILE, data: Buffer.from(`${JSON.stringify({ pins }, null, 2)}\n`, "utf8") }],
    kept: Object.keys(pins),
    bytes: web.reduce((n, f) => n + f.data.length, 0),
    count: web.length,
    failed,
  };
}

/** An address kept from the web as the agent reads it: its file and host. @param {string} address */
const webWords = (address) => {
  try {
    const u = new URL(address.replace(/&amp;/g, "&"));
    const last = u.pathname.split("/").filter(Boolean).at(-1) || u.pathname;
    return `${last}${u.search ? "?…" : ""} (${u.host})`;
  } catch {
    return address;
  }
};
/** Some of a list in words, with how many more. @param {string[]} items @param {number} n */
const someOf = (items, n) => (items.length <= n ? items.join(", ") : `${items.slice(0, n).join(", ")} and ${items.length - n} more`);

/** A collection's records as the agent reads them: one JSON object a line, in the order kept. @param {unknown[]} records */
const recordLines = (records) => records.map((r) => JSON.stringify(r)).join("\n");
/** How many records, in words. @param {number} n */
const recordsWord = (n) => `${n.toLocaleString("en-US")} record${n === 1 ? "" : "s"}`;

/**
 * What a page keeps, in words (AFC-94): its collections with their counts, or one collection's records whole.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 * @param {unknown} collection @returns {ReturnType<typeof artifactCall>}
 */
function readDb(store, a, collection) {
  if (collection === undefined || collection === null || collection === "") {
    const r = store.data.collections(a.name);
    if (!r.ok) return { ok: false, error: `${a.title}'s data could not be read: ${r.error}.` };
    if (!r.collections.length) return { ok: true, text: `${a.title} (${a.name}) keeps no data yet: its page keeps records with filament.db, and write_db adds them.` };
    return { ok: true, text: `${a.title} (${a.name}) keeps ${dataWords(r.collections)}. Give collection to read one's records.` };
  }
  const r = store.data.list(a.name, collection);
  if (!r.ok) return { ok: false, error: `${r.error}.` };
  if (!r.records.length) return { ok: true, text: `${r.collection} in ${a.title} holds no records.` };
  return { ok: true, text: `${r.collection} in ${a.title}: ${recordsWord(r.records.length)}, in the order kept, one a line:\n${recordLines(r.records)}` };
}

/** Collections in words: each with its count, or that it could not be read. @param {({ name: string, count: number } | { name: string, error: string })[]} cs */
const dataWords = (cs) =>
  `${cs.length} collection${cs.length === 1 ? "" : "s"}: ${cs.map((c) => ("count" in c ? `${c.name} (${recordsWord(c.count)})` : `${c.name} (could not be read)`)).join(", ")}`;

/**
 * A change to what a page keeps (AFC-95): its sets, updates and deletes in one collection, all or nothing; every page
 * that follows its data hears it.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 * @param {any} input @returns {ReturnType<typeof artifactCall>}
 */
function writeDb(store, a, input) {
  if (input?.collection === undefined || input.collection === null || input.collection === "") return { ok: false, error: "write_db needs collection: the one to change (expenses)." };
  /** @type {import("../../services/artifact-data.js").DataChange} */
  const change = {};
  for (const k of /** @type {const} */ (["set", "update", "delete"])) {
    const v = input?.[k];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) return { ok: false, error: `Nothing was kept: ${k} is a list${k === "delete" ? " of ids" : " of records"}.` };
    change[k] = v;
  }
  if (!change.set?.length && !change.update?.length && !change.delete?.length) return { ok: false, error: "Nothing was kept: write_db needs set, update or delete." };
  const r = store.data.change(a.name, input.collection, change, "agent");
  if (!r.ok) return { ok: false, error: `${r.error}.` };
  const d = r.done;
  const parts = [
    d.set.length ? `set ${recordsWord(d.set.length)} (${d.set.map((x) => JSON.stringify(x.id)).join(", ")})` : "",
    d.updated.length ? `updated ${d.updated.map((x) => JSON.stringify(x.id)).join(", ")}` : "",
    d.deleted.length ? `deleted ${d.deleted.map((x) => JSON.stringify(x)).join(", ")}` : "",
  ].filter(Boolean);
  const missing = d.missing.length ? ` ${d.missing.map((x) => JSON.stringify(x)).join(", ")} to delete ${d.missing.length === 1 ? "was" : "were"} not there.` : "";
  return { ok: true, text: `Kept in ${r.collection} of ${a.title}: ${parts.length ? parts.join("; ") : "nothing changed"}.${missing} Its page shows it at its next read, and at once where it follows changes.` };
}

/**
 * @param {any} given  the call as made; a folder's app.json fills what it leaves out
 * @param {ArtifactAt} at @param {import("../../services/artifacts.js").ArtifactStore} store
 * @param {string | null} call @returns {ReturnType<typeof artifactCall>}
 */
function publish(given, at, store, call) {
  const name = given?.id == null || given.id === "" ? "" : nameOf(given.id);
  if (given?.id != null && given.id !== "" && !name) return { ok: false, error: "Not published: id is an artifact's name, as list gives it (expense-tracker-k3f9), or its address." };
  // A folder is read once; an app's says the app in its app.json (10-29), which fills what the call leaves out.
  const read = typeof given?.folder === "string" && given.folder.trim() ? readFolder(given.folder.trim(), { within: at.within, maxBytes: at.maxBytes }) : null;
  const declared = declaredIn(given, read, name ? store.get(name) : null);
  if (!declared.ok) return declared;
  const input = declared.input;
  const title = typeof input?.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  if (!name && !title) return { ok: false, error: "Not published: a new artifact needs a title — two to four words, sentence case, such as Expense tracker." };
  if (title.length > ARTIFACT_TITLE_MAX) return { ok: false, error: `Not published: the title is ${title.length} characters; a title is two to four words (${ARTIFACT_TITLE_MAX} characters at most). Say the rest in the description.` };
  const description = typeof input?.description === "string" ? input.description.trim().replace(/\s+/g, " ") : undefined;
  if (description && description.length > ARTIFACT_DESCRIPTION_MAX) return { ok: false, error: `Not published: the description is ${description.length} characters; it is one line (${ARTIFACT_DESCRIPTION_MAX} at most).` };
  const asked = typeof input?.type === "string" && input.type.trim() ? input.type.trim().toLowerCase() : "";
  if (asked && !ARTIFACT_TYPES.includes(asked)) return { ok: false, error: `Not published: Filament makes these types: ${ARTIFACT_TYPES.join(", ")}.` };
  // A next version keeps its type (AFC-108): what it is made of — a page's files, or Markdown — never changes.
  const had = name ? store.get(name) : null;
  if (name && !had)
    return { ok: false, error: `Not published: ${store.broken(name) ? `${name} could not be read from Filament's store, so nothing was published over it` : `there is no artifact named ${name}`}.` };
  if (had && asked && asked !== had.type) return { ok: false, error: `Not published: ${had.title} is ${typeArticle(had.type)}, and a next version keeps its type. Make a new artifact for ${typeArticle(asked)}.` };
  const type = had?.type || asked || "page";
  const iconAsked = typeof input?.icon === "string" ? input.icon.trim().toLowerCase() : "";
  const icon = ARTIFACT_ICONS.includes(iconAsked) ? iconAsked : iconAsked ? "page" : !had && isTyped(type) ? type : "";
  const page = isTyped(type) ? contentOf(input, type) : type === "app" ? appFiles(input, at, read) : pageOf(input, at, "page", read);
  if (!page.ok) return page;
  // What its page names from the library hosts, fetched before this call, is kept in the version (vendor on publish).
  const web = at.pinned && !isTyped(type) ? keptFromWeb(page.files, at.pinned) : null;
  // The folder it came from is kept with the version (Import app…, 10-29): a project's folder's apps are known by it.
  const r = store.publish({ name: name || null, title, ...(description !== undefined ? { description } : {}), icon, type: had ? "" : type, files: web ? web.files : page.files, by: { ...at.by, call, ...(read?.ok ? { dir: read.where } : {}) }, who: at.who });
  if (!r.ok && "stale" in r) {
    const a = r.stale;
    const newest = /** @type {import("../../services/artifacts.js").Version} */ (a.versions.at(-1));
    return {
      ok: false,
      error: `Not published: ${a.title} is at version ${newest.v}, made ${madeBy(newest, at)} at ${when(newest.at)}, which this session has not read. Here it is whole: make your change on it, and publish it with id ${a.name}.\n\n${readWords(store, a, newest.v, at)}`,
    };
  }
  if (!r.ok) return { ok: false, error: `Not published: ${"error" in r ? r.error : "Filament could not keep it"}.` };
  const address = artifactAddress(r.artifact.name, at.port);
  const own = r.version.files.filter((f) => !isWebFile(f.path));
  const bytes = own.reduce((n, f) => n + f.bytes, 0);
  const count = own.length;
  const notes = [
    iconAsked && icon !== iconAsked ? `The icon "${iconAsked}" is not one Filament draws, so it shows the page mark; it draws ${ARTIFACT_ICONS.join(", ")}.` : "",
    page.left.length ? `Left out of ${input.folder}: ${leftWords(page.left)}.` : "",
    page.reads.length ? `It reads Filament's ${readsWords(page.reads)}, and the developer sees on it that it does.` : "",
    web?.kept.length
      ? `Kept in this version from the web, so it draws offline: ${someOf(web.kept.map(webWords), 4)} — ${web.count} file${web.count === 1 ? "" : "s"}, ${sizeWords(web.bytes)}; its files keep naming them as you wrote them.`
      : "",
    web?.failed.length ? `Not kept, so ${web.failed.length === 1 ? "it loads" : "they load"} from the web: ${someOf(web.failed.map((f) => `${f.address} (${f.why})`), 3)}.` : "",
    web && at.pinned?.late ? `${at.pinned.late} file${at.pinned.late === 1 ? " it names was" : "s it names were"} not fetched in time, so ${at.pinned.late === 1 ? "it loads" : "they load"} from the web.` : "",
  ].filter(Boolean);
  return {
    ok: true,
    text: `Published ${r.artifact.title} v${r.version.v} at ${address} (${count === 1 ? "" : `${count} files, `}${sizeWords(bytes)}). The developer sees it in the chat and can open it; you are told only that it was published.${notes.length ? ` ${notes.join(" ")}` : ""}`,
    event: { type: "artifact", name: r.artifact.name, v: r.version.v, title: r.artifact.title, address },
  };
}

/** @typedef {{ ok: true, files: import("../../services/artifacts.js").FileIn[], left: string[], reads: string[] } | { ok: false, error: string }} Kept */

/** The fields each type is given by. */
const GIVEN_BY = Object.freeze({
  page: ["html", "files", "folder"],
  doc: ["markdown"],
  slides: ["markdown"],
  dashboard: ["tiles", "tables", "sources", "watch", "actions", "lanes", "tasks"],
  design: ["screens", "style"],
  app: ["html", "files", "folder", "sources", "watch", "actions", "howto", "state", "secrets", "hooks", "tools", "glance"],
});
/** Whose each field is, as a refusal names it: the type in words, and its name for `type`. */
const FIELD_OF = Object.freeze({
  // An app is given by them too, and keeps a dashboard's sources and buttons (found by the Hunter on apps).
  html: ["a page or an app of your own HTML", '"page" or "app"'],
  files: ["a page or an app of your own HTML", '"page" or "app"'],
  folder: ["a page or an app of your own HTML", '"page" or "app"'],
  markdown: ["a doc or slides", '"doc" or "slides"'],
  tiles: ["a dashboard", '"dashboard"'],
  tables: ["a dashboard", '"dashboard"'],
  sources: ["a dashboard or an app", '"dashboard" or "app"'],
  watch: ["a dashboard or an app", '"dashboard" or "app"'],
  actions: ["a dashboard or an app", '"dashboard" or "app"'],
  lanes: ["a dashboard", '"dashboard"'],
  tasks: ["a dashboard", '"dashboard"'],
  screens: ["a design", '"design"'],
  style: ["a design", '"design"'],
  howto: ["an app", '"app"'],
  state: ["an app", '"app"'],
  secrets: ["an app", '"app"'],
  hooks: ["an app", '"app"'],
  tools: ["an app", '"app"'],
  glance: ["an app", '"app"'],
});
/** Whether a publish gives a field: an empty text, list or object gives nothing. @param {unknown} v */
const gives = (v) =>
  v != null && v !== "" && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && !v.length) && !(Object.prototype.toString.call(v) === "[object Object]" && !Object.keys(/** @type {object} */ (v)).length);
/** A field of another type's that a publish gives, or null. @param {any} input @param {string} type */
const strayField = (input, type) =>
  Object.keys(FIELD_OF).find((k) => !(/** @type {Record<string, readonly string[]>} */ (GIVEN_BY))[type].includes(k) && gives(input?.[k])) || null;
/** Feeds in words: "usage by day and calls now". @param {readonly string[]} names */
const readsWords = (names) => {
  const w = names.map((n) => FEEDS[n].words);
  return w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`;
};

/**
 * The files an App keeps: its page as a page's are (`pageOf`), and its sources, watches and buttons — checked as a
 * Dashboard's — in content.json beside them, which is Filament's: the page has none of its own there.
 * @param {any} input @param {ArtifactAt} at @param {FolderRead | null} [read]  its folder, read already
 * @returns {Kept}
 */
function appFiles(input, at, read = null) {
  const page = pageOf(input, at, "app", read);
  if (!page.ok) return page;
  if (page.files.some((f) => f.path.toLowerCase() === CONTENT_JSON))
    return { ok: false, error: `Not published: ${CONTENT_JSON} beside an app's page is Filament's — its sources, watch and actions, given by those fields. Name the page's own file otherwise.` };
  const app = appOf(input);
  if (!app.ok) return { ok: false, error: `Not published: ${app.error}.` };
  return { ...page, files: [...page.files, { path: CONTENT_JSON, data: Buffer.from(`${JSON.stringify(app.content, null, 2)}\n`, "utf8") }] };
}

/**
 * The files a publish keeps: the page by `html` with `files` beside it, or a project's folder by `folder` (AFC-6), each
 * path checked (AFC-57), or what is wrong, in words. `type`: an App's page is given the same way — its folder's
 * app.json not among its files, as Filament reads it (`declaredIn`). `.ts` files have their types taken out (`typesOut`).
 * @param {any} input @param {ArtifactAt} at @param {"page" | "app"} [type] @param {FolderRead | null} [read]  its folder, read already
 * @returns {Kept}
 */
function pageOf(input, at, type = "page", read = null) {
  const stray = strayField(input, type);
  if (stray) {
    const [whose, named] = FIELD_OF[/** @type {keyof typeof FIELD_OF} */ (stray)];
    return { ok: false, error: `Not published: ${type === "app" ? "an app is given by its page — html or folder — with sources, watch and actions" : "a page is given by html or folder"}; ${stray} is for ${whose} — a new one names its type (${named}).` };
  }
  const html = typeof input?.html === "string" ? input.html : null;
  const folder = typeof input?.folder === "string" && input.folder.trim() ? input.folder.trim() : null;
  if (html != null && folder) return { ok: false, error: "Not published: give the page by html or by folder, not both." };
  if (folder) {
    if (Array.isArray(input?.files) && input.files.length) return { ok: false, error: "Not published: a folder brings its own files; leave files out, or publish by html with them." };
    const f = read || readFolder(folder, { within: at.within, maxBytes: at.maxBytes });
    if (!f.ok) return { ok: false, error: `Not published: ${f.error}.` };
    return typesOut({ ok: true, files: type === "app" ? f.files.filter((x) => x.path !== APP_JSON) : f.files, left: f.left, reads: [] });
  }
  if (html == null || !html.trim()) return { ok: false, error: "Not published: the page is empty. Give html — a whole HTML document, or what goes inside its <body> — or a folder whose index.html is the page." };
  /** @type {import("../../services/artifacts.js").FileIn[]} */
  const files = [{ path: PAGE_FILE, data: Buffer.from(html, "utf8") }];
  const given = input?.files == null ? [] : input.files;
  if (!Array.isArray(given)) return { ok: false, error: "Not published: files is a list of { path, content }." };
  for (const f of given) {
    const p = artifactPath(f?.path);
    if (!p.ok) return { ok: false, error: `Not published: ${p.error}.` };
    if (typeof f?.content !== "string") return { ok: false, error: `Not published: ${p.path} has no content: each file is { path, content } with its text.` };
    if (files.some((x) => x.path.toLowerCase() === p.path.toLowerCase()))
      return { ok: false, error: `Not published: ${p.path} is given twice${p.path.toLowerCase() === PAGE_FILE ? ` (${PAGE_FILE} is the page itself, given by html)` : ""}.` };
    files.push({ path: p.path, data: Buffer.from(f.content, "utf8") });
  }
  return typesOut({ ok: true, files, left: [], reads: [] });
}

/** A file whose types Filament takes out, and one of declarations alone, which runs nowhere and is kept as written. */
const TS_FILE = /\.m?ts$/i;
const DECLARATIONS_FILE = /\.d\.m?ts$/i;
/** What an app's app.json may say, as the call gives it. */
const APP_JSON_FIELDS = Object.freeze(["title", "description", "icon", "sources", "watch", "actions", "howto", "state", "secrets", "hooks", "tools", "glance"]);
/** The keys app.json is, in words. */
const APP_JSON_WORDS = '{ "title", "sources", "watch", "actions" }';

/** @typedef {ReturnType<typeof readFolder>} FolderRead */

/**
 * An app's folder says the app in its app.json (the Space Apps plan of 10-29, "app folders"): Filament reads it, and its
 * title, description, icon, sources, watch and actions fill what the call leaves out — the call's own win, and its
 * folder is the call's. A folder published as another type keeps its app.json as a file of it, and so does one with no
 * type asked whose app.json names none of an app's parts (another tool's).
 * @param {any} input @param {FolderRead | null} read @param {{ type: string } | null} had  the artifact a next version is of
 * @returns {{ ok: true, input: any } | { ok: false, error: string }}
 */
function declaredIn(input, read, had) {
  const file = read?.ok ? read.files.find((f) => f.path === APP_JSON) : undefined;
  if (!file) return { ok: true, input };
  const asked = typeof input?.type === "string" && input.type.trim() ? input.type.trim().toLowerCase() : "";
  if ((had?.type || asked || "app") !== "app") return { ok: true, input };
  const where = `${String(input.folder).trim().replace(/[\\/]+$/, "")}/${APP_JSON}`;
  /** @type {any} */
  let said;
  try {
    said = JSON.parse(file.data.toString("utf8"));
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `Not published: ${where} does not read as JSON (${e?.message || e}). It says the app: ${APP_JSON_WORDS}.` };
  }
  if (!said || typeof said !== "object" || Array.isArray(said))
    return { ok: false, error: `Not published: ${where} is ${Array.isArray(said) ? "a list" : said === null ? "null" : `a ${typeof said}`}; it is one object: ${APP_JSON_WORDS}.` };
  // With no type asked, an app.json is Filament's only where it names an app's parts: a Heroku or Expo project's is a
  // file of its page.
  if (!had && !asked && said.type !== "app" && !APP_JSON_KEYS.some((k) => said[k] != null)) return { ok: true, input };
  const out = { ...input, ...(had || asked ? {} : { type: "app" }) };
  for (const k of APP_JSON_FIELDS) if (out[k] == null && said[k] != null) out[k] = said[k];
  return { ok: true, input: out };
}

/**
 * TypeScript at publish (the Space Apps plan of 10-29: no build step): each .ts or .mts file of a page or an app kept
 * under its own name with its types taken out — Node's own stripping, each line where it was, nothing shipped for it —,
 * so the browser runs it and its imports keep working. TypeScript that is more than types is refused, in words, and so
 * is a type imported as a value, which the browser would not find. A .ts that is no text is a video's segment, kept.
 * @param {Kept & { ok: true }} kept @returns {Kept}
 */
function typesOut(kept) {
  /** @type {import("../../services/artifacts.js").FileIn[]} */
  const files = [];
  /** Each TypeScript file as written and as run, by its path. @type {Map<string, { text: string, js: string }>} */
  const ts = new Map();
  for (const f of kept.files) {
    if (!TS_FILE.test(f.path) || DECLARATIONS_FILE.test(f.path) || !isTextData(f.data)) {
      files.push(f);
      continue;
    }
    const text = Buffer.from(f.data).toString("utf8");
    try {
      const js = stripTypeScriptTypes(text, { mode: "strip" });
      ts.set(f.path, { text, js });
      files.push({ ...f, data: Buffer.from(js, "utf8") });
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `Not published: ${f.path} is TypeScript Filament cannot run by taking its types out (${String(e?.message || e).split("\n")[0]}). Write it with types alone — no enum, namespace or JSX —, or publish its built .js.` };
    }
  }
  const typed = typeImportedIn(ts);
  if (typed) return { ok: false, error: `Not published: ${typed}.` };
  return { ...kept, files };
}

/** A script with its comments taken out, near enough to find its imports: `//` after a `:` is an address's. @param {string} js */
const uncommented = (js) => js.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
/** An identifier as a pattern. @param {string} name */
const nameSource = (name) => name.replace(/\$/g, "\\$");
/** A value import of names from a file beside it: `import { a, b as c } from "./x.ts"`, with a default before them or none. */
const NAMED_IMPORT = /\bimport\s*([\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])(\.{1,2}\/[^"'\n]+)\3/g;

/**
 * A type one TypeScript file of a publish imports from another as a value — left in by the stripping, so the browser
 * throws that the other does not export it —, in words that say the fix; or null. Conservative: a name is a type only
 * where its file exports it as an interface or a type and names it nowhere once its types are out.
 * @param {Map<string, { text: string, js: string }>} ts @returns {string | null}
 */
function typeImportedIn(ts) {
  for (const [path, { js }] of ts) {
    for (const m of uncommented(js).matchAll(NAMED_IMPORT)) {
      const to = posix.normalize(posix.join(posix.dirname(path), m[4]));
      const target = ts.get(to);
      if (!target) continue;
      const names = m[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter((s) => /^[\w$]+$/.test(s));
      const run = uncommented(target.js);
      const types = names.filter(
        (n) => new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:interface|type)\\s+${nameSource(n)}(?![\\w$])`).test(target.text) && !new RegExp(`(?<![\\w$])${nameSource(n)}(?![\\w$])`).test(run),
      );
      if (!types.length) continue;
      const fix = types.length === names.length && !m[1] ? `\`import type { ${types.join(", ")} }\`` : `${types.map((n) => `\`type ${n}\``).join(" and ")} in its braces`;
      return `${path} imports ${types.join(" and ")} from ${m[4]}, which ${types.length === 1 ? "is a type" : "are types"}: write ${fix}`;
    }
  }
  return null;
}

/** How each typed artifact is said in a refusal: what it is, and what it is given by. */
const TYPED_WORDS = Object.freeze({
  doc: { is: "a doc is", needs: "a doc needs", by: "markdown" },
  slides: { is: "slides are", needs: "slides need", by: "markdown" },
  dashboard: { is: "a dashboard is", needs: "a dashboard needs", by: "tiles and tables" },
  design: { is: "a design is", needs: "a design needs", by: "screens and style" },
});

/**
 * The file a typed artifact keeps (AFC-106, AFC-107, AFC-124, AFC-139): a Doc's or a deck's Markdown, whole; a
 * Dashboard's tiles and tables, or a Design's style and screens, as JSON — each checked, or what is wrong, in words. The
 * page that draws it is Filament's own, so another type's fields are refused. `reads`: the feeds a Dashboard names.
 * @param {any} input @param {string} type  doc, slides, dashboard or design
 * @returns {Kept}
 */
function contentOf(input, type) {
  const it = TYPED_WORDS[/** @type {keyof typeof TYPED_WORDS} */ (type)];
  const stray = strayField(input, type);
  if (stray) {
    const [whose, named] = FIELD_OF[/** @type {keyof typeof FIELD_OF} */ (stray)];
    return { ok: false, error: `Not published: ${it.is} given by ${it.by} alone — Filament draws the page — so leave ${stray} out. ${whose[0].toUpperCase()}${whose.slice(1)} is type ${named}.` };
  }
  /** @param {unknown} content */
  const json = (content) => [{ path: CONTENT_JSON, data: Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8") }];
  if (type === "dashboard") {
    const d = dashboardOf(input);
    return d.ok ? { ok: true, files: json(d.content), left: [], reads: d.reads } : { ok: false, error: `Not published: ${d.error}.` };
  }
  if (type === "design") {
    const d = designOf(input);
    return d.ok ? { ok: true, files: json(d.content), left: [], reads: [] } : { ok: false, error: `Not published: ${d.error}.` };
  }
  const markdown = typeof input?.markdown === "string" ? input.markdown : "";
  if (!markdown.trim()) return { ok: false, error: `Not published: ${it.needs} markdown — the whole of it, in Markdown.` };
  return { ok: true, files: [{ path: CONTENT_FILE, data: Buffer.from(markdown, "utf8") }], left: [], reads: [] };
}

/**
 * Who made a version, as the agent reads it: a session's agent, this one or another — or the developer, who made an
 * old version the newest again (AFC-79), kept a visual as an artifact (AFC-101) or edited a Doc's or a deck's
 * Markdown (AFC-120).
 * @param {import("../../services/artifacts.js").Version} v @param {ArtifactAt} at
 */
const madeBy = (v, at) => {
  const here = v.by.chain && v.by.chain === at.by.chain ? "this session" : "another session";
  if (v.by.from !== undefined) return `by the developer, who made version ${v.by.from} the newest again,`;
  if (v.by.edited !== undefined) return `by the developer, who edited version ${v.by.edited} in Filament,`;
  if (v.by.visual) return `by the developer, from a visual drawn in ${here},`;
  return `by ${v.by.model || "an agent"}${v.by.helper ? `, a helper (${v.by.helper}),` : ""} in ${here}`;
};

/**
 * What `read` says of a page's data (AF-D17): its collections with their counts.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 */
function dataLine(store, a) {
  const r = store.data.collections(a.name);
  if (!r.ok) return `could not be read (${r.error})`;
  return r.collections.length ? `${dataWords(r.collections)}; read_db reads them` : "none kept yet";
}

/**
 * What `read` says of what an artifact is made of (AF-D17): a page's data; a typed one's content and how its next
 * version is given — and which of Filament's numbers a Dashboard reads (AF-D12).
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 * @param {number} v
 */
function contentLines(store, a, v) {
  if (a.type === "app") {
    /** @type {any} */
    let content = null;
    try {
      content = JSON.parse(String(store.file(a.name, v, CONTENT_JSON) || ""));
    } catch {
      // A content that does not read is shown as it is, below.
    }
    const own = Object.keys(content?.sources || {});
    return [
      `Content: its page and files, below, and its sources, watch and actions in ${CONTENT_JSON}, Filament's; publish the next version whole by its page (html or folder) with sources, watch and actions.`,
      `Reads: ${own.length ? `by itself once kept in its project's Space, its sources ${own.join(", ")}` : "nothing by itself"}`,
      `Data: ${dataLine(store, a)}`,
    ];
  }
  if (!isTyped(a.type)) return [`Data: ${dataLine(store, a)}`];
  if (isEditable(a.type)) return [`Content: its Markdown, ${CONTENT_FILE} below, which Filament draws; publish the next version whole by markdown.`];
  if (a.type === "design") return ["Content: its style and screens, below, which Filament lays on a canvas; publish the next version whole by style and screens."];
  let reads = [];
  /** @type {any} */
  let content = null;
  try {
    content = JSON.parse(String(store.file(a.name, v, CONTENT_JSON) || ""));
    reads = feedsOf(content);
  } catch {
    // A content that does not read is shown as it is, below.
  }
  const own = content?.sources && typeof content.sources === "object" ? Object.keys(content.sources) : [];
  const buttons = content?.actions && typeof content.actions === "object" ? Object.keys(content.actions) : [];
  // What it feeds into its Space (S4c), named so the next version keeps it.
  const fed = ["lanes", "tasks"].filter((k) => content?.[k] != null);
  const fedWords = fed.length ? `, ${fed.join(" and ")}` : "";
  return [
    `Content: its tiles and tables${own.length ? `, sources${buttons.length ? ", watches and buttons" : " and watches"}` : ""}${fedWords}, ${CONTENT_JSON} below, which Filament draws; publish the next version whole by tiles and tables${own.length ? `, sources${buttons.length ? ", watch and actions" : " and watch"}` : ""}${fedWords}.`,
    `Reads: ${reads.length ? `Filament's ${readsWords(reads)}` : "none of Filament's numbers"}${own.length ? `; by itself once kept in its project's Space, its sources ${own.join(", ")}` : ""}`,
  ];
}

/**
 * A Design as `read` gives it (AFC-142): the style its screens share, then each screen's HTML in turn, with its title and
 * size — what its next version is given by. Null where its content does not read: its file is shown as it is.
 * @param {Buffer | null} data
 */
function designBody(data) {
  /** @type {import("../../core/artifact-content.js").DesignContent} */
  let d;
  try {
    d = JSON.parse(String(data || ""));
  } catch {
    return null;
  }
  if (!Array.isArray(d?.screens)) return null;
  const chars = (/** @type {string} */ s) => `${s.length.toLocaleString("en-US")} characters`;
  const style = typeof d.style === "string" ? d.style : "";
  return [
    `--- style (the CSS every screen shares; ${chars(style)}) ---\n${style}`,
    ...d.screens.map((s, i) => `--- screen ${i + 1}: ${s.title} (${screenWords(s)}; ${chars(String(s.html))}) ---\n${s.html}`),
  ].join("\n\n");
}

/**
 * An artifact as `read` gives it (AF-D17): what it is, where, what its page keeps, and the version asked for whole —
 * its page and each text file beside it, any other file by its size; a Design, its style and its screens.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 * @param {number} v @param {ArtifactAt} at
 */
function readWords(store, a, v, at) {
  const newest = a.versions.length;
  const version = /** @type {import("../../services/artifacts.js").Version} */ (a.versions[v - 1]);
  const head = [
    `${a.title} — ${a.name}, ${typeArticle(a.type)}, version ${v} of ${newest}${v === newest ? " (the newest)" : ""}, made ${madeBy(version, at)} at ${when(version.at)}.`,
    `Address: ${artifactAddress(a.name, at.port)}${v === newest ? "" : ` (this version: ${artifactAddress(a.name, at.port)}_filament/v/${v}/)`}`,
    `Description: ${a.description || "none"}`,
    `Icon: ${a.icon}`,
    ...contentLines(store, a, v),
  ];
  const design = a.type === "design" ? designBody(store.file(a.name, v, CONTENT_JSON)) : null;
  if (design) return `${head.join("\n")}\n\n${design}`;
  // What it keeps from the web is Filament's, fetched as it was published: said in a line, never as its files.
  const web = version.files.filter((f) => isWebFile(f.path) && f.path !== PINS_FILE);
  if (web.length)
    head.push(
      `Kept from the web as it was published: ${web.length} file${web.length === 1 ? "" : "s"}, ${sizeWords(web.reduce((n, f) => n + f.bytes, 0))}, for the library addresses its files name, which it loads from here, offline too. Keep writing those addresses in its files; a next version fetches what they name anew.`,
    );
  const body = version.files.filter((f) => !isWebFile(f.path)).map((f) => {
    const data = isTextFile(f.path) ? store.file(a.name, v, f.path) : null;
    if (!isTextFile(f.path) || (data && !isTextData(data))) return `--- ${f.path} (${sizeWords(f.bytes)}; not text, kept as it is) ---`;
    const text = data ? data.toString("utf8") : "";
    return `--- ${f.path} (${text.length.toLocaleString("en-US")} characters) ---\n${text}`;
  });
  return `${head.join("\n")}\n\n${body.join("\n\n")}`;
}

/**
 * The artifacts as `list` gives them (AFC-53): those made in this session's project first, then the rest, each the
 * most recently changed first — its title, name, type, newest version, when, address and description.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {ArtifactAt} at @param {string} query
 */
function listWords(store, at, query) {
  const q = query.trim().toLowerCase();
  const all = store.list().filter((a) => !q || `${a.title}\n${a.description}\n${a.name}`.toLowerCase().includes(q));
  if (!all.length) return q ? `No artifact's title or description holds "${query.trim()}".` : "No artifacts yet.";
  const here = folderKey(at.by.folder);
  const line = (/** @type {import("../../services/artifacts.js").Artifact} */ a) =>
    `- ${a.title} (${a.name}): ${typeArticle(a.type)}, v${a.versions.length}, changed ${when(a.updatedAt)} — ${artifactAddress(a.name, at.port)}${a.description ? `\n  ${a.description}` : ""}`;
  const mine = here ? all.filter((a) => folderKey(a.versions[0]?.by.folder || "") === here) : [];
  const rest = all.filter((a) => !mine.includes(a));
  const parts = [`${all.length} artifact${all.length === 1 ? "" : "s"}${q ? ` holding "${query.trim()}"` : ""}.`];
  if (mine.length) parts.push(`Made in this project (${at.by.folder}):\n${mine.map(line).join("\n")}`);
  if (rest.length) parts.push(`${mine.length ? "Elsewhere" : "Made in other projects"}:\n${rest.map(line).join("\n")}`);
  return parts.join("\n\n");
}

/** A guide call: the rules for a type. @param {unknown} type @returns {ReturnType<typeof artifactCall>} */
function guideOf(type) {
  const t = typeof type === "string" && type.trim() ? type.trim().toLowerCase() : "page";
  if (!ARTIFACT_TYPES.includes(t)) return { ok: false, error: `artifact's guide has a part for ${ARTIFACT_TYPES.join(", ")}; ${t} is none of them.` };
  return { ok: true, text: ARTIFACT_GUIDE[/** @type {keyof typeof ARTIFACT_GUIDE} */ (t)] };
}

/** The library hosts by their names, as a guide gives them. */
const HOST_NAMES = VISUAL_HOSTS.map((h) => h.replace("https://", "")).join(", ");

/** What a Doc and a deck share in their guides: the Markdown Filament draws (AF-D11). */
const MARKDOWN_RULES = `- Paragraphs, lists (\`-\`, \`1.\`), task lists (\`- [ ]\`, \`- [x]\`), tables, quotes (\`>\`), **bold**, *italic*, ~~struck~~, \`code\`, and code fences with their language (\`\`\`js).
- A diagram is a mermaid fence (\`\`\`mermaid), drawn in the harness's colors: a flowchart, sequence, class, state, gantt, pie, mindmap or timeline. Keep each one small, its labels short.
- A link to a site opens in a new browser tab. A picture loads only by an https address on ${HOST_NAMES}, or as data: none other loads, so say it in words instead.
- HTML is shown as text and never runs: write Markdown alone.`;

/** What each of Filament's numbers is, as a Dashboard's guide says it (AF-D12). */
const FEED_SAYS = Object.freeze({
  "usage-by-day": "the model calls made through Filament, a row a day, the oldest first, a day without calls a row of zeros",
  "usage-by-model": "the same calls over the same days, a row for each model and the upstream it went to",
  "usage-by-minute": "the last hour, a row a minute, the oldest first",
  "calls-now": "the calls in flight at this moment, a row each: waiting for its first word or writing, for how long, and how fast",
  "sessions-by-day": "the developer's sessions by the day each began, with the turns taken that day",
});
/** Filament's numbers, a line each, as a Dashboard's guide lists them. */
const FEEDS_LIST = FEED_NAMES.map(
  (n) => `- \`${n}\`: ${FEED_SAYS[/** @type {keyof typeof FEED_SAYS} */ (n)]}. Its columns: ${FEEDS[n].columns.map(([c, f]) => `${c} (${f})`).join(", ")}.`,
).join("\n");
/** The sizes a screen may be, in words: "phone (390 × 844)". */
const SIZES_WORDS = Object.entries(SCREEN_SIZES)
  .map(([n, [w, h]]) => `${n} (${w} × ${h}${n === SCREEN_SIZE ? ", when it names none" : ""})`)
  .join(", ");

/** A source's rules, as a Dashboard's guide and an App's give them (S2). */
const SOURCES_RULES = `- \`sources\`, each by its name (letters, digits, - and _): \`{"deploys":{"command":["npx","wrangler","deployments","list","--json"],"key":"id","order":"-when","every":"2m","columns":{"when":"created_on","version":"versions.0.version_id","message":"annotations.workers/message"}}}\`
  - \`command\`: the program and its arguments, a list. No shell runs it: no pipes, no \`&&\`, no \`$VAR\`. It runs in the project's folder with this computer's programs and their sign-ins, for ${COMMAND_MS / 1000} s at most, and may say ${COMMAND_BYTES / 1_048_576} MB at most. It only reads: a command that changes anything is no source.
  - It writes JSON on stdout. \`rows\`: the dotted path to the list in it (\`"data.items"\`; none when the answer is the list). \`columns\`: each column's name and its dotted path in an item (\`"versions.0.version_id"\`); none: each item's own fields. \`key\`: the path that names an item, by which a watch knows a row. \`order\`: a column, with "-" before it for the newest first.
  - Or it writes tab-separated lines: \`fields\` names their columns in order, in place of rows and columns; its \`key\` is one of them.
  - \`tool\` in place of \`command\`: a connection's tool, \`{"connection":"github","name":"list_workflow_runs","args":{"owner":"o","repo":"app"}}\` — the MCP server by its name as the project's chats have it (its tools are yours here too, as mcp__<server>__<tool>), its tool's own name, the args it is called with. Its server must mark it read-only: Filament asks at each read, and a tool it does not say only reads is not called. Its structured content — or else its first text, read as JSON — is what \`rows\` and \`columns\` read.
  - \`fetch\` in place of \`command\`: an address Filament reads, \`{"url":"https://api.github.com/repos/o/app/pulls?state=open","headers":{"authorization":"Bearer {secret.GITHUB_TOKEN}"}}\` — HTTPS, or HTTP on this computer (localhost), within ${COMMAND_MS / 1000} s and ${COMMAND_BYTES / 1_048_576} MB; a redirect is followed on the same host alone. \`{secret.NAME}\` in its path, its query or a header is filled with one of an app's secrets, never in its host. \`as\`: \`"json"\` (the default: \`rows\` and \`columns\` read it), \`"text"\` (a row per line, its one column \`line\`; or tab-separated lines by \`fields\`) or \`"rss"\` (an RSS or Atom feed: a row per item — id, feed, title, link, date, text —, the newest first).
  - \`folder\` in place of \`command\`: a folder of the project listed, read only — \`{"path":"dist","match":"*.exe","depth":1}\`: a row per file or folder, its path from the project's folder, name, kind (file, folder or link), size and modified; \`match\`, a name's pattern; \`depth\`, 1 (its own files) to ${FOLDER_DEPTH_MAX}.
  - \`filament\` in place of \`command\`: Filament's own rows for the project — ${Object.entries(FILAMENT_READS).map(([k, v]) => `\`"${k}"\`, ${v}`).join("; ")}.
  - \`python\` in place of \`command\`: a Python script of the project, run through uv with no project of its own — \`{"script":"reads/report.py","args":["--days","30"],"with":["pandas"]}\`; \`with\`, the packages it runs with, which uv fetches the first time. It writes JSON or tab-separated lines on stdout, as a command does, and gets an app's secrets in its environment.
  - \`every\`: how often it is read while its page is open — "${everyWords(SOURCE_EVERY_MS).replace(" min", "m")}" when it names none, "1m" at least.`;
/** A watch's rule, as both guides give it (S2). */
const WATCH_RULE = `- \`watch\`: rules that write a line in the Space's What happened, or a row in its Needs you, with no AI. \`{"from":"runs","new":true,"match":{"status":"failure"},"says":"CI failed on main: run {row.run}","every":"10m"}\` writes a line for each row not seen before that matches. \`{"from":"deploys","changes":"version","says":"Production now serves {row.version}"}\` writes one when the first row's column moves. \`"to":"needs-you"\` writes each as a row in the Space's Needs you instead, which the developer marks Done: for what asks them to act, not what only happened. \`says\` takes {row.<column>}; \`every\` is how often it looks, "${everyWords(WATCH_EVERY_MS).replace(" min", "m")}" when it names none. Its first look only learns what is there.`;
/** A button, as both guides show one (S3). */
const ACTION_EXAMPLE = `\`{"rollback":{"label":"Roll back to this…","on":"deploys","except":{"traffic":100},"command":["npx","wrangler","rollback","{row.version}","--message","{ask.why}","--yes"],"check":{"row.version":"^[0-9a-f-]{36}$"},"ask":[{"name":"why","label":"Why (goes in the deploy's message)","required":true}],"says":"Roll back app-api to {row.version} ({row.message})? Production serves it at once."}}\``;
/** A button's parts, as both guides give them (S3, S3b, S4a, S5d). */
const ACTION_RULES = `  - \`label\`: the button's words. \`on\`: the source whose rows it acts on, which needs a \`key\`. \`only\` / \`except\`: a column and its value — which rows get it.
  - \`command\`: the program and its arguments, as a source's, in the project's folder; no clock cuts it: it runs until it ends, or the developer stops it. \`{row.<column>}\`, \`{row.key}\` and \`{ask.<field>}\` each fill one part, from the row as Filament read it — a row's words are anyone's, so a value that starts with "-" is refused, and \`check\` gives the pattern a placeholder's value must match: give one for each row value it takes.
  - \`tool\` in place of \`command\`: a connection's tool the button calls, \`{"connection":"github","name":"rerun_failed_jobs","args":{"run_id":"{row.key}"}}\` — any tool of the server, read-only or not; a placeholder is a whole value of \`args\`, never inside one; Filament sends each value as the tool's schema takes it — a row's key or an answer that reads as a number goes as a number where the tool takes one.
  - \`ask\`: its form, ${ASK_MAX} fields at most, each with \`name\` and \`label\`, \`required\`, and \`choices\` (a list of words) or \`from\` (another source's column, whose values it offers: \`{"source":"branches","column":"name"}\`); none: text. \`says\`: the sheet's sentence, with {row.<column>} and {ask.<field>}.
  - \`secondLook\`: true for a button whose act reaches production or has no easy way back — a deploy, a rollback, a migration, a delete: its sheet offers the developer a second look: the Reviewer, which only reads, starts when they ask for it, on the model they choose, and says in five lines what the command would change while they decide. Nothing starts by itself, and it never holds the button back.
  - \`verify\`: for a button whose result is worth a look once it ran, what an agent should look for, a line (${VERIFY_MAX} characters at most) with {row.<column>} for a value: \`"verify":"the deploys list shows {row.version} serving 100% of traffic"\`. The sheet says it beside "Then have an agent check it", which stays off until the developer ticks it: then, after a run that ended without an error, an agent that only reads checks it, on the model they choose, and says whether it worked.
  - \`effect\`: what it does — \`"writes"\` (the default: it changes files or programs on this machine; Filament's sheet shows what it runs before it runs), \`"keeps"\` (it changes the app's own data alone — a note, a mark — and runs as it is pressed, with no sheet, so no \`ask\`, \`secondLook\` or \`verify\`), or \`"sends"\` (it leaves this machine — a post, a mail, a deploy, a payment: an agent's press of it always asks the developer, unless they let agents press that button). Say it truly: the Keep sheet lists each button under what it does.`;

/**
 * Filament's guide for each type (AF-D11, AF-D17): its own words, in the harness's look — a quiet macOS app — whose look
 * part is the one visuals have (AF-D15).
 */
export const ARTIFACT_GUIDE = Object.freeze({
  page: `# Making an artifact in Filament: a page

An artifact is a page you make that lives outside the chat. The developer's Artifacts list keeps it, it has an address of its own on this machine, and every publish is a new version. They open it beside the chat, full size, or in their browser while Filament runs, and come back to it next week.

Make one for something they keep and use again: a tracker, a calculator, a report, a reference, a small tool. A picture that belongs to one answer is a visual (show_visual), not an artifact.

## The page
- One HTML page: a whole document (\`<!doctype html>\`, \`<head>\`, \`<body>\`), or what goes inside \`<body>\`, which Filament wraps in one with your title.
- Files beside it go in \`files\` (\`{ path, content }\`: app.js, css/style.css, data.json) and load by relative paths (\`<script src="app.js">\`, \`fetch("data.json")\`), never from \`/\`. A coding agent whose page is a folder in the project publishes it by \`folder\`: its index.html and every file beside it, without hidden files and node_modules.
- Libraries: Filament's shelf is on every page's address and loads with no network — reach for it first, by these paths as written:
${shelfLines().join("\n")}
- Any other library loads at an exact version, by \`<script src>\` or an \`import\`, from ${VISUAL_HOSTS.map((h) => h.replace("https://", "")).join(", ")}. Filament fetches it once as you publish — with what it imports, and a font sheet's fonts — and keeps it in that version, so the page draws offline too; the publish says what it kept, and what it could not, which still loads from the web. Nothing else loads or connects: no fetch, XHR or WebSocket to any site, no image or font from anywhere else. A fetch of the page's own files works.
- Put the data it starts with into its code or a file beside it. No forms that post: handle a form in script. No alert, confirm or prompt.
- It lays out from 320 px wide — a narrow pane beside the chat — to a whole screen: rows that wrap, no width fixed past 320 px, no \`100vh\` that hides what is under it.
- The browser's own storage (\`localStorage\`) is the page's alone, for conveniences that may be lost: a tab chosen, a part folded. The browser keeps the page's storage inside Filament apart from the same page opened in a browser tab, so nothing that must be kept goes there: \`filament.db\` keeps that.
- A link to another site opens in a new browser tab. A file the page makes (a CSV of the month) downloads by a link with \`download\`.
- When something fails — a script's error, a file or library that did not load — Filament shows the developer one line under the page. Where you can, show a plain fallback so the page still says something.

## What it keeps: filament.db
- What the page must keep — the entries of a tracker, a list the developer builds, a setting that matters — goes in \`filament.db\`. Filament keeps it: the same beside the chat, full size and in a browser tab, through a cleared browser and every new version.
- Collections of small JSON records, each a JSON object with an \`id\`. Each call is a promise:
  - \`await filament.db.list("expenses")\`: its records, in the order kept ([] before the first);
  - \`await filament.db.get("expenses", id)\`: one, or null;
  - \`await filament.db.set("expenses", { amount: 12, category: "food" })\`: the record as kept, with the id Filament gave it; one given with an \`id\` replaces that record whole;
  - \`await filament.db.update("expenses", id, { amount: 30 })\`: those fields changed, the rest kept;
  - \`await filament.db.delete("expenses", id)\`: true where it was there;
  - \`filament.db.onChange(({ collection }) => …)\`: told when a collection changed elsewhere — the page open in another place, or you with write_db: read it again and draw.
- A collection's name is letters, digits, - and _ (expenses). Read what is kept when the page loads, show an empty state before the first record, and say in the page when a call fails: it fails in words when the page was saved and opened from a file, away from Filament.
- You read and change the same records with read_db and write_db. Read them before you change them, and change a record by update: the developer may have changed it in the page.

## Asking you
- \`filament.ask("Summarize this month")\`, on a click in the page, writes those words into the developer's message box in Filament; they send it. Called without a click, nothing happens. In a browser tab it tells them to open the page in Filament.

${lookRules({ where: "page", thing: "page", ground: "Filament gives the page its background and text color, in light and dark: draw on them." })}
- The developer can switch light and dark, or Motion, while the page is open, and the page is not loaded again: what takes its color from the names follows by itself, but a canvas or chart a script drew with colors it read draws again when \`data-theme\` on \`<html>\` changes (watch it with a MutationObserver).

## Versions
- Every publish is the whole page and its files, as the next version; nothing is merged. To change one, read it (\`read\`, or the refused publish that hands it to you), change what was asked, and publish it whole with its \`id\`.
- Keep its title unless asked; its address never changes.

## The call
- \`title\`: two to four words, sentence case (Expense tracker).
- \`description\`: one line, what it does.
- \`icon\`: one word for its mark: ${ARTIFACT_ICONS.join(", ")}.
- After publishing, say in a sentence what it does and what to try first. Do not paste its code into your answer.`,

  doc: `# Making an artifact in Filament: a doc

A doc is an artifact you write in Markdown, which Filament draws as a document in the harness's look: a report, notes, a plan, a reference, a how-to. It opens beside the chat, full size or in the developer's browser, with an outline of its headings; they can edit its text in place, and every publish or edit is a new version.

Make a page (type "page") instead when it must do something: count, sort, keep entries, answer a click. A doc runs no code of yours.

## The call
- \`{"action":"publish","type":"doc","title":"Release notes","description":"What changed in 2.4","markdown":"# Release notes\\n\\n…"}\`
- \`markdown\`: the whole doc. No \`html\`, \`files\` or \`folder\`: Filament makes its page.
- \`title\`: two to four words, sentence case; \`description\`: one line; \`icon\` is "doc" unless you give another.
- To change it, read it (the developer may have edited it), change what was asked, and publish it whole with its \`id\` and \`markdown\`. It stays a doc.

## The Markdown
- One \`#\` heading at the top, its title; \`##\` for its parts and \`###\` under them. The outline lists them, and \`[the risks](#risks)\` jumps to the heading "Risks".
${MARKDOWN_RULES}
- Filament sets no length; a long doc reads best in parts under \`##\`.

## After publishing
Say in a sentence what it holds. Do not paste its Markdown into your answer: the developer opens it from the card.`,

  slides: `# Making an artifact in Filament: slides

Slides are an artifact you write in Markdown, which Filament draws as a deck in the harness's look: a talk, a review, a pitch, a walk-through. The developer moves through it with the arrow keys, sees every slide at once (O), fills the screen (F) and prints it to PDF, a slide a page. They can edit its text in place; every publish or edit is a new version.

## The call
- \`{"action":"publish","type":"slides","title":"Q3 review","description":"What we shipped and what is next","markdown":"# Q3 review\\nJuly to September\\n\\n---\\n\\n## What shipped\\n- …"}\`
- \`markdown\`: the whole deck. No \`html\`, \`files\` or \`folder\`: Filament makes its page.
- \`title\`: two to four words, sentence case; \`description\`: one line; \`icon\` is "slides" unless you give another.
- To change it, read it (the developer may have edited it), change what was asked, and publish it whole with its \`id\` and \`markdown\`. It stays slides.

## The Markdown
- A line of \`---\` alone between slides. (With none, each \`#\` or \`##\` heading starts a slide.)
- A slide that starts with a \`#\` heading is a title slide, centered: the first, and one before each part if you like. Every other slide starts with \`##\`, its title.
- One idea a slide: its title and at most six short bullets — or a table, a code fence, a quote or a diagram. Type that does not fit is made smaller until it does, so keep each slide light.
${MARKDOWN_RULES}
- A slide is 16:9 and read across a room: few words, large ideas.

## After publishing
Say how many slides there are and what they cover. Do not paste its Markdown into your answer: the developer opens it from the card.`,

  dashboard: `# Making an artifact in Filament: a dashboard

A dashboard is an artifact you write as data — tiles, and the tables they read — which Filament draws in the harness's look: large numbers, bar and line charts, tables, laid out from a narrow pane beside the chat to a whole screen, in light and dark. A tile can read Filament's own numbers too, which it follows as they change. Every publish is a new version.

Make a page (type "page") instead when it must do more than show: take entries, keep data, answer a click.

## The call
- \`{"action":"publish","type":"dashboard","title":"Signups","description":"Signups by week, and where they came from","tiles":[{"kind":"number","title":"Signups","from":"weeks","field":"signups"},{"kind":"line","title":"By week","from":"weeks","x":"week","y":"signups","wide":true}],"tables":{"weeks":[{"week":"W1","signups":12},{"week":"W2","signups":19}]}}\`
- \`tiles\`: in their order, left to right and down. \`tables\`: each by its name (letters, digits, - and _), a list of rows, each an object of its columns. No \`html\`, \`files\`, \`folder\` or \`markdown\`: Filament makes its page.
- \`title\`: two to four words, sentence case; \`description\`: one line; \`icon\` is "dashboard" unless you give another.
- To change it, read it, change what was asked, and publish it whole with its \`id\`, \`tiles\` and \`tables\`. It stays a dashboard.

## The tiles
Each has \`kind\` and \`title\` (a few words above it), and may have \`note\` (a line under it: what it counts, or where from) and \`wide: true\` (a whole row).
- number: one value, large. \`value\` gives it (\`"value": 120\`, or words: \`"value": "3 of 5"\`), or it reads a table by \`from\`, \`field\` (a column) and \`of\`: ${NUMBER_OF.map((o, i) => (i ? o : `${o} (when it names none)`)).join(", ")} — count is the rows, and needs no field.
- bar: a bar a row. \`from\`, \`x\` (the column that names each bar) and \`y\` (the column whose numbers it draws, or a list of up to ${SERIES_MAX}, a color each, side by side). Long names lay the bars across.
- line: a line along the rows in their order. \`from\`, \`x\` (the column it runs along, such as a day) and \`y\`, as for a bar.
- table: the rows. \`from\`, and \`columns\` (those to show, in their order), or every column.
- status: one row's value as words, large, with its age and a tone — what is live, whether the last run passed. \`from\`, \`field\` (the column it shows), \`row\` (${STATUS_ROWS.join(" — the default — or ")}), \`words\` (a line under it, with {column} for a value: \`"{message}"\`), \`age\` (a column holding a moment: it says "12 min ago"), \`bad\` and \`good\` (a column and its value, \`{"status":"failure"}\`): bad draws it red, good green, each with its word.
- \`format\` shows a tile's values: ${FORMATS.join(", ")} — number when it names none; percent reads 0.42 as 42%; tokens shows 12.3K; date reads 2026-10-16 as Oct 16; time reads a moment written whole (2026-10-16T14:05:00) as 2:05 PM, in this machine's time; text shows a value as written (a year, a code). One for the tile, or one a column: \`"format":{"cost":"usd","rate":"percent","year":"text"}\`. A bar's or a line's \`x\` is shown as written, or as a date or a time.
- The numbers that matter most come first, as number tiles, then the charts, then a table of the detail. Four to eight tiles read best. Every name a tile gives — a table, a column — is checked, and a publish that names one that is not there is refused in words.

## Filament's own numbers
A tile reads one of these by \`from\`, in place of a table: Filament's records on this machine, read-only. The dashboard follows them as they change, its download keeps them as they were, and the developer sees that it reads them. Use them only when the developer asks about their own Filament — its calls, tokens, cost, speed, sessions — never as made-up data.
${FEEDS_LIST}
- \`days\` on a tile that reads a feed of days (${FEED_NAMES.filter((n) => FEEDS[n].days).join(", ")}): how many days back, today among them — ${FEED_DAYS} when it names none, ${FEED_DAYS_MAX} at most.
- A column's format is its own unless the tile gives one. cost is what the calls cost in US dollars — nothing where a plan paid — and listCost the same tokens at list price; both are Filament's estimates.

## Reading by itself, in a project's Space
A dashboard made for a project's Space can read by itself once the developer keeps it there, with no AI: each source is a command Filament runs in the project's folder, a tool of a connection — an MCP server this project's chats have —, an address it fetches, a folder of the project, Filament's own rows, or a Python script. Build it in a chat of that project. Run each command or script, call each tool, fetch each address, once yourself first, with your own tools, and map its columns from what came back.
${SOURCES_RULES}
- A table of a source's name holds the rows you read when you tried it, by its columns' names: three to ten of them. Until the developer keeps the dashboard, it shows them.
- A tile reads a source by \`from\`, as it reads a table.
${WATCH_RULE}
- \`actions\`: buttons on a table's rows, each by its name, which the developer presses: Filament's own sheet says what it will run, asks its fields, and runs it — nothing else. ${ACTION_EXAMPLE}
${ACTION_RULES}
  - A table tile names the buttons its rows get: \`"actions":["rollback"]\`, each on the source the table shows.
- \`lanes\`: a line on each lane of the Space whose branch a row of one of your sources names — a pull request and its checks. \`{"from":"prs","branch":"branch","words":"PR #{number} {title} · checks {checks}","bad":{"checks":"failing"},"good":{"checks":"passing"}}\`: \`from\` one of its sources, \`branch\` the column that holds a branch's name, \`words\` the line with {column} for a value, \`bad\` / \`good\` a column and its value that make it red or green. The first row of a branch speaks for it.
- \`tasks\`: a card on the Space's board for each row of one of your sources — an issue. \`{"from":"issues","title":"title","line":"labels","column":"state","doing":["In Progress"],"waits":["In Review"],"done":["Done"]}\`: \`title\` and \`line\` the columns a card shows, \`column\` the column whose value puts it in Doing, Waits or Done (Planned where none of their lists has it). A card's menu offers the dashboard's buttons on that source.
- Both show rows Filament already reads for this dashboard: nothing more runs for them, nothing of the service is Filament's — you name the source, the columns and the words. Make them only where the developer's project has such a list.
- Nothing runs before the developer keeps it. Until then it is a draft on its project's page, showing your sample rows, its buttons off; keeping it lists every command, watch and button in Filament's words. A later version that changes a command, how often one runs, a watch, or a button's command, rows, checks or fields is a draft again until it is kept; one that changes only tiles, words, lanes or tasks is live at once.

## After publishing
Say in a sentence what it shows. Do not paste its tiles into your answer: the developer opens it from the card. A dashboard with sources is a draft on its project's page: say that Keep… on its page there lists what it will run, and that nothing runs before. Its page is its row under the Space in the left bar; where the project has no Space yet, it is on the project's page (the project's menu in the left bar, Open its page), and keeping it makes the Space.`,

  design: `# Making an artifact in Filament: a design

A design is an artifact you write as screens — each one HTML at a phone's, a tablet's or a desktop's size — which Filament lays side by side on a canvas the developer zooms and pans, each labeled with its title and size. A screen is a picture of an app or a site, or of a change to one: a mockup to look at and click through, not the app itself. Every publish is a new version.

Make a page (type "page") instead when it is a tool to use, and a visual (show_visual) when one picture inside your answer says it.

## The call
- \`{"action":"publish","type":"design","title":"Onboarding flow","description":"A new user's first minute, in three screens","style":".card{background:var(--surface)}","screens":[{"title":"Welcome","size":"phone","html":"<main>…</main>"},{"title":"Pick a plan","size":"phone","html":"<main>…</main>"}]}\`
- \`screens\`: left to right, each with \`title\` (a word or two: Welcome), \`size\` — ${SIZES_WORDS} — and \`html\`: what goes inside its \`<body>\`, or a whole document. \`height\` (${SCREEN_HEIGHT_MIN} to ${SCREEN_HEIGHT_MAX} pixels) makes one shorter or longer than its size: a dialog, or a page drawn whole.
- \`style\`: the CSS every screen shares, so they read as one app. A screen's own \`<style>\` goes in its html.
- No \`html\`, \`files\`, \`folder\` or \`markdown\`: Filament makes its page. \`title\`: two to four words, sentence case; \`description\`: one line; \`icon\` is "design" unless you give another.
- To change it, read it, change what was asked, and publish it whole with its \`id\`, \`screens\` and \`style\`. It stays a design.

## The screens
- Each screen is drawn alone, in a frame of its size: its width fixed, its height its size's unless it gives one. What is taller scrolls inside it.
- Script runs in a screen, so a tab switches, a menu opens, a form shows its states. The developer clicks a screen to use it, and Esc goes back to the canvas.
- Each screen is on its own: nothing it does reaches another screen, Filament or the network, and it keeps nothing — no filament.db, no storage that lasts, no asking you.
- Libraries load at an exact version from ${HOST_NAMES}; pictures only by an https address on those hosts, or as data. Draw icons as inline SVG, and fill the screens with made-up words and numbers that read as real.
- Show the states that matter as screens of their own: empty, full, an error. A flow reads left to right.

${lookRules({ where: "screen", thing: "screen", ground: "Filament gives each screen its background and text color, in light and dark: draw on them." })}
- A design of the developer's own app takes its look instead — its colors, type and corners, from its code — in \`style\`. Keep it readable in light and dark where the app has both.

## After publishing
Say in a sentence what its screens show. Do not paste their HTML into your answer: the developer opens it from the card.`,

  app: `# Making an artifact in Filament: an app

An app is a page you write whole — its HTML, script and style, as a page's — with a dashboard's sources, watches and buttons beside it: the commands it reads, and the buttons it runs, in a project's Space once the developer keeps it there, with no AI. A build pipeline, a release desk, a queue of jobs: whatever the project's own commands read and do, drawn the way that work wants; in a Space of the developer's own, a to-do list, a habit tracker, a small game, keeping its data in filament.db. It is a page of its Space — a row under it in the left bar —, and in the Artifacts list; every publish is a new version.

Make a dashboard (type "dashboard") instead where tiles — numbers, charts, a table — say it all: Filament draws those, and you write no code. Make a page (type "page") where nothing of the project runs.

## The call
- \`{"action":"publish","type":"app","title":"Build pipeline","description":"Local builds and CI runs, with their buttons","icon":"rocket","folder":"tools/pipeline","sources":{"runs":{"command":["node","tools/pipeline/runs.mjs"],"rows":"runs","key":"id","every":"2m"}},"actions":{"rerun":{"label":"Re-run…","on":"runs","only":{"status":"completed"},"command":["node","tools/pipeline/rerun.mjs","{row.id}"],"check":{"row.id":"^[0-9]+$"},"says":"Re-run {row.title}?"}}}\`
- Its page is a page's — \`html\` with \`files\`, or \`folder\` —, made, laid out and kept as a page's guide (type "page") says: read that guide too. ${CONTENT_JSON} beside it is Filament's, its sources, watch and actions: name no file of yours so.
- \`sources\`, \`watch\` and \`actions\`, as below. No tiles, tables, lanes or tasks: its page draws what its sources read.
- \`howto\`: a few lines for the agents that use it, how its buttons go together (${HOWTO_MAX} characters at most): \`"howto":"To ship: press Test & build; once it is green, Install."\`. \`state\`: each source — or filament.db collection — an agent reads, and a line on what it means: \`"state":{"runs":"CI's runs, the newest first; conclusion failure is red"}\`. An agent reading the app in its Space is given both. Agents operate a kept app with the space tool's app action — its state read, an action run with "do", a run's log read — never by clicking its page: the browser is for looking at what you built.
- \`secrets\`: what its commands need that is never written down — a token, a key —, each by its environment variable's name with a line on what it is for: \`"secrets":{"GITHUB_TOKEN":"A GitHub token that reads this repository's runs"}\`. The developer types each one in Filament's own sheet (the app's ⋯ › Secrets…), sealed there; each of its commands gets it in its environment by that name (\`process.env.GITHUB_TOKEN\`), a fetch names it as \`{secret.GITHUB_TOKEN}\`, and wherever a command says one, Filament hides it. Never write a secret into the app, its files or a command: neither you nor its page ever sees one.
- \`hooks\`: what tells the app something from this computer — a git hook, a script, a local service —, each by the filament.db collection its POSTs go into, with a line on what sends there: \`"hooks":{"pushes":"The repository's post-receive hook, one record per push"}\`. Kept, each has an address of its own, \`http://127.0.0.1:<port>/hook/<app>/<token>\`, which the developer copies from What it may do into what sends there — you never see one. Each POST there — from this computer alone, never from a web page, ${HOOK_BYTES / 1024} KB at most — is one record of that collection, \`{ id, at, kind, body, headers }\`: \`kind\` "json", "form" or "text"; \`body\` the JSON, the form's fields or the text; \`headers\` its x- headers that name no secret. The newest ${HOOK_ROWS_MAX} are kept. Its page reads them with \`filament.db.list("pushes")\` and \`onChange\`, you with read_db.
- \`tools\`: what the app offers its Space's agents to call — up to ${TOOLS_MAX}, each by its name (lowercase, digits, _) with a \`description\` (what it does and gives back), its \`args\` (up to ${TOOL_ARGS_MAX}, each with a \`description\`, and \`required\`, \`choices\` or a \`pattern\` where it has them), its \`command\` (no shell; \`{args.<name>}\` where a value goes, a part whose value is left out left out whole — so a flag and its value go in one part, \`"--lines={args.lines}"\`) and its \`effect\`: "reads" (it only reads: an agent runs it in any mode, unasked), "writes" (the default: judged by its chat's mode, as a command is) or "sends" (it leaves this machine: an agent's run always asks the developer): \`"tools":{"ci_log":{"description":"The last lines of one CI run's log","args":{"run":{"description":"The run's id, as runs lists it","required":true,"pattern":"^[0-9]+$"}},"command":["node","tools/pipeline/log.mjs","{args.run}"],"effect":"reads"}}\`. They are in no chat's tool list: an agent of the Space lists them with the space tool's app action, \`"tools":true\`, and runs one with \`"tool"\` and \`"args"\`, once the developer keeps the version that declares it. What it prints is its answer.
- \`glance\`: up to ${GLANCE_MAX} status lines over its own sources, which the developer may show on Home's At a glance — what to know without opening it: \`"glance":[{"title":"CI","from":"runs","field":"conclusion","words":"{title}","age":"updated","bad":{"conclusion":"failure"},"good":{"conclusion":"success"}}]\`. Each is a dashboard's status tile: \`from\` (one of its sources), \`field\` (the column it shows), \`row\` (${STATUS_ROWS.join(" — the default — or ")}), \`words\` (a line under it, with {column}), \`age\` (a column holding a moment), \`bad\` and \`good\` (a column and its value: red or green).
- An app kept in a folder says itself in its \`${APP_JSON}\` — \`{"title","description","icon","sources","watch","actions","secrets","hooks","tools","glance"}\`, as the call gives them —: then \`{"action":"publish","folder":"tools/pipeline"}\` is the whole call, Filament reading the rest there, and a field you give in the call wins. ${APP_JSON} is not one of its files. An app's folder imported from a download keeps the copies of the web it carried in \`${KEPT_WEB}/\`, Filament's, so it draws with no network: no file of its page — leave it as it is, neither edit nor delete it, and keep nothing of yours there.
- \`.ts\` files are TypeScript with types alone: Filament takes the types out as it publishes, each keeping its name — the page loads \`app.ts\`, which imports \`./rows.ts\`. No enum, namespace or JSX, and no build step.
- Build it in a chat of the project whose Space it lives in. For a Space, keep a new app in a folder of its own, \`.filament/apps/<its name>/\` — the Space finds it there —, and publish it by that folder. One made from Filament's starters is copied there already and runs as it is: adapt it — its sources' commands, its buttons, its page —, run each command once yourself, look at its page in your Browser pane, then publish it by its folder. To change it, read it, change what was asked, and publish it whole with its \`id\`, its page, and its sources, watch and actions — or its \`id\` and \`folder\`, whose ${APP_JSON} says them. It stays an app.

## What it reads and runs
Each source is a command Filament runs in the project's folder, a tool of a connection — an MCP server this project's chats have —, an address it fetches, a folder of the project, Filament's own rows, or a Python script. Run each command or script, call each tool, fetch each address, once yourself first, with your own tools, and map its columns from what came back. A script of the project's own that writes JSON — beside the page, in its folder — reads best: one command, the rows the page wants.
${SOURCES_RULES}
${WATCH_RULE}
- \`actions\`: buttons on a source's rows, each by its name, which the developer presses: Filament's own sheet says what it will run, asks its fields, and runs it — nothing else. ${ACTION_EXAMPLE}
${ACTION_RULES}
- A button for the whole project, not one row — a build, a release — goes on a source that reads one row, its key one word (\`"key":"here"\`): the page presses it on that row.
- Nothing runs before the developer keeps it. Until then it is a draft on its project's page, its page's reads refused; keeping it lists every command, watch and button in Filament's words. A later version that changes a command, how often one runs, a watch, or a button's command, rows, checks or fields is a draft again until it is kept; one that changes only its page is live at once.

## In its page: filament
Beside \`filament.db\` and \`filament.ask\` (a page's guide), its page reaches what Filament reads and runs for it, each a promise:
- \`await filament.source("runs")\`: \`{ rows, at, error }\` — its rows as Filament last read them, read again first where older than its every; \`error\` is its last failure, its rows the last good ones. A row's key is \`row.__key\`. Until it is kept, or while paused, it fails, the error's \`off\` "draft" or "paused" — "held" where a script it runs changed since its Keep, until the person keeps it again —: draw the page empty, saying Keep… on its page runs it.
- \`await filament.refresh("runs")\`: the same, read now.
- \`filament.onSource(({ source }) => …)\`: told when a source was read again — by its every, a button that ended, another page: read it and draw.
- \`filament.act("rerun", row.__key)\`, on a click in the page: Filament's sheet for that button on that row, where the developer reads what it will run and runs it. Called without a click, nothing happens; the page never runs a command itself.
- \`await filament.jobs()\`: its buttons' runs, the newest first, ten at most — \`{ id, action, label, key, state, startedAt, endedAt, said }\`, \`state\` running, done, failed or stopped, \`said\` its last line. \`await filament.job(id)\`: one, with \`log\`, what it said on stdout and stderr (its last 200 KB).
- \`filament.onJob(({ id, action, state, chunk }) => …)\`: told as a run starts and ends (\`state\`), and of each piece of its output as it comes (\`chunk\`): draw a log live.
- \`filament.stop(id)\`, on a click: stops that run, as Stop on its page does.
- One button runs at a time in an app: a press while one runs is refused in words.
- \`await filament.sql("SELECT title, n FROM runs WHERE n > ?", [3])\`: its own SQLite database, for tables too big for filament.db — \`{ rows, columns, changes, lastId, more }\`. One statement a call, its values as \`?\` or \`:name\`, ${SQL_BODY_MAX / 1024 / 1024} MB with them (big data goes in several); ${SQL_TIMEOUT_MS / 1000} s a statement, ${SQL_ROWS_MAX} rows an answer (\`more\`: there were others — page with LIMIT and OFFSET), ${SQL_DB_MAX_MB} MB in all. It reaches its own file alone: no ATTACH, no VACUUM, no PRAGMA but table_info and its kin. Make its tables with CREATE TABLE IF NOT EXISTS as the page starts: the database is kept across versions, and forgotten with the app.
- A game, or any page that wants them: its page may lock the pointer (\`canvas.requestPointerLock()\`) and fill the screen (\`document.documentElement.requestFullscreen()\`), each called from the developer's click or key in it — Esc gives either back —, and read gamepads (\`navigator.getGamepads()\`). Each app's page runs in a process of its own: a busy one slows no other.

${lookRules({ where: "page", thing: "page", ground: "Filament gives the page its background and text color, in light and dark: draw on them." })}

## After publishing
Say in a sentence what it does. Do not paste its code into your answer. It is a draft on its project's page: say that Keep… on its page there lists what it will run, and that nothing runs before. Its page is its row under the Space in the left bar; where the project has no Space yet, it is on the project's page (the project's menu in the left bar, Open its page), and keeping it makes the Space.`,
});
