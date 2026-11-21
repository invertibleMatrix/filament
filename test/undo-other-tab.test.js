// @ts-check
// A compaction undone in one tab, heard in another (the 11-01 report's B8): the server says an Undo on the events feed
// (`compaction-undone`), and every page that holds the chat takes the row back as the page that undid it does — the row
// goes, and the Undo moves to the compaction the server names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_SRC, lift } from "./helpers/app-lift.js";
import * as history from "../src/ui/harness/conversation/history.js";
import { transcriptWhole, writtenSince } from "../src/ui/harness/lib/transcript-since.js";

/** A chat holding two compaction rows: a fold (id 7) under a summary (id 8), the one that offers Undo. */
const chatWithRows = () => {
  const fold = { type: "compaction", id: 7, afterTurn: 2, fromTurn: 1, toTurn: 2, method: "fold", undoable: false };
  const summary = { type: "compaction", id: 8, afterTurn: 3, fromTurn: 1, toTurn: 3, method: "summary", undoable: true };
  return /** @type {any} */ ({ chainId: "s-1", turns: [{ n: 1 }, { n: 2, boundariesAfter: [fold] }, { n: 3, boundariesAfter: [summary] }] });
};
/** Each turn's compaction rows, as [id, undoable]. @param {any} chat */
const rows = (chat) => chat.turns.map((/** @type {any} */ t) => (t.boundariesAfter || []).map((/** @type {any} */ b) => [b.id, b.undoable]));

// (fails before: yes — a page heard no Undo but its own: another tab kept the row and its Undo, which the server refused)
test("an Undo heard from another tab: the row goes, the Undo moves to the one the server names, and the open chat repaints", () => {
  const chat = chatWithRows();
  /** @type {number[]} */
  const drawn = [];
  /** @type {string[]} */
  const painted = [];
  const fns = lift(["compactionUndone"], {
    state: { currentId: "c1" },
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
    afterCompactionUndo: history.afterCompactionUndo,
    transcript: { drawBoundaries: (/** @type {any} */ t) => drawn.push(t.n) },
    widgets: { paint: () => painted.push("widgets") },
    paintMeter: () => painted.push("meter"),
    repaintContextHow: () => painted.push("how"),
    bustPreview: () => painted.push("preview"),
  });
  fns.compactionUndone(chat, 8, 7);
  assert.deepEqual(rows(chat), [[], [[7, true]], []]);
  assert.deepEqual(drawn.sort(), [2, 3]);
  assert.deepEqual(painted.sort(), ["how", "meter", "preview", "widgets"]);
  // The tab that undid it hears it too: nothing moves again.
  drawn.length = 0;
  fns.compactionUndone(chat, 8, 7);
  assert.deepEqual([rows(chat), drawn], [[[], [[7, true]], []], []]);
});

// (fails before: yes — the same; and the review of 335009f86: its compose preview stayed cached from the history before
// the Undo — keyed by an epoch only `bustPreview` moves — so the chat shown again painted the meter, and offered the
// undone compaction's Undo, from it)
test("a chat not shown takes the row back, draws and paints nothing, and its preview is read afresh", () => {
  const chat = chatWithRows();
  /** @type {any[]} */
  const drawn = [];
  const fns = lift(["compactionUndone"], {
    state: { currentId: "other" },
    chatOf: () => null,
    afterCompactionUndo: history.afterCompactionUndo,
    transcript: { drawBoundaries: (/** @type {any} */ t) => drawn.push(t.n) },
    bustPreview: () => drawn.push("preview"),
  });
  fns.compactionUndone(chat, 8, null);
  assert.deepEqual(rows(chat), [[], [[7, false]], []]);
  assert.deepEqual(drawn, ["preview"]);
});

