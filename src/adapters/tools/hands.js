// @ts-check
// The hands: the file/shell tools Filament executes server-side for the agent loop and its sub-agents. Its design
// contracts:
//   two independent output limits (2000 lines / the caller's byte budget — 50 KB unless it asks for less —,
//   whichever first), whole lines (only a single line wider than the whole budget is cut, and marked), and every
//   truncation notice names the exact next action; reads truncate from the HEAD ("continue with offset"),
//   bash from the TAIL (keep the error at the end) with the full output spilled to a temp file; edits are
//   exact-then-fuzzy string replacement with uniqueness enforcement; the model sees one result line while
//   artifacts stay with the harness.
// Everything is rooted: a tool call may only touch paths inside `root` (the chat's project folder, or a sub-agent's
// worktree). Plain fs and child_process.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
  createWriteStream,
} from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { join, resolve, dirname, relative, sep, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { Script, createContext } from "node:vm";
import { SHELL, POWERSHELL, SHELL_TAG, PS_SCRIPT_NAME, startCommand } from "./shell.js";
import { MediaResult, IMAGE_LABELS, IMAGE_MAX_BYTES, imageTypeOf, imageBlock, sizeWords } from "../../core/media.js";
import { PDFTOTEXT, PDF_PAGES_MAX, pdfPages, pageRange } from "./pdf.js";
import { editNotebook, isNotebookPath, notebookText, parseNotebook } from "./notebook.js";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
const GREP_MAX_LINE = 500;
const GREP_MAX_MATCHES = 100;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // read/edit refuse bigger files before loading them: the proxy must not OOM on a model's whim

import { HandError, filamentBelow, keptBelow, keptFolders, resolveInside } from "./fs-fence.js";
import { globToRegExp } from "../../core/path-glob.js";
import { keptOut } from "../../core/read-rules.js";
import { headBytes, tailBytes, headChars } from "../../core/text.js";
import { fewAtOnce } from "../../core/at-once.js";
import { LINE_MAX, createLineReader } from "../../core/lines.js";
export { HandError, resolveInside };

/**
 * What every shell tool's text says of the environment its command runs with (`safeEnv`, r-hands): a filtered copy, and
 * the way on where a command fails for a variable it does not pass — the person names it (`agentLoop.envPass`). One
 * sentence for bash, powershell and bash_background here, Filament's Bash over MCP (http/mcp.js) and a coding agent's
 * background_command (app/agent/commands.js), so with no em dash: a coding agent's tool texts have none (the owner's
 * tool plan of 11-08).
 */
export const ENV_WORDS = "The command runs with a filtered copy of the environment (what a build needs, no secrets): if it fails for a variable that is missing (a proxy with a password, a licence path, an SDK's home), name the variable and tell the person to add it under Settings › Agent loop › Variables passed to commands.";

/**
 * What the bash tool's description says of its shell (shell.js `SHELL`; the loop's Environment section names the same
 * one), so the model writes for the shell that really runs: a tool called "bash" that was cmd.exe underneath had it
 * writing grep, ls and /h/ paths (HarnessV3-SystemPrompt).
 * @param {import("./shell.js").Shell} shell
 */
export function bashDescription(shell) {
  const which = {
    "git-bash":
      "Run a bash command in the task folder with Git Bash (bash on Windows, from Git for Windows): grep, sed, awk, find, ls, cat, head, tail, xargs and pipes work as in bash. Paths take forward slashes: to bash, C:/Users/x and /c/Users/x are the same folder, but give Windows programs (node, npm, git, python) the C:/Users/x form — bash converts /c/… only where it stands alone as an argument, never inside quoted code. Write /dev/null, never NUL. cmd's built-ins (dir, type, copy) are not commands here.",
    cmd: "Run a command in the task folder with cmd.exe — Windows' command prompt, not bash: write cmd syntax (dir, type, findstr, where, %VAR%, &&, >nul 2>&1) and Windows paths (H:\\project\\src or src\\file.js); Unix forms like /c/Users or ~ are not paths here.",
    bash: "Run a bash command in the task folder with /bin/bash.",
    sh: "Run a command in the task folder with /bin/sh (POSIX sh: bash-only syntax needs bash -c '…').",
  }[shell.kind];
  return `${which} Each call starts in the task folder: a cd does not carry over to the next call. stdout and stderr are merged and the exit code is reported; a non-zero exit is an error. ${ENV_WORDS} Set timeout (seconds) for long commands; for commands that run longer than ten minutes, or that keep running (dev servers, watchers), use bash_background instead.`;
}

/**
 * What the powershell tool's description says (TL-D4): what it is for, and the syntax its edition lacks.
 * @param {import("./shell.js").PowerShell} ps
 */
export function powershellDescription(ps) {
  const edition =
    ps.kind === "pwsh"
      ? "It is PowerShell 7 (pwsh): &&, ||, the ternary and ?? work."
      : "It is Windows PowerShell 5.1: no &&, || (use ; and if ($?) { … }), no ternary, no ??; Set-Content and Add-Content write the ANSI code page unless given -Encoding utf8.";
  return `Run a PowerShell script in the task folder — for what is PowerShell's on Windows: processes with their command lines (Get-CimInstance Win32_Process), services, the registry, event logs, .NET. ${edition} Each call starts in the task folder. Output is UTF-8; errors print as text; the exit code is exit N's, or 1 when the last command failed, and a non-zero exit is an error. ${ENV_WORDS} Set timeout (seconds) for long scripts. For files use read, grep and glob; for everything else use bash.`;
}

/**
 * What one tool result may carry into a model's window, in UTF-8 bytes. The agent loop and its sub-agents ask the
 * hands for this budget (`maxBytes`), so every cut is the hand's own — whole lines, and a notice that names the
 * next action — rather than a slice taken afterwards that drops the notice with the tail. The web and MCP take it too.
 *
 * A caller's `redact` (a session's `privacy.redact`) is applied by each hand to what it read BEFORE its cut: redacting
 * after would let a secret straddling the cut show its first half unmatched, and a mark longer than what it replaces
 * would push the result past the budget and its notice off the end.
 */
export const RESULT_BUDGET_BYTES = 24_000;
/** Room a budget keeps for the hand's own notice (which lines, the next offset, the spill file, the exit code). */
const NOTICE_ROOM = 512;
/**
 * The bytes of CONTENT a caller's budget allows — the budget held between 1 KB and the hands' own 50 KB, less the
 * notice's room, so the result with its notice stays inside what the caller asked for.
 * @param {unknown} maxBytes
 */
const contentBudget = (maxBytes) => Math.max(1024, Math.min(MAX_BYTES, Math.floor(Number(maxBytes)) || MAX_BYTES)) - NOTICE_ROOM;
/**
 * How many of `lines`, from the first, fit `budget` bytes whole (a line and its newline); the first always counts —
 * its own limit is the caller's to check.
 * @param {string[]} lines @param {number} budget
 */
const headLinesWithin = (lines, budget) => {
  let bytes = 0;
  let n = 0;
  for (const l of lines) {
    bytes += Buffer.byteLength(l) + 1;
    if (bytes > budget && n > 0) break;
    n++;
  }
  return n;
};
/**
 * The last whole lines of a text within `budget` bytes and MAX_LINES — a final newline is not a line of its own — and
 * how the cut went. One line longer than the whole budget (minified output, a progress bar redrawn with carriage
 * returns) keeps its end: that is where an error is.
 * @param {string} text @param {number} budget
 * @returns {{ text: string, lines: number, kept: number, cutLine: boolean }}
 */
const tailLinesWithin = (text, budget) => {
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  let bytes = 0;
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    bytes += Buffer.byteLength(lines[i]) + 1;
    if ((bytes > budget && kept.length) || kept.length >= MAX_LINES) break;
    kept.unshift(lines[i]);
  }
  const cutLine = kept.length === 1 && Buffer.byteLength(kept[0]) > budget;
  if (cutLine) kept[0] = tailBytes(kept[0], budget);
  return { text: kept.join("\n"), lines: lines.length, kept: kept.length, cutLine };
};
/**
 * A background shell's output as the model reads it: the newest lines within the budget (what arrived last is what it
 * is waiting on), and the notice for what was left out.
 * @param {string} text @param {number} budget
 */
const newestOutput = (text, budget) => {
  const t = tailLinesWithin(text, budget);
  const left = text.replace(/\n$/, "").length - t.text.length;
  return `${left > 0 ? `[${left.toLocaleString()} earlier characters of this output are not shown — past this result's budget; redirect the command's output to a file to keep all of it]\n` : ""}${t.text}`;
};
/** Where the last guard cuts: the budget, plus room for what Filament adds after a source's own cut (the cap's pointer). */
const GUARD_BYTES = RESULT_BUDGET_BYTES + NOTICE_ROOM;
/**
 * The last guard over a tool result, for one that did not take a budget — an injected hand, a tool built elsewhere.
 * The hands, the web and MCP cut themselves to the budget with their own notice, so this bites only on something else,
 * and says so rather than cutting quietly. It leaves room for the cap's pointer (`loop.resultCapChars`), which follows
 * a head cut shorter than the budget, so it never takes that.
 * @param {string} text
 */
export const guardResult = (text) =>
  Buffer.byteLength(text) > GUARD_BYTES
    ? `${headBytes(text, GUARD_BYTES)}\n…[Filament: this result ran past the ${GUARD_BYTES.toLocaleString()} bytes one result may carry and was cut here; ask for less (a narrower range, search or query) and call again]`
    : text;

const GLOB_MAX_PATHS = 200;
const GLOB_LIMIT_MAX = 2000;
const GLOB_WALK_MAX_FILES = 20000;
/** How many of a listing's files have their time looked at side by side (sort: modified): the thread pool's four, and a few waiting. */
const GLOB_STATS_AT_ONCE = 16;
// Folders no listing wants: dependency trees, VCS internals and build output (the MCP server's Glob skips the same).
const GLOB_SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "venv", "target"]);

// ---- pi's edit machinery: exact first, then a cheap fuzzy pass; BOM and CRLF survive round trips ----
const normalizeFuzzy = (s) =>
  String(s)
    .normalize("NFKC")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ");
const splitBom = (s) => (s.charCodeAt(0) === 0xfeff ? ["\uFEFF", s.slice(1)] : ["", s]);
/**
 * A file's text for an edit: UTF-8, or none. Read another way and written back, each byte that is not UTF-8 would turn
 * into U+FFFD, in text the edit never touched (the bug report's L33). The BOM stays, for `splitBom`.
 * @param {Buffer} bytes @param {string} path
 */
const editableText = (bytes, path) => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new HandError(`${path} is not UTF-8 text, and an edit would rewrite the bytes it does not touch: change it with a command that keeps its encoding.`);
  }
};
/** Where `needle` starts in `hay`, each occurrence looked for after the end of the last. */
const occurrences = (hay, needle) => {
  const at = [];
  if (!needle) return at;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) at.push(i);
  return at;
};
const countOccurrences = (hay, needle) => occurrences(hay, needle).length;
// read's line prefix (TL-D6): cat -n's right-aligned number and a tab, or the arrow another harness prints.
const READ_PREFIX = /^ *\d+(?:\t|→)/;
const prefixed = (s) => {
  const lines = s.split("\n").filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => READ_PREFIX.test(l));
};
const unprefixed = (s) => s.split("\n").map((l) => l.replace(READ_PREFIX, "")).join("\n");
/**
 * An edit copied from read's output with the line prefix dropped: from its oldText when every line of it carries one,
 * and from its newText only when every line of that carries one too. Null when the oldText was not copied so.
 */
const withoutReadPrefix = (e) =>
  prefixed(e.oldText) ? { ...e, oldText: unprefixed(e.oldText), newText: prefixed(e.newText) ? unprefixed(e.newText) : e.newText } : null;
/** The words an edit's refusals name its fields in: the call's own spelling, ours or Claude Code's. */
const OUR_WORDS = { old: "oldText", new: "newText", all: "replaceAll" };
const CLAUDE_WORDS = { old: "old_string", new: "new_string", all: "replace_all" };
// Cheap models send malformed arguments (pi names Opus 4.6 and GLM-5.1): shim before validating.
const shimEdits = (raw) => {
  let e = raw;
  if (typeof e === "string") {
    try {
      e = JSON.parse(e);
    } catch {
      e = null;
    }
  }
  if (e && !Array.isArray(e) && typeof e === "object") {
    if (e.edits != null) return shimEdits(e.edits);
    e = [e];
  }
  if (!Array.isArray(e)) throw new HandError("edits must be an array of {oldText, newText}");
  // Claude Code's spelling of an edit (old_string, new_string, replace_all) is understood: models trained on it send
  // it, and the MCP server's Edit and the Cursor SDK's speak it. A call in it is refused in it.
  const words = e.some((x) => x?.oldText == null && x?.old_string != null) ? CLAUDE_WORDS : OUR_WORDS;
  const edits = e
    .map((x) => ({
      oldText: String(x?.oldText ?? x?.old_string ?? ""),
      newText: String(x?.newText ?? x?.new_string ?? ""),
      replaceAll: (x?.replaceAll ?? x?.replace_all) === true,
    }))
    .filter((x) => x.oldText);
  if (!edits.length) throw new HandError(`no usable edits in the call (each needs ${words.old} and ${words.new})`);
  return { edits, words };
};
/** An edit call's edits as the edit hand reads them, in any spelling it takes; none where it would refuse them. */
export const editsIn = (input) => {
  try {
    return shimEdits(input?.edits).edits;
  } catch {
    return [];
  }
};

// ---- tools (anthropic-shaped defs; frozen module constants so the appended bytes never drift) ----
export const HAND_TOOLS = Object.freeze([
  {
    name: "read",
    description:
      "Read a file. A text file's lines come numbered as cat -n numbers them: the line number right-aligned in six columns, a tab, then the line — the number is not part of the file. Line-based: offset is 1-indexed. Long files continue with offset. An image (PNG, JPEG, GIF or WebP, up to 3.75 MB) is shown to you as the image. A PDF comes as its text, page by page, without its pictures; pages picks them, at most 20 a call.",
    input_schema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "File path, relative to the task folder or absolute inside it.",
        },
        offset: { type: "number", description: "Line number to start from (1-indexed)." },
        limit: { type: "number", description: "Maximum lines to read." },
        pages: { type: "string", description: "A PDF's pages: 3, or a range like 3-7." },
      },
    },
  },
  {
    name: "write",
    description:
      "Write a file (new file or complete rewrite). An existing file is overwritten only if you have read it in this session and it has not changed since — otherwise read it first. For targeted changes use edit.",
    input_schema: {
      type: "object",
      required: ["path", "content"],
      properties: { path: { type: "string" }, content: { type: "string" } },
    },
  },
  {
    name: "edit",
    description:
      "Apply one or more exact string replacements to a file. Each oldText must be unique in the file — or set replaceAll to replace every occurrence — and must not overlap another edit. All edits are matched against the ORIGINAL content, then applied together. Copy oldText from read's output without the line-number prefix (the number and the tab before each line).",
    input_schema: {
      type: "object",
      required: ["path", "edits"],
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            required: ["oldText", "newText"],
            properties: {
              oldText: { type: "string", description: "Exact text to replace; must be unique in the file unless replaceAll is set." },
              newText: { type: "string", description: "Replacement text." },
              replaceAll: { type: "boolean", description: "Replace every occurrence of oldText (default false)." },
            },
          },
        },
      },
    },
  },
  {
    name: "bash",
    description: bashDescription(SHELL),
    input_schema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "The command to run, in that shell's syntax." },
        timeout: { type: "number", description: "Seconds to wait for it (default 120, max 600); past them it goes on in the background, and you are told when it exits." },
      },
    },
  },
  {
    name: "bash_background",
    description: `Start a command in the background, in the same shell as bash, and return at once with its early output — for dev servers, watchers and long builds that must not block the turn. The command keeps running across turns; read its new output with bash_output, stop it with bash_kill. ${ENV_WORDS}`,
    input_schema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "The command to run, in the syntax of the shell bash runs." },
        grace: { type: "number", description: "Seconds to wait for early output before returning (default 1.5, max 5)." },
        watch: { type: "string", description: "A regular expression: each new line of its output that matches it is told to you as it comes — at your next step while you work, or, once your turn has ended, in a turn Filament starts by itself. To follow a log, a test run or a deploy while you do other work." },
      },
    },
  },
  {
    name: "bash_output",
    description:
      "Read the new output of a background shell started with bash_background. Set wait (seconds, up to 30) to pause until more output lands or the shell exits — that is how you follow a server or a build. Set until (a regular expression) to wait instead for a line that matches it, such as the server's \"listening\" or the tests' summary, up to 300 s. A shell that exits without being read is reported to you once, at your next step.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: 'The background shell id, e.g. "bg_1a2b".' },
        wait: { type: "number", description: "Seconds to wait for new output or exit (default 0, max 30); with until, for the line (default 30, max 300)." },
        until: { type: "string", description: "A regular expression: wait until a new line of output matches it, the shell exits, or the wait ends." },
      },
    },
  },
  {
    name: "bash_kill",
    description: "Stop a background shell started with bash_background.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "The background shell id." } },
    },
  },
  ...(POWERSHELL
    ? [
        {
          name: "powershell",
          description: powershellDescription(POWERSHELL),
          input_schema: {
            type: "object",
            required: ["command"],
            properties: {
              command: { type: "string", description: "The PowerShell script; several lines are fine." },
              timeout: { type: "number", description: "Seconds to wait for it (default 120, max 600); past them it goes on in the background, and you are told when it exits." },
            },
          },
        },
      ]
    : []),
  {
    name: "grep",
    description:
      "Search file contents under the task folder: a regex (ripgrep's syntax), or plain text with literal: true. Results are sorted by path, paths relative to the task folder. output content (the default) shows each matching line as path:line:text — with context, before or after, the lines around it as path-line-text and groups apart with --; files lists the files that match; count gives each file's matching lines as path:N. Hidden and ignored files are skipped unless path names them. Past the limit, continue with offset.",
    input_schema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Folder or file to search; default the task folder." },
        glob: { type: "string", description: "Only files whose name matches this glob, e.g. *.ts; with a slash, the path below the folder searched (src/**/*.ts)." },
        type: { type: "string", description: "Only files of this ripgrep type, e.g. js, ts, py, rust, go, md." },
        output: { type: "string", enum: ["content", "files", "count"], description: "content (default), files or count." },
        context: { type: "number", description: "Lines shown before and after each match (content only; at most 50)." },
        before: { type: "number", description: "Lines shown before each match." },
        after: { type: "number", description: "Lines shown after each match." },
        multiline: { type: "boolean", description: "Let a match span lines; . matches a newline too." },
        ignoreCase: { type: "boolean" },
        literal: { type: "boolean" },
        limit: { type: "number", description: "Most entries shown: matches for content (default and at most 100), files for files and count (default 100, at most 500)." },
        offset: { type: "number", description: "Skip this many entries first, to continue past the limit." },
      },
    },
  },
  {
    name: "glob",
    description:
      "List files under the task folder whose path matches a glob. A pattern with a slash matches the path relative to the folder (src/**/*.js); one without matches the file name at any depth (*.md). Sorted by path, or newest first with sort: modified; node_modules, .git and build folders are skipped.",
    input_schema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Folder to list under; default the task folder." },
        sort: { type: "string", enum: ["path", "modified"], description: "path (default), or modified: the newest first." },
        limit: { type: "number", description: "Maximum paths (default 200)." },
      },
    },
  },
]);
const HAND_NAMES = new Set(HAND_TOOLS.map((t) => t.name));
export const isHandTool = (name) => HAND_NAMES.has(name);
/** The shell, in every form: a command now, one in the background, the two that read and stop a background one, and PowerShell. */
const SHELL_HANDS = new Set(["bash", "bash_background", "bash_output", "bash_kill", "powershell"]);
export const isShellHand = (name) => SHELL_HANDS.has(name);
/**
 * The hands that run a command the model wrote: the gate asks for them, and a rule on `bash` speaks for each (TL-D5).
 * @param {string} name
 */
export const isCommandHand = (name) => name === "bash" || name === "bash_background" || name === "powershell";

/**
 * A path as one word of a POSIX shell's command that the shell reads back as written: in double quotes, as the advice
 * lines write a path, unless the shell would change it there — a `$` or a backtick it expands, a `"` that ends the
 * quotes, a `\` before one of them or before another `\` (a UNC path's first two) — in single quotes then.
 * @param {string} path
 */
