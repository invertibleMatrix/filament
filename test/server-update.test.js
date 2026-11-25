// @ts-check
// filament update (the remote plan's sv-update): Filament for servers, installed by install.sh, updated in place. The
// releases are a server of the test's own on 127.0.0.1 — GitHub's API for a release (update.js `here.fetch` sends
// api.github.com there), latest-server.yml and the tarballs, made by scripts/dist-server.mjs's own feedOf and
// writeTarGz; the install a throwaway <base>/<version> with its build-info.json and the `current` link (a junction on
// Windows, which needs no developer mode); this Filament's root and this machine's glibc the update's stand-ins
// (`here`). systemd is a stand-in systemctl on the PATH, run through Node (service.js `tools`), and Filament a server
// of the test's own at the address its listening.json says, which runs the version `current` pointed at as systemd
// started it. The tarballs unpack by the system's tar (Windows' own bsdtar).
// (fails before: yes — there was no `filament update`: a server was updated by running install.sh again, which
// restarted nothing, and went back by FILAMENT_VERSION alone)
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { FEED, feedName, feedOf, LAUNCHER, layoutOf, MARKER, tarballName, topOf, writeTarGz } from "../scripts/dist-server.mjs";
import { writeListening } from "../src/cli/listening.js";
import { EXIT } from "../src/cli/client.js";
import { runCli } from "../src/cli/main.js";
import { tools } from "../src/cli/service.js";
import { here } from "../src/cli/update.js";
import { SERVER_FEED, isNewer, serverAsset, serverTarball, shaIn } from "../src/services/updates.js";
import { readStoreFile } from "../src/services/store-files.js";
import { removeDirs, until } from "./helpers/wait.js";

const WIN = process.platform === "win32";

/** A file's SHA-512, base64, as latest-server.yml gives it. @param {string | Buffer} body */
const sha512Of = (body) => createHash("sha512").update(body).digest("base64");

/**
 * systemctl --user, as the update's restart calls it: the unit's main pid, start, restart and stop. Each call is noted
 * in FAKE_SYSTEMD_CALLS; the state is in FAKE_SYSTEMD's file. A start runs the version FAKE_CURRENT points at, as
 * systemd starting current/bin/filament does — or the one its unit names whatever current says (`pinned`); a version
 * of `dead` ends as it starts — its unit then starting it again (`active` activating) —, one of `mute` runs and
 * answers nothing; `unsaid`: systemd cannot say its main process. Written to a file as it is here, run by Node.
 * @param {any} require
 */
function fakeSystemctl(require) {
  const fs = require("fs");
  const path = require("path");
  const [tool, ...args] = process.argv.slice(2);
  fs.appendFileSync(String(process.env.FAKE_SYSTEMD_CALLS), `${JSON.stringify([tool, ...args])}\n`);
  const file = String(process.env.FAKE_SYSTEMD);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const [user, verb, ...rest] = args;
  if (tool !== "systemctl" || user !== "--user") return void (process.exitCode = 1);
  if (verb === "show" && rest.join(" ") === "filament -p MainPID --value") return void (s.unsaid ? (process.exitCode = 1) : process.stdout.write(`${s.mainPid}\n`));
  if (verb === "show" && rest.join(" ") === "filament -p MainPID -p ActiveState")
    return void (s.unsaid ? (process.exitCode = 1) : process.stdout.write(`MainPID=${s.mainPid}\nActiveState=${s.active || (s.running ? "active" : "inactive")}\n`));
  if (verb === "start" || verb === "restart") {
    if (verb === "start" && s.running) return;
    const ran = s.pinned || path.basename(fs.realpathSync(String(process.env.FAKE_CURRENT)));
    const dead = (s.dead || []).includes(ran);
    Object.assign(s, { running: !dead, mainPid: dead ? 0 : ++s.pids, ran, hung: (s.mute || []).includes(ran), active: dead ? "activating" : "" });
  } else if (verb === "stop") Object.assign(s, { running: false, mainPid: 0, active: "" });
  else return void (process.exitCode = 1);
  fs.writeFileSync(file, JSON.stringify(s));
}

const MAIN_PID = ["systemctl", "--user", "show", "filament", "-p", "MainPID", "--value"];

/**
 * What is under `dir`, to see a run changed nothing: each entry by its path, a link with what it points at and when it
 * was made, a file with its size and time (install-sh.test.js's).
 * @param {string} dir @returns {string[]}
 */
