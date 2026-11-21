// The chats the page lets go of (lib/release.js; the bench of 10-25: every chat opened stayed in `state.chats` with its
// transcript whole, and the page's heap only grew). The open chat and the four shown last stay; an older one goes once
// nothing of it lives only in the page, and opens again as it was left: its view and its cards opened. A chat deleted
// here goes at once; and a shown chat's reads (the bug hunt of 10-30): a failed catch-up reads again, the find bar
// closes as another chat is drawn, and an older read landing last draws nothing over a newer one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEEP_SHOWN, chatsToLet, keptOf, letGoable, noteUnseenTurn, readSince, readsOnShow } from "../src/ui/harness/lib/release.js";
import { lift } from "./helpers/app-lift.js";
import { transcriptTurns, withReadWork, mergedTurns, newestOnRecord } from "../src/ui/harness/conversation/history.js";
import { withReadRuns } from "../src/ui/harness/lib/turn-reads.js";
import { transcriptWhole, writtenSince } from "../src/ui/harness/lib/transcript-since.js";

const tick = () => new Promise((r) => setImmediate(r));

/** A chat of the archive's, shown at `at`. @param {string} id @param {number} at @param {Record<string, any>} [more] */
const chat = (id, at, more = {}) => ({ id, chainId: `s-${id}`, shownAt: at, turns: [], ...more });
const known = (/** @type {any[]} */ chats) => new Set(chats.map((c) => String(c.chainId)));

// (fails before: yes — nothing let a chat go; `chatsToLet` did not exist)
test("past the open chat and the four shown last, a chat of the archive's that holds nothing of the page's goes", () => {
  const chats = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => chat(id, 100 + i));
  assert.equal(KEEP_SHOWN, 4);
  // g is open; f, e, d, c are the four shown last; b and a go.
  assert.deepEqual(chatsToLet(chats, { current: "g", known: known(chats) }).sort(), ["a", "b"]);
  // The open chat is never let go, however long ago it was shown.
  assert.deepEqual(chatsToLet(chats, { current: "a", known: known(chats) }).sort(), ["b", "c"]);
  assert.deepEqual(chatsToLet(chats.slice(0, 5), { current: "e", known: known(chats) }), [], "five chats: all kept");
});

test("a chat with anything of the page's own stays, however old", () => {
  const known1 = new Set(["s-x"]);
  assert.equal(letGoable(chat("x", 1), known1), true);
  for (const [why, more] of /** @type {[string, Record<string, any>][]} */ ([
    ["a turn of its own running", { live: {} }],
    ["a message waiting for another window's turn", { waiting: {} }],
    ["messages queued", { queue: { items: [{ text: "next" }] } }],
    ["an ask paused on it", { paused: {} }],
    ["a saved agent summoned", { summoned: {} }],
    ["a resume armed", { resume: { at: 1 } }],
    ["a compaction once its turn ends", { compactAfter: true }],
    ["a catch-up being read", { catchingUp: true }],
    ["a read owed after its send", { hydrateAfterSend: true }],
  ])) assert.equal(letGoable(chat("x", 1, more), known1), false, why);
  assert.equal(letGoable(chat("x", 1, { queue: { items: [] } }), known1), true, "an empty queue holds nothing");
  // No row in the archive's list yet (its first turn still streaming, the list catching up): the sidebar draws its row
  // from the page's chat, so it stays.
  assert.equal(letGoable(chat("x", 1), new Set()), false);
  assert.equal(letGoable({ id: "n", chainId: null, shownAt: 1 }, known1), false, "a new chat's only copy is the page's");
});

test("what a chat let go of takes back: the view it showed and the cards opened on it", () => {
  assert.deepEqual(keptOf(chat("x", 1, { viewTab: "plan", cardsOpen: new Set(["sa_1:0", "sa_2:1"]) })), { viewTab: "plan", cardsOpen: ["sa_1:0", "sa_2:1"] });
  assert.deepEqual(keptOf(chat("x", 1)), { viewTab: "chat", cardsOpen: [] });
});

