// @ts-check
// A project's copy sent to another machine and what comes back from it, as the re-read of 11-11 found them
// (adapters/git/send.js, core/secret-files.js, remote-agents.js `sendCopy`): a junction, which Git for Windows walks as
// a folder; the secrets' files a name did not hold back, and a private key by its first lines; the files git does not
// track, named to the person and asked of again; two paths one name on a disk that folds case; the temp folders a
// crash left; a repository nested in a copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyIn, secretFileOf } from "../src/core/secret-files.js";
import { KEY_FILE_MAX_BYTES, bundleSnapshot, captureCopy, checkoutCopy, importBundle, leftOutWhy } from "../src/adapters/git/send.js";
import { createRemoteAgents, sendsKept } from "../src/app/agent/remote-agents.js";
import { MIRROR } from "../src/services/transfers.js";

/** @param {import("node:test").TestContext} t @param {string} name */
const folder = (t, name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-reread-${name}-`));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return d;
};
/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

/** A project of two committed files, one ignored folder. @param {string} dir */
const project = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  return dir;
};
/** The files a commit holds, in the repository or mirror at `at`. @param {string} at @param {string} commit */
const filesOf = (at, commit) => gitIn(at, ...(at.endsWith(MIRROR) ? [`--git-dir=${at}`] : []), "ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean).sort();

/**
 * A copy of `dir` sent, taken into a mirror and checked out, as a launch on another machine makes it.
 * @param {import("node:test").TestContext} t @param {string} dir
 */
const copyOf = async (t, dir) => {
  const base = folder(t, "there");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p", haves: [] });
  assert.ok(b.ok && b.file, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const mirror = join(base, "m", MIRROR);
  assert.ok((await importBundle(mirror, String(b.file))).ok);
  const copy = join(base, "copies", "From Laptop", "p", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, b.commit, { pin: "1" }), { ok: true, commit: b.commit });
  return { base, mirror, copy, commit: b.commit };
};

const JUNCTIONS = { skip: process.platform !== "win32" && "junctions are Windows' own" };

// (fails before: yes — the re-read of 11-11, its finding 2: Git for Windows walks a junction as a folder, so what one led
// to — a folder of the person's outside the project — went in the copy sent, as plain files)
test("a junction in the project: what it leads to is not sent, said by the junction", JUNCTIONS, async (t) => {
  const dir = project(folder(t, "repo"));
  const outside = folder(t, "outside");
  mkdirSync(join(outside, "deep"));
  writeFileSync(join(outside, "o.txt"), "the person's, outside the project\n");
  writeFileSync(join(outside, "deep", "p.txt"), "and under it\n");
  symlinkSync(outside, join(dir, "linked"), "junction");
  // One of the project's own folders, reached by a second name.
  symlinkSync(join(dir, "src"), join(dir, "again"), "junction");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.deepEqual(filesOf(dir, b.commit), [".gitignore", "src/a.js"], "nothing read through a junction goes");
  assert.deepEqual(b.left, [
    { path: "again", why: "a junction: what it leads to is not sent" },
    { path: "linked", why: "a junction: what it leads to is not sent" },
  ]);
  assert.equal(b.files, 2);
});

// (fails before: yes — the same finding, on the way back: a junction made in a copy was captured as the files it led to,
// that machine's person's among them, for Apply to write here)
test("a junction in a copy refuses its capture, as a link out of its tree does; gone, the copy is captured", JUNCTIONS, async (t) => {
  const { base, mirror, copy } = await copyOf(t, project(folder(t, "repo")));
  const theirs = join(base, "documents");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "keep.txt"), "that machine's person's\n");
  // A new folder made a junction, then one the copy was sent with.
  symlinkSync(theirs, join(copy, "vendor"), "junction");
  assert.deepEqual(await captureCopy(mirror, copy, { pin: "1" }), { ok: false, error: "the copy holds a junction (vendor): what changed in it stays there" });
  unlinkSync(join(copy, "vendor"));
  rmSync(join(copy, "src"), { recursive: true, force: true });
  symlinkSync(theirs, join(copy, "src"), "junction");
  assert.deepEqual(await captureCopy(mirror, copy, { pin: "1" }), { ok: false, error: "the copy holds a junction (src): what changed in it stays there" });
  unlinkSync(join(copy, "src"));
  writeFileSync(join(copy, "made.txt"), "made there\n");
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  assert.deepEqual(filesOf(mirror, cap.commit), [".gitignore", "made.txt"]);
  assert.equal(existsSync(join(theirs, "keep.txt")), true, "what the junction led to is kept");
});

// (fails before: yes — the re-read of 11-11, its finding 4: each of these went in a copy — Wrangler's .dev.vars, an
// environment's file spelled with - or _, a secrets file, a cloud's service account, Firebase's admin key, AWS's
// credentials.csv, Azure Functions' local settings, a saved token, a cluster's kubeconfig, Android's signing
// passwords, MySQL's client password, a VPN's profile)
test("what stays here, by more names: .dev.vars, .env-production, .env_local, secrets.*, a service account, Firebase's admin key, credentials.csv, local.settings.json, token.json, auth.json, kubeconfig, key.properties, .my.cnf, *.ovpn; their look-alikes and their shapes go", () => {
  const held = [
    ".dev.vars", "workers/api/.dev.vars.staging", ".env-production", ".env_local", "app/.env-local", "secrets.json", "config/secrets.yaml", "secrets.yml", "secrets.toml",
    "service-account.json", "serviceAccountKey.json", "keys/service_account.json", "my-app-firebase-adminsdk-x1y2z-0123456789.json", "credentials.csv", "local.settings.json",
    "token.json", "auth.json", "kubeconfig", ".kubeconfig", "kubeconfig.yaml", "android/key.properties", ".my.cnf", "vpn/office.ovpn",
  ];
  for (const p of held) assert.equal(secretFileOf(p), "a secret's file by its name", p);
  const go = [
    ".env-example", ".env_sample", ".env.template", "secrets.md", "src/secrets.js", "docs/service-account.md", "firebase.json", "tokens.json", "token.js", "author.json", "auth.js",
    "kubeconfig.md", "gradle.properties", "my.cnf", "ovpn.md", "local.settings.example", "settings.json", "credentials.md",
  ];
  for (const p of go) assert.equal(secretFileOf(p), "", p);
});

const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n-----END OPENSSH PRIVATE KEY-----\n";

// (fails before: yes — the same finding: a private key in a file no name gave away went, read by nobody)
test("a private key by its first lines stays here, whatever its name: a small file git does not hold as it is here; a tracked one changed to hold one goes as committed; one past the bound, or with the header far in, goes; made in a copy, it stays there", async (t) => {
  assert.equal(privateKeyIn(KEY), true);
  for (const kind of ["", "RSA ", "EC ", "DSA ", "ENCRYPTED ", "OPENSSH "]) assert.equal(privateKeyIn(`junk\n-----BEGIN ${kind}PRIVATE KEY-----\nMIIE`), true, kind);
  assert.equal(privateKeyIn("-----BEGIN PGP PRIVATE KEY BLOCK-----\n"), true);
  assert.equal(privateKeyIn('{\n  "type": "service_account",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIE'), true, "a cloud's service account, as JSON");
  for (const none of ["-----BEGIN PUBLIC KEY-----\n", "-----BEGIN CERTIFICATE-----\n", "BEGIN PRIVATE KEY", "const header = /BEGIN .* PRIVATE KEY/;\n"]) assert.equal(privateKeyIn(none), false, none);
  assert.equal(leftOutWhy({ mode: "100644", path: "notes/backup.txt", key: true }), "a private key, by its first lines");
  assert.equal(leftOutWhy({ mode: "100644", path: "notes/backup.txt", key: true, tracked: true }), "", "tracked: its history has it wherever it goes");

  const dir = project(folder(t, "repo"));
  writeFileSync(join(dir, "src", "config.txt"), "plain settings\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "second");
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "backup.txt"), KEY);
  writeFileSync(join(dir, "src", "config.txt"), `# the deploy key, pasted in\n${KEY}`);
  writeFileSync(join(dir, "big.txt"), `${KEY}${"x".repeat(KEY_FILE_MAX_BYTES)}`);
  writeFileSync(join(dir, "far.txt"), `${"line\n".repeat(2000)}${KEY}`);
  writeFileSync(join(dir, "plain.txt"), "nothing secret\n");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.deepEqual(b.left, [
    { path: "notes/backup.txt", why: "a private key, by its first lines" },
    { path: "src/config.txt", why: "a secret's file changed here: the committed one goes" },
  ]);
  assert.deepEqual(filesOf(dir, b.commit), [".gitignore", "big.txt", "far.txt", "plain.txt", "src/a.js", "src/config.txt"]);
  assert.equal(gitIn(dir, "show", `${b.commit}:src/config.txt`), "plain settings");

  for (const f of [join("notes", "backup.txt"), "big.txt", "far.txt"]) rmSync(join(dir, f));
  gitIn(dir, "checkout", "-q", "--", "src/config.txt");
  const { mirror, copy } = await copyOf(t, dir);
  writeFileSync(join(copy, "made.txt"), "made there\n");
  writeFileSync(join(copy, "host-key.txt"), KEY);
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  assert.deepEqual(cap.left, [{ path: "host-key.txt", why: "a private key, by its first lines" }]);
  assert.deepEqual(filesOf(mirror, cap.commit), [".gitignore", "made.txt", "plain.txt", "src/a.js", "src/config.txt"]);
});

