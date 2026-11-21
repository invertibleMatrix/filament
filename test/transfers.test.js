// @ts-check
// A project's copy sent to another machine (the remote plan's cp-send): what stays here by its name (core/secret-files.js)
// or its kind (a link out of the tree, a submodule, a file too large); the snapshot bundled whole the first time, then
// only what changed, and taken into the project's mirror there with every object checked (adapters/git/send.js); the
// sends that come there in parts, taken up again where one was cut, after a restart too (services/transfers.js); the
// client that sends them, asking the person before a project's first copy goes to a machine (remote-agents.js
// `sendCopy`); and the whole of it between two real Filaments, over the agents' device's routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { secretFileOf } from "../src/core/secret-files.js";
import { FILE_MAX_BYTES, PINNED_REF_PREFIX, bundleSnapshot, captureCopy, checkoutCopy, importBack, importBundle, leftOutWhy, mirrorHas, mirrorHaves } from "../src/adapters/git/send.js";
import { BIND_MS, MIRROR, createTransfers } from "../src/services/transfers.js";
import { BACK_MAX_BYTES, createRemoteAgents, sendsKept } from "../src/app/agent/remote-agents.js";
import { createMachines } from "../src/services/machines/index.js";
import { createDevices } from "../src/services/devices.js";
import { COPIES, GRACE_MS, STORES, STORES_MAX, createCopies, folderKeyOf } from "../src/services/copies.js";
import { copiesRefusal } from "../src/http/admin/remote.js";
import { startTwoMachines } from "./helpers/two-machines.js";

const JSON_TYPE = { "content-type": "application/json" };

