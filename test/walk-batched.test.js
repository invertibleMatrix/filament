// @ts-check
// A turn's changes read with fewer git processes (the owner's of 11-18, on the first open of a large turn after a
// start: "what do you propsoe for these two", then "go ahead"): TinyQuest's turn 47 ran 8,235 git processes for
// 65 s, each a process's start before git's own work. A diff's names and counts come from one process
// (`parseRawNumstat`), and the names of many pairs of commits from one `git diff-tree --stdin` (`namesChangedAll`),
// each the same answer as the call it stands for: these tests ask git both ways and compare. Every repository is a
// throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { batchNames, diffFiles, namesChangedAll, ownChangesOf, pairKey, parseNameStatus, parseNumstat, parseRawNumstat } from "../src/adapters/git/changes.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true, maxBuffer: 1 << 26 });
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

/** A commit of everything in `dir` now. @param {string} dir @param {string} m */
const commit = (dir, m) => {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", m]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
};

/**
 * A repository whose history holds what a turn's rounds can: files added, changed, deleted and renamed, a binary file,
 * names with a space, letters past ASCII and a pathspec's brackets, a file that became a folder, and a merge.
 */
function history() {
  const dir = mkdtempSync(join(tmpdir(), "filament-walk-batched-"));
  made.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "x"), "a file\n");
  writeFileSync(join(dir, "gone.txt"), "soon gone\n");
  const c0 = commit(dir, "c0");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "with space.md"), "s\n");
  writeFileSync(join(dir, "ünï cödé.txt"), "u\n");
  writeFileSync(join(dir, "br[a]ck.js"), "[\n");
  writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3, 255, 0, 7]));
  rmSync(join(dir, "gone.txt"));
  const c1 = commit(dir, "c1");
  git(dir, ["mv", "a.txt", "moved.txt"]);
  rmSync(join(dir, "x"));
  mkdirSync(join(dir, "x"));
  writeFileSync(join(dir, "x", "y.txt"), "now a folder\n");
  writeFileSync(join(dir, "bin.dat"), Buffer.from([9, 0, 9, 0]));
  const c2 = commit(dir, "c2");
  git(dir, ["checkout", "-q", "-b", "side", c1]);
  writeFileSync(join(dir, "side.txt"), "side\n");
  const s1 = commit(dir, "s1");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "-m", "merge", "side"]);
  const m = git(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, c0, c1, c2, s1, m };
}

/** What `git diff --name-only` says for a pair, as the walk read it one by one. @param {string} dir @param {string | null} b @param {string} a */
const namesOf = (dir, b, a) => {
  try {
    return git(dir, ["diff", "--name-only", "-z", "--no-renames", b || "4b825dc642cb6eb9a060e54bf8d69288fbee4904", a]).trim().split("\0").filter(Boolean);
  } catch {
    return null;
  }
};

