// @ts-check
// The admin API's remote area (the owner's remote Filament of 11-06, Part 1): pairing another machine's page or CLI
// with this Filament, and the devices paired. A pairing starts on this machine alone — a code, shown here, typed or
// followed there — and its claim is the one row answered before any caller is known (index.js): the code is what it
// proves. A page's claim is answered with an HttpOnly, SameSite=Strict cookie (Secure over https) and never sees its
// token; a claim with no Origin — the CLI — gets the token once, for its Bearer. Devices are listed, renamed and revoked
// by this machine, the admin token or a full device; a device signs itself out. A full device mints its machine's
// agents a device of their own here, whose grants the same managers set (the remote-agents plan's f-grant).
import { sendJson } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, parse, relative, resolve, sep } from "node:path";
import { DEVICE_COOKIE_DAYS, PAIR_PAGE, callerAddress, deviceCookie, drives, forwardedHttps, isLoopback, lapsedDevice, sealedWay } from "../guards.js";
import { printOf } from "../../core/x509.js";
import { allowThroughFirewall, firewallVerdict, readFirewall } from "../../services/lan-tls.js";
import { lowerHeaders } from "../../core/headers.js";
import { networkShare, outsideRootsWords, realFolder, underRoots } from "../../app/agent/turn.js";
import { MODEL_MARKS } from "../../app/acp-turn.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { PERMISSION_MODES } from "../../app/agent/prompt.js";
import { GRANTS } from "../../services/devices.js";
import { copiesRootOf } from "../../services/copies.js";
import { CREDENTIAL_FOLDERS, credentialFolderOf } from "../../core/secret-files.js";
import { keptFromAgents, keptRefusal } from "../../adapters/tools/fs-fence.js";
import { PROTO_KEYS, flatten } from "../../services/session-settings.js";
import { CONVERSATION_HEADERS } from "../../core/conversation.js";

/**
 * What a view-only device reads (the owner's of 11-06): the chats, their turns and live state, runs and their events,
 * the task graph, flows, the lists the page draws, traffic and usage, and the project's files and git as read — GETs
 * alone, and of them none that acts (tests a provider with its key, fetches a model list afresh, starts an agent, reads
 * the keys, lists this machine's folders). Anything else is refused it, a row added later included, until it is named
 * here. Each is a row's own pattern, as the admin API's router matched it (`viewReads`): a path another row answers is
 * that row's, however it is shaped (the review of 882809c20: /sessions/:id/flows/uncommitted, a git walk, has
 * /sessions/:id/flows/:fid's shape and comes first).
 */
export const VIEW_ROUTES = Object.freeze([
  // What Filament is, and its live stream.
  "/state", "/commands", "/features", "/alerts", "/jobs", "/live", "/events", "/schema", "/remote/me",
  // The chats.
  "/sessions/holders", "/sessions/:id", "/sessions/:id/goal", "/sessions/:id/live-state", "/sessions/:id/requests",
  "/sessions/:id/subagents", "/sessions/:id/subagents/views", "/sessions/:id/subagents/:sid", "/sessions/:id/second-looks/:sid",
  "/sessions/:id/graph/kept", "/sessions/:id/subagents/:sid/changes", "/sessions/:id/subagents/:sid/calls/:call/change",
  "/sessions/:id/transcript", "/sessions/:id/turns/:n/work", "/sessions/:id/turns/:n/calls/:call/change", "/sessions/:id/turns/:n/calls/:call/result",
  "/sessions/:id/turns/:n/visuals/:vid", "/sessions/:id/visuals/:vid", "/sessions/:id/settings", "/sessions/:id/settings/history",
  "/sessions/:id/commands", "/sessions/:id/beside", "/defaults/settings",
  // The archive's chat list and turns.
  "/memory/status", "/memory/sessions", "/memory/sessions/:id", "/memory/sessions/:id/turns/:n/memory", "/memory/sessions/:id/lineage",
  "/memory/sessions/:id/changes", "/memory/sessions/:id/outputs", "/memory/projects", "/memory/turns/:id",
  // Runs.
  "/runs", "/runs/:id", "/runs/:id/events", "/runs/:id/changes", "/runs/:id/agent-commands", "/runs/images/:ref",
  // Flows.
  "/sessions/:id/flows", "/sessions/:id/flows/:fid", "/sessions/:id/flows/:fid/boxes/:bid", "/flows/saved",
  // The lists the page draws.
  "/teams", "/agents", "/skills", "/coding-agents", "/coding-agents/icons/:id", "/model-routes", "/agent-accounts", "/spaces", "/spaces/own",
  "/artifacts", "/artifacts/:name", "/artifacts/:name/text",
  // Traffic and usage.
  "/requests", "/requests/:id*", "/requests/:id/replays", "/requests/:id/composition", "/ops", "/usage/summary", "/usage/daily", "/usage/days", "/usage/days.csv", "/usage/breakdown", "/usage/timeline", "/usage/upstreams",
  // The project's files and git, as read.
  "/files/tree", "/files/read", "/git/status", "/git/log", "/git/branches",
]);
const viewRows = new Set(VIEW_ROUTES);
/** The paths below are under /api. A device that lapsed unused may still sign itself out (index.js). */
export const SIGN_OUT_PATH = "/remote/sign-out";
/**
 * Whether a view-only device may make this request: a GET whose row (its pattern, as the router matched it) it reads,
 * and the one write that is its own — signing itself out. No row matched: nothing.
 * @param {string} method @param {string | null | undefined} pattern  the matched row's, under /api
 */
export const viewReads = (method, pattern) => !!pattern && ((method === "GET" && viewRows.has(pattern)) || (method === "POST" && pattern === SIGN_OUT_PATH));

/**
 * What another machine's agents reach here while their grant `agents` is on (the remote-agents plan's f-grant): a chat
 * of their own — started, sent its turns, followed with its sub-agents, its asks answered, its turn stopped — a file of
 * its folder, what Filament is, the clones it knows and the models that answer here, which their sub-agent's chat runs
 * on (s-launch), what this machine has to work with — CPUs, memory, GPU, coding agents —, which they choose by
 * (p-caps), a command run in such a folder (exec.js), its own alone, and what this machine's Spaces of a repository
 * wrote, which their machine's Space of it pulls (sp-cross: spaces.js, of folders they may use). Never Settings, config,
 * keys, providers, pairing, devices or a stop of Filament: a prompt injected into an agent there reaches none of them. Each is
 * `<method> <the row's own pattern>`, as the admin API's router matched it; a row added later is refused them until it
 * is named here. A row of a chat or a run answers them for the chats they started alone (index.js `notTheirs`).
 */
