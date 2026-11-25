// @ts-check
// Which commands only read (HarnessV3-Launch LD-D11): the foreground `bash` hand runs one without asking, in every mode
// but Full access, which runs everything (Edit mode alone until HarnessV3-AtHome AH-F2). Asking before `wc -c` taught
// the developer to click Allow without reading.
//
// The reader is conservative: what it cannot read asks, as every command did before — read-only refuses it — and the
// question or the refusal says why.
// - Only a real bash reads the command this way (Git Bash, bash, sh): cmd.exe's and PowerShell's quoting is another
//   language, and a reader that guessed at it would not be conservative. PowerShell has a reader of its own
//   (read-only-powershell.js, HarnessV4_Tasks C10).
// - The syntax: words; single quotes; double quotes holding no `$` or backtick; `$?`, the last command's exit status,
//   which expands to digits alone and reads as `0` (`echo "exit: $?"`, HarnessV3-TaskGraph-v2 TG2-D44's drive), quoted
//   or not — every other `$` is a variable or a substitution; a backslash escaping one character;
//   `;`, `&&`, `||`, `|` and line breaks between commands; output only to /dev/null (`>`, `>>`, `1>`, `2>`), `2>&1`,
//   `>&2`. A `~` inside a word is a letter (`HEAD~3`); one that starts it, or follows a `=` or `:`, is a home folder.
// - The programs: ls, cat, head, tail, wc, du, grep, rg, sed, find, cut, sort, uniq, tr, pwd and echo, each with only
//   the options known to read — none that follows links, runs or writes something, reads names or patterns from a
//   file, or never ends (`tail -f`) —, sed only with a script that picks lines to print (`sed -n '1,80p'`), and uniq
//   with one operand at most (a second is the file it writes). A `$` stays refused, `$?` aside: a variable the person
//   passes to commands may hold a secret.
//   `cd <folder>` may come first, before the commands it runs in. Joined by `&&`, then `&&` and `|` only, nothing runs
//   if the cd fails; joined otherwise (`;`, `||`, a line break), the rest may run in the working folder, so each later
//   command is read from both folders (AH-F2). A `cd` piped into a command does not move it.
// - A toolchain asked its version (HarnessV3-FailurePoints §8 item 4): one of a table, with one of its own version
//   flags and nothing else (`node -v`) — not any program: the PATH holds programs with windows of their own, and to
//   many `-v` means verbose. None whose launcher acts on a file in the folder (rustup's cargo installs the toolchain a
//   rust-toolchain.toml names, corepack's yarn the version package.json names). It must be found on the PATH, a file
//   Filament can read: a Windows app alias, which may open the Store, is none.
// - git's reading forms (§8 item 4): status, log, diff, show, rev-parse and branch --list, each with the options known
//   to only read — never `--output`, `--no-index`, `--ext-diff`, nor `-c` or `--git-dir` before the form — and
//   every operand read as a path inside. git runs the commands its config names (core.fsmonitor, a filter, a diff
//   driver), so it runs only in the working folder itself, which holds its own `.git`: a write into `.git` asks in every
//   mode (agent/tools.js `intoGit`), and in any other folder files the agent wrote could pass for a repository — a
//   bare one is a few files. Or at the top of a worktree of that same repository that the run reads — named by one `-C`
//   before the form, or a `cd` — which a run that only reads is handed (the owner's of 11-09: a Reviewer could not size
//   or status the repository's worktrees): git's own records tie its `.git` to the working folder's git folder, whose
//   config it runs with, and those records lie outside the working folder or in its own `.git`.
// - The paths: every one a program reads resolves inside the working folder through the hands' fence (real paths: a
//   link that leads out asks). `..` only at a path's start: after a name the system resolves it through links, where
//   the fence reads it by its letters.
// - The globs: only in a path's last part, not starting with `.` or `[` (either could match `..`), no `**`, from a
//   folder that holds no link, since the shell picks the names. A glob that starts a word comes after `--`: the
//   agent can name a file `--pre=x`, and `rg foo *` would hand it to rg as an option. In a long option's value after
//   its `=` (`grep --include=*.js`) a glob stays that option, whatever names it expands into — never in the option
//   that gives the pattern.
// - The programs themselves: the shell must find each one before any folder the agent could write to (inside the
//   working folder, or relative to the folder a command runs in), where its own file could stand in for it.
// - For another machine's agents (`agentsDevice`): Filament's own command line is no read, nor is a path in a
//   repository's own `.git` or in a credentials folder inside their folder (fs-fence.js `keptFromAgents`, by its names
//   and where the filesystem resolves it), nor a search that reads every file below a folder that holds one (`grep -r`,
//   `rg --hidden`). A listing or a sizing of such a tree (`ls -R`, `find`, `du`) names files and reads none.
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { holdsKept, keptWords, resolveInside } from "./fs-fence.js";

/** @typedef {{ ok: true } | { ok: false, why: string }} Verdict */
/** A word as the program receives it, and where its unquoted glob characters stand. @typedef {{ text: string, globs: number[], quoted: boolean }} Word */
/** Where the command stands: the working folder (and its real path), the folder a command runs in, the shell's kind,
 * the folders added to it that a read may also land in (`readsAt`), and whether it runs for another machine's agents
 * (`theirs`: fs-fence.js `keptFromAgents`). @typedef {{ root: string, realRoot: string, cwd: string, gitBash: boolean, reads: readonly Added[], theirs: boolean }} Place */
/** A folder added to the working folder (`loop.addedFolders`, and a run that only reads its repository's worktrees), by
 * its letters and by its real path. @typedef {{ dir: string, real: string }} Added */
/** A folder the shell searches for a program; `note` when no program may be looked for past it. @typedef {{ dir: string, note?: string }} Searched */

/** @type {Verdict} */
const YES = Object.freeze({ ok: true });
/** @param {string} why @returns {{ ok: false, why: string }} */
const no = (why) => ({ ok: false, why });

const BASHES = new Set(["git-bash", "bash", "sh"]);
/** Bash's own: no PATH lookup finds these. */
const BUILTINS = new Set(["echo", "pwd"]);
/** bash's PATH when the environment has none: the folder a command runs in (".") is its last entry. */
const BASH_DEFAULT_PATH = "/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:.";
/** A name Windows opens as a device in any folder (the part before its first dot): `rg x CON` reads the console. */
export const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
/** What an unquoted character outside the syntax above means — each asks. @type {Record<string, string>} */
const OUTSIDE = {
  $: "a `$` (a variable or a substitution)",
  "`": "a backtick (a substitution)",
  "(": "a parenthesis (a subshell)",
  ")": "a parenthesis (a subshell)",
  "{": "a brace (a group or an expansion)",
  "}": "a brace (a group or an expansion)",
  "<": "a `<` (input from a file, or a substitution)",
  "~": "a `~` (a home folder)",
  "\r": "a carriage return",
};

/**
 * The command as bash splits it: its simple commands, each a list of words, and what joins each to the next ("" after
 * the last). Redirections to /dev/null are read and dropped; anything else outside the syntax is a refusal.
 * @param {string} src
 * @returns {{ commands: Word[][], seps: string[] } | { ok: false, why: string }}
 */
