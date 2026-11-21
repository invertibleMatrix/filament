// @ts-check
// A plugin's hooks as Claude Code runs them (HarnessV4_SpacesPlugins_Plan B3), pure: a hook written for Claude's events
// runs at Filament's moment for it (core/plugin-parts.js HOOK_MOMENTS), and what passes between them is translated both
// ways. What the hook reads: Claude's JSON on stdin — `session_id`, `cwd`, `hook_event_name`, the tool's name and
// input as Claude names them (`bash` is Bash, `edit` Edit or MultiEdit, its `path` a `file_path`), the result. What it
// says: exit 2 blocks, stderr the reason; `decision: "block"` with a reason; before a tool, `permissionDecision: "deny"`
// or `updatedInput`, the input rewritten, translated back into Filament's; `continue: false` stops. Anything else lets
// it be, as in Claude, where a hook that fails otherwise is no block. Its matcher matches the tool by either name.

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Filament's moment → Claude's event. */
export const CLAUDE_EVENTS = Object.freeze({ "pre-tool": "PreToolUse", "post-tool": "PostToolUse", "turn-end": "Stop", "session-start": "SessionStart", "prompt-submit": "UserPromptSubmit", "pre-compact": "PreCompact", "subagent-end": "SubagentStop" });
/** @typedef {keyof typeof CLAUDE_EVENTS} HookMoment */

/** Claude's name for each of Filament's own tools; an MCP server's tool is `mcp__<server>__<tool>` in both. */
const CLAUDE_TOOLS = Object.freeze({
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  bash_background: "Bash",
  bash_output: "BashOutput",
  bash_kill: "KillShell",
  powershell: "PowerShell",
  grep: "Grep",
  glob: "Glob",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
});

/** grep's `output` ↔ Grep's `output_mode`. */
const GREP_MODES = Object.freeze({ content: "content", files: "files_with_matches", count: "count" });

/** An object of the keys whose value is not undefined. @param {Record<string, any>} o */
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The names a hook's matcher matches a call by: Filament's, Claude's — `edit` both Edit and MultiEdit, as it does both —,
 * and a plugin's own MCP server's tool as Claude names it, `mcp__plugin_<plugin>_<server>__<tool>`, where the hook's
 * plugin brought that server (`aliases`: Filament's server name → Claude's).
 * @param {string} tool @param {Record<string, string> | null} [aliases]
 * @returns {string[]}
 */
export function claudeNames(tool, aliases = null) {
  const t = String(tool || "");
  const mcp = /^mcp__(.+?)__(.+)$/.exec(t);
  if (mcp) return aliases && Object.hasOwn(aliases, mcp[1]) ? [t, `mcp__${aliases[mcp[1]]}__${mcp[2]}`] : [t];
  const claude = /** @type {Record<string, string>} */ (CLAUDE_TOOLS)[t];
  return t === "edit" ? [t, "Edit", "MultiEdit"] : claude ? [t, claude] : [t];
}

/**
 * Whether a Claude matcher matches one of the names: none or `*` matches every one; a name, or names joined by `|`,
 * matches exactly; anything else is a regular expression over the whole name. One that is no expression matches none.
 * @param {unknown} matcher @param {readonly string[]} names
 */
export function claudeMatches(matcher, names) {
  const m = String(matcher ?? "").trim();
  if (!m || m === "*") return true;
  if (/^[A-Za-z0-9_|-]+$/.test(m)) return m.split("|").some((x) => names.includes(x));
  try {
    const re = new RegExp(`^(?:${m})$`);
    return names.some((n) => re.test(n));
  } catch {
    return false;
  }
}

/**
 * A call of Filament's as Claude's hook reads it: the tool's Claude name and its input in Claude's fields. A tool
 * Claude has no such tool for keeps its name and input.
 * @param {string} tool @param {any} input @returns {{ name: string, input: any }}
 */