export const AGENT_ROUTES = Object.freeze([
  // Who they are, what Filament is, the clones of a project it knows, the models that answer here, and what this machine
  // has to work with now.
  "GET /remote/me", "GET /state", "GET /clones", "GET /models", "GET /machine/caps",
  // A chat: started, its turns sent, followed, stopped.
  "POST /sessions", "GET /sessions/:id", "GET /sessions/:id/live-state", "POST /sessions/:id/turns", "GET /runs/:id/events", "POST /sessions/:id/stop",
  // Its asks, listed and answered.
  "GET /sessions/:id/asks", "POST /runs/:id/answer", "POST /sessions/:id/asks/:ask/answer", "POST /sessions/:id/subagents/:sid/answer",
  // Its sub-agents, followed.
  "GET /sessions/:id/subagents", "GET /sessions/:id/subagents/:sid",
  // A file of its folder, as read.
  "GET /files/read",
  // A command run in a folder a chat of theirs may start in, followed, stopped, its ask answered.
  "POST /exec", "GET /exec/:id", "POST /exec/:id/stop", "POST /exec/:id/answer",
  // What this machine's Spaces of a repository wrote, for their machine's Space of it.
  "GET /spaces/machine-feed",
  // A copy of their project sent here, into their machine's store, and checked out into a copy of theirs; what its
  // sub-agent changed there, read back (transfers.js).
  "GET /transfers/haves", "POST /transfers", "POST /transfers/:id/part", "POST /transfers/:id/commit", "POST /transfers/place",
  "POST /transfers/back", "GET /transfers/back/:id",
]);
const agentRows = new Set(AGENT_ROUTES);
/** The row that answers another machine's agents with their grant off too: they can say why they are refused. */
const AGENT_ME_ROW = "GET /remote/me";

/**
 * Why another machine's agents' device may not make this request, in words; null where it may: /remote/me always, and
 * while its grant `agents` is on, a row of AGENT_ROUTES. No row matched: nothing.
 * @param {string} method @param {string} path  as asked, under /api @param {string | null | undefined} pattern  the matched row's
 * @param {{ name: string, grants?: { agents?: boolean } }} device
 */
export function agentRefusal(method, path, pattern, device) {
  const row = pattern ? `${method} ${pattern}` : "";
  if (row === AGENT_ME_ROW) return null;
  if (device.grants?.agents !== true) return `${device.name} may not run agents here: its grant is switched on in Settings › Remote access — by this computer, or a full device paired with it`;
  return agentRows.has(row) ? null : `another machine's agents start and follow chats here; ${method} ${path} is more than that`;
}

/**
 * What another machine's agents may send in the body of each write AGENT_ROUTES names (the remote-agents plan's
 * f-fence): what a chat needs to start — its folder, its model, its effort, its mode (`settings`, AGENT_SETTINGS alone;
 * the mode capped by their grants at each call), a title, `preset` none —, a turn's message and how its reply comes, an
 * answer to an ask, a command's folder, words, timeout and mode, capped by their grants as a chat's (never a shell, an
 * environment or stdin). Never a setting that
 * runs or reads (a hook, an MCP server, a language server, a file of instructions), a press of Allow (`allow`; an ask's press
 * comes through the asks routes, from the person at the other machine), a session to load, a worktree or what it copies,
 * a Space's hand-off: any other field is refused, named (`agentBodyRefusal`). A write row added to AGENT_ROUTES takes
 * no field until its fields are named here.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const AGENT_BODIES = Object.freeze({
  "POST /sessions": ["cwd", "model", "title", "autoTitle", "preset", "settings"],
  "POST /sessions/:id/turns": ["content", "stream", "runEvents", "sendAsIs", "sendId", "settingsPatch"],
  // Its Stop, never the Force stop.
  "POST /sessions/:id/stop": [],
  "POST /runs/:id/answer": ["ask", "outcome", "answers", "reason"],
  "POST /sessions/:id/asks/:ask/answer": ["allow", "choice", "words", "go", "outcome", "answers", "reason", "stream", "runEvents"],
  "POST /sessions/:id/subagents/:sid/answer": ["answer", "allow", "go", "ask"],
  "POST /exec": ["cwd", "command", "timeoutMs", "mode"],
  "POST /exec/:id/answer": ["allow", "choice", "words"],
  "POST /transfers": ["project", "repo", "bytes", "sha256"],
  "POST /transfers/:id/part": ["offset", "data"],
  "POST /transfers/:id/commit": [],
  "POST /transfers/place": ["project", "repo", "commit"],
  "POST /transfers/back": ["copy", "chat", "haves"],
});
/**
 * The settings their chat takes from them, at its start (`settings`) and in a turn (`settingsPatch`): its model and
 * effort, and its permission mode — the mode of the chat that sent them (the owner's of 11-10), which their device's
 * grants cap at each call: Full access without Without asking or Full control runs as Edit (turn.js `sessionMode`).
 */
const AGENT_SETTINGS = Object.freeze(["model.name", "model.effort", "loop.permissions"]);
/**
 * What this Filament takes from another machine's agents beyond what every Filament that let them in did, each by its
 * name, said to them in GET /state (`takes`): theirs sends a field where its name is said, and never reads a refusal's
 * words to learn whether it was taken. `mode`: a chat's permission mode (AGENT_SETTINGS `loop.permissions`);
 * `exec-mode`: a command's, the mode of the chat that sent it (POST /exec `mode`, exec.js); `transfer`: a copy of their
 * project, sent as a git bundle into their machine's store (transfers.js); `copy`: one checked out into a copy of
 * theirs for a launch, whose chat holds it (POST /transfers/place); `back`: what its sub-agent changed there, read
 * back (POST /transfers/back); `repo`: what tells their project's repository from another of its folder's name, which
 * its store and copies here are found by (`repo` beside `project` in the transfers' rows).
 */
export const AGENT_TAKES = Object.freeze(["mode", "exec-mode", "transfer", "copy", "back", "repo"]);
/**
 * A message's block their turn takes: words, and a picture or a document carried whole — never one named by a URL, which
 * a coding agent is handed to open (acp/bridge.js), nor a tool's call or result. @param {any} b
 */
const plainBlock = (b) =>
  !!b && typeof b === "object" && (b.type === "text" ? typeof b.text === "string" : (b.type === "image" || b.type === "document") && (b.source?.type === "base64" || (b.type === "document" && b.source?.type === "text")));

/**
 * The first key of a body, at any depth, that opens an object's prototype (session-settings.js `PROTO_KEYS`), or "": the
 * keys JSON.parse made, walked without recursion, so a deep body costs no stack.
 * @param {unknown} body
 */
const protoKeyIn = (body) => {
  const todo = [body];
  while (todo.length) {
    const v = /** @type {any} */ (todo.pop());
    if (!v || typeof v !== "object") continue;
    for (const k of Object.keys(v)) {
      if (PROTO_KEYS.includes(k)) return k;
      todo.push(v[k]);
    }
  }
  return "";
};

/**
 * Why another machine's agents may not name this model, in words; null where they may: a name held as a string, with no
 * mark the model's name is read by beyond the model (acp-turn.js `MODEL_MARKS`: a coding agent's mode, one of its
 * sessions here, a route's own words) — the person's own chats keep them. None named is the chat's own model.
 * @param {string} where  the field, as the words name it @param {unknown} name
 * @returns {string | null}
 */
