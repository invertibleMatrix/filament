// @ts-check
// `/compaction`: the card that asks before a message, brought up when you want it. The owner's words of 10-18: "make a
// command to summon the compaction card if i need to so that i don't have to wait for it to show up itself". Typed in
// the chat's own box, the word brings the card up after the last turn, with what the chat holds against its line as
// the ring shows it, and the ways as rows (proposal_ux §4.12 step 3). Alone, Compact makes room; with a message after
// the word, Compact and send makes room and then sends it, Send it as it is — a way of its own — sends it now, and Not
// now puts it back in the box. The ring's Compact now… brings the same card up, mid-turn too.
// (fails before: yes — there was no such word, and the card came only when a message was stopped)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askCard, askFacts, askReason, askSentence, wayDoes } from "../src/ui/harness/conversation/interaction.js";
import { compactionCardOf } from "../src/ui/harness/lib/labels.js";
import { commandCatalog } from "../src/app/commands/registry.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { APP_SRC, lift } from "./helpers/app-lift.js";
import { isClientView } from "../src/ui/harness/widgets/compaction.js";
import { asksYou } from "../src/ui/harness/lib/team.js";
import { newestOnRecord } from "../src/ui/harness/conversation/history.js";

/** @param {string} rel */
const source = (rel) => readFileSync(new URL(`../src/ui/harness/${rel}`, import.meta.url), "utf8");
const tick = () => new Promise((r) => setImmediate(r));
/** The buttons on the card's face, while its answers row shows. @param {any} el */
/** What Not now says it does. @param {any} el */
const notNowSays = (el) => el.querySelector(".ix-error-acts").querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").getAttribute("title");
const faceOf = (el) => {
  const acts = el.querySelector(".ix-error-acts");
  return acts.classList.contains("hidden") ? [] : acts.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent);
};
/** A Claude Code chat at 212K of its 1M window, its line at 400K: the ring's figures. */
const HELD = Object.freeze({ kind: "summoned", tokens: 212_000, estimated: true, window: 1_000_000, usable: 400_000 });
/** @type {import("../src/ui/harness/widgets/compaction.js").WayChoice[]} */
const WAYS = [
  { id: "way:own", label: "Claude Code makes room its own way", sub: "Reads ≈212K again", recommended: true, disabled: false, title: "It compacts its own session, as its /compact does.", writes: false, main: true, after: "", cost: "", pace: "", note: "Reads ≈212K again", tag: "", folds: false },
  { id: "fold", label: "Instant fold", sub: "30K after · Free · no model call", recommended: false, disabled: false, title: "Your words and the answers stay; each tool call becomes one line. No summary, no model call.", writes: false, main: true, after: "30K after", cost: "Free · no model call", pace: "instant", note: "Leaves 12K of the earlier turns", tag: "", folds: true },
];
/** The names of the card's first ways, Send it as it is among them where a message waits. @param {any} el */
const waysOf = (el) => el.querySelectorAll(".ix-ask-ways .ix-way").map((/** @type {any} */ b) => b.querySelector("b").textContent);

test("the word: alone, or with the message it holds after it; anything else is no /compaction", () => {
  assert.equal(compactionCardOf("/compaction"), "");
  assert.equal(compactionCardOf("  /Compaction  "), "", "any case, the box's spaces aside");
  assert.equal(compactionCardOf("/compaction now fix the tests"), "now fix the tests");
  assert.equal(compactionCardOf("/compaction\nfirst line\nsecond line"), "first line\nsecond line", "a message of many lines");
  assert.equal(compactionCardOf("/compact"), null, "the agent's own: it compacts at once");
  assert.equal(compactionCardOf("/compactions"), null);
  assert.equal(compactionCardOf("please /compaction"), null, "only at the start");
});

test("its sentence: what the chat holds against your line, then what Compact does — before your message goes, where one waits", () => {
  const own = wayDoes("way:own", { agentName: "Claude Code", agent: true });
  assert.equal(askReason(HELD), "This chat holds ≈212K of your 400K line");
  assert.equal(askSentence(HELD, own, ""), "This chat holds ≈212K of your 400K line. Claude Code will compact the chat.");
  assert.equal(askSentence({ ...HELD, sends: true }, own, ""), "This chat holds ≈212K of your 400K line. Claude Code will compact the chat before your message goes.");
  assert.equal(askSentence({ kind: "summoned", tokens: 36_000, estimated: false, window: 40_000 }, null, ""), "This chat holds 36K of its 40K window. Room is made.", "no line known: the window; before the ways come: no way named");
  assert.equal(askSentence({ kind: "summoned", tokens: null }, null, ""), "This chat's size is not counted yet. Room is made.", "a coding agent that has counted nothing yet");
  assert.deepEqual(askFacts(HELD), ["≈212,000 of 1,000,000 tokens · the line is at 400,000"], "no cache or reader claimed: the page knows neither");
});

