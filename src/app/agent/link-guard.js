// @ts-check
// Links a command makes and deep deletes it runs, read before it runs (the owner's list of 11-08). On Windows a
// junction or a folder's symbolic link made outside the chat's folder that leads into it outlives the command: a
// recursive delete of the folder holding it later deletes through it (Windows PowerShell 5.1's Remove-Item -Recurse
// follows a junction, and so does `git worktree remove`), and a folder's dependencies were emptied that way. And a
// recursive delete of a folder that holds a link leading out of it may empty what the link leads to. The gate asks
// about either in every mode, Full access too, and no rule learned or allowed, nor a brief's grant, lets one through
// unasked (`gate`, `ruled`). Elsewhere a recursive delete never follows a folder's link, and nothing here asks.
//
// This reads the command's syntax as the rules read it (`commandSegments`, `shellWords`): its programs, their switches
// and their paths, through `cmd /c`, `powershell -Command` and `bash -c`, from the folder each `cd` leaves it in —
// never the words of a message. It is a guard, not a sandbox: a path built at run time, or a script it calls, it does
// not see.
import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { globToRegExp, shellWords } from "./rules.js";

/** How many folder entries a deep delete's walk reads before it stops looking. */
const WALK_CAP = 5000;
/**
 * How long a command's reading is kept: the gate reads one call several times as it is judged, within milliseconds —
 * never so long that a link made by the next command is missed.
 */
const KEPT_MS = 300;
/** How many readings are kept. */
const KEPT_MAX = 64;
/** How deep a shell inside a shell is read. */
const DEPTH_MAX = 3;

/**
 * What a command makes or deletes that the gate asks about, or null: `link`, the link's path and `to`, where it leads
 * (made outside `root`, leading into it), or `deletes`, the folder a recursive delete takes and the link inside it
 * that leads out of it.
 * @typedef {{ kind: "link", link: string, to: string } | { kind: "deletes", path: string, link: string, to: string }} LinkRisk
 */
/** @typedef {"bash" | "pwsh" | "cmd"} Dialect */

/**
 * A command cut where its shell runs the next part (`&&`, `||`, `;`, `|`, a lone `&` but PowerShell's call operator,
 * a line break), as `commandSegments` cuts it for the rules — but never inside a quote: the rules judge every part
 * whatever holds it, while the guard reads a line handed to `cmd /c` or `bash -c` whole, from the folder its own `cd`
 * leaves it in. A line its shell continues (bash's `\`, PowerShell's backtick, cmd's `^`) is one line.
 * @param {string} command @param {Dialect} d @returns {string[]}
 */
const cutOf = (command, d) => {
  const s = String(command || "").replace(d === "pwsh" ? /`\r?\n/g : d === "cmd" ? /\^\r?\n/g : /\\\r?\n/g, " ");
  const esc = d === "bash" ? "\\" : d === "cmd" ? "^" : "`";
  /** @type {string[]} */
  const out = [];
  let from = 0;
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = "";
      else if (c === esc && q === '"' && d !== "cmd") i++;
      continue;
    }
    if (c === '"' || (c === "'" && d !== "cmd")) q = c;
    else if (c === esc) i++;
    else if (c === ";" || c === "\n" || c === "\r" || c === "|" || (c === "&" && (s[i + 1] === "&" || d !== "pwsh") && s[i - 1] !== ">" && s[i - 1] !== "<")) {
      out.push(s.slice(from, i));
      if ((c === "&" || c === "|") && s[i + 1] === c) i++;
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
};

/**
 * The command's segments, each its words as its shell reads them (`shellWords`, the rules' own reading), cut where
 * its shell runs the next part (`cutOf`).
 * @param {string} command @param {Dialect | boolean} dialect  true: PowerShell, false: bash
 * @returns {string[][]}
 */
export const segmentsOf = (command, dialect) => {
  const d = dialect === true ? "pwsh" : dialect === false ? "bash" : dialect;
  return cutOf(command, d)
    .map((s) => shellWords(s, d))
    .filter((w) => w.length > 0);
};

/** A program's word as it is called: its file's name, lowercase, without `.exe`, `.cmd` or `.bat`. @param {string} w */
const programOf = (w) => w.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd|bat)$/, "") || "";

/**
 * A segment's words from the program it runs: past `sudo`, `command`, `&`, `.` and PowerShell's `$x =`.
 * @param {string[]} words
 */
