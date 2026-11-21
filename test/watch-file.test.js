// @ts-check
// A folder's files as a watcher's trigger (v2-a): `{ kind: "file", glob, place?, on?, settleSec? }` — files matching a
// glob that appear, change or go in a folder of the project. Its trigger read and said (core/watchers.js, the `file`
// row); a folder walked and watched (adapters/tools/file-watch.js: a walk that diffs each file's size and time against
// the walk before, fs.watch only a hint that brings it early, a batch told once nothing moved for the settle); the
// source that follows each watcher on (app/watchers/files.js: a baseline, a restart's catch-up, never the files a chat
// it would wake wrote, its trouble); the store's cursor (`watchLooked`); and the agents' space tool.
// (fails before: yes, each — there was no `file` kind: a trigger of it read as "none of them", nothing walked or
// watched a folder for a watcher, no source followed one, and the store kept no moment a folder was last looked at)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_SKIPS, globHead, seenFields, triggerChat, triggerFields, triggerShort, triggerWords, troubleWords, watchEventOf, watchedName, watchedParts, wokeParts } from "../src/core/watchers.js";
import { routineFields, rowWords } from "../src/core/routines.js";
import { namedText } from "../src/core/space.js";
import { shortHash } from "../src/core/hash.js";
import { clip } from "../src/core/text.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { MOVING_MOST_MS, SAFETY_WALK_MS, SLOW_WALK_MS, WALK_MAX_FILES, walkFiles, watchFolder } from "../src/adapters/tools/file-watch.js";
import { placeAmong } from "../src/app/watchers/commits.js";
import { createFileWatch } from "../src/app/watchers/files.js";
import { createOwnTimes } from "../src/app/watchers/own-times.js";
import { TRIGGER_GUIDE, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { removeDirs, scaledMs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-file-${tag}-`));
  made.push(d);
  return d;
};

/** 09:00 of Monday 26 October 2026, local: a whole second, as a disk keeps a file's time. */
const T = new Date(2026, 9, 26, 9).getTime();
const SEC = 1000;
const MIN = 60_000;
const nameOf = () => "Lead";
const FORM = 'a glob is the paths it watches, from its folder: * within a name, ** across folders, ? one character, {a,b} either — "docs/**/*.md"';

/** A trigger as core reads it. @param {any} input @returns {any} */
const read = (input) => {
  const r = triggerFields(input);
  assert.ok(r.ok, `${JSON.stringify(input)}: ${JSON.stringify(r)}`);
  return r.trigger;
};
/** …and why it does not read. @param {any} input @returns {string} */
const no = (input) => {
  const r = triggerFields(input);
  assert.equal(r.ok, false, JSON.stringify(input));
  return /** @type {any} */ (r).error;
};

describe("a file trigger, read and said (core)", () => {
  test("its fields: a glob from its place, what its files do, how long they must be still; each default set", () => {
    assert.deepEqual(read({ kind: "file", glob: "docs/**/*.md" }), { kind: "file", glob: "docs/**/*.md", on: ["added", "changed"], settleSec: 5 });
    // A glob written as Windows writes a path, from "./", is the same glob; what it hears is kept in the order it is said.
    const full = read({ kind: "file", glob: " .\\assets\\*.png ", place: " packages/app ", on: ["removed", "added"], settleSec: 30 });
    assert.deepEqual(full, { kind: "file", glob: "assets/*.png", place: "packages/app", on: ["added", "removed"], settleSec: 30 });
    assert.deepEqual(read(full), full, "read again, the same");
    // A folder its walk passes over is watched where the glob's first names lead there.
    assert.equal(read({ kind: "file", glob: "dist/report.json" }).glob, "dist/report.json");
    assert.equal(read({ kind: "file", glob: "node_modules/left-pad/**" }).glob, "node_modules/left-pad/**");
    assert.equal(read({ kind: "file", glob: "*.log", settleSec: 2 }).settleSec, 2);
    assert.equal(read({ kind: "file", glob: "*.log", settleSec: 600 }).settleSec, 600);
    assert.equal(triggerChat(read({ kind: "file", glob: "*.log" })), "", "it names no chat");
  });

  test("each refusal in words: what a glob is here, with an example", () => {
    assert.equal(no({ kind: "file" }), `a file trigger names its glob: ${FORM}`);
    for (const glob of ["  ", 7, "./", null]) assert.equal(no({ kind: "file", glob }), `a file trigger names its glob: ${FORM}`, JSON.stringify(glob));
    assert.equal(no({ kind: "file", glob: `docs/${"x".repeat(300)}` }), `glob is 300 characters at most, and this one is 305: ${FORM}`);
    assert.equal(no({ kind: "file", glob: "/etc/*.conf" }), `glob "/etc/*.conf" is a whole path: ${FORM}, and the folder they are read from is place`);
    assert.equal(no({ kind: "file", glob: "C:\\work\\*.md" }), `glob "C:\\work\\*.md" is a whole path: ${FORM}, and the folder they are read from is place`);
    assert.equal(no({ kind: "file", glob: "../other/*.md" }), `glob "../other/*.md" climbs with "..": ${FORM}, and nothing above its folder`);
    assert.equal(no({ kind: "file", glob: "docs/../../x.md" }), `glob "docs/../../x.md" climbs with "..": ${FORM}, and nothing above its folder`);
    assert.equal(no({ kind: "file", glob: ".git/refs/**" }), `glob ".git/refs/**" reaches into .git, which no watcher looks at: ${FORM}`);
    assert.equal(no({ kind: "file", glob: "**/dist/*.js" }), 'glob "**/dist/*.js" passes through dist past its first names: its walk passes over dist and the like — dependency trees, build output, caches — unless the glob begins there, as "dist/**/*.js" does');
    assert.equal(no({ kind: "file", glob: "packages/*/node_modules/x/index.js" }), 'glob "packages/*/node_modules/x/index.js" passes through node_modules past its first names: its walk passes over node_modules and the like — dependency trees, build output, caches — unless the glob begins there, as "node_modules/**/*.js" does');
    for (const place of ["", "  ", 7, "x".repeat(401)]) assert.equal(no({ kind: "file", glob: "*.md", place }), "place is the folder whose files it watches, 400 characters at most; its project's where none", JSON.stringify(place));
    for (const on of [[], ["moved"], "added", ["added", 1]]) assert.equal(no({ kind: "file", glob: "*.md", on }), 'on lists "added", "changed", "removed" or some of them; "added" and "changed" where left out', JSON.stringify(on));
    for (const settleSec of [1, 601, 2.5, "5"])
      assert.equal(no({ kind: "file", glob: "*.md", settleSec }), "settleSec is how long nothing that matches must move before the watcher hears it, so a save storm or a copy of many files is one event: 2 to 600 seconds, 5 where left out", JSON.stringify(settleSec));
    assert.equal(no({ kind: "file", glob: "*.md", chat: "c2" }), 'a file trigger takes glob, place, on and settleSec; "chat" is none of them');
    assert.deepEqual(routineFields({ title: "Docs", text: "x", trigger: { kind: "file", glob: "../x" } }, { create: true }), { ok: false, error: `this watcher's trigger: glob "../x" climbs with "..": ${FORM}, and nothing above its folder` });
  });

  test("a glob's first names: the folders it names whole before any of its marks, where its walk begins", () => {
    assert.deepEqual(globHead("docs/**/*.md"), ["docs"]);
    assert.deepEqual(globHead("docs/api/v2/*.md"), ["docs", "api", "v2"]);
    assert.deepEqual(globHead("dist/report.json"), ["dist"]);
    assert.deepEqual(globHead("packages/*/src/index.js"), ["packages"]);
    for (const none of ["*.md", "report.json", "{a,b}/x.md", "**/*.md", "d?cs/a.md"]) assert.deepEqual(globHead(none), [], none);
  });

  test("its words: whole, what it watches, by its name, short, and what woke a chat", () => {
    const t = read({ kind: "file", glob: "docs/**/*.md" });
    const all = read({ kind: "file", glob: "*.png", place: "assets", on: ["added", "changed", "removed"], settleSec: 30 });
    assert.equal(triggerWords(t, nameOf), "when files matching docs/**/*.md in the project's folder appear or change");
    assert.equal(triggerWords(all, nameOf), "when files matching *.png in assets appear, change or go, once still for 30 s");
    assert.equal(triggerWords(read({ kind: "file", glob: "*.log", on: ["removed"] }), nameOf), "when files matching *.log in the project's folder go");
    assert.equal(namedText(watchedParts(t, nameOf)), "files matching docs/**/*.md in the project's folder that appear or change");
    assert.equal(namedText(watchedParts(all, nameOf)), "files matching *.png in assets that appear, change or go, once still for 30 s");
    assert.equal(watchedName(t, nameOf), "files matching docs/**/*.md");
    assert.deepEqual(triggerShort(t), { each: "files that appear or change", when: "when files appear or change" });
    assert.deepEqual(triggerShort(all), { each: "files that appear, change or go", when: "when files appear, change or go" });
    assert.equal(namedText(wokeParts("Docs moved", t, null, { nameOf })), "“Docs moved” woke this chat · files matching docs/**/*.md appeared or changed");
    assert.equal(namedText(wokeParts("Assets", all, null, { nameOf })), "“Assets” woke this chat · files matching *.png appeared, changed or went");
  });

  test("its event names files, never what they hold: how many and how, where, the first ten, a secret's file counted and not named", () => {
    const t = read({ kind: "file", glob: "docs/**/*.md" });
    /** @param {Record<string, unknown>} o @returns {import("../src/core/watchers.js").WatchEvent} */
    const said = (o) => watchEventOf(/** @type {any} */ ({ kind: "file", at: T, after: T - MIN, place: "/w/docs", glob: "docs/**/*.md", where: "docs", added: [], changed: [], removed: [], away: false, ...o }), t, nameOf);
    const id = `file:${shortHash("/w/docs\ndocs/**/*.md")}:${T - MIN}`;
    assert.deepEqual(said({ changed: ["a.md", "b.md", "c.md"] }), { id, kind: "file", at: T, summary: "3 files changed in docs: a.md, b.md, c.md" });
    assert.equal(said({ added: ["x.png", "y.png"], changed: ["z.png"], where: "assets" }).summary, "2 added, 1 changed in assets: x.png, y.png, z.png");
    assert.equal(said({ added: ["a"], changed: ["b"], removed: ["c"] }).summary, "1 added, 1 changed, 1 removed in docs: a, b, c");
    assert.equal(said({ added: ["new.md"] }).summary, "1 file added in docs: new.md");
    assert.equal(said({ removed: ["old.md", "guide/older.md"], where: "" }).summary, "2 files removed in the project's folder: old.md, guide/older.md");
    // Past ten names the rest are counted.
    const many = Array.from({ length: 14 }, (_, i) => `f${String(i + 1).padStart(2, "0")}.md`);
    assert.equal(said({ changed: many }).summary, `14 files changed in docs: ${many.slice(0, 10).join(", ")} +4 more`);
    // A secret's file, by its name or its folder, is counted and never named; what only shows a secret's shape is named.
    assert.equal(said({ changed: ["app.json", ".env", "keys/deploy.pem"], where: "conf" }).summary, "3 files changed in conf: app.json and 2 files not named");
    assert.equal(said({ added: [".env.local"], where: "" }).summary, "1 file added in the project's folder: 1 file not named");
    assert.equal(said({ changed: ["config"], where: ".aws" }).summary, "1 file changed in .aws: 1 file not named");
    assert.equal(said({ added: [".env.example"], where: "" }).summary, "1 file added in the project's folder: .env.example");
    assert.equal(said({ changed: [...many, "id_rsa"] }).summary, `15 files changed in docs: ${many.slice(0, 10).join(", ")} +4 more and 1 file not named`);
    // Written while Filament was not running, as a restart's first look tells it.
    assert.equal(said({ changed: ["a.md", "b.md"], away: true }).summary, "2 files changed in docs while Filament was not running: a.md, b.md");
    // Its line holds what fits of long names, the rest counted; a name is one line.
    const long = Array.from({ length: 10 }, (_, i) => `${"deep/".repeat(12)}file-${i}.md`);
    const fit = said({ changed: long }).summary;
    const told = fit.split(": ")[1].split(", ").length;
    assert.ok(fit.length <= 300 && told >= 2 && told < 10 && fit.endsWith(` +${10 - told} more`), fit);
    assert.equal(said({ added: ["a\nb.md"] }).summary, "1 file added in docs: a b.md");
    // A long path is told by its end, where the file's own name is; the folder they are in too.
    const deep = `${"deep/".repeat(20)}last-name.md`;
    assert.equal(said({ added: [deep] }).summary, `1 file added in docs: …${deep.slice(-79)}`);
    assert.equal(said({ added: ["a.md"], where: `C:/work/${"x".repeat(90)}/packages/app` }).summary, `1 file added in …${"x".repeat(66)}/packages/app: a.md`);
    // Its id is its look's: the same folder, glob and last look are the same event, whatever it names; a later look's is another.
    assert.equal(said({ changed: ["z.md"], away: true }).id, id);
    assert.notEqual(said({ changed: ["a.md"], after: T }).id, id);
    assert.notEqual(said({ changed: ["a.md"], place: "/w/other" }).id, id);
  });

  test("its cursor keeps when it last looked and its trouble; its trouble is said as its source says it", () => {
    const trouble = { at: T, why: "docs is no folder on this machine", fails: 1 };
    assert.deepEqual(seenFields("file", { fileAt: T, trouble, head: "a".repeat(40), n: 2 }), { fileAt: T, trouble });
    assert.deepEqual(seenFields("file", { fileAt: 0 }), {});
    assert.deepEqual(seenFields("commit", { fileAt: T }), {}, "no other kind's");
    const t = read({ kind: "file", glob: "*.md", place: "docs" });
    assert.equal(troubleWords(trouble, t), "docs is no folder on this machine");
    assert.equal(troubleWords({ at: T, why: "x".repeat(400), fails: 1 }, t), clip("x".repeat(400), 200));
    assert.equal(troubleWords(null, t), "");
  });
});

