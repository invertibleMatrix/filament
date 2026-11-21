// @ts-check
// HarnessV4_Tasks A3 (HarnessV3-RunawayTurns A2, CW-D4): the session's compaction line, handed to Claude Code. Filament
// checks the line between turns only, so one long turn ran past it — the agent composes its own context, and nothing
// told it where the session wants room made. Claude's adapter takes Claude Code's own setting for that at a session's
// opening (`_meta.claudeCode.options.settings.autoCompactWindow`): a harness turn names its session's line in a house
// header, a session that turn opens carries it, and a session opened with another line is opened again. Only while the
// session makes room by itself (`context.compaction.mode: auto`): on Ask, Claude compacting mid-turn is what Ask is
// there to prevent. The rule, the session options, the bridge against its fake, then through the app.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FAKE_ACP_AGENT, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CLAUDE_COMPACT_RESERVE, CLAUDE_COMPACT_WINDOWS, CLAUDE_FILAMENT_ATTRIBUTION, CLAUDE_NO_ATTRIBUTION, claudeCompactWindow, planToolset } from "../src/adapters/agents/acp/toolset.js";
import { createUpdateReader, modelWindow } from "../src/adapters/agents/acp/updates.js";
import { COMPACT_WINDOW_FROM, SESSION_ENV_FROM, readProfile } from "../src/adapters/agents/acp/profile.js";
import { COMPACTION_HEADER, LINE_HEADER, lineOf } from "../src/adapters/agents/compactions.js";
import { npmShim } from "../src/adapters/agents/agent-process.js";
import { admitHeaders, houseAuth } from "../src/services/house.js";
import { confirmedOf } from "../src/core/catalogues.js";

const quiet = () => {};
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** The window Claude Code is given for a line. @param {number} line */
const windowFor = (line) => line + CLAUDE_COMPACT_RESERVE;
/**
 * A session's settings as the fake agent was handed them, its attribution taken out once it is checked (the owner's
 * list of 11-08: no Co-Authored-By line of Claude's, in every session Claude's adapter opens): Filament's line in a
 * harness chat's, the switch on as it ships (the owner's of 11-10), hidden in one no harness chat opens. The line alone,
 * or null.
 * @param {any} settings @param {any} [want]
 */
const withoutAttribution = (settings, want = CLAUDE_FILAMENT_ATTRIBUTION) => {
  if (!settings) return null;
  const { attribution, ...rest } = settings;
  assert.deepEqual(attribution, want, "every session's attribution, Filament's or hidden, never Claude's");
  return Object.keys(rest).length ? rest : null;
};

// The answer claude-agent-acp gives `initialize`, as far as the profile reads it.
/** @param {string} version */
const claudeInit = (version) => ({
  protocolVersion: 1,
  agentCapabilities: {
    _meta: { claudeCode: { promptQueueing: true }, authStatus: {} },
    promptCapabilities: { image: true, embeddedContext: true },
    mcpCapabilities: { http: true, sse: true },
    loadSession: true,
    sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
  },
  agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version },
});

