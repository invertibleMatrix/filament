// @ts-check
// The Space's page drawn again as it moves keeps the elements under the pointer (the owner's of 11-01: "when i hover
// over my mouse over some interactive elements like buttons then those are just suppose to highlight only once they
// quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to
// press more than once"). The lanes, the board and its pull chips, the Overlap banner, Who works here, the In chip, a
// dashboard's bar and faults, Needs you here, a shown project and its tiles, the routines, What happened, Where you
// left off, the Tell the chats card's outcome and the places' rows were each made anew — at every message of the
// Space's stream, every read of the places, every minute, or every tick of the clock — while the pointer rested on
// them: a lane's face, a card's, a chip, Compare…, a row's Done and Not now, a dashboard's ⋯ new elements under it,
// whose hover started over and where a press that began on the old one never clicked. Drawn in place (dom.js
// `morphChildren`), each keyed by what it is, they are the elements that stood, their words and their handlers the
// newest draw's. Home's are home-in-place.test.js's.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { moreWords } from "./helpers/routine-words.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/**
 * What the stand-in server answers by the whole address (and the method): a body, or undefined for a 404.
 * @type {(url: string, method: string) => any}
 */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method === "GET") asked.push(String(url));
  else posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = serve(String(url), method);
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderSpace } = await import("../src/ui/harness/space/space.js");
const { placesSection } = await import("../src/ui/harness/space/places.js");
const { logbookPanel } = await import("../src/ui/harness/space/logbook.js");
const { leftOffCard } = await import("../src/ui/harness/space/left-off.js");
const { syncCard } = await import("../src/ui/harness/space/sync-card.js");
const { leftOff } = await import("../src/ui/harness/lib/space-view.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  g.fetch = realFetch;
});

const MIN = 60_000;
const HOUR = 3_600_000;
const MAIN = { path: "/r", name: "r", main: true, ok: true, branch: "main", base: "main", onBase: true, ahead: 0, behind: 0,
  uncommitted: { files: 2 }, chats: [{ id: "c20", name: "on main", home: true, atWork: false }], removable: false, why: "the repository's main folder", goes: null };
const WT = { ...MAIN, path: "/r-wt", name: "r-wt", main: false, branch: "agent", onBase: false, ahead: 2, uncommitted: { files: 0 },
  chats: [{ id: "c21", name: "the agent", home: true, atWork: true }], why: "its branch holds 2 commits main lacks" };
/** The places answer as `/git/places` gives it. @param {any[]} places @param {string} [cwd] */
const placesOf = (places, cwd = "/r") => ({ cwd, ok: true, error: null, name: "r", main: "/r", places, removed: [] });
/** The Space as the server answers it, with what a test adds. @param {Record<string, any>} [o] @returns {any} */
const spaceOf = (o = {}) => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs: [], ...o });
/**
 * What the Space reads of the chats: the left bar's facts and Now's rows — the rows' object kept, so a test moves a
 * chat's words in place.
 * @param {Record<string, any>} chats @param {Record<string, any>} [rows]
 * @returns {import("../src/ui/harness/space/space.js").LaneLook}
 */
const lookOf = (chats, rows = {}) => ({
  chat: (id) => chats[id] || null,
  now: (id) => rows[id] || null,
  failed: () => false,
  modelName: (id) => `named ${id}`,
});
/**
 * Each part the very element it was — said in a word, not as a diff of two page trees, which is more than the reporter
 * can hold.
 * @param {Record<string, any>} now @param {Record<string, any>} was @param {string} what
 */
const same = (now, was, what) => {
  for (const k of Object.keys(was)) assert.ok(now[k] === was[k], `${what}: its ${k}`);
};
/** A button by its words. @param {any} at @param {string} label @returns {any} */
const button = (at, label) => at?.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;

