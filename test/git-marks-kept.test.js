// @ts-check
// The git marks answered at once from what was last read (the slowness of 11-02): `/git/place`, `/git/where` and
// `/git/places` each read git for seconds in a large repository — 2–6 s, 4.5–8.9 s and 8–15 s on the owner's —, and the
// page waited on each with one of its six connections while its other reads queued behind. A read kept answers at once;
// past a few seconds an ask reads again behind it, and where the answer moved the page hears it on the events feed
// (`git-moved`, with each spelling the folder was asked by) and asks again, answered at once. A worktree removed or put
// back is read anew at the next ask. Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoutes } from "../src/http/admin/git.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
/** @param {string} prefix */
const fresh = (prefix) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
};
/** A repository on main with one commit. @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(dir, { recursive: true });
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-qm", "init"]);
  return dir;
};
/** How long a kept read answers without a read behind it, in these tests. */
const KEPT_MS = 150;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** The git rows over a folder of roots, with the feed they tell. @param {string} root */
const routes = (root) => {
  /** @type {any[]} */
  const told = [];
  const events = { publish: (/** @type {string} */ topic, /** @type {any} */ msg) => void told.push({ topic, ...msg }) };
  const open = { moved: 0 };
  const rows = gitRoutes({ config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) }, memory: { placesOf: () => [], chatsIn: () => new Map() }, events, keptMs: KEPT_MS, openMoved: () => void open.moved++ });
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body = {}) => {
    const m = createRouter(rows)(method, path.split("?")[0]);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, setHeader() {}, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ req: { headers: {}, method, socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => body }, {});
    assert.equal(got.status, 200, JSON.stringify(got.body));
    return got.body;
  };
  /** The feed's word that `what` moved for `folder`, once it comes. @param {string} what @param {string} folder */
  const heard = async (what, folder) => {
    for (let i = 0; i < 200; i++) {
      const m = told.find((x) => x.topic === "git" && x.type === "git-moved" && x.what === what && x.folders.includes(folder));
      if (m) return m;
      await sleep(25);
    }
    assert.fail(`no git-moved of ${what} for ${folder}: ${JSON.stringify(told)}`);
  };
  return { call, told, heard, open };
};

// (fails before: yes — an ask past the few seconds waited for git's read again)
test("a place is answered from its last read at once, read again behind it, and the page told where it moved", { skip: !hasGit && "git is not on PATH" }, async () => {
  const base = fresh("filament-kept-place-");
  const repo = repoIn(join(base, "proj"));
  const { call, told, heard } = routes(base);
  const at = `/git/place?cwd=${encodeURIComponent(repo)}`;
  assert.equal((await call("GET", at)).uncommitted?.files, 0, "nothing kept: the first ask waits for its read");
  writeFileSync(join(repo, "late.txt"), "l\n");
  await sleep(KEPT_MS + 50);
  assert.equal((await call("GET", at)).uncommitted?.files, 0, "past the few seconds: the last read at once");
  const m = await heard("place", repo);
  assert.deepEqual(m.folders.filter((/** @type {string} */ f) => f === repo), [repo]);
  assert.equal((await call("GET", at)).uncommitted?.files, 1, "asked again: the read behind, at once");
  await sleep(KEPT_MS + 50);
  const n = told.length;
  await call("GET", at);
  await sleep(KEPT_MS * 2);
  assert.equal(told.length, n, "read again, nothing moved: nothing told");
});

// (fails before: yes — every ask of the sidebar's read each folder anew)
test("the sidebar's marks, light and apart, are answered from their last reads and told where they moved", { skip: !hasGit && "git is not on PATH" }, async () => {
  const base = fresh("filament-kept-where-");
  const repo = repoIn(join(base, "proj"));
  const wt = join(base, "proj-wt");
  run(repo, ["worktree", "add", "-q", "-b", "agent", wt]);
  const { call, heard } = routes(base);
  const apart = `/git/where?apart=1&cwd=${encodeURIComponent(wt)}`;
  const light = `/git/where?cwd=${encodeURIComponent(repo)}`;
  assert.equal((await call("GET", apart)).places[wt].ahead, 0);
  assert.equal((await call("GET", light)).places[repo].branch, "main");
  writeFileSync(join(wt, "b.txt"), "b\n");
  run(wt, ["add", "-A"]);
  run(wt, ["commit", "-qm", "work"]);
  run(repo, ["checkout", "-q", "-b", "other"]);
  await sleep(KEPT_MS + 50);
  assert.equal((await call("GET", apart)).places[wt].ahead, 0, "the last read, at once");
  assert.equal((await call("GET", light)).places[repo].branch, "main", "the last read, at once");
  await heard("apart", wt);
  await heard("light", repo);
  assert.equal((await call("GET", apart)).places[wt].ahead, 1);
  assert.equal((await call("GET", light)).places[repo].branch, "other");
});

// (fails before: yes — the places were read anew at each ask)
test("a repository's places are answered from their last read; a worktree removed is read anew at the next ask", { skip: !hasGit && "git is not on PATH" }, async () => {
  const base = fresh("filament-kept-places-");
  const repo = repoIn(join(base, "proj"));
  const one = join(base, "proj-one");
  run(repo, ["worktree", "add", "-q", "-b", "one", one]);
  const { call, heard, open } = routes(base);
  const at = `/git/places?cwd=${encodeURIComponent(repo)}`;
  /** @param {any} a */
  const names = (a) => a.places.map((/** @type {any} */ p) => p.name).sort();
  const first = await call("GET", at);
  assert.deepEqual(names(first), ["proj", "proj-one"]);
  assert.equal(first.places.find((/** @type {any} */ p) => p.name === "proj-one").removable, true);
  assert.ok(first.places.find((/** @type {any} */ p) => p.name === "proj-one").goes, "what goes with a removable one");
  const two = join(base, "proj-two");
  run(repo, ["worktree", "add", "-q", "-b", "two", two]);
  await sleep(KEPT_MS + 50);
  assert.deepEqual(names(await call("GET", at)), ["proj", "proj-one"], "the last read, at once");
  await heard("places", repo);
  const moved = await call("GET", at);
  assert.deepEqual(names(moved), ["proj", "proj-one", "proj-two"]);
  assert.deepEqual(moved.places.find((/** @type {any} */ p) => p.name === "proj-one"), first.places.find((/** @type {any} */ p) => p.name === "proj-one"), "a row as it was read whole");
  // Removed on the developer's click: the next ask reads anew, within the few seconds too.
  await call("POST", "/git/places/remove", { cwd: repo, path: one });
  // (fails before: yes — the reviewer's of 11-10: the Plan's Still open card said the worktree for minutes after)
  assert.equal(open.moved, 1, "what is still open is read anew too");
  const after = await call("GET", at);
  assert.deepEqual(names(after), ["proj", "proj-two"]);
  assert.deepEqual(after.removed.map((/** @type {any} */ r) => r.name), ["proj-one"]);
  await call("POST", "/git/places/put-back", { cwd: repo, id: after.removed[0].id });
  assert.equal(open.moved, 2);
  assert.deepEqual(names(await call("GET", at)), ["proj", "proj-one", "proj-two"], "put back: read anew");
});
