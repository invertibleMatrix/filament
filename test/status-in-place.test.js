// @ts-check
// The chat's status drawn again as its state moves keeps the elements under the pointer (the owner's of 11-01: "when i
// hover over my mouse over some interactive elements like buttons then those are just suppose to highlight only once
// they quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have
// to press more than once"). The capsule's popover and the floating card were made anew at each word of the chat's state
// while they showed — an agent's progress, one more agent or command —: an agent's name and its Stop, a command's Stop,
// Open Agents and the card's own buttons new elements under a resting pointer, whose hover started over and where a
// press that began on the old one never clicked. Drawn in place (dom.js `morphChildren`), each part and row keyed by
// what it is, they are the elements that stood, their words and their handlers the newest draw's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/conversation/status-panel.js")} */
let sp;
const g = /** @type {any} */ (globalThis);
/** Where Appearance puts the status: under the message box, or floating over the chat. */
let place = "composer";
before(async () => {
  doc = stubDocument();
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.statusPanel" ? place : null), setItem() {}, removeItem() {} };
  // A menu listens for its keys on the window.
  g.window.addEventListener ||= () => {};
  g.window.removeEventListener ||= () => {};
  sp = await import("../src/ui/harness/conversation/status-panel.js");
});
after(() => {
  doc.restore();
  delete g.localStorage;
});

const T0 = Date.now() - 5_000;
/** A running sub-agent its main agent waits on. @param {string} id @param {string} said @param {object} [more] */
const agent = (id, said, more = {}) => ({ id, status: "running", description: said, exchanges: [{ description: said, startedAt: T0 }], model: "sonnet", origin: "agent", background: false, ...more });
/** A command running in the background. @param {string} id @param {string} line */
const command = (id, line) => ({ id, command: "npm test", cwd: "C:\\work\\app", startedAt: T0, agent: null, line, logPath: null });
const turn = { phase: "running", startedAt: T0, round: 1, error: "" };
/** What each press did. @type {string[]} */
const did = [];
/** @type {any} */
const io = {
  onOpenPlan() {},
  onGoal() {},
  onOpenSubagent: (/** @type {string} */ id) => did.push(`open ${id}`),
  onStopSubagent: (/** @type {string} */ id) => did.push(`stop ${id}`),
  onDetachSubagent: (/** @type {string} */ id) => did.push(`detach ${id}`),
  onStopCommand: (/** @type {string} */ id) => did.push(`command ${id}`),
  onOpenSide: () => did.push("side"),
};
/** A button by its words. @param {any} at @param {string} label @returns {any} */
const button = (at, label) => at?.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;
/** An agent's row, found by the words its name starts with, and the parts of it a pointer rests on. @param {any} at @param {string} words */
const agentRow = (at, words) => {
  const row = at.querySelectorAll(".sp-sub").find((/** @type {any} */ r) => r.querySelector(".sp-agent-name")?.textContent.startsWith(words)) || null;
  return { row, name: row?.querySelector(".sp-agent-name") || null, detach: button(row, "Run in background"), stop: button(row, "Stop") };
};
/** A command's row, and its Stop. @param {any} at @param {string} id */
const commandRow = (at, id) => {
  const row = at.querySelector(`[data-command="${id}"]`);
  return { row, stop: button(row, "Stop") };
};
/** Each part the very element it was. @param {Record<string, any>} now @param {Record<string, any>} was @param {string} what */
const same = (now, was, what) => {
  for (const k of Object.keys(was)) assert.equal(now[k], was[k], `${what}: its ${k}`);
};

