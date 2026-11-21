// @ts-check
// HarnessV4_Skills_Plan S1-6 — where a skill is on, and Library › Skills' API: a skill turned on for all chats, off in a
// project, on again in a chat; the place beneath named; removed, it is taken off every place. Through Filament: add a
// folder, turn it on at the place the page names, and the loop's prompt lists it; Remove takes it off.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillPlaces } from "../src/app/skill-places.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

describe("where a skill is on (places)", () => {
  /** Your defaults, a project "Work" (a Space of yours) that shows "api", and a chat of api, each written by its writer. */
  function fakes() {
    const st = { defaults: /** @type {any} */ ({}), projects: /** @type {Record<string, any>} */ ({ p1: {}, api: {} }), chats: /** @type {Record<string, any>} */ ({ c1: {} }), via: /** @type {string[]} */ ([]) };
    const apply = (/** @type {any} */ layer, /** @type {any} */ change) => {
      for (const k of change.unset || []) delete layer[k];
      Object.assign(layer, change.patch || {});
    };
    const sessions = {
      patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
      patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
      patchSettings: (/** @type {string} */ id, /** @type {any} */ c, /** @type {any} */ o) => {
        st.via.push(o?.via);
        apply(st.chats[id], c);
      },
      launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "api" } : null),
    };
    const archive = {
      getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: id, cwd: `/w/${id}` } : null),
      projectSettings: (/** @type {string} */ id) => st.projects[id],
      chainSettings: (/** @type {string} */ id) => st.chats[id],
      projects: () => Object.keys(st.projects).map((id) => ({ id, name: id })),
      spaceOf: (/** @type {string} */ id) => (id === "api" ? "p1" : null),
    };
    const places = createSkillPlaces({ sessions, memory: { archive }, config: { get: () => ({ sessions: { defaults: st.defaults } }) }, ownName: (id) => (id === "p1" ? "Work" : null) });
    return { st, places };
  }

  test("on for all chats, off in a project, on again in a chat; the place beneath named; a Space reaches the projects it shows; forget takes it off", () => {
    const { st, places } = fakes();
    assert.deepEqual(places.turn("pdf", { place: "all", on: true }), { place: "all", label: "all chats", on: true, here: true, from: null });
    assert.deepEqual(st.defaults, { "skills.on": [{ name: "pdf" }] });
    assert.deepEqual(places.at("pdf", "project:api"), { place: "project:api", label: "api", on: true, here: false, from: "all" });
    assert.deepEqual(places.turn("PDF", { place: "project:api", on: false }), { place: "project:api", label: "api", on: false, here: true, from: null });
    assert.deepEqual(st.projects.api, { "skills.on": [{ name: "PDF", enabled: false }] });
    assert.deepEqual(places.turn("pdf", { place: "chat:c1", on: true }), { place: "chat:c1", label: "this chat", on: true, here: true, from: null });
    assert.deepEqual(st.chats.c1, { "skills.on": [{ name: "pdf", enabled: true }] }, "on over a project's off says so");
    assert.deepEqual(st.via, ["Skills"]);
    // Back to what is beneath: the place's own entry goes.
    places.turn("pdf", { place: "project:api", on: true });
    assert.deepEqual(st.projects.api, {});
    // A Space of yours: on in Work, on in the project it shows.
    places.turn("books", { place: "project:p1", on: true });
    assert.deepEqual(places.at("books", "project:api"), { place: "project:api", label: "api", on: true, here: false, from: "project:p1" });
    assert.deepEqual(places.onAt("chat:c1"), ["pdf", "books"]);
    assert.deepEqual(places.everywhere(), { pdf: [{ place: "all", label: "all chats", on: true }], books: [{ place: "project:p1", label: "Work", on: true }] });
    places.forget("Books");
    assert.deepEqual(places.everywhere(), { pdf: [{ place: "all", label: "all chats", on: true }] });
    assert.throws(() => places.turn("pdf", { place: "all", on: "yes" }), /on: true, false, or null/);
    // Back to what it inherits: the chat's own word goes.
    places.turn("pdf", { place: "chat:c1", on: false });
    assert.deepEqual(places.turn("pdf", { place: "chat:c1", on: null }), { place: "chat:c1", label: "this chat", on: true, here: false, from: "all" });
    assert.throws(() => places.at("pdf", "nowhere"), /say the place/);
  });
});