function lex(src) {
  /** @type {Word[][]} */
  const commands = [];
  /** @type {string[]} */
  const seps = [];
  /** @type {Word[]} */
  let words = [];
  /** @type {Word | null} */
  let w = null;
  const word = () => (w ||= { text: "", globs: [], quoted: false });
  const endWord = () => {
    if (w) words.push(w);
    w = null;
  };
  const endCommand = (/** @type {string} */ sep) => {
    endWord();
    commands.push(words);
    seps.push(sep);
    words = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === " " || c === "\t") endWord();
    else if (c === "\n" || c === ";") endCommand(";");
    else if (c === "&") {
      if (src[i + 1] !== "&") return no(src[i + 1] === ">" ? "`&>` sends output to a file" : "a lone `&` runs a command in the background");
      endCommand("&&");
      i++;
    } else if (c === "|") {
      if (src[i + 1] === "&") return no("`|&` is a redirection this check does not read");
      const or = src[i + 1] === "|";
      endCommand(or ? "||" : "|");
      if (or) i++;
    } else if (c === ">") {
      // The descriptor is a word of digits alone before the `>` (bash's own rule): 1 or 2, else standard output.
      let fd = 1;
      const before = /** @type {Word | null} */ (w); // `word()` sets it, where the checker's flow analysis cannot see
      if (before && !before.quoted && /^\d+$/.test(before.text)) {
        if (before.text !== "1" && before.text !== "2") return no(`a redirection of descriptor ${before.text}`);
        fd = Number(before.text);
        w = null;
      } else endWord();
      if (src[i + 1] === "&") {
        // The two outputs joined, nothing written: `2>&1` and `>&2` only.
        const to = src[i + 2];
        if (!((fd === 2 && to === "1") || (fd === 1 && to === "2")) || !/^$|^[\s;&|]/.test(src.slice(i + 3, i + 4))) return no("a redirection other than `2>&1` and `>&2`");
        i += 2;
        continue;
      }
      if (src[i + 1] === "|") return no("`>|` writes a file");
      if (src[i + 1] === ">") i++;
      let j = i + 1;
      while (src[j] === " " || src[j] === "\t") j++;
      const m = /^\/dev\/null(?=$|[\s;&|])/.exec(src.slice(j));
      if (!m) return no("output into a file: only /dev/null reads nothing back");
      i = j + m[0].length - 1;
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) return no("an unclosed quote");
      const t = word();
      t.text += src.slice(i + 1, j);
      t.quoted = true;
      i = j;
    } else if (c === '"') {
      const t = word();
      t.quoted = true;
      let j = i + 1;
      for (; j < src.length && src[j] !== '"'; j++) {
        const d = src[j];
        if (d === "$" && src[j + 1] === "?") {
          t.text += "0";
          j++;
          continue;
        }
        if (d === "$" || d === "`") return no("a `$` or a backtick inside double quotes");
        if (d === "\\" && src[j + 1] === "\n") return no("a line continuation");
        // Inside double quotes a backslash escapes only `"`, `\`, `$` and a backtick; before anything else it stays.
        if (d === "\\" && (src[j + 1] === '"' || src[j + 1] === "\\")) j++;
        t.text += src[j];
      }
      if (j >= src.length) return no("an unclosed quote");
      i = j;
    } else if (c === "\\") {
      const d = src[i + 1];
      if (d === undefined || d === "\n" || d === "\r") return no("a line continuation");
      const t = word();
      t.text += d;
      t.quoted = true;
      i++;
    } else if (c === "#" && !w) return no("a comment");
    else if (c === "~") {
      // bash expands a tilde that starts a word, or follows a `=` or `:` in one that reads as an assignment.
      const t = /** @type {Word | null} */ (w);
      if (!t || !t.text || /[=:]/.test(t.text)) return no(OUTSIDE[c]);
      t.text += c;
    } else if (c === "$" && src[i + 1] === "?") {
      word().text += "0";
      i++;
    } else if (Object.hasOwn(OUTSIDE, c)) return no(OUTSIDE[c]);
    else {
      const t = word();
      if (c === "*" || c === "?" || c === "[") t.globs.push(t.text.length);
      t.text += c;
    }
  }
  endCommand("");
  return { commands, seps };
}

const normCase = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * The folders a read may also land in (`loop.addedFolders`, HarnessV4_Overnight_Plan OV-D22; a run that only reads, its
 * repository's worktrees too — the owner's of 11-09), each with its real path; one that cannot be resolved reads nothing.
 * @param {readonly string[]} reads @returns {Added[]}
 */
export function readsAt(reads) {
  /** @type {Added[]} */
  const out = [];
  for (const f of reads)
    try {
      out.push({ dir: resolve(f), real: realpathSync(f) });
    } catch {}
  return out;
}

/**
 * Why a path in a repository's own `.git` or in a credentials folder is no read for another machine's agents (an exec of
 * their device, a chat they started), though it lies inside their folder: the file route refuses it them
 * (http/admin/remote.js `agentFileRefusal`), and a command that reads it asks, or is refused, as any that does more
 * than read. PowerShell's reader says the same.
 */
export const NOT_READ_BY_THEM = "which another machine's agents never read unasked";

