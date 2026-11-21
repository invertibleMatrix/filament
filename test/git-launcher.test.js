// @ts-check
// On Windows the PATH's git is mostly Git for Windows' launcher (`<prefix>\cmd\git.exe`), which starts the real git
// (`<prefix>\mingw64\bin\git.exe`) as a process of its own: a stop or a timeout ended the launcher, and the real git
// lived on past its call's answer — holding the files it read, which an Apply then could not replace, and answering
// into a call already answered (the measure of 11-03). `git()` and `gitBytes` start the real git there, given the
// environment the launcher gives it, so a hook, an `!sh` alias and a filter run as they did; a machine whose git is not
// that launcher keeps its git as the PATH names it. Every repository and folder here is a throwaway.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { baseEnv, git, gitProgram } from "../src/adapters/git/snapshot.js";
import { changedFiles } from "../src/adapters/git/worktree.js";

/** The launcher the PATH names, and the real git beside it — or null where the PATH's git is not that launcher. */
const place = (() => {
  if (process.platform !== "win32") return null;
  try {
    const onPath = execFileSync("where.exe", ["git"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0].trim();
    const core = resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true }).trim());
    const mingw = dirname(dirname(core));
    const prefix = dirname(mingw);
    const real = join(mingw, "bin", "git.exe");
    const launcher = [join(prefix, "cmd", "git.exe"), join(prefix, "bin", "git.exe")].find((l) => l.toLowerCase() === onPath.toLowerCase());
    return launcher && existsSync(real) ? { launcher, real, mingw } : null;
  } catch {
    return null;
  }
})();
const skip = !place && "the PATH's git is not Git for Windows' launcher";
const LAUNCHER = place?.launcher ?? "";
const REAL = place?.real ?? "";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} what */
const folder = (what) => {
  const dir = mkdtempSync(join(tmpdir(), `filament-launcher-${what}-`));
  made.push(dir);
  return dir;
};
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
const repo = () => {
  const dir = folder("repo");
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};
/** The programs the pool started while `go` ran, as told on its channel. @template T @param {() => Promise<T>} go */
const startedBy = async (go) => {
  /** @type {string[]} */
  const files = [];
  const on = (/** @type {any} */ m) => void (m.event === "start" && files.push(String(m.file)));
  subscribe(SPAWN_CHANNEL, on);
  try {
    return { out: await go(), files };
  } finally {
    unsubscribe(SPAWN_CHANNEL, on);
  }
};

// (fails before: yes — both started `git`, the PATH's launcher)
test("git() and gitBytes start the real git beside the PATH's launcher", { skip }, async () => {
  // Found once, with the launcher's own `--exec-path`: then every call starts the real git.
  assert.equal((await gitProgram()).file, REAL);
  const dir = repo();
  const head = run(dir, ["rev-parse", "HEAD"]);
  writeFileSync(join(dir, "a.txt"), "two\n");
  run(dir, ["commit", "-qam", "two"]);
  const viaGit = await startedBy(() => git(["rev-parse", "HEAD"], { cwd: dir }));
  assert.equal(viaGit.out.code, 0);
  const viaBytes = await startedBy(() => changedFiles(dir, head, "HEAD"));
  assert.deepEqual(viaBytes.out.map((f) => f.path), ["a.txt"]);
  assert.deepEqual([...new Set([...viaGit.files, ...viaBytes.files])], [REAL]);
});

/** Whether a program stands in `dir` — a git still running there holds it as its folder, and it cannot be renamed. @param {string} dir */
const held = (dir) => {
  try {
    renameSync(dir, `${dir}-moved`);
    renameSync(`${dir}-moved`, dir);
    return false;
  } catch {
    return true;
  }
};