describe("Library › Skills through Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string[]} */
  const systems = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-skills-api-"));
    mkdirSync(join(root, "mine", "books", "references"), { recursive: true });
    writeFileSync(join(root, "mine", "books", "SKILL.md"), "---\nname: books\ndescription: What the books say\n---\nLook in references/.");
    writeFileSync(join(root, "mine", "books", "references", "INDEX.md"), "# Index\n");
    up = await fakeUpstream(async (call) => {
      const system = Array.isArray(call.body.system) ? call.body.system.map((/** @type {any} */ b) => b.text).join("") : String(call.body.system || "");
      systems.push(system);
      return anthropicReply("ok", { model: "brain-model" });
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root])
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
  });

  // (fails before: there was no /api/skills: skills were a folder list in a chat's settings)
  test("add a folder on for all chats: listed with where it stands, the loop's prompt names it; off in a chat, not there; Remove takes it off", async () => {
    const add = await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "mine")], place: "all" } });
    assert.equal(add.status, 200);
    const added = await add.json();
    assert.deepEqual([added.added.map((/** @type {any} */ s) => [s.name, s.kind, s.from]), added.place], [[["books", "linked", "folder"]], "all"]);
    const list = await (await shim.api("/api/skills?place=all")).json();
    const books = list.skills.find((/** @type {any} */ s) => s.name === "books");
    assert.deepEqual(books.on, { place: "all", label: "all chats", on: true, here: true, from: null });
    assert.deepEqual(list.place, { place: "all", label: "all chats", projectId: null, chainId: null });
    assert.ok(Array.isArray(list.plugins));

    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    systems.length = 0;
    const r1 = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "what do the books say?", stream: false } });
    assert.equal(r1.status, 200);
    await r1.json();
    assert.match(systems[0], /# Skills\n.*\n- books — What the books say/s);

    // Its page: its SKILL.md, its files, where it is on.
    const page = await (await shim.api("/api/skills/books")).json();
    assert.deepEqual(page.files.map((/** @type {any} */ f) => f.path), ["references", "references/INDEX.md", "SKILL.md"]);
    assert.deepEqual(page.places, [{ place: "all", label: "all chats", on: true }]);
    assert.equal((await (await shim.api("/api/skills/books/file?path=references/INDEX.md")).json()).text, "# Index\n");
    assert.equal((await shim.api("/api/skills/books/file?path=../../x")).status, 400);
    assert.equal((await shim.api("/api/skills/books/file", { method: "PUT", body: { path: "x.md", text: "x" } })).status, 409, "a folder read where it stands is not written");

    // Off in this chat: the next turn's prompt has no skills.
    const off = await (await shim.api("/api/skills/books/on", { method: "POST", body: { place: `chat:${created.id}`, on: false } })).json();
    assert.deepEqual([off.on, off.here], [false, true]);
    systems.length = 0;
    // What the chat sends ahead changed: the message asks first (the owner's of 11-06), and goes sent as it is.
    await (await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "again", stream: false, sendAsIs: true } })).json();
    assert.ok(!systems[0].includes("# Skills"), "off in the chat");

    // Removed: off everywhere, its folder left as it was.
    const gone = await (await shim.api("/api/skills/books", { method: "DELETE" })).json();
    assert.deepEqual([gone.removed, gone.files], ["books", false]);
    assert.ok(existsSync(join(root, "mine", "books", "SKILL.md")));
    assert.equal((await (await shim.api("/api/skills/books/on", { method: "POST", body: { place: "all", on: true } })).json()).error, "There is no skill named books in your skills.");

    // (fails before: yes — Hunter's find: Remove left the chat's own word, so a skill added again under that name came
    // back off in that chat although it was turned on for all chats)
    await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "mine")], place: "all" } });
    const again = (await (await shim.api(`/api/skills?place=${encodeURIComponent(`chat:${created.id}`)}`)).json()).skills.find((/** @type {any} */ s) => s.name === "books");
    assert.deepEqual([again.on.on, again.on.here, again.on.from], [true, false, "all"], "the chat's old word went with it");
    await shim.api("/api/skills/books", { method: "DELETE" });

    // (fails before: yes — the review of the Skills page: Add skills… turns nothing on, and with no place a project's
    // own folder was said to be imported) The place says whose a folder is; `on: false` turns nothing on there.
    const quiet = await (await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "mine")], place: "all", on: false } })).json();
    assert.deepEqual([quiet.added.map((/** @type {any} */ s) => s.name), quiet.place, quiet.off], [["books"], null, []]);
    const listed = (await (await shim.api("/api/skills?place=all")).json()).skills.find((/** @type {any} */ s) => s.name === "books");
    assert.equal(listed.on.on, false, "added, on nowhere");
    assert.equal(typeof listed.lineTokens, "number", "with what its line costs where it is on");
    await shim.api("/api/skills/books", { method: "DELETE" });
  });

  // (fails before: yes — Hunter's finds: a place whose list was full refused the add after the skill was kept, and a
  // write to no skill at all was refused as another app's)
  test("added but not turned on: kept, and said in off with why; a write to no skill is a 404", async () => {
    const full = Array.from({ length: 256 }, (_, i) => ({ name: `held-${i}` }));
    assert.equal((await shim.api("/api/defaults/settings", { method: "PATCH", body: { patch: { skills: { on: full } } } })).status, 200);
    const res = await shim.api("/api/skills", { method: "POST", body: { make: "overflow", place: "all" } });
    assert.equal(res.status, 200, "the skill was kept: the answer says so");
    const got = await res.json();
    assert.deepEqual(got.added.map((/** @type {any} */ s) => s.name), ["overflow"]);
    assert.equal(got.off.length, 1);
    assert.equal(got.off[0].name, "overflow");
    assert.match(got.off[0].why, /holds at most 256 skills/);
    assert.equal((await shim.api("/api/skills/overflow")).status, 200, "kept");
    await shim.api("/api/defaults/settings", { method: "PATCH", body: { unset: ["skills.on"] } });
    await shim.api("/api/skills/overflow", { method: "DELETE" });
    const nope = await shim.api("/api/skills/nope/file", { method: "PUT", body: { path: "SKILL.md", text: "x" } });
    assert.deepEqual([nope.status, (await nope.json()).error], [404, "There is no skill named nope in your skills."]);
  });

  test("make one here, on at no place: written through its page; found answers per agent; a bad body is refused in words", async () => {
    const made = await (await shim.api("/api/skills", { method: "POST", body: { make: "game-rules", description: "How the game is played" } })).json();
    assert.deepEqual([made.added[0].name, made.added[0].kind, made.place], ["game-rules", "made", null]);
    assert.equal((await shim.api("/api/skills/game-rules/file", { method: "PUT", body: { path: "SKILL.md", text: "---\nname: game-rules\ndescription: Rules\n---\nPlay fair." } })).status, 200);
    assert.equal((await (await shim.api("/api/skills/game-rules")).json()).description, "Rules");
    const list = await (await shim.api("/api/skills?place=all")).json();
    assert.equal(list.skills.find((/** @type {any} */ s) => s.name === "game-rules").on.on, false, "made, on nowhere until turned on");
    const found = await (await shim.api("/api/skills/found")).json();
    assert.deepEqual(found.agents.map((/** @type {any} */ a) => a.agent), ["claude-code", "codex", "cursor"]);
    assert.equal((await (await shim.api("/api/skills", { method: "POST", body: {} })).json()).error, "say what to add: { paths }, { git, ref? } or { make, description? }");
    assert.equal((await shim.api("/api/skills/nope")).status, 404);
    const del = await (await shim.api("/api/skills/game-rules", { method: "DELETE" })).json();
    assert.deepEqual([del.removed, del.files], ["game-rules", true]);
  });

  // (fails before: yes — HarnessV4_Skills_Plan step 2: a skill carried no books)
  test("a made skill's books: sent from the page and from a path, on its page, found in, taken out; another's folder takes none", async () => {
    await shim.api("/api/skills", { method: "POST", body: { make: "tiles", description: "Unity's tilemaps" } });
    writeFileSync(join(root, "rules.md"), "# Rule tiles\nA rule tile picks its sprite by its neighbours.\n\n# Animated tiles\nThey loop frames.\n");
    const sent = await (await shim.api("/api/skills/tiles/books", { method: "POST", body: { files: [{ name: "guide.md", data: Buffer.from("# Tilemaps\nA tilemap holds tiles on a grid.").toString("base64") }] } })).json();
    assert.deepEqual(sent.added.map((/** @type {any} */ b) => [b.name, b.parts.length]), [["guide.md", 1]]);
    const fromPath = await (await shim.api("/api/skills/tiles/books", { method: "POST", body: { paths: [join(root, "rules.md")] } })).json();
    assert.deepEqual([fromPath.added.length, fromPath.books.length], [1, 2]);
    const page = await (await shim.api("/api/skills/tiles")).json();
    assert.deepEqual(page.books.map((/** @type {any} */ b) => b.name), ["guide.md", "rules.md"]);
    assert.equal(typeof page.readsPdf, "boolean");
    assert.ok(page.files.some((/** @type {any} */ f) => f.path === "references/INDEX.md"), "the table of contents is one of its files");
    assert.ok(!page.files.some((/** @type {any} */ f) => f.path.startsWith(".library")), "the index is not");
    const found = await (await shim.api("/api/skills/tiles/find?words=rule%20tile%20neighbours")).json();
    assert.equal(found.hits[0].title, "Rule tiles");
    const out = await (await shim.api("/api/skills/tiles/books/rules", { method: "DELETE" })).json();
    assert.deepEqual([out.removed, out.books.length], ["rules.md", 1]);
    assert.equal((await shim.api("/api/skills/tiles/books/rules", { method: "DELETE" })).status, 404);
    // Another app's folder is its own: no books go into it.
    mkdirSync(join(root, "theirs", "lint"), { recursive: true });
    writeFileSync(join(root, "theirs", "lint", "SKILL.md"), "---\nname: lint\ndescription: Lint it\n---\nRun the linter.");
    await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "theirs")] } });
    const refused = await shim.api("/api/skills/lint/books", { method: "POST", body: { paths: [join(root, "rules.md")] } });
    assert.deepEqual([refused.status, (await refused.json()).error], [409, "Only a skill made in Filament has a library here."]);
    assert.equal((await shim.api("/api/skills/lint/find?words=x")).status, 404, "it carries no library");
    await shim.api("/api/skills/lint", { method: "DELETE" });
    await shim.api("/api/skills/tiles", { method: "DELETE" });
  });

  // (fails before: yes — a made skill was written from its books by a model in the background, its draft read later:
  // the owner's word of 10-27 is that nothing crafts out of sight — a crafter chat does it, crafter-chat.test.js)
  test("no route writes a skill from its books out of sight", async () => {
    await shim.api("/api/skills", { method: "POST", body: { make: "grids", description: "Unity's grids" } });
    assert.equal((await shim.api("/api/skills/grids/craft?model=brain-model")).status, 404);
    assert.equal((await shim.api("/api/skills/grids/craft", { method: "POST", body: { model: "brain-model" } })).status, 404);
    await shim.api("/api/skills/grids", { method: "DELETE" });
  });
});
