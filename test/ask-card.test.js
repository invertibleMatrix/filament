// The card that asks before a message is sent (HarnessV4_Tasks C26). A message that would not fit, or whose session's
// cache has gone cold, or whose coding agent keeps no session of the chat any more, stops and asks. Made simple on the
// owner's word of 10-17 (U11: "the compaction is still very very non user friendly. no one would understand what is
// happening"), and laid out as proposal_ux §4.12 step 3 draws it (U5 phase 3): its question and one sentence — why it
// asks, and what the chosen way does —, the ways themselves as rows, each with what it does and costs and on its right
// what it leaves and how long it takes — the main ones first, Send it as it is among them where the message could go so,
// the rest (one that cannot run now with why) and the way to stop being asked under More ways; for this compaction
// only, the side model (the owner's words of 10-18: "also the model selection for other strategies"); at its foot what
// it knows, Not now, and the one act. The ways are the owner's rules of 10-31: an agent's own two, the same model, a side
// model, the instant fold — and on a cold cache Send it as it is first. Compact and send turns the card into its own progress, and its flag
// says what the message waits for.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askCard, askFacts, askFlag, askOf, askReason, askSentence, askTitle, asIsLine, carryChoices, errorBanner, switchCard, switchChoices, wayDoes, withoutAsked } from "../src/ui/harness/conversation/interaction.js";
import { stoppedToAsk } from "../src/ui/harness/conversation/history.js";
import { spanWords } from "../src/ui/harness/widgets/kit.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";
import { choiceCompaction } from "../src/ui/harness/widgets/compaction.js";

const QUESTION = "This session has been idle 2 h 10 m, and Claude Code holds ≈180,000 tokens of its 200,000-token window: a coding agent's cache lasts 1 h at the most, so going on pays for all of it again at the full price. Send it as it is, or make room first?";
const COLD = Object.freeze({ kind: "cold", reads: { kind: "agent", name: "Claude Code", from: "session" }, cache: { state: "cold", idleMs: 7_800_000, ttlMs: 3_600_000, leftMs: 0 }, tokens: 180_000, estimated: true, usable: 170_000, window: 200_000 });
/** The owner's card of 10-17: Claude Code past a 400K line. */
const FULL = Object.freeze({ kind: "size", why: "the agent's context holds 408,244 of its 1,000,000-token window, past the 400,000-token compaction line", reads: { kind: "agent", name: "Claude Code · Northwind", from: "session" }, cache: { state: "warm", idleMs: 60_000, ttlMs: 3_600_000, leftMs: 480_000 }, tokens: 408_244, estimated: false, usable: 400_000, window: 1_000_000 });
/** A Claude Code chat's ways, as askChoices lists them: its own two, then the side model and the instant fold.
 *  @type {import("../src/ui/harness/widgets/compaction.js").WayChoice[]} */
const WAYS = [
  { id: "way:own", label: "Claude Code makes room its own way", sub: "Reads ≈180K again · forked first, so Undo brings its session back", recommended: true, disabled: false, title: "It compacts its own session, as its /compact does.", writes: false, main: true, after: "", cost: "", pace: "", note: "Reads ≈180K again · forked first, so Undo brings its session back", tag: "Recommended", folds: false },
  { id: "way:self", label: "Claude Code writes the summary", sub: "Not offered: no session of this chat to go on in, or it writes no summary", recommended: false, disabled: true, title: "It keeps no session of this chat that your next message goes on in, or writes no summary", writes: false, main: false, after: "", cost: "", pace: "", note: "", tag: "", folds: false },
  { id: "side", label: "Side model", sub: "≈ $0.12 · 8 calls · house-cheap · one after another · about 4 min", recommended: false, disabled: false, title: "A side model writes one summary of everything; turns too big for it whole go with their tool calls folded.", writes: true, main: true, after: "", cost: "≈ $0.12 · 8 calls · house-cheap", pace: "one after another · about 4 min", note: "Reads the folded turns in 8 calls: too big for one", tag: "", folds: false },
  { id: "fold", label: "Instant fold", sub: "30K after · Free · no model call", recommended: false, disabled: false, title: "Your words and the answers stay; each tool call becomes one line. No summary, no model call.", writes: false, main: true, after: "30K after", cost: "Free · no model call", pace: "instant", note: "Leaves 12K of the earlier turns", tag: "", folds: true },
];
/** The same model's summary, as the card lists it on Filament's loop. @type {import("../src/ui/harness/widgets/compaction.js").WayChoice} */
const SAME = { id: "same", label: "Same model", sub: "≈ $0.29 · 1 call · glm-5.3 · from the cache", recommended: false, disabled: false, title: "The chat's own model writes one summary of everything, from its warm cache while it lasts.", writes: false, main: true, after: "", cost: "≈ $0.29 · 1 call · glm-5.3 · from the cache", pace: "", note: "From its warm cache", tag: "", folds: false };
const tick = () => new Promise((r) => setImmediate(r));
/** The card's own buttons, the ways and a running compaction's Stop aside. @param {any} el @returns {any[]} */
const answers = (el) => el.querySelectorAll("button").filter((/** @type {any} */ b) => !/ix-choice|compacting-stop/.test(String(b.className)));
/** What the card shows on its face: the buttons in its answers row, while that row shows. @param {any} el */
const faceOf = (el) => {
  const acts = el.querySelector(".ix-error-acts");
  return acts.classList.contains("hidden") ? [] : acts.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent);
};
/** Whether More ways is open. @param {any} el */
const moreOpen = (el) => !el.querySelector(".ix-ask-more").classList.contains("hidden");
/** More ways, opened. @param {any} el */
const openMore = (el) => {
  if (!moreOpen(el)) el.querySelector(".ix-ask-toggle").dispatch("click");
  return el.querySelector(".ix-ask-more");
};
/** A way's name, its tag aside. @param {any} r */
const nameOf = (r) => {
  const b = r.querySelector("b");
  const tag = String(b.querySelector(".ix-choice-tag")?.textContent || "");
  return b.textContent.slice(0, b.textContent.length - tag.length);
};
/** The ways listed, on the face then under More ways: name, checked, whether it says it cannot run. @param {any} el */
const waysOf = (el) => el.querySelectorAll(".ix-way").map((/** @type {any} */ r) => [nameOf(r), r.getAttribute("aria-checked"), r.getAttribute("aria-disabled")]);
/** Each way's tag, "" where it has none. @param {any} el */
const tagsOf = (el) => el.querySelectorAll(".ix-way").map((/** @type {any} */ r) => String(r.querySelector(".ix-choice-tag")?.textContent || ""));
/** The act's words. @param {any} el */
const actOf = (el) => el.querySelector(".ix-ask-act").textContent;
/** What Not now says it does. @param {any} el */
const notNowSays = (el) => el.querySelector(".ix-error-acts").querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").getAttribute("title");
/** The sentence. @param {any} el */
const said = (el) => el.querySelector(".ix-error-msg").textContent;
/** A writer picker the test drives: what was set on it, and its pick. */
const pickerOf = () => {
  /** @type {{ set: string[], pick: (name: string) => void }} */
  const p = { set: [], pick: () => {} };
  return { p, make: (/** @type {(name: string) => void} */ onPick) => { p.pick = onPick; return { el: /** @type {any} */ (document.createElement("span")), set: (/** @type {string} */ name) => { p.set.push(name); } }; } };
};
/** A compaction the test settles by hand. */
const settle = () => {
  /** @type {(v: unknown) => void} */
  let end = () => {};
  const done = new Promise((r) => { end = r; });
  return { done, end };
};

