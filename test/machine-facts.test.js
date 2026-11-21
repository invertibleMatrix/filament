// @ts-check
// Machine facts, and a repository's clones on a machine (the remote-agents plan's f-ident): what /api/state says of this
// machine for an agent of another one's, a remote's URL as one key in any of its forms with no credentials said, and
// /api/clones finding this machine's clones of a repository among its projects' and its chats' folders.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { arch, availableParallelism, release, tmpdir, totalmem } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { cloneOf, remoteKey, remoteOf, withoutCredentials } from "../src/adapters/git/inspect.js";
import { SHELL, POWERSHELL } from "../src/adapters/tools/shell.js";
import { startApp } from "./helpers/app.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

describe("a remote's URL as one key", () => {
  test("its https and ssh forms are one repository's: the case folded, its port, user, .git and slashes dropped", () => {
    const one = [
      "git@github.com:Owner/Repo.git",
      "GIT@github.com:Owner/Repo",
      "ssh://git@github.com/Owner/Repo",
      "ssh://git@github.com:22/Owner/Repo.git",
      "git+ssh://git@github.com/Owner/Repo.git",
      "https://github.com/Owner/Repo.git",
      "https://github.com/Owner/Repo/",
      "https://github.com/Owner/Repo.git/",
      "https://user@github.com/Owner/Repo",
      "https://user:tok@GitHub.COM:443/Owner/Repo.git",
      "http://github.com/Owner/Repo",
      "git://github.com/Owner/Repo.git",
      "  https://github.com/Owner/Repo  ",
      "https://github.com/owner/repo",
    ];
    for (const url of one) assert.equal(remoteKey(url), "github.com/owner/repo", url);
    // A local path stays a path, in forward slashes and its case folded, a file:// URL's too.
    assert.equal(remoteKey("/srv/git/repo.git"), "/srv/git/repo");
    assert.equal(remoteKey("file:///srv/git/repo.git"), "/srv/git/repo");
    assert.equal(remoteKey("C:\\repos\\x.git"), "c:/repos/x");
    assert.equal(remoteKey("file:///C:/repos/x"), "c:/repos/x");
  });

  test("another repository, or another host, is another key; no URL is none", () => {
    const key = remoteKey("https://github.com/Owner/Repo");
    for (const url of ["https://github.com/Owner/Other", "git@gitlab.com:Owner/Repo.git", "https://github.com/Owner/Repo2", "https://github.com/Owner/Repo/sub", "https://github.com/Repo", "C:/Owner/Repo"])
      assert.notEqual(remoteKey(url), key, url);
    assert.equal(remoteKey(""), null);
    assert.equal(remoteKey("   "), null);
    assert.equal(remoteKey("https://"), null);
  });

  test("credentials never stay: an https URL loses its user and password, an ssh one its password", () => {
    const table = [
      ["https://tok3n@github.com/o/r.git", "https://github.com/o/r.git"],
      ["https://user:pa55@host.example/o/r", "https://host.example/o/r"],
      ["http://a:b@c@host/o/r", "http://host/o/r"],
      ["ssh://git:pa55@host/o/r", "ssh://git@host/o/r"],
      ["ssh://git@host/o/r", "ssh://git@host/o/r"],
      ["git@github.com:o/r.git", "git@github.com:o/r.git"],
      ["https://github.com/o/r", "https://github.com/o/r"],
      ["/srv/git/r.git", "/srv/git/r.git"],
    ];
    for (const [url, bare] of table) assert.equal(withoutCredentials(url), bare, url);
    for (const url of ["https://tok3n@github.com/o/r.git", "https://user:pa55@host.example/o/r", "ssh://git:pa55@host/o/r"]) {
      const key = String(remoteKey(url));
      assert.ok(!key.includes("tok3n") && !key.includes("pa55") && !key.includes("@"), `${url} → ${key}`);
    }
  });
});

