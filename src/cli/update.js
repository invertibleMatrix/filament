// @ts-check
// `filament update` (the remote plan's sv-update): Filament for servers, as install.sh installed it — each version in a
// folder of its own under one folder (~/.local/share/filament, or $XDG_DATA_HOME/filament), `current` the link to the
// one that runs — updated where it is. The newest release of the repository its build-info.json names (or --version's),
// the tarball of the kind installed — with the memory engine, or without — for the machine its build is for (x64 or
// arm64), checked by the SHA-512 that machine's latest-server*.yml gives, unpacked beside the version that runs and
// renamed into place, then `current` moved to it in one rename.
// systemd's Filament restarts on it once no turn runs (filament restart's own way: --force does not wait, and restarts
// one that does not answer too); one started by hand is told to start again. The version before is kept, and --back
// points current at it again; older ones are removed, as install.sh removes them — one that cannot be is said. Nothing
// is half done: a download, a checksum, a glibc or an unpack that fails leaves current and the versions as they were,
// and the folder it worked in goes. A version systemd starts that does not come up is left for the one before: current
// pointed back, that one started, said in one line with what stands. Before a version starts on the data folder
// another wrote, the update says which stores' files it does not read and what it does with them (`sayUnread`). A
// checkout updates with git pull; the Filament app updates itself.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCheckout } from "../services/config/store.js";
import { STORE_FILES, STORE_FILES_BEFORE, asidesOf, setAside, setAsideIn, unreadBy } from "../services/store-files.js";
import { fetchInstaller, isNewer, lookForUpdate, serverAsset, serverTarball } from "../services/updates.js";
import { CliError, EXIT, clientAt, connect, whereFilament } from "./client.js";
import { processRuns } from "./listening.js";
import { UNIT, onPath, runTool, underSystemd } from "./service.js";

/** The file at a server build's top that says what it is (scripts/dist-server.mjs MARKER). */
const MARKER = "build-info.json";

/** How long the look at the releases waits on GitHub. */
const LOOK_MS = 30_000;

/** How long the Filament that runs is waited on to answer, before its restart: a busy one can take seconds. */
const ANSWER_MS = 10_000;

/** A release's version, as --version takes it (a v before it is taken too). */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** This Filament's own folder: a version's, where install.sh installed it — its launcher followed the links to it. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * What the update reads of this machine and of the Filament it runs from — a test's stand-ins: `root` this Filament's
 * folder, `glibc` this machine's, `fetch` how the releases are asked.
 * @type {{ root: string, glibc: () => string | null, fetch: typeof fetch }}
 */
export const here = { root: ROOT, glibc: glibcHere, fetch: (url, init) => fetch(url, init) };

/**
 * This machine's glibc as major.minor, read as install.sh reads it: getconf, else ldd's first line; null where the C
 * library is another, or neither says.
 */
function glibcHere() {
  const conf = spawnSync("getconf", ["GNU_LIBC_VERSION"], { encoding: "utf8", windowsHide: true });
  let v = /^glibc (\S+)/.exec(String(conf.stdout || "").trim())?.[1] || "";
  if (!v) {
    const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8", windowsHide: true });
    const first = `${ldd.stdout || ""}${ldd.stderr || ""}`.split("\n")[0].trim();
    if (/GLIBC|GNU libc/.test(first)) v = first.split(/\s+/).pop() || "";
  }
  return /^\d+\.\d+/.exec(v)?.[0] || null;
}

/** Whether the glibc `a` is older than `b`, each major.minor. @param {string} a @param {string} b */
const older = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] < y[0] || (x[0] === y[0] && (x[1] || 0) < (y[1] || 0));
};

/** A folder's name as a version's: digits first, three parts, nothing a path could climb out by (install.sh's is_version). @param {string} n */
const isVersion = (n) => /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(n);

/** A build's build-info.json, or null. @param {string} dir @returns {any} */
const buildOf = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), "utf8"));
  } catch {
    return null;
  }
};

