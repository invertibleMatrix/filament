// @ts-check
// HarnessV4_Tasks E15 step 2, the page: a message that starts with a saved agent's tag. The line over the composer
// says who gets the draft, on which model, what they are shown, and why it does not go yet; a first `@word` that names
// no agent is held once. In the chat a question and its answer are one card (AG-21), drawn at the mark it was sent off
// with and taking the answer from the mark it came back with; while the agent works it follows the session's list.
// Beside the chat an agent's thread has a tile of its own (test/live-work.test.js). On the stub document, with the
// page's own `h`.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { h } from "../src/ui/lib/dom.js";
import { askLineWords, createAskLine } from "../src/ui/harness/composer/ask-line.js";
import { agentCardRow, cardFacts, cardState, firstLine, liveLine } from "../src/ui/harness/conversation/agent-card.js";
import { subagentMarkRow } from "../src/ui/harness/conversation/subagent-marks.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { answerFact, cardMarksOf, copyFact, handedWords, mayFact, modelFact, nearestCards, seesFact, seesWords } from "../src/ui/harness/lib/agent-cards.js";
import { CLOSED_CHATS_MAX, CLOSED_PER_CHAT_MAX, createClosedCards } from "../src/ui/harness/lib/closed-cards.js";
import { subagentViewFact } from "../src/ui/harness/lib/labels.js";
import { readFileSync } from "node:fs";
import { createAgentCardStore } from "../src/services/agent-cards.js";

const store = createAgentCardStore({ dataDir: null });
/** @param {string} tag @returns {any} */
const lead = (tag) => store.find(tag);
/**
 * A shipped lead set in place to see the session folded and the turn running now: one as it ships sees nothing of it
 * (the owner's words of 10-19). @param {string} tag @returns {any}
 */
const seeing = (tag) => ({ ...store.find(tag), sees: { view: "folded", running: true, changes: null } });
/** The saved agents as the page holds them. @returns {any[]} */
const cards = () => store.list();
/** A running agent's progress, said in part. @param {any} p */
const live = (p) => liveLine(p);
/** A card of your own. @param {string} tag @param {string} name @param {any} [o] @returns {any} */
const own = (tag, name, o = {}) => ({ tag, name, kind: "lead", goodFor: "A second look", thinks: "You look twice.", may: "read", model: null, sees: { view: "none", running: false, changes: null }, shipped: false, ...o });
/** What the line knows of a session. @param {Partial<import("../src/ui/harness/composer/ask-line.js").AskFacts>} [o] @returns {import("../src/ui/harness/composer/ask-line.js").AskFacts} */
const facts = (o = {}) => ({ defaultModel: "zai/glm-5.3", tokens: { none: 0, folded: 38_000, window: 90_000 }, running: false, runningTokens: 0, limit: { max: 4, running: 0 }, refusedPictures: () => false, families: [], ...o });
/** Every button under an element, by its words. @param {any} el @param {string} words */
const btn = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words) || null;
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

