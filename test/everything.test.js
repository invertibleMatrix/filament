// @ts-check
// Everything (the owner's of 10-30): a chat set to "Work outside a project" asked for a folder at its first send; it
// works in one folder of Filament's own, `<data folder>/Everything`, made the first time, its project named Everything,
// where its chats stand together. Where the agents may not work there (agentLoop.roots), it is refused in words and
// nothing is made.
// (fails before: yes — there was no such folder: a chat with no folder was asked for one, and the server refused an
// empty folder)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";

describe("Everything: the folder and project of a chat outside any project", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    shim = await startApp({ memory: true });
  });
  after(async () => {
    await shim?.stop();
  });

  test("its folder is made in the data folder the first time, its project is named Everything, and a chat there stands under it", async () => {
    const r = await shim.api("/api/memory/projects/everything", { method: "POST", body: {} });
    assert.equal(r.status, 200, await r.clone().text());
    const home = await r.json();
    assert.deepEqual([home.cwd, home.name], [realpathSync.native(join(shim.dataDir, "Everything")), "Everything"]);
    assert.ok(existsSync(home.cwd), "the folder is made");
    const again = await (await shim.api("/api/memory/projects/everything", { method: "POST", body: {} })).json();
    assert.deepEqual(again, home, "the same folder and project each time");
    const projects = (await (await shim.api("/api/memory/projects")).json()).projects;
    assert.deepEqual(projects.filter((/** @type {any} */ p) => p.id === home.project).map((/** @type {any} */ p) => p.name), ["Everything"]);
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: home.cwd, model: "m-1", title: "Outside" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const rows = (await (await shim.api("/api/memory/sessions?limit=50")).json()).sessions || [];
    const row = rows.find((/** @type {any} */ s) => String(s.id) === id);
    assert.deepEqual([row?.project, row?.projectName], [home.project, "Everything"], "listed under Everything");
  });
});

// The Start of a new chat with no project chosen (the owner's of 11-09: "when i press new task and there is no project
// selected and as default Everywhere is selected then no widget control is shown"): its board asks draft-start as a
// chat outside a project, and the server weighs the start in Everything's folder — before its first send made it,
// nothing made, and after, the folder as made.
// (fails before: yes — the answer needed a folder: `{ outside: true }` was a 400, and the page asked nothing)
describe("the Start of a chat outside a project: draft-start weighs Everything's start", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    shim = await startApp({ memory: true });
  });
  after(async () => {
    await shim?.stop();
  });
  /** @param {any} body */
  const draft = async (body) => {
    const r = await shim.api("/api/sessions/draft-start", { method: "POST", body });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return j;
  };
  // Your defaults ask before making room: the board's change is the other way.
  const SETTINGS = { context: { compaction: { mode: "auto" } } };

  test("before any chat made it: weighed where the folder will be, the board's change marked as the chat's, and nothing made", async () => {
    const projects = async () => (await (await shim.api("/api/memory/projects")).json()).projects?.length ?? 0;
    const before = await projects();
    const d = await draft({ outside: true, model: "m-1", settings: SETTINGS, text: "hello" });
    assert.deepEqual([d.outside, d.cwd, d.projectName], [true, join(realpathSync.native(shim.dataDir), "Everything"), "Everything"], "where the make will put it, the data folder as the disk has it");
    assert.deepEqual([d.flat["context.compaction.mode"], d.sources["context.compaction.mode"]], ["auto", "session"]);
    assert.ok(Array.isArray(d.parts) && d.parts.some((/** @type {any} */ p) => p.id === "message" && p.tokens > 0), JSON.stringify(d.parts));
    assert.equal(existsSync(join(shim.dataDir, "Everything")), false, "the folder is made by the first send, not the Start");
    assert.equal(await projects(), before, "no project row conjured");
    const plain = await draft({ outside: true, cwd: "", model: "m-1", text: "" });
    assert.deepEqual([plain.flat["context.compaction.mode"], plain.sources["context.compaction.mode"] === "session"], ["ask", false], "without the change, your defaults' value");
  });

  // (fails before: yes — the card counted Everything's own memories alone, "Knows 0 memories about this project", while
  // the chat draws on the ones that hold everywhere)
  test("its memory counts what holds everywhere, as Library › Memory › Everywhere counts it; a project's start counts no such thing", async () => {
    for (const text of ["Answers in plain English, short.", "Never push to main without asking."])
      assert.equal((await shim.api("/api/memory/remember", { method: "POST", body: { text, kind: "rule" } })).status, 200);
    const scopes = (await (await shim.api("/api/memory/claims/scopes")).json()).scopes;
    const everywhere = scopes.find((/** @type {any} */ s) => s.project === null)?.claims;
    assert.equal(everywhere, 2);
    const d = await draft({ outside: true, model: "m-1", text: "hello" });
    assert.deepEqual(d.memory.knows, { memories: 0, dossier: null, everywhere: 2 });
    const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-everything-proj-")));
    try {
      const inProject = await draft({ cwd: folder, model: "m-1", text: "hello" });
      assert.deepEqual([inProject.outside, inProject.memory.knows.everywhere], [undefined, undefined]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("once made: the folder as the disk has it, Everything's project; a body with neither a folder nor `outside` is still a 400", async () => {
    const home = await (await shim.api("/api/memory/projects/everything", { method: "POST", body: {} })).json();
    const d = await draft({ outside: true, model: "m-1", settings: SETTINGS, text: "hello" });
    assert.deepEqual([d.outside, d.cwd, d.projectId, d.projectName], [true, home.cwd, home.project, "Everything"]);
    // A memory an earlier chat outside a project left is Everything's own, beside what holds everywhere.
    assert.equal((await shim.api("/api/memory/remember", { method: "POST", body: { text: "The scratch notes live in notes.md.", project: home.project } })).status, 200);
    assert.deepEqual((await draft({ outside: true, model: "m-1", text: "hello" })).memory.knows, { memories: 1, dossier: null, everywhere: 2 });
    // The chat the send then makes, in that folder with the board's change (app.js readySession, then makeSession).
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: home.cwd, model: "m-1", settings: SETTINGS, autoTitle: true } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const s = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal(s.flat["context.compaction.mode"], "auto");
    const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { model: "m-1" } });
    assert.equal(r.status, 400);
  });
});

