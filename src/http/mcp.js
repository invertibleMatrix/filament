// Filament's MCP toolset: Claude Code's own tool names (Read, Write, Edit, Bash, Glob, Grep) served over MCP's
// Streamable HTTP transport, so that an agent whose built-in tools are switched off ("native" client bridge) does
// every read, edit and command through the chat client's own tools, with the client's cards and permission mode.
// Reads, edits, writes and commands go through the live turn's client bridge when the client has the tool; Glob
// and Grep, and anything the client cannot do, run here on the same machine. Beside them, Filament's own tools for the
// agent's session (app/agent-tools.js): memory's, and the task graph's (HarnessV3-ACP AC4-2, AC4-5).
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { globToRegExp } from "../core/path-glob.js";
import { canonicalOf } from "../core/tool-vocab.js";
import { WRITING_REFUSAL } from "../adapters/agents/turn-bridge.js";
import { runHand, ENV_WORDS, RESULT_BUDGET_BYTES } from "../adapters/tools/hands.js";
import { keptBelow, resolveInside } from "../adapters/tools/fs-fence.js";
import { widenFor } from "../adapters/git/worktree.js";
import { widenedWords } from "../adapters/git/sparse.js";
import { SPACE } from "../app/agent/space.js";
import { BESIDE_TEAM } from "../app/agent/beside-tool.js";
import { FLOW_NAME } from "../app/agent/flow-tool.js";
import { THREAD } from "../app/agent/thread-tool.js";
import { BACKGROUND_COMMAND } from "../app/agent/commands.js";

const VERSION = "0.1";
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "venv", "target"]);

// Defaults for the agent-facing result page. These MIRROR `acp.nativePageLines` / `acp.nativePageChars` in
// src/schema.js and a test pins the two agreeing, because a drift here would silently make the dashboard's displayed
// default a lie about what actually happens.
export const DEFAULT_PAGE_LINES = 400;
export const DEFAULT_PAGE_CHARS = 24000;

// Cap a tool result on its way back to the AGENT (§7.1 — the anti-bloat lever).
//
// With the client bridge on, a read or a command lands in TWO histories: the client's and the agent's. Both are
// re-sent as context on every later turn, so the duplication is paid twice. The client's copy is the record — it ran
// the tool, rendered the card and kept the full result — so the agent's copy is the one to bound. Paging makes it
// SMALLER than the client's instead of equal, which is what turns "paying twice" into "one authoritative copy plus a
// bounded shadow". This is also exactly what the CLIs already do (Claude Code's own Read stops at ~2000 lines and
// says so), so the agent loses nothing it would have had from its native tool.
//
// A read keeps the FIRST lines, so `offset` walks the file forward in order. Command output keeps the LAST lines,
// because the error and the exit status are at the end and the start is almost always noise.
// `lines`/`chars` of 0 mean "no cap" (that is how `nativePaging: false` is expressed).
export function pageResult(text, { lines = DEFAULT_PAGE_LINES, chars = DEFAULT_PAGE_CHARS, keepTail = false } = {}) {
  const s = String(text ?? "");
  const maxLines = Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 0;
  const maxChars = Number.isFinite(chars) && chars > 0 ? Math.floor(chars) : 0;
  const all = s.split("\n");
  // A trailing newline is not an extra line. `split` produces a phantom empty element for it, which would be counted
  // as a line, advertised as one more page to fetch, and (on the read path) numbered — so every newline-terminated
  // file, i.e. nearly every text file, would report one line too many and promise a page that is always empty.
  const hadTrailingNewline = all.length > 1 && all[all.length - 1] === "";
  if (hadTrailingNewline) all.pop();
  let kept = all, droppedHead = 0, droppedTail = 0;
  if (maxLines && all.length > maxLines) {
    if (keepTail) { kept = all.slice(all.length - maxLines); droppedHead = all.length - maxLines; }
    else { kept = all.slice(0, maxLines); droppedTail = all.length - maxLines; }
  }
  let out = kept.join("\n");
  let byChars = false, splitLine = false;
  if (maxChars && out.length > maxChars) {
    byChars = true;
    // Cut at a LINE boundary whenever one fits inside the ceiling, so a page never ends on half a line: a fragment
    // the agent can see but not match is worse than one line fewer, and it makes the continuation offset exact.
    if (keepTail) {
      const cut = out.slice(out.length - maxChars);
      const nl = cut.indexOf("\n");
      if (nl >= 0) out = "…" + cut.slice(nl + 1);
      else { out = "…" + cut; splitLine = true; }
    } else {
      const cut = out.slice(0, maxChars);
      const nl = cut.lastIndexOf("\n");
      if (nl > 0) out = cut.slice(0, nl);
      else { out = cut + "…"; splitLine = true; }
    }
  }
  const truncated = droppedHead > 0 || droppedTail > 0 || byChars;
  // Nothing cut: hand back the ORIGINAL bytes, not a rejoin — the caller may be forwarding a client's answer and a
  // rejoin would silently normalize it.
  if (!truncated) return { text: s, truncated: false, totalLines: all.length, keptLines: all.length, droppedHead: 0, droppedTail: 0, byChars: false, splitLine: false };
  // `splitLine` means a SINGLE line is longer than the whole character ceiling, so no page boundary can ever advance
  // past it: the caller must not advertise an offset (it would return this same page forever) and must say what to
  // use instead. Minified bundles and one-line JSON are exactly this shape.
  return { text: out, truncated: true, totalLines: all.length, keptLines: kept.length, droppedHead, droppedTail, byChars, splitLine };
}

