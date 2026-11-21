// The engine installer without network or Python: a fake fetch serves a uv archive built with the system tar, a fake
// spawn records every command and answers like uv / python do (only tar runs for real, so extraction is exercised).
// Filament installs its engine from the bundle that comes with it, offline, and from nothing else; the download
// install is what a bundle is built from (scripts/build-memory-bundle.mjs). The last test downloads for real when
// FILAMENT_INSTALL_TEST=1 (~300 MB into a temp dir, then removed).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as realSpawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { engineDir, engineState, installEngine, downloadEngine, uninstallEngine, sidecarEnv, uvAsset, readBundle, bundleDamage, DEFAULT_VERSION } from "../src/memory-install.js";
import * as inst from "../src/memory-install.js";
import { pathToFileURL, fileURLToPath } from "node:url";
import { removeDirs, until } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const tmp = () => mkdtempSync(join(tmpdir(), "filament-meminst-"));
const venvPy = (dataDir) => join(engineDir(dataDir), "venv", ...(WIN ? ["Scripts", "python.exe"] : ["bin", "python"]));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const tarBin = WIN ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
// Every engine comes from Filament's fork of Mnemosyne, at the commit pinned for its version — never from PyPI.
const ARCHIVE = (/** @type {string} */ commit) => `https://github.com/invertibleMatrix/mnemosyne/archive/${commit}.tar.gz`;
const FORK_3_15_1 = ARCHIVE("78506708aae344635e01a24f67a7319efc36fce9");
/** The fork's commits for the other versions the tests move to. @type {Record<string, string>} */
const COMMITS = { ...inst.ENGINE_COMMITS, "3.14.0": "1".repeat(40), "3.16.0": "2".repeat(40), "9.9.9": "3".repeat(40) };
const fork = (/** @type {string} */ version) => ARCHIVE(COMMITS[version]);

// A uv release archive for this platform: uv.exe at the top of a zip (Windows), uv-<triple>/uv in a tar.gz (POSIX).
function buildUvArchive(dir) {
  const { asset, triple, zip } = uvAsset();
  const src = join(dir, "src"), inner = zip ? "uv.exe" : join(`uv-${triple}`, "uv");
  mkdirSync(dirname(join(src, inner)), { recursive: true }); writeFileSync(join(src, inner), zip ? "MZ fake uv" : "#!/bin/sh\necho uv 0.8.17\n");
  const file = join(dir, asset);
  const r = spawnSync(tarBin, zip ? ["-a", "-cf", file, "-C", src, "uv.exe"] : ["-czf", file, "-C", src, `uv-${triple}`], { windowsHide: true, encoding: "utf8" });
  assert.equal(r.status, 0, `tar failed: ${r.stderr}`);
  return { asset, buf: readFileSync(file) };
}
function fakeFetch(archive, urls, { sha = true } = {}) {
  return async (url, opts) => {
    urls.push(url);
    if (opts?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (url.endsWith(".sha256")) return sha ? new Response(`${typeof sha === "string" ? sha : sha256(archive.buf)}  ${archive.asset}\n`) : new Response("not found", { status: 404 });
    return new Response(archive.buf, { status: 200, headers: { "content-length": String(archive.buf.length) } });
  };
}
// The spawn fake: records { file, args, env }, answers like the real tools, creates the venv interpreter on `venv`,
// and lets tar run for real. `hang(line)` keeps a child running until it is killed (abort / timeout tests). A stand-in
// has no process id: a stop's kill would hand one to taskkill, and end whatever process holds that id.
function fakeSpawn(dataDir, records, { hang = () => false, verify = {} } = {}) {
  return (file, args, opts) => {
    if (/^tar(\.exe)?$/i.test(basename(file))) return realSpawn(file, args, opts);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
    const line = [basename(file), ...args.map((a) => (a.includes("\n") ? "<snippet>" : a))].join(" ");
    records.push({ file, args, env: opts.env, opts, line, child });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null, "SIGTERM")); return true; };
    const say = (out, err, code = 0) => setImmediate(() => { if (out) child.stdout.write(out); if (err) child.stderr.write(err); child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit("close", code, null)); });
    if (hang(line)) return child;
    if (args[0] === "--version") say("uv 0.8.17 (4ce6f2e 2025-09-01)\n");
    else if (args[0] === "python" && args[1] === "install") say("", "Installed Python 3.12.11 in 3.21s\n + cpython-3.12.11-windows-x86_64-none\n");
    else if (args[0] === "python" && args[1] === "find") say(join(engineDir(dataDir), "python", "cpython-3.12.11-windows-x86_64-none", "python.exe") + "\n");
    else if (args[0] === "venv" || (args[0] === "-m" && args[1] === "venv")) { mkdirSync(dirname(venvPy(dataDir)), { recursive: true }); writeFileSync(venvPy(dataDir), ""); say("", "Using CPython 3.12.11\nCreating virtual environment at: venv\n"); }
    else if (args[0] === "pip" || (args[0] === "-m" && args[1] === "pip")) say("", "Resolved 42 packages in 1.2s\nPrepared 42 packages in 20.1s\nInstalled 42 packages in 3.0s\n");
    else if (args[0] === "-c" && /TextEmbedding/.test(args[1])) say("ok\n", "Fetching 5 files: 100%|##########| 5/5 [00:12<00:00]\n");
    else if (args[0] === "-c" && /json\.dumps/.test(args[1])) say(JSON.stringify({ mnemosyne: "3.15.1", sqlite_vec: true, fastembed: true, python: "3.12.11", load_ext: true, ...verify }) + "\n");
    else say("", `unexpected command: ${line}\n`, 1);
    return child;
  };
}
const byStep = (events) => events.reduce((m, e) => { (m[e.step] ||= []).push(e.status); return m; }, {});
const startDone = (statuses) => statuses[0] === "start" && statuses[statuses.length - 1] === "done";

