// @ts-check
// HarnessV4_Background_Plan (E34): a coding agent's long command in the background. Filament runs it, the agent goes on
// working, and the end comes back whole — into the running turn through the registry's door, never sealed, drawn as the
// shells' row; with no turn to take it, told as a shell's exit is, with the chat's next turn and the chat woken.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_COMMAND, BACKGROUND_COMMAND_TOOL, TAIL_CHARS, createBackgroundCommands, endText, runningRecord, stopByPerson, tailOf, tellStoppedCommands, tookWords } from "../src/app/agent/commands.js";
import { comeBackLater, comeBackOf, disposeBackgroundShells, disposeSpills, endChatShells, onShellWake, peekShellExits, runningShellsOf, tellLater, tellShellExits } from "../src/adapters/tools/hands.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { createLeadTurn } from "../src/app/agent-lead.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { CODER_WAIT_TOOL } from "../src/app/agent/tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { until } from "./helpers/wait.js";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});
const root = tmpdir();
/** A node one-liner, as the shell runs it. @param {string} js */
const node = (js) => `node -e "${js}"`;
const idOf = (/** @type {string} */ text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];
const allow = async () => ({ asked: false });
/** A call of the tool in chat `chain`. @param {any} commands @param {any} args @param {string} [chain] */
const call = (commands, args, chain = "c1") => commands.call(args, { chain, cwd: root, permit: allow });
/** The registry's door as a fake: what it was handed, and whether a turn takes it. @param {boolean} ok */
const fakeRegistry = (ok) => {
  /** @type {any[]} */
  const ends = [];
  return { ends, registry: { commandEnd: (/** @type {string} */ chain, /** @type {any} */ r) => (ends.push({ chain, ...r }), { ok }) } };
};
/** A registry with no sub-agents of its own, as the envelopes' tests make one. @param {string} [envelopes] */
const made = (envelopes) =>
  createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }], ...(envelopes ? { envelopes } : {}) }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
    },
    call: async () => {
      throw new Error("no launch here");
    },
  });

// (fails before: yes — Filament had no such tool for a coding agent)
test("the tool's words: any command that can take more than a minute; its result back whole, never an envelope — listed whole where the envelope tool is", () => {
  const d = BACKGROUND_COMMAND_TOOL.description;
  assert.match(d, /^Run a command that can take more than a minute \(a test suite, a build, an install, a long script\) in the background/);
  assert.match(d, /its result comes back to you whole/);
  assert.match(d, /beside the result of your next tool call while your turn runs, or as a message from Filament once your turn has ended/);
  assert.match(d, /instead of in the foreground or with your own shell's background option/);
  assert.doesNotMatch(d, /envelope/i);
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, commands: createBackgroundCommands() });
  const at = (/** @type {any} */ ctx) => tools.list({ cwd: root, upstream: "u", turn: null, graph: false, ...ctx }).find((t) => t.name === BACKGROUND_COMMAND) || null;
  assert.equal(at({ chain: "c1", launch: true })?.upfront, true, "a plain chat's agent, loaded whole");
  assert.ok(at({ chain: "c1", team: true }), "a team's lead");
  assert.equal(at({ chain: "c1" }), null, "a session given no envelope tool (a sub-agent's) has no turn for its end");
  assert.equal(at({ chain: null, launch: true }), null);
  assert.ok(tools.has(BACKGROUND_COMMAND));
  assert.match(serverInstructions({ launch: true, cwd: root }), /Its `background_command` runs any command that can take more than a minute/);
  assert.doesNotMatch(serverInstructions({ cwd: root }), /background_command/);
});

