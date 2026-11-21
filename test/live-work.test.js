// @ts-check
// proposal_ux Phase 5, live work in one home: the status capsule in the header and its words, the live line under the
// running turn, the Team tab in every chat (team_v2_plan TV2-D1), Watch all's tiles (lib/side.js
// `watchAll`/`tileWords`, views/side-watch.js), an agent's thread in a tile beside the chat (panes/thread.js, its tab
// id), and the Sub Agents tab's new parts: Threads or Watch all, Open beside, Retry on a failed thread, a team's lead
// in the strip with the way to the Team tab. Hand it to a team sits on the Team tab and on Who runs this chat
// (setup-sheet.js; its cards are team-surfaces.test.js's).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { h } from "../src/ui/lib/dom.js";
import { capsuleWords, createStatusCapsule } from "../src/ui/harness/conversation/status-panel.js";
import { createLiveLine, liveLineOf } from "../src/ui/harness/conversation/live-line.js";
import { turnStateWords } from "../src/ui/harness/lib/labels.js";
import { teamShown } from "../src/ui/harness/views/host.js";
import { tileWords, watchAll } from "../src/ui/harness/lib/side.js";
import { contextGauge } from "../src/ui/harness/lib/subagents.js";
import { createWatchAll, WATCH_EMPTY } from "../src/ui/harness/views/side-watch.js";
import { parseThreadTabId, tabCanOpen, threadTabId } from "../src/ui/harness/panes/pane-data.js";
import { renderThreadPane } from "../src/ui/harness/panes/thread.js";
import { createSideView } from "../src/ui/harness/views/side.js";
import { handSection } from "../src/ui/harness/widgets/hand.js";
import { teamRow } from "../src/core/roster.js";
import { teamStore } from "./helpers/team.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { buttonsOf, fakeDrawIn, fakeH, textOf } from "./helpers/fake-dom.js";
import { agentRow, guestRowOf, NOW, sideIO, sideSeams } from "./helpers/side-view.js";
import "./helpers/teams-on-page.js";

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

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
/** @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => byClass(n, cls)[0];
/** The button under `n` that says `words`. @param {any} n @param {string} words @returns {any} */
const button = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** @param {any} n */
const hidden = (n) => n.classList.contains("hidden");

/** An agent at work: its newest call and words, its round and window. @param {string} id @param {Record<string, any>} [over] */
const working = (id, over = {}) => agentRow(id, {
  status: "running",
  model: "zai/glm-5.3-flash",
  effort: "high",
  progress: { round: 6, tool: { name: "read", args: "src/ui/harness/views/side.js\nmore" }, words: "First I read the tab.\n\nNow I compare the tiles with the mock.", context: { tokens: 41_000 } },
  exchanges: [{ description: `Job ${id}`, startedAt: NOW - 90_000, endedAt: null, delivery: "held" }],
  ...over,
});
/** An agent that waits for your yes on a command. @param {string} id @param {Record<string, any>} [over] */
const asking = (id, over = {}) => working(id, { progress: { round: 2, asking: { tool: "bash", command: "npm test" }, words: "" }, ...over });

describe("the status capsule's words (proposal_ux §4.2)", () => {
  const S = { turn: null, compacting: null, working: 0, asking: 0, tasks: 0, now: NOW };
  const turn = (/** @type {Record<string, any>} */ o) => ({ phase: "running", startedAt: null, round: 0, error: "", ...o });

  // (fails before: yes — there was no capsule: the header said nothing of a chat that waits for you or works)
  test("what waits for you first, counting the turn's question and the agents'; then the work beside it", () => {
    assert.deepEqual(capsuleWords({ ...S, turn: turn({ phase: "asks" }), asking: 1, working: 2, tasks: 1 }),
      { state: "asks", lead: "Needs you · 2", more: "3 working", title: "2 questions for you, 3 at work" });
    assert.deepEqual(capsuleWords({ ...S, asking: 1, working: 1 }), { state: "asks", lead: "Needs you · 1", more: "1 working", title: "1 question for you, 1 at work" });
    assert.equal(capsuleWords({ ...S, turn: turn({ phase: "asks" }), compacting: { percent: 40 } }).state, "asks", "a question outranks a compaction");
  });

  test("a compaction making room: how far it got, else how long it has run", () => {
    assert.deepEqual(capsuleWords({ ...S, compacting: { percent: 42.4 } }), { state: "room", lead: "Making room", more: "42%", title: "A compaction makes room in the context window" });
    assert.equal(capsuleWords({ ...S, compacting: { since: NOW - 75_000, percent: null } }).more, "1:15");
    assert.equal(capsuleWords({ ...S, turn: turn({ startedAt: NOW - 5000 }), compacting: { since: NOW } }).state, "room", "the compaction runs before the turn's request");
  });

  // The clock is the live line's alone (the Designer's review of 10-24: four "Working"s, their clocks a second apart).
  test("a turn at work: its step; how long and the agents beside it in the title", () => {
    assert.deepEqual(capsuleWords({ ...S, turn: turn({ startedAt: NOW - 17 * 60_000, round: 12 }) }),
      { state: "working", lead: "Working", more: "step 12", title: "The agent works on your message · step 12 · 17m so far" });
    assert.equal(capsuleWords({ ...S, turn: turn({ startedAt: NOW - 45_000 }), working: 2 }).title, "The agent works on your message · 45s so far · 2 at work beside it");
    assert.deepEqual([capsuleWords({ ...S, turn: turn({ startedAt: NOW - 3_900_000 }) }).title, capsuleWords({ ...S, turn: turn({}) }).title],
      ["The agent works on your message · 1h 05m so far", "The agent works on your message"]);
  });

  test("the turn over and its agents still at work; an error the newest turn stopped on; else nothing to say", () => {
    assert.deepEqual(capsuleWords({ ...S, turn: turn({ phase: "ended" }), working: 2, tasks: 1 }),
      { state: "working", lead: "Working", more: "2 agents · 1 task", title: "The turn is over; 2 agents · 1 task still at work" });
    const error = "Upstream error: 529 overloaded_error: the API is overloaded\nretry later";
    assert.deepEqual(capsuleWords({ ...S, turn: turn({ phase: "failed", error }) }), { state: "stopped", lead: "Stopped", more: "529 overloaded_error: the API is overlo…", title: error });
    assert.equal(capsuleWords({ ...S, turn: turn({ phase: "failed", error }), working: 1 }).state, "working", "agents still at work are said before the error");
    for (const phase of ["ended", "none"]) assert.deepEqual(capsuleWords({ ...S, turn: turn({ phase }) }), { state: "idle", lead: "", more: "", title: "" });
    assert.deepEqual(capsuleWords(S), { state: "idle", lead: "", more: "", title: "" });
  });
});

