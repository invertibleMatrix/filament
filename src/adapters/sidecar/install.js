// Puts the Python engine for Mnemosyne under <dataDir>/memory-engine with no prerequisites on the machine, from the bundle
// that comes with Filament and from nothing else: offline, the engine exactly as it was built and proved for this
// release. It is never updated — a new engine comes with a new Filament, whose bundle replaces it — so no install can
// take newer packages than the release was tested with. The steps: uv → a uv-managed CPython → a venv with
// mnemosyne-memory and everything it needs, each wheel by its hash → the embedding model → a verify probe that writes
// engine.json. Every step reports progress, and every child process is hidden, piped and abortable. Environment
// variables are never logged.
//
//   memory-engine/
//     uv(.exe)          the bundle's uv
//     python/           uv-managed CPython (UV_PYTHON_INSTALL_DIR), from the bundle's archive
//     python-bin/       the executables uv makes for it (UV_PYTHON_BIN_DIR), kept out of the person's ~/.local/bin
//     venv/             mnemosyne-memory[embeddings], built from Filament's fork at its commit (ENGINE_COMMITS)
//     cache/uv          uv's cache;  cache/fastembed  the embedding model
//     engine.json       { installed, source, bundle, uv, uvVersion, python, venvPython, mnemosyneVersion, embeddings, embeddingModel, installedAt, log }
//
// The same steps by download (`downloadEngine`) are what a bundle is built from (scripts/build-memory-bundle.mjs): the
// one place that reaches the network. A bundle, one folder per machine (HarnessV3-AtHome AH-D2):
//
//   vendor/memory-engine/<platform>-<arch>/     (or FILAMENT_MEMORY_BUNDLE/<platform>-<arch>/)
//     uv(.exe)          the uv the bundle was built with
//     python/           the python-build-standalone archive uv names, under its release: uv's own install reads it
//                       as its download mirror — and downloads.json, uv's list of it with its sha256 (since 11-08: a
//                       Mac's archive holds programs signed after the release)
//     wheels/           mnemosyne-memory[embeddings] and everything it needs, built for this machine
//     requirements.txt  each wheel pinned by its sha256
//     fastembed/        the embedding model's cache, as plain files
//     manifest.json     { format, platform, arch, builtAt, uv, python, mnemosyne, source, embeddings, model, files: { path: sha256 } },
//                       and a Mac's `signed`: the Developer ID its programs were signed with before their hashes were taken,
//                       with `signedInside` where those inside its wheels and Python archive were too
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  readdirSync,
  lstatSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sidecarEnv as engineSidecarEnv } from "./client.js";
import { killTree } from "../tools/kill-tree.js";

const WIN = process.platform === "win32";
export const DEFAULT_VERSION = "3.15.1";
/** Filament's own fork of Mnemosyne: every engine it installs is built from it, never from PyPI. */
export const ENGINE_REPO = "https://github.com/invertibleMatrix/mnemosyne";
/**
 * Each Mnemosyne version a bundle is built from, by the fork's commit that holds it: the build's download takes that
 * commit's archive over HTTPS (no git needed on the machine). A version comes in here once it is tested.
 */
export const ENGINE_COMMITS = Object.freeze({ "3.15.1": "78506708aae344635e01a24f67a7319efc36fce9" });
/**
 * The archive version `version` is built from, or "" for a version the fork has no commit for here.
 * @param {string} version @param {Readonly<Record<string, string>>} [commits]
 */
export const engineSource = (version, commits = ENGINE_COMMITS) =>
  Object.hasOwn(commits, version) ? `${ENGINE_REPO}/archive/${commits[version]}.tar.gz` : "";
/**
 * The requirement an install hands uv or pip: `mnemosyne-memory @ <archive>`. Throws for a version the fork has no
 * commit for, before an install touches anything.
 * @param {string} version @param {boolean} embeddings @param {Readonly<Record<string, string>>} [commits]
 */
export function engineSpec(version, embeddings, commits = ENGINE_COMMITS) {
  const source = engineSource(version, commits);
  if (!source) throw new Error(`Filament installs no Mnemosyne ${version}: its fork has no commit for it here (the versions it installs: ${Object.keys(commits).join(", ")})`);
  return `mnemosyne-memory${embeddings ? "[embeddings]" : ""} @ ${source}`;
}
export const PYTHON_VERSION = "3.12";
/**
 * The embedding model a download install warms and a bundle build carries (the memory plan's c2): multilingual, about
 * fifty languages, so an ask in one finds a memory written in another by meaning; 384 dimensions, as the engine's vector
 * tables are made. An install from a bundle warms the model the bundle's manifest names, and engine.json records it.
 */
export const EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
const UV_RELEASES = "https://github.com/astral-sh/uv/releases/latest/download/";
const LOG_MAX = 200;
// Steps in order with the share of the overall percent each one owns (start → done).
const STEPS = {
  uv: [0, 15],
  python: [15, 35],
  venv: [35, 40],
  package: [40, 70],
  model: [70, 95],
  verify: [95, 100],
};

