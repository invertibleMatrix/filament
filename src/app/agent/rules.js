// @ts-check
// `loop.rules` (HarnessV2 §5.2): rules judged before the permission gate. A rule names a tool (a hand, an
// mcp__server__tool, or `*`) and a glob over the call's subject — the command for bash, the path for the file hands and
// the language server's asks (a rule on read speaks for those too: they read the file), the pattern for grep and glob, the URL or query for the web hands, the page a browser call works on and the addresses it
// goes to (HarnessV4_Browser_Plan BR-D7), the input as JSON for anything else. `deny` refuses in
// words, `ask` asks even where the mode would run, `allow` runs without asking — but never above read-only, which is the
// developer's choice for the whole session. First match wins per subject, so a deny or an ask meant as an exception
// goes before the broad allow it carves out of. `review` (HarnessV4_Space_Plan SG-D13) asks with a second look first —
// the Reviewer's five lines on the card — even where the mode would run, and no allow rule or brief lifts it; it stands
// between deny and ask. `loop.secondLook` adds the shipped review rules (core/second-look.js RISKY) after the session's.
//
// A bash command is judged by its parts: each `&&`, `||`, `;`, `|`, lone `&` and line-break segment is a subject (the
// `&` of a descriptor's copy, `2>&1` or `>&2`, cuts nothing: HarnessV3-Views V6-15), and so is the whole command. A
// deny or an ask that covers any of them covers the call (`rm *` catches `cd x && rm -rf y` and
// `echo hi<newline>rm -rf y`), and sees each as its shell reads it too — its quotes and escapes taken away, the
// variables set before it left out, the command without its folder or .exe, the command a wrapper or a launcher runs,
// past its own options, and the command lines it holds, each read as a command line of its own: what a group, a
// keyword, a substitution or a process substitution runs, and the line a shell is handed as a string
// (`plainSpellings`: `cu'rl' x`, `/usr/bin/curl x`, `sudo -u root timeout 5 curl x`, `( curl x )`,
// `if curl x; then ls; fi`, `echo $(curl x)`, `sh -c 'curl x'` and `start curl x` are all `curl x`); an allow covers
// the call only when it covers every segment as written, and never a
// segment that redirects or substitutes (`>`, `<`, backticks, `$(`), whose effect is more than its words say — those
// fall to the gate. A `cd` into the folder the command already runs in takes it nowhere, so no allow need cover it
// (HarnessV3-TaskGraph G2-14). `privacy.bashDeny` is the same thing said shorter: deny globs on bash, judged ahead of
// the rules. A rule on bash speaks for bash_background and powershell too: a command is a command in every spelling, as
// the gate already judges it, and a second shell must not be a way around a deny (HarnessV3-Tools TL-D5). A PowerShell
// script is cut at the same marks — its `;`, `|`, newlines and pwsh's `&&`/`||`; a lone `&` is its call operator, and
// cutting there leaves the called program as the segment's head.
//
// A confirmed learned permission (WP-L) is mirrored as an `allow` rule with `learned: true` on the project layer, so the
// inspector shows what runs without asking and why. Its bash pattern is the SHAPE the permission was learned under
// (head word plus subcommand — `npm test`) and matches the way the permission does: `npm test -- --grep x` yes,
// `npm testify` and `npm test > out` no. Withdrawing the permission takes the mirror with it.
import { RULE_VERDICTS } from "../../services/session-settings.js";
import { permissionShape } from "../../services/memory/permissions.js";
import { isCommandHand } from "../../adapters/tools/hands.js";
import { BROWSER, ruleUrl, wholeUrl } from "../../core/browser.js";
import { RISKY_RULES } from "../../core/second-look.js";

/**
 * @typedef {{ tool: string, pattern: string, verdict: "allow" | "ask" | "deny" | "review", learned?: boolean, shipped?: boolean }} Rule
 *   `shipped`: one of the review rules `loop.secondLook` stands for (core/second-look.js), not written by anyone
 */
/**
 * What the rules say about one call. `deny`/`ask`/`allow`: the verdict, the rule that gave it (for an allow over a
 * compound command, `rules` lists every rule that covered a segment) and the subject it covered. `gate`: the rules
 * leave the call to the permission gate although an allow rule reaches part of it — `why` says what stopped the allow.
 * @typedef {{ verdict: "deny" | "review" | "ask" | "allow", rule: Rule, index: number, subject: string, rules: Rule[] } | { verdict: "gate", rule: Rule, index: number, subject: string, why: string }} RuleHit
 */