describe("the capsule and the live line on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {string | null} */
  let panelPref = null;
  before(() => {
    doc = stubDocument();
    /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.statusPanel" ? panelPref : null), setItem: () => {}, removeItem: () => {} };
  });
  after(() => {
    doc.restore();
    delete (/** @type {any} */ (globalThis).localStorage);
  });

  // (fails before: yes — proposal_ux §4.2: the status was a floating panel alone)
  test("the capsule: hidden while nothing runs or waits, its two parts and its tone; a team's workers are the Team tab's", () => {
    panelPref = null;
    const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {} });
    const el = /** @type {any} */ (c.el);
    const parts = () => [el.querySelector(".sc-lead").textContent, el.querySelector(".sc-more").textContent, el.querySelector(".sc-more").classList.contains("hidden")];
    c.set({});
    assert.equal(hidden(el), true, "nothing runs: no capsule");
    c.set({ turn: { phase: "running", startedAt: Date.now() - 5_000, round: 3, error: "" } });
    assert.deepEqual([hidden(el), el.classList.contains("is-working"), ...parts()], [false, true, "Working", "step 3", false]);
    assert.equal(el.getAttribute("aria-label"), "Working, step 3");
    // An agent that asks you turns it orange, and says so first.
    c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, subagents: [asking("s1"), working("s2")] });
    assert.deepEqual([el.classList.contains("is-asks"), el.classList.contains("is-working"), ...parts()], [true, false, "Needs you · 1", "2 working", false]);
    // A team's worker at work lights the Team tab, not the capsule.
    c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, subagents: [working("w1", { team: { name: "Architect", role: "builder" } })] });
    assert.equal(hidden(el), true);
    // A turn that stopped on an error: the rule and the error's words.
    c.set({ turn: { phase: "failed", startedAt: null, round: 0, error: "Error: the key was refused" } });
    assert.deepEqual([el.classList.contains("is-stopped"), ...parts()], [true, "Stopped", "the key was refused", false]);
  });

  test("the capsule hides while the status floats over the chat instead (Appearance)", () => {
    panelPref = "auto";
    const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {} });
    c.set({ turn: { phase: "running", startedAt: Date.now(), round: 1, error: "" } });
    assert.equal(hidden(c.el), true);
    panelPref = null;
  });

  // (fails before: yes — proposal_ux §4.3: nothing under the running turn said what it did now, or when it reached its
  // coding agent)
  test("the live line's facts: waiting for you, the step before the request, the loop's state, its round, when it reached its agent", () => {
    assert.deepEqual(liveLineOf({ startedAt: 500, aligned: { turnState: { to: "acting" }, maxRound: 4, sentAt: 1000 } }), { asks: false, state: "acting", round: 4, startedAt: 500, sentAt: 1000 });
    assert.deepEqual(liveLineOf({ startedAt: 500, paused: true, aligned: { turnState: { to: "acting" } } }), { asks: true, state: "for your answer", round: 0, startedAt: 500, sentAt: null });
    assert.equal(liveLineOf({ startedAt: 1, aligned: { waiting: [{ id: "p1" }] } }).asks, true, "a permission waits");
    assert.equal(liveLineOf({ startedAt: 1, phase: { kind: "agent", step: "starting", agent: "Claude Code" }, aligned: { turnState: { to: "waiting" } } }).state, "starting Claude Code", "the step before the request comes first");
    assert.deepEqual([liveLineOf({ startedAt: 1, aligned: { turnState: { to: "observing" } } }).state, liveLineOf({ startedAt: 1, aligned: { turnState: { to: "planning" } } }).state, liveLineOf({ startedAt: 1 }).state], ["reading results", "thinking", ""]);
  });

  // (fails before: yes — the owner's of 11-04: "it should be mentioned somewhere above composer or maybe at the end of
  // your transcript why the turn is currently blocked"; the line said "waiting" alone)
  test("the live line says what a waiting turn waits for, in its run's words; a model call's retry or slot keeps its own row", () => {
    const state = (/** @type {any} */ turnState) => liveLineOf({ startedAt: 1, aligned: { turnState } }).state;
    assert.equal(state({ to: "waiting", why: "waiting for its sub-agent “Map the code” to report" }), "waiting for its sub-agent “Map the code” to report");
    assert.equal(state({ to: "waiting", why: "waiting for the team's workers to report" }), "waiting for the team's workers to report");
    assert.equal(state({ to: "waiting", why: "the developer's sub-agent is running; the turn waits for its report" }), "waiting for your agent", "the developer's own launch, as the fold says it");
    assert.equal(state({ to: "waiting", why: "kimi-cn is overloaded — trying again in 8 s (try 3 of 10)", retry: { status: 529 } }), "waiting");
    assert.equal(state({ to: "waiting", why: "waiting for a slot: k3 runs 1 call at a time", queue: { cap: 1 } }), "waiting");
    assert.equal(state({ to: "waiting" }), "waiting", "a wait that named nothing");
    // (fails before: yes — the review of 0fa60891d: any word "developer" in the wait's words read as the developer's own
    // launch, a sub-agent's name among them)
    const named = { to: "waiting", why: "waiting for its sub-agent “Update the developer guide” to report" };
    assert.equal(state(named), named.why, "a sub-agent's name is its name");
    assert.equal(turnStateWords(named), "waiting for its agents", "and the fold's words say its agents");
  });

  test("the live line: painted in place, its clocks set once each, the reach said only once its run says so; gone when the turn ends", () => {
    const line = createLiveLine();
    const el = /** @type {any} */ (line.el);
    const text = (/** @type {string} */ cls) => el.querySelector(`.${cls}`).textContent;
    assert.equal(hidden(el), true);
    const started = Date.now() - 65_000;
    const sent = Date.now() - 17 * 60_000;
    line.paint({ startedAt: started, aligned: { turnState: { to: "acting" }, maxRound: 4, sentAt: sent } }, "Claude Code");
    assert.deepEqual([hidden(el), text("turn-live-lead"), text("turn-live-state"), text("turn-live-round"), text("turn-live-took"), text("turn-live-reached")],
      [false, "Working", " · acting", " · step 4", " · 1m 5s", " · the turn reached Claude Code 17m ago"]);
    const took = el.querySelector(".turn-live-took");
    took.textContent = "ticked";
    line.paint({ startedAt: started, paused: true, aligned: { maxRound: 5, sentAt: sent } }, "Claude Code");
    assert.deepEqual([el.classList.contains("is-asks"), text("turn-live-lead"), text("turn-live-state"), text("turn-live-took")], [true, "Waiting", " · for your answer", "ticked"], "the clock is the shared timer's between starts");
    // Filament's own loop runs the turn: no agent to reach.
    line.paint({ startedAt: started, aligned: { turnState: { to: "planning" }, maxRound: 5, sentAt: sent } }, "");
    assert.deepEqual([text("turn-live-reached"), el.querySelector(".turn-live-reached").dataset.t0], ["", undefined]);
    line.clear();
    assert.equal(hidden(el), true);
  });

  // (fails before: yes — the owner's of 11-02: a chat on GLM-5.3, run by Filament's loop, said "the turn reached Claude
  // Code 7m ago" — the words the line kept from the chat shown before, a Claude Code turn's, frozen: `clear` let go of
  // their clock and kept them, and a turn with no agent to reach found nothing to change)
  test("the live line cleared after a coding agent's turn says nothing of an agent for the next turn Filament's loop runs", () => {
    const line = createLiveLine();
    const el = /** @type {any} */ (line.el);
    const text = (/** @type {string} */ cls) => el.querySelector(`.${cls}`).textContent;
    line.paint({ startedAt: Date.now() - 65_000, aligned: { turnState: { to: "acting" }, maxRound: 4, sentAt: Date.now() - 7 * 60_000 } }, "Claude Code");
    assert.equal(text("turn-live-reached"), " · the turn reached Claude Code 7m ago");
    // Another chat shown, or the turn ended: then a turn the loop runs.
    line.clear();
    line.paint({ startedAt: Date.now() - 24_000, aligned: { turnState: { to: "planning" }, maxRound: 1 } }, "");
    assert.deepEqual([hidden(el), text("turn-live-took"), text("turn-live-reached")], [false, " · 24s", ""]);
  });

  // (fails before: yes — proposal_ux §4.7: an agent's thread opened in the Agents pane, a list of every agent beside the
  // chat; a thread is a tile of its own now, its tab id naming the agent)
  test("an agent's thread beside the chat: its tab names the agent; the tile draws its conversation, its head the way to Sub Agents", () => {
    assert.deepEqual([threadTabId("s3"), parseThreadTabId("thread:s3"), parseThreadTabId("thread:run_1~a2"), parseThreadTabId("thread:"), parseThreadTabId("thread:a b"), parseThreadTabId("file:x")],
      ["thread:s3", "s3", "run_1~a2", null, null, null]);
    assert.deepEqual([tabCanOpen("thread:s3", []), tabCanOpen("thread:", []), tabCanOpen("agents", [])], [true, false, false], "the Agents pane is gone");
    /** @type {any[]} */
    const made = [];
    const conv = (/** @type {boolean} */ own) => (/** @type {any} */ o) => {
      const t = { o, own, mounted: /** @type {any[]} */ ([]), closed: false, focused: false,
        head: h("div", { class: "sav-head" }, `head ${o.id}`), body: h("div", { class: "sav-body" }, `body ${o.id}`), foot: h("div", { class: "sav-foot-box" }, `foot ${o.id}`),
        /** @param {any[]} at */ mount(...at) { t.mounted.push(at); }, close() { t.closed = true; }, ...(own ? {} : { focusFollowUp() { t.focused = true; } }) };
      made.push(t);
      return /** @type {any} */ (t);
    };
    const body = /** @type {any} */ (h("div", {}));
    const head = /** @type {any} */ (h("div", {}));
    let opened = 0;
    const pane = renderThreadPane(body, { chainId: "c1", id: "s3", toast: () => {}, main: /** @type {any} */ ({}), head, onOpen: () => { opened += 1; }, conversation: conv(false), guest: conv(true) });
    const root = body.querySelector(".thp");
    assert.deepEqual([made.length, made[0].own, made[0].o.chainId, root.getAttribute("data-thread"), root.querySelector(".thp-head").textContent, root.querySelector(".thp-scroll").textContent, root.querySelector(".sav-foot-box").textContent],
      [1, false, "c1", "s3", "head s3", "body s3", "foot s3"]);
    assert.deepEqual(made[0].mounted, [[root.querySelector(".thp-scroll")]], "mounted once, scrolling in its own part");
    head.querySelector(".thp-open").dispatch("click");
    pane.focusFollowUp();
    pane.close();
    assert.deepEqual([opened, made[0].focused, made[0].closed], [1, true, true]);
    // A coding agent's own is a thread to read: no box to focus, and no way to Sub Agents where none is given.
    const head2 = /** @type {any} */ (h("div", {}, "kept"));
    const own = renderThreadPane(/** @type {any} */ (h("div", {})), { chainId: "c1", id: "run_1~a2", toast: () => {}, main: /** @type {any} */ ({}), head: head2, conversation: conv(false), guest: conv(true) });
    own.focusFollowUp();
    assert.deepEqual([made[1].own, head2.textContent], [true, "kept"]);
  });
});

