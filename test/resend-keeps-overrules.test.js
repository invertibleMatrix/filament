// @ts-check
// A message sent again by a way on — a card's Compact and send or Send it as it is, a switch's Switch and send, Retry,
// a model chosen anew — overrules what it overruled when it was first sent (the owner's of 11-01, on the review's
// find: only Not now kept the Overruling line; every other way on sent the message without it, so the main agent never
// heard the person overrule the saved agent, and its card never said so).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lift } from "./helpers/app-lift.js";
import { againOf } from "../src/ui/harness/lib/labels.js";

/** sendAgain over a stand-in sendMessage that keeps what it was asked; the card's chat is the one shown. */
const page = () => {
  /** @type {any[][]} */
  const sent = [];
  const chat = { id: "a", chainId: "c1", turns: [] };
  const { sendAgain } = lift(["sendAgain", "sendsIn"], {
    state: { currentId: "a" }, chatOf: (/** @type {string} */ id) => (id === "a" ? chat : null), againOf,
    sendMessage: (/** @type {any[]} */ ...args) => void sent.push(args),
  });
  return { sent, chat, sendAgain };
};
const PM = Object.freeze({ agentId: "sa_pm", exchange: 1, name: "PM", question: "ship it?", answer: "Yes: ship the smallest version." });

// (fails before: yes — the message went again with no overrules)
test("a way on sends the message again with the answers it overruled, whole", () => {
  const { sent, chat, sendAgain } = page();
  const turn = { n: 2, userText: "No — fix the linker first", sent: [], attachments: [], overrules: [PM] };
  sendAgain(chat, turn, { sendAsIs: true });
  assert.equal(sent.length, 1);
  const [text, files, modifier, o] = sent[0];
  assert.deepEqual([text, files, modifier], ["No — fix the linker first", [], "normal"]);
  assert.deepEqual([o.overrules, o.sendAsIs, o.replaces], [[PM], true, turn], "as first sent, and as the card asked");
});

test("a turn read back from its record overrules by the record's own fields; one that overruled nothing, nothing", () => {
  const { sent, chat, sendAgain } = page();
  const recorded = { agentId: "sa_pm", exchange: 1, name: "PM" };
  sendAgain(chat, { n: 3, userText: "Retry this", sent: [], attachments: [], overrules: [recorded] });
  sendAgain(chat, { n: 4, userText: "Plain", sent: [], attachments: [] });
  assert.deepEqual(sent.map((s) => s[3].overrules), [[recorded], undefined]);
});

// The merge of main into uiux of 11-02: main's `sendAsked` puts a card's answer in the chat's queue where a turn began
// in the chat meanwhile, and the queue's item took its words, its files and what the card answered, not the answers it
// overruled.
// (fails before: yes — the item queued carried no overrules)
test("a card's answer that waits in the chat's queue for a turn begun meanwhile waits with the answers it overruled", async () => {
  /** @type {any[][]} */
  const queued = [];
  const chat = { id: "a", chainId: "c1", live: { runId: "r1" }, turns: /** @type {any[]} */ ([]) };
  const { sendAsked } = lift(["sendAsked"], {
    state: { currentId: "a" }, chatOf: (/** @type {string} */ id) => (id === "a" ? chat : null), againOf,
    withoutAsked: () => null, transcript: { dropTurn: () => {} },
    queueNext: (/** @type {any} */ _c, /** @type {any[]} */ items) => void queued.push(items),
  });
  const turn = { n: 2, userText: "No — fix the linker first", sent: [], attachments: [], overrules: [PM] };
  chat.turns = [turn];
  assert.equal(await sendAsked(chat, turn, { sendAsIs: true }), true);
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0], [{ text: "No — fix the linker first", files: [], overrules: [PM], sendAsIs: true }]);
});

test("pins: every way on goes through sendAgain", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  // The card's answers, the switch's, Retry and a model chosen anew: none sends a stopped turn's message by itself.
  const direct = [...app.matchAll(/sendMessage\(again\.text/g)].length;
  assert.equal(direct, 1, "sendAgain alone sends a turn's message again");
});
