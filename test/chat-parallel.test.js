// @ts-check
// Parallelize tasks for one chat (the owner's of 11-16: the card for sub-agents that change files offers "Always accept
// for this chat which would be just like Auto Approval without asking for the card"): the chat's own switch,
// `subagents.parallelize`, says whether its writing launches wait on the card, whether its graph's tasks start by
// themselves, and whether its agent is told the person's consent; unset, Settings › Experimental's switch says it for
// every chat. Switching it on is a press: it lets the agent do more unasked.
// (fails before: yes — the switch was Settings › Experimental's alone, for every chat)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { loopSystem } from "../src/app/agent/system.js";
import { KNOBS, PARALLEL_KNOB, asksLess } from "../src/services/session-settings.js";
import { startApp } from "./helpers/app.js";

describe("the chat's own Parallelize tasks", () => {
  test("its knob is the chat's alone, unset unless set, and switching it on or taking it back asks less", () => {
    const k = /** @type {any} */ (KNOBS)[PARALLEL_KNOB];
    assert.deepEqual([k.type, k.default, k.nullable, k.scope], ["bool", null, true, "session"]);
    assert.equal(asksLess({ patch: { subagents: { parallelize: true } } }), true, "on: the agent starts more unasked");
    assert.equal(asksLess({ patch: { subagents: { parallelize: false } } }), false, "off asks again");
    // Taken back, Settings › Experimental's switch says it, which may be on (the review of fe6b8d579).
    assert.equal(asksLess({ patch: { subagents: { parallelize: null } } }), true, "taken back: the switch's, perhaps on");
    assert.equal(asksLess({ unset: ["subagents.parallelize"] }), true);
    assert.equal(asksLess({ unset: ["subagents"] }), true, "the whole section taken back");
  });

  test("Filament's own agent is told the consent where the chat's switch, else Settings › Experimental's, is on", () => {
    const cfg = (/** @type {boolean} */ on) => ({ agentLoop: {}, experimental: { parallelizeTasks: on } });
    const of = (/** @type {boolean} */ global, /** @type {boolean | null} */ own) => loopSystem({ cfg: cfg(global), doc: { subagents: { parallelize: own } }, root: "R", graph: true }).prompt;
    assert.ok(of(false, true).includes(tg.PARALLEL_CONSENT), "the chat's on, the switch off");
    assert.ok(of(true, null).includes(tg.PARALLEL_CONSENT), "unset: the switch's");
    assert.ok(of(false, null).includes(PROMPT.parallelOff));
    assert.ok(of(true, false).includes(PROMPT.parallelOff), "the chat's off, the switch on");
  });
});

describe("a chat's switch on the server", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const dir = mkdtempSync(join(tmpdir(), "filament-chat-parallel-"));
  before(async () => {
    shim = await startApp({ memory: true, overrides: { holdWriters: true } });
  });
  after(async () => {
    await shim?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the server holds its writing launches, and lets its graph's go, by its own switch; another chat's by its own", () => {
    const app = /** @type {any} */ (shim.app);
    const mine = app.sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
    const other = app.sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
    assert.deepEqual([app.parallelFor(mine), app.holdsWriters(mine)], [false, true], "Settings › Experimental's switch is off");
    app.sessions.patchSettings(mine, { patch: { subagents: { parallelize: true } } });
    assert.deepEqual([app.parallelFor(mine), app.holdsWriters(mine)], [true, false], "Always accept in this chat");
    assert.deepEqual([app.parallelFor(other), app.holdsWriters(other)], [false, true], "another chat asks still");
    app.sessions.patchSettings(mine, { unset: ["subagents.parallelize"] });
    assert.deepEqual([app.parallelFor(mine), app.holdsWriters(mine)], [false, true], "taken back: it asks again");
    assert.equal(app.parallelFor("no-such-chat"), false, "a chat Filament does not hold: the switch's");
  });

  // (fails before: yes — the route took accept or decline alone)
  test("the card's always accepts it and switches the chat's own on; a card answered already switches nothing", async () => {
    const app = /** @type {any} */ (shim.app);
    const chat = app.sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
    const card = (/** @type {string} */ description) =>
      app.subagents.holdTask(chat, { runId: `run-${description}`, view: { description, kind: "builder", model: "m", where: "copy", declines: "" }, start: () => [`sa_${description}`] });
    const first = card("one");
    const answer = (/** @type {string} */ id, /** @type {string} */ said) => shim.api(`/api/sessions/${chat}/held-launches/${id}`, { method: "POST", body: { answer: said } });
    await app.subagents.answerHeld(chat, first.id, "accept");
    const late = await answer(first.id, "always");
    assert.equal(late.status, 409, "answered already");
    assert.equal(app.parallelFor(chat), false, "and nothing switched");
    const second = card("two");
    const r = await answer(second.id, "always");
    assert.equal(r.status, 200, await r.clone().text());
    const { hold } = await r.json();
    assert.deepEqual([hold.state, hold.always, hold.started], ["accepted", true, ["sa_two"]]);
    assert.deepEqual([app.parallelFor(chat), app.holdsWriters(chat)], [true, false], "no card asks in this chat again");
    assert.equal((await answer("hl_none", "maybe")).status, 400);
  });

  // (fails before: yes — the review of this change: the switch was written once the card's launches had started, so a
  // launch its agent made meanwhile waited on a card of its own)
  test("always writes the chat's switch before its launches start; a card it does not name switches nothing", async () => {
    const app = /** @type {any} */ (shim.app);
    const chat = app.sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
    /** @type {boolean[]} */
    const seen = [];
    const card = app.subagents.holdTask(chat, { runId: "run-x", view: { description: "x", kind: "builder", model: "m", where: "copy", declines: "" }, start: () => (seen.push(app.holdsWriters(chat)), ["sa_x"]) });
    const answer = (/** @type {string} */ id) => shim.api(`/api/sessions/${chat}/held-launches/${id}`, { method: "POST", body: { answer: "always" } });
    assert.equal((await answer("hl_none")).status, 409);
    assert.equal(app.parallelFor(chat), false, "no such card: nothing switched");
    const r = await answer(card.id);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(seen, [false], "as its launch started, no card would hold another");
  });
});
