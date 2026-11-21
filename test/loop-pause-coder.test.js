// @ts-check
// A question Filament's loop paused on while the chat's model is a coding agent (the decision of 11-02): only the loop's
// turn answers it, and a message to the agent leaves it unanswered — so the page offers no answer that would not be one.
// The dock draws no loop permission or question card then: the question shows as waiting for Filament's agent, with
// nothing to press; and the permission switch answers nothing. A coding agent's own questions on its run stay its own,
// answered as ever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecisions } from "../src/ui/harness/conversation/decisions.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { lift } from "./helpers/app-lift.js";
import { newestOnRecord } from "../src/ui/harness/conversation/history.js";
import { switchAnswer } from "../src/ui/harness/composer/mode.js";

/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
/** @type {any[]} */
const did = [];
const io = {
  answer: (/** @type {any} */ _c, /** @type {string} */ text) => void did.push(["answer", text]),
  always: () => void did.push(["always"]),
  workerAnswer: async () => true,
  workerAlways: async () => true,
  reveal: () => {},
  agentAnswer: async () => "",
  agentPlan: async () => "",
  permit: () => {},
  agentPermission: () => {},
  open: () => {},
};
const PAUSES = [
  { kind: "permission", tool: "bash", question: "May I run this command?", command: "npm publish" },
  { kind: "ask", question: "Which grammar?" },
];

// (fails before: yes — the dock drew the loop's permission card and its question while Claude Code was the chat's
// model: buttons to press, each an answer the agent's turn would not give)
test("the dock: the loop's question waits for Filament's agent, nothing to press, while a coding agent is the chat's model", () => {
  for (const paused of PAUSES) {
    const dock = createDecisions(io, { h: fakeH, place, later: () => {} });
    const chat = { chainId: "c1", turns: [{ n: 1, paused }] };
    dock.paint(/** @type {any} */ ({ chat, rows: [], view: "chat", team: null, coder: "Claude Code" }));
    const block = dock.el.kids[0];
    assert.ok(block?.classList.contains("dock-loop-waits"), `${paused.kind}: the loop's question, waiting`);
    assert.deepEqual(buttonsOf(dock.el), [], `${paused.kind}: nothing to press`);
    assert.match(textOf(block), /waits for Filament's agent/);
    assert.match(textOf(block), /Claude Code answers none of it/);
    assert.match(textOf(block), /leaves it unanswered/);
    // The chat's model the loop again: its card, answerable, in place of the note.
    dock.paint(/** @type {any} */ ({ chat, rows: [], view: "chat", team: null, coder: "" }));
    assert.ok(!dock.el.kids[0]?.classList.contains("dock-loop-waits") && buttonsOf(dock.el).length > 0, `${paused.kind}: the loop's card`);
  }
  assert.deepEqual(did, []);
});

// (fails before: yes — the dock was told no coding agent (its coder undefined), and the switch moved while the
// permission waited sent "Switched to …" as the loop's answer)
test("the page's side: the dock told the coding agent; no answer from the switch", () => {
  /** @type {any[]} */
  const painted = [];
  const coder = { view: { settings: { engine: { coder: "claude" } } } };
  /** @type {any} */
  const chat = { id: "c1", chainId: "s1", turns: [{ n: 1, requestId: "r1", paused: PAUSES[1] }], ...coder };
  const fns = lift(["paintDock", "coderNameOf", "loopSwitchAnswer?"], {
    chatOf: () => chat,
    state: { currentId: "c1" },
    chosenAgent: () => ({ agentName: "Claude Code" }),
    leadingTeam: () => null,
    newestOnRecord,
    switchAnswer,
    subagentStore: { rows: () => [] },
    views: { view: "chat" },
    decisions: { paint: (/** @type {any} */ s) => void painted.push(s) },
    composer: { setTeam: () => {}, setReading: () => {}, setSide: () => {} },
    chargeBand: { paint: () => {} },
  });
  fns.paintDock();
  assert.equal(painted[0].coder, "Claude Code", "the dock knows the chat's model is a coding agent");
  const permission = { ...chat, live: null, turns: [{ n: 1, paused: PAUSES[0] }] };
  assert.equal(fns.loopSwitchAnswer(permission, "edit"), null, "the switch answers nothing");
  // The loop the chat's model: as ever.
  const loop = { ...permission, view: { settings: { engine: {} } } };
  assert.match(String(fns.loopSwitchAnswer(loop, "edit")), /^Switched to /);
  chat.view = loop.view;
  fns.paintDock();
  assert.equal(painted[1].coder, "");
});
