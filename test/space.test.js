// @ts-check
// proposal_ux §4.14, U5 phase 8: a project's Space. Its lanes' arithmetic — a lane per place a chat of the project
// works in, the main folder always, the chat that leads it and what it does now (a team's lead by its team), what the
// place holds against its base —; the page drawn in a stub document against a stand-in server: its head, its lanes,
// New chat here… and New lane… (each fills the Start, nothing sent), Project settings, the Space the server keeps read
// as the page opens and again as the stream says it moved — a lane's task and newest line, a sync's point between two
// lanes, the board, What happened, Overlaps and Compare… —, Tell the chats… and Tell them, Where you left off and
// Needs you here (HarnessV4_Space_Plan S1), the places folded at the foot; and the places' rows with Remove and Put
// back. Last, its address and the ways in. The board's, What happened's and the Tell the chats card's own workings are
// space-board.test.js's; the server's, space-server.test.js's.
// (fails before: yes — the Space is new; the places' rows stood under Changes' Branch; S1: the mock's order)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { fakeH } from "./helpers/fake-dom.js";
import { moreWords } from "./helpers/routine-words.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** A refusal the stand-in server answers, in the server's words. */
class Refusal {
  /** @param {number} status @param {string} error @param {Record<string, unknown>} [more]  what else its body says */
  constructor(status, error, more = {}) {
    this.status = status;
    this.error = error;
    this.more = more;
  }
}
/**
 * What the stand-in server answers by the whole address (and the method): a body, a `Refusal`, or undefined for a 404 —
 * or a promise of one, an answer the test holds on its way.
 * @type {(url: string, method: string) => any}
 */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method === "GET") asked.push(String(url));
  else posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  let body = serve(String(url), method);
  if (body instanceof Promise) body = await body;
  if (body instanceof Refusal) return new Response(JSON.stringify({ error: body.error, ...body.more }), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { PROJECT_PAGES, laneChat, laneFacts, lanesOf, lanesWords, leaveSpace, renderSpace, spaceForAsk } = await import("../src/ui/harness/space/space.js");
const { placesSection, placesWords } = await import("../src/ui/harness/space/places.js");
const { isScreen, onScreen, parseRoute, routeFor } = await import("../src/ui/harness/lib/router.js");
const { nameFromMessage, newWorktreeChoice } = await import("../src/ui/harness/conversation/works-in.js");
const { appliesTo } = await import("../src/ui/harness/lib/applies-to.js");
const { h } = await import("../src/ui/lib/dom.js");
const { madeWords, notNowChoices, routineMakeWords, untilWords, watcherMakeWords, whenWords } = await import("../src/ui/harness/lib/space-view.js");
const { takeJump } = await import("../src/ui/harness/settings/search.js");
/** A moment as a lane's newest line says it. @param {number} at */
const whenWordsOf = (at) => whenWords(at, Date.now());

after(() => {
  g.fetch = realFetch;
});

/** How many times the page asked for exactly this address. @param {string} url */
const times = (url) => asked.filter((u) => u === url).length;
/** @param {string} rel */
const src = (rel) => readFileSync(new URL(`../src/ui/harness/${rel}`, import.meta.url), "utf8");
const HOUR = 3_600_000;

const MAIN = { path: "/r", name: "r", main: true, ok: true, branch: "main", base: "main", onBase: true, ahead: 0, behind: 0,
  uncommitted: { files: 2 }, chats: [{ id: "c20", name: "on main", home: true, atWork: false }], removable: false, why: "the repository's main folder", goes: null };
const WT = { ...MAIN, path: "/r-wt", name: "r-wt", main: false, branch: "agent", onBase: false, ahead: 2, uncommitted: { files: 0 },
  chats: [{ id: "c21", name: "the agent", home: true, atWork: true }], why: "its branch holds 2 commits main lacks",
  mergedInto: "main", merged: false, removableWithBranch: false, whyBranch: "its branch holds commits main lacks" };
const DONE = { ...MAIN, path: "/r-done", name: "r-done", main: false, branch: "done", onBase: false, uncommitted: { files: 0 },
  chats: [{ id: "c22", name: "fix it", home: true, atWork: false }], removable: true, why: null,
  mergedInto: "main", merged: true, removableWithBranch: true, whyBranch: null,
  goes: { names: [{ path: ".env", link: false }, { path: "node_modules/", link: true }], more: 0 } };
const GONE = { path: "/r-gone", name: "r-gone", main: false, ok: false, missing: true, error: "its folder is gone", branch: "gone",
  chats: [], removable: false, why: "its folder is gone", goes: null };
const OUT = { path: "/o", name: "o", main: false, ok: false, missing: false, refused: true, branch: "out",
  error: "/o is not under any folder listed in agentLoop.roots", chats: [], removable: false, why: "/o is not under any folder listed in agentLoop.roots", goes: null };
const REMOVED = { id: "rm1", path: "/r-done", name: "r-done", branch: "done", head: "abc12345", at: new Date(2026, 9, 16, 14, 2).getTime() };
/** The places answer as `/git/places` gives it. @param {any[]} places @param {any[]} [removed] @param {string} [cwd] */
const placesOf = (places, removed = [], cwd = "/r") => ({ cwd, ok: true, error: null, name: "r", main: "/r", places, removed });

/**
 * What the Space reads of the chats: the left bar's facts, Now's rows, the chats whose last run stopped.
 * @param {Record<string, any>} chats @param {Record<string, any>} [rows] @param {string[]} [failed]
 * @returns {import("../src/ui/harness/space/space.js").LaneLook}
 */
const lookOf = (chats, rows = {}, failed = []) => ({
  chat: (id) => chats[id] || null,
  now: (id) => rows[id] || null,
  failed: (id) => failed.includes(id),
  modelName: (id) => `named ${id}`,
});

describe("the lanes' arithmetic", () => {
  // (fails before: yes — the Space is new)
  test("a chat in a lane: what it waits on, what it does, why it stopped, or how long it has been idle; its model in plain words", () => {
    const at = Date.now();
    const look = lookOf(
      {
        c1: { title: "Wire the lanes", when: at - 3 * HOUR, line: "Drew the lanes from the places read" },
        c2: { title: "", when: at - HOUR, line: "" },
        c5: { title: "Ahead of this clock", when: at + 60_000, line: "" },
      },
      {
        c1: { group: "needs", fact: "asks: use the new schema?", model: "claude-opus-5-5" },
        c2: { group: "works", fact: "read …/side.js", model: "" },
        c3: { group: "needs", tone: "error", fact: "Stopped: the provider refused", model: "claude-opus-5-5" },
      },
      ["c4"],
    );
    assert.deepEqual(laneChat({ id: "c1", name: "listed" }, look), {
      id: "c1", name: "Wire the lanes", state: "asks: use the new schema?", tone: "needs", model: "named claude-opus-5-5",
      team: "", line: "Drew the lanes from the places read", when: at - 3 * HOUR, routine: false,
    });
    assert.equal(laneChat({ id: "c1", name: "listed", routine: "Morning brief" }, look).routine, true, "a routine's run, as /git/places marks it");
    const said = (/** @type {string} */ id, /** @type {string} */ name = "") => {
      const c = laneChat({ id, name }, look);
      return [c.name, c.state, c.tone];
    };
    assert.deepEqual(said("c2", "as git names it"), ["as git names it", "working · read …/side.js", "works"], "the place's name for an untitled one");
    assert.deepEqual(said("c3"), ["an untitled chat", "Stopped: the provider refused", "error"], "a failed turn waits for you in Now: its lane stopped");
    assert.deepEqual(said("c4"), ["an untitled chat", "its last run stopped", "error"]);
    assert.deepEqual(said("c5"), ["Ahead of this clock", "idle · now", ""], "a moment ahead of this clock is now");
    assert.deepEqual(said("c6"), ["an untitled chat", "idle", ""], "nothing known: idle, no age");
    const idle = laneChat({ id: "c1" }, lookOf({ c1: { title: "t", when: at - 3 * HOUR, line: "" } }));
    assert.deepEqual([idle.state, idle.tone, idle.model], ["idle · 3h", "", ""]);
    // Waiting with no words of its own still says so; working with none says working.
    assert.equal(laneChat({ id: "c7" }, lookOf({}, { c7: { group: "needs", fact: "" } })).state, "waits for you");
    assert.equal(laneChat({ id: "c8" }, lookOf({}, { c8: { group: "works", fact: "" } })).state, "working");
    // A team's lead: who runs it is its team and how many workers, what it does its own step, not its row's fact.
    const lead = laneChat({ id: "c9" }, lookOf({}, { c9: { group: "works", team: "Methodical", under: [{}, {}, {}], fact: "Methodical team · 3 workers", step: "round 4 · read plan.md", model: "glm-5.3-flash" } }));
    assert.deepEqual([lead.model, lead.team, lead.state], ["Methodical team · 3 workers", "Methodical", "working · round 4 · read plan.md"]);
    assert.equal(laneChat({ id: "c9" }, lookOf({}, { c9: { group: "works", team: "Security team", under: [{}], step: "" } })).model, "Security team · 1 worker");
  });

  // (fails before: yes — the Space is new)
  test("what a place holds against its base, in a lane's words", () => {
    assert.equal(laneFacts(MAIN), "2 files changed, not committed");
    assert.equal(laneFacts({ ...WT, uncommitted: { files: 1 } }), "1 file changed, not committed · 2 commits not on main");
    assert.equal(laneFacts({ ...WT, ahead: 1 }), "1 commit not on main");
    assert.equal(laneFacts(DONE), "merged into main", "a clean worktree with nothing of its own");
    assert.equal(laneFacts({ ...DONE, fresh: true }), "nothing of its own yet", "a lane made a moment ago: not merged (seen live on S7)");
    assert.equal(laneFacts({ ...MAIN, uncommitted: { files: 0 } }), "nothing uncommitted");
    assert.equal(laneFacts(GONE), "its folder is gone; git keeps its record");
    assert.equal(laneFacts(OUT), OUT.error);
    assert.equal(laneFacts({ ok: false }), "git could not read it");
  });

  // (fails before: yes — the Space is new)
  test("the lanes: a place a chat works in, the main folder always; main first, then what needs you, works, stopped, the newest", () => {
    const at = Date.now();
    const UI = { ...WT, path: "/r-ui", name: "r-ui", branch: "ui", chats: [{ id: "c24", name: "older" }, { id: "c23", name: "asks" }] };
    const OLD = { ...DONE, path: "/r-old", name: "r-old", branch: "old", chats: [{ id: "c25", name: "old" }] };
    const EMPTY = { ...DONE, path: "/r-empty", name: "r-empty", branch: "empty", chats: [] };
    const look = lookOf(
      { c20: { title: "on main", when: at - 5 * HOUR, line: "" }, c22: { title: "fix it", when: at - HOUR, line: "" },
        c24: { title: "older", when: at - 9 * HOUR, line: "" }, c25: { title: "old", when: at - 30 * HOUR, line: "" } },
      { c21: { group: "works", fact: "edit space.js" }, c23: { group: "needs", fact: "asks: which branch?" } },
    );
    const lanes = lanesOf(placesOf([OLD, WT, MAIN, EMPTY, DONE, UI]), look);
    assert.deepEqual(
      lanes.map((l) => [l.path, l.main, l.branch, l.tone, l.lead?.id, l.others.map((o) => o.id)]),
      [
        ["/r", true, "main", "", "c20", []],
        ["/r-ui", false, "ui", "needs", "c23", ["c24"]],
        ["/r-wt", false, "agent", "works", "c21", []],
        ["/r-done", false, "done", "", "c22", []],
        ["/r-old", false, "old", "", "c25", []],
      ],
      "a worktree no chat works in is the places' panel's alone",
    );
    // A routine's run that ended — done or failed — comes after the person's own chats, newer though it is; one at work
    // or asking leads as any chat does; one alone in its lane leads it.
    // (fails before: yes — seen at S6's live look: "Morning brief · Sun 25 Oct" led the main lane, the chat at work behind it)
    const runs = lookOf(
      { c20: { title: "on main", when: at - 5 * HOUR, line: "" }, r1: { title: "Morning brief · Sun 25 Oct", when: at - 60_000, line: "" },
        r2: { title: "Nightly upkeep · Sun 25 Oct", when: at - 30_000, line: "" }, r3: { title: "Morning brief · Mon 26 Oct", when: at, line: "" } },
      { r2: { group: "needs", tone: "error", fact: "Stopped: sign-in expired" } },
    );
    const main = (/** @type {any[]} */ chats) => lanesOf(placesOf([{ ...MAIN, chats }]), runs)[0];
    const ran = [{ id: "c20", name: "on main" }, { id: "r1", name: "", routine: "Morning brief" }, { id: "r2", name: "", routine: "Nightly upkeep" }];
    assert.deepEqual([main(ran).lead?.id, main(ran).tone, main(ran).others.map((o) => o.id)], ["c20", "", ["r2", "r1"]]);
    const working = lookOf({ c20: { title: "on main", when: at - 5 * HOUR, line: "" } }, { r3: { group: "works", fact: "read README.md" } });
    assert.equal(lanesOf(placesOf([{ ...MAIN, chats: [{ id: "c20" }, { id: "r3", routine: "Morning brief" }] }]), working)[0].lead?.id, "r3", "a run at work leads");
    assert.equal(main([{ id: "r1", name: "", routine: "Morning brief" }]).lead?.id, "r1", "alone, it leads");
    // The main folder stands with no chat in it; a refused read has no lanes.
    assert.deepEqual(lanesOf(placesOf([{ ...MAIN, chats: [] }, EMPTY]), look).map((l) => [l.path, l.lead]), [["/r", null]]);
    assert.deepEqual(lanesOf({ ok: false, error: "not in a git repository", places: [], removed: [] }, look), []);
    // A folder in no repository (a Space of your own's, A3): its chats are one lane, the folder's, for Needs you here
    // (found by the Hunter on A6: they were dropped).
    const plain = lanesOf({ cwd: "/notes", ok: false, error: "not in a git repository", places: [], removed: [], chats: [{ id: "c1", name: "Inbox" }] }, look);
    assert.deepEqual(plain.map((l) => [l.path, l.name, l.main, l.lead?.id, l.others.length]), [["/notes", "notes", true, "c1", 0]]);
    assert.deepEqual(lanesOf(null, look), []);
  });

  // (fails before: yes — the Space is new; the Changes pane's head said "Places in r" over its rows)
  test("how many places a repository has, in a line", () => {
    assert.equal(placesWords(placesOf([MAIN, WT, DONE], [REMOVED])), "the main folder and 2 worktrees · 1 removed");
    assert.equal(placesWords(placesOf([MAIN, WT])), "the main folder and 1 worktree");
    assert.equal(placesWords(placesOf([MAIN])), "the main folder alone");
    assert.equal(placesWords(placesOf([MAIN], [REMOVED])), "the main folder alone · 1 removed");
  });
});

describe("the Space in a page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    // Remove's sheet asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
    // The events stream, one for the page: a test hands the Space a message through it.
    EventSource: class {
      constructor() {
        streams.push(this);
      }
      close() {}
    },
    addEventListener: () => {},
  };
  /** @type {any[]} */
  const streams = [];
  /** A message on the events stream, as the server sends one. @param {any} msg */
  const hear = (msg) => {
    for (const s of streams) s.onmessage?.({ data: JSON.stringify(msg) });
  };
  /** Every Space drawn, stopped at the end so no tick outlives its test. @type {(() => void)[]} */
  const stops = [];
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    // A toast's own timer: kept on the page here, so no test waits for one to go.
    g.window.setTimeout = () => 0;
  });
  after(() => {
    for (const stop of stops) stop();
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    asked.length = 0;
    posted.length = 0;
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
  /** A menu opened from a button: its rows. @param {any} b @param {string} what */
  const menuOf = async (b, what) => {
    b.dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), what);
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };

  /**
   * The Space drawn as the page draws it, for project p1 in /r, with what the page hands it.
   * @param {import("../src/ui/harness/space/space.js").LaneLook} look
   * @param {{ known?: () => boolean, tab?: string, cb?: Partial<import("../src/ui/harness/space/space.js").SpaceCallbacks> }} [o]  `known`:
   *   whether the list names the project yet; `tab`, the page its address names; `cb`, what else the page hands it
   */
  const mountSpace = (look, o = {}) => {
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const did = { opened: /** @type {string[]} */ ([]), started: /** @type {any[]} */ ([]), settings: /** @type {any[]} */ ([]), moved: 0, closed: 0, words: /** @type {any[]} */ ([]),
      frames: /** @type {any[]} */ ([]), artifacts: /** @type {string[]} */ ([]), acts: /** @type {any[]} */ ([]), repro: /** @type {any[]} */ ([]), more: /** @type {any[]} */ ([]) };
    /** @type {import("../src/ui/harness/space/space.js").SpaceCallbacks} */
    const cb = {
      project: (id) => (id === "p1" && (o.known?.() ?? true) ? { id: "p1", name: "r", cwd: "/r" } : null),
      look,
      openChat: (id) => void did.opened.push(id),
      newChat: (cwd, lane) => void did.started.push([cwd, lane]),
      startWith: (cwd, words, lane) => void did.words.push(lane ? [cwd, words, "a lane"] : [cwd, words]),
      reproduce: (cwd, report) => void did.repro.push([cwd, report]),
      openArtifact: (name) => void did.artifacts.push(name),
      dashboardFrame: (name, title, cwd, onAct, _from, more) => {
        did.frames.push([name, title, cwd]);
        did.acts.push(onAct);
        did.more.push(more);
        return { el: h("div", { class: "fake-frame", "data-artifact": name }), setTitle: () => {}, again: () => void did.frames.push(["again", name]), version: (v) => void did.frames.push(["version", name, v]),
          repaint: () => void did.frames.push(["repaint", name]) };
      },
      projectSettings: (id, section) => void did.settings.push([id, section]),
      onMoved: () => void did.moved++,
      onClose: () => void did.closed++,
      ...o.cb,
    };
    const space = renderSpace(/** @type {any} */ (host), { id: "p1", ...(o.tab ? { tab: o.tab } : {}) }, cb);
    stops.push(space.stop);
    return { host, space, did };
  };
  /** The lanes once drawn. @param {any} host */
  const lanesDrawn = (host) => until(() => host.querySelector(".sp-lane-face"), "the lanes to be drawn");
  /** The places' sheet, opened as the page has it since the reshape of 10-29: ⋯ › Folders and worktrees…. @param {any} host */
  const placesSheetOf = async (host) => {
    const more = await menuOf(host.querySelector(".sp-settings"), "⋯");
    more.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Folders and worktrees…").dispatch("click");
    return until(() => doc.document.body.querySelector(".sp-places-sheet"), "the places' sheet");
  };
  /** Each lane as it reads. @param {any} host */
  const laneRows = (host) =>
    host.querySelectorAll("article.sp-lane").map((/** @type {any} */ a) => [
      a.getAttribute("data-place"),
      a.getAttribute("class"),
      a.querySelector(".sp-branch").textContent,
      a.querySelector(".sp-lane-name").textContent,
      a.querySelector(".sp-lane-who")?.textContent || "",
      a.querySelector(".sp-lane-state")?.textContent || "",
      a.querySelector(".sp-lane-facts").textContent,
      a.querySelector(".sp-lane-line")?.textContent || "",
      (a.querySelector(".sp-lane-more")?.children || []).map((/** @type {any} */ k) => k.textContent).join(" "),
    ]);

  // (fails before: yes — the Space is new)
  test("the head, a lane per place with its lead chat and what it does, the others there, New lane…, then the places", async () => {
    const at = Date.now();
    const UI = { ...WT, path: "/r-ui", name: "r-ui", branch: "ui", ahead: 1, uncommitted: { files: 3 },
      chats: ["c23", "c24", "c25", "c26", "c27"].map((id) => ({ id, name: id })) };
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT, DONE, UI], [REMOVED]) : undefined);
    const look = lookOf(
      { c20: { title: "on main", when: at - 3 * HOUR, line: "Tidied the docs" },
        c21: { title: "the agent", when: at - HOUR, line: "Wiring the lanes" },
        c22: { title: "fix it", when: at - 2 * HOUR, line: "" },
        c24: { title: "two", when: at - 4 * HOUR, line: "" }, c25: { title: "three", when: at - 5 * HOUR, line: "" },
        c26: { title: "four", when: at - 6 * HOUR, line: "" }, c27: { title: "five", when: at - 7 * HOUR, line: "" } },
      { c21: { group: "works", fact: "read …/side.js", model: "claude-opus-5-5" }, c23: { group: "needs", fact: "asks: which branch?" } },
    );
    const { host, did } = mountSpace(look);
    assert.deepEqual(texts(host, ".sp-reading"), ["Reading where its chats work…"], "drawn at once, reading");
    await lanesDrawn(host);
    assert.equal(times("/api/git/places?cwd=%2Fr"), 1);
    assert.deepEqual([host.querySelector(".sp-crumb-name").textContent, host.querySelector(".sp-crumb-page").textContent], ["r", "Space"]);
    assert.deepEqual([host.querySelector(".sp-title").textContent, host.querySelector(".sp-line").textContent], ["r", "/r · 4 lanes"], "its Space not read: its folder and lanes");
    assert.deepEqual(texts(host, ".sp-overview .sp-sec-name"), ["Needs you here", "Lanes", "Runs by itself", "Tasks", "What happened"], "the page's order: what needs you, who works here beside what runs by itself, the plan, the record");
    // (fails before: yes — the owner's idea of 10-29: a Space's apps were tabs on its page) No tabs: its pages are the
    // left bar's rows, and the crumb's ⌄ is there once one is.
    assert.deepEqual([host.querySelector(".srt").hasAttribute("hidden"), host.querySelector(".sdb-strip"), host.querySelector(".sp-crumb-go").hidden !== false], [true, null, true], "no Routines, no tabs, until one is (S6, SG-D0)");
    assert.equal(host.querySelector(".sp-sync"), null, "no Sync… in the head");
    // Needs you here: Now's own row for each of this project's chats that needs you.
    assert.deepEqual(host.querySelectorAll(".sp-need").map((/** @type {any} */ r) => [r.getAttribute("data-chain"), r.querySelector(".sp-need-t").textContent, r.querySelector(".sp-need-f").textContent]),
      [["c23", "asks: which branch?", "ui · c23"]]);
    assert.equal(host.querySelector(".sp-needs-none").hidden, true, "rows: no quiet line");
    host.querySelector(".sp-need").dispatch("click");
    assert.deepEqual(did.opened, ["c23"], "a press opens it");
    did.opened.length = 0;
    assert.deepEqual(laneRows(host), [
      ["/r", "sp-lane", "main", "on main", "", "idle · 3h", "2 files changed, not committed", "Tidied the docs", ""],
      ["/r-ui", "sp-lane is-needs", "ui", "c23", "", "asks: which branch?", "3 files changed, not committed · 1 commit not on main", "",
        "Also here (4): two three four and 1 more"],
      ["/r-wt", "sp-lane is-works", "agent", "the agent", "named claude-opus-5-5", "working · read …/side.js", "2 commits not on main", "Wiring the lanes", ""],
      ["/r-done", "sp-lane", "done", "fix it", "", "idle · 2h", "merged into main", "", ""],
    ]);
    assert.ok(host.querySelector('[data-place="/r-wt"] .sp-lane-state .sp-spin'), "a lane at work spins");
    // (fails before: yes — New lane… was a dashed tile after the cards, under a tip, "a lane opens its chat", and over a
    // sentence on what a second lane is for) New lane… is a quiet button of the section's head, that sentence its tip.
    const newLane = host.querySelector(".sp-lanes-sec .sp-sec-h .sp-new-lane");
    assert.deepEqual([newLane.tagName, newLane.getAttribute("class"), newLane.textContent, newLane.getAttribute("title")],
      ["BUTTON", "ghost sm sp-new-lane", "New lane…", "The Start here, on a new worktree — a branch and a folder of its own, made when you send —: a second lane, to work on two things at once"]);
    assert.deepEqual([host.querySelector(".sp-lanes .sp-new-lane"), host.querySelector(".sp-lanes").lastElementChild.getAttribute("data-place"), host.querySelector(".sp-one"), host.querySelector(".sp-lanes-tip")], [null, "/r-done", null, null],
      "no tile after the cards, no tip over them, no sentence under them");
    // A lane's face opens its lead; "Also here" its others; nothing else moves.
    host.querySelector('[data-place="/r-wt"] .sp-lane-face').dispatch("click");
    host.querySelectorAll('[data-place="/r-ui"] .sp-lane-other')[1].dispatch("click");
    assert.deepEqual(did.opened, ["c21", "c25"]);
    // New lane… and New chat here… fill the Start in the project's folder, the first on a new worktree: nothing sent.
    host.querySelector(".sp-new-lane").dispatch("click");
    host.querySelector(".sp-new-chat").dispatch("click");
    assert.deepEqual(did.started, [["/r", true], ["/r", false]]);
    assert.deepEqual(posted, [], "no press here sends or writes");
    // (fails before: yes — the reshape of 10-29: the lanes were cards on the page, its places folded at its foot, and
    // the top bar held Places and Project settings)
    // (fails before: yes — the lanes opened folded to one line, their cards a press away)
    // The lanes, open: how many, and which need you and work, beside their head; Hide folds them to that line, Show opens them.
    const go = host.querySelector(".sp-lanes-go");
    assert.deepEqual([host.querySelector(".sp-lanes-body").hidden, host.querySelector(".sp-lanes-sec .sp-sec-count").textContent, host.querySelector(".sp-lanes-words").textContent, go.getAttribute("aria-expanded"), go.textContent],
      [false, "4", "1 needs you · 1 at work", "true", "Hide"]);
    go.dispatch("click");
    assert.deepEqual([host.querySelector(".sp-lanes-body").hidden, host.querySelector(".sp-lanes-words").textContent, go.getAttribute("aria-expanded"), go.textContent], [true, "1 needs you · 1 at work", "false", "Show"]);
    go.dispatch("click");
    assert.deepEqual([host.querySelector(".sp-lanes-body").hidden, go.textContent], [false, "Hide"]);
    // The places, in a sheet from ⋯ › Folders and worktrees…: every folder of the repository, the removed one with Put back.
    assert.equal(host.querySelector(".sp-places"), null, "no places on the page");
    assert.deepEqual(host.querySelectorAll(".sp-top-acts button").map((/** @type {any} */ b) => b.getAttribute("class")), ["ghost icon sp-settings", "ghost sm"], "⋯ and Back to chat alone");
    const more = await menuOf(host.querySelector(".sp-settings"), "⋯");
    more.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Folders and worktrees…").dispatch("click");
    const placesSheet = await until(() => doc.document.body.querySelector(".sp-places-sheet"), "the places' sheet");
    assert.equal(placesSheet.querySelector(".sp-places-words").textContent, "the main folder and 3 worktrees · 1 removed · Remove where nothing is lost, Put back what was removed");
    assert.deepEqual(texts(placesSheet, ".sp-places .pl-name"), ["r", "r-wt", "r-done", "r-ui", "r-done"]);
    assert.deepEqual(texts(placesSheet, ".sp-places .pl-row.is-removed .zc-btn"), ["Put back"]);
    // (fails before: yes — the sheet's list was labelled "Places" and its ⟳ "Read the places again", the code's word
    // for a folder or worktree, under a head that says Folders and worktrees)
    const again = placesSheet.querySelector(".sp-again");
    assert.deepEqual([placesSheet.querySelector(".sp-places").getAttribute("aria-label"), again.getAttribute("aria-label"), again.getAttribute("title")],
      ["Folders and worktrees", "Read them again", "Read them again"]);
    placesSheet.querySelector(".sp-again").dispatch("click");
    await until(() => times("/api/git/places?cwd=%2Fr") === 2, "⟳ reads the places again");
    placesSheet.querySelector(".zc-sheet-x").dispatch("click");
    await until(() => !doc.document.body.querySelector(".sp-places-sheet"), "the sheet to close");
    host.querySelectorAll(".sp-top-acts button").at(-1).dispatch("click");
    assert.equal(did.closed, 1, "Back to workspace");
  });

  // (fails before: yes — the footprint plan: nothing read Filament's own footprint)
  test("Filament's footprint is read after the places as the Space opens and on ⟳, never on the feed's word that the places moved", async () => {
    const FOOT = "/api/git/footprint?cwd=%2Fr";
    serve = (u) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT])
      : u === FOOT ? { cwd: "/r", ok: true, error: null, repo: "/r", copies: { count: 2, bytes: 3 * 1024 * 1024, partial: false, goes: 1, goesBytes: 1024, items: [] }, left: { count: 0, bytes: 0, partial: false, items: [] }, refs: { count: 40, goes: 0, kinds: [] }, branches: { count: 0, goes: 0, items: [] }, goes: 1 }
      : undefined;
    const { host } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => times(FOOT) === 1, "the footprint read after the places");
    assert.ok(asked.indexOf(FOOT) > asked.indexOf("/api/git/places?cwd=%2Fr"), "after the places");
    hear({ type: "git-moved", what: "places", folders: ["/r"] });
    await until(() => times("/api/git/places?cwd=%2Fr") === 2, "the places read again on the feed's word");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(times(FOOT), 1, "the footprint is not");
    const placesSheet = await placesSheetOf(host);
    assert.equal(placesSheet.querySelector(".pl-foot-words").textContent, "Filament's footprint: 2 copies · 3.0 MB · 40 refs");
    placesSheet.querySelector(".sp-again").dispatch("click");
    await until(() => times(FOOT) === 2, "⟳ reads it again");
    placesSheet.querySelector(".zc-sheet-x").dispatch("click");
    await until(() => !doc.document.body.querySelector(".sp-places-sheet"), "the sheet to close");
  });

  // (fails before: yes — found on 11-12: a project whose folder is in no git repository offered New lane… as any
  // other's; its press opened the Start on "A new worktree", which the Start's Works in row does not show there, and
  // the first send was refused 409 "not in a git repository", no chat made)
  test("a project whose folder git reads no repository in: New lane… is greyed and says why, its press starts nothing; read as a repository, it is offered again", async () => {
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? { cwd: "/r", ok: false, error: "not in a git repository", places: [], removed: [], chats: [{ id: "c20", name: "notes", home: true, atWork: false }] } : undefined);
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({ c20: { title: "notes", when: Date.now(), line: "" } }));
    await lanesDrawn(host);
    assert.equal(host.querySelector(".sp-line").textContent, "/r", "no lanes counted where git reads none");
    const newLane = host.querySelector(".sp-lanes-sec .sp-sec-h .sp-new-lane");
    assert.deepEqual([newLane.hasAttribute("disabled"), newLane.getAttribute("title")],
      [true, "A new lane is a new worktree, made by git — and git could not read this folder: not in a git repository. New chat here… starts one in the folder itself."]);
    newLane.dispatch("click");
    host.querySelector(".sp-new-chat").dispatch("click");
    assert.deepEqual(did.started, [["/r", false]], "no Start on a worktree that cannot be made; New chat here… as ever");
    // git init since: the places read again, New lane… as in any repository.
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN]) : undefined);
    hear({ type: "git-moved", what: "places", folders: ["/r"] });
    await until(() => !newLane.hasAttribute("disabled"), "New lane… offered once git reads a repository there");
    assert.equal(newLane.getAttribute("title"), "The Start here, on a new worktree — a branch and a folder of its own, made when you send —: a second lane, to work on two things at once");
    newLane.dispatch("click");
    assert.deepEqual(did.started.at(-1), ["/r", true]);
  });

  // (fails before: yes — the lanes opened folded, and a page opened again kept them open only where you had opened them)
  test("the lanes' one line says which need you, work and stopped; folded, they are folded again with the page", async () => {
    const lane = (/** @type {string} */ tone) => /** @type {any} */ ({ tone });
    assert.deepEqual([lanesWords([]), lanesWords([lane("")]), lanesWords([lane("needs"), lane("needs"), lane("works"), lane("error"), lane("")]), lanesWords([lane("works"), lane("")])],
      ["", "all quiet", "2 need you · 1 at work · 1 stopped", "1 at work"]);
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT]) : undefined);
    const first = mountSpace(lookOf({}));
    await lanesDrawn(first.host);
    assert.deepEqual([first.host.querySelector(".sp-lanes-body").hidden, first.host.querySelector(".sp-lanes-sec").classList.contains("is-open")], [false, true], "open at first");
    first.host.querySelector(".sp-lanes-go").dispatch("click");
    first.space.stop();
    first.host.remove();
    const again = mountSpace(lookOf({}));
    await lanesDrawn(again.host);
    assert.deepEqual([again.host.querySelector(".sp-lanes-body").hidden, again.host.querySelector(".sp-lanes-go").textContent, again.host.querySelector(".sp-lanes-words").textContent], [true, "Show", "all quiet"], "folded again, as you left them, their one line beside the head");
    again.host.querySelector(".sp-lanes-go").dispatch("click");
    assert.equal(again.host.querySelector(".sp-lanes-body").hidden, false);
  });

  // (fails before: yes — the Space is new; a sentence under the one card said what a second lane is for)
  test("one lane: New lane…'s tip says what a second is for; the main folder with no chat says so and opens nothing", async () => {
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([{ ...MAIN, chats: [] }]) : undefined);
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    assert.deepEqual(laneRows(host), [["/r", "sp-lane", "main", "r", "", "", "2 files changed, not committed", "No chat works here yet", ""]]);
    const face = host.querySelector(".sp-lane-face");
    assert.equal(face.hasAttribute("disabled"), true);
    face.dispatch("click");
    assert.deepEqual(did.opened, []);
    assert.equal(host.querySelector(".sp-one"), null, "no sentence under the card");
    assert.match(host.querySelector(".sp-lanes-sec .sp-sec-h .sp-new-lane").getAttribute("title"), /a second lane, to work on two things at once$/);
    host.querySelector(".sp-new-lane").dispatch("click");
    assert.deepEqual(did.started, [["/r", true]], "the Start on a new worktree; nothing sent");
  });

  // (fails before: yes — a project's head led with New app…, made once, over New chat here…, pressed many times a day;
  // its line said who works in it before its folder, and wrapped; what its agents run on stood in italics)
  test("a project's head: New chat here… its filled button, Add to this Space… beside it, no New app… of its own; its line one line, its folder and lanes; what its agents run on a quiet chip under it", async () => {
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [],
      runsOn: { model: "brain-a", effort: "high", from: "default", asks: "ask", asksFrom: "" } };
    serve = (u, method) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT]) : u === "/api/space/p1" && method === "GET" ? SPACE : undefined);
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-runs-on")?.hidden === false, "its Space read");
    const head = host.querySelector(".sp-head");
    assert.deepEqual(head.querySelectorAll("button").filter((/** @type {any} */ b) => !b.hidden).map((/** @type {any} */ b) => [b.textContent, b.getAttribute("class")]), [
      ["Its agents run on named brain-a · High, from Settings › Space", "sp-runs-on"],
      ["Add to this Space…", "ghost sm sp-add"],
      ["New chat here…", "sm primary sp-new-chat"],
    ]);
    assert.equal(head.querySelector(".sp-new-app").hidden, true, "New app… is Add to this Space…'s first row");
    assert.deepEqual(head.querySelector(".sp-head-words").children.map((/** @type {any} */ c) => c.getAttribute("class")), ["sp-title", "sp-line", "sp-runs-on"]);
    const line = head.querySelector(".sp-line");
    assert.deepEqual([line.textContent, line.getAttribute("title"), head.querySelector(".sp-title").getAttribute("title")], ["/r · 2 lanes", "/r · 2 lanes", "Every chat in r works in this Space"]);
    head.querySelector(".sp-new-chat").dispatch("click");
    assert.deepEqual([did.started, posted], [[["/r", false]], []], "the Start in its folder; nothing sent");
    const adds = await menuOf(head.querySelector(".sp-add"), "Add to this Space…");
    assert.equal(adds[0].querySelector(".zc-menu-label-line").textContent, "New app…");
    doc.document.body.querySelector(".zc-menu")?.remove();
    const css = src("space/space.css");
    assert.match(css, /\n\.sp-line \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*\}/, "one line, cut");
    assert.doesNotMatch(css, /\.sp-runs-on[^{]*\{[^}]*font-style: italic/, "what its agents run on, in no italics");
    assert.match(css, /\.sp-new-app\[hidden\][^{]*\{ display: none; \}/, "a button is a flex box, which beats hidden");
  });

  // (fails before: yes — nothing on the overview said what runs by itself: its routines, watchers and apps were rows of
  // the left bar alone, and the lanes a folded line over the board)
  test("Lanes beside Runs by itself: a pair after Needs you here — the lanes at its left, what runs by itself at its right, the second under the first on a narrow page —; a row opens its page, Switch on… its sheet, Keep… the app's", async () => {
    const at = Date.now();
    /** @param {Record<string, any>} [o] */
    const words = (o = {}) => ({ when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "",
      skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "Mon 27 Oct 09:00", ...moreWords(), ...o });
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "on", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", last: null, words: words() };
    const turns = { trigger: { kind: "turn", chat: "c20", turns: "all", every: 1 }, wakes: /** @type {const} */ ("new") };
    const W1 = { ...R, id: "w1", title: "Supervisor", when: "", ...turns, state: "proposed",
      words: words({ ...moreWords(turns), when: "after each turn of on main", next: "", nextAt: null, first: "", watches: ["each turn of ", { chain: "c20", name: "on main" }] }) };
    const none = { sources: {}, watch: [], actions: {} };
    const NOTES = { name: "notes-ef56", title: "Notes", type: "app", v: 1, state: "draft", keptV: null, liveV: null, draft: true, paused: false, keptAt: null, grant: null, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [NOTES], gone: [], needs: [],
      runs: { head: "Runs by itself: 1 routine · next: Morning brief at 09:00", listening: "", pausedSince: null, routines: [R, W1], watches: [] } };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return SPACE;
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at - HOUR, line: "" }, c21: { title: "the agent", when: at - HOUR, line: "" } }));
    await lanesDrawn(host);
    const part = /** @type {any} */ (await until(() => (host.querySelector(".sp-by-itself .sbi-row") ? host.querySelector(".sp-by-itself") : null), "what runs by itself"));
    /** @param {any} el */
    const kinds = (el) => el.children.map((/** @type {any} */ c) => c.getAttribute("class").split(" ").slice(0, 2).join(" "));
    assert.deepEqual(kinds(host.querySelector(".sp-overview")), ["sp-first-slot", "sp-none", "sp-sec sp-needs-sec", "sp-sec sp-shows-sec", "sp-pair", "sp-work"], "after Needs you here and From its projects, over the board");
    const pair = host.querySelector(".sp-pair");
    assert.deepEqual([kinds(pair), kinds(pair.firstElementChild)], [["sp-pair-main", "sp-sec sp-by-itself"], ["sp-sec sp-who-sec", "sp-sec sp-lanes-sec", "sp-overlap"]]);
    assert.deepEqual([host.querySelector(".sp-lanes-body").hidden, part.hidden, part.querySelector(".sp-sec-count").textContent], [false, false, "3"], "the lanes open, what runs by itself beside them");
    assert.deepEqual(part.querySelectorAll(".sbi-row").map((/** @type {any} */ r) => [r.getAttribute("data-key"), r.querySelector(".sbi-title").textContent, r.querySelector(".sbi-line").textContent, r.querySelector(".sbi-word").textContent, r.querySelector(".sbi-go")?.textContent || ""]), [
      ["watcher:p1|w1", "Supervisor", "each turn of on main", "Proposed", "Switch on…"],
      ["app:notes-ef56", "Notes", "Would read by itself, once you keep it", "Draft", "Keep…"],
      ["routine:p1|r1", "Morning brief", "weekdays at 09:00", "On", ""],
    ]);
    // A row opens its page — Routines, Watchers, the app's own —, the crumb's Space the way back.
    /** @param {string} key */
    const row = (key) => part.querySelector(`.sbi-row[data-key='${key}']`);
    const shown = () => [host.querySelector(".sp-overview").hidden, host.querySelector(".srt").hidden, host.querySelector(".swt").hidden, host.querySelector(".sdb-view").hidden, host.querySelector(".sp-crumb-app").textContent];
    row("routine:p1|r1").querySelector(".sbi-face").dispatch("click");
    assert.deepEqual(shown(), [true, false, true, true, "Routines"]);
    host.querySelector(".sp-crumb-page").dispatch("click");
    row("watcher:p1|w1").querySelector(".sbi-face").dispatch("click");
    assert.deepEqual(shown(), [true, true, false, true, "Watchers"]);
    host.querySelector(".sp-crumb-page").dispatch("click");
    row("app:notes-ef56").querySelector(".sbi-face").dispatch("click");
    assert.deepEqual(shown(), [true, true, true, false, "Notes"]);
    host.querySelector(".sp-crumb-page").dispatch("click");
    assert.deepEqual(shown().slice(0, 4), [false, true, true, true], "back to the Board");
    // Switch on…: the sheet the Watchers page opens; Keep…: the sheet the app's page opens. Neither press switches or keeps.
    row("watcher:p1|w1").querySelector(".sbi-go").dispatch("click");
    const on = /** @type {any} */ (await until(() => doc.document.body.querySelector(".srt-sheet"), "its Switch on… sheet"));
    assert.equal(on.querySelector(".sp-sheet-title").textContent, "Switch on “Supervisor”?");
    on.querySelector(".zc-sheet-x").dispatch("click");
    await until(() => !doc.document.body.querySelector(".srt-sheet"), "closed");
    row("app:notes-ef56").querySelector(".sbi-go").dispatch("click");
    const keep = /** @type {any} */ (await until(() => doc.document.body.querySelector(".sdb-keep-sheet"), "its Keep sheet"));
    assert.equal(keep.querySelector(".sp-sheet-title").textContent, "Keep “Notes” in r's Space?");
    keep.querySelector(".zc-sheet-x").dispatch("click");
    assert.deepEqual([posted, host.querySelector(".sp-overview").hidden], [[], false], "nothing switched on or kept, and the page stands");
    // Side by side, the second under the first where the pair is narrower than 860px; none of it while a deleted Space
    // waits (a project with none draws it, with its two buttons: by need, 11-12).
    const css = src("space/space.css");
    assert.match(css, /\n\.sp-pair \{[^}]*container: sp-pair \/ inline-size;[^}]*\}/);
    assert.match(css, /\n\.sp-by-itself \{[^}]*flex: 0 1 clamp\(340px, 40%, 440px\);[^}]*\}/, "two fifths of the pair at the right, 340px to 440px: a watcher's line whole where there is room");
    assert.match(css, /\n@container sp-pair \(max-width: 860px\) \{ \.sp-pair-main, \.sp-by-itself \{ flex: 1 1 100%; \} \}\n/);
    assert.match(css, /\.sp-is-deleted \.sp-by-itself[^{]*\{ display: none !important; \}/);
    assert.doesNotMatch(css, /\.sp-is-none \.sp-by-itself/);
  });

  // (fails before: yes — the Space is new; the project's settings were reached in Settings, its Applies to picked by hand;
  // and the reshape of 10-29: Connector…, Plugin… and Skill… were Add to this Space…'s, Places the top bar's)
  test("⋯: the project's pages, each opening with this project chosen; its connectors, plugins and skills; its folders", async () => {
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN]) : undefined);
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    assert.equal(host.querySelector(".sp-settings").getAttribute("aria-label"), "Project settings, connectors, plugins, skills and folders");
    const items = await menuOf(host.querySelector(".sp-settings"), "the door's menu");
    assert.equal(doc.document.body.querySelector(".zc-menu .zc-menu-label").textContent, "Project settings");
    assert.deepEqual(
      items.map((/** @type {any} */ i) => [i.querySelector(".zc-menu-label-line").textContent, i.querySelector(".zc-menu-desc").textContent]),
      [...PROJECT_PAGES.map((p) => [p.label, p.line]),
        ["Connectors…", "The accounts and services this project's chats and apps can use, and the account each signs in with"],
        ["Plugins…", "Claude Code's or Codex's: their connectors, skills and commands in this project's chats"],
        ["Skills…", "How-tos every agent in this project's chats can use: turn yours on for it, or tag one in a message"],
        ["Folders and worktrees…", "The project's main folder and each worktree: Remove where nothing is lost, Put back what was removed"]],
    );
    assert.deepEqual(PROJECT_PAGES.map((p) => p.section), ["permissions", "instructions", "memory"]);
    items[1].dispatch("click");
    assert.deepEqual(did.settings, [["p1", "instructions"]]);
  });

  // (fails before: yes — the Space is new)
  test("a project the list does not name yet: said so, nothing read; once named, drawn and read; drawn again, one Space", async () => {
    let known = false;
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT]) : undefined);
    const { host, space } = mountSpace(lookOf({}), { known: () => known });
    assert.deepEqual([host.querySelector(".sp-title").textContent, host.querySelector(".sp-lanes-sec").hidden], ["This project is not known", true]);
    // (fails before: yes — seen in the page, 11-12: the page of a project just archived drew Add to this Space… and
    // New chat here…, which did nothing, and its line named no way back)
    assert.equal(host.querySelector(".sp-line").textContent, "It may have been archived or deleted, or the list of projects has not been read yet. An archived project is brought back in Settings › Archived chats.");
    assert.ok(host.querySelector(".space").classList.contains("sp-is-unknown"), "its head's acts are hidden: none of them does anything");
    assert.match(src("space/space.css"), /\n\.sp-is-unknown \.sp-add, \.sp-is-unknown \.sp-new-chat, \.sp-is-unknown \.sp-settings \{ display: none !important; \}/);
    host.querySelector(".sp-new-chat").dispatch("click");
    host.querySelector(".sp-settings").dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "no door without a project");
    await new Promise((r) => setImmediate(r));
    assert.equal(times("/api/git/places?cwd=%2Fr"), 0);
    known = true;
    space.paint();
    await lanesDrawn(host);
    assert.ok(!host.querySelector(".space").classList.contains("sp-is-unknown"), "known, its acts are back");
    assert.deepEqual([host.querySelector(".sp-title").textContent, host.querySelector(".sp-lanes-sec").hidden, times("/api/git/places?cwd=%2Fr")], ["r", false, 1]);
    space.paint();
    space.paint(true);
    assert.equal(times("/api/git/places?cwd=%2Fr"), 1, "a paint reads nothing");
    const again = renderSpace(host, { id: "p1" }, { project: () => null, look: lookOf({}), openChat() {}, newChat() {}, projectSettings() {}, onMoved() {}, onClose() {} });
    stops.push(again.stop);
    assert.equal(host.querySelectorAll(".space").length, 1, "drawn again over the frame, not beside");
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-4: a page for a project the list does not name kept its reading
  // class, though nothing reads it, and space.css hides .sp-line while a page reads, so the line that says why never showed)
  test("a project the list does not name: the line that says why shows, the page not reading; named, it reads until its Space is read", async () => {
    let known = false;
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN]) : u === "/api/space/p1" ? { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [] } : undefined);
    const { host, space } = mountSpace(lookOf({}), { known: () => known });
    const root = host.querySelector(".space");
    assert.equal(host.querySelector(".sp-line").textContent, "It may have been archived or deleted, or the list of projects has not been read yet. An archived project is brought back in Settings › Archived chats.");
    assert.match(src("space/space.css"), /\.space\.sp-is-reading \.sp-line, \.space\.sp-is-reading \.sp-tile \{ visibility: hidden; \}/, "a reading page hides its line");
    assert.equal(root.classList.contains("sp-is-reading"), false, "nothing is read: no reading page, so its line shows");
    known = true;
    space.paint();
    assert.equal(root.classList.contains("sp-is-reading"), true, "named: a reading page until its Space is read");
    await until(() => !root.classList.contains("sp-is-reading"), "its Space read");
  });

  // A project has no Space until the person makes one (the owner's of 10-29): its page says what one is, with Make a
  // Space, and Bring it back where one was deleted; its lanes and Places are the project's, and stay. While its deleted
  // Space waits the page is as it was then — none of a Space's parts —, so no press of the person's makes one over it
  // (by need, 11-12: without one that waits, its parts are drawn empty and the first add makes it — the tests below).
  // (fails before: yes — the page said its board could not be read, and drew an empty board)
  test("a project whose deleted Space waits: the card, its lanes and Places, none of a Space's parts; Make a Space, and the page is its Space's; Bring it back", async () => {
    let made = false;
    const deletedAt = Date.now() - HOUR;
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [] };
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1" && method === "POST" ? ((made = true), { ok: true, made: true, tasks: 2, space: SPACE })
      : u === "/api/space/p1/back" && method === "POST" ? ((made = true), { ok: true, at: deletedAt, space: SPACE })
      : u === "/api/space/p1" ? (made ? SPACE : new Refusal(404, "This project has no Space: make one from its menu.", { none: true, deletedAt }))
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    const card = await until(() => (host.querySelector(".sp-none")?.hidden === false ? host.querySelector(".sp-none") : null), "the card");
    assert.equal(card.querySelector(".sp-none-title").textContent, "This project has no Space");
    assert.match(card.querySelector(".sp-none-back").textContent, /^Its Space was deleted .+: Bring it back has it as it was, for 30 days from then\.$/);
    assert.match(card.querySelector(".sp-none-what").textContent, /Once it is made, every chat in this project can see and change it\. Its lanes and folders are here either way\.$/);
    assert.ok(host.querySelector(".space").classList.contains("sp-is-none"));
    // (fails before: yes — by need, 11-12: one class hid a Space's parts wherever there was none)
    assert.ok(host.querySelector(".space").classList.contains("sp-is-deleted"), "a Space's own parts are not drawn while its deleted one waits");
    assert.match(src("space/space.css"), /\n\.sp-is-deleted \.sp-work, \.sp-is-deleted \.sdb-view, \.sp-is-deleted \.sp-add, \.sp-is-deleted \.sp-by-itself \{ display: none !important; \}/);
    assert.equal(host.querySelector(".sp-board-note").hidden, true, "no word of a board that could not be read");
    assert.equal(host.querySelector(".sp-lanes-sec").hidden, false, "its lanes stay");
    const more = await menuOf(host.querySelector(".sp-settings"), "⋯");
    assert.ok(more.some((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Folders and worktrees…"), "and its places, in ⋯");
    doc.document.body.querySelector(".zc-menu")?.remove();
    const buttons = card.querySelectorAll("button").map((/** @type {any} */ b) => [b.textContent, !!b.hidden]);
    assert.deepEqual(buttons, [["Bring it back", false], ["Make a Space", false]]);
    card.querySelector(".sp-none-make").dispatch("click");
    await until(() => !host.querySelector(".space").classList.contains("sp-is-none"), "the Space made");
    assert.ok(posted.some((p) => p.url === "/api/space/p1"), "Make a Space posted it");
    assert.equal(host.querySelector(".sp-none").hidden, true);
    assert.equal(host.querySelector(".space").classList.contains("sp-is-deleted"), false);
    assert.equal(did.moved, 1, "the bar is told");
  });

  /** What a project with no Space answers its page: none, when its last was deleted, and the drafts its chats published. @param {any[]} [dashboards] @param {number | null} [deletedAt] */
  const noSpace = (dashboards = [], deletedAt = null) => new Refusal(404, "This project has no Space: make one from its menu.", { none: true, deletedAt, dashboards });
  const MADE = "This project's Space is made: every chat in it can see and change it";
  /** A draft app, as a chat of the project published it. */
  const draftApp = () => ({ name: "notes-ef56", title: "Notes", type: "app", v: 1, state: "draft", keptV: null, liveV: null, draft: true, paused: false, keptAt: null, grant: null,
    newest: { sources: {}, watch: [], actions: {} }, reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: Date.now() });

  // A Space by need (11-12): a project with no Space, and none deleted that waits, draws a Space's parts from an empty
  // one under a quieter card, each press saying in its tip that it makes the Space; the first thing the person adds
  // makes it with that press — its answer says so, and the page says it once, drops the card and tells the bar.
  // (fails before: yes — the card said "This project has no Space", a Space's parts were hidden, and an add had nowhere
  // to be pressed)
  test("a project with no Space: No Space yet over an empty board, What happened and Runs by itself; each tip says the press makes its Space; the first add makes it — one toast, the card gone, the bar told", async () => {
    let made = false;
    const at = Date.now();
    const SPACE = { project: "p1", seq: 2, logMore: 0, names: {}, waiting: [], tasks: [], syncs: [], dashboards: [], gone: [], needs: [],
      log: [{ id: "e1", at: at - 1000, by: { kind: "filament" }, text: "You made this Space.", task: null }, { id: "e2", at, by: { kind: "you" }, text: "Deploys are frozen.", task: null }] };
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1/log" && method === "POST" ? ((made = true), { ok: true, entry: SPACE.log[1], made: true, space: SPACE })
      : u === "/api/space/p1/folder-apps" ? { apps: [] }
      : u === "/api/space/p1" && method === "GET" ? (made ? SPACE : noSpace())
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    const card = await until(() => (host.querySelector(".sp-none")?.hidden === false ? host.querySelector(".sp-none") : null), "the card");
    const root = host.querySelector(".space");
    assert.deepEqual([root.classList.contains("sp-is-none"), root.classList.contains("sp-is-deleted")], [true, false]);
    assert.equal(card.querySelector(".sp-none-title").textContent, "No Space yet");
    assert.equal(card.querySelector(".sp-none-what").textContent,
      "A Space is the project's board of tasks and What happened — the log of what its chats did —, with the apps they make for it. The first thing you add here makes it: from then every chat in this project can see and change it. Its lanes and folders are here either way.");
    assert.deepEqual(card.querySelectorAll("button").map((/** @type {any} */ b) => [b.textContent, !!b.hidden, b.getAttribute("class")]), [["Bring it back", true, "ghost sm"], ["Make a Space", false, "ghost sm sp-none-make"]], "Make a Space, an empty one on purpose, a quiet button");
    // Its parts, drawn from an empty Space: nothing of them hidden by the page's class any more.
    const css = src("space/space.css");
    assert.doesNotMatch(css, /\.sp-is-none \.(sp-work|sp-add|sp-by-itself|sp-needs-sec|sdb-view)\b/, "a project with no Space hides none of a Space's parts");
    assert.doesNotMatch(css, /\.sp-is-(none|deleted) \.sp-needs-sec/, "the chats that wait for you are Now's: shown either way");
    assert.deepEqual([host.querySelector(".sp-work").hidden, host.querySelector(".sp-by-itself").hidden, !!host.querySelector(".sp-add").hidden], [false, false, false]);
    // Its two empty lines say what holds with no Space: no chat adds a task or writes a line until there is one (they
    // ran ahead at first: "the chats here add theirs as they work", "Filament says so here").
    assert.equal(host.querySelector(".sb-none").textContent, "No tasks yet. New task… adds the first and makes this project's Space; from then the chats here add theirs as they work.");
    assert.equal(host.querySelector(".sl-empty").textContent, "Nothing yet. A note of yours makes this project's Space; from then Filament says here as the chats finish their turns, and their agents write here too.");
    assert.deepEqual(texts(host, ".sp-by-itself .sbi-make"), ["Routine…", "Watcher…"]);
    assert.equal(host.querySelector(".sp-start"), null, "no Start here without a Space");
    // Each press says what it does before it is pressed.
    const tips = () => [".sp-new-task", ".sp-add", ".sp-pull", ".sl-note", ".sp-none-make"].map((sel) => host.querySelector(sel).getAttribute("title"));
    assert.deepEqual(tips(), [
      "A task on the board, for you and the chats here: the first one makes this project's Space",
      "What a Space can hold: the first thing you add makes this project's Space",
      "Linear, GitHub or Jira onto this board, through one of its connectors: their issues as cards, moved back only when you say so. Saving one makes this project's Space",
      "A line of your own in What happened: it makes this project's Space",
      "An empty Space, on purpose: the first thing you add here makes one anyway",
    ]);
    // New chat here… makes none, and says nothing of a Space there is not ("a chat started there works in this Space").
    const chatTip = () => host.querySelector(".sp-new-chat").getAttribute("title");
    assert.equal(chatTip(), "The Start in this project's folder. Nothing runs until you send");
    assert.deepEqual(host.querySelectorAll(".sp-by-itself .sbi-make").map((/** @type {any} */ b) => b.getAttribute("title")), [
      "The Start here, its box begun: an agent proposes the routine, and it runs only once you switch it on; this makes the project's Space",
      "The Start here, its box begun: an agent proposes the watcher, and it listens only once you switch it on; this makes the project's Space",
    ]);
    const descOf = (/** @type {any[]} */ items, /** @type {string} */ label) => items.find((i) => i.querySelector(".zc-menu-label-line")?.textContent === label)?.querySelector(".zc-menu-desc")?.textContent;
    const tell = await menuOf(host.querySelector(".sl-menu"), "What happened's ⋯");
    assert.equal(descOf(tell, "Tell the chats…"), "Each agent reads the board and what the others wrote, then writes what changes for it: nothing is sent until you press Tell them, which makes this project's Space");
    doc.document.body.querySelector(".zc-menu")?.remove();
    const add = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    assert.equal(descOf(add, "Routine…"), "Work an agent does by itself at a time, made in a chat: it runs only once you switch it on; this makes the project's Space");
    assert.equal(descOf(add, "Watcher…"), "Something that listens for an event and wakes an agent, or tells you, made in a chat: it listens only once you switch it on; this makes the project's Space");
    doc.document.body.querySelector(".zc-menu")?.remove();
    const door = await menuOf(host.querySelector(".sp-settings"), "⋯");
    assert.ok(!door.some((i) => i.querySelector(".zc-menu-label-line")?.textContent === "Space settings…"), "no Space settings… of a Space that is not");
    doc.document.body.querySelector(".zc-menu")?.remove();
    assert.deepEqual(posted, [], "nothing made by looking");
    // The first add: a line in What happened.
    const before = toasts().length;
    host.querySelector(".sl-note").dispatch("click");
    const field = host.querySelector("textarea.sl-field");
    field.value = "Deploys are frozen.";
    field.dispatch("keydown", { key: "Enter" });
    await until(() => !root.classList.contains("sp-is-none"), "the Space made");
    assert.deepEqual(posted, [{ url: "/api/space/p1/log", body: { text: "Deploys are frozen." } }], "one press: no make of its own");
    assert.equal(card.hidden, true, "the card goes");
    assert.equal(did.moved, 1, "the bar is told, as Make a Space tells it");
    assert.deepEqual(toasts().slice(before).map(([t]) => t), [MADE], "said once");
    assert.deepEqual(texts(host, ".sl-entry .sl-text"), ["You: “Deploys are frozen.”", "You made this Space."]);
    assert.deepEqual(tips().slice(0, 4), [
      "A task on the board, for you and the chats here",
      "What extends this Space: nothing is there until you add it",
      "Linear, GitHub or Jira onto this board, through one of its connectors: their issues as cards, moved back only when you say so",
      "A line of your own in What happened",
    ], "with a Space, each tip as it was");
    assert.equal(host.querySelector(".sb-none").textContent, "No tasks yet. New task… adds one; the chats here add theirs as they work.", "and the board's empty line");
    assert.equal(chatTip(), "The Start in this Space's folder: a chat started there works in this Space. Nothing runs until you send");
    // The next add says nothing of making it.
    field.value = "Again.";
    made = true;
    serve = ((was) => (/** @type {string} */ u, /** @type {string} */ method) => (u === "/api/space/p1/log" && method === "POST" ? { ok: true, entry: SPACE.log[1], space: SPACE } : was(u, method)))(serve);
    host.querySelector(".sl-note").dispatch("click");
    host.querySelector("textarea.sl-field").value = "Again.";
    host.querySelector("textarea.sl-field").dispatch("keydown", { key: "Enter" });
    await until(() => posted.length === 2, "written");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([toasts().slice(before).length, did.moved], [1, 1]);
  });

  // (fails before: yes — the answers carried no `made`, and the page had no word for it)
  test("the words a made Space is said with: alone, with the tasks that came back, and none where nothing was made", () => {
    assert.equal(madeWords({ made: true }), MADE);
    assert.equal(madeWords({ made: true, tasks: 1 }), `${MADE}; 1 task came back from its old board`);
    assert.equal(madeWords({ made: true, tasks: 3 }), `${MADE}; 3 tasks came back from its old board`);
    assert.deepEqual([madeWords({ made: false, tasks: 2 }), madeWords({}), madeWords(null)], ["", "", ""]);
  });

  // (fails before: yes — Routine…, Watcher… and What do you look after… were not drawn on a project with no Space; with
  // one, each filled the Start at once, and does still)
  test("a press that only fills a box makes the Space first, then fills: Routine…, Watcher…, What do you look after…; refused, it fills nothing", async () => {
    let made = false;
    let refuse = false;
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [] };
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1" && method === "POST" ? (refuse ? new Refusal(409, "This project's Space was deleted: bring it back, or make a new one, first.") : made ? { ok: true, space: SPACE } : ((made = true), { ok: true, made: true, space: SPACE }))
      : u === "/api/space/p1/folder-apps" ? { apps: [] }
      : u === "/api/space/p1" ? (made ? SPACE : noSpace())
      : undefined;
    for (const stop of stops.splice(0)) stop();
    // Refused (its deleted Space came to wait since the page read it): said, and nothing filled.
    refuse = true;
    const first = mountSpace(lookOf({}));
    await lanesDrawn(first.host);
    await until(() => first.host.querySelector(".sp-by-itself .sbi-make"), "Runs by itself, with none");
    let before = toasts().length;
    first.host.querySelector(".sp-by-itself .sbi-make").dispatch("click");
    await until(() => toasts().length > before, "the refusal said");
    assert.deepEqual([toasts().slice(before).map(([t, cls]) => [t, /\berr\b/.test(cls)]), first.did.words, first.did.moved], [[["This project's Space was deleted: bring it back, or make a new one, first.", true]], [], 0]);
    for (const stop of stops.splice(0)) stop();
    posted.length = 0;
    refuse = false;
    // Routine…, from Runs by itself: the make of a fill (`need`), then the Start.
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-by-itself .sbi-make"), "Runs by itself, with none");
    before = toasts().length;
    host.querySelector(".sp-by-itself .sbi-make").dispatch("click");
    await until(() => did.words.length === 1, "the Start filled");
    assert.deepEqual(posted, [{ url: "/api/space/p1", body: { need: true } }]);
    assert.deepEqual(did.words, [["/r", routineMakeWords("r")]]);
    assert.deepEqual([toasts().slice(before).map(([t]) => t), did.moved, host.querySelector(".space").classList.contains("sp-is-none")], [[MADE], 1, false]);
    // With its Space: Watcher… from Add to this Space… fills at once, and nothing is posted.
    const add = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    const row = (/** @type {any[]} */ items, /** @type {string} */ label) => items.find((i) => i.querySelector(".zc-menu-label-line")?.textContent === label);
    assert.equal(row(add, "Watcher…").querySelector(".zc-menu-desc").textContent, "Something that listens for an event and wakes an agent, or tells you, made in a chat: it listens only once you switch it on");
    row(add, "Watcher…").dispatch("click");
    assert.deepEqual([did.words.at(-1), posted.length], [["/r", watcherMakeWords("r")], 1]);
    for (const stop of stops.splice(0)) stop();
    // What do you look after…, on a project with no Space: its sheet says the ask makes it, and its press does.
    made = false;
    posted.length = 0;
    const third = mountSpace(lookOf({}));
    await lanesDrawn(third.host);
    await until(() => third.host.querySelector(".sp-none")?.hidden === false, "the card");
    const items = await menuOf(third.host.querySelector(".sp-add"), "Add to this Space…");
    row(items, "What do you look after…").dispatch("click");
    const sheetEl = /** @type {any} */ (await until(() => doc.document.body.querySelector(".srt-look-sheet"), "its sheet"));
    assert.equal(sheetEl.querySelector(".srt-look-note").textContent, "Ask an agent… makes this project's Space: what its agent proposes lives there.");
    const box = sheetEl.querySelector(".srt-look-box");
    box.checked = true;
    box.dispatch("change");
    sheetEl.querySelector(".srt-look-go").dispatch("click");
    await until(() => third.did.words.length === 1, "the Start filled");
    assert.deepEqual([posted, third.did.moved], [[{ url: "/api/space/p1", body: { need: true } }], 1]);
  });

  // (fails before: yes — an app's own toast was the only one, and nothing said its Space was made)
  test("an add with a toast of its own says both in one: an app of the folder's, on a project with no Space", async () => {
    let made = false;
    const PULSE = { ...draftApp(), name: "pulse-cd34", title: "Pulse" };
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [PULSE], gone: [], needs: [] };
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1/folder-apps" && method === "GET" ? { apps: made ? [] : [{ folder: ".filament/apps/pulse", title: "Pulse", description: "" }] }
      : u === "/api/space/p1/folder-apps" ? ((made = true), { ok: true, name: "pulse-cd34", title: "Pulse", made: true, tasks: 2, space: SPACE })
      : u === "/api/space/p1" ? (made ? SPACE : noSpace())
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-none")?.hidden === false, "the card");
    const before = toasts().length;
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    items.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "“Pulse” from this project's folder").dispatch("click");
    await until(() => host.querySelector(".sp-crumb-app").textContent === "Pulse", "its page, shown");
    assert.deepEqual(toasts().slice(before).map(([t]) => t), [`“Pulse” is a draft here: nothing runs until you keep it. ${MADE}; 2 tasks came back from its old board`]);
    assert.deepEqual([did.moved, host.querySelector(".space").classList.contains("sp-is-none")], [1, false]);
  });

  // (fails before: yes — an app an agent published in a project with no Space had no row and no page, and its Keep
  // answered 404)
  test("a draft a chat published before any Space: its row with Keep… and its page; the Keep sheet says keeping it makes the Space, and Keep does", async () => {
    let made = false;
    const NOTES = draftApp();
    const KEPT = { ...NOTES, state: "kept", keptV: 1, liveV: 1, draft: false, keptAt: Date.now(), grant: NOTES.newest };
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [KEPT], gone: [], needs: [] };
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1/dashboards/notes-ef56/keep" && method === "POST" ? ((made = true), { ok: true, dashboard: { name: "notes-ef56" }, made: true, space: SPACE })
      : u === "/api/space/p1" ? (made ? SPACE : noSpace([NOTES]))
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    const row = /** @type {any} */ (await until(() => host.querySelector(".sp-by-itself .sbi-row[data-key='app:notes-ef56']"), "the draft's row"));
    assert.deepEqual([row.querySelector(".sbi-title").textContent, row.querySelector(".sbi-word").textContent, row.querySelector(".sbi-go").textContent], ["Notes", "Draft", "Keep…"]);
    // Its page, from its row; its ⋯ offers no removal from a Space that is not.
    row.querySelector(".sbi-face").dispatch("click");
    assert.deepEqual([host.querySelector(".sdb-view").hidden, host.querySelector(".sp-crumb-app").textContent], [false, "Notes"]);
    const more = await menuOf(host.querySelector(".sdb-more"), "its ⋯");
    assert.deepEqual(more.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent), ["Keep…", "Change with an agent…", "Open in Artifacts"]);
    doc.document.body.querySelector(".zc-menu")?.remove();
    host.querySelector(".sp-crumb-page").dispatch("click");
    row.querySelector(".sbi-go").dispatch("click");
    const keep = /** @type {any} */ (await until(() => doc.document.body.querySelector(".sdb-keep-sheet"), "its Keep sheet"));
    assert.equal(keep.querySelector(".sdb-keep-makes").textContent, "Keeping it makes this project's Space: every chat in it can see and change it.");
    const before = toasts().length;
    keep.querySelector(".sdb-keep-go").dispatch("click");
    await until(() => !host.querySelector(".space").classList.contains("sp-is-none"), "the Space made");
    assert.deepEqual(posted, [{ url: "/api/space/p1/dashboards/notes-ef56/keep", body: { v: 1 } }]);
    assert.deepEqual([toasts().slice(before).map(([t]) => t), did.moved], [[MADE], 1]);
    // With its Space, the sheet says nothing of making one.
    await until(() => !doc.document.body.querySelector(".sdb-keep-sheet"), "the sheet closed");
    host.querySelector(".sbi-row[data-key='app:notes-ef56'] .sbi-face").dispatch("click");
    host.querySelector(".sdb-may").dispatch("click");
    const may = /** @type {any} */ (await until(() => doc.document.body.querySelector(".sdb-keep-sheet"), "What it may do"));
    assert.equal(may.querySelector(".sdb-keep-makes"), null);
  });

  // (fails before: yes — the page's parts were not drawn again once its Space was gone: the app's page stood hidden over
  // a hidden Board, and nothing but the crumb was left)
  test("a Space deleted while one of its app's pages is open: the page gives way to the card, never a blank one", async () => {
    let gone = false;
    const deletedAt = Date.now();
    const PULSE = { ...draftApp(), name: "pulse-cd34", title: "Pulse" };
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [PULSE], gone: [], needs: [] };
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN]) : u === "/api/space/p1" ? (gone ? noSpace([], deletedAt) : SPACE) : undefined);
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({}), { tab: "pulse-cd34" });
    await lanesDrawn(host);
    await until(() => host.querySelector(".sdb-view").hidden === false, "the app's page");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".sp-head").hidden, host.querySelector(".sp-crumb-app").textContent], [true, true, "Pulse"]);
    gone = true;
    hear({ type: "space", project: "p1", seq: 0, gone: true });
    await until(() => host.querySelector(".space").classList.contains("sp-is-none"), "its Space gone");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".sp-head").hidden, host.querySelector(".sdb-view").hidden, host.querySelector(".sp-crumb-app").hidden], [false, false, true, true], "the Board's place again, with the card");
    assert.ok(host.querySelector(".space").classList.contains("sp-is-deleted"));
    assert.equal(host.querySelector(".sp-none").hidden, false);
    assert.equal(host.querySelector(".sp-none-title").textContent, "This project has no Space");
    assert.equal(host.querySelectorAll(".sp-by-itself .sbi-row").length, 0, "nothing of the Space that went is drawn");
  });

  // Watch this chat…, in a chat of a project with no Space (app.js `onWatch`): the Space is made at the press, said,
  // and only then is the box filled; refused — a deleted one waits —, said, and nothing is filled.
  // (fails before: yes — there was no such make: the row was off, sending the person to a menu)
  test("the make of a press outside the page: made and said, true; there already, nothing said, true; refused, said, false", async () => {
    /** @type {any} */
    let answer = { ok: true, made: true, space: {} };
    serve = (u, method) => (u === "/api/space/p9" && method === "POST" ? answer : undefined);
    let before = toasts().length;
    assert.equal(await spaceForAsk("p9"), true);
    assert.deepEqual([posted, toasts().slice(before).map(([t]) => t)], [[{ url: "/api/space/p9", body: { need: true } }], [MADE]]);
    answer = { ok: true, space: {} };
    before = toasts().length;
    assert.equal(await spaceForAsk("p9"), true);
    assert.equal(toasts().length - before, 0, "a Space that is there: nothing to say");
    answer = new Refusal(409, "This project's Space was deleted: bring it back, or make a new one, first.");
    before = toasts().length;
    assert.equal(await spaceForAsk("p9"), false);
    assert.deepEqual(toasts().slice(before).map(([t, cls]) => [t, /\berr\b/.test(cls)]), [["This project's Space was deleted: bring it back, or make a new one, first.", true]]);
  });

  // (fails before: yes — found by the Designer, 10-29: a fed card's hint and a glance's line still sent you to "its tab",
  // though a Space's apps and dashboards became rows in the left bar, each its own page)
  test("no word on a Space's screens sends you to a tab: an app or a dashboard is its own page", () => {
    for (const f of ["board.js", "your-space.js", "dashboards.js", "space.js", "needs-rows.js", "routines.js"]) {
      const said = src(`space/${f}`).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
      assert.doesNotMatch(said, /\bits tab\b|\bAs a tab\b|\bin its tab\b/i, f);
    }
  });

  // (fails before: yes — found by the Designer walking a first Space, 10-29: the card's buttons are flex boxes, which
  // beat `hidden`, so Bring it back showed on a project that never had a Space, and pressing it failed)
  test("the no-Space card's hidden button is hidden, though its buttons are flex boxes", () => {
    assert.match(src("space/space.css"), /\.sp-none-acts > button\[hidden\] \{ display: none; \}/);
  });

  // Past 20 lanes the files are read in parts, as the route takes 20 places at most; a part refused is said in Compare…,
  // never drawn as "no lane has changed a file".
  // (fails before: yes — found by the Hunter on S1: every read of 21 places and more was refused, so no Overlap ever
  // showed, and a refusal counted as a read)
  test("Overlaps past 20 lanes: the files read in parts; a part refused is said in Compare…", async () => {
    const wts = Array.from({ length: 21 }, (_, i) => ({ ...WT, path: `/r-w${i}`, name: `r-w${i}`, branch: `b${i}`, chats: [{ id: `c${100 + i}`, name: `lane ${i}`, home: true, atWork: true }] }));
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [] };
    /** @type {string[][]} */
    const asked = [];
    let refuseSecond = false;
    serve = (u) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, ...wts]);
      if (u === "/api/space/p1") return SPACE;
      if (!u.startsWith("/api/space/p1/files?")) return undefined;
      const places = new URL(`http://x${u}`).searchParams.getAll("place");
      asked.push(places);
      if (places.length > 20) return new Refusal(400, "one read takes 20 folders at most");
      if (refuseSecond && asked.length % 2 === 0) return new Refusal(500, "git is busy");
      // Main and the last worktree both change src/a.js.
      return { places: places.map((path) => ({ path, ok: true, error: null, branch: "b", base: "main", ahead: 0, commits: 0, files: path === "/r" || path === "/r-w20" ? [{ path: "src/a.js", committed: false, uncommitted: true }] : [], more: 0 })) };
    };
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf(Object.fromEntries([["c20", { title: "on main", when: Date.now(), line: "" }], ...wts.map((w, i) => [`c${100 + i}`, { title: `lane ${i}`, when: Date.now(), line: "" }])])));
    await lanesDrawn(host);
    await until(() => !host.querySelector(".sp-overlap").hidden, "the Overlap banner");
    assert.deepEqual(asked.map((p) => p.length), [20, 2], "two parts: 20 places, then 2");
    assert.match(host.querySelector(".sp-overlap").textContent, /src\/a\.js/);
    // A part refused: what it read before stays, and Compare… says the rest could not be read.
    refuseSecond = true;
    asked.length = 0;
    const placesSheet = await placesSheetOf(host);
    placesSheet.querySelector(".sp-again").dispatch("click");
    await until(() => asked.length === 2, "read again");
    placesSheet.querySelector(".zc-sheet-x").dispatch("click");
    await new Promise((r) => setTimeout(r, 50));
    host.querySelector(".sp-compare").dispatch("click");
    const sheetEl = doc.document.body.querySelector(".sp-compare-sheet");
    assert.equal(sheetEl.querySelector(".so-error").textContent, "Some lanes' files could not be read: git is busy");
    assert.ok(sheetEl.querySelector(".so-own.is-shared"), "what the refused part read before still shows");
    sheetEl.querySelector(".zc-sheet-x").dispatch("click");
  });

  // (fails before: yes — the Space had lanes alone)
  test("the Space the server keeps: read once shown and as the stream says it moved; a lane's task, its newest line, a sync's point; Overlaps; Tell the chats… opens, Tell them sends", async () => {
    const at = Date.now();
    /** @type {any} */
    const SPACE = {
      project: "p1", seq: 4, logMore: 0, names: {}, waiting: [],
      tasks: [{ id: "t1", title: "The frame", line: "left bar, panes", column: "doing", parked: false, chain: "c21", place: null, by: { kind: "you" }, at: at - HOUR, movedAt: at - HOUR, startedAt: at - HOUR, doneAt: null }],
      log: [{ id: "e1", at: at - 5 * 60_000, by: { kind: "agent", chain: "c21" }, text: "Now list built.", task: null }],
      syncs: [{ id: "s1", at: at - 10 * 60_000, also: "", lanes: [{ chain: "c20", when: "now", state: "sent" }, { chain: "c21", when: "now", state: "sent" }] }],
    };
    const S2 = { id: "s2", at, also: "", lanes: [{ chain: "c20", when: "now", state: "sent" }, { chain: "c21", when: "after", state: "waiting" }] };
    const place = (/** @type {string} */ path, /** @type {number} */ ahead) => ({ path, ok: true, error: null, branch: "b", base: "main", ahead, commits: ahead, files: [{ path: "src/a.js", committed: true, uncommitted: false }], more: 0 });
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT])
      : u === "/api/space/p1" ? SPACE
      : u === "/api/space/p1/files?place=%2Fr&place=%2Fr-wt" ? { places: [place("/r", 0), place("/r-wt", 2)] }
      : u === "/api/space/p1/sync" && method === "POST" ? { ok: true, sync: S2, space: { ...SPACE, seq: 6, syncs: [...SPACE.syncs, S2], waiting: ["c21"] } }
      : u === "/api/space/p1/log" && method === "POST" ? new Refusal(400, "a logbook line needs words: what you did, found or decided")
      : undefined;
    const look = lookOf({ c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - HOUR, line: "Wiring the lanes" } }, { c21: { group: "works", fact: "read …/side.js" } });
    // The Spaces drawn before this one stop hearing the stream, so each read counted here is this one's.
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(look);
    await lanesDrawn(host);
    await until(() => host.querySelector(".sb-card"), "the board read");
    assert.equal(times("/api/space/p1"), 1);
    assert.deepEqual(
      host.querySelectorAll("article.sp-lane").map((/** @type {any} */ a) => [a.getAttribute("data-place"), a.querySelector(".sp-lane-facts").textContent, a.querySelector(".sp-lane-line")?.textContent || ""]),
      [
        ["/r", "2 files changed, not committed", ""],
        ["/r-wt", "Has: The frame — left bar, panes · 2 commits not on main", `${whenWordsOf(at - 5 * 60_000)} “Now list built.”`],
      ],
      "a lane's newest logbook line before memory's",
    );
    assert.equal(host.querySelectorAll(".sp-lanes .sp-syncpt").length, 1, "the sync both lanes had, between them");
    assert.deepEqual(texts(host, ".sb-card .sb-t"), ["The frame"]);
    assert.deepEqual(texts(host, ".sl-entry .sl-text"), ["the agent: Now list built."]);
    // Overlaps, once the lanes' files are read: a file both change, as git says; Compare… opens what each lane changes.
    await until(() => !host.querySelector(".sp-overlap").hidden, "the Overlap banner");
    assert.equal(host.querySelector(".sp-overlap").textContent, "Overlap · main and agent both change src/a.js.Compare…");
    host.querySelector(".sp-compare").dispatch("click");
    const sheetEl = doc.document.body.querySelector(".sp-compare-sheet");
    assert.ok(sheetEl, "a sheet");
    assert.equal(sheetEl.querySelector(".so-own.is-shared").textContent, "a.jsmain and agent both change it");
    assert.deepEqual(texts(sheetEl, ".so-step .sp-branch"), ["agent"], "the worktree in the merge order");
    sheetEl.querySelector(".zc-sheet-x").dispatch("click");
    // The stream: this project's change is read again, once for a burst; another project's is not.
    hear({ type: "space", project: "p2", seq: 1 });
    hear({ type: "space", project: "p1", seq: 5 });
    hear({ type: "space", project: "p1", seq: 6 });
    await until(() => times("/api/space/p1") === 2, "read again");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(times("/api/space/p1"), 2);
    // Tell the chats…, What happened's ⋯ first row, opens the card; nothing is sent until Tell them.
    const tell = (await menuOf(host.querySelector(".sl-menu"), "What happened's ⋯"))[0];
    assert.equal(tell.querySelector(".zc-menu-label-line").textContent, "Tell the chats…");
    tell.dispatch("click");
    assert.equal(host.querySelector(".sy-card").hidden, false);
    assert.deepEqual(posted, []);
    host.querySelector(".sy-run").dispatch("click");
    await until(() => host.querySelector(".sy-out"), "the outcome");
    assert.deepEqual(posted, [{ url: "/api/space/p1/sync", body: { lanes: [{ chain: "c20", when: "now" }, { chain: "c21", when: "after" }], also: "" } }]);
    assert.deepEqual(texts(host, ".sy-out"), ["sent as a turn of its own", "waits for its turn to end"]);
    // A note the server refuses: said in an error toast, in its words.
    host.querySelector(".sl-note").dispatch("click");
    const field = host.querySelector("textarea.sl-field");
    field.value = "x";
    field.dispatch("keydown", { key: "Enter" });
    await until(() => toasts().some(([t]) => t === "a logbook line needs words: what you did, found or decided"), "the refusal said");
    assert.ok(toasts().some(([t, cls]) => t.startsWith("a logbook line needs words") && /\berr\b/.test(cls)));
  });

  /** A Space with one task on its board, under a title. @param {number} seq @param {string} title */
  const boardWith = (seq, title) => ({ project: "p1", seq, logMore: 0, names: {}, waiting: [], log: [], syncs: [],
    tasks: [{ id: "t1", title, line: "", column: "doing", parked: false, chain: null, place: null, by: { kind: "you" }, at: 0, movedAt: 0, startedAt: 0, doneAt: null }] });

  // (fails before: yes — the bug hunt of 10-30, UISP-2: a read of the Space that failed over a board read before kept that
  // board and hid its failure, so the board passed for the Space as it stands)
  test("a read of the Space that fails over a board read before: the board stays, its note says the last read failed; read again, the note goes", async () => {
    let refuse = false;
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN])
      : u === "/api/space/p1" && method === "GET" ? (refuse ? new Refusal(500, "the disk is full") : boardWith(1, "The frame"))
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({}));
    await until(() => texts(host, ".sb-card .sb-t")[0] === "The frame", "the board read");
    const note = host.querySelector(".sp-board-note");
    assert.equal(note.hidden, true);
    refuse = true;
    hear({ type: "space", project: "p1", seq: 2 });
    await until(() => note.hidden === false, "its failure, said");
    assert.equal(note.textContent, "The board's last read failed: the disk is full. It shows what was read before.");
    assert.deepEqual(texts(host, ".sb-card .sb-t"), ["The frame"], "the board read before stays");
    refuse = false;
    hear({ type: "space", project: "p1", seq: 3 });
    await until(() => note.hidden === true, "read again: nothing to say");
    assert.equal(note.textContent, "");
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-10: the Space's reads had no turn of their own, so an older read that
  // landed after a newer one drew the older Space over it)
  test("two reads of the Space on their way: the older one's answer, landing last, is not drawn over the newer", async () => {
    /** The Space each read is answered with, in turn: the first at once, then one held, then the newest at once. @type {any[]} */
    const answers = [boardWith(1, "First")];
    serve = (u, method) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN]) : u === "/api/space/p1" && method === "GET" ? answers.shift() : undefined);
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({}));
    await until(() => texts(host, ".sb-card .sb-t")[0] === "First", "the board read");
    /** @type {(v: any) => void} */
    let letGo = () => {};
    answers.push(new Promise((r) => void (letGo = r)), boardWith(3, "Newer"));
    const before = times("/api/space/p1");
    hear({ type: "space", project: "p1", seq: 2 });
    await until(() => times("/api/space/p1") === before + 1, "a read on its way");
    hear({ type: "space", project: "p1", seq: 3 });
    await until(() => texts(host, ".sb-card .sb-t")[0] === "Newer", "the newer read, drawn");
    // The older read lands last, with the Space as it stood before.
    letGo(boardWith(2, "Older"));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(texts(host, ".sb-card .sb-t"), ["Newer"], "the older answer is not drawn");
  });

  // (fails before: yes — the bug hunt of 11-03 on the board's drag: a lane's Has: read the Space's tasks as last
  // answered, so a card dragged on top of Doing showed there at once while Has: named the one below it until the Space
  // answered the move)
  test("a lane's Has: follows the board while a drop is on its way: the card dragged on top of Doing is the lane's at once, and stays so once the Space answers", async () => {
    const at = Date.now();
    /** A task in Doing that the worktree's chat has. @param {string} id @param {string} title @param {number} movedAt @param {any} [more] */
    const doing = (id, title, movedAt, more = {}) => ({ id, title, line: "", column: "doing", parked: false, chain: "c21", place: null, by: { kind: "you" }, at: at - 2 * HOUR, movedAt, startedAt: movedAt, doneAt: null, ...more });
    const SPACE = { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], log: [], syncs: [], tasks: [doing("t1", "The frame", at - HOUR), doing("t2", "The lanes", at - HOUR / 2)] };
    /** @type {(v: any) => void} */
    let letGo = () => {};
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT])
      : u === "/api/space/p1" && method === "GET" ? SPACE
      : /^\/api\/space\/p1\/tasks\/t[12]$/.test(u) && method === "PATCH" ? new Promise((r) => void (letGo = r))
      : undefined;
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - HOUR, line: "" } }));
    await lanesDrawn(host);
    await until(() => host.querySelectorAll("section.sb-col.is-doing .sb-card").length === 2, "the board read");
    const has = () => host.querySelector('article.sp-lane[data-place="/r-wt"] .sp-has')?.textContent;
    const shown = () => [texts(host, "section.sb-col.is-doing .sb-t"), has()];
    assert.deepEqual(shown(), [["The lanes", "The frame"], "Has: The lanes"], "the newest move on top, the lane's");
    /** A card dragged to the top of Doing, the column's cards laid out as the board draws them. @param {string} id */
    const toTop = (id) => {
      host.querySelectorAll("section.sb-col.is-doing [data-task]").forEach((/** @type {any} */ x, /** @type {number} */ i) => {
        x.getBoundingClientRect = () => ({ top: 100 + i * 48, bottom: 140 + i * 48, height: 40, left: 0, right: 200, width: 200 });
      });
      /** @type {Record<string, string>} */
      const data = {};
      const dt = { data, types: /** @type {string[]} */ ([]), effectAllowed: "", dropEffect: "", setData(/** @type {string} */ k, /** @type {string} */ v) { this.types.push(k); data[k] = v; } };
      host.querySelector(`[data-task="${id}"]`).dispatch("dragstart", { dataTransfer: dt });
      host.querySelector("section.sb-col.is-doing").dispatch("drop", { dataTransfer: dt, clientY: 101 });
      host.querySelector(`[data-task="${id}"]`).dispatch("dragend", { dataTransfer: dt });
    };
    // The frame dragged on top of Doing, its write held on its way.
    toTop("t1");
    await until(() => posted.some((p) => p.url === "/api/space/p1/tasks/t1"), "the move on its way");
    assert.deepEqual(posted.find((p) => p.url === "/api/space/p1/tasks/t1")?.body, { order: ["t1", "t2"] });
    assert.deepEqual(shown(), [["The frame", "The lanes"], "Has: The frame"], "the board and Has: alike before the Space answers");
    // Answered: the Space as it stands has it so, and so do both.
    const ANSWERED = { ...SPACE, seq: 2, tasks: [doing("t1", "The frame", at - HOUR, { rank: -at }), doing("t2", "The lanes", at - HOUR / 2, { rank: 1 - at })] };
    letGo({ ok: true, space: ANSWERED });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(shown(), [["The frame", "The lanes"], "Has: The frame"], "once answered");
    // The lanes dragged back on top, and refused: Has: goes back with the board.
    toTop("t2");
    await until(() => posted.some((p) => p.url === "/api/space/p1/tasks/t2"), "the second move on its way");
    assert.deepEqual(shown(), [["The lanes", "The frame"], "Has: The lanes"], "before the Space answers");
    letGo(new Refusal(409, "the Space moved on"));
    await until(() => toasts().some(([t]) => t === "the Space moved on"), "the refusal said");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(shown(), [["The frame", "The lanes"], "Has: The frame"], "refused: both back as the Space has it");
  });

  // HarnessV4_Space_Plan S2: its dashboards. No tab strip until one is; Add to this Space… › App… opens ＋ New app;
  // a chat's draft is a dashed tab whose Keep… sheet says every command in Filament's words; kept, its bar is live, a
  // failure a red dot with Read again and Fix with an agent…; its ⋯; Remove on the person's word, back to the Board.
  // (fails before: yes — a Space had no tabs and no dashboards)
  test("its dashboards: the strip once one is; a draft, Keep…, Keep; a failure, Read again, Fix with an agent…; ⋯ and Remove", async () => {
    const at = Date.now();
    const MIN = 60_000;
    const command = ["npx", "wrangler", "deployments", "list", "--json"];
    const DRAFT = {
      name: "deploys-ab12", title: "Deploys", v: 1, state: "draft", keptV: null, liveV: null, draft: true, paused: false, keptAt: null, grant: null,
      newest: { sources: { deploys: { command, every: 2 * MIN } }, watch: [], actions: {} }, reads: { sources: { deploys: { command } }, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at,
    };
    const KEPT = { ...DRAFT, state: "kept", keptV: 1, liveV: 1, draft: false, keptAt: at, grant: DRAFT.newest,
      sources: { deploys: { at: at - 12 * MIN, error: "npx exited 1: You are not authenticated.", errorAt: at - MIN, fails: 1, stopped: false, rows: 2 } } };
    /** @type {any[]} */
    let current = [];
    /** @type {any[]} */
    let out = [];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: current, gone: out });
    const P = "/api/space/p1/dashboards/deploys-ab12";
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === `${P}/keep`) return (current = [KEPT]), { ok: true, dashboard: {}, space: spaceOf() };
      if (u === `${P}/read` || u === `${P}/pause`) return { ok: true, sources: {}, space: spaceOf() };
      if (u === P && method === "DELETE") return (current = []), (out = [{ name: "deploys-ab12", title: "Deploys", keptV: 1, at }]), { ok: true, space: spaceOf() };
      if (u === `${P}/back`) return (current = [KEPT]), (out = []), { ok: true, space: spaceOf() };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => times("/api/space/p1") === 1, "the Space read");
    /** What the crumb says: the page shown besides the Board, and whether its ⌄ offers others. */
    const crumb = () => [host.querySelector(".sp-crumb-app").hidden ? "" : host.querySelector(".sp-crumb-app").textContent, host.querySelector(".sp-crumb-go").hidden === false];
    // (fails before: yes — the owner's idea of 10-29: its apps were tabs on the page, beside New app…) Nothing added: the
    // Board alone, no ⌄ (SG-D0).
    await until(() => host.querySelector(".sp-crumb-go").hidden === true, "the crumb, the Space read");
    assert.deepEqual(crumb(), ["", false]);
    // Add to this Space… offers what extends it; App… opens ＋ New app's sheet, nothing sent. Routine… and, last, What do
    // you look after… since S6; its connectors, plugins and skills are ⋯'s since the reshape of 10-29.
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["New app…", "Import app…", "Routine…", "Watcher…", "What do you look after…"]);
    // (fails before: yes — phase 4: no app came from a .zip) Import app… asks for the .zip, nothing sent.
    const picker = host.querySelector(".sp-import");
    let picked = 0;
    picker.click = () => picked++;
    items[1].dispatch("click");
    assert.deepEqual([picked, did.words, picker.getAttribute("accept")], [1, [], ".zip,application/zip"]);
    // (fails before: yes — HarnessV4_Skills_Plan S1-6: a Space had no way to its skills) ⋯ › Skills… opens Library ›
    // Skills with this place picked.
    const was = /** @type {any} */ (globalThis).location;
    /** @type {any} */ (globalThis).location = { hash: "" };
    (await menuOf(host.querySelector(".sp-settings"), "⋯")).find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Skills…").dispatch("click");
    assert.equal(/** @type {any} */ (globalThis).location.hash, "#/library/skills");
    assert.deepEqual(takeJump((s) => s === "skills"), { section: "skills", start: "project:p1" });
    /** @type {any} */ (globalThis).location = was;
    // App… opens ＋ New app's sheet (10-29): one box and the starters; nothing fills the Start until its press.
    items[0].dispatch("click");
    const newApp = doc.document.body.querySelector(".snew-sheet");
    assert.ok(newApp, "the New app sheet");
    assert.deepEqual(did.words, []);
    newApp.querySelector(".sdb-keep-foot .ghost").dispatch("click");
    // A chat publishes one: the Space reads again and shows its draft.
    current = [DRAFT];
    hear({ type: "artifact", name: "deploys-ab12", v: 1, title: "Deploys" });
    await until(() => crumb()[1], "⌄, a page besides the Board");
    // ⌄ lists the Board and it; its press shows it alone, in the Board's place, and the address names it — its row in the
    // left bar is marked by it, and Back returns to it.
    const loc = /** @type {any} */ (globalThis).location;
    /** @type {any} */ (globalThis).location = { hash: "#/space/p1", replace(/** @type {string} */ u) { this.hash = u; } };
    const pages = await menuOf(host.querySelector(".sp-crumb-go"), "⌄");
    assert.deepEqual(pages.map((/** @type {any} */ i) => [i.querySelector(".zc-menu-text").textContent, i.getAttribute("aria-checked")]), [["Board", "true"], ["Deploys", "false"]]);
    pages[1].dispatch("click");
    assert.equal(/** @type {any} */ (globalThis).location.hash, "#/space/p1/deploys-ab12");
    /** @type {any} */ (globalThis).location = loc;
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".sp-head").hidden, host.querySelector(".sdb-view").hidden], [true, true, false], "its page alone");
    assert.deepEqual(crumb(), ["Deploys", true], "r › Space › Deploys");
    assert.deepEqual(did.frames, [["deploys-ab12", "Deploys", "/r"]]);
    assert.equal(host.querySelector(".sdb-bar-words").textContent, "Draft · sample rows the agent read · nothing reads or runs until you keep it");
    assert.equal(host.querySelector(".sdb-foot").textContent, "Would read deploys by itself, once you keep it");
    // Keep…: every line Filament's; Not now leaves it; Keep keeps the version looked at.
    host.querySelector(".sdb-keep").dispatch("click");
    const sheetEl = doc.document.body.querySelector(".sdb-keep-sheet");
    assert.ok(sheetEl, "the Keep sheet");
    assert.equal(sheetEl.querySelector(".sp-sheet-title").textContent, "Keep “Deploys” in r's Space?");
    assert.deepEqual(texts(sheetEl, ".sdb-keep-h"), ["Reads by itself", "Shows"]);
    // (fails before: yes — found by the Designer, 10-29: it said "As a tab", though a Space's apps are rows in the left bar)
    assert.equal(texts(sheetEl, ".sdb-keep-line").at(-1), "On its own page, a row under r's Space in the left bar");
    assert.deepEqual([texts(sheetEl, ".sdb-cmd"), texts(sheetEl, ".sdb-folder")], [["npx wrangler deployments list --json"], ["/r"]]);
    assert.deepEqual(posted, [], "nothing kept on opening it");
    sheetEl.querySelector(".sdb-keep-go").dispatch("click");
    await until(() => posted.length === 1, "Keep");
    assert.deepEqual(posted, [{ url: `${P}/keep`, body: { v: 1 } }]);
    await until(() => host.querySelector(".sdb-fault"), "kept, its failure");
    // Kept, failing: the failure's words, its rows' time (its row's red dot is the left bar's: space-bar.test.js); Read
    // again runs it, Fix fills the Start.
    assert.deepEqual(crumb(), ["Deploys", true]);
    assert.equal(host.querySelector(".sdb-bar").getAttribute("class"), "sdb-bar is-fault");
    assert.equal(host.querySelector(".sdb-fault-said").textContent, "npx exited 1: You are not authenticated.");
    // Its day too when that was before midnight.
    assert.match(host.querySelector(".sdb-fault-kept").textContent, /^Showing what it read at (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d\.$/);
    const acts = host.querySelectorAll(".sdb-fault-acts button");
    acts[1].dispatch("click");
    await until(() => posted.length === 2, "Read again");
    assert.deepEqual(posted[1], { url: `${P}/read`, body: { source: "deploys" } });
    acts[0].dispatch("click");
    assert.match(String(did.words.at(-1)?.[1]), /^The dashboard “Deploys” \(artifact deploys-ab12\) in r's Space couldn't read its source deploys: npx exited 1: You are not authenticated\. /);
    assert.deepEqual(did.frames, [["deploys-ab12", "Deploys", "/r"], ["again", "deploys-ab12"]], "its frame made once for the tab, loaded again once kept: its page learns it reads as it loads");
    // A later version that changes a command: a draft beside the live one; See v1 shows that one reading, See v2 the draft.
    current = [{ ...KEPT, v: 2, draft: true, newest: { sources: { deploys: { command: [...command, "--all"], every: 2 * MIN } }, watch: [], actions: {} } }];
    hear({ type: "artifact", name: "deploys-ab12", v: 2, title: "Deploys" });
    await until(() => host.querySelector(".sdb-see"), "See v1");
    assert.deepEqual([host.querySelector(".sdb-see").textContent, host.querySelector(".sdb-fault")], ["See v1", null], "the draft shown: no failure of the live one over it");
    // Its bar says the live one fails, though, as its row's dot does (fails before: yes — found by the Hunter on S2).
    assert.equal(host.querySelector(".sdb-bar").getAttribute("class"), "sdb-bar is-fault");
    assert.match(host.querySelector(".sdb-bar-words").textContent, /^Draft · v2 changes what it reads, watches or runs · v1: deploys not read since (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d$/);
    host.querySelector(".sdb-see").dispatch("click");
    assert.match(host.querySelector(".sdb-bar-words").textContent, /^v1 · deploys not read since (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d$/);
    assert.ok(host.querySelector(".sdb-fault"), "the live one's failure, with it");
    assert.equal(host.querySelector(".sdb-see").textContent, "See v2");
    host.querySelector(".sdb-see").dispatch("click");
    assert.deepEqual(did.frames.filter((f) => f[0] !== "repaint").slice(2), [["again", "deploys-ab12"], ["version", "deploys-ab12", 1], ["again", "deploys-ab12"]], "the draft's newest, its live version, the draft again");
    current = [KEPT];
    hear({ type: "artifact", name: "deploys-ab12", v: 1, title: "Deploys" });
    await until(() => !host.querySelector(".sdb-see"), "kept again: nothing beside it");
    // Back from the Start, its address: the same page. The Space's own address is its Board, whatever was shown last
    // (fails before: yes — the owner's idea of 10-29: the last tab was kept, and the Space's row opened on it).
    const back = mountSpace(lookOf({}), { tab: "deploys-ab12" });
    await until(() => back.host.querySelector(".sp-crumb-app").textContent === "Deploys" && back.host.querySelector(".sdb-view").hidden === false, "its page, drawn again");
    stops.pop()?.();
    const bare = mountSpace(lookOf({}));
    await until(() => bare.host.querySelector(".sp-crumb-go").hidden === false, "the Space read");
    assert.deepEqual([bare.host.querySelector(".sp-overview").hidden === true, bare.host.querySelector(".sp-crumb-app").hidden], [false, true], "the Board");
    stops.pop()?.();
    // ⋯: Pause, What it may do, Show on Your Space (S5b: off, and said why, where it has no status tile), Change with an
    // agent…, Open in Artifacts, Remove from this Space.
    const more = await menuOf(host.querySelector(".sdb-more"), "the tab's ⋯");
    assert.deepEqual(more.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Pause", "What it may do", "Show on Home", "Change with an agent…", "Open in Artifacts", "Remove from this Space"]);
    assert.deepEqual([more[2].getAttribute("disabled"), more[2].querySelector(".zc-menu-desc").textContent], ["", "It has no status tile reading its own sources: At a glance shows those"]);
    more[4].dispatch("click");
    assert.deepEqual(did.artifacts, ["deploys-ab12"]);
    const again = await menuOf(host.querySelector(".sdb-more"), "the tab's ⋯ again");
    again[5].dispatch("click");
    sheetButton("Remove").dispatch("click");
    await until(() => posted.length === 3, "Remove");
    assert.deepEqual(posted[2], { url: P, body: null });
    await until(() => host.querySelector(".sp-crumb-go").hidden === true, "its page gone with it");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".sp-head").hidden, host.querySelector(".sdb-view").hidden], [false, false, true], "back to the Board");
    // Its way back: Add to this Space… puts it back as it was kept, its page shown.
    const add = await menuOf(host.querySelector(".sp-add"), "Add to this Space… after Remove");
    assert.deepEqual(add.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["New app…", "Import app…", "Routine…", "Watcher…", "Put back “Deploys”", "What do you look after…"]);
    add[4].dispatch("click");
    await until(() => posted.length === 4, "Put back");
    assert.deepEqual(posted[3], { url: `${P}/back`, body: null });
    await until(() => !host.querySelector(".sdb-view").hidden, "its page, shown");
    assert.deepEqual(crumb(), ["Deploys", true]);
  });

  // The owner's of 11-04: Summarize, an app's button, "opened new task with a chat message in the compose" in a project
  // that was not the Space's, and "some automated agentic work … could run on that model without users having to open a
  // chat". The head says what the Space's agents run on, a press away from its Space settings; an app's ask goes as the
  // Space says — its sheet by default, Run it here posting the run; at once where the Space runs them at once; the
  // Start in the Space itself, never another place, where it opens a chat.
  // (fails before: yes — an app's ask filled the Start, from a Space of your own after asking where to run it, and a
  // Space had no model of its own to say or to run on)
  test("a Space's agents: its head says what they run on and opens Space settings; an app's ask runs here from its sheet, at once, or opens the Start here", async () => {
    const at = Date.now();
    const PULSE = { name: "pulse-cd34", title: "Pulse", type: "app", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: null,
      newest: { sources: {}, watch: [], actions: {} }, reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    let runsOn = /** @type {any} */ ({ model: "brain-a", effort: "high", from: "default", asks: "ask", asksFrom: "" });
    let settings = /** @type {any} */ ({});
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [PULSE], gone: [], settings, runsOn });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/settings" && method === "PATCH") {
        settings = { model: "brain-b" };
        runsOn = { ...runsOn, model: "brain-b", effort: "", from: "space" };
        return { ok: true, settings, space: spaceOf() };
      }
      if (u === "/api/space/p1/asks" && method === "POST") return { ok: true, chain: "ask7", on: "brain-a · high", space: spaceOf() };
      return modelProblem(u);
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}, {}, []), { tab: "pulse-cd34", cb: { catalogue: { models: () => [{ id: "brain-a", upstream: "m" }, { id: "brain-b", upstream: "m" }] } } });
    const runsEl = /** @type {any} */ (await until(() => (host.querySelector(".sp-runs-on")?.hidden === false ? host.querySelector(".sp-runs-on") : null), "what its agents run on"));
    assert.equal(runsEl.textContent, "Its agents run on named brain-a · High, from Settings › Space");
    // ⋯ offers Space settings… first; the line opens the same sheet.
    const more = await menuOf(host.querySelector(".sp-settings"), "⋯");
    assert.equal(more[0].querySelector(".zc-menu-label-line").textContent, "Space settings…");
    doc.document.body.querySelector(".zc-menu")?.remove();
    runsEl.dispatch("click");
    const sheetEl = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".sps-sheet").at(-1), "Space settings"));
    assert.equal(sheetEl.querySelector(".sps-why").textContent, "From Settings › Space, as every Space without its own");
    assert.deepEqual(sheetEl.querySelectorAll(".sps-asks option").map((/** @type {any} */ o) => o.textContent)[0], "As Settings › Space: ask me first: run it here, or open a chat");
    sheetEl.querySelector(".sp-model .model-chip").onclick({ stopPropagation() {} });
    // The real picker's menu: brain-b picked.
    const pick = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".mp-row").find((/** @type {any} */ r) => /brain-b|Brain B/i.test(r.textContent)), "the picker's rows"));
    pick.dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/space/p1/settings"), "saved");
    assert.deepEqual(posted.find((p) => p.url === "/api/space/p1/settings")?.body, { model: "brain-b", effort: "" });
    await until(() => sheetEl.querySelector(".sps-why").textContent.startsWith("This Space's own"), "drawn from the answer");
    await until(() => runsEl.textContent === "Its agents run on named brain-b", "the head too");
    sheetEl.querySelector(".sps-done").dispatch("click");
    // An app's ask, asked first (the default): its sheet, the words, the Space's model; Run it here posts the run.
    runsOn = { model: "brain-a", effort: "high", from: "default", asks: "ask", asksFrom: "" };
    settings = {};
    hear({ type: "space", project: "p1", seq: 9 });
    await until(() => runsEl.textContent === "Its agents run on named brain-a · High, from Settings › Space", "read again");
    const ask = did.more.at(-1).ask;
    assert.equal(typeof ask, "function", "the frame's asks go through the Space");
    ask("Summarize the team's work on 2026-11-03.\nSave it in the worklog.");
    const askEl = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".sak-sheet").at(-1), "the ask's sheet"));
    assert.equal(askEl.querySelector(".sp-sheet-title").textContent, "Pulse asks an agent");
    assert.equal(askEl.querySelector(".sak-words").textContent, "Summarize the team's work on 2026-11-03.\nSave it in the worklog.");
    const go = askEl.querySelector(".sak-run");
    await until(() => !go.disabled, "its model checked");
    assert.deepEqual(did.words, [], "nothing in a chat's box");
    go.dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/space/p1/asks"), "run here");
    assert.deepEqual(posted.find((p) => p.url === "/api/space/p1/asks")?.body, { words: "Summarize the team's work on 2026-11-03.\nSave it in the worklog.", app: "Pulse", model: "brain-a", effort: "high" });
    await until(() => toasts().some(([t]) => t.startsWith("Pulse's ask runs in the background on named brain-a · High")), "said, with Open");
    // At once, where the Space runs an app's asks at once: no sheet.
    runsOn = { ...runsOn, asks: "run", asksFrom: "space" };
    hear({ type: "space", project: "p1", seq: 10 });
    await new Promise((r) => setTimeout(r, 300));
    const sheets = doc.document.body.querySelectorAll(".sak-sheet").length;
    const asked = posted.filter((p) => p.url === "/api/space/p1/asks").length;
    did.more.at(-1).ask("Again");
    // One at a time (the review of 11-04): the page asking again while its ask starts is let go, and said.
    did.more.at(-1).ask("And again");
    await until(() => posted.filter((p) => p.url === "/api/space/p1/asks").length === asked + 1, "run at once");
    assert.equal(doc.document.body.querySelectorAll(".sak-sheet").length, sheets, "no sheet");
    assert.ok(toasts().some(([t]) => t === "Pulse asked again while its ask is starting: one at a time"));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(posted.filter((p) => p.url === "/api/space/p1/asks").length, asked + 1, "the second let go");
    // A chat, where the Space opens one: the Start in the Space's own folder.
    runsOn = { ...runsOn, asks: "chat" };
    hear({ type: "space", project: "p1", seq: 11 });
    await new Promise((r) => setTimeout(r, 300));
    did.more.at(-1).ask("Open it");
    assert.deepEqual(did.words.at(-1), ["/r", "Open it"]);
  });

  // The Space Apps plan of 10-29, phase 4: the apps a project's folder brings under .filament/apps/, not here yet, are
  // in Add to this Space…, each a draft on its press, its tab shown; a folder that cannot be read asks nothing more.
  // (fails before: yes — a repo's apps were not offered)
  test("Add to this Space… offers the apps the project's folder brings; one pressed is a draft, its tab shown", async () => {
    const at = Date.now();
    const PULSE = { name: "pulse-cd34", title: "Pulse", type: "app", v: 1, state: "draft", keptV: null, liveV: null, draft: true, paused: false, keptAt: null, grant: null,
      newest: { sources: {}, watch: [], actions: {} }, reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    /** @type {any[]} */
    let current = [];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: current, gone: [] });
    let folderFails = false;
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/folder-apps" && method === "GET") {
        if (folderFails) throw new Error("the folder could not be read");
        return { apps: current.length ? [] : [{ folder: ".filament/apps/pulse", title: "Pulse", description: "How the team is doing" }] };
      }
      if (u === "/api/space/p1/folder-apps") return (current = [PULSE]), { ok: true, name: "pulse-cd34", v: 1, title: "Pulse", space: spaceOf() };
      if (u === "/api/artifacts/pulse-cd34/newest") return { ok: true, v: 3 };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => times("/api/space/p1") === 1, "the Space read");
    const labels = (/** @type {any[]} */ items) => items.map((i) => i.querySelector(".zc-menu-label-line").textContent);
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    assert.deepEqual(labels(items).slice(0, 4), ["New app…", "Import app…", "“Pulse” from this project's folder", "Routine…"]);
    assert.equal(items[2].querySelector(".zc-menu-desc").textContent, ".filament/apps/pulse · How the team is doing · a draft: nothing runs until you keep it");
    assert.deepEqual(posted, [], "nothing added on opening it");
    items[2].dispatch("click");
    await until(() => posted.length === 1, "added");
    assert.deepEqual(posted, [{ url: "/api/space/p1/folder-apps", body: { folder: ".filament/apps/pulse" } }]);
    await until(() => host.querySelector(".sp-crumb-app").textContent === "Pulse" && host.querySelector(".sdb-view").hidden === false, "its page, shown");
    assert.ok(toasts().some(([t]) => t === "“Pulse” is a draft here: nothing runs until you keep it"));
    assert.deepEqual(did.words, [], "no chat asked");
    // (fails before: yes — driven: v2's page failed before the Space read that v2 was there, and its line never offered
    // Back to v1) Its frame is told the version before the one shown, its line drawn again as the Space reads; Back
    // publishes that one again, as the newest.
    assert.equal(did.more.at(-1).app, true, "a game's frame");
    assert.equal(did.more.at(-1).back(), null, "v1: nothing before it");
    current = [{ ...PULSE, v: 2 }];
    hear({ type: "space", project: "p1", seq: 2 });
    await until(() => did.frames.some((f) => f[0] === "repaint" && f[1] === "pulse-cd34"), "its line drawn again");
    assert.equal(did.more.at(-1).back(2).v, 1, "read: the one before it");
    // (fails before: yes — driven: for a moment it offered Back to v2 under v3's page, the broken one itself) The frame
    // told of v3 before the Space has read it: no way back yet.
    assert.equal(did.more.at(-1).back(3), null, "the Space reads v2 still");
    const back = did.more.at(-1).back(null);
    assert.equal(back.v, 1);
    back.go();
    await until(() => posted.length === 2, "Back to v1");
    assert.deepEqual(posted[1], { url: "/api/artifacts/pulse-cd34/newest", body: { v: 1 } });
    await until(() => toasts().some(([t]) => t === "v1 of Pulse is the newest again"), "said");
    // Added, it is not offered again; and where the folder cannot be read, the menu opens without them.
    const shut = async () => {
      host.querySelector(".sp-add").dispatch("click");
      await until(() => !doc.document.body.querySelector(".zc-menu"), "the menu closed again");
    };
    await until(() => !doc.document.body.querySelector(".zc-menu"), "the menu closed by its press");
    assert.deepEqual(labels(await menuOf(host.querySelector(".sp-add"), "again")).slice(0, 3), ["New app…", "Import app…", "Routine…"]);
    await shut();
    folderFails = true;
    assert.deepEqual(labels(await menuOf(host.querySelector(".sp-add"), "a folder not read")).slice(0, 3), ["New app…", "Import app…", "Routine…"]);
    await shut();
  });

  // (fails before: yes — found reviewing: the crumb's Space and ⌄ replaced the address, so after the bar's Pulse and the
  // crumb's Space two entries were the Board and Back did nothing; and a page left before its Space was read still wrote
  // its app into the address of the page after it, which then showed that app)
  test("the crumb's Space and ⌄ are moves Back undoes; a page left before its Space is read leaves the address alone", async () => {
    const at = Date.now();
    const PULSE = { name: "pulse-cd34", title: "Pulse", type: "app", v: 1, state: "draft", keptV: null, liveV: null, draft: true, paused: false, keptAt: null, grant: null,
      newest: { sources: {}, watch: [], actions: {} }, reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [PULSE], gone: [] });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const g = /** @type {any} */ (globalThis);
    const was = g.location;
    /** @type {string[]} */
    const moves = [];
    let hash = "#/space/p1/pulse-cd34";
    g.location = { get hash() { return hash; }, set hash(/** @type {string} */ u) { hash = u; moves.push(`push ${u}`); }, replace(/** @type {string} */ u) { hash = u; moves.push(`replace ${u}`); } };
    try {
      // Pulse's address, left at once for the Space's own: the first page's read lands after the second's address.
      const left = mountSpace(lookOf({}), { tab: "pulse-cd34" });
      stops.pop()?.();
      hash = "#/space/p1";
      const { host, space } = mountSpace(lookOf({}));
      await until(() => host.querySelector(".sp-crumb-go").hidden === false, "the Space read");
      await until(() => left.host.querySelector(".sp-crumb-go").hidden === false, "the page left, read too");
      assert.deepEqual([hash, moves], ["#/space/p1", []], "the page left wrote nothing");
      // Pulse from the bar (its address the bar's), then the crumb's Space, then ⌄ › Pulse: each a move of its own.
      hash = "#/space/p1/pulse-cd34";
      space.show("pulse-cd34");
      assert.equal(host.querySelector(".sp-crumb-app").textContent, "Pulse");
      host.querySelector(".sp-crumb-page").dispatch("click");
      assert.equal(host.querySelector(".sp-crumb-app").hidden, true, "the Board, shown at once");
      const pages = await menuOf(host.querySelector(".sp-crumb-go"), "⌄");
      pages[1].dispatch("click");
      assert.deepEqual(moves, ["push #/space/p1", "push #/space/p1/pulse-cd34"], "each a move Back undoes");
      assert.equal(host.querySelector(".sp-crumb-app").textContent, "Pulse", "shown at once, the address heard or not");
    } finally {
      g.location = was;
    }
  });

  // HarnessV4_Space_Plan S6: its Routines. No tab until a routine or a kept watch is (SG-D0); Add to this Space… ›
  // Routine… fills the Start; a proposed one's Switch on… sheet says all it will do, and only its Switch on switches it
  // on; Run now; ⋯ Remove with Put back; Pause all behind its word; a failed run red with Fix…, and once in Needs you
  // here with Fix… and Open; When something arrives; When you press Run with Run…; Pause all heard from any Space.
  // (fails before: yes — a Space had no routines)
  test("its Routines: the tab once one is; Switch on…, Run now, ⋯ Remove and Put back; Pause all; a failure's Fix… and Open; watches and how-tos", async () => {
    const at = Date.now();
    /** @param {Record<string, any>} [o] */
    const words = (o = {}) => ({ when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "",
      skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "Mon 27 Oct 09:00", ...moreWords(), ...o });
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.\nWrite the brief.", writes: false, state: "proposed", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", last: null, words: words() };
    /** @type {any[]} */
    let routines = [];
    /** @type {number | null} */
    let pausedSince = null;
    /** @type {any[]} */
    let watches = [];
    /** @type {any[]} */
    let needs = [];
    const runsOf = () => ({ head: routines.some((r) => r.state === "on" && !r.paused) ? "Runs by itself: 1 routine · next: Morning brief at 09:00" : "", pausedSince, routines, watches });
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs, runs: runsOf() });
    const P = "/api/space/p1/routines/r1";
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [{ id: 7, goal: "release", steps: 3, text: "How to release: 1. tag 2. push 3. deploy", at, from: "Release 1.7" }] };
      if (u === `${P}/on`) return (routines = [{ ...R, state: "on" }]), { ok: true, space: spaceOf() };
      if (u === `${P}/run`) return { ok: true, chain: "c99", space: spaceOf() };
      if (u === P && method === "DELETE") return (routines = [{ ...routines[0], state: "removed" }]), { ok: true, space: spaceOf() };
      if (u === `${P}/back`) return (routines = [{ ...routines[0], state: "on" }]), { ok: true, space: spaceOf() };
      if (u === "/api/spaces/pause") return (pausedSince = at), { ok: true, pausedSince };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => times("/api/space/p1") === 1, "the Space read");
    /** Whether the Space shows a page besides its Board: ⌄ in its crumb, and its row in the left bar. */
    const beside = () => host.querySelector(".sp-crumb-go").hidden === false;
    await until(() => host.querySelector(".sp-crumb-go").hidden === true, "the crumb, the Space read");
    assert.equal(beside(), false, "no routine, no watch: no Routines (SG-D0)");
    // Add to this Space… › Routine…: the Start, its box begun; nothing sent.
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    items[2].dispatch("click");
    assert.deepEqual(did.words, [["/r", "Make a routine for r's Space — work an agent does by itself at a time I switch on: "]]);
    // An agent proposes one: the Space reads again, and its Routines are there — its address shows them.
    routines = [R];
    hear({ type: "space", project: "p1", seq: 2 });
    await until(beside, "Routines, there");
    space.show("@routines");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".srt").hidden, host.querySelector(".sp-crumb-app").textContent], [true, false, "Routines"], "Routines over the Board");
    const row = () => host.querySelector('.srt-row[data-routine="r1"]');
    assert.deepEqual([row().querySelector(".srt-t").textContent, row().querySelector(".srt-f").textContent, row().querySelector(".srt-task").textContent, row().querySelector(".srt-go").textContent],
      ["Morning briefProposed", "weekdays at 09:00 · reads only", "Read what came in.", "Switch on…"]);
    assert.equal(host.querySelector(".srt-head-words").textContent, "Nothing runs by itself yet.");
    assert.equal(host.querySelector(".srt-pause").hidden, true, "nothing on: no Pause all");
    // When you press Run: memory's how-tos of the project; Run… fills the Start, nothing runs.
    await until(() => host.querySelector(".srt-row.is-press"), "the how-tos");
    assert.equal(host.querySelector(".srt-row.is-press .srt-t").textContent, "How to release");
    host.querySelector(".srt-row.is-press .srt-go").dispatch("click");
    assert.match(String(did.words.at(-1)?.[1]), /^Do this now in r, as memory keeps it — stop and ask me before any step that pushes, deploys or sends: How to release: 1\. tag/);
    // Switch on…: everything it will do; nothing switched on until its Switch on.
    row().querySelector(".srt-go").dispatch("click");
    const sheetEl = doc.document.body.querySelector(".srt-sheet");
    assert.ok(sheetEl, "its sheet");
    assert.equal(sheetEl.querySelector(".sp-sheet-title").textContent, "Switch on “Morning brief”?");
    assert.deepEqual(texts(sheetEl, ".sdb-keep-h"), ["What it does", "When", "What it may do", "Runs on", "Made in"]);
    assert.deepEqual(texts(sheetEl, ".srt-sheet-v").slice(0, 3), ["Read what came in.\nWrite the brief.", "weekdays at 09:00 · its first time: Mon 27 Oct 09:00", "Reads only: it changes no file and sends nothing"]);
    // Runs on: the picker on its chat's model, whose it is said (the owner's word of 10-31).
    assert.deepEqual([sheetEl.querySelector(".sp-model .model-chip")?.getAttribute("aria-label"), sheetEl.querySelector(".srt-model-why").textContent], ["The model “Morning brief” runs on", "The model on main ran on when it proposed it"]);
    await until(() => !(/** @type {any} */ (sheetEl.querySelector(".srt-on")).disabled), "its model checked");
    assert.deepEqual(posted, [], "nothing on, on opening it");
    sheetEl.querySelector(".srt-on").dispatch("click");
    await until(() => posted.length === 1, "Switch on");
    assert.deepEqual(posted, [{ url: `${P}/on`, body: {} }]);
    await until(() => row()?.querySelector(".srt-go").textContent === "Run now", "on: Run now");
    assert.equal(host.querySelector(".srt-pause").hidden, false, "on: Pause all");
    // Run now: the press; its chat said, with Open.
    row().querySelector(".srt-go").dispatch("click");
    await until(() => posted.length === 2, "Run now");
    assert.deepEqual(posted[1], { url: `${P}/run`, body: {} });
    await until(() => toasts().some(([t]) => t.startsWith("“Morning brief” runs now, in a chat of its own")), "its toast");
    // ⋯: Run now, Pause, What it does, Remove — with its way back in Add to this Space….
    const more = await menuOf(row().querySelector(".srt-more"), "its ⋯");
    assert.deepEqual(more.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Run now", "Pause", "What it does", "Remove"]);
    more[3].dispatch("click");
    sheetButton("Remove").dispatch("click");
    await until(() => posted.length === 3, "Remove");
    assert.deepEqual(posted[2], { url: P, body: null });
    await until(() => !beside(), "its page gone with it");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".srt").hidden], [false, true], "back to the Board");
    const add = await menuOf(host.querySelector(".sp-add"), "Add to this Space… after Remove");
    assert.deepEqual(add.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["New app…", "Import app…", "Routine…", "Watcher…", "Put back “Morning brief”", "What do you look after…"]);
    add[4].dispatch("click");
    await until(() => posted.length === 4, "Put back");
    assert.deepEqual(posted[3], { url: `${P}/back`, body: {} });
    await until(beside, "its page, back");
    // Pause all, behind its word: one switch, and its confirm says it pauses every Space (the bug hunt of 10-30, UISP-1).
    space.show("@routines");
    host.querySelector(".srt-pause").dispatch("click");
    sheetButton("Pause every Space").dispatch("click");
    await until(() => posted.length === 5, "Pause all");
    assert.deepEqual(posted[4], { url: "/api/spaces/pause", body: { on: true } });
    await until(() => host.querySelector(".srt-pause").textContent === "Resume", "Resume, in its place");
    assert.equal(host.querySelector(".srt-head").getAttribute("class"), "srt-head is-paused");
    // A failed run: red on its row with Fix…, a dot on its row in the left bar (space-bar.test.js), and once in Needs you
    // here with Fix… and Open.
    pausedSince = null;
    routines = [{ ...R, state: "on", last: { at, chain: "c98", by: "time", state: "failed", why: "GitHub: sign-in expired" },
      words: words({ tone: "bad", last: "last: today 09:00 · failed: GitHub: sign-in expired", ran: "today 09:00", why: "GitHub: sign-in expired" }) }];
    needs = [{ id: "n5", kind: "routine", text: "“Morning brief” failed: GitHub: sign-in expired", why: "a routine of this Space, run at its time, 09:00", dashboard: "", title: "Morning brief",
      routine: { id: "r1", chain: "c98" }, at, state: "open" }];
    // Pause all's word reaches every Space: "*".
    hear({ type: "space", project: "*", seq: 0 });
    await until(() => host.querySelector(".srt-fix"), "Fix… on its row");
    assert.equal(row().getAttribute("class"), "srt-row is-bad");
    host.querySelector(".srt-fix").dispatch("click");
    assert.match(String(did.words.at(-1)?.[1]), /^“Morning brief”, a routine of r's Space, failed \(today 09:00\): GitHub: sign-in expired\. Find out why/);
    // The crumb's Space: back to the Board.
    assert.equal(host.querySelector(".sp-crumb-page").getAttribute("class"), "sp-crumb-page is-link");
    host.querySelector(".sp-crumb-page").dispatch("click");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".srt").hidden, host.querySelector(".sp-crumb-app").hidden, host.querySelector(".sp-crumb-page").getAttribute("class")],
      [false, true, true, "sp-crumb-page"]);
    const need = host.querySelector('.sp-need.is-routine[data-need="n5"]');
    assert.ok(need, "its row in Needs you here");
    // Its heading says whose the row is: no dashboard found it.
    // (fails before: yes — seen at S6's live look: a failed run alone was "what its dashboards found")
    assert.equal(host.querySelector(".sp-needs-sec").querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent, "its routines' failed runs");
    assert.deepEqual(need.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.textContent), ["Fix…", "Open", "Not now", ""]);
    need.querySelectorAll(".sp-need-acts button")[0].dispatch("click");
    assert.match(String(did.words.at(-1)?.[1]), /^“Morning brief”, a routine of r's Space, failed \(run at its time, 09:00\): GitHub: sign-in expired\./);
    need.querySelectorAll(".sp-need-acts button")[1].dispatch("click");
    assert.equal(did.opened.at(-1), "c98", "Open: the chat it ran in");
    // Its chip opens the Routines tab.
    need.querySelector(".sp-need-src").dispatch("click");
    assert.equal(host.querySelector(".srt").hidden, false, "its chip: Routines");
    // When something arrives: a kept dashboard's watch, no AI until something is new.
    watches = [{ project: "p1", dashboard: "deploys-ab12", title: "Deploys", key: "w1", rule: "a new row of runs where status is failure", to: "Needs you", every: "10 min", paused: false,
      last: at, nextAt: at + 600_000, lastWords: "today 14:20", nextWords: "today 14:30" }];
    hear({ type: "space", project: "p1", seq: 3 });
    await until(() => host.querySelector('.srt-row[data-watch="w1"]'), "the watch's row");
    const w = host.querySelector('.srt-row[data-watch="w1"]');
    assert.deepEqual([w.querySelector(".srt-t").textContent, w.querySelector(".srt-f").textContent, w.querySelector(".srt-last").textContent, w.querySelector(".srt-next").textContent],
      ["a new row of runs where status is failure → Needs you", "Deploys · every 10 min", "last: today 14:20", "next: today 14:30"]);
    // Its project archived (s-itself, 11-12): where its next look would be said, why it has none, whole and on a line
    // of its own, as a routine's row says it.
    // (fails before: yes — the row said "next: " before whatever Filament sent)
    const ARCHIVED = "its project is archived: nothing in it runs by itself until you bring it back";
    watches = [{ ...watches[0], nextAt: null, nextWords: ARCHIVED, archived: true }];
    hear({ type: "space", project: "p1", seq: 4 });
    await until(() => host.querySelector('.srt-row[data-watch="w1"]').querySelectorAll(".srt-last").length === 2, "the archived watch's row");
    const wa = host.querySelector('.srt-row[data-watch="w1"]');
    assert.deepEqual([wa.querySelectorAll(".srt-last").map((/** @type {any} */ x) => x.textContent), wa.querySelector(".srt-next")], [["last: today 14:20", ARCHIVED], null]);
  });

  // The plan of 11-11, its w5: Switch on is a press of what the sheet showed. It sends the routine's `at`; where its
  // chat changed it since, the refusal is said, the Space is drawn as it stands, and the sheet opens again on what the
  // routine does now — whose Switch on sends the new `at`.
  // (fails before: yes — Switch on sent {}, and a routine its chat changed under an open sheet was switched on unread)
  test("Switch on sends what its sheet showed; refused where its chat changed it since, the sheet opens again on what it does now", async () => {
    const at = Date.now();
    /** @param {Record<string, any>} [o] */
    const words = (o = {}) => ({ when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "",
      skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "Mon 27 Oct 09:00", ...moreWords(), ...o });
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "proposed", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", at: 100, last: null, words: words() };
    // What its chat made of it while the sheet stood open: it writes now.
    const R2 = { ...R, task: "Read what came in, and push the brief.", writes: true, at: 200, words: words({ may: "writes", allowed: "Writes: it changes files in a copy of its own" }) };
    /** @type {any[]} */
    let routines = [R];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], runs: { head: "", pausedSince: null, routines, watches: [] } });
    const P = "/api/space/p1/routines/r1";
    const MOVED = "“Morning brief” was changed by its chat since you read it: read what it does now, then switch it on.";
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      if (u === `${P}/on`) {
        // The store's rule (services/spaces.js `routineOn`): the press is of the routine as it was read.
        if (posted.at(-1)?.body?.at !== routines[0].at) return new Refusal(409, MOVED, { moved: true, space: spaceOf() });
        routines = [{ ...routines[0], state: "on" }];
        return { ok: true, space: spaceOf() };
      }
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "Routines, there");
    space.show("@routines");
    const row = () => host.querySelector('.srt-row[data-routine="r1"]');
    row().querySelector(".srt-go").dispatch("click");
    const sheets = () => doc.document.body.querySelectorAll(".srt-sheet");
    const first = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual(texts(first, ".srt-sheet-v").slice(0, 3), ["Read what came in.", "weekdays at 09:00 · its first time: Mon 27 Oct 09:00", "Reads only: it changes no file and sends nothing"]);
    await until(() => !(/** @type {any} */ (first.querySelector(".srt-on")).disabled), "its model checked");
    // Its chat changes it; the page has not heard yet. The press is refused, and nothing is on.
    routines = [R2];
    first.querySelector(".srt-on").dispatch("click");
    await until(() => toasts().some(([t]) => t === MOVED), "the refusal, said");
    assert.deepEqual(posted, [{ url: `${P}/on`, body: { at: 100 } }], "the press says what was read");
    assert.equal(routines[0].state, "proposed", "nothing switched on");
    // The sheet stands again, on what the routine does now.
    await until(() => sheets().length === 1 && sheets().at(-1) !== first, "the sheet, again");
    const second = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual(texts(second, ".srt-sheet-v").slice(0, 3), ["Read what came in, and push the brief.", "weekdays at 09:00 · its first time: Mon 27 Oct 09:00", "Writes: it changes files in a copy of its own"]);
    assert.equal(row().querySelector(".srt-f").textContent, "weekdays at 09:00 · writes", "its row too, from the refusal's Space");
    await until(() => !(/** @type {any} */ (second.querySelector(".srt-on")).disabled), "its model checked again");
    second.querySelector(".srt-on").dispatch("click");
    await until(() => posted.length === 2, "Switch on, of what was read now");
    assert.deepEqual(posted[1], { url: `${P}/on`, body: { at: 200 } });
    await until(() => row()?.querySelector(".srt-go").textContent === "Run now", "on: Run now");
    assert.equal(sheets().length, 0, "taken: the sheet closed");
  });

  // The review of w5's fixes: Run now says what it does for the watcher it is of. One that wakes the chat that proposed
  // it runs in no chat of its own: its ⋯ and its toast say a turn in that chat. One that tells only you runs nothing —
  // the server refuses its Run now —, so none is offered. A watcher's row stands on the Space's Watchers page (the plan
  // of 11-11, its w8): Run now is in its ⋯, Pause is its switch, and the words of each press are the server's.
  // (fails before: yes — every Run now said "Once, now: a new chat, as at its time" and "runs now, in a chat of its
  // own", and a watcher that tells only you had the button)
  test("Run now of a watcher says what it does: a turn in the chat that proposed it; none is offered where it tells only you", async () => {
    const at = Date.now();
    /** @param {Record<string, any>} [o] */
    const words = (o = {}) => ({ when: "after each turn of on feature", may: "wakes on main · its turn held to reading", allowed: "A turn in on main, held to reading: it changes no file and runs no command that changes one, whatever that chat's own permissions", last: "", tone: "", said: "", ran: "", why: "",
      skipped: "", next: "", nextAt: null, first: "", ...o });
    const TRIGGER = { kind: "turn", chat: "c21", turns: "changed", every: 1 };
    /** What each press does, as the server says it of a watcher by whom it wakes. @param {string} wakes */
    const more = (wakes) => moreWords({ trigger: TRIGGER, wakes, madeIn: "c20", madeBy: "on main" });
    const W = { id: "r1", title: "Supervisor", when: "", task: "Read its turn.", writes: false, trigger: TRIGGER, wakes: "chat", state: "on", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", at, last: null, words: words(more("chat")) };
    const routines = [W, { ...W, id: "r2", title: "Deploy watch", wakes: "you", words: words({ may: "tells only you, in Needs you · runs nothing", allowed: "Runs nothing: what it hears is told to you, in Needs you", ...more("you") }) }];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], runs: { head: "", pausedSince: null, routines, watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      if (u === "/api/space/p1/routines/r1/run") return { ok: true, chain: "c20", space: spaceOf() };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "Watchers, there");
    space.show("@watchers");
    const row = (/** @type {string} */ id) => host.querySelector(`.swt-row[data-watcher="${id}"]`);
    // The one that wakes its chat: Run now, a turn there.
    const TURN = "Once, now: a turn of its own in on main, with what it heard";
    const its = await menuOf(row("r1").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(its.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Run now", "What it does", "Remove"]);
    assert.equal(its[0].querySelector(".zc-menu-desc").textContent, TURN);
    its[0].dispatch("click");
    await until(() => posted.length === 1, "Run now");
    assert.deepEqual(posted[0], { url: "/api/space/p1/routines/r1/run", body: {} });
    await until(() => toasts().some(([t]) => t.startsWith("“Supervisor” looks now, in a turn of its own in on main")), "its toast");
    assert.ok(!toasts().some(([t]) => t.startsWith("“Supervisor” runs now, in a chat of its own")), "no chat of its own");
    // The one that tells only you: nothing to run, so no Run now in its ⋯.
    const told = await menuOf(row("r2").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(told.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["What it does", "Remove"]);
    // What it does: its sheet's foot names where its presses are, no Run now among them.
    told[0].dispatch("click");
    assert.equal(doc.document.body.querySelectorAll(".srt-sheet").at(-1)?.querySelector(".sdb-keep-foot .sp-quiet").textContent, "Its switch pauses it; Remove is in the ⋯ on its row.");
    assert.deepEqual(did.opened, [], "nothing opened by itself");
  });

  // The plan of 11-11, its w6a: the page says what a watcher is, by whom it wakes. Watchers stand on a page of their
  // own (its w8: Space › Watchers), never under On a schedule; a sheet's lead says what waking does — a turn in the
  // chat that proposed it, a row in Needs you, or a new chat —; only one that wakes a new chat has a model to choose,
  // and Switch on waits for none otherwise; a paused watcher's switch says it listens again.
  // (fails before: yes — a watcher stood under "On a schedule · each run a new chat here"; its sheet said "it runs by
  // itself at its times, each run a new chat of r" with Runs on whatever it woke, its Switch on held until a model's
  // check answered; Resume said "It runs at its times again")
  test("a watcher is listed apart from what runs on a schedule; its sheet says what waking does, with a model to choose only where it wakes a new chat; Resume says it listens again", async () => {
    const at = Date.now();
    /** @param {Record<string, any>} [o] */
    const words = (o = {}) => ({ when: "after each turn of on feature", may: "wakes on main · its turn held to reading", allowed: "A turn in on main, held to reading: it changes no file and runs no command that changes one, whatever that chat's own permissions", last: "", tone: "", said: "", ran: "", why: "",
      skipped: "", next: "", nextAt: null, first: "", ...o });
    const TRIGGER = { kind: "turn", chat: "c21", turns: "changed", every: 1 };
    /** What each press does, as the server says it of a watcher by whom it wakes. @param {string} wakes */
    const more = (wakes) => moreWords({ trigger: TRIGGER, wakes, madeIn: "c20", madeBy: "on main" });
    const W = { id: "r1", title: "Supervisor", when: "", task: "Read its turn.", writes: false, trigger: TRIGGER, wakes: "chat", state: "proposed", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", at, last: null, words: words(more("chat")) };
    const RUNS = { runsOn: { model: "glm-5.3", effort: "", from: "proposed" }, spaceOn: { model: "", effort: "", from: "" } };
    const routines = [
      W,
      { ...W, id: "r2", title: "Deploy watch", wakes: "you", words: words({ may: "tells only you, in Needs you · runs nothing", allowed: "Runs nothing: what it hears is told to you, in Needs you", ...more("you") }) },
      { ...W, id: "r3", title: "Triage", wakes: "new", modelBy: "you", ...RUNS, runsOn: { model: "glm-5.3", effort: "", from: "routine" }, words: words({ may: "reads only · wakes a new chat each time", allowed: "Reads only: it changes no file and sends nothing", ...more("new") }) },
      { ...W, id: "r4", title: "Morning brief", when: "weekdays 09:00", trigger: undefined, wakes: undefined, state: "on", paused: true, ...RUNS,
        words: words({ when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", next: "paused: it runs when you resume it", ...moreWords() }) },
      { ...W, id: "r5", title: "Night watch", state: "on", paused: true, words: words({ next: "paused: it listens again once you resume it", ...more("chat") }) },
    ];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], runs: { head: "", pausedSince: null, routines, watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      if (u === "/api/space/p1/routines/r1/on") return { ok: true, space: spaceOf() };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "Routines and Watchers, there");
    // Each on its own page: a watcher is woken by what it watches, never at a time.
    /** @param {string} name */
    const part = (name) => host.querySelectorAll(".srt-sec").find((/** @type {any} */ s) => s.getAttribute("aria-label") === name);
    space.show("@routines");
    assert.deepEqual([part("On a schedule")?.querySelectorAll(".srt-row").map((/** @type {any} */ r) => r.getAttribute("data-routine")), texts(part("On a schedule"), ".sp-sec-count"), part("On an event")],
      [["r4"], ["1"], undefined], "the routine at times alone; no part for watchers there");
    assert.equal(host.querySelector(".srt .swt-row"), null);
    /** A routine's ⋯ Resume, as it says it; a second press on its ⋯ closes the menu. */
    const resumeOfRoutine = async () => {
      const dots = host.querySelector('.srt-row[data-routine="r4"] .srt-more');
      const items = await menuOf(dots, "its ⋯");
      const desc = items.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent === "Resume").querySelector(".zc-menu-desc").textContent;
      dots.dispatch("click");
      return desc;
    };
    const timed = await resumeOfRoutine();
    space.show("@watchers");
    assert.deepEqual([host.querySelector(".swt").hidden, host.querySelector(".srt").hidden], [false, true]);
    assert.deepEqual(host.querySelectorAll(".swt-row").map((/** @type {any} */ r) => r.getAttribute("data-watcher")), ["r1", "r2", "r3", "r5"]);
    const row = (/** @type {string} */ id) => host.querySelector(`.swt-row[data-watcher="${id}"]`);
    const sheets = () => doc.document.body.querySelectorAll(".srt-sheet");
    const checks = () => asked.filter((u) => u.includes("/subagents/model-problem")).length;
    /** A proposed one's sheet, opened from its row. @param {string} id */
    const sheetOf = (id) => {
      row(id).querySelector(".swt-go").dispatch("click");
      return /** @type {any} */ (sheets().at(-1));
    };
    /** A sheet's Not now. @param {any} s */
    const notNow = (s) => s.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").dispatch("click");
    const REST = " This is everything it will do; a change by its chat switches it off until you switch it on again.";
    // The chat that proposed it: a turn there, on that chat's own model — none to choose, none to wait for.
    const mine = sheetOf("r1");
    assert.equal(mine.querySelector(".sdb-keep-lead").textContent, `Once you switch it on, when what it watches happens, Filament starts a turn in on main.${REST}`);
    assert.deepEqual(texts(mine, ".sdb-keep-h"), ["What it does", "When", "What it may do", "Made in"], "no Runs on: it runs on that chat's model");
    assert.deepEqual([mine.querySelector(".sp-model"), !!mine.querySelector(".srt-on").disabled, checks()], [null, false, 0], "Switch on waits for no model");
    mine.querySelector(".srt-on").dispatch("click");
    await until(() => posted.length === 1, "Switch on");
    assert.deepEqual(posted[0], { url: "/api/space/p1/routines/r1/on", body: { at } });
    await until(() => sheets().length === 0, "taken: the sheet closed");
    // Only you: nothing runs.
    const told = sheetOf("r2");
    assert.equal(told.querySelector(".sdb-keep-lead").textContent, `Once you switch it on, when what it watches happens, Filament tells you in Needs you: nothing runs.${REST}`);
    assert.deepEqual([texts(told, ".sdb-keep-h"), !!told.querySelector(".srt-on").disabled, checks()], [["What it does", "When", "What it may do", "Made in"], false, 0]);
    notNow(told);
    // A new chat each time: as a routine's run, on a model the person may choose, which Switch on waits for.
    // (fails before: yes — its lead had no verb: "when what it watches happens, each run a new chat of r")
    const fresh = sheetOf("r3");
    assert.equal(fresh.querySelector(".sdb-keep-lead").textContent, `Once you switch it on, when what it watches happens, Filament runs it, each run a new chat of r.${REST}`);
    assert.deepEqual(texts(fresh, ".sdb-keep-h"), ["What it does", "When", "What it may do", "Runs on", "Made in"]);
    await until(() => checks() === 1 && !fresh.querySelector(".srt-on").disabled, "its model checked");
    // The model the person chose for it is this watcher's, in the words the server says of what it is.
    // (fails before: yes — "Your choice for this routine")
    assert.equal(fresh.querySelector(".srt-model-why").textContent, "Your choice for this watcher");
    notNow(fresh);
    // Resume: a watcher listens again — its switch's word, off while it is paused —; a routine at times runs at its
    // times again.
    const sw = row("r5").querySelector(".set-switch");
    assert.deepEqual([sw.getAttribute("aria-checked"), sw.getAttribute("title")], ["false", "It listens again; what happened while it was paused is not made up"]);
    assert.equal(timed, "It runs at its times again; the ones it was paused through are not made up");
    // What it does, for one on: the same lead, of what it does now.
    const its = await menuOf(row("r5").querySelector(".swt-more"), "its ⋯");
    its.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent === "What it does").dispatch("click");
    assert.equal(/** @type {any} */ (sheets().at(-1)).querySelector(".sdb-keep-lead").textContent, "When what it watches happens, Filament starts a turn in on main. This is everything it does; a change by its chat switches it off until you switch it on again.");
  });

  // (fails before: yes — a failed watcher's Fix… wrote "failed (a watcher of this Space, woken by what it watches at
  // 09:10)": only a routine's "a routine of this Space, " was taken off its reason)
  test("a failed watcher's Fix… says when it failed without saying twice what it is", async () => {
    const at = Date.now();
    const needs = [{ id: "n8", kind: "routine", text: "“Supervisor” failed: the chat it wakes (on main) needs compacting before it can take a turn", why: "a watcher of this Space, woken by what it watches at 09:10", dashboard: "", title: "Supervisor",
      routine: { id: "r1", chain: "" }, at, state: "open" }];
    // The Space says the watcher itself, as it says every routine it keeps: its row in Needs you is a watcher's by it,
    // and its Fix… says "a watcher".
    const TRIGGER = { kind: "turn", chat: "c21", turns: "changed", every: 1 };
    const W = { id: "r1", title: "Supervisor", when: "", task: "Read its turn.", writes: false, trigger: TRIGGER, wakes: "chat", state: "on", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", at, last: null,
      words: { when: "after each turn of on feature", may: "wakes on main · its turn held to reading", allowed: "A turn in on main, held to reading", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "",
        ...moreWords({ trigger: TRIGGER, wakes: "chat", madeIn: "c20", madeBy: "on main" }) } };
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs, runs: { head: "", pausedSince: null, routines: [W], watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector('.sp-need[data-need="n8"]'), "its row");
    const fix = host.querySelector('.sp-need[data-need="n8"]').querySelectorAll(".sp-need-acts button").find((/** @type {any} */ b) => b.textContent === "Fix…");
    assert.ok(fix, "its Fix…");
    fix.dispatch("click");
    assert.match(String(did.words.at(-1)?.[1]), /^“Supervisor”, a watcher of r's Space, failed \(woken by what it watches at 09:10\): the chat it wakes \(on main\) needs compacting before it can take a turn\. Find out why, and fix it — its words, what it watches, or what it needs; propose the watcher again where it changes: $/);
  });

  // The plan of 11-11, its w5: what a watcher that tells only the person heard is a row of Needs you — news, no failed
  // run: under "what its watchers heard", its chip Watchers, how many it heard and when, and neither Fix… nor Open (no
  // chat ran).
  // (fails before: yes — it was drawn as a routine's failed run: red, "why: …", with Fix… building "… failed" words)
  test("what a watcher that tells only you heard: its row in Needs you is news, not a failed run", async () => {
    const at = Date.now();
    const needs = [{ id: "n7", kind: "routine", text: "“Deploy watch” heard: 2 new commits on main: a1b2c3d Fix the build", why: "A watcher that tells only you · 3 events, the newest at 14:20", dashboard: "", title: "Deploy watch",
      routine: { id: "r4", chain: "", told: 3, heard: "2 new commits on main: a1b2c3d Fix the build" }, at, state: "open" }];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs, runs: { head: "", pausedSince: null, routines: [], watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector('.sp-need[data-need="n7"]'), "its row");
    const need = host.querySelector('.sp-need[data-need="n7"]');
    assert.equal(need.getAttribute("class"), "sp-need is-out is-told", "news: no failure's red");
    assert.equal(host.querySelector(".sp-needs-sec").querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent, "what its watchers heard");
    assert.deepEqual([need.querySelector(".sp-need-t").textContent, need.querySelector(".sp-need-src").textContent, need.querySelector(".sp-need-why").textContent],
      ["“Deploy watch” heard: 2 new commits on main: a1b2c3d Fix the build", "Watchers", "A watcher that tells only you · 3 events, the newest at 14:20"]);
    assert.deepEqual(need.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.textContent), ["Not now", ""], "no chat ran: nothing to fix or open");
    assert.deepEqual(did.words, [], "and nothing written into a Start");
  });

  // The plan of 11-11, its w6: a watcher's guidance past what Filament sends by itself waits for the person in Needs
  // you — a watcher's row, no failed run: whom it would guide and why it waits, its words whole, and Send it.
  // (fails before: yes — nothing held a guidance; a row with one would have drawn as a routine's failed run, with Fix…)
  test("a watcher's guidance held for you: its row in Needs you shows its words whole, and Send it sends that one", async () => {
    const at = Date.now();
    const words = "You drifted: the parser, not the lexer.\nRead the person's first message again.";
    const needs = [{ id: "n8", kind: "routine", text: "“Supervisor” would guide Build the login flow again: “You drifted: the parser, not the lexer.”", why: "3 sent since you last wrote there, the most Filament sends by itself", dashboard: "", title: "Supervisor",
      routine: { id: "r4", chain: "", guide: { id: "g9", to: "c2", name: "Build the login flow", text: words } }, at, state: "open" }];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs, runs: { head: "", pausedSince: null, routines: [], watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/needs/n8/guide" && method === "POST") return { ok: true, how: "turn", text: "Sent to Build the login flow as a turn of its own.", space: spaceOf() };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector('.sp-need[data-need="n8"]'), "its row");
    const need = host.querySelector('.sp-need[data-need="n8"]');
    assert.equal(need.getAttribute("class"), "sp-need is-out is-told", "a watcher's, no failure's red");
    assert.equal(host.querySelector(".sp-needs-sec").querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent, "what its watchers would tell a chat");
    assert.deepEqual([need.querySelector(".sp-need-t").textContent, need.querySelector(".sp-need-src").textContent, need.querySelector(".sp-need-why").textContent, need.querySelector(".sp-need-guide").textContent],
      ["“Supervisor” would guide Build the login flow again: “You drifted: the parser, not the lexer.”", "Watchers", "3 sent since you last wrote there, the most Filament sends by itself", words]);
    assert.deepEqual(need.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.textContent), ["Send it", "Not now", ""], "no chat ran: nothing to fix or open");
    const before = posted.length;
    need.querySelector(".sp-need-guide-send").dispatch("click");
    await until(() => posted.length > before, "its press");
    assert.deepEqual(posted.slice(before), [{ url: "/api/space/p1/needs/n8/guide", body: {} }]);
    assert.deepEqual(did.words, [], "and nothing written into a Start");
  });

  // The owner's word of 10-31: the agents, and the models they run on, are the person's. A routine's sheet shows the
  // model its runs start on — its chat's as it proposed it, with its provider — on the picker; a pick is saved at once,
  // a refusal shows the one before it again, Use the default is its Space's model (the owner's of 11-04), and Switch on
  // waits for a model that can run.
  // (fails before: yes — Runs on was words, the model its chat proposed it on, which nobody could change)
  test("a routine's sheet: Runs on is the picker on its model, saying whose it is; a pick saved, a refusal undone; Switch on waits for a model that can run", async () => {
    const { routineSheet } = await import("../src/ui/harness/space/routine-sheet.js");
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: /** @type {const} */ ("proposed"), paused: false, madeIn: "c1", madeBy: "Release",
      madeName: "Release", model: "brain-a", project: "p1", at: 1, last: null,
      words: { when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "Mon 27 Oct 09:00", ...moreWords() } };
    /** @type {any[]} */
    const pickers = [];
    const modelSelect = pickerStandIn(pickers);
    serve = (u) => modelProblem(u);
    /** @type {string[]} */
    const chosen = [];
    let switched = 0;
    const catalogue = { models: () => [{ id: "brain-a", upstream: "m", upstreamName: "Brainworks" }, { id: "brain-b", upstream: "n" }] };
    // The server refuses a model that cannot run (`POST …/routines/:id/model`).
    const chooseModel = async (/** @type {string} */ m) => (chosen.push(m), m !== "brain-x");
    routineSheet({ r: R, place: "app", switchOn: async () => (switched++, true), chooseModel, catalogue, modelSelect, space: { model: "brain-s", effort: "", from: "default" } });
    const sheetEl = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
    const why = () => sheetEl.querySelector(".srt-model-why").textContent;
    const via = () => (sheetEl.querySelector(".sp-model-at").hidden ? "" : sheetEl.querySelector(".sp-model-at").textContent);
    assert.deepEqual([pickers[0].name(), via(), why()], ["brain-a", "via Brainworks", "The model Release ran on when it proposed it"], "its chat's, with its provider");
    const on = sheetEl.querySelector(".srt-on");
    await until(() => !on.disabled, "its model checked");
    assert.deepEqual(chosen, [], "nothing saved on opening it");
    pickers[0].pick("brain-b");
    await until(() => chosen.length === 1 && why() === "Your choice for this routine", "a pick, saved");
    assert.deepEqual([chosen, pickers[0].name(), via()], [["brain-b"], "brain-b", "via n"]);
    pickers[0].pick("brain-x");
    await until(() => chosen.length === 2 && pickers[0].name() === "brain-b", "refused: the one before it again");
    assert.equal(why(), "Your choice for this routine");
    pickers[0].cb.onUseDefault();
    await until(() => chosen.length === 3 && why() === "Every Space's model, from Settings › Space", "Use the default: its Space's model");
    assert.deepEqual([chosen[2], pickers[0].name(), via()], ["", "brain-s", ""]);
    await until(() => !on.disabled, "Switch on, with its Space's model");
    on.dispatch("click");
    await until(() => switched === 1, "switched on");
    // A model that cannot run now — its chat's, gone — is said, and Switch on waits for another.
    const goneSheet = routineSheet({ r: { ...R, model: "brain-x" }, place: "app", switchOn: async () => (switched++, true), chooseModel, catalogue, modelSelect });
    const gone = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
    await until(() => gone.querySelector(".srt-model-why").textContent === "Can't run now: no provider of yours serves it", "said");
    assert.equal(gone.querySelector(".srt-on").disabled, true, "Switch on waits");
    pickers.at(-1).pick("brain-a");
    await until(() => !gone.querySelector(".srt-on").disabled, "another that can");
    assert.equal(gone.querySelector(".srt-model-why").textContent, "Your choice for this routine");
    // The person's, chosen before: said as theirs.
    const mineSheet = routineSheet({ r: { ...R, model: "brain-b", modelBy: /** @type {const} */ ("you") }, place: "app", readOnly: true, chooseModel, catalogue, modelSelect });
    const mine = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
    assert.equal(mine.querySelector(".srt-model-why").textContent, "Your choice for this routine");
    // No model at all — none chosen, none in Settings › Space —: said, and Switch on waits for one (11-04).
    const noneSheet = routineSheet({ r: { ...R, model: "", modelBy: /** @type {const} */ ("you") }, place: "app", switchOn: async () => (switched++, true), chooseModel, catalogue, modelSelect });
    const none = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
    assert.deepEqual([none.querySelector(".srt-model-why").textContent, none.querySelector(".srt-on").disabled], ["No model yet: choose one, or set one for every Space in Settings › Space", true]);
    noneSheet.close();
    goneSheet.close();
    mineSheet.close();
  });

  // The owner's of 11-12: a watcher is proposed in the chat, whose card under the call stands the sheet's parts in its
  // own place. The view draws them with no sheet, and says why it lets go of itself; in the chat that made it, Made in
  // would name that chat itself, and Ask for a change… says the ask goes in this chat's box.
  // (fails before: yes — the sheet's parts were drawn only into a sheet of its own)
  test("a routine's sheet as a view: no sheet of its own, each way it lets go said; in the chat that made it, no Made in", async () => {
    const { routineView } = await import("../src/ui/harness/space/routine-sheet.js");
    const R = { id: "r1", title: "Main moved", when: "", task: "Read the new commits.", writes: false, trigger: { kind: "commit" }, wakes: /** @type {const} */ ("you"), state: /** @type {const} */ ("proposed"), paused: false,
      madeIn: "c1", madeBy: "Release", madeName: "Release", model: "", project: "p1", at: 1, last: null,
      words: { when: "on each new commit on main", may: "reads only", allowed: "Runs nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "", told: "nothing runs", ...moreWords() } };
    const sheets = doc.document.body.querySelectorAll(".srt-sheet").length;
    /** @type {string[]} */
    const why = [];
    /** @type {string[]} */
    const opened = [];
    /** @type {string[][]} */
    const asked = [];
    let switched = 0;
    const v = /** @type {any} */ (routineView({ r: R, place: "app", switchOn: async () => (switched++, true), done: (w) => void why.push(w), openChat: (c) => void opened.push(c), askChat: (c, words) => void asked.push([c, words]) }));
    assert.equal(doc.document.body.querySelectorAll(".srt-sheet").length, sheets, "no sheet of its own");
    assert.deepEqual([v.title, v.head.textContent], ["Switch on “Main moved”?", "Switch on “Main moved”?"]);
    assert.deepEqual(v.body.querySelectorAll("h4").map((/** @type {any} */ x) => x.textContent), ["What it does", "When", "What it may do", "Made in"]);
    assert.deepEqual(v.foot.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Ask for a change…", "Not now", "Switch on"]);
    /** @type {any} */ (v.body.querySelector(".srt-made")).dispatch("click");
    assert.deepEqual([why, opened], [["chat"], ["c1"]]);
    v.foot.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").dispatch("click");
    v.foot.querySelector(".srt-ask").dispatch("click");
    assert.deepEqual([why, asked.map(([c]) => c)], [["chat", "leave", "ask"], ["c1"]]);
    const on = /** @type {any} */ (v.foot.querySelector(".srt-on"));
    assert.equal(on.disabled, false, "a watcher that tells only you waits for no model");
    on.dispatch("click");
    await until(() => why.length === 4, "switched on");
    assert.deepEqual([switched, why.at(-1)], [1, "on"]);
    v.close();
    // In the chat that made it.
    const mine = /** @type {any} */ (routineView({ r: R, place: "app", here: "c1", askChat: () => {} }));
    assert.deepEqual(mine.body.querySelectorAll("h4").map((/** @type {any} */ x) => x.textContent), ["What it does", "When", "What it may do"], "no Made in");
    assert.equal(mine.foot.querySelector(".srt-ask").getAttribute("title"), "Your ask in this chat's box: nothing is sent until you send it");
    assert.ok(/** @type {any} */ (routineView({ r: R, place: "app", here: "c9" })).body.querySelectorAll("h4").some((/** @type {any} */ x) => x.textContent === "Made in"), "another chat's: Made in names it");
  });

  // (fails before: yes — the bug hunt of 10-30, a Low of UISP: a read of memory's how-tos that failed was dropped without
  // a word, so When you press Run stayed away as if memory kept none)
  test("Routines: a read of the how-tos that fails is said in When you press Run; read again, its how-to and no failure", async () => {
    const at = Date.now();
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "on", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", last: null,
      words: { when: "weekdays at 09:00", may: "reads only", allowed: "", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "", ...moreWords() } };
    let refuse = true;
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET")
        return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [],
          runs: { head: "Runs by itself: 1 routine", pausedSince: null, routines: [R], watches: [] } };
      if (u === "/api/space/p1/procedures") return refuse ? new Refusal(500, "memory is busy") : { procedures: [{ id: 7, goal: "release", steps: 3, text: "How to release: 1. tag 2. push 3. deploy", at, from: "Release 1.7" }] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, space } = mountSpace(lookOf({}));
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "its Routines there");
    space.show("@routines");
    const said = /** @type {any} */ (await until(() => (host.querySelector(".srt-press-said")?.hidden === false ? host.querySelector(".srt-press-said") : null), "the failure, said"));
    assert.equal(said.textContent, "The how-tos could not be read: memory is busy");
    assert.equal(said.closest(".srt-sec").hidden, false, "When you press Run is there to say it");
    // Shown again, the read goes through: its how-to, and no word of a failure.
    refuse = false;
    space.show("overview");
    space.show("@routines");
    await until(() => host.querySelector(".srt-row.is-press"), "the how-tos");
    assert.equal(said.hidden, true);
    assert.equal(host.querySelector(".srt-row.is-press .srt-t").textContent, "How to release");
  });

  // The owner's word of 10-31: the model a routine runs on is the person's to see. A row is drawn again only where its
  // words moved, and its sheet opens on the routine as the Space says it now — a model its chat proposed it on since,
  // its words the same, or the person's pick saved from another sheet — never on the row as it was drawn.
  // (fails before: yes — found by the review of 10-31: the sheet opened on brain-a after the Space said brain-c, so
  // Switch on ran a model the person never saw)
  test("Routines: a routine's sheet opens on it as the Space says it now — the model its chat proposed it on since, or the person's pick", async () => {
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "proposed", paused: false,
      madeIn: "c20", madeBy: "on main", madeName: "on main", model: "brain-a", project: "p1", last: null,
      words: { when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "Mon 27 Oct 09:00", ...moreWords() } };
    let routine = /** @type {any} */ (R);
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET")
        return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [],
          runs: { head: "", pausedSince: null, routines: [routine], watches: [] } };
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      return modelProblem(u);
    };
    for (const stop of stops.splice(0)) stop();
    const { host, space } = mountSpace(lookOf({}));
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "its Routines there");
    space.show("@routines");
    const row = () => host.querySelector('.srt-row[data-routine="r1"]');
    const drawnRow = row();
    /** Switch on…'s sheet: the model its picker is on, and whose it says it is; closed with Not now. */
    const sheetSays = () => {
      row().querySelector(".srt-go").dispatch("click");
      const s = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
      const got = [String(s.querySelector(".sp-model .model-chip").title).split(" · ")[0], s.querySelector(".srt-model-why").textContent];
      s.querySelector(".sdb-keep-foot .ghost").dispatch("click");
      return got;
    };
    assert.deepEqual(sheetSays(), ["brain-a", "The model on main ran on when it proposed it"]);
    /** The Space read again, as the stream says it moved. @param {any} next */
    const readAgain = async (next) => {
      routine = next;
      const before = times("/api/space/p1");
      hear({ type: "space", project: "p1", seq: before + 1 });
      await until(() => times("/api/space/p1") > before, "the Space read again");
      await new Promise((r) => setTimeout(r, 20));
    };
    // Its chat proposes it again on another model, its words as they were.
    await readAgain({ ...R, model: "brain-c" });
    assert.equal(row(), drawnRow, "its words did not move: its row stands as drawn");
    assert.deepEqual(sheetSays(), ["brain-c", "The model on main ran on when it proposed it"]);
    // The person's pick, saved from another sheet.
    await readAgain({ ...R, model: "brain-b", modelBy: "you" });
    assert.deepEqual(sheetSays(), ["brain-b", "Your choice for this routine"]);
    // What the Space says it runs on now (11-04): its Space's model, over the one its chat proposed it on.
    await readAgain({ ...R, model: "brain-c", runsOn: { model: "brain-s", effort: "high", from: "space" }, spaceOn: { model: "brain-s", effort: "high", from: "space" } });
    assert.deepEqual(sheetSays(), ["brain-s", "This Space's model, from its Space settings"]);
  });

  // The owner's of 11-04: "a proper model picker with efforts selection too". The effort sits beside the model, offering
  // the levels that model takes; a level picked is saved with its model, a model that takes none hides it, and Use the
  // default shows the Space's own model at its effort.
  test("a routine's sheet: the effort beside its model, the levels that model takes; saved with its model; Use the default is its Space's at its effort", async () => {
    const { routineSheet } = await import("../src/ui/harness/space/routine-sheet.js");
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: /** @type {const} */ ("proposed"), paused: false, madeIn: "c1", madeBy: "Release",
      madeName: "Release", model: "brain-a", project: "p1", at: 1, last: null, runsOn: { model: "brain-a", effort: "high", from: /** @type {const} */ ("space") },
      words: { when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "Mon 27 Oct 09:00", ...moreWords() } };
    /** @type {any[]} */
    const pickers = [];
    serve = (u) => modelProblem(u);
    /** @type {[string, string][]} */
    const chosen = [];
    const member = (/** @type {string} */ id) => ({ id, effort: null, speed: null, thinking: null, window: null });
    const catalogue = {
      models: () => [{ id: "brain-a", upstream: "m" }, { id: "brain-b", upstream: "n" }],
      families: () => [
        { id: "brain-a", upstream: "m", kind: "model", members: [member("brain-a")], effort: { via: "setting", levels: ["none", "low", "medium", "high", "max"], default: "high" }, speed: null, thinking: null, window: null },
        { id: "brain-b", upstream: "n", kind: "model", members: [member("brain-b")], effort: null, speed: null, thinking: null, window: null },
      ],
    };
    const sheet = routineSheet({ r: R, place: "app", switchOn: async () => true, chooseModel: async (m, e) => (chosen.push([m, e]), true), catalogue, modelSelect: pickerStandIn(pickers),
      space: { model: "brain-a", effort: "high", from: "space" }, nameOf: (m) => m.toUpperCase() });
    const el = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-sheet").at(-1));
    // (fails before: yes — the owner's of 11-06, a model chosen anywhere on a picker, never a list of names: the effort
    // was a <select>; now the agents' chip, as Library's, a flow's and the pool's)
    const chip = el.querySelector(".sp-model .ec");
    const said = () => chip.querySelector(".ec-words").textContent;
    /** The chip's menu, opened: its choices' words, the one on, and a press on one. */
    const choices = () => {
      chip.dispatch("click");
      return /** @type {any[]} */ (/** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)).querySelectorAll('[role="menuitemradio"]'));
    };
    const words = (/** @type {any} */ r) => (r.querySelector(".zc-menu-label-line") || r.querySelector(".zc-menu-text")).textContent;
    const why = () => el.querySelector(".srt-model-why").textContent;
    assert.equal(el.querySelectorAll("select").length, 0, "no list of levels");
    const rows = choices();
    assert.deepEqual([chip.hidden, rows.map(words), words(rows.find((r) => r.getAttribute("aria-checked") === "true")), said(), why()],
      [false, ["The default: The model's own", "Low", "Medium", "High", "Max"], "High", "High", "This Space's model, from its Space settings"], "the levels it takes, none left out but none; its default the model's own");
    assert.equal(pickers[0].cb.defaultDesc, "This Space's model: BRAIN-A · high");
    rows.find((r) => words(r) === "Max")?.dispatch("click");
    await until(() => chosen.length === 1, "a level, saved");
    assert.deepEqual([chosen[0], why(), said()], [["brain-a", "max"], "Your choice for this routine", "Max"]);
    pickers[0].pick("brain-b");
    await until(() => chosen.length === 2, "another model, saved");
    assert.deepEqual([chosen[1], chip.hidden], [["brain-b", ""], true], "it takes no effort: none saved, none shown");
    pickers[0].cb.onUseDefault();
    await until(() => chosen.length === 3, "Use the default, saved");
    assert.deepEqual([chosen[2], pickers[0].name(), chip.hidden, said(), why()], [["", ""], "brain-a", false, "High", "This Space's model, from its Space settings"]);
    sheet.close();
    // A level a Space keeps none of (the review of 11-04): "minimal" is never offered, nor fitted to.
    const { fitEffort, levelsOf } = await import("../src/ui/harness/space/model-row.js");
    const lean = { models: () => [], families: () => [{ ...catalogue.families()[0], effort: { via: "setting", levels: ["minimal", "medium", "high"] } }] };
    assert.deepEqual([levelsOf(lean, "brain-a"), fitEffort(lean, "brain-a", "low")], [["medium", "high"], "medium"]);
  });

  // (fails before: yes — the review of 5ff8bcb56: the tour's chip, never driven for real, offered only the levels a
  // Space keeps, so a model's Minimal read as Auto)
  test("the model row's tuning chip: every level the model takes; a pick told, never kept as a new chat's tuning; hidden where it takes none, held with the row", async () => {
    const { modelRow } = await import("../src/ui/harness/space/model-row.js");
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    /** What the person's tuning keeps: nothing written. @type {Map<string, string>} */
    const kept = new Map();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)) } });
    try {
      const member = (/** @type {string} */ id) => ({ id, effort: null, speed: null, thinking: null, window: null });
      const catalogue = {
        models: () => [{ id: "brain-a", upstream: "m" }, { id: "brain-b", upstream: "m" }],
        families: () => [
          { id: "brain-a", upstream: "m", kind: "model", members: [member("brain-a")], effort: { via: "setting", levels: ["minimal", "low", "high"], capWithoutThinking: "low" }, speed: { options: ["standard", "fast"] }, thinking: { via: "setting" }, window: null },
          { id: "brain-b", upstream: "m", kind: "model", members: [member("brain-b")], effort: null, speed: null, thinking: null, window: null },
        ],
      };
      /** @type {string[]} */
      const picked = [];
      const row = modelRow({ named: "New chats start on", catalogue, modelSelect: pickerStandIn([]), onPick: () => {}, effort: { tuning: true, named: "How hard it thinks", onPick: (l) => picked.push(l) } });
      const host = /** @type {any} */ (h("div", {}, row.row));
      doc.document.body.append(host);
      row.show("brain-a", "", "minimal");
      const tip = host.querySelector(".effort");
      const chip = tip.querySelector("button");
      assert.deepEqual([tip.classList.contains("hidden"), tip.querySelector(".tune-label").textContent, row.effort(), chip.getAttribute("aria-label")], [false, "Minimal", "minimal", "How hard it thinks"]);
      chip.onclick({ stopPropagation() {} });
      const pop = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-popover").at(-1));
      assert.deepEqual(pop.querySelectorAll(".tp-level").map((/** @type {any} */ b) => b.getAttribute("aria-label")), ["Minimal", "Low", "High"], "every level the model takes, None and Minimal too");
      assert.deepEqual([pop.querySelector('[data-key="speed"]'), pop.querySelector('[data-key="thinking"]'), pop.querySelector(".tp-foot")], [null, null, null], "the effort alone, no foot");
      pop.querySelectorAll(".tp-level").find((/** @type {any} */ b) => b.getAttribute("aria-label") === "High")?.dispatch("click");
      assert.deepEqual([picked, row.effort(), [...kept.keys()]], [["high"], "high", []], "told the caller, never kept as the tuning a new chat starts from");
      chip.onclick({ stopPropagation() {} });
      row.show("brain-b", "", "");
      assert.deepEqual([tip.classList.contains("hidden"), row.effort()], [true, ""], "a model that takes none: none shown");
      row.show("brain-a", "", "low");
      row.hold("its run is at work");
      assert.equal(chip.disabled, true, "held with the row");
      host.remove();
    } finally {
      if (had) Object.defineProperty(globalThis, "localStorage", had);
      else delete (/** @type {any} */ (globalThis)).localStorage;
    }
  });

  // The owner's of 11-04: "a section inside settings called Space … one of those setting would be Space default model
  // which is optional". Settings › Space reads its defaults, offers the model with its effort, what an app's ask does,
  // Pause all, and the Spaces that chose their own — each change sent as it is made, and drawn from the answer.
  test("Settings › Space: the model for Spaces with its effort, what an app's ask does, Pause all, and the Spaces with their own — each saved as it changes", async () => {
    const { renderSpaceSettings } = await import("../src/ui/harness/settings/space.js");
    const member = (/** @type {string} */ id) => ({ id, effort: null, speed: null, thinking: null, window: null });
    let defaults = /** @type {any} */ ({ model: "brain-a", effort: "high" });
    /** @type {[string, string, any][]} */
    const calls = [];
    const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/models?all=1") return { models: [{ id: "brain-a", upstream: "m" }, { id: "brain-b", upstream: "n" }], families: [
        { id: "brain-a", upstream: "m", kind: "model", members: [member("brain-a")], effort: { via: "setting", levels: ["low", "medium", "high", "max"] }, speed: null, thinking: null, window: null },
        { id: "brain-b", upstream: "n", kind: "model", members: [member("brain-b")], effort: null, speed: null, thinking: null, window: null }] };
      if (path === "/agent-accounts") return { agents: [] };
      if (path === "/spaces/settings" && !init.method) return { settings: defaults, spaces: [{ project: "p7", name: "Northwind", own: true, settings: { model: "brain-b", asks: "run" } }], pausedSince: null };
      if (path === "/spaces/settings" && init.method === "PATCH") {
        defaults = { ...defaults, ...init.body };
        for (const k of Object.keys(defaults)) if (defaults[k] === "") delete defaults[k];
        return { ok: true, settings: defaults };
      }
      if (path === "/spaces/pause") return { ok: true, pausedSince: init.body.on ? 1_800_000_000_000 : null };
      if (path === "/space/p7/settings") return { ok: true, settings: {} };
      return undefined;
    };
    serve = (u) => modelProblem(u);
    /** @type {any[]} */
    const pickers = [];
    const body = /** @type {any} */ (h("div", { class: "settings-body" }));
    doc.document.body.append(body);
    renderSpaceSettings(body, {}, { api, modelSelect: pickerStandIn(pickers), bus: () => () => {} });
    await until(() => body.querySelectorAll(".settings-row-label").length === 4, "its four rows");
    assert.deepEqual(texts(body, ".settings-row-label"), ["Model for Spaces", "When an app asks an agent", "Pause all", "Spaces with their own"]);
    const chip = body.querySelector(".sp-model .ec");
    await until(() => pickers[0].name() === "brain-a" && chip.hidden === false, "its model, at its effort");
    assert.deepEqual([chip.querySelector(".ec-words").textContent, body.querySelector(".set-select").value], ["High", "ask"], "an app's ask asks first by default");
    assert.deepEqual(texts(body, ".spset-space .spset-name"), ["Northwind"]);
    assert.equal(body.querySelector(".spset-space .spset-what").textContent, "Brain B · an app's ask: run it at once, in the background", "named as the picker names it");
    // A model picked keeps its effort where it takes one; this one takes none.
    pickers[0].pick("brain-b");
    await until(() => calls.some(([m, p]) => m === "PATCH" && p === "/spaces/settings"), "saved");
    assert.deepEqual(calls.find(([m, p]) => m === "PATCH" && p === "/spaces/settings")?.[2], { model: "brain-b", effort: "" });
    await until(() => chip.hidden === true, "no effort for a model that takes none");
    // None: Use the default takes the model away.
    pickers[0].cb.onUseDefault();
    await until(() => calls.filter(([m, p]) => m === "PATCH" && p === "/spaces/settings").length === 2, "none, saved");
    assert.deepEqual(calls.filter(([m, p]) => m === "PATCH" && p === "/spaces/settings")[1][2], { model: "" });
    // What an app's ask does, picked.
    const asks = body.querySelector(".set-select");
    asks.value = "run";
    asks.dispatch("change");
    await until(() => calls.filter(([m, p]) => m === "PATCH" && p === "/spaces/settings").length === 3, "the ask's choice, saved");
    assert.deepEqual(calls.filter(([m, p]) => m === "PATCH" && p === "/spaces/settings")[2][2], { asks: "run" });
    // Pause all, every Space's one switch.
    body.querySelectorAll(".set-switch").at(-1).dispatch("click");
    await until(() => calls.some(([, p]) => p === "/spaces/pause"), "Pause all");
    assert.deepEqual(calls.find(([, p]) => p === "/spaces/pause")?.[2], { on: true });
    // Use these: a Space's own taken away.
    body.querySelector(".spset-reset").dispatch("click");
    await until(() => calls.some(([, p]) => p === "/space/p7/settings"), "Use these");
    assert.deepEqual(calls.find(([, p]) => p === "/space/p7/settings")?.slice(0, 1).concat([calls.find(([, p]) => p === "/space/p7/settings")?.[2]]), ["PATCH", { model: "", asks: "" }]);
    body.remove();
  });

  // HarnessV4_Space_Plan S6, case 17 (S6-D9): What do you look after… — the last of Add to this Space…, never shown by
  // itself; six kinds in plain words, none naming a service; its ticks fill the Start; nothing runs.
  // (fails before: yes — there was no such sheet)
  test("What do you look after…: six kinds, no service named; Ask an agent… off until a tick; the ticks fill the Start", async () => {
    const { LOOK_AFTER, lookAfterWords } = await import("../src/ui/harness/lib/space-view.js");
    assert.deepEqual(LOOK_AFTER.map((k) => k.label), ["Reviews and checks", "Messages", "Releases", "On call", "Upkeep", "Reporting"]);
    assert.doesNotMatch(JSON.stringify(LOOK_AFTER), /slack|gmail|github|linear|jira|pagerduty|sentry/i, "no service named (your word 4)");
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    assert.equal(doc.document.body.querySelector(".srt-look-sheet"), null, "never by itself");
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    items.at(-1).dispatch("click");
    const sheetEl = /** @type {any} */ (doc.document.body.querySelector(".srt-look-sheet"));
    assert.ok(sheetEl, "its sheet");
    const boxes = sheetEl.querySelectorAll(".srt-look-box");
    assert.equal(boxes.length, 6);
    const go = sheetEl.querySelector(".srt-look-go");
    assert.equal(go.hasAttribute("disabled"), true, "nothing ticked: Ask an agent… off");
    for (const i of [0, 4]) {
      boxes[i].checked = true;
      boxes[i].dispatch("change");
    }
    assert.equal(go.disabled, false);
    assert.equal(sheetEl.querySelector(".srt-look-sum").textContent, "2 ticked: an agent proposes each part; you switch on what you keep.");
    go.dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", lookAfterWords(["reviews", "upkeep"], "r")]);
    assert.match(String(did.words.at(-1)?.[1]), /^Set up r's Space for what I look after, as routines and dashboards I switch on myself — propose each, run nothing/);
    // The message is the person's: no kind's line says "you" to the agent that reads it.
    // (fails before: yes — seen at S6's live look: "what asks you in Needs you" in the person's own message)
    assert.doesNotMatch(lookAfterWords(LOOK_AFTER.map((k) => k.key), "r").replaceAll("Needs you", ""), /\byour?\b/i, "the section's own name aside");
    assert.deepEqual(posted, [], "nothing runs from it");
  });

  // (fails before: yes — the owner's word of 10-26: a project shown in Work offered the reviews asked of you and the
  // weekly update Work keeps, and its page said nothing of Work)
  test("a project shown in a Space of yours: In Work beside its name, opening Work; What do you look after… leaves Work's to Work", async () => {
    const { LOOK_AFTER_SHOWN, lookAfterWords } = await import("../src/ui/harness/lib/space-view.js");
    assert.deepEqual(LOOK_AFTER_SHOWN.map((k) => k.label), ["Checks", "Messages", "Releases", "On call", "Upkeep"]);
    assert.match(lookAfterWords(["messages"], "app", LOOK_AFTER_SHOWN), /what came in on this project's channels/);
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], shownIn: { id: "w1", name: "Work" } };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    /** @type {string[]} */
    const opened = [];
    const { host } = mountSpace(lookOf({}), { cb: { openSpace: (id) => void opened.push(id) } });
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-in-chip"), "its chip");
    const chip = host.querySelector(".sp-in-chip");
    assert.deepEqual([chip.textContent, chip.getAttribute("title")], ["In Work", "Its chats get Work's connectors and plugins"]);
    chip.dispatch("click");
    assert.deepEqual(opened, ["w1"]);
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    items.at(-1).dispatch("click");
    const sheetEl = /** @type {any} */ (doc.document.body.querySelector(".srt-look-sheet"));
    assert.equal(sheetEl.querySelectorAll(".srt-look-box").length, 5);
    assert.equal(sheetEl.querySelector(".srt-look-note").textContent, "Reviews asked of you and your weekly update are Work's.");
  });

  // (fails before: yes — found by the Hunter on A6: a Space of your own's look-after words said "this project's
  // connections" and "the main branch", and its New Space sheet showed a folder name other than the one made)
  test("a Space of your own's words: its connections the Space's, no main branch; its folder's name shown as made", async () => {
    const { LOOK_AFTER_OWN, lookAfterWords } = await import("../src/ui/harness/lib/space-view.js");
    const words = lookAfterWords(LOOK_AFTER_OWN.map((k) => k.key), "Work", LOOK_AFTER_OWN);
    assert.match(words, /use this Space's connections where it has them/);
    assert.doesNotMatch(words, /project|main branch/);
    assert.match(lookAfterWords(["reviews"], "r"), /use this project's connections/);
    const { folderName } = await import("../src/ui/harness/space/new-space.js");
    const { spaceFolderName } = await import("../src/core/space.js");
    for (const n of ["Work: home/office?", "con", ":", "...", "  Personal  ", "a<b>c", "LPT1", "Notes."]) assert.equal(folderName(n), spaceFolderName(n), n);
    // Folders and worktrees… only where it has a repository (A3; the top bar's Places until the reshape of 10-29).
    assert.match(src("space/space.js"), /\.\.\.\(noGit\(\) \? \[\] : \[\{ type: "separator" \}, \{ label: "Folders and worktrees…"/);
  });

  // (fails before: yes — the Designer's redesign of 10-29: a Space of your own said "this project" and "the project's
  // chats" in a dozen places — What happened's box and empty line, Routine…, Pull from…, New task…, a row's Hand to an
  // agent… —, a person's Space being no project)
  test("a Space's screens say \"here\", not \"this project\", where they mean the Space", () => {
    // Lines a Space of your own never shows: a project with no Space — its card, and the Keep of a draft there (by need,
    // 11-12) —, Import app… (a project's), a shown project's Stop showing.
    const PROJECT_ONLY = ["A Space is the project's board", "Keeping it makes this project's Space", "An app's .zip", "Its rows and tiles leave this page"];
    const files = ["space.js", "logbook.js", "left-off.js", "sync-card.js", "dashboards.js", "routines.js", "needs-rows.js", "action-sheet.js", "board.js"];
    const said = files.flatMap((f) => [...src(`space/${f}`).matchAll(/(?:title|placeholder|desc|label):\s*"([^"]*)"|h\("p", \{ class: "[^"]*" \}, "([^"]*)"\)/g)]
      .map((m) => [f, m[1] ?? m[2]]))
      .filter(([, w]) => /\b(this|the|its) project(?:'s)?\b/i.test(String(w)) && !PROJECT_ONLY.some((x) => String(w).startsWith(x)));
    assert.deepEqual(said, [], "every line of a Space's screens says \"here\" or the Space's own word");
  });

  // (fails before: yes — the Designer's redesign of 10-29: a new Space of your own opened on "What do you look after?",
  // each of whose kinds needs an account, under its full folder path and an empty Needs you, and said neither who works
  // in it nor what to do first; the owner's first question was which agent works there)
  test("an empty Space's first screen: Start here — make an app, ask an agent, connect an account —, who works in it, New app… first", async () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    let chats = /** @type {any[]} */ ([]);
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats };
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], own: { name: "Northwind", folder: "/r", repo: false } };
      return undefined;
    };
    try {
      for (const stop of stops.splice(0)) stop();
      const northwind = { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null) } };
      const { host, did } = mountSpace(lookOf({}), northwind);
      const root = host.querySelector(".space");
      assert.ok(root.classList.contains("sp-is-reading"), "nothing of a Space drawn before it is read");
      const start = await until(() => host.querySelector(".sp-start"), "Start here");
      assert.equal(root.classList.contains("sp-is-reading"), false);
      assert.equal(host.querySelector(".srt-first"), null, "What do you look after? never by itself");
      assert.match(start.querySelector(".sp-start-lead").textContent, /^Northwind is a place of your own for apps, tasks and the chats that work on them\. Any chat you start here can see and change what is in it/);
      assert.deepEqual(texts(start, ".sp-start-t"), ["Make an app", "Ask an agent here", "Connect an account"]);
      // Who works here, under its name; its folder by its name, the whole path on hover.
      const line = host.querySelector(".sp-line");
      assert.deepEqual([line.textContent, line.getAttribute("title")], ["Chats you start here work in this Space · its files in “r”", "/r"]);
      // New app… is the head's own act; nothing needs you yet, so Needs you is off the first screen.
      // (Its runs-on line is a button too, hidden until the Space says what its agents run on: 11-04.)
      assert.deepEqual(host.querySelector(".sp-head").querySelectorAll("button").filter((/** @type {any} */ b) => !b.hidden).map((/** @type {any} */ b) => b.textContent), ["Add to this Space…", "New chat here…", "New app…"]);
      // Apps are what a Space of your own is for: New app… its filled button, New chat here… quiet beside it.
      assert.deepEqual([host.querySelector(".sp-new-app").getAttribute("class"), host.querySelector(".sp-new-chat").getAttribute("class")], ["sm primary sp-new-app", "ghost sm sp-new-chat"]);
      assert.equal(start.querySelector(".sp-start-foot .sp-quiet").textContent, "New app… and New chat here… stay at the top of this page.", "its foot names them");
      assert.equal(host.querySelector(".sp-needs-sec").hidden, true);
      // Each card opens what it says; nothing is sent or written.
      const acts = (/** @type {number} */ i) => start.querySelectorAll(".sp-start-card")[i].querySelectorAll("button");
      assert.deepEqual([0, 1, 2].map((i) => acts(i).map((/** @type {any} */ b) => b.textContent)), [["New app…"], ["New chat here…"], ["Connectors…", "What do you look after…"]]);
      acts(0)[0].dispatch("click");
      const sheetEl = doc.document.body.querySelector(".snew-sheet");
      assert.ok(sheetEl, "New app's sheet");
      sheetEl.querySelector(".sdb-keep-foot .ghost").dispatch("click");
      acts(1)[0].dispatch("click");
      assert.deepEqual(did.started, [["/r", false]], "the Start in its folder");
      acts(2)[1].dispatch("click");
      const look = doc.document.body.querySelector(".srt-look-sheet");
      assert.equal(look.querySelectorAll(".srt-look-box").length, 5, "a Space of your own's kinds");
      look.querySelector(".sdb-keep-foot .ghost").dispatch("click");
      assert.deepEqual([did.words, posted], [[], []]);
      // Not now puts it away, in this browser; nothing needs you, so Needs you stays off.
      start.querySelector(".sp-start-away").dispatch("click");
      assert.equal(host.querySelector(".sp-start"), null);
      assert.equal(host.querySelector(".sp-needs-sec").hidden, true);
      for (const stop of stops.splice(0)) stop();
      kept.clear();
      // A chat works here: the Space is no longer empty, and the first screen is its own.
      chats = [{ id: "c30", name: "plan the week", home: true, atWork: false }];
      const again = mountSpace(lookOf({ c30: { title: "plan the week", when: Date.now() } }), northwind);
      await until(() => times("/api/space/p1") >= 2 && !again.host.querySelector(".space").classList.contains("sp-is-reading"), "read");
      await until(() => again.host.querySelector(".sp-line").textContent.startsWith("Chats"), "drawn");
      assert.equal(again.host.querySelector(".sp-start"), null);
      assert.equal(again.host.querySelector(".sp-needs-sec").hidden, true, "nothing needs you");
    } finally {
      g.localStorage = hadStore;
    }
  });

  // (fails before: yes — the owner's first question of 10-29, on Northwind: "which agent do i ask to make apps and
  // dashboard in that space"; a Space of your own whose folder is no repository drew no lane, so no chat of it showed)
  test("a Space of your own with no lanes: Who works here lists its chats — what each does, who runs it —, a press opening it", async () => {
    const at = Date.now();
    let chats = [{ id: "c30", name: "plan the week" }, { id: "c31", name: "groceries" }];
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats };
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], own: { name: "Northwind", folder: "/r", repo: false } };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const northwind = { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null) } };
    const look = lookOf({ c30: { title: "Plan the week", when: at - 60_000 }, c31: { title: "Groceries", when: at - 3 * HOUR } },
      { c30: { group: "works", fact: "writing the plan", model: "claude-opus-5-5" } });
    const { host, did } = mountSpace(look, northwind);
    const sec = await until(() => (host.querySelector(".sp-who-sec")?.hidden === false ? host.querySelector(".sp-who-sec") : null), "Who works here");
    /** The sections' names the page shows: none of a hidden one's. @param {any} root */
    const shownNames = (root) => root.querySelectorAll(".sp-overview .sp-sec-name").filter((/** @type {any} */ n) => {
      for (let e = n; e; e = e.parentNode) if (e.hidden) return false;
      return true;
    }).map((/** @type {any} */ n) => n.textContent);
    assert.deepEqual(shownNames(host), ["Who works here", "Runs by itself", "Tasks", "What happened"]);
    // (fails before: yes — Who works here stood alone over the board) Where the folder draws no lanes, it takes the
    // pair's left column, what runs by itself at its right.
    assert.deepEqual([sec.parentNode.getAttribute("class"), sec.parentNode.parentNode.getAttribute("class"), host.querySelector(".sp-pair .sp-by-itself .sbi-none .sp-quiet").textContent],
      ["sp-pair-main", "sp-pair", "Nothing runs by itself here yet."]);
    assert.equal(host.querySelector(".sp-start"), null, "chats work here: no Start here");
    assert.equal(sec.querySelector(".sp-sec-count").textContent, "2");
    // (fails before: yes — the Designer's second walk of 10-29: past Start here, nothing said any agent will do)
    assert.equal(sec.querySelector(".sp-sec-h .sp-quiet").textContent, "any chat started here works in this Space, whichever agent you pick");
    assert.deepEqual(sec.querySelectorAll(".sp-who-row").map((/** @type {any} */ r) => [r.getAttribute("data-chain"), r.querySelector(".sp-who-name").textContent, r.querySelector(".sp-who-state").textContent]),
      [["c30", "Plan the week", "working · writing the plan · named claude-opus-5-5"], ["c31", "Groceries", "idle · 3h"]]);
    sec.querySelectorAll(".sp-who-row")[1].dispatch("click");
    assert.deepEqual(did.opened, ["c31"]);
    // None yet: Start here says how one starts; put away, Who works here says it.
    for (const stop of stops.splice(0)) stop();
    chats = [];
    /** @type {Map<string, string>} */
    const kept = new Map();
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    try {
      const none = mountSpace(lookOf({}), northwind);
      const start = await until(() => none.host.querySelector(".sp-start"), "Start here");
      assert.equal(none.host.querySelector(".sp-who-sec").hidden, true, "Start here says it first");
      start.querySelector(".sp-start-away").dispatch("click");
      const empty = none.host.querySelector(".sp-who-sec");
      assert.equal(empty.hidden, false);
      assert.equal(empty.querySelector(".sp-who-none").textContent, "No chat works here yet. New chat here… starts one: it can see and change this Space.");
      assert.equal(empty.querySelectorAll(".sp-who-row").length, 0);
    } finally {
      g.localStorage = hadStore;
    }
  });

  // (fails before: yes — the Designer's redesign of 10-29: New Space asked a name, a folder and the files it may read
  // all at once, and its words said "your accounts, connected once for every project it shows" to someone making a first)
  test("New Space…: what a Space is in plain words, a name first; where its files go and what it may read one line, behind Change…", async () => {
    serve = (u, method) => {
      if (u === "/api/spaces/own" && method === "GET") return { folder: "C:\\Docs\\Filament Spaces", limits: "" };
      if (u === "/api/spaces/own" && method === "POST") return { project: "p9", name: "Northwind", folder: "C:\\Docs\\Filament Spaces\\Northwind", at: 1, reach: "folder", folders: [], shows: [] };
      return undefined;
    };
    const { newSpaceSheet } = await import("../src/ui/harness/space/new-space.js");
    /** @type {string[]} */
    const done = [];
    newSpaceSheet({ onDone: (row) => void done.push(row.project) });
    const el = /** @type {any} */ (doc.document.body.querySelector(".nsp-sheet"));
    await until(() => el.querySelector(".nsp-summary-words").textContent.includes("C:\\Docs"), "where Spaces' folders go, read");
    assert.match(el.querySelector(".sdb-keep-lead").textContent, /^A place of your own — Work, Personal, a hobby — for the apps an agent makes you, your tasks, and the chats that work on them\./);
    assert.equal(el.querySelector(".nsp-more").hidden, true, "its folder and what it may read: folded");
    const name = el.querySelector(".nsp-name");
    name.value = "Northwind";
    name.dispatch("input");
    assert.equal(el.querySelector(".nsp-summary-words").textContent, "Its files go in C:\\Docs\\Filament Spaces\\Northwind. Its chats work there, and ask you before they read anything elsewhere.");
    el.querySelector(".nsp-more-go").dispatch("click");
    assert.deepEqual([el.querySelector(".nsp-more").hidden, el.querySelector(".nsp-summary").hidden, el.querySelectorAll(".nsp-reach").length], [false, true, 3]);
    el.querySelector(".nsp-go").dispatch("click");
    await until(() => done.length, "made");
    assert.deepEqual(posted.at(-1), { url: "/api/spaces/own", body: { name: "Northwind", reach: "folder" } });
    // Changing one: its name and what it may read, open at once; its folder stays.
    newSpaceSheet({ space: { project: "p9", name: "Northwind", folder: "C:\\Docs\\Filament Spaces\\Northwind", at: 1, reach: "folder", folders: [], shows: [] } });
    const edit = /** @type {any} */ (doc.document.body.querySelectorAll(".nsp-sheet").at(-1));
    assert.deepEqual([edit.querySelector(".nsp-more").hidden, edit.querySelector(".nsp-summary").hidden], [false, true]);
    edit.querySelector(".zc-sheet-x")?.dispatch("click");
  });

  // (fails before: yes — the Designer's redesign of 10-29) A project's empty Space says its own words; a project with no
  // Space draws none of a Space's parts before its card (seen live: a whole empty Space, then "This project has no Space").
  test("a project's empty Space: Start here in a project's words; a project with no Space: nothing drawn before its card", async () => {
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([{ ...MAIN, chats: [] }]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({}));
    const start = await until(() => host.querySelector(".sp-start"), "Start here");
    assert.match(start.querySelector(".sp-start-lead").textContent, /^r's Space holds the apps its chats make, its board of tasks and What happened.* Every chat in r can see and change it/);
    assert.match(start.querySelectorAll(".sp-start-line")[1].textContent, /^A chat you start in r works in this Space/);
    // (fails before: yes — its foot said "New app… and New chat here… stay at the top of this page", of a head that
    // holds no New app… in a project's Space) The foot names what the head above it holds.
    assert.equal(start.querySelector(".sp-start-foot .sp-quiet").textContent, "New chat here… and Add to this Space… stay at the top of this page.");
    // (fails before: yes — the line said "Every chat in r works in this Space · /r · 1 lane", and wrapped under a long folder)
    assert.deepEqual([host.querySelector(".sp-line").textContent, host.querySelector(".sp-line").getAttribute("title"), host.querySelector(".sp-title").getAttribute("title")],
      ["/r · 1 lane", "/r · 1 lane", "Every chat in r works in this Space"], "its folder and lanes on one line, whole in its tip; who works here, the title's tip");
    for (const stop of stops.splice(0)) stop();
    serve = (u) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1") return new Refusal(404, "This project has no Space: make one from its menu.", { none: true, deletedAt: null });
      return undefined;
    };
    const none = mountSpace(lookOf({}));
    const root = none.host.querySelector(".space");
    assert.ok(root.classList.contains("sp-is-reading"));
    await until(() => root.classList.contains("sp-is-none"), "its card");
    assert.equal(root.classList.contains("sp-is-reading"), false);
    assert.equal(none.host.querySelector(".sp-start"), null, "no Start here without a Space");
    assert.match(src("space/space.css"), /\.space\.sp-is-reading \.sp-overview \{ display: none; \}/);
  });

  // (fails before: yes — the Designer's walk of 10-29: Connect an account promised email and calendar, its sheet said "For
  // chats in the harness. Apps you connect to Filament (Claude Code, an SDK)…", and What do you look after… let Email be ticked
  // with nothing connected, offering "routines and dashboards")
  test("Connect an account in plain words: the card promises what can be connected, the sheet speaks of accounts, What do you look after says nothing is connected yet", async () => {
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats: [] };
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], own: { name: "Northwind", folder: "/r", repo: false } };
      if (u === "/api/space/p1/connections") return { connections: {}, programs: [], folder: "/r" };
      if (u === "/api/mcp-servers?scope=project%3Ap1") return { at: "project", label: "Northwind", servers: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    /** @type {Map<string, string>} */
    const kept = new Map();
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    try {
      const { host } = mountSpace(lookOf({}), { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null) } });
      const start = await until(() => host.querySelector(".sp-start"), "Start here");
      const card = start.querySelectorAll(".sp-start-card")[2];
      assert.equal(card.querySelector(".sp-start-line").textContent, "Connect an account or a service, like GitHub or Linear, and the chats here can use it. An agent can then watch it and tell you what needs you.");
      card.querySelectorAll("button")[0].dispatch("click");
      const sheetEl = /** @type {any} */ (await until(() => doc.document.body.querySelector(".spc-sheet .mcps-empty") ? doc.document.body.querySelector(".spc-sheet") : null, "the Connectors sheet, read"));
      assert.match(sheetEl.querySelector(".spc-lead").textContent, /^What Northwind's chats, routines and apps can use — an account or a service, like GitHub or Linear —, and the account each signs in with\./);
      assert.equal(sheetEl.querySelector(".mcps-empty").textContent, "Nothing is connected to Northwind yet: connect an account or a service, and the chats here can use it.");
      assert.equal(sheetEl.querySelector(".mcps-foot"), null, "no words on the harness, other apps or a team's lead");
      assert.ok(sheetEl.querySelectorAll("button").some((/** @type {any} */ b) => b.textContent === "Connect an account or service…"));
      card.querySelectorAll("button")[1].dispatch("click");
      const look = /** @type {any} */ (doc.document.body.querySelector(".srt-look-sheet"));
      assert.match(look.querySelector(".sdb-keep-lead").textContent, /to propose routines and apps for it;/);
      const none = /** @type {any} */ (await until(() => (look.querySelector(".srt-look-none")?.hidden === false ? look.querySelector(".srt-look-none") : null), "nothing connected, said"));
      assert.equal(none.querySelector(".srt-look-none-words").textContent, "Nothing is connected to Northwind yet, and most of these read an account — your email, your messages, your issues —: connect one first, or the agent will ask you to.");
      // A sheet opened closes the one before it: the Connectors sheet is gone, and back from here.
      assert.equal(doc.document.body.querySelectorAll(".spc-sheet").length, 0);
      none.querySelector("button").dispatch("click");
      await until(() => doc.document.body.querySelectorAll(".spc-sheet").length === 1, "Connectors…, from it");
    } finally {
      g.localStorage = hadStore;
    }
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-9: a list of connectors that could not be read was taken for one with
  // a connector on, so What do you look after said nothing over kinds that each read an account)
  test("What do you look after… where the connectors cannot be read: it says so, never that one is connected", async () => {
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats: [] };
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], own: { name: "Northwind", folder: "/r", repo: false } };
      if (u === "/api/mcp-servers?scope=project%3Ap1") return new Refusal(500, "the configuration could not be read");
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host } = mountSpace(lookOf({}), { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null) } });
    await until(() => !host.querySelector(".space").classList.contains("sp-is-reading"), "the Space read");
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    items.at(-1).dispatch("click");
    const look = /** @type {any} */ (doc.document.body.querySelectorAll(".srt-look-sheet").at(-1));
    const none = /** @type {any} */ (await until(() => (look.querySelector(".srt-look-none")?.hidden === false ? look.querySelector(".srt-look-none") : null), "why it cannot say, said"));
    assert.equal(none.querySelector(".srt-look-none-words").textContent, "Whether anything is connected to Northwind could not be read: the configuration could not be read. Most of these read an account — your email, your messages, your issues —: connect one first, or the agent will ask you to.");
    assert.equal(none.querySelector("button").textContent, "Connectors…");
    look.querySelector(".zc-sheet-x").dispatch("click");
  });

  // (fails before: yes — the Designer's walk of 10-29: "New app in Home life's Space" in a Space that is Home life, the
  // crumb "Home life › Space" beside the bar's Board row, Add's "New app…" the head's New app… by another name, "recipes's")
  test("a Space's names: its crumb says Board in a Space of your own, Space in a project's; New app… one name; New app in Northwind, in recipes' Space", async () => {
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats: [] };
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], own: { name: "Northwind", folder: "/r", repo: false } };
      if (u === "/api/space/p1/starters") return { starters: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const own = mountSpace(lookOf({}), { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null), startWith() {} } });
    await until(() => !own.host.querySelector(".space").classList.contains("sp-is-reading") && own.host.querySelector(".sp-line").textContent.startsWith("Chats"), "read");
    assert.equal(own.host.querySelector(".sp-crumb-page").textContent, "Board");
    const items = await menuOf(own.host.querySelector(".sp-add"), "Add to this Space…");
    assert.equal(items[0].querySelector(".zc-menu-label-line").textContent, "New app…");
    // Each menu's line as its sheet says it (the Designer's second walk of 10-29); a press closes each menu.
    assert.match(items.at(-1).querySelector(".zc-menu-desc").textContent, /an agent proposes routines and apps for them/);
    items.at(-1).dispatch("click");
    /** @type {any} */ (doc.document.body.querySelector(".srt-look-sheet .sdb-keep-foot .ghost")).dispatch("click");
    const more = await menuOf(own.host.querySelector(".sp-settings"), "⋯");
    const conn = more.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Connectors…");
    assert.match(conn.querySelector(".zc-menu-desc").textContent, /^The accounts and services this Space's chats and apps can use, and the account each signs in with/);
    more[0].dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "no menu left open");
    own.host.querySelector(".sp-head .sp-new-app").dispatch("click");
    const sheetOf = () => /** @type {any} */ (doc.document.body.querySelectorAll(".snew-sheet").at(-1));
    assert.equal(sheetOf().querySelector(".sp-sheet-title").textContent, "New app in Northwind");
    sheetOf().querySelector(".sdb-keep-foot .ghost").dispatch("click");
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [] };
      if (u === "/api/space/p1/starters") return { starters: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const recipes = mountSpace(lookOf({}), { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "recipes", cwd: "/r" } : null), startWith() {} } });
    await until(() => recipes.host.querySelector(".sp-title").getAttribute("title")?.startsWith("Every chat"), "read");
    assert.equal(recipes.host.querySelector(".sp-crumb-page").textContent, "Space");
    // A project's head has no New app… of its own: Add to this Space…'s first row.
    assert.equal(recipes.host.querySelector(".sp-head .sp-new-app").hidden, true);
    const adds = await menuOf(recipes.host.querySelector(".sp-add"), "Add to this Space…, in a project's Space");
    assert.equal(adds[0].querySelector(".zc-menu-label-line").textContent, "New app…");
    adds[0].dispatch("click");
    assert.equal(sheetOf().querySelector(".sp-sheet-title").textContent, "New app in recipes' Space");
    sheetOf().querySelector(".sdb-keep-foot .ghost").dispatch("click");
  });

  // (fails before: yes — the Designer's walk of 10-29: recipes, a project with one chat, › Make a Space opened on "Needs
  // you here — Nothing needs you here", a lane and an empty board: nothing said what a Space is, or who works in it)
  test("a project's Space with chats opens on Start here, who works in it on its card and under its name; an empty Needs you is off the page", async () => {
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    /** @type {Map<string, string>} */
    const kept = new Map();
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    try {
      const { host } = mountSpace(lookOf({ c20: { title: "on main", when: Date.now() } }));
      await lanesDrawn(host);
      const start = await until(() => host.querySelector(".sp-start"), "Start here, with a chat in it");
      assert.match(start.querySelectorAll(".sp-start-line")[1].textContent, /^Every chat in r — the one it has now, and each you start — works in this Space: .* Any agent will do — Filament's own, Claude Code, Codex…$/);
      assert.deepEqual([host.querySelector(".sp-title").getAttribute("title"), host.querySelector(".sp-line").textContent], ["Every chat in r works in this Space", "/r · 1 lane"]);
      assert.equal(host.querySelector(".sp-needs-sec").hidden, true);
      assert.deepEqual(texts(host, ".sb-none"), ["No tasks yet. New task… adds one; the chats here add theirs as they work."]);
      start.querySelector(".sp-start-away").dispatch("click");
      assert.equal(host.querySelector(".sp-start"), null);
      assert.equal(host.querySelector(".sp-needs-sec").hidden, true, "nothing needs you: Needs you stays off");
      // (fails before: yes — the reviewer, 10-29: Start here hid Needs you, so a chat that asks you was said nowhere here)
      for (const stop of stops.splice(0)) stop();
      kept.clear();
      const asking = mountSpace(lookOf({ c20: { title: "on main", when: Date.now() } }, { c20: { group: "needs", fact: "asks which branch" } }));
      await lanesDrawn(asking.host);
      await until(() => asking.host.querySelector(".sp-start"), "Start here, a chat asking");
      assert.equal(asking.host.querySelector(".sp-needs-sec").hidden, false, "what asks you shows under it");
      assert.deepEqual(texts(asking.host, ".sp-needs-sec .sp-need-t"), ["asks which branch"]);
      // A name that ends in s is recipes', not recipes's.
      for (const stop of stops.splice(0)) stop();
      kept.clear();
      const recipes = mountSpace(lookOf({}), { cb: { project: (/** @type {string} */ id) => (id === "p1" ? { id: "p1", name: "recipes", cwd: "/r" } : null) } });
      const lead = await until(() => recipes.host.querySelector(".sp-start-lead"), "recipes' Start here");
      assert.match(lead.textContent, /^recipes' Space holds/);
    } finally {
      g.localStorage = hadStore;
    }
  });

  // HarnessV4_Space_Plan S4b: its Connectors (Connections until the owner's word of 10-26). Nothing in the top bar until
  // a dashboard kept here calls a connector's tool (SG-D0); Add to this Space… › Connector… opens the sheet always: the
  // project's connectors as the Library draws them at its layer, each row with what in this Space uses it, the programs
  // its dashboards run, and the door to Library › Plugins & Connectors with this project chosen.
  // (fails before: yes — a Space had no connections)
  test("its Connectors: in the top bar once a kept dashboard calls one; the sheet says what uses each, its programs, the door to the Library", async () => {
    const at = Date.now();
    const grant = {
      sources: { runs: { tool: { connection: "ci", name: "list_runs", args: {} }, every: 60_000 }, deploys: { command: ["npx", "wrangler", "deployments", "list"], every: 60_000 } },
      watch: [], actions: { rerun: { tool: { connection: "ci", name: "rerun", args: {} } } },
    };
    const CI = { name: "ci-ab12", title: "CI", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant, newest: grant,
      reads: grant, looks: [], sources: {}, updatedAt: at };
    /** @type {any[]} */
    let current = [];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: current, gone: [] });
    const ROW = { name: "ci", kind: "http", spec: { url: "https://ci.example/mcp" }, sse: false, from: "global", on: true, switchedAt: null, replaces: null, orphan: false,
      own: false, switchedHere: false, account: "main", pickedHere: false, test: null, signIn: { state: "in", host: "ci.example", account: "main", accounts: ["main"] } };
    const DOCS = { ...ROW, name: "docs", spec: { url: "https://docs.example/mcp" }, signIn: null };
    let USES = { connections: { ci: [{ name: "ci-ab12", title: "CI", reads: ["runs"], presses: ["Re-run failed jobs…"] }] }, programs: [{ program: "npx", by: ["CI"] }], folder: "/r" };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/connections") return USES;
      if (u === "/api/mcp-servers?scope=project%3Ap1") return { at: "project", label: "this project", servers: [ROW, DOCS] };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => times("/api/space/p1") === 1, "the Space read");
    // (fails before: yes — the reshape of 10-29: Connectors were the top bar's and Add to this Space…'s) ⋯ › Connectors…
    // opens the sheet always; "used here" once a kept dashboard calls one.
    const connectorsItem = async (/** @type {string} */ what) =>
      (await menuOf(host.querySelector(".sp-settings"), what)).find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line")?.textContent === "Connectors…");
    assert.equal(host.querySelector(".sp-connections-go"), null, "no Connectors in the top bar");
    const item = await connectorsItem("⋯");
    assert.equal(item.querySelector(".zc-menu-note"), null, "nothing kept calls a connection: no note (SG-D0)");
    item.dispatch("click");
    const sheetOf = () => doc.document.body.querySelector(".spc-sheet");
    await until(() => sheetOf()?.querySelectorAll(".mcps-row").length === 2, "the sheet's rows");
    const el = sheetOf();
    assert.equal(el.querySelector(".sp-sheet-title").textContent, "Connectors · r");
    assert.deepEqual([times("/api/space/p1/connections"), times("/api/mcp-servers?scope=project%3Ap1")], [1, 1], "what uses each, and the project's layer of the list");
    // Each row with what in this Space uses it: removing one says what stops.
    const used = (/** @type {string} */ name) => texts(el.querySelector(`.mcps-row[data-name="${name}"]`), ".mcps-sub").filter((/** @type {string} */ t) => t.startsWith("Used by"));
    assert.deepEqual(used("ci"), ["Used by CI (reads runs · Re-run failed jobs…)"]);
    assert.deepEqual(used("docs"), ["Used by nothing in this Space yet"]);
    // The programs the dashboards run: no connection, signed in as they are.
    assert.deepEqual(texts(el, ".spc-h"), ["Programs on this computer"]);
    assert.deepEqual(texts(el, ".spc-programs"), ["CI runs npx — in /r, signed in the way those programs are. Filament keeps no token for them."]);
    // The door: Library › Plugins & Connectors with this project chosen; the sheet closes.
    el.querySelector(".spc-settings").dispatch("click");
    assert.deepEqual(did.settings, [["p1", "mcp-servers"]]);
    // A dashboard kept here that calls a connection's tool: ⋯ › Connectors… says it is used here, and opens the sheet.
    current = [CI];
    hear({ type: "artifact", name: "ci-ab12", v: 1, title: "CI" });
    await until(() => times("/api/space/p1") === 2, "the Space read again");
    await new Promise((r) => setTimeout(r, 20));
    const used2 = await connectorsItem("⋯ again");
    assert.equal(used2.querySelector(".zc-menu-note")?.textContent, "used here");
    used2.dispatch("click");
    await until(() => times("/api/space/p1/connections") === 2, "the sheet again, from ⋯");
    // Open, it follows the Space: a dashboard kept meanwhile that reads docs — its row says so, and the programs too.
    // (fails before: yes — found by the Hunter on S4b: the sheet said what was until it was closed and opened again)
    await until(() => sheetOf()?.querySelectorAll(".mcps-row").length === 2, "the sheet open again");
    USES = { ...USES, connections: { ...USES.connections, docs: [{ name: "docs-cd34", title: "Docs", reads: ["pages"], presses: [] }] }, programs: [{ program: "npx", by: ["CI", "Docs"] }] };
    hear({ type: "space", project: "p1" });
    const usedNow = (/** @type {string} */ name) => texts(sheetOf().querySelector(`.mcps-row[data-name="${name}"]`), ".mcps-sub").filter((/** @type {string} */ t) => t.startsWith("Used by"));
    await until(() => usedNow("docs")[0] === "Used by Docs (reads pages)", "read again as the Space moved");
    assert.deepEqual(texts(sheetOf(), ".spc-programs"), ["CI and Docs run npx — in /r, signed in the way those programs are. Filament keeps no token for them."]);
  });

  // HarnessV4_Space_Plan S4c: what a kept dashboard feeds — its lines on the lane of their branch, two at most, red with
  // Fix it…; its cards on the board, dashed, each with its menu (its buttons, Pick up… on a new lane, its tab); the
  // Tasks head's count.
  // (fails before: yes — a dashboard fed nothing into its Space)
  test("what a kept dashboard feeds: its lines on their branch's lane, its cards on the board, a card's menu, the Tasks count", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    const KEPT = { name: "prs-ab12", title: "PRs", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, fed: { lanes: { from: "prs", branch: "branch", words: "PR #{number}" }, tasks: null }, looks: [], sources: {}, updatedAt: at };
    const A = "/api/space/p1/dashboards/prs-ab12/actions/close";
    const LOOK = { ok: true, label: "Close it…", title: "PRs", says: "Close PR #412?", command: ["gh", "pr", "close", "412"], folder: "/r", ask: [], secondLook: false, running: null };
    /** @param {any} [o] */
    const line = (o = {}) => ({ dashboard: "prs-ab12", title: "PRs", branch: "agent", words: "PR #412 · checks failing", tone: "bad", at, stale: false, ...o });
    /** @param {any} o */
    const card = (o) => ({ dashboard: "prs-ab12", title: "PRs", source: "prs", line: "", at, stale: false, presses: [], ...o });
    const feeds = {
      lanes: [line(), line({ words: "PR #413 · checks passing", tone: "good" }), line({ words: "PR #414", tone: "" }), line({ branch: "elsewhere", words: "no lane" })],
      tasks: [card({ key: "412", task: "Fix login", line: "bug", column: "doing", presses: [{ name: "close", label: "Close it…" }] }), card({ key: "400", task: "Docs", column: "waits", stale: true, at: at - 5 * 60_000 })],
      counts: [{ dashboard: "prs-ab12", title: "PRs", count: 2, more: 0 }],
    };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [KEPT], gone: [], feeds };
      if (u === A) return LOOK;
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({ c20: { title: "on main", when: at, line: "" }, c21: { title: "the agent", when: at, line: "" } }));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-fed"), "its lines");
    const wt = host.querySelector('article.sp-lane[data-place="/r-wt"]');
    assert.deepEqual(wt.querySelectorAll(".sp-fed").map((/** @type {any} */ e) => [e.getAttribute("class"), e.querySelector(".sp-fed-w").textContent, e.querySelector(".sp-fed-src").textContent]),
      [["sp-fed is-bad", "PR #412 · checks failing", "PRs"], ["sp-fed is-good", "PR #413 · checks passing", "PRs"]], "two at most, on the lane of their branch");
    assert.equal(wt.querySelector(".sp-fed-more").textContent, "and 1 more");
    assert.equal(host.querySelector('article.sp-lane[data-place="/r"] .sp-fed'), null, "main's branch has none");
    assert.equal(wt.querySelectorAll(".sp-fed-fix").length, 1, "Fix it… on a red line alone");
    wt.querySelector(".sp-fed-fix").dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r-wt", "PR #412 · checks failing\n\n(PRs, a dashboard of this Space, says this of agent.) Find why, and fix it."], "the Start in the lane's own folder");
    // The board: its cards dashed, in the column their row says; the stale one as read; the head's count.
    const cards = host.querySelectorAll(".sb-card.is-fed");
    assert.deepEqual(cards.map((/** @type {any} */ c) => [c.getAttribute("class"), c.querySelector(".sb-t").textContent, c.querySelector(".sb-src").textContent]),
      [["sb-card is-fed has-dots", "Fix login", "PRs"], ["sb-card is-fed is-ask is-stale has-dots", "Docs", "PRs"]], "in Waits for you, its orange edge");
    assert.match(cards[1].querySelector(".sb-age").textContent, /^as read (?:today|yesterday) \d\d:\d\d$/, "as the Space says a moment");
    assert.deepEqual([host.querySelector(".sp-fed-count").textContent, host.querySelector(".sp-fed-count").hidden], ["+ 2 from PRs", false]);
    // A card's menu: its buttons that fit its row, Pick up…, Reproduce… (S7), its tab.
    let items = await menuOf(cards[0].querySelector(".sb-face"), "the card's menu");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Close it…", "Pick up…", "Reproduce…", "Open PRs"]);
    items[1].dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", "Fix login\n\nbug\n\n(From PRs, a dashboard of this Space.)", "a lane"], "the Start on a new lane, its words in the box");
    // Reproduce… (S7-D1): the card's words, where it came from, for the Tester's Start.
    // (fails before: yes — there was no Reproduce…)
    items = await menuOf(cards[0].querySelector(".sb-face"), "the card's menu, for Reproduce…");
    items[2].dispatch("click");
    assert.deepEqual(did.repro.at(-1), ["/r", { title: "Fix login", text: "bug", from: "PRs, a dashboard of r's Space" }]);
    items = await menuOf(cards[0].querySelector(".sb-face"), "the card's menu again");
    items[0].dispatch("click");
    await until(() => doc.document.body.querySelector(".sas-sheet"), "Filament's sheet, as in its tab");
    assert.deepEqual(posted.at(-1), { url: A, body: { key: "412" } }, "the card's row");
    doc.document.body.querySelector(".sas-sheet .sas-back").dispatch("click");
    await until(() => !doc.document.body.querySelector(".sas-sheet"), "Cancel");
    // A stale card: no button, and Read again in their place (the Hunter on S4c: its buttons were refused when pressed).
    // (fails before: yes — the stale card's menu had no way to read again)
    items = await menuOf(cards[1].querySelector(".sb-face"), "a stale card");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Read again", "Pick up…", "Reproduce…", "Open PRs"]);
    items[0].dispatch("click");
    await until(() => posted.at(-1)?.url === "/api/space/p1/dashboards/prs-ab12/read", "its read");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/dashboards/prs-ab12/read", body: { source: "prs" } }, "its source, as its tab's Read again");
    items = await menuOf(cards[1].querySelector(".sb-face"), "the stale card again");
    items.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent === "Open PRs").dispatch("click");
    await until(() => host.querySelector(".sp-crumb-app").textContent === "PRs" && host.querySelector(".sdb-view").hidden === false, "its page");
    // What it may do says what the version that reads feeds.
    const more = await menuOf(host.querySelector(".sdb-more"), "the tab's ⋯");
    more.find((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent === "What it may do").dispatch("click");
    const sheetEl = await until(() => doc.document.body.querySelector(".sdb-keep-sheet"), "What it may do");
    assert.deepEqual(texts(sheetEl, ".sdb-keep-fed"), ["A line on the lane of each branch a row of prs names (its branch): “PR #{number}”its first row for the branch"]);
    const close = sheetEl.querySelectorAll(".sdb-keep-foot button").find((/** @type {any} */ b) => b.textContent === "Close");
    assert.ok(close, "its Close");
    close.dispatch("click");
    await until(() => !doc.document.body.querySelector(".sdb-keep-sheet"), "closed");
  });

  // HarnessV4_Space_Plan S5a: Needs you here holds the rows Filament keeps beside the chats' — a stopped source first
  // (red, Fix it… and Read again), then what a watch found, the newest first —, each with its dashboard's chip, its why,
  // Not now ▾ and Done; under them Done today and later, each list behind its Show, each row's Bring back.
  // (fails before: yes — Needs you here held the chats' rows alone)
  test("Needs you here: the chats' rows, then the kept ones with their why; Fix it…, Read again, Not now, Done; Done today and later with Bring back", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    const KEPT = { name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    const WHY = "a watch of Deploys: a new row of runs where status is failure";
    /** @param {string} id @param {any} o */
    const row = (id, o) => ({ id, kind: "watch", text: `CI failed on main: run ${id}`, why: WHY, dashboard: "deploys-ab12", title: "Deploys", watch: "w0", at: at - 10 * 60_000, state: "open", ...o });
    let needs = [
      row("w1", {}),
      row("w2", { at: at - 20 * 60_000, dashboard: "old-x", title: "Old" }),
      row("s1", { kind: "source", text: "Deploys stopped reading deploys: npx exited 1: not authenticated", why: "a kept dashboard's source failed 3 times in a row", source: "deploys", watch: undefined, at: at - 30 * 60_000 }),
      row("l1", { state: "later", until: at + HOUR }),
      row("d1", { state: "done", doneAt: at }),
    ];
    const spaceNow = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [KEPT], gone: [], needs });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return spaceNow();
      if (u === "/api/space/p1/dashboards/deploys-ab12/read") return { ok: true, sources: { deploys: { at: 0, error: "npx exited 1: still not", fails: 4, stopped: true } }, space: spaceNow() };
      const m = /^\/api\/space\/p1\/needs\/(\w+)$/.exec(u);
      if (m && method === "POST") {
        const body = posted.at(-1)?.body || {};
        needs = needs.map((n) => (n.id !== m[1] ? n : body.done ? { ...n, state: "done", doneAt: Date.now(), until: undefined } : body.later ? { ...n, state: "later", until: body.later } : { ...n, state: "open", until: undefined, doneAt: undefined }));
        return { ok: true, row: needs.find((n) => n.id === m[1]), space: spaceNow() };
      }
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did, space } = mountSpace(lookOf({ c20: { title: "on main", when: at, line: "" }, c21: { title: "the agent", when: at, line: "" } }, { c21: { group: "needs", fact: "asks which branch", at } }));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-need.is-out"), "the kept rows");
    const sec = host.querySelector(".sp-needs-sec");
    assert.equal(sec.querySelector(".sp-sec-count").textContent, "4", "the chats' and the kept ones, one count");
    assert.deepEqual(sec.querySelectorAll(".sp-sec-h .sp-quiet").map((/** @type {any} */ e) => [e.textContent, e.hidden]),
      [["Nothing needs you here.", true], ["its chats', as Now has them, and its dashboards'", false]]);
    const drawn = () => sec.querySelectorAll(".sp-need").map((/** @type {any} */ e) => [e.getAttribute("data-chain") || e.getAttribute("data-need"), e.getAttribute("class")]);
    assert.deepEqual(drawn(), [["c21", "sp-need is-asks"], ["s1", "sp-need is-out is-source"], ["w1", "sp-need is-out is-watch"], ["w2", "sp-need is-out is-watch"]], "the chats' first, then what stopped, then the newest");
    const kept = (/** @type {string} */ id) => sec.querySelector(`.sp-need[data-need="${id}"]`);
    assert.deepEqual([kept("w1").querySelector(".sp-need-t").textContent, kept("w1").querySelector(".sp-need-f").textContent, kept("w1").querySelector(".sp-need-why").textContent],
      ["CI failed on main: run w1", "Deploys · 10m", `why: ${WHY}`]);
    assert.deepEqual([kept("w2").querySelector(".sp-need-src").textContent, kept("w2").querySelector(".sp-need-src").tagName.toLowerCase()], ["Old · taken out", "span"], "taken out: no tab to open");
    // The minute moves the ages alone: the rows stay the same elements, so a menu open on one keeps its button.
    // (fails before: yes — found at the live look: each minute drew the rows again, an open Not now ▾ lost its button)
    const before = kept("w1");
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      space.paint();
    } finally {
      Date.now = realNow;
    }
    assert.equal(kept("w1"), before, "the same row");
    assert.equal(kept("w1").querySelector(".sp-need-f").textContent, "Deploys · 11m");
    const labels = (/** @type {any} */ e) => e.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.getAttribute("aria-label") || b.textContent);
    assert.deepEqual([labels(kept("s1")), labels(kept("w1"))], [["Fix it…", "Read again", "Not now", "Done"], ["Hand to an agent…", "Reproduce…", "Not now", "Done"]]);
    // Reproduce… (S7-D1): the row's words and where it came from, for the Tester's Start; nothing sent.
    // (fails before: yes — there was no Reproduce…)
    const was = posted.length;
    kept("w1").querySelector(".sp-need-repro").dispatch("click");
    assert.deepEqual(did.repro.at(-1), ["/r", { title: "CI failed on main: run w1", text: "", from: `Deploys, a dashboard in r's Space, put it in Needs you — ${WHY}` }]);
    assert.equal(posted.length, was, "nothing sent");
    // Hand to an agent… (S5d): the Start in the project's folder, the row in its box; nothing sent, the row stays.
    // (fails before: yes — a watch's row had no way to an agent)
    const sent = posted.length;
    kept("w1").querySelector(".sp-need-hand").dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", `“Deploys”, a dashboard in r's Space, put this in Needs you as row w1: CI failed on main: run w1 (why: ${WHY}). Once it is dealt with, mark the row done with the space tool, in a line on what you did. Look into it: `]);
    assert.equal(posted.length, sent, "nothing sent");
    assert.ok(kept("w1"), "the row stays until you mark it Done");
    // A check that says a button did not work (S5d): red, with what fails; Hand to an agent… with what ran and why.
    // (fails before: yes — there were no checks)
    const CHECK = { label: "Roll back to this…", ran: "npx wrangler rollback 3f2a --yes", said: "Rolled back to 3f2a", reason: "7c1e still serves" };
    needs = [...needs, row("k1", { kind: "check", text: "“Roll back to this…” on Deploys did not do what it was for", why: "an agent checked it: 7c1e still serves", watch: undefined, check: CHECK, at: at - 5 * 60_000 })];
    hear({ type: "space", project: "p1" });
    await until(() => kept("k1"), "the check's row");
    assert.equal(kept("k1").getAttribute("class"), "sp-need is-out is-check");
    assert.deepEqual(drawn().slice(0, 4).map((x) => x[0]), ["c21", "k1", "s1", "w1"], "with what fails — the newest first —, before what a watch found");
    assert.deepEqual(labels(kept("k1")), ["Hand to an agent…", "Reproduce…", "Not now", "Done"]);
    kept("k1").querySelector(".sp-need-repro").dispatch("click");
    assert.deepEqual(did.repro.at(-1)?.[1].text, "I pressed “Roll back to this…”: it ran npx wrangler rollback 3f2a --yes and said: Rolled back to 3f2a. An agent checked it and says it did not work: 7c1e still serves.", "what was pressed, what it said, why the agent says no");
    kept("k1").querySelector(".sp-need-hand").dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", "On “Deploys”, a dashboard in r's Space, I pressed “Roll back to this…”: it ran npx wrangler rollback 3f2a --yes and said: Rolled back to 3f2a. An agent checked it and says it did not work: 7c1e still serves. It is row k1 of Needs you: once it is dealt with, mark it done with the space tool, in a line on what you did. Find out why, and fix it: "]);
    needs = needs.filter((n) => n.id !== "k1");
    hear({ type: "space", project: "p1" });
    await until(() => !kept("k1"), "the check's row gone again");
    // Fix it…: the Start, its failure in the box, as its tab's Fix with an agent… says it; nothing sent.
    kept("s1").querySelectorAll(".sp-need-acts button")[0].dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", "The dashboard “Deploys” (artifact deploys-ab12) in r's Space couldn't read its source deploys: npx exited 1: not authenticated Find out why, fix it, and publish its next version: "]);
    // Read again: the source read; one that still fails says so.
    const had = toasts().length;
    kept("s1").querySelectorAll(".sp-need-acts button")[1].dispatch("click");
    // Its toast shown: the class comes a frame after the toast (under the suite's load, read too soon — 10-25).
    await until(() => toasts().length > had && /\bshow\b/.test(toasts().at(-1)?.[1] || ""), "Read again's answer");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/dashboards/deploys-ab12/read", body: { source: "deploys" } });
    assert.deepEqual(toasts().at(-1), ["deploys still fails: npx exited 1: still not", "zc-toast err show"]);
    // A menu open on a row keeps its button as the list draws a new row: the rows are drawn in place, each kept by its
    // key, so the menu stays, at the button that stood (the owner's of 11-01: buttons blinking under a resting pointer,
    // clicks lost; before, a new row drew every row anew and the menu closed with its button).
    // (fails before: yes — the list was drawn anew: w2's Not now was a new button, and the menu closed)
    const later = kept("w2").querySelector(".sp-need-later");
    await menuOf(later, "Not now's menu");
    needs = [...needs, row("w3", {})];
    hear({ type: "space", project: "p1" });
    await until(() => kept("w3"), "the new row drawn");
    // The very element, said in a word: a diff of two page trees is more than the reporter can hold.
    assert.ok(kept("w2").querySelector(".sp-need-later") === later, "w2's Not now, the button that stood");
    assert.ok(doc.document.body.querySelector(".zc-menu"), "its menu open still, at that button");
    later.dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "a second press closes it");
    needs = needs.filter((n) => n.id !== "w3");
    hear({ type: "space", project: "p1" });
    await until(() => !kept("w3"), "the row gone again");
    // A draft among them: the heading's words name it, not the dashboards alone.
    // (fails before: yes — found at S5c's live look: two drafts alone were "what its dashboards found")
    const words = () => sec.querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent;
    needs = [...needs, row("n9", { kind: "draft", text: "Reply to Sara", why: "", dashboard: "", title: "Draft", watch: undefined,
      draft: { connection: "slack", tool: "post_message", args: { text: "{words}" }, words: "Not today.", from: [], chain: "c21", byName: "the agent", account: "" } })];
    hear({ type: "space", project: "p1" });
    await until(() => kept("n9"), "the draft drawn");
    assert.equal(words(), "its chats', as Now has them, its dashboards' and its drafts");
    needs = needs.filter((n) => n.id !== "n9");
    hear({ type: "space", project: "p1" });
    await until(() => !kept("n9"), "the draft gone again");
    assert.equal(words(), "its chats', as Now has them, and its dashboards'");
    // Not now ▾: tomorrow 09:00, Monday 09:00 unless that is tomorrow; the row hides until then.
    const items = await menuOf(kept("w2").querySelector(".sp-need-later"), "Not now's choices");
    const choices = notNowChoices(Date.now());
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), choices.map((c) => c.label));
    items[0].dispatch("click");
    await until(() => !kept("w2"), "put off");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w2", body: { later: choices[0].until } });
    // Done: it leaves for Done today.
    kept("w1").querySelector(".sp-need-done").dispatch("click");
    await until(() => !kept("w1"), "done");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w1", body: { done: true } });
    assert.equal(sec.querySelector(".sp-sec-count").textContent, "2");
    assert.deepEqual(texts(sec, ".sp-needs-part"), ["Done today: 2 · Show", "2 later · Show"]);
    // Show: the list, each row's Bring back; Bring back sends it back.
    sec.querySelectorAll(".sp-needs-show")[0].dispatch("click");
    const past = () => sec.querySelectorAll(".sp-past").map((/** @type {any} */ e) => [e.getAttribute("data-need"), e.querySelector(".sp-past-back").textContent]);
    await until(() => past().length === 2, "Done today's list");
    assert.deepEqual(past().map((x) => x[1]), ["Bring back", "Bring back"]);
    assert.match(sec.querySelector(".sp-past-when").textContent, /^Deploys · done \d\d:\d\d$/);
    sec.querySelector('.sp-past[data-need="w1"] .sp-past-back').dispatch("click");
    await until(() => kept("w1"), "back in Needs you here");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w1", body: { back: true } });
    sec.querySelectorAll(".sp-needs-show")[1].dispatch("click");
    await until(() => past().length === 2 && past()[0][1] === "Bring back now", "the later list");
    assert.deepEqual(texts(sec, ".sp-past-when"), [`Deploys · until ${untilWords(at + HOUR, Date.now())}`, `Old · until ${untilWords(choices[0].until, Date.now())}`], "the soonest back first");
    // A row's chip opens its dashboard's page.
    kept("s1").querySelector(".sp-need-src").dispatch("click");
    await until(() => host.querySelector(".sp-crumb-app").textContent === "Deploys" && host.querySelector(".sdb-view").hidden === false, "its page");
  });

  // HarnessV4_Space_Plan S7, the mock's screen 14: what an agent found reproducing a report, as Needs you here draws it —
  // Reproduced: its failing test and how to run it, Fix it… (the Start in its lane's folder), Open the lane; Couldn't
  // reproduce: what it tried, its questions, Review & send… where it drafted them, else Copy the questions.
  // (fails before: yes — there were no reproductions)
  test("a reproduction: Reproduced with Fix it… in its lane and Open the lane; Couldn't reproduce with Review & send… or Copy the questions", async () => {
    const at = Date.now();
    const repro = (/** @type {any} */ o) => ({ reproduced: true, test: "tests/auth/safari-loop.spec.ts", run: "npx playwright test safari-loop --project=webkit", said: "fails on main, 3 runs of 3", steps: "", tried: [], questions: [], draft: "", chain: "c30", byName: "Tester (for Repro PLAY-91)", cwd: "/r-wt/repro-play-91", ...o });
    /** @type {any[]} */
    let needs = [
      { id: "n4", kind: "repro", text: "Reproduced: PLAY-91 Sign-in loops on Safari", why: "", dashboard: "", title: "PLAY-91 Sign-in loops on Safari", repro: repro({}), at: at - 4 * 60_000, state: "open" },
      { id: "n5", kind: "repro", text: "Couldn't reproduce: PLAY-92 Blank page on Edge", why: "", dashboard: "", title: "PLAY-92 Blank page on Edge", at: at - 6 * 60_000, state: "open",
        repro: repro({ reproduced: false, test: "", run: "", said: "", tried: ["a WebKit test with a return URL", "the Browser pane at 390 × 844"], questions: ["Which Safari, and which version?", "Private browsing on?"], chain: "c31", cwd: "/r-wt/repro-play-92" }) },
    ];
    const spaceNow = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return spaceNow();
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did } = mountSpace(lookOf({}, {}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-need.is-repro"), "the reproductions");
    const sec = host.querySelector(".sp-needs-sec");
    const kept = (/** @type {string} */ id) => sec.querySelector(`.sp-need[data-need="${id}"]`);
    const labels = (/** @type {any} */ e) => e.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.getAttribute("aria-label") || b.textContent);
    assert.equal(sec.querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent, "what its agents found reproducing a report", "whose rows they are");
    assert.equal(kept("n4").getAttribute("class"), "sp-need is-out is-repro is-reproduced");
    assert.deepEqual(texts(kept("n4"), ".sp-need-line"), ["A failing test: tests/auth/safari-loop.spec.ts — fails on main, 3 runs of 3.", "Run: npx playwright test safari-loop --project=webkit"]);
    assert.match(kept("n4").querySelector(".sp-need-f").textContent, /^Tester \(for Repro PLAY-91\) · 4m$/);
    assert.deepEqual(labels(kept("n4")), ["Fix it…", "Open the lane", "Not now", "Done"]);
    // Fix it…: the Start in the lane's folder, the test and how to run it in the box; nothing sent.
    const sent = posted.length;
    kept("n4").querySelectorAll(".sp-need-acts button")[0].dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r-wt/repro-play-91", "Fix “PLAY-91 Sign-in loops on Safari”. The failing test tests/auth/safari-loop.spec.ts shows it — run it with: npx playwright test safari-loop --project=webkit. It said: fails on main, 3 runs of 3. It is row n4 of Needs you: once it is fixed, mark it done with the space tool, in a line on what you changed. Make it pass without weakening it, and say what you changed: "]);
    assert.equal(posted.length, sent, "nothing sent");
    kept("n4").querySelectorAll(".sp-need-acts button")[1].dispatch("click");
    assert.deepEqual(did.opened.at(-1), "c30", "Open the lane: the chat that reproduced it");
    // Couldn't reproduce: what it tried and its questions; no draft, so Copy the questions — this page has no clipboard.
    assert.deepEqual(texts(kept("n5"), ".sp-need-line"), ["Tried 2 ways: a WebKit test with a return URL; the Browser pane at 390 × 844.", "2 questions for the reporter: “Which Safari, and which version?” · “Private browsing on?”"]);
    assert.deepEqual(labels(kept("n5")), ["Copy the questions", "Open the lane", "Not now", "Done"]);
    const had = toasts().length;
    kept("n5").querySelector(".sp-need-copy").dispatch("click");
    await until(() => toasts().length > had, "Copy's word");
    assert.deepEqual(toasts().at(-1)?.[0], "This page cannot copy: the questions are on the row");
    // Its questions drafted: Review & send… in Copy's place, and "drafted" on its line.
    needs = [
      needs[0],
      { ...needs[1], repro: { ...needs[1].repro, draft: "n9" } },
      { id: "n9", kind: "draft", text: "Questions on PLAY-92", why: "", dashboard: "", title: "Draft", at, state: "open",
        draft: { connection: "linear", tool: "create_comment", args: { body: "{words}" }, words: "Which Safari?", to: "PLAY-92", answers: null, from: [], chain: "c31", byName: "Tester", account: "" } },
    ];
    hear({ type: "space", project: "p1" });
    await until(() => labels(kept("n5"))[0] === "Review & send…", "Review & send… for its draft");
    assert.match(texts(kept("n5"), ".sp-need-line")[1], /^2 questions for the reporter, drafted: /);
    // (fails before: yes — found by the Hunter on S7: its draft sent, the row still offered Review & send… and no Copy;
    // and a reproduction whose lane's folder was not recorded had no Fix it…)
    needs = [
      { ...needs[0], repro: { ...needs[0].repro, cwd: "" } },
      needs[1],
      { ...needs[2], state: "done", doneAt: at, outcome: "sent" },
    ];
    hear({ type: "space", project: "p1" });
    await until(() => labels(kept("n5"))[0] === "Copy the questions", "Copy once its draft was sent");
    assert.deepEqual(labels(kept("n5")), ["Copy the questions", "Open the lane", "Not now", "Done"]);
    assert.match(texts(kept("n5"), ".sp-need-line")[1], /^2 questions for the reporter, sent: /);
    assert.deepEqual(labels(kept("n4")), ["Fix it…", "Open the lane", "Not now", "Done"]);
    const fix = kept("n4").querySelectorAll(".sp-need-acts button")[0];
    assert.match(fix.getAttribute("title"), /^Its lane's folder was not recorded, so the Start is in the project's folder/);
    fix.dispatch("click");
    assert.equal(did.words.at(-1)?.[0], "/r", "the project's folder");
  });

  // HarnessV4_SpacesPlugins_Plan A7: a Space of your own shows projects — each one's chats that ask you, its rows and its
  // tiles, under From its projects; a row done here is done in its own Space; Project… picks one, Stop showing lets it go.
  // (fails before: yes — a Space of your own showed nothing of a project)
  test("a Space of your own shows projects: their asks, rows and tiles; Done goes to the project's Space; Project… and Stop showing", async () => {
    const at = Date.now();
    /** @type {string[]} */
    let shows = [];
    let rowState = "open";
    const app = () => ({
      id: "p2", name: "app", cwd: "/app",
      needs: [{ id: "n7", kind: "repro", text: "Reproduced: PLAY-91 Sign-in loops on Safari", why: "", dashboard: "", title: "PLAY-91 Sign-in loops on Safari", project: "p2", at: at - 4 * 60_000, state: rowState,
        ...(rowState === "done" ? { doneAt: at } : {}),
        repro: { reproduced: true, test: "tests/safari.spec.ts", run: "npx playwright test safari", said: "fails", steps: "", tried: [], questions: [], draft: "", chain: "c41", byName: "Tester", cwd: "/app-wt/repro" } }],
      dashboards: [{ name: "deploys-ab12", title: "Deploys", state: "kept", paused: false }],
      glance: [{ project: "p2", name: "deploys-ab12", title: "Deploys", paused: false, tiles: [] }],
    });
    const spaceNow = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [],
      own: { name: "Work", folder: "/r", repo: true }, shows: shows.map(() => app()) });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceNow();
      if (u === "/api/space/p1/own/shows") {
        const b = posted.at(-1)?.body;
        shows = b.add ? [...shows, b.add] : shows.filter((s) => s !== b.drop);
        return { ok: true, shows, space: spaceNow() };
      }
      if (u === "/api/space/p2/needs/n7") return (rowState = "done"), { ok: true, row: {}, space: {} };
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    /** @type {string[]} */
    const spaces = [];
    /** @type {string[]} */
    const rowsOpened = [];
    const asking = { key: "c40", chain: "c40", thread: null, group: "needs", title: "Fix login", project: "app", fact: "asks: which env?", tone: "asks", icon: "", tile: "needs", model: "", at: at - 60_000, under: [], team: "", step: "" };
    const { host, did } = mountSpace(lookOf({}), { cb: {
      projects: () => [{ id: "p1", name: "Work", cwd: "/r" }, { id: "p2", name: "app", cwd: "/app" }, { id: "p3", name: "Personal", cwd: "/p" }, { id: "p4", name: "web", cwd: "/web" }],
      ownSpaces: () => [{ project: "p1", name: "Work" }, { project: "p3", name: "Personal" }],
      asking: (id) => (id === "p2" ? [/** @type {any} */ (asking)] : []),
      openRow: (r) => void rowsOpened.push(r.chain),
      openSpace: (id, tab) => void spaces.push(tab ? `${id} › ${tab}` : id),
    } });
    await lanesDrawn(host);
    await until(() => times("/api/space/p1") === 1, "the Space read");
    const sec = host.querySelector(".sp-shows-sec");
    assert.equal(sec.hidden, true, "it shows no project yet");
    assert.deepEqual(texts(host, ".sp-overview .sp-sec-name"), ["Needs you here", "Lanes", "Runs by itself", "Tasks", "What happened"]);
    // Project…: your projects, not your Spaces nor this one; a press shows it here.
    const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["New app…", "Routine…", "Watcher…", "Include a project…", "What do you look after…"]);
    items[3].dispatch("click");
    await until(() => doc.document.body.querySelector(".pkp-row"), "the picker");
    const picker = doc.document.body.querySelector(".pkp-body");
    assert.equal(picker.querySelector(".pkp-what").textContent, "Its chats get this Space's connectors and plugins; what needs you in it, and its apps' numbers, show here.");
    assert.deepEqual(picker.querySelectorAll(".pkp-row").map((/** @type {any} */ r) => r.getAttribute("data-place")), ["p2", "p4"]);
    picker.querySelectorAll(".pkp-row")[0].dispatch("click");
    await until(() => !sec.hidden, "From its projects");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/own/shows", body: { add: "p2" } });
    assert.deepEqual(texts(host, ".sp-overview .sp-sec-name"), ["Needs you here", "From its projects", "Lanes", "Runs by itself", "Tasks", "What happened"]);
    // Its chip, what needs you there; its chat that asks you, then its row; its dashboard's card.
    const block = () => host.querySelector('.sp-show[data-project="p2"]');
    assert.deepEqual([block().querySelector(".sp-show-chip").textContent, block().querySelector(".sp-show-count").textContent], ["app", "2 need you there"]);
    assert.deepEqual(block().querySelectorAll(".sp-need").map((/** @type {any} */ r) => r.getAttribute("data-chain") || r.getAttribute("data-need")), ["c40", "n7"]);
    await until(() => !block().querySelector(".sp-show-tiles").hidden, "its tiles");
    assert.deepEqual(block().querySelectorAll(".ys-card").map((/** @type {any} */ c) => c.getAttribute("data-dashboard")), ["deploys-ab12"]);
    block().querySelector(".sp-need").dispatch("click");
    assert.deepEqual(rowsOpened, ["c40"], "its chat, as Now opens it");
    // Fix it… starts in the lane the row names; Done goes to the project's own Space, and this one is read again.
    const row = block().querySelector('.sp-need[data-need="n7"]');
    row.querySelectorAll(".sp-need-acts button")[0].dispatch("click");
    assert.equal(did.words.at(-1)?.[0], "/app-wt/repro");
    const reads = times("/api/space/p1");
    row.querySelector(".sp-need-done").dispatch("click");
    await until(() => times("/api/space/p1") > reads && !block()?.querySelector('[data-need="n7"]'), "done there, gone here");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p2/needs/n7", body: { done: true } });
    assert.equal(block().querySelector(".sp-show-count").textContent, "1 needs you there");
    // The project's Space moved: this one reads again.
    const before = times("/api/space/p1");
    hear({ type: "space", project: "p2" });
    await until(() => times("/api/space/p1") > before, "read as p2 moved");
    block().querySelector(".sp-show-chip").dispatch("click");
    block().querySelector(".ys-card").dispatch("click");
    assert.deepEqual(spaces, ["p2", "p2 › deploys-ab12"], "its chip opens its own Space, its card the dashboard's page there");
    // ⋯ Stop showing here: its rows and tiles leave this page.
    const more = await menuOf(block().querySelector(".sp-show-more"), "⋯");
    assert.deepEqual(more.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Stop showing here"]);
    more[0].dispatch("click");
    await until(() => sec.hidden, "shown no more");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/own/shows", body: { drop: "p2" } });
    assert.deepEqual(texts(host, ".sp-overview .sp-sec-name"), ["Needs you here", "Lanes", "Runs by itself", "Tasks", "What happened"]);
  });

  // HarnessV4_Space_Plan S5b, the mock's screen 2: Your Space — every project's Needs you in one list (the chats' asks,
  // then what fails, then what a watch brought), filters that are counts, each row's project chip; At a glance's cards,
  // a paused one said so; Working and what finished today; nothing sent on a press but what a row's own button posts.
  // (fails before: yes — there was no Your Space)
  test("Your Space: every project's rows in one list, its filters, At a glance's cards, Working; a press opens, Done posts", async () => {
    const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
    const at = Date.now();
    const MIN = 60_000;
    /** @param {string} id @param {any} o */
    const need = (id, o) => ({ id, kind: "watch", text: `CI failed on main: run ${id}`, why: "a watch of Deploys", dashboard: "deploys-ab12", title: "Deploys", watch: "w0", at: at - 10 * MIN, state: "open", project: "p1", ...o });
    let needs = [
      need("w1", {}),
      need("s1", { kind: "source", text: "CI stopped reading runs: gh exited 4", why: "a kept dashboard's source failed 3 times in a row", dashboard: "ci-x1", title: "CI", source: "runs", watch: undefined, at: at - 30 * MIN, project: "p2" }),
      need("d1", { state: "done", doneAt: at - MIN }),
    ];
    const tile = (/** @type {any} */ o) => ({ read: true, at, stale: false, error: null, ...o });
    const answer = () => ({
      projects: [{ id: "p1", name: "app", cwd: "/r" }, { id: "p2", name: "api", cwd: "/a" }],
      needs,
      dashboards: { p1: [{ name: "deploys-ab12", title: "Deploys", state: "kept", paused: false }], p2: [{ name: "ci-x1", title: "CI", state: "kept", paused: false }] },
      glance: [
        { project: "p1", name: "deploys-ab12", title: "Deploys", paused: false, tiles: [
          tile({ title: "Live now", from: "deploys", line: { title: "Live now", value: "7c1e", format: "text", words: "", tone: "", at: at - 12 * MIN } }),
          tile({ title: "CI on main", from: "runs", line: { title: "CI on main", value: "failure", format: "text", words: "", tone: "bad", at: null }, at: at - 2 * MIN, stale: true, error: "gh exited 4" }),
        ] },
        { project: "p2", name: "ci-x1", title: "CI", paused: true, tiles: [] },
      ],
      extended: true,
    });
    serve = (u, method) => {
      if (u === "/api/your-space" && method === "GET") return answer();
      const m = /^\/api\/space\/(p\d)\/needs\/(\w+)$/.exec(u);
      if (m && method === "POST") {
        needs = needs.map((n) => (n.id === m[2] ? { ...n, state: "done", doneAt: Date.now() } : n));
        return { ok: true, space: {} };
      }
      return undefined;
    };
    /** @param {any} o */
    const nowRow = (o) => ({ thread: null, group: "needs", fact: "", tone: "", icon: "messageSquare", tile: "model", model: "", under: [], team: "", step: "", ...o, key: `chat:${o.chain}` });
    const groups = {
      needs: [nowRow({ chain: "c1", title: "login", project: "app", fact: "asks which branch", tone: "asks", at: at - 3 * MIN }), nowRow({ chain: "c2", title: "build", project: "api", fact: "Stopped: boom", tone: "error", at: at - 5 * MIN })],
      works: [nowRow({ chain: "c3", group: "works", title: "search", project: "app", fact: "reads files", at: at - MIN })],
      done: [nowRow({ chain: "c4", group: "done", title: "docs", project: "app", at: at - 2000 }), nowRow({ chain: "c5", group: "done", title: "old", project: "app", at: at - 2 * 86_400_000 })],
    };
    const did = { rows: /** @type {string[]} */ ([]), spaces: /** @type {string[]} */ ([]), closed: 0 };
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => groups, openRow: (r) => void did.rows.push(r.chain), openSpace: (id, tab) => void did.spaces.push(tab ? `${id} › ${tab}` : id), startWith: () => {}, onClose: () => void did.closed++ });
    stops.push(ys.stop);
    await until(() => host.querySelector(".sp-need.is-out"), "the rows read");
    const root = host.querySelector(".your-space");
    assert.equal(root.querySelector(".sp-crumb-page").textContent, "Home");
    assert.equal(root.querySelector(".ys-tabs"), null, "no tab strip while Today is its only page (A1)");
    assert.match(root.querySelector(".sp-line").textContent, /^\w+ \d{1,2} \w+ · 4 need you · 1 working$/);
    // One list: the chats' asks, then what fails — a chat stopped, a source stopped, the newest first —, then a watch's.
    const sec = root.querySelector(".ys-needs");
    const drawn = () => sec.querySelectorAll(".sp-needs .sp-need").map((/** @type {any} */ e) => e.getAttribute("data-chain") || e.getAttribute("data-need"));
    assert.deepEqual(drawn(), ["c1", "c2", "s1", "w1"]);
    assert.equal(sec.querySelector(".sp-sec-count").textContent, "4");
    assert.deepEqual(texts(sec, ".ys-filter"), ["All 4", "Chats 1", "Failing 2", "News 1"]);
    // A kept row's project chip first; a press opens that project's Space.
    const s1 = sec.querySelector('.sp-need[data-need="s1"]');
    assert.deepEqual(s1.querySelector(".sp-need-f").children.slice(0, 2).map((/** @type {any} */ e) => e.textContent), ["api", "CI"]);
    s1.querySelector(".ys-proj").dispatch("click");
    assert.deepEqual(did.spaces, ["p2"]);
    // A filter filters in place.
    sec.querySelector('.ys-filter[data-filter="failing"]').dispatch("click");
    assert.deepEqual(drawn(), ["c2", "s1"]);
    assert.equal(sec.querySelector(".ys-filter.is-on").textContent, "Failing 2");
    sec.querySelector('.ys-filter[data-filter="all"]').dispatch("click");
    // A chat's row opens it.
    sec.querySelector('.sp-need[data-chain="c1"]').dispatch("click");
    assert.deepEqual(did.rows, ["c1"]);
    // Done posts to the row's own Space; read again, it leaves for Done today.
    sec.querySelector('.sp-need[data-need="w1"] .sp-need-done').dispatch("click");
    await until(() => !sec.querySelector('.sp-need[data-need="w1"]'), "done");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w1", body: { done: true } });
    assert.deepEqual(texts(sec, ".sp-needs-part"), ["Done today: 2 · Show"]);
    assert.deepEqual(texts(sec, ".ys-filter"), ["All 3", "Chats 1", "Failing 2"], "no News: none is left (A5)");
    // At a glance: its cards, each tile's line in its tab's words; a stale one "as of"; a paused one said so (A4).
    const cards = root.querySelectorAll(".ys-card");
    assert.deepEqual(cards.map((/** @type {any} */ c) => c.getAttribute("data-dashboard")), ["deploys-ab12", "ci-x1"]);
    assert.deepEqual(cards[0].querySelector(".ys-card-h").children.map((/** @type {any} */ e) => e.textContent), ["Deploys", "app"]);
    const lines = cards[0].querySelectorAll(".ys-g-line");
    assert.equal(lines[0].textContent, "Live now 7c1e · 12 min ago");
    assert.match(lines[1].textContent, /^CI on main failure · as of \d\d:\d\d$/);
    assert.deepEqual([lines[1].getAttribute("class"), lines[1].querySelector(".ys-g-value").getAttribute("class")], ["ys-g-line is-stale", "ys-g-value is-bad"]);
    assert.equal(cards[1].querySelector(".ys-g-line").textContent, "Paused: resume it in its Space");
    cards[0].dispatch("click");
    assert.deepEqual(did.spaces, ["p2", "p1 › deploys-ab12"], "its page, in its Space");
    // Working; under it what finished today alone, behind its Show (A9).
    const works = root.querySelector(".ys-works");
    assert.deepEqual(works.querySelectorAll(".ys-chat").map((/** @type {any} */ e) => [e.getAttribute("data-chain"), e.getAttribute("class")]), [["c3", "sp-need ys-chat is-works"]]);
    assert.equal(works.querySelector(".sp-needs-part").textContent, "Finished today: 1 · Show");
    works.querySelector(".sp-needs-show").dispatch("click");
    assert.deepEqual(works.querySelectorAll(".ys-done-list .ys-chat").map((/** @type {any} */ e) => e.getAttribute("data-chain")), ["c4"]);
    // Back to chat.
    root.querySelector(".sp-top-acts button").dispatch("click");
    assert.equal(did.closed, 1);
    // A Space moved: read again.
    const reads = times("/api/your-space");
    hear({ type: "space", project: "p1" });
    await until(() => times("/api/your-space") > reads, "read again");
    ys.stop();
    host.remove();
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-5: a read of Home that failed over an answer read before kept the
  // answer and hid the failure, so its rows passed for every project's as they stand)
  test("Home: a read that fails over an answer read before keeps its rows and says the last read failed; read again, it says nothing of it", async () => {
    const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
    const at = Date.now();
    let refuse = false;
    const answer = () => ({
      projects: [{ id: "p1", name: "app", cwd: "/r" }],
      needs: [{ id: "w1", kind: "watch", text: "CI failed on main: run w1", why: "a watch of Deploys", dashboard: "deploys-ab12", title: "Deploys", watch: "w0", at: at - 60_000, state: "open", project: "p1" }],
      dashboards: { p1: [{ name: "deploys-ab12", title: "Deploys", state: "kept", paused: false }] },
      glance: [],
      extended: true,
    });
    serve = (u, method) => (u === "/api/your-space" && method === "GET" ? (refuse ? new Refusal(500, "the archive is busy") : answer()) : undefined);
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => ({ needs: [], works: [], done: [] }), openRow: () => {}, openSpace: () => {}, onClose: () => {} });
    stops.push(ys.stop);
    await until(() => host.querySelector('.sp-need[data-need="w1"]'), "the rows read");
    const line = host.querySelector(".sp-line");
    assert.match(line.textContent, /^\w+ \d{1,2} \w+ · 1 needs you$/);
    refuse = true;
    hear({ type: "space", project: "p1" });
    await until(() => /last read failed/.test(line.textContent), "its failure, said");
    assert.match(line.textContent, /^\w+ \d{1,2} \w+ · 1 needs you · the last read failed: the archive is busy$/);
    assert.ok(host.querySelector('.sp-need[data-need="w1"]'), "the rows read before stay");
    refuse = false;
    hear({ type: "space", project: "p1" });
    await until(() => !/last read failed/.test(line.textContent), "read again: nothing of a failure");
    assert.match(line.textContent, /^\w+ \d{1,2} \w+ · 1 needs you$/);
    ys.stop();
    host.remove();
  });

  // HarnessV4_Space_Plan S5c, the mock's screen 13: a draft — its row ("Draft · its title", From, by its chat),
  // Review & send…'s sheet (From's accounts, In, the words it answers, your words, Made from's links, the call), Send
  // posting your words as the account picked, a failure staying in the sheet, Send off where the tool sends nothing, Ask
  // for a change… opening its chat with its box filled, Discard; a sent one in Done today has no Bring back.
  // (fails before: yes — there were no drafts)
  test("a draft: its row; its sheet — From, In, the quote, your words, Made from, the call —; Send posts your words, a failure stays; Ask for a change…; Discard", async () => {
    const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
    const at = Date.now();
    const DRAFT = {
      connection: "slack", tool: "post_message", args: { channel: "releases", text: "{words}" }, words: "Not today: CI is red.",
      to: "#releases, the thread “can we ship 1.8 today?”", answers: { who: "Sara", words: "can we ship 1.8 today?" },
      from: ["CI run 8812 https://ci.example.invalid/runs/8812", "PR #412"], chain: "c1", byName: "login", account: "main",
    };
    /** @type {any[]} */
    let needs = [{ id: "n4", kind: "draft", text: "Reply to Sara in #releases", why: "", dashboard: "", title: "Draft", draft: DRAFT, at: at - 2 * 60_000, state: "open", project: "p1" }];
    let tool = { ok: true, words: "Sends through slack › post_message" };
    /** @type {any} */
    let sendAnswer = { ok: true, sent: false, error: "channel_is_archived" };
    serve = (u, method) => {
      if (u === "/api/your-space" && method === "GET") return { projects: [{ id: "p1", name: "app", cwd: "/r" }], needs, dashboards: { p1: [] }, glance: [], extended: true };
      if (u.startsWith("/api/space/p1/needs/n4/draft") && method === "GET")
        return { row: needs[0], from: { connection: "slack", account: u.endsWith("account=work") ? "work" : "main", accounts: ["main", "work"] }, tool, chat: { name: "login" }, sending: false };
      if (u === "/api/space/p1/needs/n4/send" && method === "POST") return sendAnswer;
      if (u === "/api/space/p1/needs/n4" && method === "POST") {
        needs = needs.map((n) => ({ ...n, state: "done", outcome: "discarded", doneAt: Date.now() }));
        return { ok: true, space: {} };
      }
      return undefined;
    };
    const did = { asks: /** @type {string[][]} */ ([]) };
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => ({ needs: [], works: [], done: [] }), openRow: () => {}, openSpace: () => {}, askChat: (chain, words) => void did.asks.push([chain, words]), onClose: () => {} });
    stops.push(ys.stop);
    await until(() => host.querySelector(".sp-need.is-draft"), "the draft's row");
    const row = host.querySelector(".sp-need.is-draft");
    assert.equal(row.querySelector(".sp-need-t").textContent, "Draft · Reply to Sara in #releases");
    assert.equal(row.querySelector(".sp-need-f").textContent, "app · From: slack · main · by login · 2m");
    assert.deepEqual(row.querySelectorAll(".sp-need-acts button").map((/** @type {any} */ b) => b.textContent), ["Review & send…", "Discard"]);
    /** The sheet, open, with its look read. */
    const open = async () => {
      host.querySelector(".sp-need.is-draft .sp-need-acts button").dispatch("click");
      await until(() => doc.document.body.querySelectorAll(".sds-sheet .sds-account option").length, "the sheet, its look read");
      return /** @type {any} */ (doc.document.body.querySelector(".sds-sheet"));
    };
    const sheet = await open();
    assert.equal(sheet.querySelector(".zc-dialog-title").textContent, "Reply to Sara in #releases");
    assert.deepEqual(sheet.querySelectorAll(".sds-row").map((/** @type {any} */ r) => r.querySelector(".sds-label").textContent), ["From", "In", "Made from"]);
    assert.deepEqual(sheet.querySelectorAll(".sds-account option").map((/** @type {any} */ o) => o.textContent), ["main", "work"]);
    assert.equal(sheet.querySelector(".sds-quote").textContent, "Saracan we ship 1.8 today?");
    assert.equal(sheet.querySelector(".sds-words").value, "Not today: CI is red.");
    assert.deepEqual(sheet.querySelectorAll(".sds-from-list a").map((/** @type {any} */ a) => [a.getAttribute("href"), a.getAttribute("target")]), [["https://ci.example.invalid/runs/8812", "_blank"]]);
    assert.match(sheet.querySelector(".sds-call-args").textContent, /"text": "‹your words›"/);
    // It sends: the call's line says through what, once — the asking line goes.
    assert.equal(sheet.querySelector(".sds-call summary").textContent, "Sends through slack › post_message");
    assert.equal(sheet.querySelector(".sds-tool").hidden, true);
    // Another account: its server asked again as it.
    const acct = sheet.querySelector(".sds-account");
    acct.value = "work";
    acct.dispatch("change");
    assert.equal(/** @type {any} */ (sheetButton("Send")).disabled, true, "off until its server is asked as work");
    await until(() => asked.some((u) => u.endsWith("/needs/n4/draft?account=work")) && !(/** @type {any} */ (sheetButton("Send")).disabled), "asked as work");
    // Your words, Send: posted with the account picked; a failure stays in the sheet.
    const box = sheet.querySelector(".sds-words");
    box.value = "Tomorrow, once #412 is in.";
    box.dispatch("input");
    sheetButton("Send").dispatch("click");
    await until(() => !sheet.querySelector(".sds-said").hidden, "the failure said");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/n4/send", body: { words: "Tomorrow, once #412 is in.", account: "work" } });
    assert.equal(sheet.querySelector(".sds-said").textContent, "Not sent: channel_is_archived");
    // Sent: the sheet closes, a toast with its link.
    sendAnswer = { ok: true, sent: true, said: "Posted", link: "https://chat.example.invalid/p1", row: {}, space: {} };
    sheetButton("Send").dispatch("click");
    await until(() => !doc.document.body.querySelector(".sds-sheet"), "closed once sent");
    assert.equal(toasts().at(-1)?.[0], "Sent “Reply to Sara in #releases” through slack › post_message: https://chat.example.invalid/p1");
    // A tool that sends nothing: Send off, saying why. Ask for a change…: its chat, its box filled; nothing sent.
    tool = { ok: false, words: "slack says post_message only reads: it sends nothing" };
    const off = await open();
    await until(() => off.querySelector(".sds-tool").textContent.startsWith("Send is off"), "Send off");
    assert.equal(off.querySelector(".sds-tool").textContent, "Send is off: slack says post_message only reads: it sends nothing");
    assert.equal(/** @type {any} */ (sheetButton("Send")).disabled, true);
    const sends = posted.length;
    sheetButton("Ask for a change…").dispatch("click");
    assert.deepEqual(did.asks, [["c1", "About your draft n4 “Reply to Sara in #releases”: "]]);
    await until(() => !doc.document.body.querySelector(".sds-sheet"), "closed for its chat");
    assert.equal(posted.length, sends, "nothing posted: its words did not change");
    // Discard: to Done today, with Bring back; a sent one has none.
    host.querySelector(".sp-need-discard").dispatch("click");
    await until(() => !host.querySelector(".sp-need.is-draft"), "discarded");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/n4", body: { discard: true } });
    host.querySelector(".sp-needs-show").dispatch("click");
    await until(() => host.querySelector(".sp-past"), "Done today's list");
    assert.match(host.querySelector(".sp-past-when").textContent, /^app · Draft · discarded \d\d:\d\d$/);
    assert.equal(host.querySelector(".sp-past-back").textContent, "Bring back");
    // Sent: no Bring back; Open goes where its service put it, when its answer said.
    // (fails before: yes — found at S5c's live look: "sent" twice, a second "Sent" where Bring back stands)
    needs = needs.map((n) => ({ ...n, outcome: "sent", draft: { ...n.draft, sent: { as: "work", link: null } } }));
    hear({ type: "space", project: "p1" });
    await until(() => !host.querySelector(".sp-past-back"), "a sent one: no way back");
    assert.match(host.querySelector(".sp-past-when").textContent, /^app · Draft · sent \d\d:\d\d$/);
    assert.equal(host.querySelector(".sp-past-sent"), null, "its answer gave no link: nothing to open");
    needs = needs.map((n) => ({ ...n, doneAt: Date.now() + 1, draft: { ...n.draft, sent: { as: "work", link: "https://chat.example.invalid/releases/p1" } } }));
    hear({ type: "space", project: "p1" });
    await until(() => host.querySelector(".sp-past-sent"), "a sent one with its link");
    const where = host.querySelector(".sp-past-sent");
    assert.deepEqual([where.tagName.toLowerCase(), where.textContent, where.getAttribute("href"), where.getAttribute("target")], ["a", "Open", "https://chat.example.invalid/releases/p1", "_blank"]);
    ys.stop();
    host.remove();
  });

  // HarnessV4_Space_Plan S6, case 16: Your Space's Routines — a tab beside Today once any project has a routine or a
  // kept watch; every project's rows, each with its project's chip; no Routine… (a routine is made in its project's
  // Space); its writes go to the row's Space; Pause all there too.
  // (fails before: yes — Your Space had Today alone)
  test("Your Space's Routines: Today | Routines once one is; each row with its project's chip; Run now to its Space; Pause all", async () => {
    const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
    const at = Date.now();
    const words = { when: "weekdays at 09:00", may: "reads only", allowed: "", last: "last: today 09:00 · done in 41 s", tone: "", said: "", ran: "", why: "", skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "", ...moreWords() };
    /** @type {any[]} */
    let routines = [];
    serve = (u, method) => {
      if (u === "/api/your-space" && method === "GET")
        return { projects: [{ id: "p1", name: "app", cwd: "/r" }], needs: [], dashboards: { p1: [] }, glance: [], extended: true,
          runs: { head: routines.length ? "Runs by itself: 1 routine · next: Morning brief at 09:00" : "", pausedSince: null, routines, watches: [] } };
      if (u === "/api/space/p1/routines/r1/run" && method === "POST") return { ok: true, chain: "c99", space: {} };
      if (u === "/api/spaces/pause" && method === "POST") return { ok: true, pausedSince: at };
      return undefined;
    };
    const did = { opened: /** @type {string[]} */ ([]), spaces: /** @type {string[]} */ ([]) };
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => ({ needs: [], works: [], done: [] }), openRow: () => {}, openSpace: (id) => void did.spaces.push(id), openChat: (id) => void did.opened.push(id), startWith: () => {}, onClose: () => {} });
    stops.push(ys.stop);
    await until(() => times("/api/your-space") >= 1 && host.querySelector(".sp-needs-none"), "Your Space read");
    assert.equal(host.querySelector(".ys-strip").hidden, true, "no routine, no watch: Today alone, no tabs (A1)");
    routines = [{ id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "on", paused: false, madeIn: "c20", madeBy: "", madeName: "on main",
      model: "", project: "p1", last: { at, chain: "c97", by: "time", state: "done", said: "3 for you" }, words: { ...words, said: "3 for you" } }];
    hear({ type: "space", project: "p1", seq: 2 });
    await until(() => !host.querySelector(".ys-strip").hidden, "Today | Routines");
    assert.deepEqual(host.querySelectorAll(".ys-strip .sdb-tab").map((/** @type {any} */ t) => t.textContent), ["Today", "Routines"]);
    host.querySelectorAll(".ys-strip .sdb-tab")[1].dispatch("click");
    assert.deepEqual([host.querySelector(".ys-cols").hidden, host.querySelector(".srt").hidden], [true, false], "Routines over Today");
    assert.equal(host.querySelector(".srt-make").hidden, true, "no Routine… here: one is made in its project's Space");
    const row = host.querySelector('.srt-row[data-routine="r1"]');
    assert.equal(row.querySelector(".srt-t").textContent, "Morning brief app", "its project's chip");
    assert.deepEqual([row.querySelector(".srt-last").textContent, row.querySelector(".srt-next").textContent], ["last: today 09:00 · done in 41 s · “3 for you”", "next: tomorrow 09:00"], "its next time by Run now");
    row.querySelector(".srt-go").dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/space/p1/routines/r1/run"), "Run now, to its Space");
    row.querySelector(".now-proj").dispatch("click");
    assert.deepEqual(did.spaces, ["p1"], "its chip opens its Space");
    host.querySelector(".srt-pause").dispatch("click");
    sheetButton("Pause every Space").dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/spaces/pause"), "Pause all");
    assert.deepEqual(posted.find((p) => p.url === "/api/spaces/pause")?.body, { on: true });
    // Left and opened again, it shows Routines once its read lands: the first paint, before the read, does not forget it.
    // (fails before: yes — the first paint clamped the tab kept to Today, found by the Hunter on S6)
    ys.stop();
    host.remove();
    const again = h("div", { class: "main-frame" });
    doc.document.body.append(again);
    const back = renderYourSpace(again, { now: () => ({ needs: [], works: [], done: [] }), openRow: () => {}, openSpace: () => {}, openChat: () => {}, startWith: () => {}, onClose: () => {} });
    stops.push(back.stop);
    await until(() => !again.querySelector(".ys-strip").hidden, "the strip, once read");
    assert.deepEqual([again.querySelector(".ys-strip .is-on")?.getAttribute("data-tab"), again.querySelector(".ys-cols").hidden, again.querySelector(".srt").hidden], ["routines", true, false], "back on Routines");
  });

  // HarnessV4_Space_Plan S3: a button pressed in a dashboard's page only asks; Filament's sheet, outside it, says what
  // runs — its sentence, its field, the command as typed —; Run sends the row's key and the answers; a failure stays in
  // the sheet in its words; done, it closes with a toast of the program's last line. A refusal before a sheet: a toast.
  // (fails before: yes — a dashboard had no buttons)
  test("a dashboard's button: Filament's sheet, its command as typed, Run; a failure in the sheet, done a toast", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    const KEPT = { name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [KEPT], gone: [] });
    const A = "/api/space/p1/dashboards/deploys-ab12/actions/rollback";
    const LOOK = { ok: true, label: "Roll back to this…", title: "Deploys", says: "Roll back app-api to 3f2a? Production serves it at once.",
      command: ["npx", "wrangler", "rollback", "3f2a", "--message", "{ask.why}", "--yes"], folder: "/r", ask: [{ name: "why", label: "Why", required: true, choices: null }],
      secondLook: false, running: null };
    let runs = 0;
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === A) return LOOK;
      if (u === `${A}/run`)
        return ++runs === 1
          ? { ok: true, done: false, said: "Version 3f2a is not found", error: "npx exited 1: Version 3f2a is not found", argv: [], space: spaceOf() }
          : { ok: true, done: true, said: "Rolled back to 3f2a", error: null, argv: [], space: spaceOf() };
      if (u === "/api/space/p1/dashboards/deploys-ab12/actions/gone") return new Refusal(409, "that row is no longer in deploys: read it again");
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "its page there");
    space.show("deploys-ab12");
    const onAct = did.acts.at(-1);
    assert.equal(typeof onAct, "function", "its frame hears a press");
    onAct({ action: "gone", key: "z" });
    await until(() => toasts().some(([t]) => t === "that row is no longer in deploys: read it again"), "a refusal before a sheet, in a toast");
    assert.equal(doc.document.body.querySelector(".sas-sheet"), null);
    onAct({ action: "rollback", key: "a" });
    await until(() => doc.document.body.querySelector(".sas-sheet"), "Filament's sheet");
    const sheetEl = /** @type {any} */ (doc.document.body.querySelector(".sas-sheet"));
    assert.deepEqual(posted.at(-1), { url: A, body: { key: "a" } }, "the row's key alone");
    const cmd = () => sheetEl.querySelector(".sas-cmd-text").textContent;
    assert.deepEqual([sheetEl.querySelector(".zc-dialog-title").textContent, sheetEl.querySelector(".sas-rest").textContent, cmd(), sheetEl.querySelector(".sas-where").textContent],
      ["Roll back app-api to 3f2a?", "Production serves it at once.", "npx wrangler rollback 3f2a --message ‹why› --yes", " · in /r"]);
    const go = sheetEl.querySelector(".sas-go");
    assert.deepEqual([go.textContent, go.disabled], ["Roll back to this", true], "Why is needed first");
    const why = sheetEl.querySelector(".sas-input");
    why.value = "the login broke";
    why.dispatch("input");
    assert.deepEqual([cmd(), go.disabled], ['npx wrangler rollback 3f2a --message "the login broke" --yes', false], "the command follows what is typed");
    const before = posted.length;
    go.dispatch("click");
    await until(() => !sheetEl.querySelector(".sas-said").hidden, "its failure, in the sheet");
    assert.deepEqual(posted.slice(before), [{ url: `${A}/run`, body: { key: "a", ask: { why: "the login broke" } } }]);
    assert.equal(sheetEl.querySelector(".sas-said").textContent, "It failed: npx exited 1: Version 3f2a is not found");
    assert.ok(sheetEl.isConnected, "the sheet stays open");
    assert.deepEqual([go.textContent, go.disabled], ["Roll back to this", false], "it may run again");
    // A failure has Hand to an agent… beside it (S5d); the box to check it is off: no `verify`.
    assert.equal(sheetEl.querySelector(".sas-hand").hidden, false);
    assert.equal(sheetEl.querySelector(".sas-check-box").checked, false);
    go.dispatch("click");
    await until(() => !sheetEl.isConnected, "done: the sheet closes");
    // Done: a toast with its last line, and Hand to an agent…, which fills the Start with the result; nothing sent.
    // (fails before: yes — a button's result had no way to an agent)
    const done = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-toast.has-action").at(-1));
    assert.equal(done.firstChild.textContent, "Roll back to this: Rolled back to 3f2a", "a toast with its last line");
    const sent = posted.length;
    done.querySelector(".zc-toast-act").dispatch("click");
    assert.deepEqual(did.words.at(-1), ["/r", "On “Deploys”, a dashboard in r's Space, I pressed “Roll back to this…” (Roll back app-api to 3f2a? Production serves it at once.). It ran npx wrangler rollback 3f2a --message \"the login broke\" --yes. It said: Rolled back to 3f2a\n\nLook into it: "]);
    assert.equal(posted.length, sent, "nothing sent");
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-7: a button's sheet opened while another ran on its dashboard kept
  // Run on, so its press was refused, 409, and nothing told the sheet when that run ended)
  test("a dashboard's button pressed while another runs on it: Run waits; the Space read again once it ended lets it run", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    /** @type {any} */
    let running = { label: "Deploy…", action: "deploy", by: null };
    const kept = () => ({ name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at, running });
    const A = "/api/space/p1/dashboards/deploys-ab12/actions/rollback";
    const LOOK = { ok: true, label: "Roll back to this…", title: "Deploys", says: "Roll back app-api to 3f2a?", command: ["npx", "wrangler", "rollback", "3f2a", "--yes"], folder: "/r", ask: [],
      secondLook: false, running: "Deploy…" };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [kept()], gone: [] };
      if (u === A) return LOOK;
      return undefined;
    };
    for (const stop of stops.splice(0)) stop();
    const { host, did, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "its page there");
    space.show("deploys-ab12");
    did.acts.at(-1)({ action: "rollback", key: "a" });
    const sheetEl = /** @type {any} */ (await until(() => doc.document.body.querySelector(".sas-sheet"), "Filament's sheet"));
    const go = sheetEl.querySelector(".sas-go");
    assert.equal(go.disabled, true, "Run waits while “Deploy…” runs");
    // Read again while it still runs: Run still waits.
    const reads = times("/api/space/p1");
    hear({ type: "space", project: "p1", dashboard: "deploys-ab12" });
    await until(() => times("/api/space/p1") > reads, "read again");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(go.disabled, true, "it still runs");
    // It ended: the Space read again says nothing runs there, and the sheet's Run is on.
    running = null;
    hear({ type: "space", project: "p1", dashboard: "deploys-ab12" });
    await until(() => go.disabled === false, "Run, once it ended");
    assert.deepEqual([sheetEl.querySelector(".sas-busy-t").textContent, sheetEl.querySelector(".sas-busy-stop").hidden], ["“Deploy…” has ended.", true]);
    sheetEl.querySelector(".sas-back").dispatch("click");
  });

  /**
   * A model picker's stand-in (composer/model.js `createModelSelect`): the chip's name, and `pick`, the person's choice.
   * @param {any[]} made  each picker made, kept for the test
   */
  const pickerStandIn = (made) => /** @type {any} */ ((/** @type {any} */ cb = {}) => {
    let name = "";
    const el = h("button", { class: "picker-stand-in", type: "button" });
    const p = {
      el, cb,
      name: () => name,
      set: (/** @type {string} */ n) => { name = n; el.textContent = n || String(cb.blank || ""); },
      pick: (/** @type {string} */ n) => { name = n; el.textContent = n; cb.onChange?.(n); },
      setModels() {}, setFamilies() {}, setAccounts() {}, setNote() {}, setLocked() {}, open() {}, matches: () => false, family: () => null,
    };
    made.push(p);
    return p;
  });
  /** The stand-in server's answer to the picker's check of a model: `brain-x` cannot run. @param {string} u */
  const modelProblem = (u) => {
    const m = /\/api\/subagents\/model-problem\?model=([^&]*)/.exec(u);
    if (!m) return undefined;
    const model = decodeURIComponent(m[1]);
    return { model, problem: model === "brain-x" ? "no provider of yours serves it" : null };
  };

  // HarnessV4_Space_Plan S3b, as the owner's word of 10-31 has it: no agent starts behind the person's back, and the
  // model it runs on is theirs. A button that asks for a second look offers one — the Reviewer, read-only, on the model
  // shown, which the person may change —, and only Get a second look starts it. Run never waits for it; Run, or closing
  // the sheet, stops it.
  // (fails before: yes — the Skeptic, the agent a second look ran as then, started as the sheet opened, on a model the
  // person never saw nor chose)
  test("a button with a second look: nothing starts as its sheet opens; Get a second look starts it on the model chosen; Run and closing stop it; refused, the sheet says why", async () => {
    const { actionSheet } = await import("../src/ui/harness/space/action-sheet.js");
    const LOOK = { label: "Roll back to this…", title: "Deploys", says: "Roll back app-api to 3f2a? Production serves it at once.", command: ["npx", "wrangler", "rollback", "3f2a", "--yes"],
      folder: "/r", ask: [], secondLook: true, checkOff: "", skeptic: { chain: "c7", model: "brain-a", why: "the first of its chat's models for agents that can run" }, running: null };
    const PATH = "/dashboards/deploys-ab12/actions/rollback";
    /** @type {any[]} */
    const drawn = [];
    const second = /** @type {any} */ ((/** @type {any} */ ref) => (drawn.push(ref), { el: h("section", { class: "slk-stand-in" }, "the Reviewer reads"), stop() {} }));
    /** @type {any[]} */
    const asks = [];
    /** @param {any} look @returns {any} */
    const requestFor = (look) => async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => {
      asks.push([method, path, body]);
      return path.endsWith("/look") ? look() : { ok: true, got: { done: true, said: "Rolled back" } };
    };
    serve = (u, method) => (method === "POST" && /\/second-looks\/[^/]+\/stop$/.test(u) ? { ok: true, ran: true } : modelProblem(u));
    /** @type {any[]} */
    const pickers = [];
    const modelSelect = pickerStandIn(pickers);
    const chatName = (/** @type {string} */ c) => (c === "c7" ? "Make the deploy app" : "");
    const before = posted.length;
    actionSheet({ look: LOOK, path: PATH, key: "a", request: requestFor(() => ({ ok: true, got: { chain: "c7", agent: "sa-9" } })), second, modelSelect, chatName });
    const sheetEl = /** @type {any} */ (doc.document.body.querySelector(".sas-sheet"));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual([asks, drawn, posted.length], [[], [], before], "opening its sheet starts nothing");
    const offer = sheetEl.querySelector(".sas-look-offer");
    assert.ok(offer, "a second look offered under its sentence");
    assert.equal(sheetEl.querySelector(".sas-look-who").textContent, "The Reviewer, Filament's agent that only reads, says what this would change — in “Make the deploy app”, the chat that made Deploys. Nothing starts until you ask.");
    assert.equal(pickers[0].name(), "brain-a", "on the model Filament would choose, shown");
    assert.equal(sheetEl.querySelector(".sas-look-why").textContent, "Its model: the first of its chat's models for agents that can run");
    const ask = sheetEl.querySelector(".sas-look-go");
    await until(() => !ask.disabled, "its model checked");
    assert.equal(ask.textContent, "Get a second look");
    // A model that cannot run: said, and it cannot start.
    pickers[0].pick("brain-x");
    await until(() => sheetEl.querySelector(".sas-look-why").textContent === "Can't run now: no provider of yours serves it", "a model that cannot run, said");
    assert.equal(ask.disabled, true, "it cannot start");
    // The person's choice is what it runs on.
    pickers[0].pick("brain-b");
    await until(() => !ask.disabled, "one that can");
    assert.equal(sheetEl.querySelector(".sas-look-why").textContent, "Its model: your choice");
    ask.dispatch("click");
    await until(() => drawn.length === 1, "its look, drawn");
    assert.deepEqual([asks[0], drawn[0]], [["POST", `${PATH}/look`, { key: "a", model: "brain-b" }], { chain: "c7", agent: "sa-9" }], "the row's key and the model chosen");
    assert.ok(sheetEl.querySelector(".sas-look .slk-stand-in"), "under its sentence");
    assert.equal(sheetEl.querySelector(".sas-look-offer"), null, "the offer gives way to the look");
    const go = sheetEl.querySelector(".sas-go");
    assert.equal(go.disabled, false, "Run never waits for it");
    go.dispatch("click");
    await until(() => !sheetEl.isConnected, "done: the sheet closes");
    assert.deepEqual(posted.slice(before), [{ url: "/api/sessions/c7/second-looks/sa-9/stop", body: null }], "Run stopped the Reviewer, once");
    // Closed before its look started: stopped as it starts, never drawn.
    /** @type {(v: any) => void} */
    let letGo = () => {};
    actionSheet({ look: LOOK, path: PATH, key: "b", request: requestFor(() => new Promise((res) => (letGo = res))), second, modelSelect });
    const slowEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    await until(() => !slowEl.querySelector(".sas-look-go").disabled, "its model checked");
    const asked = asks.length;
    slowEl.querySelector(".sas-look-go").dispatch("click");
    await until(() => asks.length === asked + 1, "asked");
    assert.deepEqual(asks.at(-1), ["POST", `${PATH}/look`, { key: "b", model: "brain-a" }], "on the model Filament would choose, where none was picked");
    assert.equal(slowEl.querySelector(".sas-look-go").textContent, "Starting…", "while it starts");
    slowEl.querySelector(".sas-back").dispatch("click");
    letGo({ ok: true, got: { chain: "c7", agent: "sa-10" } });
    await until(() => posted.length === before + 2, "stopped as it starts");
    assert.deepEqual([posted.at(-1)?.url, drawn.length], ["/api/sessions/c7/second-looks/sa-10/stop", 1]);
    // Refused: its line says why, nothing is drawn nor stopped, and the offer stays — another model may be chosen.
    const refused = actionSheet({ look: LOOK, path: PATH, key: "a", request: requestFor(() => ({ ok: false, error: "Reviewer cannot run on \"brain-a\": its key is gone" })), second, modelSelect });
    const refusedEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const refusedGo = refusedEl.querySelector(".sas-look-go");
    await until(() => !refusedGo.disabled, "its model checked");
    refusedGo.dispatch("click");
    await until(() => refusedEl.querySelector(".sas-look-why").textContent.startsWith("No second look"), "why there is none");
    assert.deepEqual([refusedEl.querySelector(".sas-look-why").textContent, drawn.length, posted.length, refusedGo.textContent, refusedGo.disabled],
      ["No second look: Reviewer cannot run on \"brain-a\": its key is gone", 1, before + 2, "Get a second look", false]);
    pickers.at(-1).pick("brain-b");
    await until(() => refusedEl.querySelector(".sas-look-why").textContent === "Its model: your choice", "another model, its line said again");
    refused.close();
    // No chat to look in: none offered, saying why.
    const gone = actionSheet({ look: { ...LOOK, skeptic: null, checkOff: "the chat that made Deploys is gone" }, path: PATH, key: "a", request: requestFor(() => assert.fail("no look asked")), second, modelSelect });
    const goneEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    assert.deepEqual([goneEl.querySelector(".sas-look-go"), goneEl.querySelector(".sas-look-who").textContent], [null, "No second look: the chat that made Deploys is gone"]);
    gone.close();
    // A button that asks for none: nothing asked, its box hidden.
    asks.length = 0;
    const plain = actionSheet({ look: { ...LOOK, secondLook: false }, path: PATH, key: "a", request: requestFor(() => assert.fail("no look asked")), second, modelSelect });
    const plainEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    assert.deepEqual([asks, plainEl.querySelector(".sas-look").hidden, posted.length], [[], true, before + 2]);
    plain.close();
  });

  // HarnessV4_Space_Plan S5d, SG-D25: "Then have an agent check it" — off until the person ticks it, whatever its author
  // said to look for (the owner's word of 10-31: no agent starts behind the person's back), then on the model shown,
  // theirs to change; off with why where none can run —; Run sends check and its model; done, the sheet stays on
  // "Done: …" with the check's lines, Stop check and Close, and closing it lets the check go on; a failure has Hand to an
  // agent….
  // (fails before: yes — the sheet had no check; then the author's verify ticked it, on a model nobody saw)
  test("a button checked by an agent: the box, unticked, its model once ticked; done, the sheet stays with the check; Stop check; Close lets it go on; a failure handed to an agent", async () => {
    const { actionSheet } = await import("../src/ui/harness/space/action-sheet.js");
    const LOOK = { label: "Roll back to this…", title: "Deploys", says: "Roll back app-api to 3f2a? Production serves it at once.", command: ["npx", "wrangler", "rollback", "3f2a", "--yes"],
      folder: "/r", ask: [], secondLook: false, verify: "3f2a serves all traffic", checkOff: "", skeptic: { chain: "c1", model: "brain-a", why: "the Reviewer's card names it" }, running: null };
    /** @type {any[]} */
    const pickers = [];
    const modelSelect = pickerStandIn(pickers);
    const PATH = "/dashboards/deploys-ab12/actions/rollback";
    /** @type {any[]} */
    const drawn = [];
    /** @type {any[]} */
    const ends = [];
    const second = /** @type {any} */ ((/** @type {any} */ ref, /** @type {any} */ o) => (drawn.push([ref, o.title, o.none]), ends.push(o.onEnd), { el: h("section", { class: "slk-stand-in" }, "the agent checks"), stop() {} }));
    /** @type {any[]} */
    const asks = [];
    /** @type {any} */
    let answer = { ok: true, got: { done: true, said: "Rolled back to 3f2a", output: "Rolling back…\nRolled back to 3f2a", ran: "npx wrangler rollback 3f2a --yes", check: { chain: "c1", agent: "sa-4" } } };
    const request = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => (asks.push([method, path, body]), answer);
    serve = (u, method) => (method === "POST" && /\/second-looks\/[^/]+\/stop$/.test(u) ? { ok: true, ran: true } : modelProblem(u));
    /** @type {string[]} */
    const handed = [];
    const before = posted.length;
    const s = actionSheet({ look: LOOK, path: PATH, key: "a", request, second, place: "app", handTo: (words) => void handed.push(words), modelSelect });
    const sheetEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const box = sheetEl.querySelector(".sas-check-box");
    assert.deepEqual([box.checked, box.disabled, sheetEl.querySelector(".sas-check-why").textContent], [false, false, "It looks for: 3f2a serves all traffic"], "its author's verify says what it looks for, and ticks nothing");
    assert.equal(sheetEl.querySelector(".sas-check-model").hidden, true, "no model to choose while it is off");
    box.checked = true;
    box.dispatch("change");
    assert.equal(sheetEl.querySelector(".sas-check-model").hidden, false, "ticked: on the model shown");
    const checkPicker = pickers.at(-1);
    assert.deepEqual([checkPicker.name(), sheetEl.querySelector(".sas-check-on").textContent], ["brain-a", "Its model: the Reviewer's card names it"]);
    checkPicker.pick("brain-x");
    await until(() => sheetEl.querySelector(".sas-check-on").textContent === "Can't run now: no provider of yours serves it", "a model that cannot run, said");
    assert.equal(sheetEl.querySelector(".sas-go").disabled, true, "it holds Run");
    checkPicker.pick("brain-c");
    await until(() => !sheetEl.querySelector(".sas-go").disabled, "one that can");
    sheetEl.querySelector(".sas-go").dispatch("click");
    await until(() => drawn.length === 1, "the check, drawn");
    assert.deepEqual(asks.at(-1), ["POST", `${PATH}/run`, { key: "a", ask: {}, check: { model: "brain-c" } }]);
    assert.deepEqual(drawn[0], [{ chain: "c1", agent: "sa-4" }, "Agent check", "No check"]);
    assert.ok(sheetEl.isConnected, "done, it stays: the check's lines come in");
    assert.deepEqual([sheetEl.querySelector(".sas-done").textContent, sheetEl.querySelector(".sas-go").hidden, sheetEl.querySelector(".sas-check").hidden, sheetEl.querySelector(".sas-back").textContent],
      ["Done: Rolled back to 3f2a", true, true, "Close"]);
    const stopCheck = sheetEl.querySelector(".sas-check-stop");
    assert.equal(stopCheck.hidden, false);
    stopCheck.dispatch("click");
    await until(() => posted.length > before, "Stop check");
    assert.deepEqual(posted.at(-1), { url: "/api/sessions/c1/second-looks/sa-4/stop", body: null });
    // Its Verdict line however written, "verdict:" too (found by the Hunter on S5d: a label in lower case was lost).
    ends[0](["What it did: it printed Rolled back to 3f2a", "What I checked: the deploys", "verdict: it did not work — 7c1e still serves"]);
    assert.equal(stopCheck.hidden, true, "ended: no Stop");
    // Hand to an agent… on a done one: the result in the Start's box, and the check's verdict (seen live: it was left out).
    assert.equal(sheetEl.querySelector(".sas-hand").hidden, false);
    sheetEl.querySelector(".sas-hand").dispatch("click");
    assert.equal(handed.at(-1), "On “Deploys”, a dashboard in app's Space, I pressed “Roll back to this…” (Roll back app-api to 3f2a? Production serves it at once.). It ran npx wrangler rollback 3f2a --yes. It said: Rolling back…\nRolled back to 3f2a. An agent checked it and says: it did not work — 7c1e still serves.\n\nLook into it: ");
    assert.equal(sheetEl.isConnected, false, "the sheet goes, the Start opens");
    assert.equal(posted.length, before + 1, "Close stopped nothing: the check goes on");
    void s;
    // Left unticked: no check asked; done, it closes with a toast as ever.
    answer = { ok: true, got: { done: true, said: "Rolled back to 3f2a", output: "", ran: "x" } };
    actionSheet({ look: LOOK, path: PATH, key: "a", request, second, place: "app", handTo: (words) => void handed.push(words), modelSelect });
    const two = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    two.querySelector(".sas-go").dispatch("click");
    await until(() => !two.isConnected, "closed");
    assert.deepEqual(asks.at(-1), ["POST", `${PATH}/run`, { key: "a", ask: {} }]);
    // None can run: the box off, saying why. A failure: Hand to an agent… beside its words.
    answer = { ok: true, got: { done: false, said: "Version 3f2a is not found", output: "Version 3f2a is not found\n", ran: "npx wrangler rollback 3f2a --yes", error: "npx exited 1: Version 3f2a is not found", outcome: "it failed: npx exited 1: Version 3f2a is not found" } };
    actionSheet({ look: { ...LOOK, verify: "", checkOff: "the chat that made Deploys is gone", skeptic: null }, path: PATH, key: "a", request, second, place: "app", handTo: (words) => void handed.push(words), modelSelect });
    const three = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const off = three.querySelector(".sas-check-box");
    assert.deepEqual([off.checked, off.disabled, three.querySelector(".sas-check-why").textContent, three.querySelector(".sas-check").getAttribute("class")],
      [false, true, "No check: the chat that made Deploys is gone", "sas-check is-off"]);
    three.querySelector(".sas-go").dispatch("click");
    await until(() => !three.querySelector(".sas-said").hidden, "its failure");
    assert.equal(three.querySelector(".sas-hand").hidden, false);
    three.querySelector(".sas-hand").dispatch("click");
    assert.equal(handed.at(-1), "On “Deploys”, a dashboard in app's Space, I pressed “Roll back to this…” (Roll back app-api to 3f2a? Production serves it at once.). It ran npx wrangler rollback 3f2a --yes. It failed: npx exited 1: Version 3f2a is not found.\n\nLook into it: ", "what it said, once: its failure says it");
    // Closed while it ran, and it failed: its toast has Hand to an agent…, as a done one's has (found by the Hunter on
    // S5d: a failure after Close had none, and no row anywhere).
    /** @type {(v: any) => void} */
    let finish = () => {};
    const slow = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => (asks.push([method, path, body]), new Promise((r) => void (finish = r)));
    const four = actionSheet({ look: { ...LOOK, verify: "" }, path: PATH, key: "a", request: slow, second, place: "app", handTo: (words) => void handed.push(words) });
    const fourEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const asked = asks.length;
    fourEl.querySelector(".sas-go").dispatch("click");
    await until(() => asks.length === asked + 1, "it runs");
    four.close();
    finish(answer);
    await until(() => doc.document.body.querySelectorAll(".zc-toast").at(-1)?.querySelector(".zc-toast-act"), "its toast, with Hand");
    const failToast = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-toast").at(-1));
    assert.match(failToast.getAttribute("class"), /\berr\b/);
    assert.equal(failToast.querySelector(".zc-toast-act").textContent, "Hand to an agent…");
    const handedBefore = handed.length;
    failToast.querySelector(".zc-toast-act").dispatch("click");
    assert.equal(handed.length, handedBefore + 1);
    assert.match(String(handed.at(-1)), /It failed: npx exited 1: Version 3f2a is not found\./);
    // Hidden is hidden, though a button and the check's line draw their own display (seen live: Hand to an agent… and
    // Stop check showed before anything ran, and pushed the sheet's button out of it).
    // (fails before: yes)
    assert.match(src("space/space.css"), /\.sas-foot \.zc-btn\[hidden\] \{ display: none; \}/);
    assert.match(src("space/space.css"), /\.sas-check\[hidden\] \{ display: none; \}/);
  });

  // The owner's word of 10-31: an agent the person asked for is theirs, and goes on their word. The Reviewer's card,
  // opened from a look on a button's sheet, is a new page — the sheet closes, and the look with it —, so while it still
  // reads the person says so first; ended, it opens at once. Done with a check, the sheet offers no second look at a
  // command that ran.
  // (fails before: yes — found by the review of 10-31: the card's link stopped the look unasked, and Get a second look
  // stood under "Done: …")
  test("a button's sheet: The Reviewer's card asks before it stops a look still reading; done with a check, no second look is offered", async () => {
    const { actionSheet } = await import("../src/ui/harness/space/action-sheet.js");
    const LOOK = { label: "Roll back to this…", title: "Deploys", says: "Roll back app-api to 3f2a? Production serves it at once.", command: ["npx", "wrangler", "rollback", "3f2a", "--yes"],
      folder: "/r", ask: [], secondLook: true, verify: "3f2a serves all traffic", checkOff: "", skeptic: { chain: "c7", model: "brain-a", why: "that chat's own model" }, running: null };
    const PATH = "/dashboards/deploys-ab12/actions/rollback";
    /** @type {any[]} */
    const views = [];
    const second = /** @type {any} */ ((/** @type {any} */ ref, /** @type {any} */ o) => (views.push(o), { el: h("section", { class: "slk-stand-in" }, "the Reviewer reads"), stop() {} }));
    const request = /** @type {any} */ (async (/** @type {string} */ _method, /** @type {string} */ path) => (path.endsWith("/look")
      ? { ok: true, got: { chain: "c7", agent: "sa-21" } }
      : { ok: true, got: { done: true, said: "Rolled back to 3f2a", output: "", ran: "npx wrangler rollback 3f2a --yes", check: { chain: "c7", agent: "sa-22" } } }));
    serve = (u, method) => (method === "POST" && /\/second-looks\/[^/]+\/stop$/.test(u) ? { ok: true, ran: true } : modelProblem(u));
    /** @type {any[]} */
    const pickers = [];
    const modelSelect = pickerStandIn(pickers);
    let cards = 0;
    const openCard = () => void cards++;
    const before = posted.length;
    const s = actionSheet({ look: LOOK, path: PATH, key: "a", request, second, modelSelect, openCard });
    const sheetEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const ask = sheetEl.querySelector(".sas-look-go");
    await until(() => !ask.disabled, "its model checked");
    ask.dispatch("click");
    await until(() => views.length === 1, "its look, drawn");
    /** The dialog on top, and its foot's button that reads so. @param {string} label */
    const topButton = (label) => /** @type {any} */ (doc.document.body.querySelectorAll(".zc-dialog").at(-1)).querySelectorAll(".zc-dialog-foot .zc-btn").find((/** @type {any} */ b) => b.textContent === label);
    const topTitle = () => /** @type {any} */ (doc.document.body.querySelectorAll(".zc-dialog").at(-1)).querySelector(".zc-dialog-title")?.textContent;
    // Still reading: its card asks first, saying what goes.
    void views[0].openCard();
    await until(() => topTitle() === "Open the Reviewer's card?", "asked first");
    topButton("Cancel").dispatch("click");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual([cards, sheetEl.isConnected, posted.length], [0, true, before], "Cancel: the sheet and its look stay");
    void views[0].openCard();
    await until(() => topTitle() === "Open the Reviewer's card?", "asked again");
    topButton("Open its card").dispatch("click");
    await until(() => cards === 1, "on their word, its card");
    // Ended: nothing left to lose, it opens at once.
    views[0].onEnd(["Verdict: wait."]);
    await views[0].openCard();
    assert.equal(cards, 2, "ended: at once");
    // Done with a check: the sheet stays on "Done: …" with the check, and offers no look at what ran.
    const s2 = actionSheet({ look: LOOK, path: PATH, key: "a", request, second, modelSelect, openCard });
    const two = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    assert.equal(two.querySelector(".sas-look").hidden, false, "offered before it runs");
    const box = two.querySelector(".sas-check-box");
    box.checked = true;
    box.dispatch("change");
    await until(() => !two.querySelector(".sas-go").disabled, "the check's model checked");
    two.querySelector(".sas-go").dispatch("click");
    await until(() => !two.querySelector(".sas-done").hidden, "done, with its check");
    assert.equal(two.querySelector(".sas-look").hidden, true, "no second look at a command that ran");
    s.close();
    s2.close();
  });

  // A button already running on its dashboard — its sheet closed while it ran, so no Stop was left anywhere: a sheet
  // opened again says so with Stop it.
  // (fails before: yes — found by the Hunter on S3a: the line said "this one waits", and nothing could stop it)
  test("a sheet opened while a button runs on its dashboard: Stop it, and then it may run", async () => {
    const { actionSheet } = await import("../src/ui/harness/space/action-sheet.js");
    const LOOK = { label: "Re-run failed jobs…", title: "CI", says: "Re-run the failed jobs of run 42?", command: ["gh", "run", "rerun", "42", "--failed"], folder: "/r", ask: [], secondLook: false, running: "Deploy…" };
    const PATH = "/dashboards/ci-ab12/actions/rerun";
    /** @type {any[]} */
    const asks = [];
    /** @param {any} stop @returns {any} */
    const requestFor = (stop) => async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => (asks.push([method, path, body]), stop);
    /** @type {{ close: () => void }[]} */
    const opened = [];
    const open = (/** @type {any} */ stop) => {
      opened.push(actionSheet({ look: LOOK, path: PATH, key: "42", request: requestFor(stop) }));
      return /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    };
    const el = open({ ok: true, got: { ok: true } });
    assert.equal(el.querySelector(".sas-busy").hidden, false);
    assert.equal(el.querySelector(".sas-busy-t").textContent, "“Deploy…” is running on CI: Run once it ends, or stop it.");
    el.querySelector(".sas-busy-stop").dispatch("click");
    await until(() => el.querySelector(".sas-busy-stop").hidden, "stopped");
    assert.deepEqual(asks, [["POST", `${PATH}/stop`, {}]], "the dashboard's run stopped, nothing run");
    assert.equal(el.querySelector(".sas-busy-t").textContent, "You stopped “Deploy…”.");
    assert.equal(el.querySelector(".sas-go").disabled, false, "it may run");
    // It ended before the press: said so.
    const ended = open({ ok: false, error: "nothing of it is running" });
    ended.querySelector(".sas-busy-stop").dispatch("click");
    await until(() => ended.querySelector(".sas-busy-stop").hidden, "ended");
    assert.equal(ended.querySelector(".sas-busy-t").textContent, "“Deploy…” has ended.");
    // Another refusal: in the sheet, Stop it kept.
    const refused = open({ ok: false, error: "There is no dashboard ci-ab12." });
    refused.querySelector(".sas-busy-stop").dispatch("click");
    await until(() => !refused.querySelector(".sas-said").hidden, "its words");
    assert.deepEqual([refused.querySelector(".sas-said").textContent, !!refused.querySelector(".sas-busy-stop").hidden, refused.querySelector(".sas-busy-stop").disabled], ["There is no dashboard ci-ab12.", false, false]);
    for (const s of opened) s.close();
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-7: Run stayed on while the sheet said another button ran on its
  // dashboard, and pressed, it was refused, 409)
  test("a sheet opened while a button runs on its dashboard: Run waits until it ends — Stop it, or told it ended", async () => {
    const { actionSheet } = await import("../src/ui/harness/space/action-sheet.js");
    const LOOK = { label: "Re-run failed jobs…", title: "CI", says: "Re-run the failed jobs of run 42?", command: ["gh", "run", "rerun", "42", "--failed"], folder: "/r", ask: [], secondLook: false, running: "Deploy…" };
    const PATH = "/dashboards/ci-ab12/actions/rerun";
    /** @type {any[]} */
    const asks = [];
    const request = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => (asks.push([method, path, body]), /** @type {any} */ ({ ok: true, got: path.endsWith("/stop") ? { ok: true } : { done: true, said: "re-ran" } }));
    const s = actionSheet({ look: LOOK, path: PATH, key: "42", request });
    const el = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    const go = el.querySelector(".sas-go");
    assert.deepEqual([go.disabled, go.title], [true, "“Deploy…” is running on CI: Run once it ends, or stop it"], "Run waits while it runs");
    go.dispatch("click");
    assert.deepEqual(asks, [], "a press while it waits runs nothing");
    // Told it ended — the Space read again says nothing runs there —: said, and Run is on.
    s.ended();
    assert.deepEqual([el.querySelector(".sas-busy-t").textContent, el.querySelector(".sas-busy-stop").hidden, go.disabled, go.title],
      ["“Deploy…” has ended.", true, false, `Runs ${el.querySelector(".sas-cmd-text").textContent}`]);
    // Stop it lets it run too (the test before this one): Stopped, Run is on.
    const stopped = actionSheet({ look: LOOK, path: PATH, key: "42", request });
    const stoppedEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    assert.equal(stoppedEl.querySelector(".sas-go").disabled, true);
    stoppedEl.querySelector(".sas-busy-stop").dispatch("click");
    await until(() => stoppedEl.querySelector(".sas-go").disabled === false, "Run, once stopped");
    // A sheet opened on nothing running: Run is on, and told so it says nothing.
    const idle = actionSheet({ look: { ...LOOK, running: null }, path: PATH, key: "42", request });
    const idleEl = /** @type {any} */ (doc.document.body.querySelectorAll(".sas-sheet").at(-1));
    idle.ended();
    assert.deepEqual([idleEl.querySelector(".sas-go").disabled, idleEl.querySelector(".sas-busy").hidden], [false, true]);
    for (const x of [s, stopped, idle]) x.close();
  });

  // A Space drawn again over the frame, or left for another screen, keeps your look at once, before the next one reads it.
  // (fails before: yes — found by the Hunter on S1: the look was kept as the old Space's tick saw it gone, up to 2 s
  // later, so a Space opened again at once read the look before and showed again what you had just seen)
  test("a Space replaced or left keeps your look at once: the next one reads it", async () => {
    for (const stop of stops.splice(0)) stop();
    const KEY = "filament.space.look.p1";
    /** @type {Map<string, string>} */
    const kept = new Map([[KEY, "1"]]);
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    try {
      serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT]) : u === "/api/space/p1" ? { project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], syncs: [], log: [] } : undefined);
      const first = mountSpace(lookOf({}));
      await lanesDrawn(first.host);
      const before = Date.now();
      // The route drawn again: nobody stops the old one but the new.
      const second = renderSpace(first.host, { id: "p1" }, { project: () => ({ id: "p1", name: "r", cwd: "/r" }), look: lookOf({}), openChat() {}, newChat() {}, projectSettings() {}, onMoved() {}, onClose() {} });
      stops.push(second.stop);
      assert.ok(Number(kept.get(KEY)) >= before, "the Space replaced kept your look before the new one read it");
      kept.set(KEY, "1");
      leaveSpace();
      assert.ok(Number(kept.get(KEY)) >= before, "left for another screen: kept at once");
      kept.set(KEY, "1");
      leaveSpace();
      assert.equal(kept.get(KEY), "1", "once: nothing is on screen now");
    } finally {
      g.localStorage = hadStore;
    }
  });

  // HarnessV4_Space_Plan SG-D3: Where you left off is Filament's own facts since your last look, no agent; Catch me up…
  // fills the Start; Dismiss and leaving keep your look. Needs you here with none: one quiet line.
  // (fails before: yes — the Space had no card, and asked nobody)
  test("Where you left off: since your last look, from Filament's own lines; Continue, Catch me up… and Dismiss send nothing", async () => {
    const at = Date.now();
    // The Spaces drawn before this one keep their look as they stop: before this test's own look is set.
    for (const stop of stops.splice(0)) stop();
    /** @type {Map<string, string>} */
    const kept = new Map([["filament.space.look.p1", String(at - 2 * HOUR)]]);
    const hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    try {
      /** @type {any} */
      const SPACE = {
        project: "p1", seq: 4, logMore: 0, names: {}, waiting: [], tasks: [], syncs: [],
        log: [
          { id: "e1", at: at - 3 * HOUR, by: { kind: "filament", chain: "c20" }, text: "“on main” finished a turn in main", task: null },
          { id: "e2", at: at - HOUR, by: { kind: "you" }, text: "my own", task: null },
          { id: "e3", at: at - 30 * 60_000, by: { kind: "filament", chain: "c21" }, text: "“the agent” finished a turn in agent: 2 commits not on main", task: null },
        ],
      };
      serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT]) : u === "/api/space/p1" ? SPACE : undefined);
      const { host, space, did } = mountSpace(lookOf({ c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - 30 * 60_000, line: "" } }));
      await lanesDrawn(host);
      await until(() => !host.querySelector(".sp-left").hidden, "the card");
      // Two hours back is yesterday before 2 a.m.
      const day = new Date(at - 2 * HOUR).toDateString() === new Date(at).toDateString() ? "today" : "yesterday";
      assert.match(host.querySelector(".sp-left-head").textContent, new RegExp(`^Where you left off · ${day} \\d\\d:\\d\\d$`));
      assert.deepEqual(texts(host, ".sp-left-t"), ["“the agent” finished a turn in agent: 2 commits not on main"], "since your look, not your own");
      assert.equal(host.querySelector(".sp-needs-sec").hidden, true, "nothing needs you: the section is off");
      host.querySelector(".sp-left-go").dispatch("click");
      assert.deepEqual([host.querySelector(".sp-left-go").textContent, did.opened], ["Continue in “the agent”", ["c21"]], "the chat last at work");
      host.querySelector(".sp-left-catch").dispatch("click");
      assert.equal(did.words.length, 1);
      assert.equal(did.words[0][0], "/r");
      assert.match(did.words[0][1], /^Catch me up on this project\. Read its Space with your space tool — the board, and What happened since \d{4}-\d\d-\d\d \d\d:\d\d — and each lane's git status\./);
      assert.deepEqual(posted, [], "nothing sent, nothing asked");
      host.querySelector(".sp-left-x").dispatch("click");
      assert.equal(host.querySelector(".sp-left").hidden, true);
      assert.ok(Number(kept.get("filament.space.look.p1")) >= at, "Dismiss keeps your look as of now");
      // The Space stays open and moves again: the card comes back with what moved since Dismiss alone.
      // (fails before: yes — found by the Hunter on S1: the card was drawn once, and stayed as it was while the Space was open)
      await new Promise((r) => setTimeout(r, 5));
      SPACE.log = [...SPACE.log, { id: "e4", at: Date.now(), by: { kind: "filament", chain: "c20" }, text: "“on main” finished a turn in main: 1 file changed", task: null }];
      SPACE.seq = 5;
      hear({ type: "space", project: "p1", seq: 5 });
      await until(() => !host.querySelector(".sp-left").hidden, "the card again");
      assert.deepEqual(texts(host, ".sp-left-t"), ["“on main” finished a turn in main: 1 file changed"], "since Dismiss, not before it");
      kept.set("filament.space.look.p1", "1");
      space.stop();
      assert.ok(Number(kept.get("filament.space.look.p1")) >= at, "leaving the Space keeps it too");
      // Opened again with nothing new since: no card, though two chats ask (asks alone are Needs you here's).
      const again = mountSpace(lookOf(
        { c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - 30 * 60_000, line: "" } },
        { c20: { group: "needs", fact: "asks: which schema?", at: at - 2 * HOUR }, c21: { group: "needs", fact: "asks: which branch?", at: at - 60_000 } },
      ));
      await lanesDrawn(again.host);
      await until(() => again.host.querySelector(".sl-entry"), "the Space read");
      assert.equal(again.host.querySelector(".sp-left").hasAttribute("hidden"), true);
      // A line lands while it is open: the card shows, and Continue opens the chat Needs you here puts first — the
      // newest ask, not main's because main is the first lane.
      // (fails before: yes — the card stayed hidden; and Continue walked the lanes, main first)
      await new Promise((r) => setTimeout(r, 5));
      SPACE.log = [...SPACE.log, { id: "e5", at: Date.now(), by: { kind: "filament", chain: "c21" }, text: "“the agent” finished a turn in agent", task: null }];
      SPACE.seq = 6;
      hear({ type: "space", project: "p1", seq: 6 });
      await until(() => !again.host.querySelector(".sp-left").hidden, "the card as a line lands");
      assert.deepEqual(texts(again.host, ".sp-need-t"), ["asks: which branch?", "asks: which schema?"]);
      assert.equal(again.host.querySelector(".sp-left-go").textContent, "Continue in “the agent”");
    } finally {
      g.localStorage = hadStore;
    }
  });

  // (fails before: yes — the Space had lanes alone)
  test("a team's lead in a lane: who runs it is its team and its workers", async () => {
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([{ ...MAIN, chats: [{ id: "c30", name: "HarnessV3_Impl" }] }]) : undefined);
    const { host } = mountSpace(lookOf({ c30: { title: "HarnessV3_Impl", when: Date.now(), line: "" } }, { c30: { group: "works", team: "Methodical", under: [{}, {}, {}], fact: "x", step: "Builder asks you", model: "glm" } }));
    await lanesDrawn(host);
    assert.deepEqual(laneRows(host)[0].slice(3, 6), ["HarnessV3_Impl", "Methodical team · 3 workers", "working · Builder asks you"]);
  });

  // ---- the places' rows (HarnessV4_Git_Plan step 4; moved from the Changes pane, V5) ----

  /**
   * The places' section on its own, as the Space mounts it, over a folder.
   * @param {string} folder @param {string | null} [self]
   */
  const mountPlaces = (folder, self = null) => {
    const body = h("div", { class: "sp-panel" });
    doc.document.body.append(body);
    const moved = { n: 0 };
    const s = placesSection({
      folder: () => folder,
      self,
      editorButton: (_path, what) => h("button", { class: "pl-open", type: "button", title: what }),
      onMoved: () => void moved.n++,
    });
    body.append(s.el);
    void s.load();
    return { body, moved, s };
  };
  /** The rows once a read is drawn. @param {any} body */
  const placesDrawn = (body) => until(() => body.querySelector(".pl-row"), "the places to be drawn");
  /** The rows' names, lines, whether each has the "…" menu, and the buttons each offers. @param {any} body */
  const placeRows = (body) =>
    body.querySelectorAll(".pl-row").map((/** @type {any} */ r) => [
      r.querySelector(".pl-name").textContent,
      r.querySelector(".pl-l2")?.textContent || "",
      r.querySelector(".pl-more") ? "…" : "",
      r.querySelectorAll(".zc-btn").map((/** @type {any} */ b) => b.textContent).join(","),
    ]);
  /** A row's "…" menu opened: its rows. @param {any} row */
  const moreOf = (row) => menuOf(row.querySelector(".pl-more"), "the row's menu");
  /** Remove's sheet asked for from a row's "…". @param {any} row */
  const askRemove = async (row) => (await moreOf(row))[0].dispatch("click");

  // (fails before: yes — as the Changes pane's: its rows, the chats at work, the "…", GW-D59, GW-D60)
  test("a row per place: the chats at work there, the rest on hover, a \"…\" where Remove could be; a gone and an unread one say so (GW-D38, GW-D59, GW-D60, GWC-43, GWC-45, GWC-46, GWC-89, GWC-135 to GWC-137)", async () => {
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, WT, DONE, GONE, OUT]) : undefined);
    const { body } = mountPlaces("/r");
    assert.deepEqual(texts(body, ".pl-none"), ["Reading the folders…"], "drawn at once, reading");
    await placesDrawn(body);
    assert.deepEqual(placeRows(body), [
      ["r", "2 uncommitted", "", ""],
      ["r-wt", "↑2 on main · clean · “the agent” is at work", "…", ""],
      ["r-done", "clean · merged into main", "…", ""],
      ["r-gone", "its folder is gone; git keeps its record", "", ""],
      ["o", "/o is not under any folder listed in agentLoop.roots", "", ""],
    ]);
    const rows = body.querySelectorAll(".pl-row");
    assert.deepEqual(
      rows.map((/** @type {any} */ r) => r.querySelector(".pl-l2").getAttribute("title")),
      ["The folder of “on main”", "The folder of “the agent”", "The folder of “fix it”", "No chat works here", OUT.error],
      "whose it is on hover; an unread one's line in full",
    );
    assert.deepEqual(rows.map((/** @type {any} */ r) => !!r.querySelector(".pl-open")), [true, true, true, false, false], "a gone or unread place has no open button");
    const greyed = await moreOf(rows[1]);
    assert.deepEqual(
      greyed.map((/** @type {any} */ i) => [i.querySelector(".zc-menu-label-line").textContent, i.querySelector(".zc-menu-desc").textContent, i.hasAttribute("disabled")]),
      [["Remove worktree…", "its branch holds 2 commits main lacks", true], ["Remove worktree and branch…", "its branch holds commits main lacks", true]],
    );
    greyed[0].dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-dialog"), null, "a greyed Remove asks nothing");
    rows[1].querySelector(".pl-more").dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "the \"…\" again closes its menu");
    const offered = await moreOf(rows[2]);
    assert.deepEqual(
      offered.map((/** @type {any} */ i) => [i.querySelector(".zc-menu-text").textContent, !!i.querySelector(".zc-menu-desc"), i.hasAttribute("disabled")]),
      [["Remove worktree…", false, false], ["Remove worktree and branch…", false, false]],
      "offered: no why",
    );
    rows[2].querySelector(".pl-more").dispatch("click");
    // A folder in no repository says why.
    serve = (u) => (u === "/api/git/places?cwd=%2Fp" ? { cwd: "/p", ok: false, error: "not in a git repository", places: [], removed: [] } : undefined);
    const none = mountPlaces("/p");
    await until(() => times("/api/git/places?cwd=%2Fp") === 1 && none.body.querySelector(".pl-none")?.textContent !== "Reading the folders…", "the refusal drawn");
    assert.match(none.body.querySelector(".pl-none").textContent, /^git could not read this folder: /);
  });

  // (fails before: yes — as the Changes pane's, GW-D60)
  test("Remove, from the \"…\": the sheet says what stays and what goes; Remove posts, the row turns into its removal with Put back; Put back posts and the row is back (GW-D10, GW-D36, GW-D37, GW-D60, GWC-44)", async () => {
    let gone = false;
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? (gone ? placesOf([MAIN, WT], [REMOVED]) : placesOf([MAIN, WT, DONE]))
      : u === "/api/git/places/remove" && method === "POST" ? ((gone = true), { ok: true, removed: REMOVED, left: null })
      : u === "/api/git/places/put-back" && method === "POST" ? ((gone = false), { ok: true })
      : undefined;
    const { body, moved } = mountPlaces("/r");
    await placesDrawn(body);
    const done = body.querySelectorAll(".pl-row")[2];
    await askRemove(done);
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "the menu closes as it asks");
    assert.equal(doc.document.body.querySelector(".zc-dialog-title").textContent, "Remove the worktree r-done?");
    assert.equal(doc.document.body.querySelector(".zc-dialog-desc").textContent, "/r-done");
    assert.deepEqual(texts(doc.document.body, ".chg-sheet p"), [
      "The folder goes. The branch done stays, with every commit on it; main has them all.",
      "Nothing uncommitted is in it. With it go what git ignores there: .env, node_modules (a link: only the link goes). Put back brings the branch's files back, not these.",
      "“fix it” moves to r first: its conversation goes on there.",
    ]);
    sheetButton("Cancel").dispatch("click");
    assert.deepEqual([doc.document.body.querySelector(".zc-dialog"), posted.length], [null, 0], "Cancel removes nothing");
    await askRemove(done);
    sheetButton("Remove").dispatch("click");
    await until(() => body.querySelector(".pl-row.is-removed"), "the removal's row");
    assert.deepEqual(posted, [{ url: "/api/git/places/remove", body: { cwd: "/r", path: "/r-done", moveChats: true } }], "its chat moves with it, as the sheet is ticked at first");
    assert.equal(moved.n, 1, "the header and the left bar read again");
    assert.deepEqual(placeRows(body).at(-1), ["r-done", "removed 14:02 · the branch done stays", "", "Put back"]);
    assert.ok(toasts().some(([t]) => t === "Removed r-done · the branch done stays"));
    body.querySelector(".pl-row.is-removed .zc-btn").dispatch("click");
    await until(() => !body.querySelector(".pl-row.is-removed") && placeRows(body).length === 3, "the place back");
    assert.deepEqual(posted.at(-1), { url: "/api/git/places/put-back", body: { cwd: "/r", id: "rm1" } });
    assert.equal(moved.n, 2);
    assert.deepEqual(placeRows(body).at(-1), ["r-done", "clean · merged into main", "…", ""]);
    assert.ok(toasts().some(([t]) => t === "Put back r-done on done"));
  });

  // (fails before: yes — the owner's of 11-09: the chat whose folder Remove took stayed there, its folder gone)
  test("Remove's sheet ticks moving the chats whose folder it is to the main folder: ticked, Remove asks for it and says who moved; unticked, it does not", async () => {
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, DONE])
      : u === "/api/git/places/remove" && method === "POST" ? { ok: true, removed: REMOVED, left: null, ...(posted.at(-1)?.body?.moveChats ? { moved: [{ id: "c22", name: "fix it" }] } : {}) }
      : undefined;
    const { body, moved } = mountPlaces("/r");
    await placesDrawn(body);
    await askRemove(body.querySelectorAll(".pl-row")[1]);
    const sheet = () => doc.document.body.querySelector(".chg-sheet");
    const tick = () => /** @type {any} */ (sheet().querySelector("input"));
    assert.equal(sheet().querySelector("label").textContent, " Move its chat to the main folder, r");
    assert.equal(tick().checked, true, "ticked");
    assert.equal(texts(doc.document.body, ".chg-sheet p")[2], "“fix it” moves to r first: its conversation goes on there.");
    tick().checked = false;
    tick().dispatch("change");
    assert.equal(texts(doc.document.body, ".chg-sheet p")[2], "“fix it” works there: its folder is gone until you put it back.", "unticked: it stays, its folder gone");
    tick().checked = true;
    tick().dispatch("change");
    sheetButton("Remove").dispatch("click");
    await until(() => moved.n === 1, "removed: the header and the left bar read again");
    assert.deepEqual(posted.at(-1), { url: "/api/git/places/remove", body: { cwd: "/r", path: "/r-done", moveChats: true } });
    assert.ok(toasts().some(([t]) => t === "Moved “fix it” to r"), JSON.stringify(toasts()));
    // Unticked: the chat stays.
    await until(() => !body.querySelector(".pl-busy"), "the row free again");
    await askRemove(body.querySelectorAll(".pl-row")[1]);
    tick().checked = false;
    tick().dispatch("change");
    sheetButton("Remove").dispatch("click");
    await until(() => posted.length === 2, "posted again");
    assert.deepEqual(posted.at(-1), { url: "/api/git/places/remove", body: { cwd: "/r", path: "/r-done" } });
  });

  // (fails before: yes — as the Changes pane's)
  test("a Remove the server refuses at the click says why in an error toast, and the list is read again (GW-D40, GWC-83)", async () => {
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, DONE])
      : u === "/api/git/places/remove" && method === "POST" ? new Refusal(409, "not removed: 1 file uncommitted")
      : undefined;
    const { body, moved } = mountPlaces("/r");
    await placesDrawn(body);
    await askRemove(body.querySelectorAll(".pl-row")[1]);
    sheetButton("Remove").dispatch("click");
    await until(() => times("/api/git/places?cwd=%2Fr") === 2, "the list read again");
    assert.ok(toasts().some(([t, cls]) => t === "r-done: not removed: 1 file uncommitted" && /\berr\b/.test(cls)), JSON.stringify(toasts()));
    assert.equal(moved.n, 0, "nothing moved");
  });

  // (fails before: yes — the owner's of 11-10: the merged worktrees were listed on the Plan's Still open card, and removed
  // only one "…" at a time here)
  test("Tidy up, over the list: the merged worktrees with nothing uncommitted, Remove merged… ticks each — one with nothing of its own yet unticked —, says what goes, and removes the ticked ones with their branches, one after another", async () => {
    const FRESH = { ...DONE, path: "/r-new", name: "r-new", branch: "new", fresh: true, chats: [] };
    const BUSY = { ...DONE, path: "/r-busy", name: "r-busy", branch: "busy", chats: [{ id: "c23", name: "busy one", home: true, atWork: true }] };
    let left = [DONE, FRESH, BUSY];
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT, ...left]);
      if (u !== "/api/git/places/remove" || method !== "POST") return undefined;
      const { path, moveChats } = posted.at(-1)?.body || {};
      left = left.filter((p) => p.path !== path);
      return { ok: true, removed: { ...REMOVED, path, branchGone: true }, left: null, ...(moveChats && path === "/r-done" ? { moved: [{ id: "c22", name: "fix it" }] } : {}) };
    };
    const { body, moved } = mountPlaces("/r");
    await placesDrawn(body);
    const tidy = body.querySelector(".pl-tidy");
    assert.equal(body.querySelector(".pl-places").children[0], tidy, "first");
    assert.deepEqual([tidy.querySelector(".pl-tidy-h").textContent, tidy.querySelector(".pl-l2").textContent], ["Tidy up", "2 worktrees are merged into main with nothing uncommitted: nothing is lost if they go"], "not one a chat is at work in");
    tidy.querySelector(".zc-btn").dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-dialog-title").textContent, "Remove the merged worktrees?");
    const rows = doc.document.body.querySelectorAll(".pl-merged-row");
    /** A row's tick, as the sheet sets and reads it. @param {any} r @returns {any} */
    const tickOf = (r) => r.querySelector("input");
    // (fails before: yes — the reviewer's of 11-10: a chat's own folder was ticked, and the chat moved off its worktree
    // unasked) The folder of a chat is unticked, as one with nothing of its own yet is, and its row says whose it is.
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.querySelector(".pl-name").textContent, tickOf(r).checked]), [["r-done", false], ["r-new", false]]);
    assert.match(rows[0].querySelector(".pl-l2").textContent, /^branch done · clean · merged into main · the folder of “fix it”$/);
    assert.equal(texts(doc.document.body, ".pl-merged-says")[0], "Unticked: a chat's folder, and one with nothing of its own yet. Whatever git ignores in a folder goes with it; Put back brings the branch's files back, not those.");
    assert.equal(/** @type {any} */ (sheetButton("Remove")).disabled, true, "none ticked: it waits");
    // (fails before: yes — the review of 4569417b8: it stood ticked while no ticked row was a chat's folder)
    const moveTick = () => /** @type {any} */ (doc.document.body.querySelectorAll(".chg-sheet .check").at(-1)?.querySelector("input"));
    assert.equal(moveTick().disabled, true, "no ticked row is a chat's folder: nothing to move");
    tickOf(rows[0]).checked = true;
    tickOf(rows[0]).dispatch("change");
    assert.equal(/** @type {any} */ (sheetButton("Remove 1")).disabled, false);
    for (const r of rows) {
      tickOf(r).checked = true;
      tickOf(r).dispatch("change");
    }
    assert.match(texts(doc.document.body, ".chg-sheet .check").at(-1), /Move the chats whose folder one is to the main folder, r$/);
    assert.equal(moveTick().disabled, false, "r-done ticked: its chat moves");
    sheetButton("Remove 2").dispatch("click");
    await until(() => posted.length === 2 && !body.querySelector(".pl-tidy"), "both removed, Tidy up gone");
    assert.deepEqual(posted, [
      { url: "/api/git/places/remove", body: { cwd: "/r", path: "/r-done", branch: true, moveChats: true } },
      { url: "/api/git/places/remove", body: { cwd: "/r", path: "/r-new", branch: true, moveChats: true } },
    ]);
    assert.ok(toasts().some(([t]) => t === "Removed 2 merged worktrees and their branches · moved 1 chat to r"));
    assert.equal(moved.n, 1, "the header and the left bar read again, once");
  });

  // (fails before: yes — the reviewer's of 11-10: the sheet said only that whatever git ignores goes, never what; and a
  // worktree removed was drawn again, its Remove's busy line gone, until the last one went and the list was read)
  test("Remove merged…'s rows each say what git ignores there goes with it, and one removed stays off the list while the next one goes", async () => {
    const OLD = { ...DONE, path: "/r-old", name: "r-old", branch: "old", chats: [], goes: { names: [{ path: "dist/", link: false }, { path: "node_modules/", link: true }], more: 2 } };
    const PLAIN = { ...DONE, path: "/r-plain", name: "r-plain", branch: "plain", chats: [], goes: { names: [], more: 0 } };
    const UNREAD = { ...DONE, path: "/r-unread", name: "r-unread", branch: "unread", chats: [], goes: null };
    let left = [OLD, PLAIN, UNREAD];
    /** @type {(() => void) | null} */
    let release = null;
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, ...left]);
      if (u !== "/api/git/places/remove" || method !== "POST") return undefined;
      const { path } = posted.at(-1)?.body || {};
      const answer = () => {
        left = left.filter((p) => p.path !== path);
        return { ok: true, removed: { ...REMOVED, path, branchGone: true }, left: null };
      };
      return path === "/r-plain" ? new Promise((r) => (release = () => r(answer()))) : answer();
    };
    const { body } = mountPlaces("/r");
    await placesDrawn(body);
    body.querySelector(".pl-tidy .zc-btn").dispatch("click");
    const rows = doc.document.body.querySelectorAll(".pl-merged-row");
    assert.deepEqual(rows.map((/** @type {any} */ r) => r.querySelector(".pl-goes").textContent), [
      "with it go dist/, node_modules (a link: only the link goes), and 2 more",
      "nothing git ignores is in it",
      "git could not list what it ignores there: whatever that is goes with it",
    ]);
    sheetButton("Remove 3").dispatch("click");
    await until(() => posted.length === 2 && release, "the first removed, the second going");
    assert.equal(body.querySelector('[data-place="/r-old"]'), null, "the one removed is not drawn again");
    assert.equal(body.querySelector(".pl-tidy"), null, "nor counted");
    assert.equal(body.querySelector('[data-place="/r-plain"] .pl-busy').textContent, "Removing…");
    /** @type {any} */ (release)();
    await until(() => posted.length === 3 && !body.querySelector(".pl-busy"), "all three removed, the list read again");
    assert.deepEqual([...body.querySelectorAll(".pl-row")].map((/** @type {any} */ r) => r.getAttribute("data-place")).filter(Boolean), ["/r"]);
  });

  // (fails before: yes — as the Changes pane's)
  test("the folder read is the one removed: the section reads in the repository's main folder, and Put back stays in reach (GWC-87)", async () => {
    let gone = false;
    serve = (u, method) =>
      u === "/api/git/places?cwd=%2Fr-done" ? (gone ? undefined : placesOf([MAIN, DONE], [], "/r-done"))
      : u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN], [REMOVED])
      : u === "/api/git/places/remove" && method === "POST" ? ((gone = true), { ok: true, removed: REMOVED, left: null })
      : u === "/api/git/places/put-back" && method === "POST" ? ((gone = false), { ok: true })
      : undefined;
    const { body } = mountPlaces("/r-done", "c22");
    await placesDrawn(body);
    await askRemove(body.querySelectorAll(".pl-row")[1]);
    assert.equal(texts(doc.document.body, ".chg-sheet p")[2], "This chat moves to r first: its conversation goes on there.");
    sheetButton("Remove").dispatch("click");
    await until(() => body.querySelector(".pl-row.is-removed"), "the removal's row, read in the main folder");
    assert.equal(posted[0].body.cwd, "/r-done");
    // Drawn again later: it still finds the removal.
    const again = mountPlaces("/r-done", "c22");
    await until(() => again.body.querySelector(".pl-row.is-removed"), "the removal's row on a new draw");
    again.body.querySelector(".pl-row.is-removed .zc-btn").dispatch("click");
    await until(() => posted.length === 2, "Put back posted");
    assert.deepEqual(posted[1], { url: "/api/git/places/put-back", body: { cwd: "/r", id: "rm1" } });
    await until(() => !again.body.querySelector(".pl-row.is-removed") && placeRows(again.body).length === 2, "the place back, read in the folder");
  });
});

describe("its address and the ways in", () => {
  // (fails before: yes — `#/space/<project>` was home)
  test("#/space/<project> is a full-frame screen, as the Library's pages are", () => {
    assert.deepEqual(parseRoute("#/space/e3ea9a755387"), { kind: "space", id: "e3ea9a755387" });
    assert.deepEqual(parseRoute("#/space"), { kind: "home" }, "no project: home");
    assert.equal(routeFor("space", { id: "a b" }), "#/space/a%20b");
    assert.deepEqual(parseRoute(routeFor(parseRoute("#/space/p1"))), { kind: "space", id: "p1" });
    assert.ok(onScreen("#/space/p1") && isScreen("space") && !isScreen("task") && !isScreen("home"));
  });

  // (fails before: yes — New lane… is new; A new worktree was a press in the Start only)
  test("New lane… holds A new worktree on the chat it opens, its name made from the draft, as the Start's own choice is", () => {
    assert.deepEqual(newWorktreeChoice("/r", "Fix the login bug on mobile"), {
      make: true, name: nameFromMessage("Fix the login bug on mobile"), fromMessage: nameFromMessage("Fix the login bug on mobile"), typed: false, folder: "/r",
    });
    assert.equal(newWorktreeChoice("/r").name, nameFromMessage(""));
    assert.equal(nameFromMessage(""), "task");
  });

  // (fails before: yes — `start` picked All chats, or a scope the page held, never a project asked for by its id)
  test("Applies to starts on the project a Space's Project settings names, once the list is read; one it lacks is All chats", async () => {
    /** @type {any[]} */
    const picks = [];
    let reads = 0;
    const io = {
      h: /** @type {any} */ (fakeH),
      api: async (/** @type {string} */ path) => {
        if (path === "/spaces/own") return { spaces: [] };
        reads++;
        return { projects: [{ id: "p1", name: "r", cwd: "/r" }, { id: "p2", name: "old", cwd: "/old", archived: true }] };
      },
    };
    const control = appliesTo({ onPick: (scope, p) => void picks.push([scope, p?.name || null]) }, io);
    control.start("p1");
    await until(() => picks.length === 1, "the pick");
    assert.deepEqual([picks, reads], [[["project:p1", "r"]], 1]);
    const other = appliesTo({ onPick: (scope) => void picks.push([scope]) }, io);
    other.start("p2");
    await until(() => picks.length === 2, "the pick");
    assert.deepEqual(picks[1], ["all"], "an archived project is not offered");
    const bare = appliesTo({ onPick: (scope) => void picks.push([scope]) }, io);
    bare.start(null);
    assert.deepEqual(picks[2], ["all"], "no project asked: All chats at once");
    // Read after, for the Spaces' buttons: the pick stands, and the page hears nothing more.
    await until(() => reads === 3, "the quiet read");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(picks.length, 3);
  });

  // (fails before: yes — none of these led to a Space)
  test("the ways in: the left bar's Space row and its project's menu, Ctrl+K; the door's pages open on the project (pinned in the source)", () => {
    const app = src("app.js");
    // An app's row under it: the Space's address with that app (the owner's idea of 10-29), its row marked by it.
    assert.match(app, /onSpace: \(id, tab\) => \{ location\.hash = routeFor\("space", \{ id, tab \}\); \}/);
    assert.match(app, /sidebar\.atSpace\(route\.kind === "space" \? route\.id : null, route\.kind === "space" \? route\.tab : null\);/);
    assert.equal(app.match(/openSpace: \(id, tab\) => \{ location\.hash = routeFor\("space", \{ id, tab \}\); \}/g)?.length, 2, "a Space of your own's and Your Space's way to a project's page");
    assert.match(app, /if \(route\.kind === "space"\) \{\s+renderSpace\(frame, route, spaceCallbacks\(\)\);\s+return;\s+\}/);
    // It goes when the address leaves it, and keeps your look then (the Hunter on S1).
    assert.match(app, /if \(route\.kind !== "space"\) \{\s+leaveSpace\(\);\s+frame\.querySelector\(":scope > \.space:not\(\.your-space\)"\)\?\.remove\(\);\s+\}/, "it goes when the address leaves it, its look kept");
    assert.match(app, /if \(route\.kind !== "your-space"\) frame\.querySelector\(":scope > \.your-space"\)\?\.remove\(\);/, "Your Space too (S5b)");
    assert.match(app, /holdJump\(\{ section, start: `project:\$\{id\}` \}\);/);
    assert.match(app, /id: "space", label: "Go to the Space"/);
    const sidebar = src("sidebar.js");
    // (The row counted by a loop of its own until 11-12; it reads the page's rule now, and sidebar-spaces.test.js draws it.)
    assert.match(sidebar, /const lanes = at\?\.ok \? lanePlaces\(at\.main, works\) : \[\];/, "the main folder is a lane, as the Space shows it: the page's own rule");
    // A project's Space row once it has a Space (the owner, 10-29: none until made; sidebar-made-spaces.test.js draws it).
    assert.match(sidebar, /if \(!g\.id \|\| g\.id === "none" \|\| !cb\.onSpace \|\| \(!own && !hasSpace\(g\.id\)\)\) return \[\];/, "the chats of no project, and a project with no Space: no row");
    assert.doesNotMatch(sidebar, /lanes\.(size|length) < 2/, "one lane and no open task still have their row");
    assert.match(sidebar, /lanes\.length \? `\$\{lanes\.length\} lane\$\{lanes\.length === 1 \? "" : "s"\}` : ""/, "its lanes counted from one");
    // Its chats at home, the Space row first: one in Now, or pinned, stands there alone (the Designer's of 10-27); a
    // thread under the chat that started it (thread-ui.test.js).
    assert.match(sidebar, /body\.replaceChildren\(\.\.\.keptSpaceRows\(g, own, \"\", !!own\), \.\.\.\(own \? \[\] : nestThreads\(home\)\.flatMap\(\(s\) => rowsOf\(s\)\)\)\);/);
    assert.match(sidebar, /"Open its Space"/);
    // (fails before: yes — found by the Hunter on S5a: the count stayed as it was past a row's moment)
    assert.match(sidebar, /nextTimer = soon \? setTimeout\(\(\) => void loadSpaces\(\), /, "Your Space's count asked again when /spaces says it changes");
    assert.match(src("now-list.js"), /all\.find\(\(r\) => r\.chain === chain && !r\.thread\) \|\| all\.find\(\(r\) => r\.chain === chain\) \|\| null/, "a chat's own row before its threads'");
    assert.match(src("settings/place-page.js"), /control\.start\(\/\^project:\/\.test\(String\(cb\.start \|\| ""\)\) \? String\(cb\.start\)\.slice\("project:"\.length\) : null\)/);
  });

  // HarnessV4_Space_Plan S5b: Your Space's ways in — the left bar's row under Search once a Space is grown (A7), its count
  // the chats' and every project's open rows, marked while there; the rail's Now popover the same row on top (A6); the
  // page drawn on its address with Now's rows; a dashboard's ⋯ switch (S5-D7, in the ⋯ alone).
  // (fails before: yes — there was no Your Space)
  test("Your Space's ways in: the left bar's row once a Space is grown, the rail's popover, its address, the ⋯ switch (pinned in the source)", () => {
    const sidebar = src("sidebar.js");
    assert.match(sidebar, /yourRow\.hidden = !extended \|\| !cb\.onYourSpace;/, "SG-D0: no row until a Space keeps a dashboard or holds a row");
    assert.match(sidebar, /const yourNeeds = \(\) => yourCount\(now\.needs, spaceNeeds\);/);
    assert.match(sidebar, /yourRow\.classList\.toggle\("current", atYours\);/);
    assert.match(sidebar, /const yours = extended && cb\.onYourSpace\s+\? h\("button", \{ class: `ys-row ys-pop-row/);
    const app = src("app.js");
    assert.match(app, /onYourSpace: \(\) => \{ location\.hash = routeFor\("your-space"\); \},/);
    assert.match(app, /sidebar\.atYourSpace\(route\.kind === "your-space"\);/);
    assert.match(app, /if \(route\.kind === "your-space"\) \{\s+renderYourSpace\(frame, \{\s+now: \(\) => sidebar\.nowGroups\(\),\s+openRow: \(r\) => sidebar\.openNow\(r\),/);
    const tabs = src("space/dashboards.js");
    assert.match(tabs, /type: "switch",\s+label: "Show on Home",[^}]*?icon: "house",\s+checked: d\.glance === true,\s+disabled: !statuses && !d\.glance,/);
    assert.match(src("space/space.css"), /\.sess-search-row\.ys-row\[hidden\] \{ display: none; \}/, "hidden is hidden, though the row is a flex box");
  });
});
