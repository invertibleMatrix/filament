// @ts-check
// Session Settings — the switchboard (HarnessV2 §5, D10). One document, three layers: the global config, the
// project's `settings_json`, the session's `settings_json`. Every knob is optional at every layer and the effective
// value is `session ?? project ?? global ?? default`, with the layer it came from named beside it — except your MCP
// servers, whose lists add up by name across the layers (services/mcp-servers.js), as do the plugins, skills and
// language servers on, and the folders an agent may also read, which add up by path. The document's hash is stamped on every turn so a change is always visible as a boundary
// in the transcript.
//
// The whole switchboard is declared here, including knobs whose mechanism is not built yet: they are stored and
// shown ("not built yet — what it will do") but marked `live: false` until their phase lands (BUILT_PHASE).
import { isAbsolute } from "node:path";
import { shortHash } from "../core/hash.js";
import { editDistance } from "../core/text.js";
import { TRIM_DEFAULTS } from "../core/trim.js";
import { DEFAULT_POOL, byCardProblem, byTeamProblem, poolKept, poolProblem } from "../core/pool.js";
import { SUBAGENT_EFFORTS, isAgentUpstream } from "../core/schema.js";
import { modelKeepsThinking } from "../core/routing.js";
import { sessionWindowFor } from "../core/model-families.js";
import { COPY_MAX, copyPathProblem } from "../core/worktree-copy.js";
import { LOADS, MCP_KNOB, NOTE_MAX, SECRET_MARK, isPick, isSwitch, maskList, mergeServers, restoreList, serversOn, startsServer } from "./mcp-servers.js";
import { SECRET_ENV_RE, keysSentTo } from "./config/secrets.js";
import { loopbackHost } from "./config/store.js";
import { ACCOUNT_RE, MAIN_ACCOUNT } from "../core/oauth.js";
import { EXTENSION_RE } from "../core/plugin-parts.js";

/** The phase of HarnessV2 that is built; knobs with a later phase are declared, stored and inert. */
export const BUILT_PHASE = 5;

/**
 * The loop's hands and its own tools, in the order `loop.tools` lists them (glob and the web hands also need their
 * plugin switch). `show_visual` switches the agent's visuals, its guide with them (HarnessV4_Visuals_Plan VS-D2);
 * `artifact`, its pages kept apart from the chat (HarnessV4_Artifacts_Plan AF-D3); `space`, its project's Space
 * (proposal_ux §4.14); `team`, the teams it fires beside its chat (team_v2_plan §5.5); `flow`, the flows it designs beside
 * it (HarnessV4_OneAgent_Plan OA3); `thread`, the chats it starts linked to its own (app/threads.js); `lsp`, what the language servers know of the code (the owner's LSP of 11-04).
 */
export const LOOP_TOOL_NAMES = Object.freeze(["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "powershell", "grep", "ask", "plan", "agent", "delegate_read", "glob", "lsp", "web_fetch", "web_search", "show_visual", "artifact", "space", "team", "flow", "thread", "come_back"]);

/**
 * What a sub-agent may see of its session, its launch's choice: a view name → the form that renders its completed
 * turns since the last compaction, composed locally with no model call. `none`, what every launch gets unless it asks,
 * gives it the task alone: an agent handed the conversation takes on its view of it, and one handed only the task
 * answers apart from it (the owner's word of 10-31). `folded` is the cheap cut of the conversation — each turn its
 * words, one line per tool call and its reply — for work that is about the conversation. Two are no form's:
 * `window` is the main agent's context window as it stands, the running turn to its newest round in it (the sessions
 * service's `windowView`, the owner's words of 10-19), and `fork` makes the sub-agent a copy of the main agent's request.
 */
/** A sub-agent's views and the form each renders with; `window` and `fork` none. */
export const SUBAGENT_VIEWS = Object.freeze({ none: null, folded: "fold", window: null, fork: null });
/** The view that is the main agent's context window as it stands. */
export const WINDOW_VIEW = "window";

/** A knob's scope (HarnessV3 Step 2 D1): which layers may hold it. @typedef {"session" | "repo" | "mode"} KnobScope */
/** A knob's reach (D2): who obeys it. @typedef {"every" | "filament" | "screens"} KnobReach */

/**
 * @typedef {{ type: "string" | "int" | "number" | "bool" | "enum" | "list" | "json", default: any, phase: number,
 *   scope: KnobScope, reach: KnobReach, options?: string[], nullable?: boolean, min?: number, max?: number,
 *   example?: string, turns?: false, doc: string }} Knob
 * `example`: a value to show where the type's own would say too little.
 * `turns: false` marks a knob that shapes nothing a chat's turns send or do (a new worktree's copy): its change is no
 * boundary between turns, so `settingsHash` leaves it out.
 */

/** @type {(type: Knob["type"], def: any, phase: number, doc: string, extra?: Partial<Knob> & Pick<Knob, "scope" | "reach">) => Knob} */
const K = (type, def, phase, doc, extra = /** @type {any} */ ({})) => ({ type, default: def, phase, doc, ...extra });
/** The tool-result policies: As is and One line are offered (the owner's of 11-07); the rest stay valid for the chats
 *  that chose them before, which send the same bytes as they did. */
const RESULT_POLICIES = ["keep", "line", "status", "dedupe-to-tail", "pointer"];
/** How a compaction makes room (the owner's rules of 10-31): one summary, or an instant fold. */
export const COMPACTION_METHODS = Object.freeze(["summary", "fold"]);
/** Who writes a compaction's summary: the session's own model (its warm cache when it can), or a side model. */
export const COMPACTION_WRITERS = Object.freeze(["session", "model"]);
/** The most an instant fold may leave of the earlier turns, in tokens, unless a layer says otherwise. */
export const INSTANT_TOKENS = 20_000;
/** What a fresh coding-agent session carries of the earlier turns (`context.carry`, HarnessV4_Tasks U3-7): the forms a
 *  start can be composed under — Words (a fold whose tool calls are one line, this setting's own), Folded, Folded with
 *  the newest two whole, Whole. */
export const CARRY_FORMS = Object.freeze(["words", "fold", "fold+2", "plain"]);
/** How a coding agent's session makes room (HarnessV3-ACP AC5): the suggestion, the agent's own compaction, the agent
 *  writing Filament's summary (Self), or Filament's methods on its copy (Ours). */
export const COMPACTION_AGENT_WAYS = Object.freeze(["suggested", "own", "self", "ours"]);
/** Which engine answers a harness session's turns (HarnessV3 §11, Step 5 D1): the session's model, or a team — a lead
 *  on the loop and its workers (HarnessV3-AtHome P2). */
export const ENGINE_MODES = Object.freeze(["model", "team"]);
/** The pace of a lead's looks where a session names none (HarnessV3-TaskGraph-v2 TG2-D48): a heartbeat of five minutes, the signs making one due at once between. */
export const LOOK_SECONDS = 300;
/** The teams a main agent may start on the side by itself where nobody said (U13-D9): the one that changes no file. */
export const AGENT_TEAMS = Object.freeze(["bughunters"]);
const SCOPES = Object.freeze(["session", "repo", "mode"]);
/** The most folders `loop.addedFolders` holds in one layer (its doc says the number). */
export const ADDED_FOLDERS_MAX = 16;
/** The setting whose folders add up by path across the layers (HarnessV4_Settings_Plan HS-D7). */
export const FOLDERS_KNOB = "loop.addedFolders";

/** A folder as two layers' lists are compared: no separator at its end, and on Windows in either case. @param {string} p */
const folderKey = (p) => {
  const t = String(p).trim().replace(/[\\/]+$/, "");
  return process.platform === "win32" ? t.toLowerCase() : t;
};

/**
 * The folders of every layer, the broadest first, each once as its broadest layer spelled it (HS-D7: a narrower layer
 * adds; none takes one away).
 * @param {unknown[]} lists
 * @returns {string[]}
 */
export function mergeFolders(lists) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const list of lists)
    for (const f of Array.isArray(list) ? list : [])
      if (typeof f === "string" && f.trim() && !out.has(folderKey(f))) out.set(folderKey(f), f.trim());
  return [...out.values()];
}
/** The setting whose plugins add up by id across the layers (HarnessV4_SpacesPlugins_Plan B3). */
export const PLUGINS_ON = "plugins.on";
/** A plugin installed in Filament, by its id: `name@marketplace`. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The most plugins one layer's `plugins.on` names. */
const PLUGINS_ON_MAX = 64;

/** What is wrong with one entry of a layer's `plugins.on`, in words, or null. @param {any} e */
export function pluginOnProblem(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "must be { id, enabled?, hooks? }";
  if (typeof e.id !== "string" || !PLUGIN_ID_RE.test(e.id)) return "needs the plugin's id, as name@marketplace";
  if (e.enabled != null && typeof e.enabled !== "boolean") return "enabled must be true or false";
  if (e.hooks != null && typeof e.hooks !== "boolean") return "hooks must be true or false";
  return null;
}

/**
 * The layers' `plugins.on` merged by id, broadest first (B3): an entry turns its plugin on unless it says
 * `enabled: false`; a narrower one changes what it names — on or off, its hooks —, the rest stays the broader one's.
 * Its hooks stay off until a layer says `hooks: true` (PL-D3). → the plugins on, each with whether its hooks run.
 * @param {unknown[]} lists
 * @returns {{ id: string, hooks: boolean }[]}
 */
export function mergePluginsOn(lists) {
  /** @type {Map<string, { id: string, on: boolean, hooks: boolean }>} */
  const out = new Map();
  for (const list of lists)
    for (const e of Array.isArray(list) ? list : []) {
      if (pluginOnProblem(e)) continue;
      const prev = out.get(e.id);
      out.set(e.id, { id: e.id, on: typeof e.enabled === "boolean" ? e.enabled : prev ? prev.on : true, hooks: typeof e.hooks === "boolean" ? e.hooks : prev ? prev.hooks : false });
    }
  return [...out.values()].filter((p) => p.on).map(({ id, hooks }) => ({ id, hooks }));
}
/** The setting whose skills add up by name across the layers (HarnessV4_Skills_Plan S1-6). */
export const SKILLS_ON = "skills.on";
/** A skill's name in Filament: a letter or digit, then letters, digits, `.`, `_` and `-`; a plugin's own `<plugin>:<name>` is not one. */
export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The most skills one layer's `skills.on` names. */
const SKILLS_ON_MAX = 256;

/** What is wrong with one entry of a layer's `skills.on`, in words, or null. @param {any} e */
export function skillOnProblem(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "must be { name, enabled? }";
  if (typeof e.name !== "string" || !SKILL_NAME_RE.test(e.name)) return "needs the skill's name, as Library › Skills gives it";
  if (e.enabled != null && typeof e.enabled !== "boolean") return "enabled must be true or false";
  return null;
}

/**
 * The layers' `skills.on` merged by name, broadest first, as `plugins.on` is: an entry turns its skill on unless it
 * says `enabled: false`; a narrower one turns it on or off, the rest stays the broader one's. Names match without case.
 * @param {unknown[]} lists
 * @returns {{ name: string }[]}
 */
export function mergeSkillsOn(lists) {
  /** @type {Map<string, { name: string, on: boolean }>} */
  const out = new Map();
  for (const list of lists)
    for (const e of Array.isArray(list) ? list : []) {
      if (skillOnProblem(e)) continue;
      const key = e.name.toLowerCase();
      const prev = out.get(key);
      out.set(key, { name: prev?.name || e.name, on: typeof e.enabled === "boolean" ? e.enabled : prev ? prev.on : true });
    }
  return [...out.values()].filter((s) => s.on).map(({ name }) => ({ name }));
}

/** The setting whose language servers add up by name across the layers (the owner's LSP of 11-04). */
export const LSP_KNOB = "lsp.servers";
/** The most language servers one layer's `lsp.servers` names. */
const LSP_SERVERS_MAX = 32;

/** A value with each string under a name that reads as a credential, at any depth, as the placeholder. @param {unknown} v @returns {unknown} */
const credentialsMasked = (v) =>
  Array.isArray(v) ? v.map(credentialsMasked)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_ENV_RE.test(k) && typeof x === "string" && x ? SECRET_MARK : credentialsMasked(x)]))
  : v;
/**
 * A language servers' list with what a server's options and settings hold under a credential's name as the placeholder,
 * as an MCP server's environment is (`maskList`): what a transcript may carry. Anything else as it is.
 * @param {unknown} list
 */
const lspMasked = (list) =>
  Array.isArray(list)
    ? list.map((e) => (e && typeof e === "object" && !Array.isArray(e) ? { ...e, ...("initializationOptions" in e ? { initializationOptions: credentialsMasked(e.initializationOptions) } : {}), ...("settings" in e ? { settings: credentialsMasked(e.settings) } : {}) } : e))
    : list;

/**
 * What is wrong with one entry of a layer's `lsp.servers`, in words, or null: a server of your own, as Claude Code's
 * `.lsp.json` writes one — `{ name, command, args?, extensionToLanguage, initializationOptions?, settings?,
 * startupTimeout?, transport?: "stdio", enabled? }`, no `env` — or a switch `{ name, enabled }` for the server of that
 * name.
 * @param {any} e
 */
export function lspServerProblem(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return 'must be { name, command, args?, extensionToLanguage: { ".ext": "languageId" }, settings?, enabled? } or { name, enabled }';
  if (typeof e.name !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(e.name)) return "needs a name: a-z, 0-9, -, up to 32 characters";
  if (e.enabled != null && typeof e.enabled !== "boolean") return "enabled must be true or false";
  if (e.command == null) {
    if (Object.keys(e).some((k) => k !== "name" && k !== "enabled")) return "needs a command: a server of your own starts one, a switch is { name, enabled } alone";
    return typeof e.enabled === "boolean" ? null : "needs a command, or enabled to switch the server of that name";
  }
  if (typeof e.command !== "string" || !e.command.trim()) return "command must name the program to start";
  if (/[\\/]/.test(e.command) && !isAbsolute(e.command)) return "command must be a program's name on the PATH, or its whole path";
  if (e.args != null && (!Array.isArray(e.args) || e.args.some((/** @type {unknown} */ x) => typeof x !== "string"))) return "args must be a list of strings";
  const map = e.extensionToLanguage;
  if (!map || typeof map !== "object" || Array.isArray(map) || !Object.keys(map).length) return 'needs extensionToLanguage: { ".ext": "languageId" }, the files it serves';
  for (const [ext, id] of Object.entries(map)) {
    if (!EXTENSION_RE.test(ext)) return `extensionToLanguage's "${ext}" is no file extension: a dot, then up to 16 letters or digits`;
    if (typeof id !== "string" || !id.trim()) return `extensionToLanguage's "${ext}" needs its language id, as "typescript"`;
  }
  if (e.settings != null && (typeof e.settings !== "object" || Array.isArray(e.settings))) return "settings must be { section: value }";
  if (e.transport != null && e.transport !== "stdio") return "transport must be stdio: Filament speaks to language servers over stdio";
  if (e.startupTimeout != null && (!Number.isInteger(e.startupTimeout) || e.startupTimeout < 1000 || e.startupTimeout > 600000)) return "startupTimeout must be a whole number of ms from 1000 to 600000";
  if (e.env != null) return "env is not taken: a server of yours starts in Filament's environment, and settings keep no secrets";
  return null;
}

/**
 * The layers' `lsp.servers` merged by name, broadest first: a server replaces a broader one of its name and is on
 * unless it says `enabled: false`; a switch `{ name, enabled }` turns the server of its name on or off — a broader
 * layer's, a plugin's or one Filament knows — and keeps what it runs. → each name once: a server with its `enabled`, or
 * a switch where no layer gave the name a command (adapters/lsp/servers.js applies it).
 * @param {unknown[]} lists
 * @returns {Record<string, any>[]}
 */
export function mergeLspServers(lists) {
  /** @type {Map<string, Record<string, any>>} */
  const out = new Map();
  for (const list of lists)
    for (const e of Array.isArray(list) ? list : []) {
      if (lspServerProblem(e)) continue;
      out.set(e.name, e.command != null ? { ...e, enabled: e.enabled !== false } : { ...(out.get(e.name) || { name: e.name }), enabled: e.enabled });
    }
  return [...out.values()];
}
const REACHES = Object.freeze(["every", "filament", "screens"]);

