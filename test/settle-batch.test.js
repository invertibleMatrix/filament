// @ts-check
// A read of a sub-agent's work against the developer's folder — the dry run Apply says its effect by, the apply, and
// Filament's own look for work found there whole — starts git once for each kind of work, never once a file: on
// Windows each git process Filament starts holds its loop while it starts (the slowness of 11-02: a chat with four
// helpers' 426 files waiting started thousands every 30 s, and Filament crawled). What each file comes in as stays
// what a git call of its own for it said.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { applyTaskWork, captureTaskWork, foundWhole, openTaskWorktree, previewApply, removeTaskWorktree } from "../src/adapters/git/worktree.js";
import { gitFaultsHere, withGitFault } from "./helpers/git-fault.js";
import { gitRuns, wordsOf } from "./helpers/git-runs.js";

/** A git call answered otherwise in this process, armed before the pool starts its first thread. */
const armed = gitFaultsHere();

/**
 * The git commands `go` starts (`gitRuns`), and how many of each: `hash-object`, `cat-file`, `merge-file`…
 * @template T @param {() => Promise<T>} go @returns {Promise<{ out: T, runs: string[][], kinds: Record<string, number> }>}
 */
const counted = async (go) => {
  const { out, runs } = await gitRuns(go);
  /** @type {Record<string, number>} */
  const kinds = {};
  for (const r of runs) kinds[r[0]] = (kinds[r[0]] || 0) + 1;
  return { out, runs, kinds };
};

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const TEN = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
/** Twelve files in three folders, and one whose name has a space and letters past ASCII. */
const FILES = [...Array.from({ length: 12 }, (_, i) => `d${i % 3}/f${String(i).padStart(2, "0")}.txt`), "d2/zz schön ü.txt"];

/**
 * A repository of thirteen files, and a sub-agent's work on it: line 8 of each changed, and a new file. The developer's
 * folder then: line 2 of the first four changed too (merged three ways), the fifth already as it left it, the rest as
 * they were.
 * @param {string} id
 */
const working = async (id) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-settle-batch-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  for (const p of FILES) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), TEN);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  const o = await openTaskWorktree(dir, { id });
  assert.ok(o.ok, !o.ok ? o.error : "");
  for (const p of FILES) writeFileSync(join(o.wt.workdir, p), TEN.replace("8\n", "EIGHT, its\n"));
  writeFileSync(join(o.wt.workdir, "new.txt"), "new\n");
  const cap = await captureTaskWork(o.wt, { id });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  await removeTaskWorktree(o.wt);
  for (const p of FILES.slice(0, 4)) writeFileSync(join(dir, p), TEN.replace("2\n", "TWO, yours\n"));
  writeFileSync(join(dir, FILES[4]), TEN.replace("8\n", "EIGHT, its\n"));
  return { dir, base: o.wt.base, head: cap.head };
};
const CAME = [...FILES.slice(0, 4).map((p) => `${p} merged`), `${FILES[4]} same`, ...FILES.slice(5).map((p) => `${p} took`), "new.txt took"].sort();

// (fails before: yes — the slowness of 11-02: each file's version in the folder was its own hash-object, each merge
// its own hash-object -w and three cat-files: this dry run started 35 git processes, a chat's helpers thousands)
test("a dry run of thirteen files starts git once for each kind of work — four merge-files for the four it merges — and says what each comes in as", async () => {
  const w = await working("sa_000000b1");
  const { out, kinds } = await counted(() => previewApply(w.dir, w));
  assert.deepEqual(out.came.map((c) => `${c.path} ${c.how}`).sort(), CAME);
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(kinds, { diff: 2, "hash-object": 2, "cat-file": 1, "merge-file": 4 }, "the folder's versions read once, the merged ones kept once, their versions read once, a merge for each");
});

