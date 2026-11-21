// @ts-check
// HarnessV3-Views V3, the surfaces on the fake DOM: the Team view (painted in place, a card's question kept while its
// call waits, the head's controls, the teams to hand the session to, the leader's card, a card brought into sight), the
// dock's decisions (a worker's answers, the pause's block by its kind, a worker's line leaving the dock in the Team
// view), the conversation under a team (the divider, the order rows, the footer's tag), the Team widget, and the page's
// wiring, read from its source where the page boots a DOM at import. HarnessV3-TaskGraph G3: the Team view's tasks
// still to come. HarnessV3-ACP AC6-7: a team's lead on a coding agent — the plans its team draws on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTeamView } from "../src/ui/harness/views/team.js";
import { answerControls, createDecisions, dockKeys } from "../src/ui/harness/conversation/decisions.js";
import { engineDivider, orderRowsEl, engineSig, engineTag } from "../src/ui/harness/conversation/team-turns.js";
import { teamWidget, atWorkWords } from "../src/ui/harness/widgets/team.js";
import { inlineMarks } from "../src/ui/harness/widgets/kit.js";
import { alignEvents, lookWords, messageTimeLabel } from "../src/ui/harness/lib/labels.js";
import { cardState, leadAskLine, leadingTeam, switchWait, yourAsk } from "../src/ui/harness/lib/team.js";
import { handSection } from "../src/ui/harness/widgets/hand.js";
import { sideBadge, sideRow } from "../src/ui/harness/lib/side.js";
import { liveLine } from "../src/ui/harness/conversation/agent-card.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamIO, NOW } from "./helpers/team-view.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** Each word under `n`. @param {any} n */
const words = (n) => textOf(n).split("|");
/** A sub-agent's card under `n`. @param {any} n @param {string} id */
const cardOf = (n, id) => all(n, (x) => x.attrs?.["data-id"] === id)[0];
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