const posixPath = (path) => (/[$`"]|\\[$`"\\]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : `"${path}"`);

/**
 * The refusal for a file over the read cap. The cap is checked before any slicing, so `read` cannot open it at any
 * offset; the way on is the shell's own slicing, in the words of the shell the bash hand runs: cmd.exe has no sed
 * (HarnessV3 §14; HarnessV3-FixRound F1 item 8), and PowerShell's Get-Content streams the lines it is asked for. A `'`
 * in the path is doubled, as PowerShell reads one inside its single quotes; a POSIX shell's path is `posixPath`'s.
 * @param {string} path @param {number} bytes @param {import("./shell.js").Shell} [shell]
 */
export function tooBigToRead(path, bytes, shell = SHELL) {
  const slice =
    shell.kind === "cmd"
      ? `powershell -NoProfile -Command "Get-Content -LiteralPath '${path.replace(/'/g, "''")}' | Select-Object -Skip 0 -First 500" (raise -Skip to page on)`
      : `sed -n '1,500p' ${posixPath(path)} (then '501,1000p' and on)`;
  return `${path} is ${Math.round(bytes / 1048576)} MB, over the read tool's ${MAX_FILE_BYTES / 1048576} MB cap, so read cannot open it at any offset. Read it in slices with the bash tool: ${slice}`;
}

/**
 * What an agent has seen of the files `write` may overwrite (HarnessV3-Tools TL-D7): each file's size and modification
 * time when this agent last read, wrote or edited it, by path, and what it held (`sum`, none for a PDF, whose bytes are
 * never loaded). The caller keeps one per session and agent and hands it in as `seen`; a call without one (a test, a
 * one-off read) guards nothing. `abs`: the path as it was given (the key folds its case on Windows); `text`: a copy of
 * what it held, kept for the newest STALE_TEXTS files of at most STALE_TEXT_BYTES — what a change is told against
 * (`changedSightings`, agent/stale.js).
 * @typedef {Map<string, { size: number, mtimeMs: number, sum: string | null, abs?: string, text?: string }>} Sightings
 */
// Past these the least recently seen is dropped: the guard then asks for one more read, never lets a write through.
export const SIGHTINGS_LIMIT = 2_000;
export const SIGHTING_AGENTS_LIMIT = 128;
/** A copy of what a file held is kept for the newest STALE_TEXTS of an agent's files of at most STALE_TEXT_BYTES. */
export const STALE_TEXT_BYTES = 128 * 1024;
export const STALE_TEXTS = 50;
/** How many of an agent's newest sightings are looked at before a request (`changedSightings`). */
export const STALE_CHECKS = 200;
/** How many of its older ones are looked at too, in turn: each is compared within a few requests (the Hunter's find of 10-27). */
export const STALE_ROTATE = 100;
/** Where each agent's turn through its older sightings stands. @type {WeakMap<Sightings, number>} */
const staleTurn = new WeakMap();
/** A failed look that says the file is gone, not that it could not be looked at this time. @param {any} e */
const isGone = (e) => e?.code === "ENOENT" || e?.code === "ENOTDIR";
/**
 * A path as the guard keys it, under one spelling: resolved — a coding agent's tools name the same file `H:/x/a.txt` at
 * its read and `H:\x\a.txt` at its edit, or by way of a `./` (the review of 11-11: two sightings of one file, the
 * read's left behind by the agent's own edit and told as someone else's change) —, and Windows names a file the same in
 * any case. @param {string} abs
 */
const sightingKey = (abs) => {
  const one = resolve(abs);
  return process.platform === "win32" ? one.toLowerCase() : one;
};
/** @param {string} abs */
const stampOf = (abs) => {
  const s = statSync(abs);
  return { size: s.size, mtimeMs: s.mtimeMs };
};
/**
 * `stampOf` without blocking, for a caller that awaits: null where the look failed (`sawFile` then drops the
 * sighting, as a failed `stampOf` does); nothing to look at without a sighting to keep.
 * @param {Sightings | null | undefined} seen @param {string} abs
 * @returns {Promise<{ size: number, mtimeMs: number } | null | undefined>}
 */
const stampNow = async (seen, abs) => {
  if (!seen) return undefined;
  try {
    const s = await stat(abs);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
};
/** How many of an agent's sightings are looked at side by side (`changedSightings`): the thread pool's four, and a few waiting. */
const STALE_AT_ONCE = 16;
/**
 * What a file holds as a sighting compares it, its line endings as LF: a checkout that only wrote it again — the agent's
 * own copy restored for its follow-up, CRLF where git's settings say (HarnessV4_Worktrees_Plan, the E26 closing drive) —
 * is no change of its. The bytes are hashed as they are, a CR before an LF left out: the digest of the bytes with
 * their CRLFs replaced, without a copy of the whole file as text and another as the replaced text. @param {Buffer} bytes
 */
const sumOf = (bytes) => {
  const h = createHash("sha1");
  let from = 0;
  for (let cr = bytes.indexOf(13); cr >= 0; cr = bytes.indexOf(13, cr + 1))
    if (bytes[cr + 1] === 10) {
      h.update(bytes.subarray(from, cr));
      from = cr + 1;
    }
  return h.update(bytes.subarray(from)).digest("hex");
};
/**
 * The agent has the file as it is now; the oldest sighting goes past the limit. `bytes`: what it holds, where the
 * caller has them (a read's, a write's), for a later write to compare. `stamp`: its size and time, where the caller
 * looked already (null where that look failed: the sighting goes).
 * @param {Sightings | null | undefined} seen @param {string} abs @param {Buffer | null} [bytes]
 * @param {{ size: number, mtimeMs: number } | null} [stamp]
 */
const sawFile = (seen, abs, bytes = null, stamp) => {
  if (!seen) return;
  try {
    sawAs(seen, abs, heldOf(bytes), stamp);
  } catch {}
};
/**
 * What a sighting keeps of the bytes a file held: their sum, and a copy as text where they are text of at most
 * STALE_TEXT_BYTES — never the bytes themselves, which go once this is read off them. @param {Buffer | null} bytes
 */
const heldOf = (bytes) => ({ sum: bytes ? sumOf(bytes) : null, text: bytes && bytes.length <= STALE_TEXT_BYTES ? textOfBytes(bytes) : null });
/**
 * `sawFile`, from what a sighting keeps of the file's bytes (`heldOf`). May throw where the file cannot be looked at.
 * @param {Sightings} seen @param {string} abs @param {{ sum: string | null, text: string | null }} held
 * @param {{ size: number, mtimeMs: number } | null} [stamp]
 */
const sawAs = (seen, abs, held, stamp) => {
  const k = sightingKey(abs);
  seen.delete(k);
  if (stamp === null) return;
  seen.set(k, { ...(stamp || stampOf(abs)), sum: held.sum, abs, ...(held.text != null ? { text: held.text } : {}) });
  if (seen.size > SIGHTINGS_LIMIT) seen.delete(/** @type {string} */ (seen.keys().next().value));
  if (held.text != null) keepTexts(seen);
};
/** The sightings `sightFile` is still taking, by the agent's sightings: a look waits for them (`peekSightings`). @type {WeakMap<Sightings, Set<Promise<void>>>} */
const sighting = new WeakMap();
/**
 * The agent has the file as it is now, read here (c-news): a coding agent's own read or write, which its tools made, so
 * Filament looks at the file itself, without blocking. One past MAX_FILE_BYTES is seen by its size and time alone; one
 * not there, or no file, is seen not at all. Its size and time are the ones before its bytes were read: a write that
 * lands while they are read moves them, and the next look reads the file again (the review of 11-11). The next look
 * waits for it, so the agent's own edit just before is never taken for someone else's.
 * @param {Sightings | null | undefined} seen @param {string} abs @returns {Promise<void>}
 */
export function sightFile(seen, abs) {
  if (!seen) return Promise.resolve();
  const taking = sighting.get(seen) || new Set();
  sighting.set(seen, taking);
  const look = (async () => {
    try {
      const st = await stat(abs);
      if (!st.isFile()) return void forgetSighting(seen, abs);
      const bytes = st.size <= MAX_FILE_BYTES ? await readFile(abs) : null;
      sawFile(seen, abs, bytes, { size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      forgetSighting(seen, abs);
    }
  })().finally(() => taking.delete(look));
  taking.add(look);
  return look;
}
/** Bytes as text, or null where they are not (a NUL in them: an image, a binary). @param {Buffer} bytes */
const textOfBytes = (bytes) => {
  const t = bytes.toString("utf8");
  return t.includes("\0") ? null : t;
};
/** The agent no longer holds the file as it is: a write asks for a read first. @param {Sightings | null | undefined} seen @param {string} abs */
export const forgetSighting = (seen, abs) => void seen?.delete(sightingKey(abs));
/** The copies past STALE_TEXTS go, the least recently seen first. @param {Sightings} seen */
const keepTexts = (seen) => {
  let n = 0;
  for (const v of seen.values()) if (v.text != null) n++;
  for (const v of seen.values()) {
    if (n <= STALE_TEXTS) break;
    if (v.text != null) {
      delete v.text;
      n--;
    }
  }
};

/**
 * The files of an agent's sightings that changed since it last saw them, each once (the owner's word of 10-27: "It
 * doesn't notice when you change a file. Also make it work like claude"): of its newest `limit`, each whose time or
 * size moved and whose bytes did too, its line endings aside. One whose copy was kept comes with what it held and what
 * it holds, and its sighting moves to it — told the change, the agent may write it, as Claude Code's may; one with no
 * copy to compare, or no text to show, loses its sighting, so a write asks for a read first; one gone is said gone. A
 * file only touched moves its sighting and says nothing. Something else in its place — a folder — is said so. One the
 * system would not show this time (locked, refused, gone between a look and a read) is looked at again next time: a
 * look never fails the agent's turn. Of the older sightings past `limit`, the next `rotate` are looked at each time.
 * The files are looked at side by side, a few at a time, without blocking (`STALE_AT_ONCE`): every round of every
 * agent asks, and up to three hundred looks in a row held every other agent and request while they ran. What they
 * found is then taken in order, as one look after another would take it; a sighting the agent replaced meanwhile (a
 * read of its own) stands. A file read for a change keeps the size and time it had before it was read, as `sightFile`
 * keeps them.
 * @param {Sightings | null | undefined} seen @param {{ limit?: number, rotate?: number }} [o]
 * @returns {Promise<{ abs: string, was: string | null, now: string | null, gone?: boolean, notFile?: boolean }[]>}
 */
export async function changedSightings(seen, o = {}) {
  const { changes, commit } = await peekSightings(seen, o);
  commit();
  return changes;
}
/**
 * `changedSightings` as a look alone (c-news): the files that changed, and `commit`, which moves their sightings as
 * `changedSightings` does — for a caller that tells them with a prompt that may never go out (acp-turn.js: the agent's
 * own command sent as typed, a folder refused, an agent that fails first; checkpoint.js: a prompt that never went out
 * says nothing). Until it is called nothing moves, and the next look finds the same changes; a sighting the agent
 * replaced meanwhile (a read of its own) stands. A look first waits for the sightings `sightFile` is still taking.
 * A look keeps none of the bytes it read: of each file, what its sighting would keep (`heldOf`) — its caller may hold
 * `commit` for as long as a turn runs (the review of 11-11: every changed file's bytes stayed with it) —, and `commit`
 * lets go of that too.
 * @param {Sightings | null | undefined} seen @param {{ limit?: number, rotate?: number }} [o]
 * @returns {Promise<{ changes: { abs: string, was: string | null, now: string | null, gone?: boolean, notFile?: boolean }[], commit: () => void }>}
 */
export async function peekSightings(seen, { limit = STALE_CHECKS, rotate = STALE_ROTATE } = {}) {
  const taking = seen ? sighting.get(seen) : null;
  if (taking?.size) await Promise.all(taking);
  if (!seen?.size) return { changes: [], commit: () => {} };
  const keys = [...seen.keys()];
  const older = keys.slice(0, Math.max(0, keys.length - limit));
  const from = older.length ? (staleTurn.get(seen) || 0) % older.length : 0;
  const inTurn = older.length ? Array.from({ length: Math.min(rotate, older.length) }, (_, i) => older[(from + i) % older.length]) : [];
  /**
   * One sighting's file as it is: its stat (null: gone), and where its size or time moved, its bytes or why they could
   * not be read. Null for one that did not move, or that the system would not show this time.
   * @param {string} k
   */
  const look = async (k) => {
    const had = seen.get(k);
    if (!had?.abs) return null;
    /** @type {import("node:fs").Stats | null} */
    let st = null;
    try {
      st = await stat(had.abs);
    } catch (e) {
      if (!isGone(e)) return null;
    }
    if (!st || !st.isFile()) return { k, had, st, bytes: null, readFailed: null };
    if (st.size === had.size && st.mtimeMs === had.mtimeMs) return null;
    /** @type {Buffer | null} */
    let bytes = null;
    if (had.sum != null && st.size <= MAX_FILE_BYTES)
      try {
        bytes = await readFile(had.abs);
      } catch (e) {
        return { k, had, st, bytes: null, readFailed: e };
      }
    return { k, had, st, bytes, readFailed: null };
  };
  const looked = await fewAtOnce([...inTurn, ...keys.slice(-limit)], look, STALE_AT_ONCE);
  /** @type {{ abs: string, was: string | null, now: string | null, gone?: boolean, notFile?: boolean }[]} */
  const out = [];
  /**
   * What each sighting becomes once the changes are told, but one the agent replaced by then: the file as it was read
   * (`read`: what a sighting keeps of it), or none.
   * @type {{ k: string, had: unknown, abs: string, read: { held: { sum: string | null, text: string | null }, stamp: { size: number, mtimeMs: number } } | null }[]}
   */
  const moves = [];
  for (const x of looked) {
    if (!x || seen.get(x.k) !== x.had) continue;
    const { k, had, st, bytes } = x;
    const abs = /** @type {string} */ (had.abs); // `look` answers only a sighting with its path
    if (!st || !st.isFile()) {
      moves.push({ k, had, abs, read: null });
      out.push({ abs, was: had.text ?? null, now: null, ...(st ? { notFile: true } : { gone: true }) });
      continue;
    }
    if (x.readFailed) {
      if (isGone(x.readFailed)) {
        moves.push({ k, had, abs, read: null });
        out.push({ abs, was: had.text ?? null, now: null, gone: true });
      }
      continue;
    }
    const read = bytes ? { held: heldOf(bytes), stamp: { size: st.size, mtimeMs: st.mtimeMs } } : null;
    if (read && read.held.sum === had.sum) {
      moves.push({ k, had, abs, read });
      continue;
    }
    const now = read?.held.text ?? null;
    moves.push({ k, had, abs, read: had.text != null && now != null ? read : null });
    out.push({ abs, was: had.text ?? null, now });
  }
  let moved = false;
  return {
    changes: out,
    commit: () => {
      if (moved) return;
      moved = true;
      staleTurn.set(seen, from + inTurn.length);
      for (const m of moves.splice(0)) {
        if (seen.get(m.k) !== m.had) continue;
        try {
          if (m.read) sawAs(seen, m.abs, m.read.held, m.read.stamp);
          else seen.delete(m.k);
        } catch {}
      }
    },
  };
}
/**
 * Each agent's `Sightings` across its turns, by a key the caller makes (its session and agent): what the turn layer
 * keeps. In memory only — after a restart one read gives a file back — and the least recently used agent dropped.
 * @returns {(key: string) => Sightings}
 */
export const createSightingsKeeper = (limit = SIGHTING_AGENTS_LIMIT) => {
  /** @type {Map<string, Sightings>} */
  const all = new Map();
  return (key) => {
    const seen = all.get(key) || new Map();
    all.delete(key);
    all.set(key, seen);
    if (all.size > limit) all.delete(/** @type {string} */ (all.keys().next().value));
    return seen;
  };
};

/** A file's first `n` bytes, as latin1 (one character a byte), read without blocking. @param {string} abs @param {number} n */
const headOf = async (abs, n) => {
  const fh = await open(abs, "r");
  try {
    const b = Buffer.alloc(n);
    return b.subarray(0, (await fh.read(b, 0, n, 0)).bytesRead).toString("latin1");
  } finally {
    await fh.close();
  }
};

/**
 * A PDF's text, page by page (HarnessV3-Tools TL-D26): `pages` picks them, at most PDF_PAGES_MAX a call; without it,
 * from the first, as many as the result's budget holds, with a note naming the next range. Each page comes under its
 * own line, and its lines are not numbered: a PDF is not text to edit. Its pictures and layout are not read.
 * @param {any} input @param {string} abs @param {number} budget @param {import("node:fs").Stats} st  the read's look at it
 * @param {{ redact?: ((text: string) => string) | null, seen?: Sightings | null, signal?: AbortSignal | null, pdftotext?: string | null }} opts
 * @returns {Promise<string>}
 */
const readPdf = async (input, abs, budget, st, opts) => {
  const path = String(input.path);
  const asked = pageRange(input.pages);
  const pdftotext = opts.pdftotext === undefined ? PDFTOTEXT : opts.pdftotext;
  if (!pdftotext)
    throw new HandError(`${path} is a PDF, and read takes a PDF's text with pdftotext, which this machine doesn't have (Git for Windows ships it; elsewhere it comes with poppler). Convert the PDF to text another way.`);
  /** @type {string[]} */
  let pages;
  try {
    pages = await pdfPages(abs, { pdftotext, size: st.size, mtimeMs: st.mtimeMs, signal: opts.signal });
  } catch (e) {
    throw new HandError(`${path}: pdftotext could not read this PDF — ${/** @type {Error} */ (e).message}`);
  }
  sawFile(opts.seen, abs, null, await stampNow(opts.seen, abs));
  const total = pages.length;
  const plural = (/** @type {number} */ n) => `${n} page${n === 1 ? "" : "s"}`;
  if (!total) return `[${path} is a PDF with no pages.]`;
  const from = asked ? asked.from : 1;
  if (from > total) return `[${path} has ${plural(total)}; page ${from} is past its end.]`;
  const to = Math.min(total, asked ? asked.to : total, from + PDF_PAGES_MAX - 1);
  // The whole document is redacted, as a text file is: a pattern may run across a page's end.
  const all = opts.redact ? opts.redact(pages.join("\f")).split("\f") : pages;
  const page = (/** @type {number} */ n) => {
    const text = String(all[n - 1] ?? "").replace(/\s+$/, "");
    return text.trim() ? `--- page ${n} ---\n${text}` : `--- page ${n} (no text: a scan or a picture, which read can't see) ---`;
  };
  const next = (/** @type {number} */ last) => (last < total ? ` Use pages: "${last + 1}-${Math.min(total, last + PDF_PAGES_MAX)}" to continue.` : "");
  const first = page(from);
  // A page past the whole budget (a dense table) shows its head, and the note says how to take the rest with bash.
  if (Buffer.byteLength(first) > budget) {
    const head = headBytes(first, budget);
    return `${head}\n[Page ${from} of ${total} is ${Buffer.byteLength(first).toLocaleString()} bytes of text; its first ${Buffer.byteLength(head).toLocaleString()} are shown. For the rest, take that page with bash: pdftotext -f ${from} -l ${from} ${SHELL.kind === "cmd" ? `"${path}"` : posixPath(path)} - and search it.${next(from)}]`;
  }
  const shown = [first];
  let used = Buffer.byteLength(first);
  for (let n = from + 1; n <= to; n++) {
    const p = page(n);
    if (used + 2 + Buffer.byteLength(p) > budget) break;
    shown.push(p);
    used += 2 + Buffer.byteLength(p);
  }
  const last = from + shown.length - 1;
  return shown.join("\n\n") + (last < total ? `\n\n[Showing pages ${from}-${last} of ${total}.${next(last)}]` : "");
};

/**
 * A line's number as a read shows it: as cat -n numbers lines (HarnessV3-Tools TL-D6), the form models are trained on
 * and what lets the agent name a line. The read hand and the files brought back after a summary both use it.
 * @param {number} n
 */
export const lineNumber = (n) => `${String(n).padStart(6)}\t`;

/**
 * The lines of `text` a read shows — at most `limit` from line `from` (1-based) — and how many it has, counted as
 * `text.split("\n")` counts them, less the empty one after a trailing newline. The lines past the window are counted,
 * never copied: a read of a page of a file of a hundred thousand lines split all of them, at every page.
 * @param {string} text @param {number} from @param {number} limit
 */
const linesOf = (text, from, limit) => {
  /** @type {string[]} */
  const lines = [];
  let total = 0;
  for (let at = 0; at < text.length; ) {
    const nl = text.indexOf("\n", at);
    total++;
    if (total >= from && lines.length < limit) lines.push(text.slice(at, nl < 0 ? text.length : nl));
    if (nl < 0) break;
    at = nl + 1;
  }
  return { total, lines };
};

/**
 * A Git LFS pointer's size, from its bytes (its spec, v1: under 1 KB, its version line first, its oid and its size),
 * or null for any other file.
 * @param {Buffer} bytes
 */
const lfsPointerOf = (bytes) => {
  if (bytes.length >= 1024) return null;
  const text = bytes.toString("latin1");
  const size = /\nsize (\d+)\n/.exec(text);
  return text.startsWith("version https://git-lfs.github.com/spec/v1\n") && /\noid sha256:[0-9a-f]{64}\n/.test(text) && size ? { size: Number(size[1]) } : null;
};

/**
 * What fetches the file a Git LFS pointer in a builder's copy stands for, in its place (worktree.js `fetchLfsFile`):
 * not fetched, `lfs` false where git does not keep the file through LFS, else why.
 * @typedef {(abs: string) => Promise<{ ok: true } | { ok: false, lfs: boolean, error: string }>} FetchLfs
 */

/**
 * @param {any} input @param {string} root @param {{ maxBytes?: number, redact?: ((text: string) => string) | null, seen?: Sightings | null, signal?: AbortSignal | null, pdftotext?: string | null, fenced?: boolean, reads?: readonly string[], theirs?: boolean, shell?: import("./shell.js").Shell | null, fetchLfs?: FetchLfs | null }} [opts]
 * @returns {Promise<string | MediaResult>}
 */
const opRead = async (input, root, opts = {}) => {
  const budget = contentBudget(opts.maxBytes);
  const abs = resolveInside(root, input.path, { fenced: opts.fenced, reads: opts.reads, theirs: opts.theirs });
  // Read without holding the event loop: a reply's reads run side by side, and a slow disk's wait is each one's alone
  // (the Hunter's find of 10-27: read in one go, the batch's reads ran one after another). One look at the file serves
  // the checks below.
  /** @type {import("node:fs").Stats | null} */
  let st = null;
  try {
    st = await stat(abs);
  } catch {}
  if (!st?.isFile()) throw new HandError(`no such file: ${input.path}`);
  // A PDF is read through pdftotext at any size (TL-D26): its bytes never load into Filament, only its text.
  if ((await headOf(abs, 5)) === "%PDF-") return readPdf(input, abs, budget, st, opts);
  if (st.size > MAX_FILE_BYTES) throw new HandError(tooBigToRead(String(input.path), st.size, opts.shell || SHELL));
  const bytes = await readFile(abs);
  // A Git LFS pointer in a builder's copy, which holds them where the developer's folder has the files (Phase 0 of the
  // owner's 11-09 plan for big repos): the file is fetched in its place and read, as the developer would read it.
  const lfs = opts.fetchLfs ? lfsPointerOf(bytes) : null;
  if (lfs && opts.fetchLfs) {
    const path = String(input.path);
    if (lfs.size > MAX_FILE_BYTES)
      throw new HandError(`${path} is a Git LFS pointer to a file of ${Math.round(lfs.size / 1048576)} MB, over the read tool's ${MAX_FILE_BYTES / 1048576} MB cap: Filament did not fetch it. To have it in the copy, run git lfs pull --include "${path}" with the bash tool, then take the part you need from it there.`);
    const got = await opts.fetchLfs(abs);
    if (got.ok) return opRead(input, root, { ...opts, fetchLfs: null });
    if (got.lfs) throw new HandError(`${path} is a Git LFS pointer, and Filament could not fetch the file it stands for (${got.error}). Its pointer reads:\n${bytes.toString("utf8")}`);
  }
  // An image is shown, known by its first bytes, never its name (HarnessV3-Tools TL-D17): the loop puts it in the
  // tool_result after the line naming it. Its bytes are not text, so redaction has nothing to read in them.
  const type = imageTypeOf(bytes);
  if (type) {
    const label = IMAGE_LABELS[type];
    if (bytes.length > IMAGE_MAX_BYTES)
      throw new HandError(`${input.path} is a ${label} image of ${sizeWords(bytes.length)}, past the ${IMAGE_MAX_BYTES / 1048576} MB an image may have. Make a smaller copy (scaled down, or as JPEG) and read that.`);
    sawFile(opts.seen, abs, bytes, await stampNow(opts.seen, abs));
    return new MediaResult(`[${input.path}: a ${label} image, ${sizeWords(bytes.length)}.]`, [imageBlock(type, bytes.toString("base64"))]);
  }
  const raw = bytes.toString("utf8");
  if (raw.includes("\0"))
    throw new HandError(`${input.path} looks like a binary file; use bash to inspect it`);
  sawFile(opts.seen, abs, bytes, await stampNow(opts.seen, abs));
  // A notebook reads as its cells with their outputs (notebook.js, as Claude Code's Read shows one), numbered as a
  // file's lines are; one whose JSON is not a notebook's reads as the text it is.
  const nb = isNotebookPath(input.path) ? parseNotebook(raw) : null;
  const shown = nb ? notebookText(nb, String(input.path)) : raw;
  // The whole file is redacted, not the lines shown: a pattern may span lines, and every read of the file must number
  // its lines the same way for an offset to continue where the last one stopped.
  const text = opts.redact ? opts.redact(shown) : shown;
  if (!text) return `[${input.path} is empty.]`;
  const from = Math.max(1, Math.floor(Number(input.offset) || 1));
  const limit = Math.min(Math.floor(Number(input.limit) || MAX_LINES) || MAX_LINES, MAX_LINES);
  const { total, lines } = linesOf(text, from, limit);
  if (from > total) return `[${input.path} has ${total} line${total === 1 ? "" : "s"}; offset ${from} is past its end.]`;
  // The numbers are part of what is carried, so they count inside the budget.
  const asked = lines.map((l, i) => lineNumber(from + i) + l);
  const tooWide = asked.findIndex((l) => Buffer.byteLength(l) > budget);
  // A line wider than the whole budget (minified code, one-line JSON) cannot be carried whole: asked for first, its
  // head is shown and marked; further down, the read stops short of it and the notice continues from it.
  if (tooWide === 0) {
    const line = lines[0];
    const head = headBytes(line, budget - lineNumber(from).length);
    return `${lineNumber(from)}${head}\n[Line ${from} of ${total} is ${Buffer.byteLength(line).toLocaleString()} bytes; its first ${Buffer.byteLength(head).toLocaleString()} are shown. Search inside it with grep${from < total ? `, or use offset=${from + 1} to continue after it` : ""}.]`;
  }
  // Whole lines within the budget, stopping short of a line too wide to carry: the notice below continues from it.
  const fit = headLinesWithin(tooWide > 0 ? asked.slice(0, tooWide) : asked, budget);
  const slice = asked.slice(0, fit);
  const last = from + slice.length - 1;
  const note =
    last < total
      ? `\n[Showing lines ${from}-${last} of ${total}. Use offset=${last + 1} to continue.]`
      : "";
  return slice.join("\n") + note;
};

/**
 * A whole-file write. With `seen`, an existing file is overwritten only as this agent last saw it (TL-D7): never one it
 * has not read, written or edited, nor one that changed since — the developer's work, or a command's output. A file
 * whose time or size moved while it holds what the agent saw, its line endings aside, has not changed (Claude Code's
 * guard compares so too): its own copy checked out again for a follow-up rewrites every file of its work.
 * @param {any} input @param {string} root @param {{ seen?: Sightings | null, fenced?: boolean }} [opts]
 */
const opWrite = (input, root, opts = {}) => {
  const abs = resolveInside(root, input.path, { fenced: opts.fenced });
  if (opts.seen && existsSync(abs) && statSync(abs).isFile()) {
    const had = opts.seen.get(sightingKey(abs));
    if (!had)
      throw new HandError(`${input.path} already exists and you have not read it in this session: read it first, then write — or edit the part you mean to change.`);
    const now = stampOf(abs);
    const moved = now.size !== had.size || now.mtimeMs !== had.mtimeMs;
    if (moved && !(had.sum && now.size <= MAX_FILE_BYTES && sumOf(readFileSync(abs)) === had.sum))
      throw new HandError(`${input.path} changed since you last read it (a command, the developer or another process wrote it): read it again before you overwrite it.`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  const content = String(input.content ?? "");
  writeFileSync(abs, content, "utf8");
  sawFile(opts.seen, abs, Buffer.from(content, "utf8"));
  return `Successfully wrote to ${input.path} (${Buffer.byteLength(content)} bytes)`;
};

const opEdit = (input, root, opts = {}) => {
  const abs = resolveInside(root, input.path, { fenced: opts.fenced });
  // Read, changed and written in one go, never handing the event loop on: agents side by side (sub-agents, other
  // chats) editing one file each see the other's edit whole. One look serves both checks.
  /** @type {import("node:fs").Stats | null} */
  let st = null;
  try {
    st = statSync(abs);
  } catch {}
  if (!st?.isFile()) throw new HandError(`no such file: ${input.path}`);
  if (st.size > MAX_FILE_BYTES)
    throw new HandError(
      `${input.path} is too large to edit in one call (${Math.round(st.size / 1048576)} MB)`,
    );
  const { edits, words } = shimEdits(input.edits);
  const raw = editableText(readFileSync(abs), input.path);
  // A notebook is edited within its cells' sources, as read shows them, and written back as the notebook it was.
  if (isNotebookPath(input.path) && parseNotebook(raw)) {
    const got = editNotebook(raw, edits, { path: String(input.path), old: words.old, all: words.all }, withoutReadPrefix);
    if ("error" in got) throw new HandError(got.error);
    writeFileSync(abs, got.text, "utf8");
    sawFile(opts.seen, abs, Buffer.from(got.text, "utf8"));
    return `Successfully replaced ${got.replaced} block${got.replaced === 1 ? "" : "s"} in ${input.path} (cell${got.cells.length === 1 ? "" : "s"} ${got.cells.join(", ")})`;
  }
  const [bom, body] = splitBom(raw);
  const norm = body.replace(/\r\n/g, "\n");
  // In a file whose every line ends in CRLF the replacement's lines end so too (TL-D16); a mixed file is left as it is.
  const crlf = body.includes("\r\n") && !/(?<!\r)\n/.test(body);
  const fitEnds = (/** @type {string} */ t) => (crlf ? t.replace(/\r?\n/g, "\r\n") : t);
  const exactSplices = []; // matched on norm, spliced into the ORIGINAL bytes: untouched text keeps its endings
  const fuzzyEdits = []; // fall back to whole-line replacement on the post-exact text
  for (const [i, sent] of edits.entries()) {
    // read's line prefix copied into the edit is dropped — only when the text as sent is not in the file, so a file
    // whose own lines look like that (tab-separated data) is matched as it is (TL-D6).
    const e = countOccurrences(norm, sent.oldText) ? sent : withoutReadPrefix(sent) || sent;
    const exact = occurrences(norm, e.oldText);
    if (exact.length > 1 && !e.replaceAll)
      throw new HandError(
        `Found ${exact.length} occurrences of the text in ${input.path}. The text must be unique. Please provide more context to make it unique, or set ${words.all} to replace every one.`,
      );
    if (exact.length) {
      for (const at of exact) exactSplices.push({ start: at, end: at + e.oldText.length, newText: fitEnds(e.newText), edit: i });
      continue;
    }
    fuzzyEdits.push(e);
  }
  exactSplices.sort((a, b) => a.start - b.start);
  for (let i = 1; i < exactSplices.length; i++)
    if (exactSplices[i].start < exactSplices[i - 1].end)
      throw new HandError(`edits ${Math.min(exactSplices[i - 1].edit, exactSplices[i].edit)} and ${Math.max(exactSplices[i - 1].edit, exactSplices[i].edit)} overlap; merge them into one edit`);
  // Map a norm offset to the same character in body (body's \r\n pairs are one \n in norm), walking forward once: the
  // splices come in order, and each offset asked is past the last. From each CRLF to the next, body runs as norm does,
  // one pair behind for each CRLF passed. Walked from the start for each end of each match, and the whole text copied
  // for each splice, a replaceAll in a CRLF file of thousands of lines took seconds.
  let np = 0;
  let bp = 0;
  let pair = body.indexOf("\r\n");
  const toBody = (/** @type {number} */ nIdx) => {
    while (pair >= 0 && np + (pair - bp) < nIdx) {
      np += pair - bp + 1;
      bp = pair + 2;
      pair = body.indexOf("\r\n", bp);
    }
    return bp + (nIdx - np);
  };
  /** @type {string[]} */
  const parts = [];
  let kept = 0;
  for (const s of exactSplices) {
    parts.push(body.slice(kept, toBody(s.start)), s.newText);
    kept = toBody(s.end);
  }
  parts.push(body.slice(kept));
  let out = parts.join("");
  let replaced = exactSplices.length;
  if (fuzzyEdits.length) {
    // Re-find on the post-exact text: exact edits shift everything after them. A fuzzy match is spliced at the span it
    // matched, never widened over text the edit did not send (TL-D16): normalizing swaps characters one for one and
    // drops trailing blanks, so on a line NFKC leaves as it is the match's columns are the file's own. Inside a line
    // NFKC changes they are not, and such a match is taken only when it covers whole lines.
    for (const e of fuzzyEdits) {
      const n2 = out.replace(/\r\n/g, "\n");
      const f2 = normalizeFuzzy(n2);
      const needle = normalizeFuzzy(e.oldText);
      if (!needle) throw new HandError(`an edit's ${words.old} is empty after normalization`);
      const hits = occurrences(f2, needle);
      if (hits.length === 0)
        throw new HandError(
          `${words.old} not found in ${input.path} (exact and fuzzy). Read the file and copy the text exactly.`,
        );
      if (hits.length > 1 && !e.replaceAll)
        throw new HandError(
          `Found ${hits.length} occurrences of the text in ${input.path}. The text must be unique. Please provide more context to make it unique, or set ${words.all} to replace every one.`,
        );
      const lines = out.split("\n"); // \r stays attached to CRLF lines' content
      const fLines = f2.split("\n");
      const lineAt = [];
      for (let i = 0, at = 0; i < fLines.length; at += fLines[i].length + 1, i++) lineAt.push(at);
      // The last line starting at or before `at`, found by halves: the starts only grow.
      const lineOf = (/** @type {number} */ at) => {
        let lo = 0;
        let hi = lineAt.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (lineAt[mid] <= at) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      };
      const body = (/** @type {number} */ i) => lines[i].replace(/\r$/, "");
      const keepsColumns = lines.map((_, i) => body(i).normalize("NFKC") === body(i));
      // Last first: a splice changes only its own lines and what follows its match, so the earlier matches still hold.
      for (const at of hits.reverse()) {
        const sl = lineOf(at);
        const el = lineOf(at + needle.length);
        const sc = at - lineAt[sl];
        const ec = at + needle.length - lineAt[el];
        const placed = keepsColumns[sl] && keepsColumns[el];
        if (!placed && !(sc === 0 && ec === fLines[el].length))
          throw new HandError(
            `${words.old} matches ${input.path} only once line ${sl + 1} is normalized, and normalizing changes that line's characters, so the match cannot be placed exactly. Copy the text exactly from read's output.`,
          );
        const cr = /\r$/.test(lines[el]) ? "\r" : "";
        const merged = `${placed ? body(sl).slice(0, sc) : ""}${fitEnds(e.newText)}${placed ? body(el).slice(ec) : ""}${cr}`;
        lines.splice(sl, el - sl + 1, ...merged.split("\n"));
        replaced++;
      }
      out = lines.join("\n");
    }
  }
  writeFileSync(abs, bom + out, "utf8");
  sawFile(opts.seen, abs, Buffer.from(bom + out, "utf8"));
  return `Successfully replaced ${replaced} block${replaced === 1 ? "" : "s"} in ${input.path}`;
};

// The environment a hand's command runs in: the loop's shells, a background command, a terminal a coding agent asks
// for, Filament's Bash over MCP, a hook, an MCP server, a language server, a dashboard's command, a script watcher's
// program. The command is a model's choice, or a program started in a folder that may be anyone's, so it must not
// inherit the secrets in Filament's environment: the keys and tokens it was started with (an ANTHROPIC_API_KEY, a
// GITHUB_TOKEN, a cloud's credentials). The rule (r-hands, 11-12): what a build, a test or git needs and that is no
// secret value goes through. By its name (`ENV_KEEP`): a name on the list is vouched for by the list, whatever it
// reads like (SSH_AUTH_SOCK, GIT_AUTHOR_NAME). Or by its family's prefix (LC_*, npm_config_*, GIT_*), where a name
// that reads like a secret stays out (`SECRETISH`: npm_config__authToken, GIT_PAT). Either way a value that is an
// address with a password in it, or with a token for its user, stays out (`WITH_PASSWORD`: a proxy's, a registry's).
// Git's config by environment and Filament's own variables stay out. What the list does not know, the person names
// (`agentLoop.envPass`, `envPassFrom`): a name there goes through whatever it reads like or holds, Filament's own
// aside. Until 11-12 the list was a shell's bare needs and `auth` in SECRETISH took git's author with the tokens: an
// `npm install` behind a proxy, or a commit with its author set, passed in a coding agent's own shell, which keeps its
// agent's whole environment, and failed here.
/**
 * The words by which a family's name reads like a secret, one table. `anywhere`: wherever in the name they stand
 * (npm_config__authToken). `alone`: only as a part of their own, the name split at `_` (GIT_PAT, GIT_HTTP_PASS, GIT_PWD,
 * GIT_CREDS; the second read of 11-12) — words short enough that other names hold their letters by chance, and those
 * names pass: GIT_EXEC_PATH, GIT_ASKPASS.
 */
const SECRET_WORDS = Object.freeze({
  anywhere: ["key", "token", "secret", "password", "passwd", "passphrase", "credential", "auth", "session", "cookie", "private"],
  alone: ["pat", "pass", "pwd", "cred", "creds"],
});
const SECRETISH = new RegExp(`${SECRET_WORDS.anywhere.join("|")}|(?:^|_)(?:${SECRET_WORDS.alone.join("|")})(?:_|$)`, "i");
/** From how many characters an address's user, alone, is read as a token: a person's or an organisation's name is shorter. */
const TOKEN_USER_MIN = 20;
/**
 * An address with a password in it — `scheme://user:pass@host` —, or with a token for its user alone, no colon after
 * it — `scheme://<TOKEN_USER_MIN characters or more>@host`, as a registry's or a mirror's token rides —: a secret,
 * whatever its variable is named. A short user alone (`https://me@dev.azure.com/…`) is a name.
 */
const WITH_PASSWORD = new RegExp(`[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#@\\s]*:[^\\/?#@\\s]*|[^\\/?#@\\s]{${TOKEN_USER_MIN},})@`, "i");
/** The proxies' variables, as programs read them in capitals; curl reads the lower-case spelling alone. */
const PROXIES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
// What a shell needs to do real work: paths, the Windows system folders (npm's global prefix lives in APPDATA,
// pnpm/yarn caches in LOCALAPPDATA), locale, and the usual toolchain homes. Nothing whose value is a secret, ever.
const ENV_KEEP = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "PATHEXT",
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "JAVA_HOME",
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "ProgramData",
  "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  // From here on, r-hands of 11-12, a family a line. The Windows folders the list had half of.
  ..."ProgramW6432 CommonProgramFiles(x86) CommonProgramW6432".split(" "),
  // Proxies, in either case: one whose address carries a password stays out by its value (`holdsPassword`).
  ...PROXIES,
  ...PROXIES.map((k) => k.toLowerCase()),
  // Certificate bundles, each a path: behind a proxy that signs again nothing is fetched without them.
  ..."NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR REQUESTS_CA_BUNDLE CURL_CA_BUNDLE AWS_CA_BUNDLE".split(" "),
  // The ssh agent's socket: git over ssh is an ordinary push, and GIT_SSH_COMMAND goes through already. The agent
  // signs for a command; it hands no key out.
  ..."SSH_AUTH_SOCK SSH_AGENT_PID".split(" "),
  // Git's author and committer, which "auth" took with the tokens: a commit's author override was lost.
  ..."GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE".split(" "),
  // Who and where, and how a terminal's programs behave. XAUTHORITY is a file's path, without which DISPLAY opens nothing.
  ..."USER LOGNAME USERNAME USERDOMAIN HOSTNAME COMPUTERNAME OS DISPLAY WAYLAND_DISPLAY XAUTHORITY".split(" "),
  ..."XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR COLORTERM NO_COLOR FORCE_COLOR CI EDITOR VISUAL PAGER".split(" "),
  // Toolchain and SDK homes, search paths and a build's own settings: paths, names and flags. Android, .NET.
  ..."ANDROID_HOME ANDROID_SDK_ROOT ANDROID_NDK_HOME ANDROID_NDK_ROOT DOTNET_ROOT DOTNET_CLI_HOME MSBUILD_EXE_PATH NUGET_PACKAGES".split(" "),
  // C and C++, and the game SDKs: the compilers with their flags and search paths, CMake, vcpkg.
  ..."VCPKG_ROOT VCPKG_DEFAULT_TRIPLET VULKAN_SDK EMSDK QTDIR CMAKE_PREFIX_PATH CMAKE_GENERATOR CMAKE_TOOLCHAIN_FILE PKG_CONFIG_PATH".split(" "),
  ..."LD_LIBRARY_PATH DYLD_LIBRARY_PATH LIBRARY_PATH CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS".split(" "),
  // What Visual Studio's developer prompt sets, a Filament started from one hands on: the folders, and the versions
  // and target a build reads beside them (CMake, Meson, clang-cl, Rust's cc); Xcode's two.
  ..."VSINSTALLDIR VCINSTALLDIR VCToolsInstallDir VCToolsVersion VisualStudioVersion WindowsSdkDir WindowsSDKVersion".split(" "),
  ..."UniversalCRTSdkDir UCRTVersion VSCMD_ARG_TGT_ARCH VSCMD_ARG_HOST_ARCH INCLUDE LIB LIBPATH SDKROOT DEVELOPER_DIR".split(" "),
  // The JVM's builds; Flutter and Dart, with the mirrors they fetch from; Ruby.
  ..."GRADLE_HOME GRADLE_USER_HOME MAVEN_HOME M2_HOME ANT_HOME FLUTTER_ROOT PUB_CACHE PUB_HOSTED_URL FLUTTER_STORAGE_BASE_URL".split(" "),
  ..."GEM_HOME GEM_PATH RBENV_ROOT".split(" "),
  // Python: the environment in force, its managers, and how it writes text (Windows' code page otherwise).
  ..."VIRTUAL_ENV CONDA_PREFIX CONDA_DEFAULT_ENV PYENV_ROOT PIPX_HOME POETRY_HOME PYTHONUTF8 PYTHONIOENCODING".split(" "),
  // Node: what it builds for, and its managers.
  ..."NODE_ENV NVM_DIR NVM_HOME NVM_SYMLINK FNM_DIR VOLTA_HOME PNPM_HOME BUN_INSTALL DENO_DIR DENO_INSTALL COREPACK_HOME".split(" "),
  // Go: its folders, its target, and where its modules come from (a mirror, a private host's exemptions). Rust.
  ..."GOBIN GOCACHE GOMODCACHE GOFLAGS CGO_ENABLED GOOS GOARCH GOPROXY GOPRIVATE GONOPROXY GONOSUMDB GOSUMDB".split(" "),
  ..."CARGO_TARGET_DIR RUSTUP_TOOLCHAIN RUSTFLAGS RUSTC_WRAPPER".split(" "),
  // Which credentials on disk a tool picks, by a name or a path, never the credential: the command runs as the person
  // and could read those files anyway.
  ..."AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE KUBECONFIG".split(" "),
  ..."DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_TLS_VERIFY DOCKER_CERT_PATH".split(" "),
]);
// Git's config by environment goes whole: its keys (GIT_CONFIG_KEY_<n>) are key-named, so its count and values kept
// without them made git refuse every command, and a value is where a token rides (http.extraHeader's) — in
// GIT_CONFIG_PARAMETERS too, the one variable `git -c` hands its own commands the same pairs in.
const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/i;
// Windows names are case-insensitive (Git Bash exports SYSTEMROOT where cmd.exe writes SystemRoot); elsewhere case is the name.
const ENV_KEEP_UPPER = new Set([...ENV_KEEP].map((k) => k.toUpperCase()));
const kept = (/** @type {string} */ k, /** @type {boolean} */ win) => ENV_KEEP.has(k) || (win && ENV_KEEP_UPPER.has(k.toUpperCase()));
/**
 * Whether a variable's value carries a password: an address with one in it, anywhere in the value (GOPROXY lists
 * several), and a proxy's in the spelling with no scheme curl takes (`user:pass@host:8080`).
 * @param {string} k @param {string | undefined} v
 */
const holdsPassword = (k, v) => {
  const s = String(v ?? "");
  return WITH_PASSWORD.test(s) || (PROXIES.includes(k.toUpperCase()) && !s.includes("://") && WITH_PASSWORD.test(`http://${s}`));
};
/** Where the names the person passes to commands are read from; from nowhere, until `envPassFrom` says. @type {() => unknown} */
let envPassOf = () => [];
/**
 * The names the person passes to commands whatever they read like (`agentLoop.envPass`) are read from `fn`, at each
 * `safeEnv`: the setting holds live, a name written into it reaches the next command started. The composition root
 * says where (server.js); the hands import nothing above them. Answers how to take that back.
 * @param {() => unknown} fn @returns {() => void}
 */
export const envPassFrom = (fn) => {
  envPassOf = fn;
  return () => {
    if (envPassOf === fn) envPassOf = () => [];
  };
};
/** The names read now: a list's strings, none where the read fails or gives no list. @returns {string[]} */
const envPassNow = () => {
  try {
    const list = envPassOf();
    return Array.isArray(list) ? list.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
};
/**
 * The environment a hand's command is given (the rule is above `SECRETISH`): of `env`, Filament's own by default,
 * what its name or its family lets through and whose value holds no password, and what the person named (`pass`).
 * @param {{ env?: Record<string, string | undefined>, pass?: readonly string[], platform?: string }} [o]
 * @returns {Record<string, string | undefined>}
 */
export function safeEnv({ env = process.env, pass = envPassNow(), platform = process.platform } = {}) {
  const win = platform === "win32";
  const fold = (/** @type {string} */ k) => (win ? k.toUpperCase() : k);
  const named = new Set(pass.map(fold));
  /** @type {Record<string, string | undefined>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    // A shell's tag is no secret, and a shell started inside another keeps it: stopping the outer stops the inner's too.
    if (SHELL_TAG.test(k)) out[k] = v;
    // Filament's own never go through, named by the person or not.
    if (fold(k).startsWith("FILAMENT_")) continue;
    // What the person named goes through whatever it reads like or holds: that is what naming it says.
    if (named.has(fold(k))) {
      out[k] = v;
      continue;
    }
    // Git's own variables go through, but for its config's (GIT_CONFIG_ENV, above): GIT_SSH_COMMAND and the like come
    // from the person's environment, and push and fetch need them. A family's name that reads like a secret stays out;
    // a name the list vouches for is not read for that.
    const family = /^LC_/.test(k) || /^npm_config_/i.test(k) || (/^GIT_/i.test(k) && !GIT_CONFIG_ENV.test(k));
    if ((kept(k, win) || (family && !SECRETISH.test(k))) && !holdsPassword(k, v)) out[k] = v;
  }
  return out;
}
const SPILL_MAX_BYTES = 5 * 1024 * 1024; // bound the disk too: a runaway command must not fill the drive
/**
 * How long the bash hand drains output after the shell exits before it answers without the pipe's close (BUG-17); a
 * hook that was killed gives its pipes as long (app/agent/hooks.js).
 */
export const EXIT_DRAIN_MS = 1000;
const SPILL_TTL_MS = 30 * 60_000;
/** The spill files not yet removed, each with its removal timer: the timer is unref'd (it must not hold the process
 *  open), so a file still here when Filament stops is removed by `disposeSpills` — else it outlived every restart. */
const spills = new Map();
/** Remove every spill file still kept (the server's stop; the tests' end). Answers how many were removed. */
export const disposeSpills = () => {
  let n = 0;
  for (const [path, timer] of spills) {
    clearTimeout(timer);
    try {
      rmSync(path, { force: true });
      n++;
    } catch {}
  }
  spills.clear();
  return n;
};
/** A spill file's name: `filament-bash-<base36 time>-<4 chars>.log`, in the system's temp folder. */
const SPILL_NAME = /^filament-bash-[0-9a-z]+-[0-9a-z]+\.log$/;
/** A spill file's mode: its owner's alone — the system's temp folder is every account's, and a command's output may
 *  hold anything it printed. */
const SPILL_MODE = 0o600;
/** A fresh file for a command's whole output. */
const spillPath = () => join(tmpdir(), `filament-bash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.log`);
/** A spill file kept for its time (by default 30 minutes), then removed. @param {string} path @param {unknown} ttlMs */
const keepSpill = (path, ttlMs) => {
  const timer = setTimeout(
    () => {
      spills.delete(path);
      try {
        rmSync(path, { force: true });
      } catch {}
    },
    Number(ttlMs) > 0 ? Number(ttlMs) : SPILL_TTL_MS,
  );
  timer.unref?.();
  spills.set(path, timer); // never leave spill files behind: the stop removes what the timer has not yet
};
/**
 * The spill files a Filament that never reached its stop left behind (a crash, a forced kill): each is past the 30
 * minutes its notice promised once it is that old, so the next start removes it (HarnessV3-CodebasePass decision 5).
 * A younger one may be another running Filament's, and stays. A PowerShell script's file (shell.js) is swept the same
 * way: its process removes it on exit, and no script runs past the ten-minute timeout. Answers how many were removed.
 * @param {{ dir?: string, now?: number, olderThanMs?: number }} [o]
 */
export const sweepSpills = ({ dir = tmpdir(), now = Date.now(), olderThanMs = SPILL_TTL_MS } = {}) => {
  let n = 0;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!SPILL_NAME.test(name) && !PS_SCRIPT_NAME.test(name)) continue;
    const path = join(dir, name);
    try {
      if (spills.has(path) || now - statSync(path).mtimeMs < olderThanMs) continue;
      rmSync(path, { force: true });
      n++;
    } catch {}
  }
  return n;
};
/**
 * How long a command its timeout sent to the background may run, from its start, before Filament stops it: the
 * owner's of 11-05 — a build past its timeout goes on, but one that hangs (a prompt nobody answers) still ends.
 */
export const TIMED_OUT_CEILING_MS = 60 * 60_000;
/** A span as the words say it: "an hour", "2 hours", "1 minute", "90 seconds". @param {number} ms */
const spanWords = (ms) => {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return ms === 3_600_000 ? "an hour" : `${ms / 3_600_000} hours`;
  if (ms >= 60_000 && ms % 60_000 === 0) return ms === 60_000 ? "1 minute" : `${ms / 60_000} minutes`;
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? "" : "s"}`;
};
/**
 * Run the model's command in `shell` — bash's or PowerShell's (shell.js) — and answer its output, tail-cut to the
 * budget with the whole of it spilled to a file, or reject with the output and the exit code. `untimed`: no clock of
 * its own, so only `signal` ends it before it exits; `bare`: Filament's own run (`runOwnCommand`), which answers its
 * exit and the end of its output, rejects only where no shell starts, and spills nothing. `movable` is handed the way
 * to send the running command to the background (HarnessV4_Four_Plan FO-D12, `moveToBackground`) and answers how to
 * take that way back once the call has answered. A chat's own command (`owner`) past its timeout goes there too, still
 * running, its exit told as a background shell's, and is stopped at `ceilingMs` from its start (TIMED_OUT_CEILING_MS);
 * one with nobody to tell is stopped at its timeout. `onMoved` hears every move, the press's and the timeout's: the
 * call's card then says it runs on, never that it ended.
 * @param {import("./shell.js").Shell | import("./shell.js").PowerShell} shell @param {any} input @param {string} root @param {any} [opts]
 */
const runCommand = (shell, input, root, opts = {}) =>
  new Promise((resolveP, rejectP) => {
    const timeoutSec = Number(input.timeout);
    const timeoutMs =
      Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.min(timeoutSec, 600) * 1000 : 120000;
    let proc, stop;
    try {
      ({ proc, stop } = startCommand(shell, String(input.command ?? ""), { cwd: resolve(root), env: safeEnv() }));
    } catch (e) {
      rejectP(new HandError(`could not start the shell: ${/** @type {Error} */ (e).message}`));
      return;
    }
    const dec = new StringDecoder("utf8"); // multi-byte characters must not split at pipe chunk boundaries
    const budget = contentBudget(opts.maxBytes);
    let out = "";
    let total = 0;
    // Characters decoded so far: a command sent to the background goes on counting from here (`produced`).
    let chars = 0;
    let spilled = null;
    let spillStream = null;
    let spillBytes = 0;
    let done = false;
    // The shell exited while a process it started still held the output pipe (BUG-17): the call answered at the exit.
    let lingering = false;
    /** Takes back the way to the background the caller was handed (`movable`), once the call has answered.
     *  @type {(() => void) | null} */
    let unmovable = null;
    const started = Date.now();
    const onData = (d) => {
      total += d.length;
      // Decoded once: the decoder holds a split character's first bytes, so a second write of the same chunk would
      // garble exactly the output that is not ASCII.
      const text = dec.write(d);
      chars += text.length;
      opts.onOutput?.(text); // the loop's live tail into the chat, throttled there
      // Past the budget the kept tail is a cut, so the whole output goes to a file the notice names.
      if (total > budget && spillBytes < SPILL_MAX_BYTES && !opts.bare) {
        if (!spilled) {
          spilled = spillPath();
          try {
            spillStream = createWriteStream(spilled, { mode: SPILL_MODE });
            spillStream.on("error", () => {});
            spillStream.write(out);
            spillBytes = Buffer.byteLength(out);
          } catch {
            spilled = null;
            spillStream = null;
          }
        }
        if (spillStream && spillBytes < SPILL_MAX_BYTES) {
          try {
            spillStream.write(d);
            spillBytes += d.length;
          } catch {}
        }
      }
      out = (out + text).slice(-MAX_BYTES); // rolling tail: bounded memory for unbounded commands
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    /** @param {number | null} code @param {"timeout" | "stopped" | null} ended  why it ended before exiting on its own */
    const finish = (code, ended) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      unmovable?.();
      // The call has answered: what its pipes carry from here on is drained unread, so a process still holding them
      // neither streams into an answered call nor blocks on a full pipe.
      for (const st of [proc.stdout, proc.stderr]) {
        st?.removeListener("data", onData);
        st?.resume();
      }
      try {
        spillStream?.end();
      } catch {}
      // tail-truncate: keep the end (errors and final results live there)
      const whole = out + dec.end();
      const tail = tailLinesWithin(opts.redact ? opts.redact(whole) : whole, budget);
      if (opts.bare) return resolveP({ exit: ended === null && typeof code === "number" ? code : null, output: tail.text, stopped: ended === "stopped" });
      // The line cap can cut before the byte budget does, so the stream never spilled: the whole output is still in
      // hand (it fit the budget), and goes to the file the notice names.
      if (!spilled && tail.kept < tail.lines && total <= MAX_BYTES) {
        try {
          const p = spillPath();
          writeFileSync(p, whole, { mode: SPILL_MODE });
          spilled = p;
        } catch {}
      }
      const head =
        ended === "timeout"
          ? `Command timed out after ${Math.round(timeoutMs / 1000)} seconds\n`
          : ended === "stopped"
            ? `Command stopped with the turn after ${Math.round((Date.now() - started) / 1000)} seconds\n`
            : "";
      const timedOut = ended !== null;
      const tailNote = spilled
        ? `\nFull output (first ${Math.round(SPILL_MAX_BYTES / 1048576)} MB, kept 30 minutes): ${spilled}`
        : tail.cutLine || tail.kept < tail.lines
          ? `\n[Showing ${tail.cutLine ? `the end of the output's last line` : `lines ${tail.lines - tail.kept + 1}-${tail.lines} of ${tail.lines}`}; the rest did not fit this result, and no file could hold it. Redirect the command's output to a file to keep all of it.]`
          : "";
      if (spilled) keepSpill(spilled, opts.spillTtlMs);
      const lingerNote = lingering
        ? `\n\n[Filament: the command exited, but a process it started still holds its output open, so Filament stopped reading after ${EXIT_DRAIN_MS / 1000} s. That process was left running — stop it yourself if it should not be, and start long-lived processes (servers, watchers) with bash_background.]`
        : "";
      const text = `${head}${tail.text || "(no output)"}${tailNote}${lingerNote}`;
      if (code === 0 && !timedOut) resolveP(text);
      // A process the turn's stop killed never exited on its own: "exited with code ?" read like a crash (BUG-09).
      else if (ended === "stopped") rejectP(Object.assign(new HandError(`${text}\n\n(the process was stopped with the turn)`), { exitCode: null, stopped: true }));
      else rejectP(Object.assign(new HandError(`${text}\n\nCommand exited with code ${code ?? "?"}`), { exitCode: typeof code === "number" ? code : null }));
    };
    const timer = opts.untimed
      ? undefined
      : setTimeout(() => {
          // A chat's own command goes on in the background, where its exit is told (the owner's of 11-05): a build past
          // its timeout died halfway. One with nobody to tell is stopped.
          if (opts.owner?.session && !opts.bare && toBackground(true)) return;
          stop();
          finish(null, "timeout");
        }, timeoutMs);
    timer?.unref?.();
    // The turn stopping (the client hung up, a stop steer) stops the command with it, rather than
    // leaving it to run out its own timeout with nobody waiting.
    function onAbort() {
      stop();
      finish(null, "stopped");
    }
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
    // Sent to the background by the developer (HarnessV4_Four_Plan E21), or by its timeout: the call answers now, and
    // the same process goes on as a background shell with what it printed so far, out of the turn's stop's reach — the
    // developer's with no clock, the timeout's to its ceiling. Null when the command has already ended (its exit is the
    // answer).
    /** @param {boolean} timedOut */
    const toBackground = (timedOut) => {
      if (done || proc.exitCode != null) return null;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      unmovable?.();
      for (const st of [proc.stdout, proc.stderr]) st?.removeListener("data", onData);
      try {
        spillStream?.end();
      } catch {}
      if (spilled) keepSpill(spilled, opts.spillTtlMs);
      const ceilingMs = Math.max(0, Number(opts.ceilingMs ?? TIMED_OUT_CEILING_MS));
      const ceiling = timedOut ? { inMs: Math.max(0, ceilingMs - (Date.now() - started)), words: spanWords(ceilingMs) } : null;
      const { id, s } = keepShell(proc, stop, { command: String(input.command ?? ""), cwd: resolve(root), owner: opts.owner || NO_OWNER, dec, out, produced: chars, ceiling });
      // What the answer shows is read, as a bash_background start's is: the next bash_output reads what follows it.
      const end = settledEnd(s, !!opts.redact);
      const so = outputBetween(s, 0, end, opts.redact);
      s.read = end;
      opts.onMoved?.({ id, timedOut });
      const secs = Math.round((Date.now() - started) / 1000);
      const kept = spilled ? `\nIts output until now (first ${Math.round(SPILL_MAX_BYTES / 1048576)} MB, kept 30 minutes): ${spilled}` : "";
      resolveP(
        [
          ceiling
            ? `The command ran past its timeout of ${spanWords(timeoutMs)}, so Filament sent it to the background rather than stop it. It is still running, as background shell ${id}: it keeps running across turns, you are told when it exits, and Filament stops it if it still runs ${ceiling.words} after it started.`
            : `The developer sent this command to the background after ${secs} second${secs === 1 ? "" : "s"}. It is still running, as background shell ${id}: it keeps running across turns (and stops when Filament exits), and you are told when it exits.`,
          "",
          `${so ? `Output so far:\n${newestOutput(so, budget)}` : "No output yet."}${heldNote(s.produced - end)}${kept}`,
          "",
          `Follow it with bash_output({ id: "${id}", wait: 10 }); stop it with bash_kill({ id: "${id}" }). Go on with your work meanwhile.`,
        ].join("\n"),
      );
      return { id };
    };
    const moveToBackground = () => toBackground(false);
    if (!done && opts.movable && !opts.bare) unmovable = opts.movable(moveToBackground);
    proc.on("close", (code) => finish(code, null));
    // The pipe's close waits for EVERY process holding the output, a server or watcher the command left running
    // included, and the call used to wait out its whole timeout for one (BUG-17: a 10-minute test run). The shell's own
    // exit ends the call: its output gets a moment to drain, then the call answers with the exit code and says what
    // still holds the pipe. The lingering process is not killed; its later output is drained unread (finish), so it
    // never blocks on a full pipe.
    proc.on("exit", (code) => {
      setTimeout(() => {
        if (done) return;
        lingering = true;
        finish(code, null);
      }, EXIT_DRAIN_MS).unref?.();
    });
    proc.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        unmovable?.();
        rejectP(new HandError(`the shell failed: ${e.message}`));
      }
    });
  });

