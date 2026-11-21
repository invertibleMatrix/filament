// @ts-check
// Where a chat works, in the left bar (the owner's of 10-31: three chats of one project — on main, in the uiux worktree, in
// the space worktree — each read "webshop" in Now; and "i might forget if a thread has unapplied work into main branch"):
// Now's chip names the project as the bar groups the chat from its first draw, a worktree's branch beside it, its hover
// the place whole; and a chat whose place holds work not on main yet — commits, files not committed — wears a mark, in
// Now and beside its title under Projects, its hover in a lane's words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers, by address (the page's api reads `fetch` as its module loads). @type {(url: string) => any} */
let serve = () => null;
/** The addresses asked. @type {string[]} */
const asked = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = serve(String(url));
  return body == null ? new Promise(() => {}) : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const { createNow } = await import("../src/ui/harness/now-list.js");
const { chipProject, apartMark, whereLine, placeSaid } = await import("../src/ui/harness/lib/labels.js");
const { nowRows } = await import("../src/ui/harness/lib/now.js");
const { agentRow, NOW } = await import("./helpers/side-view.js");

const mk = /** @type {any} */ (fakeH);
/** Every node under `el` that carries the class, in order. @param {any} el @param {string} c @returns {any[]} */
const every = (el, c) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    for (const k of n?.kids || []) {
      if (!k || typeof k !== "object") continue;
      if (String(k.attrs?.class || "").split(/\s+/).includes(c)) out.push(k);
      walk(k);
    }
  };
  walk(el);
  return out;
};

// (fails before: yes — a chat this page made in a worktree read its folder's name, "webshop-uiux", until the archive
// listed it, then "webshop": the chip said the folder for a minute and the project after)
test("the chip names the chat's project from its first draw: the archive's row, else the one its create filed it in", () => {
  const projects = [{ id: "p-ll", name: "webshop" }, { id: "p-notes", name: "notes" }];
  const listed = [{ cwd: "H:\\webshop-space", project: "p-ll", projectName: "webshop" }];
  assert.equal(chipProject({ projectName: "webshop", cwd: "H:\\webshop-space" }, null, listed, projects), "webshop", "listed: the archive's name");
  assert.equal(chipProject(null, { cwd: "H:\\webshop-uiux", projectId: "p-ll" }, listed, projects), "webshop", "not listed yet: the project its create filed it in");
  assert.equal(chipProject(null, { cwd: "h:/webshop-space/" }, listed, projects), "webshop", "no id yet: a listed chat's of its folder");
  assert.equal(chipProject(null, { cwd: "H:\\scratch\\notes" }, [], []), "notes", "nothing known: its folder's name, as before");
  assert.equal(chipProject(null, null, [], []), "");
});

// (fails before: yes — nothing in the bar said a worktree's work was not on main)
test("the mark: commits not on the base and files not committed, the hover in a lane's words; none on the base, merged or unread", () => {
  const wt = { ok: true, worktree: true, branch: "space", base: "main", onBase: false };
  assert.deepEqual(apartMark({ ...wt, ahead: 2, uncommitted: { files: 3, added: 9, removed: 1 } }), { text: "↑2 · 3 uncommitted", title: "2 commits not on main · 3 files changed, not committed" });
  assert.deepEqual(apartMark({ ...wt, ahead: 1, uncommitted: { files: 0 } }), { text: "↑1", title: "1 commit not on main" });
  assert.deepEqual(apartMark({ ...wt, ahead: 0, uncommitted: { files: 1 } }), { text: "1 uncommitted", title: "1 file changed, not committed" });
  assert.equal(apartMark({ ...wt, ahead: 0, uncommitted: { files: 0 } }), null, "merged, or nothing of its own yet: no mark");
  assert.equal(apartMark({ ok: true, base: "main", onBase: true, ahead: 0, uncommitted: null }), null, "the base's own folder: no mark");
  assert.deepEqual(apartMark({ ok: true, worktree: true, base: null, onBase: false, ahead: null, uncommitted: { files: 2 } }), { text: "2 uncommitted", title: "2 files changed, not committed" }, "no base: its files alone");
  assert.equal(apartMark({ ok: true, worktree: true, branch: "space" }), null, "read lightly: nothing to say");
  assert.equal(apartMark({ ok: false, error: "the folder is gone" }), null);
  assert.equal(apartMark(null), null);
});