// (fails before: yes — the page never let a chat go)
test("the page lets chats go as it shows one, and opens one again as it was left", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const select = app.slice(app.indexOf("function selectChat("), app.indexOf("function setTitle("));
  assert.match(select, /chat\.shownAt = Date\.now\(\);\s*letChatsGo\(\);/, "selectChat marks the chat shown, then lets the others go");
  const open = app.slice(app.indexOf("async function openSession("), app.indexOf("function loadIntoNewTask("));
  assert.match(open, /letGo\.get\(String\(s\.id\)\)/);
  assert.match(open, /viewTab: opts\.view \|\| was\?\.viewTab \|\| "chat"/, "the address's view first, then the one it was left on");
  assert.match(open, /cardsOpen: new Set\(was\.cardsOpen\)/);
});

// (fails before: yes — the owner's of 10-29: three turns Filament started by itself, a background command's end each,
// ran while another chat was on screen; the chat shown again stood as it was left, and they were never drawn)
test("a turn heard on a chat the page holds but does not show is read when the chat is shown again", () => {
  const shown = chat("on", 1);
  const away = chat("away", 1);
  noteUnseenTurn(away, shown, 500);
  assert.equal(readsOnShow(away), true, "a wake, a resume, another tab's turn: read again when shown");
  noteUnseenTurn(shown, shown, 600);
  assert.equal(readsOnShow(shown), false, "the chat on screen follows its turns as they come");
  const own = chat("own", 1, { live: {} });
  noteUnseenTurn(own, shown, 600);
  assert.equal(readsOnShow(own), false, "the page's own running turn draws itself");
  noteUnseenTurn(null, shown, 600);
  // A read asked before the turn was heard does not hold it; one asked after it does.
  readSince(away, 500);
  assert.equal(readsOnShow(away), true, "asked the same moment: maybe before it");
  readSince(away, 501);
  assert.equal(readsOnShow(away), false);
  noteUnseenTurn(away, shown, 700);
  noteUnseenTurn(away, shown, 650);
  readSince(away, 680);
  assert.equal(readsOnShow(away), true, "the newest turn heard counts");
  assert.equal(letGoable(away, new Set(["s-away"])), true, "let go, it is read again when it opens anyway");
});

// (fails before: yes)
test("the page marks such a chat from the feed, and marks every kept chat when the feed comes back from a gap", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const feed = app.slice(app.indexOf(`if (msg?.type !== "turn") return;`), app.indexOf("const was = chat.view?.holder || null;"));
  assert.match(feed, /if \(!chat\?\.chainId \|\| chat\.chainId !== msg\.chainId\) \{[^}]*noteUnseenTurn\(chatByChain\(String\(msg\.chainId\)\), chat, Date\.now\(\)\);\s+return;\s+\}/);
  assert.match(app, /if \(msg\?\.type === "hello"\) \{\s+(?:\/\/[^\n]*\n\s+)*const wrote = [^\n]*\n\s+if \(feedHeard\) afterFeedGap\(\);\s+feedHeard = true;\s+return claimWriting\(wrote \? "open" : "peek"\);\s+\}/, "the first hello is the page's start; one after it a reconnect");
  // After a gap (a sleep, a restart): the kept chats are marked, the open one read now where nothing of its own runs.
  const state = { currentId: "c1", chats: new Map() };
  const shown = chat("c1", 1);
  const kept = chat("c2", 1);
  const own = chat("c3", 1, { live: {} });
  for (const c of [shown, kept, own]) state.chats.set(c.id, c);
  /** @type {any[]} */
  const read = [];
  const { afterFeedGap } = lift(["afterFeedGap"], { state, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null, noteUnseenTurn, opening: new WeakSet(), followElsewhere: (/** @type {any} */ c) => read.push(c) });
  afterFeedGap();
  assert.deepEqual([readsOnShow(shown), readsOnShow(kept), readsOnShow(own)], [false, true, false]);
  assert.deepEqual(read, [shown], "the open chat is read again now");
  state.chats.set("c1", chat("c1", 1, { view: { holder: { window: "conv-opencode", client: "opencode" } } }));
  read.length = 0;
  afterFeedGap();
  assert.deepEqual(read, [state.chats.get("c1")], "an outside client's turn on it: read the same, nothing draws it as it runs");
});