// ---- the background shells ---------------------------------------------------------------------------------------------
// Commands that outlive any one turn: dev servers, watchers, long builds. One registry for the whole process; a
// dev server should not survive its proxy, so Filament's shutdown kills them wholesale. The buffer is a rolling
// tail (a chatty server must not eat memory); bash_output reads the part that arrived since the model's last read.
// Each shell belongs to the agent that started it, in its session (HarnessV3-FixRound decision 20, `shellFor`).
const BG_TAIL = 64 * 1024;
const BG_POLL_MS = 100;
/** How long Filament's shutdown waits for the stops it sends to other machines, all of them together. */
const REMOTE_STOPS_MS = 3000;
/** How long a waiting bash_output that ended on output gives the process to exit before it answers (BUG-23). */
const EXIT_SETTLE_MS = 500;
/**
 * How much of an unfinished line a read holds back while the shell runs and the session redacts (decision 20): a
 * secret up to this long is whole in the buffer before any of it is shown.
 */
const BG_HOLD = 4096;
/**
 * Who a background shell belongs to: a session, and the agent in it that started the shell — null for the session's
 * main agent, `subagent:<id>` for a sub-agent. A caller that names no owner is the main agent of one anonymous session.
 * @typedef {{ session: string, agent: string | null }} ShellOwner
 */