describe("the card you brought up", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  test("alone: its ways as rows, Not now and Compact — no way to stop being asked, since nothing asked; Compact makes room and says so", async () => {
    /** @type {any[]} */
    const did = [];
    /** @type {(v: unknown) => void} */
    let end = () => {};
    const el = /** @type {any} */ (askCard("", HELD, {
      options: async () => ({ ways: WAYS, writable: true, writer: "zai/glm-5.3-flash", agentName: "Claude Code" }),
      onCompact: (choice, once) => (did.push(["compact", choice, once]), new Promise((r) => { end = r; })),
      onDismiss: () => did.push("dismiss"),
    }));
    await tick();
    assert.equal(el.querySelector(".ix-ask-title").textContent, "Make room now?");
    assert.equal(el.querySelector(".ix-error-msg").textContent, "This chat holds ≈212K of your 400K line. Claude Code will compact the chat.");
    assert.deepEqual(faceOf(el), ["Not now", "Compact"]);
    assert.equal(notNowSays(el), "Close the card");
    assert.deepEqual(waysOf(el), ["Claude Code makes room its own way", "Instant fold"], "no Send it as it is: nothing waits");
    assert.equal(el.querySelector(".ix-way.is-on b").textContent, "Claude Code makes room its own way", "the way suggested, chosen");
    assert.equal(el.querySelector(".ix-ask-never"), null, "no Just do it from now on");
    assert.ok(el.querySelector(".ix-ask-toggle").classList.contains("hidden"), "no more ways, nothing more to show");
    assert.ok(el.querySelector(".ix-ask-once").classList.contains("hidden"), "no way listed writes a summary: no side model to pick");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, [["compact", "way:own", null]]);
    assert.equal(el.querySelector(".ix-error-msg").textContent, "Making room: Claude Code is compacting the chat.", "no message waits for it");
    end(true);
    await tick();
    assert.equal(el.querySelector(".ix-error-msg").textContent, "Room made.");
  });

  test("with a message: Compact and send, and Send it as it is as a way: picked, the act sends", async () => {
    /** @type {any[]} */
    const did = [];
    const el = /** @type {any} */ (askCard("", { ...HELD, sends: true }, {
      options: async () => ({ ways: WAYS, writable: true, writer: "zai/glm-5.3-flash", agentName: "Claude Code" }),
      onCompact: () => (did.push("compact"), new Promise(() => {})),
      onSendAsIs: () => (did.push("as is"), true),
      onDismiss: () => did.push("dismiss"),
    }));
    await tick();
    assert.deepEqual(faceOf(el), ["Not now", "Compact and send"]);
    assert.equal(notNowSays(el), "Close the card: your message goes back to the box", "a message you held");
    assert.equal(el.querySelector(".ix-ask-act").classList.contains("primary"), true, "making room first: what you asked for");
    assert.equal(el.querySelector(".ix-ask-title").textContent, "Make room before this message?");
    assert.deepEqual(waysOf(el), ["Claude Code makes room its own way", "Instant fold", "Send it as it is"], "a message you held: Send it as it is after the ways");
    el.querySelectorAll(".ix-ask-ways .ix-way")[2].dispatch("click");
    assert.equal(el.querySelector(".ix-ask-act").textContent, "Send");
    assert.equal(el.querySelector(".ix-error-msg").textContent, "This chat holds ≈212K of your 400K line. Your message goes now, as it is.");
    el.querySelector(".ix-ask-act").dispatch("click");
    assert.deepEqual(did, ["as is"]);
  });
});

// (fails before: yes — the hunt's lead (f): room made for a chat not shown said "Room made — your message is on its way"
// over the chat shown, though the message might wait in its own chat's queue, or be refused there)
test("room made for a card's message says it is on its way in its own chat alone: another chat shown, it may wait there or be refused", async () => {
  /** @type {string[]} */
  const toasts = [];
  const chat = { id: "c1", chainId: "s-c1", turns: [] };
  const state = { currentId: "c2" };
  const { compactNow } = lift(["compactNow", "compactAsk?", "roomMade?", "roomNotMade?", "compactingBetween?"], {
    state,
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
    api: async () => ({ compaction: {}, boundary: { id: 9, afterTurn: 1 } }),
    toast: (/** @type {string} */ w) => void toasts.push(w),
    compactionFacts: () => "",
    viewOnlyPage: () => false,
  });
  assert.equal(await compactNow(chat, { sending: true }), true);
  state.currentId = "c1";
  assert.equal(await compactNow(chat, { sending: true }), true);
  assert.deepEqual(toasts, ["Room made", "Room made — your message is on its way"]);
});

