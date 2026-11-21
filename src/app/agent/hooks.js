// @ts-check
// Session hooks (HarnessV2 §5.6): commands the developer names in the settings document, run in the project folder at
// seven moments — `prompt-submit` (the person's message, before the model reads it; a block refuses it in words, an
// allow's note rides it), `pre-compact` (before a compaction folds the turn's work; told, never a block),
// `subagent-end` (a sub-agent is about to finish; a block sends it back, as turn-end does the turn), and `pre-tool` (before a hand runs; may block it or rewrite its input), `post-tool` (after; may annotate
// or withhold the result), `turn-end` (the model is about to finish; a block sends the turn back for one more round
// with the note as a message) and `session-start` (the session's first turn — or the first after a block, or after the
// hook was added; once it allows, it is done for the session; a block refuses the turn in words). The hook
// reads the event as JSON on stdin and answers `{ verdict: "allow" | "block", args?, note? }` on stdout — a JSON
// verdict wins; without one, exit 0 is an allow and any other exit a block, the output as the note. `loop.verify.afterEdits` is a turn-end hook that runs
// only when the turn wrote files; `readBackBeforeDone` a built-in turn-end judgement. Every run is audited (ops kind
// `hook`), recorded on the request (`rec.hooks`) and published as a `hook` run event (a card in the transcript). The
// shell gets the same secret-free environment the bash hand does.
// A plugin's hook (HarnessV4_SpacesPlugins_Plan B3), joined by app/plugins.js where its plugin's hooks are switched on,
// speaks Claude's dialect (core/plugin-hooks.js): its matcher picks the tools, it reads Claude's JSON and is read as
// Claude reads it, it runs in the shell the bash hand runs — Git Bash on Windows, as Claude Code's do — with its
// plugin's environment, and a hook that cannot start or does not finish blocks nothing, as in Claude.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { EXIT_DRAIN_MS, safeEnv } from "../../adapters/tools/hands.js";
import { killTree } from "../../adapters/tools/kill-tree.js";
import { SHELL, cmdLine } from "../../adapters/tools/shell.js";
import { HOOK_EVENTS } from "../../services/session-settings.js";
import { claudeMatches, claudeNames, claudeStdin, claudeVerdict, filamentArgs } from "../../core/plugin-hooks.js";

/** @typedef {import("../../core/plugin-hooks.js").HookMoment} HookEvent */
/**
 * A hook: its moment, the tool it is for, what it runs, how long it may take; a built-in's knob; a plugin's own — its
 * id, Claude's dialect, its matcher, its environment, and its servers' names as Claude says them (`aliases`).
 * @typedef {{ on: HookEvent, tool?: string | null, command: string, timeoutMs?: number | null, builtin?: string,
 *   plugin?: string, dialect?: "claude", matcher?: string, env?: Record<string, string>, aliases?: Record<string, string> }} Hook
 */
/** How long a plugin's hook may take where it names no time: Claude's minute. */
const PLUGIN_HOOK_TIMEOUT_MS = 60_000;
/**
 * @typedef {object} HookOutcome
 * @property {HookEvent} on
 * @property {string | null} tool
 * @property {string} command
 * @property {"allow" | "block"} verdict
 * @property {string} note  what the hook said (its JSON note, else its output), clipped; "" when nothing
 * @property {any | null} args  a pre-tool rewrite of the tool's input, when the hook gave one
 * @property {number} ms
 * @property {number | null} exit  the exit code; null when it did not exit (timed out, could not start)
 * @property {boolean} timedOut
 * @property {string} [builtin]  the knob a built-in hook stands for (`loop.verify.afterEdits`)
 * @property {string} [plugin]  the plugin a plugin's hook came with, by its id
 */

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
const MAX_NOTE_CHARS = 4000;
const MAX_OUTPUT_CHARS = 64_000;
const MAX_STDIN_RESULT_CHARS = 20_000;

/** @param {any} v */
const clipNote = (v) => String(v ?? "").trim().slice(0, MAX_NOTE_CHARS);

