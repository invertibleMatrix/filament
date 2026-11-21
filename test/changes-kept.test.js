// @ts-check
// A turn's and a run's changes, cut to the rows their cards draw, kept on disk across a restart (the owner's of 11-18:
// "The first time you open a very large turn after a restart, it takes about 65 seconds. After that it's fast."): the
// store's own rules, what a walk tells of itself (`walkOf`), and the two routes — a restart serves the cut from disk
// with git out of reach, and reads again where what it rests on moved. Every repository and store is a throwaway under
// the temp folder — never this one, never the data folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { WALK_VERSION, ownChangesOf, walkOf } from "../src/adapters/git/changes.js";
import { CHANGES_KEPT_MOST, KEPT_SLOW_MS, createChangesKept, worthKeeping } from "../src/services/changes-kept.js";
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
/** A folder of its own under the temp folder. @param {string} name */
const temp = (name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-changes-kept-${name}-`));
  made.push(d);
  return d;
};
const FAKE = "0123456789abcdef0123456789abcdef01234567";

/** A repository with two rounds' snapshots: a.txt changed, then b.txt added. */
async function world() {
  const a = temp("repo");
  git(a, ["init", "-q", "-b", "main"]);
  writeFileSync(join(a, "a.txt"), "one\n");
  git(a, ["add", "."]);
  git(a, ["commit", "-q", "-m", "init"]);
  const head = git(a, ["rev-parse", "HEAD"]);
  const place = git(a, ["rev-parse", "--show-toplevel"]);
  writeFileSync(join(a, "a.txt"), "one\ntwo\n");
  const s1 = String((await snapshotTree(a, { name: "ck/1-1" })).commit);
  writeFileSync(join(a, "b.txt"), "b\n");
  const s2 = String((await snapshotTree(a, { name: "ck/1-2", previous: s1 })).commit);
  /** @type {any[]} */
  const rounds = [
    { place, round: 1, agent: "", before: head, after: s1, base: "round", own: ["a.txt"], command: false },
    { place, round: 2, agent: "", before: s1, after: s2, base: "round", own: ["b.txt"], command: false },
  ];
  /** git cannot be asked in the repository while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    renameSync(join(a, ".git"), join(a, ".git-away"));
    try {
      await fn();
    } finally {
      renameSync(join(a, ".git-away"), join(a, ".git"));
    }
  };
  return { a, head, place, s1, s2, rounds, gitAway };
}

/** A route's handler asked `path?query`: its status and answer. @param {any} route @param {string} path @param {string} query */
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

/**
 * The memory changes route over turn 1 of `rounds`, as a new process would build it: its stores in memory empty.
 * @param {any[]} rounds @param {any} turns  the disk's store of turns @param {string} [version]
 */
function memoryRoute(rounds, turns, version = "1.0.0") {
  const memory = { roundsOf: () => ({ chainId: "c1", turns: 1, cwd: null, rounds: rounds.map((x) => ({ ...x, turn: 1 })), tree: null }), placesAlone: () => new Set() };
  const route = createRouter(memoryRoutes(/** @type {any} */ ({ memory, usage: {}, sseClients: new Set(), VERSION: version, changesKept: { turns } })));
  return (/** @type {string} */ query) => asked(route, "/memory/sessions/c1/changes", query);
}

/** Every answer a store keeps: its files' names. @param {string} dir */
const keptIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : []);
/** What the stores wrote in the background has landed. @param {...any} stores */
const settle = (...stores) => Promise.all(stores.map((x) => x.settled()));

test("the store: an answer is read back only where its owner, key, basis and question are the ones asked", async () => {
  const dir = join(temp("store"), "turns");
  /** @type {string[]} */
  const said = [];
  const s = createChangesKept({ dir, log: (_l, m) => void said.push(m) });
  assert.equal(await s.get("c1", "k", "b", "q"), null, "nothing kept");
  await s.put("c1", "k", "b", "q", { files: [1, 2] });
  assert.deepEqual(await s.get("c1", "k", "b", "q"), { files: [1, 2] });
  assert.equal(await s.get("c1", "k", "b2", "q"), null, "its basis moved");
  assert.equal(await s.get("c1", "k", "b", "q2"), null, "another question");
  assert.equal(await s.get("c2", "k", "b", "q"), null, "another chat's");
  assert.equal(await s.get("c1", "k2", "b", "q"), null, "another key");
  await s.put("c1", "k", "b2", "q", { files: [3] });
  assert.deepEqual([await s.get("c1", "k", "b2", "q"), keptIn(dir).length], [{ files: [3] }, 1], "kept in place of the one before");
  const [name] = keptIn(dir);
  const kept = JSON.parse(readFileSync(join(dir, name), "utf8"));
  writeFileSync(join(dir, name), JSON.stringify({ ...kept, format: 99 }));
  assert.equal(await s.get("c1", "k", "b2", "q"), null, "a file of another shape");
  writeFileSync(join(dir, name), "{ half");
  assert.equal(said.length, 0, "a file of another shape is a miss, said nowhere");
  assert.equal(await s.get("c1", "k", "b2", "q"), null, "a file broken");
  assert.equal(said.length, 1, "a file that is no JSON is a miss, logged");
  assert.match(said[0], /could not be read/);
  const off = createChangesKept({ dir: null });
  await off.put("c1", "k", "b", "q", { files: [] });
  assert.deepEqual([off.on, await off.get("c1", "k", "b", "q")], [false, null], "no folder, none kept");
});

test("the store: held to its count, the one read longest ago going first; by age where said; a half-written file left behind goes; a chat's purged, and what was written for it after", async () => {
  const dir = join(temp("bound"), "runs");
  let days = 0;
  const s = createChangesKept({ dir, most: 2, maxAgeDays: () => days });
  const ago = (/** @type {number} */ ms) => new Date(Date.now() - ms);
  const fileFor = async (/** @type {string} */ owner, /** @type {string} */ key) => {
    const before = new Set(keptIn(dir));
    await s.put(owner, key, "b", "q", { key });
    return keptIn(dir).find((n) => !before.has(n)) || "";
  };
  const one = await fileFor("r1", "one");
  utimesSync(join(dir, one), ago(3000), ago(3000));
  const two = await fileFor("r2", "two");
  utimesSync(join(dir, two), ago(2000), ago(2000));
  assert.deepEqual(await s.get("r1", "one", "b", "q"), { key: "one" }, "read: the newest now");
  await settle(s);
  await s.put("r3", "three", "b", "q", { key: "three" });
  assert.deepEqual([await s.get("r1", "one", "b", "q"), await s.get("r2", "two", "b", "q"), await s.get("r3", "three", "b", "q")], [{ key: "one" }, null, { key: "three" }], "the one read longest ago went");
  // By age: none while no age is said; past it once one is.
  const three = keptIn(dir).find((n) => n !== one) || "";
  utimesSync(join(dir, three), ago(3 * 86400_000), ago(3 * 86400_000));
  await s.sweep();
  assert.equal(keptIn(dir).length, 2, "no age said: kept");
  days = 2;
  await s.sweep();
  assert.deepEqual(keptIn(dir), [one], "past two days: gone");
  // What a stopped process left half written: gone after an hour, not before.
  writeFileSync(join(dir, "x.json.1.1.tmp"), "{");
  writeFileSync(join(dir, "y.json.1.2.tmp"), "{");
  utimesSync(join(dir, "x.json.1.1.tmp"), ago(2 * 3600_000), ago(2 * 3600_000));
  await s.sweep();
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".tmp")), ["y.json.1.2.tmp"]);
  // A chat's purged: its own alone.
  const p = createChangesKept({ dir: join(temp("purge"), "turns") });
  await p.put("c1", "k1", "b", "q", 1);
  await p.put("c1", "k2", "b", "q", 2);
  await p.put("c2", "k1", "b", "q", 3);
  await p.purge("c1");
  assert.deepEqual([await p.get("c1", "k1", "b", "q"), await p.get("c1", "k2", "b", "q"), await p.get("c2", "k1", "b", "q")], [null, null, 3]);
  // A walk that ends after its chat was deleted writes nothing that stays: purged first, or purged while it wrote.
  await p.put("c1", "k3", "b", "q", 4);
  const writing = p.put("c5", "k1", "b", "q", 5);
  await p.purge("c5");
  await writing;
  assert.deepEqual([await p.get("c1", "k3", "b", "q"), await p.get("c5", "k1", "b", "q"), await p.get("c2", "k1", "b", "q")], [null, null, 3]);
  assert.equal(CHANGES_KEPT_MOST, 256);
});

test("worthKeeping: a walk of a second or more that git told whole", () => {
  assert.equal(KEPT_SLOW_MS, 1000);
  assert.equal(worthKeeping(null), false, "no walk's answer");
  assert.equal(worthKeeping({ ms: 999, partly: false }), false, "fast");
  assert.equal(worthKeeping({ ms: 1000, partly: false }), true);
  assert.equal(worthKeeping({ ms: 60000, partly: true }), false, "told less than git knows");
  assert.equal(worthKeeping({ ms: 0, partly: false }, 0), true, "a store's own threshold");
});

// (fails before: yes — a walk said nothing of itself: neither its time nor what it was not told)
test("walkOf: a walk's time, and whether it was told less than git knows — a gap git could not name, a diff's counts it would not give", async () => {
  const w = await world();
  const whole = await ownChangesOf(w.rounds);
  assert.equal(walkOf(whole)?.partly, false);
  assert.ok(typeof walkOf(whole)?.ms === "number");
  assert.equal(walkOf({ files: [] }), null, "an object no walk answered");
  // A step taken just before its round, from a commit git does not hold: the gap before it cannot be named, and a file
  // of the agent's changed there would go unmarked.
  const gap = await ownChangesOf([w.rounds[0], { ...w.rounds[1], before: FAKE, own: [] }]);
  assert.deepEqual([gap.errors, walkOf(gap)?.partly], [[], true]);
  // A blob git no longer holds: its names are read, its counts are not, and the file is listed with none.
  const blob = git(w.a, ["rev-parse", `${w.s2}:b.txt`]);
  rmSync(join(w.a, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
  const zeros = await ownChangesOf(w.rounds);
  assert.deepEqual([zeros.errors, zeros.files.find((f) => f.path === "b.txt")?.added, walkOf(zeros)?.partly], [[], 0, true], "listed with no counts, and said so here alone");
  // The same, read as what a command changed while it ran.
  const ran = await ownChangesOf([w.rounds[0], { ...w.rounds[1], own: [], command: true }]);
  assert.deepEqual([ran.errors, ran.during.map((f) => [f.path, f.added]), walkOf(ran)?.partly], [[], [["b.txt", 0]], true]);
});

// (fails before: yes — the tree card's first rows went with the process: a restart walked the turn again)
test("the memory route: a restart serves the tree card's first rows from disk, git out of reach; a new release, another collation or a purge reads again", async () => {
  const w = await world();
  const dir = join(temp("mem"), "turns");
  const turns = createChangesKept({ dir, slowMs: 0 });
  const cut = await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=en");
  assert.deepEqual([cut.files.length, cut.counts.files], [1, 2]);
  await settle(turns);
  assert.equal(keptIn(dir).length, 1, "written: its walk counts as slow here");
  const file = join(dir, keptIn(dir)[0]);
  const kept = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(kept.basis.endsWith(`\n1.0.0 ${WALK_VERSION} ${process.versions.icu}`), "the release, the walk's version and the collation's in what it rests on");
  await w.gitAway(async () => {
    const again = await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=en");
    assert.deepEqual(again, cut, "the same answer, git out of reach");
    assert.deepEqual(await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=EN"), cut, "a locale that resolves alike, the same");
    const released = await memoryRoute(w.rounds, turns, "1.0.1")("turn=1&first=1&locale=en");
    assert.ok(released.errors.length, "a new release reads again");
    const other = await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=de");
    assert.ok(other.errors.length, "another collation reads again");
    const moved = await memoryRoute([w.rounds[0]], turns)("turn=1&first=1&locale=en");
    assert.ok(moved.errors.length, "its rounds moved: read again");
    writeFileSync(file, JSON.stringify({ ...kept, answer: { files: [] } }));
    assert.ok((await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=en")).errors.length, "a file without the answer's lists: read again");
    // Whole again: the chat's purge, by the id the server purges a deleted chat by, takes it.
    writeFileSync(file, JSON.stringify(kept));
    assert.deepEqual(await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=en"), cut, "whole again, read back");
  });
  await turns.purge("c1");
  assert.deepEqual(keptIn(dir), [], "the chat's purged");
  await w.gitAway(async () => {
    assert.ok((await memoryRoute(w.rounds, turns)("turn=1&first=1&locale=en")).errors.length, "and read again");
  });
});

test("the memory route: none written where the walk was fast, told less than git knows, or failed", async () => {
  const w = await world();
  const fast = join(temp("fast"), "turns");
  const fastKept = createChangesKept({ dir: fast });
  await memoryRoute(w.rounds, fastKept)("turn=1&first=1&locale=en");
  const partly = join(temp("partly"), "turns");
  const partlyKept = createChangesKept({ dir: partly, slowMs: 0 });
  await memoryRoute([w.rounds[0], { ...w.rounds[1], before: FAKE, own: [] }], partlyKept)("turn=1&first=1&locale=en");
  const failed = join(temp("failed"), "turns");
  const failedKept = createChangesKept({ dir: failed, slowMs: 0 });
  await w.gitAway(async () => {
    assert.ok((await memoryRoute(w.rounds, failedKept)("turn=1&first=1&locale=en")).errors.length);
  });
  await settle(fastKept, partlyKept, failedKept);
  assert.deepEqual([keptIn(fast), keptIn(partly), keptIn(failed)], [[], [], []]);
  // The whole and the command center's cut are not read from disk, nor written there.
  const kept = join(temp("whole"), "turns");
  const turns = createChangesKept({ dir: kept, slowMs: 0 });
  await memoryRoute(w.rounds, turns)("turn=1");
  await memoryRoute(w.rounds, turns)("turn=1&match=a&take=6");
  await settle(turns);
  assert.deepEqual(keptIn(kept), []);
});

/** The runs changes route over a run whose snapshots are `rounds`, as a new process would build it. @param {any[]} rounds @param {string} root @param {any} store @param {string} [version] */
function runsRoute(rounds, root, store, version = "1.0.0") {
  const data = temp("runlog");
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: data, config: () => ({}) });
  runs.startRun({ id: "run-ck", kind: "agent-turn", meta: { root, chain: "c1" } });
  for (const x of rounds) bus.publish("run:run-ck", { type: "snapshot", ...x });
  const route = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set(), memory: { placesAlone: () => new Set() }, VERSION: version, changesKept: { runs: store } })));
  after(() => runs.close());
  return (/** @type {string} */ query) => asked(route, "/runs/run-ck/changes", query);
}

// (fails before: yes — the files card's first rows went with the process)
test("the runs route: a restart serves the files card's first rows from disk, its folder read anew; the whole is never the cut", async () => {
  const w = await world();
  const dir = join(temp("runs"), "runs");
  const store = createChangesKept({ dir, slowMs: 0 });
  const cut = await runsRoute(w.rounds, w.a, store)("first=1");
  assert.deepEqual([cut.whole.files.length, cut.whole.counts.files], [1, 2]);
  await settle(store);
  const [name] = keptIn(dir);
  assert.ok(name, "written");
  // The folder as the disk holds it is not what is answered: it is read anew.
  const kept = JSON.parse(readFileSync(join(dir, name), "utf8"));
  assert.ok(kept.basis.endsWith(`\n1.0.0\n${WALK_VERSION}`), "the release and the walk's version in what it rests on");
  writeFileSync(join(dir, name), JSON.stringify({ ...kept, answer: { ...kept.answer, folder: "elsewhere" } }));
  await w.gitAway(async () => {
    const ask = runsRoute(w.rounds, w.a, store);
    const again = await ask("first=1");
    assert.deepEqual({ ...again, folder: cut.folder }, cut, "the same rows, git out of reach");
    assert.notEqual(again.folder, "elsewhere", "the folder read anew");
    assert.ok((await ask("")).whole.errors.length, "the whole is walked, never answered by the cut");
    assert.ok((await runsRoute(w.rounds, w.a, store, "1.0.1")("first=1")).whole.errors.length, "a new release reads again");
    assert.ok((await runsRoute([w.rounds[0]], w.a, store)("first=1")).whole.errors.length, "its rounds moved: read again");
    writeFileSync(join(dir, name), JSON.stringify({ ...kept, answer: { ...kept.answer, whole: { files: [] } } }));
    assert.ok((await runsRoute(w.rounds, w.a, store)("first=1")).whole.errors.length, "a file without the answer's lists: read again");
  });
  // An edit card's, a path's, a patch's and the rounds' asks are not written.
  const other = join(temp("runs-other"), "runs");
  const otherKept = createChangesKept({ dir: other, slowMs: 0 });
  const ask = runsRoute(w.rounds, w.a, otherKept);
  await ask("first=1&round=1");
  await ask("first=1&path=a.txt");
  await ask("first=1&patch=1");
  await ask("first=1&rounds=1");
  await ask("first=1001");
  // Nor where the walk was fast, told less than git knows, or failed.
  const fast = join(temp("runs-fast"), "runs");
  const fastKept = createChangesKept({ dir: fast });
  await runsRoute(w.rounds, w.a, fastKept)("first=1");
  const partly = join(temp("runs-partly"), "runs");
  const partlyKept = createChangesKept({ dir: partly, slowMs: 0 });
  await runsRoute([w.rounds[0], { ...w.rounds[1], before: FAKE, own: [] }], w.a, partlyKept)("first=1");
  const failed = join(temp("runs-failed"), "runs");
  const failedKept = createChangesKept({ dir: failed, slowMs: 0 });
  await w.gitAway(async () => {
    assert.ok((await runsRoute(w.rounds, w.a, failedKept)("first=1")).whole.errors.length);
  });
  await settle(otherKept, fastKept, partlyKept, failedKept);
  assert.deepEqual([keptIn(other), keptIn(fast), keptIn(partly), keptIn(failed)], [[], [], [], []]);
});

test("the wiring: the server keeps both stores in the data folder, a deleted chat's turns purged, the runs' by their log's retention", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(src, /turns: createChangesKept\(\{ dir: dataDir \? join\(dataDir, "changes-kept", "turns"\) : null, log \}\)/);
  assert.match(src, /runs: createChangesKept\(\{ dir: dataDir \? join\(dataDir, "changes-kept", "runs"\) : null, log, maxAgeDays: \(\) => runRetentionDays\(config\.get\(\)\) \}\)/);
  assert.match(src, /memory\.onSessionsDeleted = \(\/\*\* @type \{string\[\]\} \*\/ ids\) => \{\n    for \(const id of ids\) \{\n      void changesKept\.turns\.purge\(id\);/);
  assert.match(src, /\n    changesKept,\n/);
  assert.match(readFileSync(new URL("../docs/GUIDE.md", import.meta.url), "utf8"), /\| `changes-kept\/` \|/);
});
