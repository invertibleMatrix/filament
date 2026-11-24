// @ts-check
// Each chat keeps its own queue (HarnessV3-Views V3): the messages typed for after a turn wait with the chat they were
// typed in. The panel draws the shown chat's, and only that one drains — the page writes only the session it shows
// (FixRound decision 22). A turn that went on while another chat was shown leaves its queue paused there, saying so,
// until Continue; opening a chat never sends. The rules are queue.js's, pure; the panel is drawn on a small DOM of this
// file's own; the page's wiring is pinned in its source (the page boots a DOM at import).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queueState, queueAdd, turnEnded, turnSettled, openedIdle, queueRestored, createQueue, queuedText, queuedFiles, queuedOverrules, awayNext, awayBack } from "../src/ui/harness/composer/queue.js";
import * as queueModule from "../src/ui/harness/composer/queue.js";
import { lift } from "./helpers/app-lift.js";
import { keptQueues } from "../src/ui/harness/composer/kept-queue.js";
import { agentQueuesWords, alignEvents, steerWords } from "../src/ui/harness/lib/labels.js";

/** @typedef {import("../src/ui/harness/composer/queue.js").QueueState} QueueState */
/**
 * A chat's queue holding `items`, with the fields given.
 * @param {string[]} items @param {Partial<QueueState>} [o] @returns {QueueState}
 */
const holding = (items, o = {}) => Object.assign(queueState(), { items: [...items] }, o);

describe("the queue's rules", () => {
  // (fails before: yes — HarnessV3-Views V3: the queue was the page's alone; a switch to an idle chat sent what another
  // chat had queued into it, and a turn that ended while another chat was shown drained its queue into the one shown)
  test("each chat's queue is its own", () => {
    const a = queueState();
    const b = queueState();
    queueAdd(a, ["then run the tests", "  ", ""]);
    assert.deepEqual([a.items, b.items], [["then run the tests"], []], "a blank one is no message; the other chat's holds nothing");
  });

  // (fails before: yes — HarnessV3-Views V3: a chat opened idle drained the page's queue into itself)
  test("a chat opened with no turn of its own running holds what its queue has, paused, until Continue", () => {
    const st = holding(["then run the tests"], { now: true });
    openedIdle(st);
    assert.deepEqual([st.paused, st.why, st.now], [true, "away", false], "paused, said so, and a Send now's stop has landed");
    const stopped = holding(["x"], { paused: true, why: "stopped" });
    openedIdle(stopped);
    assert.equal(stopped.why, "stopped", "a stop's own pause keeps its reason");
    const empty = queueState();
    openedIdle(empty);
    assert.equal(empty.paused, false, "nothing queued, nothing paused");
  });

  // (fails before: yes — HarnessV3-Views V3: how the last turn ended, and a Send now on its way, were the page's, so a
  // turn ending in one chat decided what another chat's queue did)
  test("a turn's end sends the next message — Send now's whatever ended the turn — and a stop or an error pauses the rest", () => {
    const done = holding(["next"]);
    assert.equal(turnEnded(done, "done"), true);
    assert.deepEqual([done.paused, done.ended], [false, "done"]);
    assert.equal(turnEnded(holding(["next"]), "paused"), true, "a question's pause: the next message answers it");
    for (const why of /** @type {const} */ (["stopped", "error"])) {
      const st = holding(["next"]);
      assert.equal(turnEnded(st, why), false, why);
      assert.deepEqual([st.paused, st.why, st.ended], [true, why, why]);
    }
    const none = queueState();
    assert.equal(turnEnded(none, "stopped"), false);
    assert.equal(none.paused, false, "an empty queue is never paused");
    const now = holding(["stop and do this"], { now: true, paused: true, why: "error" });
    assert.equal(turnEnded(now, "stopped"), true, "Send now's own stop");
    assert.deepEqual([now.paused, now.why, now.now], [false, null, false]);
  });

  // (fails before: yes — HarnessV3-Views V3: the ending the record settles was the page's, not the chat's)
  // (fails before: yes — the owner's of 10-30: a message queued in a chat whose turn ended while another chat was shown
  // waited there, paused, "you were in another chat", where it was to go when the turn ended)
  test("a chat not shown sends its next message as its own turn ends: taken while nothing pauses it; one the send could not take goes back first, paused in the send's words where it was refused", () => {
    const st = holding(["then run the tests", "then commit"]);
    assert.equal(awayNext(st), "then run the tests");
    assert.deepEqual(st.items, ["then commit"], "one per turn end");
    assert.equal(awayNext(holding(["x"], { paused: true, why: "stopped" })), null, "a pause holds it");
    assert.equal(awayNext(queueState()), null);
    const back = holding(["then commit"]);
    awayBack(back, "then run the tests");
    assert.deepEqual([back.items, back.paused], [["then run the tests", "then commit"], false], "a turn ran after all: it waits for that one's end");
    awayBack(back, "x", "Choose a model first");
    assert.deepEqual([back.items[0], back.paused, back.why, back.said], ["x", true, "refused", "Choose a model first"]);
  });

  test("the record settles the ending: a stop the loop never read goes on as done; only the stop's own pause lifts", () => {
    const st = holding(["next"]);
    turnEnded(st, "stopped");
    assert.equal(turnSettled(st, "done"), true);
    assert.deepEqual([st.paused, st.why, st.ended], [false, null, "done"]);
    const read = holding(["next"]);
    turnEnded(read, "stopped");
    assert.equal(turnSettled(read, "stopped"), false, "the loop read the stop");
    assert.equal(read.paused, true);
    const away = holding(["next"], { ended: "stopped", paused: true, why: "away" });
    assert.equal(turnSettled(away, "done"), false, "a pause of another kind stays");
    assert.deepEqual([away.paused, away.ended], [true, "done"]);
    const finished = holding(["next"]);
    turnEnded(finished, "done");
    assert.equal(turnSettled(finished, "done"), false, "nothing was stopped");
  });

  // (fails before: no — a guard the mutation pass asked for: nothing checked that only the turn just stopped settles,
  // so a later turn's record could lift the pause an earlier stop left)
  test("only the turn just stopped settles: a pause an earlier stop left stays until Continue", () => {
    const st = holding(["next"]);
    turnEnded(st, "stopped");
    turnSettled(st, "stopped");
    // A message sent by hand meanwhile runs to its end; the queue still waits for Continue.
    turnEnded(st, "done");
    assert.equal(turnSettled(st, "done"), false);
    assert.deepEqual([st.paused, st.why], [true, "stopped"]);
  });

  // (fails before: yes — the worktree plan's Phase 3 item 3: the queue held words only)
  test("a queued message is its words, or its words beside its files", () => {
    assert.deepEqual([queuedText("then run the tests"), queuedFiles("then run the tests")], ["then run the tests", []]);
    const shot = { kind: "image", name: "screenshot-1.png", type: "image/png", data: "AAAA" };
    assert.deepEqual([queuedText({ text: "what is this?", files: [shot] }), queuedFiles({ text: "what is this?", files: [shot] })], ["what is this?", [shot]]);
    assert.deepEqual([queuedText({ text: "", files: [shot] }), queuedFiles({ text: "", files: [shot] })], ["", [shot]], "files alone");
  });
});