/** Where a refused path is, in words. @param {{ reads: readonly Added[] }} at */
export const outsideWords = (at) => (at.reads.length ? "outside the working folder and the folders added to it" : "outside the working folder");
/** Whether `child` is `parent` or inside it, by their letters. @param {string} child @param {string} parent */
export const within = (child, parent) => {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * Whether the agent could write in `dir`: it is the working folder or inside it, by its letters or by its real path —
 * its own, or its nearest existing parent's, where a folder made later would land.
 * @param {string} dir @param {{ root: string, realRoot: string }} at
 */
export function reaches(dir, at) {
  const d = resolve(dir);
  if (within(d, resolve(at.root))) return true;
  for (let p = d; ; p = dirname(p)) {
    if (existsSync(p))
      try {
        return within(realpathSync(p), at.realRoot);
      } catch {
        return true;
      }
    if (dirname(p) === p) return false;
  }
}

/**
 * Where a path a program reads lands, when that is inside the working folder or a folder added to it.
 * @param {string} text @param {Place} at
 * @returns {{ ok: true, abs: string } | { ok: false, why: string }}
 */
function place(text, at) {
  const { root, cwd, gitBash } = at;
  // Git Bash reads /c/… as the drive C:; any other absolute POSIX path is its own tree (/usr, /tmp), or a share.
  const t = gitBash ? text.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:/") : text;
  if (gitBash && /^[\\/]/.test(t)) return no(`${text} is ${outsideWords(at)}`);
  if (gitBash && /^[A-Za-z]:(?![\\/])/.test(t)) return no(`${text} names a drive's current folder`);
  let named = false;
  for (const [n, part] of t.split(gitBash ? /[\\/]+/ : /\/+/).entries()) {
    if (gitBash && DEVICE.test(part.split(".")[0].trimEnd())) return no(`${text} names a Windows device`);
    if (part === "..") {
      if (named) return no(`\`..\` after a name in ${text}: the system resolves it through links`);
    } else if (part && part !== "." && !(gitBash && n === 0 && /^[A-Za-z]:$/.test(part))) named = true;
  }
  const abs = resolve(cwd, t);
  try {
    resolveInside(root, abs, { reads: at.reads.map((r) => r.dir), theirs: at.theirs });
  } catch (/** @type {any} */ e) {
    if (e?.kept) return no(`${text} is in ${keptWords(e.kept)}, ${NOT_READ_BY_THEM}`);
    return no(`${text} ${/link/.test(String(e?.message)) ? "reaches outside the working folder through a link" : `is ${outsideWords(at)}`}`);
  }
  return { ok: true, abs };
}

/**
 * A word the shell expands against a folder: the glob in its last part only, never `**`, never a last part that could
 * match `..`, and a folder inside that holds no link, since the shell picks the names.
 * @param {Word} w @param {Place} at @returns {Verdict}
 */
function glob(w, at) {
  const t = w.text;
  if (t.includes("**")) return no(`\`**\` in ${t}`);
  const cut = Math.max(t.lastIndexOf("/"), at.gitBash ? t.lastIndexOf("\\") : -1);
  if (w.globs.some((g) => g < cut)) return no(`a glob before the last part of ${t}`);
  if (/^[.[]/.test(t.slice(cut + 1))) return no(`${t}: a glob part that starts with \`.\` or \`[\` can match \`..\``);
  const folder = place(cut < 0 ? "." : t.slice(0, cut) || "/", at);
  if (!folder.ok) return folder;
  try {
    if (readdirSync(realpathSync(folder.abs), { withFileTypes: true }).some((d) => d.isSymbolicLink())) return no(`${t}: its folder holds a link, and the shell may pick it`);
  } catch {
    return no(`${t}: its folder cannot be read`);
  }
  return YES;
}

/** A path operand: `-` (standard input), a glob, or a path inside. @param {Word} w @param {Place} at @returns {Verdict} */
function operand(w, at) {
  if (w.text === "-") return YES;
  if (w.globs.length) return glob(w, at);
  const p = place(w.text, at);
  return p.ok ? YES : p;
}

/**
 * What a program may take: short options alone (`flags`) or with a value (`values`, attached or the next word), long
 * options alone (`long`) or with one (`longValues`, `--name=v` or the next word). `count`: `-NUM` is a count. A
 * searcher's first operand is its pattern unless `patternShort` / `patternLong` gave one, or a `noPattern` option says
 * there is none.
 * @typedef {{ flags: string, values?: string, long?: ReadonlySet<string>, longValues?: ReadonlySet<string>, count?: boolean,
 *   patternShort?: string, patternLong?: string, noPattern?: ReadonlySet<string> }} Spec
 */

/**
 * A GNU-style command line read against its program's Spec: the operands left, whether an option gave the pattern or
 * said there is none, and the patterns the options gave. An option it does not know refuses, and so does an unquoted
 * glob in an option, in an option's value, or at the start of an operand before `--`.
 * @param {string} prog @param {Word[]} args @param {Spec} spec
 * @returns {{ operands: Word[], patterned: boolean, patterns: string[] } | { ok: false, why: string }}
 */
function parse(prog, args, spec) {
  /** @type {Word[]} */
  const operands = [];
  let patterned = false;
  /** @type {string[]} */
  const patterns = [];
  let options = true;
  /** @param {Word | undefined} v @param {string} opt */
  const valueProblem = (v, opt) => (!v ? no(`${prog} ${opt} needs a value`) : v.globs.length ? no(`${prog} ${opt}: a value with an unquoted glob — quote it`) : null);
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    const t = w.text;
    if (!options || t === "-" || !t.startsWith("-")) {
      if (options && w.globs[0] === 0) return no(`${prog} ${t}: a glob that starts a word can expand into an option — it goes after \`--\``);
      operands.push(w);
      continue;
    }
    if (t === "--") {
      options = false;
      continue;
    }
    // A glob in a long option's value after its `=` (`--include=*.js`): whatever names the shell expands it into start
    // with the same `--name=`, so each is that option still — never the one that gives the pattern, which a name the
    // agent made could turn into another script (sed's).
    const eq = t.startsWith("--") ? t.indexOf("=") : -1;
    if (w.globs.length && !(eq > 2 && w.globs.every((g) => g > eq) && t.slice(2, eq) !== spec.patternLong)) return no(`${prog} ${t}: an option with an unquoted glob — quote it`);
    if (t.startsWith("--")) {
      const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
      if (eq < 0 && spec.long?.has(name)) {
        if (spec.noPattern?.has(name)) patterned = true;
        continue;
      }
      if (!spec.longValues?.has(name)) return no(`${prog} --${name} is not an option known to only read`);
      let value = t.slice(eq + 1);
      if (eq < 0) {
        const bad = valueProblem(args[++i], `--${name}`);
        if (bad) return bad;
        value = args[i].text;
      }
      if (name === spec.patternLong) {
        patterned = true;
        patterns.push(value);
      }
      continue;
    }
    if (spec.count && /^-\d+$/.test(t)) continue;
    for (let k = 1; k < t.length; k++) {
      const ch = t[k];
      if (spec.flags.includes(ch)) continue;
      if (!spec.values?.includes(ch)) return no(`${prog} -${ch} is not an option known to only read`);
      let value = t.slice(k + 1);
      if (k === t.length - 1) {
        const bad = valueProblem(args[++i], `-${ch}`);
        if (bad) return bad;
        value = args[i].text;
      }
      if (ch === spec.patternShort) {
        patterned = true;
        patterns.push(value);
      }
      break;
    }
  }
  return { operands, patterned, patterns };
}

/** @param {...string} names */
const set = (...names) => Object.freeze(new Set(names));

/** @type {Spec} ls without -L / -H (they follow links) */
const LS = {
  flags: "1aABcCdfFghiklmnNopqQrRsStuUvxX",
  values: "ITw",
  long: set("all", "almost-all", "ignore-backups", "classify", "file-type", "directory", "human-readable", "si", "inode", "numeric-uid-gid", "no-group", "recursive", "reverse", "size", "literal", "hide-control-chars", "show-control-chars", "group-directories-first", "full-time", "author", "escape", "kibibytes", "color", "colour"),
  longValues: set("color", "colour", "sort", "time", "format", "indicator-style", "quoting-style", "time-style", "block-size", "width", "tabsize", "ignore", "hide"),
};
/** @type {Spec} */
const CAT = { flags: "AbeEnstTuv", long: set("show-all", "number-nonblank", "show-ends", "number", "squeeze-blank", "show-tabs", "show-nonprinting") };
/** @type {Spec} head; tail the same, never -f / -F (it never ends) */
const HEAD = { flags: "qvz", values: "nc", count: true, long: set("quiet", "silent", "verbose", "zero-terminated"), longValues: set("lines", "bytes") };
/** @type {Spec} wc without --files0-from (it reads names from a file) */
const WC = { flags: "clmwL", long: set("bytes", "chars", "lines", "words", "max-line-length"), longValues: set("total") };
/** @type {Spec} du, which only sizes (no form of it writes), without -L, -H or -D (they follow links), -X / --exclude-from
 * or --files0-from (they read patterns or names from a file) */
const DU = {
  flags: "0abchklmPsSx",
  values: "Bdt",
  long: set("null", "all", "apparent-size", "bytes", "total", "human-readable", "si", "inodes", "count-links", "no-dereference", "separate-dirs", "summarize", "one-file-system", "time"),
  longValues: set("block-size", "max-depth", "threshold", "exclude", "time", "time-style"),
};
/** @type {Spec} grep without -R (follows links), -f (patterns from a file), -d / -D (what a folder or a device is read as) */
const GREP = {
  flags: "abcEFGhHiIlLnoPqrsTUvVwxyzZ",
  values: "eABCm",
  count: true,
  long: set("extended-regexp", "fixed-strings", "basic-regexp", "perl-regexp", "ignore-case", "no-ignore-case", "invert-match", "word-regexp", "line-regexp", "count", "files-with-matches", "files-without-match", "only-matching", "quiet", "silent", "no-messages", "byte-offset", "with-filename", "no-filename", "line-number", "initial-tab", "null", "null-data", "text", "recursive", "line-buffered", "color", "colour"),
  longValues: set("regexp", "max-count", "after-context", "before-context", "context", "include", "exclude", "exclude-dir", "color", "colour", "binary-files", "label"),
  patternShort: "e",
  patternLong: "regexp",
};
/** @type {Spec} rg without --pre / -z (they run programs), -L (follows links), -f / --ignore-file (read a file), -r */
const RG = {
  flags: "0.abcFhHiIlnNopPqsSuUvVwx",
  values: "ABCdegjmMtTE",
  long: set("files", "files-with-matches", "files-without-match", "count", "count-matches", "hidden", "no-hidden", "no-ignore", "no-ignore-vcs", "no-ignore-parent", "no-ignore-dot", "no-ignore-global", "no-ignore-exclude", "no-ignore-files", "ignore-case", "smart-case", "case-sensitive", "invert-match", "word-regexp", "line-regexp", "fixed-strings", "only-matching", "line-number", "no-line-number", "with-filename", "no-filename", "column", "no-column", "heading", "no-heading", "json", "vimgrep", "trim", "multiline", "multiline-dotall", "pcre2", "text", "binary", "null", "null-data", "no-messages", "quiet", "stats", "type-list", "unrestricted", "one-file-system", "crlf", "passthru", "byte-offset", "pretty", "no-config", "max-columns-preview", "include-zero"),
  longValues: set("glob", "iglob", "type", "type-not", "regexp", "max-count", "after-context", "before-context", "context", "max-depth", "max-filesize", "color", "colors", "sort", "sortr", "threads", "max-columns", "encoding", "engine", "path-separator", "context-separator", "field-match-separator", "field-context-separator", "type-add", "type-clear"),
  patternShort: "e",
  patternLong: "regexp",
  noPattern: set("files", "type-list"),
};
/** @type {Spec} sed without -i (it writes the file in place), -f (its script from a file) or -l; its script is `printOnly`'s */
const SED = {
  flags: "nErszu",
  values: "e",
  long: set("quiet", "silent", "regexp-extended", "separate", "null-data", "unbuffered", "posix"),
  longValues: set("expression"),
  patternShort: "e",
  patternLong: "expression",
};

/** @type {Spec} cut: every form of it only prints */
const CUT = { flags: "nsz", values: "bcdf", long: set("complement", "only-delimited", "zero-terminated"), longValues: set("bytes", "characters", "delimiter", "fields", "output-delimiter") };
/** @type {Spec} sort without -o / --output (it writes the file), -T (where its scratch goes), --compress-program (runs one),
 * --files0-from or --random-source (read a file) */
const SORT = {
  flags: "bdfgiMhnRrVcCmsuz",
  values: "ktS",
  long: set("ignore-leading-blanks", "dictionary-order", "ignore-case", "general-numeric-sort", "ignore-nonprinting", "month-sort", "human-numeric-sort", "numeric-sort", "random-sort", "reverse", "version-sort", "check", "debug", "merge", "stable", "unique", "zero-terminated"),
  longValues: set("sort", "check", "key", "buffer-size", "field-separator", "parallel"),
};
/** @type {Spec} uniq; its second operand is a file it writes, refused where it is read (`PROGRAMS.uniq`) */
const UNIQ = {
  flags: "cdDiuz",
  values: "fsw",
  long: set("count", "repeated", "all-repeated", "group", "ignore-case", "unique", "zero-terminated"),
  longValues: set("all-repeated", "group", "skip-fields", "skip-chars", "check-chars"),
};
/**
 * The first word that reads as an option after a program's first operand, or null: a value an option takes is no
 * operand (`-f 2`, `-cf2`, `--skip-fields 2`), and `--` makes every word after it one.
 * @param {Word[]} args @param {Spec} spec
 */
function optionAfterOperand(args, spec) {
  let operand = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (operand) {
      if (t.startsWith("-") && t !== "-") return t;
    } else if (t === "--" || !t.startsWith("-") || t === "-") operand = true;
    else if (t.startsWith("--")) {
      if (!t.includes("=") && spec.longValues?.has(t.slice(2)) && !OPTIONAL_VALUE.has(t.slice(2))) i++;
    } else
      for (let j = 1; j < t.length; j++)
        if (spec.values?.includes(t[j])) {
          if (j === t.length - 1) i++;
          break;
        }
  }
  return null;
}
/** Long options whose value comes only after their `=` (`--group[=METHOD]`): the next word is no value of theirs. */
const OPTIONAL_VALUE = set("all-repeated", "group");

