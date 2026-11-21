// @ts-check
// A turn's changes served from one diff of each place (the owner's of 11-18, on why a turn's changes ran thousands of
// git processes: "yeah please work it out and let me know", then "go ahead and build it"): a read of an agent's own
// files over its span is taken from the place's whole diff where no link of the chain outside the span changed them,
// or from one diff of its span where it has many pieces, each guarded where a diff narrowed to its paths could say
// otherwise. Every test reads its rounds both ways — the gate shut (`whole` past any place) and open (`whole` at one) —
// and holds the two answers the same, byte for byte; `walkOf` says whether the open read served what it should. Every
// repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { WHOLE_AT, namesChangedAll, ownChangesOf, pairKey, walkOf } from "../src/adapters/git/changes.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true, maxBuffer: 1 << 26 });
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

const SHUT = { pieces: Infinity, served: Infinity };
const OPEN = { pieces: 1, served: 1 };

/** A throwaway repository. @param {string} name */
function repo(name) {
  const dir = mkdtempSync(join(tmpdir(), `filament-walk-whole-${name}-`));
  made.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

/** The folder as `files` leaves it (null: gone), then a commit of it: a snapshot. @param {string} dir @param {Record<string, string | null>} files */
function snap(dir, files) {
  for (const [p, c] of Object.entries(files)) {
    if (c === null) rmSync(join(dir, p), { recursive: true, force: true });
    else {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "s"]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/**
 * A round's row. @param {string} place
 * @param {{ round: number, before: string | null, after: string, agent?: string, base?: import("../src/core/types.js").RoundChange["base"], own?: string[], command?: boolean }} o
 * @returns {import("../src/core/types.js").RoundChange}
 */
const row = (place, { round, before, after, agent = "", base = "round", own = [], command = false }) => ({ place, round, agent, before, after, base, own, command, turn: 1 });

/** The rounds read with the gate shut and open: the same answer, byte for byte; the open read's walk. @param {any[]} rows @param {any} [opts] */
async function both(rows, opts = {}) {
  const today = await ownChangesOf(rows, { ...opts, whole: SHUT });
  const open = await ownChangesOf(rows, { ...opts, whole: OPEN });
  assert.deepEqual(open, today);
  assert.equal(JSON.stringify(open), JSON.stringify(today), "the same, in the same order");
  return { today, walk: walkOf(open), shut: walkOf(today) };
}

/** Lines of text. @param {number} n @param {string} [s] */
const lines = (n, s = "l") => Array.from({ length: n }, (_, i) => `${s}${i}`).join("\n") + "\n";

// (fails before: yes — WHOLE_AT, the option and walkOf's served were not there; every read was its own diff)
test("a place's reads are served from its whole where no link outside a span changed their files: the same answer, and fewer diffs", async () => {
  const dir = repo("served");
  const c0 = snap(dir, { "a.txt": lines(3), "b.txt": lines(2), "c.txt": "c\n", "d.txt": lines(4), "keep.txt": "k\n" });
  const c1 = snap(dir, { "a.txt": lines(5) });
  const c2 = snap(dir, { "b.txt": "b\n" });
  const c3 = snap(dir, { "c.txt": null, "e.txt": lines(9, "e") });
  const c4 = snap(dir, { "d.txt": lines(4, "d") });
  const rows = [
    row(dir, { round: 1, before: c0, after: c1, own: ["a.txt"] }),
    row(dir, { round: 2, before: c1, after: c2, own: ["b.txt"] }),
    row(dir, { round: 3, before: c2, after: c3, command: true }),
    row(dir, { round: 4, before: c3, after: c4, agent: "h1", own: ["d.txt"] }),
  ];
  for (const alone of [new Set([dir]), null]) {
    const { today, walk, shut } = await both(rows, { alone });
    assert.ok((walk?.served ?? 0) >= 3, `a.txt, b.txt and d.txt from the whole (alone ${!!alone}): ${walk?.served}`);
    assert.equal(shut?.served, 0, "the gate shut serves none");
    assert.deepEqual(today.files.filter((f) => ["a.txt", "b.txt", "d.txt"].includes(f.path)).map((f) => [f.path, f.agent, f.added, f.removed]), [["a.txt", "", 2, 0], ["b.txt", "", 1, 2], ["d.txt", "h1", 4, 4]]);
  }
  // A command's step that changed none but its agent's own files is answered from its names; one that changed others
  // too is diffed, its others apart.
  const c5 = snap(dir, { "a.txt": lines(6) });
  const c6 = snap(dir, { "keep.txt": "k2\n" });
  const c7 = snap(dir, { "a.txt": lines(7), "keep.txt": "k3\n" });
  const ran = [
    row(dir, { round: 1, before: c0, after: c1, own: ["a.txt"] }),
    row(dir, { round: 5, before: c4, after: c5, command: true }),
    row(dir, { round: 6, before: c5, after: c6, command: true }),
    row(dir, { round: 7, before: c6, after: c7, command: true }),
  ];
  const { today, walk } = await both(ran, { alone: null });
  assert.equal(walk?.skipped, 1, "round 5 changed a.txt alone, its agent's own");
  assert.deepEqual(today.during.map((f) => [f.path, f.round]), [["keep.txt", 6], ["keep.txt", 7]]);
});

// (fails before: yes — no read was served; this holds the chain's check and its guards)
test("a read is its own diff where a link outside its span changed its files: another agent's round, a gap, a step from the last commit", async () => {
  const dir = repo("outside");
  const c0 = snap(dir, { "a.txt": lines(3), "b.txt": lines(3), "c.txt": lines(3) });
  const c1 = snap(dir, { "a.txt": lines(4) });
  const c2 = snap(dir, { "b.txt": lines(5) });
  const c3 = snap(dir, { "a.txt": lines(2) });
  // Someone else between two steps (a gap), then a step from the last commit, which another hand moved.
  const g = snap(dir, { "b.txt": lines(1) });
  const c4 = snap(dir, { "c.txt": lines(7) });
  const h = snap(dir, { "c.txt": lines(2, "h") });
  const c5 = snap(dir, { "c.txt": lines(2, "z") });
  const rows = [
    row(dir, { round: 1, before: c0, after: c1, own: ["a.txt"] }),
    row(dir, { round: 2, before: c1, after: c2, own: ["b.txt"] }),
    row(dir, { round: 3, before: c2, after: c3, agent: "h1", own: ["a.txt"] }),
    row(dir, { round: 4, before: g, after: c4, own: ["c.txt"] }),
    row(dir, { round: 5, before: h, after: c5, base: "head", agent: "h2", own: ["c.txt"] }),
  ];
  for (const alone of [new Set([dir]), null]) {
    const { today, walk } = await both(rows, { alone });
    assert.equal(walk?.served, 0, "each read's file changed outside its span");
    assert.deepEqual(today.files.map((f) => [f.path, f.agent, !!f.also]), [["a.txt", "", false], ["b.txt", "", false], ["c.txt", "", false], ["a.txt", "h1", false], ["c.txt", "h2", false]]);
  }
});

// (fails before: yes — no read was served; a gap is a link of its own, outside the spans on either side of it)
test("a file changed in the gap just before a read's first step, or just after its last, is its read's own diff; a step from the last commit has its gap too", async () => {
  const dir = repo("gaps");
  const c0 = snap(dir, { "a.txt": lines(3), "b.txt": lines(3), "x.txt": "x\n", "y.txt": "y\n" });
  const c1 = snap(dir, { "x.txt": "x2\n" });
  const g1 = snap(dir, { "a.txt": lines(5) });
  const c2 = snap(dir, { "a.txt": lines(6), "b.txt": lines(4) });
  const g2 = snap(dir, { "b.txt": lines(8) });
  const c3 = snap(dir, { "y.txt": "y2\n" });
  const rows = [
    row(dir, { round: 1, before: c0, after: c1, own: ["x.txt"] }),
    row(dir, { round: 2, before: g1, after: c2, agent: "h1", own: ["a.txt"] }),
    row(dir, { round: 2, before: g1, after: c2, agent: "h3", own: ["b.txt"] }),
    row(dir, { round: 3, before: g2, after: c3, agent: "h2", own: ["y.txt"] }),
  ];
  const { today, walk } = await both(rows);
  assert.deepEqual(today.files.filter((f) => f.path === "a.txt" || f.path === "b.txt").map((f) => [f.path, f.added, f.removed]), [["a.txt", 1, 0], ["b.txt", 1, 0]], "each counted over its own step");
  assert.equal(walk?.served, 2, "x.txt and y.txt; a.txt changed in the gap before, b.txt in the gap after");
  // A step from the last commit, which another hand moved: what it changed is outside the span before it.
  const d = repo("head-gap");
  const e0 = snap(d, { "a.txt": lines(3), "z.txt": "z\n" });
  const e1 = snap(d, { "a.txt": lines(4) });
  const h = snap(d, { "a.txt": lines(9) });
  const e2 = snap(d, { "z.txt": "z2\n" });
  const head = [row(d, { round: 1, before: e0, after: e1, own: ["a.txt"] }), row(d, { round: 2, before: h, after: e2, base: "head", agent: "h2", own: ["z.txt"] })];
  const t = await both(head);
  assert.deepEqual(t.today.files.map((f) => [f.path, f.added, f.removed]), [["a.txt", 1, 0], ["z.txt", 1, 1]]);
  assert.equal(t.walk?.served, 1, "z.txt alone");
});

// (fails before: yes — no whole was read; a rename's sides in one piece would be paired by its narrowed diff alone)
test("a rename's two sides in one piece are their own diff, which pairs them; apart, each is served as the whole lists it", async () => {
  const dir = repo("rename");
  const body = lines(40, "same");
  const c0 = snap(dir, { "old.txt": body, "x.txt": "x\n" });
  git(dir, ["mv", "old.txt", "new.txt"]);
  const c1 = snap(dir, {});
  const c2 = snap(dir, { "x.txt": "x2\n" });
  const together = [row(dir, { round: 1, before: c0, after: c1, own: ["old.txt", "new.txt"] }), row(dir, { round: 2, before: c1, after: c2, own: ["x.txt"] })];
  const t = await both(together);
  assert.deepEqual(t.today.files.map((f) => [f.path, f.oldPath, f.status]), [["new.txt", "old.txt", "renamed"], ["x.txt", null, "modified"]]);
  assert.equal(t.walk?.served, 1, "x.txt alone: the rename's piece read whole");
  const apart = [row(dir, { round: 1, before: c0, after: c1, own: ["old.txt"] }), row(dir, { round: 1, before: c0, after: c1, agent: "h1", own: ["new.txt"] })];
  const a = await both(apart);
  assert.deepEqual(a.today.files.map((f) => [f.path, f.agent, f.status]), [["old.txt", "", "deleted"], ["new.txt", "h1", "added"]]);
  assert.equal(a.walk?.served, 2, "a lone side, as its narrowed diff lists it");
});

// (fails before: yes — no guard was there to keep a path git reads as more than itself from the whole)
test("a path git reads as more than itself is its own diff: a file that became a folder, a pattern, a name with a twin in another case, a name git may spell otherwise", async () => {
  const dir = repo("pathspec");
  const nfd = "café.txt";
  const c0 = snap(dir, { x: "a file\n", "br[a]ck.js": "1\n", "brack.js": "b\n", "Case.txt": "c\n", "plain.txt": "p\n", "pic.bin": "a\0b\n", " lead.txt": "s\n", [nfd]: "n\n", "dot/a.txt": "d\n" });
  const c1 = snap(dir, { x: null, "x/y.txt": "now a folder\n", "br[a]ck.js": "2\n", "brack.js": "b2\n", "plain.txt": "p2\n", "pic.bin": "a\0c\n", " lead.txt": "s2\n", [nfd]: "n2\n", "dot/a.txt": "d2\n" });
  const c2 = snap(dir, { "Case.txt": "c2\n" });
  const rows = [
    row(dir, { round: 1, before: c0, after: c1, own: ["x"] }),
    row(dir, { round: 1, before: c0, after: c1, agent: "h1", own: ["br[a]ck.js"] }),
    row(dir, { round: 1, before: c0, after: c1, agent: "h2", own: ["plain.txt", "pic.bin"] }),
    row(dir, { round: 1, before: c0, after: c1, agent: "h3", own: [" lead.txt"] }),
    row(dir, { round: 1, before: c0, after: c1, agent: "h4", own: [nfd] }),
    row(dir, { round: 1, before: c0, after: c1, agent: "h5", own: ["./dot/a.txt"] }),
    row(dir, { round: 2, before: c1, after: c2, own: ["case.txt"] }),
  ];
  const { today, walk } = await both(rows);
  assert.deepEqual(
    today.files.map((f) => [f.path, f.agent]).sort(),
    [["br[a]ck.js", "h1"], ["brack.js", "h1"], ["plain.txt", "h2"], ["pic.bin", "h2"], [" lead.txt", "h3"], [nfd, "h4"], ["dot/a.txt", "h5"], ["x", ""], ["x/y.txt", ""]].sort(),
    "a pattern's diff lists what it matches; a folder's, its files; a path through `.`, the file",
  );
  assert.deepEqual(today.files.filter((f) => f.path === "pic.bin").map((f) => [f.binary, f.added, f.removed]), [[true, 0, 0]], "a binary served as git counts it");
  assert.equal(walk?.served, 2, "plain.txt with pic.bin, and case.txt (no file of that spelling changed): every other piece its own diff");
});

// (fails before: yes — the gate was not there)
test("a place is read as it is where the whole cannot serve it: a step from nothing, a link the batch cannot name, a partial clone, a whole that would list far more than its reads, git reading paths in any case", async () => {
  const dir = repo("refused");
  const c0 = snap(dir, { "a.txt": "a\n", "b.txt": "b\n" });
  const c1 = snap(dir, { "a.txt": "a2\n" });
  const c2 = snap(dir, { "b.txt": "b2\n" });
  const rows = [row(dir, { round: 1, before: c0, after: c1, own: ["a.txt"] }), row(dir, { round: 2, before: c1, after: c2, own: ["b.txt"] })];
  assert.equal((await both(rows)).walk?.served, 2, "served, as the cases below are not");
  // A step from nothing.
  const fresh = [row(dir, { round: 1, before: null, after: c1, base: "none", own: ["a.txt"] }), row(dir, { round: 2, before: c1, after: c2, own: ["b.txt"] })];
  assert.equal((await both(fresh)).walk?.served, 0, "a step from nothing");
  // A link the batch cannot name: a tree's id, which git diff reads and the batch does not.
  const tree = git(dir, ["rev-parse", `${c1}^{tree}`]).trim();
  const unnamed = [row(dir, { round: 1, before: c0, after: tree, own: ["a.txt"] }), row(dir, { round: 2, before: c1, after: c2, own: ["b.txt"] })];
  assert.equal((await both(unnamed)).walk?.served, 0, "a link the batch did not name");
  // A partial clone.
  git(dir, ["config", "remote.origin.promisor", "true"]);
  assert.equal((await both(rows)).walk?.served, 0, "a promisor remote");
  git(dir, ["config", "--unset", "remote.origin.promisor"]);
  // git reading paths in any case.
  process.env.GIT_ICASE_PATHSPECS = "1";
  try {
    assert.equal((await both(rows)).walk?.served, 0, "GIT_ICASE_PATHSPECS");
  } finally {
    delete process.env.GIT_ICASE_PATHSPECS;
  }
  // A whole that would list far more than the reads' own paths: a command's build of many files beside one own file.
  const many = Object.fromEntries(Array.from({ length: 2100 }, (_, i) => [`out/f${i}.txt`, `${i}\n`]));
  const c3 = snap(dir, many);
  const c4 = snap(dir, { "a.txt": "a3\n" });
  const build = [row(dir, { round: 3, before: c2, after: c3, command: true }), row(dir, { round: 4, before: c3, after: c4, own: ["a.txt"] })];
  const b = await both(build, { alone: null });
  assert.equal(b.walk?.served, 0, "2,100 files listed against one own");
  assert.equal(b.today.during.length, 2100);
  // And fewer pieces it could serve than asked.
  assert.equal((await ownChangesOf(rows, { whole: { pieces: 1, served: 3 } })).files.length, 2);
  assert.equal(walkOf(await ownChangesOf(rows, { whole: { pieces: 1, served: 3 } }))?.served, 0, "two pieces it could serve, three asked");
  assert.equal(walkOf(await ownChangesOf(rows, { whole: { pieces: 3, served: 1 } }))?.served, 0, "two pieces of reads, three asked");
});

// (fails before: yes — no read was served beside one its own diff told less)
test("a read its own diff told less than git knows says so beside the pieces served: a blob git no longer holds between the whole's ends", async () => {
  const dir = repo("partly");
  const c0 = snap(dir, { "p.txt": "p0\n", "q.txt": "q\n" });
  const c1 = snap(dir, { "p.txt": "p1 only here\n" });
  const c2 = snap(dir, { "p.txt": "p2\n", "q.txt": "q2\n" });
  const rows = [row(dir, { round: 1, before: c0, after: c1, own: ["p.txt"] }), row(dir, { round: 2, before: c1, after: c2, agent: "h1", own: ["p.txt"] }), row(dir, { round: 2, before: c1, after: c2, agent: "h2", own: ["q.txt"] })];
  const blob = git(dir, ["rev-parse", `${c1}:p.txt`]).trim();
  rmSync(join(dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
  const { today, walk, shut } = await both(rows);
  assert.deepEqual(today.files.map((f) => [f.path, f.agent, f.added]), [["p.txt", "", 0], ["p.txt", "h1", 0], ["q.txt", "h2", 1]], "p.txt listed with no counts");
  assert.equal(walk?.served, 1, "q.txt from the whole, which never needs the blob");
  assert.deepEqual([walk?.partly, shut?.partly], [true, true]);
});

// (fails before: yes — a read of many pieces was a diff of each hundred)
test("a read of many pieces keeps today's order, a hundred at a time; its pieces the chain sends back come from one diff of its span", async () => {
  const dir = repo("pieces");
  const names = Array.from({ length: 250 }, (_, i) => `f/${String((i * 37) % 250).padStart(3, "0")}.txt`);
  const c0 = snap(dir, Object.fromEntries(names.map((p) => [p, "0\n"])));
  const c1 = snap(dir, Object.fromEntries(names.map((p, i) => [p, i % 3 ? "1\n" : "1\n2\n"])));
  const c2 = snap(dir, { [names[160]]: "later\nand\nmore\n" });
  const one = [row(dir, { round: 1, before: c0, after: c1, own: names })];
  const o = await both(one);
  assert.deepEqual(o.today.files.map((f) => f.path), [...names.slice(0, 100).sort(), ...names.slice(100, 200).sort(), ...names.slice(200).sort()], "each hundred in git's order, the hundreds as asked");
  assert.equal(o.walk?.served, 3);
  // Another agent changes one of them later: its piece leaves the whole, and comes from the span's own diff.
  const later = [...one, row(dir, { round: 2, before: c1, after: c2, agent: "h1", own: [names[160]] })];
  const l = await both(later);
  assert.equal(l.walk?.served, 3, "three pieces of the read (one from its span's diff); h1's file changed before its span, its own diff");
  // With a patch, each served file's diff read as it is.
  const p = await both(later, { patch: true });
  assert.ok(p.today.files.every((f) => typeof f.patch === "string"));
});

// (fails before: yes — a batch never asked a slice's lone pair, and batchOnly was not there)
test("namesChangedAll's batch alone answers every pair of a count one past a call's, never one by one", async () => {
  const dir = repo("batch");
  /** @type {string[]} */
  const ids = [];
  for (let i = 0; i < 24; i++) ids.push(snap(dir, { [`n${i % 5}.txt`]: `${i}\n` }));
  /** @type {[string, string][]} */
  const pairs = [];
  for (let i = 0; i < ids.length && pairs.length < 257; i++) for (let j = i + 1; j < ids.length && pairs.length < 257; j++) pairs.push([ids[i], ids[j]]);
  assert.equal(pairs.length, 257);
  const only = await namesChangedAll(dir, pairs, { batchOnly: true });
  const each = await namesChangedAll(dir, pairs);
  assert.equal(only.size, 257, "the last pair answered too");
  for (const [b, a] of pairs) assert.deepEqual(only.get(pairKey(b, a)), each.get(pairKey(b, a)));
  // A lone pair is a batch of one.
  const lone = await namesChangedAll(dir, [[ids[0], ids[5]]], { batchOnly: true });
  assert.deepEqual(lone.get(pairKey(ids[0], ids[5])), each.get(pairKey(ids[0], ids[5])));
  // What the batch cannot read is left out, never asked alone.
  const tree = git(dir, ["rev-parse", `${ids[3]}^{tree}`]).trim();
  const left = await namesChangedAll(dir, [[ids[0], ids[1]], [ids[1], tree], [null, ids[2]], [ids[1], ids[2]]], { batchOnly: true });
  assert.deepEqual([...left.keys()].sort(), [pairKey(ids[0], ids[1]), pairKey(ids[1], ids[2])].sort());
});

test("WHOLE_AT: the gate's defaults", () => {
  assert.deepEqual(WHOLE_AT, { pieces: 64, served: 24 });
  assert.ok(Object.isFrozen(WHOLE_AT));
});
