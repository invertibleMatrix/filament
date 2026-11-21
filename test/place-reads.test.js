// @ts-check
// Opening a chat read where it works three times (the chat-open audit's follow-up of 10-29): the header was set as the
// chat was chosen and again once its transcript came, each reading `/git/place`, and the status panel read the same
// place for its Git section. A read of the place on its way is now shared by whoever asks for it meanwhile. And the
// header's chip and name as a chat is set (the bug hunt of 10-30): a chat whose folder is not known shows none of the
// chat before's, a read of the chat shown keeps a folder picked in its chip, and a name cut at the header's width is said
// whole on its hover.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";

const g = /** @type {any} */ (globalThis);
/** The place reads asked, each answered when the test says. @type {{ url: string, land: () => void }[]} */
const reads = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  if (!String(url).startsWith("/api/git/place?")) return new Response("{}", { status: 404 });
  return new Promise((resolve) => reads.push({ url: String(url), land: () => resolve(new Response(JSON.stringify({ ok: true, place: "C:/work", branch: "main", also: [] }), { status: 200, headers: { "content-type": "application/json" } })) }));
};
after(() => { g.fetch = realFetch; });
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { createHeader } = await import("../src/ui/harness/header.js");
const { apiShared } = await import("../src/ui/harness/lib/api.js");

// (fails before: yes — the header's two sets and the panel's look were three reads of the same place)
test("the header set twice and the status panel's look, while a read of the place is on its way, read it once", async () => {
  const doc = stubDocument();
  try {
    const noop = () => {};
    const hd = createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null });
    // The folder as its field holds it (the stub's field fires no input event).
    /** @type {any} */ (hd.folderIn).value = "C:/work";
    const chat = { id: "c1", chainId: "s1", turns: [] };
    // Chosen, then its transcript came.
    hd.setChat(chat);
    hd.setChat(chat);
    // The status panel's Git section looks too.
    const state = { currentId: "c1" };
    const { loadGit } = lift(["loadGit"], { state, apiShared, refreshStatus: () => {} });
    const looked = loadGit(chat, "C:/work");
    assert.deepEqual(reads.map((r) => r.url), ["/api/git/place?cwd=C%3A%2Fwork&chain=s1"], "one read for the three");
    reads.shift()?.land();
    await looked;
    assert.equal(/** @type {any} */ (chat).git?.branch, "main", "the panel has its answer");
    assert.equal(hd.placeOf(chat)?.branch, "main", "and so does the header");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIS-11: a chat with no folder known kept the folder chip of the chat shown
// before, and its send read that chip as a folder chosen for it — the chat took the other chat's folder)
test("a chat whose folder is not known never shows the chat shown before's folder; a folder put in the chip stays the chooser's", () => {
  const doc = stubDocument();
  try {
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));
    // The stub's field fires no event: the leaf it would draw is the page's.
    hd.folderIn.dispatchEvent = () => true;
    hd.setChat({ id: "a", chainId: "s-a", cwd: "C:/work/a", turns: [] });
    assert.equal(hd.folderIn.value, "C:/work/a");
    const opened = { id: "b", chainId: "s-b", turns: [] };
    hd.setChat(opened);
    assert.equal(hd.folderIn.value, "", "not the other chat's folder");
    hd.folderIn.value = "C:/work/typed";
    hd.setChat(opened);
    hd.setChat({ id: "n", chainId: null, turns: [] });
    assert.equal(hd.folderIn.value, "C:/work/typed", "a folder put in the chip stays");
    hd.setChat({ id: "c", chainId: "s-c", cwd: "C:/work/c", turns: [] });
    assert.equal(hd.folderIn.value, "C:/work/c", "a chat's own folder, as ever");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the review of 3f174b6b6: every set of the header put the chat's folder in the chip, so a read of
// the chat shown — its turn's end — took back a folder picked there, 'C:/work/a', and whether the next message opened a
// new chat in it depended on whether such a read came first)
test("a read of the chat shown keeps a folder picked in the chip; another chat shown, or the chat's own folder changing, sets the chip to the chat's", () => {
  const doc = stubDocument();
  try {
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));
    hd.folderIn.dispatchEvent = () => true;
    const chat = { id: "a", chainId: "s-a", cwd: "C:/work/a", turns: [] };
    hd.setChat(chat);
    assert.equal(hd.folderIn.value, "C:/work/a");
    hd.folderIn.value = "C:/work/picked";
    // Its turn ended and its transcript was read again (app.js `hydrate`): the next message still opens a new chat there.
    hd.setChat(chat);
    assert.equal(hd.folderIn.value, "C:/work/picked", "a folder picked in the chip stays");
    // The chat moved to a worktree (app.js `movedTo`, or the worktree made at its first send): its own folder now.
    chat.cwd = "C:/work/a-wt";
    hd.setChat(chat);
    assert.equal(hd.folderIn.value, "C:/work/a-wt", "the chat's folder changed");
    hd.folderIn.value = "C:/work/picked";
    hd.setChat({ id: "b", chainId: "s-b", cwd: "C:/work/b", turns: [] });
    assert.equal(hd.folderIn.value, "C:/work/b", "another chat shown: its own folder");
    // An opened chat whose folder came with its transcript: shown in it then.
    const opened = { id: "o", chainId: "s-o", cwd: "", turns: [] };
    hd.setChat(opened);
    opened.cwd = "C:/work/o";
    hd.setChat(opened);
    assert.equal(hd.folderIn.value, "C:/work/o", "its folder read at last");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the bug hunt of 10-30, a Low: a chat's name cut at the header's width had no hover that said it
// whole, only what a press on it does)
test("the chat's name, cut at the header's width, is said whole on its hover; one that fits is not said again", () => {
  const doc = stubDocument();
  const w = /** @type {any} */ (globalThis).window;
  const d = /** @type {any} */ (doc.document);
  d.contains = (/** @type {any} */ n) => d.body.contains(n);
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  try {
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));
    d.body.append(hd.el);
    const name = "Find why the nightly build fails on the Windows runner and fix the flaky snapshot tests";
    hd.titleEl.textContent = name;
    const btn = hd.titleEl.parentNode;
    const hover = () => {
      btn.dispatch("pointerenter");
      const said = d.body.querySelector(".zc-tooltip-title")?.textContent;
      btn.dispatch("pointerleave");
      return said;
    };
    hd.titleEl.scrollWidth = 1180;
    hd.titleEl.clientWidth = 720;
    assert.equal(hover(), `${name} · Chat menu — double-click to rename`);
    hd.titleEl.scrollWidth = 300;
    hd.titleEl.clientWidth = 300;
    assert.equal(hover(), "Chat menu — double-click to rename");
  } finally {
    delete d.contains;
    doc.restore();
  }
});