/** Every knob by its dotted path (§5's tables). @type {Record<string, Knob>} */
export const KNOBS = {
  // 5.1 model
  "model.name": K("string", null, 2, "The model this session's turns go to.", { nullable: true, scope: "session", reach: "filament" }),
  "model.effort": K("enum", null, 2, "Reasoning effort: the level joined to the model name as Filament's own suffix (-high); null = the model's own default. The harness offers the levels the model takes — its row on the Upstreams page, else its provider's model list, else rules.effort.modelCaps, else Filament's built-in traits — and a level the model does not take is clamped on the wire (rules.effort.onUnsupported).", { options: ["low", "medium", "high", "xhigh", "max"], nullable: true, scope: "mode", reach: "filament" }),
  "model.fast": K("bool", false, 5, "Fast mode where the model has one — Anthropic's speed: fast (the families rules.speed.models names, up to 2.5× the output speed), or a provider's own request fields its Upstreams page row declares (xAI's and OpenAI's service_tier: priority) — billed at the model's fastMultiplier (2 = twice the price; on a flat-rate plan, twice the quota): joined to the model name as the -fast suffix. A model without fast mode runs at standard speed and the record says so.", { scope: "mode", reach: "filament" }),
  "model.flex": K("bool", false, 5, "The flex tier where the model has one (Providers P5): a provider's cheaper, slower processing, asked for with the request fields its Upstreams page row declares (OpenAI's service_tier: flex) — billed at the row's flexMultiplier (0.5 = half the price) only when the reply says it was served on that tier, else at the standard price. Joined to the model name as the -flex suffix, and only where the model has a flex tier; model.fast wins when both are on.", { scope: "mode", reach: "filament" }),
  "model.cacheTtl": K("enum", null, 5, "How long the provider keeps this chat's prompt cache after each request that reads or writes it, on the cache markers Filament adds (Anthropic's cache_control: 5m or 1h) — one hour costs 2× the input price to write instead of 1.25×, reads cost the same, and it outlasts the pauses of a long agentic session; five minutes is cheaper for a short one. Fixed for a turn when it starts, so a change reaches the next turn. Null = the route's rules (rules.cache.ttl, five minutes unless a rule says otherwise). The chat's own agent only: a coding agent, and a client that sends its own markers, keep theirs.", { options: ["5m", "1h"], nullable: true, scope: "mode", reach: "filament" }),
  "model.window": K("int", null, 5, "The context window this session works in, in tokens, where the model offers more than one (its Upstreams page row's windows, else Filament's built-in knowledge): the compaction line and the Context meter measure against it. Null = the model's standard window; a window the model does not offer is ignored.", { nullable: true, min: 1000, scope: "mode", reach: "filament" }),
  "model.maxTokens": K("int", null, 2, "max_tokens on every request; null = the model's own maximum output when it is known (maxOutputTokens: its upstream's model card, the provider's list or its refusal of a larger request, or the built-ins), else 128,000.", { nullable: true, min: 1, scope: "mode", reach: "filament" }),
  "model.thinking.budget": K("int", null, 4, "Extended thinking on every request with this budget of tokens (1024 or more); null leaves the model's default.", { nullable: true, min: 0, scope: "mode", reach: "filament" }),
  "model.thinking.keepInHistory": K("bool", false, 4, "Keep the model's thinking blocks in completed turns sent raw; off strips them (cheap only where the provider ignores earlier turns' thinking — see the derivation below). Derived on when thinking is on and the model keeps its thinking (Opus 4.5+, Sonnet 4.6+ — keepsThinking on its model card): stripping those blocks re-writes the whole history to the provider's cache every turn. An explicit choice always wins.", { scope: "mode", reach: "filament" }),
  // 5.2 loop
  "loop.permissions": K("enum", "edit", 2, "What the agent may do without asking: read-only, edit, ask or auto (agentLoop.permissions says what each runs). A command that only reads runs in every mode.", { options: ["read-only", "edit", "ask", "auto"], scope: "mode", reach: "filament" }),
  "loop.tools": K("json", null, 3, "Per-tool on/off: { read, write, edit, bash, bash_background, bash_output, bash_kill, powershell, grep, ask, plan, agent, delegate_read, glob, lsp, web_fetch, web_search, show_visual, artifact, space } (powershell is offered on Windows only). A tool set false is not offered to the model (the permission mode never leaves a tool out — it is enforced at the gate, so flipping it changes no request bytes). show_visual is the agent's visuals in the chat, with their guide (visual_guide), and its switch reaches a coding agent's visuals too. artifact is the agent's pages kept apart from the chat, in the Artifacts list; its switch reaches a coding agent's too. space is the project's Space — its board, logbook and claimed files — for a chat of a project; its switch reaches a coding agent's too. team is the main agent's tool that sends a team beside the chat (engine.agentTeams says where its result goes); its switch reaches a coding agent's too. thread is the main agent's tool that starts a chat of its own linked to this one, briefed by it (never in a team's chat nor one of another machine's agents); its switch reaches a coding agent's too. come_back is a harness chat's own agent coming back to the chat later, by itself, with a note.", { nullable: true, options: [...LOOP_TOOL_NAMES], scope: "mode", reach: "filament" }),
  "loop.rules": K("list", [], 5, "Rules judged before the permission gate, first match wins: [{ tool, pattern, verdict: allow|ask|deny|review }]. tool is a hand (bash, powershell, write, edit, read, grep, glob, web_fetch, web_search, browser, an mcp__server__tool name) or *; a rule on bash covers bash_background and powershell too. pattern is a glob (* any run, ? one character) over the call's subject — bash and powershell: the command and each of its && || ; | & and line-break segments (a deny or an ask on any segment covers the command; an allow must cover every segment, and never one that redirects or substitutes); write/edit/read: the path; grep/glob: the pattern; web_fetch: the URL; web_search: the query; browser: the address of the page it works on, and each it goes to (browser(*bank*) deny keeps it off a site, browser(https://github.com/*) allow lets it act there without asking); any other tool (an mcp__server__tool): the call's input as JSON. allow runs without asking (a learned rule carries learned: true and matches its permission's shape), ask asks even in auto, deny refuses in words, review asks with a second look first — the Reviewer, read-only, reads the move and says five lines on the card — even in auto, with no Always allow, and no allow rule or brief lifts it (a command Filament can tell only reads is left to the gate). Put a deny or an ask before the broad allow it is an exception to. Always allow in this project adds a learned allow; the harness's permission switch lists the rules in force in words, each with Forget.", { scope: "repo", reach: "filament" }),
  "loop.addedFolders": K("list", [], 5, "Folders besides the working folder the agent may read without asking: absolute paths, at most 16 in one place. The lists of your defaults, the project and the chat add up by path: a narrower one adds folders, and none takes one away. Each is judged as the working folder is (it exists, and lies under a folder agentLoop.roots lists when it lists any; a folder that does not pass is left out of the turn, said). Filament's agent reads, greps and globs there in every mode, and a command that only reads there passes as reading; a write there asks first in Edit and Ask, as anywhere outside the working folder, and runs without asking in Full access (auto). A coding agent in a harness chat is given them as its session opens where it takes them — Claude Code and Qoder (their added directories), Cursor's SDK way — and treats them as part of its workspace: it may change files there as its mode lets it, outside Filament's undo of the working folder. Codex reads anywhere already; Filament's judge of its commands takes them as readable.", { scope: "repo", reach: "filament" }),
  "loop.secondLook": K("bool", false, 3, "Second look before risky commands (HarnessV4_Space_Plan SG-D13): deploys, migrations, terraform apply and destroy, kubectl apply and delete, git push --force and tags, DROP/TRUNCATE/DELETE FROM, deleting cloud resources — review rules on bash (core/second-look.js RISKY) after loop.rules, each asking with the Reviewer's five lines first, in every mode, Full access too.", { scope: "repo", reach: "filament" }),
  "loop.steerFork": K("bool", false, 5, "Weigh your messages aside (the owner's forked steer of 11-04; off unless turned on, 11-05): on, a message you type while Filament's own agent works goes first to a fork of its conversation, read from the provider's cache, which sorts it while the agent works on, one message at a time — a correction of the work at hand reaches the agent at the step after the fork sorts it; a question the fork answers under your message; more work it plans as tasks proposed on the agent's graph, none started, with a sealed letter the agent opens when it chooses. A message goes straight in where no fork can weigh it, its bubble saying why: the turn's first request has not come back yet, its cache is cold, the conversation was compacted since that request, or a fork would carry more than half the compaction line. A picture, Ctrl+Enter, a stop and a Compact go straight in. Off, the default: every message goes straight to the agent, but one you send with the ⌄ menu's Weigh aside first, or as /steer-fork <your message>. A coding agent's chat sends them straight either way. Read as each message comes, so a change reaches a running turn.", { scope: "mode", reach: "filament" }),
  "loop.learnedPermissions.enabled": K("bool", true, 3, "Always allow in this project: offered on a call's question from its first ask, and the rules it made let that call shape run without asking (the gate asks every time when off).", { scope: "mode", reach: "filament" }),
  "loop.learnedPermissions.afterApprovals": K("int", 5, 3, "Approvals of the same call shape before memory offers a rule (an inferred permission item on the Memory page, and a line for a client that draws no card); the harness's card offers Always allow from the first ask.", { min: 1, scope: "mode", reach: "filament" }),
  "loop.readerModel": K("string", null, 3, "Cheap model behind delegate_read; null = the global agentLoop.readerModel; a model that is refused leaves the tool out.", { nullable: true, scope: "mode", reach: "filament" }),
  "loop.treeSnapshots": K("bool", true, 3, "Snapshot the working tree after each round that wrote files — the agent loop's, and in the harness a coding agent's — forks rewind on them, and the turn's \"N files changed +A −R\" card in the chat reads from them.", { scope: "mode", reach: "filament" }),
  "loop.resultCapChars": K("int", null, 4, "A tool result longer than this many characters reaches the model as its head plus a pointer (r:…) as it happens; the whole result is archived and filament_recall brings it back. Null takes the global agentLoop.resultCapChars; 0 means no cap (here it overrides a global one).", { nullable: true, min: 0, scope: "mode", reach: "every" }),
  "loop.verify.afterEdits": K("string", null, 5, "A command run in the project folder when a turn that wrote or edited files is about to end (a turn-end hook): a non-zero exit hands its output back to the model for one more round before the turn ends. Null = none.", { nullable: true, scope: "repo", reach: "filament" }),
  "loop.verify.readBackBeforeDone": K("bool", false, 5, "A turn that wrote or edited files it did not read back afterwards gets one more round asking for the read-back before it ends.", { scope: "mode", reach: "filament" }),
  "subagents.pool": K("list", DEFAULT_POOL, 5, "The models this chat's agents run on where neither their launch, this chat's rows for them (subagents.byCard, subagents.byTeam), their team nor their card names one, in your order — the chat's list: [{ model, effort? }] — model \"\" is the main agent's model, a row's effort how hard its agents think on it (none: the main agent's), up to 8 rows, each model once. A launch takes the first model from the top that can run and has room under its limit across Filament (each model's row under its provider or its coding agent; none set, no limit); one its provider fails, or answers with a 429 at its first call, goes on to the next row at that row's effort — never once it has acted. A team's workers run on it too, where nothing comes before (U13-D14). A row's old `seats` say nothing. The chat's own alone (the owner's word of 11-05): no default list of Filament's or a project's — with none, the main agent's model.", { scope: "session", reach: "filament", example: '[{"model":"zai/glm-5.3-flash"},{"model":""}]' }),
  "subagents.byCard": K("json", null, 5, "This chat's own models for an agent, by its card's tag (the owner's plan of 11-05: its Agents tab, Who runs on what): { tag: [{ model, effort? }] }, each list as the chat's list holds — in order, model \"\" the main agent's, a row's effort how hard it thinks on it. An agent of that card runs on them where its launch, its team and a Brief name no model, before its card's own models; one that cannot run, or has no room, passes it to the next, and only none that can is refused in words. Null, or a tag left out: its card's models, else the chat's list (subagents.pool), else the main agent's model. The chat's own alone. A team beside the chat takes them to its chat, for its workers.", { nullable: true, scope: "session", reach: "filament", example: '{"reviewer":[{"model":"zai/glm-5.3-flash","effort":"high"},{"model":""}]}' }),
  "subagents.byTeam": K("json", null, 5, "This chat's own models for a team, by its key: { key: { lead?, workers? } }, each a list as the chat's list holds — in order, model \"\" the chat's own model, a row's effort how hard it thinks on it. Its lead beside the chat runs on the first of its lead's that can run, where the Brief picks none, before the team's own (leadModels) and its card's; its workers on theirs where the Brief picks none, before the team's own models — a worker the team names a model for keeps it; a workers' row with no effort thinks as its lead. Null, or a key left out: as the team says. The chat's own alone; a team beside the chat takes its workers' to its chat.", { nullable: true, scope: "session", reach: "filament", example: '{"bughunters":{"lead":[{"model":"claude-opus-5-5","effort":"high"}],"workers":[{"model":"zai/glm-5.3-flash"}]}}' }),
  "subagents.ask": K("list", [], 5, "The saved agents this session's main agent may ask, by tag (Library lists them); empty = nobody. The agent tool lists them, each with the line that says what it is good for, and the agent's instructions say when to ask one. Set here it replaces the global agentLoop.subagents.ask for this session.", { scope: "mode", reach: "filament" }),
  "subagents.teams": K("list", [...AGENT_TEAMS], 5, "The teams this session's main agent may send on the side by itself, by key (U13-D9: Library › Agents, \"Your agent may use it\"): its team tool refuses any other in words, and its status names the rest as the person's to send. A team the person sends — a Brief, or a team named after @ in their message — is theirs, whatever this says. Empty = none. Set here it replaces the global agentLoop.subagents.teams for this session.", { scope: "mode", reach: "filament", example: '["bughunters","builders"]' }),
  "subagents.envelopes": K("enum", "sealed", 5, "How another agent's result reaches this chat's agent while it works (HarnessV4_Envelopes_Plan): sealed (the default) — one line in its sender's words, the report kept with Filament until the agent opens it with envelope, oldest first; what lands while the agent waits comes opened — or whole: every result reaches it whole, the moment it lands. A background sub-agent's report, a saved agent's answer, a team's worker's report to its lead, a team's result beside the chat, a flow's end; for Filament's own loop and a coding agent that has Filament's tools alike; never your own Send, a question, a look or the task graph's words. Read at each step, so a change reaches a running turn. How you work: your defaults (Settings › Context) may set it (EN5).", { options: ["sealed", "whole"], scope: "mode", reach: "filament" }),
  "subagents.parallelize": K("bool", null, 5, "Parallelize tasks for this chat alone (the owner's of 11-16: the card's Always accept in this chat): on, a sub-agent its agent launches that changes files starts without the card that asks you first, its task graph's tasks that can run at once start by themselves, and its agent is told it may run them so, as Settings › Experimental › Parallelize tasks on says for every chat; off, the card asks in this chat whatever that switch says. Null = as that switch says. Its Agents tab says it and turns it off.", { nullable: true, scope: "session", reach: "filament" }),
  "subagents.worktree": K("bool", true, 5, "A sub-agent that changes files works in its own git worktree — a copy of the project as it stands at the launch, uncommitted changes included — so it never collides with the main agent's edits; its changes reach the folder when the main agent or you apply them (merged with what changed meanwhile, all or nothing). Off: it works in the session's folder, beside the main agent. A folder outside git always shares. A launch may say otherwise.", { scope: "mode", reach: "filament" }),
  "subagents.workspace": K("enum", null, 5, "Where a sub-agent that changes files works (the owner's plan of 11-09 for big repos): auto — a builder on Filament's own loop gets a patch: no checkout, a folder at its worktree's place holding only the files it read or wrote, the rest read from the project as it stood at its launch, its changes waiting to be applied as a worktree's do; it moves to a worktree at the same folder once it runs a command, a language server or a hook. A coding agent, one that runs in a copy, a worker or task with a check, a brief or card that names commands, attempts, a session with hooks on read, write or edit or with MCP servers on this computer (which a patch's folder would hold), and a card whose last three launches here each moved within five calls get a worktree from the start. patch or worktree: that kind for every builder (a coding agent, or a session with MCP servers on this computer, always gets a worktree); folder: the session's folder, beside the main agent. A worktree on auto is a copy-on-write clone where the drive clones files and git ignores build caches here (they come warm), a sparse checkout of the folders its launch names for a builder in a big repository (widened as it reads or writes outside them), else every file checked out; worktree always checks out every file. Null: as subagents.worktree says — on, auto; off, the folder. A launch may say otherwise.", { options: ["auto", "patch", "worktree", "folder"], nullable: true, scope: "mode", reach: "filament" }),
  // 5.3 the engine
  "engine.mode": K("enum", "model", 5, "Which engine answers this session's turns: `model` — the session's model, as its turns name it (the default); `team` — the team engine.team names: a lead on that model, which plans, briefs and checks, and workers that do the work (`/team <name>` sets both).", { options: [...ENGINE_MODES], scope: "mode", reach: "filament" }),
  "engine.team": K("string", null, 5, "The team that answers this session's turns when engine.mode is team: a shipped one (builders, bughunters) or one of yours, by its key. `/team` lists them; a name that is no team is said on every turn, and the turns go to the session's model.", { nullable: true, scope: "mode", reach: "filament" }),
  "engine.teamWorkers": K("string", null, 5, "The model the leading team's workers run on in this chat, the team's own models and its workers' cards set aside (U13-D8): what a team's Brief picked for the run — a team on the side, its own chat; a team in charge, this one. Null = this chat's rows for its workers (subagents.byTeam), else the team's own models, else each worker's card, else the chat's list (subagents.pool) — with none of its own, its lead's model. Read at each launch.", { nullable: true, scope: "mode", reach: "filament" }),
  "engine.teamEffort": K("enum", null, 5, "How hard the leading team's workers think in this chat, where their lead's launch names no effort: what a team's Brief picked for the run — a team on the side, its own chat; a team in charge, this one. Each runs at the highest level its model takes at or below it; `model`, each model's own default. Null = each row's effort, else its lead's (model.effort of the chat its lead runs in; a team in charge, the main agent's). Read at each launch.", { options: [...SUBAGENT_EFFORTS], nullable: true, scope: "mode", reach: "filament" }),
  "engine.supervise": K("bool", true, 5, "Whoever hands work out reads along with those who do it: a team's lead with its workers, and the session's own agent with the sub-agents of its task graph. On (the default): while they run, Filament shows the lead a look at them — each worker's plan as it said it, what it has done so far in a line, and every round since the last look whole: what it thought, said and called — due at once on a sign (it said its plan, made its first change, wrote outside its files, the same command failed a third time, it tried a step that cannot be undone, it compacted its context, it asks its lead or it waits for your answer), else at the pace engine.lookSeconds sets. The lead corrects a worker that heads wrong with a message it reads at its next step — a team's lead with its worker tool, the agent with tasks note. Only the newest look stays in the lead's conversation: each one replaces the one before, and a finished turn keeps none. A coding agent that leads a team keeps its own conversation, where Filament replaces nothing: each of its looks holds only what is new since the one before. Off: a lead sees a line of status for each worker when its wait returns, and the agent hears each task's end. Read when a turn starts, so a switch reaches the next turn.", { scope: "mode", reach: "filament" }),
  "engine.agentTeams.notifyWhenDone": K("bool", null, 5, "When this chat's main agent sends a team beside it (its team tool), whether the team's result goes to the agent by itself when the team ends — into its running turn, or as a turn of Filament's own where it is at rest; after BugHunters' check, where engine.agentTeams.verifyFirst is on too. Null = as the team says (its own setting on Library › Agents and teams; the teams that ship say off). The team's card in the chat has the switch too, which may be flipped while it works. A team you send yourself takes the switches of its Brief, off unless you turn them on.", { nullable: true, scope: "mode", reach: "filament" }),
  "engine.agentTeams.verifyFirst": K("bool", null, 5, "When this chat's main agent sends a team beside it (its team tool), whether BugHunters checks the team's result when it ends, against the code as it is then, fixing nothing. Null = as the team says (its own setting on Library › Agents and teams; the teams that ship say off). The team's card in the chat has the switch too, which may be flipped while it works.", { nullable: true, scope: "mode", reach: "filament" }),
  "engine.lookSeconds": K("int", LOOK_SECONDS, 5, "The pace of a lead's looks at its workers (engine.supervise): the seconds between two looks while no sign makes one due at once. 0 = whenever something is new. The default, 300, is five minutes. Read at each look, so a change reaches a running turn.", { min: 0, max: 3600, scope: "mode", reach: "filament" }),
  // 5.4 context
  "context.carry": K("enum", "words", 5, "What a fresh coding-agent session carries of the earlier turns — a switch into the agent, a start after Filament's compaction, a start after its own session was lost — each value with its name: words (Words, the default): your words and the agent's, with one line that counts each turn's tool calls and names the files they changed · fold (Folded): the same with one line per tool call · fold+2 (Folded, newest 2 whole) · plain (Whole): every finished turn as it was sent, tool calls and their output as text. Tool output is what an agent's session is mostly made of, and a fresh session cannot use it as its own: it reads the files again. Where the agent compacted its own context and handed its summary over, the start is that summary and the turns since, in this form. The agent keeps its own history, so this shapes that start only. One summary of everything is compaction's (Compact now).", { options: [...CARRY_FORMS], scope: "mode", reach: "filament" }),
  "context.results": K("enum", "keep", 2, "Tool-result policy on the finished turns sent whole: keep (the default) as they ran · line each its one line, with its recall id (r:…) where the line leaves something out, on a finished turn whose lines save 10K tokens or more (a smaller one goes as it ran, so its cache holds). Kept for chats that chose them before: status the line without an id · dedupe-to-tail the same call's older results point at the newest · pointer every result a pointer (r:…).", { options: RESULT_POLICIES, scope: "mode", reach: "filament" }),
  "context.compaction.model": K("string", null, 2, "The side model: it writes every compaction summary of this session where context.compaction.writer is not session — the harness's compaction at turn start, Compact now, a fork's brief, the agent loop's fold at the compaction line, and /autofit. Null = each path's own default — the session's model for the harness, the loop and /autofit. On agent runs the mid-turn fold waits on this call — name a fast model when the session's model is slow. A coding agent's model can be named too: the agent reads the transcript in a session of its own, opened for the call in a folder of Filament's and closed after it, read-only and with none of Filament's tools, on its plan and with its own prompt on top of each call.", { nullable: true, scope: "mode", reach: "filament" }),
  "context.compaction.thresholdPercent": K("int", 85, 2, "Percent of the model's window at which compaction runs: 85 compacts once the request reaches 85% of the window. The reply's room is guaranteed separately (max_tokens is clamped to what remains), so the percentage you set is the percentage you get. In a harness chat on a coding agent, /autocompact <tokens> sets it for the session, kept as a whole percent of the window (400k of a 1,000,000 window is 40), and a session opened from then on is handed it as its agent's own point.", { min: 10, max: 100, scope: "mode", reach: "filament" }),
  "context.compaction.mode": K("enum", "ask", 4, "What a message you send does when it would go past the line (context.compaction.thresholdPercent of the window; in a coding agent's session, of the agent's window against what the agent last said it holds, or against Filament's copy where the message starts a fresh agent session). ask (the default): it stops first and asks — every way to make room with what it leaves and what it costs, and nothing is compacted until you choose one. auto: Filament makes room by itself there, by context.compaction.method (a coding agent's session: context.compaction.agent), and sends. A turn that is already running never stops to ask, whichever this says: Filament's own loop folds its oldest rounds into one summary at the line so a long turn keeps running inside the window, and a coding agent compacts its own session. A message that answers a waiting question, permission or proposal goes on in its turn the same way.", { options: ["auto", "ask"], scope: "mode", reach: "filament" }),
  "context.compaction.method": K("enum", "summary", 5, "How compaction makes room at the line, each value with its name. summary (One summary, the default): every finished turn since the last summary becomes one summary, written by the same model or a side model (context.compaction.writer). fold (Instant fold): every finished turn but the newest context.compaction.keepWhole folds to your words, one line per tool call and the reply — local, no model call.", { options: [...COMPACTION_METHODS], scope: "mode", reach: "filament" }),
  "context.compaction.instantTokens": K("int", INSTANT_TOKENS, 5, "How small an instant fold must leave the earlier turns, in tokens: the finished turns as it leaves them and the summary before them, never the system prompt or the tools. The way that asks before a message offers Instant fold at this or less, and a side model's summary of turns too big for one call of its window whole is that fold instead where the fold leaves this or less, with no model call. A session whose method is fold folds at its line whatever it leaves. 0: never instant.", { min: 0, max: 1_000_000, scope: "mode", reach: "filament" }),
  "context.compaction.keepWhole": K("int", 1, 5, "The newest finished turns a fold compaction keeps whole.", { min: 0, max: 10, scope: "mode", reach: "filament" }),
  "context.compaction.agent": K("enum", "suggested", 5, "How a coding agent's session makes room, at its line and on Compact now. Its line is context.compaction.thresholdPercent of the agent's window, against what the agent last said its context holds — the agent composes its own context, and Filament's copy only seeds a fresh agent session. Each value with its name: suggested (Suggested, the default): own where the agent has a compaction of its own now; else self while the agent's cache is warm (its last turn ended within the hour) and the agent can write the summary; else ours. own (the agent's own compaction): the agent's own compaction (Claude Code's /compact, Codex's) in its live session, which goes on in it; on Compact now forked first where it can, so Undo brings the session from before back (else Undo starts a fresh session from Filament's copy); /compact typed in the harness is one too; if it fails, ours, and the note says why. self (the agent writes a summary): the agent writes Filament's summary from its warm session — in a fork where it can make one, read-only; if it fails, ours, and the note says why. ours (Filament's copy): Filament's methods on its copy (context.compaction.method), the summary written by context.compaction.model, else memory's model — a coding agent's among them, in a session of its own, never in the chat's — and fold, which calls no model, when there is neither. self and ours start a fresh agent session from the compaction. A way the agent does not have gives way to the suggestion. In the middle of a turn only the agent itself can make room, its own way whatever this says: Claude Code is handed the line as its auto-compact window (the line plus the 33,000 tokens it keeps free, within the 100,000 to 1,000,000 it takes — so it acts at the line, and no lower than 67,000) and compacts by itself when a turn crosses it; a session whose agent has named no window yet is handed it from its second turn. Other agents compact at their own point.", { options: [...COMPACTION_AGENT_WAYS], scope: "mode", reach: "filament" }),
  "context.compaction.resumeQuestion": K("bool", true, 5, "A message you send after the session's prompt cache has gone cold asks first, where the same model or agent goes on in it and the message could go as it is: Send as it is, or make room first. Going on pays for all the session holds again at the full price, and the question says what will read it, how much, and how long it sat idle. Cold is the cache's own life since the last turn ended: for a model Filament calls, five minutes or one hour by its route's cache rule (a model whose replies read and wrote no cache has none to lose, and never asks); for a coding agent one hour, the longest any provider keeps a cache — Filament sees nothing of an agent's cache, so it asks only once it is cold for sure. It also asks where a coding agent's bridge keeps no session of the chat any more, so the message would start a new one from Filament's copy. Off (the question's Don't ask again): it never asks for this; a message past the line still asks under context.compaction.mode ask.", { scope: "mode", reach: "filament" }),
  "context.compaction.changeQuestion": K("bool", true, 5, "A message you send after what the chat sends ahead of its history changed asks first: Filament updated its words or tools, an MCP server connected, removed or changed, a tool, skill, web hand or the browser switched. The question says what changed. In Filament's loop every request sends them as they are now, so going on writes the whole history to the provider's cache again at a write's price — compacting first (Instant fold, or a side model's summary) leaves less to write; asked only while the cache is warm, since a cold one is written whole anyway (the cold question then says what changed). A coding agent's session that goes on can keep what it already loaded in its old form: compacting starts a fresh agent session from the compaction, which reads it all anew, and the transcript stays one; Send as it is goes on in the session as it is. Off: it never asks for this.", { scope: "mode", reach: "filament" }),
  "context.compaction.follow": K("bool", true, 5, "In a coding agent's session: Filament keeps its own copy of the chat in step with the agent. The agent holds the conversation in a session of its own and compacts it itself; Filament's copy is what a fresh agent session, or another model, starts from. Where the agent hands its summary over as it compacts (Claude Code), the copy starts from that summary, whatever this says. Where it hands none (Codex, Cursor, a session that held less than the whole chat), or the copy passes the session's line (context.compaction.thresholdPercent of the agent's window), a model Filament calls — context.compaction.model, else memory's — writes a summary for the copy alone, in the background once the turn has ended: the summary the copy stood on and the finished turns since, all but the newest, which stays as it was said. It is written only where it makes the copy smaller: where those turns, as the copy holds them, weigh no more than a summary would, the copy keeps them, and is asked again after each turn. Nothing waits on it, the agent's own session goes on as it is, and the row is listed with the session's compactions; stopped from its row, it is not tried again until the agent next compacts. With no model to write it, nothing is written. Off: the copy keeps every turn until it is compacted on request, or a start that does not fit asks.", { scope: "mode", reach: "filament" }),
  "context.compaction.writer": K("enum", null, 5, "Who writes a compaction's summary, each value with its name. session (Same model): the session's own model — reading its warm prompt cache when it can (the summary then costs the cache's read price for the whole conversation, plus its output), the way to pick while the cache is warm. model (Side model): context.compaction.model, else memory's cheap model, the way to pick once the cache is cold. A writer reads the finished turns whole where they fit one call of its window; where they don't, their tool calls fold first — and where the folded turns weigh context.compaction.instantTokens or less, the side model is not called at all: the compaction is an instant fold. Folded turns still too big for one call are read in sequential slices. Null = context.compaction.model when it names one, else the session's model — which reads its warm cache the same way.", { options: [...COMPACTION_WRITERS], nullable: true, scope: "mode", reach: "filament" }),
  "context.view.stubChars": K("int", 160, 2, "Characters per stub line in a fold.", { min: 60, max: 600, scope: "mode", reach: "filament" }),
  "context.view.foldImages": K("bool", true, 2, "Images in folded turns become a line.", { scope: "mode", reach: "filament" }),
  // 5.5 memory
  "memory.enabled": K("bool", true, 2, "Memory for this session. Off = muted, the state @mem off sets: nothing new is recalled into the window and nothing is learned from the session; recording continues (the archive keeps every turn), and blocks earlier turns received (and a briefing built before) still ride so the provider's cache holds.", { scope: "mode", reach: "every" }),
  "memory.briefing": K("bool", true, 3, "The briefing block at the end of the system prompt (built once per session; off = not built, and one built earlier is not placed).", { scope: "mode", reach: "every" }),
  "memory.turnBlock": K("bool", true, 3, "The per-turn recall block on the newest user message (blocks earlier turns received still re-attach).", { scope: "mode", reach: "every" }),
  "memory.tools": K("bool", true, 3, "Memory tools offered to the model, on the loop's ticks too.", { scope: "mode", reach: "every" }),
  "memory.turnTokens": K("int", 300, 3, "Base token budget of the per-turn block (signals scale it).", { min: 0, scope: "mode", reach: "every" }),
  "memory.minScore": K("number", 0.2, 3, "Relevance floor for recall.", { min: 0, max: 1, scope: "mode", reach: "every" }),
  "memory.learn": K("bool", true, 3, "The learner may read this session. Off here or in privacy.learn = off; memory.enabled off keeps the learner out too.", { scope: "mode", reach: "every" }),
  "memory.index": K("bool", true, 3, "This session's text is in the search index. Off here or in privacy.index = out (its rows are removed; on again re-indexes).", { scope: "mode", reach: "every" }),
  "memory.loads": K("list", [], 2, "Sessions loaded as material into this one.", { scope: "session", reach: "every" }),
  // 5.6 instructions, skills, hooks, plugins
  "instructions.files": K("list", ["AGENTS.md", "CLAUDE.md", ".filament/instructions.md"], 5, "Files looked for in the chat's folder and each folder above it up to the top of its repository (paths relative to each), outermost first, and placed at the end of the loop's system prompt, byte-stable, each capped at 24,000 characters; a missing file is skipped, and one that holds what another told before it holds is told once. A folder below the chat's is told its files with the round's results when the agent first reads, edits or writes a file there, and again once a compaction has dropped them. The Prompt pane shows the block.", { scope: "repo", reach: "filament" }),
  "instructions.userFiles": K("list", [], 5, "Files of your own read in every chat wherever it works, and placed before the project's instruction files in the loop's system prompt: one path each, ~ for your home folder (a path that names no root is read from it too), each capped at 24,000 characters; a missing file is skipped. None by default: a file written for another agent, as ~/.claude/CLAUDE.md is for Claude Code, brings that agent's rules with it.", { scope: "mode", reach: "filament", example: "[\"~/.claude/CLAUDE.md\"]" }),
  "instructions.session": K("string", "", 5, "Free text placed after the instruction files in the system prompt, for this session alone.", { scope: "mode", reach: "filament" }),
  "skills.on": K("list", [], 5, "Your skills (Library › Skills) that are on here: [{ name, enabled? }], each by its name there. The lists of your defaults, a Space of your own that shows the project, the project and the chat add up by name: a narrower one turns a skill on, or off with { name, enabled: false }. A skill on is named in every agent's instructions — Filament's own and a coding agent's, which loads it with Filament's skill tool (one in the agent's own skill folders it loads with its own) —, rides whole on a turn whose message names one of its triggers or types /<name>, and its folder's files are read with the same tool.", { scope: "repo", reach: "filament" }),
  "hooks": K("list", [], 5, "Commands run in the project folder at pre-tool (before a hand runs; may block or rewrite its input), post-tool (after; may annotate or block the result), turn-end (may send the turn back for one more round), session-start (the first turn, again after a block; may refuse it), prompt-submit (your message, before the model reads it; may refuse it, and a note rides it), pre-compact (before a compaction folds the turn's work; told, never a block) and subagent-end (a sub-agent about to finish; may send it back): [{ on, tool?, command, timeoutMs? }]. The hook reads the event as JSON on stdin and answers { verdict: allow|block, args?, note? } on stdout; no JSON = allow, a non-zero exit = block with the output as the note. A pre-tool hook runs before the call is judged: a rewrite is the call loop.rules, the mode and your answer judge, and asked about where it asks. Every run is audited and shown as a card.", { scope: "repo", reach: "filament" }),
  "plugins.mcp": K("list", [], 5, "Your MCP servers, for whichever engine answers: [{ name, command, args?, env?, cwd? }] over stdio or [{ name, url, headers? }] over streamable HTTP. The lists of your defaults, the project and the chat add up by name: a narrower one adds a server, replaces one of its name, switches one on or off with { name, enabled }, or picks the account a remote one signs in with by { name, account } (main is the first; a server may say account itself), or how its tools reach the loop by { name, load }; a server may say enabled: false to be kept off. An env value or header whose name looks like a credential is never shown again: it reads __SECRET__, and __SECRET__ written back keeps it. The loop offers their tools as mcp__<name>__<tool>: a server whose load is core every tool in full with every request; any other (load on-demand, the default) each tool by its name in the prompt, which the agent loads and calls through its mcp tool, so a server costs its names until it is used. A server that does not answer is left out with a note; loop.rules can name its tools. A coding agent in a harness chat is given them as its session opens, beside its upstream's own mcpServers (on one name this list's wins): over ACP without a cwd, which ACP cannot carry, and an HTTP one only where the agent takes MCP over HTTP; Codex and Cursor's SDK way take them whole. A change reaches the agent at the next turn. A team's lead gets none. `filament` is Filament's own server's name.", { scope: "repo", reach: "filament" }),
  "plugins.web.fetch": K("bool", true, 5, "The web_fetch hand: GET a public http(s) URL, the page as text (HTML stripped, at most 24,000 bytes of it per call, 20 s). On by default, as every tool is in a new chat. It runs in every mode, read-only included — a URL can carry words out of the session, so a loop.rules entry web_fetch(*) ask asks first.", { scope: "mode", reach: "filament" }),
  "plugins.web.search": K("bool", true, 5, "The web_search hand: one query or several at once (merged, duplicates removed) to the search service with your key (web.searchProvider and web.searchApiKey in the config: Brave, Tavily or Serper) or to the search endpoint (web.searchEndpoint; DuckDuckGo's HTML page by default), the first results as title, URL and snippet. On by default, as every tool is in a new chat. Runs in every mode; the query leaves the session — web_search(*) ask in loop.rules asks first.", { scope: "mode", reach: "filament" }),
  "plugins.browser": K("bool", true, 5, "The browser tool (HarnessV4_Browser_Plan): the agent drives a browser in the Browser pane beside the chat — Chromium in the Filament desktop app, one profile for every chat with its sign-ins kept, or where no app is connected, headless Chrome on Filament's own machine, whose sign-ins last until Filament stops — which you watch and can take over. On by default, as every tool is in a new chat. Every agent of the chat has it — its sub-agents, each in tabs of its own the pane names, and a coding agent through Filament's MCP server (HarnessV4_AgentTools_Plan AT-D2, AT-D7); taking it over holds them all. Looking (going to a page, reading it, a screenshot) runs in every mode; acting on a page (click, type, press a key, choose, run a script) is refused in read-only, asks once per site in Edit — the yes holds for the chat — and runs in Full access. With neither the app connected nor Chrome on Filament's machine, its calls say so.", { scope: "mode", reach: "filament" }),
  "plugins.on": K("list", [], 5, "The plugins installed in Filament (Library › Plugins & Connectors) that are on here: [{ id, enabled?, hooks? }], the id as name@marketplace. The lists of your defaults, the project and the chat add up by id: a narrower one turns a plugin on, turns one off with { id, enabled: false }, or switches its hooks with { id, hooks }. A plugin that is on brings its MCP servers — on demand, named <plugin> or <plugin>-<server>; one of yours of the same name keeps that name —, its skills, and its commands as skills, each named <plugin>:<name>, which a message can name as /<plugin>:<name>. Its hooks run only where hooks is true. The values it asks for (Library › Plugins & Connectors) are filled in for the place: the chat's over the project's over your defaults'. A coding agent gets its MCP servers as it gets yours.", { scope: "repo", reach: "filament" }),
  "lsp.servers": K("list", [], 5, "The language servers Filament's agents ask about code (the lsp tool: definition, references, hover, a file's symbols, and the new errors an edit leaves). Filament runs one it finds installed on this computer, nothing bundled: typescript-language-server for .ts, .tsx, .js and .jsx; pyright-langserver, else pylsp, for .py; gopls for .go; rust-analyzer for .rs; clangd for C and C++ — and the ones a plugin on here brings (its .lsp.json). This list adds your own, as Claude Code's .lsp.json writes one (over stdio, in Filament's environment: no env), or switches one off: [{ name, command, args?, extensionToLanguage: { \".ext\": \"languageId\" }, initializationOptions?, settings?, startupTimeout?, enabled? }] or { name, enabled }. The lists of your defaults, the project and the chat add up by name: a narrower one adds a server, replaces one of its name, or switches one on or off — Filament's own by their names typescript, pyright, pylsp, gopls, rust-analyzer and clangd, a plugin's by the name its page gives it; a switch reaches every server of its name. For a file, yours come first, then the plugins', then Filament's own: the first that is on and installed serves it.", { scope: "repo", reach: "filament", example: '[{"name":"pyright","enabled":false}]' }),
  // The worktree template (HarnessV4_Four_Plan E19)
  "worktree.copy": K("list", [], 5, `What a new worktree of this project gets a copy of, beside what git checks out: files and folders git ignores or does not have yet (.env, node_modules, Unity's Library), each a path from the repository's top folder, at most ${COPY_MAX}. Copied when the worktree is made — at a chat's start (Works in › New worktree…) or by Move to a worktree… —, each entry switchable there for that worktree alone; the chat's first turn waits for the copy, with Send without it. A link is copied as a link, a file git put there is left as it is. The project's list replaces your defaults'.`, { scope: "repo", reach: "screens", turns: false }),
  // 5.7 fork
  "fork.transcript": K("enum", "ditto", 4, "What a fork inherits of the transcript, each value with its name: ditto (As it was) — as the source had it · folds (Folded) — every inherited turn folded · brief (One summary) — one lineage summary, the turns dropped. The fork dialog can pick another.", { options: ["ditto", "folds", "brief"], scope: "mode", reach: "screens" }),
  "fork.results": K("enum", "keep", 4, "Result policy the fork's document starts with across the inherited turns.", { options: ["keep", "line", "dedupe-to-tail", "pointer"], scope: "mode", reach: "screens" }),
  "fork.worktree": K("bool", false, 4, "Check the files out as they were at the fork turn (a git worktree), when a snapshot exists.", { scope: "mode", reach: "screens" }),
  "fork.settings": K("enum", "inherit", 4, "The fork's settings layer: inherit this session's own layer, or start from the project's alone.", { options: ["inherit", "project"], scope: "mode", reach: "screens" }),
  // 5.8 privacy, display
  "privacy.learn": K("bool", true, 3, "The learner may read this session. Off here or in memory.learn = off.", { scope: "repo", reach: "every" }),
  "privacy.index": K("bool", true, 3, "This session's text is in the search index. Off here or in memory.index = out.", { scope: "repo", reach: "every" }),
  "privacy.redact": K("list", [], 5, "Regular expressions (as strings) replaced with [redacted] in tool results and hook notes before any model reads them — the loop's hands, MCP and web results, the files delegate_read hands its reader — and in the whole results archived for filament_recall. A background shell's output is redacted whole, never one read's slice alone, and while it runs its unfinished last line waits for its end, so a secret it is printing is never shown half.", { scope: "repo", reach: "filament" }),
  "privacy.bashDeny": K("list", [], 5, "Command globs the loop refuses, in words (judged like a loop.rules deny on bash, ahead of the rules).", { scope: "repo", reach: "filament" }),
  "display.pinned": K("bool", false, 2, "Pinned in the sidebar.", { scope: "session", reach: "screens" }),
  "display.title": K("string", null, 2, "The session's name.", { nullable: true, scope: "session", reach: "screens" }),
  "display.archived": K("bool", false, 2, "Hidden from the tree.", { scope: "session", reach: "screens" }),
  "display.unread": K("bool", false, 2, "Unread mark.", { scope: "session", reach: "screens" }),
};
// Scope and reach are required, not defaulted: a knob declared without both fails the import, not a read at runtime.
for (const [path, k] of Object.entries(KNOBS))
  if (!SCOPES.includes(/** @type {any} */ (k.scope)) || !REACHES.includes(/** @type {any} */ (k.reach)))
    throw new Error(`session-settings: the setting "${path}" needs a scope (session|repo|mode) and a reach (every|Filament|screens)`);

