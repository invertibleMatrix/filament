// @ts-check
// A harness session's coding agent answered by the session's permission switch (HarnessV3-ACP AC3-2, AC-D13). What the
// agent asks to do comes here as the loop's calls — the bridges read each request so: a command is `bash` (a
// PowerShell script `powershell`), a change `edit`, a fetch `web_fetch`, anything else an MCP call, read-only where its
// agent says it only reads (`kindOf`) as the loop's is where its server vouches for it — and is judged as the
// loop judges its own: the session's rules first, then the gate under the mode the switch is at now, with the
// project's learned permissions. The person's yes is judged again (a deny rule, or read-only, come since overrules it)
// and counts towards the project's always-allow, which lives in Filament, never in the agent: a fresh session of it
// keeps it.
// A worker in its own git worktree is held to it (`confine`): Filament reads its change from there, so a file changed
// anywhere else — the developer's folder, by a full path — would land past the apply. Such a request is refused before any rule or mode is asked, and so is a command that reaches the
// developer's folder outside the worktree, by its path or by climbing out of the worktree with `..`: refused the edit,
// an agent writes the same file with its shell (found by HarnessV3-TaskGraph-v2 V2-0b's drives, §12.18, TG2-D38). A
// climb is read in the command's own words, from the folder of the worktree a `cd` of it moved to, not in a heredoc's or
// a here-string's text or a program's inline source (`ownWords`); and a file of the worker's own in the system's temp
// folder is in no project, and passes (`scratchOf`, all 11-09's). Only
// a command the switch's own reader passes as reading — one that merely says the path — goes on to be judged; a read
// of a file there it does not pass. A read or a search of the developer's folder outside the worktree is refused too
// (TG2-D39): the same file is in the worktree, with the worker's own changes, and the developer's copy has neither. So
// is an MCP tool's call that names a place there by a path: nobody but its server knows whether it reads or writes.
// One whose string, read as a relative path from where the call runs, would name a place there asks (`unsureOf`):
// whether it names a place at all only its server knows.
// The dependency folders a copy links in from the developer's folder (`node_modules`, a virtualenv) are the copy's own
// by their other name: Node prints a linked module by its real path, in the developer's folder, and a command that names
// it reaches nothing the copy does not (HarnessV4_AgentTools_Plan AT-D8, the Designer run of 10-23).
// What was refused is told (`onStray`), so the turn can say to the worker where its work goes: the agent itself hears
// only a no. The same fence (`strayOf`) holds a worker on Filament's own loop in its worktree, in every mode (loop.js
// `fence`): under Auto its hands are not fenced, and its change would land past its lead's apply (TG2-D55's drive).
// A team's lead answers to the switch as any agent does (HarnessV4_Tasks decision 9): it was held at read-only, since
// its workers do the work, and it has hands of its own now.
// A worker in its own worktree runs the commands its brief grants without anyone's answer (`grants`,
// HarnessV3-TaskGraph-v2 TG2-D44): the switch's own ask turns into a run, after the fence and the rules have spoken.
// A worker whose lead reviews its plan (`held`, TG2-D50) has its changes and commands refused until its lead's go —
// after the fence, ahead of the rules, the mode and its grants — and its reads run; what was refused is told
// (`onHeld`), as the agent hears only a no.
// A routine's run calls the connections' tools the person switched it on with without asking (`acts`,
// HarnessV4_SpacesPlugins_Plan A2c), as the loop's own does: the gate's ask or read-only refusal turns into a run, and
// the rules still judge it after.
// The chat's own seat — its agent, or a team's lead in charge of it — runs the commands the chat keeps always allowed
// (`alwaysRun`, d-allow, agent/chat-always.js) as a worker runs its brief's grants: the gate's own ask turns into a run,
// read at each request, and an ask for a command the project offers no always-allow for carries what a press of
// "Always allow in this chat" would keep (`keeps`).
import { isMcpTool } from "../adapters/tools/mcp-client.js";
import { gate, ruled, shownCommand, shownChange, commandReason, changesOrRuns, CHANGE_SHOWN, FOREGROUND_SHELLS, permissionQuestion, argSummary } from "./agent/tools.js";
import { BROWSER, browserGate } from "./agent/browser-tool.js";
import { asksFirst, ruleFor, describeRule } from "./agent/rules.js";
import { grantFor, grantedBy } from "./agent/grants.js";
import { alwaysWords, keepsFor, keptFor } from "./agent/chat-always.js";
import { readOnlyCommand } from "../adapters/tools/read-only-commands.js";
import { readOnlyPowerShell } from "../adapters/tools/read-only-powershell.js";
import { SHELL } from "../adapters/tools/shell.js";
import { isCommandHand, safeEnv } from "../adapters/tools/hands.js";
import { keptFolders, keptWords, resolvedPath, resolveInside, sharePath } from "../adapters/tools/fs-fence.js";
import { DEPENDENCY_DIRS } from "../adapters/git/worktree.js";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, hostname, networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { permissionShape } from "../services/memory/permissions.js";

/**
 * @typedef {import("../adapters/agents/turn-bridge.js").LoopCall} LoopCall
 * @typedef {import("../adapters/agents/turn-bridge.js").Judgement} Judgement
 * @typedef {import("../adapters/agents/turn-bridge.js").Permits} Permits
 * @typedef {{ allowed: (name: string, input: any) => boolean, recordAllow: (name: string, input: any) => any,
 *   offered: (name: string, input: any) => any }} Learned  the project's learned permissions (`projectPermissions`)
 */

/**
 * What the fence refused: a file a request would change outside the worktree (`path`), one it would read or search in
 * the developer's folder (`path` and `read`: `file` for a read, `search` for a search), an MCP tool's call that names a
 * place in the developer's folder (`path` and `tool`, the call's name), or a command that reaches out of it (`command`).
 * @typedef {{ path?: string, read?: "file" | "search", tool?: string, command?: string }} Stray
 */

/**
 * The developer's folders a worker's worktree links in — its dependency folders (worktree.js `linkDependencies`), each a
 * link (a junction on Windows) at the same place in the worktree to the same folder: naming one names the copy's own
 * (AT-D8). Their paths in the developer's folder — or, where the folder is a linked worktree (`git worktree add`) with
 * none of its own there, in its main checkout, whose folder the copy links instead (f3's of 11-10: its reads through
 * that link were refused). A link to anywhere else is none of these.
 * @param {string | null} folder @param {string | null} worktree @returns {string[]}
 */
export function linkedIn(folder, worktree) {
  if (!folder || !worktree) return [];
  /** @type {string[]} */
  const out = [];
  /** The folder's place in its main checkout, read at the first link that is not to the folder's own. @type {string | null | undefined} */
  let main;
  for (const name of DEPENDENCY_DIRS) {
    const link = join(worktree, name);
    try {
      if (!lstatSync(link).isSymbolicLink()) continue;
      const at = realpathSync(link);
      const to = join(folder, name);
      if (existsSync(to)) {
        if (at === realpathSync(to)) out.push(to);
        continue;
      }
      if (main === undefined) main = mainPlaceOf(folder);
      const there = main ? join(main, name) : null;
      if (there && at === realpathSync(there)) out.push(there);
    } catch {}
  }
  return out;
}

/**
 * Where `folder` stands in its repository's main checkout, where that repository is a linked worktree: read from the
 * `.git` file at its top, which names `<main>/.git/worktrees/<id>` — git's own layout, as worktree.js `mainCheckoutOf`
 * reads from git's list. Null for a main checkout (its `.git` a folder), for a repository whose git folder is laid out
 * otherwise (a bare one, `--separate-git-dir`), and outside any repository.
 * @param {string} folder @returns {string | null}
 */
function mainPlaceOf(folder) {
  for (let top = resolve(folder); ; ) {
    const dotGit = join(top, ".git");
    if (existsSync(dotGit)) {
      try {
        if (!lstatSync(dotGit).isFile()) return null;
        const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
        if (!gitdir) return null;
        const entries = dirname(resolve(top, gitdir));
        const common = dirname(entries);
        if (basename(entries) !== "worktrees" || basename(common) !== ".git") return null;
        return join(dirname(common), relative(top, resolve(folder)));
      } catch {
        return null;
      }
    }
    const up = dirname(top);
    if (up === top) return null;
    top = up;
  }
}

/** A path as a command may say it, for comparing: one kind of slash, no case. @param {string} p */
const said = (p) => String(p).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
/**
 * A command with its quotes gone, as a shell joins the words they split: `H:'/filament/x'` and `"..""/x"` name what
 * they name unquoted (the E27 hunt of 10-23). Only for comparing: a quote that hid a space joins two words, which
 * names more, never less.
 * @param {string} command
 */