export function engineDir(dataDir) {
  return join(dataDir, "memory-engine");
}
const UV_NAME = WIN ? "uv.exe" : "uv";
const uvPath = (dir) => join(dir, UV_NAME);
const venvPythonPath = (dir) =>
  WIN ? join(dir, "venv", "Scripts", "python.exe") : join(dir, "venv", "bin", "python");
const stateFile = (dir) => join(dir, "engine.json");
const readState = (dir) => {
  try {
    const s = JSON.parse(readFileSync(stateFile(dir), "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
};
const writeState = (dir, state) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(dir), JSON.stringify(state, null, 2));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => (n / 1048576).toFixed(1);

// The uv release asset for a machine (exported so tests can build a matching archive).
export function uvAsset(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : null;
  const os =
    platform === "win32"
      ? "pc-windows-msvc"
      : platform === "darwin"
        ? "apple-darwin"
        : platform === "linux"
          ? "unknown-linux-gnu"
          : null;
  if (!cpu || !os) throw new Error(`no uv build for ${platform}/${arch}`);
  const triple = `${cpu}-${os}`,
    zip = platform === "win32",
    asset = `uv-${triple}.${zip ? "zip" : "tar.gz"}`;
  return { asset, triple, zip, url: UV_RELEASES + asset };
}

// What is installed, from engine.json plus existence checks: no venv interpreter means not installed.
export function engineState(dataDir) {
  const dir = engineDir(dataDir),
    s = readState(dir);
  const uv = existsSync(uvPath(dir)) ? uvPath(dir) : s.uv && existsSync(s.uv) ? s.uv : "";
  const venvPython = s.venvPython || venvPythonPath(dir);
  return {
    installed: s.installed === true && existsSync(venvPython),
    dir,
    // Where the install took its packages from: "bundle", or "download" for a bundle build's own ("" if engine.json is
    // silent: an engine installed before bundles were all there is).
    source: s.source || "",
    // The bundle it came from — its id (the manifest's sha256), when it was built, its Mnemosyne — or null.
    /** @type {{ id: string, builtAt: string, mnemosyne: string } | null} */
    bundle: s.bundle && typeof s.bundle.id === "string" ? s.bundle : null,
    uv,
    uvVersion: s.uvVersion || "",
    python: s.python || "",
    venvPython,
    pythonVersion: s.pythonVersion || "",
    mnemosyneVersion: s.mnemosyneVersion || "",
    embeddings: s.embeddings !== false,
    // The embedding model the install warmed, which the engine runs on ("" where engine.json names none: the engine's own).
    embeddingModel: typeof s.embeddingModel === "string" ? s.embeddingModel : "",
    sqliteVec: !!s.sqliteVec,
    fastembed: !!s.fastembed,
    installedAt: s.installedAt || null,
    updatedAt: s.updatedAt || null,
    log: Array.isArray(s.log) ? s.log.slice(-50) : [],
    error: s.error || null,
  };
}

// The environment Filament gives the sidecar (docs/memory-architecture.md §4). process.env is not included; the
// caller merges. `engine` is the engine dir or an engineState(); the fastembed cache lives inside it.
export function sidecarEnv({
  memoryFolder,
  base,
  apiKey = "",
  model = "",
  llmEnabled = false,
  embeddings = true,
  bank = "default",
  engine,
  dataDir,
  session,
} = {}) {
  const dir = typeof engine === "string" ? engine : engine?.dir || (dataDir ? engineDir(dataDir) : "");
  return engineSidecarEnv({
    memoryFolder,
    engineDir: dir,
    base,
    apiKey,
    model,
    llmEnabled,
    embeddings,
    embeddingModel: typeof engine === "object" && engine ? engine.embeddingModel || "" : "",
    bank,
    session,
  });
}

// ---- the bundle (AH-D2) ----
export const BUNDLE_FORMAT = 1;
/** The bundle's list of its Python for uv, in its python/ folder: the archive by its URL and the sha256 of its bytes. */
export const PYTHON_DOWNLOADS = "downloads.json";
const BUNDLE_DIR = fileURLToPath(new URL("../../../vendor/memory-engine", import.meta.url));
/** Where bundles are looked for: `vendor/memory-engine` in Filament, unless `FILAMENT_MEMORY_BUNDLE` names a folder. */
export const bundleRoot = (env = process.env) => env.FILAMENT_MEMORY_BUNDLE || BUNDLE_DIR;
// A path the manifest lists, inside the bundle: forward slashes, no drive, no empty, `.` or `..` part.
const insideRel = (rel) =>
  typeof rel === "string" &&
  !rel.includes("\\") &&
  !/^[a-zA-Z]:/.test(rel) &&
  rel.split("/").every((s) => s && s !== "." && s !== "..");
function manifestProblem(m, platform, arch) {
  if (!m || typeof m !== "object") return "its manifest can't be read";
  if (m.format !== BUNDLE_FORMAT) return `its manifest is format ${m.format}, which this Filament doesn't read`;
  if (m.platform !== platform || m.arch !== arch) return `it was built for ${m.platform}-${m.arch}`;
  for (const k of ["uv", "python", "mnemosyne"])
    if (typeof m[k] !== "string" || !m[k]) return `its manifest names no ${k} version`;
  const files = m.files && typeof m.files === "object" ? Object.entries(m.files) : [];
  for (const [rel, sum] of files) {
    if (!insideRel(rel)) return `its manifest lists a file outside it: ${rel}`;
    if (!/^[0-9a-f]{64}$/.test(String(sum))) return `its manifest gives ${rel} no sha256`;
  }
  const parts = [UV_NAME, "requirements.txt", "python/", "wheels/", ...(m.embeddings !== false ? ["fastembed/"] : [])];
  for (const p of parts)
    if (!files.some(([rel]) => (p.endsWith("/") ? rel.startsWith(p) : rel === p))) return `its manifest leaves out ${p}`;
  return null;
}
/**
 * The bundle for this machine under `root`, or null when there is none; `problem` says why one can't be used. `id`:
 * its manifest's sha256 — the manifest lists every file by its own, so another build, even of the same version, is
 * another bundle.
 * @returns {{ dir: string, manifest: any, id: string, problem: string | null } | null}
 */
export function readBundle(root, { platform = process.platform, arch = process.arch } = {}) {
  const dir = join(root, `${platform}-${arch}`),
    file = join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  let manifest = null,
    id = "";
  try {
    const bytes = readFileSync(file);
    id = createHash("sha256").update(bytes).digest("hex");
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {}
  return { dir, manifest, id, problem: manifestProblem(manifest, platform, arch) };
}
/** What gets a bundle in a checkout, and one that should have come with Filament. */
const REBUILD = "build it again with npm run engine:bundle";
/**
 * The bundle an install takes, or why there is none to take: this machine's, built for the engine this Filament pins
 * (`version`, from the fork's commit for it). By its manifest alone: each file is checked when an install takes it.
 * @param {string} root @param {{ version?: string, commits?: Readonly<Record<string, string>> }} [o]
 * @returns {{ bundle: NonNullable<ReturnType<typeof readBundle>> | null, why: string }}
 */
export function bundleFor(root, { version = DEFAULT_VERSION, commits = ENGINE_COMMITS } = {}) {
  const b = root ? readBundle(root) : null;
  if (!b)
    return { bundle: null, why: `this Filament has no memory engine bundle for ${process.platform}-${process.arch} in ${root}: reinstall Filament, or in a checkout build it with npm run engine:bundle` };
  if (b.problem) return { bundle: null, why: `the memory engine bundle at ${b.dir} can't be used: ${b.problem}` };
  const m = b.manifest;
  if (m.mnemosyne !== version)
    return { bundle: null, why: `the memory engine bundle at ${b.dir} holds mnemosyne ${m.mnemosyne}, and this Filament runs ${version}: ${REBUILD}` };
  if (m.source !== engineSource(version, commits))
    return { bundle: null, why: `the memory engine bundle at ${b.dir} holds a mnemosyne ${m.mnemosyne} not built from Filament's fork at the commit for it: ${REBUILD}` };
  return { bundle: b, why: "" };
}
/**
 * Whether the engine installed is the one this bundle installs: installed from it, by its id. Anything else — another
 * build's, a downloaded one, none — is not.
 * @param {{ installed: boolean, source: string, bundle: { id: string } | null }} state
 * @param {{ id: string } | null} bundle
 */
export const engineIsBundles = (state, bundle) =>
  !!(state.installed && bundle?.id && state.source === "bundle" && state.bundle?.id === bundle.id);
const sha256Of = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
/**
 * Every file the manifest lists, read and hashed: null when each is there and matches, or what is wrong. Before an
 * install takes the bundle, and before an installer carries it (scripts/check-memory-bundle.mjs).
 * @param {{ dir: string, manifest: any }} b
 * @param {{ signal?: AbortSignal, step?: string }} [o]  `step`: the install step a stop is said at
 * @returns {Promise<string | null>}
 */
export async function bundleDamage(b, { signal, step = "check" } = {}) {
  for (const [rel, sum] of Object.entries(b.manifest.files)) {
    if (signal?.aborted) throw abortError(step);
    const file = join(b.dir, ...rel.split("/"));
    if (!existsSync(file)) return `${rel} is missing`;
    let got;
    try {
      got = await sha256Of(file);
    } catch (e) {
      return `${rel} can't be read (${e.code || e.message})`;
    }
    if (got !== sum) return `${rel} differs from its manifest`;
  }
  // A stop while the last file was read is a stop all the same.
  if (signal?.aborted) throw abortError(step);
  return null;
}
// The bundle checked under `step`, before anything is taken from it. A damaged one stops the install, named: the check
// is there for damage, not for an attacker (anyone who can write the bundle can write Filament).
async function takeBundle(c, step) {
  const b = c.bundle;
  c.report(step, "progress", `checking the bundle's ${Object.keys(b.manifest.files).length} files`);
  const damage = await bundleDamage(b, { signal: c.signal, step });
  if (damage) throw stepError(step, `the memory engine bundle at ${b.dir} is damaged: ${damage}; reinstall Filament, or in a checkout ${REBUILD}`);
}
// With a bundle, uv is told to stay off the network (the model's warm-up tells the Hub the same).
const uvOffline = (c) => (c.bundle ? { UV_OFFLINE: "1" } : {});

// ---- errors: every failure names its step and carries the last lines of output (never the environment) ----
function stepError(step, message, tail = []) {
  const e = new Error(
    `memory engine ${step}: ${message}${tail.length ? "\n" + tail.slice(-30).join("\n") : ""}`,
  );
  e.step = step;
  e.output = tail.slice(-30);
  return e;
}
function abortError(step) {
  const e = new Error(`memory engine install aborted during ${step}`);
  e.name = "AbortError";
  e.step = step;
  e.aborted = true;
  return e;
}

// ---- the install context: progress reporting with a rolling log, and the child-process runner ----
function makeCtx({ dataDir, onProgress, signal, spawnImpl, fetchImpl, log }) {
  const c = {
    dir: engineDir(dataDir),
    signal,
    spawnImpl,
    fetchImpl,
    log: Array.isArray(log) ? log.slice(-LOG_MAX) : [],
    lastProgress: {},
  };
  c.report = (step, status, message = "", extra = {}) => {
    const [lo, hi] = STEPS[step] || [0, 100];
    const percent = extra.percent ?? (status === "start" ? lo : status === "progress" ? undefined : hi);
    const ev = { step, status, message: String(message).slice(0, 300), percent, ...extra };
    for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
    // Progress bars redraw many times a second; keep one line per 250 ms of those in the log.
    const now = Date.now(),
      bar = status === "progress" && /\d+%|\d+(\.\d+)?\s*(MB|kB|KiB|MiB)\/s|it\/s/.test(ev.message);
    if (!bar || now - (c.lastProgress[step] || 0) >= 250) {
      if (bar) c.lastProgress[step] = now;
      c.log.push(`${new Date(now).toISOString()} ${step} ${status}${ev.message ? " " + ev.message : ""}`);
      if (c.log.length > LOG_MAX) c.log.splice(0, c.log.length - LOG_MAX);
      try {
        onProgress(ev);
      } catch {}
    }
  };
  c.run = (step, file, args, o) => runChild(c, step, file, args, o);
  return c;
}

// Spawn one child: hidden window, piped output split into lines for progress, kill on abort. No clock: a slow download
// or build isn't a failure, its lines say how it goes, and the person stops it (HarnessV3-FailurePoints FP-D3).
// Resolves with the output on exit code 0; otherwise rejects with an error naming the step and quoting the last 30
// lines.
function runChild(c, step, file, args, { env = {}, cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (c.signal?.aborted) return reject(abortError(step));
    let child,
      settled = false;
    const tail = [],
      out = { stdout: "", stderr: "" },
      pend = { stdout: "", stderr: "" };
    const settle = (fn, v) => {
      if (settled) return;
      settled = true;
      c.signal?.removeEventListener("abort", onAbort);
      fn(v);
    };
    // A stop ends the step's process with what it started: uv killed alone leaves what it runs (a Python, a build)
    // running, and holding the engine's files.
    const kill = () => void killTree(child);
    const onAbort = () => {
      kill();
      settle(reject, abortError(step));
    };
    const feed = (name, d) => {
      const s = String(d);
      out[name] = (out[name] + s).slice(-65536);
      pend[name] += s;
      const parts = pend[name].split(/\r\n|\r|\n/);
      pend[name] = parts.pop();
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        try {
          onLine?.(line, name);
        } catch {}
      }
    };
    try {
      child = c.spawnImpl(file, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      return settle(reject, stepError(step, `could not start ${basename(file)} (${e.code || e.message})`));
    }
    c.signal?.addEventListener("abort", onAbort, { once: true });
    for (const name of ["stdout", "stderr"]) {
      const s = child[name];
      if (!s) continue;
      s.setEncoding?.("utf8");
      s.on("data", (d) => feed(name, d));
      s.on("error", () => {});
    }
    child.on("error", (e) =>
      settle(reject, stepError(step, `could not start ${basename(file)} (${e.code || e.message})`, tail)),
    );
    child.on("close", (code, sig) => {
      for (const name of ["stdout", "stderr"]) if (pend[name].trim()) feed(name, "\n");
      if (code === 0) settle(resolve, { code, stdout: out.stdout, stderr: out.stderr, tail: [...tail] });
      else
        settle(
          reject,
          stepError(
            step,
            `${basename(file)} ${args[0] || ""} exited with ${sig ? "signal " + sig : "code " + code}`,
            tail,
          ),
        );
    });
  });
}

// Stream a URL to a file, reporting bytes; verify against the sibling .sha256 when the release publishes one.
async function download(c, step, url, file) {
  const wrap = (e) =>
    c.signal?.aborted || e?.name === "AbortError"
      ? abortError(step)
      : stepError(step, `download failed: ${e.message}`);
  const res = await c
    .fetchImpl(url, {
      signal: c.signal,
      redirect: "follow",
      headers: { "user-agent": "filament-memory-install", accept: "application/octet-stream" },
    })
    .catch((e) => {
      throw wrap(e);
    });
  if (!res.ok) throw stepError(step, `HTTP ${res.status} downloading ${url}`);
  const total = Number(res.headers?.get?.("content-length")) || 0,
    hash = createHash("sha256"),
    out = createWriteStream(file);
  let done = 0,
    lastAt = 0,
    lastBytes = 0;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
      const now = Date.now();
      if (now - lastAt >= 500 || done - lastBytes >= 4 * 1048576) {
        lastAt = now;
        lastBytes = done;
        c.report(step, "progress", `downloading ${mb(done)}${total ? " / " + mb(total) : ""} MB`, {
          bytesDone: done,
          bytesTotal: total,
          percent: total
            ? Math.round(STEPS[step][0] + ((STEPS[step][1] - STEPS[step][0]) * done) / total)
            : undefined,
        });
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    throw wrap(e);
  }
  if (total && done !== total) throw stepError(step, `download incomplete (${done} of ${total} bytes)`);
  c.report(step, "progress", `downloaded ${mb(done)} MB`, { bytesDone: done, bytesTotal: total || done });
  try {
    const sum = await c.fetchImpl(url + ".sha256", {
      signal: c.signal,
      redirect: "follow",
      headers: { "user-agent": "filament-memory-install" },
    });
    const expected = sum.ok ? /^[0-9a-f]{64}/i.exec((await sum.text()).trim())?.[0] : null;
    if (expected && expected.toLowerCase() !== hash.digest("hex"))
      throw stepError(step, `sha256 mismatch for ${basename(url)}`);
    c.report(step, "progress", expected ? "checksum verified" : "no checksum published; continuing");
  } catch (e) {
    if (e.step) throw e;
    if (c.signal?.aborted) throw abortError(step);
    c.report(step, "progress", "checksum not available; continuing");
  }
}

// Windows ships bsdtar in System32 (it reads .zip too); under Git Bash a GNU tar comes first on PATH, so be explicit.
const tarBin = () => {
  if (WIN) {
    const t = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(t)) return t;
  }
  return "tar";
};
function findFile(dir, name, depth = 3) {
  let level = [dir];
  for (let d = 0; d <= depth && level.length; d++) {
    const next = [];
    for (const p of level) {
      let ents = [];
      try {
        ents = readdirSync(p, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of ents) {
        if (e.isFile() && e.name === name) return join(p, e.name);
        if (e.isDirectory()) next.push(join(p, e.name));
      }
    }
    level = next;
  }
  return "";
}
const uvEnv = (dir) => ({
  UV_PYTHON_INSTALL_DIR: join(dir, "python"),
  UV_PYTHON_BIN_DIR: join(dir, "python-bin"),
  UV_CACHE_DIR: join(dir, "cache", "uv"),
  UV_NO_MODIFY_PATH: "1",
  UV_PYTHON_PREFERENCE: "only-managed",
  UV_NO_PROGRESS: "1",
  NO_COLOR: "1",
  PYTHONUTF8: "1",
});
const pyEnv = (dir) => ({
  MNEMOSYNE_FASTEMBED_CACHE_DIR: join(dir, "cache", "fastembed"),
  HF_HUB_DISABLE_TELEMETRY: "1",
  PYTHONUTF8: "1",
  PYTHONUNBUFFERED: "1",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
});

// ---- the steps ----
async function uvVersion(c, uv, { soft = false } = {}) {
  try {
    const r = await c.run("uv", uv, ["--version"]);
    return /uv\s+(\S+)/.exec(r.stdout)?.[1] || r.stdout.trim().split(/\s+/)[1] || "?";
  } catch (e) {
    if (soft && !e.aborted) return "";
    throw e;
  }
}
async function stepUv(c) {
  const uv = uvPath(c.dir);
  c.report("uv", "start", "checking uv", { source: c.source });
  if (c.bundle) await takeBundle(c, "uv");
  // The bundle's own uv, always: its Python archive is laid out for the uv it was built with.
  if (c.bundle) {
    copyFileSync(join(c.bundle.dir, UV_NAME), uv);
    if (!WIN) chmodSync(uv, 0o755);
    c.uvVersion = await uvVersion(c, uv);
    c.report("uv", "done", `uv ${c.uvVersion} from the bundle`);
    return uv;
  }
  if (existsSync(uv)) {
    const v = await uvVersion(c, uv, { soft: true });
    if (v) {
      c.uvVersion = v;
      c.report("uv", "skip", `uv ${v} is already installed`);
      return uv;
    }
  }
  const { asset, url } = uvAsset();
  const tmp = join(c.dir, `tmp-uv-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const file = join(tmp, asset);
    c.report("uv", "progress", `downloading ${asset}`);
    await download(c, "uv", url, file);
    c.report("uv", "progress", `extracting ${asset}`);
    await c.run("uv", tarBin(), ["-xf", file, "-C", tmp], { cwd: tmp });
    const found = findFile(tmp, basename(uv)); // zip: uv.exe at the top; tar.gz: uv-<triple>/uv
    if (!found) throw stepError("uv", `${asset} did not contain ${basename(uv)}`);
    rmSync(uv, { force: true });
    renameSync(found, uv);
    if (!WIN) chmodSync(uv, 0o755);
  } finally {
    // What an archive unpacked keeps its modes, read-only ones among them: the promise form, as electron's Node, the desktop app's, stops at a read-only file where the promise form does not (HarnessV3-Native NA1).
    await rm(tmp, { recursive: true, force: true });
  }
  c.uvVersion = await uvVersion(c, uv);
  c.report("uv", "done", `uv ${c.uvVersion} installed`);
  return uv;
}
async function stepPython(c, { uv }) {
  // A bundle names its Python exactly, and uv installs it from the bundle's archive as if from its mirror — checked
  // against the sha256 the bundle's own list gives where it has one (every bundle built since 11-08): a Mac's archive
  // was opened to sign its programs, so uv's built-in sha256 of the release no longer fits it.
  const request = c.bundle ? c.bundle.manifest.python : PYTHON_VERSION;
  c.report("python", "start", `installing Python ${request}${c.bundle ? " from the bundle" : ""}`);
  const listing = c.bundle ? join(c.bundle.dir, "python", PYTHON_DOWNLOADS) : "";
  const env = {
      ...uvEnv(c.dir),
      ...(c.bundle ? { UV_PYTHON_INSTALL_MIRROR: pathToFileURL(join(c.bundle.dir, "python")).href } : {}),
      ...(listing && existsSync(listing) ? { UV_PYTHON_DOWNLOADS_JSON_URL: listing } : {}),
    },
    onLine = (line) => c.report("python", "progress", line);
  await c.run("python", uv, ["python", "install", request], { env, onLine });
  let python = "";
  try {
    const r = await c.run("python", uv, ["python", "find", request], { env });
    python = r.stdout.trim().split(/\r?\n/).pop() || "";
  } catch {}
  if (!python || !existsSync(python))
    python = findFile(join(c.dir, "python"), WIN ? "python.exe" : "python3") || python;
  if (!python)
    throw stepError(
      "python",
      `Python ${request} was installed but its interpreter was not found under ${join(c.dir, "python")}`,
    );
  c.report("python", "done", `Python ${request} ready`);
  return python;
}
async function stepVenv(c, { uv, python }) {
  const venv = join(c.dir, "venv"),
    venvPython = venvPythonPath(c.dir),
    onLine = (line) => c.report("venv", "progress", line);
  c.report("venv", "start", "creating the virtual environment");
  await c.run("venv", uv, ["venv", venv, "--python", python, "--clear"], {
    env: { ...uvEnv(c.dir), ...uvOffline(c) },
    onLine,
  });
  c.report("venv", "done", "virtual environment ready");
  return venvPython;
}
// The engine's package goes in anew each time, its dependencies only where they are missing: the same version from
// another source (PyPI, an earlier fork commit) never counts as installed.
async function stepPackage(c, { uv, venvPython, spec }) {
  const onLine = (line) => c.report("package", "progress", line);
  c.report("package", "start", `installing ${spec}${c.bundle ? " from the bundle" : ""}`);
  const anew = ["--reinstall-package", "mnemosyne-memory"];
  // From the bundle: its wheels only, each by the sha256 its requirements pin.
  const b = c.bundle;
  if (b)
    await c.run(
      "package",
      uv,
      ["pip", "install", "--python", venvPython, ...anew, "--offline", "--no-index", "--find-links", join(b.dir, "wheels")]
        .concat(["--require-hashes", "-r", join(b.dir, "requirements.txt")]),
      { env: { ...uvEnv(c.dir), ...uvOffline(c) }, onLine },
    );
  else
    await c.run("package", uv, ["pip", "install", "--python", venvPython, ...anew, spec], {
      env: uvEnv(c.dir),
      onLine,
    });
  c.report("package", "done", `${spec} installed`);
  return spec;
}
// Single quotes inside the snippets: nothing to escape on the Windows command line.
/** The script that loads `model` from the engine's cache, which proves it is there. @param {string} model */
// The model loaded and run once: an install proves its engine embeds, not that it imports — on a Mac under the hardened
// runtime the bundle's signed programs run with (scripts/build-memory-bundle.mjs), its proof install included.
const warmScript = (model) => `import os\nfrom fastembed import TextEmbedding\nm = TextEmbedding(model_name=${JSON.stringify(model)}, cache_dir=os.environ['MNEMOSYNE_FASTEMBED_CACHE_DIR'])\nassert len(list(m.embed(['warm']))[0]) > 0\nprint('ok')`;
const VERIFY = [
  "import json, sys",
  "out = {'python': sys.version.split()[0], 'mnemosyne': None, 'sqlite_vec': False, 'fastembed': False, 'load_ext': False}",
  "try:",
  "    import mnemosyne",
  "    v = getattr(mnemosyne, '__version__', None)",
  "    if not v:",
  "        from importlib.metadata import version",
  "        v = version('mnemosyne-memory')",
  "    out['mnemosyne'] = v",
  "except Exception as e:",
  "    out['error'] = 'mnemosyne: ' + str(e)",
  "try:",
  "    import sqlite3, sqlite_vec",
  "    out['sqlite_vec'] = True",
  "    c = sqlite3.connect(':memory:')",
  "    c.enable_load_extension(True)",
  "    sqlite_vec.load(c)",
  "    c.enable_load_extension(False)",
  "    out['load_ext'] = True",
  "except Exception as e:",
  "    out['warn'] = 'sqlite_vec: ' + str(e)",
  "try:",
  "    import fastembed",
  "    out['fastembed'] = True",
  "except Exception as e:",
  "    out['warn'] = (out.get('warn', '') + ' fastembed: ' + str(e)).strip()",
  "print(json.dumps(out))",
].join("\n");
/**
 * Every folder and file under `dir` (and `dir`) writable by its owner, links left as they are; none there, nothing. A
 * copy keeps its source's modes, and the Hub leaves its big files read-only (the owner's Mac of 11-08:
 * model_optimized.onnx and tokenizer.json -r--r--r-- in the app, and in the copy the next release's install could not
 * write over). @param {string} dir
 */
export function writable(dir) {
  if (!existsSync(dir)) return;
  const paths = [dir, ...readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => !e.isSymbolicLink()).map((e) => join(e.parentPath, e.name))];
  for (const p of paths) {
    const { mode } = lstatSync(p);
    if (!(mode & 0o200)) chmodSync(p, (mode & 0o7777) | 0o200);
  }
}
// The model warmed: the bundle's (its manifest's `model`), else this build's. → its name, "" with embeddings off.
async function stepModel(c, { venvPython, embeddings }) {
  const model = String(c.bundle?.manifest?.model || EMBEDDING_MODEL);
  c.report("model", "start", embeddings ? `warming the embedding model ${model}` : "");
  if (!embeddings) {
    c.report("model", "skip", "embeddings are off");
    return "";
  }
  const cache = join(c.dir, "cache", "fastembed");
  // From the bundle: the cache is its alone — what an earlier install left goes first (another release's model, a copy
  // no write gets over) — then its cache copied in, left writable for the next release's install, then warmed with the
  // Hub told to stay offline, which proves it loads.
  if (c.bundle) {
    writable(cache);
    await rm(cache, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  mkdirSync(cache, { recursive: true });
  if (c.bundle) {
    cpSync(join(c.bundle.dir, "fastembed"), cache, { recursive: true, force: true });
    writable(cache);
    c.report("model", "progress", "the embedding model copied from the bundle");
  }
  const r = await c.run("model", venvPython, ["-c", warmScript(model)], {
    env: { ...pyEnv(c.dir), ...(c.bundle ? { HF_HUB_OFFLINE: "1" } : {}) },
    onLine: (line) => c.report("model", "progress", line),
  });
  if (!/^ok\s*$/m.test(r.stdout)) throw stepError("model", "the embedding model did not load", r.tail);
  c.report("model", "done", "embedding model cached");
  return model;
}
async function stepVerify(c, { venvPython, embeddings }) {
  c.report("verify", "start", "checking the installation");
  const r = await c.run("verify", venvPython, ["-c", VERIFY], { env: pyEnv(c.dir) });
  let v = null;
  for (const line of r.stdout.split(/\r?\n/).reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      v = JSON.parse(line);
      break;
    } catch {}
  }
  if (!v) throw stepError("verify", "the verify probe printed no JSON", r.tail);
  if (!v.mnemosyne) throw stepError("verify", v.error || "mnemosyne could not be imported", r.tail);
  if (embeddings && (!v.sqlite_vec || !v.fastembed))
    throw stepError(
      "verify",
      `embeddings incomplete (sqlite_vec ${!!v.sqlite_vec}, fastembed ${!!v.fastembed})${v.warn ? ": " + v.warn : ""}`,
      r.tail,
    );
  if (embeddings && !v.load_ext)
    c.report(
      "verify",
      "progress",
      `sqlite-vec could not be loaded into SQLite${v.warn ? " (" + v.warn + ")" : ""}; vector search falls back to Python`,
    );
  c.report(
    "verify",
    "done",
    `mnemosyne ${v.mnemosyne} on Python ${v.python}${embeddings ? ", embeddings ready" : ""}`,
  );
  return v;
}
/** `touched`: the install had begun replacing what an engine installed runs on (its Python, its venv). */
function failed(c, saved, e, step, touched) {
  const at = e.step || step;
  c.report(at, "error", e.aborted ? "aborted" : String(e.message).split("\n")[0]);
  // Stopped before then — the bundle's check, its uv — an engine installed is still whole, and runs on.
  if (!touched && saved.installed === true) return e;
  try {
    writeState(c.dir, {
      ...saved,
      installed: false,
      error: e.aborted ? `install aborted during ${at}` : String(e.message).slice(0, 2000),
      log: c.log,
    });
  } catch {}
  return e;
}

// The steps in order, then engine.json: what both installs share. `embeddings`: the engine as it is built — a bundle's
// says, a download's always has them. Skips what is already there (uv answering --version, on a download).
async function runSteps(c, { spec, embeddings, saved }) {
  mkdirSync(c.dir, { recursive: true });
  let step = "uv";
  let touched = false;
  try {
    // The bundle's check and uv (which the engine does not run on): nothing an engine installed needs is touched.
    const uv = await stepUv(c);
    // From here on what an engine installed runs on is replaced (its Python, its venv): until the install ends, none is
    // installed — a Filament that quits halfway starts no half-rebuilt engine, and installs again.
    touched = true;
    if (saved.installed === true)
      writeState(c.dir, { ...saved, installed: false, error: "an install over it was under way and did not finish", log: c.log });
    step = "python";
    const python = await stepPython(c, { uv });
    step = "venv";
    const venvPython = await stepVenv(c, { uv, python });
    step = "package";
    await stepPackage(c, { uv, venvPython, spec });
    step = "model";
    const embeddingModel = await stepModel(c, { venvPython, embeddings });
    step = "verify";
    const v = await stepVerify(c, { venvPython, embeddings });
    const now = new Date().toISOString();
    const b = c.bundle;
    writeState(c.dir, {
      installed: true,
      source: c.source,
      bundle: b ? { id: b.id, builtAt: String(b.manifest.builtAt || ""), mnemosyne: b.manifest.mnemosyne } : null,
      uv,
      uvVersion: c.uvVersion || saved.uvVersion || "",
      python,
      venvPython,
      pythonVersion: v.python,
      mnemosyneVersion: v.mnemosyne,
      embeddings,
      embeddingModel,
      sqliteVec: !!(v.sqlite_vec && v.load_ext),
      fastembed: !!v.fastembed,
      installedAt: now,
      updatedAt: now,
      error: null,
      log: c.log,
    });
  } catch (e) {
    throw failed(c, saved, e, step, touched);
  }
}

/**
 * Install the engine from this machine's bundle under `bundle` (`bundleRoot()`), offline: the only install Filament
 * makes. Without a bundle that serves the engine this Filament pins (`version`), refused before anything is touched,
 * saying why; a damaged one stops at the damage. It never downloads. Returns engineState(dataDir).
 */
export async function installEngine({
  dataDir,
  bundle = bundleRoot(),
  version = DEFAULT_VERSION,
  commits = ENGINE_COMMITS,
  onProgress = () => {},
  signal,
  spawnImpl = spawn,
} = {}) {
  if (!dataDir) throw new Error("installEngine needs a dataDir");
  const spec = engineSpec(version, true, commits);
  const taken = bundleFor(bundle, { version, commits });
  if (!taken.bundle) throw new Error(taken.why);
  const saved = readState(engineDir(dataDir));
  const c = makeCtx({ dataDir, onProgress, signal, spawnImpl, fetchImpl: noFetch, log: saved.log });
  c.bundle = taken.bundle;
  c.source = "bundle";
  await runSteps(c, { spec, embeddings: taken.bundle.manifest.embeddings !== false, saved });
  return engineState(dataDir);
}
/** An install from a bundle reaches no network: a fetch is a bug. */
const noFetch = () => Promise.reject(new Error("an install from the bundle never downloads"));

/**
 * The engine by download, with embeddings: uv and Python from GitHub, the package from Filament's fork at its commit
 * and its dependencies as they resolve today, the model from the Hub. What a bundle is built from
 * (scripts/build-memory-bundle.mjs) and nothing else: Filament itself installs from the bundle alone. Returns
 * engineState(dataDir).
 */
export async function downloadEngine({
  dataDir,
  version = DEFAULT_VERSION,
  commits = ENGINE_COMMITS,
  onProgress = () => {},
  signal,
  fetchImpl = fetch,
  spawnImpl = spawn,
} = {}) {
  if (!dataDir) throw new Error("downloadEngine needs a dataDir");
  const spec = engineSpec(version, true, commits);
  const saved = readState(engineDir(dataDir));
  const c = makeCtx({ dataDir, onProgress, signal, spawnImpl, fetchImpl, log: saved.log });
  c.bundle = null;
  c.source = "download";
  await runSteps(c, { spec, embeddings: true, saved });
  return engineState(dataDir);
}

// Remove the whole engine dir. Windows holds files briefly after a process exits, hence the retries; the promise form,
// as electron's Node, the desktop app's, stops at a read-only file where the promise form does not (HarnessV3-Native NA1).
export async function uninstallEngine(dataDir) {
  const dir = engineDir(dataDir),
    existed = existsSync(dir);
  for (let i = 0; ; i++) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return { ok: true, removed: existed, dir };
    } catch (e) {
      if (i >= 5 || !["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(e.code))
        throw new Error(
          `could not remove ${dir} (${e.code || e.message}); stop the memory engine and try again`,
        );
      await sleep(300 * (i + 1));
    }
  }
}
