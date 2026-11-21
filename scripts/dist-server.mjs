#!/usr/bin/env node
// @ts-check
// `npm run dist:server [-- --no-engine]`: Filament for a server, with no desktop app — tarballs a server unpacks and
// runs headless, in dist/server/<version>/ (a build of a version that is there already replaces it, as `npm run dist`'s
// does). Each holds everything Filament runs on: its own Node (node/bin/node, the one that runs this build), bin/ with a
// launcher that runs the command line by that Node from wherever it is linked, src/ with the harness, the memory
// sidecar, the production node_modules with node-pty as `npm ci` built it here, and the memory engine's bundle — the
// -no-engine one, made beside it, the same without the bundle, for a server whose memory has no engine; `--no-engine`
// makes that one alone, where there is no bundle to pack. Of the checkout's own files only what git tracks goes in,
// where it is git's. build-info.json at a tarball's top says it is a server's build, the glibc it was built on, and
// names the repository its updates are published to (electron-builder.yml's publish: invertibleMatrix/filament);
// latest-server.yml beside them gives each one's SHA-512 as the desktop app's latest*.yml give theirs
// (desktop/lib/updates.js's shaIn reads it), the whole one first.
//
// Built for the machine it runs on, Linux x64 or Linux arm64, and on no other: the memory engine's bundle is built on
// the machine it is for, and node-pty has no prebuilt binary there — npm ci builds it, against this machine's glibc,
// and it loads on none older. arm64's tarballs are named -linux-arm64, and latest-server-arm64.yml lists them, beside
// x64's latest-server.yml as electron-builder's latest-linux-arm64.yml is beside latest-linux.yml: an x64 install reads
// latest-server.yml, which names x64's alone, whatever else a release carries. The bundle
// is checked whole before anything is packed (scripts/check-memory-bundle.mjs); after, each tarball is unpacked into a
// throwaway folder and smoke-tested there: its build-info.json, its launcher's --version, the bundle inside it whole
// and the one its Filament finds, a terminal through its node-pty, and its Filament started on a throwaway data folder
// and port, answering /health with its version and serving the harness. Where one fails any of it, or the build
// breaks off, the tarballs and the update file are removed.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";
import { checkBundle, isMain, VENDOR_BUNDLES, wholeWords } from "./check-memory-bundle.mjs";
import { versionOf } from "./dist.mjs";
import { ptyHelpersRunnable } from "./pty-helper.mjs";
import { buildFacts } from "../desktop/lib/build-info.js";
import { releasesRepoOf } from "../desktop/lib/updates.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** What a server's build is for, each built on that machine alone. */
export const SERVER_TARGETS = ["linux-x64", "linux-arm64"];
/** x64's: the machine a name is for where none is given. */
export const SERVER_TARGET = "linux-x64";
/** The update file beside x64's tarballs, which a release carries for servers to check a download by. */
export const FEED = "latest-server.yml";
/** The file at the tarball's top that says what the build is. */
export const MARKER = "build-info.json";

/** Where a server's build of one version goes: dist/server/<version>. @param {string} root @param {string} version */
export const serverDir = (root, version) => join(root, "dist", "server", version);

/**
 * The tarball's name, for the machine `target`; `--no-engine`'s says so, so it is never taken for the whole one.
 * @param {string} version @param {boolean} [engine] @param {string} [target]
 */
export const tarballName = (version, engine = true, target = SERVER_TARGET) => `filament-server-${version}-${target}${engine ? "" : "-no-engine"}.tar.gz`;

/** The update file beside `target`'s tarballs: x64's latest-server.yml, latest-server-arm64.yml for arm64's. @param {string} [target] */
export const feedName = (target = SERVER_TARGET) => (target === SERVER_TARGET ? FEED : `latest-server-${target.replace(/^linux-/, "")}.yml`);

/** The folder the tarball unpacks into: its name without .tar.gz. @param {string} name */
export const topOf = (name) => name.replace(/\.tar\.gz$/, "");

/**
 * The build-info.json at a tarball's top: a server's build, its file and feed, the Node and glibc it was built with,
 * the repository its updates come from, and the build's facts — `official: true` where they say it (buildFacts, the
 * release CI's builds alone), nothing otherwise.
 * @param {{ version: string, target: string, engine: boolean, node: string, glibc: string | null, releases: { owner: string, repo: string }, facts: import("../desktop/lib/build-info.js").Build }} o
 */
