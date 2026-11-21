// @ts-check
// HarnessV3-Views V2: the session's views — the address that carries the view, the tabs in the header (their roles,
// keys and badges), what the Plan tab counts, the host that switches views per chat and gathers the run's events into
// one repaint, the side pane without Plan and Session, the views' shortcuts and Command Center rows, and the app's
// wiring — on the fake DOM. V3: the Team tab — its badge, its view drawn while it shows, the pulses that keep its
// clocks moving, and a card brought into sight; HarnessV3-TaskGraph G3-7: a task still to come opening on the graph.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { onScreen, parseRoute, routeFor, VIEWS } from "../src/ui/harness/lib/router.js";
import { matchShortcut, comboFromEvent, comboOf } from "../src/ui/harness/shortcuts.js";
import { closedTabsOf, fileTabId, tabCanOpen } from "../src/ui/harness/panes/pane-data.js";
import { readLayout } from "../src/ui/harness/panes/tiles.js";
import { buttonsOf as paneButtonsOf } from "../src/ui/harness/panes/pane-buttons.js";
import { actionsFor } from "../src/ui/harness/command-center.js";
import { viewTabs } from "../src/ui/harness/views/tabs.js";
import { OVERVIEW_STAYS_MS, createViews, viewOf, chatBadge, planShown } from "../src/ui/harness/views/host.js";
import { planCount } from "../src/ui/harness/views/plan.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamIO, modelSelects } from "./helpers/team-view.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";
import "./helpers/teams-on-page.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} n @param {string} cls */
const one = (n, cls) => byClass(n, cls)[0];
/** A view's tab under a node. @param {any} n @param {string} id */
const tabOf = (n, id) => buttonsOf(n).find((b) => b.attrs["data-view"] === id);
/** A view tab's badge. @param {any} n @param {string} id */
const badgeOf = (n, id) => one(tabOf(n, id), "view-badge");
/** Each tab's word and whether it is the one on screen. @param {any} n */
const tabsOn = (n) => buttonsOf(n).map((b) => [textOf(one(b, "view-tab-label")), b.attrs["aria-selected"]]);
const settle = () => new Promise((r) => setImmediate(r));

/** A turn whose run carried these events. @param {any[]} events @param {number} [n] */
const turnWith = (events, n = 1) => ({ n, status: "done", aligned: alignEvents(events) });
/** A checklist of these statuses, as a `plan` event carries it. @param {string[]} statuses */
const checklist = (statuses) => turnWith([{ n: 1, type: "plan", round: 1, items: statuses.map((status, i) => ({ text: `Step ${i + 1}`, status })) }]);
/** A chat in the page with a session. @param {string} id @param {{ turns?: any[] }} [o] */
const sessionChat = (id, { turns = [] } = {}) => ({
  id,
  chainId: `chain-${id}`,
  title: `Chat ${id}`,
  turns,
  live: /** @type {any} */ (null),
  viewTab: /** @type {string | undefined} */ (undefined),
  view: { settings: { effective: {} } },
});

const T0 = 1_000_000;
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Lexer", needs: [] },
    { id: "t2", name: "Parser", needs: ["t1"] },
    { id: "t3", name: "Docs", needs: ["t1"] },
    { id: "t4", name: "Release", needs: ["t2", "t3"] },
  ],
};
/** The graph after these calls, as the view draws it. @param {any[]} calls */
function graphAfter(calls) {
  /** @type {any} */
  let g = null;
  calls.forEach((input, i) => {
    const r = /** @type {any} */ (applyTasks(g, input, { at: T0 + i * 60_000, crew: "agent" }));
    assert.ok(r.ok, r.error);
    g = r.graph;
  });
  return graphView(g);
}

describe("Views V2: the address", () => {
  // (fails before: yes — the address had no view: `#/task/abc/plan` opened the session on its conversation; V3: and
  // `/team` opened it on its conversation)
  test("a session's address carries its view: bare is Chat, `/plan` and `/team` their views, one the page does not know is Chat", () => {
    assert.deepEqual(VIEWS, ["chat", "overview", "side", "team", "plan"], "the tabs' order (proposal_ux D4)");
    assert.deepEqual(parseRoute("#/task/abc/plan"), { kind: "task", id: "abc", view: "plan" });
    assert.deepEqual(parseRoute("#/task/abc/overview"), { kind: "task", id: "abc", view: "overview" });
    assert.deepEqual(parseRoute("#/task/abc/team"), { kind: "task", id: "abc", view: "team" });
    assert.deepEqual(parseRoute("#/task/abc"), { kind: "task", id: "abc", view: "chat" });
    assert.deepEqual(parseRoute("#/task/abc/graph"), { kind: "task", id: "abc", view: "chat" }, "an old or mistyped view opens the conversation");
    assert.equal(routeFor("task", { id: "a b", view: "plan" }), "#/task/a%20b/plan");
    assert.equal(routeFor("task", { id: "a b", view: "team" }), "#/task/a%20b/team");
    assert.equal(routeFor("task", { id: "a b", view: "chat" }), "#/task/a%20b", "Chat is the bare address");
    assert.equal(routeFor("task", { id: "a b", view: "graph" }), "#/task/a%20b");
    assert.equal(routeFor({ kind: "task", id: "x/y", view: "plan" }), "#/task/x%2Fy/plan");
    assert.deepEqual(parseRoute(routeFor("task", { id: "x/y", view: "plan" })), { kind: "task", id: "x/y", view: "plan" });
  });

  // (fails before: yes — phase 7: the Library's pages were Settings sections)
  test("the Library's addresses: a page each, Memory's with the workspace it opens on; an unknown page is Agents and teams; each a full-frame screen", () => {
    assert.deepEqual(parseRoute("#/library/agents"), { kind: "library", page: "agents", scope: "" });
    assert.deepEqual(parseRoute("#/library/skills"), { kind: "library", page: "skills", scope: "" });
    assert.deepEqual(parseRoute("#/library/memory"), { kind: "library", page: "memory", scope: "" });
    assert.deepEqual(parseRoute("#/library/nope"), { kind: "library", page: "agents", scope: "" });
    assert.deepEqual(parseRoute("#/library/agents/extra"), { kind: "library", page: "agents", scope: "" }, "a scope is Memory's alone");
    const folder = "H:\\work\\my app";
    assert.equal(routeFor("library", { page: "memory", scope: folder }), `#/library/memory/${encodeURIComponent(folder)}`);
    assert.deepEqual(parseRoute(routeFor("library", { page: "memory", scope: folder })), { kind: "library", page: "memory", scope: folder });
    assert.equal(routeFor("library", { page: "agents", scope: folder }), "#/library/agents");
    assert.equal(routeFor("library", { page: "" }), "#/library/agents");
    assert.deepEqual(["#/library/agents", "#/library/memory/p1"].map(onScreen), [true, true]);
  });

  // (fails before: yes — with Settings open, a session clicked in the sidebar opened underneath and Settings stayed:
  // the chat an import had just brought looked as if it would not open)
  test("a task opened from the sidebar leaves a full-frame screen for it", () => {
    assert.deepEqual(["#/settings/import", "#/settings", "#/control-room/r1"].map(onScreen), [true, true, true]);
    // The Session inspector's old address is no screen now: the page leads it to the chat's Overview (proposal_ux R1).
    assert.deepEqual(["", "#/", "#/task/abc", "#/task/abc/plan", "#/control-room", "#/context/map"].map(onScreen), [false, false, false, false, false, false]);
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /function leaveScreen\(\) \{\s*if \(onScreen\(location\.hash\)\) location\.hash = backTo\(\);\s*\}/);
    // every sidebar click that opens a task: a new one, a session, an open chat, a fork, a load
    const wiring = app.slice(app.indexOf("const sidebar = createSidebar("), app.indexOf("onSearch:"));
    for (const opens of ["newChat(); leaveScreen();", "openSession(s, { push: true, view: \"chat\" });\n    leaveScreen();", "selectChat(id, { view: \"chat\" }); leaveScreen();", "if (state.currentId !== was) leaveScreen();", "loadIntoNewTask(s); leaveScreen();"])
      assert.ok(wiring.includes(opens), opens);
    // the chat selected under a screen still leaves the address alone, so a direct link to the screen holds on load
    assert.match(app, /if \(onScreen\(location\.hash\)\) \{ pushNextAddress = false; return; \}\s*syncAddress\(chat\);/);
  });
});