test("engineState: empty dir is not installed; engine.json plus the venv interpreter make it installed", () => {
  const dataDir = tmp();
  try {
    let s = engineState(dataDir);
    assert.equal(s.installed, false); assert.equal(s.dir, join(dataDir, "memory-engine")); assert.equal(s.uv, ""); assert.deepEqual(s.log, []); assert.equal(s.error, null);
    const py = venvPy(dataDir); mkdirSync(dirname(py), { recursive: true }); writeFileSync(py, "");
    writeFileSync(join(engineDir(dataDir), "engine.json"), JSON.stringify({ installed: true, venvPython: py, python: "/p/python", uvVersion: "0.8.17", mnemosyneVersion: "3.15.1", embeddings: false, installedAt: "2026-09-15T00:00:00.000Z", log: Array.from({ length: 80 }, (_, i) => `line ${i}`) }));
    s = engineState(dataDir);
    assert.equal(s.installed, true); assert.equal(s.venvPython, py); assert.equal(s.python, "/p/python"); assert.equal(s.uvVersion, "0.8.17"); assert.equal(s.mnemosyneVersion, "3.15.1"); assert.equal(s.embeddings, false); assert.equal(s.installedAt, "2026-09-15T00:00:00.000Z");
    assert.equal(s.log.length, 50); assert.equal(s.log[0], "line 30");
    rmSync(py); assert.equal(engineState(dataDir).installed, false, "a missing venv interpreter means not installed");
    writeFileSync(join(engineDir(dataDir), "engine.json"), "{not json"); assert.equal(engineState(dataDir).installed, false);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("downloadEngine, what a bundle is built from: uv download + extract, python, venv, package, model, verify in order with the exact commands and env", async () => {
  const dataDir = tmp(), work = tmp(), records = [], events = [], urls = [];
  try {
    const archive = buildUvArchive(work);
    const state = await downloadEngine({ dataDir, fetchImpl: fakeFetch(archive, urls), spawnImpl: fakeSpawn(dataDir, records), onProgress: (e) => events.push(e) });
    const eng = engineDir(dataDir), uv = join(eng, WIN ? "uv.exe" : "uv"), py = venvPy(dataDir);
    // steps in order, each start → done
    const order = [...new Set(events.map((e) => e.step))];
    assert.deepEqual(order, ["uv", "python", "venv", "package", "model", "verify"]);
    const st = byStep(events); for (const step of order) assert.ok(startDone(st[step]), `${step}: ${st[step].join(",")}`);
    assert.ok(!events.some((e) => e.status === "error" || e.status === "skip"));
    assert.equal(events.at(-1).percent, 100); assert.equal(events[0].percent, 0);
    // the download: one asset URL, its checksum, byte progress, the binary extracted by the real tar into place
    assert.deepEqual(urls, [uvAsset().url, uvAsset().url + ".sha256"]);
    const bytes = events.filter((e) => e.step === "uv" && e.bytesDone); assert.ok(bytes.length >= 1 && bytes.at(-1).bytesDone === archive.buf.length && bytes.at(-1).bytesTotal === archive.buf.length);
    assert.ok(existsSync(uv)); assert.ok(!readdirSync(eng).some((n) => n.startsWith("tmp-uv-")), "temp extraction dir removed");
    assert.ok(events.some((e) => e.step === "uv" && /checksum verified/.test(e.message)));
    // the exact command lines
    const lines = records.map((r) => r.line);
    assert.deepEqual(lines, [
      `${basename(uv)} --version`,
      `${basename(uv)} python install 3.12`,
      `${basename(uv)} python find 3.12`,
      `${basename(uv)} venv ${join(eng, "venv")} --python ${join(eng, "python", "cpython-3.12.11-windows-x86_64-none", "python.exe")} --clear`,
      `${basename(uv)} pip install --python ${py} --reinstall-package mnemosyne-memory mnemosyne-memory[embeddings] @ ${FORK_3_15_1}`,
      `python${WIN ? ".exe" : ""} -c <snippet>`,
      `python${WIN ? ".exe" : ""} -c <snippet>`,
    ]);
    assert.ok(records.slice(0, 5).every((r) => r.file === uv), "uv commands run the downloaded binary");
    assert.ok(records.slice(5).every((r) => r.file === py), "python snippets run the venv interpreter");
    // env keys per step (values contain the engine dir), hidden windows, piped output
    for (const r of records.slice(1, 5)) { assert.equal(r.env.UV_PYTHON_INSTALL_DIR, join(eng, "python"), r.line); assert.equal(r.env.UV_PYTHON_BIN_DIR, join(eng, "python-bin"), r.line); assert.equal(r.env.UV_CACHE_DIR, join(eng, "cache", "uv")); assert.equal(r.env.UV_NO_MODIFY_PATH, "1"); }
    for (const r of records.slice(5)) { assert.equal(r.env.MNEMOSYNE_FASTEMBED_CACHE_DIR, join(eng, "cache", "fastembed"), r.line); assert.equal(r.env.HF_HUB_DISABLE_TELEMETRY, "1"); assert.equal(r.env.PYTHONUTF8, "1"); }
    assert.ok(records.every((r) => r.opts.windowsHide === true && r.opts.stdio[1] === "pipe" && r.opts.stdio[2] === "pipe"));
    assert.match(records[5].args[1], /from fastembed import TextEmbedding/); assert.ok(records[5].args[1].includes(JSON.stringify(inst.EMBEDDING_MODEL)), "a download warms this build's model (c2)"); assert.match(records[5].args[1], /MNEMOSYNE_FASTEMBED_CACHE_DIR/);
    assert.match(records[6].args[1], /import mnemosyne/); assert.match(records[6].args[1], /sqlite_vec\.load/); assert.match(records[6].args[1], /import fastembed/); assert.match(records[6].args[1], /json\.dumps/);
    // stderr lines became progress messages
    assert.ok(events.some((e) => e.step === "package" && e.status === "progress" && e.message === "Resolved 42 packages in 1.2s"));
    assert.ok(events.some((e) => e.step === "python" && e.status === "progress" && /Installed Python 3.12.11/.test(e.message)));
    // the returned state and engine.json
    assert.equal(state.installed, true); assert.equal(state.uv, uv); assert.equal(state.uvVersion, "0.8.17"); assert.equal(state.venvPython, py); assert.equal(state.mnemosyneVersion, "3.15.1"); assert.equal(state.pythonVersion, "3.12.11"); assert.equal(state.embeddings, true); assert.equal(state.sqliteVec, true); assert.equal(state.fastembed, true); assert.ok(state.installedAt); assert.equal(state.error, null);
    const json = JSON.parse(readFileSync(join(eng, "engine.json"), "utf8"));
    assert.equal(json.installed, true); assert.equal(json.mnemosyneVersion, "3.15.1"); assert.equal(json.python, join(eng, "python", "cpython-3.12.11-windows-x86_64-none", "python.exe")); assert.ok(json.log.length > 10 && json.log.length <= 200);
    assert.ok(json.log.some((l) => l.includes(`package done mnemosyne-memory[embeddings] @ ${FORK_3_15_1} installed`)));
    assert.ok(!JSON.stringify(json).includes("UV_CACHE_DIR="), "the log never carries environment variables");
    assert.equal(engineState(dataDir).installed, true);
    // a second download install finds the binary and skips its download
    const records2 = [], events2 = [], urls2 = [];
    await downloadEngine({ dataDir, fetchImpl: fakeFetch(archive, urls2), spawnImpl: fakeSpawn(dataDir, records2), onProgress: (e) => events2.push(e) });
    assert.deepEqual(urls2, []); assert.deepEqual(byStep(events2).uv, ["start", "skip"]); assert.equal(records2[0].line, `${basename(uv)} --version`); assert.equal(records2[1].line, `${basename(uv)} python install 3.12`);
    // a wrong checksum is refused before anything runs
    rmSync(uv); const records3 = [];
    await assert.rejects(downloadEngine({ dataDir, fetchImpl: fakeFetch(archive, [], { sha: "0".repeat(64) }), spawnImpl: fakeSpawn(dataDir, records3) }), (e) => e.step === "uv" && /sha256 mismatch/.test(e.message));
    // The engine installed before is still whole (its Python and venv untouched: uv is not what it runs on), so it stays.
    assert.equal(records3.length, 0); assert.ok(!existsSync(uv)); assert.deepEqual([engineState(dataDir).installed, engineState(dataDir).error], [true, null]);
    // With none installed, the failure is the install's, as ever.
    writeFileSync(join(engineDir(dataDir), "engine.json"), JSON.stringify({ installed: false }));
    await assert.rejects(downloadEngine({ dataDir, fetchImpl: fakeFetch(archive, [], { sha: "0".repeat(64) }), spawnImpl: fakeSpawn(dataDir, []) }));
    assert.match(engineState(dataDir).error, /sha256 mismatch/);
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});

test("downloadEngine: abort kills the child and rejects cleanly; a slow step has no clock; failures are recorded", async () => {
  const dataDir = tmp(), work = tmp();
  try {
    const archive = buildUvArchive(work);
    // abort during the package step
    const ac = new AbortController(), records = [], events = [];
    const p = downloadEngine({ dataDir, signal: ac.signal, fetchImpl: fakeFetch(archive, []), spawnImpl: fakeSpawn(dataDir, records, { hang: (line) => /pip install/.test(line) }), onProgress: (e) => { events.push(e); if (e.step === "package" && e.status === "start") setTimeout(() => ac.abort(), 20); } });
    await assert.rejects(p, (e) => e.name === "AbortError" && e.aborted === true && e.step === "package" && /aborted during package/.test(e.message));
    const pip = records.find((r) => /pip install/.test(r.line)); assert.ok(pip && pip.child.killed, "the running child was killed");
    assert.ok(!events.some((e) => e.step === "verify")); assert.deepEqual(events.filter((e) => e.status === "error").map((e) => [e.step, e.message]), [["package", "aborted"]]);
    let s = engineState(dataDir); assert.equal(s.installed, false); assert.match(s.error, /aborted during package/);
    // an already-aborted signal stops before anything runs
    const dead = new AbortController(); dead.abort(); const none = [];
    await assert.rejects(downloadEngine({ dataDir, signal: dead.signal, fetchImpl: fakeFetch(archive, []), spawnImpl: fakeSpawn(dataDir, none) }), (e) => e.aborted === true);
    assert.equal(none.length, 0);
    // (fails before: yes — each step had a clock, 15 minutes on the python install: HarnessV3-FailurePoints FP-D3) No
    // clock on a step: a day on the python install, and it runs on until the person stops it.
    const recs = [], slow = new AbortController(), turns = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
    let settled = false;
    try {
      const run = downloadEngine({ dataDir, signal: slow.signal, fetchImpl: fakeFetch(archive, []), spawnImpl: fakeSpawn(dataDir, recs, { hang: (line) => /python install/.test(line) }), onProgress: (e) => { if (e.step === "python" && e.status === "start") mock.timers.enable({ apis: ["setTimeout"] }); } });
      run.then(() => (settled = true), () => (settled = true));
      while (!recs.some((r) => /python install/.test(r.line))) await turns(1);
      mock.timers.tick(24 * 3600_000);
      await turns(20);
      assert.equal(settled, false, "a day on the python install, and it runs on");
      slow.abort();
      await assert.rejects(run, (e) => e.aborted === true && e.step === "python");
    } finally { mock.timers.reset(); }
    assert.ok(recs.find((r) => /python install/.test(r.line)).child.killed);
    // a failing command: the error names the step and carries the last output lines
    const bad = fakeSpawn(dataDir, [], {}); const failing = (file, args, opts) => { if (args[0] === "venv") { const c = bad(file, ["--nope"], opts); return c; } return bad(file, args, opts); };
    await assert.rejects(downloadEngine({ dataDir, fetchImpl: fakeFetch(archive, []), spawnImpl: failing }), (e) => e.step === "venv" && /exited with code 1/.test(e.message) && /unexpected command/.test(e.message) && e.output.length === 1);
    s = engineState(dataDir); assert.equal(s.installed, false); assert.match(s.error, /memory engine venv/);
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});

// (fails before: yes — updateEngine moved an installed engine to any version the fork had a commit for, by download)
test("an engine is never updated: the installer has no update; uninstallEngine removes the dir, a read-only file in it too", async () => {
  assert.equal("updateEngine" in inst, false, "no update: a new engine comes with a new Filament, in its bundle");
  const dataDir = tmp(), root = tmp();
  try {
    buildBundle(root);
    await installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) });
    // A read-only file in it, as an unpacked archive leaves (fails before: yes, under Electron's Node — HarnessV3-Native
    // NA1: the desktop app's runtime refused it, five times over; `npm run test:desktop` runs this file there — plain
    // node takes the file).
    writeFileSync(join(engineDir(dataDir), "locked.txt"), "x"); chmodSync(join(engineDir(dataDir), "locked.txt"), 0o444);
    const r = await uninstallEngine(dataDir); assert.equal(r.removed, true); assert.ok(!existsSync(engineDir(dataDir))); assert.equal(engineState(dataDir).installed, false);
    assert.equal((await uninstallEngine(dataDir)).removed, false);
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("sidecarEnv builds the §4 environment without process.env", () => {
  const env = sidecarEnv({ memoryFolder: join("D:", "mem"), base: "http://127.0.0.1:4141", apiKey: "sk-local", model: "cheap/haiku", llmEnabled: true, embeddings: true, bank: "work", engine: join("C:", "data", "memory-engine") });
  // one source of truth: the engine module's sidecarEnv, reached through the installer's signature
  assert.equal(env.MNEMOSYNE_DATA_DIR, join("D:", "mem", "mnemosyne")); assert.equal(env.MNEMOSYNE_FASTEMBED_CACHE_DIR, join("C:", "data", "memory-engine", "cache", "fastembed"));
  assert.equal(env.MNEMOSYNE_BANK, "work"); assert.equal(env.MNEMOSYNE_DEFAULT_SCOPE, "global"); assert.equal(env.MNEMOSYNE_CROSS_SESSION, "1"); assert.equal(env.MNEMOSYNE_WM_TTL_HOURS, "87600");
  assert.equal(env.MNEMOSYNE_LLM_ENABLED, "true"); assert.equal(env.MNEMOSYNE_LLM_BASE_URL, "http://127.0.0.1:4141/memory-engine/v1"); assert.equal(env.MNEMOSYNE_LLM_API_KEY, "sk-local"); assert.equal(env.MNEMOSYNE_LLM_MODEL, "cheap/haiku");
  assert.equal(env.PYTHONUTF8, "1"); assert.equal(env.PYTHONUNBUFFERED, "1"); assert.equal(env.HF_HUB_DISABLE_TELEMETRY, "1"); assert.equal(env.MNEMOSYNE_NO_EMBEDDINGS, undefined);
  assert.ok(!("PATH" in env) && !("Path" in env));
  const off = sidecarEnv({ memoryFolder: "/m", base: "http://127.0.0.1:8080", embeddings: false, engine: { dir: "/e" }, llmEnabled: false });
  assert.equal(off.MNEMOSYNE_NO_EMBEDDINGS, "1"); assert.equal(off.MNEMOSYNE_LLM_ENABLED, "false"); assert.equal(off.MNEMOSYNE_LLM_BASE_URL, undefined); assert.equal(off.MNEMOSYNE_LLM_API_KEY, undefined);
  assert.equal(off.MNEMOSYNE_FASTEMBED_CACHE_DIR, join("/e", "cache", "fastembed"));
  const viaData = sidecarEnv({ memoryFolder: "/m", dataDir: "/d" }); assert.equal(viaData.MNEMOSYNE_FASTEMBED_CACHE_DIR, join("/d", "memory-engine", "cache", "fastembed"));
  assert.equal(DEFAULT_VERSION, "3.15.1");
});

// ---- the bundle (HarnessV3-AtHome AH-D2): the engine that came with Filament, installed with no network ----
const BUNDLE_FILES = () => ({
  [WIN ? "uv.exe" : "uv"]: "MZ the bundle's uv",
  "python/20250902/cpython-3.12.11+20250902-x86_64-pc-windows-msvc-install_only_stripped.tar.gz": "a Python archive",
  "wheels/mnemosyne_memory-3.15.1-py3-none-any.whl": "the mnemosyne wheel",
  "wheels/fastembed-0.7.3-py3-none-any.whl": "the fastembed wheel",
  "requirements.txt": "mnemosyne-memory==3.15.1 --hash=sha256:00\nfastembed==0.7.3 --hash=sha256:11\n",
  "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/refs/main": "abc123",
  "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/snapshots/abc123/model_optimized.onnx": "the model's weights",
});
// A bundle for this machine under `root`, its manifest listing each file's sha256; `edit` changes the manifest.
function buildBundle(root, { edit = (m) => m } = {}) {
  const dir = join(root, `${process.platform}-${process.arch}`), files = BUNDLE_FILES();
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); }
  const manifest = { format: 1, platform: process.platform, arch: process.arch, builtAt: "2026-10-04T00:00:00.000Z", uv: "0.8.17", python: "3.12.11", mnemosyne: DEFAULT_VERSION, source: FORK_3_15_1, embeddings: true, model: "BAAI/bge-small-en-v1.5", files: Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, sha256(Buffer.from(body))])) };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(edit(manifest)));
  return dir;
}
const noNetwork = () => { throw new Error("no network expected"); };

