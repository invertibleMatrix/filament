// @ts-check
// One set of words for how earlier turns reach the model (HarnessV4_Tasks U3, UX-4): every stored value has its name,
// and the page and the server say the same names. The stored values stay as they are.
// (fails before: yes — neither words module existed; the page said "Aggressive", "Trim" and "Plain", `/view` said
// "strategy `fold+1`", and `/view use folded` was no strategy)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as server from "../src/core/context-words.js";
import * as page from "../src/ui/lib/context-words.js";
import { KNOBS, COMPACTION_METHODS, COMPACTION_AGENT_WAYS, SUBAGENT_VIEWS, SHAPE_RANK } from "../src/services/session-settings.js";
import { settingChangeWords, subagentViewFact } from "../src/ui/harness/lib/labels.js";
import { SHAPE_WORDS, SHAPE_MEANS } from "../src/ui/lib/settings/knobs.js";

const { METHODS, WAYS, SUBAGENT_VIEW_WORDS, FORK_TRANSCRIPT_WORDS, CARRY_WORDS, CARRY_LABEL, FORMS, ROOM_WORDS, methodName, wayName, roomWords } = server;
const ids = (/** @type {readonly { id: string }[]} */ t) => t.map((x) => x.id);
const names = (/** @type {readonly { name: string }[]} */ t) => t.map((x) => x.name);

test("the page's copy is the server's: the same tables, word for word, below each file's own header", () => {
  // The layers keep the page and the server apart (test/ratchets.test.js), so each has its own copy.
  const body = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/^(\/\/.*\r?\n)+/, "");
  assert.equal(body("../src/ui/lib/context-words.js"), body("../src/core/context-words.js"));
  assert.deepEqual(Object.keys(page).sort(), Object.keys(server).sort());
  for (const k of ["METHODS", "NAME_DEFAULTS", "WAYS", "SUBAGENT_VIEW_WORDS", "FORK_TRANSCRIPT_WORDS", "CARRY_WORDS", "CARRY_LABEL", "FORMS", "ROOM_WORDS"]) assert.deepEqual(/** @type {any} */ (page)[k], /** @type {any} */ (server)[k], k);
});

test("every stored value has its words: the methods, the ways, a sub-agent's views, a fork's carries, the forms", () => {
  assert.deepEqual(ids(METHODS).sort(), [...COMPACTION_METHODS].sort(), "context.compaction.method");
  assert.deepEqual(ids(WAYS), [...COMPACTION_AGENT_WAYS], "context.compaction.agent");
  assert.deepEqual(ids(SUBAGENT_VIEW_WORDS), Object.keys(SUBAGENT_VIEWS), "a sub-agent's launch");
  assert.deepEqual(ids(FORK_TRANSCRIPT_WORDS), KNOBS["fork.transcript"].options, "fork.transcript");
  assert.deepEqual(ids(CARRY_WORDS), KNOBS["context.carry"].options, "context.carry (U3-7)");
  assert.equal(CARRY_LABEL, "Carry earlier turns as", "the one label of the flows that carry a chat (UX-12)");
  assert.deepEqual(ids(FORMS), Object.keys(SHAPE_RANK), "a turn's shapes");
  // Every name has its line, and no two entries of one table share an id.
  for (const t of [METHODS, WAYS, SUBAGENT_VIEW_WORDS, FORK_TRANSCRIPT_WORDS, CARRY_WORDS, FORMS]) {
    assert.equal(new Set(ids(t)).size, t.length);
    for (const x of t) assert.ok(x.name && x.line, x.id);
  }
});

test("the words, as UX-4 lays them out", () => {
  // (fails before: yes — the owner's rules of 10-31: no choice of how earlier turns are sent, so no table names one)
  assert.ok(!("VIEWS" in server) && !("viewName" in server) && !("viewFromWords" in server));
  // (fails before: yes — the owner's rules of 10-31: compaction comes down to one summary, by the same model or a side
  // model, and an instant fold; the tail, the target, Least lossy and Newest turns only go)
  assert.deepEqual(names(METHODS), ["One summary", "Instant fold"]);
  assert.ok(!("AUTO" in server) && !("NEWEST" in server) && !("ONCE_METHODS" in server));
  // The methods, each with its number from the session's knobs.
  assert.equal(methodName("summary"), "One summary");
  assert.equal(methodName("fold", { keepWhole: 2 }), "Instant fold, newest 2 whole");
  assert.deepEqual([methodName("fold", { keepWhole: 0 }), methodName("fold")], ["Instant fold", "Instant fold, newest 1 whole"], "a knob not given takes its shipped default");
  assert.deepEqual(["trim", "auto", "newest", "digest"].map((id) => methodName(id)), ["One summary", "One summary", "One summary", "One summary"], "a method no layer holds any more reads as the default's");
  // An agent session's ways, with the agent's name.
  assert.deepEqual(["own", "self", "ours", "suggested"].map((w) => wayName(w, "Claude Code")), ["Claude Code's own compaction", "Claude Code writes a summary", "Filament's copy", "Suggested"]);
  // A finished turn is whole or folded; "summary" means a span of turns, never one.
  assert.deepEqual(names(FORMS), ["Whole", "Folded"]);
  assert.deepEqual(names(SUBAGENT_VIEW_WORDS), ["Nothing", "Folded", "Context window", "A live copy"]);
  // (fails before: yes — the owner's words of 10-19: the views never said where they start)
  for (const v of SUBAGENT_VIEW_WORDS.filter((x) => !["none", "fork"].includes(x.id))) assert.match(v.line, /since (the|its) last compaction/, `${v.name} says where it starts`);
  assert.deepEqual(names(FORK_TRANSCRIPT_WORDS), ["As it was", "Folded", "One summary"]);
});