/**
 * A knob by its path, as KNOBS holds it as its own — never by a name every object answers (`constructor`, `toString`,
 * `__proto__`), which passed as a knob (the security review of f-fence: `__proto__` set the flattened patch's prototype,
 * and the MCP server it held was written past every check). Undefined for none. @param {string} path
 */
const knobOf = (path) => (Object.hasOwn(KNOBS, path) ? KNOBS[path] : undefined);
/**
 * The names that open an object's prototype, never a knob's part: a document's key that is one, or a dotted path through
 * one, is passed by (`flatten`, `unflatten`), and another machine's agents are refused a body holding one at any depth
 * (http/admin/remote.js `agentBodyRefusal`).
 */
export const PROTO_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
/** Whether a key, dotted or not, names a prototype's door (`PROTO_KEYS`) in any part. @param {string} key */
const protoPath = (key) => key.split(".").some((p) => PROTO_KEYS.includes(p));

/**
 * A knob's scope (D1): `session` knobs belong to one session alone (never the project layer); `repo` knobs are facts
 * about the repo (the project layer or a session's own); `mode` knobs are how you want to work right now (a session's
 * own layer or your defaults, never the project layer). Unknown paths read as mode: an unknown key is refused on write
 * anyway, and a read must never throw.
 * @param {string} path
 */
