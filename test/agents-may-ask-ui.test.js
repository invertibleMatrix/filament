// @ts-check
// HarnessV4_Tasks E15 step 3, the page: a session's main agent asks the saved agents its session names. What the run's
// events say of such an ask and how its card on the turn reads them (AG-46): "The main agent asked", the answer folded
// with what it cost, Overrule, Copy, Open. The line over the composer while your next message overrules an answer
// (AG-47), and that message's marks on its bubble, in the running turn and in the queue. Whom the main agent may ask:
// the list's words, the row on the Start board and under the Sub Agents tab's list with its menu (AG-44, AG-53), and
// the head of a thread the main agent asked (AG-54). A finished turn folds its work and keeps those cards in view (AG-56). On the stub document with the page's own `h`, and on the fake `h` where a part
// takes one. The server's half is agents-may-ask.test.js; Settings › Agents' tick is in agents-page.test.js.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { poolChips, runsOnSubOf } from "./helpers/team-view.js";
import { h } from "../src/ui/lib/dom.js";
import { alignEvents, askedApart, foldSplit, settingChangeWords } from "../src/ui/harness/lib/labels.js";
import { askedCardRow, askedState, cardFacts } from "../src/ui/harness/conversation/agent-card.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { askedCall, askedRows, roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { deliveredWords, overrulesEl, userRow } from "../src/ui/harness/conversation/turn.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { steerEl } from "../src/ui/harness/conversation/timeline.js";
import { MAX_OVERRULED, createOverruleLine, overruleMark, overruleWords, overrulesSent, withOverruled } from "../src/ui/harness/composer/overrule-line.js";
import { queueState, queueAdd, queuedOverrules, queuedText, createQueue } from "../src/ui/harness/composer/queue.js";
import { keptQueues } from "../src/ui/harness/composer/kept-queue.js";
import { createHeldSteers } from "../src/ui/harness/lib/held-steers.js";
import { askAfter, askNamed, askedWords, createAgentCardList, mayAskWords, withAlways } from "../src/ui/harness/lib/agent-cards.js";
import { MAY_ASK_SUB, mayAskMenu, mayAskOff, mayAskRow } from "../src/ui/harness/widgets/may-ask.js";
import { effortAt, startedWords } from "../src/ui/harness/lib/subagents.js";
import { createStartBoard } from "../src/ui/harness/conversation/start-board.js";
import { createSideView } from "../src/ui/harness/views/side.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";
import { OWN_WORKERS, createAgentCardStore } from "../src/services/agent-cards.js";
import { saveOwnCards } from "./helpers/flow-cards.js";

const source = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");
const store = createAgentCardStore({ dataDir: null });
// The person's own cards ticked here, beside the ones that ship (helpers/flow-cards.js).
saveOwnCards(store);
/** The saved agents as the page holds them: the two the main agent always has are marked. @returns {any[]} */
// What the page's list offers (lib/agent-cards.js `all`): never a team's own Lead (OA-D4).
const cards = () => withAlways(/** @type {any} */ (store.list().filter((c) => !c.partOf)), OWN_WORKERS);
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

const QUESTION = "Should a fifth launch queue or fail?";
const ANSWER = "**Fail it**, and name the `limit`.\n\nA queue hides what the wait costs.";
const START = { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: QUESTION, agent: "pm", model: "zai/glm-5.3", prompt: QUESTION, card: { tag: "pm", name: "PM" }, asked: true };
const END = { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_1", status: "done", ok: true, ms: 21_000, rounds: 2, toolCalls: 1, tokensIn: 13_000, tokensOut: 1_000, spentUsd: 0.004, report: ANSWER, model: "zai/glm-5.3" };
/** What a turn's events told of the main agent's ask. @param {any[]} [more] @param {any} [start] @returns {any} */
const told = (more = [], start = START) =>
  alignEvents([{ type: "tool-start", round: 1, id: "a1", name: "agent", args: QUESTION, card: { kind: "subagent", title: "agent", subject: QUESTION } }, start, ...more]).byRound.get(1).tools.get("a1").sub;
/** The page's row of that agent, while Filament holds it. @param {any} [o] @returns {any} */
const listed = (o = {}) => ({ id: "sa_1", status: "running", model: "zai/glm-5.3", card: { tag: "pm", name: "PM" }, asked: true, may: "read", origin: "agent", description: QUESTION, exchanges: [{ status: "running", startedAt: 1_000, description: QUESTION }], progress: null, ...o });
/** An answer a message overrules. @param {any} [o] @returns {import("../src/ui/harness/composer/overrule-line.js").Overruling} */
const overruled = (o = {}) => ({ agentId: "sa_1", exchange: 0, name: "PM", question: QUESTION, answer: "Fail it, and name the limit.", ...o });

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

// (fails before: yes — the run's events of an agent the main agent launched carried no card, no cost and no word that
// the answer was clipped, and an overrule had no place among a round's messages)
describe("what the run's events say of an agent the main agent asked", () => {
  test("whose card it is, what the answer cost, and that the answer it carries was clipped", () => {
    const s = told([{ ...END, reportCut: true }]);
    assert.deepEqual(s.card, { tag: "pm", name: "PM" });
    assert.deepEqual([s.agentId, s.exchange, s.prompt, s.state, s.status, s.tokens, s.usd, s.ms, s.reportCut, s.report], ["sa_1", 0, QUESTION, "done", "done", 14_000, 0.004, 21_000, true, ANSWER]);
    const plain = told([END], { ...START, card: undefined });
    assert.equal(plain.card, undefined, "a sub-agent that is no saved agent has no card");
    assert.equal(told([END]).reportCut, undefined);
    assert.equal(told([{ ...END, spentUsd: undefined }]).usd, 0);
  });

  test("an overrule the main agent read stands among its round's messages, by the agent's name", () => {
    const { byRound } = alignEvents([
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "subagent-report", round: 1, agentId: "sa_1", kind: "overrule", description: "PM" },
      { type: "subagent-report", round: 1, agentId: "sa_2", kind: "report", description: "Quick" },
    ]);
    assert.deepEqual(byRound.get(1).reports[0], { agentId: "sa_1", kind: "overrule", description: "PM" });
    assert.equal(byRound.get(1).reports[1].kind, "report");
    const timeline = source("conversation/timeline.js");
    assert.ok(timeline.includes('`The main agent read here that you overrule ${r.description || "a saved agent"}\'s answer`'), "the row's words");
    assert.ok(timeline.includes("`${name} answered — its answer joined the conversation here`"), "a saved agent's answer is said by its name");
  });
});