/**
 * A folder that is not on any disk. A folder is an object, a file its size and its time, a link the same with "link":
 * what the walk asks of it is kept (`asked`, each folder read, from the place).
 * @typedef {{ [name: string]: Node }} Folder
 * @typedef {Folder | [number, number] | [number, number, "link"]} Node
 */
const PLACE = "R:/proj";
/** @param {Folder | null} tree */
function fakeFs(tree) {
  /** @type {string[]} */
  const asked = [];
  /** @param {string} p */
  const parts = (p) => String(p).split(/[\\/]+/).filter(Boolean).slice(2);
  /** @param {string} p @returns {Node | null | undefined} */
  const nodeAt = (p) => {
    /** @type {Node | null | undefined} */
    let n = tree;
    for (const part of parts(p)) {
      if (!n || Array.isArray(n)) return undefined;
      n = n[part];
    }
    return n;
  };
  /** @param {string} code @param {string} p */
  const err = (code, p) => Object.assign(new Error(`${code}: ${code === "ENOENT" ? "no such file or directory" : "not a directory"}, scandir '${p}'\n    at somewhere`), { code });
  return {
    asked,
    fs: {
      /** @param {string} dir */
      readdir: async (dir) => {
        asked.push(parts(dir).join("/"));
        const n = nodeAt(dir);
        if (!n) throw err("ENOENT", dir);
        if (Array.isArray(n)) throw err("ENOTDIR", dir);
        return Object.entries(n).map(([name, v]) => ({ name, isDirectory: () => !Array.isArray(v), isFile: () => Array.isArray(v) && v.length === 2, isSymbolicLink: () => Array.isArray(v) && v.length === 3 }));
      },
      /** @param {string} p */
      lstat: async (p) => {
        const n = nodeAt(p);
        if (!Array.isArray(n)) throw err("ENOENT", p);
        return { size: n[0], mtimeMs: n[1] };
      },
    },
  };
}
/** @returns {Folder} */
const tree = () => ({
  "README.md": [10, T],
  docs: { "a.md": [1, T + 1], "b.txt": [2, T], guide: { "c.md": [3, T + 3] }, linked: [0, T, "link"], "alias.md": [5, T + 5, "link"] },
  node_modules: { pkg: { "x.md": [1, T] } },
  ".git": { "HEAD.md": [1, T] },
  dist: { "out.md": [1, T] },
  src: { build: { "gen.md": [1, T] }, "main.md": [4, T + 4] },
});
const md = (/** @type {string} */ rel) => rel.endsWith(".md");

