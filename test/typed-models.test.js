// @ts-check
// HarnessV4_Tasks E9 (HarnessV4_Overnight_Plan, batch 1, OC-1 to OC-17): a model name typed on an upstream's card is
// kept. The box under the model list adds it to the upstream's typed names (its `models`, saved at once when nothing
// else waits to be saved), the list marks it "typed" with a × that takes it off again, and says when the provider's
// own list lacks it. A coding agent is given a typed name exactly or not at all — never its closest match — and a
// turn on one it does not offer always says so.
import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AcpBridge } from "../src/acp.js";
import { applySessionSettings } from "../src/adapters/agents/acp/configure.js";
import * as negotiate from "../src/adapters/agents/acp/negotiate.js";
import { selectCodexModel } from "../src/adapters/agents/codex/bridge.js";
import { renderHints } from "../src/core/notes.js";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { upstreams } from "../src/ui/pages/destinations.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { fmt } from "../src/ui/lib/format.js";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

describe("a coding agent that picks its model per session (Claude over ACP)", () => {
  /**
   * The model step over a recording agent that offers Claude's four, or `offered`; `effort`: the turn's, which the agent
   * takes as an option of its session (low, high, xhigh); `keyed`: the models the account's API key offers.
   * @param {string} modelId @param {string[]} [typed] @param {{ offered?: string[], effort?: string | null, keyed?: string[] }} [o]
   */
  const apply = async (modelId, typed = [], { offered = ["default", "opus[1m]", "sonnet", "haiku"], effort = null, keyed = [] } = {}) => {
    /** @type {any[]} */
    const asked = [];
    /** @type {string[]} */
    const notes = [];
    /** @type {any[]} */
    const structured = [];
    const proc = { request: async (/** @type {string} */ method, /** @type {any} */ params) => (asked.push([method, params.modelId ?? params.value]), {}) };
    const conv = { sessionId: "s1", availableModels: offered, modelId: "default", modelLabels: {}, ...(effort ? { effortOptions: ["default", "low", "high", "xhigh"], effortConfigId: "effort", effort: "default" } : {}) };
    await applySessionSettings({ proc, conv, acp: { modelSelection: "session" }, modelId, typed, keyed, effort, mode: "", modeOverride: null, notes, structured });
    return { asked: asked.filter(([m]) => m === "session/set_model"), efforts: asked.filter(([m]) => m === "session/set_config_option").map(([, v]) => v), notes, structured, conv };
  };

  // (fails before: yes — "opus", typed, was taken to "opus[1m]", the closest the agent offered)
  test("a typed name it does not list is not swapped for its closest: the agent keeps its model, and says so (OC-10)", async () => {
    const r = await apply("opus", ["opus"]);
    assert.deepEqual(r.asked, []);
    assert.equal(r.conv.modelId, "default");
    assert.ok(r.notes.includes("acp: model opus (typed on the upstream's card) not offered by this agent (offers default, opus[1m], sonnet, haiku); keeping default"), r.notes.join("\n"));
    assert.deepEqual(r.structured.find((s) => s.note.kind === "model-not-offered")?.note, { kind: "model-not-offered", model: "opus", offers: ["default", "opus[1m]", "sonnet", "haiku"], keeping: "default", typed: true });
  });

  // (fails before: no — an exact name was always taken; this guards that a typed one still is, in any case)
  test("a typed name it lists is taken, its case aside (OC-11)", async () => {
    assert.deepEqual((await apply("Sonnet", ["sonnet"])).asked, [["session/set_model", "sonnet"]]);
  });

  // (fails before: no — this guards the near match every Claude session relies on, for names nobody typed)
  test("a name nobody typed still finds the agent's own (OC-12)", async () => {
    assert.deepEqual((await apply("opus")).asked, [["session/set_model", "opus[1m]"]]);
  });

  // The owner's of 11-11: a turn's model comes with Filament's effort still on it (acp-turn.js `useFull`), and
  // "claude-fable-5-2[1m]-xhigh" was no name typed on the card: its note went out unsaid, the default answering.
  // (fails before: yes — the note had no `typed`, and named the id with its effort)
  test("a typed name with Filament's effort riding on it is the typed name: not offered, the note names it as the card holds it and is always said", async () => {
    const r = await apply("claude-fable-5-2[1m]-xhigh", ["claude-fable-5-2[1m]"], { effort: "xhigh" });
    assert.deepEqual(r.asked, []);
    assert.equal(r.conv.modelId, "default");
    const note = r.structured.find((s) => s.note.kind === "model-not-offered")?.note;
    assert.deepEqual(note, { kind: "model-not-offered", model: "claude-fable-5-2[1m]", offers: ["default", "opus[1m]", "sonnet", "haiku"], keeping: "default", typed: true });
    const [said] = renderHints(/** @type {any} */ (note), { agentName: "Claude Code", firstTurn: false });
    assert.equal(said.mustSay, true);
    assert.equal(said.text, "“claude-fable-5-2[1m]”, the name you typed on its card, is not a model Claude Code offers, so it kept default (it offers default, opus[1m], sonnet, haiku).");
    assert.deepEqual(r.efforts, ["xhigh"], "its effort goes to the agent all the same");
  });

  // The owner's of 11-11: a model the account's API key offers (bridge.js `#keyOffers`), picked from the account's own
  // list, that Claude Code then does not take, was said only with the agent's hints on, as a name nobody chose.
  // (fails before: yes — the note had no `keyed`, named the id with its effort, and was not always said)
  test("a model from the account's API key it does not offer: the note names it as the key lists it, says where it came from, and is always said", async () => {
    const r = await apply("claude-fable-5-2-xhigh", [], { effort: "xhigh", keyed: ["claude-fable-5-2"] });
    assert.deepEqual(r.asked, []);
    const note = r.structured.find((s) => s.note.kind === "model-not-offered")?.note;
    assert.deepEqual(note, { kind: "model-not-offered", model: "claude-fable-5-2", offers: ["default", "opus[1m]", "sonnet", "haiku"], keeping: "default", keyed: true });
    assert.ok(r.notes.includes("acp: model claude-fable-5-2 (from the account's API key) not offered by this agent (offers default, opus[1m], sonnet, haiku); keeping default"), r.notes.join("\n"));
    const [said] = renderHints(/** @type {any} */ (note), { agentName: "Claude Code", firstTurn: false });
    assert.equal(said.mustSay, true);
    assert.equal(said.text, "“claude-fable-5-2”, which Anthropic lists for this account's API key, is not a model Claude Code offers, so it kept default (it offers default, opus[1m], sonnet, haiku).");
    assert.deepEqual(r.efforts, ["xhigh"]);
    const typed = (await apply("claude-fable-5-2", ["claude-fable-5-2"], { keyed: ["claude-fable-5-2"] })).structured.find((s) => s.note.kind === "model-not-offered")?.note;
    assert.deepEqual([typed?.typed, typed?.keyed], [true, undefined], "typed on the card as well: the card's word");
    assert.deepEqual((await apply("claude-fable-5-2", [], { offered: ["default", "claude-fable-5-2"], keyed: ["claude-fable-5-2"] })).asked, [["session/set_model", "claude-fable-5-2"]], "offered, it is taken");
  });

  // (fails before: yes — the near match took it, said as the closest match of the id with its effort)
  test("offered, it is taken exactly as the card holds it, and its effort is set on the session", async () => {
    const r = await apply("Claude-Fable-5-2[1m]-xhigh", ["claude-fable-5-2[1m]"], { offered: ["default", "claude-fable-5-2", "claude-fable-5-2[1m]"], effort: "xhigh" });
    assert.deepEqual(r.asked, [["session/set_model", "claude-fable-5-2[1m]"]]);
    assert.deepEqual(r.efforts, ["xhigh"]);
    assert.ok(r.notes.includes("acp: model default -> claude-fable-5-2[1m]"), r.notes.join("\n"));
    assert.equal(r.structured.some((s) => s.note.kind === "model-not-offered"), false);
  });

  // (fails before: no — this guards an agent's own id that ends in an effort, Cursor's way: it is taken whole, whatever
  // is typed)
  test("an id the agent offers whole is taken whole, its ending an effort or not", async () => {
    assert.deepEqual((await apply("gpt-5-xhigh", ["gpt-5"], { offered: ["gpt-5", "gpt-5-high", "gpt-5-xhigh"] })).asked, [["session/set_model", "gpt-5-xhigh"]]);
    assert.deepEqual((await apply("gpt-5-xhigh", ["gpt-5-xhigh"], { offered: ["gpt-5", "gpt-5-high", "gpt-5-xhigh"] })).asked, [["session/set_model", "gpt-5-xhigh"]]);
    assert.deepEqual((await apply("gpt-5-xhigh", [], { offered: ["gpt-5", "gpt-5-high", "gpt-5-xhigh"] })).asked, [["session/set_model", "gpt-5-xhigh"]]);
  });

  // (fails before: yes — there was no such reading: each compare took the id whole)
  test("the name as the card holds it: the id whole, else without Filament's effort and fast suffix; never a longer name's start", () => {
    const { typedName } = /** @type {any} */ (negotiate);
    assert.equal(typeof typedName, "function", "negotiate.js has no typedName");
    const typed = ["claude-fable-5-2[1m]", "claude-opus-5", "gpt-5-high"];
    assert.equal(typedName("claude-fable-5-2[1m]", typed), "claude-fable-5-2[1m]");
    assert.equal(typedName("CLAUDE-FABLE-5-2[1M]-XHigh", typed), "claude-fable-5-2[1m]", "case aside, as the card spells it");
    for (const e of ["low", "medium", "high", "xhigh", "max"]) assert.equal(typedName(`claude-fable-5-2[1m]-${e}`, typed), "claude-fable-5-2[1m]", e);
    assert.equal(typedName("claude-fable-5-2[1m]-xhigh-fast", typed), "claude-fable-5-2[1m]");
    assert.equal(typedName("claude-fable-5-2[1m]-fast-xhigh", typed), "claude-fable-5-2[1m]");
    assert.equal(typedName("gpt-5-high", typed), "gpt-5-high", "a typed name that is the id whole is that name");
    assert.equal(typedName("gpt-5-high-max", typed), "gpt-5-high");
    assert.equal(typedName("claude-opus-5-5", typed), null, "another model's name is no typed name with a suffix");
    assert.equal(typedName("claude-opus-5-5-xhigh", typed), null);
    assert.equal(typedName("claude-fable-5-2", typed), null);
    assert.equal(typedName("sonnet-xhigh", []), null);
    assert.equal(typedName("", typed), null);
    assert.equal(typedName(null, typed), null);
  });
});