export function markerOf({ version, target, engine, node, glibc, releases, facts }) {
  const { commit, subject, dirty, builtAt, official } = facts;
  return { kind: "server", version, target, file: tarballName(version, engine, target), feed: feedName(target), engine, node, glibc, releases: { provider: "github", ...releases }, commit, subject, dirty, builtAt, ...(official === true ? { official } : {}) };
}

/**
 * The repository electron-builder.yml publishes to — the one the installed builds look for their updates in — or
 * null where it names no GitHub one. @param {string} yml
 */
export function releasesOf(yml) {
  const block = /^publish:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))+)/m.exec(String(yml ?? ""))?.[1] || "";
  return releasesRepoOf(block.replace(/^[ \t]+/gm, ""));
}

/**
 * latest-server.yml: each tarball's name, SHA-512 (base64) and size, in electron-builder's latest*.yml form — a
 * `files` entry for each, in order, and the older `path`/`sha512` pair for the first.
 * @param {{ version: string, files: { name: string, sha512: string, size: number }[], at: string }} o
 */
export const feedOf = ({ version, files, at }) =>
  [
    `version: ${version}`,
    "files:",
    ...files.flatMap(({ name, sha512, size }) => [`  - url: ${name}`, `    sha512: ${sha512}`, `    size: ${size}`]),
    `path: ${files[0].name}`,
    `sha512: ${files[0].sha512}`,
    `releaseDate: '${at}'`,
    "",
  ].join("\n");

/** The launcher in bin/: the command line by the tarball's own Node, wherever the file is linked from. */
export const LAUNCHER = `#!/bin/sh
# Filament for servers (scripts/dist-server.mjs): its command line, run by the Node that comes with it.
here=$(dirname "$(readlink -f "$0")")
exec "$here/../node/bin/node" "$here/filament.js" "$@"
`;

/**
 * One entry of a tarball, by its path under the tarball's top folder: a folder, a file on disk (`from`) or bytes (`body`).
 * @typedef {{ name: string, mode: number, dir?: boolean, from?: string, body?: Buffer }} Entry
 */

const BLOCK = 512;
/** The largest file a tar header's 11 octal digits hold. */
const MAX_SIZE = 8 ** 11 - 1;

/** An octal field of `width` bytes: its digits, then NUL. @param {number} n @param {number} width */
const octal = (n, width) => `${n.toString(8).padStart(width - 1, "0")}\0`;

/**
 * Where a name goes in a ustar header: whole in `name` (100 bytes), or cut at a slash into `prefix` (155) and `name`;
 * null for one that fits neither, or is not ASCII — a pax header carries that one.
 * @param {string} name
 */
export function ustarName(name) {
  if (!/^[\x20-\x7e]*$/.test(name)) return null;
  if (name.length <= 100) return { name, prefix: "" };
  for (let i = name.indexOf("/"); i > 0; i = name.indexOf("/", i + 1))
    if (i <= 155 && name.length - i - 1 <= 100 && name.length - i - 1 > 0) return { name: name.slice(i + 1), prefix: name.slice(0, i) };
  return null;
}

/** A pax record, its length counting its own digits. @param {string} key @param {string} value */
function paxRecord(key, value) {
  const rest = Buffer.byteLength(` ${key}=${value}\n`);
  let len = rest + 1;
  while (len !== rest + String(len).length) len = rest + String(len).length;
  return `${len} ${key}=${value}\n`;
}

/** @param {{ name: string, prefix: string, mode: number, size: number, mtime: number, type: string }} h */
function header({ name, prefix, mode, size, mtime, type }) {
  const b = Buffer.alloc(BLOCK);
  b.write(name, 0, 100, "utf8");
  b.write(octal(mode, 8), 100, "ascii");
  b.write(octal(0, 8), 108, "ascii");
  b.write(octal(0, 8), 116, "ascii");
  b.write(octal(size, 12), 124, "ascii");
  b.write(octal(mtime, 12), 136, "ascii");
  b.write("        ", 148, "ascii");
  b.write(type, 156, "ascii");
  b.write("ustar\0", 257, "ascii");
  b.write("00", 263, "ascii");
  b.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return b;
}

/** The zeros that fill a block after `size` bytes. @param {number} size */
const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * The tarball's bytes, unzipped: every entry under `top`, each folder before what is in it — one not listed is made
 * as its first entry comes — and a file read as it goes, by the size it had as its header was written.
 * @param {Entry[]} entries @param {string} top @param {number} mtime  seconds
 */