/**
 * The hooks of a document that fire at one moment, for one tool when the moment is a tool's: `hooks` entries whose
 * `on` matches (and whose `tool`, when named, matches the hand — `*` or unset covers every tool; a plugin's, whose
 * Claude matcher matches it by either name, or, at a chat's start, matches `startup`, or before a compaction its
 * trigger, `manual` or `auto`), then the built-ins (`loop.verify.afterEdits` as a turn-end hook when the turn wrote
 * files).
 * @param {any} doc  the effective settings document
 * @param {HookEvent} on @param {{ tool?: string | null, wroteFiles?: boolean, trigger?: "manual" | "auto" }} [ctx]
 * @returns {Hook[]}
 */
export function hooksFor(doc, on, { tool = null, wroteFiles = false, trigger = "auto" } = {}) {
  /** @type {Hook[]} */
  const out = [];
  for (const h of Array.isArray(doc?.hooks) ? doc.hooks : []) {
    if (!h || h.on !== on || typeof h.command !== "string" || !h.command.trim() || !HOOK_EVENTS.includes(h.on)) continue;
    if ((on === "pre-tool" || on === "post-tool") && h.tool && h.tool !== "*" && String(h.tool).toLowerCase() !== String(tool).toLowerCase()) continue;
    const timeoutMs = Number(h.timeoutMs) > 0 ? Number(h.timeoutMs) : null;
    if (h.dialect === "claude") {
      const aliases = h.aliases && typeof h.aliases === "object" ? h.aliases : null;
      if ((on === "pre-tool" || on === "post-tool") && !claudeMatches(h.matcher, claudeNames(String(tool || ""), aliases))) continue;
      if (on === "session-start" && !claudeMatches(h.matcher, ["startup"])) continue;
      if (on === "pre-compact" && !claudeMatches(h.matcher, [trigger])) continue;
      out.push({ on, tool: null, command: h.command, timeoutMs: timeoutMs ?? PLUGIN_HOOK_TIMEOUT_MS, plugin: String(h.plugin || ""), dialect: "claude", matcher: String(h.matcher || ""), env: h.env && typeof h.env === "object" ? h.env : {}, ...(aliases ? { aliases } : {}) });
      continue;
    }
    out.push({ on, tool: h.tool && h.tool !== "*" ? String(h.tool) : null, command: h.command, timeoutMs });
  }
  const verify = doc?.loop?.verify?.afterEdits;
  if (on === "turn-end" && wroteFiles && typeof verify === "string" && verify.trim())
    out.push({ on, tool: null, command: verify, timeoutMs: null, builtin: "loop.verify.afterEdits" });
  return out;
}

/**
 * Parse what a hook printed: the whole stdout as JSON, else its last non-empty line as JSON, else nothing.
 * @param {string} stdout
 * @returns {{ verdict?: string, args?: any, note?: string } | null}
 */
export function parseHookOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const tryJson = (/** @type {string} */ s) => {
    try {
      const j = JSON.parse(s);
      return j && typeof j === "object" && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  };
  const whole = tryJson(text);
  if (whole) return whole;
  const last = text.split(/\r?\n/).filter((l) => l.trim()).pop() || "";
  return tryJson(last.trim());
}

/**
 * Run one hook: the command in the project folder through the shell, the event as JSON on stdin, its stdout read for
 * the verdict. A timeout kills the process tree; whether that blocks is the caller's call (`timedOut` says so). What
 * the hook said is outside text the model may read: `redact` goes over it whole, before the note is clipped.
 * @param {Hook} hook
 * @param {{ event: HookEvent, tool?: string | null, input?: any, result?: string | null, ok?: boolean, prompt?: string | null, trigger?: "manual" | "auto", round?: number, turn?: number | null, session?: string | null, cwd: string, mode?: string | null }} payload
 *   `mode`: the chat's permission mode at the moment, which a plugin's hook reads in Claude's name for it
 * @param {{ timeoutMs?: number, signal?: AbortSignal | null, redact?: ((text: string) => string) | null }} [o]
 * @returns {Promise<HookOutcome>}
 */
