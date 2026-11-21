// @ts-check
// A message a card stopped before it was sent, in the left bar's Now (the owner's of 11-01, on "When the card stops a
// message, Now lists that chat under Done · finished, though nothing was sent"): nothing ran, so nothing finished —
// while its card waits the chat needs you, in the card's words; Not now leaves nothing in Now, so the chat goes home to
// its project; and a tab out of sight says it waits for you, never that the chat completed or failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { lift } from "./helpers/app-lift.js";
import { holdersWhileSent, nowRows } from "../src/ui/harness/lib/now.js";
import { createNow } from "../src/ui/harness/now-list.js";
import { askOf, askQuestion, withoutAsked } from "../src/ui/harness/conversation/interaction.js";
import { stoppedToAsk } from "../src/ui/harness/conversation/history.js";
import { againOf } from "../src/ui/harness/lib/labels.js";

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
const ASKED = "Make room before this message?";
/** A send the server stopped to ask for room: the page's turn as its reply leaves it. @param {any} [more] */
const stopped = (more = {}) => ({ n: 2, userText: "Fix the linker", status: "error", reply: { error: "This chat is past your 17K line", errorBody: { needsCompaction: true, why: "past the line", sentTokens: 21_440, usable: 17_000, window: 20_000 } }, askedAt: 1_000, ...more });

// (fails before: yes — the chat's newest run said finished, and it stood under Done)
test("Now's rows: a chat whose message a card stopped needs you, in the card's words, whatever its newest run says", () => {
  const t = Date.now();
  const g = nowRows({
    runs: /** @type {any} */ ([{ id: "r1", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 50_000, events: 1, meta: { chain: "c1", model: "opus" } }]),
    folds: new Map(), threads: new Map(), holders: new Map(), now: t,
    chats: () => ({ title: "Fix the linker", project: "app", when: t, unread: true }),
    unread: new Set(["c1"]),
    asked: new Map([["c1", { line: ASKED, at: t - 5_000 }]]),
  });
  assert.deepEqual(g.needs.map((r) => [r.key, r.fact, r.tone, r.tile, r.at]), [["chat:c1", `asks: ${ASKED}`, "asks", "needs", t - 5_000]]);
  assert.deepEqual([g.works.length, g.done.length], [0, 0], "neither at work nor finished");
});

// (fails before: yes — the open chat stayed under Done, "finished", and nothing could send it home)
test("the bar's own Now: a send under way, then its card, then Not now — at work, needs you, then home", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the linker", project: "app", when: t, unread: false } };
  const bar = { current: "c1", holders: /** @type {Map<string, any>} */ (new Map([["c1", { since: t }]])), asked: /** @type {Map<string, any>} */ (new Map()) };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => bar.holders,
    asked: () => bar.asked, onOpen: () => {}, onSeen: () => {}, current: () => bar.current, place: true, held: () => 0, onMoved: () => {},
  });
  const rows = () => every(now.el, "now-row");
  await now.update([]);
  assert.deepEqual([now.stands("c1"), now.works], [true, 1], "the send under way: at work");
  // The server stopped it to ask: nothing holds the chat, and its card waits.
  bar.holders = new Map();
  bar.asked = new Map([["c1", { line: ASKED, at: t }]]);
  now.refresh();
  assert.deepEqual([now.stands("c1"), now.needs, now.works], [true, 1, 0]);
  assert.deepEqual(textOf(rows()[0]).split("|").slice(0, 3), ["Fix the linker", "app", `asks: ${ASKED}`], "the card's question, never finished");
  // Not now: the message is back in the box, and nothing of it is left to show — the chat goes home, open or not.
  bar.asked = new Map();
  now.home("c1");
  assert.deepEqual([now.stands("c1"), rows().length, now.needs], [false, 0, 0], "home to its project");
});

