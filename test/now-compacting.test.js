// @ts-check
// A chat being compacted, in the left bar's Now (the owner's of 11-21: "when open a chat and compact this, then it should
// move from project to Working section"): a compaction written between the chat's turns — its Compact, /autofit — is
// work, so the chat stands under Working while it is written, saying so, and goes home as a finished chat does once it
// ends. Not the summary of Filament's copy of a coding agent's chat (C29), which nobody asked for, nor one at a turn's
// line, whose turn says it already.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { lift } from "./helpers/app-lift.js";
import { nowRows } from "../src/ui/harness/lib/now.js";
import { createNow } from "../src/ui/harness/now-list.js";

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
const T = Date.now();
/** A turn of the chat's, over. @param {string} chain @param {any} [more] */
const turnOver = (chain, more = {}) => ({ id: `r-${chain}`, kind: "agent-turn", status: "done", startedAt: T - 60_000, endedAt: T - 50_000, events: 1, meta: { chain, model: "opus" }, ...more });

// (fails before: yes — nothing said a compaction: the chat had no row, and stayed in its project)
test("Now's rows: a chat whose compaction is written between its turns is at work, saying so, its age from the compaction's start", () => {
  const rows = (/** @type {any} */ o) => {
    const g = nowRows({ runs: [], folds: new Map(), threads: new Map(), holders: new Map(), now: T, chats: () => ({ title: "Fix the linker", project: "app", when: T, unread: false }), unread: new Set(), ...o });
    return [g.needs, g.works, g.done].map((l) => l.map((r) => [r.chain, r.fact, r.at]));
  };
  const compacting = new Map([["c1", { at: T - 7_000 }]]);
  assert.deepEqual(rows({ runs: [turnOver("c1")], compacting }), [[], [["c1", "compacting", T - 7_000]], []], "its turn over and read: at work, never finished");
  assert.deepEqual(rows({ runs: [turnOver("c1")] }), [[], [], []], "nothing compacts: no row, as before");
  assert.deepEqual(rows({ runs: [turnOver("c1")], compacting, unread: new Set(["c1"]) }), [[], [["c1", "compacting", T - 7_000]], []], "its turn finished unread: the compaction is what it does now, out of Done");
  assert.deepEqual(rows({ compacting: new Map([["c1", { at: 0 }]]) }), [[], [["c1", "compacting", T]], []], "asked a moment ago, its start not said yet: from now");
});

test("Now's rows: a compaction beside other work says it first on the row at work; one that needs you stays there", () => {
  const rows = (/** @type {any} */ o) => {
    const g = nowRows({ runs: [turnOver("c1")], folds: new Map(), threads: new Map(), holders: new Map(), now: T, chats: () => ({ title: "Fix the linker", project: "app", when: T, unread: false }), unread: new Set(), compacting: new Map([["c1", { at: T - 7_000 }]]), ...o });
    return [g.needs, g.works, g.done].map((l) => l.map((r) => r.fact));
  };
  const cmd = { id: "b1", command: "npm test", startedAt: T - 20_000 };
  const [, works] = rows({ commands: new Map([["c1", [cmd]]]) });
  assert.equal(works.length, 1, "one row");
  assert.match(works[0], /^compacting · /, "the compaction first, then what else works");
  assert.deepEqual(rows({ asked: new Map([["c1", { line: "Make room before this message?", at: T }]]) }), [["asks: Make room before this message?"], [], []], "a card waits for you: it needs you");
});

