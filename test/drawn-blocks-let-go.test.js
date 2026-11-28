// @ts-check
// What a turn draws goes with the drawing it was drawn in. The page draws a chat's turns again whole — a chat opened, a
// turn ended, its history read again — so a module that kept what it drew kept every old drawing (the turn's whole DOM,
// its images too) for the page's life: the window's page grew past 12 GB. The Appearance switches are said on the
// page's root, where the stylesheet hides what they hide; a card that follows a store lets go of it once drawn over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const url = (/** @type {string} */ p) => JSON.stringify(new URL(p, import.meta.url).href);

/**
 * `script` run in a node of its own, where garbage can be collected (--expose-gc), after a stub page and its storage;
 * `collect()` collects it. Its last line, read as JSON. @param {string} script @returns {any}
 */
function inNode(script) {
  const run = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
const { stubDocument } = await import(${url("./helpers/dom-stub.js")});
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => void stored.set(k, String(v)) };
const tick = () => new Promise((r) => setTimeout(r, 0));
const collect = async () => { await tick(); globalThis.gc(); await tick(); globalThis.gc(); };
${script}`], { encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").at(-1) || "{}");
}

// (fails before: yes — reasoning.js's `live` and render.js's `todos` kept all 50 drawings, and said nothing on the root)
test("fifty turns drawn over each other leave none of their thinking blocks or plan cards behind; the switches are said on the root", () => {
  const out = inNode(`
const { thinkEl } = await import(${url("../src/ui/harness/conversation/reasoning.js")});
const { planCard } = await import(${url("../src/ui/harness/conversation/tools/render.js")});
const { prefs } = await import(${url("../src/ui/harness/prefs.js")});
const { document } = stubDocument();
// Drawn in a function of its own: a value left in the module's suspended frame between its awaits is not the page's.
const draw = (i) => {
  const turn = document.createElement("section");
  turn.append(
    thinkEl({ text: "Which file holds the name? " + i, done: true }, { isFirst: i % 2 === 0 }).el,
    planCard([{ text: "read the callers", status: "doing" }, { text: "rename", status: "pending" }], () => {}),
  );
  document.body.replaceChildren(turn);
  return new WeakRef(turn);
};
const drawings = Array.from({ length: 50 }, (_, i) => draw(i));
document.body.replaceChildren();
await collect();
const root = document.documentElement;
const said = () => [root.hasAttribute("data-hide-reasoning"), root.hasAttribute("data-hide-todos")];
const shown = said();
prefs.set("showReasoning", false);
prefs.set("showTodos", false);
const hidden = said();
prefs.set("showReasoning", true);
prefs.set("showTodos", true);
console.log(JSON.stringify({ kept: drawings.filter((d) => d.deref()).length, shown, hidden, again: said() }));
`);
  assert.deepEqual(out, { kept: 0, shown: [false, false], hidden: [true, true], again: [false, false] });
});

// (fails before: yes — the owner's of 11-10: the step in progress was an arrow)
test("a plan card's step in progress is a spinner, turning while its turn runs, still once it is over; the stylesheet turns it, and holds it where motion is reduced", () => {
  const out = inNode(`
const { planCard } = await import(${url("../src/ui/harness/conversation/tools/render.js")});
const { ICONS } = await import(${url("../src/ui/harness/lib/icons.js")});
stubDocument();
const items = [{ text: "map", status: "done" }, { text: "fix", status: "doing" }, { text: "test", status: "pending" }];
const icons = (live) => [...planCard(items, () => {}, live).querySelectorAll(".plan-ic")].map((e) => [e.className, e.innerHTML === ICONS.loader]);
console.log(JSON.stringify({ live: icons(true), over: icons(false) }));
`);
  assert.deepEqual(out, {
    live: [["plan-ic done", false], ["plan-ic doing is-live", true], ["plan-ic pending", false]],
    over: [["plan-ic done", false], ["plan-ic doing", true], ["plan-ic pending", false]],
  });
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.ok(css.includes(".plan-ic.doing.is-live svg { animation: spin 1s steps(8, end) infinite; }"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce) { .plan-ic.doing.is-live svg { animation: none; } }"));
});

test("the stylesheet hides what the root says: every thinking block but a turn's first, and every plan card", () => {
  const css = readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8");
  const rule = ":root[data-hide-reasoning] .a-think:not(.is-first), :root[data-hide-todos] .todo-card { display: none; }";
  assert.ok(css.includes(rule), rule);
});

// (fails before: yes — each team card heard the teams' list until the list next spoke, holding its drawing: 50 kept,
// 51 listening)
test("a team's card drawn over lets go of the teams' list at the next drawing, though the list stays quiet", () => {
  const out = inNode(`