// (fails before: yes — there was no such list: Now never heard of a card)
test("the page's chats whose message a card stopped: each with its card's question and when it stopped", () => {
  const size = { chainId: "c1", turns: [{ n: 1, status: "done", reply: { text: "ok" } }, stopped()] };
  const switched = { chainId: "c2", turns: [stopped({ askedAt: 2_000, reply: { error: "Switch to Codex?", errorBody: { switchQuestion: { from: {}, to: {} } } } })] };
  const answered = { chainId: "c3", turns: [stopped(), { n: 3, status: "done", reply: { text: "sent as it is" } }] };
  const draft = { chainId: null, turns: [stopped()] };
  const chats = new Map(/** @type {[string, any][]} */ ([["a", size], ["b", switched], ["c", answered], ["d", draft]]));
  const { askedChats } = lift(["askedChats"], { state: { chats }, askOf, askQuestion });
  assert.deepEqual([...askedChats()], [["c1", { line: ASKED, at: 1_000 }], ["c2", { line: "Switch and send?", at: 2_000 }]]);
});

// (fails before: yes — a stopped message ended "error": out of sight it said "Chat error occurred")
test("a turn's end, said out of sight: a message a card stopped waits for your answer", () => {
  const { endWord } = lift(["endWord"], { stoppedToAsk });
  assert.deepEqual(
    [endWord(stopped()), endWord({ status: "error", reply: { error: "upstream 500" } }), endWord({ status: "done" }), endWord({ status: "done", paused: { kind: "question" } }), endWord({ status: "done", paused: { kind: "permission" } })],
    ["question", "error", "done", "question", "paused"],
  );
});

// (fails before: yes — the review of 11-01: the chat read "asks" all the while its Compact and send made room, a minute
// or more, the card itself saying Making room…; and the message gone again stood a moment as finished, before the
// server's word of its turn)
test("Now's rows: room made for a stopped message, and the message gone again, are at work — the server's word first", () => {
  const t = Date.now();
  const rows = (/** @type {Map<string, any>} */ holders, /** @type {Map<string, any>} */ asked) => {
    const g = nowRows({ runs: [], folds: new Map(), threads: new Map(), holders, now: t, chats: () => ({ title: "Fix the linker", project: "app", when: t, unread: false }), unread: new Set(["c1"]), asked });
    return [g.needs, g.works, g.done].map((l) => l.map((r) => r.fact));
  };
  const room = new Map([["c1", { line: "making room", at: t - 1_000, working: true }]]);
  assert.deepEqual(rows(new Map(), room), [[], ["making room"], []], "at work, never finished, whatever the unread mark says");
  assert.deepEqual(rows(new Map([["c1", { label: "the harness", since: t }]]), room), [[], ["the harness is working"], []], "the server's word, once there");
});

// (fails before: yes — the drive of 11-01: in a chat with a turn finished before, Compact and send read "finished" all
// the while it made room — that turn's run claimed the chat, so neither the page's word nor the server's could stand)
test("Now's rows: a chat whose newest turn is over and read says nothing of its own — the page's word, and the server's, stand", () => {
  const t = Date.now();
  const over = { id: "r2", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 50_000, events: 1, meta: { chain: "c1", model: "opus" } };
  const older = { id: "r1", kind: "agent-turn", status: "paused", startedAt: t - 90_000, events: 1, meta: { chain: "c1", model: "opus" } };
  const rows = (/** @type {Map<string, any>} */ holders, /** @type {Map<string, any>} */ asked, unread = new Set()) => {
    const g = nowRows({ runs: /** @type {any} */ ([over, older]), folds: new Map(), threads: new Map(), holders, now: t, chats: () => ({ title: "Fix the linker", project: "app", when: t, unread: false }), unread, asked });
    return [g.needs, g.works, g.done].map((l) => l.map((r) => r.fact));
  };
  assert.deepEqual(rows(new Map(), new Map([["c1", { line: "making room", at: t - 1_000, working: true }]])), [[], ["making room"], []], "room made for its message: at work");
  assert.deepEqual(rows(new Map(), new Map([["c1", { line: "sending", at: t - 1_000, working: true }]])), [[], ["sending"], []], "its message gone again: at work");
  assert.deepEqual(rows(new Map([["c1", { label: "the harness", since: t }]]), new Map()), [[], ["the harness is working"], []], "a send the server holds before the list has its run: at work");
  assert.deepEqual(rows(new Map(), new Map()), [[], [], []], "nothing at work: no row, and a run older than its newest says nothing");
  assert.deepEqual(rows(new Map(), new Map(), new Set(["c1"])), [[], [], ["finished"]], "finished since you looked: Done, as before");
  // (fails before: yes — the review of 11-01: a turn that ended while the page was out of sight left its chat unread, and
  // the chat read "finished" all the while room was made for the message sent after it)
  assert.deepEqual(rows(new Map(), new Map([["c1", { line: "making room", at: t - 1_000, working: true }]]), new Set(["c1"])), [[], ["making room"], []], "room made for a message sent since: at work, unread or not");
});

