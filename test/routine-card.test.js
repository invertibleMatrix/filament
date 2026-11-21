// @ts-check
// A routine or a watcher an agent proposed is proposed right in its chat (the owner's of 11-12: "the watcher that is
// proposed inside the Space is a bad design, watcher should always be proposed right in the chat"): under the call
// that made it, its row says what the call did, and a card stands — the Switch on sheet's parts with Switch on, Not
// now and Ask for a change while it is proposed; one line once it is on, paused, removed, changed by a later call, or
// proposed in another chat; Not now folds it, kept by the browser for that proposal. It follows its Space on the
// page's feed. A settled turn keeps it out of its fold.
import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { proposedOf, routineActions, routineCard, VIEW_ONLY_WORDS } from "../src/ui/harness/conversation/routine-card.js";
import { apartCall, roundRows } from "../src/ui/harness/conversation/tools/render.js";

const AT = 1_794_456_000_000;
const PREVIEW = 'Watcher r3 "Main moved" waits for the person\'s Switch on, on the card under this call and in the Space\'s Watchers: nothing listens until they press it.';
/** A call that proposed r3, as its run said it. @param {Record<string, any>} [o] */
const call = (o = {}) => ({ id: "a1", name: "space", state: "done", preview: PREVIEW, card: { kind: "space", title: "Propose a watcher", subject: "Main moved" }, routine: { project: "p1", routine: "r3", watcher: true, change: false, at: AT }, ...o });
/** r3 as its Space reads it. @param {Record<string, any>} [o] */
const row = (o = {}) => ({
  id: "r3", title: "Main moved", when: "", task: "Read the new commits.", writes: false, trigger: { kind: "commit", branch: "main" }, wakes: "you", state: "proposed", paused: false,
  madeIn: "c1", madeBy: "Release", madeName: "Release", model: "", project: "p1", at: AT, last: null,
  words: { when: "on each new commit on main", may: "runs nothing", allowed: "Runs nothing: you are told", last: "", tone: "", said: "", ran: "", why: "", skipped: "", next: "", nextAt: null, first: "", idle: "", heard: "", told: "nothing runs",
    watches: null, wakes: null, guides: null, lastParts: null,
    press: { on: "", what: "", run: "", pause: "", resume: "", back: "", remove: "", removed: "", more: "Pause and Remove are on its row", chose: "" } },
  ...o,
});

describe("what a space call made", () => {
  // (fails before: yes — nothing read it)
  test("from the run's event; from its answer where none rode; none for a call that made nothing", () => {
    assert.deepEqual(proposedOf(call()), { project: "p1", routine: "r3", watcher: true, change: false, at: AT });
    assert.deepEqual(proposedOf(call({ routine: undefined })), { project: null, routine: "r3", watcher: true, change: false, at: null });
    assert.deepEqual(proposedOf(call({ routine: undefined, preview: 'Routine r4 "Morning brief" (weekdays at 09:00, reads only) is changed and waits for the person\'s Switch on, on the card under this call and in the Space\'s Routines…' })), { project: null, routine: "r4", watcher: false, change: true, at: null });
    assert.equal(proposedOf(call({ state: "running" })), null);
    assert.equal(proposedOf(call({ state: "failed", routine: undefined, preview: "Error: Not written: a routine needs a title." })), null);
    assert.equal(proposedOf(call({ routine: undefined, preview: "Added t3 to Planned." })), null);
  });
});

