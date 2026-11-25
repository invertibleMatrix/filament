// @ts-check
// Every machine's Filament updated from the desk (the remote desk's s3d): this Filament's own side — whether it updates
// itself on request, the update started in a unit of systemd's own and how it went (cli/update.js `createSelfUpdate`,
// http/admin/update.js) —, and the desk's — the route called over a machine's picked way with its sign-in, an SSH
// command where its Filament has no such route (desktop/lib/update-there.js).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { UPDATE_RUNNER, UPDATE_SCRIPT, UPDATE_UNIT, createSelfUpdate, unexpanded } from "../src/cli/update.js";
import { tools } from "../src/cli/service.js";
import { updateRoutes } from "../src/http/admin/update.js";
import { SSH_UPDATE_MS, createUpdateThere, updateScript } from "../desktop/lib/update-there.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const made = /** @type {string[]} */ ([]);
after(() => removeDirs(...made));

/** A folder of its own, taken away after. */
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-desk-update-"));
  made.push(d);
  return d;
};

/**
 * Filament for servers as install.sh installs it: `<base>/<version>` with its build-info.json and launcher, `current`
 * pointing at it. → its folder.
 * @param {string} version
 */
function serverBuild(version, target = "linux-x64") {
  const base = join(folder(), "filament");
  const dir = join(base, version);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "build-info.json"), JSON.stringify({ kind: "server", version, target, file: `filament-server-${version}-${target}.tar.gz`, engine: true, releases: { provider: "github", owner: "o", repo: "r" } }));
  // A Windows host's build (install.ps1's): its launcher filament.cmd, its own Node and filament.js beside it.
  if (target.startsWith("win32-")) {
    mkdirSync(join(dir, "node"), { recursive: true });
    for (const f of [join("bin", "filament.cmd"), join("bin", "filament.js"), join("node", "node.exe")]) writeFileSync(join(dir, f), "");
  } else writeFileSync(join(dir, "bin", "filament"), "#!/bin/sh\n");
  symlinkSync(WIN ? dir : version, join(base, "current"), "junction");
  return dir;
}

/** A PATH with a `systemd-run` on it, for the time `fn` takes. @param {() => Promise<void>} fn */
async function withSystemdRun(fn) {
  const bin = folder();
  writeFileSync(join(bin, "systemd-run"), "");
  const was = process.env.PATH;
  process.env.PATH = [bin, String(was || "")].join(delimiter);
  try {
    await fn();
  } finally {
    process.env.PATH = was;
  }
}

/** What the unit's environment holds, for `systemdExpands`. */
const SYSTEMD_ENV = { HOME: "/home/me", PATH: "/usr/local/bin:/usr/bin" };

/**
 * A command's words as systemd hands them to its program (an ExecStart= line's rule, which systemd-run's command
 * follows): a word that is `$NAME` split at whitespace, `${NAME}` its value, `$$` one `$`, any other `$` as it is.
 * @param {string[]} words @param {Record<string, string>} env
 */
const systemdExpands = (words, env) =>
  words.flatMap((w) => {
    const whole = /^\$([A-Za-z_]\w*)$/.exec(w);
    if (whole) return String(env[whole[1]] ?? "").split(/\s+/).filter(Boolean);
    return [w.replace(/\$(\$|\{([A-Za-z_]\w*)\})/g, (_, x, name) => (x === "$" ? "$" : String(env[name] ?? "")))];
  });

/** systemd's tools as a test says: `systemd-run`'s exit and words, whether the unit runs. */
function fakeRun() {
  /** @type {[string, string[]][]} */
  const ran = [];
  const o = {
    ran,
    active: "inactive",
    start: { code: 0, out: "", err: "" },
    /** @param {string} name @param {string[]} args */
    run: async (name, args) => {
      ran.push([name, args]);
      if (name === "systemctl") return { code: o.active === "active" ? 0 : 3, out: o.active, err: "" };
      return o.start;
    },
  };
  return o;
}