/** @param {import("node:test").TestContext} t @param {string} name */
const folder = (t, name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-transfers-${name}-`));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return d;
};
/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

/**
 * A project with what goes and what stays: a secret's file tracked (in its history already: it goes), untracked ones by
 * name and kind, a key in a credentials folder, an example, Claude Code's project settings, an ignored folder.
 * @param {string} dir
 */
const project = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  mkdirSync(join(dir, ".ssh"), { recursive: true });
  mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
  writeFileSync(join(dir, ".env"), "TOKEN=tracked\n");
  writeFileSync(join(dir, ".env.example"), "TOKEN=\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  writeFileSync(join(dir, "src", "b.js"), "export const b = 2;\n");
  writeFileSync(join(dir, "server.pem"), "-----BEGIN PRIVATE KEY-----\n");
  writeFileSync(join(dir, "src", "prod.env"), "TOKEN=untracked\n");
  writeFileSync(join(dir, ".ssh", "id_ed25519"), "KEY\n");
  writeFileSync(join(dir, ".claude", "commands", "check.md"), "Run the checks.\n");
  writeFileSync(join(dir, "node_modules", "x", "i.js"), "ignored\n");
  return dir;
};
/** What a copy of `project` leaves here, and the files it carries. */
const LEFT = [".ssh/id_ed25519", "server.pem", "src/prod.env"];
const CARRIED = [".claude/commands/check.md", ".env", ".env.example", ".gitignore", "src/a.js", "src/b.js"];
/** A file's words, its line ends as git here wrote them made one. @param {string} f */
const textOf = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
/** The files a mirror's commit holds. @param {string} mirror @param {string} commit */
const filesOf = (mirror, commit) => gitIn(mirror, `--git-dir=${mirror}`, "ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean).sort();

// (fails before: yes — there was no secret-files.js nor send.js: nothing said what a copy leaves here)
test("what stays here: a secret's file by its name or kind, one in a credentials folder; a link out of the tree, a submodule, a file past the most; a secret's shape goes", () => {
  for (const p of [".env", "app/.env.local", ".npmrc", "deploy/id_ed25519", "certs/server.pem", "k.p12", "vault.kdbx", "infra/prod.tfvars", ".git-credentials"]) assert.equal(secretFileOf(p), "a secret's file by its name", p);
  for (const p of [".ssh/config", "home/.aws/credentials", "x/.config/gh/hosts.yml"]) assert.match(secretFileOf(p), /^in a credentials folder/, p);
  for (const p of ["src/a.js", ".env.example", "id_ed25519.pub", "README.md", "env.js", "keys/notes.txt"]) assert.equal(secretFileOf(p), "", p);
  assert.equal(leftOutWhy({ mode: "120000", path: "a/link", target: "../../outside" }), "a link out of the project's tree");
  assert.equal(leftOutWhy({ mode: "120000", path: "a/link", target: "/etc/passwd" }), "a link out of the project's tree");
  assert.equal(leftOutWhy({ mode: "120000", path: "a/link", target: "C:\\Users" }), "a link out of the project's tree");
  assert.equal(leftOutWhy({ mode: "120000", path: "a/link", target: "../b/c.js" }), "");
  assert.equal(leftOutWhy({ mode: "160000", path: "vendor/lib" }), "a submodule: none is sent yet");
  assert.equal(leftOutWhy({ mode: "100644", path: "big.bin", size: FILE_MAX_BYTES + 1 }), "larger than 100 MB");
  assert.equal(leftOutWhy({ mode: "100644", path: "ok.bin", size: FILE_MAX_BYTES }), "");
});

// (fails before: yes — the swarm's review of 11-10: Yarn's classic .yarnrc, Google Cloud's application default
// credentials, NuGet's config and an SFTP extension's sftp.json, each a token's or a password's file, went)
test("what stays here: Yarn's .yarnrc, a cloud's default credentials, NuGet's config, sftp.json; their look-alikes go", () => {
  for (const p of [".yarnrc", "application_default_credentials.json", "NuGet.Config", "nuget.config", ".vscode/sftp.json"]) assert.equal(secretFileOf(p), "a secret's file by its name", p);
  for (const p of [".yarnrc.example", "src/nuget.ts", "docs/sftp.md", "yarnrc.js"]) assert.equal(secretFileOf(p), "", p);
});

// (fails before: yes — the review of cp-send: `prod.env`, `.envrc`, `id_rsa_work`, a deploy key, credentials.json and a
// state's backup went; Claude Code's and Cargo's project settings stayed; a secret tracked stayed though its history has it)
test("what stays here, widened: an environment's file by its kind, .envrc, a key whatever follows its name, a deploy key, a cloud's credentials and state; a project's .claude and .cargo settings go; a file the repository tracks goes; a name in no UTF-8 stays", () => {
  for (const p of ["prod.env", "docker/app.env", ".envrc", "id_rsa_work", "keys/id_ed25519_github", "deploy_key", "ci/github-deploy-key", "credentials.json", ".credentials.json", "client_secret_123.apps.json", "terraform.tfstate.backup", "x.auto.tfvars.json", ".cargo/credentials.toml"])
    assert.equal(secretFileOf(p), "a secret's file by its name", p);
  for (const p of ["id_rsa_work.pub", ".claude/settings.json", ".claude/commands/check.md", ".cargo/config.toml", "env.ts", "deploy_keys.md", "src/environment.js"]) assert.equal(secretFileOf(p), "", p);
  assert.match(secretFileOf(".claude/.ssh/id_rsa"), /^in a credentials folder \(\.ssh\)/);
  assert.match(secretFileOf(".claude/.fly/config.yml"), /^in a credentials folder \(\.fly\)/, "any other credentials folder in a project's settings");
  assert.equal(secretFileOf(".claude/settings.local.json"), "a secret's file by its name", "the person's own Claude Code settings");
  assert.equal(leftOutWhy({ mode: "100644", path: ".env", tracked: true }), "", "tracked: its history has it wherever it goes");
  assert.equal(leftOutWhy({ mode: "100644", path: ".env" }), "a secret's file by its name");
  assert.equal(leftOutWhy({ mode: "120000", path: "a/link", target: "/etc/passwd", tracked: true }), "a link out of the project's tree", "a link out goes never");
  assert.equal(leftOutWhy({ mode: "100644", path: null }), "a name not in UTF-8");
});

// (fails before: yes — nothing bundled a snapshot nor took one into a mirror)
test("a copy: the snapshot less what stays here, bundled whole the first time with no history; the next only what changed; the same twice, nothing; taken into a mirror, checked", async (t) => {
  const dir = project(folder(t, "repo"));
  const mirror = join(folder(t, "there"), "p", MIRROR);
  const first = await bundleSnapshot(join(dir, "src"), { machine: "11111111-1111-4111-8111-111111111111", project: "p", haves: [] });
  assert.ok(first.ok, first.ok ? "" : first.error);
  t.after(() => first.ok && first.dir && rmSync(first.dir, { recursive: true, force: true }));
  assert.equal(first.sub, "src", "the chat's folder in the project");
  assert.equal(first.basis, null);
  assert.deepEqual(first.left.map((l) => l.path).sort(), LEFT);
  assert.equal(gitIn(dir, "rev-list", "--count", first.commit), "1", "no history goes");
  const took = await importBundle(mirror, String(first.file));
  assert.deepEqual(took, { ok: true, commit: first.commit });
  assert.deepEqual(filesOf(mirror, first.commit), CARRIED);
  assert.deepEqual(await mirrorHaves(mirror), [first.commit]);

  writeFileSync(join(dir, "src", "a.js"), "export const a = 3;\n");
  const next = await bundleSnapshot(dir, { machine: "11111111-1111-4111-8111-111111111111", project: "p", haves: await mirrorHaves(mirror) });
  assert.ok(next.ok);
  t.after(() => next.ok && next.dir && rmSync(next.dir, { recursive: true, force: true }));
  assert.equal(next.basis, first.commit);
  assert.ok(next.bytes < first.bytes, `${next.bytes} < ${first.bytes}: only what changed`);
  assert.deepEqual(await importBundle(mirror, String(next.file)), { ok: true, commit: next.commit });
  assert.equal(gitIn(mirror, `--git-dir=${mirror}`, "show", `${next.commit}:src/a.js`), "export const a = 3;");

  const same = await bundleSnapshot(dir, { machine: "11111111-1111-4111-8111-111111111111", project: "p", haves: await mirrorHaves(mirror) });
  assert.ok(same.ok);
  assert.deepEqual([same.unchanged, same.commit, same.file], [true, next.commit, null]);

  // A bundle that builds on a commit the mirror lacks is refused, said structurally, for the sender to send it whole.
  const other = join(folder(t, "other"), MIRROR);
  const refused = await importBundle(other, String(next.file));
  assert.deepEqual(refused, { ok: false, lacks: true, error: `the copy sent builds on ${first.commit.slice(0, 12)}, which this mirror does not hold: send it whole` });
});

// (fails before: yes — the re-review of cp-send: a secret's file the repository tracks went as it stands here, with a
// key put in it and never committed)
test("a secret's file the repository tracks goes as its HEAD holds it: changed here, the committed one goes, said", async (t) => {
  const dir = project(folder(t, "repo"));
  writeFileSync(join(dir, ".env"), "TOKEN=sk-live-never-committed\n");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.deepEqual(b.left.find((l) => l.path === ".env"), { path: ".env", why: "a secret's file changed here: the committed one goes" });
  assert.equal(b.files, CARRIED.length);
  assert.equal(gitIn(dir, "show", `${b.commit}:.env`), "TOKEN=tracked");
});

// (fails before: yes — the review of cp-send: a home folder that is a repository was sent whole, its history and
// tokens with it)
test("the home folder's repository is never sent", async (t) => {
  const home = project(folder(t, "home"));
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    for (const [k, v] of Object.entries(was))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const b = await bundleSnapshot(join(home, "src"), { machine: "m", project: "home" });
  assert.equal(b.ok, false);
  assert.match(b.ok ? "" : b.error, /the home folder or a drive's root: no copy of it is sent$/);
});

// (fails before: yes — the swarm's review of 11-10: a repository whose top is a credentials folder, or holds one — a
// dotfiles repository of ~/.config, of ~/.ssh — was sent, its paths read from its top named no credentials folder)
test("a repository whose top is a credentials folder, or holds one, is never sent; one beside them is", async (t) => {
  const base = folder(t, "dots");
  for (const top of [".ssh", ".config", join(".config", "gh")]) {
    const dir = join(base, top);
    mkdirSync(join(dir, "x"), { recursive: true });
    gitIn(dir, "init", "-q");
    writeFileSync(join(dir, "x", "hosts.yml"), "oauth_token: t\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "first");
    const b = await bundleSnapshot(dir, { machine: "m", project: "dots" });
    t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
    assert.equal(b.ok, false, top);
    assert.match(b.ok ? "" : b.error, /a credentials folder, or holds one: no copy of it is sent$/, top);
  }
  const nvim = project(join(base, "work", "nvim"));
  const ok = await bundleSnapshot(nvim, { machine: "m", project: "nvim" });
  t.after(() => ok.ok && ok.dir && rmSync(ok.dir, { recursive: true, force: true }));
  assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
});

// (fails before: yes — nothing checked a copy out of its mirror)
test("a copy checked out of its mirror: the commit's files, its .git fresh each time and reading the mirror's objects, the commit pinned there; taken again, what was ignored stays and the rest is the new commit's; a link out of the tree refused", async (t) => {
  const dir = project(folder(t, "repo"));
  const there = folder(t, "there");
  const mirror = join(there, "p", MIRROR);
  const first = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(first.ok && first.file);
  t.after(() => first.ok && first.dir && rmSync(first.dir, { recursive: true, force: true }));
  assert.ok((await importBundle(mirror, first.file)).ok);
  const copy = join(there, "From Laptop", "p", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, first.commit, { pin: "1" }), { ok: true, commit: first.commit });
  assert.equal(textOf(join(copy, "src", "a.js")), "export const a = 1;\n", "as git here writes it");
  assert.equal(existsSync(join(copy, "server.pem")), false, "what stayed there is not here");
  assert.equal(gitIn(copy, "rev-parse", "HEAD"), first.commit, "its git sees the commit");
  assert.equal(gitIn(mirror, `--git-dir=${mirror}`, "rev-parse", `${PINNED_REF_PREFIX}1`), first.commit, "pinned in the mirror");

  // An agent worked there: a file changed, one made, an install, a hook planted in its .git.
  writeFileSync(join(copy, "src", "a.js"), "changed there\n");
  writeFileSync(join(copy, "notes.txt"), "made there\n");
  mkdirSync(join(copy, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(copy, "node_modules", "dep", "i.js"), "installed\n");
  mkdirSync(join(copy, ".git", "hooks"), { recursive: true });
  writeFileSync(join(copy, ".git", "hooks", "post-checkout"), "#!/bin/sh\necho planted > planted.txt\n");
  writeFileSync(join(dir, "src", "a.js"), "export const a = 9;\n");
  const next = await bundleSnapshot(dir, { machine: "m", project: "p", haves: await mirrorHaves(mirror) });
  assert.ok(next.ok && next.file);
  t.after(() => next.ok && next.dir && rmSync(next.dir, { recursive: true, force: true }));
  assert.ok((await importBundle(mirror, next.file)).ok);
  assert.deepEqual(await checkoutCopy(mirror, copy, next.commit, { pin: "1" }), { ok: true, commit: next.commit });
  assert.equal(textOf(join(copy, "src", "a.js")), "export const a = 9;\n");
  assert.equal(existsSync(join(copy, "notes.txt")), false, "what an earlier launch made goes");
  assert.equal(existsSync(join(copy, "node_modules", "dep", "i.js")), true, "its installs stay");
  assert.equal(existsSync(join(copy, ".git", "hooks", "post-checkout")), false, "its .git is fresh");
  assert.equal(existsSync(join(copy, "planted.txt")), false, "no hook of its ran");

  // A bundle no sender of Filament's makes: a link out of its tree.
  const crafted = join(folder(t, "crafted"), "repo");
  mkdirSync(crafted, { recursive: true });
  const file = craftedBundle(crafted, () => `120000 blob ${execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: crafted, input: "../../../outside", encoding: "utf8" }).trim()}\tlink\n`);
  const bad = join(folder(t, "bad"), MIRROR);
  const taken = await importBundle(bad, file);
  assert.ok(taken.ok, "the mirror takes it: git judges no link's target");
  const refused = await checkoutCopy(bad, join(folder(t, "bad-copy"), "1"), taken.ok ? taken.commit : "", { pin: "1" });
  assert.deepEqual(refused, { ok: false, error: "the copy holds a link out of its tree (link): it is not checked out" });
});

// (fails before: yes — the review of cp-place: a chat's folder reached through a link was read as outside its repository,
// and its sub-agent there started at the copy's top)
test("a chat's folder reached through a link is named within its repository, as git names it", async (t) => {
  const dir = project(folder(t, "repo"));
  const via = join(folder(t, "via"), "src-link");
  symlinkSync(join(dir, "src"), via, "junction");
  const b = await bundleSnapshot(via, { machine: "m", project: "p", haves: [] });
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.ok(b.ok, b.ok ? "" : b.error);
  assert.equal(b.sub, "src");
});

/** A blob of `text` written into the repository at `dir`, as it is. @param {string} dir @param {string} text */
const blobOf = (dir, text) => execFileSync("git", ["hash-object", "-w", "--no-filters", "--stdin"], { cwd: dir, input: text, encoding: "utf8" }).trim();

// (fails before: yes — the review of cp-place: Git for Windows' own configuration runs Git LFS's smudge, which found no
// remote for a pointer and failed the checkout of every project LFS keeps files of (checked by hand on git-lfs 3.5.1); a
// link through another link reached the copy's parent; a link on the way to the copy's folder took Filament's git there)
test("a copy checked out keeps Git LFS's files as their pointers; a link through another link is refused; a link on the way to its folder refuses it", async (t) => {
  const base = folder(t, "lfs");
  const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${"4".repeat(64)}\nsize 12345\n`;
  const dir = join(base, "repo");
  mkdirSync(dir);
  const file = craftedBundle(dir, (blob) => `100644 blob ${blobOf(dir, "*.bin filter=lfs diff=lfs merge=lfs -text\n")}\t.gitattributes\n100644 blob ${blobOf(dir, POINTER)}\ta.bin\n100644 blob ${blob}\tb.txt\n`);
  const mirror = join(base, "m", MIRROR);
  const took = await importBundle(mirror, file);
  assert.ok(took.ok);
  const root = join(base, "copies");
  const copy = join(root, "From Laptop", "p", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, took.commit, { pin: "1", root }), { ok: true, commit: took.commit });
  assert.equal(textOf(join(copy, "a.bin")), POINTER, "the pointer, as it came");
  assert.equal(textOf(join(copy, "b.txt")), "hi\n");

  // `x/s -> ..` stays in the tree read alone, and so does `y -> x/s/..` read alone; read through x/s, y is the copy's parent.
  const linky = join(base, "linky");
  mkdirSync(linky);
  const lf = craftedBundle(linky, () => {
    const x = execFileSync("git", ["mktree"], { cwd: linky, input: `120000 blob ${blobOf(linky, "..")}\ts\n`, encoding: "utf8" }).trim();
    return `040000 tree ${x}\tx\n120000 blob ${blobOf(linky, "x/s/..")}\ty\n`;
  });
  const lm = join(base, "lm", MIRROR);
  const ltook = await importBundle(lm, lf);
  assert.ok(ltook.ok);
  assert.deepEqual(await checkoutCopy(lm, join(base, "lcopy", "1"), ltook.commit, { pin: "1" }), { ok: false, error: "the copy holds a link out of its tree (y): it is not checked out" });
  // (fails before: yes — the re-review of cp-place: the links were compared by their exact bytes) Where the disk reads
  // `X/S`, `x/s.` and `x/s` as one name, `y -> x/s/..` read through `X/S` is the copy's parent too.
  if (process.platform === "win32" || process.platform === "darwin") {
    for (const [dirName, linkName, via] of [["X", "S", "x/s/.."], ...(process.platform === "win32" ? [["x", "s", "x/s./.."]] : [])]) {
      const cased = join(base, `cased-${dirName}-${linkName}-${via.length}`);
      mkdirSync(cased);
      const cf = craftedBundle(cased, () => {
        const x = execFileSync("git", ["mktree"], { cwd: cased, input: `120000 blob ${blobOf(cased, "..")}\t${linkName}\n`, encoding: "utf8" }).trim();
        return `040000 tree ${x}\t${dirName}\n120000 blob ${blobOf(cased, via)}\ty\n`;
      });
      const cm = join(cased, "m", MIRROR);
      const ctook = await importBundle(cm, cf);
      assert.ok(ctook.ok);
      assert.deepEqual(await checkoutCopy(cm, join(cased, "copy", "1"), ctook.commit, { pin: "1" }), { ok: false, error: "the copy holds a link out of its tree (y): it is not checked out" }, `${dirName}/${linkName} read as ${via}`);
    }
  }

  // Their machine's folder made a link to elsewhere: nothing is written there.
  const elsewhere = join(base, "elsewhere");
  mkdirSync(elsewhere);
  const root2 = join(base, "copies2");
  mkdirSync(root2);
  symlinkSync(elsewhere, join(root2, "From Laptop"), "junction");
  const astray = await checkoutCopy(mirror, join(root2, "From Laptop", "p", "1"), took.commit, { pin: "1", root: root2 });
  assert.deepEqual(astray, { ok: false, error: `the copy's folder is not where it was made (${join(root2, "From Laptop")}): it is not checked out` });
  assert.deepEqual(readdirSync(elsewhere), [], "nothing written through the link");
});