// (fails before: yes — every install and update took mnemosyne-memory==<version> from PyPI, and a version was only a
// string handed to pip)
test("the engine comes from Filament's fork at the commit pinned for its version; a version it has none for is refused before anything runs", async () => {
  assert.equal(inst.ENGINE_REPO, "https://github.com/invertibleMatrix/mnemosyne");
  assert.equal(inst.engineSpec(DEFAULT_VERSION, true), `mnemosyne-memory[embeddings] @ ${FORK_3_15_1}`);
  assert.equal(inst.engineSpec(DEFAULT_VERSION, false), `mnemosyne-memory @ ${FORK_3_15_1}`);
  assert.equal(inst.engineSource("3.99.0"), "");
  const refused = /^Filament installs no Mnemosyne 3\.99\.0: its fork has no commit for it here \(the versions it installs: 3\.15\.1\)$/;
  const dataDir = tmp(), root = tmp(), records = [];
  try {
    await assert.rejects(downloadEngine({ dataDir, version: "3.99.0", fetchImpl: noNetwork, spawnImpl: fakeSpawn(dataDir, records) }), (e) => refused.test(e.message));
    buildBundle(root);
    await assert.rejects(installEngine({ dataDir, bundle: root, version: "3.99.0", spawnImpl: fakeSpawn(dataDir, records) }), (e) => refused.test(e.message));
    assert.deepEqual(records, [], "nothing ran");
    assert.equal(existsSync(engineDir(dataDir)), false, "nothing was made");
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// (fails before: yes — a bundle was taken for its version alone, whatever it was built from; then one not taken sent
// the install to download)
test("a bundle whose engine was not built from the fork's commit for its version is not taken, and nothing downloads", async () => {
  for (const [source, taken] of /** @type {const} */ ([[undefined, false], [ARCHIVE("4".repeat(40)), false], [FORK_3_15_1, true]])) {
    const root = tmp(), dataDir = tmp(), records = [];
    try {
      const dir = buildBundle(root, { edit: (m) => ({ ...m, source }) });
      const b = inst.bundleFor(root, { version: DEFAULT_VERSION });
      assert.equal(!!b.bundle, taken, String(source));
      if (taken) continue;
      const why = `the memory engine bundle at ${dir} holds a mnemosyne 3.15.1 not built from Filament's fork at the commit for it: build it again with npm run engine:bundle`;
      assert.equal(b.why, why);
      await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, records) }), (e) => e.message === why);
      assert.deepEqual(records, [], "nothing ran");
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(dataDir, { recursive: true, force: true }); }
  }
});
const said = (events, re) => events.some((e) => e.step === "uv" && re.test(e.message));

