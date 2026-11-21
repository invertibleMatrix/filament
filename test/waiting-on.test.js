// @ts-check
// The line after a chat's last turn while its work goes on without a turn (conversation/waiting-on.js; the owner's of
// 10-29: a turn that ended on "the suite is still running" read as done — "it has become a really confusion for me
// thinking if agent has finished it's work or not").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { waitingOn, waitingOnRow, waitingOnWords } from "../src/ui/harness/conversation/waiting-on.js";
import { comeBackClock } from "../src/ui/harness/lib/come-back.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const NOW = 1_800_000_000_000;
/** @param {string} id @param {string} command @param {number} ago @param {string | null} [agent] */
const cmd = (id, command, ago, agent = null) => ({ id, command, startedAt: NOW - ago, agent, cwd: "", line: "", logPath: null });
const BACK = { at: NOW + 3_600_000, note: "look at the deploy", setAt: NOW };
/** @param {Record<string, any>} [o] */
const at = (o = {}) => ({ phase: "ended", compacting: false, commands: [cmd("bg_1", "npm test", 130_000)], agents: 0, comeBack: null, stopped: false, ...o });

// (fails before: yes — nothing said it: the module did not exist)
test("the line stands while the turn is over and what its agent waits on still runs, and only then", () => {
  assert.deepEqual(waitingOn(at()), { commands: [{ id: "bg_1", command: "npm test", startedAt: NOW - 130_000 }], agents: 0, comeBack: null, stopped: false });
  for (const phase of ["running", "asks", "none"]) assert.equal(waitingOn(at({ phase })), null, `${phase}: the live line says it, or there is no turn`);
  assert.ok(waitingOn(at({ phase: "failed" })), "a turn that failed with a command running still has it running");
  assert.equal(waitingOn(at({ compacting: true })), null, "the Compacting row stands there");
  assert.equal(waitingOn(at({ commands: [] })), null, "nothing runs: the chat is done");
  assert.equal(waitingOn(at({ commands: [cmd("bg_2", "npm run lint", 5000, "sa_1")] })), null, "a sub-agent's command is that agent's work");
  assert.equal(waitingOn(at({ commands: [], agents: 2 }))?.agents, 2, "its agents at work: their reports wake the chat");
  // @ts-ignore — a come-back as the page holds it
  assert.ok(waitingOn(at({ commands: [], comeBack: BACK })), "the time it set to come back");
});

test("its words: what runs and how long, and that the chat goes on by itself — or, after a Stop, that the next message tells", () => {
  const one = waitingOnWords(/** @type {any} */ (waitingOn(at())), NOW);
  assert.deepEqual([one.lead, one.what, one.then, one.title], ["Not done yet", "waiting on npm test · 2m", "The chat goes on here by itself when it ends.", "npm test"]);
  const many = waitingOnWords(/** @type {any} */ (waitingOn(at({ commands: [cmd("bg_1", "npm test", 130_000), cmd("bg_2", "npm run build", 400_000)], agents: 1 }))), NOW);
  assert.deepEqual([many.what, many.then], ["waiting on 2 commands · the oldest 7m · 1 agent at work", "The chat goes on here by itself as each ends."]);
  const agents = waitingOnWords(/** @type {any} */ (waitingOn(at({ commands: [], agents: 2 }))), NOW);
  assert.equal(agents.what, "waiting on 2 agents at work");
  const clock = comeBackClock(/** @type {any} */ (BACK));
  const back = waitingOnWords(/** @type {any} */ (waitingOn(at({ commands: [], comeBack: BACK }))), NOW);
  assert.deepEqual([back.lead, back.what, back.then], ["Not done yet", `back at ${clock}`, "The chat goes on here by itself then, with the agent's note."]);
  const beside = waitingOnWords(/** @type {any} */ (waitingOn(at({ comeBack: BACK }))), NOW);
  assert.equal(beside.then, `The chat goes on here by itself when it ends. It also comes back at ${clock}.`);
  const stopped = waitingOnWords(/** @type {any} */ (waitingOn(at({ stopped: true }))), NOW);
  assert.deepEqual([stopped.lead, stopped.what, stopped.then], ["Still running", "npm test · 2m", "You stopped the turn: your next message tells the agent how it ended."], "after a Stop nothing wakes the chat (FO-D50)");
  assert.equal(waitingOnWords(/** @type {any} */ (waitingOn(at({ commands: [cmd("bg_1", "x".repeat(200), 0)] }))), NOW).what.length, "waiting on ".length + 80 + " · 0s".length, "the command cut to its room, whole on hover");
});

test("the row: its words, its clock moving, and Stop where one command of the chat's own runs alone", () => {
  /** @type {[string, string][]} */
  const stops = [];
  const row = waitingOnRow({ h: fakeH, onStop: (id, command) => stops.push([id, command]) });
  row.set(/** @type {any} */ (waitingOn(at())), NOW);
  assert.equal(textOf(row.el), "Not done yet| · waiting on npm test · 2m.| |The chat goes on here by itself when it ends.|Stop");
  assert.equal(row.el.attrs.role, "status");
  row.tick(NOW + 120_000);
  assert.match(textOf(row.el), /npm test · 4m\./, "its clock moves");
  const [stop] = buttonsOf(row.el);
  assert.equal(stop.classList.contains("hidden"), false);
  stop.dispatch("click");
  assert.deepEqual(stops, [["bg_1", "npm test"]]);
  row.set(/** @type {any} */ (waitingOn(at({ agents: 1 }))), NOW);
  assert.equal(stop.classList.contains("hidden"), true, "with an agent at work too, Stop is the status's, command by command");
  assert.equal(buttonsOf(waitingOnRow({ h: fakeH }).el)[0].classList.contains("hidden"), true, "no stop given: none shown");
});

test("the page says it after the last turn, from the status's facts, and takes it away", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const paint = app.slice(app.indexOf("function paintStatus("), app.indexOf("function refreshStatus("));
  assert.match(paint, /transcript\.waitingOn\(chat\?\.chainId \? waitingOn\(\{\s+phase: model\.turn\?\.phase \|\| "none",\s+compacting: !!model\.compacting,\s+commands: model\.commands \|\| \[\],/);
  assert.match(paint, /stopped: newest\?\.status === "stopped" \|\| !!newest\?\.stopped,/, "a Stop, live or read from the session");
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /const tail = h\("div", \{ class: "transcript-tail" \}, liveLine\.el, compactSlot, waitSlot\);/);
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\.transcript-tail:has\(> \.turn-live\.hidden\):has\(> \.transcript-compacting:empty\):has\(> \.transcript-waiting:empty\) \{ display: none; \}/, "the tail shows while the line does");
});