/** A small DOM, enough for the panel: elements with a class, attributes, listeners and children. */
class El {
  /** @param {string} tag */
  constructor(tag) {
    this.nodeType = tag === "#text" ? 3 : 1;
    this.className = "";
    this.data = "";
    this.html = "";
    /** @type {El[]} */
    this.kids = [];
    /** @type {Record<string, ((e: any) => void)[]>} */
    this.on = {};
    /** @type {Record<string, string>} */
    this.attrs = {};
  }
  /** @param {string} v */
  set innerHTML(v) {
    this.html = v;
  }
  /** @param {string} k @param {any} v */
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  /** @param {string} t @param {(e: any) => void} fn */
  addEventListener(t, fn) {
    (this.on[t] ||= []).push(fn);
  }
  /** @param {...El} kids */
  append(...kids) {
    this.kids.push(...kids);
  }
  /** @param {...El} kids */
  replaceChildren(...kids) {
    this.kids = kids;
  }
  get classList() {
    return {
      /** @param {string} c @param {boolean} on */
      toggle: (c, on) => {
        const s = new Set(this.className.split(" ").filter(Boolean));
        if (on) s.add(c);
        else s.delete(c);
        this.className = [...s].join(" ");
      },
    };
  }
  /** @returns {string} */
  get words() {
    return this.nodeType === 3 ? this.data : this.kids.map((k) => k.words).join(" ");
  }
  click() {
    for (const fn of this.on.click || []) fn({});
  }
}
/** The first element under `el`, itself first, that `pred` takes. @param {El} el @param {(x: El) => boolean} pred @returns {El | null} */
const find = (el, pred) => (pred(el) ? el : el.kids.map((k) => find(k, pred)).find(Boolean) || null);

// What waits in the page alone is kept with the tab as the page goes away (HarnessV4_Tasks U4).
describe("a chat's waiting messages across a reload of the page", () => {
  /** A tab's storage, with a size it refuses past. @param {number} [room] */
  const tab = (room = Infinity) => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    return {
      kept,
      getItem: (/** @type {string} */ k) => kept.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => {
        if (v.length > room) throw new Error("QuotaExceededError");
        kept.set(k, v);
      },
      removeItem: (/** @type {string} */ k) => void kept.delete(k),
    };
  };
  const shot = { kind: "image", name: "screenshot-1.png", type: "image/png", data: "A".repeat(400) };

  // (fails before: the module did not exist — a chat's queue, and the messages held for a run the page had not
  // learned yet, lived in the page's memory alone: a reload, or the browser putting the page away, forgot them)
  test("kept by session, whole, and taken back once; an empty queue keeps nothing", () => {
    const store = tab();
    const q = keptQueues(store);
    const msg = { text: "look at this", files: [shot] };
    assert.equal(q.keep("c1", ["then run the tests", msg]), true);
    q.keep("c2", ["another chat's"]);
    assert.deepEqual(q.take("c1"), { items: ["then run the tests", msg], lost: [] });
    assert.deepEqual(q.take("c1"), { items: [], lost: [] }, "taken once: a later reload does not bring it back again");
    assert.deepEqual(q.take("c2").items, ["another chat's"], "each session's own");
    q.keep("c3", ["x"]);
    q.keep("c3", []);
    assert.equal(store.kept.size, 0, "a queue that emptied leaves no copy behind");
    assert.deepEqual(q.take("never"), { items: [], lost: [] });
  });

  // (fails before: the module did not exist)
  test("a tab's storage too full for the files keeps the words, and names the files it could not; one that takes nothing loses nothing else", () => {
    const store = tab(200);
    const q = keptQueues(store);
    assert.equal(q.keep("c1", ["then run the tests", { text: "look at this", files: [shot] }, { text: "", files: [shot] }]), false, "said: not whole");
    assert.deepEqual(q.take("c1"), { items: ["then run the tests", "look at this"], lost: ["screenshot-1.png", "screenshot-1.png"] });
    const none = keptQueues(tab(0));
    assert.equal(none.keep("c1", ["x"]), false);
    assert.deepEqual(none.take("c1"), { items: [], lost: [] }, "nothing kept, nothing thrown");
    assert.deepEqual(keptQueues(null).take("c1"), { items: [], lost: [] }, "no storage at all");
    // What another program left under the key is no queue.
    const odd = tab();
    odd.kept.set("filament.queue:c1", "{not json");
    assert.deepEqual(keptQueues(odd).take("c1"), { items: [], lost: [] });
    odd.kept.set("filament.queue:c1", JSON.stringify({ items: ["ok", 7, null, { text: 3 }, { text: "with", files: "no" }, "  "] }));
    assert.deepEqual(keptQueues(odd).take("c1").items, ["ok", { text: "with", files: [] }], "only messages come back");
  });

  // (fails before: yes — `queueRestored` did not exist)
  test("what comes back goes first, in order, and waits, paused, for Continue: a page that loads afresh never sends by itself", () => {
    const st = holding(["typed since"]);
    assert.equal(queueRestored(st, ["first", { text: "second", files: [shot] }, "  "]), true);
    assert.deepEqual([st.items, st.paused, st.why], [["first", { text: "second", files: [shot] }, "typed since"], true, "reloaded"]);
    const none = queueState();
    assert.equal(queueRestored(none, []), false);
    assert.deepEqual([none.items, none.paused, none.why], [[], false, null], "nothing kept, nothing paused");
    // The followed turn's end sends nothing, and coming back to the chat keeps the reason.
    assert.equal(turnEnded(st, "done"), true);
    openedIdle(st);
    assert.deepEqual([st.paused, st.why], [true, "reloaded"]);
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    const panel = createQueue({ onSteer() {}, onEdit() {}, onContinue() {} });
    panel.bind(st);
    assert.match(/** @type {El} */ (/** @type {unknown} */ (panel.el)).words, /Queued messages \(3\)/);
    assert.match(/** @type {El} */ (/** @type {unknown} */ (panel.el)).words, /Paused — the page loaded afresh\. Continue sends the next message\./);
  });
});