/** The members every shipped team has, as the settings answer names them: Reviewer seated as the Scout, Builder, Builder seated as the Tester, Reviewer. */
const FOUR = [
  { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", card: "builder", name: "Tester", may: "edit", place: "builder" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
const TEAMS = [
  { key: "architect", name: "Architect", line: "Boundaries first: modules, interfaces and a contract", shipped: true, lead: { tag: "architect", name: "Architect" }, members: FOUR },
  { key: "methodical", name: "Methodical", line: "One step at a time, each one checked", shipped: true, lead: { tag: "methodical", name: "Methodical" }, members: FOUR },
];
/**
 * A session the Architect team leads — or, with `team: null`, your agent's.
 * @param {{ team?: string | null, turns?: any[], live?: any, flat?: Record<string, any> }} [o]
 */
const chatWith = ({ team = "architect", turns = [], live = null, flat = {} } = {}) => ({
  chainId: "c1",
  turns,
  live,
  view: {
    settings: {
      engine: /** @type {any} */ ({ mode: team ? "team" : "model", team, teams: TEAMS }),
      effective: { engine: /** @type {any} */ ({}) },
      flat,
      usage: { usd: 0.42 },
    },
  },
});
/** A sub-agent's row as the list route answers it: a Builder at work unless told otherwise. @param {Record<string, any>} [o] */
const row = (o = {}) => ({
  id: "w1",
  card: { tag: "builder", name: "Builder", kind: "worker" },
  // A team's worker is its lead's call, as the server launches it (app/agent/team-tools.js).
  origin: "agent",
  asked: false,
  may: "edit",
  status: "running",
  startedAt: NOW - 90_000,
  team: { team: "architect", role: "builder", place: "builder" },
  description: "Build the lexer",
  model: "glm-5.3",
  progress: /** @type {any} */ (null),
  exchanges: /** @type {any[]} */ ([{ description: "Build the lexer", startedAt: NOW - 90_000, endedAt: null }]),
  ...o,
});
/** The Team view on the fake DOM, its timer's calls held. @param {any} io */
const teamView = (io) => {
  /** @type {[() => void, number][]} */
  const due = [];
  const view = createTeamView(io, { h: fakeH, place, drawIn: fakeDrawIn, later: (fn, ms) => { due.push([fn, ms]); } });
  return { view, due };
};

describe("the Team view", () => {
  // (fails before: no — the view itself read nothing; the crews' chip it made did (gone, U13-D14). This pins the
  // view's half: the page makes it before its session state exists)
  test("the view is made before the page's session state is: making it reads nothing of the page", () => {
    const early = () => { throw new Error("read before the page's state was there"); };
    const io = teamIO({ rows: early, own: early, face: early, model: early, models: early, account: early, graph: early, now: early });
    const { view } = teamView(io);
    assert.ok(view.el, "made");
  });

  // (fails before: yes — there was no Team view: a worker's progress showed nowhere but the status capsule's count)
  test("a card is built once for its sub-agent and painted in place: a pulse moves its parts, never the card", () => {
    let rows = [row({ progress: { round: 2, tool: { name: "bash", args: "npm test" }, words: "Running the tests", spent: 0.12, context: { tokens: 50_000, window: 200_000 } } })];
    const io = teamIO({ rows: () => rows });
    const { view } = teamView(io);
    const chat = chatWith();
    view.paint(chat);
    const card = cardOf(view.el, "w1");
    assert.deepEqual([card.classList.contains("is-running"), card.classList.contains("is-worker"), card.attrs["aria-label"]], [true, true, "Builder w1: Build the lexer, running"]);
    const missing = (/** @type {string[]} */ want) => want.filter((w) => !words(card).includes(w));
    assert.deepEqual(missing(["Builder", "Build the lexer", "running", "bash", " npm test", "Running the tests", "25%", "2", "$0.12", "1m 30s"]), []);
    // (fails before: yes — the card's head said the worker's id as a word of its own)
    assert.deepEqual([words(card).includes("w1"), one(card, "ag-role").attrs.title], [false, "Builder w1"], "its id is its seat's tip, not a word of the card");
    rows = [row({ progress: { round: 3, tool: { name: "edit", args: "src/lexer.js" }, spent: 0.2, context: { tokens: 100_000, window: 200_000 } } })];
    view.paint(chat);
    assert.equal(cardOf(view.el, "w1"), card, "the same card, its parts painted again");
    assert.deepEqual([missing(["edit", "50%", "3", "$0.20"]), words(card).includes("bash")], [[], false]);
    /** @type {any} */ (btn(card, "Open")).dispatch("click");
    /** @type {any} */ (btn(card, "Stop")).dispatch("click");
    assert.deepEqual(io.calls, [["open", "w1"], ["stop", "w1"]]);
    rows = [row({ status: "done", exchanges: [{ description: "Build the lexer", startedAt: NOW - 90_000, endedAt: NOW - 30_000, rounds: 4, spentUsd: 0.31, report: "Lexer built; 12 tests pass" }] })];
    view.paint(chat);
    assert.equal(cardOf(view.el, "w1"), card);
    assert.deepEqual([card.classList.contains("is-done"), card.classList.contains("is-running"), missing(["done", "Lexer built; 12 tests pass", "4", "$0.31", "1m"])], [true, false, []]);
    assert.deepEqual([btn(card, "Stop"), !!btn(card, "Open conversation")], [undefined, true], "an ended card: its conversation, no Stop");
  });

  // (fails before: yes — HarnessV4_Tasks decision 10: a working worker's card had no way for your words to reach it)
  test("a working worker's card has Message: its box opens on the card and keeps half-typed words through a pulse; Send and Enter hand them to the host, a refused send keeps them, a sent one closes the box; a sub-agent of your agent's, and a worker that ended, have none", async () => {
    let rows = [row()];
    /** @type {boolean[]} */
    const answers = [false, true];
    const io = teamIO({ rows: () => rows });
    /** @type {any} */ (io).message = async (/** @type {string} */ id, /** @type {string} */ words) => {
      io.calls.push(["message", id, words]);
      return /** @type {boolean} */ (answers.shift());
    };
    const { view } = teamView(io);
    view.paint(chatWith());
    const card = cardOf(view.el, "w1");
    const msg = /** @type {any} */ (btn(card, "Message"));
    assert.ok(msg, "beside its Stop");
    assert.deepEqual([one(card, "ag-tell"), msg.attrs["aria-expanded"]], [undefined, "false"], "closed until asked for");
    assert.match(msg.attrs.title, /^Tell Builder w1 something now, past its lead: it reads it at its next step, and its lead is told what you said$/);
    msg.dispatch("click");
    const box = one(card, "ag-tell");
    const input = one(box, "ag-tell-in");
    assert.deepEqual([!!box, input.focused, msg.attrs["aria-expanded"]], [true, true, "true"]);
    assert.equal(input.attrs.placeholder, "What Builder should hear now. It reads this at its next step, and its lead is told");
    input.value = "  Use the v2 API.  ";
    view.paint(chatWith());
    assert.deepEqual([one(cardOf(view.el, "w1"), "ag-tell"), input.value], [box, "  Use the v2 API.  "], "a pulse keeps the box and the words");
    /** @type {any} */ (btn(box, "Send")).dispatch("click");
    await settle();
    assert.deepEqual(io.calls.filter((c) => c[0] === "message"), [["message", "w1", "Use the v2 API."]]);
    assert.deepEqual([one(card, "ag-tell"), input.value], [box, "  Use the v2 API.  "], "refused: the words stay, and the host said why");
    input.dispatch("keydown", { key: "Enter", shiftKey: false });
    await settle();
    assert.equal(io.calls.filter((c) => c[0] === "message").length, 2, "Enter sends");
    assert.deepEqual([one(card, "ag-tell"), input.value, msg.attrs["aria-expanded"]], [undefined, "", "false"], "sent: the box closes, empty");
    msg.dispatch("click");
    input.dispatch("keydown", { key: "Escape" });
    assert.equal(one(card, "ag-tell"), undefined, "Escape closes it");
    // A sub-agent of your agent's has none, and a worker that ended none.
    rows = [row({ id: "sa_1", team: null, card: { tag: "scout", name: "Scout", kind: "worker" } }), row({ id: "w2", status: "done", exchanges: [{ description: "Build the lexer", startedAt: NOW - 90_000, endedAt: NOW - 30_000, report: "Done" }] })];
    view.paint(chatWith({ team: null }));
    assert.deepEqual([btn(cardOf(view.el, "sa_1"), "Message"), btn(cardOf(view.el, "w2"), "Message")], [undefined, undefined]);
    const css = readFileSync(new URL("../src/ui/harness/views/team.css", import.meta.url), "utf8");
    assert.match(css, /\.ag-msg \{[^}]*margin-left: auto;/, "Message and Stop sit together at the foot's end");
  });

  // (fails before: yes — the bug hunt of 10-30, UIC-5: Message's box sent on the Enter that ends an input method's word
  // where the browser says it by keyCode 229 alone, as Windows' IMEs do — the chat's own box never sends on it)
  test("Message's box: the Enter that ends an input method's word sends nothing; the next Enter sends", async () => {
    const io = teamIO({ rows: () => [row()] });
    /** @type {any} */ (io).message = async (/** @type {string} */ id, /** @type {string} */ words) => {
      io.calls.push(["message", id, words]);
      return true;
    };
    const { view } = teamView(io);
    view.paint(chatWith());
    const card = cardOf(view.el, "w1");
    /** @type {any} */ (btn(card, "Message")).dispatch("click");
    const input = one(one(card, "ag-tell"), "ag-tell-in");
    input.value = "日本語で";
    input.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 });
    await settle();
    assert.deepEqual(io.calls.filter((c) => c[0] === "message"), [], "the word ended; nothing sent");
    input.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 });
    await settle();
    assert.deepEqual(io.calls.filter((c) => c[0] === "message"), [["message", "w1", "日本語で"]]);
  });

  // (fails before: yes — HarnessV4_Tasks decision 10: there was no row for the lead reading your words to a worker; it
  // would have been drawn as that worker's report)
  test("the lead's timeline says where it read what you told one of its workers, a row of its own and no report", () => {
    const { byRound } = alignEvents([
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "subagent-report", round: 1, agentId: "w1", kind: "told", description: "Build the lexer" },
    ]);
    assert.deepEqual(byRound.get(1).reports, [{ agentId: "w1", kind: "told", description: "Build the lexer" }]);
    const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.ok(timeline.includes('if (r.kind === "told") return h("div", { class: "tool-note sub-report" }, `↳ ${lead ? "The lead" : "The main agent"} read here what you told ${who}`, open);'), "the row's words");
  });

  // (fails before: yes — every worker that took a task was a card of its own, a failed task's card offered nothing to
  // do about it, and a failure that repeated looked like a first one)
  test("a failed task's card: its try's number, the failure that repeats, its earlier tries folded under it, and Send back and Start fresh", () => {
    const t6 = { id: "t6", name: "Build the lexer", by: "builder", state: "failed", needs: [], ready: false, stopped: false, agent: "w2", tries: 3, why: "its run failed (zai answered 500: overloaded)", failures: { cause: "run-failed zai answered #: overloaded", times: 2 }, earlier: { agent: "w2", why: "its run failed (zai answered 500: overloaded)" } };
    /** @type {any} */
    let g = { closed: null, held: null, tasks: [t6] };
    const ex = (/** @type {number} */ from, /** @type {Record<string, any>} */ more) => ({ description: "t6: Build the lexer", startedAt: NOW - from, endedAt: NOW - from + 60_000, ...more });
    const rows = [
      row({ id: "w2", status: "failed", task: "t6", startedAt: NOW - 400_000, description: "t6: Build the lexer", exchanges: [ex(400_000, { status: "failed", error: "round 3's model call failed: 500 overloaded" }), ex(200_000, { status: "failed", error: "round 5's model call failed: 500 overloaded" })] }),
      row({ id: "w1", status: "failed", task: "t6", startedAt: NOW - 900_000, description: "t6: Build the lexer", exchanges: [ex(900_000, { status: "failed", error: "it hit its window" })] }),
    ];
    const io = teamIO({ rows: () => rows, graph: () => g });
    const { view } = teamView(io);
    view.paint(chatWith());
    assert.deepEqual(one(view.el, "tv-grid").kids.map((/** @type {any} */ k) => k.attrs["data-id"]), ["w2"], "one card for the task: w1 is a try of it");
    const card = cardOf(view.el, "w2");
    // (fails before: yes — HarnessV4_Tasks U1, one failure card everywhere: the card said why in a red report line and
    // the repeat in a line of its own kind)
    // (fails before: yes — the card's head said the worker's id beside its seat, "Builder|w2|try 3": the id is its tip's)
    assert.deepEqual([textOf(one(card, "ag-role")), one(card, "ag-role").attrs.title, textOf(one(card, "tg-badge")), one(card, "ix-error").attrs.class, textOf(one(card, "ix-error"))], ["Builder|try 3", "Builder w2", "failed", "ix-error is-inset", "its run failed (zai answered 500: overloaded)|t6 failed the same way 2 times in a row"]);
    assert.equal(one(card, "ag-report"), undefined, "no report line beside the failure");
    const fold = one(card, "ag-tries");
    assert.deepEqual([fold.tag, textOf(fold.kids[0])], ["details", "Earlier tries|2"]);
    // (fails before: yes — each try's line began with its worker's id; the line's tip and Open's say whose it was)
    assert.deepEqual(one(fold, "ag-tries-list").kids.map((/** @type {any} */ k) => [k.kids[0].attrs.class, k.attrs.title, textOf(k), buttonsOf(k)[0].attrs.title]), [
      ["tg-dot is-failed", "Worked by w1", "failed after 1m|it hit its window|Open", "Open w1's conversation"],
      ["tg-dot is-failed", "Worked by w2", "failed after 1m|round 3's model call failed: 500 overloaded|Open", "Open w2's conversation"],
    ]);
    buttonsOf(one(fold, "ag-tries-list"))[0].dispatch("click");
    assert.deepEqual(io.calls.filter((c) => c[0] === "open"), [["open", "w1"]], "an earlier try opens its own worker's conversation");
    // The two ways to send it back, the developer's own: Send back is the first choice, Start fresh beside it.
    const acts = one(card, "tg-acts");
    assert.deepEqual(buttonsOf(acts).map((b) => [textOf(b), b.attrs.class]), [["Start fresh", "tg-act"], ["Send back", "tg-act is-primary"]]);
    assert.match(btn(acts, "Send back").attrs.title, /^Its worker goes on with t6 where it stopped, in its own conversation/);
    assert.match(btn(acts, "Start fresh").attrs.title, /^A new worker takes t6 from the folder as it stands/);
    btn(acts, "Send back").dispatch("click");
    btn(acts, "Start fresh").dispatch("click");
    assert.deepEqual(io.calls.filter((c) => c[0] === "sendBack"), [["sendBack", "t6", false], ["sendBack", "t6", true]]);
    // A pulse keeps the fold as the developer left it; sent back, the buttons and the call-out go.
    view.paint(chatWith());
    assert.equal(one(cardOf(view.el, "w2"), "ag-tries"), fold);
    g = { ...g, tasks: [{ ...t6, state: "waiting", why: "", resume: "w2" }] };
    view.paint(chatWith());
    assert.deepEqual([one(cardOf(view.el, "w2"), "tg-acts"), one(cardOf(view.el, "w2"), "ix-error-repeat")], [undefined, undefined]);
    // A task worked once has no fold, and a worker with no task no buttons.
    const lone = teamView(teamIO({ rows: () => [row({ id: "w9", status: "failed", exchanges: [ex(100_000, { status: "failed", error: "it hit its window" })] })] }));
    lone.view.paint(chatWith());
    assert.deepEqual([one(cardOf(lone.view.el, "w9"), "ag-tries"), one(cardOf(lone.view.el, "w9"), "tg-acts"), textOf(one(cardOf(lone.view.el, "w9"), "ag-role"))], [undefined, undefined, "Builder"]);
  });

  // (fails before: yes — a worker in a model call showed nothing on its card but its figures: no word of the call)
  test("a running worker's card says how its model call goes, and the wait it is in; none once a tool runs alone", () => {
    let rows = [row({ progress: { round: 2, call: { round: 2, began: NOW - 360_000, thinking: 39_200, text: 0, lastAt: NOW - 1000 } } })];
    const { view } = teamView(teamIO({ rows: () => rows }));
    view.paint(chatWith());
    assert.equal(textOf(one(cardOf(view.el, "w1"), "ag-call")), "model call 6 min · about 9,800 tokens of thinking so far · last byte 1 s ago");
    rows = [row({ progress: { round: 2, wait: "zai is busy: trying again in 20 s (try 2 of 10)", call: { round: 2, began: NOW - 5000, thinking: 0, text: 0, lastAt: null } } })];
    view.paint(chatWith());
    const waits = one(cardOf(view.el, "w1"), "ag-call");
    assert.equal(textOf(waits), "zai is busy: trying again in 20 s (try 2 of 10)");
    assert.match(String(waits.attrs.class), /\bis-wait\b/);
    rows = [row({ progress: { round: 3, tool: { name: "bash", args: "npm test" }, call: null } })];
    view.paint(chatWith());
    assert.equal(one(cardOf(view.el, "w1"), "ag-call"), undefined, "a tool runs: the call's line is gone");
    assert.ok(one(cardOf(view.el, "w1"), "ag-tool"));
  });

  // (fails before: yes — the V3 drive: the lead's card showed the reply's markdown as typed, backticks and all, where
  // the conversation drew `7 % 3 = 1` as code; a worker's words and report did the same)
  test("a reply's inline marks show as the conversation draws them: the lead's words, a worker's words and report", () => {
    const drawn = (/** @type {any[]} */ list) => list.map((k) => (typeof k === "string" ? k : `${k.tag}:${textOf(k)}`));
    assert.deepEqual(drawn(inlineMarks(fakeH, "the README lists `7 % 3 = 1`, and **both** signs")), ["the README lists ", "code:7 % 3 = 1", ", and ", "b:both", " signs"]);
    assert.deepEqual(drawn(inlineMarks(fakeH, "`mod()` first")), ["code:mod()", " first"], "nothing empty around a mark at an end");
    assert.deepEqual(inlineMarks(fakeH, "a tick ` left open and ** two"), ["a tick ` left open and ** two"], "a mark left open is words");
    let rows = [row({ progress: { round: 2, words: "Reading `calc.js`" } })];
    const { view } = teamView(teamIO({ rows: () => rows }));
    const turn = { n: 1, status: "done", startedAt: NOW - 300_000, endedAt: NOW - 240_000, engine: { kind: "team", team: "architect", name: "Architect" },
      blocks: [{ type: "text", text: "All in: `mod(-7, 3)` is -1." }], aligned: alignEvents([]) };
    view.paint(chatWith({ turns: [turn] }));
    assert.deepEqual(drawn(one(one(view.el, "ld-card"), "ld-words").kids), ["All in: ", "code:mod(-7, 3)", " is -1."]);
    assert.deepEqual(drawn(one(cardOf(view.el, "w1"), "ag-words").kids), ["Reading ", "code:calc.js"]);
    rows = [row({ status: "done", exchanges: [{ description: "Build the lexer", startedAt: NOW - 90_000, endedAt: NOW - 30_000, report: "**Built:** `lex()` passes" }] })];
    view.paint(chatWith({ turns: [turn] }));
    assert.deepEqual(drawn(one(cardOf(view.el, "w1"), "ag-report").kids), ["b:Built:", " ", "code:lex()", " passes"]);
  });

  // (fails before: yes — the V3 drive: a worker's question showed Filament's backticks as typed in its card)
  test("a worker's question shows its inline marks in its card", () => {
    const rows = [row({ progress: { round: 1, asking: { tool: "bash", args: "node --version", question: "May I run `node --version`?" } } })];
    const { view } = teamView(teamIO({ rows: () => rows }));
    view.paint(chatWith());
    const drawn = one(cardOf(view.el, "w1"), "ag-ask-sub").kids.map((/** @type {any} */ k) => (typeof k === "string" ? k : `${k.tag}:${textOf(k)}`));
    assert.deepEqual(drawn, ["May I run ", "code:node --version", "?"]);
  });

  // (fails before: yes — the review of the s-asks hunt's fix: a question a sub-agent's chat on another machine asks drew
  // Allow and Deny on its card, Deny's no went there as its answer, and its words stood twice)
  test("a question another machine's chat asks: the card draws its choices and its words once; a choice answers by its number", async () => {
    const asking = { kind: "question", tool: "ask", args: "", question: "On Workstation, it asks: Which colour?", options: ["red", "blue"], machine: "Workstation", n: 2 };
    const rows = [row({ progress: { round: 1, asking } })];
    const io = teamIO({ rows: () => rows });
    const { view } = teamView(io);
    view.paint(chatWith());
    const ask = one(cardOf(view.el, "w1"), "ag-ask");
    assert.deepEqual(buttonsOf(ask).map((b) => textOf(b)), ["red", "blue", "Other…"]);
    assert.equal(textOf(ask).split("Which colour?").length, 2, "its words once");
    assert.equal(one(ask, "ag-ask-sub"), undefined);
    /** @type {any} */ (btn(ask, "blue")).dispatch("click");
    await settle();
    assert.deepEqual(io.calls, [["answer", "w1", { allow: false, words: "blue", choice: "2", ask: 2 }]]);
  });

  // (fails before: yes — HarnessV3-Views V6-9, the live run: a worker's card showed its command cut at 160 characters —
  // mostly its cd into its own worktree — and then the question, the same cut again)
  test("a worker's card shows the command it asks to run whole, wrapped, then the reason — once", () => {
    const tests = "test/a-rather-long-name.test.js ".repeat(6).trim();
    const command = `cd "C:\\w\\.git\\filament-worktrees\\w1" && node --test ${tests}`;
    const reason = "Filament cannot tell that it only reads inside the working folder: `node` is not one of the programs known to only read.";
    const asking = { tool: "bash", args: `${command.slice(0, 159)}…`, question: `May I run this command? \`${command.slice(0, 159)}…\` — ${reason.slice(0, -1)}. Answer /allow to run it, or say what to do instead.`, command, runs: `node --test ${tests}`, reason };
    const rows = [row({ progress: { round: 1, asking } })];
    const { view } = teamView(teamIO({ rows: () => rows }));
    view.paint(chatWith());
    const ask = one(cardOf(view.el, "w1"), "ag-ask");
    const drawn = one(ask, "ag-ask-sub").kids.map((/** @type {any} */ k) => (typeof k === "string" ? k : `${k.tag}:${textOf(k)}`));
    assert.deepEqual([textOf(one(ask, "ag-ask-q")), textOf(one(ask, "ag-ask-cmd"))], ["Wants to run", command]);
    assert.deepEqual(drawn, ["Filament cannot tell that it only reads inside the working folder: ", "code:node", " is not one of the programs known to only read."]);
    assert.ok(!textOf(ask).includes("May I run"), "the question's words are the card's to leave out");
  });

  // (fails before: yes — no Team view: a worker's question could be answered nowhere in the page)
  test("a card's question stays while the same call waits: a half-typed why survives a pulse; another call asks anew", async () => {
    const asking = { tool: "bash", args: "rm -rf dist", question: "Run rm -rf dist?" };
    let rows = [row({ progress: { round: 2, asking } })];
    const io = teamIO({ rows: () => rows });
    const { view } = teamView(io);
    const chat = chatWith();
    view.paint(chat);
    const card = cardOf(view.el, "w1");
    const ask = one(card, "ag-ask");
    assert.deepEqual([card.classList.contains("is-asking"), ask.attrs["aria-label"], textOf(one(ask, "ag-ask-q")), textOf(one(ask, "ag-ask-sub"))],
      [true, "Builder w1 asks you", "Wants to run|rm -rf dist", "Run rm -rf dist?"]);
    /** @type {any} */ (btn(ask, "Deny")).dispatch("click");
    const why = one(ask, "ask-why");
    assert.equal(why.focused, true);
    why.value = "keep dist";
    rows = [row({ progress: { round: 2, asking: { ...asking }, words: "Waiting" } })];
    view.paint(chat);
    assert.equal(one(cardOf(view.el, "w1"), "ag-ask"), ask, "the same call: the same question, its why as typed");
    assert.equal(one(ask, "ask-why"), why);
    why.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(io.calls, [["answer", "w1", { allow: false, words: "keep dist" }]]);
    rows = [row({ progress: { round: 3, asking: { tool: "bash", args: "rm -rf build", question: "Run rm -rf build?" } } })];
    view.paint(chat);
    assert.notEqual(one(cardOf(view.el, "w1"), "ag-ask"), ask, "another call asks anew");
  });

  // (fails before: yes — no Team view: the workers' model was the settings page's row alone)
  test("the head: who runs the team; the crew has no list of its own there", () => {
    const io = teamIO();
    const { view } = teamView(io);
    const chat = chatWith();
    view.paint(chat);
    const head = one(view.el, "tv-head");
    assert.deepEqual([textOf(one(head, "tv-title")), textOf(one(head, "tv-sub"))], ["Architect|In charge of this chat", "Run by Architect, with Scout, Builder, Tester, Reviewer. Boundaries first: modules, interfaces and a contract."]);
    // (fails before: yes — E15 step 8: the control was one model's chip, written as subagents.model; HarnessV4_Tasks
    // E23-D6: the pool's, "Members run on"; U13: "The crews' list", written as subagents.workers. U13-D14 of 10-20: a
    // team's crew runs on the chat's list, set on its Agents tab — the head holds no list)
    assert.deepEqual(all(head, (x) => String(x.attrs?.class || "") === "tv-ctl-label").map(textOf).filter((s) => /list/.test(s)), [], "no list in the head");
    assert.deepEqual(io.calls, [], "nothing written");
  });

  // (fails before: yes — the lead's reading along was two settings keys, with no control on the page:
  // HarnessV3-TaskGraph-v2 §12.12, U7)
  test("the head: Reads along switches the lead's looks on and off, and Looks sets their pace while it is on; your agent alone has neither", () => {
    const io = teamIO();
    const { view } = teamView(io);
    const chat = chatWith();
    view.paint(chat);
    const seg = (/** @type {string} */ label) => all(view.el, (x) => x.attrs?.["aria-label"] === label)[0];
    const reads = seg("The lead reads along with its workers");
    const pace = seg("The pace of the lead's looks");
    assert.ok(reads && pace, "on by default, with its pace");
    // (fails before: yes — the two controls stood in the head, above the lead's card, their labels alone saying what
    // they are for)
    const frame = one(view.el, "tv-charge");
    assert.deepEqual(frame.kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["tv-head", "ag-card", "tv-follow", "tv-back"], "the lead's card first, then how it follows its workers");
    const follow = one(frame, "tv-follow");
    assert.deepEqual([follow.attrs.role, follow.attrs["aria-label"], follow.kids.map((/** @type {any} */ k) => k.attrs.class)], ["group", "How the lead follows its workers", ["tv-follow-head", "tv-follow-row"]]);
    assert.deepEqual([textOf(one(follow, "tv-follow-h")), textOf(one(follow, "tv-follow-note"))],
      ["How the lead follows its workers", "Reads along is whether it sees each worker's steps as it works, or only its report; Looks is how often it looks."]);
    assert.deepEqual(one(follow, "tv-follow-row").kids.map((/** @type {any} */ k) => [k.attrs.class, textOf(one(k, "tv-ctl-label"))]), [["tv-ctl", "Reads along"], ["tv-ctl", "Looks"]], "the two in one row");
    assert.deepEqual([one(one(frame, "tv-head"), "tv-ctl"), one(one(frame, "tv-head"), "inst-seg")], [undefined, undefined], "none of it in the head");
    assert.deepEqual(buttonsOf(reads).map((b) => b.attrs.title), [
      "While its workers run, Filament shows the lead a look at each one — its plan, every round since the last look — and it corrects one that heads wrong with a message",
      "The lead reads a line of status for each worker when its wait returns, then their reports",
    ], "each choice's effect is its tip");
    assert.deepEqual(buttonsOf(pace).map((b) => b.attrs.title), [
      "A look whenever something is new",
      "A look at most every 30 s while something is new, unless a sign makes one due at once",
      "A look at most every 1 min while something is new, unless a sign makes one due at once",
      "A look at most every 5 min while something is new, unless a sign makes one due at once — the default",
      "A look at most every 10 min while something is new, unless a sign makes one due at once",
    ]);
    // (fails before: yes — TG2-D48: the paces were any move, 15, 30 and 60 s, and 30 s the default)
    assert.deepEqual(buttonsOf(pace).map(textOf), ["Any move", "30 s", "1 min", "5 min", "10 min"]);
    /** @type {any} */ (btn(reads, "On")).dispatch("click");
    /** @type {any} */ (btn(pace, "5 min")).dispatch("click");
    /** @type {any} */ (btn(reads, "Off")).dispatch("click");
    /** @type {any} */ (btn(pace, "Any move")).dispatch("click");
    assert.deepEqual(io.calls, [["write", { patch: { engine: { supervise: false } } }], ["write", { patch: { engine: { lookSeconds: 0 } } }]], "what is in force is no write");
    /** @type {any} */ (chat.view.settings.effective.engine).supervise = false;
    view.paint(chat);
    assert.equal(seg("The pace of the lead's looks"), undefined, "off: no pace");
    assert.ok(seg("The lead reads along with its workers"));
    assert.deepEqual(one(one(view.el, "tv-follow"), "tv-follow-row").kids.map((/** @type {any} */ k) => textOf(one(k, "tv-ctl-label"))), ["Reads along"]);
    view.paint(chatWith({ team: null }));
    assert.deepEqual([seg("The lead reads along with its workers"), one(view.el, "tv-follow")], [undefined, undefined], "your agent alone: no lead to read along");
  });

  // (fails before: yes — a worker's signs and its lead's messages were on its progress, and nowhere on the page: U7)
  test("a running worker's card says what its lead's next look will name and how many of the lead's messages it read; none where its lead does not read along", () => {
    let rows = [row({ progress: { round: 3, signs: [{ kind: "plan", round: 1, words: "said how it will go about its task" }, { kind: "change", round: 3, words: "made its first change (src/lexer.js)" }], lead: { read: 1, unread: 1 } } })];
    const { view } = teamView(teamIO({ rows: () => rows }));
    view.paint(chatWith());
    assert.equal(textOf(one(cardOf(view.el, "w1"), "ag-along")), "For the lead's next look: said how it will go about its task; made its first change (src/lexer.js) · Read 1 of the lead's 2 messages; 1 waits for its next step");
    rows = [row({ progress: { round: 4, signs: [], lead: { read: 1, unread: 0 } } })];
    view.paint(chatWith());
    assert.equal(textOf(one(cardOf(view.el, "w1"), "ag-along")), "Read the lead's message");
    rows = [row({ progress: { round: 4, signs: [], lead: { read: 0, unread: 2 } } })];
    view.paint(chatWith());
    assert.equal(textOf(one(cardOf(view.el, "w1"), "ag-along")), "The lead's 2 messages wait for its next step");
    rows = [row({ progress: { round: 4, tool: { name: "bash", args: "npm test" } } })];
    view.paint(chatWith());
    assert.equal(one(cardOf(view.el, "w1"), "ag-along"), undefined);
  });

  // (fails before: no — a guard the mutation pass asked for: whose message, and the lead's answers, as the timeline
  // reads them)
  test("a lead's timeline holds each look it was shown — whom, their rounds and signs, its size — and a worker's card the lead's answers; a worker's run says whose each message is", () => {
    const tl = alignEvents([
      { type: "round-start", round: 2 },
      { type: "tool-start", round: 2, id: "toolu_1", name: "agent", args: "" },
      { type: "subagent-start", round: 2, parent: "toolu_1", agentId: "sa_1", description: "Build it", role: "builder" },
      { type: "look", round: 2, workers: [{ id: "sa_1", run: "r1", fromEvent: 3, toEvent: 9, fromRound: 1, toRound: 3, signs: ["plan", "change"] }], tokens: 1234 },
      { type: "subagent-ask", round: 2, parent: "toolu_1", agentId: "sa_1", tool: "bash", args: "rm -rf build" },
      { type: "subagent-ask-end", round: 2, parent: "toolu_1", agentId: "sa_1", answered: true, by: "lead", allowed: false, words: "no — keep it" },
    ]);
    const cell = tl.byRound.get(2);
    assert.deepEqual(cell.looks, [{ workers: [{ id: "sa_1", fromRound: 1, toRound: 3, signs: ["plan", "change"] }], tokens: 1234 }]);
    assert.deepEqual(cell.tools.get("toolu_1").sub.answers, [{ by: "lead", allowed: false, words: "no — keep it" }]);
    assert.deepEqual(lookWords(cell.looks[0], { lead: true, roleOf: () => "Builder" }), { head: "The lead looked at its worker", workers: [{ id: "sa_1", text: "Builder sa_1 · rounds 1–3 · its plan · first change" }], size: "≈1,234 tokens" });
    assert.deepEqual(lookWords({ workers: [{ id: "sa_1", fromRound: 0, toRound: 0, signs: [] }, { id: "sa_2", fromRound: 4, toRound: 4, signs: ["asks"] }], tokens: 0 }, { lead: false }), { head: "The agent looked at the 2 agents on its tasks", workers: [{ id: "sa_1", text: "sa_1 · starting" }, { id: "sa_2", text: "sa_2 · round 4 · asks" }], size: "" });
    // (fails before: yes — TG2-D48's two signs had no words of their own: the row read "one-way")
    assert.equal(lookWords({ workers: [{ id: "sa_3", fromRound: 2, toRound: 2, signs: ["one-way", "compacted"] }], tokens: 0 }, { lead: true }).workers[0].text, "sa_3 · round 2 · cannot be undone · compacted");
    const run = alignEvents([
      { type: "steer", id: "s1", kind: "note", text: "Use the script", from: "lead" },
      { type: "steer", id: "s2", kind: "note", text: "refused", from: "filament" },
      { type: "steer", id: "s3", kind: "note", text: "mine", from: "harness" },
    ]);
    assert.deepEqual(["s1", "s2", "s3"].map((id) => run.steers.get(id).from), ["lead", "filament", undefined]);
    // The timeline draws the looks among a round's rows, and a message's sender above its words.
    const src = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.ok(src.includes("kept(\"look\", cell.looks || [], (k) => lookNote(k, lead));") && src.includes("s.from ? h(\"div\", { class: \"steer-from\" }"));
    // A worker's own thread draws each message into its run, whose it is, and whether it was read (seen in a browser:
    // the lead's word stood nowhere there before).
    const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
    assert.ok(viewer.includes(`case "steer": {`) && viewer.includes("(STEER_FROM_WORDS)[String(e.from)] || \"Your message\"") && viewer.includes(`st.textContent = "read at its next step"`));
  });

  // (fails before: yes — no Team view: who answers changed by `/team` alone, whatever the session was doing)
  // (§10 O1: Lead with this team is Put in charge…, which opens the Brief; where a host still hands it a wait, it waits)
  test("who answers changes only while the session is idle: Back to your agent and Put in charge… wait, saying why", () => {
    /** @type {any[]} */
    let rows = [];
    const io = teamIO({ rows: () => rows });
    const { view } = teamView(io);
    const chat = chatWith({ live: { turn: {} } });
    view.paint(chat);
    // The teams to hand it to are Overview's Who runs this chat's (widgets/hand.js, proposal_ux R4), as the page draws them.
    const hand = () => /** @type {any} */ (handSection({ team: leadingTeam(chat.view.settings.engine), teams: chat.view.settings.engine.teams, wait: switchWait(chat, rows), lead: io.lead, newTeam: io.newTeam }, /** @type {any} */ (fakeH)));
    // Back to your agent stands at the foot of the team's gold frame, under its lead (team_v2_plan §10 O4).
    const back = /** @type {any} */ (btn(one(one(view.el, "tv-charge"), "tv-back"), "Back to your agent"));
    const lead = /** @type {any} */ (btn(hand(), "Put in charge…"));
    assert.deepEqual([back.attrs.disabled, back.attrs.title, lead.attrs.disabled, lead.attrs.title],
      ["", "A turn is running: switch once it ends", "", "A turn is running: switch once it ends"]);
    assert.ok(words(one(hand(), "hand-card")).includes("Leading"), "the team that leads says so, with no button");
    back.dispatch("click");
    lead.dispatch("click");
    assert.deepEqual(io.calls, []);
    chat.live = null;
    rows = [row()];
    view.paint(chat);
    assert.equal(back.attrs.title, "Workers are still at work: switch once they finish, or stop them");
    rows = [];
    view.paint(chat);
    assert.deepEqual(["disabled" in back.attrs, back.attrs["aria-disabled"]], [false, "false"]);
    back.dispatch("click");
    /** @type {any} */ (btn(hand(), "Put in charge…")).dispatch("click");
    assert.deepEqual(io.calls, [["back"], ["lead", "methodical"]]);
  });

  // (fails before: yes — step 6: the Team view named no lead and no member: a team was its name and four glyphs)
  test("who runs it: the head's line and Workers; a team of yours by its lead; each team to hand to by who leads whom, its members' glyphs, and New team", () => {
    const io = teamIO();
    const { view } = teamView(io);
    const docs = {
      key: "docs", name: "Docs", line: "Plain words first", shipped: false, lead: { tag: "product", name: "Product" },
      members: [FOUR[1], { tag: "translator", name: "Translator", may: "copy", place: null }, { tag: "proofreader", name: "Proofreader", may: "read", place: "reviewer" }],
    };
    const chat = chatWith({ team: "docs" });
    chat.view.settings.engine.teams = [...TEAMS, docs];
    view.paint(chat);
    const head = one(view.el, "tv-head");
    assert.deepEqual([textOf(one(head, "tv-title")), textOf(one(head, "tv-sub"))], ["Docs|In charge of this chat", "Run by Product, with Builder, Translator, Proofreader. Plain words first."]);
    assert.equal(textOf(one(one(view.el, "ld-card"), "ag-role")), "Product · Docs lead", "a team that does not bear its lead's name says both");
    const handOf = (/** @type {any} */ c) => /** @type {any} */ (handSection({ team: leadingTeam(c.view.settings.engine), teams: c.view.settings.engine.teams, wait: null, lead: io.lead, newTeam: io.newTeam }, /** @type {any} */ (fakeH)));
    const hand = handOf(chat);
    const cards = all(hand, (x) => x.tag === "section" && String(x.attrs?.class || "").split(/\s+/).includes("hand-card"));
    assert.deepEqual(cards.map((c) => [c.attrs["aria-label"], textOf(one(c, "hand-card-who")), all(c, (x) => x.attrs?.class === "hand-role").map((x) => [x.attrs.title, x.attrs.html])]), [
      // Each seat wears its card's glyph: the Scout Reviewer's eye, the Tester Builder's hammer.
      ["Architect team", "Architect leads Scout, Builder, Tester, Reviewer", [["Scout", ICONS.eye], ["Builder", ICONS.hammer], ["Tester", ICONS.hammer], ["Reviewer", ICONS.eye]]],
      ["Methodical team", "Methodical leads Scout, Builder, Tester, Reviewer", [["Scout", ICONS.eye], ["Builder", ICONS.hammer], ["Tester", ICONS.hammer], ["Reviewer", ICONS.eye]]],
      ["Docs team", "Product leads Builder, Translator, Proofreader", [["Builder", ICONS.hammer], ["Translator", ICONS.hammer], ["Proofreader", ICONS.eye]]],
    ]);
    assert.ok(words(cards[2]).includes("Leading"));
    const fresh = /** @type {any} */ (buttonsOf(hand).find((b) => String(b.attrs.class).includes("hand-new")));
    assert.deepEqual([textOf(fresh), fresh.attrs.title], ["New team|A lead of your own in charge, and the workers it hands work to.", "Make a team of your own in Library › Agents and teams"]);
    fresh.dispatch("click");
    assert.deepEqual(io.calls, [["newTeam"]]);
    // No team: what handing over means, in the members' words.
    assert.match(textOf(handOf(chatWith({ team: null }))), /Hand it to a team\|A lead plans the work and gives it out to its workers; one that changes files works in its own worktree\. Its orders go out at once\./);
  });

  // (fails before: yes — no Team view)
  // (M4: "Your agent"'s card is gone, the status capsule and Overview say what it does. team_v2_plan TV2-D1: the tab is
  // in every chat, and with no team leading it ends on the teams to hand the chat to — before, a link to Overview's sheet)
  // (§10 O1: with no team leading, the tab is the Teams home where the host gives one — the next test; the head stays
  // where it gives none)
  test("no team leads: no controls, no Back, no list and no leader's card; a team with no work yet says so", () => {
    const io = teamIO();
    const { view } = teamView(io);
    const plain = chatWith({ team: null });
    view.paint(plain);
    const head = one(view.el, "tv-head");
    assert.equal(textOf(one(head, "tv-title")), "No team leads this chat");
    assert.match(textOf(one(head, "tv-sub")), /^.+ works on it, and the task graph's tasks run on workers of their own\.$/);
    // (fails before: yes — E23-D6: the head's chip was the agents on the side's, which the Side tab's head now holds;
    // U13-D14: then the crews' list's, gone with it)
    assert.deepEqual([one(head, "inst-seg"), btn(head, "Back to your agent"), one(head, "tv-ctl-label")], [undefined, undefined, undefined]);
    assert.deepEqual([one(view.el, "tv-empty"), one(view.el, "ld-card"), one(view.el, "hand")], [undefined, undefined, undefined]);
    // (fails before: yes — the owner's of 11-06: a coding agent's head said its sub-agents ran on a model it names or on
    // the seats' named models, where they run as the loop's do, the nameless row its own model)
    const coder = chatWith({ team: null });
    coder.view.settings.engine.coder = "claude";
    coder.view.settings.flat = { "subagents.pool": [{ model: "kimi-k2", seats: 2 }, { model: "", seats: 1 }, { model: "zai/glm-5.3", seats: 1 }] };
    view.paint(coder);
    assert.match(textOf(one(head, "tv-sub")), /^.+ works on it, and the task graph's tasks run on workers of their own\.$/, "said as the loop's");
    view.paint(chatWith());
    assert.equal(textOf(one(view.el, "tv-empty")), "The lead has given out no work yet: its workers show here as it does.");
  });

  // (fails before: yes — team_v2_plan §10 O1: with no team leading, the tab ended on Hand it to a team, whose cards and
  // two buttons no one new could run a team from)
  test("no team leads, a home given: the Teams home opens the tab and its squads close it, with no head; Brief… opens the Brief on the team's usual way; a pulse that changes nothing keeps it; a team leading has its own view", () => {
    /** @type {any[]} */
    const asked = [];
    const hunter = { key: "bug-hunter", name: "Bug Hunter", line: "Many hunters at once", shipped: true, most: 10, lead: { tag: "bug-hunter", name: "Bug Hunter" }, members: [{ tag: "hunter", name: "Hunter", may: "read", place: null }] };
    const home = {
      teams: () => [hunter, ...TEAMS],
      model: () => "glm-5.3",
      seats: () => ["kimi-k2"],
      brief:(/** @type {any} */ fill) => { asked.push(["brief", fill]); },
      newTeam: () => { asked.push(["newTeam"]); },
      library: () => { asked.push(["library"]); },
    };
    const io = teamIO({ home });
    const { view } = teamView(io);
    const plain = chatWith({ team: null });
    view.paint(plain);
    assert.equal(one(view.el, "tv-head"), undefined, "the home says who answers: no head");
    assert.deepEqual([view.el.kids[0].attrs.class, view.el.kids.at(-1).attrs.class], ["th-top", "th-roster-wrap"]);
    // (fails before: yes — the rework of 11-11: the two ways stood open over the teams on a first visit) The teams
    // first, the two ways under one fold after them, closed until it is pressed.
    const ways = () => all(view.el, (x) => x.tag === "section" && String(x.attrs?.class).startsWith("th-way ")).map((x) => x.attrs.class);
    assert.deepEqual([ways(), one(view.el, "th-how").attrs["aria-expanded"]], [[], "false"]);
    /** @type {any} */ (one(view.el, "th-how")).dispatch("click");
    assert.deepEqual([ways(), one(view.el, "th-how").attrs["aria-expanded"]], [["th-way is-side", "th-way is-charge"], "true"]);
    /** @type {any} */ (one(view.el, "th-how")).dispatch("click");
    assert.deepEqual(ways(), []);
    const squads = all(view.el, (x) => x.attrs?.["data-team"]);
    assert.deepEqual(squads.map((x) => x.attrs["data-team"]), ["bug-hunter", "architect", "methodical"], "they look and check, then they build");
    const top = view.el.kids[0];
    const drawn = [...top.kids];
    view.paint(plain);
    assert.deepEqual(top.kids, drawn, "a pulse that changes nothing keeps the home");
    /** @type {any} */ (btn(squads[0], "Brief…")).dispatch("click");
    /** @type {any} */ (btn(squads[1], "Brief…")).dispatch("click");
    assert.deepEqual(asked, [["brief", { team: "bug-hunter", way: "side" }], ["brief", { team: "architect", way: "charge" }]], "one press opens the Brief: nothing starts");
    assert.deepEqual(io.calls, []);
    view.paint(chatWith());
    assert.deepEqual([one(view.el, "th-top"), textOf(one(one(one(view.el, "tv-charge"), "tv-head"), "tv-title"))], [undefined, "Architect|In charge of this chat"], "a team leads: its own view, in its gold frame");
  });

  // (fails before: yes — no Team view: the lead's state lived in its turn's fold alone; V3's a11y pass: the orders were
  // a list of buttons re-roled as list items, so a screen reader heard no buttons)
  test("the leader's card: what it does now, its newest words, this turn's orders bringing their cards, its window and figures", () => {
    const rows = [row()];
    const io = teamIO({ rows: () => rows, face: () => ({ fill: 0.4, color: "var(--color-sys-blue)", text: "40%" }) });
    const { view, due } = teamView(io);
    const aligned = alignEvents([
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, name: "agent", args: "Lexer", id: "u1" },
      { type: "subagent-start", round: 1, parent: "u1", agentId: "w1", description: "Build the lexer", team: "architect", role: "builder" },
    ]);
    const turn = { n: 1, status: "done", startedAt: NOW - 300_000, endedAt: NOW - 240_000, engine: { kind: "team", team: "architect", name: "Architect" },
      blocks: [{ type: "text", text: "First the lexer.\n\nI give it to a builder." }], aligned };
    view.paint(chatWith({ turns: [turn] }));
    const lead = one(view.el, "ld-card");
    assert.deepEqual([lead.classList.contains("is-waiting"), lead.attrs["aria-label"], textOf(one(lead, "ld-words"))],
      [true, "The Architect lead: Its workers are at work", "I give it to a builder."]);
    const orders = one(lead, "ld-orders");
    assert.deepEqual([orders.attrs.role, orders.attrs["aria-label"]], ["group", "Its orders this turn"]);
    const order = buttonsOf(orders)[0];
    // (fails before: yes — the chip said its worker's id, "w1|Build the lexer", and its seat only in its tip)
    assert.deepEqual([order.attrs.role, order.attrs.title, textOf(order)], [undefined, "Builder w1: Build the lexer — running", "Builder|Build the lexer"]);
    assert.deepEqual(words(one(lead, "ld-kv")), ["Rounds", "1", "Compactions", "none", "Spent", "$0.42", "Leading", "5m"]);
    assert.deepEqual([textOf(one(lead, "ld-ring-num")), one(lead, "ld-ring").attrs.title], ["40%", "Its window: 40% full"]);
    order.dispatch("click");
    const card = cardOf(view.el, "w1");
    assert.deepEqual([card.classList.contains("is-flash"), due.map(([, ms]) => ms)], [true, [1200]], "its card brought into sight, marked a moment");
    due[0][0]();
    assert.equal(card.classList.contains("is-flash"), false);
  });

  // (fails before: yes — no Team view to bring a card into)
  test("reveal: a card folded under Earlier opens it; an id the view does not hold changes nothing", () => {
    const ended = (/** @type {string} */ id, /** @type {number} */ at) =>
      row({ id, status: "done", team: { team: "architect", role: "tester" }, exchanges: [{ description: `Check ${id}`, startedAt: at - 1000, endedAt: at, report: `${id} checked` }] });
    const rows = [ended("e1", NOW - 6000), ended("e2", NOW - 5000), ended("e3", NOW - 4000), ended("e4", NOW - 3000), ended("e5", NOW - 2000), ended("e6", NOW - 1000)];
    const { view, due } = teamView(teamIO({ rows: () => rows }));
    view.paint(chatWith());
    const earlier = one(view.el, "tv-earlier");
    assert.deepEqual([textOf(one(earlier, "tv-h-fig")), "open" in earlier.attrs, all(earlier, (x) => !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"])],
      ["2", false, ["e2", "e1"]]);
    view.reveal("e1");
    assert.deepEqual(["open" in earlier.attrs, cardOf(earlier, "e1").classList.contains("is-flash")], [true, true]);
    view.reveal("nobody");
    assert.equal(due.length, 1);
  });
});

describe("the dock's decisions", () => {
  // (fails before: yes — a worker's waiting call could be answered nowhere in the page)
  test("a worker's answers: Allow once, Always allow while an offer stands, Deny with a line for why; one answer at a time", async () => {
    /** @type {any[]} */
    const sent = [];
    /** @type {(ok: boolean) => void} */
    let land = () => {};
    const o = {
      id: "w1",
      who: "the builder",
      offer: { itemId: 7, tool: "bash", shape: "npm test" },
      answer: (/** @type {string} */ id, /** @type {import("../src/ui/harness/conversation/interaction.js").PermissionAnswer} */ w) => { sent.push(["answer", id, w]); return new Promise((r) => { land = r; }); },
      always: (/** @type {string} */ id, /** @type {any} */ offer) => { sent.push(["always", id, offer]); return Promise.resolve(true); },
      place,
    };
    const c = answerControls(fakeH, o);
    assert.deepEqual(buttonsOf(c.el).map(textOf), ["Deny", "Always allow", "Allow"]);
    assert.deepEqual([btn(c.el, "Always allow")?.attrs.title, btn(c.el, "Allow")?.attrs.class], ["Always allow in this project: don't ask again to run npm test", "inst-btn is-primary"]);
    /** @type {any} */ (btn(c.el, "Allow")).dispatch("click");
    assert.deepEqual(sent, [["answer", "w1", { allow: true, words: "" }]]);
    assert.ok(buttonsOf(c.el).every((b) => "disabled" in b.attrs), "the buttons wait for the answer");
    land(true);
    await settle();
    assert.ok(buttonsOf(c.el).every((b) => "disabled" in b.attrs), "answered: they stay down");
    // (fails before: no — a guard the mutation pass asked for: only the buttons' disabled stood between a taken answer
    // and a second one, and the fake DOM, like a script's click, goes through it)
    /** @type {any} */ (btn(c.el, "Allow")).dispatch("click");
    assert.deepEqual(sent, [["answer", "w1", { allow: true, words: "" }]], "a taken answer is the only one");

    const d = answerControls(fakeH, { ...o, offer: null, answer: (id, w) => { sent.push(["answer", id, w]); return Promise.resolve(false); } });
    assert.deepEqual(buttonsOf(d.el).map(textOf), ["Deny", "Allow"], "no offer: no Always allow");
    /** @type {any} */ (btn(d.el, "Deny")).dispatch("click");
    const why = one(d.el, "ask-why");
    assert.deepEqual([why.focused, why.attrs.placeholder, buttonsOf(d.el).map(textOf)], [true, "Why not? the builder reads it (optional)", ["Cancel", "Deny"]]);
    why.dispatch("keydown", { key: "Escape" });
    assert.deepEqual(buttonsOf(d.el).map(textOf), ["Deny", "Allow"], "Esc: back to the answers");
    /** @type {any} */ (btn(d.el, "Deny")).dispatch("click");
    /** @type {any} */ (btn(d.el, "Deny")).dispatch("click");
    await settle();
    assert.deepEqual(sent.at(-1), ["answer", "w1", { allow: false, words: "" }]);
    assert.ok(buttonsOf(d.el).every((b) => !("disabled" in b.attrs)), "refused: the answers come back");
    why.value = "ok, but not now";
    why.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(sent.at(-1), ["answer", "w1", { allow: false, words: "ok, but not now" }], "Deny says no: the why goes as typed, and an ok in it is no yes");

    const a = answerControls(fakeH, o);
    /** @type {any} */ (btn(a.el, "Always allow")).dispatch("click");
    assert.deepEqual(sent.at(-1), ["always", "w1", { itemId: 7, tool: "bash", shape: "npm test" }]);
    // (fails before: yes — HarnessV4_Tasks E3: a worker's first ask offered no Always allow; none waited as an item)
    const fresh = answerControls(fakeH, { ...o, offer: { itemId: null, tool: "bash", shape: "npm test" } });
    assert.deepEqual(buttonsOf(fresh.el).map(textOf), ["Deny", "Always allow", "Allow"]);
    /** @type {any} */ (btn(fresh.el, "Always allow")).dispatch("click");
    assert.deepEqual(sent.at(-1), ["always", "w1", { itemId: null, tool: "bash", shape: "npm test" }]);
  });

  // (fails before: yes — the pause's question sat under its turn, and a worker's question showed nowhere)
  test("the dock: the pause as its kind's block, kept while the same pause holds; a worker's line leaves it in the Team view and comes back as it was", () => {
    /** @type {any[]} */
    const did = [];
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    const dock = createDecisions({
      answer: (chat, text) => { did.push(["answer", text]); },
      always: (chat, itemId) => { did.push(["always", itemId]); },
      workerAnswer: async (id, w) => (did.push(["worker", id, w]), true),
      workerAlways: async (id, itemId) => (did.push(["workerAlways", id, itemId]), true),
      reveal: (id) => { did.push(["reveal", id]); },
      agentAnswer: async () => "",
      agentPlan: async () => "",
      permit: () => {},
      agentPermission: () => {},
      open: () => {},
    }, { h: fakeH, place, later: (fn, ms) => { timers.push({ fn, ms }); } });
    assert.deepEqual([dock.el.attrs.role, dock.el.attrs["aria-label"], dock.el.classList.contains("is-empty")], ["region", "Waiting for you", true]);
    const team = { key: "architect", name: "Architect", icon: "layers" };
    /** @type {any[]} */
    const turns = [{ n: 1, paused: { kind: "permission", tool: "bash", question: "May I run this command?", command: "npm publish" } }];
    const chat = { chainId: "c1", turns };
    dock.paint({ chat, rows: [], view: "chat", team: null });
    const perm = dock.el.kids[0];
    assert.deepEqual([perm.attrs.class, textOf(one(perm, "ix-preview")), dock.el.classList.contains("is-empty")], ["ix-block perm", "npm publish", false]);
    dock.paint({ chat, rows: [], view: "plan", team });
    assert.equal(dock.el.kids[0], perm, "the same pause: the same block, in whichever view shows");
    // The turn's pointer brings the developer to it, and a moment's ring says where.
    dock.focus();
    assert.deepEqual([perm.classList.contains("is-flash"), timers.map((t) => t.ms)], [true, [1200]]);
    timers[0].fn();
    assert.equal(perm.classList.contains("is-flash"), false);
    turns.push({ n: 2, paused: { kind: "question", question: "Which grammar?" } });
    dock.paint({ chat, rows: [], view: "chat", team: null });
    assert.equal(dock.el.kids[0].attrs.class, "ix-block");

    turns.push({ n: 3, status: "done" });
    const asks = row({ id: "w2", card: { tag: "builder", name: "Builder", kind: "worker" }, team: { team: "architect", role: "tester", place: "builder", seat: "Tester" }, progress: { asking: { tool: "bash", args: "npm test", question: "Run npm test?" } } });
    dock.paint({ chat, rows: [asks, row({ id: "w3" })], view: "chat", team });
    // (fails before: no — a guard the mutation pass asked for: the region's empty mark, which hides it, read the pause
    // alone, so a worker's line with no pause could stand in a hidden dock)
    assert.deepEqual([dock.el.kids.length, dock.el.classList.contains("is-empty")], [1, false], "only the one that asks, shown");
    const line = dock.el.kids[0];
    // (fails before: yes — the line named who asks with its id, "Tester · w2")
    assert.deepEqual([line.attrs.class, line.attrs["aria-label"], textOf(one(line, "ask-who")), one(line, "ask-who").attrs.title, textOf(one(line, "ask-what")), textOf(one(line, "ask-cmd"))],
      ["ask-strip", "Tester w2 asks", "Tester", "w2: its card on the Agents tab", "wants to run", "npm test"]);
    one(line, "ask-who").dispatch("click");
    dock.paint({ chat, rows: [asks], view: "team", team });
    assert.deepEqual([dock.el.kids, dock.el.classList.contains("is-empty")], [[], true], "in the Team view its card asks");
    dock.paint({ chat, rows: [{ ...asks }], view: "chat", team });
    assert.equal(dock.el.kids[0], line, "back outside it as it was");
    dock.paint({ chat, rows: [], view: "chat", team });
    assert.deepEqual([dock.el.kids, did], [[], [["reveal", "w2"]]]);
  });

  // (fails before: yes — HarnessV4_Tasks U1; HarnessV3-ACP AC3's notes: a decision never took the keys by itself, and
  // with the focus in the composer the number keys its hint names typed into the composer)
  test("a decision that appears takes the keys where the developer types nothing — never from words in the composer, another field or an open sheet", () => {
    const body = {};
    const box = {};
    let asked = "";
    const control = { closest: (/** @type {string} */ sel) => { asked = sel; return null; } };
    const field = { closest: () => ({}) };
    const keysOf = (/** @type {string} */ draft, /** @type {any} */ active, modal = false) => dockKeys({ draft, modal, active, body, box });
    assert.deepEqual(
      [keysOf("", null), keysOf("", body), keysOf("  \n", box), keysOf("", control), keysOf("", field), keysOf("fix the", box), keysOf("fix the", body), keysOf("", body, true), keysOf("", box, true)],
      ["free", "free", "resting", "resting", null, null, null, null, null],
    );
    assert.equal(asked, 'input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]', "a field, or anything in a sheet, a popover or a menu, is where the developer types");

    /** @type {"free" | "resting" | null} */
    let keys = "resting";
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    const io = { answer: () => {}, always: () => {}, workerAnswer: async () => true, workerAlways: async () => true, reveal: () => {}, agentAnswer: async () => "", agentPlan: async () => "", permit: () => {}, agentPermission: () => {}, open: () => {} };
    const dock = createDecisions({ ...io, keys: () => keys }, { h: fakeH, place, later: (fn, ms) => { timers.push({ fn, ms }); } });
    /** @type {any[]} */
    const turns = [{ n: 1, paused: { kind: "permission", tool: "bash", question: "May I run this command?", command: "npm publish" } }];
    const chat = { chainId: "c1", turns };
    dock.paint({ chat, rows: [], view: "chat", team: null });
    const perm = dock.el.kids[0];
    assert.deepEqual([perm.focused, perm.classList.contains("is-flash"), timers.map((t) => t.ms)], [true, true, [1200]], "the composer was empty: the keys are the decision's, and a moment's ring says where");
    timers[0].fn();
    // The run's events paint the dock again and again: the same block, and nothing is taken twice.
    perm.focused = false;
    dock.paint({ chat, rows: [], view: "chat", team: null });
    assert.deepEqual([dock.el.kids[0] === perm, perm.focused, timers.length], [true, false, 1]);
    // Another appears while the developer types: it waits where it stands.
    keys = null;
    turns.push({ n: 2, paused: { kind: "question", question: "Which grammar?" } });
    dock.paint({ chat, rows: [], view: "chat", team: null });
    assert.deepEqual([dock.el.kids[0] === perm, dock.el.kids[0].focused, timers.length], [false, undefined, 1]);
    // Nothing waits: nothing to take; and the next to appear takes them again.
    keys = "free";
    const team = { key: "architect", name: "Architect", icon: "layers" };
    turns.push({ n: 3, status: "done" });
    dock.paint({ chat, rows: [], view: "chat", team });
    turns.push({ n: 4, waiting: [{ runId: "r1", id: "q1", form: { kind: "question", agent: "Claude Code", title: "Which one?", questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] } }] });
    dock.paint({ chat, rows: [], view: "chat", team });
    const ask = dock.el.kids[0];
    assert.deepEqual([String(ask.attrs.class).includes("ax-block"), ask.focused, ask.classList.contains("is-flash")], [true, true, true], "a coding agent's question takes them whole: its number keys are the block's");
    // A dock whose page says nothing of the keys never takes them by itself.
    const quiet = createDecisions(io, { h: fakeH, place, later: () => {} });
    quiet.paint({ chat: { chainId: "c2", turns: [turns[0]] }, rows: [], view: "chat", team: null });
    assert.equal(quiet.el.kids[0].focused, undefined);
    // The page's side (source contract): the composer's words and its box, an open sheet, and what holds the focus.
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // A view-only device's page has no dock, and gives it no keys (remote-view-ui.test.js).
    assert.match(app, /keys: \(\) => viewOnlyPage\(\) \? null : dockKeys\(\{ draft: composer\.draft\(\), modal: !!document\.querySelector\('\[aria-modal="true"\]'\), active: document\.activeElement, body: document\.body, box: composer\.box \}\),/);
    assert.match(readFileSync("src/ui/harness/composer/composer.js", "utf8"), /\n    box: ta,\n/);
  });
});