const bare = (words) => {
  let w = words;
  for (let n = 0; n < 4 && w.length > 1; n++) {
    const p = programOf(w[0]);
    if (p === "sudo" || p === "command" || p === "&" || p === ".") w = w.slice(1);
    else if (/^\$[\w:]+$/.test(w[0]) && w[1] === "=") w = w.slice(2);
    else break;
  }
  return w;
};

/**
 * The command a shell inside the segment runs, in its dialect, or null: `cmd /c`, `powershell -Command`, `pwsh -c`,
 * `bash -c`, `sh -c`.
 * @param {string[]} w @returns {{ dialect: Dialect, command: string } | null}
 */
const innerOf = (w) => {
  const p = programOf(w[0] || "");
  /** The words after `at` as one line: one word is the line itself; of several, one with a blank keeps its quotes. @param {number} at */
  const lineAfter = (at) => {
    const rest = w.slice(at + 1);
    return rest.length === 1 ? rest[0] : rest.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");
  };
  if (p === "cmd") {
    const at = w.findIndex((x) => /^\/{1,2}[ck]$/i.test(x));
    return at > 0 ? { dialect: "cmd", command: lineAfter(at) } : null;
  }
  if (p === "powershell" || p === "pwsh") {
    const at = w.findIndex((x) => /^-(c|command|com|comm|comma|comman)$/i.test(x));
    return at > 0 ? { dialect: "pwsh", command: lineAfter(at) } : null;
  }
  if (p === "bash" || p === "sh" || p === "zsh" || p === "dash") {
    const at = w.findIndex((x) => /^-[a-z]*c[a-z]*$/.test(x));
    return at > 0 && w[at + 1] != null ? { dialect: "bash", command: w[at + 1] } : null;
  }
  return null;
};

/**
 * A path as the command names it, from the folder `from`, its variables read from `env`: `~`, `$HOME`, `${NAME}`,
 * `$env:NAME`, `%NAME%`. Null where it holds a variable the environment lacks, what a shell builds at run time, or a
 * network path, which is never walked (an offline share would hold the gate for its timeout).
 * @param {string} p @param {string} from @param {Record<string, string | undefined>} env
 */
