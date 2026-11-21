// @ts-check
// A worktree template on the page (HarnessV4_Four_Plan E19): the copy line's words (FO-D34), the picker's rows and
// what it saves (FO-D35), the turn's waiting words while the copy runs (FO-D36), the copy's row and how it lands on the
// turns (FO-D37), the Move sheet's words beside a copy (FOC-67), and where the page wires the row. The line drawn in
// the start's own page is test/works-in.test.js's; the server's side is test/worktree-template.test.js's.
// (fails before: yes — no page said anything of a copy into a worktree)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked the server: the address and the body. @type {{ url: string, body: any }[]} */
const asked = [];
/**
 * What the stand-in server answers, by address; null leaves it unanswered, `{ refused, error }` answers that status.
 * @type {(url: string) => any}
 */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  asked.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  const body = serve(String(url));
  if (body == null) return new Promise(() => {});
  const status = body.refused || 200;
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const { copyLineWords, candidateWords, copyPicker, isInside, listPath } = await import("../src/ui/harness/worktree-copy.js");
const { copiedWords, sizeWords, skipWaitWords, turnPhaseWords } = await import("../src/ui/harness/lib/labels.js");
const { withCopy, placeBoundary } = await import("../src/ui/harness/conversation/history.js");
const { moveWords } = await import("../src/ui/harness/move-sheet.js");
const { h } = await import("../src/ui/lib/dom.js");

const GB = 1024 ** 3;

describe("the words", () => {
  test("a size up to GB; a path as the list keeps it; inside a folder of the list", () => {
    assert.deepEqual([20, 3 * 1024 * 1024, 8.4 * GB].map(sizeWords), ["20 bytes", "3.0 MB", "8.4 GB"]);
    assert.deepEqual(["./Library/", "Assets\\Big", " .env "].map(listPath), ["Library", "Assets/Big", ".env"]);
    assert.deepEqual([isInside("Library/cache", "Library"), isInside("Library", "Library"), isInside("Library2", "Library")], [true, true, false]);
  });

  test("the copy line: each entry on unless left off, not here said and still sent, the total of two or more", () => {
    const t = { ok: true, from: "project", entries: [
      { path: "Library", bytes: 2 * GB, files: 10, missing: false, link: false },
      { path: "pnpm", bytes: 0, files: 0, missing: false, link: true },
      { path: "gone", bytes: 0, files: 0, missing: true },
    ] };
    const w = copyLineWords(t, []);
    assert.deepEqual(w.entries.map((e) => [e.path, e.on, e.size]), [["Library", true, "2.0 GB"], ["pnpm", true, "0 bytes"], ["gone", false, "not here"]]);
    assert.equal(w.entries[1].title, "pnpm: 0 files, a link: copied as a link");
    assert.deepEqual([w.total, w.from, w.empty, w.paths], ["2.0 GB", "", false, ["Library", "pnpm", "gone"]]);
    assert.deepEqual(copyLineWords(t, ["Library"]).paths, ["pnpm", "gone"]);
    assert.equal(copyLineWords(t, ["Library"]).total, "", "one left on: no total");
    assert.equal(copyLineWords({ ...t, from: "global" }, []).from, "from your defaults");
    assert.equal(copyLineWords({ ok: true, entries: [] }, []).empty, true);
  });

  test("a picker row: ignored or not in git, a link, size and files; one inside a ticked folder goes with it", () => {
    assert.deepEqual(candidateWords({ path: "Library", ignored: true, dir: true, bytes: GB, files: 1200 }, []), { kind: "ignored by git", size: "1.0 GB · 1,200 files", under: null });
    assert.deepEqual(candidateWords({ path: "notes.txt", ignored: false, bytes: 12, files: 1 }, []), { kind: "not in git", size: "12 bytes", under: null });
    assert.equal(candidateWords({ path: "node_modules", ignored: true, link: true, dir: false, bytes: 0, files: 0 }, []).kind, "ignored by git · a link");
    assert.equal(candidateWords({ path: "Library/cache", ignored: true, bytes: 5, files: 1 }, ["Library"]).under, "Library");
  });

  test("the turn's waiting words while the copy runs, and Send without it's (FO-D36)", () => {
    assert.equal(turnPhaseWords({ kind: "copying", copy: { done: 3.1 * GB, total: 8.4 * GB, entry: "Library" } }), "copying into the worktree first — Library, 3.1 GB of 8.4 GB; your message goes to the model once it's done");
    assert.equal(turnPhaseWords({ kind: "copying", copy: null }), "copying into the worktree first; your message goes to the model once it's done");
    assert.equal(skipWaitWords({ kind: "copying" }), "Send your message now: the copy into the worktree carries on beside the turn");
  });

  test("the copy's row: running, done with size, files and time, what it did not copy and why, cut (FO-D37, FOC-62, FOC-64, FOC-70)", () => {
    const base = { into: "game-jump", paths: ["Library", ".env", "gone"] };
    assert.deepEqual(copiedWords({ ...base, state: "running" }), { text: "Copying Library, .env and gone into game-jump…", notes: [] });
    const result = { copied: ["Library", ".env"], skipped: [{ path: "gone", why: "not here" }, { path: "../x", why: "../x: inside the repository only" }], failed: [{ path: "Library/lock", error: "a program is using it (EBUSY)" }], failedMore: 2, bytes: 8.4 * GB, files: 91204, total: 8.4 * GB, cut: null };
    const done = copiedWords({ ...base, state: "done", ms: 72_000, result });
    assert.equal(done.text, "Copied Library and .env into game-jump · 8.4 GB, 91,204 files, 1m 12s");
    assert.deepEqual(done.notes, ["gone is not here, so not copied", "../x not copied: ../x: inside the repository only", "Library/lock not copied: a program is using it (EBUSY)", "and 2 more not copied"]);
    const cut = copiedWords({ ...base, state: "done", ms: 5000, result: { ...result, skipped: [], failed: [], failedMore: 0, bytes: 3.1 * GB, cut: "Filament stopped while it copied" } });
    assert.equal(cut.text, "The copy into game-jump was cut at 3.1 GB of 8.4 GB: Filament stopped while it copied. What was copied stays");
    assert.equal(copiedWords({ ...base, state: "cut", why: "Filament stopped while it copied" }).text, "The copy of Library, .env and gone into game-jump was cut: Filament stopped while it copied. What was copied stays");
    assert.equal(copiedWords({ into: "w", paths: ["a", "b", "c", "d", "e"], state: "running" }).text, "Copying a, b, c and 2 more into w…");
  });

  test("the Move sheet: what git ignores is not carried, but for what the line copies (FOC-67)", () => {
    const plan = { to: { new: true, folder: "H:/w/game-x", branch: "x" }, from: { name: "game", branch: "main" }, goes: [], stays: [], ignored: { names: ["Library", ".env"], more: 0 }, running: [], blocked: [] };
    assert.equal(moveWords(plan, "", []).ignored, "Not carried: what git ignores — Library, .env. The agent is told.");
    assert.equal(moveWords(plan, "", ["Library"]).ignored, "Not carried: what git ignores — Library, .env, but for what the line above copies. The agent is told.");
    assert.equal(moveWords({ ...plan, to: { name: "game-y", branch: "y" } }, "", ["Library"]).ignored, "Not carried: what git ignores — Library, .env. The agent is told.", "an existing place gets no copy");
  });
});

