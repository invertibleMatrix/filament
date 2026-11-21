// @ts-check
// HarnessV4_Worktrees_Plan S2, the page's speed (the owner's words of 10-22: "the overall ui seems to be very very slow
// when i switch threads"). A switch between two chats of twenty turns took half a second in one task: every fence of
// the chat coloured again by shiki, and the page laid out once per turn as each was drawn — following the tail and
// measuring each bubble's clamp read the height. Now a fence is coloured once for what it holds, the rest in slices,
// the newest first; the tail is followed once a frame; a clamp is measured once its bubble shows; a command's output
// keeps its place without being measured; a turn off the screen is not laid out (S2's drive: 500 ms → 30-60 ms).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onceAFrame } from "../src/ui/harness/lib/once-a-frame.js";
import { createFencePainter, KEPT_FENCES, SLICE_MS } from "../src/ui/harness/lib/highlighter.js";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), "utf8");

// (fails before: yes — there was no such helper, and each turn laid out followed at once)
test("asked many times before a frame, it runs once in that frame; with no frames, at once", () => {
  /** @type {(() => void)[]} */
  const frames = [];
  let ran = 0;
  const ask = onceAFrame(() => ran++, { frame: (fn) => frames.push(fn) });
  for (let i = 0; i < 60; i++) ask();
  assert.deepEqual([ran, frames.length], [0, 1], "sixty turns laid out ask for one frame");
  /** @type {() => void} */ (frames.shift())();
  assert.equal(ran, 1);
  ask();
  assert.equal(frames.length, 1, "asked again after its frame, it waits for the next");
  let now = 0;
  const bare = onceAFrame(() => now++, { frame: null });
  bare();
  bare();
  assert.equal(now, 2, "no frames: each ask runs");
});

/**
 * A fence as the page draws it: a card with its grammar, a plain pre holding its code; `painted` hears each fence
 * coloured, by its number.
 * @param {string} code @param {string} lang @param {number} n @param {number[]} painted
 */
const fence = (code, lang, n, painted) => {
  /** @type {Map<string, string>} */
  const attrs = new Map([["data-lang", lang]]);
  /** @type {any} */
  const card = {
    isConnected: true,
    attrs,
    hasAttribute: (/** @type {string} */ k) => attrs.has(k),
    getAttribute: (/** @type {string} */ k) => attrs.get(k) ?? null,
    setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => void attrs.set(k, String(v)),
    querySelector: (/** @type {string} */ sel) => (sel === "pre.code" ? card.pre : null),
  };
  card.pre = {
    querySelector: (/** @type {string} */ sel) => (sel === "code" ? { textContent: code } : null),
    replaceWith: (/** @type {any} */ x) => {
      card.pre = x;
      painted.push(n);
    },
  };
  return card;
};
/** @param {any[]} cards */
const rootOf = (cards) => ({ querySelectorAll: (/** @type {string} */ sel) => (sel === ".code-block" ? cards : []) });

/**
 * A painter whose shiki counts what it colours and takes `cost` ms a fence on the test's clock.
 * @param {{ cost?: number, theme?: () => string }} [o]
 */
function painterOf({ cost = 1, theme = () => "github-dark" } = {}) {
  let clock = 0;
  const w = { coloured: /** @type {string[]} */ ([]), rests: 0 };
  const hl = {
    codeToHtml: (/** @type {string} */ code, /** @type {{ lang: string, theme: string }} */ o) => {
      clock += cost;
      w.coloured.push(`${o.theme}:${code}`);
      return `<pre>${code}</pre>`;
    },
  };
  const painter = createFencePainter({
    load: async () => hl,
    parse: (html) => ({ html, cloneNode: () => ({ html, copy: true }) }),
    theme,
    now: () => clock,
    rest: async () => {
      w.rests++;
    },
  });
  return { painter, w };
}

// (fails before: yes — every switch coloured each fence of the chat again, in one task)
test("a fence drawn again is coloured from what was kept: shiki colours each code once", async () => {
  const { painter, w } = painterOf();
  /** @type {number[]} */
  const painted = [];
  const first = [fence("let a = 1;", "js", 1, painted), fence("print(2)", "py", 2, painted)];
  await painter.paint(rootOf(first));
  assert.deepEqual(w.coloured, ["github-dark:print(2)", "github-dark:let a = 1;"]);
  assert.deepEqual(first.map((c) => c.attrs.get("data-hl")), ["github-dark", "github-dark"]);
  // The chat switched away and back: the same fences, drawn anew.
  const again = [fence("let a = 1;", "js", 3, painted), fence("print(2)", "py", 4, painted)];
  await painter.paint(rootOf(again));
  assert.equal(w.coloured.length, 2, "nothing coloured twice");
  assert.deepEqual(painted, [2, 1, 4, 3]);
  assert.equal(again[0].pre.copy, true, "each block takes a copy of its own");
  assert.notEqual(again[0].pre, first[0].pre);
});

// (fails before: yes — in document order, all in one task)
test("the newest fence first, in slices: the page has its turn between them", async () => {
  const { painter, w } = painterOf({ cost: 5 });
  /** @type {number[]} */
  const painted = [];
  const cards = Array.from({ length: 10 }, (_, i) => fence(`code ${i}`, "ts", i, painted));
  await painter.paint(rootOf(cards));
  assert.deepEqual(painted, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], "a chat opens on its tail");
  assert.equal(w.rests, Math.floor((10 * 5) / (Math.ceil(SLICE_MS / 5) * 5)), "a rest after each slice of about SLICE_MS");
});

