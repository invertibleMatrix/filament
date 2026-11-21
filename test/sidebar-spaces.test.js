// @ts-check
// The left bar's Spaces (HarnessV4_SpacesPlugins_Plan A6, the Designer's §6 A): a section between Pinned and Projects,
// its + New Space…, each Space of your own a group like a project's — its Board and its apps, never its chats (the
// owner's of 11-05) — and never under Projects; "Your Space" is Home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

test("Spaces stand between Pinned and Projects, each Space of your own a group of its own — one with no chat too; Home is the bar's first row", async () => {
  await drawBar(null, (all, list, host) => {
    const heads = all(list).filter((x) => /\blb-sec-name\b/.test(String(x.className))).map((x) => x.textContent);
    assert.deepEqual(heads, ["Spaces", "Projects"], "Spaces before Projects");
    const groups = all(list).filter((x) => x.tagName === "DETAILS");
    const names = groups.map((x) => all(x).find((y) => y.className === "proj")?.textContent);
    assert.deepEqual(names, ["Work", "Empty", "app"], "the Spaces of your own first, each once; the project under Projects");
    assert.ok(groups[0].className.includes("own-space"));
    // (fails before: yes — a Space of your own listed its chats under it, a count of them beside its name: the owner's
    // of 11-05, "i personally don't even like threads showing up under personal spaces")
    const work = all(groups[0]).map((x) => x.textContent).join(" | ");
    assert.ok(!work.includes("Triage my mentions"), "no chat of it under it");
    assert.ok(!all(groups[0]).some((x) => String(x.className).includes("proj-count")), "nor a count of them");
    assert.ok(!all(groups[2]).some((x) => String(x.textContent).includes("Triage my mentions")), "and not under the project");
    const add = all(list).find((x) => x.getAttribute?.("aria-label") === "New Space…");
    assert.ok(add, "the + is New Space…");
    const home = all(host).find((x) => String(x.className).includes("ys-row-label"));
    assert.equal(home?.textContent, "Home");
  });
});

// (fails before: yes — found by the Hunter on A6: by time, a Space of your own's row said "Space" with a project's glyph,
// and had no ⋯)
test("by time, a Space of your own's row says its name, with its glyph and its ⋯", async () => {
  await drawBar("grouped", (all, list) => {
    const rows = all(list).filter((x) => String(x.className).startsWith("space-row"));
    const work = rows.find((x) => x.getAttribute("data-space") === "w1");
    assert.ok(work, "its row");
    assert.equal(all(work).find((x) => x.className === "sess-title")?.textContent, "Work");
    assert.ok(all(work).some((x) => String(x.className).includes("own-space-ic")), "its glyph");
    assert.ok(all(work).some((x) => x.tagName === "BUTTON" && x.getAttribute("title") === "Space menu"), "its ⋯");
  });
});

// (fails before: yes — the Designer's redesign of 10-29: inside a Space of your own's group, its first row said "Space"
// with a project's purple glyph and "The project's Space: its lanes, its board and its logbook")
test("in a Space of your own's group, its first row is its Board: no project's words, no second ⋯", async () => {
  await drawBar(null, (all, list) => {
    const work = all(list).filter((x) => x.tagName === "DETAILS")[0];
    const row = all(work).find((x) => String(x.className).startsWith("space-row"));
    assert.ok(row, "its row");
    assert.equal(all(row).find((x) => x.className === "sess-title")?.textContent, "Board");
    assert.equal(row.getAttribute("title"), "Work's Board: its tasks, who works there and what happened");
    assert.ok(all(row).some((x) => String(x.className).includes("own-space-ic")), "the Space's colour");
    assert.ok(!all(row).some((x) => x.tagName === "BUTTON"), "its ⋯ is the group's");
  });
});

