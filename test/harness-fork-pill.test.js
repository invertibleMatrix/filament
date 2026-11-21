// @ts-check
// The owner's 10-26: a chat forked from one whose turn the page runs showed its source's "Working · step 42" in the
// header — there for a few seconds, gone, back again. Each frame of the running turn refreshes its own chat's status
// (`drawRun` → `refreshStatus` → `paintStatus`), and the header's capsule is the open chat's: the source's paint landed
// on the fork, and the fork's own next paint took it away. The header's status now paints only the open chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { turnNow } from "../src/ui/harness/lib/overview.js";
import { waitingOn } from "../src/ui/harness/conversation/waiting-on.js";
import * as history from "../src/ui/harness/conversation/history.js";

const src = readFileSync("src/ui/harness/app.js", "utf8");

/** The page's paintStatus, lifted out and run against stubs: what the capsule and the panel were given. */
function painter(/** @type {Map<string, any>} */ chats, /** @type {{ currentId: string | null }} */ at) {
  const start = src.indexOf("function paintStatus(chat) {");
  assert.ok(start > 0, "found paintStatus");
  const body = src.slice(start, src.indexOf("\n}\n", start) + 2);
  /** @type {any[]} */
  const painted = [];
  const state = { ...at, terminals: [], compacting: new Map(), commands: new Map(), comeBacks: new Map(), idleWakes: new Map() };
  const sink = { set: (/** @type {any} */ m) => painted.push(m) };
  /** What the waiting line after the last turn was handed (conversation/waiting-on.js). @type {any[]} */
  const waits = [];
  const paint = new Function(
    "chatOf", "state", "planOf", "agentOf", "coderNameOf", "subagentStore", "turnNow", "statusPanel", "statusCapsule", "subagentName", "transcript", "waitingOn", "stopCommand", "unsent",
    `${body}\nreturn paintStatus;`,
  )(
    (/** @type {string | null} */ id) => (id ? chats.get(id) || null : null), state, () => ({ plan: [] }), () => null, () => "",
    { rows: () => [], queued: () => 0 }, turnNow, sink, sink, () => "", { waitingOn: (/** @type {any} */ w) => waits.push(w) }, waitingOn, () => {}, history.unsent,
  );
  return { paint, painted, state, waits };
}

/** A chat whose page-run turn is at its 42nd step. @type {any} */
const source = { id: "c-src", chainId: "s-src", turns: [], live: { startedAt: 1, turn: { n: 5, aligned: { maxRound: 42, byRound: new Map() } } } };
/** Its fork, idle. @type {any} */
const fork = { id: "c-fork", chainId: "s-fork", turns: [{ n: 1, facts: { startedAt: 1, endedAt: 2 }, toolLegs: 0 }], live: null };

// (fails before: yes — the source's frame painted "running, step 42" onto the fork's header)
test("a frame of a turn in another chat paints nothing on the open chat's header", () => {
  const { paint, painted } = painter(new Map([[source.id, source], [fork.id, fork]]), { currentId: fork.id });
  paint(source);
  assert.equal(painted.length, 0, "the source's turn is not the open chat's");
  paint(fork);
  assert.equal(painted.length, 2, "the open chat paints the panel and the capsule");
  assert.deepEqual(painted.map((m) => m.turn.phase), ["ended", "ended"]);
});

// (fails before: yes — the owner's of 10-29: a turn that ended on "the suite is still running" read as done)
test("the open chat's turn over, its agent's command still running: the waiting line is handed it; nothing running, none", () => {
  const { paint, state, waits } = painter(new Map([[fork.id, fork]]), { currentId: fork.id });
  paint(fork);
  state.commands.set("s-fork", [{ id: "bg_1", command: "npm test", startedAt: 1, agent: null, cwd: "", line: "", logPath: null }]);
  paint(fork);
  assert.deepEqual(waits, [null, { commands: [{ id: "bg_1", command: "npm test", startedAt: 1 }], agents: 0, comeBack: null, stopped: false }]);
  fork.turns.push({ n: 2, facts: { startedAt: 3, endedAt: 4 }, toolLegs: 0, status: "stopped" });
  paint(fork);
  assert.equal(waits.at(-1)?.stopped, true, "the person stopped the newest turn: nothing wakes the chat");
  fork.turns.pop();
});

test("the open chat's own running turn still paints its step", () => {
  const { paint, painted } = painter(new Map([[source.id, source], [fork.id, fork]]), { currentId: source.id });
  paint(source);
  assert.deepEqual(painted.map((m) => [m.turn.phase, m.turn.round]), [["running", 42], ["running", 42]]);
});

test("with no chat open, the status paints empty", () => {
  const { paint, painted } = painter(new Map(), { currentId: null });
  paint(null);
  assert.deepEqual(painted.map((m) => m.turn), [null, null]);
});

test("a turn's frames refresh their own chat's status, which the paint now keeps to the open chat", () => {
  const draw = src.slice(src.indexOf("const drawRun = (landed) => {"), src.indexOf("const runDraw = createRunDraw(drawRun);"));
  assert.match(draw, /refreshStatus\(chat\);/);
  const refresh = src.slice(src.indexOf("function refreshStatus(chat) {"), src.indexOf("async function loadTerminals()"));
  assert.match(refresh, /paintStatus\(chat\);/);
});