describe("the card under the call", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Map<string, string>} */
  const kept = new Map();
  /** What the card wrote. @type {any[][]} */
  const wrote = [];
  /** The Space's feed's listeners. @type {Set<() => void>} */
  const heard = new Set();
  /** r3 as the stand-in Space has it now. @type {any} */
  let now = row();
  let n = 0;
  const settle = () => new Promise((r) => setImmediate(r));
  /** @param {any} el @param {string} words */
  const press = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);
  const lineOf = (/** @type {any} */ el) => String(el.querySelector(".rp-words")?.textContent || "");
  /** A card for a fresh call: each call has its own. @param {Record<string, any>} [o] */
  const cardFor = (o = {}) => /** @type {any} */ (routineCard({ project: "p1", routine: "r3", watcher: true, change: false, at: AT, ...o }, `call${++n}`));
  before(() => {
    doc = stubDocument();
    Object.defineProperty(globalThis, "localStorage", { value: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) }, configurable: true, writable: true });
  });
  after(() => {
    Object.assign(routineActions, { here: null, read: null, watch: null, write: null, askChat: null, openChat: null, openSpace: null, catalogue: null, modelName: null, viewOnly: null });
    delete (/** @type {any} */ (globalThis)).localStorage;
    doc.restore();
  });
  beforeEach(() => {
    wrote.length = 0;
    kept.clear();
    now = row();
    Object.assign(routineActions, {
      here: () => ({ chain: "c1", project: "p1" }),
      read: async (/** @type {string} */ project, /** @type {string} */ id) => (now ? { routine: { ...now, project, id }, place: "app" } : { gone: "It is no longer in its Space." }),
      watch: (/** @type {string} */ _p, /** @type {() => void} */ fn) => (heard.add(fn), () => heard.delete(fn)),
      write: async (/** @type {any[]} */ ...args) => {
        wrote.push(args);
        if (args[3] === "/on") now = { ...now, state: "on" };
        return { ok: true };
      },
      askChat: (/** @type {string} */ chain, /** @type {string} */ words) => void wrote.push(["ask", chain, words]),
      openChat: (/** @type {string} */ chain) => void wrote.push(["open", chain]),
      openSpace: (/** @type {string} */ project, /** @type {boolean} */ watcher) => void wrote.push(["space", project, watcher]),
      viewOnly: () => false,
    });
  });
  const tell = () => {
    for (const fn of [...heard]) fn();
  };

  // (fails before: yes — a proposal was the generic row, and the Switch on sheet was the Space's alone)
  test("proposed: the sheet's parts and presses in the card, no Made in in the chat that made it; Switch on writes what it showed, and it says it listens", async () => {
    const el = cardFor();
    await settle();
    assert.equal(el.querySelector(".sp-sheet-title")?.textContent, "Switch on “Main moved”?");
    assert.equal(el.querySelector(".rp-tag")?.textContent, "Proposed");
    assert.deepEqual(el.querySelectorAll("h4").map((/** @type {any} */ x) => x.textContent), ["What it does", "When", "What it may do"], "no Made in: this is the chat that made it");
    assert.deepEqual(el.querySelectorAll(".sdb-keep-foot button").map((/** @type {any} */ b) => b.textContent), ["Ask for a change…", "Not now", "Switch on"]);
    press(el, "Ask for a change…").dispatch("click");
    assert.equal(wrote[0][0], "ask");
    assert.equal(wrote[0][1], "c1", "this chat's box");
    press(el, "Switch on").dispatch("click");
    await settle();
    await settle();
    assert.deepEqual(wrote.slice(1), [["p1", "r3", "POST", "/on", { at: AT }]]);
    assert.equal(lineOf(el), "Watcher “Main moved” listens: on each new commit on main.");
    assert.deepEqual(el.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["What it does", "Watchers"]);
    press(el, "What it does").dispatch("click");
    assert.equal(el.querySelector(".sp-sheet-title")?.textContent, "What “Main moved” does");
    assert.equal(el.querySelector(".rp-tag")?.textContent, "Listening");
    press(el, "Close").dispatch("click");
    assert.match(lineOf(el), /listens/);
    press(el, "Watchers").dispatch("click");
    assert.deepEqual(wrote.at(-1), ["space", "p1", true]);
  });

  // (fails before: yes — the same)
  test("the Space moving is heard: paused, removed, gone — each a line", async () => {
    now = row({ state: "on" });
    const el = cardFor();
    await settle();
    assert.match(lineOf(el), /listens/);
    now = row({ state: "on", paused: true, pausedWhy: "CI is red" });
    tell();
    await settle();
    assert.equal(lineOf(el), "Watcher “Main moved” is paused: CI is red.");
    now = row({ state: "removed" });
    tell();
    await settle();
    assert.equal(lineOf(el), "Watcher “Main moved” was removed: Put back is in the Space.");
    now = null;
    tell();
    await settle();
    assert.equal(lineOf(el), "It is no longer in its Space.");
  });

  // (fails before: yes — the same)
  test("Not now folds it for this browser, and Switch on… opens it again; a change by its agent unfolds it", async () => {
    const el = cardFor();
    await settle();
    press(el, "Not now").dispatch("click");
    assert.equal(lineOf(el), "Watcher “Main moved” waits for your Switch on.");
    assert.ok(el.classList.contains("is-folded"));
    // Drawn again — a reload's card for the same proposal — it stays folded.
    const again = cardFor();
    await settle();
    assert.equal(lineOf(again), "Watcher “Main moved” waits for your Switch on.");
    press(again, "Switch on…").dispatch("click");
    assert.equal(again.querySelector(".sp-sheet-title")?.textContent, "Switch on “Main moved”?");
    // Its agent changed it: the card of the call that changed it asks again, whole.
    now = row({ at: AT + 60_000, title: "Main moved again" });
    const changed = cardFor({ at: AT + 60_000, change: true });
    await settle();
    assert.equal(changed.querySelector(".sp-sheet-title")?.textContent, "Switch on “Main moved again”?");
    assert.equal(changed.querySelector(".rp-tag")?.textContent, "Changed");
    // And the first call's card says a later call changed it.
    tell();
    await settle();
    assert.equal(lineOf(el), "A later call changed “Main moved again”: its card further down asks you.");
  });

  // (fails before: yes — the same)
  test("another chat's proposal says where it is switched on; a view-only page switches nothing", async () => {
    routineActions.here = () => ({ chain: "c9", project: "p1" });
    const fork = cardFor();
    await settle();
    assert.equal(lineOf(fork), "Watcher “Main moved” waits for its Switch on in “Release”.");
    press(fork, "Open it").dispatch("click");
    assert.deepEqual(wrote.at(-1), ["open", "c1"]);
    routineActions.here = () => ({ chain: "c1", project: "p1" });
    routineActions.viewOnly = () => true;
    const viewer = cardFor();
    await settle();
    assert.equal(lineOf(viewer), `Watcher “Main moved” waits for its Switch on. ${VIEW_ONLY_WORDS}`);
    assert.equal(press(viewer, "Switch on"), undefined);
  });

  // A second read (the review of 11-12) found these four.
  // (fails before: yes — the card was kept by its call alone, and the fork was handed its chat's card)
  test("a fork draws its own card for the call it holds of its chat: it says where the proposal is switched on", async () => {
    const p = { project: "p1", routine: "r3", watcher: true, change: false, at: AT };
    const mine = /** @type {any} */ (routineCard(p, "held-call"));
    await settle();
    assert.equal(mine.querySelector(".sp-sheet-title")?.textContent, "Switch on “Main moved”?");
    routineActions.here = () => ({ chain: "c9", project: "p1" });
    const fork = /** @type {any} */ (routineCard(p, "held-call"));
    await settle();
    assert.notEqual(fork, mine);
    assert.equal(lineOf(fork), "Watcher “Main moved” waits for its Switch on in “Release”.");
  });

  // (fails before: yes — the Space's read before the press's answer drew the listens line over the sheet, its address
  // never shown; and Close then folded a watcher that was on)
  test("a watcher a program posts to, switched on in the card while the Space is heard first: its address stays in sight, its tag says it listens, Close folds nothing", async () => {
    now = row({ trigger: { kind: "webhook" }, words: { ...row().words, webhook: { made: "Made as you switch it on.", signed: "", header: "", bounds: "60 posts a minute." } } });
    routineActions.write = async (/** @type {any[]} */ ...args) => {
      wrote.push(args);
      if (args[3] === "/on") {
        now = { ...now, state: "on" };
        tell();
        await settle();
        await settle();
      }
      return { ok: true };
    };
    const el = cardFor();
    await settle();
    press(el, "Switch on").dispatch("click");
    for (let i = 0; i < 4; i++) await settle();
    assert.equal(el.querySelector(".sp-sheet-title")?.textContent, "What “Main moved” does");
    assert.ok(el.querySelector(".srw"), "its address part, in sight");
    assert.equal(el.querySelector(".rp-tag")?.textContent, "Listening");
    assert.ok(el.classList.contains("is-on"));
    press(el, "Close").dispatch("click");
    assert.match(lineOf(el), /listens/);
    assert.equal(kept.get("harness.routineFolded"), undefined, "nothing folded");
  });

  // (fails before: yes — each drawing made a new wrapper, the card moved into it and back)
  test("drawn again, the call's row is drawn into the one that stands and its card never leaves it", async () => {
    const drawn = new Map();
    const t = call({ id: "kept-1" });
    const cell = (/** @type {any} */ c) => /** @type {any} */ ({ round: 1, order: [c.id], tools: new Map([[c.id, c]]), plan: null });
    const [first] = /** @type {any[]} */ (roundRows(cell(t), { drawn }));
    const card = first.querySelector(".rp-card");
    let moves = 0;
    let parent = card.parentNode;
    Object.defineProperty(card, "parentNode", { configurable: true, get: () => parent, set: (v) => { if (v !== parent) moves += 1; parent = v; } });
    const [again] = /** @type {any[]} */ (roundRows(cell({ ...t, ms: 4200 }), { drawn }));
    assert.equal(again, first, "the wrapper that stands");
    assert.equal(again.querySelector(".rp-card"), card);
    assert.equal(moves, 0, "the card stayed where it was");
    await settle();
  });

  // (fails before: yes — a proposal was the generic row)
  test("its row says what the call did, a coding agent's call alike; settled, it stands apart from the fold; a failed call is the plain row", async () => {
    for (const name of ["space", "mcp__filament__space"]) {
      const t = call({ id: `r-${name}`, name });
      const cell = { round: 1, order: [t.id], tools: new Map([[t.id, t]]), plan: null };
      const [wrap] = /** @type {any[]} */ (roundRows(/** @type {any} */ (cell)));
      assert.ok(wrap.classList.contains("rp-call"), name);
      assert.match(String(wrap.querySelector(".tool-kind, summary")?.textContent), /Proposed a watcher/);
      assert.ok(wrap.querySelector(".rp-card"), "the card under it");
      assert.equal(apartCall(t), true, "out of a settled turn's fold");
    }
    const failed = call({ id: "f1", state: "failed", routine: undefined, preview: "Error: Not written: a routine needs a title." });
    const [plain] = /** @type {any[]} */ (roundRows(/** @type {any} */ ({ round: 1, order: ["f1"], tools: new Map([["f1", failed]]), plan: null })));
    assert.equal(plain.classList.contains("rp-call"), false);
    assert.equal(apartCall(failed), false);
    await settle();
  });
});
