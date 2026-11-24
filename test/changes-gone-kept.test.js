// @ts-check
// A turn's changes answer kept where a place's folder is gone (the review of 11-18, after the command center's change:
// an answer that said "the folder is gone" was never kept, so a turn whose worktree was removed walked its other places
// with git at every ask, and would on every start). Such an answer rests on its basis, which holds the places gone, so
// it is kept — where the basis found that folder gone too: one that went while the read ran is not, and a git failure
// never is. The memory route (a turn's tree card, the command center) and the runs route (a run's file card and edit
// cards) alike. Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { FOLDER_GONE, onlyGone } from "../src/adapters/git/changes.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { runRoutes } from "../src/http/admin/runs.js";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

/**
 * A repository (`a`, its place `place`) with two rounds' snapshots, and a folder beside it (`b`) that a later round
 * wrote in, never a repository: a read of it fails as git's, or says it is gone. `armGone()` takes `b` away once the
 * next ask has taken its basis, before its read reaches `b` — at `fire()`, which the routes' reads ahead of the basis
 * call (the places alone, the run's snapshots) in the same moment as the read's start.
 */
async function world() {
  const dir = mkdtempSync(join(tmpdir(), "filament-gone-kept-"));
  made.push(dir);
  const a = join(dir, "a");
  const b = join(dir, "b");
  mkdirSync(a);
  mkdirSync(b);
  git(a, ["init", "-q", "-b", "main"]);
  writeFileSync(join(a, "a.txt"), "one\n");
  git(a, ["add", "."]);
  git(a, ["commit", "-q", "-m", "init"]);
  const head = git(a, ["rev-parse", "HEAD"]);
  const place = git(a, ["rev-parse", "--show-toplevel"]);
  writeFileSync(join(a, "a.txt"), "one\ntwo\n");
  const s1 = String((await snapshotTree(a, { name: "gk/1-1" })).commit);
  writeFileSync(join(a, "b.txt"), "b\n");
  const s2 = String((await snapshotTree(a, { name: "gk/1-2", previous: s1 })).commit);
  const bPlace = b.split("\\").join("/");
  /** @type {any[]} */
  const rounds = [
    { place, round: 1, agent: "", before: head, after: s1, base: "round", own: ["a.txt"], command: false },
    { place, round: 2, agent: "", before: s1, after: s2, base: "round", own: ["b.txt"], command: false },
    { place: bPlace, round: 2, agent: "", before: s1, after: s2, base: "round", own: ["c.txt"], command: false },
  ];
  let armed = false;
  /** Where `armGone` asked it: `b` goes once this moment's work is done. */
  const fire = () => {
    if (!armed) return;
    armed = false;
    setImmediate(() => rmSync(b, { recursive: true, force: true }));
  };
  const placesAlone = () => {
    fire();
    return new Set();
  };
  /** git cannot be asked in `a` while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    renameSync(join(a, ".git"), join(a, ".git-away"));
    try {
      await fn();
    } finally {
      renameSync(join(a, ".git-away"), join(a, ".git"));
    }
  };
  return {
    dir, a, b, place, bPlace, rounds, placesAlone, fire, gitAway,
    armGone: () => void (armed = true),
    takeB: () => rmSync(b, { recursive: true, force: true }),
    putB: () => mkdirSync(b, { recursive: true }),
  };
}

/** A route's handler asked `path?query`, its answer read. @param {any} route @param {string} path @param {string} query */
async function asked(route, path, query) {
  const m = route("GET", path);
  assert.ok(m);
  let body = "";
  let status = 0;
  const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
  await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://127.0.0.1${path}?${query}`), path, method: "GET", params: m.params }), /** @type {any} */ ({}));
  assert.equal(status, 200, body);
  return JSON.parse(body);
}

/** The memory changes route over the world's turn 1. @param {Awaited<ReturnType<typeof world>>} w */
function memoryRoute(w) {
  const memory = {
    roundsOf: () => ({ chainId: "c1", turns: 1, cwd: w.a, rounds: w.rounds.map((x) => ({ ...x, turn: 1 })), tree: null }),
    placesAlone: w.placesAlone,
  };
  const route = createRouter(memoryRoutes(/** @type {any} */ ({ memory, usage: {}, sseClients: new Set() })));
  return (/** @type {string} */ query) => asked(route, "/memory/sessions/c1/changes", query);
}

/** The runs changes route over a run whose snapshots are the world's rounds. @param {Awaited<ReturnType<typeof world>>} w */
function runsRoute(w) {
  const data = mkdtempSync(join(tmpdir(), "filament-gone-kept-runs-"));
  made.push(data);
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: data, config: () => ({}) });
  runs.startRun({ id: "run-gk", kind: "agent-turn", meta: { root: w.a, chain: "c1" } });
  for (const x of w.rounds) bus.publish("run:run-gk", { type: "snapshot", ...x });
  // The route reads the run's snapshots, then takes its basis and starts its read, in one moment: a round's ask reads
  // no places alone.
  const events = runs.events;
  runs.events = (/** @type {any[]} */ ...args) => {
    w.fire();
    return events.apply(runs, /** @type {any} */ (args));
  };
  const route = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set(), memory: { placesAlone: w.placesAlone } })));
  after(() => runs.close());
  return (/** @type {string} */ query) => asked(route, "/runs/run-gk/changes", query);
}

const gone = (/** @type {Awaited<ReturnType<typeof world>>} */ w) => ({ place: w.bPlace, error: FOLDER_GONE });
const onlyGit = (/** @type {any[]} */ errors) => errors.some((e) => e.error !== FOLDER_GONE);