export function agentModelRefusal(where, name) {
  if (name == null) return null;
  if (typeof name !== "string") return `another machine's agents name a model in words; ${where} is no string`;
  const mark = [...name].find((c) => Object.hasOwn(MODEL_MARKS, c));
  return mark ? `another machine's agents name a model alone; ${where} holds "${mark}", which names ${MODEL_MARKS[mark]}` : null;
}

/**
 * Why another machine's agents may not send this body to the row `row` (`<method> <pattern>`), in words; null where they
 * may: no key that opens a prototype at any depth (`protoKeyIn`; the security review of f-fence: `__proto__` in
 * `settingsPatch` carried an MCP server past every check), each field one AGENT_BODIES names for it, `settings` and
 * `settingsPatch` holding AGENT_SETTINGS alone, the model they name a name alone (`agentModelRefusal`), a message's
 * blocks plain (`plainBlock`). A body that is no object is the row's to refuse.
 * @param {string} row @param {unknown} body
 * @returns {string | null}
 */
export function agentBodyRefusal(row, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const proto = protoKeyIn(body);
  if (proto) return `another machine's agents send fields by their names; ${proto} opens an object's prototype, and names none`;
  const fields = AGENT_BODIES[row] || [];
  const b = /** @type {Record<string, any>} */ (body);
  const more = Object.keys(b).find((k) => !fields.includes(k));
  if (more) return `another machine's agents send ${row} ${fields.length ? `${fields.join(", ")} alone` : "nothing"}; ${more} is more than that`;
  for (const k of ["settings", "settingsPatch"]) {
    const flat = b[k] && typeof b[k] === "object" ? flatten(b[k]) : null;
    const extra = flat ? Object.keys(flat).find((p) => !AGENT_SETTINGS.includes(p)) : null;
    if (extra) return `another machine's agents set a chat's ${AGENT_SETTINGS.slice(0, -1).join(", ")} and ${AGENT_SETTINGS.at(-1)} alone; ${k}: ${extra} is more than that`;
    const named = flat ? agentModelRefusal(`${k}: model.name`, flat["model.name"]) : null;
    if (named) return named;
    // Their effort a level's name, or none: the f-grant hunt's — any value passed, a number among them.
    const effort = flat?.["model.effort"];
    if (effort != null && !SUBAGENT_EFFORTS.includes(/** @type {any} */ (effort))) return `another machine's agents set a chat's effort by a level's name, ${SUBAGENT_EFFORTS.join(", ")}; ${k}: model.effort is ${JSON.stringify(effort)}`;
    const mode = flat?.["loop.permissions"];
    if (mode != null && !PERMISSION_MODES.includes(/** @type {any} */ (mode))) return `another machine's agents set a chat's mode by its name, ${PERMISSION_MODES.join(", ")}; ${k}: loop.permissions is ${JSON.stringify(mode)}`;
  }
  const model = Object.hasOwn(b, "model") ? agentModelRefusal("model", b.model) : null;
  if (model) return model;
  if (Array.isArray(b.content) && !b.content.every(plainBlock)) return "another machine's agents send words, and pictures or documents carried whole (base64): content holds more than that";
  return null;
}

/**
 * The x-filament headers another machine's agents' client sends (services/machines/client.js): that it is a client of
 * Filament's, and when its message was sent. Any other is refused them — a mode (`-permissions`), memory's (`-memory`,
 * `-memory-load`), a folder (`-cwd`), a conversation's identity (`-conversation`, and the clients' own,
 * core/conversation.js), the house's own —, whichever row it rides to (`agentHeaderRefusal`).
 */
const AGENT_HEADERS = Object.freeze(["x-filament-ui", "x-filament-sent-at"]);
/**
 * Why another machine's agents may not send a request with these headers, in words; null where they may.
 * @param {Record<string, string>} headers  lower-cased names
 * @returns {string | null}
 */
export function agentHeaderRefusal(headers) {
  const no = Object.keys(headers).find((h) => (h.startsWith("x-filament-") && !AGENT_HEADERS.includes(h)) || CONVERSATION_HEADERS.includes(h));
  return no ? `another machine's agents send ${AGENT_HEADERS.join(" and ")} of Filament's headers alone; ${no} is more than that` : null;
}

/**
 * The view rows that read a folder this machine names by `?cwd=` (files.js, git.js `rootOf`): a view device's is fenced
 * further (`viewFolderRefusal`). A view row added later that reads a folder joins this list.
 */
export const VIEW_FOLDER_ROWS = Object.freeze(["/files/tree", "/files/read", "/git/status", "/git/log", "/git/branches", "/memory/sessions/:id/changes"]);

/**
 * A path where the filesystem itself resolves it (`realpathSync.native`): on Windows a short name (`SSH~1`) at its long
 * one, as the folder rules' own read (turn.js `realFolder`) leaves it — that read where the native one fails (a path not
 * there, a volume that answers it no final path). Its long form's `\\?\` before a drive is dropped, as no other key has
 * it. @param {string} p
 */
const resolvedFolder = (p) => {
  try {
    return realpathSync.native(p).replace(/^\\\\\?\\(?=[A-Za-z]:)/, "");
  } catch {
    return realFolder(p);
  }
};
/**
 * A folder's path to compare by: resolved through the filesystem (`resolvedFolder`), without its last separator, in one
 * case on Windows. A root keeps its own: "C:" alone is that drive's current folder, not its root (turn.js `underRoots`
 * says the same) — keyed so, a chat at another volume's root passed as a folder like any other, and opened the whole
 * volume (the hunt of sec-view). @param {string} p
 */
const folderKey = (p) => {
  const real = resolvedFolder(p);
  const r = real === parse(real).root ? real : real.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};
/** Whether `inner` is `outer` or lies inside it (both keys). @param {string} inner @param {string} outer */
const within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);

/**
 * Why a view-only device may not read the folder `cwd`, in words; null where it may (the security review of 882809c20:
 * with agentLoop.roots empty, the default, its `cwd` was any folder — the data folder's secret.key and sealed
 * config.json read whole, which open the admin token, the inbound and the provider keys). It reads where this
 * Filament's chats work (`folders`: their folders, their projects', the places their agents wrote) and inside them —
 * never the data folder, inside it or around it, and never through a chat whose folder is a home folder, what holds
 * one, or a drive's root, which would open everything under it. A folder on another computer's share is refused before
 * the disk is asked of it (turn.js `networkShare`). A full device, the admin token and this computer drive this
 * Filament — a terminal included — and are fenced only as the folder rules fence anyone. Another machine's agents' device
 * reads a file by the same fence in its own chats' folders alone (index.js), `device` and `chats` naming them in the words.
 * @param {string} cwd @param {{ folders: readonly string[], dataDir: string, home?: string, device?: string, chats?: string }} o
 * @returns {string | null}
 */