describe("the conversation under a team", () => {
  // (fails before: yes — nothing in the conversation said where a team took over)
  test("the divider: a team's tile, its words, the turns it took over and the turn's time; back to your agent with no tile", () => {
    const at = NOW - 60_000;
    const time = messageTimeLabel(at);
    // (the plan's p6: Builders is the shipped team that builds, wearing its own glyph)
    const d = engineDivider({ to: "team", key: "builders", name: "Builders", words: "Builders' lead took over this chat", after: 142 }, at, fakeH);
    assert.deepEqual([d.attrs.class, d.attrs.role, d.attrs["aria-label"], one(d, "team-tile").attrs.html, textOf(d)],
      ["eng-divider", "separator", `Builders' lead took over this chat, after 142 turns · ${time}`, ICONS.wrench, `Builders' lead took over this chat|after 142 turns · ${time}`]);
    assert.equal(textOf(engineDivider({ to: "team", key: "builders", name: "Builders", words: "Builders' lead took over this chat", after: 1 }, null, fakeH)), "Builders' lead took over this chat|after 1 turn");
    assert.equal(one(engineDivider({ to: "team", key: "architect", name: "architect", words: "architect's lead took over this chat" }, null, fakeH), "team-tile").attrs.html, ICONS.users, "a key Filament no longer ships: a team's people");
    const back = engineDivider({ to: "agent", words: "Your agent has this chat again" }, null, fakeH);
    assert.deepEqual([back.attrs.class, back.attrs["aria-label"], one(back, "team-tile"), textOf(back)], ["eng-divider is-agent", "Your agent has this chat again", undefined, "Your agent has this chat again"]);
  });

  // (fails before: yes — the lead's launches were tool calls inside its fold alone)
  test("the order rows: a group of buttons, each the member, the worker, the task and its state, bringing the worker's card", () => {
    /** @type {string[]} */
    const opened = [];
    const el = orderRowsEl([
      { id: "u1", agentId: "w1", role: "builder", word: "Builder", icon: "hammer", task: "Build the lexer", state: "running" },
      { id: "u2", agentId: "w2", role: "auditor", word: "auditor", icon: "bot", task: "Audit", state: "done" },
    ], (id) => { opened.push(id); }, fakeH);
    assert.deepEqual([el.attrs.role, el.attrs["aria-label"]], ["group", "The lead's orders"]);
    const [a, b] = buttonsOf(el);
    // (fails before: yes — a row said its worker's id between its seat and its task, "Builder|w1|Build the lexer|running")
    assert.deepEqual([a.attrs.class, a.attrs.title, textOf(a)], ["od-row is-running", "w1: its card on the Agents tab", "Builder|Build the lexer|running"]);
    assert.deepEqual([textOf(b), one(b, "role-tile").attrs.html], ["auditor|Audit|done", ICONS.bot], "a tag the team no longer has: as written, a sub-agent's glyph");
    assert.equal(one(a, "role-tile").attrs.html, ICONS.hammer, "a member wears its glyph");
    b.dispatch("click");
    assert.deepEqual(opened, ["w2"]);
  });

  // (fails before: yes — a turn's footer never said who answered it)
  test("the footer's tag: a team's lead by name; nothing for your agent", () => {
    assert.deepEqual([engineTag(undefined, fakeH), engineTag({ kind: "model" }, fakeH)], [null, null]);
    const tag = engineTag({ kind: "team", team: "builders", name: "Builders" }, fakeH);
    assert.deepEqual([tag.attrs.class, tag.attrs.title, textOf(tag), one(tag, "team-tile").attrs.html], ["eng-tag", "Answered by the Builders team's lead", "Builders' lead", ICONS.wrench]);
    assert.equal(textOf(engineTag({ kind: "team", team: "my-crew" }, fakeH)), "my-crew's lead", "a stamp with no name names its team by its key");
  });

  // (fails before: yes — U13-D6: who answered was said only in the footer, which shows on a hover)
  test("the lead signs its replies: its team's crowned portrait, its name, lead — at the head of each turn a team answered; nothing for your agent", () => {
    assert.deepEqual([engineSig(undefined, fakeH), engineSig({ kind: "model" }, fakeH)], [null, null]);
    const sig = engineSig({ kind: "team", team: "builders", name: "Builders" }, fakeH);
    assert.deepEqual([sig.attrs.class, textOf(sig), one(sig, "pf").attrs.class, one(sig, "pf-ic").attrs.html, one(sig, "pf-crown").attrs.html, sig.attrs.title],
      ["a-sig", "Builders|· lead", "pf s24 t-orange", ICONS.wrench, ICONS.crown, "Builders' lead answers in this chat while its team is in charge"]);
    assert.equal(textOf(engineSig({ kind: "team", team: "my-crew" }, fakeH)), "my-crew|· lead", "a stamp with no name names its team by its key");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const sig = engineSig\(turn\.engine\);\n\s*const group = h\("div", \{ class: "assistant-turn" \}, sig, fold \? fold\.el : a, final\);/, "at the head of the turn's reply, by its stamp");
    assert.match(timeline, /placeChildren\(v\.group, \[v\.sig, \.\.\.parts\.before/, "and kept there where a compaction's lines part the work");
  });
});

describe("the Team widget", () => {
  /**
   * The context the Team widget reads, recording what it was asked.
   * @param {{ settings: any, rows?: () => any[], turns?: any[], wait?: () => string | null, session?: boolean }} o
   */
  const ctxOf = ({ settings, rows = () => [], turns = [], wait = () => null, session = true }) => {
    /** @type {any[]} */
    const did = [];
    const ctx = /** @type {any} */ ({
      view: () => ({ settings }),
      hasSession: () => session,
      write: (/** @type {any} */ change) => { did.push(["write", change]); },
      turns: () => turns,
      subagents: { rows, models: () => [], sessionModel: () => "glm-5.3" },
      team: { open: () => { did.push(["open"]); }, back: () => { did.push(["back"]); }, wait },
    });
    return { ctx, did };
  };

  // (fails before: yes — nothing by the box said who answers what you type)
  test("its pill shows only while a team leads: the crown and the team's name, warn while it cannot lead, a dot while a worker asks", () => {
    const settings = chatWith().view.settings;
    const w = teamWidget(ctxOf({ settings }).ctx, { h: fakeH, drawIn: fakeDrawIn });
    assert.deepEqual([w.id, w.visible?.(), w.state?.(), w.tone?.(), w.title?.(), w.marks?.()],
      ["team", true, "Architect", "", "The Architect team answers — run by Architect, with Scout, Builder, Tester, Reviewer: its lead reads your messages", { asks: false }]);
    const face = w.face?.(fakeH);
    // Gold is in charge everywhere (team_v2_plan §10 O4): the crown, as the header's capsule.
    assert.deepEqual([face.attrs.class, one(face, "wt-crown").attrs.html, textOf(face)], ["inst-pill-face", ICONS.crown, "Architect"]);
    settings.engine.problem = "the agent loop is off";
    assert.deepEqual([w.tone?.(), w.title?.()], ["warn", "The Architect team cannot lead now: the agent loop is off. Its turns go to the model meanwhile."]);
    const asking = ctxOf({ settings, rows: () => [row({ progress: { asking: { tool: "bash", args: "npm test" } } })] });
    assert.deepEqual(teamWidget(asking.ctx, { h: fakeH, drawIn: fakeDrawIn }).marks?.(), { asks: true });
    assert.equal(teamWidget(ctxOf({ settings: chatWith({ team: null }).view.settings }).ctx, { h: fakeH, drawIn: fakeDrawIn }).visible?.(), false, "your agent: no pill");
    assert.equal(teamWidget(ctxOf({ settings, session: false }).ctx, { h: fakeH, drawIn: fakeDrawIn }).visible?.(), false, "no session: no pill");
  });

  // (fails before: yes — the team's controls were nowhere by the box)
  test("its popover: who is at work, Back to your agent through the switch, Open Team; no list of the crew's own", () => {
    const settings = chatWith().view.settings;
    const turns = [{ n: 1, startedAt: NOW - 300_000, engine: { kind: "team", team: "architect", name: "Architect" } }];
    let rows = [row(), row({ id: "w2", progress: { asking: { tool: "bash", args: "npm test" } } })];
    /** @type {string | null} */
    let wait = "Workers are still at work: switch once they finish, or stop them";
    const { ctx, did } = ctxOf({ settings, rows: () => rows, turns, wait: () => wait });
    const w = teamWidget(ctx, { h: fakeH, drawIn: fakeDrawIn }, { now: () => NOW });
    let closed = 0;
    const panel = w.panel?.(fakeH, () => { closed += 1; }, () => {});
    assert.deepEqual([panel.attrs.class, textOf(one(panel, "inst-head")).startsWith("Architect team")], ["inst inst-team", true]);
    assert.ok(words(panel).includes("2 at work · 1 asks you"));
    assert.equal(textOf(one(panel, "inst-foot-note")), "Leading for 5m · $0.42 this session");
    // (fails before: yes — HarnessV4_Tasks E23-D6: the row was "Members run on", then U13's "The crews' list", which
    // wrote subagents.workers; U13-D14: a team's crew runs on the chat's list, set on its Agents tab)
    assert.equal(words(panel).some((s) => /list/i.test(s)), false, "no list of its own");
    const held = /** @type {any} */ (btn(panel, "Back to your agent"));
    assert.deepEqual([held.attrs.disabled, held.attrs.title], ["", wait]);
    held.dispatch("click");
    assert.deepEqual([did, closed], [[], 0]);
    wait = null;
    rows = [];
    w.repaint?.();
    assert.ok(words(panel).includes("Nobody yet"));
    /** @type {any} */ (btn(panel, "Back to your agent")).dispatch("click");
    /** @type {any} */ (btn(panel, "Open Team")).dispatch("click");
    assert.deepEqual([did, closed], [[["back"], ["open"]], 2], "each closes the popover first");
  });

  // (fails before: yes — nothing said who was at work but the status capsule's count)
  test("who is at work, in words", () => {
    assert.deepEqual([atWorkWords([]), atWorkWords([row({ status: "done" })])], ["Nobody yet", "Nobody yet"]);
    assert.equal(atWorkWords([row(), row({ id: "w2", progress: { asking: { tool: "edit" } } })]), "2 at work · 1 asks you");
    assert.equal(atWorkWords([row({ progress: { asking: {} } }), row({ id: "w2", progress: { asking: {} } })]), "2 at work · 2 ask you");
    // (fails before: yes — the owner's words of 10-18: an agent asked on the side counted as the team's)
    assert.equal(atWorkWords([row({ id: "s1", team: null, origin: "owner" }), row({ id: "s2", team: null })]), "Nobody yet", "agents on the side are the Side tab's");
    assert.equal(atWorkWords([row({ id: "t1", team: null, task: "t1" })]), "1 at work", "an agent doing a task of the graph");
  });
});

describe("HarnessV3-TaskGraph-v2 TG2-D49: a worker's question to its lead, on the page (case 42)", () => {
  const LEAD_ASK = { to: "lead", tool: "ask_lead", args: "", question: "Which date format? The parser reads `both`.", options: ["ISO dates", "the locale's"], n: 3, at: NOW - 40_000 };
  /** A Builder whose question waits for its lead. @param {Record<string, any>} [o] */
  const asksLead = (o = {}) => row({ progress: { round: 2, asking: { ...LEAD_ASK } }, ...o });

  // (fails before: yes — its question read as the developer's: its card asked "Wants to use ask_lead", with Allow and Deny)
  test("its card says it asks its lead — its question with its marks, its options, its pick first — and has no Allow or Deny", () => {
    const { view } = teamView(teamIO({ rows: () => [asksLead()] }));
    view.paint(chatWith());
    const card = cardOf(view.el, "w1");
    assert.deepEqual([card.classList.contains("is-running"), textOf(one(card, "tg-badge")), one(card, "ag-ask")], [true, "running", undefined]);
    const drawn = one(card, "ag-lead-ask").kids.map((/** @type {any} */ k) => (typeof k === "string" ? k : `${k.tag}:${textOf(k)}`));
    assert.deepEqual(drawn, ['Asks its lead (ask 3): "Which date format? The parser reads ', "code:both", ".\" — its options: ISO dates (its pick), the locale's"]);
    assert.deepEqual(buttonsOf(card).map((b) => textOf(b)).filter((w) => w === "Allow" || w === "Deny"), []);
  });

  // (fails before: yes — the dock drew its line with Allow and Deny, and every count said it asks you)
  test("the dock, the counts, the Side tab's rows and the agent card's line leave it to its lead", () => {
    const dock = createDecisions({
      answer: () => {}, always: () => {}, workerAnswer: async () => true, workerAlways: async () => true, reveal: () => {},
      agentAnswer: async () => "", agentPlan: async () => "", permit: () => {}, agentPermission: () => {}, open: () => {},
    }, { h: fakeH, place, later: () => {} });
    dock.paint({ chat: { chainId: "c1", turns: [{ n: 1, status: "done" }] }, rows: [asksLead()], view: "chat", team: { key: "architect", name: "Architect", icon: "layers" } });
    assert.deepEqual([dock.el.kids, dock.el.classList.contains("is-empty")], [[], true], "no line in the dock");
    assert.equal(atWorkWords([asksLead()]), "1 at work");
    assert.deepEqual([cardState(asksLead()), cardState(row({ progress: { asking: { tool: "bash", args: "npm test" } } }))], ["running", "asking"]);
    assert.deepEqual([yourAsk(asksLead().progress), yourAsk({ asking: { tool: "bash", args: "npm test" } })?.tool, leadAskLine({ round: 1, asking: null })], [null, "bash", null]);
    const mine = asksLead({ origin: "owner" });
    assert.deepEqual([sideRow(/** @type {any} */ (mine), NOW).fact, sideRow(/** @type {any} */ (mine), NOW).tone, sideBadge(/** @type {any} */ ([mine]), { live: new Set(), opened: new Set() })?.dot], ["asks its lead", "works", "works"]);
    assert.equal(liveLine(/** @type {any} */ (asksLead().progress)), "Asks its lead: Which date format? The parser reads `both`.");
  });

  // (fails before: yes — the lead's call row read "Asks you" while its worker asked it, and its answer read as a no)
  test("on the lead's timeline: its worker asks it, and the lead's answer reads as an answer, not a no", () => {
    const tl = alignEvents([
      { type: "round-start", round: 2 },
      { type: "tool-start", round: 2, id: "toolu_1", name: "agent", args: "" },
      { type: "subagent-start", round: 2, parent: "toolu_1", agentId: "sa_1", description: "Build it", role: "builder" },
      { type: "subagent-ask", round: 2, parent: "toolu_1", agentId: "sa_1", tool: "ask_lead", to: "lead", question: "Which date format?", ask: 1 },
    ]);
    assert.deepEqual(tl.byRound.get(2).tools.get("toolu_1").sub.asking, { tool: "ask_lead", args: undefined, to: "lead" });
    const ended = alignEvents([
      { type: "round-start", round: 2 },
      { type: "tool-start", round: 2, id: "toolu_1", name: "agent", args: "" },
      { type: "subagent-start", round: 2, parent: "toolu_1", agentId: "sa_1", description: "Build it", role: "builder" },
      { type: "subagent-ask", round: 2, parent: "toolu_1", agentId: "sa_1", tool: "ask_lead", to: "lead", question: "Which date format?", ask: 1 },
      { type: "subagent-ask-end", round: 2, parent: "toolu_1", agentId: "sa_1", to: "lead", answered: true, by: "lead", words: "ISO dates" },
    ]);
    assert.deepEqual(ended.byRound.get(2).tools.get("toolu_1").sub.answers, [{ by: "lead", question: true, words: "ISO dates" }]);
  });
});

describe("the page's wiring (source contract: the page boots a DOM at import)", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");

  // (fails before: yes — nothing waited over the composer: the pause's ask sat under its turn)
  test("the dock: mounted over the composer, painted as the chat, the view, the list or the pause moves", () => {
    assert.match(app, /composer\.asks\.append\(decisions\.el\);/);
    assert.match(app, /subagentStore\.onChange\(\(\) => \{\n(?: {2}.*\n)*? {2}paintDock\(\);\n {2}transcript\.paintOrders\(\);\n {2}transcript\.paintAgentEnds\(\);\n\}\);/);
    assert.match(app, /onPauseChange: \(\) => paintDock\(\),\n {2}onToDecision: \(\) => decisions\.focus\(\),/);
    assert.match(app, /onShow: \(chat\) => \{ syncAddress\(chat\); paintDock\(\); \}/);
    // A coding agent the chat's model: the dock is told it (the decision of 11-02).
    assert.match(app, /decisions\.paint\(\{ chat, rows: chat\?\.chainId \? subagentStore\.rows\(\) : \[\], view: views\.view, team, coder \}\);/);
    assert.match(app, /\n {2}composer\.setTeam\(\{ lead: !!team && !team\.problem, name: team\?\.name \|\| "" \}\);\n(?: {2}\/\/[^\n]*\n)* {2}chargeBand\.paint\(chat\);/);
  });

  // (fails before: no — a guard: the turn a send draws names who answers it from its first moment)
  test("a send's turn says at once who answers it", () => {
    const start = app.indexOf("async function sendMessage(");
    const send = app.slice(start, app.indexOf("\n}\n", start));
    assert.match(send, /engine: engineStamp\(chat\.view\?\.settings\?\.engine\),/);
  });

  // (fails before: yes — the V3 drive: the status panel listed the team's workers beside the Team tab, and its card
  // opened over the conversation as each one started, over the developer's message and the order rows' Open)
  test("the status panel leaves a team's workers to the Team tab: it neither lists them nor opens for them", () => {
    const panel = readFileSync("src/ui/harness/conversation/status-panel.js", "utf8");
    assert.match(panel, /const withoutWorkers = \(m\) => \(\{ \.\.\.\(m \|\| \{\}\), subagents: \(m\?\.subagents \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ r\) => !r\.team\) \}\);/);
    const set = panel.slice(panel.lastIndexOf("    set(m) {"), panel.lastIndexOf("      paint();\n    },"));
    assert.match(set, /^ {4}set\(m\) \{\n {6}model = withoutWorkers\(m\);\n/);
    assert.match(set, /const running = \(model\.subagents \|\| \[\]\)\.filter/, "the card opens for the session's own sub-agents only");
    // The capsule's popover reads the same: its agents at work are the session's own.
    assert.match(panel, /const m = withoutWorkers\(model\);/);
  });

  // (fails before: yes — the V3 drive: two workers' lines in the dock stretched their answers to fill each line, so
  // Deny and Allow stood at different widths and places line to line; a card's "Wants to run" broke over two lines
  // beside a long command)
  test("the dock's lines keep their answers at their own width at the end, line under line; a card's ask keeps its words on one line", () => {
    const css = readFileSync("src/ui/harness/views/team.css", "utf8");
    assert.match(css, /\.ask-strip \.ask-acts \.inst-btn \{ flex: none; min-width: 84px; height: 28px; \}/);
    assert.match(css, /\.ag-ask-q > span \{ flex: none; white-space: nowrap; \}/);
  });

  // (fails before: no — a guard: where the page keeps a pause, live and after a reload, and where the turn's pointer to
  // it is painted)
  test("a pause is kept as pauseOf makes it, live and after a reload; the turn's pointer says nothing while nothing waits", () => {
    assert.match(app, /last\.paused = pauseOf\(chat\.paused\);/);
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /api_\.setPaused\(turn, pauseOf\(lastAsk\)\);/);
    assert.match(timeline, /paintSteers\(turn, v\);\n\s*point\(turn, v\);/);
    assert.match(timeline, /if \(!turn\.paused && !turn\.waiting\?\.length\) return "";/);
  });

  // (fails before: yes — the conversation drew no divider where a team took over, no order rows and no tag)
  test("the timeline: the divider before its turn, the order rows under the reply, repainted as the list moves; the footer's tag", () => {
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const engine = engineDividers\(chat\?\.turns \|\| \[\]\)\.get\(turn\);[\s\S]{0,400}v\.divider = engine \? \{ sig: divider, row: engineDivider\(engine, turn\.startedAt\) \} : null;\n\s*placeChildren\(v\.before, \[\.\.\.keptBoundaries\(\(v\.keptBefore \|\|= new Map\(\)\), turn\.boundaries \|\| \[\], !!engine\), \.\.\.\(v\.divider \? \[v\.divider\.row\] : \[\]\)\]\);/);
    // The agent's notices (HarnessV4_Tasks C21) stand between the reply's words and the order rows.
    assert.match(timeline, /\.\.\.after\.map\(\(s\) => s\.el\), v\.notices, v\.orders, live \? steers : null,/);
    assert.match(timeline, /for \(const \[turn, v\] of view\) if \(turn\.aligned && paintOrders\(turn, v\)\) layout\(turn, v\);/);
    assert.match(app, /agentRows: \(\) => subagentStore\.rows\(\),\n\s*agentRowsKnown: \(\) => subagentStore\.known\(\),\n\s*agentLogged: \(sub\) => subagentStore\.logged\(sub\),\n\s*agentCard: \(id, exchange\) => subagentStore\.card\(id, exchange\),\n\s*onRevealAgent: \(id\) => views\.reveal\(id\),/);
    const turnJs = readFileSync("src/ui/harness/conversation/turn.js", "utf8");
    assert.match(turnJs, /when \? h\("span", \{\}, when\) : null, engineTag\(turn\.engine\),/);
    // The conversation's live fold says what a lead's turn waits for in a team's words.
    assert.match(timeline, /liveWords\(al, turn\.engine\?\.kind === "team"\)/);
  });

  // (fails before: yes — the box said nothing of who answers)
  test("the composer: who answers in its words", () => {
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /steerable \? \(lead \? `Tell \$\{theLead\(\)\} — it reads your words at its next step` : "A turn is running — what you send now is read at its next step"\)/);
    assert.match(composer, /const theLead = \(\) => \(leadName \? `\$\{possessive\(leadName\)\} lead` : "the lead"\);/, "the team in charge by name, its possessive as a sentence says it");
    assert.match(composer, /leadName = lead \? String\(s\.name \|\| ""\) : "";/);
    assert.match(composer, /\n\s*: lead \? `Tell \$\{theLead\(\)\}`\n/);
  });

  // (fails before: yes — a permission switch answered the session's own pause alone; a worker's call stayed waiting)
  test("the permission switch answers each waiting worker too, a 409 — answered meanwhile — said nowhere", () => {
    assert.match(app, /const answer = loopSwitchAnswer\(chat, mode\);\n\s*if \(answer\) sendMessage\(answer, \[\], "normal", \{ modeSwitch: true, ours: true \}\);\n\s*switchWorkers\(mode\);/);
    // None while a turn runs, nor while a coding agent is the chat's model (the decision of 11-02).
    assert.match(app, /const loopSwitchAnswer = \(chat, mode\) => \(chat\.live \|\| coderNameOf\(chat\) \? null : switchAnswer\(newestOnRecord\(chat\.turns\), mode\)\);/);
    assert.match(app, /routes\.answer\(r\.id, words, \{ modeSwitch: true \}\)/);
    assert.match(app, /x\.status === "rejected" && !\/409\/\.test\(errText\(x\.reason\)\)/);
  });
});