describe("the rule", () => {
  // (fails before: yes — no request named a line: HarnessV4_Tasks A3)
  test("a harness turn names its session's line in a house header alone: tokens, never a client's claim", () => {
    /** @type {any[]} */
    const asked = [{ [LINE_HEADER]: "850000" }, { [LINE_HEADER]: " 170000 " }, { [LINE_HEADER]: "0" }, {}, null, { [LINE_HEADER]: "85%" }, { [LINE_HEADER]: "-5" }, { [LINE_HEADER]: "1e6" }];
    assert.deepEqual(asked.map(lineOf), [850_000, 170_000, null, null, null, null, null, null]);
    const claimed = { [LINE_HEADER]: "5000", "user-agent": "opencode/1.0" };
    const admitted = admitHeaders(claimed);
    assert.equal(admitted.headers[LINE_HEADER], undefined, "a client cannot move an agent's line");
    assert.ok(admitted.setAside.dropped.includes(LINE_HEADER));
    assert.equal(admitHeaders({ ...claimed, ...houseAuth() }).headers[LINE_HEADER], "5000");
  });

  // Seen live: Claude Code handed 83,000 ignored it whole and read on past it; handed 113,000 it made room on the
  // step that crossed 80,000. So a line is handed as the nearest window Claude Code takes, and the words say where
  // it then acts.
  // (fails before: yes — a 50,000 line was handed as an 83,000 window, which Claude Code drops)
  test("the window is the line plus what Claude Code keeps free, within the windows it takes: under the least it acts past the line, over the most before it", () => {
    assert.deepEqual([CLAUDE_COMPACT_RESERVE, CLAUDE_COMPACT_WINDOWS], [33_000, { least: 100_000, most: 1_000_000 }]);
    const of = (/** @type {number} */ line) => [claudeCompactWindow(line).window, claudeCompactWindow(line).at];
    assert.deepEqual([80_000, 170_000, 850_000].map(of), [[113_000, 80_000], [203_000, 170_000], [883_000, 850_000]]);
    assert.deepEqual([67_000, 66_999, 50_000, 1].map(of), [[100_000, 67_000], [100_000, 67_000], [100_000, 67_000], [100_000, 67_000]]);
    assert.deepEqual([967_000, 967_001, 1_000_000].map(of), [[1_000_000, 967_000], [1_000_000, 967_000], [1_000_000, 967_000]]);
    assert.equal(claudeCompactWindow(80_000).words, "acp: Claude Code is given the session's compaction line, 80,000 tokens (its auto-compact window: 113,000): it makes room by itself when a turn crosses it");
    assert.equal(claudeCompactWindow(50_000).words, "acp: Claude Code is given the least auto-compact window it takes, 100,000 tokens: it makes room by itself at 67,000, past the session's 50,000-token compaction line, which Filament checks between turns");
    assert.equal(claudeCompactWindow(990_000).words, "acp: Claude Code is given the most auto-compact window it takes, 1,000,000 tokens: it makes room by itself at 967,000, before the session's 990,000-token compaction line");
  });

  // (fails before: yes — Filament never handed the line to Claude Code: `autoCompactWindow` appeared nowhere in src/)
  test("a session Claude's adapter opens takes the line as Claude Code's auto-compact window, beside its other options; no other agent is given it", () => {
    const claude = { id: "claude-code", acp: { command: "claude-agent-acp" } };
    /** @param {any} init @param {Record<string, any>} [o] */
    const plan = (init, o = {}) => {
      /** @type {string[]} */
      const notes = [];
      const upstream = o.upstream || claude;
      const p = planToolset({ acp: o.acp || {}, upstream, proc: { initResult: init }, profile: readProfile(init, confirmedOf(upstream)), turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: null, memoryWanted: false, existingToken: null, notes, line: "line" in o ? o.line : 850_000, modelConfig: o.modelConfig === true, trailer: o.trailer === true, ownHeaders: o.ownHeaders ?? null, atDoor: o.atDoor === true });
      return { options: p.sessionMeta._meta?.claudeCode?.options, line: p.line, window: p.compactWindow, notes };
    };
    const now = claudeInit(COMPACT_WINDOW_FROM);
    assert.equal(readProfile(now).compactWindow, true);
    // Every session's attribution hidden beside the line (the owner's list of 11-08: no Co-Authored-By line).
    const hidden = { attribution: CLAUDE_NO_ATTRIBUTION };
    assert.deepEqual(plan(now), { options: { extraArgs: { "thinking-display": "summarized" }, settings: { ...hidden, autoCompactWindow: windowFor(850_000) } }, line: 850_000, window: 883_000, notes: [] });
    assert.deepEqual([plan(now, { line: 50_000 }).options?.settings, plan(now, { line: 50_000 }).line, plan(now, { line: 50_000 }).window], [{ ...hidden, autoCompactWindow: 100_000 }, 50_000, 100_000], "never a window Claude Code would drop");
    assert.deepEqual(plan(now, { acp: { thoughts: "hide" } }).options, { settings: { ...hidden, autoCompactWindow: windowFor(850_000) } }, "with or without the thinking it is asked to show");
    assert.deepEqual([plan(now, { line: null }).options, plan(now, { line: null }).line, plan(now, { line: null }).window], [{ extraArgs: { "thinking-display": "summarized" }, settings: hidden }, null, null], "no line named: no window, the attribution hidden all the same");
    // An adapter older than the one read taking it, and an agent that isn't Claude's adapter.
    const older = claudeInit("0.86.9");
    assert.deepEqual([readProfile(older).compactWindow, plan(older).options, plan(older).line], [false, { extraArgs: { "thinking-display": "summarized" } }, null]);
    const little = { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: "other", version: "9.0.0" } };
    assert.deepEqual([readProfile(little).compactWindow, plan(little).options, plan(little).line], [false, undefined, null]);
    // The adapter's own model overrides come from a variable of its environment, and options.settings takes their
    // place whole: where the agent's environment sets it, the line is not handed, and the record says why.
    const overridden = plan(now, { modelConfig: true });
    assert.deepEqual([overridden.options, overridden.line], [{ extraArgs: { "thinking-display": "summarized" } }, null]);
    assert.deepEqual(overridden.notes, [
      "acp: the session's compaction line (850,000 tokens) was not handed to Claude Code: the agent's environment sets CLAUDE_MODEL_CONFIG, whose model overrides the session's settings would replace. Claude Code compacts at its own point; Filament checks the line between turns",
      // (fails before: yes — the owner's of 11-10: where its settings cannot go, Claude Code writes its own line, unsaid)
      "acp: claude-code's commit attribution could not be set (the agent's environment sets CLAUDE_MODEL_CONFIG, whose model overrides the session's settings would replace): its commits may end with its own Co-Authored-By line",
    ]);
    assert.deepEqual(plan(older).notes, ["acp: claude-code's commit attribution could not be set (its adapter takes no session settings): its commits may end with its own Co-Authored-By line"], "an adapter before session settings");
    assert.deepEqual(plan(little).notes, [], "an agent that is not Claude's adapter has no attribution to set");
    // (fails before: yes — the owner's of 11-10: Filament's co-author line on, Claude Code's attribution carries it, its
    // pull requests saying they were made with Filament; off, hidden as before)
    const own = { attribution: { commit: "Co-authored-by: Filament <noreply@filamentdev.com>", pr: "Made with [Filament](https://filamentdev.com)" } };
    assert.deepEqual(plan(now, { trailer: true }).options?.settings, { ...own, autoCompactWindow: windowFor(850_000) });
    assert.deepEqual(plan(now, { trailer: true, line: null }).options?.settings, own, "with no line too");
    assert.deepEqual(CLAUDE_FILAMENT_ATTRIBUTION, own.attribution);
    // (fails before: yes — proxy-twice: the person's own settings set Claude Code's headers, which it lays over its
    // process's, and Filament's ask to add nothing never rode its model calls)
    // (fails before: yes — the review of 11-11: the ask rode after their headers wherever its model calls went; it rides
    // where they go to Filament's door, and elsewhere the session's settings say theirs as they are)
    assert.deepEqual(plan(now, { line: null, ownHeaders: "X-Team: a", atDoor: true }).options?.settings, { ...hidden, env: { ANTHROPIC_CUSTOM_HEADERS: "X-Team: a\nx-filament-adds: none" } }, "after theirs, in the tier over them");
    assert.deepEqual(plan(now, { line: null, ownHeaders: "X-Team: a" }).options?.settings, { ...hidden, env: { ANTHROPIC_CUSTOM_HEADERS: "X-Team: a" } }, "its calls go elsewhere: theirs alone");
    assert.deepEqual(plan(now, { line: null, atDoor: true }).options?.settings, hidden, "none of theirs to say: the process's variable carries it, and the settings stay as they were");
    assert.deepEqual(plan(older, { ownHeaders: "X-Team: a", atDoor: true }).notes, [
      "acp: claude-code's model calls go to Filament's door, and its session takes no settings of Filament's here: Filament's ask to add nothing (x-filament-adds: none) does not ride them, and they get Filament's additions again",
      "acp: claude-code's commit attribution could not be set (its adapter takes no session settings): its commits may end with its own Co-Authored-By line",
    ], "where its session takes no settings, said");
    assert.deepEqual(plan(older, { ownHeaders: "X-Team: a" }).notes, [
      "acp: claude-code's model calls here go elsewhere than Filament's door, and its session takes no settings of Filament's: Filament's ask to add nothing (x-filament-adds: none), which its process started with, rides them there",
      "acp: claude-code's commit attribution could not be set (its adapter takes no session settings): its commits may end with its own Co-Authored-By line",
    ], "nor can the ask its process started with be taken off there, said too");
    // (fails before: yes — the review of 11-08: 0.93.0 lays the session's settings over those overrides, yet an agent
    // whose environment set the variable was handed neither the line nor the hidden attribution)
    const laid = plan(claudeInit(SESSION_ENV_FROM), { modelConfig: true });
    assert.deepEqual([laid.options?.settings, laid.line, laid.notes], [{ ...hidden, autoCompactWindow: windowFor(850_000) }, 850_000, []], "0.93.0: the line and the attribution handed over CLAUDE_MODEL_CONFIG");
  });

  // HarnessV4_Tasks A8, seen live 10-13 to 10-17: Claude's adapter names the auto-compact window it was handed as the
  // window until a turn's result names the model's, so a 400,000 line read as 40% of 433,000 mid-turn, and the share
  // set to put it back made the line 930,000 once the model's 1,000,000 came back.
  // (fails before: yes — every size was the model's window)
  test("a size that is the window the session's line handed is the line's, not the model's; the most window Claude Code takes is the 1M models' own", () => {
    const at = (/** @type {number | null} */ line) => (/** @type {any} */ size) => modelWindow(size, { line });
    assert.deepEqual([433_000, 1_000_000, 200_000, 963_000].map(at(400_000)), [null, 1_000_000, 200_000, 963_000]);
    assert.deepEqual([100_000, 113_000].map(at(50_000)), [null, 113_000], "a line under the least: the least is what it handed");
    assert.deepEqual([1_000_000].map(at(990_000)), [1_000_000], "the most is a model's window too");
    assert.deepEqual([433_000, 1_000_000].map(at(null)), [433_000, 1_000_000], "no line handed: whatever it names");
    assert.deepEqual([0, -5, undefined, null, "433000"].map(at(400_000)), [null, null, null, null, null], "no size");
  });

  // (fails before: yes — the meter's live window and the turn's facts were the handed window, mid-turn)
  test("the reader: the meter's figure and the turn's facts name no window where the size is the line's; the result's names the model's", () => {
    /** @type {any[]} */
    const events = [];
    /** @type {any} */
    const out = { tools: [] };
    const read = createUpdateReader({ out, conv: { line: 400_000 }, turn: {}, onEvent: (/** @type {any} */ e) => events.push(e), notes: [] });
    const sizes = () => events.filter((e) => e.type === "usage").map((e) => e.usage.size);
    read({ sessionUpdate: "usage_update", used: 52_000, size: 433_000 });
    assert.deepEqual([out.context, sizes()], [{ used: 52_000, size: null, cost: null }, [null]]);
    read({ sessionUpdate: "usage_update", used: 61_000, size: 1_000_000, cost: { amount: 0.25, currency: "USD" } });
    assert.deepEqual([out.context, sizes()], [{ used: 61_000, size: 1_000_000, cost: 0.25 }, [null, 1_000_000]]);
  });
});

