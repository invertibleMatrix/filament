// @ts-check
// Not now on the card that stopped a message before it was sent gives the message back (the owner's of 11-01: "if we
// press Not Now on compaction card then the message should not go in transcript. it should return back into composer
// with everything like if file is attached that should also be back"). The card only closed: the message stood in the
// chat as a bubble that "waits for your answer", sent nowhere. Now its row goes and the message — its words as they were
// typed, its pictures and files — is in the box again, ahead of what the box holds; a turn on record (a seed its agent
// refused) keeps its row, the card closed. With everything it went with (the review of 11-01): the answers it overruled
// are on the line over the box again, a message of files alone puts no blank lines ahead of what the box holds, its
// words kept for a refresh and typed on in the box come back once, and the chat it was the only message of is named as
// it is again. The real card, timeline and box are drawn on the stub document; the page's answer is lifted from app.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";
import { askCard, askOf, switchCard, withoutAsked } from "../src/ui/harness/conversation/interaction.js";
import { againOf } from "../src/ui/harness/lib/labels.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";

const g = /** @type {any} */ (globalThis);
/** The server's refusal of a message whose cache went cold: it asks first, nothing sent. */
const COLD_BODY = Object.freeze({ resumeQuestion: { why: "cold", held: 9 } });
const SWITCH_BODY = Object.freeze({ switchQuestion: { suggested: "words" } });
const FILE = Object.freeze({ kind: "text", name: "build.log", size: 3, type: "text/plain", data: "eHl6" });
const PIC = Object.freeze({ kind: "image", name: "shot.png", size: 3, type: "image/png", data: "iVBO" });
/** Saved agents' answers a message overrules (HarnessV4_Tasks E15 step 3), whole as the box holds them. */
const PM_OVER = Object.freeze({ agentId: "sa_pm", exchange: 1, name: "PM", question: "is it worth building?", answer: "Yes: ship the smallest version." });
const SKEPTIC_OVER = Object.freeze({ agentId: "sa_sk", exchange: 2, name: "Skeptic", question: "what was not tested?", answer: "The linker's flags." });
/** A turn of the page's: one answered, or one the server stopped to ask before it sent. @param {Record<string, any>} [o] */
const turnOf = (o = {}) => ({ n: 1, status: "done", userText: "hello", attachments: [], sent: [], blocks: [], steers: [], segments: [], past: false, startedAt: Date.now(), ...o });
/** @param {Record<string, any>} [o] */
const stoppedOf = (o = {}) => turnOf({ n: 2, status: "error", error: "This chat sat idle and its cache has gone cold.", errorDetail: "", userText: "fix the build", reply: { error: "asks", errorBody: COLD_BODY }, ...o });
/** A seed its agent refused: a turn on record. */
const seedOf = () => turnOf({ n: 2, status: "error", error: "the earlier conversation was too long for Codex to take in", errorDetail: "", reply: { error: "refused" }, facts: { needsRoom: true } });
/** A button by its words. @param {any} el @param {string} words */
const buttonOf = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);

// (fails before: yes — a stopped message's Not now said "your message stays here, unsent", and a switch's Dismiss said
// nothing)
test("the card says where the message goes: back to the box where it was never sent; nowhere where it is on record", () => {
  const doc = stubDocument();
  try {
    const back = "Close the card: your message goes back to the box";
    for (const ask of [askOf(COLD_BODY, null), { kind: "size" }, { kind: "lost" }])
      assert.equal(buttonOf(askCard("q", /** @type {any} */ (ask), { onCompact() {}, onDismiss() {} }), "Not now").getAttribute("title"), back, String(ask?.kind));
    assert.equal(buttonOf(askCard("refused", { kind: "refused" }, { onCompact() {}, onDismiss() {} }), "Not now").getAttribute("title"), "Close the card", "a turn on record stays");
    assert.equal(buttonOf(switchCard("w", /** @type {any} */ (askOf(SWITCH_BODY, null)), { onSwitch() {}, onDismiss() {} }), "Dismiss").getAttribute("title"), back);
  } finally {
    doc.restore();
  }
});