describe("HarnessV3-TaskGraph G3: a team's tasks on the surfaces", () => {
  // (fails before: yes — G3-7: the Team view showed the work going on and done, never a task still to come)
  test("the tasks still to come, between the work going on and the work done: who is to do each, what it waits on, a click showing it on the graph", () => {
    const graph = { closed: null, held: null, tasks: [
      { id: "t1", name: "Map the callers", by: "scout", state: "done", needs: [], ready: false, stopped: false },
      { id: "t2", name: "Fix the parser", by: "builder", state: "waiting", needs: ["t1"], ready: true, stopped: false },
      { id: "t3", name: "Test the comma", by: "tester", state: "waiting", needs: ["t2"], ready: false, stopped: false },
    ] };
    /** @type {any} */
    let g = graph;
    const rows = [row({ id: "w1" }), row({ id: "w0", status: "done", exchanges: [{ description: "Map", startedAt: NOW - 200_000, endedAt: NOW - 100_000, report: "Mapped." }] })];
    const io = teamIO({ rows: () => rows, graph: () => g });
    const { view } = teamView(io);
    view.paint(chatWith());
    /** Each card of the grid, by its sub-agent's id or its task's. */
    const ids = () => one(view.el, "tv-grid").kids.map((/** @type {any} */ k) => k.attrs["data-id"] || k.attrs["data-task"]);
    assert.deepEqual(ids(), ["w1", "t2", "t3", "w0"]);
    const [ready, waiting] = one(view.el, "tv-grid").kids.slice(1, 3);
    assert.deepEqual([ready.tag, ready.attrs.class, words(ready), ready.attrs["aria-label"]], ["button", "ag-card is-task is-ready", ["Builder", "t2", "Fix the parser", "ready", "Filament starts it"], "Builder's task t2: Fix the parser, ready — Filament starts it"]);
    assert.deepEqual([waiting.attrs.class, words(waiting), one(ready, "role-tile").attrs.class], ["ag-card is-task is-waiting", ["Tester", "t3", "Test the comma", "waiting", "needs t2"], "role-tile"]);
    assert.equal(textOf(one(view.el, "tv-h")), "Its workers|1 at work · 2 waiting");
    ready.dispatch("click");
    assert.deepEqual(io.calls.filter((c) => c[0] === "openTask"), [["openTask", "t2"]]);
    // A pulse keeps a card whose words hold; one whose words change is drawn anew; a task that started leaves.
    view.paint(chatWith());
    assert.equal(one(view.el, "tv-grid").kids[1], ready);
    g = { ...graph, held: { at: 1 } };
    view.paint(chatWith());
    assert.notEqual(one(view.el, "tv-grid").kids[1], ready);
    assert.equal(words(one(view.el, "tv-grid").kids[1]).at(-1), "held until the lead's next tasks call");
    g = { ...graph, tasks: graph.tasks.filter((t) => t.id !== "t2") };
    view.paint(chatWith());
    assert.deepEqual(ids(), ["w1", "t3", "w0"]);
    // A team with no worker yet and its tasks waiting shows them, not "no work yet".
    const quiet = teamView(teamIO({ graph: () => graph }));
    quiet.view.paint(chatWith());
    assert.deepEqual([one(quiet.view.el, "tv-empty"), textOf(one(quiet.view.el, "tv-h"))], [undefined, "Its workers|2 waiting"]);
  });

  // (fails before: yes — the Team view showed no task to come; a test the mutation pass asked for: no sub-agent's task
  // card)
  test("your agent's task to come is a sub-agent's card", () => {
    const graph = { closed: null, held: null, tasks: [{ id: "t1", name: "Map the callers", by: "explorer", state: "waiting", needs: [], ready: true, stopped: false }] };
    const { view } = teamView(teamIO({ graph: () => graph }));
    view.paint(chatWith({ team: null }));
    const task = one(one(view.el, "tv-grid"), "is-task");
    assert.deepEqual([one(task, "role-tile").attrs.class, words(task), textOf(one(view.el, "tv-h"))], ["role-tile is-sub", ["Explorer", "t1", "Map the callers", "ready", "Filament starts it"], "The graph's tasks|1 waiting"]);
  });

  // (fails before: yes — the G3f drive: in the Team view a task's builder said done while a reviewer read its change,
  // and running again for the fix; and done once its task had failed)
  test("a task's worker card says its task is in review while a reviewer reads its change, and failed with why", () => {
    const t2 = { id: "t2", name: "Fix the parser", by: "builder", state: "review", needs: [], ready: false, stopped: false, agent: "w2", why: "" };
    /** @type {any} */
    let g = { closed: null, held: null, tasks: [t2] };
    const rows = [row({ id: "w2", status: "done", task: "t2", description: "t2: Fix the parser", exchanges: [{ description: "t2: Fix the parser", startedAt: NOW - 200_000, endedAt: NOW - 100_000, report: "Took the comma." }] })];
    const { view } = teamView(teamIO({ rows: () => rows, graph: () => g }));
    const card = () => cardOf(view.el, "w2");
    /** Its state's class, its badge, its line and whether the line is the failure card's (lib/failure.js). */
    const seen = () => {
      const c = card();
      const fail = one(c, "ix-error-msg");
      return [["is-review", "is-done", "is-failed"].filter((s) => c.classList.contains(s)).join(" "), textOf(one(c, "tg-badge")), textOf(fail || one(c, "ag-report")), !!fail];
    };
    view.paint(chatWith());
    assert.deepEqual(seen(), ["is-review", "in review", "Took the comma.", false]);
    assert.equal(card().attrs["aria-label"], "Builder w2: t2: Fix the parser, in review");
    g = { ...g, tasks: [{ ...t2, state: "failed", why: "its review still asked for changes at round 2 of 2: take a lone comma" }] };
    view.paint(chatWith());
    assert.deepEqual(seen(), ["is-failed", "failed", "its review still asked for changes at round 2 of 2: take a lone comma", true]);
    g = { ...g, tasks: [{ ...t2, state: "done" }] };
    view.paint(chatWith());
    assert.deepEqual(seen(), ["is-done", "done", "Took the comma.", false]);
  });

  // (fails before: no — a guard the mutation pass asked for: a worker's card said why its task failed though another
  // worker had taken the task since)
  test("a worker's own failure stays its own once another worker has taken its task", () => {
    const g = { closed: null, held: null, tasks: [{ id: "t2", name: "Fix the parser", by: "builder", state: "failed", needs: [], ready: false, stopped: false, agent: "w9", why: "its review still asked for changes at round 2 of 2: take a lone comma" }] };
    const rows = [row({ id: "w2", status: "failed", task: "t2", description: "t2: Fix the parser", exchanges: [{ description: "t2: Fix the parser", startedAt: NOW - 200_000, endedAt: NOW - 100_000, error: "the provider refused the request" }] })];
    const { view } = teamView(teamIO({ rows: () => rows, graph: () => g }));
    view.paint(chatWith());
    assert.deepEqual([textOf(one(cardOf(view.el, "w2"), "ix-error")), one(cardOf(view.el, "w2"), "ag-report")], ["the provider refused the request", undefined]);
  });

  // (fails before: yes — HarnessV4_Tasks U1: a worker's failure was one clamped red line, its cause run together with
  // what it had streamed and what is kept)
  test("a failed worker's card: the cause on its line, what it had done and what is kept under it — its failure's two parts, where its task failed in its words", () => {
    const failure = { head: "round 2's model call to glm-5.3-flash at zai failed after 10 min: the connection was reset (ECONNRESET).", more: "It had streamed about 11,000 tokens of thinking. 1 finished round is kept." };
    const line = `${failure.head} ${failure.more}`;
    const rows = [row({ id: "w2", status: "failed", task: "t2", description: "t2: Fix the parser", exchanges: [{ description: "t2: Fix the parser", startedAt: NOW - 200_000, endedAt: NOW - 100_000, status: "failed", error: line, failure }] })];
    /** @type {any} */
    let g = null;
    const { view } = teamView(teamIO({ rows: () => rows, graph: () => g }));
    const parts = () => ["ix-error-msg", "ix-error-more", "ix-error-repeat"].map((c) => { const el = one(cardOf(view.el, "w2"), c); return el ? textOf(el) : null; });
    view.paint(chatWith());
    assert.deepEqual(parts(), [failure.head, failure.more, null]);
    const drawn = one(cardOf(view.el, "w2"), "ix-error");
    view.paint(chatWith());
    assert.equal(one(cardOf(view.el, "w2"), "ix-error"), drawn, "a pulse that changes nothing keeps the card it drew");
    // Its task failed in the worker's own words: the parts stand, and the repeat is called out with them.
    const task = { id: "t2", name: "Fix the parser", by: "builder", state: "failed", needs: [], ready: false, stopped: false, agent: "w2", tries: 2, why: line, failures: { cause: "x", times: 2 } };
    g = { closed: null, held: null, tasks: [task] };
    view.paint(chatWith());
    assert.deepEqual(parts(), [failure.head, failure.more, "t2 failed the same way 2 times in a row"]);
    // The task failed for a reason of its own (its review, its merge): that reason is the cause, whole.
    g = { closed: null, held: null, tasks: [{ ...task, why: "its merge met a conflict in parse.js", failures: null }] };
    view.paint(chatWith());
    assert.deepEqual(parts(), ["its merge met a conflict in parse.js", null, null]);
  });

  // (fails before: no — a guard the mutation pass asked for: a card in review stood lifted as one at work)
  test("a card in review rests as an ended one", () => {
    const css = readFileSync("src/ui/harness/views/team.css", "utf8");
    assert.match(css, /\n\.ag-card:is\(\.is-review, \.is-done, \.is-stopped, \.is-failed\) \{ gap: 8px; box-shadow: none; \}/);
  });
});

