// @ts-check
// The memory engine's bundle build (HarnessV3-AtHome AH-D2), without network or Python: a stand-in download install
// lays out an engine folder, stand-in tools answer as uv and pip do, a stand-in fetch serves the Python archive. The
// proof install is the real installer, on a stand-in spawn, offline: a bundle that would not install is never put in
// place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildBundle, findIdentity, machOType, runTool, signArchives, signMachO, signWheel } from "../scripts/build-memory-bundle.mjs";
import { installEngine, readBundle, engineDir, DEFAULT_VERSION } from "../src/adapters/sidecar/install.js";

const WIN = process.platform === "win32";
const UV = WIN ? "uv.exe" : "uv";
const MACHINE = `${process.platform}-${process.arch}`;
const PBS = "https://github.com/astral-sh/python-build-standalone/releases/download";
/** The engine as the download install holds it: built from Filament's fork at the commit pinned for 3.15.1. */
const FORK = "https://github.com/invertibleMatrix/mnemosyne/archive/78506708aae344635e01a24f67a7319efc36fce9.tar.gz";
const ARCHIVE = "cpython-3.12.11+20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz";
const tmp = () => mkdtempSync(join(tmpdir(), "filament-bundle-test-"));
const sha256 = (/** @type {string | Buffer} */ b) => createHash("sha256").update(b).digest("hex");
const venvPy = (/** @type {string} */ dataDir) => join(engineDir(dataDir), "venv", ...(WIN ? ["Scripts", "python.exe"] : ["bin", "python"]));

/** Every file under a folder, by its path inside it with forward slashes. @param {string} dir @returns {string[]} */
const filesUnder = (dir, at = "") =>
  readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(dir, at ? `${at}/${e.name}` : e.name) : [at ? `${at}/${e.name}` : e.name]));

/**
 * The download install as the build sees it: an engine folder with uv and a warmed model cache. `link`: the model's
 * file in its snapshot is a link to its blob, as the Hub's cache keeps it where the machine can link; `linked` says
 * whether this machine could.
 * @param {any[]} calls @param {{ link?: boolean, linked?: { made: boolean } }} [w]
 */
const downloadInstall = (calls, w = {}) => async (/** @type {any} */ o) => {
  calls.push({ ...o, onProgress: typeof o.onProgress });
  const dir = engineDir(o.dataDir);
  const put = (/** @type {string} */ rel, /** @type {string} */ body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put(UV, "MZ the uv the download installed");
  const model = "cache/fastembed/models--qdrant--bge-small-en-v1.5-onnx-q";
  put(`${model}/blobs/9f2e`, "the model's weights");
  put(`${model}/refs/main`, "abc123");
  if (w.link) {
    mkdirSync(join(dir, model, "snapshots", "abc123"), { recursive: true });
    try { symlinkSync(join(dir, model, "blobs", "9f2e"), join(dir, model, "snapshots", "abc123", "model_optimized.onnx"), "file"); if (w.linked) w.linked.made = true; } catch { /* Windows without developer mode: the Hub copies there too */ }
  }
  if (!w.linked?.made) put(`${model}/snapshots/abc123/model_optimized.onnx`, "the model's weights");
  put(`${model}/snapshots/abc123/config.json`, "{}");
  put("cache/fastembed/.locks/models--qdrant--bge-small-en-v1.5-onnx-q/9f2e.lock", "");
  o.onProgress({ step: "package", status: "done", message: `mnemosyne-memory[embeddings] @ ${FORK} installed` });
  return { installed: true, source: "download", dir, uv: join(dir, UV), python: join(dir, "python", "cpython-3.12.11-windows-x86_64-none", "python.exe"), venvPython: venvPy(o.dataDir), pythonVersion: "3.12.11", uvVersion: "0.8.17", mnemosyneVersion: "3.15.1" };
};

/**
 * The tools as the build runs them: uv's Python list, its freeze, a seeded venv, pip wheel writing its wheels.
 * @param {any[]} runs @param {{ listed?: any[], frozen?: string, wheels?: string[] }} [o]
 */
const tools = (runs, o = {}) => async (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ opts = {}) => {
  runs.push({ file: basename(file), args, env: opts.env, ...(args.includes("-r") ? { reqs: readFileSync(args[args.indexOf("-r") + 1], "utf8") } : {}) });
  opts.onLine?.(`ran ${args.slice(0, 2).join(" ")}`);
  if (args[0] === "python" && args[1] === "list")
    return { stdout: JSON.stringify(o.listed ?? [
      { key: "cpython-3.12.11+freethreaded-windows-x86_64-none", version: "3.12.11", implementation: "cpython", variant: "freethreaded", url: `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-freethreaded%2Bpgo-full.tar.zst` },
      { key: "cpython-3.12.11-windows-x86_64-none", version: "3.12.11", implementation: "cpython", variant: "default", url: `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` },
      { key: "cpython-3.13.7-windows-x86_64-none", version: "3.13.7", implementation: "cpython", variant: "default", url: `${PBS}/20250902/cpython-3.13.7%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` },
    ]), stderr: "" };
  if (args[0] === "pip" && args[1] === "freeze") return { stdout: o.frozen ?? `fastembed==0.7.3\nmnemosyne-memory @ ${FORK}\nnumpy==2.3.2\n`, stderr: "" };
  if (args[0] === "venv") return { stdout: "", stderr: "Seed packages: pip\n" };
  if (args[0] === "-m" && args[1] === "pip") {
    const into = args[args.indexOf("--wheel-dir") + 1];
    mkdirSync(into, { recursive: true });
    for (const w of o.wheels ?? ["fastembed-0.7.3-py3-none-any.whl", "mnemosyne_memory-3.15.1-py3-none-any.whl", "numpy-2.3.2-cp312-cp312-win_amd64.whl"]) writeFileSync(join(into, w), `the wheel ${w}`);
    return { stdout: "Successfully built 3 wheels\n", stderr: "" };
  }
  throw new Error(`unexpected tool: ${basename(file)} ${args.join(" ")}`);
};

/** The Python archive at its release URL, nothing else. @param {string[]} urls */
const archiveFetch = (urls) => async (/** @type {string} */ url) => {
  urls.push(url);
  return url === `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` ? new Response("a Python archive") : new Response("not found", { status: 404 });
};

/**
 * The proof install's processes, answering as uv and python do; `fail` names a command line that exits 1.
 * @param {string} dataDir @param {any[]} records @param {{ fail?: RegExp }} [o]
 */
function proofSpawn(dataDir, records, o = {}) {
  return (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ opts) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const line = [basename(file), ...args.map((a) => (a.includes("\n") ? "<snippet>" : a))].join(" ");
    records.push({ line, env: opts.env });
    const say = (/** @type {string} */ out, code = 0) => setImmediate(() => { child.stdout.end(out); child.stderr.end(); setImmediate(() => child.emit("close", code, null)); });
    if (o.fail?.test(line)) say("", 1);
    else if (args[0] === "--version") say("uv 0.8.17 (4ce6f2e 2025-09-01)\n");
    else if (args[0] === "python" && args[1] === "find") say(join(engineDir(dataDir), "python", "cpython-3.12.11-windows-x86_64-none", "python.exe") + "\n");
    else if (args[0] === "venv") { mkdirSync(dirname(venvPy(dataDir)), { recursive: true }); writeFileSync(venvPy(dataDir), ""); say(""); }
    else if (args[0] === "-c" && /TextEmbedding/.test(args[1])) say("ok\n");
    else if (args[0] === "-c" && /json\.dumps/.test(args[1])) say(JSON.stringify({ mnemosyne: "3.15.1", sqlite_vec: true, fastembed: true, python: "3.12.11", load_ext: true }) + "\n");
    else say("");
    return child;
  };
}

