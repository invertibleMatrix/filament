// @ts-check
// E42 AS3, SA-D6: an agent of the project reads the lanes as the Space's page reads them (HarnessV4_AgentsSpace_Plan
// case 19) — each place where one of the project's chats works and the main folder always, its branch and what it holds
// that its base lacks, its chats working or idle and since when, what it changed, committed and not; and the Overlaps,
// each file two lanes change with both named. Twenty places at most a read; a place git could not read says why; the
// asking chat is "you". In Filament's own loop and in a coding agent's call alike, reading only.
// (fails before: yes — the space tool had no lanes action: an agent saw no other chat's place nor what it changed)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSpaceLanes, lanesWords, LANES_MAX } from "../src/app/space-lanes.js";
import { SPACE_TOOL, spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { momentWords } from "../src/core/space.js";

const AT = Date.UTC(2026, 9, 26, 14, 0);
const MAIN = { path: "/work/app", name: "app", main: true, ok: true, missing: false, branch: "main", base: null, onBase: true, ahead: null, uncommitted: { files: 1 } };
const LOGIN = { path: "/work/app-wt/login", name: "login", main: false, ok: true, missing: false, branch: "feat/login", base: "main", onBase: false, ahead: 2, uncommitted: { files: 0 } };
const DOCS = { path: "/work/app-wt/docs", name: "docs", main: false, ok: true, missing: false, branch: "docs/api", base: "main", onBase: false, ahead: 0, uncommitted: { files: 0 } };
const SPARE = { path: "/work/app-wt/spare", name: "spare", main: false, ok: true, missing: false, branch: "spare", base: "main", onBase: false, ahead: 0, uncommitted: { files: 0 } };
const f = (/** @type {string} */ path, committed = false, uncommitted = !committed) => ({ path, committed, uncommitted });
const FILES = /** @type {Record<string, any>} */ ({
  "/work/app": { ok: true, files: [f("src/auth/redirect.ts"), f("README.md")], more: 0 },
  "/work/app-wt/login": { ok: true, files: [f("src/auth/redirect.ts", true), f("src/auth/login.ts", true, true)], more: 0 },
  "/work/app-wt/docs": { ok: true, files: [], more: 0 },
});

/** A project with three chats, two of whose places change one file; one place no chat works in. @param {Record<string, any>} [o] */
function lanesOf(o = {}) {
  /** @type {string[]} */
  const read = [];
  const lanes = createSpaceLanes({
    folderOf: (p) => (p === "p1" ? "/work/app" : null),
    places: async () => ({ ok: true, places: [LOGIN, MAIN, DOCS, SPARE] }),
    chatsIn: (folders) =>
      new Map(folders.map((p) => [p, /** @type {any[]} */ ({
        "/work/app": [{ id: "c1", name: "Release", home: true }],
        "/work/app-wt/login": [{ id: "c2", name: "Login", home: true }, { id: "c1", name: "Release", home: false }],
        "/work/app-wt/docs": [{ id: "c3", name: "Docs", home: true }],
      }[p] || [])])),
    filesOf: async (p) => (read.push(p), { path: p, branch: null, base: null, ahead: null, commits: 0, ...FILES[p] }),
    atWork: () => new Set(["c2"]),
    lastAt: (c) => ({ c1: AT - 3_600_000, c2: AT - 60_000, c3: AT - 7_200_000 })[c] ?? null,
    ...o,
  });
  return { lanes, read };
}

describe("the lanes read (case 19)", () => {
  test("each place a chat works in and the main folder, in the page's order; the Overlap named with both lanes", async () => {
    const { lanes, read } = lanesOf();
    const r = await lanes.read("p1");
    assert.ok(r.ok);
    assert.deepEqual(r.lanes.map((l) => [l.name, l.chats.map((c) => [c.name, c.working])]), [
      ["main", [["Release", false]]],
      ["feat/login", [["Login", true], ["Release", false]]],
      ["docs/api", [["Docs", false]]],
    ], "the main folder first, then the one at work; a place no chat works in is no lane");
    assert.deepEqual(read.sort(), ["/work/app", "/work/app-wt/docs", "/work/app-wt/login"], "each lane's files read once");
    assert.deepEqual(r.shared, [{ path: "src/auth/redirect.ts", lanes: ["main", "feat/login"] }]);
    assert.equal(r.left, 0);
  });

  test("in words: the places, who works where and since when, what each changed; the asking chat is you", async () => {
    const r = await lanesOf().lanes.read("p1");
    const text = lanesWords(r, { self: "c1", now: AT });
    assert.deepEqual(text.split("\n"), [
      // (fails before: yes — d-send's third follow-up: "3 places"; a lane is a folder or worktree a chat works in)
      `The lanes of this project, as of ${momentWords(AT)}: 3 lanes where its chats work, the main folder first.`,
      "- the main folder · /work/app, on main: 1 file changed, not committed",
      `  chats: Release (you) — idle since ${momentWords(AT - 3_600_000)}`,
      "  changed: src/auth/redirect.ts (not committed); README.md (not committed)",
      "- feat/login · /work/app-wt/login: 2 commits not on main",
      // Each other chat with its id, by which a watcher's trigger names it.
      `  chats: Login (chat:c2) — working; Release (you) (its agents wrote here) — idle since ${momentWords(AT - 3_600_000)}`,
      "  changed: src/auth/redirect.ts (committed); src/auth/login.ts (committed, and changed since)",
      "- docs/api · /work/app-wt/docs: merged into main",
      `  chats: Docs (chat:c3) — idle since ${momentWords(AT - 7_200_000)}`,
      "  changed: nothing its base lacks",
      "Overlaps — files two lanes or more change: src/auth/redirect.ts (main, feat/login). Say so in the logbook before you change one of them.",
    ]);
  });

  test("none shared: said; a place git could not read, or whose files it could not, says why", async () => {
    const gone = { ...DOCS, missing: true, ok: false };
    const { lanes } = lanesOf({
      places: async () => ({ ok: true, places: [MAIN, LOGIN, gone] }),
      filesOf: async (/** @type {string} */ p) => (p === "/work/app" ? { path: p, ok: false, error: "outside the allowed folders", branch: null, base: null, ahead: null, commits: 0, files: [], more: 0 } : { path: p, ok: true, files: [f("a.js")], more: 3, branch: null, base: null, ahead: null, commits: 0 }),
    });
    const text = lanesWords(await lanes.read("p1"), { self: "c9", now: AT });
    assert.ok(text.includes("  changed: not read — outside the allowed folders"), text);
    assert.ok(text.includes("  changed: a.js (not committed); and 3 more"), text);
    assert.ok(text.includes("- docs/api · /work/app-wt/docs: its folder is gone; git keeps its record\n  chats: Docs (chat:c3) — idle since"), text);
    assert.ok(text.endsWith("No overlaps: no file is changed by two lanes."), text);
  });

  test(`${LANES_MAX} places at most: the rest counted, not read`, async () => {
    const many = Array.from({ length: LANES_MAX + 3 }, (_, i) => ({ ...LOGIN, path: `/w/${i}`, name: `w${i}`, branch: `b${i}` }));
    const { lanes, read } = lanesOf({
      places: async () => ({ ok: true, places: [MAIN, ...many] }),
      chatsIn: (/** @type {string[]} */ folders) => new Map(folders.map((p, i) => [p, [{ id: `c${i}`, name: `chat ${i}`, home: true }]])),
    });
    const r = await lanes.read("p1");
    assert.ok(r.ok);
    assert.deepEqual([r.lanes.length, r.left, read.length], [LANES_MAX, 4, LANES_MAX]);
    assert.ok(lanesWords(r, { self: "x", now: AT }).includes(`And 4 more lanes, not read: one read reads ${LANES_MAX} at most.`));
  });

  test("a project with no folder, or a repository git cannot read: refused in words", async () => {
    assert.deepEqual(await lanesOf().lanes.read("p9"), { ok: false, error: "the project has no folder" });
    const r = await lanesOf({ places: async () => ({ ok: false, error: "not a git repository" }) }).lanes.read("p1");
    assert.equal(lanesWords(r, { self: "c1", now: AT }), "Not read: not a git repository.");
  });
});

describe("the space tool's lanes action", () => {
  const atOf = (/** @type {Record<string, any>} */ o = {}) => /** @type {import("../src/app/agent/space.js").SpaceAt} */ ({
    store: createSpaceStore({ dir: null, now: () => AT }), project: "p1", chain: "c2", name: null, nameOf: (/** @type {string} */ c) => c, on: () => true,
    lanes: (/** @type {string} */ p) => lanesOf().lanes.read(p), ...o,
  });

  test("read whole, through spaceRun; named in the door and the guide; a word for it read as meant", async () => {
    const r = await spaceRun({ action: "lanes" }, atOf(), AT);
    assert.ok(r.ok && r.text.includes("  chats: Login (you) — working; Release (chat:c1) (its agents wrote here)"), JSON.stringify(r));
    assert.match(SPACE_TOOL.description, /whose fields go in with: [\w, ]*\blanes\b[\w, ]*;/);
    assert.ok(/** @type {any} */ (spaceGuide(null)).text.includes("\n- lanes: where each of the project's chats works — its folder, its branch, working or idle, what it changed — and the Overlaps"), "the guide's index says it in a few words");
    assert.deepEqual(spaceGuide("worktrees"), spaceGuide("lanes"));
    assert.ok(/** @type {any} */ (spaceGuide("lanes")).text.startsWith("## lanes — where each chat works\n"));
    // (fails before: yes — d-send's third follow-up: the topic said "Each place of this project's repository" and "20
    // places at most"; "place" is the code's word, said to no one)
    const topic = String(/** @type {any} */ (spaceGuide("lanes")).text);
    assert.ok(topic.includes("\nEach folder or worktree of this project's repository where one of its chats works — its folder is there, or its agents wrote there — "), topic);
    assert.ok(topic.includes(`then the newest; ${LANES_MAX} lanes at most. Read it before`), topic);
    assert.doesNotMatch(topic, /\bplaces?\b/);
    assert.deepEqual(await spaceRun({ action: "lanes" }, atOf({ lanes: null }), AT), { ok: false, error: "Not read: the lanes are not wired in this Filament." });
    assert.deepEqual(await spaceRun({ action: "lanes" }, atOf({ on: () => false }), AT), { ok: false, error: "Not run: the person switched the space tool off for this chat. Say in your answer what you would have written." });
    assert.deepEqual(spaceCall({ action: "lanes" }, atOf()), { ok: false, error: "Not run: the lanes action reads git, and is answered by Filament's own call of the tool." });
  });

  test("a coding agent's call reads them, asking nothing", async () => {
    const store = createSpaceStore({ dir: null, now: () => AT });
    const tools = createAgentTools(/** @type {any} */ ({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store, projectOf: () => "p1", nameOf: (/** @type {string} */ c) => c, on: () => true, lanes: (/** @type {string} */ p) => lanesOf().lanes.read(p) },
    }));
    const r = await tools.call("space", { action: "lanes" }, /** @type {any} */ ({ cwd: "/r", chain: "c3", permit: null }));
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /^The lanes of this project, as of /);
    assert.ok(r.text.includes("  chats: Docs (you) — idle since"));
  });
});
