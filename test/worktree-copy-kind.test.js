// @ts-check
// What the kind of a helper's copy is chosen by, and a sparse copy that widens itself (the owner's plan of 11-09 for
// big repos): the build caches git ignores, whether the drive clones — asked only where there is something warm to
// keep —, whether the repository is big; a read or a write outside a sparse copy's cone brings its folder in first,
// through any of Filament's file tools; a patch moved to a sparse copy holds what it read. Real throwaway repositories
// under the temp folder; which drive clones is the probe's answer, given here.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFacts, openTaskWorktree, releaseTaskWorktree, widenFor } from "../src/adapters/git/worktree.js";
import { buildCaches, setCowProbe } from "../src/adapters/git/cow.js";
import { widenedWords } from "../src/adapters/git/sparse.js";
import { openPatch, promotePatch } from "../src/adapters/git/patch.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { McpToolServer } from "../src/http/mcp.js";
import { copyMeta } from "./helpers/copies.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
afterEach(() => setCowProbe(null));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {string} p @param {string} text */
const put = (p, text) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
const FILES = {
  ".gitignore": "Library/\nnode_modules/\npkg/a/obj/\n",
  "package.json": "{}\n",
  "README.md": "readme\n",
  "pkg/package.json": "{}\n",
  "pkg/a/index.js": "a\n",
  "pkg/a/util.js": "a util\n",
  "pkg/b/index.js": "b\n",
  "pkg/b/more.js": "b more\n",
  "lib/c/x.js": "x\n",
  "lib/c/y.js": "y\n",
  "docs/d/guide.md": "guide\n",
  "docs/d/more.md": "more\n",
  "tools/e/run.js": "run\n",
  "vendor/f/one.js": "one\n",
  "vendor/f/two.js": "two\n",
  "vendor/f/three.js": "three\n",
};
/** A repository of five folders' files, committed. */
const repo = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-copy-kind-")));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  for (const [p, s] of Object.entries(FILES)) put(join(dir, p), s);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** Its files kept with Git LFS, as its attributes say: a big repository. @param {string} dir */
const lfs = (dir) => {
  put(join(dir, "assets", ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  git(dir, "add", "-A");
  git(dir, "-c", "core.hooksPath=.no-hooks", "commit", "-qm", "lfs");
};

// (fails before: yes — nothing read a repository's build caches: a clone was never chosen)
test("the build caches a clone keeps warm: the ones git ignores at the top and in the session's folder — never a dependency folder, nor one git tracks or does not ignore", async () => {
  const dir = repo();
  put(join(dir, "Library", "ArtifactDB"), "imported assets\n");
  put(join(dir, "node_modules", "x", "index.js"), "module.exports = 1;\n");
  put(join(dir, "target", "debug", "out"), "not ignored: the developer's own folder\n");
  put(join(dir, "pkg", "a", "obj", "Debug", "a.dll"), "built\n");
  assert.deepEqual(await buildCaches(dir, join(dir, "pkg", "a")), ["Library", "pkg/a/obj"]);
  assert.deepEqual(await buildCaches(dir, dir), ["Library"], "the session's folder is the top: its own alone");
  const bare = repo();
  assert.deepEqual(await buildCaches(bare, join(bare, "pkg")), [], "none there");
});

// (fails before: yes — the same: nothing gathered what the choice of a copy's kind reads)
test("what a copy's kind is chosen by: big or not, the caches, and whether the drive clones — asked only where there are caches", async () => {
  let asked = 0;
  setCowProbe(async () => (asked++, { cow: true, how: "the test's drive clones", verified: true }));
  const plain = repo();
  assert.deepEqual(await copyFacts(join(plain, "pkg", "a")), { big: null, cow: false, caches: [] });
  assert.equal(asked, 0, "nothing warm to keep: the drive is not asked");
  lfs(plain);
  assert.equal((await copyFacts(plain))?.big, "lfs");
  const warm = repo();
  put(join(warm, "Library", "ArtifactDB"), "imported assets\n");
  assert.deepEqual(await copyFacts(warm), { big: null, cow: true, caches: ["Library"] });
  assert.equal(asked, 1);
  const none = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-copy-kind-none-")));
  made.push(none);
  assert.equal(await copyFacts(none), null, "no repository: nothing to choose by");
});

// (fails before: yes — a read or a write outside a sparse copy's cone found nothing, or made a file beside the ones the
// copy does not hold)
test("a path outside a sparse copy's cone brings its folder in first; inside the cone, at the top, in a new folder, in a whole copy or outside any copy, nothing moves", async () => {
  const dir = repo();
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_widen01", kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  assert.deepEqual(wt.cone, ["pkg/a"], "the copy says the cone it holds");
  for (const p of ["pkg/a/index.js", "README.md", "pkg/package.json", "brand/new/file.js", "pkg/a/new/deeper.js"])
    assert.equal(await widenFor(join(wt.dest, p)), null, `${p}: nothing to bring in`);
  assert.equal(await widenFor(join(dir, "lib", "c", "x.js")), null, "the developer's own folder is no copy");
  assert.ok(!existsSync(join(wt.dest, "lib")));
  const w = await widenFor(join(wt.dest, "lib", "c", "x.js"));
  assert.ok(w?.ok, w && !w.ok ? w.error : "");
  assert.deepEqual([w?.ok && w.added, w?.rel], [["lib/c"], "lib/c/x.js"]);
  assert.deepEqual([read(join(wt.dest, "lib", "c", "x.js")), read(join(wt.dest, "lib", "c", "y.js"))], ["x\n", "y\n"]);
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["lib/c", "pkg/a"]);
  assert.equal(await widenFor(join(wt.dest, "lib", "c", "y.js")), null, "brought in once");
  assert.equal(widenedWords(/** @type {any} */ (w), "filament"), "[Filament: lib/c/x.js lies outside the folders your sparse copy held: it holds lib/c/ now too.]");
  assert.equal(
    widenedWords({ ok: false, error: "git read-tree failed: x", folder: "docs/d", rel: "docs/d/guide.md" }, "filament"),
    "[Filament: docs/d/guide.md lies outside the folders your sparse copy holds, and docs/d/ could not be brought in (git read-tree failed: x): run `filament workspace widen docs/d` in your copy.]",
  );
  await releaseTaskWorktree(wt, "parked");
  const whole = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_widen02" });
  assert.ok(whole.ok, !whole.ok ? whole.error : "");
  assert.equal(await widenFor(join(whole.wt.dest, "tools", "e", "run.js")), null, "a copy that holds every file");
  await releaseTaskWorktree(whole.wt, "parked");
});

// (fails before: yes — a reply's reads run side by side: two widens of one copy each took its index at once)
test("reads side by side outside a sparse copy's cone widen it one at a time: each folder comes in, and one asked twice comes once", async () => {
  const dir = repo();
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_widen05", kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  const got = await Promise.all(["lib/c/x.js", "docs/d/guide.md", "tools/e/run.js", "lib/c/y.js"].map((p) => widenFor(join(wt.dest, p))));
  assert.deepEqual(got.map((w) => (w?.ok ? w.added : w)), [["lib/c"], ["docs/d"], ["tools/e"], null]);
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["docs/d", "lib/c", "pkg/a", "tools/e"]);
  assert.equal(read(join(wt.dest, "tools", "e", "run.js")), "run\n");
  await releaseTaskWorktree(wt, "parked");
});