export const MCP_TOOLS = [
  { name: "Read", description: "Read a file from the local filesystem. `file_path` must be absolute. Returns the file with line numbers (cat -n). Use `offset` (1-based line) and `limit` for long files.", inputSchema: { type: "object", properties: { file_path: { type: "string", description: "Absolute path of the file" }, offset: { type: "number", description: "First line to read (1-based)" }, limit: { type: "number", description: "How many lines to read" } }, required: ["file_path"] } },
  { name: "Write", description: "Write a whole file (creating it, or replacing its contents). Prefer Edit for changes to an existing file.", inputSchema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } },
  { name: "Edit", description: "Replace text in a file. `old_string` must occur exactly once unless `replace_all` is true. Read the file first.", inputSchema: { type: "object", properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["file_path", "old_string", "new_string"] } },
  { name: "Bash", description: `Run a shell command in the project folder and return its output. ${ENV_WORDS} Use \`timeout\` (ms) for long commands. Prefer Glob/Grep/Read for finding and reading files.`, inputSchema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number" }, description: { type: "string", description: "What the command does, in a few words" } }, required: ["command"] } },
  { name: "Glob", description: "Find files by glob pattern (e.g. `**/*.js`, `src/**/*.test.ts`) under `path` (default: the project folder). Returns matching paths, newest first.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } },
  { name: "Grep", description: "Search file contents with a regular expression (ripgrep's syntax). `output_mode`: files_with_matches (default), content (each matching line as path:line:text; `-A`, `-B` or `-C` for the lines around it), count. Filter files with `glob` or `type`; `-i` for case-insensitive; `multiline` lets a match span lines. Hidden and ignored files are skipped unless `path` names them. Past `head_limit` entries, continue with `offset`.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, type: { type: "string", description: "A ripgrep file type, e.g. js, py, rust" }, output_mode: { type: "string", enum: ["files_with_matches", "content", "count"] }, "-i": { type: "boolean" }, "-A": { type: "number" }, "-B": { type: "number" }, "-C": { type: "number" }, multiline: { type: "boolean" }, head_limit: { type: "number" }, offset: { type: "number" } }, required: ["pattern"] } },
];

export { globToRegExp };

async function walk(root, { maxFiles = 20000 } = {}) {
  const out = []; const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop(); let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) { const full = join(dir, e.name); if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); } else if (e.isFile()) out.push(full); }
  }
  return out;
}

/**
 * The fence Filament's own Glob and Grep keep in a chat another machine's agents drive without Full control (acp-turn.js
 * `fenced`: its turn says so, and between turns the session as it was opened): the folders the chat adds for reading,
 * beside its own. The search stays in them, out of a repository's own `.git` and of a credentials folder
 * (tools/fs-fence.js `keptFromAgents`), as the loop's own hands keep it. Null for any other chat, whose searches go
 * where they say, and under Auto, which their chat runs in only where their device may run without asking: a command
 * runs unread there, as the person's own.
 * @param {any} ctx @returns {{ reads: string[] } | null}
 */
const theirFence = (ctx) =>
  (ctx.turn?.toolsAt?.agentsChat === true || ctx.conv?.opened?.fenced === true) && ctx.modeNow?.() !== "auto" ? { reads: Array.isArray(ctx.turn?.toolsAt?.dirs) ? ctx.turn.toolsAt.dirs : [] } : null;

/**
 * Where a call to Filament's own tools stands, from what the token's bridge knows of its session.
 * `signal`: the call's own, aborted when it should stop. Memory's tools keep to the project's sessions (`confined`)
 * unless the bridge says the caller reaches every session (`confined: false`): a call no turn places is kept to them.
 * @param {any} ctx @param {AbortSignal | null} [signal] @returns {import("../core/ports.js").AgentToolCtx}
 */
