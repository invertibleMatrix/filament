// @ts-check
// "Carry earlier turns as" (HarnessV4_Tasks U3-7, UX-12): one control in the flows that carry a chat — a fork, a
// fresh coding-agent session's start — under one label, in the names everywhere says.
// (fails before: yes — widgets/carry.js did not exist; the fork dialog had a bare <select> under "the fork sees the
// history", the Start board said "What they see", the sub-agent panel "Context", and an agent's session had no choice)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { CARRY_LABEL, CARRY_WORDS, FORK_TRANSCRIPT_WORDS, FORMS, SUBAGENT_VIEW_WORDS, methodName } from "../src/ui/lib/context-words.js";
import { KNOBS, CARRY_FORMS } from "../src/services/session-settings.js";

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const load = () => import("../src/ui/harness/widgets/carry.js");

test("the words: one label, and a fresh agent session's forms named as a turn's forms, the fold compaction and a sub-agent's are", () => {
  assert.equal(CARRY_LABEL, "Carry earlier turns as");
  assert.deepEqual(CARRY_WORDS.map((x) => x.id), [...CARRY_FORMS]);
  assert.deepEqual(CARRY_WORDS.map((x) => x.id), KNOBS["context.carry"].options);
  assert.deepEqual(CARRY_WORDS.map((x) => x.name), ["Words", "Folded", "Folded, newest 2 whole", "Whole"]);
  // One idea, one name: the names a turn's forms, a sub-agent's launch and a fork say, the newest kept whole as the
  // instant fold says it (the owner's rules of 10-31: the fold compaction is the Instant fold). Words is this start's own
  // form (HarnessV4_Tasks C28): no other flow carries a chat that way.
  const said = new Set([...FORMS, ...SUBAGENT_VIEW_WORDS, ...FORK_TRANSCRIPT_WORDS].map((x) => x.name));
  for (const x of CARRY_WORDS) if (x.id !== "words") assert.ok(said.has(x.name.replace(/, newest \d+ whole$/, "")), `${x.name} is a name another flow says`);
  assert.ok(methodName("fold", { keepWhole: 2 }).endsWith(", newest 2 whole") && String(CARRY_WORDS.find((x) => x.id === "fold+2")?.name).endsWith(", newest 2 whole"));
  assert.ok(!said.has("Words"));
});

test("the control: its label, a capsule per choice, the chosen one's line under them; a press picks and says so", async () => {
  const { carryControl } = await load();
  let value = "ditto";
  /** @type {string[]} */
  const picked = [];
  const c = carryControl(fakeH, { options: FORK_TRANSCRIPT_WORDS, value: () => value, onChange: (id) => { value = id; picked.push(id); } });
  assert.ok(textOf(c.el).startsWith("Carry earlier turns as"), textOf(c.el));
  const radios = buttonsOf(c.el);
  assert.deepEqual(radios.map((b) => textOf(b)), ["As it was", "Folded", "One summary"]);
  assert.deepEqual(radios.map((b) => b.attrs.role), ["radio", "radio", "radio"]);
  assert.equal(c.group.attrs.role, "radiogroup");
  assert.equal(c.group.attrs["aria-label"], "Carry earlier turns as");
  assert.deepEqual(radios.map((b) => b.attrs["aria-checked"]), ["true", "false", "false"]);
  assert.deepEqual(radios.map((b) => b.attrs.tabindex), ["0", "-1", "-1"], "one Tab stop");
  assert.equal(textOf(c.line), "Every inherited turn keeps the form it has here.");
  radios[1].dispatch("click");
  assert.deepEqual(picked, ["folds"]);
  assert.deepEqual(buttonsOf(c.el).map((b) => b.attrs["aria-checked"]), ["false", "true", "false"]);
  assert.equal(textOf(c.line), "Every inherited turn folded to one line per tool call.");
  radios[1].dispatch("click");
  assert.deepEqual(picked, ["folds"], "the one chosen is not chosen again");
  assert.equal(c.group.style["--carry-cols"], "3", "three stand in one row");
  // Under a row that already says the label, the control leaves it out; the group keeps its name.
  const bare = carryControl(fakeH, { options: FORK_TRANSCRIPT_WORDS, value: () => value, onChange: () => {}, bare: true });
  assert.ok(textOf(bare.el).startsWith("As it was"), textOf(bare.el));
  assert.equal(bare.group.attrs["aria-label"], "Carry earlier turns as");
});