describe("the card on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let dom;
  /** @type {any} */
  let tl;
  /** @type {any} */
  let host;
  /** The turns the page was asked to take back. @type {any[]} */
  const asked = [];
  const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
  before(async () => {
    dom = stubDocument();
    g.requestAnimationFrame ||= () => 0;
    g.cancelAnimationFrame ||= () => {};
    g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.getComputedStyle ||= () => ({});
    g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
    g.sessionStorage ||= g.localStorage;
    Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
    const d = /** @type {any} */ (dom.document);
    d.addEventListener ||= () => {};
    d.removeEventListener ||= () => {};
    const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
    host = document.createElement("div");
    // The page's answer, as app.js gives it: a message on no record goes, its row with it; one on record stays.
    tl = createTimeline(host, /** @type {any} */ ({
      onRetry() {},
      onTakeBack: (/** @type {any} */ c, /** @type {any} */ t) => {
        asked.push(t);
        const unasked = withoutAsked(c.turns, t);
        if (!unasked) return false;
        c.turns = unasked;
        tl.dropTurn(t);
        return true;
      },
    }));
  });
  after(() => {
    for (const k of ADDED) delete g[k];
    dom.restore();
  });
  const rows = () => host.querySelectorAll("section.turn").length;

  // (fails before: yes — Not now and the × closed the card alone, and the message stood in the chat)
  test("Not now, the × and a switch's Dismiss hand the stopped message to the page, which takes its row", () => {
    for (const [body, press] of /** @type {const} */ ([[COLD_BODY, "Not now"], [COLD_BODY, "×"], [SWITCH_BODY, "Dismiss"]])) {
      asked.length = 0;
      const stopped = stoppedOf({ reply: { error: "asks", errorBody: body } });
      const chat = { turns: [turnOf(), stopped], live: null };
      tl.render(chat);
      assert.equal(rows(), 2);
      const btn = press === "×" ? host.querySelector(".ix-ask-x") : buttonOf(host, press);
      assert.ok(btn, `the card is drawn, with its ${press}`);
      btn.dispatch("click");
      assert.deepEqual(asked, [stopped], press);
      assert.equal(rows(), 1, `${press}: the message's row is gone`);
      assert.deepEqual(chat.turns.map((t) => t.n), [1]);
    }
  });

  // (fails before: yes, on its ask alone — the card closed and the row stayed then too, as they still do for a turn on
  // record, but the page was never asked)
  test("a seed its agent refused is on record: the page keeps its row, and the card closes", () => {
    asked.length = 0;
    const seed = seedOf();
    const chat = { turns: [turnOf(), seed], live: null };
    tl.render(chat);
    buttonOf(host, "Not now").dispatch("click");
    assert.deepEqual(asked, [seed], "asked, and it said no");
    assert.equal(rows(), 2, "the row stays");
    assert.equal(buttonOf(host, "Not now"), undefined, "the card is closed");
    assert.equal(/** @type {any} */ (seed).shimDismissed, true, "and stays closed when the turn is drawn again");
  });
});

