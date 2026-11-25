// @ts-check
// Harness B3 + B5: the project folder read back for the surface — the tree, a file, a name search, the folder
// browser — and read-only git (status, a file's diff, the log, the branches). Every folder is a throwaway under the
// temp folder; every row is fenced by agentLoop.roots the way the loop itself is.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { listTree, readPreview, searchNames, listDirs } from "../src/adapters/tools/workspace.js";
import { gitProgram } from "../src/adapters/git/snapshot.js";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { parsePorcelainV2, statusOf, diffOf, logOf, branchesOf } from "../src/adapters/git/inspect.js";
import { folderVerdict, newFolderRefusal, underRoots } from "../src/app/agent/turn.js";
import { startApp } from "./helpers/app.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/**
 * The git processes the search starts — on the spawn pool's threads, told on their channel — each with how it ended.
 * @returns {Promise<{ seen: { pid: number, exit: any }[], done: () => void }>}
 */
const gitsStarted = async () => {
  // The git to start is found first (`gitProgram`): its own `--exec-path` is not the search's.
  await gitProgram();
  /** @type {{ pid: number, exit: any }[]} */
  const seen = [];
  const on = (/** @type {any} */ m) => {
    if (m.event === "start" && /^git(\.exe)?$/i.test(basename(String(m.file)))) seen.push({ pid: m.pid, exit: null });
    const ended = m.event === "exit" && seen.find((s) => s.pid === m.pid && !s.exit);
    if (ended) ended.exit = m;
  };
  subscribe(SPAWN_CHANNEL, on);
  return { seen, done: () => unsubscribe(SPAWN_CHANNEL, on) };
};
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const NUL = "\u0000";
/** A folder on another computer's share, as Windows writes one: nothing here is there, and no test of the new code asks. */
const SHARE = "\\\\127.0.0.1\\filament-no-such-share\\proj";
const NOT_WINDOWS = process.platform !== "win32" && "a network share is a Windows path";