test("bundleRoot and readBundle: vendor/memory-engine unless FILAMENT_MEMORY_BUNDLE says otherwise; this machine's folder, its manifest read", () => {
  const root = tmp(), empty = tmp();
  try {
    assert.equal(inst.bundleRoot({}), join(fileURLToPath(new URL("..", import.meta.url)), "vendor", "memory-engine"));
    assert.equal(inst.bundleRoot({ FILAMENT_MEMORY_BUNDLE: join("D:", "bundles") }), join("D:", "bundles"));
    assert.equal(inst.readBundle(empty), null, "no folder for this machine: no bundle");
    const dir = buildBundle(root), b = inst.readBundle(root);
    assert.equal(b.dir, dir); assert.equal(b.problem, null); assert.equal(b.manifest.mnemosyne, DEFAULT_VERSION); assert.equal(b.manifest.python, "3.12.11");
    // A bundle is named by its manifest's sha256: another build, even of the same version, is another bundle.
    assert.equal(b.id, sha256(readFileSync(join(dir, "manifest.json"))));
    const problem = (edit) => { const r = tmp(); try { buildBundle(r, { edit }); return inst.readBundle(r).problem; } finally { rmSync(r, { recursive: true, force: true }); } };
    assert.equal(problem((m) => ({ ...m, platform: "linux", arch: "arm64" })), "it was built for linux-arm64");
    assert.equal(problem((m) => ({ ...m, format: 2 })), "its manifest is format 2, which this Filament doesn't read");
    assert.equal(problem((m) => ({ ...m, files: { ...m.files, "../outside.txt": "0".repeat(64) } })), "its manifest lists a file outside it: ../outside.txt");
    assert.equal(problem((m) => ({ ...m, mnemosyne: "" })), "its manifest names no mnemosyne version");
    writeFileSync(join(dir, "manifest.json"), "{not json");
    assert.equal(inst.readBundle(root).problem, "its manifest can't be read");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true }); }
});

