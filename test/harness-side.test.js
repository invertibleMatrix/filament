// @ts-check
// HarnessV4_Tasks E15 step 5a, U12: the Sub Agents tab — every agent that works for the session, in one place. The
// model and its words (lib/side.js): the starts as tiles, the chips under a new thread's box and its effort, the launch
// it makes, the list's groups by what each needs of you, a row's tag of who started it and its glyph, the seats, the
// @ menu's groups, the tab's badge, the strip that says what the main agent does. The view on the fake DOM
// (views/side.js): the seats, a new thread, its menus, a launch and a refused one, Catch me up's question in the box,
// the list and its fold, a thread whose agent asks you. The words held for an agent still at work (lib/held-asks.js) and
// the thread that is not yours to continue. The tab among the session's views: its name, its address, its key, its
// badge, the dock that is not in it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRoute, routeFor, VIEWS } from "../src/ui/harness/lib/router.js";
import { comboOf, matchShortcut } from "../src/ui/harness/shortcuts.js";
import { createViews } from "../src/ui/harness/views/host.js";
import { GEAR_LINE, GEAR_TITLE, TEAM_BRIEF, createSideView } from "../src/ui/harness/views/side.js";
import { pdfRefused } from "../src/ui/harness/composer/attachments.js";
import { typedOf } from "../src/ui/harness/composer/slash.js";
import { createHeldAsks } from "../src/ui/harness/lib/held-asks.js";
import { ACT_ON_REPORT, deliveryFact, freshWords, noBoxWhy, sendChoices, sentWords } from "../src/ui/harness/lib/subagents.js";
import { toldWords } from "../src/ui/harness/lib/team.js";
import { BTW_USAGE, answerKey, btwOf, callWords, cardGroups, chosen, DONE_SHOWN, draftOn, effortChoices, enhanceWords, GEAR_PATHS, launchBody, limitStop, lineParts, lineStop, mayChoices, needsYou, NO_COPY_YET, noPatchWhy, ownGearPaths, rowIcon, seatsFrom, seatsLine, seesChoices, shortcutsOf, SIDE_EFFORTS, sideBadge, sideGroups, sideRow, teamLine, watchRows, whoTag } from "../src/ui/harness/lib/side.js";
import { cardIcon } from "../src/ui/harness/lib/agent-cards.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { SUBAGENT_EFFORTS } from "../src/core/schema.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamIO, modelSelects } from "./helpers/team-view.js";
import { agentRow, CARDS, FACTS, guestRowOf, menuRow, menuRows, NOW, sideIO, sideSeams, STARTS } from "./helpers/side-view.js";
import "./helpers/teams-on-page.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => byClass(n, cls)[0];
/** A button under a node by its words. @param {any} n @param {string} words @returns {any} */
const buttonSaying = (n, words) => buttonsOf(n).find((b) => textOf(b).replace(/\|/g, " ").trim() === words);
/** A new thread's shortcut by its name. @param {any} n @param {string} name @returns {any} */
const shortcut = (n, name) => byClass(n, "sd-short").find((b) => textOf(one(b, "sd-short-name")) === name);
/** Promises settled. */
const settled = () => new Promise((r) => setImmediate(r));

/** A card by its tag. @param {string} tag @returns {any} */
const card = (tag) => CARDS.find((c) => c.tag === tag);
/** A shortcut's row. @param {string} id @returns {any} */
const start = (id) => STARTS.find((s) => s.id === id);
/** A thread about to begin on a shortcut, with the person's own changes. @param {string} id @param {Record<string, any>} [change] @param {any} [facts] */
const onShortcut = (id, change = {}, facts = FACTS) => chosen({ ...draftOn(id, start(id).worker), ...change }, card(start(id).worker), start(id), facts);
/** One begun on a card alone. @param {string} tag @param {Record<string, any>} [change] @param {any} [facts] */
const onCard = (tag, change = {}, facts = FACTS) => chosen({ ...draftOn(null, tag), ...change }, card(tag), null, facts);

