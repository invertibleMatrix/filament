// @ts-check
// Runs by itself, on a Space's overview beside its lanes: every routine and watcher not removed and every app, one row
// each — an icon by its kind, its title, one quiet line (a routine's when, what a watcher watches as plain words, an
// app's foot), and at its right how it stands, a dot and a word. The words of how a row stands are the page's
// (lib/space-view.js `byItselfStands`); the part draws them (space/by-itself.js): failed first, then proposed and
// drafts, then what is on, then paused; six rows, then "and N more"; a row a button that opens its page; Switch on… on
// one proposed — its sheet, nothing switched by the press —, Keep… on a draft app, and no pause switch; one line and
// two ways to make one where the Space has none; drawn in place.
// (fails before: yes — the part is new: an overview said nothing of what runs by itself)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as routinesCore from "../src/core/routines.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { byItselfStands, routineMakeWords, watcherMakeWords } from "../src/ui/harness/lib/space-view.js";
import { footOf, tabOf } from "../src/ui/harness/lib/space-dashboards.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { byItselfPart } from "../src/ui/harness/space/by-itself.js";

const g = /** @type {any} */ (globalThis);
const MIN = 60_000;
const HOUR = 3_600_000;
/** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const NOW = at(10);
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
/** A watcher on, as its Space keeps it. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const watcher = (o = {}) => ({
  id: "w1", title: "Supervisor", when: "", task: "Read its turn; say where it drifted.", writes: false, trigger: { kind: "turn", chat: "c2", turns: "all", every: 1 }, wakes: "new", state: "on", paused: false,
  madeIn: "c1", madeBy: "Lead", model: "m", at: at(9), onAt: at(9), upTo: null, last: null, skipped: null, seen: { from: at(9), at: null, ids: [] }, pending: null, ...o,
});
/** A routine at times. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const timed = (o = {}) => ({ ...watcher({ id: "t1", title: "Morning brief", when: "daily 09:00", task: "Read what came in." }), trigger: undefined, wakes: undefined, seen: undefined, pending: undefined, ...o });
/** A routine as the Space's read gives it: as kept, with its project, its chat's name and Filament's words. @param {import("../src/core/routines.js").Routine} r @param {any} [o] @returns {any} */
const said = (r, o = {}) => ({ ...r, project: "p1", madeName: nameOf(r.madeIn), words: routinesCore.rowWords(r, { now: NOW, nameOf, ...o }) });
/** A run of 09:10. @param {any} o */
const run = (o) => ({ at: at(9, 10), chain: "c9", by: "event", ...o });
/** What runs by itself, as the Space's read says it. @param {any[]} routines */
const runsOf = (routines) => ({ head: "", listening: "", pausedSince: null, routines, watches: [] });
const NONE = { sources: {}, watch: [], actions: {} };
/** An app as the Space's read gives it: kept and live. @param {any} [o] @returns {any} */
const app = (o = {}) => ({ name: "pulse-cd34", title: "Pulse", type: "app", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at(9), grant: NONE, newest: NONE,
  reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at(9), ...o });
const DEPLOYS = { sources: { deploys: { command: ["npx", "wrangler", "deployments", "list"], every: 2 * MIN } }, watch: [], actions: {} };