/**
 * The build over stand-ins: the download install faked, the proof install real on a stand-in spawn. `damage` changes
 * a file of the new bundle before the proof install reads it. `fetchImpl`: the fetch, in place of the archive's;
 * `proofInstall`: the proof install, in place of the real installer; `keep`: the script's --keep; `link`: the model's
 * file is a link in the download's cache (`linked.made` says whether this machine could make one).
 */
function world({ listed, frozen, wheels, fail, damage, fetchImpl, proofInstall, keep, link, sign = null } = /** @type {{ listed?: any[], frozen?: string, wheels?: string[], fail?: RegExp, damage?: string, fetchImpl?: any, proofInstall?: (o: any) => Promise<any>, keep?: boolean, link?: boolean, sign?: any }} */ ({})) {
  const root = tmp(), work = tmp();
  /** @type {any[]} */ const downloads = [];
  /** @type {any[]} */ const runs = [];
  /** @type {string[]} */ const urls = [];
  /** @type {any[]} */ const proof = [];
  /** @type {any[]} */ const proofs = [];
  /** @type {string[]} */ const lines = [];
  const linked = { made: false };
  const download = downloadInstall(downloads, { link, linked });
  const install = (/** @type {any} */ o) => {
    proofs.push(o);
    if (damage) writeFileSync(join(o.bundle, MACHINE, damage), "changed after the manifest");
    if (proofInstall) return proofInstall(o);
    return installEngine({ ...o, spawnImpl: proofSpawn(o.dataDir, proof, { fail }) });
  };
  const build = () => buildBundle({ root, version: DEFAULT_VERSION, download, install, run: tools(runs, { listed, frozen, wheels }), fetchImpl: /** @type {any} */ (fetchImpl ?? archiveFetch(urls)), work, keep, sign, now: () => new Date("2026-10-04T12:00:00.000Z"), log: (/** @type {string} */ l) => lines.push(l) });
  return { root, work, downloads, runs, urls, proof, proofs, lines, linked, build, done: () => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); } };
}