const SEGMENT = /\s*(?:&&|\|\||;|\||(?<![<>])&|[\r\n]+)\s*/;
// A segment no allow rule covers — nor a brief's grant (HarnessV3-TaskGraph-v2 TG2-D44): redirection and substitution
// put more in a command than its words say.
export const UNCOVERABLE = /[<>`]|\$\(/;
export const UNCOVERABLE_WHY = "redirection and substitution are never covered by an allow rule";

/** A command's segments, as the rules judge them: cut at each `&&`, `||`, `;`, `|`, lone `&` and line break. @param {string} command */
export const commandSegments = (command) =>
  String(command)
    .trim()
    .split(SEGMENT)
    .map((s) => s.trim())
    .filter(Boolean);
/** The marks a command is cut at, in order — a line break as "\n". @param {string} command */
export const commandMarks = (command) => [...String(command).trim().matchAll(new RegExp(SEGMENT.source, "g"))].map((m) => m[0].trim() || "\n");

/**
 * Where a command starts: the folder the command hands run in — the turn's working folder — and the bash hand's shell.
 * @typedef {{ root: string, shell: import("../../adapters/tools/shell.js").Shell["kind"] }} CommandPlace
 */

// A folder's letters that no shell reads more into: no variable, glob, escape, quote or operator. Quoted, a space,
// parentheses and backslashes too; plain, backslashes only where the shell reads them as separators (cmd, PowerShell),
// never where a bash reads them as escapes.
const QUOTED_FOLDER = /^[\p{L}\p{N}_.~:\-/\\ ()]+$/u;
const PLAIN_FOLDER = /^[\p{L}\p{N}_.~:\-/\\]+$/u;
const BASH_PLAIN_FOLDER = /^[\p{L}\p{N}_.~:\-/]+$/u;

/**
 * A folder as its spellings compare: forward slashes, a closing one only on a drive's root; Windows' without case.
 * @param {string} p @param {boolean} win
 */
const folderKey = (p, win) => {
  const s = p.replace(/\\/g, "/");
  const t = s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s) ? s.slice(0, -1) : s;
  return win ? t.toLowerCase() : t;
};

/**
 * Whether a segment is a `cd` into the folder the command already runs in, which takes it nowhere (HarnessV3-TaskGraph
 * G2-14: a sub-agent's `cd "<its worktree>" && node --test …` is its `node --test …`, and the rule that allowed that
 * covered no cd). `cd <folder>`, or PowerShell's `Set-Location <folder>`: one folder, quoted or plain, in letters no
 * shell reads more into, written whole (Git Bash's `/c/…` too) or as `.`. A cd that fails leaves the command where it
 * was.
 * @param {string} segment @param {string} name @param {CommandPlace} at
 */
export function staysPut(segment, name, at) {
  const m = /^cd\s+(.+)$/i.exec(segment) || (name === "powershell" ? /^set-location\s+(.+)$/i.exec(segment) : null);
  if (!m) return false;
  const word = m[1];
  const quote = word[0] === '"' || word[0] === "'" ? word[0] : "";
  if (quote && !word.endsWith(quote)) return false;
  const folder = quote ? word.slice(1, -1) : word;
  const escapes = name !== "powershell" && at.shell !== "cmd";
  if (!(quote ? QUOTED_FOLDER : escapes ? BASH_PLAIN_FOLDER : PLAIN_FOLDER).test(folder)) return false;
  if (/^\.[\\/]?$/.test(folder)) return true;
  const win = /^[A-Za-z]:[\\/]/.test(at.root);
  const msys = name !== "powershell" && at.shell === "git-bash" && /^\/[A-Za-z](\/|$)/.test(folder);
  return folderKey(msys ? `${folder[1]}:/${folder.slice(3)}` : folder, win) === folderKey(at.root, win);
}

/** A word that takes a command to another folder, bash's and PowerShell's, where a part begins or a group opens (`( cd x`, `{ cd x`, `! cd x`). */
const MOVES = /(?:^|[\s({!])(?:cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)(?=\s|$)/i;
/**
 * Whether a segment may take the command to another folder: it says a `cd` or one of its like, and is none into the
 * folder it already runs in (`staysPut`). What a chat keeps always allowed is kept for the folder it was asked in
 * (d-allow, chat-always.js): a command that moves is neither kept nor run on what was kept. Read wide on purpose — a
 * word that only looks like one (`git log --grep cd`) makes the command ask, as it did.
 * @param {string} segment @param {string} name @param {CommandPlace} at
 */
export const movesAway = (segment, name, at) => MOVES.test(segment) && !staysPut(segment, name, at);

/**
 * A command as it runs, for a line that shows it (HarnessV3-Views V6-9): without a leading `cd` into the folder it
 * already runs in, which takes it nowhere (`staysPut`) — a worker's `cd "<its worktree>" && node --test …` is its
 * `node --test …`. Only a cd the rest runs after is left out — joined by `&&`, which a cd that stays put passes, by
 * `;` or by a line break. After `||` the rest runs only if the cd fails, so that command stays as it was, as any
 * other does.
 * @param {string} command @param {string} name @param {CommandPlace} at
 */
export function asItRuns(command, name, at) {
  const cut = SEGMENT.exec(command);
  if (!cut) return command;
  const mark = cut[0].trim();
  return (mark === "&&" || mark === ";" || mark === "") && staysPut(command.slice(0, cut.index).trim(), name, at) ? command.slice(cut.index + cut[0].length) : command;
}

/**
 * A glob over one line: `*` any run of characters (spaces included), `?` one character, everything else literal;
 * case-insensitive (Windows paths and shells do not care, and a rule should not hinge on it).
 * @param {string} pattern
 */
export function globToRegExp(pattern) {
  const src = String(pattern)
    .split("*")
    .map((part) => part.split("?").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("."))
    .join(".*");
  return new RegExp(`^${src}$`, "i");
}

/** bash's `$'…'` escapes that stand for one character. */
const ANSI_C = Object.freeze({ n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" });

/**
 * One escape of bash's `$'…'`, at `j` just past its backslash: the text it stands for, and how many characters after the
 * backslash it took. @param {string} s @param {number} j @returns {[string, number]}
 */
function ansiEscape(s, j) {
  const c = s[j];
  if (Object.hasOwn(ANSI_C, c)) return [ANSI_C[/** @type {keyof typeof ANSI_C} */ (c)], 1];
  const code = (/** @type {RegExpExecArray | null} */ m, /** @type {number} */ base, /** @type {number} */ skip) => {
    const n = m ? parseInt(m[0], base) : NaN;
    return m && n <= 0x10ffff ? /** @type {[string, number]} */ ([String.fromCodePoint(base === 8 ? n & 0xff : n), skip + m[0].length]) : null;
  };
  const hex = (/** @type {number} */ max) => code(new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(s.slice(j + 1)), 16, 1);
  const got = c === "x" ? hex(2) : c === "u" ? hex(4) : c === "U" ? hex(8) : code(/^[0-7]{1,3}/.exec(s.slice(j)), 8, 0);
  return got || [`\\${c}`, 1];
}

/**
 * A command's words as its shell reads them: its quotes taken away, its escapes undone, cut at the blanks no quote
 * holds — bash's `'…'`, `"…"`, `$'…'` and `\`; cmd's `"…"` and `^`; PowerShell's `'…'`, `"…"` and backtick.
 * @param {string} command @param {"bash" | "cmd" | "pwsh"} dialect @returns {string[]}
 */
export function shellWords(command, dialect) {
  const s = String(command);
  const esc = dialect === "bash" ? "\\" : dialect === "cmd" ? "^" : "`";
  /** @type {string[]} */
  const words = [];
  let w = "";
  let begun = false;
  /** The quote open: `'`, `"`, or `$` for bash's `$'…'`. */
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c !== "'") w += c;
      else if (dialect === "pwsh" && s[i + 1] === "'") w += s[++i];
      else q = "";
    } else if (q === "$") {
      if (c === "'") q = "";
      else if (c === "\\" && i + 1 < s.length) {
        const [t, n] = ansiEscape(s, i + 1);
        w += t;
        i += n;
      } else w += c;
    } else if (q === '"') {
      if (c === '"') {
        if (dialect === "pwsh" && s[i + 1] === '"') w += s[++i];
        else q = "";
      } else if (dialect === "bash" && c === "\\" && "$`\"\\".includes(s[i + 1] ?? "x")) w += s[++i];
      else if (dialect === "pwsh" && c === "`" && i + 1 < s.length) w += s[++i];
      else w += c;
    } else if (/\s/.test(c)) {
      if (begun) words.push(w);
      w = "";
      begun = false;
    } else {
      begun = true;
      if (c === '"') q = '"';
      else if (c === "'" && dialect !== "cmd") q = "'";
      else if (dialect === "bash" && c === "$" && (s[i + 1] === "'" || s[i + 1] === '"')) q = s[++i] === "'" ? "$" : '"';
      else if (c === esc && i + 1 < s.length) w += s[++i];
      else w += c;
    }
  }
  if (begun) words.push(w);
  return words;
}

