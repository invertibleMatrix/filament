// @ts-check
// HarnessV4_Skills_Plan S1-6 — your skills in Filament: found on this computer per agent, added where they stand, from a
// git address (cloned into the data folder), made here; removed with the files Filament holds only; and `into` handing a
// chat's settings the files of the skills on there.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillStore, skillFoldersUnder } from "../src/app/skill-store.js";

/** A temporary home with Claude Code's, Codex's and Cursor's skill folders, a data folder and a shipped folder. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "filament-skillstore-"));
  const put = (/** @type {string} */ rel, /** @type {string} */ text) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const skill = (/** @type {string} */ rel, /** @type {string} */ name, /** @type {string} */ description) => put(`${rel}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\n---\nDo it well.`);
  skill("home/.claude/skills/synced/abc_def/pdf", "pdf", "Read and fill PDFs");
  skill("home/.claude/skills/synced/abc_def/docx", "docx", "Word documents");
  skill("home/.claude/skills/.trash/123/pdf", "pdf", "an old one");
  skill("home/.codex/skills/.system/imagegen", "imagegen", "Codex's own");
  skill("home/.agents/skills/ui", "ui", "Unity UI");
  skill("home/.agents/skills/localization", "Localization Tables", "Unity strings");
  skill("home/.cursor/skills/dashboards", "dashboards", "GA dashboards");
  skill("proj/.claude/skills/release", "release", "Ship it");
  skill("mine/books", "books", "My library");
  skill("shipped/opus-rules", "opus-rules", "How Opus works");
  put("mine/empty/README.md", "nothing");
  const store = (/** @type {any} */ o = {}) => createSkillStore({ dataDir: join(root, "data"), shippedDir: join(root, "shipped"), home: join(root, "home"), env: {}, now: () => 1000, ...o });
  return { root, store, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe("the skill store (S1-6)", () => {
  test("found: per agent, hidden folders left out, synced skills three down, a project's own; a name Filament refuses is made one", () => {
    const w = world();
    const s = w.store();
    const found = s.found({ cwd: join(w.root, "proj") });
    assert.deepEqual(found.map((a) => [a.agent, a.skills.map((x) => x.name)]), [
      ["claude-code", ["docx", "pdf", "release"]],
      ["codex", ["localization-tables", "ui"]],
      ["cursor", ["dashboards"]],
    ]);
    assert.equal(found[0].skills[0].description, "Word documents");
    assert.deepEqual(found.map((a) => a.where), [[join("~", ".claude", "skills"), join(w.root, "proj", ".claude", "skills")], [join("~", ".agents", "skills")], [join("~", ".cursor", "skills")]], "the folders that hold them, from the home folder");
    assert.ok(found.every((a) => a.skills.every((x) => !x.added && !x.clash)));
    w.done();
  });

  test("addPaths: a skill folder is one, a folder of them each; where it came from by the agent's folders; one kept or a name taken is skipped with why", () => {
    const w = world();
    const s = w.store();
    const r = s.addPaths({ paths: [join(w.root, "home/.claude/skills"), join(w.root, "mine/books"), join(w.root, "mine/empty"), join(w.root, "nope")] });
    assert.deepEqual(r.added.map((x) => [x.name, x.kind, x.from, x.fromWords]), [
      ["docx", "linked", "claude-code", "Claude Code"],
      ["pdf", "linked", "claude-code", "Claude Code"],
      ["books", "linked", "folder", "a folder"],
    ]);
    assert.deepEqual(r.skipped.map((x) => x.why), ["no SKILL.md in it or the folders under it", "not a folder on this computer"]);
    // Again: kept already. A Codex skill named as one of yours: its name is taken.
    const again = s.addPaths({ paths: [join(w.root, "mine/books")] });
    assert.deepEqual(again.skipped.map((x) => x.why), ["already in your skills"]);
    mkdirSync(join(w.root, "home/.agents/skills/pdf"), { recursive: true });
    writeFileSync(join(w.root, "home/.agents/skills/pdf/SKILL.md"), "---\nname: pdf\n---\nx");
    assert.deepEqual(s.addPaths({ paths: [join(w.root, "home/.agents/skills/pdf")] }).skipped.map((x) => x.why), ["you have a skill named pdf already, from Claude Code"]);
    // Found now says which are yours and which would clash.
    const codex = s.found().find((a) => a.agent === "codex");
    assert.deepEqual(codex?.skills.map((x) => [x.name, x.added, x.clash]), [["localization-tables", false, null], ["pdf", false, "pdf"], ["ui", false, null]]);
    assert.equal(s.found()[0].skills.find((x) => x.name === "pdf")?.added, true);
    // The list: yours, then Filament's own.
    assert.deepEqual(s.list().map((x) => [x.name, x.kind, x.description]), [
      ["docx", "linked", "Word documents"],
      ["pdf", "linked", "Read and fill PDFs"],
      ["books", "linked", "My library"],
      ["opus-rules", "shipped", "How Opus works"],
    ]);
    w.done();
  });

  test("make, get, readFile, writeFile, remove: a made skill's files are Filament's; a linked one's folder stays; a shipped one is not removed", () => {
    const w = world();
    const s = w.store();
    const made = s.make({ name: "game-rules", description: "How the game is played" });
    assert.equal(made?.kind, "made");
    assert.match(readFileSync(join(w.root, "data/skills/made/game-rules/SKILL.md"), "utf8"), /^---\nname: game-rules\ndescription: How the game is played\n---/);
    assert.throws(() => s.make({ name: "game-rules" }), /already/);
    assert.throws(() => s.make({ name: "bad name" }), /letters, digits/);
    assert.throws(() => s.make({ name: "opus-rules" }), /already/, "a shipped name is taken");
    s.writeFile("game-rules", "references/01-intro.md", "# Intro\nThe board.");
    assert.throws(() => s.writeFile("game-rules", "../escape.md", "x"), /own folder/);
    const one = s.get("GAME-RULES");
    assert.deepEqual(one.files.map((f) => [f.path, f.dir]), [["references", true], ["references/01-intro.md", false], ["SKILL.md", false]]);
    assert.equal(s.readFile("game-rules", "references/01-intro.md").text, "# Intro\nThe board.");
    assert.throws(() => s.readFile("game-rules", "../../skills.json"), /own folder/);
    s.addPaths({ paths: [join(w.root, "mine/books")] });
    assert.throws(() => s.writeFile("books", "x.md", "x"), /Only a skill made in Filament/);
    assert.deepEqual(s.remove("books"), { removed: "books", files: false });
    assert.ok(existsSync(join(w.root, "mine/books/SKILL.md")), "a folder read where it stands stays");
    assert.deepEqual(s.remove("game-rules"), { removed: "game-rules", files: true });
    assert.ok(!existsSync(join(w.root, "data/skills/made/game-rules")));
    assert.throws(() => s.remove("opus-rules"), /comes with Filament/);
    assert.throws(() => s.remove("nope"), /no skill named nope/);
    w.done();
  });

  // (fails before: yes — the bug hunt of 10-30, ADM-7: the fence was the path's words alone, so a link in a skill's folder
  // had a file read and written wherever the link led; and a write named CON made a file of a name Windows keeps for a
  // device, which its apps neither open nor remove)
  test("a link in a skill's folder that leads out of it reads and writes nothing there; one that stays inside is the folder's own; a name Windows keeps for a device is not written", () => {
    const w = world();
    const s = w.store();
    s.make({ name: "linked-out", description: "x" });
    const made = join(w.root, "data/skills/made/linked-out");
    const outside = join(w.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "not the skill's");
    // Junctions: Windows makes one without the right a symbolic link needs; elsewhere it is a link to a folder.
    symlinkSync(outside, join(made, "refs"), "junction");
    s.addPaths({ paths: [join(w.root, "mine/books")] });
    symlinkSync(outside, join(w.root, "mine/books/refs"), "junction");
    const outWords = (/** @type {any} */ e) => e.status === 400 && /a link in it leads out of it$/.test(e.message);
    assert.throws(() => s.readFile("books", "refs/secret.txt"), outWords);
    assert.equal(s.readFile("books", "SKILL.md").text, "---\nname: books\ndescription: My library\n---\nDo it well.", "its own files read as before");
    assert.throws(() => s.writeFile("linked-out", "refs/planted.md", "x"), outWords);
    assert.throws(() => s.writeFile("linked-out", "refs/new/deeper.md", "x"), outWords, "nor a folder made through it");
    assert.deepEqual(readdirSync(outside), ["secret.txt"], "nothing written where the link leads");
    mkdirSync(join(made, "real"));
    symlinkSync(join(made, "real"), join(made, "alias"), "junction");
    s.writeFile("linked-out", "alias/inner.md", "kept");
    assert.equal(s.readFile("linked-out", "alias/inner.md").text, "kept");
    if (process.platform === "win32") {
      for (const name of ["CON", "nul.md", "notes/COM1.txt", "Aux", "con .md"])
        assert.throws(() => s.writeFile("linked-out", name, "x"), (/** @type {any} */ e) => e.status === 400 && / is a name Windows keeps for a device: name the file otherwise$/.test(e.message), name);
      assert.deepEqual(readdirSync(made).filter((n) => /^(con|nul|aux|notes)/i.test(n)), [], "no such file or folder was made");
      s.writeFile("linked-out", "console.md", "a name that only starts like one");
      assert.equal(s.readFile("linked-out", "console.md").text, "a name that only starts like one");
    }
    w.done();
  });

  test("addGit: cloned into the data folder, each skill in it added; one with none refused and its clone gone; update moves them together; remove takes the clone with the last", async () => {
    const w = world();
    /** @type {string[][]} */
    const calls = [];
    let sha = "a".repeat(40);
    let holds = true;
    /** @type {any} */
    const git = async (/** @type {string[]} */ args, /** @type {any} */ o) => {
      calls.push(args);
      if (args[0] === "clone") {
        const dir = String(args.at(-1));
        if (holds) for (const n of ["alpha", "beta"]) {
          mkdirSync(join(dir, "skills", n), { recursive: true });
          writeFileSync(join(dir, "skills", n, "SKILL.md"), `---\nname: ${n}\n---\nx`);
        } else mkdirSync(dir, { recursive: true });
        return { code: 0, out: "", err: "", error: null };
      }
      if (args[0] === "rev-parse") return { code: 0, out: sha, err: "", error: null };
      return { code: 0, out: "", err: "", error: null };
    };
    const s = w.store({ git });
    await assert.rejects(s.addGit({ url: "not an address" }), /say the repository/);
    const r = await s.addGit({ url: "owner/pack" });
    assert.deepEqual(r.added.map((x) => [x.name, x.kind, x.url, x.sha]), [["alpha", "git", "https://github.com/owner/pack.git", "a".repeat(12)], ["beta", "git", "https://github.com/owner/pack.git", "a".repeat(12)]]);
    assert.deepEqual(calls[0].slice(0, 6), ["clone", "-q", "--depth", "1", "-c", "core.autocrlf=false"]);
    const clone = r.added[0].path.replace(/[\\/]skills[\\/]alpha$/, "");
    assert.ok(existsSync(clone) && clone.startsWith(join(w.root, "data", "skills", "git")));
    sha = "b".repeat(40);
    // (fails before: yes — Hunter's find: a skill new in the repository stayed on disk, unkept, after Update)
    mkdirSync(join(clone, "skills", "gamma"), { recursive: true });
    writeFileSync(join(clone, "skills", "gamma", "SKILL.md"), "---\nname: gamma\n---\nnew upstream");
    const u = await s.update("alpha");
    assert.deepEqual([u.before, u.now, u.changed, u.skills.map((x) => [x.name, x.sha])], ["a".repeat(12), "b".repeat(12), true, [["alpha", "b".repeat(12)], ["beta", "b".repeat(12)], ["gamma", "b".repeat(12)]]]);
    assert.deepEqual(u.added.map((x) => [x.name, x.kind]), [["gamma", "git"]], "the new one, added");
    assert.deepEqual((await s.update("beta")).added, [], "added once");
    await assert.rejects(s.update("nope"), /no skill named/);
    s.remove("alpha");
    s.remove("gamma");
    assert.ok(existsSync(clone), "the clone stays while beta is left");
    s.remove("beta");
    assert.ok(!existsSync(clone));
    holds = false;
    await assert.rejects(s.addGit({ url: "https://example.com/empty.git" }), /holds no SKILL\.md/);
    assert.deepEqual(skillFoldersUnder(join(w.root, "data", "skills", "git"), 1), []);
    w.done();
  });

  test("into: the skills on there handed by name and SKILL.md, a gone one named; the Library's others named off there", () => {
    const w = world();
    const s = w.store();
    s.addPaths({ paths: [join(w.root, "mine/books"), join(w.root, "home/.cursor/skills")] });
    const doc = { skills: { on: [{ name: "Books" }, { name: "opus-rules" }, { name: "nope" }], plugins: [] } };
    const got = s.into(doc);
    assert.deepEqual(got.skills.yours, [
      { name: "books", path: join(w.root, "mine/books/SKILL.md") },
      { name: "opus-rules", path: join(w.root, "shipped/opus-rules/SKILL.md") },
    ]);
    assert.deepEqual(got.skills.gone, ["nope"]);
    assert.deepEqual(got.skills.plugins, []);
    assert.equal(doc.skills.yours, undefined, "the document given is left as it was");
    // None on: none of yours, and the Library's skills named off there with what each is for — the skill tool's find
    // names them, the person's /<name> loads one once (prompt version 54).
    const none = { skills: {} };
    const off = s.into(none);
    assert.deepEqual(off.skills.yours, []);
    assert.deepEqual(off.skills.library.map((/** @type {any} */ l) => l.name).sort(), ["books", "dashboards", "opus-rules"]);
    assert.ok(off.skills.library.every((/** @type {any} */ l) => l.path.endsWith("SKILL.md") && typeof l.description === "string"));
    assert.deepEqual(none, { skills: {} }, "the document given is left as it was");
    rmSync(join(w.root, "mine/books"), { recursive: true });
    assert.deepEqual(s.into(doc).skills.gone, ["Books", "nope"], "a skill whose folder is gone is named as the place names it");
    w.done();
  });

  // (fails before: yes — HarnessV4_Skills_Plan step 4: Filament shipped no skill)
  test("the skills Filament ships: its working rules (filament_regression), read from src/skills, Filament's own, its references in reach", () => {
    const w = world();
    const s = createSkillStore({ dataDir: join(w.root, "data"), shippedDir: join(import.meta.dirname, "..", "src", "skills"), home: join(w.root, "home"), env: {} });
    const rules = s.list().find((x) => x.name === "filament_regression");
    assert.ok(rules, "shipped");
    assert.deepEqual([rules.kind, rules.from, rules.there], ["shipped", "filament", true]);
    assert.match(rules.description, /^How to change Filament, or hunt a regression in it/);
    const page = s.get("filament_regression");
    assert.match(page.text, /## In five lines\n\n1\. Read the code before you decide\./);
    assert.deepEqual(page.files.map((f) => f.path), ["references", "references/filament.md", "references/practices.md", "SKILL.md"]);
    assert.match(s.readFile("filament_regression", "references/practices.md").text, /^# The practices, with examples\n\n## Mutation testing/);
    assert.throws(() => s.remove("filament_regression"), /comes with Filament: turn it off where it is on instead/);
    w.done();
  });

  // (fails before: yes — Hunter's finds: a project's own .claude/skills was kept as "a folder"; make at the cap left a
  // folder behind that blocked its name; a file written to no skill at all was refused as another app's)
  test("a project's own skill kept as its agent's; make at the cap refused before its folder; a write to no skill is a 404", () => {
    const w = world();
    const s = w.store();
    const proj = s.addPaths({ paths: [join(w.root, "proj/.claude/skills/release")], cwd: join(w.root, "proj") });
    assert.deepEqual(proj.added.map((x) => [x.name, x.from, x.fromWords]), [["release", "claude-code", "Claude Code"]]);
    // A SKILL.md longer than the page reads: its start, and cut says so (the page then offers no Edit).
    const big = s.make({ name: "big" });
    writeFileSync(join(big.path, "SKILL.md"), `---\nname: big\n---\n${"x".repeat(1_200_000)}`);
    const got = s.get("big");
    assert.deepEqual([got.cut, got.text.length], [true, 1_000_000]);
    assert.equal(s.get("release").cut, false);
    // 500 kept: the next made one is refused, and no folder is left for its name.
    const full = Array.from({ length: 500 }, (_, i) => ({ name: `s${i}`, path: join(w.root, `gone/s${i}`), at: 1, kind: "linked", from: "folder" }));
    writeFileSync(join(w.root, "data/skills/skills.json"), JSON.stringify({ version: 1, skills: full }));
    assert.throws(() => s.make({ name: "one-more" }), (e) => /** @type {any} */ (e).status === 409 && /at most 500 skills/.test(String(/** @type {any} */ (e).message)));
    assert.equal(existsSync(join(w.root, "data/skills/made/one-more")), false, "no folder made");
    assert.throws(() => s.writeFile("nope", "SKILL.md", "x"), (e) => /** @type {any} */ (e).status === 404 && /no skill named nope/.test(String(/** @type {any} */ (e).message)));
    assert.throws(() => s.writeFile("s1", "SKILL.md", "x"), (e) => /** @type {any} */ (e).status === 409, "one read where it stands is still not written");
    w.done();
  });
});