const { besideMarkRow, besideActions } = await import(${url("../src/ui/harness/conversation/beside-marks.js")});
const listening = new Set();
besideActions.row = () => null;
besideActions.watch = (fn) => {
  listening.add(fn);
  return () => listening.delete(fn);
};
const { document } = stubDocument();
const draw = (i) => {
  const turn = document.createElement("section");
  turn.append(besideMarkRow({ type: "team", event: i % 2 ? "result" : "fired", id: "team-" + i, at: 0, afterTurn: 0 }));
  document.body.replaceChildren(turn);
  return new WeakRef(turn);
};
// Each drawing a task of its own, as a chat's switch is; the last stands, its card following the list.
const drawings = [];
for (let i = 0; i < 50; i++) {
  drawings.push(draw(i));
  await tick();
}
draw(50);
await collect();
const kept = drawings.filter((d) => d.deref()).length;
const after = listening.size;
// The last drawing taken away with none after it: the list's next word lets its card go.
document.body.replaceChildren();
for (const fn of [...listening]) fn();
console.log(JSON.stringify({ kept, listening: after, spoken: listening.size }));
`);
  assert.deepEqual(out, { kept: 0, listening: 1, spoken: 0 });
});

// (fails before: yes — only a sweep said a row was seen: one placed after the sweep its making ran, with no row made
// after it, heard the store for good once drawn over)
test("a row placed after its own sweep is seen when the store speaks while it is drawn, and let go once drawn over", async () => {
  const { stubDocument } = await import("./helpers/dom-stub.js");
  const { followWhileDrawn } = await import("../src/ui/harness/lib/follow-drawn.js");
  const { document, restore } = stubDocument();
  try {
    /** @type {Set<() => void>} */
    const listening = new Set();
    const watch = (/** @type {() => void} */ fn) => (listening.add(fn), () => void listening.delete(fn));
    let painted = 0;
    const row = document.createElement("div");
    followWhileDrawn(/** @type {any} */ (row), watch, () => painted++);
    await new Promise((r) => setTimeout(r, 0));
    document.body.append(row);
    for (const fn of [...listening]) fn();
    document.body.replaceChildren();
    for (const fn of [...listening]) fn();
    assert.deepEqual({ painted, listening: listening.size }, { painted: 1, listening: 0 });
  } finally {
    restore();
  }
});

// (fails before: yes — a row drawn into the one on the page (dom.js `morph`, the owner's of 11-01: buttons blinking under
// the pointer) is never in the document, so it was never seen, and heard the store for good: one more at every draw)
test("a row drawn into the one on the page lets go at once: the row that stands follows for it", async () => {
  const { stubDocument } = await import("./helpers/dom-stub.js");
  const { followWhileDrawn } = await import("../src/ui/harness/lib/follow-drawn.js");
  const { h, morph } = await import("../src/ui/lib/dom.js");
  const { document, restore } = stubDocument();
  try {
    /** @type {Set<() => void>} */
    const listening = new Set();
    const watch = (/** @type {() => void} */ fn) => (listening.add(fn), () => void listening.delete(fn));
    const painted = { live: 0, drawn: 0 };
    let gone = 0;
    const live = h("div", { class: "card" }, "a");
    document.body.append(live);
    followWhileDrawn(/** @type {any} */ (live), watch, () => painted.live++);
    for (let i = 0; i < 3; i++) {
      const next = h("div", { class: "card" }, "b");
      followWhileDrawn(/** @type {any} */ (next), watch, () => painted.drawn++, () => gone++);
      morph(live, next);
    }
    await new Promise((r) => setTimeout(r, 0));
    for (const fn of [...listening]) fn();
    assert.deepEqual({ ...painted, gone, listening: listening.size }, { live: 1, drawn: 0, gone: 3, listening: 1 });
  } finally {
    restore();
  }
});

// (fails before: yes — the owner's of 11-17: a command's output queued a frame callback over itself at each drawing
// (render.js `termOut`), and a window that gets no frames — hidden, covered, the screen locked — kept every drawing it
// made while nobody looked: in the lab, three switches back to a long chat kept 14,064 rows behind 9,359 callbacks)
test("fifty drawings of a running command, drawn over each other while the window gets no frames, leave none behind; the frame that comes puts the output on the page at its end", () => {
  const out = inNode(`