/** @type {ShellOwner} */
const NO_OWNER = Object.freeze({ session: "", agent: null });
/** @typedef {{ proc: any, stop: () => Promise<void>, out: string, read: number, produced: number, exited: number | null, command: string, cwd: string, startedAt: number, endedAt: number | null, onOutput: ((text: string) => void) | null, watchers: Set<(text: string) => void>, owner: ShellOwner, told: boolean, logPath: string | null, endWatch?: (() => void) | null, ceilinged?: string, machine?: string | null, why?: string, stopped?: boolean }} BackgroundShell  `ceilinged`: stopped at its ceiling, of that span (`runCommand`); `machine`: the machine it runs on, where that is another (`keepRemoteShell`), and `why`: how it ended there, where it did not exit on its own; `stopped`: a stop ended it — its agent's, the person's, its chat's going, Filament's own —, so its exit is no failure of its own */
/** @type {Map<string, BackgroundShell>} */
const shells = new Map();
let shellSeq = 0;
/**
 * Background shells that exited before their owner saw the exit (HarnessV3-Tools TL-D24), by who is to be told,
 * oldest first. Each is told once: at that agent's next round boundary, or with its session's next turn — unless a
 * bash_output, the start or a bash_kill showed the exit first. Kept apart from `shells`, whose entries go five minutes
 * after an exit. `agent` is who started the shell; `text`, the words a command's end is told in where its caller
 * gave them (`tellLater`, HarnessV4_Background_Plan BG-D4).
 * `kind`: an exit, the lines a watch caught (`watchShell`), the time an agent set (`comeBackLater`), Filament's check-in
 * on a command that still runs with its agent idle (sessions/idle-wake.js), or the person's Cancel of a come-back
 * (agent/come-back.js `cancelByPerson`), which is told with the next turn and nothing more: it wakes no chat and ends no
 * wait (`wakes`). `capped` false: no newer item puts it past UNTOLD_MAX (`withinMax`).
 * `ceiling`: Filament stopped it at its ceiling, of that span (`runCommand`). `machine` and `why`: it ran on another
 * machine, and how it ended there where it did not exit on its own (`keepRemoteShell`).
 * Each change of a session's is heard (`onUntoldChange`), so the chat keeps what waits for it across a restart
 * (sessions/owed-wakes.js, the nudge map of 11-10: "Nothing wakes a chat after a restart"); the whole registry's clear
 * at Filament's stop is nobody's to hear, so what it held stays kept.
 * @type {Map<string, UntoldItem[]>}
 */