// (fails before: yes — 25 calls stopped together, each in a folder of its own, left 10 to 26 of 75 folders held by a
// git past its call's answer, for up to tens of milliseconds: the real git outlived its launcher)
test("a stopped call leaves no git behind: its folder is free the moment it is answered", { skip }, async () => {
  /** @type {string[]} */
  const left = [];
  for (const wait of [0, 20, 300]) {
    const calls = Array.from({ length: 25 }, () => {
      const dir = folder("stopped");
      const stop = new AbortController();
      return { dir, stop, done: git(["hash-object", "--stdin"], { cwd: dir, signal: stop.signal }) };
    });
    if (wait) await new Promise((r) => setTimeout(r, wait));
    for (const c of calls) c.stop.abort();
    await Promise.all(
      calls.map(async (c) => {
        const r = await c.done;
        assert.match(String(r.error), /was abandoned/);
        if (held(c.dir)) left.push(`${c.dir} (stopped after ${wait} ms)`);
      }),
    );
  }
  assert.deepEqual(left, [], `${left.length} of 75 folders held past their call's answer`);
});

// (fails before: yes — the same: the real git, its launcher timed out, read its input's end and answered into the call)
test("a call past its time answers with nothing its git said after: a timed-out git is gone with it", { skip }, async () => {
  const dir = folder("timeout");
  const all = await Promise.all(Array.from({ length: 40 }, () => git(["hash-object", "--stdin"], { cwd: dir, timeoutMs: 1000 })));
  assert.deepEqual(
    all.filter((r) => r.out !== "" || !r.timedOut).map((r) => r.out),
    [],
  );
});

/** What a program git starts for an alias sees in its environment, git asked through `gitAt`. @param {(args: string[]) => string} gitAt */
const envSeen = (gitAt) => JSON.parse(gitAt(["-c", "alias.env=!node", "env", "-e", "process.stdout.write(JSON.stringify(process.env))"]));

/** An environment by its variables' names in capitals: Windows' variables have no case. @param {Record<string, string | undefined>} env */
const byName = (env) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k.toUpperCase(), v]));

test("the real git is given the environment its launcher gives it, variable by variable", { skip }, async () => {
  const dir = folder("env");
  // Node for the alias, first on the PATH both are given.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const withNode = `${dirname(process.execPath)};${process.env[pathKey]}`;
  const env = { ...baseEnv(), [pathKey]: withNode };
  /** The same name in another spelling. */
  const alt = pathKey === "PATH" ? "Path" : "PATH";
  /** @type {{ what: string, launcher: (e: Record<string, string | undefined>) => Record<string, string | undefined>, given: Record<string, string | undefined> }[]} */
  const cases = [
    { what: "nothing set", launcher: (e) => e, given: {} },
    { what: "MSYS set", launcher: (e) => ({ ...e, MSYS: "winsymlinks:nativestrict" }), given: { MSYS: "winsymlinks:nativestrict" } },
    { what: "HOME set", launcher: (e) => ({ ...e, HOME: dir }), given: { HOME: dir } },
    { what: "PLINK_PROTOCOL set", launcher: (e) => ({ ...e, PLINK_PROTOCOL: "plink" }), given: { PLINK_PROTOCOL: "plink" } },
    { what: "MSYSTEM set", launcher: (e) => ({ ...e, MSYSTEM: "MSYS" }), given: { MSYSTEM: "MSYS" } },
    {
      what: "HOME unset",
      launcher: (e) => Object.fromEntries(Object.entries(e).filter(([k]) => k.toUpperCase() !== "HOME")),
      given: { HOME: undefined },
    },
    // (fails before: yes — the review of 11-03: the launcher's folders went on the first spelling of PATH, and the
    // process was handed the other, as Node picks one: the real git ran without sh, its filters and hooks broken)
    {
      what: "PATH given in another spelling",
      launcher: (e) => ({ ...Object.fromEntries(Object.entries(e).filter(([k]) => k.toUpperCase() !== "PATH")), [alt]: withNode }),
      given: { [pathKey]: process.env[pathKey], [alt]: withNode },
    },
  ];
  for (const c of cases) {
    const viaLauncher = byName(envSeen((args) => execFileSync(LAUNCHER, ["-c", "core.fsmonitor=false", ...args], { cwd: dir, encoding: "utf8", env: c.launcher(env), windowsHide: true })));
    const given = /** @type {Record<string, string>} */ ({ [pathKey]: withNode, ...c.given });
    const r = await git(["-c", "alias.env=!node", "env", "-e", "process.stdout.write(JSON.stringify(process.env))"], { cwd: dir, env: given });
    assert.equal(r.code, 0, r.err);
    const viaFilament = byName(JSON.parse(r.out));
    const keys = [...new Set([...Object.keys(viaLauncher), ...Object.keys(viaFilament)])];
    assert.deepEqual(
      keys.filter((k) => viaLauncher[k] !== viaFilament[k]).map((k) => `${k}: ${viaFilament[k]} where the launcher gives ${viaLauncher[k]}`),
      [],
      c.what,
    );
  }
});