// (fails before: no — written after the code, for the manifest checks the mutation pass left untested one by one)
test("readBundle: each thing a manifest must hold, and each way a listed path leaves the bundle, is named", () => {
  const root = tmp();
  let n = 0;
  try {
    const problem = (edit) => { const r = join(root, String(n++)); buildBundle(r, { edit }); return inst.readBundle(r).problem; };
    const withFiles = (fn) => (m) => ({ ...m, files: fn({ ...m.files }) });
    const sum = "0".repeat(64), uv = WIN ? "uv.exe" : "uv", otherArch = process.arch === "arm64" ? "x64" : "arm64";
    assert.equal(problem((m) => ({ ...m, arch: otherArch })), `it was built for ${process.platform}-${otherArch}`, "the same system on another processor");
    assert.equal(problem(withFiles((f) => ({ ...f, "wheels\\other.whl": sum }))), "its manifest lists a file outside it: wheels\\other.whl");
    assert.equal(problem(withFiles((f) => ({ ...f, "C:/other.whl": sum }))), "its manifest lists a file outside it: C:/other.whl");
    assert.equal(problem(withFiles((f) => ({ ...f, "wheels//other.whl": sum }))), "its manifest lists a file outside it: wheels//other.whl");
    assert.equal(problem(withFiles((f) => ({ ...f, "requirements.txt": "abc123" }))), "its manifest gives requirements.txt no sha256", "hex, but not a sha256's 64");
    assert.equal(problem(withFiles((f) => ({ ...f, "requirements.txt": "A".repeat(64) }))), "its manifest gives requirements.txt no sha256", "a sha256 is written in lower case");
    const without = (pred) => withFiles((f) => Object.fromEntries(Object.entries(f).filter(([rel]) => !pred(rel))));
    assert.equal(problem(without((rel) => rel.startsWith("fastembed/"))), "its manifest leaves out fastembed/", "a bundle with embeddings holds the model");
    assert.equal(problem((m) => without((rel) => rel.startsWith("fastembed/"))({ ...m, embeddings: false })), null, "one without them needn't");
    const renamed = (from, to) => withFiles((f) => { const s = f[from]; delete f[from]; return { ...f, [to]: s }; });
    assert.equal(problem(renamed("requirements.txt", "requirements.txt.old")), "its manifest leaves out requirements.txt", "a file part is that file, not a name it starts");
    assert.equal(problem(renamed(uv, `${uv}.old`)), `its manifest leaves out ${uv}`);
    assert.equal(problem(without((rel) => rel.startsWith("python/"))), "its manifest leaves out python/");
    assert.equal(problem(without((rel) => rel.startsWith("wheels/"))), "its manifest leaves out wheels/");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("installEngine from a bundle: no network; uv placed from it, Python from its archive through uv's mirror, the wheels by their hashes, the model copied; offline everywhere; source bundle", async () => {
  const dataDir = tmp(), root = tmp(), records = [], events = [];
  try {
    const bdir = buildBundle(root);
    const state = await installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, records), onProgress: (e) => events.push(e) });
    const eng = engineDir(dataDir), uv = join(eng, WIN ? "uv.exe" : "uv"), py = venvPy(dataDir);
    const found = join(eng, "python", "cpython-3.12.11-windows-x86_64-none", "python.exe");
    assert.deepEqual(records.map((r) => r.line), [
      `${basename(uv)} --version`,
      `${basename(uv)} python install 3.12.11`,
      `${basename(uv)} python find 3.12.11`,
      `${basename(uv)} venv ${join(eng, "venv")} --python ${found} --clear`,
      `${basename(uv)} pip install --python ${py} --reinstall-package mnemosyne-memory --offline --no-index --find-links ${join(bdir, "wheels")} --require-hashes -r ${join(bdir, "requirements.txt")}`,
      `python${WIN ? ".exe" : ""} -c <snippet>`,
      `python${WIN ? ".exe" : ""} -c <snippet>`,
    ]);
    // uv is the bundle's, copied into the engine folder and run from there
    assert.equal(readFileSync(uv, "utf8"), "MZ the bundle's uv"); assert.ok(records.slice(0, 5).every((r) => r.file === uv));
    // Python is uv's own install of the bundle's archive: its downloads point at the bundle
    assert.equal(records[1].env.UV_PYTHON_INSTALL_MIRROR, pathToFileURL(join(bdir, "python")).href); assert.equal(records[2].env.UV_PYTHON_INSTALL_MIRROR, pathToFileURL(join(bdir, "python")).href);
    assert.equal(records[1].env.UV_PYTHON_INSTALL_DIR, join(eng, "python"));
    // a bundle built before 11-08 lists no Python of its own: uv checks the archive by its own sha256 of the release
    // (the bundle build's tests take the list's path to uv)
    assert.equal(existsSync(join(bdir, "python", "downloads.json")), false);
    for (const r of records.slice(1, 3)) assert.equal("UV_PYTHON_DOWNLOADS_JSON_URL" in r.env, false, r.line);
    // (fails before: yes — the bundle build's log of 10-28: uv's Python install puts python3.12.exe in ~/.local/bin,
    // outside Filament's folders, where an uninstall never reaches) its executables stay in the engine's folder
    for (const r of records.slice(1, 4)) assert.equal(r.env.UV_PYTHON_BIN_DIR, join(eng, "python-bin"), r.line);
    // offline, enforced by the tools themselves
    for (const r of records.slice(3, 5)) assert.equal(r.env.UV_OFFLINE, "1", r.line);
    assert.equal(records[5].env.HF_HUB_OFFLINE, "1"); assert.match(records[5].args[1], /TextEmbedding/);
    // (fails before: yes — 11-08: the warm loaded the model and never ran it, so a Mac engine that could not embed under
    // the hardened runtime would pass its proof install) the model run once
    assert.match(records[5].args[1], /m\.embed\(\['warm'\]\)/);
    // (c2) the model the bundle carries is the one warmed, not this build's, and engine.json records it for the engine to run on
    assert.ok(records[5].args[1].includes('"BAAI/bge-small-en-v1.5"') && !records[5].args[1].includes(inst.EMBEDDING_MODEL), records[5].args[1]);
    assert.equal(engineState(dataDir).embeddingModel, "BAAI/bge-small-en-v1.5");
    // the model's cache, copied as the bundle holds it
    assert.equal(readFileSync(join(eng, "cache", "fastembed", "models--qdrant--bge-small-en-v1.5-onnx-q", "snapshots", "abc123", "model_optimized.onnx"), "utf8"), "the model's weights");
    // where it came from: said as the install starts, and kept
    assert.equal(events.find((e) => e.step === "uv" && e.status === "start").source, "bundle");
    assert.ok(said(events, /^checking the bundle's 7 files/), events.filter((e) => e.step === "uv").map((e) => e.message).join(" | "));
    assert.ok(events.some((e) => e.step === "uv" && e.status === "done" && e.message === "uv 0.8.17 from the bundle"));
    assert.ok(events.some((e) => e.step === "package" && e.status === "start" && e.message === `installing mnemosyne-memory[embeddings] @ ${FORK_3_15_1} from the bundle`));
    assert.deepEqual([...new Set(events.map((e) => e.step))], ["uv", "python", "venv", "package", "model", "verify"]); assert.equal(events.at(-1).percent, 100);
    assert.equal(state.installed, true); assert.equal(state.source, "bundle"); assert.equal(state.mnemosyneVersion, DEFAULT_VERSION);
    assert.equal(JSON.parse(readFileSync(join(eng, "engine.json"), "utf8")).source, "bundle");
    // (fails before: yes — nothing said which bundle an engine came from, so a new Filament's could not be told from it)
    // The bundle it came from, kept: what a newer Filament's bundle is told apart by.
    const id = sha256(readFileSync(join(bdir, "manifest.json")));
    assert.deepEqual(state.bundle, { id, builtAt: "2026-10-04T00:00:00.000Z", mnemosyne: DEFAULT_VERSION });
    assert.deepEqual(JSON.parse(readFileSync(join(eng, "engine.json"), "utf8")).bundle, state.bundle);
    assert.equal(inst.engineIsBundles(state, inst.readBundle(root)), true);
    assert.equal(inst.engineIsBundles({ ...state, bundle: { ...state.bundle, id: "0".repeat(64) } }, inst.readBundle(root)), false, "another build");
    assert.equal(inst.engineIsBundles({ ...state, source: "download", bundle: null }, inst.readBundle(root)), false, "a downloaded engine");
    assert.equal(inst.engineIsBundles({ ...state, installed: false }, inst.readBundle(root)), false, "none installed");
    // an install stopped before it starts copies nothing
    const other = tmp(), dead = new AbortController(); dead.abort();
    try {
      await assert.rejects(installEngine({ dataDir: other, bundle: root, signal: dead.signal, spawnImpl: fakeSpawn(other, []) }), (e) => e.aborted === true && e.step === "uv");
      assert.ok(!existsSync(join(engineDir(other), WIN ? "uv.exe" : "uv")));
    } finally { rmSync(other, { recursive: true, force: true }); }
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// (fails before: yes — the owner's Mac of 11-08: "Didn't install: EACCES, Permission denied '…/snapshots/faf4aa…'". The
// Mac app carries the Hub's big files read-only (model_optimized.onnx and tokenizer.json -r--r--r--); the copy kept that,
// and the next release's install, replacing the engine, could not write over it.)
test("installEngine from a bundle whose model is read-only: the copy is left writable, and a later install replaces it and what the old one left", async () => {
  const dataDir = tmp(), root = tmp();
  try {
    const bdir = buildBundle(root), rel = ["models--qdrant--bge-small-en-v1.5-onnx-q", "snapshots", "abc123", "model_optimized.onnx"];
    chmodSync(join(bdir, "fastembed", ...rel), 0o444);
    await installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) });
    const cache = join(engineDir(dataDir), "cache", "fastembed"), model = join(cache, ...rel);
    assert.equal(readFileSync(model, "utf8"), "the model's weights");
    assert.ok(statSync(model).mode & 0o200, "the copy is writable");
    // As the first install left it on the Mac — its copy read-only — and a file another release's model left beside it.
    chmodSync(model, 0o444);
    const old = join(cache, "models--qdrant--all-minilm-l6-v2-onnx", "snapshots", "def456", "model.onnx");
    mkdirSync(dirname(old), { recursive: true }); writeFileSync(old, "another release's model"); chmodSync(old, 0o444);
    const state = await installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) });
    assert.equal(state.installed, true); assert.equal(state.error, null);
    assert.equal(readFileSync(model, "utf8"), "the model's weights"); assert.ok(statSync(model).mode & 0o200);
    assert.equal(existsSync(join(cache, "models--qdrant--all-minilm-l6-v2-onnx")), false, "the cache is the bundle's alone");
  } finally {
    // The bundle's read-only file made writable first: Electron's rmSync stops at one (NA1, as uninstallEngine says).
    inst.writable(root);
    await removeDirs(dataDir, root);
  }
});

