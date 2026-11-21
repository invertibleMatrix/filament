// @ts-check
// A pane at work out of sight has its button out of ⋯ (the owner's of 11-10: "some of these important stuff is hidden
// under three dots. for example if task graph is running or a checklist task is running then Plan should come out of
// this three dot and be placed on top bar if and only if plan view right bar pane is not opened. if that is opened then
// no need to pull that out. if closed and then task or checklist is running then again it should come out. the reason
// being it needs to show that something is active and being worked on. similar goes for browser. if browser is being
// controlled and not opened on the right pane then show a button on top bar otherwise hide."): the header's buttons
// (panes/pane-buttons.js), what counts as the plan's work under way (views/plan.js `planAtWork`, task-graph.js
// `runningNow`), the views' host that tells it (views/host.js) and the page that ties both signals (app.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { createPaneHost } from "../src/ui/harness/panes/pane-host.js";
import { createPaneButtons, pulledOut } from "../src/ui/harness/panes/pane-buttons.js";
import { planAtWork } from "../src/ui/harness/views/plan.js";
import { runningNow } from "../src/ui/harness/views/task-graph.js";
import { createViews } from "../src/ui/harness/views/host.js";
import { usingWords } from "../src/ui/harness/conversation/browser-line.js";
import { fakeH, fakeDrawIn } from "./helpers/fake-dom.js";
import { teamIO, modelSelects } from "./helpers/team-view.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";

const KNOWN = ["changes", "outputs", "files", "terminal", "browser", "run", "next-request", "plan"];

// (fails before: yes — there was no rule: every pane without a button of its own stayed in ⋯ whatever went on in it)
test("which panes come out of ⋯: each at work while its pane is out of sight, with no button of its own, in the panes' order", () => {
  const pinned = ["changes", "terminal"];
  assert.deepEqual(pulledOut(KNOWN, pinned, ["plan", "browser"], []), ["browser", "plan"], "at work, out of sight: out, as the panes are ordered");
  assert.deepEqual(pulledOut(KNOWN, pinned, ["plan"], ["changes", "plan"]), [], "the Plan in front beside the chat: no need");
  assert.deepEqual(pulledOut(KNOWN, pinned, [], []), [], "nothing at work: all in ⋯");
  assert.deepEqual(pulledOut(KNOWN, [...pinned, "plan"], ["plan"], []), [], "pinned already: its own button stands");
  assert.deepEqual(pulledOut(["changes"], pinned, ["plan"], []), [], "a pane the page has not");
});

/** The header's buttons over a real pane host on the stub document, its panes Changes, Terminal, Browser and Plan. @param {string[] | null} [pinned] */
function header(pinned = null) {
  const { document, restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map(pinned ? [["filament.harness.paneButtons", JSON.stringify(pinned)]] : []));
  g.sessionStorage = storage(new Map());
  const frame = document.createElement("aside");
  document.body.append(frame);
  const pane = (/** @type {string} */ id, /** @type {string} */ label) => ({ id, label, icon: "globe", render: (/** @type {any} */ body) => void body.append(document.createElement("div")) });
  /** @type {any} */
  let buttons = null;
  const host = createPaneHost(/** @type {any} */ (frame), {
    panes: [pane("changes", "Changes"), pane("terminal", "Terminal"), pane("browser", "Browser"), pane("plan", "Plan")],
    room: () => ({ row: 1600, win: 1920, height: 900 }),
    paint: () => {},
    // As the page's: the buttons painted again at each move of the panes.
    onChange: () => buttons?.paint(),
  });
  host.setChat({ id: "p1", chainId: "c1" });
  const slot = document.createElement("span");
  document.body.append(slot);
  buttons = createPaneButtons({ host, slot: /** @type {any} */ (slot), layoutSlot: /** @type {any} */ (document.createElement("span")), header: /** @type {any} */ (document.createElement("header")) });
  /** @returns {any[]} */
  const all = () => slot.querySelectorAll(".pbtn");
  return {
    host, buttons, slot, document,
    /** The buttons on the bar, by their panes. */
    shown: () => all().map((b) => b.getAttribute("data-pane")),
    /** @param {string} id @returns {any} */
    button: (id) => all().find((b) => b.getAttribute("data-pane") === id) || null,
    /** ⋯ pressed: the rows of its menu, by their words — and pressed again, which closes it. */
    more: () => {
      const more = slot.querySelector(".pbtn-more");
      more.dispatch("click");
      const menus = document.querySelectorAll(".zc-menu");
      const words = menus[menus.length - 1].querySelectorAll(".zc-menu-text").map((/** @type {any} */ t) => t.textContent);
      more.dispatch("click");
      return words;
    },
    restore: () => {
      g.localStorage = saved.local;
      g.sessionStorage = saved.session;
      restore();
    },
  };
}