// (fails before: yes — a main folder off its base whose agents also wrote in a worktree read "wt ↑2": the mark, the
// folder's own, stood beside the worktree's branch; the review's find of 10-31)
test("the line the mark stands beside is led by the chat's own folder: a main folder off its base names its branch first", () => {
  /** @type {Record<string, any>} */
  const info = {
    "H:\\w\\lib": { ok: true, place: "H:/w/lib", worktree: false, main: "H:/w/lib", branch: "topic", head: "abc1234", base: "main", onBase: false, ahead: 2, uncommitted: { files: 0 } },
    "H:\\w\\lib-wt": { ok: true, place: "H:/w/lib-wt", worktree: true, main: "H:/w/lib", branch: "wt", head: "def5678" },
  };
  const row = { cwd: "H:\\w\\lib", places: ["H:\\w\\lib-wt"] };
  const also = "Its agents also wrote in lib-wt ⑂ wt, worktree of lib (H:\\w\\lib)";
  assert.deepEqual(whereLine(row, (f) => info[f] || null), { text: "wt", title: also }, "no mark: its places alone, as before");
  assert.deepEqual(whereLine(row, (f) => info[f] || null, { lead: true }), { text: "topic +1", title: `Works in lib ⑂ topic\n${also}` });
  assert.deepEqual(whereLine({ cwd: "H:\\w\\lib", places: [] }, (f) => info[f] || null, { lead: true }), { text: "topic", title: "Works in lib ⑂ topic" }, "alone: its branch");
});

// (fails before: yes — every read again of a place drew the bar again where any of its fields moved: its lines and its
// distance behind move with each edit an agent makes; the review's find of 10-31)
test("what the rows say of a place: a read whose lines, distance behind or branch's head moved says the same", () => {
  const p = { ok: true, place: "H:/w/app-space", worktree: true, main: "H:/w/app", branch: "space", head: "abc", base: "main", onBase: false, ahead: 2, behind: 0, uncommitted: { files: 3, added: 5, removed: 1 } };
  assert.equal(placeSaid({ ...p, behind: 4, head: "def", fresh: true, uncommitted: { files: 3, added: 90, removed: 7 } }), placeSaid(p));
  for (const moved of [{ ahead: 3 }, { uncommitted: { files: 4, added: 5, removed: 1 } }, { uncommitted: null }, { branch: "other" }, { ok: false }, { onBase: true }, { worktree: false }, { place: "H:/w/other" }])
    assert.notEqual(placeSaid({ ...p, ...moved }), placeSaid(p), JSON.stringify(moved));
  assert.notEqual(placeSaid({ ...p, branch: null, head: "def" }), placeSaid({ ...p, branch: null, head: "abc" }), "a detached head is said by its commit");
  assert.equal(placeSaid(null), "");
});

// (fails before: yes — a sub-agent's row that asks you wore its chat's branch and mark, though it may work in a copy of
// its own; the review's lead of 10-31)
test("a sub-agent's row in Now says no place: where the chat works, and what it holds apart, are its chat's row's", () => {
  const facts = { title: "filament_space", project: "app", when: NOW, unread: false, where: { text: "space", title: "Works in app-space ⑂ space" }, apart: { text: "↑2", title: "2 commits not on main" } };
  const run = { id: "r1", kind: "agent-turn", status: "running", startedAt: NOW - 60_000, endedAt: null, parentId: null, events: 4, meta: { chain: "c1", model: "opus" } };
  const g = nowRows({ runs: /** @type {any} */ ([run]), folds: new Map(), threads: new Map([["c1", [agentRow("y1", { status: "done", work: { pending: 2 } })]]]), chats: (c) => (c === "c1" ? /** @type {any} */ (facts) : null), unread: new Set(), holders: new Map(), now: NOW });
  const own = g.works.find((r) => r.chain === "c1" && !r.thread);
  const sub = g.needs.find((r) => r.thread === "y1");
  assert.deepEqual([own?.where?.text, own?.apart?.text], ["space", "↑2"], "the chat's own row: its place");
  assert.ok(sub, "the sub-agent's row: its changes wait for you");
  assert.deepEqual([sub?.where, sub?.apart], [null, null], "the sub-agent's: none");
});

