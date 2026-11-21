// Cursor through its official TypeScript SDK (@cursor/sdk): a second way to run Cursor's agent, next to the
// `agent acp` CLI in acp.js. The SDK is optional: Filament never depends on it, loads it only when an upstream of
// type "cursor-sdk" is used, and explains in words when it is missing. Runs use the person's Cursor API key
// (Cursor Dashboard → Integrations) and bill their Cursor plan like IDE runs.
//
// Same client-facing behaviour as the ACP bridge: one conversation = one SDK agent (resumed across turns and
// restarts), streaming text and thinking, tool lines with diffs and command output, plans as the client's own task
// list, and with clientBridge = full/native Cursor's read/edit/shell/delete tools are replaced by Filament's custom
// tools so every file change and command runs through the chat client's hands (or Filament's, under the policy).
import { spawn } from "node:child_process";
import { readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TurnBridge, LiveTurn, WRITING_REFUSAL } from "./turn-bridge.js";
import { killTree } from "../tools/kill-tree.js";
import { ClientToolset } from "./client-bridge.js";
import { determineCwd, extractImages, findSession } from "./acp/bridge.js";
import { widenFor } from "../git/worktree.js";
import { widenedWords } from "../git/sparse.js";
import { modelLabels, planVariant, resolveMode } from "./acp/negotiate.js";
import { MODE_ALIASES } from "./acp/configure.js";
import { flattenMessages } from "../../core/wire/flatten.js";
import { composePrompt, countTaken, told } from "./acp/prompt.js";
import { ENVELOPES_TOOL, GRAPH_TOOL, LAUNCH_TOOL, SKILLS_TOOL, agentCompacted, contextUpdate, givenNote, givenRecord, givenSays, givenTools, promptFor, said, standingFor, stateOf } from "./context.js";
import { compactionOf, earlierTriesOf, moveFor, seenOf } from "./compactions.js";
import { idleDropOp, idleStep } from "./idle.js";
import { conversationKey } from "../../core/conversation.js";
import { estimateTokens } from "../../core/tokens.js";
import { saysCache } from "../../core/cache-facts.js";
import { accountRecord, cursorIdentity, notSignedIn } from "../../core/agent-limits.js";
import { cursorServers, serversFor } from "./chat-servers.js";
import { scriptNode } from "./agent-process.js";

export const SDK_PACKAGE = "@cursor/sdk";
export const SDK_INSTALL_HINT = "npm install -g @cursor/sdk";
export const SDK_KEY_URL = "https://cursor.com/dashboard?tab=integrations";
/** Cursor's own sub-agent tool, by the name the SDK's `disallowedTools` takes (`@cursor/sdk` options' `ToolName`). */
export const CURSOR_OWN_AGENTS = Object.freeze(["task"]);
/**
 * Cursor's own shell and file tools, which Filament's hands stand in for (`native`), by the SDK's names (read in 1.0.31:
 * its proto's tool calls). `edit` makes a file too: the SDK's stream says a `write`, and its tool lists know none — the
 * name was refused as every agent of a strict chat opened (the review of 11-11).
 */
export const CURSOR_OWN_HANDS = Object.freeze(["shell", "read", "edit", "delete"]);
/**
 * Cursor's own tools a chat stricter than Auto keeps (the SDK's `tools`, which names what stays): the ones that read
 * and plan, which every mode of the chat's switch runs unasked, and `mcp`, the family Filament's own tools reach the
 * agent in (its options: "omitting `mcp` disables MCP entirely"). A list of what goes left on every tool it did not
 * name — its image maker, its diffs, whatever a later SDK adds (the re-read of 11-11).
 */
export const CURSOR_KEPT = Object.freeze(["grep", "glob", "ls", "semSearch", "readLints", "webSearch", "webFetch", "updateTodos", "readTodos", "createPlan", "askQuestion", "mcp"]);
/**
 * What the SDK's refusal of a tool name says, as an agent is created or resumed (its ConfigurationError, "Unknown tool
 * name(s) in `disallowedTools`: write. Valid tool names: adopt, …."): the names it does not know, and the ones it
 * takes where it lists them — the one place it says them. Null for any other failure.
 * @param {any} e @returns {{ unknown: string[], valid: string[] | null } | null}
 */
export function unknownToolNames(e) {
  const m = /Unknown tool name\(s\) in `\w+`: ([^.]*)\.(?:\s*Valid tool names: ([^.]*)\.)?/.exec(String(e?.message || ""));
  if (!m) return null;
  /** @param {string} list */
  const names = (list) => list.split(",").map((n) => n.trim()).filter(Boolean);
  return { unknown: names(m[1]), valid: m[2] ? names(m[2]) : null };
}
const HERE = dirname(fileURLToPath(import.meta.url));
/** The modes Cursor's SDK runs an agent in. */
const SDK_MODES = ["agent", "plan"];
/** Cursor's compactions so far in this process: each one's id (`summary-<n>`), never one an earlier prompt had. */
let summaryIds = 0;
/** @type {import("../../core/ports.js").SignInWay[]} */
const CURSOR_WAYS = [
  { id: "cursor", name: "Cursor", description: "Sign in on Cursor's page; Filament keeps the API key Cursor makes for this account", kind: "browser" },
  // A key the person made in Cursor's dashboard, pasted (the review of 11-10): checked with Cursor, then kept as one Cursor's
  // page makes is.
  { id: "api-key", name: "Cursor API key", description: `Paste a key made at ${SDK_KEY_URL} (Integrations → API keys); Filament keeps it, sealed, for this account`, kind: "key", label: "Cursor API key" },
];

// Where an installed SDK may live: Filament's own folder, the global npm root, common prefixes, NODE_PATH. The node's
// own prefix is the PATH's node inside the desktop app, whose `process.execPath` is the app (HarnessV3-Native NA-D5).
export function sdkCandidateDirs() {
  const dirs = [join(HERE, "..", "..", "..", "node_modules")];
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, "npm", "node_modules"));
  if (process.env.FILAMENT_SDK_DIR) dirs.unshift(process.env.FILAMENT_SDK_DIR);
  const node = scriptNode();
  if (node) dirs.push(join(dirname(node), "node_modules"), join(dirname(node), "..", "lib", "node_modules"));
  dirs.push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
  if (process.env.HOME) dirs.push(join(process.env.HOME, ".npm-global", "lib", "node_modules"));
  for (const p of String(process.env.NODE_PATH || "").split(process.platform === "win32" ? ";" : ":"))
    if (p) dirs.push(p);
  return [...new Set(dirs)];
}
/**
 * The file an `import` of the SDK starts, as its package.json says it (`exports`, in the conditions Node takes for an
 * import, then `module` and `main`), where a release moves it from dist/esm/index.js (the review of 11-10).
 * @param {any} pkg @returns {string}
 */
