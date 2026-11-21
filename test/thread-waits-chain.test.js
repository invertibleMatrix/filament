// @ts-check
// A thread opened while the agents' list is not its chat's yet — a Now row's open: the chat is shown at once, and the
// list takes the chat's chain only once its transcript lands (app.js `refreshStatus`); until then it holds no chain, or
// the chat left's, the views drawn before it moves (app.js `selectChat`) — waits for the chat's own chain: made before,
// the thread read its agent under the wrong chain (/api/sessions//subagents/<id>, or the other chat's), was told 404
// and said "This thread is gone" until the list's change made it again (the lab's logs of 11-17, four times); a tile
// its layout brought back said it for good. The Sub Agents tab makes it once the chain is the chat's (side.js
// `paintThread`), and so does a tile beside the chat (panes/thread.js `threadOnceListed`); both say Loading meanwhile,
// as a thread's own first state does. A coding agent's own needs no chain.
// (fails before: yes — the tab made the thread with the list's chain, empty or the chat left's; the tile likewise)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSideView } from "../src/ui/harness/views/side.js";
import { threadOnceListed } from "../src/ui/harness/panes/thread.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, sideIO, sideSeams } from "./helpers/side-view.js";

/** The tab with the list's chain as `chain()` says it, and the chat it shows, whose chain is c1. @param {() => string} chain */
function tabOf(chain) {
  const io = sideIO({ chainId: chain, rows: () => (chain() === "c1" ? [agentRow("s1")] : []) });
  const s = sideSeams();
  const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
  const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
  return { view, chat, threads: s.threads, el: view.el };
}

test("the tab: a thread opened before the list is its chat's — no chain, or the chat left's — says Loading, and is made once the chat's chain lands, with it", () => {
  for (const before of ["", "c0"]) {
    let chain = before;
    const { view, chat, threads, el } = tabOf(() => chain);
    view.paint(chat);
    view.open("s1");
    assert.equal(threads.length, 0, `no thread's part under the list's ${before || "no"} chain: nothing reads the agent`);
    assert.match(textOf(el), /Loading/);
    assert.doesNotMatch(textOf(el), /gone/i);
    view.paint(chat);
    assert.equal(threads.length, 0, "a paint before the chain lands makes none either");
    chain = "c1";
    view.paint(chat);
    assert.deepEqual(threads.map((t) => [t.o.chainId, t.o.id, t.mounted]), [["c1", "s1", 1]], "the chain landed: one thread, made with it");
    assert.doesNotMatch(textOf(el), /Loading/);
    view.paint(chat);
    assert.equal(threads.length, 1, "and made once");
  }
});

test("the tab: a thread shown when the list lets go of the chat's chain goes, and is made anew once it is the list's again", () => {
  let chain = "c1";
  const { view, chat, threads } = tabOf(() => chain);
  view.paint(chat);
  view.open("s1");
  assert.equal(threads.length, 1);
  chain = "";
  view.paint(chat);
  assert.equal(threads[0].closed, true, "the chat opening again: the thread shown is let go");
  chain = "c1";
  view.paint(chat);
  assert.deepEqual([threads.length, threads[1].o.chainId], [2, "c1"]);
});

test("the tab: a coding agent's own thread needs no chain: it is made at once, whatever the list holds", () => {
  for (const chain of ["", "c0"]) {
    const { view, chat, threads } = tabOf(() => chain);
    view.paint(chat);
    view.open("run_1~a1");
    assert.deepEqual(threads.map((t) => [!!t.guest, t.o.id]), [[true, "run_1~a1"]]);
  }
});

/** A tile's body, and a list whose chain the test moves and whose changes it says. */
function tileOf(/** @type {string} */ id, /** @type {string} */ chain) {
  const listeners = new Set();
  const list = { chain, say: () => { for (const fn of [...listeners]) fn(); }, listeners };
  /** @type {{ closed: boolean }[]} */
  const made = [];
  const body = /** @type {any} */ (document.createElement("div"));
  const held = threadOnceListed(/** @type {any} */ (body), {
    id,
    mine: () => list.chain === "c1",
    onChange: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    make: () => {
      const pane = { closed: false, close: () => void (pane.closed = true) };
      made.push(pane);
      return pane;
    },
  });
  return { body, held, list, made };
}

test("a tile beside the chat: Loading until the list is its chat's — none, then the chat left's —, made once then, and listening no more", () => {
  const { restore } = stubDocument();
  try {
    const t = tileOf("s1", "");
    assert.deepEqual([t.made.length, t.body.textContent, t.body.children[0]?.className], [0, "Loading", "sav-loading gradient"], "a thread's own first state");
    t.list.chain = "c0";
    t.list.say();
    assert.equal(t.made.length, 0, "the chat left's list: not yet");
    t.list.chain = "c1";
    t.list.say();
    assert.equal(t.made.length, 1, "the chat's own: made");
    assert.equal(t.list.listeners.size, 0, "and no longer listening");
    t.list.say();
    assert.equal(t.made.length, 1);
    t.held.close();
    assert.equal(t.made[0].closed, true, "its close closes the pane");
    // Closed before the chain lands: nothing is made, and it listens no more.
    const early = tileOf("s2", "c0");
    early.held.close();
    early.list.chain = "c1";
    early.list.say();
    assert.deepEqual([early.made.length, early.list.listeners.size], [0, 0]);
    // The list the chat's already, or a coding agent's own: made at once.
    assert.equal(tileOf("s3", "c1").made.length, 1);
    const guest = tileOf("run_1~a1", "");
    assert.deepEqual([guest.made.length, guest.list.listeners.size], [1, 0]);
  } finally {
    restore();
  }
});

test("app.js's thread tile waits through `threadOnceListed`, asking whether the list is the open chat's own at each change", () => {
  const src = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const tile = src.slice(src.indexOf("  thread: {\n    render: (body, id, head) => {"), src.indexOf("    label: (id) => {"));
  assert.match(tile, /const c = String\(chatOf\(state\.currentId\)\?\.chainId \|\| ""\);\n\s+return !!c && subagentStore\.chainId\(\) === c;/);
  assert.match(tile, /const held = threadOnceListed\(body, \{\n\s+id,\n\s+mine,\n\s+onChange: \(fn\) => subagentStore\.onChange\(fn\),/);
  assert.match(tile, /return \(\) => \{\n\s+held\.close\(\);\n\s+if \(pane && besideThreads\.get\(id\) === pane\) besideThreads\.delete\(id\);/);
});