/** The agents' machine "Workstation", which says of every send that it took it already. */
const takesAll = () => {
  const client = {
    state: { takes: ["transfer"] },
    get: async () => ({ haves: [] }),
    post: async (/** @type {string} */ _path, /** @type {any} */ body) => ({ done: { commit: String(body?.sha256 || "").slice(0, 40) } }),
  };
  const m = { machine: { id: "22222222-2222-4222-8222-222222222222" }, name: "Workstation", device: { scope: "agent" } };
  return /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client });
};

// (fails before: yes — the same finding: the person's yes was asked on a count of files and what stays; the files no
// commit of the project shows, which go with the rest, were named nowhere)
test("the files in no commit that go are named: by the copy made, and to the person where its send is asked", async (t) => {
  const dir = project(folder(t, "repo"));
  writeFileSync(join(dir, "src", "a.js"), "export const a = 2;\n");
  writeFileSync(join(dir, "draft.md"), "not committed\n");
  mkdirSync(join(dir, "dumps"));
  writeFileSync(join(dir, "dumps", "customers.csv"), "name,card\n");
  writeFileSync(join(dir, ".env"), "TOKEN=here\n");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "i.js"), "ignored\n");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.deepEqual(b.untracked, ["draft.md", "dumps/customers.csv"], "what goes that HEAD does not hold: no changed file, none that stays, none ignored");

  /** @type {any[]} */
  const asked = [];
  await createRemoteAgents({ machines: takesAll(), wait: async () => {} }).sendCopy("Workstation", { folder: dir, sent: sendsKept(null), ask: async (o) => (asked.push(o), true) });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].untracked, ["draft.md", "dumps/customers.csv"]);
  assert.deepEqual([asked[0].files, asked[0].left.map((/** @type {any} */ l) => l.path)], [4, [".env"]]);
});