const untold = new (class extends Map {
  /** @param {string} k @param {UntoldItem[]} v */
  set(k, v) {
    super.set(k, v);
    untoldChanged(k);
    return this;
  }
  /** @param {string} k */
  delete(k) {
    const had = super.delete(k);
    if (had) untoldChanged(k);
    return had;
  }
})();
/** @typedef {"exit" | "lines" | "wake" | "idle" | "cancel"} UntoldKind */
/** @typedef {{ id: string, command: string, code: number | null, agent: string | null, text?: string, kind?: UntoldKind, capped?: boolean, quiet?: boolean, ceiling?: string, machine?: string, why?: string }} UntoldItem */
/** Who hears that what waits untold for a session changed: the server, which keeps it with the chat. */
const untoldHearers = new Set();
/** @param {string} k  an owner's key: its session first */
const untoldChanged = (k) => {
  const session = k.slice(0, k.indexOf("\n"));
  if (!session) return;
  for (const fn of [...untoldHearers]) {
    try {
      fn(session);
    } catch {}
  }
};
/**
 * Call `fn` with a session whenever what waits untold for any of its agents changes. Answers how to stop hearing it.
 * @param {(session: string) => void} fn @returns {() => void}
 */
export const onUntoldChange = (fn) => {
  untoldHearers.add(fn);
  return () => void untoldHearers.delete(fn);
};
/** Everything that waits untold for a session's agents, oldest first, as kept: what the chat keeps for a restart. @param {string} session @returns {UntoldItem[]} */
export const untoldOf = (session) => [...untold].filter(([k]) => k.startsWith(`${session}\n`)).flatMap(([, list]) => list.map((x) => ({ ...x })));
/**
 * What waited untold for a session as Filament last stopped, kept again as it starts (sessions/owed-wakes.js): for its
 * main agent — no turn of a sub-agent's runs past a restart —, each by its id, so one kept twice is told once; ahead of
 * what came since. It wakes nothing: the start's sweep does. @param {string} session @param {readonly UntoldItem[]} items
 */
export const keepUntold = (session, items) => {
  if (!session || !items.length) return;
  const k = ownerKey(mainOf({ session, agent: null }));
  const ids = new Set(items.map((x) => x.id));
  untold.set(k, withinMax([...items.map((x) => ({ ...x })), ...(untold.get(k) || []).filter((x) => !ids.has(x.id))], k));
};
/**
 * Whether an untold item may wake its chat: all but the person's Cancel of a come-back, which only rides the chat's next
 * turn (the Designer's of 10-27) — not as it is told, not as a turn lets go of it, not beside an end that wakes the chat —,
 * and one told never to wake it (`quiet`, `tellLater`'s `wake: false`: the person's Stop of a command, a sub-agent's
 * commands stopped as its run ended, a restart's word of what it ended), which a restart or a later waker's look would
 * otherwise take for one that wakes (FabeleHelper's of 11-10). @param {{ kind?: UntoldKind, quiet?: boolean }} x
 */
export const wakes = (x) => x.kind !== "cancel" && x.quiet !== true;
/** Who hears that a shell's exit has nobody to tell it to: the server, which sends the chat a turn. */
const wakers = new Set();
/**
 * Call `fn` with a chat's session whenever a background shell (HarnessV4_Four_Plan FO-D14, FO-D49) ends untold with no
 * turn of its agent there to hear it: at the exit, or as the turn that was there lets go. Answers how to stop hearing
 * it. @param {(session: string) => void} fn @returns {() => void}
 */
export const onShellWake = (fn) => {
  wakers.add(fn);
  return () => void wakers.delete(fn);
};
/** @param {string} session */
const wakeChat = (session) => {
  if (!session) return;
  for (const fn of [...wakers]) {
    try {
      fn(session);
    } catch {}
  }
};
/** Who hears that a session's running shells changed (HarnessV4_Background_Plan E38-D4): the server, which says the list to the page. */
const changeHearers = new Set();
/**
 * Call `fn` with a session whenever a background shell of it starts, ends or is stopped. Answers how to stop hearing
 * it. @param {(session: string) => void} fn @returns {() => void}
 */
export const onShellsChange = (fn) => {
  changeHearers.add(fn);
  return () => void changeHearers.delete(fn);
};
/** Who hears a background shell fail on its own (the watchers, the plan of 11-11). @type {Set<(end: { session: string, id: string, command: string, code: number }) => void>} */
const failHearers = new Set();
/**
 * Call `fn` with each background shell of a chat's main agent that ended on its own with an exit other than 0 — never
 * one a stop ended, nor one stopped at its ceiling, nor one that ended on another machine without an exit of its own.
 * Answers how to stop hearing it.
 * @param {(end: { session: string, id: string, command: string, code: number }) => void} fn @returns {() => void}
 */
export const onShellFailed = (fn) => {
  failHearers.add(fn);
  return () => void failHearers.delete(fn);
};
/** @param {string} session */
const shellsChanged = (session) => {
  if (!session) return;
  for (const fn of [...changeHearers]) {
    try {
      fn(session);
    } catch {}
  }
};
/** Whether a shell's exit waits, untold, for the session's main agent — one that may wake it (`wakes`). @param {string} session */
export const wakeDue = (session) => (untold.get(ownerKey(mainOf({ session, agent: null }))) || []).some(wakes);
/** Whether a turn of the session's main agent runs, and so hears its shells' exits at its next step.
 *  @param {string} session */
export const shellsAttended = (session) => attending.has(ownerKey(mainOf({ session, agent: null })));
/**
 * Exits kept untold per agent; past it the oldest go (an agent that never looks back has the newest). What a restart
 * tells (`tellLater`'s `capped: false`) counts apart and stays: one batch, made before any turn could look.
 */
const UNTOLD_MAX = 20;
/**
 * How many untold items the cap let go, per agent, until it is told so (the nudge map of 11-10: they went for good,
 * and silently — no log, and the agent never knew): said ahead of the first item it is told next (`peekShellExits`).
 * @type {Map<string, number>}
 */
const untoldLost = new Map();
/** Who hears that the cap let untold items go: the server, which logs it. */
const lostHearers = new Set();
/**
 * Call `fn` with a chat's session, the agent whose items went (null for its main agent) and how many, as UNTOLD_MAX
 * first lets untold items of that agent go since it was last told so: once a run — the rest of it is counted, and said
 * to the agent with the run's whole count (the review of 11-11: heard for each item, a busy watch logged a line for
 * every line it caught). Answers how to stop hearing it.
 * @param {(session: string, agent: string | null, n: number) => void} fn @returns {() => void}
 */
export const onUntoldLost = (fn) => {
  lostHearers.add(fn);
  return () => void lostHearers.delete(fn);
};
/**
 * An agent's untold items within UNTOLD_MAX: past it, the oldest of the capped ones go; one told uncapped stays. Those
 * that go are counted for the agent (`untoldLost`), and heard where they begin a run (`onUntoldLost`). `k`: whose they are.
 * @template {{ capped?: boolean }} T @param {T[]} list @param {string} k @returns {T[]}
 */
const withinMax = (list, k) => {
  let over = list.filter((x) => x.capped !== false).length - UNTOLD_MAX;
  if (over <= 0) return list;
  const n = over;
  const before = untoldLost.get(k) || 0;
  untoldLost.set(k, before + n);
  const [session, agent] = k.split("\n");
  if (!before)
    for (const fn of [...lostHearers]) {
      try {
        fn(session, agent || null, n);
      } catch {}
    }
  return list.filter((x) => x.capped === false || over-- <= 0);
};
/** The words that say what the cap let go, ahead of the next item told. @param {number} n */
const lostWords = (n) =>
  `[Filament: ${n === 1 ? "an earlier background item" : `${n} earlier background items`} — a command's end, a watch's lines, a come-back — went untold: more than ${UNTOLD_MAX} waited for you, and the oldest were let go. bash_output reads a shell's output by its id while Filament keeps it.]`;
const ownerKey = (/** @type {ShellOwner} */ o) => `${o.session}\n${o.agent ?? ""}`;
/** The session's main agent, who reaches every shell of the session (`shellFor`). @param {ShellOwner} o */
const mainOf = (o) => ({ session: o.session, agent: null });
/** The agents whose turn runs now, by owner key (counted: a session's main agent may run two turns at once). */
const attending = new Map();
/**
 * `owner`'s turn runs: its shells' exits are told to it until the returned function is called. A sub-agent's exits
 * that nobody took by then go to the session's main agent, and so does every later exit of the shells it left
 * running: an agent whose run is over hears nothing, and the main agent can read and stop those shells.
 * @param {ShellOwner} owner @returns {() => void}
 */
export const attendShells = (owner) => {
  const k = ownerKey(owner);
  attending.set(k, (attending.get(k) || 0) + 1);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const n = (attending.get(k) || 1) - 1;
    if (n > 0) {
      attending.set(k, n);
      return;
    }
    attending.delete(k);
    const mine = untold.get(k);
    if (!mine) return;
    // An exit that came as the turn ended, after its last step took the exits, wakes the chat; the person's Cancel of a
    // come-back waits for the next turn (`wakes`).
    const main = ownerKey(mainOf(owner));
    if (owner.agent !== null) {
      untold.delete(k);
      // What the cap let go of its items goes with them, said to the main agent.
      const lost = untoldLost.get(k);
      untoldLost.delete(k);
      if (lost) untoldLost.set(main, (untoldLost.get(main) || 0) + lost);
      untold.set(main, withinMax([...(untold.get(main) || []), ...mine], main));
    }
    if (!attending.has(main) && mine.some(wakes)) wakeChat(owner.session);
  };
};
/** Who is told of an exit of a shell `owner` started: itself while its turn runs, else the main agent. @param {ShellOwner} owner */
const toldTo = (owner) => (owner.agent !== null && !attending.has(ownerKey(owner)) ? mainOf(owner) : owner);
/** `s`'s item `id` was shown: it is not told. @param {BackgroundShell} s @param {string} id */
const unTell = (s, id) => {
  for (const k of [ownerKey(s.owner), ownerKey(mainOf(s.owner))]) {
    const list = (untold.get(k) || []).filter((x) => x.id !== id);
    if (list.length) untold.set(k, list);
    else untold.delete(k);
  }
};
/** `s` is seen to have ended: it is not told. @param {BackgroundShell} s @param {string} id */
const sawExit = (s, id) => {
  s.told = true;
  unTell(s, id);
};
/**
 * A background shell's exit as its agent is told: `text` is the line the model reads, the rest is for the page —
 * or, of `kind` "lines", "wake" or "cancel", the lines a watch caught, the time the agent set or the person's Cancel of
 * it, which the page draws as no end.
 * @typedef {{ id: string, command: string, code: number | null, text: string, kind?: UntoldKind }} ShellExit  `kind`: an
 * exit where it says none
 */
/**
 * The exits `owner` is to be told of, each in one line the model reads: the shell, its command, who started it when
 * that was another agent, its code, and what is left of its output to read. Nothing is marked told: `tellShellExits`
 * does that once they went out.
 * @param {ShellOwner} owner @returns {ShellExit[]}
 */
export const peekShellExits = (owner) => {
  const k = ownerKey(owner);
  const lost = untoldLost.get(k) || 0;
  return (untold.get(k) || []).map((x, i) => {
    const s = shells.get(x.id);
    const unread = s ? s.produced - s.read : 0;
    const left = !s ? "its output is no longer kept" : unread > 0 ? `${unread.toLocaleString()} characters of its output are unread: bash_output({ id: "${x.id}" }) reads them` : "all of its output was read";
    // An agent is told of another's shell when that one's run is over: a sub-agent's (`subagent:<id>`).
    const by = x.agent !== null && x.agent !== owner.agent ? `, started by sub-agent ${x.agent.replace(/^subagent:/, "")},` : "";
    const command = headChars(x.command.replace(/\s+/g, " ").trim(), 80);
    // One its timeout sent to the background, stopped at its ceiling: no exit of its own (`runCommand`). One on another
    // machine says which, and how it ended there where it did not exit on its own.
    const on = x.machine ? ` on ${x.machine}` : "";
    const how = x.ceiling ? `still ran ${x.ceiling} after it started, past its timeout, and Filament stopped it` : x.why ? `ended there: ${x.why}` : `exited with code ${x.code ?? "?"}`;
    const text = x.text ?? `[Filament: background shell ${x.id} (${command})${on}${by} ${how} — ${left}.]`;
    // What the cap let go is said ahead of the first, and told with it (`tellShellExits`).
    return { id: x.id, command, code: x.code, text: i === 0 && lost ? `${lostWords(lost)}\n${text}` : text, kind: x.kind || "exit" };
  });
};
/**
 * These exits went out to `owner`: told, and never again — unless the turn that carried them fails before its model does
 * any work, which hands back what this answers (`untellShellExits`): the items as they waited, and how many the cap had
 * let go that the first of them said. @param {ShellOwner} owner @param {readonly string[]} ids
 * @returns {{ items: UntoldItem[], lost: number }}
 */
export const tellShellExits = (owner, ids) => {
  const k = ownerKey(owner);
  const had = untold.get(k) || [];
  // The first item carried what the cap let go (`peekShellExits`): told with it.
  const lost = had.length && ids.includes(had[0].id) ? untoldLost.get(k) || 0 : 0;
  if (had.length && ids.includes(had[0].id)) untoldLost.delete(k);
  const list = had.filter((x) => !ids.includes(x.id));
  if (list.length) untold.set(k, list);
  else untold.delete(k);
  for (const id of ids) {
    const s = shells.get(id);
    if (s) s.told = true;
  }
  return { items: had.filter((x) => ids.includes(x.id)), lost };
};
/**
 * What `tellShellExits` took waits untold again: the turn that carried it failed before its model did any work, so the
 * model's history keeps nothing of it (the owner's of 11-11: "delivery is at least once") — ahead of what came since,
 * each by its id, so one given back twice waits once, with what the cap had let go to be said again. Heard as every
 * change is (`onUntoldChange`), so the chat keeps it for a restart. It wakes nothing: the waker tries again at its time
 * (sessions/wake.js `ended`). @param {ShellOwner} owner @param {{ items: readonly UntoldItem[], lost: number }} told
 */
export const untellShellExits = (owner, { items, lost }) => {
  if (!items.length) return;
  const k = ownerKey(owner);
  const ids = new Set(items.map((x) => x.id));
  const waits = untold.get(k) || [];
  if (lost && !waits.some((x) => ids.has(x.id))) untoldLost.set(k, (untoldLost.get(k) || 0) + lost);
  untold.set(k, withinMax([...items.map((x) => ({ ...x })), ...waits.filter((x) => !ids.has(x.id))], k));
};
/** The exits `owner` is to be told of, told now: what a loop takes at a round boundary. @param {ShellOwner} owner */
export const takeShellExits = (owner) => {
  const due = peekShellExits(owner);
  tellShellExits(owner, due.map((d) => d.id));
  return due;
};
/** Stop every background shell, with everything each started (the server's stop; the tests' end). An exit Filament's
 *  own stop caused is nobody's to hear: it is neither told nor wakes a chat (HarnessV4_Four_Plan FOC-85). The chats'
 *  come-backs go with them. Those on other machines are sent their stops together, and waited for REMOTE_STOPS_MS at
 *  most: a machine that does not answer holds no shutdown (its command ends there as it sees this Filament gone). */
export const disposeBackgroundShells = async () => {
  const all = [...shells.values()];
  for (const s of all) Object.assign(s, { told: true, stopped: true });
  for (const c of comeBacks.values()) clearTimeout(c.timer);
  comeBacks.clear();
  shells.clear();
  untold.clear();
  untoldLost.clear();
  attending.clear();
  const there = Promise.all(all.filter((s) => s.machine).map((s) => s.stop().catch(() => {})));
  await Promise.all([...all.filter((s) => !s.machine).map((s) => s.stop()), Promise.race([there, new Promise((r) => setTimeout(r, REMOTE_STOPS_MS).unref?.())])]);
};
/**
 * A chat deleted (memory's `onSessionsDeleted`): its background shells stop, with everything each started, and its
 * come-back goes. Nothing of them is told, and nothing wakes it: there is no chat to tell. Answers how many ran.
 * @param {string} session @returns {Promise<number>}
 */
export const endChatShells = async (session) => {
  if (!session) return 0;
  const mine = [...shells].filter(([, s]) => s.owner.session === session);
  const running = mine.filter(([, s]) => isRunning(s)).map(([, s]) => s);
  for (const [id, s] of mine) {
    s.told = true;
    s.stopped = true;
    s.endWatch = null;
    s.watchers.clear();
    shells.delete(id);
  }
  for (const k of [...untold.keys(), ...untoldLost.keys()])
    if (k.startsWith(`${session}\n`)) {
      untold.delete(k);
      untoldLost.delete(k);
    }
  const c = comeBacks.get(session);
  if (c) {
    clearTimeout(c.timer);
    comeBacks.delete(session);
    comeBackChanged(session);
  }
  if (mine.length) shellsChanged(session);
  await Promise.all(running.map((s) => s.stop()));
  return running.length;
};
/**
 * A chat stopped by Filament (sessions.js `stopDeviceChats`: the agents' device that started it was revoked, or its grant
 * switched off): the background shells its agent and its sub-agents run stop, each with everything it started, as
 * bash_kill stops one. Its stop is nobody's to hear: nothing is told — no exit, no line a watch would catch as the
 * shell ends, nor what waited to be told — its come-back goes, and nothing wakes the chat. Answers how many ran.
 * @param {string} session @returns {Promise<number>}
 */
export const stopChatShells = async (session) => {
  if (!session) return 0;
  const running = [...shells].filter(([, s]) => s.owner.session === session && isRunning(s));
  for (const [id, s] of running) {
    s.stopped = true;
    s.endWatch = null;
    s.watchers.clear();
    shells.delete(id);
    sawExit(s, id);
  }
  for (const k of [...untold.keys(), ...untoldLost.keys()])
    if (k.startsWith(`${session}\n`)) {
      untold.delete(k);
      untoldLost.delete(k);
    }
  const c = comeBacks.get(session);
  if (c) {
    clearTimeout(c.timer);
    comeBacks.delete(session);
    comeBackChanged(session);
  }
  if (running.length) shellsChanged(session);
  await Promise.all(running.map(([, s]) => s.stop()));
  return running.length;
};
/** @param {string} command @param {string} root @param {ShellOwner} owner @param {import("./shell.js").Shell} shell */
const startShell = (command, root, owner, shell) => {
  const { proc, stop } = startCommand(shell, String(command ?? ""), { cwd: resolve(root), env: safeEnv() });
  return keepShell(proc, stop, { command: String(command ?? ""), cwd: resolve(root), owner, dec: new StringDecoder("utf8") });
};
/**
 * A running process kept as a background shell: one bash_background started, or a foreground command the developer
 * sent to the background (HarnessV4_Four_Plan E21), which comes with its decoder and what it printed so far. An exit
 * that nobody is there to hear wakes its chat (`onShellWake`, FO-D49) — unless its caller delivers its end itself
 * (`onEnd`, a coding agent's background_command: HarnessV4_Background_Plan BG1), which then hears it once, as it
 * stands then; a stop by its agent or by Filament is nobody's to hear. `logPath`: all of its output goes there too,
 * up to BG_LOG_MAX_BYTES (BG-D8).
 * @param {any} proc @param {() => Promise<void>} stop
 * `ceiling`: stopped once it runs `inMs` more, its end told as that (`runCommand`, a command its timeout sent here).
 * `machine`: the machine it runs on, where that is another (`keepRemoteShell`).
 * @param {{ command: string, cwd: string, owner: ShellOwner, dec: StringDecoder, out?: string, produced?: number, onEnd?: ((end: ShellNow) => void) | null, logPath?: string | null, ceiling?: { inMs: number, words: string } | null, machine?: string | null }} o
 */
