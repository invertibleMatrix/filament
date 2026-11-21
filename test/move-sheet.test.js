// @ts-check
// Move a chat to a worktree, the page (HarnessV4_Git_Plan §12): the sheet's words, the row a move leaves between turns
// (placed after the turn it followed, gone with Move back), and the sheet drawn in a stand-in page against a stand-in
// server — the read as it opens, its rows, a blocked read that greys Move, a place chosen, a typed name, Move's body,
// a refusal that brings a new read (GWC-167). The server's side is test/chat-move.test.js's.
// (fails before: yes — nothing moved a chat)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page read, in order. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** A refusal the stand-in server answers, in the server's words, with what it says beside them. */
class Refusal {
  /** @param {number} status @param {string} error @param {any} [extra] */
  constructor(status, error, extra = {}) {
    this.status = status;
    this.body = { error, ...extra };
  }
}
/**
 * What the stand-in server answers by the whole address and the method; undefined for a 404; a promise, an answer
 * held back until the test lets it land.
 * @type {(url: string, method: string) => any}
 */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method === "GET") asked.push(String(url));
  else posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = await serve(String(url), method);
  if (body instanceof Refusal) return new Response(JSON.stringify(body.body), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { moveSheet, moveWords } = await import("../src/ui/harness/move-sheet.js");
const { movedWords } = await import("../src/ui/harness/lib/labels.js");
const { placeBoundary, mergedTurns, withoutMove } = await import("../src/ui/harness/conversation/history.js");

after(() => {
  g.fetch = realFetch;
});

/** A read of the sheet as the server answers it: two files go, one stays for a reason and one is committed. */
const PLAN = {
  from: { place: "H:/w/proj", cwd: "H:\\w\\proj", name: "proj", branch: "main" },
  to: { new: true, name: "fix-login-redirect", branch: "fix-login-redirect", folder: "H:/w/proj-fix-login-redirect", cwd: "H:/w/proj-fix-login-redirect" },
  goes: [
    { path: "src/a.js", status: "modified", added: 3, removed: 1, agent: "" },
    { path: "src/new.js", status: "added", added: 10, removed: 0, agent: "" },
  ],
  stays: [
    { path: "README.md", status: "modified", agent: "", why: "changed since its agent last wrote it" },
    { path: "done.js", status: "modified", agent: "", why: "committed" },
  ],
  others: 2,
  ignored: { names: ["node_modules", ".env"], more: 0 },
  running: [{ id: "b1", command: "npm run dev", startedAt: 1 }],
  blocked: [],
};

describe("the words", () => {
  test("the sheet says where to, what goes, what stays and why, the rest in a line each", () => {
    assert.deepEqual(moveWords(PLAN, "H:\\w\\proj"), {
      where: "A new worktree H:\\w\\proj-fix-login-redirect on a new branch fix-login-redirect, made from main's commit.",
      goes: "Goes · 2 files",
      stays: "Stays in proj · 1 file",
      committed: "1 of its files is committed: nothing to carry.",
      others: "2 other uncommitted files in proj stay where they are.",
      ignored: "Not carried: what git ignores — node_modules, .env. The agent is told.",
      running: ["Still running in proj, left running: npm run dev"],
      blocked: "",
    });
    const there = moveWords({
      ...PLAN, to: { new: false, place: "H:/w/proj-done", name: "proj-done", branch: "done" }, goes: [], stays: [], others: 1,
      ignored: { names: ["a", "b", "c", "d", "e"], more: 3 }, running: [], blocked: ["src/a.js differs between the two commits", "later"],
    });
    assert.deepEqual(there, {
      where: "proj-done, on done: its files land there as uncommitted changes.",
      goes: "Nothing uncommitted of its own in proj: the chat moves alone.",
      stays: "",
      committed: "",
      others: "1 other uncommitted file in proj stays where it is.",
      ignored: "Not carried: what git ignores — a, b, c, d, e, and 3 more. The agent is told.",
      running: [],
      blocked: "src/a.js differs between the two commits",
    });
    // A folder that ignores nothing says nothing of it; a name git refuses has no folder to say.
    assert.equal(moveWords({ ...PLAN, ignored: { names: [], more: 0 } }).ignored, "");
    assert.equal(moveWords({ ...PLAN, to: { new: true, name: "..", folder: null } }).where, "");
  });

  test("a move's row: from where to where, the branch where the folder is not named for it, the files it carried", () => {
    assert.equal(movedWords({ from: "proj", to: "proj-fix", branch: "fix", files: 3 }), "Moved from proj to proj-fix (fix) · 3 files carried");
    assert.equal(movedWords({ from: "proj", to: "proj-done", branch: "proj-done", files: 1 }), "Moved from proj to proj-done · 1 file carried");
    assert.equal(movedWords({ from: "proj", to: "x", branch: null, files: 0 }), "Moved from proj to x · no file of its own to carry");
  });
});

describe("the row between turns", () => {
  const turns = () => [1, 2].map((n) => ({ n, boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) }));

  // (fails before: yes — placeBoundary dropped every row but a settings change, a compaction and a sub-agent's mark)
  test("a move sits after the turn it followed: before the next one, else after the last", () => {
    const t = turns();
    assert.equal(placeBoundary(t, { type: "moved", id: "m1", afterTurn: 1 }), t[1]);
    assert.equal(placeBoundary(t, { type: "moved", id: "m2", afterTurn: 2 }), t[1]);
    assert.deepEqual([t[1].boundaries.map((b) => b.id), t[1].boundariesAfter.map((b) => b.id)], [["m1"], ["m2"]]);
  });

  // (fails before: yes — a turn this page keeps its own copy of held the row of a move taken back through the reload)
  test("Move back takes the row away, which a turn this page drew itself would keep through the reload; a reload's copy wins", () => {
    const row = { type: "moved", id: "m1", afterTurn: 2, undoable: true };
    /** @type {() => any[]} */
    const page = () => [{ n: 1, past: true, boundaries: [], boundariesAfter: [] }, { n: 2, boundaries: [], boundariesAfter: [{ ...row }] }];
    /** @type {() => any[]} */
    const server = () => [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, fromTranscript: true, boundaries: [], boundariesAfter: [] }];
    assert.equal(mergedTurns(page(), server())[1].boundariesAfter.length, 1, "without it the page's own row stays");
    const mine = page();
    assert.deepEqual(withoutMove(mine, "m1"), [mine[1]]);
    assert.equal(mergedTurns(mine, server())[1].boundariesAfter.length, 0);
    assert.deepEqual(withoutMove(mine, "m1"), [], "nothing left to take");
    // A newer read of the same move (no longer undoable once a turn ran) stands in for the page's.
    const read = server();
    read[1].boundariesAfter.push({ ...row, undoable: false });
    assert.deepEqual(mergedTurns(page(), read)[1].boundariesAfter.map((b) => b.undoable), [false]);
  });
});