/**
 * A copy sent whose commit holds `files`, each path as written — two that differ by case alone too, which no disk here
 * need hold: the index is given each by `update-index --cacheinfo`. Taken into a mirror. → the mirror and the commit.
 * @param {string} base @param {[string, string][]} files  each path and its words
 */
const sentOf = async (base, files) => {
  const dir = join(base, "repo");
  mkdirSync(dir);
  gitIn(dir, "init", "-q");
  const env = { ...process.env, GIT_INDEX_FILE: join(base, "index") };
  for (const [path, words] of files) {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: words, encoding: "utf8" }).trim();
    execFileSync("git", ["-c", "core.ignorecase=false", "update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { cwd: dir, env });
  }
  const tree = execFileSync("git", ["write-tree"], { cwd: dir, env, encoding: "utf8" }).trim();
  const commit = gitIn(dir, "commit-tree", tree, "-m", "x");
  gitIn(dir, "update-ref", "refs/filament/sent/m/p", commit);
  gitIn(dir, "bundle", "create", "b.bundle", "refs/filament/sent/m/p");
  const mirror = join(base, "m", MIRROR);
  assert.deepEqual(await importBundle(mirror, join(dir, "b.bundle")), { ok: true, commit });
  return { mirror, commit };
};

// (fails before: yes — the re-read of 11-11, its finding 9: a copy from a disk that tells `README.md` from `Readme.md`
// was checked out on one that reads them as one name — one file for the two —, and its capture brought back a change
// nobody made: the one's words in the other)
test("two paths a disk that folds case reads as one — two files, or two folders — refuse the copy's checkout there, both named; on a disk that tells them apart the copy is checked out, and comes back unchanged", async (t) => {
  const base = folder(t, "cased");
  // Whether this disk reads `REPO` as `repo`: Windows' and macOS's do, Linux's does not.
  const files = await sentOf(base, [["README.md", "upper\n"], ["Readme.md", "mixed\n"], ["src/a.js", "a\n"]]);
  const folds = existsSync(join(base, "REPO"));
  const copy = join(base, "copies", "From Laptop", "p", "1");
  const placed = await checkoutCopy(files.mirror, copy, files.commit, { pin: "1" });
  const folders = await sentOf(folder(t, "cased-folders"), [["Docs/a.md", "a\n"], ["docs/b.md", "b\n"]]);
  const placed2 = await checkoutCopy(folders.mirror, join(base, "copies", "From Laptop", "p", "2"), folders.commit, { pin: "2" });
  if (folds) {
    assert.deepEqual(placed, { ok: false, error: "the copy holds two paths this machine's disk reads as one (README.md and Readme.md): it is not checked out" });
    assert.deepEqual(placed2, { ok: false, error: "the copy holds two paths this machine's disk reads as one (Docs and docs): it is not checked out" });
    return;
  }
  assert.deepEqual([placed, placed2], [{ ok: true, commit: files.commit }, { ok: true, commit: folders.commit }]);
  const cap = await captureCopy(files.mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.unchanged, JSON.stringify(cap));
});