test("a fence drawn away, coloured by another pass, or streaming while a slice waited is left alone", async () => {
  /** @type {number[]} */
  const painted = [];
  const cards = Array.from({ length: 6 }, (_, i) => fence(`code ${i}`, "js", i, painted));
  let clock = 0;
  const painter = createFencePainter({
    load: async () => ({ codeToHtml: (/** @type {string} */ code) => { clock += SLICE_MS; return code; } }),
    parse: (html) => ({ cloneNode: () => ({ html }) }),
    theme: () => "github-light",
    now: () => clock,
    rest: async () => {
      // While the page had its turn: a switch drew one away, another pass coloured one, one opened again.
      cards[3].isConnected = false;
      cards[2].attrs.set("data-hl", "github-light");
      cards[1].attrs.set("data-open", "");
    },
  });
  await painter.paint(rootOf(cards));
  assert.deepEqual(painted, [5, 4, 0]);
  assert.equal(cards[3].attrs.has("data-hl"), false, "the one drawn away is not stamped");
});

test("the theme is read at each fence; one with no grammar is stamped, uncoloured; no shiki leaves the plain text", async () => {
  let theme = "github-dark";
  const { painter, w } = painterOf({ theme: () => theme });
  /** @type {number[]} */
  const painted = [];
  const cards = [fence("a", "js", 1, painted), fence("b", "brainfuck", 2, painted), fence("c", "js", 3, painted)];
  const flip = cards[2].setAttribute;
  cards[2].setAttribute = (/** @type {string} */ k, /** @type {string} */ v) => {
    flip(k, v);
    theme = "github-light"; // the page's theme flipped after the first fence
  };
  await painter.paint(rootOf(cards));
  assert.deepEqual(w.coloured, ["github-dark:c", "github-light:a"]);
  assert.deepEqual(cards.map((c) => c.attrs.get("data-hl")), ["github-light", "github-light", "github-dark"]);
  assert.deepEqual(painted, [3, 1]);
  const none = createFencePainter({ load: async () => null, parse: () => null, theme: () => "github-dark" });
  const plain = [fence("x", "js", 9, painted)];
  await none.paint(rootOf(plain));
  assert.equal(plain[0].attrs.has("data-hl"), false, "tried again once shiki loads");
});

test("what it keeps is bounded: the fence used longest ago goes first", async () => {
  const { painter, w } = painterOf({ cost: 0 });
  /** @type {number[]} */
  const painted = [];
  await painter.paint(rootOf([fence("kept", "js", 0, painted)]));
  await painter.paint(rootOf(Array.from({ length: KEPT_FENCES - 1 }, (_, i) => fence(`f${i}`, "js", i + 1, painted))));
  await painter.paint(rootOf([fence("kept", "js", 0, painted)]));
  await painter.paint(rootOf([fence("one more", "js", 0, painted)]));
  assert.equal(painter.kept.size, KEPT_FENCES);
  // The batch was coloured newest first, so its last fence was its first coloured: the oldest kept.
  const oldest = `f${KEPT_FENCES - 2}`;
  const before = w.coloured.length;
  await painter.paint(rootOf([fence("kept", "js", 0, painted), fence(oldest, "js", 0, painted), fence("f0", "js", 0, painted)]));
  assert.deepEqual(w.coloured.slice(before), [`github-dark:${oldest}`], "the one used just now stayed; the oldest went");
});

// (fails before: yes — layout() followed at once, ensureView measured each bubble, placeCards measured each output)
test("the timeline lays the page out once a frame as it draws, and a turn off the screen is not laid out", () => {
  const tl = src("harness/conversation/timeline.js");
  const layout = tl.slice(tl.indexOf("  function layout(turn, v) {"), tl.indexOf("   * A settled turn's lines where its coding agent compacted"));
  assert.match(layout, /\n {4}followSoon\(\);\n {2}\}/, "a turn laid out follows at the next frame");
  assert.doesNotMatch(layout, /\bfollow\(\)/);
  assert.match(tl, /const followSoon = onceAFrame\(follow\);/);
  const view = tl.slice(tl.indexOf("  function ensureView(turn) {"), tl.indexOf("  /** @param {number} i the visible turn index */"));
  assert.match(view, /if \(bubble && clampBtn\) clampWhenSeen\(bubble, clampBtn\);/, "a bubble's clamp is measured once it shows");
  assert.doesNotMatch(view, /scrollHeight/);
  assert.match(tl, /\.map\(\(p\) => \[p, outputTops\.get\(p\) \|\| 0\]\)/, "an output's place is the one kept as it scrolled");
  assert.match(tl, /if \(t !== scroller && t\?\.classList\?\.contains\("term-out"\)\) outputTops\.set\(t, Number\(t\.scrollTop\) \|\| 0\);/);
  assert.match(src("harness.css"), /\.transcript-inner > \.turn \{ content-visibility: auto; contain-intrinsic-size: auto 480px;/);
});

// (fails before: yes — a running agent's thread read every output's place at each frame, and laid out every round)
test("an agent's thread reads no output's place as it draws, and a round off the screen is not laid out", () => {
  const sv = src("harness/subagent-viewer.js");
  assert.match(sv, /\.map\(\(p\) => \[\/\*\* @type \{HTMLElement\} \*\/ \(p\), outputTops\.get\(p\) \|\| 0\]\)/, "an output's place is the one kept as it scrolled");
  assert.match(sv, /if \(t\?\.classList\?\.contains\("term-out"\)\) outputTops\.set\(t, Number\(t\.scrollTop\) \|\| 0\);/);
  assert.match(src("harness.css"), /\.sav-rounds > \.sav-round \{ content-visibility: auto; contain-intrinsic-size: auto 100px;/);
});