describe("the sheet, in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
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
  });
  beforeEach(() => {
    asked.length = 0;
    posted.length = 0;
    doc.document.body.replaceChildren();
  });

  const PLACES = {
    ok: true,
    places: [
      { path: "H:/w/proj", name: "proj", main: true, branch: "main", ok: true },
      { path: "H:/w/proj-done", name: "proj-done", branch: "done", ok: true },
      { path: "H:/w/proj-gone", name: "proj-gone", branch: "gone", missing: true },
    ],
  };
  const PLACES_URL = "/api/git/places?cwd=H%3A%5Cw%5Cproj";
  const MADE_URL = "/api/sessions/c1/move?name=fix-login-redirect&made=1";
  const DONE = { ok: true, cwd: "H:\\w\\proj-fix-login-redirect", move: { type: "moved", id: "m1" }, running: [] };
  /** The sheet opened on a chat in H:\w\proj, named by its first message; `hear`, the feed it hears while open. @param {any} [hear] */
  const opened = (hear) => {
    /** The moves the sheet handed on as they went, before their answers. @type {Promise<any>[]} */
    const moving = [];
    /** @type {any[]} */
    const moved = [];
    /** @type {string[]} */
    const toasts = [];
    const d = moveSheet({ chat: { chainId: "c1", cwd: "H:\\w\\proj" }, title: "Fix the login redirect", onMoving: (m) => void moving.push(m), onMoved: (x) => void moved.push(x), onToast: (m) => void toasts.push(m), hear });
    const body = doc.document.body;
    /** @type {any} */
    const moveBtn = body.querySelectorAll(".zc-dialog-foot .zc-btn").find((/** @type {any} */ b) => b.textContent === "Move");
    assert.ok(moveBtn, "the sheet's Move");
    return { d, moving, moved, toasts, placeIn: /** @type {any} */ (body.querySelector(".mv-place")), nameIn: /** @type {any} */ (body.querySelector(".mv-name")), moveBtn };
  };
  /** Each file row as the sheet draws it: its letter, its path, its counts or why it stays. */
  const fileRows = () =>
    doc.document.body.querySelectorAll(".mv-file").map((/** @type {any} */ r) => [
      r.querySelector(".git-letter").textContent,
      r.querySelector(".chg-path").textContent,
      (r.querySelector(".mv-why") || r.querySelector(".zc-diff")).textContent,
    ]);
  const text = (/** @type {string} */ sel) => doc.document.body.querySelector(sel)?.textContent ?? null;
  const lines = () => doc.document.body.querySelector(".mv-list").querySelectorAll("p").map((/** @type {any} */ p) => p.textContent);

  test("it reads as it opens: where to, each file that goes with its counts, each that stays with why, the rest; Move posts the files it showed and the chat moves (GWC-159, GW-D84)", async () => {
    serve = (u, m) => (u === PLACES_URL ? PLACES : u === MADE_URL ? PLAN : u === "/api/sessions/c1/move" && m === "POST" ? DONE : undefined);
    const s = opened();
    assert.equal(s.moveBtn.disabled, true, "nothing to move until the read lands");
    await until(() => doc.document.body.querySelector(".mv-file"), "the read drawn");
    assert.equal(s.nameIn.value, "fix-login-redirect", "named from the chat's title");
    assert.equal(text(".mv-where"), "A new worktree H:\\w\\proj-fix-login-redirect on a new branch fix-login-redirect, made from main's commit.");
    assert.deepEqual(doc.document.body.querySelectorAll(".chg-sect").map((/** @type {any} */ e) => e.textContent), ["Goes · 2 files", "Stays in proj · 1 file"]);
    assert.deepEqual(fileRows(), [["M", "src/a.js", "+3-1"], ["A", "src/new.js", "+10"], ["M", "README.md", "changed since its agent last wrote it"]]);
    assert.deepEqual(lines(), [
      "1 of its files is committed: nothing to carry.",
      "2 other uncommitted files in proj stay where they are.",
      "Not carried: what git ignores — node_modules, .env. The agent is told.",
      "Still running in proj, left running: npm run dev",
    ]);
    await until(() => s.placeIn.querySelectorAll("option").length === 2, "the places listed");
    assert.deepEqual(s.placeIn.querySelectorAll("option").map((/** @type {any} */ o) => o.textContent), ["New worktree", "proj-done · done"], "not where it is, not a gone one");
    assert.equal(s.moveBtn.disabled, false);
    s.moveBtn.dispatch("click");
    await until(() => s.moved.length === 1, "the chat moved");
    assert.deepEqual(posted, [{ url: "/api/sessions/c1/move", body: { to: { name: "fix-login-redirect", made: true }, files: ["src/a.js", "src/new.js"] } }]);
    assert.deepEqual(s.moved, [DONE]);
    assert.equal(doc.document.body.querySelector(".zc-dialog"), null, "the sheet closed");
  });

  // (fails before: yes — the places were read once as the sheet opened: the server answers from its last read and reads
  // again behind it, and what that read found never reached the sheet)
  test("the repository's places are read again where the feed says they moved, the one picked kept; closed, it hears no more", async () => {
    /** @type {Array<(msg: any) => void>} */
    const ears = [];
    const hear = (/** @type {(msg: any) => void} */ fn) => {
      ears.push(fn);
      return () => void ears.splice(ears.indexOf(fn), 1);
    };
    /** @type {any} */
    let places = PLACES;
    serve = (u) => (u === PLACES_URL ? places : u.startsWith("/api/sessions/c1/move?") ? PLAN : undefined);
    const s = opened(hear);
    const options = () => s.placeIn.querySelectorAll("option").map((/** @type {any} */ o) => o.textContent);
    await until(() => options().length === 2, "the places listed");
    s.placeIn.value = "H:/w/proj-done";
    places = { ...PLACES, places: [PLACES.places[0], { path: "H:/w/proj-new", name: "proj-new", branch: "new", ok: true }] };
    const reads = () => asked.filter((u) => u === PLACES_URL).length;
    const before = reads();
    /** @param {any} msg */
    const say = (msg) => {
      for (const fn of [...ears]) fn(msg);
    };
    say({ type: "git-moved", what: "places", folders: ["C:/elsewhere"] });
    say({ type: "git-moved", what: "place", folders: ["H:\\w\\proj"] });
    assert.equal(reads(), before, "another folder's, or another read: not asked again");
    say({ type: "git-moved", what: "places", folders: ["C:/real/proj", "h:/w/proj/"] });
    await until(() => options().length === 3, "read again");
    assert.deepEqual(options(), ["New worktree", "proj-done · done", "proj-new · new"], "the one picked kept, the new one beside it");
    assert.equal(s.placeIn.value, "H:/w/proj-done");
    s.d.close();
    assert.equal(ears.length, 0, "closed: it hears no more");
  });

  test("a place chosen reads again by its path and hides the name; a blocked read greys Move and says why; a typed name is read after a rest, as the person's", async () => {
    const PLACE_URL = "/api/sessions/c1/move?place=H%3A%2Fw%2Fproj-done";
    const blocked = { ...PLAN, to: { new: false, place: "H:/w/proj-done", name: "proj-done", branch: "done" }, blocked: ["src/a.js differs between the two commits: pick a new worktree, or move it by hand"] };
    serve = (u) => (u === PLACES_URL ? PLACES : u === PLACE_URL ? blocked : u.startsWith("/api/sessions/c1/move?name=") ? PLAN : undefined);
    const s = opened();
    await until(() => s.placeIn.querySelectorAll("option").length === 2 && doc.document.body.querySelector(".mv-file"), "the sheet read");
    s.placeIn.value = "H:/w/proj-done";
    s.placeIn.dispatch("change");
    await until(() => text(".mv-said")?.startsWith("src/a.js differs"), "the blocked read drawn");
    assert.equal(asked.at(-1), PLACE_URL);
    assert.equal(s.nameIn.hidden, true);
    assert.equal(text(".mv-where"), "proj-done, on done: its files land there as uncommitted changes.");
    assert.equal(text(".mv-said"), "src/a.js differs between the two commits: pick a new worktree, or move it by hand");
    assert.equal(doc.document.body.querySelector(".mv-said").classList.contains("is-err"), true);
    assert.equal(s.moveBtn.disabled, true);
    s.moveBtn.dispatch("click");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(posted, [], "a blocked sheet posts nothing");
    s.placeIn.value = "";
    s.placeIn.dispatch("change");
    await until(() => s.moveBtn.disabled === false, "the new worktree's read");
    assert.equal(s.nameIn.hidden, false);
    assert.equal(text(".mv-said"), "");
    s.nameIn.value = "My fix";
    s.nameIn.dispatch("input");
    await until(() => asked.at(-1) === "/api/sessions/c1/move?name=My-fix", "the typed name read, no longer the page's");
  });

  // (fails before: yes — a read on its way, which a long chat's makes seconds to a minute, showed nothing: Move only
  // greyed, the last place's words standing as if they were the new one's; the owner's of 10-30, "frustrating to not
  // see any feedback what was happening")
  test("a read or a move on its way says so: Move turns a spinner, the line under the list says what it waits on, the last read's words dimmed; the answer takes them away", async () => {
    const PLACE_URL = "/api/sessions/c1/move?place=H%3A%2Fw%2Fproj-done";
    const there = { ...PLAN, to: { new: false, place: "H:/w/proj-done", name: "proj-done", branch: "done" } };
    /** @type {(v: any) => void} */
    let land = () => {};
    const held = () => new Promise((r) => void (land = r));
    serve = (u, m) => (u === PLACES_URL ? PLACES : u === MADE_URL ? held() : u === PLACE_URL ? held() : u === "/api/sessions/c1/move" && m === "POST" ? held() : undefined);
    const s = opened();
    const body = doc.document.body;
    const said = body.querySelector(".mv-said");
    const waits = () => [s.moveBtn.getAttribute("aria-busy"), !!s.moveBtn.querySelector(".mv-spin"), said.classList.contains("is-waiting"), said.textContent];
    assert.deepEqual(waits(), ["true", true, true, "Reading what would go…"], "the first read, before anything is drawn");
    await until(() => s.placeIn.querySelectorAll("option").length === 2, "the places listed");
    land(PLAN);
    await until(() => body.querySelector(".mv-file"), "the first read drawn");
    assert.deepEqual(waits(), ["false", true, false, ""]);
    assert.equal(s.moveBtn.disabled, false);
    s.placeIn.value = "H:/w/proj-done";
    s.placeIn.dispatch("change");
    assert.equal(s.moveBtn.disabled, true);
    assert.deepEqual(waits(), ["true", true, true, "Reading what would go to proj-done · done…"]);
    assert.deepEqual([body.querySelector(".mv-where").classList.contains("is-stale"), body.querySelector(".mv-list").classList.contains("is-stale")], [true, true], "the new worktree's words, dimmed");
    assert.equal(s.nameIn.hidden, true, "its name field goes with the choice, before the read");
    land(there);
    await until(() => s.moveBtn.disabled === false, "the place's read drawn");
    assert.deepEqual(waits(), ["false", true, false, ""]);
    assert.deepEqual([body.querySelector(".mv-where").classList.contains("is-stale"), body.querySelector(".mv-list").classList.contains("is-stale")], [false, false]);
    assert.equal(body.querySelector(".mv-where").textContent, "proj-done, on done: its files land there as uncommitted changes.");
    // The move reads it all again before it moves a file: as long a wait, said the same way.
    s.moveBtn.dispatch("click");
    await until(() => posted.length === 1, "Move posted");
    assert.deepEqual(waits(), ["true", true, true, "Moving…"]);
    land(DONE);
    await until(() => s.moved.length === 1, "the chat moved");
  });

  // (fails before: yes — on c97b98c59 the sheet said nothing of its move until its answer, and the events feed says the
  // move's end before that answer comes: the page could not tell the move it asked for from another page's)
  test("Move hands its move on as it posts it, before its answer: the page knows the move it asked for", async () => {
    /** @type {(v: any) => void} */
    let land = () => {};
    serve = (u, m) => (u === PLACES_URL ? PLACES : u === MADE_URL ? PLAN : u === "/api/sessions/c1/move" && m === "POST" ? new Promise((r) => void (land = r)) : undefined);
    const s = opened();
    await until(() => s.moveBtn.disabled === false, "the sheet read");
    s.moveBtn.dispatch("click");
    await until(() => posted.length === 1, "Move posted");
    assert.deepEqual([s.moving.length, s.moved.length], [1, 0], "handed on before its answer");
    land(DONE);
    assert.deepEqual(await s.moving[0], DONE, "the move itself: its answer is the chat's");
    await until(() => s.moved.length === 1, "the chat moved");
  });

  test("a taken name the page made gives way to the free one; a refusal with a new read redraws the sheet, and Move takes the new list (GWC-167)", async () => {
    const free = { ...PLAN, to: { ...PLAN.to, name: "fix-login-redirect-2", branch: "fix-login-redirect-2", folder: "H:/w/proj-fix-login-redirect-2" } };
    const fewer = { ...free, goes: [PLAN.goes[0]] };
    let posts = 0;
    serve = (u, m) =>
      u === PLACES_URL ? PLACES
      : u.startsWith("/api/sessions/c1/move?name=") ? free
      : u === "/api/sessions/c1/move" && m === "POST"
        ? ++posts === 1 ? new Refusal(409, "not moved: what goes changed since the sheet was read — read it again", { plan: fewer }) : DONE
        : undefined;
    const s = opened();
    await until(() => s.nameIn.value === "fix-login-redirect-2", "the free name");
    s.moveBtn.dispatch("click");
    await until(() => s.toasts.length === 1, "the refusal said");
    assert.deepEqual(s.toasts, ["not moved: what goes changed since the sheet was read — read it again"]);
    assert.deepEqual(fileRows().map((r) => r[1]), ["src/a.js", "README.md"], "drawn from the refusal's read");
    assert.equal(text(".mv-said"), "not moved: what goes changed since the sheet was read — read it again");
    assert.equal(s.moveBtn.disabled, false);
    s.moveBtn.dispatch("click");
    await until(() => s.moved.length === 1, "the chat moved");
    assert.deepEqual(posted.map((p) => p.body), [
      { to: { name: "fix-login-redirect-2", made: true }, files: ["src/a.js", "src/new.js"] },
      { to: { name: "fix-login-redirect-2", made: true }, files: ["src/a.js"] },
    ]);
  });
});

