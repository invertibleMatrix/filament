// @ts-check
// A chat whose folder is gone (the hunt of 11-03, sa_a70855e6): its draft's count is a failure said in words, never
// "nothing to count" — that answer frees Start with no word, and the flow's first writing team fails at its fire. git
// started in a folder that does not exist fails as a missing git does (ENOENT), so git's words say which: the folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/adapters/git/snapshot.js";
import { leftBehind } from "../src/adapters/git/places.js";

/** A folder that was there and is gone. */
const goneFolder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-bring-gone-"));
  rmSync(dir, { recursive: true, force: true });
  return dir;
};

// (fails before: yes — git's words said git was missing)
test("git started in a folder that does not exist says the folder, not that git is missing", async () => {
  const dir = goneFolder();
  const r = await git(["status", "--porcelain=v2"], { cwd: dir });
  assert.equal(r.code, -1);
  assert.match(String(r.error), /does not exist/);
  assert.ok(String(r.error).includes(dir), r.error ?? "");
  assert.doesNotMatch(String(r.error), /not installed/);
});

// (fails before: yes — the count was { ok: true, count: null }, nothing to say, and Start went free)
test("the count of a folder that is gone is a failure in words", async () => {
  const dir = goneFolder();
  const r = await leftBehind(dir);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.match("error" in r ? r.error : "", /does not exist/);
});