describe("HarnessV3-ACP AC6-7: a team's lead on a coding agent", () => {
  /** A question the lead's coding agent asks on its run. */
  const QUESTION = { type: "ask", kind: "question", question: "Which grammar?", waits: true, id: "q:run_1:1", runId: "run_1" };

  test("the Team view: its leader asks you while a question waits on its run; the head shows each coding agent the team runs on once — its fullest window's gauge and glance, its sentence on hover", () => {
    const plan = (/** @type {string} */ upstream, /** @type {string} */ name, /** @type {number} */ used) => ({ upstream, agent: upstream, type: "acp", name, agentName: name, ways: [],
      account: { identity: { label: "me@work" }, windows: [{ id: "5h", label: "5-hour", kind: "session", usedPercent: used, state: used >= 80 ? "warning" : "ok", resetsAt: null }], fullest: "5h" } });
    const claude = plan("claude-code", "Claude Code", 42);
    const codex = plan("codex", "Codex", 85);
    const io = teamIO({ model: () => "claude-code/haiku", account: (/** @type {string} */ m) => (m.startsWith("claude-code/") ? claude : m.startsWith("codex/") ? codex : null) });
    const { view } = teamView(io);
    const turn = { n: 1, status: "streaming", startedAt: NOW - 1000, engine: { kind: "team", team: "architect", name: "Architect" }, blocks: [], waiting: [QUESTION], aligned: alignEvents([]) };
    const pills = () => all(view.el, (x) => String(x.attrs?.class || "").split(" ").includes("tv-plan")).map((p) => [p.attrs.class, textOf(p), p.attrs.title]);
    view.paint(chatWith({ turns: [turn], live: { turn, reply: { blocks: [] } }, flat: { "subagents.pool": [{ model: "claude-code/sonnet", seats: 4 }, { model: "", seats: 1 }] } }));
    const lead = one(view.el, "ld-card");
    assert.deepEqual([lead.classList.contains("is-asking"), textOf(one(lead, "tg-badge"))], [true, "asks you"]);
    assert.deepEqual(pills(), [["tv-plan", "Claude Code|5h 42%", "me@work: 42% of its 5-hour window used"]], "five Claude workers draw on one plan");
    view.paint(chatWith({ turns: [turn], live: { turn, reply: { blocks: [] } }, flat: { "subagents.pool": [{ model: "zai/glm-5.3", seats: 2 }, { model: "codex/gpt-5.6-luna", seats: 2 }] } }));
    assert.deepEqual(pills().map((p) => [p[0], p[1]]), [["tv-plan", "Claude Code|5h 42%"], ["tv-plan is-warn", "Codex|5h 85%"]], "each coding agent a row of the pool runs on");
    codex.account = /** @type {any} */ ({ identity: null, windows: [], fullest: null });
    view.paint(chatWith({ turns: [turn], live: { turn, reply: { blocks: [] } }, flat: { "subagents.pool": [{ model: "codex/gpt-5.6-luna", seats: 4 }] } }));
    assert.deepEqual(pills().map((p) => p[1]), ["Claude Code|5h 42%"], "an agent that has not said who it runs as has no plan to show yet");
    view.paint(chatWith({ team: null, turns: [turn] }));
    assert.deepEqual(pills(), [], "your agent's plan is the Account instrument's to show");
    // (fails before: yes — the Fable 5.2 re-read's finding 10: a spent window extra usage covers drew its gauge red here,
    // beside the amber "extra usage" of its own glance)
    claude.account = /** @type {any} */ ({ identity: { label: "me@work" }, extraCovers: true, spent: false, windows: [{ id: "5h", label: "5-hour", kind: "session", usedPercent: 100, state: "spent", resetsAt: null }], fullest: "5h" });
    view.paint(chatWith({ turns: [turn], live: { turn, reply: { blocks: [] } }, flat: { "subagents.pool": [{ model: "claude-code/sonnet", seats: 4 }] } }));
    const gauge = String(one(view.el, "tv-plan-gauge").attrs.html);
    assert.deepEqual([pills().map((p) => [p[0], p[1]]), /sys-orange/.test(gauge), /sys-red/.test(gauge)], [[["tv-plan is-warn", "Claude Code|5h extra usage"]], true, false]);
  });

  test("the page's side of the head: each coding agent's account, read by its model, and drawn again as the accounts move", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /account: \(model\) => agentOf\(model\),/);
    assert.match(app, /const accountsMoved = \(\) => \{\n {2}widgets\.paint\(\);\n {2}views\.draw\(\);/, "the head follows the accounts");
  });
});
