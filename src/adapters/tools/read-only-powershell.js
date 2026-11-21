// @ts-check
// Which PowerShell scripts only read (HarnessV4_Tasks C10): the reader of read-only commands (read-only-commands.js),
// for PowerShell — the `powershell` hand's scripts, Claude Code's PowerShell tool, and the script Codex hands to
// `powershell.exe -Command` on Windows, where every `Get-Content` asked. As careful as bash's: what it cannot read
// asks, as every script did before, and the question or the refusal says why.
// - The syntax: words; '…' (with '' for a quote); "…" holding no `$`; `;`, line breaks, `|`, `&&` and `||` between
//   commands; output only into $null (`>`, `2>`, `*>`) or the success stream (`2>&1`). Nothing else: no variable, no
//   backtick, no parenthesis, brace or comma, no `@` or `#` starting a word, no lone `&`, no quote inside a word, and
//   no typographic quote or dash, which PowerShell reads as the plain one.
// - The commands: a table of cmdlets that read files, list folders or shape what a pipeline carries, by their whole
//   names and — on Windows, where PowerShell's aliases come before any program — their built-in aliases. No program:
//   how PowerShell hands a program its arguments is another language again.
// - The parameters: each cmdlet's own, by their whole names (PowerShell takes any prefix nothing else shares, which
//   only it can tell), never joined to a value by a colon. None that waits (`-Wait`), reads another stream of a file
//   or follows links.
// - The paths: inside the working folder through the hands' fence (real paths: a link that leads out asks), with a
//   drive letter or nothing before them — no provider's drive (`Env:`, `HKLM:`), no `~`, no share or device. `..` only
//   at a path's start. A wildcard only in the last part, in a folder that holds no link: `-Path` reads wildcards inside
//   quotes too, and the cmdlet picks the names.
// - The pipeline: a cmdlet that takes paths comes first in it — what it would be handed is not followed here.
// - A listing: what it lists holds no link that leads outside (the whole tree, where it recurses: Windows PowerShell
//   follows a folder's link, and a listing piped on is read file by file).
// - What PowerShell loads by itself: the folders it takes your profile and its modules from, and the program itself,
//   are out of the agent's reach — nothing in the working folder.
// - For another machine's agents (`agentsDevice`): no path in a repository's own `.git` or in a credentials folder
//   inside their folder, as bash's reader keeps it (read-only-commands.js `NOT_READ_BY_THEM`), and no listing piped on
//   — read file by file — that starts in one or, where it recurses, holds one.
import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { holdsKept, keptFromAgents, keptWords, resolveInside } from "./fs-fence.js";
import { DEVICE, NOT_READ_BY_THEM, outsideWords, reaches, readsAt, within } from "./read-only-commands.js";

/** @typedef {import("./read-only-commands.js").Verdict} Verdict */
/** A word as the cmdlet receives it; `quoted` when it was written in quotes (never a parameter's name). @typedef {{ text: string, quoted: boolean }} Word */
/** Where the script stands: the working folder (and its real path), the folder it runs in, whether this is Windows,
 * the folders added to it that a read may also land in, and whether it runs for another machine's agents (`theirs`).
 * @typedef {{ root: string, realRoot: string, cwd: string, win: boolean, reads: readonly import("./read-only-commands.js").Added[], theirs: boolean }} Place */
/** What a parameter's value is: a path that may hold wildcards, a path read by its letters, any text, a count, or one of a few words. @typedef {"path" | "literal" | "text" | "int" | readonly string[]} Kind */
/**
 * What a cmdlet may take: `switches` alone, `values` each with one value, `alias` other names of either, `positional`
 * the valued parameters words without a name fill in order, `rest` when every further such word is text. `paths`: it
 * takes paths, so it comes first in its pipeline; `needs`: it asks for a path when given none. `lists`: it lists
 * folders (`leadsOut`).
 * @typedef {{ switches?: readonly string[], values?: Readonly<Record<string, Kind>>, alias?: Readonly<Record<string, string>>,
 *   positional?: readonly string[], rest?: boolean, paths?: boolean, needs?: boolean, lists?: boolean }} Spec
 */