/** A path's real one, links followed; null where there is none. @param {string} p */
const realOf = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** Whether `p` is a link (a junction on Windows). @param {string} p */
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Why a file call failed, in a word: its code where it has one. @param {any} e */
const whyNot = (e) => e?.code || e?.message || String(e);

/** A step of a way back, run: "" where it went, else why it did not (`whyNot`) — never thrown over the failure it follows. @param {() => void} step */
const undone = (step) => {
  try {
    step();
    return "";
  } catch (e) {
    return String(whyNot(e));
  }
};

/** Whether the folder `dir` is the build of the tarball `name`: its build-info.json names that file (install.sh's built_from). @param {string} dir @param {string} name */
const builtFrom = (dir, name) => !isLink(dir) && buildOf(dir)?.file === name && existsSync(join(dir, "bin", "filament"));

/**
 * The install this Filament is: its version's folder, the folder of its versions (`base`), its version, its kind, the
 * machine its build is for and the repository its releases are in. Refused in words where it is none install.sh
 * installed.
 * @param {string} root
 * @returns {{ dir: string, base: string, version: string, engine: boolean, target: string, owner: string, repo: string }}
 */
function installOf(root) {
  const dir = resolve(root);
  const build = buildOf(dir);
  if (build?.kind !== "server") {
    if (isCheckout(dir)) throw new CliError(`This Filament runs from a checkout (${dir}): git pull updates it, then filament restart.`, EXIT.failed);
    if (process.versions.electron || existsSync(join(dir, "desktop", "main.js"))) throw new CliError("The Filament app updates itself: Settings › About's Check now, or its tray's Check for updates.", EXIT.failed);
    throw new CliError(`This Filament (${dir}) is no server build: filament update updates Filament for servers, as install.sh installs it.`, EXIT.failed);
  }
  const owner = String(build.releases?.owner || ""),
    repo = String(build.releases?.repo || "");
  const named = build.releases?.provider === "github" && /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo);
  const base = dirname(dir),
    version = basename(dir);
  if (build.version !== version || !isLink(join(base, "current")) || realOf(join(base, "current")) !== realOf(dir))
    throw new CliError(
      `This Filament for servers (${dir}) is not where install.sh installs it — a version's folder, with current beside it pointing at it: install.sh installs one (curl -fsSL https://github.com/${named ? `${owner}/${repo}` : "invertibleMatrix/filament"}/releases/latest/download/install.sh | sh), which filament update then updates.`,
      EXIT.failed,
    );
  if (!named) throw new CliError(`This build's ${MARKER} names no GitHub repository its releases are published to: there is nowhere to look for an update.`, EXIT.failed);
  return { dir, base, version, engine: build.engine !== false, target: String(build.target || ""), owner, repo };
}

/**
 * `current` in `base` pointed at the version `version` — by its name, as install.sh links it — in one rename: a link
 * made beside it, then renamed over it. Windows renames no link over another (a junction there, which needs no
 * developer mode, and holds a full path alone: the version's): the old one goes first, and is made again where the
 * new one cannot take its place. What it throws is why the new link did not take its place, whatever failed after; the
 * link made beside it never stays; and where the old one could not be made again, the error's `gone` says why:
 * nothing is at current's path then.
 * @param {string} base @param {string} version
 */
function point(base, version) {
  const link = join(base, "current");
  const next = `${link}.new-${process.pid}`;
  /** The link made beside it, taken away: one that cannot be says nothing over what failed before it. */
  const drop = () => {
    try {
      unlinkSync(next);
    } catch {}
  };
  if (isLink(next)) unlinkSync(next);
  if (process.platform === "win32") symlinkSync(join(base, version), next, "junction");
  else symlinkSync(version, next, "dir");
  try {
    renameSync(next, link);
  } catch (e) {
    if (process.platform !== "win32") {
      drop();
      throw e;
    }
    /** @type {string} */
    let was;
    try {
      was = readlinkSync(link);
      unlinkSync(link);
    } catch {
      // The old one stays where it cannot be taken away: the rename's own error is the one to say.
      drop();
      throw e;
    }
    try {
      renameSync(next, link);
    } catch (/** @type {any} */ again) {
      drop();
      try {
        symlinkSync(was, link, "junction");
      } catch (lost) {
        throw Object.assign(again, { gone: whyNot(lost) });
      }
      throw again;
    }
  }
}