// (fails before: yes — the review of 335009f86: a read asked before an Undo was heard, landing after it, drew the row
// again with its Undo, which the server refused; on a turn this page sent it stayed through every later read)
test("a read asked before an Undo was heard lands with the compaction taken back all the same", async () => {
  const chat = chatWithRows();
  chat.id = "c1";
  const state = { currentId: "c1", chats: new Map([["c1", chat]]), compactingHeard: new Map(), commands: new Map() };
  /** What the server's read holds: the summary standing, or (`after`) taken back. */
  let after = false;
  /** @type {any} */
  let fns = null;
  fns = lift(["hydrate", "compactionUndone"], {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: async () => {
      // The Undo is heard while the read is on its way.
      if (!after) fns.compactionUndone(chat, 8, 7);
      return { turns: [], live: null };
    },
    opening: new WeakSet(),
    transcriptTurns: () => {
      const turns = chatWithRows().turns;
      if (after) history.afterCompactionUndo(turns, 8, 7);
      return turns;
    },
    withReadWork: (/** @type {any[]} */ t) => t,
    withReadRuns: (/** @type {any[]} */ t) => t,
    transcriptWhole, writtenSince,
    mergedTurns: (/** @type {any[]} */ _page, /** @type {any[]} */ read) => read,
    afterCompactionUndo: history.afterCompactionUndo,
    newestOnRecord: history.newestOnRecord,
    applySessionView: () => {},
    readSince: () => {},
    waitingOwes: () => null,
    wstore: { read: () => null },
    transcript: { drawBoundaries() {} },
    bustPreview() {},
  });
  await fns.hydrate(chat);
  assert.deepEqual(rows(chat), [[], [[7, true]], []]);
  // A read asked after it holds what the server holds: the word is spent.
  await new Promise((r) => setTimeout(r, 5));
  after = true;
  await fns.hydrate(chat);
  assert.deepEqual([rows(chat), chat.undoneHeard], [[[], [[7, true]], []], []]);
});

// (fails before: yes — Hunter sa_852786a7 on 511368a75: a read asked before an Undo, landing after a compaction made
// since, took the page's new row of the same turns for its own copy of the undone one — a compaction was one row by its
// turns alone — and the Undo told it again gave the Undo to the compaction before the undone one, which the server
// refused, over a newer one of other turns)
test("a read asked before an Undo, landing after a compaction made since, keeps the new row and its Undo — of the same turns or of others", () => {
  for (const [from, to] of [[1, 3], [1, 4]]) {
    const fold = { type: "compaction", id: 7, afterTurn: 2, fromTurn: 1, toTurn: 2, method: "fold", undoable: false };
    const undone = { type: "compaction", id: 8, afterTurn: 3, fromTurn: 1, toTurn: 3, method: "summary", undoable: true };
    const made = { type: "compaction", id: 9, afterTurn: to, fromTurn: from, toTurn: to, method: "summary", undoable: true };
    const page = [{ n: 1, requestId: "r1" }, { n: 2, requestId: "r2", boundariesAfter: [{ ...fold }] }, { n: 3, requestId: "r3", boundariesAfter: to === 3 ? [made] : [] }, { n: 4, requestId: "r4", boundariesAfter: to === 4 ? [made] : [] }];
    const read = [{ n: 1, requestIds: ["r1"] }, { n: 2, requestIds: ["r2"], boundariesAfter: [{ ...fold }] }, { n: 3, requestIds: ["r3"], boundariesAfter: [{ ...undone }] }, { n: 4, requestIds: ["r4"] }];
    // The read keeps no compaction row it lacks — one it lacks is stale, and kept it offered two Undos,
    // [[], [[7, true]], [[8, true]]] — so the row made since comes back as `hydrate` tells it again, in the order
    // heard: the Undo of 8, then the new row.
    const turns = history.mergedTurns(page, read);
    history.afterCompactionUndo(turns, 8, 7);
    history.afterCompactionPlaced(turns, made);
    assert.deepEqual(rows({ turns }), [[], [[7, false]], to === 3 ? [[9, true]] : [], to === 4 ? [[9, true]] : []], `turns ${from}–${to}`);
  }
  // Heard live, with nothing made since, the Undo moves as the server names it.
  const live = chatWithRows();
  history.afterCompactionUndo(live.turns, 8, 7);
  assert.deepEqual(rows(live), [[], [[7, true]], []]);
});

// (fails before: yes — the hunt's Undo P2: the read kept the page's row it lacked, so the stale row and row 7 both
// offered Undo, [[], [[7, true]], [[8, true]]], the stale one's refused by the server)
test("a read that lacks a compaction this page holds — undone in another tab while the feed was down — takes that row away: one Undo stands, the read's", () => {
  const fold = (/** @type {boolean} */ undoable) => ({ type: "compaction", id: 7, afterTurn: 2, fromTurn: 1, toTurn: 2, method: "fold", undoable });
  const stale = { type: "compaction", id: 8, afterTurn: 3, fromTurn: 1, toTurn: 3, method: "summary", undoable: true };
  const page = [{ n: 1, requestId: "r1" }, { n: 2, requestId: "r2", boundariesAfter: [fold(false)] }, { n: 3, requestId: "r3", boundariesAfter: [stale] }];
  const read = [{ n: 1, requestIds: ["r1"] }, { n: 2, requestIds: ["r2"], boundariesAfter: [fold(true)] }, { n: 3, requestIds: ["r3"] }];
  assert.deepEqual(rows({ turns: history.mergedTurns(page, read) }), [[], [[7, true]], []]);
});