/** @type {Verdict} */
const YES = Object.freeze({ ok: true });
/** A path as this system compares it: Windows does not tell a capital from a small letter. @param {string} p */
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
/** @param {string} why @returns {{ ok: false, why: string }} */
const no = (why) => ({ ok: false, why });

/** The quotes and dashes PowerShell reads as the plain ones: a word this reader took whole could end, or name a parameter, there. */
const TYPOGRAPHIC = /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2013\u2014\u2015]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085]/;
/** What an unquoted character outside the syntax above means — each asks. @type {Record<string, string>} */
const OUTSIDE = {
  $: "a `$` (a variable or a sub-expression)",
  "(": "a parenthesis (an expression)",
  ")": "a parenthesis (an expression)",
  "{": "a brace (a script block)",
  "}": "a brace (a script block)",
  "<": "a `<`",
  ",": "a comma (a list of values) — one value at a time is read here",
};
/** What may follow a closing quote, or the `1` of `2>&1`: the word's end. */
const WORD_END = /^$|^[ \t\n;|&>]/;
/** The folders one recursive listing may hold before this reader stops walking them: the walk holds Filament up. */
const TREE_MAX = 20_000;

/**
 * The script as PowerShell splits it: its commands, each a list of words, and what joins each to the next ("" after
 * the last). Redirections into $null and into the success stream are read and dropped; anything outside the syntax is
 * a refusal.
 * @param {string} text
 * @returns {{ commands: Word[][], seps: string[] } | { ok: false, why: string }}
 */
function lex(text) {
  if (text.includes("`")) return no("a backtick (PowerShell's escape)");
  if (TYPOGRAPHIC.test(text)) return no("a typographic quote or dash, which PowerShell reads as the plain one");
  if (CONTROL.test(text)) return no("a control character");
  const src = text.replace(/\r\n/g, "\n");
  if (src.includes("\r")) return no("a carriage return");
  /** @type {Word[][]} */
  const commands = [];
  /** @type {string[]} */
  const seps = [];
  /** @type {Word[]} */
  let words = [];
  /** @type {Word | null} */
  let w = null;
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
    // A line break right after a `|`, `&&` or `||` goes on with the pipeline.
    else if (c === "\n" && !w && !words.length && commands.length && seps[seps.length - 1] !== ";") continue;
    else if (c === "\n" || c === ";") endCommand(";");
    else if (c === "|") {
      const or = src[i + 1] === "|";
      endCommand(or ? "||" : "|");
      if (or) i++;
    } else if (c === "&") {
      if (src[i + 1] !== "&") return no("an `&` (the call operator, or a job in the background)");
      endCommand("&&");
      i++;
    } else if (c === ">") {
      // The stream is one character alone before the `>`: 1 to 6, or `*` for all of them.
      const before = /** @type {Word | null} */ (w);
      if (before && !before.quoted && /^[1-6*]$/.test(before.text)) w = null;
      else endWord();
      if (src[i + 1] === ">") i++;
      if (src[i + 1] === "&") {
        if (src[i + 2] !== "1" || !WORD_END.test(src.slice(i + 3, i + 4))) return no("a redirection other than into the success stream (`2>&1`)");
        i += 2;
        continue;
      }
      let j = i + 1;
      while (src[j] === " " || src[j] === "\t") j++;
      const m = /^\$null(?=$|[ \t\n;|&])/i.exec(src.slice(j));
      if (!m) return no("output into a file: only $null keeps nothing");
      i = j + m[0].length - 1;
    } else if (c === "'" || c === '"') {
      if (w) return no("a quote inside a word");
      let j = i + 1;
      let inner = "";
      for (; ; j++) {
        if (j >= src.length) return no("an unclosed quote");
        if (src[j] === c) {
          // The quote doubled is the quote itself.
          if (src[j + 1] !== c) break;
          j++;
        } else if (c === '"' && src[j] === "$") return no("a `$` inside double quotes");
        inner += src[j];
      }
      if (!WORD_END.test(src.slice(j + 1, j + 2))) return no("a quote inside a word");
      words.push({ text: inner, quoted: true });
      i = j;
    } else if (Object.hasOwn(OUTSIDE, c)) return no(OUTSIDE[c]);
    else if (!w && (c === "#" || c === "@")) return no(c === "#" ? "a comment" : "an `@` that starts a word (a list, a table or a splat)");
    // Past ASCII, letters and digits alone: PowerShell reads other spaces as spaces, and other marks as its own.
    else if (c > "\u007f" && !/[\p{L}\p{N}\p{M}]/u.test(c)) return no("a character that is no plain letter, outside quotes");
    else (w ||= { text: "", quoted: false }).text += c;
  }
  endCommand("");
  return { commands, seps };
}

