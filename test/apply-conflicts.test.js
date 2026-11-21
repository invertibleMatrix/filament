// @ts-check
// A sub-agent's work that overlaps the developer's edits (the Designer's of 10-27, built 10-28): each file that stops
// an apply says what kind of overlap it is, and offers the choices that kind has — keep yours, take its, or both with
// git's markers where lines overlap; Compare shows each overlap's three sides at its line in the developer's file; a
// parent that is a file stops it before the press, never at the write; and Send back to rebase redoes its change on the
// folder as it stands, the overlaps marked for it to resolve.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as worktree from "../src/adapters/git/worktree.js";

const { applyTaskWork, captureTaskWork, openTaskWorktree, previewApply, removeTaskWorktree, reviveTaskWorktree, taskRefs } = worktree;
/** @type {any} */
const w = worktree;

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
/** A repository with a.txt (ten lines), b.txt and d.txt committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-applyconf-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  writeFileSync(join(dir, "b.txt"), "bee\n");
  writeFileSync(join(dir, "d.txt"), "dee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {{ path: string, how: string }[]} came */
const ways = (came) => Object.fromEntries(came.map((c) => [c.path, c.how]));
/** @param {{ path: string, kind?: string }[]} conflicts */
const kinds = (conflicts) => Object.fromEntries(conflicts.map((c) => [c.path, c.kind]));
/**
 * The sub-agent's work, made in its own copy by `work`, captured and its copy gone.
 * @param {string} dir @param {string} id @param {(workdir: string) => void} work
 */
const subWork = async (dir, id, work) => {
  const o = await openTaskWorktree(dir, { id });
  assert.ok(o.ok);
  work(o.wt.workdir);
  const cap = await captureTaskWork(o.wt, { id });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  return { base: o.wt.base, head: cap.head };
};