// (fails before: yes — a damaged bundle sent the install to download instead)
test("a damaged bundle stops the install, the damage named; nothing runs and nothing downloads", async () => {
  const dataDir = tmp(), root = tmp(), records = [], events = [];
  try {
    const bdir = buildBundle(root);
    writeFileSync(join(bdir, "wheels", "fastembed-0.7.3-py3-none-any.whl"), "something else");
    const damaged = `memory engine uv: the memory engine bundle at ${bdir} is damaged: wheels/fastembed-0.7.3-py3-none-any.whl differs from its manifest; reinstall Filament, or in a checkout build it again with npm run engine:bundle`;
    await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, records), onProgress: (e) => events.push(e) }), (e) => e.step === "uv" && e.message === damaged);
    assert.deepEqual(records, [], "nothing ran");
    assert.ok(!existsSync(join(engineDir(dataDir), WIN ? "uv.exe" : "uv")), "nothing was copied");
    assert.ok(!events.some((e) => e.source === "download"), "nothing was downloaded");
    const s = engineState(dataDir); assert.equal(s.installed, false); assert.equal(s.error, damaged);
    // a file the manifest lists that is gone (the wheel put right first)
    writeFileSync(join(bdir, "wheels", "fastembed-0.7.3-py3-none-any.whl"), "the fastembed wheel"); rmSync(join(bdir, "requirements.txt"));
    await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) }), (e) => / is damaged: requirements\.txt is missing; /.test(e.message));
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// (fails before: yes — the packaging Hunter's find: a stop while the last file was read found no damage and went on,
// and a uv that would not answer marked a working engine not installed, though nothing it runs on had been replaced)
test("over an engine installed, anything that stops the install before its Python is replaced keeps that engine: a stop as the last file is read, a uv that fails", async () => {
  const root = tmp(), dataDir = tmp();
  try {
    buildBundle(root);
    const b = /** @type {any} */ (readBundle(root));
    let reads = 0;
    const files = Object.keys(b.manifest.files).length;
    const late = /** @type {any} */ ({ get aborted() { return ++reads > files; } });
    await assert.rejects(bundleDamage(b, { signal: late, step: "uv" }), (e) => e.aborted === true, "a stop as the last file was read is a stop");
    const eng = engineDir(dataDir), py = venvPy(dataDir);
    mkdirSync(dirname(py), { recursive: true }); writeFileSync(py, "");
    const before = JSON.stringify({ installed: true, source: "download", venvPython: py, mnemosyneVersion: "3.15.1", error: null, log: [] });
    writeFileSync(join(eng, "engine.json"), before);
    const base = fakeSpawn(dataDir, []);
    /** @type {any} */
    const noUv = (file, args, opts) => {
      if (args[0] !== "--version") return base(file, args, opts);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      setImmediate(() => { child.stderr.end("uv: cannot run\n"); child.stdout.end(); setImmediate(() => child.emit("close", 1, null)); });
      return child;
    };
    await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: noUv }), (e) => e.step === "uv");
    assert.equal(readFileSync(join(eng, "engine.json"), "utf8"), before, "the engine as it was: installed");
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// A process that starts another outside its own job, as uv starts a Python, writes that one's id to the file it is
// given, and waits. Killed alone, it leaves the other running.
const STARTS_ANOTHER =
  'const c = require("child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore", detached: true, windowsHide: true }); require("fs").writeFileSync(process.argv[1], String(c.pid)); setTimeout(() => {}, 60000);';