/**
 * Start-Process' grammar, for its own name and its alias: PowerShell's parameters, those listed taking a value that is
 * not the command — `-FilePath` and `-File` take the command itself, so neither is listed.
 */
const STARTED = Object.freeze({
  word: /** @type {true} */ (true),
  long: ["verb", "windowstyle", "workingdirectory", "credential", "argumentlist", "redirectstandardoutput", "redirectstandarderror", "redirectstandardinput", "loadusersprofile"],
});

/**
 * The programs that run the command their words name, as a deny, an ask or a review reads past them to it (the bug hunt
 * of 10-30): the grammar of each — the short options that take an argument (`args`: the rest of their word, else the
 * next word), those that take one only joined to them (`joined`: xargs' `-i`, sudo's `-h`), the long options that take
 * one (`long`: after `=`, else the next word), the options that make it run nothing (`none`: `command -v`), the words
 * it takes before its command (`before`: timeout's duration, taskset's mask, chroot's root), whether it sets variables
 * before its command (`sets`: `env X=1 …`, `sudo X=1 …`, bash's `time X=1 …`), whether a lone `-` is one of its
 * options (`dash`: env's), the option whose argument it splits into its own words (`splits`: env's `-S`), whether its
 * options are cmd's (`slash`: start's `/b`, runas' `/user:…`), whether they are PowerShell's parameters, those in
 * `long` taking a value (`word`: `Start-Process -Verb RunAs curl`), and whether it runs its command with the words it
 * reads after them (`appends`: xargs). Each is one Always allow learns no shape for (memory/permissions.js
 * RUNS_A_COMMAND).
 * @type {Readonly<Record<string, { args?: string, joined?: string, long?: readonly string[], none?: string, before?: number, sets?: true, dash?: true, slash?: true, word?: true, splits?: { short: string, long: string }, appends?: true }>>}
 */