describe("Views V2: the tabs", () => {
  /** @param {{ on: string, planKeys: string }} s @param {boolean} [team]  a third tab, as VW-D1's Team will be */
  const tabsFor = (s, team = false) => viewTabs({
    views: [
      { id: "chat", label: "Chat", icon: "messageSquare", tip: "The conversation", kbd: () => "Alt+1" },
      { id: "plan", label: "Plan", icon: "listTodo", tip: "The plan", kbd: () => s.planKeys },
      ...(team ? [{ id: "team", label: "Team", icon: "users", tip: "Who works", kbd: () => "Alt+3" }] : []),
    ],
    value: () => s.on,
    onChange: (id) => { s.on = id; },
  }, fakeH);

  // (fails before: yes — the header had no view tabs: the module did not exist)
  test("a tab list: the one on screen selected and alone in the Tab order, each naming its shortcut as it stands", () => {
    const s = { on: "chat", planKeys: "Alt+2" };
    const t = tabsFor(s);
    assert.deepEqual([t.el.attrs.role, t.el.attrs["aria-label"]], ["tablist", "Views of this session"]);
    const [chat, plan] = buttonsOf(t.el);
    /** @param {any} b */
    const said = (b) => [b.attrs.role, b.attrs["data-view"], b.attrs["aria-selected"], b.attrs.tabindex, b.attrs["aria-keyshortcuts"], b.classList.contains("is-on")];
    assert.deepEqual(said(chat), ["tab", "chat", "true", "0", "Alt+1", true]);
    assert.deepEqual(said(plan), ["tab", "plan", "false", "-1", "Alt+2", false]);
    assert.deepEqual([textOf(chat), textOf(plan)], ["Chat", "Plan"], "an icon and a word; the badge is empty");
    plan.dispatch("click");
    assert.equal(s.on, "plan");
    assert.deepEqual([said(chat), said(plan)], [["tab", "chat", "false", "-1", "Alt+1", false], ["tab", "plan", "true", "0", "Alt+2", true]]);
    assert.equal(plan.focused, true, "the focus goes with the choice");
    s.planKeys = "Alt+P";
    t.paint();
    assert.equal(plan.attrs["aria-keyshortcuts"], "Alt+P", "a rebound shortcut is the one named");
  });

  // (fails before: yes — the header had no view tabs)
  // The keys are tried on three tabs (fails before: no — a guard the mutation pass asked for: on two, Left and Right
  // land on the same tab, so a Left that moved right passed).
  test("the keys: the arrows move between the tabs and wrap, Home and End go to the ends, any other key is the page's", () => {
    const s = { on: "chat", planKeys: "Alt+2" };
    const t = tabsFor(s, true);
    /** @param {string} key */
    const press = (key) => {
      let stopped = false;
      t.el.dispatch("keydown", { key, preventDefault() { stopped = true; } });
      return [s.on, stopped];
    };
    assert.deepEqual(press("ArrowRight"), ["plan", true]);
    assert.deepEqual(press("ArrowRight"), ["team", true]);
    assert.deepEqual(press("ArrowRight"), ["chat", true], "past the last, the first");
    assert.deepEqual(press("ArrowLeft"), ["team", true], "before the first, the last");
    assert.deepEqual(press("ArrowLeft"), ["plan", true]);
    assert.deepEqual(press("Home"), ["chat", true]);
    assert.deepEqual(press("End"), ["team", true]);
    assert.deepEqual(press("a"), ["team", false]);
    assert.equal(tabOf(t.el, "team").focused, true);
  });

  // (fails before: yes — the header had no view tabs)
  test("a badge: a figure, a dot or both, what it says read with the tab's name; orange while it asks; gone with nothing to say", () => {
    const t = tabsFor({ on: "plan", planKeys: "Alt+2" });
    const [chat, plan] = buttonsOf(t.el);
    t.badge("plan", { text: "2/5", words: "2 of 5 done" });
    assert.deepEqual([textOf(badgeOf(t.el, "plan")), plan.attrs["aria-label"]], ["2/5", "Plan, 2 of 5 done"]);
    t.badge("chat", { dot: "asks", words: "waiting for your answer" });
    const badge = badgeOf(t.el, "chat");
    assert.deepEqual([badge.kids.map((/** @type {any} */ k) => k.attrs.class), badge.classList.contains("is-asks"), chat.attrs["aria-label"]],
      [["view-dot"], true, "Chat, waiting for your answer"]);
    t.badge("chat", { dot: "works", words: "working" });
    assert.deepEqual([badge.kids.length, badge.classList.contains("is-asks"), chat.attrs["aria-label"]], [1, false, "Chat, working"]);
    t.badge("chat", null);
    assert.deepEqual([badge.kids, badge.classList.contains("is-asks"), chat.attrs["aria-label"]], [[], false, "Chat"]);
    t.badge("team", { text: "1", words: "one" });
    assert.deepEqual(buttonsOf(t.el).map((b) => b.attrs["aria-label"]), ["Chat", "Plan, 2 of 5 done"], "a view the tabs do not have is no badge");
  });
});

