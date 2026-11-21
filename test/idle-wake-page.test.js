// @ts-check
// The idle wake on the page (app/sessions/idle-wake.js, the owner's of 11-08): while it is due, Now's row and the
// status say when Filament checks in, and the popover says what happens then; the turn it sends is said as Filament's
// check-in on a command that ran on — not a command's end —; its minutes are a row of Settings › Agent loop.
// (fails before: yes — nothing on the page said the check-in, and its turn was said as "a background command ended")
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idleText } from "../src/app/sessions/idle-wake.js";
import { IDLE_TOLD, IDLE_WOKE_WORDS, WOKE_WORDS, messageTimeLabel, wokeWords } from "../src/ui/harness/lib/labels.js";
import { idleWakeFact, idleWakeRow } from "../src/ui/harness/lib/come-back.js";
import { nowRows } from "../src/ui/harness/lib/now.js";
import { capsuleWords } from "../src/ui/harness/conversation/status-panel.js";
import { deliveredWords, wokeLine } from "../src/ui/harness/conversation/turn.js";
import { SEARCH_ROWS } from "../src/ui/harness/settings/agent-loop.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";

const AT = new Date(new Date().setHours(14, 32, 0, 0)).getTime();
const NOW = AT - 4 * 60_000;
const CLOCK = messageTimeLabel(AT);
const cmd = { id: "bg_1", command: "npm test", startedAt: NOW - 8 * 60_000 };
const wake = { at: AT, commands: [cmd] };

test("its words: when, and what happens then", () => {
  assert.equal(idleWakeFact(wake), `checks in at ${CLOCK}`);
  const row = idleWakeRow(wake, NOW);
  assert.deepEqual([row.at, row.left, row.words], [`at ${CLOCK}`, "in 4 min · if it still runs and nothing else came", "Filament asks the agent about its command"]);
  const two = idleWakeRow({ at: AT, commands: [cmd, { ...cmd, id: "bg_2" }] }, NOW);
  assert.deepEqual([two.left, two.words], ["in 4 min · if they still run and nothing else came", "Filament asks the agent about its 2 commands"]);
  assert.match(row.title, /Settings › Agent loop/);
});

test("Now: the chat's Working row says when Filament checks in, beside its command", () => {
  const run = { id: "r-w1", kind: "agent-turn", status: "done", startedAt: NOW - 600_000, endedAt: NOW - 60_000, meta: { chain: "w1", model: "m-1" } };
  const g = nowRows({
    runs: [run], folds: new Map(), threads: new Map(), unread: new Set(), holders: new Map(), now: NOW,
    commands: new Map([["w1", [{ ...cmd, cwd: "C:\\work", agent: null, line: "", logPath: null }]]]), idleWakes: new Map([["w1", wake]]),
    chats: (c) => ({ title: `chat ${c}`, project: "p", when: NOW - 60_000, unread: false }),
  });
  assert.equal(g.works.find((r) => r.chain === "w1")?.fact, `1 command running: npm test · checks in at ${CLOCK}`);
});

test("the capsule: its title says when Filament checks in while the command works on", () => {
  const S = { turn: { phase: "ended", startedAt: null, round: 0, error: "" }, compacting: null, working: 0, asking: 0, tasks: 0, now: NOW };
  assert.deepEqual(capsuleWords({ ...S, commands: 1, idleWake: wake }), { state: "working", lead: "Working", more: "1 command", title: `The turn is over; 1 command still at work · Filament checks in at ${CLOCK} if nothing else comes` });
  assert.equal(capsuleWords({ ...S, commands: 1 }).title, "The turn is over; 1 command still at work");
});

test("the turn it sends: Filament's check-in, said for you, amber; on the message's row, no command's end", () => {
  const told = idleText([cmd], { idleMin: 5, nextMin: 10, now: NOW });
  assert.ok(IDLE_TOLD.test(told), "the page reads the words the server writes");
  assert.ok(IDLE_TOLD.test(idleText([cmd, { ...cmd, id: "bg_2" }], { idleMin: 20, nextMin: 40, now: NOW })), "several commands too");
  // A check-in kept from before d-send's follow-up said "Nothing else came meanwhile.": it reads as one still.
  assert.ok(IDLE_TOLD.test("[Filament: 5 min since your turn ended, your background command still runs with no end: `npm test` (bg_1, running 8 min). Nothing else came meanwhile. If it keeps running, Filament checks in again in 10 min.]"), "a check-in kept from before");
  assert.equal(wokeWords([told]), IDLE_WOKE_WORDS);
  assert.equal(wokeWords([told, "[Filament: background shell bg_1 (npm test) exited with code 0.]"]), "Filament went on by itself — what the agent waited on came", "with an end: what it waited on came");
  assert.equal(wokeWords(["[Filament: background shell bg_1 (npm test) exited with code 0.]"]), WOKE_WORDS);
  assert.deepEqual(wokeLine(told), { tone: "warn", words: "Idle 5 min while `npm test` (bg_1, running 8 min) ran on — the next check-in in 10 min if it still runs", title: "" });
  assert.equal(deliveredWords({ deliveries: 1, shellExits: 1, shellIdle: 1 }), "with Filament's check-in on a running command");
  assert.equal(deliveredWords({ deliveries: 2, shellExits: 2, shellIdle: 1 }), "with 1 background shell exit and Filament's check-in on a running command");
});

test("its minutes: a row of Settings › Agent loop, found by search, 5 by default", () => {
  assert.ok(SEARCH_ROWS.some((r) => "path" in r && r.path === "sessions.idleWakeMinutes"));
  assert.equal(/** @type {any} */ (CONFIG_SCHEMA.sessions).idleWakeMinutes.default, 5);
});

// (fails before: yes — d-send's follow-up: the row said a letter cancels the check-in, where one that woke no turn waits
// sealed beside it (wake.js `IDLE_BESIDE_WAKE_LINE`), and "Not kept across a restart", where the chat keeps its timer
// (owed-wakes.js) and the agent is told its commands ended with the Filament that stopped)
test("its row says what cancels it, what waits beside it, and that a restart keeps it; docs/PARAMETERS.md has the same row", () => {
  const effect = String(/** @type {any} */ (CONFIG_SCHEMA.sessions).idleWakeMinutes.effect);
  assert.ok(effect.includes(" Anything that starts a turn first cancels it: the command's end, your message, a report, a letter or a come-back. One of those that waits with no turn come for it yet — a letter still sealed, a report not told — puts the check-in off twice, then goes with it. A chat you stopped or archived, or with a question waiting, is not woken. "), effect);
  assert.ok(effect.endsWith(" Kept across a restart: the commands it watched ended with the Filament that stopped, and the agent is told that instead."), effect);
  assert.doesNotMatch(effect, /Only where nothing else came first|Not kept across a restart|never woken/);
  const row = readFileSync(new URL("../docs/PARAMETERS.md", import.meta.url), "utf8").split(/\r?\n/).find((l) => l.startsWith("| `sessions.idleWakeMinutes` |"));
  assert.ok(row?.endsWith(`| ${effect} |`), row);
});
