// @ts-check
// A turn's tree card reads the files it lists, in its own order, and the counts of the rest — not every row — and the
// turn's changes answer is kept while what it rests on holds (the owner's of 11-17: one turn of TinyQuest answered
// `GET /memory/sessions/:id/changes?turn=` with 22.9 MB, 77,842 files, after 65 s of git, at every ask, and the page held
// it for good). The route holds the files to the first N as the card orders them, by the page's locale (`?first=`,
// `?locale=`, `treeFirst`), cut from the whole, each kept in a store of its own; `?head=1` answers a fork's head with no
// read of the turn's files. The card draws the same from those rows and counts as from the whole; a host that answers
// whole is drawn as before. Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { memoryRoutes, treeFirst, TURN_WHOLE_KEPT, TURN_FIRST_MOST } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { treeCard, TREE_ROWS } from "../src/ui/harness/conversation/turn.js";
import { removeDirs } from "./helpers/wait.js";
import { stubDocument } from "./helpers/dom-stub.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

/** The tree card's order, as the page sorts: by place, then path, in its own locale. @param {any[]} files */
const pageOrder = (files) => [...files].sort((a, b) => String(a.place || "").localeCompare(String(b.place || "")) || String(a.path).localeCompare(String(b.path)));
const LOCALE = new Intl.Collator().resolvedOptions().locale;

/**
 * The memory changes route over a throwaway repository whose turn 1 changed nine files in one round, named so that git's
 * order is not the card's; `rounds`, `alone` and `chain` are the stand-in memory's, for a test to move.
 */
async function route() {
  const dir = mkdtempSync(join(tmpdir(), "filament-tree-first-"));
  made.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "keep.txt"), "k\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  const place = git(dir, ["rev-parse", "--show-toplevel"]);
  mkdirSync(join(dir, "Zeta"));
  mkdirSync(join(dir, "alpha"));
  const names = ["b.txt", "B2.txt", "a.txt", "Zeta/q.txt", "alpha/r.txt", "é.txt", "e.txt", "10.txt", "9.txt"];
  for (const n of names) writeFileSync(join(dir, n), `${n}\n`);
  const s1 = await snapshotTree(dir, { name: "tf/1-1" });
  /** @type {any[]} */
  const rounds = [{ place, round: 1, agent: "", before: head, after: String(s1.commit), base: "round", own: [...names], command: false, turn: 1 }];
  /** @type {{ rounds: any[], alone: Set<string>, more: Record<number, any[]> }} the later turns' rounds in `more` */
  const state = { rounds, alone: new Set(), more: {} };
  const memory = {
    roundsOf: (/** @type {string} */ id, /** @type {any} */ o = {}) => {
      if (id !== "c1") throw new Error("no such session");
      return { chainId: "c1", turns: 2, cwd: dir, rounds: o.turn == null || o.turn === 1 ? state.rounds : state.more[o.turn] || [], tree: o.turn ? { snapshotRef: "refs/filament/snapshots/tf-1", turn: 1 } : null };
    },
    placesAlone: () => state.alone,
  };
  const call = createRouter(memoryRoutes(/** @type {any} */ ({ memory, usage: {}, sseClients: new Set() })));
  /** @param {string} query */
  const ask = async (query) => {
    const path = "/memory/sessions/c1/changes";
    const m = call("GET", path);
    assert.ok(m);
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://127.0.0.1${path}?${query}`), path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(status, 200, body);
    return { body, json: JSON.parse(body) };
  };
  /** git cannot be asked in the repository while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    renameSync(join(dir, ".git"), join(dir, ".git-away"));
    try {
      await fn();
    } finally {
      renameSync(join(dir, ".git-away"), join(dir, ".git"));
    }
  };
  return { ask, gitAway, state, dir, place, s1: String(s1.commit) };
}

// (fails before: yes — `first` was not read, every file went at every ask, and each ask walked the turn with git again)
test("the route: first=N holds the files to the card's first N, in its order, with the counts — the whole as the oracle; kept, so git is not asked again; the head read at each ask", async () => {
  const t = await route();
  const whole = await t.ask("turn=1");
  assert.equal(whole.json.files.length, 9, JSON.stringify(whole.json));
  assert.equal(whole.json.folder, t.place);
  const first = (await t.ask(`turn=1&first=4&locale=${encodeURIComponent(LOCALE)}`)).json;
  const w = whole.json;
  assert.deepEqual(first, { ...w, files: pageOrder(w.files).slice(0, 4), during: [], outside: [], counts: { files: 9, during: 0, outside: 0, ran: false } }, "the card's first four, in its order, and the counts");
  await t.gitAway(async () => {
    const kept = (await t.ask(`turn=1&first=4&locale=${encodeURIComponent(LOCALE)}`)).json;
    assert.deepEqual(kept, { ...first, folder: null }, "the kept rows, git out of reach; the folder, read at each ask, is none");
    const again = (await t.ask("turn=1")).json;
    assert.deepEqual(again, { ...w, folder: null }, "the whole kept as it was: no cut wrote on it");
    const other = (await t.ask(`turn=1&first=2&locale=${encodeURIComponent(LOCALE)}`)).json;
    assert.deepEqual(other.files, pageOrder(w.files).slice(0, 2), "another count cut from the whole kept");
    for (const q of ["first=0", "first=-2", "first=abc", "first=2.5", "first="]) {
      const asked = (await t.ask(`turn=1&${q}`)).json;
      assert.deepEqual(asked, { ...w, folder: null }, `${q}: as no first`);
    }
  });
});

// (fails before: yes — nothing was kept)
test("the route: a kept answer goes when its rounds move, or the places only its chat works in; one that says git could not read a place is read again; a patch's, and the chat's, at every ask", async () => {
  const t = await route();
  await t.gitAway(async () => {
    const failed = (await t.ask("turn=1&first=3")).json;
    assert.ok(failed.errors.length, `git could not be asked: ${JSON.stringify(failed)}`);
  });
  const read = (await t.ask("turn=1&first=3")).json;
  assert.deepEqual([read.files.length, read.counts.files, read.errors], [3, 9, []], "read again once git answers");
  // A round more: the rounds moved, so the answer is read again — git away, it says so.
  writeFileSync(join(t.dir, "late.txt"), "late\n");
  const s2 = await snapshotTree(t.dir, { name: "tf/1-2" });
  t.state.rounds = [...t.state.rounds, { place: t.place, round: 2, agent: "", before: t.s1, after: String(s2.commit), base: "round", own: ["late.txt"], command: false, turn: 1 }];
  await t.gitAway(async () => {
    assert.ok((await t.ask("turn=1")).json.errors.length, "a round more: read again");
  });
  const now = (await t.ask("turn=1")).json;
  assert.ok(now.files.some((/** @type {any} */ f) => f.path === "late.txt"));
  await t.gitAway(async () => {
    assert.deepEqual((await t.ask("turn=1")).json.errors, [], "kept again");
    assert.ok((await t.ask("turn=1&patch=1")).json.errors.length, "a patch's is read at each ask, the whole kept beside it");
    assert.ok((await t.ask("scope=chat")).json.errors.length, "the chat's is read at each ask");
    t.state.alone = new Set([t.place]);
    assert.ok((await t.ask("turn=1")).json.errors.length, "the folder became the chat's alone: read again");
  });
  const withPatch = (await t.ask("turn=1&patch=1")).json;
  assert.match(withPatch.files.find((/** @type {any} */ f) => f.path === "late.txt").patch, /\+late/);
});