describe("the Space's page drawn again", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
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
  /** What the page keeps in this browser. @type {Map<string, string>} */
  const kept = new Map();
  let hadStore;
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    // A toast's own timer: kept on the page here, so no test waits for one to go.
    g.window.setTimeout = () => 0;
    // A menu listens for its keys on the window.
    g.window.addEventListener ||= () => {};
    g.window.removeEventListener ||= () => {};
    hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
  });
  after(() => {
    for (const stop of stops) stop();
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    if (hadStore === undefined) delete g.localStorage;
    else g.localStorage = hadStore;
  });
  beforeEach(() => {
    asked.length = 0;
    posted.length = 0;
    for (const stop of stops.splice(0)) stop();
  });

  /** A menu opened from a button: its rows. @param {any} b @param {string} what */
  const menuOf = async (b, what) => {
    b.dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), what);
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  /** A second press on the button that stands closes its menu. @param {any} b */
  const closeMenuOf = (b) => {
    b.dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "a second press on the button that stands closes its menu");
  };

  /**
   * The Space drawn as the page draws it, for project p1 in /r, with what the page hands it.
   * @param {import("../src/ui/harness/space/space.js").LaneLook} look
   * @param {{ tab?: string, cb?: Partial<import("../src/ui/harness/space/space.js").SpaceCallbacks> }} [o]
   */
  const mountSpace = (look, o = {}) => {
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const did = { opened: /** @type {string[]} */ ([]), started: /** @type {any[]} */ ([]), spaces: /** @type {string[]} */ ([]), words: /** @type {any[]} */ ([]), rows: /** @type {string[]} */ ([]) };
    /** @type {import("../src/ui/harness/space/space.js").SpaceCallbacks} */
    const cb = {
      project: (id) => (id === "p1" ? { id: "p1", name: "r", cwd: "/r" } : null),
      look,
      openChat: (id) => void did.opened.push(id),
      newChat: (cwd, lane) => void did.started.push([cwd, lane]),
      startWith: (cwd, words, lane) => void did.words.push(lane ? [cwd, words, "a lane"] : [cwd, words]),
      openSpace: (id, tab) => void did.spaces.push(tab ? `${id} › ${tab}` : id),
      openRow: (r) => void did.rows.push(r.chain),
      dashboardFrame: (name) => ({ el: h("div", { class: "fake-frame", "data-artifact": name }), setTitle: () => {}, again: () => {}, version: () => {}, repaint: () => {} }),
      projectSettings: () => {},
      onMoved: () => {},
      onClose: () => {},
      ...o.cb,
    };
    const space = renderSpace(/** @type {any} */ (host), { id: "p1", ...(o.tab ? { tab: o.tab } : {}) }, cb);
    stops.push(space.stop);
    return { host, space, did };
  };
  /** The lanes once drawn. @param {any} host */
  const lanesDrawn = (host) => until(() => host.querySelector(".sp-lane-face"), "the lanes to be drawn");
  /** A lane by its folder. @param {any} host @param {string} path */
  const lane = (host, path) => host.querySelector(`.sp-lane[data-place="${path}"]`);
  /**
   * The Space moved, as its stream says: one more line in What happened, with what else the test moves. Waited for by
   * that line — the page draws everything else from the Space before it draws What happened's list, or with it.
   * @param {any} host @param {Record<string, any>} S  the Space as served @param {() => void} [change]
   */
  const moved = async (host, S, change = () => {}) => {
    change();
    S.seq += 1;
    S.log = [...S.log, { id: `e${S.seq}`, at: Date.now(), by: { kind: "you" }, text: `moved ${S.seq}`, task: null }];
    hear({ type: "space", project: "p1" });
    await until(() => host.querySelector(`[data-entry="e${S.seq}"]`), `the Space drawn again, at ${S.seq}`);
  };

  // (fails before: yes — the lanes were made anew at every message of the stream and every read of the places)
  test("the lanes drawn again as a chat's words move keep each lane's face, the sync point and New lane…; a press opens the one that stands", async () => {
    const at = Date.now();
    const S = spaceOf({ syncs: [{ id: "s1", at: at - 10 * MIN, also: "", lanes: [{ chain: "c20", when: "now", state: "sent" }, { chain: "c21", when: "now", state: "sent" }] }] });
    const rows = { c21: { group: "works", fact: "reads space.js" } };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return S;
      return undefined;
    };
    const { host, did } = mountSpace(lookOf({ c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - HOUR, line: "Wiring the lanes" } }, rows));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-syncpt"), "the sync point between the lanes");
    const find = () => ({ main: lane(host, "/r"), wt: lane(host, "/r-wt"), face: lane(host, "/r-wt")?.querySelector(".sp-lane-face"), sync: host.querySelector(".sp-syncpt"), fresh: host.querySelector(".sp-new-lane") });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "both lanes, the agent's face, the sync point, New lane…");
    await moved(host, S, () => { rows.c21.fact = "edits space.js"; });
    same(find(), was, "the lanes");
    assert.equal(was.face.querySelector(".sp-state-words").textContent, "working · edits space.js", "the face says its newest words");
    was.face.dispatch("click");
    was.fresh.dispatch("click");
    assert.deepEqual(did.opened, ["c21"], "the face opens its chat");
    assert.deepEqual(did.started, [["/r", true]], "New lane… starts one");
  });

  // (fails before: yes — the developer's reviewer of 11-02: the head's spans were paired by their order, so a lead whose
  // model came to be said drew it over its state, and the state and its spinner were made again)
  test("a lane's lead that comes to say its model keeps its state and its spinner as they stood", async () => {
    const at = Date.now();
    const S = spaceOf({});
    const rows = { c21: /** @type {Record<string, any>} */ ({ group: "works", fact: "reads space.js" }) };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return S;
      return undefined;
    };
    const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at - 3 * HOUR, line: "" }, c21: { title: "the agent", when: at - HOUR, line: "" } }, rows));
    await lanesDrawn(host);
    const head = () => lane(host, "/r-wt")?.querySelector(".sp-lane-head");
    const find = () => ({ state: head()?.querySelector(".sp-lane-state"), spin: head()?.querySelector(".sp-spin"), words: head()?.querySelector(".sp-state-words") });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "its state, its spinner, its words");
    assert.equal(head().querySelector(".sp-lane-who"), null, "no model said yet");
    await moved(host, S, () => { rows.c21.model = "big"; });
    assert.equal(head().querySelector(".sp-lane-who")?.textContent, "named big", "its model said");
    same(find(), was, "the lead's state");
    // Its turn ends: the spinner goes, the words stay themselves.
    await moved(host, S, () => { delete rows.c21.group; });
    assert.equal(head().querySelector(".sp-spin"), null, "no spinner once it rests");
    assert.equal(head().querySelector(".sp-state-words"), was.words, "its words the element that stood");
  });

  // (fails before: yes — the board was made anew at every message of the stream and as the lanes moved, the pull chips
  // at every message)
  test("the board and the pull chips drawn again keep each card's face, Add a task and each chip; a press opens the menu, or the editor, of the one that stands", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    const KEPT = { name: "prs-ab12", title: "PRs", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, fed: { lanes: { from: "prs", branch: "branch", words: "PR #{number}" }, tasks: null }, looks: [], sources: {}, updatedAt: at };
    const S = spaceOf({
      tasks: [{ id: "t1", title: "Fix login", line: "", column: "planned", parked: false, chain: null, place: null, by: { kind: "you" }, at: at - HOUR, movedAt: at - HOUR, startedAt: null, doneAt: null }],
      dashboards: [KEPT],
      feeds: {
        lanes: [],
        tasks: [{ dashboard: "prs-ab12", title: "PRs", source: "prs", key: "412", task: "Close PR 412", line: "", column: "doing", at, stale: false, presses: [] }],
        counts: [{ dashboard: "prs-ab12", title: "PRs", count: 1, more: 0 }],
      },
      pulls: [{ id: "pl1", service: "linear", title: "Linear", connection: "linear", tool: "issues", args: {}, rows: "", key: "", name: "", state: "", url: "", line: "", columns: {}, back: null, always: false, at, backStates: {}, readAt: at, error: null, reading: false }],
      pulled: {
        counts: [{ pull: "pl1", title: "Linear", count: 1, more: 0, done: 0 }],
        tasks: [{ pull: "pl1", service: "linear", title: "Linear", key: "LIN-1", keyWords: "LIN-1", task: "Sign-in loops", line: "", column: "planned", state: "open", url: "", lane: "lin-1", moved: false, at, stale: false }],
      },
    });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return S;
      return undefined;
    };
    const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at, line: "" }, c21: { title: "the agent", when: at, line: "" } }));
    await lanesDrawn(host);
    await until(() => host.querySelector('.sb-card[data-task="t1"]') && host.querySelector('.sp-pull-chip[data-pull="pl1"]'), "the board and the chips");
    const find = () => ({
      task: host.querySelector('.sb-card[data-task="t1"] .sb-face'),
      add: host.querySelector(".sb-add"),
      fed: host.querySelector('.sb-card[data-fed="prs-ab12 412"] .sb-face'),
      pulled: host.querySelector('.sb-card[data-pulled="pl1 LIN-1"] .sb-face'),
      chip: host.querySelector('.sp-pull-chip[data-pull="pl1"]'),
    });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "a task's face, Add a task, a fed card's face, a pulled card's face, a pull's chip");
    await moved(host, S, () => { S.tasks[0].title = "Fix login on Safari"; S.pulled.counts[0].count = 2; });
    same(find(), was, "the board's faces, Add a task and the chip");
    assert.equal(was.task.querySelector(".sb-t").textContent, "Fix login on Safari", "the task's face says its newest words");
    assert.equal(was.chip.textContent, "Linear 2", "the chip its newest count");
    assert.ok((await menuOf(was.fed, "the fed card's menu")).length, "the fed card's face opens its menu");
    closeMenuOf(was.fed);
    assert.ok((await menuOf(was.pulled, "the pulled card's menu")).length, "the pulled card's face opens its menu");
    closeMenuOf(was.pulled);
    assert.ok((await menuOf(was.chip, "the pull's menu")).length, "the chip opens the pull's menu");
    closeMenuOf(was.chip);
    was.task.dispatch("click");
    const editor = host.querySelector('form.sb-editor[data-task="t1"]');
    assert.ok(editor, "the task's face opens it to change");
    editor.dispatch("keydown", { key: "Escape" });
    assert.equal(host.querySelector("form.sb-editor"), null, "Escape closes it");
    assert.ok(host.querySelector(".sb-add") === was.add, "Add a task stands through the editor's open and close");
    was.add.dispatch("click");
    assert.ok(host.querySelector("form.sb-editor[data-new]"), "Add a task opens a new card");
  });

  // (fails before: yes — a Hunter's of 11-02: a file the computer would not read stopped the attach unsaid, and the
  // files after it never went)
  test("files dropped on a card: one the computer will not read is said, and the rest are attached", async () => {
    const at = Date.now();
    const S = spaceOf({ tasks: [{ id: "t1", title: "Logo", line: "", column: "planned", parked: false, chain: null, place: null, by: { kind: "you" }, at, movedAt: at, startedAt: null, doneAt: null }] });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/tasks/t1/files" && method === "POST") return { ok: true, task: S.tasks[0], space: S };
      return undefined;
    };
    const had = g.FileReader;
    g.FileReader = class {
      /** @type {any} */ result = null;
      /** @type {any} */ error = null;
      onload = () => {};
      onerror = () => {};
      /** @param {File} f */
      readAsDataURL(f) {
        setTimeout(() => {
          if (f.name === "locked.png") {
            this.error = new Error("the disk said no");
            this.onerror();
          } else {
            this.result = "data:image/png;base64,QUJD";
            this.onload();
          }
        });
      }
    };
    try {
      const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at, line: "" } }));
      const card = /** @type {any} */ (await until(() => host.querySelector('.sb-card[data-task="t1"]'), "the card"));
      const from = posted.length;
      card.dispatch("drop", { dataTransfer: { types: ["Files"], files: [new File(["x"], "locked.png", { type: "image/png" }), new File(["y"], "ok.png", { type: "image/png" })] } });
      await until(() => posted.length > from, "the file that reads, attached");
      assert.deepEqual(posted.slice(from).map((p) => [p.url, p.body.name, p.body.data]), [["/api/space/p1/tasks/t1/files", "ok.png", "QUJD"]]);
      await until(() => doc.document.body.querySelectorAll(".zc-toast").some((/** @type {any} */ t) => t.textContent === "locked.png could not be read: the disk said no"), "the one that would not read, said");
    } finally {
      if (had) g.FileReader = had;
      else delete g.FileReader;
    }
  });

  // (fails before: yes — the banner was made anew at every message of the stream)
  test("the Overlap banner drawn again keeps its Compare…, which opens the sheet", async () => {
    const at = Date.now();
    const S = spaceOf();
    const place = (/** @type {string} */ path, /** @type {number} */ ahead) => ({ path, ok: true, error: null, branch: "b", base: "main", ahead, commits: ahead, files: [{ path: "src/a.js", committed: true, uncommitted: false }], more: 0 });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN, WT]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/files?place=%2Fr&place=%2Fr-wt") return { places: [place("/r", 0), place("/r-wt", 2)] };
      return undefined;
    };
    const { host } = mountSpace(lookOf({ c20: { title: "on main", when: at, line: "" }, c21: { title: "the agent", when: at, line: "" } }));
    await lanesDrawn(host);
    await until(() => host.querySelector(".sp-overlap").hidden === false, "the Overlap banner");
    const compare = host.querySelector(".sp-compare");
    assert.ok(compare);
    await moved(host, S);
    assert.ok(host.querySelector(".sp-compare") === compare, "Compare… the button that stood");
    compare.dispatch("click");
    await until(() => doc.document.body.querySelector(".sp-compare-sheet"), "the sheet");
    doc.document.body.querySelector(".zc-sheet-x").dispatch("click");
  });

  // (fails before: yes — the rows were made anew at every message of the stream)
  test("Who works here drawn again keeps each chat's row; a press opens the one that stands", async () => {
    const at = Date.now();
    const chats = [{ id: "c30", name: "plan the week" }, { id: "c31", name: "groceries" }];
    const S = spaceOf({ own: { name: "Northwind", folder: "/r", repo: false } });
    const rows = { c30: { group: "works", fact: "writing the plan", model: "claude-opus-5-5" } };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: false, error: "not a git repository", chats };
      if (u === "/api/space/p1" && method === "GET") return S;
      return undefined;
    };
    const { host, did } = mountSpace(lookOf({ c30: { title: "Plan the week", when: at - MIN }, c31: { title: "Groceries", when: at - 3 * HOUR } }, rows),
      { cb: { project: (id) => (id === "p1" ? { id: "p1", name: "Northwind", cwd: "/r" } : null) } });
    await until(() => host.querySelector(".sp-who-sec")?.hidden === false && host.querySelector('.sp-who-row[data-chain="c30"]'), "Who works here");
    const find = () => ({ c30: host.querySelector('.sp-who-row[data-chain="c30"]'), c31: host.querySelector('.sp-who-row[data-chain="c31"]') });
    const was = find();
    await moved(host, S, () => { rows.c30.fact = "writing Tuesday"; });
    same(find(), was, "the rows");
    assert.equal(was.c30.querySelector(".sp-who-state").textContent, "working · writing Tuesday · named claude-opus-5-5", "saying the chat's newest words");
    was.c30.dispatch("click");
    assert.deepEqual(did.opened, ["c30"]);
  });

  // (fails before: yes — the chip was made anew at every tick of the clock)
  test("the In chip stands through the clock's draw; a press opens the Space it names", async () => {
    const S = spaceOf({ shownIn: { id: "w1", name: "Work" } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      return undefined;
    };
    const { host, space, did } = mountSpace(lookOf({}));
    const chip = await until(() => host.querySelector(".sp-in-chip"), "the In chip");
    space.paint();
    assert.ok(host.querySelector(".sp-in-chip") === chip, "the chip that stood");
    chip.dispatch("click");
    assert.deepEqual(did.spaces, ["w1"]);
  });

  // (fails before: yes — the bar, its faults and its foot were made anew at every message of the stream)
  test("a dashboard's bar drawn again keeps Refresh, ⋯, a fault's buttons and What it may do; each press acts on the one that stands", async () => {
    const at = Date.now();
    const command = ["npx", "wrangler", "deployments", "list", "--json"];
    const grant = { sources: { deploys: { command, every: 2 * MIN } }, watch: [], actions: {} };
    const KEPT = { name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant, newest: grant,
      reads: { sources: { deploys: { command } }, watch: [], actions: {} }, looks: [],
      sources: { deploys: { at: at - 12 * MIN, error: "npx exited 1: You are not authenticated.", errorAt: at - MIN, fails: 1, stopped: false, rows: 2 } }, updatedAt: at };
    const S = spaceOf({ dashboards: [KEPT] });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/dashboards/deploys-ab12/read" && method === "POST") return { ok: true };
      return undefined;
    };
    const { host } = mountSpace(lookOf({}), { tab: "deploys-ab12" });
    await until(() => host.querySelector(".sdb-view")?.hidden === false && host.querySelector(".sdb-refresh") && host.querySelector(".sdb-fault"), "its page, with its bar and its fault");
    const find = () => {
      const fault = host.querySelector(".sdb-fault");
      return { refresh: host.querySelector(".sdb-refresh"), more: host.querySelector(".sdb-more"), fix: button(fault, "Fix with an agent…"), again: button(fault, "Read again"), may: host.querySelector(".sdb-may") };
    };
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "Refresh, ⋯, Fix with an agent…, Read again, What it may do");
    await moved(host, S);
    same(find(), was, "the bar, its fault and its foot");
    assert.ok((await menuOf(was.more, "its menu")).length, "⋯ opens its menu");
    closeMenuOf(was.more);
    was.refresh.dispatch("click");
    await until(() => posted.length === 1, "Refresh's read");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/dashboards/deploys-ab12/read", body: {} });
    was.again.dispatch("click");
    await until(() => posted.length === 2, "Read again's read");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/dashboards/deploys-ab12/read", body: { source: "deploys" } });
  });

  // (fails before: yes — the rows and the foot were made anew where a chat's words or a row moved)
  test("Needs you here drawn again keeps a chat's row, a kept row with its Done and Not now, and the foot's Show; each press acts on the one that stands", async () => {
    const at = Date.now();
    const none = { sources: {}, watch: [], actions: {} };
    const KEPT = { name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: at, grant: none, newest: none,
      reads: { sources: {}, watch: [], actions: {} }, looks: [], sources: {}, updatedAt: at };
    /** @param {string} id @param {any} o */
    const need = (id, o) => ({ id, kind: "watch", text: `CI failed on main: run ${id}`, why: "a watch of Deploys", dashboard: "deploys-ab12", title: "Deploys", watch: "w0", at: at - 10 * MIN, state: "open", project: "p1", ...o });
    const S = spaceOf({ dashboards: [KEPT], needs: [need("w1", {}), need("d1", { state: "done", doneAt: at - MIN })] });
    const rows = { c20: { group: "needs", fact: "asks which branch", tone: "asks", at: at - MIN } };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/needs/w1" && method === "POST") {
        S.needs = S.needs.map((n) => (n.id === "w1" ? { ...n, state: "done", doneAt: Date.now() } : n));
        return { ok: true, space: S };
      }
      return undefined;
    };
    const { host, did } = mountSpace(lookOf({ c20: { title: "on main", when: at - MIN, line: "" } }, rows));
    await until(() => host.querySelector('.sp-need[data-chain="c20"]') && host.querySelector('.sp-need[data-need="w1"]'), "the rows");
    const sec = host.querySelector(".sp-needs-sec");
    const find = () => {
      const w1 = sec.querySelector('.sp-need[data-need="w1"]');
      return { chat: sec.querySelector('.sp-need[data-chain="c20"]'), w1, done: w1?.querySelector(".sp-need-done"), later: w1?.querySelector(".sp-need-later"), show: sec.querySelector(".sp-needs-show") };
    };
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the chat's row, the kept row, its Done and Not now, the foot's Show");
    await moved(host, S, () => { rows.c20.fact = "asks which file"; S.needs[0].text = "CI failed on main: run w1 again"; });
    same(find(), was, "the rows and the foot");
    assert.equal(was.chat.querySelector(".sp-need-t").textContent, "asks which file", "the chat's row says its newest words");
    assert.equal(was.w1.querySelector(".sp-need-t").textContent, "CI failed on main: run w1 again", "the kept row too");
    assert.ok((await menuOf(was.later, "Not now's choices")).length, "Not now opens its choices");
    closeMenuOf(was.later);
    was.chat.dispatch("click");
    assert.deepEqual(did.opened, ["c20"], "the chat's row opens it");
    was.show.dispatch("click");
    await until(() => sec.querySelector('.sp-past[data-need="d1"]'), "Done today's list");
    was.done.dispatch("click");
    await until(() => !sec.querySelector('.sp-need[data-need="w1"]'), "done");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w1", body: { done: true } });
  });

  // (fails before: yes — a shown project's block was made anew where a row moved, its tiles every minute)
  test("a shown project drawn again keeps its ⋯, Open its Space, its rows and its tiles; each press acts on the one that stands", async () => {
    const at = Date.now();
    let value = "7c1e";
    let text = "Reproduced: PLAY-91 Sign-in loops on Safari";
    const app = () => ({
      id: "p2", name: "app", cwd: "/app",
      needs: [{ id: "n7", kind: "repro", text, why: "", dashboard: "", title: "PLAY-91 Sign-in loops on Safari", project: "p2", at: at - 4 * MIN, state: "open",
        repro: { reproduced: true, test: "tests/safari.spec.ts", run: "npx playwright test safari", said: "fails", steps: "", tried: [], questions: [], draft: "", chain: "c41", byName: "Tester", cwd: "/app-wt/repro" } }],
      dashboards: [{ name: "deploys-ab12", title: "Deploys", state: "kept", paused: false }],
      glance: [{ project: "p2", name: "deploys-ab12", title: "Deploys", paused: false,
        tiles: [{ read: true, at, stale: false, error: null, title: "Live now", from: "deploys", line: { title: "Live now", value, format: "text", words: "", tone: "", at: at - 12 * MIN } }] }],
    });
    const S = spaceOf({ own: { name: "Work", folder: "/r", repo: true } });
    const asking = { key: "c40", chain: "c40", thread: null, group: "needs", title: "Fix login", project: "app", fact: "asks: which env?", tone: "asks", icon: "", tile: "needs", model: "", at: at - MIN, under: [], team: "", step: "" };
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return { ...S, shows: [app()] };
      return undefined;
    };
    const { host, did } = mountSpace(lookOf({}), { cb: {
      projects: () => [{ id: "p1", name: "Work", cwd: "/r" }, { id: "p2", name: "app", cwd: "/app" }],
      ownSpaces: () => [{ project: "p1", name: "Work" }],
      asking: (id) => (id === "p2" ? [/** @type {any} */ (asking)] : []),
    } });
    const block = () => host.querySelector('.sp-show[data-project="p2"]');
    await until(() => block()?.querySelector(".ys-card") && block()?.querySelector('.sp-need[data-need="n7"]'), "the shown project, its rows and its tile");
    const find = () => ({
      block: block(),
      more: block()?.querySelector(".sp-show-more"),
      go: block()?.querySelector(".sp-show-go"),
      ask: block()?.querySelector('.sp-need[data-chain="c40"]'),
      done: block()?.querySelector('.sp-need[data-need="n7"] .sp-need-done'),
      card: block()?.querySelector('.ys-card[data-dashboard="deploys-ab12"]'),
    });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the block, its ⋯, Open its Space, the chat's row, the kept row's Done, the tile");
    await moved(host, S, () => { value = "8d2f"; text = "Reproduced: PLAY-91 Sign-in loops on Safari and Firefox"; });
    same(find(), was, "the shown project");
    assert.equal(was.card.querySelector(".ys-g-value").textContent, "8d2f", "the tile says its newest value");
    assert.equal(was.block.querySelector('.sp-need[data-need="n7"] .sp-need-t').textContent, text, "the row its newest words");
    was.card.dispatch("click");
    was.card.dispatch("keydown", { key: "Enter" });
    was.go.dispatch("click");
    assert.deepEqual(did.spaces, ["p2 › deploys-ab12", "p2 › deploys-ab12", "p2"], "the tile opens its page, by a press and by Enter; Open its Space its Space");
    was.ask.dispatch("click");
    assert.deepEqual(did.rows, ["c40"], "the chat's row opens it");
    const items = await menuOf(was.more, "its ⋯");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Stop showing here"]);
    closeMenuOf(was.more);
  });

  // (fails before: yes — the routines' rows were made anew at every message of the stream that moved a routine's words)
  test("the routines drawn again keep each row, its ⋯ and Run now, and a watch's row; each press acts on the one that stands", async () => {
    const at = Date.now();
    const words = { when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "Mon 27 Oct 09:00", ...moreWords() };
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.\nWrite the brief.", writes: false, state: "on", paused: false, madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", last: null, words };
    const watch = { project: "p1", dashboard: "deploys-ab12", title: "Deploys", key: "w0", rule: "a deploy fails", to: "Needs you", every: "5 min", paused: false, last: null, nextAt: at + MIN, lastWords: "never", nextWords: "in 5 min" };
    const S = spaceOf({ runs: { head: "Runs by itself: 1 routine · next: Morning brief at 09:00", pausedSince: null, routines: [R], watches: [watch] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      if (u === "/api/space/p1/routines/r1/run" && method === "POST") return { ok: true };
      return undefined;
    };
    const { host, space } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    space.show("@routines");
    await until(() => host.querySelector('.srt-row[data-routine="r1"]') && host.querySelector('.srt-row[data-watch="w0"]'), "the routine's row and the watch's");
    const find = () => {
      const row = host.querySelector('.srt-row[data-routine="r1"]');
      return { row, more: row?.querySelector(".srt-more"), go: row?.querySelector(".srt-go"), watch: host.querySelector('.srt-row[data-watch="w0"]') };
    };
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the routine's row, its ⋯ and Run now, the watch's row");
    await moved(host, S, () => { R.words = { ...words, last: "ran today 09:00", said: "The brief is written" }; });
    same(find(), was, "the routines");
    assert.match(was.row.textContent, /ran today 09:00/, "the row says its newest words");
    const items = await menuOf(was.more, "its ⋯");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Run now", "Pause", "What it does", "Remove"]);
    closeMenuOf(was.more);
    was.go.dispatch("click");
    await until(() => posted.length === 1, "Run now's run");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/routines/r1/run", body: {} });
  });

  // (fails before: yes — the overview had no Runs by itself)
  test("Runs by itself drawn again as a routine's words move keeps each row, its face and its Switch on…; a press acts on the one that stands", async () => {
    const at = Date.now();
    const words = { when: "weekdays at 09:00", may: "reads only", allowed: "Reads only: it changes no file and sends nothing", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "next: tomorrow 09:00", nextAt: at + HOUR, first: "Mon 27 Oct 09:00", ...moreWords() };
    const R = { id: "r1", title: "Morning brief", when: "weekdays 09:00", task: "Read what came in.", writes: false, state: "on", paused: false, madeIn: "c20", madeBy: "on main", madeName: "on main", model: "glm-5.3", project: "p1", last: null, words };
    const P = { ...R, id: "r2", title: "Weekly update", state: "proposed" };
    const S = spaceOf({ runs: { head: "Runs by itself: 1 routine · next: Morning brief at 09:00", pausedSince: null, routines: [R, P], watches: [] } });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return placesOf([MAIN]);
      if (u === "/api/space/p1" && method === "GET") return S;
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      return undefined;
    };
    const { host } = mountSpace(lookOf({}));
    await lanesDrawn(host);
    /** @param {string} id */
    const row = (id) => host.querySelector(`.sbi-row[data-key="routine:p1|${id}"]`);
    await until(() => row("r1") && row("r2"), "its rows");
    const find = () => ({ row: row("r1"), face: row("r1")?.querySelector(".sbi-face"), proposed: row("r2"), go: row("r2")?.querySelector(".sbi-go") });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the routine's row and its face, the proposed one's row and its Switch on…");
    assert.deepEqual([was.row.querySelector(".sbi-word").textContent, was.proposed.parentNode.children.indexOf(was.proposed)], ["On", 0], "the proposed one first");
    await moved(host, S, () => { R.words = { ...words, tone: "bad", last: "last: today 09:00 · failed: sign-in expired" }; });
    same(find(), was, "the rows");
    assert.deepEqual([was.row.querySelector(".sbi-word").textContent, was.row.parentNode.children.indexOf(was.row)], ["Failed", 0], "the row says its newest word, and comes first");
    was.go.dispatch("click");
    await until(() => doc.document.body.querySelector(".srt-sheet"), "Switch on… opens its sheet");
    doc.document.body.querySelector(".srt-sheet .zc-sheet-x").dispatch("click");
    assert.deepEqual(posted, [], "nothing switched on");
    was.face.dispatch("click");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".srt").hidden], [true, false], "its face opens Routines");
  });

  const NOW = new Date(2026, 9, 14, 11, 0).getTime();
  /** @type {Record<string, string>} */
  const NAMES = { c1: "opus55", c2: "HarnessV3_Impl", c3: "a side chat" };
  const nameOf = (/** @type {string} */ c) => NAMES[c] || c;
  const L_MAIN = { path: "H:\\filament", chip: "main", main: true, chains: ["c1"] };
  const L_UX = { path: "H:/filament-ux/", chip: "ux-overhaul", main: false, chains: ["c2", "c3"] };
  /** A line of What happened. @param {string} id @param {number} at @param {string} chain @param {string} text */
  const entry = (id, at, chain, text) => ({ id, at, by: { kind: "agent", chain }, text, task: null });

  // (fails before: yes — the list was made anew at every line that landed and every minute)
  test("What happened drawn again as a line lands keeps each line and its chat's name; a press opens the one that stands", () => {
    const opened = /** @type {string[]} */ ([]);
    const l = logbookPanel({ lanes: () => [L_MAIN, L_UX], nameOf, laneOf: (c) => [L_MAIN, L_UX].find((x) => x.chains.includes(c)) || null, write: async () => ({ ok: true }), copyWeek: () => {}, tell: () => {}, openChat: (c) => void opened.push(c), now: () => NOW });
    doc.document.body.append(l.el);
    try {
      const log = [entry("e1", NOW - 2 * HOUR, "c1", "Now list built."), entry("e2", NOW - HOUR, "c2", "May I delete 3 old snapshots?")];
      l.paint(log, 4);
      const find = () => ({ e1: l.el.querySelector('[data-entry="e1"]'), who: l.el.querySelector('[data-entry="e1"] .sl-who'), e2: l.el.querySelector('[data-entry="e2"]') });
      const was = find();
      assert.ok(Object.values(was).every(Boolean));
      l.paint([...log, entry("e3", NOW - MIN, "c3", "Tests green.")], 4);
      assert.deepEqual(l.el.querySelectorAll(".sl-entry").map((/** @type {any} */ e) => e.getAttribute("data-entry")), ["e3", "e2", "e1"], "the newest first");
      same(find(), was, "the lines");
      was.who.dispatch("click");
      assert.deepEqual(opened, ["c1"]);
    } finally {
      l.el.remove();
    }
  });

  // (fails before: yes — the card was made anew at every line that landed and every minute)
  test("Where you left off drawn again as a line lands keeps Continue, Catch me up… and Dismiss; each press acts", () => {
    const did = { opened: /** @type {string[]} */ ([]), caught: /** @type {number[]} */ ([]), dismissed: 0 };
    const card = leftOffCard({ nameOf, openChat: (c) => void did.opened.push(c), catchUp: (at) => void did.caught.push(at), dismiss: () => void did.dismissed++, now: () => NOW });
    doc.document.body.append(card.el);
    try {
      const log = [entry("e1", NOW - HOUR, "c1", "Now list built.")];
      const asks = [{ chain: "c2", name: "HarnessV3_Impl", fact: "asks which branch" }];
      card.paint(leftOff({ last: NOW - 2 * HOUR, now: NOW, log, asks, newest: null }));
      const find = () => ({ go: card.el.querySelector(".sp-left-go"), catchUp: card.el.querySelector(".sp-left-catch"), x: card.el.querySelector(".sp-left-x") });
      const was = find();
      assert.ok(Object.values(was).every(Boolean), "Continue, Catch me up…, Dismiss");
      card.paint(leftOff({ last: NOW - 2 * HOUR, now: NOW, log: [...log, entry("e2", NOW - MIN, "c1", "Tests green.")], asks, newest: null }));
      assert.equal(card.el.querySelectorAll(".sp-left-lines li").length, 2, "the line that landed");
      same(find(), was, "the card's buttons");
      was.go.dispatch("click");
      was.catchUp.dispatch("click");
      was.x.dispatch("click");
      assert.deepEqual([did.opened, did.caught, did.dismissed, card.el.hidden], [["c2"], [NOW - 2 * HOUR], 1, true]);
    } finally {
      card.el.remove();
    }
  });

  // (fails before: yes — the outcome was made anew at every message of the stream while it showed)
  test("the Tell the chats card's outcome drawn again as a chat's turn ends keeps each chat's row and Close", async () => {
    const CHATS = [
      { chain: "c1", name: "opus55", chip: "main", main: true, works: true, lead: true },
      { chain: "c2", name: "HarnessV3_Impl's lead", chip: "ux-overhaul", main: false, works: false, lead: true },
    ];
    const sync = { id: "s1", at: NOW, also: "", lanes: [{ chain: "c1", when: "after", state: "waiting" }, { chain: "c2", when: "now", state: "sent" }] };
    const space = { project: "p1", seq: 3, tasks: [], log: [], logMore: 0, syncs: [sync], names: {}, waiting: ["c1"] };
    const s = syncCard({ chats: () => CHATS, plain: () => false, last: () => ({ id: "s0", at: NOW - 2 * HOUR, also: "", lanes: [] }), run: async () => ({ ok: true, sync, space }), nameOf, now: () => NOW });
    doc.document.body.append(s.el);
    try {
      s.open();
      button(s.el, "Tell them").dispatch("click");
      await until(() => s.el.querySelector(".sy-out"), "the outcome");
      const find = () => ({ c1: s.el.querySelector('.sy-row[data-chain="c1"]'), c2: s.el.querySelector('.sy-row[data-chain="c2"]'), close: button(s.el, "Close") });
      const was = find();
      assert.ok(Object.values(was).every(Boolean));
      assert.equal(was.c1.querySelector(".sy-out").textContent, "waits for its turn to end");
      s.paint(/** @type {any} */ ({ ...space, syncs: [{ ...sync, lanes: [{ ...sync.lanes[0], state: "sent" }, sync.lanes[1]] }], waiting: [] }));
      same(find(), was, "the outcome's rows and Close");
      assert.equal(was.c1.querySelector(".sy-out").textContent, "sent as a turn of its own", "saying what came of it");
      was.close.dispatch("click");
      assert.equal(s.el.hidden, true);
    } finally {
      s.el.remove();
    }
  });

  // (fails before: yes — the rows were made anew at every read of the places)
  test("the places' rows drawn again at a read keep each row, its Open and its ⋯; ⋯ opens and closes its menu", async () => {
    let wt = WT;
    serve = (u) => (u === "/api/git/places?cwd=%2Fr" ? placesOf([MAIN, wt]) : undefined);
    const s = placesSection({ folder: () => "/r", self: null, editorButton: (_path, what) => h("button", { class: "pl-open", type: "button", title: what }), onMoved: () => {} });
    doc.document.body.append(s.el);
    try {
      await s.load();
      const find = () => {
        const row = /** @type {any} */ (s.el.querySelector('.pl-row[data-place="/r-wt"]'));
        return { row, open: row?.querySelector(".pl-open"), more: row?.querySelector(".pl-more"), main: s.el.querySelector('.pl-row[data-place="/r"]') };
      };
      const was = find();
      assert.ok(Object.values(was).every(Boolean), "the worktree's row, its Open and ⋯, the main folder's row");
      assert.match(was.row.textContent, /↑2/, "the row says what the first read found");
      wt = { ...WT, ahead: 3, why: "its branch holds 3 commits main lacks" };
      await s.load();
      same(find(), was, "the rows");
      assert.match(was.row.textContent, /↑3/, "the row says what the read found");
      const items = await menuOf(was.more, "its ⋯");
      assert.deepEqual(items.map((/** @type {any} */ i) => i.querySelector(".zc-menu-label-line").textContent), ["Remove worktree…", "Remove worktree and branch…"]);
      closeMenuOf(was.more);
    } finally {
      s.el.remove();
    }
  });
});
