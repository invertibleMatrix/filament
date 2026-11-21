// @ts-check
// A name read from a file never becomes a path a folder is removed by (s-hands, the second read of 11-12, its item 18,
// the wider look). Beside a skill's books (skill-books-fence.test.js), three more names reached a recursive delete — or
// the folder a plugin is installed into — as their file had them: a listing of Anthropic's directory with no name both
// apps take fell back to its id, any text of Claude Code's cache file, and was installed under it; an installed
// plugin's id and version folders, as `plugins/installed.json` holds them; and a cloned skill's folder, as
// `skills/skills.json` holds it. Each is read by one rule now — the names Filament itself makes there — and what does
// not pass is not listed, said once in the log. Every folder here is a temp folder the test made.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directoryOf } from "../src/core/plugins.js";
import { createPluginSources } from "../src/app/plugin-sources.js";
import { createPlugins } from "../src/app/plugins.js";
import { createSkillStore } from "../src/app/skill-store.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-stored-names-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};
/** A folder with a folder and a file in it: what must still be there. @param {string} dir */
const victimAt = (dir) => {
  put(join(dir, "inner", "keep.txt"), "kept");
  return () => assert.equal(readFileSync(join(dir, "inner", "keep.txt"), "utf8"), "kept", "the folder outside and what it holds are still there");
};
/** A log that keeps its lines. */
const logOf = () => {
  /** @type {string[]} */
  const lines = [];
  return { lines, log: (/** @type {string} */ level, /** @type {string} */ msg) => void lines.push(`${level} ${msg}`) };
};

describe("Anthropic's directory: a listing is installed under a plugin's name or not at all", () => {
  const listing = (/** @type {Record<string, unknown>} */ over) => ({ summary: "x", source: { type: "directory", repository: { url: "https://github.com/o/r", reviewed_commit: "8ca22dba9a94f28898bbce59f2537ff4d87c747d" } }, ...over });
  const DIRECTORY = {
    fetchedAt: "2026-11-12T00:00:00.000Z",
    entryNames: { plugin_02: "linear", plugin_05: "../named/out" },
    listings: [
      listing({ id: "plugin_01", name: "Superpowers" }),
      listing({ id: "plugin_02", name: "Linear Issues" }),
      // No name of its own: its id is its name where that is one both apps take.
      listing({ id: "plugin_03", name: "" }),
      listing({ id: "../../../out", name: "" }),
      listing({ id: "..", name: "///" }),
      listing({ id: "C:\\out", name: "" }),
      listing({ id: "plugin_05", name: "" }),
    ],
  };

  // (fails before: yes — the listings named "../../../out", ".." and "C:\\out" were listed under those names)
  test("a listing with no name both apps take is left out, as a marketplace's entry is; an id that is one stands in for it", () => {
    const got = directoryOf(DIRECTORY);
    assert.ok(got.ok);
    assert.deepEqual(got.ok && got.listings.map((l) => [l.id, l.name]), [["plugin_01", "superpowers"], ["plugin_02", "linear"], ["plugin_03", "plugin_03"], ["plugin_05", "plugin_05"]]);
  });

  // (fails before: yes — `entry("directory", "../../../out")` answered an entry named "../../../out", and an install
  // of one so named made <data folder>/plugins/installed/../../../out@acme, outside Filament's plugins folder)
  test("the sources hand no such entry to an install, and the store installs under no name that is not a plugin's", async () => {
    const home = fresh("home");
    put(join(home, ".claude", "plugins", "plugin-directory-cache-v2.json"), DIRECTORY);
    const sources = createPluginSources({ dataDir: fresh("data"), home });
    assert.equal(sources.entry("directory", "plugin_03").entry.name, "plugin_03");
    for (const name of ["../../../out", "..", "C:\\out"]) assert.throws(() => sources.entry("directory", name), (/** @type {any} */ e) => e.status === 404 && /lists no plugin/.test(e.message), name);
    // Whatever a source hands over: a stand-in that names an entry as the directory did.
    const root = fresh("root");
    const dataDir = join(root, "a", "b", "data");
    mkdirSync(dataDir, { recursive: true });
    const from = fresh("src");
    put(join(from, ".claude-plugin", "plugin.json"), { name: "x", version: "1.0.0" });
    /** @param {string} entryName @param {string} marketName */
    const standIn = (entryName, marketName) => ({ entry: () => ({ market: { id: "claude/acme", name: marketName, title: "Acme" }, entry: { name: entryName, title: "Out", description: "", version: "", category: "", author: "", homepage: "", source: { kind: "path", path: from } } }) });
    for (const [entryName, marketName] of [["../../../out", "acme"], ["x", "../../acme"], ["x@y", "acme"], [" x", "acme"]]) {
      const p = createPlugins({ dataDir, sources: /** @type {any} */ (standIn(entryName, marketName)) });
      await assert.rejects(p.install({ from: "claude/acme", name: entryName }), (/** @type {any} */ e) => e.status === 400 && /name/.test(e.message), `${entryName}@${marketName}`);
      assert.deepEqual(p.list(), []);
    }
    assert.deepEqual(readdirSync(join(root, "a")), ["b"], "nothing was made outside the data folder");
    assert.deepEqual(readdirSync(join(root, "a", "b")), ["data"]);
    // A plugin's own name installs as before.
    const ok = createPlugins({ dataDir, sources: /** @type {any} */ (standIn("x", "acme")) });
    assert.equal((await ok.install({ from: "claude/acme", name: "x" })).id, "x@acme");
  });
});