/** @type {Spec} tr, which reads its input alone: its operands are sets of characters */
const TR = { flags: "cCdst", long: set("complement", "delete", "squeeze-repeats", "truncate-set1") };

/** A program whose operands are all paths. @param {string} prog @param {Spec} spec */
const reader = (prog, spec) => (/** @type {Word[]} */ args, /** @type {Place} */ at) => {
  const p = parse(prog, args, spec);
  if (!("operands" in p)) return p;
  for (const w of p.operands) {
    const v = operand(w, at);
    if (!v.ok) return v;
  }
  return YES;
};
/**
 * Whether a searcher's options make it read every file below a folder, the hidden ones too: grep's `-r`; rg's
 * `--hidden`, `-.` and a second `-u` — rg's own walk passes over hidden names, a repository's `.git` and the credentials
 * folders named with a dot among them. In doubt (a letter that may be an option's value), yes.
 * @param {string} prog @param {Word[]} args
 */
function walksHidden(prog, args) {
  let unrestricted = 0;
  for (const { text } of args) {
    if (text === "--") break;
    if (!text.startsWith("-") || text === "-") continue;
    const letters = text.startsWith("--") ? "" : text.slice(1);
    if (prog === "grep" ? text === "--recursive" || letters.includes("r") : text === "--hidden" || letters.includes(".")) return true;
    unrestricted += text === "--unrestricted" ? 1 : letters.split("u").length - 1;
  }
  return prog === "rg" && unrestricted > 1;
}

/**
 * Why a search that reads every file below its folders (`walksHidden`) is no read for another machine's agents, or null:
 * a folder it starts from — each path it names, a glob's folder, else the folder it runs in — holds a repository's own
 * `.git` or a credentials folder somewhere below (fs-fence.js `holdsKept`), or more folders than are looked through here.
 * @param {string} prog @param {Word[]} paths  its path operands, each inside already (`operand`) @param {Place} at
 */
function walksIntoKept(prog, paths, at) {
  const bases = [at.root, ...at.reads.map((r) => r.dir)];
  const starts = paths
    .filter((w) => w.text !== "-")
    .map((w) => {
      const slash = Math.max(w.text.lastIndexOf("/"), at.gitBash ? w.text.lastIndexOf("\\") : -1);
      const from = place(!w.globs.length ? w.text : slash < 0 ? "." : w.text.slice(0, slash) || "/", at);
      return from.ok ? from.abs : null;
    });
  for (const dir of starts.length ? starts : [at.cwd]) {
    const held = dir ? holdsKept(dir, bases) : null;
    if (held === "many") return `${prog} reads every file below its folder, which holds too many folders to check here for one ${NOT_READ_BY_THEM}`;
    if (held) return `${prog} reads every file below its folder, and ${relative(at.realRoot, held.at) || held.at} there is in ${keptWords(held.kept)}, ${NOT_READ_BY_THEM}`;
  }
  return null;
}

/** A searcher: its first operand is the pattern unless an option gave it, or said there is none. @param {string} prog @param {Spec} spec */
const searcher = (prog, spec) => (/** @type {Word[]} */ args, /** @type {Place} */ at) => {
  const p = parse(prog, args, spec);
  if (!("operands" in p)) return p;
  const [pattern, ...rest] = p.operands;
  if (!p.patterned && pattern?.globs.length) return no(`${prog}'s pattern has an unquoted glob — quote it`);
  const paths = p.patterned ? p.operands : rest;
  for (const w of paths) {
    const v = operand(w, at);
    if (!v.ok) return v;
  }
  const kept = at.theirs && walksHidden(prog, args) ? walksIntoKept(prog, paths, at) : null;
  return kept ? no(kept) : YES;
};

/** sed's commands that only pick what it prints: print, the line's number, print unambiguously, delete, quit. */
const SED_PRINTS = "p=ldqQ";
/**
 * Whether a sed script only picks lines to print (`sed -n '1,80p'`): commands of `SED_PRINTS`, alone, each after an
 * address or a range — a line number, `$`, `first~step`, `/regex/` with I or M, a range's end `+N` or `~N` — and a
 * `!`, one to a `;` or a line. Never w, W, r, R, e or s (they write, read another file, run something), braces, a
 * comment, nor a command's own words.
 * @param {string} s @returns {Verdict}
 */
function printOnly(s) {
  const bad = no(`sed's script \`${s.length > 60 ? `${s.slice(0, 60)}…` : s}\` does more than pick lines to print: only line numbers, \`$\` and /regex/, their ranges, and p, =, l, d or q are known to only read`);
  let i = 0;
  const space = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  const digits = () => {
    const from = i;
    while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
    return i > from;
  };
  /** One address; `end`: the second of a range, which may be `+N` or `~N`. @param {boolean} end */
  const address = (end) => {
    if (end && (s[i] === "+" || s[i] === "~")) {
      i++;
      return digits();
    }
    if (s[i] === "$") {
      i++;
      return true;
    }
    if (s[i] === "/") {
      for (i++; i < s.length && s[i] !== "/"; i++) {
        if (s[i] === "\n") return false;
        if (s[i] === "\\") i++;
      }
      if (i >= s.length) return false;
      i++;
      while (s[i] === "I" || s[i] === "M") i++;
      return true;
    }
    if (!digits()) return false;
    if (!end && s[i] === "~") {
      i++;
      return digits();
    }
    return true;
  };
  let commands = 0;
  while (i < s.length) {
    space();
    if (s[i] === ";" || s[i] === "\n") {
      i++;
      continue;
    }
    if (i >= s.length) break;
    if (s[i] === "$" || s[i] === "/" || (s[i] >= "0" && s[i] <= "9")) {
      if (!address(false)) return bad;
      space();
      if (s[i] === ",") {
        i++;
        space();
        if (!address(true)) return bad;
        space();
      }
    }
    if (s[i] === "!") {
      i++;
      space();
    }
    if (i >= s.length || !SED_PRINTS.includes(s[i])) return bad;
    i++;
    commands++;
    space();
    if (i < s.length && s[i] !== ";" && s[i] !== "\n") return bad;
  }
  return commands ? YES : bad;
}

