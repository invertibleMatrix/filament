// @ts-check
// The count a draft says of the files its worktree leaves behind (HarnessV4_OneAgent_Plan OA5; the hunt of 11-02, bug 3):
// `leftBehind` counts the files Bring my uncommitted edits would copy — the working tree's difference from the last
// commit, plus untracked plain files git does not ignore — no more and no fewer. `git status` rows are not that: a
// rename is one row where the copy carries two files, a change staged and undone in the working tree is one row where
// the copy carries none, an untracked link is a row where the copy leaves it. Against real repositories under the
// system's temp folder, the count held against what `bringUncommitted` then copies. Where no worktree would be made —
// no git, no repository, no commit — the count is null and ok, as `ownWorktree` works in the folder then; git refusing
// a repository is a failure in words.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bringUncommitted } from "../src/adapters/git/carry.js";
import { leftBehind, ownWorktree } from "../src/adapters/git/places.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** @param {string} cwd @param {string[]} args */
const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
/** git with its input. @param {string} cwd @param {string} input @param {string[]} args */
const feed = (cwd, input, ...args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, input, encoding: "utf8", windowsHide: true }).trim();
const fresh = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-bring-count-")));
  made.push(dir);
  return dir;
};
/** A repository with one commit of the files given. @param {Record<string, string>} files @param {string} [name] */
const repoOf = (files, name = "repo") => {
  const r = join(fresh(), name);
  mkdirSync(r);
  run(r, "init", "-q", "-b", "main");
  run(r, "config", "core.autocrlf", "false");
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(r, p, ".."), { recursive: true });
    writeFileSync(join(r, p), text);
  }
  run(r, "add", "-A");
  run(r, "commit", "-qm", "init");
  return r;
};
/** The count, then what the copy carries into a fresh worktree of the same repository. @param {string} r @param {string} name */
const countAndCopy = async (r, name) => {
  const count = await leftBehind(r);
  const got = /** @type {any} */ (await ownWorktree(r, name));
  assert.ok(got.ok, JSON.stringify(got));
  const out = /** @type {any} */ (await bringUncommitted(got.place, got.folder, got.commit));
  assert.equal(out.ok, true, String(out.error));
  return { count, files: /** @type {string[]} */ (out.files).sort(), stays: /** @type {string[]} */ (out.stays).sort(), worktree: /** @type {string} */ (got.folder) };
};
/** A link made where the machine allows one (Windows asks for Developer Mode): false where it does not. @param {string} target @param {string} at */
const linkOrNot = (target, at) => {
  try {
    symlinkSync(target, at, "file");
    return true;
  } catch {
    return false;
  }
};