// (fails before: yes — the same: each merge was kept in git by a call of its own)
test("an apply keeps its merges in git with one call, and writes each file as its own call would", async () => {
  const w = await working("sa_000000b2");
  const { out, kinds } = await counted(() => applyTaskWork(w.dir, w));
  assert.ok(out.ok, !out.ok ? JSON.stringify(out.conflicts) : "");
  assert.deepEqual(out.came.map((c) => `${c.path} ${c.how}`).sort(), CAME);
  assert.equal(kinds["hash-object"], 3, "the folder's versions, the merged ones kept, the merges kept");
  assert.equal(kinds["merge-file"], 4);
  for (const p of FILES.slice(0, 4)) assert.equal(readFileSync(join(w.dir, p), "utf8"), TEN.replace("2\n", "TWO, yours\n").replace("8\n", "EIGHT, its\n"), `${p}: both edits`);
  for (const p of FILES.slice(4)) assert.equal(readFileSync(join(w.dir, p), "utf8"), TEN.replace("8\n", "EIGHT, its\n"), p);
  assert.equal(readFileSync(join(w.dir, "new.txt"), "utf8"), "new\n");
});

test("a file of the developer's that git cannot read, among others, stops in git's words; the files after it are read on, each as it is", async () => {
  const w = await working("sa_000000b3");
  // A clean filter the repository needs for one file in the middle, which fails: git cannot hash it.
  mkdirSync(join(w.dir, ".git", "info"), { recursive: true });
  writeFileSync(join(w.dir, ".git", "info", "attributes"), `${FILES[6]} filter=broken\n`);
  git(w.dir, "config", "filter.broken.clean", "false");
  git(w.dir, "config", "filter.broken.required", "true");
  const p = await previewApply(w.dir, w);
  assert.deepEqual(p.conflicts.map((c) => [c.path, c.kind]), [[FILES[6], "unread"]]);
  assert.match(p.conflicts[0].why, /^git could not read your version \(.+\)$/);
  assert.deepEqual(p.came.map((c) => `${c.path} ${c.how}`).sort(), CAME.filter((c) => !c.startsWith(FILES[6])));
});

test("overlapping changes among clean merges are named with their count, and nothing is written", async () => {
  const w = await working("sa_000000b4");
  writeFileSync(join(w.dir, FILES[1]), TEN.replace("8\n", "eight, yours\n"));
  const r = await applyTaskWork(w.dir, w);
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.conflicts.map((c) => [c.path, c.kind, c.why, c.overlaps]), [[FILES[1], "lines", "1 change overlaps yours", 1]]);
  assert.equal(readFileSync(join(w.dir, FILES[0]), "utf8"), TEN.replace("2\n", "TWO, yours\n"), "all or nothing");
  // Both, with git's markers: the merge kept with the clean ones', in one call.
  const both = await applyTaskWork(w.dir, w, { choices: { [FILES[1]]: "both" } });
  assert.ok(both.ok, !both.ok ? JSON.stringify(both.conflicts) : "");
  assert.equal(readFileSync(join(w.dir, FILES[1]), "utf8"), TEN.replace("8\n", "<<<<<<< yours\neight, yours\n=======\nEIGHT, its\n>>>>>>> its change\n"));
  assert.equal(readFileSync(join(w.dir, FILES[0]), "utf8"), TEN.replace("2\n", "TWO, yours\n").replace("8\n", "EIGHT, its\n"));
});

/** The batch read of the merges' versions, by its words. */
const BATCH_READ = ["cat-file", "--batch"];
/** An option no git knows: git refuses the call, exits 129, and says nothing on its standard output. */
const UNKNOWN = "--no-such-option";
/**
 * `go` run while `dir`'s repository loses the object `sha` the moment each git call `after` names has ended (the pool
 * tells a call's end before its caller hears it): the call after it reads the object as git reads one it does not have.
 * @template T @param {string} dir @param {string} sha @param {(words: string[]) => boolean} after @param {() => Promise<T>} go @returns {Promise<T>}
 */