export function claudeCall(tool, input) {
  const i = isObject(input) ? input : {};
  const ms = (/** @type {unknown} */ s) => (typeof s === "number" && s > 0 ? Math.round(s * 1000) : undefined);
  switch (tool) {
    case "read":
      return { name: "Read", input: defined({ file_path: i.path, offset: i.offset, limit: i.limit, pages: i.pages }) };
    case "write":
      return { name: "Write", input: defined({ file_path: i.path, content: i.content }) };
    case "edit": {
      const edits = (Array.isArray(i.edits) ? i.edits : []).map((/** @type {any} */ e) => defined({ old_string: e?.oldText, new_string: e?.newText, replace_all: e?.replaceAll }));
      return edits.length === 1 ? { name: "Edit", input: defined({ file_path: i.path, ...edits[0] }) } : { name: "MultiEdit", input: defined({ file_path: i.path, edits }) };
    }
    case "bash":
    case "powershell":
      return { name: /** @type {string} */ (/** @type {any} */ (CLAUDE_TOOLS)[tool]), input: defined({ command: i.command, timeout: ms(i.timeout) }) };
    case "bash_background":
      return { name: "Bash", input: defined({ command: i.command, run_in_background: true }) };
    case "bash_output":
      return { name: "BashOutput", input: defined({ bash_id: i.id }) };
    case "bash_kill":
      return { name: "KillShell", input: defined({ shell_id: i.id }) };
    case "grep":
      return {
        name: "Grep",
        input: defined({
          pattern: i.literal === true && typeof i.pattern === "string" ? i.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : i.pattern,
          path: i.path,
          glob: i.glob,
          type: i.type,
          output_mode: /** @type {any} */ (GREP_MODES)[i.output] ?? undefined,
          "-C": i.context,
          "-B": i.before,
          "-A": i.after,
          multiline: i.multiline,
          "-i": i.ignoreCase,
          head_limit: i.limit,
          offset: i.offset,
        }),
      };
    default: {
      const claude = /** @type {Record<string, string>} */ (CLAUDE_TOOLS)[tool];
      return { name: claude || tool, input: i };
    }
  }
}

/**
 * A Claude hook's `updatedInput` as Filament's tool takes it: Claude's fields back into Filament's, what it leaves out
 * left out. A tool Claude has no such tool for takes it as given.
 * @param {string} tool @param {Record<string, any>} given @returns {Record<string, any>}
 */
export function filamentArgs(tool, given) {
  const g = isObject(given) ? given : {};
  const secs = (/** @type {unknown} */ ms) => (typeof ms === "number" && ms > 0 ? Math.max(1, Math.round(ms / 1000)) : undefined);
  const path = g.file_path ?? g.path;
  switch (tool) {
    case "read":
      return defined({ path, offset: g.offset, limit: g.limit, pages: g.pages });
    case "write":
      return defined({ path, content: g.content });
    case "edit": {
      const list = Array.isArray(g.edits) ? g.edits : [g];
      return defined({ path, edits: list.map((/** @type {any} */ e) => defined({ oldText: e?.old_string ?? e?.oldText, newText: e?.new_string ?? e?.newText, replaceAll: e?.replace_all ?? e?.replaceAll })) });
    }
    case "bash":
    case "powershell":
      return defined({ command: g.command, timeout: secs(g.timeout) });
    case "bash_background":
      return defined({ command: g.command });
    case "bash_output":
    case "bash_kill":
      return defined({ id: g.bash_id ?? g.shell_id ?? g.id });
    case "grep": {
      const mode = Object.entries(GREP_MODES).find(([, v]) => v === g.output_mode)?.[0];
      return defined({ pattern: g.pattern, path: g.path, glob: g.glob, type: g.type, output: mode, context: g["-C"], before: g["-B"], after: g["-A"], multiline: g.multiline, ignoreCase: g["-i"], limit: g.head_limit, offset: g.offset });
    }
    default:
      return g;
  }
}

/**
 * The chat's permission mode by Claude's name for its own of the same kind: read-only is its plan mode, ask asks as
 * its default does, edit accepts edits, auto bypasses every ask.
 */
const CLAUDE_MODES = Object.freeze({ "read-only": "plan", ask: "default", edit: "acceptEdits", auto: "bypassPermissions" });

/**
 * What a Claude hook reads on stdin at a Filament moment. `mode`: the chat's permission mode as the moment comes, which
 * the hook reads in Claude's name for it (`CLAUDE_MODES`); none said, Claude's default.
 * @param {{ event: HookMoment, tool?: string | null, input?: any, result?: string | null, prompt?: string | null, trigger?: string | null, session?: string | null, cwd: string, mode?: string | null }} p
 * @param {number} [maxResult]  the most of a result it reads
 */