const keepShell = (proc, stop, { command, cwd, owner, dec, out = "", produced = 0, onEnd = null, logPath = null, ceiling = null, machine = null }) => {
  const id = `bg_${(++shellSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /** @type {BackgroundShell} */
  const s = { proc, stop, out: out.slice(-BG_TAIL), read: 0, produced, exited: null, command, cwd, startedAt: Date.now(), endedAt: null, onOutput: null, watchers: new Set(), owner, told: false, logPath, ...(machine ? { machine } : {}) };
  /** @type {import("node:fs").WriteStream | null} */
  let log = null;
  let logBytes = 0;
  if (logPath) {
    try {
      log = createWriteStream(logPath, { mode: SPILL_MODE });
      log.on("error", () => {});
    } catch {
      s.logPath = null;
    }
  }
  const onData = (/** @type {Buffer} */ d) => {
    if (log && logBytes < BG_LOG_MAX_BYTES) {
      log.write(d);
      logBytes += d.length;
    }
    // Decoded ONCE here: a multi-byte character split across pipe chunks must not mojibake into the live tail.
    const text = dec.write(d);
    s.produced += text.length;
    s.out = (s.out + text).slice(-BG_TAIL);
    s.onOutput?.(text);
    for (const w of s.watchers) w(text);
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("error", () => {
    s.exited = -1;
  });
  // A shell that finishes on its own leaves the registry after a grace: long enough for the model's final
  // bash_output, short enough that a long-lived proxy is not a graveyard of dead entries.
  let ended = false;
  /** @param {number | null} code */
  const end = (code) => {
    if (ended) return;
    ended = true;
    s.exited = code;
    s.endedAt = Date.now();
    // Its watched lines are told before its end, the unfinished last one with them (`watchShell`).
    s.endWatch?.();
    // Its caller's to deliver (BG-D3): once, unless a stop came first.
    if (onEnd) {
      if (!s.told) {
        s.told = true;
        try {
          onEnd(nowOf(id, s));
        } catch {}
      }
    } else if (!s.told) {
      // An exit nobody has seen yet waits for its owner (TL-D24); one a read or a kill already showed does not.
      const k = ownerKey(toldTo(owner));
      const list = [...(untold.get(k) || []), { id, command: s.command, code, agent: owner.agent, ...(s.ceilinged ? { ceiling: s.ceilinged } : {}), ...(s.machine ? { machine: s.machine } : {}), ...(s.why ? { why: s.why } : {}) }];
      untold.set(k, withinMax(list, k));
      if (!attending.has(k)) wakeChat(owner.session);
    }
    if (typeof code === "number" && code !== 0 && !s.stopped && !s.ceilinged && !s.why && owner.session && !owner.agent)
      for (const fn of [...failHearers]) {
        try {
          fn({ session: owner.session, id, command: s.command, code });
        } catch {}
      }
    shellsChanged(owner.session);
    setTimeout(() => shells.delete(id), 5 * 60_000).unref?.();
  };
  proc.on("close", (code) => {
    log?.end();
    end(code);
  });
  // Its own exit ends it once its output had a moment to drain, as a foreground command's does (BUG-17): a process it
  // started that still holds the pipe would hold its close — and its end, told — for as long as that process lives.
  // That process is left running; what it prints still reaches the shell's output.
  proc.on("exit", (code) => {
    setTimeout(() => end(code), EXIT_DRAIN_MS).unref?.();
  });
  proc.unref?.();
  if (ceiling) {
    const t = setTimeout(() => {
      if (!isRunning(s) || s.told) return;
      s.ceilinged = ceiling.words;
      void s.stop().catch(() => {});
    }, ceiling.inMs);
    t.unref?.();
    proc.once("close", () => clearTimeout(t));
  }
  shells.set(id, s);
  shellsChanged(owner.session);
  return { id, s };
};
/**
 * The background shell `id` as `owner` may reach it (decision 20). A session's main agent reaches every shell of its
 * session: its own, and those its sub-agents left running. Any other agent reaches only its own. Another
 * session's shell answers as an id never issued, because it is not this session's to know of.
 * @param {unknown} id @param {ShellOwner | null | undefined} owner
 */
const shellFor = (id, owner) => {
  const s = shells.get(String(id || ""));
  const me = owner || NO_OWNER;
  if (!s || s.owner.session !== me.session) throw new HandError(`no background shell "${id}" — it may have been stopped, or Filament restarted`);
  if (me.agent !== null && s.owner.agent !== me.agent)
    throw new HandError(`background shell "${id}" was started by another agent in this session; only that agent, or the session's main agent, can read or stop it`);
  return s;
};
/**
 * Whether it runs: no exit code yet, and no end — one stopped by a signal, or one on another machine that ended there
 * without a code, has ended all the same. @param {{ proc: any, exited: number | null, endedAt?: number | null }} s
 */
const isRunning = (s) => s.proc.exitCode == null && s.exited == null && s.endedAt == null;
/** The most a background command's file of its whole output holds (BG-D8): a runaway must not fill the drive. */
export const BG_LOG_MAX_BYTES = 20 * 1024 * 1024;
/** How long that file is kept from the command's start: removed at Filament's stop before then. */
export const BG_LOG_TTL_MS = 12 * 60 * 60_000;
/**
 * How a background shell stands (HarnessV4_Background_Plan BG-D9): whether it runs, its code once it ended, when it
 * started and ended, its command and folder, how many characters it printed, the newest of them as kept (`out`, the
 * rolling tail) and the file with all of them, where it keeps one — and, for one on another machine, which, and how it
 * ended there where it did not exit on its own (`why`).
 * @typedef {{ id: string, running: boolean, code: number | null, command: string, cwd: string, startedAt: number, endedAt: number | null, produced: number, out: string, logPath: string | null, machine?: string, why?: string }} ShellNow
 */
/** @param {string} id @param {BackgroundShell} s @returns {ShellNow} */
const nowOf = (id, s) => ({ id, running: isRunning(s), code: s.proc.exitCode ?? s.exited ?? null, command: s.command, cwd: s.cwd, startedAt: s.startedAt, endedAt: s.endedAt, produced: s.produced, out: s.out, logPath: s.logPath, ...(s.machine ? { machine: s.machine } : {}), ...(s.why ? { why: s.why } : {}) });
/**
 * A background command a coding agent started with Filament's background_command (HarnessV4_Background_Plan BG1): a
 * background shell in the bash hand's shell, in `root`, whose end `onEnd` delivers — never told as a shell's exit by
 * itself — and whose whole output goes to a file of its own as well, kept BG_LOG_TTL_MS (BG-D8). Answers how it
 * stands as it starts.
 * @param {string} command @param {string} root @param {ShellOwner} owner
 * @param {{ onEnd: (end: ShellNow) => void, shell?: import("./shell.js").Shell }} o
 * @returns {ShellNow}
 */
export const startCommandShell = (command, root, owner, { onEnd, shell = SHELL }) => {
  const logPath = spillPath();
  keepSpill(logPath, BG_LOG_TTL_MS);
  const { proc, stop } = startCommand(shell, String(command ?? ""), { cwd: resolve(root), env: safeEnv() });
  const { id, s } = keepShell(proc, stop, { command: String(command ?? ""), cwd: resolve(root), owner, dec: new StringDecoder("utf8"), onEnd, logPath });
  return nowOf(id, s);
};
/**
 * A command that runs on another machine, kept here as a background shell (the remote-agents plan's c-tools): its
 * output and its end come from that machine's exec stream (app/agent/remote-commands.js), and it is read, told, woken
 * for, listed and stopped as a local one is — its stop is `stop`, sent there. A stand-in for its process carries what
 * the stream says: `said` each piece of its output, `ended` its end once — its code, and how it ended there where it did
 * not exit on its own (`why`). `onEnd`, and `log` — all of its output in a file of its own too —, as a coding agent's
 * background_command has them (`startCommandShell`).
 * @param {{ command: string, cwd: string, owner: ShellOwner, machine: string, stop: () => Promise<void>, onEnd?: ((end: ShellNow) => void) | null, log?: boolean }} o
 */
export const keepRemoteShell = ({ command, cwd, owner, machine, stop, onEnd = null, log = false }) => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: /** @type {number | null} */ (null) });
  const logPath = log ? spillPath() : null;
  if (logPath) keepSpill(logPath, BG_LOG_TTL_MS);
  const { id, s } = keepShell(proc, stop, { command, cwd, owner, dec: new StringDecoder("utf8"), onEnd, logPath, machine });
  let over = false;
  return {
    id,
    s,
    /** @param {"stdout" | "stderr"} stream @param {string} text */
    said: (stream, text) => {
      if (!over && text) proc[stream === "stderr" ? "stderr" : "stdout"].emit("data", Buffer.from(text, "utf8"));
    },
    /** @param {{ code: number | null, why?: string | null }} end */
    ended: ({ code, why = null }) => {
      if (over) return;
      over = true;
      if (why) s.why = why;
      proc.exitCode = code;
      proc.emit("close", code);
    },
  };
};
/**
 * How `owner`'s background shell `id` stands now (BG-D9), by the shells' rule of who may reach it (`shellFor`).
 * @param {unknown} id @param {ShellOwner} owner @returns {ShellNow}
 */
export const shellNow = (id, owner) => nowOf(String(id), shellFor(id, owner));
/**
 * Stop `owner`'s background shell `id`, with everything it started: its end is nobody's to hear (BG-D6).
 * @param {unknown} id @param {ShellOwner} owner
 */
export const stopShell = async (id, owner) => {
  await opBashKill({ id }, { owner });
};
/**
 * A background command's end its caller could not hand into a running turn (BG-D4): kept untold for whoever is to
 * be told of `owner`'s shells, in the words `text` says, and told as every untold exit is — with the chat's next turn,
 * and, where no turn of its agent runs to hear it, in a turn the waker sends the chat (FO-D49). `wake: false`: never
 * that turn — the person's Stop is told with the chat's next turn alone (HarnessV4_Background_Plan E38-D3) —, kept on the
 * item (`quiet`) so no later look takes it for one that wakes. `now: false`: no turn now, but it wakes the chat as any
 * other does when the waker looks — a come-back that came while Filament was down, which the start's sweep wakes.
 * `capped: false`: no newer item puts it past UNTOLD_MAX (`withinMax`) — what a restart says of every command it ended.
 * @param {ShellOwner} owner @param {{ id: string, command: string, code: number | null, text: string, kind?: UntoldKind }} end
 * @param {{ wake?: boolean, now?: boolean, capped?: boolean }} [o]
 */
export const tellLater = (owner, { id, command, code, text, kind = "exit" }, { wake = true, now = true, capped = true } = {}) => {
  const k = ownerKey(toldTo(owner));
  untold.set(k, withinMax([...(untold.get(k) || []).filter((x) => x.id !== id), { id, command, code, agent: owner.agent, text, kind, ...(capped ? {} : { capped }), ...(wake ? {} : { quiet: true }) }], k));
  if (wake && now && !attending.has(k)) wakeChat(owner.session);
};
/**
 * The chats' come-backs (agent/come-back.js, as Claude Code's scheduled wakeup: the owner's word of 10-27), by session:
 * one each, a new one replacing it. When its time comes its note is told as a shell's exit is (`tellLater`, kind
 * "wake") — at the main agent's next step while a turn of it runs, else in a turn the waker sends the chat. The person's
 * Stop drops them, and so does their Cancel (`cancelComeBack`). Each set, replace, drop and time that comes is heard
 * (`onComeBackChange`): the page shows the come-back while it waits (the Designer's of 10-27), and the chat keeps it
 * across a restart (`comeBackKept`, `keepComeBack`; the nudge map of 11-10).
 * @type {Map<string, { id: string, at: number, setAt: number, note: string, timer: ReturnType<typeof setTimeout> }>}
 */
const comeBacks = new Map();
/**
 * A chat's come-back as Filament says it while it waits: when, on Filament's clock, and the agent's note.
 * @typedef {{ at: number, note: string }} ComeBack
 */
/** The soonest and the latest a chat's agent may come back, in seconds: Claude Code's own bounds. */
export const COME_BACK_MIN_S = 60;
export const COME_BACK_MAX_S = 3600;
let comeBackSeq = 0;
/** Who hears that a chat's come-back changed: the server, which says it to the page. */
const comeBackHearers = new Set();
/**
 * Call `fn` with a session whenever its come-back is set, replaced or dropped, or its time comes. Answers how to stop
 * hearing it. @param {(session: string) => void} fn @returns {() => void}
 */
export const onComeBackChange = (fn) => {
  comeBackHearers.add(fn);
  return () => void comeBackHearers.delete(fn);
};
/** @param {string} session */
const comeBackChanged = (session) => {
  for (const fn of [...comeBackHearers]) {
    try {
      fn(session);
    } catch {}
  }
};
/**
 * Come back to `session` in `seconds`, held to COME_BACK_MIN_S..COME_BACK_MAX_S, with `note`: the come-back set
 * before is replaced. Answers when, the seconds it holds, and the one it replaced.
 * @param {string} session @param {{ seconds: number, note: string }} o
 * @returns {{ at: number, seconds: number, replaced: ComeBack | null }}
 */