export function viewFolderRefusal(cwd, { folders, dataDir, home = homedir(), device = "a view-only device", chats = "this Filament's chats" }) {
  const asked = String(cwd || "").trim();
  if (!asked) return null; // the row says a folder is required
  const no = `${device} reads the folders ${chats} work in; ${asked} is none of them`;
  if (networkShare(asked)) return no;
  const c = folderKey(asked);
  const data = folderKey(dataDir);
  if (within(c, data) || within(data, c)) return `${device} never reads Filament's data folder; ${asked} is ${within(c, data) ? "in" : "around"} it`;
  const h = folderKey(home);
  const open = (/** @type {string} */ f) => {
    if (!f || networkShare(f)) return false;
    const k = folderKey(f);
    return k !== folderKey(parse(k).root) && !within(h, k) && !within(k, data) && !within(data, k);
  };
  return folders.some((f) => open(f) && within(c, folderKey(f))) ? null : no;
}

/**
 * The folders that hold what signs the person in elsewhere (core/secret-files.js): a chat of another machine's agents
 * never works at or under one, wherever it lies (`agentFolderRefusal`).
 */
const CREDENTIALS = CREDENTIAL_FOLDERS;
/**
 * The credentials folder a folder's key is at or under, as its path names it ("" for none): compared without case, as
 * Windows and macOS name a folder, by the long names the filesystem resolves (`folderKey`). @param {string} key  `folderKey`'s
 */
const credentialsOf = (key) => credentialFolderOf(key);
/** Where under a home folder `CREDENTIALS`' names start: the home itself, AppData's Roaming and Local, Library and its Application Support. */
const CREDENTIALS_BASES = Object.freeze([[], ["appdata", "roaming"], ["appdata", "local"], ["library"], ["library", "application support"]]);
/**
 * Whether a folder in a home folder — this person's or another's beside it — holds a credentials folder by its names:
 * `~/.config` holds `.config/gh`, `~/AppData` holds `appdata/roaming/gh`, and a chat there reached it through its own
 * folder (the review of f-fence2). @param {string} key  `folderKey`'s @param {string} home  the home folder's key
 */
const holdsCredentials = (key, home) => {
  const homes = dirname(home);
  const rel = within(key, home) ? relative(home, key) : homes !== parse(homes).root && within(key, homes) ? relative(homes, key).split(/[\\/]+/).slice(1).join(sep) : "";
  const names = rel.toLowerCase().split(/[\\/]+/).filter(Boolean);
  if (!names.length) return false;
  const holds = (/** @type {string[]} */ full) => names.length < full.length && names.every((n, i) => full[i] === n);
  return CREDENTIALS_BASES.some((b) => CREDENTIALS.some((c) => holds([...b, ...c])));
};
/**
 * What a folder is that another machine's agents never start a chat in, nor reach a folder through, in words; "" where
 * it is none of them: a drive's root, a home folder or what holds one — another person's too, beside this one's —, a
 * credentials folder (`CREDENTIALS`) or what holds one. @param {string} key  `folderKey`'s @param {string} home  the home folder's key
 */
const closedFolder = (key, home) => {
  if (key === folderKey(parse(key).root)) return "a drive's root";
  if (within(home, key)) return "a home folder, or holds one";
  const homes = dirname(home);
  if (homes !== parse(homes).root && dirname(key) === homes) return "a home folder";
  const cred = credentialsOf(key);
  if (cred) return `a credentials folder (${cred}), or inside one`;
  return holdsCredentials(key, home) ? "a folder that holds a credentials folder" : "";
};

/**
 * Why another machine's agents may not read `path` in their chat's folder `cwd`, in words; "" where they may (the review
 * of f-fence2): its names open another than they say (`aliasedPath`), or it is at or under a credentials folder inside
 * that folder (`project/.ssh`), or in a repository's own `.git` below it — its config may hold a remote's URL with a token
 * in it, which this machine's clones are never said with (inspect.js `withoutCredentials`; the swarm's review of 11-10).
 * Each by the path's names and where the filesystem resolves it, a link inside the folder too — the rule every door
 * their reads go through keeps (tools/fs-fence.js `keptFromAgents`).
 * @param {string} cwd @param {string} path
 */
export function agentFileRefusal(cwd, path) {
  const asked = String(path || "").trim();
  if (!asked) return "";
  const alias = aliasedPath(asked.split(/[\\/]+/).filter((n) => n !== "." && n !== "..").join("/"));
  if (alias) return `another machine's agents name a file by its own names; ${asked}: ${alias}`;
  const kept = keptFromAgents(resolve(String(cwd || ""), asked), [String(cwd || "")]);
  return kept ? keptRefusal(asked, kept) : "";
}

/**
 * What in a path's names would open another folder than its words name, in words; "" for nothing (the security review
 * of f-fence, its Windows names): a name that ends in a dot or a space, which Windows drops (`.ssh.` opens `.ssh`); a
 * colon past a drive's, which names a stream (`.ssh::$INDEX_ALLOCATION` opens `.ssh`) or, after `\\?\`, a device's
 * path; `~` and a digit, a short name (`SSH~1`). Another machine's agents name a folder without any, on every system
 * (`agentFolderRefusal`, and a file's folder at index.js): their credentials folders are then found by their own names.
 * @param {string} p
 */
export function aliasedPath(p) {
  const names = String(p || "").trim().replace(/^[A-Za-z]:/, "").split(/[\\/]+/);
  for (const name of names.filter(Boolean)) {
    if (/[. ]$/.test(name)) return `its name "${name}" ends in a dot or a space, which Windows drops`;
    if (name.includes(":")) return `its name "${name}" holds a colon, which names a stream or a device's path`;
    if (/~\d/.test(name)) return `its name "${name}" holds "~" and a digit, a short name for another`;
  }
  return "";
}

/**
 * What keeps a folder another machine names from being one of this machine's whole paths, in words; "" where it is one
 * (the swarm's review of 11-10): Windows reads `/Users/kai/x` from the current drive's root and `/c/x` as `C:\c\x`, so a
 * Mac's path or Git Bash's opened another folder of the same name here; elsewhere `H:\x` is read from Filament's own
 * folder. @param {string} p @param {NodeJS.Platform} [platform]
 */
export function notRooted(p, platform = process.platform) {
  if (platform === "win32") {
    if (/^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p)) return "";
    return /^[\\/][A-Za-z](?:[\\/]|$)/.test(p) ? "is Git Bash's way of naming a drive's folder: this machine names it with its drive's letter (C:\\…)" : "names no drive: this machine is on Windows, where a folder's path starts with its drive's letter (C:\\…)";
  }
  return p.startsWith("/") ? "" : "is not a path from this machine's root (/): it is on " + (platform === "darwin" ? "macOS" : "Linux");
}

/**
 * Their own machine's folder in the copies folder, as `folderKey` names it: "" where none is given, or it is not
 * strictly inside the copies folder. @param {string} copies @param {string} copiesRoot
 */
const ownCopies = (copies, copiesRoot) => {
  if (!copies || !copiesRoot || networkShare(copies) || networkShare(copiesRoot)) return "";
  const [k, root] = [folderKey(copies), folderKey(copiesRoot)];
  return k !== root && within(k, root) ? k : "";
};