/** Now with one chat at work, its facts as `facts` says them. @param {{ facts: any }} o */
async function oneAtWork(o) {
  const t = Date.now();
  const runs = [{ id: "r1", kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } }];
  const now = createNow({ h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => (c === "c1" ? o.facts : null), unread: () => new Set(), holders: () => new Map(), onOpen() {}, onSeen() {} });
  await now.update(/** @type {any} */ (runs));
  return now;
}

// (fails before: yes — Now drew the project's chip alone: three chats of webshop, each in its own worktree, read alike;
// and drawn beside the chip, the branch and the mark left a 180px bar's line no room for the branch's name or for what
// the chat does, seen on a throwaway Filament)
test("Now: a worktree's branch and its mark on a line of their own under the chip and what the chat does, the place whole in their hovers; none on a main folder", async () => {
  const facts = {
    title: "filament_space", project: "webshop", when: Date.now(), unread: false,
    where: /** @type {any} */ ({ text: "space", title: "Works in webshop-space ⑂ space, worktree of webshop (H:\\webshop)" }),
    apart: /** @type {any} */ ({ text: "↑2 · 3 uncommitted", title: "2 commits not on main · 3 files changed, not committed" }),
  };
  const now = await oneAtWork({ facts });
  const row = every(now.el, "now-row")[0];
  const classes = (/** @type {any} */ el) => el.kids.filter(Boolean).map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]);
  const [line, place] = every(row, "now-line");
  assert.deepEqual(classes(line), ["now-proj", "now-fact"], "the chip and what the chat does, as on any row");
  assert.deepEqual([String(place.attrs.class), classes(place)], ["now-line now-place", ["now-where", "now-apart"]], "the branch, then its mark, on the line under them");
  const [where] = every(row, "now-where");
  assert.deepEqual([textOf(where), where.attrs.title], ["space", "Works in webshop-space ⑂ space, worktree of webshop (H:\\webshop)"]);
  const [mark] = every(row, "now-apart");
  assert.deepEqual([textOf(mark), mark.attrs.title], ["↑2 · 3 uncommitted", "2 commits not on main · 3 files changed, not committed"]);
  assert.match(row.attrs.title, /^filament_space · webshop · space · 2 commits not on main · 3 files changed, not committed · /);

  facts.where = null;
  facts.apart = null;
  now.refresh();
  const again = every(now.el, "now-row")[0];
  assert.deepEqual([every(again, "now-line").length, every(again, "now-where").length, every(again, "now-apart").length], [1, 0, 0], "drawn again when its place moved: on a main folder, the chip's line alone");
});