// The owner's of 11-10: claude-fable-5-2[1m], typed on a Claude Code card, was never run — Claude Code offers only the
// models it lists, and one more named by ANTHROPIC_CUSTOM_MODEL_OPTION, which nothing set.
describe("Claude Code given a name typed on its card that it does not list", () => {
  const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
  /** @type {string} */
  let dir;
  /** @type {string} */
  let command;
  let n = 0;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-typed-custom-"));
    // The fake under the name of Claude Code's adapter, so Filament takes it for Claude Code — named by its path: a bare
    // name is looked up in npm's own folder before the PATH, where the person's real adapter is.
    if (process.platform === "win32") {
      copyFileSync(FAKE, join(dir, "fake-acp-agent.mjs"));
      copyFileSync(join(dirname(FAKE), "person-words.mjs"), join(dir, "person-words.mjs"));
      // npm's shim as it is written, which Filament reads to run the script with a node of its own (`shimScript`).
      writeFileSync(join(dir, "claude-agent-acp.cmd"), `@ECHO off\r\nSET dp0=%~dp0\r\n"${process.execPath}" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
      command = join(dir, "claude-agent-acp.cmd");
    } else {
      writeFileSync(join(dir, "claude-agent-acp"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
      chmodSync(join(dir, "claude-agent-acp"), 0o755);
      command = join(dir, "claude-agent-acp");
    }
  });
  after(async () => {
    await removeDirs(dir);
  });
  /**
   * A Claude Code card with these typed names, and a folder of its own holding `files` (its settings.json): no test
   * here reads the person's own Claude Code folder.
   * @param {Record<string, string>} [env] @param {string[]} [models] @param {string} [cmd] @param {Record<string, any>} [files]
   */
  const card = (env = {}, models = ["claude-fable-5-2[1m]"], cmd = command, files = {}) => {
    const home = mkdtempSync(join(dir, "home-"));
    for (const [name, json] of Object.entries(files)) writeFileSync(join(home, name), JSON.stringify(json));
    return {
      id: `cc${n++}`,
      name: "Claude Code",
      type: "acp",
      models,
      acp: { command: cmd, args: cmd === process.execPath ? [FAKE] : [], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SETTINGS: "1", ...env }, home, cwdDefault: dir, permissions: "allow-all", modelSelection: "session" },
    };
  };
  /** The models a turn's steps switched its session to. @type {string[]} */
  let switched = [];
  /** The efforts a turn's steps set on its session. @type {string[]} */
  let efforts = [];
  /** A turn of chat T on the model, at `effort` where Filament read one off its name. @param {any} b @param {any} up @param {string} model @param {string | null} [effort] */
  const turn = (b, up, model, effort = null) => {
    switched = [];
    efforts = [];
    const onEvent = (/** @type {any} */ e) => void (e?.type === "step" && (e.step === "model" ? switched.push(String(e.to)) : e.step === "effort" && efforts.push(String(e.to))));
    return b.run({ upstream: up, modelId: model, effort, format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "T", onEvent });
  };
  /** @param {any} out */
  const notOffered = (out) => out.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered")?.note;

  // (fails before: yes — the agent was never told the name: "not offered by this agent", its default kept)
  test("it runs in a process of its own that names it to Claude Code, and is taken; a listed model goes back to the process every listed one runs in", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    const up = card();
    try {
      assert.deepEqual((await b.listModels(up, { force: true })).names, ["opus[1m]", "sonnet"], "its own list, asked as ever: the typed name is not in it");
      const out = await turn(b, up, "claude-fable-5-2[1m]");
      assert.equal(notOffered(out), undefined, out.notes.join("\n"));
      assert.deepEqual(switched, ["claude-fable-5-2[1m]"], "the session is switched to it");
      assert.ok(out.notes.includes("acp: model claude-fable-5-2[1m]") && !out.notes.some((l) => /not applied/.test(l)), out.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2[1m]"]);
      const back = await turn(b, up, "sonnet");
      assert.equal(notOffered(back), undefined, back.notes.join("\n"));
      assert.deepEqual(switched, ["sonnet"], back.notes.join("\n"));
      assert.ok(back.notes.some((l) => /^acp: session \w+ (loaded|resumed) into default process$/.test(l)), back.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2[1m]", "default"]);
    } finally {
      b.shutdown();
    }
  });

  // The owner's of 11-11: every chat on the typed name came as "claude-fable-5-2[1m]-xhigh" — Filament's effort still on
  // it —, which was no typed name: no process of its own, and Claude Code answered on its default.
  // (fails before: yes — "not offered by this agent", in the process every listed model runs in)
  test("with Filament's effort riding on it, it runs in the one process of its own, named as the card holds it, and the effort is set", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    const up = card();
    try {
      await b.listModels(up, { force: true });
      const out = await turn(b, up, "claude-fable-5-2[1m]-xhigh", "xhigh");
      assert.equal(notOffered(out), undefined, out.notes.join("\n"));
      // Claude Code was named the bare name and offers it: the id is that model at the effort after it (`planVariant`).
      assert.ok(out.notes.includes("acp: model claude-fable-5-2[1m] (effort xhigh)"), out.notes.join("\n"));
      assert.equal(switched.length, 1, "the session is switched to it");
      assert.deepEqual(efforts, ["xhigh"], out.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2[1m]"]);
      const high = await turn(b, up, "claude-fable-5-2[1m]-high", "high");
      assert.equal(notOffered(high), undefined, high.notes.join("\n"));
      assert.ok(high.notes.includes("acp: model claude-fable-5-2[1m] (effort high)"), high.notes.join("\n"));
      assert.deepEqual([switched, efforts], [[], ["high"]], high.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2[1m]"], "another effort, the same process");
      await turn(b, up, "claude-fable-5-2[1m]");
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2[1m]"], "and the bare name's");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the note of a name with its effort had no `typed`: said only with the agent's hints on)
  test("not offered all the same — Claude Code's own settings name another — its note names it as the card holds it, typed", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    try {
      const theirs = card({}, ["claude-fable-5-2[1m]"], command, { "settings.json": { env: { ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-opus-6" } } });
      const note = notOffered(await turn(b, theirs, "claude-fable-5-2[1m]-xhigh", "xhigh"));
      assert.deepEqual(note, { kind: "model-not-offered", model: "claude-fable-5-2[1m]", offers: ["default", "opus[1m]", "sonnet", "claude-opus-6"], keeping: "default", typed: true });
      assert.equal(renderHints(/** @type {any} */ (note), { agentName: "Claude Code", firstTurn: false })[0].mustSay, true);
      assert.deepEqual(efforts, ["xhigh"]);
    } finally {
      b.shutdown();
    }
  });

  // The owner's of 11-11: the card's own ANTHROPIC_CUSTOM_MODEL_OPTION held the one place for a model Claude Code does
  // not list, so a name typed beside it never ran. The card's value stays the model of the process every listed one
  // runs in; any other typed name is the more specific word, and runs in a process of its own that Filament starts with
  // the variable naming it.
  // (fails before: yes — the card's variable stood for every process: "not offered by this agent", its default kept)
  test("the card's own ANTHROPIC_CUSTOM_MODEL_OPTION stays the shared process's; a typed name other than it runs in its own, named by it", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    try {
      const theirs = card({ ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-opus-6" }, ["claude-fable-5-2[1m]", "claude-opus-6"]);
      const typed = await turn(b, theirs, "claude-fable-5-2[1m]");
      assert.equal(notOffered(typed), undefined, typed.notes.join("\n"));
      assert.deepEqual(switched, ["claude-fable-5-2[1m]"], typed.notes.join("\n"));
      assert.deepEqual(b.processInfo(theirs.id)?.models, ["claude-fable-5-2[1m]"], "a process of its own, named by it");
      const own = await turn(b, theirs, "claude-opus-6");
      assert.equal(notOffered(own), undefined, own.notes.join("\n"));
      assert.deepEqual(switched, ["claude-opus-6"], "the shared process offers the card's own: it was started with it");
      assert.deepEqual(b.processInfo(theirs.id)?.models, ["claude-fable-5-2[1m]", "default"], "the card's own, picked, runs in the shared process");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — this guards that a listed name, or an agent that is not Claude Code, starts nothing more)
  test("a typed name Claude Code lists, and another agent's, start no process of their own", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    try {
      const listed = card({}, ["sonnet"]);
      await b.listModels(listed, { force: true });
      assert.equal(notOffered(await turn(b, listed, "sonnet")), undefined);
      assert.deepEqual(b.processInfo(listed.id)?.models, ["default"]);
      const other = card({}, ["claude-fable-5-2[1m]"], process.execPath);
      assert.equal(notOffered(await turn(b, other, "claude-fable-5-2[1m]"))?.typed, true);
      assert.deepEqual(b.processInfo(other.id)?.models, ["default"]);
    } finally {
      b.shutdown();
    }
  });

  // The re-read of 11-11: which process a typed name runs in was read off the bridge's own last listing, which a
  // restart empties, while the app's list is served from disk: a typed name Claude Code lists got a process of its own
  // after every restart, until a Refresh.
  // (fails before: yes — the bridge read no list but its own: a process of its own, named "sonnet")
  test("a bridge started afresh reads Claude Code's list as the server kept it: a typed name it lists starts no process of its own, one it lacks still does", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    const up = card({}, ["sonnet", "claude-fable-5-2[1m]"]);
    /** @type {any} */ (b).listedOf = (/** @type {string} */ id) => (id === up.id ? ["opus[1m]", "sonnet"] : null);
    try {
      assert.equal(notOffered(await turn(b, up, "sonnet")), undefined);
      assert.deepEqual(b.processInfo(up.id)?.models, ["default"], "the process every listed one runs in");
      assert.equal(notOffered(await turn(b, up, "claude-fable-5-2[1m]")), undefined);
      assert.deepEqual(b.processInfo(up.id)?.models, ["default", "claude-fable-5-2[1m]"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the Refresh's list held the name, so the chat's next turn loaded its session into the process
  // every listed model runs in, mid-chat)
  test("a Refresh moves no running chat: one whose session is open in a process named its model stays there; a new chat, and that one once its process is gone, follow the list", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    const up = card({}, ["sonnet"]);
    const moved = (/** @type {any} */ out) => out.notes.filter((/** @type {string} */ l) => /(loaded|resumed) into/.test(l));
    try {
      // Nothing listed yet, here or kept: the typed name gets its process.
      await turn(b, up, "sonnet");
      assert.deepEqual(b.processInfo(up.id)?.models, ["sonnet"]);
      assert.deepEqual((await b.listModels(up, { force: true })).names, ["opus[1m]", "sonnet"], "the Refresh: Claude Code lists it");
      const again = await turn(b, up, "sonnet");
      assert.deepEqual(moved(again), [], again.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["sonnet"], "the chat's session stays where it was opened");
      // Another chat, opened after the Refresh, runs where every listed model does.
      await b.run({ upstream: up, modelId: "sonnet", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "T2", onEvent: () => {} });
      assert.deepEqual(b.processInfo(up.id)?.models, ["sonnet", "default"]);
      // Its process gone, the first chat's session opens where the list says.
      assert.equal(b.killProcess(`${up.id}|sonnet`), true);
      const after = await turn(b, up, "sonnet");
      assert.deepEqual(moved(after).length, 1, after.notes.join("\n"));
      assert.match(moved(after)[0], /^acp: session \w+ (loaded|resumed) into default process$/);
      assert.deepEqual(b.processInfo(up.id)?.models, ["default"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — after the restart the turn ran in a process of its own, "cc|sonnet")
  test("through the app: Claude Code's list, kept with the models on disk, says after a restart where a typed name runs", async () => {
    const home = mkdtempSync(join(dir, "home-"));
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "cc", name: "Claude Code", type: "acp", models: ["sonnet"], acp: { command, args: [], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SETTINGS: "1" }, home, cwdDefault: dir, permissions: "allow-all", modelSelection: "session" } }];
      cfg.routes = [{ match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true }];
    };
    let shim = await startApp({ keep: true, configure });
    try {
      const listed = await (await shim.api("/api/models?refresh=1")).json();
      assert.deepEqual(listed.upstreams.cc.listed, ["opus[1m]", "sonnet"], "its own list, asked by the Refresh");
      await shim.stop();
      shim = await startApp({ keep: true, dataDir: shim.dataDir, configure });
      const res = await shim.post("/v1/messages", { model: "cc/sonnet", max_tokens: 100, system: `Working directory: ${dir}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": "typed-after-restart" });
      assert.equal(res.status, 200, await res.clone().text());
      const { processes } = await (await shim.api("/api/acp/status")).json();
      assert.deepEqual(processes.map((/** @type {any} */ p) => String(p.key)).filter((/** @type {string} */ k) => k.startsWith("cc|")), ["cc|"], "the process every listed model runs in");
    } finally {
      await shim.stop();
      await removeDirs(shim.dataDir);
    }
  });
});