// (fails before: yes — Filament's MCP Write and Edit wrote where the copy's cone does not reach: an Edit found no file)
test("Filament's MCP Write and Edit bring a sparse copy's folder in before they write, and say so", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_widen03", kind: "sparse", paths: ["pkg/a"] });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  assert.ok(!existsSync(join(wt.dest, "tools")));
  const hands = {
    writeTextFile: async (/** @type {any} */ p) => writeFileSync(p.path, p.content),
    editTextFile: async (/** @type {any} */ p) => {
      writeFileSync(p.path, read(p.path).replace(p.edits[0].old_string, p.edits[0].new_string));
      return `Edited ${p.path}`;
    },
  };
  const server = new McpToolServer({ bridge: { permitLocal: async () => {} }, hands, cli: "filament" });
  const edited = await server.call("Edit", { file_path: join(wt.dest, "tools", "e", "run.js"), old_string: "run", new_string: "RUN" }, { cwd: wt.workdir });
  assert.equal(read(join(wt.dest, "tools", "e", "run.js")), "RUN\n");
  assert.match(String(edited), /\[Filament: tools\/e\/run\.js lies outside the folders your sparse copy held: it holds tools\/e\/ now too\.\]$/);
  const wrote = await server.call("Write", { file_path: join(wt.dest, "docs", "d", "guide.md"), content: "new guide\n" }, { cwd: wt.workdir });
  assert.match(String(wrote), /^Wrote .*guide\.md\n\n\[Filament: docs\/d\/guide\.md lies outside/);
  assert.deepEqual([read(join(wt.dest, "docs", "d", "guide.md")), read(join(wt.dest, "docs", "d", "more.md"))], ["new guide\n", "more\n"], "its folder came in before the write");
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["docs/d", "pkg/a", "tools/e"]);
  assert.equal(await server.call("Write", { file_path: join(wt.dest, "pkg", "a", "new.js"), content: "n\n" }, { cwd: wt.workdir }), `Wrote ${join(wt.dest, "pkg", "a", "new.js")}`, "inside the cone: said as before");
  await releaseTaskWorktree(wt, "parked");
});