/**
 * Where a path a cmdlet reads lands, when that is inside the working folder or a folder added to it.
 * @param {string} text @param {Place} at
 * @returns {{ ok: true, abs: string } | { ok: false, why: string }}
 */
function place(text, at) {
  if (!text) return no("an empty path");
  if (text.startsWith("~")) return no(`${text} starts at a home folder`);
  if (/^[\\/]{2}/.test(text)) return no(`${text} is a share or a device`);
  const drive = at.win && /^[A-Za-z]:/.test(text);
  if (drive && !/^[A-Za-z]:[\\/]/.test(text)) return no(`${text} names a drive's current folder`);
  if ((drive ? text.slice(2) : text).includes(":")) return no(`${text}: a \`:\` names a provider's drive, or another stream of a file`);
  if (!at.win && text.includes("\\")) return no(`${text}: a backslash, which PowerShell reads as a separator and this system as a letter`);
  let named = false;
  for (const [n, part] of text.split(/[\\/]+/).entries()) {
    if (part === "..") {
      if (named) return no(`\`..\` after a name in ${text}: the system resolves it through links`);
      continue;
    }
    if (!part || part === "." || (n === 0 && drive)) continue;
    if (DEVICE.test(part.split(".")[0].trimEnd())) return no(`${text} names a Windows device`);
    if (at.win && /[. ]$/.test(part)) return no(`${text}: a name that ends in a dot or a space, which Windows drops`);
    named = true;
  }
  const abs = resolve(at.cwd, text);
  try {
    resolveInside(at.root, abs, { reads: at.reads.map((r) => r.dir), theirs: at.theirs });
  } catch (/** @type {any} */ e) {
    if (e?.kept) return no(`${text} is in ${keptWords(e.kept)}, ${NOT_READ_BY_THEM}`);
    return no(`${text} ${/link/.test(String(e?.message)) ? "reaches outside the working folder through a link" : `is ${outsideWords(at)}`}`);
  }
  return { ok: true, abs };
}

/** PowerShell's wildcards: a `-Path` reads them wherever they stand, quoted or not. */
const WILD = /[*?[\]]/;

/**
 * A path with wildcards: in its last part only, in a folder inside that holds no link, since the cmdlet picks the
 * names. The folder, for a listing to walk.
 * @param {string} text @param {Place} at
 * @returns {{ ok: true, abs: string } | { ok: false, why: string }}
 */
function wild(text, at) {
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  if (WILD.test(text.slice(0, cut + 1))) return no(`a wildcard before the last part of ${text}`);
  // `\*` and `C:\*` keep their root's separator.
  const folder = place(cut < 0 ? "." : cut === 0 || text[cut - 1] === ":" ? text.slice(0, cut + 1) : text.slice(0, cut), at);
  if (!folder.ok) return folder;
  try {
    if (readdirSync(realpathSync(folder.abs), { withFileTypes: true }).some((d) => d.isSymbolicLink())) return no(`${text}: its folder holds a link, and the wildcard may pick it`);
  } catch {
    return no(`${text}: its folder cannot be read`);
  }
  return folder;
}

/**
 * Why a listing of `dir` could leave the working folder, or null: an entry that is a link leading outside it and the
 * folders added to it — in the folder itself, or anywhere below it when `deep` (a recursive listing; a link that stays
 * inside is followed, as Windows PowerShell follows it). A listing shows a link by its own name, but one piped on is read file by file, and
 * a recursion walks into it. A folder that is not there, or is a file, lists nothing more.
 * The walk holds real paths only: the folder's own, resolved once, and below it a folder's name joined to its real
 * parent — real already, as the listing says it is no link — or a link's target, resolved. Resolving each folder
 * again looked at every folder above it, for every one of up to TREE_MAX folders, while all of Filament waited.
 * @param {string} dir @param {Place} at @param {boolean} deep
 */