// (fails before: yes — the popover was made anew at every word of the chat's state while it showed)
test("the capsule's popover drawn again as the chat's state moves keeps its rows and buttons, and a press acts on the one that stands", async () => {
  place = "composer";
  did.length = 0;
  const c = sp.createStatusCapsule(io);
  const el = /** @type {any} */ (c.el);
  c.set({ turn, subagents: [agent("s1", "Map the parser")], commands: [command("bg_1", "PASS 1 of 40")], cwd: "C:\\work\\app" });
  el.dispatch("click");
  const body = await until(() => doc.document.body.querySelector(".sc-pop"), "its popover");
  const s1 = agentRow(body, "Map the parser");
  const cmd = commandRow(body, "bg_1");
  const side = body.querySelector(".sc-side");
  assert.ok(s1.row && s1.name && s1.stop && s1.detach && cmd.stop && side, "an agent's row with its name, Run in background and Stop; a command's Stop; Open Agents");

  // One more agent starts and asks — listed first —, the first one's words move, a second command starts.
  c.set({
    turn,
    subagents: [agent("s1", "Map the parser and the lexer"), agent("s2", "Fix the lexer", { progress: { asking: { to: "you", n: 1, question: "Which file?" } } })],
    commands: [command("bg_1", "PASS 1 of 40"), command("bg_2", "")],
    cwd: "C:\\work\\app",
  });
  assert.equal(doc.document.body.querySelector(".sc-pop"), body, "the same popover");
  same(agentRow(body, "Map the parser"), s1, "the first agent's row, its name, Run in background and Stop the elements that stood");
  assert.equal(s1.name.textContent, "Map the parser and the lexer", "saying its newest words");
  same(commandRow(body, "bg_1"), cmd, "the first command's row and its Stop");
  assert.equal(body.querySelector(".sc-side"), side, "and Open Agents");
  assert.deepEqual(body.querySelectorAll(".sp-section .sp-sub").filter((/** @type {any} */ r) => !r.closest(".sp-command")).map((/** @type {any} */ r) => r.querySelector(".sp-agent-name").textContent), ["Fix the lexer", "Map the parser and the lexer"], "the one that asks first");
  assert.equal(agentRow(body, "Fix the lexer").row.classList.contains("tone-warn"), true);

  s1.stop.dispatch("click");
  s1.name.dispatch("click");
  cmd.stop.dispatch("click");
  agentRow(body, "Fix the lexer").stop.dispatch("click");
  assert.deepEqual(did, ["stop s1", "open s1", "command bg_1", "stop s2"], "each press acts on the one that stands, for its own row");

  // The first agent ends: its row goes, the second's stands.
  const s2 = agentRow(body, "Fix the lexer");
  c.set({ turn, subagents: [agent("s1", "Map the parser and the lexer", { status: "done" }), agent("s2", "Fix the lexer")], commands: [], cwd: "C:\\work\\app" });
  assert.equal(agentRow(body, "Map the parser").row, null, "an agent that ended leaves the agents at work");
  same(agentRow(body, "Fix the lexer"), s2, "the one at work stays the row it was");
  assert.equal(body.querySelector(".sp-commands"), null, "no command runs: their part goes");
  side.dispatch("click");
  assert.equal(did.at(-1), "side");
  assert.equal(doc.document.body.querySelector(".sc-pop"), null, "Open Agents closes the popover");
});

// (fails before: yes — the card was made anew at every word, its display menu's button with it)
test("the floating card drawn again keeps its rows, its Stops and its own buttons; its menu's button opens and closes the same menu", () => {
  place = "expanded";
  did.length = 0;
  const p = sp.createStatusPanel(io);
  const el = /** @type {any} */ (p.el);
  doc.document.body.append(el);
  try {
    p.set({ subagents: [agent("s1", "Map the parser")] });
    assert.equal(el.classList.contains("expanded"), true, "Always expanded: the card shows its rows");
    const s1 = agentRow(el, "Map the parser");
    const mode = el.querySelector(".sp-mode");
    const collapse = button(el, "Collapse");
    assert.ok(s1.row && s1.stop && mode && collapse);

    mode.dispatch("click");
    assert.equal(doc.document.body.querySelectorAll(".zc-menu").length, 1, "its menu opens");

    p.set({ subagents: [agent("s2", "Fix the lexer"), agent("s1", "Map the parser", { progress: { round: 3 } })] });
    same(agentRow(el, "Map the parser"), s1, "a row that moved down is the row that stood, its buttons with it");
    assert.equal(el.querySelector(".sp-mode"), mode, "the menu's button too");
    assert.equal(button(el, "Collapse"), collapse, "and Collapse");
    assert.deepEqual(el.querySelectorAll(".sp-sub").map((/** @type {any} */ r) => r.querySelector(".sp-agent-name").textContent), ["Fix the lexer", "Map the parser"]);

    mode.dispatch("click");
    assert.equal(doc.document.body.querySelectorAll(".zc-menu").length, 0, "a second press on the button that stands closes its menu");
    s1.stop.dispatch("click");
    assert.deepEqual(did, ["stop s1"]);
    collapse.dispatch("click");
    assert.equal(el.querySelector(".sp-sub"), null, "Collapse folds the card back to its capsule");
  } finally {
    el.remove();
    place = "composer";
  }
});