// (fails before: yes — a file whose lines overlapped stopped the apply, with no kind and no way to choose: keep yours,
// take its, or both with markers)
test("a line overlap is kind lines with its count; each choice comes in its way — yours kept, its replaced, both with git's markers — and the rest as they would", async () => {
  /** @param {"yours" | "its" | "both"} choice */
  const run = async (choice) => {
    const dir = repo();
    const o = await subWork(dir, `sa_c0000${choice.length}`, (wd) => {
      writeFileSync(join(wd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
      writeFileSync(join(wd, "c.txt"), "sea\n");
    });
    writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
    const p = await previewApply(dir, o);
    assert.deepEqual(p.conflicts, [{ path: "a.txt", why: "1 change overlaps yours", kind: "lines", overlaps: 1 }]);
    const chosen = await previewApply(dir, o, { choices: { "a.txt": choice } });
    const how = { yours: "kept", its: "replaced", both: "markers" }[choice];
    assert.deepEqual([chosen.conflicts, ways(chosen.came)], [[], { "a.txt": how, "c.txt": "took" }], "the dry run with the choice");
    assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours\n"), "the dry run wrote nothing");
    const ap = await applyTaskWork(dir, o, { choices: { "a.txt": choice } });
    assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
    assert.deepEqual(ways(ap.came), ways(chosen.came), "the apply did what the dry run said");
    assert.equal(read(join(dir, "c.txt")), "sea\n");
    return read(join(dir, "a.txt"));
  };
  assert.equal(await run("yours"), TEN.replace("3\n", "three, yours\n"));
  assert.equal(await run("its"), TEN.replace("3\n", "THREE, its\n"));
  assert.equal(await run("both"), TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n"));
});

// (fails before: yes — the same: no kinds, and no choices to bring any of them in)
test("each kind of overlap is named, and offers only its own choices: its delete, its version where you deleted, its added file, a binary", async () => {
  assert.deepEqual(w.CHOICES, { lines: ["yours", "its", "both"], deleted: ["yours", "its"], gone: ["yours", "its"], added: ["yours", "its"], binary: ["yours", "its"], place: ["yours"], unread: ["yours"] });
  const dir = repo();
  writeFileSync(join(dir, "pic.bin"), Buffer.from([0, 1, 2, 3]));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "pic");
  const o = await subWork(dir, "sa_c0000010", (wd) => {
    rmSync(join(wd, "b.txt"));
    writeFileSync(join(wd, "d.txt"), "DEE, its\n");
    writeFileSync(join(wd, "e.txt"), "ee, its\n");
    writeFileSync(join(wd, "pic.bin"), Buffer.from([0, 9, 9, 9]));
  });
  writeFileSync(join(dir, "b.txt"), "bee, yours\n");
  rmSync(join(dir, "d.txt"));
  writeFileSync(join(dir, "e.txt"), "ee, yours\n");
  writeFileSync(join(dir, "pic.bin"), Buffer.from([0, 7, 7, 7]));
  const p = await previewApply(dir, o);
  assert.deepEqual(kinds(p.conflicts), { "b.txt": "deleted", "d.txt": "gone", "e.txt": "added", "pic.bin": "binary" });
  // Both with markers is no choice a binary has: it still stops.
  const odd = await previewApply(dir, o, { choices: { "b.txt": "its", "d.txt": "its", "e.txt": "its", "pic.bin": "both" } });
  assert.deepEqual([kinds(odd.conflicts), ways(odd.came)], [{ "pic.bin": "binary" }, { "b.txt": "deleted", "d.txt": "took", "e.txt": "replaced" }]);
  const ap = await applyTaskWork(dir, o, { choices: { "b.txt": "its", "d.txt": "its", "e.txt": "its", "pic.bin": "yours" } });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.deepEqual(ways(ap.came), { "b.txt": "deleted", "d.txt": "took", "e.txt": "replaced", "pic.bin": "kept" });
  assert.deepEqual([existsSync(join(dir, "b.txt")), read(join(dir, "d.txt")), read(join(dir, "e.txt"))], [false, "DEE, its\n", "ee, its\n"]);
  assert.deepEqual([...readFileSync(join(dir, "pic.bin"))], [0, 7, 7, 7], "yours kept");
});

// (fails before: yes — the Hunter's of 10-28: the dry run said the file would come in, and the apply failed at the write)
test("a file the sub-agent added under a folder that is a file in yours stops the apply before the press, named, and nothing is written", async () => {
  const dir = repo();
  const o = await subWork(dir, "sa_c0000020", (wd) => {
    mkdirSync(join(wd, "lib", "deep"), { recursive: true });
    writeFileSync(join(wd, "lib", "deep", "x.txt"), "ex\n");
    writeFileSync(join(wd, "c.txt"), "sea\n");
  });
  writeFileSync(join(dir, "lib"), "a file of yours\n");
  const p = await previewApply(dir, o);
  assert.deepEqual([p.conflicts, ways(p.came)], [[{ path: "lib/deep/x.txt", why: "your folder has a file where its folder should be (lib)", kind: "place" }], { "c.txt": "took" }]);
  const ap = await applyTaskWork(dir, o, { choices: { "lib/deep/x.txt": "its" } });
  assert.deepEqual(!ap.ok && kinds(ap.conflicts), { "lib/deep/x.txt": "place" }, "its version is no choice a place has");
  assert.equal(existsSync(join(dir, "c.txt")), false, "nothing written");
});

// (fails before: yes — there was no Compare)
test("Compare gives each overlap at its line in your file — past your own lines and its clean change above it — with yours, its start and its own", async () => {
  const dir = repo();
  const o = await subWork(dir, "sa_c0000030", (wd) => {
    // Its clean change: two lines ahead of 1; and its own 5 and 10 (git joins overlaps nearer than that into one).
    writeFileSync(join(wd, "a.txt"), `zero\nzero too\n${TEN.replace("5\n", "FIVE, its\n").replace("10\n", "TEN, its\n")}`);
  });
  // Yours: three lines of your own after 1, and your own 5 and 10.
  writeFileSync(join(dir, "a.txt"), TEN.replace("1\n", "1\nx\ny\nz\n").replace("5\n", "five, yours\n").replace("10\n", "ten, yours\n"));
  const c = await w.compareApply(dir, o, "a.txt");
  assert.ok(c.ok, c.error);
  assert.deepEqual(c, {
    ok: true,
    path: "a.txt",
    kind: "lines",
    why: "2 changes overlap yours",
    overlaps: [
      { at: 8, yours: ["five, yours"], start: ["5"], its: ["FIVE, its"] },
      { at: 13, yours: ["ten, yours"], start: ["10"], its: ["TEN, its"] },
    ],
  });
  assert.deepEqual([7, 12].map((i) => read(join(dir, "a.txt")).split("\n")[i]), ["five, yours", "ten, yours"], "lines 8 and 13 of yours");
  assert.deepEqual(await w.compareApply(dir, o, "nope.txt"), { ok: false, error: "nope.txt is not among the files of its work" });
});

// (fails before: yes — the Hunter's of 10-28: each overlap was found by your lines nearest the merge's count, which
// counts its clean lines too, so with your side the same at two places the first went to the second and the second
// past your file's end)
test("Compare places overlaps whose side of yours repeats, under many lines it added above them, each at its own line", async () => {
  const dir = repo();
  const o = await subWork(dir, "sa_c0000031", (wd) => {
    const top = Array.from({ length: 30 }, (_, i) => `its ${i + 1}`).join("\n");
    writeFileSync(join(wd, "a.txt"), `${top}\n${TEN.replace("5\n", "FIVE, its\n").replace("10\n", "TEN, its\n")}`);
  });
  writeFileSync(join(dir, "a.txt"), TEN.replace("5\n", "same\n").replace("10\n", "same\n"));
  const c = await w.compareApply(dir, o, "a.txt");
  assert.ok(c.ok, !c.ok ? c.error : "");
  assert.deepEqual(c.ok && c.overlaps, [
    { at: 5, yours: ["same"], start: ["5"], its: ["FIVE, its"] },
    { at: 10, yours: ["same"], start: ["10"], its: ["TEN, its"] },
  ]);
});

// (fails before: yes — there was no rebase: a sub-agent's work that overlapped could only be dropped or applied by hand)
test("rebase redoes its change on your folder as it is — overlaps marked, clean files in, what it cannot bring named — as a commit on its refs; the folder is untouched; once it resolves, its work applies cleanly", async () => {
  const dir = repo();
  const id = "sa_c0000040";
  const o = await subWork(dir, id, (wd) => {
    writeFileSync(join(wd, "a.txt"), TEN.replace("3\n", "THREE, its\n").replace("9\n", "NINE, its\n"));
    writeFileSync(join(wd, "b.txt"), "BEE, its\n");
    rmSync(join(wd, "d.txt"));
    writeFileSync(join(wd, "c.txt"), "sea\n");
  });
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  writeFileSync(join(dir, "d.txt"), "dee, yours\n");
  writeFileSync(join(dir, "e.txt"), "your own new file\n");
  const head = git(dir, "rev-parse", "HEAD");
  const status = git(dir, "status", "--porcelain");

  const r = await w.rebaseTaskWork(dir, id, o);
  assert.ok(r.ok, r.error);
  assert.deepEqual([r.marked, r.left], [["a.txt"], [{ path: "d.txt", why: "it deleted it; you changed it since", kind: "deleted" }]]);
  assert.deepEqual(r.files.map((/** @type {any} */ f) => f.path).sort(), ["a.txt", "b.txt", "c.txt"]);
  const at = (/** @type {string} */ c, /** @type {string} */ p) => git(dir, "show", `${c}:${p}`);
  assert.deepEqual([at(r.base, "a.txt"), at(r.base, "e.txt"), at(r.base, "d.txt")], [TEN.replace("3\n", "three, yours\n").trim(), "your own new file", "dee, yours"], "its new start is your folder now");
  assert.equal(at(r.head, "a.txt"), TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n").replace("9\n", "NINE, its\n").trim());
  assert.deepEqual([at(r.head, "b.txt"), at(r.head, "c.txt"), at(r.head, "d.txt")], ["BEE, its", "sea", "dee, yours"]);
  const refs = await taskRefs(dir, id);
  assert.deepEqual([refs?.base, refs?.head], [r.base, r.head], "kept on its refs");
  assert.deepEqual([git(dir, "rev-parse", "HEAD"), git(dir, "status", "--porcelain")], [head, status], "the folder, its index and HEAD as they were");

  // It revives on its new head, resolves the markers, and its work comes in cleanly.
  const back = await reviveTaskWorktree(dir, { id, base: r.base, head: r.head });
  assert.ok(back.ok, !back.ok ? back.error : "");
  assert.match(read(join(back.wt.workdir, "a.txt")), /^<<<<<<< yours$/m);
  writeFileSync(join(back.wt.workdir, "a.txt"), TEN.replace("3\n", "three, yours — and THREE, its\n").replace("9\n", "NINE, its\n"));
  const cap = await captureTaskWork(back.wt, { id, previous: r.head, base: r.base });
  assert.ok(cap.ok);
  await removeTaskWorktree(back.wt);
  const ap = await applyTaskWork(dir, { base: r.base, head: cap.head });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.deepEqual(ways(ap.came), { "a.txt": "took", "b.txt": "took", "c.txt": "took" });
  assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours — and THREE, its\n").replace("9\n", "NINE, its\n"));
  assert.equal(read(join(dir, "d.txt")), "dee, yours\n");
});

// (fails before: yes — the hunt of 11-09: the temporary index the rebase writes its commit's tree through took the
// repository's core.splitIndex, and the shared part of it stayed in the repository's git folder)
test("a repository that sets core.splitIndex: a rebase leaves no shared index in its git folder", async () => {
  const dir = repo();
  git(dir, "config", "core.splitIndex", "true");
  const id = "sa_c0000050";
  const o = await subWork(dir, id, (wd) => {
    writeFileSync(join(wd, "b.txt"), "BEE, its\n");
    writeFileSync(join(wd, "c.txt"), "sea\n");
  });
  writeFileSync(join(dir, "e.txt"), "your own new file\n");
  const shared = () => readdirSync(join(dir, ".git")).filter((n) => n.startsWith("sharedindex.")).sort();
  const had = shared();
  const r = await w.rebaseTaskWork(dir, id, o);
  assert.ok(r.ok, r.error);
  const at = (/** @type {string} */ p) => git(dir, "show", `${r.head}:${p}`);
  assert.deepEqual([at("b.txt"), at("c.txt"), at("e.txt")], ["BEE, its", "sea", "your own new file"]);
  assert.deepEqual(shared(), had);
});