function leadsOut(dir, at, deep) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const todo = [];
  try {
    todo.push(realpathSync(dir));
  } catch {
    return null;
  }
  while (todo.length) {
    const real = /** @type {string} */ (todo.pop());
    if (seen.has(real)) continue;
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(real, { withFileTypes: true });
    } catch {
      continue;
    }
    seen.add(real);
    if (seen.size > TREE_MAX) return `it lists more than ${TREE_MAX.toLocaleString("en-US")} folders, too many to check here for a link that leads outside`;
    for (const e of entries) {
      const p = join(real, e.name);
      if (e.isSymbolicLink()) {
        let to = "";
        try {
          to = realpathSync(p);
        } catch {
          continue; // a link to nothing reads nothing
        }
        if (!within(to, at.realRoot) && !at.reads.some((r) => within(to, r.real))) return `${relative(at.realRoot, p) || p} is a link that leads ${outsideWords(at)}`;
        try {
          if (deep && statSync(to).isDirectory()) todo.push(to);
        } catch {}
      } else if (deep && e.isDirectory()) todo.push(p);
    }
  }
  return null;
}

/**
 * Why a listing of `dir` piped on would hand another machine's agents a file they never read, or null: the folder is in
 * a repository's own `.git` or a credentials folder, or — `deep` — its tree holds one, or more folders than are looked
 * through here (fs-fence.js `holdsKept`).
 * @param {string} dir @param {Place} at @param {boolean} deep
 */
function keptIn(dir, at, deep) {
  const bases = [at.root, ...at.reads.map((r) => r.dir)];
  const own = keptFromAgents(dir, bases);
  if (own) return `it lists ${keptWords(own)}, ${NOT_READ_BY_THEM}`;
  const held = deep ? holdsKept(dir, bases) : null;
  if (held === "many") return `it lists too many folders to check here for one ${NOT_READ_BY_THEM}`;
  return held ? `it lists ${relative(at.realRoot, held.at) || held.at}, in ${keptWords(held.kept)}, ${NOT_READ_BY_THEM}` : null;
}

/** What every cmdlet takes beside its own: how it goes on after an error. */
const COMMON = Object.freeze({ erroraction: /** @type {Kind} */ (["silentlycontinue", "continue", "stop", "ignore"]) });
const COMMON_ALIAS = Object.freeze({ ea: "erroraction" });

/** The cmdlets known to only read, by their names in small letters. Never `-Wait`, `-Stream`, `-Credential`, `-FollowSymlink`. @type {Readonly<Record<string, Spec & { name: string }>>} */
const CMDLETS = Object.freeze({
  "get-content": {
    name: "Get-Content",
    switches: ["raw", "force", "asbytestream"],
    values: { path: "path", literalpath: "literal", totalcount: "int", tail: "int", readcount: "int", encoding: "text", delimiter: "text", filter: "text", include: "text", exclude: "text" },
    alias: { first: "totalcount", head: "totalcount", last: "tail" },
    positional: ["path"],
    paths: true,
    needs: true,
  },
  "get-childitem": {
    name: "Get-ChildItem",
    switches: ["recurse", "force", "name", "file", "directory", "hidden", "readonly", "system"],
    values: { path: "path", literalpath: "literal", filter: "text", include: "text", exclude: "text", depth: "int" },
    positional: ["path", "filter"],
    paths: true,
    lists: true,
  },
  "get-item": { name: "Get-Item", switches: ["force"], values: { path: "path", literalpath: "literal" }, positional: ["path"], paths: true, needs: true },
  "test-path": { name: "Test-Path", switches: ["isvalid"], values: { path: "path", literalpath: "literal", pathtype: ["any", "container", "leaf"] }, positional: ["path"], paths: true, needs: true },
  "resolve-path": { name: "Resolve-Path", switches: ["relative"], values: { path: "path", literalpath: "literal" }, positional: ["path"], paths: true, needs: true },
  "get-location": { name: "Get-Location" },
  // Its paths are read when it names them; without, it searches what the pipeline carries.
  "select-string": {
    name: "Select-String",
    switches: ["simplematch", "casesensitive", "quiet", "list", "notmatch", "allmatches", "raw", "noemphasis"],
    values: { pattern: "text", path: "path", literalpath: "literal", context: "int", encoding: "text", include: "text", exclude: "text" },
    positional: ["pattern", "path"],
  },
  "select-object": {
    name: "Select-Object",
    switches: ["unique"],
    values: { property: "text", expandproperty: "text", excludeproperty: "text", first: "int", last: "int", skip: "int", skiplast: "int", index: "int" },
    positional: ["property"],
  },
  "measure-object": { name: "Measure-Object", switches: ["line", "word", "character", "sum", "average", "maximum", "minimum", "ignorewhitespace", "allstats", "standarddeviation"], values: { property: "text" }, positional: ["property"] },
  "sort-object": { name: "Sort-Object", switches: ["descending", "unique", "casesensitive", "stable"], values: { property: "text", top: "int", bottom: "int" }, positional: ["property"] },
  "format-table": { name: "Format-Table", switches: ["autosize", "wrap", "hidetableheaders", "force"], values: { property: "text", groupby: "text" }, positional: ["property"] },
  "format-list": { name: "Format-List", switches: ["force"], values: { property: "text", groupby: "text" }, positional: ["property"] },
  "out-string": { name: "Out-String", switches: ["stream", "nonewline"], values: { width: "int" } },
  "out-null": { name: "Out-Null" },
  "out-host": { name: "Out-Host" },
  "write-output": { name: "Write-Output", switches: ["noenumerate"], rest: true },
  "write-host": { name: "Write-Host", switches: ["nonewline"], values: { foregroundcolor: "text", backgroundcolor: "text", separator: "text" }, rest: true },
});