describe("the teams are in every chat (team_v2_plan TV2-D1; U13-D5: on the Agents tab)", () => {
  // (fails before: yes — proposal_ux R4 hid it in a chat no team led, so a team was found only on Overview's sheet:
  // the owner's words of 10-19, "if there is no team tab then how can a team start from main session"; U13-D5, 10-20:
  // the tab is the Agents tab's, whose Teams row is in every chat but a team's own)
  test("every chat with a session has its Teams row on the Agents tab, a team leading or not; the Teams tab itself never shows", () => {
    const chat = (/** @type {Record<string, any>} */ o = {}) => ({ chainId: "c1", viewTab: "chat", view: { settings: { engine: { mode: "solo" } } }, ...o });
    for (const c of [chat(), chat({ view: { settings: { engine: { mode: "team", team: "architect" } } } }), { chainId: null }, null]) assert.equal(teamShown(c), false);
    assert.match(read("src/ui/harness/views/host.js"), /home: \(\) => teamsOn\(state\.config\) && !o\.team\.beside\?\.main\?\.\(\),/, "a team's own chat sends no team of its own, nor any chat while Settings › Experimental's Teams switch is off");
  });

  // (§10 O1: Lead with this team is Put in charge…, which opens the team's Brief; the Teams tab draws its home, not the
  // sheet's cards)
  test("the page: the tab shows by the chat alone; Who runs this chat hands it to a team through its Brief, closing its sheet first", () => {
    const host = read("src/ui/harness/views/host.js");
    assert.match(host, /tabs\.shown\("team", teamShown\(chat\)\);/);
    const sheet = read("src/ui/harness/setup-sheet.js");
    assert.match(sheet, /const hand = id === "who" && teamsOn\(state\.config\) \? o\.hand\?\.\(\) : null;/, "none while Settings › Experimental's Teams switch is off");
    assert.match(sheet, /handSection\(\{ \.\.\.hand, lead: \(team\) => \{ s\.close\(\); hand\.lead\(team\); \}, newTeam: \(\) => \{ s\.close\(\); hand\.newTeam\(\); \} \}\)/);
    assert.match(sheet, /box\.replaceChildren\(\.\.\.\[handEl, history, mcp\?\.el, \.\.\.cards\]/, "the teams come first on the sheet");
    const app = read("src/ui/harness/app.js");
    assert.match(app, /wait: null,\n(\s*\/\/.*\n)*\s*lead: \(team\) => openBriefNow\(\{ team: team\.key, way: "charge" \}\),/, "Put in charge… opens the team's Brief, In charge: its Send hands over, after a running turn where one runs");
    assert.match(app, /hand: \(\) => handOf\(c\),/, "the sheet's teams");
    assert.match(read("src/ui/harness/widgets/overview-setup.js"), /t \? link\(mk, "Back to your agent…", \(\) => ctx\.team\?\.back\(\)\) : ctx\.team\?\.on\?\.\(\) === false \? null : link\(mk, "Hand it to a team…", \(\) => ctx\.team\?\.open\(\)\),/, "Overview's Hand it to a team… opens the Team tab, and is not offered while Settings › Experimental's Teams switch is off; Back to your agent… still is");
  });

  // (fails before: yes — d-side, 11-12: BugHunters' card said who leads whom and Put in charge…, and nothing of what
  // that means for a team the server holds to reading; the person learned it from the mode chip, after the send)
  test("Who runs this chat: the card of a team that changes no file says, over Put in charge…, that the chat only reads while it is in charge; a team that builds, and one of yours whose workers all read, say nothing more; the press is the same", () => {
    const store = teamStore();
    store.create({ name: "Readers", lead: "product", members: [{ tag: "reviewer" }] });
    const teams = store.list().map(teamRow);
    /** @type {string[]} */
    const led = [];
    const hand = /** @type {any} */ (handSection({ team: null, teams, wait: null, lead: (t) => { led.push(t.key); }, newTeam: () => {} }, /** @type {any} */ (fakeH)));
    /** A team's card. @param {string} name */
    const cardOf = (name) => all(hand, (x) => x.tag === "section" && x.attrs?.["aria-label"] === `${name} team`)[0];
    /** The quiet lines on a card: who leads whom, then what In charge means where that is to be said. @param {string} name */
    const quiet = (name) => byClass(cardOf(name), "hand-card-who").map((p) => textOf(p));
    assert.deepEqual(quiet("BugHunters"), ["BugHunters leads Hunter, Checker", "The chat only reads while it is in charge, whatever its mode: BugHunters changes no file."]);
    assert.deepEqual(byClass(cardOf("BugHunters"), "hand-card-reads").map((p) => p.tag), ["p"], "a line of its own, under who leads whom");
    assert.deepEqual([quiet("Builders"), quiet("Readers")], [["Builders leads Scout, Builder, Tester, Reviewer"], ["Product leads Reviewer"]], "neither is held to reading");
    // The press is what it was: its Brief, In charge (above) — the words the person pressed.
    const press = button(cardOf("BugHunters"), "Put in charge…");
    assert.equal(press.attrs.title, "Open the BugHunters' Brief, In charge: your first words to its lead; Send hands this chat over");
    press.dispatch("click");
    assert.deepEqual(led, ["bughunters"]);
    // Leading already, it holds the chat so: the line stands, with no press.
    const leading = /** @type {any} */ (handSection({ team: /** @type {any} */ ({ key: "bughunters" }), teams, wait: null, lead: () => {}, newTeam: () => {} }, /** @type {any} */ (fakeH)));
    const on = all(leading, (x) => x.tag === "section" && x.attrs?.["aria-label"] === "BugHunters team")[0];
    assert.deepEqual([byClass(on, "hand-card-reads").map((p) => textOf(p)), button(on, "Put in charge…")], [["The chat only reads while it is in charge, whatever its mode: BugHunters changes no file."], undefined]);
  });
});

describe("Watch all (proposal_ux §4.7)", () => {
  const own = (/** @type {string} */ stub, /** @type {Record<string, any>} */ o = {}) => guestRowOf(stub, { status: "running", endedAt: null, startedAt: NOW - 30_000, ...o });

  // (fails before: yes — there was no Watch all: an agent's work showed only in its own thread, one at a time)
  test("who shows: every agent at work, a coding agent's own too; those that ask you first, then the newest", () => {
    const rows = [agentRow("done"), working("old", { startedAt: NOW - 100_000 }), asking("asks", { startedAt: NOW - 400_000 }), working("new", { startedAt: NOW - 20_000 })];
    const guests = [own("a1", { startedAt: NOW - 50_000 }), guestRowOf("a2")];
    assert.deepEqual(watchAll(rows, guests).map((r) => r.id), ["asks", "new", "run_1~a1", "old"]);
    assert.deepEqual(watchAll([agentRow("done")]), []);
  });

  test("a tile's words: its model at its effort, its time, the files it changed and the call it is in, its newest paragraph, its figures", () => {
    const files = ["src/a.js", "src/ui/b.js", "c.css", "d.md", "e.md"].map((path) => ({ path }));
    const w = tileWords(working("s1", { card: { tag: "reviewer", name: "Reviewer", kind: "worker" }, work: { files, pending: 0 } }), NOW);
    assert.deepEqual(w, {
      name: "Reviewer",
      model: "GLM-5.3 Flash at high",
      took: "1m 30s",
      ask: null,
      work: [{ label: "Changes", text: "a.js · b.js · c.css · 2 more", mono: false }, { label: "Reading", text: "src/ui/harness/views/side.js", mono: true }],
      words: "Now I compare the tiles with the mock.",
      figures: "6 rounds · 41k tokens",
      tip: "Its context holds 41,000 tokens. Its window is not known yet.",
      own: false,
    });
    const a = tileWords(asking("s2"), NOW);
    assert.deepEqual([a.ask?.verb, a.ask?.what, a.work, a.figures], ["wants to run", "npm test", [], "2 rounds"]);
    assert.equal(tileWords(working("s3", { progress: { words: "x".repeat(400) } }), NOW).words.length, 280, "cut, as a tile has room for");
    // A coding agent's own: what its agent told it, its calls and tokens; Filament reads no thinking of it.
    assert.deepEqual(tileWords(own("a1", { tokens: 12_300, prompt: "Map the parser\nand more" }), NOW),
      { name: "Explore", model: "", took: "30s", ask: null, work: [], words: "Started by Claude Code: “Map the parser”", figures: "14 calls · 12k tokens", tip: "", own: true });
  });

  // The owner's of 11-12: "when the sub agent is running it would be good to know it's token count as well and also at
  // what percentage the compaction will start out of it's context window. you know the usual stuf."
  // (fails before: yes — a running agent said its tokens alone, against its window where one was known: never the share
  // it held, never where it compacts)
  test("a running agent's context, as its gauge says it: its count, the share of its window, where it compacts and how near that is", () => {
    const of = (/** @type {Record<string, any>} */ context, /** @type {any[]} */ compactions = []) => contextGauge(/** @type {any} */ ({ context, compactions }));
    /** Its gauge's words, part by part: the share, the count, where it compacts, its compactions. @param {ReturnType<typeof contextGauge>} g */
    const said = (g) => [g?.share, g?.count, g?.at, g?.folds];
    const g = of({ tokens: 136_412, window: 1_000_000, usable: 400_000 });
    assert.deepEqual(said(g), ["14%", "136k of 1M", "compacts at 40%", ""]);
    assert.deepEqual([g?.tone, g?.fill, g?.line, g?.held], ["", 0.136412, { tokens: 400_000, f: 0.4, percent: 40 }, "136k of 1M · 14%"]);
    assert.equal(g?.title, "Its context holds 136,412 tokens of its 1,000,000-token window (14%). It compacts at 400,000 tokens, 40% of the window: 263,588 to go.");
    // Nearing its line (85% of the way there), as the chat's own Context gauge turns; past it, at its next step.
    assert.equal(of({ tokens: 339_999, window: 1_000_000, usable: 400_000 })?.tone, "");
    assert.equal(of({ tokens: 340_000, window: 1_000_000, usable: 400_000 })?.tone, "warn");
    const past = of({ tokens: 410_000, window: 1_000_000, usable: 400_000 });
    assert.deepEqual([past?.tone, ...said(past)], ["error", "41%", "410k of 1M", "past its line at 40%", ""]);
    assert.equal(past?.title, "Its context holds 410,000 tokens of its 1,000,000-token window (41%). It is past its compaction line, 400,000 tokens (40% of the window): room is made at its next step.");
    // A window of 200,000: 85% of it. A sliver is under 1%, never 0%.
    assert.deepEqual(said(of({ tokens: 12_000, window: 200_000, usable: 170_000 })), ["6%", "12k of 200k", "compacts at 85%", ""]);
    assert.deepEqual(said(of({ tokens: 900, window: 200_000, usable: 170_000 })), ["<1%", "900 of 200k", "compacts at 85%", ""]);
    // No line said: its agent makes room at a point of its own. One that lies outside the window its agent names is none.
    const own = of({ tokens: 12_000, window: 200_000, usable: null });
    assert.deepEqual([...said(own), own?.line, own?.tone], ["6%", "12k of 200k", "", "", null, ""]);
    assert.equal(own?.title, "Its context holds 12,000 tokens of its 200,000-token window (6%). Nothing says where it compacts: its agent makes room at a point of its own.");
    const outside = of({ tokens: 151_000, window: 200_000, usable: 400_000 });
    assert.deepEqual([...said(outside), outside?.line], ["76%", "151k of 200k", "", "", null]);
    // No window known: the count alone. Filament's estimate says so; its compactions so far are counted.
    const bare = of({ tokens: 41_000 });
    assert.deepEqual([...said(bare), bare?.fill, bare?.held, bare?.title], ["", "41k tokens", "", "", null, "41k tokens", "Its context holds 41,000 tokens. Its window is not known yet."]);
    const est = of({ tokens: 150_000, window: 1_000_000, usable: 400_000, estimated: true }, [{ round: 3, at: NOW, how: "summary" }, { round: 9, at: NOW, how: "summary" }]);
    assert.deepEqual(said(est), ["15%", "≈150k of 1M", "compacts at 40%", "compacted twice"]);
    assert.equal(est?.title, "Its context holds ≈150,000 tokens of its 1,000,000-token window (15%), as Filament estimates it: its agent says no count. It compacts at 400,000 tokens, 40% of the window: ≈250,000 to go. Compacted twice so far.");
    // Nothing counted yet: no gauge.
    assert.deepEqual([of({ tokens: 0, window: 200_000, usable: 170_000 }), contextGauge(null), contextGauge(/** @type {any} */ ({ context: null }))], [null, null, null]);

    // A tile's foot says the count and the share in the few words it has room for, the whole on hover; its thread's
    // head says the rest.
    const tile = tileWords(working("s5", { progress: { round: 6, words: "", context: { tokens: 136_412, window: 1_000_000, usable: 400_000 } } }), NOW);
    assert.deepEqual([tile.figures, tile.tip], ["6 rounds · 136k of 1M · 14%", g?.title]);
  });

  test("the grid: a tile each, kept while what it says holds — its clock moves alone —, drawn again when its words move, gone once it stops", () => {
    /** @type {any[][]} */
    const calls = [];
    const w = createWatchAll({ open: (id) => calls.push(["open", id]), beside: (id) => calls.push(["beside", id]), stop: (id) => calls.push(["stop", id]) }, { h: fakeH, place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn });
    const el = /** @type {any} */ (w.el);
    assert.deepEqual([w.paint([], [], NOW), textOf(one(el, "sw-empty")), hidden(one(el, "sw-empty"))], [0, WATCH_EMPTY, false]);
    const rows = [working("s1"), asking("s2")];
    const guests = [own("a1")];
    assert.equal(w.paint(rows, guests, NOW), 3);
    assert.equal(hidden(one(el, "sw-empty")), true);
    const tiles = () => one(el, "sw-grid").kids;
    const [ask, guest, work] = tiles();
    assert.deepEqual(tiles().map((t) => t.attrs["data-id"]), ["s2", "run_1~a1", "s1"]);
    assert.deepEqual([ask.classList.contains("is-asks"), textOf(one(ask, "sw-state")), textOf(one(ask, "sw-ask"))],
      [true, "waits for you · |1m 30s", "It wants to run|npm test|Open the ask|You answer in its thread; nothing runs until you allow it."]);
    assert.deepEqual([textOf(one(work, "sw-head")), textOf(one(work, "sw-foot"))], ["Builder|yours|GLM-5.3 Flash at high|1m 30s|Stop", "6 rounds · 41k tokens|Open beside|Open thread"]);
    assert.deepEqual([guest.classList.contains("is-own"), button(guest, "Stop"), textOf(one(guest, "sw-tag")), textOf(one(guest, "sw-note"))],
      [true, undefined, "Claude Code's own", "Its coding agent shares its calls and answers, not its thinking."], "a coding agent's own is read, never stopped");
    button(work, "Stop").dispatch("click");
    button(work, "Open beside").dispatch("click");
    button(work, "Open thread").dispatch("click");
    button(work, "Builder").dispatch("click");
    one(work, "sw-body").dispatch("click");
    button(ask, "Open the ask").dispatch("click");
    assert.deepEqual(calls, [["stop", "s1"], ["beside", "s1"], ["open", "s1"], ["open", "s1"], ["open", "s1"], ["open", "s2"]], "nothing on a tile starts an agent");
    // Five seconds on: the same tiles, their clocks moved.
    w.paint(rows, guests, NOW + 5_000);
    assert.deepEqual([tiles()[0] === ask, tiles()[2] === work, textOf(one(work, "sw-took"))], [true, true, "1m 35s"]);
    // Its words move: that tile alone is drawn again — on the page over the one that stands (test/agents-in-place.test.js),
    // here a fake's new one.
    const moved = [working("s1", { progress: { round: 7, words: "Done reading." } }), asking("s2")];
    w.paint(moved, guests, NOW + 5_000);
    assert.deepEqual([tiles()[0] === ask, tiles()[2] === work, textOf(one(tiles()[2], "sw-words"))], [true, false, "Done reading."]);
    // One stops: its tile goes; back at work, it is built anew.
    w.paint([moved[1]], [], NOW + 6_000);
    assert.deepEqual(tiles().map((t) => t.attrs["data-id"]), ["s2"]);
    w.paint(moved, [], NOW + 6_000);
    assert.notEqual(tiles()[1], work);
  });

  // (fails before: yes — the review of the s-asks hunt's fix: a question a sub-agent's chat on another machine asks read
  // "It On Workstation, it asks: …", and said nothing runs until the person allows it, where nothing asks to run)
  test("a question another machine's chat asks: its tile says it in its own words, and how it is answered", () => {
    const w = createWatchAll({ open: () => {} }, { h: fakeH, place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn });
    const question = { kind: "question", tool: "ask", args: "", question: "On Workstation, it asks: Which colour?", options: ["red", "blue"], machine: "Workstation", n: 1 };
    w.paint([asking("s4", { progress: { round: 1, asking: question, words: "" } })], [], NOW);
    assert.equal(textOf(one(w.el, "sw-ask")), "On Workstation, it asks: Which colour?|Open the ask|You answer it in its thread.");
    assert.equal(tileWords(asking("s4"), NOW).ask?.question, false, "a call that asks to run is no question");
  });

  test("a host with no pane beside the chat and no Stop: neither is offered", () => {
    const w = createWatchAll({ open: () => {} }, { h: fakeH, place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn });
    w.paint([working("s1")], [], NOW);
    assert.deepEqual(buttonsOf(w.el).map((b) => textOf(b)), ["Builder", "Open thread"]);
  });
});

describe("the Agents tab: List or Tiles, Open beside, Retry, a lead in the strip", () => {
  /** @param {Record<string, any>} [over] the IO's parts */
  function viewOf(over = {}) {
    const io = sideIO(over);
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    return { io, view, chat, ...s, el: /** @type {any} */ (view.el) };
  }
  const mode = (/** @type {any} */ el, /** @type {string} */ words) => button(one(el, "sd-bar"), words);

  // (fails before: yes — proposal_ux §4.7: the tab showed one thread at a time, and nothing every agent at work; U13-D5
  // names the two List and Tiles)
  test("Tiles lets the open thread go and shows the tiles; a tile's Open thread comes back to the List on it", () => {
    const rows = [working("s1"), agentRow("s2")];
    const t = viewOf({ rows: () => rows, openBeside: (/** @type {string} */ id) => t.io.calls.push(["beside", id]) });
    t.view.paint(t.chat);
    t.view.open("s2");
    assert.deepEqual([t.threads.length, hidden(one(t.el, "sw")), hidden(one(t.el, "sd-bar-line")), hidden(one(t.el, "sd-beside"))], [1, true, true, false]);
    mode(t.el, "Tiles").dispatch("click");
    assert.deepEqual([t.chat.side.mode, t.threads[0].closed, hidden(one(t.el, "sw")), hidden(one(t.el, "sd-conv")), hidden(one(t.el, "sd-fresh")), hidden(one(t.el, "sd-bar-line")), hidden(one(t.el, "sd-beside"))],
      ["watch", true, false, true, true, false, true]);
    assert.deepEqual(byClass(t.el, "sw-tile").map((x) => x.attrs["data-id"]), ["s1"], "the agent at work alone");
    assert.equal(mode(t.el, "Tiles").attrs["aria-checked"], "true");
    button(one(t.el, "sw-tile"), "Open thread").dispatch("click");
    assert.deepEqual([t.chat.side.mode, t.chat.side.open, t.threads.length, t.threads[1].o.id, hidden(one(t.el, "sw")), hidden(one(t.el, "sd-conv"))], ["threads", "s1", 2, "s1", true, false]);
    // A new thread, a /btw, a card's Open: each shows its thread, not the tiles.
    mode(t.el, "Tiles").dispatch("click");
    t.view.fresh();
    assert.deepEqual([t.chat.side.mode, hidden(one(t.el, "sd-fresh"))], ["threads", false]);
  });

  test("Open beside puts the open thread in a pane beside the chat; none on a new thread, or where the page has no pane", () => {
    const t = viewOf({ rows: () => [agentRow("s2")], openBeside: (/** @type {string} */ id) => t.io.calls.push(["beside", id]) });
    t.view.paint(t.chat);
    assert.equal(hidden(one(t.el, "sd-beside")), true, "a new thread has nothing to put beside");
    t.view.open("s2");
    one(t.el, "sd-beside").dispatch("click");
    assert.deepEqual(t.io.calls.filter((c) => c[0] === "beside"), [["beside", "s2"]]);
    const bare = viewOf({ rows: () => [agentRow("s2")] });
    bare.view.paint(bare.chat);
    bare.view.open("s2");
    assert.equal(hidden(one(bare.el, "sd-beside")), true);
  });

  // (fails before: yes — the owner's of 11-19: Open beside left the Agents tab as the view, so the one thread showed on
  // both sides and the main agent's chat on neither)
  test("Open beside brings the chat into the view where the thread shows beside it; on top, the view is the thread's", () => {
    assert.match(read("src/ui/harness/app.js"), /const openBeside = \(id\) => \{\n\s*if \(!subagentStore\.chainId\(\)\) return;\n\s*rail\.openTab\(threadTabId\(id\)\);\n\s*if \(rail\.whereIs\(threadTabId\(id\)\) === "front"\) views\.show\("chat"\);\n\};/);
  });

  // (fails before: yes — proposal_ux §4.7: a failed thread offered nothing; its question had to be typed again; then
  // the owner's word of 10-24: Retry made a new thread instead of going on with the one that failed)
  test("Retry on a failed thread: its agent asked again in that same thread, once per press; no new thread, nothing in the box", async () => {
    const failed = agentRow("s4", { status: "failed", card: { tag: "reviewer", name: "Reviewer", kind: "worker" }, exchanges: [{ description: "Review", prompt: "Review the token check", startedAt: NOW - 9000, endedAt: NOW - 1000 }] });
    /** @type {(() => void) | null} */
    let land = null;
    const t = viewOf({
      rows: () => [failed, agentRow("s5", { status: "aborted" }), agentRow("s7", { status: "running" })],
      retry: (/** @type {string} */ id) => {
        t.io.calls.push(["retry", id]);
        return new Promise((r) => (land = () => r(failed)));
      },
    });
    t.view.paint(t.chat);
    t.view.open("s4");
    assert.equal(textOf(one(t.el, "sd-retry")), "It failed before it answered.|Retry");
    button(one(t.el, "sd-retry"), "Retry").dispatch("click");
    button(one(t.el, "sd-retry"), "Retry").dispatch("click");
    assert.deepEqual(t.io.calls.filter((c) => c[0] === "retry" || c[0] === "launch"), [["retry", "s4"]], "one retry for two presses, and no launch");
    assert.deepEqual([t.chat.side.open, t.chat.side.text || ""], ["s4", ""], "the same thread stays open; the new thread's box is not filled");
    /** @type {any} */ (land)?.();
    await new Promise((r) => setTimeout(r, 0));
    button(one(t.el, "sd-retry"), "Retry").dispatch("click");
    assert.equal(t.io.calls.filter((c) => c[0] === "retry").length, 2, "once it went, another press asks again");
    t.view.open("s5");
    assert.equal(textOf(one(t.el, "sd-retry")), "It was cut off before it answered.|Retry");
    // (fails before: yes — the owner's screenshot of 10-23: another thread at work showed the failed one's strip over
    // its box, "It failed before it answered. Retry…")
    t.view.open("s4");
    t.view.open("s7");
    assert.deepEqual([one(t.el, "sd-retry"), hidden(one(t.el, "sd-asks"))], [undefined, true], "the thread at work shows no other thread's strip");
    t.view.open("s4");
    const done = viewOf({ rows: () => [agentRow("s6")] });
    done.view.paint(done.chat);
    done.view.open("s6");
    assert.equal(one(done.el, "sd-retry"), undefined, "an answered thread offers no retry");
  });

});
