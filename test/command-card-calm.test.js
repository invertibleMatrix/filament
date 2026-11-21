// @ts-check
// A command's card keeps still (the owner's report of 10-27: "sometimes a tool output is shown itself, like a command
// ran and it's output card is shown for a second maybe and then folds back in a jerk like motion"), and stands folded
// (the owner's of 10-28: "when you run a command it's card shows up as opened. not needed"). The Designer's answer of
// 10-28: the card opens only on the person's press, however long its command runs; its seconds stand after its words,
// never cut with a long command's; past five seconds the folded row offers Run in background, where it may move, and
// the card holds no button of its own; one the person opened stays open where it stands at its end, in a box of the
// same height, until its turn settles; the page's own drawing is never remembered as the person's choice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows, OFFER_AFTER_MS } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

/** @param {string} id @param {number} ago  how long ago it started, in ms @param {object} [more] */
const start = (id, ago, more = {}) => ({ type: "tool-start", round: 1, name: "bash", args: "npm test", id, input: { command: "npm test" }, ts: Date.now() - ago, ...more });
/** @param {string} id */
const output = (id) => ({ type: "tool-output", round: 1, id, text: "PASS a.test.js\n" });
/** @param {string} id @param {number} ms */
const end = (id, ms) => ({ type: "tool-end", round: 1, name: "bash", ok: true, ms, id, chars: 2, preview: "ok", exitCode: 0 });
/** The round's rows. @param {any[]} events @param {object} [o] @returns {any[]} */
const rows = (events, o = {}) => roundRows(alignEvents(events).byRound.get(1), o);
/** The person opens a row with a press on it. @param {any} row */
const press = (row) => {
  row.querySelector("summary").dispatch("click");
  row.open = true;
  row.dispatch("toggle");
};

// (fails before: yes — past five seconds the card opened by itself on its live output, and its seconds stood inside
// the row's words, cut with a long command's)
test("a running command's card stays folded however long it runs, its seconds after its words", () => {
  const [fresh] = rows([start("q1", 300), output("q1")], { live: true });
  assert.equal(fresh.open, false, "300 ms in: closed, though its output streams");
  const [long] = rows([start("q2", OFFER_AFTER_MS + 60_000), output("q2")], { live: true });
  assert.equal(long.open, false, "a minute in: still folded, its output a press away");
  assert.ok(long.querySelector(".term-out.live"), "its live output is in the card, for when the person opens it");
  assert.equal(long.querySelector(".tool-after .tool-clock")?.textContent, "· 1m 5s", "its seconds, after its command");
  assert.equal(long.querySelector(".tool-secondary .tool-clock"), null, "not inside the words an ellipsis cuts");
  assert.equal(fresh.querySelector(".tool-clock")?.textContent, "", "none before its first second");
});

// (fails before: yes — the long command's card the page opened stood alone at its end, out of its group, whoever
// opened it)
test("a long command that ends while its turn runs folds with the others; one the person opened stays open where it stands, its result in a box of the live one's height", () => {
  const events = [start("g1", 9000), end("g1", 200), start("g2", 8000), output("g2"), end("g2", 7000), start("g3", 500), end("g3", 100)];
  const live = rows(events, { live: true });
  assert.equal(live.length, 1, "nobody opened it: the three fold into one group as they end");
  assert.match(live[0].textContent, /3 commands/);
  const opened = [start("h1", 9000), end("h1", 200), start("h2", 8000), output("h2"), end("h2", 7000), start("h3", 500), end("h3", 100)];
  press(rows(opened.slice(0, 4), { live: true })[1]);
  const held = rows(opened, { live: true });
  assert.equal(held.length, 3, "while the turn runs: the quick ones on each side and the opened one between, each alone");
  assert.deepEqual(held.map((r) => r.open), [false, true, false], "the opened one open, its result where its output stood");
  assert.ok(held[1].querySelector(".term-out.held"), "its result's box keeps the live box's height");
});

// (fails before: yes — past five seconds the page drew the card open, and a press on it was the only way to close it)
test("the page draws no command open; a press on the row is the person's choice, kept when it is drawn again", () => {
  const [running] = rows([start("p1", OFFER_AFTER_MS + 2000), output("p1")], { live: true });
  assert.equal(running.open, false);
  running.dispatch("toggle");
  const done = [start("p1", OFFER_AFTER_MS + 2000), output("p1"), end("p1", 9000)];
  const [settled] = rows(done, {});
  assert.equal(settled.open, false, "a toggle the person did not press is not theirs");
  press(settled);
  assert.equal(rows(done, {})[0].open, true, "the person opened it: drawn again, it stays open");
});

// (fails before: yes — Run in background was a button inside the card, which opened by itself to show it)
test("a command that may go to the background offers Run in background on its folded row past five seconds, the card holding none", async () => {
  const was = chipActions.toBackground;
  /** @type {string[][]} */
  const moved = [];
  chipActions.toBackground = async (runId, callId) => { moved.push([runId, callId]); return null; };
  try {
    const [fresh] = rows([start("b1", 200, { movable: true })], { live: true, runId: "r1" });
    assert.equal(fresh.open, false);
    assert.ok(fresh.querySelector(".tool-after .tool-bg")?.classList.contains("hidden"), "200 ms in: not offered yet");
    const [long] = rows([start("b2", OFFER_AFTER_MS + 100, { movable: true })], { live: true, runId: "r1" });
    assert.equal(long.open, false, "folded");
    const link = long.querySelector("summary .tool-after .tool-bg");
    assert.ok(link && !link.classList.contains("hidden"), "on the row, after its seconds");
    assert.equal(link.textContent, "Run in background");
    assert.equal(long.querySelectorAll("button").filter((/** @type {any} */ b) => b !== link && /background/i.test(b.textContent)).length, 0, "the card holds no second one");
    let kept = false;
    link.dispatch("click", { preventDefault() { kept = true; } });
    assert.ok(kept, "the press never opens the card");
    assert.deepEqual(moved, [["r1", "b2"]]);
    assert.equal(link.textContent, "Sending…");
    const [quiet] = rows([start("b3", OFFER_AFTER_MS + 100)], { live: true, runId: "r1" });
    assert.equal(quiet.querySelector(".tool-bg"), null, "a command that cannot move offers none");
  } finally {
    chipActions.toBackground = was;
  }
});