// (fails before: yes — the review of 11-01: a team on the side's chat, its turn held before the list had it, stood as a
// row of its own, then a minute as finished once the list made it a line under the chat it works for)
test("Now's rows: a team on the side's chat is never a row of its own for a holder — a line under its chat once its turn is listed", () => {
  const t = Date.now();
  const over = { id: "r2", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 50_000, events: 1, meta: { chain: "s1", model: "opus" } };
  const rows = (/** @type {any[]} */ runs) => {
    const g = nowRows({ runs: /** @type {any} */ (runs), folds: new Map(), threads: new Map(), holders: new Map([["s1", { label: "the harness", since: t }]]), now: t, chats: () => ({ title: "Fix the linker", project: "app", when: t, unread: false }), unread: new Set(), beside: (c) => (c === "s1" ? { main: "m1", name: "Methodical" } : null) });
    return [g.needs, g.works, g.done].map((l) => l.map((r) => `${r.chain}: ${r.fact}`));
  };
  assert.deepEqual(rows([over]), [[], [], []], "a turn finished before: nothing until the list has the new one");
  assert.deepEqual(rows([]), [[], [], []], "none listed yet: nothing either");
});

// (fails before: yes — the review of 11-01: a team on the side's chat that had a row of its own — its message room was
// made for — stood under Done as "finished", the chat open, once the list made its running turn a line under its chat)
test("the bar's own Now: a chat drawn as a line under another's row stays nowhere else — never a stay row that says finished", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { m1: { title: "Ship the parser", project: "app", when: t, unread: false }, s1: { title: "Methodical", project: "app", when: t, unread: false } };
  const bar = { asked: /** @type {Map<string, any>} */ (new Map([["s1", { line: "making room", at: t, working: true }]])) };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    asked: () => bar.asked, beside: (c) => (c === "s1" ? { main: "m1", name: "Methodical" } : null),
    onOpen: () => {}, onSeen: () => {}, current: () => "s1", place: true, held: () => 0, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update([]);
  assert.deepEqual(said(), ["Methodical · app · making room"], "room made for its message: a row of its own");
  bar.asked = new Map();
  await now.update(/** @type {any} */ ([{ id: "r1", kind: "agent-turn", status: "running", startedAt: t, endedAt: null, events: 2, meta: { chain: "s1", model: "opus" } }]));
  assert.equal(now.stands("s1"), true, "the chat open stays placed");
  assert.deepEqual(said(), ["Ship the parser · app · 1 team at work"], "its turn listed: a line under its chat's row, and nowhere else");
});

// (fails before: yes — the review of 11-01: where the pointer on the bar kept its chat's row from coming, the team's
// chat stood under Done, "finished", while its team worked)
test("the bar's own Now, held: a team on the side's chat whose line's row waits to come stays under Working, at work", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { m1: { title: "Ship the parser", project: "app", when: t, unread: false }, s1: { title: "Methodical", project: "app", when: t, unread: false } };
  const bar = { asked: /** @type {Map<string, any>} */ (new Map([["s1", { line: "making room", at: t, working: true }]])), held: 0 };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    asked: () => bar.asked, beside: (c) => (c === "s1" ? { main: "m1", name: "Methodical" } : null),
    onOpen: () => {}, onSeen: () => {}, current: () => "s1", place: true, held: () => bar.held, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update([]);
  bar.asked = new Map();
  bar.held = Date.now() + 10_000;
  await now.update(/** @type {any} */ ([{ id: "r1", kind: "agent-turn", status: "running", startedAt: t, endedAt: null, events: 2, meta: { chain: "s1", model: "opus" } }]));
  assert.deepEqual([now.stands("m1"), now.stands("s1")], [false, true], "held: its chat's row waits, the team's chat stays");
  assert.deepEqual(said(), ["Methodical · app · working"], "the team's chat at work, never finished");
  assert.equal(every(now.el, "now-row")[0].attrs["data-chain"], "s1");
  bar.held = 0;
  now.refresh();
  assert.ok(now.stands("m1"), "the hold over, its chat's row comes");
  assert.deepEqual(said(), ["Ship the parser · app · 1 team at work"], "the team's chat a line under it alone");
});