/** A repository made in a copy by its agent, as `git init` leaves one; `commit`: with a file committed in it. @param {string} at @param {boolean} commit */
const nested = (at, commit) => {
  mkdirSync(at, { recursive: true });
  gitIn(at, "init", "-q");
  writeFileSync(join(at, "x.txt"), "its own\n");
  if (!commit) return;
  gitIn(at, "add", "-A");
  gitIn(at, "commit", "-q", "-m", "its own");
};

// (fails before: yes — the re-read of 11-11, its finding 13b: git's add fails on a repository with no commit ("does not
// have a commit checked out"), so one `git init` in a copy kept everything its sub-agent changed from coming back)
test("a repository made in a copy, with no commit even, stays there, said, and the copy's capture goes", async (t) => {
  const { mirror, copy } = await copyOf(t, project(folder(t, "repo")));
  nested(join(copy, "tools", "empty"), false);
  nested(join(copy, "vendored"), true);
  writeFileSync(join(copy, "made.txt"), "made there\n");
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  assert.deepEqual(cap.left, [
    { path: "tools/empty", why: "a repository of its own: none is sent yet" },
    { path: "vendored", why: "a repository of its own: none is sent yet" },
  ]);
  assert.deepEqual(filesOf(mirror, cap.commit), [".gitignore", "made.txt", "src/a.js"]);
});

// (fails before: yes — the same finding: git's add read every file into the mirror's objects, then what stays there was
// taken out of the index: a secret made in a copy, and each file past 100 MB at every capture, lay in the mirror)
test("what stays in a copy by its name is never read into the mirror: its capture's add leaves it out", async (t) => {
  const { mirror, copy } = await copyOf(t, project(folder(t, "repo")));
  const secret = `TOKEN=made-there-${Date.now()}\n`;
  writeFileSync(join(copy, ".env.local"), secret);
  mkdirSync(join(copy, ".aws"));
  writeFileSync(join(copy, ".aws", "credentials"), `[default]\n${secret}`);
  writeFileSync(join(copy, "made.txt"), "made there\n");
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  assert.deepEqual(cap.left, [
    { path: ".aws/credentials", why: "in a credentials folder (.aws)" },
    { path: ".env.local", why: "a secret's file by its name" },
  ]);
  assert.deepEqual(filesOf(mirror, cap.commit), [".gitignore", "made.txt", "src/a.js"]);
  /** Whether the mirror holds a blob of `words`. @param {string} words */
  const holds = (words) => {
    const blob = execFileSync("git", ["hash-object", "--no-filters", "--stdin"], { cwd: copy, input: words, encoding: "utf8" }).trim();
    try {
      execFileSync("git", [`--git-dir=${mirror}`, "cat-file", "-e", blob], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(holds("made there\n"), true, "what goes back is in the mirror");
  assert.deepEqual([holds(secret), holds(`[default]\n${secret}`)], [false, false], "what stays there is not");
});

// (fails before: yes — the same finding: `git clean -f -d` leaves a folder that is a repository of its own, so one an
// earlier launch's agent made stayed in the copy the next launch took)
test("a copy taken again: a repository an earlier launch made in it goes with the rest it left", async (t) => {
  const { mirror, copy, commit } = await copyOf(t, project(folder(t, "repo")));
  nested(join(copy, "tools", "empty"), false);
  nested(join(copy, "vendored"), true);
  writeFileSync(join(copy, "made.txt"), "made there\n");
  mkdirSync(join(copy, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(copy, "node_modules", "dep", "i.js"), "installed\n");
  assert.deepEqual(await checkoutCopy(mirror, copy, commit, { pin: "1" }), { ok: true, commit });
  assert.deepEqual(readdirSync(copy).sort(), [".git", ".gitignore", "node_modules", "src"], "the commit's files, and what it ignores");
});