// (fails before: yes — the bug hunt of 10-30, MEMR-11: a stop killed uv alone, and what uv had started ran on, holding
// the engine's files)
test("a stop ends the running step's process with what it started", { skip: !WIN && "taskkill is Windows'" }, async () => {
  const dataDir = tmp(), root = tmp();
  let kid = 0;
  try {
    buildBundle(root);
    const pidFile = join(dataDir, "started.pid");
    const base = fakeSpawn(dataDir, []);
    // The package step's uv, as a real process that starts another.
    const spawnImpl = (file, args, opts) => (args[0] === "pip" ? realSpawn(process.execPath, ["-e", STARTS_ANOTHER, pidFile], opts) : base(file, args, opts));
    const stop = new AbortController();
    const run = installEngine({ dataDir, bundle: root, signal: stop.signal, spawnImpl });
    run.catch(() => {});
    kid = Number(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8"), "the step's process to start another"));
    stop.abort();
    await assert.rejects(run, (e) => e.aborted === true && e.step === "package");
    await until(() => !alive(kid), "what the step's process started to end");
  } finally {
    if (kid && alive(kid)) process.kill(kid);
    await removeDirs(dataDir, root);
  }
});

// (fails before: yes — the Hunter's find: engine.json said installed until the install ended, so a Filament that quit
// halfway through one over an engine started a half-rebuilt one at its next start)
test("an install over an engine installed says none is installed from the moment it replaces what that engine runs on", async () => {
  const dataDir = tmp(), root = tmp(), records = [];
  try {
    const eng = engineDir(dataDir), py = venvPy(dataDir);
    mkdirSync(dirname(py), { recursive: true }); writeFileSync(py, "");
    writeFileSync(join(eng, "engine.json"), JSON.stringify({ installed: true, source: "download", venvPython: py, mnemosyneVersion: "3.15.1", error: null, log: [] }));
    buildBundle(root);
    const stop = new AbortController();
    const at = installEngine({ dataDir, bundle: root, signal: stop.signal, spawnImpl: fakeSpawn(dataDir, records, { hang: (l) => l.includes(" python install") }) });
    at.catch(() => {});
    for (let i = 0; i < 500 && !records.some((r) => r.line.includes(" python install")); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(records.some((r) => r.line.includes(" python install")), "the install reached its Python");
    const mid = engineState(dataDir);
    assert.deepEqual([mid.installed, mid.error], [false, "an install over it was under way and did not finish"], "halfway: no engine to start");
    stop.abort();
    await assert.rejects(at, (e) => e.aborted === true);
    assert.equal(engineState(dataDir).installed, false);
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// (fails before: yes — the Hunter's find: every failure wrote installed: false, so a damaged new bundle, or a Stop while
// its files were checked, left a working engine untouched on disk and never started again)
test("over an engine installed, a damaged bundle or a stop while its files are checked leaves that engine as it was: installed, its state unchanged", async () => {
  const dataDir = tmp(), root = tmp();
  try {
    const eng = engineDir(dataDir);
    const py = WIN ? join(eng, "venv", "Scripts", "python.exe") : join(eng, "venv", "bin", "python");
    mkdirSync(dirname(py), { recursive: true }); writeFileSync(py, "");
    const before = JSON.stringify({ installed: true, source: "bundle", bundle: { id: "old" }, venvPython: py, mnemosyneVersion: "3.15.1", error: null, log: [] });
    writeFileSync(join(eng, "engine.json"), before);
    const bdir = buildBundle(root);
    writeFileSync(join(bdir, "requirements.txt"), "changed");
    await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) }), / is damaged: requirements\.txt differs from its manifest; /);
    assert.equal(readFileSync(join(eng, "engine.json"), "utf8"), before, "engine.json untouched");
    assert.deepEqual([engineState(dataDir).installed, engineState(dataDir).bundle], [true, { id: "old" }]);
    writeFileSync(join(bdir, "requirements.txt"), BUNDLE_FILES()["requirements.txt"]);
    const stop = new AbortController(); stop.abort();
    await assert.rejects(installEngine({ dataDir, bundle: root, signal: stop.signal, spawnImpl: fakeSpawn(dataDir, []) }), (e) => e.aborted === true);
    assert.equal(readFileSync(join(eng, "engine.json"), "utf8"), before, "a stop while the files are checked: untouched too");
    // With no engine installed, the refusal is kept as the install's error, as ever.
    rmSync(join(eng, "engine.json"));
    writeFileSync(join(bdir, "requirements.txt"), "changed");
    await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, []) }));
    assert.match(String(engineState(dataDir).error), / is damaged: requirements\.txt differs/);
  } finally { rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// (fails before: yes — each of these installed by download, saying so in a line of progress)
test("no bundle, one for another machine, or one for another engine version: refused before anything runs, saying why", async () => {
  const refusal = async (root, o = {}) => {
    const dataDir = tmp(), records = [];
    try {
      let said = "";
      await assert.rejects(installEngine({ dataDir, bundle: root, spawnImpl: fakeSpawn(dataDir, records), ...o }), (e) => ((said = e.message), true));
      assert.deepEqual(records, [], "nothing ran"); assert.equal(existsSync(engineDir(dataDir)), false, "nothing was made");
      return said;
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  };
  const none = tmp(), other = tmp(), older = tmp();
  try {
    assert.equal(await refusal(none), `this Filament has no memory engine bundle for ${process.platform}-${process.arch} in ${none}: reinstall Filament, or in a checkout build it with npm run engine:bundle`);
    const odir = buildBundle(other, { edit: (m) => ({ ...m, platform: "linux", arch: "arm64" }) });
    assert.equal(await refusal(other), `the memory engine bundle at ${odir} can't be used: it was built for linux-arm64`);
    const adir = buildBundle(older);
    assert.equal(await refusal(older, { version: "3.16.0", commits: COMMITS }), `the memory engine bundle at ${adir} holds mnemosyne 3.15.1, and this Filament runs 3.16.0: build it again with npm run engine:bundle`);
  } finally { for (const d of [none, other, older]) rmSync(d, { recursive: true, force: true }); }
});

// ---- the real thing: FILAMENT_INSTALL_TEST=1 node --test test/memory-install.test.js ----
const dirSize = (d) => { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); try { n += e.isDirectory() ? dirSize(p) : statSync(p).size; } catch {} } return n; };
test("real download install into a temp dir, as a bundle build starts: uv, Python 3.12, mnemosyne-memory[embeddings], model, verify", { skip: !process.env.FILAMENT_INSTALL_TEST && "set FILAMENT_INSTALL_TEST=1 to run (network, ~300 MB)", timeout: 30 * 60 * 1000 }, async () => {
  const dataDir = tmp(), t0 = Date.now(), marks = {}; let last = t0;
  const log = (m) => console.log(`[install ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  try {
    const state = await downloadEngine({ dataDir, onProgress: (e) => { if (e.status === "done" || e.status === "skip") { marks[e.step] = Date.now() - last; last = Date.now(); } if (e.status !== "progress" || e.bytesDone) log(`${e.step} ${e.status} ${e.message}`); } });
    const eng = engineDir(dataDir);
    log(`steps (s): ${Object.entries(marks).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}`).join(" ")}`);
    log(`sizes (MB): ${["python", "venv", "cache/uv", "cache/fastembed"].map((d) => `${d}=${(dirSize(join(eng, d)) / 1048576).toFixed(0)}`).join(" ")} total=${(dirSize(eng) / 1048576).toFixed(0)}`);
    assert.equal(state.installed, true); assert.equal(state.mnemosyneVersion, DEFAULT_VERSION); assert.ok(state.fastembed && state.sqliteVec, JSON.stringify(state));
    assert.ok(existsSync(state.uv) && existsSync(state.venvPython) && existsSync(state.python)); assert.match(state.pythonVersion, /^3\.12\./); assert.ok(state.uvVersion);
    assert.ok(readdirSync(join(eng, "cache", "fastembed")).length > 0, "model cached");
    // the venv works with the sidecar environment and finds the cached model offline
    const env = { ...process.env, ...sidecarEnv({ memoryFolder: join(dataDir, "memory"), base: "http://127.0.0.1:4141", apiKey: "k", model: "m", llmEnabled: false, embeddings: true, engine: state.dir }), HF_HUB_OFFLINE: "1" };
    const r = spawnSync(state.venvPython, ["-c", "import os, mnemosyne, sqlite_vec\nfrom fastembed import TextEmbedding\nm = TextEmbedding(model_name='" + state.embeddingModel + "', cache_dir=os.environ['MNEMOSYNE_FASTEMBED_CACHE_DIR'])\nprint('dims', len(list(m.embed(['hello']))[0]))"], { env, encoding: "utf8", windowsHide: true, timeout: 120000 });
    assert.match(r.stdout, /dims 384/, r.stderr); log(`embedding probe: ${r.stdout.trim()}`);
    const t2 = Date.now(); const again = await downloadEngine({ dataDir, onProgress: (e) => { if (e.status === "skip") log(`reinstall ${e.step} ${e.status} ${e.message}`); } });
    assert.equal(again.installed, true); log(`reinstall over an existing engine took ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  } finally { const t3 = Date.now(); await uninstallEngine(dataDir); rmSync(dataDir, { recursive: true, force: true }); log(`uninstall took ${((Date.now() - t3) / 1000).toFixed(1)}s`); }
});