export const scopeOf = (path) => (SCOPES.includes(/** @type {any} */ (knobOf(path)?.scope)) ? KNOBS[path].scope : "mode");

/**
 * A knob's reach (D2): `every` — obeyed whichever client runs the session, a direct-to-model chat included; `filament`
 * — only when Filament composes the session (the harness) or runs its own loop;
 * `screens` — Filament's own screens and actions. Reach only drives words (`/set`, `/settings`, the editor's badge);
 * it changes no behavior. Steps 4 and 5 move knobs to `every` as they make them work for everyone.
 * @param {string} path
 */
export const reachOf = (path) => (REACHES.includes(/** @type {any} */ (knobOf(path)?.reach)) ? KNOBS[path].reach : "filament");

/**
 * The result policy each form of the earlier turns implies (§6.2/§6.3) — a fresh agent session's start
 * (`context.carry`), a sub-agent's folded view, a lead's record of a team's chat — where no layer chose
 * `context.results`. A policy acts on the turns a form sends whole only, so a form that keeps turns whole keeps their
 * results: "Folded, newest 2 whole" is whole (HarnessV4_Tasks U0 item 8, V4-D302: they went as one status line each).
 */
export const RESULTS_BY_FORM = Object.freeze({
  plain: "keep", words: "status", fold: "keep", "fold+2": "keep",
});

/** The shapes in the one direction a compaction moves a turn: further from raw is a higher rank. */
export const SHAPE_RANK = Object.freeze({ raw: 0, fold: 1 });

/**
 * The loop's result cap in force (§6.3), in characters, 0 for none: the document's `loop.resultCapChars` when it holds
 * a number (0 included — off is a choice), else the global agentLoop.resultCapChars (a request with no document reads
 * the global alone).
 * @param {any} docLoop  the effective document's `loop` section, or null
 * @param {any} globalLoop  `cfg.agentLoop`
 */
export function resultCapOf(docLoop, globalLoop) {
  const own = docLoop?.resultCapChars;
  const v = own === null || own === undefined ? globalLoop?.resultCapChars : own;
  return Number(v) > 0 ? Math.floor(Number(v)) : 0;
}

/**
 * A settings change as a card (Facade D4), built by the one writer — it holds both states. `before` and `after`
 * each carry the state's `flat` (values in force) and `sources` (per-path layer); a source in the card's data is a
 * layer name. `o.changes` is the writer's own change list ({ path } — the values the card carries are each state's
 * value in force, read from its `flat`, so an unset's row says what the layers below hold now). The undo action rides
 * only when exactly one setting changed and `/set` can set it.
 * @param {any} before @param {any} after
 * @param {{ changes: { path: string }[] }} o
 * @returns {{ kind: string, v: number, changes: any[], actions?: { label: string, command: string }[] }}
 */
export function settingsChangeCard(before, after, o) {
  const sourceOf = (/** @type {any} */ state, /** @type {string} */ path) => String(state.sources?.[path] || "default");
  // The card lands in the transcript: an MCP server's credentials ride it as the placeholder (HS-D8), and so do those in a
  // language server's options.
  const shown = (/** @type {string} */ path, /** @type {any} */ v) => (v === undefined ? null : path === MCP_KNOB ? maskList(v) : path === LSP_KNOB ? lspMasked(v) : v);
  const changes = (o.changes || []).map((c) => ({
    path: c.path,
    from: shown(c.path, before.flat?.[c.path]),
    to: shown(c.path, after.flat?.[c.path]),
    fromSource: sourceOf(before, c.path),
    toSource: sourceOf(after, c.path),
  }));
  const card = /** @type {any} */ ({ kind: "settings-change", v: 1, changes });
  // Undo writes the value before back as words. The MCP servers' words hide their credentials, so an undo could not
  // put a changed one back: theirs has none, nor has a language servers' list whose value before had one hidden.
  const hid = (/** @type {string} */ path) => path === LSP_KNOB && JSON.stringify(shown(path, before.flat?.[path])) !== JSON.stringify(before.flat?.[path] ?? null);
  if (changes.length === 1 && !!knobOf(changes[0].path) && changes[0].path !== MCP_KNOB && !hid(changes[0].path)) {
    const { path, from } = changes[0];
    card.actions = [
      before.sources?.[path] === "session"
        ? { label: "Undo", command: `/set ${path} ${formatKnobText(path, from)}` }
        : { label: "Undo", command: `/unset ${path}` },
    ];
  }
  return card;
}

/**
 * Nested document → dotted paths. Lists and `json` knobs are leaves. A key through a prototype's door (`PROTO_KEYS`) is
 * passed by, and the paths come on an object with no prototype: no check of one reads a key it never held.
 * @param {any} doc @param {string} [prefix]
 */