// (fails before: yes — nothing was kept; then, in review, the wholes were kept in the first rows' store, 64 of any size)
test("the route: a turn's whole leaves its small store as others come and is read again; the first rows of every turn asked stay kept", async () => {
  const t = await route();
  const q = `first=4&locale=${encodeURIComponent(LOCALE)}`;
  const big = `first=${TURN_FIRST_MOST + 1}&locale=${encodeURIComponent(LOCALE)}`;
  await t.ask(`turn=1&${q}`);
  await t.ask(`turn=1&${big}`);
  const others = Array.from({ length: TURN_WHOLE_KEPT.most + 3 }, (_, i) => i + 2);
  for (const n of others) {
    t.state.more[n] = t.state.rounds.map((x) => ({ ...x, turn: n }));
    await t.ask(`turn=${n}&${q}`);
  }
  await t.gitAway(async () => {
    for (const n of [1, ...others]) assert.deepEqual((await t.ask(`turn=${n}&${q}`)).json.errors, [], `turn ${n}'s first rows, kept`);
    assert.ok((await t.ask(`turn=1&${big}`)).json.errors.length, "a cut of more than the most kept is not kept: cut from the whole, read again");
    assert.ok((await t.ask("turn=1")).json.errors.length, "turn 1's whole, read again");
    assert.deepEqual((await t.ask(`turn=${others.at(-1)}`)).json.errors, [], "the newest whole, kept");
  });
});

// (fails before: yes — a fork's dialog read the turn's whole changes, a git walk, for its `tree` alone)
test("the route: head=1 answers the head alone — chain, turn, folder and the snapshot in force — with no files", async () => {
  const t = await route();
  const h = (await t.ask("turn=1&head=1")).json;
  assert.deepEqual(h, { chainId: "c1", turn: 1, folder: t.place, tree: { ref: "refs/filament/snapshots/tf-1", turn: 1, round: null, at: null } });
  await t.gitAway(async () => {
    t.state.rounds = [{ ...t.state.rounds[0], place: join(t.dir, "gone") }];
    const away = (await t.ask("turn=1&head=1")).json;
    assert.deepEqual(Object.keys(away), ["chainId", "turn", "folder", "tree"], "no read of the turn's files");
  });
});