// (fails before: yes — the swarm's review of 11-10: Git for Windows wrote the commit's files through a junction an earlier
// launch's agent made of `src`, into the folder it led to, and a filter this machine names ran on the checkout)
test("a copy taken again: a link an earlier launch left where the commit has a folder is removed, the link alone, and nothing is written through it; no filter this machine names runs on its checkout", async (t) => {
  const dir = project(folder(t, "repo"));
  const base = folder(t, "again");
  const first = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(first.ok && first.file);
  t.after(() => first.ok && first.dir && rmSync(first.dir, { recursive: true, force: true }));
  const mirror = join(base, "m", MIRROR);
  assert.ok((await importBundle(mirror, String(first.file))).ok);
  const copy = join(base, "copies", "From Laptop", "widgets", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, first.commit, { pin: "1" }), { ok: true, commit: first.commit });
  // Its agent made `src` a link to a folder of the person's there.
  const theirs = join(base, "documents");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "keep.txt"), "the person's\n");
  rmSync(join(copy, "src"), { recursive: true, force: true });
  symlinkSync(theirs, join(copy, "src"), process.platform === "win32" ? "junction" : "dir");
  // The next copy sent picks a filter by its .gitattributes, which this machine's configuration names.
  writeFileSync(join(dir, ".gitattributes"), "*.js filter=evil\n");
  execFileSync("git", [`--git-dir=${mirror}`, "config", "filter.evil.smudge", "touch PWNED"]);
  const next = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(next.ok && next.file);
  t.after(() => next.ok && next.dir && rmSync(next.dir, { recursive: true, force: true }));
  assert.ok((await importBundle(mirror, String(next.file))).ok);
  assert.deepEqual(await checkoutCopy(mirror, copy, next.commit, { pin: "1" }), { ok: true, commit: next.commit });
  assert.deepEqual(readdirSync(theirs), ["keep.txt"], "nothing written through the link, what it led to kept");
  assert.equal(textOf(join(copy, "src", "a.js")), "export const a = 1;\n", "the commit's folder, made where the link was");
  assert.equal(existsSync(join(copy, "PWNED")), false, "no filter ran");
});

/** A bundle of one commit whose tree is `tree`'s lines (`mktree`'s), under Filament's ref. @param {string} dir @param {(blob: string) => string} tree */
const craftedBundle = (dir, tree) => {
  gitIn(dir, "init", "-q");
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: "hi\n", encoding: "utf8" }).trim();
  const t = execFileSync("git", ["mktree"], { cwd: dir, input: tree(blob), encoding: "utf8" }).trim();
  const commit = gitIn(dir, "commit-tree", t, "-m", "x");
  gitIn(dir, "update-ref", "refs/filament/sent/m/p", commit);
  gitIn(dir, "bundle", "create", "b.bundle", "refs/filament/sent/m/p");
  return join(dir, "b.bundle");
};