/**
 * Why another machine's agents may not reach `cwd` in Filament's copies folder (services/copies.js), in words; "" where
 * it lies outside it and holds none of it, or in their own machine's folder there and in no copy let go. Anything else
 * there is refused them, whatever lists it — another machine's copies, a copy let go whose folder a chat's row still
 * names (the reviews of cp-root and cp-fix) —, and so is the copies folder itself and what holds it: a chat's start
 * (`agentFolderRefusal`), a command's, and a file read in a chat of theirs (index.js).
 * @param {string} cwd @param {{ copies?: string, copiesRoot?: string, copiesGone?: readonly string[], doing?: string }} o
 */
export function copiesRefusal(cwd, { copies = "", copiesRoot = copiesRootOf(), copiesGone = [], doing = "start a chat" }) {
  const asked = String(cwd || "").trim();
  if (!asked || !copiesRoot || networkShare(asked) || networkShare(copiesRoot)) return "";
  const c = folderKey(asked);
  const root = folderKey(copiesRoot);
  if (copiesGone.some((g) => g && within(c, folderKey(g)))) return `another machine's agents never ${doing} in a copy let go; ${asked} is in one, which goes`;
  const k = ownCopies(copies, copiesRoot);
  // In one copy alone (`<project>/<n>`): their machine's folder and a project's hold every copy of it, the one another
  // launch works in among them, and no copy's chat is bound there (the swarm's review of 11-10).
  if (k && within(c, k)) return relative(k, c).split(/[\\/]+/).filter(Boolean).length >= 2 ? "" : `another machine's agents ${doing} in one copy of a project; ${asked} holds their copies`;
  return within(c, root) || within(root, c) ? `another machine's agents ${doing} in their own machine's copies alone; ${asked} is ${within(c, root) ? "in" : "around"} Filament's copies folder, not in theirs` : "";
}

/**
 * Why another machine's agents may not start a chat in the folder `cwd`, in words; null where this fence lets them — the
 * folder rules then judge it as they judge anyone's (sessions' `draftOf`), and its tools keep to its folder as any chat's
 * do (turn.js `folderVerdict`, tools.js `outsideRoot`). Never Filament's data folder, inside it or around it, whose
 * secret.key and sealed config.json open the admin token and every key; never a drive's root, a home folder or a
 * credentials folder (`closedFolder`), each judged where the filesystem resolves it, a link's or a junction's target;
 * a folder on another computer's share is refused before the disk is asked of it (turn.js `networkShare`). Where
 * agentLoop.roots lists folders (`roots`), inside one of them; with none listed, inside a folder of this machine's
 * projects or of a chat the person started here (`folders`; a chat another machine's agents started is none of them),
 * one that is itself none of the above (the security review of f-fence: with no roots, any other folder passed — a
 * `.ssh` folder, then its key read through the chat's own folder). Its path names its folder by its own names
 * (`aliasedPath`): `.ssh.` and `SSH~1` were none of the credentials folders by their words.
 * `doing` names what is refused in the words: a chat started, or a command run there (exec.js). `full`: their device
 * holds Full control (services/devices.js `fullControl`), which runs as the person: any folder of this machine's but
 * in Filament's data folder, the home folder around it too, still named by its own names and on this machine's disk.
 * `copies`: the folder their own machine's copies are kept in here (services/copies.js `folderOf`), which they work in
 * without Full control and whatever agentLoop.roots lists — where it lies inside the copies folder and is itself none
 * of the folders above. Anything else in the copies folder (`copiesRoot`) is refused them, whatever lists it, and so are
 * their own copies let go (`copiesGone`): `copiesRefusal`. A caller passes the copies' own (services/copies.js `fenceOf`).
 * @param {string} cwd @param {{ dataDir: string, home?: string, roots?: readonly string[], folders?: readonly string[], doing?: string, full?: boolean, copies?: string, copiesRoot?: string, copiesGone?: readonly string[] }} o
 * @returns {string | null}
 */
export function agentFolderRefusal(cwd, { dataDir, home = homedir(), roots = [], folders = [], doing = "start a chat", full = false, copies = "", copiesRoot = copiesRootOf(), copiesGone = [] }) {
  const asked = String(cwd || "").trim();
  if (!asked) return null; // the row says a folder is required
  const alias = aliasedPath(asked);
  if (alias) return `another machine's agents name a folder by its own names; ${asked}: ${alias}`;
  if (networkShare(asked)) return `another machine's agents ${doing} in this machine's own folders; ${asked} is on another computer's share`;
  const unrooted = notRooted(asked);
  if (unrooted) return `another machine's agents name a folder as this machine writes it, whole: ${asked} ${unrooted}`;
  const c = folderKey(asked);
  const data = folderKey(dataDir);
  if (within(c, data) || (!full && within(data, c))) return `another machine's agents never ${doing} in Filament's data folder; ${asked} is ${within(c, data) ? "in" : "around"} it`;
  if (full) return null;
  const h = folderKey(home);
  const inCopies = copiesRefusal(asked, { copies, copiesRoot, copiesGone, doing });
  if (inCopies) return inCopies;
  const k = ownCopies(copies, copiesRoot);
  if (k && within(c, k) && !closedFolder(k, h) && !within(k, data) && !within(data, k)) {
    const cred = credentialsOf(c);
    return cred ? `another machine's agents ${doing} in a project's folder; ${asked} is a credentials folder (${cred}), or inside one` : null;
  }
  const closed = closedFolder(c, h);
  if (closed) return `another machine's agents ${doing} in a project's folder; ${asked} is ${closed}`;
  const listed = roots.map(String).filter(Boolean);
  if (listed.length) return underRoots(asked, listed) ? null : outsideRootsWords(asked);
  const open = (/** @type {string} */ f) => {
    if (!f || networkShare(f)) return false;
    const k = folderKey(f);
    return !closedFolder(k, h) && !within(k, data) && !within(data, k) && within(c, k);
  };
  return folders.some(open) ? null : `another machine's agents ${doing} in the folders of this machine's projects and of the chats you started here; ${asked} is in none of them`;
}

/**
 * The addresses this Filament's page opens that another machine's app sends it to, by name (GET /remote/me `pages`):
 * `new`, `#/new/<folder>`, a new chat in a project of this machine's (the new-chat menu of the app's other machines,
 * pk-list).
 */
export const PAGES = Object.freeze(["new"]);

/**
 * What this Filament does for another machine's desk — the app that lists every machine's chats as one (the remote
 * desk of 11-22) —, by name (GET /remote/me `desk`): an app greys what a machine's list leaves out, saying to update it
 * there. `remote-key`: its chats' and projects' lists say their repository's remote (`?remotes=1`), by which the desk
 * lists a repository's on every machine as one. `ask-events`: its events feed says each ask the chat's asks list
 * (http/admin/sessions.js `asksIn`) that waits in a running turn as it opens and closes (`turns`, `{ type: "ask",
 * chainId, id, open }`: a coding agent's, a sub-agent's; the chat's own ask ends its turn and its answer begins one,
 * which `turn` says). `events-only`: its events feed takes `?only=` and sends those topics alone. `chat-only`: its page
 * shows a chat alone at `?only=chat` (ui/harness/lib/chat-only.js), the desk's look at `&theme=`, beside the desk's own
 * left bar.
 */