describe("a folder walked (the adapter's walk)", () => {
  test("each file that matches, by its path from the folder, with its size and its time; the hands' folders passed over, .git always", async () => {
    const f = fakeFs(tree());
    const got = await walkFiles(PLACE, { match: md, skip: FILE_SKIPS, fs: f.fs });
    assert.deepEqual([...got.files].sort(), [["README.md", { size: 10, mtimeMs: T }], ["docs/a.md", { size: 1, mtimeMs: T + 1 }], ["docs/alias.md", { size: 5, mtimeMs: T + 5 }], ["docs/guide/c.md", { size: 3, mtimeMs: T + 3 }], ["src/main.md", { size: 4, mtimeMs: T + 4 }]]);
    assert.deepEqual([got.over, got.rooted], [false, true]);
    assert.deepEqual(f.asked, ["", "docs", "docs/guide", "src"], "no skipped folder is read");
    // With none to pass over, .git is still never read.
    const bare = fakeFs(tree());
    const all = await walkFiles(PLACE, { match: md, fs: bare.fs });
    assert.deepEqual([...all.files.keys()].sort(), ["README.md", "dist/out.md", "docs/a.md", "docs/alias.md", "docs/guide/c.md", "node_modules/pkg/x.md", "src/build/gen.md", "src/main.md"]);
    assert.ok(!bare.asked.includes(".git"), bare.asked.join(" "));
  });

  test("a link is listed by its own name and never followed: nothing below it is read", async () => {
    const f = fakeFs(tree());
    const got = await walkFiles(PLACE, { match: () => true, skip: FILE_SKIPS, fs: f.fs });
    assert.deepEqual(got.files.get("docs/linked"), { size: 0, mtimeMs: T }, "the link itself, as a file is");
    assert.deepEqual(got.files.get("docs/alias.md"), { size: 5, mtimeMs: T + 5 });
    assert.ok(!f.asked.includes("docs/linked") && !f.asked.includes("docs/alias.md"), f.asked.join(" "));
    // On a disk: a folder linked from inside leads outside, and what is there is not listed.
    const dir = fresh("link");
    const outside = fresh("link-outside");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "in.md"), "in");
    writeFileSync(join(outside, "out.md"), "out");
    symlinkSync(outside, join(dir, "docs", "away"), "junction");
    const real = await walkFiles(dir, { match: () => true, skip: FILE_SKIPS });
    assert.deepEqual([...real.files.keys()].sort(), ["docs/away", "docs/in.md"]);
    assert.equal(real.files.get("docs/in.md")?.size, 2);
  });

  test("where it begins: a folder below its place, its paths from there; not there, nothing matches; a place that is none is thrown", async () => {
    const under = await walkFiles(PLACE, { under: "docs", match: md, skip: FILE_SKIPS, fs: fakeFs(tree()).fs });
    assert.deepEqual([[...under.files.keys()].sort(), under.rooted], [["a.md", "alias.md", "guide/c.md"], true]);
    // A folder the walk passes over is walked where it begins there.
    const built = await walkFiles(PLACE, { under: "dist", match: md, skip: FILE_SKIPS, fs: fakeFs(tree()).fs });
    assert.deepEqual([...built.files.keys()], ["out.md"]);
    const deep = await walkFiles(PLACE, { under: "docs/guide", match: md, skip: FILE_SKIPS, fs: fakeFs(tree()).fs });
    assert.deepEqual([...deep.files.keys()], ["c.md"]);
    const none = await walkFiles(PLACE, { under: "reports", match: md, skip: FILE_SKIPS, fs: fakeFs(tree()).fs });
    assert.deepEqual([[...none.files], none.over, none.rooted], [[], false, false]);
    await assert.rejects(walkFiles(PLACE, { match: md, fs: fakeFs(null).fs }), { code: "ENOENT" });
    await assert.rejects(walkFiles(`${PLACE}/README.md`, { match: md, fs: fakeFs(tree()).fs }), { code: "ENOTDIR" });
  });

  test("past its most files it looks at the first of them, by path — a folder's own files, then its folders in order — and says so", async () => {
    // Seven files and links in all: README.md; docs' a.md, alias.md, b.txt, linked; docs/guide/c.md; src/main.md.
    const three = await walkFiles(PLACE, { match: () => true, skip: FILE_SKIPS, max: 3, fs: fakeFs(tree()).fs });
    assert.deepEqual([[...three.files.keys()].sort(), three.over], [["README.md", "docs/a.md", "docs/alias.md"], true]);
    const again = await walkFiles(PLACE, { match: () => true, skip: FILE_SKIPS, max: 3, fs: fakeFs(tree()).fs });
    assert.deepEqual([...again.files.keys()].sort(), [...three.files.keys()].sort(), "the same ones at each walk");
    // The files it looks at are counted, matching or not.
    const few = await walkFiles(PLACE, { match: md, skip: FILE_SKIPS, max: 4, fs: fakeFs(tree()).fs });
    assert.deepEqual([[...few.files.keys()].sort(), few.over], [["README.md", "docs/a.md", "docs/alias.md"], true]);
    const whole = await walkFiles(PLACE, { match: () => true, skip: FILE_SKIPS, max: 7, fs: fakeFs(tree()).fs });
    assert.deepEqual([whole.files.size, whole.over], [7, false]);
    assert.equal(WALK_MAX_FILES, 20_000);
  });
});

/**
 * A folder watched on a clock and timers of the test's own, its walk answered from `files`: time passes only as
 * `pass` says, each timer firing at its moment.
 * @param {Record<string, { size: number, mtimeMs: number }>} files
 * @param {Record<string, any>} [o]  the watch's own options; `hintless`: fs.watch throws here; `fail`, `over`, `rooted`:
 *   how the disk answers from its first walk on, which the watch makes as it is made
 */
