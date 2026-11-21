// @ts-check
// A read of a sub-agent's work against the developer's folder checks each file's place there before git reads it — a
// link on its way, a file where its folder should be. Those checks ask the folder a few stats a file, each folder's
// once, and let Filament's loop turn every few dozen files (the review of 11-02: a thousand files' checks asked the
// same stats of every file, held the loop a second and a half, and nothing else ran meanwhile). What each file comes in
// as stays what it was.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { subscribe } from "node:diagnostics_channel";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { linkInTheWay, previewApply } from "../src/adapters/git/worktree.js";
import { wordsOf } from "./helpers/git-runs.js";

/** The stats asked of the folder while `counting`, one each, as the code calls them. */
let counting = false;
let stats = 0;
for (const name of ["lstatSync", "statSync", "existsSync", "realpathSync"]) {
  const orig = /** @type {any} */ (fs)[name];
  /** @this {any} @param {any[]} a */
  const counted = function (...a) {
    if (counting) stats++;
    return orig.apply(this, a);
  };
  if (orig.native) /** @type {any} */ (counted).native = orig.native;
  /** @type {any} */ (fs)[name] = counted;
}
/** Turns of the loop, and the turn at which the read had its files listed and then started hashing the folder's. */
let turns = 0;
let spinning = true;
const spin = () => {
  turns++;
  if (spinning) setImmediate(spin);
};
/** @type {number | null} */
let listedAt = null;
/** @type {number | null} */
let hashedAt = null;
// The files are listed when git's `--numstat` has ended: the spawn pool tells that end on its channel just before
// its caller hears it.
/** The words of each process the pool's threads started, by its id. @type {Map<number, string[]>} */
const started = new Map();
subscribe(SPAWN_CHANNEL, (/** @type {any} */ m) => {
  if (m.event === "start") started.set(m.pid, wordsOf(m.args));
  else if (m.event === "exit" && started.get(m.pid)?.includes("--numstat")) listedAt = turns;
});
// Git is asked to hash the folder's files when the pool is asked to start it, on this thread — its process starts
// later, on a thread of the pool's, while this loop turns on.
const postMessage = Worker.prototype.postMessage;
/** @this {Worker} @param {any} message @param {any[]} rest */
Worker.prototype.postMessage = function (message, ...rest) {
  if (message?.run?.args?.includes("hash-object") && hashedAt == null) hashedAt = turns;
  return postMessage.call(this, message, ...rest);
};
syncBuiltinESMExports();

/** @type {string[]} */
const made = [];
after(() => {
  spinning = false;
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const N = 400;

/** A repository of N files three folders deep in four, and a commit that changes each: the folder at its base. */
const twoCommits = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-settle-look-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  const paths = Array.from({ length: N }, (_, i) => `d${i % 4}/e/f/x${i}.txt`);
  for (const p of paths) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), `${p}\n`);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  const base = git(dir, "rev-parse", "HEAD");
  for (const p of paths) writeFileSync(join(dir, p), `${p}, its change\n`);
  git(dir, "commit", "-qam", "head");
  const head = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", base, "--", ".");
  return { dir, base, head, paths };
};

/** A dry run of `w`, its folder's stats counted and the loop's turns watched. @param {ReturnType<typeof twoCommits>} w */
const watchedRead = async (w) => {
  counting = true;
  stats = 0;
  listedAt = hashedAt = null;
  try {
    const p = await previewApply(w.dir, w);
    assert.deepEqual(p.came.map((c) => c.how), w.paths.map(() => "took"), "each file comes in as it did");
    return { stats, turned: listedAt != null && hashedAt != null ? hashedAt - listedAt : -1 };
  } finally {
    counting = false;
  }
};
setImmediate(spin);

// (fails before: yes — the review of 11-02: each file's checks asked a dozen stats, the same folders' every time)
test(`a read of ${N} files in a few folders asks the folder about one stat a file`, async () => {
  const { stats: n } = await watchedRead(twoCommits());
  assert.ok(n <= 1.5 * N, `${n} stats for ${N} files`);
});

// (fails before: yes — the same: the checks ran from the files' list to git's read of them with no turn between)
test(`a read of ${N} files lets Filament's loop turn while it checks them, every few dozen`, async () => {
  const { turned } = await watchedRead(twoCommits());
  // A turn every 50 files is 7 for 400; fewer than half of those is no turn every few dozen.
  assert.ok(turned >= 3, `the loop turned ${turned} times between the files listed and git's read of the folder's`);
});

// (fails before: yes — the round-2 review of 11-02: with nothing there up to the root, the way up never ended, and
// Filament's loop with it)
test("a file on a drive that is gone is answered, not hung on: nothing there up to the root is no link in the way", { skip: process.platform !== "win32" && "a drive that is gone is Windows'" }, () => {
  const letter = [..."ZYXWVUTSRQPONMLKJIHGFEDCB"].find((l) => !fs.existsSync(`${l}:\\`));
  if (!letter) return;
  const at = new URL("../src/adapters/git/worktree.js", import.meta.url).href;
  // In a process of its own: a way up that never ends holds its loop, which no test's clock could stop.
  const code = `import { linkInTheWay } from ${JSON.stringify(at)}; console.log(String(linkInTheWay(${JSON.stringify(`${letter}:\\repo`)}, ${JSON.stringify(`${letter}:\\repo\\a\\b.txt`)})));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(out.trim(), "null");
});

test("a link or a file on a file's way is found as it was: a link out of the project, a file where its folder should be, a dangling link", async () => {
  const w = twoCommits();
  const outside = mkdtempSync(join(tmpdir(), "filament-settle-look-out-"));
  made.push(outside);
  // d1/e is a link out of the project, d2/e/f a file, d3/e a link to nowhere.
  rmSync(join(w.dir, "d1", "e"), { recursive: true });
  fs.symlinkSync(outside, join(w.dir, "d1", "e"), "junction");
  rmSync(join(w.dir, "d2", "e", "f"), { recursive: true });
  writeFileSync(join(w.dir, "d2", "e", "f"), "a file\n");
  rmSync(join(w.dir, "d3", "e"), { recursive: true });
  const gone = mkdtempSync(join(tmpdir(), "filament-settle-look-gone-"));
  fs.symlinkSync(gone, join(w.dir, "d3", "e"), "junction");
  rmSync(gone, { recursive: true });
  try {
    const p = await previewApply(w.dir, w);
    const byFolder = (/** @type {string} */ d) => [...new Set(p.conflicts.filter((c) => c.path.startsWith(`${d}/`)).map((c) => c.why))];
    assert.deepEqual(byFolder("d1"), ["a folder on its way in yours is a link out of the project: apply it by hand"]);
    assert.deepEqual(byFolder("d2"), ["your folder has a file where its folder should be (d2/e/f)"]);
    assert.deepEqual(byFolder("d3"), ["a folder on its way in yours is a link out of the project: apply it by hand"]);
    assert.deepEqual([...new Set(p.came.map((c) => `${c.path.slice(0, 2)} ${c.how}`))], ["d0 took"]);
    assert.equal(linkInTheWay(w.dir, join(w.dir, "d1", "e", "f", "x1.txt")), "out", "asked of one file, as a rewind asks");
    assert.equal(linkInTheWay(w.dir, join(w.dir, "d0", "e", "f", "x0.txt")), null);
    assert.equal(linkInTheWay(w.dir, join(w.dir, "d1", "e")), "here");
  } finally {
    fs.rmdirSync(join(w.dir, "d1", "e"));
    fs.rmdirSync(join(w.dir, "d3", "e"));
  }
});
