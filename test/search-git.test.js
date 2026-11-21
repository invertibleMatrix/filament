// @ts-check
// The name search lists a repository's files with one `git ls-files` (`searchNames`, adapters/tools/workspace.js),
// started on the spawn pool's threads. Its git is the one `gitProgram` finds — on Windows the real git, not Git for
// Windows' launcher — so the stop that cuts a listing past what a search keeps ends git itself, and nothing it started
// holds the folder after its answer. A git that could not run, or a thread that stopped, says so in its own words, never
// as git refusing the repository. Every repository here is a throwaway under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gitProgram } from "../src/adapters/git/snapshot.js";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { searchNames } from "../src/adapters/tools/workspace.js";
import { gitFaultsHere } from "./helpers/git-fault.js";

/** Git calls answered otherwise in this process, armed before the pool starts its first thread. */
const armed = gitFaultsHere();

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const skip = !hasGit && "git is not on PATH";
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
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-search-"));
  made.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-qm", "init"]);
  return dir;
};
/** Whether a program stands in `dir` — a git still running there holds it as its folder, and it cannot be renamed. @param {string} dir */
const held = (dir) => {
  try {
    renameSync(dir, `${dir}-moved`);
    renameSync(`${dir}-moved`, dir);
    return false;
  } catch {
    return true;
  }
};

// (fails before: yes — the review of 11-03: the search started the PATH's git, Git for Windows' launcher, and its stop
// at the listing's cap ended the launcher alone)
test("a listing past what a search keeps is cut by a stop that ends git itself: no folder is held after the answer", { skip }, async () => {
  const dir = repo();
  // A listing far past the 64 MB a search keeps: names of a kilobyte each, 256 MB of them, which git writes for a while.
  const big = join(dir, "big.bin");
  const name = Buffer.from(`${"x".repeat(1023)}\0`);
  writeFileSync(big, Buffer.concat(Array.from({ length: 256 * 1024 }, () => name)));
  const blob = run(dir, ["hash-object", "-w", "big.bin"]);
  rmSync(big);
  // The git to start, found first: its look starts the PATH's git once, as the search's own does not.
  const real = (await gitProgram()).file;
  /** @type {Set<string>} */
  const programs = new Set();
  const on = (/** @type {any} */ m) => void (m.event === "start" && /^git(\.exe)?$/i.test(basename(String(m.file))) && programs.add(String(m.file)));
  subscribe(SPAWN_CHANNEL, on);
  try {
    /** @type {string[]} */
    const left = [];
    for (let i = 0; i < 4; i++) {
      // The search's own listing, answered by git with the blob's bytes.
      const fault = armed.arm({ match: { has: ["ls-files"] }, args: ["cat-file", "blob", blob] });
      const r = await searchNames(dir, "");
      assert.notEqual(await Promise.race([fault.reached, new Promise((done) => setTimeout(done, 5_000, "late"))]), "late", "the listing answered as armed");
      assert.equal(r.truncated, true, "cut at what a search keeps");
      if (held(dir)) left.push(`search ${i + 1}`);
    }
    assert.deepEqual([...programs], [real], "the search's git is the one gitProgram finds");
    assert.deepEqual(left, [], "the folder is free the moment the search answers");
  } finally {
    unsubscribe(SPAWN_CHANNEL, on);
  }
});

// (fails before: yes — the Hunter's of 11-03: every failure with a code in words — a thread that stopped, files that
// could not be made, a cap passed on its errors — read "git refuses the repository this folder is in")
test("a git that could not run says so in its own words, never as git refusing the repository", { skip }, () => {
  const dir = repo();
  const url = pathToFileURL(join(import.meta.dirname, "..", "src", "adapters", "tools", "workspace.js")).href;
  const script = `const { searchNames } = await import(${JSON.stringify(url)}); try { await searchNames(${JSON.stringify(dir)}, ""); process.stdout.write("listed"); } catch (e) { process.stdout.write(String(e?.message || e)); }`;
  // The temp folder gone, where the pool's threads write what git says: git cannot run there.
  const nowhere = join(dir, "no-such-folder");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TEMP: nowhere, TMP: nowhere, TMPDIR: nowhere }, windowsHide: true });
  assert.match(out, /^git ls-files could not run \(the files the process's output goes to could not be made/);
  assert.doesNotMatch(out, /git refuses/);
});