export function flatten(doc, prefix = "") {
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  for (const [k, v] of Object.entries(doc)) {
    if (protoPath(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (knobOf(path) || v === null || typeof v !== "object" || Array.isArray(v)) out[path] = v;
    else Object.assign(out, flatten(v, path));
  }
  return out;
}

/**
 * Dotted paths → nested document. A path through a prototype's door (`PROTO_KEYS`) is passed by, and a path walks the
 * document's own keys alone: never into Object.prototype, which every object reads. @param {Record<string, any>} flat
 */
export function unflatten(flat) {
  /** @type {any} */
  const out = {};
  for (const [path, v] of Object.entries(flat)) {
    if (protoPath(path)) continue;
    const parts = path.split(".");
    let node = out;
    for (const p of parts.slice(0, -1)) node = Object.hasOwn(node, p) && node[p] != null ? node[p] : (node[p] = {});
    node[parts[parts.length - 1]] = v;
  }
  return out;
}

// `review` (HarnessV4_Space_Plan SG-D13): asks with a second look first — the Reviewer's five lines — in every mode.
export const RULE_VERDICTS = Object.freeze(["allow", "ask", "deny", "review"]);
export const HOOK_EVENTS = Object.freeze(["pre-tool", "post-tool", "turn-end", "session-start", "prompt-submit", "pre-compact", "subagent-end"]);
// A hand's name or an mcp__server__tool (which keeps its server's case and may carry dashes), or `*`.
const TOOL_NAME_RE = /^(\*|[a-z][a-z0-9_-]{0,63})$/i;

/** What is wrong with one `loop.rules` entry, in words, or null. @param {any} r */
export function ruleProblem(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "must be { tool, pattern, verdict }";
  if (typeof r.tool !== "string" || !TOOL_NAME_RE.test(r.tool)) return "needs a tool name (a hand, an mcp__server__tool, or *)";
  if (typeof r.pattern !== "string" || !r.pattern.trim()) return "needs a pattern (a glob over the call's subject)";
  if (!RULE_VERDICTS.includes(r.verdict)) return `needs a verdict: ${RULE_VERDICTS.join(", ")}`;
  return null;
}

/** What is wrong with one `hooks` entry, in words, or null. @param {any} h */
export function hookProblem(h) {
  if (!h || typeof h !== "object" || Array.isArray(h)) return "must be { on, tool?, command, timeoutMs? }";
  if (!HOOK_EVENTS.includes(h.on)) return `needs on: ${HOOK_EVENTS.join(", ")}`;
  if (typeof h.command !== "string" || !h.command.trim()) return "needs a command";
  if (h.tool != null && (typeof h.tool !== "string" || !TOOL_NAME_RE.test(h.tool))) return "tool must be a tool name or *";
  if (h.tool != null && h.on !== "pre-tool" && h.on !== "post-tool") return "tool applies to pre-tool and post-tool hooks only";
  if (h.timeoutMs != null && (!Number.isInteger(h.timeoutMs) || h.timeoutMs < 100 || h.timeoutMs > 600000)) return "timeoutMs must be a whole number from 100 to 600000";
  return null;
}

/** What is wrong with one `plugins.mcp` entry, in words, or null. @param {any} m */
export function mcpServerProblem(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "must be { name, command, args?, env? } or { name, url, headers? }";
  if (typeof m.name !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(m.name)) return "needs a name: a-z, 0-9, -, up to 32 characters";
  // A coding agent is given Filament's own server by this name: two of one name cannot both reach it.
  if (m.name === "filament") return "cannot be named \"filament\": that is Filament's own server's name";
  const stdio = typeof m.command === "string" && m.command.trim();
  const http = typeof m.url === "string" && /^https?:\/\//.test(m.url);
  if (!stdio && !http) return "needs a command (stdio) or an http(s) url (streamable HTTP)";
  if (m.args != null && (!Array.isArray(m.args) || m.args.some((x) => typeof x !== "string"))) return "args must be a list of strings";
  if (m.env != null && (typeof m.env !== "object" || Array.isArray(m.env) || Object.values(m.env).some((v) => typeof v !== "string"))) return "env must be { NAME: value }";
  if (m.headers != null && (typeof m.headers !== "object" || Array.isArray(m.headers) || Object.values(m.headers).some((v) => typeof v !== "string"))) return "headers must be { Name: value }";
  // The account it signs in with (HarnessV4_Space_Plan S4b): a remote server's sign-in only.
  if (m.account != null) {
    if (typeof m.account !== "string" || (m.account.trim() && !ACCOUNT_RE.test(m.account.trim()))) return `account must name an account: letters, digits, space, . _ -, 32 at most ("${MAIN_ACCOUNT}" is the first)`;
    if (!http && m.account.trim()) return "account is for a server reached over HTTP: one on this computer signs in its own way";
  }
  // How its tools reach Filament's own agent (E49): in full with every request, or by name until it needs one.
  if (m.load != null && !LOADS.includes(m.load)) return `load must be ${LOADS.map((l) => `"${l}"`).join(" or ")}: every tool in full with every request, or each by its name until the agent needs it`;
  // What of it this place uses, said to every agent beside its tools (the owner's word of 10-26).
  if (m.note != null && (typeof m.note !== "string" || m.note.length > NOTE_MAX)) return `note must be words, ${NOTE_MAX} characters at most: what of this server the place uses`;
  return null;
}

/**
 * What is wrong with one entry of a layer's `plugins.mcp` list, in words, or null (HarnessV4_Settings_Plan HS-D7): a
 * server (`mcpServerProblem`), which may say `enabled: false` to be kept off, a switch `{ name, enabled }` that turns a
 * broader layer's server of that name on or off here, or a pick `{ name, account }` that picks the account it signs in
 * with here (HarnessV4_Space_Plan S4b) — or `{ name, load }`, how its tools reach Filament's own agent here (E49), or
 * `{ name, note }`, what of it the place uses.
 * @param {any} m
 */
export function mcpEntryProblem(m) {
  if (isSwitch(m)) return mcpServerProblem({ name: m.name, command: "switch" });
  if (isPick(m)) return mcpServerProblem({ name: m.name, url: "https://pick", account: m.account, load: m.load, note: m.note });
  if (m && typeof m === "object" && m.enabled != null && typeof m.enabled !== "boolean") return "enabled must be true or false";
  return mcpServerProblem(m);
}

/**
 * Check one value against its knob's type and bounds. Returns the problem in words, or null.
 * @param {string} path @param {any} v
 */
export function problemWith(path, v) {
  const k = knobOf(path);
  if (!k) return `unknown setting "${path}"`;
  if (v === null) return k.nullable || k.default === null ? null : `"${path}" cannot be null`;
  switch (k.type) {
    case "string": return typeof v === "string" ? null : `"${path}" must be a string`;
    case "bool": return typeof v === "boolean" ? null : `"${path}" must be true or false`;
    case "int":
      if (!Number.isInteger(v)) return `"${path}" must be a whole number`;
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return `"${path}" must be a number`;
      break;
    case "enum": return k.options?.includes(v) ? null : `"${path}" must be one of ${k.options?.join(", ")}`;
    case "list": return Array.isArray(v) ? null : `"${path}" must be a list`;
    case "json": return v && typeof v === "object" ? null : `"${path}" must be an object`;
  }
  if (k.min != null && v < k.min) return `"${path}" must be at least ${k.min}`;
  if (k.max != null && v > k.max) return `"${path}" must be at most ${k.max}`;
  return null;
}

/** What a layer may hold (D1): session accepts everything; project holds repo facts only; the global layer carries
 * repo and mode, never a session's own. `only: "repo-or-mode"` says exactly that pair.
 * @type {Record<"project" | "global", { only: KnobScope | "repo-or-mode", place: string }>} */
const AT_ALLOWS = Object.freeze({
  project: { only: "repo", place: "the project layer holds repo facts only" },
  global: { only: "repo-or-mode", place: "your global settings never carry a single session's own state" },
});

/** Whether a layer may hold a knob (D1, `AT_ALLOWS`); the session's own layer holds every knob. @param {string} path @param {"session" | "project" | "global"} [at] */
const layerHolds = (path, at) => {
  const rule = at && at !== "session" ? AT_ALLOWS[at] : null;
  const scope = scopeOf(path);
  return !rule || scope === rule.only || (rule.only === "repo-or-mode" && scope !== "session");
};

/**
 * Every problem one value has for its knob, in words; none when the knob takes it. The type and bounds first
 * (`problemWith`), then the entries of a list or an object, one by one: the rules, the hooks, the MCP servers, the
 * lists of names and patterns. The one check a write (`validateLayer`) and a read of a stored layer (`readLayer`) both
 * make.
 * @param {string} path @param {any} v
 * @returns {string[]}
 */
export function valueProblems(path, v) {
  const first = problemWith(path, v);
  if (first) return [first];
  /** @type {string[]} */
  const errors = [];
  if (path === "loop.rules" && Array.isArray(v))
    for (const [i, r] of v.entries()) {
      const p = ruleProblem(r);
      if (p) errors.push(`"loop.rules[${i}]" ${p}`);
    }
  if (path === "subagents.pool" && Array.isArray(v)) {
    const p = poolProblem(v);
    if (p) errors.push(`"${path}" ${p}`);
  }
  if ((path === "subagents.byCard" || path === "subagents.byTeam") && v != null) {
    const p = path === "subagents.byCard" ? byCardProblem(v) : byTeamProblem(v);
    if (p) errors.push(`"${path}" ${p}`);
  }
  if (path === "hooks" && Array.isArray(v))
    for (const [i, hk] of v.entries()) {
      const p = hookProblem(hk);
      if (p) errors.push(`"hooks[${i}]" ${p}`);
    }
  if (path === "plugins.mcp" && Array.isArray(v)) {
    for (const [i, m] of v.entries()) {
      const p = mcpEntryProblem(m);
      if (p) errors.push(`"plugins.mcp[${i}]" ${p}`);
    }
    // One layer says one thing of a name: a second entry of it would leave which one counts to the list's order.
    const names = v.map((m) => m?.name).filter((n) => typeof n === "string");
    for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errors.push(`"plugins.mcp" names the server ${n} twice`);
  }
  if (path === PLUGINS_ON && Array.isArray(v)) {
    for (const [i, e] of v.entries()) {
      const p = pluginOnProblem(e);
      if (p) errors.push(`"${PLUGINS_ON}[${i}]" ${p}`);
    }
    const ids = v.map((e) => e?.id).filter((n) => typeof n === "string");
    for (const n of new Set(ids.filter((n, i) => ids.indexOf(n) !== i))) errors.push(`"${PLUGINS_ON}" names the plugin ${n} twice`);
    if (v.length > PLUGINS_ON_MAX) errors.push(`"${PLUGINS_ON}" holds at most ${PLUGINS_ON_MAX} plugins`);
  }
  if (path === SKILLS_ON && Array.isArray(v)) {
    for (const [i, e] of v.entries()) {
      const p = skillOnProblem(e);
      if (p) errors.push(`"${SKILLS_ON}[${i}]" ${p}`);
    }
    const names = v.map((e) => (typeof e?.name === "string" ? e.name.toLowerCase() : null)).filter((n) => n);
    for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errors.push(`"${SKILLS_ON}" names the skill ${n} twice`);
    if (v.length > SKILLS_ON_MAX) errors.push(`"${SKILLS_ON}" holds at most ${SKILLS_ON_MAX} skills`);
  }
  if (path === LSP_KNOB && Array.isArray(v)) {
    for (const [i, e] of v.entries()) {
      const p = lspServerProblem(e);
      if (p) errors.push(`"${LSP_KNOB}[${i}]" ${p}`);
    }
    const names = v.map((e) => e?.name).filter((n) => typeof n === "string");
    for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errors.push(`"${LSP_KNOB}" names the server ${n} twice`);
    if (v.length > LSP_SERVERS_MAX) errors.push(`"${LSP_KNOB}" holds at most ${LSP_SERVERS_MAX} servers`);
  }
  if (["instructions.files", "instructions.userFiles", "privacy.redact", "privacy.bashDeny", "subagents.ask", "subagents.teams", "loop.addedFolders"].includes(path) && Array.isArray(v) && v.some((x) => typeof x !== "string" || !x.trim()))
    errors.push(`"${path}" must be a list of non-empty strings`);
  if (path === "loop.addedFolders" && Array.isArray(v)) {
    for (const [i, f] of v.entries()) if (typeof f === "string" && f.trim() && !isAbsolute(f.trim())) errors.push(`"loop.addedFolders[${i}]" must be a whole path (${f} is relative)`);
    if (v.length > ADDED_FOLDERS_MAX) errors.push(`"loop.addedFolders" holds at most ${ADDED_FOLDERS_MAX} folders`);
  }
  if (path === "worktree.copy" && Array.isArray(v)) {
    for (const [i, p] of v.entries()) {
      const why = typeof p === "string" ? copyPathProblem(p) : "a path is needed";
      if (why) errors.push(`"worktree.copy[${i}]" ${why}`);
    }
    if (v.length > COPY_MAX) errors.push(`"worktree.copy" holds at most ${COPY_MAX} paths`);
  }
  if (path === "privacy.redact" && Array.isArray(v))
    for (const [i, re] of v.entries()) {
      let compiled = null;
      try { compiled = new RegExp(String(re)); } catch { errors.push(`"privacy.redact[${i}]" is not a regular expression`); }
      // A pattern that matches nothing at all matches between every two characters: [redacted] everywhere.
      if (compiled && compiled.test("")) errors.push(`"privacy.redact[${i}]" matches the empty string`);
    }
  return errors;
}

/**
 * Validate a layer document (nested or dotted). Unknown keys are refused by name. With `{ at }` the layer rule is
 * enforced too (D3): the project layer holds repo facts only, the global layer never a session's own — every writer
 * passes its layer through, so the rule lives here alone.
 * @param {any} doc @param {{ at?: "session" | "project" | "global" }} [o]
 * @returns {{ flat: Record<string, any>, errors: string[] }}
 */
export function validateLayer(doc, { at } = {}) {
  const flat = flatten(doc);
  const errors = [];
  const rule = at && at !== "session" ? AT_ALLOWS[at] : null;
  if (rule)
    for (const path of Object.keys(flat)) {
      if (layerHolds(path, at)) continue;
      const scope = scopeOf(path);
      const what =
        scope === "mode"
          ? `"${path}" is a mode setting`
          : scope === "repo"
            ? `"${path}" is a repo fact`
            : `"${path}" belongs to one session`;
      errors.push(`${what}: ${rule.place}`);
    }
  for (const [path, v] of Object.entries(flat)) errors.push(...valueProblems(path, v));
  return { flat, errors };
}

/**
 * A stored layer as Filament reads it (HarnessV3-AtHome AH-C1): knob by knob, checked the way a write is checked. A
 * key that names no knob, a knob the layer may not hold, and a value its knob refuses are all skipped, so the layer
 * below decides. Flat, like `flatten`.
 * @param {any} doc @param {"session" | "project" | "global"} at
 * @returns {Record<string, any>}
 */
export function readLayer(doc, at) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [path, v] of Object.entries(flatten(doc))) if (knobOf(path) && layerHolds(path, at) && !valueProblems(path, v).length) out[path] = v;
  return out;
}

/**
 * The global layer: what the config already says, in the document's vocabulary — the dashboard's rules, mirrored. Only
 * the knobs the config expresses; the rest fall to the schema defaults. An outside client's session resolves over this
 * alone; a session the harness holds takes your defaults over it (`harnessGlobalLayer`).
 * @param {any} cfg
 */