describe("Codex and the words a person reads", () => {
  // (fails before: yes — the note said nothing of a typed name)
  test("Codex keeps its default for a typed name it does not list, and the note says the name was typed (OC-14)", () => {
    const items = [{ id: "gpt-6-astra", model: "gpt-6-astra", isDefault: true, supportedReasoningEfforts: [] }];
    const typed = selectCodexModel("gpt-6-nova", null, items, ["GPT-6-NOVA"]);
    assert.equal(typed.model, null);
    assert.deepEqual(typed.notes.at(-1), { kind: "model-not-offered", model: "gpt-6-nova", offers: ["gpt-6-astra"], keeping: "gpt-6-astra", typed: true });
    const plain = selectCodexModel("gpt-6-nova", null, items);
    assert.equal(/** @type {any} */ (plain.notes.at(-1)).typed, undefined);
  });

  // The owner's of 11-11, as Claude Code's above: a turn's model comes with Filament's effort still on it (acp-turn.js
  // `useFull`), and "gpt-6-nova-high" was no typed name: its note went unsaid.
  // (fails before: yes — the note named the id with its effort, and had no `typed`)
  test("Codex's note names a typed name without the effort Filament left on it, and says it was typed", () => {
    const items = [{ id: "gpt-6-astra", model: "gpt-6-astra", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "high" }] }];
    const r = selectCodexModel("gpt-6-nova-high", "high", items, ["GPT-6-NOVA"]);
    assert.equal(r.model, null);
    assert.deepEqual(r.notes.at(-1), { kind: "model-not-offered", model: "gpt-6-nova", offers: ["gpt-6-astra"], keeping: "gpt-6-astra", typed: true });
    assert.equal(r.effort, "high", "its effort still goes with Codex's default, which takes it");
    const listed = [...items, { id: "gpt-6-nova-high", model: "gpt-6-nova-high", supportedReasoningEfforts: [] }];
    assert.equal(selectCodexModel("gpt-6-nova-high", "high", listed, ["gpt-6-nova"]).model, "gpt-6-nova-high", "an id Codex lists whole is taken whole");
    assert.equal(/** @type {any} */ (selectCodexModel("gpt-6-novak-high", "high", items, ["gpt-6-nova"]).notes.at(-1)).typed, undefined, "never a longer name's start");
  });

  // (fails before: yes — the line went out only with the agent's hints switched on)
  test("a typed name not offered is always said, once per conversation; another name only where hints are on (OC-10, OC-14)", () => {
    const note = { kind: "model-not-offered", model: "opus", offers: ["sonnet"], keeping: "default" };
    const [typed] = renderHints(/** @type {any} */ ({ ...note, typed: true }), { agentName: "Claude", firstTurn: true });
    assert.equal(typed.mustSay, true);
    assert.equal(typed.text, "“opus”, the name you typed on its card, is not a model Claude offers, so it kept default (it offers sonnet).");
    const [plain] = renderHints(/** @type {any} */ (note), { agentName: "Claude", firstTurn: true });
    assert.equal(plain.mustSay, false);
  });
});