/**
 * The links an update that ended before its rename left beside current (`point`'s `current.new-<pid>`; install.sh
 * makes its own by that name), taken away where the process that made one runs no more — a crash, a kill, the power.
 * One whose process runs is another update at work, and stays; so does one that cannot be taken away, which stops
 * nothing. Looked for where an update is about to change the folder, never by a look (--check).
 * @param {string} base
 */
function sweepLinks(base) {
  for (const n of readdirSync(base)) {
    const pid = Number(/^current\.new-(\d+)$/.exec(n)?.[1]);
    if (!pid || pid === process.pid || processRuns(pid) || !isLink(join(base, n))) continue;
    try {
      unlinkSync(join(base, n));
    } catch {}
  }
}

/**
 * What stands where current could not be pointed away from the version `from`: it still points at it, or — Windows,
 * the old link not made again (`point`'s `gone`) — nothing is at its path, said with the command that makes it.
 * @param {string} base @param {string} from @param {any} e
 */
const stands = (base, from, e) => (e?.gone ? `current is gone — the link it was could not be made again (${e.gone}): make it with mklink /J "${join(base, "current")}" "${join(base, from)}"` : `it still points at ${from}`);

/**
 * current moved from `before` to `version`: every other version's folder removed — a folder named as a version that
 * holds a server build's build-info.json, as install.sh's prune — and said. One that cannot be removed is said, and
 * the rest goes on: current has moved, and the restart is still to come. → the versions removed.
 * @param {string} base @param {string} version @param {string} before @param {(s: string) => void} say
 */
function prune(base, version, before, say) {
  /** @type {string[]} */
  const removed = [];
  for (const n of readdirSync(base).sort()) {
    const d = join(base, n);
    if (n === version || n === before || !isVersion(n) || isLink(d) || !existsSync(join(d, MARKER))) continue;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch (e) {
      say(`Filament ${n} could not be removed (${whyNot(e)}): remove ${d} by hand.`);
      continue;
    }
    removed.push(n);
    say(`Removed Filament ${n}, older than the two kept (${d}).`);
  }
  return removed;
}

/** The tar that unpacks: Windows' own bsdtar, where Git Bash's GNU tar would read C: as a host (dist-server.mjs's tarBin). */
const tarBin = () => {
  if (process.platform === "win32") {
    const t = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(t)) return t;
  }
  return "tar";
};