/** What a script prints, run with `env` in a Node process of its own: a process's git is looked for once. @param {string} script @param {Record<string, string | undefined>} env */
const fresh = (script, env = process.env) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env, windowsHide: true, timeout: 60_000 });
const SNAPSHOT = pathToFileURL(join(import.meta.dirname, "..", "src", "adapters", "git", "snapshot.js")).href;
const POOL = pathToFileURL(join(import.meta.dirname, "..", "src", "adapters", "git", "spawn-pool.js")).href;

test("the launcher in Git for Windows' `bin` folder, the PATH's git, is seen as the launcher too", { skip }, () => {
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const bin = join(dirname(dirname(LAUNCHER)), "bin");
  const out = fresh(`const { gitProgram } = await import(${JSON.stringify(SNAPSHOT)}); process.stdout.write((await gitProgram()).file);`, { ...process.env, [pathKey]: `${bin};${process.env[pathKey]}` });
  assert.equal(out, REAL);
});

// (fails before: yes — the review of 11-03: a look that failed once — its launcher's `--exec-path` not answered — left
// the launcher started for the process's life)
test("a look that fails falls back on the PATH's git for a while, and the next call after that looks again", { skip }, () => {
  const dir = folder("look");
  // The temp folder gone, where the pool's threads write what git says: the look's own git cannot run.
  const nowhere = join(dir, "no-such-folder");
  const script = `
    const { gitProgram } = await import(${JSON.stringify(SNAPSHOT)});
    const was = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    Object.assign(process.env, { TEMP: ${JSON.stringify(nowhere)}, TMP: ${JSON.stringify(nowhere)}, TMPDIR: ${JSON.stringify(nowhere)} });
    const failed = (await gitProgram()).file;
    for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    const soon = (await gitProgram()).file;
    await new Promise((r) => setTimeout(r, 10_500));
    // The look made again runs beside the calls: what it finds stands once it answers.
    let later = (await gitProgram()).file;
    for (let i = 0; i < 200 && later !== ${JSON.stringify(REAL)}; i++) {
      await new Promise((r) => setTimeout(r, 50));
      later = (await gitProgram()).file;
    }
    process.stdout.write(JSON.stringify({ failed, soon, later }));`;
  assert.deepEqual(JSON.parse(fresh(script)), { failed: "git", soon: "git", later: REAL });
});

// (fails before: yes — the review of round 3: a look made again after one failed was waited for by every call, most of
// which cannot be stopped — a look that hung held every git of Filament's, up to git's own 60 s and the pool's margin)
test("a look made again that hangs holds no call: calls go on with the PATH's git, and what it finds stands once it answers", { skip }, () => {
  const dir = folder("hang");
  const nowhere = join(dir, "no-such-folder");
  const faults = pathToFileURL(join(import.meta.dirname, "helpers", "git-fault.js")).href;
  const script = `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The look's git held where it ends, on the pool's threads: armed before they start.
    const armed = (await import(${JSON.stringify(faults)})).gitFaultsHere();
    const { git, gitProgram } = await import(${JSON.stringify(SNAPSHOT)});
    const was = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    Object.assign(process.env, { TEMP: ${JSON.stringify(nowhere)}, TMP: ${JSON.stringify(nowhere)}, TMPDIR: ${JSON.stringify(nowhere)} });
    const failed = (await gitProgram()).file;
    for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    await sleep(10_500);
    const look = armed.arm({ match: { has: ["--exec-path"] }, hold: true });
    const asked = git(["--version"], { cwd: ${JSON.stringify(dir)} });
    const r = await Promise.race([asked, sleep(5_000).then(() => "late")]);
    const lookHeld = await Promise.race([look.reached.then(() => true), sleep(5_000).then(() => false)]);
    const meanwhile = await Promise.race([gitProgram().then((p) => p.file), sleep(3_000).then(() => "held by the look")]);
    look.go();
    let after = meanwhile;
    for (let i = 0; i < 200 && after !== ${JSON.stringify(REAL)}; i++) {
      await sleep(50);
      after = (await gitProgram()).file;
    }
    process.stdout.write(JSON.stringify({ failed, answered: r !== "late" && r.code === 0, lookHeld, meanwhile, after }));
    process.exit(0);`;
  assert.deepEqual(JSON.parse(fresh(script)), { failed: "git", answered: true, lookHeld: true, meanwhile: "git", after: REAL });
});