describe("the page's answer (app.js takeBackAsked)", () => {
  /**
   * The page's stand-ins around the chat shown: the transcript's drops and draws, the chat's name in the header and its
   * row in the left bar, and a box that holds words, files and what they overrule as the composer does (`takeBack` puts
   * the message ahead of what the box holds).
   * @param {any} chat @param {{ box?: string, files?: any[], shown?: string }} [o]
   */
  const page = (chat, { box = "", files = [], shown = "c1" } = {}) => {
    const o = { dropped: /** @type {any[]} */ ([]), drawn: /** @type {any[]} */ ([]), status: /** @type {any[]} */ ([]), titled: /** @type {any[]} */ ([]), rows: 0, box, files: [...files], overruling: /** @type {any[]} */ ([]) };
    const composer = {
      draft: () => o.box,
      setDraft: (/** @type {string} */ t, /** @type {any[] | undefined} */ f) => { o.box = t || ""; if (f) o.files = [...f]; },
      takeBack: (/** @type {string} */ text, /** @type {any[]} */ f = [], /** @type {any[]} */ over = []) => {
        const had = o.box.replace(/^\s+/, "");
        o.box = text && had ? `${text}\n\n${had}` : text || had;
        o.files = [...f, ...o.files];
        o.overruling = [...o.overruling, ...over];
      },
    };
    const { takeBackAsked } = lift(["takeBackAsked"], {
      state: { currentId: shown },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      withoutAsked,
      againOf,
      composer,
      transcript: { dropTurn: (/** @type {any} */ t) => void o.dropped.push(t) },
      drawChat: (/** @type {any} */ c) => void o.drawn.push(c),
      paintStatus: (/** @type {any} */ c) => void o.status.push(c),
      setTitle: (/** @type {any} */ c) => void o.titled.push(c),
      sidebar: { drawOpen: () => void o.rows++ },
    });
    return { o, takeBack: (/** @type {any} */ t) => takeBackAsked(chat, t) };
  };

  // (fails before: yes — the page had no answer: the message stayed in the chat and the box stayed as it was)
  test("a message the card stopped: its row goes, and its words, pictures and files are back in the box ahead of what it holds", () => {
    const done = turnOf();
    const stopped = stoppedOf({ sent: [FILE, PIC], attachments: [{ name: FILE.name, size: 3, kind: "text" }, { name: PIC.name, size: 3, kind: "image" }] });
    const chat = { id: "c1", turns: [done, stopped] };
    const { o, takeBack } = page(chat, { box: "and run the tests" });
    assert.equal(takeBack(stopped), true);
    assert.deepEqual(chat.turns, [done]);
    assert.deepEqual(o.dropped, [stopped], "its row goes where it stands, the chat not drawn again");
    assert.equal(o.box, "fix the build\n\nand run the tests");
    assert.deepEqual(o.files, [FILE, PIC]);
    // (fails before: yes — found in the drive of 11-01: the status under the box still read "Stopped · the request
    // weighs …" for a message back in the box)
    assert.deepEqual(o.status, [chat], "the status under the box reads the chat as it is now");
  });

  // (fails before: yes — no answer)
  test("its words kept as the draft for a refresh stand in the box already: they come back once; a /flow comes back as typed", () => {
    const words = stoppedOf();
    const chat = { id: "c1", turns: [turnOf(), words] };
    const kept = page(chat, { box: "fix the build" });
    kept.takeBack(words);
    assert.equal(kept.o.box, "fix the build", "once, not twice");
    const line = "Design a flow for this, then show it to me before it runs: ship it";
    const flow = stoppedOf({ userText: line, typed: "/flow ship it" });
    const chat2 = { id: "c1", turns: [turnOf(), flow] };
    const asTyped = page(chat2, { box: line });
    asTyped.takeBack(flow);
    assert.equal(asTyped.o.box, "/flow ship it", "the words typed, not Filament's in their place");
  });

  // (fails before: yes — the review of 11-01: the chat opened again put its kept words in the box, the person typed on
  // after them, and Not now put the words ahead of them again: "fix the build\n\nfix the build now")
  test("its kept words typed on in the box: the box stays as the person left it, the words in it once", () => {
    const words = stoppedOf();
    const chat = { id: "c1", turns: [turnOf(), words] };
    const edited = page(chat, { box: "fix the build now, and the docs" });
    assert.equal(edited.takeBack(words), true);
    assert.equal(edited.o.box, "fix the build now, and the docs");
    assert.deepEqual(chat.turns.map((t) => t.n), [1], "its row goes all the same");
    // (fails before: yes — the review of 11-01, its second read: a box that only began with the message's letters read
    // as its words typed on, and the message was lost)
    const short = stoppedOf({ userText: "ok" });
    const chat2 = { id: "c1", turns: [turnOf(), short] };
    const other = page(chat2, { box: "okay, so the build fails" });
    other.takeBack(short);
    assert.equal(other.o.box, "ok\n\nokay, so the build fails", "\"ok\" is not the start of \"okay\": the message goes ahead of the box's words");
  });

  // (fails before: yes — the review of 11-01: the overrule line over the box went with the send, and Not now left it
  // gone, so the message sent again overruled no one)
  test("the answers it overruled go back with it, onto the line over the box", () => {
    const over = stoppedOf({ overrules: [PM_OVER, SKEPTIC_OVER] });
    const chat = { id: "c1", turns: [turnOf(), over] };
    const { o, takeBack } = page(chat);
    takeBack(over);
    assert.deepEqual(o.overruling, [PM_OVER, SKEPTIC_OVER]);
  });

  // (fails before: yes, its name — the review of 11-01: the header and the tab still read the message taken back, the
  // chat's name until a send or another chat)
  test("the only message of a chat: the chat is drawn again, its Start with it, and named as it is now", () => {
    const only = stoppedOf({ n: 1 });
    const chat = { id: "c1", turns: [only] };
    const { o, takeBack } = page(chat);
    assert.equal(takeBack(only), true);
    assert.deepEqual(chat.turns, []);
    assert.deepEqual([o.dropped, o.drawn], [[], [chat]]);
    assert.equal(o.box, "fix the build");
    assert.deepEqual(o.titled, [chat], "the header's name and the tab's");
    assert.equal(o.rows, 1, "and its row in the left bar");
  });

  // (fails before: yes — no answer to give no to)
  test("a turn on record, or a chat not shown: nothing moves, and the card is left to close", () => {
    const seed = seedOf();
    const chat = { id: "c1", turns: [turnOf(), seed] };
    const onRecord = page(chat, { box: "typed" });
    assert.equal(onRecord.takeBack(seed), false);
    assert.equal(chat.turns.length, 2);
    assert.deepEqual([onRecord.o.dropped, onRecord.o.box], [[], "typed"]);
    const stopped = stoppedOf();
    const away = { id: "c1", turns: [turnOf(), stopped] };
    const notShown = page(away, { shown: "c2" });
    assert.equal(notShown.takeBack(stopped), false);
    assert.equal(away.turns.length, 2);
  });
});