export const WRAPPERS = Object.freeze({
  env: { args: "aCSu", long: ["argv0", "chdir", "split-string", "unset"], sets: true, dash: true, splits: { short: "S", long: "split-string" } },
  sudo: { args: "aCcDgpRrTtUu", joined: "h", long: ["auth-type", "close-from", "login-class", "chdir", "group", "host", "prompt", "chroot", "role", "type", "command-timeout", "other-user", "user"], sets: true },
  doas: { args: "Cu" },
  pkexec: { long: ["user"] },
  timeout: { args: "ks", long: ["kill-after", "signal"], before: 1 },
  nice: { args: "n", long: ["adjustment"] },
  nohup: {},
  time: { args: "fo", long: ["format", "output"], sets: true },
  stdbuf: { args: "ioe", long: ["input", "output", "error"] },
  setsid: {},
  unbuffer: {},
  ionice: { args: "cnpPu", long: ["class", "classdata", "pid", "pgid", "uid"] },
  taskset: { before: 1 },
  chrt: { args: "TPD", long: ["sched-runtime", "sched-period", "sched-deadline"], before: 1 },
  chroot: { long: ["userspec", "groups"], before: 1 },
  command: { none: "vV" },
  exec: { args: "a" },
  builtin: {},
  eval: {},
  busybox: {},
  xargs: { args: "adEILnPs", joined: "eil", long: ["arg-file", "delimiter", "max-args", "max-chars", "max-procs", "process-slot-var"], appends: true },
  // the launchers that take their command on the line: cmd's and PowerShell's, and those that run it under something
  start: { args: "dD", slash: true },
  call: {},
  "start-process": STARTED,
  saps: STARTED,
  runas: { slash: true },
  flock: { args: "wE", long: ["timeout", "conflict-exit-code"], before: 1 },
  watch: { args: "n", long: ["interval"] },
  strace: { args: "aebEIoOpPsSuX", long: ["columns", "detach-on", "trace", "env", "interruptible", "output", "overhead", "attach", "path", "string-limit", "signal", "user", "const-print-style"] },
  ltrace: { args: "aelnopsuxF", long: ["align", "config", "library", "output", "filter", "indent"] },
  valgrind: {},
  "systemd-run": { args: "upEM", long: ["unit", "property", "setenv", "machine", "description", "slice", "service-type", "uid", "gid", "nice", "working-directory", "on-calendar"] },
  nsenter: { args: "tSG", long: ["target", "setuid", "setgid"] },
  unshare: { args: "SGR", long: ["setuid", "setgid", "map-user", "map-group", "root", "wd", "propagation"] },
  firejail: {},
  "xvfb-run": { args: "efnpsw", long: ["error-file", "auth-file", "server-num", "xauth-protocol", "server-args", "wait"] },
  parallel: { args: "ajLNPS", long: ["arg-file", "jobs", "max-lines", "max-args", "sshlogin", "results", "joblog", "tmpdir"], appends: true },
});

/** A command's head without its folder or Windows' extension. @param {string} word */
const bareHead = (word) => String(word.split(/[\\/]/).pop()).replace(/\.(exe|cmd|bat|com)$/i, "");

/**
 * The words of the command a wrapper runs (`WRAPPERS`), past the wrapper's options and their arguments, the words it
 * takes first and the variables it sets — or null where the words name no wrapper, or one that runs nothing.
 * `appends`: it runs them with the words it reads after them.
 * @param {string[]} words @returns {{ words: string[], appends: boolean } | null}
 */
function wrapped(words) {
  const program = bareHead(words[0] || "").toLowerCase();
  const w = Object.hasOwn(WRAPPERS, program) ? WRAPPERS[program] : null;
  if (!w) return null;
  const rest = [...words];
  let k = 1;
  while (k < rest.length) {
    const t = rest[k];
    if (t === "--") {
      k++;
      break;
    }
    if (t === "-" && w.dash) {
      k++;
      continue;
    }
    if (!(w.slash ? /^[-/]./ : /^-./).test(t)) break;
    // A long option, or PowerShell's parameter (`word`), whose name it answers to in any case
    if (t.startsWith("--") || (w.word && /^-[A-Za-z][A-Za-z-]/.test(t))) {
      const dashes = t.startsWith("--") ? 2 : 1;
      const eq = t.indexOf("=");
      const option = eq < 0 ? t.slice(dashes) : t.slice(dashes, eq);
      const takes = !!w.long?.includes(w.word ? option.toLowerCase() : option);
      const arg = eq >= 0 ? t.slice(eq + 1) : takes ? rest[k + 1] : undefined;
      const used = eq < 0 && takes ? 2 : 1;
      // env's `--split-string`: its argument's words are read in its place, as env reads them.
      if (w.splits && option === w.splits.long && arg != null) rest.splice(k, used, ...shellWords(arg, "bash"));
      else k += used;
      continue;
    }
    // A run of short options: one that takes an argument takes the rest of the word, or the next word.
    let used = 1;
    let split = false;
    for (let j = 1; j < t.length; j++) {
      const c = t[j];
      if (w.none?.includes(c)) return null;
      if (w.joined?.includes(c)) break;
      if (!w.args?.includes(c)) continue;
      const joined = t.slice(j + 1);
      const arg = joined || rest[k + 1];
      if (!joined) used = 2;
      if (w.splits && c === w.splits.short && arg != null) {
        rest.splice(k, used, ...shellWords(arg, "bash"));
        split = true;
      }
      break;
    }
    if (!split) k += used;
  }
  k += Math.min(w.before || 0, rest.length - k);
  if (w.sets) while (k < rest.length && rest[k].includes("=")) k++;
  return k < rest.length ? { words: rest.slice(k), appends: !!w.appends } : null;
}

/** How deep a command line held inside a command line is read: a group, a substitution, a shell's string. */
const LINES_DEEP = 3;

/** The words that only introduce the command after them, taken off a segment's start to reach the command it runs. */
const INTRODUCES = /^(?:!|if|then|else|elif|do|while|until)\s+/i;