const toolCtxOf = (ctx, signal = null) => ({ cwd: ctx.cwd || "", upstream: ctx.upstream?.id || "", chain: ctx.chain ?? null, turn: ctx.turnId ?? null, graph: ctx.graph === true, report: ctx.report === true, ...(ctx.asksLead ? { asksLead: String(ctx.asksLead) } : {}), team: ctx.team === true, launch: ctx.launch === true, ...(ctx.held === true ? { held: true } : {}), reads: ctx.reads === true, ...(ctx.confined !== false ? { confined: true } : {}), ...(ctx.leftOut === true ? { leftOut: true } : {}), ...(ctx.turn?.toolsAt?.rowless === true ? { rowless: true } : {}), visuals: ctx.visuals === true, artifacts: ctx.artifacts === true, beside: ctx.beside === true, thread: ctx.thread === true, flow: ctx.flow === true, browser: ctx.browser === true, skills: ctx.skills === true, ...((ctx.turn?.toolsAt?.space ?? ctx.space) === false ? { space: false } : {}), permit: ctx.permit ?? null, judgeNow: ctx.judgeNow ?? null, modeNow: ctx.modeNow ?? null, askPerson: ctx.askPerson ?? null, rulesAsk: ctx.rulesAsk ?? null, model: String(ctx.turn?.toolsAt?.model || ""), dirs: Array.isArray(ctx.turn?.toolsAt?.dirs) ? ctx.turn.toolsAt.dirs : [], by: ctx.turn?.toolsAt?.by ?? ctx.by ?? null, callOf: ctx.turn && !ctx.turn.done ? (ctx.turn.toolsAt?.callOf ?? null) : null, callIsOwn: ctx.turn && !ctx.turn.done ? (ctx.turn.toolsAt?.callIsOwn ?? null) : null, ...(ctx.patienceMs ? { patienceMs: ctx.patienceMs } : {}), emit: ctx.emit || null, signal });

/**
 * What the agent is told of Filament's server as it connects (MCP's `instructions`, which Claude Code adds to its system
 * prompt; HarnessV3-ACP AC-R): who Filament is, its own tools, and — for a session given the hands — where they run.
 * @param {any} ctx
 */
export const serverInstructions = (ctx) => {
  // A chat Memory settings leave out is offered none of memory's tools (D4 of 11-01), and its words name none.
  const own = ctx.leftOut === true
    ? "Filament is the harness the person works with you through. This chat is left out of its memory, as the person's Memory settings say, and so are memory's tools. Its `tasks` keeps this session's task graph."
    : "Filament is the harness the person works with you through. While the person has memory on, its memory tools search and keep what the person and earlier sessions learned, and what you learn goes there, not into a memory of your client's own. Its `tasks` keeps this session's task graph.";
  const hands = ctx.native === false ? "" : " Its file and shell tools run through the person's chat client, with its permission prompts, or on their machine; their paths are absolute.";
  // A plain chat given Filament's agent tool (HarnessV4_Tasks E12 step 2): told from the agent's own as it connects;
  // where Filament holds that one back (`held`: Claude Code's, Codex's, Qoder's, Cursor's SDK's), said plainly
  // (the owner's prompt pass of 11-08); where it can't (Cursor's CLI), asked in place of the agent's own (11-10).
  const launch =
    ctx.launch !== true || ctx.team === true
      ? ""
      : ctx.held === true
        ? " Its `agent` tool launches Filament's own sub-agents, or the saved agents the person named, each as its card says; your client's own sub-agent tool is off in this session."
        : " Its `agent` tool launches Filament's own sub-agents, or the saved agents the person named, each as its card says. Where your client has a sub-agent tool of its own, Filament's stands beside it: call it directly, by its own name, which is never an agent type of yours, and use it in place of your own, whose helpers Filament's page and wait know nothing of.";
  // Beside the wait of either (HarnessV4_Envelopes_Plan EN3): named, so an agent that holds the server's tools by name
  // knows where an envelope's line points.
  const envelope = ctx.launch === true || ctx.team === true ? " Its `envelope` opens, oldest first, the results other agents sent you that wait sealed: Filament's line names each as it lands." : "";
  // Beside it (HarnessV4_Background_Plan BG-D7): a command that can take more than a minute goes there. Named wherever
  // the session's list has it (`background`): a sub-agent's too (h1, the owner's of 11-08).
  const background = ctx.launch === true || ctx.team === true || ctx.background === true ? " Its `background_command` runs any command that can take more than a minute, a test suite or a build, while you keep working; its result comes back to you whole, beside your next tool call or as a message from Filament." : "";
  // A harness chat shows the agent's visuals (HarnessV4_Visuals_Plan E16): named, so an agent that holds the server's
  // tools by name knows the picture is there to draw.
  const visuals = ctx.visuals === true ? " Its `show_visual` draws a picture in the person's chat (a diagram, a chart, a screen, a small thing to try) after `visual_guide` gives Filament's rules for it." : "";
  // A harness chat makes the agent's artifacts (HarnessV4_Artifacts_Plan E18), named the same way.
  const artifacts = ctx.artifacts === true ? " Its `artifact` makes a page the person keeps apart from the chat (a tracker, a report, a small tool) in their Artifacts list, under an address of its own." : "";
  // The team, thread and flow tools, named the same way (the owner's list of 11-08): a client holding them by name until
  // it looks one up, Claude Code's or Codex's tool search, reads here what each is for. The flow's names no team while
  // Settings › Experimental's Teams switch is off (`teams` false).
  const team = ctx.beside === true ? " Its `team` sends a team to work beside this chat, in a chat of its own, for a large job you can say in a few lines and need not watch, such as a bug hunt over recent work." : "";
  const thread = ctx.thread === true ? " Its `thread` starts a chat of its own linked to this one, an advisor or a worker you brief and write letters to with `envelope`." : "";
  const flow = ctx.flow === true ? ` Its \`flow\` designs a flow of the person's ${ctx.teams === false ? "agents" : "agents and teams"} when they ask for one with /flow.` : "";
  // A chat of a project has the project's Space (proposal_ux §4.14): `space` is offered it, so `space` is set.
  const space = ctx.space === true ? " Its `space` reads and writes this project's Space, which the person and the project's other chats share: the board of tasks, What happened (its logbook), and routines (work an agent does by itself at a time, or as a watcher when something happens)." : "";
  // A chat whose agents drive its browser (HarnessV4_AgentTools_Plan AT-D7), named the same way.
  const browser = ctx.browser === true ? " Its `browser` drives the browser in the Browser pane beside the person's chat, which they watch: use it to look at the pages you build (localhost) and to work on sites, from the page's snapshot." : "";
  // A chat that offers skills (HarnessV4_Skills_Plan S1-1): told from the agent's own Skill tool, whose skills are its own.
  const skills = ctx.skills === true ? " Its `skill` loads the skills this chat offers, which Filament's context names, and any other of the Library's by its name (a $<name> in the person's message names one to load): a skill's procedure, and the references in its folder, which it lists, reads and searches. It is not your own Skill tool: that one loads the skills of your own folders." : "";
  // Its command line, as the loop's Environment section names it (agent/environment.js `cliCommand`): a coding agent
  // has no such section, and Filament's setup skill reads the line from here (the owner's of 11-05).
  const cli = ctx.cli ? ` Its command line: \`${ctx.cli} --help\` (status, models, keys, coding agents, memory, settings).` : "";
  return `${own}${hands}${launch}${envelope}${background}${visuals}${artifacts}${team}${thread}${flow}${space}${browser}${skills}${cli} The project folder is ${ctx.cwd || "unknown"}.`;
};