describe("Claude's adapter, as installed here", () => {
  // The pin (HarnessV4_Tasks A3): Filament relies on three things of the adapter that no protocol declares. Where the
  // adapter is installed, its own files are read for them, so an update that moves one fails here and not in a chat.
  const script = process.platform === "win32" ? npmShim("claude-agent-acp") : null;
  const root = script ? dirname(dirname(script)) : null;
  test("it takes `options.settings` from a session's `_meta`, opens the session again when they change, and its Claude Code knows `autoCompactWindow`", { skip: root ? false : "claude-agent-acp is not installed here" }, () => {
    const home = String(root);
    const version = JSON.parse(readFileSync(join(home, "package.json"), "utf8")).version;
    const agent = readFileSync(join(home, "dist", "acp-agent.js"), "utf8");
    assert.match(agent, /const userProvidedOptions = sessionMeta\?\.claudeCode\?\.options;/, `${version}: a session's options come from _meta.claudeCode.options`);
    // Since 0.93.0 it is read as `providedSettings`, laid over the model's own config — a session's keys win — and
    // handed on as `settings`.
    assert.match(agent, /const providedSettings = userProvidedOptions\?\.settings;/, `${version}: options.settings is read`);
    assert.match(agent, /\{ \.\.\.modelConfig, \.\.\.providedSettingsObject \}/, `${version}: over the model's own config, the session's keys winning`);
    assert.match(agent, /\.\.\.\(settings && \{ settings \}\),/, `${version}: and given to its Claude Code`);
    const rebuilds = /const OPTION_REBUILDS_SESSION = \{([\s\S]*?)\n\};/.exec(agent)?.[1] || "";
    assert.match(rebuilds, /\n\s+settings: true,/, `${version}: changed settings open the session again (its fingerprint)`);
    const sdk = readFileSync(join(home, "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8");
    assert.match(sdk, /\* Auto-compact window size\s*\n\s*\*\/\s*\n\s*autoCompactWindow\?: number;/, `${version}: Claude Code's settings have autoCompactWindow`);
  });
});

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-compaction-line-"));
});
after(async () => {
  await removeDirs(dir);
});
/** A request's body. @param {string} text */
const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
/** A harness turn's headers: the chat's newest compaction, and its line where it names one. @param {number | null} line */
const harness = (line) => ({ [COMPACTION_HEADER]: "0", ...(line == null ? {} : { [LINE_HEADER]: String(line) }) });

