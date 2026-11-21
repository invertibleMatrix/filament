// @ts-check
// A skill's books name nothing outside its folder (s-hands, the second read of 11-12, its item 18). A skill's
// `.library/books.json` is not always Filament's own words: a skill's folder comes from anywhere — a plugin, a
// repository, a folder a person copied in — and `PUT /skills/<name>/file` wrote any file of a made skill's folder, that
// one too. A book's id went into `references/<id>` unchecked, so "remove this book" deleted a folder of the manifest's
// choosing, and a part's file was read into the index from wherever it pointed. Now a book is listed only where its
// id, its original and its parts' files are the names the library makes; a remove or an add goes through no link out
// of the skill's folder; and the file route writes nothing under `.library`. Every folder here is a temp folder the
// test made.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { booksIn, createSkillLibrary, findInLibrary } from "../src/app/skill-library.js";
import { createSkillStore } from "../src/app/skill-store.js";
import { craftAtOf, craftCall } from "../src/app/agent/craft-tool.js";
import { startApp } from "./helpers/app.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";

/** A manifest's book as `add` writes one, with what a test changes. @param {Record<string, unknown>} over */
const bookOf = (over) => ({ id: "x", title: "x", name: "x.md", source: "sources/x.md", kind: "md", pages: null, files: 1, split: "whole", parts: [], noText: [], at: 1, ...over });
/** A skill's manifest as it stands on disk. @param {string} dir */
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, ".library", "books.json"), "utf8"));
/** Books put into a skill's manifest beside those it holds, as a folder from elsewhere carries them. @param {string} dir @param {any[]} books */
const plant = (dir, books) => {
  let doc = { version: 1, books: /** @type {any[]} */ ([]) };
  try {
    doc = manifestOf(dir);
  } catch {}
  mkdirSync(join(dir, ".library"), { recursive: true });
  writeFileSync(join(dir, ".library", "books.json"), JSON.stringify({ ...doc, books: [...doc.books, ...books] }));
};
/** A path as a manifest would say it from `from`: with forward slashes. @param {string} from @param {string} to */
const pathTo = (from, to) => relative(from, to).split("\\").join("/");