export const comeBackLater = (session, { seconds, note }) => {
  const s = Math.min(COME_BACK_MAX_S, Math.max(COME_BACK_MIN_S, Math.round(Number(seconds) || 0)));
  const was = comeBacks.get(session) || null;
  if (was) clearTimeout(was.timer);
  const id = `wake_${(++comeBackSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const setAt = Date.now();
  armComeBack(session, { id, at: setAt + s * 1000, setAt, note });
  return { at: setAt + s * 1000, seconds: s, replaced: was ? { at: was.at, note: was.note } : null };
};
/**
 * A chat's come-back waiting for its time, `at`: as it comes, its note is told (`comeBackCame`).
 * @param {string} session @param {{ id: string, at: number, setAt: number, note: string }} c
 */
const armComeBack = (session, { id, at, setAt, note }) => {
  const timer = setTimeout(() => {
    if (comeBacks.get(session)?.id !== id) return;
    comeBacks.delete(session);
    comeBackCame(session, { id, at, setAt, note });
    comeBackChanged(session);
  }, Math.max(0, at - Date.now()));
  timer.unref?.();
  comeBacks.set(session, { id, at, setAt, note, timer });
  comeBackChanged(session);
};
/**
 * A come-back's time came: its note told to the chat's main agent, by its id — so one told again is told once. One that
 * came while Filament was not running says so, and how late (`down`: `keepComeBack`, the nudge map of 11-10).
 * @param {string} session @param {{ id: string, at: number, setAt: number, note: string }} c @param {{ down?: boolean }} [o]
 *   `down`: told as Filament starts — it wakes nothing now: the start's sweep wakes its chat
 */
const comeBackCame = (session, { id, at, setAt, note }, { down = false } = {}) => {
  const ago = Math.max(1, Math.round((Date.now() - setAt) / 60_000));
  const late = Math.max(1, Math.round((Date.now() - at) / 60_000));
  const was = down ? ` It was due ${late} min ago, while Filament was not running, so it comes late.` : "";
  tellLater({ session, agent: null }, { id, command: "", code: null, kind: "wake", text: `[Filament: the time you set has come — ${ago} min ago you asked to come back to this chat.${was} Your note: ${note}]` }, { now: !down });
};
/**
 * A chat's come-back as the chat keeps it for a restart (sessions/owed-wakes.js): its id, when, when it was set, and
 * its note — null where none waits. @param {string} session @returns {{ id: string, at: number, setAt: number, note: string } | null}
 */
export const comeBackKept = (session) => {
  const c = comeBacks.get(session);
  return c ? { id: c.id, at: c.at, setAt: c.setAt, note: c.note } : null;
};
/**
 * A come-back the chat kept as Filament last stopped, as it starts again (the nudge map of 11-10: "Nothing wakes a chat
 * after a restart"): one whose time is still to come waits for it again; one whose time came while Filament was not
 * running is told now, once, in words that say it came late — waking nothing: the start's sweep wakes the chat. One set
 * since, or already told by its id, is left as it is. → "armed", "due", or null where it was left.
 * @param {string} session @param {{ id: string, at: number, setAt: number, note: string }} c
 * @returns {"armed" | "due" | null}
 */
export const keepComeBack = (session, c) => {
  if (!session || !c?.id || comeBacks.has(session) || stillUntold({ session, agent: null }, c.id)) return null;
  if (c.at > Date.now()) {
    armComeBack(session, c);
    return "armed";
  }
  comeBackCame(session, c, { down: true });
  return "due";
};
/**
 * Drop `session`'s come-back: answers the one dropped — its id too, for a word told of it —, null where none was set.
 * @param {string} session @returns {(ComeBack & { id: string }) | null}
 */
export const cancelComeBack = (session) => {
  // One whose time came and that waits untold goes too: dropped is dropped, whichever side of its time (the Hunter's
  // find of 10-27).
  const k = ownerKey(mainOf({ session, agent: null }));
  const rest = (untold.get(k) || []).filter((x) => x.kind !== "wake");
  if (rest.length) untold.set(k, rest);
  else untold.delete(k);
  const was = comeBacks.get(session);
  if (!was) return null;
  clearTimeout(was.timer);
  comeBacks.delete(session);
  comeBackChanged(session);
  return { id: was.id, at: was.at, note: was.note };
};
/**
 * Drop Filament's check-in on `session`'s running commands where it waits untold (sessions/idle-wake.js): the person
 * stopped the chat, and their next message carries no word of an idle the Stop made.
 * @param {string} session
 */
export const dropIdleNotes = (session) => {
  const k = ownerKey(mainOf({ session, agent: null }));
  const rest = (untold.get(k) || []).filter((x) => x.kind !== "idle");
  if (rest.length) untold.set(k, rest);
  else untold.delete(k);
};
/** `session`'s come-back while one is set: when, and its note. @param {string} session @returns {ComeBack | null} */
export const comeBackOf = (session) => {
  const c = comeBacks.get(session);
  return c ? { at: c.at, note: c.note } : null;
};
/** Every chat's come-back while one is set, by session: the five-second holders read. @returns {Map<string, ComeBack>} */
export const comeBacksNow = () => new Map([...comeBacks].map(([session, c]) => [session, { at: c.at, note: c.note }]));
/** Whether `owner`'s item `id` still waits untold, for whoever is told of its shells now. @param {ShellOwner} owner @param {string} id */
const stillUntold = (owner, id) => (untold.get(ownerKey(toldTo(owner))) || []).some((x) => x.id === id);
/**
 * Whether every item a session's main agent is to be told of is of `kind`: the words of the turn that wakes the chat
 * say what came (sessions/wake.js `wakeLineFor`) — the person's Cancel of a come-back rides along, and came for no one
 * (`wakes`). @param {string} session @returns {UntoldKind | "mixed" | null}
 */
export const wakeKindOf = (session) => {
  const kinds = new Set((untold.get(ownerKey(mainOf({ session, agent: null }))) || []).filter(wakes).map((x) => x.kind || "exit"));
  return kinds.size === 0 ? null : kinds.size === 1 ? /** @type {UntoldKind} */ ([...kinds][0]) : "mixed";
};
/**
 * A running background shell as the page and a move name it: its command, the folder it started in, when, the agent
 * that started it (null for the session's main agent), the newest of its output as kept (`out`, of `produced` in all)
 * and the file with all of it where it keeps one — and the machine it runs on, where that is another (`cwd` is a folder
 * there).
 * @typedef {{ id: string, command: string, cwd: string, startedAt: number, agent: string | null, out: string, produced: number, logPath: string | null, machine?: string }} RunningShell
 */
/** @param {string} id @param {BackgroundShell} s @returns {RunningShell} */
const runningOf = (id, s) => ({ id, command: s.command, cwd: s.cwd, startedAt: s.startedAt, agent: s.owner.agent, out: s.out, produced: s.produced, logPath: s.logPath, ...(s.machine ? { machine: s.machine } : {}) });
/**
 * The background shells a session's agents started that still run: what a move of the chat names and leaves running
 * (HarnessV4_Git_Plan GW-D85), and what the chat's status and Now show (HarnessV4_Background_Plan E38).
 * @param {string} session @returns {RunningShell[]}
 */
export const runningShellsOf = (session) => [...shells].filter(([, s]) => s.owner.session === session && isRunning(s)).map(([id, s]) => runningOf(id, s));
/**
 * Every session's running background shells, by session: the five-second holders read (E38-D4). A shell of no
 * session is no chat's, and is left out. @returns {Map<string, RunningShell[]>}
 */
export const runningShells = () => {
  /** @type {Map<string, RunningShell[]>} */
  const out = new Map();
  for (const [id, s] of shells) {
    if (!s.owner.session || !isRunning(s)) continue;
    out.set(s.owner.session, [...(out.get(s.owner.session) || []), runningOf(id, s)]);
  }
  return out;
};
/**
 * Where a read of `s` may end, as an absolute count like `produced`. All of it unless `holding` (the shell runs and
 * the session redacts): then the end of its last finished line (a line ends at \n, or at \r, a progress bar's
 * redraw), or all but the last BG_HOLD characters of an unfinished line longer than that. A read that lands while a
 * secret is still being printed must not show the half that no pattern can match yet (decision 20).
 * @param {{ out: string, produced: number }} s @param {boolean} holding
 */
const settledEnd = (s, holding) => {
  if (!holding) return s.produced;
  const brk = Math.max(s.out.lastIndexOf("\n"), s.out.lastIndexOf("\r"));
  return Math.max(s.produced - s.out.length + brk + 1, s.produced - BG_HOLD);
};
/** How many leading characters two texts share. @param {string} a @param {string} b */
const sharedHead = (a, b) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};
/**
 * The output of `s` between two absolute counts, as the model may read it. The session's redaction runs over the
 * whole kept output, never over the slice alone, so a secret that arrived across two reads is matched whole (item
 * 22). Each end of the slice is found in the redacted output by how far the redacted output up to that end agrees
 * with it. A mark that covers `from` is shown whole, so the part of a secret an earlier read showed is named again as
 * redacted; a mark that runs past `to` waits for the read that reaches its end.
 * @param {{ out: string, produced: number }} s @param {number} from @param {number} to
 * @param {((text: string) => string) | null | undefined} redact
 */
const outputBetween = (s, from, to, redact) => {
  // Cursor arithmetic on the rolling tail: `produced` is the absolute count, `out` is its bounded tail — what
  // rotated past the tail is gone, and the cursor clamps to what the buffer still holds.
  const dropped = s.produced - s.out.length;
  const a = Math.max(0, from - dropped);
  const b = Math.max(a, to - dropped);
  if (!redact) return s.out.slice(a, b);
  const whole = redact(s.out);
  return whole.slice(sharedHead(redact(s.out.slice(0, a)), whole), sharedHead(redact(s.out.slice(0, b)), whole));
};
/** What a read held back, in words the model can act on. @param {number} n */
const heldNote = (n) =>
  n > 0
    ? `\n[Filament: ${n.toLocaleString()} more character${n === 1 ? " is" : "s are"} an unfinished line, shown once the line ends or the command exits: this session redacts, and a secret is matched only whole]`
    : "";
/**
 * `remote`: a command on another machine (the remote-agents plan's c-tools) — its start there, which answers the shell
 * kept here once it runs there (`keepRemoteShell`), or refuses in words.
 * @param {any} input @param {string} root
 * @param {{ maxBytes?: number, redact?: ((text: string) => string) | null, owner?: ShellOwner | null, shell?: import("./shell.js").Shell | null, remote?: ((input: any) => Promise<{ id: string, s: BackgroundShell }>) | null }} [opts]
 */
const opBashBackground = async (input, root, opts = {}) => {
  // A pattern that does not compile is refused before anything starts.
  const watchRe = input.watch == null || input.watch === "" ? null : untilRe(input.watch, "watch");
  // Its lines are told to a chat: a request that names none has nobody to tell (the Hunter's find of 10-27).
  if (watchRe && !opts.owner?.session)
    throw new HandError(`watch needs a chat to tell its lines to, and this request names none: start the command without watch, and follow it with bash_output({ id, until: "<pattern>" }).`);
  // cwd is a folder on another machine, read by `remote`: here the command starts in the task folder, as every call does
  // (the loop refuses cwd without machine where machine is offered).
  const { id, s } = opts.remote ? await opts.remote(input) : startShell(input.command, root, opts.owner || NO_OWNER, opts.shell || SHELL);
  if (watchRe) watchShell(id, s, watchRe, opts.redact);
  const graceMs = Math.max(0, Math.min(5, Number(input.grace) > 0 ? Number(input.grace) : 1.5)) * 1000;
  const until = Date.now() + graceMs;
  while (isRunning(s) && Date.now() < until) await new Promise((r) => setTimeout(r, BG_POLL_MS));
  const running = isRunning(s);
  // What the start text shows is read: the model's next bash_output must return only what lands after this.
  const end = settledEnd(s, running && !!opts.redact);
  const out = outputBetween(s, 0, end, opts.redact);
  const budget = contentBudget(opts.maxBytes);
  const early = out ? newestOutput(out, budget) : "";
  s.read = end;
  // The lines a watch caught while the early output came are in it: not told again — unless that output was cut, and
  // they may be among what it left out (the Hunter's find of 10-27).
  if (watchRe && !(out && tailLinesWithin(out, budget).text.length < out.replace(/\n$/, "").length)) unTell(s, `${id}:watch`);
  // One on another machine says which, and how long Filament there lets it run (remote-commands.js asks for that).
  const on = s.machine ? ` on ${s.machine}` : "";
  if (!running) {
    sawExit(s, id);
    return `Background shell ${id} already finished${on} (${s.why || `exit code ${s.proc.exitCode ?? s.exited ?? "?"}`}). Output:\n\n${early || "(no output)"}`;
  }
  const there = s.machine ? ` Filament on ${s.machine} stops it ${spanWords(TIMED_OUT_CEILING_MS)} after it started there.` : "";
  // Told when it exits (HarnessV4_Four_Plan FO-D51): the agent need not wait on a command that announces its end. A
  // shell of no session has no chat to wake.
  const told = !s.owner.session
    ? ""
    : s.owner.agent === null
      ? " When it exits you are told: at your next step, or, once your turn has ended, in a turn Filament starts by itself."
      : " When it exits you are told at your next step; once your run is over, the session's agent is told instead.";
  // A watch catches the lines after the early output (`watchShell`): those the start shows are read.
  const watching = watchRe ? ` Each new line of its output that matches /${watchRe.source}/ is told to you as it comes: at your next step, or, once your turn has ended, in a turn Filament starts by itself.` : "";
  return [
    `Background shell ${id} started${on} — it keeps running across turns (and stops when Filament exits).${there}${told}${watching}`,
    "",
    `${early ? `Early output:\n${early}` : "No output yet."}${heldNote(s.produced - end)}`,
    "",
    `Follow it with bash_output({ id: "${id}", wait: 10 }); stop it with bash_kill({ id: "${id}" }).`,
  ].join("\n");
};
/** A read's longest wait, in seconds: for the next output, or (with `until`) for the line it names (TL-D24). */
const WAIT_MAX_S = 30;
const UNTIL_WAIT_MAX_S = 300;
/**
 * How long a bash_output read may wait, in ms: `wait` seconds, by default none, or 30 s for the line `until` names;
 * at most 30 s, or 300 s with `until`.
 * @param {unknown} wait @param {boolean} withUntil
 */
export const outputWaitMs = (wait, withUntil) => {
  const asked = wait == null || wait === "" ? (withUntil ? WAIT_MAX_S : 0) : Number(wait) || 0;
  return Math.max(0, Math.min(withUntil ? UNTIL_WAIT_MAX_S : WAIT_MAX_S, asked)) * 1000;
};
/** @param {unknown} src @param {string} [field]  the field it came in: until, or a background command's watch */
const untilRe = (src, field = "until") => {
  try {
    return new RegExp(String(src));
  } catch (/** @type {any} */ e) {
    throw new HandError(`${field} is a regular expression, and this one does not compile: ${e.message}`);
  }
};
/**
 * How long `until`'s pattern may take over one batch of a shell's lines. It is the model's, and it runs on the proxy's
 * own thread: one that backtracks without end would hold every stream and request (the bug report's P9).
 */
export const UNTIL_TEST_MS = 250;
/**
 * How long from its first run a test stopped past `UNTIL_TEST_MS` is run again, where the thread spent little of it on
 * its CPU (FabeleHelper's of 11-10: the full suite kept the thread off the CPU through three runs in a row, the most it
 * had then).
 */
export const UNTIL_WAIT_MS = 2000;
const untilBox = createContext({ re: null, lines: null });
const untilScan = new Script("lines.findIndex((l) => re.test(l))");
/**
 * `scan` of `lines` by `re`, or null when it ran past `UNTIL_TEST_MS` and was stopped. The vm keeps that time on a
 * clock, which also runs while a loaded machine keeps the thread waiting for a CPU: a run stopped is run again while the
 * runs so far spent less than half of it on the thread's own CPU, for `UNTIL_WAIT_MS` from the first, where a pattern
 * that backtracks without end spends the time it is given on the CPU. Where Node does not say the thread's CPU time,
 * the clock alone decides.
 * @template T @param {Script} scan @param {RegExp} re @param {string[]} lines @returns {T | null}
 */
const heldScan = (scan, re, lines) => {
  const cpuOf = typeof process.threadCpuUsage === "function" ? () => process.threadCpuUsage() : null;
  const began = Date.now();
  let spentMs = 0;
  Object.assign(untilBox, { re, lines });
  try {
    for (;;) {
      const cpu = cpuOf?.();
      try {
        return scan.runInContext(untilBox, { timeout: UNTIL_TEST_MS });
      } catch (/** @type {any} */ e) {
        if (e?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e;
        const spent = cpu ? process.threadCpuUsage(cpu) : null;
        if (!spent) return null;
        spentMs += (spent.user + spent.system) / 1000;
        if (spentMs >= UNTIL_TEST_MS / 2 || Date.now() - began >= UNTIL_WAIT_MS) return null;
      }
    }
  } finally {
    Object.assign(untilBox, { re: null, lines: null });
  }
};
/**
 * Which of `lines` `re` matches first: its index, -1 for none, or null when the test ran past `UNTIL_TEST_MS` and
 * was stopped.
 * @param {RegExp} re @param {string[]} lines @returns {number | null}
 */
export const firstMatch = (re, lines) => heldScan(untilScan, re, lines);
const allScan = new Script("lines.filter((l) => re.test(l))");
/**
 * Which of `lines` `re` matches, in order, or null when the test ran past `UNTIL_TEST_MS` and was stopped.
 * @param {RegExp} re @param {string[]} lines @returns {string[] | null}
 */
const allMatches = (re, lines) => heldScan(allScan, re, lines);
/** The most lines of one watch kept untold: past them the oldest go, counted. */
export const WATCH_KEEP = 50;
/** A watched line is told cut to this many characters. */
const WATCH_LINE_CHARS = 400;
/**
 * A background shell watched as Claude Code's Monitor watches a process (the owner's word of 10-27: "Watching a
 * running process: this needs to work like claude as well"): each new line of its output that `re` matches, redacted
 * as the agent reads it, is told to the agent as it comes — at its next step while its turn runs, else in a turn Filament
 * starts by itself (`tellLater`, the waker). Lines that come before they are told join the same item, the newest
 * WATCH_KEEP of them; a pattern that runs too long over a batch ends the watch, said once. The shell's end tests its
 * unfinished last line and ends the watch (`endWatch`).
 * @param {string} id @param {BackgroundShell} s @param {RegExp} re @param {((text: string) => string) | null | undefined} redact
 */
const watchShell = (id, s, re, redact) => {
  const item = `${id}:watch`;
  const command = headChars(s.command.replace(/\s+/g, " ").trim(), 80);
  let part = "";
  /** @type {string[]} */
  let lines = [];
  let dropped = 0;
  let over = false;
  const caughtText = () => {
    const n = lines.length + dropped;
    const head = `[Filament: background shell ${id} (${command}) printed ${n === 1 ? "a line" : `${n.toLocaleString()} lines`} you watch for (/${re.source}/)${dropped ? `; the newest ${lines.length} are below` : ""}:`;
    return `${head}\n${lines.join("\n")}]`;
  };
  const tell = () => tellLater(s.owner, { id: item, command: s.command, code: null, text: caughtText(), kind: "lines" });
  /** @param {string[]} got */
  const take = (got) => {
    if (over || !got.length) return;
    const hits = allMatches(re, redact ? got.map(redact) : got);
    if (hits === null) {
      over = true;
      s.watchers.delete(feed);
      const stop = `[Filament: stopped watching background shell ${id} (${command}): the pattern /${re.source}/ took too long over its output. bash_output reads it.]`;
      // The lines caught before, still untold, go with it: the stop replaces none of them (the Hunter's find of 10-27).
      const caught = lines.length && stillUntold(s.owner, item) ? `${caughtText()}\n` : "";
      tellLater(s.owner, { id: item, command: s.command, code: null, text: `${caught}${stop}`, kind: "lines" });
      return;
    }
    if (!hits.length) return;
    // What was told is gone from the list: the next lines start a new item.
    if (!stillUntold(s.owner, item)) {
      lines = [];
      dropped = 0;
    }
    lines.push(...hits.map((l) => (l.length > WATCH_LINE_CHARS ? `${l.slice(0, WATCH_LINE_CHARS)}…` : l)));
    if (lines.length > WATCH_KEEP) {
      dropped += lines.length - WATCH_KEEP;
      lines = lines.slice(-WATCH_KEEP);
    }
    tell();
  };
  const feed = (/** @type {string} */ text) => {
    const got = (part + text).split(/\r\n|\r|\n/);
    part = /** @type {string} */ (got.pop()).slice(-BG_TAIL);
    take(got);
  };
  s.watchers.add(feed);
  s.endWatch = () => {
    if (part) take([part]);
    part = "";
    over = true;
    s.watchers.delete(feed);
  };
};
/**
 * Watches `s` for a line that matches `re`: the lines not yet read, then each batch as it lands. A line is tested as
 * the model reads it, redacted; the unfinished last one only once the shell has exited (`end`), when it is finished.
 * A batch the pattern takes too long over ends the watch (`stuck`), unmatched.
 * @param {BackgroundShell} s @param {RegExp} re @param {((text: string) => string) | null | undefined} redact
 */
const watchLines = (s, re, redact) => {
  let part = "";
  /** @type {string | null} */
  let hit = null;
  let stuck = false;
  const test = (/** @type {string[]} */ lines) => {
    if (!lines.length) return;
    const seen = redact ? lines.map(redact) : lines;
    const at = firstMatch(re, seen);
    if (at === null) stuck = true;
    else if (at >= 0) hit = seen[at];
  };
  const feed = (/** @type {string} */ text) => {
    if (hit !== null || stuck) return;
    const lines = (part + text).split(/\r\n|\r|\n/);
    part = /** @type {string} */ (lines.pop()).slice(-BG_TAIL);
    test(lines);
  };
  feed(outputBetween(s, s.read, s.produced, null));
  return {
    feed,
    hit: () => hit,
    stuck: () => stuck,
    end: () => {
      if (hit === null && !stuck && part) test([part]);
      return hit;
    },
  };
};
/** @param {any} input @param {any} opts */
const opBashOutput = async (input, opts = {}) => {
  const s = shellFor(input.id, opts.owner);
  const re = input.until == null || input.until === "" ? null : untilRe(input.until);
  const waitMs = outputWaitMs(input.wait, !!re);
  const until = Date.now() + waitMs;
  /** @type {AbortSignal | null} */
  const signal = opts.signal || null;
  const live = s.onOutput === null;
  if (live) s.onOutput = opts.onOutput || null; // the wait streams into the chat as it lands
  const watch = re ? watchLines(s, re, opts.redact) : null;
  if (watch) s.watchers.add(watch.feed);
  const endNow = () => settledEnd(s, isRunning(s) && !!opts.redact);
  const unread = () => endNow() - s.read;
  // What ends the wait: the next output, or with `until` the line it names or a pattern too slow to watch with; the
  // exit, the time, and the turn's stop.
  const got = () => (watch ? watch.hit() !== null || watch.stuck() : unread() > 0);
  try {
    while (isRunning(s) && Date.now() < until && !got() && !signal?.aborted) await new Promise((r) => setTimeout(r, BG_POLL_MS));
    // A command's last line reaches the pipe a moment before the process exits (BUG-23): a read that ended on output
    // gives the exit that moment, inside what is left of its wait, so the last line and the exit arrive together
    // instead of "still running" beside the final output. A command that keeps running costs the read this much.
    if (unread() > 0 && isRunning(s) && !signal?.aborted) {
      const settleUntil = Math.min(until, Date.now() + EXIT_SETTLE_MS);
      while (isRunning(s) && Date.now() < settleUntil) await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    if (live) s.onOutput = null;
    if (watch) s.watchers.delete(watch.feed);
  }
  const running = isRunning(s);
  const end = Math.max(s.read, settledEnd(s, running && !!opts.redact));
  const fresh = outputBetween(s, s.read, end, opts.redact);
  s.read = end;
  if (!running) sawExit(s, String(input.id));
  const hit = watch ? (running ? watch.hit() : watch.end()) : null;
  // One its timeout sent to the background, stopped at its ceiling: Filament's stop, not a failure of its own. One on
  // another machine says which, and how it ended there where it did not exit on its own.
  const on = s.machine ? ` on ${s.machine}` : "";
  const status = running ? `still running${on}` : s.ceilinged ? `stopped by Filament: it still ran ${s.ceilinged} after it started, past its timeout` : s.why ? `ended${on}: ${s.why}` : `exited with code ${s.proc.exitCode ?? s.exited ?? "?"}${on}`;
  const why =
    hit !== null
      ? ` — this line matched until: ${headChars(hit.trim(), 200)}`
      : watch?.stuck()
        ? ` — until's pattern ran past ${UNTIL_TEST_MS} ms on this output, so the wait stopped watching for it: use a simpler pattern`
        : signal?.aborted && running
          ? " — the turn's stop ended the wait"
          : watch
            ? ` — no line matched until${running ? ` in ${Math.round(waitMs / 1000)} s` : ""}`
            : "";
  const shown = fresh ? newestOutput(fresh, contentBudget(opts.maxBytes)) : "";
  return `[${input.id} ${status}${why}]\n${shown || "(no new output yet)"}${heldNote(s.produced - end)}`;
};
/** @param {any} input @param {{ owner?: ShellOwner | null }} [opts] */
const opBashKill = async (input, opts = {}) => {
  const s = shellFor(input.id, opts.owner);
  s.stopped = true;
  shells.delete(String(input.id));
  sawExit(s, String(input.id));
  shellsChanged(s.owner.session);
  await s.stop();
  return `Background shell ${input.id} stopped${s.machine ? ` on ${s.machine}` : ""}.`;
};


// rg is probed lazily (never at import) and run asynchronously: a synchronous child process would freeze every
// in-flight stream, heartbeat and dashboard request for as long as the search takes.
let rgProbe = null;
const hasRg = () => {
  if (rgProbe === null) {
    try {
      execFileSync("rg", ["--version"], { stdio: "ignore" });
      rgProbe = true;
    } catch {
      rgProbe = false;
    }
  }
  return rgProbe;
};

// ---- grep: matching lines with their context, the files, or the counts; sorted by path and paged (TL-D8) ----
const GREP_FILES_MAX = 500;
const GREP_CONTEXT_MAX = 50;
const GREP_TIMEOUT_MS = 20_000;
/** How long past the search's time the walker's thread is given to hand back what it found, before it is ended. */
const WALK_OVER_MS = 250;
const GREP_OUTPUTS = ["content", "files", "count"];
/**
 * What a search found — the same from rg and from the walker, so one shape serves both. Per file, in path order: the
 * lines it may show (its matching lines and the context around them, by line number), its entries (a matching line;
 * with `multiline` each match, by its first and last line) and how many matching lines it has.
 * `long`: the lines of rg's output past what Filament reads of one (`LINE_MAX`), left out unread — a match, or a line
 * around one, on a line of its file as long.
 * @typedef {{ path: string, lines: Map<number, string>, entries: [number, number][], count: number }} GrepFile
 * @typedef {{ files: GrepFile[], timedOut: boolean, long?: number }} GrepFound
 * `readRules`: the files the session's rules refuse a read of, which neither search reports (core/read-rules.js).
 * `kept`: the files another machine's agents never read (`theirsKept`), which neither search reports to them.
 * @typedef {{ before: number, after: number, wanted: number, multiline: boolean, timeoutMs: number, signal?: AbortSignal | null, readRules?: { root: string, rules: import("../../core/read-rules.js").ReadRules } | null, kept?: ((path: string) => boolean) | null }} GrepHow
 */
/**
 * Whether a file a search or a listing found under `dir` is kept from another machine's agents (fs-fence.js
 * `keptBelow`): a walk named no such folder, but comes by one that has no dot to hide it (a browser's profile). Where
 * their hands are not fenced (Auto), Filament's own data folder alone (`filamentBelow`, s0d). Null for any other caller.
 * @param {string} dir @param {string} root @param {{ theirs?: boolean, fenced?: boolean, reads?: readonly string[] }} opts
 */
const theirsKept = (dir, root, opts) => (!opts.theirs ? null : opts.fenced !== false ? keptBelow(dir, [root, ...(opts.reads || [])]) : keptFolders().length ? filamentBelow(dir) : null);

/** A JSON text field from rg: text, or base64 bytes for what is not UTF-8. @param {any} o */
const rgText = (o) => (typeof o?.text === "string" ? o.text : o?.bytes ? Buffer.from(String(o.bytes), "base64").toString("utf8") : "");
/** rg's own words for what it refused (a pattern it cannot parse, a type it does not know), on one line. @param {string} err */
const rgWords = (err) => headChars(err.replace(/^rg: /gm, "").replace(/\s+/g, " ").trim(), 400);

/**
 * Run rg, each line of its output to `onLine`, which answers true once it has enough: rg is stopped then, as it is
 * at the timeout. @param {string[]} args @param {(line: string) => boolean} onLine @param {number} [timeoutMs]
 * @param {AbortSignal | null} [signal]  the turn's Stop
 * @returns {Promise<{ code: number | string | null, timedOut: boolean, stderr: string, long: number }>}  `long`: its
 *   output's lines past what Filament reads of one, left out
 */
const runRg = (args, onLine, timeoutMs = GREP_TIMEOUT_MS, signal = null) =>
  new Promise((resolveP, rejectP) => {
    let proc;
    try {
      proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      rejectP(new HandError(`grep failed: ${/** @type {Error} */ (e).message}`));
      return;
    }
    const dec = new StringDecoder("utf8");
    let long = 0;
    // A match on a long line is one long line of rg's JSON, in many chunks; one past `LINE_MAX` is left out, counted.
    const lines = createLineReader(
      (raw) => {
        const l = raw.replace(/\r$/, "");
        return !!l && onLine(l);
      },
      { onOver: () => void long++ },
    );
    let stderr = "";
    let settled = false;
    const finish = (/** @type {number | string | null} */ code, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onStop);
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolveP({ code, timedOut, stderr, long });
    };
    const timer = setTimeout(() => finish(null, true), timeoutMs);
    timer.unref?.();
    // The turn's Stop ends the search with what it found (the Hunter's find of 10-27: rg ran out its time).
    const onStop = () => finish("stopped");
    if (signal?.aborted) onStop();
    else signal?.addEventListener("abort", onStop, { once: true });
    proc.stdout.on("data", (d) => {
      if (settled) return;
      if (lines.push(dec.write(d))) finish("enough");
    });
    proc.stderr.on("data", (d) => {
      if (stderr.length < 4096) stderr += d;
    });
    proc.on("close", (code) => {
      const rest = lines.rest();
      if (!settled && rest.trim()) onLine(rest.replace(/\r$/, ""));
      finish(code);
    });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectP(new HandError(`grep failed: ${e.message}`));
    });
  });

