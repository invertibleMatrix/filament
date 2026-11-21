// @ts-check
// Filament's footprint at the foot of a project's places (the footprint plan, Phase 7), drawn in a stub document against
// a stand-in server: one quiet line read after the places where the read asks for it — never on any other read —, Clean
// up… where anything would go or could go ticked. Clean up… reads the plan whole; its sheet says by kind what goes and
// what stays, and lists apart, each with a tick and none ticked, the refs no record shows to be this Filament's. Clean up
// pressed once more posts exactly that plan — what goes as it was read, and the ticked groups' refs —, a toast says what
// went and what stayed by kind, and the places and the line are read again; a refusal is said in an error toast.
// (fails before: yes — the line, its sheet and its words are new; against the first build of the sheet, a press sent the
// folder alone and nothing could be ticked)
// The sheet is read at a glance (the owner's of 11-09: a hundred two-line rows ran it off the window, its buttons out of
// reach): what it takes in a line, what stays folded, the rows to tick grouped by kind, each group with its own tick,
// a row a line in columns; no dialog stands taller than the window, its body the part that scrolls.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** A refusal the stand-in server answers, in the server's words. */
class Refusal {
  /** @param {number} status @param {string} error */
  constructor(status, error) {
    this.status = status;
    this.error = error;
  }
}
/** @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method === "GET") asked.push(String(url));
  else posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = serve(String(url), method);
  if (body instanceof Refusal) return new Response(JSON.stringify({ error: body.error }), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const { placesSection } = await import("../src/ui/harness/space/places.js");
const { cleanLines, cleanedWords, footprintWords, leftWords, openCleanUp, pressedPlan, takesWords, tickGroups, tickRows } = await import("../src/ui/harness/space/footprint.js");
const { h } = await import("../src/ui/lib/dom.js");
after(() => {
  g.fetch = realFetch;
});

/** How many times the page asked for exactly this address. @param {string} url */
const times = (url) => asked.filter((u) => u === url).length;
const PLACES = "/api/git/places?cwd=%2Fr";
const FOOTPRINT = "/api/git/footprint?cwd=%2Fr";
const PLAN = "/api/git/footprint?cwd=%2Fr&plan=1";
const MAIN = { path: "/r", name: "r", main: true, ok: true, branch: "main", base: "main", onBase: true, ahead: 0, behind: 0, uncommitted: { files: 0 }, chats: [], removable: false, why: "the repository's main folder", goes: null };
const PLACES_OK = { cwd: "/r", ok: true, error: null, name: "r", main: "/r", places: [MAIN], removed: [] };
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
/** 2026-11-02 12:00, the machine's own time, in seconds. */
const NOON = Math.floor(new Date(2026, 10, 2, 12).getTime() / 1000);

/**
 * A footprint answer as the server gives one; `refs`, with each going and tickable group's refs, as `plan=1` gives it.
 * @param {Partial<any>} [o] @param {{ refs?: boolean }} [w] @returns {any}
 */
const footprintOf = (o = {}, { refs = false } = {}) => {
  /** @param {string} name @param {number} n */
  const list = (name, n) => (refs ? { refs: Array.from({ length: n }, (_, i) => ({ ref: `refs/filament/${name}/${i}`, commit: C1 })) } : {});
  return {
    cwd: "/r",
    ok: true,
    error: null,
    repo: "/r",
    copies: {
      count: 3, bytes: 2 * 1024 * 1024, partial: true, goes: 2, goesBytes: 1024 * 1024, goesPartial: false,
      items: [
        { name: "sa_aaaaaaaa", kind: "helper", at: 5, goes: false, why: "it holds its sub-agent's work, which waits to be applied or discarded" },
        { name: "chk-1", kind: "check", at: 7, goes: true, why: "free: nothing of it is anyone's" },
        { name: "spare-1a2b3c4d", kind: "spare", at: 9, goes: true, why: "free: nothing of it is anyone's" },
      ],
    },
    left: { count: 0, bytes: 0, partial: false, items: [] },
    refs: {
      count: 22, goes: 6, tick: 3,
      kinds: [
        { kind: "subagents", count: 6, goes: 2, tick: 2, groups: [
          { owner: "sa_aaaaaaaa", part: "work", count: 2, newest: NOON, goes: false, tick: false, why: "its work waits to be applied or discarded" },
          { owner: "sa_bbbbbbbb", part: "work", count: 2, newest: NOON, goes: true, tick: false, why: "nothing of its work waits", ...list("subagents/sa_bbbbbbbb", 2) },
          { owner: "sa_cccccccc", part: "mark", count: 2, newest: NOON, goes: false, tick: true, why: "a mark's hold no record shows this Filament made it: another Filament may still undo it", ...list("subagents/sa_cccccccc", 2) },
        ] },
        { kind: "snapshots", count: 15, goes: 3, tick: 1, groups: [
          { owner: "live0001", part: "undo", count: 11, newest: NOON, goes: false, tick: false, why: "its chat is here" },
          { owner: "gone0001", part: "undo", count: 3, newest: NOON, goes: true, tick: false, why: "you deleted its chat", ...list("snapshots/gone0001", 3) },
          { owner: "othr0001", part: "undo", count: 1, newest: NOON, goes: false, tick: true, why: "no record shows this Filament made it: another Filament's chat may be among these", ...list("snapshots/othr0001", 1) },
        ] },
        { kind: "moves", count: 1, goes: 1, tick: 0, groups: [{ owner: "gone0001", part: "undo", count: 1, newest: NOON, goes: true, tick: false, why: "you deleted its chat", ...list("moves/gone0001", 1) }] },
        { kind: "other", count: 0, goes: 0, tick: 0, groups: [] },
      ],
    },
    branches: {
      count: 2, goes: 1,
      items: [
        { name: "routine-morning-brief-1027", routine: "Morning brief", commit: C2, goes: true, why: "main has every commit of it" },
        { name: "routine-morning-brief-1028", routine: "Morning brief", commit: C1, goes: false, why: "it holds 1 commit main lacks" },
      ],
    },
    goes: 9,
    ...o,
  };
};