describe("the panel", () => {
  // (fails before: yes — HarnessV3-Views V3: the panel drew the page's one queue, whichever chat was shown)
  test("it draws the chat it is shown: that chat's messages, its pause and why, and Continue", () => {
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    let continued = 0;
    const panel = createQueue({ onSteer() {}, onEdit() {}, onContinue: () => continued++ });
    const el = /** @type {El} */ (/** @type {unknown} */ (panel.el));
    const a = queueState();
    const b = queueState();
    panel.bind(a);
    panel.push("then run the tests");
    panel.sendNow("stop, and look at the parser first");
    assert.deepEqual([a.items, a.now], [["stop, and look at the parser first", "then run the tests"], true], "Send now's goes first");
    panel.bind(b);
    assert.deepEqual([panel.size(), b.items], [0, []], "the other chat's queue holds nothing of the first's");
    assert.match(el.className, /\bhidden\b/, "and the panel hides");
    openedIdle(a);
    panel.bind(a);
    assert.match(el.words, /Queued messages \(2\)/);
    assert.match(el.words, /Paused — you were in another chat\. Continue sends the next message\./);
    assert.match(el.words, /then run the tests/);
    const go = find(el, (x) => x.words.trim() === "Continue" && !!x.on.click);
    assert.ok(go, "Continue");
    go.click();
    assert.deepEqual([continued, a.paused, a.why], [1, false, null]);
    assert.ok(!/Paused/.test(el.words), "drawn again, no longer paused");
  });

  // (fails before: yes — HarnessV3-ACP AC1-5: a row's Steer sent its message into a coding agent's turn, which takes no
  // steer: the message left the queue and went nowhere)
  test("while a coding agent's turn runs, a row waits, edits or goes; it can't steer", () => {
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    const panel = createQueue({ onSteer() {}, onEdit() {}, onContinue() {} });
    const el = /** @type {El} */ (/** @type {unknown} */ (panel.el));
    panel.bind(queueState());
    panel.push("then run the tests");
    /** @param {string} name */
    const button = (name) => find(el, (x) => x.attrs["aria-label"] === name);
    assert.ok(button("Send"), "between turns: the row sends");
    // (fails before: yes — the owner's of 11-09: the row's send was named Steer, a name the ⌄ menu no longer has)
    panel.steers(true, true);
    assert.ok(button("Send at its next step"), "a loop's turn: the row goes at its next step, the ⌄ menu's row by its name");
    panel.steers(false, true);
    assert.deepEqual([button("Send at its next step"), button("Send"), !!button("Edit"), !!button("Remove")], [null, null, true, true]);
    panel.steers(true, false);
    assert.ok(button("Send"), "the agent's turn over: the row sends again");
  });

  // (fails before: yes — the worktree plan's Phase 3 item 3: a message typed with files while a turn ran could not be
  // queued, and a drained message the page refused was lost)
  test("a message with files waits whole: its row counts them and can't steer; Edit takes it all; a refused one goes back first", () => {
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    /** @type {any[]} */
    const edited = [];
    const panel = createQueue({ onSteer() {}, onEdit: (it) => edited.push(it), onContinue() {} });
    const el = /** @type {El} */ (/** @type {unknown} */ (panel.el));
    const st = queueState();
    panel.bind(st);
    const shot = { kind: "image", name: "screenshot-1.png", type: "image/png", data: "AAAA" };
    const msg = { text: "", files: [shot] };
    panel.push(msg);
    assert.match(el.words, /\(attachments\)\s+1 file\b/, "files alone: the row says so, and counts them");
    /** @param {string} name */
    const button = (name) => find(el, (x) => x.attrs["aria-label"] === name);
    panel.steers(true, true);
    assert.deepEqual([button("Send at its next step"), !!button("Edit"), !!button("Remove")], [null, true, true], "a steer carries words only");
    button("Edit")?.click();
    assert.deepEqual([edited, st.items], [[msg], []], "Edit takes the whole message out, files and all");
    panel.push("then run the tests");
    panel.putBack(msg);
    assert.deepEqual(st.items, [msg, "then run the tests"], "a message the page refused goes back first");
    assert.equal(panel.shift(), msg, "and goes next, files and all");
  });

  // (fails before: yes — HarnessV4_Tasks U4: a drained message the send refused went back first and nothing more. No
  // turn was running whose end would send it, and nothing said why it still waited: the pill read "1 queued" for good)
  test("a message the send refused goes back first and the queue waits, paused, in the send's own words; Continue tries again", () => {
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    let continued = 0;
    const panel = createQueue({ onSteer() {}, onEdit() {}, onContinue: () => continued++ });
    const el = /** @type {El} */ (/** @type {unknown} */ (panel.el));
    const st = queueState();
    panel.bind(st);
    panel.push("first");
    panel.push("second");
    panel.refused(panel.shift(), "Choose a model first");
    assert.deepEqual([st.items, st.paused, st.why, st.said], [["first", "second"], true, "refused", "Choose a model first"]);
    assert.equal(panel.paused(), true);
    assert.match(el.words, /Paused — the next message was not sent: Choose a model first\. Continue tries again\./);
    // A reason that ends its own sentence gets no second full stop; none given, none made up.
    panel.refused(panel.shift(), "the session could not be created: the disk is full.");
    assert.match(el.words, /was not sent: the session could not be created: the disk is full\. Continue tries again\./);
    panel.refused(panel.shift(), "");
    assert.match(el.words, /Paused — the next message was not sent\. Continue tries again\./);
    assert.deepEqual(st.items, ["first", "second"], "nothing lost, nothing doubled");
    // A turn that ends meanwhile sends nothing: the pause is Continue's, as a stop's is.
    assert.equal(turnEnded(st, "done"), true);
    assert.deepEqual([st.paused, st.why], [true, "refused"]);
    openedIdle(st);
    assert.equal(st.why, "refused", "coming back to the chat keeps the reason");
    const go = find(el, (x) => x.words.trim() === "Continue" && !!x.on.click);
    assert.ok(go, "Continue");
    go.click();
    assert.deepEqual([continued, st.paused, st.why, st.said], [1, false, null, ""]);
    assert.ok(!/Paused/.test(el.words));
    // Send now's own stop clears it too, words and all.
    panel.refused(panel.shift(), "Choose a model first");
    st.now = true;
    assert.equal(turnEnded(st, "stopped"), true);
    assert.deepEqual([st.paused, st.why, st.said], [false, null, ""]);
    // Back first with no pause is for a turn that runs on and takes no words: its end sends it.
    panel.putBack(panel.shift());
    assert.deepEqual([st.items, st.paused], [["first", "second"], false]);
  });

  // (fails before: yes — the page round of 11-02: a refusal of the message itself, a /flow with no words among them,
  // paused the queue on "… Continue tries again.", and Continue could only meet the same refusal)
  test("a refusal of the message itself pauses the queue in its own words, with no Continue offered as a try again; the next refusal is its own", () => {
    /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t), createTextNode: (/** @type {string} */ s) => Object.assign(new El("#text"), { data: s }) };
    const panel = createQueue({ onSteer() {}, onEdit() {}, onContinue() {} });
    const el = /** @type {El} */ (/** @type {unknown} */ (panel.el));
    const st = queueState();
    panel.bind(st);
    panel.push("/flow");
    const USAGE = "/flow needs your words after it: what the flow is for. Your agent designs it from them";
    panel.refused(panel.shift(), USAGE, false);
    assert.deepEqual([st.items, st.paused, st.why, st.said, st.again], [["/flow"], true, "refused", USAGE, false]);
    assert.match(el.words, /Paused — the next message was not sent: \/flow needs your words after it: what the flow is for\. Your agent designs it from them\./);
    assert.ok(!/Continue tries again/.test(el.words), el.words);
    assert.ok(find(el, (x) => x.words.trim() === "Continue" && !!x.on.click), "Continue stays: it sends the rest once the message is edited or removed");
    panel.refused(panel.shift(), "Choose a model first");
    assert.match(el.words, /was not sent: Choose a model first\. Continue tries again\./, "a refusal Continue can get past says so again");
    // A chat not shown pauses the same way.
    const away = holding([]);
    awayBack(away, "/flow", USAGE, false);
    panel.bind(away);
    assert.deepEqual([away.paused, away.again], [true, false]);
    assert.ok(!/Continue tries again/.test(el.words), el.words);
    awayBack(away, "then commit", "This chat has no model");
    assert.equal(away.again, true);
  });
});