describe("how a row of Runs by itself stands (the page's words)", () => {
  test("a routine's and a watcher's: Proposed, Paused — by Filament where it says why —, Failed, else On for a routine and Listening for a watcher; its tone its row's on its own page", () => {
    /** @param {any} o */
    const of = (o) => byItselfStands({ kind: "routine", state: "on", paused: false, tone: "", ...o });
    assert.deepEqual(of({ state: "proposed" }), { word: "Proposed", tone: "proposed", rank: 1 });
    assert.deepEqual(of({ state: "proposed", paused: true, tone: "bad" }), { word: "Proposed", tone: "proposed", rank: 1 }, "one proposed is proposed, whatever else is said of it");
    assert.deepEqual(of({ paused: true }), { word: "Paused", tone: "paused", rank: 3 });
    assert.deepEqual(of({ kind: "watcher", paused: true, pausedWhy: "the chat it wakes (Lead) is gone", tone: "bad" }), { word: "Paused by Filament", tone: "paused", rank: 3 }, "paused, its failed run is said on its page");
    assert.deepEqual(of({ tone: "bad" }), { word: "Failed", tone: "bad", rank: 0 });
    assert.deepEqual(of({ kind: "watcher", tone: "bad" }), { word: "Failed", tone: "bad", rank: 0 });
    assert.deepEqual(of({}), { word: "On", tone: "on", rank: 2 });
    assert.deepEqual(of({ kind: "watcher" }), { word: "Listening", tone: "on", rank: 2 });
    assert.deepEqual([of({ tone: "works" }), of({ kind: "watcher", tone: "asks" })], [{ word: "On", tone: "works", rank: 2 }, { word: "Listening", tone: "asks", rank: 2 }], "a run under way keeps the word, its dot the run's colour");
  });

  test("an app's, as its row in the left bar says it: Draft, Paused, Live; one whose source fails or whose scripts wait for a Keep says so, first", () => {
    /** @param {any} o */
    const of = (o) => byItselfStands({ kind: "app", draft: false, paused: false, fault: false, held: false, ...o });
    assert.deepEqual(of({}), { word: "Live", tone: "live", rank: 2 });
    assert.deepEqual(of({ draft: true }), { word: "Draft", tone: "draft", rank: 1 });
    assert.deepEqual(of({ paused: true }), { word: "Paused", tone: "paused", rank: 3 });
    assert.deepEqual(of({ fault: true }), { word: "Couldn't read", tone: "bad", rank: 0 });
    assert.deepEqual(of({ held: true }), { word: "Waits for your Keep", tone: "bad", rank: 0 });
    assert.deepEqual(of({ draft: true, fault: true }), { word: "Couldn't read", tone: "bad", rank: 0 }, "a draft whose live version fails: the failure first");
    // The words follow what the left bar's row reads of a real app (lib/space-dashboards.js `tabOf`).
    const t = tabOf(app({ grant: DEPLOYS, newest: DEPLOYS, sources: { deploys: { at: NOW - 12 * MIN, error: "npx exited 1", errorAt: NOW - MIN, fails: 1, stopped: false, rows: 2 } } }), NOW);
    assert.deepEqual(byItselfStands({ kind: "app", ...t }), { word: "Couldn't read", tone: "bad", rank: 0 });
    assert.deepEqual(byItselfStands({ kind: "app", ...tabOf(app({ state: "draft", draft: true, keptV: null, liveV: null, keptAt: null, grant: null }), NOW) }), { word: "Draft", tone: "draft", rank: 1 });
    assert.deepEqual(byItselfStands({ kind: "app", ...tabOf(app({ paused: true }), NOW) }), { word: "Paused", tone: "paused", rank: 3 });
  });
});

