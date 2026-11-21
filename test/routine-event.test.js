// @ts-check
// A routine or a watcher an agent proposes is proposed in its chat (the owner's of 11-12: "the watcher that is proposed
// inside the Space is a bad design, watcher should always be proposed right in the chat"): the call that proposed or
// changed it names it — its project, its id, which kind, whether it was a change, and the `at` its sheet is read by —
// on the run, under the call's id and round, for Filament's own loop and for a coding agent's call alike, and the page
// keeps it with its round, so the card under the call knows what to draw.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSpaceStore } from "../src/services/spaces.js";
import { spaceRun } from "../src/app/agent/space.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { RUN_EVENT_FIELDS, RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";

const NAMES = /** @type {Record<string, string>} */ ({ c1: "Release", c2: "Deploy fixer" });
const WATCHER = { title: "Main moved", trigger: { kind: "commit", branch: "main" }, wakes: "you", text: "Main has new commits." };
const ROUTINE = { title: "Morning brief", when: "weekdays 09:00", text: "Read the open PRs; say what needs the person." };
const call = (/** @type {Record<string, any>} */ w) => ({ action: "routine", with: w });

function worldOf() {
  const clock = { at: new Date(2026, 10, 12, 9).getTime() };
  const spaces = createSpaceStore({ dir: null, now: () => clock.at });
  /** Where chat c2's call stands. @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (o = {}) => ({ store: spaces, project: "p1", chain: "c2", name: null, nameOf: (c) => NAMES[c] || c, on: () => true, routines: { runNow: async () => "", arm: () => {} }, runOf: () => null, ...o });
  return { clock, spaces, atOf };
}

describe("the call names its routine", () => {
  // (fails before: yes — the answer was words alone)
  test("a watcher proposed, then changed; a routine at times; a refusal, a pause and guidance name none", async () => {
    const w = worldOf();
    const made = /** @type {any} */ (await spaceRun(call(WATCHER), w.atOf()));
    assert.equal(made.ok, true, made.error);
    const r = w.spaces.get("p1").routines[0];
    assert.deepEqual(made.event, { type: "routine", project: "p1", routine: r.id, watcher: true, change: false, at: r.at });
    w.clock.at += 60_000;
    const changed = /** @type {any} */ (await spaceRun(call({ id: r.id, title: "Main moved again" }), w.atOf()));
    assert.equal(changed.ok, true, changed.error);
    const after = w.spaces.get("p1").routines[0];
    assert.ok(after.at > r.at, "a change moves its at");
    assert.deepEqual(changed.event, { type: "routine", project: "p1", routine: r.id, watcher: true, change: true, at: after.at });
    const timed = /** @type {any} */ (await spaceRun(call(ROUTINE), w.atOf()));
    const r2 = w.spaces.get("p1").routines[1];
    assert.deepEqual(timed.event, { type: "routine", project: "p1", routine: r2.id, watcher: false, change: false, at: r2.at });
    const refused = /** @type {any} */ (await spaceRun(call({ ...WATCHER, title: "" }), w.atOf()));
    assert.deepEqual([refused.ok, refused.event], [false, undefined]);
    w.spaces.routineOn("p1", r2.id);
    const paused = /** @type {any} */ (await spaceRun(call({ id: r2.id, pause: "CI is red" }), w.atOf()));
    assert.deepEqual([paused.ok, paused.event], [true, undefined], paused.error);
  });
});

/** A turn whose model calls the space tool once with `input`, then ends. @param {ReturnType<typeof worldOf>} w @param {any} input */
const turn = (w, input) => {
  let n = 0;
  /** @type {any[]} */
  const events = [];
  const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const run = runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "watch main" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => (++n === 1 ? reply([{ type: "tool_use", id: "a1", name: "space", input }]) : reply([{ type: "text", text: "Done." }])),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    previewChars: 0,
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } },
    signal: null,
    resume: null,
    space: w.atOf(),
  }));
  return { run, events };
};