describe("plugins/installed.json: an installed plugin's id and version folders are names Filament makes", () => {
  const rec = (/** @type {Record<string, unknown>} */ over) => ({ id: "x@acme", name: "x", marketplace: "acme", from: "claude/acme", source: { kind: "path", path: "/nowhere" }, origin: "Acme", kind: "claude", title: "X", description: "", version: "1.0.0", sha: "", folder: "1.0.0", at: 1, updated: 1, checked: 1, pending: null, ...over });
  const noSources = /** @type {any} */ ({ entry: () => { throw Object.assign(new Error("none"), { status: 404 }); } });

  // (fails before: yes — as the store started, the record whose id is "../../victim" had every folder in
  // <data folder>/victim removed as "a version folder no record names any more": keep.txt was gone)
  test("a record whose id is a path is not listed, and nothing is removed by it: as the store starts, by Uninstall, with its data folder", () => {
    const dataDir = fresh("data");
    const stands = victimAt(join(dataDir, "victim"));
    put(join(dataDir, "plugins", "installed", "x@acme", "1.0.0", ".claude-plugin", "plugin.json"), { name: "x", version: "1.0.0" });
    put(join(dataDir, "plugins", "installed.json"), { version: 1, plugins: [rec({}), rec({ id: "../../victim" }), rec({ id: "..", name: "up" }), rec({ id: "x@acme@more" }), rec({ id: "y@acme/../../../victim" })] });
    const { lines, log } = logOf();
    const p = createPlugins({ dataDir, sources: noSources, log });
    stands();
    assert.deepEqual(p.list().map((x) => x.id), ["x@acme"], "the list shows only the plugin Filament installed");
    for (const id of ["../../victim", "..", "y@acme/../../../victim"]) assert.throws(() => p.uninstall(id, { data: true }), (/** @type {any} */ e) => e.status === 404, id);
    stands();
    p.list();
    const said = lines.filter((l) => /installed\.json/.test(l));
    assert.equal(said.length, 4, `each said once, however often the list is read: ${said.join(" | ")}`);
    assert.match(said[0], /^warn plugins: /);
    assert.ok(said[0].includes(JSON.stringify("../../victim")));
    // The real one goes as before.
    assert.equal(p.uninstall("x@acme").id, "x@acme");
    assert.ok(!existsSync(join(dataDir, "plugins", "installed", "x@acme")));
    stands();
  });

  // (fails before: yes — both were listed: the version folder "../../../victim" was the plugin's root, read from and
  // removed by an update; a waiting update's folder was removed at the next check)
  test("a record whose version folder — its own, or a waiting update's — is a path is not listed", () => {
    const dataDir = fresh("data2");
    const stands = victimAt(join(dataDir, "victim"));
    put(join(dataDir, "plugins", "installed.json"), {
      version: 1,
      plugins: [
        rec({ id: "a@acme", folder: "../../../victim" }),
        rec({ id: "b@acme", pending: { folder: "../../../victim", version: "2", sha: "", words: "", at: 1 } }),
        rec({ id: "c@acme", folder: ".." }),
        rec({ id: "d@acme", folder: "1.0.0-abc123def456", pending: { folder: "_2.0.0-e12345678", version: "2", sha: "", words: "", at: 1 } }),
      ],
    });
    const p = createPlugins({ dataDir, sources: noSources });
    assert.deepEqual(p.list().map((x) => x.id), ["d@acme"]);
    for (const id of ["a@acme", "b@acme", "c@acme"]) assert.throws(() => p.update(id), (/** @type {any} */ e) => e.status === 404, id);
    stands();
  });
});