describe("the catalogue: a typed name in every picker, and the names the upstream listed itself", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    up = await fakeUpstream((call) => (call.kind === "models" ? { json: { data: [{ id: "zeta-5" }, { id: "zeta-5-mini" }] } } : undefined));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "k", enabled: true, models: ["zeta-6-preview"] }];
        cfg.routes = [{ match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  // (fails before: yes — the answer had no list of the upstream's own, so a typed name could not be told from a listed one)
  test("the typed name is offered beside the listed ones (OC-1), and the upstream's own list comes apart (OC-5)", async () => {
    const before = await (await shim.api("/api/models")).json();
    assert.ok(before.models.some((/** @type {any} */ m) => m.id === "zeta/zeta-6-preview"), "typed: offered before the provider is ever asked");
    assert.equal(before.upstreams.zeta.listed, undefined, "never asked: no list is claimed (OC-6)");
    const after = await (await shim.api("/api/models?refresh=1")).json();
    assert.deepEqual(after.upstreams.zeta.listed, ["zeta-5", "zeta-5-mini"]);
    assert.ok(after.upstreams.zeta.all.includes("zeta-6-preview"));
    assert.ok(after.models.some((/** @type {any} */ m) => m.id === "zeta/zeta-6-preview"), "a Refresh never takes a typed name away (OC-16)");
    const families = after.families.map((/** @type {any} */ f) => f.id);
    assert.ok(families.includes("zeta/zeta-6-preview"), "the harness's picker offers it");
  });
});