// (fails before: yes — there was no line: a draft that started with a tag went to the main agent as any message)
describe("the line over the composer", () => {
  const draft = (/** @type {any[]} */ to, o = {}) => ({ to, question: "should a fifth launch queue or fail?", files: 0, pictures: 0, ...o });

  test("who gets the draft, on which model, what they are shown and how large it is, and that the main agent hears nothing", () => {
    // (fails before: yes — the owner's words of 10-19: a shipped lead saw the session, so its second opinion was the main agent's)
    assert.deepEqual(askLineWords(draft([lead("product")]), facts({ running: true, runningTokens: 6_000 })), { who: "Product", facts: ["GLM-5.3", "sees your question alone", "not to the main agent"], stop: null, note: null, canSpread: false, models: null });
    assert.deepEqual(askLineWords(draft([seeing("product")]), facts()), { who: "Product", facts: ["GLM-5.3", "sees this session, 38k tokens", "not to the main agent"], stop: null, note: null, canSpread: false, models: null });
    // A turn runs, and the leads' card shows it: its size is in the figure.
    assert.deepEqual(askLineWords(draft([seeing("product"), seeing("builder")]), facts({ running: true, runningTokens: 6_000 })).facts, ["GLM-5.3", "sees this session and the turn running now, 44k tokens", "not to the main agent"]);
    assert.equal(askLineWords(draft([seeing("product"), seeing("builder")]), facts()).who, "Product and Builder");
    // The sizes not read yet: said without a figure, never a wrong one.
    assert.equal(askLineWords(draft([seeing("product")]), facts({ tokens: null })).facts[1], "sees this session");
    // A chat with no turn yet has nothing to show.
    assert.equal(askLineWords(draft([seeing("product")]), facts({ tokens: {} })).facts[1], "this chat has nothing to show yet");
    // (fails before: yes — there was no context window to see) The window holds the running turn: it is not counted twice.
    const win = own("win", "Window", { sees: { view: "window", running: true, changes: null } });
    assert.equal(askLineWords(draft([win]), facts({ running: true, runningTokens: 6_000, tokens: { window: 120_000 } })).facts[1], "sees the main agent's context window, 120k tokens");
    // A card that sees the question alone, and one that also sees the running turn.
    assert.equal(askLineWords(draft([own("fresh", "Fresh eyes")]), facts({ running: true })).facts[1], "sees your question alone");
    assert.equal(askLineWords(draft([own("watch", "Watcher", { sees: { view: "none", running: true, changes: null } })]), facts({ running: true, runningTokens: 6_000 })).facts[1], "sees your question and the turn running now, 6.0k tokens");
    // Cards that see different things, and cards on different models.
    const mixed = askLineWords(draft([seeing("product"), own("fresh", "Fresh eyes", { model: "grok-4.6" })]), facts());
    assert.deepEqual(mixed.facts, ["GLM-5.3 and Grok 4.6", "each sees what its card says", "not to the main agent"]);
  });

  // (fails before: yes — a range in a draft was the question's own words, and a worker's card, which sees the
  // session, read "this chat has nothing to show yet")
  test("a range named after the tags is the change they are handed; a worker asked by its tag sees what its card says", () => {
    const reviewer = own("reviewer", "Reviewer", { kind: "worker", sees: { view: "folded", running: false, changes: null } });
    const line = createAskLine({ cards: () => [lead("product"), reviewer], facts: () => facts(), onPick: () => {} });
    assert.deepEqual(line.read("@reviewer since:v1.2 what broke?", []), { to: [reviewer], unknown: [], question: "what broke?", changes: "since:v1.2", stop: null, models: null });
    assert.deepEqual(line.read("@reviewer @product since:release/2026.10~3 what broke?", []).changes, "since:release/2026.10~3");
    assert.deepEqual(line.read("@reviewer since:v1.2", []).stop, "Ask Reviewer something", "a range is no question");
    // Anywhere else the token is the question's own words; so is any other word with a colon.
    assert.deepEqual([line.read("@product what changed since:v1.2?", []).changes, line.read("@product note: since:v1.2", []).changes, line.read("since:v1.2 @product hello", []).to], [null, null, []]);
    assert.deepEqual(askLineWords({ to: [{ ...reviewer, sees: { view: "none", running: false, changes: null } }], question: "what broke?", changes: "since:v1.2", files: 0, pictures: 0 }, facts()).facts, ["GLM-5.3", "sees your question alone", "with the changes since v1.2", "not to the main agent"]);
    assert.equal(askLineWords({ to: [reviewer], question: "what broke?", files: 0, pictures: 0 }, facts()).facts[1], "sees this session, 38k tokens");
    assert.equal(askLineWords({ to: [reviewer, seeing("product")], question: "what broke?", files: 0, pictures: 0 }, facts()).facts[1], "sees this session, 38k tokens", "the same view, said once");
    const slash = readFileSync(new URL("../src/ui/harness/composer/slash.js", import.meta.url), "utf8");
    assert.ok(slash.includes('kind === "@" && withAgents ? h("span", { class: "slash-key slash-tip" }, h("kbd", {}, "since:v1.2"), "after a tag: it reads the changes since then") : null'), "the @ panel's foot names the token");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.ok(app.includes("as: tags, ...(models ? { models } : {}), ...(images.length ? { images } : {}), ...(changes ? { changes } : {}) });"), "and the send carries it");
  });

  // (fails before: yes — the line asked for every size the route knows, the folder's uncommitted patch among them)
  test("the line asks for the sizes it shows, and for no change's", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /subagentRoutes\(chain\)\.views\(\{ changes: false \}\)\.then\(\(v\) => \{\s*\n\s*if \(askSizes\.chain !== chain\) return;/);
    const routes = readFileSync(new URL("../src/ui/harness/lib/subagents.js", import.meta.url), "utf8");
    assert.ok(routes.includes('const r = await api(`${base}/views${changes ? "" : "?changes=0"}`);'));
  });

  test("why a draft does not go yet: nothing asked, or more agents than the session has room for", () => {
    assert.equal(askLineWords(draft([lead("product"), lead("builder")], { question: "" }), facts()).stop, "Ask Product and Builder something");
    assert.equal(askLineWords(draft([lead("product")], { question: "", files: 1 }), facts()).stop, "Ask Product something", "a file alone is no question");
    assert.equal(askLineWords(draft([lead("product")]), facts({ limit: { max: 4, running: 4 } })).stop, "4 of 4 agents are running: one more does not fit — wait for one to finish");
    assert.equal(askLineWords(draft([lead("product"), lead("builder")]), facts({ limit: { max: 4, running: 4 } })).stop, "4 of 4 agents are running: 2 more do not fit — wait for one to finish");
    assert.equal(askLineWords(draft([lead("product")]), facts({ limit: { max: 1, running: 1 } })).stop, "1 of 1 agent is running: one more does not fit — wait for one to finish", "a session that runs one says so of one");
    assert.equal(askLineWords(draft([lead("product"), lead("builder")]), facts({ limit: { max: 4, running: 3 } })).stop, "3 of 4 agents are running: 2 more do not fit — wait for one to finish, or ask fewer");
    // (fails before: yes — found by hand in the browser: five asked of a session that runs four read "0 of 4 agents are
    // running … wait for one to finish")
    assert.equal(askLineWords(draft([lead("product"), lead("builder"), lead("enduser")]), facts({ limit: { max: 2, running: 0 } })).stop, "This chat's models run 2 agents at once: 3 do not fit — ask fewer");
    assert.equal(askLineWords(draft([lead("product"), lead("builder")]), facts({ limit: { max: 1, running: 1 } })).stop, "This chat's models run 1 agent at once: 2 do not fit — ask fewer");
    assert.equal(askLineWords(draft([lead("product"), lead("builder")]), facts({ limit: { max: 4, running: 2 } })).stop, null);
    assert.equal(askLineWords(draft([lead("product")]), facts({ limit: null })).stop, null, "a chat with no session yet has no limit to meet");
    // (fails before: yes — the owner's word of 11-05: with no limit set on its models, a chat runs as many as it asks)
    assert.equal(askLineWords(draft([lead("product"), lead("builder"), lead("enduser")]), facts({ limit: { max: null, running: 9 } })).stop, null);
  });

  test("a model whose provider refused a picture before is said before you send one", () => {
    const refused = facts({ refusedPictures: (m) => m === "zai/glm-5.3" });
    assert.equal(askLineWords(draft([lead("product")], { files: 1, pictures: 1 }), refused).note, "GLM-5.3 was refused a picture before, so Product may fail on this one — put a model that reads pictures on the card");
    assert.equal(askLineWords(draft([lead("product"), own("seer", "Seer", { model: "grok-4.6" })], { files: 2, pictures: 2 }), refused).note, "GLM-5.3 was refused a picture before, so Product may fail on these — put a model that reads pictures on the card");
    assert.equal(askLineWords(draft([lead("product")]), refused).note, null, "words alone: nothing to warn of");
    assert.equal(askLineWords(draft([own("seer", "Seer", { model: "grok-4.6" })], { files: 1, pictures: 1 }), refused).note, null);
  });

  // (fails before: yes — AG-241: one agent was asked on one model; three blind answers took three cards made by hand)
  test("one per model family: one agent, in a session whose pool holds models of two makers or more, asked once on each, each blind to the others", () => {
    const FAMILIES = [{ family: "zhipu", model: "zai/glm-5.3" }, { family: "anthropic", model: "claude-code/haiku" }, { family: "moonshot", model: "kimi-k2" }];
    const three = facts({ families: FAMILIES });
    const off = askLineWords(draft([lead("reviewer")]), three);
    assert.deepEqual([off.who, off.canSpread, off.models, off.facts[0]], ["Reviewer", true, null, "GLM-5.3"], "offered, and not chosen: one launch on the pool's first model");
    assert.deepEqual(askLineWords(draft([lead("reviewer")], { spread: true }), three), {
      who: "Reviewer, three times", facts: ["GLM-5.3, Haiku and Kimi K2", "each blind to the others", "sees your question alone", "not to the main agent"],
      stop: null, note: null, canSpread: true, models: ["zai/glm-5.3", "claude-code/haiku", "kimi-k2"],
    });
    assert.equal(askLineWords(draft([lead("reviewer")], { spread: true }), facts({ families: FAMILIES.slice(0, 2) })).who, "Reviewer, twice");
    // Not offered to two agents — two cards times three makers is six answers to read — nor in a pool of one maker.
    const two = askLineWords(draft([lead("product"), lead("reviewer")], { spread: true }), three);
    assert.deepEqual([two.canSpread, two.models, two.who], [false, null, "Product and Reviewer"]);
    const plain = askLineWords(draft([lead("reviewer")], { spread: true }), facts({ families: FAMILIES.slice(0, 1) }));
    assert.deepEqual([plain.canSpread, plain.models, plain.who], [false, null, "Reviewer"]);
    // Each launch takes a seat: three do not fit a session that runs two, and the way to fewer is to ask once.
    assert.equal(askLineWords(draft([lead("reviewer")], { spread: true }), facts({ families: FAMILIES, limit: { max: 2, running: 0 } })).stop, "This chat's models run 2 agents at once: 3 do not fit — ask once");
    assert.equal(askLineWords(draft([lead("reviewer")], { spread: true }), facts({ families: FAMILIES, limit: { max: 4, running: 2 } })).stop, "2 of 4 agents are running: 3 more do not fit — wait for one to finish, or ask once");
    // A model that was refused a picture before is said by its name.
    assert.equal(askLineWords(draft([lead("reviewer")], { spread: true, files: 1, pictures: 1 }), facts({ families: FAMILIES, refusedPictures: (m) => m === "kimi-k2" })).note,
      "Kimi K2 was refused a picture before, so Reviewer may fail there on this one");
  });

  // (fails before: yes — AG-241: the line had no choice of its own)
  test("the line's choice: pressed, the draft's one agent is asked on each model; it stays while the draft is that agent's, and once takes it back", () => {
    const FAMILIES = [{ family: "zhipu", model: "zai/glm-5.3" }, { family: "anthropic", model: "claude-code/haiku" }];
    let choices = 0;
    const line = createAskLine({ cards, facts: () => facts({ families: FAMILIES }), onPick: () => {}, onChoice: () => { choices++; } });
    const DRAFT = "@reviewer is the cache safe?";
    line.paint(DRAFT, []);
    const choice = btn(line.el, "one per model family");
    assert.deepEqual([choice.getAttribute("aria-pressed"), choice.getAttribute("title")], ["false", "Ask Reviewer once on each of GLM-5.3 and Haiku: the first model of each maker in this session's pool, each answer blind to the others"]);
    assert.equal(line.read(DRAFT, []).models, null);
    choice.dispatch("click");
    assert.deepEqual([line.el.querySelector(".ask-who").textContent, line.el.querySelector(".ask-facts").textContent], ["Reviewer, twice", " · GLM-5.3 and Haiku · each blind to the others · sees your question alone · not to the main agent"]);
    assert.deepEqual(line.read(DRAFT, []).models, ["zai/glm-5.3", "claude-code/haiku"]);
    assert.equal(btn(line.el, "once").getAttribute("aria-pressed"), "true");
    // (fails before: yes — E15 step 8's look: the press drew the line again, the keyboard fell to the page, and Enter
    // sent nothing; the composer gives the box the keyboard back)
    assert.equal(choices, 1, "the line says a choice was made on it");
    assert.match(readFileSync("src/ui/harness/composer/composer.js", "utf8"), /onChoice: \(\) => ta\.focus\(\),/);
    line.paint(`${DRAFT} And why?`, []);
    assert.ok(btn(line.el, "once"), "the draft goes on: still chosen");
    // A second agent, or another one: not offered, and not chosen when the draft is the first one's again.
    line.paint("@reviewer @product is the cache safe?", []);
    assert.deepEqual([btn(line.el, "once"), btn(line.el, "one per model family"), line.read("@reviewer @product is the cache safe?", []).models], [null, null, null]);
    line.paint(DRAFT, []);
    assert.ok(btn(line.el, "one per model family"));
    btn(line.el, "one per model family").dispatch("click");
    btn(line.el, "once").dispatch("click");
    assert.deepEqual([line.read(DRAFT, []).models, line.el.querySelector(".ask-who").textContent], [null, "Reviewer"]);
    // A draft sent leaves the box empty: the next one starts unchosen.
    btn(line.el, "one per model family").dispatch("click");
    line.paint("", []);
    line.paint(DRAFT, []);
    assert.equal(line.read(DRAFT, []).models, null);
    // A pool of one maker has no such choice.
    const plain = createAskLine({ cards, facts: () => facts(), onPick: () => {} });
    plain.paint(DRAFT, []);
    assert.equal(btn(plain.el, "one per model family"), null);
    // The composer hands the models on, and the app asks the one agent on each.
    const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(read("src/ui/harness/composer/composer.js"), /changes: who\.changes, files, \.\.\.\(who\.models \? \{ models: who\.models \} : \{\}\) \}\)/);
    assert.match(read("src/ui/harness/app.js"), /as: tags, \.\.\.\(models \? \{ models \} : \{\}\),/);
    assert.match(read("src/ui/harness/app.js"), /families: poolFamilies\(poolRows\(chat\?\.view\?\.settings\?\.effective\?\.subagents\?\.pool\),/);
  });

  test("drawn over the box for an addressed draft, gone for any other; the stop shows stronger once Enter met it", () => {
    const line = createAskLine({ cards, facts: () => facts(), onPick: () => {} });
    line.paint("hello there", []);
    assert.ok(line.el.classList.contains("hidden"));
    // A tag later in a message names an agent for the main agent to use (test/use-named.test.js): the message is still
    // the main agent's.
    line.paint("fix it like @product said", []);
    assert.equal(line.el.className, "ask-line is-use");
    assert.deepEqual(line.read("fix it like @product said", []).to, []);
    line.paint("@product @builder should a fifth launch queue or fail?", []);
    assert.equal(line.el.className, "ask-line");
    assert.equal(line.el.textContent, "To Product and Builder · GLM-5.3 · sees your question alone · not to the main agent");
    assert.deepEqual(line.read("@product, should we?", []).to.map((/** @type {any} */ c) => c.tag), ["product"]);
    line.paint("@product", []);
    assert.equal(line.el.querySelector(".ask-stop").textContent, "Ask Product something");
    assert.equal(line.read("@product", []).stop, "Ask Product something");
    assert.equal(line.el.className, "ask-line");
    line.press("@product");
    line.paint("@product", []);
    assert.equal(line.el.className, "ask-line is-stopped");
    line.paint("@product should", []);
    assert.equal(line.el.className, "ask-line", "the draft moved on");
  });

  test("a first @word that names no agent is held once: pick an agent, or Enter again sends it as written", () => {
    /** @type {[string, string][]} */
    const picked = [];
    const line = createAskLine({ cards, facts: () => facts(), onPick: (word, tag) => picked.push([word, tag]) });
    assert.deepEqual(line.read("@prodct should we?", []), { to: [], unknown: ["prodct"], question: "should we?", changes: null, stop: null, models: null });
    assert.equal(line.passes("@prodct should we?"), false, "not held yet");
    line.hold("@prodct should we?", "prodct");
    line.paint("@prodct should we?", []);
    assert.equal(line.el.className, "ask-line is-held");
    assert.match(line.el.textContent, /^No agent is called @prodct — pick one, or press Enter again to send this to the main agent as written/);
    const picks = line.el.querySelectorAll(".ask-pick");
    // (fails before: yes — the picks were the list's first eight: with ten cards shipping, never one of your own)
    // The plan's p6: the four build teams' Leads are one, Builders', whose tag is further from what was typed; the Bug
    // Hunter's and the Verifier's are one, BugHunters', so six cards ship (Explainer and Watcher went, the owner's word
    // of 11-05) and each is a pick.
    assert.deepEqual(picks.map((/** @type {any} */ b) => b.textContent), ["@product", "@enduser", "@builder", "@huntlead", "@reviewer", "@buildlead"], "the nearest to what was typed stand first");
    assert.deepEqual(nearestCards("secrity", [...cards(), own("security", "Security"), own("sec-review", "Sec review")], 3).map((c) => c.tag), ["security", "sec-review", "enduser"]);
    assert.deepEqual(nearestCards("", cards(), 2).map((c) => c.tag), ["product", "enduser"], "nothing typed: the list's order");
    picks[0].dispatch("click");
    assert.deepEqual(picked, [["prodct", "product"]]);
    assert.equal(line.passes("@prodct should we?"), true, "Enter again: it goes as written");
    assert.equal(line.passes("@prodct should we?"), false, "and the hold is over");
    // A held draft that changes is no longer held.
    line.hold("@prodct should we?", "prodct");
    line.paint("@prodct should we really?", []);
    assert.ok(line.el.classList.contains("hidden"));
    assert.equal(line.passes("@prodct should we?"), false);
  });

  test("a first @word that is a team's, where no Brief opens (a chat not yet begun): the line says so, never 'No agent is called'", () => {
    // d-side, 11-12: the Library's foot copies `@bughunters` for a chat's message box; pasted into a chat that has not
    // begun, no Brief can open (`teams` is empty there), and the word read as an agent's that nobody is called.
    // (fails before: yes — "No agent is called @bughunters — pick one, …" with six agents to pick)
    let why = /** @type {string | null} */ ("A team works with a chat: send this chat's first message, then brief a team");
    const line = createAskLine({ cards, facts: () => facts(), onPick: () => {}, teams: () => [], uses: () => [{ key: "bughunters", name: "BugHunters" }], whyNoBrief: () => why });
    assert.deepEqual(line.read("@BugHunters look at what I changed", []).unknown, ["BugHunters"]);
    line.hold("@BugHunters look at what I changed", "BugHunters");
    line.paint("@BugHunters look at what I changed", []);
    assert.equal(line.el.className, "ask-line is-held");
    assert.equal(line.el.textContent, "BugHunters is a team. A team works with a chat: send this chat's first message, then brief a team. Or press Enter again to send this to the main agent as written");
    assert.equal(line.el.querySelectorAll(".ask-pick").length, 0, "no agent to pick: the word names a team");
    // The page gave no reason: the line still says what the word is.
    why = null;
    line.paint("@BugHunters look at what I changed", []);
    assert.equal(line.el.textContent, "BugHunters is a team. Its Brief does not open here. Or press Enter again to send this to the main agent as written");
    assert.equal(line.passes("@BugHunters look at what I changed"), true, "Enter again: it goes as written");
    // A word that is nobody's is still said so there, and so is a team's word past the start's hold.
    line.hold("@bughuntrs look", "bughuntrs");
    line.paint("@bughuntrs look", []);
    assert.match(line.el.textContent, /^No agent is called @bughuntrs — pick one/);
  });
});