function watched(files, { hintless = false, place = PLACE, fail = null, over = false, rooted = true, ...o } = {}) {
  const clock = { at: T };
  /** @type {{ id: number, at: number, fn: () => void }[]} */
  let due = [];
  let ids = 0;
  const timers = {
    set: (/** @type {() => void} */ fn, /** @type {number} */ ms) => (due.push({ id: ++ids, at: clock.at + ms, fn }), ids),
    clear: (/** @type {unknown} */ id) => void (due = due.filter((d) => d.id !== id)),
  };
  const disk = { files: new Map(Object.entries(files)), fail: /** @type {any} */ (fail), over, rooted, walks: 0 };
  /** @type {any[]} */
  const batches = [];
  /** @type {any[]} */
  const looks = [];
  /** The fs.watch standing in: what it watches, and its two hearers. @type {{ dir: string, onHint: (name: string) => void, onError: () => void } | null} */
  let hint = null;
  const hints = { made: 0, closed: 0 };
  const w = watchFolder(place, {
    match: () => true,
    settleMs: 5 * SEC,
    onMoved: (/** @type {any} */ b) => void batches.push(b),
    onLooked: (/** @type {any} */ l) => void looks.push(l),
    now: () => clock.at,
    timers,
    walk: async () => {
      disk.walks += 1;
      if (disk.fail) throw disk.fail;
      return { files: new Map([...disk.files].map(([p, f]) => [p, { ...f }])), over: disk.over, rooted: disk.rooted };
    },
    watch: (/** @type {string} */ dir, /** @type {(name: string) => void} */ onHint, /** @type {() => void} */ onError) => {
      if (hintless) throw new Error("no fs.watch here");
      hints.made += 1;
      hint = { dir, onHint, onError };
      return { close: () => void ((hints.closed += 1), (hint = null)) };
    },
    ...o,
  });
  return {
    w,
    clock,
    disk,
    batches,
    looks,
    hints,
    hint: () => /** @type {NonNullable<typeof hint>} */ (hint),
    /** The timers set now, each by how long from now. */
    waits: () => due.map((d) => d.at - clock.at).sort((a, b) => a - b),
    /** Time passes: each timer due in it fires at its moment, and what it began ends. @param {number} ms */
    async pass(ms) {
      const end = clock.at + ms;
      for (;;) {
        await w.settled();
        const next = due.filter((d) => d.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        due = due.filter((d) => d !== next);
        clock.at = Math.max(clock.at, next.at);
        next.fn();
      }
      clock.at = end;
      await w.settled();
    },
  };
}
/** @param {number} size @param {number} mtimeMs */
const file = (size, mtimeMs) => ({ size, mtimeMs });

describe("a folder watched (the adapter), on the test's own clock", () => {
  test("its first look is where it listens from; what the walk finds added, changed and gone is told once, after the settle, with no hint", async () => {
    const x = watched({ "a.md": file(1, T - MIN), "c.md": file(3, T - MIN) }, { hintless: true });
    await x.w.settled();
    assert.deepEqual(x.batches, [{ at: T, first: true, away: false, added: [], changed: [], removed: [] }], "nothing is news at the first look");
    assert.deepEqual(x.looks, [{ ok: true, over: false, max: WALK_MAX_FILES }]);
    assert.deepEqual([x.w.mode(), x.waits()], ["walk", [SAFETY_WALK_MS]], "fs.watch threw: the walk alone, each minute, and nothing said");
    x.disk.files.set("b.md", file(2, T + 10 * SEC));
    x.disk.files.set("a.md", file(9, T + 20 * SEC));
    x.disk.files.delete("c.md");
    await x.pass(SAFETY_WALK_MS - 1);
    assert.equal(x.disk.walks, 1, "no walk before its minute");
    await x.pass(1);
    assert.deepEqual([x.disk.walks, x.batches.length, x.waits()], [2, 1, [5 * SEC]], "the walk found them: told once they are still");
    // A look asked for before they were still long enough tells nothing, and puts the wait off no further.
    await x.pass(SEC);
    await x.w.look();
    assert.deepEqual([x.disk.walks, x.batches.length, x.waits()], [3, 1, [4 * SEC]]);
    await x.pass(4 * SEC - 1);
    assert.equal(x.batches.length, 1);
    await x.pass(1);
    assert.deepEqual(x.batches[1], {
      at: T + SAFETY_WALK_MS + 5 * SEC,
      first: false,
      away: false,
      added: [{ path: "b.md", size: 2, mtimeMs: T + 10 * SEC }],
      changed: [{ path: "a.md", size: 9, mtimeMs: T + 20 * SEC }],
      removed: [{ path: "c.md", size: 3, mtimeMs: T - MIN, gone: { from: T, to: T + SAFETY_WALK_MS } }],
    });
    assert.deepEqual(x.waits(), [SAFETY_WALK_MS]);
    // Nothing moved: nothing told, however long.
    await x.pass(10 * MIN);
    assert.equal(x.batches.length, 2);
    x.w.stop();
  });

  test("a hint brings the walk early; one of a folder passed over, or of .git, brings none", async () => {
    const x = watched({ "a.md": file(1, T - MIN) }, { skip: ["node_modules"] });
    await x.w.settled();
    assert.deepEqual([x.w.mode(), x.hints.made, x.hint().dir, x.waits()], ["hint", 1, PLACE, [SAFETY_WALK_MS]]);
    await x.pass(SEC);
    x.hint().onHint("node_modules/pkg/index.js");
    x.hint().onHint(".git\\index");
    assert.deepEqual(x.waits(), [SAFETY_WALK_MS - SEC], "no walk for what it never looks at");
    x.disk.files.set("a.md", file(2, T + SEC));
    x.hint().onHint("a.md");
    x.hint().onHint("a.md");
    assert.deepEqual(x.waits(), [250], "a look within moments, once for a burst of hints");
    await x.pass(250);
    assert.deepEqual([x.disk.walks, x.batches.length], [2, 1]);
    // Hints while it waits for the settle neither put it off nor bring another walk.
    x.hint().onHint("a.md");
    assert.deepEqual(x.waits(), [5 * SEC]);
    await x.pass(5 * SEC);
    assert.deepEqual(x.batches[1].changed, [{ path: "a.md", size: 2, mtimeMs: T + SEC }]);
    assert.equal(x.batches[1].at, T + SEC + 250 + 5 * SEC);
    // A hint with no name is one too.
    x.hint().onHint("");
    assert.deepEqual(x.waits(), [250]);
    x.w.stop();
  });

  test("the settle: a storm of saves is one batch, of what stands once it is over — a file made and removed in it is none", async () => {
    const x = watched({ "a.md": file(1, T - MIN) });
    await x.w.settled();
    for (let i = 1; i <= 8; i++) {
      await x.pass(SEC);
      x.disk.files.set("a.md", file(1 + i, T + i * SEC));
      if (i === 2) x.disk.files.set("tmp.md", file(1, T + i * SEC));
      if (i === 6) x.disk.files.delete("tmp.md");
      if (i === 7) x.disk.files.set("new.md", file(1, T + i * SEC));
      if (i === 8) x.disk.files.set("new.md", file(2, T + i * SEC));
      x.hint().onHint("a.md");
    }
    // The last save was at 8 s: looked at 1.25 s, 6.25 s and 11.25 s it had moved each time, and at 16.25 s it was still.
    await x.pass(8 * SEC);
    assert.equal(x.batches.length, 1, "nothing told while it moves");
    await x.pass(250);
    assert.deepEqual(x.batches.slice(1), [{ at: T + 16_250, first: false, away: false, added: [{ path: "new.md", size: 2, mtimeMs: T + 8 * SEC }], changed: [{ path: "a.md", size: 9, mtimeMs: T + 8 * SEC }], removed: [] }]);
    assert.equal(x.disk.walks, 5);
    x.w.stop();
  });

  test("files that never rest are told as they stand after ten minutes, and again as long after: one written without end silences none", async () => {
    const x = watched({ "a.md": file(1, T - MIN), "log.md": file(1, T - MIN) }, { hintless: true });
    await x.w.settled();
    x.disk.files.set("b.md", file(1, T + SEC));
    // log.md is written every two seconds, for twelve minutes: the walk first finds it moved at one minute.
    for (let i = 1; i <= 360; i++) {
      x.disk.files.set("log.md", file(1 + i, T + i * 2 * SEC));
      await x.pass(2 * SEC);
      if (i === 329) assert.equal(x.batches.length, 1, "nothing told for ten minutes less two seconds of moving");
    }
    assert.equal(MOVING_MOST_MS, 10 * MIN);
    assert.deepEqual(x.batches.slice(1), [{ at: T + 11 * MIN, first: false, away: false, added: [{ path: "b.md", size: 1, mtimeMs: T + SEC }], changed: [{ path: "log.md", size: 331, mtimeMs: T + 11 * MIN }], removed: [] }]);
    // It rests: what it did since is told once it is still.
    await x.pass(5 * SEC);
    assert.deepEqual(x.batches.slice(2), [{ at: T + 12 * MIN + 5 * SEC, first: false, away: false, added: [], changed: [{ path: "log.md", size: 361, mtimeMs: T + 12 * MIN }], removed: [] }]);
    x.w.stop();
  });

  test("on the network no fs.watch: the walk alone, each half minute; an fs.watch that errors is let go and the walk goes on, nothing said", async () => {
    const net = watched({ "a.md": file(1, T - MIN) }, { place: "\\\\server\\share\\proj" });
    await net.w.settled();
    assert.deepEqual([net.hints.made, net.w.mode(), net.waits()], [0, "walk", [SLOW_WALK_MS]]);
    net.disk.files.set("b.md", file(1, T + SEC));
    await net.pass(SLOW_WALK_MS + 5 * SEC);
    assert.deepEqual(net.batches[1].added.map((/** @type {any} */ f) => f.path), ["b.md"]);
    assert.deepEqual(net.waits(), [SLOW_WALK_MS]);
    net.w.stop();
    assert.equal(SLOW_WALK_MS, 30 * SEC);
    assert.equal(SAFETY_WALK_MS, MIN);

    const x = watched({ "a.md": file(1, T - MIN) });
    await x.w.settled();
    x.hint().onError();
    assert.deepEqual([x.hints.closed, x.w.mode()], [1, "walk"]);
    x.disk.files.set("b.md", file(1, T + SEC));
    await x.pass(SAFETY_WALK_MS + 5 * SEC);
    assert.deepEqual([x.batches[1].added.map((/** @type {any} */ f) => f.path), x.hints.made], [["b.md"], 1], "found by the walk; no second fs.watch on a folder still there");
    assert.deepEqual(x.looks, [{ ok: true, over: false, max: WALK_MAX_FILES }], "and nothing said of it");
    x.w.stop();
  });

  test("a folder that is not there, and a walk that fails, are said once until a walk goes well; the first good look is where it listens from", async () => {
    const gone = Object.assign(new Error("ENOENT: no such file or directory, scandir 'R:\\proj'\n    at somewhere"), { code: "ENOENT" });
    const x = watched({ "a.md": file(1, T - MIN) }, { fail: gone });
    await x.w.settled();
    await x.pass(3 * MIN);
    assert.deepEqual(x.looks, [{ ok: false, gone: true, error: "ENOENT: no such file or directory, scandir 'R:\\proj'" }], "said once, though each minute's walk failed");
    assert.deepEqual([x.batches, x.hints.made, x.disk.walks], [[], 0, 4]);
    x.disk.fail = null;
    await x.pass(MIN);
    assert.deepEqual(x.looks[1], { ok: true, over: false, max: WALK_MAX_FILES });
    assert.deepEqual(x.batches, [{ at: T + 4 * MIN, first: true, away: false, added: [], changed: [], removed: [] }]);
    assert.equal(x.hints.made, 1, "watched once it is there");
    // A walk that fails otherwise: its first line; what moved meanwhile is told once it reads again.
    x.disk.fail = Object.assign(new Error("EACCES: permission denied, scandir 'R:\\proj\\docs'"), { code: "EACCES" });
    x.disk.files.set("b.md", file(1, T + 4 * MIN + SEC));
    await x.pass(2 * MIN);
    assert.deepEqual(x.looks[2], { ok: false, gone: false, error: "EACCES: permission denied, scandir 'R:\\proj\\docs'" });
    assert.equal(x.looks.length, 3);
    x.disk.fail = null;
    await x.pass(MIN + 5 * SEC);
    assert.deepEqual([x.looks.length, x.looks[3].ok, x.batches[1].added.map((/** @type {any} */ f) => f.path)], [4, true, ["b.md"]]);
    // The folder gone lets its fs.watch go; back, it is watched anew.
    x.disk.fail = gone;
    await x.pass(MIN);
    assert.deepEqual([x.hints.closed, x.w.mode()], [1, "walk"]);
    x.disk.fail = null;
    await x.pass(MIN);
    assert.deepEqual([x.hints.made, x.w.mode()], [2, "hint"]);
    x.w.stop();
  });

  test("the folder its walk begins at is not there yet: nothing matches, no trouble, no fs.watch; once it is, its files are told", async () => {
    const x = watched({}, { under: "dist", rooted: false });
    await x.w.settled();
    assert.deepEqual([x.looks, x.hints.made, x.batches.length], [[{ ok: true, over: false, max: WALK_MAX_FILES }], 0, 1]);
    x.disk.rooted = true;
    x.disk.files.set("report.json", file(1, T + SEC));
    await x.pass(MIN + 5 * SEC);
    assert.deepEqual(x.batches[1].added.map((/** @type {any} */ f) => f.path), ["report.json"]);
    assert.deepEqual([x.hints.made, x.hint().dir], [1, join(PLACE, "dist")], "its fs.watch is of where the walk begins");
    x.w.stop();
  });

  test("past the most files it says so, tells none gone, and tells added only what was written since it last told", async () => {
    const x = watched({ "a.md": file(1, T - MIN), "b.md": file(1, T - MIN) }, { hintless: true, max: 2, over: true });
    await x.w.settled();
    assert.deepEqual(x.looks, [{ ok: true, over: true, max: 2 }]);
    // b.md fell past the cap as z.md came inside it; new.md was written since.
    x.disk.files.delete("b.md");
    x.disk.files.set("z.md", file(1, T - MIN));
    x.disk.files.set("new.md", file(1, T + SEC));
    await x.pass(MIN + 5 * SEC);
    assert.deepEqual(x.batches[1], { at: T + MIN + 5 * SEC, first: false, away: false, added: [{ path: "new.md", size: 1, mtimeMs: T + SEC }], changed: [], removed: [] });
    // Under the cap again: said, and what goes is told again.
    x.disk.over = false;
    x.disk.files.delete("a.md");
    await x.pass(MIN + 5 * SEC);
    assert.deepEqual(x.looks[1], { ok: true, over: false, max: 2 });
    assert.equal(x.batches.length, 2, "the look that came back under the cap tells none gone: what was past it then is not known");
    x.disk.files.delete("z.md");
    await x.pass(MIN + 5 * SEC);
    assert.deepEqual(x.batches[2].removed.map((/** @type {any} */ f) => f.path), ["z.md"]);
    x.w.stop();
  });

  test("a first look after a time away: what was written since is told as changed, away; a file dated past now is none", async () => {
    const x = watched({ "old.md": file(1, T - 10 * SEC), "b.md": file(2, T - SEC), "a.md": file(1, T - 2 * SEC), "ahead.md": file(1, T + MIN) }, { since: T - 5 * SEC });
    await x.w.settled();
    assert.deepEqual(x.batches, [{ at: T, first: true, away: true, added: [], changed: [{ path: "a.md", size: 1, mtimeMs: T - 2 * SEC }, { path: "b.md", size: 2, mtimeMs: T - SEC }], removed: [] }]);
    await x.pass(10 * MIN);
    assert.equal(x.batches.length, 1, "told once");
    x.w.stop();
  });

  test("stop leaves nothing: no timer, no fs.watch, no walk after", async () => {
    const x = watched({ "a.md": file(1, T - MIN) });
    await x.w.settled();
    const hint = x.hint();
    x.disk.files.set("b.md", file(1, T));
    hint.onHint("b.md");
    assert.deepEqual(x.waits(), [250]);
    x.w.stop();
    assert.deepEqual([x.waits(), x.hints.closed, x.w.mode()], [[], 1, "walk"]);
    hint.onHint("b.md");
    await x.w.look();
    await x.pass(10 * MIN);
    assert.deepEqual([x.waits(), x.disk.walks, x.batches.length], [[], 1, 1]);
  });

  test("on a disk, with fs.watch and timers as they are: a file written is told within moments, and stop ends it", async () => {
    const dir = fresh("real");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), "a");
    /** @type {any[]} */
    const batches = [];
    const w = watchFolder(dir, { under: "docs", match: md, skip: FILE_SKIPS, settleMs: 50, hintMs: 10, safetyMs: 200, onMoved: (b) => void batches.push(b) });
    try {
      await until(() => batches.length === 1, "its first look");
      assert.deepEqual([batches[0].first, batches[0].changed], [true, []]);
      writeFileSync(join(dir, "docs", "new.md"), "new");
      writeFileSync(join(dir, "docs", "note.txt"), "no match");
      await until(() => batches.length === 2, "the file told");
      assert.deepEqual(batches[1].added.map((/** @type {any} */ f) => [f.path, f.size]), [["new.md", 3]]);
    } finally {
      w.stop();
    }
    writeFileSync(join(dir, "docs", "late.md"), "late");
    await new Promise((ok) => setTimeout(ok, scaledMs(400)));
    assert.equal(batches.length, 2, "nothing after its stop");
  });
});