describe("the count is what Bring my uncommitted edits copies (places.js leftBehind)", () => {
  // (fails before: yes — a rename was one `git status` row, and the count said 1 where the copy carried old.txt gone and new.txt new)
  test("a rename is its two files: the old one gone, the new one new to the commit", async () => {
    const r = repoOf({ "old.txt": "old\n", "keep.txt": "kept\n" });
    run(r, "mv", "old.txt", "new.txt");
    const { count, files } = await countAndCopy(r, "flow-rename");
    assert.deepEqual(files, ["new.txt", "old.txt"], "what the copy carries");
    assert.deepEqual(count, { ok: true, count: 2 });
    // The same move made by hand, nothing staged: the old name gone from the working tree, the new one untracked.
    const r2 = repoOf({ "old.txt": "old\n" });
    rmSync(join(r2, "old.txt"));
    writeFileSync(join(r2, "new.txt"), "old\n");
    const second = await countAndCopy(r2, "flow-rename-2");
    assert.deepEqual(second.files, ["new.txt", "old.txt"]);
    assert.deepEqual(second.count, { ok: true, count: 2 });
  });

  // (fails before: yes — the row `MM a.txt` was counted, where the copy, reading the working tree against the commit, found nothing to carry)
  test("a change staged and undone in the working tree is none: the working tree is the commit's again", async () => {
    const r = repoOf({ "a.txt": "one\n", "b.txt": "bee\n" });
    writeFileSync(join(r, "a.txt"), "two\n");
    run(r, "add", "a.txt");
    writeFileSync(join(r, "a.txt"), "one\n");
    assert.match(run(r, "status", "--porcelain=v1"), /^MM a\.txt$/m, "git status says staged and changed again");
    const { count, files } = await countAndCopy(r, "flow-restored");
    assert.deepEqual(files, [], "nothing differs from the commit in the working tree");
    assert.deepEqual(count, { ok: true, count: 0 });
    // Staged and changed again to something else: one file, as the copy carries it.
    writeFileSync(join(r, "a.txt"), "three\n");
    writeFileSync(join(r, "b.txt"), "bee\nmore\n");
    run(r, "add", "b.txt");
    writeFileSync(join(r, "b.txt"), "bee\nmore\nagain\n");
    const again = await countAndCopy(r, "flow-restored-2");
    assert.deepEqual(again.files, ["a.txt", "b.txt"]);
    assert.deepEqual(again.count, { ok: true, count: 2 });
  });

  // (fails before: yes — `AD new.txt` was one row; `D. a.txt` and `? a.txt` two, where the copy, adding a.txt back as it stands, carried nothing)
  test("a file staged as new and deleted again is none; a file taken out of the index but kept is as its content is", async () => {
    const r = repoOf({ "a.txt": "one\n" });
    writeFileSync(join(r, "new.txt"), "new\n");
    run(r, "add", "new.txt");
    rmSync(join(r, "new.txt"));
    run(r, "rm", "-q", "--cached", "a.txt");
    assert.match(run(r, "status", "--porcelain=v1"), /^AD new\.txt$/m);
    assert.match(run(r, "status", "--porcelain=v1"), /^D {2}a\.txt$/m);
    assert.match(run(r, "status", "--porcelain=v1"), /^\?\? a\.txt$/m);
    const { count, files } = await countAndCopy(r, "flow-added-gone");
    assert.deepEqual(files, [], "a.txt as the commit holds it: nothing to carry");
    assert.deepEqual(count, { ok: true, count: 0 });
    writeFileSync(join(r, "a.txt"), "one\nchanged\n");
    const changed = await countAndCopy(r, "flow-added-gone-2");
    assert.deepEqual(changed.files, ["a.txt"]);
    assert.deepEqual(changed.count, { ok: true, count: 1 });
  });

  // (fails before: yes — a conflicted path was one, whatever its working tree held)
  test("a path in conflict is as its content is: the commit's own again, none; anything else, one", async () => {
    const r = repoOf({ "a.txt": "one\n", "b.txt": "bee\n" });
    run(r, "checkout", "-q", "-b", "other");
    writeFileSync(join(r, "a.txt"), "theirs\n");
    run(r, "commit", "-qam", "theirs");
    run(r, "checkout", "-q", "main");
    writeFileSync(join(r, "a.txt"), "ours\n");
    run(r, "commit", "-qam", "ours");
    assert.throws(() => run(r, "merge", "other"), "the merge conflicts");
    assert.match(run(r, "status", "--porcelain=v1"), /^UU a\.txt$/m);
    writeFileSync(join(r, "a.txt"), "ours\n");
    const back = await countAndCopy(r, "flow-conflict");
    assert.deepEqual(back.files, [], "the commit's content again: nothing to carry");
    assert.deepEqual(back.count, { ok: true, count: 0 });
    writeFileSync(join(r, "a.txt"), "ours\ntheirs\n");
    const kept = await countAndCopy(r, "flow-conflict-2");
    assert.deepEqual(kept.files, ["a.txt"]);
    assert.deepEqual(kept.count, { ok: true, count: 1 });
  });

  // (fails before: yes — a conflicted row's second column was read as the working tree's: `UD` with the file kept as it is
  // counted a deletion, 1 where the copy carried none; `DD` with the file made again on disk counted none, 0 where the
  // copy carried it)
  test("every kind of conflict is read as the copy reads it: DD, AU, UD, UA, DU, AA, UU, the file kept, changed or gone", async () => {
    const markers = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n";
    /** @type {{ xy: string, base: string | null, ours: string | null, theirs: string | null, disk: [string | null, number][] }[]} */
    const kinds = [
      { xy: "DD", base: "base\n", ours: null, theirs: null, disk: [[null, 0], ["made again\n", 1]] },
      { xy: "AU", base: null, ours: "ours\n", theirs: null, disk: [["ours\n", 0], ["ours\nmore\n", 1]] },
      { xy: "UD", base: "base\n", ours: "ours\n", theirs: null, disk: [["ours\n", 0], [null, 1]] },
      { xy: "UA", base: null, ours: null, theirs: "theirs\n", disk: [["theirs\n", 1], [null, 0]] },
      { xy: "DU", base: "base\n", ours: null, theirs: "theirs\n", disk: [["theirs\n", 1], [null, 0]] },
      { xy: "AA", base: null, ours: "ours\n", theirs: "theirs\n", disk: [[markers, 1], ["ours\n", 0]] },
      { xy: "UU", base: "base\n", ours: "ours\n", theirs: "theirs\n", disk: [[markers, 1], ["ours\n", 0]] },
    ];
    for (const k of kinds) {
      // The commit holds ours where there is one; the index holds the stages the kind is made of (`update-index`'s own
      // form, as a merge leaves them); the working tree holds what the person left there.
      const r = repoOf({ "keep.txt": "kept\n", ...(k.ours ? { "a.txt": k.ours } : {}) }, `repo-${k.xy}`);
      const stages = [[1, k.base], [2, k.ours], [3, k.theirs]].filter((s) => s[1] != null).map(([stage, text]) => `100644 ${feed(r, String(text), "hash-object", "-w", "--stdin")} ${stage}\ta.txt`);
      feed(r, `0 0000000000000000000000000000000000000000\ta.txt\n${stages.join("\n")}\n`, "update-index", "--index-info");
      for (const [i, [text, expected]] of k.disk.entries()) {
        if (text == null) rmSync(join(r, "a.txt"), { force: true });
        else writeFileSync(join(r, "a.txt"), text);
        assert.match(run(r, "status", "--porcelain=v1"), new RegExp(`^${k.xy} a\\.txt$`, "m"), `${k.xy}: git says so`);
        const { count, files } = await countAndCopy(r, `flow-${k.xy}-${i}`);
        assert.deepEqual(files, expected ? ["a.txt"] : [], `${k.xy}, ${text == null ? "the file gone" : JSON.stringify(text)}: what the copy carries`);
        assert.deepEqual(count, { ok: true, count: expected }, `${k.xy}, ${text == null ? "the file gone" : JSON.stringify(text)}: the count`);
      }
    }
  });

  // (fails before: yes — every `?` row was one, and a `D.` row kept on disk as a link was hashed as nothing and counted)
  test("an untracked link is none, as the copy leaves it; so is a tracked file that is a link now", async (t) => {
    const r = repoOf({ "a.txt": "one\n", "b.txt": "bee\n", "c.txt": "sea\n" });
    if (!linkOrNot("b.txt", join(r, "link.txt"))) return t.skip("this machine makes no links");
    writeFileSync(join(r, "new.txt"), "new\n");
    run(r, "rm", "-q", "--cached", "a.txt");
    rmSync(join(r, "a.txt"));
    symlinkSync("b.txt", join(r, "a.txt"), "file");
    assert.match(run(r, "status", "--porcelain=v1"), /^\?\? link\.txt$/m);
    const { count, files, stays } = await countAndCopy(r, "flow-links");
    assert.deepEqual(files, ["new.txt"], "the plain file alone is carried");
    assert.deepEqual(stays, ["a.txt", "link.txt"]);
    assert.deepEqual(count, { ok: true, count: 1 });
  });

  test("an embedded repository and a submodule are none, as the copy leaves them; a file that became a folder is the folder's files and the file gone", async () => {
    const src = repoOf({ "s.txt": "sub\n" }, "sub-src");
    const r = repoOf({ "a.txt": "one\n", foo: "a file\n" });
    run(r, "-c", "protocol.file.allow=always", "submodule", "add", "-q", src, "sub");
    run(r, "commit", "-qm", "with a submodule");
    writeFileSync(join(r, "sub", "s.txt"), "sub\nmoved\n");
    run(join(r, "sub"), "commit", "-qam", "moved");
    assert.match(run(r, "status", "--porcelain=v1"), /^ ?M sub$/m, "the submodule's commit moved");
    const nested = join(r, "nested");
    mkdirSync(nested);
    run(nested, "init", "-q", "-b", "main");
    writeFileSync(join(nested, "n.txt"), "nested\n");
    run(nested, "add", "-A");
    run(nested, "commit", "-qm", "nested");
    rmSync(join(r, "foo"));
    mkdirSync(join(r, "foo"));
    writeFileSync(join(r, "foo", "x.txt"), "in a folder now\n");
    writeFileSync(join(r, "foo", "y.txt"), "and another\n");
    const { count, files, stays } = await countAndCopy(r, "flow-nested");
    assert.deepEqual(files, ["foo", "foo/x.txt", "foo/y.txt"]);
    assert.deepEqual(stays, ["nested", "sub"]);
    assert.deepEqual(count, { ok: true, count: 3 });
  });

  // (fails before: yes — git's English "not a git repository" was matched, which Git for Windows localizes, and no git at
  // all was a failure said on the card, where ownWorktree works in the folder on either)
  test("where no worktree would be made — no repository above the folder, no git to ask, no commit yet — null, and ok", async () => {
    const plain = join(fresh(), "plain");
    mkdirSync(plain);
    assert.deepEqual(await leftBehind(plain), { ok: true, count: null }, "no repository");
    const empty = join(fresh(), "empty");
    mkdirSync(empty);
    run(empty, "init", "-q", "-b", "main");
    writeFileSync(join(empty, "a.txt"), "one\n");
    assert.deepEqual(await leftBehind(empty), { ok: true, count: null }, "no commit yet");
    // No git on the PATH: asked in a process of its own, with none.
    const repo = repoOf({ "a.txt": "one\n" });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
    const script = `import { leftBehind } from ${JSON.stringify(pathToFileURL(resolve("src/adapters/git/places.js")).href)};\nconsole.log(JSON.stringify([await leftBehind(${JSON.stringify(plain)}), await leftBehind(${JSON.stringify(repo)})]));`;
    const said = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...env, Path: "", PATH: "" }, encoding: "utf8", windowsHide: true }).trim();
    assert.deepEqual(JSON.parse(said), [{ ok: true, count: null }, { ok: true, count: null }], "no git: a box works in the folder, nothing is left behind");
  });

  // (fails before: yes — git's refusal was null, "no worktree would be made", where ownWorktree refuses the fire in words)
  test("git refusing the repository the folder is in is a failure, in git's words", async () => {
    const r = repoOf({ "a.txt": "one\n" });
    writeFileSync(join(r, ".git", "index"), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]));
    const out = await leftBehind(r);
    assert.equal(out.ok, false);
    assert.match(/** @type {any} */ (out).error, /^git refuses the repository this folder is in: .*(signature|index)/);
  });
});
