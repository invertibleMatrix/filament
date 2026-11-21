// @ts-check
// Carrying a chat's files between the places of a repository (HarnessV4_Git_Plan §12, GW-D82): a snapshot's files
// written into a worktree by git's own restore, a place's files put back to its last commit, what each file is now and
// in a commit, and which of them are uncommitted — against real repositories, a CRLF checkout among them (GWC-185).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobsAt, blobsAtEach, blobsNow, dirtyOf, toLastCommit, writeAs } from "../src/adapters/git/carry.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** @param {string} cwd @param {string[]} args */
const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
const fresh = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-carry-")));
  made.push(dir);
  return dir;
};
/**
 * A repository with a.txt, b.txt and sub/c.txt committed on main, and a worktree of it beside it on a branch.
 * @param {{ autocrlf?: string }} [o]
 */
const pair = ({ autocrlf = "false" } = {}) => {
  const base = fresh();
  const r = join(base, "r");
  mkdirSync(join(r, "sub"), { recursive: true });
  run(r, "init", "-q", "-b", "main");
  run(r, "config", "core.autocrlf", autocrlf);
  writeFileSync(join(r, "a.txt"), "one\n");
  writeFileSync(join(r, "b.txt"), "bee\n");
  writeFileSync(join(r, "sub", "c.txt"), "sea\n");
  run(r, "add", "-A");
  run(r, "commit", "-qm", "init");
  const wt = join(base, "r-wt");
  run(r, "worktree", "add", "-q", "-b", "wt", wt);
  return { r, wt };
};
/** The repository's snapshot as it stands, kept by no ref. @param {string} dir */
const snap = async (dir) => {
  const s = await snapshotTree(dir, { name: "carry", keep: false });
  assert.ok(s.ok && s.at, String(s.error));
  return String(s.at);
};
/** `git status` as the tests read it: one line per file, untracked ones by their own names. @param {string} dir */
const status = (dir) =>
  execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: dir, encoding: "utf8", windowsHide: true }).split("\n").filter(Boolean).sort();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");

// (fails before: yes — nothing carried a file from one place to another)
test("a snapshot's files written into a worktree: changed, new and deleted ones; its index left as it was", async () => {
  const { r, wt } = pair();
  writeFileSync(join(r, "a.txt"), "one\ntwo\n");
  mkdirSync(join(r, "sub", "deep"), { recursive: true });
  writeFileSync(join(r, "sub", "deep", "new.txt"), "new\n");
  rmSync(join(r, "b.txt"));
  writeFileSync(join(r, "staged.txt"), "staged\n");
  run(r, "add", "staged.txt");
  const at = await snap(r);
  assert.deepEqual(await writeAs(wt, at, ["a.txt", "sub/deep/new.txt", "b.txt", "staged.txt"]), { ok: true });
  assert.equal(read(join(wt, "a.txt")), "one\ntwo\n");
  assert.equal(read(join(wt, "sub", "deep", "new.txt")), "new\n");
  assert.equal(existsSync(join(wt, "b.txt")), false);
  assert.equal(read(join(wt, "staged.txt")), "staged\n");
  // Nothing staged there: what was staged comes out unstaged (GWC-184).
  assert.deepEqual(status(wt), [" D b.txt", " M a.txt", "?? staged.txt", "?? sub/deep/new.txt"]);
});

// (fails before: yes — nothing put a place's files back)
test("a place's files back to its last commit: a change undone, a staged and an untracked file removed with the folders they leave empty, a deleted one back; nothing else touched", async () => {
  const { r } = pair();
  writeFileSync(join(r, "a.txt"), "one\ntwo\n");
  writeFileSync(join(r, "staged.txt"), "staged\n");
  run(r, "add", "staged.txt");
  mkdirSync(join(r, "sub", "deep"), { recursive: true });
  writeFileSync(join(r, "sub", "deep", "new.txt"), "new\n");
  rmSync(join(r, "b.txt"));
  // Someone else's, on paths not named.
  writeFileSync(join(r, "other.txt"), "theirs\n");
  writeFileSync(join(r, "sub", "c.txt"), "sea\nmore\n");
  assert.deepEqual(await toLastCommit(r, ["a.txt", "staged.txt", "sub/deep/new.txt", "b.txt"]), { ok: true });
  assert.equal(read(join(r, "a.txt")), "one\n");
  assert.equal(read(join(r, "b.txt")), "bee\n");
  assert.equal(existsSync(join(r, "staged.txt")), false);
  assert.equal(existsSync(join(r, "sub", "deep")), false, "the folder it left empty went too");
  assert.equal(existsSync(join(r, "sub")), true, "a folder that holds something else stays");
  assert.deepEqual(status(r), [" M sub/c.txt", "?? other.txt"]);
});