// (fails before: yes — no command of a coding agent's ran past its call)
test("an end while the turn runs goes into it whole, through the registry's door: its code, how long it ran, its output", async () => {
  const { ends, registry } = fakeRegistry(true);
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
  const r = await call(commands, { command: node("setTimeout(()=>{console.log('all 12 passed');process.exit(3)},700)") });
  const id = idOf(r.text);
  assert.match(r.text, new RegExp(`^Started background command ${id}: \`node -e .+\`, in .+\\. Go on with your work: when it ends, its result reaches you whole`), r.text);
  assert.match(r.text, new RegExp(`Its output so far: background_command\\(\\{ id: "${id}" \\}\\)\\. Stop it: background_command\\(\\{ id: "${id}", stop: true \\}\\)\\.`));
  assert.equal(ends.length, 0, "nothing yet: it runs");
  await until(() => (ends.length ? true : null), "its end", { timeoutMs: 15_000 });
  const [end] = ends;
  assert.deepEqual([end.chain, end.id, end.code], ["c1", id, 3]);
  assert.match(end.command, /^node -e /);
  assert.match(end.text, new RegExp(`^\\[Filament: your background command ${id} ended — \`node -e .+\` exited with code 3 after \\d+ s\\.\\]\\nIts output:\\nall 12 passed$`), end.text);
  assert.equal(typeof end.back, "function", "with its way back, for a turn that ends before it reads it");
  assert.deepEqual(peekShellExits({ session: "c1", agent: null }), [], "never told a second time as a shell's exit");
});

// (fails before: yes — BG-D4: with no turn, nothing told the chat)
test("with no turn to take it, it is told as a shell's exit is: with the chat's next turn, in its own words, and the chat woken", async () => {
  const { ends, registry } = fakeRegistry(false);
  /** @type {string[]} */
  const woken = [];
  const stop = onShellWake((s) => woken.push(s));
  try {
    const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
    const id = idOf((await call(commands, { command: node("setTimeout(()=>{console.log('done');process.exit(0)},600)") }, "c2")).text);
    const owner = { session: "c2", agent: null };
    const [x] = /** @type {import("../src/adapters/tools/hands.js").ShellExit[]} */ (await until(() => (peekShellExits(owner).length ? peekShellExits(owner) : null), "the end, untold", { timeoutMs: 15_000 }));
    assert.equal(ends.length, 1, "the door was asked first");
    assert.equal(x.id, id);
    assert.equal(x.text, ends[0].text, "the words the turn would have read, whole");
    assert.match(x.text, /exited with code 0 after \d+ s\.\]\nIts output:\ndone$/);
    assert.deepEqual(woken, ["c2"], "no turn of its agent runs: the chat is woken");
    tellShellExits(owner, [id]);
  } finally {
    stop();
  }
});

