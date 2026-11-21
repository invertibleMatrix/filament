// @ts-check
// team_v2_plan P3 and P5 on the page, in §10's words: the teams on the side of a chat on its Teams tab
// (views/beside.js) — Send a team…, which opens the Brief and starts nothing; each team's card with its state, its
// switches while it works and its hand-offs, each a press; a team's own chat saying whose it is — the two marks in the
// main chat's transcript (conversation/beside-marks.js), and the page's list of them with its words (lib/beside.js).
// The Brief itself: test/brief.test.js.
// (fails before: yes — the page had no teams beside a chat)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createBesideView } from "../src/ui/harness/views/beside.js";
import { BESIDE_BADGE, besideRoutes, cardActions, createBesideStore, fellWords, firedWords, notifiedWords, onWords, stateLine, workersWords } from "../src/ui/harness/lib/beside.js";
import { LONG_ASK, besideActions, besideMarkRow } from "../src/ui/harness/conversation/beside-marks.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import "./helpers/teams-on-page.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** The switch under `n` its label names. @param {any} n @param {string} label */
const switchOf = (n, label) => all(n, (x) => x.attrs?.role === "switch" && x.attrs["aria-label"] === label)[0];
/** A team's card. @param {any} n @param {string} id */
const cardOf = (n, id) => all(n, (x) => x.attrs?.["data-beside"] === id)[0];
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

const NOW = 1_800_000_000_000;
/** A team beside as the list route answers it. @param {any} [o] @returns {any} */
const row = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the parser", firedBy: "you", at: NOW - 5 * 60_000, model: "m-1", title: "",
  state: "working", workers: { running: 2, waiting: 1, total: 3 }, verify: false, notify: false, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});
const DONE = { state: "done", workers: { running: 0, waiting: 0, total: 3 }, result: { n: 1, text: "Found: parse.js:3 reads a field of null.", more: false, at: NOW } };