// (fails before: yes — the launch's row read as any sub-agent's: the question as a task, "1 tool use · 14k tokens", and
// the answer behind "Open conversation")
describe("the card of an agent the main agent asked", () => {
  test("how it stands while it works: its own newest call, else that it thinks or starts; the list's word where the page has it; a call that waits for you", () => {
    const at = { running: true, listed: false, row: null };
    assert.deepEqual([askedState(told(), at).phase, askedState(told(), at).live, askedState(told(), at).model], ["running", "Starting…", "zai/glm-5.3"]);
    const reading = [{ type: "subagent-tool-start", round: 1, parent: "a1", id: "r1", name: "read", args: "subagents.js", card: { kind: "read", title: "Read", subject: "subagents.js" } }];
    assert.equal(askedState(told(reading), at).live, "Read subagents.js");
    assert.equal(askedState(told([...reading, { type: "subagent-tool-end", round: 1, parent: "a1", id: "r1", name: "read", ok: true, ms: 3, chars: 9 }]), at).live, "Thinking…");
    assert.equal(askedState(told(reading), { ...at, row: listed({ progress: { tool: { name: "grep", args: "maxConcurrent" } } }) }).live, "grep maxConcurrent");
    assert.equal(askedState(told([...reading, { type: "subagent-ask", round: 1, parent: "a1", agentId: "sa_1", tool: "read", args: ".env" }]), at).live, "Waits for your answer");
  });

  test("how it stands at its end: the answer and its figures; clipped, or the list's, it is not the whole; one that did not finish; one Filament lost", () => {
    const at = { running: false, listed: false, row: null };
    const done = askedState(told([END]), at);
    assert.deepEqual([done.phase, done.status, done.text, done.whole, done.tokens, done.usd, done.ms], ["done", "done", ANSWER, true, 14_000, 0.004, 21_000]);
    assert.equal(cardFacts(done), "GLM-5.3 · 14k · $0.0040 · 21s");
    assert.equal(askedState(told([{ ...END, reportCut: true }]), at).whole, false, "the event's answer was clipped");
    assert.equal(askedState(told([END]), { ...at, listed: true }).whole, false, "the list's word of the end is clipped there");
    assert.equal(askedState(told([{ ...END, spentUsd: 0 }]), { ...at, row: listed({ exchanges: [{ status: "done", spentUsd: 0.007 }] }) }).usd, 0.007, "the list's cost where the event named none");
    const failed = askedState(told([{ ...END, ok: false, status: "failed", report: "", error: "HTTP 500" }]), at);
    assert.deepEqual([failed.phase, failed.status, failed.error], ["failed", "failed", "HTTP 500"]);
    assert.deepEqual([askedState({ ...told(), state: "stopped", status: "cut" }, at).phase, askedState({ ...told(), state: "stopped", status: "cut" }, at).lost], ["lost", "was cut off: Filament stopped while it worked"]);
    assert.equal(askedState({ ...told(), state: "stopped", status: "forgotten" }, at).lost, "its end is not known: Filament holds this agent no longer");
  });

  /** What the page gives a card. @type {{ row: any, outside: string | null, over: Map<string, { words: string }>, calls: any[], whole: string }} */
  let page;
  beforeEach(() => {
    page = { row: listed(), outside: null, over: new Map(), calls: [], whole: "THE WHOLE ANSWER\n\nfrom the list" };
    Object.assign(chipActions, {
      subagentRow: () => page.row,
      subagentsKnown: () => true,
      outsideClient: () => page.outside,
      openSubagent: (/** @type {string} */ id) => page.calls.push(["open", id]),
      stopSubagent: (/** @type {string} */ id) => page.calls.push(["stop", id]),
      overrule: (/** @type {any} */ o) => page.calls.push(["overrule", o]),
      overruledOf: (/** @type {string} */ id, /** @type {number} */ x) => page.over.get(`${id}:${x}`) || null,
      cardAnswer: async () => page.whole,
    });
  });
  after(() => {
    for (const k of ["subagentRow", "subagentsKnown", "outsideClient", "openSubagent", "stopSubagent", "overrule", "overruledOf", "cardAnswer"]) /** @type {any} */ (chipActions)[k] = null;
  });
  /** A card, and the repaint its follow of the list asks for. @param {any} s @param {any} [io] */
  const drawn = (s, io = {}) => {
    /** @type {() => void} */
    let repaint = () => {};
    const row = /** @type {any} */ (askedCardRow(s, { running: false, ...io, follow: (_row, onChange) => { repaint = onChange; } }));
    return { row, repaint: () => repaint() };
  };
  const words = (/** @type {any} */ row, /** @type {string} */ cls) => row.querySelector(`.${cls}`)?.textContent ?? null;
  const buttons = (/** @type {any} */ row) => row.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent).filter(Boolean);
  const btn = (/** @type {any} */ row, /** @type {string} */ label) => row.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;
  /** The card opened by its line: folded, a card is its line alone (E37). @param {any} row */
  const openedRow = (row) => {
    row.querySelector(".ask-card-line").dispatch("click");
    return row;
  };

  test("while it works: who asked and what, the agent, one live line, Open and Stop", () => {
    const { row } = drawn(told(), { running: true });
    assert.equal(row.className, "ask-card is-running");
    assert.deepEqual([words(row, "ask-card-you"), words(row, "ask-card-question"), words(row, "ask-card-name"), words(row, "ask-card-first"), words(row, "ask-card-facts")], ["The main agent asked", QUESTION, "PM", "Starting…", "GLM-5.3"]);
    assert.deepEqual([row.getAttribute("data-agent"), row.getAttribute("data-tag")], ["sa_1", "pm"]);
    assert.deepEqual(buttons(row), ["Open", "Stop"]);
    btn(row, "Stop").dispatch("click");
    btn(row, "Open").dispatch("click");
    assert.deepEqual(page.calls, [["stop", "sa_1"], ["open", "sa_1"]]);
    assert.equal(words(drawn(told([], { ...START, followUp: true }), { running: true }).row, "ask-card-you"), "The main agent asked again");
  });

  test("done, it folds to the answer's first line with the model, tokens, cost and time: Overrule, Copy, Open — nothing to send on, nothing to ask again", () => {
    page.row = listed({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 22_000 }] });
    const { row } = drawn(told([END]));
    assert.equal(row.className, "ask-card is-done");
    assert.deepEqual([words(row, "ask-card-first"), words(row, "ask-card-facts")], ["Fail it, and name the limit.", "GLM-5.3 · 14k · $0.0040 · 21s"]);
    assert.ok(row.querySelector(".ask-card-body").classList.contains("hidden"), "folded");
    assert.deepEqual(buttons(row), [], "folded: its line alone, nothing waiting for you");
    row.querySelector(".ask-card-toggle").dispatch("click");
    assert.deepEqual(buttons(row), ["Overrule", "Copy", "Open"]);
    btn(row, "Overrule").dispatch("click");
    assert.deepEqual(page.calls, [["overrule", { agentId: "sa_1", exchange: 0, name: "PM", question: QUESTION, answer: "Fail it, and name the limit." }]]);
    // Filament holds the agent no longer (a restart): the answer is the card's own, and there is no conversation to open.
    page.row = null;
    assert.deepEqual(buttons(openedRow(drawn(told([END])).row)), ["Overrule", "Copy"]);
  });

  // (fails before: yes — the Hunter's of 10-28: an editor the main agent asked finished with files in its copy, and its
  // card said nothing of them, nor opened their row in Changes)
  test("an editor it asked whose files wait in its copy: the card says so, folded too, and Review › opens its row in Changes", () => {
    page.row = listed({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 22_000 }] });
    Object.assign(chipActions, { subagentWork: () => ({ pending: 2, applied: 0 }), reviewSubagent: (/** @type {string} */ id) => void page.calls.push(["review", id]) });
    try {
      const { row } = drawn(told([END]));
      assert.deepEqual(buttons(row), ["2 files wait in its copy · Review ›"], "folded: what waits for you");
      btn(row, "2 files wait in its copy · Review ›").dispatch("click");
      assert.deepEqual(page.calls, [["review", "sa_1"]]);
      row.querySelector(".ask-card-toggle").dispatch("click");
      assert.deepEqual(buttons(row), ["2 files wait in its copy · Review ›", "Overrule", "Copy", "Open"]);
    } finally {
      Object.assign(chipActions, { subagentWork: null, reviewSubagent: null });
    }
  });

  test("overruled, the card says with which words, and offers to overrule again; the list's change repaints it", () => {
    page.row = null;
    const { row, repaint } = drawn(told([END]));
    openedRow(row);
    assert.equal(words(row, "is-overruled"), null);
    page.over.set("sa_1:0", { words: "no: queue it, and say it is queued" });
    repaint();
    assert.equal(words(row, "is-overruled"), "Overruled by you: “no: queue it, and say it is queued”");
    assert.deepEqual(buttons(row), ["Overrule again", "Copy"]);
    // Another exchange of the same agent is another answer.
    assert.equal(words(drawn(told([END], { ...START, exchange: 1 })).row, "is-overruled"), null);
  });

  test("no Overrule where your words could not reach the main agent, or where no answer was given", () => {
    page.row = null;
    page.outside = "Claude Code";
    assert.deepEqual(buttons(openedRow(drawn(told([END])).row)), ["Copy"], "another client writes this session's turns");
    page.outside = null;
    const failed = drawn(told([{ ...END, ok: false, status: "failed", report: "half an answer", error: "HTTP 500" }])).row;
    assert.equal(failed.className, "ask-card is-failed");
    assert.equal(words(failed, "ask-card-first"), "failed: HTTP 500");
    assert.deepEqual(buttons(openedRow(failed)), ["Copy"]);
    /** @type {any} */ (chipActions).overrule = null;
    assert.deepEqual(buttons(openedRow(drawn(told([END])).row)), ["Copy"], "a page that takes no overrule offers none");
    const lost = drawn({ ...told(), state: "stopped", status: "forgotten" }).row;
    assert.equal(lost.className, "ask-card is-lost");
    assert.equal(words(lost, "ask-card-first"), "its end is not known: Filament holds this agent no longer");
    assert.deepEqual(buttons(openedRow(lost)), []);
    // The main agent's own agents wear their colour too: PM, a card of the person's own, an agent's blue.
    assert.equal(lost.getAttribute("style"), "--card-tone: var(--color-sys-blue)");
  });

  // (fails before: yes — a turn's rows are drawn anew with each batch of events: a card opened while its turn went on
  // folded again at the next one)
  test("opened, the answer whole — and it stays open when its turn draws the card anew; a clipped answer is read whole once", async () => {
    let open = false;
    const opened = { get: () => open, set: (/** @type {boolean} */ on) => { open = on; } };
    page.row = listed({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 22_000 }] });
    const first = drawn(told([{ ...END, reportCut: true }]), { opened }).row;
    first.querySelector(".ask-card-toggle").dispatch("click");
    assert.equal(open, true);
    assert.equal(first.className, "ask-card is-done is-open");
    assert.match(String(first.querySelector(".ask-card-body").innerHTML), /<b>Fail it<\/b>, and name the <code>limit<\/code>\./, "the answer as markdown, as far as the card holds it");
    await settle();
    assert.match(String(first.querySelector(".ask-card-body").innerHTML), /THE WHOLE ANSWER/, "the clipped answer was read whole from the list");
    const again = drawn(told([END]), { opened }).row;
    assert.equal(again.className, "ask-card is-done is-open", "drawn anew, it stands open");
    assert.ok(!again.querySelector(".ask-card-body").classList.contains("hidden"));
    again.querySelector(".ask-card-toggle").dispatch("click");
    assert.equal(open, false);
  });

  test("the turn draws the card in the launch's row's place, following the page's list", () => {
    const render = source("conversation/tools/render.js");
    assert.match(render, /const io = \{ running, listed: !!end && !end\.gone, follow: [^\n]*followStore\(row, onChange, gone\), opened: \{ get: \(\) => openState\.get\(t\.id\) === true, set: [^\n]*openState\.set\(t\.id, open\) \} \};/);
    // Drawn again, the card that stands is painted from the call's newest facts (the owner's of 11-01: its buttons
    // blinked under the pointer, made anew at every event).
    assert.match(render, /return \(stands && askedCardAgain\(stands, s, io\)\) \|\| askedCardRow\(s, io\);/);
  });
});