describe("Side: a new thread's model", () => {
  // (fails before: yes — HarnessV4_Tasks U12-D6: Catch me up was no tile of the tab; it was offered over the chat's box
  // alone. Then the owner's word of 10-18: its tile launched on one press; now it brings its question, to send or change)
  test("the starts are the server's rows as tiles, each saying the card it runs as; Catch me up brings its own question; one whose card is gone is left out", () => {
    assert.deepEqual(shortcutsOf(STARTS, CARDS), [
      { id: "ask", name: "Ask", tag: "builder", sub: "Builder, read only", task: "" },
      { id: "job", name: "Try it in a copy", tag: "builder", sub: "Builder", task: "" },
      { id: "review", name: "Review my last change", tag: "reviewer", sub: "Reviewer, with the last change", task: "" },
      { id: "catchup", name: "Catch me up", tag: "builder", sub: "Builder, read only, since your last message", task: "Catch me up." },
    ]);
    assert.deepEqual(shortcutsOf(STARTS, CARDS.filter((c) => c.tag !== "reviewer")).map((s) => s.id), ["ask", "job", "catchup"]);
    assert.deepEqual(shortcutsOf([], CARDS), [], "the table not read yet: no tile, and the view looks again");
  });

  // (fails before: yes — U12-D7: the choices were a sentence over the box, and no choice said how hard the agent thinks)
  test("the chips under the box: who, what they see with its size, what they may do, where the answer goes, the model, the effort, More", () => {
    assert.deepEqual(lineParts(onShortcut("ask"), FACTS), { who: "Builder", sees: "Sees this session and the running turn · 26k tokens", may: "Read only", answer: "Answer stays with you", model: "GLM-5.3", effort: "Max", more: "More" });
    assert.deepEqual(lineParts(onShortcut("job"), FACTS), { who: "Builder", sees: "Sees this session and the running turn · 26k tokens", may: "Edits in its own copy", answer: "Answer stays with you", model: "GLM-5.3", effort: "Max", more: "More" });
    assert.equal(lineParts(onShortcut("review"), FACTS).sees, "Your words alone, with the last turn's change");
    const idle = { ...FACTS, turnRuns: false };
    assert.equal(lineParts(onShortcut("ask", {}, idle), idle).sees, "Sees this session · 24k tokens", "no turn runs: nothing is said of one (case 20)");
    assert.equal(lineParts(onShortcut("ask", { view: "none", running: false }), FACTS).sees, "Your words alone");
    assert.equal(lineParts(onShortcut("ask", { view: "none" }), FACTS).sees, "Your words and the running turn · 2.2k tokens");
    assert.equal(lineParts(onShortcut("ask", { view: "fork" }), FACTS).sees, "A live copy of your agent · 80k tokens");
    assert.equal(lineParts(onShortcut("ask", {}, { ...FACTS, tokens: null }), { ...FACTS, tokens: null }).sees, "Sees this session and the running turn · 2.2k tokens", "the sizes not read yet: only what is known is counted");
    assert.equal(lineParts(onShortcut("job", { folder: true }), FACTS).may, "Edits in the session's folder");
    const sent = onShortcut("ask", { deliver: true, pause: true, inform: true });
    assert.deepEqual([lineParts(sent, FACTS).answer, lineParts(sent, FACTS).more], ["Answer goes to your agent", "More · 2"]);
    assert.deepEqual([onShortcut("ask", { effort: "xhigh" }), onShortcut("ask", { effort: "model" }), onShortcut("ask", { view: "fork", effort: "low" })].map((c) => lineParts(c, FACTS).effort), ["Extra high", "The model's own", "Your agent's effort"]);
  });

  // (fails before: yes — U12-D7: a thread from the tab could not name an effort; the launch route took none)
  test("the effort: the main agent's by default, and a team's crew its lead's; one picked is named in the launch; a live copy thinks as the main agent's request", () => {
    const plain = onShortcut("ask");
    assert.deepEqual([plain.effort, plain.effortPicked], ["max", false]);
    assert.equal(onShortcut("ask", {}, { ...FACTS, defaultEffort: "medium" }).effort, "medium", "the session's own effort for the agents it launches");
    const high = onShortcut("ask", { effort: "high" });
    assert.deepEqual([high.effort, high.effortPicked, launchBody(high, "x").effort], ["high", true, "high"]);
    assert.equal("effort" in launchBody(plain, "x"), false, "none picked: the main agent's, the server's to read");
    const fork = onShortcut("ask", { view: "fork", effort: "high" });
    assert.deepEqual([fork.effort, fork.effortPicked, "effort" in launchBody(fork, "x")], ["", false, false]);
    assert.deepEqual(effortChoices(plain, FACTS).map((x) => [x.id, x.name, x.on]),
      [["", "The default: Max", true], ["model", "The model's own", false], ["low", "Low", false], ["medium", "Medium", false], ["high", "High", false], ["xhigh", "Extra high", false], ["max", "Max", false]]);
    assert.deepEqual(effortChoices(high, { ...FACTS, defaultEffort: "low" }).filter((x) => x.on).map((x) => x.id), ["high"]);
    assert.equal(effortChoices(plain, { ...FACTS, defaultEffort: "low" })[0].name, "The default: Low");
    // (fails before: yes — the review of 11-05: a team's crew with no pick of its own was said at the main agent's
    // effort, where it runs at its lead's)
    const T = { key: "hunters", name: "Hunters", members: [{ name: "Hunter" }, { name: "Checker" }] };
    const line = (/** @type {any} */ picks) => teamLine(/** @type {any} */ ({ team: T, on: { lead: "m-1", workers: ["m-2"] }, picks, seats: [] }));
    // (the review of 11-05 again: as its lead runs, which its model may take otherwise than picked — so no level named)
    assert.match(line({ effort: "high" }), /its workers on [^,]+, as hard as its lead · /, "its lead's");
    assert.match(line({ effort: "high", workersEffort: "max" }), /its workers on [^,]+, max · /, "its own");
    assert.match(line(null), /its workers on [^,]+, as hard as its lead · /, "the main agent's, as its lead's");
    // (fails before: yes — the review of 0376f5a4f: a crew with nothing named was said on this chat's model, where it
    // runs on each card's, else this chat's list, else beside it its lead's)
    const bare = (/** @type {any} */ on, /** @type {string[]} */ seats = []) => teamLine(/** @type {any} */ ({ team: T, on, picks: null, seats }));
    assert.ok(bare({ lead: "m-1", workers: null, from: "seats" }).includes(`its workers on each card's, else ${prettyModel("m-1")}, as hard`), bare({ lead: "m-1", workers: null, from: "seats" }));
    assert.ok(bare({ lead: "m-1", workers: ["m-2", "m-3"], from: "chat" }).includes(`its workers on each card's, else ${prettyModel("m-2")} (then 1 more), as hard`));
    assert.ok(bare({ lead: "m-1", workers: ["m-2"], from: "team" }).includes(`its workers on ${prettyModel("m-2")}, as hard`));
    assert.deepEqual([...SIDE_EFFORTS], [...SUBAGENT_EFFORTS], "the page offers the levels a launch takes");
  });

  // (fails before: yes — the owner's word of 10-18, a press never starts an agent: Catch me up launched by its start
  // alone. Sent from the box, its start goes by name beside the chips, so the server keeps what no chip says)
  test("Catch me up sent from the box: its start goes by name, and the chips say it sees since your last message, with no size", () => {
    const c = onShortcut("catchup");
    assert.deepEqual([c.start, c.since, c.view, c.level], ["catchup", true, "folded", "read"]);
    assert.equal(lineParts(c, FACTS).sees, "Sees this session since your last message and the running turn", "a size is the whole view's: the part since your last message is smaller, by how much nothing here knows");
    // What it sees is the server's to pick at Send where nothing is picked (the owner's of 11-05): no view goes.
    assert.deepEqual(launchBody(c, "Catch me up."), { prompt: "Catch me up.", as: "builder", start: "catchup", may: "read", running: true, changes: "", deliver: false, pause: false, inform: false });
    const none = onShortcut("catchup", { view: "none" });
    assert.deepEqual([none.start, none.since, lineParts(none, FACTS).sees], ["catchup", false, "Your words and the running turn · 2.2k tokens"], "nothing of the session: nothing to cut at your last message");
    assert.equal(launchBody(none, "x").view, "none", "a view the person picked goes by name");
    const fork = onShortcut("catchup", { view: "fork" });
    assert.deepEqual([fork.since, lineParts(fork, FACTS).sees], [false, "A live copy of your agent · 80k tokens"]);
    // (fails before: yes — the owner's of 11-05: Catch me up read the session folded, its card's model and effort,
    // whatever the main agent's cache held)
    const warm = { ...FACTS, warm: true };
    const live = onShortcut("catchup", {}, warm);
    assert.deepEqual([live.view, live.fork, live.since, live.model, live.effort], ["fork", true, false, "claude-sonnet-5-5", ""], "the cache warm: a live copy, on the main agent's model and effort");
    assert.deepEqual([lineParts(live, warm).sees, lineParts(live, warm).effort, "view" in launchBody(live, "x")], ["A live copy of your agent · 80k tokens", "Your agent's effort", false]);
    const chose = onShortcut("catchup", { effort: "low" }, warm);
    assert.deepEqual([chose.view, launchBody(chose, "x").view], ["folded", "folded"], "an effort picked: as its start says, by name");
    const ask = onShortcut("ask");
    assert.deepEqual([ask.start, ask.since, "start" in launchBody(ask, "x")], [null, false, false], "a start that brings no question goes as its chips alone");
  });

  // (fails before: yes — the popover's launch named a worker and a start; a lead could not be given a job from it)
  test("what the person changes stays under what the card may do; any agent may be a live copy; the model is theirs, the card's, else the session's pool's", () => {
    const review = onShortcut("review", { may: "edit" });
    assert.deepEqual([review.level, review.top], ["read", "read"], "Reviewer only reads, whatever was asked");
    assert.deepEqual([onShortcut("ask").level, onShortcut("ask", { may: "edit" }).level, onShortcut("ask", { may: "copy" }).level], ["read", "edit", "copy"]);
    assert.deepEqual([onCard("enduser").level, onCard("enduser", { may: "edit" }).level], ["copy", "copy"]);
    const pm = onCard("product");
    assert.deepEqual([pm.view, pm.running, pm.model, pm.picked], ["folded", true, "glm-5.3", false], "the card's own choices where no shortcut is named");
    // (fails before: yes — OA1: an agent asked for its view never began as a copy of the main agent)
    assert.deepEqual([onCard("product", { view: "fork" }).view, onCard("product", { view: "fork" }).fork], ["fork", true], "one kind of agent: any may start as a live copy");
    const helper = onCard("builder");
    assert.deepEqual([helper.view, helper.level], ["none", "edit"], "a worker sees its task alone unless it is handed more");
    assert.equal(onCard("builder", { view: "folded" }).view, "folded");
    const fork = onShortcut("ask", { view: "fork", model: "glm-5.3" });
    assert.deepEqual([fork.fork, fork.model, fork.picked], [true, "claude-sonnet-5-5", false], "a live copy runs on the main agent's model, whatever was picked");
    const picked = onShortcut("ask", { model: "claude-haiku-5-5" });
    assert.deepEqual([picked.model, picked.picked], ["claude-haiku-5-5", true]);
    const folder = onShortcut("ask", { folder: true });
    assert.deepEqual([folder.folder, folder.level], [true, "edit"], "in the session's folder it edits, whatever the shortcut's lower level");
    assert.equal(onShortcut("review", { folder: true }).folder, false, "a card that only reads is never given the folder");
    const alone = onShortcut("ask", { pause: true, inform: true });
    assert.deepEqual([alone.pause, alone.inform], [false, false], "the main agent waits for, and hears of, only an answer that goes to it");
    assert.equal(onShortcut("ask", { deliver: true, pause: true }, { ...FACTS, turnRuns: false }).pause, false, "no turn runs: there is nothing to hold");
  });

  // (fails before: yes — a thread from Side sends no `start`: the server refuses a start beside an agent named by tag)
  test("the launch is one agent asked by its tag, every choice of the line named", () => {
    assert.deepEqual(launchBody(onShortcut("ask"), "what is it doing?"), { prompt: "what is it doing?", as: "builder", may: "read", view: "folded", running: true, changes: "", deliver: false, pause: false, inform: false });
    assert.deepEqual(launchBody(onShortcut("job"), "fix the typo"), { prompt: "fix the typo", as: "builder", may: "edit", view: "folded", running: true, changes: "", worktree: true, deliver: false, pause: false, inform: false });
    assert.deepEqual(launchBody(onShortcut("review"), "did it?"), { prompt: "did it?", as: "reviewer", may: "read", view: "none", running: false, changes: "turn", deliver: false, pause: false, inform: false });
    assert.equal(launchBody(onShortcut("ask", {}, { ...FACTS, turnRuns: false }), "x").running, false, "no turn runs: none is asked for, so the thread never says it saw one");
    assert.equal(launchBody(onShortcut("review", { changes: null }), "x").changes, "", "no change, said: the card's own is not handed over");
    assert.equal(launchBody(onShortcut("review", { changes: "since:v1.2" }), "x").changes, "since:v1.2");
    assert.equal(launchBody(onShortcut("job", { folder: true }), "x").worktree, false);
    assert.equal("model" in launchBody(onShortcut("ask"), "x"), false, "no model picked: the card's, else a seat of the session's pool, is the server's to read");
    assert.equal(launchBody(onShortcut("ask", { model: "claude-haiku-5-5" }), "x").model, "claude-haiku-5-5");
    const whole = launchBody(onShortcut("ask", { deliver: true, pause: true, inform: true }), "x", { title: "The auth check", images: [{ name: "a.png", mediaType: "image/png", data: "AAAA" }] });
    assert.deepEqual([whole.description, whole.images, whole.deliver, whole.pause, whole.inform], ["The auth check", [{ name: "a.png", mediaType: "image/png", data: "AAAA" }], true, true, true]);
    // Memory's brief opens every sub-agent's task while the chat's memory is on: the launch names no switch for it (the
    // owner's of 11-09, "memory system is core").
    assert.equal("start" in whole || "worker" in whole || "memory" in whole, false);
  });

  // (fails before: yes — U13 W3: Start… had no Ask or Give a job; OA1: two ways, and asked, an agent read only)
  test("one kind of agent: no Ask or Give a job — each card at its own level, which its start or the May chip may lower; the launch names its level and no verb", () => {
    assert.deepEqual([onShortcut("ask"), onShortcut("job"), onCard("builder"), onCard("product")].map((c) => "verb" in c), [false, false, false, false]);
    assert.deepEqual([onShortcut("ask").level, onShortcut("job").level, onCard("builder").level, onCard("product").level, onCard("enduser").level], ["read", "edit", "edit", "read", "copy"], "a start's level, else the card's");
    assert.deepEqual([onShortcut("job", { may: "read" }).level, onShortcut("ask", { may: "edit" }).level], ["read", "edit"], "lowered or put back up to the card's, never past it");
    assert.equal(onShortcut("ask", { view: "fork" }).fork, true, "as the Ask start always could");
    assert.deepEqual([launchBody(onShortcut("ask"), "x"), launchBody(onCard("product"), "x")].map((b) => ["verb" in b, b.may]), [[false, "read"], [false, "read"]]);
  });

  // (fails before: yes — a fifth launch was a toast after the send; nothing said so before it)
  test("why a thread does not go yet: the session's limit in its own numbers, nothing to copy, no model", () => {
    assert.equal(lineStop(onShortcut("ask"), FACTS), null);
    assert.equal(lineStop(onShortcut("ask"), { ...FACTS, limit: { max: 4, running: 4 } }), "4 of 4 agents are running on this chat's models, each at its limit: wait for one to finish");
    assert.equal(lineStop(onShortcut("ask"), { ...FACTS, limit: { max: 1, running: 1 } }), "1 of 1 agent is running on this chat's models, each at its limit: wait for one to finish");
    assert.equal(lineStop(onShortcut("ask", { view: "fork" }, { ...FACTS, forkable: false }), { ...FACTS, forkable: false }), NO_COPY_YET);
    const none = { ...FACTS, defaultModel: "" };
    assert.equal(lineStop(onShortcut("ask", {}, none), none), "No model to run it on: pick one");
  });

  // (fails before: yes — Review after a turn that changed nothing said "with the last turn's change", and no more)
  test("a change is chosen and there is none: said before the send, with the other source where that one holds a change", () => {
    assert.equal(noPatchWhy(onShortcut("review"), FACTS), null, "three files go with it");
    assert.equal(noPatchWhy(onShortcut("ask"), FACTS), null, "no change is chosen");
    assert.equal(noPatchWhy(onShortcut("review"), { ...FACTS, patches: null }), null, "not read yet: nothing is said");
    assert.deepEqual(noPatchWhy(onShortcut("review", { changes: "uncommitted" }), FACTS),
      { words: "No change goes with it: the folder is no git repository.", other: { id: "turn", name: "Hand it the last turn's change, 3 files" } });
    const quiet = { ...FACTS, patches: { turn: { tokens: 0, files: 0 }, uncommitted: { tokens: 300, files: 1 } } };
    assert.deepEqual(noPatchWhy(onShortcut("review", {}, quiet), quiet), { words: "No change goes with it: nothing changed.", other: { id: "uncommitted", name: "Hand it everything uncommitted, 1 file" } });
    const none = { ...FACTS, patches: { turn: { tokens: 0, files: 0, note: "turn 4 wrote nothing" }, uncommitted: { tokens: 0, files: 0 } } };
    assert.deepEqual(noPatchWhy(onShortcut("review", {}, none), none), { words: "No change goes with it: turn 4 wrote nothing.", other: null });
    assert.equal(noPatchWhy(onShortcut("review", { changes: "since:v1.2" }), none), null, "a range's size is not read here");
  });

  // (fails before: yes — the popover's view control named no change, and offered a read-only switch alone)
  test("the menus' choices: each size, the running turn only while one runs, a change from each source; the levels up to the card's", () => {
    const s = seesChoices(onShortcut("ask"), FACTS);
    assert.deepEqual(s.views.map((v) => [v.name, v.on, v.off]), [["Nothing", false, null], ["Folded", true, null], ["Context window", false, null], ["A live copy", false, null]]);
    assert.match(s.views[2].line, / · ~61k tokens$/);
    assert.deepEqual(s.running, { on: true, line: "7 rounds so far · +2.2k" });
    assert.deepEqual(s.changes.map((c) => [c.id, c.name, c.line, c.on]), [
      ["", "No change", "", true],
      ["running", "What this turn changed so far", "up to its last finished round", false],
      ["turn", "The last turn's change", "3 files · ~1.2k tokens", false],
      ["uncommitted", "Everything uncommitted", "the folder is no git repository", false],
    ]);
    const idle = { ...FACTS, turnRuns: false, forkable: false };
    const quiet = seesChoices(onShortcut("ask", {}, idle), idle);
    assert.deepEqual([quiet.running, quiet.changes.map((c) => c.id), quiet.views.at(-1)?.off], [null, ["", "turn", "uncommitted"], NO_COPY_YET]);
    assert.deepEqual(seesChoices(onCard("product"), FACTS).views.map((v) => v.id), ["none", "folded", "window", "fork"], "any agent is offered a live copy (OA1)");
    // (fails before: yes — there was no context window) It holds the running turn: no box offers it again.
    assert.equal(seesChoices(onShortcut("ask", { view: "window" }), FACTS).running, null);
    assert.equal(seesChoices(onShortcut("review", { changes: "since:v1.2" }), FACTS).since, "v1.2");

    // (fails before: yes — OA1: asked, an agent read only, and May offered nothing more) The levels up to the card's,
    // whoever it is.
    assert.deepEqual(mayChoices(onShortcut("ask")).choices.map((c) => [c.id, c.on]), [["read", true], ["copy", false], ["edit", false], ["folder", false]]);
    assert.equal(mayChoices(onShortcut("ask")).note, null);
    assert.deepEqual(mayChoices(onShortcut("job", { folder: true })).choices.map((c) => [c.id, c.on]), [["read", false], ["copy", false], ["edit", false], ["folder", true]]);
    assert.deepEqual(mayChoices(onCard("product")), { choices: [{ id: "read", name: "Read only: it changes nothing", line: "", on: true }], note: "Product only reads, as its card says" }, "its card's level is the one limit");
    assert.deepEqual([mayChoices(onCard("enduser")).choices.map((c) => c.id), mayChoices(onCard("enduser")).note], [["read", "copy", "folder"], "End user keeps nothing, as its card says"]);
  });

  // (fails before: yes — Enhance's tooltip in the popover said "view" and "fork", words the tab does not use)
  test("Enhance says what it will read, by how warm the main agent's cache is", () => {
    assert.match(enhanceWords(/** @type {any} */ ({ state: "warm", running: true, leftMs: 0, tokens: 0 })), /a copy of its running turn/);
    assert.match(enhanceWords(/** @type {any} */ ({ state: "warm", running: false, leftMs: 245_000, tokens: 41_000 })), /stays warm for 4:05, ~41k tokens read at the cache's price$/);
    assert.match(enhanceWords(/** @type {any} */ ({ state: "cold", running: false, leftMs: 0, tokens: 0 })), /its model reads the session anew$/);
  });
});

describe("Side: the list, the badge and the strip", () => {
  const mine = agentRow("s1");
  const working = agentRow("s2", { status: "running", exchanges: [{ description: "Fix the typo", startedAt: NOW - 6000, endedAt: null }], progress: { spent: 0.004 } });
  const asked = agentRow("s3", { origin: "agent", card: { tag: "product", name: "Product" }, exchanges: [{ description: "Queue or fail?", startedAt: NOW - 90_000, endedAt: NOW - 80_000, spentUsd: 0.01, delivery: "auto" }] });
  const older = agentRow("s0", { exchanges: [{ description: "Old", startedAt: NOW - 900_000, endedAt: NOW - 890_000, delivery: "held" }] });

  // (fails before: yes — HarnessV4_Tasks U12-D3: the list was grouped by who called, so an agent that asked you stood
  // among those that worked on)
  test("the groups are what each needs of you: Needs you, Working, Done; running first, then newest; an empty group is left out", () => {
    const groups = sideGroups([older, asked, mine, working], [guestRowOf("g1", { status: "running" })]);
    assert.deepEqual(groups.map((g) => [g.id, g.title, g.rows.map((r) => r.id)]), [["works", "Working", ["s2", "run_1~g1"]], ["done", "Done", ["s1", "s3", "s0"]]]);
    const asks = agentRow("s5", { status: "running", exchanges: [{ description: "Run it", startedAt: NOW - 1000, endedAt: null }], progress: { asking: { tool: "bash", args: "npm test" } } });
    const ready = agentRow("s6", { work: { pending: 2 } });
    const toLead = agentRow("s7", { status: "running", team: { name: "Architect", role: "builder" }, progress: { asking: { to: "lead", n: 1, question: "Queue or fail?" } } });
    assert.deepEqual(sideGroups([mine, ready, toLead, asks]).map((g) => [g.id, g.title, g.rows.map((r) => r.id)]),
      [["needs", "Needs you", ["s5", "s6"]], ["works", "Working", ["s7"]], ["done", "Done", ["s1"]]], "a worker's question to its lead is its lead's");
    assert.deepEqual([needsYou(asks), needsYou(ready), needsYou(toLead), needsYou(mine), needsYou(guestRowOf("g2", { status: "running" }))], [true, true, false, false, false]);
    assert.deepEqual(sideGroups([asked]).map((g) => g.title), ["Done"]);
    assert.deepEqual(sideGroups([]), []);
  });

  // (fails before: yes — U12-D2: who started a thread was its group's title, and a team's worker had no place in the tab)
  test("a row's tag says who started it, and its glyph is its card's, a team's worker its member's", () => {
    assert.deepEqual([mine, asked, agentRow("s8", { origin: "self" }), agentRow("s9", { task: "t3", origin: "agent" })].map(whoTag), ["yours", "your agent", "by itself", "task t3"]);
    // (fails before: yes — U13 revised: one your agent sent on a card you named said "main agent", as any other)
    assert.equal(whoTag(agentRow("s7", { origin: "agent", heard: true })), "your agent — you named it");
    assert.deepEqual([agentRow("w1", { team: { name: "Architect", role: "builder" } }), agentRow("w2", { team: { name: "Architect team", role: "builder" } })].map(whoTag), ["Architect team", "Architect team"]);
    assert.equal(whoTag(guestRowOf("g1")), "Claude Code's own");
    assert.deepEqual([rowIcon(mine), rowIcon(asked), rowIcon(guestRowOf("g1"))], ["hammer", "goal", "bot"]);
    assert.equal(rowIcon(agentRow("w1", { team: { name: "Architect", role: "builder", place: "builder" }, card: { tag: "builder", name: "Builder" } })), "hammer");
    assert.deepEqual([cardIcon({ tag: "mine" }), cardIcon({ tag: "mine", from: "reviewer" })], ["bot", "eye"], "a card of the person's own: the bot, a copy its original's (OA1: no kind to wear)");
  });

  // (fails before: yes — U12-D3: a working row said "working" alone, an asking one "asks you", one with changes "Apply 2 files")
  test("a row says the one fact that matters now — what it asks, the call it is in, what waits — and on the right what it cost and how long", () => {
    assert.deepEqual(sideRow(mine, NOW), { name: "Builder", task: "Job s1", fact: "answered", tone: "ok", right: "$0.020 · 6s" });
    assert.deepEqual(sideRow(working, NOW), { name: "Builder", task: "Fix the typo", fact: "working", tone: "works", right: "$0.004 · 6s" });
    assert.deepEqual([sideRow(asked, NOW).name, sideRow(asked, NOW).fact], ["Product", "sent"]);
    /** @param {Record<string, any>} over */
    const fact = (over) => { const w = sideRow(agentRow("x", over), NOW); return [w.fact, w.tone]; };
    assert.deepEqual(fact({ status: "running", progress: { asking: { tool: "bash", args: "npm test" } } }), ["wants to run npm test", "asks"]);
    assert.deepEqual(fact({ status: "running", progress: { asking: { tool: "edit", args: "{}", changes: [{ file: "src/a.js" }] } } }), ["wants to edit src/a.js", "asks"]);
    assert.deepEqual(fact({ status: "running", progress: { tool: { name: "read", args: "src/core/pool.js\nmore" } } }), ["read src/core/pool.js", "works"]);
    assert.deepEqual(fact({ status: "running", progress: { asking: { to: "lead", n: 1, question: "?" } } }), ["asks its lead", "works"]);
    assert.deepEqual(fact({ status: "failed" }), ["failed", "error"]);
    assert.deepEqual(fact({ status: "aborted" }), ["cut off", "error"]);
    assert.deepEqual(fact({ work: { pending: 2 } }), ["2 files to apply", "apply"]);
    assert.deepEqual(fact({ work: { pending: 1 } }), ["1 file to apply", "apply"]);
    assert.deepEqual(fact({ status: "stopped" }), ["stopped", "warn"]);
    assert.deepEqual(fact({ status: "failed", work: { pending: 2 } }), ["failed", "error"], "a failure is said before what waits");
    assert.deepEqual([callWords({ name: "bash", args: "x".repeat(200) }).length, callWords(null)], [60, ""]);
  });

  // (fails before: yes — U12-D5: how many agents ran and how many seats were free was said nowhere in the tab; the
  // owner's 10-25: "1 in use · 7 free" said nothing of what it counted)
  test("a list's seats in a line: this chat's agents at work on it and the room for more, none, or no model that can run", () => {
    assert.deepEqual(seatsLine({ max: 8, running: 2 }), { words: "2 at work · room for 6 more", share: 0.25, full: false });
    assert.deepEqual(seatsLine({ max: 8, running: 8 }), { words: "8 at work · no room for more", share: 1, full: true });
    assert.deepEqual(seatsLine({ max: 0, running: 0 }), { words: "None of its models can run now", share: 0, full: true });
    assert.deepEqual(seatsLine({ max: 0, running: 1 }), { words: "1 at work · no room for more", share: 1, full: true });
    assert.equal(seatsLine(null), null, "not read yet: no meter");
    // (fails before: yes — the owner's word of 11-05: with no limit set on its models, a meter of Infinity) No limit:
    // how many are at work, and no meter.
    assert.deepEqual([seatsLine({ max: null, running: 3 }), seatsLine({ max: null, running: 0 })], [{ words: "3 at work", share: null, full: false }, { words: "None at work", share: null, full: false }]);
    // Whose list it is: the chat's own, else none — no other layer holds one (the owner's plan of 11-05).
    assert.deepEqual(["session", "global", "default"].map((s) => { const f = seatsFrom(s); return [f.tag, `${f.lead}${f.tail}`, f.own]; }), [
      ["This chat", "This chat's own list", true],
      ["Default", "None set: its agents run on this chat's model, as its main agent does", false],
      ["Default", "None set: its agents run on this chat's model, as its main agent does", false],
    ]);
    assert.deepEqual([limitStop(FACTS), limitStop({ ...FACTS, limit: { max: 4, running: 4 } }), limitStop({ ...FACTS, limit: null }), limitStop({ ...FACTS, limit: { max: null, running: 40 } })], [null, "4 of 4 agents are running on this chat's models, each at its limit: wait for one to finish", null, null]);
  });

  // (fails before: yes — U12-D6: the saved agents were one flat list under "Another agent"; OA1: Doers, Advisors and a
  // team's lead, three groups of one kind of thing; the design pass of 10-24 grouped them again, which the owner's word of 10-24: "I liked the previous design better where everything was just an Agent and Teams just referenced those agents")
  // (the owner's word of 11-05: those that ran by themselves, apart under On their own, went)
  test("the @ menu lists the saved agents as one list", () => {
    const cards = [...CARDS, { ...card("product"), tag: "arch", name: "Architect" }, { ...card("enduser"), tag: "idle", name: "Idle" }];
    assert.deepEqual(cardGroups(/** @type {any} */ (cards)).map((g) => [g.id, g.title, g.cards.map((c) => c.tag)]),
      [["agents", "Agents", ["builder", "reviewer", "enduser", "product", "arch", "idle"]]]);
    assert.deepEqual(cardGroups(CARDS.filter((c) => c.tag === "builder")).map((g) => g.title), ["Agents"], "a group with nobody in it is left out");
  });

  // (fails before: yes — nothing outside the popover said an agent of yours had answered)
  test("the tab's badge: orange while an agent of yours asks, blue while one works, else the answers you have not opened (AG-107)", () => {
    const watch = { live: new Set(), opened: new Set() };
    watchRows([mine, asked], watch);
    assert.equal(sideBadge([mine, asked], watch), null, "after a reload nothing is unread: the page saw none of them at work");
    watchRows([working, asked], watch);
    assert.deepEqual(sideBadge([working, asked], watch), { dot: "works", words: "1 working" });
    const asking = { ...working, progress: { asking: { tool: "bash", args: "npm test" } } };
    assert.deepEqual(sideBadge([asking], watch), { dot: "asks", words: "an agent asks you" });
    const done = { ...working, status: "done", exchanges: [{ ...working.exchanges[0], endedAt: NOW }] };
    assert.deepEqual(sideBadge([done, asked], watch), { text: "1", words: "1 answer you have not opened" });
    watch.opened.add(answerKey(done));
    assert.equal(sideBadge([done, asked], watch), null);
    const theirs = { ...asked, status: "running" };
    watchRows([theirs], watch);
    assert.equal(sideBadge([theirs], watch), null, "an agent the main agent called is the Team tab's to count");
    const again = { ...done, status: "running", exchanges: [...done.exchanges, { description: "And?", startedAt: NOW, endedAt: null }] };
    watchRows([again], watch);
    const answered = { ...again, status: "done" };
    assert.deepEqual(sideBadge([answered], watch)?.text, "1", "asked again: its new answer is unread though the first was opened");
  });

});

describe("Side: the words held for an agent still at work (AG-101)", () => {
  /** A held-asks store on a hand-driven feed. @param {(chainId: string, id: string, text: string) => Promise<unknown>} send */
  const heldOn = (send) => {
    /** @type {((msg: any) => void)[]} */
    const hear = [];
    const held = createHeldAsks({ send, bus: (fn) => { hear.push(fn); } });
    return { held, say: (/** @type {any} */ msg) => { for (const fn of hear) fn(msg); } };
  };

  // (fails before: yes — while its agent worked a thread's box was off: what you meant to say next was yours to remember)
  test("held, added to, and sent once the feed says it answered — whichever view shows", async () => {
    /** @type {any[][]} */
    const sent = [];
    const { held, say } = heldOn(async (chainId, id, text) => { sent.push([chainId, id, text]); });
    let changes = 0;
    const off = held.onChange(() => { changes += 1; });
    held.hold("c1", "s1", "  and the tests?  ");
    held.hold("c1", "s1", "also the docs");
    held.hold("c1", "s1", "   ");
    assert.deepEqual([held.of("c1", "s1"), held.of("c1", "s2"), held.of("c2", "s1"), changes], [{ text: "and the tests?\n\nalso the docs", error: null }, null, null, 2]);
    say({ type: "subagent", chainId: "c1", id: "s1", status: "running" });
    say({ type: "subagent", chainId: "c1", id: "s2", status: "done" });
    assert.deepEqual(sent, [], "it still works; another's end is not its own");
    say({ type: "subagent", chainId: "c1", id: "s1", status: "done" });
    say({ type: "subagent", chainId: "c1", id: "s1", status: "done" });
    await settled();
    assert.deepEqual([sent, held.of("c1", "s1")], [[["c1", "s1", "and the tests?\n\nalso the docs"]], null], "one send, as its next message");
    off();
    const before = changes;
    held.hold("c1", "s1", "x");
    assert.equal(changes, before, "an unsubscribed listener hears nothing");
  });

  // (fails before: yes — there were no held words to lose)
  test("a refused send keeps the words, ahead of what was written meanwhile, with why; Take back gives them to the box", async () => {
    /** @type {((e?: any) => void)[]} */
    const answer = [];
    let refuse = true;
    const { held } = heldOn(() => new Promise((ok, no) => { answer.push(() => (refuse ? no(new Error("it does a task of the graph")) : ok(null))); }));
    held.hold("c1", "s1", "first");
    void held.settled("c1", "s1");
    void held.settled("c1", "s1");
    assert.deepEqual([answer.length, held.of("c1", "s1")], [1, null], "on its way: once");
    held.hold("c1", "s1", "second");
    answer[0]();
    await settled();
    assert.deepEqual(held.of("c1", "s1"), { text: "first\n\nsecond", error: "it does a task of the graph" });
    assert.equal(held.take("c1", "s1"), "first\n\nsecond");
    assert.deepEqual([held.of("c1", "s1"), held.take("c1", "s1")], [null, ""]);
    refuse = false;
    held.hold("c1", "s1", "third");
    void held.settled("c1", "s1");
    answer[1]();
    await settled();
    assert.equal(held.of("c1", "s1"), null);
  });

  // (fails before: yes — a thread the main agent asked hid its box and said nothing; a graph task's box was refused on send)
  test("a thread that is not yours to continue says why, and how to ask that agent yourself (AG-105)", () => {
    assert.equal(noBoxWhy(agentRow("s1")), null);
    assert.equal(noBoxWhy(agentRow("s1", { asked: false })), null);
    assert.deepEqual(noBoxWhy(agentRow("s3", { origin: "agent", card: { tag: "product", name: "Product" } })), { words: "The main agent asked this, and asks Product again by itself. To ask Product yourself, open a new thread:", ask: "product" });
    assert.deepEqual(noBoxWhy(agentRow("s4", { asked: false, origin: "agent", task: "t2" })), { words: "It does task t2 of the task graph, and its report ends it. To try the task again, send it back from the Plan tab." });
  });

  // (fails before: yes — the thread part took no held words and its foot was the box alone)
  // (the transcript audit, 2026-10-23: words reach a working agent now; held are those its run could not take then)
  test("the thread part holds what its working agent's run could not take, sends it when it answers, and draws the lines over its box", () => {
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.match(viewer, /export function subagentConversation\(\{ chainId, id, toast, main, held = null, onAskSelf = null, answer = null, always = null \}\) \{/);
    assert.match(viewer, /const why = String\(\/\*\* @type \{any\} \*\/ \(e\)\?\.message \|\| e\);\n\s*if \(held && running\(\)\) \{\n\s*held\.hold\(chainId, id, text\);\n\s*input\.value = "";/);
    assert.match(viewer, /if \(sa\.status !== "running"\) void held\?\.settled\(chainId, id\);/);
    assert.match(viewer, /input\.disabled = sending;\n\s*send\.toggleAttribute\("disabled", sending\);/, "the box takes words while it works");
    assert.match(viewer, /const foot = h\("div", \{ class: "sav-foot-box" \}, askEl, heldEl, whyEl, box\);/);
    assert.match(viewer, /kept\.error \? `not sent: \$\{kept\.error\}` : `goes when \$\{name\} answers`/);
    assert.match(viewer, /const no = tells\(\) \? null : noBoxWhy\(sa\);\n\s*foot\.classList\.remove\("hidden"\);\n\s*box\.classList\.toggle\("hidden", !!no\);/);
    assert.match(viewer, /offHeld\(\);/, "let go with the thread");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /const heldAsks = createHeldAsks\(\);/);
    assert.match(app, /\bpane = renderThreadPane\(body, \{ chainId: subagentStore\.chainId\(\), id, toast, main: mainDoor, held: heldAsks, onAskSelf: \(tag\) => views\.side\.fresh\(tag\), head, onOpen: \(\) => views\.side\.open\(id\), answer: \(aid, words\) => answerWorker\(aid, words\), always: \(aid, offer, ask\) => alwaysWorker\(aid, offer, ask\) \}\);/);
    assert.match(app, /if \(r\.status !== "running" && heldAsks\.of\(chain, r\.id\)\?\.error === null\) void heldAsks\.settled\(chain, r\.id\);/, "the list's word sends too; a refused one waits for Send again");
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.thp > \.sav-foot-box \{ flex: none; margin: 0 10px 10px; \}/);
  });

  // (fails before: yes — HarnessV4_Tasks U12-D8: a thread's head wore the bot whoever it was, and changes waiting for
  // Apply looked as any other part of it)
  test("a thread's head wears its agent's glyph as its row does; changes that wait for Apply stand out", () => {
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    // (OA1: no kind of agent wears a colour of its own)
    assert.match(viewer, /const face = rowIcon\(sa\);\n\s*if \(face !== faceKey\) \{\n\s*faceKey = face;\n\s*setHtml\(avatar, \/\*\* @type \{any\} \*\/ \(ICONS\)\[face\] \|\| ICONS\.bot\);/);
    assert.match(viewer, /modelFact\(sa\.asked \? prettyModel\(sa\.model\) : sa\.model, effortAt\(sa\.effort\), sa\.provider\),/, "the model says the level it thinks at, and the provider that runs it");
    assert.match(viewer, /workBox\.classList\.toggle\("is-ready", !!w && !w\.error && w\.pending > 0 && !sa\.rebaseDue\);/);
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.equal(/\.sav-avatar\.is-lead/.test(css), false);
    assert.match(css, /\.sav-work\.is-ready > \.sav-label \{ color: var\(--color-sys-green-text\); \}/);
  });

  // (fails before: yes — HarnessV4_Tasks decision 10: a working worker's thread held your words until it reported)
  // (fails before: yes — the transcript audit, 2026-10-23: any other agent at work held them until it answered,
  // where the main agent takes them at its next step)
  test("any agent at work takes what its thread's box sends now, past whoever launched it, who is told; its toast says when they read it", () => {
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.match(viewer, /const tells = \(\) => running\(\);/);
    assert.match(viewer, /if \(tells\(\)\) return void tellNow\(text\);\n\s*sending = true;/, "no held path before it");
    assert.match(viewer, /const out = await routes\.message\(id, text\);[\s\S]{0,200}toast\(toldWords\(sa, out\)\);/);
    assert.match(viewer, /const toldWho = \(\) => \(sa\?\.team \? "its lead" : sa && \(sa\.origin === "agent" \|\| sa\.task\) \? "the main agent" : ""\);/);
    assert.match(viewer, /input\.placeholder = tells\(\)\n\s*\? `Working: what you write reaches it at its next step\$\{who \? `, and \$\{who\} is told` : ""\}`/);
    const worker = { id: "w1", team: { team: "architect", role: "builder", place: "builder" }, card: { tag: "builder", name: "Builder" } };
    assert.equal(toldWords(worker, { told: "turn", asking: null }), "Sent to Builder w1: it reads it at its next step, and its lead at its next step too");
    assert.equal(toldWords(worker, { told: "queue", asking: "bash" }), "Sent to Builder w1: it reads it once its question is answered, and its lead when its next turn starts");
    assert.equal(toldWords({ id: "sa_1", card: { tag: "reviewer", name: "Reviewer" } }, { told: "turn" }), "Sent to Reviewer sa_1: it reads it at its next step, and the main agent at its next step too");
    assert.equal(toldWords({ id: "sa_2", card: { tag: "reviewer", name: "Reviewer" } }, { told: null }), "Sent to Reviewer sa_2: it reads it at its next step", "one you launched yourself: nobody else is told");
    const routes = readFileSync(new URL("../src/ui/harness/lib/subagents.js", import.meta.url), "utf8");
    assert.match(routes, /message: \(id, text\) => post\(`\/\$\{encodeURIComponent\(id\)\}\/message`, \{ text \}\),/);
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-10): a thread was gone with a restart, so the page had no
  // words for one that came back)
  test("a thread its session gave back: one line where a fresh agent took it up, its box says what the next message starts, and what it was shown is a size", () => {
    assert.equal(freshWords("restart"), "Filament restarted since. This thread goes on from what was said here: the agent starts fresh and reads it.");
    assert.equal(freshWords("let-go"), "Filament no longer holds this agent's own conversation. This thread goes on from what was said here: the agent starts fresh and reads it.", "let go, it claims no restart");
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.match(viewer, /ex\.fresh \? h\("div", \{ class: "sav-note sav-fresh" \}, freshWords\(ex\.fresh\)\) : null,\n\s*h\("div", \{ class: "sav-label" \}, o\.label,/, "over the message it began with");
    assert.match(viewer, /const how = sa\.restored \? ": it starts fresh, and reads this thread first" : null;/);
    assert.match(viewer, /`Ask \$\{sa\.card\.name\} again\$\{how \?\? ": the same thread, told what happened since"\}`/);
    assert.match(viewer, /more\$\{how \?\? ", in the context it already has"\}`;/, "never 'the context it already has' of an agent that holds none");
    assert.match(viewer, /const size = b\.kind === "fork" \? "" : `~\$\{fmt\.k\(fmt\.tokens\(b\.chars \?\? b\.text\.length\)\)\} tokens`;/);
    assert.match(viewer, /if \(!b\.text\)\n\s*return h\("div", \{ class: "sav-context", title: "Filament keeps what was said in a thread, not what the agent was shown" \},/, "a block whose words are kept no more does not open");
    assert.match(viewer, /\[size, "not kept"\]\.filter\(Boolean\)\.join\(" · "\)/);
    assert.match(viewer, /`This thread is gone: \$\{\/\*\* @type \{any\} \*\/ \(e\)\?\.message \|\| e\}\. It was deleted, or it was older than the newest 30 a session keeps — one whose work waits for your Apply is always kept\.`/);
  });
});

describe("Side: the view", () => {
  /** A Side view on the fake DOM over a session `c1`. @param {Record<string, any>} [over] the IO's parts */
  function viewOf(over = {}) {
    const io = sideIO(over);
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    return { io, view, chat, ...s, el: view.el };
  }
  /** The chips' words: the agent the @ chip names, then each chip's. @param {any} el */
  const line = (el) => [textOf(one(el, "sd-agent-name")), ...byClass(el, "sd-part-words").map((n) => textOf(n))];

  /** The gear's sheet opened from the list's head: what it was given. @param {any} t */
  const gearSheet = (t) => {
    /** @type {any} */ (one(one(t.el, "sd-list-head"), "sd-gear")).dispatch("click");
    return t.sheets.at(-1);
  };

  // (fails before: yes — HarnessV4_Tasks U12-D5: the Agents on the side's chip headed the tab, and nothing said how
  // many of its seats ran; the owner's 10-25: "how is it connected with model box" — the corner bore Library's box's
  // name over this chat's own list, and said whose list it was in a tooltip alone; the owner's of 11-05: the list's foot,
  // a corner of settings under the list, went behind a gear, in a sheet that says they are this chat's overrides)
  test("the gear's sheet: Agents in this chat, overrides for this chat alone over Library's; in it the seat — Agents run on, the chat's list on a chip tagged with whose it is, a line that says whose it is, Use the default where it is the chat's own, and a meter of its agents at work; an edit and the default go to the host; no session, no gear", () => {
    /** @type {{ rows: unknown, source: string, main: string } | null} */
    let pool = { rows: [{ model: "", seats: 4 }], source: "default", main: "glm-5.3" };
    let facts = /** @type {any} */ (FACTS);
    const t = viewOf({ pool: () => pool, facts: () => facts });
    t.view.paint(t.chat);
    assert.deepEqual([byClass(t.el, "sd-seats").length, byClass(t.el, "sd-gear").map((g) => g.attrs["aria-label"])], [0, [GEAR_TITLE, GEAR_TITLE]], "nothing of it under the list: a gear in its head, and in the narrow bar");
    const s = gearSheet(t);
    assert.deepEqual([s.o.label, textOf(s.o.head), GEAR_LINE], [GEAR_TITLE, `${GEAR_TITLE}|${GEAR_LINE}`, "Overrides for this chat only. Every agent and team starts as Library › Agents and teams sets it; a change here holds in this chat alone, and Use the default on its row takes it back."]);
    const seats = s.o.body;
    assert.ok(seats.attrs.class.includes("sd-seats"));
    const side = byClass(seats, "sd-seat")[0];
    assert.deepEqual([textOf(one(side, "sd-seat-head")), textOf(one(side, "sd-seat-from")), textOf(one(side, "sd-seat-count")), one(side, "sd-meter-fill").attrs.style, one(side, "sd-meter").attrs["aria-valuenow"]],
      ["Agents run on", "None set|: its agents run on this chat's model, as its main agent does", "1 at work · room for 3 more", "width:25%", "25"]);
    const [chip] = t.pools;
    assert.deepEqual([chip.shown, chip.io.source(), chip.io.label, chip.io.tag(), t.pools.length], [{ rows: [{ model: "", seats: Infinity }], main: "glm-5.3" }, "default", "What this chat's agents run on", "Default", 1],
      "the chip's own words: the chat's list, tagged with whose it is; one chip, in the sheet — narrow, the gear stands in the thread's bar");
    chip.io.onChange([{ model: "zai/glm-5.3-flash", seats: 3 }]);
    chip.io.onUseDefault();
    assert.deepEqual(t.io.calls.filter((c) => c[0] === "setPool"), [["setPool", [{ model: "zai/glm-5.3-flash", seats: 3 }]], ["setPool", null]]);
    // Painted again only when a list, its layer or its seats moved: a pulse with nothing new leaves the chip be.
    const shown = chip.shown;
    t.view.paint(t.chat);
    assert.equal(chip.shown, shown);
    facts = { ...FACTS, seats: { max: 4, running: 4 } };
    t.view.paint(t.chat);
    assert.deepEqual([textOf(one(side, "sd-seat-count")), one(side, "sd-meter").classList.contains("is-full"), chip.shown === shown], ["4 at work · no room for more", true, false]);
    // The chat's own list: said so, with the way back — the write the editor's Use the default makes.
    pool = { rows: [{ model: "zai/glm-5.3-flash" }], source: "session", main: "glm-5.3" };
    t.view.paint(t.chat);
    assert.deepEqual([textOf(one(side, "sd-seat-head")), textOf(one(side, "sd-seat-from")), chip.io.tag()],
      ["Agents run on|Use the default", "This chat's own list", "This chat"]);
    /** @type {any} */ (one(side, "sd-seat-default")).dispatch("click");
    assert.deepEqual(t.io.calls.filter((c) => c[0] === "setPool").at(-1), ["setPool", null]);
    pool = null;
    t.view.paint(t.chat);
    assert.deepEqual([seats.classList.contains("hidden"), byClass(t.el, "sd-gear").map((g) => g.classList.contains("hidden")), s.closed], [true, [true, true], true], "a chat with no session has nothing to set: no gear, its sheet closed");
  });

  // (fails before: yes — the owner's of 11-05: nothing said which of a chat's agent settings were its own, nor took them all back)
  test("the gear says where any is this chat's own, and its sheet takes them all back or leads to Library's", () => {
    let own = false;
    const t = viewOf({ pool: () => ({ rows: [{ model: "" }], source: own ? "session" : "default", main: "glm-5.3" }), agentsOwn: () => own, resetAgents: () => t.io.calls.push(["resetAgents"]), openLibrary: () => t.io.calls.push(["openLibrary"]) });
    t.view.paint(t.chat);
    const gears = byClass(t.el, "sd-gear");
    assert.deepEqual(gears.map((g) => g.classList.contains("is-own")), [false, false]);
    const s = gearSheet(t);
    const foot = s.o.foot;
    assert.deepEqual([buttonsOf(foot).map((b) => textOf(b)), one(foot, "sd-gear-reset").classList.contains("hidden")], [["Reset all for this chat", "Edit defaults in Library", "Done"], true], "nothing of its own: nothing to reset");
    own = true;
    t.view.paint(t.chat);
    assert.deepEqual([gears.map((g) => g.classList.contains("is-own")), gears[0].attrs.title, one(foot, "sd-gear-reset").classList.contains("hidden")],
      [[true, true], "This chat's agent settings: whom your agent may use, and what its agents and teams run on. Some are this chat's own", false]);
    /** @type {any} */ (one(foot, "sd-gear-reset")).dispatch("click");
    /** @type {any} */ (one(foot, "sd-gear-lib")).dispatch("click");
    assert.deepEqual([t.io.calls.filter((c) => c[0] === "resetAgents" || c[0] === "openLibrary"), s.closed], [[["resetAgents"], ["openLibrary"]], true], "Library's page: the sheet goes first");
    // Open again, Done closes it; a second press while it is open opens no second one.
    const again = gearSheet(t);
    gearSheet(t);
    assert.equal(t.sheets.filter((x) => !x.closed).length, 1);
    /** @type {any} */ (one(again.o.foot, "sd-gear-done")).dispatch("click");
    assert.equal(again.closed, true);
  });

  // (fails before: yes — the review of 9355b6724: the sheet stayed over a chat or view switch, showing one chat and
  // writing to another, and Who runs on what was built while it was closed)
  test("the gear's sheet is the chat's it opened on: another chat shown, or the view leaving, closes it; closed, Who runs on what builds nothing", () => {
    const who = { cards: () => [], teams: () => [], byCard: () => null, byTeam: () => null, setByCard() {}, setByTeam() {}, everyone: () => [{ model: "" }], main: () => "glm-5.3", models: () => [] };
    const io = sideIO({ pool: () => ({ rows: [{ model: "" }], source: "default", main: "glm-5.3" }), whoRuns: () => who });
    const s = sideSeams();
    let built = 0;
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams, runsOn: /** @type {any} */ (() => (built++, { el: fakeH("div", {}), paint() {} })) });
    const a = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    const b = /** @type {any} */ ({ id: "chat-2", chainId: "c2", turns: [] });
    view.paint(a);
    view.paint(a);
    assert.equal(built, 0, "closed: nothing built");
    const t = { el: view.el, sheets: s.sheets };
    const first = gearSheet(t);
    view.paint(a);
    assert.deepEqual([built, first.closed], [1, false], "open, built once; the same chat painted, it stays");
    view.paint(b);
    assert.equal(first.closed, true, "another chat shown: closed");
    view.paint(a);
    const second = gearSheet(t);
    view.close();
    assert.equal(second.closed, true, "the view left: closed");
  });

  // (fails before: yes — the review of 9355b6724: a chat's own teams had no dot and Reset kept them; a list a popover
  // closed on Reset's press was written after Reset read what to drop)
  test("the gear's paths: whom the agent may use — its cards and its teams —, the list, the rows; a chat's own are its sources' session's, and Reset waits for a write on its way", () => {
    assert.deepEqual(GEAR_PATHS, ["subagents.ask", "subagents.teams", "subagents.pool", "subagents.byCard", "subagents.byTeam", "subagents.parallelize"]);
    assert.deepEqual(ownGearPaths({ "subagents.ask": "session", "subagents.teams": "session", "subagents.pool": "project", "subagents.byCard": "session", "model.name": "session" }), ["subagents.ask", "subagents.teams", "subagents.byCard"]);
    assert.deepEqual(ownGearPaths(undefined), []);
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /await settingsWrites\.get\(String\(c\.chainId\)\);\n {2}const unset = agentsOwnOf\(c\);/);
    assert.match(app, /settingsWrites\.set\(String\(chat\.chainId\), sent\.catch\(\(\) => null\)\);\n {4}const doc = await sent;/);
    const css = readFileSync(new URL("../src/ui/harness/views/side.css", import.meta.url), "utf8");
    assert.ok(!css.includes(".may-ask:not(.is-warned) .inst-row-sub"), "in the sheet the row says whose list it is");
    assert.ok(css.includes("html.app-frame .zc-sheet.sd-gear-sheet { height: auto; }"), "as tall as what it holds in the desktop app too");
  });

  // (fails before: yes — the owner's plan of 11-05: a chat set its agents' and its teams' models nowhere: three places
  // at most, this chat's Agents tab the second)
  test("Who runs on what stands in the gear's sheet, over the seat, once the chat's settings are read: unfolded, it says how many are set here", () => {
    /** @type {any} */
    let who = null;
    const t = viewOf({ pool: () => ({ rows: [{ model: "" }], source: "default", main: "glm-5.3" }), whoRuns: () => who });
    t.view.paint(t.chat);
    const seats = gearSheet(t).o.body;
    const slot = one(seats, "sd-runs-on");
    assert.deepEqual([slot.classList.contains("hidden"), slot.kids.length], [true, 0], "not read yet: nothing to say");
    who = { cards: () => [{ tag: "docs", name: "Docs", model: "kimi-k2" }], teams: () => [], byCard: () => ({ docs: [{ model: "zai/glm-5.3" }] }), byTeam: () => null, setByCard() {}, setByTeam() {}, everyone: () => [{ model: "" }], main: () => "glm-5.3", models: () => [] };
    t.view.paint(t.chat);
    assert.deepEqual([slot.classList.contains("hidden"), seats.kids.indexOf(slot) < seats.kids.indexOf(one(seats, "sd-seat")), textOf(one(slot, "runs-on-head")), one(slot, "runs-on-head").attrs["aria-expanded"]],
      [false, true, "Who runs on what|1 set in this chat", "true"]);
    assert.deepEqual(byClass(slot, "runs-on-row").map((r) => textOf(one(r, "inst-row-label"))), ["Docs"], "its rows shown: the sheet is for them");
  });

  // (fails before: yes — the owner's word of 10-18, "i also don't like the Workers picker shown again in the Sub Agents
  // tab … if it is already there in the Team tab then no need": a second seat under the list held the Workers' chip)
  test("one seat in the gear's sheet, Agents run on: a team's crew has no list of its own, here or anywhere", () => {
    const t = viewOf({ rows: () => [agentRow("w1", { status: "running", team: { name: "Architect", role: "builder" } })] });
    t.view.paint(t.chat);
    const seats = gearSheet(t).o.body;
    assert.deepEqual(byClass(seats, "sd-seat").map((s) => textOf(one(s, "sd-seat-name"))), ["Agents run on"]);
    assert.deepEqual(t.pools.map((/** @type {any} */ p) => p.io.label), ["What this chat's agents run on"],
      "the side list's chip in the sheet, and no other: not even while a team's worker runs");
    const from = one(one(seats, "sd-seat"), "sd-seat-from");
    assert.deepEqual([textOf(from), one(from, "sd-seat-lib")], ["None set|: its agents run on this chat's model, as its main agent does", undefined], "no box in Library to lead to");
  });
  /** Type into the box. @param {any} el @param {string} words */
  const write = (el, words) => {
    const box = one(el, "sd-task");
    box.value = words;
    box.dispatch("input");
    return box;
  };

  // (fails before: yes — HarnessV4_Tasks U12-D6: the new thread was a lead line, three shortcuts and "Another agent"
  // over a sentence; Catch me up was no part of it)
  test("a new thread: a title, the starts as tiles, the box with its agent as an @ chip, the chips under it; the sizes read once for the chat", () => {
    const { io, view, chat, el, pickers } = viewOf();
    view.paint({ id: "draft", chainId: null });
    assert.deepEqual(el.kids, [], "no session: nothing is drawn");
    view.paint(chat);
    view.paint(chat);
    assert.deepEqual(io.calls, [["readSizes", false], ["readSizes", true]], "the chips' sizes at once, the two changes' behind them — once");
    assert.deepEqual([textOf(one(el, "sd-title")), textOf(one(el, "sd-lead"))], ["Start…", "Ask an agent, or send a team. Your agent keeps working, and hears nothing unless you send it."]);
    // (fails before: yes — U13 W3: Ask was a tile among four, and no line said what they were) The quick starts, under
    // their cap; Start… begins on asking, with no tile of its own.
    assert.equal(textOf(one(el, "sd-cap")), "Quick starts");
    assert.deepEqual(byClass(el, "sd-short").map((b) => [textOf(one(b, "sd-short-name")), textOf(one(b, "sd-short-sub")), b.attrs.role, b.attrs["aria-checked"] ?? null]),
      [["Catch me up", "Builder, read only, since your last message", "radio", "false"], ["Review my last change", "Reviewer, with the last change", "radio", "false"], ["Try it in a copy", "Builder", "radio", "false"]]);
    assert.deepEqual(byClass(el, "sd-short-ic").map((g) => g.attrs.html), [ICONS.history, ICONS.eye, ICONS.hammer]);
    assert.deepEqual([textOf(one(el, "sd-how")), byClass(el, "sd-verb").length], ["", 0], "no Ask or Give a job (OA1): the card's level, and May lowers it");
    // Runs on · Effort · Sees · May · Answer to, then More.
    assert.deepEqual(line(el), ["Builder", "Max", "Sees this session and the running turn · 26k tokens", "Read only", "Answer stays with you", "More"]);
    assert.deepEqual([one(el, "sd-agent-ic").innerHTML, one(el, "is-effort").classList.contains("is-default")], [ICONS.hammer, true],
      "the card's glyph; the effort is the session's default until one is picked");
    // (fails before: yes — E15 step 8's look: the words named one model of the session's, which a pool replaced)
    assert.deepEqual([pickers[0].name, pickers[0].note, pickers[0].locked], ["glm-5.3", "the card's, else a default model", null]);
    assert.equal(one(el, "sd-task").attrs.placeholder, "Tell Builder what you need");
    assert.deepEqual([one(el, "sd-send").attrs.disabled, one(el, "sd-enhance").attrs.disabled], ["", ""], "nothing written: nothing to send or enhance");
    assert.equal(one(el, "sd-conv").classList.contains("hidden"), true);

    shortcut(el, "Review my last change").dispatch("click");
    assert.deepEqual(line(el), ["Reviewer", "Max", "Your words alone, with the last turn's change", "Read only", "Answer stays with you", "More"]);
    assert.deepEqual([one(el, "sd-task").focused, one(el, "sd-task").attrs.placeholder, one(el, "sd-agent-ic").innerHTML], [true, "Tell Reviewer what you need", ICONS.eye], "a tile chosen: the cursor is in the box");
  });

  // (fails before: yes — U12-D6: "Another agent" listed the cards as workers and leads; a lead that runs a team was one
  // lead more; OA1: three groups of one kind of thing)
  test("the @ chip: every saved agent in one list, each with its glyph; one chosen takes the box and the chips; picked again, nothing changes", () => {
    const { view, chat, el, menus } = viewOf();
    view.paint(chat);
    one(el, "sd-agent").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["label", "Agents"], ["radio", "Builder", true], ["radio", "Reviewer", false], ["radio", "End user", false], ["radio", "Product", false]]);
    assert.deepEqual(menus[0].items.filter((/** @type {any} */ i) => i.type === "radio").map((/** @type {any} */ i) => [i.icon, i.desc]),
      [["hammer", card("builder").goodFor], ["eye", card("reviewer").goodFor], ["user", card("enduser").goodFor], ["goal", card("product").goodFor]]);
    menuRow(menus[0], "Product").onClick();
    assert.deepEqual(line(el), ["Product", "Max", "Sees this session and the running turn · 26k tokens", "Read only", "Answer stays with you", "More"]);
    assert.deepEqual([one(el, "sd-task").attrs.placeholder, one(el, "sd-task").focused], ["Tell Product what you need", true]);
    assert.deepEqual(byClass(el, "sd-short").map((b) => [b.attrs.role, b.attrs["aria-checked"]]), [["radio", "false"], ["radio", "false"], ["radio", "false"]], "no tile is on: the card alone");
    one(el, "is-effort").dispatch("click");
    menuRow(menus[1], "High").onClick();
    one(el, "sd-agent").dispatch("click");
    assert.deepEqual(menuRows(menus[2]).filter((r) => r[0] === "radio" && r[2]).map((r) => r[1]), ["Product"]);
    menuRow(menus[2], "Product").onClick();
    assert.deepEqual([chat.side.draft.tag, chat.side.draft.effort, line(el)[1]], ["product", "high", "High"], "the same agent again keeps what was chosen for it");
  });

  // (fails before: yes — U13 W3: Start… asked agents alone; a team started from the Teams row or the Brief)
  test("Start…'s Who lists the teams, each crowned, after the agents; a team picked: its two ways each open its Brief with the box's words, and Send opens it on its usual way — nothing starts here", async () => {
    const TEAMS = [
      { key: "methodical", name: "Methodical", line: "One step at a time", lead: { tag: "product", name: "Product" }, members: [{ tag: "builder", may: "edit" }] },
      { key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs", lead: { tag: "hunter", name: "Bug Hunter" }, members: [{ tag: "reviewer", may: "read" }] },
    ];
    /** @type {any[]} */
    const briefs = [];
    const { io, view, chat, el, menus } = viewOf({ teamsList: () => TEAMS, brief: (/** @type {any} */ f) => briefs.push(f) });
    view.paint(chat);
    one(el, "sd-agent").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["label", "Agents"], ["radio", "Builder", true], ["radio", "Reviewer", false], ["radio", "End user", false], ["radio", "Product", false],
      ["label", "Teams: a lead and its workers"], ["radio", "Methodical", false], ["radio", "Bug Hunter", false]]);
    // (fails before: yes — UX6 and the plan's p6 drew Builders under a label of its own, a row per way its lead could
    // lead; the owner's of 11-04: it leads one way) Builders, the shipped team that builds, is one row among the teams.
    /** @type {any[]} */
    const shippedBriefs = [];
    const shipped = viewOf({ teamsList: () => [{ key: "builders", name: "Builders", line: "Builds it with its workers", shipped: true, lead: { tag: "buildlead", name: "Builders" }, members: [{ tag: "builder", may: "edit" }] }, { ...TEAMS[1], shipped: true }], brief: (/** @type {any} */ f) => shippedBriefs.push(f) });
    shipped.view.paint(shipped.chat);
    one(shipped.el, "sd-agent").dispatch("click");
    assert.deepEqual(menuRows(shipped.menus[0]).slice(-3), [["label", "Teams: a lead and its workers"], ["radio", "Builders", false], ["radio", "Bug Hunter", false]]);
    menuRow(shipped.menus[0], "Builders").onClick();
    assert.deepEqual([textOf(one(shipped.el, "sd-agent-name")), shipped.chat.side.draft.team, "style" in shipped.chat.side.draft], ["Builders", "builders", false]);
    write(shipped.el, "add the logbook");
    buttonsOf(one(shipped.el, "sd-how"))[1].dispatch("click");
    assert.deepEqual(shippedBriefs, [{ team: "builders", way: "charge", ask: "add the logbook" }], "its Brief opens on the team alone");
    one(shipped.el, "sd-agent").dispatch("click");
    assert.deepEqual(menuRows(shipped.menus[1]).filter((r) => r[0] === "radio" && r[2]).map((r) => r[1]), ["Builders"]);
    assert.deepEqual(menus[0].items.filter((/** @type {any} */ i) => i.label === "Methodical" || i.label === "Bug Hunter").map((/** @type {any} */ i) => [i.icon, i.desc]), [["crown", "One step at a time"], ["crown", "Finds bugs"]]);
    menuRow(menus[0], "Bug Hunter").onClick();
    assert.deepEqual([textOf(one(el, "sd-agent-name")), one(el, "sd-agent").classList.contains("is-team"), one(el, "sd-chips").classList.contains("hidden"), one(el, "sd-task").attrs.placeholder, textOf(one(el, "sd-notes"))],
      ["Bug Hunter", true, true, "Tell Bug Hunter's lead what the team is to do", TEAM_BRIEF]);
    const ways = buttonsOf(one(el, "sd-how"));
    assert.deepEqual(ways.map((b) => [textOf(b), b.attrs.class]), [["On the side…", "sd-way is-usual"], ["In charge…", "sd-way"]], "a team that changes no file goes on the side, as usual");
    write(el, "find bugs in the parser");
    ways[1].dispatch("click");
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual(briefs, [{ team: "bug-hunter", way: "charge", ask: "find bugs in the parser" }, { team: "bug-hunter", way: "side", ask: "find bugs in the parser" }]);
    assert.deepEqual(io.calls.filter((c) => c[0] === "launch"), [], "one press never starts: the Brief's Send does");
    // An agent again: the box and its chips are its own.
    shortcut(el, "Catch me up").dispatch("click");
    assert.deepEqual([one(el, "sd-chips").classList.contains("hidden"), textOf(one(el, "sd-how")), chat.side.draft.team], [false, "", null]);
    // A team's own chat sends no team of its own: Who lists none.
    const own = viewOf({ teamsList: () => TEAMS, teams: { el: fakeH("div", {}), items: () => [], paint: () => {}, home: () => false } });
    own.view.paint(own.chat);
    one(own.el, "sd-agent").dispatch("click");
    assert.equal(menuRow(own.menus[0], "Methodical"), undefined);
  });

  // (fails before: yes — d-side, 11-12: In charge…'s tip said of every team "The team's lead takes your agent's place in
  // this chat. You talk to the lead from now on.", of BugHunters too, which the server holds to reading there)
  test("a team picked in Start…: In charge…'s tip says, for one that changes no file, that the chat only reads while it is in charge — before its Brief opens; a team that builds, and one whose workers all read, keep the tip they had, and On the side… its own", () => {
    const READ = { may: "read", place: "reviewer" };
    const TEAMS = [
      { key: "bughunters", name: "BugHunters", line: "Finds bugs", shipped: true, readOnly: true, lead: { tag: "huntlead", name: "BugHunters" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", ...READ }, { tag: "checker", card: "reviewer", name: "Checker", ...READ }] },
      { key: "builders", name: "Builders", line: "Builds it with its workers", shipped: true, readOnly: false, lead: { tag: "buildlead", name: "Builders" }, members: [{ tag: "builder", name: "Builder", may: "edit" }] },
      { key: "readers", name: "Readers", line: "Reads", shipped: false, readOnly: false, lead: { tag: "product", name: "Product" }, members: [{ tag: "reviewer", name: "Reviewer", ...READ }] },
    ];
    /** @type {any[]} */
    const briefs = [];
    const { view, chat, el, menus } = viewOf({ teamsList: () => TEAMS, brief: (/** @type {any} */ f) => briefs.push(f) });
    view.paint(chat);
    /** The two ways of a team picked in Who: each button's words, whether it is the usual one, its tip. @param {string} name */
    const waysOf = (name) => {
      one(el, "sd-agent").dispatch("click");
      menuRow(menus.at(-1), name).onClick();
      return buttonsOf(one(el, "sd-how")).map((b) => [textOf(b), b.attrs.class, b.attrs.title]);
    };
    const SIDE = "Your agent keeps working. The team works next to it, in a chat of its own. Opens its Brief; Send there starts it";
    const CHARGE = "The team's lead takes your agent's place in this chat. You talk to the lead from now on. Opens its Brief; Send there starts it";
    assert.deepEqual(waysOf("BugHunters"), [
      ["On the side…", "sd-way is-usual", SIDE],
      ["In charge…", "sd-way", "Its lead takes your agent's place in this chat, and the chat only reads while it is in charge, whatever its mode: BugHunters changes no file. Opens its Brief; Send there starts it"],
    ]);
    assert.deepEqual(waysOf("Builders"), [["On the side…", "sd-way", SIDE], ["In charge…", "sd-way is-usual", CHARGE]]);
    assert.deepEqual(waysOf("Readers"), [["On the side…", "sd-way is-usual", SIDE], ["In charge…", "sd-way", CHARGE]], "on the side by default, and not held where it is put in charge");
    // The press is what it was: In charge… opens the team's Brief on In charge, and nothing starts here.
    waysOf("BugHunters");
    write(el, "hunt the parser");
    buttonsOf(one(el, "sd-how"))[1].dispatch("click");
    assert.deepEqual(briefs, [{ team: "bughunters", way: "charge", ask: "hunt the parser" }]);
  });

  // (fails before: yes — the owner's 10-21: they forgot a team's models and effort are its Brief's, and the box said
  // nothing of what a team runs on)
  test("a team picked in Start…: a line over the box says what it runs on as its Brief opens — its lead, its crew and how hard they think, how many at once, whether it changes files — its last run's picks first", async () => {
    const TEAMS = [{ key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs", most: null, lead: { tag: "hunter", name: "Bug Hunter" }, members: [{ tag: "hunter", name: "Hunter", may: "read" }] }];
    /** @type {any} */
    let picks = null;
    /** @type {any[]} */
    const asked = [];
    const { view, chat, el, menus } = viewOf({
      teamsList: () => TEAMS, brief: () => {}, lastPicks: () => picks, seats: () => ["m-3"],
      runsOn: async (/** @type {string} */ team, /** @type {any} */ pick) => (asked.push([team, pick]), { lead: pick.model || "m-1", workers: [pick.workers || "m-2"], from: "team", fell: [] }),
    });
    view.paint(chat);
    one(el, "sd-agent").dispatch("click");
    menuRow(menus[0], "Bug Hunter").onClick();
    await settled();
    const notes = () => byClass(one(el, "sd-notes"), "sd-note").map((n) => textOf(n));
    // (the review of 11-05: none picked, its crew thinks as hard as its lead, whose level its model may take otherwise)
    assert.deepEqual(notes(), [`Its lead on ${prettyModel("m-1")} · Hunters on ${prettyModel("m-2")}, as hard as its lead · reads only.`, TEAM_BRIEF]);
    assert.deepEqual(asked, [["bug-hunter", { model: "", workers: "" }]], "asked once");
    view.paint(chat);
    await settled();
    assert.equal(asked.length, 1, "a paint with nothing new asks nothing");
    picks = { model: "m-4", workers: "m-5", effort: "xhigh", workersEffort: "high" };
    view.paint(chat);
    await settled();
    assert.deepEqual(notes()[0], `Its lead on ${prettyModel("m-4")}, extra high · Hunters on ${prettyModel("m-5")}, high · reads only — as last time.`);
    // No list of this chat's and no models of its own: its crew on each card's, else its lead's (the review of 0376f5a4f).
    const bare = viewOf({ teamsList: () => TEAMS, brief: () => {}, seats: () => [], runsOn: async () => ({ lead: "m-1", workers: null, from: "seats", fell: [] }) });
    bare.view.paint(bare.chat);
    one(bare.el, "sd-agent").dispatch("click");
    menuRow(bare.menus[0], "Bug Hunter").onClick();
    await settled();
    assert.equal(textOf(byClass(one(bare.el, "sd-notes"), "sd-note")[0]), `Its lead on ${prettyModel("m-1")} · Hunters on each card's, else ${prettyModel("m-1")}, as hard as its lead · reads only.`);
  });

  // (fails before: yes — the copies hunt of 10-23: the note read for one chat stood in the next chat's Start…)
  test("Start…'s team note is the chat's own: another chat on screen asks for its own", async () => {
    const TEAMS = [{ key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs", most: null, lead: { tag: "hunter", name: "Bug Hunter" }, members: [{ tag: "hunter", name: "Hunter", may: "read" }] }];
    /** @type {string[]} */
    const asked = [];
    let lead = "m-1";
    const { view, chat, el, menus } = viewOf({ teamsList: () => TEAMS, brief: () => {}, seats: () => ["m-3"], runsOn: async () => (asked.push(lead), { lead, workers: ["m-2"], from: "team", fell: [] }) });
    view.paint(chat);
    one(el, "sd-agent").dispatch("click");
    menuRow(menus.at(-1), "Bug Hunter").onClick();
    await settled();
    lead = "m-4";
    view.paint(/** @type {any} */ ({ id: "chat-2", chainId: "c2", turns: [] }));
    one(el, "sd-agent").dispatch("click");
    menuRow(menus.at(-1), "Bug Hunter").onClick();
    await settled();
    assert.deepEqual(asked, ["m-1", "m-4"]);
    const note = textOf(byClass(one(el, "sd-notes"), "sd-note")[0]);
    assert.ok(note.startsWith(`Its lead on ${prettyModel("m-4")} `), note);
  });

  // (fails before: yes — the owner's 10-21: the tab's model picker was given the models' names alone — no price, no
  // levels, no plan's room, where the chat's box shows them)
  test("an agent's model picker is given the catalogue as the chat's is: its families and the coding agents' accounts", () => {
    const fams = [{ id: "m-1", upstream: "u1", kind: "model", members: [{ id: "m-1" }] }];
    const accounts = [{ upstream: "claude-code" }];
    const { view, chat, pickers } = viewOf({ families: () => fams, accounts: () => accounts });
    view.paint(chat);
    assert.deepEqual([pickers[0].families, pickers[0].accounts], [fams, accounts]);
  });

  // (fails before: yes — U13 W3: Start… had no Ask or Give a job; OA1: asked, it read only, and May had no choice)
  test("May: the card's levels, lowered or put back on the chip, whoever the agent is; the launch names its level and no verb", async () => {
    const { io, view, chat, el, menus } = viewOf();
    view.paint(chat);
    assert.deepEqual([byClass(el, "sd-verb").length, line(el)[3], "disabled" in one(el, "is-may").attrs, one(el, "is-may").attrs.title], [0, "Read only", false, "What it may do: only lower than its card"], "the Ask start reads only; Builder may do more");
    one(el, "is-may").dispatch("click");
    menuRow(menus[0], "Edits in its own copy, you apply").onClick();
    assert.equal(line(el)[3], "Edits in its own copy");
    write(el, "fix the typo");
    io.calls.length = 0;
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual([io.calls[0][0], io.calls[0][1].may, io.calls[0][1].worktree, "verb" in io.calls[0][1]], ["launch", "edit", true, false]);
  });

  // (fails before: yes — U12-D7: no chip said how hard the agent thinks, and a launch from the tab could not name it)
  test("the Effort chip: the session's default, the model's own and each level; one picked goes with the launch; a live copy's is the main agent's", async () => {
    const { io, view, chat, el, menus } = viewOf();
    view.paint(chat);
    one(el, "is-effort").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["label", "How hard it thinks"], ["radio", "The default: Max", true], ["radio", "The model's own", false], ["radio", "Low", false], ["radio", "Medium", false],
      ["radio", "High", false], ["radio", "Extra high", false], ["radio", "Max", false], ["separator", ""], ["label", "A model that takes fewer levels thinks at its highest below this one; the thread says which"]]);
    menuRow(menus[0], "High").onClick();
    assert.deepEqual([line(el)[1], one(el, "is-effort").classList.contains("is-default")], ["High", false]);
    write(el, "check the auth flow");
    io.calls.length = 0;
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual([io.calls[0][0], io.calls[0][1].effort], ["launch", "high"]);
    view.fresh();
    assert.deepEqual([line(el)[1], one(el, "is-effort").classList.contains("is-default")], ["Max", true], "the next thread begins on the session's default");
    one(el, "is-sees").dispatch("click");
    menuRow(menus.at(-1), "A live copy").onClick();
    const chip = one(el, "is-effort");
    assert.deepEqual([line(el)[1], "disabled" in chip.attrs, chip.attrs.title], ["Your agent's effort", true, "A live copy thinks as your agent's request it copies: the cache it reads is that request's"]);
    const opened = menus.length;
    chip.dispatch("click");
    assert.equal(menus.length, opened, "nothing to choose");
  });

  /** The tiles that are on, by name. @param {any} el */
  const tilesOn = (el) => byClass(el, "sd-short").filter((b) => b.attrs["aria-checked"] === "true").map((b) => textOf(one(b, "sd-short-name")));

  // (fails before: yes — the owner's word of 10-18, "just a Single button press should never start an action": the Catch
  // me up tile launched on one press)
  test("the Catch me up tile is chosen, never sent: its question stands in the box to send or change; Send asks it with its start; the next thread is Ask's", async () => {
    const { io, view, chat, el, threads } = viewOf();
    view.paint(chat);
    io.calls.length = 0;
    const tile = shortcut(el, "Catch me up");
    assert.equal(tile.attrs.title, "Catch me up: its question goes in the box, to send or change");
    tile.dispatch("click");
    await settled();
    assert.deepEqual(io.calls.filter((c) => c[0] === "launch"), [], "a press starts nothing");
    assert.deepEqual([tilesOn(el), one(el, "sd-task").value, one(el, "sd-task").focused, "disabled" in one(el, "sd-send").attrs], [["Catch me up"], "Catch me up.", true, false]);
    assert.deepEqual(line(el), ["Builder", "Max", "Sees this session since your last message and the running turn", "Read only", "Answer stays with you", "More"]);
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual(io.calls.filter((c) => c[0] === "launch"), [["launch", { prompt: "Catch me up.", as: "builder", start: "catchup", may: "read", running: true, changes: "", deliver: false, pause: false, inform: false }]]);
    assert.deepEqual([chat.side.open, threads.at(-1).o.id], ["s9", "s9"], "its thread opens");
    view.fresh();
    assert.deepEqual([tilesOn(el), one(el, "sd-task").value, chat.side.draft.start], [[], "", "ask"], "the next thread begins on asking, the first start that takes your words, with no tile on");
  });

  // (fails before: yes — the owner's word of 10-18: the tile launched at once, and a press could not be taken back)
  test("Catch me up's question gives way: another tile takes it back as it stood; words you changed or wrote stay, and they are what goes; at the limit Send is off; a refusal keeps the box", async () => {
    let facts = /** @type {any} */ (FACTS);
    const { io, view, chat, el } = viewOf({ facts: () => facts });
    view.paint(chat);
    shortcut(el, "Catch me up").dispatch("click");
    // (U13 W3) A tile chosen again lets go: Start… is back on asking.
    shortcut(el, "Catch me up").dispatch("click");
    assert.deepEqual([tilesOn(el), one(el, "sd-task").value, chat.side.draft.start], [[], "", "ask"], "a question left as it stood goes with the next choice");
    shortcut(el, "Catch me up").dispatch("click");
    write(el, "Catch me up on the tests.");
    shortcut(el, "Review my last change").dispatch("click");
    assert.deepEqual([tilesOn(el), one(el, "sd-task").value], [["Review my last change"], "Catch me up on the tests."], "one you changed is yours");
    write(el, "a draft of mine");
    shortcut(el, "Catch me up").dispatch("click");
    assert.deepEqual([tilesOn(el), one(el, "sd-task").value], [["Catch me up"], "a draft of mine"], "never over words you wrote");
    io.calls.length = 0;
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual(io.calls.filter((c) => c[0] === "launch").map((c) => [c[1].prompt, c[1].start, c[1].as]), [["a draft of mine", "catchup", "builder"]]);
    facts = { ...FACTS, limit: { max: 4, running: 4 } };
    view.fresh();
    shortcut(el, "Catch me up").dispatch("click");
    assert.deepEqual([tilesOn(el), "disabled" in shortcut(el, "Catch me up").attrs, "disabled" in one(el, "sd-send").attrs, textOf(one(el, "is-stop"))],
      [["Catch me up"], false, true, "4 of 4 agents are running on this chat's models, each at its limit: wait for one to finish"], "a choice is no launch: only Send waits for a seat");
    const refused = viewOf({ launch: async () => { throw new Error("no model can run it now"); } });
    refused.view.paint(refused.chat);
    shortcut(refused.el, "Catch me up").dispatch("click");
    one(refused.el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual([refused.io.calls.filter((c) => c[0] === "toast"), refused.chat.side.open, one(refused.el, "sd-task").value, tilesOn(refused.el)],
      [[["toast", "Not sent: no model can run it now", "err"]], "", "Catch me up.", ["Catch me up"]]);
  });

  // (fails before: yes — the owner's word of 10-18: the quiet line over the chat's box and the command center launched
  // Catch me up at once; each now opens the tab on its tile)
  test("begin: a new thread on a start's tile, its question in the box and nothing sent; asked before the starts are read, it is chosen once they are", () => {
    /** @type {any[]} */
    let starts = [];
    const { io, view, chat, el } = viewOf({ starts: () => starts });
    view.paint(chat);
    view.begin("catchup");
    assert.deepEqual([chat.side.begin, one(el, "sd-task").value], ["catchup", ""], "the starts not read yet: it waits for them");
    starts = STARTS;
    view.paint(chat);
    assert.deepEqual([chat.side.begin, tilesOn(el), one(el, "sd-task").value], [null, ["Catch me up"], "Catch me up."]);
    shortcut(el, "Catch me up").dispatch("click");
    write(el, "my own words");
    chat.side.open = "s1";
    one(el, "sd-task").focused = false;
    view.begin("catchup");
    assert.deepEqual([chat.side.open, tilesOn(el), one(el, "sd-task").value, one(el, "sd-task").focused], ["", ["Catch me up"], "my own words", true], "from a thread open: the new thread's box, and words you wrote stay");
    assert.deepEqual(io.calls.filter((c) => c[0] === "launch"), [], "nothing goes until Send");
  });

  // (fails before: yes — the popover's Spawn launched a worker by a start; nothing opened the new agent's thread)
  test("Enter sends: one launch as the line said, the box emptied, the thread opened; the next thread begins on the shortcut alone", async () => {
    const { io, view, chat, el, threads, files } = viewOf();
    view.paint(chat);
    shortcut(el, "Try it in a copy").dispatch("click");
    const box = write(el, "  fix the typo in the README  ");
    assert.equal("disabled" in one(el, "sd-send").attrs, false);
    files.list = [{ kind: "image", name: "shot.png", type: "image/png", data: "AAAA" }, { kind: "text", name: "notes.txt", text: "line one" }];
    io.calls.length = 0;
    box.dispatch("keydown", { key: "Enter", shiftKey: true });
    assert.deepEqual(io.calls, [], "Shift+Enter is a new line");
    box.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual(io.calls, [["launch", { prompt: "fix the typo in the README\n\nFile: notes.txt\n```\nline one\n```", as: "builder", images: [{ name: "shot.png", mediaType: "image/png", data: "AAAA" }],
      may: "edit", view: "folded", running: true, changes: "", worktree: true, deliver: false, pause: false, inform: false }]]);
    assert.deepEqual([box.value, files.list, chat.side.text, chat.side.open], ["", [], "", "s9"]);
    assert.deepEqual([threads.length, threads[0].o.chainId, threads[0].o.id, threads[0].mounted, threads[0].o.held], [1, "c1", "s9", 1, null]);
    assert.deepEqual([one(el, "sd-fresh").classList.contains("hidden"), one(el, "sd-conv").classList.contains("hidden"), textOf(one(el, "sd-head")), textOf(one(el, "sd-foot"))], [true, false, "head s9", "foot s9"]);
    assert.deepEqual(chat.side.draft, draftOn("job", "builder"));
  });

  // (fails before: yes — the bug hunt of 10-30, UIC-5: the box launched on the Enter that ends an input method's word
  // where the browser says it by keyCode 229 alone, as Windows' IMEs do — the chat's own box never sends on it)
  test("the Enter that ends an input method's word launches nothing; the next Enter does", async () => {
    const { io, view, chat, el } = viewOf();
    view.paint(chat);
    shortcut(el, "Try it in a copy").dispatch("click");
    const box = write(el, "日本語で");
    io.calls.length = 0;
    box.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 });
    await settled();
    assert.deepEqual(io.calls, [], "the word ended; nothing launched");
    box.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 });
    await settled();
    assert.equal(io.calls.filter((c) => c[0] === "launch").length, 1);
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-16, AG-130): the tab had no launch but its own box's; and
  // built on the shortcuts' rows, `/btw` typed before the tab had ever shown was refused: they were not read yet)
  test("/btw from the chat's box: a launch that names the Ask start, the server's to fill; the tab's draft stays; its thread opens; a refusal is the server's own words", async () => {
    const { io, view, chat, el, threads } = viewOf();
    view.paint(chat);
    shortcut(el, "Try it in a copy").dispatch("click");
    io.calls.length = 0;
    assert.equal(await view.ask(chat, "why is it slow?", [{ kind: "text", name: "log.txt", text: "took 9 s" }, { kind: "image", name: "a.png", type: "image/png", data: "QUJD" }]), null);
    assert.deepEqual(io.calls, [["launch", { start: "ask", prompt: "why is it slow?\n\nFile: log.txt\n```\ntook 9 s\n```", images: [{ name: "a.png", mediaType: "image/png", data: "QUJD" }] }]]);
    assert.deepEqual([chat.side.open, chat.side.draft, threads.at(-1).o.id], ["s9", draftOn("job", "builder"), "s9"], "its thread shows; the tab's own draft stays as it was");
    io.calls.length = 0;
    assert.match(String(await view.ask({ id: "draft", chainId: null }, "x")), /^A side question reads the session: send a first message/);
    assert.deepEqual(io.calls, [], "no session, no launch");
    // (fails before: yes — the owner's word of 10-30, PDFs in the box: a PDF from the chat's box went as a fenced
    // `undefined` under its name) A side question hands its agent pictures and text: a PDF is refused in words.
    assert.equal(await view.ask(chat, "what does it say?", [{ kind: "pdf", name: "report.pdf", type: "application/pdf", data: "JVBERi0=" }]), pdfRefused("report.pdf"));
    assert.deepEqual(io.calls, [], "a PDF asks no agent");
    // The tab never shown: no shortcut's row is read, no card either — the launch goes all the same.
    const cold = viewOf({ starts: () => [], cards: () => [] });
    assert.equal(await cold.view.ask(cold.chat, "x"), null);
    assert.deepEqual([cold.io.calls, cold.chat.side.open], [[["launch", { start: "ask", prompt: "x" }]], "s9"]);
    const full = viewOf({ launch: async () => { throw new Error("The limit is 4 at once, and 4 are running. Wait for one to finish."); } });
    await assert.rejects(full.view.ask(full.chat, "x"), /^Error: The limit is 4 at once/);
    assert.equal(full.chat.side?.open ?? null, null, "no thread opened");
  });

  // (fails before: yes — typed while a turn ran, `/btw …` went into that turn as a note: the main agent read the words;
  // typed idle, it began a turn)
  test("/btw in the main composer never reaches the session's send: it leaves before the agents' message, the queue and the running turn are looked at", () => {
    assert.deepEqual([btwOf("/btw why?"), btwOf("  /BTW  two\nlines "), btwOf("/btw"), btwOf("/btw   "), btwOf("/btween"), btwOf("say /btw x"), btwOf("")], ["why?", "two\nlines", "", "", null, null, null]);
    assert.match(BTW_USAGE, /^\/btw needs your question after it: \/btw <question>\./);
    const composer = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
    const send = composer.slice(composer.indexOf('const send = (modifier, asWritten = false, own = false, by = "click") => {'), composer.indexOf('ta.addEventListener("input"'));
    const at = send.indexOf("const side = onSide ? btwOf(text) : null;");
    assert.ok(at > 0 && at < send.indexOf("cb.onAsk(") && at < send.indexOf("cb.onSend("), "first of the send's ways");
    assert.match(send, /if \(onSide && side != null\) \{\n      if \(!side\) return void cb\.onToast\?\.\(BTW_USAGE\);/, "with no words the draft stays, and the page says what to type");
    assert.match(send, /Promise\.resolve\(onSide\(\{ question: side, files \}\)\)\.then\(\(ok\) => \{\n        if \(ok !== false\) return;\n        backInBox\(text, files, \[\]\);/, "a launch that did not start gives the draft back");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /onSide: async \(\{ question, files \}\) => \{\n    try \{\n      const why = await views\.side\.ask\(question, files\);\n      if \(why\) toast\(why, "err"\);\n      return !why;/);
    const host = readFileSync(new URL("../src/ui/harness/views/host.js", import.meta.url), "utf8");
    assert.match(host, /const why = await side\.ask\(chat, question, files\);\n        if \(!why\) show\("side"\);/, "the tab shows once the thread is open");
  });

  // (fails before: yes — `/btw` picked from the `/` panel put "/btw <question> " in the box, and the question typed
  // after it was asked with "<question>" before it)
  test("a command picked from the / panel puts its own words in the box, never the name of what to type", () => {
    assert.deepEqual(["/btw <question>", "/subagent ask <id> <follow-up>", "/autofit <30-95>", "/subagent list", "/status", "-low … -max"].map(typedOf),
      ["/btw ", "/subagent ask ", "/autofit ", "/subagent list ", "/status ", "-low … -max "]);
    const slash = readFileSync(new URL("../src/ui/harness/composer/slash.js", import.meta.url), "utf8");
    // Since UX7 the rows are `commandRows`'s, in groups (test/ctrl-k-settings.test.js: every row inserts typedOf(label)).
    assert.ok(slash.includes("const nameOf = (c) => String(c.command || `/${c.name || c}`);") && slash.includes("insert: typedOf(name)"), "the panel's command rows insert it");
  });

  // (fails before: yes — a refused launch closed the popover with the words in it)
  test("a refusal says why and keeps the box; at the session's limit Enter does not send, and the line under the box says so", async () => {
    let facts = FACTS;
    const { io, view, chat, el } = viewOf({ facts: () => facts, launch: async () => { throw new Error("a launch names a start or an agent, not both"); } });
    view.paint(chat);
    const box = write(el, "what is it doing?");
    io.calls.length = 0;
    one(el, "sd-send").dispatch("click");
    await settled();
    assert.deepEqual(io.calls, [["toast", "Not sent: a launch names a start or an agent, not both", "err"]]);
    assert.deepEqual([box.value, chat.side.open, "disabled" in one(el, "sd-send").attrs], ["what is it doing?", "", false]);

    facts = { ...FACTS, limit: { max: 4, running: 4 } };
    view.paint(chat);
    assert.deepEqual([one(el, "sd-send").attrs.disabled, textOf(one(el, "sd-notes")), one(el, "is-stop").attrs.class], ["", "4 of 4 agents are running on this chat's models, each at its limit: wait for one to finish", "sd-note is-stop"]);
    io.calls.length = 0;
    box.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual([io.calls, box.value, one(el, "is-stop").attrs.class], [[], "what is it doing?", "sd-note is-stop is-pressed"], "case 5: refused in words that name the limit, the draft kept");
  });

  // (fails before: yes — the choices were a panel of switches; none said its size or stayed under the card's level)
  test("the chips are menus: Sees with each size, May up to the card's, where the answer goes, More", () => {
    let facts = FACTS;
    const { io, view, chat, el, menus } = viewOf({ facts: () => facts });
    view.paint(chat);
    io.calls.length = 0;
    one(el, "is-sees").dispatch("click");
    assert.deepEqual(io.calls, [["readSizes", true]], "the two changes' sizes are asked for again as the menu opens");
    assert.deepEqual(menuRows(menus[0]), [
      ["label", "What it sees of this session"],
      ["radio", "Nothing", false], ["radio", "Folded", true], ["radio", "Context window", false], ["radio", "A live copy", false],
      ["check", "And the turn running now", true],
      ["separator", ""],
      ["label", "A change, as a patch"],
      ["radio", "No change", true], ["radio", "What this turn changed so far", false], ["radio", "The last turn's change", false], ["radio", "Everything uncommitted", false],
      ["node", ""],
    ]);
    assert.equal(menuRow(menus[0], "Folded").desc, "since the last compaction: each turn folded to your words, one line per tool call, and the reply · ~24k tokens");
    menuRow(menus[0], "Context window").onClick();
    menuRow(menus[0], "And the turn running now").onClick();
    menuRow(menus[0], "The last turn's change").onClick();
    assert.equal(line(el)[2], "Your agent's context window · 61k tokens, with the last turn's change");
    const since = menus[0].items.at(-1).node;
    one(since, "sd-since-in").value = " v1.2 ";
    buttonSaying(since, "Use").dispatch("click");
    assert.deepEqual([line(el)[2], menus[0].closed], ["Your agent's context window · 61k tokens, with the changes since v1.2", true]);
    menuRow(menus[0], "A live copy").onClick();
    assert.equal(line(el)[2], "A live copy of your agent · 80k tokens, with the changes since v1.2");

    facts = { ...FACTS, turnRuns: false, forkable: false };
    one(el, "is-sees").dispatch("click");
    assert.equal(menuRow(menus[1], "And the turn running now"), undefined, "case 20: no turn runs, no such line");
    assert.deepEqual([menuRow(menus[1], "A live copy").disabled, menuRow(menus[1], "A live copy").desc], [true, NO_COPY_YET]);
    facts = FACTS;
    menuRow(menus[1], "Folded").onClick();

    // May offers what its card may do, whoever it is (OA1): the Ask start lowered Builder to read only.
    one(el, "is-may").dispatch("click");
    assert.deepEqual(menuRows(menus[2]), [["label", "What it may do"], ["radio", "Read only: it changes nothing", true], ["radio", "Runs in its own copy, nothing kept", false], ["radio", "Edits in its own copy, you apply", false], ["radio", "Edits in the session's folder", false]]);
    menuRow(menus[2], "Edits in the session's folder").onClick();
    assert.deepEqual([line(el)[3], one(el, "is-may").kids[0].innerHTML], ["Edits in the session's folder", ICONS.pencil]);
    assert.match(textOf(one(el, "sd-notes")), /^It works in the session's folder, where your agent works: nothing waits for Apply\. \|Read only instead$/);
    buttonSaying(one(el, "sd-notes"), "Read only instead").dispatch("click");
    assert.deepEqual([line(el)[3], textOf(one(el, "sd-notes")), one(el, "is-may").kids[0].innerHTML], ["Read only", "", ICONS.lock], "case 13");

    one(el, "is-answer").dispatch("click");
    assert.deepEqual(menuRows(menus[3]), [["label", "Where its answer goes"], ["radio", "Stays with you", true], ["radio", "Goes to your agent when done", false]]);
    one(el, "is-more").dispatch("click");
    assert.deepEqual(menuRows(menus[4]), [["check", "Your agent waits for it", false, "off"], ["check", "Tell your agent it began", false, "off"]], "no switch for memory's brief: it opens every task (the owner's of 11-09)");
    assert.equal(menuRow(menus[4], "Your agent waits for it").desc, "Only for an answer that goes to your agent");
    menuRow(menus[3], "Goes to your agent when done").onClick();
    one(el, "is-more").dispatch("click");
    assert.deepEqual(menuRows(menus[5]).map((r) => r.at(-1)), [false, false], "its answer goes to your agent: both may be chosen");
    menuRow(menus[5], "Your agent waits for it").onClick();
    assert.deepEqual(line(el).slice(4), ["Answer goes to your agent", "More · 1"]);
    menuRow(menus[3], "Stays with you").onClick();
    assert.deepEqual([line(el).slice(4), chat.side.draft.pause], [["Answer stays with you", "More"], false], "kept with you again: nothing is held for it");
  });

  // (fails before: yes — a card that only reads showed the popover's Read-only switch on, as if it could be turned off)
  test("a card that only reads is offered nothing above it, and the menu says it is the card's (case 12)", () => {
    const { view, chat, el, menus } = viewOf();
    view.paint(chat);
    shortcut(el, "Review my last change").dispatch("click");
    one(el, "is-may").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["label", "What it may do"], ["radio", "Read only: it changes nothing", true], ["separator", ""], ["label", "Reviewer only reads, as its card says"]]);
  });

  // (fails before: yes — the popover said nothing of the price a thread on the main agent's model pays, or of a model that takes no tools)
  test("under the line: the main agent's price where no model was chosen, with one offer to pick another; a model that cannot run it (case 19)", async () => {
    let seen = false;
    const { io, view, chat, el, pickers } = viewOf({ fallsToMain: () => true, priceOf: () => "$3 in · $15 out per million", offered: { seen: () => seen, mark: () => { seen = true; } },
      modelProblem: async (/** @type {string} */ model) => (model === "tiny-1" ? "it takes no tools" : null) });
    view.paint(chat);
    await settled();
    assert.equal(textOf(one(el, "sd-notes")), "It runs on your agent's model, GLM-5.3 ($3 in · $15 out per million).| |Pick another for this thread");
    buttonSaying(one(el, "sd-notes"), "Pick another for this thread").dispatch("click");
    assert.deepEqual([pickers[0].opened, seen, textOf(one(el, "sd-notes"))], [1, true, "It runs on your agent's model, GLM-5.3 ($3 in · $15 out per million)."], "offered once");
    pickers[0].o.onChange("tiny-1");
    await settled();
    assert.equal(textOf(one(el, "sd-notes")), "Tiny 1 cannot run it now: it takes no tools", "a model picked: its own price is its picker's to say");
    pickers[0].o.onUseDefault();
    await settled();
    assert.match(textOf(one(el, "sd-notes")), /^It runs on your agent's model/);
    assert.equal(io.calls.filter((c) => c[0] === "toast").length, 0);
  });

  // (fails before: yes — nothing under the line said the chosen change was empty)
  test("Review where the last turn changed nothing: the note says so, and one click hands it the uncommitted change", () => {
    const facts = { ...FACTS, patches: { turn: { tokens: 0, files: 0, note: "turn 1 wrote nothing" }, uncommitted: { tokens: 300, files: 2 } } };
    const { view, chat, el } = viewOf({ facts: () => facts });
    view.paint(chat);
    assert.equal(byClass(el, "sd-note").length, 0, "Ask hands no change");
    shortcut(el, "Review my last change").dispatch("click");
    assert.equal(textOf(one(el, "sd-notes")), "No change goes with it: turn 1 wrote nothing.| |Hand it everything uncommitted, 2 files");
    buttonSaying(one(el, "sd-notes"), "Hand it everything uncommitted, 2 files").dispatch("click");
    assert.deepEqual([line(el)[2], byClass(el, "sd-note").length], ["Your words alone, with the uncommitted change", 0]);
  });

  // (fails before: yes — Enhance lived in the popover alone)
  test("Enhance rewrites the words as a brief, says what it read, and Undo brings yours back", async () => {
    const { io, view, chat, el } = viewOf();
    view.paint(chat);
    const box = write(el, "look at the token check");
    io.calls.length = 0;
    one(el, "sd-enhance").dispatch("click");
    assert.deepEqual([one(el, "sd-enhance").attrs.disabled, textOf(one(el, "sd-enhance")), box.readOnly], ["", "Enhancing", true]);
    await settled();
    assert.deepEqual(io.calls, [["enhance", "look at the token check", { readOnly: true, view: "folded" }]]);
    assert.deepEqual([box.value, box.readOnly, textOf(one(el, "sd-enhanced-words"))], ["Brief: look at the token check", false, "A brief| |Rewritten by the main agent from what it knows, 41k tokens read from its cache; nothing joined its conversation."]);
    buttonSaying(one(el, "sd-enhanced"), "Undo").dispatch("click");
    assert.deepEqual([box.value, chat.side.text, one(el, "sd-enhanced").classList.contains("hidden")], ["look at the token check", "look at the token check", true]);
  });

  // (fails before: yes — the owner's words of 10-25: the tab's number stayed until each answer was opened, and no row
  // said which)
  test("an answer of yours not opened wears a dot on its row until its thread opens; the main agent's never does", () => {
    const working = (/** @type {string} */ id, /** @type {any} */ over = {}) => agentRow(id, { status: "running", exchanges: [{ description: `Job ${id}`, startedAt: NOW - 6000, endedAt: null }], ...over });
    let rows = [working("s1"), working("s3", { origin: "agent" })];
    const { view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    assert.equal(byClass(el, "sd-unread").length, 0, "at work: no dot");
    rows = [agentRow("s1"), agentRow("s3", { origin: "agent" })];
    view.paint(chat);
    const dotted = () => byClass(el, "sd-row").filter((r) => one(r, "sd-unread")).map((r) => r.attrs["data-id"]);
    assert.deepEqual(dotted(), ["s1"], "yours, finished and not opened; the main agent's answer went to it");
    assert.equal(sideBadge(rows, chat.side.watch)?.text, "1", "the tab counts the rows with a dot");
    byClass(el, "sd-row").find((r) => r.attrs["data-id"] === "s1").dispatch("click");
    view.paint(chat);
    assert.deepEqual(dotted(), [], "opened: its dot is gone");
    assert.equal(sideBadge(rows, chat.side.watch), null, "and the tab's number with it");
  });

  // (fails before: yes — the owner's of 11-01: "when we press Hide from here the counter on Agents tab should also go
  // down ... pressing hide decrease the counter and mark that unread chat as read": a card hidden in the chat left its
  // answer unread until its thread was opened)
  test("an answer seen in the chat, its card hidden there, is opened: its row's dot and the tab's number go; an earlier answer's card leaves the newest unread", () => {
    const earlier = { description: "Earlier", startedAt: NOW - 90_000, endedAt: NOW - 80_000, delivery: "held" };
    const ran = (/** @type {string} */ id, /** @type {any[]} */ before = []) => agentRow(id, { status: "running", exchanges: [...before, { description: `Job ${id}`, startedAt: NOW - 6000, endedAt: null }] });
    const done = (/** @type {string} */ id, /** @type {any[]} */ before = []) => agentRow(id, { exchanges: [...before, { description: `Job ${id}`, startedAt: NOW - 6000, endedAt: NOW - 1000, delivery: "held" }] });
    let rows = [ran("s1"), ran("s2", [earlier])];
    const { view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    rows = [done("s1"), done("s2", [earlier])];
    view.paint(chat);
    const dotted = () => byClass(el, "sd-row").filter((r) => one(r, "sd-unread")).map((r) => r.attrs["data-id"]).sort();
    assert.deepEqual([dotted(), sideBadge(rows, chat.side.watch)?.text], [["s1", "s2"], "2"]);
    view.seen(chat, "s1", 0);
    view.paint(chat);
    assert.deepEqual([dotted(), sideBadge(rows, chat.side.watch)?.text], [["s2"], "1"], "s1's card hidden: its answer is read, its thread never opened");
    view.seen(chat, "s2", 0);
    view.paint(chat);
    assert.deepEqual([dotted(), sideBadge(rows, chat.side.watch)?.text], [["s2"], "1"], "its earlier answer's card: the newest is still unread");
    view.seen(chat, "s2", 1);
    view.paint(chat);
    assert.deepEqual([dotted(), sideBadge(rows, chat.side.watch)], [[], null]);
  });

  // (fails before: yes — U12-D3: the list was grouped by who called, and a row's face was no glyph of its card)
  test("the list: every agent in its group with its count; a row's glyph, name, who started it, task, fact and right; a row opens its thread, with the held words' store and the way to ask its agent yourself", () => {
    const rows = [
      agentRow("s1"),
      agentRow("s2", { status: "running", exchanges: [{ description: "Fix the typo", startedAt: NOW - 6000, endedAt: null }] }),
      // (OA1 case 14: a thread kept from before still carries its card's old kind; it is not read)
      agentRow("s3", { origin: "agent", card: { tag: "product", name: "Product", kind: "lead" } }),
    ];
    const held = { of: () => null };
    const { view, chat, el, threads } = viewOf({ rows: () => rows, held });
    view.paint(chat);
    assert.deepEqual(byClass(el, "sd-group").map((g) => [g.attrs.class, textOf(g)]), [["sd-group is-works", "Working|1"], ["sd-group is-done", "Done|2"]]);
    assert.deepEqual(byClass(el, "sd-row").map((r) => [r.attrs["data-id"], one(r, "sd-av").attrs.class, one(r, "sd-av").attrs.html === ICONS[r.attrs["data-id"] === "s3" ? "goal" : "hammer"],
      textOf(one(r, "sd-row-name")), textOf(one(r, "sd-row-who")), textOf(one(r, "sd-row-task")), textOf(one(r, "sd-row-fact")), textOf(one(r, "sd-row-right")), r.attrs["aria-current"]]), [
      ["s2", "sd-av", true, "Builder", "yours", "Fix the typo", "working", "6s", "false"],
      ["s1", "sd-av", true, "Builder", "yours", "Job s1", "answered", "$0.020 · 6s", "false"],
      ["s3", "sd-av", true, "Product", "your agent", "Job s3", "answered", "$0.020 · 6s", "false"],
    ]);
    assert.equal(one(el, "sd-new").classList.contains("is-on"), true);

    byClass(el, "sd-row")[2].dispatch("click");
    assert.deepEqual([chat.side.open, threads.length, threads[0].o.id, threads[0].o.held, one(el, "sd-new").classList.contains("is-on")], ["s3", 1, "s3", held, false]);
    assert.deepEqual(byClass(el, "sd-row").map((r) => r.attrs["aria-current"]), ["false", "false", "true"]);
    assert.equal(textOf(one(el, "sd-threads-words")), "Product", "narrow, the list's menu names the open thread");
    view.paint(chat);
    assert.equal(threads.length, 1, "a pulse draws the rows again, never the thread");
    threads[0].o.onAskSelf("product");
    assert.deepEqual([chat.side.open, chat.side.draft, threads[0].closed, one(el, "sd-task").focused], ["", draftOn(null, "product"), true, true], "a new thread with Product, the cursor in its box");

    view.open("s1", { followUp: true });
    assert.deepEqual([threads.length, threads[1].o.id, threads[1].focused], [2, "s1", true]);
    view.close();
    assert.equal(threads[1].closed, true, "another view shows: the thread is let go");
    view.paint(chat);
    assert.deepEqual([threads.length, threads[2].o.id], [3, "s1"], "and followed again when the tab comes back");
    view.fresh();
    assert.deepEqual([chat.side.open, one(el, "sd-fresh").classList.contains("hidden")], ["", false], "case 1: Alt+A on an open thread is a new one");
  });

  // (fails before: yes — narrow, the popover's list was all there was)
  test("narrow, the list is a menu in the thread's head: Start…, then each group's rows, each with its glyph and who started it", () => {
    const rows = [agentRow("s1"), agentRow("s3", { origin: "agent", card: { tag: "product", name: "Product" } })];
    const { view, chat, el, menus } = viewOf({ rows: () => rows });
    view.paint(chat);
    one(el, "sd-threads").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["item", "Start…"], ["label", "Done"], ["radio", "Builder: Job s1", false], ["radio", "Product: Job s3", false]]);
    assert.deepEqual([menuRow(menus[0], "Product: Job s3").desc, menuRow(menus[0], "Product: Job s3").icon], ["your agent · answered · $0.020 · 6s", "goal"]);
    menuRow(menus[0], "Builder: Job s1").onClick();
    assert.equal(chat.side.open, "s1");
  });

  // (fails before: yes — U12-D3: every thread the session kept stood in the list, the oldest as tall as the newest)
  test("past the newest six done, the rest fold under Earlier: unfolded on a click, and while the open thread is among them", () => {
    const rows = Array.from({ length: DONE_SHOWN + 2 }, (_, i) => agentRow(`s${i}`, { exchanges: [{ description: `Job ${i}`, startedAt: NOW - (i + 1) * 60_000, endedAt: NOW - (i + 1) * 60_000 + 1000, delivery: "held" }] }));
    const { view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    const ids = () => byClass(el, "sd-row").map((r) => r.attrs["data-id"]);
    const toggle = () => one(el, "sd-earlier");
    assert.deepEqual([ids(), textOf(one(el, "sd-group")), textOf(toggle()), toggle().attrs["aria-expanded"]], [rows.slice(0, DONE_SHOWN).map((r) => r.id), `Done|${DONE_SHOWN + 2}`, "Earlier · 2", "false"]);
    toggle().dispatch("click");
    assert.deepEqual([ids().length, textOf(toggle()), toggle().attrs["aria-expanded"]], [DONE_SHOWN + 2, "Fewer", "true"]);
    toggle().dispatch("click");
    assert.equal(ids().length, DONE_SHOWN);
    view.open(`s${DONE_SHOWN + 1}`);
    assert.deepEqual([ids().length, byClass(el, "sd-earlier").length], [DONE_SHOWN + 2, 0], "the open thread is never folded away");
  });

  // (fails before: yes — the owner's word of 10-22: a row under the pointer blinked four or five times a second, as each
  // pulse drew the list anew and the hovered row was a new one)
  test("a pulse keeps the list's rows: the same row stays under the pointer, what moved in it is drawn in place, and a row gone is let go", () => {
    /** @param {string} task */
    const working = (task) => agentRow("s2", { status: "running", exchanges: [{ description: task, startedAt: NOW - 6000, endedAt: null }] });
    let rows = [agentRow("s1"), working("Fix the typo")];
    const { view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    const [s2, s1] = byClass(el, "sd-row");
    const heads = byClass(el, "sd-group");
    const insides = s1.kids;
    view.paint(chat);
    assert.deepEqual([...byClass(el, "sd-row"), ...byClass(el, "sd-group")].map((n, i) => n === [s2, s1, ...heads][i]), [true, true, true, true], "the same nodes");
    assert.equal(s1.kids, insides, "a row whose words did not move is not drawn again");

    rows = [agentRow("s1"), working("Fix the other typo")];
    view.paint(chat);
    assert.deepEqual([byClass(el, "sd-row")[0] === s2, textOf(one(s2, "sd-row-task")), s2.attrs.title, s1.kids === insides], [true, "Fix the other typo", "Builder: Fix the other typo", true], "its words, in place");
    s1.dispatch("click");
    assert.deepEqual([byClass(el, "sd-row")[1] === s1, s1.attrs.class, s1.attrs["aria-current"], s2.attrs["aria-current"]], [true, "sd-row is-on", "true", "false"], "opened, the same row marked");

    rows = [working("Fix the other typo")];
    view.paint(chat);
    assert.deepEqual(byClass(el, "sd-row").map((r) => r.attrs["data-id"]), ["s2"]);
    rows = [agentRow("s1"), working("Fix the other typo")];
    view.paint(chat);
    assert.deepEqual([byClass(el, "sd-row")[1].attrs["data-id"], byClass(el, "sd-row")[1] === s1], ["s1", false], "a row that left and came back is drawn anew");
  });

  // (fails before: yes — a side agent's waiting call was answered in the dock, which this tab does not have)
  test("a thread whose agent asks you is answered in the thread; the answer it gets is opened (case 3)", async () => {
    /** @type {any[]} */
    let rows = [agentRow("s2", { status: "running", may: "edit", progress: { asking: { tool: "bash", args: "npm test", command: "npm test" } }, exchanges: [{ description: "Run the checks", startedAt: NOW - 6000, endedAt: null }] })];
    const { io, view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    view.open("s2");
    const strip = one(one(el, "sd-asks"), "ask-strip");
    assert.deepEqual([one(el, "sd-asks").classList.contains("hidden"), strip.attrs["aria-label"], textOf(strip).split("|").slice(0, 3)], [false, "Builder asks you", ["Builder", "wants to run", "npm test"]]);
    assert.deepEqual([textOf(one(el, "sd-group")), textOf(one(byClass(el, "sd-row")[0], "sd-row-fact")), one(byClass(el, "sd-row")[0], "sd-dot").attrs.class], ["Needs you|1", "wants to run npm test", "sd-dot is-asks"]);
    view.paint(chat);
    assert.equal(one(one(el, "sd-asks"), "ask-strip"), strip, "the same call from pulse to pulse: its answers stand");
    io.calls.length = 0;
    buttonSaying(strip, "Allow").dispatch("click");
    await settled();
    assert.deepEqual(io.calls, [["answer", "s2", { allow: true, words: "" }]]);
    rows = [agentRow("s2", { exchanges: [{ description: "Run the checks", startedAt: NOW - 6000, endedAt: NOW }] })];
    view.paint(chat);
    assert.deepEqual([one(el, "sd-asks").classList.contains("hidden"), one(el, "sd-asks").kids, view.badge(chat)], [true, [], null], "answered while its thread shows: nothing is unread");
  });

  // (fails before: yes — an answer that came while another view showed left no mark anywhere)
  test("the badge counts an answer that came while its thread was not open, until the thread — here or beside the chat — is opened", () => {
    /** @type {any[]} */
    let rows = [agentRow("s2", { status: "running", exchanges: [{ description: "Fix", startedAt: NOW - 6000, endedAt: null }] })];
    /** @type {string[]} */
    let beside = [];
    const { view, chat } = viewOf({ rows: () => rows, beside: () => beside });
    assert.deepEqual(view.badge(chat), { dot: "works", words: "1 working" });
    rows = [agentRow("s2", { exchanges: [{ description: "Fix", startedAt: NOW - 6000, endedAt: NOW }] })];
    assert.deepEqual(view.badge(chat), { text: "1", words: "1 answer you have not opened" });
    assert.equal(view.badge({ id: "draft", chainId: null }), null);
    beside = ["s1", "s2"];
    assert.equal(view.badge(chat), null, "shown in a pane beside the chat: opened");
  });

  // (fails before: yes — the owner's word of 10-29: "i have pressed stop button for trying to stop the sub agent but end
  // up stopping the main agent … this bar is not needed inside Agents tab": a bar under the tab said what the main agent
  // did, its Stop the main agent's)
  test("the tab draws no bar of the main agent's: a Stop on it stops an agent of the list, never the main agent", () => {
    const rows = [agentRow("s1", { status: "running", exchanges: [{ description: "Run the checks", startedAt: NOW - 6000, endedAt: null }] })];
    const { view, chat, el } = viewOf({ rows: () => rows });
    view.paint(chat);
    view.open("s1");
    view.paint(chat);
    assert.equal(one(el, "sd-strip"), undefined, "no strip under the tab");
    const mains = all(el, (x) => /main agent/i.test(String(x.attrs?.title || "")) && x.tag === "button").map((x) => x.attrs.title);
    assert.deepEqual(mains.filter((t) => /stop/i.test(t)), [], "no button stops the main agent's turn");
    assert.deepEqual(el.kids.map((/** @type {any} */ k) => k.attrs?.class), ["sd-main"], "the tab is its list and its thread alone");
  });

  // (fails before: yes — the popover's draft was one for the page: another chat's words stood in it)
  test("each chat keeps its own draft, its files and its open thread", () => {
    const { view, chat, el, files } = viewOf();
    view.paint(chat);
    write(el, "for the first chat");
    files.list = [{ kind: "text", name: "a.txt", text: "a" }];
    const other = /** @type {any} */ ({ id: "chat-2", chainId: "c2", turns: [] });
    view.paint(other);
    assert.deepEqual([one(el, "sd-task").value, files.list, chat.side.files.map((/** @type {any} */ f) => f.name)], ["", [], ["a.txt"]]);
    write(el, "for the second");
    view.paint(chat);
    assert.deepEqual([one(el, "sd-task").value, files.list.map((f) => f.name), other.side.text], ["for the first chat", ["a.txt"], "for the second"]);
  });

  // (fails before: yes — the popover's own words were the leaving ones: Spawn, sub-agent, view, fork)
  test("the tab's own words hold none of the leaving words (case 17)", async () => {
    const rows = [
      agentRow("s1", { work: { pending: 2 } }),
      agentRow("s2", { status: "running", progress: { asking: { tool: "bash", args: "npm test" } }, exchanges: [{ description: "Run the checks", startedAt: NOW - 6000, endedAt: null }] }),
      agentRow("s3", { origin: "agent", card: { tag: "product", name: "Product" }, status: "failed" }),
    ];
    let facts = /** @type {any} */ (FACTS);
    const { view, chat, el, menus } = viewOf({ rows: () => rows, facts: () => facts, fallsToMain: () => true, priceOf: () => "$3 in · $15 out per million", modelProblem: async () => "it takes no tools" });
    /** @type {string[]} */
    const said = [];
    /** Everything a node says: its text, and what its controls are called. @param {any} n */
    const hear = (n) => all(n, () => true).forEach((x) => {
      for (const k of x.kids || []) if (typeof k !== "object") said.push(String(k));
      for (const a of ["title", "aria-label", "placeholder"]) if (x.attrs?.[a]) said.push(String(x.attrs[a]));
    });
    view.paint(chat);
    await settled();
    for (const cls of ["is-sees", "is-may", "is-answer", "is-effort", "is-more", "sd-threads", "sd-agent"]) one(el, cls).dispatch("click");
    one(el, "is-may").dispatch("click");
    menuRow(menus.at(-1), "Edits in the session's folder").onClick();
    write(el, "x");
    hear(el);
    facts = { ...FACTS, limit: { max: 4, running: 4 }, forkable: false, turnRuns: false };
    view.paint(chat);
    one(el, "is-sees").dispatch("click");
    one(el, "is-more").dispatch("click");
    hear(el);
    view.open("s2");
    hear(el);
    for (const m of menus) for (const i of m.items) { said.push(String(i.label || ""), String(i.desc || "")); if (i.node) hear(i.node); }
    said.push(NO_COPY_YET, enhanceWords(/** @type {any} */ ({ state: "warm", running: false, leftMs: 1000, tokens: 10 })), enhanceWords(/** @type {any} */ ({ state: "cold" })), enhanceWords(/** @type {any} */ ({ running: true })));
    for (const r of rows) said.push(noBoxWhy(r)?.words || "");
    // The cards' own lines are their writers' words, and "Builder" is a card's name: neither is the tab's.
    const own = said.filter((s) => s && !CARDS.some((c) => c.goodFor === s)).join("\n");
    assert.ok(own.length > 1500, "the tab was heard");
    // (proposal_ux N2, 10-18: "sub-agent" is the page's word again — the tab is Sub Agents, its seats Default models for
    // sub-agents; U13, 10-20: the tab is Agents, and its one way to begin is Start…, the plan's word — and its Quick
    // starts, the plan's too, W3)
    for (const leaving of [/\bhelpers?\b/, /\btypes?\b/i, /\broles?\b/i, /(?<!quick )\bstart(s|ed|ing)?\b(?!…)/i, /\bpersonas?\b/i, /\bspawn/i, /\baside\b/i, /\bvoices?\b/i, /\bfork/i])
      assert.equal(leaving.exec(own)?.[0], undefined, `the tab says “${leaving.exec(own)?.[0]}” near: ${own.slice(Math.max(0, (leaving.exec(own)?.index || 0) - 60), (leaving.exec(own)?.index || 0) + 60)}`);
  });
});

describe("Side: a tab among the session's views", () => {
  /** A host on the fake DOM. @param {Record<string, any>} [side] the Side IO's parts */
  function hostOf(side = {}) {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    /** @type {(() => void)[]} */
    const due = [];
    /** @type {any[]} */
    const shown = [];
    const io = sideIO(side);
    const s = sideSeams();
    const views = createViews({
      frame,
      slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH,
      api: async () => null,
      openAgent: () => {},
      openRunLog: () => {},
      onShow: (chat) => { shown.push([chat.id, chat.viewTab]); },
      loadRun: () => Promise.resolve(),
      later: (fn) => { due.push(fn); },
      team: teamIO({ rows: io.rows }),
      side: /** @type {any} */ (io),
      sideSeams: s.seams,
      place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
      modelSelect: modelSelects().make,
    });
    return { frame, slot, due, shown, views, io, ...s, sideEl: frame.kids[1] };
  }
  const chat = () => /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [], view: { settings: { effective: {} } } });
  /** A view's tab. @param {any} slot @param {string} id */
  const tabOf = (slot, id) => buttonsOf(slot).find((b) => b.attrs["data-view"] === id);

  // (fails before: yes — a session had three views, and `/side` opened its conversation)
  test("the address carries it, Alt+3 brings it, and Alt+A is the key for a new thread", () => {
    assert.deepEqual(VIEWS, ["chat", "overview", "side", "team", "plan"]);
    assert.deepEqual(parseRoute("#/task/abc/side"), { kind: "task", id: "abc", view: "side" });
    assert.equal(routeFor("task", { id: "abc", view: "side" }), "#/task/abc/side");
    assert.deepEqual([comboOf("view-side"), comboOf("subagent")], ["Alt+3", "Alt+A"]);
    assert.equal(matchShortcut(/** @type {any} */ ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: "£", code: "Digit3", repeat: false, isComposing: false })), "view-side", "a Mac's Option+3");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /"view-side": \(\) => views\.show\("side"\),/);
    // (fails before: yes — with no session yet, Alt+A opened the Agents popover; AG-144: it says `/btw`'s sentence)
    assert.match(app, /subagent: \(\) => \(chatOf\(state\.currentId\)\?\.chainId \? views\.side\.fresh\(\) : toast\(NO_SESSION_YET\)\),/);
    assert.match(app, /import \{ NO_SESSION_YET, SIDE_EFFORTS, isGuest, ownGearPaths, rowIcon, sideTeamItem \} from "\.\/lib\/side\.js";/);
    assert.match(app, /\{ id: "view-side", label: "Show Agents", icon: "users",[^\n]*run: \(\) => views\.show\("side"\) \},/);
    assert.match(app, /\{ id: "side-new", label: "Ask on the side",[^\n]*shortcut: "subagent",[^\n]*run: \(\) => views\.side\.fresh\(\) \},/);
  });

  // (fails before: yes — there was no Side panel in the frame; HarnessV4_Tasks U12-D1: the tab was named Side; U13-D5:
  // Agents, the Teams tab made one with it)
  test("the tab, named Agents, shows its view in the frame, drawn once it shows; it lets its thread go when another view comes", () => {
    const rows = [agentRow("s1")];
    const { frame, slot, shown, views, sideEl, threads } = hostOf({ rows: () => rows });
    assert.deepEqual([sideEl.attrs.class, sideEl.attrs.role, sideEl.attrs["aria-label"]], ["vw vw-side", "tabpanel", "Agents"]);
    const c = chat();
    views.setChat(c);
    // The Overview tab shows only while its view does, and a while after (the owner's of 10-30).
    assert.deepEqual(buttonsOf(slot).map((b) => [b.attrs["data-view"], b.attrs["aria-selected"], b.classList.contains("hidden")]), [["chat", "true", false], ["overview", "false", true], ["side", "false", false], ["team", "false", true], ["plan", "false", true]]);
    assert.equal(textOf(tabOf(slot, "side")).replace(/\|/g, " ").trim().startsWith("Agents"), true);
    assert.deepEqual([frame.classList.contains("view-side"), sideEl.kids[0].kids], [false, []], "not drawn until it shows");
    views.side.open("s1");
    assert.deepEqual([views.view, shown, frame.classList.contains("view-side"), frame.classList.contains("view-team"), threads.length, threads[0].o.id], ["side", [["chat-1", "side"]], true, false, 1, "s1"]);
    views.show("chat");
    assert.deepEqual([frame.classList.contains("view-side"), threads[0].closed], [false, true]);
    views.side.fresh("product");
    assert.deepEqual([views.view, c.side.open, c.side.draft], ["side", "", draftOn(null, "product")]);
    // (fails before: yes — the owner's word of 10-18: the quiet line and the command center launched Catch me up at once)
    views.show("chat");
    views.side.begin("catchup");
    assert.deepEqual([views.view, c.side.open, c.side.draft?.start, c.side.text], ["side", "", "catchup", "Catch me up."], "its tile chosen, its question in the box: nothing goes until Send");
    views.setChat({ id: "draft", chainId: null });
    assert.deepEqual([views.view, slot.kids], ["chat", []], "a chat with no session has no tabs (case 2)");
    views.side.fresh();
    views.side.begin("catchup");
    assert.equal(views.view, "chat");
  });

  // (fails before: yes — the tab did not exist to wear a badge, and its clocks had no pulse)
  test("the tab wears its badge from any view, and the pulses go on while an agent of the session works", () => {
    /** @type {any[]} */
    let rows = [agentRow("s2", { status: "running", exchanges: [{ description: "Fix", startedAt: NOW - 6000, endedAt: null }] })];
    const { slot, due, views } = hostOf({ rows: () => rows });
    views.setChat(chat());
    const badge = () => byClass(tabOf(slot, "side"), "view-badge")[0];
    assert.deepEqual([tabOf(slot, "side").attrs["aria-label"], badge().classList.contains("is-asks"), textOf(badge())], ["Agents, 1 working", false, "1"]);
    views.show("side");
    views.pulse();
    assert.equal(due.length, 1);
    due.shift()?.();
    assert.equal(due.length, 1, "work goes on: so do the pulses, and the rows' clocks move");
    rows = [agentRow("s2")];
    due.shift()?.();
    assert.equal(due.length, 0, "nothing runs: the pulses rest");
    assert.deepEqual([textOf(badge()), tabOf(slot, "side").attrs["aria-label"]], ["1", "Agents, 1 answer you have not opened"]);
  });

  // (fails before: yes — a view kept the dock under it; in this tab that would be two boxes, and a slip between them;
  // U13-D5: but under the team in charge, whose lead is who you talk to, as under the Teams tab it stood)
  test("the dock is not in this tab but under the team in charge, and the conversation's parts make way as for the other views (AG-100)", () => {
    const side = readFileSync(new URL("../src/ui/harness/views/side.css", import.meta.url), "utf8");
    assert.match(side, /\.conv-frame\.view-side > \.vw-side \{ display: flex; flex: 1 1 auto; min-height: 0; container: side \/ inline-size; \}/);
    assert.match(side, /\.conv-frame\.view-side:not\(\.side-team\) > \.dock \{ display: none; \}/);
    assert.match(side, /@container side \(max-width: 720px\) \{\n\s*\.sd-list \{ display: none; \}\n\s*\.sd-bar \.sd-threads \{ display: inline-flex; \}\n\s*\.sd-bar \.sd-gear \{ display: inline-grid; \}/, "case 14: narrow, the list folds into the bar's menu, the gear beside it");
    const views = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    assert.match(views, /\.conv-frame:is\(\.view-plan, \.view-team, \.view-side, \.view-pane\) > :is\(\.status-panel, \.transcript,/);
    assert.match(readFileSync(new URL("../src/ui/harness.html", import.meta.url), "utf8"), /<link rel="stylesheet" href="\/ui\/harness\/views\/side\.css" \/>/);
  });

  // (fails before: yes — app.js gave the views no Side: a launch from the tab had no door)
  test("the page gives the tab its doors: the session's agents, the sizes, a launch by tag, the held words", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    // (fails before: yes — the owner's word of 10-18: Catch me up was launched on one press of the quiet line; now it is
    // sent from the tab, and the line goes and its answer stands open in the chat as before)
    assert.match(app, /launch: async \(body\) => \{\n\s*const chain = subagentStore\.chainId\(\);\n\s*const row = await subagentRoutes\(chain\)\.spawn\(body\);\n(\s*\/\/[^\n]*\n)+\s*if \("start" in body && sideStarts\.some\(\(s\) => s\.id === body\.start && s\.task\)\) \{\n\s*caughtUp\(chain\);\n\s*const chat = chatOf\(state\.currentId\);\n\s*if \(chat\?\.chainId === chain\) \(chat\.cardsOpen \|\|= new Set\(\)\)\.add\(`\$\{row\.id\}:0`\);\n\s*\}\n\s*await subagentStore\.refresh\(\);\n\s*return row;\n\s*\},/,
      "a Catch me up sent from the tab clears the quiet line over the chat's box, and its card stands open in the chat (AG-207)");
    // (fails before: yes — U12-D2, U12-D5, U12-D6, U12-D7: the tab had no team's leads, no seats, no effort)
    assert.match(app, /cards: \(\) => agentCards\.all\(\),\n(?:\s*\/\/[^\n]*\n)?\s*teamsList: \(\) => sendable\(sessionChat\(\)\?\.view\?\.settings\?\.engine\),\n\s*brief: \(fill\) => openBriefNow\(fill\),\n\s*starts: \(\) => sideStarts,/, "Start…'s teams, and their Brief (U13 W3)");
    assert.match(app, /const sendable = \(engine\) => \(teamsOn\(state\.config\) && Array\.isArray\(engine\?\.teams\) \? engine\.teams : \[\]\);/, "none while Settings › Experimental's Teams switch is off");
    assert.ok(!app.includes("setWorkers"), "the tab writes no Workers: the Team tab holds their one picker");
    // The main agent's effort, as the chat sets it (the owner's of 11-05).
    assert.match(app, /defaultEffort: SIDE_EFFORTS\.includes\(String\(eff\?\.model\?\.effort\)\) \? String\(eff\.model\.effort\) : "model",/);
    assert.match(app, /seats: chat\?\.chainId \? subagentStore\.seats\(\) : null,/);
    assert.match(app, /subagentRoutes\(chain\)\.views\(\{ changes: patches \}\)\.then\(\(v\) => \{\n\s*if \(v\.starts\?\.length\) sideStarts = v\.starts;/);
    assert.match(app, /held: heldAsks,\n\s*toast,\n\s*offered: \{ seen: \(\) => store\.get\(SIDE_OFFERED\) === "on", mark: \(\) => store\.set\(SIDE_OFFERED, "on"\) \},/);
    assert.match(app, /state\.families = models\.families \|\| \[\];/);
  });
});

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-8, AG-127, AG-128): one button in the thread's head sent the newest
// report into whatever the main agent was doing)
test("Send to main agent, under each answer: its choices follow what the main agent does, an answer that left your hands says where it went, and the head has no Send", () => {
  const of = (/** @type {"works" | "asks" | "idle"} */ state) => sendChoices(state).map((c) => [c.label, c.when, c.line]);
  assert.deepEqual(of("works"), [["Now", "now", false], ["With my next message", "next", false]]);
  assert.deepEqual(of("idle"), [["Now", "now", true], ["With my next message", "next", false]], "idle, Now is a turn of its own: it takes a line of yours");
  assert.deepEqual(of("asks"), [["With my answer", "next", false]], "a line of yours would be read as the answer it waits for");
  assert.match(sendChoices("works")[0].desc, /at its next step/);
  assert.match(sendChoices("works")[1].desc, /the turn running now does not read it by itself/);
  assert.match(sendChoices("idle")[0].desc, /a line of yours/);
  assert.equal(ACT_ON_REPORT, "Act on this report");
  assert.deepEqual(["held", "sent", "auto", "tool", "task", null].map((d) => deliveryFact(/** @type {any} */ (d))), ["", "Sent to the main agent", "It went to the main agent", "It answered the main agent's call", "", ""]);
  // A worker's report Filament sent back, its check having failed (HarnessV3-TaskGraph-v2 TG2-D45).
  assert.equal(deliveryFact("back"), "Filament's check of it failed, and it went back to the worker");
  assert.deepEqual([sentWords("next", "queue"), sentWords("now", "turn"), sentWords("now", "queue")], ["It goes with your next message", "Sent — the running turn reads it at its next step", "Sent — it opens the main agent's next turn"]);
  const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
  // The row: what stands where the answer is no longer yours, why none is offered in a chat an outside client writes,
  // the line while it is written, else the button — and Copy beside each.
  assert.match(viewer, /if \(current\.delivery !== "held" \|\| !o\.onward\) return void actsBox\.replaceChildren\(note\(deliveryFact\(current\.delivery\)\), copy\);\n    if \(outside\) return void actsBox\.replaceChildren\(note\(`\$\{outside\} writes this session's turns: copy the answer over to pass it on`\), copy\);\n    if \(line != null\) \{/);
  assert.match(viewer, /menu\(sendChoices\(\/\*\* @type \{NonNullable<typeof o\.onward>\} \*\/ \(o\.onward\)\.main\.state\(\)\)\.map\(/, "the choices are read when the menu opens: what the main agent does then");
  assert.match(viewer, /if \(!c\.line\) return void pass\(c\.when\);\n        line = ACT_ON_REPORT;/);
  assert.match(viewer, /const out = await way\.send\(index, when\);\n      line = null;\n[^\n]*\n      if \(first != null\) way\.main\.start\(first\);\n      else o\.toast\(sentWords\(when, out\.into\)\);/, "sent first, then the turn begins through the page's own send");
  assert.match(viewer, /onward: \{ main, send: passOn \}/, "Filament's own agent's answer has its way on: the session's main agent, and the hand-over");
  assert.match(viewer, /const go = \(\) => void pass\("now", input\.value\.trim\(\) \|\| ACT_ON_REPORT\);/);
  assert.match(viewer, /const out = await routes\.send\(id, exchange, when\);/, "each answer sends its own exchange");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /return m\.live \? "works" : m\.paused \? "asks" : "idle";/);
  assert.match(app, /start: \(line\) => \{\n    views\.show\("chat"\);\n    void sendOrQueue\(line\);/, "Chat shows, and the turn starts by the page's one send, or waits in the chat's queue behind a held row (AG-127)");
  for (const host of ["main: mainDoor, held: heldAsks", "\n    mainDoor,\n"]) assert.ok(app.includes(host), `every host of a thread hands it the main agent: ${JSON.stringify(host)}`);
});