const unquoted = (command) => String(command).replace(/['"`]/g, "");
/**
 * The short names a shell gives the home folder and the temp folder, as `said` reads them: Git Bash's and a POSIX
 * shell's, PowerShell's and cmd's (Git Bash's /tmp is the temp folder).
 */
const SHORT_NAMES = () => [
  { dir: homedir(), names: ["~", "$home", "${home}", "%userprofile%", "$env:userprofile"] },
  { dir: tmpdir(), names: ["/tmp", "$temp", "${temp}", "$tmp", "${tmp}", "$tmpdir", "${tmpdir}", "%temp%", "%tmp%", "$env:temp", "$env:tmp"] },
];
/**
 * The ways a shell names a folder: as it is, a drive's as Git Bash and WSL say it, and one in the home or the temp
 * folder by that folder's short name (TG2-D55's fourth drive: a worker listed the developer's folder through /tmp).
 * @param {string} p
 */
const saidAs = (p) => {
  const n = said(p);
  const drive = /^([a-z]):\/(.*)$/.exec(n);
  const ways = drive ? [n, `/${drive[1]}/${drive[2]}`, `/mnt/${drive[1]}/${drive[2]}`] : [n];
  for (const { dir, names } of SHORT_NAMES()) {
    const d = said(dir);
    if (d && (n === d || n.startsWith(`${d}/`))) ways.push(...names.map((name) => `${name}${n.slice(d.length)}`));
  }
  return ways;
};
/** Whether `text` says the path `p` at `i`, and no more of a name after it. @param {string} text @param {number} i @param {string} p */
const saysAt = (text, i, p) => text.startsWith(p, i) && !/[a-z0-9_.~-]/.test(text[i + p.length] ?? "");
/** A folder Windows names, by a drive or a share: where a path's names lose the dots that end them. */
const WINDOWS_PATH = /^(?:[a-z]:|\\\\)/i;
/**
 * A path, or a command's words, with the dots that end a name dropped, as Windows drops them: `C:\proj.\x` and
 * `C:\proj...\x` are `C:\proj\x` to a shell (the bug hunt of 10-30, PERM-4). `..` and a name's inner dots stay.
 * @param {string} p
 */
const undotted = (p) => p.replace(/([^\\/.\s])\.+(?=[\\/]|\s|$)/g, "$1");
/** A short (8.3) name Windows keeps beside a long one (`PROGRA~1`): a `~` and a digit. */
const SHORT_NAME = /~\d/;
/**
 * Where a path with a short name in it leads by the long names: the deepest folder on its way that is there, read on
 * the disk, and the rest after it as said. The path as it is where nothing on its way is there, elsewhere than
 * Windows, and on a share, whose look would go out to its host (`sharePath`). @param {string} p  absolute
 */
const longNamed = (p) => {
  if (process.platform !== "win32" || !SHORT_NAME.test(p) || sharePath(p)) return p;
  /** @type {string[]} */
  const rest = [];
  for (let at = p; ; ) {
    if (existsSync(at)) {
      try {
        return join(realpathSync.native(at), ...rest);
      } catch {
        return p;
      }
    }
    const up = dirname(at);
    if (up === at) return p;
    rest.unshift(basename(at));
    at = up;
  }
};
/** What splits a command's words where a path may stand: spaces, a shell's operators, an option's `=`. */
const WORD_BREAK = /[\s;|&<>(),=]+/;
/**
 * Whether a command names the developer's folder anywhere but inside the worker's worktree, which lies in it: by its
 * path in any of the ways a shell says one, the dots Windows drops from a name's end dropped, and by a short name of a
 * folder on its way, read on the disk. A folder whose name only begins the same is another folder, and so is a
 * worktree's, and so is a folder the worktree links in (`linkedIn`). What climbs out with `..` is `climbsOut`'s. With
 * no worktree, whether it names the folder at all — a brief's grant, read at its launch, before the worktree exists
 * (HarnessV3-TaskGraph-v2 TG2-D44).
 * @param {string} command @param {string} folder @param {string | null} worktree
 * @param {readonly string[]} [shared]  the folders the worktree links in, `linkedIn`'s
 */
export function namesOutside(command, folder, worktree, shared = linkedIn(folder, worktree)) {
  const plain = unquoted(command);
  const text = said(WINDOWS_PATH.test(folder) ? undotted(plain) : plain);
  const inside = worktree ? [...saidAs(worktree), ...shared.flatMap(saidAs)] : [];
  for (const f of saidAs(folder)) {
    for (let i = text.indexOf(f); i >= 0; i = text.indexOf(f, i + 1)) {
      if (saysAt(text, i, f) && !inside.some((w) => saysAt(text, i, w))) return true;
    }
  }
  const drives = /^[a-z]:/i.test(folder);
  for (const word of plain.split(WORD_BREAK)) {
    const p = asWindows(word, drives);
    if (!SHORT_NAME.test(p) || !isAbsolute(p)) continue;
    // Another drive's short name leads to no folder on this one, and its look could wait on a mapped drive gone away.
    if (drives && /^[a-z]:/i.test(p) && p[0].toLowerCase() !== folder[0].toLowerCase()) continue;
    const at = leadsTo(p, folder, folder);
    if (within(folder, at) && !(worktree && within(worktree, at)) && !shared.some((s) => within(s, at))) return true;
  }
  return false;
}

/** Whether `p` is `dir` or lies in it. @param {string} dir @param {string} p */
const within = (dir, p) => {
  const rel = relative(dir, p);
  return rel === "" || (rel.split(/[\\/]/)[0] !== ".." && !isAbsolute(rel));
};
/** A path as Git Bash or WSL says a drive's, as Windows says it, where the folder has a drive. @param {string} p @param {boolean} drives */
const asWindows = (p, drives) => {
  const m = drives ? /^\/(?:mnt\/)?([a-z])(\/.*)?$/i.exec(p) : null;
  return m ? `${m[1]}:${m[2] || "/"}` : p;
};
/** A path's `..`, as a segment of it (`a..b` and `...` are none). */
const CLIMB = /(^|[\\/])\.\.([\\/]|$)/;
/**
 * The interpreters that run a program's source handed to them as text, and the option an inline one follows: node's
 * `-e`, python's `-c`, perl's and ruby's `-e` among their letters (`-ne`), php's `-r`, `deno eval`.
 */
const SOURCE_FLAGS = [
  { program: /^(?:node|nodejs|bun|tsx|ts-node)$/, flag: /^(?:-e|--eval|-p|--print|-pe)$/ },
  { program: /^(?:python[\d.]*|pypy[\d.]*|py)$/, flag: /^-c$/ },
  { program: /^(?:perl|ruby)$/, flag: /^-[a-z]*e$/i },
  { program: /^php$/, flag: /^-r$/ },
  { program: /^deno$/, flag: /^eval$/ },
];
/** The programs that put a heredoc's body out as it is, a file's text by `>` or tee's own. */
const TEXT_OUT = /^(?:cat|tee)$/;
/** PowerShell's, for a here-string: as their value, or from the pipe. */
const HERE_OUT = /^(?:set-content|add-content|out-file|tee-object|new-item|tee|sc|ac)$/;
/** The options of PowerShell's writers a here-string follows as their value, and those that name the file before it. */
const VALUE_OPTION = /^-(?:value|inputobject)$/i;
const PATH_OPTION = /^-(?:path|literalpath|filepath)$/i;
/** A `cd`, bash's and PowerShell's; the two that leave a folder to go back to, and the two that go back. */
const CD = /^(?:cd|chdir|pushd|set-location|sl|push-location)$/;
const PUSHD = /^(?:pushd|push-location)$/;
const POPD = /^(?:popd|pop-location)$/;
/** How many `cd`s of one command are looked for on the disk; past them, its words are read from where it runs. */
const CD_LOOKS = 32;
/** @typedef {{ text: string, start: number, end: number, here?: string }} Said  a word as a program receives it, where it stands, and the quote of the PowerShell here-string it is (`@'…'@`) */
/**
 * @typedef {{ args: Said[], piped: boolean, fed: boolean, end: string, redirected: boolean, next: Simple | null }} Simple
 *   one command's words, past its redirections; whether a pipe takes its output on (to `next`) or brought it its input
 *   (`fed`); the operator that ended it; whether `>` sends its output to a file
 */
/** A simple command's program, by its file's name, and where it stands among its words. @param {Said[]} args */
const programOf = (args) => {
  let k = 0;
  while (k < args.length && /^[a-z_]\w*=/i.test(args[k].text)) k++;
  const name = (args[k]?.text.split(/[\\/]/).pop() || "").toLowerCase().replace(/\.exe$/, "");
  return { name, k, source: SOURCE_FLAGS.find((s) => s.program.test(name)) || null };
};
/** The word of a simple command that is an interpreter's inline source (`node -e "…"`), or null. @param {Said[]} args */
const inlineSource = (args) => {
  const { k, source } = programOf(args);
  if (!source) return null;
  for (let a = k + 1; a < args.length; a++) {
    const w = args[a].text;
    if (source.flag.test(w)) return args[a + 1] || null;
    if (source.flag.test(w.split("=")[0])) return args[a];
    if (!w.startsWith("-")) return null;
  }
  return null;
};
/**
 * Whether a heredoc's body, or what a pipe brings a command, is text it puts out to a file or the screen (`cat`, `tee`;
 * `out`, PowerShell's writers for a here-string), or the program an interpreter reads from its input (`node`,
 * `python -`): neither when a pipe takes it on. @param {Simple} cmd @param {RegExp} [out]
 */
const takesText = (cmd, out = TEXT_OUT) => {
  if (cmd.piped) return false;
  const { name, k, source } = programOf(cmd.args);
  return out.test(name) || (!!source && cmd.args.slice(k + 1).every((a) => a.text.startsWith("-")));
};
/**
 * Whether a PowerShell here-string is text written to a file or read as a program: a writer's value, by its option or
 * after the file it names, where no pipe takes the writer's output on (`Set-Content x.js -Value` and the string); or its
 * command's whole value, sent to a file by `>` or by a pipe to a writer or an interpreter (`@'…'@ | Set-Content x.js`).
 * Anywhere else — a variable's value, a shell's or `Invoke-Expression`'s — it is the command's.
 * @param {Said} w @param {Simple} cmd
 */
const hereTakesText = (w, cmd) => {
  const { name, k } = programOf(cmd.args);
  const at = cmd.args.indexOf(w);
  if (at === k) return cmd.piped ? !!cmd.next && takesText(cmd.next, HERE_OUT) : cmd.redirected;
  const prev = cmd.args[at - 1]?.text ?? "";
  return !cmd.piped && HERE_OUT.test(name) && at > k + 1 && (VALUE_OPTION.test(prev) || (!prev.startsWith("-") && (at - 2 === k || PATH_OPTION.test(cmd.args[at - 2].text))));
};
/**
 * Whether a word runs nothing as its shell reads it: single-quoted whole, a here-string PowerShell takes as it is
 * (`@'…'@`), or one with no substitution in it — a `$(…)` or a backtick runs a command, and its paths are the command's.
 * @param {Said} w @param {string} raw  the word as the command says it
 */
const inert = (w, raw) => (w.here ? w.here === "'" || !raw.includes("$(") : /^'[^']*'$/.test(raw) || !/\$\(|`/.test(raw));
/**
 * A command's own words, each stretch of it with the folder its relative paths are read from (three builders' false
 * refusals of 11-09). Cut out, as no path of the command's own: the body of a heredoc `cat` or `tee` writes out or an
 * interpreter reads as its program (`takesText`), a PowerShell here-string written to a file or read as a program
 * (`hereTakesText`), and the source an interpreter is handed inline (`node -e`, `python -c`). A path there is the
 * text's, or the program's own, read from wherever it runs — an import from the file it is written to. One whose
 * expansion runs a command (`inert`), one a shell runs, one a pipe, a substitution or a variable takes on, one a command
 * or a script reads as its input, and one that never ends stay the command's words, and so does a shell's own inline
 * source (`bash -c`): their paths are its. Read as bash quotes and splits: a `<<` inside quotes opens nothing.
 * Its words are read from `from`, the folder it runs in; past a `cd` its own shell runs — no pipe's, the background's,
 * nor a subshell's past its end — to a folder of the worktree that is there (`cdTo`), from that folder; past any other
 * (out of the worktree, by a variable, `cd -`, to no folder), from `from` again.
 * @param {string} command @param {{ from: string, worktree: string, folder: string }} at
 * @returns {{ text: string, from: string }[]}
 */
const ownWords = (command, { from, worktree, folder }) => {
  const s = String(command);
  const drives = /^[a-z]:/i.test(folder);
  /** @type {[number, number][]} */
  const cuts = [];
  // Where the words are read from, from each place in the command on; the folder a subshell or a substitution opened
  // in, read again past its end; the folders a pushd left.
  /** @type {{ at: number, from: string }[]} */
  const moves = [{ at: 0, from }];
  let here = from;
  /** @type {string[]} */
  const scopes = [];
  /** @type {string[]} */
  const pushed = [];
  let looked = 0;
  // The heredocs the line opens, each read from the next line on: its delimiter, whether tabs may lead it, whether it
  // was quoted (its body then expands nothing), its command; and the here-strings, judged once their pipes are read.
  /** @type {{ tag: string, tabs: boolean, quoted: boolean, cmd: Simple, nested: boolean }[]} */
  let open = [];
  /** @type {{ w: Said, cmd: Simple, nested: boolean }[]} */
  const heres = [];
  /** @param {boolean} [fed] @returns {Simple} */
  const simple = (fed = false) => ({ args: [], piped: false, fed, end: "", redirected: false, next: null });
  let cmd = simple();
  /** @type {{ text: string, start: number, here?: string } | null} */
  let word = null;
  /** @type {string | null} */
  let quote = null;
  // The parentheses and backticks open: a heredoc inside one is a substitution's or a subshell's, whose text goes on.
  let depth = 0;
  let tick = false;
  // The next word is a redirection's target, no word of its command.
  let target = false;
  /**
   * The folder a `cd`'s words name, where it is one of the worktree's that is there, read as a climb is from where the
   * command is now; null for a variable, a home, a glob, `-`, none or two. @param {Said[]} args
   */
  const cdTo = (args) => {
    /** @type {string[]} */
    const named = [];
    let options = true;
    for (const a of args) {
      const t = unquoted(s.slice(a.start, a.end));
      if (options && t === "--") options = false;
      else if (!(options && /^-./.test(t))) named.push(t);
    }
    const [t] = named;
    if (named.length !== 1 || t === "-" || /^~|[$`%*?[]/.test(t)) return null;
    const to = leadsTo(asWindows(t, drives), here, folder);
    try {
      return statSync(resolveInside(worktree, to)).isDirectory() ? to : null;
    } catch {
      return null;
    }
  };
  /** @param {number} at @param {string} to */
  const move = (at, to) => {
    here = to;
    moves.push({ at, from: to });
  };
  /** Where a `cd` or a `popd` leaves the words after it. @param {Simple} c @param {number} at */
  const cd = (c, at) => {
    const { name, k } = programOf(c.args);
    if (POPD.test(name)) return move(at, pushed.pop() ?? from);
    if (!CD.test(name)) return;
    if (PUSHD.test(name)) pushed.push(here);
    move(at, (!c.piped && !c.fed && c.end !== "&" && ++looked <= CD_LOOKS && cdTo(c.args.slice(k + 1))) || from);
  };
  const endWord = (/** @type {number} */ at) => {
    if (word && !target) {
      /** @type {Said} */
      const w = { ...word, end: at };
      cmd.args.push(w);
      if (w.here) heres.push({ w, cmd, nested: depth > 0 || tick });
    }
    if (word) target = false;
    word = null;
  };
  const endCmd = (/** @type {number} */ at, /** @type {string} */ op) => {
    endWord(at);
    target = false;
    cmd.end = op;
    cmd.piped = op === "|";
    const inline = inlineSource(cmd.args);
    if (inline && inert(inline, s.slice(inline.start, inline.end))) cuts.push([inline.start, inline.end]);
    cd(cmd, at);
    const next = simple(cmd.piped);
    if (cmd.piped) cmd.next = next;
    cmd = next;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else if (word) word.text += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\" && /[$`"\\\n]/.test(s[i + 1] ?? "")) {
        if (word) word.text += s[++i];
      } else if (ch === '"') quote = null;
      else if (word) word.text += ch;
      continue;
    }
    if (ch === "\\" && (s[i + 1] === "\n" || s.startsWith("\r\n", i + 1))) {
      endWord(i);
      i += s[i + 1] === "\n" ? 1 : 2;
      continue;
    }
    if (ch === "\\") {
      word ??= { text: "", start: i };
      word.text += s[++i] ?? "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      word ??= { text: "", start: i };
      quote = ch;
      continue;
    }
    if (ch === "\n") {
      endCmd(i, "\n");
      // Each heredoc's body runs to the line that is its delimiter alone; one with none takes the rest, and stays. An
      // unquoted delimiter's body expands its `$(…)` and backticks, which run.
      let at = i + 1;
      for (const h of open) {
        let end = -1;
        let next = at;
        for (let p = at; p < s.length; ) {
          const nl = s.indexOf("\n", p);
          const line = s.slice(p, nl < 0 ? s.length : nl).replace(/\r$/, "");
          if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.tag) {
            end = p;
            next = nl < 0 ? s.length : nl + 1;
            break;
          }
          p = nl < 0 ? s.length : nl + 1;
        }
        if (end < 0) break;
        if (!h.nested && (h.quoted || !/\$\(|`/.test(s.slice(at, end))) && takesText(h.cmd)) cuts.push([at, end]);
        at = next;
      }
      open = [];
      i = at - 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      endWord(i);
      continue;
    }
    if (ch === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      endWord(i);
      let j = i + 2;
      const tabs = s[j] === "-";
      if (tabs) j++;
      while (s[j] === " " || s[j] === "\t") j++;
      let tag = "";
      let quoted = false;
      /** @type {string | null} */
      let q = null;
      for (; j < s.length && s[j] !== "\n"; j++) {
        if (q) {
          if (s[j] === q) q = null;
          else tag += s[j];
        } else if (s[j] === "'" || s[j] === '"') {
          q = s[j];
          quoted = true;
        } else if (s[j] === "\\") {
          tag += s[++j] ?? "";
          quoted = true;
        } else if (/[\s;&|()<>]/.test(s[j])) break;
        else tag += s[j];
      }
      if (tag) open.push({ tag, tabs, quoted, cmd, nested: depth > 0 || tick });
      i = j - 1;
      continue;
    }
    // A PowerShell here-string: `@'` or `@"` ending its line, to the line its closing quote and `@` begin.
    if (ch === "@" && !word && (s[i + 1] === "'" || s[i + 1] === '"')) {
      const head = /[ \t]*\r?\n/y;
      head.lastIndex = i + 2;
      const tail = new RegExp(`\\n[ \\t]*${s[i + 1]}@`, "g");
      tail.lastIndex = head.test(s) ? head.lastIndex - 1 : s.length;
      const m = tail.exec(s);
      if (m) {
        word = { text: s.slice(head.lastIndex, m.index), start: i, here: s[i + 1] };
        i = m.index + m[0].length - 1;
        continue;
      }
    }
    if (ch === "<" || ch === ">" || (ch === "&" && s[i + 1] === ">")) {
      endWord(i);
      if (ch !== "<") cmd.redirected = true;
      while (/[<>&|]/.test(s[i + 1] ?? "")) i++;
      target = true;
      continue;
    }
    if (ch === "|" || ch === "&" || ch === ";") {
      const two = s[i + 1] === ch;
      endCmd(i, two ? ch + ch : ch);
      if (two || (ch === "|" && s[i + 1] === "&")) i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "`") {
      endCmd(i, ch);
      const opens = ch === "(" || (ch === "`" && !tick);
      if (ch === "`") tick = !tick;
      else depth = Math.max(0, depth + (ch === "(" ? 1 : -1));
      if (opens) scopes.push(here);
      else move(i, scopes.pop() ?? from);
      continue;
    }
    word ??= { text: "", start: i };
    word.text += ch;
  }
  endCmd(s.length, "");
  for (const h of heres) if (!h.nested && inert(h.w, s.slice(h.w.start, h.w.end)) && hereTakesText(h.w, h.cmd)) cuts.push([h.w.start, h.w.end]);
  // What is cut turns to spaces, so each stretch keeps its place in the command.
  let masked = "";
  let to = 0;
  for (const [a, b] of cuts.sort((x, y) => x[0] - y[0])) {
    if (b <= to) continue;
    masked += s.slice(to, Math.max(a, to)) + " ".repeat(b - Math.max(a, to));
    to = b;
  }
  masked += s.slice(to);
  return moves.map((m, j) => ({ text: masked.slice(m.at, moves[j + 1]?.at ?? masked.length), from: m.from }));
};
/**
 * Whether a command climbs out of the worker's worktree into the developer's folder by a path with `..` in it
 * (`cd ../../..`, `cat ..\..\..\amounts.js`, a full path into the worktree that climbs back out), each such path read
 * from `root`, the folder the command runs in, as Windows reads it (`leadsTo`). A path that climbs further, past the
 * developer's folder, is not its: a command may name any folder but the developer's — the folders the worktree links
 * in among those it may (`linkedIn`). Only the command's own words are read (`ownWords`): a heredoc's text and a
 * program's inline source name places from where that text lands or that program runs. Past a `cd` into a folder of
 * the worktree, its words are read from there.
 * @param {string} command @param {string} folder @param {string} worktree @param {string} root
 * @param {readonly string[]} [shared]  the folders the worktree links in
 */
export function climbsOut(command, folder, worktree, root, shared = linkedIn(folder, worktree)) {
  const drives = /^[a-z]:/i.test(folder);
  for (const { text, from } of ownWords(command, { from: root || worktree, worktree, folder })) {
    for (const word of unquoted(text).split(WORD_BREAK)) {
      if (!CLIMB.test(word)) continue;
      const at = leadsTo(asWindows(word, drives), from, folder);
      if (within(folder, at) && !within(worktree, at) && !shared.some((s) => within(s, at))) return true;
    }
  }
  return false;
}

/**
 * Where a path a call names leads from `from`, as Windows reads it in a folder Windows names: the dots that end its
 * names dropped (`undotted`) and a short name read as the long one (`longNamed`).
 * @param {string} p @param {string} from @param {string | null} folder  the developer's folder
 */
const leadsTo = (p, from, folder) => longNamed(resolve(from, folder && WINDOWS_PATH.test(folder) ? undotted(p) : p));

/**
 * The places an MCP tool's call names: each string among its arguments, at any depth, that is a path by itself — one
 * line, absolute, in the home (`~/`) or climbing with `..`. The folder said in a sentence is the call's words, not a
 * place it acts on.
 * @param {unknown} v @param {string[]} [out] @param {number} [depth]
 * @returns {string[]}
 */
const pathsIn = (v, out = [], depth = 0) => {
  if (typeof v === "string") {
    if (v.length <= 4096 && !/[\r\n]/.test(v) && (isAbsolute(v) || /^~[\\/]/.test(v) || CLIMB.test(v))) out.push(v);
  } else if (v && typeof v === "object" && depth < 8) for (const x of Object.values(v)) pathsIn(x, out, depth + 1);
  return out;
};

/**
 * A variable a command names a folder by: cmd's `%NAME%` and `%NAME:…%` (a part of it, or its value changed),
 * PowerShell's `${env:NAME}` and `$env:NAME`, a POSIX shell's `${NAME}` and `$NAME`.
 */
const VARIABLE = /%([a-z_][a-z0-9_]*)(:[^%]*)?%|\$\{env:([a-z_][a-z0-9_]*)\}|\$env:([a-z_][a-z0-9_]*)|\$\{([a-z_][a-z0-9_]*)\}|\$([a-z_][a-z0-9_]*)/gi;
/** The variables a shell keeps of its own, which say nothing of where this process stands: left as said. */
const SHELL_OWN = new Set(["oldpwd", "_"]);
/** The home folder's variables, which a shell sets where this process has none (the desktop app on Windows has no HOME). */
const HOMES = new Set(["home", "userprofile"]);
/**
 * A command with each variable this process knows put in its value — by any case of its name on Windows, by its own
 * elsewhere (`%APPDATA%`, `$HOME`) —, the home folder for `HOME` and `USERPROFILE` where it has neither, and the folder
 * it runs in for the shell's own (`$PWD`, cmd's `%CD%`). A part of one (`%APPDATA:~0,9%`) is its value up to a point not
 * known here (`*`, as `UNSURE` reads it). One it does not know stays as said. @param {string} command @param {string} from
 */
const withVariables = (command, from) => {
  const win = process.platform === "win32";
  const names = new Map(Object.keys(process.env).map((k) => [win ? k.toLowerCase() : k, k]));
  return command.replace(VARIABLE, (m, cmdName, part, ...n) => {
    const name = String(cmdName || n.slice(0, 4).find(Boolean) || "");
    const key = win ? name.toLowerCase() : name;
    /** @returns {string | null} */
    const value = () => {
      if (key === (win ? "pwd" : "PWD") || (win && m.startsWith("%") && key === "cd")) return from;
      if (SHELL_OWN.has(key.toLowerCase())) return null;
      const k = names.get(key);
      if (k) return String(process.env[k]);
      return HOMES.has(key.toLowerCase()) && (win || key === "HOME") ? homedir() : null;
    };
    const v = value();
    return v === null ? m : part ? `${v}*` : v;
  });
};
/**
 * This computer by a name a share's path says it by: `localhost`, a loopback address, its own name (alone or with a
 * domain after it), an address of its own. @param {string} host
 */
const thisHost = (host) => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const me = hostname().toLowerCase();
  if (h === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(h) || h === "::1" || h === "0--1.ipv6-literal.net" || h === me || h.split(".")[0] === me) return true;
  return Object.values(networkInterfaces()).some((list) => (list || []).some((a) => a.address.toLowerCase() === h));
};
/**
 * A path a call names as Windows reads its device and share forms, by its words alone: `\\?\C:\…`, and a drive's own
 * share on this computer (`\\localhost\c$\…`, `\\127.0.0.1\c$`, by this computer's name, `\\?\UNC\…`), as the drive's
 * path; any other as said. @param {string} p
 */
const ownPath = (p) => {
  if (process.platform !== "win32" || !/^[\\/]{2}/.test(p)) return p;
  const s = p.replace(/\//g, "\\").replace(/^\\\\[?.]\\(?=[a-z]:)/i, "").replace(/^\\\\[?.]\\UNC\\/i, "\\\\");
  const share = /^\\\\([^\\]+)\\([a-z])\$(\\.*)?$/i.exec(s);
  return share && thisHost(share[1]) ? `${share[2]}:${share[3] || "\\"}` : s;
};
/**
 * Where a share's path leads, judged with no look (`sharePath`: a look goes out to its host): another share of this
 * computer's, or a device's own name for a disk of it (`\\?\GLOBALROOT\…`, `\\?\Volume{…}\…`), may lead anywhere on it
 * ("anywhere"); another host's share, and a pipe, lead nowhere here (""). @param {string} p  `ownPath`'s
 */
const shareLeads = (p) => {
  const host = /^\\\\([^\\]+)/.exec(p)?.[1] ?? "";
  if (host === "?" || host === ".") return /^\\\\[?.]\\pipe\\/i.test(p) ? "" : "anywhere";
  return thisHost(host) ? "anywhere" : "";
};
/**
 * A path that begins with a shell's `~`, as bash reads it: the home folder; `~+`, the folder it runs in; `~name`, that
 * user's home beside this one's; `~-`, the folder it was in, not known here ("anywhere"). @param {string} p @param {string} from
 */
const tildeOf = (p, from) => {
  const m = /^~([^\\/]*)(?=[\\/]|$)/.exec(p);
  if (!m) return p;
  const rest = p.slice(m[0].length);
  if (m[1] === "") return homedir() + rest;
  if (m[1] === "+") return from + rest;
  if (m[1] === "-") return "anywhere";
  return /^[a-z_][\w.-]*$/i.test(m[1]) ? join(dirname(homedir()), m[1]) + rest : p;
};
/** What runs a command in a word, as a POSIX shell and PowerShell say it: `$(…)`, innermost first, and a backtick's. */
const RUNS_IN = [/\$\([^()]*\)/g, /`[^`]*`/g];
/** A command with what runs in it taken for a name not known here (`$`, as `UNSURE` reads it). @param {string} command */
const ranAway = (command) => {
  let s = command;
  for (let i = 0; i < 16; i++) {
    const t = s.replace(RUNS_IN[0], "$");
    if (t === s) break;
    s = t;
  }
  return s.replace(RUNS_IN[1], "$");
};
/** A `cd` with no folder said, which goes to the home folder in bash and in PowerShell 7. */
const CD_HOME = /(?:^|[;&|(){}\n])\s*(?:cd|chdir|pushd|set-location|sl|push-location)\s*(?=$|[;&|(){}\n])/i;
/**
 * The ways a word may say a path: as said, cmd's `^` taken out on Windows, and an option's value glued to it —
 * PowerShell's `-Path:value`, a short option's (`-C/x`). @param {string} raw
 */
const pathWays = (raw) => {
  const w = process.platform === "win32" ? raw.replace(/\^/g, "") : raw;
  if (!/^-[a-z]/i.test(w) || w.startsWith("--")) return [w];
  const colon = w.indexOf(":");
  return [w, w.slice(2), ...(colon > 0 ? [w.slice(colon + 1)] : [])];
};
/** What a call that names Filament's data folder in another machine's agents' chat is answered (s0d). */
export const FILAMENT_FOLDER_WORDS = "another machine's agents never touch Filament's data folder, which holds its owner key; this call names it or a folder that holds it";
/** The characters past which a path's words say no folder for certain: a wildcard, a brace's list, a variable not known here. */
const UNSURE = /[*?[{$%]/;
/**
 * Filament's own folder a call names (fs-fence.js `keepFromAgents`: its data folder), or "": named itself, a place
 * inside it, or a folder that holds it, from which a search, a copy or an archive reads it whole (`grep -r`, `cd ..`,
 * `Get-ChildItem -Recurse $env:APPDATA`). A command's by any way a shell says a path — as `namesOutside` reads one,
 * through a variable (`%APPDATA%`, `$HOME`, `%APPDATA:~0%`), from the folder it runs in or with `..`, a `~` of bash's, a
 * `cd` to the home folder, an option's value glued to it (`-Path:x`, `-Cx`), where a link or a short name on its way
 * leads, and up to where a wildcard, a name not known here or what runs in the word begins (`~/.config/fil{,}ament`,
 * `$(pwd)`): past which a climb (`..`) leads anywhere —, a file tool's by its paths, an MCP tool's by a path among its
 * arguments. A command's own words alone are read so (`ownWords`): an interpreter's inline source and a heredoc's body
 * are the program's, read for the folder's own name alone (`namesOutside`), so `python -c "print(4 / 2)"` names no root.
 * For another machine's agents' chat without Full control, whose calls never touch it (s0d), in every mode. Its words
 * are read, never run: a program that makes the name itself is the limit the guide says. Another host's share, and a
 * drive none of Filament's folders is on, are judged by their words, with no look that would reach the host or wait on
 * a mapped drive gone away.
 * @param {{ name: string, input?: any }} c @param {string} root  the folder the call runs in
 */
export function filamentFolderNamed(c, root) {
  const folders = keptFolders();
  if (!folders.length) return "";
  /** A path on a drive none of Filament's folders is on, on Windows: judged by its words. @param {string} abs */
  const elsewhere = (abs) => process.platform === "win32" && /^[a-z]:/i.test(abs) && !folders.some((d) => d.slice(0, 2).toLowerCase() === abs.slice(0, 2).toLowerCase());
  /** The folder of Filament's that `at` is in or holds, by its words and where the disk resolves it. @param {string} at */
  const hit = (at) => {
    if (!at) return "";
    if (at === "anywhere") return folders[0];
    const real = sharePath(at) || elsewhere(at) ? at : resolvedPath(at);
    return folders.find((d) => within(d, at) || within(at, d) || within(d, real) || within(real, d)) || "";
  };
  /** Where a path said from `from` lands. @param {string} p @param {string} from */
  const landed = (p, from) => {
    const t = tildeOf(p, from);
    if (t === "anywhere") return t;
    const at = ownPath(t);
    if (sharePath(at)) return shareLeads(at);
    const abs = resolve(from, WINDOWS_PATH.test(root) ? undotted(at) : at);
    return elsewhere(abs) ? abs : longNamed(abs);
  };
  if (isCommandHand(c.name)) {
    const from = typeof c.input?.cwd === "string" && c.input.cwd ? resolve(root, c.input.cwd) : root;
    const there = hit(from);
    if (there) return there;
    const command = withVariables(String(c.input?.command ?? ""), from);
    const named = folders.find((d) => namesOutside(command, d, null, []));
    if (named) return named;
    if (CD_HOME.test(command)) {
      const home = hit(homedir());
      if (home) return home;
    }
    // A drive as Git Bash and WSL say one (`/c/…`): bash's alone, where PowerShell's and cmd's `/c` is a switch.
    const drives = c.name === "bash" && WINDOWS_PATH.test(root);
    for (const text of new Set([command, ranAway(command)])) {
      for (const own of ownWords(text, { from, worktree: from, folder: from })) {
        for (const raw of unquoted(own.text).split(WORD_BREAK)) {
          for (const way of pathWays(raw)) {
            const word = ownPath(asWindows(way, drives));
            if (!/[\\/]/.test(word) && !/^[.~]/.test(word)) continue;
            // A device path's `?` (`\\?\Volume{…}`) is its name's, no wildcard.
            const head = /^\\\\[?.]\\/.test(word) ? 4 : 0;
            const found = word.slice(head).search(UNSURE);
            const unsure = found < 0 ? -1 : found + head;
            if (unsure < 0) {
              const at = hit(landed(word, own.from));
              if (at) return at;
              continue;
            }
            // Past a wildcard or a name not known here, any folder below the base may be meant: the base is judged, as
            // a folder that holds the data folder is; a climb past it leads anywhere.
            if (CLIMB.test(word.slice(unsure))) return folders[0];
            const cut = Math.max(word.lastIndexOf("/", unsure), word.lastIndexOf("\\", unsure));
            const at = hit(landed(cut >= 0 ? word.slice(0, cut + 1) : ".", own.from));
            if (at) return at;
          }
        }
      }
    }
    return "";
  }
  if (isMcpTool(c.name)) {
    for (const p of pathsIn(c.input)) {
      const at = hit(landed(p, root));
      if (at) return at;
    }
    return "";
  }
  const input = c.input ?? {};
  const paths = [input.path, ...(Array.isArray(input.paths) ? input.paths : []), ...pathsIn(input)].filter((p) => typeof p === "string" && p);
  // A search with no path searches the folder it runs in.
  if (!paths.length && (c.name === "grep" || c.name === "glob")) paths.push(".");
  for (const p of paths) {
    const at = hit(landed(p, root));
    if (at) return at;
  }
  return "";
}

/**
 * The strings among an MCP tool's call's arguments, at any depth, that may be a relative path: one line, and none of
 * `pathsIn`'s — not absolute, not in the home, not climbing — nor an address (`://`). Whether one names a place at all,
 * nobody but its server knows.
 * @param {unknown} v @param {string[]} [out] @param {number} [depth]
 * @returns {string[]}
 */
const relativeIn = (v, out = [], depth = 0) => {
  if (typeof v === "string") {
    if (v && v.length <= 4096 && !/[\r\n]/.test(v) && !isAbsolute(v) && !/^~[\\/]/.test(v) && !CLIMB.test(v) && !v.includes("://")) out.push(v);
  } else if (v && typeof v === "object" && depth < 8) for (const x of Object.values(v)) relativeIn(x, out, depth + 1);
  return out;
};

/**
 * A string of an MCP tool's call of a worker held to its worktree that, read as a relative path from the folder the
 * call runs in — as the worker's own tools read theirs (`strayOf`'s `read`) — would name a place in the developer's
 * folder outside the worktree, or null. Run in its worktree, a call's relative path stays in it (its climbs are
 * `strayOf`'s); run elsewhere, whether the string names a place there nobody but its server knows, so the call asks
 * rather than runs (the bug hunt of 10-30, PERM-3).
 * @param {{ name: string, input?: any }} c @param {{ root: string, worktree: string, folder: string | null }} at
 * @returns {string | null}
 */
export function unsureOf(c, { root, worktree, folder }) {
  if (!folder || !isMcpTool(c.name)) return null;
  const shared = linkedIn(folder, worktree);
  return relativeIn(c.input).find((p) => {
    const at = leadsTo(p, root || worktree, folder);
    return within(folder, at) && !within(worktree, at) && !shared.some((s) => within(s, at));
  }) ?? null;
}

/**
 * Where a path the worker named in the developer's folder is in its own worktree: the same path under it, or null
 * where the path is not in the developer's folder.
 * @param {string} path @param {string} worktree @param {string | null} folder
 */
const twinOf = (path, worktree, folder) => {
  const rel = folder && isAbsolute(path) ? relative(folder, path) : "";
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? join(worktree, rel) : null;
};

/**
 * What Filament says to a worker whose request the fence refused: where the same file is in its worktree, or where its
 * command belongs. The agent itself hears only that its call was not allowed.
 * @param {Stray} out @param {string} worktree @param {string | null} folder
 */
export function strayWords(out, worktree, folder) {
  if (out.path && out.tool) {
    const twin = twinOf(out.path, worktree, folder);
    return `Filament refused your call of ${out.tool}: it names ${out.path}, which is the developer's folder, and you work in your own worktree, where your own changes are. ${twin ? `The same path in your worktree is ${twin} — name that one.` : `Name paths inside your worktree, ${worktree}, instead.`}`;
  }
  if (out.path && out.read) {
    const twin = twinOf(out.path, worktree, folder) || worktree;
    return out.read === "file"
      ? `Filament refused your read of ${out.path}: that is the developer's folder, and you work in your own worktree, where your own changes are. The same file is ${twin} — read that one.`
      : `Filament refused your search of ${out.path}: that is the developer's folder, and you work in your own worktree, where your own changes are. Search ${twin} instead.`;
  }
  if (out.path) {
    const twin = twinOf(out.path, worktree, folder);
    return twin
      ? `Filament refused your change to ${out.path}: that is the developer's folder, and you work in your own worktree. The same file is ${twin} — read and change that one. Your work reaches the developer's folder from your worktree, once it is applied.`
      : `Filament refused your change to ${out.path}: it is outside your worktree, ${worktree}. Change files inside your worktree only: your work reaches the developer's folder from there, once it is applied.`;
  }
  return `Filament refused your command: it reaches the developer's folder (${folder}), by its path or by climbing out of your worktree with "..", and you work in your own worktree, ${worktree}, where the same files are at the same paths. Run it there, with paths inside your worktree; a command that reads or writes the developer's folder is refused as a change to it is.`;
}

/**
 * Why the fence refused, in the record's words: a card's, and a note of Filament's own loop.
 * @param {Stray} out @param {string} worktree @param {string | null} folder
 */
export function strayWhy(out, worktree, folder) {
  if (out.path && (out.read || out.tool)) return `${out.path} is the developer's folder, outside the worktree it works in (${worktree}), which holds the same files with its own changes`;
  return out.path
    ? `${out.path} is outside the worktree it works in (${worktree}), and its change is read from there`
    : `its command reaches the developer's folder (${folder}), outside the worktree it works in (${worktree}): its commands run on its worktree's files`;
}

/**
 * What one call would do outside a worker's worktree: a file it would change there, by the fence the loop's own hands
 * keep to (a link out of it among them); a file or folder it would read or search in the developer's folder outside the
 * worktree, or an MCP tool's call that names a place there by a path (`pathsIn`); or a command, the shell's in any
 * form, that reaches the developer's folder outside the worktree — by its path or by `..`, or by running there, in the
 * folder its call names (`cwd`: Codex's, Antigravity's) — and that `readsOnly`, the seat's reader as its shell runs the
 * command, does not pass as reading.
 * A folder the worktree links in is the worktree's (`linkedIn`, AT-D8). Null where it stays inside. One fence for a
 * coding agent's worker (`createAgentPermits`) and a worker on Filament's own loop (loop.js `fence`).
 * @param {{ name: string, input?: any }} c
 * @param {{ root: string, worktree: string, folder: string | null, readsOnly: (command: string, name: string, input: any) => { ok: boolean } | null | undefined }} at
 *   `root`: the folder the call runs in; `worktree`: the worker's; `folder`: the developer's folder it copies
 * @returns {Stray | null}
 */
export function strayOf(c, { root, worktree, folder, readsOnly }) {
  if (isCommandHand(c.name)) {
    const command = String(c.input?.command ?? "");
    if (!folder) return null;
    const shared = linkedIn(folder, worktree);
    const from = typeof c.input?.cwd === "string" && c.input.cwd ? leadsTo(c.input.cwd, root || worktree, folder) : root;
    const there = within(folder, from) && !within(worktree, from) && !shared.some((s) => within(s, from));
    return (there || namesOutside(command, folder, worktree, shared) || climbsOut(command, folder, worktree, from, shared)) && !readsOnly(command, c.name, c.input)?.ok ? { command } : null;
  }
  // Nobody but its server knows what an MCP tool does with a path, so one that names the developer's folder outside the
  // worktree is held as a read of it is, and a command that reaches it (the bug hunt of 10-30, PERM-3).
  if (isMcpTool(c.name)) {
    if (!folder) return null;
    const shared = linkedIn(folder, worktree);
    const named = pathsIn(c.input).find((p) => {
      const at = leadsTo(/^~[\\/]/.test(p) ? join(homedir(), p.slice(2)) : p, root || worktree, folder);
      return within(folder, at) && !within(worktree, at) && !shared.some((s) => within(s, at));
    });
    return named ? { path: named, tool: c.name } : null;
  }
  const path = c.input?.path;
  if (typeof path !== "string" || !path) return null;
  if (c.name === "read" || c.name === "grep" || c.name === "glob") {
    const at = leadsTo(path, root || worktree, folder);
    return folder && within(folder, at) && !within(worktree, at) && !linkedIn(folder, worktree).some((s) => within(s, at)) ? { path, read: c.name === "read" ? "file" : "search" } : null;
  }
  if (c.name !== "write" && c.name !== "edit") return null;
  try {
    resolveInside(worktree, path);
    return null;
  } catch {}
  // A file of the worker's own in the system's temp folder (`scratchOf`) stays out of every project, through no link out.
  const temp = scratchOf(worktree, folder);
  if (temp) {
    try {
      resolveInside(temp, leadsTo(path, worktree, folder));
      return null;
    } catch {}
  }
  return { path };
}

/**
 * The system's temp folder, where a worker keeps a script or a capture of its own (a builder's brief of 11-09 had it
 * copy one there): no project's folder, and nothing of it is read as the worker's change. Only where it lies apart from
 * the developer's folder and the worktree, neither holding the other, by their long names; null where the developer's
 * folder is not known, or a project lives in the temp folder.
 * @param {string} worktree @param {string | null} folder @returns {string | null}
 */
const scratchOf = (worktree, folder) => {
  if (!folder) return null;
  const temp = longNamed(resolve(tmpdir()));
  const apart = (/** @type {string} */ dir) => !within(dir, temp) && !within(temp, dir);
  return apart(longNamed(resolve(folder))) && apart(longNamed(resolve(worktree))) ? temp : null;
};

/** How strict a verdict is: a request that does several things takes its strictest call's. */
const RANK = Object.freeze({ refuse: 0, ask: 1, run: 2 });

/** What a request whose agent offers only to always allow it adds to its question, in the agent's voice. */
export const ALWAYS_ASKED = " I offer only to always allow it: once allowed, I run calls like it without asking again for the rest of this session, whatever the switch says then.";

/**
 * An MCP tool's nature for the gate, as the loop reads it from its server (loop.js `kindOf`): `read` where its agent
 * says the call only reads (`reads`), else a command's. None for any other call.
 * @param {LoopCall} c @returns {"read" | "mutate" | undefined}
 */
const kindOf = (c) => (isMcpTool(c.name) ? (c.reads === true ? "read" : "mutate") : undefined);

/**
 * The session's switch over an agent's requests, for one turn.
 * @param {{ rules: import("./agent/rules.js").Rule[], modeNow: () => import("./agent/prompt.js").PermissionMode,
 *   learned: Learned | null, confine?: string | null, folder?: string | null, onStray?: ((s: Stray) => void) | null,
 *   grants?: import("./agent/grants.js").Grants | null, held?: (() => boolean) | null,
 *   onHeld?: (() => void) | null, reads?: readonly string[], browserAllowed?: ((site: string) => boolean) | null,
 *   browserTeam?: import("./browser/registry.js").TeamOf | null,
 *   look?: { start: (about: import("../core/second-look.js").LookAbout) => import("../core/second-look.js").LookRef, stop: (look: import("../core/second-look.js").LookRef) => void } | null,
 *   acts?: ReadonlySet<string> | null, agentsDevice?: boolean, grantsHold?: (() => boolean) | null,
 *   alwaysRun?: (() => import("./agent/chat-always.js").Kept[]) | null }} o
 *   `rules`: the session's (`rulesFrom`); `modeNow`: the mode in force at each request (`sessionMode`); `learned`: the
 *   project's learned permissions, or null; `confine`: the worktree a worker's changes stay in — null for the
 *   session's own agent, and for a worker that shares the folder; `folder`: the developer's folder that worktree
 *   copies, which a worker's command may not reach nor its reads; `onStray`: told each request the fence refused;
 *   `grants`: what a worker's brief lets it run without anyone's answer, held to `confine` — with
 *   none, nothing is granted; `held`: its changes and commands wait for its lead's review of its plan now (TG2-D50),
 *   asked at each request; `onHeld`: told each request refused for that; `reads`: the folders the chat adds to the
 *   working folder (`loop.addedFolders`), where a command that only reads may read too (HarnessV4_Overnight_Plan
 *   OV-D23); `browserAllowed`: the sites the developer let the chat's agents act on in its browser, which a call of
 *   Filament's `browser` tool is judged by (HarnessV4_AgentTools_Plan AT-D7): looking runs, acting asks once per site in
 *   Edit, as the loop's gate (`browserGate`) — its input the call's, and `page`, the page its agent's tab shows;
 *   `browserTeam`: a team's worker's team, whose lead's yes holds for its workers alone, as its question says;
 *   `look`: a review rule's second look (HarnessV4_Space_Plan S3b), the Reviewer in the chat — none, and the card
 *   says there is none; `acts`: the connections' tools a routine's run calls without asking (A2c, core/routines.js
 *   `routineActs`) — none outside a run; `agentsDevice`: the chat is one another machine's agents started, for whom
 *   Filament's own command line is no read (tools/read-only-commands.js `NOT_THEIRS`); `grantsHold`: whether `grants`
 *   lift an ask now, read at each judgement — in another machine's agents' chat, while their device may run without
 *   asking here (the xd-grants hunt's: a coding agent's worker's grants ran its commands after the switch went off);
 *   `alwaysRun`: the commands the chat keeps always allowed (d-allow), read from its meta at each request
 *   (chat-always.js `keptNow`) — handed to the chat's own seat alone: none for a sub-agent, a worker held to its
 *   worktree or another machine's agents' chat, whose asks have their own roads
 * @returns {Permits}
 */
export function createAgentPermits({ rules, modeNow, learned, confine = null, folder = null, onStray = null, grants = null, held = null, onHeld = null, reads = [], browserAllowed = null, browserTeam = null, look = null, acts = null, agentsDevice = false, grantsHold = null, alwaysRun = null }) {
  /**
   * What a request would do outside the worker's worktree (`strayOf`): its first call's that strays. Null where nothing
   * confines it or it all stays inside.
   * @param {LoopCall[]} calls @param {string} root @param {ReturnType<typeof readsOnly>} reads @returns {Stray | null}
   */
  const stray = (calls, root, reads) => {
    if (!confine) return null;
    for (const c of calls) {
      const out = strayOf(c, { root, worktree: confine, folder, readsOnly: reads });
      if (out) return out;
    }
    return null;
  };
  /** The fence's refusal, in the record's words and the card's; the turn is told. @param {Stray} out @param {string} mode @param {string[]} notes @returns {Judgement} */
  const strayed = (out, mode, notes) => {
    onStray?.(out);
    const how = `refused: ${strayWhy(out, String(confine), folder)}`;
    if (out.path && (out.read || out.tool)) return { verdict: "refuse", mode, notes, how, why: `Filament, as ${out.path} is the developer's folder outside the worktree it works in` };
    return out.path
      ? { verdict: "refuse", mode, notes, how, why: `Filament, as ${out.path} is outside the worktree it works in` }
      : { verdict: "refuse", mode, notes, how, why: "Filament, as its command reaches the developer's folder outside the worktree it works in" };
  };
  /**
   * Where a coding agent's read or search in another machine's agents' chat without Full control lands past what that
   * chat reads, in words; "" where it stays in: its folder and the folders added to it (`reads`), as the loop's own hands
   * keep to them (fs-fence.js `resolveInside`), never a repository's own `.git` or a credentials folder in them, by the
   * path's names or where the filesystem resolves it (`keptFromAgents`). The gate runs every read, and an agent's own
   * Read asks only past its folder (the swarm's review of 11-10: Claude Code read `~/.ssh` there). A glob's pattern is
   * read up to its first wildcard, from a root or from the folder it searches: `../**` climbs out of it as a path does.
   * @param {LoopCall} c @param {string} root
   */
  const readPast = (c, root) => {
    if (c.name !== "read" && c.name !== "grep" && c.name !== "glob") return "";
    const path = typeof c.input?.path === "string" ? c.input.path : "";
    const fixed = c.name === "glob" ? String(c.input?.pattern ?? "").split(/[*?[{]/)[0] : "";
    for (const p of [path, fixed && (isAbsolute(fixed) ? fixed : join(path || ".", fixed))].filter(Boolean)) {
      try {
        resolveInside(root, p, { fenced: true, reads, theirs: true });
      } catch (/** @type {any} */ e) {
        return e?.kept ? `${p} is in ${keptWords(e.kept)}` : `${p} is outside the folder this chat of another machine's agents works in`;
      }
    }
    return "";
  };
  /** The mode the newest request was judged under; the turn began under the one in force at its start. */
  let seen = modeNow();
  /**
   * The gate's verdict on one call before the rules: the browser's own for Filament's browser tool (AT-D7), every other's
   * from `gate`. @param {import("./agent/prompt.js").PermissionMode} mode @param {LoopCall} c @param {string} root
   * @param {ReturnType<typeof readsOnly>} reads
   */
  const gateOf = (mode, c, root, reads) => {
    if (c.name === BROWSER) return browserGate(mode, c.input, { page: String(c.input?.page || ""), allowed: (site) => !!browserAllowed?.(site), team: browserTeam });
    const g = gate(mode, c.name, c.input, learned ? learned.allowed : null, kindOf(c), reads, root);
    // A routine's run acts through the connections' tools the person switched it on with, read-only or not
    // (HarnessV4_SpacesPlugins_Plan A2c), as the loop's own does: the rules still judge it after.
    return g.verdict !== "run" && isMcpTool(c.name) && acts?.has(c.name) ? { verdict: /** @type {const} */ ("run") } : g;
  };
  /**
   * Whether a command only reads: a bash one read as the loop's bash hand would run it, in the folder its call names
   * (`cwd`: Antigravity's own, off Windows), else in the agent's folder; a PowerShell script by PowerShell's reader
   * (HarnessV4_Tasks C10), run by the program and in the folder its call names (`program`, `cwd`: Codex's own), else by
   * the agent's own PowerShell in the agent's folder.
   * @param {string} root
   */
  const readsOnly = (root) => (/** @type {string} */ command, /** @type {string} */ name, /** @type {any} */ input) =>
    name === "powershell"
      ? readOnlyPowerShell(command, { root, cwd: typeof input?.cwd === "string" ? input.cwd : null, program: typeof input?.program === "string" ? input.program : null, env: safeEnv(), reads, agentsDevice })
      : readOnlyCommand(command, { root, shell: SHELL, env: safeEnv(), reads, agentsDevice, cwd: typeof input?.cwd === "string" ? input.cwd : null });
  /**
   * `readsOnly` for one judgement of a request, each command read once: its fence, its gate, a review rule and its
   * grants each ask it of the same command, and a reading looks at the disk (each path it names, PowerShell's folders
   * walked). A command is read in the folder its call names, and a PowerShell script by the program it names, so those
   * are of its key.
   * @param {string} root
   */
  const readsOnce = (root) => {
    const read = readsOnly(root);
    /** @type {Map<string, ReturnType<typeof read>>} */
    const seen = new Map();
    return (/** @type {string} */ command, /** @type {string} */ name, /** @type {any} */ input) => {
      const key = JSON.stringify([name, command, typeof input?.cwd === "string" ? input.cwd : null, name === "powershell" && typeof input?.program === "string" ? input.program : null]);
      if (!seen.has(key)) seen.set(key, read(command, name, input));
      return /** @type {ReturnType<typeof read>} */ (seen.get(key));
    };
  };
  /**
   * The grants a worker's brief or card gives that cover a command it asks to run in its worktree (TG2-D44, AG-267), or
   * null: only an agent held to its worktree has any, and none covers a command that reaches the developer's folder.
   * @param {LoopCall} c @param {string} root @param {ReturnType<typeof readsOnly>} reads
   */
  const grantOf = (c, root, reads) =>
    grants && confine && (c.name === "bash" || c.name === "powershell") && grantsHold?.() !== false
      ? grantFor(grants, String(c.input?.command ?? ""), c.name, {
          at: { root, shell: SHELL.kind },
          readsOnly: (part) => reads(part, c.name, c.input),
          outside: (command) => !!folder && (namesOutside(command, folder, confine) || climbsOut(command, folder, confine, root)),
        })
      : null;
  /**
   * What the chat keeps always allowed now (d-allow), for its own seat: null for a worker held to its worktree and for
   * another machine's agents' chat, whatever they were handed.
   */
  const chatKept = () => (alwaysRun && !confine && !agentsDevice ? alwaysRun() : null);
  /**
   * The kept commands that cover a command the chat's own seat asks to run (chat-always.js `keptFor`), or null: none
   * for a call that is no command, nor for a button's press, which is no command of the agent's.
   * @param {LoopCall} c @param {string} root @param {ReturnType<typeof readsOnly>} reads
   */
  const keptOf = (c, root, reads) => {
    const kept = isCommandHand(c.name) && !c.input?.press ? chatKept() : null;
    return kept?.length
      ? keptFor(kept, String(c.input?.command ?? ""), c.name, { at: { root, shell: SHELL.kind }, readsOnly: (part) => reads(part, c.name, c.input), cwd: typeof c.input?.cwd === "string" ? c.input.cwd : null })
      : null;
  };
  /** The mode in force now, and the record's line when the switch moved since the last request. @param {string[]} notes */
  const modeHere = (notes) => {
    const m = modeNow();
    if (m !== seen) notes.push(`the permission mode is ${m} now (it was ${seen})`);
    seen = m;
    return m;
  };
  return {
    mode: modeNow,
    judge(calls, root, { always = false } = {}) {
      /** @type {string[]} */
      const notes = [];
      const mode = modeHere(notes);
      const reads = readsOnce(root);
      const out = stray(calls, root, reads);
      if (out) return strayed(out, mode, notes);
      // Nor does it touch Filament's data folder, in any mode (s0d): its owner key makes a reader this computer's owner.
      if (agentsDevice && calls.some((c) => filamentFolderNamed(c, root))) return { verdict: "refuse", mode, notes, how: `refused: ${FILAMENT_FOLDER_WORDS}`, why: `Filament, as ${FILAMENT_FOLDER_WORDS}` };
      // Another machine's agents' chat without Full control reads where its folder lets it, but under Auto, which runs
      // their work as the person's own once their device may run without asking (`readPast`).
      const past = agentsDevice && mode !== "auto" ? calls.map((c) => readPast(c, root)).find(Boolean) : "";
      if (past) return { verdict: "refuse", mode, notes, how: `refused: ${past}`, why: `Filament, as ${past}` };
      // A Space's button or an app's tool runs in the project's folder, never the worktree its command reads as inside
      // (found by the review of 11-05): a worker held to its worktree presses none, as the loop's own fence refuses it.
      if (confine && calls.some((c) => c.input?.press)) {
        return { verdict: "refuse", mode, notes, how: "refused: a Space's button or an app's tool runs in the project's folder, outside the worktree it works in", why: "Filament, as a Space's button or an app's tool runs in the developer's folder, outside the worktree it works in" };
      }
      if (held?.() && calls.some((c) => changesOrRuns(c.name, kindOf(c), c.input) || c.input?.press)) {
        onHeld?.();
        return { verdict: "refuse", mode, notes, how: "refused: its plan waits for its lead's review (plan_review)", why: "Filament, as its plan waits for its lead's review" };
      }
      const here = { root, shell: SHELL.kind };
      const all = calls.map((c) => {
        const hit = ruleFor(rules, c.name, c.input, here);
        // A review rule leaves a command that only reads to the gate (SG-D13).
        const v = ruled(gateOf(mode, c, root, reads), hit, c.name, c.input, root, isCommandHand(c.name) ? (cmd) => !!reads(cmd, c.name, c.input)?.ok : null);
        // An ask runs where the worker's brief grants the command — never one an ask or a review rule speaks for, nor a
        // link the guard asks about (agent/link-guard.js) — and, for the chat's own seat, where the chat keeps the
        // command always allowed (d-allow): lifted exactly where a grant lifts.
        const lifts = v.verdict === "ask" && !("links" in v && v.links) && !asksFirst(hit);
        const granted = lifts ? grantOf(c, root, reads) : null;
        const kept = lifts && !granted ? keptOf(c, root, reads) : null;
        /** @type {typeof v} */
        const ran = granted ? { verdict: "run", grant: granted, ...(v.note ? { note: v.note } : {}) } : kept ? { verdict: "run", kept, ...(v.note ? { note: v.note } : {}) } : v;
        if (ran.note) notes.push(ran.note);
        // A string of an MCP call that may name a place in the developer's folder, read from where the call runs, asks.
        const unsure = ran.verdict === "run" && confine ? unsureOf(c, { root, worktree: confine, folder }) : null;
        if (!unsure) return { c, g: ran, hit };
        notes.push(`${c.name} names "${unsure}", which read from ${root} is in the developer's folder (${folder}), outside the worktree it works in: whether it is a place there only its server knows, so it asks`);
        /** @type {typeof v} */
        const g = { verdict: "ask", question: `May I call ${c.name}? It names "${unsure}", which read from the folder it runs in (${root}) is in the developer's folder, outside the worktree this agent works in — answer /allow to run it, or say what to do instead.` };
        return { c, g, hit };
      });
      // The strictest speaks for them all: one refused refuses the request, one that asks asks.
      const worst = all.reduce((a, b) => (RANK[b.g.verdict] < RANK[a.g.verdict] ? b : a));
      // Of the calls that ask, a review rule's speaks for the request: it asks with a second look first.
      const { c, g, hit } = worst.g.verdict === "ask" ? all.find((x) => x.g.verdict === "ask" && x.g.review) || worst : worst;
      const named = (/** @type {import("./agent/rules.js").Rule} */ r) => `the rule ${describeRule(r)}`;
      if (g.verdict === "refuse") {
        if (g.rule) return { verdict: "refuse", mode, notes, how: `refused by ${named(g.rule)}`, why: named(g.rule) };
        return { verdict: "refuse", mode, notes, how: `refused (${mode} mode)`, why: "this session's read-only mode" };
      }
      // Every file the request changes, as its card shows it (HarnessV3-ACP, AC3's drive D5); past CHANGE_SHOWN's
      // files, how many more it changes.
      const writes = calls.filter((x) => x.name === "write" || x.name === "edit");
      const changes = writes.slice(0, CHANGE_SHOWN.files).flatMap((x) => shownChange(x.name, x.input, root) || []);
      const changesLeft = Math.max(0, writes.length - CHANGE_SHOWN.files);
      const shown = { ...(changes.length ? { changes } : {}), ...(changesLeft ? { changesLeft } : {}) };
      if (g.verdict === "ask") {
        const command = shownCommand(c.name, c.input);
        const reason = command ? commandReason(c.name, g.why) : null;
        // A review rule never offers Always allow (SG-D13), nor does an always of the agent's own.
        const review = g.review && g.rule ? describeRule(g.rule) : null;
        const offer = learned && !review && !always ? learned.offered(c.name, c.input) : null;
        // One always-row a card (d-allow): where the project offers none for the call, the chat's own — what a press
        // would keep of the command. The card shows one call's command, so only a request whose one call asks has it.
        const mine = !offer && !always ? chatKept() : null;
        const keeps = mine && all.filter((x) => x.g.verdict === "ask").length === 1 ? keepsFor(c, g, hit, { kept: mine, shown: command, at: here, readsOnly: (part) => reads(part, c.name, c.input) }) : null;
        return {
          verdict: "ask",
          mode,
          notes,
          how: g.rule ? `asked: ${named(g.rule)} asks ${review ? "with a second look " : ""}first` : `asked (${mode} mode)`,
          tool: c.name,
          question: always ? `${g.question}${ALWAYS_ASKED}` : g.question,
          ...(command ? { command } : {}),
          ...(reason ? { reason } : {}),
          ...(offer ? { offer } : {}),
          ...(keeps ? { keeps } : {}),
          ...(review ? { review } : {}),
          ...shown,
          ...(always ? { always: true } : {}),
        };
      }
      if (always) {
        // What would run once asks where the agent can only be allowed it for good: its "always" stays with the agent,
        // past the switch's later verdicts, so only a yes grants it. The card is the call that acts, else the first.
        const a = all.find((x) => changesOrRuns(x.c.name, kindOf(x.c), x.c.input))?.c || c;
        const command = shownCommand(a.name, a.input);
        const asked = a.input?.press || FOREGROUND_SHELLS.has(a.name) || a.name === "write" || a.name === "edit" ? permissionQuestion(a.name, a.input, null, root) : `May I run ${a.name} (${argSummary(a.name, a.input)})?`;
        return { verdict: "ask", mode, notes, how: `asked: the agent offers only to always allow it, which the switch never grants by itself (${mode} mode)`, tool: a.name, question: `${asked}${ALWAYS_ASKED}`, ...(command ? { command } : {}), ...shown, always: true };
      }
      const ran = all.map((x) => x.g);
      const byRules = [...new Set(ran.flatMap((x) => x.rules || (x.rule ? [x.rule] : [])))];
      const byGrants = [...new Set(ran.flatMap((x) => (x.verdict === "run" && x.grant) || []))];
      const byKept = [...new Set(ran.flatMap((x) => (x.verdict === "run" && x.kept) || []))];
      const how = byRules.length ? `ran on ${byRules.map(named).join(" and ")}`
        : byGrants.length && grants ? `ran on ${grantedBy(grants, byGrants)}`
        : byKept.length ? `ran on ${alwaysWords(byKept)}`
        : ran.some((x) => x.verdict === "run" && x.learned) ? "ran on a learned permission"
        : ran.every((x) => x.verdict === "run" && x.readOnly) ? "ran without asking: it only reads"
        : `ran (${mode} mode)`;
      return { verdict: "run", mode, notes, how };
    },
    // The ask or review rule that speaks for one of the calls, as describeRule says it, or null: a command on another
    // machine asks the person here on it first, whatever the mode (the remote-agents plan's c-tools).
    rulesAsk(calls, root) {
      const here = { root, shell: SHELL.kind };
      for (const c of calls) {
        const hit = ruleFor(rules, c.name, c.input, here);
        if (asksFirst(hit)) return describeRule(/** @type {any} */ (hit).rule);
      }
      return null;
    },
    allowed(calls, root, { by, always } = {}) {
      /** @type {string[]} */
      const notes = [];
      const mode = modeHere(notes);
      const reads = readsOnce(root);
      // The person's yes does not move a worker's change out of its worktree either.
      const out = stray(calls, root, reads);
      if (out) return strayed(out, mode, notes);
      // Nor another machine's agents' call into Filament's data folder (s0d).
      if (agentsDevice && calls.some((c) => filamentFolderNamed(c, root))) return { verdict: "refuse", mode, notes, how: `refused: ${FILAMENT_FOLDER_WORDS}`, why: `Filament, as ${FILAMENT_FOLDER_WORDS}` };
      // A worker's lead's yes (HarnessV3-TaskGraph-v2 TG2-D41) is judged as the person's is, in its own name.
      const who = by === "lead" ? "its lead" : "the person";
      for (const c of calls) {
        const hit = ruleFor(rules, c.name, c.input);
        if (hit?.verdict === "deny")
          return { verdict: "refuse", mode, notes, how: `${who} said yes, but the rule ${describeRule(hit.rule)} refuses it now`, why: `the rule ${describeRule(hit.rule)}` };
        if ((c.name === BROWSER ? gateOf(mode, c, root, reads) : gate(mode, c.name, c.input, null, kindOf(c), reads, root)).verdict === "refuse")
          return { verdict: "refuse", mode, notes, how: `${who} said yes, but this session is read-only now`, why: "this session's read-only mode" };
      }
      // It counts towards nothing: the project's always-allow is learned from the person's yes alone.
      if (by === "lead") return { verdict: "run", mode, notes, how: "ran: its lead allowed it" };
      // Nor a yes to an agent that offered only its always (the bug hunt of 5d57bbe8a): its card offers none of the
      // project's, which could never stop it asking (`judge`'s `always` asks whatever was learned), and the agent keeps
      // the grant itself.
      if (always) return { verdict: "run", mode, notes, how: "ran: the person allowed it, as the agent's always" };
      // Nor a yes to a request a review rule asked for (SG-D13): its card offers no Always allow, so its yes counts towards
      // none — five force-pushes allowed would otherwise offer every `git push`.
      const here = { root, shell: SHELL.kind };
      if (calls.some((c) => ruleFor(rules, c.name, c.input, here)?.verdict === "review")) return { verdict: "run", mode, notes, how: "ran: the person allowed it, with a second look" };
      // One yes counts once for each shape it covers: five edits of .js files in one request are one approval of
      // editing .js files, not five (the bug report's L11).
      const once = new Map();
      for (const c of calls) {
        const s = permissionShape(c.name, c.input);
        if (s && !once.has(s.text)) once.set(s.text, c);
      }
      const offers = (learned ? [...once.values()].map((c) => learned.recordAllow(c.name, c.input)) : [])
        .filter((l) => l?.offered)
        .map((l) => ({ tool: String(l.shape.tool), shape: String(l.shape.shape), text: String(l.shape.text), count: Number(l.count), itemId: l.offered.id }));
      return { verdict: "run", mode, notes, how: "ran: the person allowed it", ...(offers.length ? { offers } : {}) };
    },
    onlyReads(calls, root) {
      const read = readsOnly(root);
      return calls.length > 0 && calls.every((c) => (FOREGROUND_SHELLS.has(c.name) ? !!read(String(c.input?.command ?? ""), c.name, c.input)?.ok : kindOf(c) === "read"));
    },
    look: (about) => (look ? look.start(about) : { error: "this chat runs no agents of Filament's" }),
    unlook: (l) => {
      if (l && "agent" in l) look?.stop(l);
    },
  };
}