// (fails before: yes — the registry had no way in for a command's end)
test("the registry: into the running turn whole even where the session takes results sealed, drawn as the shells' row; a turn that ends before it reads it hands it back", async () => {
  const registry = made("sealed");
  assert.deepEqual(registry.commandEnd("c3", { id: "bg_x", command: "npm test", code: 1, text: "[Filament: your background command bg_x ended …]" }), { ok: false }, "no turn reads the session's inbox");
  /** @type {any[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  const door = registry.openTurn({ chainId: "c3", runId: "turn-1", cwd: root, mode: null, model: "coder-1", thinking: null, fork: null, emit: (e) => events.push(e), round: () => 3 });
  const turn = createLaunchTurn({ registry, door, chainId: "c3", emit: (e) => events.push(e), note: (t) => notes.push(t), mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, opens: () => true });
  let backs = 0;
  assert.deepEqual(registry.commandEnd("c3", { id: "bg_x", command: "npm test", code: 1, text: "THE END, WHOLE", back: () => backs++ }), { ok: true });
  assert.deepEqual(turn.take({ seal: true }), ["THE END, WHOLE"], "whole, at work: no envelope's line");
  assert.deepEqual(registry.envelopes("c3"), []);
  assert.deepEqual(events.filter((e) => e.type === "shell-exit").map((e) => e.shells), [[{ id: "bg_x", command: "npm test", code: 1 }]]);
  assert.equal(events.filter((e) => e.type === "subagent-report").length, 0, "no sub-agent's row");
  assert.ok(notes.some((n) => /a background command's end delivered to the agent, whole/.test(n)), notes.join("\n"));
  registry.commandEnd("c3", { id: "bg_y", command: "npm run build", code: 0, text: "unread", back: () => backs++ });
  turn.close();
  assert.equal(backs, 1, "the one it never read went back to its sender; the one it read did not");
  assert.equal(registry.queued("c3"), 0);
});

// (fails before: yes)
test("the way back: the command ends into a turn that ends unread, and it is told with the chat's next turn", async () => {
  const registry = made();
  const door = registry.openTurn({ chainId: "c4", runId: "turn-1", cwd: root, mode: null, model: "coder-1", thinking: null, fork: null });
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
  const id = idOf((await call(commands, { command: node("setTimeout(()=>process.exit(5),500)") }, "c4")).text);
  await Promise.race([door.inbox.arrival(), new Promise((r) => setTimeout(r, 15_000))]);
  door.close();
  const owner = { session: "c4", agent: null };
  const [x] = peekShellExits(owner);
  assert.equal(x?.id, id);
  assert.match(x.text, /exited with code 5 after \d+ s\.\]\nIt printed nothing\.$/);
  tellShellExits(owner, [id]);
});

/** What a plain chat's wait answers with nothing running. */
const NOTHING = "Nothing to wait for: none of Filament's sub-agents you launched is still running, no agent you asked is still thinking, and none of your background commands runs. A report that already arrived reaches you as a message from Filament.";
/**
 * A plain chat's agent at work in chat `chain`, its calls through Filament's tools as its MCP server makes them: its turn's
 * door into a registry, its background commands, and its wait. `owes`: what else its turn waits for, as Filament's
 * sub-agents would. @param {string} chain @param {{ owes?: (() => Promise<void> | null) | null }} [o]
 */
const atWork = (chain, { owes = null } = {}) => {
  const registry = made();
  const door = registry.openTurn({ chainId: chain, runId: "turn-1", cwd: root, mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1, owes });
  /** @type {any[]} */
  const events = [];
  const turn = createLaunchTurn({ registry, door, chainId: chain, emit: (e) => events.push(e), note: () => {}, mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, opens: () => true });
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: (c) => (c === chain ? turn : null) }, subagents: () => null, membersOf: () => null, commands });
  const ctx = /** @type {any} */ ({ chain, cwd: root, upstream: "u", turn: null, graph: false, launch: true, permit: allow });
  return {
    registry,
    turn,
    events,
    start: async (/** @type {string} */ command) => idOf((await tools.call(BACKGROUND_COMMAND, { command }, ctx)).text),
    stop: (/** @type {string} */ id) => tools.call(BACKGROUND_COMMAND, { id, stop: true }, ctx),
    wait: async (/** @type {number} */ seconds) => (await tools.call("wait", { seconds }, ctx)).text,
  };
};
/** A command that runs until the test lets it end, by the file `gate` in its folder, and then prints and exits 0. @param {string} gate */
const endsOn = (gate) => node(`console.log('installing');setInterval(()=>require('fs').existsSync('${gate}')&&(console.log('added 12 packages'),process.exit(0)),50)`);

// (fails before: yes — the gap of 11-10: an agent started npm install with background_command, had nothing else to do
// and called wait, which answered at once "Nothing to wait for": it fell back to sleep loops in a shell)
test("the agent's wait waits for its background command: named while it runs, it returns the moment the command ends with its result whole, which comes once", async () => {
  const a = atWork("c-wait");
  const gate = `filament-wait-gate-${process.pid}-${Date.now()}`;
  const id = await a.start(endsOn(gate));
  try {
    const short = await a.wait(1);
    assert.doesNotMatch(short, /Nothing to wait for/);
    assert.match(short, new RegExp(`^Waited \\d+ s and nothing arrived; the background command ${id} \\(\`node -e .+…\`\\) is still running\\. Call wait again, or carry on with other work\\.$`), short);
    const t0 = Date.now();
    const long = a.wait(60);
    writeFileSync(join(root, gate), "");
    const said = await long;
    assert.match(said, new RegExp(`^Waited \\d+ s: one message from Filament:\\n\\n\\[Filament: your background command ${id} ended — \`node -e .+\` exited with code 0 after \\d+ s\\.\\]\\nIts output:\\ninstalling\\nadded 12 packages$`), said);
    assert.ok(Date.now() - t0 < 30_000, "the moment it ended, not when the wait ran out");
    // Once: not again beside the agent's next tool call, nor with the chat's next turn.
    assert.deepEqual(a.turn.take({ seal: true }), [], "the wait took it");
    assert.deepEqual(a.events.filter((e) => e.type === "shell-exit").map((e) => e.shells.map((/** @type {any} */ s) => s.id)), [[id]], "drawn once, as the shells' row");
    assert.equal(await a.wait(5), NOTHING, "nothing runs now");
    a.turn.close();
    assert.equal(a.registry.queued("c-wait"), 0);
    assert.deepEqual(peekShellExits({ session: "c-wait", agent: null }), [], "never told again with the chat's next turn");
  } finally {
    rmSync(join(root, gate), { force: true });
    await a.stop(id);
  }
});

