// @ts-check
// filament service (the remote plan's sv-service): Filament for servers run by systemd's user manager — its unit, the
// calls that install, start, stop and remove it, its status and log, and `filament stop` / `filament restart` under
// it. systemd is played by stand-ins on the PATH — systemctl, loginctl and journalctl: one Node script that notes each
// call and answers as systemd would, its state in a file — and Filament by a server of the test's own, its
// listening.json in a data folder of its own; HOME is a throwaway folder and the platform Linux. On Windows, where no
// script runs by its name, the stand-ins run through Node (service.js `tools`); on Linux they run as systemd's would.
// (fails before: yes — there was no `filament service`: `filament service install` was no command, exit 2; `filament
// stop` under systemd posted /shutdown and systemd started Filament again 3 s on; About said nothing restarts it)
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { writeListening } from "../src/cli/listening.js";
import { EXIT } from "../src/cli/client.js";
import { runCli } from "../src/cli/main.js";
import { launcherOf, runService, startUnit, tools, unitText, unitWords } from "../src/cli/service.js";
import { TASK, argWord, readTaskXml, runnerOf, serviceFiles, taskOf, taskXml } from "../src/cli/service-task.js";
import { restartWords } from "../src/ui/harness/settings/about.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * systemd, as its tools answer: systemctl --user, loginctl and journalctl, run with the tool's name and its words. Each
 * call is noted in the file FAKE_SYSTEMD_CALLS names, one line each; the state — the manager, the unit as the last
 * daemon-reload read it, whether it runs and its pid, lingering, the journal — is in FAKE_SYSTEMD's, written back only
 * where a call changes it (status's calls run at once). Written to a file as it is here, run by Node.
 * @param {any} require
 */
function fakeSystemd(require) {
  const fs = require("fs");
  const [tool, ...args] = process.argv.slice(2);
  const file = String(process.env.FAKE_SYSTEMD);
  fs.appendFileSync(String(process.env.FAKE_SYSTEMD_CALLS), `${JSON.stringify([tool, ...args])}\n`);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  /** @param {string} [out] @param {number} [code] @param {string} [err] */
  const end = (out = "", code = 0, err = "") => {
    if (changed) fs.writeFileSync(file, JSON.stringify(s));
    if (out) process.stdout.write(`${out}\n`);
    if (err) process.stderr.write(`${err}\n`);
    process.exitCode = code;
  };
  const start = () => {
    changed = true;
    if (s.active === "active") return;
    // One that cannot start (crashes) ends as it starts: no main process, and systemd waits 3 s to start it again.
    if (s.crashes) return void Object.assign(s, { active: "activating", mainPid: 0, ranUnit: s.loaded });
    Object.assign(s, { active: "active", mainPid: ++s.pids, running: "systemd", ranUnit: s.loaded });
  };
  const stop = () => {
    changed = true;
    // systemd stops what it runs: one started by hand goes on.
    Object.assign(s, { active: "inactive", mainPid: 0, running: s.running === "systemd" ? null : s.running });
  };
  if (tool === "loginctl") {
    if (args.join(" ") !== `show-user ${s.user} -p Linger`) return end("", 1, `Unknown command ${args.join(" ")}.`);
    return s.linger === null ? end("", 1, `Failed to get user: User ${s.user} is not logged in or lingering.`) : end(`Linger=${s.linger ? "yes" : "no"}`);
  }
  if (tool === "journalctl") return end(s.journal.join("\n"));
  if (args[0] !== "--user") return end("", 1, "Failed to connect to bus: the system's, not the user's");
  if (s.manager !== true) return end("", 1, s.manager);
  const [verb, ...rest] = args.slice(1);
  if (verb === "show-environment")
    return end([`HOME=${s.home}`, `USER=${s.user}`, ...(s.path ? [`PATH=${s.path}`] : []), ...(s.xdgConfig ? [`XDG_CONFIG_HOME=${s.xdgConfig}`] : []), "LANG=C.UTF-8"].join("\n"));
  if (verb === "daemon-reload") {
    changed = true;
    s.loaded = fs.existsSync(s.unitFile) ? fs.readFileSync(s.unitFile, "utf8") : null;
    return end();
  }
  const unit = rest.find((w) => !w.startsWith("-"));
  if (unit !== "filament") return end("", 1, `Unit ${unit}.service not found.`);
  if (verb === "is-active") return end(s.active, s.active === "active" ? 0 : 3);
  if (verb === "is-enabled") return end(s.loaded ? s.enabled : "not-found", s.loaded && s.enabled === "enabled" ? 0 : 1);
  if (verb === "show" && rest.join(" ") === "filament -p MainPID --value") return end(String(s.mainPid));
  if (!s.loaded) return end("", 1, `Failed to ${verb} unit: Unit file filament.service does not exist.`);
  if (verb === "enable") {
    changed = true;
    s.enabled = "enabled";
    if (rest.includes("--now")) start();
    return end("", 0, `Created symlink ${s.home}/.config/systemd/user/default.target.wants/filament.service → ${s.unitFile}.`);
  }
  if (verb === "disable") {
    changed = true;
    s.enabled = "disabled";
    if (rest.includes("--now")) stop();
    return end("", 0, `Removed "${s.home}/.config/systemd/user/default.target.wants/filament.service".`);
  }
  if (verb === "start") return start(), end();
  if (verb === "stop") return stop(), end();
  if (verb === "restart") return stop(), start(), end();
  return end("", 1, `Unknown command verb '${verb}'.`);
}

/** The systemd folders a user's service gets on its PATH, as service.js adds them. */
const SYSTEM_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

/** A word as systemd reads it back: in quotes where it holds a space, a quote or a backslash. @param {string} w */
const q = (w) => (/[\s"'\\;]/.test(w) ? `"${w.replace(/[\\"]/g, "\\$&")}"` : w);

/**
 * A Linux server's machine, of the test's own: a HOME, a data folder, the stand-ins on a PATH of their own, systemd's
 * state, and a Filament that answers while the state says one runs — by hand, under the app, or under systemd —, at the
 * address its listening.json says. Its /api/shutdown ends it (busy: refused, as a turn running refuses it); under
 * systemd its unit then waits to start it again, which the stand-ins leave to the calls that follow.
 */
const serverMachine = async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-service-"));
  const home = join(dir, "home");
  const data = join(dir, "data");
  const bin = join(dir, "bin");
  for (const d of [home, data, bin]) mkdirSync(d, { recursive: true });
  const fake = join(dir, "fake-systemd.cjs");
  writeFileSync(fake, `(${fakeSystemd})(require);\n`);
  for (const tool of ["systemctl", "loginctl", "journalctl"]) {
    const file = join(bin, tool);
    writeFileSync(file, WIN ? "" : `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${tool} "$@"\n`);
    if (!WIN) chmodSync(file, 0o755);
  }
  const stateFile = join(dir, "systemd.json");
  const callsFile = join(dir, "calls.jsonl");
  writeFileSync(callsFile, "");
  const unitFile = join(home, ".config", "systemd", "user", "filament.service");
  /** @type {Record<string, any>} */
  const initial = { manager: true, home, xdgConfig: null, path: null, user: "ada", unitFile, loaded: null, ranUnit: null, active: "inactive", enabled: "not-found", mainPid: 0, pids: 4241, running: null, busy: false, crashes: false, linger: false, journal: ["Nov 08 09:00:01 srv filament[4242]: Filament 9.9.9 listening on http://localhost:20300", "Nov 08 09:00:01 srv filament[4242]:   harness     : http://localhost:20300/ui/harness.html"] };
  writeFileSync(stateFile, JSON.stringify(initial));
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  /** @param {Record<string, any>} change */
  const set = (change) => writeFileSync(stateFile, JSON.stringify({ ...read(), ...change }));
  /** @type {{ method: string, path: string, body: any }[]} */
  const came = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const s = read();
      const path = String(req.url || "");
      const body = raw ? JSON.parse(raw) : null;
      came.push({ method: String(req.method), path, body });
      if (!s.running) {
        res.statusCode = 503;
        return void res.end(JSON.stringify({ error: "not running" }));
      }
      if (path === "/api/state") return void res.end(JSON.stringify({ version: "9.9.9", dataDir: data, uptimeMs: 1000, supervisor: s.running === "hand" ? null : s.running }));
      if (req.method === "POST" && path === "/api/shutdown") {
        if (body?.ifIdle === true && s.busy) {
          res.statusCode = 409;
          return void res.end(JSON.stringify({ ok: false, turns: 1, note: "not stopped: 1 turn running in “Fix the build”" }));
        }
        set({ running: null, mainPid: 0, active: s.running === "systemd" ? "activating" : s.active });
        return void res.end(JSON.stringify({ ok: true, inflight: 0, note: "stopping now" }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `no ${req.method} ${path}` }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  writeListening(data, { host: "127.0.0.1", port, pid: process.pid, version: "9.9.9", startedAt: 1 });
  return {
    dir,
    home,
    data,
    bin,
    fake,
    unitFile,
    came,
    url: `http://127.0.0.1:${port}`,
    read,
    set,
    /** The calls the stand-ins took, in order; each noted from here on. */
    calls: () => {
      const all = readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      writeFileSync(callsFile, "");
      return /** @type {string[][]} */ (all);
    },
    /** @param {string[]} argv */
    async run(argv) {
      /** @type {{ out: string[], err: string[], wrote: string }} */
      const said = { out: [], err: [], wrote: "" };
      const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
      const code = await runCli(argv, { dataDir: data, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.wrote += s) });
      return { code, out: said.out.join("\n"), err: said.err.join("\n"), wrote: said.wrote };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
      await removeDirs(dir);
    },
  };
};

/** The calls a first install makes, nothing running before it. */
const INSTALL_CALLS = [
  ["systemctl", "--user", "show-environment"],
  ["systemctl", "--user", "is-active", "filament"],
  ["systemctl", "--user", "daemon-reload"],
  ["systemctl", "--user", "enable", "--now", "filament"],
  ["loginctl", "show-user", "ada", "-p", "Linger"],
];
const MAIN_PID = ["systemctl", "--user", "show", "filament", "-p", "MainPID", "--value"];

describe("filament service, on a Linux server with systemd's user manager", () => {
  /** @type {PropertyDescriptor | undefined} */
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const NAMES = ["PATH", "HOME", "USER", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "FAKE_SYSTEMD", "FAKE_SYSTEMD_CALLS", "FILAMENT_MACHINE"];
  /** @type {Record<string, string | undefined>} */
  const was = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  const ownSpawn = tools.spawn;
  const ownSystem = tools.system;
  /** @type {Awaited<ReturnType<typeof serverMachine>>} */
  let m;

  before(() => {
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    // Windows runs no script by its name: each stand-in through Node, by the name it was found by.
    if (WIN) tools.spawn = /** @type {any} */ ((/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ o) => spawn(process.execPath, [m.fake, basename(file), ...args], o));
  });
  after(() => {
    if (platform) Object.defineProperty(process, "platform", platform);
    tools.spawn = ownSpawn;
    tools.system = ownSystem;
    for (const n of NAMES) {
      if (was[n] === undefined) delete process.env[n];
      else process.env[n] = was[n];
    }
  });
  beforeEach(async () => {
    m = await serverMachine();
    // The system's own folders hold no systemd here: the stand-ins on the PATH alone (a Linux machine's would answer).
    tools.system = [];
    for (const n of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "FILAMENT_MACHINE"]) delete process.env[n];
    Object.assign(process.env, { PATH: m.bin, HOME: m.home, USER: "ada", FAKE_SYSTEMD: join(m.dir, "systemd.json"), FAKE_SYSTEMD_CALLS: join(m.dir, "calls.jsonl") });
  });
  afterEach(async () => {
    await m.close();
  });

  test("install: the unit written — this checkout's Node and bin/filament.js on its data folder, systemd's restart and stop lines — then daemon-reload and enable --now; Filament answers under systemd, and lingering off is said with the line that turns it on", async () => {
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), INSTALL_CALLS);
    const unit = readFileSync(m.unitFile, "utf8");
    assert.equal(m.read().ranUnit, unit, "systemd started the unit as written: daemon-reload came after it was");
    const lines = unit.split("\n");
    const exec = lines.find((l) => l.startsWith("ExecStart="))?.slice("ExecStart=".length) || "";
    assert.deepEqual(unitWords(exec), [process.execPath, join(ROOT, "bin", "filament.js"), "start", "--data-dir", m.data]);
    if (!WIN) assert.equal(exec, `${process.execPath} ${join(ROOT, "bin", "filament.js")} start --data-dir ${m.data}`);
    const path = [join(m.home, ".local", "bin"), dirname(process.execPath), m.bin, ...SYSTEM_PATH].join(":");
    assert.ok(lines.includes(`Environment=${q(`PATH=${path}`)}`), unit);
    for (const l of ["[Unit]", "Description=Filament", "[Service]", "Environment=FILAMENT_SUPERVISOR=systemd", "Restart=always", "RestartSec=3", "KillMode=mixed", "KillSignal=SIGTERM", "TimeoutStopSec=60", "[Install]", "WantedBy=default.target"])
      assert.ok(lines.includes(l), `${l}\n${unit}`);
    assert.ok(lines.indexOf("[Unit]") < lines.indexOf("[Service]") && lines.indexOf("[Service]") < lines.indexOf("[Install]"), unit);
    assert.match(r.out, /It runs this checkout, with this Node/);
    assert.match(r.out, new RegExp(`Filament 9\\.9\\.9 runs at ${m.url.replace(/\./g, "\\.")} under systemd: started as ada logs in, and again 3 s after it ends by itself\\.`), "lingering off: never said as started at boot");
    assert.match(r.out, /Lingering is off for ada: Filament starts as ada logs in, and stops as their last session ends \(the last SSH session, or WSL's last window, closed\), a turn that runs then with it\. To start it at boot with no one logged in, run: loginctl enable-linger ada \(some systems ask for sudo: sudo loginctl enable-linger ada\)\./);
    assert.ok(!m.came.some((c) => c.path === "/api/shutdown"), "nothing ran to stop");
  });

  test("install with --port, in the manager's XDG_CONFIG_HOME, lingering on: the port in its ExecStart, the unit where systemd reads it", async () => {
    const config = join(m.dir, "config");
    m.set({ xdgConfig: config, unitFile: join(config, "systemd", "user", "filament.service"), linger: true });
    // A port nothing listens on: the service's.
    const free = http.createServer();
    await new Promise((r) => free.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (free.address()).port;
    await new Promise((r) => free.close(() => r(undefined)));
    const r = await m.run(["service", "install", "--port", String(port)]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.ok(!existsSync(m.unitFile), "not in HOME's .config: the manager reads its own XDG_CONFIG_HOME");
    const unit = readFileSync(join(config, "systemd", "user", "filament.service"), "utf8");
    assert.deepEqual(unitWords(/^ExecStart=(.*)$/m.exec(unit)?.[1] || "").slice(2), ["start", "--data-dir", m.data, "--port", String(port)]);
    assert.match(r.out, /under systemd: started at boot, and again 3 s after it ends by itself\./);
    assert.match(r.out, /Lingering is on for ada: Filament starts at boot, with no one logged in\./);
    assert.equal((await m.run(["service", "install", "--port", "0"])).code, EXIT.usage, "--port 0 picks another port at each start");
  });

  test("install where Filament runs by hand: refused while a turn runs, nothing written; then stopped once idle, and systemd runs it", async () => {
    m.set({ running: "hand", busy: true });
    const busy = await m.run(["service", "install"]);
    assert.equal(busy.code, EXIT.busy, `${busy.out}\n${busy.err}`);
    assert.match(busy.err, /1 turn running in “Fix the build”/);
    assert.ok(!existsSync(m.unitFile), "nothing written while it was refused");
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"]]);
    m.set({ busy: false });
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }, { ifIdle: true }]);
    assert.match(r.out, new RegExp(`^Stopped the Filament that ran at ${m.url.replace(/\./g, "\\.")}, started by hand: systemd runs it from now on\\.`));
    assert.deepEqual(m.calls(), INSTALL_CALLS);
    assert.equal(m.read().running, "systemd");
  });

  test("install where the Filament app runs it: refused in words, nothing written", async () => {
    m.set({ running: "desktop" });
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.failed);
    assert.match(r.err, /The Filament app runs this data folder's Filament .*quit the app \(its tray's Quit\) first\./);
    assert.ok(!existsSync(m.unitFile));
    assert.ok(!m.came.some((c) => c.path === "/api/shutdown"), "the app's Filament is not stopped: the app would start it again");
  });

  test("install again: the same unit, nothing restarted; a new one (--port), the Filament systemd runs restarted on it once idle", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    const same = await m.run(["service", "install"]);
    assert.equal(same.code, EXIT.ok, `${same.out}\n${same.err}`);
    assert.match(same.out, /filament\.service \(as it was\)\./);
    assert.deepEqual(m.calls(), INSTALL_CALLS);
    assert.ok(!m.came.some((c) => c.path === "/api/shutdown"));
    const free = http.createServer();
    await new Promise((r) => free.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (free.address()).port;
    await new Promise((r) => free.close(() => r(undefined)));
    const changed = await m.run(["service", "install", "--port", String(port)]);
    assert.equal(changed.code, EXIT.ok, `${changed.out}\n${changed.err}`);
    assert.match(changed.out, /\(in place of the one there\)/);
    assert.deepEqual(m.calls(), [...INSTALL_CALLS.slice(0, 4), MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"], INSTALL_CALLS[4]]);
    assert.deepEqual(m.came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }]);
    assert.equal(m.read().ranUnit, readFileSync(m.unitFile, "utf8"), "it runs on the new unit");
    assert.equal(m.read().mainPid, 4243);
  });

  test("uninstall: stopped once idle, disabled, its unit removed and systemd reloaded; again, nothing installed is said", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    const r = await m.run(["service", "uninstall"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"], MAIN_PID, MAIN_PID, ["systemctl", "--user", "disable", "--now", "filament"], ["systemctl", "--user", "daemon-reload"]]);
    assert.deepEqual(m.came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }]);
    assert.ok(!existsSync(m.unitFile));
    assert.deepEqual([m.read().enabled, m.read().active, m.read().loaded], ["disabled", "inactive", null]);
    assert.match(r.out, /^Removed .*filament\.service: Filament is stopped, and starts no more at boot or after a crash\. filament start runs it by hand\.$/);
    const again = await m.run(["service", "uninstall"]);
    assert.equal(again.code, EXIT.ok);
    assert.match(again.out, /^No Filament service is installed here: there is no .*filament\.service\.$/);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"]]);
  });

  test("status: active and enabled, what it runs, lingering and its log's last lines — in words and as JSON; not installed, said", async () => {
    const none = await m.run(["service", "status", "--json"]);
    assert.equal(none.code, EXIT.ok, none.err);
    assert.deepEqual(JSON.parse(none.out).installed, false);
    assert.match((await m.run(["service"])).out, /^No Filament service is installed here \(no .*filament\.service\): filament service install runs Filament under systemd/);
    m.set({ linger: true });
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    const words = await m.run(["service", "status"]);
    assert.equal(words.code, EXIT.ok, words.err);
    const exec = /^ExecStart=(.*)$/m.exec(readFileSync(m.unitFile, "utf8"))?.[1];
    assert.equal(
      words.out,
      [
        "Filament's service: active, enabled",
        `  unit     : ${m.unitFile}`,
        `  runs     : ${exec}`,
        `  filament : 9.9.9 answers at ${m.url}`,
        "  linger   : on — it starts at boot",
        "Its log's last lines (journalctl --user -u filament):",
        ...m.read().journal.map((/** @type {string} */ l) => `  ${l}`),
      ].join("\n"),
    );
    const sorted = (/** @type {string[][]} */ c) => c.map((x) => x.join(" ")).sort();
    assert.deepEqual(sorted(m.calls()), sorted([["systemctl", "--user", "show-environment"], ["systemctl", "--user", "is-active", "filament"], ["systemctl", "--user", "is-enabled", "filament"], ["loginctl", "show-user", "ada", "-p", "Linger"], ["journalctl", "--user", "-u", "filament", "-n", "20", "--no-pager"]]));
    const j = JSON.parse((await m.run(["service", "status", "--json"])).out);
    assert.deepEqual(
      { ...j, journal: j.journal.length },
      { installed: true, unit: m.unitFile, active: "active", enabled: "enabled", execStart: exec, dataDir: m.data, linger: true, filament: { version: "9.9.9", url: m.url, supervisor: "systemd" }, journal: 2, journalError: null },
    );
  });

  test("logs: journalctl --user -u filament -f, its lines as they come", async () => {
    const r = await m.run(["service", "logs"]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.wrote, `${m.read().journal.join("\n")}\n`);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"], ["journalctl", "--user", "-u", "filament", "-f"]]);
  });

  test("filament stop under systemd: refused while a turn runs; else asked to stop once idle, then systemctl stops the unit; --force, systemctl at once", async () => {
    m.set({ loaded: "[Service]", active: "active", enabled: "enabled", running: "systemd", mainPid: 4242, busy: true });
    const busy = await m.run(["stop"]);
    assert.equal(busy.code, EXIT.busy, `${busy.out}\n${busy.err}`);
    assert.deepEqual(m.calls(), [MAIN_PID], "nothing stopped");
    m.set({ busy: false });
    const r = await m.run(["stop"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "stop", "filament"]]);
    assert.deepEqual(m.came.filter((c) => c.path === "/api/shutdown").map((c) => c.body), [{ ifIdle: true }, { ifIdle: true }]);
    assert.equal(m.read().active, "inactive", "systemd does not start it again: the stop was systemctl's");
    assert.equal(r.out, "Filament is stopped, and its systemd service with it: it starts again at the next boot or login, or now with filament start.");
    m.set({ active: "active", running: "systemd", mainPid: 4243, busy: true });
    const forced = await m.run(["stop", "--force"]);
    assert.equal(forced.code, EXIT.ok, `${forced.out}\n${forced.err}`);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "stop", "filament"]]);
    assert.equal(m.came.filter((c) => c.path === "/api/shutdown").length, 2, "--force asks Filament nothing");
  });

  test("filament restart under systemd: once idle, ended, then systemctl starts it now, and it answers; --force, systemctl restart; one started by hand, refused in words", async () => {
    m.set({ loaded: "[Service]", active: "active", enabled: "enabled", running: "systemd", mainPid: 4242, pids: 4242 });
    const r = await m.run(["restart"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [MAIN_PID, MAIN_PID, ["systemctl", "--user", "start", "filament"]]);
    assert.equal(r.out, `Filament 9.9.9 runs again at ${m.url}, under systemd.`);
    assert.equal(m.read().mainPid, 4243);
    const forced = await m.run(["restart", "--force"]);
    assert.equal(forced.code, EXIT.ok, `${forced.out}\n${forced.err}`);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "restart", "filament"]]);
    assert.equal(m.read().mainPid, 4244);
    m.set({ running: "hand" });
    const hand = await m.run(["restart"]);
    assert.equal(hand.code, EXIT.failed);
    assert.match(hand.err, /^filament restart: Nothing starts this Filament again once it stops — it was started by hand: filament stop, then filament start/);
  });

  test("refused in words: on macOS (the app runs Filament there), with no systemctl, where the user manager does not answer, for another machine; filament service run, a Windows host's alone", async () => {
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
      const mac = await m.run(["service", "install"]);
      assert.equal(mac.code, EXIT.failed);
      assert.match(mac.err, /on a Mac the Filament app runs it, and starts it at logon/);
    } finally {
      Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    }
    const run = await m.run(["service", "run"]);
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err, /filament service run is what Filament's scheduled task runs on a Windows host: on Linux, systemd runs filament start/);
    assert.deepEqual(m.calls(), [], "systemd is not asked");
    process.env.PATH = m.home;
    const bare = await m.run(["service", "install"]);
    assert.equal(bare.code, EXIT.failed);
    assert.match(bare.err, /There is no systemctl here, so no systemd to run Filament/);
    process.env.PATH = m.bin;
    m.set({ manager: "Failed to connect to bus: No such file or directory" });
    const wsl = await m.run(["service", "install"]);
    assert.equal(wsl.code, EXIT.failed);
    assert.match(wsl.err, /systemd's user manager does not answer here \(systemctl --user: Failed to connect to bus: No such file or directory\) — WSL without systemd/);
    assert.ok(!existsSync(m.unitFile));
    assert.equal((await m.run(["service", "install", "--machine", "srv"])).code, EXIT.usage);
  });

  test("filament start, and filament restart with nothing running, where the unit is installed: systemctl starts it and it answers — never one by hand beside it; no unit, another data folder's or a disabled one: started as before", async () => {
    const said = /** @type {string[]} */ ([]);
    const start = (dataDir = m.data) => startUnit({ dataDir, flags: {}, out: (s) => said.push(s) });
    assert.equal(await start(), false, "no unit: filament start runs Filament itself");
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"]]);
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    assert.equal((await m.run(["stop"])).code, EXIT.ok);
    assert.equal(m.read().active, "inactive");
    m.calls();
    const STARTS = [["systemctl", "--user", "show-environment"], ["systemctl", "--user", "is-enabled", "filament"], ["systemctl", "--user", "start", "filament"]];
    assert.equal(await start(), true);
    assert.deepEqual(m.calls(), STARTS);
    assert.deepEqual([m.read().active, m.read().running], ["active", "systemd"]);
    assert.equal(said.join("\n"), `Filament 9.9.9 runs at ${m.url}, under systemd: filament stop stops it, filament service status says how it runs.`);
    // bin/filament.js's own start, as a server runs it: through systemctl, and it ends once Filament answers. (Linux alone:
    // elsewhere it would start a Filament of its own.)
    if (!WIN) {
      assert.equal((await m.run(["stop"])).code, EXIT.ok);
      m.calls();
      const { FILAMENT_SUPERVISOR: _by, ...env } = process.env;
      const child = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "start", "--data-dir", m.data], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      assert.equal(await new Promise((r) => child.on("close", r)), 0, `${out}\n${err}`);
      assert.equal(out.trim(), `Filament 9.9.9 runs at ${m.url}, under systemd: filament stop stops it, filament service status says how it runs.`, err);
      assert.deepEqual(m.calls(), STARTS);
    }
    assert.equal((await m.run(["stop"])).code, EXIT.ok);
    m.calls();
    const r = await m.run(["restart"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), STARTS);
    assert.equal(r.out, `Filament 9.9.9 runs at ${m.url}, under systemd: filament stop stops it, filament service status says how it runs.`);
    assert.equal((await m.run(["stop"])).code, EXIT.ok);
    // It ends as it starts: said at once, not after a minute.
    m.set({ crashes: true });
    m.calls();
    const crashed = await m.run(["restart"]);
    assert.equal(crashed.code, EXIT.failed);
    assert.deepEqual(m.calls(), [...STARTS, MAIN_PID]);
    // (fails before: yes — the re-read of 11-11, its finding 8: a restart put off by a turn, then one that ends as it
    // starts, named no way back to the version before)
    assert.equal(crashed.err, "filament restart: systemd started Filament, and it ended as it started: systemd starts it again every 3 s — filament service status shows its log, systemctl --user stop filament stops it; after an update, filament update --back goes back to the version before.");
    m.set({ crashes: false, active: "inactive" });
    assert.equal(await start(join(m.dir, "other")), false, "another data folder's Filament is not the unit's");
    m.set({ enabled: "disabled" });
    assert.equal(await start(), false, "a disabled unit is not started");
    assert.equal((await m.run(["restart"])).code, EXIT.noFilament, "nothing answers and no unit starts it: as before");
  });

  test("install where something other than Filament listens at the service's port — --port's, or the data folder's own: refused in words, nothing written or enabled", async () => {
    const foreign = net.createServer((s) => s.destroy());
    await new Promise((r) => foreign.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (foreign.address()).port;
    try {
      const r = await m.run(["service", "install", "--port", String(port)]);
      assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
      assert.equal(r.err, `filament service: Something other than this data folder's Filament listens at http://127.0.0.1:${port} — another program, or a Filament that refuses this folder's owner key —: the service would find its port taken, and fail at each start. Stop it, or give --port with a port nothing holds.`);
      assert.ok(!existsSync(m.unitFile));
      assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"]]);
      // No Filament runs the data folder (no listening.json): its config's port is the service's.
      rmSync(join(m.data, "listening.json"));
      writeFileSync(join(m.data, "config.json"), JSON.stringify({ server: { port } }));
      const own = await m.run(["service", "install"]);
      assert.equal(own.code, EXIT.failed, `${own.out}\n${own.err}`);
      assert.match(own.err, new RegExp(`Something other than this data folder's Filament listens at http://127\\.0\\.0\\.1:${port} `));
      assert.ok(!existsSync(m.unitFile));
      assert.equal(m.read().enabled, "not-found");
    } finally {
      await new Promise((r) => foreign.close(() => r(undefined)));
    }
  });

  test("install whose Filament ends as it starts: stopped and disabled — no crash loop left enabled —, its unit kept and its log said; filament start then runs Filament itself", async () => {
    m.set({ crashes: true });
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [...INSTALL_CALLS.slice(0, 4), MAIN_PID, ["systemctl", "--user", "disable", "--now", "filament"], ["journalctl", "--user", "-u", "filament", "-n", "10", "--no-pager"]]);
    assert.deepEqual([m.read().enabled, m.read().active], ["disabled", "inactive"]);
    assert.ok(existsSync(m.unitFile), "kept, for filament service status to show");
    assert.equal(
      r.err,
      [
        `filament service: systemd started Filament, and it ended as it started — so it is stopped and disabled, and systemd does not start it again and again; its unit stays in ${m.unitFile}. Once its cause is fixed, filament service install starts it again.`,
        "Its log's last lines (journalctl --user -u filament):",
        ...m.read().journal.map((/** @type {string} */ l) => `  ${l}`),
      ].join("\n"),
    );
    assert.equal(await startUnit({ dataDir: m.data, flags: {}, out: () => {} }), false, "a disabled unit: filament start runs Filament itself, its errors in sight");
  });

  test("uninstall where a Filament started by hand still runs its data folder: the unit removed, and what still runs said", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    m.set({ running: "hand", active: "activating", mainPid: 0 });
    const r = await m.run(["service", "uninstall"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [["systemctl", "--user", "show-environment"], ["systemctl", "--user", "disable", "--now", "filament"], ["systemctl", "--user", "daemon-reload"]]);
    assert.ok(!m.came.some((c) => c.path === "/api/shutdown"), "one started by hand is not systemd's to stop");
    assert.ok(!existsSync(m.unitFile));
    assert.equal(r.out, `Removed ${m.unitFile}: systemd starts Filament no more, at boot or after a crash. A Filament of its data folder still runs at ${m.url}, started by hand: filament stop stops it.`);
  });

  test("install reads systemd's own environment, not this shell's: its HOME's ~/.local/bin and its PATH in the unit's, its USER's lingering; systemctl found in the system's folders where the PATH has none", async () => {
    const shellHome = join(m.dir, "shell-home");
    mkdirSync(shellHome);
    m.set({ path: "/snap/bin:/usr/bin:/bin", linger: true });
    // sudo's, su's or a script's shell: another HOME and USER, and a PATH with no systemctl on it.
    Object.assign(process.env, { HOME: shellHome, USER: "root", PATH: m.home });
    tools.system = [m.bin];
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), INSTALL_CALLS, "loginctl asked of the manager's user, ada");
    const unit = readFileSync(m.unitFile, "utf8");
    const path = [...new Set([join(m.home, ".local", "bin"), dirname(process.execPath), m.home, "/snap/bin", "/usr/bin", "/bin", ...SYSTEM_PATH])].join(":");
    assert.ok(unit.split("\n").includes(`Environment=${q(`PATH=${path}`)}`), unit);
    assert.match(r.out, /Lingering is on for ada: Filament starts at boot, with no one logged in\./);
  });
});