// (fails before: yes — nothing brought a copy's change back: its sub-agent's work stayed on that machine; cp-back)
test("what a sub-agent changed in its copy goes back: its files less what stays there, on the commit sent, read through the mirror alone; the same capture twice is one; taken in here checked, built on the copy sent", async (t) => {
  const dir = project(folder(t, "repo"));
  const base = folder(t, "back");
  const b = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const mirror = join(base, "m", MIRROR);
  assert.ok((await importBundle(mirror, String(b.file))).ok);
  const copy = join(base, "copies", "From Laptop", "widgets", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, b.commit, { pin: "1" }), { ok: true, commit: b.commit });
  const none = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(none.ok && none.unchanged && none.commit === b.commit && !none.file, "nothing changed: no bundle");

  writeFileSync(join(copy, "src", "a.js"), "export const a = 10;\n");
  writeFileSync(join(copy, "src", "c.js"), "export const c = 3;\n");
  // Content no delta finds: the next capture carries it again unless it builds on this one.
  writeFileSync(join(copy, "src", "big.bin"), randomBytes(300_000));
  rmSync(join(copy, "src", "b.js"));
  writeFileSync(join(copy, ".env.local"), "TOKEN=there\n");
  mkdirSync(join(copy, "node_modules", "y"), { recursive: true });
  writeFileSync(join(copy, "node_modules", "y", "i.js"), "installed there\n");
  // What its agents wrote into the copy's own .git is never read: a filter it names would run as the capture reads.
  writeFileSync(join(copy, ".git", "config"), '[core]\n\trepositoryformatversion = 0\n[filter "evil"]\n\tclean = touch PWNED\n');
  mkdirSync(join(copy, ".git", "info"), { recursive: true });
  writeFileSync(join(copy, ".git", "info", "attributes"), "* filter=evil\n");
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file && !cap.unchanged, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  // (r-itself, 11-12: the install made there was said nowhere — what git ignores stays there too, and is named:
  // test/remote-back.test.js)
  assert.deepEqual(cap.left, [{ path: ".env.local", why: "a secret's file by its name" }, { path: "node_modules/", why: "ignored by git: none is sent" }], "a secret made there stays there, and what git ignores, by its folder");
  assert.equal(existsSync(join(copy, "PWNED")), false, "the copy's own config unread");
  const again = await captureCopy(mirror, copy, { pin: "1", haves: [cap.commit] });
  assert.ok(again.ok && again.had && again.commit === cap.commit && !again.file, "the same files: the capture before, held there already");

  // Taken in here: built on the copy sent, its change the copy's.
  assert.deepEqual(await importBack(dir, String(cap.file), { base: b.commit }), { ok: true, commit: cap.commit });
  assert.deepEqual(gitIn(dir, "diff", "--name-status", b.commit, cap.commit).split("\n").sort(), ["A\tsrc/big.bin", "A\tsrc/c.js", "D\tsrc/b.js", "M\tsrc/a.js"]);
  // (fails before: yes — the review of cp-back: a capture held there was named, but its blobs went again, 300 KB more)
  // The next goes without what the one before carried.
  writeFileSync(join(copy, "src", "d.js"), "export const d = 4;\n");
  const next = await captureCopy(mirror, copy, { pin: "1", haves: [b.commit, cap.commit] });
  assert.ok(next.ok && next.file && next.commit !== cap.commit);
  t.after(() => next.ok && next.dir && rmSync(next.dir, { recursive: true, force: true }));
  assert.ok(cap.bytes > 300_000 && next.bytes < 10_000, `${next.bytes} bytes, after ${cap.bytes}`);
  assert.deepEqual(await importBack(dir, String(next.file), { base: b.commit }), { ok: true, commit: next.commit });
  assert.deepEqual(gitIn(dir, "diff", "--name-status", cap.commit, next.commit), "A\tsrc/d.js");
  // Refused: one not built on the copy sent, and a copy sent, which is no capture.
  const astray = await importBack(dir, String(cap.file), { base: gitIn(dir, "rev-parse", "HEAD") });
  assert.match(astray.ok ? "" : astray.error, /is not built on the copy sent/);
  assert.deepEqual(await importBack(dir, String(b.file), { base: b.commit }), { ok: false, error: "what came back names one capture of Filament's alone, and this one names another" });
});

// (fails before: yes — the review of cp-back: a filter this machine's configuration names ran on the copy's files as
// they were captured, where the copy's .gitattributes picked it; a path with `\` was taken in, and what an import
// refused stayed in the repository's objects)
test("what comes back is checked apart: no filter of this machine's runs on the capture, whatever its name; a file sent that stays there comes back as sent, never deleted; a path a checkout on Windows would not take is refused, and nothing of a refused one stays here", async (t) => {
  const dir = project(folder(t, "repo"));
  const base = folder(t, "back");
  const b = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const mirror = join(base, "m", MIRROR);
  assert.ok((await importBundle(mirror, String(b.file))).ok);
  const copy = join(base, "copies", "From Laptop", "widgets", "1");
  assert.deepEqual(await checkoutCopy(mirror, copy, b.commit, { pin: "1" }), { ok: true, commit: b.commit });
  // A filter this machine names (here in the mirror's configuration, read as the person's own would be), picked by the
  // copy's .gitattributes, which its agents write.
  execFileSync("git", [`--git-dir=${mirror}`, "config", "filter.evil.clean", "touch PWNED"]);
  // A name with `=` in it, which `-c` reads as the key's end.
  execFileSync("git", [`--git-dir=${mirror}`, "config", "filter.a=b.clean", "touch PWNED"]);
  writeFileSync(join(copy, ".gitattributes"), "*.js filter=evil\n*.md filter=a=b\n");
  writeFileSync(join(copy, "main.js"), "export const main = 1;\n");
  writeFileSync(join(copy, "notes.md"), "notes\n");
  // (fails before: yes — the review of cp-back: a file the copy was sent with that stays there now came back as
  // deleted, and Apply deleted it here) A sent file grown past 100 MB, and a sent folder made a file that stays there.
  writeFileSync(join(copy, ".env.example"), Buffer.alloc(FILE_MAX_BYTES + 1));
  rmSync(join(copy, "src"), { recursive: true, force: true });
  writeFileSync(join(copy, "src"), Buffer.alloc(FILE_MAX_BYTES + 1));
  const cap = await captureCopy(mirror, copy, { pin: "1" });
  assert.ok(cap.ok && cap.file, JSON.stringify(cap));
  t.after(() => cap.ok && cap.dir && rmSync(cap.dir, { recursive: true, force: true }));
  assert.equal(existsSync(join(copy, "PWNED")), false, "no filter ran");
  assert.deepEqual(
    cap.left.map((l) => l.path),
    [".env.example", "src"],
  );
  assert.match(String(cap.left[0].why), /^larger than 100 MB: it goes back as it was sent$/);
  for (const [path, text] of [["main.js", "export const main = 1;\n"], ["notes.md", "notes\n"]]) assert.equal(execFileSync("git", [`--git-dir=${mirror}`, "show", `${cap.commit}:${path}`], { encoding: "utf8" }), text, "the file as the copy has it");
  assert.deepEqual(await importBack(dir, String(cap.file), { base: b.commit }), { ok: true, commit: cap.commit });
  assert.deepEqual(gitIn(dir, "diff", "--name-status", b.commit, cap.commit).split("\n").sort(), ["A\t.gitattributes", "A\tmain.js", "A\tnotes.md"], "nothing sent comes back deleted");

  // A capture whose tree names `src\..\..\escape.js`: a name of its own on Linux, a file out of the folder on Windows,
  // which no object check refuses (`.git\…` index-pack refuses already).
  const evil = folder(t, "evil");
  gitIn(evil, "init", "-q", "--bare");
  gitIn(evil, "fetch", "-q", dir, `${b.commit}:refs/x`);
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: evil, input: "escaped\n", encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["mktree"], { cwd: evil, input: `100644 blob ${blob}\tsrc\\..\\..\\escape.js\n`, encoding: "utf8" }).trim();
  const bad = gitIn(evil, "commit-tree", tree, "-p", b.commit, "-m", "x");
  gitIn(evil, "update-ref", "refs/filament/back/1", bad);
  const file = join(evil, "back.bundle");
  gitIn(evil, "bundle", "create", "-q", file, "refs/filament/back/1", `^${b.commit}`);
  const refused = await importBack(dir, file, { base: b.commit });
  if (process.platform !== "win32") return assert.deepEqual(refused, { ok: true, commit: bad }, "a name of its own here");
  assert.match(refused.ok ? "" : refused.error, /holds a path a checkout here would not take/);
  assert.throws(() => gitIn(dir, "cat-file", "-e", bad), /Command failed/, "nothing of it stays here");
  assert.deepEqual(readdirSync(join(dir, ".git", "filament-incoming")), [], "its check's folder goes");
});