async function* tarOf(entries, top, mtime) {
  const made = new Set();
  let pax = 0;
  /** @param {string} name @param {number} mode @param {number} size @param {string} type */
  function* head(name, mode, size, type) {
    const fit = ustarName(name);
    if (!fit) {
      const rec = Buffer.from(paxRecord("path", name));
      yield header({ name: `PaxHeaders/${pax++}`, prefix: "", mode: 0o644, size: rec.length, mtime, type: "x" });
      yield rec;
      yield padding(rec.length);
    }
    yield header({ ...(fit || { name: name.replace(/[^\x20-\x7e]/g, "_").slice(-100), prefix: "" }), mode, size, mtime, type });
  }
  /** @param {string} name */
  function* folder(name) {
    if (made.has(name)) return;
    made.add(name);
    yield* head(`${name}/`, 0o755, 0, "5");
  }
  yield* folder(top);
  for (const e of entries) {
    const name = `${top}/${e.name}`;
    const parts = name.split("/");
    for (let i = 2; i < parts.length; i++) yield* folder(parts.slice(0, i).join("/"));
    if (e.dir) {
      yield* folder(name);
      continue;
    }
    const size = e.body ? e.body.length : statSync(/** @type {string} */ (e.from)).size;
    if (size > MAX_SIZE) throw new Error(`${e.from || name} is larger than a tarball's file can be`);
    yield* head(name, e.mode, size, "0");
    if (e.body) yield e.body;
    else {
      let read = 0;
      for await (const chunk of createReadStream(/** @type {string} */ (e.from))) {
        read += chunk.length;
        if (read > size) throw new Error(`${e.from} grew while it was packed`);
        yield chunk;
      }
      if (read !== size) throw new Error(`${e.from} shrank while it was packed`);
    }
    yield padding(size);
  }
  yield Buffer.alloc(BLOCK * 2);
}

/**
 * The entries as a gzipped tarball at `file`, under the folder `top`, written beside it first and moved in once whole —
 * where either fails, what was written beside it goes: → its SHA-512 (base64) and size, taken as it is written.
 * @param {Entry[]} entries @param {string} file @param {{ top: string, mtime?: number }} o
 */