/**
 * The toolchains a version query may ask, each with its own version flags (HarnessV3-FailurePoints §8 item 4): the
 * program and one of them, nothing else.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const VERSIONS = Object.freeze({
  node: ["-v", "--version"],
  npm: ["-v", "--version"],
  npx: ["-v", "--version"],
  deno: ["-V", "--version"],
  bun: ["-v", "--version"],
  tsc: ["-v", "--version"],
  python: ["-V", "--version"],
  python3: ["-V", "--version"],
  pip: ["-V", "--version"],
  pip3: ["-V", "--version"],
  uv: ["-V", "--version"],
  ruby: ["-v", "--version"],
  java: ["-version", "--version"],
  javac: ["-version", "--version"],
  gcc: ["--version"],
  clang: ["--version"],
  make: ["--version"],
  cmake: ["--version"],
  docker: ["-v", "--version"],
  php: ["-v", "--version"],
  perl: ["-v", "--version"],
});
/** A toolchain's version query: the program and one of its version flags. @param {string} prog @param {Word[]} args @param {readonly string[]} flags @returns {Verdict} */
const versionQuery = (prog, args, flags) =>
  args.length === 1 && flags.includes(args[0].text) ? YES : no(`of ${prog}, only ${flags.map((f) => `\`${prog} ${f}\``).join(" and ")} ${flags.length === 1 ? "is" : "are"} known to only read`);

/** git's diff options that only shape what it prints: never --output, --ext-diff, -O (an order file) or --no-index. */
const GIT_DIFF_LONG = ["patch", "no-patch", "raw", "patch-with-raw", "patch-with-stat", "stat", "numstat", "shortstat", "dirstat", "compact-summary", "summary", "name-only", "name-status", "full-index", "binary", "abbrev", "minimal", "patience", "histogram", "find-renames", "find-copies", "find-copies-harder", "no-renames", "ignore-space-at-eol", "ignore-space-change", "ignore-all-space", "ignore-blank-lines", "ignore-cr-at-eol", "function-context", "text", "no-prefix", "color", "no-color", "color-moved", "word-diff", "check", "exit-code", "quiet", "relative", "no-relative", "no-ext-diff", "no-textconv", "irreversible-delete", "indent-heuristic", "no-indent-heuristic", "cc", "combined-all-paths"];
const GIT_DIFF_VALUES = ["unified", "stat", "dirstat", "abbrev", "diff-algorithm", "diff-filter", "word-diff", "word-diff-regex", "color", "color-moved", "find-renames", "find-copies", "relative", "src-prefix", "dst-prefix", "inter-hunk-context", "stat-width", "stat-name-width", "stat-count"];
/** git log's own, beside its diff options: what it walks, picks and prints. */
const GIT_LOG_LONG = ["oneline", "graph", "decorate", "no-decorate", "all", "branches", "tags", "remotes", "follow", "reverse", "no-merges", "merges", "first-parent", "abbrev-commit", "no-abbrev-commit", "parents", "children", "left-right", "boundary", "cherry", "cherry-pick", "cherry-mark", "left-only", "right-only", "topo-order", "date-order", "author-date-order", "simplify-by-decoration", "source", "regexp-ignore-case", "all-match", "invert-grep", "extended-regexp", "fixed-strings", "perl-regexp", "basic-regexp", "pretty", "relative-date", "full-history", "no-walk", "walk-reflogs", "use-mailmap", "no-use-mailmap", "notes", "no-notes", "full-diff", "log-size"];
const GIT_LOG_VALUES = ["max-count", "skip", "since", "after", "until", "before", "author", "committer", "grep", "format", "pretty", "date", "decorate", "decorate-refs", "decorate-refs-exclude", "branches", "tags", "remotes", "glob", "exclude", "min-parents", "max-parents", "encoding", "notes"];
/** @type {Spec} git log and git show */
const GIT_LOG = { flags: "pusRzBDMCWwbaimEFP", values: "nUSGl", count: true, long: set(...GIT_DIFF_LONG, ...GIT_LOG_LONG), longValues: set(...GIT_DIFF_VALUES, ...GIT_LOG_VALUES) };
/** @type {Spec} */
const GIT_DIFF = { flags: "pusRzBDMCWwba", values: "USGl", long: set(...GIT_DIFF_LONG, "cached", "staged", "merge-base"), longValues: set(...GIT_DIFF_VALUES) };
/** @type {Spec} */
const GIT_STATUS = {
  flags: "sbvuz",
  long: set("short", "branch", "porcelain", "long", "verbose", "untracked-files", "ignored", "column", "no-column", "ahead-behind", "no-ahead-behind", "renames", "no-renames", "show-stash", "ignore-submodules", "null"),
  longValues: set("porcelain", "untracked-files", "ignored", "column", "ignore-submodules", "find-renames"),
};
/** @type {Spec} */
const GIT_REV_PARSE = {
  flags: "q",
  long: set("verify", "quiet", "short", "abbrev-ref", "symbolic", "symbolic-full-name", "show-toplevel", "show-prefix", "show-cdup", "git-dir", "git-common-dir", "absolute-git-dir", "is-inside-git-dir", "is-inside-work-tree", "is-bare-repository", "is-shallow-repository", "show-superproject-working-tree", "show-object-format", "all", "branches", "tags", "remotes"),
  longValues: set("short", "abbrev-ref", "git-path", "branches", "tags", "remotes", "glob", "exclude", "since", "after", "until", "before", "path-format", "show-object-format", "disambiguate"),
};
/** @type {Spec} git branch, listing: never a name to make, move, copy or delete */
const GIT_BRANCH = {
  flags: "arlvi",
  long: set("list", "all", "remotes", "verbose", "ignore-case", "show-current", "color", "no-color", "column", "no-column", "merged", "no-merged", "contains", "no-contains", "omit-empty"),
  longValues: set("contains", "no-contains", "merged", "no-merged", "points-at", "sort", "format", "color", "column"),
};
/** git's reading forms. @type {Readonly<Record<string, Spec>>} */
const GIT_FORMS = Object.freeze({ status: GIT_STATUS, log: GIT_LOG, show: GIT_LOG, diff: GIT_DIFF, "rev-parse": GIT_REV_PARSE, branch: GIT_BRANCH });

/** The git folder a worktree's `.git` file names, as written; "" where it names none. @param {string} file */
const gitdirIn = (file) => /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(file, "utf8"))?.[1] || "";

/**
 * Whether git, run in `dir`, finds the working folder's own repository: in the working folder itself, which holds its
 * `.git` — a folder with its HEAD, or a worktree's file naming a git folder outside — or at the top of a worktree of
 * that repository the run reads (`ownWorktree`). Anywhere else git searches folders the agent could write for a
 * repository, and runs the commands its config names.
 * @param {Place} at @param {string} [dir]  where git runs: a `-C`'s folder, else where the command runs
 * @returns {Verdict}
 */
function repository(at, dir = at.cwd) {
  if (normCase(resolve(dir)) !== normCase(resolve(at.root))) {
    if (!at.reads.some((r) => normCase(r.dir) === normCase(resolve(dir)))) return no("git runs here only in the working folder itself: in another folder, files the agent wrote could pass for a repository, whose config names commands git runs");
    const own = repository(at, at.root);
    if (!own.ok) return own;
    return ownWorktree(resolve(dir), at) ? YES : no(`${dir} is no worktree of the working folder's own repository, by git's own records: there, files an agent wrote could pass for a repository, whose config names commands git runs`);
  }
  const dot = join(at.root, ".git");
  try {
    const st = lstatSync(dot);
    if (st.isDirectory()) return existsSync(join(dot, "HEAD")) ? YES : no(".git holds no HEAD: git would read the working folder itself as a repository");
    if (!st.isFile()) return no(".git is a link");
    const gitdir = gitdirIn(dot);
    if (!gitdir) return no(".git names no git folder");
    return reaches(resolve(at.root, gitdir), at) ? no(`.git names a git folder inside the working folder (${gitdir}), whose config the agent could write`) : YES;
  } catch {
    return no("the working folder holds no .git of its own: git would search the folders above it");
  }
}

/**
 * Whether `dir`, a folder the run reads, is the top of a worktree of the working folder's own repository by git's own
 * records (the owner's of 11-09), the working folder's having passed `repository`: its `.git` is that repository's git
 * folder itself — the main folder's — or a file naming a record in that folder's `worktrees`, whose `commondir` names
 * it and whose `gitdir` names this `.git` back, as `git worktree add` writes them. git there runs with the working
 * folder's own config, and the records it reads lie outside the working folder — or in its own `.git`, where a write
 * asks in every mode and a run that only reads makes none. Each by its real path, each with its HEAD: in doubt, no.
 * @param {string} dir @param {Place} at
 */
function ownWorktree(dir, at) {
  /** @param {string} a @param {string} b */
  const same = (a, b) => normCase(a) === normCase(b);
  /** The git folder a record's `commondir` names. @param {string} record */
  const commonOf = (record) => realpathSync(resolve(record, readFileSync(join(record, "commondir"), "utf8").trim()));
  try {
    // The working folder's git folder: its own `.git`, or the one its record's `commondir` names — never one inside
    // the working folder but its own `.git`.
    const own = join(at.root, ".git");
    let common = "";
    if (lstatSync(own).isDirectory()) common = realpathSync(own);
    else {
      const record = realpathSync(resolve(at.root, gitdirIn(own)));
      common = existsSync(join(record, "commondir")) ? commonOf(record) : record;
      if (reaches(common, at)) return false;
    }
    const dot = join(dir, ".git");
    const st = lstatSync(dot);
    if (st.isDirectory()) return same(realpathSync(dot), common) && existsSync(join(dot, "HEAD"));
    if (!st.isFile()) return false;
    const named = gitdirIn(dot);
    if (!named) return false;
    const record = realpathSync(resolve(dir, named));
    return (
      same(dirname(record), join(common, "worktrees")) &&
      existsSync(join(record, "HEAD")) &&
      same(commonOf(record), common) &&
      same(realpathSync(resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim())), realpathSync(dot))
    );
  } catch {
    return false;
  }
}

/** find's words that stand alone: operators, tests and actions that print. */
const FIND_PLAIN = set("(", ")", "!", ",", "-not", "-a", "-and", "-o", "-or", "-print", "-print0", "-prune", "-quit", "-ls", "-empty", "-true", "-false", "-readable", "-writable", "-executable", "-nouser", "-nogroup", "-depth", "-xdev", "-mount", "-noleaf", "-daystart");
/** find's words that take one value (a pattern, a number, a format; `-newer`'s is a path). Never -exec, -ok, -delete, -fprint, -fls, -L, -follow. */
const FIND_VALUE = set("-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex", "-regextype", "-type", "-size", "-mtime", "-mmin", "-atime", "-amin", "-ctime", "-cmin", "-perm", "-user", "-group", "-uid", "-gid", "-links", "-inum", "-maxdepth", "-mindepth", "-printf", "-newer");

/**
 * Filament's own command line (src/cli): the forms that only ask the Filament that runs what it is — over this machine's
 * loopback, the data folder its own default — and their flags that only shape the answer. Never one that changes it,
 * signs in or starts an agent (doctor), prints the key, or reads a config it would write (where); never `--data-dir`,
 * whose folder could name another address to call. Each form's words after its name: the list of their choices.
 * @type {Record<string, readonly (readonly string[])[]>}
 */
const FILAMENT_READS = Object.freeze({ status: [[]], models: [[]], chats: [[]], agents: [[], ["list"]], keys: [[], ["list"]], memory: [[], ["show"]] });
const FILAMENT_FLAGS = set("--json", "--help", "-h");

/**
 * Why Filament's own command line is no read for another machine's agents (an exec of their device, a chat they
 * started): it asks this machine's Filament over its loopback as this machine's person, with every right theirs lack —
 * the person's chats, settings, agents, keys and memory.
 */
const NOT_THEIRS = "Filament's command line asks this machine's Filament as its person, with rights another machine's agents do not have";

/** Filament's own command line's script: the one an agent's Environment names, run by this Node (app/agent/environment.js). */
const CLI_SCRIPT = fileURLToPath(new URL("../../../bin/filament.js", import.meta.url));

/**
 * Filament's command line as the agent's Environment names it, by its path (the review of 9fc83b83a: the line names a
 * path, and only the bare name was read): the installed app's `bin/filament` (its .cmd too), or this Node — by its path,
 * or `node` found on the PATH — on Filament's own script. Each a file outside the working folder, which the agent could
 * not have written. → the words after the program the CLI's rules read, and whether `node` is looked up; null where the
 * command is not it.
 * @param {Word} prog @param {Word[]} args @param {Place} at @returns {{ args: Word[], node: boolean } | null}
 */
function filamentByPath(prog, args, at) {
  const same = (/** @type {string} */ a, /** @type {string} */ b) => normCase(resolve(a)) === normCase(resolve(b));
  /** The file is there, and the agent could not have written it. @param {string} p */
  const outside = (p) => {
    try {
      return statSync(p).isFile() && !reaches(realpathSync(p), at);
    } catch {
      return false;
    }
  };
  const t = prog.text;
  if (process.versions.electron && /[\\/]/.test(t)) {
    const shim = join(dirname(process.execPath), "bin", "filament");
    if ((same(t, shim) || same(t, `${shim}.cmd`)) && outside(resolve(t))) return { args, node: false };
  }
  const script = args[0]?.text || "";
  if (!script || args[0].globs.length || !same(script, CLI_SCRIPT) || !outside(CLI_SCRIPT)) return null;
  if (t === "node") return { args: args.slice(1), node: true };
  if (/[\\/]/.test(t) && same(t, process.execPath) && outside(process.execPath)) return { args: args.slice(1), node: false };
  return null;
}

/**
 * `filament <form>`, a form that only reads, `filament help [form]`, `filament settings get <path>` or its version.
 * @param {Word[]} args @returns {Verdict}
 */
function filamentCli(args) {
  const glob = args.find((w) => w.globs.length);
  if (glob) return no(`filament ${glob.text}: an unquoted glob — quote it`);
  const words = args.map((w) => w.text);
  const flags = words.filter((w) => w.startsWith("-"));
  const [form, ...rest] = words.filter((w) => !w.startsWith("-"));
  if (!form) return flags.length && flags.every((f) => ["-v", "--version", "-h", "--help"].includes(f)) ? YES : no("filament with no command starts Filament");
  const bad = flags.find((f) => !FILAMENT_FLAGS.has(f));
  if (bad) return no(`filament ${bad}: of its flags, only --json and --help are read here`);
  const reads =
    form === "help" ? rest.length <= 1 : form === "settings" ? rest.length === 2 && rest[0] === "get" : Object.hasOwn(FILAMENT_READS, form) && FILAMENT_READS[/** @type {keyof typeof FILAMENT_READS} */ (form)].some((c) => c.length === rest.length && c.every((x, i) => x === rest[i]));
  return reads ? YES : no(`filament ${[form, ...rest].join(" ")} is not one of its forms that only read: status, models, chats, agents, keys, memory, settings get <path>, help`);
}

/** @type {Record<string, (args: Word[], at: Place) => Verdict>} */
const PROGRAMS = {
  ls: reader("ls", LS),
  cat: reader("cat", CAT),
  head: reader("head", HEAD),
  tail: reader("tail", HEAD),
  wc: reader("wc", WC),
  du: reader("du", DU),
  grep: searcher("grep", GREP),
  rg: searcher("rg", RG),
  cut: reader("cut", CUT),
  sort: reader("sort", SORT),
  // Its input, if named, is its one operand: a second is the file it writes. BSD's uniq (macOS) reads no option after
  // its first operand: one there is that second operand.
  uniq(args, at) {
    const after = optionAfterOperand(args, UNIQ);
    if (after) return no(`uniq ${after}: an option after its input — put it before`);
    const p = parse("uniq", args, UNIQ);
    if (!("operands" in p)) return p;
    if (p.operands.length > 1) return no(`uniq ${p.operands[1].text}: uniq's second operand is a file it writes`);
    return p.operands.length ? operand(p.operands[0], at) : YES;
  },
  // Its sets are characters, never paths; a glob in one is the shell reading a folder: quoted, it is a set.
  tr(args) {
    const p = parse("tr", args, TR);
    if (!("operands" in p)) return p;
    if (!p.operands.length || p.operands.length > 2) return no("tr takes one set or two");
    const starred = p.operands.find((w) => w.globs.length);
    return starred ? no(`tr ${starred.text}: a set with an unquoted glob — quote it`) : YES;
  },
  // Its script is its first operand, unless `-e` gave it; each picks lines to print (`printOnly`).
  sed(args, at) {
    const p = parse("sed", args, SED);
    if (!("operands" in p)) return p;
    const [first, ...rest] = p.operands;
    if (!p.patterned && !first) return no("sed with no script");
    if (!p.patterned && first.globs.length) return no("sed's script has an unquoted glob — quote it");
    for (const script of p.patterned ? p.patterns : [first.text]) {
      const v = printOnly(script);
      if (!v.ok) return v;
    }
    for (const w of p.patterned ? p.operands : rest) {
      const v = operand(w, at);
      if (!v.ok) return v;
    }
    return YES;
  },
  find(args, at) {
    let i = 0;
    // Its starting points come first: paths, until the expression begins. One that starts with `-` is read as the
    // expression, so a glob may not start one.
    for (; i < args.length && !args[i].text.startsWith("-") && !FIND_PLAIN.has(args[i].text); i++) {
      if (args[i].globs[0] === 0) return no(`find ${args[i].text}: a glob that starts a word can expand into an expression`);
      const v = operand(args[i], at);
      if (!v.ok) return v;
    }
    for (; i < args.length; i++) {
      const t = args[i].text;
      if (args[i].globs.length) return no(`find ${t}: an unquoted glob — quote find's patterns`);
      if (FIND_PLAIN.has(t)) continue;
      if (!FIND_VALUE.has(t)) return no(`find ${t} is not a word known to only read`);
      const v = args[++i];
      if (!v) return no(`find ${t} needs a value`);
      if (v.globs.length) return no(`find ${t}: an unquoted glob — quote find's patterns`);
      if (t === "-newer") {
        const p = place(v.text, at);
        if (!p.ok) return p;
      }
    }
    return YES;
  },
  pwd: (args) => (args.every((w) => w.text === "-L" || w.text === "-P") ? YES : no("pwd takes -L or -P only")),
  ...Object.fromEntries(Object.entries(VERSIONS).map(([prog, flags]) => [prog, (/** @type {Word[]} */ args) => versionQuery(prog, args, flags)])),
  git(args, at) {
    if (args.length === 1 && args[0].text === "--version") return YES;
    let i = 0;
    // Where git runs: the folder one `-C` names, read from where the command runs (`repository` says which may), its
    // operands read from there; else where the command runs.
    let there = at;
    for (; ; i++) {
      const t = args[i]?.text;
      if (t === "--no-pager") continue;
      if (t !== "-C") break;
      if (there !== at) return no("git -C twice before its form: one is read here");
      const w = args[++i];
      if (!w?.text || w.globs.length) return no("git -C before its form takes one folder, named");
      const p = place(w.text, at);
      if (!p.ok) return no(`git -C before its form: ${p.why}`);
      there = { ...at, cwd: p.abs };
    }
    const form = args[i]?.text ?? "";
    if (form.startsWith("-")) return no(`git ${form} before its form: only --no-pager is read here, and one -C to the working folder or a worktree of its repository that the run reads — -c, --git-dir and their like change the repository or the config it runs with`);
    if (!Object.hasOwn(GIT_FORMS, form)) return no(form ? `git ${form} is not one of git's reading forms: status, log, diff, show, rev-parse, branch --list` : "git with no form");
    const repo = repository(there);
    if (!repo.ok) return repo;
    const rest = args.slice(i + 1);
    const p = parse(`git ${form}`, rest, GIT_FORMS[form]);
    if (!("operands" in p)) return p;
    if (form === "branch") {
      // Listing only: with a name and no --list, git branch makes one. Its operands are patterns, never paths.
      if (!rest.some((w) => w.text === "--list" || /^-[a-z]*l[a-z]*$/.test(w.text))) return no("git branch lists only with --list: with a name, it makes a branch");
      const glob = p.operands.find((w) => w.globs.length);
      return glob ? no(`git branch ${glob.text}: a pattern with an unquoted glob — quote it`) : YES;
    }
    for (const w of p.operands) {
      const v = operand(w, there);
      if (!v.ok) return v;
    }
    return YES;
  },
  // echo prints its words; a word with a glob is still the shell reading a folder. Its options only shape the output,
  // so a name it expands into one does no harm.
  echo(args, at) {
    let i = 0;
    while (i < args.length && /^-[neE]+$/.test(args[i].text)) i++;
    for (const w of args.slice(i))
      if (w.globs.length) {
        const v = glob(w, at);
        if (!v.ok) return v;
      }
    return YES;
  },
  filament: filamentCli,
};