describe("an ACP agent's session", () => {
  /** @type {AcpBridge} */ let bridge;
  /** @param {string} id @param {Record<string, string>} [env] */
  const up = (id, env = {}) => ({
    id,
    name: id,
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close", ...env }, cwdDefault: dir, permissions: "allow-all" },
  });
  /** The sessions an agent was asked to open, each with the settings it was given. @param {string} id */
  const opens = (id) => lines(join(dir, `${id}-calls.jsonl`)).filter((c) => /^session\/(new|load|resume)$/.test(c.method)).map((c) => [c.method, withoutAttribution(c.settings, CLAUDE_NO_ATTRIBUTION)]);
  before(() => {
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: join(dir, "acp-sessions.json") }));
  });
  after(() => bridge.shutdown());
  /** @param {any} upstream @param {string} text @param {Record<string, string>} headers @param {string} [chat] */
  const turn = (upstream, text, headers, chat = "chat") => bridge.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, headers, onEvent: () => {} });

  // (fails before: yes — a session was opened with no line, whatever its chat's was)
  test("is opened with its chat's line, kept while the line stands, and opened again when the line moves or goes", async () => {
    const one = await turn(up("claude"), "one", harness(170_000));
    assert.deepEqual(opens("claude"), [["session/new", { autoCompactWindow: windowFor(170_000) }]]);
    assert.ok(one.notes.includes(`acp: Claude Code is given the session's compaction line, 170,000 tokens (its auto-compact window: ${windowFor(170_000).toLocaleString()}): it makes room by itself when a turn crosses it`), one.notes.join("\n"));
    // (fails before: yes — a turn's result said nothing of where its agent makes room by itself, HarnessV4_Tasks U3-2)
    assert.deepEqual(one.point, { at: 170_000, line: 170_000 }, "the point the meter draws: the line itself");
    const two = await turn(up("claude"), "two", harness(170_000));
    assert.equal(opens("claude").length, 1, "the line stands: the session goes on as it is");
    assert.ok(!two.notes.some((/** @type {string} */ n) => /compaction line/.test(n)), "said once, when the session takes it");
    assert.deepEqual(two.point, { at: 170_000, line: 170_000 }, "and its point with it");
    const moved = await turn(up("claude"), "three", harness(100_000));
    assert.deepEqual(opens("claude").at(-1), ["session/resume", { autoCompactWindow: windowFor(100_000) }]);
    assert.deepEqual(moved.point, { at: 100_000, line: 100_000 });
    assert.equal(moved.sessionId, one.sessionId, "the same session, its own history kept");
    assert.ok(moved.notes.includes(`acp: session ${one.sessionId.slice(0, 8)} resumed again: its compaction line moved from 170,000 to 100,000 tokens`), moved.notes.join("\n"));
    assert.equal(lines(join(dir, "claude-prompts.jsonl")).at(-1).prompt, "three", "nothing seeded: the session has the chat");
    // The chat went to Ask: the harness names no line, and Claude Code is left to its own point.
    const asks = await turn(up("claude"), "four", harness(null));
    assert.deepEqual(opens("claude").at(-1), ["session/resume", null]);
    assert.ok(asks.notes.includes(`acp: session ${one.sessionId.slice(0, 8)} resumed again: its chat names no compaction line now (it was 100,000 tokens), so Claude Code compacts at its own point`), asks.notes.join("\n"));
    assert.equal(asks.point, undefined, "a point of its own, not drawn until known");
    await turn(up("claude"), "five", harness(null));
    assert.equal(opens("claude").length, 3, "and stays so");
  });

  // (fails before: yes — each line was its own window, so a line moved under the least opened the session again for
  // a window Claude Code drops)
  test("lines under the least window Claude Code takes are one window to it: said as that, and a move among them opens nothing again", async () => {
    const low = await turn(up("claude"), "one", harness(50_000), "low");
    const was = opens("claude").length;
    assert.deepEqual(opens("claude").at(-1), ["session/new", { autoCompactWindow: 100_000 }]);
    assert.ok(low.notes.includes(claudeCompactWindow(50_000).words), low.notes.join("\n"));
    assert.deepEqual(low.point, { at: 67_000, line: 50_000 }, "it makes room at 67,000, past the line");
    await turn(up("claude"), "two", harness(60_000), "low");
    assert.equal(opens("claude").length, was, "60,000 asks the same 100,000 window");
    // The session's line is the chat's now: the next move is told from it.
    const up2 = await turn(up("claude"), "three", harness(80_000), "low");
    assert.deepEqual(opens("claude").at(-1), ["session/resume", { autoCompactWindow: 113_000 }]);
    assert.ok(up2.notes.includes(`acp: session ${low.sessionId.slice(0, 8)} resumed again: its compaction line moved from 60,000 to 80,000 tokens`), up2.notes.join("\n"));
  });

  // (fails before: yes — the session opened again in its own process for the line kept what its transcript had saved
  // before, a new session's nothing, though Claude's adapter had Claude Code's exit write its totals as it opened it so:
  // once its agent was killed, the turn that opened it in a new process booked 0.0618 for a run of 0.0309, and its
  // tokens twice)
  test("a session opened again in its own process for a moved line, its agent killed after, books the next turn's cost as not known: what its transcript saved as it was opened again is not Filament's", async () => {
    const upstream = up("claude-saved", { FAKE_ACP_SAVED_DIR: join(dir, "saved") });
    const one = await turn(upstream, "one ~ran", harness(170_000), "saved");
    const two = await turn(upstream, "two ~ran", harness(100_000), "saved");
    assert.ok(two.notes.includes(`acp: session ${one.sessionId.slice(0, 8)} resumed again: its compaction line moved from 170,000 to 100,000 tokens`), two.notes.join("\n"));
    const conv = [...bridge.convs.values()].find((/** @type {any} */ c) => c.sessionId === one.sessionId);
    const key = String(conv.procKey);
    bridge.killProcess(key);
    await until(() => !conv.procKey || null, "the agent's process gone");
    const three = await turn(upstream, "three ~ran", harness(100_000), "saved");
    assert.equal(three.sessionId, one.sessionId);
    assert.deepEqual([one.context?.cost, three.context?.cost ?? null], [0.0309, null]);
    assert.match(String(three.costUnseen), /opened again/);
    const { input, output, cacheRead, cacheWrite } = three.usage || {};
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 10, output: 46, cacheRead: 100, cacheWrite: 2000 }, "its own run's tokens, once");
  });

  test("an outside client's request leaves the session's line as it is; an agent that is not Claude's adapter is handed none", async () => {
    await turn(up("claude"), "one", harness(170_000), "shared");
    const was = opens("claude").length;
    // A request that names no compaction is no harness turn: its client says nothing of the chat's line.
    await turn(up("claude"), "two", {}, "shared");
    await turn(up("claude"), "three", harness(170_000), "shared");
    assert.equal(opens("claude").length, was, "not opened again for it, nor after it");

    const other = await turn(up("other", { FAKE_ACP_CLAUDE: "" }), "one", harness(170_000));
    await turn(up("other", { FAKE_ACP_CLAUDE: "" }), "two", harness(100_000));
    assert.deepEqual(opens("other"), [["session/new", null]], "no window, and a moved line opens nothing again");
    assert.ok(!other.notes.some((/** @type {string} */ n) => /compaction line/.test(n)));
    assert.equal(other.point, undefined, "nor a point to draw");
  });

  // (fails before: yes — HarnessV4_Tasks A8: the turn named the window its line handed as its model's)
  test("a turn whose agent names the window its line handed names none of the model's; any other size it names stands", async () => {
    const handed = await turn(up("claude"), "one ~window 203000", harness(170_000), "named");
    assert.deepEqual(handed.context, { used: 1200, size: null, cost: null });
    const own = await turn(up("claude"), "two ~window 1000000", harness(170_000), "named");
    assert.deepEqual(own.context, { used: 1200, size: 1_000_000, cost: null });
    const other = await turn(up("other", { FAKE_ACP_CLAUDE: "" }), "one ~window 203000", harness(170_000), "named");
    assert.equal(other.context.size, 203_000, "an agent handed no line names its own window, whatever it is");
  });
});