describe("said on the run under the call", () => {
  // (fails before: yes — the loop said nothing of it)
  test("Filament's own loop: the event rides the call's id and round", async () => {
    const w = worldOf();
    const { run, events } = turn(w, call(WATCHER));
    assert.equal(/** @type {any} */ (await run).status, "done");
    const r = w.spaces.get("p1").routines[0];
    const start = events.find((e) => e.type === "tool-start" && e.id === "a1");
    assert.deepEqual(events.filter((e) => e.type === "routine"), [{ type: "routine", project: "p1", routine: r.id, watcher: true, change: false, at: r.at, round: start.round, id: "a1" }]);
  });

  // (fails before: yes — a coding agent's call said nothing of it)
  test("a coding agent's call: under its own call where Filament finds it, without where it does not; a refusal says none", async () => {
    const w = worldOf();
    const tools = createAgentTools(/** @type {any} */ ({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store: w.spaces, projectOf: () => "p1", nameOf: (/** @type {string} */ c) => NAMES[c] || c, on: () => true, routines: { runNow: async () => "", arm: () => {} }, runOf: () => null },
    }));
    /** @type {any[]} */
    const said = [];
    /** @type {string[]} */
    const asked = [];
    const ctx = { cwd: "/r", chain: "c2", permit: null, emit: (/** @type {any} */ e) => said.push(e), callOf: async (/** @type {string} */ name) => (asked.push(name), { id: "toolu_7", round: 4 }) };
    const ok = await tools.call("space", call(WATCHER), /** @type {any} */ (ctx));
    assert.equal(ok.isError, undefined, ok.text);
    const r = w.spaces.get("p1").routines[0];
    assert.deepEqual(asked, ["space"]);
    assert.deepEqual(said, [{ type: "routine", project: "p1", routine: r.id, watcher: true, change: false, at: r.at, id: "toolu_7", round: 4 }]);
    said.length = 0;
    await tools.call("space", call(ROUTINE), /** @type {any} */ ({ ...ctx, callOf: null }));
    const r2 = w.spaces.get("p1").routines[1];
    assert.deepEqual(said, [{ type: "routine", project: "p1", routine: r2.id, watcher: false, change: false, at: r2.at }], "no call of the agent's found: no id or round");
    said.length = 0;
    const no = await tools.call("space", call({ ...WATCHER, title: "" }), /** @type {any} */ (ctx));
    assert.equal(no.isError, true);
    const read = await tools.call("space", { action: "read" }, /** @type {any} */ (ctx));
    assert.equal(read.isError, undefined, read.text);
    assert.deepEqual(said, [], "only a routine proposed or changed is said");
  });

  // (fails before: yes — the run's switch had no such event, and the registry named none)
  test("a coding agent's run publishes it in the call's round; the registry describes it; the page keeps it with its round", () => {
    assert.ok(RUN_EVENT_TYPE_LIST.includes("routine"));
    assert.match(RUN_EVENT_FIELDS.routine, /^round, id\?, project, routine, watcher, change, at — agent: /);
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "routine", id: "toolu_7", round: 2, project: "p1", routine: "r3", watcher: true, change: false, at: 5 });
    run.take({ type: "routine", round: null, project: "p1", routine: "r4", watcher: false, change: true, at: 6 });
    assert.deepEqual(events.filter((e) => e.type === "routine"), [
      { type: "routine", round: 2, id: "toolu_7", project: "p1", routine: "r3", watcher: true, change: false, at: 5 },
      { type: "routine", round: 1, project: "p1", routine: "r4", watcher: false, change: true, at: 6 },
    ]);
    const { byRound } = alignEvents([
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "a1", name: "space", card: { kind: "space", title: "Propose a watcher", subject: "Main moved" } },
      { type: "tool-end", round: 1, id: "a1", ok: true, preview: "Watcher r3 \"Main moved\" waits…" },
      { type: "routine", round: 1, id: "a1", project: "p1", routine: "r3", watcher: true, change: false, at: 5 },
      { type: "routine", round: 1, id: "a1", project: "p1", routine: "r3", watcher: true, change: false, at: 5 },
    ]);
    assert.deepEqual(byRound.get(1).tools.get("a1").routine, { project: "p1", routine: "r3", watcher: true, change: false, at: 5 }, "on the call, which its row reads, said twice or not");
  });
});
