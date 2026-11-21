// @ts-check
// One place's connectors — its MCP servers —, as Library › Plugins & Connectors, a Space's Connectors and a chat's own settings
// draw them (HarnessV4_Settings_Plan HS-1, HS-D6): a row per server — a dot for its last test, its name and where it
// comes from, what it runs, its tools or why its test failed — with a switch, and a ⋯ menu to test, edit or remove it.
// A plugin's server is its plugin's row (the Designer's of 10-26): shown as its plugin writes it, "from <plugin>", on
// where the plugin is, with Test, sign-in and Always loaded but no Edit or switch, and Open <plugin> in Library ›
// Plugins; Remove where the plugin brings nothing else, which turns it off here; one that waits for a value says what,
// with Finish setup…. Under the rows, Add connector — for your defaults or a project, the marketplaces' connectors
// first (lib/connector-pick.js), the hand-made form behind them —, and where the place holds a list of its own, the
// way back to what it inherits. The hand-made form and Edit are one sheet: a name, a command or an
// address, its environment or headers (a credential shows as set, with Replace: HS-D8), Paste JSON for the block a
// server's own page gives (HS-D10), Test, then Save. A row's change is kept at once, a sheet's on Save (HS-D4); each
// says where it reaches in a toast. A remote server's row signs in (HS-7): Sign in where its server asks, a row that
// waits for the server's page with Open it again and Cancel, and Sign out in ⋯ — from a page on another machine, on
// that machine or by the address the browser comes back to, pasted (the owner's remote Filament of 11-06). An address
// keeps several accounts (HarnessV4_Space_Plan S4b): ⋯ has Use <account> for each other one kept and Sign in with
// another account…, and the row says which it signs in as wherever there is more than main. How a server's tools
// reach Filament's own agent (its `load`, the owner's 10-26 decision): on demand — each request carries their names,
// and the agent loads one when it needs it —, or always loaded. The sheet chooses it, ⋯ switches it for the place, and
// a row says so only where its tools are always loaded, or where the place picked otherwise than it inherits. Built
// with an injected `h`, `api`, dialog, menu, confirm, page opener, timer and page address, so it runs on the fake DOM;
// the pure helpers under it are what the tests read the words from. The list drawn again — at each Space event while
// a sheet shows it, each focus of the window, each change written — is drawn in place (dom.js `morphChildren`), each
// row, switch and button keyed by what it is, so the one under a resting pointer is the element that stood: its hover
// holds and a press on it lands (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
import { h, morphChildren, standing } from "../../lib/dom.js";
import { api } from "./api.js";
import { ICONS } from "./icons.js";
import { confirmDialog, dialog, menu } from "./ui.js";
import { openConnectorPick } from "./connector-pick.js";

/** What the server shows in place of a credential, and keeps it when sent back (services/mcp-servers.js). */
export const SECRET_MARK = "__SECRET__";
/** The most a server's note says (services/mcp-servers.js NOTE_MAX). */
export const NOTE_MAX = 300;

/** A server's name as the settings take it (session-settings.js mcpServerProblem). */
export const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Each layer as a row's chip says it; a plugin's row says its plugin instead (`fromWords`). @type {Record<string, string>} */
export const LAYER_WORDS = Object.freeze({ plugin: "its plugin", global: "all chats", project: "this project", session: "this chat" });

/**
 * A layer in a line's words: the Space of your own above a project by its name (the list's `spaceName` on each row,
 * the owner's word of 10-26: its connectors reach the projects it shows).
 * @param {string | null | undefined} layer @param {any} [row]
 */
export const layerWords = (layer, row = null) => (layer === "space" ? row?.spaceName || "its Space" : LAYER_WORDS[String(layer)] || String(layer || ""));

/**
 * Where a row's server comes from, in a line's words: its layer, or where its plugin is on — the Space above the
 * project by its name. @param {any} row
 */
const fromWords = (row) =>
  row.plugin
    ? row.spaceId && row.pluginPlace === `project:${row.spaceId}` ? `for ${row.spaceName}, this project's Space` : `where ${row.pluginTitle || row.plugin} is on`
    : layerWords(row.from, row);

/**
 * Where a row's note was said, at the head of its line: "In this project", "In Work" (the Space above), "In this chat";
 * the place shown in its own words (`here`: "this Space" in a Space of yours).
 * @param {any} row @param {string} at @param {string} [here]
 */
function noteWhere(row, at, here = LAYER_WORDS[at]) {
  const w = row.noteAt || at;
  if (w === at) return `In ${here}`;
  return w === "global" ? "In all chats" : w === "session" ? "In this chat" : w === "space" ? `In ${layerWords(w, row)}` : "In this project";
}

/** Words joined: "a", "a and b", "a, b and c". @param {readonly string[]} xs */
const joined = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** The foot of every list: who gets these servers, and who does not (HC-22, HC-23). */
export const FOOT_WORDS = "For chats in the harness. Apps you connect to Filament (Claude Code, an SDK) bring their own servers. A team's lead gets none; its workers do.";
/** Library › Plugins & Connectors' connectors with none yet (the Designer's of 10-26). */
export const EMPTY_WORDS = "No connectors yet. Add connector finds services like GitHub and Linear, or sets one up by hand.";
/** The sheet's word on Test, by the way the server is reached (HS-D9). */
export const TEST_SAYS = Object.freeze({
  stdio: "Test starts this program on your computer, as a chat's turn would, then stops it.",
  http: "Test connects to this address, lists its tools and disconnects.",
});
/** What a pasted text that is not JSON gets (HC-6). */
export const NOT_JSON = "This is not JSON: copy the JSON block from the server's page";
/** A key put in the arguments (HC-13, HS-D8's downside). */
export const KEY_IN_ARGS = "This looks like a key in the arguments: put it in the environment, where it is kept sealed and never shown. Saving anyway is allowed.";
/** A server written the old SSE way (HC-5, HS-D10). */
export const OLD_SSE = "The old SSE way: Filament speaks Streamable HTTP, which this server may not answer. Test will tell.";
/** A server's folder on an agent that takes none (HC-27). */
export const FOLDER_HINT = "Optional. Claude over ACP starts a server in the chat's folder: it takes no folder for one.";

/** How a server's tools load where it says nothing (services/mcp-servers.js): on demand. */
export const DEFAULT_LOAD = "on-demand";
/**
 * How a server's tools reach Filament's own agent, by its `load`, in the words the sheet's choice, a row, ⋯ and a toast
 * say: its name, and the trade in a line. The default first.
 * @type {Readonly<Record<"on-demand" | "core", { name: string, line: string }>>}
 */
export const LOAD_WORDS = Object.freeze({
  "on-demand": { name: "On demand", line: "Each request carries only the tools' names, and the agent loads one when it needs it: fewer tokens." },
  core: { name: "Always loaded", line: "Each request carries every tool in full, so the agent has them all ready: a big server adds thousands of tokens to each." },
});
/**
 * Whom the choice reaches: Filament's own agent alone, the engines named as the section's own words name them, in two
 * sentences as the list's foot says its own — after a colon, the engines read as that agent's name.
 */
export const LOAD_FOR = "For Filament's own agent. Claude Code, Codex and Cursor load tools their own way.";
/** How a row's tools load at its place; a new server's, for no row. @param {any} [row] @returns {"on-demand" | "core"} */
export const loadOf = (row) => (row?.load === "core" ? "core" : DEFAULT_LOAD);

/**
 * The row's chip for how its tools load, or null: on demand — most servers — says nothing; always loaded is a chip,
 * blue where this place picked it over what it inherits (a server it holds carries its own, under its own blue chip).
 * @param {any} row @returns {{ words: string, here: boolean } | null}
 */
export function loadChipOf(row) {
  if (row.orphan || !row.spec || loadOf(row) !== "core") return null;
  return { words: LOAD_WORDS.core.name.toLowerCase(), here: !row.own && !!row.loadHere };
}

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * Arguments as one line is typed: split at spaces, a quoted part kept whole. Inside double quotes only `\"` and `\\`
 * stand for one character, as a shell reads them, so a quoted Windows path keeps its backslashes.
 * @param {string} line @returns {string[]}
 */
export function splitArgs(line) {
  /** @type {string[]} */
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(line || "")))) out.push(m[1] !== undefined ? m[1].replace(/\\(["\\])/g, "$1") : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

/** Arguments as one line, a part with a space or a quote in it quoted. @param {readonly string[] | undefined} args */
export function joinArgs(args) {
  return (args || []).map((a) => (/[\s"']/.test(a) || a === "" ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a)).join(" ");
}

/** Whether an argument looks like a key (HC-13). @param {readonly string[]} args */
export function keyInArgs(args) {
  return args.some((a, i) => /^(sk-|ghp_|gho_|github_pat_|xox[abp]-|glpat-|AKIA)[A-Za-z0-9_-]{6,}/.test(a) || /^--?(api[-_]?key|token|secret|password|access[-_]?token)(=.+)?$/i.test(a) && (a.includes("=") || !!args[i + 1]));
}

/** A name the settings take, made from a pasted one: lower case, a dash for anything else. @param {string} name */
export function nameFrom(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 32);
  return s;
}

/** A map of strings from a pasted env or headers. @param {any} m @returns {Record<string, string>} */
const stringsOf = (m) => (m && typeof m === "object" && !Array.isArray(m) ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v ?? "")])) : {});

/**
 * One pasted server as the settings keep it. A `"type": "sse"` server is kept and marked; `"stdio"`, `"http"` and
 * `"streamable-http"` say what the fields already do.
 * @param {string} name @param {any} s
 */
function serverOf(name, s) {
  if (s.url || s.serverUrl) {
    const url = String(s.url || s.serverUrl);
    const headers = stringsOf(s.headers || s.http_headers);
    return { name: nameFrom(name), url, ...(Object.keys(headers).length ? { headers } : {}), ...(s.type === "sse" || s.transport === "sse" ? { type: "sse" } : {}) };
  }
  const args = Array.isArray(s.args) ? s.args.map(String) : [];
  const env = stringsOf(s.env);
  return { name: nameFrom(name), command: String(s.command || ""), ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}), ...(typeof s.cwd === "string" && s.cwd ? { cwd: s.cwd } : {}) };
}