// (fails before: yes — the review of 11-01: a team whose lead's turn is over while its workers work on is a line as
// well, and held, its chat stood under Done, "finished", as they worked)
test("the bar's own Now, held: a team on the side's chat whose workers work on after its lead's turn stays under Working, at work", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { m1: { title: "Ship the parser", project: "app", when: t, unread: false }, s1: { title: "Methodical", project: "app", when: t, unread: false } };
  const bar = { asked: /** @type {Map<string, any>} */ (new Map([["s1", { line: "making room", at: t, working: true }]])), held: 0 };
  const worker = { id: "w1", origin: "agent", status: "running", runId: "sw1", team: { name: "Methodical", role: "worker" }, description: "Write the tests", exchanges: [{ description: "Write the tests", runId: "sw1", startedAt: t - 5_000, endedAt: null }], startedAt: t - 5_000, progress: {} };
  const call = async (/** @type {string} */ p) => (p.startsWith("/sessions/s1/") ? { subagents: [worker] } : p.startsWith("/sessions/") ? { subagents: [] } : { events: [] });
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    asked: () => bar.asked, beside: (c) => (c === "s1" ? { main: "m1", name: "Methodical" } : null),
    onOpen: () => {}, onSeen: () => {}, current: () => "s1", place: true, held: () => bar.held, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update([]);
  bar.asked = new Map();
  bar.held = Date.now() + 10_000;
  await now.update(/** @type {any} */ ([
    { id: "sw1", kind: "subagent", status: "running", startedAt: t - 5_000, endedAt: null, events: 4, meta: { chain: "s1", subagent: "w1" } },
    { id: "r2", kind: "agent-turn", status: "done", startedAt: t - 9_000, endedAt: t - 1_000, events: 9, meta: { chain: "s1", model: "opus" } },
  ]));
  assert.deepEqual([now.stands("m1"), now.stands("s1")], [false, true], "held: its chat's row waits, the team's chat stays");
  assert.deepEqual(said(), ["Methodical · app · working"], "its workers at work: the team's chat at work, never finished");
  bar.held = 0;
  now.refresh();
  assert.deepEqual(said(), ["Ship the parser · app · 1 team at work"], "the hold over: a line under its chat's row alone");
});

test("the bar's own Now through Compact and send in a chat with a turn before: needs you, making room, then asks again — never finished", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the linker", project: "app", when: t, unread: false } };
  const bar = { asked: /** @type {Map<string, any>} */ (new Map([["c1", { line: ASKED, at: t }]])) };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    asked: () => bar.asked, onOpen: () => {}, onSeen: () => {}, current: () => "c1", place: true, held: () => 0, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update(/** @type {any} */ ([{ id: "r1", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 50_000, events: 1, meta: { chain: "c1", model: "opus" } }]));
  assert.deepEqual([now.needs, now.works, said()], [1, 0, [`Fix the linker · app · asks: ${ASKED}`]]);
  bar.asked = new Map([["c1", { line: "making room", at: t, working: true }]]);
  now.refresh();
  assert.deepEqual([now.needs, now.works, said()], [0, 1, ["Fix the linker · app · making room"]], "at work while room is made");
  bar.asked = new Map([["c1", { line: ASKED, at: t + 1 }]]);
  now.refresh();
  assert.deepEqual([now.needs, now.works, said()], [1, 0, [`Fix the linker · app · asks: ${ASKED}`]], "stopped again: its card asks");
});