/**
 * `cd <folder>`, first and before the commands it runs in: one folder, inside the working folder or a folder added to
 * it, with no link on the way (a later path's leading `..` is read by its letters from it). A pipe runs it apart from what follows, which stays in the working
 * folder. A CDPATH could land it elsewhere.
 * @param {Word[]} args @param {number} k @param {string[]} seps @param {Record<string, string | undefined>} env @param {Place} at
 * @returns {Verdict}
 */
function cd(args, k, seps, env, at) {
  if (k !== 0 || !seps[0]) return no("`cd` only first, before the commands it runs in: `cd <folder> && …`");
  if (seps[0] === "|") return no("a `cd` piped into a command does not move it");
  if (Object.keys(env).some((x) => (at.gitBash ? x.toUpperCase() : x) === "CDPATH")) return no("a CDPATH is set, and `cd` could land elsewhere");
  if (args.length !== 1 || args[0].globs.length || args[0].text.startsWith("-")) return no("`cd` takes one folder, named");
  const p = place(args[0].text, at);
  if (!p.ok) return p;
  let real = "";
  try {
    real = realpathSync(p.abs);
  } catch {
    return no(`cd ${args[0].text}: no such folder`);
  }
  const base = [{ dir: resolve(at.root), real: at.realRoot }, ...at.reads].find((b) => within(p.abs, b.dir));
  if (!base || normCase(real) !== normCase(join(base.real, relative(base.dir, p.abs)))) return no(`cd ${args[0].text}: a link on the way`);
  at.cwd = p.abs;
  return YES;
}