// (fails before: yes — the same review: a call's stop waited for the look, its launcher's `--exec-path`, to end)
test("a call stopped while git is still being looked for is answered at once, before the look ends", { skip }, () => {
  const dir = repo();
  const script = `
    const { subscribe } = await import("node:diagnostics_channel");
    const { git } = await import(${JSON.stringify(SNAPSHOT)});
    const { SPAWN_CHANNEL } = await import(${JSON.stringify(POOL)});
    let lookEnded = null;
    const looks = new Set();
    subscribe(SPAWN_CHANNEL, (m) => {
      if (m.event === "start" && m.args.includes("--exec-path")) looks.add(m.pid);
      if (m.event === "exit" && looks.has(m.pid)) lookEnded = performance.now();
    });
    const r = await git(["rev-parse", "HEAD"], { cwd: ${JSON.stringify(dir)}, signal: AbortSignal.timeout(5) });
    const answered = performance.now();
    await new Promise((done) => setTimeout(done, 2_000));
    process.stdout.write(JSON.stringify({ error: r.error, beforeTheLookEnded: lookEnded === null || answered < lookEnded, looked: looks.size }));`;
  const out = JSON.parse(fresh(script));
  assert.deepEqual(out, { error: "git rev-parse was abandoned (the request ended)", beforeTheLookEnded: true, looked: 1 });
});

test("a hook, an `!sh` alias and a clean filter run through the real git as through its launcher", { skip }, async () => {
  const dir = repo();
  // A hook: sh, from the launcher's folders on the PATH.
  const hooks = join(dir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho ran > hook-ran.txt\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
  const commit = await git(["commit", "--allow-empty", "-qm", "hooked"], { cwd: dir });
  assert.equal(commit.code, 0, commit.err);
  assert.ok(existsSync(join(dir, "hook-ran.txt")), "the hook ran");
  // An alias through sh.
  const alias = await git(["-c", "alias.both=!echo one; echo two", "both"], { cwd: dir });
  assert.deepEqual([alias.code, alias.out.split(/\r?\n/)], [0, ["one", "two"]], alias.err);
  // A clean filter: `tr`, from the launcher's folders on the PATH.
  writeFileSync(join(dir, ".gitattributes"), "*.txt filter=up\n");
  const up = ["-c", "filter.up.clean=tr a-z A-Z", "-c", "filter.up.required=true"];
  const hashed = await git([...up, "hash-object", "--path=b.txt", "--stdin"], { cwd: dir, input: "abc\n" });
  assert.equal(hashed.code, 0, hashed.err);
  assert.equal(hashed.out, execFileSync("git", ["hash-object", "--stdin"], { input: "ABC\n", encoding: "utf8", windowsHide: true }).trim(), "cleaned as the filter says");
});

test("a git on the PATH that is not the launcher is started as the PATH names it", { skip }, () => {
  const url = pathToFileURL(join(import.meta.dirname, "..", "src", "adapters", "git", "snapshot.js")).href;
  const script = `const { gitProgram } = await import(${JSON.stringify(url)}); process.stdout.write((await gitProgram()).file);`;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  // The real git's own folder first: the PATH's git is git itself.
  const env = { ...process.env, [pathKey]: `${join(place?.mingw ?? "", "bin")};${process.env[pathKey]}` };
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env, windowsHide: true });
  assert.equal(out, "git");
});