// (fails before: yes — there was no reader of the joint output: every diff was two processes)
test("parseRawNumstat reads one process's names and counts as --name-status and --numstat read them apart: renames, a binary, odd names, a folder from a file, a merge", async () => {
  const h = history();
  const pairs = [[h.c0, h.c1], [h.c1, h.c2], [h.c0, h.c2], [h.c2, h.m], [h.c1, h.m], [h.s1, h.c2], [h.c1, h.c1], ["4b825dc642cb6eb9a060e54bf8d69288fbee4904", h.c2]];
  for (const [b, a] of pairs) {
    for (const pairing of ["-M", "--no-renames"]) {
      const joint = parseRawNumstat(git(h.dir, ["diff", "--raw", "--numstat", "-z", pairing, b, a]).trim());
      const names = parseNameStatus(git(h.dir, ["diff", "--name-status", "-z", pairing, b, a]).trim());
      const counts = parseNumstat(git(h.dir, ["diff", "--numstat", "-z", pairing, b, a]).trim());
      assert.ok(joint, `${b.slice(0, 7)}..${a.slice(0, 7)} ${pairing}: read`);
      assert.deepEqual(joint, { names, counts }, `${b.slice(0, 7)}..${a.slice(0, 7)} ${pairing}`);
    }
  }
  const moved = parseRawNumstat(git(h.dir, ["diff", "--raw", "--numstat", "-z", "-M", h.c1, h.c2]).trim());
  assert.ok(moved?.names.some((n) => n.status === "renamed" && n.oldPath === "a.txt" && n.path === "moved.txt"), "a rename, both its paths");
  assert.deepEqual(moved?.counts.get("bin.dat"), { added: 0, removed: 0, binary: true });
  // Against the working tree, as the plumbing reads it: a file changed, one deleted, one written again as it was (its
  // time alone changed: in the names, not in the counts).
  writeFileSync(join(h.dir, "with space.md"), "changed\n");
  rmSync(join(h.dir, "side.txt"));
  writeFileSync(join(h.dir, "br[a]ck.js"), readFileSync(join(h.dir, "br[a]ck.js")));
  const t = new Date(Date.now() + 5000);
  utimesSync(join(h.dir, "br[a]ck.js"), t, t);
  for (const base of [h.c2, h.m]) {
    for (const pairing of ["-M", "--no-renames"]) {
      const joint = parseRawNumstat(git(h.dir, ["diff-index", "--raw", "--numstat", "-z", pairing, base]).trim());
      const names = parseNameStatus(git(h.dir, ["diff-index", "--name-status", "-z", pairing, base]).trim());
      assert.deepEqual(joint, { names, counts: parseNumstat(git(h.dir, ["diff-index", "--numstat", "-z", pairing, base]).trim()) }, `${base.slice(0, 7)} ${pairing}`);
      if (base === h.m) assert.deepEqual(names.map((n) => [n.path, n.status]), [["br[a]ck.js", "modified"], ["side.txt", "deleted"], ["with space.md", "modified"]], "the touched file is among the names");
      if (base === h.m) assert.deepEqual([...(joint?.counts.keys() || [])], ["side.txt", "with space.md"], "and not among the counts");
    }
  }
  const files = await diffFiles(h.dir, h.m, null);
  assert.deepEqual(files.files.map((f) => [f.path, f.status, f.added, f.removed]), [["side.txt", "deleted", 0, 1], ["with space.md", "modified", 1, 1]]);
  git(h.dir, ["checkout", "-q", "--", "with space.md", "side.txt"]);
});

test("parseRawNumstat: nothing is no change; output that is not raw entries then counts, entry by entry, is none", () => {
  assert.deepEqual(parseRawNumstat(""), { names: [], counts: new Map() });
  assert.equal(parseRawNumstat("M\0a.txt\0"), null, "a --name-status line");
  assert.equal(parseRawNumstat(":100644 100644 abc def M\0a.txt\0garbage\0"), null);
  assert.deepEqual(parseRawNumstat(":100644 100644 abc def M\0:odd.txt\0" + "1\t2\t:odd.txt\0"), { names: [{ path: ":odd.txt", oldPath: null, status: "modified" }], counts: new Map([[":odd.txt", { added: 1, removed: 2, binary: false }]]) }, "a path that opens with a colon is a path");
  const copied = ":100644 100644 abc def C075\0old.txt\0new.txt\0" + "3\t0\t\0old.txt\0new.txt\0";
  assert.deepEqual(parseRawNumstat(copied), { names: parseNameStatus("C075\0old.txt\0new.txt\0"), counts: parseNumstat("3\t0\t\0old.txt\0new.txt\0") }, "a copy, both its paths, as the two read it");
});

// (fails before: yes — every diff was two processes; this holds the files the same)
test("diffFiles lists the same files from one process, narrowed to paths or not, a pathspec's own words included", async () => {
  const h = history();
  for (const [b, a] of [[h.c0, h.c2], [h.c1, h.m]]) {
    const whole = await diffFiles(h.dir, b, a);
    const names = parseNameStatus(git(h.dir, ["diff", "--name-status", "-z", "-M", b, a]).trim());
    const counts = parseNumstat(git(h.dir, ["diff", "--numstat", "-z", "-M", b, a]).trim());
    assert.deepEqual(whole.files, names.map((f) => ({ ...f, added: counts.get(f.path)?.added ?? 0, removed: counts.get(f.path)?.removed ?? 0, binary: counts.get(f.path)?.binary ?? false })));
    const some = await diffFiles(h.dir, b, a, { paths: ["br[a]ck.js", "x/y.txt", "moved.txt"] });
    const narrowed = parseNameStatus(git(h.dir, ["diff", "--name-status", "-z", "-M", b, a, "--", "br[a]ck.js", "x/y.txt", "moved.txt"]).trim());
    assert.deepEqual(some.files.map((f) => [f.path, f.status]), narrowed.map((f) => [f.path, f.status]));
  }
});