export function runHook(hook, payload, { timeoutMs = DEFAULT_HOOK_TIMEOUT_MS, signal = null, redact = null } = {}) {
  /** What the hook said, as a note. @param {unknown} v */
  const said = (v) => clipNote(redact ? redact(String(v ?? "")) : v);
  const started = Date.now();
  const limit = Number(hook.timeoutMs) > 0 ? Number(hook.timeoutMs) : timeoutMs;
  /** @param {Partial<HookOutcome>} o */
  const done = (o) => /** @type {HookOutcome} */ ({ on: hook.on, tool: hook.tool ?? null, command: hook.command, verdict: "allow", note: "", args: null, exit: null, timedOut: false, ...(hook.plugin ? { plugin: hook.plugin } : {}), ...o, ms: Date.now() - started });
  const claude = hook.dialect === "claude";
  // A plugin's hook that could not start or did not finish blocks nothing, as in Claude: it is said in its note.
  const failed = claude ? "allow" : "block";
  return new Promise((resolveP) => {
    // A plugin's hook runs where Claude Code's do: in bash — the bash hand's, Git Bash on Windows — where there is one.
    // cmd.exe gets its line as every cmd.exe of Filament's does (shell.js `cmdLine`; r-hands, 11-12): with `/c` alone a
    // command that starts with a quoted program and quotes an argument too ran the program's path up to its first space.
    const shell =
      claude && SHELL.kind !== "cmd"
        ? { file: SHELL.file, args: ["-c", hook.command], verbatim: false }
        : process.platform === "win32"
          ? { file: `${process.env.SystemRoot || "C:\\Windows"}\\System32\\cmd.exe`, args: cmdLine(hook.command), verbatim: true }
          : { file: "/bin/sh", args: ["-c", hook.command], verbatim: false };
    const env = {
      ...safeEnv(),
      ...(claude ? { CLAUDE_PROJECT_DIR: resolve(payload.cwd), ...hook.env } : {}),
      FILAMENT_HOOK_EVENT: hook.on,
      ...(payload.tool ? { FILAMENT_HOOK_TOOL: payload.tool } : {}),
      ...(payload.session ? { FILAMENT_SESSION: payload.session } : {}),
      ...(payload.turn ? { FILAMENT_TURN: String(payload.turn) } : {}),
    };
    let proc;
    try {
      proc = spawn(shell.file, shell.args, { cwd: resolve(payload.cwd), env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: shell.verbatim });
    } catch (/** @type {any} */ e) {
      resolveP(done({ verdict: failed, note: `the hook could not start: ${e.message}` }));
      return;
    }
    const outDec = new StringDecoder("utf8");
    const errDec = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let stopped = false;
    // The command goes with what it started (kill-tree.js): on Windows by its tree, elsewhere by its process group. A
    // tree that could not be ended is said in the hook's note, and the hook ends there: what is left of it may still
    // run, holding the hook's pipes open, and its end is not waited for. Nor is it where the kill was carried out
    // (r-hands, 11-12): a process the hook started that the kill does not reach — one whose parent had exited, so no
    // tree leads to it, or that left the process group — still holds the pipes, and their close, which alone ended
    // the hook, came only with that process's end; a hook past its time, or stopped with the turn, held the turn
    // until then, Stop included. Killed, the hook ends once its pipes had the moment the bash hand gives a shell's
    // (hands.js `EXIT_DRAIN_MS`), whatever still holds them.
    let unkilled = "";
    const kill = () => {
      if (!proc.pid) return;
      void killTree(proc, {
        warn: (what) => (unkilled = `; Filament could not end what it started (taskkill ${what}) and killed its shell alone`),
        direct: () => (process.platform === "win32" ? proc.kill() : process.kill(-Number(proc.pid), "SIGKILL")),
      }).then(() => {
        const end = () => {
          proc.stdout.destroy();
          proc.stderr.destroy();
          finish(null);
        };
        if (unkilled) end();
        else setTimeout(end, EXIT_DRAIN_MS).unref?.();
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, limit);
    const onAbort = () => {
      stopped = true;
      kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    proc.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += outDec.write(d);
    });
    proc.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += errDec.write(d);
    });
    const finish = (/** @type {number | null} */ code, /** @type {string} */ startError = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stdout += outDec.end();
      stderr += errDec.end();
      if (startError) {
        resolveP(done({ verdict: failed, note: `the hook could not start: ${startError}` }));
        return;
      }
      if (timedOut) {
        resolveP(done({ verdict: failed, note: `the hook did not finish within ${limit} ms${unkilled}${stderr.trim() ? ` — ${said(stderr)}` : ""}`, timedOut: true }));
        return;
      }
      // A hook stopped with the turn, or dead on a signal, never said allow: only a JSON verdict or an exit 0 does.
      if (stopped) {
        resolveP(done({ verdict: "block", note: `the hook was stopped with the turn before it finished${unkilled}` }));
        return;
      }
      const parsed = parseHookOutput(stdout);
      if (claude) {
        const v = claudeVerdict(hook.on, code, code === 0 ? parsed : null, stdout, stderr);
        const args = v.args && hook.on === "pre-tool" ? filamentArgs(String(payload.tool || ""), v.args) : null;
        resolveP(done({ verdict: v.verdict, note: said(v.note), args, exit: code }));
        return;
      }
      const output = said([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
      if (parsed) {
        const verdict = parsed.verdict === "block" ? "block" : "allow";
        const args = hook.on === "pre-tool" && parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? parsed.args : null;
        resolveP(done({ verdict, note: said(parsed.note ?? ""), args, exit: code }));
        return;
      }
      resolveP(done({ verdict: code === 0 ? "allow" : "block", note: code === 0 ? output : output || (code == null ? "the hook ended on a signal, without an exit code" : `exit ${code}`), exit: code }));
    };
    proc.on("error", (e) => finish(null, String(e?.message || e)));
    proc.on("close", (code) => finish(code));
    try {
      const stdin = JSON.stringify(claude ? claudeStdin(payload, MAX_STDIN_RESULT_CHARS) : {
        event: payload.event,
        tool: payload.tool ?? null,
        input: payload.input ?? null,
        result: payload.result == null ? null : String(payload.result).slice(0, MAX_STDIN_RESULT_CHARS),
        ...(payload.ok != null ? { ok: payload.ok } : {}),
        ...(payload.prompt != null ? { prompt: String(payload.prompt).slice(0, MAX_STDIN_RESULT_CHARS) } : {}),
        ...(payload.trigger ? { trigger: payload.trigger } : {}),
        round: payload.round ?? null,
        turn: payload.turn ?? null,
        session: payload.session ?? null,
        cwd: payload.cwd,
      });
      proc.stdin.on("error", () => {});
      proc.stdin.end(stdin);
    } catch {}
  });
}

/**
 * What the hooks that allowed said for the model to read — a plugin's at a chat's start or on the person's message, as
 * Claude adds them to its context; yours where they said a note — each under a line naming it, the whole at most
 * HOOK_CONTEXT_CHARS (Claude's own cap). "" when none said anything. @param {HookOutcome[]} outcomes
 */
export function hookContext(outcomes) {
  const parts = outcomes.filter((o) => o.verdict === "allow" && o.note.trim()).map((o) => `[${o.on} hook ${hookLabel(o)}]\n${o.note.trim()}`);
  const text = parts.join("\n\n");
  return text.length > HOOK_CONTEXT_CHARS ? `${text.slice(0, HOOK_CONTEXT_CHARS)}\n…[Filament: cut at ${HOOK_CONTEXT_CHARS.toLocaleString()} characters]` : text;
}
/** The most of what hooks said that reaches the model at one moment: Claude's 10,000. */
export const HOOK_CONTEXT_CHARS = 10_000;

/**
 * A hook as the model reads it in a result or a message: its command, or — a plugin's, whose command is a path into
 * Filament's copy of it — its plugin. @param {HookOutcome} o
 */
export const hookLabel = (o) => (o.plugin ? `of the plugin ${o.plugin}` : `\`${o.command}\``);

/** The one-line form the record, the ops log and the card use. @param {HookOutcome} o */
export function describeHook(o) {
  const head = `${o.on}${o.tool ? `(${o.tool})` : ""}${o.plugin ? ` [${o.plugin}]` : ""} ${o.command}`;
  const how = o.timedOut ? "timed out" : o.exit == null ? "did not run" : `exit ${o.exit}`;
  return `${head} → ${o.verdict} (${how}, ${o.ms} ms)${o.note ? ` — ${o.note.split(/\r?\n/)[0].slice(0, 200)}` : ""}`;
}

/**
 * @typedef {object} LoopHooks
 * @property {(tool: string, input: any, round: number) => Promise<HookOutcome[]>} pre
 * @property {(tool: string, input: any, result: string, ok: boolean, round: number) => Promise<HookOutcome[]>} post
 * @property {(round: number, wroteFiles: boolean) => Promise<HookOutcome[]>} turnEnd
 * @property {() => Promise<HookOutcome[]>} sessionStart
 * @property {(prompt: string) => Promise<HookOutcome[]>} promptSubmit  the person's message, before the model reads it
 * @property {(trigger: "manual" | "auto", round: number) => Promise<HookOutcome[]>} preCompact  before a compaction folds the work
 * @property {(round: number) => Promise<HookOutcome[]>} subagentEnd  a sub-agent's own run, as it would finish
 * @property {boolean} readBackBeforeDone
 * @property {boolean} [commands]  the document names a command to run at some moment: commands no call of the run says
 */

/**
 * The session's hooks as the loop calls them: each moment runs the document's hooks for it in order, in the project
 * folder, the event as their stdin. Null when the document names none (the loop then skips the whole mechanism). A
 * hook's note is outside text the model will read, so it is made through the session's redaction (`runHook`).
 * `modeNow`: the chat's permission mode, asked at each moment, as a switch made mid-turn reaches its next call.
 * @param {{ doc: any, cwd: string, session?: string | null, turn?: number | null, signal?: AbortSignal | null, redact?: ((text: string) => string) | null, modeNow?: (() => string) | null }} a
 * @returns {LoopHooks | null}
 */
export function createLoopHooks({ doc, cwd, session = null, turn = null, signal = null, redact = null, modeNow = null }) {
  const listed = Array.isArray(doc?.hooks) && doc.hooks.some((h) => h && HOOK_EVENTS.includes(h.on) && typeof h.command === "string" && h.command.trim());
  const verify = typeof doc?.loop?.verify?.afterEdits === "string" && doc.loop.verify.afterEdits.trim();
  const readBack = doc?.loop?.verify?.readBackBeforeDone === true;
  if (!listed && !verify && !readBack) return null;
  /**
   * @param {HookEvent} on @param {{ tool?: string | null, wroteFiles?: boolean, trigger?: "manual" | "auto" }} ctx @param {Record<string, any>} extra
   */
  const run = async (on, ctx, extra) => {
    /** @type {HookOutcome[]} */
    const out = [];
    for (const h of hooksFor(doc, on, ctx)) {
      const ran = await runHook(h, { event: on, cwd, session, turn, mode: modeNow?.() ?? null, ...extra }, { signal, redact });
      out.push(h.builtin ? { ...ran, builtin: h.builtin } : ran);
    }
    return out;
  };
  return {
    pre: (tool, input, round) => run("pre-tool", { tool }, { tool, input, round }),
    post: (tool, input, result, ok, round) => run("post-tool", { tool }, { tool, input, result, round, ok }),
    turnEnd: (round, wroteFiles) => run("turn-end", { wroteFiles }, { round }),
    sessionStart: () => run("session-start", {}, {}),
    promptSubmit: (prompt) => run("prompt-submit", {}, { prompt }),
    preCompact: (trigger, round) => run("pre-compact", { trigger }, { trigger, round }),
    subagentEnd: (round) => run("subagent-end", {}, { round }),
    readBackBeforeDone: readBack,
    commands: !!(listed || verify),
  };
}