test("treeFirst: the page's own order in the page's locale, whatever the locale names; the counts with repeats; what it was given left as it was", () => {
  const places = ["C:/w/app", "C:/w/App-2", "C:/w/ä", ""];
  const paths = ["a", "B", "b", "ä.js", "z.js", "Z/1", "10", "9", "é", "e", "_x", "-y"];
  /** @type {any[]} */
  const files = [];
  let seed = 7;
  const rnd = (/** @type {number} */ n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  for (let i = 0; i < 300; i++) files.push({ place: places[rnd(places.length)], path: `${paths[rnd(paths.length)]}/${paths[rnd(paths.length)]}`, agent: `a${rnd(3)}`, ...(i === 250 ? { via: "command" } : {}) });
  const out = { files, totals: { files: 300, added: 0, removed: 0 }, during: [{ place: "P", path: "x" }, { place: "P", path: "x" }, { place: "Q", path: "x" }], outside: [{ agent: "", path: "/o" }, { agent: "b", path: "/o" }, { agent: "", path: "/p" }], places: [], errors: [] };
  const before = JSON.stringify(out);
  const cut = treeFirst(out, 200, LOCALE);
  assert.deepEqual(cut.files, pageOrder(files).slice(0, 200), "the page's sort of the whole, cut: ties in the order they came");
  assert.deepEqual(cut.counts, { files: 300, during: 2, outside: 2, ran: true }, "a command's file past the cut is said");
  assert.equal(JSON.stringify(out), before, "the answer it was given, as it was");
  const sv = treeFirst({ ...out, files: [{ place: "", path: "ä" }, { place: "", path: "z" }, { place: "", path: "a" }] }, 3, "sv-SE");
  assert.deepEqual(sv.files.map((/** @type {any} */ f) => f.path), ["a", "z", "ä"], "Swedish puts ä after z: the locale is the page's");
  for (const bad of ["", "not a locale!!", "x-"]) assert.deepEqual(treeFirst(out, 5, bad).files, pageOrder(files).slice(0, 5), `${JSON.stringify(bad)}: the default order`);
});

// (fails before: yes — the card counted the rows it was given: the counts of the rest, and a command's file past them, were not read)
test("the card draws the same from its first rows and the counts as from the whole: head, rows, the more line, the outside and command notes", () => {
  const doc = stubDocument();
  try {
    const folder = "C:/w/app";
    /** @type {any[]} */
    const files = [];
    for (let i = 0; i < 450; i++) files.push({ place: i % 3 ? folder : "C:/w/wt", agent: "", path: `src/f${i}.js`, status: i % 2 ? "modified" : "added", added: i, removed: 1, ...(i === 449 ? { via: "command" } : {}) });
    const during = [];
    for (let i = 0; i < 260; i++) during.push({ place: folder, path: `out/${i % 230}.log`, agent: "", round: 1 });
    const outside = [];
    for (let i = 0; i < 230; i++) outside.push({ agent: i % 2 ? "sa_1" : "", path: `C:/tmp/${i % 210}.txt` });
    const whole = { chainId: "c", turn: 3, folder, tree: null, files, totals: { files: 450, added: 101025, removed: 450 }, during, outside, places: [], errors: [] };
    /** @param {any} n @returns {any} */
    const shape = (n) => (n.nodeType === 3 ? n.data : [n.tagName, n.attributes.map((/** @type {any} */ a) => `${a.name}=${a.value}`), n.innerHTML ?? "", n.childNodes.map(shape)]);
    const fromWhole = shape(treeCard({ tree: whole }));
    const fromFirst = shape(treeCard({ tree: treeFirst(whole, TREE_ROWS, LOCALE) }));
    assert.deepEqual(fromFirst, fromWhole);
    const card = /** @type {any} */ (treeCard({ tree: treeFirst(whole, TREE_ROWS, LOCALE) }));
    assert.equal(card.querySelectorAll(".tree-file").length, 200);
    assert.equal(card.querySelector(".tree-more").textContent, "… 250 more files");
    assert.match(card.querySelectorAll(".tree-note").at(-1).textContent, /what their commands changed where only this chat works/, "a command's file past the first rows");
    assert.equal(card.querySelectorAll(".tree-note")[0].textContent, "230 more changed while its commands ran — by them or by someone else");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the card read every file, and a fork's dialog the whole walk)
test("the page asks the card's first rows in its own locale, and a fork's dialog the head alone", () => {
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /const locale = new Intl\.Collator\(\)\.resolvedOptions\(\)\.locale;\n\s*return api\(`\/memory\/sessions\/\$\{encodeURIComponent\(chainId\)\}\/changes\?turn=\$\{Number\(turnNo\)\}&first=\$\{TREE_ROWS\}&locale=\$\{encodeURIComponent\(locale\)\}`\)/);
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /api\(`\/memory\/sessions\/\$\{encodeURIComponent\(chainId\)\}\/changes\?turn=\$\{n\}&head=1`\)\.then\(\(t\) => \{\n\s*const tree = t\?\.tree;/);
});
