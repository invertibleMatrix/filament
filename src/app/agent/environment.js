// @ts-check
// The loop's Environment section (HarnessV3-SystemPrompt SP-D2/D3): the machine the agent's tools run on, told once at
// the start of a session — the clock and timezone, the system, the shell the bash tool really runs and what is on its
// PATH, Filament itself, the folder's git state and how the project runs its checks. Each line replaces a guess the
// agent would otherwise make wrong (a tool called "bash" that is cmd.exe underneath had it writing grep and /h/ paths)
// or spend a round to check.
//
// Captured once per session and frozen (`createEnvironmentKeeper`, the chain's `meta.environment`): the provider caches
// the system prompt as one prefix, so the section's bytes must not move from turn to turn — the clock says when the
// session started and how to ask for the time now. Nothing here writes: git is read with optional locks off, files are
// listed and read, no process is started to find a tool (the PATH is scanned).
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, dirname, extname, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { version as osVersion, release as osRelease, arch as osArch } from "node:os";
import { SHELL, POWERSHELL } from "../../adapters/tools/shell.js";
import { git } from "../../adapters/git/snapshot.js";
import { parsePorcelainV2, BASE_NAMES } from "../../adapters/git/inspect.js";
import { cut } from "../../core/text.js";
import { LOCKFILES } from "../../core/package-managers.js";

/**
 * The facts' shape version: a stored capture of another version is captured again, not rendered wrong. 2: the shell's
 * kind (Git Bash on Windows, HarnessV3-Tools TL-D1) and the powershell tool's PowerShell. `path.unread` is optional
 * within it: a capture stored without it has none, and its section reads as it was sent.
 */
export const ENVIRONMENT_VERSION = 2;
/** How long git may take per call: a slow repository says so instead of holding the session's first turn. */
const GIT_TIMEOUT_MS = 4000;
const MAX_STATUS = 15;
const MAX_COMMITS = 5;
const MAX_SCRIPTS = 15;
const MAX_TOP = 40;
const MAX_TARGETS = 15;
/**
 * How long one PATH folder may take to list and check, counted from when its listing is issued, before the scan goes on
 * without it (a share that stopped answering).
 */
const LIST_WAIT_MS = 2000;
/**
 * How long a whole PATH scan may take. A session's first turn waits for its capture, and git may already hold that
 * capture 8 s (rev-parse, then its five calls side by side, 4 s each): 6 s stays under that and is three of a folder's
 * waits, while a cold PATH — a few dozen folders, the virus scanner taking 100-300 ms over each — lists in about 3 s.
 */
const SCAN_CAP_MS = 6000;
/**
 * How many listings a scan has under way at once: libuv's pool of file-system threads (UV_THREADPOOL_SIZE, 4 unless
 * set), so a listing it issues is one a thread can take, and its wait is not spent queued behind the others.
 */
const POOL = Math.max(1, Math.min(1024, Number.parseInt(process.env.UV_THREADPOOL_SIZE || "", 10) || 4));
/** How long a folder's listing may go unanswered before a later scan asks the folder again. */
const STUCK_MS = 60_000;
/** How long the tools found on one PATH stand before it is scanned again. */
const PATH_KEPT_MS = 60_000;
/**
 * How long an answer with PATH folders left unread stands, and a capture holding one: long enough for the asks of one
 * moment to share it, short enough that the next session's capture reads the folders that answer by then.
 */
const PARTIAL_KEPT_MS = 5000;

