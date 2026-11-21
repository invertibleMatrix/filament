// @ts-check
// Where the chat works under the message box (the owner's of 10-30: the place chip "is shown on the title bar and easy
// to miss"). The header still reads the place — its folder chip wears a worktree's mark — and hands the chip and its
// branch's `+N −N` to the composer's strip, after Overview's button, where the Memory pill stood; the chip's card
// opens above it, and its tooltip says the branch whole, which a long name's chip cuts short.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
/** The chat's folder's place, as `/api/git/place` answers it. */
const PLACE = { ok: true, cwd: "H:/p", place: "H:/p", branch: "a-very-long-branch-name-for-the-strip", also: [] };
/** Other folders' places: a lane ahead of main, and main's own folder. @type {Record<string, any>} */
const PLACES = {
  "H:/lane": { ok: true, cwd: "H:/lane", place: "H:/lane", worktree: true, branch: "lane", base: "main", onBase: false, ahead: 2, behind: 0, sinceBase: { files: 3, added: 5, removed: 1 }, also: [] },
  "H:/main": { ok: true, cwd: "H:/main", place: "H:/main", branch: "main", base: "main", onBase: true, ahead: 0, behind: 0, sinceBase: { files: 2, added: 1, removed: 1 }, also: [] },
  // A chat whose agents also wrote in two worktrees, and one in a single other.
  "H:/two": { ok: true, cwd: "H:/two", place: "H:/two", branch: "main", also: [{ ok: true, cwd: "H:/wt-a", place: "H:/wt-a", worktree: true, branch: "a" }, { ok: true, cwd: "H:/wt-b", place: "H:/wt-b", worktree: true, branch: "b" }] },
  "H:/one": { ok: true, cwd: "H:/one", place: "H:/one", branch: "main", also: [{ ok: true, cwd: "H:/wt-a", place: "H:/wt-a", worktree: true, branch: "a" }] },
};
/** What the page asked of the server. @type {string[]} */
const asked = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {any} */ url, /** @type {any} */ init) => {
  if (typeof url !== "string" || !url.startsWith("/api/")) return realFetch(url, init);
  asked.push(url);
  const cwd = new URL(url, "http://page").searchParams.get("cwd") || "";
  return url.startsWith("/api/git/place?")
    ? new Response(JSON.stringify(PLACES[cwd] || PLACE), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
};
after(() => { g.fetch = realFetch; });
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { createHeader } = await import("../src/ui/harness/header.js");
const { createComposer } = await import("../src/ui/harness/composer/composer.js");

const noop = () => {};
const header = () => /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));

// (fails before: yes — the chip and the count stood in the header's row, beside the chat's name)
test("the header hands its place chip and the last turn's count to the strip under the box, after Overview's button; its row keeps neither", () => {
  const d = stubDocument();
  try {
    const hd = header();
    assert.ok(hd.place, "the header hands the app its place");
    assert.deepEqual([hd.place.querySelectorAll(".place-chip").length, hd.place.querySelectorAll(".c-diff").length], [1, 1], "the chip, then the count");
    assert.deepEqual([hd.el.querySelectorAll(".place-chip").length, hd.el.querySelectorAll(".c-diff").length], [0, 0], "nothing of either in the header");

    const host = /** @type {any} */ (d.document.createElement("div"));
    const c = /** @type {any} */ (createComposer(host, { onSend: () => true, onStop: noop, onOpenOverview: noop, getChat: () => ({ chainId: "c1", turns: [] }) }));
    assert.ok(c.place, "the composer hands the app the place's slot");
    const extras = host.querySelector(".composer-strip .session-extras");
    const order = [...extras.children].map((x) => String(x.getAttribute("class")));
    assert.match(order[0], /session-main/, "Overview's button first");
    assert.deepEqual(order.slice(1, 3), ["strip-sep", "slot-place"], "its rule, then the place");
    assert.equal(extras.children[3], c.slots.strip, "before the strip's widgets, where the Memory pill stood");
    assert.ok(!Object.values(c.slots).includes(c.place), "not a widget slot: mountWidgets never reaches it");
  } finally {
    d.restore();
  }
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\ncomposer\.place\.append\(shell\.header\.place\);\n/);
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\.composer-strip \.slot-place \{ display: contents; \}/, "the slot leaves no box of its own in the strip");
});