describe("the box it goes back to (composer.js takeBack)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  const hadStorage = g.localStorage;
  before(() => {
    doc = stubDocument();
    /** @type {Map<string, string>} */
    const kept = new Map();
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
  });
  after(() => {
    doc.restore();
    if (hadStorage === undefined) delete g.localStorage;
    else g.localStorage = hadStorage;
  });
  /** The composer on the stub document, the chat shown the one given. @param {any} chat */
  const boxOf = (chat) => {
    const host = /** @type {any} */ (doc.document.createElement("div"));
    const c = createComposer(host, { onSend: () => true, onStop() {}, getChat: () => chat });
    const ta = host.querySelector(".composer-input");
    return { c, ta, line: host.querySelector(".over-line") };
  };

  // (fails before: yes — the review of 11-01: a message of files alone, taken back over a draft, put two blank lines
  // ahead of it: "\n\nand run the tests")
  test("a message of files alone: the box's words stay as they were, no blank lines ahead of them; words of its own go first", () => {
    const { c, ta } = boxOf({ chainId: "c1", turns: [] });
    // (fails before: yes — the review's second read: the box's words were written anew, their leading spaces gone)
    ta.value = "  and run the tests";
    c.takeBack("", [FILE]);
    assert.equal(ta.value, "  and run the tests", "untouched, as the person left them");
    assert.deepEqual(c.files().map((/** @type {any} */ f) => f.name), ["build.log"]);
    c.takeBack("fix the build");
    assert.equal(ta.value, "fix the build\n\nand run the tests");
  });

  // (fails before: yes — the review of 11-01: the box had no way to take back what a message overruled)
  test("the answers it overruled stand on the line over the box again, beside those overruled meanwhile", () => {
    const chat = /** @type {any} */ ({ chainId: "c1", turns: [], overruling: [] });
    const { c, line } = boxOf(chat);
    c.takeBack("fix the build", [], [PM_OVER]);
    assert.deepEqual(chat.overruling, [PM_OVER]);
    assert.equal(line.classList.contains("hidden"), false, "the line shows");
    assert.equal(line.querySelector(".ask-who").textContent, "PM's answer");
    chat.overruling = [SKEPTIC_OVER];
    c.takeBack("fix the build", [], [PM_OVER]);
    assert.deepEqual(chat.overruling, [SKEPTIC_OVER, PM_OVER], "one overruled meanwhile stays with them");
  });

  // (fails before: yes — the drive of 11-01: Not now on a chat's only message drew the chat new again, its Start with it,
  // and the box still said "Ask for follow-up changes" until something else painted it)
  test("a message taken back from a chat it was the only message of: the box asks as a new chat's does", () => {
    const chat = /** @type {any} */ ({ chainId: "c1", turns: [{ n: 1, userText: "fix the build", status: "error" }] });
    const { c, ta } = boxOf(chat);
    c.setLive(false, null);
    assert.equal(ta.placeholder, "Ask for follow-up changes");
    chat.turns = [];
    c.takeBack("fix the build");
    assert.equal(ta.placeholder, "Ask Filament anything, @ to ask an agent or add context, / for commands, $ for skills");
  });
});

// (fails before: yes — no answer was wired, and a /flow's turn kept only Filament's words; the overrules, by name alone
// until the review of 11-01)
test("the page answers every stopped card's Not now, and a turn keeps what was typed and the answers it overrules whole", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /onTakeBack: \(chat, turn\) => takeBackAsked\(chat, turn\),/);
  const send = app.slice(app.indexOf("async function sendMessage("));
  assert.match(send, /const typed = text;/);
  assert.match(send, /sent: \[\.\.\.attachments\],[\s\S]{0,300}?\.\.\.\(typed !== text \? \{ typed \} : \{\}\),/);
  assert.match(send, /\.\.\.\(overrules\.length \? \{ overrules: \[\.\.\.overrules\] \} : \{\}\),/);
  // (fails before: yes — the review's second read: a rename set the header's words alone, so the name a message given
  // back paints again (`setTitle`, which reads `chat.title`) was the one before the rename)
  assert.match(app, /onRenamed: \(title\) => \{[\s\S]{0,400}?const c = chatOf\(state\.currentId\);\n\s*if \(c\) c\.title = title;/, "a rename is the chat's own name");
});