describe("a skill's books, by the library", () => {
  /** @type {string} */
  let root;
  /** A folder outside every skill, with a file in it: what must still be there. @type {string} */
  let victim;
  /** @type {string[]} */
  const logs = [];
  const lib = createSkillLibrary({ now: () => 1, log: (level, msg) => void logs.push(`${level} ${msg}`) });
  /** A skill's folder under the root, with one real book, `guide`. @param {string} name */
  const skillWithGuide = async (name) => {
    const dir = join(root, "made", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\nLook it up.\n`);
    const r = await lib.add(dir, name, { paths: [join(root, "guide.md")] });
    assert.deepEqual(r.added.map((b) => b.id), ["guide"]);
    return dir;
  };
  const victimStands = () => assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept", "the folder outside and its file are still there");

  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-books-fence-"));
    victim = join(root, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "kept");
    writeFileSync(join(victim, "01-secret.md"), "# Secret\n\nFrom outside\n\nThe zanzibar passphrase is kept outside every skill.\n");
    writeFileSync(join(root, "guide.md"), "# Tilemaps\nA tilemap holds tiles on a grid.\n");
    writeFileSync(join(root, "rules.md"), "# Rule tiles\nA rule tile picks its sprite by its neighbours.\n");
  });
  after(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // (fails before: yes — `booksIn` listed the book whose id is a path, and `remove` by that id answered
  // { removed: "evil.md" } with the folder outside and its file gone: "the folder outside and its file are still there"
  // threw ENOENT)
  test("a book whose id is a path is not listed, a remove by it finds none and deletes nothing; the real book beside it goes alone; said once in the log", async () => {
    const dir = await skillWithGuide("tiles");
    const evil = pathTo(join(dir, "references"), victim);
    assert.match(evil, /^(\.\.\/)+victim$/);
    plant(dir, [bookOf({ id: evil, name: "evil.md" })]);
    assert.deepEqual(booksIn(dir).map((b) => b.id), ["guide"], "the list shows only the real book");
    assert.deepEqual(lib.books(dir).map((b) => b.id), ["guide"]);
    await assert.rejects(lib.remove(dir, "tiles", evil), (/** @type {any} */ e) => e.status === 404 && /tiles's books hold none called/.test(e.message));
    victimStands();
    const gone = await lib.remove(dir, "tiles", "guide");
    assert.deepEqual([gone.removed, gone.books], ["guide.md", []]);
    victimStands();
    assert.ok(!existsSync(join(dir, "references", "guide")), "the real book's parts went");
    const said = logs.filter((l) => /books\.json/.test(l) && l.includes("tiles's"));
    assert.equal(said.length, 1, `said once, however often it is read: ${said.join(" | ")}`);
    assert.match(said[0], /^warn skills: tiles's /);
    assert.ok(said[0].includes(JSON.stringify(evil.slice(0, 64))), "with the id's start");
  });

  // (fails before: yes — each of these was listed as a book)
  test("what an id is: one plain name as the library makes them; a path, a dot name, another case, a drive, a stream, a long one are none — and no more than 64 characters of one reach the log", () => {
    const dir = join(root, "made", "ids");
    mkdirSync(dir, { recursive: true });
    const long = `${"a".repeat(70)}/../../x`;
    const bad = ["..", ".", "", "../x", "a/b", "a\\b", "C:x", "/abs", "Guide", "guide.", "guide ", "gui de", "guide::$DATA", "GUIDE~1", "a--b", "-a", "a-", "a".repeat(65), long];
    plant(dir, [...bad.map((id) => bookOf({ id })), bookOf({ id: "part" }), bookOf({ id: "unity-2d-sprites-2" }), bookOf({ id: "a".repeat(64) })]);
    assert.deepEqual(booksIn(dir).map((b) => b.id), ["part", "unity-2d-sprites-2", "a".repeat(64)]);
    const said = logs.filter((l) => l.includes("ids's"));
    assert.ok(said.length >= 1);
    for (const l of said) assert.ok(!l.includes("a".repeat(65)), "an id's first 64 characters at most");
  });

  // (fails before: yes — both were listed, and a find built the index from the file outside: its first hit was
  // "The zanzibar passphrase is kept outside every skill.")
  test("a book whose original or whose part's file is a path is not listed: nothing outside is read into the index, and nothing outside is removed", async () => {
    const dir = await skillWithGuide("reads");
    const out = pathTo(dir, join(victim, "01-secret.md"));
    plant(dir, [
      bookOf({ id: "leak", name: "leak.md", parts: [{ file: out, title: "Secret", pages: null, chars: 10 }] }),
      bookOf({ id: "other", name: "other.md", parts: [{ file: "references/guide/01-the-whole-text.md", title: "Another book's part", pages: null, chars: 10 }] }),
      bookOf({ id: "abs", name: "abs.md", parts: [{ file: join(victim, "01-secret.md"), title: "Secret", pages: null, chars: 10 }] }),
      bookOf({ id: "src", name: "src.md", source: pathTo(dir, victim) }),
      bookOf({ id: "src2", name: "src2.md", source: "sources/../../../victim" }),
      bookOf({ id: "src3", name: "src3.md", source: "sources" }),
      bookOf({ id: "nopart", name: "nopart.md", parts: [null] }),
    ]);
    assert.deepEqual(booksIn(dir).map((b) => b.id), ["guide"]);
    rmSync(join(dir, ".library", "index.sqlite"), { force: true });
    assert.deepEqual(findInLibrary(dir, "zanzibar passphrase")?.hits, [], "the file outside is no part of any book");
    assert.equal(findInLibrary(dir, "tilemap grid")?.hits[0].file, "references/guide/01-the-whole-text.md", "the real book is found as before");
    for (const id of ["leak", "src", "src2", "src3"]) await assert.rejects(lib.remove(dir, "reads", id), (/** @type {any} */ e) => e.status === 404);
    victimStands();
    assert.ok(existsSync(join(dir, "sources", "guide.md")), "the skill's own sources folder stands");
  });

  // (fails before: yes — `remove` deleted <victim>/guide through the link, and `add` wrote a book's parts into the
  // folder outside)
  test("the second fence: where a link in the skill's folder leads out of it, a remove and an add go through nothing — refused in words, the list as it was", async () => {
    const dir = join(root, "made", "linked");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(victim, "guide"));
    writeFileSync(join(victim, "guide", "01-tilemaps.md"), "theirs");
    // The skill's `references` is a link to the folder outside (a junction on Windows, which needs no privilege).
    symlinkSync(victim, join(dir, "references"), "junction");
    mkdirSync(join(dir, "sources"));
    writeFileSync(join(dir, "sources", "guide.md"), "the copy");
    plant(dir, [bookOf({ id: "guide", name: "guide.md", source: "sources/guide.md", parts: [{ file: "references/guide/01-tilemaps.md", title: "Tilemaps", pages: null, chars: 6 }] })]);
    assert.deepEqual(booksIn(dir).map((b) => b.id), ["guide"], "its names are plain: it is listed");
    await assert.rejects(lib.remove(dir, "linked", "guide"), (/** @type {any} */ e) => e.status === 409 && /link/.test(e.message) && /linked/.test(e.message));
    assert.equal(readFileSync(join(victim, "guide", "01-tilemaps.md"), "utf8"), "theirs", "nothing was removed through the link");
    assert.equal(readFileSync(join(dir, "sources", "guide.md"), "utf8"), "the copy", "nor the half of it that lies inside");
    assert.deepEqual(booksIn(dir).map((b) => b.id), ["guide"], "the list as it was");
    const before = readdirSync(victim).sort();
    const r = await lib.add(dir, "linked", { paths: [join(root, "rules.md")] });
    assert.deepEqual([r.added, r.skipped.map((s) => s.name)], [[], ["rules.md"]]);
    assert.match(r.skipped[0].why, /link/);
    assert.deepEqual(readdirSync(victim).sort(), before, "nothing was written through the link");
    assert.ok(!existsSync(join(dir, "sources", "rules.md")), "nor its copy kept");
    // A find reads no part through the link either.
    rmSync(join(dir, ".library", "index.sqlite"), { force: true });
    assert.deepEqual(findInLibrary(dir, "theirs")?.hits, []);
    victimStands();
  });
});

describe("the crafter's write, by the store", () => {
  /** @type {string} */
  let dataDir;
  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), "filament-books-craft-"));
  });
  after(() => rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  // (fails before: yes — the tool's own check reads the path's start, so "./.library/books.json" passed it and the
  // store wrote the file: { ok: true, text: "Wrote ./.library/books.json in grids (1 line)." })
  test("skill_craft write puts nothing under .library by any spelling of it: the store refuses what the tool's own check lets by", async () => {
    const store = createSkillStore({ dataDir });
    const made = store.make({ name: "grids", description: "Grids" });
    /** @type {any} */
    const deps = { of: () => ({ skill: "grids" }), dirOf: () => made.path, text: () => "", write: (/** @type {string} */ n, /** @type {string} */ p, /** @type {string} */ t) => void store.writeFile(n, p, t) };
    const at = /** @type {any} */ (craftAtOf(deps, "c1"));
    for (const path of ["./.library/books.json", "references/../.library/books.json", ".LIBRARY/books.json", ".library./books.json"]) {
      const got = /** @type {any} */ (await craftCall({ action: "write", path, text: "{}" }, at));
      assert.equal(got.ok, false, path);
      assert.match(got.error, /^Not done: only Filament writes a skill's \.library folder/, path);
    }
    assert.ok(!existsSync(join(made.path, ".library")), "nothing was written there");
    assert.deepEqual(await craftCall({ action: "write", path: ".library/books.json", text: "{}" }, at), { ok: false, error: "Its library is Filament's to write: add books with books." }, "the tool's own words where its own check reads it");
    assert.equal((/** @type {any} */ (await craftCall({ action: "write", path: "references/notes.md", text: "mine" }, at))).ok, true, "a file of the skill's own is written as before");
    assert.equal(readFileSync(join(made.path, "references", "notes.md"), "utf8"), "mine");
  });
});

describe("a skill's books, through Filament", () => {
  const KEY = randomBytes(32).toString("base64url");
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let victim;
  /**
   * A request over node:http with no inbound key and no press key unless the test sets one: this computer's caller.
   * @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
   * @returns {Promise<{ status: number, json: any, text: string }>}
   */
  const call = (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const text = body === undefined ? "" : JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port: shim.port, path, method, headers: { host: `127.0.0.1:${shim.port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
      req.on("response", (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {}
          resolve({ status: Number(res.statusCode), json, text: b });
        });
      });
      req.on("error", reject);
      req.end(text || undefined);
    });
  const victimStands = () => assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept", "the folder outside and its file are still there");

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-books-route-"));
    victim = join(root, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "kept");
    shim = await startApp();
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  for (const held of [true, false])
    // (fails before: yes — the PUT of .library/books.json answered 200, and the DELETE by the id that is a path
    // answered 200 { removed: "evil.md" } with the folder outside gone)
    test(`${held ? "while the app holds its key, a caller without it" : "with no key held, this computer's caller"}: the file route writes nothing under .library, and a manifest that names a folder outside deletes nothing`, async () => {
      setPressKey(held ? KEY : "");
      const name = held ? "tiles" : "grids";
      const S = `/api/skills/${name}`;
      assert.equal((await call("/api/skills", { method: "POST", body: { make: name, description: "x" } })).status, 200);
      const sent = await call(`${S}/books`, { method: "POST", body: { files: [{ name: "guide.md", data: Buffer.from("# Tilemaps\nA tilemap holds tiles on a grid.").toString("base64") }] } });
      assert.deepEqual(sent.json?.added?.map((/** @type {any} */ b) => b.id), ["guide"], sent.text);
      const dir = String((await call(S)).json.path);
      const evil = pathTo(join(dir, "references"), victim);
      const planted = JSON.stringify({ version: 1, books: [...manifestOf(dir).books, bookOf({ id: evil, name: "evil.md" })] });

      // The file route: Filament's own record of the skill is the library's to write.
      const was = readFileSync(join(dir, ".library", "books.json"), "utf8");
      for (const path of [".library/books.json", "./.library/books.json", ".library\\books.json", ".LIBRARY/books.json", "references/../.library/books.json", ".library/crafter.json", ".library/from-memory.json", ".library/new/x.md", ".library./books.json", ".library"]) {
        const r = await call(`${S}/file`, { method: "PUT", body: { path, text: planted } });
        assert.equal(r.status, 400, `${path}: ${r.text}`);
        assert.match(String(r.json?.error), /\.library/, path);
      }
      assert.equal(readFileSync(join(dir, ".library", "books.json"), "utf8"), was, "the manifest as the library wrote it");
      assert.deepEqual(readdirSync(join(dir, ".library")).sort(), ["books.json", "index.sqlite"]);
      // The skill's own files are written as before, with the key and without it.
      assert.equal((await call(`${S}/file`, { method: "PUT", body: { path: "references/notes.md", text: "mine" } })).status, 200);
      assert.equal((await call(`${S}/file`, { method: "PUT", headers: { [PRESS_HEADER]: KEY }, body: { path: "SKILL.md", text: `---\nname: ${name}\ndescription: y\n---\nBody.` } })).status, 200);
      assert.equal((await call(`${S}/file?path=.library/books.json`)).status, 200, "reading stays as it was");

      // A folder from elsewhere carries its manifest: written on disk, as no route writes it now.
      writeFileSync(join(dir, ".library", "books.json"), planted);
      assert.deepEqual((await call(S)).json.books.map((/** @type {any} */ b) => b.name), ["guide.md"], "the list shows only the real book");
      const byPath = await call(`${S}/books/${encodeURIComponent(evil)}`, { method: "DELETE" });
      assert.equal(byPath.status, 404, byPath.text);
      victimStands();
      const real = await call(`${S}/books/guide`, { method: "DELETE" });
      assert.deepEqual([real.status, real.json?.removed, real.json?.books], [200, "guide.md", []], real.text);
      victimStands();
      assert.equal((await call(S, { method: "DELETE" })).status, 200);
      victimStands();
    });
});
