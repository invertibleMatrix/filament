// @ts-check
// Builds the memory engine's bundle for this machine (HarnessV3-AtHome AH-D2): what an install takes offline instead of
// downloading, in `<vendor/memory-engine or FILAMENT_MEMORY_BUNDLE or --out>/<platform>-<arch>/`. It DOWNLOADS about
// 500 MB (uv, Python, the wheels, the embedding model), so it runs only when someone runs it:
//
//   node scripts/build-memory-bundle.mjs [--version 3.15.1] [--out <folder>] [--keep]
//
// The bundle is the engine Filament installs, and the only one: an install never downloads (src/adapters/sidecar/install.js).
// Building it is where the network is reached, so a release's engine is the one this build froze and proved.
//
// The steps, in a staging folder beside the bundle's place and a temporary folder for the installs:
//   1. a download install (uv, Python, the package from Filament's fork, the model);
//   2. the python-build-standalone archive uv installed that Python from, under its release, so uv reads the bundle's
//      python/ folder as its download mirror (and checks the archive against its own sha256 as it installs it);
//   3. the wheels of exactly what the download install holds (uv's freeze), made by pip in a seeded venv;
//   4. the embedding model's cache with its links resolved, without the Hub's blobs/ and .locks/ — and on a Mac its
//      programs signed with the Developer ID Application certificate the keychain holds, hardened and timestamped,
//      as notarization asks of every program an app carries (the owner's of 11-07): uv, and those inside its archives,
//      which Apple's notary opens (the wheels' libraries and the Python archive's interpreter and libraries: 67 refused
//      unsigned on the first notarized build, 11-08), each archive packed again with them; signed here, before the
//      manifest names their bytes, and left alone by electron-builder (electron-builder.yml's signIgnore), so the app's
//      copy is the one the manifest names;
//   5. requirements.txt, each wheel pinned by its sha256, and python/downloads.json, the Python archive by its own as
//      uv reads it (`PYTHON_DOWNLOADS`): a Mac's archive was opened to sign its programs, so uv's own sha256 of the
//      release no longer fits it;
//   6. manifest.json, every file by its sha256 — a Mac's with whom it was signed by (`signed`, null for none) and that
//      the programs inside its archives were too (`signedInside`);
//   7. an install from the new bundle into another temporary folder, as Filament installs it: offline, every file checked.
// Only a bundle that installs is put in place, replacing the one there. --keep leaves a failed build's folders to look at.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, cpSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BUNDLE_FORMAT, DEFAULT_VERSION, EMBEDDING_MODEL, PYTHON_DOWNLOADS, bundleRoot, downloadEngine, engineSource, engineSpec, installEngine, readBundle, writable } from "../src/adapters/sidecar/install.js";
import { isMain } from "./check-memory-bundle.mjs";

const WIN = process.platform === "win32";
/**
 * Where uv downloads its Pythons from — python-build-standalone's releases on GitHub, or (uv since late 2026) Astral's
 * mirror of them — each a prefix UV_PYTHON_INSTALL_MIRROR stands in for, `<release>/<archive>` after it alike.
 */
const PBS = ["https://github.com/astral-sh/python-build-standalone/releases/download", "https://releases.astral.sh/github/python-build-standalone/releases/download"];
/** The Hub cache's own folders: the blobs the snapshots link into (resolved as they are copied) and its locks. */
const NOT_COPIED = new Set(["blobs", ".locks"]);
/** A package name as pip compares them (PEP 503). @param {string} s */
const norm = (s) => s.toLowerCase().replace(/[-_.]+/g, "-");
const gone = (/** @type {string} */ p) => rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });

/**
 * One tool, its output kept and its lines handed on as they come; a failure says how it exited and its last lines.
 * @param {string} file @param {string[]} args @param {{ env?: Record<string, string>, onLine?: (line: string) => void, cwd?: string }} [o]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function runTool(file, args, { env = {}, onLine, cwd } = {}) {
  return new Promise((done, fail) => {
    const out = { stdout: "", stderr: "" };
    const child = spawn(file, args, { env: { ...process.env, ...env }, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    for (const name of /** @type {const} */ (["stdout", "stderr"])) {
      let held = "";
      child[name].setEncoding("utf8");
      child[name].on("data", (/** @type {string} */ d) => {
        out[name] += d;
        const lines = (held + d).split(/\r\n|\r|\n/);
        held = lines.pop() || "";
        for (const l of lines) if (l.trim()) onLine?.(l.trim());
      });
      child[name].on("end", () => held.trim() && onLine?.(held.trim()));
    }
    child.on("error", (e) => fail(new Error(`${basename(file)} could not start (${/** @type {any} */ (e).code || e.message})`)));
    child.on("close", (code) => {
      if (code === 0) return done(out);
      const tail = (out.stderr || out.stdout).trim().split(/\r?\n/).slice(-20).join("\n");
      fail(new Error(`${basename(file)} ${args.slice(0, 2).join(" ")} exited with code ${code}${tail ? `\n${tail}` : ""}`));
    });
  });
}

/** A file's sha256, read as a stream. @param {string} file @returns {Promise<string>} */
const sha256Of = (file) =>
  new Promise((done, fail) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("error", fail).on("end", () => done(h.digest("hex")));
  });
/** Every file under a folder, by its path inside it with forward slashes. @param {string} dir @returns {string[]} */
const filesUnder = (dir, at = "") =>
  readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(dir, at ? `${at}/${e.name}` : e.name) : [at ? `${at}/${e.name}` : e.name]));

/** Mach-O file types: one to run, a library, dyld, a module loaded at run time (an extension's .so); 1 is an object. */
export const MH = { EXECUTE: 2, DYLIB: 6, DYLINKER: 7, BUNDLE: 8 };
/** The file types codesign signs and notarization asks to be: never an object file (.o), which codesign refuses. */
const SIGNED_TYPES = new Set([MH.EXECUTE, MH.DYLIB, MH.DYLINKER, MH.BUNDLE]);

/**
 * A Mac program's file type (MH): its header's, 32- or 64-bit in either byte order, or a universal one's first
 * slice's, where its fat header is one (a few slices, the first a Mach-O: a Java class shares its first bytes, and a
 * universal static library's slices are ar archives); 0 for anything else. @param {string} file
 */
export function machOType(file) {
  /** A thin header's file type, read in its byte order. @param {Buffer} h */
  const typeOf = (h) => {
    const magic = h.toString("hex", 0, 4);
    return magic === "cffaedfe" || magic === "cefaedfe" ? h.readUInt32LE(12) : magic === "feedfacf" || magic === "feedface" ? h.readUInt32BE(12) : 0;
  };
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(20);
    const n = readSync(fd, head, 0, 20, 0);
    if (n < 16) return 0;
    if (head.toString("hex", 0, 4) !== "cafebabe") return typeOf(head);
    // universal: its first slice, where the big-endian fat header's first entry says it starts
    const slices = head.readUInt32BE(4);
    if (n < 20 || slices < 1 || slices > 16) return 0;
    const slice = Buffer.alloc(16);
    return readSync(fd, slice, 0, 16, head.readUInt32BE(16)) === 16 ? typeOf(slice) : 0;
  } finally {
    closeSync(fd);
  }
}

/**
 * The Developer ID Application identity a Mac signs with: CSC_NAME where it names one (as electron-builder reads it),
 * else the first the keychains hold that codesign can use; "" for none.
 * @param {{ env?: Record<string, string | undefined>, run?: typeof runTool }} [o]
 */
export async function findIdentity({ env = process.env, run = runTool } = {}) {
  if (env.CSC_NAME) return /^Developer ID Application: /.test(env.CSC_NAME) ? env.CSC_NAME : `Developer ID Application: ${env.CSC_NAME}`;
  const { stdout } = await run("security", ["find-identity", "-v", "-p", "codesigning"]);
  return /"(Developer ID Application: [^"]+)"/.exec(stdout)?.[1] || "";
}