// (fails before: yes — hydrate keeps a folder the chat has, so the header and the transcript stayed in the old one)
test("the page follows the move: the chat's folder is the answer's before the transcript is read again; Move back drops the row first", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /async function movedTo\(chat, cwd, said, mark\) \{\n\s+chat\.cwd = cwd;\n[\s\S]*?await hydrate\(chat\);/);
  assert.match(app, /withoutMove\(chat\.turns, String\(b\.id\)\);\n\s+await movedTo\(chat, r\.cwd,/);
  assert.match(app, /onMove: \(\) => \{\n\s+const c = chatOf\(state\.currentId\);\n\s+if \(c\?\.chainId\) openMoveSheet\(c\);/);
  assert.match(app, /\nfunction openMoveSheet\(c\) \{[\s\S]*?\n {2}moveSheet\(\{/);
  const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
  assert.match(header, /label: "Move to a worktree…", icon: "gitFork", disabled: !c\?\.chainId \|\| !!c\?\.live \|\| !cb\.onMove,/);
  assert.match(header, /\n {6}moveItem\(c\),\n/, "the chat menu's");
  assert.match(header, /const m = moveItem\(chat\);/, "and the place card's");
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /onclick: \(\) => cb\.onMoveBack\?\.\(owner, b\),\n\s+\}, "Move back"\)/);
});

// (fails before: yes — on c97b98c59 nothing held a move as the page's own: the feed's release of it, which comes before
// the move's answer, read nothing in any page; on 32afa3f3f a move's mark was one flag per chat, which a second move's
// refusal cleared under the first)
test("a move the sheet posts is the page's own by its own mark, from Move's press until the move's own end, or its refusal (source contract; live-topic-page.test.js drives the sheet's moves, Move back and the release)", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /onMoving: \(move\) => \{\n\s+const own = \(mark = movingMark\(c\)\);\n\s+move\.catch\(\(\) => own\.done\(\)\);\n\s+\},\n\s+onMoved: /);
  assert.match(app, /async function movedTo\(chat, cwd, said, mark\) \{[\s\S]*?await hydrate\(chat\);[\s\S]*?\n {2}mark\.done\(\);/);
  assert.ok(!/movingHere\.(add|delete)\(/.test(app), "no flag a chat's moves share");
});