// (fails before: yes — namesChangedAll did not exist: each pair was a process)
test("namesChangedAll: each pair's names as git diff names them one by one, in their order — a merge, a pair read backwards, a file become a folder, an empty diff, from nothing, an id that is no commit", async () => {
  const h = history();
  const fake = "0123456789abcdef0123456789abcdef01234567";
  /** @type {[string | null, string][]} */
  const pairs = [[h.c0, h.c1], [h.c1, h.c2], [h.c2, h.m], [h.c1, h.m], [h.c2, h.c1], [h.c1, h.c1], [null, h.c1], [fake, h.c2], [h.c2, fake], [h.s1, h.m], [h.c0, h.c1]];
  const got = await namesChangedAll(h.dir, pairs);
  assert.equal(got.size, pairs.length - 1, "each distinct pair once");
  for (const [b, a] of pairs) {
    const want = namesOf(h.dir, b, a);
    const have = got.get(pairKey(b, a));
    assert.deepEqual(have ? [...have] : have, want, `${b?.slice(0, 7)}..${a.slice(0, 7)}`);
  }
});

test("namesChangedAll: a tree's id read as a commit's is asked one by one — the batch would give its line a header and no names", async () => {
  const h = history();
  const tree = git(h.dir, ["rev-parse", `${h.c1}^{tree}`]).trim();
  // c1's tree is known to git once c1's line is read: on the next line git drops it as no commit, and answers the line
  // with its header and no names, which the parse would read as an empty diff.
  /** @type {[string, string][]} */
  const pairs = [[h.c0, h.c1], [tree, h.c2]];
  const got = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) assert.deepEqual([...(got.get(pairKey(b, a)) || [])], namesOf(h.dir, b, a), `${b.slice(0, 7)}..${a.slice(0, 7)}`);
  assert.ok((got.get(pairKey(tree, h.c2))?.size ?? 0) > 0, "the tree's diff names the files git diff names");
});

// (fails before: yes — the batch's parse stood inside its call, where no test reached a missing header)
test("batchNames: each pair's names after its header; a header missing, at the end or between, out of order, or an id among the names tells none", () => {
  const [a, b, c] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
  const x = "1".repeat(40);
  /** @type {[string, string][]} */
  const pairs = [[x, a], [x, b], [a, b], [x, c]];
  const z = (/** @type {string[]} */ parts) => `${parts.join("\0")}\0`;
  assert.deepEqual(batchNames(z([a, "p.txt", "q.txt", b, "r.txt", b, c]), pairs), [new Set(["p.txt", "q.txt"]), new Set(["r.txt"]), new Set(), new Set()], "two lines of one commit, an empty diff, the last empty");
  assert.equal(batchNames(z([a, "p.txt", b, "r.txt", c, "s.txt"]), pairs), null, "a header missing between");
  assert.equal(batchNames(z([a, "p.txt", b, "r.txt", b]), pairs), null, "a header missing at the end");
  assert.equal(batchNames(z([b, "r.txt", a, "p.txt", b, c]), pairs), null, "out of order");
  assert.equal(batchNames(z([a, "p.txt", c, b, b, c]), pairs), null, "an id among the names");
  assert.equal(batchNames(z([a, b, a, b, c]), pairs), null, "an earlier pair's id among the names");
  assert.deepEqual(batchNames("", []), []);
});

test("namesChangedAll: a file named as one of the batch's commits is read one by one, and lists as git diff lists it", async () => {
  const h = history();
  writeFileSync(join(h.dir, h.c2), "named as a commit\n");
  const c3 = commit(h.dir, "c3");
  // The file named as c2 sits in the first pair's names, just ahead of the pair whose header is c2.
  /** @type {[string, string][]} */
  const pairs = [[h.m, c3], [h.c1, h.c2], [h.c0, c3]];
  const got = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) {
    const have = got.get(pairKey(b, a));
    // git diff's own reading: a file named as a commit makes that commit's name ambiguous there, and the call fails.
    assert.deepEqual(have ? [...have] : have, namesOf(h.dir, b, a), `${b.slice(0, 7)}..${a.slice(0, 7)}`);
  }
  assert.equal(got.get(pairKey(h.c1, h.c2)), null, "named as a file too: git diff cannot tell, and the walk says it could not");
  assert.ok(got.get(pairKey(h.m, c3))?.has(h.c2));
});