/**
 * The folder a call names for its command to run in (Antigravity's `Cwd`), as `cd` takes one: inside the working folder
 * or a folder added to it, there, and reached through no link — another machine's agents' never a repository's own
 * `.git` or a credentials folder (`place`). The command's paths are read from it.
 * @param {string} folder @param {Place} at @returns {Verdict}
 */
function runsIn(folder, at) {
  const p = place(folder, at);
  if (!p.ok) return no(`it runs in ${folder}, and ${p.why}`);
  let real = "";
  try {
    real = realpathSync(p.abs);
  } catch {
    return no(`it runs in ${folder}, which is not there`);
  }
  const base = [{ dir: resolve(at.root), real: at.realRoot }, ...at.reads].find((b) => within(p.abs, b.dir));
  if (!base || normCase(real) !== normCase(join(base.real, relative(base.dir, p.abs)))) return no(`it runs in ${folder}, reached through a link`);
  at.cwd = p.abs;
  return YES;
}

/** A PATH entry as a searched folder: an absolute one, or the note that stops the search there. @param {string} d @param {boolean} gitBash @returns {Searched} */
function entry(d, gitBash) {
  if (gitBash && /^[\\/]{2}/.test(d)) return { dir: d, note: "a network folder, not touched here" };
  if (gitBash ? /^[A-Za-z]:[\\/]/.test(d) : d.startsWith("/")) return { dir: d };
  return { dir: d || "an empty entry", note: d ? "relative to the folder a command runs in" : "the folder a command runs in" };
}