const goneAfter = async (dir, sha, after, go) => {
  const file = join(dir, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  /** @type {Map<number, string[]>} */
  const started = new Map();
  const on = (/** @type {any} */ m) => {
    if (m.event === "start") started.set(m.pid, wordsOf(m.args));
    else if (m.event === "exit" && after(started.get(m.pid) || [])) {
      // Git keeps its objects read-only, which Windows will not delete.
      if (existsSync(file)) chmodSync(file, 0o644);
      rmSync(file, { force: true });
    }
  };
  subscribe(SPAWN_CHANNEL, on);
  try {
    return await go();
  } finally {
    unsubscribe(SPAWN_CHANNEL, on);
  }
};
/** The folder left a while: its files' stats are old enough to stand for them (worktree.js `RACY_MS`). */
const aWhile = () => new Promise((r) => setTimeout(r, 3_100));

test("a batch read of the merges' versions that git could not answer whole — an exit not 0, its answer cut short — is read blob by blob, and every file comes in as it would", async () => {
  const w = await working("sa_000000b5");
  // Asked with an option it does not know, git exits 129 and answers nothing. Asked for the last version with a 0 after
  // it, which a `%(rest)` puts after its size, git says ten times the bytes it then answers: its answer ends short.
  // Asked `--batch-check`, it answers each version's line and none of its bytes.
  /** @type {[string, import("./helpers/git-fault.js").Fault][]} */
  const faults = [
    ["an exit not 0", { ask: BATCH_READ, instead: [...BATCH_READ, UNKNOWN] }],
    ["its answer cut short", { ask: BATCH_READ, instead: ["cat-file", "--batch=%(objectname) %(objecttype) %(objectsize)%(rest)"], input: ["\n$", " 0\n"] }],
    ["every answer without its bytes", { ask: BATCH_READ, instead: ["cat-file", "--batch-check"] }],
  ];
  for (const [why, fault] of faults) {
    const { out, runs } = await withGitFault(fault, "previewApply", [w.dir, w]);
    assert.deepEqual(out.came.map((/** @type {any} */ c) => `${c.path} ${c.how}`).sort(), CAME, why);
    assert.ok(runs.some((r) => r.join(" ") === BATCH_READ.join(" ")), `${why}: the batch asked`);
    assert.ok(runs.some((r) => r[0] === "cat-file" && r.includes("blob")), `${why}: read blob by blob`);
  }
});

test("its change found beside the developer's own edits in four files, through four merges that come out as their files, is whole; a version git says it lacks reads empty, and that read stands on nothing", async () => {
  const w = await working("sa_000000b6");
  for (const p of FILES) writeFileSync(join(w.dir, p), TEN.replace("8\n", "EIGHT, its\n"));
  for (const p of FILES.slice(0, 4)) writeFileSync(join(w.dir, p), TEN.replace("2\n", "TWO, yours\n").replace("8\n", "EIGHT, its\n"));
  writeFileSync(join(w.dir, "new.txt"), "new\n");
  await aWhile();
  const { out: plain, kinds } = await counted(() => foundWhole(w.dir, w));
  assert.deepEqual(plain.whole?.came.map((c) => c.how), [...FILES, "new.txt"].map(() => "same"), "whole");
  assert.ok(plain.stamp, "and stood on");
  assert.deepEqual([kinds["merge-file"], kinds["cat-file"]], [4, 1], "four merges, their versions read once");
  // The developer's version of the four, kept in git by the read a moment before the batch asks for it first, gone
  // from the repository then: git says of it what it says of an object it does not have.
  const ours = git(w.dir, "hash-object", "--", FILES[0]);
  const { out: missing, runs } = await gitRuns(() => goneAfter(w.dir, ours, (a) => a.join(" ") === "hash-object -w --stdin-paths", () => foundWhole(w.dir, w)));
  assert.equal(execFileSync("git", ["cat-file", "--batch-check"], { cwd: w.dir, input: `${ours}\n`, encoding: "utf8" }), `${ours} missing\n`, "gone from the repository");
  assert.equal(runs.filter((r) => r.join(" ") === BATCH_READ.join(" ")).length, 1, "the batch read it");
  assert.equal(missing.whole, null, "read as an empty file, its version does not come in as it is");
  assert.equal(missing.stamp, null, "a read git could not make whole is no read to stand on");
});

/** Git's config and its places asked of it: what a read's list of git's files is made from. @param {string[][]} runs */
const askedOfGit = (runs) => runs.filter((r) => r[0] === "var" || r.includes("config")).length;

// (fails before: yes — the round-2 review of 11-02: a `git var` that failed fell back to guesses without the system's
// attributes, and that list was kept, and stood on)
test("a git var that fails leaves a read nothing to stand on, and keeps nothing for the next", async () => {
  const w = await working("sa_000000b8");
  await aWhile();
  // Asked with an option it does not know, git exits 129 and names no place.
  const failing = armed.arm({ match: { has: ["var", "-l"] }, args: ["var", "-l", UNKNOWN] });
  const failed = await foundWhole(w.dir, w);
  assert.notEqual(await Promise.race([failing.reached, new Promise((r) => setTimeout(r, 5_000, "late"))]), "late", "git var asked as armed");
  assert.equal(failed.stamp, null, "nothing to stand on");
  const { out, runs } = await counted(() => foundWhole(w.dir, w));
  assert.ok(askedOfGit(runs) > 0, "git asked again: nothing was kept");
  assert.ok(out.stamp, "and this read stands on what it said");
});

// (fails before: yes — the same: the list's own stamp held the index and the attributes files, so a git add asked
// git's config and places again)
test("the index moved — a git add — keeps the list of git's files: no git is asked of it", async () => {
  const w = await working("sa_000000b9");
  await aWhile();
  assert.ok((await foundWhole(w.dir, w)).stamp, "the first read stands");
  git(w.dir, "add", "-A");
  const { runs } = await counted(() => foundWhole(w.dir, w));
  assert.equal(askedOfGit(runs), 0, JSON.stringify(runs));
});

// (fails before: yes — the same: `%(prefix)/` in an include was read as a folder of that name)
test("an include written with %(prefix)/ is watched where git means it", async () => {
  const w = await working("sa_000000ba");
  git(w.dir, "config", "include.path", "%(prefix)/etc/filament-test-not-there.cfg");
  await aWhile();
  const meant = execFileSync("git", ["config", "--type=path", "--get", "include.path"], { cwd: w.dir, encoding: "utf8" }).trim();
  const r = await foundWhole(w.dir, w);
  assert.ok(r.stamp?.watched.includes(resolve(meant)), `${resolve(meant)} among ${JSON.stringify(r.stamp?.watched)}`);
});

test("merges git would not keep in one call are kept one by one, and the apply writes them as it would", async () => {
  const w = await working("sa_000000b7");
  // The keep of all of them asked with an option git does not know: it exits 129 and keeps none.
  const keepAll = ["hash-object", "-w", "--no-filters", "--stdin-paths"];
  const { out, runs } = await withGitFault({ ask: keepAll, instead: [...keepAll, UNKNOWN] }, "applyTaskWork", [w.dir, w]);
  assert.ok(out.ok, !out.ok ? JSON.stringify(out.conflicts) : "");
  assert.equal(runs.filter((r) => r.join(" ") === keepAll.join(" ")).length, 1, "all of them asked together first");
  assert.equal(runs.filter((r) => r[0] === "hash-object" && r.includes("--stdin") && r.includes("--no-filters")).length, 4, "each merge kept alone");
  for (const p of FILES.slice(0, 4)) assert.equal(readFileSync(join(w.dir, p), "utf8"), TEN.replace("2\n", "TWO, yours\n").replace("8\n", "EIGHT, its\n"), `${p}: both edits`);
});