export async function writeTarGz(entries, file, { top, mtime = Math.floor(Date.now() / 1000) }) {
  const hash = createHash("sha512");
  let size = 0;
  const part = `${file}.part`;
  try {
    await pipeline(
      tarOf(entries, top, mtime),
      createGzip({ level: 6 }),
      async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          size += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    renameSync(part, file);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  return { sha512: hash.digest("base64"), size };
}

/** What a checkout holds that no build carries: Python's caches, a system's folder files, logs and scratch scripts. */
const JUNK = /(^|\/)(__pycache__|\.DS_Store|Thumbs\.db)(\/|$)|\.(pdb|log|tmp\.mjs|tmp\.js)$/;

/** @param {string} a @param {string} b */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every file under `dir` as entries named under `as`, in name order — a link is taken as what it links to — and the
 * ones `keep` turns away left out, a folder with all it holds; a folder left with nothing in it goes too (node-pty's
 * prebuilds/, every system's taken out). A file runnable here stays runnable (0755); the rest are 0644.
 * @param {string} dir @param {string} as @param {(name: string) => boolean} [keep] @returns {Entry[]}
 */
export function treeOf(dir, as, keep = () => true) {
  /** @type {Entry[]} */
  const out = [{ name: as, mode: 0o755, dir: true }];
  for (const n of readdirSync(dir).sort(byName)) {
    const from = join(dir, n),
      name = `${as}/${n}`;
    if (JUNK.test(name) || !keep(name)) continue;
    const st = statSync(from);
    if (st.isDirectory()) {
      const inside = treeOf(from, name, keep);
      if (inside.length > 1) out.push(...inside);
    } else if (st.isFile()) out.push({ name, mode: st.mode & 0o111 ? 0o755 : 0o644, from });
  }
  return out;
}

/** The checkout's folders a build packs files of. */
const OWN_DIRS = ["bin", "docs", "sidecar", "src", "starters"];

/**
 * The files git tracks in `dirs` of the checkout at `root`, with every folder they are in, by their paths from it —
 * what treeOf keeps there, so a developer's untracked .env, config.json, logs or screenshots never go in. Throws where
 * git can't list them.
 * @param {string} root @param {string[]} [dirs] @returns {Set<string>}
 */
export function trackedOf(root, dirs = OWN_DIRS) {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...dirs], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.error?.message || lastOf(r.stderr) || `exit code ${r.status}`);
  const out = new Set();
  for (const f of r.stdout.split("\0").filter(Boolean)) {
    const parts = f.split("/");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return out;
}

/**
 * The packages `npm ci --omit=dev` installs, by package-lock.json: their paths under the checkout (node_modules/…,
 * nested ones too), and whether each is optional — one for another system is not there, and is not missed.
 * @param {any} lock @returns {{ path: string, optional: boolean }[]}
 */
export const productionPackages = (lock) =>
  Object.entries(lock?.packages || {})
    .filter(([path, p]) => path.startsWith("node_modules/") && !p.dev && !p.devOptional && !p.link && !p.extraneous)
    .map(([path, p]) => ({ path, optional: !!p.optional }))
    .sort((a, b) => byName(a.path, b.path));

/**
 * What of node-pty a server runs: not its sources, its build's objects or another system's binaries — its lib/ and
 * the binary built here (build/Release) or prebuilt for `target`. Every other package's files go whole.
 * @param {string} target @returns {(name: string) => boolean}
 */
export const ptyKeeps = (target) => (name) => {
  const r = /^node_modules\/node-pty\/(.+)$/.exec(name)?.[1];
  if (!r) return true;
  if (/^(deps|third_party|src|scripts)(\/|$)/.test(r)) return false;
  if (/^build\/Release\/(obj\.target|\.deps)(\/|$)/.test(r)) return false;
  const prebuilt = /^prebuilds\/([^/]+)/.exec(r)?.[1];
  return !prebuilt || prebuilt === target;
};

/** node-pty's folder under `root`, or null. @param {string} root */
const ptyDirOf = (root) => {
  try {
    return dirname(createRequire(join(root, "package.json")).resolve("node-pty/package.json"));
  } catch {
    return null;
  }
};

/** node-pty's binary for `target` under `root`, as it loads one — built here, or prebuilt — or null. @param {string} root @param {string} target */
export function ptyBinary(root, target) {
  const pty = ptyDirOf(root);
  if (!pty) return null;
  return [join(pty, "build", "Release", "pty.node"), join(pty, "prebuilds", target, "pty.node")].find((f) => existsSync(f)) || null;
}

/** The libraries a Node leans on from the machine it runs on (a distribution's build: libnode, openssl…), by its config. @param {any} variables */
export const sharedLibs = (variables) =>
  Object.entries(variables || {})
    .filter(([k, v]) => /^node_shared/.test(k) && (v === true || v === "true"))
    .map(([k]) => (k === "node_shared" ? "libnode" : k.replace(/^node_shared_/, "")));

/** The environment a smoke test's programs run with: this one's, without what would send Filament to another data folder, bundle, machine, supervisor or memory engine (a test's stand-in). @param {NodeJS.ProcessEnv} [env] */
export function smokeEnv(env = process.env) {
  const e = { ...env };
  for (const k of ["FILAMENT_DATA_DIR", "FILAMENT_MEMORY_BUNDLE", "FILAMENT_MEMORY_SIDECAR", "FILAMENT_SUPERVISOR", "FILAMENT_MACHINE", "NODE_OPTIONS"]) delete e[k];
  return e;
}

/**
 * The environment the smoke test's Filament starts with: smokeEnv's, its memory engine bundle a folder in `at` that is
 * not there. With its own, memory would start installing the engine as it starts (memory.engine.autoInstall), and
 * nothing stops an install when Filament is stopped: its uv and Python would go on writing in the throwaway folder as
 * it is removed. That it finds its own bundle is tried apart, by FINDS_BUNDLE. @param {string} at @returns {NodeJS.ProcessEnv}
 */
export const serverEnv = (at) => ({ ...smokeEnv(), FILAMENT_MEMORY_BUNDLE: join(at, "no-bundle") });

/** The glibc this machine runs, as process.report gives it, or null where there is none (Windows, a Mac, musl). */
export const glibcOf = () => /** @type {any} */ (process.report?.getReport())?.header?.glibcVersionRuntime || null;

/**
 * What the build says of the glibc it was built on, which node-pty in it needs on a server: built on 2.34 or newer,
 * it asks for forkpty and openpty by symbol versions an older glibc lacks, and there Filament starts but no terminal.
 * @param {string | null} glibc
 */
export const glibcWords = (glibc) =>
  glibc
    ? `Built on glibc ${glibc}: its node-pty loads on a server with glibc ${glibc} or newer — on an older one Filament starts, but no terminal does.`
    : "The glibc it was built on is not known (process.report names none): its node-pty may not load on a server older than this machine, and there no terminal starts.";

/** What a program printed, in one line: the first that names an error, where the last few leave it out, and those. @param {string} text */
function lastOf(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines.slice(-6),
    error = lines.find((l) => /\b\w*Error\b/.test(l));
  return [...(error && !last.includes(error) ? [error] : []), ...last].join(" | ");
}

/**
 * A terminal started through node-pty as Filament starts one — by `node`, from the node-pty at `pty` — and a shell's
 * words read back from it: "" when they came, else what went wrong.
 * @param {{ node: string, pty: string, platform?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} o
 */
export function terminalStarts({ node, pty, platform = process.platform, env = smokeEnv(), timeoutMs = 30_000 }) {
  const shell = platform === "win32" ? ["cmd.exe", "/d", "/c", "echo filament-pty-ok"] : ["/bin/sh", "-c", "echo filament-pty-ok"];
  const script =
    'const pty = require(process.argv[1]); const t = pty.spawn(process.argv[2], process.argv.slice(3), { cols: 80, rows: 24 }); let out = ""; t.onData((d) => (out += d)); t.onExit(() => setTimeout(() => { process.stdout.write(out); process.exit(0); }, 200));';
  const r = spawnSync(node, ["-e", script, pty, ...shell], { encoding: "utf8", env, timeout: timeoutMs, windowsHide: true });
  if (r.error) return `node-pty started no terminal: ${r.error.message}`;
  return /filament-pty-ok/.test(r.stdout || "") ? "" : `node-pty started no terminal (exit code ${r.status}): ${lastOf(`${r.stderr}\n${r.stdout}`) || "it said nothing"}`;
}

/**
 * Filament started by `command` on a throwaway data folder and a port the system picks: it says where it listens,
 * answers /health with `version` and serves the harness's page; then it is stopped, and waited for. "" when it did all
 * that, else what went wrong, with the last it printed.
 * @param {{ command: string, args?: string[], version: string, dataDir: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} o
 */
export async function serverAnswers({ command, args = [], version, dataDir, env = smokeEnv(), timeoutMs = 90_000 }) {
  const child = spawn(command, [...args, "start", "--data-dir", dataDir, "--port", "0", "--host", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let said = "";
  /** @type {Promise<string>} */
  const ended = new Promise((done) => {
    child.once("error", (e) => done(`did not start: ${e.message}`));
    child.once("exit", (code, signal) => done(`ended (${signal || `exit code ${code}`})`));
  });
  /** @type {(url: string) => void} */
  let heard = () => {};
  const listening = new Promise((done) => (heard = done));
  for (const s of [child.stdout, child.stderr])
    s.on("data", (d) => {
      said += String(d);
      const url = /listening on (http:\/\/\S+)/.exec(said)?.[1];
      if (url) heard(url);
    });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const late = new Promise((done) => (timer = setTimeout(() => done(`did not say where it listens within ${Math.round(timeoutMs / 1000)} seconds`), timeoutMs)));
  try {
    const first = await Promise.race([listening.then((url) => ({ url })), ended.then((why) => ({ why })), late.then((why) => ({ why }))]);
    if ("why" in first) return `Filament ${first.why}: ${lastOf(said) || "it said nothing"}`;
    const url = /** @type {string} */ (first.url);
    const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(15_000) });
    const body = /** @type {any} */ (await health.json().catch(() => null));
    if (!health.ok || body?.version !== version) return `Filament's /health answered HTTP ${health.status} with ${JSON.stringify(body)}, not version ${version}`;
    const page = await fetch(`${url}/ui/harness.html`, { signal: AbortSignal.timeout(15_000) });
    const html = await page.text();
    if (!page.ok || !/<html/i.test(html)) return `Filament's harness page answered HTTP ${page.status}${page.ok ? " with no page" : ""}`;
    return "";
  } catch (/** @type {any} */ e) {
    return `Filament didn't answer: ${e?.message || e} (${lastOf(said) || "it said nothing"})`;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 20_000);
      await ended;
      clearTimeout(hard);
    }
  }
}