test("namesChangedAll: a repository with an order file, which the plumbing does not read, is read one by one, in the porcelain's order; without it, batched in git's", async () => {
  const h = history();
  writeFileSync(join(h.dir, "order.txt"), "x/*\nwith space.md\n*\n");
  git(h.dir, ["config", "diff.orderFile", "order.txt"]);
  /** @type {[string, string][]} */
  const pairs = [[h.c0, h.c2], [h.c0, h.m]];
  const ordered = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) assert.deepEqual([...(ordered.get(pairKey(b, a)) || [])], namesOf(h.dir, b, a), "the order file's order");
  assert.equal([...(ordered.get(pairKey(h.c0, h.c2)) || [])][0], "x/y.txt");
  git(h.dir, ["config", "--unset", "diff.orderFile"]);
  const plain = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) assert.deepEqual([...(plain.get(pairKey(b, a)) || [])], namesOf(h.dir, b, a));
});

test("namesChangedAll: a submodule's change the porcelain hides — by diff.ignoreSubmodules, or by its .gitmodules — is hidden as git diff hides it", async () => {
  const h = history();
  // A submodule's pointer, moved from one commit to another; no checkout of it is needed for a diff of two commits, and
  // the index is committed as it stands (an add of the folder would take the pointer away: there is no folder).
  const commitIndex = (/** @type {string} */ m) => {
    git(h.dir, ["commit", "-q", "-m", m]);
    return git(h.dir, ["rev-parse", "HEAD"]).trim();
  };
  git(h.dir, ["update-index", "--add", "--cacheinfo", `160000,${h.c0},sub`]);
  const p1 = commitIndex("p1");
  git(h.dir, ["update-index", "--cacheinfo", `160000,${h.c1},sub`]);
  const p2 = commitIndex("p2");
  /** @type {[string, string][]} */
  const pairs = [[h.m, p1], [p1, p2]];
  assert.deepEqual(namesOf(h.dir, p1, p2), ["sub"], "the porcelain names it, untold");
  git(h.dir, ["config", "diff.ignoreSubmodules", "all"]);
  assert.deepEqual(namesOf(h.dir, p1, p2), [], "told to ignore it, it does not");
  const ignored = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) assert.deepEqual([...(ignored.get(pairKey(b, a)) || [])], namesOf(h.dir, b, a));
  git(h.dir, ["config", "--unset", "diff.ignoreSubmodules"]);
  // A .gitmodules' ignore, which diff-tree reads as git diff does: the batch reads this repository, and agrees.
  writeFileSync(join(h.dir, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n\turl = ./nowhere\n\tignore = all\n');
  assert.deepEqual(namesOf(h.dir, p1, p2), [], "its .gitmodules hides it");
  const byModules = await namesChangedAll(h.dir, pairs);
  for (const [b, a] of pairs) assert.deepEqual([...(byModules.get(pairKey(b, a)) || [])], namesOf(h.dir, b, a));
});

// (fails before: no — the condition stood in the walk's own read of its gaps; it moved into gapAfter, and no test held it)
test("the walk marks a file changed between two steps only where the later step was taken just before its round", async () => {
  const h = history();
  // a.txt is the agent's in both steps, and went (moved away) between them: c1 → c2 is someone else's.
  for (const [base, also] of /** @type {[string, boolean][]} */ ([["round", true], ["last", false]])) {
    /** @type {any[]} */
    const rows = [
      { place: h.dir, round: 1, agent: "", before: h.c0, after: h.c1, base: "round", own: ["a.txt"], command: false, turn: 1 },
      { place: h.dir, round: 2, agent: "", before: h.c2, after: h.m, base, own: ["a.txt"], command: false, turn: 1 },
    ];
    const out = await ownChangesOf(rows);
    assert.deepEqual([out.errors, out.files.map((f) => [f.path, f.status, !!f.also])], [[], [["a.txt", "deleted", also]]], base);
  }
});

test("the walk's wiring: its command rounds' names and its gaps from namesChangedAll", () => {
  const src = readFileSync(new URL("../src/adapters/git/changes.js", import.meta.url), "utf8");
  assert.match(src, /const names = await namesChangedAll\(place, claimed\.map\(\(\{ st \}\) => \[st\.before, st\.after\]\)\);/);
  assert.match(src, /namesChangedAll\(place, steps\.flatMap\(\(st, s\) => \(gapAfter\(st, s\)/);
});