/** How often codesign is asked again when Apple's timestamp service did not answer, and how long it waits first. */
const TIMESTAMP_TRIES = 3;
const TIMESTAMP_WAIT_MS = 5000;

/**
 * Every Mac program under `dir` signed with `identity`, with the hardened runtime and a secure timestamp, as
 * notarization asks — by its file type (machOType), so an object file is left alone, and a link to one is not signed
 * twice: → the files signed, by their paths inside it. `entitlements`: a file of them, given to those that are run.
 * A signing Apple's timestamp service did not answer is tried again (TIMESTAMP_TRIES), after `pause`.
 * @param {string} dir @param {string} identity
 * @param {{ run?: typeof runTool, entitlements?: string, pause?: (ms: number) => Promise<void> }} [o]
 */
export async function signMachO(dir, identity, { run = runTool, entitlements = "", pause = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  const at = (/** @type {string} */ rel) => join(dir, ...rel.split("/"));
  const programs = filesUnder(dir).sort().filter((rel) => lstatSync(at(rel)).isFile() && SIGNED_TYPES.has(machOType(at(rel))));
  for (const rel of programs) {
    const args = ["--force", "--sign", identity, "--options", "runtime", "--timestamp", ...(entitlements && machOType(at(rel)) === MH.EXECUTE ? ["--entitlements", entitlements] : []), at(rel)];
    for (let tried = 1; ; tried++) {
      try {
        await run("codesign", args);
        break;
      } catch (e) {
        if (tried >= TIMESTAMP_TRIES || !/timestamp/i.test(String(/** @type {any} */ (e).message))) throw e;
        await pause(TIMESTAMP_WAIT_MS * tried);
      }
    }
  }
  return programs;
}

/**
 * What the bundle's Python runs with, hardened: the hardened runtime's library validation (only code signed by the
 * same team, or Apple's) off, as python.org's own signed Python has it. Every module it loads from the bundle is signed
 * here, so validation would pass today; off, a module signed otherwise — re-signed by a tool, or a dependency's — still
 * loads rather than killing the engine. (Its interpreter carries libpython linked in, loading only the system's
 * libraries, so uv patching lib/libpython3.12.dylib's install name never touches what runs.)
 */
const PYTHON_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
`;

/** A RECORD's digest of some bytes: sha256, URL-safe base64 without its padding (PEP 376). @param {Buffer} bytes */
const recordDigest = (bytes) => `sha256=${createHash("sha256").update(bytes).digest("base64url")}`;

/**
 * A wheel's RECORD with the lines of the files `changed` (paths inside the wheel, as RECORD names them) given their
 * bytes' digest and size again; every other line as it was.
 * @param {string} record @param {Set<string>} changed @param {(rel: string) => Buffer} read
 */
export function recordWith(record, changed, read) {
  return record
    .split(/(?<=\n)/)
    .map((line) => {
      const body = line.replace(/\r?\n$/, "");
      const size = body.lastIndexOf(",");
      const hash = size > 0 ? body.lastIndexOf(",", size - 1) : -1;
      if (hash < 0) return line;
      const field = body.slice(0, hash);
      const path = /^".*"$/.test(field) ? field.slice(1, -1).replaceAll('""', '"') : field;
      if (!changed.has(path)) return line;
      const bytes = read(path);
      return `${field},${recordDigest(bytes)},${bytes.length}${line.slice(body.length)}`;
    })
    .join("");
}

/**
 * A wheel's programs signed in it: unpacked into `work`, signed (signMachO), its RECORD's lines for them written again,
 * and those members replaced in the wheel, every other member as it was — pip and uv read a wheel's files by its
 * RECORD. → the programs signed, by their paths inside it ([]: the wheel untouched).
 * @param {string} wheel @param {string} identity @param {{ run?: typeof runTool, work: string, pause?: (ms: number) => Promise<void> }} o
 */
export async function signWheel(wheel, identity, { run = runTool, work, pause }) {
  const into = mkdtempSync(join(work, "wheel-"));
  try {
    await run("unzip", ["-q", wheel, "-d", into]);
    const signed = await signMachO(into, identity, { run, pause });
    if (!signed.length) return signed;
    const records = filesUnder(into).filter((rel) => /^[^/]+\.dist-info\/RECORD$/.test(rel));
    if (records.length !== 1) throw new Error(`${basename(wheel)} holds ${records.length} RECORD files, where a wheel holds one`);
    const record = join(into, ...records[0].split("/"));
    writeFileSync(record, recordWith(readFileSync(record, "utf8"), new Set(signed), (rel) => readFileSync(join(into, ...rel.split("/")))));
    await run("zip", ["-q", "-X", wheel, ...signed, records[0]], { cwd: into });
    return signed;
  } finally {
    gone(into);
  }
}

/**
 * The Python archive's programs signed in it: unpacked into `work`, signed (signMachO, `entitlements` for its
 * interpreter), and packed again as it was laid out, with no Mac metadata of its own (COPYFILE_DISABLE). → the
 * programs signed, by their paths inside it ([]: the archive untouched).
 * @param {string} archive @param {string} identity
 * @param {{ run?: typeof runTool, work: string, entitlements?: string, pause?: (ms: number) => Promise<void> }} o
 */
export async function signTarball(archive, identity, { run = runTool, work, entitlements = "", pause }) {
  const into = mkdtempSync(join(work, "python-"));
  try {
    await run("tar", ["-xzf", archive, "-C", into]);
    const signed = await signMachO(into, identity, { run, entitlements, pause });
    if (signed.length) await run("tar", ["-czf", archive, "-C", into, ...readdirSync(into).sort()], { env: { COPYFILE_DISABLE: "1" } });
    return signed;
  } finally {
    gone(into);
  }
}

/**
 * The programs inside the bundle's archives signed — Apple's notary opens every zip and tarball an app carries, and
 * refuses a program in one that is not signed with a Developer ID and timestamped: each wheel's (signWheel), and the
 * Python archive's (signTarball) — refused where the Python is in an archive it can't open, rather than a manifest
 * saying it was signed inside. → by archive, its path in the bundle, the programs signed inside it.
 * @param {string} dir @param {string} identity @param {{ run?: typeof runTool, work: string, pause?: (ms: number) => Promise<void> }} o
 * @returns {Promise<Record<string, string[]>>}
 */
export async function signArchives(dir, identity, { run = runTool, work, pause }) {
  const pythons = filesUnder(dir).filter((rel) => rel.startsWith("python/"));
  if (!pythons.length || pythons.some((rel) => !rel.endsWith(".tar.gz")))
    throw new Error(`the bundle's Python is ${pythons.length ? pythons.join(", ") : "nowhere"}, where a .tar.gz alone is opened to sign the programs inside it`);
  mkdirSync(work, { recursive: true });
  const entitlements = join(work, "python.entitlements");
  writeFileSync(entitlements, PYTHON_ENTITLEMENTS);
  /** @type {Record<string, string[]>} */
  const signed = {};
  for (const rel of filesUnder(dir).sort()) {
    const file = join(dir, ...rel.split("/"));
    const inside = rel.startsWith("wheels/") && rel.endsWith(".whl") ? await signWheel(file, identity, { run, work, pause })
      : rel.startsWith("python/") ? await signTarball(file, identity, { run, work, entitlements, pause })
      : [];
    if (inside.length) signed[rel] = inside;
  }
  return signed;
}