// (fails before: yes — 109 left the lead's seat out: a coding agent leading a team, no worker running and its build
// running in the background, heard "Nothing to wait for")
test("a coding agent in the lead's seat: its wait waits for its background command too, naming it", async () => {
  const { registry: fake } = fakeRegistry(true);
  const commands = createBackgroundCommands({ registry: () => fake, graceMs: 50 });
  const id = idOf((await call(commands, { command: node("setInterval(()=>{},1000)") }, "c-lead")).text);
  try {
    const registry = /** @type {any} */ ({ recall: () => {}, list: () => [], standing: () => "", planHeld: () => false, launchWords: () => ({ on: "", chose: "" }), teamRows: async () => null });
    const door = /** @type {any} */ ({ inbox: { take: () => [], arrival: () => new Promise(() => {}), owed: () => null, back: () => {} }, close() {} });
    const lead = createLeadTurn({ registry, door, chainId: "c-lead", runId: "r1", cwd: root, model: "m-1", team: { key: "architect", name: "Architect", members: [] }, emit: () => {}, note: () => {}, mailbox: () => null, signal: new AbortController().signal });
    const said = (await lead.call("wait", { seconds: 1 }, { patienceMs: 6_000 })).text;
    assert.doesNotMatch(said, /Nothing to wait for/, said);
    assert.match(said, new RegExp(`^Waited \\d+ s and nothing arrived; the background command ${id} \\(\`node -e .+\`\\) is still running\\.`), said);
  } finally {
    await call(commands, { id, stop: true }, "c-lead");
    tellShellExits({ session: "c-lead", agent: null }, [id]);
  }
});

// (fails before: yes — 110: the loop's, a lead's and a coding agent's wait wait for background commands, so the tool's
// "Do not wait or poll for it" said not to use the one way that does)
test("the tool's words and its start's answer say not to sleep or poll, which wait now replaces", () => {
  assert.match(BACKGROUND_COMMAND_TOOL.description, /Do not sleep or poll for it: go on with other work, or end your turn if only waiting is left\./);
  assert.doesNotMatch(BACKGROUND_COMMAND_TOOL.description, /wait or poll/);
});

// (fails before: yes — its words named sub-agents and saved agents alone)
test("the wait's words say it waits for background commands too", () => {
  assert.match(CODER_WAIT_TOOL.description, /^Wait inside your turn for Filament's sub-agents you launched, the saved agents you asked and your background commands, instead of sleeping or polling: it returns the moment one of them reports or ends \(with its report or its result\)/);
});

// (fails before: yes — the same gap: the wait never waited on a command, so it said nothing of one stopped)
test("a command stopped while the agent waits on it ends the wait, which says its result will not come; beside sub-agents still owed, the wait names both", async () => {
  /** @type {() => void} */
  let settle = () => {};
  const owed = new Promise((resolve) => (settle = () => resolve(undefined)));
  let owing = true;
  const a = atWork("c-wait-stop", { owes: () => (owing ? owed : null) });
  const id = await a.start(node("setInterval(()=>{},1000)"));
  try {
    const short = await a.wait(1);
    assert.match(short, new RegExp(`^Waited \\d+ s and nothing arrived; Filament's sub-agents and the background command ${id} \\(\`node -e .+\`\\) are still running\\. Call wait again, or carry on with other work\\.$`), short);
    owing = false;
    settle();
    const t0 = Date.now();
    const long = a.wait(60);
    assert.ok(a.turn.waiting(), "it waits");
    assert.equal((await stopByPerson("c-wait-stop", id)).ok, true);
    const said = await long;
    assert.match(said, new RegExp(`^Waited \\d+ s: the background command ${id} \\(\`node -e .+\`\\) was stopped, so its result will not come\\.$`), said);
    assert.ok(Date.now() - t0 < 30_000, "the moment it stopped");
  } finally {
    await a.stop(id);
    tellShellExits({ session: "c-wait-stop", agent: null }, [id]);
  }
});

// (fails before: yes)
test("an end within the start's first moment is the start's answer, and nothing comes later", async () => {
  const { ends, registry } = fakeRegistry(true);
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 10_000 });
  const r = await call(commands, { command: node("console.log('no such file');process.exit(4)") });
  assert.match(r.text, /^\[Filament: your background command bg_\w+ ended — `node -e .+` exited with code 4 after \d+ s\.\]\nIts output:\nno such file$/, r.text);
  await new Promise((r2) => setTimeout(r2, 300));
  assert.equal(ends.length, 0);
});