describe("this Filament updated on request", () => {
  test("it can where it is a server build systemd runs, with systemd-run; else it says why, in words", async () => {
    const dir = serverBuild("1.0.0");
    const data = folder();
    const f = fakeRun();
    const mk = (/** @type {string | null} */ supervisor, root = dir) => createSelfUpdate({ dataDir: data, supervisor, root: () => root, run: f.run });
    assert.match(String(mk("systemd", process.cwd()).can().why), /runs from a checkout/, "a checkout");
    assert.deepEqual(mk(null).can(), { can: false, why: "Filament 1.0.0 here was started by hand, not by its service: filament update there updates it (filament service install runs it under systemd, a Windows host's scheduled task, or a Mac's launchd).", version: "1.0.0" });
    const was = process.env.PATH;
    process.env.PATH = folder();
    try {
      const none = mk("systemd").can();
      // A system folder of the computer running the tests may hold one.
      if (!none.can) assert.equal(none.why, "There is no systemd-run on this machine's PATH to update Filament with: filament update there updates it.");
    } finally {
      process.env.PATH = was;
    }
    await withSystemdRun(async () => assert.deepEqual(mk("systemd").can(), { can: true, why: null, version: "1.0.0" }));
  });

  // (fails before: yes — s3d: nothing updated a machine's Filament but a person at its terminal)
  test("an update started: filament update --wait --json run by systemd in a unit of its own, its answer kept for once it ends; one runs at a time", async () => {
    const dir = serverBuild("1.0.0");
    const data = folder();
    const f = fakeRun();
    let t = 1_000;
    const u = createSelfUpdate({ dataDir: data, supervisor: "systemd", root: () => dir, run: f.run, now: () => t });
    await withSystemdRun(async () => {
      assert.deepEqual(await u.state(), { running: false, last: null });
      assert.deepEqual(await u.start("v1.1.0"), { ok: true, version: "1.1.0" });
      const [name, args] = /** @type {[string, string[]]} */ (f.ran.find(([n]) => n === "systemd-run"));
      assert.equal(name, "systemd-run");
      // The command line current points at: the version an update waiting to restart installed, where one did.
      assert.deepEqual(args, ["--user", "--collect", "--quiet", `--unit=${UPDATE_UNIT}`, "--", "/bin/sh", "-c", unexpanded(UPDATE_SCRIPT), "sh", join(data, "update", "last"), join(dirname(dir), "current", "bin", "filament"), "--data-dir", data, "update", "--version", "1.1.0", "--wait", "--json"]);
      f.active = "active";
      assert.deepEqual(await u.state(), { running: true, last: { version: "1.1.0", at: 1_000, code: null, report: null, words: "" } });
      await assert.rejects(u.start("1.1.0"), { status: 409, message: "An update runs here already: it says how it went once it ends." });
      // It ended: what it said, read as this Filament runs again.
      f.active = "inactive";
      writeFileSync(join(data, "update", "last.json"), JSON.stringify({ result: "updated", version: "1.1.0", restart: "systemd", said: [] }));
      writeFileSync(join(data, "update", "last.code"), "0\n");
      assert.deepEqual((await u.state()).last, { version: "1.1.0", at: 1_000, code: 0, report: { result: "updated", version: "1.1.0", restart: "systemd", said: [] }, words: "" });
      // The newest, where none is named; the last one's answer let go as it starts.
      t = 2_000;
      f.ran.length = 0;
      assert.deepEqual(await u.start(null), { ok: true, version: null });
      assert.ok(!f.ran.find(([n]) => n === "systemd-run")?.[1].includes("--version"));
      assert.deepEqual((await u.state()).last, { version: null, at: 2_000, code: null, report: null, words: "" });
      // A failure's words, cut to their end.
      writeFileSync(join(data, "update", "last.log"), `${"x".repeat(5000)}\nFilament 1.2.0 did not come up — so current points at 1.0.0 again.`);
      writeFileSync(join(data, "update", "last.code"), "1");
      const last = /** @type {any} */ ((await u.state()).last);
      assert.equal(last.code, 1);
      assert.match(last.words, /^….*so current points at 1\.0\.0 again\.$/s);
      assert.equal(last.words.length, 4001);
    });
  });

  // (fails before: yes — s3f7: a Windows host's Filament, run by its scheduled task, could not be updated from the desk:
  // it asked for systemd-run)
  test("on a Windows host run by its scheduled task: filament update --wait --json started apart by the build's own Node, its pid kept; one runs at a time; one that could not start, said, nothing left behind", async () => {
    const dir = serverBuild("1.0.0", "win32-x64");
    const data = folder();
    const f = fakeRun();
    /** @type {[string, string[]][]} */
    const launched = [];
    // An update under way: a process that runs.
    const busy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      const u = createSelfUpdate({ dataDir: data, supervisor: "service", root: () => dir, run: f.run, now: () => 1_000, launch: (file, args) => (launched.push([file, args]), Number(busy.pid)) });
      assert.deepEqual(u.can(), { can: true, why: null, version: "1.0.0" }, "no systemd-run asked for");
      assert.deepEqual(await u.state(), { running: false, last: null });
      assert.deepEqual(await u.start("1.1.0"), { ok: true, version: "1.1.0" });
      const current = join(dirname(dir), "current");
      const node = join(current, "node", "node.exe");
      assert.deepEqual(launched, [[node, ["-e", UPDATE_RUNNER, join(data, "update", "last"), node, join(current, "bin", "filament.js"), "--data-dir", data, "update", "--version", "1.1.0", "--wait", "--json"]]]);
      assert.deepEqual(f.ran, [], "nothing of systemd's");
      assert.equal(JSON.parse(readFileSync(join(data, "update", "last.started"), "utf8")).pid, busy.pid);
      assert.deepEqual(await u.state(), { running: true, last: { version: "1.1.0", at: 1_000, code: null, report: null, words: "" } });
      await assert.rejects(u.start("1.1.0"), { status: 409, message: "An update runs here already: it says how it went once it ends." });
      // Its exit code kept: it ended, whatever runs under that pid now.
      writeFileSync(join(data, "update", "last.code"), "0");
      assert.equal((await u.state()).running, false);
      const failing = createSelfUpdate({ dataDir: data, supervisor: "service", root: () => dir, run: f.run, launch: () => { throw new Error("spawn EACCES"); } });
      await assert.rejects(failing.start("1.1.0"), { status: 502, message: "The update could not be started: spawn EACCES" });
      assert.equal(existsSync(join(data, "update", "last.started")), false, "nothing said started");
    } finally {
      busy.kill();
    }
  });

  // (fails before: yes — a Mac's Filament, run by launchd's runner, was started apart by a Windows host's node.exe,
  // which a Mac's build has not)
  test("on a Mac run by launchd: filament update --wait --json started apart (a session of its own) by the build's own Node, node/bin/node, never by systemd-run", async () => {
    const dir = serverBuild("1.0.0", "darwin-arm64");
    const data = folder();
    const f = fakeRun();
    /** @type {[string, string[]][]} */
    const launched = [];
    const was = tools.platform;
    tools.platform = "darwin";
    try {
      const u = createSelfUpdate({ dataDir: data, supervisor: "service", root: () => dir, run: f.run, now: () => 1_000, launch: (file, args) => (launched.push([file, args]), 4242) });
      assert.deepEqual(u.can(), { can: true, why: null, version: "1.0.0" }, "no systemd-run asked for");
      assert.deepEqual(await u.start(), { ok: true, version: null });
      const current = join(dirname(dir), "current");
      const node = join(current, "node", "bin", "node");
      assert.deepEqual(launched, [[node, ["-e", UPDATE_RUNNER, join(data, "update", "last"), node, join(current, "bin", "filament.js"), "--data-dir", data, "update", "--wait", "--json"]]]);
      assert.deepEqual(f.ran, [], "nothing of systemd's");
      assert.equal(JSON.parse(readFileSync(join(data, "update", "last.started"), "utf8")).pid, 4242);
    } finally {
      tools.platform = was;
    }
  });

  test("a Windows host's update runner: the command after its file run, its answer kept beside it — what it printed, its words, its exit code; a program that is none, said", () => {
    const d = folder();
    const last = join(d, "last");
    const r = spawnSync(process.execPath, ["-e", UPDATE_RUNNER, last, process.execPath, "-e", 'console.log(JSON.stringify({ result: "updated" })); console.error("its words"); process.exit(3)'], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${last}.json`, "utf8")), { result: "updated" });
    assert.equal(readFileSync(`${last}.log`, "utf8").trim(), "its words");
    assert.equal(readFileSync(`${last}.code`, "utf8"), "3");
    const none = spawnSync(process.execPath, ["-e", UPDATE_RUNNER, last, join(d, "no-such-program.exe")], { encoding: "utf8" });
    assert.equal(none.status, 0, none.stderr);
    assert.match(readFileSync(`${last}.log`, "utf8"), /ENOENT/);
    assert.equal(readFileSync(`${last}.code`, "utf8"), "1");
  });

  test("refused in words: a version that is none, the one that runs, where it cannot, and a start systemd refused — nothing left behind", async () => {
    const dir = serverBuild("1.0.0");
    const data = folder();
    const f = fakeRun();
    const u = createSelfUpdate({ dataDir: data, supervisor: "systemd", root: () => dir, run: f.run });
    await withSystemdRun(async () => {
      await assert.rejects(u.start("1.2"), { status: 400, message: "version takes a release's version: 1.2.3" });
      await assert.rejects(u.start("1.0.0"), { status: 409, message: "Filament 1.0.0 runs here already: nothing to update." });
      f.start = { code: 1, out: "", err: "Failed to start transient service unit: Unit filament-update.service already exists.\nmore" };
      await assert.rejects(u.start("1.1.0"), { status: 502, message: "systemd-run did not start the update: Failed to start transient service unit: Unit filament-update.service already exists." });
      assert.equal(existsSync(join(data, "update", "last.started")), false, "nothing said started");
    });
    await assert.rejects(createSelfUpdate({ dataDir: data, supervisor: null, root: () => dir, run: f.run }).start("1.1.0"), { status: 409, message: /started by hand/ });
    // Never to an older version than the one that runs.
    await withSystemdRun(async () => assert.rejects(u.start("0.9.0"), { status: 409, message: "Filament 1.0.0 runs here, newer than 0.9.0: filament update --version 0.9.0 there goes back to it." }));
  });

  // (fails before: yes — the review of s3d: once current moved to the new version, the Filament still running the one
  // before said it was no install, ran no update and said none ran)
  test("while an update waits to restart — current moved to the new version —: it can still, says the update runs, and starts none beside it", async () => {
    const dir = serverBuild("1.0.0");
    const base = dirname(dir);
    mkdirSync(join(base, "1.1.0", "bin"), { recursive: true });
    writeFileSync(join(base, "1.1.0", "build-info.json"), JSON.stringify({ kind: "server", version: "1.1.0", target: "linux-x64", file: "filament-server-1.1.0-linux-x64.tar.gz", engine: true, releases: { provider: "github", owner: "o", repo: "r" } }));
    unlinkSync(join(base, "current"));
    symlinkSync(WIN ? join(base, "1.1.0") : "1.1.0", join(base, "current"), "junction");
    const data = folder();
    const f = fakeRun();
    f.active = "active";
    const u = createSelfUpdate({ dataDir: data, supervisor: "systemd", root: () => dir, run: f.run });
    await withSystemdRun(async () => {
      assert.deepEqual(u.can(), { can: true, why: null, version: "1.0.0" });
      assert.equal((await u.state()).running, true);
      await assert.rejects(u.start("1.1.0"), { status: 409, message: "An update runs here already: it says how it went once it ends." });
      assert.equal(f.ran.filter(([n]) => n === "systemd-run").length, 0);
    });
    // (fails before: yes — the review of s3d: its unit ended with the restart let go, a version older than the one
    // current points at was installed over it, as newer than the one that runs)
    // (and the review of x30) Nor a newer one: it would prune the folder of the Filament that runs.
    f.active = "inactive";
    await withSystemdRun(async () => {
      for (const other of ["1.0.5", "1.0.0", "1.2.0", null])
        await assert.rejects(u.start(other), { status: 409, message: "Filament 1.1.0 is installed here, and current points at it (1.0.0 runs until it restarts): filament restart there starts 1.1.0, and an update goes on from there." });
      assert.equal(f.ran.filter(([n]) => n === "systemd-run").length, 0);
      assert.deepEqual(await u.start("1.1.0"), { ok: true, version: "1.1.0" }, "the one current points at: its update restarts on it");
    });
    // A folder beside it that is no server build is not taken for its install.
    rmSync(join(base, "1.1.0", "build-info.json"));
    assert.match(String(u.can().why), /is not where install\.sh installs it/);
  });

  // (fails before: yes — the review of s3d: what systemd-run was handed went through systemd's own `$` expansion, so a
  // data folder whose name holds `${…}` or `$$` reached the update as another; the script itself had none to lose)
  test("what systemd hands the unit's shell is each word as written: every `$` doubled for its expansion, the script's and a folder's name's", async () => {
    const dir = serverBuild("1.0.0");
    const data = join(folder(), "data $HOME ${PATH} $$ end");
    mkdirSync(data);
    const f = fakeRun();
    const u = createSelfUpdate({ dataDir: data, supervisor: "systemd", root: () => dir, run: f.run });
    await withSystemdRun(async () => void (await u.start("1.1.0")));
    const args = /** @type {string[]} */ (f.ran.find(([n]) => n === "systemd-run")?.[1]);
    const command = args.slice(args.indexOf("--") + 1);
    const plain = ["/bin/sh", "-c", UPDATE_SCRIPT, "sh", join(data, "update", "last"), join(dirname(dir), "current", "bin", "filament"), "--data-dir", data, "update", "--version", "1.1.0", "--wait", "--json"];
    assert.deepEqual(systemdExpands(command, SYSTEMD_ENV), plain);
    assert.notDeepEqual(systemdExpands(plain, SYSTEMD_ENV), plain, "handed as written, the folder's name is another by the time it runs");
  });

  test("what the unit runs keeps the update's lines, its words and its exit code beside the name it is given", { skip: spawnSync("sh", ["-c", "true"]).status !== 0 && "no sh here" }, () => {
    const at = join(folder(), "a $HOME ${PATH} $$ b", "last");
    mkdirSync(dirname(at));
    // As systemd hands it on: its `$` expansion taken back.
    const words = systemdExpands(["-c", UPDATE_SCRIPT, "sh", at, process.execPath, "-e", "console.log('{\"result\":\"updated\"}'); console.error('said'); process.exit(3)"].map(unexpanded), SYSTEMD_ENV);
    const p = spawnSync("sh", words, { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual([readFileSync(`${at}.json`, "utf8"), readFileSync(`${at}.log`, "utf8"), readFileSync(`${at}.code`, "utf8").trim()], ['{"result":"updated"}\n', "said\n", "3"]);
  });

  test("its rows: GET says whether it can and how the last went; POST starts one, 202, or says why not", async () => {
    /** A row's answer to a request. @param {any} a @param {string} method @param {any} [body] */
    const call = async (a, method, body) => {
      const row = updateRoutes(a).find((x) => x[0] === method && x[1] === "/update");
      /** @type {{ status: number, body: any }} */
      const got = { status: 0, body: null };
      const res = { writableEnded: false, destroyed: false, writeHead: (/** @type {number} */ s) => void (got.status = s), end: (/** @type {string} */ b) => void (got.body = JSON.parse(b)) };
      await /** @type {any} */ (row)[2]({ res, json: async () => body ?? null });
      return got;
    };
    assert.deepEqual(await call({}, "GET"), { status: 200, body: { can: false, why: "This Filament does not update itself on request: filament update there updates it.", version: null, running: false, last: null } });
    assert.deepEqual(await call({}, "POST", { version: "1.1.0" }), { status: 409, body: { error: "This Filament does not update itself on request: filament update there updates it." } });
    /** @type {any[]} */
    const asked = [];
    const selfUpdate = {
      can: () => ({ can: true, why: null, version: "1.0.0" }),
      state: async () => ({ running: false, last: null }),
      start: async (/** @type {any} */ v) => {
        asked.push(v);
        if (v === "9.9.9") throw Object.assign(new Error("no such release"), { status: 409 });
        return { ok: true, version: v };
      },
    };
    assert.deepEqual(await call({ selfUpdate }, "GET"), { status: 200, body: { can: true, why: null, version: "1.0.0", running: false, last: null } });
    assert.deepEqual(await call({ selfUpdate }, "POST", { version: "1.1.0" }), { status: 202, body: { ok: true, version: "1.1.0" } });
    assert.deepEqual(await call({ selfUpdate }, "POST", {}), { status: 202, body: { ok: true, version: null } });
    assert.deepEqual(await call({ selfUpdate }, "POST", { version: "9.9.9" }), { status: 409, body: { error: "no such release" } });
    assert.deepEqual(asked, ["1.1.0", null, "9.9.9"]);
  });
});

describe("another machine's Filament updated from the desk", () => {
  const WAY = { kind: "url", url: "https://box.tail1234.ts.net" };
  const SSH = { kind: "ssh", url: "http://127.0.0.1:41234", alias: "me@box", port: 20300 };
  /** @param {any[]} [routes] */
  const box = (routes = [WAY]) => /** @type {any} */ ({ id: "m-box", name: "Workstation", routes, partition: "persist:machine-m-box", addedAt: 0 });
  /**
   * The desk's update over fakes: the way picked (`picked`), what the route answers (`answer`: its status and body, or
   * a throw), what SSH does. @param {{ picked?: any, answer?: { status: number, body: any } | Error, run?: any }} o
   */
  function desk({ picked = { route: WAY, version: "0.9.0", tried: [] }, answer = { status: 200, body: {} }, run = { code: 0, stdout: "", stderr: "" } } = {}) {
    /** @type {any[]} */
    const calls = [];
    /** @type {any[]} */
    const ssh = [];
    /** @type {any[]} */
    const cookies = [];
    const u = createUpdateThere({
      pick: async () => picked,
      cookieOf: async (p, origin) => (cookies.push([p, origin]), "__Host-filament_device=d1"),
      fetchOf: (route) =>
        /** @type {any} */ (
          async (/** @type {string} */ url, /** @type {any} */ init) => {
            calls.push({ via: route.url, url, method: init.method, headers: init.headers, body: init.body ?? null, redirect: init.redirect });
            if (answer instanceof Error) throw answer;
            return { status: answer.status, json: async () => answer.body };
          }
        ),
      ssh: /** @type {any} */ (async (/** @type {string} */ alias, /** @type {any} */ what, /** @type {any} */ o) => (ssh.push([alias, what, o]), run)),
    });
    return { u, calls, ssh, cookies };
  }
  const LOOK = { can: true, why: null, version: "0.9.0", running: false, last: null };

  // (fails before: yes — s3d: nothing here updated another machine's Filament)
  test("asked of its own Filament at the way picked, with the sign-in its partition holds, nothing followed elsewhere", async () => {
    const d = desk({ answer: { status: 200, body: LOOK } });
    assert.deepEqual(await d.u.look(box()), LOOK);
    d.calls.length = 0;
    const s = desk({ answer: { status: 202, body: { ok: true, version: "1.0.0" } } });
    assert.deepEqual(await s.u.start(box(), "1.0.0"), { ok: true, version: "1.0.0" });
    assert.deepEqual(s.calls, [
      {
        via: WAY.url,
        url: "https://box.tail1234.ts.net/api/update",
        method: "POST",
        headers: { "x-filament-ui": "1", cookie: "__Host-filament_device=d1", "content-type": "application/json" },
        body: '{"version":"1.0.0"}',
        redirect: "manual",
      },
    ]);
    assert.deepEqual(s.cookies, [["persist:machine-m-box", "https://box.tail1234.ts.net"]]);
    // One on a wire this app does not speak: the update is how it comes to, so its way is taken all the same.
    const gap = desk({ picked: { route: null, version: "0.9.0", tried: [{ why: "too old" }], update: { side: "there", route: WAY } }, answer: { status: 202, body: { ok: true, version: "1.0.0" } } });
    assert.deepEqual(await gap.u.start(box(), "1.0.0"), { ok: true, version: "1.0.0" });
    assert.equal(gap.calls[0].url, "https://box.tail1234.ts.net/api/update");
  });

  test("refused in words: a version that is none, no way that answers, its own refusal, a sign-in it does not take, no answer", async () => {
    assert.deepEqual(await desk().u.start(box(), "latest"), { ok: false, words: "latest is no release's version." });
    const none = desk({ picked: { route: null, version: null, tried: [{ why: "nothing listens" }] } });
    assert.deepEqual(await none.u.start(box(), "1.0.0"), { ok: false, words: "Workstation does not answer: nothing listens." });
    assert.deepEqual(await none.u.look(box()), { words: "Workstation does not answer: nothing listens." });
    assert.deepEqual(none.calls, [], "nothing asked");
    const busy = desk({ answer: { status: 409, body: { error: "An update runs here already: it says how it went once it ends." } } });
    assert.deepEqual(await busy.u.start(box(), "1.0.0"), { ok: false, words: "An update runs here already: it says how it went once it ends." });
    const out = desk({ answer: { status: 401, body: { error: "sign in" } } });
    assert.match(String(/** @type {any} */ (await out.u.start(box(), "1.0.0")).words), /^Workstation did not let this window in \(HTTP 401\): pair it again/);
    // Never to the version it runs, nor an older one: nothing asked of it.
    const same = desk({ picked: { route: WAY, version: "1.0.0", tried: [] } });
    assert.deepEqual(await same.u.start(box(), "1.0.0"), { ok: false, words: "Workstation runs Filament 1.0.0 already." });
    const newer = desk({ picked: { route: WAY, version: "1.1.0", tried: [] } });
    assert.deepEqual(await newer.u.start(box(), "1.0.0"), { ok: false, words: "Workstation runs Filament 1.1.0, newer than 1.0.0: nothing to update." });
    assert.deepEqual([...same.calls, ...newer.calls], []);
    const cut = desk({ answer: new Error("socket hang up") });
    assert.deepEqual(await cut.u.start(box(), "1.0.0"), { ok: false, words: "Workstation did not answer (socket hang up)" });
    assert.deepEqual(await cut.u.look(box()), { words: "Workstation did not answer (socket hang up)" });
  });

  test("a Filament from before the route: updated over SSH where it is kept with an SSH way, else told to be in words", async () => {
    const old = { status: 404, body: { error: "not found" } };
    const bare = desk({ answer: old });
    assert.deepEqual(await bare.u.look(box()), { can: false, why: "Workstation's Filament (0.9.0) is from before updates from this app: filament update there updates it.", version: "0.9.0", running: false, last: null, old: true });
    assert.deepEqual(await bare.u.start(box(), "1.0.0"), { ok: false, words: "Workstation's Filament (0.9.0) is from before updates from this app: filament update there updates it." });
    assert.deepEqual(bare.ssh, []);
    const said = (/** @type {any} */ report) => ({ code: 0, stdout: JSON.stringify({ ...report, said: [] }, null, 2), stderr: "" });
    const over = desk({ answer: old, run: said({ result: "updated", version: "1.0.0", restart: "systemd" }) });
    assert.equal(/** @type {any} */ (await over.u.look(box([WAY, SSH]))).can, true);
    assert.deepEqual(await over.u.start(box([WAY, SSH]), "1.0.0"), { ok: true, version: "1.0.0", ssh: true });
    assert.deepEqual(over.ssh, [["me@box", { script: 'case ${XDG_DATA_HOME:-} in /*) d=$XDG_DATA_HOME ;; *) d=$HOME/.local/share ;; esac; f="$d/filament/current/bin/filament"; [ -x "$f" ] || f="$HOME/.local/bin/filament"; [ -x "$f" ] || f=filament; exec "$f" update --version 1.0.0 --json' }, { timeoutMs: SSH_UPDATE_MS }]]);
    // (the review of s3d) Done only once systemd's Filament restarted on it: installed and not restarted on, said as it stands.
    const stands = async (/** @type {any} */ report) => desk({ answer: old, run: said(report) }).u.start(box([WAY, SSH]), "1.0.0");
    assert.deepEqual(await stands({ result: "installed", installed: "1.0.0" }), { ok: false, installed: true, words: "Filament 1.0.0 is installed on Workstation, and its Filament runs on: filament restart there starts it." });
    assert.deepEqual(await stands({ result: "updated", restart: "not-running" }), { ok: false, installed: true, words: "Filament 1.0.0 is installed on Workstation, where no Filament runs now: it runs 1.0.0 at its next start." });
    assert.deepEqual(await stands({ result: "updated", restart: "by-hand" }), { ok: false, installed: true, words: "Filament 1.0.0 is installed on Workstation, whose Filament was started by hand: it runs 1.0.0 once it is started again there." });
    // (s3f7) Restarted by a Windows host's scheduled task: done, as systemd's restart is.
    assert.deepEqual(await stands({ result: "updated", version: "1.0.0", restart: "service" }), { ok: true, version: "1.0.0", ssh: true });
    // Its ways of failing, each in words: a turn runs there, ssh asks what only the person can answer, its own words.
    const busy = desk({ answer: old, run: { code: 5, stdout: "", stderr: "…" } });
    assert.deepEqual(await busy.u.start(box([WAY, SSH]), "1.0.0"), { ok: false, installed: true, words: "Filament 1.0.0 is installed on Workstation, and its Filament runs on while a turn runs there: Update again once it ends restarts it on 1.0.0." });
    const key = desk({ answer: old, run: { code: 255, stdout: "", stderr: "", ask: "host-key", why: "ssh does not know me@box's host key" } });
    assert.deepEqual(await key.u.start(box([WAY, SSH]), "1.0.0"), { ok: false, words: "ssh me@box asks for its host key to be trusted: run filament update there in a terminal (ssh me@box)." });
    const failed = desk({ answer: old, run: { code: 1, stdout: "", stderr: "Downloading…\nGitHub was not reached (ENOTFOUND): nothing changed.\n" } });
    assert.deepEqual(await failed.u.start(box([WAY, SSH]), "1.0.0"), { ok: false, words: "GitHub was not reached (ENOTFOUND): nothing changed." });
  });

  // (fails before: yes — the review of s3d: over SSH it ran ~/.local/bin/filament alone, so a Filament on the PATH
  // there, put elsewhere than install.sh puts it, was never found)
  test("over SSH, Filament as install.sh put it, else the one on the PATH there, as a pairing over SSH finds it", { skip: spawnSync("sh", ["-c", "true"]).status !== 0 && "no sh here" }, () => {
    const home = folder();
    const bin = folder();
    writeFileSync(join(bin, "filament"), '#!/bin/sh\necho "on the PATH: $*"\n', { mode: 0o755 });
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env, HOME: home, PATH: [bin, String(process.env.PATH || "")].join(delimiter) };
    delete env.XDG_DATA_HOME;
    const ran = () => spawnSync("sh", ["-c", updateScript("1.0.0")], { env, encoding: "utf8" }).stdout.trim();
    assert.equal(ran(), "on the PATH: update --version 1.0.0 --json");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "filament"), '#!/bin/sh\necho "its command: $*"\n', { mode: 0o755 });
    assert.equal(ran(), "its command: update --version 1.0.0 --json");
    // (the review of x30) Its folder of versions first: a file of the person's own may stand in ~/.local/bin.
    mkdirSync(join(home, ".local", "share", "filament", "current", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "share", "filament", "current", "bin", "filament"), '#!/bin/sh\necho "installed: $*"\n', { mode: 0o755 });
    assert.equal(ran(), "installed: update --version 1.0.0 --json");
  });
});
