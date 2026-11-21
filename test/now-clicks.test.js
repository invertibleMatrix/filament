// @ts-check
// Now, in the left bar (now-list.js): a team's workers folded under its lead open their own threads, and the row of the
// chat open now is marked (the owner's word of 10-22: a press on Now marked nothing where they pressed, and a worker's
// line under its lead did nothing). The bar's own Now decides where its chats stand: here or under their project, never
// both (the Designer's of 10-27, on the owner's words: "two same things showing at the same time is not a good design").
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
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

/** Now over a fake Filament: the Bug Hunter's chat, its lead at work with two hunters, and another chat at work. @param {{ current: string | null }} open */
async function teamNow(open) {
  const t = Date.now();
  const runs = [
    { id: "r1", kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events: 1, meta: { chain: "team1", model: "opus" } },
    { id: "s1", kind: "subagent", status: "running", startedAt: t - 30_000, endedAt: null, events: 1, meta: { chain: "team1" } },
    { id: "r2", kind: "agent-turn", status: "running", startedAt: t - 90_000, endedAt: null, events: 1, meta: { chain: "c2", model: "opus" } },
  ];
  /** @param {string} id @param {string} task */
  const hunter = (id, task) => ({ id, origin: "agent", status: "running", team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter" }, card: { tag: "hunter", name: "Hunter" }, description: task, exchanges: [{ description: task, startedAt: t - 20_000, endedAt: null }], startedAt: t - 20_000, progress: {} });
  /** @param {string} p */
  const call = async (p) => (p.startsWith("/sessions/team1/subagents") ? { subagents: [hunter("sa_1", "Hunt the parser"), hunter("sa_2", "Hunt the store")] } : { events: [] });
  /** @type {Record<string, any>} */
  const chats = { team1: { title: "Bug Hunter · beside opus55", project: "filament", when: t, unread: false }, c2: { title: "Release notes", project: "site", when: t, unread: false } };
  /** @type {[string, string | null][]} */
  const opened = [];
  const now = createNow({ h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(), onOpen: (r) => void opened.push([r.chain, r.thread]), onSeen: () => {}, current: () => open.current,
    ...("marked" in open ? { marked: () => /** @type {any} */ (open).marked } : {}) });
  await now.update(/** @type {any} */ (runs));
  return { now, opened };
}

// (fails before: yes — a worker's line under its lead was no button: a press did nothing)
test("a team's worker under its lead opens its own thread, by a press or Enter", async () => {
  const { now, opened } = await teamNow({ current: null });
  const lines = every(now.el, "now-under");
  // Each worker by its seat's name, else its card's (lib/team.js `workerCalled`).
  assert.deepEqual(lines.map((l) => [textOf(l.kids[1]), l.attrs.role, l.attrs.title]), [
    ["Hunter · Hunt the parser", "button", "Open its thread: Hunter · Hunt the parser"],
    ["Hunter · Hunt the store", "button", "Open its thread: Hunter · Hunt the store"],
  ]);
  lines[0].dispatch("click");
  lines[1].dispatch("keydown", { key: "Enter" });
  assert.deepEqual(opened, [["team1", "sa_1"], ["team1", "sa_2"]], "each its thread, in its team's chat");
  every(now.el, "now-row")[0].dispatch("click");
  assert.deepEqual(opened.at(-1), ["team1", null], "the lead's row opens its chat, as before");
});

// (fails before: yes — the open chat was marked under Projects only)
test("the row of the chat open now is marked, and the mark follows the chat", async () => {
  const open = { current: /** @type {string | null} */ (null) };
  const { now } = await teamNow(open);
  const marks = () => every(now.el, "now-row").map((r) => [textOf(r).split("|")[0], r.attrs.class.includes("is-current"), r.attrs["aria-current"] ?? null]);
  // A team in charge keeps its chat's title on the row (the Designer's of 10-27).
  assert.deepEqual(marks(), [["Bug Hunter · beside opus55", false, null], ["Release notes", false, null]]);
  open.current = "team1";
  now.refresh();
  assert.deepEqual(marks(), [["Bug Hunter · beside opus55", true, "page"], ["Release notes", false, null]]);
  open.current = "c2";
  now.refresh();
  assert.deepEqual(marks(), [["Bug Hunter · beside opus55", false, null], ["Release notes", true, "page"]], "drawn again when only the open chat moved");
});

// (fails before: yes — the reviewer of the Designer's walk fixes, 10-29: with a Space on screen, the chat behind it stayed
// marked in Now, though the bar's other rows were not)
test("the mark is the page's: a chat open behind a Space is not marked in Now, and is again once the Space is left", async () => {
  const open = { current: /** @type {string | null} */ ("c2"), marked: /** @type {string | null} */ (null) };
  const { now } = await teamNow(open);
  const marked = () => every(now.el, "now-row").filter((r) => r.attrs.class.includes("is-current")).map((r) => textOf(r).split("|")[0]);
  assert.deepEqual(marked(), [], "a Space on screen: no chat marked");
  open.marked = "c2";
  now.refresh();
  assert.deepEqual(marked(), ["Release notes"]);
});

// (fails before: yes — the owner's words of 10-26: a failed agent of the main agent's was said nowhere outside its chat,
// and a chat's threads were read only while a run of theirs stood in the runs list)
test("a failed agent of the main agent's needs you until seen, read on after its run left the list; a press opens its thread", async () => {
  const t = Date.now();
  const failed = { id: "f1", origin: "agent", status: "failed", card: { tag: "helper", name: "Helper" }, description: "Check the tests", startedAt: t - 90_000, progress: null, exchanges: [{ description: "Check the tests", startedAt: t - 90_000, endedAt: t - 30_000, outcome: { report: "", stoppedBy: null, failure: { said: "the connection was reset" } } }] };
  /** @param {string} p */
  const call = async (p) => (p.startsWith("/sessions/c1/subagents") ? { subagents: [failed] } : { events: [] });
  const seen = new Set();
  /** @type {[string, string | null][]} */
  const opened = [];
  const now = createNow({ h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: (c) => (c === "c1" ? { title: "Fix the rail", project: "filament", when: t, unread: false } : null), unread: () => new Set(), holders: () => new Map(), onOpen: (r) => void opened.push([r.chain, r.thread]), onSeen: () => {}, seen: (r) => seen.has(r.id) });
  await now.update(/** @type {any} */ ([{ id: "s1", kind: "subagent", status: "failed", startedAt: t - 90_000, endedAt: t - 30_000, events: 1, meta: { chain: "c1" } }]));
  const row = () => every(now.el, "now-row").find((r) => String(r.attrs.class).includes("is-needs"));
  assert.equal(now.needs, 1);
  assert.match(textOf(row()), /^Helper · for Fix the rail\|filament\|failed: the connection was reset\|1m$/);
  row().attrs.onclick();
  assert.deepEqual(opened, [["c1", "f1"]]);
  // Its run gone from the list: the chat's threads are kept, read on its quiet half minute, and it still needs you.
  await now.update([]);
  assert.equal(now.needs, 1);
  // Seen in the Agents tab: it goes, and with no run of the chat's in the list its threads are let go.
  seen.add("f1");
  now.refresh();
  assert.equal(now.needs, 0);
  await now.update([]);
  seen.clear();
  now.refresh();
  assert.equal(now.needs, 0, "its threads let go: nothing of it is left to show");
});

// (fails before: yes — the owner's words of 10-27: a working chat stood in Now and under its project, selected in both)
test("the bar's own Now: a working chat stands here, not while the pointer holds the bar; its turn over it stays while open, then its quiet minute; folded, none", async () => {
  const t = Date.now();
  const running = { id: "r1", kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } };
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the rail", project: "filament", when: t, unread: false } };
  const bar = { held: 0, current: /** @type {string | null} */ ("c1"), moved: 0, menus: /** @type {string[]} */ ([]) };
  const now = createNow({
    h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    onOpen: () => {}, onSeen: () => {}, current: () => bar.current,
    place: true, held: () => bar.held, onMoved: () => { bar.moved++; }, onMenu: (r) => void bar.menus.push(r.chain),
  });
  const rows = () => every(now.el, "now-row");
  bar.held = Date.now() + 10_000;
  await now.update(/** @type {any} */ ([running]));
  assert.deepEqual([now.stands("c1"), rows().length, now.works, bar.moved], [false, 0, 1, 0], "held: it waits under its project, though Now counts it");
  bar.held = 0;
  now.refresh();
  assert.deepEqual([now.stands("c1"), rows().map((r) => r.attrs["data-chain"]), bar.moved], [true, ["c1"], 1], "the hold over, it stands here and the bar is told");
  rows()[0].dispatch("contextmenu");
  assert.deepEqual(bar.menus, ["c1"], "its row carries the chat's menu");
  await now.update(/** @type {any} */ ([{ ...running, status: "done", endedAt: Date.now() }]));
  assert.deepEqual([now.stands("c1"), rows().map((r) => r.attrs.class.includes("is-stay")), textOf(rows()[0]).split("|").slice(0, 3)], [true, [true], ["Fix the rail", "filament", "finished"]], "its turn over, the chat open stays, under Done, seen");
  bar.current = null;
  now.refresh();
  assert.equal(now.stands("c1"), true, "left, it stays its quiet minute");
  every(now.el, "now-head")[0].attrs.onclick();
  assert.deepEqual([now.stands("c1"), rows().length], [false, 0], "folded, every chat stays home");
  every(now.el, "now-head")[0].attrs.onclick();
  assert.equal(now.stands("c1"), false, "opened again, a quiet chat does not rise by itself");
});

// (fails before: yes — nothing kept which failures were seen)
test("a failure seen is kept by this browser, by its try: one asked again and failed again is new", async () => {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v) };
  try {
    const { failureSeen, markFailureSeen } = await import("../src/ui/harness/lib/failures-seen.js");
    const once = { id: "f1", exchanges: [{}] };
    assert.equal(failureSeen(once), false);
    markFailureSeen(once);
    assert.deepEqual([failureSeen(once), JSON.parse(String(store.get("harness.failuresSeen")))], [true, ["f1:0"]]);
    assert.equal(failureSeen({ id: "f1", exchanges: [{}, {}] }), false, "its second try's failure is new");
  } finally {
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});