export function claudeStdin(p, maxResult = 20_000) {
  const mode = /** @type {Record<string, string>} */ (CLAUDE_MODES)[String(p.mode)] || "default";
  const head = { session_id: p.session || "", transcript_path: "", cwd: p.cwd, permission_mode: mode, hook_event_name: CLAUDE_EVENTS[p.event] };
  if (p.event === "turn-end" || p.event === "subagent-end") return { ...head, stop_hook_active: false };
  if (p.event === "session-start") return { ...head, source: "startup" };
  if (p.event === "prompt-submit") return { ...head, prompt: String(p.prompt ?? "") };
  if (p.event === "pre-compact") return { ...head, trigger: p.trigger === "manual" ? "manual" : "auto", custom_instructions: "" };
  const call = claudeCall(String(p.tool || ""), p.input);
  return { ...head, tool_name: call.name, tool_input: call.input, ...(p.event === "post-tool" ? { tool_response: p.result == null ? null : String(p.result).slice(0, maxResult) } : {}) };
}

/**
 * What a Claude hook said, as Filament's verdict at the moment it ran — Claude's meaning kept where Filament's moment
 * means otherwise:
 * - exit 2 blocks before a tool, at a turn's or a sub-agent's end and on the person's message, stderr the reason; after
 *   a tool (it ran already) stderr goes to the model beside the result; at a chat's start and before a compaction it
 *   blocks nothing.
 * - Before a compaction nothing blocks: it is told, as Claude's PreCompact is.
 * - Any other exit but 0 blocks nothing, as in Claude.
 * - `continue: false` stops a call or the chat's start, its `stopReason` the words.
 * - Before a tool, `permissionDecision: "deny"` (or the older `decision: "block"`) blocks, its reason the words;
 *   `updatedInput` rewrites the call, returned as `args` in Claude's fields.
 * - At a turn's end, `decision: "block"` sends the turn back with its reason; at a sub-agent's, the sub-agent; on the
 *   person's message, it refuses the message with its reason.
 * - After a tool, a block's reason goes to the model beside the result.
 * - `additionalContext` is the note; at a chat's start and on the person's message, plain output is.
 * @param {HookMoment} on @param {number | null} code
 * @param {Record<string, any> | null} parsed  stdout read as JSON, or null @param {string} stdout @param {string} stderr
 * @returns {{ verdict: "allow" | "block", note: string, args: Record<string, any> | null }}
 */
export function claudeVerdict(on, code, parsed, stdout, stderr) {
  const allow = (note = "") => ({ verdict: /** @type {const} */ ("allow"), note, args: null });
  const block = (/** @type {string} */ note) => ({ verdict: /** @type {const} */ ("block"), note, args: null });
  const err = stderr.trim();
  if (on === "pre-compact") return allow();
  const ends = on === "turn-end" || on === "subagent-end";
  if (code === 2) {
    if (on === "pre-tool" || ends || on === "prompt-submit") return block(err || "the hook blocked it (exit 2)");
    return allow(on === "post-tool" ? err : "");
  }
  if (code !== 0) return allow();
  if (!parsed) return allow(on === "session-start" || on === "prompt-submit" ? stdout.trim() : "");
  const out = isObject(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : {};
  const context = typeof out.additionalContext === "string" ? out.additionalContext : "";
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";
  if (parsed.continue === false && !ends) return block(typeof parsed.stopReason === "string" && parsed.stopReason ? parsed.stopReason : "the hook stopped it");
  if (on === "pre-tool") {
    const decision = typeof out.permissionDecision === "string" ? out.permissionDecision : parsed.decision === "block" ? "deny" : "";
    if (decision === "deny") return block((typeof out.permissionDecisionReason === "string" && out.permissionDecisionReason) || reason || "the hook denied it");
    return { verdict: "allow", note: context, args: isObject(out.updatedInput) ? out.updatedInput : null };
  }
  if (ends && parsed.decision === "block") return block(reason || "the hook sent the turn back");
  if (on === "prompt-submit" && parsed.decision === "block") return block(reason || "the hook refused the message");
  if (on === "post-tool" && parsed.decision === "block") return allow([reason, context].filter(Boolean).join("\n"));
  return allow(context);
}