test("the box takes the word before anything is sent, and puts the draft back where the card could not come", () => {
  const box = source("composer/composer.js");
  const send = box.slice(box.indexOf('  const send = (modifier, asWritten = false, own = false, by = "click") => {'), box.indexOf("    if (!asWritten && cb.onAsk) {"));
  assert.match(send, /const card = asWritten \|\| !cb\.onCompactionCard \? null : compactionCardOf\(text\);/, "typed in the box, not sent as written");
  assert.match(send, /cb\.onCompactionCard\?\.\(\{ message: card, files \}\)\)\.then\(\(ok\) => \{\n\s+if \(ok !== false\) return;\n\s+backInBox\(text, files, \[\]\);/);
  assert.ok(send.indexOf("compactionCardOf(text)") > send.indexOf("btwOf(text)"), "after /btw, before anything goes to the session");
});

test("the page brings it up with the ring's figures, keeps it on the chat, and answers it as the card before a message is answered", () => {
  const app = source("app.js");
  assert.match(app, /onCompactionCard: \(\{ message, files \}\) => summonCompactionCard\(message, files\),/);
  const summon = app.slice(app.indexOf("function summonCompactionCard(message, files) {"), app.indexOf("function switchAccount("));
  assert.match(summon, /if \(!chat\?\.chainId\) \{\n\s+toast\("Nothing to compact yet/, "no session: nothing to compact");
  // Mid-turn (the ring's Compact now… while Filament's loop runs): the card asks to fold at the turn's next step; a
  // message waits for the turn's end, and a coding agent compacts its own context as it works.
  assert.match(summon, /const midTurn = !!chat\.live;\n\s+if \(midTurn && \(message \|\| files\.length\)\) \{\n\s+toast\("A turn is running in this chat — bring the card up with your message once it ends", "err"\);\n\s+return false;/);
  assert.match(summon, /if \(midTurn && \(chat\.live\.runKind === "coding-agent" \|\| codingAgentModel\(chat\.model\)\)\) \{\n\s+toast\("A coding agent compacts its own context as it works/);
  assert.match(summon, /const face = windowFace\(chat\.view, composer\.live\(\)\);/, "the ring's own figures");
  assert.match(summon, /ask: \{ kind: "summoned", sends: !!\(words \|\| held\.length\), \.\.\.\(midTurn \? \{ midTurn: true \} : \{\}\), tokens: face\.known \|\| face\.tokens > 0 \? face\.tokens : null, estimated: face\.estimated \|\| !face\.known, window: face\.window, usable: face\.line\?\.tokens \?\? null \}/);
  assert.match(summon, /transcript\.drawSummoned\(chat, \{ reveal: true \}\);/, "brought up, it comes into sight");
  const answers = app.slice(app.indexOf("  onSummonedCompact: async (chat, choice, once) => {"), app.indexOf("  // Send without it (the filament-agent plan's D6"));
  assert.match(answers, /if \(s\.ask\.midTurn && chat\.live\) \{\n\s+if \(!\(await steerCompact\(chat\)\)\) return false;/, "mid-turn: the compact steer, at the turn's next step");
  assert.match(answers, /const c = choiceCompaction\(choice, once\?\.model \?\? null\);\s+const made = await compactSession\(chat, c\.method, c\.way, c\.once, \{ sending: s\.ask\.sends === true \}\);/, "the way chosen, with its side model");
  assert.match(answers, /if \(s\.ask\.sends\) \{\s+chat\.roomWait = false;\s+void sendSummoned\(chat, s, sendsIn\(chat\)\);/, "then the message, past the cold question, in its own chat");
  assert.match(answers, /onSummonedSend: \(chat\) => \{[\s\S]*?void sendSummoned\(chat, s\);/);
  assert.match(answers, /onSummonedDismiss: \(chat\) => \{[\s\S]*?composer\.takeBack\(s\.message, s\.files\);/, "Not now: the message back in the box");
  const tl = source("conversation/timeline.js");
  assert.match(tl, /scroller\.append\(inner, summonedSlot, tail\);/, "after the last turn, over the Compacting row's place");
  assert.match(tl, /summonedSlot\.replaceChildren\(askCard\("", s\.ask, \{/);
  assert.match(tl, /onSendAsIs: s\.ask\.sends \? \(\) => cb\.onSummonedSend\?\.\(c\) : undefined,/);
  assert.match(tl, /refreshNav\(\);\n\s+api_\.drawSummoned\(c\);/, "a chat switched back to draws its card again");
});

// (fails before: yes — the ring offers no Compact now… in an outside client's chat, yet `/compaction` and the row's
// summon brought the card up there, whose Compact the server refuses: its client owns the history and compacts it)
test("an outside client's chat brings no card up: its client owns the history and compacts it", () => {
  /** @type {string[]} */
  const toasts = [];
  /** @type {string[]} */
  const drawn = [];
  const chat = { id: "c1", chainId: "s-c1", live: null, turns: [], view: { settings: { native: false } } };
  const { summonCompactionCard } = lift(["summonCompactionCard"], {
    state: { currentId: "c1" },
    chatOf: () => chat,
    isClientView,
    asksYou,
    newestOnRecord,
    toast: (/** @type {string} */ words) => void toasts.push(words),
    transcript: { drawSummoned: () => void drawn.push("card") },
  });
  assert.equal(summonCompactionCard("", []), false);
  assert.deepEqual([toasts, drawn], [["This chat is its client's: its client owns the history and compacts it"], []]);
});

// (fails before: yes — the hunt's lead (f): a turn that paused for an answer counted as ended — `/compaction` brought the
// card up between the question and its answer, true, and a card brought up while the turn ran made room inside it once
// it paused, the words then going as the question's answer)
test("a turn that waits for your answer is answered first: no card comes up, and a card up already makes no room between the question and its answer", async () => {
  /** @type {string[]} */
  const toasts = [];
  /** @type {any[]} */
  const compacted = [];
  const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", live: null, turns: [{ n: 3, status: "paused", paused: { kind: "permission" } }] });
  const scope = {
    state: { currentId: "c1" },
    chatOf: () => chat,
    isClientView,
    asksYou,
    newestOnRecord,
    toast: (/** @type {string} */ words) => void toasts.push(words),
    windowFace: () => ({ known: true, tokens: 9000, window: 200000 }),
  };
  const { summonCompactionCard } = lift(["summonCompactionCard"], scope);
  assert.equal(summonCompactionCard("tidy up", []), false, "the draft goes back to the box");
  assert.deepEqual([toasts, chat.summoned ?? null], [["Your agent's turn waits for your answer: answer it first, then bring the card up"], null]);
  // A card brought up while the turn ran, pressed once it paused for an answer: no room made inside that turn.
  chat.summoned = { message: "tidy up", files: [], ask: { kind: "summoned", sends: true, midTurn: true }, work: null };
  const at = APP_SRC.indexOf("  onSummonedCompact: async (chat, choice, once) => {");
  const end = APP_SRC.indexOf("\n  },\n", at);
  const names = ["asksYou", "newestOnRecord", "turnRunsIn", "choiceCompaction", "compactSession", "steerCompact", "transcript", "sendSummoned", "sendsIn"];
  const values = [asksYou, newestOnRecord, () => false, () => ({ method: null, way: null, once: null }), async (/** @type {any[]} */ ...a) => (compacted.push(a), true), async () => true, { drawSummoned() {} }, async () => {}, () => ({})];
  const { onSummonedCompact } = new Function(...names, `return ({\n${APP_SRC.slice(at, end)}\n  },\n});`)(...values);
  assert.equal(await onSummonedCompact(chat, null, null), "Your agent's turn waits for your answer: answer it first, then make room");
  assert.deepEqual([compacted, !!chat.summoned], [[], true], "nothing compacted; the card stands, its message with it");
});

test("the / list offers it, in the harness's words", () => {
  const group = commandCatalog({}).groups.find((g) => g.id === "compaction-card");
  assert.ok(group, "a group of its own");
  assert.deepEqual(group?.commands.map((c) => [c.command, c.forms]), [["/compaction", ["/compaction", "/compaction <message>"]]]);
  assert.match(group?.commands[0].summary || "", /Outside the harness the word goes to the model or agent as typed\.$/);
  const docs = readFileSync(new URL("../docs/COMMANDS.md", import.meta.url), "utf8");
  assert.match(docs, /\| `\/compaction` \| `\/compaction` · `\/compaction <message>` \|/, "docs/COMMANDS.md regenerated");
});