/** PowerShell's built-in aliases of them on Windows, where an alias is found before any program of its name. */
const ALIASES = Object.freeze({
  gc: "get-content", cat: "get-content", type: "get-content",
  gci: "get-childitem", ls: "get-childitem", dir: "get-childitem",
  gi: "get-item", rvpa: "resolve-path", gl: "get-location", pwd: "get-location",
  sls: "select-string", select: "select-object", measure: "measure-object", sort: "sort-object",
  ft: "format-table", fl: "format-list", oh: "out-host", echo: "write-output", write: "write-output",
});

/**
 * One command read against its cmdlet's Spec: every parameter one it knows, every value of its kind, every path inside.
 * @param {Spec & { name: string }} spec @param {Word[]} args @param {Place} at @param {boolean} first  whether it comes
 *   first in its pipeline @param {boolean} [piped]  whether what it writes is piped on
 * @returns {Verdict}
 */
function command(spec, args, at, first, piped = false) {
  const { name } = spec;
  if (spec.paths && !first) return no(`${name} would take its paths from the pipeline, which is not followed here`);
  const values = { ...COMMON, ...spec.values };
  const alias = { ...COMMON_ALIAS, ...spec.alias };
  /** @type {Set<string>} */
  const on = new Set();
  /** @type {Map<string, Word>} */
  const bound = new Map();
  /** @type {Word[]} */
  const loose = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w.quoted || !w.text.startsWith("-") || w.text === "-") {
      loose.push(w);
      continue;
    }
    if (w.text.startsWith("--")) return no(`${name} ${w.text}: \`--\` ends PowerShell's reading of parameters`);
    if (w.text.includes(":")) return no(`${name} ${w.text}: a parameter joined to its value by a colon`);
    const written = w.text.slice(1).toLowerCase();
    const p = Object.hasOwn(alias, written) ? alias[written] : written;
    if (spec.switches?.includes(p)) {
      on.add(p);
      continue;
    }
    if (!Object.hasOwn(values, p)) return no(`${name} ${w.text} is not a parameter known to only read (each is read by its whole name)`);
    const v = args[++i];
    if (!v) return no(`${name} ${w.text} needs a value`);
    if (!v.quoted && v.text.startsWith("-") && v.text !== "-") return no(`${name} ${w.text} needs a value, and ${v.text} reads as a parameter`);
    if (bound.has(p)) return no(`${name} ${w.text} is given twice`);
    bound.set(p, v);
  }
  const open = (spec.positional || []).filter((p) => !bound.has(p));
  if (loose.length > open.length && !spec.rest) return no(`${name} takes no ${open.length ? "further " : ""}word without a parameter's name (${loose[open.length].text})`);
  for (const [n, p] of open.entries()) if (loose[n]) bound.set(p, loose[n]);
  /** Where a listing starts: each path it names, or the folder it runs in. @type {string[]} */
  const listed = [];
  let wildcard = false;
  for (const [p, v] of bound) {
    const kind = values[p];
    if (kind === "int") {
      if (!/^\d+$/.test(v.text)) return no(`${name} -${p} takes a whole number`);
    } else if (Array.isArray(kind)) {
      if (!kind.includes(v.text.toLowerCase())) return no(`${name} -${p} ${v.text}: only ${kind.join(", ")} are read here`);
    } else if (kind === "path" || kind === "literal") {
      const globbed = kind === "path" && WILD.test(v.text);
      const there = globbed ? wild(v.text, at) : place(v.text, at);
      if (!there.ok) return there;
      listed.push(there.abs);
      wildcard ||= globbed;
    }
  }
  if (spec.needs && !listed.length) return no(`${name} with no path: it would ask for one`);
  if (spec.lists) {
    // A wildcard lists each folder it picks, one level down.
    const deep = on.has("recurse") || bound.has("depth") || wildcard;
    for (const dir of listed.length ? listed : [at.cwd]) {
      const why = leadsOut(dir, at, deep);
      if (why) return no(`${name}: ${why}`);
      // A listing piped on is read file by file: for another machine's agents, none of a repository's own .git or of a
      // credentials folder — where it starts, or below it where it recurses (fs-fence.js `keptFromAgents`).
      const kept = at.theirs && piped ? keptIn(dir, at, deep) : null;
      if (kept) return no(`${name}: ${kept}`);
    }
  }
  return YES;
}