describe("the words a team beside's card and marks say", () => {
  test("what its workers do, its state's line, where its result went, and which presses its card offers", () => {
    assert.equal(workersWords(row()), "2 at work · 1 waits for a slot");
    assert.equal(workersWords(row({ workers: { running: 0, waiting: 0, total: 1 } })), "");
    assert.equal(stateLine(row({ workers: { running: 0, waiting: 0, total: 0 } })), "Its lead works on it");
    assert.equal(stateLine(row({ state: "asking" })), "Its lead asks you something: open it to answer");
    assert.equal(stateLine(row({ state: "stopped", cut: true })), "Stopped before it finished: Filament stopped while it worked");
    assert.equal(stateLine(row({ state: "stopped" })), "Stopped before it finished");
    assert.equal(stateLine(row(DONE)), "");
    assert.deepEqual(BESIDE_BADGE, { working: "At work", asking: "Asks you", done: "Done", stopped: "Stopped" });
    assert.deepEqual(cardActions(row()), { stop: true, notify: false, verify: false, resume: false, switches: true });
    assert.deepEqual(cardActions(row(DONE)), { stop: false, notify: true, verify: true, resume: false, switches: false });
    assert.equal(cardActions(row({ ...DONE, notified: { n: 1, at: NOW, how: "sent" } })).notify, false, "once per result");
    assert.equal(cardActions(row({ ...DONE, team: { key: "bughunters", name: "BugHunters" }, checked: true })).verify, false, "BugHunters' own is not checked again: the server says it comes checked");
    assert.equal(cardActions(row({ ...DONE, verifiedBy: "t9" })).verify, false);
    assert.equal(cardActions(row({ state: "stopped", cut: true })).resume, true);
    // (fails before: yes — U13 W3: a team you stopped had no way to go on) Its conversation stays: Resume… goes on.
    assert.equal(cardActions(row({ state: "stopped" })).resume, true);
    // (§10: "your agent", never "the main agent")
    assert.equal(notifiedWords(row({ notified: { n: 1, at: NOW, how: "steered" } })), "Sent to your agent: its running turn read it");
    assert.equal(notifiedWords(row({ notified: { n: 1, at: NOW, how: "waits" } })), "Goes to your agent once its turn ends");
    assert.deepEqual([firedWords(row()), firedWords(row({ firedBy: "agent" }))], ["sent by you", "sent by your agent"]);
    assert.equal(onWords(row().on), `its lead on ${prettyModel("m-1")} · its workers on ${prettyModel("m-2")}`);
    assert.equal(onWords({ lead: null, workers: ["m-2", "m-3"], from: "chat", fell: [] }), `its workers on their cards' models, else this chat's list: ${prettyModel("m-2")}, then ${prettyModel("m-3")}`);
    assert.equal(onWords({ lead: null, workers: ["m-2"], from: "here", fell: [] }), `its workers on this chat's models for the team: ${prettyModel("m-2")}`);
    assert.deepEqual(fellWords({ lead: "m-1", workers: ["m-2"], from: "team", fell: [{ name: "Claude Opus 5.5", why: "signed out", as: "lead" }, { name: "Kimi K3", why: "", as: "workers" }] }),
      ["Claude Opus 5.5 cannot run now (signed out): its lead runs on this chat's model", "Kimi K3 cannot run now: its workers run on the rest of the team's list"]);
    // (fails before: yes — the owner's 10-19 list: a lead's model that could not run fell to the chat's)
    assert.deepEqual(fellWords({ lead: "m-3", workers: null, from: "seats", fell: [{ name: "Claude Opus 5.5", why: "signed out", as: "lead", next: "GLM 5.3" }] }),
      ["Claude Opus 5.5 cannot run now (signed out): its lead runs on the next of its list, GLM 5.3"]);
    // (fails before: yes — the review of 0376f5a4f: a worker's model that fell was said to pass to the team's list,
    // where the rest come from this chat's rows for the team, or each member's card's, else this chat's list)
    const fell = { name: "Kimi K3", why: "", as: /** @type {const} */ ("workers") };
    assert.deepEqual([fellWords({ lead: "m-1", workers: ["m-2"], from: "here", fell: [fell] }), fellWords({ lead: "m-1", workers: ["m-2"], from: "chat", fell: [fell] })],
      [["Kimi K3 cannot run now: its workers run on the rest of this chat's rows for the team"], ["Kimi K3 cannot run now: its workers run on their cards' models, else this chat's list"]]);
    // (fails before: yes — d-send's follow-up: a run kept on its project's list, which the line above it calls "this
    // project's list", was said to fall to "this chat's list")
    assert.deepEqual(fellWords({ lead: "m-1", workers: ["m-2"], from: "project", fell: [fell] }), ["Kimi K3 cannot run now: its workers run on their cards' models, else this project's list"]);
    assert.equal(onWords({ lead: null, workers: ["m-2"], from: "project", fell: [] }), `its workers on their cards' models, else this project's list: ${prettyModel("m-2")}`);
  });
});

