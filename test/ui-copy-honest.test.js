// @ts-check
// The round's UI/UX review (sa_ae21f3ad, 2026-09-30): the words and chips that still misled after the Stop, Compact
// and Detach work — a no-op stop worded like a miss, a toast that read as "still stuck", a figure hedged on one
// surface and stated as exact on two, an edit chip showing another round's numbers under a "this round" title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { steerWords, roundCompactionWords, alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";

const read = (/** @type {string} */ p) => readFileSync(p, "utf8");

test("a stop that found the turn already done says there was nothing to stop; a message a stop overtook says the turn stopped", () => {
  assert.equal(steerWords({ kind: "stop", unread: true }).state, "Nothing to stop — the turn had already finished");
  assert.equal(steerWords({ kind: "stop" }, { settled: true }).state, "Nothing to stop — the turn had already finished");
  assert.equal(steerWords({ kind: "note", text: "x", unread: true }, { settled: true, stopped: true }).state, "The turn stopped before reading this");
  assert.equal(steerWords({ kind: "note", text: "x", unread: true }, { settled: true }).state, "The run ended before reading this", "a turn that ended on its own keeps the plain words");
  assert.equal(steerWords({ kind: "stop", read: true }, { settled: true, stopped: true }).state, "Stopped");
});

test("the paint hands the turn's stop to its bubbles, and redraws them when the status lands", () => {
  const tl = read("src/ui/harness/conversation/timeline.js");
  assert.match(tl, /const stopped = turn\.status === "stopped";[\s\S]*?steerEl\(s, !live, stopped, /);
  assert.match(tl, /const key = `\$\{live \? "live" : "settled"\}\|\$\{turn\.status\}\|/);
});

test("Compact asked with too little to summarize says that nothing was summarized", () => {
  assert.equal(roundCompactionWords({ manual: true, result: "little" }), "⌁ Compact asked — this turn has too little finished work to summarize yet; nothing was summarized");
});

test("Run in background's toast says the main agent carries on; the status panel's says where the other choice is", () => {
  for (const f of ["src/ui/harness/subagent-viewer.js", "src/ui/harness/app.js"]) {
    const src = read(f);
    assert.doesNotMatch(src, /the turn ends only once it reports/, f);
    assert.match(src, /In the background now — the main agent carries on; this agent keeps running and its report reaches the main agent when it finishes \(the turn waits for that report before it ends\)/, f);
  }
  assert.match(read("src/ui/harness/conversation/status-panel.js"), /To take its report yourself, open its thread and choose Run in background — report to me\./);
});

test("an early Compact says why it can't yet, without blaming the turn", () => {
  const app = read("src/ui/harness/app.js");
  assert.match(app, /The turn hasn't opened its run yet — try Compact again in a few seconds/);
  assert.doesNotMatch(app, /press Compact again in a moment/);
});

// (fails before: no — a guard: the face's words moved into windowFace, shared with the Team view, and are read from
// what it returns)
test("the live context figure is hedged on every surface: the ring's face, its hover title and the popover", async () => {
  const { windowFace } = await import("../src/ui/harness/widgets/context.js");
  const src = read("src/ui/harness/widgets/context.js");
  const view = { settings: { window: { tokens: 100_000 } } };
  const live = { rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, liveHeld: 40_000 };
  assert.equal(windowFace(view, { ...live, streaming: true }).text, "≈40%", "the face, while the turn streams");
  assert.equal(windowFace(view, { ...live, streaming: false }).text, "40%");
  assert.match(src, /the loop's measure while the turn runs; the exact count lands when it ends/, "the title, with or without a window");
});

test("an edit chip counts its own round's change only — no numbers borrowed from another round", async () => {
  const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, json: async () => ({ rounds: [{ round: 1, files: [{ path: "a.js", added: 3, removed: 1, patch: "" }] }] }) }));
  try {
    /** @type {number[][]} */
    const seen = [];
    await inlineEditDiff("run-1", "a.js", { round: 2, onCounts: (p, m) => seen.push([2, p, m]) });
    await inlineEditDiff("run-1", "a.js", { round: 1, onCounts: (p, m) => seen.push([1, p, m]) });
    await inlineEditDiff("run-1", "a.js", { round: null, onCounts: (p, m) => seen.push([0, p, m]) });
    assert.deepEqual(seen, [[1, 3, 1], [0, 3, 1]], "round 2 has no entry of its own: no counts; with the call's round unknown, the one round that touched the file counts");
  } finally {
    globalThis.fetch = real;
  }
});

// (fails before: yes — HarnessV4_Tasks U3, V4-D215: every edit card read the whole run's changes, all at once; in a long
// run each read took 5–6 s, and the compose preview the Context popover and pane wait for queued behind them, so they
// said "Suggested" and drew empty rows)
test("an edit card reads its own round's change, the whole run only where that round took no snapshot; two reads at a time", async () => {
  const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
  const real = globalThis.fetch;
  /** @type {string[]} */
  const asked = [];
  /** @type {Array<() => void>} */
  const held = [];
  const tick = () => new Promise((r) => setImmediate(r));
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
    asked.push(String(url));
    await new Promise((r) => held.push(() => r(null)));
    const round = /[?&]round=(\d+)/.exec(String(url))?.[1];
    return { ok: true, json: async () => ({ rounds: round === "3" ? [] : [{ round: 2, files: [{ path: "a.js", added: 1, removed: 0, patch: "" }] }] }) };
  });
  try {
    /** @type {number[][]} */
    const seen = [];
    const a = inlineEditDiff("run-1", "a.js", { round: 2, onCounts: (p, m) => seen.push([2, p, m]) });
    const b = inlineEditDiff("run-1", "b.js", { round: 2 });
    const c = inlineEditDiff("run-1", "a.js", { round: 3, onCounts: (p, m) => seen.push([3, p, m]) });
    await tick();
    assert.deepEqual(asked, ["/api/runs/run-1/changes?patch=1&path=a.js&round=2", "/api/runs/run-1/changes?patch=1&path=b.js&round=2"], "two at a time: the third waits");
    held.shift()?.();
    await a;
    await tick();
    assert.equal(asked[2], "/api/runs/run-1/changes?patch=1&path=a.js&round=3", "one ends, the next goes");
    held.shift()?.();
    await b;
    held.shift()?.();
    await tick();
    await tick();
    assert.equal(asked[3], "/api/runs/run-1/changes?patch=1&path=a.js", "round 3 took no snapshot: the whole run, as before");
    held.shift()?.();
    await c;
    assert.deepEqual(seen, [[2, 1, 0]], "round 2's own counts; round 3 has no entry of its own, so none");
    assert.equal(asked.length, 4);
  } finally {
    globalThis.fetch = real;
  }
});

// (fails before: yes — HarnessV4_Tasks U3, V4-D219: a live run draws its turn's cards again on every run event
// (timeline.js placeCards), and each drawing of an edit card asked for its change again. The old page sent them all at
// once — 85 on mx774dfh, 5–6 s each — and the Read cards' pictures waited behind them as empty pills (the owner's report,
// 10-12); two at a time, the queue grew instead, the same read in it once per drawing)
test("an edit card drawn again takes the read made for it: shared while out, kept once it held the call's round", async () => {
  const doc = stubDocument();
  const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
  const real = globalThis.fetch;
  /** @type {string[]} */
  const asked = [];
  /** @type {Array<() => void>} */
  const held = [];
  let landed = false; // round 5's snapshot
  const tick = () => new Promise((r) => setImmediate(r));
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
    asked.push(String(url));
    await new Promise((r) => held.push(() => r(null)));
    const round = /[?&]round=(\d+)/.exec(String(url))?.[1];
    const rounds = [{ round: 4, files: [{ path: "a.js", added: 2, removed: 1, patch: "" }] }, ...(landed ? [{ round: 5, files: [{ path: "a.js", added: 7, removed: 0, patch: "" }] }] : [])];
    return { ok: true, json: async () => ({ rounds: round ? rounds.filter((x) => String(x.round) === round) : rounds }) };
  });
  try {
    /** @type {number[][]} */
    const seen = [];
    /** @param {number} p @param {number} m */
    const count = (p, m) => seen.push([p, m]);
    const drawings = [1, 2, 3].map(() => inlineEditDiff("run-m", "a.js", { round: 4, onCounts: count }));
    await tick();
    assert.deepEqual(asked, ["/api/runs/run-m/changes?patch=1&path=a.js&round=4"], "three drawings while the read is out: one read");
    held.shift()?.();
    const els = /** @type {any[]} */ (await Promise.all(drawings));
    assert.deepEqual(seen, [[2, 1], [2, 1], [2, 1]], "each drawing has its counts");
    assert.ok(els.every((el) => el?.textContent === "No patch recorded for this file."), "and the change");
    assert.equal(new Set(els).size, 3, "each its own element: a card never takes another card's");
    const again = /** @type {any} */ (await inlineEditDiff("run-m", "a.js", { round: 4, onCounts: count }));
    assert.deepEqual([asked.length, seen.at(-1), again?.textContent, els.includes(again)], [1, [2, 1], "No patch recorded for this file.", false], "drawn again once it settled: no read, round 4 answered");
    // A card drawn before its round's snapshot landed: asked again by the next drawing, kept once the round answers.
    const early = inlineEditDiff("run-m", "a.js", { round: 5, onCounts: count });
    await tick();
    held.shift()?.();
    await tick();
    await tick();
    held.shift()?.();
    await early;
    assert.deepEqual(asked.slice(1), ["/api/runs/run-m/changes?patch=1&path=a.js&round=5", "/api/runs/run-m/changes?patch=1&path=a.js"], "no round 5 yet: its own read, then the whole run");
    assert.equal(seen.length, 4, "no counts borrowed from round 4");
    landed = true;
    const later = inlineEditDiff("run-m", "a.js", { round: 5, onCounts: count });
    await tick();
    held.shift()?.();
    await later;
    assert.deepEqual([asked.length, seen.at(-1)], [4, [7, 0]], "asked again: what it found before held no round 5");
    await inlineEditDiff("run-m", "a.js", { round: 5 });
    assert.equal(asked.length, 4, "round 5 answered: kept");
  } finally {
    globalThis.fetch = real;
    doc.restore();
  }
});

// (fails before: yes — the owner's report, 10-12: while a tool ran the widgets said "Failed to fetch" (the account's
// check, the Context map). Every drawing of a live turn's cards asked each finished edit card's change again: a 70-minute
// run with 84 edits asked 34,593 times. Past ~1,350 pending requests Chrome refuses every new one at once
// (net::ERR_INSUFFICIENT_RESOURCES), the widgets' among them; the old page, drawn so 500 times in a browser, sent 42,000)
test("a turn of 84 edit cards drawn 500 times: two change reads out at most, one per card in all", async () => {
  const doc = stubDocument();
  const real = globalThis.fetch;
  /** @type {string[]} */
  const asked = [];
  /** @type {Array<() => void>} */
  const held = [];
  const tick = () => new Promise((r) => setImmediate(r));
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
    asked.push(String(url));
    await new Promise((r) => held.push(() => r(null)));
    const path = decodeURIComponent(/path=([^&]+)/.exec(String(url))?.[1] || "");
    return { ok: true, json: async () => ({ rounds: [{ round: 1, files: [{ path, added: 1, removed: 0, patch: "" }] }] }) };
  });
  try {
    /** @type {any[]} */
    const events = [{ type: "run-start", kind: "coding-agent", at: 1 }, { type: "round-start", round: 1, blocksBefore: 0 }];
    for (let i = 0; i < 84; i++)
      events.push(
        { type: "tool-start", round: 1, id: `e${i}`, name: "Edit", card: { kind: "edit", title: "Edit", subject: `src/f${i}.js` } },
        { type: "tool-end", round: 1, id: `e${i}`, name: "Edit", ok: true, ms: 5 },
      );
    const cell = alignEvents(events).byRound.get(1);
    for (let i = 0; i < 500; i++) roundRows(cell, { runId: "run-storm" });
    await tick();
    assert.equal(asked.length, 2, "two out, however many drawings");
    for (let i = 0; i < 400 && held.length; i++) {
      held.shift()?.();
      await tick();
    }
    assert.equal(new Set(asked).size, 84, "each card read");
    assert.equal(asked.length, 84, "once");
    for (let i = 0; i < 500; i++) roundRows(cell, { runId: "run-storm" });
    await tick();
    assert.equal(asked.length, 84, "drawn again: no read");
  } finally {
    globalThis.fetch = real;
    doc.restore();
  }
});

// (fails before: yes — HarnessV4_Tasks V4-D304, the proposal V4-D219 left open: an edit card read its change as it was
// drawn, shown or not. A page opened on a long session asked one read per edit card, every closed fold's among them,
// two at a time, and a fold the person then opened waited behind cards nobody saw)
test("an edit card in a closed fold or group reads its change once that opens; a shown one at once; a fold drawn again and again keeps one listener", async () => {
  const { readWhenShown } = await import("../src/ui/harness/lib/diff-render.js");
  /** A <details> as the rule reads one. @param {boolean} open */
  const details = (open) => {
    /** @type {Array<(e: { currentTarget: any }) => void>} */
    const fns = [];
    return { open, fns, addEventListener: (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => { if (type === "toggle") fns.push(fn); }, toggle(/** @type {boolean} */ o) { this.open = o; for (const fn of [...fns]) fn({ currentTarget: this }); } };
  };
  /** A card's row inside these, nearest first. @param {any[]} chain */
  const rowIn = (chain) => ({ isConnected: true, parentElement: { closest: () => chain.find((d) => !d.open) || null } });
  const tick = () => new Promise((r) => setImmediate(r));
  let read = 0;
  const start = () => { read++; };
  readWhenShown(/** @type {any} */ (rowIn([])), start);
  await tick();
  assert.equal(read, 1, "shown: it reads, once its drawing is on the page");
  const fold = details(false);
  readWhenShown(/** @type {any} */ (rowIn([fold])), start);
  await tick();
  assert.equal(read, 1, "a closed fold's card reads nothing");
  fold.toggle(true);
  await tick();
  assert.equal(read, 2, "opened: it reads");
  const outer = details(false);
  const group = details(false);
  readWhenShown(/** @type {any} */ (rowIn([group, outer])), start);
  await tick();
  outer.toggle(true);
  await tick();
  assert.equal(read, 2, "a group still closed inside the opened fold");
  group.toggle(true);
  await tick();
  assert.equal(read, 3, "both open: it reads");
  // A live turn whose fold is closed: each run event draws its cards again. The drawing on the page waits; the rest go.
  const live = details(false);
  /** @type {any[]} */
  const rows = [];
  for (let i = 0; i < 50; i++) {
    for (const r of rows) r.isConnected = false;
    const r = rowIn([live]);
    rows.push(r);
    readWhenShown(/** @type {any} */ (r), start);
    await tick();
  }
  assert.equal(live.fns.length, 1, "one listener for the fold, however many drawings");
  live.toggle(true);
  await tick();
  assert.equal(read, 4, "the drawing on the page reads, once");
  const render = readFileSync(new URL("../src/ui/harness/conversation/tools/render.js", import.meta.url), "utf8");
  assert.match(render, /known = changeKnown\(runId, target, round, call\);/);
  assert.match(render, /if \(read && known\) read\(row\);\s+else if \(read\) readWhenShown\(row, read\);/, "a change already read draws at once");
});

test("the changes kept are bounded: the one drawn longest ago goes first", async () => {
  const doc = stubDocument();
  const { inlineEditDiff, DIFFS_KEPT } = await import("../src/ui/harness/lib/diff-render.js");
  const real = globalThis.fetch;
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
    asked.push(String(url));
    return { ok: true, json: async () => ({ rounds: [{ round: 1, files: [{ path: /path=([^&]+)/.exec(String(url))?.[1], added: 1, removed: 0, patch: "" }] }] }) };
  });
  try {
    assert.ok(DIFFS_KEPT >= 100, "a long page's edit cards");
    for (let i = 0; i <= DIFFS_KEPT; i++) await inlineEditDiff("run-cap", `f${i}.js`, { round: 1 });
    assert.equal(asked.length, DIFFS_KEPT + 1);
    await inlineEditDiff("run-cap", `f${DIFFS_KEPT}.js`, { round: 1 });
    await inlineEditDiff("run-cap", "f1.js", { round: 1 });
    assert.equal(asked.length, DIFFS_KEPT + 1, "the newest and the second oldest are still kept");
    await inlineEditDiff("run-cap", "f0.js", { round: 1 });
    assert.equal(asked.at(-1), "/api/runs/run-cap/changes?patch=1&path=f0.js&round=1", "the oldest went: read again");
  } finally {
    globalThis.fetch = real;
    doc.restore();
  }
});