// (fails before: yes — the review of 4dfe2433c: Filament's MCP Read brought the folder in and said nothing of it, nor
// of one that could not come in, whose read then failed as a file that is not there)
test("Filament's MCP Read brings a sparse copy's folder in and says so; one that could not come in is said beside the read's own failure", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_widen06", kind: "sparse", paths: ["pkg/a"] });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  const hands = { readTextFile: async (/** @type {any} */ p) => ({ content: read(p.path) }) };
  const server = new McpToolServer({ bridge: { permitLocal: async () => {} }, hands, cli: "filament" });
  const got = await server.call("Read", { file_path: join(wt.dest, "lib", "c", "x.js") }, { cwd: wt.workdir });
  assert.match(String(got), /^ {5}1\tx\n[^]*\n\n\[Filament: lib\/c\/x\.js lies outside the folders your sparse copy held: it holds lib\/c\/ now too\.\]$/);
  // Its index held by another git: the folder cannot come in, and the read finds no file.
  const lock = join(git(wt.dest, "rev-parse", "--absolute-git-dir"), "index.lock");
  writeFileSync(lock, "");
  try {
    await assert.rejects(server.call("Read", { file_path: join(wt.dest, "docs", "d", "guide.md") }, { cwd: wt.workdir }), (/** @type {any} */ e) => {
      assert.match(e.message, /^ENOENT[^]*\n\n\[Filament: docs\/d\/guide\.md lies outside the folders your sparse copy holds, and docs\/d\/ could not be brought in \([^]+\): run `filament workspace widen docs\/d` in your copy\.\]$/);
      return true;
    });
  } finally {
    rmSync(lock, { force: true });
  }
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["lib/c", "pkg/a"]);
  await releaseTaskWorktree(wt, "parked");
});

// (fails before: yes — the review of 4dfe2433c: the folder came in before Filament's own permit was asked, so a call
// it refused had grown the copy's cone all the same)
test("Filament's MCP Read, Write and Edit its own permit refuses bring no folder in; the client's own tools find the folder there as they ask, and their refusal says it came", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_widen07", kind: "sparse", paths: ["pkg/a"] });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  const refuse = async () => {
    throw new Error("refused by Filament's permission policy (reject)");
  };
  const none = async () => assert.fail("Filament's hands ran a refused call");
  const server = new McpToolServer({ bridge: { permitLocal: refuse }, hands: { readTextFile: none, writeTextFile: none, editTextFile: none }, cli: "filament" });
  const x = join(wt.dest, "lib", "c", "x.js");
  for (const [name, args] of /** @type {const} */ ([["Read", { file_path: x }], ["Write", { file_path: x, content: "X\n" }], ["Edit", { file_path: x, old_string: "x", new_string: "X" }]]))
    await assert.rejects(server.call(name, args, { cwd: wt.workdir }), { message: "refused by Filament's permission policy (reject)" }, name);
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["pkg/a"]);
  assert.ok(!existsSync(join(wt.dest, "lib")), "nothing of its folder on disk");
  // The client writes with its own tools and asks its own way: the folder is there before it is asked.
  const turn = { done: false, clientTools: { has: (/** @type {string} */ role) => role === "write", buildWrite: (/** @type {any} */ c) => c } };
  const bridge = {
    permitLocal: refuse,
    askClient: async () => {
      assert.equal(read(join(wt.dest, "lib", "c", "y.js")), "y\n", "the folder came in before the client was asked");
      throw new Error("the person refused the write");
    },
  };
  const client = new McpToolServer({ bridge, hands: {}, cli: "filament" });
  await assert.rejects(client.call("Write", { file_path: x, content: "X\n" }, { cwd: wt.workdir, turn }), {
    message: "the person refused the write\n\n[Filament: lib/c/x.js lies outside the folders your sparse copy held: it holds lib/c/ now too.]",
  });
  assert.deepEqual(copyMeta(wt.dest)?.cone, ["lib/c", "pkg/a"]);
  await releaseTaskWorktree(wt, "parked");
});

// (fails before: yes — a patch moved only to a whole worktree, its paths never asked for)
test("a patch moved to a sparse copy holds its cone: the session folder, what it changed, the files it read and the paths it is given", async () => {
  const dir = repo();
  lfs(dir);
  const id = "sa_widen04";
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  const ws = o.wt;
  const hold = { now: () => ws, settled: async () => {}, move: async () => ({ ok: /** @type {const} */ (false), error: "not in this test" }) };
  const hands = (/** @type {string} */ name, /** @type {any} */ input) => patchHand(name, input, hold, { root: ws.workdir, fenced: true });
  assert.match(String(await hands("read", { path: "lib/c/x.js" })), /\bx\b/);
  await hands("read", { path: "tools/e/run.js" });
  await hands("write", { path: "tools/e/run.js", content: "RUN\n" });
  const r = await promotePatch(ws, dir, { id, kind: "sparse", paths: [join(dir, "docs", "d", "guide.md")] });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.wt.kind, "sparse");
  assert.deepEqual(r.wt.cone, ["docs/d", "lib/c", "tools/e"]);
  assert.deepEqual([read(join(r.wt.dest, "tools", "e", "run.js")), read(join(r.wt.dest, "lib", "c", "y.js"))], ["RUN\n", "y\n"]);
  assert.ok(!existsSync(join(r.wt.dest, "pkg", "b")), "what it never touched stays out");
  await releaseTaskWorktree(r.wt, "parked");
});
