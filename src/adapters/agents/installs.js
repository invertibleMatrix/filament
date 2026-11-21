// @ts-check
// The coding agents Filament installs from ACP's registry (HarnessV3-ACP AC3-8): each at the registry's exact version,
// in a folder of its own, `<data dir>/agents/installed/<id>/<version>`, so Filament can update and remove it end to
// end. An npm package goes in with npm's prefix there, a Python one with uv's tool folders there, a program to download
// unpacked into `program` there. What an install left is its receipt, `<id>/install.json`: the version, the command
// that starts the agent (its full path), and the registry's arguments and environment for it. The install itself runs
// in a terminal the person sees (the app's, or one of their own where none opens here; a program's download is the
// terminal's task, which Filament does itself); here it is planned, a program downloaded, and, once it ended well,
// found and settled. A folder no receipt names — an older version, an agent removed, an install stopped half way — is
// deleted when Filament next starts where it can't be now: Windows keeps a running program's files.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { commandLine } from "../../core/catalogues.js";
import { commandExists, resolveAgentCommand } from "./agent-process.js";
import { isAgentId, platformTarget } from "./registry.js";

/** @typedef {import("./registry.js").RegistryAgent} RegistryAgent */
/** @typedef {import("./registry.js").ProgramWay} ProgramWay */
/**
 * An install as planned: the agent and its version, the way, the folder, the installer with its arguments and the
 * variables it runs with, the line a person would type (a program's: its download's address); how the agent starts
 * once installed (`start`); and, for a program, its download for this computer (`program`).
 * @typedef {{ id: string, version: string, way: "npx" | "uvx" | "binary", package: string, folder: string, argv: string[],
 *   env: Record<string, string>, line: string, start: { args: string[], env: Record<string, string> }, program?: ProgramWay }} InstallPlan
 */
/**
 * What an install left: the agent's version, how it was installed (a program's `package` is its download's address),
 * and the command that starts it, with the registry's arguments and environment for that version.
 * @typedef {{ id: string, version: string, way: "npx" | "uvx" | "binary", package: string, command: string, args: string[],
 *   env: Record<string, string>, at: number }} Receipt
 */
/** What a program's download says as it goes, and the stop of the terminal it runs in. @typedef {{ say: (text: string) => void, signal: AbortSignal }} TaskIo */

/** A program's download at most: the registry's largest are a few hundred megabytes. */
export const PROGRAM_MAX_BYTES = 500 * 1024 * 1024;
/** The redirects a download follows at most. */
const HOPS = 10;
/** A command's name, as a file's: letters, digits, dots, dashes, underscores. */
const COMMAND = /^[\w-](?:[\w.-]{0,62}[\w-])?$/;
/** @param {string} a @param {string} b */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** A path strictly inside `base`. @param {string} base @param {string} p */
const within = (base, p) => {
  const r = relative(base, p);
  return !!r && !r.startsWith("..") && !isAbsolute(r);
};
/** A name in an archive that unpacks where it's put: no root, no drive, no `..`. @param {string} name */
const staysIn = (name) => {
  const n = name.replace(/\\/g, "/");
  return !n.startsWith("/") && !/^[a-z]:/i.test(n) && !n.split("/").includes("..");
};
/**
 * A name in an archive that unpacks under another entry that is no folder, which only a link can be: unzip would write
 * it through the link, wherever that leads, before `linkOut` sees it. Null where none does. Names are compared in any
 * case, as a Mac's disk takes them.
 * @param {string[]} names @returns {string | null}
 */
export const throughLink = (names) => {
  const clean = (/** @type {string} */ n) => n.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/").toLowerCase();
  const files = new Set(names.map(clean).filter((n) => n && !n.endsWith("/")));
  for (const name of names) {
    const n = clean(name);
    const parts = n.replace(/\/$/, "").split("/");
    // A folder named as a file is too: no archive made for real holds both.
    for (let i = 1; i < parts.length + (n.endsWith("/") ? 1 : 0); i++) if (files.has(parts.slice(0, i).join("/"))) return name;
  }
  return null;
};
/**
 * Where a program's command is once its download is unpacked into `<folder>/program`: the registry's `cmd`
 * (`./bin\devin.exe`, `harn.exe`) read with either separator. Null for one that names no file inside it.
 * @param {string} folder @param {string} cmd @returns {string | null}
 */