// (fails before: yes — the review of 6a7c7d42c: Filament's copy's summary, a row with a higher id, counted as a
// compaction made since, so the Undo told again never moved to the one the server named)
test("an Undo told again moves the Undo past Filament's copy's row, which moved no session", () => {
  const chat = chatWithRows();
  chat.turns.push({ n: 4, boundariesAfter: [{ type: "compaction", id: 9, afterTurn: 4, fromTurn: 1, toTurn: 4, method: "summary", detail: { copy: true }, undoable: false }] });
  history.afterCompactionUndo(chat.turns, 8, 7);
  assert.deepEqual(rows(chat), [[], [[7, true]], [], [[9, false]]]);
});

// (fails before: yes — the review of 6a7c7d42c: a chat opened from the list, whose turns are the server's, took a read
// asked before an Undo and a Compact now whole — the new row went, and the Undo told again went to the compaction
// before the undone one, which the server refused)
test("a read asked before an Undo and a Compact now, on turns read from the server, keeps the new row and gives it the Undo", async () => {
  const chat = chatWithRows();
  chat.id = "c1";
  for (const t of chat.turns) t.past = true;
  const state = { currentId: "c1", chats: new Map([["c1", chat]]), compactingHeard: new Map(), commands: new Map() };
  const made = { type: "compaction", id: 9, afterTurn: 3, fromTurn: 1, toTurn: 3, method: "summary", undoable: true };
  /** @type {any} */
  let fns = null;
  fns = lift(["hydrate", "compactionUndone", "placeCompaction", "undoOnlyOn?"], {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: async () => {
      // Heard while the read is on its way: the Undo of 8, then Compact now's answer.
      fns.compactionUndone(chat, 8, 7);
      await new Promise((r) => setTimeout(r, 2));
      fns.placeCompaction(chat, made);
      return { turns: [], live: null };
    },
    opening: new WeakSet(),
    transcriptTurns: () => chatWithRows().turns.map((/** @type {any} */ t) => ({ ...t, past: true })),
    withReadWork: (/** @type {any[]} */ t) => t,
    withReadRuns: (/** @type {any[]} */ t) => t,
    transcriptWhole, writtenSince,
    mergedTurns: history.mergedTurns,
    afterCompactionUndo: history.afterCompactionUndo,
    afterCompactionPlaced: history.afterCompactionPlaced,
    newerCompaction: history.newerCompaction,
    holdsRow: history.holdsRow,
    turnNumbered: history.turnNumbered,
    newestOnRecord: history.newestOnRecord,
    applySessionView: () => {},
    readSince: () => {},
    waitingOwes: () => null,
    wstore: { read: () => null },
    transcript: { drawBoundaries() {} },
    bustPreview() {},
  });
  await fns.hydrate(chat);
  assert.deepEqual(rows(chat), [[], [[7, false]], [[9, true]]]);
});