describe("the footprint's words", () => {
  test("the line, the sheet's lines by kind, the rows that go only ticked, the plan a press sends, the toast", () => {
    assert.equal(footprintWords(footprintOf()), "Filament's footprint: 3 copies · at least 2.0 MB · 22 refs · 2 routine branches");
    assert.equal(
      footprintWords(footprintOf({ copies: { count: 1, bytes: 5000, partial: false, goes: 0, goesBytes: 0, goesPartial: false, items: [] }, refs: { count: 1, goes: 0, tick: 0, kinds: [] }, branches: { count: 0, goes: 0, items: [] }, goes: 0 })),
      "Filament's footprint: 1 copy · 5 KB · 1 ref · nothing to clean up",
    );
    assert.equal(
      footprintWords(footprintOf({ copies: { count: 0, bytes: 0, partial: false, goes: 0, goesBytes: 0, goesPartial: false, items: [] }, refs: { count: 4238, goes: 0, tick: 4200, kinds: [] }, branches: { count: 0, goes: 0, items: [] }, goes: 0 })),
      "Filament's footprint: 0 copies · 4238 refs · 4200 refs no record shows are its own",
    );
    // (fails before: yes — a deleted chat's fork's kept contents read as refs no record shows are Filament's, its kind raw)
    const forks = { kind: "forks", count: 2, goes: 0, tick: 2, groups: [{ owner: "c9", part: "kept", count: 2, tick: true, why: "what its fork's folder held as its chat was deleted", refs: [] }] };
    assert.equal(
      footprintWords(footprintOf({ copies: { count: 0, bytes: 0, partial: false, goes: 0, goesBytes: 0, goesPartial: false, items: [] }, refs: { count: 10, goes: 0, tick: 5, kinds: [forks] }, branches: { count: 0, goes: 0, items: [] }, goes: 0 })),
      "Filament's footprint: 0 copies · 10 refs · 3 refs no record shows are its own · 2 refs of deleted chats' forks, kept until you tick them",
    );
    assert.deepEqual(tickRows(footprintOf({ refs: { count: 2, goes: 0, tick: 2, kinds: [forks] } })).map((r) => [r.group, r.words]), [["forks:kept", "Chat c9 · 2 refs"]]);
    assert.equal(footprintWords({ ok: false, error: "x" }), "");
    assert.deepEqual(cleanLines(footprintOf()), {
      goes: [
        "Copies: 2, 1.0 MB — free: nothing of it is anyone's",
        "Sub-agents' refs: 2 — nothing of its work waits",
        "Undo points: 3 — you deleted its chat",
        "Ways back from moves: 1 — you deleted its chat",
        "Routine branches: routine-morning-brief-1027 — main has every commit of it",
      ],
      stays: [
        "Copies: sa_aaaaaaaa — it holds its sub-agent's work, which waits to be applied or discarded",
        "Sub-agents' refs: 2 — its work waits to be applied or discarded",
        "Undo points: 11 — its chat is here",
        "Routine branches: routine-morning-brief-1028 — it holds 1 commit main lacks",
      ],
    }, "the groups that go only ticked are neither");
    // (fails before: yes — the sheet opened on lines by kind, with no line of what it takes)
    assert.equal(takesWords(footprintOf()), "Clean up takes 2 copies (1.0 MB), 6 refs and 1 routine branch now, and what you tick below. Everything else stays.");
    const none = { copies: { count: 0, bytes: 0, partial: false, goes: 0, goesBytes: 0, goesPartial: false, items: [] }, branches: { count: 0, goes: 0, items: [] }, goes: 0 };
    assert.equal(takesWords(footprintOf({ ...none, refs: { count: 3, goes: 0, tick: 3, kinds: [] } })), "Clean up takes only what you tick below. Everything else stays.");
    assert.equal(takesWords(footprintOf({ ...none, refs: { count: 3, goes: 0, tick: 0, kinds: [] } })), "Clean up takes nothing now. Everything else stays.");
    // (fails before: yes — each row said its kind and its part again: "Helpers' refs of helper sa_…'s mark's hold · …")
    const rows = tickRows(footprintOf({}, { refs: true }));
    assert.deepEqual(rows.map((r) => [r.key, r.group, r.id, r.count, r.newest, r.words, r.refs.length]), [
      ["subagents:sa_cccccccc:mark", "subagents:mark", "sa_cccccccc", 2, "2026-11-02", "Sub-agent sa_cccccccc · 2 refs · newest 2026-11-02", 2],
      ["snapshots:othr0001:undo", "snapshots:undo", "othr0001", 1, "2026-11-02", "Chat othr0001 · 1 ref · newest 2026-11-02", 1],
    ]);
    assert.deepEqual(tickGroups(rows).map((g) => [g.key, g.words, g.who, g.rows.map((r) => r.id)]), [
      ["subagents:mark", "Sub-agents' work marked as applied, held so the mark can be undone", "sub-agent", ["sa_cccccccc"]],
      ["snapshots:undo", "Undo points of chats that are not here", "chat", ["othr0001"]],
    ], "a group a kind, which says once what its refs are for");
    const a = footprintOf({}, { refs: true });
    assert.deepEqual(pressedPlan(a, new Set()), {
      copies: [{ name: "chk-1", at: 7 }, { name: "spare-1a2b3c4d", at: 9 }],
      left: [],
      refs: [...a.refs.kinds[0].groups[1].refs, ...a.refs.kinds[1].groups[1].refs, ...a.refs.kinds[2].groups[0].refs],
      branches: [{ name: "routine-morning-brief-1027", commit: C2 }],
    }, "nothing ticked: none of the rows that go only ticked");
    assert.deepEqual(pressedPlan(a, new Set(["snapshots:othr0001:undo"])).refs.slice(-1), [{ ref: "refs/filament/snapshots/othr0001/0", commit: C1 }]);
    assert.equal(cleanedWords({ went: { copies: ["a", "b"], refs: { subagents: 2, snapshots: 3, moves: 1, other: 0 }, branches: ["x"] }, stayed: [{ kind: "copies", count: 1 }, { kind: "snapshots", count: 11 }, { kind: "subagents", count: 2 }] }), "Cleaned up: 2 copies, 6 refs and 1 branch went · 1 copy and 13 refs stayed");
    assert.equal(cleanedWords({ went: { copies: [], refs: {}, branches: [] }, stayed: [{ kind: "branches", count: 2 }] }), "Nothing went · 2 branches stayed");
    assert.equal(cleanedWords({ went: { copies: [], refs: { snapshots: 1 }, branches: [] }, stayed: [] }), "Cleaned up: 1 ref went");
  });

  // (fails before: yes — the review's (round 2) items 2 and 4: another Filament's chats read as any other row; a folder
  // a Clean up left was in no line, no sheet and no toast)
  test("another Filament's rows say so; the folders a Clean up left are in the line, the sheet, the plan and the toasts", () => {
    const LEFT_WHY = "a Clean up moved it aside to remove it, and its removal stopped part way: no Filament uses it";
    const a = footprintOf({ left: { count: 1, bytes: 3 * 1024 * 1024, partial: false, items: [{ name: ".chk-0.letting-go-m1", bytes: 3 * 1024 * 1024, partial: false, goes: true, why: LEFT_WHY }] }, goes: 10 }, { refs: true });
    a.refs.kinds[1].groups.push({ owner: "othr0009", part: "undo", count: 2, newest: NOON, goes: false, tick: true, others: true, why: "another Filament's: …", refs: [{ ref: "refs/filament/snapshots/othr0009/0", commit: C1 }] });
    assert.equal(footprintWords(a), "Filament's footprint: 3 copies · at least 2.0 MB · 1 leftover folder · 22 refs · 2 routine branches");
    assert.ok(cleanLines(a).goes.includes(`Leftover folders: 1, 3.0 MB — ${LEFT_WHY}`), JSON.stringify(cleanLines(a).goes));
    assert.equal(takesWords(a), "Clean up takes 2 copies (1.0 MB), 1 leftover folder (3.0 MB), 6 refs and 1 routine branch now, and what you tick below. Everything else stays.");
    assert.deepEqual(tickRows(a).map((r) => [r.words, r.others]), [
      ["Sub-agent sa_cccccccc · 2 refs · newest 2026-11-02", false],
      ["Chat othr0001 · 1 ref · newest 2026-11-02", false],
      ["Another Filament's chat othr0009 · 2 refs · newest 2026-11-02", true],
    ]);
    assert.deepEqual(pressedPlan(a, new Set()).left, [{ name: ".chk-0.letting-go-m1" }]);
    assert.equal(cleanedWords({ went: { copies: ["a"], left: [".chk-0.letting-go-m1"], refs: {}, branches: [] }, stayed: [{ kind: "left", count: 1 }, { kind: "snapshots", count: 2 }] }), "Cleaned up: 1 copy and 1 leftover folder went · 1 leftover folder and 2 refs stayed");
    assert.equal(leftWords({ left: ["/r/.git/filament-worktrees/.chk-1.letting-go-x"] }), "A copy's folder could not be deleted all the way; what is left is at /r/.git/filament-worktrees/.chk-1.letting-go-x. The next Clean up removes it.");
    assert.equal(leftWords({ left: ["/a", "/b"] }), "2 copies' folders could not be deleted all the way; what is left is at /a and /b. The next Clean up removes it.");
    assert.equal(leftWords({ left: [] }), "");
  });
});