/**
 * selectChat → followElsewhere → hydrate, lifted, with a chat shown and one the feed marked; `tr` is the transcript the
 * read lands, `events` the order things happen in.
 * @param {any} tr
 */
function showPath(tr) {
  /** @type {string[]} */
  const events = [];
  const state = { currentId: "c1", chats: new Map(), sessions: [], commands: new Map(), compactingHeard: new Map(), holders: new Map() };
  const shown = chat("c1", 1);
  const marked = chat("c2", 1, { turns: [], cwd: "C:/work", unseenAt: 5 });
  state.chats.set("c1", shown);
  state.chats.set("c2", marked);
  const fns = lift(["selectChat", "followElsewhere", "hydrate", "drawChat?", "drawnChat?", "meterRecords"], {
    state, newestOnRecord, opening: new WeakSet(), readsOnShow, readSince,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: async (/** @type {string} */ path) => (events.push(`read ${path.split("?")[0]}`), tr),
    armSessionView: () => events.push("arm the view"),
    followLiveTurn: () => events.push("follow the run"),
    transcript: { render: (/** @type {any} */ c) => events.push(`draw ${c.id}`), startTurn() {}, pause() {}, refreshSpace() {} },
    transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince,waitingOwes: () => null,
  });
  return { fns, events, marked };
}
const TURN = (/** @type {number} */ n, /** @type {any} */ more = {}) => ({ n, turnId: `t${n}`, user: { content: [{ type: "text", text: `m${n}` }] }, final: { role: "assistant", content: [{ type: "text", text: `a${n}` }] }, workCount: 0, ...more });

// (fails before: yes — the owner's of 10-29: the chat shown again stood as it was left)
test("a marked chat shown again is read, drawn whole and its mark cleared; an outside client's turn on it is drawn running, and no run is followed for it", async () => {
  const ended = showPath({ turns: [TURN(1), TURN(2)], live: null });
  ended.fns.selectChat("c2");
  await tick();
  assert.deepEqual(ended.events.filter((e) => e !== "draw c2"), ["read /sessions/s-c2/transcript", "arm the view"], "read at once");
  assert.equal(ended.marked.turns.length, 2, "the turn that ran while it was not shown");
  assert.equal(ended.events.at(-2), "draw c2", "drawn whole as it is read");
  assert.equal(readsOnShow(ended.marked), false, "the read clears the mark");
  const outside = showPath({ turns: [TURN(1), TURN(2, { final: null, open: true })], live: { window: "conv-claude", startedAt: 1 } });
  outside.fns.selectChat("c2");
  await tick();
  assert.deepEqual(outside.events.filter((e) => e !== "draw c2"), ["read /sessions/s-c2/transcript", "arm the view"], `read, and nothing follows it (${outside.events.join(", ")})`);
  assert.equal(outside.marked.turns.at(-1).status, "streaming", "its open turn is drawn running until it lets the session go");
});