// (fails before: yes — the review of ab71c0420: a read asked before a Compact now and the message after it, landing
// after both, gave the compaction its Undo again, which the message had ended and the server refused)
test("a read asked before a Compact now and the next message is told both, in order: the compaction stays, its Undo ended", async () => {
  const chat = chatWithRows();
  chat.id = "c1";
  for (const t of chat.turns) t.past = true;
  const state = { currentId: "c1", chats: new Map([["c1", chat]]), compactingHeard: new Map(), commands: new Map() };
  const made = { type: "compaction", id: 9, afterTurn: 3, fromTurn: 1, toTurn: 3, method: "summary", undoable: true };
  /** @type {any} */
  let fns = null;
  fns = lift(["hydrate", "placeCompaction", "undoOnlyOn?"], {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: async () => {
      fns.placeCompaction(chat, made);
      await new Promise((r) => setTimeout(r, 2));
      // The next message goes out (sendMessage): every Undo ended.
      for (const t of chat.turns) for (const b of t.boundariesAfter || []) b.undoable = false;
      (chat.rowsHeard ||= []).push({ at: Date.now(), sent: true });
      return { turns: [], live: null };
    },
    opening: new WeakSet(),
    transcriptTurns: () => chatWithRows().turns.map((/** @type {any} */ t) => ({ ...t, past: true })),
    withReadWork: (/** @type {any[]} */ t) => t,
    withReadRuns: (/** @type {any[]} */ t) => t,
    transcriptWhole, writtenSince,
    mergedTurns: history.mergedTurns,
    afterCompactionUndo: history.afterCompactionUndo,
    afterCompactionPlaced: history.afterCompactionPlaced,
    newerCompaction: history.newerCompaction,
    undoEnded: history.undoEnded,
    holdsRow: history.holdsRow,
    turnNumbered: history.turnNumbered,
    newestOnRecord: history.newestOnRecord,
    applySessionView: () => {},
    readSince: () => {},
    waitingOwes: () => null,
    wstore: { read: () => null },
    transcript: { drawBoundaries() {} },
    bustPreview() {},
  });
  await fns.hydrate(chat);
  assert.deepEqual(rows(chat), [[], [[7, false]], [[8, false], [9, false]]]);
  // The page's send tells it: one entry, after the Undos it ended.
  assert.match(APP_SRC, /\(chat\.rowsHeard \|\|= \[\]\)\.push\(\{ at: Date\.now\(\), sent: true \}\);/);
});

// (fails before: yes — the hunt's Undo P5: an Undo heard after the next message went gave the compaction the server
// named its Undo again, [7, true], which that message had ended and the server refused — live, and told again to a read)
test("an Undo heard once the next message has gone moves no Undo: the message ended them all, live or told again to a read", () => {
  const chat = chatWithRows();
  // The next message goes out (sendMessage): every Undo ended.
  history.undoEnded(chat.turns);
  // An Undo of 8 the server took just before that message began, heard after it — another tab's, or the feed's echo.
  const fns = lift(["compactionUndone"], { state: { currentId: "other" }, chatOf: () => null, afterCompactionUndo: history.afterCompactionUndo, transcript: { drawBoundaries() {} }, bustPreview() {} });
  fns.compactionUndone(chat, 8, 7);
  assert.deepEqual(rows(chat), [[], [[7, false]], []], "the row goes; the one before it offers no Undo the server would refuse");
  // Told again to a read asked before it and served once that message had begun: 8 is gone from it, 7 as it says.
  const read = chatWithRows();
  read.turns[2].boundariesAfter = [];
  history.afterCompactionUndo(read.turns, 8, 7);
  assert.deepEqual(rows(read), [[], [[7, false]], []]);
});

// (fails before: yes, at ab71c0420's parent — a compaction placed late, older than one the page held, took that one's Undo;
// the review of ab71c0420 found no test of it)
test("a compaction older than one the page holds is placed without an Undo, and takes none from the newer", () => {
  const chat = chatWithRows();
  chat.id = "c1";
  const older = { type: "compaction", id: 6, afterTurn: 1, fromTurn: 1, toTurn: 1, method: "fold", undoable: true };
  const { placeCompaction } = lift(["placeCompaction", "undoOnlyOn?"], { state: { currentId: "c1" }, chatOf: () => chat, turnNumbered: history.turnNumbered, holdsRow: history.holdsRow, newerCompaction: history.newerCompaction, transcript: { drawBoundaries() {} }, bustPreview() {} });
  placeCompaction(chat, older);
  assert.deepEqual(rows(chat), [[[6, false]], [[7, false]], [[8, true]]]);
});

// (fails before: yes — the same)
test("the feed's word reaches it, and the page's own Undo takes the row back the same way", () => {
  assert.match(APP_SRC, /onBus\(\(msg\) => \{\s+if \(msg\?\.type !== "compaction-undone" \|\| !msg\.chainId\) return;\s+const chat = chatByChain\(String\(msg\.chainId\)\);\s+if \(chat\) compactionUndone\(chat, Number\(msg\.id\), msg\.undoable == null \? null : Number\(msg\.undoable\)\);\s+\}\);/);
  const at = APP_SRC.indexOf("async function undoCompactionIn(");
  const own = APP_SRC.slice(at, APP_SRC.indexOf("\n}\n", at));
  assert.match(own, /compactionUndone\(chat, id, r\.undoable == null \? null : Number\(r\.undoable\)\);/);
  assert.ok(!own.includes("afterCompactionUndo("), "one way to take a row back");
});