// (fails before: yes — the review of cp-back: a 503 (that machine's store busy a moment) was given up on at once, a
// capture said held was taken for any commit this repository has, and no size was refused)
test("the client brings a change back: a busy store asked again, a copy gone there said gone, a capture held taken only where this side named it, one too large refused", async (t) => {
  const dir = project(folder(t, "repo"));
  const head = gitIn(dir, "rev-parse", "HEAD");
  const base = gitIn(dir, "commit-tree", gitIn(dir, "rev-parse", "HEAD^{tree}"), "-p", head, "-m", "sent");
  /** @param {(n: number, body: any) => any} answer */
  const over = (answer) => {
    let n = 0;
    const client = {
      state: { takes: ["transfer", "copy", "back"] },
      post: async (/** @type {string} */ _path, /** @type {any} */ body) => answer(++n, body),
      get: async () => ({}),
    };
    const m = { machine: { id: "22222222-2222-4222-8222-222222222222" }, name: "Workstation", device: { scope: "agent" } };
    return { agents: createRemoteAgents({ machines: /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client }), wait: async () => {} }), asked: () => n };
  };
  const refused = (/** @type {number} */ status, /** @type {string} */ error) => Object.assign(new Error(error), { status, body: { error } });
  const ask = { copy: "c1", chat: "ch", repo: dir, base };
  const busy = over((n) => {
    if (n < 3) throw refused(503, "its store is being cleared: ask again in a moment");
    return { id: null, commit: base, unchanged: true, had: false, left: [] };
  });
  assert.deepEqual(await busy.agents.takeBack("Workstation", ask), { commit: base, unchanged: true, left: [] });
  assert.equal(busy.asked(), 3);
  const gone = over(() => {
    throw refused(410, "its copy here went to a newer launch of its project");
  });
  await assert.rejects(gone.agents.takeBack("Workstation", ask), (/** @type {any} */ e) => e.kind === "gone" && /went to a newer launch/.test(e.message));
  // Said held: `head` is in this repository, but this side named only `base`.
  const unnamed = over(() => ({ id: null, commit: head, unchanged: false, had: true, left: [] }));
  await assert.rejects(unnamed.agents.takeBack("Workstation", ask), (/** @type {any} */ e) => e.kind === "refused" && /sent no capture of its copy to read/.test(e.message));
  const named = over((_n, body) => ({ id: null, commit: head, unchanged: false, had: body.haves.includes(head), left: [] }));
  assert.deepEqual(await named.agents.takeBack("Workstation", { ...ask, haves: [head] }), { commit: head, unchanged: false, left: [] });
  const large = over(() => ({ id: "bk_1", commit: head, unchanged: false, had: false, left: [], bytes: BACK_MAX_BYTES + 1, sha256: "0".repeat(64) }));
  await assert.rejects(large.agents.takeBack("Workstation", ask), (/** @type {any} */ e) => e.kind === "refused" && /past the 2 GB one may bring here/.test(e.message));
});

// (fails before: yes — the review of cp-send: a fetch from a bundle checks no object before git 2.46, so a tree naming
// `.git` was taken into the mirror; checked by hand on git 2.45.1, whose fetch took it)
test("a copy is taken with every object checked: a tree that names .git (in any case, or by its short name) or .. is refused, and nothing is kept; no bundle is refused", async (t) => {
  const base = folder(t, "crafted");
  for (const [name, bad] of [["dotgit", ".git"], ["upper", ".GIT"], ["short", "GIT~1"], ["dotdot", ".."]]) {
    const dir = join(base, name);
    mkdirSync(dir);
    const file = craftedBundle(dir, (blob) => `100644 blob ${blob}\t${bad}\n`);
    const mirror = join(base, `${name}-mirror`, MIRROR);
    const took = await importBundle(mirror, file);
    assert.equal(took.ok, false, `${bad}: refused`);
    assert.match(took.ok ? "" : took.error, /^the copy sent could not be taken in: /);
    assert.deepEqual(await mirrorHaves(mirror), [], "nothing kept");
  }
  const plain = join(base, "plain.bundle");
  writeFileSync(plain, "not a bundle\n\nPACK");
  assert.deepEqual(await importBundle(join(base, "m2", MIRROR), plain), { ok: false, error: "the copy sent is no git bundle" });
});

/**
 * The service there, its stores a test's: the agents' device "agents" has one, any other none; `room` what its room
 * answers, `heard` what hears copies cleared.
 * @param {string} root @param {{ room?: () => string, heard?: ((c: { keys: string[] }) => unknown)[], now?: () => number }} [o]
 */
const service = (root, { room = () => "", heard = [], now = () => Date.now() } = {}) =>
  createTransfers({
    now,
    copies: {
      storeOf: (d, p) => (d === "agents" ? (mkdirSync(join(root, p), { recursive: true }), { ok: true, folder: join(root, p) }) : { ok: false, why: "copies are kept for another machine's agents alone" }),
      roomFor: () => room(),
      onCleared: (fn) => heard.push(fn),
    },
    take: importBundle,
    haves: mirrorHaves,
  });

// (fails before: yes — there was no transfers service)
test("a send there: opened, in parts at its offset alone, taken up again where it was cut — after a restart too —, checked whole, taken into the mirror; another device's, a wrong offset, a changed copy, refused", async (t) => {
  const dir = project(folder(t, "repo"));
  const root = folder(t, "copies");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const bytes = readFileSync(String(b.file));
  const half = Math.floor(bytes.length / 2);
  let s = service(root);
  assert.deepEqual(await s.open("someone", { project: "p", bytes: b.bytes, sha256: b.sha256 }), { status: 403, error: "copies are kept for another machine's agents alone" });
  const opened = await s.open("agents", { project: "p", bytes: b.bytes, sha256: b.sha256 });
  assert.ok("id" in opened);
  assert.equal(opened.have, 0);
  assert.deepEqual(await s.part("agents", opened.id, { offset: 0, data: bytes.subarray(0, half).toString("base64") }), { have: half });
  assert.deepEqual(await s.part("agents", opened.id, { offset: 0, data: bytes.subarray(0, 4).toString("base64") }), { status: 409, error: `this transfer stands at ${half} bytes: send the part from there`, have: half });
  assert.equal(("status" in (await s.part("other", opened.id, { offset: half, data: "AAAA" }))), true, "another device's: none of its");
  assert.deepEqual(await s.commit("agents", opened.id), { status: 409, error: `this transfer stands at ${half} of its ${b.bytes} bytes: send the rest first`, have: half });

  // Restarted: opened again, it goes on from what is on disk.
  s = service(root);
  const again = await s.open("agents", { project: "p", bytes: b.bytes, sha256: b.sha256 });
  assert.ok("id" in again);
  assert.equal(again.have, half);
  assert.deepEqual(await s.part("agents", again.id, { offset: half, data: bytes.subarray(half).toString("base64") }), { have: bytes.length });
  assert.deepEqual(await s.commit("agents", again.id), { commit: b.commit, project: "p" });
  assert.deepEqual(await s.haves("agents", "p"), { haves: [b.commit] });
  assert.equal(existsSync(join(root, "p", "incoming", `${b.sha256}.part`)), false, "the part is gone once taken in");

  // A copy that came changed is dropped, said.
  const bad = await s.open("agents", { project: "p", bytes: 8, sha256: "0".repeat(64) });
  assert.ok("id" in bad);
  await s.part("agents", bad.id, { offset: 0, data: Buffer.from("12345678").toString("base64") });
  assert.deepEqual(await s.commit("agents", bad.id), { status: 422, error: "the copy that came is not the one sent (its sha-256 differs): it is dropped, send it again" });
  assert.deepEqual(await s.open("agents", { project: "p", bytes: 0, sha256: b.sha256 }), { status: 400, error: "bytes is the bundle's size, a whole number above 0" });
  assert.deepEqual(await s.part("agents", bad.id, { offset: 0, data: "not base64!" }), { status: 404, error: `no transfer ${bad.id} of this device's: open it again (POST /transfers), and it goes on from where it stopped` });
});