export function globalLayer(cfg) {
  const c = cfg || {};
  const loop = c.agentLoop || {};
  const mem = c.memory || {};
  /** @type {Record<string, any>} */
  const g = {};
  const put = (path, v) => { if (v !== undefined && v !== "" && !(typeof v === "number" && Number.isNaN(v))) g[path] = v; };
  put("loop.permissions", loop.permissions);
  // The global knob is one number: 0 learns nothing (the document says `enabled: false`), otherwise the threshold.
  const approvals = Number(loop.learnedPermissions?.afterApprovals);
  if (Number.isFinite(approvals)) {
    if (approvals <= 0) put("loop.learnedPermissions.enabled", false);
    else put("loop.learnedPermissions.afterApprovals", Math.floor(approvals));
  }
  put("loop.readerModel", loop.readerModel || null);
  put("loop.treeSnapshots", loop.treeSnapshots);
  // No list nor effort for agents of Filament's own (the owner's word of 11-05): a chat's own list, else the main
  // agent's model at its effort.
  // The Session folder is said as the older switch off (the owner's of 11-09: a stored off is carried to it), so a
  // session's own `subagents.worktree` keeps the say it had over it. Auto, the config's default, is no word.
  put("subagents.worktree", loop.subagents?.workspace === "folder" ? false : loop.subagents?.worktree);
  put("subagents.workspace", loop.subagents?.workspace === "auto" || loop.subagents?.workspace === "folder" ? undefined : loop.subagents?.workspace);
  // Nobody asked is the document's own default: only a list that names someone is stated.
  put("subagents.ask", Array.isArray(loop.subagents?.ask) && loop.subagents.ask.length ? loop.subagents.ask.map(String) : undefined);
  // The teams it may start by itself (U13-D9): a list the config says, an empty one too — none — is stated.
  put("subagents.teams", Array.isArray(loop.subagents?.teams) ? loop.subagents.teams.map(String) : undefined);
  // The config's 0 is "no cap", which the document says with its default (null): only a real cap is stated, so the
  // hash moves when a global cap is set, and not before.
  put("loop.resultCapChars", Number(loop.resultCapChars) > 0 ? Math.floor(Number(loop.resultCapChars)) : undefined);
  put("memory.enabled", mem.enabled);
  put("memory.tools", mem.autopilot?.tools);
  put("memory.turnTokens", mem.autopilot?.turnTokens);
  put("memory.minScore", mem.autopilot?.minScore);
  put("memory.learn", mem.capture?.learn);
  put("memory.index", mem.privacy?.searchIndex);
  put("privacy.learn", mem.capture?.learn);
  put("privacy.index", mem.privacy?.searchIndex);
  return g;
}

/**
 * Your defaults for sessions (`sessions.defaults`, HarnessV4_Tasks U3-8): what Settings › Context wrote, read as every
 * stored layer is — a knob the global layer may hold, with a value it takes; anything else is not read.
 * @param {any} cfg
 * @returns {Record<string, any>}
 */
export function ownDefaults(cfg) {
  const doc = cfg?.sessions?.defaults;
  return doc && typeof doc === "object" && !Array.isArray(doc) ? readLayer(doc, "global") : {};
}

/**
 * The global layer of a session the harness holds — Filament's own loop, a team, a coding agent's chat made here, a
 * draft on the Start board: the config's mirror with your defaults over it (HarnessV4_Tasks U3-8), a choice made in
 * the document's words winning over the dashboard's rule said in its own. Never an outside client's session: what
 * Settings › Context says of the harness's chats does not reshape a client's requests (V4-D105).
 * @param {any} cfg
 */
export function harnessGlobalLayer(cfg) {
  return { ...globalLayer(cfg), ...ownDefaults(cfg) };
}

/**
 * The switches of the hands that reach out of a chat unasked in every mode, Read-only included (the second read of
 * 11-12): the web hands — a page fetched, a search made, a URL or a query carrying words out of the session — and the
 * browser, whose looking (a page gone to, read, a screenshot) runs unasked in the profile that keeps the person's
 * sign-ins; and the loop's per-tool switches, which switch them off (`loop.tools`: `web_fetch`, `web_search`, `browser`)
 * — an object written replaces one that may hold an off. Each on by default.
 */
const REACHING_KNOBS = Object.freeze(["plugins.web.fetch", "plugins.web.search", "plugins.browser", "loop.tools"]);
/** The knobs that say what a chat's calls run unasked: its mode, its rules, the commands refused, the second look, the folders it works in beside its own, the hands that reach out unasked (`REACHING_KNOBS`). */
const ASKING_KNOBS = Object.freeze(["loop.permissions", "loop.rules", "privacy.bashDeny", "loop.secondLook", FOLDERS_KNOB, ...REACHING_KNOBS]);
/**
 * A value of one of them that asks more whatever it was: a mode that runs nothing but reads unasked, the second look on,
 * a hand that reaches out switched off — of the loop's switches, all three of them. @param {string} k @param {unknown} v
 */
const asksMore = (k, v) =>
  (k === "loop.permissions" && (v === "read-only" || v === "ask")) ||
  (k === "loop.secondLook" && v === true) ||
  (k.startsWith("plugins.") && v === false) ||
  (k === "loop.tools" && !!v && typeof v === "object" && ["web_fetch", "web_search", "browser"].every((t) => /** @type {any} */ (v)[t] === false));

/**
 * Whether a model's name names the mode its coding agent runs in (`claude-code/sonnet@bypassPermissions`, acp-turn.js),
 * which may be one that never asks. Weighed as the name is kept: the sessions service keeps `String(model)` of what a
 * new chat is sent (sessions/service.js `draftOf`), so a list is the names it holds, each weighed (the second read of
 * 11-12: `["…@bypassPermissions"]` was no string and so no press, and its chat ran in that mode). @param {unknown} name
 */
export const namesMode = (name) => name != null && String(name).includes("@");

/**
 * The routes that give the names they catch a coding agent's mode (the second read of 11-12: a route that sent the
 * plain name `quiet` on as `sonnet@bypassPermissions` ran every chat on `quiet` in that mode, and no weigher of names
 * saw one in it): each route switched on whose upstream model, or a backup's, names one (`namesMode`, off the template,
 * as a turn reads it off the name the template renders — acp-turn.js) where it goes to a coding agent, found as a turn
 * finds it (routing.js `findUpstream`). A provider's own model id may hold an `@` (Vertex's `claude-sonnet@20250514`):
 * no agent reads a mode there. `ahead`: the routes switched on before it, by what they catch — a name goes to the first
 * route that catches it (`findRoute`), so one of those gone leaves its names to this one.
 * @param {any} cfg @returns {{ route: string, ahead: string[] }[]}
 */
const modeRoutes = (cfg) => {
  const agent = (/** @type {unknown} */ id) => isAgentUpstream((Array.isArray(cfg?.upstreams) ? cfg.upstreams : []).find((/** @type {any} */ u) => u?.id === id));
  const on = (Array.isArray(cfg?.routes) ? cfg.routes : []).filter((/** @type {any} */ r) => r && r.enabled !== false);
  return on.flatMap((/** @type {any} */ r, /** @type {number} */ i) => {
    const goes = [[r.upstream, r.upstreamModel], ...(Array.isArray(r.fallbacks) ? r.fallbacks : []).map((/** @type {any} */ f) => [f?.upstream, f?.upstreamModel ?? r.upstreamModel])];
    return goes.some(([id, model]) => namesMode(model) && agent(id)) ? [{ route: JSON.stringify([r.match, goes]), ahead: on.slice(0, i).map((/** @type {any} */ x) => String(x.match)) }] : [];
  });
};

/**
 * The knobs that name what Filament starts by itself, as the person (r-doors, 11-12: a program on this computer wrote
 * a chat a hook, and its command ran at every tool call) — a command at a tool call or a turn's end, an MCP server, a
 * plugin's servers and hooks, a language server —, each with whether a value written for it may start one: a hook, or
 * a command named; a server's command or url, or one switched on (mcp-servers.js `startsServer`); a plugin on, or its
 * hooks; a language server's command, or one switched on. A list emptied, an entry that only switches off and a pick
 * start nothing; a value that is no list is read as one that may.
 * @type {Readonly<Record<string, (v: any) => boolean>>}
 */
const STARTING_KNOBS = Object.freeze({
  hooks: (v) => !Array.isArray(v) || v.length > 0,
  "loop.verify.afterEdits": (v) => v !== "",
  [MCP_KNOB]: (v) => !Array.isArray(v) || v.some(startsServer),
  [PLUGINS_ON]: (v) => !Array.isArray(v) || v.some((e) => !(e && e.enabled === false && e.hooks !== true)),
  [LSP_KNOB]: (v) => !Array.isArray(v) || v.some((e) => !(e && e.command == null && e.enabled === false)),
});
/**
 * Whether one of them, as written, starts what it did not before (`was`: its value until now, where the caller holds
 * it): of a list, the entries that are new or changed alone — one taken out starts nothing, nor one that stands as it
 * did but for its switch, off now —; with nothing to compare with, the value whole, since a list written replaces the
 * layer's. A knob taken back names nothing.
 * @param {string} k @param {unknown} now @param {unknown} [was]
 */
const startsMore = (k, now, was) => {
  if (now == null) return false;
  if (!Array.isArray(was) || !Array.isArray(now)) return STARTING_KNOBS[k](now);
  /** An entry without its switch. @param {any} e */
  const bare = (e) => JSON.stringify(e && typeof e === "object" && !Array.isArray(e) ? { ...e, enabled: undefined } : e);
  return STARTING_KNOBS[k](now.filter((e) => !was.some((w) => bare(w) === bare(e) && (e?.enabled === false || JSON.stringify(w) === JSON.stringify(e)))));
};

/**
 * The knobs that say whom a chat's main agent may start by itself (r-doors, 11-12): the saved agents it may ask, the
 * teams it may send. A name on one lets the agent start what the person alone started until then — a saved agent runs
 * the commands its card names unasked, a team that builds changes files.
 */
const WHOM_KNOBS = Object.freeze(["subagents.ask", "subagents.teams"]);
/**
 * The chat's own Parallelize tasks (the owner's of 11-16): on, its agent starts sub-agents that change files with no card
 * asking the person first. Switched on, or to anything but off, it lets the agent do more unasked; taken back or
 * switched off it asks again.
 */
export const PARALLEL_KNOB = "subagents.parallelize";
/** A list's names as they are compared: trimmed, an agent's `@` off, in lower case. @param {unknown} v @returns {string[]} */
const namesIn = (v) => (Array.isArray(v) ? v.map((n) => String(n ?? "").trim().replace(/^@/, "").toLowerCase()).filter(Boolean) : []);
/**
 * Whether a list of whom the main agent may start by itself names one the list before it did not (`was`: none where the
 * caller holds none — a list written replaces its layer's). The same names again, one taken out and a list emptied
 * name nobody new; a value that is no list is read as one that may; a knob taken back names nothing.
 * @param {unknown} now @param {unknown} [was]
 */
export const namesMore = (now, was) => {
  if (now == null) return false;
  if (!Array.isArray(now)) return true;
  const before = namesIn(was);
  return namesIn(now).some((n) => !before.includes(n));
};

/**
 * Whether a write of a settings layer may let the agent do more unasked (the press key's, http/admin/index.js and the
 * chat's `/set`): a mode other than Read-only or Ask, or one taken back to the layer below; the rules, the commands
 * refused, the second look or the added folders written or taken back — a list written replaces one that may hold a
 * deny or an ask; a hand that reaches out unasked in every mode — the web hands, the browser, the loop's switches for
 * them — written other than off, or taken back (`REACHING_KNOBS`); a model named with its coding agent's mode
 * (`namesMode`); what Filament starts by itself, named or switched on (`STARTING_KNOBS`) — one of those taken back or
 * switched off is none; or whom the main agent may start by itself, named (`WHOM_KNOBS`) — a list emptied or taken
 * back names nobody; or the chat's own Parallelize tasks switched on, or taken back (`PARALLEL_KNOB`) — taken back, Settings
 * › Experimental's switch says it, which may be on where the chat's said off (the review of fe6b8d579); off asks again.
 * @param {{ patch?: any, unset?: any } | null} change
 */
export function asksLess(change) {
  const set = flatten(change?.patch);
  if (namesMode(set["model.name"]) || Object.keys(STARTING_KNOBS).some((k) => startsMore(k, set[k])) || WHOM_KNOBS.some((k) => namesMore(set[k]))) return true;
  if (set[PARALLEL_KNOB] != null && set[PARALLEL_KNOB] !== false) return true;
  const gone = [...(Array.isArray(change?.unset) ? change.unset.map(String) : []), ...Object.keys(set).filter((p) => set[p] === null)];
  const under = (/** @type {string} */ p, /** @type {string} */ k) => p === k || k.startsWith(`${p}.`);
  if (gone.some((p) => under(p, PARALLEL_KNOB))) return true;
  return ASKING_KNOBS.some(
    (k) => gone.some((p) => under(p, k)) || Object.keys(set).some((p) => (p === k ? !asksMore(k, set[p]) : under(k, p) || under(p, k))),
  );
}

/**
 * A config's coding agents by id, each the entry a turn finds for it: the first of its id, the id compared as it is
 * (routing.js `findUpstream`). A later entry of the same id, or one whose id only reads like it (`["claude-code"]`),
 * stands in for none (the second read of 11-12: keyed by `String(u.id)`, such an entry holding the old values hid the
 * first one's changed program and mode from the weigher) — the config's own check refuses both (store.js
 * `validateConfig`), and this reads right whatever it is handed. @param {any} cfg @returns {[unknown, any][]}
 */
const agentsOf = (cfg) => {
  /** @type {Map<unknown, any>} */
  const first = new Map();
  for (const u of Array.isArray(cfg?.upstreams) ? cfg.upstreams : []) if (u && !first.has(u.id)) first.set(u.id, u);
  return [...first].filter(([, u]) => u.acp);
};

/** A coding agent's own mode as the config sets it, by upstream (`agentsOf`): its mode, the names that mean it, its policy. @param {any} cfg */
const agentModes = (cfg) => new Map(agentsOf(cfg).map(([id, u]) => [id, JSON.stringify([u.acp.mode, u.acp.modeAliases, u.acp.permissions])]));

/**
 * A coding agent's program as the config names it, by upstream (r-doors, 11-12; `agentsOf`): what Filament starts for
 * its turns — the executable and its arguments, those that list its models, its environment and its home, the MCP
 * servers it is told to start. @param {any} cfg
 */
const agentPrograms = (cfg) =>
  new Map(agentsOf(cfg).map(([id, u]) => [id, JSON.stringify([u.acp.command, u.acp.args, u.acp.listModelsArgs, u.acp.env, u.acp.envRemove, u.acp.home, u.acp.mcpServers])]));