// (fails before: yes — the Designer's walk of 10-29: after Make Space, Home life's group stayed folded, its Board row
// marked out of sight, while a chat of recipes stayed marked)
test("a Space on screen is the bar's one mark: its group opens on its Board row, and the chat behind it is not marked until it is left", async () => {
  const { state } = await import("../src/ui/harness/state.js");
  const hadChats = state.chats;
  const hadCurrent = state.currentId;
  state.chats = new Map([["x1", /** @type {any} */ ({ id: "x1", chainId: "c1", turns: [] })]]);
  state.currentId = "x1";
  try {
    await drawBar(null, (all, list, _host, sb) => {
      const row = (/** @type {string} */ chain) => all(list).find((x) => x.getAttribute?.("data-chain") === chain);
      const group = (/** @type {string} */ id) => all(list).filter((x) => x.tagName === "DETAILS").find((d) => all(d).some((y) => y.getAttribute?.("data-space") === id));
      assert.ok(String(row("c1").className).includes("current"), "the chat open is marked");
      assert.equal(group("e1").getAttribute("open"), null, "a Space with no chat: folded");
      sb.atSpace("e1");
      const board = all(group("e1")).find((x) => String(x.className).startsWith("space-row"));
      assert.notEqual(group("e1").getAttribute("open"), null, "its group open");
      assert.ok(String(board.className).includes("current"), "its Board row marked");
      assert.ok(!String(row("c1").className).includes("current"), "the chat behind it not");
      sb.atSpace(null);
      assert.ok(String(row("c1").className).includes("current"), "back to the chat: marked again");
    });
  } finally {
    state.chats = hadChats;
    state.currentId = hadCurrent;
  }
});

// (fails before: yes — the Designer's walk of 10-29, "which agent do I ask": the Start New chat here… opens said "Start a
// new chat in Home life" and "Choose a model", nothing of the Space the chat works in)
test("the Start says the Space its folder works in: a Space of your own's, a project's that has one; none, nothing", async () => {
  await drawBar(null, async (all, _list, _host, sb) => {
    assert.deepEqual(sb.spaceFor("/docs/Work"), { name: "Work", own: true });
    assert.deepEqual(sb.spaceFor("\\DOCS\\work\\"), { name: "Work", own: true }, "as Windows spells it");
    assert.deepEqual(sb.spaceFor("/code/app"), { name: "app", own: false }, "a project's, by its folder's name");
    assert.equal(sb.spaceFor("/code/other"), null);
    const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
    let folder = "/docs/Work";
    // The greeting's timer, the stub window's: none needed here.
    const win = /** @type {any} */ (globalThis).window;
    if (typeof win.setTimeout !== "function") win.setTimeout = () => 0;
    const empty = createEmptyState({ getFolder: () => folder, setFolder() {}, spaceOf: (/** @type {string} */ cwd) => sb.spaceFor(cwd) });
    /** The Start's line on its Space. */
    const line = () => all(empty.el).find((x) => String(x.className).includes("chooser-space"));
    empty.paintChip();
    assert.equal(line().textContent, "This chat works in Work, a Space of yours, whichever agent you pick: it can add tasks, note what it did in What happened, and make or change its apps.");
    assert.equal(line().hidden, false);
    folder = "/code/app";
    empty.paintChip();
    assert.equal(line().textContent, "This chat works in app's Space, whichever agent you pick: it can add tasks, note what it did in What happened, and make or change its apps.");
    folder = "/code/other";
    empty.paintChip();
    assert.equal(line().hidden, true, "no Space there: nothing said");
  }, { open: { p1: 0 } });
});

// (fails before: yes — the Designer's second walk of 10-29: Hobbies' New chat here… opened with "Make an app for Hobbies'
// Space: A small game…" in the box, unsent words from before, saying nothing of them)
test("the Start says when it brings back words typed and not sent, with Clear", async () => {
  await drawBar(null, async (all) => {
    const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
    const win = /** @type {any} */ (globalThis).window;
    if (typeof win.setTimeout !== "function") win.setTimeout = () => 0;
    let kept = true;
    let cleared = 0;
    const empty = createEmptyState({ getFolder: () => "/docs/Work", setFolder() {},
      start: /** @type {any} */ ({ body: () => null, text: () => "Make an app for Work: a small game", permission: () => "", setPermission() {}, models: () => [], mainModel: () => "",
        kept: () => kept, clearKept: () => { cleared++; kept = false; } }) });
    const line = () => all(empty.el).find((x) => String(x.className).includes("chooser-kept"));
    empty.paintChip();
    assert.equal(line().hidden, false);
    assert.match(line().textContent, /^Kept from before: what you typed here and didn't send\./);
    all(line()).find((x) => x.tagName === "BUTTON").dispatch("click");
    assert.deepEqual([cleared, line().hidden], [1, true], "Clear empties the box, and the line goes");
  });
  // The page's side: the words put back are the ones it says, and Clear empties the box and what was kept.
  const app = (await import("node:fs")).readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /keptBack = chat\.chainId \? "" : back;/);
  assert.match(app, /kept: \(\) => !!keptBack && composer\.draft\(\) === keptBack,/);
  assert.match(app, /clearKept: \(\) => \{[^}]*composer\.setDraft\(""\);[^}]*saveDraft\(c, ""\)/);
});