// (fails before: yes — there was no word of the page at work for a stopped message)
test("the page's chats a card stopped: asking, room made for it, or gone again with its answer on its way", () => {
  const live = { turn: null };
  const making = { chainId: "c1", turns: [stopped({ makingRoom: 5_000 })] };
  const gone = { chainId: "c2", live, turns: [{ n: 2, status: "running", userText: "Fix the linker", again: { at: 6_000, line: "sending" } }] };
  const landed = { chainId: "c3", turns: [{ n: 2, status: "done", reply: { text: "ok" }, again: { at: 6_000, line: "sending" } }] };
  const stoppedAgain = { chainId: "c4", turns: [stopped({ askedAt: 7_000, again: { at: 6_000, line: "making room" } })] };
  const lost = { chainId: "c5", turns: [{ n: 2, status: "error", again: { at: 6_000, line: "sending" } }] };
  const chats = new Map(/** @type {[string, any][]} */ ([["a", making], ["b", gone], ["c", landed], ["d", stoppedAgain], ["e", lost]]));
  const { askedChats } = lift(["askedChats"], { state: { chats }, askOf, askQuestion });
  assert.deepEqual([...askedChats()], [
    ["c1", { line: "making room", at: 5_000, working: true }],
    ["c2", { line: "sending", at: 6_000, working: true }],
    ["c4", { line: ASKED, at: 7_000 }],
  ]);
});

// (fails before: yes — app.js had no compactAndSend: the card's answer marked nothing on the turn)
test("Compact and send: room is made for the turn while the compaction runs; one that could not be made asks again", async () => {
  /** @type {(v: any) => void} */
  let finish = () => {};
  /** @type {string[]} */
  const calls = [];
  const { compactAndSend } = lift(["compactAndSend"], {
    turnRunsIn: () => false, choiceCompaction: () => ({ method: "fold", way: null, once: null }),
    compactSession: () => new Promise((r) => { finish = r; }),
    sendAsked: async (/** @type {any} */ _c, /** @type {any} */ t, /** @type {any} */ o) => (calls.push(`again:${!!o.sendAsIs}:${t.makingRoom > 0}`), true),
    sidebar: { refreshNow: () => void calls.push("now") },
  });
  const chat = { chainId: "c1", turns: [] };
  for (const [made, want] of /** @type {[any, any][]} */ ([["Room was not made: no model. Your message waits here.", "Room was not made: no model. Your message waits here."], [true, true]])) {
    calls.length = 0;
    const turn = stopped();
    const answer = compactAndSend(chat, turn, "fold", null, null);
    assert.ok(turn.makingRoom > 0, "room is made for it");
    assert.deepEqual(calls, ["now"], "Now told at once");
    finish(made);
    assert.equal(await answer, want);
    if (made === true) assert.deepEqual(calls, ["now", "again:true:true"], "made: the message goes again, its mark with it");
    else assert.deepEqual([turn.makingRoom, calls], [0, ["now", "now"]], "not made: the card asks again, and Now says so");
  }
});