describe("the row on the turns", () => {
  test("placed after the turn it followed; the same copy's row replaced in place as it ends", () => {
    const turns = [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, boundaries: [], boundariesAfter: [] }];
    const running = { type: "copied", id: "c1", afterTurn: 0, state: "running" };
    assert.equal(withCopy(turns, running), turns[0], "before the chat's first turn");
    const done = { ...running, state: "done" };
    assert.equal(withCopy(turns, done), turns[0]);
    assert.deepEqual(turns[0].boundaries, [done], "one row, the newest");
    const later = { type: "copied", id: "c2", afterTurn: 2, state: "running" };
    assert.equal(placeBoundary(turns, later), turns[1]);
    assert.deepEqual(turns[1].boundariesAfter, [later], "after the newest turn");
    assert.equal(withCopy([], running), null, "no turn to hold it");
  });

  test("the page draws it and hears it: the row, the feed, the turn's end, and its look", () => {
    const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(timeline, /if \(b\.type === "copied"\) \{[\s\S]{0,400}copiedWords\(b\)[\s\S]{0,900}boundary-row is-copied/);
    assert.match(timeline, /turn\.copies = \(tr\.boundaries \|\| \[\]\)\.filter\(\(b\) => b\.type === "copied"\)/, "a copy told before the page knew the chat is read at its turn's end");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /msg\?\.type !== "worktree-copy"[\s\S]{0,200}chatByChain\(String\(msg\.chainId\)\)[\s\S]{0,80}placeCopy\(chat, msg\.boundary\)/);
    assert.match(app, /for \(const b of turn\.copies \|\| \[\]\) placeCopy\(chat, b\);/);
    const css = readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8");
    assert.match(css, /\.boundary-row\.is-copied \.boundary-label \{[^}]*white-space: normal;/);
    assert.match(css, /\.boundary-row\.is-copied\.is-cut \.boundary-label \{[^}]*--color-sys-orange/);
  });
});