// (fails before: yes)
test("read: still running, with its output so far; stop: said, and its result never comes; then its id is gone — and another chat's id is no command of this one", async () => {
  const { ends, registry } = fakeRegistry(true);
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
  const id = idOf((await call(commands, { command: node("console.log('half way');setInterval(()=>{},1000)") })).text);
  const read = await until(async () => {
    const r = await call(commands, { id });
    return /Its output so far:\nhalf way/.test(r.text) ? r : null;
  }, "its first line", { timeoutMs: 15_000 });
  assert.match(read.text, new RegExp(`^\\[${id} is still running, for \\d+ s: \`node -e .+\`\\.\\]\\nIts output so far:\\nhalf way$`), read.text);
  const other = await call(commands, { id }, "c9");
  assert.equal(other.isError, true);
  assert.match(other.text, new RegExp(`^No background command "${id}" in this chat`));
  const stopped = await call(commands, { id, stop: true });
  assert.match(stopped.text, new RegExp(`^Stopped background command ${id} \\(\`node -e .+\`\\) after \\d+ s: its result will not come\\.\\nIts output before the stop:\\nhalf way$`), stopped.text);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ends.length, 0, "a stop sends no result");
  assert.match((await call(commands, { id })).text, /it ended more than 5 minutes ago \(its result reached you then\), it was stopped, or Filament restarted since\./);
});

// (fails before: yes — the owner's plan of 11-02, Phase 4: an agent past a compaction had no way to see which of the
// chat's commands still ran, and started its dev server again)
test("list: the chat's commands still running, the oldest first, each by its id with its newest line; none says so; it goes alone", async () => {
  const commands = createBackgroundCommands({ graceMs: 50 });
  assert.equal((await call(commands, { list: true }, "c-list")).text, "None of this chat's background commands runs now.");
  const a = idOf((await call(commands, { command: node("console.log('ready on 3000');setInterval(()=>{},1000)") }, "c-list")).text);
  const b = idOf((await call(commands, { command: node("setInterval(()=>{},1000)") }, "c-list")).text);
  try {
    const listed = await until(async () => {
      const t = (await call(commands, { list: true }, "c-list")).text;
      // The command's own words hold the line too: its newest line is the one waited for.
      return t.includes("its newest line: ready on 3000") ? t : null;
    }, "its first line", { timeoutMs: 15_000 });
    assert.match(
      listed,
      new RegExp(`^2 background commands run in this chat now, the oldest first:\\n- ${a}: \`node -e .+\` in .+, running for \\d+ s — its newest line: ready on 3000\\n- ${b}: \`node -e .+\` in .+, running for \\d+ s\\nRead one: background_command\\(\\{ id \\}\\)\\. Stop one: background_command\\(\\{ id, stop: true \\}\\)\\.$`),
      listed,
    );
    assert.equal((await call(commands, { list: true }, "c9")).text, "None of this chat's background commands runs now.", "another chat's are not this one's");
    for (const args of [{ list: true, id: a }, { list: true, command: "ls" }, { list: true, stop: true }]) assert.deepEqual(await call(commands, args, "c-list"), { text: "Not run: list goes alone — no command, id or stop with it.", isError: true });
    // The owner's tool plan of 11-08: what list does is said at its field; the tool's words say when to use it.
    assert.match(BACKGROUND_COMMAND_TOOL.description, /Before you start a server or a watcher, list to see whether one runs already\.$/);
    assert.equal(/** @type {any} */ (BACKGROUND_COMMAND_TOOL.input_schema.properties).list.description, "true, alone: this chat's commands still running, each with its id.");
  } finally {
    await call(commands, { id: a, stop: true }, "c-list");
    await call(commands, { id: b, stop: true }, "c-list");
  }
});