export function sdkEntry(pkg) {
  /** @param {any} e @returns {string | null} */
  const pick = (e) => {
    // A CommonJS file no `import` takes: the next condition is.
    if (typeof e === "string") return e.endsWith(".cjs") ? null : e;
    if (Array.isArray(e)) { for (const x of e) { const f = pick(x); if (f) return f; } return null; }
    if (!e || typeof e !== "object") return null;
    if ("." in e) return pick(e["."]);
    for (const k of ["node", "import", "default"]) if (k in e) { const f = pick(e[k]); if (f) return f; }
    return null;
  };
  const f = pick(pkg?.exports) || (typeof pkg?.module === "string" && pkg.module) || (typeof pkg?.main === "string" && pkg.main) || "";
  return f && !f.endsWith(".cjs") && !/(^|[\\/])\.\.([\\/]|$)/.test(f) && !isAbsolute(f) ? f.replace(/^\.\//, "") : "dist/esm/index.js";
}
export function findSdkDir() {
  for (const dir of sdkCandidateDirs()) {
    const pkg = join(dir, "@cursor", "sdk", "package.json");
    if (existsSync(pkg)) {
      try {
        const said = JSON.parse(readFileSync(pkg, "utf8"));
        return { dir: join(dir, "@cursor", "sdk"), version: said.version || "?", entry: sdkEntry(said) };
      } catch {
        return { dir: join(dir, "@cursor", "sdk"), version: "?", entry: "dist/esm/index.js" };
      }
    }
  }
  return null;
}
let cache = null;
// Load the SDK once; `loader` lets tests inject a fake module. Never throws: the result says what is wrong.
export async function loadCursorSdk({ loader = null, force = false } = {}) {
  if (loader) {
    try {
      const mod = await loader();
      return { ok: true, mod, version: mod.VERSION || "test", path: "injected" };
    } catch (e) {
      return { ok: false, error: e.message, hint: SDK_INSTALL_HINT };
    }
  }
  if (cache && !force) return cache;
  const errors = [];
  try {
    const mod = await import(SDK_PACKAGE);
    const found = findSdkDir();
    cache = { ok: true, mod, version: found?.version || "?", path: found?.dir || SDK_PACKAGE };
    return cache;
  } catch (e) {
    errors.push(
      e.code === "ERR_MODULE_NOT_FOUND" ? "not in Filament's node_modules" : e.message.slice(0, 160),
    );
  }
  const found = findSdkDir();
  if (found) {
    try {
      const mod = await import(pathToFileURL(join(found.dir, found.entry)).href);
      cache = { ok: true, mod, version: found.version, path: found.dir };
      return cache;
    } catch (e) {
      errors.push(`found at ${found.dir} but it did not load: ${e.message.slice(0, 200)}`);
    }
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) errors.push(`Node ${process.versions.node} is too old for the SDK (needs 22.13 or newer)`);
  cache = { ok: false, error: errors.join("; ") || "not installed", hint: SDK_INSTALL_HINT };
  return cache;
}
export function sdkStatus() {
  const found = findSdkDir();
  return {
    installed: !!found,
    version: found?.version || null,
    path: found?.dir || null,
    loaded: !!(cache && cache.ok),
    loadError: cache && !cache.ok ? cache.error : null,
    install: SDK_INSTALL_HINT,
    node: process.versions.node,
    nodeOk: Number(process.versions.node.split(".")[0]) >= 22,
  };
}
export function resetSdkCache() {
  cache = null;
}

/**
 * The Cursor SDK installed for the person: `npm install -g @cursor/sdk`, its output as it comes (the newest 20,000
 * characters), and their stop. No clock: a slow download isn't a failure, and the person sees it go and stops it
 * (HarnessV3-FailurePoints FP-D3). Stopped by its tree (kill-tree.js): on Windows npm runs under cmd, and cmd killed
 * alone leaves npm running.
 * @param {{ spawnImpl?: typeof spawn, platform?: string }} [o]
 * @returns {{ since: number, output: () => string, stop: () => void, done: Promise<{ code: number, out: string, stopped: boolean }> }}
 */
export function installCursorSdk({ spawnImpl = spawn, platform = process.platform } = {}) {
  const isWin = platform === "win32";
  let out = "";
  let stopped = false;
  let ended = false;
  /** @type {any} */
  let child = null;
  /** @param {any} d */
  const push = (d) => {
    out += String(d);
    if (out.length > 20000) out = out.slice(-20000);
  };
  const done = new Promise((resolve) => {
    /** @param {number} code @param {string} [more] */
    const end = (code, more = "") => {
      if (ended) return;
      ended = true;
      resolve({ code, out: out + more, stopped });
    };
    try {
      child = spawnImpl(isWin ? process.env.ComSpec || "cmd.exe" : "npm", isWin ? ["/d", "/s", "/c", SDK_INSTALL_HINT] : SDK_INSTALL_HINT.split(" ").slice(1), {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (/** @type {any} */ e) {
      return end(1, String(e?.message || e));
    }
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.on("error", (/** @type {any} */ e) => end(1, `\n${e?.message || e}`));
    child.on("close", (/** @type {number | null} */ code) => end(code ?? 1, stopped ? "\n(Filament: stopped by the person)" : ""));
  });
  const stop = () => {
    if (stopped || ended || !child) return;
    stopped = true;
    void killTree(child, { platform });
  };
  return { since: Date.now(), output: () => out, stop, done };
}

// ---- helpers ------------------------------------------------------------------------------------------------
const short = (id) =>
  String(id || "")
    .replace(/^agent-/, "")
    .slice(0, 8);
// Names a client can ask for: the base id, effort levels and the fast variant, like the ACP list from `agent --list-models`.
export function expandModelNames(items) {
  const names = [];
  for (const it of items || []) {
    if (!it?.id) continue;
    names.push(it.id);
    const effort = (it.parameters || []).find((p) => /effort|thought|reason/i.test(p.id));
    const fast = (it.parameters || []).find((p) => /^fast$/i.test(p.id));
    const efforts = effort
      ? effort.values.map((v) => v.value ?? v).filter((v) => !/^(true|false)$/i.test(String(v)))
      : [];
    for (const e of efforts) names.push(`${it.id}-${e}`);
    if (fast) {
      names.push(`${it.id}-fast`);
      for (const e of efforts) names.push(`${it.id}-${e}-fast`);
    }
  }
  return [...new Set(names)];
}
// A flat name from the route (`grok-4.6-xhigh-fast`, `composer-2.5`, `auto`) -> the SDK's { id, params }.
export function selectSdkModel(modelId, effort, items) {
  const notes = [];
  const list = Array.isArray(items) ? items : [];
  const ids = list.map((i) => i.id);
  const aliasOf = new Map();
  for (const i of list) for (const a of i.aliases || []) aliasOf.set(String(a).toLowerCase(), i.id);
  let wanted = String(modelId || "").trim();
  if (aliasOf.has(wanted.toLowerCase())) wanted = aliasOf.get(wanted.toLowerCase());
  const fallback = () => {
    const d = list.find((i) => /^auto/i.test(i.id)) || list[0];
    return d ? { id: d.id } : null;
  };
  if (!wanted || /^(auto|default)$/i.test(wanted)) {
    const sel = list.find((i) => i.id === wanted) ? { id: wanted } : fallback();
    if (sel)
      notes.push(
        `sdk: model ${sel.id}${wanted && sel.id !== wanted ? ` (Cursor's default for “${wanted}”)` : ""}`,
      );
    return { selection: sel, notes };
  }
  if (!list.length) {
    notes.push(`sdk: model ${wanted} (model list unavailable; sent as is)`);
    return { selection: { id: wanted }, notes };
  }
  const labels = modelLabels(list);
  const first = planVariant(wanted, null, { models: ids, params: [], labels });
  if (!first) {
    const sel = fallback();
    notes.push(
      `sdk: model ${wanted} not offered by Cursor (offers ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", …" : ""}); using ${sel?.id || "none"}`,
    );
    // The fallback as a fact beside its sentence (core/notes.js "model-not-offered", `refusedAt` its sentence's place
    // in `notes`): what says why another model answers reads it, and the sentence stays the record's.
    const refused = { kind: "model-not-offered", model: wanted, offers: ids.slice(0, 8), keeping: sel?.id || "none" };
    return { selection: sel, notes, unknownModel: true, refused, refusedAt: notes.length - 1 };
  }
  const item = list.find((i) => i.id === first.base);
  const params = (item?.parameters || []).map((p) => ({
    id: p.id,
    values: (p.values || []).map((v) => v.value ?? v),
    current: null,
    category: /effort|thought|reason/i.test(p.id)
      ? "thought_level"
      : /^fast$/i.test(p.id)
        ? "model_config"
        : "",
  }));
  const v = planVariant(wanted, effort, { models: ids, params, labels }) || first;
  const set = v.set.filter(([id]) => params.some((p) => p.id === id));
  const label = (k, val) =>
    /^(true|false)$/i.test(val) ? `${k} ${/^true$/i.test(val) ? "on" : "off"}` : `${k} ${val}`;
  notes.push(
    `sdk: model ${v.base}${set.length ? ` (${set.map(([k, val]) => label(k, val)).join(", ")})` : ""}`,
  );
  if (v.unknown.length) notes.push(`sdk: ignored in the model name: ${v.unknown.join(", ")}`);
  if (effort && !set.some(([k]) => k === v.effortParam))
    notes.push(
      `sdk: effort ${effort} not applied: ${v.effortParam ? `${v.base} offers ${params.find((p) => p.id === v.effortParam)?.values.join("/")}` : `${v.base} has no effort setting`}`,
    );
  return {
    selection: {
      id: v.base,
      ...(set.length ? { params: set.map(([id, value]) => ({ id, value: String(value) })) } : {}),
    },
    notes,
  };
}
// One line and a kind for a Cursor tool call, from the SDK's typed toolCall.
export function describeSdkTool(tc) {
  const a = tc?.args || {};
  const t = tc?.type;
  const path = a.path || a.filePath || a.targetFile || a.target_file || "";
  switch (t) {
    case "shell":
      return { title: String(a.command || "shell").trim(), kind: "execute" };
    case "read":
      return { title: `Read ${path}`, kind: "read" };
    case "write":
      return { title: `Write ${path}`, kind: "edit" };
    case "edit":
      return { title: `Edit ${path}`, kind: "edit" };
    case "delete":
      return { title: `Delete ${path}`, kind: "delete" };
    case "grep":
      return { title: `Grep ${a.pattern || ""}${a.path ? ` in ${a.path}` : ""}`, kind: "search" };
    case "glob":
      return {
        title: `Glob ${a.globPattern || a.pattern || ""}${a.targetDirectory ? ` in ${a.targetDirectory}` : ""}`,
        kind: "search",
      };
    case "ls":
      return { title: `List ${path || a.targetDirectory || "."}`, kind: "read" };
    case "semSearch":
      return { title: `Search ${a.query || ""}`, kind: "search" };
    case "webSearch":
      return { title: `Search the web: ${a.query || a.searchTerm || ""}`, kind: "fetch" };
    case "webFetch":
      return { title: `Fetch ${a.url || ""}`, kind: "fetch" };
    case "readLints":
      return { title: `Lints ${Array.isArray(a.paths) ? a.paths.join(", ") : ""}`.trim(), kind: "read" };
    case "task":
      return { title: `Agent: ${a.description || a.prompt?.slice(0, 80) || "sub-agent"}`, kind: "other" };
    case "mcp": {
      const name = a.toolName || "tool";
      const inner = a.args || {};
      const target = inner.file_path || inner.path || inner.command || inner.pattern || "";
      return {
        title: `${name}${target ? " " + String(target).slice(0, 160) : ""}`,
        kind: /bash|shell|command/i.test(name)
          ? "execute"
          : /write|edit|delete/i.test(name)
            ? "edit"
            : /read/i.test(name)
              ? "read"
              : /grep|glob|search/i.test(name)
                ? "search"
                : "other",
      };
    }
    case "createPlan":
      return { title: "Plan", kind: "think" };
    case "askQuestion":
      return { title: `Question: ${a.question || a.prompt || ""}`.slice(0, 200), kind: "other" };
    case "generateImage":
      return { title: "Generate image", kind: "other" };
    case "updateTodos":
    case "readTodos":
    case "await":
    case "applyAgentDiff":
      return null;
    default:
      return t ? { title: String(t), kind: "other" } : null;
  }
}
const todoStatus = (s) =>
  /complete|done/i.test(s)
    ? "completed"
    : /progress|running|active/i.test(s)
      ? "in_progress"
      : "pending";
/** Cursor's to-do list as the turn's plan, in ACP's words: a cancelled item is no longer part of the work. @param {any} todos */
const planEntries = (todos) =>
  (Array.isArray(todos) ? todos : [])
    .filter((t) => t && !/cancel/i.test(String(t.status || "")))
    .map((t) => ({ content: String(t.content || ""), status: todoStatus(String(t.status || "")), priority: "medium" }))
    .filter((e) => e.content);
/** An image call's card, as the ACP route's reads it: its tool's name and its description. @param {any} tc */
const imageOf = (tc) =>
  tc?.type === "generateImage" ? { toolName: "generateImage", rawInput: { description: String(tc.args?.description || "") } } : {};
/**
 * A shell call's command where the ACP route reads one (`rawInput.command`), as Codex's and an ACP agent's calls carry
 * it: the turn counts its failed runs by it (acp-turn, d-fails). Only once the call started, its input whole — a partial
 * call's is its model's words so far. @param {any} tc @param {string} type  the update's
 */
const commandOf = (tc, type) =>
  type === "tool-call-started" && tc?.type === "shell" && typeof tc.args?.command === "string" && tc.args.command ? { rawInput: { command: tc.args.command } } : {};
/**
 * Cursor's shell under the name the ACP route knows a shell by, as Codex's command carries it ("bash", which its card
 * read by its kind already): Cursor's SDK names none of its own tools, and what is said of a call names it by its tool
 * (acp-turn, memory's line on the record). @param {any} tc
 */
const shellOf = (tc) => (tc?.type === "shell" ? { toolName: "bash" } : {});
/** Cursor's own tools that read or change the one file they name. */
const FILE_TOOLS = new Set(["read", "write", "edit", "delete"]);
/**
 * The file one of Cursor's own file tools names, where the ACP route reads a call's files (`locations`), as an ACP
 * agent's and Codex's calls carry them: the turn judges an edit by them — the unplanned line, a change outside every
 * open task's writes, what changed behind a file it read — and memory its open threads (acp-turn `sawWork`; the review
 * of 11-11: its calls named no file, so Cursor heard none of them). Only once the call started, or ended: a partial
 * call's path is its model's words so far. @param {any} tc @param {string} type  the update's
 */
const filesOf = (tc, type) => {
  const a = tc?.args || {};
  const path = a.path || a.filePath || a.targetFile || a.target_file;
  return type !== "partial-tool-call" && FILE_TOOLS.has(tc?.type) && typeof path === "string" && path ? { locations: [{ path }] } : {};
};
/**
 * A call to an MCP server's tool by its MCP name, as Claude says one, and its input. One of Filament's own tools (`own`:
 * memory's, the task graph's, a team's, the visual tools) as the ACP route reads one over Filament's MCP server
 * (`mcp__filament__show_visual`): its card is the loop's ("Draw request_flow"), and the tool's own call claims it by that
 * name (agent-run.js `callFor`). A server the person attached by its own (`mcp__slack__post_reply`), as the ACP route
 * reads Cursor's (acp/updates.js `mcpCallOf`): never taken for a read or a command by a word in its name, which a move
 * to an agent's next model would send anew (the review of 7cd60efc5). Filament's file tools keep Cursor's kind.
 * @param {any} tc @param {{ has: (name: string) => boolean } | null | undefined} own
 */
export const mcpToolOf = (tc, own) => {
  const name = String(tc?.args?.toolName || "");
  const server = String(tc?.args?.providerIdentifier || "");
  if (tc?.type !== "mcp" || !name || !server) return {};
  if (server === "custom-user-tools" && !own?.has(name)) return {};
  const input = tc.args?.args;
  return { toolName: `mcp__${server === "custom-user-tools" ? "filament" : mcpPart(server, true)}__${mcpPart(name)}`, rawInput: input && typeof input === "object" ? input : {} };
};
/**
 * A part of a tool's MCP name as a model's history takes one — letters, digits, _ and - — a server's never Filament's
 * own (plugins.js `serverName` holds the name the same way: the review of 46a624ab4). @param {string} s @param {boolean} [server]
 */
const mcpPart = (s, server = false) => {
  const part = s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
  return server && part.toLowerCase() === "filament" ? "filament-mcp" : part;
};
/**
 * What a Cursor agent's context holds by Filament's estimate — the SDK says no prompt size, but it streams every token
 * appended to the context: the base prompt, calibrated on the conversation's first turn, the earlier turns' appended
 * tokens (a fifth of them once Cursor compacted during this turn), and what this turn appended so far.
 * @param {{ contextBase?: number | null, contextAppended?: number }} conv @param {{ appended?: number, compacted?: boolean }} ctx
 */
const cursorContext = (conv, ctx) => {
  const before = conv.contextAppended || 0;
  return (conv.contextBase || 0) + (ctx.compacted ? Math.round(before * 0.2) : before) + (ctx.appended || 0);
};
/**
 * Cancel a run only when this handle allows it. A detached run throws if cancel is called anyway. → whether it was
 * asked: false for no run yet, and for one that takes no cancel. @param {any} run
 */
async function cancelRun(run) {
  if (!run || (typeof run.supports === "function" && !run.supports("cancel"))) return false;
  try {
    await run.cancel();
  } catch {}
  return true;
}
/**
 * What a run spent as Cursor counts it, in Filament's words: its input without what was read from the cache (Cursor's
 * `totalTokens` is input + output + cacheRead), stored as is, marked where it carried a cache count (`cacheSeen`,
 * core/cache-facts.js). Null for none.
 * @param {any} u
 */
function runUsage(u) {
  return u && typeof u === "object"
    ? { input: u.inputTokens || 0, output: u.outputTokens || 0, cacheRead: u.cacheReadTokens || 0, cacheWrite: u.cacheWriteTokens || 0, total: u.totalTokens || null, ...(saysCache(u.cacheReadTokens, u.cacheWriteTokens) ? { cacheSeen: true } : {}) }
    : null;
}
/** Cursor's counts of model calls, in its own words, added up: each count that either carried. @param {any} a @param {any} b */
function plusRunUsage(a, b) {
  return Object.fromEntries(["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"].filter((k) => a?.[k] != null || b?.[k] != null).map((k) => [k, (Number(a?.[k]) || 0) + (Number(b?.[k]) || 0)]));
}
/**
 * A run's end as its turn waits on it (`of`), or its letting go (`letGo`): a stop on a run that takes no cancel ends the
 * wait as cancelled, the run left to finish on its own — no clock ends an agent's turn (HarnessV3-FailurePoints §4 B),
 * so the stop is the one way out of a run that never ends. `gone`: what the run says after is no one's.
 */
function runEnd() {
  /** @type {() => void} */
  let go = () => {};
  const left = new Promise((resolve) => (go = () => resolve({ status: "cancelled" })));
  const end = {
    gone: false,
    letGo: () => {
      end.gone = true;
      go();
    },
    /** @param {any} run @returns {Promise<any>} */
    of: (run) => Promise.race([run.wait(), left]),
    /** Cancel the run where it takes a cancel, else let go of it. @param {any} run */
    stop: async (run) => {
      if (run && !(await cancelRun(run))) end.letGo();
    },
  };
  return end;
}

// ---- the bridge ---------------------------------------------------------------------------------------------
export class CursorSdkBridge extends TurnBridge {
  constructor({ log = () => {}, stateFile = null, loader = null, cli = "filament" } = {}) {
    super({ log });
    this.stateFile = stateFile;
    this.loader = loader;
    this.cli = cli; // Filament's command line as the agent's shell runs it: the widen its sparse copy is told of names it
    this.convs = new Map(); // convKey -> { agentId, upstreamId, cwd, turns, lastUsed, idleMs, modelId, mode, title, seenUserTurns }
    this.agents = new Map(); // agentId -> live SDK agent
    this.modelCache = new Map(); // upstream id -> { at, items, names }
    this.meCache = new Map(); // api key -> { at, me }
    this.accounts = new Map(); // upstream id -> { identity, at }: who its key belongs to, as Cursor last said
    /** The agents writing Filament's summary (HarnessV3-ACP AC5-4): their tools refuse their calls meanwhile. @type {Set<string>} */
    this.writing = new Set();
    /**
     * What a live handle was opened with — its disallowedTools, the MCP servers and the folders it was given
     * (HarnessV4_Overnight_Plan OV-D18) — as one word. The SDK does not keep them, and send cannot set them.
     * @type {Map<string, string>}
     */
    this.openedWith = new Map();
    /**
     * The live handles that hold custom tools, from their opening or the message before: the SDK keeps them for a
     * message that names none. @type {WeakSet<object>}
     */
    this.holdsTools = new WeakSet();
    /**
     * The tool names the loaded SDK said it does not know (`unknownToolNames`): in none of its lists from then on, for
     * as long as it is loaded. @type {Set<string>}
     */
    this.unknownTools = new Set();
    this.#load();
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref?.();
  }
  #load() {
    if (!this.stateFile) return;
    try {
      const j = JSON.parse(readFileSync(this.stateFile, "utf8"));
      for (const [k, c] of Object.entries(j.conversations || {})) this.convs.set(k, c);
    } catch {}
  }
  #saveTimer = null;
  #save() {
    if (!this.stateFile) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#write(), 300);
    this.#saveTimer.unref?.();
  }
  /** Write the session map now, a save still waiting with it. */
  #write() {
    clearTimeout(this.#saveTimer);
    if (!this.stateFile) return;
    try {
      const conversations = {};
      for (const [k, c] of this.convs)
        conversations[k] = {
          agentId: c.agentId,
          upstreamId: c.upstreamId,
          cwd: c.cwd,
          turns: c.turns,
          lastUsed: c.lastUsed,
          idleMs: c.idleMs,
          modelId: c.modelId,
          mode: c.mode,
          title: c.title,
          seenUserTurns: c.seenUserTurns,
          given: c.given,
          steerSaid: c.steerSaid,
          // An agent no message of the person's has reached is still owed its seed (the bug report's L21).
          ...(c.fresh ? { fresh: true } : {}),
          // The start of Filament's copy its count was made on, where that start is an agent's own summary, and
          // whether it was left untold some of the chat (`recounted`, `owes`).
          ...(c.countedOn != null ? { countedOn: c.countedOn } : {}),
          ...(c.partial ? { partial: true } : {}),
          // The chat's compaction the agent stands on, and the agent from before it while an undo can still bring
          // it back (AC5-1).
          basedOn: c.basedOn,
          before: c.before || null,
          // A harness chat's: its record outlives idleness (`idleStep`).
          ...(c.harness ? { harness: true } : {}),
        };
      // Written beside the map, then put in its place: a write cut short leaves the map as it was, never torn.
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, conversations }, null, 1));
      renameSync(tmp, this.stateFile);
    } catch (e) {
      this.log("warn", `[sdk] could not save session map: ${e.message}`);
    }
  }

  async sdk() {
    const r = await loadCursorSdk({ loader: this.loader });
    if (!r.ok)
      throw Object.assign(
        new Error(
          `the Cursor SDK is not installed on this machine (${r.error}). Install it once with \`${SDK_INSTALL_HINT}\` and restart Filament; the Cursor CLI route (cursor/…) keeps working meanwhile.`,
        ),
        { code: "SDK_MISSING" },
      );
    return r;
  }
  // No key is no sign-in: a failure of the account's, which sending again cannot pass (`classifyFailure`).
  keyOf(upstream) {
    const k = String(upstream?.apiKey || "").trim();
    if (!k)
      throw Object.assign(
        new Error(
          `${upstream?.name || upstream?.id || "this upstream"} has no Cursor API key: sign it in under Settings → Coding agents, on Cursor's page or with a key made at ${SDK_KEY_URL} (Integrations → API keys).`,
        ),
        { code: "SDK_KEY", data: { errorKind: "authentication_failed" } },
      );
    return k;
  }
  // Who the upstream's key belongs to (`Cursor.me()`), asked once an hour or afresh at the person's word (*Check now*),
  // and handed to the server's store (HarnessV3-ACP AC3-6). Cursor publishes no interface for its plan's limits
  // (AC-D9), so its account has no windows, and says why.
  async me(upstream, { fresh = false } = {}) {
    const key = this.keyOf(upstream);
    let c = this.meCache.get(key);
    if (!c || fresh || Date.now() - c.at >= 3600_000) {
      const { mod } = await this.sdk();
      c = { at: Date.now(), me: await mod.Cursor.me({ apiKey: key }) };
      this.meCache.set(key, c);
    }
    const identity = cursorIdentity(c.me);
    if (identity) {
      this.accounts.set(upstream.id, { identity, at: c.at });
      this.heardAccount(upstream.id, { source: "Cursor.me()", identity, noWindows: "Cursor doesn't publish its plan's limits" });
    }
    return c.me;
  }
  async checkAccount(upstream) {
    if (String(upstream?.apiKey || "").trim()) return void (await this.me(upstream, { fresh: true }));
    // An account added in Settings has no key until it signs in (HarnessV3-ACP AC3-7).
    this.accounts.delete(upstream.id);
    this.heardAccount(upstream.id, { source: "the upstream's key", identity: notSignedIn("no Cursor API key yet"), noWindows: "Cursor doesn't publish its plan's limits" });
  }
  /** Cursor's ways to sign in (HarnessV3-ACP AC3-7): its page, which makes the account a key, or a key pasted. */
  async signInWays() {
    return CURSOR_WAYS;
  }
  /** An account signs out by forgetting its key (HarnessV3-ACP AC3-7). */
  signsOut() {
    return true;
  }
  /**
   * Signed out (HarnessV3-ACP AC3-7): the upstream's key is to be forgotten. It stays valid at Cursor until it expires
   * or is revoked in Cursor's dashboard.
   */
  async signOut() {
    return { forgetKey: true };
  }
  /**
   * Cursor's own sign-in (HarnessV3-ACP AC3-7): `Cursor.auth.login` makes an API key for whoever signs in on Cursor's
   * page, named for the account, and hands it back — never into Cursor's own store (`store: null`): the key is the
   * upstream's, kept where its other keys are. Resolves once Cursor names its page.
   * A key pasted (`api-key`) is asked of Cursor (`Cursor.me`) first, and kept only where Cursor knows it.
   * @param {any} upstream @param {{ way?: string, name: string, signal: AbortSignal, key?: string }} o
   * @returns {Promise<{ url: string, code: null, done: Promise<{ ok: boolean, error: string | null, key?: string, expiresAt?: number | null }> }>}
   *   `done`: how it ended (the key on a sign-in); no error and not signed in is a sign-in cancelled
   */
  async signIn(upstream, { way, name, signal, key = "" }) {
    const { mod } = await this.sdk();
    if (way === "api-key") {
      // Cursor's words may say the key back: it is taken out of them whole before they are shortened — shortened
      // first, a key they broke off in was a key no longer, and its start stood in the account's row.
      const said = (/** @type {any} */ e) => (key ? String(e?.message || e).split(key).join("••••") : String(e?.message || e));
      const done = Promise.resolve(mod.Cursor.me({ apiKey: key })).then(
        () => ({ ok: true, error: null, key, expiresAt: null }),
        (/** @type {any} */ e) => ({ ok: false, error: `Cursor refused the key (${said(e).slice(0, 160)})` }),
      );
      this.#op(`a Cursor API key pasted for ${upstream.id}`, { sub: "sign-in", ref: { upstreamId: upstream.id } });
      return { url: "", code: null, done };
    }
    if (typeof mod.Cursor?.auth?.login !== "function")
      throw Object.assign(new Error("this Cursor SDK has no sign-in of its own (Cursor.auth.login): update it, or paste a key"), { code: "SDK_NO_LOGIN" });
    /** @type {(url: string) => void} */
    let named = () => {};
    const page = new Promise((res) => (named = res));
    const done = Promise.resolve(mod.Cursor.auth.login({ store: null, openBrowser: false, apiKeyName: name, signal, onLoginUrl: (/** @type {string} */ url) => named(String(url)) })).then(
      (/** @type {any} */ r) => (r?.apiKey ? { ok: true, error: null, key: String(r.apiKey), expiresAt: Number(r.apiKeyExpiresAtMs) || null } : { ok: false, error: "Cursor's sign-in gave no key" }),
      (/** @type {any} */ e) => ({ ok: false, error: signal.aborted ? null : String(e?.message || e) }),
    );
    const url = await Promise.race([page, done.then((r) => Promise.reject(new Error(r.error || "Cursor's sign-in stopped before naming its page")))]);
    this.#op(`a Cursor sign-in started for ${upstream.id}`, { sub: "sign-in", ref: { upstreamId: upstream.id } });
    return { url: String(url), code: null, done };
  }
  async listModels(upstream, { force = false } = {}) {
    const c = this.modelCache.get(upstream.id);
    if (c && !force && Date.now() - c.at < 3600_000)
      return { names: c.names, items: c.items, labels: c.labels, source: "cache" };
    const key = this.keyOf(upstream);
    const { mod } = await this.sdk();
    const items = await mod.Cursor.models.list({ apiKey: key });
    const names = expandModelNames(items);
    const labels = modelLabels(items);
    this.modelCache.set(upstream.id, { at: Date.now(), items, names, labels });
    return { names, items, labels, source: "Cursor.models.list" };
  }
  peekByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.convs.get(conversationKey(upstream.id, cwd, flat, conversationId)) || null;
  }
  forgetByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.forgetConversation(conversationKey(upstream.id, cwd, flat, conversationId));
  }
  /** A chat forgotten lets go of its agent, as one the sweep drops (fable51's list). @param {string} key */
  forgetConversation(key) {
    const c = this.convs.get(key);
    if (!c) return false;
    this.convs.delete(key);
    this.#save();
    this.#leave(c);
    return true;
  }
  /** An agent a chat let go of: closed, unless another chat still holds it. @param {{ agentId: string }} c */
  #leave(c) {
    for (const other of this.convs.values()) if (other !== c && other.agentId === c.agentId) return;
    const agent = this.agents.get(c.agentId);
    this.agents.delete(c.agentId);
    this.openedWith.delete(c.agentId);
    try {
      agent?.close?.();
    } catch {}
  }
  // Agent lifecycle as durable operations, injected by the server as `sdkBridge.onOp` — the same hook AcpBridge uses.
  // The SDK runs inside Filament's own process and auto-approves Cursor's tools, so there is no process exit and no
  // permission decision to record here; creating and resuming an agent are the lifecycle events it has.
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break an agent turn */
    }
  }
  killProcess() {
    return false;
  }
  processInfo(upstreamId) {
    const found = findSdkDir();
    const identity = this.accounts.get(upstreamId)?.identity || null;
    if (!found && !identity) return null;
    return {
      agent: { name: SDK_PACKAGE, version: found?.version || "?" },
      identity,
      processes: 1,
      pid: process.pid,
      models: [],
    };
  }
  status() {
    const now = Date.now();
    const found = findSdkDir();
    return {
      permissions: [],
      processes: found
        ? [
            {
              key: `cursor-sdk|in-process`,
              command: `${SDK_PACKAGE} ${found.version} (in Filament's process)`,
              args: [],
              pid: process.pid,
              startedAt: null,
              idleMs: 0,
              exited: false,
              stderr: [],
            },
          ]
        : [],
      // Same four bridge fields as `AcpBridge.status()`, because `/api/acp/status` merges both bridges into ONE
      // table: an SDK conversation without them rendered as "not run" beside real ACP ones that had run.
      conversations: [...this.convs.entries()].map(([key, c]) => {
        const t = c.agentId ? this.turns.get(c.agentId) : null;
        const divergence = (t?.notes || []).find((n) =>
          /declares no tools; Filament's own hands/.test(String(n)),
        );
        return {
          key,
          sessionId: c.agentId,
          upstreamId: c.upstreamId,
          cwd: c.cwd,
          turns: c.turns,
          idleMs: now - c.lastUsed,
          modelId: c.modelId,
          mode: c.mode,
          title: c.title || null,
          commands: [],
          live: this.agents.has(c.agentId),
          bridge: t?.bridgeEffective || null,
          bridgeConfigured: t?.bridge || null,
          bridgeNote: divergence ? String(divergence).replace(/^sdk:\s*/, "") : null,
          steering: !!c.steering,
          clientTools: t?.clientTools?.summary?.() || null,
        };
      }),
      turns: [...this.turns.values()].map((t) => t.describe()),
    };
  }
  /**
   * The agents Cursor keeps on this machine, newest first. The SDK keeps local agents by folder, and lists one
   * folder's: the chat's (`req`, read as its turns read it), each one Filament's chats on the upstream work in, and the
   * upstream's own (the bug report's X6: listed with no folder, only those of the folder Filament runs in showed, so
   * `/resume` found none).
   * @param {any} upstream @param {{ format: string, body: any, cwdHint?: string | null } | null} [req]
   */
  async listSessions(upstream, req = null) {
    try {
      const { mod } = await this.sdk();
      const key = this.keyOf(upstream);
      const acp = upstream.acp || {};
      const folders = new Set(req ? [determineCwd(acp, flattenMessages(req.format, req.body), req.cwdHint).cwd] : []);
      for (const c of this.convs.values()) if (c.upstreamId === upstream.id && c.cwd) folders.add(c.cwd);
      if (acp.cwdDefault) folders.add(String(acp.cwdDefault));
      /** @type {Map<string, any>} */
      const found = new Map();
      for (const cwd of folders) {
        const r = await mod.Agent.list({ runtime: "local", cwd, apiKey: key, limit: 50 });
        for (const a of r?.items || [])
          if (!found.has(a.agentId))
            found.set(a.agentId, {
              sessionId: a.agentId,
              cwd,
              title: a.name || a.summary || null,
              updatedAt: a.lastModified ? new Date(a.lastModified).toISOString() : null,
            });
      }
      const sessions = [...found.values()].sort((x, y) => String(y.updatedAt || "").localeCompare(String(x.updatedAt || "")));
      return { ok: true, sessions: sessions.slice(0, 50) };
    } catch (e) {
      return { ok: false, error: e.message, sessions: [] };
    }
  }
  // A chat set to an agent Cursor already has (`/resume`), standing on the chat's newest compaction as the command's
  // request names it (AC5-1).
  async attach({ upstream, format, body, cwdHint, conversationId, sessionId, headers = {} }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    const convKey = conversationKey(upstream.id, cwd, flat, conversationId);
    const l = await this.listSessions(upstream, { format, body, cwdHint });
    if (!l.ok) return { ok: false, error: l.error };
    const { found, candidates } = findSession(l.sessions, sessionId);
    if (!found)
      return {
        ok: false,
        error:
          candidates.length > 1
            ? `"${sessionId}" matches ${candidates.length} agents; use more of the id or title`
            : `no Cursor agent matches "${sessionId}" (${l.sessions.length} known; /sessions lists them)`,
      };
    const acp = upstream.acp || {};
    this.convs.set(convKey, {
      agentId: found.sessionId,
      upstreamId: upstream.id,
      cwd: found.cwd || cwd,
      turns: 0,
      lastUsed: Date.now(),
      idleMs: Math.max(1, Number(acp.sessionIdleMinutes) || 240) * 60000,
      title: found.title || null,
      resumedFrom: found.sessionId,
      basedOn: compactionOf(headers, upstream.id) ?? 0,
    });
    this.#save();
    return { ok: true, session: found, cwd: found.cwd || cwd };
  }
  async offer(upstream) {
    try {
      const m = await this.listModels(upstream);
      const grok = m.items.find((i) => (i.parameters || []).some((p) => /effort/i.test(p.id)));
      return {
        ok: true,
        commands: [],
        models: m.names,
        currentModel: null,
        modes: [...SDK_MODES],
        efforts: grok
          ? grok.parameters.find((p) => /effort/i.test(p.id)).values.map((v) => v.value ?? v)
          : [],
        params: [],
      };
    } catch (e) {
      return { ok: false, error: e.message, commands: [], models: [], modes: [...SDK_MODES], efforts: [] };
    }
  }
  async test(upstream) {
    const t0 = Date.now();
    try {
      const r = await this.sdk();
      const me = await this.me(upstream);
      const m = await this.listModels(upstream, { force: true });
      const efforts =
        m.items
          .find((i) => (i.parameters || []).some((p) => /effort/i.test(p.id)))
          ?.parameters.find((p) => /effort/i.test(p.id))
          ?.values.map((v) => v.value ?? v) || [];
      return {
        ok: true,
        ms: Date.now() - t0,
        command: `${SDK_PACKAGE} ${r.version} (in-process, ${r.path})`,
        agent: { name: SDK_PACKAGE, version: r.version },
        auth: `${me.userEmail || ""}${me.apiKeyName ? ` (key “${me.apiKeyName}”)` : ""}`.trim(),
        modes: [...SDK_MODES],
        currentModel: null,
        models: m.items.length,
        sample: m.items
          .slice(0, 12)
          .map((i) => i.id)
          .join(", "),
        efforts,
        cwd: determineCwd(upstream.acp || {}, [], null).cwd,
      };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e.message, code: e.code };
    }
  }
  /**
   * Chats idle past their limit let go of their agents (`idleStep`): an outside client's is dropped, a harness chat's
   * keeps its agent, which its next message resumes.
   */
  sweep(now = Date.now()) {
    let dropped = 0;
    for (const [k, c] of this.convs) {
      const step = idleStep(c, now, this.inUse(k));
      if (step === "drop") {
        this.convs.delete(k);
        this.#op(...idleDropOp(c, now));
        dropped++;
      }
      if (step !== "keep") this.#leave(c);
    }
    if (dropped) this.#save();
    this.sweepTurns(now);
    return dropped;
  }
  shutdown() {
    clearInterval(this.timer);
    // The map is written as it stands, the chats with work running used until now: a save still waiting would end with
    // the process (the bug report's H10).
    this.usedUntilNow(this.convs);
    this.#write();
    for (const a of this.agents.values()) {
      try {
        a.close?.();
      } catch {}
    }
    this.agents.clear();
    this.openedWith.clear();
  }

  // Resolves with the finished turn, or with { clientAction, turn } when the agent needs the client's hands first.
  async run(opts) {
    const acp = opts.upstream.acp || {};
    const flat = flattenMessages(opts.format, opts.body);
    const { cwd } = determineCwd(acp, flat, opts.cwdHint);
    const convKey = conversationKey(opts.upstream.id, cwd, flat, opts.conversationId);
    // The SDK runs Cursor's own tools unasked: a turn with a permission switch runs them off, Filament's hands in
    // their place, each call judged by the switch as it stands then (the review of 11-10: a read-only chat on Cursor's
    // SDK still edited and ran commands). Under Auto too: the tool lists hold for the turn, and the person may move the
    // switch while it runs (the re-read of 11-11).
    const turn = new LiveTurn({
      convKey,
      upstreamId: opts.upstream.id,
      clientTools: opts.clientTools || ClientToolset.from(opts.format, opts.body),
      bridge: opts.permits ? "native" : acp.clientBridge || "prompts",
      onEvent: opts.onEvent || (() => {}),
      log: this.log,
      clientWaitMs: Math.max(1, Number(acp.clientWaitMinutes) || 60) * 60000,
      asker: opts.asker || null,
      permits: opts.permits || null,
      toolsAt: opts.toolsAt || null,
      asks: opts.asks || null,
    });
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const at = { flat, convKey, cwd, turn };
    const mine = prev
      .catch(() => {})
      .then(() => this.#runTurn({ ...opts, onEvent: turn.emit }, at))
      .catch((e) =>
        this.retrySeed(e, opts, turn, {
          session: "agent",
          drop: () => {
            const conv = this.convs.get(convKey);
            if (!conv) return;
            this.convs.delete(convKey);
            this.#save();
            this.#leave(conv);
          },
          again: (o) => this.#runTurn({ ...opts, onEvent: turn.emit, ...o }, "body" in o ? { ...at, flat: flattenMessages(opts.format, o.body) } : at),
        }),
      );
    this.turnQueues.set(convKey, mine);
    return this.trackTurn(turn, mine, () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    });
  }

  /**
   * One turn (`#turnOn`): the agent's lock, once the turn takes it, is let go of at its end.
   * @param {any} opts @param {{ flat: any[], convKey: string, cwd: string, turn: LiveTurn }} at
   */
  async #runTurn(opts, at) {
    const held = { release: () => {} };
    try {
      return await this.#turnOn(opts, at, held);
    } finally {
      held.release();
    }
  }

  /**
   * The turn's work (`#runTurn`): `held.release` lets go of the agent's lock once the turn takes it.
   * @param {any} opts @param {{ flat: any[], convKey: string, cwd: string, turn: LiveTurn }} at
   * @param {{ release: () => void }} held
   */
  async #turnOn(
    {
      upstream,
      modelId,
      format,
      body,
      cwdHint,
      headers = {},
      onEvent,
      signal,
      mode: modeOverride = null,
      conversationId = null,
      effort = null,
      resumeSessionId = null,
      context = null,
      bare = false,
    },
    { flat, convKey, cwd, turn },
    held,
  ) {
    const acp = upstream.acp || {};
    this.latestAcp.set(upstream.id, acp);
    onEvent = turn.emit;
    const lastIdx = flat.map((m) => m.role).lastIndexOf("user");
    const last = lastIdx >= 0 ? flat[lastIdx] : { role: "user", text: "Continue." };
    const history = flat.slice(0, lastIdx >= 0 ? lastIdx : flat.length);
    const { source: cwdSource } = determineCwd(acp, flat, cwdHint);
    const notes = [
      `sdk: cwd ${cwd} (${cwdSource})`,
      `sdk: conversation ${convKey} (${conversationId ? "client session id" : "fingerprint of the first message"})`,
    ];
    const reminders = flat.reduce((n, m) => n + (m.reminders || 0), 0);
    if (reminders) notes.push(`sdk: ${reminders} <system-reminder> block(s) from the client removed`);
    const { mod, version } = await this.sdk();
    const { Agent } = mod;
    const apiKey = this.keyOf(upstream);
    // Who the key belongs to (`Cursor.me()`, asked once an hour), for the turn's record: asked beside the turn, never
    // in its way.
    const owner = this.me(upstream).catch(() => null);
    const models = await this.listModels(upstream).catch((e) => {
      notes.push(`sdk: model list unavailable (${e.message.slice(0, 120)})`);
      return { items: [], names: [] };
    });
    const sel = selectSdkModel(modelId, effort, models.items);
    /** The turn's notes as facts, each with its sentence's place in `notes`. @type {{ at: number, note: any }[]} */
    const structured = [];
    if (sel.refused) structured.push({ at: notes.length + sel.refusedAt, note: sel.refused });
    notes.push(...sel.notes);
    if (!sel.selection)
      throw Object.assign(
        new Error(`Cursor offered no models for this API key (${models.items.length} listed)`),
        { code: "SDK_MODEL" },
      );
    // Its two modes, named as the ACP route names an agent's (`MODE_ALIASES`): `ask` runs in its plan mode, never as
    // its agent; a word it has no mode for runs as its agent, said.
    const wantedMode = modeOverride || acp.mode || "agent";
    const resolved = resolveMode(wantedMode, SDK_MODES, MODE_ALIASES);
    const mode = resolved === "plan" ? "plan" : "agent";
    if (modeOverride || !resolved) notes.push(`sdk: mode ${mode}${!resolved ? ` (it has no mode ${wantedMode})` : mode !== wantedMode ? ` (alias of ${wantedMode})` : ""}`);
    const native = turn.bridge === "full" || turn.bridge === "native";
    const strict = turn.permits?.mode?.();
    // Stricter than Auto as the turn begins: what Cursor does by itself is kept to what reads and plans (below).
    const stricter = !!strict && strict !== "auto";
    if (native && turn.permits && (acp.clientBridge || "prompts") !== turn.bridge)
      notes.push(`sdk: Cursor's own shell, read, edit and delete are off in a chat with a permission switch: Filament's hands do that work, each call judged by the switch as it stands then${strict ? ` (${strict} as the turn began)` : ""}`);
    // What is actually in force, for the dashboard's "bridge in force" column and the request record — the SDK was
    // reporting nothing here, so every Cursor conversation rendered as "not run" next to real ACP ones. `native` is
    // the honest label for both configured `full` and `native`: this bridge passes `disallowedTools` for
    // shell/read/edit/delete, so Cursor's built-ins really are off and Filament's custom tools really do the work.
    // The SDK does not store that ban: it goes on create and resume, and a warm handle is loaded again when this
    // turn's list is different. send cannot set it.
    turn.bridgeEffective = turn.bridge === "off" ? "off" : native ? "native" : "prompts";
    // Rung 2 for the SDK, mirroring src/acp.js exactly (see the DUPLICATED LOGIC note below on the catch-up block):
    // `steering` passes Filament's custom tools WITHOUT disallowing Cursor's own, so the agent has a choice, and the
    // first prompt asks it to prefer Filament's. `off` wins here too — it promises the chat client is never involved,
    // and a custom-tool call is routed straight to the client. A knob offered in the dashboard for both upstream types
    // has to work for both, which is the lesson the catch-up gate was late learning.
    const steering = acp.steering === true && !native && turn.bridge !== "off";
    if (acp.steering === true && !steering && !native)
      notes.push(
        `sdk: steering is on but clientBridge is "off", which promises the chat client is never involved — steering was skipped`,
      );
    const toolsOffered = native || steering;
    if (native && !(turn.clientTools?.summary?.() || []).length)
      notes.push(
        `sdk: client bridge ${turn.bridge} but this client declares no tools; Filament's own hands do the work under the permission policy`,
      );
    let conv = this.convs.get(convKey);
    let reused = false,
      seeded = false,
      resumed = false,
      agent = null;
    // Whether THIS turn actually handed Cursor the custom tools. They ride on `agentOpts`, which is only passed to
    // `Agent.create` / `Agent.resume`; an agent already in memory is reused as-is and gets nothing new. Same rule as
    // the ACP bridge, and for the same reason: the record must not claim an offer that never reached the agent.
    let offeredNow = false;
    let archSeed = null; // P7: the archived transcript, when there is one — computed once, at agent creation
    // The compaction this agent's session of the chat stands on, as a harness turn names it (AC5-1, HarnessV4_Tasks
    // A8): the chat's newest, or a newer one of Filament's copy alone that moved it; null for anyone else's request.
    const base = compactionOf(headers, upstream.id);
    if (resumeSessionId && !(conv && String(conv.agentId).startsWith(resumeSessionId))) {
      const l = await this.listSessions(upstream, { format, body, cwdHint });
      const { found, candidates } = l.ok
        ? findSession(l.sessions, resumeSessionId)
        : { found: null, candidates: [] };
      if (!found) {
        notes.push(`sdk: no Cursor agent matches "${resumeSessionId}"; starting a new one`);
        onEvent({
          type: "text",
          text: `⚠ No Cursor agent matches "${resumeSessionId}"${candidates.length > 1 ? ` uniquely` : ""} (Home → Agents lists them). Continuing in a new one.\n\n`,
        });
      } else {
        conv = {
          agentId: found.sessionId,
          upstreamId: upstream.id,
          cwd: found.cwd || cwd,
          turns: 0,
          lastUsed: Date.now(),
          idleMs: Math.max(1, Number(acp.sessionIdleMinutes) || 240) * 60000,
          title: found.title || null,
          resumedFrom: found.sessionId,
          basedOn: base ?? 0,
        };
        this.convs.set(convKey, conv);
        resumed = true;
        notes.push(
          `sdk: resumed Cursor agent ${short(found.sessionId)}${found.title ? ` “${String(found.title).slice(0, 60)}”` : ""}`,
        );
      }
    }
    // An agent standing on a compaction other than the chat's newest gives way (AC5-1): to the agent from before,
    // where an undo brought the chat back to it, else to a fresh one. Once a turn runs on the compacted agent, those
    // from before can no longer come back.
    if (conv && !resumed) {
      const step = moveFor(conv, base);
      if (step.move === "back") {
        notes.push(`sdk: back to agent ${short(step.to.agentId)}, from before the compaction undone (agent ${short(conv.agentId)} let go)`);
        conv = { ...step.to };
        this.convs.set(convKey, conv);
      } else if (step.move === "fresh") {
        notes.push(`sdk: the chat was compacted since agent ${short(conv.agentId)} started: it is let go, and a fresh agent starts from the compaction`);
        this.convs.delete(convKey);
        conv = undefined;
      } else if (step.gone.length) conv.before = null;
      for (const c of step.gone) this.#leave(c);
    }
    // The folder the agent works in: a resumed one's own, where Cursor keeps it (X6).
    const where = conv?.cwd || cwd;
    // Filament's own tools go with every message (AC4-2, AC4-5), so a switch flipped since reaches the agent at once.
    const own = this.#ownTools(turn, upstream, where);
    const graphGiven = !!own[GRAPH_TOOL];
    // A plain chat's agent tool (HarnessV4_Tasks E12 step 2); a lead's own agent tool is its team's.
    const launchGiven = !!own[LAUNCH_TOOL] && !!turn.toolsAt?.launch && !turn.toolsAt?.team;
    const customTools =
      toolsOffered || Object.keys(own).length ? this.#guarded(turn, { ...(toolsOffered ? this.#customTools(turn, upstream, where) : {}), ...own }) : undefined;
    // Its own sub-agents (`task`) off where Filament's agent tool, or its team's, stands in for them (the owner's of 11-10:
    // "have other agents stop from spawning their sub agents"), as Claude Code's are (acp/toolset.js `CLAUDE_OWN_AGENTS`):
    // the SDK takes them off its list (its options' "Disallow `task` to prevent subagents entirely"), at every load.
    const ownHeld = !!own[LAUNCH_TOOL];
    // A chat stricter than Auto starts none either: a sub-agent of Cursor's keeps tools of its own, which neither list
    // reaches and nothing judges (the re-read of 11-11).
    /** Cursor's own tools the turn runs off, by the SDK's names. */
    const wantedOff = [...(native ? CURSOR_OWN_HANDS : []), ...(ownHeld || stricter ? CURSOR_OWN_AGENTS : [])];
    /** The ones a chat stricter than Auto keeps, and no other; both lists go, since an SDK from before `tools` reads only the one of what goes. */
    const wantedKept = stricter ? CURSOR_KEPT : null;
    /** A list as the loaded SDK takes it: a name it said it does not know (`unknownTools`) is in none. @param {readonly string[]} names */
    const taken = (names) => names.filter((n) => !this.unknownTools.has(n));
    // The person's own MCP servers, the card's and the chat's, and the folders the chat adds for reading
    // (HarnessV4_Overnight_Plan OV-D15, OV-D16, OV-D23): Cursor's own options for them, as the agent opens. Another
    // machine's agents' chat (app/acp-turn.js `fenced`) is given none; the SDK loads no settings file of the person's
    // where `local.settingSources` names none. A chat stricter than Auto is given none either: the SDK calls a server's
    // tools itself and asks nobody, so nothing of theirs could be judged, and a server's tool may write or run anything.
    const chat = serversFor(acp, turn.toolsAt?.mcp, { title: "Cursor", http: true, cwd: true, fenced: turn.toolsAt?.agentsChat === true });
    const mcpServers = stricter ? {} : cursorServers(chat.servers);
    const dirs = Array.isArray(turn.toolsAt?.dirs) ? [...turn.toolsAt.dirs] : [];
    // The fence too: the card's servers go with it, and their key alone says nothing of them — Full control switched
    // either way loads the agent again with what it takes now.
    const fenced = turn.toolsAt?.agentsChat === true;
    /** What the agent opens with, as the lists stand now, and the word kept of it (`openedWith`). */
    const openWith = () => {
      const off = taken(wantedOff);
      const kept = wantedKept ? taken(wantedKept) : null;
      return {
        ban: JSON.stringify({ tools: off, ...(kept ? { kept } : {}), mcp: stricter ? null : chat.key, dirs, ...(fenced ? { fenced } : {}) }),
        opts: {
          apiKey,
          model: sel.selection,
          mode,
          local: { cwd: where, ...(dirs.length ? { dirs } : {}), ...(customTools ? { customTools } : {}) },
          ...(kept ? { tools: kept } : {}),
          ...(off.length ? { disallowedTools: off } : {}),
          ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        },
      };
    };
    /**
     * The agent opened — resumed or created (`how`) — with the turn's lists. A name the SDK refuses is one it does not
     * know (`unknownToolNames`): that name, and each other of the turn's its refusal lists no place for, is left out
     * from then on, and the agent is opened once more. What was left out is said on the turn's record at every open.
     * @param {(opts: any) => Promise<any>} how
     */
    const open = async (how) => {
      const wanted = [...(wantedKept || []), ...wantedOff];
      let again = false;
      /** @type {any} */
      let opened;
      try {
        opened = await how(openWith().opts);
      } catch (e) {
        const said = unknownToolNames(e);
        const fresh = said ? taken(wanted).filter((n) => said.unknown.includes(n) || (!!said.valid && !said.valid.includes(n))) : [];
        if (!fresh.length) throw e;
        for (const n of fresh) this.unknownTools.add(n);
        again = true;
        opened = await how(openWith().opts);
      }
      const left = wanted.filter((n) => this.unknownTools.has(n));
      if (left.length)
        notes.push(`sdk: this @cursor/sdk (${version}) knows no tool named ${left.join(", ")}: Cursor is neither given nor kept from a tool by a name it does not know${again ? ", and the agent was opened once more without them" : ""}`);
      return opened;
    };
    /** What a chat stricter than Auto keeps from Cursor, and why: its servers by their names, its tools by what stays. */
    const withheld = () => {
      const names = chat.servers.map((s) => s.name);
      const kept = taken(CURSOR_KEPT).filter((n) => n !== "mcp");
      return [
        ...(names.length
          ? [`sdk: the MCP server${names.length === 1 ? ` ${names[0]} is` : `s ${names.join(", ")} are`} not given to Cursor while the chat's permission is ${strict}: its SDK calls a server's tools unasked, and nothing of theirs could be judged. In Auto it is given ${names.length === 1 ? "it" : "them"}`]
          : chat.words),
        `sdk: the chat's permission is ${strict}: of its own tools Cursor keeps the ones that read and plan (${kept.join(", ")}); its sub-agents (task), which keep tools of their own, and every other are off`,
      ];
    };
    /** What the agent was given of the chat's, and what was kept from it, said as it opens. */
    const givenWords = () => [...(stricter ? withheld() : chat.words), ...(dirs.length ? [`sdk: Cursor is given the chat's added folder${dirs.length === 1 ? "" : "s"} to read: ${dirs.join(", ")}`] : [])];

    if (conv) {
      agent = this.agents.get(conv.agentId) || null;
      if (agent && this.openedWith.get(conv.agentId) !== openWith().ban) {
        notes.push(`sdk: what agent ${short(conv.agentId)} was opened with changed (its tool ban, the chat's own MCP servers or added folders, or another machine's agents' fence); loading it again so the change applies`);
        try {
          agent.close?.();
        } catch {}
        this.agents.delete(conv.agentId);
        this.openedWith.delete(conv.agentId);
        agent = null;
      }
      if (!agent) {
        try {
          onEvent({ type: "step", step: "resuming" });
          const id = conv.agentId;
          agent = await open((o) => Agent.resume(id, o));
          offeredNow = true;
          notes.push(...givenWords());
          this.agents.set(conv.agentId, agent);
          this.openedWith.set(conv.agentId, openWith().ban);
          this.#op(`resumed a Cursor agent on ${upstream.id} (${short(conv.agentId)})`, {
            sub: "resume",
            detail: { upstream: upstream.id, agentId: short(conv.agentId) },
            ref: { upstreamId: upstream.id, sessionId: conv.agentId },
          });
          if (!resumed) notes.push(`sdk: agent ${short(conv.agentId)} loaded again`);
        } catch (e) {
          notes.push(
            `sdk: could not resume agent ${short(conv.agentId)} (${e.message.slice(0, 120)}); starting a new one`,
          );
          this.convs.delete(convKey);
          conv = null;
        }
      }
      if (conv) reused = true;
    }
    let created = false;
    if (!conv) {
      const title =
        String(last.text || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60) || "Filament chat";
      onEvent({ type: "step", step: "opening" });
      agent = await open((o) => Agent.create({ ...o, name: title }));
      offeredNow = true;
      notes.push(...givenWords());
      this.#op(`started a Cursor agent on ${upstream.id} (${short(agent.agentId)})`, {
        sub: "new",
        detail: { upstream: upstream.id, agentId: short(agent.agentId), mode: mode || null },
        ref: { upstreamId: upstream.id, sessionId: agent.agentId },
      });
      conv = {
        agentId: agent.agentId,
        upstreamId: upstream.id,
        cwd: where,
        turns: 0,
        lastUsed: Date.now(),
        idleMs: Math.max(1, Number(acp.sessionIdleMinutes) || 240) * 60000,
        modelId: sel.selection.id,
        mode,
        title,
        basedOn: base ?? 0,
        // Fresh until a message of the person's goes out to it: a turn stopped before then leaves the next to seed it
        // (the bug report's L21).
        fresh: true,
      };
      this.convs.set(convKey, conv);
      this.agents.set(agent.agentId, agent);
      this.openedWith.set(agent.agentId, openWith().ban);
      created = true;
    }
    // A harness chat's, whose turns name its compaction: its record outlives idleness (`idleStep`).
    if (base != null) conv.harness = true;
    if (conv.fresh) {
      // P7, mirroring the ACP bridge: an outside client's new agent asks the archive first, so a client that compacted
      // down to just the newest message still seeds it. Its `history` is empty in that case and a body-only check would
      // seed nothing. A harness chat's seed is the request's own history instead (AC5-1, AC-R1): the harness's
      // composition of the whole chat, as its line and any compaction left it.
      archSeed =
        !bare && base == null && acp.seedHistory !== false && acp.seedFromArchive !== false
          ? this.#archivedSeed(
              { format, body, headers, cwdHint, model: body?.model || "" },
              acp,
              last.text || "",
            )
          : null;
      seeded = !bare && acp.seedHistory !== false && (archSeed != null || history.some((m) => m.role !== "system"));
      if (bare) notes.push("sdk: the earlier conversation was too long for the agent (overflow): this new agent goes on without it");
    }
    const seed = seeded ? (archSeed ? `, seeded from Filament's archive (${archSeed.turns} turn${archSeed.turns === 1 ? "" : "s"})` : `, seeded with ${history.filter((m) => m.role !== "system").length} earlier messages`) : "";
    if (created) notes.push(`sdk: new Cursor agent ${short(conv.agentId)}${seed}`);
    else if (!resumed) notes.push(`sdk: agent ${short(conv.agentId)} reused (turn ${conv.turns + 1})${seed}`);
    // Two chats can share one agent (each resumed it): the turn takes it once the turn running on it has ended. A send
    // meanwhile finds the agent busy, and the forced send that recovers a wedged agent expires the run in progress,
    // the other chat's (the bug report's X5). A stop while it waits ends it there.
    held.release = await this.lockSession(conv.agentId, signal);
    if (signal?.aborted)
      return { text: "", tools: [], stopReason: "cancelled", sessionId: conv.agentId, reused, seeded, resumed, cwd: where, notes, bridge: turn.bridgeEffective ?? null, steering: !!conv.steering };
    turn.sessionId = conv.agentId;
    turn.conv = conv;
    turn.notes = notes;
    this.takeSession(conv.agentId, turn, onEvent);
    if (offeredNow) conv.steering = steering;
    if (native)
      notes.push(
        `sdk: native toolset: Cursor's read, edit, shell and delete are replaced by Filament's Read, Write, Edit, Bash and Delete running through the client (${turn.clientTools.summary().join(", ") || "no client tools: Filament's own hands"})`,
      );
    // `conv.steering` is the SESSION's truth; `steering` is what the config asks for now. They differ exactly when
    // steering was switched on mid-conversation, and the record has to say which is which rather than claim an offer
    // that never reached the agent.
    else if (conv.steering)
      notes.push(
        `sdk: steering (Rung 2 experiment): Filament's tools were offered ALONGSIDE Cursor's own built-ins, with an instruction to prefer them. Cursor may ignore it — the leak rate on this request says how often it did. Executed by ${turn.clientTools.summary().join(", ") || "no client tools: Filament's own hands"}`,
      );
    else if (steering)
      notes.push(
        `sdk: steering is switched on, but this Cursor agent was created before it, so it was never offered Filament's tools or the instruction — there is nothing to measure yet. It takes effect on the next new agent (a new chat starts one).`,
      );
    notes.push(`sdk: @cursor/sdk ${version}, in-process, billed to the Cursor plan behind the API key`);

    // Prompt: the newest message, plus what this agent missed (seeding a new agent, catching up after a detour) and
    // Filament's context (AC4-1) — composed as the ACP agents' are. Cursor has no system channel: the standing context
    // goes ahead of the first prompt, and what changes ahead of the next.
    conv.given = stateOf(conv.given);
    // A lead's envelope tool goes with its team's (HarnessV4_Envelopes_Plan EN3).
    const has = givenTools({ graph: graphGiven, launch: launchGiven, team: !!turn.toolsAt?.team && !!own[ENVELOPES_TOOL], skills: !!own[SKILLS_TOOL] });
    const standing = standingFor(context, has, ownHeld);
    const recall = promptFor(context, has, seeded);
    const update = context ? contextUpdate(conv.given, standing) : null;
    const { promptText, userTurns, command, steered, skipped, held: heldIds } = composePrompt({
      acp,
      flat,
      history,
      last,
      conv,
      reused,
      resumed,
      seeded,
      archSeed,
      notes,
      who: "sdk",
      tried: earlierTriesOf(headers),
      seen: seenOf(headers),
      composed: seeded && base != null ? base : null,
      // A harness chat's history whole, for its seed and its catch-up (HarnessV4_Tasks A7).
      whole: base != null ? () => flattenMessages(format, body, { whole: true }).slice(0, history.length) : null,
      context: context ? { update, prompt: recall } : null,
    });
    const given = givenRecord({ opened: null, update, recall: recall.filter((b) => !heldIds.includes(b.id)), held: heldIds });
    if (given && givenSays(given)) notes.push(givenNote("sdk", given));
    const images = extractImages(format, body)
      .map((i) => (i.data ? { data: i.data, mimeType: i.mimeType } : { url: i.uri }))
      .filter((i) => i.data || i.url);
    if (images.length) notes.push(`sdk: ${images.length} image(s) attached`);

    const out = {
      text: "",
      tools: [],
      stopReason: null,
      sessionId: conv.agentId,
      reused,
      seeded,
      resumed,
      cwd: where,
      notes,
      structured,
      linesAdded: 0,
      linesRemoved: 0,
      bridge: turn.bridgeEffective ?? null,
      steering: !!conv.steering,
      // Filament's envelope tool went with the message, one of the agent's own (EN3): without it a result comes whole.
      opensEnvelopes: has(ENVELOPES_TOOL),
      // The model asked for until Cursor says which ran, and the key's owner once Cursor says who: a turn that fails
      // keeps them (HarnessV3-ACP AC2-5).
      agentModel: sel.selection.id,
      /** @type {any} */ account: null,
      ...(given ? { given } : {}),
    };
    void owner.then((me) => {
      const identity = cursorIdentity(me);
      if (identity) out.account = accountRecord(identity, [], this.meCache.get(apiKey)?.at || Date.now());
    });
    let answered = false;
    /** @param {any} ev */
    const heard = (ev) => {
      if (ev?.type === "text" || ev?.type === "thought" || ev?.type === "tool") answered = true;
      return onEvent(ev);
    };
    const ctx = { onEvent: heard, out, turn, conv, tools: new Map(), parent: null };
    let run = null;
    // A stop cancels the run where it takes a cancel, else lets go of it (`runEnd`) — and ends the commands Filament's
    // hands run for the turn (`#commands`): Cursor's cancel ends its run, and knows nothing of them.
    const ending = runEnd();
    turn.cancel = () => {
      this.#stopCommands(turn);
      return ending.stop(run);
    };
    const onAbort = () => {
      turn.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    /** Settles once: the turn's run exists (true), or the turn ended before it did (false). */
    let runCame = /** @type {(came: boolean) => void} */ (() => {});
    /** @type {Promise<boolean>} */
    const runUp = new Promise((r) => (runCame = r));
    try {
      // A stop or a hang-up while the agent was being readied: the message never goes out.
      if (signal?.aborted) {
        out.stopReason = "cancelled";
        return out;
      }
      // The turn's run starts here (HarnessV3-ACP AC1-1): the agent is up, a stop reaches it, nothing of this turn has
      // come yet. The SDK sends no raw messages. The turn's facts go with it, as they stand: a turn that fails keeps
      // them (AC2-5).
      // The reader notes where the working tree stands before the agent hears the message; a stop meanwhile ends here.
      // The person's words into the running turn (HarnessV4_Tasks B14): Cursor's SDK takes them itself (`Run.steer`) —
      // into the turn where it still can (`complete_delivered`), else handed back to go as the next message
      // (`revert_to_followup`), as they are from an SDK whose runs have no steer. The way in is handed over as the
      // session opens, before the run exists: words sent first wait for it (`runUp`). What the turn takes, the
      // session has (`countTaken`), so the next prompt does not tell it again.
      const steer = {
        at: /** @type {const} */ ("live"),
        send: countTaken(conv, userTurns, async (/** @type {string} */ text) => (await runUp) && typeof run?.steer === "function" && (await run.steer(text)) === "complete_delivered"),
      };
      await onEvent({ type: "session", sessionId: conv.agentId, cwd: where, rawMessages: false, facts: out, steer });
      if (signal?.aborted) {
        out.stopReason = "cancelled";
        return out;
      }
      // The model the agent runs, its parameters with it: a summary it writes later runs on the same (AC5-4).
      conv.selection = sel.selection;
      // A message with none of Filament's tools to give says so to an agent that holds some: an empty set, so a tool
      // the session no longer has (the task graph, the agent tool taken away) goes at once.
      const toolsNow = customTools || (this.holdsTools.has(agent) ? {} : null);
      if (customTools) this.holdsTools.add(agent);
      else this.holdsTools.delete(agent);
      const sendOpts = {
        model: sel.selection,
        mode,
        onDelta: ({ update }) => (ending.gone ? undefined : this.#update(update, ctx)),
        ...(toolsNow ? { local: { customTools: toolsNow } } : {}),
      };
      const message = images.length ? { text: promptText, images } : promptText;
      // The agent has what the message carries once it goes out: a turn stopped before this told it nothing, and the
      // next tells it again (the bug report's L21). A send that throws never started a run, so the mark is taken back.
      // A run that starts and then fails stays heard. A startup error the SDK marks retryable is tried once more.
      const heardBefore = { seenUserTurns: conv.seenUserTurns, heard: conv.heard ? [...conv.heard] : undefined, fresh: conv.fresh };
      const restoreHeard = () => {
        if (heardBefore.seenUserTurns === undefined) delete conv.seenUserTurns;
        else conv.seenUserTurns = heardBefore.seenUserTurns;
        if (heardBefore.heard === undefined) delete conv.heard;
        else conv.heard = [...heardBefore.heard];
        if (heardBefore.fresh) conv.fresh = true;
        else delete conv.fresh;
      };
      const wedgedRun = (e) => e?.name === "AgentBusyError" || /busy|active run|already running|wedged/i.test(String(e?.message));
      const deliver = async (opts) => {
        try {
          return await agent.send(message, opts);
        } catch (e) {
          if (!wedgedRun(e)) throw e;
          notes.push(
            `sdk: a previous run was still marked active (${String(e.message).slice(0, 80)}); expired it and continued`,
          );
          return await agent.send(message, { ...opts, local: { ...(opts.local || {}), force: true } });
        }
      };
      told(conv, { userTurns, command, skipped });
      try {
        try {
          run = await deliver(sendOpts);
        } catch (e) {
          if (e?.isRetryable === true && !signal?.aborted) {
            notes.push(`sdk: the run never started (${String(e.message).slice(0, 80)}); retrying once`);
            run = await deliver(sendOpts);
          } else throw e;
        }
      } catch (e) {
        restoreHeard();
        throw e;
      }
      runCame(true);
      if (run?.id) notes.push(`sdk: run ${run.id}`);
      // The message is out: the turn says so until the agent's first word (HarnessV3-FailurePoints §5.1 item 2).
      onEvent({ type: "step", step: "sent" });
      // A stop while the run was being created had no run to cancel yet.
      if (signal?.aborted) await turn.cancel();
      const result = await ending.of(run);
      // Billing: the run's usage sums every model call of the turn, else the calls' own counts added up (`turn-ended`):
      // a run that fails after some keeps what they spent.
      const u = result?.usage || ctx.turnUsage;
      if (u && typeof u === "object") out.usage = runUsage(u);
      if (result?.status === "error") throw new Error(result.error?.message || "the Cursor run failed");
      out.stopReason = result?.status === "cancelled" ? "cancelled" : "end_turn";
      if (!out.text && typeof result?.result === "string" && result.result) {
        out.text = result.result;
        onEvent({ type: "text", text: result.result });
      } // no deltas arrived: deliver the final text
      // Context meter: the SDK gives no per-call prompt size, but it streams `token-delta` for everything appended to
      // the context (model output, tool results such as files read). The meter is Cursor's base prompt, calibrated
      // on the agent's first turn, plus everything appended since; Cursor's own compaction shrinks it.
      const appended = ctx.appended || 0;
      if (conv.contextBase == null)
        conv.contextBase = Math.min(150000, Math.max(4000, (u?.inputTokens || 0) - appended));
      const used = cursorContext(conv, ctx);
      conv.contextAppended = used - conv.contextBase;
      out.context = {
        used,
        size: null,
        cacheRead: 0,
        estimated: true,
        appended,
        compacted: !!ctx.compacted,
      };
      if (ctx.compacted) notes.push("sdk: Cursor compacted its own context during this turn");
      out.agentModel = run?.model?.id || agent.model?.id || sel.selection.id;
      await owner;
      conv.turns++;
      conv.lastUsed = Date.now();
      conv.modelId = out.agentModel || conv.modelId;
      conv.mode = mode;
      // What the prompt said is the session's — unless Cursor compacted after it, and its summary may have dropped it
      // (AC-R4).
      if (update) said(conv.given, standing, update, !!ctx.compacted);
      if (steered && !ctx.compacted) conv.steerSaid = true;
      this.#save();
      return out;
    } catch (e) {
      // A run whose wait threw keeps what its model calls said they spent (`turn-ended`), as one that ended in an error
      // does: no result of the run's came to say it.
      if (!out.usage && ctx.turnUsage) out.usage = runUsage(ctx.turnUsage);
      // The chat is idle from its turn's end, a failed turn's too (the bug report's H8): idle from before the turn, a
      // sweep would take the agent a "continue" goes on in.
      conv.lastUsed = Date.now();
      this.#save();
      // A seeded first prompt refused before any answer may go again, its seed compacted or none (`retrySeed`).
      if (seeded && !answered && !bare && e && typeof e === "object") e.seededUnanswered = true;
      throw e;
    } finally {
      runCame(false);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Whether the bridge keeps an agent for a harness chat (HarnessV4_Tasks C26): the one the chat's next turn goes on
   * in, held here or resumed by its id. False where it keeps none — the chat never ran on Cursor, its record is gone,
   * or the chat was compacted under it since (`base`) — so that turn creates a new agent, seeded from the harness's
   * composition of the chat. One whose prompts were Cursor's own commands alone (`heard`) is held: its next prompt
   * goes on in it with its seed (the hunt of 11-08).
   * @param {import("../../core/ports.js").AgentChat} where
   */
  holds(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return !!conv && (!conv.fresh || !!conv.heard?.length) && moveFor(conv, where.base ?? null).move !== "fresh";
  }
  /**
   * How Cursor can write Filament's summary of a harness chat (HarnessV3-ACP AC5-4): in the chat's agent itself, as
   * Filament holds it or resumes it (`closed`) — the SDK forks none — which stays behind for Undo. Null with no such
   * agent, or one the chat's next turn leaves (`base`: an undo, or a compaction since, the bug report's L28).
   * @param {import("../../core/ports.js").AgentChat} where
   * @returns {"session" | null}
   */
  summarizes(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return conv?.selection && !conv.fresh && moveFor(conv, where.base ?? null).move === "stay" ? "session" : null;
  }
  /**
   * Whether Cursor's summary resumes the chat's agent first (HarnessV4_Tasks C33): Filament holds none in memory now —
   * it restarted, or the idle agent was let go — and Cursor resumes one by its id.
   * @param {import("../../core/ports.js").AgentChat} where
   */
  closed(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return this.summarizes(where) != null && !!conv && !this.agents.has(conv.agentId);
  }
  /** A harness chat's conversation, keyed as `run` keys its turns. @param {{ upstream: any, cwdHint?: string | null, conversationId: string }} where */
  #chatKey({ upstream, cwdHint, conversationId }) {
    return conversationKey(upstream.id, determineCwd(upstream.acp || {}, [], cwdHint).cwd, [], conversationId);
  }
  /**
   * Cursor writes Filament's summary of a harness chat (HarnessV3-ACP AC5-4), prompted with `instruction`, after the
   * chat's turns: in the chat's agent, on the model its turns ran, in its plan mode, which changes nothing — the
   * tools a turn gave it refusing their calls meanwhile (`#guarded`). No clock ends it (HarnessV3-FailurePoints §4 B): a
   * stop does.
   * @param {{ upstream: any, cwdHint?: string | null, conversationId: string, instruction: string, signal?: AbortSignal | null }} o
   * @returns {Promise<import("../../core/ports.js").AgentSummary>}
   */
  summarize(o) {
    const convKey = this.#chatKey(o);
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => this.#summarize(o, convKey));
    this.turnQueues.set(convKey, mine);
    const done = () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    };
    mine.then(done, done);
    return mine;
  }
  /**
   * @param {{ upstream: any, instruction: string, signal?: AbortSignal | null }} o
   * @param {string} convKey
   * @returns {Promise<import("../../core/ports.js").AgentSummary>}
   */
  async #summarize({ upstream, instruction, signal = null }, convKey) {
    const conv = this.convs.get(convKey);
    if (!conv?.selection || conv.fresh) throw new Error("Cursor holds no agent of this chat to write the summary in");
    // None in memory: the chat's agent is resumed for the summary alone — no tools of a turn's, in the mode that
    // changes nothing — and let go after it, so the chat's next turn opens it with the tools that turn gives.
    const held = this.agents.get(conv.agentId) || null;
    const agent = held || (await (await this.sdk()).mod.Agent.resume(conv.agentId, { apiKey: this.keyOf(upstream), model: conv.selection, mode: "plan", local: { cwd: conv.cwd } }));
    if (!held)
      this.#op(`resumed a Cursor agent on ${upstream.id} for Filament's summary (${short(conv.agentId)})`, {
        sub: "resume",
        detail: { upstream: upstream.id, agentId: short(conv.agentId) },
        ref: { upstreamId: upstream.id, sessionId: conv.agentId },
      });
    let text = "";
    /** @type {any} */
    let run = null;
    // A stop cancels the run where it takes a cancel, else lets go of it (`runEnd`).
    const ending = runEnd();
    const cancel = () => ending.stop(run);
    const onAbort = () => void cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    // Another chat's turn on the agent (each resumed it) ends first: the send would find the agent busy, and while it
    // writes, the tools of a turn on it refuse their calls (the bug report's X5).
    const release = await this.lockSession(conv.agentId, signal);
    this.writing.add(conv.agentId);
    try {
      if (signal?.aborted) throw new Error("stopped before Cursor was asked");
      run = await agent.send(instruction, {
        model: conv.selection,
        mode: "plan",
        onDelta: (/** @type {any} */ { update }) => {
          // The agent's own words: a sub-agent's come inside its call's updates.
          if (update?.type === "text-delta") text += update.text || "";
        },
      });
      // A stop while the run was being created had no run to cancel yet.
      if (signal?.aborted) await cancel();
      const result = await ending.of(run);
      if (signal?.aborted || result?.status === "cancelled") throw new Error("stopped while Cursor wrote the summary");
      if (result?.status === "error") throw new Error(result.error?.message || "the Cursor run failed");
      return {
        text: text || (typeof result?.result === "string" ? result.result : ""),
        how: "session",
        usage: runUsage(result?.usage),
      };
    } finally {
      this.writing.delete(conv.agentId);
      release();
      signal?.removeEventListener("abort", onAbort);
      if (!held) {
        try {
          agent.close?.();
        } catch {}
      }
    }
  }
  /**
   * A turn's custom tools, each refusing its call while the agent writes Filament's summary (HarnessV3-ACP AC5-4): the
   * agent keeps the tools a turn gave it into the summary's run.
   * @param {LiveTurn} turn @param {Record<string, any>} tools
   * @returns {Record<string, any>}
   */
  #guarded(turn, tools) {
    const refused = { content: [{ type: "text", text: WRITING_REFUSAL }], isError: true };
    return Object.fromEntries(
      Object.entries(tools).map(([name, t]) => [name, { ...t, execute: (/** @type {any} */ a) => (this.writing.has(String(turn.sessionId)) ? refused : t.execute(a)) }]),
    );
  }

  // One streaming update from the SDK -> the same events the ACP bridge emits (text, thought, tool, plan, subagent).
  #update(update, ctx) {
    const { onEvent, out, turn, tools } = ctx;
    if (!update || typeof update !== "object") return;
    switch (update.type) {
      case "text-delta":
        // A sub-agent's own words are its card's and its thread's (`subagent`: the call it is), never the turn's answer.
        if (ctx.parent) return void onEvent({ type: "text", text: update.text || "", subagent: ctx.parent });
        out.text += update.text || "";
        onEvent({ type: "text", text: update.text || "" });
        return;
      case "thinking-delta":
        if (ctx.parent) return void onEvent({ type: "thought", text: update.text || "", subagent: ctx.parent });
        onEvent({ type: "thought", text: update.text || "" });
        return;
      case "tool-call-started":
      case "partial-tool-call": {
        const tc = update.toolCall || {};
        if (tools.has(update.callId) && update.type === "partial-tool-call") return;
        // Cursor's to-do list is drawn from the call's result, the list whole: its update may name only what changed. A
        // sub-agent waits for its call to start, when its prompt is whole.
        if (tc.type === "updateTodos" || (tc.type === "task" && update.type === "partial-tool-call")) return;
        const d = describeSdkTool(tc);
        if (!d) return;
        // The sub-agent is the call itself (`call`): its id is the call's, and the call's own updates follow. It reads
        // as its task in a few words, with its prompt, its kind and the model its parent picked.
        if (tc.type === "task")
          onEvent({
            type: "subagent",
            state: "spawned",
            id: update.callId,
            call: true,
            name: tc.args?.description || "",
            description: tc.args?.prompt || "",
            kind: tc.args?.subagentType,
            model: tc.args?.model,
          });
        const routed = this.#routed(tc);
        const rec = {
          id: update.callId,
          title: d.title,
          kind: d.kind,
          status: update.type === "partial-tool-call" ? "pending" : "in_progress",
          routed,
        };
        tools.set(update.callId, rec);
        out.tools.push(rec);
        onEvent({ type: "tool", phase: "call", ...rec, ...imageOf(tc), ...mcpToolOf(tc, this.agentTools), ...shellOf(tc), ...commandOf(tc, update.type), ...filesOf(tc, update.type), parentToolCallId: ctx.parent || null });
        return;
      }
      case "tool-call-completed": {
        const tc = update.toolCall || {};
        if (tc.type === "updateTodos") {
          // The list as Cursor keeps it after the update (its result); an update that failed changed nothing.
          const r = tc.result;
          const entries = planEntries(r ? (r.status === "success" ? r.value?.todos : null) : tc.args?.todos);
          // A sub-agent's list is its own, as its words are: on its card (HarnessV3-ACP AC3-4), never the turn's
          // checklist or the client's.
          if (entries.length) onEvent(ctx.parent ? { type: "plan", entries, subagent: ctx.parent } : { type: "plan", entries, bridged: turn.bridgePlan(entries) || undefined });
          return;
        }
        const d = describeSdkTool(tc);
        const rec =
          tools.get(update.callId) ||
          (d ? { id: update.callId, title: d.title, kind: d.kind, status: "in_progress" } : null);
        if (!rec) return;
        const res = tc.result;
        const failed = !!res && res.status && res.status !== "success";
        rec.status = failed ? "failed" : "completed";
        if (!tools.has(update.callId)) {
          tools.set(update.callId, rec);
          out.tools.push(rec);
        }
        const ev = {
          type: "tool",
          phase: "update",
          id: update.callId,
          title: rec.title,
          kind: rec.kind,
          status: rec.status,
          routed: this.#routed(tc) || !!rec.routed,
          ...imageOf(tc),
          ...mcpToolOf(tc, this.agentTools),
          ...shellOf(tc),
          ...filesOf(tc, update.type),
          parentToolCallId: ctx.parent || null,
        };
        const val = res?.value || {};
        if (tc.type === "shell")
          ev.terminalOutput = {
            output: [val.stdout, val.stderr].filter((x) => x && String(x).trim()).join("\n"),
            exitCode: typeof val.exitCode === "number" ? val.exitCode : failed ? 1 : null,
          };
        if (tc.type === "edit" || tc.type === "write") {
          if (typeof val.diffString === "string" && val.diffString.trim()) ev.diffText = val.diffString;
          if (typeof val.linesAdded === "number") out.linesAdded += val.linesAdded;
          if (typeof val.linesRemoved === "number") out.linesRemoved += val.linesRemoved;
          if (tc.type === "write" && typeof val.linesCreated === "number") out.linesAdded += val.linesCreated;
        }
        if (failed && res?.error) ev.error = String(res.error?.message || res.error).slice(0, 200);
        if (tc.type === "generateImage" && !failed && typeof val.filePath === "string" && val.filePath) ev.file = val.filePath;
        if (tc.type === "task") onEvent({ type: "subagent", state: "completed", id: update.callId });
        onEvent(ev);
        return;
      }
      case "tool-call-delta": {
        if (update.taskUpdate) this.#update(update.taskUpdate, { ...ctx, parent: update.callId });
        return;
      }
      case "turn-ended":
        ctx.turnCount = (ctx.turnCount || 0) + 1;
        // What the turn's own model calls spent, each one's count added: the run's usage where Cursor names none.
        if (update.usage && !ctx.parent) ctx.turnUsage = plusRunUsage(ctx.turnUsage, update.usage);
        // The meter while Cursor works (HarnessV3-ACP AC3-5): the estimate at each model call's end, once the
        // conversation's base is calibrated (its first turn's end) — the turn's own context, never a sub-agent's. With
        // it, that call's prompt as Cursor counted it (`call`): the session's last request, as Codex's newest call is,
        // its cache counts those its usage carried.
        if (!ctx.parent) {
          const cu = update.usage;
          const call = cu ? { input: Number(cu.inputTokens) || 0, ...(cu.cacheReadTokens != null ? { cacheRead: Number(cu.cacheReadTokens) || 0 } : {}), ...(cu.cacheWriteTokens != null ? { cacheWrite: Number(cu.cacheWriteTokens) || 0 } : {}) } : null;
          const calibrated = ctx.conv?.contextBase != null;
          if (calibrated || call) onEvent({ type: "usage", ...(calibrated ? { usage: { used: cursorContext(ctx.conv, ctx) }, estimated: true } : {}), ...(call ? { call } : {}) });
        }
        return;
      case "token-delta":
        ctx.appended = (ctx.appended || 0) + (Number(update.tokens) || 0);
        return;
      case "user-message-appended":
        ctx.appended = (ctx.appended || 0) + estimateTokens(update.userMessage?.text || "");
        return;
      // Cursor compacting its own context, its start and its end, as the compaction mark draws them (AC2-1). A
      // sub-agent's is its own. Each by an id of its own across the process: one Filament turn may send several prompts
      // (a wake's), each with a context of its own, and a compaction comes back once by its id (acp-turn.js
      // `compactedAfter`; the hunt of c-compact, sa_014723a3).
      case "summary-started":
        if (ctx.parent) return;
        ctx.summary = `summary-${++summaryIds}`;
        onEvent({ type: "compaction", id: ctx.summary, state: "started" });
        return;
      // One whose summary failed (`failed`, the SDK's from 1.2.0) left the context as it was: nothing compacted. Its id
      // goes with its end: a next one whose start comes unsaid has its own.
      case "summary-completed": {
        if (ctx.parent) return;
        const id = ctx.summary || `summary-${++summaryIds}`;
        ctx.summary = null;
        if (update.failed === true) {
          onEvent({ type: "compaction", id, state: "failed" });
          return;
        }
        ctx.compacted = true;
        if (ctx.conv) agentCompacted(ctx.conv);
        onEvent({ type: "compaction", id, state: "completed" });
        return;
      }
      default:
        return;
    }
  }

  // P7 (§11.1–11.2): the archived version of this conversation, for seeding a NEW Cursor agent. Mirrors
  // AcpBridge.#archivedSeed — see the DUPLICATED LOGIC note at the seed site for why both exist.
  // Returns null whenever there is nothing to seed from, and never throws: a memory failure must not stop a turn.
  #archivedSeed({ format, body, headers, cwdHint, model }, acp, newestText) {
    if (typeof this.archivedTranscript !== "function") return null;
    try {
      return (
        this.archivedTranscript(
          { format, body, headers: headers || {}, cwdHint: cwdHint || "", model: model || "", newestText },
          {
            view: acp.seedView || "chat",
            budgetTokens: Number(acp.seedBudgetTokens) > 0 ? Number(acp.seedBudgetTokens) : 0,
          },
        ) || null
      );
    } catch (e) {
      this.log("warn", `[sdk] archived seed unavailable (${e.message.slice(0, 120)})`);
      return null;
    }
  }
  // Filament's replacements for Cursor's read / edit / shell / delete: through the chat client's tools when the live
  // turn has them, otherwise Filament's own hands under the upstream's permission policy. Custom tools never trigger
  // Cursor's own approval flow, so the policy here is the one that counts.
  /**
   * Whether a call went to one of Filament's file tools (the leak rate's "routed"). Cursor reports a call to an injected
   * toolset as type "mcp" — and that includes MCP servers the USER attached via acp.mcpServers, which are not
   * Filament's and count as leaks. The SDK surfaces its own custom tools under the synthetic provider id
   * "custom-user-tools" (see @cursor/sdk's custom-tools typings), so that is the discriminator — matching on
   * `type === "mcp"` alone understated the leak rate. Memory's tools and the task graph's are Filament's too, but stand
   * in for no file tool.
   * @param {any} tc
   */
  #routed(tc) {
    return tc.type === "mcp" && tc.args?.providerIdentifier === "custom-user-tools" && !this.agentTools?.has(String(tc.args?.toolName || ""));
  }

  /**
   * Filament's own tools as Cursor's custom tools (HarnessV3-ACP AC4-2, AC4-5): memory's while their switch is on — not
   * in a chat Memory settings leave out (D4 of 11-01) — the task graph's while the session's is, a graph task's report for
   * a sub-agent on one (AC6-1), ask_lead for a team's
   * worker whose lead reads along (HarnessV3-TaskGraph-v2 TG2-D49), a team's tools while the agent leads the session's
   * team (AC6-3), the visual tools in a chat that shows them (HarnessV4_Visuals_Plan E16). A call stands where the
   * turn running in the agent stands as it is made, and finds the agent's call it answers by its name (`callOf`), as
   * one over Filament's MCP server does: the agent keeps the tools it was created with, past this turn. Where the
   * agent's session holds no turn (one that ended long ago is forgotten), the call stands where the turn that gave the
   * tools did, save its caller, whom no turn places: memory's tools keep to the project's sessions then.
   * @param {LiveTurn} turn @param {any} upstream @param {string} cwd
   * @returns {Record<string, { description: string, inputSchema: any, execute: (a: any) => Promise<any> }>}
   */
  #ownTools(turn, upstream, cwd) {
    const tools = this.agentTools;
    if (!tools) return {};
    /** @returns {import("../../core/ports.js").AgentToolCtx} */
    const at = () => {
      const held = this.turns.get(turn.sessionId);
      const now = held || turn;
      const live = now.done ? null : now;
      return { cwd, upstream: upstream.id, chain: now.toolsAt?.chain ?? null, turn: live?.toolsAt?.turn ?? null, graph: !!now.toolsAt?.graph, report: !!now.toolsAt?.report, asksLead: now.toolsAt?.asksLead || null, team: !!now.toolsAt?.team, launch: !!now.toolsAt?.launch && !now.toolsAt?.team, held: !!now.toolsAt?.launch && !now.toolsAt?.team, reads: !!now.toolsAt?.team && !!now.toolsAt?.reads, ...(!held || now.toolsAt?.confined ? { confined: true } : {}), ...(now.toolsAt?.leftOut ? { leftOut: true } : {}), ...(now.toolsAt?.rowless ? { rowless: true } : {}), visuals: !!now.toolsAt?.visuals, artifacts: !!now.toolsAt?.artifacts, beside: !!now.toolsAt?.beside, thread: !!now.toolsAt?.thread, flow: !!now.toolsAt?.flow, browser: !!now.toolsAt?.browser, skills: !!now.toolsAt?.skills, ...(now.toolsAt?.space === false ? { space: false } : {}), model: String(now.toolsAt?.model || ""), dirs: now.toolsAt?.dirs || [], by: live?.toolsAt?.by ?? null, callOf: live?.toolsAt?.callOf ?? null, callIsOwn: live?.toolsAt?.callIsOwn ?? null, emit: live ? live.sayer() : null, permit: (calls, what) => this.permitCalls(live, upstream, calls, what), judgeNow: (calls) => this.judgeNow(live, calls), modeNow: () => this.modeNow(live), askPerson: (form, o) => this.askPerson(live, form, o), rulesAsk: (calls) => this.rulesAsk(live, calls) };
    };
    /** @param {string} text */
    const failed = (text) => ({ content: [{ type: "text", text }], isError: true });
    return Object.fromEntries(
      tools.list(at()).map((t) => [
        t.name,
        {
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (/** @type {any} */ a) => {
            try {
              const r = await tools.call(t.name, a || {}, at());
              if (r.isError) return failed(r.text);
              // A screenshot comes as a picture beside its words (HarnessV4_AgentTools_Plan AT-D7).
              return r.media?.length ? { content: [{ type: "text", text: r.text }, ...r.media.map((/** @type {any} */ m) => ({ type: "image", data: m.source.data, mimeType: m.source.media_type }))] } : r.text;
            } catch (/** @type {any} */ e) {
              return failed(`Error: ${e.message}`);
            }
          },
        },
      ]),
    );
  }

  /**
   * The commands Filament's hands run for a turn's Bash calls, and whether the turn was stopped (HarnessV4_Tasks B13):
   * a stop ends each with everything it started, and a call that comes after it starts nothing. Seen live on
   * 2026-10-11: a 90 s command ran to its end after the Stop, the turn long over.
   * @type {WeakMap<LiveTurn, { stopped: boolean, terms: Set<any> }>}
   */
  #commands = new WeakMap();
  /** @param {LiveTurn} turn */
  #commandsOf(turn) {
    let c = this.#commands.get(turn);
    if (!c) this.#commands.set(turn, (c = { stopped: false, terms: new Set() }));
    return c;
  }
  /** The turn is stopped: what its commands still run ends now. @param {LiveTurn} turn */
  #stopCommands(turn) {
    const c = this.#commandsOf(turn);
    c.stopped = true;
    for (const term of c.terms) {
      term.stopped = true;
      this.hands.kill(term);
    }
  }

  #customTools(turn, upstream, cwd) {
    const live = () => (this.turns.get(turn.sessionId) === turn && !turn.done ? turn : null);
    // A turn with a permission switch has each call judged by it, or nothing done: a run that goes on past its turn —
    // one its stop could not cancel — has no switch left to ask, and went by the upstream's policy, allow-all by
    // default (the re-read of 11-11), as the MCP server's hands never did (`permitLocal`'s `chat`).
    const judged = { chat: !!turn.permits };
    const text = (t) => String(t ?? "");
    const err = (e, said = "") => ({ content: [{ type: "text", text: `Error: ${e.message}${said}` }], isError: true });
    const abs = (p) => (p && !/^([A-Za-z]:[\\/]|\/)/.test(p) ? join(cwd, p) : p);
    const viaClient = (role) => {
      const t = live();
      return t && t.clientTools.has(role) ? t : null;
    };
    // A file read or written outside a helper's sparse copy's cone has its folder brought in (worktree.js `widenFor`,
    // the owner's plan of 11-09 for big repos), as Filament's MCP tools do: what the result says of it after a blank
    // line — its error too —, "" where nothing came in. The client's own tools ask their own way, so the folder comes
    // in before the client is asked, or the file is not there for it; Filament's own hands are permitted first, so a
    // call refused brings nothing in.
    const widened = async (path) => {
      const w = await widenFor(path).catch(() => null);
      return w ? `\n\n${widenedWords(w, this.cli)}` : "";
    };
    return {
      Read: {
        description:
          "Read a file. `path` is absolute or relative to the project folder; `offset` (1-based line) and `limit` for long files.",
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
          required: ["path"],
        },
        execute: async (a) => {
          let said = "";
          try {
            const path = abs(a.path);
            const t = viaClient("read");
            if (t) {
              said = await widened(path);
              return (
                text(
                  await this.askClient(t, {
                    kind: "read",
                    call: t.clientTools.buildRead({ path, line: a.offset, limit: a.limit }),
                    parse: (s, isErr) => {
                      if (isErr) throw new Error(s.slice(0, 300) || "the client could not read the file");
                      return ClientToolset.parseReadResult(s);
                    },
                  }),
                ) + said
              );
            }
            await this.permitLocal(live(), upstream, "read", path, judged);
            said = await widened(path);
            return (await this.hands.readTextFile({ path, line: a.offset, limit: a.limit })).content + said;
          } catch (e) {
            return err(e, said);
          }
        },
      },
      Write: {
        description: "Write a whole file (create or replace). Prefer Edit for changes to an existing file.",
        annotations: { destructiveHint: true },
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
        execute: async (a) => {
          let said = "";
          try {
            const path = abs(a.path);
            const t = viaClient("write");
            if (t) {
              said = await widened(path);
              await this.askClient(t, {
                kind: "write",
                call: t.clientTools.buildWrite({ path, content: text(a.content) }),
                parse: (s, isErr) => {
                  if (isErr) throw new Error(s.slice(0, 300) || "the client could not write the file");
                  return s;
                },
              });
              return `Wrote ${path}${said}`;
            }
            await this.permitLocal(live(), upstream, "edit", path, judged);
            said = await widened(path);
            await this.hands.writeTextFile({ path, content: text(a.content) });
            return `Wrote ${path}${said}`;
          } catch (e) {
            return err(e, said);
          }
        },
      },
      Edit: {
        description:
          "Replace text in a file. `old_string` must occur exactly once unless `replace_all` is true.",
        annotations: { destructiveHint: true },
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            old_string: { type: "string" },
            new_string: { type: "string" },
            replace_all: { type: "boolean" },
          },
          required: ["path", "old_string", "new_string"],
        },
        execute: async (a) => {
          let said = "";
          try {
            const path = abs(a.path);
            const oldS = text(a.old_string),
              newS = text(a.new_string);
            const t = viaClient("edit");
            if (t) {
              said = await widened(path);
              return (
                text(
                  await this.askClient(t, {
                    kind: "edit",
                    call: {
                      name: t.clientTools.nameFor("edit"),
                      input: {
                        file_path: path,
                        old_string: oldS,
                        new_string: newS,
                        ...(a.replace_all ? { replace_all: true } : {}),
                      },
                    },
                    parse: (s, isErr) => {
                      if (isErr) throw new Error(s.slice(0, 300) || "the client could not edit the file");
                      return s || `Edited ${path}`;
                    },
                  }),
                ) + said
              );
            }
            await this.permitLocal(live(), upstream, "edit", path, judged);
            said = await widened(path);
            return (
              (await this.hands.editTextFile({
                path,
                edits: [{ old_string: oldS, new_string: newS, replace_all: a.replace_all === true }],
              })) + said
            );
          } catch (e) {
            return err(e, said);
          }
        },
      },
      Bash: {
        description: "Run a shell command in the project folder and return its output. `timeout` in ms.",
        annotations: { destructiveHint: true, openWorldHint: true },
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            timeout: { type: "number" },
            description: { type: "string" },
          },
          required: ["command"],
        },
        execute: async (a) => {
          try {
            const command = text(a.command);
            if (!command.trim()) throw new Error("command is required");
            const t = viaClient("bash");
            if (t) {
              const r = await this.askClient(t, {
                kind: "terminal",
                call: t.clientTools.buildBash({
                  command,
                  cwd: null,
                  timeoutMs: Number(a.timeout) || null,
                  description: a.description || "",
                }),
                parse: (s, isErr) => ClientToolset.parseBashResult(s, isErr),
              });
              return `${r.output || "(no output)"}${r.exitCode ? `\nExit code: ${r.exitCode}` : ""}`;
            }
            await this.permitLocal(live(), upstream, "execute", command, judged);
            // The command is its turn's: a stop while the person was asked starts nothing, and one that comes while it
            // runs ends it (`#stopCommands`).
            const mine = this.#commandsOf(turn);
            if (mine.stopped) throw new Error("the turn was stopped before the command started");
            /** @type {any} */
            const term = { output: "", exit: null };
            const p = this.hands.runTerminal({ command, cwd }, term);
            mine.terms.add(term);
            const ms = Math.min(600000, Math.max(1000, Number(a.timeout) || 120000));
            let timedOut = false;
            /** @type {ReturnType<typeof setTimeout> | undefined} */
            let timer;
            // The timer goes with the command it guards, as the MCP server's does: left running, each call held it for
            // up to ten minutes after the command ended.
            try {
              await Promise.race([
                p,
                new Promise((r) => {
                  timer = setTimeout(() => {
                    timedOut = true;
                    r(undefined);
                  }, ms);
                }),
              ]);
            } finally {
              clearTimeout(timer);
              mine.terms.delete(term);
            }
            if (timedOut) this.hands.kill(term);
            return `${term.output.trimEnd() || "(no output)"}${term.stopped ? "\n(Filament: the command was ended with the turn, which was stopped)" : timedOut ? `\n(Filament: command killed after ${Math.round(ms / 1000)} s)` : ""}${term.exit?.exitCode ? `\nExit code: ${term.exit.exitCode}` : ""}`;
          } catch (e) {
            return err(e);
          }
        },
      },
      Delete: {
        description: "Delete a file.",
        annotations: { destructiveHint: true },
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        execute: async (a) => {
          try {
            const path = abs(a.path);
            const t = viaClient("bash");
            if (t) {
              await this.askClient(t, {
                kind: "terminal",
                call: t.clientTools.buildBash({
                  command: `rm -f ${JSON.stringify(String(path).replace(/\\/g, "/"))}`,
                  cwd: null,
                  description: `delete ${path}`,
                }),
                parse: (s, isErr) => {
                  if (isErr) throw new Error(s.slice(0, 300));
                  return s;
                },
              });
              return `Deleted ${path}`;
            }
            await this.permitLocal(live(), upstream, "delete", path, judged);
            const { unlink } = await import("node:fs/promises");
            await unlink(path);
            return `Deleted ${path}`;
          } catch (e) {
            return err(e);
          }
        },
      },
    };
  }
}
