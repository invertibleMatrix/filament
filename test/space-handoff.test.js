// @ts-check
// Work handed from a Space of your own to a project (HarnessV4_SpacesPlugins_Plan A4): where it runs is asked — this
// Space first, then your projects, then your other Spaces —, the chat remembers the Space it came from, and that
// Space's What happened says each time it finishes, and where.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeChoices } from "../src/ui/harness/space/pick-place.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createSpaceNews } from "../src/app/space-news.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const WORK = "a1b2c3d4e5f6";
const APP = "0123456789ab";
const HOME = "fedcba987654";

describe("where a Space's work runs (A4)", () => {
  // (fails before: yes — nothing asked; the chat started in the Space's own folder)
  test("this Space first, then the projects as the bar lists them, then your other Spaces; one folder once, none without one", () => {
    const projects = [
      { id: APP, name: "app", cwd: "H:\\work\\app" },
      { id: HOME, name: "Home stuff", cwd: "C:\\Users\\me\\Documents\\Filament Spaces\\Home" },
      { id: WORK, name: "Work", cwd: "C:\\Users\\me\\Documents\\Filament Spaces\\Work" },
      { id: "111111111111", name: "app again", cwd: "h:/work/app/" },
      { id: "222222222222", name: "loose", cwd: "" },
    ];
    const own = [{ project: WORK, name: "Work" }, { project: HOME, name: "Personal" }];
    assert.deepEqual(placeChoices(WORK, projects, own).map((p) => [p.name, p.own]), [["Work", true], ["app", false], ["Personal", true]]);
  });

  // (fails before: yes — a chat that ran elsewhere wrote nothing in the Space it came from)
  test("a chat handed from a Space of your own: its finish is a line in that Space, naming where it ran, grown within the hour", async () => {
    let at = new Date(2026, 9, 26, 9, 0).getTime();
    const store = createSpaceStore({ dir: null, now: () => at });
    store.makeOwn(WORK, { name: "Work", folder: "C:\\Spaces\\Work" });
    /** @type {Record<string, { project: string | null, name: string, listed: boolean, from?: string | null }>} */
    const chats = {
      c1: { project: APP, name: "Fix PLAY-91", listed: true, from: WORK },
      c2: { project: APP, name: "Not handed", listed: true },
      c3: { project: APP, name: "From a project", listed: true, from: HOME },
      c4: { project: null, name: "Nowhere", listed: true, from: WORK },
    };
    const news = createSpaceNews({
      store,
      chat: (c) => chats[c] || null,
      nameOf: (p) => (p === APP ? "app" : null),
      folderOf: () => null,
      places: async () => ({ ok: false, error: "no git" }),
      chatsIn: () => new Map(),
      settleMs: 0,
    });
    const lines = () => store.get(WORK).log.filter((e) => e.by.kind === "filament" && e.by.chain).map((e) => e.text);
    news.ended("c1");
    news.ended("c2");
    news.ended("c3");
    await news.settled();
    assert.deepEqual(lines(), ["“Fix PLAY-91” finished a turn in app"], "the handed chat alone; a Space not of your own gets none");
    assert.equal(store.get(HOME).log.length, 0, "no Space written where none of yours is");
    at += 10 * 60_000;
    news.ended("c1");
    news.ended("c4");
    await news.settled();
    assert.deepEqual(lines(), ["“Fix PLAY-91” finished 2 turns since 09:00 in app", "“Nowhere” finished a turn in a folder of no project"]);
    assert.equal(store.get(APP).log.filter((e) => e.by.chain === "c1").length, 1, "its own project's What happened has its line as before");
  });

  // (fails before: yes, at 07965b7dd's parent — the handed chat's end said again for the same turn, by a client's retry
  // that went on with it, was a turn more in the Space it came from. Since 3e39c9cd9 its first end says it failed: only a
  // failed end is gone on with by a retry)
  test("a handed chat's turn that failed, ended again by its retry: that Space's line counts it once", async () => {
    let at = new Date(2026, 9, 26, 9, 0).getTime();
    const store = createSpaceStore({ dir: null, now: () => at });
    store.makeOwn(WORK, { name: "Work", folder: "C:\\Spaces\\Work" });
    const news = createSpaceNews({
      store,
      chat: (c) => (c === "c1" ? { project: APP, name: "Fix PLAY-91", listed: true, from: WORK } : null),
      nameOf: (p) => (p === APP ? "app" : null),
      folderOf: () => null,
      places: async () => ({ ok: false, error: "no git" }),
      chatsIn: () => new Map(),
      settleMs: 0,
    });
    const lines = () => store.get(WORK).log.filter((e) => e.by.kind === "filament" && e.by.chain).map((e) => e.text);
    news.ended("c1", 3, true);
    await news.settled();
    at += 10 * 60_000;
    news.ended("c1", 3);
    await news.settled();
    assert.deepEqual(lines(), ["“Fix PLAY-91” finished a turn in app"], "its turn, once");
    at += 10 * 60_000;
    news.ended("c1", 4);
    await news.settled();
    assert.deepEqual(lines(), ["“Fix PLAY-91” finished 2 turns since 09:00 in app"], "its next turn grows the line");
  });

  // (fails before: yes — the route took no from; the session kept nothing of where it came from)
  test("the route: a session made with from keeps it; a wrong from is refused in words; from its own Space keeps none", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "filament-handoff-"));
    t.after(() => removeDirs(root));
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const res = await shim.api(path, o);
      return { status: res.status, body: await res.json() };
    };
    const work = await call("/api/spaces/own", { method: "POST", body: { name: "Work", folder: join(root, "Work") } });
    assert.equal(work.status, 200, JSON.stringify(work.body));
    const appFolder = join(root, "app");
    mkdirSync(appFolder);
    const bad = await call("/api/sessions", { method: "POST", body: { cwd: appFolder, from: { space: "../x" } } });
    assert.deepEqual([bad.status, bad.body.error], [400, "from is the Space it was handed from: { space: <its project's id> }"]);
    const made = await call("/api/sessions", { method: "POST", body: { cwd: appFolder, autoTitle: true, from: { space: work.body.project } } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const archive = /** @type {any} */ (shim.app).memory?.archive;
    assert.deepEqual(archive.getChain(made.body.id).meta.from, { space: work.body.project });
    const here = await call("/api/sessions", { method: "POST", body: { cwd: join(root, "Work"), autoTitle: true, from: { space: work.body.project } } });
    assert.equal(archive.getChain(here.body.id).meta.from, undefined, "a chat in the Space's own folder is its own: no from");
  });
});