const BY = { chain: "c1", byName: "Lead", model: "m", nameOf };
/** Timers that never fire, and an fs.watch that is none: the source's watches look only as the test says. */
const NO_TIMERS = { set: () => 0, clear: () => {} };
const NO_HINT = () => {
  throw new Error("no fs.watch in this test");
};

/**
 * A project's folder on a disk and its Space, whose one watcher (r1, proposed by the chat c1) watches files there.
 * Its chats: c1, which proposed it; c2, another chat of the project; run1, a routine's run there; far, a run in
 * another folder. Its clock is the test's: a file is written with the time the test gives it. The watch looks only as
 * `look` says — twice, since what one look finds moved the next tells —, with no settle to wait for.
 * @param {string} tag
 * @param {{ trigger?: Record<string, unknown>, wakes?: "new" | "chat" | "you", folders?: (dir: string) => string[], opts?: Record<string, unknown>, heard?: (events: readonly any[]) => void }} [o]
 *   `folders`: the project's folders, its own alone unless said; `opts`: the folder watch's own options; `heard`:
 *   called before each hearing is kept
 */
function rig(tag, { trigger = { kind: "file", glob: "docs/**/*.md" }, wakes = "new", folders = (dir) => [dir], opts = {}, heard = () => {} } = {}) {
  const dir = fresh(tag);
  const elsewhere = fresh(`${tag}-else`);
  const space = fresh(`${tag}-space`);
  mkdirSync(join(dir, "docs", "guide"), { recursive: true });
  const clock = { at: T };
  const now = () => clock.at;
  let store = createSpaceStore({ dir: space, now });
  const f = routineFields({ title: "Docs moved", text: "Read them.", trigger, wakes }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  store.routinePropose("p1", f.fields, BY);
  store.routineOn("p1", "r1");
  /** Each event heard and kept, in order. @type {import("../src/core/watchers.js").WatchEvent[]} */
  const heardBy = [];
  /** @type {string[]} */
  const logged = [];
  /** @type {Record<string, { run: boolean, folder: string }>} */
  const chats = { c1: { run: false, folder: dir }, c2: { run: false, folder: dir }, run1: { run: true, folder: dir }, far: { run: true, folder: elsewhere } };
  const own = createOwnTimes({ now });
  /** The folders watched since the last `make`, each with what the source asked of its watch. @type {{ place: string, under: string, since: number | null }[]} */
  const begun = [];
  const make = () =>
    createFileWatch({
      store,
      own,
      heard: async (project, id, events) => {
        heard(events);
        const n = store.watchHeard(project, id, events);
        if (n) heardBy.push(.../** @type {any[]} */ (events));
        return n;
      },
      folderOf: () => dir,
      foldersOf: async () => folders(dir),
      chatOf: (chain) => chats[chain] ?? null,
      now,
      retryMs: 20,
      log: (_, msg) => void logged.push(msg),
      watch: (place, o) => (begun.push({ place, under: o.under ?? "", since: o.since ?? null }), watchFolder(place, { ...o, settleMs: 0, timers: NO_TIMERS, watch: NO_HINT, ...opts })),
    });
  const w = () => /** @type {import("../src/core/routines.js").Routine} */ (store.get("p1").routines.find((r) => r.id === "r1"));
  return {
    dir,
    elsewhere,
    clock,
    own,
    chats,
    heardBy,
    logged,
    begun,
    make,
    w,
    get store() {
      return store;
    },
    /** Filament started again: its store read anew from its folder. */
    reopen: () => void (store = createSpaceStore({ dir: space, now })),
    /** A file of the project written, its time the clock's unless given. @param {string} rel @param {string} text @param {number} [mtime] */
    put(rel, text, mtime = clock.at) {
      const p = join(dir, ...rel.split("/"));
      writeFileSync(p, text);
      utimesSync(p, new Date(mtime), new Date(mtime));
      return p;
    },
    /** @param {string} rel */
    drop: (rel) => rmSync(join(dir, ...rel.split("/")), { recursive: true }),
    /** Time passes. @param {number} ms */
    later: (ms) => void (clock.at += ms),
    /** The watcher's folder looked at, and what moved told. @param {import("../src/app/watchers/files.js").FileWatch} fw */
    async look(fw) {
      await fw.look("p1", "r1");
      await fw.look("p1", "r1");
    },
    /** What its row says of its trouble. */
    row: () => rowWords(w(), { now: clock.at }).skipped,
    summaries: () => heardBy.map((e) => e.summary),
  };
}
/** A chat's run begun, a call of it started — a command's, or one that writes files — and ended, as the bus says them. */
const began = (/** @type {string} */ chain) => ({ type: "run-start", kind: "agent-turn", title: null, parentId: null, meta: { chain } });
const runs = (/** @type {string} */ id) => ({ type: "tool-start", round: 1, name: "bash", args: "", id, command: true });
const writes = (/** @type {string} */ id, /** @type {string[] | true} */ edits) => ({ type: "tool-start", round: 1, name: "write", args: "", id, edits });
const ends = (/** @type {string} */ id) => ({ type: "tool-end", round: 1, name: "bash", ok: true, ms: 1, id });

describe("a watcher hears its folder's files (the source, a real folder, a real store)", () => {
  test("its first look is where it listens from; what moves after is one event, by name, its id its look's; its cursor keeps when it looked", async () => {
    const r = rig("hear");
    r.put("docs/a.md", "a", T - MIN);
    r.put("docs/guide/b.md", "b", T - MIN);
    r.put("docs/notes.txt", "no match", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.deepEqual([r.w().seen?.fileAt, r.heardBy.length, r.w().pending ?? null], [T, 0, null], "the first look wakes nothing");
      assert.deepEqual(r.begun, [{ place: r.dir, under: "docs", since: null }], "its walk begins at its glob's first names");
      assert.deepEqual([...fw.watched()], [["p1\nr1", join(r.dir, "docs")]]);
      r.later(10 * SEC);
      r.put("docs/a.md", "aa");
      r.put("docs/c.md", "c");
      r.put("docs/notes.txt", "still no match");
      r.put("README.md", "outside its glob");
      await r.look(fw);
      assert.deepEqual(r.heardBy, [{ id: `file:${shortHash(`${join(r.dir, "docs")}\ndocs/**/*.md`)}:${T}`, kind: "file", at: T + 10 * SEC, summary: "1 added, 1 changed in docs: c.md, a.md" }]);
      assert.deepEqual([r.w().seen?.fileAt, r.w().pending?.events.length], [T + 10 * SEC, 1]);
      r.later(10 * SEC);
      r.put("docs/a.md", "aaa");
      r.put("docs/guide/b.md", "bb");
      await r.look(fw);
      assert.equal(r.summaries()[1], "2 files changed in docs: a.md, guide/b.md");
      assert.ok(r.heardBy[1].id.endsWith(`:${T + 10 * SEC}`), r.heardBy[1].id);
      // A file gone is none of what it listens for, unless its trigger says; its look is kept all the same.
      r.later(10 * SEC);
      r.drop("docs/c.md");
      await r.look(fw);
      assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt], [2, T + 30 * SEC]);
      // Nothing moved: nothing heard.
      r.later(10 * SEC);
      await r.look(fw);
      assert.equal(r.heardBy.length, 2);
    } finally {
      fw.stop();
    }
  });

  test("what it listens for: added, changed, removed, each as its trigger says", async () => {
    const r = rig("on", { trigger: { kind: "file", glob: "*.log", place: "docs", on: ["removed"] } });
    r.put("docs/a.log", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.deepEqual(r.begun, [{ place: join(r.dir, "docs"), under: "", since: null }]);
      r.later(10 * SEC);
      r.put("docs/a.log", "aa");
      r.put("docs/b.log", "b");
      await r.look(fw);
      assert.equal(r.heardBy.length, 0, "neither added nor changed");
      r.later(10 * SEC);
      r.drop("docs/a.log");
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file removed in docs: a.log"]);
    } finally {
      fw.stop();
    }
  });

  test("a secret's file is counted, never named", async () => {
    const r = rig("secret", { trigger: { kind: "file", glob: "conf/**" } });
    mkdirSync(join(r.dir, "conf", "keys"), { recursive: true });
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.later(10 * SEC);
      r.put("conf/app.json", "{}");
      r.put("conf/.env", "TOKEN=1");
      r.put("conf/keys/deploy.pem", "key");
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["3 files added in conf: app.json and 2 files not named"]);
      assert.ok(!JSON.stringify(r.w()).includes(".env") && !JSON.stringify(r.w()).includes("deploy.pem"), "its Space's file names neither");
    } finally {
      fw.stop();
    }
  });

  test("a restart: what was written while Filament was not running is heard once, said so; a file gone meanwhile cannot be known", async () => {
    const r = rig("restart");
    r.put("docs/a.md", "a", T - MIN);
    r.put("docs/b.md", "b", T - MIN);
    r.put("docs/c.md", "c", T - MIN);
    let fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      fw.stop();
      // Filament off for an hour: one file written, one made, one removed.
      r.later(60 * MIN);
      r.put("docs/a.md", "aa", T + 30 * MIN);
      r.put("docs/d.md", "d", T + 50 * MIN);
      r.drop("docs/b.md");
      r.reopen();
      assert.equal(r.w().seen?.fileAt, T, "when it last looked, read back from its file");
      r.begun.length = 0;
      fw = r.make();
      fw.sync();
      await fw.settled();
      assert.deepEqual(r.begun, [{ place: r.dir, under: "docs", since: T }]);
      assert.deepEqual(r.heardBy, [{ id: `file:${shortHash(`${join(r.dir, "docs")}\ndocs/**/*.md`)}:${T}`, kind: "file", at: T + 60 * MIN, summary: "2 files changed in docs while Filament was not running: a.md, d.md" }]);
      assert.equal(r.w().seen?.fileAt, T + 60 * MIN);
      // Its look was heard and Filament stopped before its cursor was kept: started again, the same look is the same event.
      fw.stop();
      assert.equal(r.store.watchLooked("p1", "r1", T), true);
      r.reopen();
      fw = r.make();
      fw.sync();
      await fw.settled();
      assert.deepEqual([r.heardBy.length, r.w().pending?.events.length, r.w().seen?.fileAt], [1, 1, T + 60 * MIN], "heard once");
      // Started again with nothing written since: nothing.
      fw.stop();
      r.later(MIN);
      r.reopen();
      fw = r.make();
      fw.sync();
      await fw.settled();
      assert.equal(r.heardBy.length, 1);
      // From here it hears as ever.
      r.later(10 * SEC);
      r.put("docs/c.md", "cc");
      await r.look(fw);
      assert.equal(r.summaries()[1], "1 file changed in docs: c.md");
    } finally {
      fw.stop();
    }
  });

  test("a watcher that listens only for files gone hears nothing of a restart", async () => {
    const r = rig("restart-gone", { trigger: { kind: "file", glob: "docs/*.md", on: ["removed"] } });
    r.put("docs/a.md", "a", T - MIN);
    let fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      fw.stop();
      r.later(60 * MIN);
      r.put("docs/a.md", "aa", T + 30 * MIN);
      r.reopen();
      fw = r.make();
      fw.sync();
      await fw.settled();
      assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt], [0, T + 60 * MIN]);
    } finally {
      fw.stop();
    }
  });

  test("paused it looks at nothing and, resumed, takes its first look again: what moved meanwhile is not made up", async () => {
    const r = rig("pause");
    r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.store.routinePause("p1", "r1", true);
      fw.sync();
      assert.equal(fw.watched().size, 0, "paused: its folder is let go");
      r.later(10 * SEC);
      r.put("docs/a.md", "aa");
      r.put("docs/b.md", "b");
      r.later(10 * SEC);
      r.store.routinePause("p1", "r1", false);
      assert.equal(r.w().seen?.fileAt, undefined, "resumed: it starts over");
      fw.sync();
      await fw.settled();
      assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt, r.begun.at(-1)?.since], [0, T + 20 * SEC, null]);
      r.later(10 * SEC);
      r.put("docs/b.md", "bb");
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file changed in docs: b.md"]);
    } finally {
      fw.stop();
    }
  });

  test("Pause all lets its look go, and what it kept of it: off again, it takes its first look again — a restart meanwhile or not", async () => {
    const r = rig("pause-all");
    r.put("docs/a.md", "a", T - MIN);
    let fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.equal(r.w().seen?.fileAt, T);
      r.store.pauseAll(true);
      fw.sync();
      assert.deepEqual([fw.watched().size, r.w().seen?.fileAt], [0, undefined]);
      r.later(10 * SEC);
      r.put("docs/a.md", "aa");
      // Filament stopped and started while Pause all is on.
      fw.stop();
      r.reopen();
      fw = r.make();
      fw.sync();
      await fw.settled();
      assert.deepEqual([fw.watched().size, r.begun.length], [0, 1], "nothing watched under Pause all");
      r.later(10 * SEC);
      r.store.pauseAll(false);
      fw.sync();
      await fw.settled();
      assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt, r.begun.at(-1)?.since], [0, T + 20 * SEC, null], "what moved meanwhile is not made up");
      r.later(10 * SEC);
      r.put("docs/a.md", "aaa");
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file changed in docs: a.md"]);
    } finally {
      fw.stop();
    }
  });

  test("a watcher removed, or changed by its chat, is let go; one put back takes its first look again", async () => {
    const r = rig("removed");
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.equal(fw.watched().size, 1);
      r.store.routineRemove("p1", "r1");
      fw.sync();
      assert.equal(fw.watched().size, 0);
      r.later(10 * SEC);
      r.put("docs/a.md", "a");
      r.store.routineBack("p1", "r1");
      fw.sync();
      await fw.settled();
      assert.deepEqual([fw.watched().size, r.heardBy.length, r.w().seen?.fileAt], [1, 0, T + 10 * SEC]);
      const changed = routineFields({ trigger: { kind: "file", glob: "docs/*.txt" } }, { create: false });
      assert.ok(changed.ok, JSON.stringify(changed));
      r.store.routinePropose("p1", changed.fields, BY, "r1");
      fw.sync();
      assert.equal(fw.watched().size, 0, "changed: off until it is switched on again");
      // Another watcher's kind is none of its: never followed.
      const f = routineFields({ title: "Main", text: "x", trigger: { kind: "commit", branch: "main" } }, { create: true });
      assert.ok(f.ok);
      r.store.routineOn("p1", r.store.routinePropose("p1", f.fields, BY).id);
      fw.sync();
      await fw.settled();
      assert.equal(fw.watched().size, 0);
    } finally {
      fw.stop();
    }
  });

  test("a place outside the project's folders is not watched: its trouble on its row; one inside is, by its path from the project's folder", async () => {
    const out = rig("outside", { trigger: { kind: "file", glob: "*.md", place: "../elsewhere" } });
    const fw = out.make();
    try {
      fw.sync();
      await fw.settled();
      const why = 'place "../elsewhere" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project\'s folder';
      assert.deepEqual([fw.watched().size, out.begun.length, out.w().seen?.trouble?.why, out.w().seen?.fileAt], [0, 0, why, undefined], "nothing of that folder is read");
      assert.equal(out.row(), clip(why, 200));
    } finally {
      fw.stop();
    }
    // A folder the project added is one of its folders; a place not whole is read against its own.
    const r = rig("inside", { trigger: { kind: "file", glob: "*.md", place: "docs/guide" }, folders: (dir) => [dir, join(dir, "..", "added")] });
    const fw2 = r.make();
    try {
      fw2.sync();
      await fw2.settled();
      assert.deepEqual([[...fw2.watched().values()], r.w().seen?.trouble ?? null], [[join(r.dir, "docs", "guide")], null]);
      r.later(10 * SEC);
      r.put("docs/guide/new.md", "n");
      await r.look(fw2);
      assert.deepEqual(r.summaries(), ["1 file added in docs/guide: new.md"]);
    } finally {
      fw2.stop();
    }
  });

  test("a place that is no folder yet is looked for again each minute, and watched once it is there; inside .git never", async () => {
    const r = rig("late", { trigger: { kind: "file", glob: "*.json", place: "reports" } });
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.deepEqual([fw.watched().size, r.row()], [0, 'place "reports" is no folder on this machine']);
      mkdirSync(join(r.dir, "reports"));
      await until(() => fw.watched().size === 1 && r.w().seen?.fileAt === T, "the place found once it is there");
      assert.equal(r.w().seen?.trouble ?? null, null, "its trouble gone as its walk goes well");
      r.later(10 * SEC);
      r.put("reports/run.json", "{}");
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file added in reports: run.json"]);
    } finally {
      fw.stop();
    }
    const git = rig("git", { trigger: { kind: "file", glob: "*", place: ".git/hooks" } });
    mkdirSync(join(git.dir, ".git", "hooks"), { recursive: true });
    const fw2 = git.make();
    try {
      fw2.sync();
      await fw2.settled();
      assert.deepEqual([fw2.watched().size, git.begun.length, git.row()], [0, 0, ".git/hooks is inside a repository's own .git folder, which no watcher looks at"]);
    } finally {
      fw2.stop();
    }
  });

  test("never its own, by the file: what the chat it wakes wrote with a call that names it is no news; another file in the same seconds is", async () => {
    const r = rig("own-path", { wakes: "chat" });
    const a = r.put("docs/a.md", "a", T - MIN);
    r.put("docs/b.md", "b", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      // The chat's write of a.md, from 11 s to 13 s; the person saves b.md in the same seconds.
      r.own.runEvent("t1", began("c1"), T + 10 * SEC);
      r.own.runEvent("t1", writes("w1", [a]), T + 11 * SEC);
      r.put("docs/a.md", "the chat's", T + 12 * SEC);
      r.put("docs/b.md", "the person's", T + 12 * SEC);
      r.own.runEvent("t1", ends("w1"), T + 13 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file changed in docs: b.md"]);
      // The person's save of a.md at another time is heard.
      r.later(10 * SEC);
      r.put("docs/a.md", "the person's");
      r.later(10 * SEC);
      await r.look(fw);
      assert.equal(r.summaries()[1], "1 file changed in docs: a.md");
      // A call that says only that it writes: any file written in its while is its chat's.
      r.own.runEvent("t1", writes("w2", true), T + 50 * SEC);
      r.put("docs/c.md", "the chat's", T + 51 * SEC);
      r.own.runEvent("t1", ends("w2"), T + 52 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.equal(r.heardBy.length, 2, "its own: no news");
      assert.equal(r.w().seen?.fileAt, T + 60 * SEC, "its look kept all the same");
      // Another chat of the project, which this watcher does not wake, writes the file by name: news.
      r.own.runEvent("t2", began("c2"), T + 70 * SEC);
      r.own.runEvent("t2", writes("w1", [a]), T + 71 * SEC);
      r.put("docs/a.md", "another chat's", T + 72 * SEC);
      r.own.runEvent("t2", ends("w1"), T + 73 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.equal(r.summaries()[2], "1 file changed in docs: a.md");
    } finally {
      fw.stop();
    }
  });

  test("never its own, by a command's while: what was written while a command of the chat it wakes, or of a routine's run there, ran is no news", async () => {
    const r = rig("own-while", { wakes: "chat" });
    r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.own.runEvent("t1", began("c1"), T + 10 * SEC);
      r.own.runEvent("t1", runs("u1"), T + 11 * SEC);
      r.put("docs/a.md", "by its command", T + 12 * SEC);
      r.put("docs/made.md", "by its command", T + 12 * SEC);
      r.own.runEvent("t1", ends("u1"), T + 13 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt], [0, T + 20 * SEC]);
      // A routine's run at work in the project's folder: no run wakes a watcher.
      r.own.runEvent("t3", began("run1"), T + 30 * SEC);
      r.own.runEvent("t3", runs("u1"), T + 31 * SEC);
      r.put("docs/a.md", "by a run's command", T + 32 * SEC);
      r.own.runEvent("t3", ends("u1"), T + 33 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.equal(r.heardBy.length, 0);
      // The person's save seconds after that command: heard.
      r.put("docs/a.md", "the person's", T + 45 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file changed in docs: a.md"]);
      // A run at work in another folder, and a chat this watcher does not wake: their commands' whiles are none of its.
      r.own.runEvent("t4", began("far"), T + 70 * SEC);
      r.own.runEvent("t4", runs("u1"), T + 71 * SEC);
      r.own.runEvent("t5", began("c2"), T + 70 * SEC);
      r.own.runEvent("t5", runs("u1"), T + 71 * SEC);
      r.put("docs/a.md", "the person's again", T + 72 * SEC);
      r.own.runEvent("t4", ends("u1"), T + 73 * SEC);
      r.own.runEvent("t5", ends("u1"), T + 73 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.equal(r.summaries()[1], "1 file changed in docs: a.md");
      // A file written long before, in a command of the chat's then, and brought in only now is news.
      r.own.runEvent("t1", runs("u9"), T - 60 * MIN);
      r.own.runEvent("t1", ends("u9"), T - 50 * MIN);
      r.later(20 * SEC);
      r.put("docs/old.md", "made an hour ago", T - 55 * MIN);
      await r.look(fw);
      assert.equal(r.summaries()[2], "1 file added in docs: old.md");
    } finally {
      fw.stop();
    }
  });

  test("never its own, a file gone: removed while a command of the chat it wakes ran is no news; removed at another time is", async () => {
    const r = rig("own-gone", { wakes: "chat", trigger: { kind: "file", glob: "docs/*.md", on: ["removed"] } });
    r.put("docs/a.md", "a", T - MIN);
    r.put("docs/b.md", "b", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.later(10 * SEC);
      await r.look(fw);
      // Its command runs from 11 s to 13 s; the look before it saw a.md, the look at 20 s does not.
      r.own.runEvent("t1", began("c1"), T + 10 * SEC);
      r.own.runEvent("t1", runs("u1"), T + 11 * SEC);
      r.drop("docs/a.md");
      r.own.runEvent("t1", ends("u1"), T + 13 * SEC);
      r.later(10 * SEC);
      await r.look(fw);
      assert.equal(r.heardBy.length, 0);
      r.later(60 * SEC);
      await r.look(fw);
      r.drop("docs/b.md");
      r.later(10 * SEC);
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file removed in docs: b.md"]);
    } finally {
      fw.stop();
    }
  });

  test("a watcher that wakes a new chat hears what the chat that proposed it writes; a run's writes are none of its news", async () => {
    const r = rig("own-new");
    const a = r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.own.runEvent("t1", began("c1"), T + 10 * SEC);
      r.own.runEvent("t1", writes("w1", [a]), T + 11 * SEC);
      r.put("docs/a.md", "its chat's", T + 12 * SEC);
      r.own.runEvent("t1", ends("w1"), T + 13 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.deepEqual(r.summaries(), ["1 file changed in docs: a.md"], "it wakes no chat that wrote it");
      // Its own run's chat, as its row keeps it: a file it writes by name is no news.
      r.store.routineStarted("p1", "r1", { at: T + 20 * SEC, chain: "run1", by: "event", events: 1 });
      r.own.runEvent("t3", began("run1"), T + 30 * SEC);
      r.own.runEvent("t3", writes("w1", [a]), T + 31 * SEC);
      r.put("docs/a.md", "its run's", T + 32 * SEC);
      r.own.runEvent("t3", ends("w1"), T + 33 * SEC);
      r.later(20 * SEC);
      await r.look(fw);
      assert.equal(r.heardBy.length, 1);
    } finally {
      fw.stop();
    }
  });

  test("its trouble is set and cleared: its place gone, a walk that failed, too many files", async () => {
    const r = rig("trouble", { trigger: { kind: "file", glob: "*.md", place: "docs" }, opts: { max: 2 } });
    r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      assert.equal(r.row(), "");
      // Its place gone: said, and nothing told gone.
      r.drop("docs");
      r.later(10 * SEC);
      await r.look(fw);
      assert.deepEqual([r.row(), r.heardBy.length], ["docs is no folder on this machine now", 0]);
      assert.equal(r.store.get("p1").routines[0].seen?.trouble?.why, "docs is no folder on this machine now", "kept on its cursor");
      // Back: its trouble gone, and what is new there told.
      mkdirSync(join(r.dir, "docs"));
      r.later(10 * SEC);
      r.put("docs/a.md", "a again");
      r.put("docs/b.md", "b");
      await r.look(fw);
      assert.deepEqual([r.row(), r.summaries()], ["", ["1 added, 1 changed in docs: b.md, a.md"]]);
      // Past the most files it looks at: said, and it watches those.
      r.later(10 * SEC);
      r.put("docs/c.md", "c");
      r.put("docs/d.txt", "d");
      await r.look(fw);
      assert.equal(r.row(), "more than 2 files under docs: it watches the first 2, by their paths");
      r.drop("docs/d.txt");
      r.drop("docs/c.md");
      r.later(10 * SEC);
      await r.look(fw);
      assert.equal(r.row(), "");
    } finally {
      fw.stop();
    }
    // A walk that failed: its first line, until one goes well.
    let fails = 0;
    const f = rig("walk-failed", { opts: { walk: async (/** @type {string} */ place, /** @type {any} */ o) => (fails-- > 0 ? Promise.reject(Object.assign(new Error("EACCES: permission denied, scandir 'docs'\n    at somewhere"), { code: "EACCES" })) : walkFiles(place, o)) } });
    const fw2 = f.make();
    try {
      fw2.sync();
      await fw2.settled();
      // Both walks of a look fail; the look after it reads again.
      fails = 2;
      f.later(10 * SEC);
      await f.look(fw2);
      assert.equal(f.row(), "its folder could not be read: EACCES: permission denied, scandir 'docs'");
      await f.look(fw2);
      assert.equal(f.row(), "");
    } finally {
      fw2.stop();
    }
    // The most files it looks at, as its row says them of the project's own folder.
    const many = rig("many", { trigger: { kind: "file", glob: "*.md" }, opts: { walk: async () => ({ files: new Map(), over: true, rooted: true }) } });
    const fw3 = many.make();
    try {
      fw3.sync();
      await fw3.settled();
      assert.equal(many.row(), "more than 20,000 files under its project's folder: it watches the first 20,000, by their paths");
    } finally {
      fw3.stop();
    }
  });

  test("a hearing that throws is tried again, and its news is not lost", async () => {
    let fail = 1;
    const r = rig("throws", {
      heard: () => {
        if (fail-- > 0) throw new Error("the Space's file is locked");
      },
    });
    r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    try {
      fw.sync();
      await fw.settled();
      r.later(10 * SEC);
      r.put("docs/a.md", "aa");
      await r.look(fw);
      assert.equal(r.heardBy.length, 0);
      assert.ok(r.logged.some((m) => m.includes("the Space's file is locked")), r.logged.join("\n"));
      await until(() => r.heardBy.length === 1, "heard as it is tried again");
      assert.deepEqual(r.summaries(), ["1 file changed in docs: a.md"]);
    } finally {
      fw.stop();
    }
  });

  test("as the server makes it — fs.watch, the timers and the clock as they are: a file written is heard once its settle is over, its own chat's not", async () => {
    const dir = fresh("as-is");
    mkdirSync(join(dir, "docs"));
    const store = createSpaceStore({ dir: fresh("as-is-space") });
    const f = routineFields({ title: "Docs moved", text: "Read them.", trigger: { kind: "file", glob: "docs/*.md", settleSec: 2 }, wakes: "chat" }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    store.routinePropose("p1", f.fields, BY);
    store.routineOn("p1", "r1");
    const own = createOwnTimes();
    /** @type {any[]} */
    const heardBy = [];
    const fw = createFileWatch({
      store,
      own,
      heard: (project, id, events) => {
        const n = store.watchHeard(project, id, events);
        if (n) heardBy.push(...events);
        return n;
      },
      folderOf: () => dir,
      foldersOf: () => [dir],
      chatOf: (chain) => (chain === "c1" ? { run: false, folder: dir } : null),
      // Its walk comes each third of a second besides, so the test does not rest on what fs.watch says on this system.
      watch: (place, o) => watchFolder(place, { ...o, safetyMs: 300 }),
    });
    try {
      fw.sync();
      await fw.settled();
      const from = Date.now();
      // The chat it wakes writes one file by name; the person saves another beside it.
      own.runEvent("t1", began("c1"));
      own.runEvent("t1", writes("w1", [join(dir, "docs", "mine.md")]));
      writeFileSync(join(dir, "docs", "mine.md"), "the chat's");
      own.runEvent("t1", ends("w1"));
      writeFileSync(join(dir, "docs", "a.md"), "a");
      writeFileSync(join(dir, "docs", "notes.txt"), "no match");
      await until(() => heardBy.length === 1, "the file heard");
      assert.equal(heardBy[0].summary, "1 file added in docs: a.md");
      assert.ok(Date.now() - from >= 2000, "not before its files were still for its two seconds");
      await until(() => (store.get("p1").routines[0].seen?.fileAt ?? 0) >= from, "its look kept on its cursor");
    } finally {
      fw.stop();
    }
  });

  test("stop lets every folder go: no look, no hearing and no cursor after", async () => {
    const r = rig("stop");
    r.put("docs/a.md", "a", T - MIN);
    const fw = r.make();
    fw.sync();
    await fw.settled();
    fw.stop();
    assert.equal(fw.watched().size, 0);
    r.later(10 * SEC);
    r.put("docs/a.md", "aa");
    await r.look(fw);
    fw.sync();
    await fw.settled();
    assert.deepEqual([r.heardBy.length, r.w().seen?.fileAt, fw.watched().size], [0, T, 0]);
  });
});

describe("the store keeps when a file watcher last looked", () => {
  test("watchLooked: on its cursor, by the look it began from; let go under Pause all; no other kind's", () => {
    const clock = { at: T };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    /** @param {Record<string, unknown>} trigger */
    const on = (trigger) => {
      const f = routineFields({ title: `Of ${trigger.kind}`, text: "x", trigger }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const { id } = store.routinePropose("p1", f.fields, BY);
      store.routineOn("p1", id);
      return id;
    };
    const w = (/** @type {string} */ id) => /** @type {import("../src/core/routines.js").Routine} */ (store.get("p1").routines.find((r) => r.id === id));
    const id = on({ kind: "file", glob: "*.md" });
    assert.equal(store.watchLooked("p1", id, T + SEC, { from: T }), true);
    assert.deepEqual(w(id).seen, { from: T, at: null, ids: [], fileAt: T + SEC });
    assert.equal(store.watchLooked("p1", id, T + 2 * SEC, { from: T - 1 }), false, "a look begun before it was resumed keeps nothing");
    assert.equal(w(id).seen?.fileAt, T + SEC);
    // Its trouble stays beside it.
    store.watchTrouble("p1", id, "docs is no folder on this machine now");
    assert.equal(store.watchLooked("p1", id, T + 3 * SEC), true);
    assert.deepEqual([w(id).seen?.fileAt, w(id).seen?.trouble?.why], [T + 3 * SEC, "docs is no folder on this machine now"]);
    // Pause all: no look is kept, and what was kept is let go.
    store.pauseAll(true);
    assert.equal(store.watchLooked("p1", id, T + 4 * SEC), false);
    assert.equal(w(id).seen?.fileAt, T + 3 * SEC);
    assert.equal(store.watchLooked("p1", id, null), true);
    assert.equal(w(id).seen?.fileAt, undefined);
    store.pauseAll(false);
    // Paused, proposed: nothing kept.
    store.routinePause("p1", id, true);
    assert.equal(store.watchLooked("p1", id, T + 5 * SEC), false);
    const commit = on({ kind: "commit", branch: "main" });
    assert.throws(() => store.watchLooked("p1", commit, T), (/** @type {any} */ e) => e.status === 409 && e.message === "“Of commit” watches no folder's files.");
    const timed = store.routinePropose("p1", { title: "Brief", when: "daily 09:00", task: "x", writes: false }, BY);
    assert.throws(() => store.watchLooked("p1", timed.id, T), (/** @type {any} */ e) => e.status === 409 && e.message === "“Brief” watches no folder's files.");
  });
});

describe("an agent proposes a file watcher (the space tool)", () => {
  /** @param {any} r */
  const words = (r) => (r.ok ? r.text : r.error);
  const world = () => {
    const root = fresh("tool");
    mkdirSync(join(root, "packages", "app"), { recursive: true });
    const store = createSpaceStore({ dir: null, now: () => T });
    /** @type {import("../src/app/agent/space.js").SpaceAt} */
    const at = { store, project: "p1", chain: "c1", name: null, nameOf, placeIn: async (_p, place) => placeAmong([root], place) };
    return { root, store, at };
  };

  test("the guide's example proposes: kept as core reads it, its sheet's words the answer", async () => {
    const w = world();
    const call = JSON.parse(TRIGGER_GUIDE.file.call);
    assert.deepEqual(call.with.trigger, { kind: "file", glob: "docs/**/*.md" });
    const r = await spaceRun(call, w.at, T);
    assert.equal(r.ok, true, words(r));
    const kept = w.store.get("p1").routines[0];
    assert.deepEqual([kept.state, kept.trigger, kept.wakes, kept.title], ["proposed", { kind: "file", glob: "docs/**/*.md", on: ["added", "changed"], settleSec: 5 }, "new", "Docs moved"]);
    assert.ok(words(r).includes("Its sheet says to the person: “when files matching docs/**/*.md in the project's folder appear or change, wakes a new chat each time. Reads only:"), words(r));
  });

  test("its guide line says what it hears and what it never does", () => {
    const says = TRIGGER_GUIDE.file.says;
    for (const said of ["their names, never what they hold", "never files outside the project", "nor what the chat or run it wakes wrote itself", '"*.png" that folder\'s own files, "docs/**/*.md" at any depth', "unless the glob's first names lead there", ".git never", '["added","changed"] by default', "5 by default, 2 to 600"])
      assert.ok(says.includes(said), `${said}\n---\n${says}`);
    const guide = /** @type {any} */ (spaceGuide("routine")).text;
    assert.ok(guide.includes(`- ${TRIGGER_GUIDE.file.call}: ${says}`));
  });

  test("its place is fenced as a commit trigger's: a folder of the project, or refused in words; a glob that does not read is refused with the call that teaches", async () => {
    const w = world();
    /** @param {Record<string, unknown>} trigger @param {Record<string, unknown>} [o] */
    const propose = (trigger, o = {}) => spaceRun({ action: "routine", with: { title: "Files", text: "x", trigger: { kind: "file", ...trigger } } }, { ...w.at, ...o }, T);
    const outside = fresh("tool-outside");
    assert.deepEqual(await propose({ glob: "*.md", place: outside }), { ok: false, error: `Not written: place "${outside}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project's folder.` });
    assert.deepEqual(await propose({ glob: "*.md", place: "packages/nope" }), { ok: false, error: 'Not written: place "packages/nope" is no folder on this machine.' });
    assert.deepEqual(await propose({ glob: "*.md", place: "packages/app" }, { placeIn: undefined }), { ok: false, error: "Not written: a file watcher's place cannot be checked in this Filament: leave it out, and it watches the project's folder." });
    assert.equal(w.store.get("p1").routines.length, 0, "nothing kept of a refusal");
    const climbs = words(await propose({ glob: "../x/*.md" }));
    assert.ok(climbs.startsWith(`Not written: this watcher's trigger: glob "../x/*.md" climbs with "..": ${FORM}, and nothing above its folder. The call: `) && climbs.endsWith('{"action":"guide","topic":"routine"} gives every field.'), climbs);
    assert.equal((await propose({ glob: "*.md", place: "packages/app" })).ok, true);
    assert.deepEqual(w.store.get("p1").routines[0].trigger, { kind: "file", glob: "*.md", place: "packages/app", on: ["added", "changed"], settleSec: 5 }, "kept as it was named");
    // One that names no place watches the project's folder, and asks nothing of the fence.
    assert.equal((await propose({ glob: "*.md" }, { placeIn: undefined })).ok, true);
  });
});