/**
 * A Mac's signing step: the bundle's programs, and those inside its archives, signed where the keychain holds a
 * Developer ID Application certificate, and with whom, or null, said either way — a bundle built unsigned goes into an
 * app that is not notarized.
 * @param {string} dir @param {(line: string) => void} log @param {{ work: string }} o
 */
async function signOnMac(dir, log, { work }) {
  const identity = await findIdentity();
  if (!identity) {
    log("   no Developer ID Application certificate in the keychain: the bundle is unsigned, and an app that carries it can't be notarized (docs/releasing.md)");
    return null;
  }
  const signed = await signMachO(dir, identity);
  log(`   signed ${signed.length} program${signed.length === 1 ? "" : "s"} (${signed.join(", ")}) with ${identity}`);
  const inside = Object.entries(await signArchives(dir, identity, { work }));
  log(`   and ${inside.reduce((n, [, p]) => n + p.length, 0)} inside ${inside.length} of its archives: ${inside.map(([rel, p]) => `${p.length} in ${basename(rel)}`).join(", ")}`);
  return identity;
}

/**
 * Build this machine's bundle under `root` and put it in place once an install from it works.
 * @param {{
 *   root?: string, version?: string, keep?: boolean, work?: string,
 *   download?: (o: any) => Promise<any>, install?: (o: any) => Promise<any>, run?: typeof runTool, fetchImpl?: typeof fetch,
 *   now?: () => Date, log?: (line: string) => void,
 *   sign?: (dir: string, log: (line: string) => void, o: { work: string }) => Promise<string | null>,
 * }} [o]  `work`: the folder for the temporary installs (one of its own when not given); `download`, `install`, `run`
 *   and `fetchImpl` are the download install, the installer, the tool runner and fetch, there for the tests; `sign`: a
 *   Mac's signing step (none elsewhere), in its `work` folder, whose answer the manifest's `signed` keeps
 * @returns {Promise<{ dir: string, manifest: any }>}
 */