describe("the page's wiring", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
  // (fails before: yes — HarnessV3-Views V3: selectChat's face reset drained the page's queue into the chat it opened)
  test("a switch shows the chat's own queue, pausing what waited for a turn that went on elsewhere, and never sends", () => {
    const select = app.slice(app.indexOf("function selectChat("), app.indexOf("composer.setSessionView(", app.indexOf("function selectChat(")));
    assert.match(select, /if \(!again && !chat\.live && !\(chat\.roomWait && compactingBetween\(chat\)\)\) openedIdle\(queueOf\(chat\)\);\s+composer\.setQueue\(queueOf\(chat\)\);\s+composer\.setLive\(!!chat\.live, liveRun\(chat\.live\)\);/);
    assert.match(app, /function queueOf\(chat\) \{\s+if \(chat\.queue\) return chat\.queue;\s+const st = \(chat\.queue = queueState\(\)\);/, "made the first time it is asked for, kept with the chat");
    assert.match(composer, /setQueue\(st\) \{\s+queue\.bind\(st\);\s+paintQueue\(\);/);
    assert.match(composer, /const setLive = \(on, run = null, endedBy\) => \{/, "a switch names no ending");
    assert.match(composer, /if \(!on && endedBy && queue\.ended\(endedBy\)\) drain\(\);\s+paintQueue\(\);/, "only an ending drains; the pill says what it left");
    assert.match(composer, /settled\(status\) \{\s+if \(live \|\| !queue\.settled\(status\)\) return;\s+paintQueue\(\);\s+drain\(\);/);
    assert.match(composer, /queue\.sendNow\(it\);\s+ta\.value = "";\s+atts\.clear\(\);\s+refresh\(\);\s+cb\.onStop\(\);/);
    assert.ok(!/sendNowPending|endedAs/.test(composer), "the composer keeps no ending of its own: the chat's queue does");
  });

  // (fails before: yes — the owner's of 11-17: a message queued in the chat on screen was paused as "you were in another
  // chat" though they never left it: while no turn showed as running for a moment (a message waiting on its row, a
  // turn's end before the composer heard it), choosing the chat again — its row in the left bar, its Now row — paused it
  // as a switch would, and Stop and send's message lost its going first)
  test("the chat on screen chosen again is no switch: its queue is neither paused as away nor loses Stop and send's first; another chat's opening still pauses it", () => {
    const c1 = { id: "c1", chainId: "k1", turns: [], live: null, queue: holding([]) };
    const c2 = { id: "c2", chainId: "k2", turns: [], live: null, queue: holding([]) };
    const chats = new Map([["c1", c1], ["c2", c2]]);
    const state = { currentId: /** @type {string | null} */ (null), chats };
    const { selectChat } = lift(["selectChat", "drawChat", "drawnChat"], { state, chatOf: (/** @type {string} */ id) => chats.get(id) || null, queueOf: (/** @type {any} */ c) => c.queue, openedIdle, find: { close() {} }, transcript: { render() {}, refreshSpace() {} } });
    selectChat("c1");
    queueAdd(c1.queue, ["sent while it ran"]);
    selectChat("c1");
    assert.deepEqual([c1.queue.paused, c1.queue.why, c1.queue.items], [false, null, ["sent while it ran"]], "chosen again: it waits for the turn's end, unpaused");
    c1.queue.now = true;
    selectChat("c1");
    assert.equal(turnEnded(c1.queue, "stopped"), true, "Stop and send's message still goes first, whatever ended the turn");
    queueAdd(c1.queue, ["then this"]);
    selectChat("c2");
    selectChat("c1");
    assert.deepEqual([c1.queue.paused, c1.queue.why], [true, "away"], "opened from another chat: paused, for Continue");
  });

  // (fails before: yes — HarnessV3-ACP AC1-5: a coding agent's turn has a run now, and what was typed while it ran went
  // to the run as a steer, which its run refuses — "No run is listening", and the message was lost)
  test("a coding agent's turn queues what is typed where its run takes no words mid-turn; Compact sends it no steer", () => {
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    const queued = send.indexOf("!agentTakesWords(chat.live.steer)");
    assert.ok(queued > 0 && queued < send.indexOf("steerPost(chat.live.runId"), "queued before any steer");
    assert.match(send.slice(queued), /^[^\n]*\) \{\s+toast\(agentQueuesWords\(chat\.live\.own\)\);\s+return "queue";/);
    assert.equal(agentQueuesWords(null), "Queued — this agent can't take a message mid-turn; it goes out when this turn ends");
    assert.match(composer, /agentTurn = on && \(runKind === "coding-agent" \|\| \(!runKind && modelIsAgent\)\);\s+agentQueues = agentTurn && runKnown && !agentTakesWords\(run\?\.steer\);\s+agentQueued = agentTurn && runKnown && run\?\.steer === "queued";\s+agentInterrupts = agentTurn && runKnown && run\?\.interrupts === true;\s+ownAgent = agentQueues \? run\?\.own \|\| null : null;\s+steerable = on && runKnown && !agentTurn;/);
    assert.match(composer, /queue\.steers\(!agentQueues && !unfollowed, on\);/, "the rows can't steer it either");
    const compact = app.slice(app.indexOf("async function compactMidTurn("), app.indexOf("async function compactSession("));
    assert.match(compact, /if \(live && \(live\.runKind === "coding-agent" \|\| codingAgentModel\(chat\.model\)\)\) \{\s+toast\("A coding agent compacts its own context as it works — compact this session once its turn ends"\);\s+return false;/);
    assert.ok(compact.indexOf("coding-agent") < compact.indexOf("/steer"), "no compact steer goes out");
  });

  // (fails before: yes — the worktree plan's Phase 3 item 3: files typed while a turn ran stayed in the box ("attachments
  // wait for the next turn"), Add to queue and Send now left them behind, and a drained message the page refused was lost)
  test("while a turn runs a message with files is queued whole, Add to queue and Send now take the files, the drain loses none", () => {
    const send = composer.slice(composer.indexOf('const send = (modifier, asWritten = false, own = false, by = "click") => {'), composer.indexOf('ta.addEventListener("input"'));
    // (fails before: yes — found by hand in the browser: with a turn running, the hint under a draft to PM read "Enter
    // steers · Ctrl+Enter vetoes", and Enter asked PM)
    assert.match(composer, /hintEl\.textContent = on && asking \? `\$\{key\} asks · the running turn goes on · the Stop button stops`\n\s+(\/\/[^\n]*\n\s*)*: overruling\(\)\.length && !asking \? [^\n]*\n\s+: on\n/, "the hint says what Enter does to a draft that is the agents' — first");
    assert.match(composer, /sendBtn\.title = asking \? "Ask — the main agent hears nothing"\n\s+: on\n/, "and so does the send button");
    assert.match(composer, /asking = on;\n\s+\/\/[^\n]+\n\s+if \(on && overruling\(\)\.length\) setOverruling\(\[\]\);\n\s+\/\/[^\n]+\n\s+if \(!stopBtn\.disabled\) paintSendWords\(\);/, "both follow the draft as it becomes the agents', and a stop on its way keeps its words");
    // (fails before: yes — HarnessV4_Tasks E15 step 2, L-94: a message to saved agents had no path of its own)
    assert.ok(send.indexOf("cb.onAsk(") > 0 && send.indexOf("cb.onAsk(") < send.indexOf("const unsteered = live && plain.length"), "a message to saved agents leaves before the queue and the running turn are looked at");
    assert.match(send, /const plain = files\.filter\(\(f\) => f\.kind !== "team"\);\s+const unsteered = live && plain\.length && !\(liveReadsPictures && plain\.every\(\(f\) => f\.kind === "image"\)\);/);
    assert.match(send, /if \(unsteered\) \{\s+queue\.push\(asQueued\(text, files, overrules, via\)\);\s+paintQueue\(\);/);
    assert.ok(send.indexOf("atts.clear();") < send.indexOf("if (unsteered) {"), "the box is emptied first: the message is the queue's now");
    assert.ok(!/attachments wait for the next turn/.test(composer), "no message is held back in the box");
    assert.match(composer, /const boxMessage = \(via\) => \{\s+const text = ta\.value\.trim\(\);\s+const files = atts\.list\(\);\s+if \(!text && !files\.length\) return null;\s+return asQueued\(text, files, takeOverruling\(text\), via\);/);
    // Send when it's done and Stop and send (the owner's of 11-09): the row each went by goes with it.
    assert.match(composer, /const toQueue = \(by = "click"\) => \{\s+const it = boxMessage\(\{ row: "when-done", by \}\);\s+if \(!it\) return;\s+queue\.push\(it\);\s+ta\.value = "";\s+atts\.clear\(\);/);
    assert.match(composer, /const sendNow = \(\) => \{\s+const it = boxMessage\(\{ row: "stop-and-send", by: "click" \}\);\s+if \(!it\) return;\s+queue\.sendNow\(it\);/);
    assert.match(composer, /onEdit: \(it\) => \{\s+ta\.value = queuedText\(it\);\s+atts\.restore\(queuedFiles\(it\)\);/, "the box becomes the message");
    const drain = composer.slice(composer.indexOf("const drain = () => {"), composer.indexOf("const autosize = "));
    assert.match(drain, /Promise\.resolve\(cb\.onSend\(queuedText\(next\), queuedFiles\(next\), "normal", \{ queued: true, overrules: queuedOverrules\(next\), \.\.\.queuedAnswer\(next\), \.\.\.queuedVia\(next\) \}\)\)\.then\(\s*\(ok\) => \{\s+(\/\/[^\n]*\n\s*)*if \(ok === "queue"\) queue\.putBack\(next\);\s+else if \(ok === false\) \{\s+const why = cb\.whyRefused\?\.\(\);\s+queue\.refused\(next, why\?\.said \|\| "", why\?\.again \?\? true\);\s+\} else return;\s+paintQueue\(\);/);
    // (fails before: yes — the review of s2c, plausible: a send that threw lost the message it had taken off the queue)
    assert.match(drain, /\(e\) => \{\s+queue\.refused\(next, `It may not have gone [^`]*`, true\);\s+paintQueue\(\);/, "a send that threw: the message waits, paused");
  });

  // (fails before: yes — a picture attached while a turn ran always waited in the queue for the turn's end: a steer
  // carried words only, on the page and on the server)
  test("a message of pictures goes into a running turn whose run reads them, its bubble naming them; any other file, or another run, and it queues whole", () => {
    assert.match(app, /live\.pictures = run\.meta\?\.steerImages === true;/, "the run says it, at its start");
    assert.match(composer, /liveReadsPictures = on && runKnown && run\?\.pictures === true;/, "none before the run is known, none for a run that does not say so");
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(send, /if \(team\.others\.length && !\(chat\.live\.pictures && team\.others\.every\(\(a\) => a\.kind === "image"\)\)\)\s+return refuse\("This turn takes words only while it runs — your message is back in the box with its files"\);/, "what the composer's rule lets through by mistake goes back to the box, whole");
    assert.match(send, /const images = team\.others\.map\(\(a\) => \(\{ name: String\(a\.name \|\| "picture"\), mediaType: String\(a\.type \|\| "image\/png"\), data: a\.data \}\)\);/);
    assert.match(send, /await steerPost\(chat\.live\.runId, \{ kind, text: team\.words, \.\.\.\(interrupt \? \{ interrupt: true \} : \{\}\), \.\.\.\(images\.length \? \{ images \} : \{\}\), \.\.\.\(overrules\.length \? \{ overrules \} : \{\}\), \.\.\.\(kind === "note" && useTags\.length \? \{ use: useTags \} : \{\}\), \.\.\.\(kind === "note" && useKeys\.length \? \{ useTeams: useKeys \} : \{\}\), \.\.\.\(weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(via \? \{ via \} : \{\}\) \}\);/);
    assert.match(app, /const steerPost = \(runId, m\) =>\s+api\([^\n]*\.\.\.\(m\.images\?\.length \? \{ images: m\.images \} : \{\}\), \.\.\.\(m\.overrules\?\.length \? \{ overrules: overrulesSent\(m\.overrules\) \} : \{\}\), \.\.\.\(m\.use\?\.length \? \{ use: m\.use \} : \{\}\), \.\.\.\(m\.useTeams\?\.length \? \{ useTeams: m\.useTeams \} : \{\}\), \.\.\.\(m\.weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(m\.via \? \{ via: m\.via \} : \{\}\) \} \}\);/, "the pictures ride the same POST as the words");
    assert.equal((send.match(/transcript\.addSteer\(chat\.live\.turn, \{[^\n]*\.\.\.files(, \.\.\.over)? \}\);/g) || []).length, 2, "the bubble names them, delivered or not");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    // Since V4-D303 a picture the page can draw shows above the words (transcript-pictures.test.js); one it cannot is
    // named on a chip, as a message's own files are.
    assert.match(timeline, /const text = w\.text \|\| \(named\.length \? "\(pictures\)" : ""\);/);
    assert.match(timeline, /named\.length \? h\("div", \{ class: [^\n]*"u-atts"[^\n]*\}, \.\.\.named\.map\(\(name\) => h\("span", \{ class: "att" \}, name\)\)\) : null,/, "drawn as a message's own files are");
    // A reload draws the bubble from the run's log, which names the pictures and carries none of their bytes.
    const a = alignEvents([
      { type: "run-start", kind: "agent-turn", at: 1 },
      { type: "steer", id: "s1", kind: "note", text: "this one", at: 2, state: "queued", images: [{ name: "shot.png", mediaType: "image/png", bytes: 70 }, { mediaType: "image/jpeg", bytes: 9 }] },
      { type: "steer", id: "s2", kind: "note", text: "words alone", at: 3, state: "queued" },
    ]);
    assert.deepEqual([a.steers.get("s1")?.files, a.steers.get("s2")?.files], [["shot.png", "picture"], undefined]);
  });

  // (fails before: yes — a picture the model's provider refused left its bubble reading "Conversation steered" over
  // a file the model never saw)
  test("a picture the model's provider refused: the bubble says its words went in and its picture did not, the file struck through", () => {
    const a = alignEvents([
      { type: "run-start", kind: "agent-turn", at: 1 },
      { type: "steer", id: "s1", kind: "note", text: "this one", at: 2, state: "queued", images: [{ name: "shot.png", mediaType: "image/png", bytes: 70 }] },
      { type: "steer-read", ids: ["s1"], kinds: ["note"], at: 3 },
      { type: "steer-pictures", round: 2, ids: ["s1", "one the page never saw"], refused: "content.type is invalid", at: 4 },
    ]);
    const s = a.steers.get("s1");
    assert.equal(s?.refused, "content.type is invalid");
    assert.equal(steerWords(s).state, "Conversation steered — its picture was not sent: the model's provider refused it");
    assert.equal(steerWords({ ...s, files: ["a.png", "b.png"] }).state, "Conversation steered — its pictures were not sent: the model's provider refused them");
    assert.equal(steerWords({ ...s, refused: undefined }).state, "Conversation steered", "a picture that went in says nothing more");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const refusedTip = s\.refused \? `Not sent — the provider said: \$\{s\.refused\}` : null;/);
    assert.match(timeline, /h\("div", \{ class: s\.refused \? "u-atts refused" : "u-atts", title: refusedTip \}/, "the chips struck, the provider's words on their tip");
    assert.match(timeline, /const FROM_LOG = \/\*\* @type \{const\} \*\/ \(\[[^\]\n]*"refused"[^\]\n]*\]\);/);
    assert.match(timeline, /if \(src && FROM_LOG\.some\(\(k\) => src\[k\] !== s\[k\]\)\) \{\s+for \(const k of FROM_LOG\) s\[k\] = src\[k\];/, "a bubble already drawn takes the news from the run's log");
    assert.match(readFileSync("src/ui/harness/aqua.css", "utf8"), /\.steer \.u-atts\.refused \.att \{ text-decoration: line-through;/);
  });

  // (fails before: yes — HarnessV4_Tasks U4: nothing kept a chat's queue, or the messages held for its run, when the
  // page went away)
  // (fails before, the second half: yes — the owner's of 11-17: a crashed page runs no pagehide, so a chat window whose
  // process went down lost every queued message as Filament loaded it again)
  test("the page keeps each chat's waiting messages as it goes away and each second they change, and the chat's queue takes them back when it is made", () => {
    assert.match(app, /const kept = keptQueues\(sessionStorage\);/);
    const keep = app.slice(app.indexOf("function keepQueues(always = false) {"), app.indexOf('addEventListener("pagehide"'));
    assert.match(keep, /for \(const chat of state\.chats\.values\(\)\) \{\s+const held = chat\.live\?\.held\.texts\(\) \|\| \[\];\s+if \(!chat\.chainId \|\| \(!chat\.queue && !held\.length\)\) continue;\s+const items = \[\.\.\.queueOf\(chat\)\.items, \.\.\.held\];/, "the queue, then what was held for the run: the order they would have gone in");
    assert.match(keep, /if \(!always && was && was\.length === items\.length && was\.every\(\(it, i\) => it === items\[i\]\)\) continue;\s+kept\.keep\(String\(chat\.chainId\), items\);\s+keptNow\.set\(chat, items\);/, "written where it changed");
    assert.match(app, /addEventListener\("pagehide", \(\) => keepQueues\(true\)\);\n(\/\/ [^\n]*\n)+addEventListener\("filament:keep", \(\) => keepQueues\(true\)\);\nsetInterval\(\(\) => keepQueues\(\), QUEUE_KEEP_MS\);/, "afresh as the page goes, as the desktop app reads the tab to carry it to a better way, and each second as it runs");
    assert.match(app, /const QUEUE_KEEP_MS = 1000;/);
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("const typed = text;"));
    assert.match(send, /if \(queued\) keepQueues\(\);/, "a message its queue sends is out of the tab's copy before it goes: a crash never brings it back to send twice");
    const of = app.slice(app.indexOf("function queueOf(chat) {"));
    assert.match(of, /^function queueOf\(chat\) \{\s+if \(chat\.queue\) return chat\.queue;\s+const st = \(chat\.queue = queueState\(\)\);\s+(\/\/[^\n]*\n\s*)*if \(!chat\.chainId\) return st;\s+const back = kept\.take\(String\(chat\.chainId\)\);\s+queueRestored\(st, back\.items\);\s+(\/\/[^\n]*\n\s*)*if \(back\.items\.length\) kept\.keep\(String\(chat\.chainId\), \[\.\.\.st\.items\]\);\s+if \(back\.lost\.length\) toast\(keptLostWords\(back\.lost\), "err"\);\s+return st;/);
    // A chat this page never opened is left alone: its copy is the one the page before it made.
    assert.ok(!/chat\.queue \|\|= queueState\(\)/.test(app), "one maker");
  });

  // (fails before: yes — HarnessV4_Tasks U4: a refused send said why in a toast alone, which passes; a row's Steer the
  // send refused was gone from the queue; and a drained message answered "queue" (a turn runs that takes no words) was
  // forgotten)
  test("a refused send's reason reaches the queue's pause; a row's Steer the send does not take goes back first", () => {
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(app, /let refusal = "";/);
    assert.match(app, /const refuse = \(words, shown = true, again = true\) => \{\s+refusal = words;\s+refusalAgain = again;\s+if \(shown\) toast\(words, "err"\);\s+return false;\s+\};/);
    assert.match(send, /^async function sendMessage\([^\n]*\{\s+refusal = "";\s+refusalAgain = true;/, "each send starts with none");
    // The chat is made ready for the message in `readySession` (HarnessV4_Tasks E15 step 2), whose refusals are the send's.
    const ready = app.slice(app.indexOf("async function readySession("), app.indexOf("async function sendMessage("));
    assert.match(ready, /const no = \(words, shown = true\) => \{\s+refuse\(words, shown\);\s+return null;\s+\};/);
    assert.match(send, /const ready = away \? readyAway\(chat\) : await readySession\(chat, \{ opens: fresh \}\);\s+if \(!ready\) return false;/);
    for (const part of [send, ready]) {
      assert.ok(!/toast\([^\n]*\);\s+return false;/.test(part), "no refusal says its reason to a toast alone");
      assert.ok(!/if \(!picked\) return (false|null);/.test(part), "a folder not chosen is a reason too");
    }
    // (three of the send's are /flow's, HarnessV4_OneAgent_Plan OA3: no words after it, a team's own chat, a turn
    // that waits for an answer; two are /steer-fork's, the owner's of 11-05: no words after it, no turn of Filament's own agent running to weigh it
    // beside; two are /plan's, the owner's of 11-05: a team's own chat, a turn that waits for an answer; one is a card's
    // answer, or a way on's, while a message waits for the chat; one is a view-only device's page, p4-view-ui; two are
    // a thread's brief sent again, which is no note into a turn and waits in no queue: while a turn runs, a message
    // waits or room is made, and where a turn began as the chat was made ready; one is Run on's, the remote desk's s2c: a
    // first message on another machine goes as plain words)
    assert.deepEqual([(send.match(/return refuse\(/g) || []).length, (ready.match(/return no\(/g) || []).length], [15, 5]);
    assert.match(send, /followElsewhere\(chat\);\s+refusal = "A turn was already running in this chat";\s+return false;/, "the chat's own turn, found running");
    assert.match(ready, /if \(!picked\) return no\("No project folder was chosen", false\);/, "the person closed the folder's modal: no toast, the queue still says why");
    // (fails before: yes — the owner's of 10-30: "Work outside a project", then a send, opened the folder's modal) A chat
    // with no folder works in Everything, the folder of Filament's own, made the first time; the modal is a typed
    // folder's that is not on this machine.
    assert.match(ready, /if \(!chat\.cwd\) \{\s+(?:\/\/[^\n]*\n\s+)*let home;\s+try \{\s+home = await api\("\/memory\/projects\/everything", \{ method: "POST", body: \{\} \}\);\s+\} catch \(e\) \{\s+return no\(`this chat has no folder, and Everything's could not be made: \$\{errText\(e\)\}`\);\s+\}\s+(?:\/\/[^\n]*\n\s+)*if \(chatOf\(state\.currentId\) === chat\) \{\s+folderIn\.value = home\.cwd;\s+folderIn\.dispatchEvent\(new Event\("input"\)\);\s+\}\s+chat\.cwd = home\.cwd;\s+sidebar\.load\(\);\s+\}/);
    assert.equal(ready.split("pickProjectFolder()").length, 2, "the modal once: for a folder that is not on this machine");
    assert.match(app, /onSend: \(text, attachments, modifier, o\) => sendMessage\([^\n]*\),\s+whyRefused: \(\) => \(\{ said: refusal, again: refusalAgain \}\),/);
    assert.match(composer, /onSteer: \(it\) => \{\s+(\/\/[^\n]*\n\s*)*Promise\.resolve\(cb\.onSend\(queuedText\(it\), \[\], "normal", \{ queued: true, overrules: queuedOverrules\(it\), \.\.\.queuedAnswer\(it\), \.\.\.\(live \? \{ via: \{ row: "queue-next-step", by: \/\*\* @type \{const\} \*\/ \("click"\) \} \} : \{\}\) \}\)\)\.then\(\(ok\) => \{\s+if \(ok !== false && ok !== "queue"\) return;\s+queue\.putBack\(it\);\s+paintQueue\(\);/);
  });

  // (fails before: yes — U4's closing, V4-D192: a queued message the chat's own running turn refused went back into the
  // queue, and its toast said it was back in the box)
  test("a message the queue sent, refused because the chat's own turn runs, is said to be back in the queue, not the box", () => {
    const drain = composer.slice(composer.indexOf("const drain = () => {"), composer.indexOf("const autosize = "));
    assert.match(drain, /cb\.onSend\(queuedText\(next\), queuedFiles\(next\), "normal", \{ queued: true, overrules: queuedOverrules\(next\), \.\.\.queuedAnswer\(next\), \.\.\.queuedVia\(next\) \}\)/, "the drain says the message is the queue's");
    assert.match(composer, /onSteer: \(it\) => \{[\s\S]*?cb\.onSend\(queuedText\(it\), \[\], "normal", \{ queued: true, overrules: queuedOverrules\(it\), \.\.\.queuedAnswer\(it\), /, "so does a row's Steer");
    assert.match(app, /onSend: \(text, attachments, modifier, o\) => sendMessage\(text, attachments, modifier, \{ modeSwitch: o\?\.modeSwitch === true, queued: o\?\.queued === true, overrules: o\?\.overrules \|\| \[\], sendAsIs: o\?\.sendAsIs === true, carry: o\?\.carry \|\| null, boxed: o\?\.queued !== true, fresh: o\?\.queued !== true, via: o\?\.via \|\| null \}\),/);
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(send, /^async function sendMessage\(text, attachments, modifier, \{ [^}]*queued = false[^}]*\} = \{\}\)/);
    // A waiting row's send is said to wait on its row again (live-topic-page.test.js drives it).
    assert.match(send, /toast\(\s*queued\s+\? "This chat's turn is still running — following it now\. Your message is back in the queue: Continue sends it when the turn ends\."\s+: goes\s+\? "[^"]*"\s+: gaveWay\s+\? "[^"]*"\s+: boxed\s+\? "This chat's turn is still running — following it now\. Your message is back in the box: send it at its next step, or when it's done\."\s+: ours\s+\? "[^"]*"\s+: "[^"]*",?\s*\);/);
  });

  // (fails before: yes — the map of 11-01 (F-b): a send that met the chat held ended "done" to the composer, and each
  // look of its waiting row's queue said "waiting": each sent the chat's queue's next message into the held chat, a
  // waiting row of its own each)
  test("a message waiting for the chat ends no turn: the queue behind it waits, and how the last turn ended stands", () => {
    const st = queueState();
    st.items.push("next");
    st.ended = "stopped";
    assert.equal(turnEnded(st, "waiting"), false);
    assert.equal(st.ended, "stopped");
    st.now = true;
    assert.equal(turnEnded(st, "waiting"), false, "Send now's message goes at the end of the turn the waiting one starts");
    assert.equal(st.now, true);
    assert.match(app, /const endedBy = turn\.status === "waiting" \? "waiting" : turn\.status === "stopped" \? "stopped" :/);
    assert.match(readFileSync("src/ui/harness/composer/composer.js", "utf8"), /goOn\(\) \{\s+drain\(\);\s+\}/, "a Cancel's going on drains as a turn's end does");
  });

  // (fails before: yes — HarnessV3-Views V3: a turn that ended while another chat was shown drained into that chat; and
  // the owner's of 10-30: its own queue then waited, paused, where its next message was to go)
  test("a turn's end reaches the composer only while its chat is shown; else its own queue keeps the ending, and a turn ended done sends its own next message", () => {
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(send, /if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(false, null, endedBy\);\s+else endedElsewhere\(chat, endedBy\);/);
    assert.match(send, /if \(chatOf\(state\.currentId\) === chat\) composer\.settled\(turn\.status\);\s+else if \(turnSettled\(queueOf\(chat\), turn\.status\)\) void drainElsewhere\(chat\);/);
    const waiting = app.slice(app.indexOf("function armWaiting("), app.indexOf("async function sendMessage("));
    // The row's tick waits with the composer unless a turn followed here runs in the chat (the review of c2ee8d232).
    assert.match(waiting, /onTick: \(t\) => \{[\s\S]{0,400}?turn\.waitingText = t;[\s\S]{0,120}?\}\s+if \(chatOf\(state\.currentId\) === chat && !chat\.live\) composer\.setLive\(false, null, "waiting"\);/);
    const endings = app.split("\n").filter((l) => /composer\.(setLive\(false|settled\()/.test(l));
    assert.ok(endings.length >= 5, "the endings, found");
    for (const l of endings) assert.match(l, /chatOf\(state\.currentId\) === chat( && !chat\.live)?\) composer\./, `guarded: ${l.trim()}`);
  });

  // (fails before: yes — the owner's of 10-30: nothing sent a chat's queued message while another chat was shown)
  test("a chat not shown drains its own queue: its next message as its own send, never into the chat shown; a refusal or a turn running puts it back", async () => {
    const shown = { id: "b", chainId: "cb", turns: [] };
    const away = { id: "a", chainId: "ca", model: "m-1", cwd: "/p", turns: [], live: null, queue: holding(["then run the tests", "then commit"]) };
    /** @type {any[]} */
    const sent = [];
    /** @type {any} */
    let answer;
    const scope = {
      state: { currentId: "b" },
      chatOf: (/** @type {string} */ id) => (id === "b" ? shown : id === "a" ? away : null),
      queueOf: (/** @type {any} */ c) => c.queue,
      sendMessage: async (/** @type {any[]} */ ...a) => (sent.push(a), answer),
      refusal: "",
      refusalAgain: true,
      awayNext, awayBack, queuedText, queuedFiles, queuedOverrules,
    };
    const { drainElsewhere } = lift(["drainElsewhere"], scope);
    answer = undefined;
    await drainElsewhere(away);
    assert.deepEqual(sent, [["then run the tests", [], "normal", { queued: true, overrules: [], chat: away }]], "its own send, by the chat");
    assert.deepEqual(away.queue.items, ["then commit"]);
    answer = "queue";
    await drainElsewhere(away);
    assert.deepEqual([away.queue.items, away.queue.paused], [["then commit"], false], "a turn ran after all: back first, for its end");
    answer = false;
    scope.refusal = "This chat has no model";
    await drainElsewhere(away);
    assert.deepEqual([away.queue.items, away.queue.paused, away.queue.why, away.queue.said, away.queue.again], [["then commit"], true, "refused", "This chat has no model", true]);
    // (fails before: yes — the page round of 11-02: a refusal of the message itself paused it as one Continue could send)
    scope.refusal = "/flow needs your words after it: what the flow is for. Your agent designs it from them";
    scope.refusalAgain = false;
    away.queue.paused = false;
    await drainElsewhere(away);
    assert.deepEqual([away.queue.items, away.queue.said, away.queue.again], [["then commit"], scope.refusal, false], "its own words, Continue no try again");
    sent.length = 0;
    away.queue = holding(["x"]);
    scope.state.currentId = "a";
    await drainElsewhere(away);
    assert.deepEqual(sent, [], "shown: the composer drains it, not this");
    scope.state.currentId = "b";
    away.live = /** @type {any} */ ({});
    await drainElsewhere(away);
    assert.deepEqual([sent, away.queue.items], [[], ["x"]], "a turn of its own runs: its end sends it");
  });

  // (fails before: yes — the bug hunt of 10-30 on fbd82220f: a chat not shown sent on only a turn that ended done, so
  // Send now's message, whose turn its press stopped, waited paused; and this page's own send, followed again after its
  // connection dropped, sent nothing at its end)
  test("a turn of this page's that ends in a chat not shown: done sends the next message, and Send now's goes whatever ended it; a stop, a failure or a question keeps it for you", () => {
    /** @type {any[]} */
    const drained = [];
    const scope = { queueOf: (/** @type {any} */ c) => c.queue, turnEnded, drainElsewhere: async (/** @type {any} */ c) => void drained.push(c.id) };
    const { endedElsewhere } = lift(["endedElsewhere"], scope);
    const chat = (/** @type {string} */ id, /** @type {Partial<QueueState>} */ o = {}) => ({ id, queue: holding(["next"], o) });
    const done = chat("done");
    const nowStopped = chat("now-stopped", { now: true });
    const nowFailed = chat("now-failed", { now: true });
    const stopped = chat("stopped");
    const asked = chat("asked");
    endedElsewhere(done, "done");
    endedElsewhere(nowStopped, "stopped");
    endedElsewhere(nowFailed, "error");
    endedElsewhere(stopped, "stopped");
    endedElsewhere(asked, "paused");
    assert.deepEqual(drained, ["done", "now-stopped", "now-failed"]);
    assert.deepEqual([nowStopped.queue.now, nowStopped.queue.paused], [false, false], "Send now's press is spent");
    assert.deepEqual([stopped.queue.paused, stopped.queue.why], [true, "stopped"], "a stop pauses it, saying so");
    assert.deepEqual([asked.queue.paused, asked.queue.items], [false, ["next"]], "a question keeps it: opening the chat says you were away");
    const live = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("function followLiveTurn(") + 6000);
    assert.match(live, /^function followLiveTurn\(chat, liveInfo, mine = false\) \{/);
    assert.match(live, /const unshown = chatOf\(state\.currentId\) !== chat;\s+(?:\/\/[^\n]*\n\s+)*requeueHeld\(chat, live, live\.held\.release\(\)\);\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(false, null, "done"\);\s+try \{ await hydrate\(chat\); \} catch \{\}/);
    assert.match(live, /if \(mine && unshown\) endedElsewhere\(chat, chat\.paused \? "paused" : endedAs === "error" \|\| endedAs === "stopped" \? endedAs : "done"\);/);
    assert.match(app, /toast\("The connection dropped — the turn runs on, and this page follows it again"\);\s+followLiveTurn\(chat, runsOn, true\);/, "this page's own send, followed again");
    assert.match(app, /if \(following && \(!tr\.live\.window \|\| tr\.live\.window === "harness"\)\) followLiveTurn\(chat, tr\.live\);/, "a turn found as a chat is read is no send of this page's: its end pauses as before");
  });

  // (fails before: yes — the bug hunt of 10-30 on fbd82220f: a /flow a chat not shown queued was judged by the chat shown —
  // refused where the chat shown is a team's own, and its toast and title were the chat shown's)
  test("a chat not shown sends as itself: a team's own chat by its own name, refusals said in its queue alone, the title and the toasts the chat shown's", () => {
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(send, /if \(!flowAsk\) return refuse\(FLOW_USAGE, !away, false\);\s+if \(away \? besideStore\.knownChat\(String\(away\.chainId \|\| ""\)\)\?\.main : besideStore\.main\(\)\) return refuse\(FLOW_TEAM_CHAT, !away, false\);/);
    assert.match(send, /if \(at\?\.live\?\.turn\?\.paused\) return refuse\("Your agent's turn waits for your answer: answer it first, then type \/flow", !away\);/);
    const own = send.slice(send.indexOf("if (ownTurn) {"), send.indexOf("followElsewhere(chat);", send.indexOf("if (ownTurn) {")));
    assert.match(own, /if \(chatOf\(state\.currentId\) === chat\) setTitle\(chat\);/);
    assert.match(own, /if \(!away\)\s+toast\(/);
    assert.match(send, /if \(!away\) toast\(waitingToast\(holder\)\);/);
    assert.match(send, /if \(!away\) toast\("The connection dropped — the turn runs on, and this page follows it again"\);/);
  });

  test("a send for a chat not shown is that chat's own: its model and folder, none of the box's, the read-only rule the shown chat's alone; the transcript, the composer and the title left to the chat shown", () => {
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    assert.match(send, /queued = false, overrules = \[\], carry = null, replaces = null, chat: away = null, goes = null, went = null, boxed = false, ours = false, fresh = false, via = null, brief = null \} = \{\}\)/);
    assert.match(send, /let chat = away \|\| chatOf\(state\.currentId\);/);
    assert.match(send, /if \(!away && followsStill\(\)\) return refuse\(readOnlyWords\(\)\);/);
    assert.match(send, /const ready = away \? readyAway\(chat\) : await readySession\(chat, \{ opens: fresh \}\);/);
    const comments = String.raw`(?:\/\/[^\n]*\n\s+)*`;
    assert.match(send, new RegExp(String.raw`chat\.turns\.push\(turn\);\s+transcript\.startTurn\(turn\);\s+${comments}if \(chatOf\(state\.currentId\) === chat\) \{\s+setTitle\(chat\);\s+composer\.setLive\(true, null\);\s+composer\.meter\(\);\s+\}`));
    assert.match(send, new RegExp(String.raw`chat\.live = live;\s+${comments}live\.chat = chat;\s+transcript\.startLive\(live\);`), "its chat named before the transcript is asked: it draws the shown chat's alone");
    const scope = { refusal: "", toast: () => {} };
    const { readyAway } = lift(["readyAway", "refuse"], scope);
    const chat = { chainId: "ca", model: "m-1", cwd: "/p", turns: [] };
    assert.deepEqual(readyAway(chat), { chat, model: "m-1" });
    assert.equal(readyAway({ chainId: "ca", model: "", cwd: "/p" }), null);
    assert.match(scope.refusal, /no model/);
  });

  // (fails before: yes — HarnessV3-Views V3: held messages no run read, another chat shown, stayed on their turn as
  // bubbles no run would read, the queue being the shown chat's)
  test("held messages no run read go to their own chat's queue, shown or not", () => {
    const requeue = app.slice(app.indexOf("function requeueHeld("), app.indexOf("function queueOf("));
    assert.match(requeue, /transcript\.markSteers\(live\.turn\);\s+const queued = list\.map\([\s\S]*?\);\s+queueNext\(chat, queued,/);
    assert.match(requeue, /function queueNext\(chat, texts, said\) \{\s+if \(chatOf\(state\.currentId\) !== chat\) return queueAdd\(queueOf\(chat\), texts\);\s+composer\.enqueue\(texts\);\s+toast\(said\);/);
  });

  // (fails before: yes — the review of 3f174b6b6: `queueAdd` kept a message a card answered for as its words alone,
  // ["go on", "then this"]: what the card answered was gone once the message waited in the queue)
  test("what a card answered for a message it stopped goes with it from the queue: kept whole there and across a reload, and handed to the send by the drain, a row's Steer, a chat not shown's drain and the page's send", async () => {
    const answered = { text: "go on", files: [], sendAsIs: true, carry: "words" };
    const st = queueState();
    queueAdd(st, [answered, { text: "then this", files: [], sendAsIs: false }]);
    assert.deepEqual(st.items, [answered, "then this"], "whole where a card answered for it, its words alone where nothing did");
    // Across a reload of the page: whole — and with its words alone where the tab has no room for its files.
    /** @type {Map<string, string>} */
    const kept = new Map();
    const tab = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
    keptQueues(tab).keep("c1", [answered]);
    assert.deepEqual(keptQueues(tab).take("c1").items, [answered]);
    const full = { ...tab, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (v.length > 120) throw new Error("QuotaExceededError"); kept.set(k, v); } };
    keptQueues(full).keep("c1", [{ ...answered, files: [{ kind: "image", name: "a.png", type: "image/png", data: "A".repeat(400) }] }]);
    assert.deepEqual(keptQueues(full).take("c1"), { items: [answered], lost: ["a.png"] });
    // A chat not shown sends it as its own turn ends, with what the card answered.
    const away = { id: "a", chainId: "ca", model: "m-1", cwd: "/p", turns: [], live: null, queue: queueState() };
    away.queue.items.push(answered);
    /** @type {any[]} */
    const sent = [];
    const scope = {
      state: { currentId: "b" },
      chatOf: () => null,
      queueOf: (/** @type {any} */ c) => c.queue,
      sendMessage: async (/** @type {any[]} */ ...a) => void sent.push(a),
      awayNext, awayBack, queuedText, queuedFiles, queuedOverrules,
      queuedAnswer: queueModule.queuedAnswer,
    };
    await lift(["drainElsewhere"], scope).drainElsewhere(away);
    assert.deepEqual(sent, [["go on", [], "normal", { queued: true, overrules: [], sendAsIs: true, carry: "words", chat: away }]]);
    // The shown chat's drain and a row's Steer hand it to the page's send, which sends it so (the pins above).
    assert.match(app, /onSend: \(text, attachments, modifier, o\) => sendMessage\([^\n]*sendAsIs: o\?\.sendAsIs === true, carry: o\?\.carry \|\| null,/);
  });
});