/**
 * The command lines one segment holds, and the segment past the words that only introduce a command: what a group, a
 * subshell, a substitution or a process substitution runs — `( … )`, `{ …; }`, `$( … )`, a backtick pair, `<( … )` and
 * `>( … )`, closed or cut short by the segment's own end — and the keywords and `!` taken off its start
 * (`INTRODUCES`). Single quotes hold nothing; inside double quotes a `$( … )` or a backtick still runs. A backtick is
 * PowerShell's escape, so it opens nothing in a PowerShell hand's command.
 * @param {string} segment @param {string} name  the hand
 * @returns {{ inside: string[], bare: string }}
 */
function insideOf(segment, name) {
  /** @type {string[]} */
  const inside = [];
  /** The spans open, outermost first: what closes each, where its text starts, and the quote open inside it. */
  const spans = [{ close: "", from: 0, q: "" }];
  const ticks = name !== "powershell";
  for (let i = 0; i < segment.length; i++) {
    const at = spans[spans.length - 1];
    const c = segment[i];
    const two = segment.slice(i, i + 2);
    const wide = two === "$(" || two === "<(" || two === ">(";
    const opens = wide ? ")" : c === "`" && ticks ? "`" : at.q ? "" : c === "(" ? ")" : c === "{" && segment[i - 1] !== "$" ? "}" : "";
    if (at.q === "'") {
      if (c === "'") at.q = "";
    } else if (c === "\\" || (c === "`" && !ticks)) i++;
    else if (at.close === c && !at.q) {
      spans.pop();
      if (spans.length === 1) inside.push(segment.slice(at.from, i));
    } else if (opens) {
      spans.push({ close: opens, from: i + (wide ? 2 : 1), q: "" });
      if (wide) i++;
    } else if (c === '"') at.q = at.q === '"' ? "" : '"';
    else if (c === "'" && !at.q) at.q = "'";
  }
  if (spans.length > 1) inside.push(segment.slice(spans[1].from));
  let bare = segment.trim();
  while (INTRODUCES.test(bare)) bare = bare.replace(INTRODUCES, "");
  return { inside, bare };
}

/**
 * The programs handed a command line as a string, and the switch that carries it: a POSIX shell's `-c` (alone or among
 * its letters, `-lc`) and `--command`, the `-c` of su, script and flock, cmd's `/c`, `/k` and `/r` (among its other
 * switches, `/d/c`, and with the line joined to it, `/cdel x`), and PowerShell's `-Command` in every spelling it
 * answers to. `rest`: the line is every word after the switch, the way cmd and PowerShell read it; else the one word
 * the switch takes. The switch is looked for among all the words, as memory/permissions.js `carries` looks for it.
 * @type {readonly { program: RegExp, switch: RegExp, rest?: true }[]}
 */
const HANDED = Object.freeze([
  { program: /^(?:sh|bash|zsh|dash|ksh|ash|fish)$/i, switch: /^(?:-[A-Za-z]*c|--command)$/ },
  { program: /^(?:su|script|flock)$/i, switch: /^(?:-c|--command)$/ },
  { program: /^cmd$/i, switch: /^(?:\/[a-z](?::[a-z]+)?)*\/[ckr](.*)$/i, rest: /** @type {true} */ (true) },
  { program: /^(?:powershell|pwsh)$/i, switch: /^(?:[-–—―]{1,2}|\/)(?:c|co[a-z]*|cwa)$/i, rest: /** @type {true} */ (true) },
]);

/**
 * The command line a program's words hand a shell as a string (`HANDED`), or null where they hand it none.
 * @param {string[]} words @returns {string | null}
 */
function handedLine(words) {
  const program = bareHead(words[0] || "");
  const hand = HANDED.find((h) => h.program.test(program));
  if (!hand) return null;
  for (let k = 1; k < words.length; k++) {
    const m = hand.switch.exec(words[k]);
    if (!m) continue;
    const joined = m[1] || "";
    const line = hand.rest ? [joined, ...words.slice(k + 1)].join(" ") : joined || words[k + 1] || "";
    return line.trim() || null;
  }
  return null;
}

/**
 * The other spellings of a command a deny, an ask or a review rule is judged against too, so that `cu'rl' x`, `"curl" x`,
 * `c\url x` and `/usr/bin/curl x` (the bug hunt of 10-30, PERM-1), and `sudo curl x`, `env -i X=1 curl x` and
 * `timeout 5 curl x` (its wrappers), are the `curl x` they run: its words as its shell reads them (`shellWords`; a bash
 * hand's command as bash and as cmd read it, the hand's shell being either), the variables it sets before the command
 * left out, the command named without its folder or Windows' extension, and the command each wrapper runs, wrapper
 * after wrapper (`wrapped`: `sudo env timeout 5 curl x` is `env timeout 5 curl x`, `timeout 5 curl x` and `curl x`
 * too). xargs runs its command with the words it reads after them, so its command's spellings end in a blank where
 * those go: a rule on the command with any words after it (`curl *`) covers `xargs curl`. The lines one command line
 * holds are read as command lines of their own, each split into its segments, down to `LINES_DEEP`: what a group, a
 * keyword, a substitution or a process substitution runs (`insideOf`), the line a shell is handed as a string
 * (`handedLine`), and the single word a wrapper was handed, which is a line itself (`runas /user:x "cmd /c del y"`), so
 * `( curl x )`, `if curl x; then ls; fi`, `echo $(curl x)`, `sh -c 'curl x'` and `start curl x` are all `curl x`. An
 * allow covers only what is written.
 * @param {string} command @param {string} name  the hand
 */