describe("the page's list of teams beside the open chat", () => {
  test("read when the chat changes, once for a burst of the feed, again while one works; a write's row at once; each route", async () => {
    /** @type {[string, string][]} */
    const calls = [];
    /** @type {[Function, number][]} */
    const timers = [];
    let answer = { teams: [row()], main: null };
    const store = createBesideStore({ call: /** @type {any} */ (async (/** @type {string} */ path, /** @type {any} */ o) => (calls.push([path, o?.method || "GET"]), answer)), later: (fn, ms) => (timers.push([fn, ms]), timers.length), clear: () => {} });
    let changes = 0;
    store.onChange(() => changes++);
    store.setChain("c1");
    await settle();
    assert.deepEqual(calls, [["/sessions/c1/beside", "GET"]]);
    assert.deepEqual(store.rows().map((r) => r.id), ["t1"]);
    assert.deepEqual(timers.map(([, ms]) => ms), [15_000], "one works: its end must show even when its event is lost");
    assert.ok(changes >= 2);
    assert.deepEqual(store.knownChat("t1"), { name: "Bug Hunter", main: "c1" }, "Now names a team chat by its team and its main chat");
    store.heard({ type: "beside", main: "c1" });
    store.heard({ type: "beside", main: "c1" });
    store.heard({ type: "beside", main: "other" });
    store.heard({ type: "turn", main: "c1" });
    assert.deepEqual(timers.map(([, ms]) => ms), [15_000, 300], "a burst is one read");
    answer = { teams: [row(DONE)], main: null };
    timers[1][0]();
    await settle();
    assert.equal(store.row("t1")?.state, "done");
    assert.equal(timers.length, 2, "none works: no resync");
    store.put(row({ id: "t2" }));
    assert.deepEqual(store.rows().map((r) => r.id), ["t2", "t1"], "the newest first, at once");
    store.put(row({ id: "t3", main: "c9" }));
    assert.equal(store.row("t3"), null, "another chat's row is not this list's");
    store.setChain("c2");
    assert.deepEqual([store.rows(), store.main()], [[], null], "a new chat starts empty");
    /** @type {any[]} */
    const sent = [];
    const routes = besideRoutes("c 1", /** @type {any} */ (async (/** @type {string} */ path, /** @type {any} */ o) => sent.push([path, o?.method || "GET", o?.body])));
    await routes.fire({ team: "bug-hunter", ask: "x", most: 6 });
    await routes.reads("bug-hunter", "m 1");
    await routes.reads("bug-hunter", "", true);
    await routes.runsOn("bug-hunter", { workers: "m-2" });
    await routes.set("t 1", { notify: true });
    await routes.notify("t1");
    await routes.verifyAsk("t1");
    await routes.stop("t1");
    assert.deepEqual(sent, [
      ["/sessions/c%201/beside", "POST", { team: "bug-hunter", ask: "x", most: 6 }],
      ["/sessions/c%201/beside/reads?team=bug-hunter&model=m+1", "GET", undefined],
      ["/sessions/c%201/beside/reads?team=bug-hunter&whole=1", "GET", undefined],
      ["/sessions/c%201/beside/runs-on?team=bug-hunter&workers=m-2", "GET", undefined],
      ["/sessions/c%201/beside/t%201", "PATCH", { notify: true }],
      ["/sessions/c%201/beside/t1/notify", "POST", {}],
      ["/sessions/c%201/beside/t1/verify", "GET", undefined],
      ["/sessions/c%201/beside/t1/stop", "POST", {}],
    ]);
  });

  // (fails before: yes — the owner's words of 10-19: a team's own chat showed its workers another way than its main chat)
  test("a team's own chat: the store holds its own row, takes a press's answer for it, and reads again when its main chat's teams move", async () => {
    /** @type {[Function, number][]} */
    const timers = [];
    /** @type {any} */
    let answer = { teams: [], main: "c0", self: row({ id: "c1", main: "c0" }) };
    const store = createBesideStore({ call: /** @type {any} */ (async () => answer), later: (fn, ms) => (timers.push([fn, ms]), timers.length), clear: () => {} });
    store.setChain("c1");
    await settle();
    assert.deepEqual([store.main(), store.self()?.id, store.rows()], ["c0", "c1", []]);
    assert.deepEqual(store.knownChat("c1"), { name: "Bug Hunter", main: "c0" });
    assert.deepEqual(timers.map(([, ms]) => ms), [15_000], "it works: read again until its end shows");
    store.put(row({ id: "c1", main: "c0", ...DONE }));
    assert.deepEqual([store.self()?.state, store.rows()], ["done", []], "a press's answer: its own row, not a team beside it");
    store.heard({ type: "beside", main: "c0" });
    assert.deepEqual(timers.map(([, ms]) => ms), [15_000, 300], "its main chat's teams moved: read again");
    answer = { teams: [], main: null, self: null };
    store.setChain("c2");
    assert.equal(store.self(), null, "another chat starts without it");
  });
});