/**
 * Task Scheduler, as schtasks.exe answers: /Query /XML, /Create /XML, /Run, /Change and /Delete of \Filament\Filament,
 * each call noted in FAKE_TASKS_CALLS's file; the task (its XML, whether enabled, whether registering is denied, as
 * without an administrator) in FAKE_TASKS's. /Run starts the task's runner — FAKE_RUNNER, which reads the task's data
 * folder and port from its XML — detached, as Task Scheduler runs it apart. Written to a file as it is here, run by Node.
 * @param {any} require
 */
function fakeSchtasks(require) {
  const fs = require("fs");
  const { spawn } = require("child_process");
  const [tool, ...args] = process.argv.slice(2);
  const file = String(process.env.FAKE_TASKS);
  fs.appendFileSync(String(process.env.FAKE_TASKS_CALLS), `${JSON.stringify([tool, ...args])}\n`);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const save = () => fs.writeFileSync(file, JSON.stringify(s));
  /** @param {string} [out] @param {number} [code] @param {string} [err] */
  const end = (out = "", code = 0, err = "") => {
    if (out) process.stdout.write(`${out}\r\n`);
    if (err) process.stderr.write(`${err}\r\n`);
    process.exitCode = code;
  };
  const NONE = "ERROR: The system cannot find the file specified.";
  const verb = args[0];
  if (args[args.indexOf("/TN") + 1] !== "\\Filament\\Filament") return end("", 1, NONE);
  if (verb === "/Query") return s.xml ? end(s.enabled ? s.xml : s.xml.replace("<Enabled>true</Enabled>\r\n    <Hidden>", "<Enabled>false</Enabled>\r\n    <Hidden>")) : end("", 1, NONE);
  if (s.denied) return end("", 1, "ERROR: Access is denied.");
  if (verb === "/Create") {
    const b = fs.readFileSync(args[args.indexOf("/XML") + 1]);
    if (b[0] !== 0xff || b[1] !== 0xfe) return end("", 1, "ERROR: The task XML is malformed.");
    Object.assign(s, { xml: b.subarray(2).toString("utf16le"), enabled: true });
    return save(), end('SUCCESS: The scheduled task "\\Filament\\Filament" has successfully been created or updated.');
  }
  if (!s.xml) return end("", 1, NONE);
  if (verb === "/Change") return (s.enabled = !args.includes("/DISABLE")), save(), end('SUCCESS: The parameters of scheduled task "\\Filament\\Filament" have been changed.');
  if (verb === "/Delete") return (s.xml = null), save(), end('SUCCESS: The scheduled task "\\Filament\\Filament" was successfully deleted.');
  if (verb === "/Run") {
    spawn(process.execPath, [String(process.env.FAKE_RUNNER)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return end('SUCCESS: Attempted to run the scheduled task "\\Filament\\Filament".');
  }
  return end("", 1, `ERROR: Invalid argument/option - '${verb}'.`);
}

/**
 * Filament, as the runner starts it (`start --data-dir <d> [--port <n>]`): at --port, else its config's, its
 * listening.json written once it listens; its state says the supervisor its environment names. /api/shutdown ends it
 * (busy, as the task's state says: refused where it asks once idle); crashes: it ends as it starts. Each request noted
 * in FAKE_TASKS_CAME's file.
 * @param {any} require
 */
function fakeFilament(require) {
  const fs = require("fs");
  const http = require("http");
  const path = require("path");
  const argv = process.argv.slice(2);
  const opt = (/** @type {string} */ n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const dataDir = String(opt("--data-dir"));
  const state = () => JSON.parse(fs.readFileSync(String(process.env.FAKE_TASKS), "utf8"));
  console.log(`Filament 9.9.9 (process ${process.pid}): ${argv.join(" ")}`);
  if (state().crashes) {
    console.error("Filament failed to start: the port is taken");
    process.exit(1);
  }
  const port = Number(opt("--port") || JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).server.port);
  const listening = path.join(dataDir, "listening.json");
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      fs.appendFileSync(String(process.env.FAKE_TASKS_CAME), `${JSON.stringify({ method: req.method, path: req.url, body, pid: process.pid })}\n`);
      if (req.url === "/api/state") return void res.end(JSON.stringify({ version: "9.9.9", dataDir, uptimeMs: 1000, supervisor: process.env.FILAMENT_SUPERVISOR || null }));
      if (req.method === "POST" && req.url === "/api/shutdown") {
        if (body?.ifIdle === true && state().busy) {
          res.statusCode = 409;
          return void res.end(JSON.stringify({ ok: false, turns: 1, note: "not stopped: 1 turn running in “Fix the build”" }));
        }
        return void res.end(JSON.stringify({ ok: true, inflight: 0, note: "stopping now" }), () => {
          fs.rmSync(listening, { force: true });
          process.exit(0);
        });
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `no ${req.method} ${req.url}` }));
    });
  });
  server.on("error", (/** @type {Error} */ e) => {
    console.error(`Filament failed to start: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => fs.writeFileSync(listening, JSON.stringify({ url: `http://127.0.0.1:${port}`, host: "127.0.0.1", port, pid: process.pid, version: "9.9.9", startedAt: Date.now() })));
}

/** A port nothing listens on, now. */
const freePort = async () => {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
  await new Promise((r) => s.close(() => r(undefined)));
  return port;
};

/**
 * A Windows host of the test's own: a data folder whose config names a free port, schtasks.exe's stand-in on a PATH of
 * its own, Task Scheduler's state, and the runner the task runs — service-task.js's own, run apart as Task Scheduler
 * runs it, starting the Filament stand-in.
 */
const windowsHost = async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-service-win-"));
  const data = join(dir, "data");
  const bin = join(dir, "bin");
  for (const d of [data, bin]) mkdirSync(d, { recursive: true });
  const port = await freePort();
  writeFileSync(join(data, "config.json"), JSON.stringify({ server: { port } }));
  const fake = join(dir, "fake-schtasks.cjs");
  writeFileSync(fake, `(${fakeSchtasks})(require);\n`);
  writeFileSync(join(bin, "schtasks.exe"), "");
  if (!WIN) chmodSync(join(bin, "schtasks.exe"), 0o755);
  const filament = join(dir, "fake-filament.cjs");
  writeFileSync(filament, `(${fakeFilament})(require);\n`);
  const runner = join(dir, "runner.mjs");
  const lib = new URL("../src/cli/service-task.js", import.meta.url).href;
  writeFileSync(
    runner,
    [
      'import { readFileSync } from "node:fs";',
      `import { runRunner, taskOf } from ${JSON.stringify(lib)};`,
      'const t = taskOf(JSON.parse(readFileSync(String(process.env.FAKE_TASKS), "utf8")).xml);',
      'const at = t.args.indexOf("--port");',
      `await runRunner({ dataDir: String(t.dataDir), port: at >= 0 ? Number(t.args[at + 1]) : null, againMs: 100, task: [t.command, ...t.args], launch: () => ({ command: process.execPath, args: [${JSON.stringify(filament)}] }) });`,
      "",
    ].join("\n"),
  );
  const stateFile = join(dir, "tasks.json");
  const callsFile = join(dir, "calls.jsonl");
  const cameFile = join(dir, "came.jsonl");
  writeFileSync(stateFile, JSON.stringify({ xml: null, enabled: false, denied: false, busy: false, crashes: false }));
  for (const f of [callsFile, cameFile]) writeFileSync(f, "");
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  /** @param {string} f */
  const lines = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    dir,
    data,
    bin,
    fake,
    port,
    env: { FAKE_TASKS: stateFile, FAKE_TASKS_CALLS: callsFile, FAKE_TASKS_CAME: cameFile, FAKE_RUNNER: runner },
    read,
    /** @param {Record<string, any>} change */
    set: (change) => writeFileSync(stateFile, JSON.stringify({ ...read(), ...change })),
    /** schtasks' calls, in order, each noted from here on. */
    calls: () => {
      const all = lines(callsFile);
      writeFileSync(callsFile, "");
      return /** @type {string[][]} */ (all);
    },
    /** What the Filament stand-ins were asked to stop with: each /api/shutdown's body. */
    stops: () => lines(cameFile).filter((c) => c.path === "/api/shutdown").map((c) => c.body),
    /** @param {string[]} argv */
    async run(argv) {
      /** @type {{ out: string[], err: string[], wrote: string }} */
      const said = { out: [], err: [], wrote: "" };
      const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
      const code = await runCli(argv, { dataDir: data, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.wrote += s) });
      return { code, out: said.out.join("\n"), err: said.err.join("\n"), wrote: said.wrote };
    },
    async close() {
      // The runner and its Filament ended, so their files go with the folder.
      const r = runnerOf(data);
      for (const pid of [r?.server, r?.pid])
        if (pid)
          try {
            process.kill(pid);
          } catch {}
      for (const end = Date.now() + 5000; Date.now() < end && runnerOf(data); ) await new Promise((res) => setTimeout(res, 50));
      await removeDirs(dir);
    },
  };
};