// (fails before: yes — the owner's plan of 11-02, Phase 4: a deleted chat's commands ran on until Filament stopped, and
// a restart ended a chat's commands without a word to it)
test("a chat deleted: its commands stop, untold, and its come-back goes; a restart: each chat is told, with its next turn, which commands Filament no longer follows", async () => {
  const commands = createBackgroundCommands({ graceMs: 50 });
  // (fails before: yes — the review of 11-02: the record kept a command's secrets in the archive's plain meta)
  const id = idOf((await call(commands, { command: node("setInterval(()=>{},1000)//sk-abcd1234567890abcdef") }, "c-gone")).text);
  comeBackLater("c-gone", { seconds: 600, note: "later" });
  /** @type {string[]} */
  const woken = [];
  const stopHearing = onShellWake((s) => woken.push(s));
  try {
    const record = runningRecord("c-gone");
    assert.deepEqual(record.map((r) => [r.id, r.agent]), [[id, null]], "the record a start keeps");
    assert.match(record[0].command, /\/\/sk-abcd…/);
    assert.doesNotMatch(record[0].command, /1234567890abcdef/, "its secret redacted");
    assert.equal(await endChatShells("c-gone"), 1);
    assert.deepEqual([runningShellsOf("c-gone"), comeBackOf("c-gone"), runningRecord("c-gone")], [[], null, []]);
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual([peekShellExits({ session: "c-gone", agent: null }), woken], [[], []], "nobody to tell, nothing woken");
    /** @type {[string, any][]} */
    const merged = [];
    const archive = {
      shellsRunning: () => [{ id: "c-back", shells: [{ id: "bg_old1", command: "npm run dev", startedAt: Date.now() - 12 * 60_000, agent: null }, { id: "bg_old2", command: "vitest --watch", startedAt: Date.now() - 60_000, agent: "subagent:sa_00000001" }, "bg_bare"] }],
      mergeMeta: (/** @type {string} */ c, /** @type {any} */ p) => void merged.push([c, p]),
    };
    assert.equal(tellStoppedCommands(archive), 2, "a record that is no command's is passed over");
    assert.deepEqual(merged, [["c-back", { shellsRunning: undefined }]], "the record goes");
    const told = peekShellExits({ session: "c-back", agent: null });
    // (fails before: yes — the review of 11-02: the words said the command had ended, where a stop cut short leaves it running)
    const words = (/** @type {string} */ n, /** @type {string} */ c, /** @type {string} */ ago) =>
      `[Filament: background command ${n} (\`${c}\`), started ${ago} ago, was running when Filament last stopped: Filament no longer follows it, and its result will not come. A clean stop of Filament ends its commands, but a stop cut short may have left this one running — look (its port, its process) before you start it again.]`;
    assert.deepEqual(told.map((t) => t.text), [words("bg_old1", "npm run dev", "12 min"), words("bg_old2", "vitest --watch", "1 min")], "a sub-agent's to the main agent: its run is over");
    assert.deepEqual(woken, [], "never woken for it");
    tellShellExits({ session: "c-back", agent: null }, told.map((t) => t.id));
  } finally {
    stopHearing();
  }
});