// (fails before: yes — the script did not exist)
test("the build: a download install's engine, its Python archive, its wheels pinned by hash and its model as plain files; proved offline, then put in place", async () => {
  const w = world();
  try {
    const { dir, manifest } = await w.build();
    assert.equal(dir, join(w.root, MACHINE));
    // The download install it starts from: the default engine, with embeddings.
    assert.equal(w.downloads.length, 1);
    assert.deepEqual([w.downloads[0].dataDir, w.downloads[0].version], [join(w.work, "download"), DEFAULT_VERSION]);
    const eng = engineDir(join(w.work, "download"));
    // Its tools, in order, on a uv cache and a pip cache of the build's own.
    assert.deepEqual(w.runs.map((r) => [r.file, ...r.args]), [
      [UV, "python", "list", "3.12.11", "--only-downloads", "--output-format", "json"],
      [UV, "pip", "freeze", "--python", venvPy(join(w.work, "download"))],
      [UV, "venv", join(w.work, "wheel-venv"), "--seed", "--python", join(eng, "python", "cpython-3.12.11-windows-x86_64-none", "python.exe")],
      [WIN ? "python.exe" : "python", "-m", "pip", "wheel", "--no-deps", "--wheel-dir", join(w.root, `.build-${MACHINE}-20261004T120000Z`, MACHINE, "wheels"), "-r", join(w.work, "frozen.txt")],
    ]);
    for (const r of w.runs.slice(0, 3)) assert.equal(r.env.UV_CACHE_DIR, join(w.work, "uv-cache"));
    assert.equal(w.runs[3].env.PIP_CACHE_DIR, join(w.work, "pip-cache"));
    assert.equal(w.runs[3].reqs, `fastembed==0.7.3\nmnemosyne-memory @ ${FORK}\nnumpy==2.3.2\n`, "pip is handed what uv froze");
    // What the bundle holds: uv, the default Python's archive under its release (the name decoded, as uv's mirror reads
    // it), the wheels, their requirements, the model without the Hub's blobs and locks, and the manifest.
    assert.deepEqual(w.urls, [`${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`]);
    assert.deepEqual(filesUnder(dir).sort(), [
      "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/refs/main",
      "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/snapshots/abc123/config.json",
      "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/snapshots/abc123/model_optimized.onnx",
      "manifest.json",
      `python/20250902/${ARCHIVE}`,
      "python/downloads.json",
      "requirements.txt",
      UV,
      "wheels/fastembed-0.7.3-py3-none-any.whl",
      "wheels/mnemosyne_memory-3.15.1-py3-none-any.whl",
      "wheels/numpy-2.3.2-cp312-cp312-win_amd64.whl",
    ].sort());
    assert.equal(readFileSync(join(dir, UV), "utf8"), "MZ the uv the download installed");
    assert.equal(readFileSync(join(dir, "python", "20250902", ARCHIVE), "utf8"), "a Python archive");
    // uv's list of the one Python the bundle holds, by its archive's own sha256, its URL in the GitHub form uv's
    // mirror stands in for.
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "python", "downloads.json"), "utf8")), {
      "cpython-3.12.11-windows-x86_64-none": {
        name: "cpython", arch: { family: "x86_64", variant: null }, os: "windows", libc: "none", major: 3, minor: 12, patch: 11, prerelease: "",
        url: `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
        sha256: sha256("a Python archive"), variant: null, build: "20250902",
      },
    });
    const wheel = (/** @type {string} */ f) => sha256(`the wheel ${f}`);
    assert.equal(readFileSync(join(dir, "requirements.txt"), "utf8"), [
      `fastembed==0.7.3 --hash=sha256:${wheel("fastembed-0.7.3-py3-none-any.whl")}`,
      `mnemosyne_memory==3.15.1 --hash=sha256:${wheel("mnemosyne_memory-3.15.1-py3-none-any.whl")}`,
      `numpy==2.3.2 --hash=sha256:${wheel("numpy-2.3.2-cp312-cp312-win_amd64.whl")}`,
    ].join("\n") + "\n");
    // The manifest: the versions, and every other file by its sha256; the installer reads it as it is.
    const onDisk = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(onDisk, manifest);
    assert.deepEqual({ ...manifest, files: undefined }, { format: 1, platform: process.platform, arch: process.arch, builtAt: "2026-10-04T12:00:00.000Z", uv: "0.8.17", python: "3.12.11", mnemosyne: DEFAULT_VERSION, source: FORK, embeddings: true, model: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", files: undefined });
    assert.deepEqual(Object.keys(manifest.files).sort(), filesUnder(dir).filter((f) => f !== "manifest.json").sort());
    for (const [rel, sum] of Object.entries(manifest.files)) assert.equal(sum, sha256(readFileSync(join(dir, rel))), rel);
    assert.equal(readBundle(w.root)?.problem, null);
    // The proof: the real installer took the new bundle, every file checked, offline, from the staging folder.
    assert.equal(w.proofs.length, 1);
    assert.deepEqual([w.proofs[0].dataDir, w.proofs[0].bundle, w.proofs[0].version], [join(w.work, "check"), join(w.root, `.build-${MACHINE}-20261004T120000Z`), DEFAULT_VERSION]);
    const pip = w.proof.find((r) => / pip install /.test(r.line));
    assert.ok(pip && /--offline --no-index --find-links .*--require-hashes -r /.test(pip.line) && pip.env.UV_OFFLINE === "1", pip?.line);
    assert.ok(w.proof.some((r) => r.line === `${UV} python install 3.12.11` && /^file:/.test(r.env.UV_PYTHON_INSTALL_MIRROR) && r.env.UV_PYTHON_DOWNLOADS_JSON_URL === join(w.proofs[0].bundle, MACHINE, "python", "downloads.json")), "uv checks the archive by the bundle's own list");
    // Put in place, and nothing else left: no staging, no temporary installs.
    assert.deepEqual(readdirSync(w.root), [MACHINE]);
    assert.deepEqual(readdirSync(w.work), []);
    assert.ok(w.lines.some((l) => /^1\/7 /.test(l)) && w.lines.some((l) => /^7\/7 /.test(l)), w.lines.join("\n"));
    assert.ok(w.lines.some((l) => l.includes(`mnemosyne-memory[embeddings] @ ${FORK} installed`)), "the installs' progress is said");
  } finally {
    w.done();
  }
});

// (fails before: yes — the script did not exist)
test("a bundle that does not install is never put in place: the one there stays; the staging and the temporary installs go", async () => {
  const w = world({ fail: / pip install / });
  try {
    mkdirSync(join(w.root, MACHINE), { recursive: true });
    writeFileSync(join(w.root, MACHINE, "manifest.json"), "the bundle that was there");
    await assert.rejects(w.build(), /the new bundle did not install: memory engine package: uv(\.exe)? pip exited with code 1/);
    assert.deepEqual(readdirSync(w.root), [MACHINE]);
    assert.equal(readFileSync(join(w.root, MACHINE, "manifest.json"), "utf8"), "the bundle that was there");
    assert.deepEqual(readdirSync(w.work), []);
  } finally {
    w.done();
  }
  // A damaged new bundle: the proof install stops at the damage, and nothing ran or was fetched.
  const damaged = world({ damage: "requirements.txt" });
  try {
    await assert.rejects(damaged.build(), /the new bundle did not install: memory engine uv: the memory engine bundle at .* is damaged: requirements\.txt differs from its manifest;/);
    assert.deepEqual(damaged.proof, [], "no tool ran in the proof install");
    assert.deepEqual(damaged.urls.length, 1, "only the build's own fetch of the Python archive");
    assert.deepEqual(readdirSync(damaged.root), []);
  } finally {
    damaged.done();
  }
  // One that installs replaces the one there.
  const again = world();
  try {
    mkdirSync(join(again.root, MACHINE), { recursive: true });
    writeFileSync(join(again.root, MACHINE, "stale.txt"), "from the bundle before");
    await again.build();
    assert.deepEqual(readdirSync(again.root), [MACHINE]);
    assert.equal(existsSync(join(again.root, MACHINE, "stale.txt")), false);
  } finally {
    again.done();
  }
});

// (fails before: yes — the script did not exist)
test("the build refuses what a bundle can't serve, in words, and leaves nothing behind", async () => {
  const cases = [
    { o: { listed: [] }, says: /uv lists 0 downloads of CPython 3\.12\.11 for this machine; the bundle needs exactly one/ },
    {
      o: { listed: [{ key: "cpython-3.12.11-windows-x86_64-none", version: "3.12.11", implementation: "cpython", variant: "default", url: "https://mirror.example/python/cpython-3.12.11.tar.gz" }] },
      says: /uv downloads Python 3\.12\.11 from https:\/\/mirror\.example\/python\/cpython-3\.12\.11\.tar\.gz, not from python-build-standalone's releases: a bundle can't serve it as uv's mirror/,
    },
    { o: { wheels: ["fastembed-0.7.3-py3-none-any.whl", "mnemosyne_memory-3.15.1-py3-none-any.whl"] }, says: /pip made no wheel for numpy==2\.3\.2/ },
    // (fails before: yes — the engine was taken from PyPI's release, and the fork's archive was refused as no release)
    { o: { frozen: "fastembed==0.7.3\nmnemosyne-memory==3.15.1\n" }, says: /the download install holds no mnemosyne-memory from https:\/\/github\.com\/invertibleMatrix\/mnemosyne\/archive\/78506708aae344635e01a24f67a7319efc36fce9\.tar\.gz/ },
    { o: { frozen: "fastembed==0.7.3\nmnemosyne-memory @ https://github.com/invertibleMatrix/mnemosyne/archive/4444.tar.gz\n" }, says: /uv's freeze names "mnemosyne-memory @ https:\/\/github\.com\/invertibleMatrix\/mnemosyne\/archive\/4444\.tar\.gz", which is not a pinned release/ },
    { o: { frozen: "fastembed==0.7.3\nmnemosyne-memory @ file:///C:/src/mnemosyne\n" }, says: /uv's freeze names "mnemosyne-memory @ file:\/\/\/C:\/src\/mnemosyne", which is not a pinned release/ },
  ];
  for (const { o, says } of cases) {
    const w = world(o);
    try {
      await assert.rejects(w.build(), says);
      assert.deepEqual(readdirSync(w.root), [], String(says));
      assert.deepEqual(readdirSync(w.work), [], String(says));
    } finally {
      w.done();
    }
  }
});

// (fails before: no — HarnessV4_Tasks C14: each case pins a refusal a mutant of the script got past: two downloads of
// one Python, a download outside one release, a release named "..", an archive the server refused, a build with no
// engine in it)
test("the build refuses a Python it can't place and an archive it did not get, in words, and leaves nothing behind", async () => {
  const py = (/** @type {string} */ key, /** @type {string} */ url, o = {}) => ({ key, version: "3.12.11", implementation: "cpython", variant: "default", url, ...o });
  const cases = [
    {
      o: { listed: [py("cpython-3.12.11-windows-x86_64-none", `${PBS}/20250902/a.tar.gz`), py("cpython-3.12.11-windows-x86_64-gnu", `${PBS}/20250902/b.tar.gz`)] },
      says: /uv lists 2 downloads of CPython 3\.12\.11 for this machine; the bundle needs exactly one \(cpython-3\.12\.11-windows-x86_64-none, cpython-3\.12\.11-windows-x86_64-gnu\)/,
    },
    { o: { listed: [py("k", `${PBS}/20250902/extra/cpython.tar.gz`)] }, says: /uv names its Python download as .*\/20250902\/extra\/cpython\.tar\.gz, which doesn't sit under one release/ },
    { o: { listed: [py("k", `${PBS}/cpython.tar.gz`)] }, says: /which doesn't sit under one release/ },
    { o: { listed: [py("k", `${PBS}/%2E%2E/cpython.tar.gz`)] }, says: /uv names its Python download as .*%2E%2E\/cpython\.tar\.gz, which doesn't sit under one release/ },
    { o: { listed: [py("k", `${PBS}/20250902/up%2Fcpython.tar.gz`)] }, says: /which doesn't sit under one release/ },
    { o: { fetchImpl: async () => new Response("the release is gone", { status: 404 }) }, says: /HTTP 404 downloading https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/20250902\/cpython-3\.12\.11%2B20250902/ },
    { o: { frozen: "fastembed==0.7.3\nnumpy==2.3.2\n" }, says: /the download install holds no mnemosyne-memory/ },
  ];
  for (const { o, says } of cases) {
    const w = world(o);
    try {
      await assert.rejects(w.build(), says);
      assert.deepEqual(readdirSync(w.root), [], String(says));
      assert.deepEqual(readdirSync(w.work), [], String(says));
    } finally {
      w.done();
    }
  }
});

// (fails before: no — HarnessV4_Tasks C14: what the build must read past, each a mutant that lived: another
// implementation of the same Python, the engine's name as a freeze may write it, a file pip leaves beside its wheels,
// a model file the Hub keeps as a link)
test("the build takes CPython among other implementations, the engine by any spelling of its name, wheels alone, and a linked model file as a plain one", async (t) => {
  const listed = [
    { key: "pypy-3.12.11-windows-x86_64-none", version: "3.12.11", implementation: "pypy", variant: "default", url: "https://downloads.python.org/pypy/pypy3.12-v7.3.20-win64.zip" },
    { key: "cpython-3.12.11-windows-x86_64-none", version: "3.12.11", implementation: "CPython", variant: "default", url: `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` },
  ];
  const w = world({ listed, frozen: `fastembed==0.7.3\nMnemosyne_Memory @ ${FORK}\nnumpy==2.3.2\n`, wheels: ["fastembed-0.7.3-py3-none-any.whl", "mnemosyne_memory-3.15.1-py3-none-any.whl", "numpy-2.3.2-cp312-cp312-win_amd64.whl", "pip-wheel.log"], link: true });
  try {
    const { dir } = await w.build();
    assert.deepEqual(w.urls, [`${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`], "CPython's archive, whatever case uv writes it in");
    assert.deepEqual(readFileSync(join(dir, "requirements.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]), ["fastembed==0.7.3", "mnemosyne_memory==3.15.1", "numpy==2.3.2"], "a requirement for each wheel, and for nothing else in pip's folder");
    const model = join(dir, "fastembed", "models--qdrant--bge-small-en-v1.5-onnx-q", "snapshots", "abc123", "model_optimized.onnx");
    assert.equal(readFileSync(model, "utf8"), "the model's weights");
    if (w.linked.made) assert.equal(lstatSync(model).isSymbolicLink(), false, "the link is resolved: the blobs it pointed into are not in the bundle");
    else t.diagnostic("this machine can't make a file link: the model's link was not exercised");
    assert.equal(existsSync(join(dir, "fastembed", "models--qdrant--bge-small-en-v1.5-onnx-q", "blobs")), false);
  } finally {
    w.done();
  }
});

// (fails before: no — HarnessV4_Tasks C14: the proof's two refusals, --keep, and the old bundle put back when the swap
// fails were run by no test)
test("the proof takes only an install from the bundle; --keep leaves a failed build to look at and nothing of a built one; a swap that fails puts the old bundle back", async () => {
  // An install that finished, but not from the bundle; and one that did not finish.
  for (const [result, says] of /** @type {[any, RegExp][]} */ ([
    [{ installed: true, source: "download" }, /the new bundle did not install: the install did not take it/],
    [{ installed: false, source: "bundle" }, /the new bundle did not install: the install did not finish/],
  ])) {
    const w = world({ proofInstall: async () => result });
    try {
      await assert.rejects(w.build(), says);
      assert.deepEqual(readdirSync(w.root), []);
    } finally {
      w.done();
    }
  }
  // --keep: a failed build's staging and temporary installs stay, and the build says where.
  const kept = world({ keep: true, proofInstall: async () => ({ installed: false }) });
  try {
    await assert.rejects(kept.build(), /the install did not finish/);
    const stage = `.build-${MACHINE}-20261004T120000Z`;
    assert.deepEqual(readdirSync(kept.root), [stage]);
    assert.ok(existsSync(join(kept.root, stage, MACHINE, "manifest.json")));
    assert.ok(readdirSync(kept.work).includes("download"));
    assert.ok(kept.lines.includes(`kept for a look: ${join(kept.root, stage)} and ${kept.work}`), kept.lines.at(-1));
  } finally {
    kept.done();
  }
  // --keep on a build that worked: the bundle is in place, and nothing is kept beside it.
  const built = world({ keep: true });
  try {
    await built.build();
    assert.deepEqual(readdirSync(built.root), [MACHINE]);
    assert.deepEqual(readdirSync(built.work), []);
    assert.equal(built.lines.some((l) => l.startsWith("kept for a look")), false);
  } finally {
    built.done();
  }
  // The swap fails (the staged bundle is gone by then): the bundle that was there is in place again, under its name.
  const swap = world({
    proofInstall: async (/** @type {any} */ o) => {
      rmSync(join(o.bundle, MACHINE), { recursive: true, force: true });
      return { installed: true, source: "bundle" };
    },
  });
  try {
    mkdirSync(join(swap.root, MACHINE), { recursive: true });
    writeFileSync(join(swap.root, MACHINE, "manifest.json"), "the bundle that was there");
    await assert.rejects(swap.build(), /ENOENT/);
    assert.deepEqual(readdirSync(swap.root), [MACHINE]);
    assert.equal(readFileSync(join(swap.root, MACHINE, "manifest.json"), "utf8"), "the bundle that was there");
  } finally {
    swap.done();
  }
});

// (fails before: yes — the script did not exist)
test("the build's runner: a tool's output, its lines as they come, and a failure with its last lines", async () => {
  /** @type {string[]} */
  const heard = [];
  const r = await runTool(process.execPath, ["-e", "console.log('one'); console.log('two')"], { env: { FILAMENT_BUILD_TEST: "1" }, onLine: (l) => heard.push(l) });
  assert.equal(r.stdout.replace(/\r\n/g, "\n"), "one\ntwo\n");
  assert.deepEqual(heard, ["one", "two"]);
  assert.equal((await runTool(process.execPath, ["-e", "console.log(process.env.FILAMENT_BUILD_TEST)"], { env: { FILAMENT_BUILD_TEST: "seen" } })).stdout.trim(), "seen");
  await assert.rejects(runTool(process.execPath, ["-e", "console.error('it broke'); process.exit(3)"]), (/** @type {any} */ e) => /exited with code 3/.test(e.message) && /it broke/.test(e.message));
  await assert.rejects(runTool(join(tmpdir(), "no-such-tool-filament"), []), /could not start/);
});

// (fails before: yes — uv since late 2026 downloads its Pythons from Astral's mirror of python-build-standalone, and the
// build refused the archive: "not from python-build-standalone's releases")
test("a Python uv downloads from Astral's mirror sits in the bundle as one from GitHub's releases would: under its release, read through uv's mirror", async () => {
  const url = `https://releases.astral.sh/github/python-build-standalone/releases/download/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`;
  /** @type {string[]} */
  const asked = [];
  const w = world({
    listed: [{ key: "cpython-3.12.11-macos-aarch64-none", version: "3.12.11", implementation: "cpython", variant: "default", url, os: "macos", arch: "aarch64", libc: "none" }],
    fetchImpl: async (/** @type {string} */ u) => (asked.push(u), u === url ? new Response("a Python archive") : new Response("not found", { status: 404 })),
  });
  try {
    const { dir } = await w.build();
    assert.deepEqual(asked, [url]);
    assert.equal(readFileSync(join(dir, "python", "20250902", ARCHIVE), "utf8"), "a Python archive");
    // (fails before: yes — 11-08: no list) uv's mirror stands in only for GitHub's form of a URL in a list of its own,
    // and the list takes uv's own words for the machine
    const listed = JSON.parse(readFileSync(join(dir, "python", "downloads.json"), "utf8"))["cpython-3.12.11-macos-aarch64-none"];
    assert.equal(listed.url, `${PBS}/20250902/cpython-3.12.11%2B20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`);
    assert.deepEqual([listed.os, listed.arch, listed.libc], ["macos", { family: "aarch64", variant: null }, "none"]);
  } finally {
    w.done();
  }
});

// (fails before: yes — the owner's of 11-07: a Mac's bundle carried uv as uv's release signed it, and notarization asks
// every program an app carries to be signed with its Developer ID; signed after the manifest, the manifest would no
// longer name its bytes, and Filament would refuse its own engine)
test("on a Mac the bundle's programs are signed before the manifest names their bytes, and the manifest says by whom", async () => {
  /** @type {string[]} */
  const seen = [];
  /** @type {string[]} */
  const works = [];
  const NUMPY = "wheels/numpy-2.3.2-cp312-cp312-win_amd64.whl";
  const sign = async (/** @type {string} */ dir, /** @type {(l: string) => void} */ log, /** @type {{ work: string }} */ o) => {
    seen.push(...filesUnder(dir));
    works.push(o.work);
    writeFileSync(join(dir, UV), "MZ the uv, signed");
    writeFileSync(join(dir, NUMPY), "the wheel, its libraries signed");
    writeFileSync(join(dir, "python", "20250902", ARCHIVE), "a Python archive, its programs signed");
    log("   signed 1 program (uv) with Developer ID Application: Ada Lovelace (ABCDE12345)");
    return "Developer ID Application: Ada Lovelace (ABCDE12345)";
  };
  const w = world({ sign });
  try {
    const { dir, manifest } = await w.build();
    assert.ok(seen.includes(UV) && seen.some((f) => f.startsWith("fastembed/")) && seen.includes(NUMPY) && !seen.includes("manifest.json"), "signed once every file is in, before the manifest");
    // (fails before: yes — 11-08: the pins and the archive's sha256 were taken before the signing, so they named bytes
    // the bundle no longer held)
    assert.ok(!seen.includes("requirements.txt") && !seen.includes("python/downloads.json"), "and before the wheels' pins and uv's list");
    assert.deepEqual(works, [join(w.work, "sign")], "in the build's own temporary folder");
    assert.equal(manifest.signed, "Developer ID Application: Ada Lovelace (ABCDE12345)");
    assert.equal(manifest.signedInside, true, "and the programs inside its archives with them");
    assert.equal(manifest.files[UV], sha256("MZ the uv, signed"), "the manifest names the signed bytes");
    assert.equal(readFileSync(join(dir, UV), "utf8"), "MZ the uv, signed");
    assert.match(readFileSync(join(dir, "requirements.txt"), "utf8"), new RegExp(`^numpy==2\\.3\\.2 --hash=sha256:${sha256("the wheel, its libraries signed")}$`, "m"), "the wheel pinned as signed");
    assert.equal(JSON.parse(readFileSync(join(dir, "python", "downloads.json"), "utf8"))["cpython-3.12.11-windows-x86_64-none"].sha256, sha256("a Python archive, its programs signed"), "uv told the signed archive's sha256");
    assert.equal(w.proofs.length, 1, "and the signed bundle is the one proved");
  } finally {
    w.done();
  }
  // unsigned on a Mac: said in the manifest as null; elsewhere no word of it
  const unsigned = world({ sign: async () => null });
  try {
    const m = (await unsigned.build()).manifest;
    assert.deepEqual([m.signed, "signedInside" in m], [null, false]);
  } finally {
    unsigned.done();
  }
  const elsewhere = world();
  try {
    const m = (await elsewhere.build()).manifest;
    assert.deepEqual(["signed" in m, "signedInside" in m], [false, false]);
  } finally {
    elsewhere.done();
  }
});

/** A Mac program's first bytes: a 64-bit thin header, little-endian, of a file type (2 run, 6 a library, 8 a module). */
const thin = (/** @type {number} */ type) => {
  const b = Buffer.alloc(32);
  b.write("cffaedfe", 0, "hex");
  b.writeUInt32LE(0x0100000c, 4);
  b.writeUInt32LE(type, 12);
  return b;
};
/** A universal program whose first slice, at 64, is a thin one of `type`. */
const universal = (/** @type {number} */ type) => {
  const b = Buffer.alloc(96);
  b.write("cafebabe", 0, "hex");
  b.writeUInt32BE(1, 4);
  b.writeUInt32BE(0x0100000c, 8);
  b.writeUInt32BE(64, 16);
  b.writeUInt32BE(32, 20);
  thin(type).copy(b, 64);
  return b;
};

/**
 * The tools a Mac's signing runs, over archives of the test's own (JSON of each member's bytes, base64): unzip and tar
 * unpack one, zip puts the members it is given back in its wheel, tar packs a folder's tops, codesign marks a file
 * signed by adding to its bytes.
 * @param {any[]} calls
 */
const archiveTools = (calls) => async (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ opts = {}) => {
  calls.push({ file, args, cwd: opts.cwd, env: opts.env });
  const unpack = (/** @type {string} */ archive, /** @type {string} */ into) => {
    for (const [rel, b64] of Object.entries(JSON.parse(readFileSync(archive, "utf8")))) {
      mkdirSync(dirname(join(into, rel)), { recursive: true });
      writeFileSync(join(into, rel), Buffer.from(String(b64), "base64"));
    }
  };
  if (file === "unzip") unpack(args[1], args[3]);
  else if (file === "tar" && args[0] === "-xzf") unpack(args[1], args[3]);
  else if (file === "zip") {
    const members = JSON.parse(readFileSync(args[2], "utf8"));
    for (const rel of args.slice(3)) members[rel] = readFileSync(join(opts.cwd, rel)).toString("base64");
    writeFileSync(args[2], JSON.stringify(members));
  } else if (file === "tar" && args[0] === "-czf") {
    /** @type {Record<string, string>} */
    const members = {};
    for (const rel of filesUnder(args[3])) if (args.slice(4).includes(rel.split("/")[0])) members[rel] = readFileSync(join(args[3], rel)).toString("base64");
    writeFileSync(args[1], JSON.stringify(members));
  } else if (file === "codesign") writeFileSync(args[args.length - 1], Buffer.concat([readFileSync(args[args.length - 1]), Buffer.from(" signed")]));
  else throw new Error(`unexpected tool: ${file} ${args.join(" ")}`);
  return { stdout: "", stderr: "" };
};
/** An archive of the test's own: its members' bytes. @param {string} file @param {Record<string, Buffer | string>} members */
const packed = (file, members) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(members).map(([rel, b]) => [rel, Buffer.from(b).toString("base64")]))));
};
/** An archive's members, as text where they are. @param {string} file */
const members = (file) => Object.fromEntries(Object.entries(JSON.parse(readFileSync(file, "utf8"))).map(([rel, b64]) => [rel, Buffer.from(String(b64), "base64")]));
/** RECORD's digest of some bytes. @param {Buffer} b */
const digest = (b) => `sha256=${createHash("sha256").update(b).digest("base64url")}`;