/** The folders agents may work under as the config lists them (`agentLoop.roots`). @param {any} cfg @returns {string[]} */
const rootsOf = (cfg) => (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
/** The variables commands are given whatever their names read like, as the config lists them (`agentLoop.envPass`). @param {any} cfg @returns {string[]} */
const passedOf = (cfg) => (Array.isArray(cfg?.agentLoop?.envPass) ? cfg.agentLoop.envPass : []).map(String).filter(Boolean);
/**
 * Whether a configuration sends a credential the one before it held to an address that one did not send it to (s-rows,
 * 11-12: a provider's address moved while its key was kept, and the key went there with its next request) — each
 * upstream's key, sign-in and credential headers with the addresses they go to (config/secrets.js `keysSentTo`). One
 * typed anew goes where its writer says, and one that stays where it was, or is taken away, moves nowhere.
 * @param {any} was @param {any} now
 */
const keysMove = (was, now) => {
  const before = keysSentTo(was);
  return [...keysSentTo(now)].some(([key, to]) => before.has(key) && [...to].some((a) => !before.get(key)?.has(a)));
};

/**
 * Filament's doors beyond this computer as the config opens them (r-doors, 11-12): the host it listens on where that
 * is none of this machine's own (`loopbackHost`), the network's listener, the tailnet's share, and a machine signed in
 * to the tailnet as this one let in unpaired. And what guards them (the second read of 11-12): the model endpoints
 * asking for no inbound key (`keyless`: `server.requireAuth` as the key's check reads it — guards.js
 * `checkInboundAuth`, any value that does not hold is off; a config that says nothing asks for one), and the host
 * names beside this machine's own a browser may reach Filament under (`names`: `server.allowedHosts`, guards.js
 * `hostAllowed` — a page under one, its name pointed at this computer, calls the admin API as this computer does).
 * @param {any} cfg
 */
const doorsOf = (cfg) => {
  const s = cfg?.server || {};
  const host = String(s.host ?? "127.0.0.1").trim().toLowerCase();
  const names = (Array.isArray(s.allowedHosts) ? s.allowedHosts : []).map((/** @type {unknown} */ n) => String(n).toLowerCase());
  return { beyond: !loopbackHost(host), host, lan: s.lan?.enabled === true, tailnet: s.tailscale?.serve === true, login: s.tailscale?.trustOwnLogin === true, keyless: s.requireAuth !== undefined && !s.requireAuth, names };
};
/**
 * Whether the web hands reach this computer's own and the network's private addresses (`agentLoop.web.allowPrivate`,
 * as turn.js reads it): they run unasked in every mode, a read, and with it on they read a service that answers this
 * computer alone — Filament's own admin API among them (adapters/tools/web-hands.js). @param {any} cfg
 */
const reachesPrivate = (cfg) => cfg?.agentLoop?.web?.allowPrivate === true;
/**
 * Whether Parallelize tasks is on (`experimental.parallelizeTasks`, as the agent's prompt, the tasks answers and a /plan
 * read it): the person's consent, its own words say, that a main agent starts its task graph's tasks that can run at
 * once on sub-agents by itself, and a /plan's that wait on none once the plan is approved, with no card asking first
 * (the second read of 11-12: a program switched it on with no key). Its sub-agents ask as their chat does. @param {any} cfg
 */
const parallelOn = (cfg) => cfg?.experimental?.parallelizeTasks === true;

/**
 * Whether a configuration lets the agent do more unasked than the one before it (`asksLess`): the mode it says for
 * every chat, or your defaults' mode, rules, commands refused, second look, folders, hands that reach out unasked
 * (`REACHING_KNOBS`) or model, changed to anything that does not ask more; a coding agent's own mode, the names that
 * mean it or its policy, changed or new (`agentModes`); a folder added to those agents may work under
 * (`agentLoop.roots`), or the list emptied — no folder listed is any folder (turn.js `folderVerdict`). A folder taken
 * out of a list that still names one is no press. A variable named to be passed to commands (`agentLoop.envPass`;
 * r-hands, 11-12): one named there reaches every command whatever its name or value says (hands.js `safeEnv`), so a
 * caller that could name a key's variable would read the key with its next command. One taken out is no press.
 * Or sends a key it keeps where the one before it did not (`keysMove`; s-rows, 11-12): an upstream's address moved to
 * another host while its key, its sign-in or a header's credential stays. One typed anew with the address is no press.
 * Or starts, or lets in, what the one before it did not (r-doors, 11-12): a coding agent's program, changed or new
 * (`agentPrograms`: a save pointed one at any program, started at its next turn); what your defaults start by
 * themselves, named or switched on (`STARTING_KNOBS`); a door opened beyond this computer, or its host moved to
 * another beyond it (`doorsOf`). One of those taken out, switched off or closed is no press. Or names one more whom a
 * chat's main agent may start by itself (`WHOM_KNOBS`, `namesMore`): a saved agent to ask, a team to send — your
 * defaults' list weighed against what held for a new chat until now, the config's own list under it.
 * Or names a mode, or opens a door, in a way the above did not read (the second read of 11-12): a route that gives the
 * names it catches a coding agent's mode, new, changed or left the names of one that stood ahead of it (`modeRoutes`);
 * the model endpoints asking for no key, a host name added to those a browser may reach Filament under (`doorsOf`);
 * the web hands let reach this computer's own addresses (`reachesPrivate`). A route that names no mode, the key asked
 * for again, a name taken out and that reach switched off are no press. Or gives the person's consent to more agents
 * started unasked (`parallelOn`): Parallelize tasks switched on. Off is no press.
 * @param {any} was @param {any} now
 */
export function configAsksLess(was, now) {
  const [before, after] = [agentModes(was), agentModes(now)];
  if ([...after].some(([id, m]) => before.get(id) !== m)) return true;
  const routed = modeRoutes(was);
  if (modeRoutes(now).some((r) => !routed.some((w) => w.route === r.route && w.ahead.every((m) => r.ahead.includes(m))))) return true;
  const [ran, runs] = [agentPrograms(was), agentPrograms(now)];
  if ([...runs].some(([id, p]) => ran.get(id) !== p)) return true;
  const [shut, open] = [doorsOf(was), doorsOf(now)];
  if ((open.beyond && (!shut.beyond || open.host !== shut.host)) || (open.lan && !shut.lan) || (open.tailnet && !shut.tailnet) || (open.login && !shut.login)) return true;
  if ((open.keyless && !shut.keyless) || open.names.some((n) => !shut.names.includes(n))) return true;
  if (reachesPrivate(now) && !reachesPrivate(was)) return true;
  if (parallelOn(now) && !parallelOn(was)) return true;
  const [roots, listed] = [rootsOf(was), rootsOf(now)];
  if (listed.some((r) => !roots.includes(r)) || (roots.length > 0 && !listed.length)) return true;
  const passed = passedOf(was);
  if (passedOf(now).some((n) => !passed.includes(n))) return true;
  if (keysMove(was, now)) return true;
  return [globalLayer, ownDefaults].some((layer) => {
    const [a, b] = [layer(was), layer(now)];
    const named = namesMode(b["model.name"]) && a["model.name"] !== b["model.name"];
    const starts = Object.keys(STARTING_KNOBS).some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && startsMore(k, b[k], a[k]));
    // Where the layer named none before, what stood under it did: under your defaults the config's own list
    // (`harnessGlobalLayer` — the second read of 11-12: BugHunters named there over a list the person had emptied was
    // weighed against the knob's default, and so was nobody new), else the knob's default — BugHunters named again
    // over that is nobody new.
    const under = layer === ownDefaults ? globalLayer(was) : {};
    const whom = WHOM_KNOBS.some((k) => namesMore(b[k], a[k] ?? under[k] ?? KNOBS[k].default));
    return named || starts || whom || ASKING_KNOBS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && !asksMore(k, b[k]));
  });
}

/**
 * Whether the session's own layer or its project's set this knob: a choice, as opposed to the global layer (the
 * config's mirror) or the registry's default.
 * @param {Resolved | null} resolved @param {string} path
 */
const chosen = (resolved, path) => resolved?.sources?.[path] === "session" || resolved?.sources?.[path] === "project";

/**
 * The document an outside client's request runs under (HarnessV3 Step 1): only the knobs its session, or the
 * session's project, chose — nested like the document — or null when there are none. The global mirror and the
 * registry's defaults are left out on purpose. Every consumer treats an absent knob as "the config decides", which
 * is how such a request behaved before it had a document, so a choice changes that one knob and nothing beside it:
 * a sub-agents ceiling leaves their memory as it was. A native turn does
 * not come through here; its document is the session's own, whole.
 * @param {Resolved | null} resolved
 */
export function chosenDocument(resolved) {
  /** @type {Record<string, any>} */
  const flat = {};
  for (const path of Object.keys(resolved?.sources || {})) if (chosen(resolved, path)) flat[path] = resolved?.flat?.[path];
  return Object.keys(flat).length ? unflatten(flat) : null;
}

/**
 * The document a request of a session runs under, from the session's resolution: a composed request (the harness's
 * turn, a loop tick riding it) runs under the whole document — the composer and the loop were built on it; any other
 * request runs under the knobs its session or project chose (`chosenDocument`). Situate applies it once per request;
 * the agent loop reads it again at each call for the permission mode in force (HarnessV3-AtHome AH-F1).
 * @param {Resolved | null} resolved @param {boolean} composed
 */
export const requestDocument = (resolved, composed) => (resolved ? (composed ? resolved.effective : chosenDocument(resolved)) || null : null);

/**
 * The members of the team that answers a session (HarnessV4_Tasks E15 step 6) — each a worker card by its tag, with the
 * team's words for it — or null where none does: the agent's own session, or an engine that names no team there is.
 * @param {any} doc
 * @param {{ find: (text: unknown) => { members: readonly import("../core/roster.js").Member[] } | null } | null} [teams]
 * @returns {readonly import("../core/roster.js").Member[] | null}
 */
export const teamMembersOf = (doc, teams = null) => {
  const engine = sessionEngineOf(doc);
  return (engine.mode === "team" && teams?.find(engine.team)?.members) || null;
};

/**
 * Who plans a session's task graph (HarnessV3-TaskGraph G3-1): a team's lead while a team answers the session — the
 * graph then reads that team's members, whom its tasks name — else the agent. The graph's words, its tasks' fields
 * and its actions follow.
 * @param {any} doc @param {Parameters<typeof teamMembersOf>[1]} [teams]
 * @returns {import("../core/task-graph.js").Crew}
 */
export const graphCrew = (doc, teams = null) => teamMembersOf(doc, teams) || "agent";

/**
 * Which engine answers a session (HarnessV3 §11, Step 5 D1): the document's `engine` section read once — the engine
 * stage and the settings answer ask here, as most of the server does; memory (`leaderOf`, a team's chat's guard) and
 * the harness page read the fields they need from the section itself. Anything but a known mode is `model`;
 * `team` is the team's key or name as written (app/engine.js finds it), or null. `agentOff`: the session switched the
 * agent tool off (`loop.tools.agent`), which a team's lead launches its workers with (HarnessV3-AtHome P2).
 * @param {any} doc  the document a request runs under (whole or chosen), or null
 * @returns {{ mode: "model" | "team", team: string | null, agentOff: boolean }}
 */
export function sessionEngineOf(doc) {
  const e = doc?.engine || {};
  const team = typeof e.team === "string" && e.team.trim() ? e.team.trim() : null;
  return { mode: ENGINE_MODES.includes(e.mode) ? e.mode : "model", team, agentOff: doc?.loop?.tools?.agent === false };
}

/**
 * Whether a session's lead reads along with its workers — a team's, or the agent with its graph's sub-agents
 * (HarnessV3-TaskGraph-v2 §12, TG2-D21, TG2-D20): `engine.supervise`, on
 * unless the session switched it off.
 * @param {any} doc
 */
export const readsAlong = (doc) => doc?.engine?.supervise !== false;
/**
 * The model a Brief picked for the leading team's workers in a session (U13-D8): `engine.teamWorkers`, as a person names
 * it, else null — the team's own models, then its members' cards, then the chat's list.
 * @param {any} doc @returns {string | null}
 */
export const teamWorkersOf = (doc) => (typeof doc?.engine?.teamWorkers === "string" && doc.engine.teamWorkers.trim() ? doc.engine.teamWorkers.trim() : null);
/**
 * How hard a Brief asked the leading team's workers to think in a session: `engine.teamEffort`, one of SUBAGENT_EFFORTS,
 * else null — the main agent's (`mainEffortOf`).
 * @param {any} doc @returns {string | null}
 */
export const teamEffortOf = (doc) => (SUBAGENT_EFFORTS.includes(String(doc?.engine?.teamEffort)) ? String(doc.engine.teamEffort) : null);
/**
 * The effort an agent runs at where nothing names one (the owner's word of 11-05): the main agent's, `model.effort`,
 * else `model` — its model's own default.
 * @param {any} doc @returns {string}
 */
export const mainEffortOf = (doc) => (SUBAGENT_EFFORTS.includes(String(doc?.model?.effort)) ? String(doc.model.effort) : "model");
/**
 * The teams a session's main agent may start on the side by itself (U13-D9): `subagents.teams`, BugHunters where the
 * document names none. `known`, where given, reads each name as a team's key, null for one that is
 * no team: those are dropped, and a list none of whose names is a team any more is the default again, as an old saved
 * setting is (the owner's rule of 10-31) — an empty list stays none.
 * @param {any} doc @param {((name: string) => string | null) | null} [known] @returns {string[]}
 */
export const agentTeamsOf = (doc, known = null) => {
  if (!Array.isArray(doc?.subagents?.teams)) return [...AGENT_TEAMS];
  const named = doc.subagents.teams.map((/** @type {unknown} */ k) => String(k).trim()).filter(Boolean);
  if (!known) return named;
  const kept = named.map(known).filter((/** @type {string | null} */ k) => typeof k === "string");
  return named.length && !kept.length ? [...AGENT_TEAMS] : kept;
};
/**
 * The pace of a lead's looks (TG2-D15): `engine.lookSeconds`, five minutes where the document names none (TG2-D48); 0 is
 * every round.
 * @param {any} doc
 */
export const lookSecondsOf = (doc) => {
  const n = doc?.engine?.lookSeconds;
  return n != null && Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : LOOK_SECONDS;
};

/**
 * The slice pass's configuration (`rules.trim`, Rules → trim): how a compaction summary too big for one call of its
 * writer is read in sequential slices. Global: no session sets it.
 * @param {any} cfg
 */
export const sliceConfigOf = (cfg) => ({ ...TRIM_DEFAULTS, ...(cfg?.rules?.trim || {}) });

/**
 * @typedef {{ effective: any, flat: Record<string, any>, sources: Record<string, "session" | "project" | "global" | "default">,
 *   live: Record<string, boolean>, hash: string, layers: { session: any, project: any, global: any },
 *   derived?: { path: string, value: any, why: string, note?: string }[], loop?: boolean }} Resolved  `loop`:
 *   the chain's turns run on Filament's own loop (`resolveChainSettings`), the fact its derivations read
 *
 * @typedef {{ path: string, value: any, why: string, note?: string }} DerivedKnob
 */

/**
 * What a Space of your own passes to the projects it shows (the owner's word of 10-26: "for my work i need linear,
 * slack and stuff like that"): its connectors, its plugins and its skills. Its other settings stay its own chats'.
 */
export const SPACE_KNOBS = Object.freeze([MCP_KNOB, PLUGINS_ON, SKILLS_ON]);

/**
 * The settings layer of the Space of your own that shows a project, for what it passes down (`SPACE_KNOBS`); `{}`
 * where none shows it. The archive relays the Spaces' answer (services/memory archive `spaceOf`).
 * @param {{ spaceOf?: (projectId: string) => string | null, projectSettings: (id: string) => any } | null | undefined} archive
 * @param {string | null | undefined} projectId
 */
export function spaceLayerOf(archive, projectId) {
  if (!archive || !projectId) return {};
  const space = archive.spaceOf?.(String(projectId)) || null;
  return space && space !== projectId ? archive.projectSettings(space) || {} : {};
}

/**
 * Resolve the layers into the effective document, with provenance per knob and the document's hash. Layers may be
 * nested or dotted. Each is read as a stored layer is (`readLayer`): the project layer gives its repo facts only, and a
 * value its knob refuses is skipped, so the layer below decides. `space`: the Space of your own that shows the
 * project (`spaceLayerOf`), between your defaults and the project's, read for its connectors and plugins only; what it
 * names counts as the project's in `sources`.
 * @param {{ global?: any, space?: any, project?: any, session?: any }} layers @returns {Resolved}
 */
export function resolveSettings({ global = {}, space = {}, project = {}, session = {} } = {}) {
  const g = readLayer(global, "global"), p = readLayer(project, "project"), s = readLayer(session, "session");
  const all = readLayer(space, "project");
  /** @type {Record<string, any>} */
  const sp = Object.fromEntries(SPACE_KNOBS.filter((k) => Object.hasOwn(all, k)).map((k) => [k, all[k]]));
  /** @type {Record<string, any>} */
  const flat = {};
  /** @type {Resolved["sources"]} */
  const sources = {};
  /** @type {Record<string, boolean>} */
  const live = {};
  for (const [path, k] of Object.entries(KNOBS)) {
    if (Object.hasOwn(s, path)) { flat[path] = s[path]; sources[path] = "session"; }
    else if (Object.hasOwn(p, path)) { flat[path] = p[path]; sources[path] = "project"; }
    else if (Object.hasOwn(sp, path)) { flat[path] = sp[path]; sources[path] = "project"; }
    else if (Object.hasOwn(g, path)) { flat[path] = g[path]; sources[path] = "global"; }
    else { flat[path] = k.default; sources[path] = "default"; }
    live[path] = k.phase <= BUILT_PHASE;
  }
  // Your MCP servers add up by name (HarnessV4_Settings_Plan HS-D7): the chat runs the merged list's servers that are
  // on, and the narrowest layer that names any stays its source.
  if (sources[MCP_KNOB] !== "default")
    flat[MCP_KNOB] = serversOn(mergeServers([{ at: "global", list: g[MCP_KNOB] }, { at: "space", list: sp[MCP_KNOB] }, { at: "project", list: p[MCP_KNOB] }, { at: "session", list: s[MCP_KNOB] }]));
  // So do the folders it may also read, by path.
  if (sources[FOLDERS_KNOB] !== "default") flat[FOLDERS_KNOB] = mergeFolders([g[FOLDERS_KNOB], p[FOLDERS_KNOB], s[FOLDERS_KNOB]]);
  // And the plugins on, by id (HarnessV4_SpacesPlugins_Plan B3): what each brings is app/plugins.js's to add.
  if (sources[PLUGINS_ON] !== "default") flat[PLUGINS_ON] = mergePluginsOn([g[PLUGINS_ON], sp[PLUGINS_ON], p[PLUGINS_ON], s[PLUGINS_ON]]);
  // And your skills on, by name (HarnessV4_Skills_Plan S1-6): their files are app/skill-store.js's to add.
  if (sources[SKILLS_ON] !== "default") flat[SKILLS_ON] = mergeSkillsOn([g[SKILLS_ON], sp[SKILLS_ON], p[SKILLS_ON], s[SKILLS_ON]]);
  // And the language servers, by name: the ones Filament knows and the plugins' are adapters/lsp/servers.js's to add.
  if (sources[LSP_KNOB] !== "default") flat[LSP_KNOB] = mergeLspServers([g[LSP_KNOB], p[LSP_KNOB], s[LSP_KNOB]]);
  return { effective: unflatten(flat), flat, sources, live, hash: settingsHash(flat), layers: { session: unflatten(s), project: unflatten(p), global: unflatten(g) } };
}

