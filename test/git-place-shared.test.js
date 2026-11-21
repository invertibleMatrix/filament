// @ts-check
// `/git/place` is asked by the header at each turn's end and by the panel while a chat is shown, in every window that
// shows one: a place's whole read is seven to nine git processes. One read of a place is under way at a time and serves
// every ask for a few seconds after it came, as the Changes tab's does — the chat's other places too. git's trace
// (GIT_TRACE2_EVENT) counts the processes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitProgram } from "../src/adapters/git/snapshot.js";
import { gitRoutes } from "../src/http/admin/git.js";
import { createRouter } from "../src/http/router.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}
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
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim();
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

/** How many git processes a call starts. @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, runs: number }>} */
const counted = async (fn) => {
  // The git to start is found first (`gitProgram`): its own `--exec-path` is not `fn`'s.
  await gitProgram();
  const t = fresh("filament-trace-");
  const file = join(t, "trace.json");
  const was = process.env.GIT_TRACE2_EVENT;
  process.env.GIT_TRACE2_EVENT = file;
  try {
    const value = await fn();
    const runs = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes('"event":"start"')).length : 0;
    return { value, runs };
  } finally {
    if (was === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = was;
  }
};

/** The git rows over a folder of roots, the chat's places as given. @param {string} root @param {string[]} [places] */
const routes = (root, places = []) => {
  const rows = gitRoutes({ config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) }, memory: { placesOf: () => places } });
  /** @param {string} path */
  return async (path) => {
    const m = createRouter(rows)("GET", path.split("?")[0]);
    assert.ok(m, `GET ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, setHeader() {}, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => ({}) }, {});
    return got;
  };
};

/**
 * The clock stands still while a test asks: a read serves every ask for `CHANGES_TTL_MS` after it came, and the reads
 * between its asks, each several git processes, take longer than that under a full suite's load.
 * @param {import("node:test").TestContext} t
 */
const stillClock = (t) => t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

// (fails before: yes — every ask read the place anew: two asks at once were twice the processes, an ask again as many)
test("asks at once share one read of the place, and an ask within a few seconds starts no git process", { skip: !hasGit && "git is not on PATH" }, async (t) => {
  stillClock(t);
  const base = fresh("filament-gp-");
  const one = repoIn(join(base, "one"));
  const two = repoIn(join(base, "two"));
  const call = routes(base);
  const at = (/** @type {string} */ dir) => `/git/place?cwd=${encodeURIComponent(dir)}`;
  const alone = await counted(() => call(at(one)));
  assert.equal(alone.value.status, 200);
  assert.deepEqual([alone.value.body.ok, alone.value.body.branch, alone.value.body.uncommitted?.files], [true, "main", 0]);
  assert.ok(alone.runs >= 4, `a whole read is several processes (${alone.runs})`);
  const both = await counted(() => Promise.all([call(at(two)), call(at(two))]));
  assert.equal(both.runs, alone.runs, "two asks at once: one read");
  assert.deepEqual(both.value[0].body, both.value[1].body);
  writeFileSync(join(one, "late.txt"), "l\n");
  const again = await counted(() => call(at(one)));
  assert.equal(again.runs, 0, "served from the read before");
  assert.equal(again.value.body.uncommitted?.files, 0, "as it stood when read");
});

test("the chat's other places share the reads of each: a place asked for itself and as another's is read once", { skip: !hasGit && "git is not on PATH" }, async (t) => {
  stillClock(t);
  const base = fresh("filament-gp-also-");
  const repo = repoIn(join(base, "proj"));
  const wt = join(base, "proj-wt");
  run(repo, ["worktree", "add", "-q", "-b", "agent", wt]);
  const call = routes(base, [wt]);
  const own = await counted(() => call(`/git/place?cwd=${encodeURIComponent(wt)}`));
  assert.equal(own.value.body.branch, "agent");
  assert.ok(own.runs > 0);
  const withAlso = await counted(() => call(`/git/place?cwd=${encodeURIComponent(repo)}&chain=c1`));
  assert.deepEqual(withAlso.value.body.also.map((/** @type {any} */ p) => [p.cwd, p.branch, p.worktree]), [[wt, "agent", true]]);
  // The folder alone, read by rows that have read nothing yet: what the ask with its other place cost.
  const repoFresh = await counted(() => routes(base, [])(`/git/place?cwd=${encodeURIComponent(repo)}`));
  assert.equal(withAlso.runs, repoFresh.runs, "the worktree came from its own read before");
  const repoAgain = await counted(() => call(`/git/place?cwd=${encodeURIComponent(repo)}`));
  assert.equal(repoAgain.runs, 0, "the folder's read is shared too");
});