// (fails before: yes — an answer that said a folder was gone was never kept)
test("the memory route: a place gone when the basis was taken and when it was read is kept; the files of the rest served", async () => {
  const w = await world();
  const ask = memoryRoute(w);
  w.takeB();
  const first = await ask("turn=1");
  assert.deepEqual(first.errors, [gone(w)]);
  assert.deepEqual(first.files.map((/** @type {any} */ f) => f.path).sort(), ["a.txt", "b.txt"]);
  const cut = await ask("turn=1&first=1");
  await w.gitAway(async () => {
    assert.deepEqual(await ask("turn=1"), { ...first, folder: null }, "kept: git out of reach, nothing asked of it");
    assert.deepEqual((await ask("turn=1&first=1")).files, cut.files, "the first rows kept too");
    assert.deepEqual((await ask("turn=1&match=b&take=6")).errors, [gone(w)], "and the command center's cut");
  });
});

// (fails before: no — this was never kept; the test holds that it still is not)
test("the memory route: a place that went while the read ran is not kept, though it is back by the next ask", async () => {
  const w = await world();
  const ask = memoryRoute(w);
  w.armGone();
  const first = await ask("turn=1");
  assert.deepEqual(first.errors, [gone(w)], "the read found it gone, the basis did not");
  w.putB();
  await w.gitAway(async () => {
    const again = await ask("turn=1");
    assert.ok(onlyGit(again.errors), `read again: ${JSON.stringify(again.errors)}`);
  });
});

test("the memory route: git's failure beside a gone place is not kept", async () => {
  const w = await world();
  const ask = memoryRoute(w);
  w.takeB();
  await w.gitAway(async () => {
    assert.ok(onlyGit((await ask("turn=1")).errors));
  });
  const now = await ask("turn=1");
  assert.deepEqual([now.errors, now.files.length], [[gone(w)], 2], "read again once git answers");
});

// (fails before: yes — the run's answer, and a round's, were never kept with a gone folder)
test("the runs route: the run's whole and a round's, a place gone at the basis and at the read, kept", async () => {
  const w = await world();
  const ask = runsRoute(w);
  w.takeB();
  const whole = await ask("first=500");
  assert.deepEqual(whole.whole.errors, [gone(w)]);
  const round = await ask("round=2");
  assert.deepEqual(round.rounds.map((/** @type {any} */ x) => [x.place, x.files.length, x.error ?? null]), [[w.place, 1, null], [w.bPlace, 0, FOLDER_GONE]]);
  await w.gitAway(async () => {
    // The run's folder is read with its answer, and kept with it.
    assert.deepEqual(await ask("first=500"), whole, "the run's, kept");
    assert.deepEqual(await ask("round=2"), round, "the round's, kept");
  });
});

test("the runs route: a place that went while the read ran is not kept; git's failure beside a gone one is not", async () => {
  const w = await world();
  const ask = runsRoute(w);
  w.armGone();
  assert.deepEqual((await ask("round=2")).rounds.at(-1).error, FOLDER_GONE);
  w.putB();
  await w.gitAway(async () => {
    const again = await ask("round=2");
    assert.ok(again.rounds.some((/** @type {any} */ x) => x.error && x.error !== FOLDER_GONE), `read again: ${JSON.stringify(again.rounds)}`);
  });
  w.takeB();
  await w.gitAway(async () => {
    assert.ok(onlyGit((await ask("first=500")).whole.errors));
  });
  assert.deepEqual((await ask("first=500")).whole.errors, [gone(w)], "read again once git answers");
});

test("onlyGone: every error a gone folder the basis counted; none at all; never git's, one with no place, or a place the basis found there", () => {
  const g = ["C:/w/b"];
  assert.equal(onlyGone([], g), true);
  assert.equal(onlyGone([{ place: "C:/w/b", error: FOLDER_GONE }], g), true);
  assert.equal(onlyGone([{ place: "C:/w/c", error: FOLDER_GONE }], g), false, "gone at the read, there at the basis");
  assert.equal(onlyGone([{ place: "C:/w/b", error: "git timed out" }], g), false);
  assert.equal(onlyGone([{ place: "C:/w/b", error: FOLDER_GONE }, { place: "C:/w/a", error: "git timed out" }], g), false);
  assert.equal(onlyGone([{ error: FOLDER_GONE }], g), false, "no place");
});

test("the routes' wiring: the gone places the basis took are the ones the keep reads", () => {
  const memory = readFileSync(new URL("../src/http/admin/memory.js", import.meta.url), "utf8");
  assert.match(memory, /const \{ basis, gone \} = kept \? await turnBasis\(t\.rounds, alone\) : \{ basis: "", gone: \[\] \};/);
  assert.match(memory, /const keep = \(\/\*\* @type \{any\} \*\/ o\) => onlyGone\(o\.errors, gone\);/);
  // Each place looked at off the server's thread (x31): gone where it said so; one that did not answer in the basis apart.
  assert.match(memory, /const gone = places\.filter\(\(_, i\) => there\[i\] === false\);/);
  const runs = readFileSync(new URL("../src/http/admin/runs.js", import.meta.url), "utf8");
  assert.match(runs, /const there = await Promise\.all\(places\.map\(\(p\) => folderThere\(p\)\)\);\n\s+const goneList = places\.filter\(\(_, i\) => there\[i\] === false\);\n\s+const gone = \[goneList\.join\("\|"\), \.\.\.places\.filter\(\(_, i\) => there\[i\] === null\)\.map\(\(p\) => `\?\$\{p\}`\)\]\.join\("\|"\);/);
  assert.match(runs, /const keep = \(\/\*\* @type \{any\} \*\/ said\) => onlyGone\(\(said\.rounds \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ x\) => x\.error\), goneList\) && onlyGone\(said\.whole\?\.errors \|\| \[\], goneList\);/);
});