/** A name of an environment variable, whatever its case (Windows keeps one of each). @param {Record<string, string | undefined>} env @param {string} name */
const envOf = (env, name) => Object.keys(env).filter((k) => k.toUpperCase() === name.toUpperCase()).map((k) => String(env[k] ?? "")).filter(Boolean);

/**
 * Why PowerShell could load something the agent wrote before it runs the script, or null: its profile and its modules
 * come from the person's Documents (a OneDrive's too, where Windows keeps them there) and from PSModulePath — a module
 * there can stand in for any cmdlet — and none of those folders may be inside the working folder.
 * @param {Record<string, string | undefined>} env @param {Place} at
 */
function loads(env, at) {
  const homes = [...envOf(env, "USERPROFILE"), ...["OneDrive", "OneDriveConsumer", "OneDriveCommercial"].flatMap((k) => envOf(env, k))];
  for (const home of homes)
    for (const sub of ["WindowsPowerShell", "PowerShell"]) {
      const dir = join(home, "Documents", sub);
      if (isAbsolute(dir) && reaches(dir, at)) return `PowerShell loads your profile and modules from ${dir}, inside the working folder`;
    }
  // Elsewhere than Windows, pwsh keeps both under the home folder.
  for (const home of at.win ? [] : envOf(env, "HOME"))
    for (const sub of [join(".config", "powershell"), join(".local", "share", "powershell")]) {
      const dir = join(home, sub);
      if (isAbsolute(dir) && reaches(dir, at)) return `PowerShell loads your profile and modules from ${dir}, inside the working folder`;
    }
  for (const dir of envOf(env, "PSModulePath").flatMap((p) => p.split(delimiter)).map((d) => d.trim()).filter(Boolean)) {
    if (!isAbsolute(dir)) return `PowerShell's module path searches ${dir}, relative to the folder a script runs in`;
    if (reaches(dir, at)) return `PowerShell's module path searches ${dir}, inside the working folder`;
  }
  return null;
}

/**
 * Why the program that runs the script could be something the agent wrote, or null. `program` is how the agent names
 * it: a whole path (Codex's `C:\Windows\…\powershell.exe`), which must be a PowerShell outside the working folder; a
 * bare name, or none (the agent picks its own), found along the PATH — where no folder may be inside the working
 * folder, nor a file of that name stand in the folder the script runs in.
 * @param {string | null} program @param {Record<string, string | undefined>} env @param {Place} at
 */