// (fails before: yes — the chat stayed under its project all the while it was compacted)
test("the bar's own Now: Compact on a chat in its project brings it under Working, and once written it goes home as a finished chat does", async () => {
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the linker", project: "app", when: T, unread: false } };
  const bar = { compacting: /** @type {Map<string, any>} */ (new Map()), current: /** @type {string | null} */ ("c1") };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    compacting: () => bar.compacting, onOpen: () => {}, onSeen: () => {}, current: () => bar.current, place: true, held: () => 0, onMoved: () => {},
  });
  const said = () => every(now.el, "now-row").map((r) => textOf(r).split("|").slice(0, 3).join(" · "));
  await now.update(/** @type {any} */ ([turnOver("c1")]));
  assert.deepEqual([now.stands("c1"), now.works], [false, 0], "home in its project");
  bar.compacting = new Map([["c1", { at: T }]]);
  now.refresh();
  assert.deepEqual([now.stands("c1"), now.works, said()], [true, 1, ["Fix the linker · app · compacting"]], "under Working while it is written");
  bar.compacting = new Map();
  now.refresh();
  assert.deepEqual([now.stands("c1"), now.works, said()], [true, 0, ["Fix the linker · app · finished"]], "written, the chat open: it stays, finished");
  bar.current = null;
  now.home("c1");
  assert.equal(now.stands("c1"), false, "and goes home as any finished chat");
});

// (fails before: yes — app.js had no such list)
test("the page's chats being compacted: the server's word for every chat, and this page's ask before it — not a copy's summary, a turn's line, nor a chat whose turn runs", () => {
  const chats = new Map(/** @type {[string, any][]} */ ([
    ["a", { chainId: "c1" }],
    ["b", { chainId: "c2", live: { turn: null } }],
    ["e", { chainId: "c5", compactAsked: 1 }],
    ["f", { chainId: "c6", compactAsked: 0 }],
    ["g", { chainId: null, compactAsked: 1 }],
  ]));
  const compacting = new Map([
    ["c1", { door: "manual", since: 1_000 }],
    ["c2", { door: "manual", since: 2_000 }],
    ["c3", { door: "copy", since: 3_000 }],
    ["c4", { door: "line", since: 4_000 }],
    ["c7", { door: "autofit", since: 7_000 }],
  ]);
  const state = { chats, compacting };
  const { compactingChats } = lift(["compactingChats"], { state, chatByChain: (/** @type {string} */ id) => [...chats.values()].find((c) => c.chainId === id) || null });
  assert.deepEqual([...compactingChats()], [["c1", { at: 1_000 }], ["c7", { at: 7_000 }], ["c5", { at: 0 }]]);
});

// (fails before: yes — a compaction's start or end told Now nothing)
test("a compaction's start and end tell Now; its progress between does not", () => {
  /** @type {string[]} */
  const calls = [];
  const scope = { state: { compacting: new Map(), currentId: null }, chatOf: () => null, chatByChain: () => null, sidebar: { refreshNow: () => void calls.push("now") } };
  const { noteCompacting } = lift(["noteCompacting", "compactingBetween?", "roomMade?"], scope);
  noteCompacting("c1", { door: "manual", since: 1 });
  noteCompacting("c1", { door: "manual", since: 1, step: "writing" });
  assert.deepEqual(calls, ["now"], "its start, once");
  noteCompacting("c1", null);
  noteCompacting("c1", null);
  assert.deepEqual(calls, ["now", "now"], "its end, once");
});

test("pins: the page hands the bar its chats being compacted, the bar hands them to Now, and Now's rows read them; this page's Compact tells Now", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /compactingChats: \(\) => compactingChats\(\),/);
  const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  assert.match(bar, /compacting: \(\) => cb\.compactingChats\?\.\(\) \|\| new Map\(\),/);
  const list = readFileSync(new URL("../src/ui/harness/now-list.js", import.meta.url), "utf8");
  assert.match(list, /compacting: o\.compacting\?\.\(\) \|\| new Map\(\),/);
  // Asked and answered: the server's first word comes after the claim, so Now hears this page's ask at once, and its end.
  const ask = app.slice(app.indexOf("\nasync function compactNow("), app.indexOf("\nasync function compactAsk("));
  assert.equal(ask.match(/sidebar\.refreshNow\(\);/g)?.length, 2);
});