function programCommand(folder, cmd) {
  const root = join(folder, "program");
  const rel = cmd.replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || /^[a-z]:/i.test(rel)) return null;
  const file = resolve(root, rel);
  return within(root, file) ? file : null;
}
/** How a download is unpacked, by its address's name: a zip, a tarball, or a program as it is. @param {string} url */
const archiveKind = (url) => {
  const name = new URL(url).pathname.toLowerCase();
  return name.endsWith(".zip") ? "zip" : /\.(tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2?|tar\.zst)$/.test(name) ? "tar" : "raw";
};
/** The file a download is kept in while it's checked: its address's name, where that is a plain file's. @param {string} url */
const archiveName = (url) => {
  let n = "";
  try {
    n = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {}
  return /^[\w+-][\w.+-]{0,119}$/.test(n) && n.toLowerCase() !== "program" ? n : "download";
};
/** A size as a download's progress says it. @param {number} n */
const sizeWords = (n) => (n < 1024 * 1024 ? `${n} bytes` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

/**
 * A program run to its end, its output read: what it printed, or why it failed in words. The terminal's stop kills it.
 * @param {string} file @param {string[]} args @param {AbortSignal} signal @param {string} what  what it does, said in a failure
 * @returns {Promise<string>}
 */
function runTool(file, args, signal, what) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { windowsHide: true, signal, stdio: ["ignore", "pipe", "pipe"] });
    /** @type {Buffer[]} */
    const out = [];
    let err = "";
    child.stdout.on("data", (/** @type {Buffer} */ b) => out.push(b));
    child.stderr.on("data", (/** @type {Buffer} */ b) => void (err = (err + b).slice(-2000)));
    child.on("error", (e) => fail(signal.aborted ? signal.reason : new Error(`${basename(file)} couldn't ${what} it (${e.message})`)));
    child.on("close", (code) => {
      if (code === 0) return done(Buffer.concat(out).toString("utf8"));
      const last = err.trim().split(/\r?\n/).pop() || `it ended with code ${code}`;
      fail(new Error(`${basename(file)} couldn't ${what} it: ${last.slice(0, 300)}`));
    });
  });
}

/** A link among `root`'s files that leads outside it, by its name there; null where none does. @param {string} root */
function linkOut(root) {
  const folders = [root];
  for (let d = folders.pop(); d; d = folders.pop())
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isSymbolicLink()) {
        if (!within(root, resolve(dirname(f), readlinkSync(f)))) return relative(root, f);
      } else if (e.isDirectory()) folders.push(f);
    }
  return null;
}

/**
 * The command an npm package's `bin` names for the agent, as t3 finds it: the package's own name (without its scope)
 * for a lone script; a lone command; else the one named as the package or as the agent; else the first, where all run
 * one file. Null where none can be told.
 * @param {string} id @param {string} pkg @param {unknown} bin @returns {string | null}
 */
export function npmCommandName(id, pkg, bin) {
  const base = pkg.split("/").pop() || pkg;
  if (typeof bin === "string") return COMMAND.test(base) ? base : null;
  if (!bin || typeof bin !== "object") return null;
  const entries = Object.entries(bin)
    .filter(([k, v]) => COMMAND.test(k) && typeof v === "string")
    .sort(([a], [b]) => byText(a, b));
  if (entries.length === 1) return entries[0][0];
  const names = new Set(entries.map(([k]) => k));
  if (names.has(base)) return base;
  if (names.has(id)) return id;
  return entries.length && new Set(entries.map(([, v]) => v)).size === 1 ? entries[0][0] : null;
}

/**
 * The installs kept under `dir` (`<data dir>/agents/installed`); a program's download fetched with `fetch`, at most
 * `maxBytes`.
 * @param {{ dir: string, platform?: string, arch?: string, fetch?: typeof fetch, maxBytes?: number,
 *   log?: (level: string, msg: string) => void, now?: () => number }} o
 */