export function plainSpellings(command, name) {
  /** @type {Set<string>} */
  const out = new Set();
  /** One command's spellings: its words, and its words with its head bare; `more`, with the words it reads after them. @param {string[]} words @param {boolean} more */
  const spell = (words, more) => {
    const head = bareHead(words[0]);
    for (const w of head ? [words, [head, ...words.slice(1)]] : [words]) {
      const s = w.join(" ");
      out.add(s);
      if (more) out.add(`${s} `);
    }
  };
  /** @type {("bash" | "cmd" | "pwsh")[]} */
  const dialects = name === "powershell" ? ["pwsh"] : ["bash", "cmd"];
  /** The lines read, by how deep each was read, so each is read once and at its shallowest. @type {Map<string, number>} */
  const depths = new Map();
  /** One line's spellings, and the lines it holds read in turn. @param {string} text @param {number} deep */
  const readLine = (text, deep) => {
    if ((depths.get(text) ?? LINES_DEEP + 1) <= deep) return;
    depths.set(text, deep);
    const { inside, bare } = insideOf(text, name);
    const held = [...inside];
    for (const dialect of dialects) {
      const words = shellWords(bare, dialect);
      let k = 0;
      if (dialect === "bash") while (k < words.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k])) k++;
      let rest = words.slice(k);
      let more = false;
      let peeled = false;
      while (rest.length) {
        spell(rest, more);
        const handed = handedLine(rest);
        if (handed) held.push(handed);
        else if (peeled && rest.length === 1 && /\s/.test(rest[0])) held.push(rest[0]);
        const next = wrapped(rest);
        if (!next) break;
        more ||= next.appends;
        rest = next.words;
        peeled = true;
      }
    }
    if (deep < LINES_DEEP) for (const line of held) for (const seg of commandSegments(line)) readLine(seg, deep + 1);
  };
  const whole = String(command);
  readLine(whole, 0);
  out.delete(whole);
  return [...out];
}

/**
 * A web_search call's searches, each once, as it runs them: its query, then its queries. @param {any} inp
 * @returns {string[]}
 */
export const searchesOf = (inp) => [...new Set([inp?.query, ...(Array.isArray(inp?.queries) ? inp.queries : [])].map((q) => String(q ?? "").trim()).filter(Boolean))];

/**
 * What a rule's pattern is matched against for one call. Bash gives the whole command first and then each of its
 * segments, and web_search its searches together and then each; the others give one string.
 * @param {string} name @param {any} input
 * @returns {string[]}
 */
export function subjectsOf(name, input) {
  const inp = input || {};
  switch (name) {
    case "bash":
    case "bash_background":
    case "powershell": {
      const cmd = String(inp.command || "").trim();
      return [cmd, ...commandSegments(cmd).filter((p) => p !== cmd)];
    }
    case "read":
    case "write":
    case "edit":
    case "lsp":
      return [String(inp.path || inp.file_path || "").trim()];
    case "grep":
    case "glob":
      return [String(inp.pattern || "").trim()];
    case "web_fetch":
      return [String(inp.url || "").trim()];
    case "web_search": {
      // Several searches at once (`queries`): their words together first, then each — a deny or an ask that covers any
      // one speaks for the call, an allow only where it covers every one, as a compound command's segments are judged.
      const all = searchesOf(inp);
      return all.length > 1 ? [all.join(" · "), ...all] : [all[0] || ""];
    }
    case BROWSER: {
      // The page the call works on (HarnessV4_Browser_Plan BR-D7): the one the chat's browser shows (`page`, which the
      // loop adds), and every address it goes to — so a rule naming a site stops looking and acting there, not only
      // going there.
      // A host's trailing dot (`evil.test.`) is the same site, and read without it (the bug round of 10-23).
      const page = ruleUrl(String(inp.page || "").trim());
      const to = [inp, ...(Array.isArray(inp.steps) ? inp.steps : [])]
        .filter((st) => st && (st.action === "navigate" || (st.action === "tabs" && st.url)))
        .map((st) => ruleUrl(wholeUrl(String(st.url || ""))))
        .filter((u) => u && u !== page);
      return [page, ...to];
    }
    default:
      return [JSON.stringify(inp)];
  }
}

/** The one-line form the inspector and the record use: `bash(rm *) deny`, `write(*.md) allow · learned`. @param {Rule} r */
export function describeRule(r) {
  return `${r.tool}(${r.pattern}) ${r.verdict}${r.learned ? " · learned" : ""}${r.shipped ? " · Second look before risky commands" : ""}`;
}

/**
 * Whether the rules ask first for a call — an ask rule, or a review rule, which asks with a second look: what Filament
 * runs by itself (a check, a brief's grants, a file brought back) never runs on one.
 * @param {RuleHit | null | undefined} hit
 */
export const asksFirst = (hit) => hit?.verdict === "ask" || hit?.verdict === "review";

/**
 * The refusal a deny rule speaks, in the loop's words.
 * @param {string} name @param {Rule} rule @param {string} subject @param {string} [lead]
 */
export const denialText = (name, rule, subject, lead = "Not run:") =>
  `${lead} this session's rules refuse ${name} here (rule ${describeRule(rule)} matched \`${subject}\`). Do not retry the same call; say what you would have done and why, or take another route.`;