// (fails before: yes — the owner's rules of 10-31: the card offered a tail, a target and the newest turns; it offers
// the three kinds — the same model, a side model, an instant fold — beside a coding agent's own two)
test("the card's ways in plain words: the three kinds and an agent's own two, the main ones marked; anything else has none", () => {
  assert.deepEqual(Object.keys(ROOM_WORDS), ["way:own", "way:self", "same", "side", "fold"]);
  assert.deepEqual(Object.keys(ROOM_WORDS).filter((id) => ROOM_WORDS[/** @type {keyof typeof ROOM_WORDS} */ (id)].main), ["way:own", "same", "side", "fold"]);
  assert.deepEqual(roomWords("way:own", { agent: "Claude Code" }), { name: "Claude Code makes room its own way", line: "It compacts its own session, as its /compact does.", main: true });
  assert.equal(roomWords("way:self")?.name, "The agent writes the summary", "no agent named: the agent");
  assert.deepEqual(["same", "side", "fold"].map((id) => roomWords(id)?.name), ["Same model", "Side model", "Instant fold"]);
  assert.match(String(roomWords("same")?.line), /warm cache/, "the same model reads its warm cache while it lasts");
  assert.match(String(roomWords("side")?.line), /tool calls folded/, "turns too big whole for the side model go folded");
  assert.match(String(roomWords("fold")?.line), /No summary, no model call/);
  for (const id of ["", "own", "constructor", "toString", "bogus", "digest", "trim", "auto", "newest", "summary"]) assert.equal(roomWords(id), null, `${JSON.stringify(id)} has none`);
});

test("the page says a change in the same words: the row's name, then the value's", () => {
  assert.deepEqual(["summary", "fold", "trim"].map((v) => settingChangeWords("context.compaction.method", v)), ["Makes room by: One summary", "Makes room by: Instant fold", "Makes room by: One summary"], "a method no layer holds any more: the default's");
  // (fails before: yes — the writer and the instant line had no words of their own: "writer: session", "instantTokens: 20,000")
  assert.deepEqual(["session", "model", undefined].map((v) => settingChangeWords("context.compaction.writer", v)), ["Summaries written by: the same model", "Summaries written by: a side model", "Summaries written by: the default"]);
  assert.deepEqual([20000, 0, undefined].map((v) => settingChangeWords("context.compaction.instantTokens", v)), ["Instant fold up to 20K of the earlier turns", "Instant fold: off", "Instant fold up to: the default"]);
  assert.equal(settingChangeWords("context.compaction.agent", "ours"), "Makes room by: Filament's copy");
  // The two questions, as their rows' two choices say them (HarnessV4_Tasks U11).
  assert.deepEqual(["ask", "auto", undefined].map((v) => settingChangeWords("context.compaction.mode", v)), ["When the chat is full: Ask me", "When the chat is full: Just do it", "When the chat is full: the default"]);
  assert.deepEqual([true, false].map((v) => settingChangeWords("context.compaction.resumeQuestion", v)), ["When the cache is cold: Ask me", "When the cache is cold: Just send"]);
  assert.equal(settingChangeWords("fork.transcript", "brief"), "Forks carry: One summary");
  assert.equal(settingChangeWords("context.carry", "words"), "A fresh agent session carries: Words", "U3-7: in the carry's own names, not the view's");
  assert.equal(settingChangeWords("context.carry"), "A fresh agent session carries: the default");
  assert.deepEqual(
    [settingChangeWords("context.compaction.follow", false), settingChangeWords("context.compaction.follow", true), settingChangeWords("context.compaction.follow")],
    ["Filament's copy keeps every turn", "Filament's copy kept in step with the agent", "Filament's copy: the default"],
    "HarnessV4_Tasks C29",
  );
  assert.equal(settingChangeWords("context.compaction.method", undefined), "Makes room by: the default");
  // A sub-agent's view beside its model; the task alone says nothing.
  assert.deepEqual(["folded", "window", "fork", "none", "moderate"].map(subagentViewFact), ["sees Folded", "sees Context window", "a live copy of the main agent", "", ""]);
  // The context map speaks the forms' names.
  assert.deepEqual(SHAPE_WORDS, { raw: "whole", fold: "folded" });
  assert.deepEqual(Object.keys(SHAPE_MEANS), ids(FORMS));
});