const pathOf = (p, from, env) => {
  let s = String(p || "").trim();
  if (!s || /[`]|\$\(/.test(s) || /^[\\/]{2}/.test(s)) return null;
  const home = env.USERPROFILE || env.HOME || "";
  if (/^~(?=[\\/]|$)/.test(s)) {
    if (!home) return null;
    s = home + s.slice(1);
  }
  let missing = false;
  /** @param {string} name */
  const take = (name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    // PowerShell's $HOME is the profile folder, which Windows names USERPROFILE.
    const v = key ? env[key] : name.toLowerCase() === "home" && home ? home : undefined;
    if (v == null) missing = true;
    return v ?? "";
  };
  s = s
    .replace(/\$env:([A-Za-z_][\w]*)/gi, (_, n) => take(n))
    .replace(/%([A-Za-z_][\w]*)%/g, (_, n) => take(n))
    .replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => take(a || b));
  if (missing || /^[\\/]{2}/.test(s)) return null;
  // Git Bash's /c/Users/... is C:\Users\...
  if (/^\/[a-z](?=\/|$)/i.test(s)) s = `${s[1]}:${s.slice(2) || "/"}`;
  return isAbsolute(s) ? resolve(s) : resolve(from, s);
};

/** Whether `child` is `parent` or inside it, as Windows compares paths. @param {string} child @param {string} parent */
const inside = (child, parent) => {
  const rel = relative(parent, child).toLowerCase();
  return rel === "" || (!isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel));
};

/** A path's real place where it exists, else as it is named. @param {string} p */
const realOf = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
};

/** Whether a path is a folder, following links; true where it does not exist yet, as a link's target may not. @param {string} p */
const folderOrNone = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return true;
  }
};

/** Where a folder's link leads, resolved from its own folder; null where it cannot be read, or leads to a file. @param {string} link */
const leadsTo = (link) => {
  try {
    const t = readlinkSync(link);
    const to = realOf(isAbsolute(t) ? t : resolve(dirname(link), t));
    return statSync(to).isDirectory() ? to : null;
  } catch {
    return null;
  }
};

/**
 * The first link to a folder at or under `top` that leads out of it, walked without following any, WALK_CAP entries
 * at most. A link to a file is never deleted through.
 * @param {string} top @returns {{ link: string, to: string } | null}
 */
export function linkOutOf(top) {
  let st;
  try {
    st = lstatSync(top);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    const to = leadsTo(top);
    return to ? { link: top, to } : null;
  }
  if (!st.isDirectory()) return null;
  const real = realOf(top);
  const queue = [top];
  let read = 0;
  while (queue.length && read < WALK_CAP) {
    const dir = /** @type {string} */ (queue.shift());
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++read > WALK_CAP) break;
      const at = join(dir, e.name);
      if (e.isSymbolicLink()) {
        const to = leadsTo(at);
        if (to && !inside(to, real)) return { link: at, to };
      } else if (e.isDirectory()) queue.push(at);
    }
  }
  return null;
}

/**
 * The places a path names: itself, or where its last part holds a wildcard, the entries of its folder that match it
 * (a wildcard further up is not read). @param {string} p @returns {string[]}
 */
const placesOf = (p) => {
  if (!/[*?]/.test(basename(p))) return /[*?]/.test(p) ? [] : [p];
  const dir = dirname(p);
  if (/[*?]/.test(dir)) return [];
  const match = globToRegExp(basename(p));
  try {
    return readdirSync(dir)
      .filter((n) => match.test(n))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
};

/**
 * The paths a recursive delete in one segment takes, or none: PowerShell's Remove-Item (and its aliases) with
 * -Recurse, `rm -r`, cmd's `rd /s` and `rmdir /s`, and `git worktree remove`.
 * @param {string[]} w @param {Dialect} dialect @returns {string[]}
 */
const deepDeletes = (w, dialect) => {
  const p = programOf(w[0] || "");
  const rest = w.slice(1);
  if (p === "git") {
    const at = rest.indexOf("worktree");
    if (at < 0 || rest[at + 1] !== "remove") return [];
    return rest.slice(at + 2).filter((x) => !x.startsWith("-"));
  }
  if (dialect === "pwsh" && ["remove-item", "rm", "ri", "del", "erase", "rd", "rmdir"].includes(p)) {
    if (!rest.some((x) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:\$true)?$/i.test(x))) return [];
    /** @type {string[]} */
    const paths = [];
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i];
      if (/^-(path|literalpath|lp|pspath)$/i.test(x)) paths.push(...String(rest[++i] || "").split(","));
      else if (x.startsWith("-")) {
        // A switch that takes a value keeps it: -Filter, -Include, -Exclude, -Credential, -Stream.
        if (/^-(filter|include|exclude|credential|stream)$/i.test(x)) i++;
      } else paths.push(...x.split(","));
    }
    return paths.filter(Boolean);
  }
  if (dialect !== "cmd" && p === "rm") {
    const recurse = rest.some((x) => x === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(x));
    return recurse ? rest.filter((x) => !x.startsWith("-")) : [];
  }
  if (dialect === "cmd" && (p === "rd" || p === "rmdir")) return rest.some((x) => /^\/s$/i.test(x)) ? rest.filter((x) => !x.startsWith("/")) : [];
  return [];
};

/**
 * The link one segment makes, or null, and where its target is read from: cmd's `mklink /J` (from the folder it runs
 * in) or `/D` (from the link's own), PowerShell's New-Item -ItemType Junction or SymbolicLink (from its location),
 * `ln -s` (from the link's own).
 * @param {string[]} w @param {Dialect} dialect @returns {{ link: string, to: string, from: "here" | "link" } | null}
 */
const linkMade = (w, dialect) => {
  const p = programOf(w[0] || "");
  const rest = w.slice(1);
  if (p === "mklink") {
    const junction = rest.some((x) => /^\/j$/i.test(x));
    if (!junction && !rest.some((x) => /^\/d$/i.test(x))) return null;
    const args = rest.filter((x) => !x.startsWith("/"));
    return args.length >= 2 ? { link: args[0], to: args[1], from: junction ? "here" : "link" } : null;
  }
  if (dialect === "pwsh" && (p === "new-item" || p === "ni")) {
    /** @type {Record<string, string>} */
    const named = {};
    /** @type {string[]} */
    const positional = [];
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i];
      if (/^-[a-z]+$/i.test(x)) {
        const k = x.slice(1).toLowerCase();
        if (k === "force" || k === "whatif" || k === "confirm") continue;
        named[k] = rest[++i] ?? "";
      } else positional.push(x);
    }
    const type = named.itemtype ?? named.type ?? named.it ?? "";
    if (!/^(junction|symboliclink)$/i.test(type)) return null;
    const to = named.target ?? named.value ?? "";
    const base = named.path ?? positional[0] ?? "";
    const link = named.name ? (base ? join(base, named.name) : named.name) : base;
    return link && to ? { link, to, from: "here" } : null;
  }
  if (dialect === "bash" && p === "ln") {
    if (!rest.some((x) => x === "--symbolic" || /^-[a-zA-Z]*s[a-zA-Z]*$/.test(x))) return null;
    const args = rest.filter((x) => !x.startsWith("-"));
    return args.length >= 2 ? { link: args[1], to: args[0], from: "link" } : null;
  }
  return null;
};

/** The folder a segment moves the rest to (`cd`, `pushd`, `chdir`, `Set-Location`, `sl`), or null. @param {string[]} w */
const movesTo = (w) => {
  const p = programOf(w[0] || "");
  if (!["cd", "pushd", "chdir", "set-location", "sl"].includes(p)) return null;
  const args = w.slice(1).filter((x) => !/^(\/d|-path|-literalpath)$/i.test(x));
  return args.length === 1 ? args[0] : null;
};

/**
 * One command's risk, read in its dialect from the folder `here`.
 * @param {string} command @param {Dialect} dialect @param {string} here @param {string} top  the chat's folder, real
 * @param {Record<string, string | undefined>} env @param {number} depth @returns {LinkRisk | null}
 */
function riskIn(command, dialect, here, top, env, depth) {
  let at = here;
  for (const words of segmentsOf(command, dialect)) {
    const w = bare(words);
    const inner = depth < DEPTH_MAX ? innerOf(w) : null;
    if (inner) {
      const r = riskIn(inner.command, inner.dialect, at, top, env, depth + 1);
      if (r) return r;
      continue;
    }
    const moved = movesTo(w);
    if (moved) {
      at = pathOf(moved, at, env) || at;
      continue;
    }
    const made = linkMade(w, dialect);
    if (made) {
      const link = pathOf(made.link, at, env);
      const to = link ? pathOf(made.to, made.from === "here" ? at : dirname(link), env) : null;
      if (link && to && folderOrNone(to) && !inside(realOf(dirname(link)), top) && inside(realOf(to), top)) return { kind: "link", link, to };
    }
    for (const p of deepDeletes(w, dialect)) {
      const path = pathOf(p, at, env);
      for (const place of path ? placesOf(path) : []) {
        const found = linkOutOf(place);
        if (found) return { kind: "deletes", path: place, link: found.link, to: found.to };
      }
    }
  }
  return null;
}

/** Readings kept a moment: the gate reads one call several times as it is judged. @type {Map<string, { at: number, risk: LinkRisk | null }>} */
const kept = new Map();

/**
 * What a command makes or deletes that the gate asks about (`LinkRisk`), or null: a link made outside `root` that
 * leads into it, or a recursive delete of a folder that holds a link leading out of it. `name` is the hand that runs
 * it: PowerShell's words read as PowerShell's. Only on Windows, where a delete follows such a link (`platform`).
 * @param {string} name @param {string} command @param {string} root
 * @param {{ env?: Record<string, string | undefined>, platform?: string }} [o]
 * @returns {LinkRisk | null}
 */
export function linkRisk(name, command, root, { env = process.env, platform = process.platform } = {}) {
  if (platform !== "win32" || !root || !command) return null;
  const key = `${name}\n${root}\n${command}`;
  const was = kept.get(key);
  if (was && Date.now() - was.at < KEPT_MS) return was.risk;
  const risk = riskIn(command, name === "powershell" ? "pwsh" : "bash", resolve(root), realOf(resolve(root)), env, 0);
  kept.delete(key);
  kept.set(key, { at: Date.now(), risk });
  if (kept.size > KEPT_MAX) kept.delete(/** @type {string} */ (kept.keys().next().value));
  return risk;
}

/** Why the gate asks about a command `linkRisk` read, in the words the question and the model read. @param {LinkRisk} r */
export const linkWords = (r) =>
  r.kind === "link"
    ? `it makes a link at ${r.link}, outside this chat's folder, that leads into it (${r.to}): deleting the folder that holds the link with everything in it would delete through the link what it leads to`
    : `it deletes ${r.path} with everything in it, and a link in there leads out of it (${r.link} to ${r.to}): the delete may follow the link and empty what it leads to; remove the link by itself first (cmd /c rmdir on a junction)`;