/** The tools worth knowing about, in the order the PATH line names them. */
const TOOLS = Object.freeze(["git", "gh", "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "python", "python3", "py", "pip", "pip3", "uv", "poetry", "go", "cargo", "rustc", "java", "mvn", "gradle", "dotnet", "ruby", "php", "composer", "perl", "docker", "podman", "kubectl", "make", "cmake", "powershell", "pwsh", "bash", "wsl", "curl", "wget", "jq", "tar", "rg"]);
/** The Unix text tools a model reaches for first; on Windows the section says which of them this PATH has. */
const UNIX = Object.freeze(["grep", "ls", "cat", "sed", "awk", "head", "tail", "wc", "xargs"]);
/** Project manifests, in the order the section names them. `*.sln`/`*.csproj` match by extension. */
const MANIFESTS = Object.freeze(["package.json", "deno.json", "deno.jsonc", "pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "CMakeLists.txt", "Makefile", "Dockerfile", "docker-compose.yml", "compose.yaml"]);
const WEEKDAYS = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

/**
 * @typedef {object} GitFacts
 * @property {string | null} repo  the repository's top folder; null outside one
 * @property {string | null} error  git missing, or a call that failed or timed out, in words
 * @property {string | null} [branch]  null when detached
 * @property {string | null} [head]  the short commit, for a detached head
 * @property {string | null} [upstream]
 * @property {number} [ahead]
 * @property {number} [behind]
 * @property {string | null} [main]  the branch the repository treats as main
 * @property {string | null} [user]  git's user.name
 * @property {string[]} [status]  "XY path" for the first files
 * @property {number} [changed]  how many files the status had
 * @property {{ short: string, subject: string }[]} [commits]
 */
/**
 * @typedef {object} ProjectFacts
 * @property {string[]} manifests
 * @property {{ manager: string, lock: string } | null} node  the package manager package.json is run with, and why
 * @property {{ manager: string, lock: string } | null} python
 * @property {[string, string][]} scripts  package.json's scripts, name and command (clipped)
 * @property {number} moreScripts
 * @property {string[]} targets  the Makefile's targets
 * @property {string[]} top  the folder's entries, folders first (with a trailing slash)
 * @property {number} moreTop
 */
/**
 * @typedef {object} PathTools
 * @property {string[]} on  the tools worth knowing found on the PATH
 * @property {string[]} unixOn  on Windows, the Unix text tools found
 * @property {string[]} unixOff  on Windows, the Unix text tools not found in the folders read
 * @property {boolean} wslBash
 * @property {string} platform
 * @property {number} [unread]  the PATH folders that did not answer in time, so were not read; none when absent
 */
/**
 * @typedef {object} EnvironmentFacts
 * @property {number} v  ENVIRONMENT_VERSION
 * @property {string} root  the folder it was captured for; "" for the machine alone
 * @property {{ weekday: string, date: string, time: string, zone: string, offset: string }} clock
 * @property {{ name: string, kernel: string, arch: string, locale: string }} system
 * @property {{ kind: import("../../adapters/tools/shell.js").Shell["kind"], name: string, file: string, flavor: string | null }} shell  the bash tool's
 * @property {import("../../adapters/tools/shell.js").PowerShell | null} powershell  the powershell tool's; null without one
 * @property {PathTools} path
 * @property {{ command: string, listen: string | null, cli?: string }} harness  `cli`: its command line (`cliCommand`); a capture stored before it has none
 * @property {GitFacts | null} git
 * @property {ProjectFacts | null} project
 */

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
/** A variable read as the platform reads it: Windows names are case-insensitive, a plain object's keys are not. */
const envGet = (/** @type {Record<string, string | undefined>} */ env, /** @type {string} */ name, /** @type {string} */ platform) => {
  if (platform !== "win32") return env[name];
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k ? env[k] : undefined;
};

/**
 * The clock as the session's start states it: local weekday, date and time, the IANA zone and the UTC offset.
 * @param {Date} now @param {string} [zone]
 */
export function clockOf(now, zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "") {
  const off = -now.getTimezoneOffset();
  return {
    weekday: WEEKDAYS[now.getDay()],
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    zone,
    offset: `UTC${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`,
  };
}

/**
 * The operating system by the name its owner knows it: Windows' own product name, macOS's version from its system
 * file, a Linux distribution's PRETTY_NAME — each with its kernel beside it.
 * @param {{ platform?: string, version?: string, release?: string, arch?: string, readText?: (path: string) => string }} [o]
 */
export function systemOf({ platform = process.platform, version = osVersion(), release = osRelease(), arch = osArch(), readText = (p) => readFileSync(p, "utf8") } = {}) {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
  const read = (/** @type {string} */ p, /** @type {RegExp} */ re) => {
    try {
      return re.exec(readText(p))?.[1]?.trim() || "";
    } catch {
      return "";
    }
  };
  if (platform === "win32") return { name: version || "Windows", kernel: release, arch, locale };
  if (platform === "darwin") {
    const v = read("/System/Library/CoreServices/SystemVersion.plist", /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/);
    return { name: v ? `macOS ${v}` : "macOS", kernel: `Darwin ${release}`, arch, locale };
  }
  if (platform === "linux") {
    const v = read("/etc/os-release", /^PRETTY_NAME="?([^"\n]*)"?$/m);
    return { name: v || "Linux", kernel: `Linux ${release}`, arch, locale };
  }
  return { name: platform, kernel: release, arch, locale };
}

/**
 * What /bin/sh is underneath (dash, bash, busybox…), or null when it cannot be told or is a plain sh.
 * @param {(p: string) => string} [realpath]
 */
export function shFlavor(realpath = realpathSync) {
  try {
    const name = basename(realpath("/bin/sh")).toLowerCase();
    return name && name !== "sh" ? name : null;
  } catch {
    return null;
  }
}

/**
 * The PATH folders being listed, by folder, each with when its listing was issued. A scan that finds a folder's
 * listing under way waits on it for what is left of the folder's wait instead of asking again, so a share that stopped
 * answering holds one of the file system's threads, not one per scan; a listing unanswered for `STUCK_MS` is asked
 * again, the first left to answer when it does. One entry per folder, gone once its listing answers.
 * @type {Map<string, { at: number, names: Promise<string[] | null> }>}
 */
const listing = new Map();
/** Listings left hanging when their folder was asked again, still unanswered: each may hold a file-system thread. */
let stranded = 0;

/**
 * The folder's listing: the one under way while it is younger than `stuckMs`, else a new one issued at `t`; null for a
 * folder whose listing is stuck while `strandedMax` listings already hang left behind. Its names are null where the
 * folder cannot be listed.
 * @param {string} d @param {(d: string) => Promise<string[]>} list @param {number} t
 * @param {number} stuckMs @param {number} strandedMax
 */
const listingOf = (d, list, t, stuckMs, strandedMax) => {
  const under = listing.get(d);
  if (under && t - under.at < stuckMs) return under;
  if (under) {
    if (stranded >= strandedMax) return null;
    stranded++;
    under.names.then(() => stranded--);
  }
  /** @type {Promise<string[]>} */
  const asked = new Promise((r) => r(list(d)));
  const entry = { at: t, names: asked.then((n) => n, () => null) };
  listing.set(d, entry);
  entry.names.then(() => {
    if (listing.get(d) === entry) listing.delete(d);
  });
  return entry;
};

/**
 * Which of the tools worth knowing are on the PATH the shell gets, found by listing the PATH's folders (PATHEXT on
 * Windows) — nothing is run. On Windows, which Unix text tools are there (what cmd.exe, the fallback shell, can
 * reach), and whether the `bash` on the PATH is WSL's. The folders are listed off the server's thread, `pool` at a
 * time — the next issued when one of them answers — each with `waitMs` from when its own listing is issued to list
 * and check its tools; one that has not answered by then is left unread, and so is every folder the scan has not
 * finished within `capMs`. `unread` counts them; a folder that answers with an error is read, and has no tools.
 * @param {{ env?: Record<string, string | undefined>, platform?: string, list?: (d: string) => Promise<string[]>, statOf?: (p: string) => Promise<{ isFile: () => boolean, mode: number }>, waitMs?: number, capMs?: number, pool?: number, stuckMs?: number }} [o]
 * @returns {Promise<PathTools>}
 */
export function pathToolsOf({ env = process.env, platform = process.platform, list = readdir, statOf = stat, waitMs = LIST_WAIT_MS, capMs = SCAN_CAP_MS, pool = POOL, stuckMs = STUCK_MS } = {}) {
  const win = platform === "win32";
  const dirs = [...new Set(String(envGet(env, "PATH", platform) || "").split(win ? ";" : delimiter).filter(Boolean))];
  const exts = win ? String(envGet(env, "PATHEXT", platform) || ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter(Boolean) : [];
  const want = new Set([...TOOLS, ...UNIX]);
  // Half the pool at most goes to folders asked again past a listing that hangs: the rest of Filament keeps its threads.
  const strandedMax = Math.max(1, Math.floor(pool / 2));
  /**
   * A folder's tools, by name, in the order it lists them: on POSIX a file that runs, checked one at a time, none
   * checked once `stop` says the folder's wait is over.
   * @param {string} d @param {string[]} names @param {() => boolean} stop
   */
  const toolsIn = async (d, names, stop) => {
    /** @type {Map<string, string>} */
    const tools = new Map();
    for (const n of names) {
      let base = n;
      if (win) {
        const e = extname(n).toLowerCase();
        if (!exts.includes(e)) continue;
        base = n.slice(0, -e.length).toLowerCase();
      }
      if (!want.has(base) || tools.has(base)) continue;
      const full = join(d, n);
      if (!win) {
        if (stop()) break;
        const st = await statOf(full).catch(() => null);
        if (!st || !st.isFile() || !(st.mode & 0o111)) continue;
      }
      tools.set(base, full);
    }
    return tools;
  };
  /** Each folder's tools, by its place on the PATH; null for one not read. @type {(Map<string, string> | null)[]} */
  const read = dirs.map(() => null);
  const answer = () => {
    /** @type {Map<string, string>} */
    const found = new Map();
    for (const tools of read) for (const [base, full] of tools || []) if (!found.has(base)) found.set(base, full);
    const systemRoot = String(envGet(env, "SYSTEMROOT", platform) || "C:\\Windows").toLowerCase();
    const bashAt = found.get("bash") || "";
    const wslBash = win && !!bashAt && bashAt.toLowerCase().startsWith(systemRoot);
    return {
      on: TOOLS.filter((t) => found.has(t)),
      unixOn: win ? UNIX.filter((t) => found.has(t)) : [],
      unixOff: win ? UNIX.filter((t) => !found.has(t)) : [],
      wslBash,
      platform,
      unread: read.filter((tools) => !tools).length,
    };
  };
  return new Promise((resolve) => {
    let open = dirs.length;
    let free = Math.max(1, pool);
    let next = 0;
    let over = false;
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    const timers = new Set();
    const finish = () => {
      if (over) return;
      over = true;
      for (const h of timers) clearTimeout(h);
      resolve(answer());
    };
    /** @param {number} i @param {Map<string, string> | null} tools */
    const decided = (i, tools) => {
      read[i] = tools;
      if (--open === 0) finish();
    };
    /** @param {number} i */
    const take = (i) => {
      const t = Date.now();
      const under = listingOf(dirs[i], list, t, stuckMs, strandedMax);
      const ms = under ? under.at + waitMs - t : 0;
      // A listing from an earlier scan past its wait is not waited on again, and takes none of this scan's turns.
      if (!under || ms <= 0) return decided(i, null);
      free--;
      let done = false;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (done || over) return;
        done = true;
        decided(i, null);
      }, ms);
      timers.add(timer);
      // The folder's turn is given back when its listing and checks answer, not at its wait: until then they hold a
      // thread, and a listing issued meanwhile would spend its wait queued.
      under.names
        .then((names) => toolsIn(dirs[i], names || [], () => done || over))
        .then((tools) => {
          if (!done && !over) {
            done = true;
            clearTimeout(timer);
            timers.delete(timer);
            decided(i, tools);
          }
          free++;
          pump();
        });
    };
    const pump = () => {
      while (!over && free > 0 && next < dirs.length) take(next++);
    };
    if (!open) return finish();
    timers.add(setTimeout(finish, capMs));
    pump();
  });
}

/**
 * The tools found on each PATH, by what they were found from, and until when they stand.
 * @type {Map<string, { until: number, p: Promise<PathTools> }>}
 */
const pathToolsKept = new Map();

/**
 * The PATH's tools as `pathToolsOf` finds them, the same answer for `keepMs` per PATH: every capture asks (the New
 * Task board on every pause in typing, for each folder typed), and the PATH is the machine's, not the folder's. An
 * answer with folders left unread stands `partialMs` from when it comes, so a capture after it reads the folders that
 * answer by then; a scan that fails is not kept. Every ask sweeps the PATHs past their time.
 * @param {{ env?: Record<string, string | undefined>, platform?: string, now?: () => number, keepMs?: number, partialMs?: number, scan?: (o: { env: Record<string, string | undefined>, platform: string }) => Promise<PathTools> }} [o]
 * @returns {Promise<PathTools>}
 */
export function keptPathTools({ env = process.env, platform = process.platform, now = Date.now, keepMs = PATH_KEPT_MS, partialMs = PARTIAL_KEPT_MS, scan = pathToolsOf } = {}) {
  const key = [platform, ...["PATH", "PATHEXT", "SYSTEMROOT"].map((k) => envGet(env, k, platform) || "")].join("\0");
  const t = now();
  const hit = pathToolsKept.get(key);
  if (hit && t < hit.until) return hit.p;
  for (const [k, v] of pathToolsKept) if (t >= v.until) pathToolsKept.delete(k);
  const p = scan({ env, platform });
  const entry = { until: t + keepMs, p };
  pathToolsKept.set(key, entry);
  p.then(
    (tools) => {
      if (tools.unread) entry.until = Math.min(entry.until, now() + partialMs);
    },
    () => {
      if (pathToolsKept.get(key) === entry) pathToolsKept.delete(key);
    },
  );
  return p;
}

/** Filament's own command line, quoted where a path has a space. @param {readonly string[]} [argv] */
export function harnessCommand(argv = process.argv) {
  return argv
    .slice(0, 2)
    .filter(Boolean)
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ");
}

/** Filament's own command line's script, beside this file in its checkout or its installed app. */
export const CLI_SCRIPT = fileURLToPath(new URL("../../../bin/filament.js", import.meta.url));

/**
 * Filament's command line (src/cli) as the agent's shell runs it: the installed app's `bin/filament` beside it — Git
 * Bash runs its shell script, cmd and PowerShell its .cmd —; an Electron with none beside it (the app run from its
 * checkout) as Node, on Filament's own script; else this Node on it. A Windows path in forward slashes, which no shell
 * reads as an escape. `dataDir`: the data folder, where it is not the one the command finds by itself — an agent's shell
 * gets no FILAMENT_* variable.
 * @param {{ dataDir?: string | null, execPath?: string, electron?: boolean, platform?: string, script?: string, exists?: (p: string) => boolean }} [o]
 */
export function cliCommand({ dataDir = null, execPath = process.execPath, electron = !!process.versions.electron, platform = process.platform, script = CLI_SCRIPT, exists = existsSync } = {}) {
  /** @param {string} a */
  const q = (a) => {
    const p = platform === "win32" ? a.replaceAll("\\", "/") : a;
    return /\s/.test(p) ? `"${p}"` : p;
  };
  const shim = join(dirname(execPath), "bin", "filament");
  const prog = !electron ? [q(execPath), q(script)] : exists(shim) ? [q(shim)] : ["ELECTRON_RUN_AS_NODE=1", q(execPath), q(script)];
  return [...prog, ...(dataDir ? ["--data-dir", q(dataDir)] : [])].join(" ");
}

/**
 * The folder's git state at the start: the repository, branch and tracking, the main branch, the user's name, the
 * status's first files and the newest commits. Read with GIT_OPTIONAL_LOCKS=0, so a status never takes the index
 * lock a developer's own git command needs.
 * @param {string} root
 * @param {{ run?: typeof git, timeoutMs?: number }} [o]
 * @returns {Promise<GitFacts>}
 */
export async function gitFactsOf(root, { run = git, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  // A missing folder fails git's spawn as a missing git does (ENOENT): said for what it is, as repoOf says it.
  if (!existsSync(root)) return { repo: null, error: "the folder does not exist" };
  const env = { GIT_OPTIONAL_LOCKS: "0" };
  const top = await run(["rev-parse", "--show-toplevel"], { cwd: root, env, timeoutMs });
  if (top.error) return { repo: null, error: top.error };
  if (top.code !== 0 || !top.out) return { repo: null, error: null };
  const repo = top.out;
  const [st, log, user, origin, mains] = await Promise.all([
    run(["status", "--porcelain=v2", "--branch", "-z"], { cwd: repo, env, timeoutMs }),
    run(["log", `--max-count=${MAX_COMMITS}`, "--format=%h%x09%s"], { cwd: repo, env, timeoutMs }),
    run(["config", "user.name"], { cwd: repo, env, timeoutMs }),
    run(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd: repo, env, timeoutMs }),
    run(["for-each-ref", "--format=%(refname:short)", ...BASE_NAMES.map((b) => `refs/heads/${b}`)], { cwd: repo, env, timeoutMs }),
  ]);
  if (st.code !== 0) return { repo, error: String(st.error || st.err || `git status exited ${st.code}`).split(/\r?\n/)[0].slice(0, 160) };
  const { branch, files } = parsePorcelainV2(st.out);
  const shown = files.filter((f) => f.kind !== "ignored");
  const local = String(mains.out || "").split(/\r?\n/).filter(Boolean);
  const main = origin.code === 0 && origin.out ? origin.out.replace(/^origin\//, "") : BASE_NAMES.find((b) => local.includes(b)) || null;
  return {
    repo,
    error: null,
    branch: branch.head,
    head: branch.head ? null : (branch.oid || "").slice(0, 7) || null,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    main,
    user: user.code === 0 && user.out ? user.out.split(/\r?\n/)[0] : null,
    status: shown.slice(0, MAX_STATUS).map((f) => `${f.kind === "untracked" ? "??" : `${f.index}${f.worktree}`.trim() || "?"} ${f.oldPath ? `${f.oldPath} -> ` : ""}${f.path}`),
    changed: shown.length,
    commits: log.code === 0
      ? String(log.out || "").split(/\r?\n/).filter(Boolean).map((line) => {
          const [short, ...subject] = line.split("\t");
          return { short, subject: cut(subject.join("\t"), 80) };
        })
      : [],
  };
}

/**
 * The project as its folder states it: the manifests, the package manager a lockfile (or package.json's
 * `packageManager`) names, package.json's scripts, the Makefile's targets, and the folder's top-level entries.
 * @param {string} root
 * @returns {ProjectFacts}
 */
export function projectFactsOf(root) {
  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const names = new Set(entries.map((e) => e.name));
  const manifests = [...MANIFESTS.filter((m) => names.has(m)), ...entries.map((e) => e.name).filter((n) => /\.(sln|csproj)$/i.test(n)).sort()];
  const readJson = (/** @type {string} */ name) => {
    try {
      const p = join(root, name);
      return statSync(p).size <= 1_048_576 ? JSON.parse(readFileSync(p, "utf8")) : null;
    } catch {
      return null;
    }
  };
  const lockFor = (/** @type {string[]} */ managers) => {
    const hit = LOCKFILES.find(([file, m]) => managers.includes(m) && names.has(file));
    return hit ? { manager: hit[1], lock: hit[0] } : null;
  };
  const pkg = names.has("package.json") ? readJson("package.json") : null;
  const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0].trim() : "";
  const node = names.has("package.json") ? (declared ? { manager: declared, lock: "packageManager" } : lockFor(["pnpm", "yarn", "bun", "npm"])) : null;
  const python = names.has("pyproject.toml") || names.has("requirements.txt") || names.has("Pipfile") ? lockFor(["uv", "poetry", "pipenv"]) : null;
  const allScripts = pkg?.scripts && typeof pkg.scripts === "object" ? Object.entries(pkg.scripts).filter(([, v]) => typeof v === "string") : [];
  /** @type {string[]} */
  let targets = [];
  if (names.has("Makefile")) {
    try {
      const text = readFileSync(join(root, "Makefile"), "utf8").slice(0, 65_536);
      targets = [...new Set([...text.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/gm)].map((m) => m[1]))].slice(0, MAX_TARGETS);
    } catch {
      targets = [];
    }
  }
  const listed = entries
    .filter((e) => e.name !== ".git")
    .map((e) => ({ name: e.isDirectory() ? `${e.name}/` : e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.dir ? -1 : 1));
  return {
    manifests,
    node,
    python,
    scripts: allScripts.slice(0, MAX_SCRIPTS).map(([k, v]) => [k, cut(String(v), 100)]),
    moreScripts: Math.max(0, allScripts.length - MAX_SCRIPTS),
    targets,
    top: listed.slice(0, MAX_TOP).map((e) => e.name),
    moreTop: Math.max(0, listed.length - MAX_TOP),
  };
}

/**
 * Everything the section states, as plain data — the chain stores it, so a turn after a restart renders the same.
 * A part that cannot be read is left out, never a failed turn.
 * @param {string} root  the working folder; "" for the machine alone (Settings → Prompts without a folder)
 * @param {{ now?: Date, env?: Record<string, string | undefined>, platform?: string, listen?: string | null, command?: string, cli?: string, gitRun?: typeof git }} [o]
 * @returns {Promise<EnvironmentFacts>}
 */
export async function captureEnvironment(root, { now = new Date(), env = process.env, platform = process.platform, listen = null, command = harnessCommand(), cli = cliCommand(), gitRun = git } = {}) {
  const folder = String(root || "");
  /** @type {[GitFacts | null, Awaited<ReturnType<typeof pathToolsOf>>]} */
  const [gitFacts, path] = await Promise.all([
    folder ? gitFactsOf(folder, { run: gitRun }).catch((/** @type {any} */ e) => ({ repo: null, error: String(e?.message || e) })) : null,
    keptPathTools({ env, platform }),
  ]);
  return {
    v: ENVIRONMENT_VERSION,
    root: folder,
    clock: clockOf(now),
    system: systemOf({ platform }),
    shell: { kind: SHELL.kind, name: SHELL.name, file: SHELL.file, flavor: SHELL.kind === "sh" ? shFlavor() : null },
    powershell: POWERSHELL ? { ...POWERSHELL } : null,
    path,
    harness: { command, listen, cli },
    git: gitFacts,
    project: folder ? projectFactsOf(folder) : null,
  };
}

/**
 * A capture behind a short per-folder cache (SP-D7): the New Task board asks on every pause in typing, and the
 * session's first turn — moments later — reuses the board's capture instead of running git again. Every ask sweeps
 * the folders past their time, so a folder typed letter by letter on the board leaves nothing behind; `size` is how
 * many the cache holds. A capture with PATH folders left unread stands `partialMs` from when it comes, so a session
 * starting after it — which keeps its capture for its life — captures again rather than freeze that one; a failure
 * is not kept.
 * @param {(root: string) => Promise<EnvironmentFacts>} capture
 * @param {{ ttlMs?: number, partialMs?: number, now?: () => number }} [o]
 * @returns {((root: string) => Promise<EnvironmentFacts>) & { readonly size: number }}
 */
export function cachedCapture(capture, { ttlMs = 15_000, partialMs = PARTIAL_KEPT_MS, now = Date.now } = {}) {
  /** @type {Map<string, { until: number, p: Promise<EnvironmentFacts> }>} */
  const cache = new Map();
  const ask = (/** @type {string} */ root) => {
    const k = String(root || "");
    const t = now();
    const hit = cache.get(k);
    if (hit && t < hit.until) return hit.p;
    for (const [key, v] of cache) if (t >= v.until) cache.delete(key);
    const p = capture(k);
    const entry = { until: t + ttlMs, p };
    cache.set(k, entry);
    p.then(
      (facts) => {
        if (facts?.path?.unread) entry.until = Math.min(entry.until, now() + partialMs);
      },
      () => {
        if (cache.get(k) === entry) cache.delete(k);
      },
    );
    return p;
  };
  return /** @type {any} */ (Object.defineProperty(ask, "size", { get: () => cache.size }));
}

/**
 * A session's stored capture when it still stands: taken for this folder, in this shape. Null otherwise — the loop
 * captures again, and `/autofit` weighs the prompt the next turn would send with the app's capture.
 * @param {any} stored @param {string} root
 * @returns {EnvironmentFacts | null}
 */
export const storedEnvironment = (stored, root) => (stored && stored.v === ENVIRONMENT_VERSION && stored.root === root ? stored : null);

/**
 * The session's environment, the same facts every turn (SP-D2): held per session and folder; on a miss, the chain's
 * stored capture when it was taken for this folder in this shape, else a new capture — handed to `store` (the
 * session's own agent stores it on its chain; a sub-agent in a worktree keeps its own here). A capture that fails
 * leaves the section out for the session rather than failing a turn. One with PATH folders left unread is held and
 * stored as any other — its section says which tools it could not vouch for — and never replaced by a later, whole
 * one: the session's prompt keeps its bytes; the caches hold it only briefly (`cachedCapture`, `keptPathTools`).
 * @param {{ capture: (root: string) => Promise<EnvironmentFacts>, limit?: number }} o
 */
export function createEnvironmentKeeper({ capture, limit = 256 }) {
  /** @type {Map<string, EnvironmentFacts | null>} */
  const held = new Map();
  return {
    /**
     * @param {{ key: string, root: string, stored?: any, store?: ((facts: EnvironmentFacts) => void) | null }} a
     * @returns {Promise<EnvironmentFacts | null>}
     */
    async forSession({ key, root, stored = null, store = null }) {
      const k = `${key}\n${root}`;
      if (held.has(k)) return held.get(k) ?? null;
      /** @type {EnvironmentFacts | null} */
      let facts = storedEnvironment(stored, root);
      if (!facts) {
        try {
          facts = await capture(root);
        } catch {
          facts = null;
        }
        if (facts && store) {
          try {
            store(facts);
          } catch {}
        }
      }
      held.set(k, facts);
      if (held.size > limit) held.delete(/** @type {string} */ (held.keys().next().value));
      return facts;
    },
  };
}

/** The command that tells the time now, in the shell that runs it. @param {EnvironmentFacts["shell"]} shell */
const nowCommand = (shell) => (shell.kind === "cmd" ? "echo %date% %time%" : "date");

/** PATH folders not read, counted in words: "1 PATH folder", "3 PATH folders". @param {number} n */
const unreadFolders = (n) => `${n} PATH folder${n === 1 ? "" : "s"}`;

/** A Windows folder as Git Bash spells it: H:\app is /h/app. @param {string} p */
const msysPath = (p) => (/^[A-Za-z]:/.test(p) ? `/${p[0].toLowerCase()}${p.slice(2)}` : p).replace(/\\/g, "/");

/** @param {EnvironmentFacts} f */
function shellLines(f) {
  const p = f.path;
  const sh = f.shell;
  /** @type {string[]} */
  const out = [];
  if (sh.kind === "git-bash") {
    const root = f.root || "C:\\project";
    out.push(
      `- Shell: the bash tool runs Git Bash (${sh.file}) — real bash on Windows, with grep, sed, awk, find, ls, cat, head, tail, xargs and the rest of Git's Unix tools. The working folder is ${root.replace(/\\/g, "/")} to Windows and ${msysPath(root)} to bash; give Windows programs (node, npm, git, python) the ${root.replace(/\\/g, "/")} form — bash converts ${msysPath(root)} only where it stands alone as an argument, never inside quoted code. Write /dev/null, never NUL. cmd's built-ins (dir, type, copy) are not commands here — cmd //c "…" runs one.`,
    );
  } else if (sh.kind === "cmd") {
    out.push(
      `- Shell: the bash tool runs cmd.exe, Windows' command prompt — not bash. Write cmd: dir, type, findstr, where, copy, move, del, mkdir, set, %VAR%, cd /d; chain with &&; silence output with >nul 2>&1; quote paths with double quotes. Paths are Windows paths — ${f.root || "C:\\project"}, or relative ones like src\\app.js; Unix forms like /c/Users, /h/project or ~ are not paths here.`,
    );
    const fallback = `use the read, grep and glob tools for files${f.powershell ? ", or the powershell tool for scripting" : ""}`;
    const off = p.unread ? `Not found in the PATH folders read (${unreadFolders(p.unread)} did not answer in time)` : "Not on PATH";
    if (!p.unixOn.length) out.push(`- ${off}: ${p.unixOff.join(", ")} — ${fallback}.`);
    else out.push(`- Unix tools on PATH: ${p.unixOn.join(", ")} — they run, but cmd parses the line: quote with double quotes, never single.${p.unixOff.length ? ` ${off}: ${p.unixOff.join(", ")}.` : ""}`);
    if (p.wslBash) out.push("- The bash on PATH is WSL's: it runs Linux, with this machine's drives under /mnt/ — not a way to reach this shell's tools.");
  } else if (sh.kind === "bash") out.push(`- Shell: the bash tool runs ${sh.file} -c (not a login shell: your profile's aliases and functions are not loaded).`);
  else out.push(`- Shell: the bash tool runs ${sh.file} -c${sh.flavor ? `, which is ${sh.flavor} here` : ""} — POSIX sh: bash-only syntax ([[ ]], arrays, <( )) needs bash -c '…'.`);
  const ps = f.powershell;
  if (ps)
    out.push(
      `- PowerShell: the powershell tool runs ${ps.name} (${ps.file}) — for processes with their command lines, services, the registry and .NET${ps.kind === "powershell" ? "; 5.1 has no &&, ||, ternary or ??" : ""}.`,
    );
  return out;
}

/** @param {EnvironmentFacts} f */
function folderLines(f) {
  if (!f.root) return ["- Working folder: named when a session starts"];
  const g = f.git;
  const win = f.path.platform === "win32";
  const native = (/** @type {string} */ p) => (win ? p.replace(/\//g, "\\") : p);
  /** @type {string[]} */
  const out = [];
  if (!g || (!g.repo && !g.error)) out.push(`- Working folder: ${f.root} — not a git repository`);
  else if (!g.repo) out.push(`- Working folder: ${f.root} — git: ${g.error}`);
  else {
    const repo = native(g.repo);
    const same = win ? repo.toLowerCase() === f.root.toLowerCase() : repo === f.root;
    const where = same ? "a git repository" : `inside the git repository at ${repo}`;
    const track = g.upstream ? ` (tracking ${g.upstream}${g.ahead || g.behind ? `: ${[g.ahead ? `${g.ahead} ahead` : "", g.behind ? `${g.behind} behind` : ""].filter(Boolean).join(", ")}` : ", up to date"})` : "";
    const on = g.branch ? `branch ${g.branch}${track}` : `detached at ${g.head || "an unborn commit"}`;
    out.push(`- Working folder: ${f.root} — ${where}, ${on}${g.main ? `; main branch: ${g.main}` : ""}${g.user ? `; git user: ${g.user}` : ""}`);
    if (g.error) out.push(`- Git status at start: unread — ${g.error}`);
    else {
      const changed = g.changed || 0;
      const more = changed - (g.status || []).length;
      out.push(`- Git status at start: ${changed ? `${changed} changed — ${(g.status || []).join(", ")}${more > 0 ? `, and ${more} more` : ""}` : "clean"}`);
      if (g.commits?.length) out.push(`- Recent commits:\n${g.commits.map((c) => `  ${c.short} ${c.subject}`).join("\n")}`);
    }
  }
  const pj = f.project;
  if (pj) {
    if (pj.manifests.length) {
      const how = [pj.node ? `${pj.node.manager}, from ${pj.node.lock}` : "", pj.python ? `${pj.python.manager}, from ${pj.python.lock}` : ""].filter(Boolean);
      out.push(`- Project files: ${pj.manifests.join(", ")}${how.length ? ` (${how.join("; ")})` : ""}`);
    }
    if (pj.scripts.length) {
      const run = pj.node?.manager === "yarn" ? "yarn <name>" : `${pj.node?.manager || "npm"} run <name>`;
      out.push(`- Scripts (${run}):\n${pj.scripts.map(([k, v]) => `  ${k}: ${v}`).join("\n")}${pj.moreScripts ? `\n  … and ${pj.moreScripts} more in package.json` : ""}`);
    }
    if (pj.targets.length) out.push(`- Make targets: ${pj.targets.join(", ")}`);
    if (pj.top.length) out.push(`- Top level: ${pj.top.join(", ")}${pj.moreTop ? `, and ${pj.moreTop} more` : ""}`);
  }
  return out;
}

/**
 * The section as the prompt carries it. `model` and `window` are the turn's (they change only with the model, which
 * starts a new cache anyway — SP-D4); everything else is the frozen capture.
 * @param {EnvironmentFacts} f
 * @param {{ model?: string, window?: number }} [live]
 */
export function environmentText(f, { model = "", window = 0 } = {}) {
  const c = f.clock;
  const lines = [
    `Captured when this session started: ${c.weekday} ${c.date}, ${c.time} (${[c.zone, c.offset].filter(Boolean).join(", ")}). None of it updates: for the time now, run ${nowCommand(f.shell)}; for the folder's state now, ask git.`,
  ];
  if (model) lines.push(`- Model: ${model}, through Filament${window ? `; context window ${Math.round(window).toLocaleString("en-US")} tokens` : ""}`);
  lines.push(`- System: ${f.system.name} (${f.system.kernel}, ${f.system.arch})${f.system.locale ? `; locale ${f.system.locale}` : ""}`);
  lines.push(...shellLines(f));
  const unread = f.path.unread || 0;
  if (unread) lines.push(`- On PATH: ${f.path.on.length ? f.path.on.join(", ") : "none of the common tools"}, in the folders read (${unreadFolders(unread)} did not answer in time)`);
  else if (f.path.on.length) lines.push(`- On PATH: ${f.path.on.join(", ")}`);
  if (f.harness.command) lines.push(`- Filament, the harness you run in: ${f.harness.command}${f.harness.listen ? ` on ${f.harness.listen}` : ""}. Never stop or restart it — your own turn ends with it.${f.harness.cli ? ` Its command line: \`${f.harness.cli} --help\` — status, models, keys, coding agents, memory, settings.` : ""}`);
  lines.push(...folderLines(f));
  return `# Environment\n${lines.join("\n")}`;
}

/**
 * The few words the New Task board shows for the section: system, shell, timezone, branch.
 * @param {EnvironmentFacts | null} f
 */
export function environmentSummary(f) {
  if (!f) return null;
  const g = f.git;
  return {
    system: f.system.name,
    shell: f.shell.name,
    zone: f.clock.zone || f.clock.offset,
    git: g?.repo ? (g.branch ? `${g.branch}${g.changed ? `, ${g.changed} changed` : ", clean"}` : `detached at ${g.head || "?"}`) : null,
  };
}