/**
 * The search by rg: sorted by path (so an offset pages the same list every time), the developer's rg config left
 * out (it could change what rg prints). Matching lines come as JSON, which names every path and line unmistakably.
 * @param {any} input @param {string} pattern @param {string} abs @param {string} mode @param {GrepHow} how
 * @returns {Promise<GrepFound>}
 */
const rgFind = async (input, pattern, abs, mode, { before, after, wanted, multiline, timeoutMs, signal = null, readRules = null, kept = null }) => {
  const rules = keptOut(readRules);
  const out = rules || kept ? (/** @type {string} */ path) => !!rules?.(path) || !!kept?.(path) : null;
  const args = [
    "--no-config",
    "--sort",
    "path",
    ...(input.ignoreCase ? ["-i"] : []),
    ...(input.literal ? ["-F"] : []),
    ...(multiline ? ["-U", "--multiline-dotall"] : []),
    ...(input.glob ? ["-g", String(input.glob)] : []),
    ...(input.type ? ["-t", String(input.type)] : []),
  ];
  /** @type {GrepFile[]} */
  const files = [];
  let entries = 0;
  const fileOf = (/** @type {string} */ path) => {
    const last = files.at(-1);
    if (last?.path === path) return last;
    /** @type {GrepFile} */
    const f = { path, lines: new Map(), entries: [], count: 0 };
    files.push(f);
    return f;
  };
  /** @type {(line: string) => boolean} */
  let onLine;
  if (mode === "content") {
    args.push("--json", ...(before ? ["-B", String(before)] : []), ...(after ? ["-A", String(after)] : []));
    onLine = (l) => {
      let m;
      try {
        m = JSON.parse(l);
      } catch {
        return false;
      }
      if (m?.type !== "match" && m?.type !== "context") return false;
      const d = m.data;
      const path = rgText(d.path);
      if (out?.(path)) return false;
      const f = fileOf(path);
      const raw = rgText(d.lines);
      const first = Number(d.line_number);
      raw.replace(/\r?\n$/, "").split("\n").forEach((t, i) => f.lines.set(first + i, t.replace(/\r$/, "")));
      if (m.type === "match") {
        f.count++;
        if (!multiline) {
          f.entries.push([first, first]);
          entries++;
        } else {
          // rg joins matches on neighbouring lines into one message: each submatch is a match of its own, its lines
          // found from its byte offsets in the message's text.
          const bytes = Buffer.from(raw, "utf8");
          const lineAt = (/** @type {number} */ off) => {
            let n = first;
            for (let i = 0; i < off && i < bytes.length; i++) if (bytes[i] === 10) n++;
            return n;
          };
          for (const s of d.submatches || []) {
            f.entries.push([lineAt(s.start), lineAt(Math.max(s.start, s.end - 1))]);
            entries++;
          }
        }
      }
      return entries >= wanted;
    };
  } else {
    args.push(mode === "files" ? "--files-with-matches" : "--count");
    onLine = (l) => {
      const at = mode === "files" ? l.length : l.lastIndexOf(":");
      const path = l.slice(0, at);
      if (out?.(path)) return false;
      fileOf(path).count = mode === "files" ? 1 : Number(l.slice(at + 1)) || 0;
      return files.length >= wanted;
    };
  }
  const r = await runRg([...args, "--", pattern, abs], onLine, timeoutMs, signal);
  if (!files.length && !r.timedOut && r.code !== 0 && r.code !== 1 && r.code !== "enough")
    throw new HandError(r.stderr.trim() ? `grep failed: ${rgWords(r.stderr)}` : `grep failed (exit ${r.code})`);
  return { files, timedOut: r.timedOut, ...(r.long ? { long: r.long } : {}) };
};

/**
 * No rg on this machine: the walk of `grep-walk.js`, in a worker thread, so neither its reads nor a pattern that
 * backtracks without end hold the proxy (the bug report's P9). `type` is rg's own list of file kinds, so it is refused
 * in words here rather than ignored; a pattern that does not compile fails the worker, in words that are the hand's
 * refusal. The files come back as found; at the search's time, and a moment over for a pattern still running
 * (`WALK_OVER_MS`), the worker is ended, and what it found stands, said as cut short.
 * @param {any} input @param {string} pattern @param {string} abs @param {string} mode @param {GrepHow} how
 * @returns {Promise<GrepFound>}
 */
const walkFind = (input, pattern, abs, mode, { before, after, wanted, multiline, timeoutMs, signal = null, readRules = null, kept = null }) => {
  if (input.type) throw new HandError("type needs ripgrep (rg), which this machine does not have: use glob instead, e.g. *.py");
  const source = input.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  const flags = `${input.ignoreCase ? "i" : ""}${multiline ? "gms" : ""}`;
  /** @type {import("./grep-walk.js").Walk} */
  const grepWalk = { source, flags, glob: input.glob ? String(input.glob) : null, abs, mode, before, after, wanted, multiline, deadline: Date.now() + timeoutMs, readRules };
  return new Promise((resolveFound, reject) => {
    /** @type {GrepFile[]} */
    const files = [];
    const worker = new Worker(new URL("./grep-walk.js", import.meta.url), { workerData: { grepWalk } });
    let settled = false;
    /** @param {() => void} end */
    const settle = (end) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      end();
    };
    const timer = setTimeout(() => settle(() => resolveFound({ files, timedOut: true })), timeoutMs + WALK_OVER_MS);
    // The turn's Stop ends the walk with what it found, as a timeout does.
    const onStop = () => settle(() => resolveFound({ files, timedOut: false }));
    if (signal?.aborted) onStop();
    else signal?.addEventListener("abort", onStop, { once: true });
    worker.on("exit", () => signal?.removeEventListener("abort", onStop));
    worker.on("message", (/** @type {any} */ m) => (m.end ? settle(() => resolveFound({ files, timedOut: !!m.timedOut })) : settled || kept?.(m.file.path) || files.push(m.file)));
    worker.on("error", (e) => settle(() => reject(new HandError(`grep failed: ${e.message}`))));
    worker.on("exit", () => settle(() => reject(new HandError("grep failed: the search stopped before it finished"))));
  });
};

/**
 * One shape for both searches: the page asked for (offset, then limit) — a matching line as path:line:text, the
 * context around it as path-line-text, groups apart with -- — or the files, or each file's count; paths relative to
 * the task folder. Each line is redacted whole, then held to its cap and the caller's budget; a full page or a cut
 * names the offset to continue from.
 * @param {GrepFound} found @param {string} root @param {string} mode
 * @param {{ offset: number, limit: number, before: number, after: number, timeoutMs: number }} page @param {any} opts
 */
const grepShape = (found, root, mode, { offset, limit, before, after, timeoutMs }, opts) => {
  const shown = (/** @type {string} */ p) => {
    if (opts.fullPaths) return p;
    const rel = relative(root, p);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : p;
  };
  const word = (/** @type {number} */ n) => (mode === "content" ? (n === 1 ? "match" : "matches") : n === 1 ? "file" : "files");
  const Noun = mode === "content" ? "Matches" : "Files";
  /** Each line of the result, and how many entries it completes (the budget's cut counts them). @type {{ text: string, ends: number }[]} */
  const out = [];
  let total = 0;
  if (mode === "content") {
    /** @type {{ path: string, n: number } | null} */
    let prev = null;
    for (const f of found.files) {
      /** @type {[number, number][]} */
      const kept = [];
      for (const e of f.entries) {
        if (total >= offset && total < offset + limit) kept.push(e);
        total++;
      }
      if (!kept.length) continue;
      const own = new Set();
      const want = new Set();
      const ends = new Map();
      for (const [s, e] of kept) {
        for (let n = s; n <= e; n++) own.add(n);
        for (let n = s - before; n <= e + after; n++) if (f.lines.has(n)) want.add(n);
        ends.set(e, (ends.get(e) || 0) + 1);
      }
      const p = shown(f.path);
      for (const n of [...want].sort((a, b) => a - b)) {
        if ((before || after) && prev && (prev.path !== p || prev.n !== n - 1)) out.push({ text: "--", ends: 0 });
        const mark = own.has(n) ? ":" : "-";
        out.push({ text: `${p}${mark}${n}${mark}${f.lines.get(n)}`, ends: ends.get(n) || 0 });
        prev = { path: p, n };
      }
    }
  } else {
    total = found.files.length;
    for (const f of found.files.slice(offset, offset + limit)) out.push({ text: mode === "files" ? shown(f.path) : `${shown(f.path)}:${f.count}`, ends: 1 });
  }
  const waited = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 100) / 10} s` : `${timeoutMs} ms`;
  const long = found.long ? `\n[${found.long === 1 ? "A line" : `${found.long} lines`} of the search's output past ${LINE_MAX / 2 ** 20} MiB — a match on a line as long in its file, or a line around one — ${found.long === 1 ? "was" : "were"} left out: Filament reads no line that long.]` : "";
  const late = (found.timedOut ? `\n[The search stopped after ${waited}; what it found by then is shown. Narrow the pattern or the path.]` : "") + long;
  if (!out.length) return (offset && total ? `[${total} ${word(total)} in all; offset ${offset} is past the end.]` : "(no matches)") + late;
  const lines = out.map((o) => {
    const t = opts.redact ? opts.redact(o.text) : o.text;
    return t.length > GREP_MAX_LINE ? headChars(t, GREP_MAX_LINE) + " … [truncated]" : t;
  });
  const more = total > offset + limit;
  const fit = headLinesWithin(lines, contentBudget(opts.maxBytes) - Buffer.byteLength(late));
  if (fit < lines.length) {
    const done = out.slice(0, fit).reduce((s, o) => s + o.ends, 0);
    const head = lines.slice(0, fit).join("\n");
    if (!done) return `${head}\n[The first match's context alone is past this result's budget: ask for fewer lines around it.]${late}`;
    const rest = more || done < Math.min(limit, total - offset);
    return `${head}\n[${Noun} ${offset + 1}-${offset + done} shown — past this result's budget. ${rest ? `Use offset=${offset + done} to continue, or narrow the pattern or the path.` : "The context after the last one is cut."}]${late}`;
  }
  const sum = found.files.reduce((s, f) => s + f.count, 0);
  const tail = more
    ? `\n[${Noun} ${offset + 1}-${offset + limit} shown; there are more. Use offset=${offset + limit} to continue, or narrow the pattern or the path.]`
    : mode === "count" && !offset && !found.timedOut
      ? `\n[${sum} matching line${sum === 1 ? "" : "s"} in ${total} ${word(total)}]`
      : "";
  return lines.join("\n") + tail + late;
};

const opGrep = async (input, root, opts = {}) => {
  const abs = resolveInside(root, input.path || ".", { fenced: opts.fenced, reads: opts.reads, theirs: opts.theirs });
  const pattern = String(input.pattern ?? "");
  if (pattern.length > 500)
    throw new HandError("the search pattern is longer than 500 characters; use a shorter one");
  const mode = input.output == null || input.output === "" ? "content" : String(input.output);
  if (!GREP_OUTPUTS.includes(mode)) throw new HandError(`output is content, files or count — not ${headChars(mode, 40)}`);
  const most = mode === "content" ? GREP_MAX_MATCHES : GREP_FILES_MAX;
  const limit = Math.max(1, Math.min(most, Math.floor(Number(input.limit) || GREP_MAX_MATCHES)));
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const around = (/** @type {any} */ v, /** @type {number} */ dflt) =>
    mode !== "content" ? 0 : v == null || v === "" ? dflt : Math.max(0, Math.min(GREP_CONTEXT_MAX, Math.floor(Number(v) || 0)));
  const context = around(input.context, 0);
  const timeoutMs = Math.max(0, Number(opts.grepTimeoutMs ?? GREP_TIMEOUT_MS));
  /** @type {GrepHow} */
  const how = { before: around(input.before, context), after: around(input.after, context), wanted: offset + limit + 1, multiline: input.multiline === true, timeoutMs, signal: opts.signal || null, readRules: opts.readRules || null, kept: theirsKept(abs, root, opts) };
  const found = hasRg() && !opts.noRg ? await rgFind(input, pattern, abs, mode, how) : await walkFind(input, pattern, abs, mode, how);
  // A search outside the working folder (an added folder, or anywhere in auto) names its files whole: a path from
  // the working folder would climb out of it.
  const away = relative(resolve(root), abs);
  const whole = away === ".." || away.startsWith(`..${sep}`) || isAbsolute(away);
  return grepShape(found, root, mode, { offset, limit, before: how.before, after: how.after, timeoutMs }, whole ? { ...opts, fullPaths: true } : opts);
};

// ---- glob: a rooted listing, one path per line ----
/** A file's modification time in ms; 0 for one gone since it was listed, so it sorts as the oldest. @param {string} p */
const mtimeOf = async (p) => {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
};
/** @param {any} input @param {string} root @param {any} [opts] */
const opGlob = async (input, root, opts = {}) => {
  const pattern = String(input?.pattern || "").trim();
  if (!pattern) throw new HandError("glob needs a pattern");
  const base = resolveInside(root, String(input?.path || "."), { fenced: opts.fenced, reads: opts.reads, theirs: opts.theirs });
  let st;
  try {
    st = statSync(base);
  } catch {
    throw new HandError(`no such folder: ${input?.path || "."}`);
  }
  if (!st.isDirectory()) throw new HandError(`${input?.path} is a file, not a folder`);
  const sort = input?.sort == null || input.sort === "" ? "path" : String(input.sort);
  if (sort !== "path" && sort !== "modified") throw new HandError(`sort is "path" or "modified", not "${sort}"`);
  const limit = Math.max(1, Math.min(GLOB_LIMIT_MAX, Math.floor(Number(input?.limit) || GLOB_MAX_PATHS)));
  const re = globToRegExp(pattern);
  const byName = !pattern.includes("/") && !pattern.includes("\\");
  const out = keptOut(opts.readRules);
  const kept = theirsKept(base, root, opts);
  const matches = [];
  let seen = 0;
  const stack = [base];
  while (stack.length && seen < GLOB_WALK_MAX_FILES) {
    const dir = /** @type {string} */ (stack.pop());
    let entries;
    try {
      // Without holding the event loop, as a read: a reply's globs run side by side.
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!GLOB_SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        seen++;
        const rel = relative(base, full).split(sep).join("/");
        if (re.test(byName ? e.name : rel) && !out?.(full) && !kept?.(full)) matches.push(rel);
      }
    }
  }
  matches.sort();
  if (sort === "modified") {
    // The newest first (TL-D20): a log, a build's output, a file a tool just wrote. A tie keeps path order (the sort
    // is stable), and a file gone since the walk sorts last. The times are looked at a few at a time: all at once, up to
    // GLOB_WALK_MAX_FILES of them were queued in front of every other read and request.
    const when = new Map(await fewAtOnce(matches, async (rel) => /** @type {[string, number]} */ ([rel, await mtimeOf(join(base, rel))]), GLOB_STATS_AT_ONCE));
    matches.sort((a, b) => /** @type {number} */ (when.get(b)) - /** @type {number} */ (when.get(a)));
  }
  if (!matches.length) return `No files match ${pattern} under ${input?.path || "the task folder"}${seen >= GLOB_WALK_MAX_FILES ? ` (the first ${GLOB_WALK_MAX_FILES} files were checked; narrow the folder with path)` : ""}.`;
  const listed = matches.slice(0, limit).map((p) => (opts.redact ? opts.redact(p) : p));
  const fit = headLinesWithin(listed, contentBudget(opts.maxBytes));
  const shown = listed.slice(0, fit);
  const found = `${matches.length.toLocaleString()} match${matches.length === 1 ? "" : "es"}`;
  return (
    shown.join("\n") +
    (fit < listed.length
      ? `\n[${fit} of ${matches.length} paths shown — past this result's budget. Use a narrower pattern or path.]`
      : matches.length > limit
        ? `\n${limit} paths limit reached (${found}). ${limit < GLOB_LIMIT_MAX ? `Use limit=${Math.min(GLOB_LIMIT_MAX, limit * 2)} for more, or a narrower pattern.` : "That is the most one listing returns; use a narrower pattern or path."}`
        : "") +
    (seen >= GLOB_WALK_MAX_FILES ? `\nOnly the first ${GLOB_WALK_MAX_FILES} files were checked; narrow the folder with path.` : "")
  );
};

/**
 * Run one hand. `maxBytes` is the caller's budget for the result (RESULT_BUDGET_BYTES for a model's window; the hands'
 * own 50 KB when unset): every hand truncates to it itself, loudly. `redact` is applied to what a hand read — a file,
 * a command's output, the matches, the paths — before that cut. `signal` stops a running command with the turn.
 * `owner` is who calls, for the background shells: a shell belongs to the agent that started it (`shellFor`).
 * `shell` and `powershell` stand in for the machine's own (shell.js), so a test can run the cmd.exe fallback for real.
 * `seen` is what the calling agent has seen of its files (`Sightings`, TL-D7): read, write and edit record it, and write
 * overwrites an existing file only as the agent last saw it. `grepTimeoutMs` stands in for grep's 20 s, so a test can
 * see a stopped search say so. `fullPaths` shows grep's paths whole, for a caller whose tools speak absolute paths
 * (the MCP server's Grep). `reads`: the folders read, grep and glob may also reach (`loop.addedFolders`,
 * HarnessV4_Overnight_Plan OV-D22); write and edit never take them. `movable`: a foreground command's way to the
 * background is handed to it while the command runs (HarnessV4_Four_Plan E21); it answers how to take that way back.
 * `readRules`: the session's rules on reading (core/read-rules.js) — grep searches and glob lists no file they refuse a
 * read of. `remote`: bash_background's start on another machine (the remote-agents plan's c-tools, `opBashBackground`).
 * `fetchLfs`: a builder's copy that holds the files Git LFS keeps as their pointers fetches one read opens. `theirs`:
 * the call is for another machine's agents without Full control — read, grep and glob, while fenced, take no path in a
 * repository's own `.git` or a credentials folder, and report no file of one (fs-fence.js `keptFromAgents`).
 * @param {string} name @param {any} input
 * @param {{ root: string, noRg?: boolean, spillTtlMs?: number, grepTimeoutMs?: number, onOutput?: ((text: string) => void) | null, signal?: AbortSignal | null, maxBytes?: number, redact?: ((text: string) => string) | null, fenced?: boolean, reads?: readonly string[], theirs?: boolean, owner?: ShellOwner | null, shell?: import("./shell.js").Shell | null, powershell?: import("./shell.js").PowerShell | null, seen?: Sightings | null, pdftotext?: string | null, fullPaths?: boolean, movable?: ((move: () => { id: string } | null) => () => void) | null, readRules?: { root: string, rules: import("../../core/read-rules.js").ReadRules } | null, ceilingMs?: number, onMoved?: ((m: { id: string, timedOut: boolean }) => void) | null, remote?: ((input: any) => Promise<{ id: string, s: BackgroundShell }>) | null, fetchLfs?: FetchLfs | null }} o
 *   `ceilingMs`: how long a command its timeout sent to the background may run (TIMED_OUT_CEILING_MS); `onMoved`: told
 *   that a command went on in the background, by the developer's press or its timeout
 */
export async function runHand(name, input, { root, noRg = false, spillTtlMs = 0, grepTimeoutMs = GREP_TIMEOUT_MS, onOutput = null, signal = null, maxBytes = MAX_BYTES, redact = null, fenced = true, reads = [], theirs = false, owner = null, shell = null, powershell = null, seen = null, pdftotext = undefined, fullPaths = false, movable = null, readRules = null, ceilingMs = TIMED_OUT_CEILING_MS, onMoved = null, remote = null, fetchLfs = null } = /** @type {any} */ ({})) {
  const opts = { noRg, spillTtlMs, grepTimeoutMs, onOutput, signal, maxBytes, redact, fenced, reads, theirs, owner, shell, seen, pdftotext, fullPaths, movable, readRules, ceilingMs, onMoved, remote, fetchLfs }; // injected, not a module-level test flag
  switch (name) {
    case "read":
      return opRead(input, root, opts);
    case "write":
      return opWrite(input, root, opts);
    case "edit":
      return opEdit(input, root, opts);
    case "bash":
      return await runCommand(shell || SHELL, input, root, opts);
    case "powershell": {
      const ps = powershell || POWERSHELL;
      if (!ps) throw new HandError("there is no PowerShell on this machine; use bash");
      return await runCommand(ps, input, root, opts);
    }
    case "bash_background":
      return await opBashBackground(input, root, opts);
    case "bash_output":
      return await opBashOutput(input, opts);
    case "bash_kill":
      return await opBashKill(input, opts);
    case "grep":
      return await opGrep(input, root, opts);
    case "glob":
      return opGlob(input, root, opts);
    default:
      throw new HandError(`unknown hand tool ${name}`);
  }
}

/**
 * A command Filament runs itself — a worker's check (HarnessV3-TaskGraph-v2 TG2-D45) — in bash, as the bash hand runs
 * one, with no clock of its own (direction 4): only `signal` ends it before it exits. Never rejects: its exit (null
 * where it had none — a stop, a shell that could not start), the end of what it printed, and whether a stop ended it.
 * @param {string} command @param {{ root: string, signal?: AbortSignal | null, redact?: ((text: string) => string) | null }} o
 * @returns {Promise<{ exit: number | null, output: string, stopped: boolean }>}
 */
export async function runOwnCommand(command, { root, signal = null, redact = null }) {
  try {
    return await runCommand(SHELL, { command }, root, { signal, redact, untimed: true, bare: true });
  } catch (/** @type {any} */ e) {
    return { exit: null, output: String(e?.message || e), stopped: false };
  }
}