// (fails before: yes — there was no way to answer an agent's answer but a message that named it by hand)
// (fails before: yes — the card stood among its round's rows, so the fold that closes on a finished turn's work closed
// on it too: the answer, and its Overrule, were behind "Worked for 11s")
describe("a finished turn keeps the main agent's asks in view", () => {
  /** A round whose agent read a file, then asked PM. @returns {any} */
  const round = () =>
    alignEvents([
      { type: "tool-start", round: 1, id: "r1", name: "read", args: "notes.txt", card: { kind: "read", title: "Read", subject: "notes.txt" } },
      { type: "tool-end", round: 1, id: "r1", ok: true, preview: "the queue holds four" },
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: QUESTION, card: { kind: "subagent", title: "agent", subject: QUESTION } },
      START,
      END,
      { type: "tool-end", round: 1, id: "a1", ok: true },
    ]).byRound.get(1);
  const classes = (/** @type {any[]} */ rows) => rows.map((r) => r.className);

  test("which call is an ask: its run's events named the agent's card — never a plain launch", () => {
    const cell = round();
    assert.deepEqual(cell.order.map((/** @type {string} */ id) => askedCall(cell.tools.get(id))), [false, true]);
    const plain = alignEvents([{ type: "tool-start", round: 1, id: "a1", name: "agent", args: "Map it" }, { ...START, agent: "scout", card: { tag: "scout", name: "Scout" }, asked: undefined }]).byRound.get(1).tools.get("a1");
    assert.equal(askedCall(plain), false, "a worker it sent off is the agent's own launch: a row, not a card");
    assert.equal(askedCall(null), false);
  });

  test("while the turn runs the card stands where the agent asked; settled, the round's rows leave it out and it is drawn apart", () => {
    const cell = round();
    assert.deepEqual(classes(roundRows(cell)), ["tool-row", "ask-card is-done"], "in the order the round made its calls");
    assert.deepEqual(classes(roundRows(cell, { asksApart: true })), ["tool-row"]);
    const apart = askedRows([cell]);
    assert.deepEqual(classes(apart), ["ask-card is-done"]);
    assert.equal(/** @type {any} */ (apart[0]).querySelector(".ask-card-you").textContent, "The main agent asked");
    // A round that only asked holds no row once its card stands apart.
    const only = alignEvents([{ type: "tool-start", round: 2, id: "a1", name: "agent", args: QUESTION }, { ...START, round: 2 }, { ...END, round: 2 }]).byRound.get(2);
    assert.deepEqual(roundRows(only, { asksApart: true }), []);
    assert.equal(askedRows([cell, only]).length, 2, "every round's asks, in order");
  });

  test("the asked cards never fold: apart from the turn's other segments, which lay out as they always did", () => {
    const seg = (/** @type {string} */ kind, /** @type {any} */ more = {}) => ({ kind, ...more });
    const words = seg("block", { block: { type: "text", text: "Asking PM first." } });
    const answer = seg("block", { block: { type: "text", text: "A fifth launch fails." } });
    const cardsSeg = seg("cards");
    const asked = seg("asked");
    const files = seg("files");
    const split = askedApart([words, cardsSeg, answer, asked, files]);
    assert.deepEqual(split, { asked: [asked], rest: [words, cardsSeg, answer, files] });
    assert.deepEqual(foldSplit(split.rest), { lastText: answer, lead: [], pictures: [], fold: [words, cardsSeg], after: [files], closing: null });
    // A turn that only asked: nothing is left to fold, so its words stand over the card and the answer under it.
    const bare = askedApart([words, answer, asked]);
    assert.deepEqual(foldSplit(bare.rest), { lastText: answer, lead: [words], pictures: [], fold: [], after: [], closing: null });
    assert.deepEqual(askedApart(null), { asked: [], rest: [] });
  });

  test("the timeline draws them in one box between the work and the answer, once the turn has settled", () => {
    const timeline = source("conversation/timeline.js");
    assert.match(timeline, /drawn = null, asksApart = !live, steers = true, ownChat = true \}\) \{\n\s*const rows = roundRows\(cell, \{ onPrompt, runId, turnAt, asksApart, drawn, live \}\);/, "a settled turn's rounds leave the asks out");
    assert.match(timeline, /const asked = live \? \[\] : askedRows\(drawn\.map\(\(r\) => al\.byRound\.get\(r\)\), \{ onPrompt, runId: turn\.runId, turnAt \}\);/);
    assert.match(timeline, /if \(!rows\.length && !pics\.length && !own\.length\) continue;/, "no empty box for the fold to count");
    assert.match(timeline, /const box = rows\.length \? keptBox\(v\.boxes, rounds\[0\], rows\) : null;/, "a round that only drew has no box");
    assert.match(timeline, /turn\.segments\.splice\(idx, 0, \.\.\.\(box \? \[\{ kind: "cards", round: rounds\[0\], last: rounds\.at\(-1\), el: box \}\] : \[\]\), \.\.\.pics, \.\.\.here\);/);
    assert.match(timeline, /if \(asked\.length\) turn\.segments\.push\(\{ kind: "asked", round: Infinity, el: h\("div", \{ class: "cards asked-cards" \}, \.\.\.asked\) \}\);/);
    assert.match(timeline, /if \(!turn\.segments\.some\(\(s\) => s\.kind === "cards" \|\| s\.kind === "compacted"\) && !asked\.length\) archiveCards\(turn\);/, "the archived stubs do not stand in for cards drawn apart");
    assert.match(timeline, /s\.kind !== "cards" && s\.kind !== "files" && s\.kind !== "asked" && s\.kind !== "visual" && s\.kind !== "artifact" && s\.kind !== "compacted" && s\.kind !== "hold"\);/, "drawn anew each time the turn's cards are placed");
    assert.match(timeline, /const \{ asked, rest \} = askedApart\(segmentsShown\(turn\)\);\s+const \{ lastText, lead, pictures, fold, after, closing \} = foldSplit\(rest, \{ live, note: turn\.note \}\);/);
    assert.match(timeline, /\.\.\.lead\.map\(\(s\) => s\.el\), \.\.\.pictures\.map\(\(s\) => s\.el\), \.\.\.asked\.map\(\(\/\*\* @type \{any\} \*\/ s\) => s\.el\), lastText \? lastText\.el : null,/, "over the answer, where the agent's decision follows");
  });
});