/** @param {any} v */
const isSpec = (v) => !!v && typeof v === "object" && !Array.isArray(v) && (typeof v.command === "string" || typeof v.url === "string" || typeof v.serverUrl === "string");

/**
 * The servers in a pasted block (HS-D10): `{ "mcpServers": { … } }` (Claude Desktop, Cursor), `{ "servers": { … } }`
 * and `{ "mcp": { "servers": { … } } }` (VS Code), `{ "<name>": { … } }`, or one server's own `{ command, args, env }`
 * / `{ "type": "http", url, headers }` — that one with no name until one is typed. Throws `NOT_JSON` for anything else.
 * @param {string} text @returns {Record<string, any>[]}
 */
export function parseServersJson(text) {
  let doc;
  try {
    doc = JSON.parse(String(text || "").trim());
  } catch {
    throw new Error(NOT_JSON);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(NOT_JSON);
  const map = doc.mcpServers || doc.servers || doc.mcp?.servers || doc.mcp_servers || null;
  if (map && typeof map === "object") return Object.entries(map).filter(([, v]) => isSpec(v)).map(([k, v]) => serverOf(k, v));
  if (isSpec(doc)) return [serverOf(String(doc.name || ""), doc)];
  const named = Object.entries(doc).filter(([, v]) => isSpec(v));
  if (named.length) return named.map(([k, v]) => serverOf(k, v));
  throw new Error("No MCP server in this JSON: it needs a command, or a url, for each server");
}

/** How long ago, in a row's words. @param {number} at @param {number} now */
export function agoWords(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

/** What a server runs, one line: "stdio · npx -y …" or "HTTP · https://…". @param {any} row */
export function runsWords(row) {
  const s = row.spec || {};
  return s.url ? `HTTP · ${s.url}` : `stdio · ${[s.command, joinArgs(s.args)].filter(Boolean).join(" ")}`;
}

/**
 * The row's chip — where the server comes from, or that it is off — and whether it is this place's own word.
 * @param {any} row @param {string} at  the place's layer @param {string} [here]  the place in its own words: "this
 *   Space" in a Space of yours, where a project's list says "this project"
 * @returns {{ words: string, here: boolean }}
 */
export function chipOf(row, at, here = LAYER_WORDS[at]) {
  if (row.orphan) return { words: "removed", here: true };
  // A plugin's server waiting for a value is off for want of it, not by anyone's switch: its chip names its plugin.
  if (row.plugin && row.waits?.length) return { words: `from ${row.pluginTitle || row.plugin}`, here: false };
  if (!row.on) return { words: row.switchedAt === at ? `off for ${here}` : "off", here: row.switchedAt === at };
  if (row.switchedHere) return { words: `on for ${here}`, here: true };
  if (row.plugin) return { words: `from ${row.pluginTitle || row.plugin}`, here: false };
  return { words: row.from === at ? here : layerWords(row.from, row), here: row.from === at };
}

/** What the sheet's test says under a server that asks for a sign-in (HC-142). */
export const SIGN_IN_AFTER_SAVE = "Save it, then press Sign in on its row: Filament signs in once, for every chat that has it.";

/** Whether a server carries its own Authorization header, which goes as written (HS-D83). @param {any} spec */
export const ownAuth = (spec) => Object.keys(spec?.headers || {}).some((k) => k.toLowerCase() === "authorization");

/**
 * A row's sign-in (HS-D83): whether it can sign in (a server reached over HTTP with no Authorization of its own), its
 * state, and whether it asks to — its server asked for a sign-in Filament does not hold, or ended the one it had, or
 * its last test met a sign-in that failed.
 * @param {any} row
 */
export function signInOf(row) {
  const can = !!row.spec?.url && !ownAuth(row.spec) && !row.orphan && !row.waits?.length;
  const st = String(row.signIn?.state || "");
  // `refused`: its registration turned Filament down — Sign in stays, outlined: it tries again.
  return { can, st, asks: can && (st === "asks" || st === "ended" || (st !== "waiting" && st !== "refused" && !!row.test?.signIn)), refused: can && st === "refused" };
}

/** A host that names this computer's loopback. @param {string} host */
const loopbackName = (host) => {
  const n = host.replace(/^\[|\]$/g, "").toLowerCase();
  return n === "localhost" || n.endsWith(".localhost") || n === "::1" || /^127\./.test(n);
};

/**
 * Whether a server's sign-in page sends this browser back to the Filament this page shows (the owner's remote Filament
 * of 11-06): its `redirect_uri` — Filament's own address, 127.0.0.1 and its port — is where this page was loaded from,
 * or this computer's loopback at the same port. A page on another machine — over tailscale serve, the network's https,
 * an SSH tunnel on another port — is sent to 127.0.0.1 there: to nothing, or that computer's own Filament. Where this
 * page's address or the return is not known, it is taken to come back here.
 * @param {string} page  the server's sign-in page
 * @param {{ protocol?: string, hostname?: string, port?: string } | null | undefined} here  this page's `location`
 */
export function comesBackHere(page, here) {
  if (!here?.hostname) return true;
  /** @type {URL} */
  let back;
  try {
    back = new URL(new URL(page).searchParams.get("redirect_uri") || "");
  } catch {
    return true;
  }
  const portOf = (/** @type {{ protocol?: string, port?: string }} */ u) => u.port || (u.protocol === "https:" ? "443" : "80");
  if (portOf(back) !== portOf(here)) return false;
  const there = back.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const mine = here.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return there === mine || (loopbackName(there) && loopbackName(mine));
}

/** The first account at an address (core's MAIN_ACCOUNT): what a row signs in as where it picks none. */
export const MAIN_ACCOUNT = "main";

/**
 * Whether a row names its account (S4b): where its address keeps more than one, or it uses one other than main. A
 * person with one account per server never reads the word.
 * @param {any} row
 */
export const namesAccount = (row) => !!row.signIn && ((row.signIn.accounts || []).length > 1 || (row.signIn.account || MAIN_ACCOUNT) !== MAIN_ACCOUNT);

/**
 * A service as a sheet names it (the Designer's of 10-26): its plugin's title, else the server's name with a capital —
 * "Figma", never its metadata's "Figma MCP".
 * @param {any} row
 */
export const serviceName = (row) => String(row.pluginTitle || "") || (row.name ? `${String(row.name)[0].toUpperCase()}${String(row.name).slice(1)}` : "Its service");

/**
 * The row's sign-in in a line (HS-D91), or null: never a token or an expiry. As which account, where that is worth
 * saying (S4b). A refusal says what happened and when, the service's words on hover (the Designer's of 10-26): the
 * likely why is its sheet's.
 * @param {any} row @param {number} [now]
 * @returns {{ text: string, bad?: boolean, title?: string } | null}
 */
export function signInLine(row, now = Date.now()) {
  const s = row.signIn;
  if (!s || !signInOf(row).can) return null;
  const named = namesAccount(row);
  const as = named ? ` as ${s.account}` : "";
  if (s.state === "in") return { text: `Signed in on ${s.host}${as}` };
  if (s.state === "refused") return { text: `Sign-in refused by ${s.host}${s.at ? ` · ${agoWords(s.at, now)}` : ""}`, bad: true, ...(s.why ? { title: s.why } : {}) };
  if (s.state === "ended") return { text: `Signed out by ${s.host}${named ? ` (${s.account})` : ""}: sign in again`, bad: true, ...(s.why ? { title: s.why } : {}) };
  if (s.state === "waiting") return { text: `Sign in on ${s.host}'s page${as}… This waits until you do, or press Cancel` };
  // An account picked here with no sign-in kept, beside others at the address.
  if (s.state === "asks" && named && !(s.accounts || []).includes(s.account)) return { text: `${s.account} is not signed in on ${s.host}`, bad: true };
  // A test that met the ask says it in its own line.
  return s.state === "asks" && !row.test?.signIn ? { text: "Needs you to sign in", bad: true } : null;
}

/**
 * What a plugin's server waits for, in its row's words (the Designer's of 10-26): "Needs its personal access token",
 * "Needs its API key and workspace", "Needs 3 values".
 * @param {readonly string[]} waits  the values' titles
 */
export function needsWords(waits) {
  if (waits.length > 2) return `Needs ${waits.length} values`;
  const words = waits.map((t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t));
  return `Needs its ${joined(words) || "values"}`;
}

/**
 * The row's lines under its name, past what it runs: why it is on or off where that is another layer's word, whose
 * server it replaces, the account and the load this place picked over what it inherits, its sign-in, and its last test.
 * A plugin's server names the page its plugin is switched on at (Library › Plugins & Connectors), save in that page's own
 * list (`pluginsPage`, the owner's of 11-09), which would point at itself.
 * @param {any} row @param {string} at @param {number} now @param {string} [here]  the place in its own words, as `chipOf`
 * @param {{ pluginsPage?: boolean }} [o]
 * @returns {{ text: string, bad?: boolean, title?: string }[]}
 */
export function rowLines(row, at, now, here = LAYER_WORDS[at], { pluginsPage = false } = {}) {
  /** @type {{ text: string, bad?: boolean, title?: string }[]} */
  const out = [];
  if (row.orphan) return [{ text: `Switched ${row.on ? "on" : "off"} for ${here}, but no server of this name is set beneath any more: Clear takes the switch away` }];
  // A plugin's server that waits for a value its plugin needs here: what, the same in every list (Finish setup… on
  // its row sets it where its plugin is on).
  if (row.plugin && row.waits?.length) return [{ text: needsWords(row.waits), bad: true }];
  if (row.switchedHere) out.push({ text: row.on ? `Off beneath; ${here} switched it on` : `On ${row.plugin ? fromWords(row) : `for ${fromWords(row)}`}; ${here} switched it off` });
  else if (!row.on && row.switchedAt && row.switchedAt !== row.from) out.push({ text: `Switched off for ${layerWords(row.switchedAt, row)}` });
  else if (row.plugin) out.push({ text: `On ${fromWords(row)}${pluginsPage ? "" : " (Library › Plugins & Connectors)"}` });
  // What of it the place uses (the owner's word of 10-26), as every agent is told it.
  if (row.note) out.push({ text: `${noteWhere(row, at, here)}: ${row.note}` });
  if (row.hides) out.push({ text: `Keeps out ${row.hides.title || row.hides.plugin}'s connector of this name` });
  if (row.replaces && row.replaces !== "plugin") out.push({ text: `Replaces the server of this name from ${layerWords(row.replaces, row)}` });
  if (row.pickedHere) out.push({ text: `Signs in as ${row.account}: picked for ${here}` });
  // What ↺ takes back: a server this place holds keeps its load on itself, and says nothing of it here.
  if (row.loadHere && !row.own) out.push({ text: `${LOAD_WORDS[loadOf(row)].name}: picked for ${here}` });
  if (row.sse) out.push({ text: OLD_SSE });
  const signed = signInLine(row, now);
  if (signed) out.push(signed);
  const t = row.test;
  // A sign-in under way stands in for the test that asked for it.
  if (t?.signIn && row.signIn?.state === "waiting") return out;
  // A row that needs a sign-in, or whose sign-in was refused, says that alone until it is tested: nothing to test yet.
  if (!t) {
    if (row.signIn?.state !== "asks" && row.signIn?.state !== "refused") out.push({ text: "Not tested since Filament started" });
  }
  else if (t.ok) out.push({ text: `${t.words} · tested ${agoWords(t.at, now)}` });
  else out.push({ text: t.words, bad: true });
  return out;
}

/** What the import sheet says over its files (HS-D75). */
export const IMPORT_SAYS = "Read just now from each app's file, and read again when you add: a key in them is never shown here.";

/** What the import sheet says of one app's file. @param {{ state: string, why?: string, servers: any[] }} s */
export function sourceWords(s) {
  if (s.state === "missing") return "Not there";
  if (s.state === "unreadable") return `Not read: ${s.why}`;
  const n = s.servers.length;
  return n ? `${n} server${n === 1 ? "" : "s"}` : "No MCP servers in it";
}

/**
 * How a found server stands against this place's, in a line; "" for a new one under its own name.
 * @param {any} f  a found server @param {string} app  the app it was found in @param {string} label  the place
 */
export function foundWords(f, app, label) {
  if (f.mark === "same") return f.yours === f.name ? "Already yours" : `Already yours, as ${f.yours}`;
  if (f.mark === "repeat") return `The same as ${f.sameIn}'s, above`;
  if (f.mark === "own") return "Filament's own server: every chat has it";
  const named = f.from !== f.name ? `Named ${f.from} in ${app}` : "";
  if (f.mark === "taken") return [named, `Replaces your ${f.yours} for ${label}`].filter(Boolean).join(" · ");
  return named;
}

/**
 * Whether a found server can be added (new, or under a name of yours it replaces), and whether it is ticked at first.
 */
export const canAdd = (/** @type {any} */ f) => f.mark === "new" || f.mark === "taken";

/**
 * The toast's last words: who has a change, from when (HS-D4); `many`: more than one server.
 * @param {string} at @param {boolean} [many]
 */
export const reachWords = (at, many = false) => {
  const what = many ? "them" : "it";
  return at === "global" ? `each chat has ${what} from its next message` : at === "project" ? `each chat in it has ${what} from its next message` : `this chat has ${what} from its next message`;
};

/** A button in the harness's own markup (lib/ui.js `button`), built with the injected `h`; `extra.key`: what it is among its siblings, for a draw in place. */
const btn = (/** @type {typeof h} */ m, /** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
  m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.class ? ` ${extra.class}` : ""}`, type: "button", onclick: onClick, ...(extra.key ? { "data-key": extra.key } : {}), ...(extra.title ? { title: extra.title, "aria-label": extra.title } : {}), ...(extra.disabled ? { disabled: "" } : {}) },
    extra.html ? m("span", { class: "zc-btn-ic", html: extra.html }) : null, label ? m("span", { class: "zc-btn-label" }, label) : null);

/**
 * One place's list.
 * @param {{ scope: string, at?: string, onToast?: (msg: string, kind?: string) => void, title?: string | null, now?: () => number, imports?: boolean,
 *   more?: (row: any) => { text: string, bad?: boolean, title?: string }[], onRows?: (rows: any[]) => void, openPlugin?: (id: string) => void,
 *   finish?: { plugin: string, title: string }, foot?: string | null, none?: string, add?: string, pluginsPage?: boolean }} o
 *   `scope`: `all`, `project:<id>` or `chat:<id>`; `title`: a heading over the rows (a chat's own settings have one);
 *   `imports`: Import from other apps beside Add (Library › Plugins & Connectors, HS-6); `pluginsPage`: the list is that
 *   page's, so a plugin's server names no page to switch its plugin on (`rowLines`); `more`: lines of the caller's under a
 *   row's own (the Space's Connections sheet says what uses it, HarnessV4_Space_Plan S4b); `onRows`: the rows, each time
 *   they are drawn (the sheet says what its dashboards call that no row is); `openPlugin`: a plugin's sheet in Library ›
 *   Plugins, from its server's row (a sheet the list lies in closes first) — by default its address; `finish`: a plugin
 *   just installed or turned on here, whose setup — Add connector's second step: a sign-in, a test — opens once the
 *   list is drawn; `foot`, `none`, `add`: the words under the list, with no rows, and on Add, where the caller says its
 *   own (a Space's sheet, in its person's words: no foot, the Designer's walk of 10-29)
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, menu?: typeof menu, confirm?: typeof confirmDialog,
 *   open?: (url: string) => any, later?: (fn: () => void, ms: number) => any, pick?: typeof openConnectorPick,
 *   drawIn?: (host: any, nodes: any[]) => void, here?: { protocol?: string, hostname?: string, port?: string } | null }} [io]
 *   `open`: a server's sign-in page in a new tab; `later`: the next look at a sign-in that waits; `pick`: Add
 *   connector's sheet (lib/connector-pick.js); `drawIn`: how a draw goes into the list — in place (dom.js
 *   `morphChildren`, the page's), or a fake DOM's own; `here`: this page's address (its `location`), which a sign-in
 *   page's return is told from (`comesBackHere`)
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, data: () => any }}
 */
export function createMcpList(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const drawIn = io.drawIn || morphChildren;
  const openDialog = io.dialog || dialog;
  const openMenu = io.menu || menu;
  const ask = io.confirm || confirmDialog;
  const openPage = io.open || ((url) => void window.open(url, "_blank", "noopener"));
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  const here = () => (io.here !== undefined ? io.here : globalThis.location);
  const toast = o.onToast || (() => {});
  const now = o.now || Date.now;
  const openPlugin = o.openPlugin || ((/** @type {string} */ id) => { location.hash = `#/library/plugins/${encodeURIComponent(id)}`; });
  const path = (/** @type {string} */ tail = "") => `/mcp-servers/${encodeURIComponent(o.scope)}${tail}`;
  const el = m("div", { class: "mcps", "data-scope": o.scope });
  /** @type {any} */
  let data = null;
  /** @type {string | null} */
  let failed = null;
  const at = () => String(data?.at || o.at || "global");
  const label = () => String(data?.label || LAYER_WORDS[at()]);
  /** The place in a row's words: "this Space" in a Space of yours, else its layer's. */
  const placeWords = () => (data?.ownSpace ? "this Space" : LAYER_WORDS[at()]);

  /** Keep the answer a change came back with, and draw it. @param {any} answer */
  const took = (answer) => {
    data = answer;
    failed = null;
    paint();
  };
  /** A refusal in the server's words. @param {unknown} e */
  const refused = (e) => toast(errText(e), "err");

  async function refresh() {
    try {
      took(await call(`/mcp-servers?scope=${encodeURIComponent(o.scope)}`));
    } catch (e) {
      failed = errText(e);
      paint();
    }
  }

  /** @param {any} row @param {boolean} on */
  async function setOn(row, on) {
    try {
      took(await call(path(`/${encodeURIComponent(row.name)}`), { method: "PUT", body: { enabled: on } }));
      toast(`${row.name} ${on ? "on" : "off"} for ${label()}; from the next message`);
    } catch (e) {
      refused(e);
      paint();
    }
  }

  /** Take this place's own entry away: its server, or its switch. @param {any} row @param {string} words */
  async function drop(row, words) {
    try {
      took(await call(path(`/${encodeURIComponent(row.name)}`), { method: "DELETE" }));
      toast(words);
    } catch (e) {
      refused(e);
    }
  }

  /** @param {any} row */
  async function remove(row) {
    const signedIn = row.signIn?.state === "in" ? ` ${(row.signIn.accounts || []).length > 1 ? "Its sign-ins" : "Its sign-in"} on ${row.signIn.host} ${(row.signIn.accounts || []).length > 1 ? "end" : "ends"} too, unless your list for all chats or a project's names the address.` : "";
    const yes = await ask({ title: `Remove ${row.name}?`, description: `Chats lose its tools from their next message.${signedIn} ${row.own && at() === "global" ? "A project's or a chat's switch for it stays, shown as removed, until it is cleared." : ""}`.trim(), confirmLabel: "Remove", destructive: true });
    if (!yes) return;
    try {
      const r = await call(path(`/${encodeURIComponent(row.name)}`), { method: "DELETE" });
      took(r);
      toast(`${row.name} removed from ${label()}${r.signedOut ? `; signed out of ${row.signIn?.host || "its server"} too` : ""}`);
    } catch (e) {
      refused(e);
    }
  }

  // ---- signing in (HS-7) ------------------------------------------------------------------------------------------

  /** The sign-ins this list looks after, by id: each is looked at until it ends. @type {Set<string>} */
  const following = new Set();
  /**
   * This page is on another machine than Filament, as the server said at a sign-in (the owner's remote Filament of
   * 11-06), with the name of the machine Filament runs on: each sign-in from here then takes the address pasted.
   * @type {{ machine: string } | null}
   */
  let elsewhere = null;

  /**
   * Start a row's sign-in (HC-143): its server's page opened, the row waiting. A registration turned down says so in
   * its own sheet, the row then saying it was refused; a server that lets no app register asks for the client made on
   * its site (HC-153); any other refusal is said in a toast and opens nothing (HC-155). From a page on another machine
   * (HC-156, the owner's remote Filament of 11-06), the first says where its page sends the browser back, before
   * anything opens; a sign-in started from there, or whose page sends the browser anywhere but this page's Filament,
   * takes the address it lands on, pasted — its page opened by the person's press in that sheet: one opened once the
   * server has answered is a popup a browser blocks (the hunt of p4-signins). `account`: another account to sign in as
   * (S4b), which this place uses once it is done; else the one it uses. `sheet`: a sheet started it, which says a
   * refusal itself.
   * @param {any} row @param {{ clientId?: string, clientSecret?: string }} [client] @param {string} [account] @param {boolean} [sheet]
   */
  async function signIn(row, client = {}, account = "", sheet = false) {
    try {
      const st = await call("/mcp-servers/sign-in", { method: "POST", body: { scope: o.scope, name: row.name, ...client, ...(account ? { account } : {}), ...(elsewhere ? { paste: true } : {}) } });
      const pasted = elsewhere || !comesBackHere(st.url, here());
      if (!pasted) openPage(st.url);
      await refresh();
      follow(st.id, row.name);
      if (pasted) pasteSheet(row, st);
    } catch (e) {
      const body = /** @type {any} */ (e)?.body;
      if (body?.elsewhere && !elsewhere) {
        elsewhere = { machine: String(body.machine || "") };
        return farSheet(row, client, account);
      }
      if (body?.turnedDown && !client.clientId) {
        turnedDownSheet(row, body, account);
        return void (await refresh());
      }
      if (body?.needsClient && !client.clientId) return askClient(row, body, account);
      if (body?.none) return void toast(errText(e), "err");
      if (client.clientId || account || sheet) throw e;
      refused(e);
    }
  }

  /**
   * Sign in with another account… (S4b): its name asked — work, personal —, then the sign-in as that account, kept
   * beside the address's others; this place uses it once it is done.
   * @param {any} row
   */
  function anotherAccount(row) {
    const name = m("input", { class: "zc-input mcps-input", type: "text", spellcheck: "false", autocomplete: "off", maxlength: "32", placeholder: "work, personal…", "aria-label": "The account's name" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const go = btn(m, "Sign in", "default", () => void send());
    const host = row.signIn?.host || "its server";
    const have = (row.signIn?.accounts || []).join(", ");
    const body = m("div", { class: "mcps-sheet" },
      m("p", { class: "mcps-hint" }, `A name for the account, to tell it from the others on ${host}${have ? ` (${have})` : ""}. ${label()[0].toUpperCase()}${label().slice(1)} signs in as it once you are signed in.`),
      m("div", { class: "mcps-fields" }, m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, "Account"), m("div", { class: "mcps-v" }, name))),
      m("p", { class: "mcps-hint" }, `If ${host}'s page signs you in as an account you already have here, sign out on its site first.`),
      error,
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Cancel", "outline", () => d.close()), go));
    const d = openDialog({ title: `Sign in to ${row.name} with another account`, description: host, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.user }), body });
    name.focus();
    async function send() {
      const account = String(name.value || "").trim();
      if (!account) return void error.replaceChildren("Give the account a name");
      go.setAttribute("disabled", "");
      error.replaceChildren("");
      try {
        await signIn(row, {}, account);
        d.close();
      } catch (e) {
        error.replaceChildren(errText(e));
        go.removeAttribute("disabled");
      }
    }
  }

  /**
   * Use another account kept at the server's address, for this place (S4b): from the next message.
   * @param {any} row @param {string} account
   */
  async function pick(row, account) {
    try {
      took(await call(path(`/${encodeURIComponent(row.name)}`), { method: "PUT", body: { account } }));
      toast(`${row.name} signs in as ${account} for ${label()}; from the next message`);
    } catch (e) {
      refused(e);
    }
  }

  /**
   * How a server's tools load, for this place, from ⋯: on a server it holds, on its entry; on an inherited one, its pick
   * — taken away by the server where it says what the layers beneath say. From the next message.
   * @param {any} row @param {"on-demand" | "core"} load
   */
  async function setLoad(row, load) {
    try {
      took(await call(path(`/${encodeURIComponent(row.name)}`), { method: "PUT", body: { load } }));
      toast(`${row.name}: ${LOAD_WORDS[load].name.toLowerCase()} for ${label()}; from the next message`);
    } catch (e) {
      refused(e);
    }
  }

  /**
   * What this project uses… (the owner's word of 10-26: a company's Slack, this project's channels): the words its
   * agents are told beside the server's tools — Filament's own on the server's line, a coding agent in its standing
   * context. A guide, no wall. Saved empty, the project's own note goes, and the one beneath — its Space's — stands.
   * @param {any} row
   */
  function openNote(row) {
    const where = String(data?.name || "this project");
    const field = m("textarea", { class: "zc-input mcps-input mcps-note", rows: "3", maxlength: String(NOTE_MAX), spellcheck: "true", placeholder: "Channels, a team, a project, like #proj-api, #proj-api-alerts", "aria-label": `What ${where} uses of it` });
    field.value = row.noteAt === at() ? String(row.note || "") : "";
    const error = m("p", { class: "mcps-error", role: "alert" });
    const save = btn(m, "Save", "default", () => void send());
    const inherited = row.note && row.noteAt !== at() ? [m("p", { class: "mcps-hint" }, `${noteWhere(row, at(), placeWords())}: ${row.note}. Saved here, ${placeWords()}'s words go over it.`)] : [];
    const body = m("div", { class: "mcps-sheet" },
      ...inherited,
      m("div", { class: "mcps-fields" }, m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, `What ${where} uses of it`), m("div", { class: "mcps-v" }, field))),
      m("p", { class: "mcps-hint" }, `Every chat in ${where} is told this beside ${row.name}'s tools. It guides the agent; it is no wall: ${row.name} still lets it reach what its account can.`),
      error,
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Cancel", "outline", () => d.close()), save));
    const d = openDialog({ title: `${row.name} in ${where}`, description: "From the next message", glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body });
    field.focus();
    async function send() {
      save.setAttribute("disabled", "");
      error.replaceChildren("");
      const note = String(field.value || "").replace(/\s+/g, " ").trim();
      try {
        took(await call(path(`/${encodeURIComponent(row.name)}`), { method: "PUT", body: { note } }));
        d.close();
        toast(note ? `${where}'s chats are told what it uses of ${row.name}; from the next message` : `${where} says nothing of its own about ${row.name} now; from the next message`);
      } catch (e) {
        error.replaceChildren(errText(e));
        save.removeAttribute("disabled");
      }
    }
  }

  /**
   * The client made on the server's site (HS-D86): the address to make it with, its ID and its secret where it has one,
   * and Sign in with it. `close`: the sheet it stands in, closed once the sign-in starts.
   * @param {any} row @param {{ redirectUri?: string }} info @param {string} account @param {() => void} close
   */
  function clientForm(row, info, account, close) {
    const field = (/** @type {Record<string, any>} */ attrs) => m("input", { class: "zc-input mcps-input", type: "text", spellcheck: "false", autocomplete: "off", ...attrs });
    const id = field({ placeholder: "the client ID", "aria-label": "Client ID" });
    const secret = field({ type: "password", placeholder: "only where it gave one", "aria-label": "Client secret" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const go = btn(m, "Sign in", "default", () => void send());
    async function send() {
      const clientId = String(id.value || "").trim();
      if (!clientId) return void error.replaceChildren("Give the client ID its site showed");
      go.setAttribute("disabled", "");
      error.replaceChildren("");
      try {
        await signIn(row, { clientId, clientSecret: String(secret.value || "").trim() }, account);
        close();
      } catch (e) {
        error.replaceChildren(errText(e));
        go.removeAttribute("disabled");
      }
    }
    return {
      id,
      go,
      parts: [
        m("div", { class: "mcps-sub mcps-mono mcps-back-at" }, info.redirectUri || ""),
        m("div", { class: "mcps-fields" },
          m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, "Client ID"), m("div", { class: "mcps-v" }, id)),
          m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, "Client secret"), m("div", { class: "mcps-v" }, secret, m("span", { class: "mcps-hint" }, "Kept sealed with the sign-in, never shown again.")))),
        error,
      ],
    };
  }

  /**
   * The sheet for a server that lets no app register (HS-D86): the client ID, and its secret where it has one, made on
   * the server's site with the address the browser comes back to.
   * @param {any} row @param {{ host?: string, redirectUri?: string }} info @param {string} [account]  the account it signs in as
   */
  function askClient(row, info, account = "") {
    const host = info.host || row.signIn?.host || "Its server";
    const form = clientForm(row, info, account, () => d.close());
    const body = m("div", { class: "mcps-sheet" },
      m("p", { class: "mcps-hint" }, `${host} lets no app register itself. Make an app on its site (an OAuth app), with this address to come back to, and give its client ID here:`),
      ...form.parts,
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Cancel", "outline", () => d.close()), form.go));
    const d = openDialog({ title: `Sign in to ${row.name}`, description: host, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body });
    form.id.focus();
  }

  /**
   * The sheet for a registration turned down (the Designer's of 10-26; Figma's on the owner's): what happened and its
   * likely why, hedged — Filament cannot know it —, the service's own words, its guide where its metadata names one, and
   * the client made on its site folded under, for a service that lets a person make one. No service is named in code:
   * its guide says its other ways.
   * @param {any} row @param {{ host?: string, redirectUri?: string, turnedDown?: { said?: string, status?: number }, docs?: string }} info
   * @param {string} [account]  the account it signs in as
   */
  function turnedDownSheet(row, info, account = "") {
    const who = serviceName(row);
    const said = String(info.turnedDown?.said || "");
    const form = clientForm(row, info, account, () => d.close());
    const body = m("div", { class: "mcps-sheet mcps-turned" },
      m("p", { class: "cpick-lead" }, `${who} may let only apps it has approved sign in.`),
      m("p", { class: "mcps-sub" }, said ? `${who} said: “${said}”` : `${who} answered HTTP ${info.turnedDown?.status ?? ""}`.trim()),
      info.docs ? m("p", { class: "mcps-hint" }, "Its guide may show another way to connect.") : null,
      m("details", { class: "mcps-fold" },
        m("summary", {}, `I made an app on ${who}'s site…`),
        m("p", { class: "mcps-hint" }, `Only where ${who} lets you make your own app for this: make it with this address to come back to, then give its client ID.`),
        ...form.parts,
        m("div", { class: "mcps-sheet-foot" }, form.go)),
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Close", "outline", () => d.close()), info.docs ? btn(m, `Open ${who}'s guide`, "default", () => openPage(String(info.docs))) : null));
    const d = openDialog({ title: `${who} does not let Filament sign in`, description: info.host || row.signIn?.host || "", glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body });
  }

  /** The machine Filament runs on, in a sheet's words. */
  const thereWords = () => elsewhere?.machine || "the computer Filament runs on";

  /**
   * A sign-in from a page on another machine (HC-156, the owner's remote Filament of 11-06): the server's page sends the
   * browser back to 127.0.0.1, which is Filament on its own computer alone. Its two ways, before anything opens: on that
   * computer, or here, with the address the browser lands on pasted next.
   * @param {any} row @param {{ clientId?: string, clientSecret?: string }} client @param {string} account
   */
  function farSheet(row, client, account) {
    const host = row.signIn?.host || "Its server";
    const error = m("p", { class: "mcps-error", role: "alert" });
    const go = btn(m, "Sign in here", "default", () => void here());
    const body = m("div", { class: "mcps-sheet" },
      m("p", { class: "cpick-lead" }, `${host}'s sign-in page sends your browser back to 127.0.0.1, which is Filament only on ${thereWords()}.`),
      m("p", { class: "mcps-hint" }, `On ${thereWords()}: open Filament there and press Sign in on this row. Every chat that has it is signed in, wherever you reach Filament from.`),
      m("p", { class: "mcps-hint" }, "Here: sign in on its page in this browser. Your browser then lands on an address that does not open, or opens this computer's own Filament, which leaves it alone: copy that address and paste it in the next step."),
      error,
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Close", "outline", () => d.close()), go));
    const d = openDialog({ title: `Sign in to ${row.name}`, description: row.signIn?.host || "", glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body });
    // Its start refused stays here and says why, as the account's sheet that led here closed (the hunt of p4-signins).
    async function here() {
      go.setAttribute("disabled", "");
      error.replaceChildren("");
      try {
        await signIn(row, client, account, true);
        d.close();
      } catch (e) {
        error.replaceChildren(errText(e));
        go.removeAttribute("disabled");
      }
    }
  }

  /**
   * The address the browser landed on, pasted (the owner's remote Filament of 11-06): the server's page sent it to
   * Filament's own address, which is not this page's Filament. The address goes to this page's Filament alone, never
   * opened here, so its code reaches no other Filament; the sign-in ends there as its return would end it, and the row's
   * look says so and tests the server. Closed, the sign-in waits on its row, with Paste the address….
   * @param {any} row @param {{ id: string, url: string, host?: string }} st  the sign-in started: its id, its page
   */
  function pasteSheet(row, st) {
    const host = st.host || row.signIn?.host || "its server";
    /** Where its page sends the browser: Filament's own address. @type {URL | null} */
    let back = null;
    try {
      back = new URL(new URL(st.url).searchParams.get("redirect_uri") || "");
    } catch {}
    const field = m("input", { class: "zc-input mcps-input mcps-mono", type: "text", spellcheck: "false", autocomplete: "off", placeholder: `${back ? back.href : "http://127.0.0.1:…"}?code=…`, "aria-label": "The address it came back to" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const go = btn(m, "Finish", "default", () => void send());
    const body = m("div", { class: "mcps-sheet" },
      m("p", { class: "mcps-hint" }, `Open ${host}'s page in this browser and sign in there. It then sends the browser to ${back ? back.host : "127.0.0.1"}, which is Filament only on ${thereWords()}: here that page does not open, or this computer's own Filament says it is not waiting for it. Copy the whole address from the address bar and paste it here.`),
      m("div", { class: "mcps-fields" }, m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, "Address"), m("div", { class: "mcps-v" }, field))),
      error,
      m("div", { class: "mcps-sheet-foot" }, btn(m, "Open its page", "ghost", () => openPage(st.url)), btn(m, "Close", "outline", () => d.close()), go));
    const d = openDialog({ title: `Sign in to ${row.name}`, description: host, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body });
    field.focus();
    async function send() {
      const pasted = String(field.value || "").trim();
      if (!pasted) return void error.replaceChildren("Paste the address its page sent your browser to");
      go.setAttribute("disabled", "");
      error.replaceChildren("");
      try {
        await call("/mcp-servers/sign-in", { method: "POST", body: { pasted } });
        d.close();
      } catch (e) {
        error.replaceChildren(errText(e));
        go.removeAttribute("disabled");
      }
    }
  }

  /**
   * Look at a sign-in until it ends, with no clock (HS-D87): a finished one tells its toast and tests the server, a
   * failed one says why, and one cancelled or replaced just ends the looking. It stops when the list leaves the page.
   * @param {string} id @param {string} name
   */
  function follow(id, name) {
    if (following.has(id)) return;
    following.add(id);
    const look = async () => {
      if (el.isConnected === false) return void following.delete(id);
      /** @type {any} */
      let s;
      try {
        s = await call(`/mcp-servers/sign-in/${encodeURIComponent(id)}`);
      } catch (e) {
        following.delete(id);
        return void refused(e);
      }
      if (s.status === "waiting") return void later(look, 2000);
      following.delete(id);
      if (s.status === "done") {
        toast(`Signed in to ${name} on ${s.host}${s.account ? ` as ${s.account}` : ""}; ${reachWords(at())}`);
        // The row as it stands now — another account's sign-in has the place use it (S4b) — is the one tested.
        await refresh();
        const row = (data?.servers || []).find((/** @type {any} */ r) => r.name === name);
        if (row?.spec) return void test(row);
        return;
      } else if (s.status === "failed") toast(`${name}'s sign-in did not finish: ${s.words}`, "err");
      await refresh();
    };
    later(look, 2000);
  }

  /** @param {any} row */
  async function cancelSignIn(row) {
    try {
      await call(`/mcp-servers/sign-in/${encodeURIComponent(row.signIn.id)}`, { method: "DELETE" });
      toast(`The sign-in to ${row.name} is cancelled`);
    } catch (e) {
      refused(e);
    }
    await refresh();
  }

  /**
   * Sign out of the account a server signs in as at its address (HS-D90, HC-151, S4b): asked first, for every place
   * that uses it; the address's other accounts stay.
   * @param {any} row
   */
  async function signOut(row) {
    const named = namesAccount(row);
    const host = `${row.signIn?.host || "its server"}${named ? ` as ${row.signIn.account}` : ""}`;
    const yes = await ask({ title: `Sign out of ${host}?`, description: `Every chat with a server at this address${named ? " that signs in as this account" : ""} loses its tools from its next message.${named ? " Its other accounts stay signed in." : ""} ${row.signIn?.host || "Its server"} is told where it offers that. Sign in again at any time.`, confirmLabel: "Sign out", destructive: true });
    if (!yes) return;
    try {
      const r = await call("/mcp-servers/sign-out", { method: "POST", body: { scope: o.scope, name: row.name } });
      took(r);
      toast(r.signedOut ? `Signed out of ${host}${r.told ? `; ${row.signIn?.host || "its server"} is told` : ""}` : `${row.name} was not signed in`);
    } catch (e) {
      refused(e);
    }
  }

  /** @param {any} row */
  async function test(row) {
    try {
      // A plugin's server is tested by its name: Filament fills it in as this place starts it; the page holds no value of it.
      const server = row.plugin ? { name: row.name, plugin: true } : { name: row.name, ...row.spec };
      const r = await call("/mcp-servers/test", { method: "POST", body: { scope: o.scope, server } });
      toast(`${row.name}: ${r.words}`, r.ok ? "" : "err");
    } catch (e) {
      refused(e);
    }
    await refresh();
  }

  /** What the sheet a list opens hears of each drawing of its rows (a sign-in it waits on). @type {Set<(rows: any[]) => void>} */
  const watchers = new Set();

  /**
   * Add connector (the Designer's of 10-26): the connectors the marketplaces list, for your defaults or a project, the
   * hand-made form behind it; a chat's own list keeps the form alone. `waiting`: a plugin's row that waits for a value —
   * its second step alone, for the place its plugin is on (all chats, a project, a chat).
   * @param {any} [waiting]
   */
  function addConnector(waiting = null) {
    if (!waiting && at() === "session") return void openSheet(null);
    const place = waiting ? String(waiting.pluginPlace || o.scope) : o.scope;
    const placeAt = place === "all" ? "global" : place.startsWith("project:") ? "project" : "session";
    (io.pick || openConnectorPick)({
      scope: place, at: placeAt, label: place === o.scope ? label() : "", onToast: toast, onManual: () => openSheet(null), rows: () => data?.servers || [], refresh,
      signIn: (row) => signIn(row), cancelSignIn: (row) => cancelSignIn(row), openAgain: (row) => openPage(String(row.signIn?.page || "")),
      watch: (fn) => { watchers.add(fn); return () => void watchers.delete(fn); },
      ...(waiting ? { finish: String(waiting.plugin), finishTitle: String(waiting.pluginTitle || waiting.plugin) } : {}),
    });
  }

  /** A plugin that brings this connector alone, turned off for this place: nothing is uninstalled. @param {any} row */
  async function removePlugin(row) {
    const title = row.pluginTitle || row.plugin;
    // On for the Space above the project: turned off for the project alone, the Space keeps it.
    const space = row.spaceId && row.pluginPlace === `project:${row.spaceId}`;
    const description = space ? `${row.spaceName} keeps it; this project's chats lose its tools from their next message.` : "Chats lose its tools from their next message. Add it again from Add connector at any time.";
    const yes = await ask({ title: `Remove ${title} from ${label()}?`, description, confirmLabel: "Remove", destructive: true });
    if (!yes) return;
    try {
      await call(`/plugins/installed/${encodeURIComponent(String(row.plugin))}/on`, { method: "POST", body: { place: o.scope, on: false } });
      toast(`${title} removed from ${label()}`);
    } catch (e) {
      refused(e);
    }
    await refresh();
  }

  async function reset() {
    const yes = await ask({ title: `Back to what ${label()} inherits?`, description: `The servers ${label()} adds, and every switch it set, are taken away. From the next message.`, confirmLabel: "Take them away", destructive: true });
    if (!yes) return;
    try {
      took(await call(path(), { method: "DELETE" }));
      toast(`${label()[0].toUpperCase()}${label().slice(1)} is back to what it inherits`);
    } catch (e) {
      refused(e);
    }
  }

  /** @param {any} row */
  function rowEl(row) {
    const chip = chipOf(row, at(), placeWords());
    const loadChip = loadChipOf(row);
    const lines = [...rowLines(row, at(), now(), placeWords(), { pluginsPage: o.pluginsPage === true }), ...(o.more && !row.orphan ? o.more(row) : [])];
    // The dot says a sign-in under way, or one its server ended or asks for, before a test that went well earlier.
    const st = row.signIn?.state;
    const dot = st === "waiting" ? " is-wait" : st === "ended" || st === "asks" || st === "refused" ? " is-bad" : row.test ? (row.test.ok ? " is-ok" : " is-bad") : "";
    const sign = signInOf(row);
    const signedIn = sign.st === "in" || sign.st === "ended";
    // A plugin's server: what it starts is its plugin's — no Edit, Remove or switch here —; one that waits for a value
    // has nothing to test or load until it is set.
    const theirs = !!row.plugin;
    const ready = !!row.spec && !row.waits?.length;
    // The menu hangs off the button that stands on the page (`standing`): drawn in place, this draw's is the newest
    // words and handler of the one that stood.
    const more = m("button", { class: "mcps-more", type: "button", "data-key": "more", title: `More for ${row.name}`, "aria-label": `More for ${row.name}`, html: ICONS.ellipsis, onclick: () => {
      openMenu([
        ready ? { label: "Test", icon: "zap", onClick: () => test(row) } : null,
        row.spec && !theirs ? { label: row.own ? "Edit" : `Edit for ${label()}`, icon: "pencil", onClick: () => openSheet(row) } : null,
        // The sheet's choice, for this place in one press: its word is the sheet's, its state the row's chip.
        ready ? { type: "switch", label: LOAD_WORDS.core.name, icon: "pin", checked: loadOf(row) === "core", onClick: () => void setLoad(row, loadOf(row) === "core" ? "on-demand" : "core") } : null,
        // What of it this project uses (the owner's word of 10-26: Slack's channels for this project), said to its agents.
        ready && at() === "project" ? { label: `What ${placeWords()} uses…`, icon: "scrollText", onClick: () => openNote(row) } : null,
        sign.can && !signedIn && sign.st !== "waiting" ? { label: "Sign in", icon: "logIn", onClick: () => void signIn(row) } : null,
        sign.can && signedIn ? { label: namesAccount(row) ? `Sign out of ${row.signIn.account}` : "Sign out", icon: "logOut", onClick: () => void signOut(row) } : null,
        // The address's other accounts — other than the one this place signs in with, a sign-in of another waiting or not
        // (found by the Hunter on S4b) —, and another one (S4b).
        ...(sign.can ? (row.signIn?.accounts || []).filter((/** @type {string} */ a) => a !== (row.account || row.signIn?.account || MAIN_ACCOUNT)).map((/** @type {string} */ a) => ({ label: `Use ${a}`, icon: "user", onClick: () => void pick(row, a) })) : []),
        sign.can && sign.st !== "waiting" && (row.signIn?.accounts || []).length > 0 ? { label: "Sign in with another account…", icon: "users", onClick: () => anotherAccount(row) } : null,
        row.own || theirs ? { type: "separator" } : null,
        theirs ? { label: `Open ${row.pluginTitle || row.plugin} in Library › Plugins & Connectors`, icon: "puzzle", onClick: () => openPlugin(String(row.plugin)) } : null,
        row.own ? { label: "Remove", icon: "trash2", variant: "destructive", onClick: () => remove(row) } : null,
        // A plugin that brings this connector and nothing else (the Designer's of 10-26): Remove turns it off here.
        theirs && row.pluginOnly ? { label: "Remove", icon: "trash2", variant: "destructive", onClick: () => void removePlugin(row) } : null,
        // A separator with nothing above it goes.
      ].filter(Boolean).filter((/** @type {any} */ x, /** @type {number} */ i) => i > 0 || x.type !== "separator"), { anchor: standing(more), align: "end" });
    } });
    // The row's own sign-in buttons: the page waited on, or Sign in where the server asks (HS-D83, HS-D87).
    // A plugin's server that waits for a value: Finish setup… asks for it, for the place its plugin is on.
    const signBtns = theirs && row.waits?.length
      ? [btn(m, "Finish setup…", "default", () => addConnector(row), { key: "finish" })]
      : sign.st === "waiting"
        ? [
          btn(m, "Open it again", "ghost", () => openPage(String(row.signIn.page)), { key: "again" }),
          // Its page sends the browser elsewhere than this page's Filament: the address it lands on is pasted.
          ...(elsewhere || !comesBackHere(String(row.signIn.page || ""), here())
            ? [btn(m, "Paste the address…", "ghost", () => pasteSheet(row, { id: String(row.signIn.id), url: String(row.signIn.page || ""), host: row.signIn.host }), { key: "paste" })]
            : []),
          btn(m, "Cancel", "ghost", () => void cancelSignIn(row), { key: "cancel" }),
        ]
        : sign.asks ? [btn(m, "Sign in", "default", () => void signIn(row), { key: "sign" })]
          // Refused: it tries again, outlined (the Designer's of 10-26) — a second refusal opens the sheet again.
          : sign.refused ? [btn(m, "Sign in", "outline", () => void signIn(row), { key: "sign" })] : [];
    if (sign.st === "waiting" && row.signIn.id) follow(String(row.signIn.id), row.name);
    // A plugin's server is on where its plugin is (the Designer's of 10-26): no switch of its own on its row.
    const sw = theirs ? null : m("button", { class: `set-switch${row.on ? " on" : ""}`, type: "button", role: "switch", "data-key": "switch", "aria-checked": row.on ? "true" : "false", "aria-label": `Use ${row.name}`, onclick: () => setOn(row, !row.on) });
    // This place's own word on an inherited server — its switch, account, load and note, one entry — taken back in one
    // press; never on a server it holds, which the same call would remove.
    const back = !row.own && (row.switchedHere || row.pickedHere || row.loadHere || row.noteAt === at())
      ? m("button", { class: "mcps-back", type: "button", "data-key": "back", title: "Back to what it inherits", "aria-label": `${row.name}: back to what it inherits`, html: ICONS.rotateCcw, onclick: () => drop(row, `${row.name} is back to what ${label()} inherits`) })
      : null;
    return m("div", { class: `mcps-row${row.on && !row.orphan ? "" : " is-off"}`, "data-name": row.name, "data-key": row.name },
      m("span", { class: `mcps-dot${dot}`, "aria-hidden": "true" }),
      m("div", { class: "mcps-text" },
        m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, row.name), m("span", { class: `mcps-src${chip.here ? " is-here" : ""}` }, chip.words),
          loadChip ? m("span", { class: `mcps-load${loadChip.here ? " is-here" : ""}`, title: LOAD_WORDS.core.line }, loadChip.words) : null),
        row.spec ? m("div", { class: "mcps-sub mcps-mono", title: runsWords(row) }, runsWords(row)) : null,
        ...lines.map((l) => m("div", { class: `mcps-sub${l.bad ? " is-bad" : ""}`, ...(l.title ? { title: l.title } : {}) }, l.text))),
      row.orphan ? btn(m, "Clear", "ghost", () => drop(row, `The switch for ${row.name} is cleared`), { key: "clear" }) : m("span", { class: "mcps-ctl", "data-key": "ctl" }, ...signBtns, back, sw, more));
  }

  function paint() {
    if (failed && !data) {
      drawIn(el, [m("p", { class: "mcps-failed", "data-key": "failed" }, failed), btn(m, "Try again", "outline", () => refresh(), { key: "again" })]);
      return;
    }
    if (!data) {
      drawIn(el, [m("p", { class: "mcps-quiet", "data-key": "quiet" }, "Reading the connectors…")]);
      return;
    }
    const rows = data.servers || [];
    o.onRows?.(rows);
    for (const fn of watchers) fn(rows);
    const addWords = o.add || (at() === "global" ? "Add connector" : `Add for ${label()} only`);
    drawIn(el, [
      ...(o.title ? [m("h4", { class: "mcps-h", "data-key": "title" }, o.title)] : []),
      ...(data.unread || []).map((/** @type {any} */ u) => m("p", { class: "mcps-unread", "data-key": `unread:${u.at}` }, `The list for ${layerWords(u.at, { spaceName: data.space?.name })} is not read, so chats run without it: ${u.errors.join("; ")}`)),
      rows.length ? m("div", { class: "mcps-rows", "data-key": "rows" }, ...rows.map(rowEl)) : m("p", { class: "mcps-empty", "data-key": "empty" }, o.none || (at() === "global" ? EMPTY_WORDS : `No connectors reach ${label()}.`)),
      m("div", { class: "mcps-acts", "data-key": "acts" },
        btn(m, addWords, "outline", () => addConnector(), { html: ICONS.plus, key: "add" }),
        o.imports ? btn(m, "Import from other apps…", "ghost", () => void openImport(), { key: "import" }) : null,
        at() !== "global" && data.held ? btn(m, `Back to what ${label()} inherits`, "ghost", () => reset(), { key: "reset" }) : null),
      ...(o.foot === null ? [] : [m("p", { class: "mcps-foot", "data-key": "foot" }, o.foot || FOOT_WORDS)]),
    ]);
  }

  /**
   * Import from other apps (HS-D75, HC-79, HC-127 to HC-136): the servers Claude Desktop, Cursor and Codex keep, read
   * when the sheet opens — each app's file with what became of it, each server with a tick where it can be added (a new
   * one ticked, one under a name of yours unticked), how it stands against this place's, and what Filament cannot carry
   * over. Add sends the picks; the server reads the files again, so no credential comes from the page.
   */
  async function openImport() {
    const picked = new Set();
    const list = m("div", { class: "mcps-imp" }, m("p", { class: "mcps-quiet" }, "Reading the other apps' files…"));
    const error = m("p", { class: "mcps-error", role: "alert" });
    const count = m("span", { class: "mcps-says" });
    const addBtn = btn(m, "Add", "default", () => void add(), { disabled: true });
    const body = m("div", { class: "mcps-sheet" }, m("p", { class: "mcps-hint" }, IMPORT_SAYS), list, error,
      m("div", { class: "mcps-sheet-foot" }, count, btn(m, "Cancel", "outline", () => d.close()), addBtn));
    const d = openDialog({ title: "Import from other apps", description: `Into ${label()} · ${reachWords(at(), true)}`, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body, wide: true });
    const key = (/** @type {string} */ source, /** @type {string} */ name) => `${source}\n${name}`;
    const paintCount = () => {
      count.replaceChildren(picked.size ? `${picked.size} to add` : "Tick the servers to add");
      addBtn.toggleAttribute("disabled", !picked.size);
    };
    /** @type {any} */
    let found;
    try {
      found = await call(`/mcp-servers/import?scope=${encodeURIComponent(o.scope)}`);
    } catch (e) {
      list.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)));
      return;
    }
    const foundRow = (/** @type {any} */ s, /** @type {any} */ f) => {
      const k = key(s.id, f.name);
      if (f.mark === "new") picked.add(k);
      const tick = canAdd(f)
        ? /** @type {any} */ (m("input", { type: "checkbox", class: "mrow-tick", "aria-label": `Add ${f.name}`, ...(f.mark === "new" ? { checked: "" } : {}), onchange: (/** @type {any} */ e) => { if (e.target.checked) picked.add(k); else picked.delete(k); paintCount(); } }))
        : m("span", { class: "mcps-imp-gap", "aria-hidden": "true" });
      const words = foundWords(f, s.label, label());
      return m("div", { class: `mcps-row${canAdd(f) ? "" : " is-off"}`, "data-name": f.name },
        tick,
        m("div", { class: "mcps-text" },
          m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, f.name)),
          m("div", { class: "mcps-sub mcps-mono", title: runsWords(f) }, runsWords(f)),
          words ? m("div", { class: "mcps-sub" }, words) : null,
          // What its app keeps elsewhere, or how it comes in: said only where it can come in.
          ...(canAdd(f) ? f.notes || [] : []).map((/** @type {string} */ n) => m("div", { class: "mcps-sub is-warn" }, n))));
    };
    list.replaceChildren(...(found.sources || []).map((/** @type {any} */ s) =>
      m("div", { class: "mcps-imp-app" },
        m("div", { class: "mcps-imp-head" }, m("span", { class: "mcps-name" }, s.label), m("span", { class: `mcps-sub${s.state === "unreadable" ? " is-bad" : ""}` }, sourceWords(s))),
        m("div", { class: "mcps-sub mcps-mono", title: s.path }, s.path),
        s.servers.length ? m("div", { class: "mcps-rows" }, ...s.servers.map((/** @type {any} */ f) => foundRow(s, f))) : null)));
    paintCount();

    async function add() {
      const picks = [...picked].map((k) => ({ source: k.slice(0, k.indexOf("\n")), name: k.slice(k.indexOf("\n") + 1) }));
      addBtn.setAttribute("disabled", "");
      error.replaceChildren("");
      try {
        const r = await call("/mcp-servers/import", { method: "POST", body: { scope: o.scope, picks } });
        took(r);
        d.close();
        if (r.added?.length) toast(`Added ${r.added.join(", ")} for ${label()}; ${reachWords(at(), r.added.length > 1)}`);
        const missed = [...(r.gone || []).map((/** @type {string} */ g) => `${g} left its file`), ...(r.failed || []).map((/** @type {any} */ x) => `${x.name}: ${x.error}`)];
        if (missed.length) toast(`Not added: ${missed.join("; ")}`, "err");
      } catch (e) {
        error.replaceChildren(errText(e));
        addBtn.removeAttribute("disabled");
      }
    }
  }

  /**
   * The sheet: a new server (`row` null), or one to edit — this place's own, or one it inherits, which Save writes as
   * this place's server of the same name (it replaces the inherited one here).
   * @param {any} row
   */
  function openSheet(row) {
    const inherited = !!row && !row.own;
    const spec = row?.spec || {};
    const st = {
      way: /** @type {"stdio" | "http"} */ (spec.url ? "http" : "stdio"),
      sse: spec.type === "sse",
      // What the row loads at this place: an inherited server's too, which Save then keeps on this place's own.
      load: loadOf(row),
      /** @type {Record<string, any>[]} */ pasted: [],
      /** @type {Set<number>} */ saved: new Set(),
      /** @type {number} */ from: -1,
      /** @type {any} */ result: null,
      busy: false,
    };
    const field = (/** @type {Record<string, any>} */ attrs) => m("input", { class: "zc-input mcps-input", type: "text", spellcheck: "false", autocomplete: "off", ...attrs });
    const name = field({ value: row?.name || "", placeholder: "github", "aria-label": "Name", ...(inherited ? { disabled: "" } : {}) });
    const command = field({ value: spec.command || "", placeholder: "npx", "aria-label": "Command" });
    const args = field({ value: joinArgs(spec.args), placeholder: "-y @modelcontextprotocol/server-github", "aria-label": "Arguments" });
    const cwd = field({ value: spec.cwd || "", placeholder: "the chat's folder", "aria-label": "Folder" });
    const url = field({ value: spec.url || "", placeholder: "https://mcp.example.com/mcp", "aria-label": "Address" });
    const env = pairs(spec.env, "Add variable", "NAME", "variable");
    const headers = pairs(spec.headers, "Add header", "Authorization", "header");
    const warn = m("p", { class: "mcps-warn" });
    const sseNote = m("p", { class: "mcps-warn" });
    const result = m("div", { class: "mcps-result" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const says = m("span", { class: "mcps-says" });
    const pasteBox = m("textarea", { class: "zc-input mcps-paste", rows: "6", spellcheck: "false", placeholder: '{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "…" } } } }', "aria-label": "JSON from the server's page" });
    const pasteError = m("p", { class: "mcps-error" });
    const pastePick = m("div", { class: "mcps-pick" });
    const pasteArea = m("div", { class: "mcps-paste-area", hidden: "" }, pasteBox, m("div", { class: "mcps-paste-acts" }, btn(m, "Fill from JSON", "outline", () => fill())), pasteError, pastePick);
    const caret = m("span", { class: "mcps-caret", "aria-hidden": "true", html: ICONS.chevronRight });
    const disclose = m("button", { class: "mcps-disclose", type: "button", "aria-expanded": "false" }, caret, "Paste JSON from the server's page", m("span", { class: "mcps-hint" }, "Claude Desktop, Cursor or VS Code's block"));
    disclose.addEventListener("click", () => {
      const open = pasteArea.hasAttribute("hidden");
      pasteArea.toggleAttribute("hidden", !open);
      disclose.setAttribute("aria-expanded", open ? "true" : "false");
    });
    const stdioRows = m("div", { class: "mcps-fields" },
      formRow("Command", command), formRow("Arguments", args), formRow("Folder", cwd, FOLDER_HINT), formRow("Environment", env.el, "A value whose name looks like a key or a token is never shown again, logged, or kept unsealed."));
    const httpRows = m("div", { class: "mcps-fields" }, formRow("Address", url), formRow("Headers", headers.el, "A header that carries a key is never shown again, logged, or kept unsealed."), sseNote);
    const wayBtns = /** @type {Record<string, any>} */ ({});
    const way = m("div", { class: "set-seg", role: "tablist", "aria-label": "Reached by" },
      ...[["stdio", "A command"], ["http", "An address"]].map(([id, words]) => (wayBtns[id] = m("button", { class: "set-seg-btn", type: "button", role: "tab", onclick: () => { st.way = /** @type {any} */ (id); show(); } }, words))));
    // How its tools load: Reached by's look, a choice's semantics — one Tab stop, the arrows move it — and under it the
    // chosen one's line, as Test's word follows the way; each button's title is its own line, to compare.
    const loads = /** @type {("on-demand" | "core")[]} */ (Object.keys(LOAD_WORDS));
    const loadBtns = /** @type {Record<string, any>} */ ({});
    const pickLoad = (/** @type {"on-demand" | "core"} */ id) => { st.load = id; show(); };
    const load = m("div", {
      class: "set-seg", role: "radiogroup", "aria-label": "Tools",
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = loads[(loads.indexOf(st.load) + step + loads.length) % loads.length];
        pickLoad(next);
        loadBtns[next].focus();
      },
    }, ...loads.map((id) => (loadBtns[id] = m("button", { class: "set-seg-btn", type: "button", role: "radio", title: LOAD_WORDS[id].line, onclick: () => pickLoad(id) }, LOAD_WORDS[id].name))));
    const loadLine = m("span", { class: "mcps-hint" });
    const testBtn = btn(m, "Test", "outline", () => runTest());
    const saveBtn = btn(m, "Save", "default", () => save());
    const body = m("div", { class: "mcps-sheet" },
      m("div", { class: "mcps-fields" }, formRow("Name", name, inherited ? `Inherited from ${layerWords(row.from, row)}: Save keeps this as ${label()}'s own server of the same name, in its place here.` : ""), formRow("Reached by", way)),
      stdioRows, httpRows, warn,
      // After how it is reached, how the agent gets its tools: the same for a command and an address.
      m("div", { class: "mcps-fields mcps-load-field" }, formRow("Tools", load, loadLine)),
      disclose, pasteArea,
      result, error,
      m("div", { class: "mcps-sheet-foot" }, says, testBtn, btn(m, "Cancel", "outline", () => d.close()), saveBtn));
    const title = row ? (inherited ? `Edit ${row.name} for ${label()}` : `Edit ${row.name}`) : "Add an MCP server";
    const d = openDialog({ title, description: `For ${label()} · ${reachWords(at())}`, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }), body, wide: true });
    args.addEventListener("input", () => show());
    show();
    name.focus();

    /** @param {string} words @param {any} control @param {string | HTMLElement} [hint]  words, or the hint's own element where it changes */
    function formRow(words, control, hint = "") {
      return m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, words), m("div", { class: "mcps-v" }, control, typeof hint !== "string" ? hint : hint ? m("span", { class: "mcps-hint" }, hint) : null));
    }

    /**
     * Rows of names and values: a value the server keeps as a credential shows as set, with Replace. `keyWord` names a
     * row's kind for a screen reader: "Variable name", and "Value of GITHUB_TOKEN" once the name is typed.
     * @param {Record<string, string> | undefined} start @param {string} addWords @param {string} keyHint @param {string} keyWord
     */
    function pairs(start, addWords, keyHint, keyWord) {
      const box = m("div", { class: "mcps-pairs" });
      /** @type {{ key: any, value: any, kept: boolean }[]} */
      let list = [];
      const valueLabel = (/** @type {string} */ k) => `Value of ${k || `the new ${keyWord}`}`;
      const put = (/** @type {string} */ k, /** @type {string} */ v) => {
        const kept = v === SECRET_MARK;
        const value = kept ? null : field({ value: v, placeholder: "value", "aria-label": valueLabel(k) });
        const key = field({ value: k, placeholder: keyHint, class: "zc-input mcps-input mcps-key", "aria-label": `${keyWord[0].toUpperCase()}${keyWord.slice(1)} name`, oninput: () => value?.setAttribute("aria-label", valueLabel(key.value)) });
        list.push({ key, value, kept });
      };
      const draw = () => {
        box.replaceChildren(
          ...list.map((p, i) => m("div", { class: "mcps-pair" },
            p.key,
            p.kept
              ? m("span", { class: "mcps-masked" }, m("span", { "aria-label": "set, hidden" }, "••••••••••"), btn(m, "Replace", "ghost", () => { list[i] = { ...p, kept: false, value: field({ value: "", placeholder: "the new value", "aria-label": "New value" }) }; draw(); }))
              : p.value,
            m("button", { class: "mcps-x", type: "button", title: "Remove", "aria-label": "Remove", html: ICONS.x, onclick: () => { list.splice(i, 1); draw(); } }))),
          btn(m, addWords, "ghost", () => { put("", ""); draw(); }, { html: ICONS.plus }));
      };
      const load = (/** @type {Record<string, string> | undefined} */ map) => {
        list = [];
        for (const [k, v] of Object.entries(map || {})) put(k, String(v));
        draw();
      };
      load(start);
      return {
        el: box,
        load,
        /** The map, a kept credential as the placeholder the server puts back. @returns {Record<string, string>} */
        value() {
          /** @type {Record<string, string>} */
          const out = {};
          for (const p of list) {
            const k = String(p.key.value || "").trim();
            if (k) out[k] = p.kept ? SECRET_MARK : String(p.value?.value ?? "");
          }
          return out;
        },
      };
    }

    /** The server as the sheet stands. */
    function entry() {
      const n = String(name.value || "").trim();
      if (st.way === "http") {
        const hd = headers.value();
        return { name: n, url: String(url.value || "").trim(), ...(Object.keys(hd).length ? { headers: hd } : {}), ...(st.sse ? { type: "sse" } : {}) };
      }
      const a = splitArgs(String(args.value || ""));
      const e = env.value();
      const folder = String(cwd.value || "").trim();
      return { name: n, command: String(command.value || "").trim(), ...(a.length ? { args: a } : {}), ...(Object.keys(e).length ? { env: e } : {}), ...(folder ? { cwd: folder } : {}) };
    }

    /** Why Save waits, in words; "" when it may go. */
    function waits() {
      const e = /** @type {any} */ (entry());
      if (!e.name) return "Name it: a-z, 0-9 and -, up to 32 characters";
      if (!NAME_RE.test(e.name)) return "A name is a-z, 0-9 and -, starting with a letter, up to 32 characters";
      if (e.name === "filament") return "\"filament\" is Filament's own server's name";
      if (st.way === "stdio" && !e.command) return "Say the command that starts it";
      if (st.way === "http" && !/^https?:\/\//.test(e.url)) return "Say its address: http:// or https://";
      return "";
    }

    function show() {
      stdioRows.toggleAttribute("hidden", st.way !== "stdio");
      httpRows.toggleAttribute("hidden", st.way !== "http");
      for (const [id, b] of Object.entries(wayBtns)) {
        b.classList.toggle("on", id === st.way);
        b.setAttribute("aria-selected", id === st.way ? "true" : "false");
      }
      for (const [id, b] of Object.entries(loadBtns)) {
        b.classList.toggle("on", id === st.load);
        b.setAttribute("aria-checked", id === st.load ? "true" : "false");
        b.setAttribute("tabindex", id === st.load ? "0" : "-1");
      }
      loadLine.replaceChildren(`${LOAD_WORDS[st.load].line} ${LOAD_FOR}`);
      says.replaceChildren(TEST_SAYS[st.way]);
      warn.replaceChildren(st.way === "stdio" && keyInArgs(splitArgs(String(args.value || ""))) ? KEY_IN_ARGS : "");
      sseNote.replaceChildren(st.sse ? OLD_SSE : "");
      const r = st.result;
      result.replaceChildren(...(r
        ? [m("div", { class: "mcps-result-head" }, m("span", { class: `mcps-dot ${r.ok ? "is-ok" : "is-bad"}` }), r.ok ? `Connected · ${r.words}` : r.words),
          ...(r.ok && r.tools?.length ? [m("div", { class: "mcps-tools" }, ...r.tools.map((/** @type {any} */ t) => m("span", { class: `mcps-tool${t.readOnly ? " is-read" : ""}`, title: t.readOnly ? "only reads" : "may change things" }, t.name)))] : []),
          ...(!r.ok && r.output ? [m("pre", { class: "mcps-output" }, r.output)] : []),
          ...(!r.ok && r.signIn ? [m("div", { class: "mcps-sub" }, SIGN_IN_AFTER_SAVE)] : [])]
        : []));
      result.classList.toggle("is-bad", !!r && !r.ok);
      result.toggleAttribute("hidden", !r);
      pastePick.replaceChildren(...(st.pasted.length > 1
        ? [m("span", { class: "mcps-hint" }, `${st.pasted.length} servers in this JSON: each is tested and saved on its own.`),
          ...st.pasted.map((p, i) => btn(m, `${st.saved.has(i) ? "✓ " : ""}${p.name || "unnamed"}`, i === st.from ? "secondary" : "ghost", () => use(i)))]
        : []));
    }

    /** Fill the sheet from the pasted block. */
    function fill() {
      pasteError.replaceChildren("");
      try {
        st.pasted = parseServersJson(String(pasteBox.value || ""));
        st.saved = new Set();
        use(0);
      } catch (e) {
        st.pasted = [];
        pasteError.replaceChildren(errText(e));
        show();
      }
    }

    /** One pasted server into the sheet. @param {number} i */
    function use(i) {
      const p = st.pasted[i];
      st.from = i;
      st.result = null;
      st.way = p.url ? "http" : "stdio";
      st.sse = p.type === "sse";
      if (!inherited) name.value = p.name || "";
      command.value = p.command || "";
      args.value = joinArgs(p.args);
      cwd.value = p.cwd || "";
      url.value = p.url || "";
      env.load(p.env);
      headers.load(p.headers);
      error.replaceChildren("");
      show();
    }

    async function runTest() {
      const why = waits();
      if (why) return void error.replaceChildren(why);
      error.replaceChildren("");
      if (st.busy) return;
      st.busy = true;
      testBtn.setAttribute("disabled", "");
      result.removeAttribute("hidden");
      result.replaceChildren(m("div", { class: "mcps-result-head" }, m("span", { class: "mcps-dot is-wait" }), st.way === "http" ? "Connecting…" : "Starting it and asking for its tools…"));
      try {
        // A server being renamed is tested by its kept name: its hidden credentials are kept under that one.
        st.result = await call("/mcp-servers/test", { method: "POST", body: { scope: o.scope, server: { ...entry(), ...(row ? { name: row.name } : {}) } } });
      } catch (e) {
        st.result = null;
        error.replaceChildren(errText(e));
      } finally {
        st.busy = false;
        testBtn.removeAttribute("disabled");
        show();
      }
    }

    async function save() {
      const why = waits();
      if (why) return void error.replaceChildren(why);
      error.replaceChildren("");
      const e = entry();
      const key = row?.name || e.name;
      saveBtn.setAttribute("disabled", "");
      try {
        // The load as the sheet shows it, always: what Save keeps is what was seen. Test sends none — it only connects.
        took(await call(path(`/${encodeURIComponent(key)}`), { method: "PUT", body: { ...e, load: st.load } }));
        toast(row ? `${e.name} changed for ${label()}; from the next message` : `${e.name} added for ${label()}; ${reachWords(at())}`);
        if (st.from >= 0) st.saved.add(st.from);
        const next = st.pasted.findIndex((_, i) => !st.saved.has(i));
        if (!row && next >= 0) {
          // The next pasted server is another server: it starts as a new one does, not as the last one was saved.
          st.load = DEFAULT_LOAD;
          use(next);
        } else d.close();
      } catch (err) {
        error.replaceChildren(errText(err));
      } finally {
        saveBtn.removeAttribute("disabled");
      }
    }
  }

  /** Whether this list asked its remote servers if they want a sign-in: once, as it first draws. */
  let asked = false;

  /**
   * Its remote servers that are on, untested and with no sign-in held, asked whether they want one (the owner's of
   * 10-26: Linear's row said nothing of it until a test): a row that asks then says so, with Sign in on it. A look that
   * fails changes nothing: the row's test says what is wrong.
   */
  async function askOnce() {
    if (asked || !(data?.servers || []).some((/** @type {any} */ r) => r.on && signInOf(r).can && !r.signIn && !r.test)) return;
    asked = true;
    try {
      const r = await call("/mcp-servers/look", { method: "POST", body: { scope: o.scope } });
      if (r?.changed && el.isConnected !== false) took(r);
    } catch {}
  }

  paint();
  void refresh().then(() => {
    // A plugin just installed here goes on to its setup (the Designer's of 10-26), as a row's Finish setup… does.
    if (o.finish) addConnector({ plugin: o.finish.plugin, pluginTitle: o.finish.title, pluginPlace: o.scope });
    return askOnce();
  });
  return { el, refresh, data: () => data };
}
