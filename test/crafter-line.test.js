// @ts-check
// The crafter's line over the box (the owner's yes of 10-27): in a crafter chat, the skill it crafts and the way back to
// the chat /craft was typed in; in that chat, the crafters opened from it while they work or wait — none once done.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { craftLineOf, craftLineWords } from "../src/ui/harness/lib/craft.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {typeof import("../src/ui/harness/conversation/crafter-line.js").createCrafterLine} */
let createCrafterLine;
before(async () => {
  dom = stubDocument();
  ({ createCrafterLine } = await import("../src/ui/harness/conversation/crafter-line.js"));
});
after(() => dom.restore());

const ROWS = [
  { id: "src", title: "opus55" },
  { id: "c1", title: "Craft · kettle-9-tea", craft: { skill: "kettle-9-tea", from: "src" } },
  { id: "c2", title: "Craft · a skill for tilemaps", craft: { skill: null, from: "src" } },
  { id: "c3", title: "Craft · release", craft: { skill: "release", from: null } },
  { id: "plain", title: "something else" },
];
/** @param {string[]} working @param {string[]} [waiting] */
const at = (working, waiting = []) => ({ working: (/** @type {string} */ id) => working.includes(id), waiting: (/** @type {string} */ id) => waiting.includes(id) });

// (fails before: yes — there was no line: lib/craft.js had no craftLineOf, and no crafter-line.js)
test("what the line says: a crafter chat's skill and its way back; the chat it came from, while a crafter works or waits", () => {
  assert.deepEqual(craftLineOf("c1", ROWS, at([])), { kind: "crafter", skill: "kettle-9-tea", from: { id: "src", title: "opus55" } });
  assert.equal(craftLineWords(/** @type {any} */ (craftLineOf("c1", ROWS, at([])))), "This chat crafts the skill kettle-9-tea · started in");
  assert.equal(craftLineWords(/** @type {any} */ (craftLineOf("c3", ROWS, at([])))), "This chat crafts the skill release", "opened from the Library: no way back to name");
  assert.equal(craftLineOf("src", ROWS, at([])), null, "its crafters done: no line");
  assert.equal(craftLineOf("plain", ROWS, at(["c1"])), null, "a chat no crafter came from");
  assert.equal(craftLineOf(null, ROWS, at(["c1"])), null);
  const one = /** @type {any} */ (craftLineOf("src", ROWS, at(["c1"])));
  assert.equal(craftLineWords(one), "A crafter is at work on kettle-9-tea");
  assert.deepEqual(one, { kind: "source", crafters: [{ id: "c1", title: "Craft · kettle-9-tea", skill: "kettle-9-tea", waiting: false }] });
  assert.equal(craftLineWords(/** @type {any} */ (craftLineOf("src", ROWS, at([], ["c2"])))), "The crafter of a skill waits for your answer");
  // A turn that waits for a yes still runs (the drive of 10-27: the line said "at work" while Now said it needed you).
  assert.equal(craftLineWords(/** @type {any} */ (craftLineOf("src", ROWS, at(["c1"], ["c1"])))), "The crafter of kettle-9-tea waits for your answer");
  assert.equal(craftLineWords(/** @type {any} */ (craftLineOf("src", ROWS, at(["c1", "c2"])))), "2 crafter chats opened here are at work");
});

test("the line drawn: its words, a button that opens the chat it names, hidden with nothing to say", () => {
  /** @type {string[]} */
  const opened = [];
  const line = createCrafterLine({ onOpen: (id) => opened.push(id) });
  const el = /** @type {any} */ (line.el);
  assert.ok(el.classList.contains("hidden"), "nothing painted yet");
  line.paint(craftLineOf("c1", ROWS, at([])));
  assert.ok(!el.classList.contains("hidden"));
  assert.equal(el.querySelector(".crafter-line-words").textContent, "This chat crafts the skill kettle-9-tea · started in");
  const back = el.querySelectorAll(".crafter-line-btn");
  assert.deepEqual([back.length, back[0].textContent], [1, "“opus55”"]);
  back[0].dispatch("click");
  line.paint(craftLineOf("src", ROWS, at(["c1"])));
  const open = el.querySelectorAll(".crafter-line-btn");
  assert.deepEqual([open.length, open[0].textContent], [1, "Open"]);
  open[0].dispatch("click");
  line.paint(craftLineOf("src", ROWS, at(["c1", "c2"])));
  assert.deepEqual([...el.querySelectorAll(".crafter-line-btn")].map((b) => b.textContent), ["kettle-9-tea", "Craft · a skill for tilemaps"], "several: a button each, by skill");
  assert.deepEqual(opened, ["src", "c1"], "each press opens the chat it names");
  line.paint(null);
  assert.ok(el.classList.contains("hidden"), "done: the line goes");
});

// (fails before: yes — the owner's of 11-01: buttons blinking under a resting pointer, clicks lost — its buttons were
// made anew at every view of the chat)
test("its buttons stay through the chat's paints while what they open holds", () => {
  /** @type {string[]} */
  const opened = [];
  const line = createCrafterLine({ onOpen: (id) => opened.push(id) });
  const el = /** @type {any} */ (line.el);
  line.paint(craftLineOf("src", ROWS, at(["c1"])));
  const open = el.querySelector(".crafter-line-btn");
  line.paint(craftLineOf("src", ROWS, at(["c1"])));
  line.paint(craftLineOf("src", ROWS, at(["c1"])));
  assert.equal(el.querySelector(".crafter-line-btn"), open, "the Open that stood");
  open.dispatch("click");
  assert.deepEqual(opened, ["c1"]);
  line.paint(craftLineOf("src", ROWS, at(["c1", "c2"])));
  assert.deepEqual([...el.querySelectorAll(".crafter-line-btn")].map((b) => b.textContent), ["kettle-9-tea", "Craft · a skill for tilemaps"], "another crafter: its buttons drawn");
});