describe("the card that asks before a message is sent", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  // (fails before: yes — neither card said what would read the session, nor its cache's clock)
  test("the question a turn was stopped with comes from its refusal's fields, or — a seed its agent refused — its facts", () => {
    assert.deepEqual(askOf({ resumeQuestion: { why: "cold", held: 180_000, estimated: true, window: 200_000, usable: 170_000, reads: COLD.reads, cache: COLD.cache } }, null), COLD);
    assert.equal(askOf({ resumeQuestion: { why: "lost", held: 12_000, estimated: true, window: 200_000, usable: 170_000, reads: { kind: "agent", name: "Codex", from: "copy" }, cache: null } }, null)?.kind, "lost");
    assert.equal(askOf({ resumeQuestion: { why: "lost", moved: "fix-login", held: 12_000, reads: { kind: "agent", name: "Codex", from: "copy" } } }, null)?.moved, "fix-login", "the folder a moved chat starts its new session in");
    assert.deepEqual(askOf({ needsCompaction: true, sentTokens: 36_000, usable: 34_000, window: 40_000, estimated: true, reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, cache: null }, null),
      { kind: "size", why: null, reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, cache: null, tokens: 36_000, estimated: true, usable: 34_000, window: 40_000 });
    assert.equal(askOf({ needsCompaction: true, why: "the history weighs 36,000 of the 40,000-token window, past the 34,000-token compaction line", sentTokens: 36_000 }, null)?.why, "the history weighs 36,000 of the 40,000-token window, past the 34,000-token compaction line");
    assert.equal(askOf({ needsCompaction: true, sentTokens: 180_000, usable: 170_000, window: 200_000, estimated: false }, null)?.estimated, false, "an agent's own count is no estimate");
    assert.deepEqual(askOf(null, { needsRoom: true }), { kind: "refused" });
    assert.equal(askOf({ error: "boom" }, { limit: { window: "5h" } }), null, "any other failure asks nothing");
    assert.equal(askOf(null, null), null);
  });

  test("the facts: what reads the session and from where, how much of which window against the line, and the cache's clock; one the server did not say is left out", () => {
    assert.deepEqual(askFacts(COLD), ["Read by Claude Code, in its own session", "≈180,000 of 200,000 tokens · the line is at 170,000", "Cache cold · idle 2 h 10 min, it lasts 1 h"]);
    assert.deepEqual(askFacts({ kind: "lost", reads: { kind: "agent", name: "Codex", from: "copy" }, cache: null, tokens: 12_000, estimated: true, usable: 170_000, window: 200_000 }),
      ["Read by Codex, in a new session started from Filament's copy", "≈12,000 of 200,000 tokens · the line is at 170,000"]);
    assert.deepEqual(askFacts({ kind: "size", reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, cache: { state: "warm", idleMs: 60_000, ttlMs: 300_000, leftMs: 240_000 }, tokens: 36_000, estimated: true, usable: 34_000, window: 40_000 }),
      ["Read by zai/glm-5.3", "≈36,000 of 40,000 tokens · the line is at 34,000", "Cache warm · 4 min left"]);
    assert.deepEqual(askFacts({ kind: "size", cache: { state: "none", idleMs: 0, ttlMs: 300_000, leftMs: 0 }, tokens: 180_000, estimated: false, window: 200_000 }), ["180,000 of 200,000 tokens", "No cache · its replies cached nothing"]);
    assert.deepEqual(askFacts({ kind: "refused" }), []);
    assert.deepEqual([spanWords(40_000), spanWords(720_000), spanWords(7_800_000), spanWords(3_600_000)], ["40 s", "12 min", "2 h 10 min", "1 h"]);
  });

  // (fails before: yes — the card opened with the server's "the agent's context holds 408,244 of its 1,000,000-token
  // window, past the 400,000-token compaction line" and seven ways under it; the owner: "no one would understand what
  // is happening")
  test("one sentence: why it asks, then what its main answer does, by whom — the agent's own compaction, or the writer of Filament's summary by name", () => {
    const own = wayDoes("way:own", { agentName: "Claude Code", agent: true });
    assert.equal(askSentence(FULL, own, "x"), "This chat is past your 400K line (408K), so Claude Code will compact the chat before your message goes.");
    const glm = { kind: "size", reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, tokens: 36_000, estimated: true, usable: 34_000, window: 40_000 };
    assert.equal(askSentence(/** @type {any} */ (glm), wayDoes("side", { writer: "zai/glm-5.3-flash" }), "x"), "This chat is past your 34K line (≈36K), so GLM-5.3 Flash will summarize everything before your message goes.");
    assert.equal(askSentence(FULL, wayDoes("side", { agentName: "Claude Code", agent: true, writer: "zai/glm-5.3-flash" }), "x"),
      "This chat is past your 400K line (408K), so GLM-5.3 Flash will summarize everything for a fresh Claude Code session before your message goes.", "Filament's summary in an agent's session: the agent starts fresh from it");
    // (fails before: yes — the owner's rules of 10-31: the card's summary kept a tail, and its fold shortened the turns
    // "to your words and the answers" under a name no list said) One summary, of everything, by the same model or a side
    // model; the instant fold is Filament's.
    assert.deepEqual([wayDoes("same", { writer: "zai/glm-5.3" }), wayDoes("summary", { writer: "zai/glm-5.3" })].map((w) => [w.who, w.does]), [["GLM-5.3", "summarize everything"], ["GLM-5.3", "summarize everything"]]);
    assert.deepEqual(wayDoes("fold", {}), { who: "Filament", does: "fold the tool calls away, one line each", doing: "is folding the tool calls away" });
    assert.deepEqual(["trim", "auto", "newest"].map((id) => wayDoes(id, { writer: "zai/glm-5.3" }).does), ["make room", "make room", "make room"], "a way no list offers any more");
    assert.equal(askSentence(FULL, null, "x"), "This chat is past your 400K line (408K), so room is made before your message goes.", "before the ways come: the session's own way");
    // A fresh agent session's copy past the line; a window with no room for a reply.
    assert.equal(askReason({ kind: "size", reads: { kind: "agent", name: "Codex", from: "copy" }, tokens: 180_000, estimated: true, usable: 170_000, window: 200_000 }), "Codex starts fresh from Filament's copy of the chat, and the copy is past your 170K line (≈180K)");
    assert.equal(askReason({ kind: "size", tokens: 199_500, estimated: true, usable: 200_000, window: 200_000 }), "This chat leaves no room for a reply in its 200K window");
    // A cold cache, a lost session, one that moved: the server's question, the way in it.
    assert.equal(askSentence(COLD, own, "x"), "This chat sat idle 2 h 10 min and Claude Code's cache has gone cold, so going on reads all ≈180K again at full price. Send it as it is, or let Claude Code compact the chat first?");
    assert.equal(askSentence({ kind: "lost", reads: { kind: "agent", name: "Codex", from: "copy" }, tokens: 12_000, estimated: true }, null, "x"), "Codex no longer has a session of this chat, so it starts a new one from Filament's copy (≈12K), with nothing cached. Send it as it is, or make room first?");
    assert.equal(askReason({ kind: "lost", moved: "fix-login", reads: { kind: "agent", name: "Codex", from: "copy" }, tokens: 12_000, estimated: true }), "This chat moved to fix-login, so Codex starts a new session there from Filament's copy (≈12K), with nothing cached");
    // No figures: the server's words of what does not fit; a seed its agent refused: the failure's.
    assert.equal(askSentence({ kind: "size", why: "past the line" }, own, "the message"), "past the line");
    assert.equal(askSentence({ kind: "size" }, own, "the message"), "the message");
    assert.equal(askSentence({ kind: "refused" }, own, "Codex could not take it in"), "Codex could not take it in");
  });

  // (fails before: yes — U5 phase 3: the ways waited under Other ways behind one main answer; the mock lays them out)
  test("the face: its question, the sentence, the main ways as rows — the one the session takes chosen — what it knows, Not now and the act; the rest and the way to stop being asked under More ways", async () => {
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (askCard(FULL.why, FULL, {
      options: async () => ({ ways: WAYS, writable: true, writer: "zai/glm-5.3-flash", tail: 30, suggest: "compact", agentName: "Claude Code" }),
      onCompact: (choice, once) => (did.push(["compact", choice, once]), new Promise(() => {})),
      onNeverAsk: () => did.push("never"),
      onDismiss: () => did.push("dismiss"),
    }));
    await tick();
    assert.ok(el.classList.contains("ix-resume") && el.classList.contains("ix-ask"), "a question, not a failure");
    assert.equal(el.querySelector(".ix-ask-title").textContent, "Make room before this message?");
    assert.equal(said(el), "This chat is past your 400K line (408K), so Claude Code will compact the chat before your message goes.");
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"]);
    // Not now gives the message back to the box, its files with it (the owner's of 11-01; until then a stopped turn's
    // message stayed in the chat, unsent, and the card said so: not-now-takes-back.test.js).
    assert.equal(notNowSays(el), "Close the card: your message goes back to the box");
    assert.equal(el.querySelector(".ix-ask-act").classList.contains("primary"), true, "one act");
    assert.deepEqual(el.querySelectorAll(".ix-ask-fact").map((/** @type {any} */ f) => f.textContent), askFacts(FULL), "what the card knows, at its foot");
    // The main ways that can run, as they came, the one the session takes chosen; the one that cannot run under More ways.
    assert.deepEqual(waysOf(el), [["Claude Code makes room its own way", "true", null], ["Side model", "false", null], ["Instant fold", "false", null], ["Claude Code writes the summary", "false", "true"]]);
    assert.equal(el.querySelector(".ix-ask-ways").querySelectorAll(".ix-way").length, 3, "on its face, the main ways");
    // A way: what it does, how it reads and what it costs; on its right what it leaves and how long it takes.
    const side = el.querySelectorAll(".ix-way")[1];
    assert.equal(side.querySelector(".ix-way-line").textContent, "A side model writes one summary of everything; turns too big for it whole go with their tool calls folded.");
    assert.equal(side.querySelector(".ix-way-sub").textContent, "Reads the folded turns in 8 calls: too big for one · ≈ $0.12 · 8 calls · house-cheap");
    assert.equal(side.querySelector(".ix-way-fig").textContent, "one after another · about 4 min", "a summary not yet written says no figure");
    assert.equal(el.querySelectorAll(".ix-way")[2].querySelector(".ix-way-fig").textContent, "30K afterinstant");
    // (fails before: yes — the owner's rules of 10-31: the card marked no way recommended, and nothing said a way was costly)
    assert.deepEqual(tagsOf(el), ["Recommended", "", "", ""]);
    assert.equal(moreOpen(el), false, "the rest is folded away");
    assert.equal(el.querySelector(".ix-ask-toggle").textContent, "More ways (1)");
    const more = openMore(el);
    assert.equal(el.querySelector(".ix-ask-toggle").getAttribute("aria-expanded"), "true");
    assert.match(more.querySelector(".ix-way").textContent, /Can't run now\. It keeps no session of this chat/);
    assert.deepEqual(more.querySelectorAll(".ix-ask-never button").map((/** @type {any} */ b) => b.textContent), ["Just do it from now on"]);
    assert.match(more.querySelector(".ix-ask-never button").getAttribute("title"), /Switch it back: How earlier turns are kept › Then$/, "named as the sheet names its row");
    // Another way: the sentence says it, and the act takes it. One that cannot run now takes no click.
    more.querySelector(".ix-way").dispatch("click");
    assert.equal(el.querySelectorAll(".ix-way")[0].getAttribute("aria-checked"), "true");
    el.querySelectorAll(".ix-way")[2].dispatch("click");
    assert.equal(said(el), "This chat is past your 400K line (408K), so Filament will fold the tool calls away, one line each for a fresh Claude Code session before your message goes.");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, [["compact", "fold", null]]);
    assert.ok(el.classList.contains("is-running"), "the ways and the answers step aside while it runs");
    el.querySelector(".ix-ask-never button").dispatch("click");
    el.querySelector(".ix-ask-toggle").dispatch("click");
    assert.equal(did.length, 1, "a spent card answers nothing more");
    assert.equal(el.querySelector(".ix-ask-toggle").getAttribute("aria-expanded"), "true", "nor folds while it runs");
  });

  // (fails before: yes — the owner's rules of 10-31: "Cold after a break: Send it as it is, Side model (recommended),
  // Instant fold, Same model (costly)" — Send it as it is came after the ways)
  test("a cold cache: Send it as it is first, then the ways, the recommended one chosen; picked, the act sends; Just send from now on under More ways", async () => {
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (askCard(QUESTION, COLD, {
      options: async () => ({ ways: WAYS, agentName: "Claude Code" }),
      onCompact: () => did.push("compact"),
      onSendAsIs: () => (did.push("as it is"), true),
      onNeverAsk: () => did.push("never"),
      onDismiss: () => did.push("dismiss"),
    }));
    await tick();
    assert.equal(said(el), "This chat sat idle 2 h 10 min and Claude Code's cache has gone cold, so going on reads all ≈180K again at full price. Send it as it is, or let Claude Code compact the chat first?");
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"]);
    assert.deepEqual(waysOf(el).slice(0, 4).map((w) => w[0]), ["Send it as it is", "Claude Code makes room its own way", "Side model", "Instant fold"]);
    assert.equal(el.querySelector(".ix-way-send .ix-way-fig").textContent, "≈180K", "what goes, as it is");
    assert.deepEqual(openMore(el).querySelectorAll(".ix-ask-never button").map((/** @type {any} */ b) => [b.textContent, /Switch it back: How earlier turns are kept › Back after a break$/.test(b.getAttribute("title"))]), [["Just send from now on", true]]);
    el.querySelector(".ix-way-send").dispatch("click");
    assert.equal(actOf(el), "Send");
    assert.equal(said(el), "This chat sat idle 2 h 10 min and Claude Code's cache has gone cold, so going on reads all ≈180K again at full price. Your message goes now, as it is.");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, ["as it is"]);
    // Filament's loop, its cache cold: the side model recommended and chosen, the same model last and costly.
    const loop = /** @type {any} */ (askCard("cold", { ...COLD, reads: { kind: "model", name: "zai/glm-5.3", from: "session" } }, {
      options: async () => ({ ways: [{ ...WAYS[2], recommended: true, tag: "Recommended" }, WAYS[3], { ...SAME, sub: "≈ $0.51 · 1 call · glm-5.3", cost: "≈ $0.51 · 1 call · glm-5.3", note: "Reads the turns whole", tag: "Costly" }], writable: true, writer: "house-cheap", same: "zai/glm-5.3" }),
      onCompact: () => {}, onSendAsIs: () => {}, onNeverAsk: () => {},
    }));
    await tick();
    assert.deepEqual(waysOf(loop).map((w) => [w[0], w[1]]), [["Send it as it is", "false"], ["Side model", "true"], ["Instant fold", "false"], ["Same model", "false"]]);
    assert.deepEqual(tagsOf(loop), ["", "Recommended", "", "Costly"]);
    assert.ok(loop.querySelectorAll(".ix-choice-tag")[1].classList.contains("is-costly"));
    assert.match(said(loop), /Send it as it is, or let House Cheap summarize everything first\?$/);
  });

  // (fails before: yes — the owner's of 11-06: "a card should be shown about it that do you wanna update the session with
  // latest stuff that is added or want to continue with current one"; nothing asked)
  test("what the chat sends ahead changed: why, in words; the ways first, the recommended chosen, Send it as it is after them; Just send from now on writes its own switch", async () => {
    const q = { why: "changed", changes: ["MCP server linear connected"], held: 40_000, estimated: true, window: 200_000, usable: 170_000, reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, cache: { state: "warm", idleMs: 60_000, ttlMs: 300_000, leftMs: 240_000 } };
    const ask = /** @type {any} */ (askOf({ resumeQuestion: q }, null));
    assert.deepEqual([ask.kind, ask.changes], ["changed", ["MCP server linear connected"]]);
    assert.equal(askTitle(ask), "Update the session before this message?");
    assert.equal(askReason(ask), "What this chat sends ahead of its history changed — MCP server linear connected — so going on writes all ≈40K to zai/glm-5.3's cache again");
    assert.equal(asIsLine(ask, ""), "Going on writes all of it to the cache again, at a write's price.");
    const agent = { ...ask, changes: ["Filament was updated: what it tells the agent, or its tools, changed"], reads: { kind: "agent", name: "Claude Code", from: "session" } };
    assert.equal(askReason(agent), "What Claude Code is given ahead of this chat changed — Filament was updated: what it tells the agent, or its tools, changed — and in the session it goes on in, what it already loaded can keep its old form");
    assert.equal(asIsLine(agent, "Claude Code"), "Claude Code goes on in its session; what it already loaded there can keep its old form.");
    assert.equal(askSentence(agent, wayDoes("fold", { agentName: "Claude Code", agent: true }), "q"), `${askReason(agent)}. Send it as it is, or let Filament fold the tool calls away, one line each for a fresh Claude Code session first?`);
    // A cold question says what changed too.
    assert.match(String(askReason(/** @type {any} */ (askOf({ resumeQuestion: { ...q, why: "cold", cache: COLD.cache } }, null)))), /gone cold, so going on reads all ≈40K again at full price — and what it sends ahead of its history changed: MCP server linear connected$/);
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (askCard("q", ask, {
      options: async () => ({ ways: [{ ...WAYS[3], recommended: true, tag: "Recommended" }, WAYS[2], SAME], writable: true, writer: "house-cheap", same: "zai/glm-5.3" }),
      onCompact: (/** @type {any} */ c) => did.push(`compact ${c}`),
      onSendAsIs: () => (did.push("as it is"), true),
      onNeverAsk: () => did.push("never"),
      onDismiss: () => {},
    }));
    await tick();
    assert.deepEqual(waysOf(el).map((w) => [w[0], w[1]]), [["Instant fold", "true"], ["Side model", "false"], ["Same model", "false"], ["Send it as it is", "false"]], "the ways first, Send it as it is after them");
    assert.match(said(el), /Send it as it is, or let Filament fold the tool calls away, one line each first\?$/);
    assert.deepEqual(openMore(el).querySelectorAll(".ix-ask-never button").map((/** @type {any} */ b) => [b.textContent, /Switch it back: How earlier turns are kept › After an update$/.test(b.getAttribute("title"))]), [["Just send from now on", true]]);
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, ["compact fold"]);
  });

  // (fails before: yes — the owner's words: "ability to pick the model if other options were needed"; a writer could
  // only be changed in the session's settings, for every compaction after)
  test("for this compaction only: the side model stands under the ways, the ways are weighed again with it, and the act carries it; the same model's summary is the chat's own model's", async () => {
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const did = [];
    const { p, make } = pickerOf();
    const el = /** @type {any} */ (askCard("past the line", { kind: "size", tokens: 36_000, estimated: true, usable: 34_000, window: 40_000 }, {
      options: async (once) => {
        asked.push(once);
        return { ways: [{ ...SAME, recommended: true, tag: "Recommended" }, { ...WAYS[2], cost: `written by ${once?.model || "house-cheap"}` }, WAYS[3]], writable: true, writer: "house-cheap", same: "zai/glm-5.3" };
      },
      writerPicker: make,
      onCompact: (choice, once) => (did.push([choice, once]), new Promise(() => {})),
      onNeverAsk: () => did.push("never"),
    }));
    await tick();
    assert.deepEqual(asked, [null], "first the session's own plan");
    assert.deepEqual(p.set, ["house-cheap"], "the picker shows the side model that writes now");
    assert.equal(said(el), "This chat is past your 34K line (≈36K), so GLM-5.3 will summarize everything before your message goes.", "the same model is the chat's own");
    const once = el.querySelector(".ix-ask-once");
    assert.equal(once.classList.contains("hidden"), false);
    assert.match(once.textContent, /^For this compaction onlynothing is saved to the chat's settings/);
    // (fails before: yes — the owner's rules of 10-31: a summary keeps no tail) The side model alone, naming its way.
    assert.deepEqual(once.querySelectorAll(".ix-ask-field").map((/** @type {any} */ f) => f.querySelector(".ix-ask-hint").textContent), ["for “Side model”"]);
    assert.equal(el.querySelector(".ix-ask-tail"), null);
    el.querySelectorAll(".ix-way")[1].dispatch("click");
    assert.equal(said(el), "This chat is past your 34K line (≈36K), so House Cheap will summarize everything before your message goes.");
    // Another side model: the ways are weighed again as it would write them, and the sentence names it.
    p.pick("zai/glm-5.3-flash");
    await tick();
    assert.deepEqual(asked.at(-1), { model: "zai/glm-5.3-flash" });
    assert.match(el.querySelectorAll(".ix-way")[1].textContent, /written by zai\/glm-5\.3-flash/);
    assert.match(said(el), /so GLM-5\.3 Flash will summarize everything/);
    assert.deepEqual(p.set, ["house-cheap"], "the picker is not set back under the person's own pick");
    assert.deepEqual(faceOf(el), ["Compact and send"], "what does not fit is not sent as it is");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, [["side", { model: "zai/glm-5.3-flash" }]]);
    // A side model whose reading is the instant fold, its turns folding under the line: the sentence says the fold.
    const inst = /** @type {any} */ (askCard("past the line", { kind: "size", tokens: 36_000, estimated: true, usable: 34_000, window: 40_000 }, {
      options: async () => ({ ways: [{ ...WAYS[2], recommended: true, folds: true, cost: "Free · no model call" }], writable: true, writer: "house-cheap" }),
      writerPicker: pickerOf().make,
      onCompact: () => new Promise(() => {}),
    }));
    await tick();
    assert.equal(said(inst), "This chat is past your 34K line (≈36K), so Filament will fold the tool calls away, one line each before your message goes.");
  });

  // (fails before: yes — the owner's words of 10-18: "other ways is fine but there should be all the compaction
  // strategies listed in that and also the model selection for other strategies": a way that could not run was left
  // out, and the writer showed only once a summary was chosen — never on a Claude Code chat, whose own compaction is
  // chosen first)
  test("on a Claude Code chat whose own way is chosen, every way is listed — the main ones on the face, the one that cannot run with why under More ways — and the side model stands all the same", async () => {
    const { p, make } = pickerOf();
    const el = /** @type {any} */ (askCard(FULL.why, FULL, {
      options: async () => ({ ways: WAYS, writable: true, writer: "zai/glm-5.3-flash", agentName: "Claude Code" }),
      writerPicker: make,
      onCompact: () => new Promise(() => {}),
      onNeverAsk: () => {},
    }));
    await tick();
    assert.deepEqual(waysOf(el).map((w) => w[0]), ["Claude Code makes room its own way", "Side model", "Instant fold", "Claude Code writes the summary"]);
    assert.equal(el.querySelector(".ix-ask-toggle").textContent, "More ways (1)");
    assert.match(el.querySelectorAll(".ix-way")[3].textContent, /Can't run now\. It keeps no session of this chat that your next message goes on in, or writes no summary$/);
    assert.equal(el.querySelectorAll(".ix-way")[0].getAttribute("aria-checked"), "true", "Claude Code's own way is chosen");
    const once = el.querySelector(".ix-ask-once");
    assert.equal(once.classList.contains("hidden"), false, "the side model is there all the same");
    assert.deepEqual(once.querySelectorAll(".ix-ask-field").map((/** @type {any} */ f) => [f.classList.contains("hidden"), f.querySelector(".ix-ask-hint").textContent]), [[false, "for “Side model”"]]);
    assert.deepEqual(p.set, ["zai/glm-5.3-flash"], "it shows who writes now");
    el.querySelectorAll(".ix-way")[1].dispatch("click");
    assert.equal(said(el), "This chat is past your 400K line (408K), so GLM-5.3 Flash will summarize everything for a fresh Claude Code session before your message goes.");
    // No way of Filament's writes a summary: no side model to pick.
    const none = /** @type {any} */ (askCard(FULL.why, FULL, { options: async () => ({ ways: [WAYS[0], WAYS[3]], writable: true, writer: "zai/glm-5.3-flash", agentName: "Claude Code" }), writerPicker: pickerOf().make, onCompact: () => {} }));
    await tick();
    assert.equal(none.querySelector(".ix-ask-once").classList.contains("hidden"), true);
  });

  test("where no way can run now, each is listed with why, and there is nothing to compact by; a card whose figures did not come compacts by the session's own way", async () => {
    const none = /** @type {any} */ (askCard("past the line", { kind: "size" }, { options: async () => ({ ways: [{ ...WAYS[1] }, { ...WAYS[2], disabled: true, title: "no finished turn to summarize" }] }), onCompact: () => {}, onNeverAsk: () => {} }));
    await tick();
    assert.equal(none.querySelector(".ix-ask-act").disabled, true, "nothing can make room now");
    assert.deepEqual(waysOf(none), [["Side model", "false", "true"], ["Claude Code writes the summary", "false", "true"]], "the main one on the face, each with why");
    assert.match(none.querySelectorAll(".ix-way")[0].textContent, /Can't run now\. No finished turn to summarize/);
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (askCard("the earlier conversation was too long for Codex to take in. Nothing was compacted.", { kind: "refused" }, { options: async () => null, onCompact: (choice, once) => (did.push([choice, once]), new Promise(() => {})), onSendAsIs: () => did.push("as it is"), onNeverAsk: () => did.push("never"), onDismiss: () => {} }));
    await tick();
    assert.equal(said(el), "the earlier conversation was too long for Codex to take in. Nothing was compacted.", "a seed its agent refused: the failure's words");
    assert.equal(el.querySelectorAll(".ix-way").length, 0);
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"], "no Send it as it is");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, [[null, null]]);
    const bare = /** @type {any} */ (askCard("q", COLD, { onCompact: () => {} }));
    assert.deepEqual(faceOf(bare), ["Compact and send"], "an answer the page has no way for is not offered");
  });

  // (fails before: yes — the hunt's drive: a card you brought up over a held message, with no way that could run, chose
  // nothing, so its one act read Compact and send, disabled, and the message could only wait)
  test("where no way can run now and the card offers Send it as it is, that is chosen and the act sends", async () => {
    /** @type {any[]} */
    const did = [];
    const off = WAYS.filter((o) => !o.disabled).map((o) => ({ ...o, disabled: true, recommended: false, tag: "", title: "no finished turn to summarize" }));
    const el = /** @type {any} */ (askCard("q", { kind: "summoned", sends: true }, { options: async () => ({ ways: off, agentName: "Claude Code" }), onCompact: () => did.push("compact"), onSendAsIs: () => (did.push("as it is"), true), onDismiss: () => {} }));
    await tick();
    assert.equal(waysOf(el).find((w) => w[0] === "Send it as it is")?.[1], "true");
    assert.deepEqual([actOf(el), el.querySelector(".ix-ask-act").disabled], ["Send", false]);
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, ["as it is"]);
    // A card with no Send it as it is still has nothing to compact by.
    const held = /** @type {any} */ (askCard("q", { kind: "summoned" }, { options: async () => ({ ways: off }), onCompact: () => {}, onSendAsIs: () => {} }));
    await tick();
    assert.deepEqual([actOf(held), held.querySelector(".ix-ask-act").disabled], ["Compact", true]);
  });

  // (fails before: yes — the owner's report of 10-17: "why is that it shows a yellow not sent button when button is
  // pressed. after compaction that card collapses and that yellow not sent disappear. not a good UX")
  test("Compact and send turns the card into its progress: who makes room, the compaction's steps, clock and bar with its Stop; then the message on its way", async () => {
    const { done, end } = settle();
    /** @type {any[]} */
    const worked = [];
    /** @type {any} */
    let paint = null;
    let unwatched = 0;
    let stops = 0;
    const el = /** @type {any} */ (askCard(FULL.why, FULL, {
      options: async () => ({ ways: WAYS, agentName: "Claude Code" }),
      onCompact: () => done,
      onNeverAsk: () => {},
      onDismiss: () => {},
      watch: (fn) => { paint = fn; return () => { unwatched++; }; },
      onWorking: (w) => worked.push(w),
    }));
    await tick();
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.equal(said(el), "Making room: Claude Code is compacting the chat. Your message goes when it's done.");
    assert.ok(el.classList.contains("is-running"), "no greyed answers while it runs: they step aside");
    assert.equal(el.querySelector(".ix-ask-work").classList.contains("hidden"), false);
    assert.ok(el.querySelector(".ix-ask-work .compacting-bar"), "its bar, as the mock has it");
    assert.deepEqual(worked.map((w) => w.words), ["Making room: Claude Code is compacting the chat. Your message goes when it's done."], "the page keeps it with the turn");
    paint({ since: Date.now() - 42_000, step: "Claude Code compacts its own session", own: true, stoppable: true }, { onStop: () => { stops++; }, stopTitle: "Stop writing: nothing is compacted" });
    assert.match(el.querySelector(".compacting-words").textContent, /Claude Code compacts its own session · 0:4\d/);
    const stop = el.querySelector(".compacting-stop");
    assert.equal(stop.classList.contains("hidden"), false);
    stop.dispatch("click");
    assert.equal(stops, 1);
    end(true);
    await tick();
    assert.equal(said(el), "Room made. Your message is on its way.");
    assert.equal(el.querySelector(".ix-ask-work").classList.contains("hidden"), true);
    assert.equal(unwatched, 1, "it stops watching");
    assert.ok(el.classList.contains("is-running"), "spent: the message goes in its place");
  });

  // (fails before: yes — an answer that could not go left every button greyed, the card dead on the page; then the
  // card came back with nothing on it of why)
  test("a compaction stopped or failed gives the card back, with why on it; Send it as it is that could not go gives it back too", async () => {
    const { done, end } = settle();
    const el = /** @type {any} */ (askCard(QUESTION, COLD, {
      options: async () => ({ ways: WAYS, agentName: "Claude Code" }),
      onCompact: () => done,
      onSendAsIs: () => false,
      onDismiss: () => {},
    }));
    await tick();
    el.querySelector(".ix-ask-act").dispatch("click");
    end("Stopped: nothing was compacted, and your message waits here.");
    await tick();
    assert.ok(!el.classList.contains("is-running"));
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"]);
    assert.equal(el.querySelector(".ix-ask-act").disabled, false);
    assert.equal(el.querySelector(".ix-ask-note").textContent, "Stopped: nothing was compacted, and your message waits here.");
    assert.equal(el.querySelector(".ix-ask-note").classList.contains("hidden"), false);
    assert.match(said(el), /^This chat sat idle 2 h 10 min/, "the question again");
    el.querySelector(".ix-way-send").dispatch("click");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.equal(el.querySelector(".ix-ask-note").classList.contains("hidden"), true);
    await tick();
    assert.equal(el.querySelector(".ix-ask-act").disabled, false, "it could not go: the card is back");
  });

  // (fails before: yes — a card drawn again while its compaction ran, a chat switched away from and back, offered its
  // answers again as if nothing ran)
  test("a card drawn again while its Compact and send runs shows it running, and comes back if it could not go", async () => {
    const { done, end } = settle();
    /** @type {any} */
    let paint = null;
    const el = /** @type {any} */ (askCard(FULL.why, FULL, {
      options: async () => ({ ways: WAYS, agentName: "Claude Code" }),
      onCompact: () => {},
      onDismiss: () => {},
      watch: (fn) => { paint = fn; return () => {}; },
      pending: { done, words: "Making room: Claude Code is compacting the chat. Your message goes when it's done." },
    }));
    await tick();
    assert.equal(said(el), "Making room: Claude Code is compacting the chat. Your message goes when it's done.", "the ways that came do not say it over");
    assert.ok(el.classList.contains("is-running"));
    assert.equal(typeof paint, "function", "it watches the compaction");
    end(false);
    await tick();
    assert.ok(!el.classList.contains("is-running"));
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"]);
    assert.equal(said(el), "This chat is past your 400K line (408K), so Claude Code will compact the chat before your message goes.");
  });

  // (fails before: yes — the flag said "not sent", in the warning's yellow, under a question that was no failure)
  // (fails before: yes — U5 phase 3: the card asked "Compact first?" of every kind, and said nothing of sending as it is)
  test("the question the card asks, and what sending as it is does, by why it asks", () => {
    assert.deepEqual(
      [askTitle(FULL), askTitle(COLD), askTitle({ kind: "summoned", sends: true }), askTitle({ kind: "summoned" }), askTitle({ kind: "summoned", midTurn: true })],
      ["Make room before this message?", "Make room before this message?", "Make room before this message?", "Make room now?", "Make room while the turn runs?"],
    );
    assert.equal(asIsLine(COLD, "Claude Code"), "Going on reads all of it again, at full price.");
    assert.deepEqual([asIsLine({ kind: "lost" }, "Claude Code"), asIsLine({ kind: "lost" }, "")], ["Claude Code starts its new session from all of Filament's copy.", "The agent starts its new session from all of Filament's copy."]);
    // (fails before: yes — the row of a card you brought up said only what the turn would do at the line, where picking
    // it sends the message now and compacts nothing)
    const held = { kind: "summoned", sends: true };
    assert.deepEqual([asIsLine(held, "Claude Code"), asIsLine(held, "")], [
      "Your message goes now, nothing compacted — Claude Code may compact by itself mid-turn.",
      "Your message goes now, nothing compacted — the turn makes room at your line by itself.",
    ]);
    // (fails before: yes — the review's: past the line it said "nothing compacted", where the turn makes room by the
    // chat's own way before the message goes, or the chat asks again)
    const past = { ...held, tokens: 408_244, usable: 400_000 };
    assert.deepEqual([asIsLine(past, "Claude Code"), asIsLine({ ...past, tokens: 390_000 }, "")], [
      "Past your line, the chat still makes room its own way before your message goes — or asks again, where it asks first.",
      "Your message goes now, nothing compacted — the turn makes room at your line by itself.",
    ]);
  });

  // (fails before: yes — the review's: chosen, Send it as it is said "Your message goes now, as it is" past the line)
  test("a card you brought up past your line: Send it as it is says the chat still makes room first", async () => {
    const el = /** @type {any} */ (askCard("q", { kind: "summoned", sends: true, tokens: 408_244, usable: 400_000 }, { options: async () => ({ ways: WAYS, agentName: "Claude Code" }), onCompact: () => {}, onSendAsIs: () => {}, onDismiss: () => {} }));
    await tick();
    el.querySelector(".ix-way-send").dispatch("click");
    assert.equal(said(el), "This chat holds 408K of your 400K line. Past your line, the chat still makes room its own way before your message goes — or asks again, where it asks first.");
  });

  test("the flag under a stopped turn says what its message waits for", () => {
    assert.equal(askFlag(FULL), "waits for room");
    assert.equal(askFlag(COLD), "waits for your answer");
    assert.equal(askFlag({ kind: "lost" }), "waits for your answer");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.equal(timeline.split("asked = flagOf(turn, ask);").length - 1, 2, "a history turn and a turn just ended");
    assert.match(timeline, /const flagOf = \(turn, ask\) => \(ask && ask\.kind !== "refused" \? \(workOf\.has\(turn\) \? "waits for room" : askFlag\(ask\)\) : false\);/);
    const turn = readFileSync("src/ui/harness/conversation/turn.js", "utf8");
    assert.match(turn, /failed \? h\("span", \{ class: `a-flag \$\{asked \? "ask" : "err"\}`/);
    assert.match(readFileSync("src/ui/harness.css", "utf8"), /\.a-flag\.ask \{ color: var\(--color-sys-teal-text\); \}/);
  });

  test("the page draws it on every turn the server stopped to ask, hands it the session's ways, the compaction under way and its own work, and takes the way chosen with its side model", () => {
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.equal(timeline.split("const ask = askOf(").length - 1, 2, "a history turn and a turn just ended");
    assert.equal(timeline.split("? askShim(").length - 1, 2);
    assert.match(timeline, /askCard\(ask\.kind === "refused" \? failed : turn\.error, ask, \{\s+options: cb\.askOptions \? \(once\) => cb\.askOptions\?\.\(c, ask, once\) \?\? Promise\.resolve\(null\) : undefined,/);
    assert.match(timeline, /watch: watchCompacting,\s+pending: workOf\.get\(turn\) \|\| null,\s+onWorking: \(w\) => \{\s+workOf\.set\(turn, w\);/);
    // The Compacting row gives way to the card that shows the compaction.
    assert.match(timeline, /compactingSaid = progress \? \{ p: progress, o \} : null;\s+\/\/ [^\n]+\n\s+if \(cardWork\) \{\s+cardWork\(progress, o\);\s+progress = null;\s+\}/);
    assert.match(timeline, /view\.clear\(\);\s+turnTops = null;\s+cardWork = null;/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /async function compactAndSend\(chat, turn, choice, once, carry\) \{\n {2}if \(turnRunsIn\(chat\) \|\| !chat\.chainId\) return false;\n {2}const c = choiceCompaction\(choice, once\?\.model \?\? null\);[\s\S]{0,300}?made = await compactSession\(chat, c\.method, c\.way, c\.once, \{ sending: true \}\);[\s\S]{0,200}?if \(made !== true\) return made \|\| false;/);
    assert.match(app, /ways: askChoices\(\{ plan, agent: !!plan\.agent, agentName, now: Date\.now\(\), chosen: sessionKind\(chat\.view\), changed: ask\.kind === "changed" \|\| !!ask\.changes\?\.length \}\),/, "the kind the session chose is chosen first");
    // The message goes again past the cold question: the card was its answer.
    // The whole message: its pictures and files go again with the words (`againOf`), a message of pictures alone too.
    // Through `sendAsked`, whose answer is the card's: a send refused gives the card back with why. Room is made for it
    // no more once that answer is in, the message gone or not (`makingRoom`).
    assert.match(app, /if \(made !== true\) return made \|\| false;\s+(?:\/\/ [^\n]+\n\s+)*try \{\s+return await sendAsked\(chat, turn, \{ sendAsIs: true, carry \}\);\s+\} finally \{\s+if \(turn\.makingRoom && chat\.turns\.includes\(turn\)\) \{\s+turn\.makingRoom = 0;/);
    assert.match(app, /async function sendAsked\(chat, turn, o = \{\}\) \{[\s\S]*?const sending = sendAgain\(chat, turn, \{ \.\.\.o, went \}\);/);
    // What the compaction came to: the toast says room was made; one that could not go answers why, for the card.
    assert.match(app, /toast\(sending\s+\? `Room made\$\{compactionFacts\(r\.compaction\)\}\$\{chatOf\(state\.currentId\) === chat \? " — your message is on its way" : ""\}`/);
    assert.match(app, /if \(sending\) return stopped \? "Stopped: nothing was compacted, and your message waits here\." : `Room was not made: \$\{errText\(e\)\}\. Your message waits here\.`;/);
    assert.match(app, /\.\.\.\(plan\.agent \? \{ agentName \} : \{\}\),/);
    // Each card's way to stop being asked writes its own switch, and says where to switch it back.
    assert.match(app, /compaction: changed \? \{ changeQuestion: false \} : cold \? \{ resumeQuestion: false \} : \{ mode: "auto" \}/);
    assert.match(app, /Switch it back: How earlier turns are kept › After an update/);
    // A cold question that said what changed asks nothing more once switched off: the words go as they are.
    assert.match(app, /return sendAsked\(chat, turn, cold \|\| changed \? \{ sendAsIs: true, carry \} : \{\}\);/);
    assert.match(app, /Switch it back: How earlier turns are kept › Back after a break/);
    assert.match(app, /Switch it back: How earlier turns are kept › Then/);
  });

  // (fails before: yes — the owner's report 10-17: after Compact and send the message showed twice, the first under a
  // card that stayed with "not sent", though the compaction ran and the message went; then, U11, the chat was drawn
  // again around the message sent, and the card vanished in the redraw)
  test("an answer that sends the message again takes the stopped turn's place: one message, no card left behind, the chat not drawn again", () => {
    const done = { n: 1, status: "done", reply: { stopReason: "end_turn" } };
    const cold = { n: 2, status: "error", reply: { error: "asks", errorBody: { resumeQuestion: { why: "cold", held: 9 } } } };
    const size = { n: 2, status: "error", reply: { error: "asks", errorBody: { needsCompaction: true, sentTokens: 9 } } };
    const switched = { n: 2, status: "error", reply: { error: "asks", errorBody: { switchQuestion: { suggested: "words" } } } };
    assert.deepEqual(withoutAsked([done, cold], cold), [done]);
    assert.deepEqual(withoutAsked([done, size], size), [done]);
    assert.deepEqual(withoutAsked([done, switched], switched), [done]);
    // On record, it stays: a failure Retry sends again ("the earlier reply stays"), a seed its agent refused.
    const failed = { n: 2, status: "error", reply: { error: "the model is overloaded", errorBody: { error: "overloaded" } } };
    const seed = { n: 2, status: "error", reply: { error: "refused" }, facts: { needsRoom: true } };
    assert.equal(withoutAsked([done, failed], failed), null);
    assert.equal(withoutAsked([done, seed], seed), null);
    assert.equal(withoutAsked([done], cold), null, "a row already gone");
    assert.equal(withoutAsked([done, cold], null), null, "a send that sends no turn again");
    // The page: every way on hands sendMessage the turn it sends again; the row goes before the new turn is numbered,
    // and only the row: the chat is not drawn again.
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /sendMessage\(again\.text, again\.attachments, "normal", \{ \.\.\.o, \.\.\.overrules, replaces: turn, \.\.\.sendsIn\(chat\) \}\)/);
    const send = app.slice(app.indexOf("async function sendMessage("));
    assert.match(send, /const unasked = withoutAsked\(chat\.turns, replaces\);\s+if \(unasked\) \{\s+chat\.turns = unasked;\s+transcript\.dropTurn\(replaces\);\s+\}/);
    assert.ok(send.indexOf("const unasked = withoutAsked(") < send.indexOf("n: nextNumber(chat.turns),"));
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /dropTurn\(turn\) \{\s+const v = view\.get\(turn\);\s+if \(!v\) return;\s+v\.root\.remove\(\);\s+view\.delete\(turn\);\s+turnTops = null;\s+refreshNav\(\);\s+\},/);
    // Retry asks it too since the review of c2ee8d232 (a message waiting on its row); Continue on asks again once the
    // session's model is written (the review of bbe9eab53), in words that say the model is written (that of 134f74bd5).
    assert.equal((app.match(/if \(turnRunsIn\(chat\)/g) || []).length, 7, "Compact and send, Send as it is, the way to stop being asked, the card you brought up between turns, Switch and send, a switch's handoff, and Retry");
    assert.match(app, /if \(chatOf\(state\.currentId\) !== chat \|\| chat\.continuing \|\| turnRunsIn\(chat\)\) return false;[\s\S]{0,1200}?if \(chat\.live \|\| chat\.waiting\) \{/, "Continue on, before the model is written and after");
  });

  // The owner's report of 10-31 on 0.6.0: a coding agent's chat asked before a queued message; on the card, Claude Code
  // compacted its own session for a minute while the owner worked in another chat, and the message went into that chat
  // as a note, while its own chat drew its card again under the compaction's row.
  // (fails before: yes — every way on sent the message again in whichever chat was shown when it went)
  test("an answer sends the message again in the card's own chat, whichever chat is shown by the time it goes", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // (a thread's brief goes again as the brief it was, in the card's own chat too: the line before the message's)
    assert.match(app, /function sendAgain\(chat, turn, o = \{\}\) \{\s+const again = againOf\(turn\);\s+if \(again\.brief\) return sendMessage\("", \[\], "normal", \{ \.\.\.o, replaces: turn, \.\.\.sendsIn\(chat\), brief: \{ block: again\.brief, view: turn\.brief \} \}\);\s+const overrules = [^\n]+\n\s+return again\.text \|\| again\.attachments\.length \? sendMessage\(again\.text, again\.attachments, "normal", \{ \.\.\.o, \.\.\.overrules, replaces: turn, \.\.\.sendsIn\(chat\) \}\) : Promise\.resolve\(false\);/);
    // Not shown, it goes as the queue of a chat not shown sends: that chat's model, folder and turns.
    assert.match(app, /const sendsIn = \(chat\) => \(chatOf\(state\.currentId\) === chat \? \{\} : \{ chat \}\);/);
    assert.match(app, /let chat = away \|\| chatOf\(state\.currentId\);/);
    assert.match(app, /const ready = away \? readyAway\(chat\) : await readySession\(chat, \{ opens: fresh \}\);/);
    const calls = app.match(/\bsendAgain\([^)]*\)/g) || [];
    assert.equal(calls.length, 3, "its own, and Continue on, and sendAsked's — Retry's, Compact and send's, Switch and send's, Send as it is's, Don't ask again's");
    assert.deepEqual(calls.filter((c) => !/^sendAgain\(chat, turn\b/.test(c)), [], "each names the turn's chat");
    // The card you brought up holds its message apart from any turn: after its compaction, it goes in its chat too.
    const summoned = app.slice(app.indexOf("  onSummonedCompact: async (chat, choice, once) => {"), app.indexOf("  onSummonedSend: (chat) => {"));
    assert.match(summoned, /const made = await compactSession\(chat, [^\n]+\n\s+if \(made !== true\) \{\s+roomNotMade\(chat\);\s+return made \|\| false;\s+\}[\s\S]*?if \(s\.ask\.sends\) \{\s+chat\.roomWait = false;\s+void sendSummoned\(chat, s, sendsIn\(chat\)\);/);
    assert.match(app, /async function sendSummoned\(chat, s, o = \{\}\) \{\s+const it = \{ text: s\.message, files: s\.files, sendAsIs: true \};\s+if \(chat\.live\) return queueNext\(chat, \[it\], "[^"]+"\);\s+if \(\(await sendMessage\(s\.message, s\.files, "normal", \{ sendAsIs: true, \.\.\.o, boxed: !o\.chat \}\)\) !== false\) return;/);
  });
});

// HarnessV4_Tasks A7: a switch of account or model asks before its first message, every time — what happens now, and the
// form the session will hold the turns in, each weighed in the new window. Before this step a switch asked nothing, and
// another account of the same agent was handed the turns as Words.
describe("the card a switch asks with", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  const SWITCH = Object.freeze({
    from: { upstream: "cc", name: "Claude Code", model: "opus-xhigh" },
    to: { upstream: "cc-play", name: "Claude Code · Northwind", model: "opus-xhigh" },
    account: true, sameModel: true, resumes: false, compacted: true, suggested: "plain", session: "words", window: 1_000_000, usable: 850_000, own: 41_000,
  });
  const SWEEP = { forms: { plain: { tokens: 120_000 }, "fold+2": { tokens: 40_000 }, fold: { tokens: 20_000 }, words: { tokens: 15_000 } } };
  const WORDS = "You switched accounts: Claude Code · Northwind takes over from Claude Code, on the same model (opus-xhigh). It starts a new session of this chat now, …";
  /** Each row: its name, what it says, and whether it is the one marked. @param {import("../src/ui/harness/conversation/interaction.js").AskOptions} o */
  const rowsOf = (o) => o.ways.map((w) => [w.id, w.label, w.sub, w.recommended]);

  // (fails before: yes — no switch asked)
  test("the question comes from the refusal's switchQuestion, and its facts are the new side's window, its line and what the agent's own part takes", () => {
    assert.deepEqual(askOf({ switchQuestion: SWITCH }, null), { kind: "switched", switch: SWITCH, usable: 850_000, window: 1_000_000 });
    assert.equal(stoppedToAsk({ errorBody: { switchQuestion: SWITCH } }), true, "nothing went: the words wait in the composer");
    assert.deepEqual(askFacts(/** @type {any} */ (askOf({ switchQuestion: SWITCH }, null))), ["Claude Code · Northwind's window: 1,000,000 tokens · the line is at 850,000", "Its own prompt and tools take ≈41,000"]);
    assert.deepEqual(askFacts(/** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, resumes: true } }, null))), ["Claude Code · Northwind's window: 1,000,000 tokens · the line is at 850,000"], "a session that goes on holds its own part already");
    assert.equal(askOf({ needsCompaction: true, sentTokens: 1, carry: "fold" }, null)?.carry, "fold", "a size question after a switch's answer sends its form back");
  });

  // (fails before: yes — the owner's words: "the default option on the card would be option number 1 … carry those turns Whole")
  test("the forms, fullest first, each weighed in the new window with the agent's own part; on an account switch Whole first where it fits, else the fullest that fits", () => {
    assert.deepEqual(rowsOf(switchChoices(SWEEP, SWITCH)), [
      ["plain", "Whole", "≈161,000 tokens · every finished turn as it was sent, tool output as text", true],
      ["fold+2", "Folded, newest 2 whole", "≈81,000 tokens · folded, the last two turns whole", false],
      ["fold", "Folded", "≈61,000 tokens · every turn folded to your words, one line per tool call, and the reply", false],
      ["words", "Words", "≈56,000 tokens · your words and the agent's, each turn's tool calls counted in one line", false],
    ]);
    const tight = switchChoices(SWEEP, { ...SWITCH, usable: 100_000 });
    assert.deepEqual(tight.ways.map((w) => [w.id, w.recommended]), [["plain", false], ["fold+2", true], ["fold", false], ["words", false]]);
    assert.match(tight.ways[0].sub, /^≈161,000 tokens, past the line at 100,000: room is made first · /);
    assert.equal(tight.ways[0].disabled, false, "a form past the line can still be chosen: room is made first");
    assert.equal(switchChoices(SWEEP, { ...SWITCH, usable: 10_000 }).ways.find((w) => w.recommended)?.id, "plain", "none fits: Whole, and room is made first");
    assert.equal(switchChoices(SWEEP, { ...SWITCH, sameModel: false, suggested: "words" }).ways.find((w) => w.recommended)?.id, "plain", "an account switch onto another model: Whole where it fits too");
  });

  test("a model switch alone marks the session's own form; a session that goes on, or a sweep that did not come, lists the forms without figures", () => {
    const model = switchChoices(SWEEP, { ...SWITCH, account: false, sameModel: false, suggested: "fold" });
    assert.equal(model.ways.find((w) => w.recommended)?.id, "fold");
    const resumes = switchChoices(SWEEP, { ...SWITCH, resumes: true });
    assert.deepEqual(resumes.ways.map((w) => w.sub.startsWith("≈")), [false, false, false, false], "the figures weigh the whole copy, not the turns it missed");
    assert.equal(resumes.ways.find((w) => w.recommended)?.id, "plain");
    assert.deepEqual(rowsOf(switchChoices(null, SWITCH)).map((r) => [r[0], r[3]]), [["plain", true], ["fold+2", false], ["fold", false], ["words", false]]);
  });

  // (fails before: yes — no card asked; the owner: "the card should still show always")
  test("the card: the server's words, the facts, the forms with the first marked; Switch and send takes the form chosen; there is no way to stop being asked", async () => {
    /** @type {any[]} */
    const did = [];
    const ask = /** @type {any} */ (askOf({ switchQuestion: SWITCH }, null));
    const el = /** @type {any} */ (switchCard(WORDS, ask, { options: async () => switchChoices(SWEEP, SWITCH), onSwitch: (form) => did.push(form), onDismiss: () => did.push("dismiss") }));
    await tick();
    assert.ok(el.classList.contains("ix-ask") && el.classList.contains("ix-switch"), "a question, not a failure");
    assert.equal(el.querySelector(".ix-error-msg").textContent, WORDS);
    assert.deepEqual(el.querySelectorAll(".ix-ask-fact").map((/** @type {any} */ f) => f.textContent), askFacts(ask));
    assert.equal(el.querySelector(".ix-ask-lead").textContent, "The new session carries the turns as");
    const rows = () => el.querySelectorAll(".ix-choice");
    assert.deepEqual(rows().map((/** @type {any} */ r) => [r.querySelector("b").textContent, r.getAttribute("aria-checked")]), [["Whole", "true"], ["Folded, newest 2 whole", "false"], ["Folded", "false"], ["Words", "false"]]);
    assert.deepEqual(answers(el).map((/** @type {any} */ b) => [b.textContent, b.classList.contains("primary")]), [["Switch and send", true], ["Dismiss", false]]);
    rows()[3].dispatch("click");
    assert.deepEqual(rows().map((/** @type {any} */ r) => r.getAttribute("aria-checked")), ["false", "false", "false", "true"]);
    answers(el)[0].dispatch("click");
    assert.deepEqual(did, ["words"]);
    answers(el)[0].dispatch("click");
    rows()[0].dispatch("click");
    assert.deepEqual(did, ["words"], "a spent card answers nothing more");
    assert.equal(rows()[3].getAttribute("aria-checked"), "true");
  });

  // (fails before: yes — the hunt of 11-09: Switch and send pressed before the forms were weighed sent the server's
  // Whole, which it suggests on an account switch without weighing it, past the new window's line; and, held, the
  // button said nothing on its face of why — the owner's of 11-09: "a disabled button with no visible reason reads as
  // broken")
  test("Switch and send is held until the forms are weighed, saying so on its face, then takes the one weighed first; where the weighing fails, the server's suggestion", async () => {
    /** @type {any[]} */
    const did = [];
    /** @type {(v: any) => void} */
    let weigh = () => {};
    const tight = { ...SWITCH, usable: 100_000 };
    const el = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: tight }, null)), { options: () => new Promise((r) => (weigh = r)), onSwitch: (form) => did.push(form) }));
    await tick();
    assert.deepEqual([!!answers(el)[0].disabled, answers(el)[0].textContent], [true, "Weighing…"], "held while the forms are weighed, and says so");
    answers(el)[0].dispatch("click");
    assert.deepEqual(did, [], "nothing goes before the weighing");
    weigh(switchChoices(SWEEP, tight));
    await tick();
    assert.deepEqual([!!answers(el)[0].disabled, answers(el)[0].textContent], [false, "Switch and send"], "weighed: it can go");
    answers(el)[0].dispatch("click");
    assert.deepEqual(did, ["fold+2"], "Whole does not fit the new window: the fullest form that does");

    /** @type {(e: any) => void} */
    let fail = () => {};
    const failed = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: tight }, null)), { options: () => new Promise((_, no) => (fail = no)), onSwitch: (form) => did.push(form) }));
    await tick();
    assert.deepEqual([!!answers(failed)[0].disabled, answers(failed)[0].textContent], [true, "Weighing…"]);
    fail(new Error("the preview failed"));
    await tick();
    assert.equal(answers(failed)[0].textContent, "Switch and send");
    answers(failed)[0].dispatch("click");
    assert.deepEqual(did, ["fold+2", "plain"], "the weighing failed: the server's suggestion stands");
  });

  test("where its forms never come, Switch and send takes the form the server suggests; a session that goes on is handed the turns it missed", async () => {
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, account: false, suggested: "words" } }, null)), { options: async () => null, onSwitch: (form) => did.push(form) }));
    await tick();
    assert.equal(el.querySelectorAll(".ix-choice").length, 0);
    answers(el)[0].dispatch("click");
    assert.deepEqual(did, ["words"]);
    const back = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, resumes: true } }, null)), { options: async () => switchChoices(SWEEP, { ...SWITCH, resumes: true }), onSwitch: () => {} }));
    await tick();
    assert.equal(back.querySelector(".ix-ask-lead").textContent, "The turns it missed go as");
    const bare = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: SWITCH }, null))));
    assert.equal(answers(bare)[0].disabled, true, "a card the page has no answer for sends nothing");
  });

  // (fails before: yes — the review of a2e843221: Switch and send pressed while the chat's turn ran was refused, and the
  // card stayed spent, its button disabled for good)
  test("a Switch and send the page could not send gives the card back; one that went spends it", async () => {
    /** @type {string[]} */
    const did = [];
    let can = false;
    const el = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, suggested: "words" } }, null)), { options: async () => null, onSwitch: (form) => (did.push(form), can) }));
    await tick();
    answers(el)[0].dispatch("click");
    assert.equal(!!answers(el)[0].disabled, false, "refused: the card stands");
    can = true;
    answers(el)[0].dispatch("click");
    answers(el)[0].dispatch("click");
    assert.deepEqual([did, !!answers(el)[0].disabled], [["words", "words"], true]);
  });

  // (fails before: yes — the review of f50fcf6f9: the card gave itself back on an answer of false alone; one whose send
  // was refused after the answer was asked for, a promise of why, kept Switch and send disabled for good: "given back",
  // true where false was expected)
  test("a Switch and send whose send is refused once it was asked for — its answer resolving false, or to why — gives the card back, saying why; one that went spends it", async () => {
    /** @type {any} */
    let answer = Promise.resolve("Another tab writes this session");
    const el = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, suggested: "words" } }, null)), { options: async () => null, onSwitch: () => answer }));
    await tick();
    const note = () => el.querySelector(".ix-ask-note");
    answers(el)[0].dispatch("click");
    assert.equal(!!answers(el)[0].disabled, true, "held while the answer comes");
    await tick();
    assert.equal(!!answers(el)[0].disabled, false, "given back");
    assert.deepEqual([note().textContent, note().classList.contains("hidden")], ["Another tab writes this session", false], "saying why");
    answer = Promise.resolve(false);
    answers(el)[0].dispatch("click");
    await tick();
    assert.deepEqual([!!answers(el)[0].disabled, note().classList.contains("hidden")], [false, true], "given back; no words of why, none said");
    answer = Promise.resolve(true);
    answers(el)[0].dispatch("click");
    await tick();
    assert.equal(!!answers(el)[0].disabled, true, "it went: spent");
  });

  // (fails before: yes — the hunt of 11-08: Dismiss stood while the answer was under way — a handoff's summary being
  // written —, gave the message back to the box, and the handoff sent it once its summary landed)
  test("while Switch and send's answer is under way, Dismiss answers nothing; given back, it closes the card again", async () => {
    /** @type {string[]} */
    const did = [];
    /** @type {(v: unknown) => void} */
    let settle = () => {};
    const el = /** @type {any} */ (switchCard("q", /** @type {any} */ (askOf({ switchQuestion: { ...SWITCH, suggested: "words" } }, null)), { options: async () => null, onSwitch: (form) => (did.push(form), new Promise((r) => (settle = r))), onDismiss: () => did.push("dismiss") }));
    await tick();
    const [go, dismiss] = answers(el);
    go.dispatch("click");
    assert.equal(!!dismiss.disabled, true, "held with Switch and send");
    dismiss.dispatch("click");
    assert.deepEqual(did, ["words"], "the message under way stays where it went");
    settle("Room was not made: the summary failed. Your message waits here.");
    await tick();
    assert.deepEqual([!!go.disabled, !!dismiss.disabled], [false, false], "given back");
    dismiss.dispatch("click");
    assert.deepEqual(did, ["words", "dismiss"]);
  });

  // (fails before: yes — the owner's of 11-08: no switch's card offered a summary by the model that answered last, and a
  // switch into Filament's loop drew no card at all)
  test("the handoff: a switch into the loop lists Send as it is and a summary by the model that answered last; an agent's card lists it after the forms, first where none fits", async () => {
    const WARM = { state: "warm", idleMs: 20_000, ttlMs: 300_000, leftMs: 280_000 };
    const LOOP = Object.freeze({
      from: { upstream: "cc", name: "Claude Code", model: "opus" }, to: { upstream: "agent-loop", name: "sonnet", model: "sonnet" },
      account: false, sameModel: false, resumes: false, loop: true, fromAgent: true, compacted: false, suggested: "send", session: "words",
      window: 200_000, usable: 170_000, own: null, held: 42_000, handoff: { way: "self", by: "Claude Code", cache: WARM },
    });
    const loop = switchChoices(null, LOOP);
    assert.deepEqual(rowsOf(loop), [
      ["send", "Send as it is", "≈42,000 tokens · every turn as it stands", true],
      ["handoff", "Summary by Claude Code first", "from its warm cache, 5 min left · sonnet starts from the summary", false],
    ]);
    assert.match(loop.ways[1].title, /^Claude Code writes Filament's summary in its own session; then the message goes$/);
    const over = switchChoices(null, { ...LOOP, held: 190_000, suggested: "handoff", handoff: { way: "summary", by: "opus", cache: { ...WARM, state: "cold" } } });
    assert.deepEqual(rowsOf(over), [
      ["send", "Send as it is", "≈190,000 tokens, past the line at 170,000: room is made first · every turn as it stands", false],
      ["handoff", "Summary by opus first", "its cache is cold: it reads the chat again · sonnet starts from the summary", true],
    ], "past the line, the server suggests the handoff");
    assert.deepEqual(switchChoices(null, { ...LOOP, handoff: null }).ways.map((w) => w.id), ["send"], "none to write: Send as it is alone");

    const agent = { ...SWITCH, account: false, sameModel: false, suggested: "words", handoff: { way: "summary", by: "m-1", cache: WARM } };
    assert.deepEqual(switchChoices(SWEEP, agent).ways.map((w) => [w.id, w.recommended]), [["plain", false], ["fold+2", false], ["fold", false], ["words", true], ["handoff", false]]);
    assert.equal(switchChoices(SWEEP, { ...agent, usable: 10_000 }).ways.find((w) => w.recommended)?.id, "handoff", "no form fits: the summary first");

    /** @type {any[]} */
    const did = [];
    const ask = /** @type {any} */ (askOf({ switchQuestion: LOOP }, null));
    const el = /** @type {any} */ (switchCard("You switched to sonnet from Claude Code. …", ask, { options: async () => switchChoices(null, LOOP), onSwitch: (form) => did.push(form) }));
    await tick();
    assert.equal(el.querySelector(".ix-ask-lead").textContent, "How sonnet starts");
    assert.deepEqual(el.querySelectorAll(".ix-choice").map((/** @type {any} */ r) => [r.querySelector("b").textContent, r.getAttribute("aria-checked")]), [["Send as it is", "true"], ["Summary by Claude Code first", "false"]]);
    el.querySelectorAll(".ix-choice")[1].dispatch("click");
    answers(el)[0].dispatch("click");
    assert.deepEqual(did, ["handoff"]);
    const plain = /** @type {any} */ (switchCard("q", ask, { options: async () => null, onSwitch: (form) => did.push(form) }));
    await tick();
    answers(plain)[0].dispatch("click");
    assert.deepEqual(did, ["handoff", "send"], "before its ways come, the server's suggestion: Send as it is");
  });

  // (fails before: yes — the review of a2e843221: a failed turn's Retry the page could not send, its chat's turn still
  // running, spent the banner: Retry disabled for good)
  test("a failure's Retry the page could not send leaves the banner's Retry; one that went spends it", () => {
    /** @type {string[]} */
    const did = [];
    let can = false;
    const el = /** @type {any} */ (errorBanner("the provider refused the request", { onRetry: () => (did.push("retry"), can) }));
    const retry = el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Retry");
    retry.dispatch("click");
    assert.equal(!!retry.disabled, false, "refused: Retry stands");
    can = true;
    retry.dispatch("click");
    retry.dispatch("click");
    assert.deepEqual([did, !!retry.disabled], [["retry", "retry"], true]);
  });

  // (fails before: yes — the review of a164c1573: the banner took any answer but false as a resend that went — one
  // whose send was refused once asked for kept Retry disabled for good: "refused: Retry stands", true)
  test("a failure's Retry whose send is refused once asked for — its answer resolving false, or to why — leaves the banner's Retry; one that went spends it", async () => {
    /** @type {any} */
    let answer = Promise.resolve(false);
    const el = /** @type {any} */ (errorBanner("the provider refused the request", { onRetry: () => answer }));
    const retry = el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Retry");
    retry.dispatch("click");
    assert.equal(!!retry.disabled, true, "held while the send answers");
    await tick();
    assert.equal(!!retry.disabled, false, "refused: Retry stands");
    answer = Promise.resolve("Another tab writes this session");
    retry.dispatch("click");
    await tick();
    assert.equal(!!retry.disabled, false, "refused with why: Retry stands");
    answer = Promise.resolve(true);
    retry.dispatch("click");
    await tick();
    assert.equal(!!retry.disabled, true, "it went: spent");
  });

  test("the page draws it on a switch's stopped turn, weighs its forms by the session's one preview, and sends the words again with the form chosen", () => {
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const askShim = \(c, turn, ask, failed, dismiss\) => \{\s+const notNow = [^\n]+\n\s+return ask\.kind === "switched" \? switchCard\(turn\.error, ask, \{\s+options: cb\.switchOptions \? \(\) => cb\.switchOptions\?\.\(c, ask\) \?\? Promise\.resolve\(null\) : undefined,\s+onSwitch: cb\.onSwitch \? \(form\) => cb\.onSwitch\?\.\(c, turn, form, ask\) : undefined,/);
    assert.match(timeline, /onCompact: cb\.onCompact \? \(choice, once, carry\) => cb\.onCompact\?\.\(c, turn, choice, once, ask\.kind === "lost" \? carry \?\? null : ask\.carry \?\? null\) : undefined,/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /onSwitch: \(chat, turn, form, ask\) => \{\s+if \(turnRunsIn\(chat\)\) return false;\s+if \(form === "handoff" && ask\?\.switch\?\.handoff\) return handoffAndSend\(chat, turn, ask\.switch\.handoff\);\s+if \(form === "send"\) return sendAsked\(chat, turn, \{ sendAsIs: true \}\);\s+return sendAsked\(chat, turn, \{ carry: form \}\);/);
    assert.match(app, /switchOptions: async \(chat, ask\) => \{\s+const s = ask\.switch;\s+if \(sessionChat\(\) !== chat \|\| !chat\.chainId \|\| ask\.kind !== "switched" \|\| !s\) return null;\s+if \(s\.loop\) return switchChoices\(null, s\);\s+return composePreview\(\)\.then\(\(pv\) => switchChoices\(pv, s\)/, "its forms, apart from the card's ways");
    // The handoff: the compaction as the model that answered last, then the message past the card.
    assert.match(app, /async function handoffAndSend\(chat, turn, handoff\) \{[^]*?made = await compactNow\(chat, \{ \.\.\.\(handoff\.way === "summary" \? \{ method: "summary", once: \{ writer: "session" \} \} : \{ way: handoff\.way \}\), by: "last", sending: true \}\);[^]*?return await sendAsked\(chat, turn, \{ sendAsIs: true \}\);/);
    assert.match(app, /\.\.\.\(onceTurnEnds \? \{ onceTurnEnds: true \} : \{\}\), \.\.\.\(by \? \{ by \} : \{\}\), \.\.\.\(sending \? \{ sending: true \} : \{\}\) \} \}\);/, "the compaction asks the server as the model that answered last, its message to follow");
    assert.match(app, /overrules = \[\], carry = null, replaces = null, chat: away = null, goes = null, went = null, boxed = false, ours = false, fresh = false, via = null, brief = null \} = \{\}\) \{/);
    assert.match(app, /overrules: overrulesSent\(overrules\),\s+carry,/);
    const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(api, /\.\.\.\(carry \? \{ carry \} : \{\}\)/);
  });

  // (fails before: yes — the hunt of 11-09: the handoff's summary was written and its send refused; the card came back,
  // and its second press asked for the summary again, which the server refused as nothing to compact — for good)
  test("a handoff pressed again after its summary was written and its send refused: the summary that stands is taken, and the message goes", async () => {
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const sends = [];
    const written = { compaction: {}, boundary: { id: 9, afterTurn: 4 } };
    const covered = Object.assign(new Error("nothing to compact: every completed turn is already under the summary of turns 1–4"), { status: 409, body: { error: "nothing to compact: every completed turn is already under the summary of turns 1–4", covered: true } });
    const { handoffAndSend } = lift(["handoffAndSend", "compactNow", "compactAsk?", "roomMade?", "roomNotMade?", "compactingBetween?"], {
      state: { currentId: "c1" },
      chatOf: () => null,
      turnRunsIn: () => false,
      viewOnlyPage: () => false,
      errText: (/** @type {any} */ e) => String(e?.message || e),
      api: async (/** @type {string} */ path, /** @type {any} */ init) => {
        asked.push(init.body);
        if (asked.length > 1) throw covered;
        return written;
      },
      sendAsked: async (/** @type {any} */ _c, /** @type {any} */ _t, /** @type {any} */ o) => (sends.push(o), sends.length > 1 ? true : "Another tab writes this session"),
    });
    const chat = { id: "c1", chainId: "s-c1", turns: [] };
    const turn = {};
    const handoff = { way: "summary", by: "m-1", cache: null };
    assert.equal(await handoffAndSend(chat, turn, handoff), "Another tab writes this session", "written, its send refused: the card comes back");
    assert.equal(await handoffAndSend(chat, turn, handoff), true, "pressed again: the message goes on from the summary that stands");
    assert.deepEqual(sends, [{ sendAsIs: true }, { sendAsIs: true }]);
    assert.deepEqual(asked.map((b) => b.by), ["last", "last"]);
  });

  // (fails before: yes — the hunt of 11-09, the handoff's twin: Compact and send made its room and its send was refused;
  // the card came back, and its second press asked for the compaction again, which the server refused as nothing to
  // compact — for good)
  test("a Compact and send pressed again after its room was made and its send refused: the room made is taken, and the message goes", async () => {
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const sends = [];
    const written = { compaction: {}, boundary: { id: 9, afterTurn: 4 } };
    const covered = Object.assign(new Error("nothing to compact: every completed turn is already under the summary of turns 1–4"), { status: 409, body: { error: "nothing to compact: every completed turn is already under the summary of turns 1–4", covered: true } });
    const { compactAndSend } = lift(["compactAndSend", "compactSession", "compactNow", "compactAsk?", "roomMade?", "roomNotMade?", "compactingBetween?"], {
      state: { currentId: "c1" },
      chatOf: () => null,
      turnRunsIn: () => false,
      viewOnlyPage: () => false,
      choiceCompaction,
      errText: (/** @type {any} */ e) => String(e?.message || e),
      api: async (/** @type {string} */ path, /** @type {any} */ init) => {
        asked.push(init.body);
        if (asked.length > 1) throw covered;
        return written;
      },
      sendAsked: async (/** @type {any} */ _c, /** @type {any} */ _t, /** @type {any} */ o) => (sends.push(o), sends.length > 1 ? true : "Another tab writes this session"),
    });
    const chat = { id: "c1", chainId: "s-c1", turns: [] };
    const turn = {};
    assert.equal(await compactAndSend(chat, turn, "same", null, null), "Another tab writes this session", "room made, its send refused: the card comes back");
    assert.equal(await compactAndSend(chat, turn, "same", null, null), true, "pressed again: the message goes, the room made for it standing");
    assert.deepEqual(sends, [{ sendAsIs: true, carry: null }, { sendAsIs: true, carry: null }]);
    // Each asks the server to hold the chat's wakes for the message (the owner's of 11-09).
    assert.deepEqual(asked, [{ method: "summary", once: { writer: "session" }, sending: true }, { method: "summary", once: { writer: "session" }, sending: true }]);
  });
});

// The owner's of 11-06: a chat moved from a worktree to main asked before its message, and its card weighed the copy at
// ≈4.5K and called it "all of Filament's copy" — a Words copy, which had left every tool's output out, five research
// agents' reports among them. The card now says the form the new session carries, lists each form with what it weighs,
// and sends the one picked.
describe("the card a lost session asks with", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  const READS = Object.freeze({ kind: "agent", name: "Claude Code", from: "copy" });
  /** The server's question for a chat moved to fix-login: Whole, its default. */
  const MOVED = Object.freeze({ kind: "lost", moved: "fix-login", carry: "plain", reads: READS, cache: null, tokens: 161_000, estimated: true, usable: 170_000, window: 200_000 });
  const SWEEP = { forms: { plain: { tokens: 120_000, fixed: 41_000, whole: 161_000 }, "fold+2": { tokens: 40_000, fixed: 41_000, whole: 81_000 }, fold: { tokens: 20_000, fixed: 41_000, whole: 61_000 }, words: { tokens: 4_500, fixed: 41_000, whole: 45_500 } } };

  // (fails before: yes — the question named no form, and Send as it is said "all of Filament's copy" of any)
  test("the question names the form the copy goes in, from the server's refusal to the card's sentence and its Send row", () => {
    assert.equal(askOf({ resumeQuestion: { why: "lost", moved: "fix-login", carry: "plain", held: 161_000, reads: READS } }, null)?.carry, "plain");
    assert.equal(askOf({ resumeQuestion: { why: "cold", carry: "plain", held: 9 } }, null)?.carry, undefined, "a cold cache's session goes on: no form to carry");
    assert.equal(askReason(MOVED), "This chat moved to fix-login, so Claude Code starts a new session there from Filament's copy as Whole (≈161K), with nothing cached");
    assert.equal(askReason({ ...MOVED, moved: undefined, carry: "words", tokens: 45_500 }), "Claude Code no longer has a session of this chat, so it starts a new one from Filament's copy as Words (≈45.5K), with nothing cached");
    assert.equal(asIsLine(MOVED, "Claude Code"), "Claude Code starts its new session from Filament's copy as Whole: every finished turn as it was sent, tool output as text.");
    assert.equal(asIsLine({ kind: "lost", carry: "words" }, ""), "The agent starts its new session from Filament's copy as Words: your words and the agent's, each turn's tool calls counted in one line.");
  });

  test("the forms, fullest first, each with what the request weighs in it; past the line, room is made first; the server's own is the default", () => {
    const r = carryChoices(SWEEP, MOVED);
    assert.deepEqual(r.ways.map((w) => [w.id, w.label, w.sub, w.recommended, w.tokens, w.fits]), [
      ["plain", "Whole", "≈161K", true, 161_000, true],
      ["fold+2", "Folded, newest 2 whole", "≈81K", false, 81_000, true],
      ["fold", "Folded", "≈61K", false, 61_000, true],
      ["words", "Words", "≈45.5K", false, 45_500, true],
    ]);
    assert.match(r.ways[0].title, /^Every finished turn as it was sent, tool output as text$/);
    const tight = carryChoices(SWEEP, { ...MOVED, usable: 100_000 });
    assert.deepEqual([tight.ways[0].sub, tight.ways[0].fits, tight.ways[0].disabled], ["≈161K, past your line", false, false], "it can still be chosen: room is made first");
    assert.match(tight.ways[0].title, / · past the line at 100,000: room is made before your message goes$/);
    assert.equal(carryChoices(SWEEP, { ...MOVED, carry: "words" }).ways.find((w) => w.recommended)?.id, "words", "a form a layer chose stands as the default");
    assert.equal(carryChoices(SWEEP, { ...MOVED, carry: undefined }).ways.find((w) => w.recommended)?.id, "plain");
    assert.deepEqual(carryChoices({ forms: { plain: { tokens: 120_000, fixed: 41_000 } } }, MOVED).ways.map((w) => w.tokens), [161_000, null, null, null], "the history and what rides beside it; a form not weighed has no figure");
    // (fails before: yes — the drive of 11-06: the question weighed the copy with the message sent, ≈249, the preview with
    // none, ≈222, and the card's Whole said ≈222 under a sentence of ≈249)
    assert.deepEqual(carryChoices(SWEEP, { ...MOVED, tokens: 161_400 }).ways.map((w) => w.tokens), [161_400, 81_400, 61_400, 45_900], "the message's own weight, on every form");
    assert.deepEqual(carryChoices(SWEEP, { ...MOVED, tokens: 150_000 }).ways.map((w) => w.tokens), [161_000, 81_000, 61_000, 45_500], "never less than the preview weighed");
  });

  // (fails before: yes — the card listed no forms, and Send as it is sent none)
  test("the card lists the forms under its sentence; a pick weighs the sentence, the Send row and the facts again, and goes with Send or Compact and send", async () => {
    /** @type {any[]} */
    const did = [];
    const make = () => /** @type {any} */ (askCard("q", MOVED, {
      options: async () => ({ ways: WAYS.slice(2), agentName: "Claude Code" }),
      carryOptions: async () => carryChoices(SWEEP, MOVED),
      onCompact: (choice, once, carry) => (did.push(["compact", choice, carry]), new Promise(() => {})),
      onSendAsIs: (carry) => (did.push(["send", carry]), true),
      onDismiss: () => {},
    }));
    const el = make();
    await tick();
    const forms = () => el.querySelectorAll(".ix-ask-carry .ix-choice");
    assert.equal(el.querySelector(".ix-ask-carry").classList.contains("hidden"), false);
    assert.equal(el.querySelector(".ix-ask-carry .ix-ask-lead").textContent, "The new session carries the turns as");
    assert.deepEqual(forms().map((/** @type {any} */ f) => [f.querySelector("b").textContent, f.getAttribute("aria-checked"), String(f.querySelector(".ix-choice-tag")?.textContent || "")]),
      [["Whole", "true", "Default"], ["Folded, newest 2 whole", "false", ""], ["Folded", "false", ""], ["Words", "false", ""]]);
    assert.equal(waysOf(el).length, 3, "the forms are no ways: Send it as it is and the two ways");
    // Send it as it is is chosen first on a lost session; the server's own form sends none.
    el.querySelector(".ix-way-send").dispatch("click");
    assert.match(said(el), /^This chat moved to fix-login, so Claude Code starts a new session there from Filament's copy as Whole \(≈161K\), with nothing cached\./);
    forms()[3].dispatch("click");
    assert.deepEqual(forms().map((/** @type {any} */ f) => f.getAttribute("aria-checked")), ["false", "false", "false", "true"]);
    assert.match(said(el), /from Filament's copy as Words \(≈45\.5K\), with nothing cached\./);
    assert.match(el.querySelector(".ix-way-send .ix-way-line").textContent, /^Claude Code starts its new session from Filament's copy as Words: /);
    assert.equal(el.querySelector(".ix-way-send .ix-way-fig").textContent, "≈45.5K");
    assert.ok(el.querySelectorAll(".ix-ask-fact").some((/** @type {any} */ f) => f.textContent === "≈45,500 of 200,000 tokens · the line is at 170,000"), "the facts weigh it too");
    el.querySelector(".ix-ask-act").dispatch("click");
    await tick();
    assert.deepEqual(did, [["send", "words"]]);
    // Picked back to the server's own, it sends none; Compact and send takes the pick as Send does.
    const again = make();
    await tick();
    again.querySelectorAll(".ix-ask-carry .ix-choice")[2].dispatch("click");
    again.querySelectorAll(".ix-ask-carry .ix-choice")[0].dispatch("click");
    again.querySelector(".ix-way-send").dispatch("click");
    again.querySelector(".ix-ask-act").dispatch("click");
    const third = make();
    await tick();
    third.querySelectorAll(".ix-ask-carry .ix-choice")[2].dispatch("click");
    third.querySelectorAll(".ix-way").find((/** @type {any} */ w) => nameOf(w) === "Instant fold").dispatch("click");
    third.querySelector(".ix-ask-act").dispatch("click");
    // (fails before: yes — the review of 8bcb358fc) The server's own goes with Compact and send too: once room is made,
    // the session starts from Filament's compaction, where the move's Whole no longer holds by itself.
    const fourth = make();
    await tick();
    fourth.querySelectorAll(".ix-way").find((/** @type {any} */ w) => nameOf(w) === "Instant fold").dispatch("click");
    fourth.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did.slice(1), [["send", undefined], ["compact", "fold", "fold"], ["compact", "fold", "plain"]]);
  });

  // (fails before: yes — the hunt of carry-card: a form picked past the line left Send chosen, which the server then met
  // with the size card; Just send from now on sent no form, so the move's Whole went whatever was picked)
  test("a form picked past the line makes Compact the act; Just send from now on sends the form picked", async () => {
    const TIGHT = { ...MOVED, carry: "words", tokens: 45_500, usable: 100_000 };
    /** @type {any[]} */
    const did = [];
    const make = () => /** @type {any} */ (askCard("q", TIGHT, {
      options: async () => ({ ways: WAYS.slice(2), agentName: "Claude Code" }),
      carryOptions: async () => carryChoices(SWEEP, TIGHT),
      onCompact: (choice, once, carry) => (did.push(["compact", choice, carry]), new Promise(() => {})),
      onSendAsIs: (carry) => (did.push(["send", carry]), true),
      onNeverAsk: (carry) => (did.push(["never", carry]), true),
      onDismiss: () => {},
    }));
    const el = make();
    await tick();
    const forms = () => el.querySelectorAll(".ix-ask-carry .ix-choice");
    el.querySelector(".ix-way-send").dispatch("click");
    assert.equal(el.querySelector(".ix-ask-act").textContent, "Send");
    forms()[1].dispatch("click");
    assert.equal(el.querySelector(".ix-ask-act").textContent, "Send", "Folded, newest 2 whole fits: Send stays");
    forms()[0].dispatch("click");
    assert.equal(el.querySelector(".ix-ask-act").textContent, "Compact and send", "Whole is past the line: room is made first");
    assert.equal(el.querySelector(".ix-way-send").getAttribute("aria-checked"), "false");
    el.querySelector(".ix-ask-act").dispatch("click");
    const never = make();
    await tick();
    never.querySelectorAll(".ix-ask-carry .ix-choice")[2].dispatch("click");
    answers(never).find((/** @type {any} */ b) => b.textContent === "Just send from now on").dispatch("click");
    const own = make();
    await tick();
    answers(own).find((/** @type {any} */ b) => b.textContent === "Just send from now on").dispatch("click");
    assert.deepEqual(did, [["compact", "side", "plain"], ["never", "fold"], ["never", undefined]]);
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /onNeverAsk: cb\.onNeverAsk \? \(carry\) => cb\.onNeverAsk\?\.\(c, turn, ask\.kind, carry\) : undefined,/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /onNeverAsk: async \(chat, turn, kind, carry\) => \{[^]*?return sendAsked\(chat, turn, cold \|\| changed \? \{ sendAsIs: true, carry \} : \{\}\);/);
  });

  test("no forms where the page weighs none, or the card is no lost session's", async () => {
    const bare = /** @type {any} */ (askCard("q", MOVED, { options: async () => ({ ways: WAYS.slice(2) }), onCompact: () => {}, onSendAsIs: () => {} }));
    const cold = /** @type {any} */ (askCard("q", COLD, { options: async () => ({ ways: WAYS.slice(2) }), carryOptions: async () => carryChoices(SWEEP, MOVED), onCompact: () => {}, onSendAsIs: () => {} }));
    const none = /** @type {any} */ (askCard("q", MOVED, { options: async () => ({ ways: WAYS.slice(2) }), carryOptions: async () => null, onCompact: () => {}, onSendAsIs: () => {} }));
    await tick();
    assert.equal(bare.querySelector(".ix-ask-carry"), null);
    assert.equal(cold.querySelector(".ix-ask-carry"), null);
    assert.equal(none.querySelector(".ix-ask-carry").classList.contains("hidden"), true);
  });

  test("the page weighs the forms by the session's one preview, and sends the pick with Send as it is and Compact and send", () => {
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /carryOptions: cb\.carryOptions && ask\.kind === "lost" \? \(\) => cb\.carryOptions\?\.\(c, ask\) \?\? Promise\.resolve\(null\) : undefined,/);
    assert.match(timeline, /onSendAsIs: cb\.onSendAsIs \? \(carry\) => cb\.onSendAsIs\?\.\(c, turn, carry\) : undefined,/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /carryOptions: async \(chat, ask\) => \{\s+if \(sessionChat\(\) !== chat \|\| !chat\.chainId \|\| ask\.kind !== "lost"\) return null;\s+return composePreview\(\)\.then\(\(pv\) => carryChoices\(pv, ask\)/);
    assert.match(app, /onSendAsIs: \(chat, turn, carry\) => \{\s+if \(turnRunsIn\(chat\)\) return false;\s+return sendAsked\(chat, turn, \{ sendAsIs: true, carry \}\);/);
    assert.match(readFileSync("src/ui/harness.css", "utf8"), /\.ix-ask\.is-running \.ix-ask-carry \{ display: none; \}/);
  });
});

// (fails before: yes — the drive of fe86a180d: a message that waited for the chat is on no record, yet its row stayed
// beside the turn its send drew)
test("a message that waited for the chat gives its row to the turn its send draws, as one a card stopped does", () => {
  const done = { n: 1, status: "done" };
  const waiting = { n: 2, status: "waiting" };
  assert.deepEqual(withoutAsked([done, waiting], waiting), [done]);
  assert.equal(withoutAsked([done], waiting), null, "a row already gone");
});

// (fails before: yes — the review of 9f0185fbe: a message withdrawn while it waited is on no record either, yet its row
// stayed beside the turn its Retry sent)
test("a message withdrawn while it waited gives its row to the turn its Retry sends", () => {
  const done = { n: 1, status: "done" };
  const withdrawn = { n: 2, status: "stopped", withdrawn: true };
  assert.deepEqual(withoutAsked([done, withdrawn], withdrawn), [done]);
});