// (fails before: yes — the review of cp-send: two opens of one send were two transfers appending to one file; a commit
// asked again, or a send opened again after its take, answered 404 and 409 though the mirror held it; a send counted in
// no room and any number stayed open; a Clear took no send into account)
test("a send there, robust: two opens of one are one transfer; its commit asked again, or the send opened again, answers what its take did; a send past the room is refused; four open at most, an untouched one making way; copies cleared end the sends into them", async (t) => {
  const dir = project(folder(t, "repo"));
  const root = folder(t, "copies");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const data = readFileSync(String(b.file)).toString("base64");
  let at = 1_000_000;
  let room = "";
  /** @type {((c: { keys: string[] }) => unknown)[]} */
  const heard = [];
  const s = service(root, { room: () => room, heard, now: () => at });
  const send = { project: "p", bytes: b.bytes, sha256: b.sha256 };
  const [one, two] = await Promise.all([s.open("agents", send), s.open("agents", send)]);
  assert.ok("id" in one && "id" in two);
  assert.equal(one.id, two.id, "one transfer");
  await s.part("agents", one.id, { offset: 0, data });
  const taken = await s.commit("agents", one.id);
  assert.deepEqual(taken, { commit: b.commit, project: "p" });
  assert.deepEqual(await s.commit("agents", one.id), taken, "asked again: the same answer");
  assert.deepEqual(await s.open("agents", send), { id: one.id, have: b.bytes, done: taken }, "opened again: taken already");

  room = "Laptop's copies in use and this send take 21.0 GB on this machine, past the 20.0 GB kept for them: clear them in Settings › Remote access";
  assert.deepEqual(await s.open("agents", { project: "p", bytes: 5, sha256: "1".repeat(64) }), { status: 413, error: room });
  room = "";

  const opened = [];
  for (const n of [2, 3, 4, 5]) opened.push(await s.open("agents", { project: "p", bytes: 5, sha256: String(n).repeat(64) }));
  assert.ok(opened.every((o) => "id" in o));
  assert.deepEqual(await s.open("agents", { project: "p", bytes: 5, sha256: "6".repeat(64) }), { status: 429, error: "this machine has 4 sends open here, the most it may: send again once one ends" });
  at += 11 * 60_000;
  const sixth = /** @type {{ id: string }} */ (await s.open("agents", { project: "p", bytes: 5, sha256: "6".repeat(64) }));
  assert.ok(sixth.id, "an untouched one made way");
  const first = /** @type {{ id: string }} */ (opened[0]);
  assert.equal("status" in (await s.part("agents", first.id, { offset: 0, data: "AAAA" })), true, "the oldest untouched went");

  // Cleared: the sends into the store end, a part after is refused, and nothing writes the folder again.
  assert.equal(heard.length, 1);
  await heard[0]({ keys: [folderKeyOf(join(root, "p"))] });
  assert.deepEqual(await s.part("agents", sixth.id, { offset: 0, data: "AAAA" }), { status: 404, error: `no transfer ${sixth.id} of this device's: open it again (POST /transfers), and it goes on from where it stopped` });
});

