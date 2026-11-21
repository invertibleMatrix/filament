// @ts-check
// HarnessV4_SpacesPlugins_Plan A1, A2 (SP-D1 to D3): Spaces of your own — a Space that belongs to no project, made as a
// project whose folder Filament makes for it. Its name and folder name (core), what it may read from its layer's folders
// (core's reachOf, the drives "the whole computer" lists), and end to end: made with its folder under Documents\filament
// Spaces or one picked, renamed everywhere, what it may read written to its layer and read back, refused where its folder
// is a Space or a project already, untouched by a project deleted beside it, and deleted with its folder kept.
// (fails before: yes — every Space was a project's)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownName, reachOf, spaceFolderName, OWN_LIMITS } from "../src/core/space.js";
import { SPACES_FOLDER, computerFolders, documentsFolder, reachLimits } from "../src/app/own-spaces.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-own-spaces-${tag}-`));
  made.push(d);
  return realpathSync.native(d);
};

describe("a Space of your own's words (core)", () => {
  test("ownName: a line of 1 to 60 characters, spaces folded; spaceFolderName: what Windows refuses taken out, never empty", () => {
    assert.deepEqual(ownName("  Work \n stuff "), { ok: true, name: "Work stuff" });
    assert.deepEqual(ownName(""), { ok: false, error: "A Space needs a name: Work, Personal…" });
    assert.deepEqual(ownName("x".repeat(OWN_LIMITS.name + 1)), { ok: false, error: "A Space's name is 60 characters at most." });
    assert.deepEqual(ownName("Wo\u0001rk"), { ok: false, error: "A Space's name holds no control characters." });
    assert.equal(spaceFolderName("Work: home/office?"), "Work home office");
    assert.equal(spaceFolderName("..."), "Space");
    assert.equal(spaceFolderName("con"), "con Space");
    assert.equal(spaceFolderName("Personal"), "Personal");
  });

  test("reachOf: none is its own folder, every drive the whole computer, else its folder and these; computerFolders lists the drives there", () => {
    assert.equal(reachOf([], ["C:\\"]), "folder");
    assert.equal(reachOf(["c:/", "D:\\"], ["C:\\", "D:\\"]), "computer");
    assert.equal(reachOf(["C:\\"], ["C:\\", "D:\\"]), "these");
    assert.equal(reachOf(["C:\\notes"], ["C:\\"]), "these");
    assert.deepEqual(computerFolders({ platform: "linux" }), ["/"]);
    assert.deepEqual(computerFolders({ platform: "win32", exists: (p) => p === "C:\\" || p === "H:\\" }), ["C:\\", "H:\\"]);
  });

  test("documentsFolder: Documents under the home where it is there, else the home", () => {
    const home = fresh("home");
    assert.equal(documentsFolder(home), home);
    mkdirSync(join(home, "Documents"));
    assert.equal(documentsFolder(home), join(home, "Documents"));
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the loopback rule: another loopback address read as a
  // listener open beyond this machine)
  test("reachLimits: a loopback address of any spelling narrows nothing; a network address with no roots says so", () => {
    for (const host of ["127.0.0.2", "::ffff:127.0.0.1", "localhost", "127.0.0.1"]) assert.equal(reachLimits({ server: { host }, agentLoop: { roots: [] } }), "", host);
    assert.match(reachLimits({ server: { host: "192.168.1.5" }, agentLoop: { roots: [] } }), /^Filament listens beyond this machine and agentLoop\.roots lists no folder/);
  });
});

describe("end to end", () => {
  test("made, listed, renamed, what it may read written and read back, refused twice, kept by a project's delete, deleted with its folder kept", async (t) => {
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const res = await shim.api(path, o);
      return { status: res.status, body: await res.json() };
    };
    const root = fresh("e2e");
    const folder = join(root, "Work");
    const a = await call("/api/spaces/own", { method: "POST", body: { name: " Work ", folder } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual([a.body.name, a.body.folder, a.body.reach, a.body.folders, a.body.shows], ["Work", folder, "folder", [], []]);
    assert.ok(existsSync(folder));
    const id = a.body.project;
    const list = await call("/api/spaces/own");
    assert.deepEqual(list.body.spaces.map((/** @type {any} */ s) => s.name), ["Work"]);
    assert.ok(Array.isArray(list.body.drives) && list.body.drives.length);
    assert.match(list.body.folder, /Filament Spaces$/);

    // Renamed: its Space and its project say the new name.
    const b = await call(`/api/space/${id}/own`, { method: "PATCH", body: { name: "Work stuff" } });
    assert.equal(b.body.name, "Work stuff");
    const settings = await call(`/api/projects/${id}/settings`);
    assert.equal(settings.body.name, "Work stuff");
    const space = await call(`/api/space/${id}`);
    assert.equal(space.status, 200);

    // What it may read: these folders, the whole computer, its own folder — its layer's, read back.
    const notes = fresh("notes");
    const c = await call(`/api/space/${id}/own`, { method: "PATCH", body: { reach: "these", folders: [notes] } });
    assert.deepEqual([c.body.reach, c.body.folders], ["these", [notes]]);
    assert.deepEqual((await call(`/api/projects/${id}/settings`)).body.layer.loop.addedFolders, [notes]);
    const d = await call(`/api/space/${id}/own`, { method: "PATCH", body: { reach: "computer" } });
    assert.deepEqual([d.body.reach, d.body.folders], ["computer", computerFolders()]);
    const e = await call(`/api/space/${id}/own`, { method: "PATCH", body: { reach: "folder" } });
    assert.deepEqual([e.body.reach, e.body.folders], ["folder", []]);
    assert.equal((await call(`/api/projects/${id}/settings`)).body.layer.loop?.addedFolders, undefined);
    assert.equal((await call(`/api/space/${id}/own`, { method: "PATCH", body: { reach: "these", folders: ["relative"] } })).status, 400);
    assert.equal((await call(`/api/space/${id}/own`, { method: "PATCH", body: { reach: "everywhere" } })).status, 400);

    // Refused: its folder is a Space already; a folder that is a project already.
    const twice = await call("/api/spaces/own", { method: "POST", body: { name: "Again", folder } });
    assert.deepEqual([twice.status, twice.body.error], [409, `${folder} is the Space “Work stuff” already.`]);
    const projFolder = fresh("proj");
    const p = (await call("/api/memory/projects", { method: "POST", body: { cwd: projFolder } })).body;
    const asProject = await call("/api/spaces/own", { method: "POST", body: { name: "Mine", folder: projFolder } });
    assert.equal(asProject.status, 409);
    assert.equal((await call("/api/spaces/own", { method: "POST", body: { name: "" } })).status, 400);
    // What it may read, refused, leaves nothing made: the same press, fixed, makes it (found by the Hunter on A6 — the
    // Space stood, and the retry was a 409).
    const later = join(root, "Later");
    const badReach = await call("/api/spaces/own", { method: "POST", body: { name: "Later", folder: later, reach: "these", folders: ["relative"] } });
    assert.deepEqual([badReach.status, badReach.body.error], [400, "relative is no full path: give each folder from its drive."]);
    assert.deepEqual((await call("/api/spaces/own")).body.spaces.map((/** @type {any} */ s) => s.name), ["Work stuff"]);
    const fixed = await call("/api/spaces/own", { method: "POST", body: { name: "Later", folder: later, reach: "these", folders: [notes] } });
    assert.deepEqual([fixed.status, fixed.body.reach], [200, "these"], JSON.stringify(fixed.body));
    assert.equal((await call(`/api/space/${fixed.body.project}/own`, { method: "DELETE" })).status, 200);
    // A folder inside a repository's linked worktree is that repository's: refused before any project is made for it.
    const repo = fresh("repo");
    mkdirSync(join(repo, "main", ".git", "worktrees", "wt"), { recursive: true });
    writeFileSync(join(repo, "main", ".git", "worktrees", "wt", "commondir"), "../..\n");
    mkdirSync(join(repo, "wt"));
    writeFileSync(join(repo, "wt", ".git"), `gitdir: ${join(repo, "main", ".git", "worktrees", "wt")}\n`);
    const inWorktree = await call("/api/spaces/own", { method: "POST", body: { name: "Inside", folder: join(repo, "wt") } });
    assert.deepEqual([inWorktree.status, inWorktree.body.error], [409, `${join(repo, "wt")} belongs to the project “main”: pick a folder outside it.`]);
    const projects = (await call("/api/memory/projects")).body.projects.map((/** @type {any} */ x) => String(x.cwd).toLowerCase());
    assert.ok(!projects.includes(join(repo, "main").toLowerCase()), "no project made for the repository");

    // A project deleted beside it leaves it whole.
    assert.equal((await call(`/api/memory/projects/${p.id}/delete`, { method: "POST" })).status, 200);
    assert.deepEqual((await call("/api/spaces/own")).body.spaces.map((/** @type {any} */ s) => s.name), ["Work stuff"]);

    // Deleted: its project and Space go; its folder stays, with the files in it.
    writeFileSync(join(folder, "notes.md"), "mine\n");
    const gone = await call(`/api/space/${id}/own`, { method: "DELETE" });
    assert.deepEqual(gone.body, { project: id, name: "Work stuff", folder });
    assert.ok(existsSync(join(folder, "notes.md")));
    assert.deepEqual((await call("/api/spaces/own")).body.spaces, []);
    assert.equal((await call(`/api/space/${id}`)).status, 404);
    assert.equal(existsSync(join(shim.dataDir, "spaces", `${id}.json`)), false);
  });

  test("with no folder picked, its folder is made under Documents\\Filament Spaces, numbered where the name's folder holds files", async (t) => {
    const home = fresh("home2");
    mkdirSync(join(home, "Documents"));
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const taken = join(home, "Documents", SPACES_FOLDER, "Personal");
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, "old.txt"), "x");
    const res = await shim.api("/api/spaces/own", { method: "POST", body: { name: "Personal" } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.folder, `${taken} 2`);
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the shared words: a new Space's folder outside the
  // roots was refused as "<folder> is outside agentLoop.roots.", where a chat's create says it in its own sentence)
  test("a folder that lies outside agentLoop.roots by a link under one is refused in the sentence a chat's create uses", async (t) => {
    const root = fresh("roots");
    const outside = fresh("outside");
    symlinkSync(outside, join(root, "link"), "junction");
    const shim = await startApp({ memory: true, configure: (cfg) => void (cfg.agentLoop = { ...cfg.agentLoop, roots: [root] }) });
    t.after(() => shim.stop());
    const folder = join(root, "link", "Work");
    const res = await shim.api("/api/spaces/own", { method: "POST", body: { name: "Work", folder } });
    assert.deepEqual([res.status, (await res.json()).error], [400, `${folder} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`]);
  });
});