/** A project folder: a committed repository with a few files, an ignored one, an untracked one and a change. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), "filament-b3-"));
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  mkdirSync(join(dir, ".hidden"));
  writeFileSync(join(dir, "README.md"), "# hello\n\nwords\n");
  writeFileSync(join(dir, "src", "index.js"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "deep", "util.js"), "export const b = 2;\n");
  writeFileSync(join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]));
  writeFileSync(join(dir, "blob.bin"), Buffer.from([1, 2, 0, 3, 4]));
  writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
  writeFileSync(join(dir, "ignored.log"), "noise\n");
  if (hasGit) {
    run(dir, ["init", "-q", "-b", "main"]);
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "init"]);
    writeFileSync(join(dir, "src", "index.js"), "export const a = 1;\nexport const c = 3;\n");
    writeFileSync(join(dir, "new.txt"), "fresh\n");
    writeFileSync(join(dir, "staged.txt"), "s\n");
    run(dir, ["add", "staged.txt"]);
  }
  return dir;
}

describe("the workspace adapter", () => {
  /** @type {string} */
  let dir;
  before(() => (dir = project()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("the tree: one level by default, folders first, .git never, sizes on files; depth nests; a path outside is refused", async () => {
    const top = await listTree(dir);
    assert.equal(top.path, "");
    assert.ok(!top.entries.some((e) => e.name === ".git"));
    const kinds = top.entries.map((e) => e.kind);
    assert.deepEqual(kinds.slice(0, 2), ["dir", "dir"], ".hidden and src come first");
    const readme = top.entries.find((e) => e.name === "README.md");
    assert.equal(readme.kind, "file");
    assert.equal(readme.size, 15);
    assert.equal(readme.path, "README.md");
    assert.ok(!top.entries.find((e) => e.name === "src").children, "no children at depth 1");
    const deep = await listTree(dir, { path: "src", depth: 2 });
    assert.equal(deep.path, "src");
    assert.deepEqual(
      deep.entries.find((e) => e.name === "deep").children.map((e) => e.path),
      ["src/deep/util.js"],
    );
    await assert.rejects(() => listTree(dir, { path: "../" }), /outside the allowed/);
    await assert.rejects(() => listTree(dir, { path: "nope" }), /no such folder/);
  });

  test("a file: text with its line count, an image as a data URL, binary as binary; a folder or a missing file is refused", async () => {
    const t = await readPreview(dir, "README.md");
    assert.equal(t.kind, "text");
    assert.equal(t.content, "# hello\n\nwords\n");
    assert.equal(t.lines, 3);
    assert.equal(t.truncated, false);
    const img = await readPreview(dir, "img.png");
    assert.equal(img.kind, "image");
    assert.equal(img.mime, "image/png");
    assert.ok(String(img.dataUrl).startsWith("data:image/png;base64,"));
    const bin = await readPreview(dir, "blob.bin");
    assert.equal(bin.kind, "binary");
    assert.ok(!("content" in bin));
    await assert.rejects(() => readPreview(dir, "src"), /no such file/);
    await assert.rejects(() => readPreview(dir, "../x"), /outside the allowed/);
  });

  // (fails before: yes — the tree stat each file it listed, and the preview read the file, with the event loop held:
  // every agent's stream and every other request waited on the disk)
  test("the tree and a file's preview read the disk without holding the event loop", async () => {
    // The fence's own look at where a path leads (fs-fence.js, the hands' too) is no read of the folder's files.
    const SYNC = ["statSync", "lstatSync", "readdirSync", "readFileSync", "openSync", "readSync"];
    /** @type {Record<string, any>} */
    const real = {};
    /** @type {string[]} */
    const held = [];
    for (const k of SYNC) {
      real[k] = /** @type {any} */ (fs)[k];
      /** @type {any} */ (fs)[k] = (/** @type {any[]} */ ...a) => (held.push(k), real[k](...a));
    }
    syncBuiltinESMExports();
    /** @type {any[]} */
    let got = [];
    try {
      got = [await listTree(dir, { depth: 3 }), await readPreview(dir, "README.md"), await readPreview(dir, "img.png")];
    } finally {
      for (const k of SYNC) /** @type {any} */ (fs)[k] = real[k];
      syncBuiltinESMExports();
    }
    assert.deepEqual(held, [], "no synchronous read of the disk");
    // What they say is what they said: the whole tree, its sizes and times as the disk has them, in its order.
    const stated = (/** @type {string} */ rel) => fs.statSync(join(dir, rel));
    const flat = (/** @type {any[]} */ es) => es.flatMap((e) => [e, ...flat(e.children || [])]);
    for (const e of flat(got[0].entries).filter((e) => e.kind === "file")) assert.deepEqual([e.size, e.mtimeMs], [stated(e.path).size, Math.round(stated(e.path).mtimeMs)], e.path);
    assert.deepEqual(flat(got[0].entries).map((e) => e.path).filter((p) => p.startsWith("src")), ["src", "src/deep", "src/deep/util.js", "src/index.js"]);
    assert.equal(got[1].content, "# hello\n\nwords\n");
    assert.equal(got[2].dataUrl, `data:image/png;base64,${fs.readFileSync(join(dir, "img.png")).toString("base64")}`);
  });

  test("the name search ranks name-start, name, then path matches; .gitignore is honoured inside a repository", async () => {
    const r = await searchNames(dir, "ind");
    assert.equal(r.files[0].path, "src/index.js");
    const util = await searchNames(dir, "deep");
    assert.deepEqual(
      util.files.map((f) => f.path),
      ["src/deep/util.js"],
      "a path match",
    );
    const all = await searchNames(dir, "");
    assert.ok(all.files.some((f) => f.path === "README.md"));
    if (hasGit) {
      assert.equal(r.source, "git");
      assert.ok(!all.files.some((f) => f.path === "ignored.log"), "ignored files stay out");
      assert.ok(all.files.some((f) => f.path === "new.txt"), "untracked files are in");
    }
    const none = await searchNames(dir, "zzzz");
    assert.equal(none.files.length, 0);
    assert.equal(none.total, 0);
    if (hasGit) {
      // Every name git lists, whole, and nothing cut: what the Files pane, the palette and the @-picker search.
      const listed = await searchNames(dir, "", { limit: 500 });
      assert.deepEqual([listed.files.map((f) => f.path).sort(), listed.truncated], [[".gitignore", "README.md", "blob.bin", "img.png", "new.txt", "src/deep/util.js", "src/index.js", "staged.txt"], false]);
    }
  });

  // (fails before: yes — the whole file was read, for its first two megabytes: a log of a gigabyte, at once, blocking)
  test("a big file's preview reads only the two megabytes it shows, and shows what it showed", async () => {
    const head = "ab\ncd\r\n".repeat(299592) + "123456x€"; // the euro's three bytes cut after the first by the limit, as before
    const body = Buffer.concat([Buffer.from(head), Buffer.alloc(3 * 1024 * 1024, "y\n")]);
    writeFileSync(join(dir, "big.log"), body);
    /** @type {number[]} */
    const asked = [];
    const realOpen = fs.promises.open;
    const realWhole = fs.promises.readFile;
    let wholes = 0;
    // Each read of the opened file counted by the bytes it asks for.
    /** @type {any} */ (fs.promises).open = async (/** @type {any[]} */ ...a) => {
      const fh = await /** @type {any} */ (realOpen)(...a);
      const read = fh.read.bind(fh);
      fh.read = (/** @type {any[]} */ ...r) => (asked.push(r[2]), read(...r));
      return fh;
    };
    /** @type {any} */ (fs.promises).readFile = (/** @type {any[]} */ ...a) => (wholes++, /** @type {any} */ (realWhole)(...a));
    syncBuiltinESMExports();
    try {
      const t = await readPreview(dir, "big.log");
      const shown = body.subarray(0, 2 * 1024 * 1024).toString("utf8");
      assert.deepEqual(
        { kind: t.kind, content: t.content, truncated: t.truncated, lines: t.lines, size: t.size },
        { kind: "text", content: shown, truncated: true, lines: shown.split("\n").length - (shown.endsWith("\n") ? 1 : 0), size: body.length },
      );
      assert.equal(wholes, 0, "no whole file read");
      assert.ok(asked.reduce((a, b) => a + b, 0) <= 2 * 1024 * 1024, `${asked} bytes asked`);
      writeFileSync(join(dir, "small.txt"), "one\ntwo");
      const small = await readPreview(dir, "small.txt");
      assert.deepEqual([small.content, small.lines], ["one\ntwo", 2]);
    } finally {
      /** @type {any} */ (fs.promises).open = realOpen;
      /** @type {any} */ (fs.promises).readFile = realWhole;
      syncBuiltinESMExports();
    }
  });

  // (fails before: yes — each search started its own git, every key typed)
  test("searches of one folder at the same time share one listing, and each gets its own answer", { skip: !hasGit && "needs git" }, async () => {
    const gits = await gitsStarted();
    try {
      const [a, b, c] = await Promise.all([searchNames(dir, "i"), searchNames(dir, "in"), searchNames(dir, "ind")]);
      assert.equal(gits.seen.length, 1);
      assert.deepEqual(c, await searchNames(dir, "ind"), "the same answer as a search alone");
      assert.equal(gits.seen.length, 2, "a search after the listing ended lists the folder again");
      assert.ok(a.total >= b.total && b.total >= c.total && c.files[0].path === "src/index.js");
    } finally {
      gits.done();
    }
  });

  // (fails before: yes — `git ls-files` was read into one 64 MB buffer, and a repository that named more had its search
  // refused, in the words "named more files than one listing keeps")
  test("a repository that names more than a search reads is searched over what git names first, the answer cut and git ended; .gitignore still holds", { skip: !hasGit && "needs git" }, async () => {
    const big = project();
    const gits = await gitsStarted();
    try {
      // About 70 MB of names in the index alone, the empty blob at each: accented, so git's output cuts characters in two
      // between its chunks.
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: big, input: "", encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
      const long = `big/${"é".repeat(120)}/${"a".repeat(240)}/${"ü".repeat(120)}/${"b".repeat(240)}`;
      const at = (/** @type {number} */ i) => `${long}/f${String(i).padStart(6, "0")}.txt`;
      const rows = Array.from({ length: 72_000 }, (_, i) => `100644 ${blob}\t${at(i)}\n`).join("");
      run(big, ["update-index", "--index-version", "4"]);
      execFileSync("git", ["update-index", "--index-info"], { cwd: big, input: rows, env: GIT_ENV, windowsHide: true });
      const [all, first, readme, fresh, ignored, broken, past] = await Promise.all(
        ["", "f0", "readme", "new", "ignored", "�", "util"].map((q) => searchNames(big, q, { limit: 500 })),
      );
      // Past the cap its thread stops git within a measure (100 ms) — or git, listing fast, is done by then; what came past
      // the cap stayed in its file, never in memory.
      assert.deepEqual([all.source, all.truncated, gits.seen.length, !!gits.seen[0].exit], ["git", true, 1, true], "one git, ended once the search had enough");
      assert.ok(all.total > 60_000 && all.total < 72_000, `${all.total} names read`);
      // Git names the untracked files first, then the index in its order: what comes before the cut is searched.
      assert.deepEqual([readme.files.map((f) => f.path), fresh.files.map((f) => f.path)], [["README.md"], ["new.txt"]]);
      assert.deepEqual([ignored.total, past.total], [0, 0], "nothing .gitignore hides, and nothing past the cut");
      // Each name whole, however git's chunks cut it.
      assert.deepEqual(first.files.map((f) => f.path), Array.from({ length: 500 }, (_, i) => at(i)));
      assert.equal(broken.total, 0, "no character cut in two");
    } finally {
      gits.done();
      rmSync(big, { recursive: true, force: true });
    }
  });

  // (fails before: yes — outside a repository the folder was walked with blocking reads, up to 20,000 files)
  test("outside a repository the name search walks the folder without blocking, and finds what it found", async () => {
    const plain = mkdtempSync(join(tmpdir(), "filament-b3-plain-"));
    const real = fs.readdirSync;
    let blocking = 0;
    try {
      // A `.git` in a folder below is another repository's: this folder is in none, and the walk passes it by.
      for (const d of ["a/b", "a/node_modules/x", "c", "c/.git"]) mkdirSync(join(plain, d), { recursive: true });
      for (const f of ["top.txt", "a/one.js", "a/b/two.js", "a/node_modules/x/skip.js", "c/three.md", "c/.git/config"]) writeFileSync(join(plain, f), "");
      /** @type {any} */ (fs).readdirSync = (/** @type {any[]} */ ...a) => (blocking++, /** @type {any} */ (real)(...a));
      syncBuiltinESMExports();
      const all = await searchNames(plain, "");
      assert.equal(all.source, "walk");
      assert.deepEqual(all.files.map((f) => f.path).sort(), ["a/b/two.js", "a/one.js", "c/three.md", "top.txt"]);
      assert.equal(blocking, 0);
    } finally {
      /** @type {any} */ (fs).readdirSync = real;
      syncBuiltinESMExports();
      rmSync(plain, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 10-30: a git ls-files that failed in a repository fell back to the walk, which
  // listed what .gitignore hides)
  test("in a repository git does not list, the name search says why in git's words and lists nothing: no walk hands out what .gitignore hides", { skip: !hasGit && "needs git" }, async () => {
    const broken = project();
    const path = process.env.PATH;
    const nowhere = mkdtempSync(join(tmpdir(), "filament-no-git-"));
    try {
      // An index git cannot read: every listing of the repository fails.
      writeFileSync(join(broken, ".git", "index"), "not an index");
      const why = /^git refuses the repository this folder is in: .+ — a git repository's files are listed by git alone, which leaves out what \.gitignore hides$/;
      await assert.rejects(searchNames(broken, "ignored"), (/** @type {any} */ e) => (assert.match(e.message, why), true));
      // No git on the machine to list it — a PATH that leads nowhere from the process's start, as the git a process
      // starts is looked for once (`gitProgram`): the same, in those words.
      const url = new URL("../src/adapters/tools/workspace.js", import.meta.url).href;
      const script = `const { searchNames } = await import(${JSON.stringify(url)}); try { await searchNames(${JSON.stringify(broken)}, "ignored"); process.stdout.write("listed"); } catch (e) { process.stdout.write(String(e?.message || e)); }`;
      const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
      const said = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, [pathKey]: nowhere }, windowsHide: true });
      assert.equal(said, "git is not installed or not on PATH — a git repository's files are listed by git alone, which leaves out what .gitignore hides");
    } finally {
      process.env.PATH = path;
      rmSync(broken, { recursive: true, force: true });
      rmSync(nowhere, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 10-30's large-repository fix found it: the search's `git ls-files` ran the
  // fsmonitor a repository configures, a command planted in .git/config, at every keystroke)
  test("the name search starts no fsmonitor the repository configures, as no git call of Filament's does", { skip: !hasGit && "needs git" }, async () => {
    const own = project();
    try {
      const mark = join(own, "fsmonitor-ran");
      const hook = join(own, "fsmonitor.sh");
      writeFileSync(hook, `#!/bin/sh\necho ran > '${mark.replaceAll("\\", "/")}'\nexit 1\n`, { mode: 0o755 });
      run(own, ["config", "core.fsmonitor", hook.replaceAll("\\", "/")]);
      const r = await searchNames(own, "readme");
      assert.deepEqual(r.files.map((f) => f.path), ["README.md"]);
      assert.equal(fs.existsSync(mark), false, "the configured fsmonitor did not run");
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  test("the folder browser: the roots on top when some are listed, one level of subfolders below, hidden on request, the parent only when allowed", async () => {
    const allowed = (p) => folderVerdict({ agentLoop: { roots: [dir] }, server: { host: "127.0.0.1" } }, p).ok;
    const top = await listDirs({ roots: [dir], allowed });
    assert.equal(top.top, true);
    assert.deepEqual(
      top.dirs.map((d) => d.path),
      [resolve(dir)],
    );
    // (fails before: yes — the review of x31: each root, or each drive letter, was looked for on the server's thread) A
    // root on a share that does not answer is left out within its wait, and the others listed.
    let open = () => {};
    const shut = new Promise((r) => (open = () => r(undefined)));
    const at = Date.now();
    const some = await listDirs({ roots: ["//gone-nas/files/x", dir], allowed, there: { ms: 50, statOf: (p) => (/^[\\/]{2}/.test(p) ? shut : stat(p)) } });
    open();
    assert.deepEqual(some.dirs.map((d) => d.path), [resolve(dir)]);
    assert.ok(Date.now() - at < 1000, `answered in ${Date.now() - at} ms`);
    const inside = await listDirs({ path: dir, roots: [dir], allowed });
    assert.deepEqual(
      inside.dirs.map((d) => d.name),
      ["src"],
    );
    assert.equal(inside.parent, null, "a root's parent is outside the fence");
    const withHidden = await listDirs({ path: dir, hidden: true, roots: [dir], allowed });
    assert.deepEqual(
      withHidden.dirs.map((d) => d.name),
      [".hidden", "src"],
    );
    const src = await listDirs({ path: join(dir, "src"), roots: [dir], allowed });
    assert.deepEqual(
      src.dirs.map((d) => d.name),
      ["deep"],
    );
    assert.equal(src.parent, resolve(dir));
    const noRoots = await listDirs({ roots: [], allowed: () => true });
    assert.ok(noRoots.dirs.length >= 1, "the machine's filesystem roots");
  });

  // (fails before: yes — x54, the hunt on x34: a folder's entries and each link among them were looked at on the server's
  // thread, which a link to a share that went away holds as long as the share does)
  test("the folder browser lists a folder whose link does not answer within its wait, that link left out, a link that answers listed", async () => {
    const base = mkdtempSync(join(tmpdir(), "filament-browse-links-"));
    try {
      mkdirSync(join(base, "real"));
      mkdirSync(join(base, "target"));
      fs.symlinkSync(join(base, "target"), join(base, "good"), "junction");
      fs.symlinkSync(join(base, "target"), join(base, "dead"), "junction");
      const allowed = (/** @type {string} */ p) => folderVerdict({ agentLoop: { roots: [base] }, server: { host: "127.0.0.1" } }, p).ok;
      let open = () => {};
      const shut = new Promise((r) => (open = () => r(undefined)));
      const at = Date.now();
      const r = await listDirs({ path: base, roots: [base], allowed, there: { ms: 50, statOf: (p) => (/[\\/]dead$/.test(p) ? shut : stat(p)) } });
      open();
      assert.deepEqual(r.dirs.map((d) => d.name), ["good", "real", "target"]);
      assert.ok(Date.now() - at < 1000, `answered in ${Date.now() - at} ms`);
      // The folder itself not answering: said in words within its wait, no listing.
      const hung = listDirs({ path: join(base, "real"), roots: [base], allowed, there: { ms: 50, statOf: (p) => (/[\\/]real$/.test(p) ? new Promise(() => {}) : stat(p)) } });
      await assert.rejects(hung, /does not answer/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  // (fails before: yes — x54: a folder asked off the thread and found not there was stat-ed again on it by the fence)
  test("a folder found not there off the thread is judged missing with no look of the fence's own", () => {
    assert.deepEqual(folderVerdict(rules([dir]), dir, { gone: true }), { ok: false, root: dir, why: "missing" });
    assert.equal(folderVerdict(rules([dir]), dir).ok, true, "asked itself, it is there");
  });
});

/** The folder rules' configuration: these roots, Filament listening on `host`. @param {string[]} roots @param {string} [host] */
const rules = (roots, host = "127.0.0.1") => ({ server: { host }, agentLoop: { roots } });
/**
 * A files row's answer, read in a context of its own (nothing listens). @param {any} cfg @param {string} method
 * @param {string} path @param {any} body @returns {Promise<{ status: number, json: any }>}
 */
const fileRow = async (cfg, method, path, body) => {
  const { fileRoutes } = await import("../src/http/admin/files.js");
  const row = fileRoutes({ config: { get: () => cfg } }).find(([m, p]) => m === method && p === path);
  assert.ok(row, `${method} ${path}`);
  const res = { status: 0, text: "", writableEnded: false, destroyed: false, headersSent: false, writeHead(/** @type {number} */ s) { this.status = s; }, end(/** @type {string} */ t) { this.text = t; } };
  await /** @type {any} */ (row)[2]({ json: async () => body, res, url: new URL(`http://x${path}`) });
  return { status: res.status, json: JSON.parse(res.text) };
};

describe("the listener the folder rules read", () => {
  // (fails before: yes — the production-readiness bug hunt of 10-30, the loopback rule: 127.0.0.2 and ::ffff:127.0.0.1 read
  // as a listener open beyond this machine, so with no roots listed every folder was refused there)
  test("every loopback address is this machine's own: with no roots, a folder is any agent's there; a network address refuses it", () => {
    for (const host of ["127.0.0.2", "::ffff:127.0.0.1", "127.1"]) assert.equal(folderVerdict(rules([], host), tmpdir()).ok, true, host);
    assert.equal(folderVerdict(rules([], "192.168.1.5"), tmpdir()).why, "exposed");
  });
});

describe("a folder on a network share", () => {
  // (fails before: yes — the owner's revision of 10-30: a share was refused whenever no root named it, so a person who
  // works on one had to list every folder they use as a root; and on a listener open beyond this machine with no roots its
  // refusal said "outside", where every folder there is refused as exposed)
  test("a share the folder rules keep out is judged before the disk is asked; with no roots on this machine's own listener it is a folder like any other", { skip: NOT_WINDOWS }, () => {
    assert.deepEqual(folderVerdict(rules([tmpdir()]), SHARE), { ok: false, root: SHARE, why: "outside" }, "roots listed, none on its share");
    assert.deepEqual(folderVerdict(rules([tmpdir()]), SHARE.replace(/\\/g, "/")), { ok: false, root: SHARE, why: "outside" }, "written with slashes, the same share");
    assert.deepEqual(folderVerdict(rules([], "0.0.0.0"), SHARE), { ok: false, root: SHARE, why: "exposed" }, "none listed on an open listener: refused before it is asked");
    assert.deepEqual(folderVerdict(rules([]), SHARE), { ok: false, root: SHARE, why: "missing" }, "none listed on this machine's own listener: asked, and not there");
    assert.equal(underRoots(SHARE, [tmpdir()]), false, "roots listed, none on its share: under none");
    assert.equal(underRoots(SHARE, []), true, "no roots: any folder");
    assert.equal(newFolderRefusal(rules([tmpdir()]), `${SHARE}-fix`), `${SHARE}-fix would not be under any folder listed in agentLoop.roots`);
    assert.equal(newFolderRefusal(rules([]), `${SHARE}-fix`), null);
  });

  // (fails before: yes — no such judgement: a share's rule was the roots' alone)
  test("its share as Windows reads each form of its path; what keeps it out: roots that name none on its share, or an open listener with none", { skip: NOT_WINDOWS }, async () => {
    const { networkShare, shareKeptOut } = await import("../src/app/agent/turn.js");
    for (const [p, share] of [
      ["\\\\Host\\Share\\x", "\\\\host\\share"],
      ["//host/share/y/z", "\\\\host\\share"],
      ["\\/host\\share", "\\\\host\\share"],
      ["\\\\?\\UNC\\Host\\Share\\z", "\\\\host\\share"],
      ["\\\\.\\unc\\host\\share", "\\\\host\\share"],
      ["\\\\?\\Volume{1}\\x", "\\\\?\\volume{1}"],
      ["C:\\x", ""],
      ["\\\\?\\C:\\x", ""],
      ["//./c:/x", ""],
      ["\\x", ""],
      ["relative\\x", ""],
    ])
      assert.equal(networkShare(p), share, p);
    assert.equal(shareKeptOut(rules(["//127.0.0.1/Filament-No-Such-Share/other"]), SHARE), null, "a root on the share, spelled another way");
    assert.equal(shareKeptOut(rules(["\\\\127.0.0.1\\another-share"]), SHARE), "outside");
    assert.equal(shareKeptOut(rules([tmpdir()]), SHARE), "outside");
    assert.equal(shareKeptOut(rules([], "0.0.0.0"), SHARE), "exposed");
    assert.equal(shareKeptOut(rules([]), SHARE), null, "none listed, this machine's own listener: a folder like any other");
    assert.equal(shareKeptOut(rules([tmpdir()], "0.0.0.0"), join(tmpdir(), "x")), null, "a folder of this machine's is never kept out by this rule");
  });

  // (fails before: yes — the owner's revision of 10-30: a share a root names was asked by the check the page makes
  // unprompted, in the background)
  test("the existence check never asks a share, whatever the rules: a share answers null and is kept", { skip: NOT_WINDOWS }, async () => {
    for (const [roots, want] of /** @type {[string[], any[]][]} */ ([[[], [null, true]], [["\\\\127.0.0.1\\filament-no-such-share"], [null, null]]])) {
      const { status, json } = await fileRow(rules(roots), "POST", "/files/exists", { paths: [SHARE, tmpdir()] });
      assert.deepEqual([status, json.ok], [200, want], `roots: ${roots}`);
    }
  });

  // (fails before: yes — the owner's revision of 10-30: Show in folder refused every share no root named, whatever the
  // listener, in the words of a folder outside the roots)
  test("Show in folder follows the folder rules before it asks a share: open listener with no roots refused as exposed, this machine's own asks it", { skip: NOT_WINDOWS }, async () => {
    const file = `${SHARE}\\notes.md`;
    const open = await fileRow(rules([], "0.0.0.0"), "POST", "/files/reveal", { path: file });
    assert.equal(open.status, 403);
    assert.match(open.json.error, /^agentLoop\.roots is empty while Filament listens on 0\.0\.0\.0/);
    const own = await fileRow(rules([]), "POST", "/files/reveal", { path: file });
    assert.deepEqual([own.status, own.json.error], [404, `the folder does not exist on this machine: ${SHARE}`], "asked, and not there");
  });
});

describe("the git inspector", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let dir;
  before(() => (dir = project()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("porcelain v2 parses: the branch block, ordinary and renamed entries, unmerged, untracked, ignored", () => {
    const z = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 h1 h2 src/index.js",
      "1 A. N... 000000 100644 100644 0000 h3 staged.txt",
      "2 R. N... 100644 100644 100644 h4 h5 R100 new name.md",
      "old.md",
      "u UU N... 100644 100644 100644 100644 h6 h7 h8 conflict.txt",
      "? new.txt",
      "! ignored.log",
      "",
    ].join(NUL);
    const p = parsePorcelainV2(z);
    assert.deepEqual(p.branch, { head: "main", oid: "abc", upstream: "origin/main", ahead: 2, behind: 1 });
    assert.deepEqual(
      p.files.map((f) => [f.path, f.oldPath, f.index, f.worktree, f.kind]),
      [
        ["src/index.js", null, " ", "M", "unstaged"],
        ["staged.txt", null, "A", " ", "staged"],
        ["new name.md", "old.md", "R", " ", "staged"],
        ["conflict.txt", null, "U", "U", "conflicted"],
        ["new.txt", null, " ", "?", "untracked"],
        ["ignored.log", null, " ", "!", "ignored"],
      ],
    );
    assert.equal(parsePorcelainV2(["# branch.oid (initial)", "# branch.head (detached)", ""].join(NUL)).branch.head, null);
  });

  test("status: branch, the changed files by kind, staged and unstaged line totals; ignored files stay out", async () => {
    const s = await statusOf(dir);
    assert.equal(s.ok, true, s.error || "");
    assert.equal(s.branch, "main");
    assert.equal(s.detached, false);
    assert.equal(s.repo.replace(/\\/g, "/").toLowerCase(), run(dir, ["rev-parse", "--show-toplevel"]).toLowerCase());
    assert.deepEqual(
      s.files.map((f) => [f.path, f.kind]).sort(),
      [
        ["new.txt", "untracked"],
        ["src/index.js", "unstaged"],
        ["staged.txt", "staged"],
      ],
    );
    assert.deepEqual(s.counts, { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 });
    assert.deepEqual(s.stats, { unstaged: { added: 1, removed: 0 }, staged: { added: 1, removed: 0 } });
  });

  // (fails before: yes — the bug hunt of 10-30, GIT-1: the status named a new folder whole, `newdir/`, and the reader of
  // each file's patch read it as a file and threw EISDIR)
  test("status names a new folder whole, as the Files pane joins it; `eachFile` names its files, as far as git's own setting lists any", async () => {
    const p = project();
    try {
      mkdirSync(join(p, "newdir", "deeper"), { recursive: true });
      writeFileSync(join(p, "newdir", "x.txt"), "x\n");
      writeFileSync(join(p, "newdir", "deeper", "y.txt"), "y\n");
      const untracked = (/** @type {any} */ s) => s.files.filter((/** @type {any} */ f) => f.kind === "untracked").map((/** @type {any} */ f) => f.path).sort();
      assert.deepEqual(untracked(await statusOf(p)), ["new.txt", "newdir/"]);
      const each = await statusOf(p, { eachFile: true });
      assert.deepEqual([untracked(each), each.counts?.untracked], [["new.txt", "newdir/deeper/y.txt", "newdir/x.txt"], 3]);
      const folder = await diffOf(p, "newdir/");
      assert.deepEqual([folder.ok, folder.untracked, folder.patch, folder.error], [true, true, "", null], "a folder has no patch of its own");
      run(p, ["config", "status.showUntrackedFiles", "no"]);
      assert.deepEqual(untracked(await statusOf(p, { eachFile: true })), [], "git's setting lists none: none are read again");
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });

  test("diff: a file against HEAD, staged and unstaged as one (GW-D30), an untracked file as an addition, a path outside refused", async () => {
    const d = await diffOf(dir, "src/index.js");
    assert.equal(d.ok, true, d.error || "");
    assert.equal(d.path, "src/index.js");
    assert.match(d.patch, /\+export const c = 3;/);
    assert.equal(d.untracked, false);
    const st = await diffOf(dir, "staged.txt");
    assert.match(st.patch, /new file mode/);
    assert.match(st.patch, /\+s$/m);
    const un = await diffOf(dir, "new.txt");
    assert.equal(un.untracked, true);
    assert.match(un.patch, /^diff --git a\/new.txt b\/new.txt\nnew file\n--- \/dev\/null\n\+\+\+ b\/new.txt\n@@ -0,0 \+1,1 @@\n\+fresh$/);
    const none = await diffOf(dir, "README.md");
    assert.equal(none.patch, "", "an unchanged tracked file has no diff");
    assert.equal(none.untracked, false);
    const out = await diffOf(dir, "../outside.txt");
    assert.equal(out.ok, false);
    assert.match(String(out.error), /outside the allowed/);
    const cut = await diffOf(dir, "src/index.js", { maxLines: 3 });
    assert.equal(cut.truncated, true);
    assert.equal(cut.patch.split("\n").length, 3);
  });

  test("log and branches", async () => {
    const l = await logOf(dir, { limit: 5 });
    assert.equal(l.ok, true);
    assert.equal(l.commits.length, 1);
    assert.equal(l.commits[0].subject, "init");
    assert.equal(l.commits[0].author, "t");
    assert.match(l.commits[0].hash, /^[0-9a-f]{40}$/);
    assert.equal(l.commits[0].hash.startsWith(l.commits[0].short), true);
    run(dir, ["branch", "feature"]);
    const b = await branchesOf(dir);
    assert.equal(b.current, "main");
    assert.deepEqual(
      b.local.map((x) => x.name).sort(),
      ["feature", "main"],
    );
    assert.deepEqual(b.remote, []);
  });

  test("no repository: said in words, nothing thrown", async () => {
    const plain = mkdtempSync(join(tmpdir(), "filament-b5-plain-"));
    try {
      const s = await statusOf(plain);
      assert.equal(s.ok, false);
      assert.match(String(s.error), /not a git repository/);
      assert.equal((await logOf(plain)).ok, false);
      assert.equal((await branchesOf(plain)).ok, false);
      assert.equal((await diffOf(plain, "x")).ok, false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("the files and git areas against a real app", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let dir;
  /** @type {string} */
  let outside;
  before(async () => {
    dir = project();
    outside = mkdtempSync(join(tmpdir(), "filament-b3-outside-"));
    shim = await startApp({
      configure: (cfg) => {
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [dir], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const cwd = () => encodeURIComponent(dir);

  test("the fence: no cwd 400, a missing folder 404, a folder outside the roots 403, a path that climbs out 403 — on every row", async () => {
    for (const row of ["files/tree", "files/read?path=x", "files/search", "files/mentions", "git/status", "git/branch", "git/branch?path=x", "git/log", "git/branches"]) {
      const sep = row.includes("?") ? "&" : "?";
      assert.equal((await shim.api(`/api/${row}`)).status, 400, row);
      assert.equal((await shim.api(`/api/${row}${sep}cwd=${encodeURIComponent(join(dir, "nope"))}`)).status, 404, row);
      assert.equal((await shim.api(`/api/${row}${sep}cwd=${encodeURIComponent(outside)}`)).status, 403, row);
    }
    assert.equal((await shim.api(`/api/files/tree?cwd=${cwd()}&path=..`)).status, 403);
    assert.equal((await shim.api(`/api/files/read?cwd=${cwd()}&path=../secret`)).status, 403);
    assert.equal((await shim.api(`/api/git/branch?cwd=${cwd()}&path=../x`)).status, hasGit ? 403 : 200);
    assert.equal((await shim.api(`/api/git/diff?cwd=${cwd()}&path=x`)).status, 404, "Review's route went with it (GW-D30)");
    assert.equal((await shim.api(`/api/files/dirs?path=${encodeURIComponent(outside)}`)).status, 403);
  });

  test("the rows answer: tree, read, search, dirs; status, branch, log, branches", async () => {
    const tree = await (await shim.api(`/api/files/tree?cwd=${cwd()}&depth=2`)).json();
    assert.equal(tree.cwd.toLowerCase(), resolve(dir).toLowerCase());
    assert.ok(tree.entries.find((e) => e.name === "src").children.some((e) => e.name === "index.js"));
    const read = await (await shim.api(`/api/files/read?cwd=${cwd()}&path=src/index.js`)).json();
    assert.equal(read.kind, "text");
    assert.match(read.content, /export const a = 1;/);
    assert.equal((await shim.api(`/api/files/read?cwd=${cwd()}`)).status, 400);
    assert.equal((await shim.api(`/api/files/read?cwd=${cwd()}&path=missing.txt`)).status, 404);
    const search = await (await shim.api(`/api/files/search?cwd=${cwd()}&q=util&limit=5`)).json();
    assert.deepEqual(
      search.files.map((f) => f.path),
      ["src/deep/util.js"],
    );
    // What an `@` offers: the letters typed in order, and a folder typed to its `/`, what it holds.
    const named = await (await shim.api(`/api/files/mentions?cwd=${cwd()}&q=utjs`)).json();
    assert.deepEqual([named.files.map((/** @type {any} */ f) => f.path), named.under], [["src/deep/util.js"], null]);
    const inSrc = await (await shim.api(`/api/files/mentions?cwd=${cwd()}&q=src/`)).json();
    assert.deepEqual([inSrc.under, inSrc.folders.map((/** @type {any} */ f) => f.path), inSrc.files.map((/** @type {any} */ f) => f.path)], ["src/", ["src/deep/"], ["src/index.js"]]);
    const dirsTop = await (await shim.api(`/api/files/dirs`)).json();
    assert.equal(dirsTop.top, true);
    assert.deepEqual(
      dirsTop.dirs.map((d) => d.path.toLowerCase()),
      [resolve(dir).toLowerCase()],
    );
    const dirsIn = await (await shim.api(`/api/files/dirs?path=${cwd()}`)).json();
    assert.deepEqual(
      dirsIn.dirs.map((d) => d.name),
      ["src"],
    );
    if (!hasGit) return;
    const status = await (await shim.api(`/api/git/status?cwd=${cwd()}`)).json();
    assert.equal(status.ok, true, status.error || "");
    assert.equal(status.branch, "main");
    assert.equal(status.counts.untracked, 1);
    const diff = await (await shim.api(`/api/git/branch?cwd=${cwd()}&path=src/index.js`)).json();
    assert.match(diff.patch, /\+export const c = 3;/);
    const staged = await (await shim.api(`/api/git/branch?cwd=${cwd()}&path=staged.txt`)).json();
    assert.match(staged.patch, /new file mode/, "what is staged is in the file's one diff against HEAD");
    const log = await (await shim.api(`/api/git/log?cwd=${cwd()}&limit=3`)).json();
    assert.equal(log.commits[0].subject, "init");
    const branches = await (await shim.api(`/api/git/branches?cwd=${cwd()}`)).json();
    assert.equal(branches.current, "main");
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, ADM-8: every path was asked of the disk, a share's of
  // its computer, and a folder outside the roots answered as any other)
  test("existence answers: true for a folder the agent may work in, false for one not there, null — unknown — for one outside the roots or on a share, never asked", async () => {
    const ask = async (/** @type {string[]} */ paths) => (await (await shim.api("/api/files/exists", { method: "POST", body: { paths } })).json()).ok;
    assert.deepEqual(await ask([dir, join(dir, "nope"), outside, ""]), [true, false, null, false]);
    if (process.platform === "win32") assert.deepEqual(await ask([SHARE, SHARE.replace(/\\/g, "/")]), [null, null], "a share no root names");
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, memory's project lookup: memory asked the disk of every
  // folder a request named; the composition root gives it the folder rules)
  test("memory is given the folder rules: a share no root names may not be asked of the disk, a folder of this machine's may", { skip: NOT_WINDOWS }, () => {
    const memory = /** @type {any} */ (shim.app.memory);
    assert.equal(memory.mayAsk(SHARE), false);
    assert.equal(memory.mayAsk(dir), true);
  });

  // (fails before: yes — ADM-8's sibling: Show in folder asked the disk of the path before it judged the path's folder, a
  // share's of its computer)
  test("Show in folder refuses a file on a share no root names before anything asks for it", { skip: NOT_WINDOWS }, async () => {
    const res = await shim.api("/api/files/reveal", { method: "POST", body: { path: `${SHARE}\\notes.md` } });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /is not under any folder listed in agentLoop\.roots$/);
  });
});