const SCHTASKS = (/** @type {string[]} */ ...args) => ["schtasks.exe", ...args];
const QUERY = SCHTASKS("/Query", "/TN", TASK, "/XML");
const RUN = SCHTASKS("/Run", "/TN", TASK);

describe("filament service, on a Windows host with Task Scheduler", () => {
  /** @type {PropertyDescriptor | undefined} */
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const NAMES = ["PATH", "FAKE_TASKS", "FAKE_TASKS_CALLS", "FAKE_TASKS_CAME", "FAKE_RUNNER", "FILAMENT_MACHINE"];
  /** @type {Record<string, string | undefined>} */
  const was = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  const own = { spawn: tools.spawn, windows: tools.windows, stopMs: tools.stopMs, upMs: tools.upMs };
  /** @type {Awaited<ReturnType<typeof windowsHost>>} */
  let m;
  /** The task file's path. */
  let xmlFile = "";

  before(() => {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    // schtasks.exe's stand-in through Node, on any platform; Windows' own System32 never asked.
    tools.spawn = /** @type {any} */ ((/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ o) => spawn(process.execPath, [m.fake, basename(file), ...args], o));
    Object.assign(tools, { windows: [], stopMs: 10_000, upMs: 15_000 });
  });
  after(() => {
    if (platform) Object.defineProperty(process, "platform", platform);
    Object.assign(tools, own);
    for (const n of NAMES) {
      if (was[n] === undefined) delete process.env[n];
      else process.env[n] = was[n];
    }
  });
  beforeEach(async () => {
    m = await windowsHost();
    xmlFile = serviceFiles(m.data).xml;
    delete process.env.FILAMENT_MACHINE;
    Object.assign(process.env, { PATH: m.bin, ...m.env });
  });
  afterEach(async () => {
    await m.close();
  });

  test("install: the task registered from its task.xml — this checkout's Node and bin/filament.js running `service run` on its data folder — and run; its runner starts Filament, which answers under its task; installed again as it was, nothing restarted", async () => {
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Create", "/TN", TASK, "/XML", xmlFile, "/F"), RUN]);
    const xml = readTaskXml(xmlFile);
    assert.equal(m.read().xml, xml, "registered as written");
    assert.deepEqual(taskOf(xml), { command: process.execPath, args: [join(ROOT, "bin", "filament.js"), "--data-dir", m.data, "service", "run"], dataDir: m.data, enabled: true });
    assert.match(xml || "", /<LogonType>S4U<\/LogonType>/);
    const url = `http://127.0.0.1:${m.port}`;
    assert.match(r.out, /It runs this checkout, with this Node/);
    assert.ok(r.out.includes(`Filament 9.9.9 runs at ${url} under its scheduled task (${TASK}): started at boot, with no one logged in, and again 3 s after it ends by itself.`), r.out);
    assert.ok(r.out.includes("It runs as you without your password (Task Scheduler's S4U): it reaches no network share, and Windows' Credential Manager is closed to it."), r.out);
    const first = runnerOf(m.data);
    assert.ok(first?.server);
    const same = await m.run(["service", "install"]);
    assert.equal(same.code, EXIT.ok, `${same.out}\n${same.err}`);
    assert.match(same.out, /task\.xml \(as it was\)\./);
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Create", "/TN", TASK, "/XML", xmlFile, "/F")], "its runner runs: nothing run again");
    assert.deepEqual(runnerOf(m.data), first);
    assert.deepEqual(m.stops(), []);
  });

  test("install again with --port: the task registered with it, and the Filament it runs stopped once idle and started on it", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    const port = await freePort();
    m.set({ busy: true });
    const busy = await m.run(["service", "install", "--port", String(port)]);
    assert.equal(busy.code, EXIT.busy, `${busy.out}\n${busy.err}`);
    assert.match(busy.err, /The task is registered; the Filament it runs goes on with the old one, as 1 turn running in “Fix the build” \(HTTP 409\) — filament restart, once it ends, starts it on the new one\./);
    assert.ok(!existsSync(serviceFiles(m.data).stop), "the stop asked is taken back: its runner goes on");
    m.set({ busy: false });
    m.calls();
    const r = await m.run(["service", "install", "--port", String(port)]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.match(r.out, /\(as it was\)\. It runs .*, its port \d+\./, "the task.xml the refused install wrote stands");
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Create", "/TN", TASK, "/XML", xmlFile, "/F"), RUN]);
    assert.deepEqual(taskOf(m.read().xml)?.args.slice(-2), ["--port", String(port)]);
    assert.ok(r.out.includes(`runs at http://127.0.0.1:${port} under its scheduled task`), r.out);
    assert.deepEqual(m.stops(), [{ ifIdle: true }, { ifIdle: true }]);
  });

  test("status: active and enabled, what it runs and its log's last lines — in words and as JSON with Linux's keys; not installed, said", async () => {
    const none = await m.run(["service", "status", "--json"]);
    assert.equal(none.code, EXIT.ok, none.err);
    assert.equal(JSON.parse(none.out).installed, false);
    assert.equal((await m.run(["service"])).out, `No Filament service is installed here (Task Scheduler has no ${TASK} task): filament service install runs Filament as one — started at boot, and again after a crash.`);
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    const j = JSON.parse((await m.run(["service", "status", "--json"])).out);
    const exec = [process.execPath, join(ROOT, "bin", "filament.js"), "--data-dir", m.data, "service", "run"].map(argWord).join(" ");
    assert.deepEqual(
      { ...j, journal: j.journal.length > 0 },
      { installed: true, unit: TASK, active: "active", enabled: "enabled", execStart: exec, dataDir: m.data, linger: true, filament: { version: "9.9.9", url: `http://127.0.0.1:${m.port}`, supervisor: "service" }, journal: true, journalError: null },
    );
    const words = await m.run(["service", "status"]);
    assert.equal(words.code, EXIT.ok, words.err);
    assert.match(words.out, /^Filament's service: active, enabled\n {2}task {5}: \\Filament\\Filament, at boot, as .+ without their password\n {2}runs {5}: .+\n {2}filament : 9\.9\.9 answers at http:\/\/127\.0\.0\.1:\d+\nIts log's last lines \(.*server\.log\):\n {2}\[service\] /);
    m.set({ enabled: false });
    assert.equal(JSON.parse((await m.run(["service", "status", "--json"])).out).enabled, "disabled");
  });

  test("logs: server.log's last lines, then what comes, until Ctrl+C; a log set aside and begun again is read from its start", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    const log = serviceFiles(m.data).log;
    const ac = new AbortController();
    let wrote = "";
    const done = runService({ words: ["logs"], flags: {}, dataDir: m.data, term: /** @type {any} */ ({}), out: () => {}, err: () => {}, write: (s) => (wrote += s), signal: ac.signal });
    for (const end = Date.now() + 5000; Date.now() < end && !wrote; ) await new Promise((r) => setTimeout(r, 20));
    assert.equal(wrote, readFileSync(log, "utf8"), "its last lines at once");
    appendFileSync(log, "a line that comes\n");
    for (const end = Date.now() + 5000; Date.now() < end && !wrote.endsWith("a line that comes\n"); ) await new Promise((r) => setTimeout(r, 50));
    assert.ok(wrote.endsWith("a line that comes\n"), wrote);
    renameSync(log, `${log}.1`);
    writeFileSync(log, "begun again\n");
    for (const end = Date.now() + 5000; Date.now() < end && !wrote.endsWith("begun again\n"); ) await new Promise((r) => setTimeout(r, 50));
    assert.ok(wrote.endsWith("a line that comes\nbegun again\n"), wrote);
    ac.abort();
    assert.equal(await done, EXIT.ok);
  });

  test("filament stop, start and restart under the task: stop refused while a turn runs, its stop taken back; else asked once idle, and its runner ends with it; start runs the task; restart's Filament started again by its runner", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    m.set({ busy: true });
    const busy = await m.run(["stop"]);
    assert.equal(busy.code, EXIT.busy, `${busy.out}\n${busy.err}`);
    assert.ok(!existsSync(serviceFiles(m.data).stop), "the stop asked is taken back");
    assert.ok(runnerOf(m.data)?.server, "it goes on");
    m.set({ busy: false });
    const r = await m.run(["stop"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.equal(r.out, "Filament is stopped, and its scheduled task with it: it starts again at the next boot, or now with filament start.");
    assert.equal(runnerOf(m.data), null, "its runner ended with it: it starts nothing again");
    assert.deepEqual(m.calls(), [], "Task Scheduler is not asked: the runner's stop file does it");
    assert.deepEqual(m.stops(), [{ ifIdle: true }, { ifIdle: true }]);
    const said = /** @type {string[]} */ ([]);
    assert.equal(await startUnit({ dataDir: m.data, flags: {}, out: (s) => said.push(s) }), true);
    assert.deepEqual(m.calls(), [QUERY, RUN]);
    assert.equal(said.join("\n"), `Filament 9.9.9 runs at http://127.0.0.1:${m.port}, under its scheduled task: filament stop stops it, filament service status says how it runs.`);
    const before = runnerOf(m.data);
    const again = await m.run(["restart"]);
    assert.equal(again.code, EXIT.ok, `${again.out}\n${again.err}`);
    assert.equal(again.out, `Filament 9.9.9 runs again at http://127.0.0.1:${m.port}, under its scheduled task.`);
    const after_ = runnerOf(m.data);
    assert.equal(after_?.pid, before?.pid, "the same runner started it again");
    assert.ok(after_?.server && after_.server !== before?.server);
    assert.deepEqual(m.calls(), [], "its runner started it: the task is not run again");
    const forced = await m.run(["restart", "--force"]);
    assert.equal(forced.code, EXIT.ok, `${forced.out}\n${forced.err}`);
    assert.ok(runnerOf(m.data)?.server !== after_?.server);
    assert.deepEqual(m.stops().slice(-2), [{ ifIdle: true }, {}], "--force asks it to stop now");
  });

  test("uninstall: stopped once idle, the task deleted and its task.xml removed; again, nothing installed is said", async () => {
    assert.equal((await m.run(["service", "install"])).code, EXIT.ok);
    m.calls();
    const r = await m.run(["service", "uninstall"]);
    assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Delete", "/TN", TASK, "/F")]);
    assert.deepEqual(m.stops(), [{ ifIdle: true }]);
    assert.equal(runnerOf(m.data), null);
    assert.ok(!existsSync(xmlFile));
    assert.equal(m.read().xml, null);
    assert.equal(r.out, `Removed ${TASK}: Filament is stopped, and starts no more at boot or after a crash. filament start runs it by hand.`);
    const again = await m.run(["service", "uninstall"]);
    assert.equal(again.out, `No Filament service is installed here: Task Scheduler has no ${TASK} task.`);
    assert.equal(await startUnit({ dataDir: m.data, flags: {}, out: () => {} }), false, "no task: filament start runs Filament itself");
  });

  test("install whose Filament ends as it starts: stopped and disabled — no start again and again —, its task kept and its log said; filament start then runs Filament itself", async () => {
    m.set({ crashes: true });
    const r = await m.run(["service", "install"]);
    assert.equal(r.code, EXIT.failed, `${r.out}\n${r.err}`);
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Create", "/TN", TASK, "/XML", xmlFile, "/F"), RUN, SCHTASKS("/Change", "/TN", TASK, "/DISABLE")]);
    assert.equal(m.read().enabled, false);
    assert.equal(runnerOf(m.data), null, "its runner stopped");
    assert.ok(
      r.err.startsWith(`filament service: Filament's scheduled task started Filament, and it ended as it started — so it is stopped and disabled, and nothing starts it again and again; its task stays (${TASK}). Once its cause is fixed, filament service install starts it again.\nIts log's last lines (${serviceFiles(m.data).log}):\n`),
      r.err,
    );
    assert.match(r.err, /Filament failed to start: the port is taken/);
    assert.equal(await startUnit({ dataDir: m.data, flags: {}, out: () => {} }), false, "a disabled task: filament start runs Filament itself, its errors in sight");
  });

  test("refused in words: a task another data folder's, registering without an administrator, the Filament app's command line, another machine", async () => {
    const other = join(m.dir, "other data");
    m.set({ xml: taskXml({ argv: [process.execPath, "filament.js"], dataDir: other, user: "ada" }), enabled: true });
    const theirs = await m.run(["service", "install"]);
    assert.equal(theirs.code, EXIT.failed);
    assert.equal(theirs.err, `filament service: Filament's task runs the data folder ${other}: one task runs one data folder on a machine — filament service uninstall --data-dir "${other}" removes it first.`);
    assert.ok(!existsSync(xmlFile));
    m.set({ xml: null, denied: true });
    m.calls();
    const denied = await m.run(["service", "install"]);
    assert.equal(denied.code, EXIT.failed);
    assert.equal(
      denied.err,
      `filament service: schtasks /Create /TN ${TASK} /XML ${xmlFile} /F failed: ERROR: Access is denied. Registering a task that starts Filament at boot, with no one logged in, takes an administrator: run filament service install in a PowerShell opened as administrator, or over SSH as an administrator (its sessions are elevated).`,
    );
    assert.deepEqual(m.calls(), [QUERY, SCHTASKS("/Create", "/TN", TASK, "/XML", xmlFile, "/F")], "nothing run");
    assert.equal(runnerOf(m.data), null);
    assert.equal((await m.run(["service", "install", "--machine", "srv"])).code, EXIT.usage);
    const electron = Object.getOwnPropertyDescriptor(process.versions, "electron");
    Object.defineProperty(process.versions, "electron", { value: "99.0.0", configurable: true, enumerable: true });
    try {
      assert.match((await m.run(["service", "status"])).err, /The Filament app runs Filament on this computer, and starts it at logon/);
    } finally {
      if (electron) Object.defineProperty(process.versions, "electron", electron);
      else delete (/** @type {any} */ (process.versions).electron);
    }
  });
});