describe("the card's box and rows, on the fake DOM", () => {
  /** @type {any} */
  const state = runtimeState;
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  /** @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
  const all = (el, ok, out = /** @type {any[]} */ ([])) => {
    if (!el || typeof el !== "object") return out;
    if (ok(el)) out.push(el);
    for (const k of el.kids || []) all(k, ok, out);
    return out;
  };
  const cls = (/** @type {string} */ c) => (/** @type {any} */ n) => String(n.attrs?.class || "").split(/\s+/).includes(c);
  /** @type {string[]} */
  let toasts;
  /** @type {any[]} */
  let saves;
  /** @type {string | null} */
  let refuseSave;
  /** @type {string[] | undefined} */
  let listed;
  const member = (/** @type {string} */ name) => ({ id: `zeta/${name}`, name, effort: null, speed: null, thinking: null, window: null, source: "discovered" });
  const fam = (/** @type {string} */ name) => ({ id: `zeta/${name}`, kind: "model", name, lead: `zeta/${name}`, members: [member(name)] });
  beforeEach(() => {
    /** @type {any} */ (globalThis).location = { search: "" };
    toasts = [];
    saves = [];
    refuseSave = null;
    listed = ["zeta-5"];
    const cfg = { upstreams: [{ id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: "http://z", enabled: true, models: ["my-typed"] }], routes: [{ match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", enabled: true }], rules: {} };
    Object.assign(state, { tab: "upstreams", addUp: false, addFlow: null, justAdded: null, dirty: false, requests: [], _providers: { providers: [] }, _usage30: null, config: cfg, saved: structuredClone(cfg), selUp: "zeta",
      schema: { upstreamTypes: { "openai-compatible": { label: "OpenAI-compatible server (…)", formats: ["openai"] } }, upstream: {} } });
    bindUi({
      h: fakeH, fmt,
      // The page's whole save (app.js `putConfig`, which names the draft's version: test/config-follow.test.js).
      putConfig: async (/** @type {any} */ body) => {
        if (refuseSave) throw new Error(refuseSave);
        saves.push(structuredClone(body));
        return { config: structuredClone(body) };
      },
      api: async (/** @type {string} */ path) => {
        if (path === "/models/caps") return { models: [{ id: "zeta/zeta-5", caps: null }, { id: "zeta/my-typed", caps: null }], errors: [], agent: false, families: [fam("zeta-5"), fam("my-typed")] };
        if (path.startsWith("/models")) return { models: [{ id: "zeta/zeta-5", upstream: "zeta", upstreamModel: "zeta-5", source: "discovered" }, { id: "zeta/my-typed", upstream: "zeta", upstreamModel: "my-typed", source: "discovered" }], upstreams: { zeta: { count: 2, source: "cache", all: ["zeta-5", "my-typed"], ...(listed ? { listed } : {}) } } };
        return path.startsWith("/usage") ? { total: { rows: [] } } : {};
      },
      toast: (/** @type {string} */ m) => toasts.push(m), render() {}, markDirty: (/** @type {boolean} */ on = true) => { state.dirty = on; },
      input: (/** @type {any} */ u, /** @type {string} */ k) => fakeH("input", { value: u[k] || "", "data-field": k }), idInput: () => fakeH("input"), flatten: (/** @type {any} */ o) => o || {}, openRulesDrawer() {}, mergedRules() {}, removeUpstream() {},
      goto: (/** @type {string} */ _t, /** @type {string} */ l) => fakeH("a", {}, l), intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k), md: (/** @type {string} */ s) => s,
      store: { get: () => null, set() {} }, pingResult: () => fakeH("span"), memAgo: () => "now", empty: () => fakeH("div"),
      schemaForm: () => fakeH("div"), bridgeModes: () => [], BRIDGE_HINT: {},
    });
  });
  const panel = async () => {
    const page = upstreams();
    await settle();
    return all(page, cls("models-box"))[0];
  };
  /** Types a name in the box and presses Add. @param {any} box @param {string} name */
  const add = async (box, name) => {
    const input = all(box, (n) => n.tag === "input" && n.attrs?.["aria-label"] === "A model name to ping or add")[0];
    input.value = name;
    const btn = all(box, (n) => n.tag === "button" && textOf(n) === "Add")[0];
    btn.dispatch("click");
    await settle();
  };
  const up = () => state.config.upstreams[0];
  /** What a node reads as one line: the fake DOM's text pieces, joined as the page shows them. @param {any} n */
  const said = (n) => textOf(n).split("|").join("");
  const out = (/** @type {any} */ box) => said(all(box, cls("ping-custom-out"))[0]);

  // (fails before: yes — the box only pinged, and nothing typed was kept)
  test("Add keeps a new name, saved at once when nothing else waits, and says it is not in the provider's list (OC-1, OC-5)", async () => {
    await add(await panel(), "  zeta-6-preview ");
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].upstreams[0].models, ["my-typed", "zeta-6-preview"]);
    assert.equal(toasts.at(-1), "zeta-6-preview is kept. It is not in Zeta's own list: Ping tells whether it answers. Saved.");
    assert.equal(state.dirty, false);
  });

  // (fails before: yes — nothing was kept)
  test("with other changes unsaved it joins them and says so; nothing is saved behind your back (OC-2)", async () => {
    state.dirty = true;
    await add(await panel(), "zeta-6-preview");
    assert.equal(saves.length, 0);
    assert.deepEqual(up().models, ["my-typed", "zeta-6-preview"]);
    assert.match(toasts.at(-1) || "", /In your unsaved changes: press Save changes \(top right\)\.$/);
  });

  // (fails before: yes — there was no Add to refuse anything)
  test("a name already listed, or already typed in another case, is not added twice; a comma is refused (OC-3, OC-7, OC-8)", async () => {
    const box = await panel();
    await add(box, "zeta-5");
    assert.match(out(box), /zeta-5 is in Zeta's own list already/);
    await add(box, "MY-TYPED");
    assert.match(out(box), /MY-TYPED is one of the names you typed already/);
    await add(box, "a,b");
    assert.match(out(box), /A model name has no comma/);
    assert.equal(saves.length, 0);
    assert.deepEqual(up().models, ["my-typed"]);
  });

  // (fails before: yes — a hidden name stayed hidden)
  test("Add on a name you hid shows it again (OC-4)", async () => {
    up().hiddenModels = ["zeta-5"];
    state.saved = structuredClone(state.config);
    await add(await panel(), "zeta-5");
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].upstreams[0].hiddenModels, []);
    assert.deepEqual(saves[0].upstreams[0].models, ["my-typed"], "a listed name is shown again, not typed");
    assert.equal(toasts.at(-1), "zeta-5 is shown again. Saved.");
  });

  // (fails before: yes — nothing claimed or not, since nothing was kept)
  test("a provider never asked claims nothing about its list (OC-6)", async () => {
    listed = undefined;
    await add(await panel(), "zeta-6-preview");
    assert.equal(toasts.at(-1), "zeta-6-preview is kept. Saved.");
  });

  // (fails before: yes — a typed name looked like any listed one, and only the comma field could remove it)
  test("a typed row says so, with the list it is not in, and its × takes it off your typed names (OC-9)", async () => {
    const box = await panel();
    const row = all(box, (n) => n.tag === "tr" && n.attrs?.["data-family"] === "zeta/my-typed")[0];
    const mark = all(row, cls("typed-mark"))[0];
    assert.match(said(mark), /^ · typed, not in its list×$/);
    assert.ok(!all(box, (n) => n.tag === "tr" && n.attrs?.["data-family"] === "zeta/zeta-5").some((r) => all(r, cls("typed-mark")).length), "a listed name has no mark");
    all(mark, cls("typed-x"))[0].dispatch("click");
    await settle();
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].upstreams[0].models, []);
    assert.equal(toasts.at(-1), "my-typed is no longer one of your typed names. Saved.");
  });

  // (fails before: yes — there was no save to fail)
  test("a save that fails puts the lists back and says why", async () => {
    refuseSave = "the server said no";
    await add(await panel(), "zeta-6-preview");
    assert.deepEqual(up().models, ["my-typed"]);
    assert.equal(toasts.at(-1), "the server said no");
  });
});
