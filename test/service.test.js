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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { writeListening } from "../src/cli/listening.js";
import { EXIT } from "../src/cli/client.js";
import { runCli } from "../src/cli/main.js";
import { launcherOf, startUnit, tools, unitText, unitWords } from "../src/cli/service.js";
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

  test("refused in words: on macOS and Windows (the app runs Filament there), with no systemctl, where the user manager does not answer, for another machine", async () => {
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
      const mac = await m.run(["service", "install"]);
      assert.equal(mac.code, EXIT.failed);
      assert.match(mac.err, /on a Mac the Filament app runs it, and starts it at logon/);
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      assert.match((await m.run(["service", "status"])).err, /on Windows the Filament app runs it/);
    } finally {
      Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    }
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
    if (was === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = was;
    await removeDirs(dir);
  }
});

test("Settings › About: systemd starts Filament again after a stop, as the app does — its row restarts", () => {
  assert.deepEqual(restartWords("systemd"), { label: "Restart Filament", button: "Restart Filament", desc: "Filament stops and systemd starts it again, in a few seconds. Refused while a turn runs, so nothing is cut." });
  assert.equal(restartWords("desktop").desc, "Filament stops and the Filament app starts it again, in a few seconds. Refused while a turn runs, so nothing is cut.");
  assert.equal(restartWords(null).label, "Stop Filament");
});