// (fails before: yes — the owner's of 11-10: Plan stayed under ⋯ while its tasks ran)
test("the Plan at work out of sight: its button on the bar after the pinned ones, a dot breathing, out of ⋯ — gone while it shows in front, back as it closes, in ⋯ again once the work ends", () => {
  const at = header();
  try {
    assert.deepEqual(at.shown(), ["changes", "terminal"]);
    assert.ok(at.more().includes("Plan"), "at rest: in ⋯");
    at.buttons.works("plan", "work under way: 2 running");
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"], "out, after the pinned ones");
    const plan = at.button("plan");
    assert.ok(plan.classList.contains("is-out"));
    assert.equal(plan.querySelector(".pbtn-works")?.getAttribute("title"), "work under way: 2 running", "its dot says why");
    assert.ok(!at.more().includes("Plan"), "not in ⋯ twice");
    // The same words told at the next pulse move nothing; new words go on the dot in place.
    at.buttons.works("plan", "work under way: 2 running");
    assert.equal(at.button("plan"), plan);
    at.buttons.works("plan", "work under way: 1 running");
    assert.equal(at.button("plan"), plan, "the one element under the pointer");
    assert.equal(plan.querySelector(".pbtn-works")?.getAttribute("title"), "work under way: 1 running");
    // Its press opens the Plan in front, as ⋯'s row does: in sight, no need for it.
    plan.dispatch("click");
    assert.equal(at.host.whereIs("plan"), "front");
    assert.deepEqual(at.shown(), ["changes", "terminal"], "the Plan in sight: no button");
    assert.ok(at.more().includes("Plan"), "in ⋯ again, ticked there as open");
    // Closed while the work goes on: out again.
    at.host.close("plan");
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"]);
    // Open with the panes hidden (Ctrl+Alt+B), it is out of sight too.
    at.host.openTab("plan");
    assert.deepEqual(at.shown(), ["changes", "terminal"]);
    at.host.setOpen(false);
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"], "panes hidden: out");
    // The work ends: back in ⋯.
    at.buttons.works("plan", null);
    assert.deepEqual(at.shown(), ["changes", "terminal"]);
    assert.ok(at.more().includes("Plan"));
  } finally {
    at.restore();
  }
});

// (fails before: yes — the owner's of 11-10: "if browser is being controlled and not opened on the right pane then show a
// button on top bar otherwise hide")
test("the Browser driven out of sight: out of ⋯ too, beside the Plan in the panes' order; the Browser in front, none", () => {
  const at = header();
  try {
    at.buttons.works("plan", "work under way: 1 running");
    at.buttons.works("browser", usingWords({ who: "Your agent", words: "navigate localhost:5173", until: null }));
    assert.deepEqual(at.shown(), ["changes", "terminal", "browser", "plan"]);
    assert.equal(at.button("browser").querySelector(".pbtn-works")?.getAttribute("title"), "Your agent is using it: navigate localhost:5173");
    assert.deepEqual(at.more().filter((w) => w === "Browser" || w === "Plan"), []);
    at.host.openTab("browser");
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"], "the Browser in sight");
    at.host.close("browser");
    at.buttons.works("browser", null);
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"], "the browser at rest");
  } finally {
    at.restore();
  }
});

// (fails before: yes — as above: a pinned Plan said nothing of the work going on)
test("a Plan the person pinned: no second button and none moved — its own carries the dot while the Plan is out of sight", () => {
  const at = header(["changes", "terminal", "plan"]);
  try {
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"]);
    const plan = at.button("plan");
    at.buttons.works("plan", "work under way: 1 running");
    assert.deepEqual(at.shown(), ["changes", "terminal", "plan"]);
    assert.equal(at.button("plan"), plan);
    assert.ok(!plan.classList.contains("is-out"), "its own, not one out of ⋯");
    assert.ok(plan.querySelector(".pbtn-works"), "the dot");
    at.host.openTab("plan");
    assert.equal(plan.querySelector(".pbtn-works"), null, "in sight: lit, no dot");
    assert.ok(plan.classList.contains("on"));
  } finally {
    at.restore();
  }
});

const T0 = 1_000_000;
const ADD = { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer", needs: [] }, { id: "t2", name: "Parser", needs: [] }, { id: "t3", name: "Docs", needs: ["t1", "t2"] }] };
/** The graph after these tasks calls, as the views read it. @param {any[]} calls */
const graphAfter = (calls) => {
  /** @type {any} */
  let g = null;
  calls.forEach((input, i) => {
    const r = /** @type {any} */ (applyTasks(g, input, { at: T0 + i * 60_000, crew: "agent" }));
    assert.ok(r.ok, r.error);
    g = r.graph;
  });
  return graphView(g);
};
/** The agent's own t1 running; and t2 a sub-agent's, running too, where `sub`. @param {boolean} sub */
const graphRunning = (sub) => {
  const v = /** @type {any} */ (graphAfter([ADD, { action: "start", id: "t1" }]));
  return sub ? { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, state: "running", by: "sub-agent", ranAs: "sub-agent", agent: "sa_1", startedAt: T0 } : t)) } : v;
};
/** A chat with a session: its graph as the feed brought it, its turns, at work while `live`. @param {any} o @returns {any} */
const chatWith = ({ graph = null, turns = [], live = false }) => ({ id: "p-work", chainId: `chain-work-${Math.random()}`, turns, live: live ? { turn: null } : null, graphLive: graph, view: { settings: { effective: {} } } });
/** A turn whose run carried this checklist. @param {any[]} items */
const listTurn = (items) => ({ n: 1, status: "done", aligned: alignEvents([{ n: 1, type: "plan", round: 1, items }]) });
const quiet = { onLand: () => {}, held: true };