// (fails before: yes — the bug hunt of 10-30, UIS-5: a chat deleted from the left bar stayed on screen, its Send going to
// a session that was gone, and one with turns of the page's own came back in the bar, drawn from the page's copy)
test("a chat deleted here leaves the page: the one on screen makes way for a new chat, and its waiting send and kept files go", async () => {
  const { APP_SRC } = await import("./helpers/app-lift.js");
  const state = { currentId: "c1", chats: new Map() };
  let cancelled = 0;
  const shown = chat("c1", 1, { waiting: { cancel: () => void cancelled++ } });
  const other = chat("c2", 1);
  for (const c of [shown, other]) state.chats.set(c.id, c);
  /** @type {string[]} */
  const made = [];
  /** @type {string[]} */
  const cleared = [];
  /** @type {[string, any[]][]} */
  const filesKept = [];
  const fns = lift(["chatByChain", "leaveDeleted?"], {
    state,
    newChat: () => { made.push("new chat"); state.currentId = "n1"; },
    wstore: { clear: (/** @type {string} */ id) => void cleared.push(id) },
    saveDraftFiles: (/** @type {any} */ c, /** @type {any[]} */ files) => void filesKept.push([c.id, files]),
  });
  // The left bar's onDeleted, as the page wires it.
  const at = APP_SRC.indexOf("  onDeleted: (id) =>");
  const wired = APP_SRC.slice(at, APP_SRC.indexOf("\n", at));
  const disarmed = /** @type {string[]} */ ([]);
  // The Changes pane hears each deletion after the page's chat on it went (panes/changes.js `chatDeleted`).
  const panesHeard = /** @type {[string, boolean][]} */ ([]);
  const chatDeleted = (/** @type {string} */ id) => void panesHeard.push([id, [...state.chats.values()].some((c) => c.chainId === id)]);
  const onDeleted = new Function("handOvers", "disarmHandOver", "leaveDeleted", "chatDeleted", `return ({\n${wired}\n}).onDeleted;`)(new Set(["s-c1"]), (/** @type {string} */ id) => disarmed.push(id), fns.leaveDeleted, chatDeleted);
  onDeleted("s-c1");
  assert.deepEqual([state.chats.has("c1"), made, state.currentId, disarmed], [false, ["new chat"], "n1", ["s-c1"]]);
  assert.deepEqual(panesHeard, [["s-c1", false]], "the Changes pane hears of it once the page's chat on it is gone");
  assert.deepEqual([cancelled, shown.waiting, cleared, filesKept], [1, null, ["s-c1"], [["c1", []]]], "nothing waits to be sent into it, and its box's files go");
  onDeleted("s-c2");
  assert.deepEqual([state.chats.has("c2"), made.length, state.currentId], [false, 1, "n1"], "one not on screen goes, and the screen stays");
  onDeleted("s-none");
  assert.equal(made.length, 1, "a session the page holds no chat of moves nothing");
});

// (fails before: yes — the bug hunt of 10-30, UIS-6: a read that failed while another tab's turn was followed ended the
// catch-up, and nothing read the chat again — a turn that ends elsewhere asks for no read — so the turn was never drawn)
test("a catch-up whose read fails reads again while its chat is shown; a session that does not exist, or another chat shown, ends it", async () => {
  const state = { currentId: "c1", chats: new Map() };
  const shown = chat("c1", 1);
  state.chats.set("c1", shown);
  /** The catch-up lifted, its reads answered by `read`. @param {() => Promise<void>} read */
  const followWith = (read) => lift(["FOLLOW_TRIES", "followElsewhere"], { state, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null, hydrate: read, setTimeout: (/** @type {() => void} */ fn) => setImmediate(fn) }).followElsewhere;
  let reads = 0;
  const fails = [new Error("fetch failed"), Object.assign(new Error("Bad Gateway"), { status: 502 })];
  await followWith(async () => {
    reads++;
    const e = fails.shift();
    if (e) throw e;
  })(shown);
  assert.deepEqual([reads, shown.catchingUp], [3, false], "two failed reads, then the one that drew it");
  reads = 0;
  await followWith(async () => {
    reads++;
    throw Object.assign(new Error("no such session: s-c1"), { status: 404 });
  })(shown);
  assert.equal(reads, 1, "a session that does not exist");
  reads = 0;
  await followWith(async () => {
    reads++;
    if (reads === 2) state.currentId = "c2";
    throw new Error("fetch failed");
  })(shown);
  assert.equal(reads, 2, "another chat shown: its catch-up is its own when it is shown again");
  // A failure that lasts (a server refusing, a draw that throws) is read again a few times, never for good.
  state.currentId = "c1";
  reads = 0;
  await followWith(async () => {
    reads++;
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  })(shown);
  assert.deepEqual([reads, shown.catchingUp], [8, false], "FOLLOW_TRIES reads, then the transcript stays as drawn");
});