describe("the picker, in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    // The dialog asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  beforeEach(() => {
    asked.length = 0;
    doc.document.body.replaceChildren();
  });

  const CANDIDATES = {
    ok: true, project: "game", copy: ["Library", "Keys/dev.pem"], from: "project", entries: [],
    candidates: { ok: true, more: 3, items: [
      { path: "Library", dir: true, link: false, bytes: 8.4 * GB, files: 91204, missing: false, ignored: true },
      { path: "Library/cache", dir: true, link: false, bytes: GB, files: 20, missing: false, ignored: true },
      { path: "Temp", dir: true, link: false, bytes: 2 * GB, files: 300, missing: false, ignored: true },
      { path: "notes.txt", dir: false, link: false, bytes: 12, files: 1, missing: false, ignored: false },
    ] },
  };
  const rowsOf = () => doc.document.body.querySelectorAll(".wt-pick-row").map((/** @type {any} */ r) => [r.querySelector(".wt-pick-path").textContent, r.querySelector(".wt-pick-kind").textContent, r.querySelector(".wt-pick-size").textContent, !!r.querySelector("input").checked, !!r.querySelector("input").disabled]);

  // (fails before: yes — no picker)
  test("what git leaves out, biggest first, the list ticked, one under a ticked folder with it; filter, add, Save for the project (FO-D35, FOC-55, FOC-56)", async () => {
    serve = (u) => (u.startsWith("/api/git/places/template?") ? CANDIDATES : u === "/api/git/places/template" ? { ok: true, project: "game", copy: ["Library", "Keys/dev.pem", "Temp", "UserSettings"], from: "project" } : null);
    /** @type {any[]} */
    const saved = [];
    copyPicker({ folder: "H:\\w\\game", project: "game", list: ["Library", "Keys/dev.pem"], onSaved: (t) => saved.push(t) });
    assert.equal(doc.document.body.querySelector(".wt-pick-rows .mv-quiet")?.textContent, "Measuring what git leaves out of a worktree…");
    await until(() => rowsOf().length === 5, "the candidates drawn");
    assert.equal(asked[0].url, "/api/git/places/template?cwd=H%3A%5Cw%5Cgame&all=1");
    assert.deepEqual(rowsOf(), [
      ["Keys/dev.pem", "on the list", "", true, false],
      ["Library", "ignored by git", "8.4 GB · 91,204 files", true, false],
      ["Library/cache", "with Library", "1.0 GB · 20 files", true, true],
      ["Temp", "ignored by git", "2.0 GB · 300 files", false, false],
      ["notes.txt", "not in git", "12 bytes", false, false],
    ]);
    assert.match(doc.document.body.querySelector(".wt-pick-rows").textContent, /and 3 more — filter to find one, or add its path/);
    const temp = /** @type {any} */ (doc.document.body.querySelectorAll(".wt-pick-row")[3].querySelector("input"));
    temp.checked = true;
    temp.dispatch("change");
    const filter = doc.document.body.querySelector(".wt-pick-filter");
    filter.value = "note";
    filter.dispatch("input");
    assert.deepEqual(rowsOf().map((r) => r[0]), ["notes.txt"]);
    const add = doc.document.body.querySelector(".wt-pick-add");
    add.value = " UserSettings/ ";
    add.dispatch("keydown", { key: "Enter" });
    filter.value = "";
    filter.dispatch("input");
    assert.equal(rowsOf()[1][0], "UserSettings", "a typed path stands with the list's own");
    const save = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-dialog-foot button").at(-1));
    assert.equal(save.textContent, "Save for game");
    save.dispatch("click");
    await until(() => saved.length === 1, "saved");
    assert.deepEqual(asked.at(-1), { url: "/api/git/places/template", body: { cwd: "H:\\w\\game", copy: ["Library", "Keys/dev.pem", "Temp", "UserSettings"] } });
    assert.equal(doc.document.body.querySelector(".wt-pick"), null, "the sheet closed");
  });

  test("a refusal stays on the sheet in the server's words; git unable to list says so, the list's own still shown (FOC-68)", async () => {
    serve = (u) =>
      u.startsWith("/api/git/places/template?") ? { ok: false, error: "not in a git repository", copy: ["Library"], entries: [], candidates: null }
      : u === "/api/git/places/template" ? { refused: 400, error: "../x: inside the repository only" }
      : null;
    copyPicker({ folder: "H:\\plain", project: "plain", list: ["Library"], onSaved: () => {} });
    await until(() => doc.document.body.querySelector(".wt-pick-rows .mv-quiet")?.textContent === "not in a git repository", "why said");
    assert.deepEqual(rowsOf().map((r) => r[0]), ["Library"]);
    const add = doc.document.body.querySelector(".wt-pick-add");
    add.value = "../x";
    add.dispatch("keydown", { key: "Enter" });
    /** @type {any} */ (doc.document.body.querySelectorAll(".zc-dialog-foot button").at(-1)).dispatch("click");
    await until(() => doc.document.body.querySelector(".mv-said.is-err"), "the refusal said");
    assert.match(doc.document.body.querySelector(".mv-said").textContent, /inside the repository only/);
    assert.ok(doc.document.body.querySelector(".wt-pick"), "the sheet stays to put it right");
  });
});