// (fails before: yes — nothing said whether the plan's work went on outside the Plan page's own head)
test("the plan's work under way: what of its graph runs as the head counts it — never the agent's own task between its turns — else the checklist's item its agent is on while it works", () => {
  assert.equal(runningNow(graphRunning(true), { atWork: true }), 2, "the agent's own and a sub-agent's");
  assert.equal(runningNow(graphRunning(true), { atWork: false }), 1, "between the agent's turns its own task waits: the sub-agent's alone");
  assert.equal(runningNow(graphRunning(false), { atWork: false }), 0);
  assert.equal(runningNow(graphRunning(false), { atWork: false, crew: "team" }), 1, "a lead plans apart from the chat's turn");
  assert.equal(runningNow(null), 0);

  assert.equal(planAtWork(chatWith({ graph: graphRunning(true), live: true }), quiet), "work under way: 2 running");
  assert.equal(planAtWork(chatWith({ graph: graphRunning(true) }), quiet), "work under way: 1 running", "a sub-agent works on after the turn");
  assert.equal(planAtWork(chatWith({ graph: graphRunning(false) }), quiet), null, "the agent's own task between its turns: nothing works on it");
  assert.equal(planAtWork(chatWith({ graph: graphAfter([ADD]) , live: true }), quiet), null, "a graph with nothing started");
  const items = [{ text: "Read the parser", status: "done" }, { text: "Fix it", status: "doing" }];
  assert.equal(planAtWork(chatWith({ turns: [listTurn(items)], live: true }), quiet), "work under way: now Fix it", "the checklist's item while its agent works");
  assert.equal(planAtWork(chatWith({ turns: [listTurn(items)] }), quiet), null, "left doing at the turn's end: nothing works on it");
  assert.equal(planAtWork(chatWith({ turns: [listTurn(items.map((i) => ({ ...i, status: "done" })))], live: true }), quiet), null, "every item done");
  assert.equal(planAtWork({ id: "fresh", chainId: null }, quiet), null, "no session");
});

// (fails before: yes — the views' host told nobody)
test("the views' host tells the plan's work at each paint of its badges: none while the Plan tab shows it, none in a chat with no session", async () => {
  /** @type {(string | null)[]} */
  const told = [];
  const views = createViews({
    frame: fakeH("section", { class: "conv-frame frame" }),
    slot: fakeH("div", { class: "view-tabs-slot" }),
    overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
    mk: fakeH,
    api: async () => null,
    openAgent: () => {},
    openRunLog: () => {},
    onShow: () => {},
    loadRun: () => new Promise(() => {}),
    later: () => {},
    team: teamIO(),
    side: /** @type {any} */ (sideIO()),
    sideSeams: sideSeams().seams,
    place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
    modelSelect: modelSelects().make,
    planWork: (words) => { told.push(words); },
  });
  const chat = chatWith({ graph: graphRunning(true) });
  views.setChat(chat);
  assert.equal(told.at(-1), "work under way: 1 running");
  views.show("plan");
  assert.equal(told.at(-1), null, "on its tab: in sight");
  views.show("chat");
  assert.equal(told.at(-1), "work under way: 1 running");
  views.setChat({ id: "fresh", chainId: null, turns: [], live: null });
  assert.equal(told.at(-1), null, "another chat, with no session: the last one's work is not its");
});

// (fails before: yes — the page fed neither signal to the header)
test("the page wires both: the views' plan work, and the browser's line as it paints, into the header's buttons", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\n  planWork: \(words\) => paneButtons\?\.works\("plan", words\),\n/);
  assert.match(app, /\n  browserLine\.paint\(line\);\n[^\n]*\n  paneButtons\?\.works\("browser", line \? usingWords\(line\) : null\);\n/, "where the line paints: with the chat, at each move of its browser, as runs begin or end");
  // The panes' moves paint the buttons, which read for themselves what is in front.
  assert.match(app, /\n  onChange: \(\) => \{ paneButtons\?\.paint\(\);/);
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\n\.pbtn-works \{[^}]*background: var\(--color-sys-blue\); animation: view-dot-breathe /, "a blue dot breathing, as the Chat tab's while the agent works");
  assert.match(css, /\n\[data-motion="off"\] \.pbtn-works \{ animation: none; \}/);
});