export async function buildBundle({
  root = bundleRoot(),
  version = DEFAULT_VERSION,
  keep = false,
  work = "",
  download = downloadEngine,
  install = installEngine,
  run = runTool,
  sign = process.platform === "darwin" ? signOnMac : undefined,
  fetchImpl = fetch,
  now = () => new Date(),
  log = (line) => console.log(line),
} = {}) {
  const machine = `${process.platform}-${process.arch}`;
  const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const final = join(root, machine);
  const stage = join(root, `.build-${machine}-${stamp}`);
  const dir = join(stage, machine);
  const made = !work;
  const at = work || mkdtempSync(join(tmpdir(), "filament-bundle-"));
  const say = (/** @type {any} */ ev) => log(`   ${ev.step} ${ev.status}${ev.message ? ` ${ev.message}` : ""}`);
  const uvEnv = { UV_CACHE_DIR: join(at, "uv-cache"), UV_NO_PROGRESS: "1", NO_COLOR: "1" };
  let built = false;
  try {
    log(`building the memory engine bundle for ${machine}: ${engineSpec(version, true)}`);
    const source = engineSource(version);
    log(`1/7 installing the engine by download into ${join(at, "download")}`);
    let got;
    try {
      got = await download({ dataDir: join(at, "download"), version, onProgress: say });
    } catch (e) {
      throw new Error(`the download install failed: ${/** @type {any} */ (e).message}`);
    }
    mkdirSync(dir, { recursive: true });
    copyFileSync(got.uv, join(dir, basename(got.uv)));

    const pv = got.pythonVersion;
    const listed = JSON.parse((await run(got.uv, ["python", "list", pv, "--only-downloads", "--output-format", "json"], { env: uvEnv })).stdout);
    const fits = (Array.isArray(listed) ? listed : []).filter((e) => String(e?.implementation).toLowerCase() === "cpython" && e.version === pv && (!e.variant || e.variant === "default") && e.url);
    if (fits.length !== 1)
      throw new Error(`uv lists ${fits.length} downloads of CPython ${pv} for this machine; the bundle needs exactly one${fits.length ? ` (${fits.map((e) => e.key).join(", ")})` : ""}`);
    const url = String(fits[0].url);
    const prefix = PBS.find((p) => url.startsWith(`${p}/`));
    if (!prefix) throw new Error(`uv downloads Python ${pv} from ${url}, not from python-build-standalone's releases: a bundle can't serve it as uv's mirror`);
    // The mirror is read as a file:// folder, so the archive sits under its name decoded ("%2B" is "+").
    const parts = url.slice(prefix.length + 1).split("/").map(decodeURIComponent);
    if (parts.length !== 2 || parts.some((p) => !p || p === "." || p === ".." || /[\\/]/.test(p)))
      throw new Error(`uv names its Python download as ${url}, which doesn't sit under one release`);
    log(`2/7 the Python ${pv} archive uv installs: ${url}`);
    const archive = join(dir, "python", ...parts);
    mkdirSync(join(dir, "python", parts[0]), { recursive: true });
    const res = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": "filament-bundle-build" } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${url}`);
    await pipeline(Readable.fromWeb(/** @type {any} */ (res.body)), createWriteStream(archive));

    const frozen = (await run(got.uv, ["pip", "freeze", "--python", got.venvPython], { env: uvEnv })).stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // the engine by its archive in Filament's fork, every other package by its release
    const isEngine = (/** @type {string} */ line) => /^\S+ @ \S+$/.test(line) && norm(line.split(" @ ")[0]) === "mnemosyne-memory" && line.split(" @ ")[1] === source;
    for (const line of frozen) if (!isEngine(line) && !/^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s;@]+$/.test(line)) throw new Error(`uv's freeze names "${line}", which is not a pinned release`);
    if (!frozen.some(isEngine)) throw new Error(`the download install holds no mnemosyne-memory from ${source}`);
    if (got.mnemosyneVersion !== version) throw new Error(`the download install holds mnemosyne ${got.mnemosyneVersion}, not ${version}`);
    log(`3/7 the wheels of the ${frozen.length} packages the download install holds`);
    writeFileSync(join(at, "frozen.txt"), `${frozen.join("\n")}\n`);
    const wheelVenv = join(at, "wheel-venv");
    await run(got.uv, ["venv", wheelVenv, "--seed", "--python", got.python], { env: uvEnv, onLine: (l) => log(`   ${l}`) });
    const wheelPython = WIN ? join(wheelVenv, "Scripts", "python.exe") : join(wheelVenv, "bin", "python");
    await run(wheelPython, ["-m", "pip", "wheel", "--no-deps", "--wheel-dir", join(dir, "wheels"), "-r", join(at, "frozen.txt")], {
      env: { PIP_CACHE_DIR: join(at, "pip-cache"), PIP_DISABLE_PIP_VERSION_CHECK: "1", PYTHONUTF8: "1" },
      onLine: (l) => log(`   ${l}`),
    });

    const wheels = readdirSync(join(dir, "wheels")).filter((f) => f.endsWith(".whl")).sort();
    const wheeled = new Set(wheels.map((f) => norm(f.split("-")[0])));
    for (const line of frozen) if (!wheeled.has(norm(line.split(/==| @ /)[0]))) throw new Error(`pip made no wheel for ${line}`);

    log("4/7 the embedding model's cache, as plain files");
    const cache = join(got.dir, "cache", "fastembed");
    if (!existsSync(cache)) throw new Error(`the download install left no embedding model at ${cache}`);
    cpSync(cache, join(dir, "fastembed"), { recursive: true, dereference: true, filter: (src) => !NOT_COPIED.has(basename(src)) });
    // Writable, as plain files are: the Hub leaves its big files read-only, and a copy keeps that (11-08, the Mac's).
    writable(join(dir, "fastembed"));
    // Signed before anything names their bytes: the wheels' pins, the archive's sha256 for uv and the manifest.
    const signed = sign ? await sign(dir, log, { work: join(at, "sign") }) : undefined;

    log(`5/7 requirements.txt: each wheel by its sha256; python/${PYTHON_DOWNLOADS}: the Python archive by its own`);
    const pins = [];
    for (const f of wheels) {
      const [name, ver] = f.split("-");
      pins.push(`${name}==${ver} --hash=sha256:${await sha256Of(join(dir, "wheels", f))}`);
    }
    writeFileSync(join(dir, "requirements.txt"), `${pins.join("\n")}\n`);
    // uv's own list of Pythons, with this one alone, as the bundle holds it: uv checks the archive against the sha256
    // its list gives, and its built-in one is the release's. Its URL in the GitHub form, the one uv's mirror stands in
    // for in a list of its own (uv 0.13: Astral's other host is refused there).
    const fit = fits[0];
    const named = String(fit.key || "").split("-");
    const [major, minor, patch] = pv.split(".").map(Number);
    const listing = {
      [fit.key]: {
        name: "cpython",
        arch: { family: typeof fit.arch === "object" && fit.arch ? fit.arch.family : fit.arch || named.at(-2), variant: null },
        os: fit.os || named.at(-3),
        libc: fit.libc || named.at(-1),
        major, minor, patch,
        prerelease: "",
        url: `${PBS[0]}/${url.slice(prefix.length + 1)}`,
        sha256: await sha256Of(archive),
        variant: null,
        build: parts[0],
      },
    };
    writeFileSync(join(dir, "python", PYTHON_DOWNLOADS), `${JSON.stringify(listing, null, 2)}\n`);

    /** @type {Record<string, string>} */
    const files = {};
    for (const rel of filesUnder(dir).sort()) files[rel] = await sha256Of(join(dir, ...rel.split("/")));
    const manifest = { format: BUNDLE_FORMAT, platform: process.platform, arch: process.arch, builtAt: now().toISOString(), uv: got.uvVersion, python: pv, mnemosyne: version, source, embeddings: true, model: EMBEDDING_MODEL, ...(signed !== undefined ? { signed, ...(signed ? { signedInside: true } : {}) } : {}), files };
    log(`6/7 manifest.json: ${Object.keys(files).length} files`);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const b = readBundle(stage);
    if (!b || b.problem) throw new Error(`the new bundle's manifest doesn't read: ${b?.problem || "it has none"}`);

    // The proof: the new bundle installed as Filament installs it, offline, every file checked against the manifest.
    log(`7/7 installing from the new bundle into ${join(at, "check")}, offline, to prove it`);
    let proved;
    try {
      proved = await install({ dataDir: join(at, "check"), version, bundle: stage, onProgress: say });
    } catch (e) {
      throw new Error(`the new bundle did not install: ${String(/** @type {any} */ (e).message).split("\n")[0]}`);
    }
    if (!proved?.installed || proved.source !== "bundle") throw new Error(`the new bundle did not install: ${proved?.installed ? "the install did not take it" : "the install did not finish"}`);

    const old = existsSync(final) ? `${final}.old-${stamp}` : "";
    if (old) renameSync(final, old);
    try {
      renameSync(dir, final);
    } catch (e) {
      if (old) renameSync(old, final);
      throw e;
    }
    if (old) gone(old);
    built = true;
    log(`the bundle is in place at ${final}`);
    return { dir: final, manifest };
  } finally {
    if (built || !keep) {
      gone(stage);
      for (const e of existsSync(at) ? readdirSync(at) : []) gone(join(at, e));
      if (made) gone(at);
    } else log(`kept for a look: ${stage} and ${at}`);
  }
}

// Run by its real path, so a checkout reached through a junction or a link still builds (check-memory-bundle.mjs).
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("-h") || args.includes("--help")) {
    console.log("Usage: node scripts/build-memory-bundle.mjs [--version <mnemosyne version>] [--out <folder>] [--keep]\nDownloads about 500 MB and builds this machine's memory engine bundle; see the top of this file.");
  } else {
    const out = opt("--out");
    buildBundle({ root: out ? resolve(out) : bundleRoot(), version: opt("--version") || DEFAULT_VERSION, keep: args.includes("--keep") }).catch((e) => {
      console.error(`the bundle was not built: ${e.message}`);
      process.exitCode = 1;
    });
  }
}