describe("the line over the composer while your next message overrules", () => {
  test("which answers: the same one once, the newest last, eight at most; and what a send carries of them", () => {
    const pm = overruled();
    const designer = overruled({ agentId: "sa_2", name: "Designer", question: "Where does it go?", answer: "Under the pills." });
    assert.deepEqual(withOverruled([pm], designer), [pm, designer]);
    assert.deepEqual(withOverruled([pm, designer], { ...pm, answer: "again" }).map((o) => [o.agentId, o.answer]), [["sa_2", "Under the pills."], ["sa_1", "again"]]);
    assert.deepEqual(withOverruled([pm], overruled({ exchange: 1 })).length, 2, "another exchange of the same agent is another answer");
    const many = Array.from({ length: 10 }, (_, i) => overruled({ agentId: `sa_${i}` })).reduce((list, o) => withOverruled(list, o), /** @type {any[]} */ ([]));
    assert.deepEqual([many.length, many[0].agentId, MAX_OVERRULED], [8, "sa_2", 8]);
    assert.deepEqual(overrulesSent([pm]), [{ agentId: "sa_1", exchange: 0, name: "PM", question: QUESTION }], "the answer's first line is the line's alone");
  });

  test("its words: whose answer and the answer's first line; two agents; two answers of one; and the mark a message wears", () => {
    assert.equal(overruleWords([]), null);
    assert.deepEqual(overruleWords([overruled()]), { whose: "PM's answer", quote: "Fail it, and name the limit." });
    const long = overruleWords([overruled({ answer: "x".repeat(200) })]);
    assert.deepEqual([long?.quote.length, long?.quote.endsWith("…")], [90, true]);
    const designer = overruled({ agentId: "sa_2", name: "Designer" });
    assert.deepEqual(overruleWords([overruled(), designer]), { whose: "the answers of PM and Designer", quote: "" });
    assert.deepEqual(overruleWords([overruled(), overruled({ exchange: 1 })]), { whose: "2 answers of PM", quote: "" });
    assert.equal(overruleMark([{ name: "PM" }]), "overrules PM's answer");
    assert.equal(overruleMark([{ name: "PM" }, { name: "PM" }]), "overrules PM's answers");
    assert.equal(overruleMark([{ name: "PM" }, { name: "Designer" }, { name: "Skeptic" }]), "overrules the answers of PM, Designer and Skeptic");
    assert.equal(overruleMark([{}]), "overrules a saved agent's answer");
  });

  test("drawn over the box while something is overruled, gone otherwise; its × takes the overrule back", () => {
    /** @type {any[]} */
    let list = [];
    let cleared = 0;
    const line = createOverruleLine({ list: () => list, onClear: () => { cleared++; list = []; line.paint(); } });
    const el = /** @type {any} */ (line.el);
    line.paint();
    assert.ok(el.classList.contains("hidden"));
    list = [overruled()];
    line.paint();
    assert.equal(el.className, "ask-line over-line");
    assert.equal(el.textContent, "Overruling PM's answer: “Fail it, and name the limit.” · to the main agent");
    const x = el.querySelector(".over-x");
    assert.equal(x.getAttribute("aria-label"), "Do not overrule");
    x.dispatch("click");
    assert.equal(cleared, 1);
    assert.ok(el.classList.contains("hidden"));
    list = [overruled(), overruled({ agentId: "sa_2", name: "Designer" })];
    line.paint();
    assert.equal(el.textContent, "Overruling the answers of PM and Designer · to the main agent");
  });

  test("the composer: a card's Overrule sets the line, a draft for saved agents takes none, and the message that goes takes it along", () => {
    const composer = source("composer/composer.js");
    assert.match(composer, /overrule\(o\) \{\s+if \(asking \|\| !cb\.getChat\(\)\) return false;\s+setOverruling\(withOverruled\(overruling\(\), o\)\);\s+ta\.focus\(\);\s+return true;/);
    assert.match(composer, /const takeOverruling = \(text\) => \{\s+const list = overruling\(\);\s+if \(!list\.length \|\| text\.startsWith\("\/"\)\) return \[\];\s+setOverruling\(\[\]\);\s+return list;/, "a command's turn overrules nothing: the line stays for the message after it");
    assert.match(composer, /Promise\.resolve\(cb\.onSend\(text, files, modifier, \{ overrules, \.\.\.\(via \? \{ via \} : \{\}\) \}\)\)\.then\(\s*\(ok\) => \{\s+(\/\/[^\n]*\n\s*)*if \(ok === false\) backInBox\(text, files, overrules\);/, "a refused send gives the overrule back with the words");
    assert.match(composer, /\(e\) => \{\n\s+const why = [^\n]*\n\s+if \(cb\.getChat\(\) === sentFrom\) \{\n\s+backInBox\(text, files, overrules\);/, "a send that threw gives them back too, to its own chat's box");
    assert.match(composer, /if \(overrules\.length\) setOverruling\(overrules\.reduce\(\(list, o\) => withOverruled\(list, o\), overruling\(\)\)\);/, "beside any overruled since");
    assert.match(composer, /else if \(ok === "queue"\) \{\s+queue\.push\(asQueued\(text, files, overrules, via\)\);\s+paintQueue\(\);\s+\}/, "queued, the message keeps what it overrules — and its files, pictures and a team's result alike");
    assert.match(composer, /const asQueued = \(text, files, overrules, via = null\) => \(files\.length \|\| overrules\.length \|\| via \? \{ text, files, \.\.\.\(overrules\.length \? \{ overrules \} : \{\}\), \.\.\.\(via \? \{ via \} : \{\}\) \} : text\);/);
    assert.match(composer, /const overruling = \(\) => cb\.getChat\(\)\?\.overruling \|\| \[\];/, "the shown chat's own: another chat has its own");
    const app = source("app.js");
    assert.match(app, /chipActions\.overrule = \(o\) => \{\s+if \(!composer\.overrule\(o\)\) toast\("Your draft is for a saved agent — send or clear it, then overrule"\);/);
    assert.match(app, /if \(marks\.status === 200\) noteOverruled\(chat, overrules, text\);/, "the card says it once the turn was taken");
    assert.match(app, /overrules: overrulesSent\(overrules\),/, "the turn's request carries whose answers");
    assert.match(app, /chat\.subagentOverruled = new Map\(Object\.entries\(tr\.subagentOverruled \|\| \{\}\)/, "and a reload reads it from the session's record");
    assert.match(app, /if \(msg\?\.type !== "subagent-mark" \|\| msg\.mark\?\.event !== "overruled"\) return;/, "another window's overrule reaches this one's cards");
  });
});

// (fails before: yes — the line that names whom the agent may ask rode the message as one more of Filament's blocks, and
// the bubble said "with 1 sub-agent message" under every message of a chat that names agents: AG-74)
describe("the line that names whom the agent may ask", () => {
  test("is not a sub-agent's message: the bubble's note leaves it out, live and read back, and shows the typed words alone", () => {
    assert.equal(deliveredWords({ deliveries: 1, asking: 1 }), "");
    assert.equal(deliveredWords({ deliveries: 3, asking: 1 }), "with 2 messages from agents");
    assert.equal(deliveredWords({ deliveries: 4, asking: 1, shellExits: 1, overrules: [{ name: "PM" }] }), "with 1 message from agents and 1 background shell exit");
    const user = { role: "user", content: [{ type: "text", text: "[Filament: the developer named saved agents for you to consult: pm. Before you settle a choice between ways that could both be right, in a plan or in the files, ask one first.]" }, { type: "text", text: "fix it" }] };
    const [t] = transcriptTurns({ turns: [{ n: 1, turnId: 1, requestIds: [], user, deliveries: 1, asking: 1, work: [], final: { role: "assistant", content: [{ type: "text", text: "ok" }] } }] });
    assert.deepEqual([t.userText, t.deliveries, t.asking], ["fix it", 1, 1]);
    const row = /** @type {any} */ (userRow(t, { onCopy: () => {}, onRewind: () => {} }));
    assert.equal(row.querySelector(".u-delivered"), null);
    for (const [file, word] of [["lib/api.js", "x-filament-asking"], ["app.js", "turn.asking = marks.asking"]]) assert.ok(source(file).includes(word), `${file}: the live turn takes the count from the reply's head`);
  });
});

// (fails before: yes — a message carried no word of what it overruled)
describe("a message that overrules says so", () => {
  test("on its bubble: its own mark, and Filament's word of it is not counted as a sub-agent's message", () => {
    assert.equal(deliveredWords({ deliveries: 1, overrules: [{ name: "PM" }] }), "");
    assert.equal(deliveredWords({ deliveries: 3, shellExits: 1, overrules: [{ name: "PM" }] }), "with 1 message from agents and 1 background shell exit");
    assert.equal(deliveredWords({ deliveries: 2 }), "with 2 messages from agents");
    assert.equal(overrulesEl({}), null);
    assert.equal(/** @type {any} */ (overrulesEl({ overrules: [{ name: "PM" }, { name: "Designer" }] })).textContent, "overrules the answers of PM and Designer");
    const row = /** @type {any} */ (userRow({ userText: "no: queue it", userContent: [{ type: "text", text: "no: queue it" }], deliveries: 1, overrules: [{ name: "PM" }] }, { onCopy: () => {}, onRewind: () => {} }));
    assert.equal(row.querySelector(".u-overrules").textContent, "overrules PM's answer");
    assert.equal(row.querySelector(".u-delivered"), null);
    assert.ok(source("conversation/history.js").includes("overrules"), "a turn read back keeps whose answers");
  });

  test("sent into the running turn: the note's bubble names whose answer", () => {
    const note = /** @type {any} */ (steerEl({ kind: "note", text: "no: queue it", read: false, overrules: [{ name: "PM" }] }));
    assert.equal(note.querySelector(".steer-overrules").textContent, "overrules PM's answer");
    assert.equal(/** @type {any} */ (steerEl({ kind: "note", text: "carry on", read: false })).querySelector(".steer-overrules"), null);
    // (fails before: yes — the mark came from the page's own state, so a reload drew the note bare) The run's record
    // of the note names the answers, and the page reads them from it.
    const { steers } = alignEvents([{ type: "steer", id: "s1", kind: "note", text: "Queue it.", at: 5, state: "queued", overrules: [{ agentId: "sa_1", exchange: 0, name: "PM" }] }, { type: "steer", id: "s2", kind: "note", text: "carry on", at: 6, state: "queued" }]);
    assert.deepEqual([steers.get("s1").overrules, steers.get("s2").overrules], [[{ name: "PM" }], undefined]);
    assert.equal(/** @type {any} */ (steerEl(steers.get("s1"))).querySelector(".steer-overrules").textContent, "overrules PM's answer");
    assert.ok(source("../harness.css").includes(".u-overrules, .steer-state.steer-overrules, .queue-overrules { color: var(--color-sys-orange-text); }"), "the mark keeps its colour under the note's own state style");
  });

  test("waiting: a queued message keeps what it overrules, shows it on its row, and brings it back to the box; a held one sends it with the words", async () => {
    const st = queueState();
    queueAdd(st, ["plain", { text: "no: queue it", files: [], overrules: [overruled()] }, { text: "words only", files: [] }]);
    assert.deepEqual(st.items.map((it) => [queuedText(it), queuedOverrules(it).length, typeof it]), [["plain", 0, "string"], ["no: queue it", 1, "object"], ["words only", 0, "string"]]);
    /** @type {any[]} */
    const steered = [];
    /** @type {any[]} */
    const edited = [];
    const q = createQueue({ onSteer: (it) => steered.push(it), onEdit: (it) => edited.push(it), onContinue: () => {} });
    q.bind(st);
    q.steers(true, true);
    const rows = /** @type {any} */ (q.el).querySelectorAll(".queue-row");
    assert.deepEqual(rows.map((/** @type {any} */ r) => r.querySelector(".queue-overrules")?.textContent || ""), ["", "overrules PM's answer", ""]);
    rows[1].querySelectorAll("button").find((/** @type {any} */ b) => b.getAttribute("aria-label") === "Send at its next step").dispatch("click");
    assert.deepEqual(steered.map((it) => [queuedText(it), queuedOverrules(it).map((o) => o.name)]), [["no: queue it", ["PM"]]], "a row's Steer sends it with what it overrules");
    queueAdd(st, steered);
    q.bind(st);
    /** @type {any} */ (q.el).querySelectorAll(".queue-row").at(-1).querySelectorAll("button").find((/** @type {any} */ b) => b.getAttribute("aria-label") === "Edit").dispatch("click");
    assert.deepEqual(edited.map((it) => queuedOverrules(it).map((o) => o.name)), [["PM"]], "Edit hands the box the message whole");
    queueAdd(st, edited);
    // A copy kept across a reload keeps it; a storage too full for files keeps the words with their overrule.
    const kept = new Map();
    const tab = (/** @type {number} */ room) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (v.length > room) throw new Error("QuotaExceededError"); kept.set(k, v); }, removeItem: (/** @type {string} */ k) => void kept.delete(k) });
    const whole = keptQueues(tab(1e6));
    whole.keep("c1", st.items);
    assert.deepEqual(whole.take("c1").items.map((it) => queuedOverrules(it).map((o) => o.name)), [[], [], ["PM"]]);
    const tight = keptQueues(tab(420));
    assert.equal(tight.keep("c1", [{ text: "no: queue it", files: [{ kind: "image", name: "shot.png", type: "image/png", data: "A".repeat(600) }], overrules: [overruled()] }]), false);
    const back = tight.take("c1");
    assert.deepEqual([back.lost, back.items.map((it) => [queuedText(it), queuedOverrules(it).map((o) => o.name)])], [["shot.png"], [["no: queue it", ["PM"]]]]);
    // Held for a run the page has not learned yet: the overrule goes to the run with the words.
    /** @type {any[]} */
    const posted = [];
    const held = createHeldSteers({ post: async (runId, m) => { posted.push([runId, m.text, m.overrules?.map((/** @type {any} */ o) => o.name)]); return {}; } });
    held.hold("note", "no: queue it", [overruled()]);
    held.hold("note", "carry on");
    await held.flush("run-1");
    assert.deepEqual(posted, [["run-1", "no: queue it", ["PM"]], ["run-1", "carry on", undefined]]);
  });
});

// (fails before: yes — the page had no word for whom a chat's main agent may ask, and no place to say it)
describe("whom the main agent may ask, in words", () => {
  test("the cards a list names, each once, in its order; the tags whose card is gone; and the row's few words", () => {
    const read = askNamed(["designer", "@PM", "pm-2", "pm", " "], cards());
    assert.deepEqual([read.tags, read.named.map((c) => c.name), read.gone], [["designer", "pm", "pm-2"], ["Designer", "PM"], ["pm-2"]]);
    assert.deepEqual(askNamed(null, cards()), { tags: [], named: [], gone: [] });
    assert.equal(mayAskWords([]), "Nobody");
    assert.equal(mayAskWords(["PM", "Designer", "Skeptic"]), "PM, Designer, Skeptic");
    assert.equal(mayAskWords(["PM", "Designer", "Skeptic", "Engineer"]), "PM, Designer and 2 more");
    assert.deepEqual(askAfter(["pm"], "skeptic", true), ["pm", "skeptic"]);
    assert.deepEqual(askAfter(["pm", "skeptic"], "pm", true), ["skeptic", "pm"], "ticked again it is once, at the end");
    assert.deepEqual(askAfter(["pm", "skeptic"], "pm", false), ["skeptic"]);
  });

  // (fails before: yes — a chat's change of the list read "ask: ["pm","skeptic"]" on its row in the conversation)
  test("a chat's change of the list is said in the conversation in the row's own words", () => {
    assert.equal(settingChangeWords("subagents.ask", ["pm", "skeptic"]), "Your agent may use: @pm, @skeptic");
    assert.equal(settingChangeWords("subagents.ask", []), "Your agent may use: nobody");
    assert.equal(settingChangeWords("subagents.ask"), "Your agent may use: as in Library");
  });

  test("the page's list holds the ticks beside the cards, and reads both again when an agent or a tick changes", async () => {
    let ask = ["pm"];
    /** @type {((msg: any) => void)[]} */
    const heard = [];
    let reads = 0;
    const list = createAgentCardList({ call: async () => { reads++; return { shipped: store.list(), saved: [], ask, always: OWN_WORKERS }; }, bus: (fn) => heard.push(fn) });
    assert.deepEqual(list.asks(), []);
    let moved = 0;
    list.onChange(() => { moved++; });
    await list.load();
    // (fails before: yes — OA-D4: the six teams' own Leads were offered as any agent)
    assert.deepEqual([list.asks(), list.all().length, moved], [["pm"], 8, 1]);
    assert.deepEqual([list.all().some((c) => c.tag === "buildlead"), list.find("buildlead")?.partOf], [false, "builders"], "a team's own Lead is in no list, and found by its tag");
    // (fails before: yes — the list did not say which two the main agent always has, so every menu offered a tick for them)
    assert.deepEqual(list.all().filter((c) => c.always).map((c) => c.tag), ["builder", "reviewer"]);
    ask = ["pm", "skeptic"];
    heard[0]({ type: "agents-changed", tag: "" });
    await settle();
    assert.deepEqual([list.asks(), reads, moved], [["pm", "skeptic"], 2, 2]);
  });

});

describe("the row “The main agent may ask”", () => {
  /** The row on the fake DOM, with the menu it opens and what it writes. @param {any} [o] */
  const row = (o = {}) => {
    /** @type {any[]} */
    const calls = [];
    /** @type {any[][]} */
    const menus = [];
    const el = /** @type {any} */ (mayAskRow(/** @type {any} */ (fakeH), {
      tags: ["pm"], sub: MAY_ASK_SUB, own: false, cards: cards(), defaults: ["pm"],
      onChange: (tags) => calls.push(["set", tags]), onDefault: () => calls.push(["default"]), ...o,
    }, (items, at) => { menus.push(items); calls.push(["menu", at.side, at.align]); }));
    return { el, calls, menus, open: () => { el.dispatch("click"); return menus.at(-1) || []; } };
  };
  const value = (/** @type {any} */ el) => textOf(el.querySelector(".may-ask-names"));
  const sub = (/** @type {any} */ el) => textOf(el.querySelector(".inst-row-sub"));

  // (fails before: yes — AG-44: the row did not exist)
  test("its value is the names in a few words; under its label what it is, or where the list comes from", () => {
    const r = row();
    assert.equal(textOf(r.el.querySelector(".inst-row-label")), "Your agent may use");
    assert.deepEqual([value(r.el), sub(r.el)], ["PM", "as in Library"]);
    assert.equal(r.el.attrs["aria-haspopup"], "menu");
    assert.equal(value(row({ tags: [] }).el), "Nobody");
    const many = row({ tags: ["pm", "designer", "enduser", "skeptic"], sub: "this chat's own", own: true });
    assert.deepEqual([value(many.el), sub(many.el), many.el.attrs.title], ["PM, Designer and 2 more", "this chat's own", "PM, Designer, End user, Skeptic"]);
  });

  // (fails before: yes — the Designer's review of 10-24: Bug Hunter ticked "Your agent may use it" in the Library, and
  // the chat's row said "Nobody": it counted agents alone)
  test("the teams it may start beside it are said after the agents, and its menu leads to where they are ticked", () => {
    const teams = row({ tags: [], teams: ["Bug Hunter", "Verifier"], onTeams: () => {} });
    assert.equal(value(teams.el), "Bug Hunter team, Verifier team");
    assert.equal(value(row({ tags: ["pm"], teams: ["Bug Hunter"] }).el), "PM, Bug Hunter team");
    let went = 0;
    const items = row({ tags: [], teams: ["Bug Hunter"], onTeams: () => went++ }).open();
    const at = items.findIndex((/** @type {any} */ it) => it.label === "Teams it may send on the side");
    assert.deepEqual([items[at].type, items[at + 1].label, items[at + 1].desc], ["label", "Bug Hunter", "Ticked on their cards in Library › Agents and teams"]);
    items[at + 1].onClick();
    assert.equal(went, 1);
    assert.equal(value(row({ tags: [] }).el), "Nobody", "no team, no agent");
  });

  // (fails before: yes — AG-53: a list could name a deleted agent and nothing on the page said so)
  test("a tag whose card was deleted is said under the label, struck through in the menu, and can be taken off", () => {
    const r = row({ tags: ["pm", "pm-2"], own: true });
    assert.deepEqual([value(r.el), sub(r.el)], ["PM", "as in Library · @pm-2 was deleted"]);
    const items = r.open();
    const gone = items.find((/** @type {any} */ it) => typeof it.label !== "string" && it.type === "check");
    assert.deepEqual([textOf(gone.label), gone.label.kids[0].tag, gone.checked, gone.desc], ["@pm-2| deleted", "s", true, "Its card is gone, so nobody is asked under this tag: untick to take it off the list"]);
    assert.equal(items.indexOf(gone), items.length - 3, "after every card, before the way back to the default");
    gone.onClick();
    assert.deepEqual(r.calls.at(-1), ["set", ["pm"]]);
    assert.equal(sub(row({ tags: ["a-1", "b-2"] }).el), "as in Library · @a-1, @b-2 were deleted");
  });

  test("its menu: a tick per card with what the card is good for; a tick writes the chat's own list, whole; the way back to the default names your ticks", () => {
    const r = row({ tags: ["pm"], defaults: ["pm", "skeptic"] });
    const items = r.open();
    assert.deepEqual(r.calls[0], ["menu", "bottom", "end"]);
    // (fails before: yes — step 4: the menu knew leads alone; a worker the main agent may call had no tick anywhere in a
    // chat; OA1: two headings, advisors and doers, and the six teams' own Leads among the advisors; the design pass of
    // 10-24 grouped them as the Library did, which the owner's word of 10-24: "I liked the previous design better where everything was just an Agent and Teams just     // referenced those agents": one heading, one list)
    // ("Teams, improved and kept" of 11-03: the shipped ones Product and End user, then the person's own by name)
    assert.deepEqual(items.slice(0, 7).map((it) => [it.type, it.label ?? null, it.checked ?? null]), [
      ["label", "Your agents — Builder and Reviewer always", null],
      ["check", "Product", false], ["check", "End user", false],
      ["check", "Designer", false], ["check", "Engineer", false], ["check", "PM", true], ["check", "Skeptic", false],
    ], "Builder and Reviewer carry no tick: the main agent has them in every chat");
    assert.equal(items[7].type, "separator", "the agents, then the way back to the default");
    assert.equal(items[1].desc, store.find("product")?.goodFor);
    assert.equal(items[5].desc, store.find("pm")?.goodFor);
    items[6].onClick();
    items[5].onClick();
    // A copy of Reviewer says whose place it takes where it is ticked; any other worker of yours says what it is good for.
    const fast = { ...cards().find((c) => c.tag === "reviewer"), tag: "reviewer-fast", name: "Reviewer, fast", shipped: false, always: false, from: "reviewer" };
    const german = { ...fast, tag: "translator", name: "Translator", goodFor: "Puts strings into German", from: null };
    const mine = row({ cards: [...cards(), fast, german] }).open().filter((/** @type {any} */ it) => it.type === "check").slice(-2);
    assert.deepEqual(mine.map((/** @type {any} */ it) => [it.label, it.desc]), [["Reviewer, fast", `${store.find("reviewer")?.goodFor} · takes Reviewer's place`], ["Translator", "Puts strings into German"]]);
    // With only the two it always has there is nothing to tick: no heading.
    assert.deepEqual(row({ tags: [], cards: cards().filter((c) => c.always) }).open().map((/** @type {any} */ it) => it.type), ["separator", undefined]);
    assert.deepEqual(r.calls.slice(1), [["set", ["pm", "skeptic"]], ["set", []]], "nobody is a list too");
    const back = items.at(-1);
    assert.deepEqual([items.at(-2).type, back.label, back.desc, back.disabled], ["separator", "Use the default", "As in Library: PM, Skeptic", true], "nothing to go back from while the list is the default's");
    const own = row({ tags: [], own: true, defaults: [] }).open().at(-1);
    assert.deepEqual([own.disabled, own.desc], [false, "As in Library: nobody"]);
  });

  // (fails before: yes — case 31: with the agent tool off the list read as if it applied)
  test("while nobody can be asked the row says why, in the sub-line's place", () => {
    const r = row({ off: "Nobody is asked while the agent tool is off in Tools" });
    assert.equal(sub(r.el), "Nobody is asked while the agent tool is off in Tools");
    assert.ok(String(r.el.attrs.class).includes("is-warned"));
    assert.equal(value(r.el), "PM", "the list is kept for when it applies");
  });
});

describe("the Start board's row", () => {
  /** A draft-start answer for Filament's own loop. @param {any} [o] */
  const answer = (o = {}) => ({
    cwd: "H:/proj", projectId: null, preset: null, presetWhy: null,
    flat: { "loop.tools": null, "subagents.ask": ["pm"] },
    sources: {},
    engine: { kind: "loop", model: "brain-model" },
    window: { tokens: 200000, source: "price card" }, line: { percent: 85, tokens: 170000 },
    parts: [{ id: "prompt", tokens: 3000 }, { id: "tools", tokens: 5000 }],
    instructions: { files: [], missing: [], sessionChars: 0 },
    skills: { enabled: false, folders: [], list: [], triggered: [], problems: [] },
    tools: { offered: ["read", "agent"], off: [], memory: 0, recall: false, mcp: [] },
    memory: { global: false, autopilot: false, on: false, ready: false, briefing: 0, recall: 0, tools: 0, knows: null },
    ...o,
  });
  /** The board on the fake DOM. @param {Record<string, any>} [held] */
  const board = (held = {}) => {
    /** @type {any[]} */
    const calls = [];
    /** @type {any[][]} */
    const menus = [];
    const io = {
      held: () => held,
      set: (/** @type {string} */ path, /** @type {any} */ v) => calls.push(["set", path, v]),
      unset: (/** @type {string} */ path) => calls.push(["unset", path]),
      permission: () => "edit", setPermission: () => {}, models: () => [{ id: "brain-model" }], mainModel: () => "brain-model",
      agents: () => ({ cards: cards(), asks: ["pm"] }),
      teams: () => [{ key: "builders", name: "Builders", models: ["kimi-k2"], leadModels: [] }],
      chat: () => ({}), presets: () => ({}), choosePreset: () => {}, reset: () => {}, saveAs: () => {},
    };
    const pools = poolChips();
    const b = createStartBoard(/** @type {any} */ (io), { h: /** @type {any} */ (fakeH), modelSelect: /** @type {any} */ (() => ({ el: fakeH("span", {}), set() {}, setModels() {} })), poolChip: /** @type {any} */ (pools.make), menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); }) });
    // Every card shows (the design pass of 10-24, UX5), in two stacks.
    const card = () => /** @type {any} */ (b.el).querySelector(".nt-grid").kids.flatMap((/** @type {any} */ s) => s.kids).find((/** @type {any} */ c) => c.attrs["aria-label"] === "subagents");
    return { b, calls, menus, card, pools: pools.made, row: () => card().querySelector(".may-ask") };
  };

  // (fails before: yes — the owner's plan of 11-05: a new chat set its agents' and its teams' models nowhere before its
  // first message)
  test("Who runs on what: folded under its row, each agent and each team's part a chip; an edit is held like every other change, and the way back drops it", () => {
    const p = board();
    p.b.paint(answer());
    const head = p.card().querySelector(".runs-on-head");
    assert.equal(textOf(head), "Who runs on what|As in Library, else this chat's list");
    head.dispatch("click");
    const chips = p.pools.filter((/** @type {any} */ c) => /^What /.test(String(c.io.label)) && c.io.label !== "What this chat's agents run on");
    assert.deepEqual(chips.map((/** @type {any} */ c) => [c.io.label, runsOnSubOf(p.card(), c)]).slice(-2), [["What the Builders team's lead runs on in this chat", "Lead · Main agent"], ["What the Builders team's workers run on in this chat", "Workers · Library"]]);
    chips.at(-1).io.onChange([{ model: "kimi-k2", seats: Infinity, effort: "low" }]);
    assert.deepEqual(p.calls, [["set", "subagents.byTeam", { builders: { workers: [{ model: "kimi-k2", effort: "low" }] } }]]);
    const BY = { builders: { workers: [{ model: "kimi-k2", effort: "low" }] } };
    const held = board({ "subagents.byTeam": BY });
    held.b.paint(answer({ flat: { "loop.tools": null, "subagents.ask": ["pm"], "subagents.byTeam": BY } }));
    assert.equal(textOf(held.card().querySelector(".runs-on-head")), "Who runs on what|1 set in this chat");
    const back = buttonsOf(held.card()).find((/** @type {any} */ x) => x.attrs["aria-label"] === "Put back Who runs on what");
    assert.ok(back, "its dot and ↺ say it is the chat's (UX5)");
    held.card().querySelector(".runs-on-head").dispatch("click");
    held.pools.at(-1).io.onUseDefault();
    assert.deepEqual(held.calls, [["unset", "subagents.byTeam"]]);
  });

  // (fails before: yes — the review of 11-05: the board built a second edit on the draft's last answer, so one made
  // before the answer to the first dropped it)
  test("Who runs on what: a second edit before the draft's answer builds on the first, as the host holds it at once", () => {
    /** @type {Record<string, any>} */
    const held = {};
    const p = board(held);
    p.b.paint(answer());
    p.card().querySelector(".runs-on-head").dispatch("click");
    const [one, two] = p.pools.filter((/** @type {any} */ c) => / runs on in this chat$/.test(String(c.io.label)) && !String(c.io.label).includes("team's"));
    one.io.onChange([{ model: "kimi-k2", seats: Infinity }]);
    // As conversation/empty.js holds it: at once, while the draft's answer is on its way.
    held["subagents.byCard"] = p.calls[0][2];
    two.io.onChange([{ model: "zai/glm-5.3", seats: Infinity }]);
    const [a, b] = cards();
    assert.deepEqual(p.calls.at(-1), ["set", "subagents.byCard", { [a.tag]: [{ model: "kimi-k2" }], [b.tag]: [{ model: "zai/glm-5.3" }] }]);
  });

  // (fails before: yes — the review of 8a278df79: the board read the team in charge from the draft's raw words, so one
  // named by its name ("Builders") still had a lead line, and its crew no Brief's pick)
  test("Who runs on what: the team in charge as the draft's engine says it, by its key whatever the draft calls it", () => {
    const p = board();
    p.b.paint(answer({ flat: { "loop.tools": null, "subagents.ask": ["pm"], "engine.team": "Builders", "engine.teamWorkers": "m-2" }, engine: { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } } }));
    p.card().querySelector(".runs-on-head").dispatch("click");
    const team = p.pools.filter((/** @type {any} */ c) => / team's /.test(String(c.io.label)));
    assert.deepEqual(team.map((/** @type {any} */ c) => [c.io.label, runsOnSubOf(p.card(), c)]), [["What the Builders team's workers run on in this chat", "Workers · The Brief's"]]);
  });

  // (fails before: yes — task 4: a new chat had no place to say whom its agent may ask before the first message)
  test("on the card of the agent's own launches: the list the task would start with; a tick is held like every other change, and the way back drops it", () => {
    const p = board();
    p.b.paint(answer());
    const r = p.row();
    assert.deepEqual([textOf(r.querySelector(".may-ask-names")), textOf(r.querySelector(".inst-row-sub"))], ["PM", "as in Library"]);
    r.dispatch("click");
    const items = p.menus[0];
    items.find((/** @type {any} */ it) => it.label === "Skeptic").onClick();
    assert.deepEqual(p.calls, [["set", "subagents.ask", ["pm", "skeptic"]]]);
    assert.equal(items.at(-1).disabled, true);
    // Held: the row says the change is this task's, and the way back is open.
    const held = board({ "subagents.ask": ["pm", "skeptic"] });
    held.b.paint(answer({ flat: { "loop.tools": null, "subagents.ask": ["pm", "skeptic"] } }));
    // Its dot and ↺ say it is the chat's own (UX5), not "as in Library".
    assert.deepEqual([textOf(held.row().querySelector(".may-ask-names")), held.row().querySelector(".inst-row-sub")], ["PM, Skeptic", null]);
    assert.equal(held.card().querySelector(".nt-own").kids[0], held.row());
    held.row().dispatch("click");
    held.menus[0].at(-1).onClick();
    assert.deepEqual(held.calls, [["unset", "subagents.ask"]]);
  });

  test("with the agent tool off the row says nobody is asked; a team's lead has the row, a model answering as plain chat none", () => {
    const off = board();
    off.b.paint(answer({ tools: { offered: ["read"], off: ["agent"], memory: 0, recall: false, mcp: [] } }));
    assert.equal(textOf(off.row().querySelector(".inst-row-sub")), "Nobody is asked while the agent tool is off in Tools");
    const team = board();
    team.b.paint(answer({ engine: { kind: "team", model: "brain-model", team: { name: "Methodical" } } }));
    assert.ok(team.row(), "a team's lead on Filament's loop asks too");
    const plain = board();
    plain.b.paint(answer({ engine: { kind: "model", model: "brain-model" } }));
    // (fails before: yes — U5 phase 6, D8: the card was hidden; it shows, its rows greyed with why)
    assert.ok(!plain.card().classList.contains("hidden"));
    assert.ok(plain.card().querySelector(".nt-dim").querySelector(".may-ask"), "a model answering as plain chat has no tools to ask with: the row greyed");
    assert.match(textOf(plain.card()), /plain chat has no tools to launch agents with/);
  });

  // (fails before: yes — E12 step 2, AG-66: a coding agent's task had no such row; E15 step 8: the row was "Their
  // model", one model's picker; the owner's of 11-06: the row said a coding agent's launch names its model, where a
  // launch that names none runs on the chat's own)
  test("a coding agent's task has the row too, and \"They run on\" says it as the loop's", () => {
    const their = (/** @type {any} */ p) => {
      /** @type {any[]} */
      const rows = [];
      const walk = (/** @type {any} */ n) => {
        if (!n || typeof n !== "object") return;
        if (String(n.attrs?.class || "").split(/\s+/).includes("inst-row")) rows.push(n);
        for (const k of n.kids || []) walk(k);
      };
      walk(p.card());
      return textOf(rows.find((r) => textOf(r.querySelector(".inst-row-label")) === "They run on").querySelector(".inst-row-sub"));
    };
    const coder = board();
    // The loop's agent switch off, as a preset may leave it: a coding agent never reads it (AG-72).
    coder.b.paint(answer({ engine: { kind: "agent", model: "claude-code" }, tools: { offered: [], off: ["agent"], memory: 0, recall: false, mcp: [] } }));
    assert.equal(coder.card().classList.contains("hidden"), false, "the card of Filament's agents is a coding agent's task's too");
    assert.deepEqual([textOf(coder.row().querySelector(".may-ask-names")), textOf(coder.row().querySelector(".inst-row-sub"))], ["PM", "as in Library"]);
    const tools = /** @type {any} */ (coder.b.el).querySelector(".nt-grid").kids.flatMap((/** @type {any} */ s) => s.kids).find((/** @type {any} */ c) => c.attrs["aria-label"] === "tools");
    assert.ok(tools.querySelector(".nt-dim"), "the loop's tools stay the loop's: greyed, with why (D8)");
    assert.equal(their(coder), "Your chat's model", "a launch that names none runs on the agent's own");
    const POOL = [{ model: "glm-5.3", seats: 2 }, { model: "", seats: 1 }];
    const named = board({ "subagents.pool": POOL });
    named.b.paint(answer({ engine: { kind: "agent", model: "claude-code" }, flat: { "loop.tools": null, "subagents.ask": ["pm"], "subagents.pool": POOL } }));
    assert.equal(their(named), "An agent takes the first model with room, from the top", "its dot and ↺ say it is the chat's (UX5)");
    assert.equal(named.card().querySelector(".nt-own").kids[1].attrs["aria-label"], "Put back They run on");
    // Where it leads a team its workers take the pool's seats, as a loop lead's do; Filament's loop says how many run at once.
    const lead = board();
    lead.b.paint(answer({ engine: { kind: "agent", model: "claude-code", team: { name: "Methodical" } } }));
    // (U13-D15 of 10-20: said as every list says it; the owner's word of 11-05: with no number of the chat's own)
    assert.equal(their(lead), "Your chat's model");
    const loop = board({ "subagents.pool": POOL });
    loop.b.paint(answer({ flat: { "loop.tools": null, "subagents.ask": ["pm"], "subagents.pool": POOL } }));
    assert.equal(their(loop), "An agent takes the first model with room, from the top", "no count: each model's limit holds");
  });
});

// (proposal_ux §4.7: the Agents pane beside the chat gave way to a thread's own tile; its rows stand under the Sub Agents
// tab's list)
describe("the row under the Sub Agents list", () => {
  /** The Sub Agents tab on the fake DOM, with a row of whom may be asked. @param {any} [ask] */
  const tab = (ask = { tags: ["pm"], sub: MAY_ASK_SUB, own: false }) => {
    const state = { ask, calls: /** @type {any[]} */ ([]) };
    const s = sideSeams();
    const io = sideIO({ mayAsk: () => (state.ask ? { cards: cards(), defaults: ["pm"], onChange: (/** @type {string[]} */ tags) => state.calls.push(["set", tags]), onDefault: () => state.calls.push(["default"]), ...state.ask } : null) });
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    view.paint(chat);
    // The row stands in the gear's sheet (the owner's of 11-05).
    /** @type {any} */ (view.el).querySelector("sd-gear").dispatch("click");
    return { view, chat, state, menus: s.menus, foot: s.sheets[0].o.body.querySelector("sd-foot-rows") };
  };
  const names = (/** @type {any} */ el) => {
    const n = el.querySelector("may-ask-names");
    return n ? textOf(n) : null;
  };

  // (fails before: yes — task 2: beside a chat there was no word of whom its agent may ask, and nowhere to change it)
  test("the row stands in the gear's sheet, with no thread yet too; its menu writes this chat's list; a change of the list repaints it in place", () => {
    const t = tab();
    assert.equal(names(t.foot), "PM");
    assert.match(textOf(t.view.el), /Nobody works for this chat yet\./);
    t.foot.querySelector("may-ask").dispatch("click");
    t.menus[0].items.find((/** @type {any} */ it) => it.label === "Skeptic").onClick();
    assert.deepEqual(t.state.calls, [["set", ["pm", "skeptic"]]]);
    const drawn = t.foot.kids;
    t.view.paint(t.chat);
    assert.equal(t.foot.kids, drawn, "nothing moved: the row is not drawn again under an open menu");
    t.state.ask = { tags: ["pm", "skeptic"], sub: "this chat's own", own: true };
    t.view.paint(t.chat);
    assert.deepEqual([names(t.foot), textOf(t.foot.querySelector("inst-row-sub"))], ["PM, Skeptic", "this chat's own"]);
    t.state.ask = { tags: [], sub: "this chat's own", own: true };
    t.view.paint(t.chat);
    assert.equal(names(t.foot), "Nobody");
  });

  test("a chat with no such list shows no row", () => {
    const t = tab(null);
    assert.ok(t.foot.classList.contains("hidden"));
    assert.equal(names(t.foot), null);
  });

  // (fails before: yes — AG-54: the main agent's own asks had a pill like yours, and nothing said who asked)
  test("a thread the main agent asked says so in its head; its conversation has no box to ask again", () => {
    const viewer = source("subagent-viewer.js");
    // (fails before: no — HarnessV4_Tasks E15 step 5, AG-105: the box still leaves, and the thread says why where it stood)
    // (HarnessV4_Tasks decision 10: a team's worker at work takes the box's words at once, so it is asked only of the rest)
    assert.ok(viewer.includes("const no = tells() ? null : noBoxWhy(sa);") && viewer.includes('box.classList.toggle("hidden", !!no);'), "the thread is the main agent's");
    // (HarnessV4_Tasks U12-D8: who started it is the first of its head's facts, a team's worker by its team)
    assert.ok(viewer.includes("startedWords(sa),"), "and its head says who asked");
    assert.deepEqual([{ asked: true, origin: "owner" }, { asked: true, origin: "agent" }, { asked: true, origin: "self" }, { asked: false, origin: "agent" }, { asked: false, origin: "owner" }, { asked: false, origin: "command" }]
      .map((x) => startedWords(/** @type {any} */ ({ team: null, ...x }))), ["asked by you", "asked by the main agent", "started by itself", "launched by the agent", "launched by you", "launched by /subagent"]);
    assert.deepEqual([startedWords(/** @type {any} */ ({ asked: false, origin: "agent", team: { name: "Architect" } })), startedWords(/** @type {any} */ ({ asked: false, origin: "agent", team: { name: "Docs team" } }))],
      ["Architect team's worker", "Docs team's worker"]);
    assert.deepEqual([effortAt("max"), effortAt("xhigh"), effortAt("model"), effortAt(null)], [" at max", " at extra high", "", ""], "its model says the level it thinks at, where one applies");
    // (fails before: yes — every question in a saved agent's thread read "You asked", the main agent's own too)
    assert.deepEqual([0, 1].map((i) => askedWords({ asked: true, origin: "agent" }, i)), ["The main agent asked", "The main agent asked again"]);
    assert.deepEqual([0, 1].map((i) => askedWords({ asked: true, origin: "owner" }, i)), ["You asked", "You asked again"]);
    assert.deepEqual([0, 1].map((i) => askedWords({ origin: "agent" }, i)), ["Task", "Follow-up"], "any other agent was given a task");
    // Its cards carry the machine a mirrored thread's calls ran on (`there`, x22).
    assert.ok(viewer.includes("label: askedWords(sa, i, ex), onward: { main, send: passOn }, toast, pictures: drawn, at: { chain: chainId, agent: id, there: thereCards } });"), "the viewer says it over each question");
  });

  // (fails before: yes — the row read `engine.active`, true only where the session's engine is set: an ordinary chat,
  // whose turns the harness runs on the loop with the engine left alone, read "Nobody is asked")
  test("why nobody is asked in a made chat: its agent tool is off — never an ordinary chat on the loop, which is always on", () => {
    const loop = { active: false };
    assert.equal(mayAskOff({ effective: {}, engine: loop }), "", "the harness runs its turns on the loop");
    assert.equal(mayAskOff({ effective: { loop: { tools: { agent: true } } }, engine: { active: true } }), "");
    assert.equal(mayAskOff({ effective: { loop: { tools: { agent: false } } }, engine: loop }), "Nobody is asked while the agent tool is off in this chat's tools");
    // (fails before: yes — "Nobody is asked: the agent loop is off": the loop has no off switch now, the owner's of 11-09)
    assert.equal(mayAskOff(null), "", "no word of the loop being off: it never is");
  });

  // (fails before: yes — AG-71: a coding agent's chat had no row at all, so nothing said why another client's turns
  // never ask)
  test("a coding agent's chat: never a warning for the turns this page sends; the client's name where another writes them", () => {
    const coder = () => ({ effective: {}, engine: { active: false, coder: "claude" } });
    assert.deepEqual([mayAskOff(coder()), mayAskOff(coder(), null)], ["", ""]);
    assert.equal(mayAskOff(coder(), "OpenCode"), "Nobody is asked while OpenCode writes this chat's turns: Filament's agent tool goes with the turns sent from here");
    assert.equal(mayAskOff({ effective: { loop: { tools: { agent: false } } }, engine: { coder: "claude" } }), "", "the loop's tool switch is the loop's (AG-72)");
    assert.equal(mayAskOff({ effective: {}, engine: { active: false } }, "OpenCode"), "", "a chat on Filament's loop asks whoever sends its turns");
  });

  test("the app reads the row from the open chat: its own list or its project's, else the ticks, and why nobody is asked", () => {
    const app = source("app.js");
    assert.match(app, /if \(!chat\?\.chainId \|\| !st\?\.effective\) return null;/, "a coding agent's chat has the row too");
    assert.match(app, /tags: own \|\| from === "project" \? kept : agentCards\.asks\(\),/, "a tick shows at once in a chat that chose no list");
    assert.match(app, /sub: own \? "this chat's own" : from === "project" \? "this project's own" : MAY_ASK_SUB,/);
    assert.match(app, /off: mayAskOff\(st, chipActions\.outsideClient\?\.\(\) \|\| null\),\s+onChange: \(tags\) => void write\(\{ patch: setPath\("subagents\.ask", tags\) \}\),\s+onDefault: \(\) => void write\(\{ unset: \["subagents\.ask"\] \}\),/);
    assert.match(app, /agentCards\.onChange\(\(\) => \{\s+composer\.meter\(\);\s+views\.side\.paint\(\);\s+if \(!chatOf\(state\.currentId\)\?\.chainId\) transcript\.startChanged\(\);/);
  });
});