// (fails before: yes — nothing checked a copy out: a launch's chat there worked in the person's clone; cp-place)
test("a copy placed for a launch: taken in its machine's folder and checked out at the commit sent; a second while it is held gets its own; one let go is taken again, its installs kept; a commit not sent, refused and the copy let go; another device's, refused", async (t) => {
  const dir = project(folder(t, "repo"));
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const devices = createDevices({ dataDir: data });
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Filament app on Laptop", machine: "66666666-6666-4666-8666-666666666666" });
  assert.ok(full.ok);
  const agents = devices.mintAgents(full.device.id, { from: "Laptop" });
  assert.ok(agents.ok);
  const device = agents.device.id;
  const copies = createCopies({ dataDir: data, root, devices });
  const s = createTransfers({ copies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy });
  const b = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const opened = await s.open(device, { project: "widgets", bytes: b.bytes, sha256: b.sha256 });
  assert.ok("id" in opened);
  await s.part(device, opened.id, { offset: 0, data: readFileSync(String(b.file)).toString("base64") });
  assert.deepEqual(await s.commit(device, opened.id), { commit: b.commit, project: "widgets" });

  const placed = await s.place(device, { project: "widgets", commit: b.commit });
  assert.ok("copy" in placed, JSON.stringify(placed));
  assert.equal(placed.folder, join(root, "From Laptop", "widgets", "1"));
  assert.equal(placed.reused, false);
  assert.equal(textOf(join(placed.folder, "src", "b.js")), "export const b = 2;\n", "uncommitted here: there");
  assert.equal(existsSync(join(placed.folder, "server.pem")), false, "what stays here is not there");
  const second = await s.place(device, { project: "widgets", commit: b.commit });
  assert.ok("copy" in second);
  assert.equal(second.folder, join(root, "From Laptop", "widgets", "2"), "the first is held: its own");

  mkdirSync(join(placed.folder, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(placed.folder, "node_modules", "dep", "i.js"), "installed\n");
  copies.release(placed.copy);
  const again = await s.place(device, { project: "widgets", commit: b.commit });
  assert.ok("copy" in again);
  assert.deepEqual([again.copy, again.reused], [placed.copy, true], "let go: taken again");
  assert.equal(existsSync(join(placed.folder, "node_modules", "dep", "i.js")), true, "its installs kept");

  // Placed, it is held a while for its chat to start there, not the hours a launch's turn holds it.
  const held = Number(copies.get(again.copy)?.busyUntil) - Date.now();
  assert.ok(held > BIND_MS - 60_000 && held <= BIND_MS, `held ${held} ms`);

  // A commit not here is refused before any copy is taken: the idle one stays its chat's.
  copies.release(again.copy);
  assert.equal(copies.bind(again.copy, "chat-a"), true);
  assert.deepEqual(await s.place(device, { project: "widgets", commit: "a".repeat(40) }), { status: 422, error: `the commit ${"a".repeat(12)} is not here: send the copy first` });
  assert.deepEqual([copies.get(placed.copy)?.busyUntil, copies.get(placed.copy)?.chat], [0, "chat-a"], "refused: untouched");
  // (fails before: yes — the swarm's review of 11-10: a change asked for again, its bring back tried for about the half
  // hour its copy is held after a turn, found the copy let go by then) Its change asked for holds it its chat's a while
  // more, never less than it was held.
  const backing = createTransfers({ copies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy, capture: captureCopy });
  const back = await backing.back(device, { copy: placed.copy, chat: "chat-a" });
  assert.ok(!("status" in back), JSON.stringify(back));
  const kept = Number(copies.get(placed.copy)?.busyUntil) - Date.now();
  assert.ok(kept > GRACE_MS - 60_000 && kept <= GRACE_MS, `held ${kept} ms`);
  assert.equal(copies.lease(placed.copy, "chat-a"), "");
  await backing.back(device, { copy: placed.copy, chat: "chat-a" });
  assert.ok(Number(copies.get(placed.copy)?.busyUntil) - Date.now() > GRACE_MS, "a turn's hold is not cut short");
  copies.release(placed.copy);
  // A checkout that throws lets its copy go.
  const thrown = createTransfers({ copies, take: importBundle, haves: mirrorHaves, checkout: async () => Promise.reject(new Error("disk gone")) });
  assert.deepEqual(await thrown.place(device, { project: "widgets", commit: b.commit }), { status: 422, error: "the copy could not be checked out: disk gone" });
  assert.equal(copies.get(placed.copy)?.busyUntil, 0, "let go again");
  // (fails before: yes — the review of cp-place: its hold began at the take, so a checkout that waited behind its
  // mirror's takes past it found its copy free to another launch) A hold that lapsed while it waited is held again.
  let lapsedId = "";
  /** @type {number[]} */
  const heldAtStart = [];
  const lapsing = createTransfers({
    copies: {
      ...copies,
      take: (/** @type {string} */ d, /** @type {string} */ p, /** @type {any} */ o) => {
        const took = copies.take(d, p, o);
        if (took.ok) copies.release((lapsedId = took.copy.id));
        return took;
      },
    },
    take: importBundle,
    haves: mirrorHaves,
    has: mirrorHas,
    checkout: async (/** @type {string} */ m, /** @type {string} */ f, /** @type {string} */ c, /** @type {any} */ o) => {
      heldAtStart.push(Number(copies.get(lapsedId)?.busyUntil) - Date.now());
      return checkoutCopy(m, f, c, o);
    },
  });
  assert.ok("copy" in (await lapsing.place(device, { project: "widgets", commit: b.commit })));
  assert.ok(Number(heldAtStart[0]) > 60 * 60_000, `held as its checkout starts: ${heldAtStart[0]} ms`);
  copies.release(lapsedId);
  assert.deepEqual(await s.place(device, { project: "widgets", commit: "HEAD" }), { status: 400, error: "commit is the copy's commit, 40 hex digits" });
  assert.deepEqual(await s.place("someone", { project: "widgets", commit: b.commit }), { status: 403, error: "copies are kept for another machine's agents alone" });
  assert.deepEqual(await createTransfers({ copies, take: importBundle, haves: mirrorHaves }).place(device, { project: "widgets", commit: b.commit }), { status: 503, error: "this Filament checks no copy out" });
});

// (fails before: yes — the re-review of cp-send: a send opened again while its take ran waited behind the take, so a
// sender whose commit's answer was lost timed out four times and gave up a copy that was taken)
test("a send opened again while its take runs is answered at once, and its commit asked again waits on that take", async (t) => {
  const dir = project(folder(t, "repo"));
  const root = folder(t, "copies");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  /** @type {() => void} */
  let let_ = () => {};
  const gate = new Promise((r) => (let_ = () => r(undefined)));
  /** @type {() => void} */
  let entered = () => {};
  const inTake = new Promise((r) => (entered = () => r(undefined)));
  const s = createTransfers({
    copies: { storeOf: (d, p) => (mkdirSync(join(root, p), { recursive: true }), { ok: true, folder: join(root, p) }), roomFor: () => "" },
    take: async (mirror, file) => (entered(), await gate, importBundle(mirror, file)),
    haves: mirrorHaves,
  });
  const send = { project: "p", bytes: b.bytes, sha256: b.sha256 };
  const opened = /** @type {{ id: string }} */ (await s.open("agents", send));
  await s.part("agents", opened.id, { offset: 0, data: readFileSync(String(b.file)).toString("base64") });
  const first = s.commit("agents", opened.id);
  await inTake;
  const again = await Promise.race([s.open("agents", send), new Promise((r) => setTimeout(r, 500, "waited"))]);
  assert.deepEqual(again, { id: opened.id, have: b.bytes }, "answered while the take runs");
  const asked = s.commit("agents", opened.id);
  let_();
  assert.deepEqual(await first, { commit: b.commit, project: "p" });
  assert.deepEqual(await asked, { commit: b.commit, project: "p" });
});

/**
 * A machine whose client calls the service in this process, as its routes would, a refusal with its status: its
 * connection cut once after `cutAfter` parts (0: never); `restarted` answers from part `restartAt` on, as a restart there
 * would; `lostCommit`: the first commit's answer lost on the way back; `haves`: what it says it holds, in place of its
 * mirror's; `onPart`: told each part's number as it goes.
 * @param {ReturnType<typeof service>} s @param {number} cutAfter
 * @param {{ restartAt?: number, restarted?: ReturnType<typeof service> | null, lostCommit?: boolean, haves?: string[] | null, onPart?: (n: number) => void }} [o]
 */
const machinesOver = (s, cutAfter, { restartAt = 0, restarted = null, lostCommit = false, haves = null, onPart = () => {} } = {}) => {
  let parts = 0;
  let cut = false;
  let lost = false;
  let there = s;
  /** @param {any} out */
  const answer = (out) => {
    if (out && "status" in out && "error" in out) throw Object.assign(new Error(out.error), { status: out.status, body: { error: out.error, ...(out.have != null ? { have: out.have } : {}), ...(out.lacks ? { lacks: true } : {}) } });
    return out;
  };
  const client = {
    state: { takes: ["transfer"] },
    /** @param {string} path */
    get: async (path) => (haves ? { haves } : answer(await there.haves("agents", new URL(`http://x${path}`).searchParams.get("project")))),
    /** @param {string} path @param {any} body @param {{ signal?: AbortSignal }} [o] */
    post: async (path, body, o) => {
      if (o?.signal?.aborted) throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      if (path === "/transfers") return answer(await there.open("agents", body));
      const [, id, what] = /^\/transfers\/([^/]+)\/(part|commit)$/.exec(path) || [];
      if (what === "part") {
        onPart(++parts);
        if (parts === cutAfter + 1) {
          cut = true;
          throw new Error("fetch failed: the connection was cut");
        }
        if (restarted && parts === restartAt) there = restarted;
        return answer(await there.part("agents", decodeURIComponent(id), body));
      }
      const done = answer(await there.commit("agents", decodeURIComponent(id)));
      if (lostCommit && !lost) {
        lost = true;
        throw new Error("The operation was aborted due to timeout");
      }
      return done;
    },
  };
  const m = { machine: { id: "22222222-2222-4222-8222-222222222222" }, name: "Workstation", device: { scope: "agent" } };
  return { machines: /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client }), wasCut: () => cut, parts: () => parts };
};

// (fails before: yes — nothing sent a copy)
test("the client: the first copy of a project to a machine waits on the person's yes, a no sends nothing; a send cut short goes on from where that machine says it stands; the next goes unasked", async (t) => {
  const dir = project(folder(t, "repo"));
  const root = folder(t, "copies");
  const s = service(root);
  const over = machinesOver(s, 2);
  const agents = createRemoteAgents({ machines: over.machines, wait: async () => {} });
  const name = String(basename(dir));
  const sent = sendsKept(join(folder(t, "data"), "remote-sends.json"));
  /** @type {any[]} */
  const asked = [];
  await assert.rejects(
    agents.sendCopy("Workstation", { folder: dir, sent, ask: async (o) => (asked.push(o), false), partBytes: 128 }),
    /no copy of .* went to Workstation: the person said no/,
  );
  assert.equal(existsSync(join(root, name, MIRROR)), false);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].left.map((/** @type {any} */ l) => l.path).sort(), LEFT);
  assert.ok(asked[0].files === CARRIED.length && asked[0].bytes > 0);

  const out = await agents.sendCopy("Workstation", { folder: join(dir, "src"), sent, ask: async (o) => (asked.push(o), true), partBytes: 128 });
  assert.equal(asked.length, 2);
  assert.deepEqual([out.project, out.sub, out.machine.name], [name, "src", "Workstation"]);
  assert.equal(over.wasCut(), true, "the send was cut after two parts");
  assert.deepEqual(await mirrorHaves(join(root, name, MIRROR)), [out.commit], "taken up where it was cut, and taken in");

  writeFileSync(join(dir, "src", "c.js"), "export const c = 4;\n");
  const next = await agents.sendCopy("Workstation", { folder: dir, sent, ask: async () => assert.fail("asked twice"), partBytes: 1 << 20 });
  assert.notEqual(next.commit, out.commit);
  assert.deepEqual((await mirrorHaves(join(root, name, MIRROR))).sort(), [out.commit, next.commit].sort(), "both there: a second's commits tie in their order");
  assert.equal(gitIn(dir, "rev-parse", `${next.commit}^`), out.commit, "the next built on the one there");
});