test("the unit's words as systemd reads them: quoted where a space is, % and $ doubled — and read back whole", () => {
  const unit = unitText({ argv: ["/opt/my filament/bin/filament"], nodeBin: "/opt/my filament/node/bin", dataDir: "/srv/100%/$HOME", port: 20555 });
  const exec = /^ExecStart=(.*)$/m.exec(unit)?.[1] || "";
  assert.equal(exec, '"/opt/my filament/bin/filament" start --data-dir /srv/100%%/$$HOME --port 20555');
  assert.deepEqual(unitWords(exec), ["/opt/my filament/bin/filament", "start", "--data-dir", "/srv/100%/$HOME", "--port", "20555"]);
  assert.match(unit, /^Environment="PATH=[^"\n]*:\/opt\/my filament\/node\/bin:/m);
});

test("what the unit runs: the installed Filament by its stable path (current), known by its layout wherever XDG_DATA_HOME put it; a server build elsewhere, its own launcher; a checkout, its Node and bin/filament.js", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-service-roots-"));
  const was = process.env.XDG_DATA_HOME;
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  try {
    /** A server build's folder, as dist-server.mjs makes it. @param {string} root */
    const build = (root) => {
      mkdirSync(join(root, "bin"), { recursive: true });
      writeFileSync(join(root, "build-info.json"), JSON.stringify({ kind: "server", version: "0.9.6" }));
      writeFileSync(join(root, "bin", "filament"), "#!/bin/sh\n");
      return root;
    };
    // Installed with an XDG_DATA_HOME of that shell's alone: neither this shell nor systemd's manager names its folder,
    // and filament update finds it all the same, by current beside it.
    process.env.XDG_DATA_HOME = join(dir, "shell-share");
    const base = join(dir, "once", "filament");
    const installed = build(join(base, "0.9.6"));
    symlinkSync(WIN ? installed : "0.9.6", join(base, "current"), "junction");
    assert.deepEqual(launcherOf(installed), {
      argv: [join(base, "current", "bin", "filament")],
      nodeBin: join(base, "current", "node", "bin"),
      words: `the installed Filament, by its stable path (${join(base, "current")}): an update points it at the new version, which starts at the next restart`,
    });
    // A version's folder current does not point at is run where it is: a restart would run the other one.
    const kept = build(join(base, "0.9.5"));
    assert.deepEqual(launcherOf(kept).argv, [join(kept, "bin", "filament")]);
    const elsewhere = build(join(dir, "opt", "filament"));
    assert.deepEqual(launcherOf(elsewhere).argv, [join(elsewhere, "bin", "filament")]);
    assert.match(launcherOf(elsewhere).words, /install\.sh did not install it, so an update does not reach it/);
    const checkout = join(dir, "checkout");
    mkdirSync(join(checkout, ".git"), { recursive: true });
    assert.deepEqual(launcherOf(checkout).argv, [process.execPath, join(checkout, "bin", "filament.js")]);
    assert.match(launcherOf(checkout).words, /^this checkout, with this Node/);
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
    if (was === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = was;
    await removeDirs(dir);
  }
});