/**
 * The hash of what the model will be given: the live knobs that shape a request. Display knobs never change the
 * hash (a rename is not a boundary), nor do knobs that shape no turn (`turns: false`) or whose mechanism is not
 * built. The permission mode is included as a behavioral boundary marker even though it shapes no bytes (the prompt
 * and the tools are mode-invariant; the gate enforces the mode at call time). A knob at its default of null counts for
 * nothing: a knob added later moves no chat's hash, where each drew a "Settings changed" row with no change in every
 * chat after the update that brought it (the review of fe6b8d579).
 * @param {Record<string, any>} flat
 */
export function settingsHash(flat) {
  const parts = [];
  for (const path of Object.keys(KNOBS).sort()) {
    if (path.startsWith("display.") || KNOBS[path].turns === false) continue;
    if (KNOBS[path].phase > BUILT_PHASE) continue;
    if (flat[path] == null && KNOBS[path].default === null) continue;
    parts.push(`${path}=${JSON.stringify(flat[path] ?? null)}`);
  }
  return shortHash(parts.join("\n"), 16);
}

/**
 * Apply a patch to a layer: `patch` sets keys (nested or dotted; a value of null sets an explicit null where the knob
 * allows it), `unset` removes keys so the layer inherits again. Returns the new layer and what changed. `{ at }` is
 * the layer being written (validateLayer's rule); every writer passes it, so a layer never receives a knob it may not
 * hold.
 * @param {any} layer @param {{ patch?: any, unset?: string[] }} change @param {{ at?: "session" | "project" | "global" }} [o]
 * @returns {{ layer: any, changes: { path: string, from: any, to: any, live: boolean }[], errors: string[] }}
 */
export function applyPatch(layer, { patch = {}, unset = [] } = {}, { at } = {}) {
  const cur = flatten(layer);
  const { flat: add, errors } = validateLayer(patch, at ? { at } : {});
  for (const u of unset) if (!knobOf(u)) errors.push(`unknown setting "${u}"`);
  // A page sees an MCP server's credentials as the placeholder and sends it back unchanged: the layer's own value
  // stands for it (HarnessV4_Settings_Plan HS-D8). The patch's own key alone (`flatten`'s keys are its own).
  if (Object.hasOwn(add, MCP_KNOB)) {
    const r = restoreList(add[MCP_KNOB], [cur[MCP_KNOB]]);
    add[MCP_KNOB] = r.list;
    errors.push(...r.errors);
  }
  if (errors.length) return { layer: unflatten(cur), changes: [], errors };
  const changes = [];
  for (const [path, to] of Object.entries(add)) {
    if (JSON.stringify(cur[path]) === JSON.stringify(to)) continue;
    changes.push({ path, from: Object.hasOwn(cur, path) ? cur[path] : undefined, to, live: KNOBS[path].phase <= BUILT_PHASE });
    cur[path] = to;
  }
  for (const path of unset) {
    if (!Object.hasOwn(cur, path)) continue;
    changes.push({ path, from: cur[path], to: undefined, live: KNOBS[path].phase <= BUILT_PHASE });
    delete cur[path];
  }
  return { layer: unflatten(cur), changes, errors: [] };
}

/**
 * The dependency derivations (Step 6 §1.4): what the chosen knobs imply, resolved as derived VALUES at use time —
 * a stored layer is never rewritten (the hash stays the hash of what was chosen), and an explicit choice on any
 * layer always wins over the derivation. Each derived knob carries the words the surfaces show beside it.
 * @param {Resolved} resolved a resolveSettings result (the chosen document)
 * @param {{ keepsThinking?: boolean, windowTokens?: number }} facts  `keepsThinking`: the session's model keeps its
 *   thinking blocks in history; `windowTokens`: for the cost note's words.
 * @returns {{ effective: any, flat: Record<string, any>, derived: DerivedKnob[] }}
 */
export function deriveDeps(resolved, { keepsThinking = false, windowTokens = 0 } = {}) {
  const flat = { ...resolved.flat };
  /** @type {DerivedKnob[]} */
  const derived = [];
  // Explicit = a layer named it with a value: an explicit null is "no opinion" (the resolver reads it as unset
  // too), and a missing sources map (a hand-built resolved) reads as nothing chosen.
  const explicit = (/** @type {string} */ path) =>
    resolved?.sources?.[path] != null && resolved.sources[path] !== "default" && resolved.flat?.[path] !== null;
  // keepInHistory: thinking on, on a model that keeps its thinking — the blocks are kept, because stripping them
  // re-writes the whole history to the provider's cache at every turn boundary. Off was the cheaper default only
  // when the provider ignored earlier thinking anyway.
  if (
    Number(flat["model.thinking.budget"]) >= 1024 && keepsThinking &&
    !explicit("model.thinking.keepInHistory") && flat["model.thinking.keepInHistory"] !== true
  ) {
    derived.push({
      path: "model.thinking.keepInHistory",
      value: true,
      why: "thinking is on and this model keeps its thinking — off would strip the blocks and re-write the whole history to the provider's cache every turn",
      note: windowTokens > 0
        ? `at a ${windowTokens.toLocaleString("en-US")}-token window that re-write is ≈${windowTokens.toLocaleString("en-US")} tokens at the cache-write price every turn — about a dollar a turn at Sonnet-class pricing; keeping the blocks costs a few cache reads instead`
        : "the whole history re-enters at the cache-write price every turn; keeping the blocks costs a few cache reads instead",
    });
    flat["model.thinking.keepInHistory"] = true;
  }
  return { effective: unflatten(flat), flat, derived };
}

/**
 * The layers of one chain, resolved: the global config in the document's vocabulary, the connectors and plugins of
 * the Space of your own that shows its project (`spaceLayerOf`), the project's `settings_json`, the chain's own. What the sessions service resolves before a turn, and what the pipeline resolves
 * for a chain-addressed request (a loop's tick on the session's chain) so memory and the loop read the same document.
 * The dependency derivations (Step 6 §1.4) are applied here — the one resolution point every door reads — so the
 * turn, the preview, the loop and the inspector all see the same derived values; the hash and `sources` stay those
 * of the CHOSEN document (a derivation is not a choice, and never moves the hash).
 * Null when the chain does not exist.
 * It reads the chain's head (`chainHead`: its project, its model, whether the harness made it), never the chain whole:
 * a turn resolves its document again at every tool call, and a chain's meta grows with the chat. The layers are read
 * as they are now, each time, and the document is built anew for every caller, which may change its copy.
 * Another machine's agents' chat that runs fenced here (`archive.fenced`: their device holds no Full control, read as it
 * stands) takes memory's recall, tools and briefing off over its own layer: their machine keeps their memory, and a
 * briefing built while Full control was on rides no turn of theirs after it goes off.
 * @param {{ chainHead: (id: string) => { id: string, project_id: string | null, model: string | null, native: boolean } | null, projectSettings: (id: string) => any, chainSettings: (id: string) => any, spaceOf?: (projectId: string) => string | null, fenced?: (id: string) => boolean }} archive
 * @param {any} cfg @param {string} chainId
 */
export function resolveChainSettings(archive, cfg, chainId) {
  const chain = archive.chainHead(String(chainId || ""));
  if (!chain) return null;
  const own = archive.chainSettings(chain.id);
  const session = archive.fenced?.(chain.id) ? { ...own, memory: { ...(own?.memory && typeof own.memory === "object" ? own.memory : {}), enabled: false, tools: false, briefing: false } } : own;
  const resolved = resolveSettings({
    // A session the harness made takes your defaults; an outside client's — one the harness has typed into as well —
    // stays on the dashboard's rules.
    global: chain.native ? harnessGlobalLayer(cfg) : globalLayer(cfg),
    space: spaceLayerOf(archive, chain.project_id),
    project: chain.project_id ? archive.projectSettings(chain.project_id) : {},
    session,
  });
  return derivedFor(resolved, cfg, { model: chain.model });
}

/**
 * A resolved document with its derivations applied for a chat on `model` — a born chain's (`resolveChainSettings`)
 * and the one a client's first request runs under before its chain exists (memory's `unbornDocument`), so the first
 * request and the second never disagree on a derived knob.
 * @param {Resolved} resolved @param {any} cfg
 * @param {{ model?: unknown }} chat
 * @returns {Resolved & { derived: DerivedKnob[] }}
 */
export function derivedFor(resolved, cfg, { model = null } = {}) {
  const name = model ? String(model) : "";
  const facts = {
    keepsThinking: !!name && modelKeepsThinking(cfg, name),
    windowTokens: name ? sessionWindowFor(cfg, name, resolved.effective?.model?.window).tokens || 0 : 0,
  };
  const dep = deriveDeps(resolved, facts);
  return { ...resolved, effective: dep.effective, flat: dep.flat, derived: dep.derived };
}

// ---- values typed in chat (D10) ---------------------------------------------------------------------------------
// One grammar for `/set`, `/unset` and `/settings`, as two pure functions: parse turns what a person typed into a
// value the registry accepts, format is its inverse (what `/settings` shows). The harness editor keeps its own form
// parsing (form widgets, line editors for rules and hooks): a different surface, and the layer rules keep them apart.

const BOOL_WORDS = Object.freeze({ on: true, off: false, true: true, false: false, yes: true, no: false });

/**
 * A knob's expected form in words, bounds included — the middle of a `/set` error and the form line of
 * `/settings <name>`. `example` adds one for the JSON forms (the error wants it; the explanation shows the value).
 * @param {string} path @param {{ example?: boolean }} [o]
 */
export function knobFormText(path, { example = true } = {}) {
  const k = knobOf(path);
  if (!k) return "a value";
  const range = (unit) =>
    k.min != null && k.max != null ? `${unit} from ${k.min} to ${k.max}` : k.min != null ? `${unit} of at least ${k.min}` : k.max != null ? `${unit} of at most ${k.max}` : unit;
  switch (k.type) {
    case "bool": return "on or off";
    case "int": return range("a whole number");
    case "number": return range("a number");
    case "enum": return `one of ${(k.options || []).join(", ")}`;
    case "string": return "text";
    case "list": return example ? `a JSON list, e.g. ${knobExample(path, k)}` : "a JSON list";
    case "json": return example ? `a JSON object, e.g. ${knobExample(path, k)}` : "a JSON object";
  }
  return "a value";
}

/** An example value for the error's last sentence, built from the knob's own default when it has one. @param {string} path @param {Knob} k */
function knobExample(path, k) {
  if (k.example) return String(k.example);
  if (k.default != null && typeof k.default !== "object") return formatKnobText(path, k.default);
  switch (k.type) {
    case "bool": return "on";
    case "int": return String(Math.max(Number(k.min) || 0, 40));
    case "number": return String(Math.max(Number(k.min) || 0, 3));
    case "enum": return String((k.options || [])[0] ?? "");
    case "string": return '"a name"';
    case "list": return '["AGENTS.md"]';
    case "json": return "{}";
  }
  return "";
}

/**
 * A value typed in chat, parsed by the knob's type (D10): bool words, ints with `_`/`,` separators and a `k`
 * multiplier, numbers with an optional leading `$`, enums in any case, strings as the rest of the line (one pair of
 * surrounding quotes removed), `null`/`none` as an explicit null where the knob allows it, lists and JSON objects as
 * JSON only. The error is a whole sentence: the path, the expected form with bounds, what was typed, and an example.
 * @param {string} path @param {string} text
 * @returns {{ value: any } | { error: string }}
 */
export function parseKnobText(path, text) {
  const k = knobOf(path);
  if (!k) return { error: `There is no setting called "${path}". /settings all lists every setting.` };
  const raw = String(text ?? "").trim();
  const fail = () => `${path} takes ${knobFormText(path)} (you typed "${raw.slice(0, 60)}"). For example: /set ${path} ${knobExample(path, k)}.`;
  const check = (v) => (problemWith(path, v) ? { error: fail() } : { value: v });
  if (!raw) return { error: fail() };
  if (/^(null|none)$/i.test(raw)) return k.nullable || k.default === null ? { value: null } : { error: `${path} cannot be null; /unset ${path} returns it to the layers below.` };
  switch (k.type) {
    case "bool": {
      const v = BOOL_WORDS[/** @type {keyof typeof BOOL_WORDS} */ (raw.toLowerCase())];
      return v === undefined ? { error: fail() } : { value: v };
    }
    case "int": {
      const m = /^([+-]?)([\d_,\s]+?)(k)?$/i.exec(raw.replace(/\s+/g, ""));
      if (!m || !m[2]) return { error: fail() };
      const n = Number(m[1] + m[2].replace(/[_,\s]/g, "")) * (m[3] ? 1000 : 1);
      return Number.isFinite(n) && Number.isInteger(n) ? check(n) : { error: fail() };
    }
    case "number": {
      const n = Number(raw.startsWith("$") ? raw.slice(1) : raw);
      return Number.isFinite(n) ? check(n) : { error: fail() };
    }
    case "enum": {
      const hit = (k.options || []).find((o) => String(o).toLowerCase() === raw.toLowerCase());
      return hit != null ? { value: hit } : { error: fail() };
    }
    case "string": {
      let v = raw;
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
      return check(v);
    }
    case "list":
    case "json": {
      try {
        const v = JSON.parse(raw);
        if (k.type === "list" && !Array.isArray(v)) throw new Error("not a list");
        if (k.type === "json" && (v == null || typeof v !== "object" || Array.isArray(v))) throw new Error("not an object");
        return check(v);
      } catch {
        return { error: fail() };
      }
    }
  }
  return { error: fail() };
}

/**
 * A value as `/settings` shows it — the inverse of `parseKnobText`, so the two round-trip: bools as on/off, strings
 * quoted when they carry whitespace, lists and objects as JSON, null as null.
 * @param {string} path @param {any} value
 */
export function formatKnobText(path, value) {
  const k = knobOf(path);
  if (value == null) return "null";
  if (!k) return String(value);
  switch (k.type) {
    case "bool": return value ? "on" : "off";
    case "string": {
      const s = String(value);
      return s === "" || /\s/.test(s) ? JSON.stringify(s) : s;
    }
    case "list":
    case "json": return JSON.stringify(value);
    default: return String(value);
  }
}

/**
 * Which knob a typed name means (D9): the dotted name itself, or a unique ending of it (`stubChars`,
 * `compaction.model`). An ambiguous ending lists the candidates; an unknown name suggests up to three close ones.
 * @param {string} text
 * @returns {{ path: string } | { candidates: string[] } | { suggestions: string[] }}
 */
export function knobByName(text) {
  const q = String(text || "").trim().toLowerCase();
  if (!q) return { candidates: [] };
  const byLower = Object.fromEntries(Object.keys(KNOBS).map((p) => [p.toLowerCase(), p]));
  if (byLower[q]) return { path: byLower[q] };
  const ends = Object.keys(KNOBS).filter((p) => p.toLowerCase().endsWith("." + q));
  if (ends.length === 1) return { path: ends[0] };
  if (ends.length > 1) return { candidates: ends.sort() };
  const close = Object.keys(KNOBS)
    .map((p) => ({ p, d: Math.min(editDistance(q, p), editDistance(q, p.split(".").pop() || p)) }))
    .sort((a, b) => a.d - b.d || a.p.localeCompare(b.p));
  const cut = Math.min(4, Math.max(3, Math.floor(q.length / 2)));
  return { suggestions: close.filter((x) => x.d <= cut).slice(0, 3).map((x) => x.p) };
}