export const DESK = Object.freeze(["remote-key", "ask-events", "events-only", "chat-only"]);

/** The claim's path, answered before any caller is known (index.js). */
export const CLAIM_PATH = "/remote/claim";

/**
 * A pairing's links (the owner's remote Filament of 11-06, Part 2): one for each address the network's listener answers
 * at, its fragment carrying the code and the certificate's fingerprint — which the pairing page shows to compare, and
 * `filament connect` pins. None while it is off: plain http on the network pairs nothing (guards.js `sealedWay`), and a
 * proxy here (tailscale serve) or an SSH tunnel names its own address.
 * @param {{ listening: { port: number } | null, addresses: string[], fingerprint: string | null } | null | undefined} net  lan-tls.js `state()`
 * @param {string} code
 */
export function pairLinks(net, code) {
  if (!net?.listening || !net.fingerprint) return [];
  const fp = printOf(net.fingerprint).replace(/:/g, "");
  return net.addresses.map((u) => `${u}${PAIR_PAGE}#code=${encodeURIComponent(code)}&fp=${fp}`);
}

/**
 * A pairing's link on the tailnet, where Filament is served there (services/tailscale.js): its address, the code in the
 * fragment — no fingerprint, as an authority vouches for its certificate. Null where it is not served.
 * @param {{ address: string | null } | null | undefined} ts  the tailnet's state @param {string} code
 */
export const tailnetLink = (ts, code) => (ts?.address ? `${ts.address}${PAIR_PAGE}#code=${encodeURIComponent(code)}` : null);

/** How long a read of Windows Firewall stands before the next is asked for: a few seconds of PowerShell each. */
const FIREWALL_READ_MS = 15_000;
/**
 * Whether the page reached this Filament over https: its own socket, or a proxy on this machine that says so (tailscale
 * serve). Only then is its cookie Secure — plain http on the LAN would never send one back.
 * @param {import("node:http").IncomingMessage} req
 */
const overHttps = (req) => !!(/** @type {any} */ (req.socket)?.encrypted) || (isLoopback(req) && forwardedHttps(req));
/** The cookies a sign-out takes away: the plain one, and over https the `__Host-` one too (guards.js `deviceCookie`). @param {boolean} secure */
const cookiesGone = (secure) => (secure ? [deviceCookie("", 0, true), deviceCookie("", 0, false)] : [deviceCookie("", 0, false)]);
/** The scopes a pairing is for: a device drives (`full`) or reads (`view`). */
const SCOPES = ["full", "view"];
/**
 * Why a PATCH's `grants` is not one, in words; null where it is: an object naming grants there are (devices.js
 * GRANTS), each true or false. @param {unknown} g
 */
const grantsRefusal = (g) =>
  g && typeof g === "object" && !Array.isArray(g) && Object.entries(g).every(([k, v]) => GRANTS.includes(/** @type {any} */ (k)) && typeof v === "boolean")
    ? null
    : `grants is { ${GRANTS.map((k) => `${k}?`).join(", ")} }, each true or false, not ${JSON.stringify(g ?? null)}`;

/**
 * @param {any} a  the admin context: `devices` (services/devices.js), `machine` (services/machine.js)
 * @returns {import("../router.js").RouteRow[]}
 */
