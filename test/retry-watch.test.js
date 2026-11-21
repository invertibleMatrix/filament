// @ts-check
// Retry of a turn Filament began for something else, in the page (r-doors, 11-12). A watcher's wake is Filament's
// message: one that failed goes again as its watcher's run — the failure's Retry asks Filament for it by the turn's
// number, and no word of the wake goes from the page —, and one that ended has no Retry, as a thread's brief has none.
// The first message of a chat Filament made for it — a routine's run, an app's ask, a team's opening — is never sent
// again: no Retry under it, none on its failure. The real timeline is drawn here, on the stub document; what Filament
// does with the page's ask is test/watch-wake.test.js's, and the transcript's `opening` test/turn-by.test.js's.
// (fails before: yes — each offered Retry under its reply and on its failure, and `againOf` gave the wake's block, or
// the run's first message, as words: the send posted them as the person's message, in the chat's own mode)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { APP_SRC, lift } from "./helpers/app-lift.js";
import { wakeWords } from "../src/core/routines.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { againOf, sentOnce, wordsAgain } from "../src/ui/harness/lib/labels.js";
import { footerEl } from "../src/ui/harness/conversation/turn.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
/** The Retry presses the timeline handed on, each with its chat and its turn. @type {[any, any][]} */
const retried = [];
const g = /** @type {any} */ (globalThis);
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
  tl = createTimeline(host, /** @type {any} */ ({ onRetry: (/** @type {any} */ c, /** @type {any} */ turn) => (retried.push([c, turn]), true) }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

const WAKE = wakeWords({ id: "r3", title: "Supervisor", task: "Say how it drifted." }, { project: "app", when: "after each turn", heard: null, by: "you" });
const WOKE = { id: "r3", project: "p1", title: "Supervisor", words: ["Supervisor woke this chat"] };
const FAILED = { final: null, open: true, facts: { error: "the provider refused this one" } };
/** The turns as the transcript says them: the person's, a watcher's wake with what woke it, one that keeps none, and
 *  the first message of a routine's run — each as it failed, and as it ended. @param {boolean} failed */
const read = (failed) => {
  const end = failed ? FAILED : { final: { role: "assistant", content: [{ type: "text", text: "Looked." }] } };
  const [mine, wake, bare, opening] = transcriptTurns({
    turns: [
      { n: 1, turnId: 1, user: { role: "user", content: "Make the login page." }, requestIds: ["a"], ...end },
      { n: 2, turnId: 2, by: "watch", watched: true, watch: WOKE, user: { role: "user", content: [{ type: "text", text: WAKE }] }, requestIds: ["b"], ...end },
      { n: 3, turnId: 3, by: "watch", watched: true, user: { role: "user", content: [{ type: "text", text: WAKE }] }, requestIds: ["c"], ...end },
      { n: 4, turnId: 4, by: "routine", opening: true, user: { role: "user", content: "Read the board and say what changed." }, requestIds: ["d"], ...end },
    ],
  });
  return { mine, wake, bare, opening };
};

test("what goes again: a wake names its watcher's run and its turn, no word of it; one that keeps none of who woke it, and a run's first message, give nothing; the person's message as before", () => {
  const t = read(true);
  assert.deepEqual([t.wake.status, t.wake.watched, t.opening.opening, t.mine.opening, t.wake.opening], ["error", true, true, undefined, undefined]);
  assert.deepEqual(againOf(t.wake), { text: "", attachments: [], wake: { project: "p1", id: "r3", turn: 2 } });
  assert.deepEqual(againOf(t.bare), { text: "", attachments: [], once: true });
  assert.deepEqual(againOf(t.opening), { text: "", attachments: [], once: true });
  assert.deepEqual(againOf(t.mine), { text: "Make the login page.", attachments: [] });
  assert.deepEqual([t.mine, t.wake, t.bare, t.opening].map(wordsAgain), ["Make the login page.", "", "", ""], "none of Filament's words is the person's to send");
  assert.deepEqual([t.mine, t.wake, t.bare, t.opening].map(sentOnce), [false, false, true, true]);
  // A wake whose turn has no number on record yet is asked of no watcher.
  assert.deepEqual([againOf({ ...t.wake, n: undefined }), sentOnce({ ...t.wake, n: undefined })], [{ text: "", attachments: [], once: true }, true]);
});

test("under a reply: no Retry on a watcher's wake or on a run's first message; the person's own keeps it", () => {
  const cb = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
  /** @param {any} turn */
  const titles = (turn) => /** @type {any} */ (footerEl(turn, cb)).querySelectorAll("button").map((/** @type {any} */ b) => String(b.getAttribute("title")).split(" — ")[0]);
  for (const failed of [false, true]) {
    const t = read(failed);
    assert.deepEqual([t.mine, t.wake, t.bare, t.opening].map((x) => titles(x).includes("Retry")), [true, false, false, false], failed ? "failed" : "ended");
  }
});

test("on a failure: a wake's Retry is handed on with its turn — which names the watcher's run —; a wake that keeps none of who woke it and a run's first message have none, and keep their Dismiss", () => {
  const t = read(true);
  /** The failure's buttons, the timeline drawn with this turn alone. @param {any} turn */
  const drawn = (turn) => {
    const chat = { turns: [turn], live: null };
    tl.render(chat);
    const of = (/** @type {string} */ words) => host.querySelectorAll("button").filter((/** @type {any} */ b) => b.textContent === words);
    return { chat, retry: of("Retry"), dismiss: of("Dismiss") };
  };
  for (const turn of [t.bare, t.opening]) {
    const d = drawn(turn);
    assert.deepEqual([d.retry.length, d.dismiss.length], [0, 1], `turn ${turn.n}`);
  }
  assert.equal(retried.length, 0);
  for (const turn of [t.mine, t.wake]) {
    const d = drawn(turn);
    assert.deepEqual([d.retry.length, d.dismiss.length], [1, 1], `turn ${turn.n}`);
    d.retry[0].dispatch("click");
    assert.deepEqual([retried.length, retried.at(-1)?.[0] === d.chat, retried.at(-1)?.[1] === turn], [turn === t.mine ? 1 : 2, true, true]);
  }
  assert.deepEqual(againOf(retried[1][1]).wake, { project: "p1", id: "r3", turn: 2 }, "what the press sends, by its turn");
});

test("what the page sends for it: the watcher's Run row with the turn's number and no word of the wake — the app's key rides it, as on every press —; refused, Retry stands with Filament's words; a message never sent again says so, and Continue on sends neither", async () => {
  const t = read(true);
  /** @type {any[]} */
  const did = [];
  const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [t.mine, t.wake, t.bare, t.opening], live: null, waiting: null });
  /** @type {Record<string, any>} */
  const room = {
    state: { currentId: "c1" },
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
    againOf,
    refusal: "",
    toast: (/** @type {string} */ w) => void did.push(["toast", w]),
    errText: (/** @type {any} */ e) => String(e?.message || e),
    /** The page's call to Filament, as each case has it answer. @type {() => Promise<any>} */
    answers: async () => ({ ok: true, chain: "s-c1" }),
    api: (/** @type {string} */ path, /** @type {any} */ o) => (did.push(["api", path, o]), room.answers()),
    sendMessage: (/** @type {string} */ text) => (did.push(["sent", text]), Promise.resolve(true)),
    modelOn: () => "claude2/opus",
    writeSessionSettings: async () => (did.push(["model written"]), true),
  };
  const lifted = lift(["sendAsked", "sendAgain", "sendsIn", "wakeAgain?", "refuse", "SENT_ONCE?", "continueOn", "turnRunsIn", "compactingBetween?"], room);
  // Retry, as the page hands it to the timeline (app.js).
  const from = APP_SRC.indexOf("  onRetry: (chat, turn) => {");
  const names = ["turnRunsIn", "sendAsked", "sendAgain", "toast", "viewOnlyPage", "VIEW_ONLY_WORDS"];
  // eslint-disable-next-line no-new-func
  const { onRetry } = new Function(...names, `return ({\n${APP_SRC.slice(from, APP_SRC.indexOf("\n  },\n", from))}\n  },\n});`)(lifted.turnRunsIn, lifted.sendAsked, lifted.sendAgain, room.toast, () => false, "");
  assert.equal(await onRetry(chat, t.wake), true);
  assert.deepEqual(did, [["api", "/space/p1/routines/r3/run", { method: "POST", body: { again: 2 } }]], "the watcher's run asked again by its turn: nothing posted to the chat");
  // Filament refuses it — the chat at work, the watcher off —: its words, said, and Retry stands.
  did.length = 0;
  room.answers = () => Promise.reject(new Error("“Supervisor” is not on: its Switch on… says what it does first."));
  assert.equal(await onRetry(chat, t.wake), "“Supervisor” is not on: its Switch on… says what it does first.");
  assert.deepEqual(did.map((d) => d[0]), ["api", "toast"]);
  // A card's answer on a message that is never sent again: nothing goes, and it says why.
  for (const turn of [t.bare, t.opening]) {
    did.length = 0;
    assert.equal(await lifted.sendAsked(chat, turn), lifted.SENT_ONCE);
    assert.deepEqual(did, [["toast", lifted.SENT_ONCE]], `turn ${turn.n}`);
  }
  // Continue on sends a message again on another account: none of these is one, and no model is written for it.
  for (const turn of [t.wake, t.bare, t.opening]) {
    did.length = 0;
    assert.equal(await lifted.continueOn(chat, turn, "claude2"), false);
    assert.deepEqual(did, [["toast", lifted.SENT_ONCE]], `turn ${turn.n}`);
  }
  // The person's own message goes again as its words, as ever.
  did.length = 0;
  room.answers = async () => ({ ok: true });
  assert.equal(await onRetry(chat, t.mine), true);
  assert.deepEqual(did, [["sent", "Make the login page."]]);
});