/** The tarball at `file` unpacked into `into` by the system's tar, as install.sh unpacks it: "" or why not. @param {string} file @param {string} into */
function untar(file, into) {
  const r = spawnSync(tarBin(), ["-xzf", file, "-C", into], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? "" : r.error?.message || String(r.stderr || "").trim().split("\n").pop() || `exit code ${r.status}`;
}

/**
 * The release `update` put in place beside the version `from`: downloaded into a folder of its own in `base`, checked
 * by its SHA-512, unpacked there, its glibc weighed against this machine's, renamed into <base>/<version>, and current
 * moved to it. Any of it that fails leaves current and the versions as they were, said in words; the folder goes either
 * way. Where the way back from a failure fails as well, that failure is still the one said, with what the way back
 * could not undo. A link a crashed update left beside current goes first (`sweepLinks`). → the version's folder.
 * @param {import("./commands.js").Run} r @param {{ base: string, version: string }} install
 * @param {import("../services/updates.js").Update} update @param {(s: string) => void} say
 */
async function putInPlace(r, { base, version: from }, update, say) {
  const dir = join(base, update.version);
  /** @param {string} why @param {string} [left]  what of the way back failed and what that leaves, where some of it did */
  const refuse = (why, left = "") => new CliError(`Filament ${update.version} was not installed: ${why}${left ? `, and ${left}. current` : ". Nothing changed — current"} still points at ${from}.`, EXIT.failed);
  sweepLinks(base);
  const work = mkdtempSync(join(base, ".update-"));
  try {
    say(`Downloading Filament ${update.version} (${update.name}${update.size ? `, ${(update.size / 1024 / 1024).toFixed(1)} MB` : ""})…`);
    /** @type {string} */
    let file;
    try {
      file = await fetchInstaller(update, work, { fetchImpl: here.fetch, signal: r.signal });
    } catch (/** @type {any} */ e) {
      if (r.signal?.aborted) throw new CliError(`Stopped: nothing changed — current still points at ${from}.`, EXIT.interrupted);
      throw refuse(String(e?.message || e));
    }
    const unpack = join(work, "unpack");
    mkdirSync(unpack);
    const torn = untar(file, unpack);
    if (torn) throw refuse(`tar could not unpack ${update.name} (${torn})`);
    rmSync(file, { force: true });
    const top = join(unpack, update.name.replace(/\.tar\.gz$/, ""));
    const build = buildOf(top);
    if (build?.kind !== "server" || build.version !== update.version || !existsSync(join(top, "bin", "filament"))) throw refuse(`${update.name} holds no Filament ${update.version} for servers to run`);
    // node-pty binds to the glibc it was built on: on an older one Filament starts, and no terminal does. The one that
    // runs here does: it stays.
    const glibc = here.glibc();
    const built = /^\d+\.\d+/.exec(String(build.glibc || ""))?.[0];
    if (glibc && built && older(glibc, built)) throw refuse(`it was built on glibc ${built}, and this machine has ${glibc} — Filament would start, but no terminal would open`);
    // The version's folder comes in by one rename, from beside it: a half one is never at its path. One there that is
    // not this build (the other tarball of the version, or one damaged) is set aside, and back if the rename fails.
    const old = join(work, "old");
    if (existsSync(dir) || isLink(dir)) renameSync(dir, old);
    const aside = () => existsSync(old) || isLink(old);
    /** The one set aside, back at the version's path. */
    const putBack = () => {
      if (aside()) renameSync(old, dir);
    };
    // A step of the way back can fail too: what failed first stays the failure said, the way back's beside it, with
    // what it leaves — the one set aside goes with the folder worked in.
    try {
      renameSync(top, dir);
    } catch (e) {
      const back = undone(putBack);
      throw refuse(`${dir} could not be put in place (${whyNot(e)})`, back && `what was there before could not be put back (${back}) and is gone`);
    }
    try {
      point(base, update.version);
    } catch (/** @type {any} */ e) {
      const away = undone(() => renameSync(dir, top));
      const back = away ? "" : undone(putBack);
      const left = away
        ? `its folder could not be taken away again (${away}): it stays in ${dir}${aside() ? ", in the place of the one that was there" : ""}`
        : back && `what was at ${dir} before could not be put back (${back}) and is gone`;
      if (e?.gone) throw new CliError(`Filament ${update.version} was not installed: current could not be pointed at it (${whyNot(e)}), and ${stands(base, from, e)}${left ? `; ${left}` : ""}.`, EXIT.failed);
      throw refuse(`current could not be pointed at it (${whyNot(e)})`, left);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return dir;
}

/** How many files a line about the stores names before it counts the rest. */
const FILES_NAMED = 3;

/**
 * What the build in `dir` reads of the stores' files: its own table (its services/store-files.js, read where it is),
 * or, for a build from before it carried one (`before`), what every such build read. Null where its table does not
 * read: nothing is said of it.
 * @param {string} dir @returns {Promise<{ stores: Record<string, any>, before: boolean } | null>}
 */
async function storesOf(dir) {
  const table = join(dir, "src", "services", "store-files.js");
  if (!existsSync(table)) return { stores: STORE_FILES_BEFORE, before: true };
  try {
    const m = await import(pathToFileURL(table).href);
    return m?.STORE_FILES && typeof m.STORE_FILES === "object" ? { stores: m.STORE_FILES, before: false } : null;
  } catch {
    return null;
  }
}

/**
 * Before Filament `to` starts on the data folder `from` ran on (r-itself, 11-12): each store's files of a version
 * `to` does not read, a line a store — the version they are, the one it reads, and what it does with them. A build
 * that carries the rule (services/store-files.js) sets each aside whole and starts with none, or with its own from
 * before; one from before the rule starts empty over it, so a copy of each is kept beside it here first, under the
 * name the rule gives one set aside. Either way the build that saved a file takes it back when it runs again — but a
 * build from before the rule, which takes nothing back: its own file, where a build that carries the rule set it
 * aside, is put in place for it here (a copy; the one set aside stays), once what is in place has its copy beside it.
 * Nothing here stops an update: what cannot be read or copied is said, or goes unsaid.
 * @param {string} dataDir @param {string} dir  `to`'s folder @param {string} to @param {string} from @param {(s: string) => void} say
 */
async function sayUnread(dataDir, dir, to, from, say) {
  const theirs = await storesOf(dir);
  if (!theirs) return;
  /** The files in place a copy of which was kept beside them here. @type {Set<string>} */
  const copied = new Set();
  /** By store and by the version found there. @type {Map<string, ReturnType<typeof unreadBy>>} */
  const groups = new Map();
  for (const u of unreadBy(dataDir, theirs.stores)) groups.set(`${u.key}\n${u.found}`, [...(groups.get(`${u.key}\n${u.found}`) || []), u]);
  /** @param {string[]} names */
  const named = (names) => (names.length > FILES_NAMED ? `${names.slice(0, FILES_NAMED).join(", ")} and ${names.length - FILES_NAMED} more` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]);
  for (const files of groups.values()) {
    const { key, found, reads } = files[0];
    const row = theirs.stores[key];
    const many = files.length > 1;
    const mine = Object.values(STORE_FILES).some((m) => m.file === row.file && m.dir === row.dir && String(m.version) === found);
    const taker = mine ? `Filament ${from}` : `a build that reads version ${found}`;
    const head = `${named(files.map((f) => f.name))} ${many ? "are" : "is"} version ${found}, which Filament ${to} does not read (it reads version ${reads}):`;
    if (!theirs.before) {
      const own = files.filter((f) => asidesOf(f.path, reads).length).length;
      const starts = typeof row.starts === "string" ? row.starts : "none of it";
      say(`${head} it sets ${many ? "each" : "the file"} aside whole under its version's name (${files[0].name}.v${found}.<when>), saves nothing over it, and starts with ${own === files.length ? "the one it saved before" : own ? `the one it saved before where it has one, else ${starts}` : starts}. ${taker[0].toUpperCase()}${taker.slice(1)} takes ${many ? "each" : "it"} back when it runs again.`);
      continue;
    }
    /** @type {string[]} */
    const kept = [];
    /** @type {string[]} */
    const not = [];
    for (const f of files)
      try {
        kept.push(setAside(f.path, f.found, { copy: true }));
        copied.add(f.path);
      } catch (e) {
        not.push(`${f.name} (${whyNot(e)})`);
      }
    const copies = kept.length ? ` A copy of ${many ? "each" : "it"} is kept beside it first (${named(kept)}), which ${taker} takes back when it runs again.` : "";
    const none = not.length ? ` No copy of ${named(not)} could be kept: copy ${not.length > 1 ? "them" : "it"} away before Filament ${to} starts.` : "";
    say(`${head} ${many ? "for each, " : ""}it ${row.does}.${copies}${none}`);
  }
  if (!theirs.before) return;
  /** Its own files put back, and what each was set aside as. @type {string[]} */
  const back = [];
  /** @type {string[]} */
  const from_ = [];
  for (const s of Object.values(theirs.stores)) {
    const names = s.file ? [s.file] : s.dir ? setAsideIn(join(dataDir, s.dir), s.version).map((n) => `${s.dir}/${n}`) : [];
    for (const name of names) {
      const path = join(dataDir, name);
      const own = asidesOf(path, s.version)[0];
      // Never over a file in place that has no copy beside it: one it reads, or one that names no version.
      if (!own || (existsSync(path) && !copied.has(path))) continue;
      try {
        copyFileSync(join(dirname(path), own), path);
        back.push(name);
        from_.push(own);
      } catch {}
    }
  }
  const them = back.length > 1;
  if (back.length) say(`${named(back)} ${them ? "are" : "is"} in place again as Filament ${to} reads ${them ? "them" : "it"} (from ${named(from_)}, which ${them ? "stay beside them" : "stays beside it"}): ${to} is from before this rule, and takes nothing back by itself.`);
}

/** The process systemd's unit runs Filament as: its pid, 0 where it runs none, or no systemd here says. @param {AbortSignal} [signal] */
async function unitPid(signal) {
  if (!onPath("systemctl")) return 0;
  const p = await runTool("systemctl", ["--user", "show", UNIT, "-p", "MainPID", "--value"], signal);
  return p.code === 0 ? Number(p.out) || 0 : 0;
}

/**
 * Filament restarted on the version current points at now, where something starts it again: systemd's, by filament
 * restart's own way — once no turn runs, unless --force; refused while one runs, the update stays and that is said
 * (exit 5). One systemd runs that does not answer — hung, or too busy to — is restarted by --force all the same, and
 * else goes on, said (exit 1): it cannot be asked to stop once idle. One started by hand is told to start again; none
 * that runs, said. One systemd started that did not come up is left for `from`, the version before (`goBack`); where
 * another version than `version` answers, current stays and that is said. What `version` does not read of the data
 * folder is said first (`sayUnread`). → how it went.
 * @param {import("./commands.js").Run} r @param {{ base: string, version: string, from: string }} to @param {(s: string) => void} say
 * @returns {Promise<"systemd" | "by-hand" | "not-running">}
 */
async function restartOn(r, { base, version, from }, say) {
  try {
    await sayUnread(r.dataDir, join(base, version), version, from, say);
  } catch {}
  /** systemd's restart, to `version`. @param {import("./client.js").Client} of */
  const restart = async (of) => {
    try {
      await underSystemd({ ...r, out: say }, of, "restart", version);
    } catch (/** @type {any} */ e) {
      if (e?.notUp) throw await goBack(r, { base, version, from }, e.notUp);
      if (e?.another) throw new CliError(`Filament ${version} is installed, and current points at it; ${e.message}`, EXIT.failed);
      throw e;
    }
  };
  /** @type {import("./client.js").Client | null} */
  let client = null;
  try {
    client = await connect(r.dataDir, { timeoutMs: ANSWER_MS, signal: r.signal });
  } catch (/** @type {any} */ e) {
    if (e?.code === EXIT.interrupted) throw e;
  }
  if (!client) {
    const pid = await unitPid(r.signal);
    if (!pid) {
      say(`No Filament answers now: it runs ${version} at its next start.`);
      return "not-running";
    }
    const url = whereFilament(r.dataDir).url;
    const mute = `systemd runs a Filament (process ${pid}) that did not answer at ${url} within ${ANSWER_MS / 1000} seconds`;
    if (r.flags.force !== true) throw new CliError(`Filament ${version} is installed, and current points at it; ${mute}, so it goes on — systemctl --user restart ${UNIT} starts ${version} now, and cuts what runs.`, EXIT.failed);
    say(`${mute}: --force restarts it.`);
    // --force restarts the unit at once and asks nothing of Filament: its answer once it runs again is waited for at
    // the data folder's address.
    await restart(clientAt(url, null));
    return "systemd";
  }
  if (client.state?.supervisor === "systemd") {
    try {
      await restart(client);
    } catch (/** @type {any} */ e) {
      if (e?.code !== EXIT.busy) throw e;
      throw new CliError(`Filament ${version} is installed, and current points at it; the Filament that runs (${client.version}) goes on — ${e.message}. filament restart starts ${version} once no turn runs (--force restarts it now, and cuts what runs).`, EXIT.busy);
    }
    return "systemd";
  }
  say(`Filament ${client.version} runs at ${client.url}, started by hand: it runs ${version} once it is started again — filament stop, then filament start.`);
  return "by-hand";
}

/**
 * The way back from `version`, which systemd started and which did not come up (`why`: service.js `upWords`): current
 * pointed at `from` again, and systemd's unit restarted on it at once. → the update's failure, one line that says what
 * stands — the version current points at and the one that runs —, and where the way back failed, what it left: current
 * still on `version` (or gone), or on `from`, which did not start either.
 * @param {import("./commands.js").Run} r @param {{ base: string, version: string, from: string }} to @param {string} why
 */
async function goBack(r, { base, version, from }, why) {
  const tried = `Filament ${version} did not come up — ${why} —,`;
  try {
    point(base, from);
  } catch (e) {
    return new CliError(`${tried} and current could not be pointed back at ${from} (${whyNot(e)}): ${stands(base, version, e)} — filament update --back goes back to ${from}, filament service status shows its log.`, EXIT.failed);
  }
  let ran = "";
  try {
    await underSystemd({ ...r, flags: { ...r.flags, force: true }, out: (s) => void (ran = s) }, clientAt(whereFilament(r.dataDir).url, null), "restart", from);
  } catch (/** @type {any} */ e) {
    if (e?.code === EXIT.interrupted) return e;
    return new CliError(`${tried} so current points at ${from} again, and ${from} did not start in its place either — ${e.notUp ? `${e.notUp}: filament service status shows its log.` : e.message}`, EXIT.failed);
  }
  return new CliError(`${tried} so current points at ${from} again: ${ran} ${version} is kept beside it (${join(base, version)}) — filament service status shows its log.`, EXIT.failed);
}

/** The version kept beside `version` to go back to: the newest other version's folder holding a server build. @param {string} base @param {string} version */
function keptOf(base, version) {
  const kept = readdirSync(base).filter((n) => n !== version && isVersion(n) && !isLink(join(base, n)) && buildOf(join(base, n))?.kind === "server" && existsSync(join(base, n, "bin", "filament")));
  return kept.sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))[0] || null;
}