// (fails before: yes — the card opened under the chip, as the header's did, and the tooltip never named the branch)
test("the chip's card opens above it, from its left edge; its tooltip names the branch whole", async () => {
  const d = stubDocument();
  try {
    const hd = header();
    const chip = hd.place.querySelector(".place-chip");
    // Where the strip puts it: near the window's foot (the stub's window is 1440 × 900), at the composer's left.
    chip.getBoundingClientRect = () => ({ top: 850, bottom: 872, left: 240, right: 400, width: 160, height: 22 });
    d.document.body.append(hd.place);
    hd.folderIn.value = "H:/p";
    hd.setChat({ id: "c", chainId: "ch", turns: [] });
    for (let i = 0; i < 100 && chip.classList.contains("hidden"); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(chip.querySelector(".place-name").textContent, PLACE.branch, "the chip drawn");
    chip.dispatch("click");
    const pop = d.document.body.querySelector(".zc-popover");
    assert.ok(pop, "its card");
    assert.equal(pop.getAttribute("data-side"), "top", "above the chip");
    assert.equal(pop.style.left, "240px", "from the chip's left edge");
    for (let i = 0; i < 100 && !pop.querySelector(".place-sec"); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(pop.querySelector(".place-sec"), "its place read and drawn");
  } finally {
    d.restore();
  }
  const src = readFileSync("src/ui/harness/header.js", "utf8");
  assert.match(src, /tooltip\(placeChip, \{ title: \(\) => placeTip\(\) \}\);/);
  assert.match(src, /: `Where this chat works\$\{named\}\$\{more\}`;/, "the branch whole on hover");
});

// (fails before: yes — the count was the newest ended turn's, read from its run: a chat on a branch 30 commits ahead of
// main said what its last turn changed, the owner's of 11-08: "it should not show this per turn changes but as a whole
// changes in current working branch")
test("the count under the box is all the chat's branch holds that its base lacks, never a turn's; on its base, what is uncommitted", async () => {
  const d = stubDocument();
  const w = g.window;
  const doc = /** @type {any} */ (d.document);
  doc.contains = (/** @type {any} */ n) => doc.body.contains(n);
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  try {
    const hd = header();
    doc.body.append(hd.place);
    const btn = hd.place.querySelector(".c-diff");
    const count = btn.querySelector(".zc-diff");
    const hover = () => {
      btn.dispatch("pointerenter");
      const said = doc.body.querySelector(".zc-tooltip-title")?.textContent;
      btn.dispatch("pointerleave");
      return said;
    };
    /** @param {string} want */
    const drawn = async (want) => {
      for (let i = 0; i < 100 && count.textContent !== want; i++) await new Promise((r) => setTimeout(r, 5));
      return count.textContent;
    };
    asked.length = 0;
    hd.setChat({ id: "c1", chainId: "s1", cwd: "H:/lane", turns: [{ runId: "r1", status: "done", n: 1 }] });
    assert.equal(await drawn("+5-1"), "+5-1", "the lane's whole, committed and not");
    assert.equal(hover(), "All lane holds that main lacks, committed or not (3 files) — open Changes");
    assert.ok(!asked.some((u) => /\/runs\/|\/changes/.test(u)), `no turn's changes are read for it: ${asked.join(", ")}`);

    hd.setChat({ id: "c2", chainId: "s2", cwd: "H:/main", turns: [] });
    assert.equal(await drawn("+1-1"), "+1-1", "main's own folder: what is uncommitted there");
    assert.equal(hover(), "What is uncommitted on main (2 files) — open Changes");

    hd.setChat({ id: "c3", chainId: "s3", cwd: "H:/p", turns: [] });
    assert.equal(await drawn(""), "", "a place read with no count says none");
  } finally {
    delete doc.contains;
    d.restore();
  }
});

// (fails before: yes — the tooltip said "also wrote in 2 other places", the code's word for a folder or worktree: a
// person reads folders)
test("the chip's tooltip counts the other folders the chat's agents wrote in, in a person's word", async () => {
  const d = stubDocument();
  const w = g.window;
  const doc = /** @type {any} */ (d.document);
  doc.contains = (/** @type {any} */ n) => doc.body.contains(n);
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  try {
    const hd = header();
    doc.body.append(hd.place);
    const chip = hd.place.querySelector(".place-chip");
    const more = chip.querySelector(".place-more");
    const hover = () => {
      chip.dispatch("pointerenter");
      const said = doc.body.querySelector(".zc-tooltip-title")?.textContent;
      chip.dispatch("pointerleave");
      return said;
    };
    /** @param {string} want */
    const drawn = async (want) => {
      for (let i = 0; i < 100 && more.textContent !== want; i++) await new Promise((r) => setTimeout(r, 5));
      return more.textContent;
    };
    hd.setChat({ id: "c1", chainId: "s1", cwd: "H:/two", turns: [] });
    assert.equal(await drawn("+2"), "+2");
    assert.equal(hover(), "Where this chat works: main · also wrote in 2 other folders");
    hd.setChat({ id: "c2", chainId: "s2", cwd: "H:/one", turns: [] });
    assert.equal(await drawn("+1"), "+1");
    assert.equal(hover(), "Where this chat works: main · also wrote in 1 other folder");
    hd.setNow({ place: "H:/elsewhere", home: false });
    assert.equal(hover(), "The agent works in elsewhere now · also wrote in 1 other folder");
  } finally {
    delete doc.contains;
    d.restore();
  }
});