// (fails before: yes — the bar's rows under Projects said a worktree's branch, never that its work was not on main)
test("Projects: a chat whose worktree holds work not on main wears the mark beside its branch, in either width of the bar; one on main, none; the read asks apart", async () => {
  const doc = stubDocument();
  const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const t = Date.now();
  const WT = { ok: true, cwd: "H:\\w\\app-space", place: "H:/w/app-space", worktree: true, main: "H:/w/app", branch: "space", detached: false, head: "abc1234", error: null, base: "main", onBase: false, ahead: 2, behind: 0, uncommitted: { files: 3, added: 5, removed: 0 } };
  const MAIN = { ok: true, cwd: "H:\\w\\app", place: "H:/w/app", worktree: false, main: "H:/w/app", branch: "main", detached: false, head: "abc1234", error: null, base: "main", onBase: true, ahead: 0, behind: 0, uncommitted: null };
  // Another repository's main folder off its base, whose agents also wrote in a worktree of it.
  const LIB = { ok: true, cwd: "H:\\w\\lib", place: "H:/w/lib", worktree: false, main: "H:/w/lib", branch: "topic", detached: false, head: "abc1234", error: null, base: "main", onBase: false, ahead: 2, behind: 0, uncommitted: { files: 0, added: 0, removed: 0 } };
  const LIB_WT = { ok: true, cwd: "H:\\w\\lib-wt", place: "H:/w/lib-wt", worktree: true, main: "H:/w/lib", branch: "wt", detached: false, head: "def5678", error: null };
  serve = (u) => {
    if (u.startsWith("/api/git/where?")) return { places: { "H:\\w\\app-space": WT, "H:\\w\\app": MAIN, "H:\\w\\lib": LIB, "H:\\w\\lib-wt": LIB_WT } };
    if (u.startsWith("/api/spaces")) return { open: {}, needs: {}, extended: true, next: null, own: [] };
    return {
      sessions: [
        { id: "c1", title: "filament_space", when: t, project: "p1", projectName: "app", cwd: "H:\\w\\app-space", places: [] },
        { id: "c2", title: "filament_main_branch", when: t - 1000, project: "p1", projectName: "app", cwd: "H:\\w\\app", places: [] },
        { id: "c3", title: "lib topic", when: t - 2000, project: "p2", projectName: "lib", cwd: "H:\\w\\lib", places: ["H:\\w\\lib-wt"] },
      ],
      projects: [{ id: "p1", name: "app", cwd: "H:\\w\\app" }, { id: "p2", name: "lib", cwd: "H:\\w\\lib" }],
      runs: [],
    };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), /** @type {any} */ ({ onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {}, onYourSpace() {} }));
    await sb.load();
    /** Every element under one, in order. @param {any} el @returns {any[]} */
    const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];
    const row = (/** @type {string} */ id) => all(host).find((x) => x.getAttribute?.("data-chain") === id && String(x.className).includes("sess-row"));
    const marksOf = (/** @type {string} */ id) => all(row(id) || {}).filter((x) => String(x.className).includes("row-apart"));
    await until(() => marksOf("c1").length, "the mark drawn once the read lands");
    assert.ok(asked.some((u) => u.startsWith("/api/git/where?apart=1&")), "the read asks what each place holds apart");
    const [narrow, wide] = marksOf("c1");
    assert.deepEqual([narrow.textContent, narrow.getAttribute("title")], ["↑2 · 3 uncommitted", "2 commits not on main · 3 files changed, not committed"]);
    /** The line a mark stands on. @param {any} m */
    const lineOf = (m) => all(host).find((x) => [...(x.children || [])].includes(m));
    assert.deepEqual([String(lineOf(narrow).className), lineOf(narrow).textContent], ["row-where", "space↑2 · 3 uncommitted"], "a narrow bar: beside the branch, on the row's second line");
    assert.deepEqual([String(lineOf(wide).className), lineOf(wide).textContent], ["row-two", "space↑2 · 3 uncommitted · idle"], "a wide bar: beside the branch, before what it does");
    const titleLine = all(row("c1")).find((x) => String(x.className).includes("row-title-line"));
    assert.equal(all(titleLine).filter((x) => String(x.className).includes("row-apart")).length, 0, "not beside the title, which it cut short");
    assert.equal(marksOf("c2").length, 0, "the main folder on main: no mark");
    // A main folder off its base: its mark beside its own branch, never beside a place its agents wrote in.
    await until(() => marksOf("c3").length, "the main folder off its base marked");
    const [libMark] = marksOf("c3");
    assert.deepEqual([lineOf(libMark).textContent, libMark.getAttribute("title")], ["topic +1↑2", "2 commits not on main"]);
    // A chat's own folder read apart, a place its agents only wrote in lightly (the review's find of 10-31).
    const reads = asked.filter((u) => u.startsWith("/api/git/where?"));
    const enc = (/** @type {string} */ f) => `cwd=${encodeURIComponent(f)}`;
    const apartReads = reads.filter((u) => u.startsWith("/api/git/where?apart=1&"));
    for (const f of ["H:\\w\\app-space", "H:\\w\\app", "H:\\w\\lib"]) assert.ok(apartReads.some((u) => u.includes(enc(f))), `${f} read apart`);
    assert.ok(!apartReads.some((u) => u.includes(enc("H:\\w\\lib-wt"))), "a place alone is not read apart");
    assert.ok(reads.some((u) => u.startsWith("/api/git/where?cwd=") && u.includes(enc("H:\\w\\lib-wt"))), "a place alone is read lightly");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
    g.fetch = realFetch;
  }
});