function treeAt(dir, at = "") {
  if (!existsSync(join(dir, at))) return [];
  /** @type {string[]} */
  const out = [];
  for (const n of readdirSync(join(dir, at)).sort()) {
    const rel = at ? `${at}/${n}` : n,
      st = lstatSync(join(dir, rel));
    if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(join(dir, rel))} ${st.mtimeMs}`);
    else if (st.isDirectory()) out.push(`${rel}/`, ...treeAt(dir, rel));
    else out.push(`${rel} ${st.size} ${st.mtimeMs}`);
  }
  return out;
}

/** A server build's build-info.json, as scripts/dist-server.mjs writes it. @param {string} version @param {boolean} engine @param {string} glibc @param {string} [target] */
const markerOf = (version, engine, glibc, target = "linux-x64") => ({ kind: "server", version, target, file: tarballName(version, engine, target), feed: feedName(target), engine, node: "v24.11.0", glibc, releases: { provider: "github", owner: "o", repo: "r" } });

describe("filament update, on a server installed by install.sh", () => {
  const NAMES = ["PATH", "FAKE_SYSTEMD", "FAKE_SYSTEMD_CALLS", "FAKE_CURRENT", "FILAMENT_MACHINE"];
  /** @type {Record<string, string | undefined>} */
  const was = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  const own = { ...here };
  const ownSpawn = tools.spawn;
  /** The releases: download/v<version>/<file> under it; `latest` the version GitHub calls the newest. */
  let rel = "";
  let latest = "";
  let url = "";
  /** @type {string[]} */
  const hits = [];
  /** Paths that answer HTTP 500: a download that fails. @type {Set<string>} */
  const failing = new Set();
  /** @type {import("node:http").Server} */
  let releases;

  /** @type {string} */
  let dir;
  /** @type {string} */
  let base;
  /** @type {string} */
  let data;
  /** @type {string} */
  let stateFile;
  /** @type {string} */
  let callsFile;
  /** @type {string} */
  let fake;
  /** @type {{ method: string, path: string, body: any }[]} */
  let came;
  /** @type {import("node:http").Server} */
  let filament;

  before(async () => {
    rel = mkdtempSync(join(tmpdir(), "filament-update-releases-"));
    releases = createServer((req, res) => {
      const path = decodeURIComponent(String(req.url || "").split("?")[0]);
      hits.push(path);
      // GitHub's API: the newest release, or one by its tag, with its assets.
      const api = /^\/repos\/o\/r\/releases\/(?:latest|tags\/v([^/]+))$/.exec(path);
      if (api) {
        const v = api[1] || latest;
        const at = join(rel, `v${v}`);
        if (!v || !existsSync(at)) return void res.writeHead(404, { "content-type": "application/json" }).end('{"message":"Not Found"}');
        const assets = readdirSync(at).map((name) => ({ name, size: statSync(join(at, name)).size, browser_download_url: `${url}/download/v${v}/${name}` }));
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: `v${v}`, html_url: `${url}/tag/v${v}`, assets }));
      }
      const m = /^\/download\/(v[^/]+)\/([^/]+)$/.exec(path);
      const file = m ? join(rel, m[1], m[2]) : "";
      if (failing.has(path)) return void res.writeHead(500).end("broken");
      if (!file || !existsSync(file)) return void res.writeHead(404).end("Not Found");
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(file));
    });
    await new Promise((done) => releases.listen(0, "127.0.0.1", () => done(null)));
    url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (releases.address()).port}`;
    here.fetch = (u, init) => fetch(String(u).replace(/^https:\/\/api\.github\.com/, url), init);
  });
  after(async () => {
    Object.assign(here, own);
    tools.spawn = ownSpawn;
    for (const n of NAMES) {
      if (was[n] === undefined) delete process.env[n];
      else process.env[n] = was[n];
    }
    await new Promise((done) => releases.close(() => done(null)));
    await removeDirs(rel);
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "filament-update-"));
    base = join(dir, "share", "filament");
    data = join(dir, "data");
    const bin = join(dir, "bin");
    for (const d of [base, data, bin]) mkdirSync(d, { recursive: true });
    fake = join(dir, "fake-systemctl.cjs");
    writeFileSync(fake, `(${fakeSystemctl})(require);\n`);
    writeFileSync(join(bin, "systemctl"), "");
    stateFile = join(dir, "systemd.json");
    callsFile = join(dir, "calls.jsonl");
    writeFileSync(callsFile, "");
    writeFileSync(stateFile, JSON.stringify({ running: false, mainPid: 0, pids: 4241, ran: "", supervisor: "systemd", busy: false }));
    hits.length = 0;
    failing.clear();
    came = [];
    // Filament, as the state says it runs: the version systemd started, its /api/shutdown ending it (refused while busy).
    filament = createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const s = state();
        const path = String(req.url || "");
        const body = raw ? JSON.parse(raw) : null;
        came.push({ method: String(req.method), path, body });
        if (!s.running) return void res.writeHead(503).end('{"error":"not running"}');
        // One that runs and answers nothing (`hung`, until systemd starts it again), or its next /api/state slowly (`slowMs`).
        if (s.hung) return void req.socket.destroy();
        if (path === "/api/state") {
          const answer = () => void res.end(JSON.stringify({ version: s.ran, dataDir: data, uptimeMs: 1000, supervisor: s.supervisor }));
          if (!s.slowMs) return answer();
          set({ slowMs: 0 });
          return void setTimeout(answer, s.slowMs);
        }
        if (req.method === "POST" && path === "/api/shutdown") {
          if (body?.ifIdle === true && s.busy) return void res.writeHead(409).end(JSON.stringify({ ok: false, turns: 1, note: "not stopped: 1 turn running in “Fix the build”" }));
          // One whose stop hangs (`lingers`): it says it stops, and its process runs on.
          if (!s.lingers) writeFileSync(stateFile, JSON.stringify({ ...s, running: false, mainPid: 0 }));
          return void res.end('{"ok":true,"inflight":0,"note":"stopping now"}');
        }
        res.writeHead(404).end("{}");
      });
    });
    await new Promise((done) => filament.listen(0, "127.0.0.1", () => done(null)));
    writeListening(data, { host: "127.0.0.1", port: /** @type {import("node:net").AddressInfo} */ (filament.address()).port, pid: process.pid, version: "0.0.0", startedAt: 1 });
    // The stand-in found on the PATH, before anything else there; the system's tar after it.
    process.env.PATH = [bin, String(was.PATH || "")].join(delimiter);
    delete process.env.FILAMENT_MACHINE;
    Object.assign(process.env, { FAKE_SYSTEMD: stateFile, FAKE_SYSTEMD_CALLS: callsFile, FAKE_CURRENT: join(base, "current") });
    tools.spawn = /** @type {any} */ ((/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ o) => spawn(process.execPath, [fake, basename(file), ...args], o));
    here.glibc = () => "2.35";
  });
  afterEach(async () => {
    filament.closeAllConnections();
    await new Promise((done) => filament.close(() => done(null)));
    here.root = own.root;
    here.glibc = own.glibc;
    here.idleMs = own.idleMs;
    await removeDirs(dir);
  });

  /** systemd's state now. */
  const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
  /** @param {Record<string, any>} change */
  const set = (change) => writeFileSync(stateFile, JSON.stringify({ ...state(), ...change }));
  /** The calls systemctl took, in order; each noted from here on. */
  const calls = () => {
    const all = readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    writeFileSync(callsFile, "");
    return /** @type {string[][]} */ (all);
  };

  /**
   * A release of `version`: for each of `targets` (x64 alone where none is named), the whole tarball and, with `small`,
   * the one without the engine; their latest-server.yml, or latest-server-arm64.yml for arm64's. `damaged`: the yml
   * gives another file's SHA-512; `broken`: a tarball that is no tarball, its SHA-512 the yml's.
   * @param {string} version @param {{ small?: boolean, damaged?: boolean, broken?: boolean, glibc?: string, targets?: string[] }} [o]
   */
  async function release(version, { small = false, damaged = false, broken = false, glibc = "2.35", targets = ["linux-x64"] } = {}) {
    const at = join(rel, `v${version}`);
    mkdirSync(at, { recursive: true });
    for (const target of targets) {
      const made = [];
      for (const engine of small ? [true, false] : [true]) {
        const name = tarballName(version, engine, target);
        if (broken) {
          const body = Buffer.from("not a tarball at all");
          writeFileSync(join(at, name), body);
          made.push({ name, sha512: sha512Of(body), size: body.length });
          continue;
        }
        // each machine's own: bin/filament and node/bin/node, or a Windows host's bin/filament.cmd and node/node.exe
        const lay = layoutOf(target);
        const entries = [
          { name: lay.launcher, mode: 0o755, body: Buffer.from(lay.body) },
          { name: "bin/filament.js", mode: 0o755, body: Buffer.from("console.log('filament');\n") },
          { name: lay.node, mode: 0o755, body: Buffer.from(`#!/bin/sh\necho "${version}"\n`) },
          { name: MARKER, mode: 0o644, body: Buffer.from(`${JSON.stringify(markerOf(version, engine, glibc, target), null, 2)}\n`) },
          ...(engine ? [{ name: `vendor/memory-engine/${target}/model.bin`, mode: 0o644, body: Buffer.alloc(64 * 1024, 7) }] : []),
        ];
        const { sha512, size } = await writeTarGz(entries, join(at, name), { top: topOf(name), mtime: 1_762_560_000 });
        made.push({ name, sha512: damaged ? sha512Of("another file") : sha512, size });
      }
      writeFileSync(join(at, feedName(target)), feedOf({ version, files: made, at: "2026-11-08T00:00:00.000Z" }));
    }
  }

  /**
   * Filament installed as install.sh installs it: each version's folder under <base>, `current` pointing at `at`, and
   * this Filament run from there; `target` the machine its build is for.
   * @param {string[]} versions @param {string} at @param {{ engine?: boolean, target?: string }} [o]
   */
  function installed(versions, at, { engine = true, target = "linux-x64" } = {}) {
    for (const v of versions) {
      mkdirSync(join(base, v, "bin"), { recursive: true });
      writeFileSync(join(base, v, MARKER), `${JSON.stringify(markerOf(v, engine, "2.35", target), null, 2)}\n`);
      writeFileSync(join(base, v, layoutOf(target).launcher), layoutOf(target).body);
    }
    symlinkSync(WIN ? join(base, at) : at, join(base, "current"), "junction");
    here.root = join(base, at);
  }

  /** The version `current` points at. */
  const current = () => {
    assert.ok(lstatSync(join(base, "current")).isSymbolicLink(), "current is a link");
    return basename(realpathSync(join(base, "current")));
  };
  /** What is in Filament's folder: the versions and current, and nothing a run left. */
  const folders = () => readdirSync(base).sort();

  /** Filament running under systemd, as the version current points at. @param {Record<string, any>} [more] */
  const running = (more = {}) => set({ running: true, mainPid: 4242, ran: current(), ...more });

  /** @param {string[]} argv */
  async function run(argv) {
    /** @type {{ out: string[], err: string[] }} */
    const said = { out: [], err: [] };
    const term = /** @type {any} */ ({ input: null, output: { isTTY: false, write() {} }, tty: false });
    const code = await runCli(argv, { dataDir: data, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: () => {} });
    return { code, out: said.out.join("\n"), err: said.err.join("\n") };
  }

  test("the newest already: said, nothing downloaded, nothing changed, nothing restarted", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.1.0"], "1.1.0");
    running();
    const tree = treeAt(base);
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.out, "Filament 1.1.0 is already the newest release of o/r: nothing to update.");
    assert.deepEqual(hits, ["/repos/o/r/releases/latest"]);
    assert.deepEqual(treeAt(base), tree);
    assert.deepEqual(calls(), []);
    assert.deepEqual(JSON.parse((await run(["update", "--json"])).out), { result: "newest", installed: "1.1.0", repo: "o/r" });
  });

  test("a newer release: its whole tarball, as installed, downloaded and checked, unpacked beside, current moved in one rename and the one before kept; Filament restarted under systemd once idle, and it runs the new one", async () => {
    await release("1.1.0", { small: true });
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running();
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(hits, ["/repos/o/r/releases/latest", "/download/v1.1.0/latest-server.yml", "/download/v1.1.0/filament-server-1.1.0-linux-x64.tar.gz"]);
    assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"], "no temp folder or link left");
    assert.equal(current(), "1.1.0");
    if (WIN) assert.equal(readlinkSync(join(base, "current")), join(base, "1.1.0"), "a junction, by the version's full path");
    else assert.equal(readlinkSync(join(base, "current")), "1.1.0", "by the version's name, as install.sh links it");
    const marker = JSON.parse(readFileSync(join(base, "1.1.0", MARKER), "utf8"));
    assert.deepEqual([marker.version, marker.engine], ["1.1.0", true]);
    assert.ok(existsSync(join(base, "1.1.0", "vendor", "memory-engine", "linux-x64", "model.bin")), "the tarball's top folder, renamed into place");
    assert.ok(existsSync(join(base, "1.0.0", "bin", "filament")), "the one before is kept as it was");
    assert.deepEqual(calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"]]);
    assert.deepEqual(came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }]);
    const lines = r.out.split("\n");
    assert.match(lines[0], /^Downloading Filament 1\.1\.0 \(filament-server-1\.1\.0-linux-x64\.tar\.gz, \d+\.\d MB\)…$/);
    assert.equal(lines[1], `Filament 1.1.0 is installed in ${join(base, "1.1.0")}, and current points at it; 1.0.0 is kept beside it — filament update --back goes back to it.`);
    assert.match(lines.at(-1) || "", /^Filament 1\.1\.0 runs again at http:\/\/127\.0\.0\.1:\d+, under systemd\.$/);
  });

  test("the kind installed is kept: an install without the memory engine gets the -no-engine tarball; a release without one is refused, nothing changed", async () => {
    await release("1.1.0", { small: true });
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.0.0"], "1.0.0", { engine: false });
    const tree = treeAt(base);
    const none = await run(["update"]);
    assert.equal(none.code, EXIT.failed, none.out);
    assert.equal(none.err, "filament update: release 1.2.0 carries no filament-server-1.2.0-linux-x64-no-engine.tar.gz");
    assert.deepEqual(treeAt(base), tree);
    latest = "1.1.0";
    hits.length = 0;
    const r = await run(["update", "--json"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.deepEqual(hits.slice(-1), ["/download/v1.1.0/filament-server-1.1.0-linux-x64-no-engine.tar.gz"]);
    const marker = JSON.parse(readFileSync(join(base, "1.1.0", MARKER), "utf8"));
    assert.equal(marker.engine, false);
    assert.ok(!existsSync(join(base, "1.1.0", "vendor")));
    const j = JSON.parse(r.out);
    assert.deepEqual({ ...j, said: j.said.length > 0 }, { result: "updated", from: "1.0.0", version: "1.1.0", engine: false, dir: join(base, "1.1.0"), kept: "1.0.0", removed: [], restart: "not-running", said: true });
    assert.equal(current(), "1.1.0");
    assert.match(j.said.at(-1), /^No Filament answers now: it runs 1\.1\.0 at its next start\.$/);
  });

  // (fails before: yes — an install took x64's tarball and latest-server.yml whatever machine its build was for)
  test("the machine installed is kept: an arm64 install takes arm64's tarball of its kind, checked by latest-server-arm64.yml, from a release carrying x64's too; one kept beside is arm64's", async () => {
    await release("1.1.0", { small: true, targets: ["linux-x64", "linux-arm64"] });
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0", { target: "linux-arm64" });
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(hits, ["/repos/o/r/releases/latest", "/download/v1.1.0/latest-server-arm64.yml", "/download/v1.1.0/filament-server-1.1.0-linux-arm64.tar.gz"]);
    assert.equal(current(), "1.1.0");
    const marker = JSON.parse(readFileSync(join(base, "1.1.0", MARKER), "utf8"));
    assert.deepEqual([marker.target, marker.engine], ["linux-arm64", true]);
    assert.ok(existsSync(join(base, "1.1.0", "vendor", "memory-engine", "linux-arm64", "model.bin")), "arm64's tarball, renamed into place");
    // back to the one kept, by its own build's file: nothing asked of the releases
    here.root = join(base, "1.1.0");
    hits.length = 0;
    const back = await run(["update", "--version", "1.0.0"]);
    assert.equal(back.code, EXIT.ok, back.err);
    assert.deepEqual(hits, []);
    assert.equal(current(), "1.0.0");
  });

  // (fails before, s3f3: yes — a Windows host's build has bin\filament.cmd, and filament update knew bin/filament alone:
  // its download was "no Filament for servers to run", and none kept beside was one to go back to)
  test("a Windows host, as install.ps1 installs it: the win32-x64 tarball of its kind, checked by latest-server-win32-x64.yml, put in place with its filament.cmd; --back goes to the one kept; one installed elsewhere is told install.ps1", async () => {
    await release("1.1.0", { small: true, targets: ["linux-x64", "win32-x64"] });
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0", { target: "win32-x64" });
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(hits, ["/repos/o/r/releases/latest", "/download/v1.1.0/latest-server-win32-x64.yml", "/download/v1.1.0/filament-server-1.1.0-win32-x64.tar.gz"]);
    assert.equal(current(), "1.1.0");
    assert.ok(existsSync(join(base, "1.1.0", "bin", "filament.cmd")) && existsSync(join(base, "1.1.0", "node", "node.exe")), "a Windows host's build");
    assert.equal(JSON.parse(readFileSync(join(base, "1.1.0", MARKER), "utf8")).target, "win32-x64");
    assert.equal(r.out.split("\n")[1], `Filament 1.1.0 is installed in ${join(base, "1.1.0")}, and current points at it; 1.0.0 is kept beside it — filament update --back goes back to it.`);
    // the one kept is a build to go back to
    here.root = join(base, "1.1.0");
    const back = await run(["update", "--back"]);
    assert.equal(back.code, EXIT.ok, back.err);
    assert.equal(current(), "1.0.0");
    // --version of the one kept: pointed at again, nothing asked of the releases
    here.root = join(base, "1.0.0");
    hits.length = 0;
    const kept = await run(["update", "--version", "1.1.0"]);
    assert.equal(kept.code, EXIT.ok, kept.err);
    assert.deepEqual(hits, []);
    assert.equal(current(), "1.1.0");
    // a Windows host's build that is not where install.ps1 puts one: told install.ps1, and its command
    const loose = join(dir, "loose-win");
    mkdirSync(join(loose, "bin"), { recursive: true });
    writeFileSync(join(loose, MARKER), JSON.stringify(markerOf("1.0.0", true, "", "win32-x64")));
    writeFileSync(join(loose, "bin", "filament.cmd"), layoutOf("win32-x64").body);
    here.root = loose;
    const elsewhere = await run(["update"]);
    assert.equal(elsewhere.code, EXIT.failed);
    assert.equal(elsewhere.err, `filament update: This Filament for servers (${loose}) is not where install.ps1 installs it — a version's folder, with current beside it pointing at it: install.ps1 installs one (irm https://github.com/o/r/releases/latest/download/install.ps1 | iex), which filament update then updates.`);
  });

  test("--version: an older release by its tag, and current moved back to it; one kept is pointed at again with nothing downloaded; one not published, or no version, refused", async () => {
    await release("1.0.0");
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.2.0"], "1.2.0");
    let r = await run(["update", "--version", "1.0.0"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.deepEqual(hits, ["/repos/o/r/releases/tags/v1.0.0", "/download/v1.0.0/latest-server.yml", "/download/v1.0.0/filament-server-1.0.0-linux-x64.tar.gz"]);
    assert.deepEqual(folders(), ["1.0.0", "1.2.0", "current"]);
    assert.equal(current(), "1.0.0");
    // run from where current points now, as ~/.local/bin/filament runs it
    here.root = join(base, "1.0.0");
    hits.length = 0;
    r = await run(["update", "--version", "v1.2.0"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.deepEqual(hits, [], "kept: nothing asked of the releases");
    assert.match(r.out, /^Filament 1\.2\.0 was kept in \S+: current points at it again; 1\.0\.0 is kept beside it — filament update --back goes back to it\.$/m);
    assert.equal(current(), "1.2.0");
    here.root = join(base, "1.2.0");
    const same = await run(["update", "--version", "1.2.0"]);
    assert.equal(same.code, EXIT.ok);
    assert.equal(same.out, "Filament 1.2.0 is installed, and current points at it: nothing changed.");
    const tree = treeAt(base);
    const missing = await run(["update", "--version", "9.9.9"]);
    assert.equal(missing.code, EXIT.failed);
    assert.equal(missing.err, "filament update: o/r has no release 9.9.9");
    assert.equal((await run(["update", "--version", "../1.0.0"])).code, EXIT.usage);
    assert.equal((await run(["update", "--version"])).code, EXIT.usage);
    assert.equal((await run(["update", "--back", "--version", "1.0.0"])).code, EXIT.usage);
    assert.deepEqual(treeAt(base), tree);
  });

  test("nothing half done: a bad SHA-512, a failed download, a tarball that does not unpack — each refused in words, current and the versions as they were, no temp folder left, nothing restarted", async () => {
    installed(["1.0.0"], "1.0.0");
    running();
    const tree = treeAt(base);
    await release("1.1.0", { damaged: true });
    latest = "1.1.0";
    const bad = await run(["update"]);
    assert.equal(bad.code, EXIT.failed, bad.out);
    assert.equal(bad.err, "filament update: Filament 1.1.0 was not installed: the download of Filament 1.1.0 does not match the SHA-512 its release gives: it was not kept. Nothing changed — current still points at 1.0.0.");
    assert.deepEqual(treeAt(base), tree);
    await release("1.2.0");
    latest = "1.2.0";
    failing.add("/download/v1.2.0/filament-server-1.2.0-linux-x64.tar.gz");
    const cut = await run(["update"]);
    assert.equal(cut.code, EXIT.failed, cut.out);
    assert.equal(cut.err, "filament update: Filament 1.2.0 was not installed: the download answered HTTP 500. Nothing changed — current still points at 1.0.0.");
    assert.deepEqual(treeAt(base), tree);
    await release("1.3.0", { broken: true });
    latest = "1.3.0";
    const torn = await run(["update"]);
    assert.equal(torn.code, EXIT.failed, torn.out);
    assert.match(torn.err, /^filament update: Filament 1\.3\.0 was not installed: tar could not unpack filament-server-1\.3\.0-linux-x64\.tar\.gz \(.+\)\. Nothing changed — current still points at 1\.0\.0\.$/);
    assert.deepEqual(treeAt(base), tree);
    assert.deepEqual(calls(), [], "nothing restarted");
    assert.equal(state().mainPid, 4242);
  });

  test("a glibc older than the one the release was built on: refused in words, nothing changed; the build's own goes", async () => {
    await release("1.1.0", { glibc: "2.35" });
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    const tree = treeAt(base);
    here.glibc = () => "2.31";
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.failed, r.out);
    assert.equal(r.err, "filament update: Filament 1.1.0 was not installed: it was built on glibc 2.35, and this machine has 2.31 — Filament would start, but no terminal would open. Nothing changed — current still points at 1.0.0.");
    assert.deepEqual(treeAt(base), tree);
    here.glibc = () => "2.35";
    assert.equal((await run(["update"])).code, EXIT.ok);
    assert.equal(current(), "1.1.0");
  });

  test("a third version: the oldest is removed, the new one and the one before kept; --back points current at the one kept, restarted the same way, and back again; with none kept, refused", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    running();
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.match(r.out, /^Removed Filament 1\.0\.0, not one of the two kept \(\S+\)\.$/m);
    assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"]);
    calls();
    here.root = join(base, "1.2.0");
    hits.length = 0;
    const back = await run(["update", "--back"]);
    assert.equal(back.code, EXIT.ok, back.err);
    assert.deepEqual(hits, [], "nothing asked of the releases");
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"], "both kept");
    assert.equal(back.out.split("\n")[0], `current points at Filament 1.1.0 again (${join(base, "1.1.0")}); 1.2.0 is kept beside it — filament update --back goes back to it.`);
    assert.deepEqual(calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"]]);
    assert.equal(state().ran, "1.1.0", "systemd started the version current points at");
    here.root = join(base, "1.1.0");
    assert.equal((await run(["update", "--back", "--force"])).code, EXIT.ok);
    assert.equal(current(), "1.2.0");
    assert.deepEqual(calls(), [["systemctl", "--user", "restart", "filament"]], "--force: systemctl restart at once");
  });

  // (fails before: yes — the review of s3d: an update to an older version removed every build but the two kept, a
  // newer one among them, said as one older than the two kept)
  test("an update to an older version: every build but the two kept removed, a newer one too, each said as it is; --back goes to the one before", async () => {
    await release("1.0.5");
    installed(["1.0.0", "1.1.0", "1.2.0"], "1.2.0");
    running();
    const r = await run(["update", "--version", "1.0.5"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.match(r.out, /^Removed Filament 1\.0\.0, not one of the two kept \(\S+\)\.$/m);
    assert.match(r.out, /^Removed Filament 1\.1\.0, not one of the two kept \(\S+\)\.$/m);
    assert.doesNotMatch(r.out, /older than the two kept/);
    assert.deepEqual(folders(), ["1.0.5", "1.2.0", "current"]);
    here.root = join(base, "1.0.5");
    const back = await run(["update", "--back"]);
    assert.equal(back.code, EXIT.ok, back.err);
    assert.equal(current(), "1.2.0", "the one before, as the update said");
  });

  // (fails before: yes — the review of x30: where systemd could not say its unit's main process and no Filament answered,
  // the update said none ran, exit 0, and the desk took it for done)
  test("no Filament answers and systemd cannot say whether its unit runs: said, nothing restarted, exit 1", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ hung: true, unsaid: true });
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
    assert.match(r.err, /Filament 1\.1\.0 is installed, and current points at it; no Filament answered at http:\/\/127\.0\.0\.1:\d+ within \d+ seconds, and systemd could not say whether its unit runs, so nothing is restarted — systemctl --user restart filament starts 1\.1\.0 now, and cuts what runs\.$/);
    assert.equal(current(), "1.1.0");
    assert.deepEqual(calls().filter((c) => c[2] !== "show"), [], "systemd told nothing");
  });

  test("--back with no version kept beside: refused, nothing changed", async () => {
    installed(["1.0.0"], "1.0.0");
    const r = await run(["update", "--back"]);
    assert.equal(r.code, EXIT.failed);
    assert.equal(r.err, `filament update: No other version is kept in ${base} to go back to: Filament 1.0.0 is the only one.`);
  });

  // (fails before: yes — r-itself, 11-12: --back pointed current back and restarted, and nothing looked at the data
  // folder: the older build started its stores empty over a newer build's files, and two of them saved over theirs)
  test("--back says, before it restarts, which stores' files the version it goes back to does not read, and what that version does with them", async () => {
    installed(["1.1.0", "1.2.0"], "1.2.0");
    // 1.1.0 carries the stores' table (services/store-files.js): it reads the teams and a Space at version 1.
    mkdirSync(join(base, "1.1.0", "src", "services"), { recursive: true });
    writeFileSync(join(base, "1.1.0", "package.json"), '{"type":"module"}');
    writeFileSync(join(base, "1.1.0", "src", "services", "store-files.js"), 'export const STORE_FILES = { teams: { file: "teams.json", version: 1, starts: "no saved teams" }, agents: { file: "agents.json", version: 1, starts: "no saved agents" }, spaces: { dir: "spaces", version: 1, starts: "an empty Space" } };\n');
    writeFileSync(join(data, "teams.json"), JSON.stringify({ version: 2, teams: {} }));
    writeFileSync(join(data, "agents.json"), JSON.stringify({ version: 1, agents: {} }));
    mkdirSync(join(data, "spaces"));
    for (const p of ["p1", "p2", "p3", "p4", "p5"]) writeFileSync(join(data, "spaces", `${p}.json`), JSON.stringify({ version: p === "p5" ? 1 : 2 }));
    running();
    const tree = treeAt(data);
    calls();
    const back = await run(["update", "--back"]);
    assert.equal(back.code, EXIT.ok, back.err);
    const lines = back.out.split("\n");
    assert.deepEqual(lines.slice(0, 3), [
      `current points at Filament 1.1.0 again (${join(base, "1.1.0")}); 1.2.0 is kept beside it — filament update --back goes back to it.`,
      "teams.json is version 2, which Filament 1.1.0 does not read (it reads version 1): it sets the file aside whole under its version's name (teams.json.v2.<when>), saves nothing over it, and starts with no saved teams. Filament 1.2.0 takes it back when it runs again.",
      "spaces/p1.json, spaces/p2.json, spaces/p3.json and 1 more are version 2, which Filament 1.1.0 does not read (it reads version 1): it sets each aside whole under its version's name (spaces/p1.json.v2.<when>), saves nothing over it, and starts with an empty Space. A build that reads version 2 takes each back when it runs again.",
    ]);
    assert.ok(lines.length > 3, "then the restart's own line");
    assert.equal(state().ran, "1.1.0", "and restarted on it");
    assert.deepEqual(treeAt(data), tree, "nothing in the data folder is touched: the build that starts sets its files aside itself");
  });

  // (fails before: yes — the same: nothing was said, and a build from before the rule saved over teams.json at its next save)
  test("--back to a version from before the stores' rule: it would start empty over a newer file and save over it, so a copy of the file is kept beside it first, which the build that saved it takes back", async () => {
    installed(["1.1.0", "1.2.0"], "1.2.0");
    const newer = JSON.stringify({ version: 3, teams: { mine: { name: "A newer build's" } } });
    writeFileSync(join(data, "teams.json"), newer);
    writeFileSync(join(data, "agents.json"), JSON.stringify({ version: 1, agents: {} }));
    mkdirSync(join(data, "spaces"));
    for (const p of ["p1", "p2"]) writeFileSync(join(data, "spaces", `${p}.json`), JSON.stringify({ version: 2 }));
    running();
    // As JSON: its lines are in what was said.
    const back = await run(["update", "--back", "--json"]);
    assert.equal(back.code, EXIT.ok, back.err);
    const said = JSON.parse(back.out).said;
    const copy = readdirSync(data).filter((f) => /^teams\.json\.v3\.\d{8}T\d{6}Z$/.test(f));
    assert.equal(copy.length, 1, String(readdirSync(data)));
    const spaces = readdirSync(join(data, "spaces")).filter((f) => /^p[12]\.json\.v2\.\d{8}T\d{6}Z$/.test(f));
    assert.equal(said[2], `spaces/p1.json and spaces/p2.json are version 2, which Filament 1.1.0 does not read (it reads version 1): for each, it moves the file to one .broken name, over a file moved there before, and starts an empty Space. A copy of each is kept beside it first (${spaces[0]} and ${spaces[1]}), which a build that reads version 2 takes back when it runs again.`);
    assert.equal(said[1], `teams.json is version 3, which Filament 1.1.0 does not read (it reads version 2): it starts with no saved teams, and its next save writes over the file. A copy of it is kept beside it first (${copy[0]}), which a build that reads version 3 takes back when it runs again.`);
    assert.deepEqual([readFileSync(join(data, copy[0]), "utf8"), readFileSync(join(data, "teams.json"), "utf8")], [newer, newer], "the copy whole, the file as it was");
    // 1.1.0 saves over the file; the build that reads version 3, started again, has its own back.
    writeFileSync(join(data, "teams.json"), JSON.stringify({ version: 2, teams: {} }));
    assert.deepEqual(readStoreFile(join(data, "teams.json"), { version: 3, starts: "no saved teams" }), JSON.parse(newer));
  });

  // (fails before: yes — the rule's other half for such a version: a build that carries the rule had set its file
  // aside, and it takes nothing back, so it started with none while its own file lay beside)
  test("--back to a version from before the stores' rule puts its own file, set aside by a build that carries the rule, back in place for it: over a newer one only once that has its copy, never over one it reads", async () => {
    installed(["1.1.0", "1.2.0"], "1.2.0");
    const theirs = JSON.stringify({ version: 2, teams: { theirs: { name: "Saved by 1.1.0" } } });
    const newer = JSON.stringify({ version: 3, teams: {} });
    const agents = JSON.stringify({ version: 1, agents: { careful: { name: "Careful One" } } });
    const usage = JSON.stringify({ version: 2, days: {} });
    writeFileSync(join(data, "teams.json.v2.20261101T000000Z"), theirs);
    writeFileSync(join(data, "teams.json"), newer);
    // Its agents set aside, and none in place; its usage file set aside, and one it reads in place.
    writeFileSync(join(data, "agents.json.v1.20261101T000000Z"), agents);
    writeFileSync(join(data, "daily-usage.json.v2.20261101T000000Z"), JSON.stringify({ version: 2, days: { "2026-10-31": {} } }));
    writeFileSync(join(data, "daily-usage.json"), usage);
    running();
    const back = await run(["update", "--back"]);
    assert.equal(back.code, EXIT.ok, back.err);
    const copy = readdirSync(data).filter((f) => /^teams\.json\.v3\.\d{8}T\d{6}Z$/.test(f));
    assert.equal(copy.length, 1, String(readdirSync(data)));
    assert.equal(back.out.split("\n")[2], "teams.json and agents.json are in place again as Filament 1.1.0 reads them (from teams.json.v2.20261101T000000Z and agents.json.v1.20261101T000000Z, which stay beside them): 1.1.0 is from before this rule, and takes nothing back by itself.");
    const textOf = (/** @type {string} */ f) => readFileSync(join(data, f), "utf8");
    assert.deepEqual([textOf("teams.json"), textOf("teams.json.v2.20261101T000000Z"), textOf(copy[0])], [theirs, theirs, newer], "its own in place, the one set aside still there, the newer one's copy whole");
    assert.deepEqual([textOf("agents.json"), textOf("agents.json.v1.20261101T000000Z")], [agents, agents]);
    assert.equal(textOf("daily-usage.json"), usage, "one it reads is left as it is");
  });

  test("--check: what is newer, nothing downloaded or changed; as JSON too", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    const tree = treeAt(base);
    const r = await run(["update", "--check"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.out, "Filament 1.1.0 is out (this one is 1.0.0): filament update installs it.");
    assert.ok(!hits.some((h) => h.endsWith(".tar.gz")), "nothing downloaded");
    const j = JSON.parse((await run(["update", "--check", "--json"])).out);
    assert.deepEqual(j, { result: "available", installed: "1.0.0", version: "1.1.0", file: "filament-server-1.1.0-linux-x64.tar.gz", size: statSync(join(rel, "v1.1.0", "filament-server-1.1.0-linux-x64.tar.gz")).size, page: `${url}/tag/v1.1.0` });
    assert.deepEqual(treeAt(base), tree);
  });

  test("the restart: refused while a turn runs — the update stays, and says how to start it; one started by hand is told to restart", async () => {
    await release("1.1.0");
    await release("1.2.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ busy: true });
    const busy = await run(["update"]);
    assert.equal(busy.code, EXIT.busy, `${busy.out}\n${busy.err}`);
    assert.equal(current(), "1.1.0", "installed: current points at it");
    assert.equal(busy.err, "filament update: Filament 1.1.0 is installed, and current points at it; the Filament that runs (1.0.0) goes on — not stopped: 1 turn running in “Fix the build” (HTTP 409). filament restart starts 1.1.0 once no turn runs (--force restarts it now, and cuts what runs).");
    assert.equal(state().mainPid, 4242, "not stopped");
    assert.deepEqual(calls(), [MAIN_PID], "asked to stop once idle, and refused: systemd is not told to start it");
    here.root = join(base, "1.1.0");
    latest = "1.2.0";
    set({ supervisor: null, busy: false });
    const hand = await run(["update"]);
    assert.equal(hand.code, EXIT.ok, hand.err);
    assert.match(hand.out, /Filament 1\.0\.0 runs at http:\/\/127\.0\.0\.1:\d+, started by hand: it runs 1\.2\.0 once it is started again — filament stop, then filament start\.$/);
    assert.deepEqual(calls(), []);
  });

  // (fails before: yes — s3d: an update another machine's desk asked for was refused while a turn ran there, and left
  // the new version for whoever restarted it next, with no way back watching it)
  test("--wait: the restart waits while a turn runs, asking again, said once — then runs the new one; with --force, refused", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ busy: true });
    here.idleMs = 20;
    const asked = () => came.filter((c) => c.path === "/api/shutdown").length;
    const going = run(["update", "--wait", "--json"]);
    await until(() => asked() >= 3, "asked three times to stop once idle");
    assert.equal(current(), "1.1.0", "installed: current points at it");
    assert.equal(state().ran, "1.0.0", "the turn goes on, on the one it ran on");
    set({ busy: false });
    const done = await going;
    assert.equal(done.code, EXIT.ok, `${done.out}\n${done.err}`);
    const j = JSON.parse(done.out);
    assert.deepEqual([j.result, j.version, j.restart, state().ran], ["updated", "1.1.0", "systemd", "1.1.0"]);
    assert.deepEqual(
      j.said.filter((/** @type {string} */ s) => /goes on while it works/.test(s)),
      ["Filament 1.1.0 is installed, and current points at it; the Filament that runs (1.0.0) goes on while it works — not stopped: 1 turn running in “Fix the build” (HTTP 409): it restarts on 1.1.0 once nothing runs."],
      "said once",
    );
    const both = await run(["update", "--wait", "--force"]);
    assert.deepEqual([both.code, both.err], [EXIT.usage, "filament update: --force restarts it now, --wait once nothing runs: one or the other"]);
  });

  test("--wait: one restarted meanwhile on the new one is done; one that no longer runs runs it at its next start", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ busy: true });
    here.idleMs = 20;
    const asked = () => came.filter((c) => c.path === "/api/shutdown").length;
    let going = run(["update", "--wait", "--json"]);
    await until(() => asked() >= 1, "asked to stop once idle");
    // Someone restarted it: systemd runs the version current points at.
    set({ busy: false, ran: "1.1.0", mainPid: 4343 });
    let done = await going;
    assert.equal(done.code, EXIT.ok, done.err);
    assert.deepEqual([JSON.parse(done.out).restart, asked()], ["systemd", 1], "nothing asked of it again");
    here.root = join(base, "1.1.0");
    await release("1.2.0");
    latest = "1.2.0";
    running({ busy: true });
    going = run(["update", "--wait", "--json"]);
    await until(() => asked() >= 2, "asked to stop once idle");
    set({ running: false, mainPid: 0 });
    done = await going;
    assert.equal(done.code, EXIT.ok, done.err);
    const j = JSON.parse(done.out);
    assert.equal(j.restart, "not-running");
    assert.equal(j.said.at(-1), "No Filament answers now: it runs 1.2.0 at its next start.");
  });

  // (fails before: yes — the review of s3d: a start of systemd's own while --wait waited, of a version that never came
  // up, was taken for none — exit 0 — or waited on for ever, and nothing went back)
  test("--wait: systemd's own start meanwhile that ends as it starts goes back to the version before; the one that ran, silent all the while, goes on, said", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ busy: true, dead: ["1.1.0"] });
    here.idleMs = 300;
    const up = tools.upMs;
    tools.upMs = 1500;
    try {
      const asked = () => came.filter((c) => c.path === "/api/shutdown").length;
      const going = run(["update", "--wait", "--json"]);
      await until(() => asked() >= 1, "asked to stop once idle");
      // It crashed: systemd starts current — 1.1.0 —, which ends as it starts, and starts it again and again.
      set({ running: false, mainPid: 0, active: "activating", ran: "1.1.0" });
      const done = await going;
      assert.equal(done.code, EXIT.failed, done.out);
      assert.equal(current(), "1.0.0", "current points back");
      assert.equal(state().ran, "1.0.0", "and systemd runs it");
      assert.match(done.err, /Filament 1\.1\.0 did not come up — systemd started Filament, and it ended as it started —, so current points at 1\.0\.0 again: Filament 1\.0\.0 runs again at http:\/\/127\.0\.0\.1:\d+, under systemd\. 1\.1\.0 is kept beside it/);
      // Again: the one that runs goes silent as it waits, and stays so — said, as one that does not answer is.
      running({ busy: true, dead: [] });
      const again = run(["update", "--wait", "--json"]);
      await until(() => asked() >= 2, "asked to stop once idle");
      set({ hung: true });
      const mute = await again;
      assert.equal(mute.code, EXIT.failed, mute.out);
      assert.equal(current(), "1.1.0", "installed: current points at it");
      assert.match(mute.err, /Filament 1\.1\.0 is installed, and current points at it; systemd runs a Filament \(process 4242\) that did not answer at http:\/\/127\.0\.0\.1:\d+ within 1\.5 seconds, so it goes on — systemctl --user restart filament starts 1\.1\.0 now, and cuts what runs\.$/);
    } finally {
      tools.upMs = up;
    }
  });

  // (fails before: yes — the review of s3d: a read of systemd's that failed while --wait watched was taken for a unit
  // that had stopped: the update said none ran, exit 0, while one ran on)
  test("--wait: where systemd cannot say its unit's state it is watched on — one that answers again is done —, and where nothing answers all the while, that is said, nothing gone back", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ busy: true });
    here.idleMs = 300;
    const up = tools.upMs;
    tools.upMs = 1500;
    const asked = () => came.filter((c) => c.path === "/api/shutdown").length;
    const shown = () => calls().filter((c) => c.join(" ") === "systemctl --user show filament -p MainPID -p ActiveState").length;
    try {
      const going = run(["update", "--wait", "--json"]);
      await until(() => asked() >= 1, "asked to stop once idle");
      set({ hung: true, unsaid: true });
      await until(() => shown() >= 1, "systemd asked, and could not say");
      // Restarted meanwhile on the new one, it answers again.
      set({ hung: false, busy: false, unsaid: false, ran: "1.1.0", mainPid: 4343 });
      const done = await going;
      assert.equal(done.code, EXIT.ok, `${done.out}\n${done.err}`);
      assert.equal(JSON.parse(done.out).restart, "systemd");
      // Again, and nothing answers nor does systemd say a thing the whole wait.
      here.root = join(base, "1.1.0");
      await release("1.2.0");
      latest = "1.2.0";
      running({ busy: true });
      const before = asked();
      const again = run(["update", "--wait", "--json"]);
      await until(() => asked() > before, "asked to stop once idle");
      set({ hung: true, unsaid: true });
      const mute = await again;
      assert.equal(mute.code, EXIT.failed, mute.out);
      assert.match(mute.err, /Filament 1\.2\.0 is installed, and current points at it; no Filament answered at http:\/\/127\.0\.0\.1:\d+ within 1\.5 seconds, and systemd could not say whether its unit runs — filament service status says where it stands, and systemctl --user restart filament starts 1\.2\.0\.$/);
      assert.equal(current(), "1.2.0", "nothing gone back: nothing said it failed");
    } finally {
      tools.upMs = up;
    }
  });

  // (fails before: yes — the review of s3d: asked again once a restart was refused, it said "nothing changed", and
  // systemd ran the version before on)
  test("the version current points at, asked again while systemd runs another: restarted on it; --check restarts nothing", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    running({ ran: "1.0.0" });
    const check = await run(["update", "--check", "--json"]);
    assert.equal(check.code, EXIT.ok, check.err);
    assert.equal(state().ran, "1.0.0", "a look restarts nothing");
    const named = await run(["update", "--version", "1.1.0", "--json"]);
    assert.equal(named.code, EXIT.ok, named.err);
    const j = JSON.parse(named.out);
    assert.deepEqual([j.result, j.from, j.version, j.restart, state().ran], ["restarted", "1.0.0", "1.1.0", "systemd", "1.1.0"]);
    assert.equal(j.said[0], "Filament 1.1.0 is installed, and current points at it; the Filament that runs is 1.0.0: it restarts on 1.1.0.");
    // The newest, none named: the same.
    running({ ran: "1.0.0" });
    const newest = await run(["update", "--json"]);
    assert.equal(newest.code, EXIT.ok, newest.err);
    assert.deepEqual([JSON.parse(newest.out).result, state().ran], ["restarted", "1.1.0"]);
    // Where it runs it: nothing.
    const same = await run(["update", "--version", "1.1.0", "--json"]);
    assert.deepEqual(JSON.parse(same.out), { result: "installed", installed: "1.1.0" });
  });

  // (fails before: yes — a Filament systemd runs that did not answer was taken for none: "No Filament answers now",
  // exit 0, and --force restarted nothing: it went on with the version before)
  test("one systemd runs that answers nothing: said, not taken for none, and it goes on; --force restarts the unit all the same, and it runs the new one", async () => {
    await release("1.1.0");
    await release("1.2.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ hung: true });
    const mute = await run(["update"]);
    assert.equal(mute.code, EXIT.failed, mute.out);
    assert.equal(current(), "1.1.0", "installed: current points at it");
    assert.match(
      mute.err,
      /^filament update: Filament 1\.1\.0 is installed, and current points at it; systemd runs a Filament \(process 4242\) that did not answer at http:\/\/127\.0\.0\.1:\d+ within 10 seconds, so it goes on — systemctl --user restart filament starts 1\.1\.0 now, and cuts what runs\.$/,
    );
    assert.deepEqual(calls(), [MAIN_PID], "systemd asked what it runs; nothing restarted");
    assert.equal(state().mainPid, 4242);
    here.root = join(base, "1.1.0");
    latest = "1.2.0";
    const forced = await run(["update", "--force", "--json"]);
    assert.equal(forced.code, EXIT.ok, forced.err);
    assert.deepEqual(calls(), [MAIN_PID, ["systemctl", "--user", "restart", "filament"]], "--force: systemctl restart at once");
    assert.equal(state().ran, "1.2.0", "systemd started the version current points at");
    const j = JSON.parse(forced.out);
    assert.equal(j.restart, "systemd");
    assert.match(j.said.at(-2), /^systemd runs a Filament \(process 4242\) that did not answer at http:\/\/127\.0\.0\.1:\d+ within 10 seconds: --force restarts it\.$/);
    assert.match(j.said.at(-1), /^Filament 1\.2\.0 runs again at http:\/\/127\.0\.0\.1:\d+, under systemd\.$/);
  });

  // (fails before: yes — Filament was given 1.5 s to answer: one busier than that was "not running", and not restarted)
  test("one that answers slowly is waited on, not taken for none: restarted under systemd once idle", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ slowMs: 2500 });
    const r = await run(["update", "--json"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.equal(JSON.parse(r.out).restart, "systemd");
    assert.deepEqual(calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"]]);
    assert.deepEqual(came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }]);
    assert.equal(state().ran, "1.1.0");
  });

  // (fails before: yes — the removal's error ended the update after current had moved: Filament was not restarted, and
  // the update said it failed)
  // (fails before, s3f3: yes — a version was removed where it stood, so one a running Filament held on Windows lost the
  // files nothing had open, and the rest stayed without its build-info.json, never removed after)
  test("a version in use is kept whole and said — renamed aside before it goes, which Windows refuses while a Filament runs from it —, and the restart still goes", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    running();
    const held = join(base, "1.0.0");
    const r = await withRenames((from) => (from === held ? "EBUSY" : null), ["update", "--json"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    const j = JSON.parse(r.out);
    assert.deepEqual([j.result, j.version, j.removed, j.restart], ["updated", "1.2.0", [], "systemd"]);
    assert.ok(j.said.includes("Filament 1.0.0 is kept, in use (EBUSY): a Filament still runs from it, or a program has a file in it open. An update to another version removes it."), j.said.join("\n"));
    assert.deepEqual(folders(), ["1.0.0", "1.1.0", "1.2.0", "current"]);
    assert.ok(existsSync(join(held, MARKER)) && existsSync(join(held, "bin", "filament")), "whole");
    assert.equal(current(), "1.2.0");
    assert.deepEqual(calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"]]);
    assert.equal(state().ran, "1.2.0");
  });

  test("a version set aside that cannot be removed: said with where it is, the restart still goes, and the next update takes it away", async () => {
    await release("1.2.0");
    await release("1.3.0");
    latest = "1.2.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    running();
    const fs = createRequire(import.meta.url)("node:fs");
    const real = fs.rmSync;
    fs.rmSync = (/** @type {string} */ p, /** @type {any} */ o) => {
      if (/[\\/]\.prune-[0-9a-f]{8}$/.test(String(p))) throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${p}'`), { code: "EBUSY" });
      return real(p, o);
    };
    syncBuiltinESMExports();
    let r;
    try {
      r = await run(["update", "--json"]);
    } finally {
      fs.rmSync = real;
      syncBuiltinESMExports();
    }
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    const j = JSON.parse(r.out);
    assert.deepEqual([j.result, j.version, j.removed, j.restart], ["updated", "1.2.0", [], "systemd"]);
    const aside = folders().find((n) => /^\.prune-[0-9a-f]{8}$/.test(n));
    assert.ok(aside, folders().join(", "));
    assert.ok(j.said.includes(`Filament 1.0.0 could not be all removed (EBUSY): remove ${join(base, aside)} by hand.`), j.said.join("\n"));
    assert.deepEqual(folders(), [aside, "1.1.0", "1.2.0", "current"]);
    assert.equal(state().ran, "1.2.0");
    calls();
    latest = "1.3.0";
    here.root = join(base, "1.2.0");
    const again = await run(["update"]);
    assert.equal(again.code, EXIT.ok, again.err);
    assert.deepEqual(folders(), ["1.2.0", "1.3.0", "current"], "the one set aside gone with the next");
  });

  // A junction in a version's folder (one a person made) goes with it, never what it points at.
  test("a version removed takes a junction in it away, never what it points at", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    const outside = mkdtempSync(join(tmpdir(), "filament-update-outside-"));
    try {
      writeFileSync(join(outside, "keep.txt"), "the person's own");
      symlinkSync(outside, join(base, "1.0.0", "linked"), "junction");
      const r = await run(["update"]);
      assert.equal(r.code, EXIT.ok, r.err);
      assert.match(r.out, /^Removed Filament 1\.0\.0, not one of the two kept \(\S+\)\.$/m);
      assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "the person's own");
    } finally {
      await removeDirs(outside);
    }
  });

  // (fails before: yes — the swarm's review of 11-10: systemd was asked to start a unit whose process still ran, which it
  // took as done, and the version before went on serving)
  test("one whose stop hangs past the wait is restarted by systemd, not left running the version before", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running({ lingers: true });
    const wait = tools.stopMs;
    tools.stopMs = 1500;
    let r;
    try {
      r = await run(["update", "--json"]);
    } finally {
      tools.stopMs = wait;
    }
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    const j = JSON.parse(r.out);
    assert.equal(j.restart, "systemd");
    assert.match(j.said.at(-1), /^Filament 1\.2\.0 runs again at http:\/\/127\.0\.0\.1:\d+, under systemd\.$/);
    assert.deepEqual(calls().filter((c) => c[2] !== "show"), [["systemctl", "--user", "restart", "filament"]]);
    assert.equal(state().ran, "1.2.0");
  });

  // (fails before: yes, on Windows — the swarm's review of 11-10: the old junction went first, and where the new one could
  // not be renamed into its place, current was gone while the words said nothing changed)
  test("current that cannot be pointed at the new version still points at the one before, as the words say", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running();
    const link = join(base, "current");
    const fs = createRequire(import.meta.url)("node:fs");
    const real = fs.renameSync;
    fs.renameSync = (/** @type {string} */ from, /** @type {string} */ to) => {
      if (String(to) === link && basename(String(from)).startsWith("current.new-")) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: "EPERM" });
      return real(from, to);
    };
    syncBuiltinESMExports();
    let r;
    try {
      r = await run(["update"]);
    } finally {
      fs.renameSync = real;
      syncBuiltinESMExports();
    }
    assert.equal(r.code, EXIT.failed, r.out);
    assert.equal(r.err, "filament update: Filament 1.2.0 was not installed: current could not be pointed at it (EPERM). Nothing changed — current still points at 1.1.0.");
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.1.0", "current"]);
    assert.deepEqual(calls(), [], "nothing restarted");
  });

  /**
   * `filament update` run while a rename fails as `fails` says: its error's code for a rename from `from` to `to`, or
   * none.
   * @param {(from: string, to: string) => string | null} fails
   */
  const withRenames = async (fails, argv = ["update"]) => {
    const fs = createRequire(import.meta.url)("node:fs");
    const real = fs.renameSync;
    fs.renameSync = (/** @type {string} */ from, /** @type {string} */ to) => {
      const code = fails(String(from), String(to));
      if (code) throw Object.assign(new Error(`${code}: the rename failed, rename '${from}' -> '${to}'`), { code });
      return real(from, to);
    };
    syncBuiltinESMExports();
    try {
      return await run(argv);
    } finally {
      fs.renameSync = real;
      syncBuiltinESMExports();
    }
  };

  // (fails before: yes — the way back's own failure was the one said, raw: "filament update: EBUSY: the rename failed,
  // rename …", with nothing of why current had not moved, nor of what stands)
  test("current that cannot be pointed at the new version, whose folder then cannot be taken away again: the first failure is the one said, the way back's beside it, and what stands", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running();
    const link = join(base, "current");
    const put = join(base, "1.2.0");
    const r = await withRenames((from, to) => (to === link && basename(from).startsWith("current.new-") ? "EPERM" : from === put ? "EBUSY" : null));
    assert.equal(r.code, EXIT.failed, r.out);
    assert.equal(r.err, `filament update: Filament 1.2.0 was not installed: current could not be pointed at it (EPERM), and its folder could not be taken away again (EBUSY): it stays in ${put}. current still points at 1.1.0.`);
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"], "the new version's folder stays, as said; the folder the update worked in is gone");
    assert.deepEqual(calls(), [], "nothing restarted");
  });

  // (fails before: yes — the same: "filament update: EBUSY: the rename failed, rename …" alone, the put-back's)
  test("a new version's folder that cannot be put in place, where the one set aside for it cannot be put back: the first failure is the one said, the put-back's beside it", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running();
    // The version's other build is at its path: set aside for the one that comes.
    const put = join(base, "1.2.0");
    mkdirSync(join(put, "bin"), { recursive: true });
    writeFileSync(join(put, MARKER), `${JSON.stringify(markerOf("1.2.0", false, "2.35"), null, 2)}\n`);
    writeFileSync(join(put, "bin", "filament"), LAUNCHER);
    const r = await withRenames((from, to) => (to !== put ? null : basename(from) === "old" ? "EBUSY" : "EPERM"));
    assert.equal(r.code, EXIT.failed, r.out);
    assert.equal(r.err, `filament update: Filament 1.2.0 was not installed: ${put} could not be put in place (EPERM), and what was there before could not be put back (EBUSY) and is gone. current still points at 1.1.0.`);
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.1.0", "current"]);
    assert.deepEqual(calls(), [], "nothing restarted");
  });

  // (fails before: yes — a link a crashed update left stayed beside current for good: an update took away the one of
  // its own process alone)
  test("a link an update that crashed left beside current goes with the next update; one whose process runs — another update at work — stays, and a look takes none away", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running();
    // A process that ran and ended, and one that runs: the one this test runs under.
    const ended = spawnSync(process.execPath, ["-e", ""], { windowsHide: true }).pid;
    const left = `current.new-${ended}`;
    const theirs = `current.new-${process.ppid}`;
    for (const n of [left, theirs]) symlinkSync(WIN ? join(base, "1.1.0") : "1.1.0", join(base, n), "junction");
    // A folder by such a name is no link of an update's: it stays.
    mkdirSync(join(base, "current.new-1"));
    const tree = treeAt(base);
    const look = await run(["update", "--check"]);
    assert.equal(look.code, EXIT.ok, `${look.out}\n${look.err}`);
    assert.deepEqual(treeAt(base), tree, "a look changes nothing");
    const r = await run(["update", "--json"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.equal(current(), "1.2.0");
    assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current", "current.new-1", theirs].sort());
  });

  // (fails before: yes — the re-read of 11-11, its finding 8: the new version that did not come up was left as the one
  // current points at, systemd starting it again every 3 s, in words that named neither current nor the way back; and
  // with --json the lines said before it were lost)
  test("a new version that does not come up — it ends as it starts, or answers nothing within the wait — is left for the one before: current pointed back, that one started again, said in one line; --json's lines said before it come ahead of it", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running();
    set({ dead: ["1.1.0"] });
    const r = await run(["update", "--json"]);
    assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
    assert.equal(current(), "1.0.0", "current points at the one before again");
    assert.deepEqual([state().running, state().ran], [true, "1.0.0"], "which runs again");
    assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"], "the new one kept beside it, no link left");
    assert.deepEqual(calls().filter((c) => c[2] !== "show"), [["systemctl", "--user", "start", "filament"], ["systemctl", "--user", "restart", "filament"]]);
    assert.equal(r.out, "", "no answer as JSON: it failed");
    const lines = r.err.split("\n");
    assert.equal(lines.length, 3, r.err);
    assert.match(lines[0], /^Downloading Filament 1\.1\.0 /);
    assert.equal(lines[1], `Filament 1.1.0 is installed in ${join(base, "1.1.0")}, and current points at it; 1.0.0 is kept beside it — filament update --back goes back to it.`);
    const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (filament.address()).port}`;
    assert.equal(lines[2], `filament update: Filament 1.1.0 did not come up — systemd started Filament, and it ended as it started —, so current points at 1.0.0 again: Filament 1.0.0 runs again at ${url}, under systemd. 1.1.0 is kept beside it (${join(base, "1.1.0")}) — filament service status shows its log.`);

    // One that runs and answers nothing within the wait: the same, in its own words.
    set({ dead: [], mute: ["1.1.0"] });
    const wait = tools.upMs;
    tools.upMs = 4000;
    let mute;
    try {
      mute = await run(["update"]);
    } finally {
      tools.upMs = wait;
    }
    assert.equal(mute.code, EXIT.failed, `${mute.out}\n${mute.err}`);
    assert.equal(mute.err, `filament update: Filament 1.1.0 did not come up — systemd started Filament, and it did not answer within a minute —, so current points at 1.0.0 again: Filament 1.0.0 runs again at ${url}, under systemd. 1.1.0 is kept beside it (${join(base, "1.1.0")}) — filament service status shows its log.`);
    assert.equal(current(), "1.0.0");
    assert.deepEqual([state().running, state().ran, state().hung], [true, "1.0.0", false]);
  });

  // (fails before: yes — the same finding: nothing went back, so nothing said where a way back failed)
  test("a way back that fails says what it left: the one before that does not start either, current on it; current that cannot be pointed back, still on the new one", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running();
    set({ dead: ["1.1.0", "1.0.0"] });
    const both = await run(["update"]);
    assert.equal(both.code, EXIT.failed, `${both.out}\n${both.err}`);
    assert.equal(both.err, "filament update: Filament 1.1.0 did not come up — systemd started Filament, and it ended as it started —, so current points at 1.0.0 again, and 1.0.0 did not start in its place either — systemd started Filament, and it ended as it started: filament service status shows its log.");
    assert.equal(current(), "1.0.0");
    assert.equal(state().running, false);

    // From 1.0.0 again, running: the link moves once, to the new version, and not back.
    set({ running: true, mainPid: 4242, ran: "1.0.0", dead: ["1.1.0"] });
    const link = join(base, "current");
    const fs = createRequire(import.meta.url)("node:fs");
    const real = fs.renameSync;
    // The link made for the way back alone: the one that leads to 1.0.0.
    const backTo = (/** @type {string} */ p) => basename(String(p)).startsWith("current.new-") && basename(readlinkSync(p).replace(/[\\/]+$/, "")) === "1.0.0";
    fs.renameSync = (/** @type {string} */ from, /** @type {string} */ to) => {
      if (String(to) === link && backTo(from)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: "EPERM" });
      return real(from, to);
    };
    syncBuiltinESMExports();
    let held;
    try {
      held = await run(["update"]);
    } finally {
      fs.renameSync = real;
      syncBuiltinESMExports();
    }
    assert.equal(held.code, EXIT.failed, `${held.out}\n${held.err}`);
    assert.equal(held.err, "filament update: Filament 1.1.0 did not come up — systemd started Filament, and it ended as it started —, and current could not be pointed back at 1.0.0 (EPERM): it still points at 1.1.0 — filament update --back goes back to 1.0.0, filament service status shows its log.");
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"], "no link left beside it");
  });

  // (fails before: yes — the same finding: whatever version answered after the restart was said to run again, exit 0: a
  // unit that starts a version's own folder, not current, went on with the one before, the update said done)
  test("another version than the one installed answers after the restart: refused in words that say which and why, current left on the new one", async () => {
    await release("1.1.0");
    latest = "1.1.0";
    installed(["1.0.0"], "1.0.0");
    running({ pinned: "1.0.0" });
    const r = await run(["update"]);
    assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
    const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (filament.address()).port}`;
    assert.equal(r.err, `filament update: Filament 1.1.0 is installed, and current points at it; systemd started Filament again, and Filament 1.0.0 answers at ${url}, not 1.1.0: its unit starts another than current leads to — filament service install writes it again, and starts 1.1.0.`);
    assert.equal(current(), "1.1.0", "not gone back from: the one before runs, and nothing failed to start");
    assert.doesNotMatch(r.out, /runs again/);
    assert.deepEqual(calls().filter((c) => c[2] !== "show"), [["systemctl", "--user", "start", "filament"]]);
  });

  // (fails before: yes — the same finding: a main process systemd could not say counted as one that had ended, so a
  // start went to a unit whose stop hung, which systemd took as done: the version before went on)
  test("one whose main process systemd cannot say is restarted, not started: its stop that hangs does not leave the version before running", async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.1.0"], "1.1.0");
    running({ lingers: true, unsaid: true });
    const r = await run(["update", "--json"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(calls().filter((c) => c[2] !== "show"), [["systemctl", "--user", "restart", "filament"]]);
    assert.equal(state().ran, "1.2.0");
    assert.match(JSON.parse(r.out).said.at(-1), /^Filament 1\.2\.0 runs again at http:\/\/127\.0\.0\.1:\d+, under systemd\.$/);
  });

  // (fails before: yes, on Windows — the same finding: where the old junction could not be made again, current was gone
  // while the words said it still pointed at the version before, the error said was the put-back's, not the one that
  // kept the new link out, and current.new-<pid> stayed beside it; where the old one could not be taken away, the
  // same link stayed)
  test("on Windows, current that cannot be pointed and whose old link cannot be made again: said gone, with how to make it, the first error kept, no link left beside it", { skip: !WIN && "Windows renames no link over another: the old one goes first there alone" }, async () => {
    await release("1.2.0");
    latest = "1.2.0";
    installed(["1.0.0", "1.1.0"], "1.1.0");
    const link = join(base, "current");
    const fs = createRequire(import.meta.url)("node:fs");
    const real = { renameSync: fs.renameSync, symlinkSync: fs.symlinkSync, unlinkSync: fs.unlinkSync };
    /** @param {{ back?: boolean, away?: boolean }} o  what fails beside the rename: the old link made again, or taken away */
    const failing = async ({ back = false, away = false }, /** @type {string[]} */ argv) => {
      fs.renameSync = (/** @type {string} */ from, /** @type {string} */ to) => {
        if (String(to) === link && basename(String(from)).startsWith("current.new-")) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: "EPERM" });
        return real.renameSync(from, to);
      };
      if (back)
        fs.symlinkSync = (/** @type {string} */ target, /** @type {string} */ path, /** @type {any} */ type) => {
          if (String(path) === link) throw Object.assign(new Error(`EACCES: permission denied, symlink '${target}' -> '${path}'`), { code: "EACCES" });
          return real.symlinkSync(target, path, type);
        };
      if (away)
        fs.unlinkSync = (/** @type {string} */ path) => {
          if (String(path) === link) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${path}'`), { code: "EBUSY" });
          return real.unlinkSync(path);
        };
      syncBuiltinESMExports();
      try {
        return await run(argv);
      } finally {
        Object.assign(fs, real);
        syncBuiltinESMExports();
      }
    };
    // The old link cannot be taken away: it stays, the rename's error said, nothing left beside it.
    const stays = await failing({ away: true }, ["update", "--back"]);
    assert.equal(stays.code, EXIT.failed, stays.out);
    assert.equal(stays.err, "filament update: current could not be pointed at 1.0.0 (EPERM): it still points at 1.1.0.");
    assert.equal(current(), "1.1.0");
    assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"]);
    // The old link cannot be made again: current is gone, and that is what is said.
    const made = `make it with mklink /J "${link}" "${join(base, "1.1.0")}"`;
    const gone = await failing({ back: true }, ["update", "--back"]);
    assert.equal(gone.code, EXIT.failed, gone.out);
    assert.equal(gone.err, `filament update: current could not be pointed at 1.0.0 (EPERM): current is gone — the link it was could not be made again (EACCES): ${made}.`);
    assert.deepEqual(folders(), ["1.0.0", "1.1.0"], "current is gone, and no link is left beside where it was");
    real.symlinkSync(join(base, "1.1.0"), link, "junction");
    // The same for a release put in place: not installed, and current gone, not "nothing changed".
    const put = await failing({ back: true }, ["update"]);
    assert.equal(put.code, EXIT.failed, put.out);
    assert.equal(put.err, `filament update: Filament 1.2.0 was not installed: current could not be pointed at it (EPERM), and current is gone — the link it was could not be made again (EACCES): ${made}.`);
    assert.deepEqual(folders(), ["1.0.0", "1.1.0"]);
  });

  test("refused in words: a checkout (git pull), the Filament app (it updates itself), a server build install.sh did not install, another machine", async () => {
    const checkout = join(dir, "checkout");
    mkdirSync(join(checkout, ".git"), { recursive: true });
    here.root = checkout;
    let r = await run(["update"]);
    assert.equal(r.code, EXIT.failed);
    assert.equal(r.err, `filament update: This Filament runs from a checkout (${checkout}): git pull updates it, then filament restart.`);
    const app = join(dir, "app");
    mkdirSync(join(app, "desktop"), { recursive: true });
    writeFileSync(join(app, "desktop", "main.js"), "");
    here.root = app;
    r = await run(["update"]);
    assert.equal(r.code, EXIT.failed);
    assert.equal(r.err, "filament update: The Filament app updates itself: Settings › About's Check now, or its tray's Check for updates.");
    const loose = join(dir, "opt", "filament");
    mkdirSync(join(loose, "bin"), { recursive: true });
    writeFileSync(join(loose, MARKER), JSON.stringify(markerOf("1.0.0", true, "2.35")));
    writeFileSync(join(loose, "bin", "filament"), LAUNCHER);
    here.root = loose;
    r = await run(["update"]);
    assert.equal(r.code, EXIT.failed);
    assert.match(r.err, /^filament update: This Filament for servers \(\S+\) is not where install\.sh installs it — a version's folder, with current beside it pointing at it: install\.sh installs one \(curl -fsSL https:\/\/github\.com\/o\/r\/releases\/latest\/download\/install\.sh \| sh\), which filament update then updates\.$/);
    assert.equal((await run(["update", "--machine", "srv"])).code, EXIT.usage);
    assert.deepEqual(hits, [], "the releases are not asked");
  });
});

test("a server's release, as scripts/dist-server.mjs makes it: its tarballs and update file named alike; the shared parts read it", () => {
  for (const engine of [true, false]) {
    assert.equal(serverTarball("1.2.3", engine), tarballName("1.2.3", engine));
    assert.equal(serverAsset(engine).file("1.2.3"), tarballName("1.2.3", engine));
    assert.equal(serverAsset(engine).feed, FEED);
  }
  assert.equal(SERVER_FEED, FEED);
  const yml = feedOf({ version: "1.2.3", files: [{ name: tarballName("1.2.3"), sha512: "AA==", size: 1 }, { name: tarballName("1.2.3", false), sha512: "BB==", size: 1 }], at: "2026-11-08T00:00:00.000Z" });
  assert.deepEqual([shaIn(yml, tarballName("1.2.3")), shaIn(yml, tarballName("1.2.3", false))], ["AA==", "BB=="]);
  assert.equal(isNewer("1.2.4", "1.2.3"), true);
});