// (fails before: yes — the bug hunt of 10-30, a Low: the find bar stood open over a chat switched to, its count and its
// steps on the marks of the transcript it had searched)
test("the find bar closes as another chat is drawn, and stays as the chat on screen is chosen again", () => {
  const state = { currentId: /** @type {string | null} */ (null), chats: new Map() };
  for (const c of [chat("c1", 1), chat("c2", 1)]) state.chats.set(c.id, c);
  let closed = 0;
  const { selectChat } = lift(["selectChat", "drawChat?", "drawnChat?"], { state, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null, find: { close: () => void closed++ }, transcript: { render() {}, refreshSpace() {} } });
  selectChat("c1");
  const first = closed;
  selectChat("c1");
  assert.equal(closed, first, "the chat on screen chosen again: the bar stays");
  selectChat("c2");
  assert.equal(closed, first + 1, "another chat: closed");
});

// (fails before: yes — the bug hunt of 10-30, its plausible "overlapping hydrates": two reads of one chat on their way at
// once — it opened as another tab's turn was heard — and the one asked first, landing last, drew the transcript as it
// stood before the other's, the newer turn gone from it)
test("of two reads of a chat on their way at once, the one asked first draws nothing over the other's when it lands last", async () => {
  const state = { currentId: "c1", chats: new Map(), sessions: [], commands: new Map(), compactingHeard: new Map(), holders: new Map() };
  const shown = chat("c1", 1, { cwd: "C:/work" });
  state.chats.set("c1", shown);
  /** @type {((tr: any) => void)[]} */
  const lands = [];
  /** @type {string[]} */
  const drawn = [];
  const fns = lift(["hydrate", "drawChat?", "drawnChat?", "meterRecords"], {
    state, newestOnRecord, opening: new WeakSet(), readsOnShow, readSince,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: () => new Promise((r) => lands.push(r)),
    armSessionView: () => {}, followLiveTurn: () => {},
    transcript: { render: (/** @type {any} */ c) => drawn.push(c.title), startTurn() {}, pause() {}, refreshSpace() {} },
    transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince,waitingOwes: () => null,
  });
  const first = fns.hydrate(shown);
  const second = fns.hydrate(shown);
  lands[1]({ turns: [TURN(1), TURN(2)], live: null, title: "two turns" });
  await second;
  lands[0]({ turns: [TURN(1)], live: null, title: "one turn" });
  await first;
  assert.deepEqual([shown.turns.length, shown.title, drawn], [2, "two turns", ["two turns"]]);
  const third = fns.hydrate(shown);
  lands[2]({ turns: [TURN(1), TURN(2), TURN(3)], live: null, title: "three turns" });
  await third;
  assert.deepEqual([shown.turns.length, drawn.at(-1)], [3, "three turns"], "a read asked after it draws as ever");
});

// (fails before: yes — the review's: a read that landed before the woken turn wrote its message cleared the mark)
test("a read that lands before a turn of this harness's has written its message keeps the mark", async () => {
  const early = showPath({ turns: [TURN(1)], live: { window: "harness", startedAt: 1 } });
  await early.fns.hydrate(early.marked);
  assert.equal(readsOnShow(early.marked), true, "the turn holds the session, its message not yet in");
  const open = showPath({ turns: [TURN(1), TURN(2, { final: null, open: true })], live: { window: "harness", startedAt: 1 } });
  await open.fns.hydrate(open.marked);
  assert.ok(open.events.includes("follow the run"), "its message is in: followed");
  assert.equal(readsOnShow(open.marked), false);
});