test("a choice that cannot be taken now says why, is not pressed, and the arrows step over it; a figure stands under a name", async () => {
  const { carryControl, carryCols, carryStep } = await load();
  let value = "none";
  let forkable = false;
  const c = carryControl(fakeH, {
    options: SUBAGENT_VIEW_WORDS,
    value: () => value,
    onChange: (id) => { value = id; },
    off: (id) => (id === "fork" && !forkable ? "Nothing to fork yet" : null),
    lineOf: (o) => (o.id === "none" ? "It starts from the task alone." : `It reads ${o.line}.`),
    figures: true,
  });
  const by = (/** @type {string} */ id) => buttonsOf(c.el).find((b) => b.attrs["data-carry"] === id);
  assert.deepEqual(buttonsOf(c.el).map((b) => b.attrs["data-carry"]), ["none", "folded", "window", "fork"]);
  assert.ok("disabled" in by("fork").attrs);
  assert.equal(by("fork").attrs.title, "Nothing to fork yet");
  assert.equal(by("folded").attrs.title, "since the last compaction: each turn folded to your words, one line per tool call, and the reply");
  by("fork").dispatch("click");
  assert.equal(value, "none", "a choice that is off is not taken");
  assert.equal(textOf(c.line), "It starts from the task alone.");
  // The arrows: right from the last choosable wraps to the first; left from the first to the last choosable.
  value = "window";
  c.paint();
  c.group.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(value, "none");
  c.group.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(value, "window");
  assert.equal(by("window").focused, true, "the focus goes with the choice");
  assert.equal(textOf(c.line), "It reads what the main agent holds now: since its last compaction, this turn to its newest round.");
  c.group.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(textOf(c.line), "It reads since the last compaction: each turn folded to your words, one line per tool call, and the reply.");
  // It can be chosen once there is something to fork.
  forkable = true;
  c.paint();
  assert.ok(!("disabled" in by("fork").attrs));
  by("fork").dispatch("click");
  assert.equal(value, "fork");
  // A figure under a name (a view's size), filled as it arrives.
  c.fig("folded", "~24K");
  assert.equal(textOf(by("folded")), "Folded|~24K");
  assert.equal(c.group.style["--carry-cols"], "4", "four stand in one row");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(carryCols), [1, 2, 3, 4, 3, 3]);
  assert.equal(carryStep(["a", "b", "c"], "c", 1), "a");
  assert.equal(carryStep(["a", "b", "c"], "x", -1), "c", "from one not among them, left is the last");
  assert.equal(carryStep(["a", "b", "c"], "x", 1), "a", "and right the first");
});

test("the flows take it: the fork dialog, an agent's Context section; the Start board sets no chat-wide view for sub-agents", () => {
  const app = read("src/ui/harness/app.js");
  assert.match(app, /carryControl\(h, \{ options: FORK_TRANSCRIPT_WORDS/, "the fork dialog draws the control");
  assert.doesNotMatch(app, /the fork sees the history/, "under the one label");
  assert.doesNotMatch(app, /FORK_TRANSCRIPT_WORDS\.map\(\(\{ id: v, name, line \}\)/, "not a bare select of its own");
  // (fails before: yes — the owner's word of 10-31: a sub-agent sees its task alone unless its launch asks; the board
  // had a "Carry earlier turns as" row for every sub-agent of the chat)
  const board = read("src/ui/harness/conversation/start-board.js");
  assert.doesNotMatch(board, /CARRY_LABEL|subagents\.view/);
  assert.doesNotMatch(board, /What they see/);
  const css = read("src/ui/harness.css");
  assert.match(css, /\.carry-segs \{[^}]*grid-template-columns: repeat\(var\(--carry-cols, 3\), minmax\(0, 1fr\)\)/);
});