export function remoteRoutes(a) {
  /** @type {import("../../services/devices.js").DeviceStore | null} */
  const devices = a.devices || null;
  const machine = () => a.machine?.get?.() ?? null;
  /** No device store wired: nothing here answers. @param {any} r */
  const none = (r) => sendJson(r.res, 503, { error: "pairing is not wired in this Filament" });
  /** Only this computer starts or ends a pairing. @param {any} r */
  const localOnly = (r) => (r.who?.kind === "local" ? null : sendJson(r.res, 403, { error: "a pairing starts on the machine it pairs with: open Filament there" }));
  /** Devices are managed by this computer, the admin token or a full device: never a view device, nor another machine's agents'. @param {any} r */
  const managers = (r) => (drives(r.who) ? null : sendJson(r.res, 403, { error: r.who?.scope === "agent" ? "another machine's agents manage no devices" : "a view-only device manages no devices" }));
  /** A device as the list says it: an agents' device with its machine's copies here, where it keeps any. @param {any} d */
  const withCopies = (d) => {
    const u = d.scope === "agent" ? a.remoteCopies?.usage(d.id) : null;
    return u ? { ...d, copies: u } : d;
  };
  /** The network's listener as it stands (services/lan-tls.js); null where none is wired. */
  const net = () => a.lan?.()?.state?.() ?? null;
  /** The artifacts' network port, where they listen beside it (http/artifacts.js `artifactsListener`): the firewall opens it too. */
  const artPorts = () => {
    const p = a.artifactsNet?.()?.state?.()?.listening?.port;
    return Number.isInteger(p) && p > 0 ? [p] : [];
  };
  /** Windows Firewall, read and changed by PowerShell (tests inject their own). */
  const firewall = a.firewall ?? { platform: process.platform, read: readFirewall, allow: allowThroughFirewall };
  /** The last read of it, for the ports it was read for, and when. @type {{ port: string, at: number, read: Promise<any> } | null} */
  let fwRead = null;
  /**
   * What Windows Firewall lets through to the listener's port and its artifacts', in words (lan-tls.js `firewallVerdict`); read again
   * past FIREWALL_READ_MS or when asked. Off Windows, null: the page says what to look at there.
   * @param {number} port @param {boolean} fresh
   */
  const firewallNow = (port, fresh) => {
    if (firewall.platform !== "win32") return Promise.resolve(null);
    const ports = [port, ...artPorts()];
    if (fresh || !fwRead || fwRead.port !== ports.join(",") || Date.now() - fwRead.at > FIREWALL_READ_MS)
      fwRead = {
        port: ports.join(","),
        at: Date.now(),
        read: firewall.read().then(
          (/** @type {any} */ f) => firewallVerdict(f, ports),
          (/** @type {any} */ e) => ({ open: false, fix: true, words: `Windows Firewall could not be read (${e?.message || e}): if another machine cannot reach the port, allow Filament here.` }),
        ),
      };
    return fwRead.read;
  };
  return [
    [
      // A new code for another machine to claim: `{ scope: "full" | "view" }`. The code, its scope, when it runs out,
      // and this machine's id and name, which the other machine shows as it pairs.
      "POST",
      "/remote/pair",
      guard(async (r) => {
        if (!devices) return none(r);
        const no = localOnly(r);
        if (no) return no;
        const b = await r.json();
        // Named, never guessed: a scope that is neither is refused, not read as either (the review of 882809c20).
        if (!SCOPES.includes(b?.scope)) return sendJson(r.res, 400, { error: `scope is "full" (it drives this Filament) or "view" (it reads), not ${JSON.stringify(b?.scope ?? null)}` });
        // A code is the door's (press.js): a caller that may not press was refused before this row (index.js), so none is
        // opened here for a device that would press nothing. Devices paired so before the door asked for the key are
        // kept as they are (devices.js `pressless`).
        const open = devices.startPairing({ scope: b.scope });
        // Where the other machine opens it: each address the network's listener answers at, the code and the
        // certificate's fingerprint in the link's fragment — once a save that turned it on or moved it is made, as
        // `filament pair` right after `filament settings set server.lan.enabled true` asks (the sv-live hunt's).
        await a.lan?.()?.settled?.();
        const n = net();
        const links = pairLinks(n, open.code);
        // And on the tailnet, where Filament is served there: its certificate one an authority signs, no fingerprint.
        const tail = tailnetLink(a.tailnet?.()?.state?.(), open.code);
        return sendJson(r.res, 200, { ...open, machine: machine(), addresses: links.length ? n?.addresses ?? [] : [], links: [...links, ...(tail ? [tail] : [])], fingerprint: links.length ? n?.fingerprint ?? null : null, hostOnly: links.length ? n?.hostOnly ?? null : null });
      }),
    ],
    ["GET", "/remote/pair", guard((r) => (!devices ? none(r) : localOnly(r) || sendJson(r.res, 200, { pending: devices.pending() })))],
    [
      // `?id=` closes the one code the page showed, another window's or `filament pair`'s left open; none closes all.
      "DELETE",
      "/remote/pair",
      guard((r) => {
        if (!devices) return none(r);
        const no = localOnly(r);
        if (no) return no;
        const id = r.url.searchParams.get("id");
        return sendJson(r.res, 200, { ok: true, closed: devices.cancelPairing(id ?? undefined) });
      }),
    ],
    [
      // The claim: `{ code, name, machine? }`. Answered before any caller is known; the Origin and JSON checks ran (index.js).
      // A page (it sent an Origin, its own) gets the cookie and never the token; the CLI (no Origin) gets the token.
      "POST",
      CLAIM_PATH,
      guard(async (r) => {
        if (!devices) return none(r);
        // The token goes out over a way no one on the network reads, or not at all (guards.js `sealedWay`).
        const b = await r.json();
        // A code that came in the clear is anyone's on the way: it closes unclaimed, before a reader can claim it over https.
        if (!sealedWay(r.req)) {
          const spoiled = devices.spoil(b?.code);
          return sendJson(r.res, 403, { error: `pairing goes over https${spoiled ? ", and this code came over plain http, so it is closed" : ""}: on the machine Filament runs on, turn on Settings › Remote access › Reach this machine on my network, open the https address it shows and make a new code`, https: true });
        }
        const page = !!lowerHeaders(r.req.headers).origin;
        // The device this one replaces, where the claim carries the token of one that lapsed unused: it goes once this is paired.
        const was = lapsedDevice(r.req, devices);
        const got = devices.claim(b?.code, { name: b?.name, kind: page ? "browser" : "cli", from: callerAddress(r.req), machine: b?.machine });
        if (!got.ok) return sendJson(r.res, got.unsaved ? 500 : got.retryAt ? 429 : 403, { error: got.why, ...(got.retryAt ? { retryAt: got.retryAt } : {}) }, got.retryAt ? { "retry-after": String(Math.max(1, Math.ceil((got.retryAt - Date.now()) / 1000))) } : {});
        a.log?.("info", `remote: ${got.device.name} paired (${got.device.scope}, ${got.device.kind}) from ${callerAddress(r.req) || "an unknown address"}${was ? `, replacing ${was.name}, which went unused` : ""}`);
        if (was) devices.revoke(was.id);
        if (page) return sendJson(r.res, 200, { device: got.device, machine: machine() }, { "set-cookie": deviceCookie(got.token, DEVICE_COOKIE_DAYS * 86_400, overHttps(r.req)), "cache-control": "no-store" });
        return sendJson(r.res, 200, { device: got.device, machine: machine(), token: got.token }, { "cache-control": "no-store" });
      }),
    ],
    [
      // The network's listener (Settings › Remote access › Reach this machine on my network): asked for or not, where it
      // listens, why it does not, its certificate's fingerprint and addresses, and — on Windows, while it listens —
      // what the firewall lets through (`?fresh=1` reads it again).
      "GET",
      "/remote/lan",
      guard(async (r) => {
        const no = managers(r);
        if (no) return no;
        // A save that turned it on or moved it is made before it is said.
        await a.lan?.()?.settled?.();
        const n = net();
        if (!n) return sendJson(r.res, 503, { error: "the network's listener is not wired in this Filament" });
        const fw = n.listening ? await firewallNow(n.listening.port, r.url.searchParams.get("fresh") === "1") : null;
        return sendJson(r.res, 200, { ...n, platform: firewall.platform, firewall: fw });
      }),
    ],
    [
      // Filament's Windows Firewall rule for the listener's port and its artifacts': Windows asks the person at this
      // machine to confirm.
      "POST",
      "/remote/lan/firewall",
      guard(async (r) => {
        if (r.who?.kind !== "local") return sendJson(r.res, 403, { error: "Windows asks the person at the machine Filament runs on to confirm: allow it there" });
        const n = net();
        if (firewall.platform !== "win32") return sendJson(r.res, 400, { error: "Windows Firewall is Windows's: nothing to allow here" });
        if (!n?.listening) return sendJson(r.res, 409, { error: "the network's listener is off: turn it on first" });
        try {
          await firewall.allow({ port: n.listening.port, also: artPorts() });
        } catch (/** @type {any} */ e) {
          return sendJson(r.res, 409, { error: String(e?.message || e) });
        }
        a.log?.("info", `remote: Windows Firewall opens port ${[n.listening.port, ...artPorts()].join(" and ")} to the Private network`);
        return sendJson(r.res, 200, { ok: true, firewall: await firewallNow(n.listening.port, true) });
      }),
    ],
    [
      // Share on my tailnet (Settings › Remote access): asked for or not, Tailscale's state here — installed, signed in,
      // this machine's name, the tailnet's HTTPS —, whether and where it is served, and why not (`?fresh=1` reads it again).
      "GET",
      "/remote/tailscale",
      guard(async (r) => {
        const no = managers(r);
        if (no) return no;
        const t = a.tailnet?.();
        if (!t) return sendJson(r.res, 503, { error: "the tailnet is not wired in this Filament" });
        return sendJson(r.res, 200, { ...(await t.look({ fresh: r.url.searchParams.get("fresh") === "1" })), platform: process.platform });
      }),
    ],
    [
      // Try again: served once more as server.tailscale says — after the person turned on what Tailscale asked for.
      "POST",
      "/remote/tailscale/retry",
      guard(async (r) => {
        const no = managers(r);
        if (no) return no;
        const t = a.tailnet?.();
        if (!t) return sendJson(r.res, 503, { error: "the tailnet is not wired in this Filament" });
        await t.retry();
        return sendJson(r.res, 200, { ...(await t.look({ fresh: true })), platform: process.platform });
      }),
    ],
    // Who reads this answer, as the page's rail says it: this computer, the admin token, your own tailnet login, or the
    // device, its scope and its grants — what another machine's agents read to say why they are refused. `pages`: the
    // addresses this Filament's page opens that another machine's app sends it to (`PAGES`): an app that reads none
    // sends it nowhere a page from before would not open. `desk`: what it does for another machine's desk (`DESK`).
    ["GET", "/remote/me", (r) => sendJson(r.res, 200, { who: r.who?.kind ?? null, ...(r.who?.kind === "device" ? { device: r.who.device } : {}), ...(r.who?.kind === "tailnet" ? { login: r.who.login } : {}), machine: machine(), pages: PAGES, desk: DESK })],
    [
      // A device signs itself out: its token stops working at once, and its cookie goes. One that lapsed unused too
      // (guards.js `lapsedDevice`): pairing again signs the one it replaces out.
      "POST",
      SIGN_OUT_PATH,
      guard((r) => {
        if (!devices) return none(r);
        const own = r.who?.kind === "device" ? r.who.device : r.who ? null : lapsedDevice(r.req, devices);
        if (!own) return sendJson(r.res, 400, { error: "only a paired device signs out; this is no device" });
        devices.revoke(own.id);
        a.log?.("info", `remote: ${own.name} signed out`);
        return sendJson(r.res, 200, { ok: true }, { "set-cookie": cookiesGone(overHttps(r.req)) });
      }),
    ],
    [
      // A full device mints its own machine's agents a device here: `{ device, token }`, the token this once. Its grants
      // are off until this machine's managers switch them on; a second mint replaces the first (devices.js `mintAgents`).
      // `{ from? }`: the machine's own name, as its Settings › Remote access › This machine says it — the chats its agents
      // start here are said to be from it.
      "POST",
      "/remote/agent-device",
      guard(async (r) => {
        if (!devices) return none(r);
        if (r.who?.kind !== "device" || r.who.scope !== "full") return sendJson(r.res, 403, { error: "a full device paired with this Filament mints its machine's agents a device here; this is none" });
        const b = await r.json().catch(() => null);
        const got = devices.mintAgents(r.who.device.id, { from: typeof b?.from === "string" ? b.from : undefined });
        if (!got.ok) return sendJson(r.res, got.unsaved ? 500 : 403, { error: got.why });
        a.log?.("info", `remote: ${got.device.name} minted, its grants on: ${GRANTS.filter((k) => got.device.grants[k]).join(", ") || "none"}`);
        return sendJson(r.res, 200, { device: got.device, machine: machine(), token: got.token }, { "cache-control": "no-store" });
      }),
    ],
    // Each agents' device with what its machine's agents keep here in copies (services/copies.js `usage`): how many,
    // their size as measured, and their folder.
    ["GET", "/remote/devices", guard((r) => (!devices ? none(r) : managers(r) || sendJson(r.res, 200, { devices: devices.list().map(withCopies), ...(r.who?.kind === "local" ? { pending: devices.pending() } : {}) })))],
    [
      // Clear: an agents' device's machine's copies here go, busy ones too, its folder with them, and the chats its agents
      // worked in there, stopped first (services/copies.js `clear`). → `{ cleared, bytes, failed }`: `failed`, the folders
      // that could not be removed yet, which the hourly sweep removes.
      "POST",
      "/remote/devices/:id/copies/clear",
      guard(async (r) => {
        if (!devices) return none(r);
        const no = managers(r);
        if (no) return no;
        const d = devices.get(decodeURIComponent(r.params.id));
        if (!d) return sendJson(r.res, 404, { error: "no such device" });
        if (d.scope !== "agent") return sendJson(r.res, 400, { error: "copies are kept for another machine's agents: this is no agents' device" });
        if (!a.remoteCopies) return sendJson(r.res, 503, { error: "copies are not wired in this Filament" });
        const out = await a.remoteCopies.clear(d.id);
        a.log?.("info", `remote: ${d.name}'s ${out.cleared} copies cleared${out.failed.length ? `, ${out.failed.length} folders left to remove` : ""}`);
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      // `{ name?, grants? }`. Grants (devices.js GRANTS) are another machine's agents', set by this machine's managers —
      // never by that device itself, which manages nothing (index.js) — and held by an agents' device alone. Full
      // control is on top of `agents`: asked for while Agents stays off, it is refused in words.
      "PATCH",
      "/remote/devices/:id",
      guard(async (r) => {
        if (!devices) return none(r);
        const no = managers(r);
        if (no) return no;
        const b = await r.json();
        const id = decodeURIComponent(r.params.id);
        if (b?.grants !== undefined) {
          const was = devices.get(id);
          if (!was) return sendJson(r.res, 404, { error: "no such device" });
          if (was.scope === "view") return sendJson(r.res, 403, { error: "a view-only device holds no grant: it reads" });
          if (was.scope !== "agent") return sendJson(r.res, 400, { error: "a full device drives this Filament as you do and holds no grant: its machine's agents have a device of their own here, whose grants these are" });
          if (was.revokedAt != null) return sendJson(r.res, 409, { error: `${was.name} is revoked: no token of theirs comes in, and its grants are set no more. Their machine gets a new one as Agents is pressed on this machine's line in its Settings › Remote access` });
          const bad = grantsRefusal(b.grants);
          if (bad) return sendJson(r.res, 400, { error: bad });
          if (b.grants.full === true && (b.grants.agents ?? was.grants.agents) !== true)
            return sendJson(r.res, 400, { error: `Full control is on top of Agents: switch Agents on for ${was.name} first, then Full control` });
          const set = devices.grant(id, b.grants);
          if (set?.unsaved) return sendJson(r.res, 500, { error: `${set.name}'s grants hold until Filament restarts: the device list could not be saved (${set.unsaved}). Set them again once the data folder can be written.`, device: set });
          a.log?.("info", `remote: ${was.name}'s grants on: ${GRANTS.filter((k) => set?.grants[k]).join(", ") || "none"}`);
        }
        const d = devices.rename(id, b?.name);
        return d ? sendJson(r.res, 200, { device: d }) : sendJson(r.res, 404, { error: "no such device" });
      }),
    ],
    [
      // Revoke: its token stops working at once. `?forget=1` takes a revoked one off the list for good.
      "DELETE",
      "/remote/devices/:id",
      guard((r) => {
        if (!devices) return none(r);
        const no = managers(r);
        if (no) return no;
        const id = decodeURIComponent(r.params.id);
        if (r.url.searchParams.get("forget") === "1") return devices.forget(id) ? sendJson(r.res, 200, { ok: true }) : sendJson(r.res, 409, { error: "only a revoked device is forgotten: revoke it first" });
        const d = devices.revoke(id);
        if (!d) return sendJson(r.res, 404, { error: "no such device" });
        a.log?.("info", `remote: ${d.name} revoked`);
        // Revoked now, but not kept: the owner hears that a restart would let it in again until a save keeps it.
        if (d.unsaved) return sendJson(r.res, 500, { error: `${d.name} is revoked until Filament restarts: the device list could not be saved (${d.unsaved}). Revoke it again once the data folder can be written.`, device: d });
        return sendJson(r.res, 200, { device: d });
      }),
    ],
  ];
}