// (fails before: yes — GWC-183)
test("a rename: its new path written and its old one gone there; back at the last commit, the old path returns and the new one goes", async () => {
  const { r, wt } = pair();
  renameSync(join(r, "a.txt"), join(r, "z.txt"));
  const at = await snap(r);
  assert.deepEqual(await writeAs(wt, at, ["z.txt", "a.txt"]), { ok: true });
  assert.deepEqual([existsSync(join(wt, "a.txt")), read(join(wt, "z.txt"))], [false, "one\n"]);
  assert.deepEqual(await toLastCommit(r, ["z.txt", "a.txt"]), { ok: true });
  assert.deepEqual([read(join(r, "a.txt")), existsSync(join(r, "z.txt"))], ["one\n", false]);
  assert.deepEqual(status(r), []);
});

// (fails before: no — git took this name as itself without GIT_LITERAL_PATHSPECS too, in a probe of both writes; the
// test holds the promise that a path is a name)
test("each path reaches git as a name: a name with brackets is that file alone", async () => {
  const { r } = pair();
  writeFileSync(join(r, "a.txt"), "one\nmine\n");
  writeFileSync(join(r, "b.txt"), "bee\nmine\n");
  writeFileSync(join(r, "[ab].txt"), "brackets\n");
  run(r, "add", "[[]ab].txt");
  assert.deepEqual(await toLastCommit(r, ["[ab].txt"]), { ok: true });
  assert.equal(existsSync(join(r, "[ab].txt")), false);
  assert.deepEqual(status(r), [" M a.txt", " M b.txt"]);
});

// (fails before: yes — GWC-185)
test("on a CRLF checkout, a carried file comes out as a checkout makes it, and reads as the snapshot holds it", async () => {
  const { r, wt } = pair({ autocrlf: "true" });
  writeFileSync(join(r, "a.txt"), "one\r\ntwo\r\n");
  const at = await snap(r);
  const [now, held] = await Promise.all([blobsNow(r, ["a.txt"]), blobsAt(r, at, ["a.txt"])]);
  assert.ok(now.ok && held.ok);
  assert.equal(now.blobs.get("a.txt"), held.blobs.get("a.txt"), "the file reads as git would add it");
  assert.deepEqual(await writeAs(wt, at, ["a.txt"]), { ok: true });
  assert.equal(read(join(wt, "a.txt")), "one\r\ntwo\r\n");
  const there = await blobsNow(wt, ["a.txt"]);
  assert.ok(there.ok);
  assert.equal(there.blobs.get("a.txt"), held.blobs.get("a.txt"));
});

// (fails before: yes — nothing read them)
test("what each file is now and in a commit: none where there is no file, a folder named as no plain file; what is uncommitted on the paths", async () => {
  const { r } = pair();
  const now = await blobsNow(r, ["a.txt", "sub", "nope.txt"]);
  const head = await blobsAt(r, "HEAD", ["a.txt", "sub", "nope.txt"]);
  assert.ok(now.ok && head.ok);
  assert.deepEqual([now.blobs.get("a.txt") === head.blobs.get("a.txt"), now.blobs.get("sub"), now.blobs.get("nope.txt"), now.odd], [true, null, null, ["sub"]]);
  assert.deepEqual([head.blobs.get("sub"), head.blobs.get("nope.txt")], [null, null], "a folder is no blob in a commit");
  writeFileSync(join(r, "a.txt"), "one\ntwo\n");
  writeFileSync(join(r, "s.txt"), "s\n");
  run(r, "add", "s.txt");
  writeFileSync(join(r, "u.txt"), "u\n");
  renameSync(join(r, "sub", "c.txt"), join(r, "sub", "d.txt"));
  run(r, "add", "-A", "sub");
  assert.deepEqual(await dirtyOf(r, ["a.txt", "s.txt", "u.txt", "b.txt", "sub/c.txt", "sub/d.txt"]), { ok: true, dirty: ["a.txt", "s.txt", "u.txt", "sub/c.txt", "sub/d.txt"] });
});