test("what a Windows host's task runs: the build's own Node and bin\\filament.js by current (install.ps1's), never filament.cmd; after an update, by current all the same; a build elsewhere, where it is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-service-roots-win-"));
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    /** A win32-x64 server build's folder, as dist-server.mjs lays one out. @param {string} root */
    const build = (root) => {
      mkdirSync(join(root, "bin"), { recursive: true });
      mkdirSync(join(root, "node"), { recursive: true });
      writeFileSync(join(root, "build-info.json"), JSON.stringify({ kind: "server", version: "0.9.6", target: "win32-x64" }));
      writeFileSync(join(root, "node", "node.exe"), "");
      writeFileSync(join(root, "bin", "filament.js"), "");
      writeFileSync(join(root, "bin", "filament.cmd"), "");
      return root;
    };
    const base = join(dir, "filament");
    const installed = build(join(base, "0.9.6"));
    symlinkSync(WIN ? installed : "0.9.6", join(base, "current"), "junction");
    const current = join(base, "current");
    assert.deepEqual(launcherOf(installed), {
      argv: [join(current, "node", "node.exe"), join(current, "bin", "filament.js")],
      nodeBin: join(current, "node"),
      words: `the installed Filament, by its stable path (${current}): an update points it at the new version, which starts at the next restart`,
    });
    // An update pointed current at another version: the runner that runs the one before starts the new one by current.
    const next = build(join(base, "0.9.7"));
    if (WIN) rmdirSync(current);
    else unlinkSync(current);
    symlinkSync(WIN ? next : "0.9.7", current, "junction");
    assert.deepEqual(launcherOf(installed).argv, [join(installed, "node", "node.exe"), join(installed, "bin", "filament.js")], "a version current does not lead to is run where it is");
    assert.deepEqual(launcherOf(installed, { moved: true }).argv, [join(current, "node", "node.exe"), join(current, "bin", "filament.js")]);
    const elsewhere = build(join(dir, "opt", "filament"));
    assert.match(launcherOf(elsewhere).words, /install\.ps1 did not install it, so an update does not reach it/);
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
    await removeDirs(dir);
  }
});

test("Settings › About: systemd starts Filament again after a stop, as the app does and a Windows host's scheduled task — its row restarts", () => {
  assert.deepEqual(restartWords("systemd"), { label: "Restart Filament", button: "Restart Filament", desc: "Filament stops and systemd starts it again, in a few seconds. Refused while a turn runs, so nothing is cut." });
  assert.equal(restartWords("service").desc, "Filament stops and its scheduled task starts it again, in a few seconds. Refused while a turn runs, so nothing is cut.");
  assert.equal(restartWords("desktop").desc, "Filament stops and the Filament app starts it again, in a few seconds. Refused while a turn runs, so nothing is cut.");
  assert.equal(restartWords(null).label, "Stop Filament");
});