// (fails before: yes — the review of cp-send: a restart there mid-send (404) and a commit whose answer was lost gave the
// send up; a bundle built on a commit gone there went whole only on git's English words; a stop sent every part)
test("the client, robust: a restart there mid-send is opened again and goes on; a commit whose answer was lost is answered as taken; one built on a commit gone there goes whole; a stop ends the send between parts", async (t) => {
  const dir = project(folder(t, "repo"));
  const sent = sendsKept(null);
  const yes = async () => true;
  const name = String(basename(dir));

  const root = folder(t, "restart");
  const over = machinesOver(service(root), 0, { restartAt: 3, restarted: service(root), lostCommit: true });
  const out = await createRemoteAgents({ machines: over.machines, wait: async () => {} }).sendCopy("Workstation", { folder: dir, sent, ask: yes, partBytes: 64 });
  assert.ok(over.parts() > 3, "parts went after the restart");
  assert.deepEqual(await mirrorHaves(join(root, name, MIRROR)), [out.commit], "taken once, its lost answer asked again");

  // That machine says it holds the commit, but its mirror is new: the bundle built on it is refused, and goes whole.
  writeFileSync(join(dir, "src", "d.js"), "export const d = 5;\n");
  const fresh = folder(t, "fresh");
  const stale = machinesOver(service(fresh), 0, { haves: [out.commit] });
  const whole = await createRemoteAgents({ machines: stale.machines, wait: async () => {} }).sendCopy("Workstation", { folder: dir, sent, ask: yes });
  assert.deepEqual(await mirrorHaves(join(fresh, name, MIRROR)), [whole.commit]);
  assert.equal(gitIn(dir, "rev-list", "--count", whole.commit), "1", "the whole tree, alone");

  // Stopped after the second part: no third goes, and the send says it was stopped.
  writeFileSync(join(dir, "src", "e.js"), "export const e = 6;\n");
  const stop = new AbortController();
  const stopping = machinesOver(service(folder(t, "stop")), 0, { onPart: (n) => n === 2 && stop.abort() });
  await assert.rejects(
    createRemoteAgents({ machines: stopping.machines, wait: async () => {} }).sendCopy("Workstation", { folder: dir, sent, ask: yes, partBytes: 64, signal: stop.signal }),
    /its send was stopped/,
  );
  assert.equal(stopping.parts(), 2);
});

// (fails before: yes — the review of cp-send: a project's mirror and its sends lay in the machine's own folder, which its
// agents work in and could write a mirror's config in, run by Filament's git; nothing counted it, cleared it or swept it)
test("a machine's store: outside its folder, fenced from its agents; counted in its room; cleared with its copies; a project's going once idle a week with no copy", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const devices = createDevices({ dataDir: data });
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Filament app on Laptop", machine: "33333333-3333-4333-8333-333333333333" });
  assert.ok(full.ok);
  const agents = devices.mintAgents(full.device.id, { from: "Laptop" });
  assert.ok(agents.ok);
  const device = agents.device.id;
  let at = 1_000_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at, maxBytes: 1000 });
  const store = copies.storeOf(device, "widgets");
  assert.ok(store.ok);
  assert.equal(store.folder, join(root, ".mirrors", "From Laptop", "widgets"));
  const fence = copies.fenceOf(device);
  assert.equal(fence.copies, join(root, "From Laptop"));
  assert.match(copiesRefusal(join(store.folder, MIRROR, "config"), { ...fence, doing: "write" }), /in their own machine's copies alone; .* is in Filament's copies folder, not in theirs/, "their agents never reach it");
  assert.deepEqual(copies.storeOf("someone", "widgets"), { ok: false, why: "copies are kept for another machine's agents alone" });

  writeFileSync(join(store.folder, "pack"), Buffer.alloc(600));
  assert.equal(await copies.measureStore(device, "widgets"), 600);
  assert.equal(copies.usage(device)?.bytes, 600, "counted with its copies");
  assert.equal(copies.roomFor(device, 300), "");
  assert.match(copies.roomFor(device, 500), /past the 0 MB kept for them/);

  // Idle a week with no copy of it: it goes at a sweep; one with a copy in use stays.
  const other = copies.storeOf(device, "gadgets");
  assert.ok(other.ok);
  assert.ok(copies.take(device, "gadgets", { leaseMs: 30 * 24 * 3600_000 }).ok);
  at += 8 * 24 * 3600_000;
  await copies.sweep();
  await copies.settled();
  assert.equal(existsSync(store.folder), false, "idle and no copy: gone");
  assert.equal(existsSync(other.folder), true, "its copy in use: kept");
  assert.equal(copies.usage(device)?.bytes, 0);

  // Cleared: the machine's store goes with its folder.
  const again = copies.storeOf(device, "widgets");
  assert.ok(again.ok);
  await copies.clear(device);
  assert.equal(existsSync(join(root, ".mirrors", "From Laptop")), false);
});

// (fails before: yes — the re-review of cp-send: a store a let-go was removing was made again and written into, and
// one whose removal failed was then swept with what came since; a question made a store, and any number of them)
test("a store being removed is refused for a moment, made again once it is gone; a question names one without making it; a machine keeps 50 at most", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const devices = createDevices({ dataDir: data });
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Filament app on Laptop", machine: "44444444-4444-4444-8444-444444444444" });
  assert.ok(full.ok);
  const agents = devices.mintAgents(full.device.id, { from: "Laptop" });
  assert.ok(agents.ok);
  const device = agents.device.id;
  let at = 1_000_000;
  let held = true;
  const copies = createCopies({
    dataDir: data,
    root,
    devices,
    now: () => at,
    removeFolder: async (f) => {
      if (held && f.includes(STORES)) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      rmSync(f, { recursive: true, force: true });
    },
  });
  const named = copies.storeOf(device, "asked", { make: false });
  assert.ok(named.ok);
  assert.equal(existsSync(named.folder), false, "a question makes nothing");
  const store = copies.storeOf(device, "widgets");
  assert.ok(store.ok);
  at += 8 * 24 * 3600_000;
  await copies.sweep();
  await copies.settled();
  assert.deepEqual(copies.storeOf(device, "widgets"), { ok: false, busy: true, why: "what Laptop sent of widgets is being removed here: send again in a moment" });
  held = false;
  await copies.sweep();
  await copies.settled();
  assert.equal(existsSync(store.folder), false);
  assert.ok(copies.storeOf(device, "widgets").ok, "gone: made again");

  for (let n = 1; n < STORES_MAX; n++) assert.ok(copies.storeOf(device, `p${n}`).ok);
  assert.deepEqual(copies.storeOf(device, "one-more"), { ok: false, why: `Laptop sends ${STORES_MAX} projects here, the most this machine keeps: clear its copies in Settings › Remote access` });
  assert.ok(copies.storeOf(device, "p1").ok, "one it keeps is still its");
});

// (fails before: yes — another machine's agents had no transfers rows: 403, a row not named for them)
test("between two Filaments: their agents' device sends a copy into its machine's copies folder there, and only theirs; this machine's person is refused the rows", async (t) => {
  const base = folder(t, "two");
  const was = process.env.FILAMENT_COPIES_DIR;
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
  });
  const dir = project(join(base, "widgets"));
  const two = await startTwoMachines({});
  try {
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ from: "Laptop" }) })).json();
    const store = createMachines({ dataDir: two.here.dataDir });
    store.keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    assert.equal((await two.there.api(`/api/remote/devices/${encodeURIComponent(minted.device.id)}`, { method: "PATCH", body: { grants: { agents: true } } })).status, 200);
    const out = await createRemoteAgents({ machines: store }).sendCopy(two.remote.machine.name, { folder: dir, sent: sendsKept(null), ask: async () => true });
    const mirror = join(base, "copies", ".mirrors", "From Laptop", "widgets", MIRROR);
    assert.ok(existsSync(mirror), `the mirror in the machine's store: ${mirror}`);
    assert.deepEqual(filesOf(mirror, out.commit), CARRIED);
    // Their agents start no chat in it: it is out of their reach.
    const c = await store.clientOf(store.list()[0], { agents: true });
    await assert.rejects(c.post("/sessions", { cwd: dirname(mirror) }), /in their own machine's copies alone/);
    // This machine's person: none of these rows are theirs.
    assert.equal((await two.there.api("/api/transfers", { method: "POST", body: { project: "widgets", bytes: 1, sha256: "0".repeat(64) } })).status, 403);
  } finally {
    await two.stop();
  }
});