describe("the Teams tab's teams on the side of this chat", () => {
  /** @param {{ rows?: any[], main?: (() => string | null), self?: () => any, board?: any }} [o] */
  const make = (o = {}) => {
    const rec = { briefs: /** @type {any[]} */ ([]), sets: /** @type {any[]} */ ([]), notes: /** @type {string[]} */ ([]), verifies: /** @type {string[]} */ ([]), stops: /** @type {string[]} */ ([]), opens: /** @type {string[]} */ ([]), resumes: /** @type {string[]} */ ([]), mains: 0 };
    let rows = o.rows || [];
    const io = {
      rows: () => rows,
      brief: (/** @type {any} */ fill) => { rec.briefs.push(fill ?? null); },
      set: (/** @type {string} */ id, /** @type {any} */ p) => { rec.sets.push([id, p]); },
      notify: (/** @type {string} */ id) => { rec.notes.push(id); },
      verify: (/** @type {string} */ id) => { rec.verifies.push(id); },
      stop: (/** @type {string} */ id) => { rec.stops.push(id); },
      open: (/** @type {string} */ id) => { rec.opens.push(id); },
      resume: (/** @type {string} */ id) => { rec.resumes.push(id); },
      ...(o.main ? { main: o.main, openMain: () => { rec.mains++; } } : {}),
      ...(o.self ? { self: o.self } : {}),
      ...(o.board ? { board: o.board } : {}),
      now: () => NOW,
    };
    const v = createBesideView(io, { h: fakeH, place, drawIn: fakeDrawIn });
    v.paint({ chainId: "c1" });
    return { v, rec, setRows: (/** @type {any[]} */ r) => { rows = r; } };
  };

  // (§10 O1: the fire card is gone — a team starts from its Brief, views/brief.js, tested in test/brief.test.js)
  test("Send a team… opens the Brief and starts nothing; with no team out, the section is its head alone", () => {
    const { v, rec } = make();
    assert.match(textOf(v.el), /^On the side\|+Teams working next to this chat: your agent keeps going, and nothing they find reaches it unless you send it\.\|Send a team…$/);
    assert.equal(one(v.el, "bes-grid"), undefined);
    /** @type {any} */ (btn(v.el, "Send a team…")).dispatch("click");
    assert.deepEqual(rec.briefs, [null], "the Brief, opened on its first team; one press never starts");
    assert.equal(one(v.el, "bes-fire"), undefined, "no fire card of its own");
  });

  // (fails before: yes — a model the team named that could not run was passed over in silence: its lead took the chat's)
  test("a card says what its team runs on, and each model it names that cannot run with why", () => {
    const { v } = make({ rows: [row({ on: { lead: "m-1", workers: null, from: "seats", fell: [{ name: "GLM 5.3 Flash", why: "no provider serves it", as: "workers" }] } })] });
    const card = cardOf(v.el, "t1");
    assert.equal(textOf(one(card, "bes-card-on")), `its lead on ${prettyModel("m-1")} · its workers on their cards' models, else its lead's model`);
    assert.equal(textOf(all(card, (x) => String(x.attrs?.class).includes("is-warn"))[0]), "GLM 5.3 Flash cannot run now (no provider serves it): its workers run on their cards' models, else its lead's model");
  });

  test("a card per team, the newest first: its state, its switches while it works, and each hand-off a press; painted in place", () => {
    const { v, rec, setRows } = make({ rows: [row(), row({ id: "t2", ...DONE }), row({ id: "t3", state: "stopped", cut: true, workers: { running: 0, waiting: 0, total: 0 } })] });
    setRows([row(), row({ id: "t2", ...DONE }), row({ id: "t3", state: "stopped", cut: true, workers: { running: 0, waiting: 0, total: 0 } })]);
    v.paint({ chainId: "c1" });
    assert.equal(textOf(one(v.el, "tv-h")), "On the side|1 at work");
    const work = cardOf(v.el, "t1");
    assert.equal(textOf(one(work, "bes-card-name")), "Bug Hunter|On the side");
    assert.equal(textOf(one(work, "bes-card-by")), "sent by you · 5 min ago");
    assert.equal(textOf(one(work, "bes-card-on")), `its lead on ${prettyModel("m-1")} · its workers on ${prettyModel("m-2")}`, "what it runs on, on its card");
    assert.equal(textOf(one(work, "tg-badge")), "At work");
    assert.equal(textOf(one(work, "bes-card-state")), "2 at work · 1 waits for a slot");
    /** @type {any} */ (switchOf(work, "Check it with BugHunters first")).dispatch("click");
    /** @type {any} */ (switchOf(work, "Hand its result to your agent")).dispatch("click");
    /** @type {any} */ (btn(work, "Stop")).dispatch("click");
    /** @type {any} */ (btn(work, "Open its chat")).dispatch("click");
    assert.deepEqual([rec.sets, rec.stops, rec.opens], [[["t1", { verify: true }], ["t1", { notify: true }]], ["t1"], ["t1"]]);
    const done = cardOf(v.el, "t2");
    assert.equal(textOf(one(done, "bes-result-text")), "Found: parse.js:3 reads a field of null.");
    assert.deepEqual(buttonsOf(one(done, "bes-card-foot")).map(textOf), ["Send to your agent…", "Verify, then send…", "Ask its lead"]);
    assert.equal(textOf(one(done, "bes-seen")), "your agent has not seen it");
    assert.equal(one(done, "bes-card-switches"), undefined, "its switches went with its work");
    /** @type {any} */ (btn(done, "Send to your agent…")).dispatch("click");
    /** @type {any} */ (btn(done, "Verify, then send…")).dispatch("click");
    assert.deepEqual([rec.notes, rec.verifies, rec.briefs], [["t2"], ["t2"], []], "Verify, then send… is the host's: it opens BugHunters' Brief, filled");
    /** @type {any} */ (btn(cardOf(v.el, "t3"), "Resume…")).dispatch("click");
    assert.deepEqual(rec.resumes, ["t3"]);
    // Drawn again with nothing changed: the same card, not a new one.
    v.paint({ chainId: "c1" });
    assert.equal(cardOf(v.el, "t1"), work);
    // BugHunters' own card offers no check of itself.
    setRows([row({ id: "t4", team: { key: "bughunters", name: "BugHunters" }, checked: true, of: "t2" }), row({ id: "t2", ...DONE, verifiedBy: "t4" })]);
    v.paint({ chainId: "c1" });
    const check = cardOf(v.el, "t4");
    assert.equal(switchOf(check, "Check it with BugHunters first"), undefined);
    assert.match(textOf(one(check, "bes-card-by")), /checks the Bug Hunter's result$/);
    // (§10 O3) Its result went to BugHunters' check: it folds to a row, which opens again into its card.
    const folded = cardOf(v.el, "t2");
    assert.equal(folded.attrs.class, "bes-row is-done");
    assert.match(textOf(folded), /^Bug Hunter\|Done · BugHunters checks it · just now\|Ask its lead$/, "when its result came");
    /** @type {any} */ (all(folded, (x) => x.attrs?.["aria-label"] === "Unfold the Bug Hunter team's card")[0]).dispatch("click");
    assert.equal(textOf(one(cardOf(v.el, "t2"), "bes-card-sent")), "BugHunters checks its result: its card is above");
    /** @type {any} */ (all(cardOf(v.el, "t2"), (x) => x.attrs?.["aria-label"] === "Fold the Bug Hunter team's card")[0]).dispatch("click");
    assert.equal(cardOf(v.el, "t2").attrs.class, "bes-row is-done");
    // (fails before: yes — U13 W3: a team you stopped folded to a row, "It stopped before it had a result", nothing to go
    // on with) Stopped before it finished: its card, with Resume… and Open its chat.
    setRows([row({ id: "t5", state: "stopped", workers: { running: 0, waiting: 0, total: 0 } })]);
    v.paint({ chainId: "c1" });
    const stopped = cardOf(v.el, "t5");
    assert.deepEqual([stopped.attrs.class, textOf(one(stopped, "bes-card-state")), buttonsOf(one(stopped, "bes-card-foot")).map(textOf)],
      ["bes-card is-stopped", "Stopped before it finished", ["Resume…", "Open its chat"]]);
    /** @type {any} */ (btn(stopped, "Resume…")).dispatch("click");
    assert.deepEqual(rec.resumes, ["t3", "t5"]);
  });

  test("a team's own chat says whose it is and sends none", () => {
    const { v, rec } = make({ main: () => "c0" });
    assert.match(textOf(v.el), /^This team works on the side of another chat\|/);
    assert.equal(btn(v.el, "Send a team…"), undefined);
    assert.equal(v.isTeamChat(), true);
    /** @type {any} */ (btn(v.el, "Open the main chat")).dispatch("click");
    assert.equal(rec.mains, 1);
  });

  // (fails before: yes — the owner's words of 10-19: the hunter's own chat showed its workers another way than its main
  // chat's board, "if i went on the left side bar and clicked the running hunter and then went into team page then i
  // would see different activity")
  test("a team's own chat shows itself as its main chat does: its board while it works, its card once done, the hand-offs left to the main chat", () => {
    const board = { rows: () => [], known: () => true, lead: () => null, set: () => {}, stop: () => {}, open: () => {}, here: (/** @type {string} */ tid) => tid === "c1", openWorker: () => {}, answer: async () => true, always: async () => true };
    let me = row({ id: "c1", main: "c0" });
    const { v } = make({ main: () => "c0", self: () => me, board });
    v.paint({ chainId: "c1" });
    const live = all(v.el, (x) => x.attrs?.["data-board"] === "c1")[0];
    assert.ok(live, "its live board, as on its main chat's Teams tab");
    assert.match(textOf(v.el), /^This team works on the side of another chat\|/, "and whose it is, first");
    assert.deepEqual([btn(live, "Open its chat"), btn(live, "Stop") ? "Stop" : undefined], [undefined, "Stop"], "its chat is this one; Stop stays");
    me = row({ id: "c1", main: "c0", ...DONE });
    v.paint({ chainId: "c1" });
    assert.equal(all(v.el, (x) => x.attrs?.["data-board"] === "c1").length, 0);
    const card = cardOf(v.el, "c1");
    assert.ok(card, "its card, once done");
    assert.deepEqual(["Send to your agent…", "Verify, then send…", "Ask its lead"].map((w) => btn(card, w)), [undefined, undefined, undefined], "its result goes on from its main chat's card");
  });
});

describe("the two marks in the main chat's transcript", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => {
    Object.assign(besideActions, { row: null, watch: null, set: null, notify: null, verify: null, open: null, openResult: null });
    doc.restore();
  });

  test("where it was fired — who fired it, its state, its switches while it works — and where its result came, with its hand-offs; each follows the list", () => {
    /** @type {Map<string, any>} */
    const rows = new Map([["t1", row({ firedBy: "agent" })], ["t2", row({ id: "t2", ...DONE })]]);
    /** @type {Set<() => void>} */
    const watchers = new Set();
    /** @type {any[]} */
    const did = [];
    Object.assign(besideActions, {
      row: (/** @type {string} */ id) => rows.get(id) || null,
      watch: (/** @type {() => void} */ fn) => (watchers.add(fn), () => watchers.delete(fn)),
      set: (/** @type {string} */ id, /** @type {any} */ p) => did.push(["set", id, p]),
      notify: (/** @type {string} */ id) => did.push(["notify", id]),
      verify: (/** @type {string} */ id) => did.push(["verify", id]),
      open: (/** @type {string} */ id) => did.push(["open", id]),
    });
    const fired = /** @type {any} */ (besideMarkRow({ type: "team", event: "fired", id: "t1", at: NOW, afterTurn: 1 }));
    assert.equal(fired.className, "tool-note bes-mark is-fired");
    // (§10 O3) Who sent which team, and that the agent never reads the mark.
    assert.match(fired.textContent, /^Your agent sent the Bug Hunter team on the sideonly on your page — your agent can't see this“find bugs in the parser”At work 2 at work · 1 waits for a slot/);
    const flip = fired.querySelectorAll("button").find((/** @type {any} */ b) => b.getAttribute("aria-label") === "Hand its result to your agent");
    flip.dispatch("click");
    const result = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t2", at: NOW, afterTurn: 1 }));
    assert.equal(result.textContent, "Bug Hunter's resultonly on your page — your agent can't see thisFound: parse.js:3 reads a field of null.Send to your agent…Verify, then send…Ask its leadyour agent has not seen it");
    const press = (/** @type {any} */ el, /** @type {string} */ words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words).dispatch("click");
    press(result, "Send to your agent…");
    press(result, "Verify, then send…");
    press(result, "Ask its lead");
    assert.deepEqual(did, [["set", "t1", { notify: true }], ["notify", "t2"], ["verify", "t2"], ["open", "t2"]]);
    // The list moves: each mark is drawn again from it.
    rows.set("t2", row({ id: "t2", ...DONE, notified: { n: 1, at: NOW, how: "sent" } }));
    rows.set("t1", row({ firedBy: "agent", ...DONE }));
    for (const fn of watchers) fn();
    assert.ok(result.textContent.includes("Sent to your agent") && !result.textContent.includes("Send to your agent"), "once per result");
    assert.equal(fired.querySelectorAll("button").filter((/** @type {any} */ b) => b.getAttribute("role") === "switch").length, 0, "its switches went with its work");
    // A team the page knows no more leaves its line alone.
    rows.clear();
    for (const fn of watchers) fn();
    assert.equal(result.textContent, "A team on the side of this chat finished");
    assert.equal(fired.textContent, "A team was sent on the side of this chat");
  });

  test("each card folds to its head line, as this browser keeps it; a long ask shows three lines until Show all (the owner's ask of 10-23)", () => {
    const g = /** @type {any} */ (globalThis);
    /** @type {Map<string, string>} */
    const kept = new Map();
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v) };
    try {
      const long = `Check what the Bug Hunter team found. ${"Every finding below comes with its place. ".repeat(12)}`;
      assert.ok(long.length > LONG_ASK);
      /** @type {Map<string, any>} */
      const rows = new Map([["t1", row({ ask: long })], ["t2", row({ id: "t2", ...DONE })], ["t3", row({ id: "t3" })]]);
      Object.assign(besideActions, { row: (/** @type {string} */ id) => rows.get(id) || null, watch: () => () => {}, set: () => {}, open: () => {} });
      const fired = /** @type {any} */ (besideMarkRow({ type: "team", event: "fired", id: "t1", at: NOW, afterTurn: 1 }));
      const btn = (/** @type {any} */ el, /** @type {string} */ label) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.getAttribute("aria-label") === label || b.textContent === label);
      const text = fired.querySelectorAll("div").find((/** @type {any} */ d) => d.classList.contains("bes-mark-text"));
      assert.equal(text.classList.contains("is-clamped"), true, "three lines of a long ask");
      btn(fired, "Show all").dispatch("click");
      assert.equal(fired.querySelectorAll("div").find((/** @type {any} */ d) => d.classList.contains("bes-mark-text")).classList.contains("is-clamped"), false);
      assert.ok(btn(fired, "Show less"), "and back");
      // A short ask is never cut.
      const short = /** @type {any} */ (besideMarkRow({ type: "team", event: "fired", id: "t3", at: NOW, afterTurn: 1 }));
      assert.equal(short.querySelectorAll("div").find((/** @type {any} */ d) => d.classList.contains("bes-mark-text")).classList.contains("is-clamped"), false);
      assert.equal(btn(short, "Show all"), undefined);
      // Folded: its head line alone — who sent which team, its state, Open — and the fold opens it again.
      btn(fired, "Fold this card to its head line").dispatch("click");
      assert.equal(fired.classList.contains("is-folded"), true);
      assert.equal(fired.textContent, "You sent the Bug Hunter team on the sideAt workonly on your page — your agent can't see thisOpen");
      assert.equal(btn(fired, "Show the whole card").getAttribute("aria-expanded"), "false");
      // This browser keeps it: the same card drawn again — the transcript painted anew — stands folded.
      assert.deepEqual(JSON.parse(String(kept.get("filament.harness.foldedMarks"))), ["fired:t1"]);
      const again = /** @type {any} */ (besideMarkRow({ type: "team", event: "fired", id: "t1", at: NOW, afterTurn: 1 }));
      assert.equal(again.classList.contains("is-folded"), true);
      btn(again, "Show the whole card").dispatch("click");
      assert.equal(again.classList.contains("is-folded"), false);
      assert.deepEqual(JSON.parse(String(kept.get("filament.harness.foldedMarks"))), []);
      // A result's card folds to whose result, its counts, and whether your agent saw it.
      const result = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t2", at: NOW, afterTurn: 1 }));
      btn(result, "Fold this card to its head line").dispatch("click");
      assert.equal(result.textContent, "Bug Hunter's resultonly on your page — your agent can't see thisyour agent has not seen it");
      // One its switch could not hand on says what was tried and why on its head line too, and names no button: the
      // fold shows none. (fails before: yes — it said "your agent has not seen it" alone)
      rows.set("t2", row({ id: "t2", ...DONE, notify: true, missed: "Filament stopped before it could go" }));
      const lost = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t2", at: NOW, afterTurn: 1 }));
      assert.equal(lost.classList.contains("is-folded"), true, "kept folded by this browser");
      const sent = lost.querySelector(".bes-mark-sent");
      assert.deepEqual([sent.className, sent.textContent], ["bes-mark-sent is-folded is-missed", "Filament tried to hand it to your agent when the team ended and could not (Filament stopped before it could go): your agent has not seen it"]);
    } finally {
      delete g.localStorage;
    }
  });
});