describe("this machine's facts and its clones of a repository", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {Record<string, string>} */
  const at = {};
  /** A repository with one commit, on `branch`, with these remotes in this order. @param {string} name @param {[string, string][]} remotes @param {string} [branch] */
  const repoAt = (name, remotes, branch = "main") => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    run(dir, ["init", "-q", "-b", branch]);
    run(dir, ["config", "core.autocrlf", "false"]);
    writeFileSync(join(dir, "a.txt"), "one\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "b.txt"), "two\n");
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "init"]);
    for (const [remote, url] of remotes) run(dir, ["remote", "add", remote, url]);
    return dir;
  };
  /** @param {string} dir */
  const top = (dir) => resolve(run(dir, ["rev-parse", "--show-toplevel"]));
  /** @param {string} remote */
  const clones = async (remote) => {
    const r = await shim.api(`/api/clones?remote=${encodeURIComponent(remote)}`);
    const text = await r.text();
    return { status: r.status, text, body: JSON.parse(text) };
  };

  before(async () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-clones-")));
    // A project's folder, its remote https with a token in it.
    at.project = repoAt("project", [["origin", "https://tok3n-secret@github.com/Owner/Repo.git"]]);
    // A chat's folder: another clone, its remote ssh, on another branch.
    at.chat = repoAt("chat", [["origin", "git@github.com:Owner/Repo.git"]], "feature");
    // No origin: its first remote is the one.
    at.fork = repoAt("fork", [["mine", "ssh://git@GitHub.com/Owner/Repo"], ["theirs", "https://github.com/Else/Where"]]);
    // origin is another repository's, though a remote before it is this one's.
    at.origin = repoAt("origin-first", [["upstream", "https://github.com/Owner/Repo"], ["origin", "https://github.com/Owner/Other"]]);
    at.other = repoAt("other", [["origin", "https://github.com/Owner/Other.git"]]);
    at.plain = join(root, "plain");
    mkdirSync(at.plain);
    at.gone = repoAt("gone", [["origin", "https://github.com/Owner/Repo"]]);
    shim = await startApp({ memory: true });
    const archive = /** @type {any} */ (shim.app).memory.archive;
    for (const k of ["project", "origin", "other", "plain", "gone"]) archive.ensureProject(at[k]);
    rmSync(at.gone, { recursive: true, force: true });
    // Chats: one in a clone of its own, one in its own, one in a folder inside the project's clone.
    for (const cwd of [at.chat, at.fork, join(at.project, "src")]) {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd } });
      assert.equal(r.status, 200, await r.clone().text());
    }
  });
  after(async () => {
    await shim?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("/api/state says this machine's system, architecture, kernel, shells, path separator, CPUs and memory", async () => {
    const st = await (await shim.api("/api/state")).json();
    const s = st.system;
    assert.ok(s, "a system field");
    assert.equal(typeof s.os, "string");
    assert.ok(s.os.length > 0, "the system has a name");
    assert.equal(s.arch, arch());
    assert.equal(s.release, release());
    assert.deepEqual(s.shell, { kind: SHELL.kind, name: SHELL.name, file: SHELL.file });
    assert.deepEqual(s.powershell, POWERSHELL ? { kind: POWERSHELL.kind, name: POWERSHELL.name, file: POWERSHELL.file } : null);
    assert.equal(s.sep, sep);
    assert.equal(s.cpus, availableParallelism());
    assert.equal(s.memoryBytes, totalmem());
    if (process.platform === "win32") assert.match(s.os, /^Windows/);
    if (process.platform === "darwin") assert.match(s.os, /^macOS/);
    // Read once: the second answer is the same.
    assert.deepEqual((await (await shim.api("/api/state")).json()).system, s);
  });

  test("a folder's remote: origin, else the first, with no credentials", async () => {
    assert.deepEqual(await remoteOf(at.project), { name: "origin", url: "https://github.com/Owner/Repo.git" });
    assert.deepEqual(await remoteOf(join(at.project, "src")), { name: "origin", url: "https://github.com/Owner/Repo.git" });
    assert.deepEqual(await remoteOf(at.fork), { name: "mine", url: "ssh://git@GitHub.com/Owner/Repo" });
    assert.deepEqual(await remoteOf(at.origin), { name: "origin", url: "https://github.com/Owner/Other" });
    assert.equal(await remoteOf(at.plain), null);
    const c = await cloneOf(join(at.project, "src"));
    assert.equal(c.ok, true, String(c.error));
    assert.equal(c.path, top(at.project));
    assert.equal(c.head, run(at.project, ["rev-parse", "HEAD"]));
    assert.equal(c.branch, "main");
    assert.equal(c.dirty, false);
  });

  test("/api/clones finds the project's and the chats' clones by the ssh form of an https remote, each once", async () => {
    const { status, text, body } = await clones("git@github.com:Owner/Repo.git");
    assert.equal(status, 200, text);
    assert.equal(body.key, "github.com/owner/repo");
    const byPath = new Map(body.clones.map((/** @type {any} */ c) => [c.path, c]));
    assert.deepEqual(body.clones.map((/** @type {any} */ c) => c.path).sort(), [top(at.project), top(at.chat), top(at.fork)].sort(), text);
    assert.deepEqual(byPath.get(top(at.project)), { path: top(at.project), head: run(at.project, ["rev-parse", "HEAD"]), branch: "main", dirty: false });
    assert.deepEqual(byPath.get(top(at.chat)), { path: top(at.chat), head: run(at.chat, ["rev-parse", "HEAD"]), branch: "feature", dirty: false });
    // The gone project's folder was looked at and skipped; the cap is said.
    assert.ok(body.folders >= 7 && body.looked === body.folders, text);
    assert.equal(body.cap, 200);
    assert.ok(!text.includes("tok3n-secret"), "no credentials in the answer");
  });

  test("a clone reads dirty once a file changes", async () => {
    writeFileSync(join(at.project, "a.txt"), "one\nchanged\n");
    const { body, text } = await clones("https://github.com/Owner/Repo");
    const project = body.clones.find((/** @type {any} */ c) => c.path === top(at.project));
    assert.equal(project?.dirty, true, text);
    assert.equal(body.clones.find((/** @type {any} */ c) => c.path === top(at.chat))?.dirty, false, text);
  });

  test("the URL asked is never said back, its token with it", async () => {
    const { status, text, body } = await clones("https://other-secret@github.com/Owner/Other");
    assert.equal(status, 200, text);
    assert.deepEqual(body.clones.map((/** @type {any} */ c) => c.path).sort(), [top(at.origin), top(at.other)].sort());
    assert.ok(!text.includes("other-secret"), text);
  });

  test("no remote named is refused in words", async () => {
    for (const q of ["", "?remote=", "?remote=%20%20"]) {
      const r = await shim.api(`/api/clones${q}`);
      assert.equal(r.status, 400, q);
      assert.match(String((await r.json()).error), /remote=/);
    }
  });
});