describe("Views V2: what the Plan tab counts", () => {
  // (fails before: yes — nothing counted the plan: the Plan pane's tab had no badge)
  test("done of all while something is open: the graph's tasks when the agent planned on it or there is no checklist, else the checklist", () => {
    const items = (/** @type {string[]} */ statuses) => statuses.map((status) => ({ text: "x", status }));
    assert.deepEqual(planCount({ plan: items(["done", "doing", "todo"]), graph: null, planned: "plan" }), { done: 1, all: 3 });
    assert.equal(planCount({ plan: items(["done", "done"]), graph: null, planned: "plan" }), null, "every item done: nothing to count");
    assert.equal(planCount({ plan: [], graph: null, planned: null }), null, "no plan");
    const running = graphAfter([ADD, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Lexer" }]);
    assert.deepEqual(planCount({ plan: [], graph: running, planned: "graph" }), { done: 1, all: 4 });
    assert.deepEqual(planCount({ plan: [], graph: running, planned: "plan" }), { done: 1, all: 4 }, "no checklist: the graph");
    assert.deepEqual(planCount({ plan: items(["doing"]), graph: running, planned: "plan" }), { done: 0, all: 1 }, "the checklist was the agent's newest plan");
    assert.deepEqual(planCount({ plan: items(["doing"]), graph: running, planned: "graph" }), { done: 1, all: 4 });
    const dropped = graphAfter([ADD, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Lexer" }, { action: "drop", id: "t4", reason: "Not this time" }]);
    assert.deepEqual(planCount({ plan: [], graph: dropped, planned: "graph" }), { done: 1, all: 3 }, "a dropped task is out of the count");
    const closed = graphAfter([ADD, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Lexer" }, { action: "close", reason: "Shipped" }]);
    assert.equal(planCount({ plan: [], graph: closed, planned: "graph" }), null, "a closed graph has nothing open");
  });
});

describe("Views V2: the views, per chat", () => {
  /** A host on the fake DOM, its run's repaints held until a test lets them go. @param {any} [more] more options */
  function hostOf(more = {}) {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    let mounts = 0;
    const put = slot.replaceChildren;
    slot.replaceChildren = (/** @type {any[]} */ ...kids) => { mounts += 1; put(...kids); };
    /** @type {(() => void)[]} */
    const due = [];
    /** The Overview tab's hides, each half a minute after its view was left. @type {(() => void)[]} */
    const hides = [];
    /** @type {any[]} */
    const shown = [];
    /** @type {{ turn: any, land: () => void }[]} the runs the views asked for, each landing when the test says */
    const reads = [];
    const views = createViews({
      frame,
      slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH,
      api: async () => null,
      openAgent: () => {},
      openRunLog: () => {},
      onShow: (chat) => { shown.push([chat.id, chat.viewTab]); },
      loadRun: (turn) => new Promise((land) => { reads.push({ turn, land: () => land() }); }),
      later: (fn, ms) => {
        if (ms === OVERVIEW_STAYS_MS) return void hides.push(fn);
        assert.equal(ms, 1200);
        due.push(fn);
      },
      team: teamIO(),
      side: /** @type {any} */ (sideIO()),
      sideSeams: sideSeams().seams,
      place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
      modelSelect: modelSelects().make,
      ...more,
    });
    return { frame, slot, due, hides, shown, reads, views, plan: frame.kids[0], mounts: () => mounts };
  }

  // (fails before: yes — the owner's of 10-30: the Overview tab stood in every chat with a session, beside the button
  // under the box that opens it)
  test("the Overview tab hides until its view shows, and goes half a minute after the view is left — for Chat or any — unless it comes back", () => {
    const { slot, views, hides } = hostOf();
    views.setChat(sessionChat("host-overview"));
    const hidden = () => tabOf(slot, "overview").classList.contains("hidden");
    assert.equal(hidden(), true, "on Chat: no Overview tab");
    views.show("overview");
    assert.equal(hidden(), false, "its view on screen (the button under the box, Alt+2): its tab");
    views.show("chat");
    assert.deepEqual([hidden(), hides.length], [false, 1], "left for Chat: it stays a while");
    views.show("overview");
    hides.shift()?.();
    assert.equal(hidden(), false, "back on it before the half minute: it stays");
    views.show("plan");
    assert.equal(hidden(), false, "left for another view: it stays a while");
    hides.shift()?.();
    assert.deepEqual([hidden(), hides.length], [true, 0], "half a minute on: gone");
  });

  // (fails before: yes — the chat-open audit's follow-up of 10-29: a chat opened from the list asked for its session's
  // whole row as the views took it, beside its transcript — the page's first request out — and again once the
  // transcript had landed)
  test("a chat whose transcript is on its way asks nothing of its session until it has landed, then once", () => {
    /** @type {string[]} */
    const asked = [];
    const opening = new Set();
    const { views } = hostOf({ api: async (/** @type {string} */ p) => { asked.push(p); return null; }, opening: (/** @type {any} */ c) => opening.has(c) });
    const c = sessionChat("host-opening");
    opening.add(c);
    views.setChat(c);
    views.show("plan");
    assert.deepEqual(asked, [], "its transcript is on its way: nothing asked beside it");
    // The transcript lands: its turns read, and the page draws the views again.
    opening.delete(c);
    c.turns = [{ n: 1, status: "done", past: true, history: true, blocks: [], steers: [], segments: [] }];
    views.draw();
    // The read that shows the Still open list (`open=fresh`: the session waits a moment for its folder's read).
    assert.deepEqual(asked, ["/sessions/chain-host-opening?open=fresh"], "asked once, for the chat as it stands");
  });

  // (fails before: yes — the plan was a side-pane tab: there were no views)
  test("a session brings the tabs; each chat shows its own view; a switch tells the address; the tabs leave with the session", () => {
    const { frame, slot, shown, views, plan, mounts } = hostOf();
    assert.deepEqual([plan.attrs.class, plan.attrs.role, plan.attrs["aria-label"]], ["vw vw-plan", "tabpanel", "Plan"]);
    const draft = { ...sessionChat("draft"), chainId: null };
    views.setChat(draft);
    assert.deepEqual(slot.kids, [], "no session yet: the conversation alone");
    views.show("plan");
    assert.deepEqual([views.view, draft.viewTab, shown], ["chat", undefined, []]);

    const a = sessionChat("host-a");
    views.setChat(a);
    const [tabs] = slot.kids;
    assert.equal(tabs.attrs.class, "view-tabs");
    assert.deepEqual(tabsOn(slot), [["Chat", "true"], ["Overview", "false"], ["Agents", "false"], ["Teams", "false"], ["Plan", "false"]]);
    assert.equal(tabOf(slot, "team").classList.contains("hidden"), true, "the Teams tab is the Agents tab's (U13-D5): its address alone stays");
    assert.deepEqual([frame.classList.contains("view-plan"), plan.kids], [false, []]);
    views.show("plan");
    assert.deepEqual(shown, [["host-a", "plan"]], "the address follows the switch");
    assert.deepEqual(tabsOn(slot), [["Chat", "false"], ["Overview", "false"], ["Agents", "false"], ["Teams", "false"], ["Plan", "true"]]);
    assert.equal(frame.classList.contains("view-plan"), true, "the conversation's parts make way (views.css)");
    assert.equal(plan.kids[0].attrs.class, "plan-view");
    views.show("plan");
    views.show("graph");
    assert.equal(shown.length, 1, "the view on screen, or one the page does not know, is no switch");

    const b = sessionChat("host-b");
    views.setChat(b);
    assert.deepEqual([mounts(), slot.kids[0]], [1, tabs], "put in the page once: another chat never takes the focused tab out of it");
    assert.deepEqual([views.view, frame.classList.contains("view-plan"), plan.kids], ["chat", false, []], "each chat its own view");
    views.setChat(a);
    assert.equal(views.view, "plan");
    tabOf(slot, "chat").dispatch("click");
    assert.deepEqual([views.view, shown.at(-1)], ["chat", ["host-a", "chat"]]);
    assert.deepEqual(plan.kids, [], "the Plan view is drawn only while it shows");
    views.setChat(draft);
    assert.deepEqual([mounts(), slot.kids], [2, []]);
    assert.deepEqual([viewOf({ chainId: "c", viewTab: "plan" }), viewOf({ chainId: "c", viewTab: "graph" }), viewOf({ chainId: null, viewTab: "plan" })], ["plan", "chat", "chat"]);
  });

  // (fails before: yes — the plan was a side-pane tab with no badge, and nothing said what the conversation did unseen)
  test("the badges: the Plan tab counts what is open; the Chat tab, while the plan shows, says the agent waits or works", () => {
    const { slot, views } = hostOf();
    const c = sessionChat("badges", { turns: [checklist(["done", "doing", "todo"])] });
    views.setChat(c);
    assert.deepEqual([textOf(badgeOf(slot, "plan")), tabOf(slot, "plan").attrs["aria-label"]], ["1/3", "Plan, 1 of 3 done"]);
    c.live = { turn: { n: 2, status: "running" } };
    views.draw();
    assert.equal(badgeOf(slot, "chat").kids.length, 0, "on Chat, the Chat tab says nothing: the conversation is on screen");
    views.show("plan");
    assert.deepEqual([byClass(badgeOf(slot, "chat"), "view-dot").length, badgeOf(slot, "chat").classList.contains("is-asks"), tabOf(slot, "chat").attrs["aria-label"]],
      [1, false, "Chat, working"]);
    // (fails before: no — a guard the mutation pass asked for: a permission question comes while the turn is live, and
    // the tab says the question, not the work)
    const asking = { n: 2, status: "streaming", paused: { kind: "permission" } };
    c.turns.push(asking);
    c.live = { turn: asking };
    views.draw();
    assert.deepEqual([badgeOf(slot, "chat").classList.contains("is-asks"), tabOf(slot, "chat").attrs["aria-label"]], [true, "Chat, waiting for your answer"]);
    c.turns.pop();
    c.live = null;
    c.turns.push({ n: 2, status: "done", paused: { question: "Which grammar?" } });
    views.draw();
    assert.deepEqual([badgeOf(slot, "chat").classList.contains("is-asks"), tabOf(slot, "chat").attrs["aria-label"]],
      [true, "Chat, waiting for your answer"], "the newest turn asks");
    assert.deepEqual(chatBadge({ turns: [{ paused: {} }, { n: 2, status: "done" }], live: null }), null, "an answered question asks no more");
    // (fails before: yes — the drive of a3a89f309: a message withdrawn while it waited, after the question, hid it)
    assert.deepEqual(chatBadge({ turns: [{ paused: {} }, { n: 2, status: "stopped", withdrawn: true }], live: null }), { dot: "asks", words: "waiting for your answer" }, "a row on no record after it asks nothing");
    c.turns.splice(0, 2, checklist(["done", "done", "done"]));
    views.draw();
    assert.deepEqual([textOf(badgeOf(slot, "plan")), tabOf(slot, "plan").attrs["aria-label"]], ["", "Plan"], "nothing open: no count");
  });

  // (fails before: yes — the plan was a side-pane tab: there were no views to repaint)
  test("a pulse: the run's events within 1.2 s are one repaint of the tabs and the plan on screen", () => {
    const { slot, due, views, plan } = hostOf();
    const c = sessionChat("pulse", { turns: [checklist(["done", "doing"])] });
    c.viewTab = "plan";
    views.setChat(c);
    assert.match(textOf(plan), /^Checklist\|1 of 2 done\|Run log\|Step 1\|Step 2\|between turns\|/);
    c.turns[0] = checklist(["done", "done", "doing"]);
    views.pulse();
    views.pulse();
    views.pulse();
    assert.equal(due.length, 1, "one repaint for a burst");
    assert.equal(textOf(badgeOf(slot, "plan")), "1/2", "nothing repainted before it is due");
    /** @type {() => void} */ (due.shift())();
    assert.equal(textOf(badgeOf(slot, "plan")), "2/3");
    assert.match(textOf(plan), /^Checklist\|2 of 3 done\|Run log\|Step 1\|Step 2\|Step 3\|between turns\|/);
    views.pulse();
    assert.equal(due.length, 1, "the next burst gets its own");
  });

  // (fails before: yes — the owner's words of 10-18: "The Task Tab looks weird, it should not be visible unless there
  // is a task with task graph running. maybe move that task switch under composer somwehere?")
  test("the Plan tab shows while the session has a task graph, and while its view is on screen; the view holds no switch", async () => {
    const { slot, views, plan } = hostOf();
    const c = sessionChat("graphless", { turns: [checklist(["done", "doing"])] });
    views.setChat(c);
    const hidden = () => tabOf(slot, "plan").classList.contains("hidden");
    assert.equal(hidden(), true, "a checklist alone: no graph, no tab");
    // Brought by its shortcut or the status capsule, the view shows, and its tab with it while it is on screen.
    views.show("plan");
    await settle();
    assert.deepEqual([views.view, hidden()], ["plan", false]);
    assert.deepEqual(all(plan, (x) => x.tag === "input" && x.attrs.class === "ios-switch"), [], "no switch: the task graph is always on");
    tabOf(slot, "chat").dispatch("click");
    assert.deepEqual([views.view, hidden()], ["chat", true], "left, it goes");
    // The arrow keys skip a hidden tab: Plan is the last, so from Chat leftwards the last shown is Agents — the Teams
    // tab is its (U13-D5).
    const keys = slot.kids[0];
    keys.dispatch("keydown", { key: "ArrowLeft", preventDefault: () => {} });
    assert.equal(views.view, "side", "from Chat back to Agents: neither Plan nor Teams is there to stop at");
    tabOf(slot, "chat").dispatch("click");
    // A graph — the agent's, or the one the page's feed brought — brings the tab.
    c.graphLive = graphAfter([ADD]);
    views.draw();
    assert.equal(hidden(), false);
    assert.equal(planShown({ chainId: "c" }, { tasks: [] }), false, "a graph with no task is none");
  });

  // (fails before: yes — the Hunter of p4d: the Plan showed on its tab and beside the chat at once — a chat kept on
  // Plan, the pane opened from the ⋯ menu or the command center, or the panes hidden; Back to its tab did nothing in a
  // chat with no session; the views' repaints never reached the pane; HarnessV4_TaskGraphPlus_Design D12)
  test("the Plan in one place at a time: held beside the chat, a chat kept on Plan shows Chat; the Plan tab takes it back; Back closes it in a draft chat; the repaints reach it", async () => {
    let held = false;
    /** @type {string[]} */
    const calls = [];
    const besidePlan = { open: () => { held = true; calls.push("open"); }, close: () => { held = false; calls.push("close"); }, shown: () => held, refresh: () => void calls.push("refresh") };
    const { due, views, shown } = hostOf({ besidePlan });
    const a = sessionChat("one-a", { turns: [checklist(["done", "doing"])] });
    const b = sessionChat("one-b", { turns: [checklist(["done", "doing"])] });
    b.viewTab = "plan";
    views.setChat(a);
    // Put beside chat a's conversation — the right bar holds it, shown or hidden — then chat b, kept on its Plan tab.
    held = true;
    views.setChat(b);
    assert.deepEqual([views.view, b.viewTab, shown.at(-1)], ["chat", "chat", ["one-b", "chat"]], "the pane holds it: Chat, the address told");
    views.show("plan");
    assert.deepEqual([views.view, held, calls.at(-1)], ["plan", false, "close"], "its tab takes it back");
    // Opened beside the chat from the ⋯ menu while its tab shows: the tab gives way once the bar has drawn.
    held = true;
    views.planPane(fakeH("div"), b);
    assert.equal(views.view, "plan", "not while the bar draws");
    await settle();
    assert.equal(views.view, "chat");
    // The views' pulse refreshes it as it repaints the tab.
    calls.length = 0;
    views.pulse();
    /** @type {() => void} */ (due.shift())();
    assert.deepEqual(calls, ["refresh"]);
    // Back to its tab: the tab, the pane closed; in a chat with no session yet, where there is no tab, it closes.
    views.planBack();
    assert.deepEqual([views.view, held], ["plan", false]);
    views.setChat({ ...sessionChat("one-draft"), chainId: null });
    held = true;
    views.planBack();
    assert.equal(held, false);
  });

  // (fails before: yes — after a reload the Plan view said "No plan yet" for a session that planned on its checklist:
  // an earlier turn's run was read only as the transcript drew its row near the screen, and under the Plan view the
  // transcript is hidden)
  test("after a reload: the views read the newest turn's run, once; the view is blank until it lands, then draws the plan", async () => {
    const { slot, reads, views, plan } = hostOf();
    const older = { n: 1, history: true, status: "done", runId: "run-1" };
    const newest = { n: 2, history: true, status: "done", runId: "run-2" };
    const rewound = { n: 4, history: true, status: "done", runId: "run-4", rewound: { from: 4 } };
    const c = sessionChat("reload", { turns: [older, newest, { n: 3, history: true, status: "done", runId: null }, rewound] });
    c.viewTab = "plan";
    views.setChat(c);
    await settle();
    views.draw();
    assert.deepEqual(reads.map((r) => r.turn), [newest], "the newest turn that ran, asked once: an outside client's turn has no run, a rewound one is undone");
    assert.deepEqual([plan.kids, textOf(badgeOf(slot, "plan"))], [[], ""], "on its way: no \"No plan yet\" the landing takes back");
    newest.aligned = checklist(["done", "doing", "todo"]).aligned;
    reads[0].land();
    await settle();
    assert.equal(textOf(badgeOf(slot, "plan")), "1/3");
    assert.match(textOf(plan), /^Checklist\|1 of 3 done\|Run log\|Step 1\|Step 2\|between turns\|Step 3\|/);

    // A run gone from the log lands with nothing: asked once, and the view draws what the turns hold.
    // (fails before: yes — HarnessV4_Tasks U4: a turn that ended is read like this one, and the view emptied itself
    // until the read landed — each turn the whole view, its goal with it, went and came back, and the control that
    // had the keyboard's place was gone. A view drawn for this chat stands as it is until the read lands)
    const swept = { n: 5, history: true, status: "done", runId: "run-5" };
    c.turns.push(swept);
    const standing = plan.kids[0];
    views.draw();
    assert.equal(reads.length, 2);
    assert.equal(plan.kids[0], standing, "the view as drawn stands while the run is read: the same nodes, nothing emptied");
    views.draw();
    assert.equal(plan.kids[0], standing, "through every pulse until it lands");
    reads[1].land();
    await settle();
    assert.equal(plan.kids[0], standing, "landed with nothing new: painted in place, the same nodes (plan.js)");
    views.draw();
    assert.equal(reads.length, 2, "asked once, whatever it answered");
    assert.match(textOf(plan), /^Checklist\|1 of 3 done\|Run log\|Step 1\|Step 2\|between turns\|Step 3\|/);
    // Another view shown meanwhile, the Plan view is emptied as ever; shown again mid-read, it is blank, as a first draw is.
    const late = { n: 5.5, history: true, status: "done", runId: "run-5b" };
    c.turns.push(late);
    views.show("chat");
    assert.deepEqual(plan.kids, [], "out of sight: nothing drawn");
    views.show("plan");
    assert.deepEqual([reads.length, plan.kids], [3, []], "nothing of this chat's stands: blank until the read lands");
    reads[2].land();
    await settle();
    assert.match(textOf(plan), /^Checklist\|1 of 3 done\|Run log\|Step 1\|Step 2\|between turns\|Step 3\|/);

    // A run followed live after the reload comes with its stream; a turn of this page with no run is passed over; a
    // read turn is not read again.
    const live = { n: 6, history: true, status: "streaming", runId: "run-6" };
    c.turns.push(live);
    c.live = { turn: live };
    views.draw();
    assert.equal(reads.length, 3);
    const d = sessionChat("reload-d", { turns: [{ n: 1, history: true, status: "done", runId: "run-d1" }, { n: 2, status: "done" }] });
    views.setChat(d);
    assert.deepEqual(reads.map((r) => r.turn.runId), ["run-2", "run-5", "run-5b", "run-d1"]);
    views.setChat(sessionChat("reload-e", { turns: [{ n: 1, history: true, status: "done", runId: "run-e1" }, { ...checklist(["doing"]), n: 2, history: true, runId: "run-e2" }] }));
    assert.equal(reads.length, 4, "the newest turn's run is read: nothing to ask");

    // Another chat's landing paints nothing here.
    const e = sessionChat("reload-f", { turns: [checklist(["doing", "todo"])] });
    e.viewTab = "plan";
    views.setChat(e);
    await settle();
    const drawn = plan.kids[0];
    reads[3].land();
    await settle();
    assert.equal(plan.kids[0], drawn);
    // Another chat's view never stands in for this one's: a chat whose run is on its way is blank, whatever showed before.
    const f = sessionChat("reload-g", { turns: [{ n: 1, history: true, status: "done", runId: "run-g1" }] });
    f.viewTab = "plan";
    views.setChat(f);
    assert.deepEqual(plan.kids, [], "the chat shown before leaves nothing standing here");
  });

  // (fails before: yes — the status capsule read the plan its own way and only the page's own turn painted it: a turn
  // the page followed after a reload, or one that had ended, left it on an early plan while the Plan tab had the
  // newest)
  test("each paint of the badges is told, with its chat: what shows the Plan tab's plan paints with it", async () => {
    /** @type {string[]} */
    const painted = [];
    const { slot, due, reads, views } = hostOf({ onPainted: (/** @type {any} */ chat) => painted.push(`${chat.id} ${textOf(badgeOf(slot, "plan"))}`) });
    const c = sessionChat("painted", { turns: [checklist(["done", "todo"])] });
    views.setChat(c);
    assert.deepEqual(painted, ["painted 1/2"], "a chat drawn: its plan, as the tab counts it");
    c.turns[0].aligned = checklist(["done", "done", "todo"]).aligned;
    views.pulse();
    due.shift()?.();
    assert.equal(painted.at(-1), "painted 2/3", "the run moved: the pulse paints both");
    const newest = { n: 1, history: true, status: "done", runId: "run-p" };
    views.setChat(sessionChat("landed", { turns: [newest] }));
    newest.aligned = checklist(["done", "doing"]).aligned;
    reads.at(-1)?.land();
    await settle();
    assert.equal(painted.at(-1), "landed 1/2", "after a reload, the newest turn's run landed: both paint");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /const plan = chat \? planOf\(chat, null\)\.plan : \[\];/, "the capsule's plan is the Plan tab's");
    assert.match(app, /onPainted: \(c\) => \{ if \(c === chatOf\(state\.currentId\)\) paintStatus\(c\); \},/);
  });

  // (fails before: yes — the transcript read an earlier turn's run only for a row it drew near the screen, and dropped
  // what it said for a turn it had not drawn: the views had nothing to ask, and nothing landed on the turn)
  test("the transcript's reader: the read kept on the turn, what it says lands whether or not it is drawn, through the queue", () => {
    const src = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    // Read once; a log aligned whole, whose alignment came with the turn from the reading before, is not read again
    // (history-cards-carried); an ended turn's log is let go of once aligned (the owner's of 11-15), unless a page said a
    // gap in it (the review of 11-16).
    assert.match(src, /turn\.runRead \|\|= \(turn\.alignCache\?\.whole \? Promise\.resolve\(null\) : runEventsOf\(turn\.runId\)\)/);
    assert.match(src, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/events\?since=\$\{since\}&limit=\$\{RUN_PAGE\}/, "read a page at a time, to its end");
    assert.match(src, /\.then\(\(read\) => \{\n\s+api_\.applyEvents\(turn, read\?\.events \?\? null, view\.has\(turn\)\);\n\s+if \(ended && read && !read\.holed\) letGoOfLog\(turn\.alignCache, read\.events\);\n\s+\}\)/, "drawn only onto a drawn turn");
    assert.match(src, /applyEvents\(turn, events, mine = owned\(turn\)\) \{/);
    assert.match(src, /loadRun\(turn\) \{\n\s*return turn\.runRead \|\| cardQueue\.run\(\(\) => historyCards\(turn\)\);/);
    assert.match(readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8"), /loadRun: \(turn\) => transcript\.loadRun\(turn\),/);
  });
});

// U13-D5 (10-20): the Team tab is the Agents tab's — a team a row there, its pane the Team view, the badge one.
describe("Views V3: the teams, on the Agents tab", () => {
  /** A sub-agent at work, or asking when `asking` names its call. @param {string} id @param {any} [asking] */
  const working = (id, asking = null) => ({ id, card: { tag: "builder", name: "Builder", kind: "worker" }, asked: false, may: "edit", status: "running", startedAt: 1, team: { team: "architect", role: "builder" }, description: `Task ${id}`,
    progress: asking ? { asking } : null, exchanges: [{ description: `Task ${id}`, startedAt: 1, endedAt: null }] });
  /** A host on the fake DOM whose session's sub-agents are `rows()`, its repaints held until a test lets them go. @param {() => any[]} rows */
  function hostOf(rows) {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    /** @type {(() => void)[]} */
    const due = [];
    /** @type {any[]} */
    const shown = [];
    const views = createViews({
      frame,
      slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH,
      api: async () => null,
      openAgent: () => {},
      openRunLog: () => {},
      onShow: (chat) => { shown.push([chat.id, chat.viewTab]); },
      loadRun: () => Promise.resolve(),
      later: (fn, ms) => { assert.equal(ms, 1200); due.push(fn); },
      team: teamIO({ rows }),
      side: /** @type {any} */ (sideIO({ rows })),
      sideSeams: sideSeams().seams,
      place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
      modelSelect: modelSelects().make,
    });
    /** The team's pane in the Agents tab, once the tab has shown. */
    const team = () => one(frame, "sd-team");
    return { frame, slot, due, shown, views, team };
  }

  // (fails before: yes — there was no Team tab: who was at work showed in the status capsule's count alone; U13-D5: the
  // count is the Agents tab's, and the team's pane is drawn once its row opens)
  test("the Agents tab counts a team's crew at work, its dot orange while one asks you; the team's pane is drawn once the teams are asked for", () => {
    /** @type {any[]} */
    let rows = [];
    const { frame, slot, views, team } = hostOf(() => rows);
    assert.deepEqual([frame.kids[1].attrs.class, frame.kids[1].attrs.role, frame.kids[1].attrs["aria-label"]], ["vw vw-side", "tabpanel", "Agents"]);
    const c = sessionChat("team-a");
    views.setChat(c);
    assert.deepEqual([badgeOf(slot, "side").kids, tabOf(slot, "side").attrs["aria-label"], team()], [[], "Agents", undefined], "nobody at work: no badge; the tab not drawn");
    rows = [working("w1"), working("w2", { tool: "bash", args: "npm test" })];
    c.live = { turn: { n: 1, status: "running" } };
    views.draw();
    assert.deepEqual([textOf(badgeOf(slot, "side")), badgeOf(slot, "side").classList.contains("is-asks"), tabOf(slot, "side").attrs["aria-label"]],
      ["2", true, "Agents, 2 at work · 1 asks you"], "your agent at work and two workers, one asking: the number is the workers', as the Workers row's is (V6-13)");
    views.show("team");
    assert.deepEqual([views.view, frame.classList.contains("view-side"), frame.classList.contains("view-plan"), one(team(), "tv-head") !== undefined], ["side", true, false, true]);
    assert.deepEqual(all(team(), (x) => !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"]), ["w2", "w1"], "the one asking first");
    // (fails before: no — a guard the mutation pass asked for: a question waiting on the turn's run, with no pause,
    // left the dot saying work, and passed every test)
    rows = [];
    c.turns = [{ n: 1, status: "streaming", waiting: [{ type: "ask", kind: "proposal", id: "proposal:run_1:1" }] }];
    c.view.settings.engine = { mode: "team", team: "architect" };
    views.draw();
    assert.deepEqual([badgeOf(slot, "side").classList.contains("is-asks"), tabOf(slot, "side").attrs["aria-label"]], [true, "Agents, the lead works · 1 asks you"]);
    assert.deepEqual([views.view, frame.classList.contains("side-team")], ["team", true], "a team in charge: the dock stands under it, and a worker's card asks there");
    // (fails before: yes — the owner's words of 10-18: the dot blinked while the chat's turn ran with no team, and an
    // agent asked on the side said "Team 1")
    c.view.settings.engine = { mode: "model" };
    c.turns = [{ n: 1, status: "streaming" }];
    rows = [{ ...working("s1"), team: null, origin: "owner" }];
    views.draw();
    assert.deepEqual([textOf(badgeOf(slot, "side")), tabOf(slot, "side").attrs["aria-label"]], ["1", "Agents, 1 working"], "your agent at work, an agent of yours on the side: that one counts, your agent's own turn does not");
  });

  // (fails before: yes — the pulses stopped with the run's events, so a worker's clock stood still on the Team view)
  test("while the Team view shows work running the pulses go on, so its clocks move; they rest with the work, or out of sight", () => {
    /** @type {any[]} */
    let rows = [working("w1")];
    const { due, views } = hostOf(() => rows);
    const c = sessionChat("tick");
    c.viewTab = "team";
    views.setChat(c);
    views.pulse();
    /** @type {() => void} */ (due.shift())();
    assert.equal(due.length, 1, "work runs: the next pulse is due");
    rows = [];
    /** @type {() => void} */ (due.shift())();
    assert.equal(due.length, 0, "nothing runs: the pulses rest");
    rows = [working("w1")];
    views.show("chat");
    views.pulse();
    /** @type {() => void} */ (due.shift())();
    assert.equal(due.length, 0, "the Team view out of sight: no clock to move");
  });

  // (fails before: yes — nothing brought a worker's card: the dock's "who asks" and a turn's order rows led nowhere)
  test("reveal: the Agents tab shows the team's pane, and the card is brought into sight and marked a moment", () => {
    const { frame, shown, views, team } = hostOf(() => [working("w1")]);
    views.setChat(sessionChat("rev"));
    views.reveal("w1");
    assert.deepEqual([views.view, shown.at(-1), frame.classList.contains("view-side")], ["side", ["rev", "side"], true]);
    assert.equal(all(team(), (x) => x.attrs?.["data-id"] === "w1")[0].classList.contains("is-flash"), true);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-7: the Team view held no task still to come, nor a way to the graph)
  test("a task still to come in the Team view opens on the Plan view's graph, chosen", () => {
    const { frame, shown, views, team } = hostOf(() => []);
    const graph = graphAfter([{ action: "add", goal: "Ship the parser", tasks: [
      { id: "t1", name: "Map the callers", by: "explorer", goal: "Every caller is known", steps: ["Search"], acceptance: "each listed" },
      { id: "t2", name: "Fix the parser", needs: ["t1"], by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes a comma", steps: ["Fix"], acceptance: "npm test passes" },
    ] }]);
    const c = sessionChat("tasks", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph }])] });
    c.viewTab = "team";
    views.setChat(c);
    assert.equal(c.viewTab, "side", "a chat kept on the Teams tab opens the Agents tab, on the teams");
    const cards = all(team(), (x) => !!x.attrs?.["data-task"]);
    assert.deepEqual(cards.map((x) => textOf(x)), ["Explorer|t1|Map the callers|ready|Filament starts it", "Agent|t2|Fix the parser|waiting|needs t1"]);
    cards[1].dispatch("click");
    assert.deepEqual([views.view, shown.at(-1), frame.classList.contains("view-plan")], ["plan", ["tasks", "plan"], true]);
    assert.match(textOf(one(frame.kids[0], "tg-card")), /^t2\|Fix the parser\|waiting\|/, "the task chosen, not the ready one the view would choose");
  });
});

describe("Views V2: the side pane", () => {
  const panes = [{ id: "changes" }, { id: "files" }, { id: "terminal" }];

  // (fails before: yes — a pane that opened with nothing saved was the Plan pane, and a closed Session or Plan tab
  // stayed in Recently closed with nothing to open)
  test("a saved tab opens only where the panes can open it; Recently closed keeps only what can open", () => {
    const file = fileTabId("H:/p", "src/a.js");
    const saved = ["session", "plan", "files", file, "garbage", "file:not json", "review", 5];
    assert.deepEqual(saved.filter((id) => tabCanOpen(id, panes)), ["files", file], "a browser that remembered Review opens no Review (GWC-40)");
    const closed = closedTabsOf([{ id: "plan", label: "Plan" }, { id: "files", label: "Files", icon: "folder", at: 5 }, { id: "changes" }], panes, 1);
    assert.deepEqual([...closed], [["files", { label: "Files", icon: "folder", at: 5 }]], "up to the most kept, a gone pane not counted");
    assert.deepEqual([...closedTabsOf([{ id: "session" }, null, { id: "review" }, { id: "changes" }], panes, 5)], [["changes", { label: "changes", icon: "x", at: 0 }]]);
    assert.deepEqual([...closedTabsOf({}, panes, 5)], []);
  });

  // (fails before: yes — the side pane opened on Review, which went (HarnessV4_Git_Plan GW-D5); proposal_ux D2: the
  // header offers Changes and Terminal until the person picks other panes)
  test("a fresh page: no pane open until asked, then Changes; the header's buttons are Changes and Terminal", () => {
    const fresh = readLayout(null, () => true, {});
    assert.deepEqual([fresh.cols, fresh.shown], [[], false]);
    const host = readFileSync(new URL("../src/ui/harness/panes/pane-host.js", import.meta.url), "utf8");
    assert.match(host, /const first = cb\.panes\.find\(\(p\) => !T\.onTop\(L, p\.id\)\);\s*if \(!T\.shownOf\(L, key, room\)\.length\) return first \? openTab\(first\.id, o\) : undefined;/, "shown with none open: the first pane not on top");
    const known = ["changes", "outputs", "files", "terminal", "run"];
    assert.deepEqual(paneButtonsOf(null, known), ["changes", "terminal"]);
    assert.deepEqual(paneButtonsOf('["run","gone","changes","run"]', known), ["changes", "run"], "the person's picks: known ones, once each, in the panes' order");
    assert.deepEqual(paneButtonsOf("{junk", known), ["changes", "terminal"]);
  });

  // (fails before: yes — the floating pane covered the header's view tabs and half the Plan view: only the dock, the
  // transcript and the empty chat made room for it; proposal_ux §3.1: the header runs over the chat and the panes alike,
  // the panes under it)
  test("the floating pane: the chat's parts make room for it — the dock, the conversation, the Plan, Team and Side views; the header is above it", () => {
    const sheets = ["harness.css", "harness/aqua.css", "harness/views/views.css", "harness/views/side.css"].map((p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), "utf8")).join("\n");
    const yielding = [...sheets.matchAll(/([^{}]+)\{[^{}]*padding-right: calc\(var\(--pane-w, 0px\) \+ 16px\)[^{}]*\}/g)].map((m) => m[1]).join(",");
    for (const part of ["dock", "transcript", "empty-chat", "vw-plan", "vw-team", "vw-side", "vw-pane"]) assert.match(yielding, new RegExp(`\\.app-shell\\.pane-float-open \\.${part}\\b`), part);
    const shell = readFileSync(new URL("../src/ui/harness/shell.js", import.meta.url), "utf8");
    assert.match(shell, /const splitRow = h\("div", \{ class: "split-row" \}, convFrame, paneHost\);/);
    // In a browser the header tops the frame; in the desktop app (its own title bar) it stands over the frame: either way
    // the panes float in the row under it.
    assert.match(shell, /const mainFrame = h\("section", \{ class: "main-frame" \}, titleBar \? null : header\.el, splitRow\);/, "the panes float in the row under the header");
    assert.match(shell, /const contentCol = h\("div", \{ class: "content-col" \}, titleBar \? header\.el : dragStrip, mainFrame\);/, "the title bar above the frame");
  });

  // (fails before: yes — seen on the stage, 11-11: a team's result opened beside its card in the Agents tab, and the
  // card stood about 30 px wide, a word a line, its buttons outside it: the tab had made room for the pane and the Team
  // view inside it made the same room again)
  test("the floating pane: a view drawn inside the Agents tab makes no room of its own, the tab having made it", () => {
    const side = readFileSync(new URL("../src/ui/harness/views/side.css", import.meta.url), "utf8");
    assert.match(side, /\.app-shell\.pane-float-open \.vw-side :is\(\.vw-plan, \.vw-team, \.vw-pane\) \{ padding-right: 0; \}/);
    const views = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    assert.ok(side.length && views.includes(".app-shell.pane-float-open .vw-team"), "the Team view alone still makes the room");
  });

  // (fails before: yes — the G3f drive: the Plan view's links — Open a worker, a reviewer, the Run log — wore the
  // browser's own button, boxed and grey, in both themes: the kit's link has its style inside a widget's .inst alone)
  test("the Plan view's links are the kit's text links, in the view's blue", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const rule = css.match(/\n\.tg-view \.inst-link \{([^}]*)\}/)?.[1] || "";
    assert.deepEqual(["border: 0;", "background: none;", "padding: 2px 0;", "color: var(--accent-text);"].filter((d) => !rule.includes(d)), []);
  });

  // (fails before: yes — in a narrow conversation, as beside the floating side pane at 960, the Plan view's bar and the
  // task's detail ran wider than their room, the header's right end ran under the pane, its More button was squeezed
  // under the tabs, and its title showed a letter or two; proposal_ux §3.3: the header sheds in its order)
  test("narrow: the Plan page's head keeps its tools whole, the task's card takes the width there is, the header sheds least needed first", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    /** The declarations of a top-level rule. @param {string} sel */
    const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] || "";
    // (E41 P4: one page, no bar of tabs to wrap) The head's words take the room its tools leave, wrapping; the card's
    // rows wrap their values in the width there is. (fails before: yes — the Website chat's letter of 11-10: at a phone's
    // width the tools took the whole row and the goal ran down the tab a letter a line) Where the words would have less
    // than 200 px, the tools go under them, wrapping too, never past the edge.
    assert.match(rule(".tg-head"), /flex-wrap: wrap;/);
    assert.match(rule(".tg-ht"), /flex: 1 1 200px; min-width: 0;/);
    assert.match(rule(".tg-title"), /flex-wrap: wrap;/);
    assert.match(rule(".tg-head-acts"), /flex: 0 1 auto; flex-wrap: wrap;/);
    assert.match(rule(".tg-card"), /min-width: 0;/);
    assert.match(rule(".tg-kv"), /grid-template-columns: 88px minmax\(0, 1fr\);/);
    assert.match(rule(".tg-kv dd"), /overflow-wrap: anywhere;/);
    const hc = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    // (fails before: yes — the header's Agents pill shed its word at 560px; HarnessV4_Tasks E15 step 5 took the pill)
    assert.doesNotMatch(css + hc, /\.spw\b|\.spw-|widget-subagents/, "nothing of the Agents pill or its panel is styled any more");
    assert.match(hc, /\n\.hdr-editor, \.hdr-help, \.pbtn-more \{ flex: none;/, "the header's own buttons never shrink");
    // (fails before: yes — the design pass's title row, which the owner's look of 10-24 took back: it left empty room
    // over the tabs) One row, the sidebar's height: the crumb and the tabs over the chat — the place and the count stand
    // under the box since the owner's of 10-30 (place-under-box.test.js); the buttons over the panes. Narrow, it sheds
    // least needed first — the names of the tabs not shown, room for the title, then every tab's name — each word left
    // a tooltip.
    // A chat's linked chats' pill after the tabs (thread-ui.test.js), the first to give up its room.
    assert.match(readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8"), /h\("div", \{ class: "c-left" \}, crumb, h\("div", \{ class: "c-mid" \}, viewsSlot\), threadEl\)/);
    assert.match(hc, /\n\.c-thread \{ flex: 0 1000 auto;[^}]*min-width: 0;/);
    assert.match(hc, /\n@container hdr-left \(max-width: 600px\) \{ \.c-thread-words \{ display: none; \}/);
    assert.doesNotMatch(readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8"), /c-top/, "no row of the title's own");
    assert.match(hc, /\n\.c-bar \{[^}]*height: var\(--bar-h\);/);
    assert.doesNotMatch(hc, /grid-template-rows: var\(--bar-h\) 40px|\.c-top\b|hdr-top/, "nothing of the second row is left");
    assert.match(hc, /\n\.c-left \{[^}]*min-width: 0;[^}]*overflow: hidden; container: hdr-left \/ inline-size; \}/);
    assert.match(hc, /\n\.c-title \{[^}]*max-width: 720px;/);
    assert.doesNotMatch(hc, /@container hdr-left [^{]*\{[^}]*\.(c-diff|place-name|place-ahead)/, "the header sheds nothing of the place: it is not there");
    // Beside the crumb; alone at the header's left, the crumb in the sidebar, at widths of their own (crumb-beside-sidebar).
    assert.match(css, /\n@container hdr-left \(max-width: 600px\) \{\n {2}:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab:not\(\.is-on\) \.view-tab-label \{ display: none; \}/);
    assert.match(hc, /\n@container hdr-left \(max-width: 520px\) \{ \.c-title \{ max-width: 140px; \} \}/);
    assert.match(css, /\n@container hdr-left \(max-width: 440px\) \{\n {2}:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab-label \{ display: none; \}/);
    assert.match(hc, /\n\.c-title \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/, "a long name ellipsizes");
    assert.match(hc, /\n\.c-title-edit \{ min-width: 0;/);
    assert.match(hc, /\n\.place-chip \{[^}]*max-width: 220px;/);
    assert.match(hc, /\n\.place-name \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/, "a long branch is cut short");
    // The pane buttons give their names up where their part is narrow: docked, by its own width; floating, the header's.
    assert.match(hc, /\n@container hdr-right \(max-width: 380px\) \{ \.pbtn-label \{ display: none; \}/);
    assert.match(hc, /\n@container conv-bar \(max-width: 860px\) \{ \.app-shell:not\(\.panes-docked\) \.pbtn-label \{ display: none; \}/);
  });

  // (fails before: yes — the pane held Plan and Session, opened on Plan, and Run wore Prompt's glyph; HarnessV4_Tasks
  // E15 step 2: the agents you asked had no tab; HarnessV4_Four_Plan E20: what git does not show had none)
  // proposal_ux M1, R2, M5: Run holds Prompt's calls, the Context pane's record and Devtools; Next request is the
  // inspector's map.
  test("the side pane's tabs: the work's changes, outputs, files and runs first, then the next request; a glyph each — an agent's thread is a tab of its own (panes/thread.js)", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    const list = app.match(/const rail = createPaneHost\(shell\.paneHost, \{\n {2}panes: \[\n([\s\S]*?)\n {2}\],/);
    assert.ok(list, "the pane list");
    const rows = [...list[1].matchAll(/\{ id: "([^"]+)", label: "[^"]+", icon: "([^"]+)"/g)];
    assert.deepEqual(rows.map((r) => r[1]), ["changes", "outputs", "files", "terminal", "browser", "run", "next-request"]);
    assert.equal(new Set(rows.map((r) => r[2])).size, rows.length, "no two tabs wear the same glyph");
  });
});

describe("Views V2: the shortcuts and Command Center", () => {
  /** @param {Partial<KeyboardEvent>} o */
  const key = (o) => /** @type {KeyboardEvent} */ ({ repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "", code: "", ...o });

  // (fails before: yes — no shortcut brought a view, and a Mac's Option+2 arrives as "™"; V3: Alt+3 brought nothing;
  // proposal_ux D4: the keys follow the tabs' order, Overview second)
  test("Alt+1 to Alt+5 bring Chat, Overview, Sub Agents, Team and Plan, by the key pressed whatever character it makes", () => {
    assert.deepEqual(["view-chat", "view-overview", "view-side", "view-team", "view-plan"].map(comboOf), ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5"]);
    assert.equal(matchShortcut(key({ altKey: true, key: "1", code: "Digit1" })), "view-chat");
    assert.equal(matchShortcut(key({ altKey: true, key: "™", code: "Digit2" })), "view-overview", "a Mac's Option+2");
    assert.equal(matchShortcut(key({ altKey: true, key: "£", code: "Digit3" })), "view-side", "a Mac's Option+3");
    assert.equal(matchShortcut(key({ altKey: true, key: "5", code: "Digit5" })), "view-plan");
    assert.equal(comboFromEvent(key({ ctrlKey: true, shiftKey: true, key: "@", code: "Digit2" })), "Ctrl+Shift+2");
    assert.equal(matchShortcut(key({ key: "2", code: "Digit2" })), "", "a bare digit is typing");
  });

  // (fails before: yes — every action was offered always)
  test("an action with `when` is offered only while it says so; the typed text narrows by label", () => {
    let session = false;
    const acts = [
      { id: "find", label: "Find in task", run: () => {} },
      { id: "view-plan", label: "Show Plan", run: () => {}, when: () => session },
    ];
    assert.deepEqual(actionsFor(acts, "").map((a) => a.id), ["find"]);
    session = true;
    assert.deepEqual(actionsFor(acts, "").map((a) => a.id), ["find", "view-plan"]);
    assert.deepEqual(actionsFor(acts, "plan").map((a) => a.id), ["view-plan"]);
    assert.deepEqual(actionsFor(acts, "zzz"), []);
  });

  // (fails before: yes — the views were not wired: no tabs, no Plan view, Find stayed on the plan; V3: no Team row, key
  // or sheet)
  test("the app's wiring: the views' rows only with a session, their keys, and Find and a widget's turn come back to Chat", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.equal([...app.matchAll(/id: "view-(chat|overview|plan)", .*when: \(\) => !!chatOf\(state\.currentId\)\?\.chainId, run: \(\) => views\.show\("\1"\)/g)].length, 3);
    // The teams' row and key only while Settings › Experimental's Teams switch is on.
    assert.match(app, /id: "view-team", .*when: \(\) => teamsOn\(state\.config\) && !!chatOf\(state\.currentId\)\?\.chainId, run: \(\) => views\.show\("team"\)/);
    assert.match(app, /"view-chat": \(\) => views\.show\("chat"\),\n\s*"view-overview": \(\) => views\.show\("overview"\),\n\s*"view-plan": \(\) => views\.show\("plan"\),\n\s*"view-team": \(\) => \{ if \(teamsOn\(state\.config\)\) views\.show\("team"\); \},/);
    assert.match(app, /function findInTask\(\) \{\n {2}views\.show\("chat"\);\n {2}find\.open\(\);/);
    assert.match(app, /scrollToTurn: \(n\) => \{\n?\s*views\.show\("chat"\);/);
    const page = readFileSync(new URL("../src/ui/harness.html", import.meta.url), "utf8");
    assert.match(page, /<link rel="stylesheet" href="\/ui\/harness\/views\/views\.css" \/>\n\s*<link rel="stylesheet" href="\/ui\/harness\/views\/team\.css" \/>/);
    // (fails before: no — a guard the mutation pass asked for: the palette offers its actions through `actionsFor`, read
    // as it opens: the pane rows go by what is open then)
    assert.match(readFileSync(new URL("../src/ui/harness/command-center.js", import.meta.url), "utf8"), /\? actionsFor\(cb\.actions\(\), q\)\.map\(/);
  });
});

// (fails before: yes — a session opened by its address kept the header's folder of the chat shown before it, its own
// folder arriving with its transcript; HarnessV3-ACP AC2's drive)
test("a session opened by its address gets its own folder on the header once its transcript says it", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const at = app.search(/async function hydrate\(chat\b/);
  assert.ok(at >= 0, "app.js has hydrate");
  const hydrate = app.slice(at, app.indexOf("\n}\n", at));
  // (A move another page asked for has the chat in the transcript's folder: live-topic-page.test.js drives it.)
  assert.match(hydrate, /chat\.cwd = \(moved && tr\.cwd\) \|\| chat\.cwd \|\| tr\.cwd \|\| "";[\s\S]*\n  if \(chat\.id === state\.currentId\) headerModule\.setChat\(chat\);/, "a source contract: the page boots a DOM at import");
});
