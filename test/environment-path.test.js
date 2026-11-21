// @ts-check
// The Environment section's PATH line, read without holding Filament: the New Task board captures the environment on
// every pause in typing, for each folder typed, and the PATH's folders were listed one by one on the server's thread —
// tens of folders, thousands of names, and a share that stopped answering held every request for as long as it took.
// They are listed off that thread a few at a time (the file system's threads), each folder with its own short wait from
// when its listing is issued and the whole scan with a cap; a folder that does not answer is left unread and counted,
// so the section never says a tool is missing that could be in it; one whose listing hangs is asked again after a
// minute; the tools found on one PATH stand for a minute, an answer with folders unread only for a few seconds.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import * as environment from "../src/app/agent/environment.js";

const { pathToolsOf, captureEnvironment, environmentText, cachedCapture, createEnvironmentKeeper, ENVIRONMENT_VERSION } = environment;
/** Every promise that can settle has, as the event loop's next turn finds them. */
const settled = () => new Promise((r) => setImmediate(r));
/**
 * The mocked clock moved `ms` on in 50 ms steps, the promises settled between them as the event loop would.
 * @param {import("node:test").TestContext} t @param {number} ms
 */
const run = async (t, ms) => {
  for (let at = 0; at < ms; at += 50) {
    t.mock.timers.tick(50);
    await settled();
  }
};
/** A cmd.exe machine's facts, around the PATH's. @param {any} path @returns {any} */
const factsWith = (path) => ({
  v: ENVIRONMENT_VERSION,
  root: "H:\\proj",
  clock: { weekday: "Friday", date: "2026-10-02", time: "09:05", zone: "Asia/Karachi", offset: "UTC+05:00" },
  system: { name: "Windows 11 Pro", kernel: "10.0.26200", arch: "x64", locale: "en-US" },
  shell: { kind: "cmd", name: "cmd.exe", file: "C:\\Windows\\System32\\cmd.exe", flavor: null },
  powershell: null,
  path,
  harness: { command: "node bin/filament.js", listen: null },
  git: null,
  project: null,
});
/** @type {string[]} */
const made = [];
/** @param {string} name */
const tmp = (name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-envpath-${name}-`));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// (fails before: yes — the folders were listed with readdirSync, one after another: a slow one held the loop until it
// answered)
test("a slow PATH folder holds nothing: Filament's loop turns while it is listed, and the scan reads it once it answers", async () => {
  const fast = tmp("fast");
  writeFileSync(join(fast, "git.exe"), "");
  const slow = join(tmp("slow"), "share");
  /** @param {string} d */
  const list = (d) => (d === slow ? new Promise((r) => setTimeout(r, 300, ["node.exe"])) : readdir(d));
  let turns = 0;
  let on = true;
  const turn = () => {
    turns++;
    if (on) setImmediate(turn);
  };
  setImmediate(turn);
  const p = await pathToolsOf({ env: { PATH: `${slow};${fast}`, PATHEXT: ".EXE" }, platform: "win32", list });
  const during = turns;
  on = false;
  assert.ok(during > 10, `the loop turned ${during} times while a folder took 300 ms to list`);
  assert.deepEqual(p.on, ["git", "node"]);
});

// (fails before: yes — every scan listed every folder itself, and waited on each for as long as it took)
test("a PATH folder that does not answer is left out after the wait, and not asked again while it is still being listed", async () => {
  const stuck = join(tmp("stuck"), "share");
  const good = tmp("good");
  writeFileSync(join(good, "node.exe"), "");
  /** @type {string[]} */
  const asked = [];
  /** @param {string} d */
  const list = (d) => {
    asked.push(d);
    return d === stuck ? new Promise(() => {}) : readdir(d);
  };
  const env = { PATH: `${stuck};${good}`, PATHEXT: ".EXE" };
  const started = Date.now();
  const first = await pathToolsOf({ env, platform: "win32", list, waitMs: 100 });
  assert.deepEqual(first.on, ["node"], "the folders that answered are read");
  assert.ok(Date.now() - started < 2000, "the scan went on without the folder that did not answer");
  const second = await pathToolsOf({ env, platform: "win32", list, waitMs: 100 });
  assert.deepEqual(second.on, ["node"]);
  assert.deepEqual(asked.filter((d) => d === stuck).length, 1, "the folder still being listed is not asked again");
  assert.deepEqual(asked.filter((d) => d === good).length, 2, "a folder that answered is listed again on the next scan");
});

// (fails before: yes — every capture scanned the PATH again)
test("the tools found on one PATH stand for a minute: a capture moments later finds what the first found; past the minute the PATH is read again", async () => {
  const d = tmp("kept");
  writeFileSync(join(d, "git.exe"), "");
  const env = { PATH: d, PATHEXT: ".EXE" };
  const first = await captureEnvironment("", { env, platform: "win32" });
  assert.deepEqual(first.path.on, ["git"]);
  writeFileSync(join(d, "node.exe"), "");
  const next = await captureEnvironment("", { env, platform: "win32" });
  assert.deepEqual(next.path.on, ["git"], "the PATH as the first capture found it");

  const e = tmp("expiry");
  writeFileSync(join(e, "git.exe"), "");
  const at = { PATH: e, PATHEXT: ".EXE" };
  assert.deepEqual((await environment.keptPathTools({ env: at, platform: "win32", now: () => 1_000 })).on, ["git"]);
  writeFileSync(join(e, "node.exe"), "");
  assert.deepEqual((await environment.keptPathTools({ env: at, platform: "win32", now: () => 60_999 })).on, ["git"], "within the minute");
  assert.deepEqual((await environment.keptPathTools({ env: at, platform: "win32", now: () => 61_000 })).on, ["git", "node"], "past it, read again");
});

/**
 * A file system with `threads` threads, each listing taking `ms` once a thread takes it up — what libuv's pool does
 * to listings issued at once. `most` is the most listings asked of it at one time.
 * @param {number} threads @param {number} ms @param {(d: string) => string[]} names
 */
const pooledFs = (threads, ms, names) => {
  let busy = 0;
  let out = 0;
  /** @type {(() => void)[]} */
  const queue = [];
  const start = () => {
    while (busy < threads && queue.length) {
      const job = /** @type {() => void} */ (queue.shift());
      busy++;
      setTimeout(() => {
        busy--;
        job();
        start();
      }, ms);
    }
  };
  const fs = {
    most: 0,
    /** @param {string} d @returns {Promise<string[]>} */
    list: (d) => {
      fs.most = Math.max(fs.most, ++out);
      return new Promise((r) => {
        queue.push(() => {
          out--;
          r(names(d));
        });
        start();
      });
    },
  };
  return fs;
};

// (fails before: yes — one 2 s deadline for the whole scan, every folder asked at once: behind the file system's four
// threads the last folders had not been taken up when it passed, and their tools were left out without a word)
test("folders queued behind slow ones are read, not dropped: a few listings at a time, each its own wait from when it is issued", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  // A cold Windows PATH: twelve folders, the virus scanner taking 900 ms over each, four threads.
  const tools = ["git", "gh", "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "python", "go", "cargo"];
  const dirs = tools.map((_, i) => `C:\\cold-${i}`);
  const fs = pooledFs(4, 900, (d) => [`${tools[dirs.indexOf(d)]}.exe`]);
  const p = pathToolsOf({ env: { PATH: dirs.join(";"), PATHEXT: ".EXE" }, platform: "win32", list: fs.list, pool: 4 });
  await run(t, 4000);
  const r = await p;
  assert.deepEqual(r.on, tools, "the folders listed last are read: each had its 2 s from when it was issued");
  assert.equal(r.unread, 0);
  assert.ok(fs.most <= 4, `no more listings asked at once than the pool has threads (${fs.most})`);
});

test("a PATH whose folders answer slowly holds the scan no longer than its cap: what was not read by then is counted unread", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const tools = ["git", "gh", "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "python", "python3", "py", "pip", "pip3", "uv", "poetry"];
  const dirs = tools.map((_, i) => `C:\\slow-${i}`);
  // Each folder takes 1.9 s, inside its own wait: four rounds of four would take 7.6 s.
  const fs = pooledFs(4, 1900, (d) => [`${tools[dirs.indexOf(d)]}.exe`]);
  let done = false;
  const p = pathToolsOf({ env: { PATH: dirs.join(";"), PATHEXT: ".EXE" }, platform: "win32", list: fs.list, pool: 4, capMs: 6000 }).finally(() => (done = true));
  await run(t, 5950);
  assert.equal(done, false, "three rounds read, the fourth under way");
  await run(t, 50);
  assert.equal(done, true, "answered at the cap, not when the last round would");
  const r = await p;
  assert.deepEqual(r.on, tools.slice(0, 12));
  assert.equal(r.unread, 4);
  await run(t, 2000);
});

test("on POSIX a folder's checks of its tools count inside its wait: one whose files do not answer is left unread, the scan going on", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const nfs = "/envpath-nfs/bin";
  const local = "/envpath-local/bin";
  /** @type {(() => void)[]} */
  const hanging = [];
  /** @param {string} d @returns {Promise<string[]>} */
  const list = async (d) => (d === nfs ? ["git"] : ["node"]);
  /** @param {string} p */
  const statOf = (p) => {
    const file = { isFile: () => true, mode: 0o755 };
    return p.includes("envpath-nfs") ? new Promise((r) => hanging.push(() => r(file))) : Promise.resolve(file);
  };
  const p = pathToolsOf({ env: { PATH: [nfs, local].join(delimiter) }, platform: "linux", list, statOf, pool: 4 });
  await run(t, 2000);
  const r = await p;
  assert.deepEqual([r.on, r.unread], [["node"], 1]);
  for (const go of hanging) go();
  await settled();
});

// (fails before: yes — a folder that did not answer was left out and the section said "Not on PATH" for every Unix
// tool it could hold)
test("a capture with folders left unread never says a tool is absent that could be in them; an old capture, without the count, reads as it did", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const share = "Z:\\envpath-share\\bin";
  /** @type {(names: string[]) => void} */
  let release = () => {};
  /** @param {string} d @returns {Promise<string[]>} */
  const list = (d) => (d === share ? new Promise((r) => (release = r)) : Promise.resolve(["grep.exe", "git.exe"]));
  const p = pathToolsOf({ env: { PATH: `${share};C:\\envpath-tools`, PATHEXT: ".EXE" }, platform: "win32", list, pool: 4 });
  await run(t, 2000);
  const path = await p;
  const text = environmentText(factsWith(path));
  assert.doesNotMatch(text, /Not on PATH/, "nothing said absent while a folder went unread");
  assert.match(text, /- Unix tools on PATH: grep — they run, but cmd parses the line: quote with double quotes, never single\. Not found in the PATH folders read \(1 PATH folder did not answer in time\): ls, cat, sed, awk, head, tail, wc, xargs\.\n/);
  assert.match(text, /- On PATH: git, in the folders read \(1 PATH folder did not answer in time\)\n/);
  assert.equal(path.unread, 1);
  const none = environmentText(factsWith({ on: [], unixOn: [], unixOff: ["grep", "ls"], wslBash: false, platform: "win32", unread: 3 }));
  assert.match(none, /- Not found in the PATH folders read \(3 PATH folders did not answer in time\): grep, ls — use the read, grep and glob tools for files\.\n/);
  assert.match(none, /- On PATH: none of the common tools, in the folders read \(3 PATH folders did not answer in time\)\n/);
  // A capture stored before the count was kept has no `unread`: none, and its section the bytes it always had.
  const old = { on: ["git", "node"], unixOn: [], unixOff: ["grep", "ls", "cat"], wslBash: false, platform: "win32" };
  const oldText = environmentText(factsWith(old));
  assert.match(oldText, /- Not on PATH: grep, ls, cat — use the read, grep and glob tools for files\.\n/);
  assert.match(oldText, /- On PATH: git, node\n/);
  assert.equal(environmentText(factsWith({ ...old, unread: 0 })), oldText, "a whole capture reads as an old one");
  release([]);
  await settled();
});

// (fails before: yes — a listing that never answered stood for its folder for the process's life: every later scan
// waited on the same dead promise)
test("a folder whose listing hangs is asked again by a scan past its minute, never while the listing is young; the share back answers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const stuck = "Y:\\envpath-share\\bin";
  /** @type {((names: string[]) => void)[]} */
  const hanging = [];
  let back = false;
  /** @type {string[]} */
  const asked = [];
  /** @param {string} d @returns {Promise<string[]>} */
  const list = (d) => {
    asked.push(d);
    if (d !== stuck) return Promise.resolve(["git.exe"]);
    return back ? Promise.resolve(["node.exe"]) : new Promise((r) => hanging.push(r));
  };
  const env = { PATH: `${stuck};C:\\envpath-tools`, PATHEXT: ".EXE" };
  const scan = async () => {
    const p = pathToolsOf({ env, platform: "win32", list, pool: 4 });
    await run(t, 2000);
    return p;
  };
  const askedStuck = () => asked.filter((d) => d === stuck).length;
  const first = await scan();
  assert.deepEqual(first.on, ["git"]);
  await run(t, 28_000);
  const young = await scan();
  assert.equal(askedStuck(), 1, "not asked again while its listing is young");
  assert.deepEqual(young.on, ["git"]);
  back = true;
  await run(t, 29_000);
  const again = await scan();
  assert.equal(askedStuck(), 2, "asked again past its minute");
  assert.deepEqual(again.on, ["git", "node"], "the share back answers");
  const next = await scan();
  assert.equal(askedStuck(), 3, "the listing that answered is let go: the next scan lists the folder afresh");
  assert.deepEqual([first.unread, young.unread, again.unread, next.unread], [1, 1, 0, 0]);
  for (const r of hanging) r([]);
  await settled();
});

test("folders asked again past listings that hang take half the pool at most: one more waits until one of them answers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const x = "X:\\envpath-dead\\a";
  const y = "X:\\envpath-dead\\b";
  /** @type {((names: string[]) => void)[]} */
  const hangingX = [];
  /** @type {((names: string[]) => void)[]} */
  const hangingY = [];
  /** @type {string[]} */
  const asked = [];
  /** @param {string} d @returns {Promise<string[]>} */
  const list = (d) => {
    asked.push(d);
    return new Promise((r) => (d === x ? hangingX : hangingY).push(r));
  };
  const env = { PATH: `${x};${y}`, PATHEXT: ".EXE" };
  const scan = async () => {
    const p = pathToolsOf({ env, platform: "win32", list, pool: 2 });
    await run(t, 2000);
    return p;
  };
  const times = (/** @type {string} */ d) => asked.filter((a) => a === d).length;
  const first = await scan();
  await run(t, 59_000);
  const second = await scan();
  assert.deepEqual([times(x), times(y)], [2, 1], "x asked again; y waits, its pool of two leaving one for the rest");
  hangingX[0]([]);
  await settled();
  await scan();
  assert.deepEqual([times(x), times(y)], [2, 2], "x's first listing answered: y is asked again; x's second, still young, is not");
  assert.deepEqual([first.unread, second.unread], [2, 2]);
  for (const r of [...hangingX, ...hangingY]) r([]);
  await settled();
});

const partial = { on: ["git"], unixOn: [], unixOff: ["grep"], wslBash: false, platform: "win32", unread: 2 };
const whole = { ...partial, on: ["git", "node"], unread: 0 };

// (fails before: yes — an answer with folders unread stood the full minute, as a whole one does)
test("an answer with folders unread stands only seconds; a whole one its minute", async () => {
  let scans = 0;
  const scan = async () => (++scans === 1 ? partial : whole);
  const env = { PATH: join(tmpdir(), `filament-envpath-none-${process.pid}-partial`), PATHEXT: ".EXE" };
  const at = (/** @type {number} */ ms) => environment.keptPathTools({ env, platform: "win32", now: () => ms, scan });
  assert.equal((await at(1000)).unread, 2);
  assert.equal((await at(5999)).unread, 2, "the asks of one moment share it");
  assert.equal(scans, 1);
  assert.equal((await at(6000)).unread, 0, "a few seconds on, the PATH is read again");
  assert.equal(scans, 2);
  assert.equal((await at(65_999)).unread, 0);
  assert.equal(scans, 2, "a whole answer stands its minute");
});

// (fails before: yes — the PATH's answer was kept for its minute even when its scan failed, where a capture that
// fails is let go at once)
test("a PATH scan that fails is not kept: the next ask scans again", async () => {
  let tries = 0;
  const failing = async () => {
    if (++tries === 1) throw new Error("the scan failed");
    return whole;
  };
  const fenv = { PATH: join(tmpdir(), `filament-envpath-none-${process.pid}-failing`), PATHEXT: ".EXE" };
  await assert.rejects(environment.keptPathTools({ env: fenv, platform: "win32", now: () => 1, scan: failing }), /the scan failed/);
  assert.equal((await environment.keptPathTools({ env: fenv, platform: "win32", now: () => 2, scan: failing })).unread, 0, "a failed scan is asked again, not served its minute");
});

// (fails before: yes — a capture holding an answer with folders unread stood its 15 s, so a session starting seconds
// later froze it for its life)
test("a capture with folders unread stands only seconds; a session frozen on it keeps its bytes, the next session captures again", async () => {
  let clock = 0;
  let captures = 0;
  /** @param {string} root @returns {Promise<any>} */
  const capture = async (root) => ({ ...factsWith(++captures === 1 ? partial : whole), root });
  const cached = cachedCapture(capture, { now: () => clock });
  const keeper = createEnvironmentKeeper({ capture: cached });
  /** @type {any[]} */
  const stored = [];
  const a = await keeper.forSession({ key: "a", root: "H:\\proj", store: (f) => stored.push(f) });
  assert.equal(a?.path.unread, 2);
  clock = 4999;
  assert.equal(await cached("H:\\proj"), a, "the board and the first turn of one moment share the capture");
  clock = 6000;
  assert.equal(await keeper.forSession({ key: "a", root: "H:\\proj" }), a, "the session keeps the capture its first turn froze");
  const b = await keeper.forSession({ key: "b", root: "H:\\proj" });
  assert.equal(b?.path.unread, 0, "a session starting seconds later captures again, and reads the folders that answer now");
  assert.equal(captures, 2);
  clock = 20_999;
  await cached("H:\\proj");
  assert.equal(captures, 2, "a whole capture stands its 15 s");
  // After a restart the session's stored capture is its prompt's, as it was frozen.
  const restarted = createEnvironmentKeeper({ capture: async () => { throw new Error("not asked"); } });
  const back = await restarted.forSession({ key: "a", root: "H:\\proj", stored: stored[0] });
  assert.equal(back && environmentText(back), a && environmentText(a));
});