const QUESTION = "should a fifth launch queue or fail?";
const ANSWER = "**Fail**, and name the `limit`.\n\nA fifth launch that waits unseen is a turn that looks stuck.";
/** The mark a question was sent off with. @param {any} [o] */
const sent = (o = {}) => ({ type: "subagent", event: "dispatch", agentId: "sa_1", exchange: 0, at: 1_000, afterTurn: 2, model: "zai/glm-5.3", card: { tag: "product", name: "Product" }, asked: true, question: QUESTION, ...o });
/** The mark its answer came back with. @param {any} [o] */
const back = (o = {}) => ({ ...sent(), event: "arrival", status: "done", ms: 9_000, answer: ANSWER, tokensIn: 4_000, tokensOut: 100, spentUsd: 0.01, delivery: "held", ...o });
/** The list's row of it while it works. @param {any} [o] @returns {any} */
const working = (o = {}) => ({ id: "sa_1", status: "running", model: "zai/glm-5.3", card: { tag: "product", name: "Product" }, asked: true, may: "read", description: QUESTION, exchanges: [{ status: "running", startedAt: 1_000, endedAt: null, description: QUESTION }], progress: { tool: { name: "read", args: "src/app/agent/subagents.js" } }, ...o });

// (fails before: yes — a saved agent's launch drew the plain sub-agent rows: "sent off", then "back" with a clipped line)
describe("a saved agent's card in the chat", () => {
  /** What the open chat holds of the agent's marks, and the session's list. @type {{ marks: { dispatch?: any, arrival?: any }, row: any, known: boolean, delivery: string | undefined, outside: string | null, calls: any[] }} */
  let page;
  beforeEach(() => {
    page = { marks: {}, row: null, known: true, delivery: "held", outside: null, calls: [] };
    Object.assign(chipActions, {
      cardMarks: () => page.marks,
      subagentRow: () => page.row,
      subagentsKnown: () => page.known,
      subagentDelivery: () => page.delivery,
      outsideClient: () => page.outside,
      openSubagent: (/** @type {string} */ id) => page.calls.push(["open", id]),
      stopSubagent: (/** @type {string} */ id) => page.calls.push(["stop", id]),
      askAgain: (/** @type {string} */ id, /** @type {string} */ tag, /** @type {string} */ q) => page.calls.push(["again", id, tag, q]),
      sendSubagent: async (/** @type {string} */ id, /** @type {number} */ x) => { page.calls.push(["send", id, x]); },
      cardAnswer: async () => "THE WHOLE ANSWER\n\nfrom the list",
      watchSubagents: null,
    });
  });
  after(() => {
    for (const k of ["cardMarks", "subagentRow", "subagentsKnown", "subagentDelivery", "outsideClient", "openSubagent", "stopSubagent", "askAgain", "sendSubagent", "cardAnswer", "watchSubagents"]) /** @type {any} */ (chipActions)[k] = null;
  });
  /** A card, and the repaint its follow of the list asks for. @param {any} m @param {number} [now] */
  const drawn = (m, now = 2_000) => {
    /** @type {() => void} */
    let repaint = () => {};
    const row = /** @type {any} */ (agentCardRow(m, { follow: (_row, onChange) => { repaint = onChange; }, now: () => now }));
    return { row, repaint: () => repaint() };
  };
  const words = (/** @type {any} */ row, /** @type {string} */ cls) => row.querySelector(`.${cls}`)?.textContent ?? null;
  const buttons = (/** @type {any} */ row) => row.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent).filter(Boolean);

  // (fails before: yes — the Hunter's of 10-28: one the list was answered without — Filament holds it no longer — kept its
  // answer's "3 files wait in its copy · Review ›", which opened Changes on no row of it)
  test("the card of one Filament holds no longer offers no Review ›; before the list answers, its answer's word stands", () => {
    Object.assign(chipActions, { subagentWork: () => null, reviewSubagent: () => {} });
    try {
      page.delivery = "sent";
      page.known = true;
      assert.deepEqual(buttons(drawn(back({ changes: 3, delivery: "sent" })).row).filter((b) => /Review/.test(b)), []);
      page.known = false;
      assert.deepEqual(buttons(drawn(back({ changes: 3, delivery: "sent" })).row).filter((b) => /Review/.test(b)), ["3 files wait in its copy · Review ›"]);
    } finally {
      Object.assign(chipActions, { subagentWork: null, reviewSubagent: null });
    }
  });

  // (fails before: yes — found by hand in the browser: the conversation's head said "sees Folded, newest 2 whole", the
  // name of a context view, where Settings says the card's own words)
  test("what an agent was shown reads the same in Settings and over its conversation", () => {
    const shown = { view: "folded", running: true, changes: null };
    assert.equal(seesWords(shown), "This session folded, and the turn running now");
    assert.equal(seesFact(shown), "sees this session folded, and the turn running now");
    assert.equal(seesFact({ view: "none", running: false, changes: null }), "sees your question alone");
    assert.equal(seesFact({ view: "window", running: false, changes: "uncommitted" }), "sees the main agent's context window, the turn running now in it, and the uncommitted change");
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.ok(viewer.includes('sa.asked && sa.view !== "fork" ? seesFact({ view: sa.view, running: sa.running, changes: sa.changes }) : [subagentViewFact(sa.view), handedWords(sa.changes)].filter(Boolean).join(", "),'), "the head says what this launch was given, in the card's words");
  });

  // (fails before: yes — found by hand in the browser: a warm Catch me up ran as a live copy of the main agent, its
  // context handed over the main agent's conversation, and its head said "sees your question alone")
  test("an agent you asked that runs as a live copy says so over its conversation, the change handed to it after", () => {
    // A card sees one of its own views; a live copy is none of them, and reads as it does for a launched agent.
    assert.equal([subagentViewFact("fork"), handedWords("turn")].filter(Boolean).join(", "), `a live copy of the main agent, ${handedWords("turn")}`);
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.ok(viewer.includes('sa.asked && sa.view !== "fork" ? seesFact('), "an asked live copy's head reads as a launched one's");
  });

  // (fails before: yes — found by hand: an answer sent on to the main agent, and the head over it still said "its
  // answer stays with you")
  test("the head says where the newest answer is: with you, or sent on", () => {
    assert.equal(answerFact([{ delivery: "held" }]), "its answer stays with you");
    assert.equal(answerFact([{ delivery: "held" }, { delivery: "sent" }]), "its answer went to the main agent");
    assert.equal(answerFact([{ delivery: "sent" }, { delivery: null }]), "its answer stays with you", "asked again: the new answer is the person's until they send it");
    assert.equal(answerFact([]), "its answer stays with you");
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.ok(viewer.includes('sa.aside ? (sa.asked ? answerFact(sa.exchanges) : "reports kept for you") : "",'));
  });

  test("an answer's first line as plain words, and a working agent's live line", () => {
    assert.equal(firstLine(ANSWER), "Fail, and name the limit.");
    assert.equal(firstLine("\n\n## Verdict\n\nFail."), "Verdict");
    assert.equal(firstLine("- queue it\n- or fail"), "queue it");
    assert.equal(firstLine(""), "");
    assert.equal(live({ asking: { question: "May I read .env?", tool: "read" } }), "Waits for your answer: May I read .env?");
    assert.equal(live({ tool: { name: "grep", args: "maxConcurrent" } }), "grep maxConcurrent");
    assert.equal(live({ words: "First the limit.\nThen the queue." }), "Then the queue.");
    assert.equal(live(null), "Thinking…");
  });

  test("how a card stands: from the answer's mark, else the list's end, else working, starting or lost", () => {
    const at = { row: null, known: true, now: 60_000 };
    const done = cardState(sent(), back(), at);
    assert.deepEqual([done.phase, done.text, done.whole, done.tokens, done.usd, done.ms, done.model], ["done", ANSWER, true, 4_100, 0.01, 9_000, "zai/glm-5.3"]);
    assert.equal(cardFacts(done), "GLM-5.3 · 4.1k · $0.0100 · 9s");
    const failed = cardState(sent(), back({ status: "failed", answer: "", error: "HTTP 500" }), at);
    assert.deepEqual([failed.phase, failed.status, failed.error], ["failed", "failed", "HTTP 500"]);
    // The answer's mark has not reached the chat yet: the list's word of the end, clipped there.
    const ended = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 8_000, report: "Fail, and name…", tokensIn: 10, tokensOut: 5, spentUsd: 0, ms: 7_000 }] });
    const listed = cardState(sent(), null, { ...at, row: ended });
    assert.deepEqual([listed.phase, listed.text, listed.whole, listed.ms], ["done", "Fail, and name…", false, 7_000]);
    const live = cardState(sent(), null, { ...at, row: working() });
    assert.deepEqual([live.phase, live.live, live.ms], ["running", "read src/app/agent/subagents.js", 0]);
    // Not in the list: starting while the list is unread or the question is fresh, else Filament holds it no longer.
    assert.deepEqual([cardState(sent(), null, { row: null, known: false, now: 60_000 }).live, cardState(sent(), null, { row: null, known: true, now: 5_000 }).live], ["Starting…", "Starting…"]);
    assert.equal(cardState(sent(), null, at).phase, "lost");
    // (fails before: yes — the owner's report of 10-18: one a restart cut before it ended is "aborted" with no end
    // time, and its card stood working for good)
    const cut = cardState(sent(), null, { ...at, row: working({ status: "aborted", progress: null, exchanges: [{ status: "aborted", startedAt: 1_000, endedAt: null, error: "Filament restarted before it finished" }] }) });
    assert.deepEqual([cut.phase, cut.status, cut.error, cut.ms, cut.live], ["failed", "aborted", "Filament restarted before it finished", 0, ""]);
  });

  test("while it works: your question, who, on which model, one live line, Open and Stop", () => {
    page.marks = { dispatch: sent() };
    page.row = working();
    const { row } = drawn(sent());
    assert.equal(row.className, "ask-card is-running");
    assert.deepEqual([words(row, "ask-card-you"), words(row, "ask-card-question"), words(row, "ask-card-name"), words(row, "ask-card-first"), words(row, "ask-card-facts")], ["You asked", QUESTION, "Product", "read src/app/agent/subagents.js", "GLM-5.3"]);
    assert.deepEqual(buttons(row), ["Open", "Stop"]);
    btn(row, "Stop").dispatch("click");
    btn(row, "Open").dispatch("click");
    assert.deepEqual(page.calls, [["stop", "sa_1"], ["open", "sa_1"]]);
    assert.ok(row.querySelector(".ask-card-body").classList.contains("hidden"));
  });

  // (fails before: yes — the owner's words of 10-24: "these cards should be collapsed by default", then "you see all
  // these hunters i fired, they took up all my real estate of the transcript … by default they should be collapsed into
  // single colored line, that keeps shimmering as long as the side agent is running")
  test("folded, a card is its one line in its agent's colour, the question its tooltip; the line opens it, running too, and the question folds it", () => {
    page.marks = { dispatch: sent() };
    page.row = working();
    const { row, repaint } = drawn(sent());
    const q = row.querySelector(".ask-card-q");
    const line = row.querySelector(".ask-card-line");
    const first = row.querySelector(".ask-card-first");
    assert.deepEqual([row.className, q.classList.contains("hidden"), line.title, first.getAttribute("role"), first.getAttribute("aria-expanded")],
      ["ask-card is-running", true, `You asked: ${QUESTION}`, "button", "false"], "folded at first: the line alone");
    assert.equal(row.getAttribute("style"), "--card-tone: var(--color-sys-pink)", "the Product's Library tile is pink");
    line.dispatch("click");
    assert.deepEqual([row.className, q.classList.contains("hidden"), q.getAttribute("aria-expanded"), words(row, "ask-card-first"), line.title],
      ["ask-card is-running is-open", false, "true", "read src/app/agent/subagents.js", ""], "opened while it runs: the question whole, its live line still said");
    q.dispatch("keydown", { key: "Enter" });
    assert.equal(row.className, "ask-card is-running", "Enter on the question folds it again");
    first.dispatch("keydown", { key: " " });
    assert.equal(row.className, "ask-card is-running is-open", "from the keyboard the line's words are its button");
    first.dispatch("keydown", { key: "a" });
    assert.equal(row.className, "ask-card is-running is-open", "another key does nothing");
    q.dispatch("click");
    assert.equal(row.className, "ask-card is-running");
    line.dispatch("click", { target: btn(row, "Stop") });
    assert.equal(row.className, "ask-card is-running", "a press on a button of the line is the button's alone");
    // Done: the line and the chevron open and fold the one card.
    page.marks = { dispatch: sent(), arrival: back() };
    page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail…" }], progress: null });
    repaint();
    assert.equal(row.className, "ask-card is-done");
    line.dispatch("click");
    assert.deepEqual([row.className, row.querySelector(".ask-card-body").classList.contains("hidden")], ["ask-card is-done is-open", false], "the line opens the answer too");
    row.querySelector(".ask-card-toggle").dispatch("click");
    assert.deepEqual([row.className, q.getAttribute("aria-expanded")], ["ask-card is-done", "false"]);
    // By the sheets: folded, the card is its line tinted its agent's colour, the rest of it out of sight; a band of the
    // colour sweeps across it while the agent works, moved rather than painted, and holds still where less motion is asked.
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.ask-card\.is-open:not\(\.is-running\) \.ask-card-first \{ visibility: hidden; \}/);
    const aqua = readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8");
    assert.match(aqua, /\.ask-card:not\(\.is-open\) \{ padding: 0; background: color-mix\(in oklab, var\(--card-tone, var\(--color-sys-blue\)\) 8%, var\(--aq-card\)\); \}/);
    assert.match(aqua, /\.ask-card:not\(\.is-open\) > :is\(\.ask-card-passed, \.ask-card-drew, \.ask-card-drawn, \.ask-card-made\) \{ display: none; \}/);
    assert.match(aqua, /\.ask-card\.is-running > \.ask-card-line::after \{[^}]*transform: translateX\(-100%\); animation: card-sweep 2\.4s ease-in-out infinite;/);
    assert.match(aqua, /@keyframes card-sweep \{ to \{ transform: translateX\(100%\); \} \}/);
    assert.match(aqua, /\[data-motion="off"\] \.ask-card\.is-running > \.ask-card-line::after \{ animation: none; display: none; \}/);
    assert.match(aqua, /@media \(prefers-reduced-motion: reduce\) \{ \.ask-card\.is-running > \.ask-card-line::after \{ animation: none; display: none; \} \}/);
  });

  // (fails before: yes — the owner's words of 10-24: "once the agent is finished or paused or stopped i should be able
  // to press a close button that will remove that from the transcript"; and of 11-01: "from end users perspective it is
  // confusing that pressing close might actually delete the whole work so make it Hide button instead of close and also
  // when we press Hide from here the counter on Agents tab should also go down")
  test("an ended card's Hide takes it off the chat and it stays off, drawn again or read anew; a running one has none; the chat's count brings them back", () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    const io = { get: (/** @type {string} */ k) => kept.get(k) ?? null, set: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    const closed = createClosedCards(io);
    chipActions.cardClosed = { has: (id, x) => closed.has("ch_1", id, x), close: (id, x) => closed.close("ch_1", id, x) };
    try {
      page.marks = { dispatch: sent() };
      page.row = working();
      const { row, repaint } = drawn(sent());
      assert.equal(row.querySelector(".ask-card-hide"), null, "running: not over, so no Hide");
      page.marks = { dispatch: sent(), arrival: back() };
      page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail…" }], progress: null });
      repaint();
      const x = row.querySelector(".ask-card-hide");
      assert.deepEqual([x.textContent, x.getAttribute("aria-label"), x.getAttribute("title")], ["Hide", "Hide Product's card", "Hide this card from the chat. Nothing is deleted: its conversation stays in the Agents tab, and the chat menu shows the card again"], "a word, never a × that reads as deleting the work");
      assert.deepEqual(row.querySelector(".ask-card-side").children.map((/** @type {any} */ b) => b.className), ["sub-mark-send", "sub-mark-send is-quiet ask-card-hide", "ask-card-toggle"], "on the line: what waits for you, Hide as the card's quiet button, the chevron");
      x.dispatch("click");
      assert.equal(row.className, "ask-card is-done hidden", "off the chat at once");
      assert.deepEqual([closed.count("ch_1"), closed.count("ch_2")], [1, 0]);
      assert.ok(drawn(sent()).row.classList.contains("hidden"), "drawn again as its turn goes on: still off");
      assert.equal(createClosedCards(io).has("ch_1", "sa_1", 0), true, "kept by the browser: read anew after a reload");
      page.marks = { dispatch: sent({ exchange: 1, followUp: true }), arrival: back({ exchange: 1, followUp: true }) };
      assert.ok(!drawn(sent({ exchange: 1, followUp: true })).row.classList.contains("hidden"), "asked again: a card of its own");
      // The chat menu's Show brings them back.
      assert.equal(closed.reopen("ch_1"), 1);
      page.marks = { dispatch: sent(), arrival: back() };
      repaint();
      assert.equal(row.className, "ask-card is-done");
      // Failed, stopped and lost cards hide too.
      page.marks = { dispatch: sent(), arrival: back({ status: "stopped", answer: "So far: fail." }) };
      assert.ok(drawn(sent()).row.querySelector(".ask-card-hide"));
      page.row = null;
      page.marks = { dispatch: sent() };
      const lost = drawn(sent(), 600_000).row;
      assert.deepEqual([lost.className, !!lost.querySelector(".ask-card-hide")], ["ask-card is-lost", true]);
      // The chat menu offers it while some are hidden (header.js), and the page wires both to this browser's store.
      const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
      assert.ok(header.includes("{ label: `Show ${n} hidden agent card${n === 1 ? \"\" : \"s\"}`, icon: \"eye\", desc: \"the cards you hid come back where they were\", onClick: () => cb.onShowClosedCards?.() }"));
      const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
      assert.ok(app.includes("if (closedCards.reopen(chatOf(state.currentId)?.chainId)) subagentStore.touch();"), "brought back, every card paints again");
      // Hidden, its answer is seen: the Agents tab's number goes down by it (views/side.js `seen`, test/harness-side.test.js).
      assert.match(app, /close: \(id, exchange\) => \{\n {4}closedCards\.close\(chatOf\(state\.currentId\)\?\.chainId, id, exchange\);\n {4}views\.side\.seen\(id, exchange\);\n {2}\},/);
      const host = readFileSync(new URL("../src/ui/harness/views/host.js", import.meta.url), "utf8");
      assert.match(host, /seen\(id, exchange\) \{\n {8}side\.seen\(chat, id, exchange\);\n {8}drawSide\(\);\n {8}paintBadges\(\);\n {6}\},/, "the badge painted again at once");
      // No × of its own is styled any more.
      assert.doesNotMatch(readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8"), /ask-card-close/);
    } finally {
      chipActions.cardClosed = null;
    }
  });

  // (fails before: yes — the owner's of 10-31: two closed Hunters' cards, each time their chat was shown again, "shows up
  // for split second with a shimmer and as if they were working and then both card disappear": the session's list empties
  // as a chat is shown, and a closed card short of its answer's mark read as starting, so stood, until the list answered)
  test("a closed card stays off the chat while the session's list has not answered, and tells its row at each paint", () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    const closed = createClosedCards({ get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) });
    chipActions.cardClosed = { has: (id, x) => closed.has("ch_1", id, x), close: (id, x) => closed.close("ch_1", id, x) };
    try {
      const ended = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail…" }], progress: null });
      // Its answer's mark never reached the page: the list alone says it ended.
      page.marks = { dispatch: sent() };
      page.row = ended;
      /** @type {boolean[]} */
      const said = [];
      /** @type {() => void} */
      let repaint = () => {};
      const row = /** @type {any} */ (agentCardRow(sent(), { follow: (_row, onChange) => { repaint = onChange; }, now: () => 600_000, shown: (on) => said.push(on) }));
      assert.deepEqual([row.className, said], ["ask-card is-done", [true]], "ended, it stands, and says so");
      row.querySelector(".ask-card-hide").dispatch("click");
      assert.deepEqual([row.className, said.at(-1)], ["ask-card is-done hidden", false], "closed: off the chat, its row told");
      // Shown again: the list empties and has not answered.
      page.row = null;
      page.known = false;
      repaint();
      assert.equal(row.classList.contains("hidden"), true, "not drawn as starting meanwhile");
      assert.equal(said.at(-1), false);
      page.row = ended;
      page.known = true;
      repaint();
      assert.deepEqual([row.className, said.at(-1)], ["ask-card is-done hidden", false], "the list answered: ended, still closed");
      // One the list says runs again shows whatever was said of it before.
      page.row = working();
      repaint();
      assert.deepEqual([row.className, said.at(-1)], ["ask-card is-running", true]);
    } finally {
      chipActions.cardClosed = null;
    }
  });

  // (fails before: yes — the Hunter's of 11-01: a closed card its agent runs again stands on the chat, and the chat menu's
  // Show N hidden agent cards counted it all the same)
  test("a closed card that stands while its agent runs again is no hidden card: the chat's count leaves it out", () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    const closed = createClosedCards({ get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) });
    chipActions.cardClosed = {
      has: (id, x) => closed.has("ch_1", id, x),
      close: (id, x) => closed.close("ch_1", id, x),
      standing: (row, id, x, on) => closed.standing("ch_1", row, id, x, on),
    };
    const ended = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail…" }], progress: null });
    page.marks = { dispatch: sent() };
    page.row = ended;
    const { row, repaint } = drawn(sent(), 600_000);
    document.body.appendChild(row);
    try {
      row.querySelector(".ask-card-hide").dispatch("click");
      closed.close("ch_1", "sa_9", 0);
      assert.equal(closed.count("ch_1"), 2, "both off the chat");
      page.row = working();
      repaint();
      assert.deepEqual([row.className, closed.count("ch_1"), closed.count("ch_2")], ["ask-card is-running", 1, 0], "the one that runs again stands: one hidden");
      page.row = ended;
      repaint();
      assert.deepEqual([row.className, closed.count("ch_1")], ["ask-card is-done hidden", 2], "ended again: off the chat again");
      page.row = working();
      repaint();
      assert.equal(closed.count("ch_1"), 1);
      row.remove();
      assert.equal(closed.count("ch_1"), 2, "a row that left the document stands nowhere");
      // The page tells the store which chat's card stands, as it tells it which chat's card closed; a row that leaves the
      // document lets go of its word (lib/follow-drawn.js `gone`), from both cards' rows.
      const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
      assert.match(app, /standing: \(row, id, exchange, on\) => closedCards\.standing\(chatOf\(state\.currentId\)\?\.chainId, row, id, exchange, on\),/);
      const card = readFileSync(new URL("../src/ui/harness/conversation/agent-card.js", import.meta.url), "utf8");
      assert.ok(card.includes("follow(row, paint, () => chipActions.cardClosed?.standing?.(row, id, exchange, false));"));
      for (const f of ["../src/ui/harness/conversation/subagent-marks.js", "../src/ui/harness/conversation/tools/render.js"])
        assert.ok(readFileSync(new URL(f, import.meta.url), "utf8").includes("follow: (row, onChange, gone) => followStore(row, onChange, gone)"), f);
    } finally {
      row.remove();
      chipActions.cardClosed = null;
    }
  });

  test("the closed cards a browser keeps: per chat, the newest chats and cards kept, a bad entry read as none", () => {
    /** @type {Map<string, string>} */
    const kept = new Map([["closedCards", "not json"]]);
    const io = { get: (/** @type {string} */ k) => kept.get(k) ?? null, set: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    const closed = createClosedCards(io);
    assert.equal(closed.count("ch_1"), 0, "a bad entry is none");
    for (let i = 0; i <= CLOSED_CHATS_MAX; i++) closed.close(`ch_${i}`, "sa_1", 0);
    assert.deepEqual([closed.has("ch_0", "sa_1", 0), closed.has(`ch_${CLOSED_CHATS_MAX}`, "sa_1", 0)], [false, true], "the chat closed in longest ago goes first");
    closed.close("ch_1", "sa_1", 0);
    closed.close("ch_1", "sa_1", 0);
    assert.equal(closed.count("ch_1"), 1, "one card closed twice is one");
    for (let i = 0; i < CLOSED_PER_CHAT_MAX + 5; i++) closed.close("ch_2", `sa_${i}`, 1);
    assert.deepEqual([closed.count("ch_2"), closed.has("ch_2", "sa_0", 1), closed.has("ch_2", `sa_${CLOSED_PER_CHAT_MAX + 4}`, 1)], [CLOSED_PER_CHAT_MAX, false, true]);
    assert.deepEqual([closed.has(null, "sa_1", 0), closed.reopen(""), closed.reopen("ch_none"), closed.reopen("ch_9"), closed.count("ch_9")], [false, 0, 0, 1, 0]);
  });

  // (fails before: yes — there was no word of a closed card that stands: every closed card counted hidden)
  test("a closed card that stands is kept by its row while drawn: a card drawn again and the row it replaced never undo each other", () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    const closed = createClosedCards({ get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) });
    const row = (on = true) => ({ isConnected: on });
    closed.close("ch_1", "sa_1", 0);
    closed.close("ch_1", "sa_2", 3);
    const before = row(), again = row();
    closed.standing("ch_1", before, "sa_1", 0, true);
    closed.standing("ch_1", again, "sa_1", 0, true);
    assert.equal(closed.count("ch_1"), 1, "two rows of one card stand for one");
    before.isConnected = false;
    closed.standing("ch_1", before, "sa_1", 0, false);
    assert.equal(closed.count("ch_1"), 1, "the row it replaced, gone, leaves the new one standing");
    closed.standing("ch_2", row(), "sa_2", 3, true);
    assert.equal(closed.count("ch_1"), 1, "another chat's card is another card");
    closed.standing("ch_1", row(), "sa_7", 0, true);
    assert.equal(closed.count("ch_1"), 1, "a card never closed takes nothing off");
    closed.standing(null, row(), "sa_2", 3, true);
    assert.equal(closed.count("ch_1"), 1, "nor one of no chat");
    again.isConnected = false;
    assert.equal(closed.count("ch_1"), 2, "out of the document, it stands nowhere");
    assert.equal(closed.reopen("ch_1"), 2);
  });

  test("done, it folds to the answer's first line with its figures; opened, the answer whole; Ask again, Send to main agent, Copy, Open", async () => {
    page.marks = { dispatch: sent() };
    page.row = working();
    const { row, repaint } = drawn(sent());
    // The answer's mark reaches the chat, and the list says it ended.
    page.marks = { dispatch: sent(), arrival: back() };
    page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail…" }], progress: null });
    repaint();
    assert.equal(row.className, "ask-card is-done");
    assert.deepEqual([words(row, "ask-card-first"), words(row, "ask-card-facts")], ["Fail, and name the limit.", "GLM-5.3 · 4.1k · $0.0100 · 9s"]);
    assert.ok(row.querySelector(".ask-card-body").classList.contains("hidden"), "folded");
    assert.deepEqual(buttons(row), ["Send to main agent"], "folded: what waits for you stays on the line");
    row.querySelector(".ask-card-toggle").dispatch("click");
    assert.equal(row.className, "ask-card is-done is-open");
    assert.deepEqual(buttons(row), ["Ask again", "Send to main agent", "Copy", "Open"], "opened: every button under the answer");
    const body = row.querySelector(".ask-card-body");
    assert.ok(!body.classList.contains("hidden"));
    assert.match(String(body.innerHTML), /<b>Fail<\/b>, and name the <code>limit<\/code>\./, "the answer whole, as markdown");
    assert.match(String(body.innerHTML), /looks stuck/);
    btn(row, "Send to main agent").dispatch("click");
    btn(row, "Ask again").dispatch("click");
    await settle();
    assert.deepEqual(page.calls, [["send", "sa_1", 0], ["again", "sa_1", "product", ""]]);
    // Sent on: the card says where the answer stands.
    page.delivery = "sent";
    repaint();
    assert.equal(words(row, "ask-card-note"), "Sent to the main agent");
    assert.ok(!btn(row, "Send to main agent"));
  });

  // (fails before: yes — an open card read its answer's markdown into its body again each time the agents' list moved,
  // about twice a second for every running agent, its own answer unchanged)
  test("an open card reads its answer into its body once a text, however often the list moves", () => {
    page.marks = { dispatch: sent(), arrival: back() };
    const { row, repaint } = drawn(sent());
    row.querySelector(".ask-card-toggle").dispatch("click");
    const body = row.querySelector(".ask-card-body");
    assert.match(String(body.innerHTML), /<b>Fail<\/b>/);
    body.innerHTML = "as drawn";
    repaint();
    repaint();
    assert.equal(body.innerHTML, "as drawn", "the list moved: the answer's body stands");
    page.marks = { dispatch: sent(), arrival: back({ answer: "A **new** answer" }) };
    repaint();
    assert.match(String(body.innerHTML), /A <b>new<\/b> answer/, "a new answer is read in");
  });

  test("a session another client writes: the answer cannot be queued for its turns, and the card says so", () => {
    page.marks = { dispatch: sent(), arrival: back() };
    page.outside = "Claude Code";
    const { row } = drawn(sent());
    assert.deepEqual(buttons(row), [], "folded: nothing waits for you");
    row.querySelector(".ask-card-toggle").dispatch("click");
    assert.equal(words(row, "ask-card-note"), "Claude Code writes this session's turns: copy the answer over to pass it on");
    assert.deepEqual(buttons(row), ["Ask again", "Copy"], "Filament holds the agent no longer: no Open, and no Send");
  });

  test("the answer's mark draws no row of its own where the chat holds the question's; alone, it draws the card", () => {
    page.marks = { dispatch: sent(), arrival: back() };
    assert.equal(agentCardRow(back()), null);
    assert.equal(subagentMarkRow(/** @type {any} */ (back())), null, "the marks' row builder hands a saved agent's mark to the card");
    assert.equal(/** @type {any} */ (subagentMarkRow(/** @type {any} */ (sent()))).className, "ask-card is-done");
    // A chat that holds only the answer's mark (the question's fell off the session's kept marks).
    page.marks = { arrival: back() };
    const { row } = drawn(back());
    assert.deepEqual([row.className, words(row, "ask-card-question"), words(row, "ask-card-first")], ["ask-card is-done", QUESTION, "Fail, and name the limit."]);
  });

  test("failed, stopped, lost to a restart, asked again, with pictures: each says so", async () => {
    page.marks = { dispatch: sent(), arrival: back({ status: "failed", answer: "", error: 'zai/glm-5.3\'s provider refused the request with the picture: "no image input"' }) };
    const failed = drawn(sent({ pictures: ["shot.png"] })).row;
    assert.equal(failed.className, "ask-card is-failed");
    assert.equal(words(failed, "ask-card-first"), 'failed: zai/glm-5.3\'s provider refused the request with the picture: "no image input"');
    assert.equal(words(failed, "ask-card-pics"), "with a picture");
    assert.equal(failed.querySelector(".ask-card-pics").getAttribute("title"), "shot.png");
    page.marks = { dispatch: sent(), arrival: back({ status: "stopped", answer: "So far: fail." }) };
    page.delivery = "held";
    const stopped = drawn(sent()).row;
    assert.equal(words(stopped, "ask-card-first"), "was stopped");
    assert.deepEqual(buttons(stopped), [], "folded: an answer that did not finish waits for nobody");
    stopped.querySelector(".ask-card-toggle").dispatch("click");
    // (fails before: yes — found by hand in the browser: a stopped card offered Send to main agent for an answer that
    // never came)
    assert.deepEqual(buttons(stopped).filter((/** @type {string} */ b) => b !== "Open"), ["Ask again", "Copy"], "what it wrote so far is read and copied; an answer that did not finish is not handed on from the card");
    page.outside = "Claude Code";
    assert.equal(words(drawn(sent()).row, "ask-card-note"), null, "and nothing is said of passing it on");
    page.outside = null;
    // Filament restarted while it worked: no answer's mark, and the list holds it no longer.
    page.marks = { dispatch: sent() };
    const lost = drawn(sent(), 600_000).row;
    assert.equal(lost.className, "ask-card is-lost");
    assert.equal(words(lost, "ask-card-first"), "did not finish: Filament restarted while it worked");
    assert.deepEqual(buttons(lost), []);
    lost.querySelector(".ask-card-line").dispatch("click");
    assert.deepEqual(buttons(lost), ["Ask again"], "opened by its line: it has no answer for a chevron");
    btn(lost, "Ask again").dispatch("click");
    assert.deepEqual(page.calls, [["again", "sa_1", "product", QUESTION]], "anew, by its tag, with the question");
    assert.equal(words(drawn(sent({ exchange: 1, followUp: true })).row, "ask-card-you"), "You asked again");
    // The chat holds only the list's clipped end: opened, the whole answer is read once.
    page.marks = { dispatch: sent() };
    page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 8_000, report: "THE WHOLE…", delivery: "held" }] });
    const clipped = drawn(sent()).row;
    clipped.querySelector(".ask-card-toggle").dispatch("click");
    await settle();
    assert.match(String(clipped.querySelector(".ask-card-body").innerHTML), /THE WHOLE ANSWER/);
  });

  // (fails before: yes — a read that failed kept the list's words for the card's life: once 4,000 characters, the list's
  // heads made them its first 600)
  test("a clipped answer whose whole could not be read shows the list's words, and its next opening reads again", async () => {
    let fails = true;
    let asks = 0;
    chipActions.cardAnswer = async () => {
      asks++;
      if (fails) throw new Error("gone");
      return "THE WHOLE ANSWER";
    };
    page.marks = { dispatch: sent() };
    page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 8_000, report: "THE HEAD…", reportHead: true, delivery: "held" }] });
    const card = drawn(sent());
    const toggle = () => card.row.querySelector(".ask-card-toggle").dispatch("click");
    toggle();
    await settle();
    assert.match(String(card.row.querySelector(".ask-card-body").innerHTML), /THE HEAD…/);
    card.repaint();
    await settle();
    assert.equal(asks, 1, "not asked again while it stands open");
    fails = false;
    toggle();
    toggle();
    await settle();
    assert.equal(asks, 2, "its next opening asks again");
    assert.match(String(card.row.querySelector(".ask-card-body").innerHTML), /THE WHOLE ANSWER/);
  });

  // (fails before: yes — an answer read back empty held the words as they stood then, the list's head, though its agent's
  // cards' form came after)
  test("a clipped answer read back empty shows the list's words as they move — its head, then its agent's cards' form — and its next opening reads again", async () => {
    let asks = 0;
    chipActions.cardAnswer = async () => (asks++, "");
    /** @type {any} */
    let form;
    chipActions.subagentCard = () => form;
    try {
      page.marks = { dispatch: sent() };
      page.row = working({ status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 8_000, report: "THE HEAD…", reportHead: true, delivery: "held" }] });
      const card = drawn(sent());
      const body = () => String(card.row.querySelector(".ask-card-body").innerHTML);
      const toggle = () => card.row.querySelector(".ask-card-toggle").dispatch("click");
      toggle();
      await settle();
      assert.match(body(), /THE HEAD…/);
      form = { status: "done", report: "THE CARDS' FORM" };
      card.repaint();
      await settle();
      assert.match(body(), /THE CARDS’ FORM|THE CARDS' FORM/, "the form, once it is read");
      assert.equal(asks, 1, "not asked again while it stands open");
      toggle();
      toggle();
      await settle();
      assert.equal(asks, 2, "its next opening asks again");
    } finally {
      chipActions.subagentCard = null;
    }
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 4: a worker's rows read "Sub-agent …" whatever card it ran as, and
  // nothing in the chat said what a launch was handed)
  test("a worker sent off is a row named by its card, with what it may do and what it was handed; a card says the change after its question", () => {
    const off = /** @type {any} */ ({ type: "subagent", event: "dispatch", agentId: "sa_7", exchange: 0, description: "find the retry", model: "zai/glm-5.3", view: "folded", may: "read", card: { tag: "scout", name: "Scout" }, handed: "since:v1.2" });
    /** @param {any} m */
    const said = (m) => /** @type {any} */ (subagentMarkRow(m)).querySelector(".sub-mark-text").textContent;
    assert.equal(/** @type {any} */ (subagentMarkRow(off)).className, "tool-note sub-mark is-dispatch", "a row, not a card: it was sent off, not asked");
    assert.equal(said(off), "You sent Scout “find the retry” off · zai/glm-5.3 · sees Folded · read-only · with the changes since v1.2");
    assert.match(said({ ...off, followUp: true, exchange: 1, description: "check again", handed: "running" }), /^You asked Scout “check again” again · .* · with what this turn changed so far$/);
    assert.match(said({ ...off, may: "copy", card: { tag: "tester", name: "Tester" }, handed: undefined }), /^You sent Tester “find the retry” off · .* · in its own copy, nothing kept$/);
    assert.match(said({ ...off, event: "arrival", status: "done", ms: 9_000, rounds: 2, toolCalls: 3, delivery: "auto", read: "here" }), /^Scout “find the retry” reported · /);
    assert.match(said({ ...off, event: "arrival", status: "failed", delivery: "auto", read: "here" }), /^Scout “find the retry” failed/);
    // A card: the change stands after the question, and says how many files once the answer is back.
    page.marks = { dispatch: sent({ handed: "since:v1.2" }) };
    const asked = drawn(sent({ handed: "since:v1.2" })).row;
    assert.deepEqual([words(asked, "ask-card-question"), words(asked, "ask-card-handed")], [QUESTION, "with the changes since v1.2"]);
    page.marks = { dispatch: sent({ handed: "since:v1.2" }), arrival: back({ handed: "since:v1.2", handedFiles: 3 }) };
    assert.equal(words(drawn(sent({ handed: "since:v1.2" })).row, "ask-card-handed"), "with the changes since v1.2 · 3 files");
    page.marks = { dispatch: sent() };
    assert.ok(drawn(sent()).row.querySelector(".ask-card-handed").classList.contains("hidden"), "no change, no word of one");
    // The words, and what an agent may do as a fact after its name.
    assert.deepEqual(["running", "turn", "uncommitted", "since:release/2", "", null, "everything"].map((s) => handedWords(s)), ["with what this turn changed so far", "with the last turn's change", "with the uncommitted change", "with the changes since release/2", "", "", ""]);
    assert.deepEqual([handedWords("turn", 1), handedWords("turn", 0), handedWords("", 4)], ["with the last turn's change · 1 file", "with the last turn's change · 0 files", ""]);
    assert.deepEqual([{ may: "read" }, { may: "copy" }, { may: "edit", work: { pending: 0 } }, { may: "edit", work: null }].map(mayFact), ["read only", "runs in its own copy, nothing kept", "edits in its own copy", "edits in the session's folder"]);
    const viewer = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.ok(viewer.includes('sa.asked ? "" : sa.card.name,\n        // Where it edits, the folder of its copy on hover; the model with the provider that runs it.\n        copyFact(sa) || mayFact(sa),'), "the head of a worker's conversation names its card and what it may do");
    // (fails before: yes — the head said "edits in its own copy" and the model alone: the owner asked "What copy?" and
    // "which provider this agent is from")
    const copy = copyFact({ may: "edit", work: { folder: "H:/filament/.git/filament-worktrees/sa_9781f1ee" } });
    assert.equal(copy?.words, "edits in its own copy, a git worktree");
    assert.ok(String(copy?.title).startsWith("Its copy: H:/filament/.git/filament-worktrees/sa_9781f1ee\nA second checkout of the project with no branch of its own. The Changes pane and the branch button show this chat's folder, so they do not list it"), copy?.title);
    assert.deepEqual([copyFact({ may: "edit", work: { folder: null } }), copyFact({ may: "read" }), copyFact({ may: "edit", work: null })], [null, null, null]);
    assert.deepEqual([modelFact("Opus", " at max", "Anthropic"), modelFact("glm-5.3", "", null)], ["Opus at max on Anthropic", "glm-5.3"]);
  });

  // (fails before: yes — step 4, case 24: a worker asked by its tag came back with changes in its own copy, and its
  // card had no way to bring them in; since 10-28 — the Designer's of 10-27 — it says what waits and opens its row in
  // Changes, where Apply says what it would do, in place of an Apply that wrote at once)
  test("a worker asked by its tag that came back with changes says what waits on its card, and Review › opens its row in Changes", async () => {
    /** @type {string[]} */
    const reviewed = [];
    /** @type {{ pending: number } | null} */
    let work = { pending: 2 };
    Object.assign(chipActions, { subagentWork: () => work, reviewSubagent: (/** @type {string} */ id) => { reviewed.push(id); } });
    try {
      const builder = { card: { tag: "builder", name: "Builder" } };
      page.marks = { dispatch: sent(builder), arrival: back({ ...builder, changes: 2 }) };
      const { row } = drawn(sent(builder));
      assert.ok(buttons(row).includes("2 files wait in its copy · Review ›"), buttons(row).join("|"));
      assert.ok(!buttons(row).some((/** @type {string} */ b) => b.startsWith("Apply")), "no Apply that writes at once");
      btn(row, "2 files wait in its copy · Review ›").dispatch("click");
      await settle();
      assert.deepEqual(reviewed, ["sa_1"]);
      // Nothing waits any more: nothing said. The list not read yet: what the answer's mark said.
      work = { pending: 0 };
      assert.ok(!buttons(drawn(sent(builder)).row).some((/** @type {string} */ b) => b.includes("wait in its copy")));
      work = null;
      page.known = false;
      assert.ok(buttons(drawn(sent(builder)).row).includes("2 files wait in its copy · Review ›"));
      page.marks = { dispatch: sent(builder), arrival: back({ ...builder, changes: 1 }) };
      assert.ok(buttons(drawn(sent(builder)).row).includes("1 file waits in its copy · Review ›"));
      page.known = true;
      // (fails before: yes — found by hand in the browser: asked a second time, both of its cards offered Apply, the
      // first for a change that was applied already) One copy holds all it changed: its newest answer's card offers it.
      work = { pending: 2 };
      const done = { status: "done", startedAt: 1_000, endedAt: 8_000, report: "DONE", delivery: "held" };
      page.row = working({ ...builder, status: "done", may: "edit", exchanges: [done, done] });
      page.marks = { dispatch: sent(builder), arrival: back({ ...builder, changes: 2 }) };
      assert.ok(!buttons(drawn(sent(builder)).row).some((/** @type {string} */ b) => b.includes("wait in its copy")), "the first answer's card");
      const again = { ...builder, exchange: 1, followUp: true };
      page.marks = { dispatch: sent(again), arrival: back({ ...again, changes: 2 }) };
      assert.ok(buttons(drawn(sent(again)).row).includes("2 files wait in its copy · Review ›"), "the newest answer's card");
    } finally {
      Object.assign(chipActions, { subagentWork: null, reviewSubagent: null });
    }
  });

  test("the two marks a chat holds of one question, wherever they stand", () => {
    const other = sent({ agentId: "sa_2" });
    const chat = { asked: [sent()], turns: [{ boundaries: [other], boundariesAfter: [] }, { boundaries: [], boundariesAfter: [back(), { type: "compaction" }, { ...back(), asked: undefined }] }] };
    assert.deepEqual(cardMarksOf(chat, "sa_1", 0), { dispatch: chat.asked[0], arrival: chat.turns[1].boundariesAfter[0] });
    assert.deepEqual(cardMarksOf(chat, "sa_2", 0), { dispatch: other });
    assert.deepEqual(cardMarksOf(chat, "sa_1", 1), {});
    assert.deepEqual(cardMarksOf(null, "sa_1", 0), {});
  });
});
