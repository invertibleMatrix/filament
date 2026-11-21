// @ts-check
// A writing round takes two snapshots of each place, and every git run is a process: a snapshot reads where the
// repository stands in one run (its top folder, its index's path, HEAD), tells its object format from HEAD's name, and
// reads the previous snapshot's commit and tree in one more — the same trees, parents and words as before, in fewer
// processes. git's trace (GIT_TRACE2_EVENT, inherited like any variable a snapshot does not set) counts them.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitProgram, repoOf, snapshotTree } from "../src/adapters/git/snapshot.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim();
/** @param {{ commit?: boolean, format?: string }} [o] */
const repo = ({ commit = true, format = "" } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-spawns-"));
  made.push(dir);
  git(dir, ["init", "-q", ...(format ? [`--object-format=${format}`] : [])]);
  git(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  if (commit) {
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "init"]);
  }
  return dir;
};

/**
 * The git processes a call starts, by command, and what it answered.
 * @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, commands: string[] }>}
 */
const counted = async (fn) => {
  // The git to start is found first (`gitProgram`): its own `--exec-path` is not `fn`'s.
  await gitProgram();
  const t = mkdtempSync(join(tmpdir(), "filament-trace-"));
  made.push(t);
  const file = join(t, "trace.json");
  const was = process.env.GIT_TRACE2_EVENT;
  process.env.GIT_TRACE2_EVENT = file;
  try {
    const value = await fn();
    const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
    const commands = lines
      .map((l) => JSON.parse(l))
      .filter((e) => e.event === "start")
      .map((e) => /** @type {string[]} */ (e.argv).filter((a, i, all) => a !== "-c" && all[i - 1] !== "-c").slice(1)[0]);
    return { value, commands };
  } finally {
    if (was === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = was;
  }
};

test("where a folder stands is one git run: its top folder and HEAD (fails before: two)", { skip: !hasGit && "git is not on PATH" }, async () => {
  const dir = repo();
  const { value, commands } = await counted(() => repoOf(dir));
  assert.equal(value.repo?.toLowerCase().replace(/\\/g, "/"), dir.toLowerCase().replace(/\\/g, "/"));
  assert.equal(value.head, git(dir, ["rev-parse", "HEAD"]));
  assert.deepEqual(commands, ["rev-parse"]);
  const fresh = repo({ commit: false });
  const before = await counted(() => repoOf(fresh));
  assert.equal(before.value.head, null, "no commit yet: no HEAD");
  assert.ok(before.value.repo);
  assert.deepEqual(before.commands, ["rev-parse"]);
  const none = mkdtempSync(join(tmpdir(), "filament-none-"));
  made.push(none);
  const outside = await repoOf(none);
  assert.equal(outside.repo, null);
  assert.match(outside.error, /not a git repository|git refuses/);
});

test("a snapshot after the previous one: one run for where it stands, add, write-tree, one for the previous commit and its tree (fails before: 8 runs, 10 with a commit)", { skip: !hasGit && "git is not on PATH" }, async () => {
  const dir = repo();
  writeFileSync(join(dir, "b.txt"), "bee\n");
  const first = await snapshotTree(dir, { name: "c/1", keep: true });
  assert.ok(first.ok && first.changed, first.error || "");
  // Nothing moved since: no commit, the previous one stands — four runs.
  const same = await counted(() => snapshotTree(dir, { name: "c/2-before", previous: first.commit, keep: false }));
  assert.equal(same.value.ok, true);
  assert.equal(same.value.changed, false);
  assert.equal(same.value.at, first.commit, "the tree is the previous snapshot's");
  assert.equal(same.value.parent, first.commit);
  assert.deepEqual(same.commands, ["rev-parse", "add", "write-tree", "rev-parse"]);
  // A write since: a commit on its ref whose parent is the previous one — six runs.
  writeFileSync(join(dir, "b.txt"), "bee, edited\n");
  const next = await counted(() => snapshotTree(dir, { name: "c/2", previous: first.commit, keep: true }));
  assert.equal(next.value.changed, true, next.value.error || "");
  assert.equal(git(dir, ["rev-parse", `${next.value.commit}^`]), first.commit);
  assert.equal(git(dir, ["show", `${next.value.commit}:b.txt`]), "bee, edited");
  assert.deepEqual(next.commands, ["rev-parse", "add", "write-tree", "rev-parse", "commit-tree", "update-ref"]);
});

test("a previous commit the repository lacks falls back to HEAD, as before; no previous compares with HEAD's tree", { skip: !hasGit && "git is not on PATH" }, async () => {
  const dir = repo();
  const head = git(dir, ["rev-parse", "HEAD"]);
  const gone = await snapshotTree(dir, { name: "g", previous: "0123456789012345678901234567890123456789", keep: false });
  assert.equal(gone.ok, true, gone.error || "");
  assert.equal(gone.changed, false, "the tree is HEAD's");
  assert.equal(gone.parent, head);
  // A tree given as `previous` is no commit: HEAD stands in for it too.
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"]);
  const notCommit = await snapshotTree(dir, { name: "t", previous: tree, keep: false });
  assert.equal(notCommit.parent, head);
  const plain = await counted(() => snapshotTree(dir, { name: "h", keep: false }));
  assert.equal(plain.value.changed, false);
  assert.equal(plain.value.at, head);
  assert.deepEqual(plain.commands, ["rev-parse", "add", "write-tree", "rev-parse"]);
});

test("before the first commit the configuration says the object format, and the snapshot holds the files", { skip: !hasGit && "git is not on PATH" }, async () => {
  const dir = repo({ commit: false });
  git(dir, ["add", "a.txt"]);
  writeFileSync(join(dir, "c.txt"), "sea\n");
  const s = await counted(() => snapshotTree(dir, { name: "u", keep: false }));
  assert.equal(s.value.ok, true, s.value.error || "");
  assert.equal(s.value.changed, true);
  assert.equal(s.value.parent, null);
  assert.equal(git(dir, ["show", `${s.value.commit}:c.txt`]), "sea");
  assert.deepEqual(s.commands, ["rev-parse", "config", "add", "write-tree", "commit-tree"]);
});

// Since 11-09 its index is read by the size of its ids and seeded from, as a SHA-1 one's: read from HEAD, a sparse
// checkout's outside was taken for deleted (snapshot-sparse.test.js).
test("a SHA-256 repository is seeded from its index as a SHA-1 one is: its HEAD's name says its ids' size without asking the configuration", { skip: !hasGit && "git is not on PATH" }, async () => {
  /** @type {string} */
  let dir;
  try {
    dir = repo({ format: "sha256" });
  } catch {
    return; // a git without SHA-256 repositories
  }
  writeFileSync(join(dir, "b.txt"), "bee\n");
  const s = await counted(() => snapshotTree(dir, { name: "s", keep: false }));
  assert.equal(s.value.ok, true, s.value.error || "");
  assert.match(String(s.value.commit), /^[0-9a-f]{64}$/);
  assert.equal(git(dir, ["show", `${s.value.commit}:b.txt`]), "bee");
  assert.deepEqual(s.commands, ["rev-parse", "add", "write-tree", "rev-parse", "commit-tree"], "seeded, not read from HEAD");
});