function runner(program, env, at) {
  const bare = program ? basename(program.replace(/\\/g, "/")).toLowerCase().replace(/\.exe$/, "") : "";
  if (program && bare !== "powershell" && bare !== "pwsh") return `${program} is not PowerShell`;
  if (program && /[\\/]/.test(program)) {
    if (!isAbsolute(program)) return `${program} is found from the folder the script runs in`;
    try {
      if (!statSync(program).isFile()) return `${program} is no file`;
      return reaches(realpathSync(program), at) ? `${program} leads into the working folder` : null;
    } catch {
      return `${program} cannot be read`;
    }
  }
  for (const dir of envOf(env, "PATH").flatMap((p) => p.split(delimiter)).map((d) => d.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean)) {
    if (!isAbsolute(dir)) return `the PATH searches ${dir} (relative to the folder a script runs in), where a file could stand in for PowerShell`;
    if (reaches(dir, at)) return `the PATH searches ${dir} (inside the working folder), where a file could stand in for PowerShell`;
  }
  try {
    const stand = readdirSync(at.cwd).find((f) => /^(powershell|pwsh)(\.[^.]*)?$/i.test(f));
    if (stand) return `${stand} stands in the folder the script runs in, where it could be run for PowerShell`;
  } catch {}
  return null;
}

/**
 * Whether a PowerShell `script` only reads, run in the working folder `root` — or in `cwd` inside it — with `env`
 * (the hands' `safeEnv()`): yes, or no with the reason. Anything this reader cannot read is a no.
 * @param {string} script
 * @param {{ root: string, cwd?: string | null, program?: string | null, env?: Record<string, string | undefined>, platform?: string, reads?: readonly string[], agentsDevice?: boolean }} o
 *   `cwd`: the folder the script runs in, when the agent names another than the working folder; `program`: the
 *   PowerShell the agent names (`runner`); `reads`: the folders added to the working folder, where a path it reads
 *   may land too; `agentsDevice`: the script runs for another machine's agents, for whom a path in a repository's own
 *   `.git` or a credentials folder is no read (read-only-commands.js `NOT_READ_BY_THEM`)
 * @returns {Verdict}
 */
export function readOnlyPowerShell(script, { root, cwd = null, program = null, env = {}, platform = process.platform, reads = [], agentsDevice = false }) {
  let realRoot = "";
  try {
    realRoot = realpathSync(root);
  } catch {
    return no("the working folder does not exist");
  }
  /** @type {Place} */
  const at = { root, realRoot, cwd: resolve(root), win: platform === "win32", reads: readsAt(reads), theirs: agentsDevice };
  if (cwd) {
    // Inside, and with no link on the way: a path's leading `..` is read by its letters from it.
    const run = resolve(root, cwd);
    let real = "";
    try {
      resolveInside(root, run);
    } catch {
      return no(`it runs in ${cwd}, outside the working folder`);
    }
    try {
      real = realpathSync(run);
    } catch {
      return no(`it runs in ${cwd}, which is not there`);
    }
    if (fold(relative(realRoot, real)) !== fold(relative(resolve(root), run))) return no(`it runs in ${cwd}, reached through a link`);
    at.cwd = run;
  }
  const lexed = lex(String(script ?? ""));
  if (!("commands" in lexed)) return lexed;
  const { commands, seps } = lexed;
  let read = 0;
  for (const [k, words] of commands.entries()) {
    const before = k ? seps[k - 1] : ";";
    if (!words.length) {
      // PowerShell reads an empty statement between `;` and line breaks as nothing; beside a `|`, `&&` or `||` it is an error.
      if (before === ";" && (seps[k] === ";" || seps[k] === "")) continue;
      return no("an empty command");
    }
    const [head, ...args] = words;
    if (head.quoted) return no("a string where a command stands: PowerShell reads it as an expression");
    const key = head.text.toLowerCase();
    const spec = Object.hasOwn(CMDLETS, key) ? CMDLETS[key] : at.win && Object.hasOwn(ALIASES, key) ? CMDLETS[ALIASES[/** @type {keyof typeof ALIASES} */ (key)]] : null;
    if (!spec) return no(`\`${head.text}\` is not one of the PowerShell commands known to only read`);
    const v = command(spec, args, at, before !== "|", seps[k] === "|");
    if (!v.ok) return v;
    read++;
  }
  if (!read) return no("no command");
  const why = runner(program, env, at) || loads(env, at);
  return why ? no(why) : YES;
}