// (fails before: yes — 11-08: Apple's notary refused 67 programs inside the bundle's wheels and Python archive, signed
// by their makers or by no one, and none timestamped)
test("the programs inside a Mac bundle's archives are signed in them: a wheel's members and RECORD replaced, the Python archive packed again, its interpreter with its entitlements", async () => {
  const ID = "Developer ID Application: Ada Lovelace (ABCDE12345)";
  const dir = tmp(), work = tmp();
  try {
    const numpy = join(dir, "wheels", "numpy-2.3.2-cp312-cp312-macosx_14_0_arm64.whl");
    const record = [
      "numpy/__init__.py,sha256=abc,10",
      "numpy/core/_multiarray_umath.cpython-312-darwin.so,sha256=old,32",
      '"numpy/.dylibs/lib,odd.dylib",sha256=old,96',
      "numpy-2.3.2.dist-info/RECORD,,",
      "",
    ].join("\r\n");
    packed(numpy, {
      "numpy/__init__.py": "import os\n",
      "numpy/core/_multiarray_umath.cpython-312-darwin.so": thin(8),
      "numpy/.dylibs/lib,odd.dylib": universal(6),
      "numpy-2.3.2.dist-info/RECORD": record,
    });
    const plain = join(dir, "wheels", "fastembed-0.7.3-py3-none-any.whl");
    packed(plain, { "fastembed/__init__.py": "", "fastembed-0.7.3.dist-info/RECORD": "fastembed/__init__.py,sha256=x,0\n" });
    const plainBefore = readFileSync(plain);
    const python = join(dir, "python", "20261026", "cpython-3.12.16+20261026-aarch64-apple-darwin-install_only_stripped.tar.gz");
    packed(python, { "python/bin/python3.12": thin(2), "python/lib/libpython3.12.dylib": thin(6), "python/lib/python3.12/lib-dynload/_dbm.cpython-312-darwin.so": thin(8), "python/lib/python3.12/os.py": "import abc\n" });
    writeFileSync(join(dir, "requirements.txt"), "numpy==2.3.2\n");
    /** @type {any[]} */
    const calls = [];
    const signed = await signArchives(dir, ID, { run: archiveTools(calls), work });
    assert.deepEqual(signed, {
      "python/20261026/cpython-3.12.16+20261026-aarch64-apple-darwin-install_only_stripped.tar.gz": ["python/bin/python3.12", "python/lib/libpython3.12.dylib", "python/lib/python3.12/lib-dynload/_dbm.cpython-312-darwin.so"],
      "wheels/numpy-2.3.2-cp312-cp312-macosx_14_0_arm64.whl": ["numpy/.dylibs/lib,odd.dylib", "numpy/core/_multiarray_umath.cpython-312-darwin.so"],
    });
    // The wheel: its programs signed in it, RECORD naming their new bytes (a quoted path too, its line ends kept), the
    // rest as it was; zip handed those members and RECORD alone.
    const got = members(numpy);
    const so = Buffer.concat([thin(8), Buffer.from(" signed")]), lib = Buffer.concat([universal(6), Buffer.from(" signed")]);
    assert.deepEqual(got["numpy/core/_multiarray_umath.cpython-312-darwin.so"], so);
    assert.deepEqual(got["numpy/.dylibs/lib,odd.dylib"], lib);
    assert.equal(got["numpy/__init__.py"].toString(), "import os\n");
    assert.equal(got["numpy-2.3.2.dist-info/RECORD"].toString(), [
      "numpy/__init__.py,sha256=abc,10",
      `numpy/core/_multiarray_umath.cpython-312-darwin.so,${digest(so)},${so.length}`,
      `"numpy/.dylibs/lib,odd.dylib",${digest(lib)},${lib.length}`,
      "numpy-2.3.2.dist-info/RECORD,,",
      "",
    ].join("\r\n"));
    const zip = calls.find((c) => c.file === "zip");
    assert.deepEqual(zip.args, ["-q", "-X", numpy, "numpy/.dylibs/lib,odd.dylib", "numpy/core/_multiarray_umath.cpython-312-darwin.so", "numpy-2.3.2.dist-info/RECORD"]);
    assert.equal(calls.filter((c) => c.file === "zip").length, 1, "a wheel with no program is not packed again");
    assert.deepEqual(readFileSync(plain), plainBefore);
    // The Python archive packed again as it was laid out, with no Mac metadata; its interpreter alone run with the
    // entitlements, every program hardened and timestamped.
    assert.equal(members(python)["python/lib/python3.12/os.py"].toString(), "import abc\n");
    assert.deepEqual(members(python)["python/bin/python3.12"], Buffer.concat([thin(2), Buffer.from(" signed")]));
    const tar = calls.find((c) => c.file === "tar" && c.args[0] === "-czf");
    assert.deepEqual([tar.args.slice(0, 2), tar.args.slice(4), tar.env], [["-czf", python], ["python"], { COPYFILE_DISABLE: "1" }]);
    const codesigned = calls.filter((c) => c.file === "codesign");
    assert.equal(codesigned.length, 5);
    for (const c of codesigned) assert.deepEqual(c.args.slice(0, 6), ["--force", "--sign", ID, "--options", "runtime", "--timestamp"]);
    const entitled = codesigned.filter((c) => c.args.includes("--entitlements"));
    assert.deepEqual(entitled.map((c) => basename(c.args.at(-1))), ["python3.12"]);
    assert.match(readFileSync(entitled[0].args[entitled[0].args.indexOf("--entitlements") + 1], "utf8"), /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/);
    assert.deepEqual(readdirSync(work).sort(), ["python.entitlements"], "nothing unpacked is left");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("a wheel with no RECORD, or two, is refused rather than packed with files its RECORD does not name", async () => {
  const dir = tmp();
  try {
    const wheel = join(dir, "odd-1.0-py3-none-any.whl");
    packed(wheel, { "odd/_c.so": thin(8) });
    await assert.rejects(signWheel(wheel, "Developer ID Application: Ada Lovelace (ABCDE12345)", { run: archiveTools([]), work: dir }), /odd-1\.0-py3-none-any\.whl holds 0 RECORD files, where a wheel holds one/);
    assert.deepEqual(readdirSync(dir), ["odd-1.0-py3-none-any.whl"], "and its unpacked copy goes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-08: every file with a Mach-O's first bytes went to codesign, which refuses an
// object file, and a Java class or a universal static library shares a universal program's first bytes)
test("a Mac program by its file type: run, a library or a module, a universal one by its first slice; an object file, a universal static library and a Java class none to sign; a link not signed twice", async () => {
  const dir = tmp();
  try {
    const put = (/** @type {string} */ name, /** @type {Buffer} */ b) => (writeFileSync(join(dir, name), b), join(dir, name));
    const big = Buffer.alloc(32);
    big.write("feedfacf", 0, "hex");
    big.writeUInt32BE(2, 12);
    const fatArchive = universal(2);
    fatArchive.write("!<arch>\n", 64, "latin1");
    const java = Buffer.alloc(32);
    java.write("cafebabe00000034", 0, "hex");
    assert.deepEqual(
      [put("exe", thin(2)), put("dylib", thin(6)), put("so", thin(8)), put("fat-exe", universal(2)), put("fat-lib", universal(6)), put("big", big), put("python.o", thin(1)), put("libfat.a", fatArchive), put("Main.class", java), put("text", Buffer.from("#!/bin/sh\necho hi\n")), put("tiny", Buffer.from("ab"))].map(machOType),
      [2, 6, 8, 2, 6, 2, 1, 0, 0, 0, 0],
    );
    let linked = false;
    try {
      symlinkSync(join(dir, "exe"), join(dir, "exe-link"), "file");
      linked = true;
    } catch { /* Windows without developer mode */ }
    /** @type {string[][]} */
    const calls = [];
    const signed = await signMachO(dir, "Developer ID Application: Ada Lovelace (ABCDE12345)", { run: async (file, args) => (calls.push([file, ...args]), { stdout: "", stderr: "" }), entitlements: "/x/python.entitlements" });
    assert.deepEqual(signed, ["big", "dylib", "exe", "fat-exe", "fat-lib", "so"], linked ? "and the link left alone" : "");
    assert.deepEqual(calls.filter((c) => c.includes("--entitlements")).map((c) => basename(c[c.length - 1])), ["big", "exe", "fat-exe"], "the entitlements for those that are run");
    assert.deepEqual(calls.find((c) => c.includes("--entitlements"))?.slice(7, 9), ["--entitlements", "/x/python.entitlements"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-08: a hundred signings each ask Apple's timestamp service, and one it did not
// answer failed the whole build)
test("a signing Apple's timestamp service did not answer is asked again, after a wait; any other failure, or a third, stops the build", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "uv"), thin(2));
    const ID = "Developer ID Application: Ada Lovelace (ABCDE12345)";
    const busy = new Error(`codesign --force --sign exited with code 1\n${join(dir, "uv")}: The timestamp service is not available.`);
    /** @param {Error[]} failures @param {number[]} waits */
    const runner = (failures, waits) => ({
      run: async () => { const e = failures.shift(); if (e) throw e; return { stdout: "", stderr: "" }; },
      pause: async (/** @type {number} */ ms) => { waits.push(ms); },
    });
    /** @type {number[]} */
    const waits = [];
    assert.deepEqual(await signMachO(dir, ID, runner([busy, busy], waits)), ["uv"]);
    assert.deepEqual(waits, [5000, 10000]);
    /** @type {number[]} */
    const thrice = [];
    await assert.rejects(signMachO(dir, ID, runner([busy, busy, busy], thrice)), /The timestamp service is not available/);
    assert.deepEqual(thrice, [5000, 10000]);
    /** @type {number[]} */
    const none = [];
    await assert.rejects(signMachO(dir, ID, runner([new Error("codesign --force --sign exited with code 1\nerrSecInternalComponent")], none)), /errSecInternalComponent/);
    assert.deepEqual(none, [], "not asked again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-08: a Python in an archive the signing does not open was passed over, and the
// manifest said its programs were signed)
test("a bundle whose Python is in an archive the signing can't open, or nowhere, is refused, not said signed inside", async () => {
  const dir = tmp(), work = tmp();
  try {
    const ID = "Developer ID Application: Ada Lovelace (ABCDE12345)";
    await assert.rejects(signArchives(dir, ID, { run: archiveTools([]), work }), /the bundle's Python is nowhere, where a \.tar\.gz alone is opened/);
    packed(join(dir, "python", "20261026", "cpython-3.12.16+20261026-aarch64-apple-darwin-install_only_stripped.tar.zst"), { "python/bin/python3.12": thin(2) });
    await assert.rejects(signArchives(dir, ID, { run: archiveTools([]), work }), /the bundle's Python is python\/20261026\/cpython-3\.12\.16\+20261026-aarch64-apple-darwin-install_only_stripped\.tar\.zst, where a \.tar\.gz alone is opened/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("a Mac's identity: CSC_NAME where set, else the keychain's first Developer ID Application; each program signed hardened and timestamped", async () => {
  assert.equal(await findIdentity({ env: { CSC_NAME: "Ada Lovelace (ABCDE12345)" }, run: () => assert.fail("asked the keychain") }), "Developer ID Application: Ada Lovelace (ABCDE12345)");
  assert.equal(await findIdentity({ env: { CSC_NAME: "Developer ID Application: Ada Lovelace (ABCDE12345)" }, run: () => assert.fail("asked the keychain") }), "Developer ID Application: Ada Lovelace (ABCDE12345)");
  const listed = '  1) 1A2B "Apple Development: ada@example.com (ZZZ)"\n  2) 3C4D "Developer ID Application: Ada Lovelace (ABCDE12345)"\n     2 valid identities found\n';
  assert.equal(await findIdentity({ env: {}, run: async () => ({ stdout: listed, stderr: "" }) }), "Developer ID Application: Ada Lovelace (ABCDE12345)");
  assert.equal(await findIdentity({ env: {}, run: async () => ({ stdout: "     0 valid identities found\n", stderr: "" }) }), "");
  const dir = tmp();
  try {
    writeFileSync(join(dir, "uv"), thin(2));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "fat"), universal(6));
    writeFileSync(join(dir, "requirements.txt"), "numpy==2.3.2\n");
    writeFileSync(join(dir, "tiny"), "ab");
    assert.deepEqual([machOType(join(dir, "uv")), machOType(join(dir, "lib", "fat")), machOType(join(dir, "requirements.txt")), machOType(join(dir, "tiny"))], [2, 6, 0, 0]);
    /** @type {string[][]} */
    const calls = [];
    const signed = await signMachO(dir, "Developer ID Application: Ada Lovelace (ABCDE12345)", { run: async (file, args) => (calls.push([file, ...args]), { stdout: "", stderr: "" }) });
    assert.deepEqual(signed.sort(), ["lib/fat", "uv"]);
    assert.deepEqual(calls.map((c) => c.slice(0, 7)), signed.map(() => ["codesign", "--force", "--sign", "Developer ID Application: Ada Lovelace (ABCDE12345)", "--options", "runtime", "--timestamp"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