describe("the footprint at the foot of the places", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
    addEventListener: () => {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
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
    for (const t of doc.document.body.querySelectorAll(".zc-toast")) t.remove?.();
  });

  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  const toasts = () => doc.document.body.querySelectorAll(".zc-toast").map((/** @type {any} */ t) => [t.textContent, t.getAttribute("class")]);
  /** The button of a sheet's foot that reads so. @param {string} label */
  const sheetButton = (label) => {
    const b = doc.document.body.querySelectorAll(".zc-dialog-foot .zc-btn").find((/** @type {any} */ x) => x.textContent === label);
    assert.ok(b, `the sheet's ${label}`);
    return b;
  };
  /** The places' section over /r, as the Space mounts it; `moved` counts its onMoved. */
  const mount = () => {
    const body = h("div", { class: "sp-panel" });
    doc.document.body.append(body);
    const moved = { n: 0 };
    const s = placesSection({ folder: () => "/r", editorButton: (_p, what) => h("button", { class: "pl-open", type: "button", title: what }), onMoved: () => void moved.n++ });
    body.append(s.el);
    return { body, s, moved };
  };
  /** The line once read. @param {any} body */
  const lineDrawn = (body) => until(() => body.querySelector(".pl-foot") && !body.querySelector(".pl-foot").hasAttribute("hidden") && body.querySelector(".pl-foot-words").textContent, "the footprint's line");
  /** The sheet's rows to tick, each its columns — whose, refs, newest — and whether it is ticked. */
  const rowsOf = () =>
    doc.document.body.querySelectorAll(".pl-clean-row").map((/** @type {any} */ r) => [
      ...["pl-clean-id", "pl-clean-n", "pl-clean-day"].map((c) => r.querySelector(`.${c}`).textContent),
      !!r.querySelector("input").checked,
    ]);
  /** Tick a box, as a press does. @param {any} box @param {boolean} on */
  const tick = (box, on) => {
    box.checked = on;
    box.dispatch("change");
  };
  /** Clean up… pressed: the sheet, once its plan is read. @param {any} body */
  const openSheet = async (body) => {
    body.querySelector(".pl-foot .zc-btn").dispatch("click");
    return until(() => doc.document.body.querySelector(".zc-dialog"), "the sheet");
  };

  test("read after the places where the read asks for it, never on any other; Clean up… reads the plan whole and opens its sheet, nothing ticked; Cancel takes nothing", async () => {
    serve = (u) => (u === PLACES ? PLACES_OK : u === FOOTPRINT ? footprintOf() : u === PLAN ? footprintOf({}, { refs: true }) : undefined);
    const { body, s } = mount();
    await s.load();
    assert.deepEqual([times(PLACES), times(FOOTPRINT)], [1, 0], "a read of the places alone: no footprint");
    assert.equal(body.querySelector(".pl-foot").hasAttribute("hidden"), true, "no line before it is read");
    await s.load({ footprint: true });
    await lineDrawn(body);
    assert.deepEqual(asked, [PLACES, PLACES, FOOTPRINT], "the footprint after the places");
    assert.equal(body.querySelector(".pl-foot-words").textContent, "Filament's footprint: 3 copies · at least 2.0 MB · 22 refs · 2 routine branches");
    assert.equal(body.querySelector(".pl-foot .zc-btn").textContent, "Clean up…");
    await openSheet(body);
    assert.equal(times(PLAN), 1, "the sheet's plan, read whole as it opens");
    assert.equal(doc.document.body.querySelector(".zc-dialog-title").textContent, "Clean up Filament's footprint?");
    assert.equal(doc.document.body.querySelector(".pl-clean-sum").textContent, takesWords(footprintOf()), "what it takes, in its first line");
    assert.deepEqual(texts(doc.document.body, ".pl-clean-goes"), cleanLines(footprintOf()).goes);
    assert.deepEqual(texts(doc.document.body, ".pl-clean-stays"), cleanLines(footprintOf()).stays);
    const kept = doc.document.body.querySelector(".pl-clean-kept");
    assert.deepEqual([kept.tagName, kept.open, kept.querySelector("summary").textContent], ["DETAILS", false, "What stays, and why (4)"], "what stays, folded");
    assert.deepEqual(
      [doc.document.body.querySelector(".pl-clean-all").textContent, !!(/** @type {any} */ (doc.document.body.querySelector(".pl-clean-all input")).checked)],
      ["All 2 of these", false],
    );
    assert.deepEqual(rowsOf(), [["sa_cccccccc", "2", "2026-11-02", false], ["othr0001", "1", "2026-11-02", false]], "a row a line, in columns; off by default");
    assert.deepEqual(
      doc.document.body.querySelectorAll(".pl-clean-row input").map((/** @type {any} */ b) => b.getAttribute("aria-label")),
      ["Sub-agent sa_cccccccc · 2 refs · newest 2026-11-02", "Chat othr0001 · 1 ref · newest 2026-11-02"],
      "each tick named whole to a screen reader",
    );
    assert.deepEqual(
      doc.document.body.querySelectorAll(".pl-clean-group").map((/** @type {any} */ g) => [g.getAttribute("role"), g.getAttribute("aria-label"), g.querySelector("summary").textContent]),
      [
        ["group", "Sub-agents' work marked as applied, held so the mark can be undone", "1 sub-agent · 2 refs · newest 2026-11-02"],
        ["group", "Undo points of chats that are not here", "1 chat · 1 ref · newest 2026-11-02"],
      ],
    );
    assert.equal(doc.document.body.querySelector(".pl-clean-gtick"), null, "a group of one row: its row's tick is its own");
    assert.match(doc.document.body.querySelector(".pl-clean-warn").textContent, /Another Filament working in this repository .* may still need them/);
    const sheetBody = /** @type {any} */ (doc.document.body.querySelector(".zc-dialog-body"));
    assert.deepEqual([sheetBody === doc.document.body.querySelector(".pl-clean"), sheetBody?.parentNode?.classList.contains("zc-dialog")], [true, true], "the sheet is the dialog's body, which scrolls: not wrapped");
    sheetButton("Cancel").dispatch("click");
    assert.deepEqual([doc.document.body.querySelector(".zc-dialog"), posted], [null, []], "Cancel takes nothing");
    await s.load();
    assert.equal(times(FOOTPRINT), 1, "the places read again alone: the line stays as it was read");
  });

  test("Clean up pressed posts the plan the sheet showed — a ticked row's refs with it —; a toast says what went and stayed; the places and the line are read again", async () => {
    let cleaned = false;
    serve = (u, method) =>
      u === PLACES ? PLACES_OK
      : u === FOOTPRINT ? (cleaned ? footprintOf({ copies: { count: 1, bytes: 1024, partial: false, goes: 0, goesBytes: 0, goesPartial: false, items: [] }, refs: { count: 13, goes: 0, tick: 0, kinds: [] }, branches: { count: 1, goes: 0, items: [] }, goes: 0 }) : footprintOf())
      : u === PLAN ? footprintOf({}, { refs: true })
      : u === "/api/git/footprint/clean" && method === "POST" ? ((cleaned = true), { ok: true, went: { copies: ["chk-1", "spare-1a2b3c4d"], refs: { subagents: 2, snapshots: 4, moves: 1, other: 0 }, branches: ["routine-morning-brief-1027"] }, stayed: [{ kind: "copies", why: "w", count: 1 }, { kind: "snapshots", why: "here", count: 11 }, { kind: "subagents", why: "you did not tick it", count: 2 }] })
      : undefined;
    const { body, s, moved } = mount();
    await s.load({ footprint: true });
    await lineDrawn(body);
    await openSheet(body);
    const row = /** @type {any} */ (doc.document.body.querySelectorAll(".pl-clean-row").find((/** @type {any} */ r) => /othr0001/.test(r.textContent)));
    const box = /** @type {any} */ (row.querySelector("input"));
    box.checked = true;
    box.dispatch("change");
    sheetButton("Clean up").dispatch("click");
    await until(() => times(FOOTPRINT) === 2 && /nothing to clean up/.test(body.querySelector(".pl-foot-words").textContent), "the line read again");
    const a = footprintOf({}, { refs: true });
    assert.deepEqual(posted, [{
      url: "/api/git/footprint/clean",
      body: {
        cwd: "/r",
        plan: {
          copies: [{ name: "chk-1", at: 7 }, { name: "spare-1a2b3c4d", at: 9 }],
          left: [],
          refs: [...a.refs.kinds[0].groups[1].refs, ...a.refs.kinds[1].groups[1].refs, ...a.refs.kinds[2].groups[0].refs, { ref: "refs/filament/snapshots/othr0001/0", commit: C1 }],
          branches: [{ name: "routine-morning-brief-1027", commit: C2 }],
        },
      },
    }], "what went as read, and the ticked row's refs; not the row left unticked");
    assert.equal(times(PLACES), 2, "the places read again with it");
    // (fails before: yes — the review of 4569417b8: the Plan's Still open card, which sends the person here, kept the
    // copies it said for half a minute after)
    assert.equal(moved.n, 1, "the host hears it: the chats' Plans ask again");
    assert.ok(toasts().some(([t]) => t === "Cleaned up: 2 copies, 7 refs and 1 branch went · 1 copy and 13 refs stayed"), JSON.stringify(toasts()));
    assert.equal(body.querySelector(".pl-foot-words").textContent, "Filament's footprint: 1 copy · 1 KB · 13 refs · 1 routine branch · nothing to clean up");
    assert.equal(body.querySelector(".pl-foot .zc-btn"), null, "nothing to clean: no Clean up…");
  });

  test("All of these ticks every row; a Clean up the server refuses says why in an error toast; places it cannot read have no line", async () => {
    serve = (u, method) =>
      u === PLACES ? PLACES_OK
      : u === FOOTPRINT ? footprintOf()
      : u === PLAN ? footprintOf({}, { refs: true })
      : u === "/api/git/footprint/clean" && method === "POST" ? new Refusal(409, "a Clean up runs in this repository already")
      : undefined;
    const { body, s } = mount();
    await s.load({ footprint: true });
    await lineDrawn(body);
    await openSheet(body);
    const all = /** @type {any} */ (doc.document.body.querySelector(".pl-clean-all input"));
    all.checked = true;
    all.dispatch("change");
    assert.deepEqual(doc.document.body.querySelectorAll(".pl-clean-row input").map((/** @type {any} */ b) => !!b.checked), [true, true]);
    sheetButton("Clean up").dispatch("click");
    await until(() => times(FOOTPRINT) === 2, "the line read again");
    assert.equal(posted[0].body.plan.refs.filter((/** @type {any} */ r) => /sa_cccccccc|othr0001/.test(r.ref)).length, 3, "every ticked row's refs");
    assert.ok(toasts().some(([t, cls]) => t === "Clean up: a Clean up runs in this repository already" && /\berr\b/.test(cls)), JSON.stringify(toasts()));
    serve = (u) => (u === PLACES ? { cwd: "/r", ok: false, error: "not in a git repository", places: [], removed: [] } : u === FOOTPRINT ? footprintOf() : undefined);
    asked.length = 0;
    await s.load({ footprint: true });
    assert.deepEqual(asked, [PLACES], "no footprint where the places could not be read");
    assert.equal(body.querySelector(".pl-foot"), null);
  });

  // (fails before: yes — the review's (round 2) items 2 and 4: "All" ticked another Filament's chats with the rest; a
  // copy's folder a Clean up could not remove all the way was said nowhere)
  test("All ticks this Filament's rows, not another Filament's, which stand last under their own head; a folder left part way is said in an error toast", async () => {
    const LEFT = "/r/.git/filament-worktrees/.chk-1.letting-go-x";
    const plan = () => {
      const a = footprintOf({}, { refs: true });
      a.refs.kinds[1].groups.push({ owner: "othr0009", part: "undo", count: 2, newest: NOON, goes: false, tick: true, others: true, why: "w", refs: [{ ref: "refs/filament/snapshots/othr0009/0", commit: C1 }] });
      return a;
    };
    serve = (u, method) =>
      u === PLACES ? PLACES_OK
      : u === FOOTPRINT ? footprintOf()
      : u === PLAN ? plan()
      : u === "/api/git/footprint/clean" && method === "POST" ? { ok: true, went: { copies: ["chk-1"], left: [], refs: { subagents: 2, snapshots: 4, moves: 1, other: 0 }, branches: [] }, stayed: [], left: [LEFT] }
      : undefined;
    const { body, s } = mount();
    await s.load({ footprint: true });
    await lineDrawn(body);
    await openSheet(body);
    assert.equal(doc.document.body.querySelector(".pl-clean-all").textContent, "All 2 of these, not another Filament's");
    assert.deepEqual(rowsOf().map(([id]) => id), ["sa_cccccccc", "othr0001", "othr0009"]);
    assert.ok(texts(doc.document.body, ".pl-clean-h").some((t) => /^Another Filament's — /.test(t)), "under their own head");
    const all = /** @type {any} */ (doc.document.body.querySelector(".pl-clean-all input"));
    all.checked = true;
    all.dispatch("change");
    assert.deepEqual([!!all.checked, ...rowsOf().map((r) => r[3])], [true, true, true, false], "another Filament's stays unticked");
    sheetButton("Clean up").dispatch("click");
    await until(() => times(FOOTPRINT) === 2, "the line read again");
    const sent = posted[0].body.plan.refs.map((/** @type {any} */ r) => r.ref);
    assert.deepEqual([sent.filter((/** @type {string} */ r) => /sa_cccccccc|othr0001/.test(r)).length, sent.some((/** @type {string} */ r) => /othr0009/.test(r))], [3, false]);
    assert.ok(toasts().some(([t, cls]) => t === `A copy's folder could not be deleted all the way; what is left is at ${LEFT}. The next Clean up removes it.` && /\berr\b/.test(cls)), JSON.stringify(toasts()));
  });

  // (fails before: yes — the owner's of 11-09: the rows stood one after another, a hundred of them, with "All" alone to
  // tick them by; no group, and no group's tick)
  test("the rows grouped by kind: a group's tick ticks its rows and only its rows; another Filament's are in no group's tick nor All; a long group starts folded", async () => {
    /** @param {string} id @param {number} n */
    const refsOf = (id, n) => Array.from({ length: n }, (_, i) => ({ ref: `refs/filament/${id}/${i}`, commit: C1 }));
    const plan = () => {
      const a = footprintOf({}, { refs: true });
      for (const id of ["sa_dddddddd", "sa_eeeeeeee", "sa_ffffffff", "sa_99999999", "sa_88888888"]) a.refs.kinds[0].groups.push({ owner: id, part: "mark", count: 2, newest: NOON, goes: false, tick: true, others: false, why: "w", refs: refsOf(`subagents/${id}`, 2) });
      a.refs.kinds[1].groups.push({ owner: "othr0002", part: "undo", count: 4, newest: NOON, goes: false, tick: true, others: false, why: "w", refs: refsOf("snapshots/othr0002", 4) });
      for (const id of ["othr0009", "othr0010"]) a.refs.kinds[1].groups.push({ owner: id, part: "undo", count: 2, newest: NOON, goes: false, tick: true, others: true, why: "w", refs: refsOf(`snapshots/${id}`, 2) });
      return a;
    };
    serve = (u, method) =>
      u === PLACES ? PLACES_OK
      : u === FOOTPRINT ? footprintOf()
      : u === PLAN ? plan()
      : u === "/api/git/footprint/clean" && method === "POST" ? { ok: true, went: { copies: [], refs: {}, branches: [] }, stayed: [] }
      : undefined;
    const { body, s } = mount();
    await s.load({ footprint: true });
    await lineDrawn(body);
    await openSheet(body);
    const groups = doc.document.body.querySelectorAll(".pl-clean-group");
    assert.deepEqual(
      groups.map((/** @type {any} */ g) => [g.getAttribute("data-group"), !!g.querySelector(".pl-clean-gtick"), g.querySelector("details").open, g.querySelectorAll(".pl-clean-row").length]),
      [["subagents:mark", true, false, 6], ["snapshots:undo", true, true, 2], ["snapshots:undo", false, true, 2]],
      "this Filament's groups with their ticks, the long one folded; another Filament's last, with none",
    );
    assert.equal(groups[0].querySelector("summary").textContent, "6 sub-agents · 12 refs · newest 2026-11-02");
    const [helpers, chats] = groups.slice(0, 2).map((/** @type {any} */ g) => g.querySelector(".pl-clean-gtick input"));
    const all = /** @type {any} */ (doc.document.body.querySelector(".pl-clean-all input"));
    const on = () => rowsOf().map((r) => r[3]);
    tick(chats, true);
    assert.deepEqual(on(), [false, false, false, false, false, false, true, true, false, false], "the chats' rows, not the helpers', not another Filament's");
    assert.deepEqual([all.checked, all.indeterminate], [false, true], "All: some of its rows");
    const othr0002 = doc.document.body.querySelector(".pl-clean-row[data-key='snapshots:othr0002:undo'] input");
    tick(othr0002, false);
    assert.deepEqual([chats.checked, chats.indeterminate], [false, true], "a row off: its group's tick half ticked");
    tick(helpers, true);
    assert.deepEqual(on(), [true, true, true, true, true, true, true, false, false, false]);
    tick(all, true);
    assert.deepEqual([on(), helpers.checked, chats.checked, chats.indeterminate], [[true, true, true, true, true, true, true, true, false, false], true, true, false], "All: every row of this Filament's, none of another's");
    tick(othr0002, false);
    sheetButton("Clean up").dispatch("click");
    await until(() => posted.length === 1, "the press");
    const sent = posted[0].body.plan.refs.map((/** @type {any} */ r) => r.ref);
    assert.deepEqual(
      [sent.filter((/** @type {string} */ r) => r.startsWith("refs/filament/subagents/sa_") && !/sa_bbbbbbbb/.test(r)).length, sent.filter((/** @type {string} */ r) => /othr000[12]/.test(r)), sent.some((/** @type {string} */ r) => /othr00(09|10)/.test(r))],
      [12, ["refs/filament/snapshots/othr0001/0"], false],
      "every helper ticked by its group, the one chat left ticked, nothing of another Filament's",
    );
  });

  // (fails before: yes — `.zc-dialog` had no max-height and its overlay no scroll: a long body stood the card taller than
  // the window, its title and its buttons out of reach; five sheets held themselves to 100vh one by one, the app's bar
  // left out)
  test("no dialog stands taller than its overlay, its body the part that scrolls; the sheets that held themselves one by one no longer do", () => {
    const css = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), "utf8");
    const harness = css("harness.css");
    assert.match(harness, /\n\.zc-dialog \{ max-height: calc\(100% - 48px\); \}/);
    assert.match(harness, /\n:where\(\.zc-dialog-body\) \{ min-height: 0; overflow-y: auto;/);
    assert.match(harness, /html\.app-frame :is\(\.zc-dialog-overlay, \.zc-sheet-overlay, \.picture-view\) \{ top: var\(--bar-h\); \}/, "the overlay starts under the app's bar");
    assert.doesNotMatch(css("harness/settings/settings.css"), /\.zc-dialog:has\([^)]*\) \{[^}]*max-height: calc\(100vh/);
    assert.doesNotMatch(css("harness/library/library.css"), /\.zc-dialog\.is-ed \{[^}]*max-height/);
  });

  // (fails before: yes — the sheet opened from the line's own button alone; the Plan's Still open card could not open it)
  test("the sheet opened on its own, as the Plan's Still open card opens it: the plan read whole, what it does said as it goes, the press posted, and the opener told", async () => {
    serve = (u, method) =>
      u === PLAN ? footprintOf({}, { refs: true })
      : u === "/api/git/footprint/clean" && method === "POST" ? { ok: true, went: { copies: ["chk-1", "spare-1a2b3c4d"], refs: { subagents: 2, snapshots: 4, moves: 1, other: 0 }, branches: ["routine-morning-brief-1027"] }, stayed: [] }
      : undefined;
    /** @type {string[]} */
    const said = [];
    let cleaned = 0;
    await openCleanUp("/r", { busy: (doing) => said.push(doing), onCleaned: () => { cleaned++; } });
    assert.deepEqual([times(PLAN), said], [1, ["reading", ""]], "the plan read whole as it opens");
    assert.equal(doc.document.body.querySelector(".zc-dialog-title").textContent, "Clean up Filament's footprint?");
    sheetButton("Clean up").dispatch("click");
    await until(() => cleaned === 1, "the opener told the press ran");
    assert.deepEqual([said, posted.map((p) => [p.url, p.body.cwd])], [["reading", "", "cleaning"], [["/api/git/footprint/clean", "/r"]]]);
    assert.ok(toasts().some(([t]) => t === "Cleaned up: 2 copies, 7 refs and 1 branch went"), JSON.stringify(toasts()));
  });
});