/**
 * Whether the rule speaks for this tool: `*` for all, `bash` for every spelling of a command (bash, bash_background,
 * powershell), `read` for the language server's asks too, which read the file; names compare without case, as MCP
 * tools keep theirs.
 * @param {Rule} rule @param {string} name
 */
const namesTool = (rule, name) => {
  if (rule.tool === "*") return true;
  const tool = String(rule.tool).toLowerCase();
  const called = String(name).toLowerCase();
  return tool === called || (tool === "bash" && isCommandHand(called)) || (tool === "read" && called === "lsp");
};

/**
 * The rules that speak for a read, in order, as data a worker thread carries (core/read-rules.js `keptOut`): what grep
 * and glob leave out. Null where none of them denies.
 * @param {readonly Rule[]} rules
 * @returns {import("../../core/read-rules.js").ReadRules | null}
 */
export function readRules(rules) {
  const live = (Array.isArray(rules) ? rules : []).filter((rule) => rule && RULE_VERDICTS.includes(rule.verdict) && typeof rule.pattern === "string" && namesTool(rule, "read"));
  return live.some((r) => r.verdict === "deny") ? live.map((r) => ({ source: globToRegExp(r.pattern).source, verdict: r.verdict })) : null;
}

/**
 * Whether one rule covers one subject: a learned bash rule by the permission's shape, every other rule by its glob.
 * @param {Rule} rule @param {string} subject
 */
export function covers(rule, subject) {
  if (rule.learned && rule.tool === "bash") {
    const s = permissionShape("bash", { command: subject });
    return !!s && s.shape === String(rule.pattern).trim().toLowerCase();
  }
  try {
    return globToRegExp(rule.pattern).test(subject);
  } catch {
    return false;
  }
}

/**
 * What the rules say about the call, or null when none speaks for it. Malformed rules are skipped.
 * @param {readonly Rule[]} rules @param {string} name @param {any} input
 * @param {CommandPlace | null} [at]  where a command starts; without it, an allow must cover every segment
 * @returns {RuleHit | null}
 */
export function ruleFor(rules, name, input, at = null) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const live = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule && RULE_VERDICTS.includes(rule.verdict) && typeof rule.pattern === "string" && namesTool(rule, name));
  if (!live.length) return null;
  const [whole, ...parts] = subjectsOf(name, input);
  const segments = parts.length ? parts : [whole];
  /** A command's subject with its other spellings (`plainSpellings`), each read once. @type {Map<string, string[]>} */
  const spelt = new Map();
  const spellingsOf = (/** @type {string} */ subject) => {
    let all = spelt.get(subject);
    if (!all) spelt.set(subject, (all = [subject, ...plainSpellings(subject, name)]));
    return all;
  };
  /**
   * Whether a rule speaks for a subject. A browser rule's pattern is read as its subjects are (`ruleUrl`):
   * `https://evil.test./*` names evil.test (the copies hunt of 10-23). A deny, an ask or a review on a command sees its
   * other spellings too; an allow, the words as written.
   * @param {Rule} rule @param {string} subject
   */
  const speaks = (rule, subject) => {
    if (name === BROWSER) return covers({ ...rule, pattern: ruleUrl(rule.pattern) }, subject);
    if (rule.verdict === "allow" || !isCommandHand(name)) return covers(rule, subject);
    return spellingsOf(subject).some((s) => covers(rule, s));
  };
  /** The first rule in order that speaks for a subject; allow rules only where `allowMay`. */
  const first = (/** @type {string} */ subject, /** @type {boolean} */ allowMay) =>
    live.find(({ rule }) => (allowMay || rule.verdict !== "allow") && speaks(rule, subject)) || null;
  const judged = segments.map((subject) => {
    const allowMay = !isCommandHand(name) || !UNCOVERABLE.test(subject);
    return { subject, allowMay, hit: first(subject, allowMay) };
  });
  // The whole of a compound command is a subject for deny and ask (a pattern may span segments); an allow is per segment.
  const wholeHit = parts.length ? first(whole, false) : null;
  const hits = [...judged.flatMap((j) => (j.hit ? [{ ...j.hit, subject: j.subject }] : [])), ...(wholeHit ? [{ ...wholeHit, subject: whole }] : [])];
  /** The first rule of a verdict that covers a subject, whatever came before it. @param {Rule["verdict"]} verdict */
  const anyOf = (verdict) =>
    [...segments, ...(parts.length ? [whole] : [])].flatMap((subject) => {
      const r = live.find(({ rule }) => rule.verdict === verdict && speaks(rule, subject));
      return r ? [{ ...r, subject }] : [];
    })[0];
  // A review rule speaks for what it covers whatever allow or ask came before it (HarnessV4_Space_Plan SG-D13): the
  // switch's shipped ones come after the session's own rules, and a learned `git push` allow lifts no second look
  // before a forced push. A deny that covers it refuses, wherever it stands: a refusal never softens to an ask.
  const reviewed = anyOf("review");
  const denied = reviewed ? anyOf("deny") : undefined;
  for (const verdict of /** @type {const} */ (["deny", "review", "ask"])) {
    const h = hits.find((x) => x.rule.verdict === verdict) || (verdict === "deny" ? denied : verdict === "review" ? reviewed : undefined);
    if (h) return { verdict, rule: h.rule, index: h.index, subject: h.subject, rules: [h.rule] };
  }
  // An allow covers the segments that take the command somewhere: a cd into its own folder takes it nowhere (G2-14).
  const going = at && isCommandHand(name) ? judged.filter((j) => !staysPut(j.subject, name, at)) : judged;
  if (going.length && going.every((j) => j.hit?.rule.verdict === "allow")) {
    const covering = [...new Set(going.map((j) => /** @type {Rule} */ (j.hit?.rule)))];
    return { verdict: "allow", rule: covering[0], index: /** @type {number} */ (going[0].hit?.index), subject: whole, rules: covering };
  }
  // An allow reaches part of the command but not all of it: the gate decides, and the loop says why.
  const stopped = judged.find((j) => !j.allowMay && live.some(({ rule }) => rule.verdict === "allow" && covers(rule, j.subject)));
  if (stopped) {
    const a = /** @type {{ rule: Rule, index: number }} */ (live.find(({ rule }) => rule.verdict === "allow" && covers(rule, stopped.subject)));
    return { verdict: "gate", rule: a.rule, index: a.index, subject: stopped.subject, why: UNCOVERABLE_WHY };
  }
  const partial = judged.find((j) => j.hit?.rule.verdict === "allow");
  const gap = going.find((j) => j.hit?.rule.verdict !== "allow");
  if (partial?.hit && gap) return { verdict: "gate", rule: partial.hit.rule, index: partial.hit.index, subject: whole, why: `no rule covers \`${gap.subject}\`` };
  return null;
}