/** current pointed at the version `to`, kept in `base`: refused in words where it can't be. @param {string} base @param {string} to @param {string} from */
function pointAt(base, to, from) {
  sweepLinks(base);
  try {
    point(base, to);
  } catch (e) {
    throw new CliError(`current could not be pointed at ${to} (${whyNot(e)}): ${stands(base, from, e)}.`, EXIT.failed);
  }
}

/**
 * `filament update [--check | --version <v> | --back] [--force] [--json]`.
 * @param {import("./commands.js").Run} r @returns {Promise<number | void>}
 */
export async function runUpdate(r) {
  /** What was said, for --json: each line in its `said`. @type {string[]} */
  const said = [];
  try {
    return await updating(r, said);
  } catch (e) {
    // --json keeps its lines for an answer that never comes now: they go ahead of the failure's words.
    for (const s of said) r.err(s);
    throw e;
  }
}

/** `filament update`'s work, its lines kept in `said` where --json asks. @param {import("./commands.js").Run} r @param {string[]} said @returns {Promise<number | void>} */
async function updating(r, said) {
  if (r.flags.machine || r.flags.url) throw new CliError("update runs on the machine Filament runs on: run it there (ssh <machine> filament update)", EXIT.usage);
  if (r.words.length) throw new CliError("usage: filament update [--check | --version <v> | --back] [--force]", EXIT.usage);
  const named = r.flags.version;
  const asked = typeof named === "string" ? named.replace(/^v/, "") : "";
  if (named !== undefined && !VERSION.test(asked)) throw new CliError("--version takes a release's version: --version 1.2.3", EXIT.usage);
  if (r.flags.back !== undefined && (named !== undefined || r.flags.check !== undefined)) throw new CliError("--back goes back to the version kept beside: it takes no --version or --check", EXIT.usage);
  const { base, version: installed, engine, target, owner, repo } = installOf(here.root);
  const json = r.flags.json === true;
  /** @param {string} s */
  const say = (s) => void (json ? said.push(s) : r.out(s));
  /** @param {Record<string, any>} value */
  const report = (value) => void (json && r.out(JSON.stringify({ ...value, said }, null, 2)));

  if (r.flags.back !== undefined) {
    const to = keptOf(base, installed);
    if (!to) throw new CliError(`No other version is kept in ${base} to go back to: Filament ${installed} is the only one.`, EXIT.failed);
    pointAt(base, to, installed);
    say(`current points at Filament ${to} again (${join(base, to)}); ${installed} is kept beside it — filament update --back goes back to it.`);
    const removed = prune(base, to, installed, say);
    const restart = await restartOn(r, { base, version: to, from: installed }, say);
    return report({ result: "back", from: installed, version: to, dir: join(base, to), kept: installed, removed, restart });
  }

  if (asked === installed) {
    if (json) return void r.out(JSON.stringify({ result: "installed", installed }, null, 2));
    return void r.out(`Filament ${installed} is installed, and current points at it: nothing changed.`);
  }
  // One kept beside, of the kind installed: pointed at again, with nothing asked of the releases.
  if (asked && r.flags.check === undefined && builtFrom(join(base, asked), serverTarball(asked, engine, target))) {
    pointAt(base, asked, installed);
    say(`Filament ${asked} was kept in ${join(base, asked)}: current points at it again; ${installed} is kept beside it — filament update --back goes back to it.`);
    const removed = prune(base, asked, installed, say);
    const restart = await restartOn(r, { base, version: asked, from: installed }, say);
    return report({ result: "kept", from: installed, version: asked, engine, dir: join(base, asked), kept: installed, removed, restart });
  }

  /** @type {{ update: import("../services/updates.js").Update<"server"> | null, why: string, newest?: boolean }} */
  let found;
  const signal = r.signal ? AbortSignal.any([r.signal, AbortSignal.timeout(LOOK_MS)]) : AbortSignal.timeout(LOOK_MS);
  try {
    found = await lookForUpdate({ current: installed, owner, repo, kind: "server", asset: serverAsset(engine, target), version: asked, fetchImpl: here.fetch, signal });
  } catch (/** @type {any} */ e) {
    if (r.signal?.aborted) throw new CliError("Stopped: nothing changed.", EXIT.interrupted);
    throw new CliError(e?.name === "TimeoutError" ? `GitHub didn't answer within ${LOOK_MS / 1000} seconds: nothing changed.` : `GitHub was not reached (${e?.message || e}): nothing changed.`, EXIT.failed);
  }
  const { update, why, newest } = found;
  if (!update) {
    if (!newest) throw new CliError(why, EXIT.failed);
    if (json) return void r.out(JSON.stringify({ result: "newest", installed, repo: `${owner}/${repo}` }, null, 2));
    return void r.out(`Filament ${installed} is already the newest release of ${owner}/${repo}: nothing to update.`);
  }
  if (r.flags.check !== undefined) {
    if (json) return void r.out(JSON.stringify({ result: "available", installed, version: update.version, file: update.name, size: update.size, page: update.page }, null, 2));
    return void r.out(`Filament ${update.version} is ${isNewer(update.version, installed) ? "out" : "published"} (this one is ${installed}): filament update${asked ? ` --version ${update.version}` : ""} installs it.`);
  }

  const dir = join(base, update.version);
  const kept = builtFrom(dir, update.name);
  if (kept) {
    pointAt(base, update.version, installed);
    say(`Filament ${update.version} was kept in ${dir}: current points at it again; ${installed} is kept beside it — filament update --back goes back to it.`);
  } else {
    await putInPlace(r, { base, version: installed }, update, say);
    say(`Filament ${update.version}${engine ? "" : ", without its memory engine,"} is installed in ${dir}, and current points at it; ${installed} is kept beside it — filament update --back goes back to it.`);
  }
  const removed = prune(base, update.version, installed, say);
  const restart = await restartOn(r, { base, version: update.version, from: installed }, say);
  return report({ result: kept ? "kept" : "updated", from: installed, version: update.version, engine, dir, kept: installed, removed, restart });
}