/**
 * One of Filament's own tools as `tools/list` names it. One the session's words tell the agent to call (`upfront`) is
 * marked to load whole, `_meta["anthropic/alwaysLoad"]`: Claude Code holds a server's tools by name until the model
 * looks one up, and an agent that held `agent` by name alone passed that name to its own helper tool as an agent type
 * (HarnessV4_Tasks E15 step 3, AG-75). A client that knows no such mark reads past it.
 * @param {{ name: string, description: string, inputSchema: any, upfront?: boolean }} tool
 */
const listed = ({ upfront, ...tool }) => (upfront ? { ...tool, _meta: { "anthropic/alwaysLoad": true } } : tool);

/**
 * A tool's refusal in its own words, for the call's record: the log and the console's recent calls say why.
 * @param {any} result
 */
const refusalOf = (result) =>
  (Array.isArray(result?.content) ? result.content : []).filter((c) => c?.type === "text").map((c) => c.text).join(" ") || "the tool refused the call";

/**
 * A call's error with what its sparse copy said after its own words (`#widened`), its code kept; the error itself
 * where nothing was said.
 * @param {any} e @param {string} said
 */
const toldIn = (e, said) => (said ? Object.assign(new Error(`${e?.message ?? e}${said}`), e?.code != null ? { code: e.code } : {}) : e);