/**
 * The rules in force for a session, from its effective document: `privacy.bashDeny` first (as bash deny rules), then
 * `loop.rules` as written, then — `loop.secondLook` on — the shipped review rules. Anything malformed is left out (the
 * layer validator refuses it on the way in).
 * @param {any} doc  the effective settings document
 * @returns {Rule[]}
 */
export function rulesFrom(doc) {
  /** @type {Rule[]} */
  const out = [];
  for (const p of Array.isArray(doc?.privacy?.bashDeny) ? doc.privacy.bashDeny : [])
    if (typeof p === "string" && p.trim()) out.push({ tool: "bash", pattern: p, verdict: "deny" });
  for (const r of Array.isArray(doc?.loop?.rules) ? doc.loop.rules : [])
    if (r && typeof r.tool === "string" && typeof r.pattern === "string" && r.pattern.trim() && RULE_VERDICTS.includes(r.verdict))
      out.push({ tool: r.tool, pattern: r.pattern, verdict: r.verdict, ...(r.learned ? { learned: true } : {}) });
  if (doc?.loop?.secondLook === true) for (const r of RISKY_RULES) out.push({ ...r });
  return out;
}

/**
 * A permission item's text as its tool and shape (`bash: npm test` → bash, `npm test`; `edit: (no extension)` → edit,
 * `(no extension)`), or null for a text that is not a permission shape. A bash shape is lower-cased, as it is learned.
 * @param {string} text
 * @returns {{ tool: string, shape: string } | null}
 */
export function permissionOf(text) {
  const m = /^(bash|write|edit):\s+(.+)$/.exec(String(text || "").trim());
  if (!m) return null;
  return { tool: m[1], shape: m[1] === "bash" ? m[2].trim().toLowerCase() : m[2] };
}

/**
 * The `allow` rule a confirmed permission item stands for (its text is the shape: `bash: npm test`, `write: *.md`),
 * or null for a text that is not a permission shape. A bash pattern is the shape itself, matched as a shape (see `covers`).
 * A file with no extension has no glob, so its permission has no rule; the gate lets it through all the same.
 * @param {string} text
 * @returns {Rule | null}
 */
export function learnedRuleFor(text) {
  const p = permissionOf(text);
  if (!p || p.shape === "(no extension)") return null;
  return { tool: p.tool, pattern: p.shape, verdict: "allow", learned: true };
}

/**
 * A permission item's mirror on its project's `loop.rules` (WP-L meets §5.2): confirmed, the learned `allow` is there
 * (once) for the inspector to show and the gate to read; withdrawn (dismissed, back to inferred), it is gone, so nothing
 * keeps running on a permission the developer took back — and a list it empties goes with it, so the layers below speak
 * again rather than an empty list nobody wrote. Returns the rule while it stands, null otherwise.
 * @param {any} archive @param {{ kind: string, text: string, status: string, project: string | null }} claim  as the memory port shows it
 * @returns {Rule | null}
 */
export function mirrorLearnedRule(archive, claim) {
  if (claim.kind !== "permission" || !claim.project) return null;
  const rule = learnedRuleFor(claim.text);
  if (!rule) return null;
  const layer = archive.projectSettings(claim.project) || {};
  const rules = Array.isArray(layer.loop?.rules) ? layer.loop.rules : [];
  const mirror = (/** @type {any} */ r) => r && r.learned === true && r.tool === rule.tool && r.pattern === rule.pattern;
  if (claim.status !== "confirmed") {
    if (!rules.some(mirror)) return null;
    const loop = { ...(layer.loop || {}), rules: rules.filter((r) => !mirror(r)) };
    if (!loop.rules.length) delete loop.rules;
    // The archive's writer merges top-level keys: a section left empty arrives as undefined, and goes.
    archive.setProjectSettings(claim.project, { loop: Object.keys(loop).length ? loop : undefined });
    return null;
  }
  if (rules.some(mirror)) return rule;
  archive.setProjectSettings(claim.project, { loop: { ...(layer.loop || {}), rules: [...rules, rule] } });
  return rule;
}