describe("skills/skills.json: a cloned skill's folder is a name Filament makes", () => {
  // (fails before: yes — Remove of the skill whose record says repo "../../victim" removed <data folder>/victim whole:
  // { removed: "up", files: true })
  test("a record whose clone is a path is not listed, and Remove by its name finds none; the folder that holds every made skill is no skill's to remove", () => {
    const dataDir = fresh("skills");
    const stands = victimAt(join(dataDir, "victim"));
    const { lines, log } = logOf();
    const store = createSkillStore({ dataDir, home: fresh("home2"), env: {}, log });
    const mine = store.make({ name: "mine", description: "x" });
    const clone = join(dataDir, "skills", "git", "repo-abc123");
    put(join(clone, "SKILL.md"), "---\nname: cloned\ndescription: x\n---\nBody.\n");
    const list = JSON.parse(readFileSync(join(dataDir, "skills", "skills.json"), "utf8"));
    const git = (/** @type {string} */ name, /** @type {unknown} */ repo) => ({ name, kind: "git", from: "git", path: clone, at: 1, repo, url: "https://example.invalid/r.git", ref: "", sha: "" });
    put(join(dataDir, "skills", "skills.json"), { ...list, skills: [...list.skills, git("cloned", "repo-abc123"), git("up", "../../victim"), git("dots", ".."), git("abs", join(dataDir, "victim")), git("deep", "repo-abc123/../../../victim"), { name: "root", kind: "made", from: "made", path: join(dataDir, "skills", "made"), at: 1 }] });
    assert.deepEqual(store.list().map((s) => s.name).sort(), ["cloned", "mine", "root"]);
    for (const name of ["up", "dots", "abs", "deep"]) assert.throws(() => store.remove(name), (/** @type {any} */ e) => e.status === 404, name);
    stands();
    store.list();
    const said = lines.filter((l) => /skills\.json/.test(l));
    assert.equal(said.length, 4, `each said once: ${said.join(" | ")}`);
    assert.match(said[0], /^warn skills: /);
    // A made record that names the folder of every made skill removes none of them.
    assert.deepEqual(store.remove("root"), { removed: "root", files: false });
    assert.ok(existsSync(join(mine.path, "SKILL.md")), "another made skill stands");
    // The real ones go as before, with their files.
    assert.deepEqual(store.remove("cloned"), { removed: "cloned", files: true });
    assert.ok(!existsSync(clone));
    assert.deepEqual(store.remove("mine"), { removed: "mine", files: true });
    stands();
  });

  // (fails before: yes — the record "deep", whose folder lies below a link in skills/made, had what the link leads to
  // removed: { removed: "deep", files: true }, and keep.txt outside was gone)
  test("a made skill's folder is removed as the filesystem resolves the folder it is in: a link among its parents removes nothing outside; a link that is the folder itself goes as a link", () => {
    const dataDir = fresh("skills-linked");
    const outside = fresh("outside");
    const stands = victimAt(outside);
    const { lines, log } = logOf();
    const store = createSkillStore({ dataDir, home: fresh("home3"), env: {}, log });
    const made = join(dataDir, "skills", "made");
    // A link among its parents: skills/made/a leads outside, and the record names skills/made/a/inner.
    const first = store.make({ name: "first", description: "x" });
    symlinkSync(outside, join(made, "a"), "junction");
    const list = JSON.parse(readFileSync(join(dataDir, "skills", "skills.json"), "utf8"));
    put(join(dataDir, "skills", "skills.json"), { ...list, skills: [...list.skills, { name: "deep", kind: "made", from: "made", path: join(made, "a", "inner"), at: 1 }] });
    assert.deepEqual(store.remove("deep"), { removed: "deep", files: false });
    stands();
    assert.ok(lines.some((l) => /^warn skills: deep's folder/.test(l) && !/a program holds/.test(l)), `said as what it is: ${lines.join(" | ")}`);
    // The folder itself a link: the link goes, what it leads to stays — as before.
    rmSync(first.path, { recursive: true, force: true });
    symlinkSync(outside, first.path, "junction");
    assert.deepEqual(store.remove("first"), { removed: "first", files: true });
    assert.ok(!existsSync(first.path), "the link went");
    stands();
  });
});