describe("Runs by itself, on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    // A sheet asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  /** Every part drawn, taken off the page as its test ends. @type {any[]} */
  const drawn = [];
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
    for (const el of drawn.splice(0)) el.remove();
    for (const s of doc.document.body.querySelectorAll(".zc-sheet")) s.remove();
  });

  const W = {
    // On: it listens.
    on: said(watcher()),
    // Proposed by its chat.
    proposed: said(watcher({ id: "w2", title: "Triage", trigger: { kind: "ask", afterMin: 10 }, wakes: "chat", state: "proposed", seen: null })),
    // Paused by Filament, its last run failed.
    paused: said(watcher({ id: "w3", title: "Fixer", wakes: "chat", paused: true, pausedWhy: "the chat it wakes (Lead) is gone", last: run({ state: "failed", ended: at(9, 11), why: "the chat it wakes is gone" }) })),
    // On, its last run failed.
    failed: said(watcher({ id: "w4", title: "Deploy watch", trigger: { kind: "commit", branch: "main" }, last: run({ state: "failed", ended: at(9, 11), why: "sign-in expired" }) })),
    // Removed: listed nowhere.
    removed: said(watcher({ id: "w5", title: "Gone", state: "removed" })),
  };
  const T = {
    on: said(timed()),
    proposed: said(timed({ id: "t2", title: "Weekly update", when: "mon 09:00", state: "proposed" })),
    paused: said(timed({ id: "t3", title: "Night sweep", paused: true })),
  };
  const LIVE = app();
  const DRAFT = app({ name: "notes-ef56", title: "Notes", state: "draft", draft: true, keptV: null, liveV: null, keptAt: null, grant: null });
  const PAUSED = app({ name: "habits-aa11", title: "Habits", paused: true });
  const BOARD = app({ name: "deploys-ab12", title: "Deploys", type: undefined, grant: DEPLOYS, newest: DEPLOYS, sources: { deploys: { at: NOW - 2 * MIN, error: null, errorAt: 0, fails: 0, stopped: false, rows: 2 } } });

  /**
   * The part drawn by itself, with what the page hands it.
   * @param {{ startWith?: boolean, makes?: () => boolean }} [o]  `startWith`: false where the page has no Start to fill;
   *   `makes`: whether the project has no Space yet, so the first add makes it
   */
  const mount = (o = {}) => {
    const did = { wrote: /** @type {any[]} */ ([]), went: /** @type {any[]} */ ([]), kept: /** @type {string[]} */ ([]), started: /** @type {any[]} */ ([]), pages: /** @type {any[]} */ ([]), opened: /** @type {string[]} */ ([]) };
    const part = byItselfPart({
      all: false,
      place: () => ({ id: "p1", name: "web", cwd: "/w" }),
      write: async (project, method, path, body) => (did.wrote.push([project, method, path, body]), {}),
      pauseAll: async () => true,
      ...(o.startWith === false ? {} : { startWith: (/** @type {string} */ cwd, /** @type {string} */ words) => void did.started.push([cwd, words]) }),
      openChat: (chain) => void did.opened.push(chain),
      openTab: (project, name) => void did.went.push([project, name]),
      keep: (name) => void did.kept.push(name),
      pages: (anchor) => void did.pages.push(anchor),
      now: () => NOW,
      ...(o.makes ? { makes: o.makes } : {}),
    });
    doc.document.body.append(part.el);
    drawn.push(part.el);
    const el = /** @type {any} */ (part.el);
    /** Each row as it reads: its key, its classes, its title, its line, its word, its button at the right. */
    const rows = () => el.querySelectorAll(".sbi-row").map((/** @type {any} */ r) => [r.getAttribute("data-key"), r.getAttribute("class"), r.querySelector(".sbi-title").textContent, r.querySelector(".sbi-line").textContent, r.querySelector(".sbi-word").textContent, r.querySelector(".sbi-go")?.textContent || ""]);
    /** @param {string} key */
    const rowOf = (key) => /** @type {any} */ (el.querySelector(`.sbi-row[data-key='${key}']`));
    return { part, did, el, rows, rowOf };
  };

  test("a row for each routine, watcher and app: its icon by kind, its title, one quiet line, and a dot and a word for how it stands; one removed is not listed", () => {
    const { part, el, rows, rowOf } = mount();
    assert.deepEqual([el.getAttribute("class"), el.getAttribute("aria-label"), el.hasAttribute("hidden")], ["sp-sec sp-by-itself", "Runs by itself", true], "hidden until a Space is read");
    part.paint(runsOf([T.on, W.on, W.removed]), [LIVE, BOARD]);
    assert.equal(el.hidden, false);
    assert.deepEqual([el.querySelector(".sp-sec-name").textContent, el.querySelector(".sp-sec-count").textContent], ["Runs by itself", "4"]);
    assert.deepEqual(rows(), [
      ["routine:p1|t1", "sbi-row is-routine is-on", "Morning brief", T.on.words.when, "On", ""],
      ["watcher:p1|w1", "sbi-row is-watcher is-on", "Supervisor", "each turn of Build the login flow", "Listening", ""],
      ["app:pulse-cd34", "sbi-row is-app is-live", "Pulse", footOf(LIVE, NOW), "Live", ""],
      ["app:deploys-ab12", "sbi-row is-app is-live", "Deploys", "Reads deploys by itself · v1, kept 09:00", "Live", ""],
    ]);
    assert.equal(T.on.words.when, "daily at 09:00", "a routine's when, as its row on Routines says it");
    assert.equal(el.querySelector(".sbi-list").getAttribute("role"), "list");
    assert.ok(el.querySelectorAll(".sbi-row").every((/** @type {any} */ r) => r.getAttribute("role") === "listitem" && r.querySelector("button.sbi-face") && r.querySelector(".sbi-dot")), "each a list's item, its face a button, its dot");
    // The icon each kind has where else it is named: Routines' clock, the watchers' eye, an app's and a dashboard's in the left bar.
    assert.deepEqual(["routine:p1|t1", "watcher:p1|w1", "app:pulse-cd34", "app:deploys-ab12"].map((k) => rowOf(k).querySelector(".sbi-ic").innerHTML),
      [ICONS.clock3, ICONS.eye, ICONS.appWindow, ICONS.layoutDashboard]);
    // What a watcher watches as plain words: the chat it names is no link here — the row is the button.
    assert.equal(rowOf("watcher:p1|w1").querySelectorAll("button").length, 1, "its face alone");
    // The whole of a line that is cut, on hover.
    assert.deepEqual([rowOf("watcher:p1|w1").querySelector(".sbi-line").getAttribute("title"), rowOf("watcher:p1|w1").querySelector(".sbi-title").getAttribute("title")], ["each turn of Build the login flow", "Supervisor"]);
    assert.equal(el.querySelector(".sbi-none").hidden, true);
    assert.equal(el.querySelector(".set-switch"), null, "no pause switch on an overview");
  });

  test("the order: failed first, then proposed and drafts, then what is on, then paused — within each as the answer has them", () => {
    const { part, rows } = mount();
    part.paint(runsOf([T.on, W.paused, W.on, T.proposed, W.failed, T.paused]), [LIVE, DRAFT, PAUSED]);
    assert.deepEqual(rows().map((r) => [r[0], r[1].replace("sbi-row ", ""), r[4], r[5]]), [
      ["watcher:p1|w4", "is-watcher is-bad", "Failed", ""],
      ["routine:p1|t2", "is-routine is-proposed", "Proposed", "Switch on…"],
      ["app:notes-ef56", "is-app is-draft", "Draft", "Keep…"],
      ["routine:p1|t1", "is-routine is-on", "On", ""],
      ["watcher:p1|w1", "is-watcher is-on", "Listening", ""],
      ["app:pulse-cd34", "is-app is-live", "Live", ""],
    ], "six rows");
  });

  test("six rows, then one quiet line: and N more — Watchers where every hidden one is a watcher, Routines where a routine is among them, else the Space's pages", () => {
    const { part, did, el } = mount();
    const more = () => /** @type {any} */ (el.querySelector(".sbi-more"));
    const six = [T.on, W.on, said(timed({ id: "t4", title: "Four" })), said(timed({ id: "t5", title: "Five" })), said(timed({ id: "t6", title: "Six" })), said(timed({ id: "t7", title: "Seven" }))];
    part.paint(runsOf(six), []);
    assert.deepEqual([el.querySelectorAll(".sbi-row").length, more().hidden], [6, true], "six: no line");
    // Hidden: two watchers.
    part.paint(runsOf([...six, W.paused, said(watcher({ id: "w6", title: "Late", paused: true }))]), []);
    assert.deepEqual([el.querySelectorAll(".sbi-row").length, el.querySelector(".sp-sec-count").textContent, more().hidden, more().textContent, more().tagName], [6, "8", false, "and 2 more", "BUTTON"]);
    more().dispatch("click");
    assert.deepEqual(did.went, [["p1", "@watchers"]]);
    // Hidden: a routine and a watcher.
    part.paint(runsOf([...six, W.paused, T.paused]), [PAUSED]);
    assert.equal(more().textContent, "and 3 more");
    more().dispatch("click");
    assert.deepEqual(did.went.at(-1), ["p1", "@routines"]);
    // Hidden: an app, and no routine — neither page lists it: the Space's pages, from the line.
    part.paint(runsOf(six), [PAUSED]);
    assert.equal(more().textContent, "and 1 more");
    more().dispatch("click");
    assert.deepEqual([did.went.length, did.pages.length, did.pages[0] === more()], [2, 1, true]);
  });

  test("a row is a button that opens its page: Routines, Watchers, an app's own", () => {
    const { part, did, rowOf } = mount();
    part.paint(runsOf([T.on, W.on]), [LIVE]);
    for (const k of ["routine:p1|t1", "watcher:p1|w1", "app:pulse-cd34"]) rowOf(k).querySelector(".sbi-face").dispatch("click");
    assert.deepEqual(did.went, [["p1", "@routines"], ["p1", "@watchers"], ["p1", "pulse-cd34"]]);
    assert.deepEqual([did.wrote, did.kept], [[], []], "a press opens a page and writes nothing");
    // What the left bar's row says of an app is its row's tip here; a routine's, how its last run went.
    assert.equal(rowOf("app:pulse-cd34").querySelector(".sbi-face").getAttribute("title"), tabOf(LIVE, NOW).tip);
    part.paint(runsOf([W.failed]), []);
    assert.equal(rowOf("watcher:p1|w4").querySelector(".sbi-face").getAttribute("title"), W.failed.words.last);
    assert.match(W.failed.words.last, /failed: sign-in expired$/);
  });

  test("one proposed carries Switch on…, which opens its sheet and switches nothing; a draft app carries Keep…, its page's own", async () => {
    const { part, did, rowOf } = mount();
    part.paint(runsOf([W.proposed, T.on]), [DRAFT, LIVE]);
    const go = rowOf("watcher:p1|w2").querySelector(".sbi-go");
    assert.deepEqual([go.textContent, go.getAttribute("title"), rowOf("routine:p1|t1").querySelector(".sbi-go"), rowOf("app:pulse-cd34").querySelector(".sbi-go")], ["Switch on…", W.proposed.words.press.on, null, null]);
    go.dispatch("click");
    const sheet = /** @type {any} */ (await until(() => doc.document.body.querySelector(".srt-sheet"), "the sheet the Watchers page opens"));
    assert.match(sheet.querySelector(".sp-sheet-title").textContent, /Triage/);
    assert.deepEqual([did.wrote, did.went], [[], []], "nothing is switched by that press alone, and no page opens");
    sheet.querySelector(".zc-sheet-x").dispatch("click");
    const keep = rowOf("app:notes-ef56").querySelector(".sbi-go");
    assert.deepEqual([keep.textContent, keep.getAttribute("title")], ["Keep…", "Everything it will do, in Filament's words: nothing runs until you keep it"]);
    keep.dispatch("click");
    assert.deepEqual([did.kept, did.wrote, did.went], [["notes-ef56"], [], []], "the Keep sheet is its page's; nothing is kept by the press");
  });

  test("with none: one quiet line, and Routine… and Watcher…, which fill the Start as Add to this Space…'s do", () => {
    const { part, did, el } = mount();
    part.paint(runsOf([W.removed]), []);
    const none = el.querySelector(".sbi-none");
    assert.deepEqual([none.hidden, none.querySelector(".sp-quiet").textContent, el.querySelector(".sp-sec-count").textContent, el.querySelectorAll(".sbi-row").length], [false, "Nothing runs by itself here yet.", "", 0]);
    const makes = none.querySelectorAll("button");
    assert.deepEqual(makes.map((/** @type {any} */ b) => [b.textContent, b.getAttribute("class")]), [["Routine…", "ghost sm sbi-make"], ["Watcher…", "ghost sm sbi-make"]]);
    makes[0].dispatch("click");
    makes[1].dispatch("click");
    assert.deepEqual(did.started, [["/w", routineMakeWords("web")], ["/w", watcherMakeWords("web")]]);
    // No Start to fill: the line alone.
    const bare = mount({ startWith: false });
    bare.part.paint(null, []);
    assert.deepEqual([bare.el.querySelector(".sbi-none .sp-quiet").textContent, bare.el.querySelectorAll(".sbi-none button").length], ["Nothing runs by itself here yet.", 0]);
  });

  // (fails before: yes — by need, 11-12: the part was not drawn on a project with no Space, and its buttons said nothing
  // of making one)
  test("on a project with no Space, Routine… and Watcher… say in their tips that the press makes it; once it has one, as before", () => {
    let makes = true;
    const { part, el } = mount({ makes: () => makes });
    part.paint(null, []);
    const tips = () => el.querySelectorAll(".sbi-none button").map((/** @type {any} */ b) => b.getAttribute("title"));
    assert.deepEqual(tips(), [
      "The Start here, its box begun: an agent proposes the routine, and it runs only once you switch it on; this makes the project's Space",
      "The Start here, its box begun: an agent proposes the watcher, and it listens only once you switch it on; this makes the project's Space",
    ]);
    makes = false;
    part.paint(runsOf([]), []);
    assert.deepEqual(tips(), [
      "The Start here, its box begun: an agent proposes the routine, and it runs only once you switch it on",
      "The Start here, its box begun: an agent proposes the watcher, and it listens only once you switch it on",
    ]);
  });

  test("drawn in place: a word that moves leaves each row, its face and its Switch on… the elements they were", () => {
    const { part, did, rowOf } = mount();
    part.paint(runsOf([W.proposed, W.on]), [LIVE]);
    const find = () => ({ row: rowOf("watcher:p1|w1"), face: rowOf("watcher:p1|w1")?.querySelector(".sbi-face"), proposed: rowOf("watcher:p1|w2"), go: rowOf("watcher:p1|w2")?.querySelector(".sbi-go"), app: rowOf("app:pulse-cd34")?.querySelector(".sbi-face") });
    const was = find();
    assert.ok(Object.values(was).every(Boolean));
    // Its run failed, and the app was paused: their words and their order move.
    part.paint(runsOf([W.proposed, said(watcher({ last: run({ state: "failed", ended: at(9, 11), why: "sign-in expired" }) }))]), [{ ...LIVE, paused: true }]);
    const now = find();
    for (const k of Object.keys(was)) assert.ok(/** @type {any} */ (now)[k] === /** @type {any} */ (was)[k], `its ${k}`);
    assert.deepEqual([was.row.getAttribute("class"), was.row.querySelector(".sbi-word").textContent, was.row.parentNode.children.indexOf(was.row)], ["sbi-row is-watcher is-bad", "Failed", 0], "the row says its newest word, first now");
    was.face.dispatch("click");
    assert.deepEqual(did.went, [["p1", "@watchers"]], "a press on the face that stood opens its page");
  });

  test("its look: a card of rows, each one line of title and one of words; the theme's tokens alone", () => {
    const css = readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8");
    const mine = css.split("\n").filter((l) => /\.sbi-/.test(l)).join("\n");
    assert.ok(mine.length > 400, "its rules stand in the Space's sheet");
    assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "no raw colour");
    assert.match(mine, /\.sbi-title \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, "a title is one line, cut");
    assert.match(mine, /\.sbi-line \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, "its words too");
    assert.match(mine, /\.sbi-row\.is-bad \.sbi-dot \{ background: var\(--color-sys-red\); \}/, "a failed one's dot is red");
    // (moved on purpose, by need of 11-12: a project with no Space draws it, with its two buttons)
    assert.match(css, /\.sp-is-deleted \.sp-by-itself[^{]*\{ display: none !important; \}/, "a project whose deleted Space waits draws none of it, as it draws no board");
    assert.doesNotMatch(css, /\.sp-is-none \.sp-by-itself/);
    assert.match(css, /\.sp-by-itself\[hidden\][^{]*\{ display: none; \}/);
  });
});