export function createInstalls({ dir, platform = process.platform, arch = process.arch, fetch: get = globalThis.fetch, maxBytes = PROGRAM_MAX_BYTES, log = () => {}, now = Date.now }) {
  const win = platform === "win32";
  /** This computer as the registry names systems. */
  const target = platformTarget(platform, arch);
  /** @param {string} id */
  const receiptFile = (id) => join(dir, id, "install.json");
  /** A path inside `dir`. @param {string} p */
  const inside = (p) => within(dir, p);

  /**
   * How a registry agent's version is installed here: npm's package where it has one, else uv's, else its program to
   * download for this computer; null where the registry has no build for it, or names a command outside its download.
   * @param {RegistryAgent} agent @returns {InstallPlan | null}
   */
  function plan(agent) {
    if (!isAgentId(agent.id)) return null;
    const folder = join(dir, agent.id, agent.version);
    if (agent.npx) {
      const argv = ["npm", "install", "--global", "--prefix", folder, `${agent.npx.name}@${agent.npx.version}`];
      return { id: agent.id, version: agent.version, way: "npx", package: agent.npx.name, folder, argv, env: {}, line: commandLine(argv, {}, platform), start: { args: agent.npx.args, env: agent.npx.env } };
    }
    if (agent.uvx) {
      const argv = ["uv", "tool", "install", "--force", `${agent.uvx.name}==${agent.uvx.version}`];
      const env = { UV_TOOL_DIR: join(folder, "tools"), UV_TOOL_BIN_DIR: join(folder, "bin") };
      return { id: agent.id, version: agent.version, way: "uvx", package: agent.uvx.name, folder, argv, env, line: commandLine(argv, env, platform), start: { args: agent.uvx.args, env: agent.uvx.env } };
    }
    const program = target && agent.binary ? agent.binary[target] || null : null;
    if (program && programCommand(folder, program.cmd))
      return { id: agent.id, version: agent.version, way: "binary", package: program.archive, folder, argv: [], env: {}, line: program.archive, start: { args: program.args, env: program.env }, program };
    return null;
  }

  /**
   * What lists and unpacks an archive here: Windows' own tar (bsdtar, from Windows 10 on) for a zip and a tarball
   * alike, never one the PATH puts first (Git's GNU tar reads no zip); elsewhere tar for a tarball, and for a zip unzip,
   * else bsdtar, else tar (macOS's is bsdtar). Throws, in words, where there is none.
   * @param {"zip" | "tar"} kind @returns {{ file: string, list: (archive: string) => string[], unpack: (archive: string, to: string) => string[] }}
   */
  function unpacker(kind) {
    const tarArgs = { list: (/** @type {string} */ a) => ["-tf", a], unpack: (/** @type {string} */ a, /** @type {string} */ to) => ["-xf", a, "-C", to] };
    if (win) {
      const tar = join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "tar.exe");
      if (!existsSync(tar)) throw new Error(`unpacking it needs Windows' own tar (${tar}), which isn't on this computer`);
      return { file: tar, ...tarArgs };
    }
    // A program started from the desktop may have a short PATH: the system's folders are looked in too.
    const tool = (/** @type {string} */ name) => (commandExists(name) ? resolveAgentCommand(name).file : ["/usr/bin", "/bin"].map((d) => join(d, name)).find((f) => existsSync(f)) || null);
    const unzip = kind === "zip" ? tool("unzip") : null;
    if (unzip) return { file: unzip, list: (a) => ["-Z1", a], unpack: (a, to) => ["-q", "-o", a, "-d", to] };
    const tar = (kind === "zip" && tool("bsdtar")) || tool("tar");
    if (!tar) throw new Error(`unpacking it needs ${kind === "zip" ? "unzip" : "tar"}, which isn't on this computer`);
    return { file: tar, ...tarArgs };
  }

  /**
   * A download fetched into `file`, over https only — each redirect followed by hand and checked — at most `maxBytes`,
   * its progress said as it comes. Answers its sha256.
   * @param {string} url @param {string} file @param {TaskIo} io @returns {Promise<string>}
   */
  async function fetchTo(url, file, { say, signal }) {
    let at = url;
    /** @type {Response} */
    let res;
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      res = await get(at, { redirect: "manual", signal });
      const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!to) break;
      await res.body?.cancel().catch(() => {});
      const next = new URL(to, at);
      if (next.protocol !== "https:") throw new Error("the download was sent on to an address that isn't https");
      if (hop >= HOPS) throw new Error(`the download was sent on more than ${HOPS} times`);
      at = next.href;
    }
    if (!res.ok) throw new Error(`its address answered ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const tooBig = new Error(`the download is larger than ${sizeWords(maxBytes)}`);
    if (total > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw tooBig;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("its address sent nothing");
    const hash = createHash("sha256");
    const out = await open(file, "w");
    let size = 0;
    let saidAt = 0;
    // Said over its own line, the rest of it cleared: a size said in megabytes is shorter than one in bytes.
    const progress = () => `\r\x1b[K  ${sizeWords(size)}${total ? ` of ${sizeWords(total)}  ${Math.floor((size * 100) / total)}%` : ""}`;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooBig;
        }
        hash.update(value);
        await out.write(value);
        if (Date.now() - saidAt > 250) {
          saidAt = Date.now();
          say(progress());
        }
      }
    } finally {
      await out.close();
    }
    say(`${progress()}\r\n`);
    return hash.digest("hex");
  }

  /**
   * A program's download (`plan`'s `binary` way), run as its install terminal's task: fetched (`fetchTo`), its checksum
   * checked where the registry gives one, each of its entries checked to unpack inside `<folder>/program` and then
   * unpacked there — a program that comes as it is copied there under its command's name — and its command found where
   * the registry names it. Throws, in words, at the first thing wrong; the version's folder goes when the install ends
   * so (`dropOthers`).
   * @param {InstallPlan} p @param {TaskIo} io
   */
  async function download(p, io) {
    const { say, signal } = io;
    const program = p.program;
    const command = program ? programCommand(p.folder, program.cmd) : null;
    if (!program || !command) throw new Error(`${p.id} has no program to download for this computer`);
    const kind = archiveKind(program.archive);
    const tool = kind === "raw" ? null : unpacker(kind);
    const root = join(p.folder, "program");
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    mkdirSync(p.folder, { recursive: true });
    const file = join(p.folder, archiveName(program.archive));
    try {
      say(`Downloading ${program.archive}\r\n`);
      const sha = await fetchTo(program.archive, file, io);
      if (program.sha256 && sha !== program.sha256)
        throw new Error(`its checksum isn't the one ACP's registry gives (sha256 ${sha.slice(0, 12)}…, not ${program.sha256.slice(0, 12)}…): nothing was installed`);
      say(program.sha256 ? "Its checksum is the one ACP's registry gives.\r\n" : "ACP's registry gives no checksum for it: it isn't checked.\r\n");
      if (!tool) {
        mkdirSync(dirname(command), { recursive: true });
        await rename(file, command);
      } else {
        const names = (await runTool(tool.file, tool.list(file), signal, "read")).split(/\r?\n/).filter(Boolean);
        const out = names.find((n) => !staysIn(n));
        if (out) throw new Error(`the download holds ${out}, which would unpack outside its folder: nothing was installed`);
        // A zip's folders are named with their `/`, so a name under one without it is a link's; unzip writes through one,
        // where tar (bsdtar, GNU tar) won't — and a tarball may name its folders without it (the review of 11-10).
        const under = kind === "zip" ? throughLink(names) : null;
        if (under) throw new Error(`the download holds ${under}, which would unpack through a link: nothing was installed`);
        say(`Unpacking ${basename(file)}…\r\n`);
        mkdirSync(root, { recursive: true });
        await runTool(tool.file, tool.unpack(file, root), signal, "unpack");
        const link = linkOut(root);
        if (link) {
          await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
          throw new Error(`the download holds ${link}, a link that leads outside its folder: nothing was installed`);
        }
      }
    } finally {
      await rm(file, { force: true });
    }
    if (!existsSync(command)) throw new Error(`the download holds no ${program.cmd}, the command ACP's registry names`);
    if (!win) chmodSync(command, 0o755);
    say(`Installed: ${command}\r\n`);
  }

  /** Where npm put the package's command: its `bin`, read from the package it installed. @param {InstallPlan} p */
  function npmCommand(p) {
    const root = win ? join(p.folder, "node_modules", p.package) : join(p.folder, "lib", "node_modules", p.package);
    /** @type {any} */
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    } catch {
      throw new Error(`the install ended, but ${p.package} isn't in ${p.folder}`);
    }
    const name = npmCommandName(p.id, p.package, manifest?.bin);
    if (!name) throw new Error(`${p.package} names no command Filament can tell is the agent's`);
    const command = win ? join(p.folder, `${name}.cmd`) : join(p.folder, "bin", name);
    if (!existsSync(command)) throw new Error(`the install ended, but ${p.package}'s command ${name} isn't where npm puts it`);
    return command;
  }

  /** Where uv put the agent's command: one named as the agent, as its package, or as that without `-acp`. @param {InstallPlan} p */
  function uvCommand(p) {
    const names = [...new Set([p.id, p.package, p.package.replace(/-acp$/, "")])].filter((n) => COMMAND.test(n));
    const command = names.map((n) => join(p.folder, "bin", win ? `${n}.exe` : n)).find((f) => existsSync(f));
    if (!command) throw new Error(`the install ended, but uv made none of the commands ${names.join(", ")} in ${join(p.folder, "bin")}`);
    return command;
  }

  /** Where a program's download put its command. @param {InstallPlan} p */
  function programFound(p) {
    const command = p.program ? programCommand(p.folder, p.program.cmd) : null;
    if (!command || !existsSync(command)) throw new Error(`the download ended, but its command ${p.program?.cmd || ""} isn't in ${join(p.folder, "program")}`);
    return command;
  }

  /**
   * An install that ended well, settled: its command found where its installer puts it, and its receipt written.
   * Throws, in words, where the command isn't there.
   * @param {InstallPlan} p @returns {Receipt}
   */
  function settle(p) {
    const command = p.way === "npx" ? npmCommand(p) : p.way === "uvx" ? uvCommand(p) : programFound(p);
    /** @type {Receipt} */
    const receipt = { id: p.id, version: p.version, way: p.way, package: p.package, command, args: p.start.args, env: p.start.env, at: now() };
    const file = receiptFile(p.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(receipt, null, 2));
    renameSync(`${file}.tmp`, file);
    log("info", `agents: ${p.id} ${p.version} installed (${command})`);
    return receipt;
  }

  /**
   * The command an install left, where it ended well: what `settle` finds, its receipt not written — an install the
   * person ran in a terminal of their own, before Connect settles it. Null where there is none, and for a program's
   * download, which Filament settles as it ends: one found half way would be its command alone.
   * @param {InstallPlan} p @returns {string | null}
   */
  function found(p) {
    if (p.way === "binary" || !existsSync(p.folder)) return null;
    try {
      return p.way === "npx" ? npmCommand(p) : uvCommand(p);
    } catch {
      return null;
    }
  }

  /** The receipt of an agent Filament installed; null for one it didn't, or one whose receipt is not its. @param {string} id @returns {Receipt | null} */
  function receipt(id) {
    if (!isAgentId(id)) return null;
    try {
      const r = JSON.parse(readFileSync(receiptFile(id), "utf8"));
      const ok =
        r?.id === id &&
        typeof r.version === "string" &&
        (r.way === "npx" || r.way === "uvx" || r.way === "binary") &&
        typeof r.package === "string" &&
        typeof r.command === "string" &&
        inside(r.command) &&
        Array.isArray(r.args) &&
        r.args.every((/** @type {unknown} */ a) => typeof a === "string") &&
        r.env && typeof r.env === "object" && Object.values(r.env).every((v) => typeof v === "string");
      return ok ? { id, version: r.version, way: r.way, package: r.package, command: r.command, args: r.args, env: r.env, at: Number(r.at) || 0 } : null;
    } catch {
      return null;
    }
  }

  /** Every agent Filament installed, by its receipt. @returns {Receipt[]} */
  function all() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => receipt(name))
      .filter((r) => r !== null);
  }

  /**
   * A folder deleted, or why it stays until the next start.
   * @param {string} folder @returns {Promise<string | null>}  null once gone
   */
  async function drop(folder) {
    try {
      await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      return null;
    } catch (/** @type {any} */ e) {
      log("warn", `agents: ${folder} could not be deleted (${String(e?.message || e).slice(0, 160)}); it goes when Filament next starts`);
      return `${folder} is still in use: it is deleted when Filament next starts`;
    }
  }

  /**
   * An agent Filament installed, removed from this computer: its receipt, then its folder.
   * @param {string} id @returns {Promise<{ folder: string | null, kept: string | null }>}  the folder deleted, or why it stays
   */
  async function remove(id) {
    if (!isAgentId(id) || !existsSync(join(dir, id))) return { folder: null, kept: null };
    await rm(receiptFile(id), { force: true });
    const kept = await drop(join(dir, id));
    return { folder: kept ? null : join(dir, id), kept };
  }

  /**
   * The folders of an agent's versions no receipt names: an update's old one, an install that failed or was stopped.
   * @param {string} id @returns {Promise<string[]>}  why each that stays does
   */
  async function dropOthers(id) {
    if (!isAgentId(id) || !existsSync(join(dir, id))) return [];
    const keep = receipt(id)?.version;
    /** @type {string[]} */
    const kept = [];
    for (const v of readdirSync(join(dir, id), { withFileTypes: true }))
      if (v.isDirectory() && v.name !== keep) {
        const why = await drop(join(dir, id, v.name));
        if (why) kept.push(why);
      }
    return kept;
  }

  /** At Filament's start: what no receipt names goes — an agent's other versions, an agent with no receipt at all. */
  async function sweep() {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !isAgentId(e.name)) continue;
      if (receipt(e.name)) await dropOthers(e.name);
      else await drop(join(dir, e.name));
    }
  }

  return { plan, download, settle, found, receipt, all, remove, dropOthers, sweep };
}