// (fails before: yes — found on 11-12: the row counted each listed row's own folder's place and that place's main
// folder, whatever repository it was in, a helper's transcript and an archived chat too, and never a place its chat's
// agents wrote in: "5 lanes" here where the page says "· 3 lanes"; and a Space with no chat said nothing where the
// page says "· 1 lane")
test("a Space's row counts its lanes by the page's rule: the repository's main folder always, and each folder or worktree of it a chat works in", async () => {
  const { lanesOf } = await import("../src/ui/harness/space/space.js");
  const now = Date.now();
  const wt = (/** @type {string} */ place, /** @type {string} */ branch) => ({ ok: true, cwd: place, place, worktree: true, main: "/code/app", branch });
  const top = (/** @type {string} */ place) => ({ ok: true, cwd: place, place, worktree: false, main: place, branch: "main" });
  const world = {
    sessions: [
      { id: "c1", title: "On main", when: now, project: "p1", cwd: "/code/app", places: ["/code/app/.git/filament-worktrees/sa_2"] },
      { id: "c2", title: "In a worktree", when: now - 1000, project: "p1", cwd: "/code/app-wt" },
      { id: "c3", title: "Wrote in another", when: now - 2000, project: "p1", cwd: "/code/app", places: ["/code/app-fix"] },
      { id: "c4", title: "Elsewhere", when: now - 3000, project: "p1", cwd: "/other/repo" },
      { id: "c5", title: "Put away", when: now - 4000, project: "p1", cwd: "/code/app-old", archived: true },
      { id: "c6", title: "A helper", when: now - 5000, project: "p1", cwd: "/code/app/.git/filament-worktrees/sa_1", kind: "subagent" },
      { id: "c7", title: "Notes", when: now - 6000, project: "p3", cwd: "/notes" },
    ],
    projects: [{ id: "p1", name: "/code/app", cwd: "/code/app" }, { id: "p2", name: "/code/lib", cwd: "/code/lib" }, { id: "p3", name: "/notes", cwd: "/notes" }],
    where: {
      "/code/app": top("/code/app"), "/code/app-wt": wt("/code/app-wt", "wt"), "/code/app-fix": wt("/code/app-fix", "fix"), "/code/app-old": wt("/code/app-old", "old"),
      "/code/app/.git/filament-worktrees/sa_1": wt("/code/app/.git/filament-worktrees/sa_1", "sa_1"), "/code/app/.git/filament-worktrees/sa_2": wt("/code/app/.git/filament-worktrees/sa_2", "sa_2"),
      "/other/repo": top("/other/repo"), "/code/lib": top("/code/lib"),
      "/notes": { ok: false, cwd: "/notes", place: null, worktree: false, main: null, branch: null, error: "not in a git repository" },
    },
  };
  // The page's count of the same project, from what `/git/places` says of it: the server lists the repository's
  // worktrees, its helpers' copies left out, each with the listed chats whose folder is there or whose agents wrote there.
  const place = (/** @type {string} */ path, /** @type {boolean} */ main, /** @type {string[]} */ chats) => ({ path, name: path.split("/").pop(), main, ok: true, branch: "b", chats: chats.map((id) => ({ id, name: id })) });
  const page = lanesOf({ cwd: "/code/app", ok: true, main: "/code/app", places: [place("/code/app", true, ["c1", "c3"]), place("/code/app-wt", false, ["c2"]), place("/code/app-fix", false, ["c3"]), place("/code/app-old", false, [])], removed: [] },
    { chat: () => null, now: () => null, failed: () => false, modelName: (/** @type {string} */ id) => id });
  assert.deepEqual(page.map((l) => l.path).sort(), ["/code/app", "/code/app-fix", "/code/app-wt"], "the page's lanes");

  await drawBar(null, async (all, list) => {
    const facts = (/** @type {string} */ id) => {
      const row = all(list).find((x) => String(x.className).startsWith("space-row") && x.getAttribute("data-space") === id);
      return row ? all(row).find((x) => x.className === "space-row-facts")?.textContent : null;
    };
    // The folders are read after the list and the Spaces land: the rows gain their count then.
    for (let i = 0; i < 200 && !(facts("p1") === `${page.length} lanes` && facts("p2")); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(facts("p1"), `${page.length} lanes`, "the page's count");
    assert.equal(facts("p2"), "1 lane", "no chat there: its main folder, as its page says");
    assert.equal(facts("p3"), "", "no lane where git reads no repository, as its page says none");
  }, { open: { p1: 0, p2: 0, p3: 0 }, own: [] }, world);
});

// (fails before: yes — there was no one rule: the page's was a line of `lanesOf`, the bar's a loop of its own)
test("the lanes' one rule, which the page and the bar both read: the main folder first, each place of its repository once", async () => {
  const { lanePlaces } = await import("../src/ui/harness/lib/space-view.js");
  // Each place once however it is spelled; another repository's place is no lane of this one, nor a helper's copy
  // inside the repository's own git folder.
  assert.deepEqual(lanePlaces("/code/app", [
    { place: "/code/app-wt", main: "/code/app" }, { place: "/code/app", main: "/code/app" }, { place: "\\CODE\\app-wt\\", main: "/code/app" },
    { place: "/other/repo", main: "/other/repo" }, { place: "/other/repo-wt", main: "/other/repo" }, { place: "/code/app/.git/filament-worktrees/sa_1", main: "/code/app" }, null, {},
  ]), ["/code/app", "/code/app-wt"]);
  assert.deepEqual(lanePlaces("/code/app", []), ["/code/app"], "the main folder always");
  assert.deepEqual(lanePlaces(null, [{ place: "/bare-wt", main: null }]), ["/bare-wt"], "a repository with no main folder: the places in use");
  // Both read it, and neither keeps a rule of its own beside it.
  const { readFileSync } = await import("node:fs");
  const read = (/** @type {string} */ rel) => readFileSync(new URL(`../src/ui/harness/${rel}`, import.meta.url), "utf8");
  assert.match(read("space/space.js"), /lanePlaces\(/, "the page");
  assert.match(read("sidebar.js"), /lanePlaces\(/, "the bar");
});

/** What this drawing's `GET /api/spaces` says besides: read where the fetch is called, the page's api keeping the first
 *  test's fetch for every later one. @type {Record<string, any>} */
let spacesSaid = {};
/** This drawing's chats and projects, where it has its own; and what `GET /api/git/where` says of each folder (none:
 *  unread). @type {{ sessions?: any[], projects?: any[], where?: Record<string, any> }} */
let worldSaid = {};

/**
 * The bar drawn on the stub document with two Spaces of your own and a project, organized as `organize` says; `spaces`,
 * what `GET /api/spaces` says besides; `world`, its own chats and projects and what git reads of their folders.
 * @param {string | null} organize @param {(all: (el: any) => any[], list: any, host: any, sb: any) => void | Promise<void>} check
 * @param {Record<string, any>} [spaces] @param {{ sessions?: any[], projects?: any[], where?: Record<string, any> }} [world]
 */
async function drawBar(organize, check, spaces = {}, world = {}) {
  spacesSaid = spaces;
  worldSaid = world;
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "harness.organize" ? organize : null), setItem() {}, removeItem() {} };
  const now = Date.now();
  g.fetch = async (/** @type {string} */ url) => {
    const u = String(url);
    const body = u.includes("/api/spaces")
      ? { open: {}, needs: {}, extended: true, next: null, own: [{ project: "w1", name: "Work", folder: "/docs/Work" }, { project: "e1", name: "Empty", folder: "/docs/Empty" }], ...spacesSaid }
      : u.includes("/api/git/where")
        ? { places: Object.fromEntries(new URL(u, "http://page").searchParams.getAll("cwd").map((f) => [f, worldSaid.where?.[f] || null])) }
        : {
          sessions: worldSaid.sessions || [
            { id: "c1", title: "Fix the build", when: now, project: "p1", cwd: "/code/app" },
            { id: "c2", title: "Triage my mentions", when: now - 1000, project: "w1", cwd: "/docs/Work" },
          ],
          projects: worldSaid.projects || [{ id: "p1", name: "/code/app", cwd: "/code/app" }, { id: "w1", name: "Work", cwd: "/docs/Work" }, { id: "e1", name: "Empty", cwd: "/docs/Empty" }],
          runs: [],
        };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {}, onYourSpace() {} });
    await sb.load();
    await new Promise((r) => setTimeout(r, 10));
    /** Every element under one, in order. @param {any} el @returns {any[]} */
    const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];
    const list = all(host).find((x) => x.className === "sess-list");
    assert.ok(list, "the list is drawn");
    await check(all, list, host, sb);
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
}