/** The tar that unpacks: Windows' own bsdtar, where Git Bash's GNU tar would read C: as a host. */
export const tarBin = () => {
  if (process.platform === "win32") {
    const t = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(t)) return t;
  }
  return "tar";
};

/** The tarball at `file` unpacked into `into` by the system's tar: "" or why not. @param {string} file @param {string} into */
export function untar(file, into) {
  const r = spawnSync(tarBin(), ["-xzf", file, "-C", into], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? "" : `tar could not unpack it: ${r.error?.message || lastOf(r.stderr) || `exit code ${r.status}`}`;
}

/** The code that says which bundle a Filament finds, run by its own Node: the module is its install.js. */
const FINDS_BUNDLE = 'const { bundleFor, bundleRoot } = await import(process.argv[1]); const r = bundleFor(bundleRoot()); process.stdout.write(JSON.stringify({ dir: r.bundle ? r.bundle.dir : "", why: r.why }));';

/**
 * The tarball smoke-tested where it is unpacked, in a throwaway folder that goes after: "" when it passed, else what
 * failed. `releases`: the repository its build-info.json must name; `target`: the machine it is for, this one.
 * @param {{ file: string, version: string, engine: boolean, releases: { owner: string, repo: string }, target?: string, log?: (line: string) => void, timeoutMs?: number }} o
 */
export async function smokeTest({ file, version, engine, releases, target = SERVER_TARGET, log = () => {}, timeoutMs }) {
  const at = mkdtempSync(join(tmpdir(), "filament-server-smoke-"));
  try {
    const unpacked = untar(file, at);
    if (unpacked) return unpacked;
    const dir = join(at, topOf(file.split(/[\\/]/).pop() || ""));
    /** @type {any} */
    let marker = null;
    try {
      marker = JSON.parse(readFileSync(join(dir, MARKER), "utf8"));
    } catch {}
    if (marker?.kind !== "server" || marker.version !== version || marker.engine !== engine || marker.releases?.owner !== releases.owner || marker.releases?.repo !== releases.repo)
      return `its ${MARKER} is not this build's: ${JSON.stringify(marker)}`;
    const v = spawnSync(join(dir, "bin", "filament"), ["--version"], { encoding: "utf8", env: smokeEnv(), timeout: 60_000 });
    if ((v.stdout || "").trim() !== version) return `bin/filament --version said ${JSON.stringify((v.stdout || "").trim())}, not ${version}: ${v.error?.message || lastOf(v.stderr) || `exit code ${v.status}`}`;
    const node = join(dir, "node", "bin", "node");
    if (engine) {
      const inside = await checkBundle({ root: join(dir, "vendor", "memory-engine"), target, inTarball: true, say: log });
      if (!inside.ok) return inside.why;
      const own = join(dir, "vendor", "memory-engine", target);
      const found = spawnSync(node, ["--input-type=module", "-e", FINDS_BUNDLE, pathToFileURL(join(dir, "src", "adapters", "sidecar", "install.js")).href], { encoding: "utf8", env: smokeEnv(), timeout: 60_000 });
      /** @type {any} */
      let r = null;
      try {
        r = JSON.parse(found.stdout);
      } catch {}
      if (!r?.dir || resolve(r.dir) !== resolve(own)) return `the Filament inside finds no memory engine bundle of its own: ${r?.why || lastOf(found.stderr) || JSON.stringify(found.stdout)}`;
    }
    const pty = terminalStarts({ node, pty: join(dir, "node_modules", "node-pty") });
    if (pty) return pty;
    log("Its Filament, started on a throwaway data folder and port…");
    return await serverAnswers({ command: join(dir, "bin", "filament"), version, dataDir: join(at, "data"), env: serverEnv(at), ...(timeoutMs ? { timeoutMs } : {}) });
  } finally {
    try {
      removeAll(at);
    } catch (e) {
      log(`The smoke test's throwaway folder ${at} can't be removed (${whyNot(e)}): remove it by hand.`);
    }
  }
}

/** A file or folder gone; a passing lock (a scanner reading a new file) is waited out a moment. @param {string} p */
const removeAll = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });

/** Why a removal failed, in a word: its code where it has one. @param {any} e */
const whyNot = (e) => e?.code || e?.message || String(e);

/**
 * @param {{ machine?: string, args?: string[], root?: string, vendor?: string, check?: typeof checkBundle,
 *   node?: { path: string, version: string, variables: any }, glibc?: () => string | null, facts?: () => import("../desktop/lib/build-info.js").Build,
 *   ptyHelpers?: (root: string) => string[], smoke?: typeof smokeTest, clear?: (dir: string) => void, remove?: (file: string) => void,
 *   log?: (line: string) => void, error?: (line: string) => void, now?: () => Date }} [o]
 *   `machine`: this machine's system and arch, the target built for; `node`: the Node the tarballs carry — this one — and its config's
 *   variables; `glibc`: this machine's, which node-pty is built against; `ptyHelpers`: node-pty's helpers made
 *   runnable; `smoke`: a tarball tried where it is unpacked
 * @returns {Promise<number>} the exit code
 */
export async function distServer({
  machine = `${process.platform}-${process.arch}`,
  args = [],
  root = ROOT,
  vendor = VENDOR_BUNDLES,
  check = checkBundle,
  node = { path: process.execPath, version: process.version, variables: process.config.variables },
  glibc = glibcOf,
  facts = () => buildFacts({ root }),
  ptyHelpers = (at) => ptyHelpersRunnable({ root: at, platform: "linux" }),
  smoke = smokeTest,
  clear = removeAll,
  remove = removeAll,
  log = console.log,
  error = console.error,
  now = () => new Date(),
} = {}) {
  const odd = args.filter((a) => a !== "--no-engine");
  if (odd.length) {
    error(`npm run dist:server takes --no-engine alone (a tarball without the memory engine), not ${odd.join(" ")}.`);
    return 2;
  }
  // The whole tarball and the -no-engine one, or with --no-engine that one alone.
  const whole = !args.includes("--no-engine");
  // The tarballs are this machine's: one machine's are never built on another.
  const target = SERVER_TARGETS.includes(machine) ? machine : "";
  if (!target) {
    error(`Filament's server build is for ${SERVER_TARGETS.join(" and ")}, each built on the machine it is for: the memory engine's bundle is built there, and npm ci builds node-pty there, so no machine builds another's. This machine is ${machine}; build it on Linux x64 or arm64 (WSL on Windows).`);
    return 1;
  }
  const version = versionOf(root);
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
    error(`package.json's version is no version to build: ${JSON.stringify(version)} (say one like 0.2.0 or 0.2.0-alpha.1).`);
    return 1;
  }
  const releases = existsSync(join(root, "electron-builder.yml")) ? releasesOf(readFileSync(join(root, "electron-builder.yml"), "utf8")) : null;
  if (!releases) {
    error("electron-builder.yml's publish names no GitHub repository: a server built now would not know where its updates are published.");
    return 1;
  }
  const shared = sharedLibs(node.variables);
  if (shared.length) {
    error(`The Node that runs this build (${node.path}) uses this machine's own ${shared.join(", ")}: in the tarball it would not start on a server without the same. Build with Node from nodejs.org (nvm, or actions/setup-node on CI).`);
    return 1;
  }
  if (whole) {
    const before = await check({ root: vendor, target, say: log });
    if (!before.ok) {
      error(`No server build without the memory engine: ${before.why} — or npm run dist:server -- --no-engine for one without it.`);
      return 1;
    }
    log(wholeWords(before.bundle));
  }
  // The tarball packs node-pty as it is here: its helpers runnable, and its binary built for this machine.
  try {
    for (const f of ptyHelpers(root)) log(`node-pty's helper made runnable: ${f}`);
  } catch (e) {
    error(`node-pty's helper can't be made runnable (${whyNot(e)}): the server's terminals would not start.`);
    return 1;
  }
  if (!ptyBinary(root, target)) {
    error(`node-pty is not built for ${target} in this checkout: npm ci builds it (with python3, make and a C++ compiler on the machine), and the server's terminals start through it.`);
    return 1;
  }
  /** @type {any} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  } catch (e) {
    error(`package-lock.json can't be read (${whyNot(e)}): it says which packages the server runs.`);
    return 1;
  }
  const packages = productionPackages(lock).filter((p) => existsSync(join(root, p.path)) || !p.optional);
  const missing = packages.filter((p) => !existsSync(join(root, p.path)));
  if (missing.length) {
    error(`${missing.map((p) => p.path).join(", ")} ${missing.length === 1 ? "is" : "are"} not installed: run npm ci, then build again.`);
    return 1;
  }

  if (!existsSync(join(root, ".git"))) {
    error(`dist:server builds from a git checkout, and ${root} is none (no .git): git says which files are the checkout's, and a developer's own beside them never go in.`);
    return 1;
  }
  /** @type {Set<string>} */
  let tracked;
  try {
    tracked = trackedOf(root);
  } catch (e) {
    error(`git can't list the checkout's files (${whyNot(e)}): a build of a git checkout packs only the files git tracks, never a developer's own beside them.`);
    return 1;
  }
  const own = (/** @type {string} */ n) => tracked.has(n);

  const built = facts();
  const { builtAt } = built;
  const builtOn = glibc();
  const out = serverDir(root, version),
    feed = join(out, feedName(target));
  /** What both tarballs hold, before the engine's bundle. @type {Entry[]} */
  const common = [];
  for (const f of ["package.json", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "README.md"]) if (existsSync(join(root, f))) common.push({ name: f, mode: 0o644, from: join(root, f) });
  common.push({ name: "bin/filament", mode: 0o755, body: Buffer.from(LAUNCHER) }, { name: "bin/filament.js", mode: 0o755, from: join(root, "bin", "filament.js") });
  for (const d of ["src", "docs", "starters"]) if (existsSync(join(root, d))) common.push(...treeOf(join(root, d), d, own));
  common.push(...treeOf(join(root, "sidecar"), "sidecar", (n) => n.endsWith(".py") && own(n)));
  for (const p of packages) common.push(...treeOf(join(root, p.path), p.path, (n) => n !== `${p.path}/node_modules` && ptyKeeps(target)(n)));
  const bundle = whole ? treeOf(join(vendor, target), `vendor/memory-engine/${target}`) : [];
  /** @type {Entry[]} */
  const nodeEntries = [{ name: "node/bin/node", mode: 0o755, from: node.path }];
  const nodeLicense = join(dirname(node.path), "..", "LICENSE");
  if (existsSync(nodeLicense)) nodeEntries.push({ name: "node/LICENSE", mode: 0o644, from: nodeLicense });
  const builds = (whole ? [true, false] : [false]).map((engine) => {
    const name = tarballName(version, engine, target);
    const marker = markerOf({ version, target, engine, node: node.version, glibc: builtOn, releases, facts: built });
    /** @type {Entry[]} */
    const entries = [...common, ...(engine ? bundle : []), ...nodeEntries, { name: MARKER, mode: 0o644, body: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`) }];
    return { engine, name, file: join(out, name), entries };
  });

  if (existsSync(out)) {
    log(`Replacing the server build of ${version} at ${out}.`);
    try {
      clear(out);
    } catch (e) {
      error(`The server build of ${version} at ${out} can't be replaced (${whyNot(e)}): a program has a file of it open. Close it and build again.`);
      return 1;
    }
  }
  mkdirSync(out, { recursive: true });
  const at = Number.isFinite(Date.parse(builtAt)) ? builtAt : now().toISOString();
  /** The tarballs made, in the feed's order. @type {{ engine: boolean, name: string, file: string, sha512: string, size: number }[]} */
  const made = [];
  /** What this build wrote, all removed where any of it fails. @type {string[]} */
  const written = [];
  let failed = "";
  try {
    for (const { entries, ...b } of builds) {
      log(`Packing ${entries.length} files and folders, with Node ${node.version} from ${node.path}, into ${b.file}…`);
      const { sha512, size } = await writeTarGz(entries, b.file, { top: topOf(b.name), mtime: Math.floor(Date.parse(at) / 1000) });
      written.push(b.file);
      made.push({ ...b, sha512, size });
    }
    written.push(feed);
    writeFileSync(feed, feedOf({ version, files: made, at }));
    for (const m of made) {
      log(`Smoke-testing ${m.name}, unpacked in a throwaway folder…`);
      const why = await smoke({ file: m.file, version, engine: m.engine, releases, target, log });
      if (why) {
        failed = `${m.name} failed its smoke test: ${why}`;
        break;
      }
    }
  } catch (/** @type {any} */ e) {
    failed = `the build broke off: ${e?.message || e}`;
  }
  if (failed) {
    for (const f of written)
      try {
        remove(f);
        error(`Removed ${f}: the build failed.`);
      } catch (e) {
        error(`Couldn't remove ${f} (${whyNot(e)}): the build failed — don't hand it on.`);
      }
    error(`The server build can't be handed on: ${failed}.`);
    return 1;
  }
  for (const m of made)
    log(`Filament ${version} for servers${m.engine ? "" : ", without its memory engine"}: ${m.file} (${(m.size / 1024 / 1024).toFixed(1)} MB) — tar -xzf it where it is to live, then ${topOf(m.name)}/bin/filament start.`);
  log(`Its update file: ${feed} — a release of ${releases.owner}/${releases.repo} offers ${made.length > 1 ? "them to servers with the tarballs" : "it to servers with the tarball"} beside it.`);
  log(glibcWords(builtOn));
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await distServer({ args: process.argv.slice(2) });