/**
 * The folders the shell searches for a program, in its order. Git Bash: its own two, $HOME\bin (the launcher takes
 * HOME, else HOMEDRIVE and HOMEPATH, else USERPROFILE — each is searched here), then the Windows PATH, whose empty
 * entries it drops. Elsewhere the PATH, or bash's own when there is none.
 * @param {Record<string, string | undefined>} env @param {import("./shell.js").Shell} shell @returns {Searched[]}
 */
function searchPath(env, shell) {
  if (shell.kind !== "git-bash") return String(env.PATH ?? BASH_DEFAULT_PATH).split(":").map((d) => entry(d, false));
  const git = dirname(dirname(shell.file));
  /** A POSIX path as Git Bash reads it: /c/… is the drive, any other /… is under Git's own folder. @param {string} p */
  const fromMsys = (p) => (/^\/[A-Za-z](\/|$)/.test(p) ? `${p[1]}:/${p.slice(3)}` : p.startsWith("/") ? join(git, p) : p);
  /** @param {string} name */
  const all = (name) => Object.keys(env).filter((k) => k.toUpperCase() === name).map((k) => String(env[k] ?? ""));
  const homes = [...all("HOME"), ...all("HOMEDRIVE").flatMap((d) => all("HOMEPATH").map((p) => d + p)), ...all("USERPROFILE")].filter(Boolean);
  return [
    { dir: join(git, "mingw64", "bin") },
    { dir: join(git, "usr", "bin") },
    ...homes.map((h) => entry(join(fromMsys(h), "bin"), true)),
    ...all("PATH")
      .flatMap((p) => p.split(";"))
      .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean)
      .map((d) => entry(fromMsys(d), true)),
  ];
}

/**
 * Why the shell could run something other than the program under `prog`'s name, or null. It searches `dirs` in order,
 * and one the agent could write to — or one that moves, or is not touched — asks unless the program was surely found
 * before it: an executable file of that name (Git Bash: the name, or `<name>.exe`) whose real path is outside. In doubt
 * the search goes on. Not found at all, bash says so and nothing runs — but a program that `must` be found (a toolchain,
 * git: HarnessV3-FailurePoints §8 item 4) asks then, and at a name standing on the way that Filament can't read, as a
 * Windows app alias is: the shell may run it, and it may open the Store.
 * @param {string} prog @param {Searched[]} dirs @param {Place} at @param {boolean} [must] @returns {string | null}
 */
function lookUp(prog, dirs, at, must = false) {
  for (const s of dirs) {
    const note = s.note || (reaches(s.dir, at) ? "inside the working folder" : "");
    if (note) return `the PATH searches ${s.dir} (${note}) before it finds ${prog}`;
    for (const name of at.gitBash ? [prog, `${prog}.exe`] : [prog]) {
      const file = join(s.dir, name);
      /** @type {import("node:fs").Stats} */
      let st;
      try {
        st = statSync(file);
      } catch (/** @type {any} */ e) {
        if (must && e?.code !== "ENOENT" && e?.code !== "ENOTDIR") return `${file} stands on the PATH before any ${prog} Filament can read`;
        continue;
      }
      if (!st.isFile()) continue;
      let real = "";
      try {
        if (!at.gitBash) accessSync(file, constants.X_OK);
        real = realpathSync(file);
      } catch {
        if (must) return `${file} stands on the PATH before any ${prog} Filament can read`;
        continue;
      }
      return reaches(real, at) ? `${prog} is ${file}, which leads into the working folder` : null;
    }
  }
  return must ? `${prog} is not found on the PATH` : null;
}

/**
 * Whether `command` only reads, run by `shell` in the working folder `root` with `env` (the hands' `safeEnv()`):
 * yes, or no with the reason. Anything this reader cannot read is a no. `reads`: the folders added to the working
 * folder, where a path it reads may land too — a run that only reads, its repository's worktrees among them, where git's
 * reading forms run too. `agentsDevice`: the command runs for another machine's agents — an exec of their device
 * (http/admin/exec.js), a chat they started —, for whom Filament's own command line is no read (`NOT_THEIRS`), nor a
 * path in a repository's own `.git` or a credentials folder, named or searched through (`NOT_READ_BY_THEM`). `cwd`: the
 * folder the command runs in where its call names another than the working folder (Antigravity's `Cwd`), read as a
 * `cd` to it is (`runsIn`): its paths are read from there.
 * @param {string} command
 * @param {{ root: string, shell: import("./shell.js").Shell, env?: Record<string, string | undefined>, reads?: readonly string[], agentsDevice?: boolean, cwd?: string | null }} o
 * @returns {Verdict}
 */
export function readOnlyCommand(command, { root, shell, env = {}, reads = [], agentsDevice = false, cwd = null }) {
  if (!BASHES.has(shell.kind)) return no(`${shell.name} is not a bash: its syntax is not read here`);
  let realRoot = "";
  try {
    realRoot = realpathSync(root);
  } catch {
    return no("the working folder does not exist");
  }
  const lexed = lex(String(command ?? ""));
  if (!("commands" in lexed)) return lexed;
  const { commands, seps } = lexed;
  // A trailing `;` or line break ends the last command; it starts none.
  if (commands.length > 1 && !commands[commands.length - 1].length && seps[seps.length - 2] === ";") {
    commands.pop();
    seps.pop();
    seps[seps.length - 1] = "";
  }
  /** @type {Place} */
  const at = { root, realRoot, cwd: resolve(root), gitBash: shell.kind === "git-bash", reads: readsAt(reads), theirs: agentsDevice };
  if (cwd) {
    const v = runsIn(cwd, at);
    if (!v.ok) return v;
  }
  /** Where the command starts: a `cd` that fails leaves the rest there. */
  const start = at.cwd;
  /** Where the rest runs too when a `cd` it is not tied to fails, and that cd's folder as written. @type {{ at: Place, folder: string } | null} */
  let failed = null;
  /** @type {Set<string>} */
  const looked = new Set();
  for (const [k, words] of commands.entries()) {
    if (!words.length) return no(commands.length === 1 ? "no command" : "an empty command");
    const [prog, ...args] = words;
    if (prog.text.includes("=")) return no("a variable set before the program");
    if (prog.text === "cd") {
      const v = cd(args, k, seps, env, at);
      if (!v.ok) return v;
      // Tied by `&&` and then only `&&` and `|`, nothing runs if the cd fails.
      if (seps[0] !== "&&" || seps.slice(1, -1).some((s) => s !== "&&" && s !== "|")) failed = { at: { ...at, cwd: start }, folder: args[0].text };
      continue;
    }
    // Filament's own command line, as the agent's Environment names it: by its path.
    const cli = filamentByPath(prog, args, at);
    if (agentsDevice && (cli || prog.text === "filament")) return no(NOT_THEIRS);
    if (cli) {
      const v = filamentCli(cli.args);
      if (!v.ok) return v;
      if (cli.node) looked.add("node");
      continue;
    }
    // A word with a glob keeps the glob's characters, which no program's name holds: it is refused here too.
    if (!Object.hasOwn(PROGRAMS, prog.text)) return no(`\`${prog.text}\` is not one of the programs known to only read`);
    const v = PROGRAMS[prog.text](args, at);
    if (!v.ok) return v;
    if (failed) {
      const there = PROGRAMS[prog.text](args, failed.at);
      if (!there.ok) return no(`if \`cd ${failed.folder}\` fails, the rest runs in ${cwd ? "the folder its call names" : "the working folder"}, and there ${there.why}`);
    }
    if (!BUILTINS.has(prog.text)) looked.add(prog.text);
  }
  const dirs = looked.size ? searchPath(env, shell) : [];
  for (const prog of looked) {
    const why = lookUp(prog, dirs, at, prog === "git" || prog === "filament" || Object.hasOwn(VERSIONS, prog));
    if (why) return no(why);
  }
  return YES;
}