// (fails before: yes — the move read asked git once per snapshot its chat's rounds took, one after another: 50 s for a
// chat of 74 turns on the owner's Filament, 10-30)
test("many commits' files in one git call answer as each commit's own read does: a file, none, a folder, a commit not there, a name with spaces and signs", async () => {
  const { r } = pair();
  const first = run(r, "rev-parse", "HEAD");
  writeFileSync(join(r, "a.txt"), "one\ntwo\n");
  writeFileSync(join(r, "odd name & (x) #1.txt"), "odd\n");
  run(r, "add", "-A");
  run(r, "commit", "-qm", "two");
  const second = run(r, "rev-parse", "HEAD");
  const gone = "0123456789abcdef0123456789abcdef01234567";
  const paths = ["a.txt", "sub", "sub/c.txt", "nope.txt", "odd name & (x) #1.txt"];
  const asks = new Map([[first, paths], [second, paths], [gone, ["a.txt"]], ["HEAD", ["b.txt"]]]);
  const each = await blobsAtEach(r, asks);
  assert.ok(each.ok, !each.ok ? each.error : "");
  for (const rev of [first, second, "HEAD"]) {
    const own = await blobsAt(r, rev, /** @type {string[]} */ (asks.get(rev)));
    assert.ok(own.ok);
    assert.deepEqual([...each.held.get(rev) || []], [...own.blobs], `as ${rev}'s own read`);
  }
  assert.deepEqual([...each.held.get(gone) || []], [["a.txt", null]], "a commit not there holds nothing");
  assert.notEqual(each.held.get(first)?.get("a.txt"), each.held.get(second)?.get("a.txt"));
  assert.equal(each.held.get(first)?.get("odd name & (x) #1.txt"), null);
  assert.ok(each.held.get(second)?.get("odd name & (x) #1.txt"));
  assert.deepEqual(await blobsAtEach(r, new Map()), { ok: true, held: new Map() });
});

// (fails before: yes — the bug hunt of 10-30 on 139a9cdc3: every question went in one call, and git's answer past the
// runner's 8 MB refused the move's read with a 409; the questions a long chat asks of every snapshot get there)
test("many commits' questions past what one git answer holds go in parts, and each is answered", async () => {
  const { r } = pair();
  const head = run(r, "rev-parse", "HEAD");
  // Each a line of about 110 bytes in git's answer, missing: some 90,000 pass 8 MB.
  const missing = Array.from({ length: 90_000 }, (_, i) => `gone/a-file-that-is-not-there-with-a-long-name-${String(i).padStart(6, "0")}.txt`);
  const each = await blobsAtEach(r, new Map([[head, ["a.txt", ...missing, "sub/c.txt"]]]));
  assert.ok(each.ok, !each.ok ? each.error : "");
  const held = each.held.get(head);
  assert.ok(held?.get("a.txt") && held?.get("sub/c.txt"), "the files there, found");
  assert.equal([...(held?.values() || [])].filter((b) => b == null).length, missing.length, "the rest, none");
});

// (fails before: no — guards the parts a long list goes in, under Windows' command-line limit)
test("a long list of paths goes in parts", async () => {
  const { r, wt } = pair();
  const paths = Array.from({ length: 230 }, (_, i) => `many/file-${String(i).padStart(3, "0")}-with-a-long-name-to-fill-the-command-line.txt`);
  mkdirSync(join(r, "many"));
  for (const p of paths) writeFileSync(join(r, p), `${p}\n`);
  const at = await snap(r);
  assert.deepEqual(await writeAs(wt, at, paths), { ok: true });
  assert.ok(paths.every((p) => existsSync(join(wt, p))));
  assert.deepEqual(await toLastCommit(r, paths), { ok: true });
  assert.equal(existsSync(join(r, "many")), false);
});