describe("Everything where the agents may not work in the data folder", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-everything-roots-"));
  before(async () => {
    shim = await startApp({ memory: true, configure: (cfg) => void (cfg.agentLoop = { ...cfg.agentLoop, roots: [root] }) });
  });
  after(async () => {
    await shim?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("refused in words, naming agentLoop.roots, and nothing is made", async () => {
    const r = await shim.api("/api/memory/projects/everything", { method: "POST", body: {} });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /would not be under any folder listed in agentLoop\.roots: add it to agentLoop\.roots, or pick a project folder for this chat$/);
    assert.equal(existsSync(join(shim.dataDir, "Everything")), false);
  });

  // (fails before: yes — the Start of a chat outside a project was never asked; `{ outside: true }` was a 400 for want of
  // a folder, not for the roots)
  test("the Start of a chat outside a project says the same words, and makes nothing", async () => {
    const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { outside: true, model: "m-1", text: "" } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /would not be under any folder listed in agentLoop\.roots: add it to agentLoop\.roots, or pick a project folder for this chat$/);
    assert.equal(existsSync(join(shim.dataDir, "Everything")), false);
  });
});

// A data folder inside a repository's linked worktree: Everything's folder would stand in the repository's project
// (GW-D46), so a chat outside a project is refused there — by the Start before the first send as by the send itself, in
// the same words, before Everything is made and after.
// (fails before: yes — the Start weighed the repository's project with no word of it, and the send then refused)
describe("Everything where the data folder lies in a repository's linked worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-everything-repo-"));
  // A linked worktree as git lays it out, which is all project-folder.js reads: its `.git` file names its record, whose
  // `commondir` names the repository's git folder.
  const record = join(root, "main", ".git", "worktrees", "wt");
  const data = join(root, "wt", "data");
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    mkdirSync(record, { recursive: true });
    writeFileSync(join(record, "commondir"), "../..\n");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(root, "wt", ".git"), `gitdir: ${record}\n`);
    shim = await startApp({ memory: true, dataDir: data });
  });
  after(async () => {
    await shim?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("the Start refuses in the send's words and status, before the folder is made and after", async () => {
    const draft = async () => {
      const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { outside: true, model: "m-1", text: "hello" } });
      return [r.status, (await r.json()).error];
    };
    const words = `${join(realpathSync.native(data), "Everything")} lies inside a repository, whose project it would be: pick a project folder for this chat`;
    assert.deepEqual(await draft(), [409, words], "before the first send made it");
    const sent = await shim.api("/api/memory/projects/everything", { method: "POST", body: {} });
    assert.deepEqual([sent.status, (await sent.json()).error], [409, words], "the send's own refusal");
    assert.equal(existsSync(join(data, "Everything")), true, "the send made the folder before it refused");
    assert.deepEqual(await draft(), [409, words], "the folder there now");
  });
});

describe("Everything where the data folder lies outside agentLoop.roots by a link under one", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-everything-link-"));
  const outside = mkdtempSync(join(tmpdir(), "filament-everything-out-"));
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    symlinkSync(outside, join(root, "link"), "junction");
    mkdirSync(join(root, "link", "data"));
    shim = await startApp({ memory: true, dataDir: join(root, "link", "data"), configure: (cfg) => void (cfg.agentLoop = { ...cfg.agentLoop, roots: [root] }) });
  });
  after(async () => {
    await shim?.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the shared words: Everything's folder outside the
  // roots was refused as "<folder> is outside agentLoop.roots: add it, …", where a chat's create says it in its own sentence)
  test("refused in the sentence a chat's create uses, naming the folder as the disk has it", async () => {
    const r = await shim.api("/api/memory/projects/everything", { method: "POST", body: {} });
    const real = realpathSync.native(join(outside, "data", "Everything"));
    assert.deepEqual([r.status, (await r.json()).error], [400, `${real} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`]);
  });
});