describe("through the app: the session's line reaches its agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  const opens = () => lines(join(root, "calls.jsonl")).filter((c) => /^session\/(new|load|resume)$/.test(c.method)).map((c) => [c.method, withoutAttribution(c.settings)]);
  /** What a run said of its window and of where its agent makes room by itself (its `window` events). @param {string} runId */
  const windowsSaid = async (runId) =>
    (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events
      .filter((/** @type {any} */ e) => e.type === "window")
      .map((/** @type {any} */ e) => ({ window: e.window, source: e.source, usable: e.usable }));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-compaction-line-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "ag", name: "ag", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  // (fails before: yes — the harness named its chat's compaction and never its line)
  test("the share the session chose of the window its agent named; a changed share moves it, and it is the same line whether a message asks first or not", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } })).json()).id);
    /** @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    /** @param {Record<string, any>} compaction */
    const set = async (compaction) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { context: { compaction } } } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    /** Where the newest turn's facts say the agent makes room by itself (HarnessV4_Tasks U3-2). */
    const point = async () => {
      const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      return tr.turns.at(-1)?.facts?.context?.point ?? null;
    };
    // Nobody knows the agent's window before its first turn says it: the session opens with no line.
    await say("one ~holds 1000");
    assert.deepEqual(opens(), [["session/new", null]]);
    assert.equal(await point(), null, "nor a point");
    // It named a 200,000-token window: 85% of it, from the next turn on.
    await say("two ~holds 2000");
    assert.deepEqual(opens().at(-1), ["session/resume", { autoCompactWindow: windowFor(170_000) }]);
    // (fails before: yes — the turn's facts said nothing of where the agent makes room, so the page could not draw it)
    assert.deepEqual(await point(), { at: 170_000, line: 170_000 }, "the turn's facts carry the point for the page");
    await say("three ~holds 3000");
    assert.equal(opens().length, 2, "the line stands");
    await set({ thresholdPercent: 50 });
    await say("four ~holds 4000");
    assert.deepEqual(opens().at(-1), ["session/resume", { autoCompactWindow: windowFor(100_000) }]);
    // (fails before: yes — HarnessV4_Tasks C26: a session that asks was handed no line, so its agent made room at a
    // point of its own in the middle of a turn, past the share the session chose)
    assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json()).effective.context.compaction.mode, "ask", "the session asks first: the default");
    await set({ mode: "auto" });
    await say("five ~holds 5000");
    assert.equal(opens().length, 3, "the line stands: asking is a message's, and a turn that is running makes room by itself either way");
    assert.deepEqual(await point(), { at: 100_000, line: 100_000 });
  });

  // The owner's word of 10-25: "the agents that are run by you or as side agents. they should get the default 85%
  // compaction line threshold of the context window model offers".
  // (fails before: yes — a sub-agent's run named no line: Claude Code under it compacted at a point of its own)
  test("a side agent on Claude Code is handed its own line, 85% of its agent's window, whatever its session's", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain", settings: { context: { compaction: { thresholdPercent: 50 } } } } })).json()).id);
    // A turn of the chat names the agent's window (200,000), as it does at the end of every turn.
    const said = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one ~holds 1000", stream: false } });
    assert.equal(said.status, 200, await said.clone().text());
    const was = opens().length;
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "look aside", description: "Aside", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sa = (await spawn.json()).subagent;
    const ran = await until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      const s = subagents.find((/** @type {any} */ x) => x.id === sa.id);
      return s && s.status !== "running" ? s : null;
    }, "the side agent's run to end");
    assert.equal(ran.status, "done", JSON.stringify(ran));
    assert.deepEqual(opens().slice(was), [["session/new", { autoCompactWindow: windowFor(170_000) }]], "its own session, opened with 85% of 200,000 — not the session's 50%");
    const rec = await shim.record(String(ran.runId));
    assert.ok((rec.changes || []).includes(`acp: Claude Code is given its own compaction line, 170,000 tokens (its auto-compact window: ${windowFor(170_000).toLocaleString()}): it makes room by itself when a turn crosses it`), JSON.stringify(rec.changes));
    // The owner's of 11-12: a running sub-agent's card says what its context holds, and where it compacts.
    // (fails before: yes — its run said neither its window nor its line: its card had nothing to weigh its count against)
    assert.deepEqual(await windowsSaid(String(ran.runId)), [{ window: 200_000, source: "agent", usable: 170_000 }], "its run says its window and where its agent makes room, once");
  });

  // (fails before: no — a guard: a side agent whose model's window nobody knows is handed no line, and says none)
  test("a side agent whose window nobody knows yet says no line: its agent's own count names the window", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-unknown", preset: "plain" } })).json()).id);
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "look aside ~holds 60000", description: "Aside", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sa = (await spawn.json()).subagent;
    const ran = await until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      const s = subagents.find((/** @type {any} */ x) => x.id === sa.id);
      return s && s.status !== "running" ? s : null;
    }, "the side agent's run to end");
    assert.equal(ran.status, "done", JSON.stringify(ran));
    assert.deepEqual(await windowsSaid(String(ran.runId)), [], "no window of Filament's, no line handed: nothing is said");
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(ran.runId))}/events?since=0&limit=5000`)).json()).events;
    assert.deepEqual(events.filter((/** @type {any} */ e) => e.type === "held").map((/** @type {any} */ e) => [e.tokens, e.window]), [[60_000, 200_000]], "its agent's count, with the window it names");
  });

  // The owner's word of 11-02: a side agent's line is the lower of 400K and 85% of its window — "the sweet spot i have
  // found ... is 400K".
  // (fails before: yes — a side agent on a 1M window was handed 850,000, an auto-compact window of 883,000)
  test("a side agent on Claude Code whose window is 1M is handed 400,000, not 85% of it", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-big", preset: "plain" } })).json()).id);
    // A turn of the chat names the agent's window, 1,000,000, as it does at the end of every turn.
    const said = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one ~window 1000000", stream: false } });
    assert.equal(said.status, 200, await said.clone().text());
    const was = opens().length;
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "look aside", description: "Aside", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sa = (await spawn.json()).subagent;
    const ran = await until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      const s = subagents.find((/** @type {any} */ x) => x.id === sa.id);
      return s && s.status !== "running" ? s : null;
    }, "the side agent's run to end");
    assert.equal(ran.status, "done", JSON.stringify(ran));
    assert.deepEqual(opens().slice(was), [["session/new", { autoCompactWindow: windowFor(400_000) }]]);
    assert.deepEqual(await windowsSaid(String(ran.runId)), [{ window: 1_000_000, source: "agent", usable: 400_000 }], "40% of its window, which its card says");
  });

  // The owner's report of 10-17 (HarnessV4_Tasks A8): a 400,000 line read as a share of the 433,000-token window
  // Claude Code was handed for it, and the line the share made moved with each turn.
  // (fails before: yes — the session was opened again on a line of 85% of 203,000: its line moved by itself)
  test("a turn whose agent names the window its line handed moves nothing: the line stays its share of the model's window", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } })).json()).id);
    /** @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    const point = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).turns.at(-1)?.facts?.context?.point ?? null;
    await say("one ~holds 1000");
    await say("two ~holds 2000");
    const was = opens().length;
    assert.deepEqual(opens().at(-1)?.[1], { autoCompactWindow: windowFor(170_000) }, "85% of the 200,000 the agent named");
    // Claude's adapter names the window it was handed until a turn's result names the model's.
    await say(`three ~window ${windowFor(170_000)}`);
    await say("four ~holds 4000");
    assert.equal(opens().length, was, "not opened again: the line has not moved");
    assert.deepEqual(await point(), { at: 170_000, line: 170_000 });
    // The cache is saved half a second after its newest change.
    const file = join(shim.dataDir, "models-cache.json");
    await until(() => existsSync(file) && JSON.parse(readFileSync(file, "utf8")).agentWindows?.ag, "the agent's windows saved");
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(JSON.parse(readFileSync(file, "utf8")).agentWindows.ag["fake-a"], 200_000, "the model's window Filament keeps is the model's");
  });
});