export class McpToolServer {
  /**
   * @param {{ bridge: any, hands?: any, log?: (level: string, msg: string) => void, tools?: import("../core/ports.js").AgentTools | null, cli?: string }} o
   *   `tools`: Filament's own tools for the agent's session; `cli`: Filament's command line, as the agent's shell runs it
   */
  constructor({ bridge, hands, log = () => {}, tools = null, cli = "" }) {
    this.bridge = bridge;
    this.hands = hands || bridge?.hands;
    this.log = log;
    this.tools = tools;
    this.cli = cli;
    this.hits = [];
    /** The session behind a token: the ACP bridge's, and any other bridge's the server adds (Codex's). @type {(token: string) => any} */
    this.contextFor = (token) => this.bridge.contextForMcpToken(token);
  }
  // Tool calls as durable operations, injected by the server as `mcp.onOp`. `hits` is in-RAM and capped at 100, so
  // "which tool calls failed overnight" had no durable answer. Every field it records is a fixed enum or a truncated
  // error — never a tool's arguments or output, because those are conversation and ops.jsonl is durable.
  #op(title, opts) { try { this.onOp?.(title, opts); } catch { /* observability must never break a tool call */ } }
  // `sink` is a per-call object the tool fills in as it runs: who actually did the work (`client` — the chat tool's
  // own Read/Bash, so it rendered a native card — or `filament`, meaning the client had no such tool and Filament's own
  // hands ran it under the permission policy), and whether the result was paged. Per call rather than per server,
  // because a batched JSON-RPC message runs its calls concurrently and an instance field would interleave.
  #hit(token, method, tool, ok, error = null, sink = null) { this.hits.push({ at: Date.now(), token: String(token || "").slice(0, 6), method, tool: tool || null, ok, via: sink?.via || null, paged: sink?.paged || null, ...(error ? { error: String(error).slice(0, 200) } : {}) }); if (this.hits.length > 100) this.hits.shift(); this.log(ok ? "debug" : "info", `[mcp] ${method}${tool ? " " + tool : ""} (${String(token || "").slice(0, 6)}) ${ok ? "ok" : "error: " + error}${sink?.via ? ` via ${sink.via}` : ""}${sink?.paged ? " (paged)" : ""}`);
    // The durable copy. `via` is the useful half: it says whether the client's own tool or Filament's hands did the
    // work, which is the divergence the Agents tab measures. A failure is a warning so it reaches the badge.
    if (tool) this.#op(`${method} ${tool} ${ok ? "ok" : "failed"}${sink?.via ? ` via ${sink.via}` : ""}`, {
      sub: "tool", level: ok ? "info" : "warn",
      detail: { method, tool, ok: !!ok, via: sink?.via || null, paged: sink?.paged || null, error: error ? String(error).slice(0, 160) : undefined },
      ref: { sessionId: token ? String(token).slice(0, 6) : null },
    }); }
  // The page limits for this call, from the upstream's own settings. 0 means no cap, which is how `nativePaging: false`
  // is expressed — and why an unset or non-numeric value (an upstream that is no agent has none) falls back to the
  // schema's defaults rather than to 0.
  #pageOpts(ctx) {
    const acp = ctx?.upstream?.acp || {};
    if (acp.nativePaging === false) return { lines: 0, chars: 0 };
    const lines = Number(acp.nativePageLines), chars = Number(acp.nativePageChars);
    return {
      lines: Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : DEFAULT_PAGE_LINES,
      chars: Number.isFinite(chars) && chars > 0 ? Math.floor(chars) : DEFAULT_PAGE_CHARS,
    };
  }

  // Streamable HTTP: JSON-RPC over POST; notifications get 202; GET (SSE stream) is not offered.
  async handle(req, res, token, body) {
    if (req.method === "DELETE") { res.writeHead(200); return res.end(); }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST, DELETE" }); return res.end("MCP: POST JSON-RPC only"); }
    let msg; try { msg = typeof body === "string" ? JSON.parse(body) : body; } catch { return this.#json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    const ctx = this.contextFor(token);
    if (!ctx) return this.#gone(res, token, msg);
    // The agent let go of its request (Stop cancels its prompt, and its client drops the call): what runs for it stops.
    const hungUp = new AbortController();
    res.on?.("close", () => { if (!res.writableEnded) hungUp.abort(new Error("the agent let go of the call")); });
    const one = async (m) => {
      if (!m || m.jsonrpc !== "2.0" || !m.method) return { jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32600, message: "invalid request" } };
      if (m.id == null) return null; // notification
      try { const sink = {}; const result = await this.#dispatch(m, ctx, sink, hungUp.signal); this.#hit(token, m.method, m.params?.name, !result?.isError, result?.isError ? refusalOf(result) : null, sink); return { jsonrpc: "2.0", id: m.id, result }; }
      catch (e) { this.#hit(token, m.method, m.params?.name, false, e.message); return { jsonrpc: "2.0", id: m.id, error: { code: e.code && Number.isInteger(e.code) ? e.code : -32000, message: e.message } }; }
    };
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? this.#json(res, 200, out) : (res.writeHead(202), res.end()); }
    const r = await one(msg); if (!r) { res.writeHead(202); return res.end(); }
    return this.#json(res, 200, r);
  }
  /**
   * A POST whose token names no session, answered before its body is read (the front door asks it first): a caller
   * without a live token never has its body taken in. True when it answered.
   * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res @param {string} token
   */
  refuseUnknown(req, res, token) {
    if (req.method !== "POST" || this.contextFor(token)) return false;
    this.#gone(res, token, null);
    return true;
  }
  /** The answer for a token whose conversation is gone, the call's id where its body was read. */
  #gone(res, token, msg) { this.#hit(token, msg?.method || "?", null, false, "unknown token"); return this.#json(res, 404, { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32001, message: "unknown Filament MCP token (the conversation is gone)" } }); }
  #json(res, status, obj) { const s = JSON.stringify(obj); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(s) }); res.end(s); }
  // The instructions as the agent connects, naming the Space's, the team's, the thread's and the flow's tools only where
  // the session's list has them: each is listed only where its chat resolves (a project, a chain that fires teams),
  // which the session's flags alone do not say (the review of 11-08). The background command is named wherever the list
  // has it, a sub-agent's list too (h1).
  #instructions(ctx) {
    const names = new Set((this.tools?.list(toolCtxOf(ctx)) || []).map((t) => t.name));
    return serverInstructions({ ...ctx, cli: this.cli, space: names.has(SPACE), beside: ctx.beside === true && names.has(BESIDE_TEAM), thread: ctx.thread === true && names.has(THREAD), flow: ctx.flow === true && names.has(FLOW_NAME), teams: this.tools?.teamsOn?.() !== false, background: names.has(BACKGROUND_COMMAND) });
  }

  async #dispatch(m, ctx, sink = {}, hungUp = null) {
    switch (m.method) {
      case "initialize": return { protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "filament", version: VERSION }, instructions: this.#instructions(ctx) };
      case "ping": return {};
      // The hands only when the agent's built-in tools are off or steered; Filament's own tools as the session has them.
      // What this address listed is Filament's own hand for the agent's permission requests (turn-bridge `loopCalls`):
      // a server's name is the agent's config's to give, this address only Filament's.
      case "tools/list": { const tools = [...(ctx.native === false ? [] : MCP_TOOLS), ...(this.tools ? this.tools.list(toolCtxOf(ctx)).map(listed) : [])]; ctx.listed?.(tools.map((t) => t.name)); return { tools }; }
      case "tools/call": {
        const name = m.params?.name; const args = m.params?.arguments || {};
        // The session writes Filament's summary (HarnessV3-ACP AC5-4): it reads only, so no tool runs for it. Its tools
        // stay listed — the list is part of the prompt the agent's cache holds.
        if (ctx.writing === true) return { content: [{ type: "text", text: WRITING_REFUSAL }], isError: true };
        // The turn the call is for, as the session's own requests find theirs (the bug report's P1): while the agent's
        // own turn is asked for, the one that takes the session. A bridge whose agent begins no turns of its own has
        // none to wait for.
        const at = ctx.settled ? await ctx.settled() : ctx;
        // The call stops with its turn, or when the agent lets go of it.
        const over = at.turn?.over?.signal || null;
        const signal = over && hungUp ? AbortSignal.any([over, hungUp]) : over || hungUp;
        const run = async () => {
          if (this.tools?.has(name)) {
            const r = await this.tools.call(name, args, toolCtxOf(at, signal));
            // A picture comes beside its words, as MCP's image content (the browser's screenshot, AT-D7).
            const pictures = (r.media || []).map((/** @type {any} */ m) => ({ type: "image", data: m.source.data, mimeType: m.source.media_type }));
            return { content: [{ type: "text", text: String(r.text ?? "") }, ...pictures], ...(r.isError ? { isError: true } : {}) };
          }
          // A session not given the hands has none to call: they were never listed to it.
          if (at.native === false) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32601 });
          return { content: [{ type: "text", text: String((await this.call(name, args, at, sink)) ?? "") }] };
        };
        try { return await run(); }
        catch (e) { if (e.code === -32601) throw e; return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }; }
      }
      case "resources/list": return { resources: [] };
      case "prompts/list": return { prompts: [] };
      default: throw Object.assign(new Error(`method not found: ${m.method}`), { code: -32601 });
    }
  }

  /**
   * A helper's sparse copy widened for a file read or written outside its cone (worktree.js `widenFor`, the owner's plan
   * of 11-09 for big repos): what the call's result says of it after a blank line, "" where nothing was brought in.
   * @param {string} path
   */
  async #widened(path) {
    const w = await widenFor(path).catch(() => null);
    return w ? `\n\n${widenedWords(w, this.cli || "filament")}` : "";
  }

  // One tool call, through the client when possible, otherwise locally.
  async call(name, args, ctx, sink = {}) {
    const turn = ctx.turn && !ctx.turn.done ? ctx.turn : null; const tools = turn?.clientTools; const cwd = ctx.cwd || process.cwd();
    const abs = (p) => (p && !/^([A-Za-z]:[\\/]|\/)/.test(p) ? join(cwd, p) : p);
    // A file read or written outside a helper's sparse copy's cone has its folder brought in (`#widened`), and the call
    // says so — its failure too: a folder that could not come in is why the file is not there. The client's own tools
    // ask their own way, so the folder comes in before the client is asked, or the file is not there for it; Filament's
    // own hands are permitted first, so a call refused brings nothing in.
    let said = "";
    switch (name) {
      case "Read": {
        const path = abs(args.file_path); if (!path) throw new Error("file_path is required");
        const start = Math.max(1, Number(args.offset) || 1);
        let content;
        try {
          if (turn && tools.has("read")) {
            sink.via = "client";
            said = await this.#widened(path);
            content = await this.bridge.askClient(turn, { kind: "read", call: tools.buildRead({ path, line: args.offset, limit: args.limit }), parse: (t, isErr) => { if (isErr) throw new Error(t.slice(0, 300) || "the client could not read the file"); return t; } });
          } else {
            sink.via = "filament";
            await this.bridge.permitLocal(turn, ctx.upstream, "read", path, { chat: ctx.chat === true });
            said = await this.#widened(path);
            content = (await this.hands.readTextFile({ path, line: args.offset, limit: args.limit })).content;
          }
        } catch (e) { throw toldIn(e, said); }
        // Page the UNNUMBERED text and number only the window the agent will actually see. Numbering every line of a
        // large file and then throwing ~98% of it away is a full split+map+join on the request handler for nothing;
        // the file is already in memory once, which is unavoidable, but it does not need to be rebuilt twice.
        const original = String(content ?? "");
        const body = original.endsWith("\n") ? original.slice(0, -1) : original; // a trailing newline is not a line
        const opts = this.#pageOpts(ctx);
        const pg = pageResult(body, opts);
        const numbered = (t) => t.split("\n").map((l, i) => `${String(start + i).padStart(6)}\t${l}`).join("\n");
        // Nothing cut: the client's bytes go back exactly as it sent them, and the local path gets its line numbers.
        if (!pg.truncated) return (sink.via === "filament" ? numbered(body) + (original.endsWith("\n") ? "\n" : "") : original) + said;
        const text = sink.via === "filament" ? numbered(pg.text) : pg.text;
        // How many lines the agent can ACTUALLY see. A character ceiling can discard most of the lines the line cap
        // kept, so reporting `keptLines` would claim the agent has 400 lines when it has a hundred — and the offset it
        // is told to continue from would then skip everything in between.
        const shown = pg.text.split("\n").length;
        sink.paged = `${shown}/${pg.totalLines} lines`;
        // Who has the rest, stated honestly per path. On the client path the client ran the read and keeps its own
        // copy — but it may have capped what it returned, so claim no more than "this read". On Filament's own hands
        // there is NO client copy at all (that fallback is the reason `via` is recorded), and the rest is on disk.
        const where = sink.via === "client" ? "Your chat client ran this read and keeps its own copy." : "The rest is still on disk.";
        if (pg.splitLine) {
          // One line longer than the whole character ceiling: no offset can advance past it, because the next page
          // would start on the same line and come back identical. Advertising an offset here is a loop the agent
          // cannot escape, and the remainder would be unreachable through Read — so say what to use instead.
          // Minified bundles and single-line JSON are exactly this shape.
          return `${text}\n(Filament: line ${start} of this file is longer than the ${opts.chars}-character page ceiling, so Read cannot page past it — asking for the next page would return this same one. Search inside it with Grep, or use Bash to cut out the part you need. ${where})${said}`;
        }
        // Exact because the character cut now lands on a line boundary: the page ends after a whole line, so the next
        // one starts immediately after it, with no gap and no overlap.
        const next = start + shown;
        // The warning matters more than the arithmetic. An agent that has seen one page of a file and then uses Write
        // replaces the WHOLE file with what it saw — real data loss, and the only new hazard paging introduces (before
        // it, the agent had read everything). Edit is safe on a partial read because it matches a string; Write is not.
        return `${text}\n(Filament: ${shown} of ${pg.totalLines} lines from this read${pg.byChars ? ", cut at the character ceiling" : ""}. Call Read again with offset=${next} for the next page. ${where} To change this file, use Edit — Write would replace all ${pg.totalLines} lines with only the part you have read.)${said}`;
      }
      case "Write": {
        const path = abs(args.file_path); if (!path) throw new Error("file_path is required");
        try {
          if (turn && tools.has("write")) { sink.via = "client"; said = await this.#widened(path); await this.bridge.askClient(turn, { kind: "write", call: tools.buildWrite({ path, content: String(args.content ?? "") }), parse: (t, isErr) => { if (isErr) throw new Error(t.slice(0, 300) || "the client could not write the file"); return t; } }); return `Wrote ${path}${said}`; }
          sink.via = "filament"; await this.bridge.permitLocal(turn, ctx.upstream, "edit", path, { chat: ctx.chat === true }); said = await this.#widened(path); await this.hands.writeTextFile({ path, content: String(args.content ?? "") }); return `Wrote ${path}${said}`;
        } catch (e) { throw toldIn(e, said); }
      }
      case "Edit": {
        const path = abs(args.file_path); if (!path) throw new Error("file_path is required"); const oldS = String(args.old_string ?? ""), newS = String(args.new_string ?? "");
        const told = (/** @type {any} */ r) => (said ? `${r}${said}` : r);
        try {
          if (turn && tools.has("edit")) { sink.via = "client"; said = await this.#widened(path); const n = tools.nameFor("edit"); return told(await this.bridge.askClient(turn, { kind: "edit", call: { name: n, input: { file_path: path, old_string: oldS, new_string: newS, ...(args.replace_all ? { replace_all: true } : {}) } }, parse: (t, isErr) => { if (isErr) throw new Error(t.slice(0, 300) || "the client could not edit the file"); return t || `Edited ${path}`; } })); }
          sink.via = "filament"; await this.bridge.permitLocal(turn, ctx.upstream, "edit", path, { chat: ctx.chat === true });
          said = await this.#widened(path);
          return told(await this.hands.editTextFile({ path, edits: [{ old_string: oldS, new_string: newS, replace_all: args.replace_all === true }] }));
        } catch (e) { throw toldIn(e, said); }
      }
      case "Bash": {
        const command = String(args.command || ""); if (!command.trim()) throw new Error("command is required");
        let raw, note = "";
        if (turn && tools.has("bash")) {
          sink.via = "client";
          const r = await this.bridge.askClient(turn, { kind: "terminal", call: tools.buildBash({ command, cwd: null, timeoutMs: Number(args.timeout) || null, description: args.description || "" }), parse: (t, isErr) => ({ output: t, isErr }) });
          raw = r.output || (r.isErr ? "(command failed)" : "(no output)");
        } else {
          sink.via = "filament";
          await this.bridge.permitLocal(turn, ctx.upstream, "execute", command, { chat: ctx.chat === true });
          const term = { output: "", exit: null }; const p = this.hands.runTerminal({ command, cwd }, term);
          const ms = Math.min(600000, Math.max(1000, Number(args.timeout) || 120000)); let timedOut = false; let timer = null;
          // The timer must not outlive the command it guards: left running, every Bash call held a 120 s timer after
          // the command had already finished — one per call in production, and a two-minute wait for the process to
          // exit in any test that ran one.
          try { await Promise.race([p, new Promise((r) => { timer = setTimeout(() => { timedOut = true; r(); }, ms); })]); } finally { clearTimeout(timer); }
          if (timedOut) this.hands.kill(term);
          raw = term.output.trimEnd() || "(no output)";
          // Built separately and appended AFTER paging: a long output must never be able to push the timeout or the
          // exit code out of the page, because those are the two things the agent needs most from a failed command.
          note = `${timedOut ? `\n(Filament: command killed after ${Math.round(ms / 1000)} s)` : ""}${term.exit && term.exit.exitCode ? `\nExit code: ${term.exit.exitCode}` : ""}`;
        }
        // Tail-kept, unlike a read: the start of a command's output is almost always noise and the end is the result.
        const pg = pageResult(raw, { ...this.#pageOpts(ctx), keepTail: true });
        if (!pg.truncated) return pg.text + note;
        // Counted from the text actually returned, for the same reason as Read: a character ceiling can discard most
        // of the lines the line cap kept, and the number in the note has to describe what the agent can see.
        const shown = pg.text.split("\n").length;
        sink.paged = `kept ${shown}/${pg.totalLines} lines`;
        return `${pg.text}\n(Filament: kept the last ${shown} of ${pg.totalLines} lines${pg.byChars ? ", cut at the character ceiling" : ""} — the tail, because that is where errors and the exit status are. Narrow the command, or redirect it to a file and Read that.)${note}`;
      }
      case "Glob": {
        sink.via = "filament"; // search always runs here: the client's own tools are for reading, writing and commands
        const root = abs(args.path) || cwd; const fence = theirFence(ctx);
        if (fence) resolveInside(cwd, root, { reads: fence.reads, theirs: true });
        const kept = fence ? keptBelow(root, [cwd, ...fence.reads]) : null;
        const re = globToRegExp(String(args.pattern || "*")); const files = await walk(root);
        const hits = []; for (const f of files) { const rel = relative(root, f).split(sep).join("/"); if ((re.test(rel) || re.test(f.replace(/\\/g, "/"))) && !kept?.(f)) hits.push(f); }
        const withTime = await Promise.all(hits.slice(0, 2000).map(async (f) => ({ f, t: (await stat(f).catch(() => ({ mtimeMs: 0 }))).mtimeMs }))); withTime.sort((a, b) => b.t - a.t);
        return withTime.length ? withTime.slice(0, 500).map((x) => x.f).join("\n") + (withTime.length > 500 ? `\n… ${withTime.length - 500} more` : "") : "No files found";
      }
      case "Grep": {
        sink.via = "filament";
        // The loop's grep: ripgrep, or a walk in a worker its time ends, so the agent's pattern never runs on the
        // proxy's thread (fable51's list: one that backtracks froze every chat). Claude Code's words read as ours; its
        // default output is the files that match.
        const { fields } = /** @type {any} */ (canonicalOf("Grep", args));
        const fence = theirFence(ctx);
        return runHand("grep", { ...fields, output: fields.output ?? "files" }, { root: cwd, ...(fence ? { fenced: true, reads: fence.reads, theirs: true } : { fenced: false }), fullPaths: true, maxBytes: RESULT_BUDGET_BYTES });
      }
      default: throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32601 });
    }
  }
}