// (fails before: yes — the hunt of 11-02 on Phase 4: each was kept as a shell's exit is, 20 a chat at most, so a restart
// that ended 25 told the chat of the newest 20 and said nothing of the rest)
test("a restart that ended more commands than the untold cap tells the chat of every one, and newer exits put none of them out", () => {
  const ids = Array.from({ length: 25 }, (_, i) => `bg_many${i}`);
  const archive = {
    shellsRunning: () => [{ id: "c-many", shells: ids.map((id, i) => ({ id, command: `npm run job-${i}`, startedAt: Date.now() - 60_000, agent: i % 2 ? "subagent:sa_00000002" : null })) }],
    mergeMeta: () => {},
  };
  const main = { session: "c-many", agent: null };
  assert.equal(tellStoppedCommands(archive), 25);
  try {
    assert.deepEqual(peekShellExits(main).map((t) => t.id), ids, "every one, the oldest first");
    // 21 ends that came after: the oldest of those goes, as the shells' cap says, and the restart's words stay.
    for (let i = 0; i < 21; i++) tellLater(main, { id: `bg_later${i}`, command: "true", code: 0, text: `later ${i}` }, { wake: false });
    const now = peekShellExits(main).map((t) => t.id);
    assert.deepEqual(now.filter((id) => id.startsWith("bg_many")), ids);
    assert.deepEqual(now.filter((id) => id.startsWith("bg_later")), Array.from({ length: 20 }, (_, i) => `bg_later${i + 1}`));
  } finally {
    tellShellExits(main, peekShellExits(main).map((t) => t.id));
  }
});

// (fails before: yes)
test("refused in words: the chat's switch says no, no turn judges it, no chat, id and command at once, stop with no id", async () => {
  const commands = createBackgroundCommands({ graceMs: 50 });
  const command = node("setInterval(()=>{},1000)");
  const no = await commands.call({ command }, { chain: "c5", cwd: root, permit: async () => { throw new Error("Read-only mode refused it"); } });
  assert.deepEqual([no.text, no.isError], ["Not run: Read-only mode refused it.", true]);
  assert.deepEqual(runningShellsOf("c5"), [], "nothing started");
  assert.match((await commands.call({ command }, { chain: "c5", cwd: root, permit: null })).text, /^Not run: no turn of this chat runs now to judge the call\.$/);
  assert.match((await commands.call({ command }, { chain: null, cwd: root, permit: allow })).text, /^Not run: this session is no chat of Filament's/);
  assert.match((await call(commands, { command, id: "bg_1" })).text, /not both/);
  assert.match((await call(commands, { stop: true })).text, /stop needs the id/);
  assert.match((await call(commands, {})).text, /command is required/);
});

// (fails before: yes)
test("the newest of its output: colour codes gone, a progress bar's last redraw, at most 80 lines and 8,000 characters — past that, the file with all of it", async () => {
  assert.deepEqual(tailOf("\x1b[32mok\x1b[0m 1\nloading 10%\rloading 100%\n\n\n", 30), { text: "ok 1\nloading 100%", lines: 2, whole: true });
  const one = tailOf(`${"x".repeat(TAIL_CHARS + 50)}END`, TAIL_CHARS + 53);
  assert.equal(one.text.length, TAIL_CHARS);
  assert.match(one.text, /^…x+END$/);
  assert.equal(one.whole, false);
  assert.equal(tailOf("a\nb", 9_999).whole, false, "the shell's rolling tail lost its start");
  assert.deepEqual(["4 s", "5 min 43 s", "2 min", "1 h 2 min"], [4_000, 343_000, 120_000, 3_720_000].map(tookWords));
  assert.equal(endText({ id: "bg_q", running: false, code: null, command: "npm\n  test", cwd: root, startedAt: 0, endedAt: 2_000, produced: 0, out: "", logPath: null }), "[Filament: your background command bg_q ended — `npm test` ended without an exit code after 2 s.]\nIt printed nothing.");
  const { ends, registry } = fakeRegistry(true);
  const commands = createBackgroundCommands({ registry: () => registry, graceMs: 50 });
  await call(commands, { command: node("setTimeout(()=>{for(let i=0;i<300;i++)console.log('line '+i)},400)") });
  await until(() => (ends.length ? true : null), "its end", { timeoutMs: 15_000 });
  const text = String(ends[0].text);
  assert.match(text, /\nThe last 80 lines of its output:\nline 220\n/);
  assert.match(text, /\nline 299\nAll of its output: .+filament-bash-[0-9a-z]+-[0-9a-z]+\.log$/);
  const path = /All of its output: (.+)$/.exec(text)?.[1] || "";
  assert.match(readFileSync(path, "utf8"), /^line 0\r?\nline 1\r?\n/);
});