// A window that gets no frames: Chromium keeps each callback until frames come back.
const frames = [];
globalThis.requestAnimationFrame = (fn) => (frames.push(fn), frames.length);
const { document } = stubDocument();
// The page's clock (turn.js ticking), on a timer that holds no process open; its sweep lets a row off the page go.
window.setInterval = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
const { alignEvents } = await import(${url("../src/ui/harness/lib/labels.js")});
const { roundRows } = await import(${url("../src/ui/harness/conversation/tools/render.js")});
const events = (i) => [
  { type: "tool-start", round: 1, name: "bash", args: "npm test", id: "c" + i, input: { command: "npm test" }, ts: Date.now() },
  { type: "tool-output", round: 1, id: "c" + i, text: "PASS a.test.js " + i },
];
const draw = (i) => {
  const turn = document.createElement("section");
  turn.append(...roundRows(alignEvents(events(i)).byRound.get(1), { live: true }));
  document.body.replaceChildren(turn);
  return new WeakRef(turn);
};
const drawings = Array.from({ length: 50 }, (_, i) => draw(i));
await new Promise((r) => setTimeout(r, 1100));
await collect();
const kept = drawings.filter((d) => d.deref()).length;
const asked = frames.length;
const shown = document.body.querySelector("pre.term-out");
const before = shown.hasAttribute("data-end");
for (const f of frames.splice(0)) f();
console.log(JSON.stringify({ kept, asked, before, after: shown.hasAttribute("data-end") }));
`);
  assert.deepEqual(out, { kept: 1, asked: 1, before: true, after: false }, "the drawing on the page alone stays; one frame asked for all; it puts the output at its end");
});

// (fails before: yes — a reply's markdown block queued its paint over its element, the same way)
test("fifty replies streaming into drawings drawn over each other while the window gets no frames leave none behind; the frame that comes paints the one on the page", () => {
  const out = inNode(`
const frames = [];
globalThis.requestAnimationFrame = (fn) => (frames.push(fn), frames.length);
globalThis.cancelAnimationFrame = () => {};
const { document } = stubDocument();
window.setInterval = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
const { blockEl } = await import(${url("../src/ui/harness/conversation/timeline.js")});
const draw = (i) => {
  const turn = document.createElement("section");
  const block = { text: "First words " + i };
  const b = blockEl(block);
  turn.append(b.el);
  document.body.replaceChildren(turn);
  block.text += " and more";
  b.draw();
  return { ref: new WeakRef(turn), b };
};
const drawn = Array.from({ length: 50 }, (_, i) => draw(i));
const last = drawn.at(-1).b;
const refs = drawn.map((d) => d.ref);
drawn.length = 0;
await collect();
const kept = refs.filter((d) => d.deref()).length;
// The stub keeps a block's markup as given, in a node of its own.
const markup = () => last.el.children.map((c) => c.html || "").join("");
const before = markup().includes("and more");
const asked = frames.length;
for (const f of frames.splice(0)) f();
console.log(JSON.stringify({ kept, asked, before, after: markup().includes("and more") }));
`);
  assert.deepEqual(out, { kept: 1, asked: 1, before: false, after: true }, "the drawing on the page alone stays; one frame asked for all fifty; the words painted when it comes");
});