// (fails before: yes — the review of 11-01: a resend refused before it took the stopped turn's place — another tab took
// the chat over while room was made, or a turn started there — left the turn making room, and Now said so until a reload)
test("Compact and send: a resend refused before it took the turn's place leaves the turn making room no more", async () => {
  /** @type {string[]} */
  const calls = [];
  /** @type {(v: any) => void} */
  let settle = () => {};
  const chat = { chainId: "c1", turns: /** @type {any[]} */ ([]) };
  const { compactAndSend } = lift(["compactAndSend"], {
    turnRunsIn: () => false, choiceCompaction: () => ({ method: "fold", way: null, once: null }),
    compactSession: async () => true,
    sendAsked: () => new Promise((r) => { settle = r; }),
    sidebar: { refreshNow: () => void calls.push("now") },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const turn = stopped();
  chat.turns = [turn];
  const answer = compactAndSend(chat, turn, "fold", null, null);
  await tick();
  assert.ok(turn.makingRoom > 0, "on its way: room made for it, as Now says until its message goes");
  calls.length = 0;
  // `sendAsked`'s answer is the card's: refused, with why, the card asks again with it.
  settle("Another tab writes this session");
  assert.equal(await answer, "Another tab writes this session");
  assert.deepEqual([turn.makingRoom, calls], [0, ["now"]], "refused, the message where it was: its card's question, and Now says so");
  const gone = stopped();
  chat.turns = [gone];
  const went = compactAndSend(chat, gone, "fold", null, null);
  await tick();
  chat.turns = [{ n: 2, userText: "Fix the linker", again: { at: 1, line: "making room" } }];
  calls.length = 0;
  settle(true);
  assert.equal(await went, true);
  assert.deepEqual(calls, [], "its turn took its place: nothing more to say");
});

// (fails before: yes — a message gone again carried no word of it)
test("a message a card stopped, gone again: its mark says room was made for it, else that it is sending", () => {
  const { againMark } = lift(["againMark"], {});
  const at = Date.now();
  const m = againMark(stopped({ makingRoom: 5_000 }));
  assert.deepEqual([m.line, m.at >= at], ["making room", true]);
  assert.equal(againMark(stopped()).line, "sending");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /\.\.\.\(unasked \? \{ again: againMark\(replaces\) \} : \{\}\),/, "the turn that goes in its place carries it");
  assert.match(app, /onCompact: \(chat, turn, choice, once, carry\) => compactAndSend\(chat, turn, choice, once, carry\),/);
});

// (fails before: yes — the review of 11-01: stopped while the page was out of sight, the chat was marked unread, and
// after Not now Done read it as finished)
test("Not now marks the chat read: nothing ran, so nothing finished since you looked", () => {
  for (const unread of [true, false]) {
    const turn = stopped();
    const chat = { chainId: "c1", turns: [{ n: 1, status: "done" }, turn] };
    /** @type {string[]} */
    const calls = [];
    const { takeBackAsked } = lift(["takeBackAsked"], {
      state: { currentId: "a", unreadChains: new Set(unread ? ["c1"] : []) }, chatOf: () => chat, withoutAsked, againOf,
      composer: { draft: () => "", setDraft() {}, takeBack() {} },
      markRead: (/** @type {any} */ s) => void calls.push(`read:${s.id}`),
      sidebar: { drawOpen() {}, homeChat: (/** @type {string} */ c) => void calls.push(`home:${c}`) },
    });
    takeBackAsked(chat, turn);
    assert.deepEqual(calls, unread ? ["read:c1", "home:c1"] : ["home:c1"]);
  }
});

// (fails before: yes — the chat stayed in Now, open, under Done · finished)
test("Not now sends the chat home: the left bar's Now is told, by the chat's id", () => {
  const turn = stopped();
  const chat = { chainId: "c1", turns: [{ n: 1, status: "done" }, turn] };
  /** @type {string[]} */
  const home = [];
  const { takeBackAsked } = lift(["takeBackAsked"], {
    state: { currentId: "a", unreadChains: new Set() }, chatOf: () => chat, withoutAsked, againOf,
    composer: { draft: () => "", setDraft() {}, takeBack() {} },
    sidebar: { drawOpen() {}, homeChat: (/** @type {string} */ c) => void home.push(c) },
  });
  assert.equal(takeBackAsked(chat, turn), true);
  assert.deepEqual(home, ["c1"]);
});

// (fails before: yes — the drive of 11-01: Not now drew the bar first, where the chat, asked no more, stood as the open
// chat's stay row, "finished", and only then went home — the row flew home saying it finished)
test("Not now sends the chat home before anything draws the bar again", () => {
  const turn = stopped();
  /** @type {string[]} */
  const calls = [];
  const note = (/** @type {string} */ w) => () => void calls.push(w);
  for (const turns of [[turn], [{ n: 1, status: "done" }, turn]]) {
    calls.length = 0;
    const chat = { chainId: "c1", turns };
    const { takeBackAsked } = lift(["takeBackAsked"], {
      state: { currentId: "a", unreadChains: new Set() }, chatOf: () => chat, withoutAsked, againOf,
      composer: { draft: () => "", setDraft() {}, takeBack: note("box") },
      transcript: { dropTurn: note("dropTurn") }, drawChat: note("drawChat"), setTitle: note("title"), paintStatus: note("status"),
      sidebar: { drawOpen: note("drawOpen"), homeChat: (/** @type {string} */ c) => void calls.push(`home:${c}`) },
    });
    assert.equal(takeBackAsked(chat, turn), true);
    assert.equal(calls[0], "home:c1", `first, before ${calls.slice(1).join(", ")}`);
  }
});

// (fails before: yes — the drive of 11-01: the server lets go of the chat as a card stops its message, and the page hears
// that before the card: in between, Now drew the open chat under Done, "finished", for a frame)
test("Now's holders: a chat this page's send waits in keeps the holder read last for it until the answer lands", () => {
  const H = { window: "harness", client: "harness", label: "the harness", since: 1_000, own: null };
  const other = { window: "harness", label: "the harness", since: 2_000 };
  /** @type {Map<string, any>} */
  const kept = new Map();
  const read = (/** @type {Map<string, any>} */ holders, /** @type {string[]} */ sending) => [...holdersWhileSent(holders, sending, kept)];
  assert.deepEqual(read(new Map([["c1", H], ["c3", other]]), ["c1", "c2"]), [["c1", H], ["c3", other]], "the server's word, as it is");
  assert.deepEqual(read(new Map([["c3", other]]), ["c1", "c2"]), [["c3", other], ["c1", H]], "let go while the send waits: held as it was");
  assert.deepEqual(read(new Map(), ["c2"]), [], "the answer landed: the chat is let go, and one never held is never held");
  assert.deepEqual([...kept.keys()], []);
  const same = new Map([["c3", other]]);
  assert.equal(holdersWhileSent(same, [], kept), same, "nothing sent: the server's own map");
});

test("the bar's own Now through a stopped send: at work in the server's words, then needs you — never finished", async () => {
  const t = Date.now();
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the linker", project: "app", when: t, unread: false } };
  const H = { window: "harness", client: "harness", label: "the harness", since: t, own: null };
  const bar = { holders: /** @type {Map<string, any>} */ (new Map([["c1", H]])), sending: ["c1"], asked: /** @type {Map<string, any>} */ (new Map()) };
  /** @type {Map<string, any>} */
  const kept = new Map();
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(),
    holders: () => holdersWhileSent(bar.holders, bar.sending, kept), asked: () => bar.asked,
    onOpen: () => {}, onSeen: () => {}, current: () => "c1", place: true, held: () => 0, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update([]);
  assert.deepEqual([now.works, said()], [1, ["Fix the linker · app · the harness is working"]]);
  // The server let go; the page has not heard the card yet.
  bar.holders = new Map();
  now.refresh();
  assert.deepEqual([now.works, now.needs, said()], [1, 0, ["Fix the linker · app · the harness is working"]], "as it was");
  // The answer lands: the card's question.
  bar.sending = [];
  bar.asked = new Map([["c1", { line: ASKED, at: t }]]);
  now.refresh();
  assert.deepEqual([now.works, now.needs, said()], [0, 1, [`Fix the linker · app · asks: ${ASKED}`]]);
});

test("pins: a stopped send is stamped when it stopped, the sidebar hands Now the page's list, and the end is said by endWord", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(stoppedToAsk\(r\.reply\)\) turn\.askedAt = Date\.now\(\);/);
  assert.match(app, /askedChats: \(\) => askedChats\(\),/);
  assert.match(app, /if \(document\.hidden\) sayEnded\(chat, endWord\(turn\)\);/);
  const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  assert.match(bar, /asked: \(\) => cb\.askedChats\?\.\(\) \|\| new Map\(\),/);
  // The bar's Now reads who holds each chat through the bridge, the page's sends waiting being its chats with a live send.
  assert.match(bar, /holders: \(\) => holdersWhileSent\(state\.holders, sendingChains\(\), keptHolders\),/);
  assert.match(bar, /const sendingChains = \(\) => \[\.\.\.state\.chats\.values\(\)\]\.filter\(\(c\) => c\.live && c\.chainId\)\.map\(\(c\) => String\(c\.chainId\)\);/);
});
