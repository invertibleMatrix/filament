// @ts-check
// Another model than the chat's answered (core/answering-model.js), through the bridges and the app, over the fake
// agents: each engine names the model that answered a turn (`agentModel`), a set its agent answered with another model
// is known before any reply, and where the two differ Filament says so — under the turn on a harness chat's page, in
// the reply's own line for a client that draws none, in the report of a sub-agent's run — once for a pair of names, and
// again when the model that answered changes; a restart keeps that it was said, and the turn's facts say it each time.
// The comparer's cases, the note's words and the footer's segment are in answering-model.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AcpBridge } from "../src/acp.js";
import { applySessionSettings } from "../src/adapters/agents/acp/configure.js";
import { selectSdkModel } from "../src/cursor-sdk.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { disposeTokenCalib, initTokenCalib, observeCountedModel } from "../src/services/token-calib.js";
import { factsLine, shimLineOf } from "../src/ui/harness/lib/labels.js";
import { askedState, cardFacts, cardState } from "../src/ui/harness/conversation/agent-card.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE = join(FIXTURES, "fake-acp-agent.mjs");
const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const FAKE_SDK = pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href;
/** What an agent's card and viewer say of the model that answered (the page's lib). */
const pageWords = () => import("../src/ui/harness/lib/subagents.js");

/** The note's words, for an agent of this name. @param {string} agent @param {string} answered @param {string} chosen @param {"not-offered" | "rerouted" | null} [why] */
const WORDS = (agent, answered, chosen, why = null) =>
  `This reply came from ${answered}, not ${chosen}, the model this chat names: ${why === "not-offered" ? `${agent} does not offer that model on this account and kept its own.` : why === "rerouted" ? `${agent} sent the turn to another model.` : `${agent} answered on its own model, most likely because this account is not offered that one.`} To get the model you choose, pick one ${agent} lists for this account in the model menu.`;

describe("the set is verified (ACP)", () => {
  /**
   * The model step over a recording agent that offers Claude's models as a model option, and answers each set with
   * `current` as its current model (none: the value set).
   * @param {string} modelId @param {string | null} current
   */
  const apply = async (modelId, current) => {
    /** @type {string[]} */
    const notes = [];
    const options = (/** @type {string} */ value) => [{ id: "model", type: "select", currentValue: value, options: [{ value: "default" }, { value: "opus[1m]" }, { value: "sonnet" }] }];
    const proc = { request: async (/** @type {string} */ _method, /** @type {any} */ params) => ({ configOptions: options(current ?? params.value) }) };
    const conv = { sessionId: "s1", availableModels: ["default", "opus[1m]", "sonnet"], modelId: "default", modelLabels: {}, modelConfig: true, modelConfigId: "model" };
    await applySessionSettings({ proc, conv, acp: { modelSelection: "session" }, modelId, typed: [], effort: null, mode: "", modeOverride: null, notes, structured: [] });
    return { notes, conv };
  };

  // (fails before: yes — the answer's current model was read into the session and overwritten with the one set: the
  // session said "sonnet" while its agent had said it stayed on opus[1m], and nothing was noted)
  test("an answer that names another current model than the one set: the session's model is the agent's word, and the record says so", async () => {
    const r = await apply("sonnet", "opus[1m]");
    assert.equal(r.conv.modelId, "opus[1m]", "the model the agent says it is on");
    assert.deepEqual(r.notes.filter((n) => /model/.test(n)), ["acp: the agent answered the set of model sonnet with opus[1m] as its current model, and is kept on it", "acp: model sonnet"], "what came of the set, and the set it sent");
  });

  // (fails before: no — guards that a set its agent took says nothing more)
  test("an answer that names the model set, in any case, or none says nothing", async () => {
    const took = await apply("sonnet", null);
    assert.equal(took.conv.modelId, "sonnet");
    assert.deepEqual(took.notes.filter((n) => /model/.test(n)), ["acp: model sonnet"]);
    const cased = await apply("sonnet", "Sonnet");
    assert.deepEqual(cased.notes.filter((n) => /model/.test(n)), ["acp: model sonnet"]);
  });
});

describe("the bridge names the model that answered (ACP)", () => {
  /** @type {string} */
  let dir;
  let n = 0;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-other-model-bridge-"));
  });
  after(async () => {
    await removeDirs(dir);
  });
  /** An agent that picks its model per session, as Claude's adapter does. @param {Record<string, string>} [env] */
  const card = (env = {}) => ({ id: `om${n++}`, name: "Fake Claude", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1", ...env }, cwdDefault: dir, permissions: "allow-all", modelSelection: "session" } });
  /**
   * A turn on the model: its result, and the model its facts named as its session came up, before any reply.
   * @param {any} b @param {any} up @param {string} model
   */
  const turn = async (b, up, model) => {
    /** @type {any} */
    let atStart = "(no session event)";
    const onEvent = (/** @type {any} */ e) => void (e?.type === "session" && (atStart = e.facts?.agentModel ?? null));
    const out = await b.run({ upstream: up, modelId: model, format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "T", onEvent });
    return { out, atStart };
  };

  // (fails before: yes — an ACP turn's result named no model: `agentModel` was Codex's and Cursor's SDK's alone)
  test("the counted model that read the most is the turn's, whatever the session was set to", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    try {
      const { out } = await turn(b, card(), "sonnet");
      assert.deepEqual([out.agentModel, out.modelUsage?.[0]?.model], ["claude-sonnet-5", "claude-sonnet-5"], "the fake answers on what it was set to");
      const other = await turn(b, card({ FAKE_ACP_ANSWERS_ON: "claude-opus-5-5" }), "sonnet");
      assert.equal(other.out.agentModel, "claude-opus-5-5", "an agent that took the set and answered on another model");
      assert.ok(other.out.notes.includes("acp: model sonnet") && !other.out.notes.some((/** @type {string} */ l) => /answered the set/.test(l)), other.out.notes.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the set's answer was overwritten, and the turn's facts named no model at all)
  test("a set answered with another current model is known as the session comes up, before any reply", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    try {
      const { out, atStart } = await turn(b, card({ FAKE_ACP_KEEPS_MODEL: "opus[1m]" }), "sonnet");
      assert.equal(atStart, "opus[1m]", "what the agent's answer to the set named, on the facts the turn starts with");
      assert.equal(out.modelKept, true, "the agent's own word that it is not on the model set");
      assert.ok(out.notes.includes("acp: the agent answered the set of model sonnet with opus[1m] as its current model, and is kept on it"), out.notes.join("\n"));
      assert.equal(out.agentModel, "claude-opus-5", "and the model its turn was counted on, once it answered");
    } finally {
      b.shutdown();
    }
  });
});

describe("Cursor's SDK", () => {
  const items = [{ id: "auto-smart", displayName: "Auto" }, { id: "composer-2.5", displayName: "Composer 2.5", aliases: ["composer"] }];
  // (fails before: yes — the fallback was a sentence alone: nothing but its words said a model was not offered)
  test("a model it does not offer falls back as a fact beside its sentence", () => {
    const sel = /** @type {any} */ (selectSdkModel("gpt-9", null, items));
    assert.equal(sel.selection.id, "auto-smart");
    assert.deepEqual(sel.refused, { kind: "model-not-offered", model: "gpt-9", offers: ["auto-smart", "composer-2.5"], keeping: "auto-smart" });
    assert.equal(sel.notes[sel.refusedAt], "sdk: model gpt-9 not offered by Cursor (offers auto-smart, composer-2.5); using auto-smart", "the record's sentence stays");
    assert.equal(/** @type {any} */ (selectSdkModel("composer", null, items)).refused, undefined);
  });
});

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-other-model-"));
  const projDir = join(root, "project");
  /** The model the `other` agent answers on, as its file names it: empty, what it was set to. */
  const answers = join(root, "answers-on.txt");
  /** @param {string} model */
  const answerOn = (model) => writeFileSync(answers, model);
  const configure = (/** @type {any} */ cfg) => {
    /** @param {Record<string, string>} env @param {Record<string, unknown>} [more] */
    const acp = (env, more = {}) => ({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false, ...more });
    cfg.upstreams = [
      // Claude as it should be: it answers on what it was set to.
      { id: "claude", name: "claude", type: "acp", acp: acp({}) },
      // Claude as the owner met it on 11-10: it takes the name and answers on another model, saying nothing.
      { id: "other", name: "Other Claude", type: "acp", acp: acp({ FAKE_ACP_ANSWERS_ON: `@${answers}` }) },
      // An agent that picks its model per session and does not take the set: its answer names the model it stays on.
      { id: "kept", name: "Kept", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_KEEPS_MODEL: "opus[1m]" }, cwdDefault: projDir, permissions: "allow-all", hints: false, modelSelection: "session" } },
      // The same, on a model whose name says nothing of whose it is.
      { id: "tier", name: "Tier", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_KEEPS_MODEL: "lite-tier" }, cwdDefault: projDir, permissions: "allow-all", hints: false, modelSelection: "session" } },
      // An agent whose session comes back on another model than the one it was set to, and takes the set again.
      { id: "reopens", name: "Reopens", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume", FAKE_ACP_REOPENS_ON: "opus[1m]" }, cwdDefault: projDir, permissions: "allow-all", hints: false, modelSelection: "session" } },
      // Claude Code as the owner met it on 11-17: a resumed session names the model it was set to and runs on its default.
      { id: "drifts", name: "Drifts", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume", FAKE_ACP_REOPENS_SAYS: "opus[1m]" }, cwdDefault: projDir, permissions: "allow-all", hints: false, modelSelection: "session" } },
      // Codex whose thread says it is on another model than the one asked for.
      { id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_THREAD_MODEL: "gpt-6-mini" }, cwdDefault: projDir, permissions: "allow-all" } },
      { id: "cursor", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
    ];
    cfg.routes = ["claude", "other", "kept", "tier", "reopens", "drifts", "codex", "cursor"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
    cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  };
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    answerOn("claude-opus-5-5");
    shim = await startApp({ memory: true, keep: true, overrides: { cursorSdkLoader: () => import(FAKE_SDK) }, configure });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root, shim.dataDir);
  });
  /** A harness session on a model. @param {string} model @param {Record<string, unknown>} [settings] */
  const session = async (model, settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", ...(settings ? { settings } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn's record and reply, once its run's account is on the record. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const reply = await res.text();
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, `${runId}'s record`);
    return { rec, reply };
  };
  /** The facts of the session's newest turn, once they name its model. @param {string} id */
  const factsOf = (id) =>
    until(async () => {
      const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      const facts = tr.turns.at(-1)?.facts;
      return facts?.model ? facts : null;
    }, "the turn's facts");
  /** An outside client's turn: its reply's words and its record. @param {string} model @param {string} chat @param {any[]} messages */
  const outside = async (model, chat, messages) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 200, system: `Working directory: ${projDir}`, messages }, { "x-session-id": chat });
    assert.equal(res.status, 200, await res.clone().text());
    const id = String(res.headers.get("x-filament-request-id"));
    const text = (await res.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    const rec = await until(async () => ((await shim.record(id))?.acp ? shim.record(id) : null), `${id}'s record`);
    return { text, rec };
  };
  const FABLE = "claude-fable-5-2[1m]";
  const SAID = WORDS("Other Claude", "claude-opus-5-5", FABLE);

  // (fails before: yes — the incident of 11-10: the record named no answering model, the footer said "answered by" the
  // model asked for, and nothing in the chat said another model had written the reply)
  test("a harness chat's turn answered by another model says so under the turn, on its record and in its facts — once; a restart keeps that it was said; a change of the model that answered says it again", async () => {
    answerOn("claude-opus-5-5");
    const id = await session(`other/${FABLE}`);
    const first = await turn(id, "~ran");
    assert.equal(first.rec.upstreamModel, FABLE);
    assert.equal(first.rec.acp.agentModel, "claude-opus-5-5", "the model its own messages name");
    assert.deepEqual(first.rec.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5", said: SAID });
    assert.ok(first.rec.changes.includes(`acp: answered by claude-opus-5-5, not ${FABLE}, the model asked for`), first.rec.changes.join("\n"));
    assert.ok(first.rec.changes.includes(`acp: hint shown to the user: ${SAID}`), first.rec.changes.join("\n"));
    assert.ok(!first.reply.includes("_filament:") && !first.reply.includes("This reply came from"), "never in the reply's own words, which the agent's next turn reads");
    // The page reads it off the turn's facts: the paragraph under the turn, and the footer's model in the warning tone.
    const facts = await factsOf(id);
    assert.deepEqual([facts.model, facts.agentModel, facts.otherModel], [FABLE, "claude-opus-5-5", { chosen: FABLE, answered: "claude-opus-5-5", said: SAID }]);
    assert.deepEqual(shimLineOf({ facts }), { kind: "note", text: SAID, warn: true });
    assert.deepEqual(factsLine(facts).filter((s) => s.tone).map((s) => [s.id, s.text, s.tone]), [["model", "answered by Claude Opus 5.5 · chosen Claude Fable 5.2 · 1M", "warn"]]);

    // The chat's next turn: the same pair. Its footer says it, its words are not said again.
    const second = await turn(id, "~ran");
    assert.deepEqual(second.rec.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5" });
    assert.ok(!second.rec.changes.some((/** @type {string} */ c) => c.startsWith("acp: hint shown to the user")), second.rec.changes.join("\n"));
    assert.equal(shimLineOf({ facts: await factsOf(id) }), null);
    assert.deepEqual(factsLine(await factsOf(id)).filter((s) => s.tone).map((s) => s.text), ["answered by Claude Opus 5.5 · chosen Claude Fable 5.2 · 1M"], "every such turn's footer");

    // A restart: the chat keeps what it was told.
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir: shim.dataDir, overrides: { cursorSdkLoader: () => import(FAKE_SDK) }, configure });
    const third = await turn(id, "~ran");
    assert.deepEqual(third.rec.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5" }, "not said again after a restart");

    // The model that answered changes: said again, with the new name.
    answerOn("claude-sonnet-5-5");
    const fourth = await turn(id, "~ran");
    assert.deepEqual(fourth.rec.acp.otherModel, { chosen: FABLE, answered: "claude-sonnet-5-5", said: WORDS("Other Claude", "claude-sonnet-5-5", FABLE) });

    // It answers on the model it was set to: nothing to say, and the chat forgets what it was told —
    answerOn("");
    const fifth = await turn(id, "~ran");
    assert.deepEqual([fifth.rec.acp.agentModel, fifth.rec.acp.otherModel], ["claude-fable-5-2", undefined]);
    assert.deepEqual(factsLine(await factsOf(id)).filter((s) => s.tone), [], "a turn answered by its model warns of nothing");
    // — so the same pair, back again, is said again.
    answerOn("claude-sonnet-5-5");
    const sixth = await turn(id, "~ran");
    assert.equal(sixth.rec.acp.otherModel?.said, WORDS("Other Claude", "claude-sonnet-5-5", FABLE));
    answerOn("claude-opus-5-5");
  });

  // (fails before: yes — an ACP turn's record named no model that answered; that it says nothing more is the guard:
  // a turn answered by its own model, under its marks or its alias, raises no note)
  test("a turn answered by the model it asked for says nothing: an alias, a window mark", async () => {
    const alias = await turn(await session("claude/haiku"), "~ran");
    assert.deepEqual([alias.rec.acp.agentModel, alias.rec.acp.otherModel], ["claude-haiku-5", undefined]);
    const marked = await turn(await session(`claude/${FABLE}`), "~ran");
    assert.deepEqual([marked.rec.acp.agentModel, marked.rec.acp.otherModel], ["claude-fable-5-2", undefined]);
    assert.ok(![...alias.rec.changes, ...marked.rec.changes].some((/** @type {string} */ c) => /answered by|hint shown/.test(c)));
    // A name that may be any model's (an alias, no version in it and no family's word), answered by a model: nothing
    // is said on a guess, and its footer warns of nothing.
    answerOn("claude-opus-5-5");
    const id = await session("other/prod-large");
    const guess = await turn(id, "~ran");
    assert.deepEqual([guess.rec.acp.agentModel, guess.rec.acp.otherModel], ["claude-opus-5-5", undefined]);
    assert.ok(!guess.rec.changes.some((/** @type {string} */ c) => /answered by|hint shown/.test(c)), guess.rec.changes.join("\n"));
    assert.deepEqual(factsLine(await factsOf(id)).filter((s) => s.tone), []);
  });

  // (fails before: yes — a failed turn's record named neither the model that answered nor that it was another)
  test("a turn that failed after another model answered keeps both names on its record, and the chat's next turn says the words", async () => {
    answerOn("claude-opus-5-5");
    const id = await session(`other/${FABLE}`);
    const failed = await turn(id, "~spentfail");
    assert.equal(failed.rec.status, "error");
    assert.deepEqual([failed.rec.acp.agentModel, failed.rec.acp.otherModel], ["claude-opus-5-5", { chosen: FABLE, answered: "claude-opus-5-5" }], "its footer says it; its banner is the failure's");
    assert.ok(failed.rec.changes.includes(`acp: answered by claude-opus-5-5, not ${FABLE}, the model asked for`), failed.rec.changes.join("\n"));
    const next = await turn(id, "~ran");
    assert.equal(next.rec.acp.otherModel?.said, SAID, "the words, on the first turn that can carry them");
  });

  // (fails before: yes — an outside client's reply said nothing of it, with hints off or on)
  test("an outside client reads it in the reply's own line, once for the chat, whatever the hints setting", async () => {
    answerOn("claude-opus-5-5");
    const one = await outside(`other/${FABLE}`, "outside-1", [{ role: "user", content: "~ran" }]);
    assert.equal(one.text.split("_filament:").length - 1, 1, one.text);
    assert.ok(one.text.includes(`_filament: ${SAID}_`), one.text);
    assert.deepEqual(one.rec.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5" }, "its words are the reply's, not a page's");
    const two = await outside(`other/${FABLE}`, "outside-1", [{ role: "user", content: "~ran" }, { role: "assistant", content: "ran" }, { role: "user", content: "~ran again" }]);
    assert.ok(!two.text.includes("_filament:"), two.text);
    assert.deepEqual(two.rec.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5" });
  });

  // (fails before: yes — the session said the model it had set, and the turn named none)
  test("a set the agent answered with another model is said before any reply, the agent's word for its model in it", async () => {
    const one = await outside("kept/sonnet", "kept-1", [{ role: "user", content: "hello" }]);
    const line = `_filament: ${WORDS("Kept", "opus[1m]", "sonnet")}_`;
    assert.ok(one.text.includes(line), one.text);
    assert.ok(one.text.indexOf(line) < one.text.indexOf("hello"), `before the agent's first word: ${one.text}`);
    assert.ok(one.rec.changes.includes("acp: the agent answered the set of model sonnet with opus[1m] as its current model, and is kept on it"), one.rec.changes.join("\n"));
    // Its turn was counted on that model's own name: the same model, so the line is said once.
    assert.equal(one.text.split("_filament:").length - 1, 1, one.text);
    assert.deepEqual(one.rec.acp.otherModel, { chosen: "sonnet", answered: "claude-opus-5" });
  });

  // (fails before: yes — two names that may be one model said nothing, though the agent itself had answered the set
  // with the other)
  test("a set the agent answered with another model is said whatever the two names are: the agent's own word that it is not on the model asked for", async () => {
    const one = await outside("tier/sonnet", "tier-1", [{ role: "user", content: "hello" }]);
    assert.ok(one.rec.changes.includes("acp: the agent answered the set of model sonnet with lite-tier as its current model, and is kept on it"), one.rec.changes.join("\n"));
    assert.deepEqual(one.rec.acp.otherModel, { chosen: "sonnet", answered: "lite-tier" });
    assert.equal(one.text.split("_filament:").length - 1, 1, one.text);
    assert.ok(one.text.includes(`_filament: ${WORDS("Tier", "lite-tier", "sonnet")}_`), one.text);
  });

  // (fails before: yes — a session that came back on another model than the one kept said nothing of it)
  test("a session that reopens on another model than the one kept says so on its record, and is set to the chat's model again", async () => {
    const one = await outside("reopens/sonnet", "reopens-1", [{ role: "user", content: "hello" }]);
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir: shim.dataDir, overrides: { cursorSdkLoader: () => import(FAKE_SDK) }, configure });
    const two = await outside("reopens/sonnet", "reopens-1", [{ role: "user", content: "hello" }, { role: "assistant", content: one.text }, { role: "user", content: "hello again" }]);
    assert.ok(two.rec.changes.includes("acp: the reopened session is on model opus[1m], not sonnet as kept"), two.rec.changes.join("\n"));
    assert.ok(two.rec.changes.includes("acp: model sonnet"), two.rec.changes.join("\n"));
    // It took the set: answered by the model the chat names, and nothing to say.
    assert.deepEqual([one.rec.acp.agentModel, two.rec.acp.agentModel, two.rec.acp.otherModel], ["claude-sonnet-5", "claude-sonnet-5", undefined]);
    assert.ok(!two.text.includes("_filament:"), two.text);
  });

  // (fails before: yes — the owner's of 11-17: a follow-up to a sub-agent launched on Fable was answered by Opus, Claude
  // Code's default: the resumed session named the model it was launched on, and Filament set none)
  test("a session that reopens naming the model kept, while its agent runs on its default, is set to the chat's model again: one set, the first turn after", async () => {
    // An offered id whole (the agent's own option, configure.js planVariant), and a name it takes its closest match for
    // (the session branch, `matchOffered`).
    const one = await outside("drifts/opus[1m]", "drifts-1", [{ role: "user", content: "hello" }]);
    const near = await outside("drifts/opus", "drifts-2", [{ role: "user", content: "hello" }]);
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir: shim.dataDir, overrides: { cursorSdkLoader: () => import(FAKE_SDK) }, configure });
    const two = await outside("drifts/opus[1m]", "drifts-1", [{ role: "user", content: "hello" }, { role: "assistant", content: one.text }, { role: "user", content: "hello again" }]);
    const nearTwo = await outside("drifts/opus", "drifts-2", [{ role: "user", content: "hello" }, { role: "assistant", content: near.text }, { role: "user", content: "hello again" }]);
    for (const r of [two, nearTwo]) assert.ok(r.rec.changes.includes("acp: model opus[1m] set again: the session reopened, and its word for its model is not proof it runs on it"), r.rec.changes.join("\n"));
    assert.deepEqual([one.rec.acp.agentModel, two.rec.acp.agentModel, two.rec.acp.otherModel], ["claude-opus-5", "claude-opus-5", undefined], "answered on the model it was launched on");
    assert.deepEqual([near.rec.acp.agentModel, nearTwo.rec.acp.agentModel], ["claude-opus-5", "claude-opus-5"]);
    const three = await outside("drifts/opus[1m]", "drifts-1", [{ role: "user", content: "hello" }, { role: "assistant", content: one.text }, { role: "user", content: "hello again" }, { role: "assistant", content: two.text }, { role: "user", content: "and again" }]);
    assert.ok(!three.rec.changes.some((/** @type {string} */ c) => /set again/.test(c)), "the next turn on the open session sets nothing: " + three.rec.changes.join("\n"));
  });

  // (fails before: yes — the model asked for stood as the one that answered, whatever the thread said)
  test("Codex: the thread's own word for its model is the turn's, even where one was asked for", async () => {
    const one = await outside("codex/gpt-6-astra", "codex-1", [{ role: "user", content: "hello" }]);
    assert.equal(one.rec.upstreamModel, "gpt-6-astra");
    assert.equal(one.rec.acp.agentModel, "gpt-6-mini");
    assert.deepEqual(one.rec.acp.otherModel, { chosen: "gpt-6-astra", answered: "gpt-6-mini" });
    assert.ok(one.text.includes(`_filament: ${WORDS("Codex", "gpt-6-mini", "gpt-6-astra")}_`), one.text);
  });

  // (fails before: yes — a turn Codex moved to another model said so in a sentence on its record alone)
  test("Codex: a turn it moves to another model says so, with why", async () => {
    const one = await outside("codex/gpt-6-astra", "codex-2", [{ role: "user", content: "~reroute" }]);
    assert.deepEqual([one.rec.acp.agentModel, one.rec.acp.otherModel], ["gpt-6-nano", { chosen: "gpt-6-astra", answered: "gpt-6-nano" }]);
    assert.ok(one.rec.changes.includes("acp: answered by gpt-6-nano, not gpt-6-astra, the model asked for (rerouted)"), one.rec.changes.join("\n"));
    assert.ok(one.text.includes(`_filament: ${WORDS("Codex", "gpt-6-nano", "gpt-6-astra", "rerouted")}_`), one.text);
  });

  // (fails before: yes — Cursor's fallback was a sentence on the record, and the chat named the model asked for)
  test("Cursor's SDK: a model it does not offer, answered by its fallback, is said with why", async () => {
    const id = await session("cursor/gpt-9");
    const { rec } = await turn(id, "hello");
    assert.equal(rec.acp.agentModel, "auto-smart");
    assert.deepEqual(rec.acp.otherModel, { chosen: "gpt-9", answered: "auto-smart", said: WORDS("Cursor", "auto-smart", "gpt-9", "not-offered") });
    assert.ok(rec.changes.includes("acp: answered by auto-smart, not gpt-9, the model asked for (not offered)"), rec.changes.join("\n"));
    assert.deepEqual(rec.notes?.filter((/** @type {any} */ n) => n.kind === "model-not-offered"), [{ kind: "model-not-offered", model: "gpt-9", offers: ["auto-smart", "grok-4.6", "composer-2.5"], keeping: "auto-smart" }]);
  });

  // (fails before: yes — a sub-agent's outcome carried no model: its report, its row and the command's head named the
  // model it was launched on alone)
  test("a sub-agent answered by another model: its row and the command's head name both, and its report opens with the line", async () => {
    answerOn("claude-opus-5-5");
    const id = await session(`other/${FABLE}`, { subagents: { worktree: false } });
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "~ran", description: "Other model", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const [row] = await until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      return subagents.length && subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
    }, "its run to end");
    assert.deepEqual([row.status, row.exchanges[0].agentModel, row.exchanges[0].otherModel], ["done", "claude-opus-5-5", { chosen: FABLE, answered: "claude-opus-5-5" }]);
    assert.equal((await pageWords()).answeredOther(row), "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M", "what its card and its viewer say");
    // Its own run's record carries no words of the chat's: the report is where its launcher reads it.
    const own = await shim.record(String(row.runId));
    assert.deepEqual(own.acp.otherModel, { chosen: FABLE, answered: "claude-opus-5-5" });
    // The developer's `/subagent`, waited for: its head names the model that answered.
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/subagent wait=on ~ran", stream: false } });
    const reply = (await res.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(reply, /\(Filament: sub-agent sa_[0-9a-f]{8} — “[^”]*”, other\/claude-fable-5-2\[1m\] — answered by claude-opus-5-5, not claude-fable-5-2\[1m\] — finished after \d+ rounds?;/, reply);
  });
});

describe("a sub-agent's report, its card and its launch's answer", () => {
  const OTHER = { chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5" };
  const LINE = "(Filament: this report came from claude-opus-5-5, not claude-fable-5-2[1m], the model this sub-agent was launched on: its agent answered on another model. Weigh it as claude-opus-5-5's work.)";
  /**
   * A registry whose front door is a scripted host, as turn.js serves a sub-agent's run: attach, then finish with how
   * the run went — the model that answered with it, where `serve` names one.
   * @param {(o: { body: any }) => { report: string, agentModel?: string, otherModel?: { chosen: string, answered: string } }} serve
   * @param {Record<string, unknown>} [context]
   */
  const scripted = (serve, context = {}) => {
    let n = 0;
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({
        settings: () => ({ subagents: { pool: [{ model: "", seats: 2 }] }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
        view: async () => ({ text: "User: fix the parser\nAssistant: Fixed it.", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ chainId, /** @type {any} */ m) => ({ ...m, chainId, afterTurn: 7 }),
        ...context,
      }),
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const text = (/** @type {string} */ t) => ({ ok: true, status: 200, json: { content: [{ type: "text", text: t }], usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "m", retryAfter: null, shouldRetry: null });
        if (!id) return text("A BRIEF");
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        const r = serve({ body });
        registry.finish(id, { status: "done", error: null, report: r.report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: r.report }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId], ...(r.agentModel ? { agentModel: r.agentModel } : {}), ...(r.otherModel ? { otherModel: r.otherModel } : {}) });
        return { ...text(r.report), id: runId };
      },
    });
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
    return { registry, door };
  };

  // (fails before: yes — the outcome kept neither, and every report began with the sub-agent's own words)
  test("the outcome carries the model that answered, and the report its launching agent reads opens with both names", async () => {
    const { registry, door } = scripted(() => ({ report: "FOUND IT", agentModel: "claude-opus-5-5", otherModel: OTHER }));
    // Launched and waited for: the call's answer.
    const waited = await door.subagents.run({ id: "a1", input: { description: "Scan", prompt: "SCAN", run_in_background: false }, emit: () => {}, signal: null });
    assert.ok(String(waited.text).startsWith(`${LINE}\n\nFOUND IT`), String(waited.text));
    // In the background: the report that reaches it as Filament's message.
    const bg = await door.subagents.run({ id: "a2", input: { description: "Scan", prompt: "SCAN", run_in_background: true }, emit: () => {}, signal: null });
    const sa = String(/sa_[0-9a-f]{8}/.exec(String(bg.text))?.[0]);
    await door.inbox.owed();
    const [d] = door.inbox.take();
    assert.ok(d.text.includes(`Its report:\n${LINE}\n\nFOUND IT`), d.text);
    // The developer's own launch: its outcome, and the row the page's card reads.
    const r = /** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "find the bug" }));
    const o = await r.done;
    assert.deepEqual([o.agentModel, o.otherModel, o.report], ["claude-opus-5-5", OTHER, "FOUND IT"], "the report's own words stay its own");
    assert.deepEqual([registry.get(r.id)?.exchanges[0].agentModel, registry.get(r.id)?.exchanges[0].otherModel], ["claude-opus-5-5", OTHER]);
    assert.deepEqual(registry.get(sa)?.exchanges[0].otherModel, OTHER);
    door.close();
  });

  // (fails before: no — guards that a report answered by its own model, or by one nobody named, opens with its own words)
  test("a report answered by the model it was launched on opens with its own words", async () => {
    const { door } = scripted(() => ({ report: "FOUND IT", agentModel: "claude-fable-5-2" }));
    const waited = await door.subagents.run({ id: "a1", input: { description: "Scan", prompt: "SCAN", run_in_background: false }, emit: () => {}, signal: null });
    assert.ok(String(waited.text).startsWith("FOUND IT"), String(waited.text));
    door.close();
  });

  // (fails before: yes — the card and the viewer named the model launched on alone)
  test("the card says which model answered, where its row names another", async () => {
    const { answeredOther } = await pageWords();
    const row = /** @type {any} */ ({ id: "sa_1", model: "cc/claude-fable-5-2[1m]", status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 8_000, report: "FOUND IT", tokensIn: 10, tokensOut: 5, spentUsd: 0, ms: 7_000, agentModel: "claude-opus-5-5", otherModel: OTHER }] });
    assert.equal(answeredOther(row), "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M");
    assert.equal(answeredOther(row, 0), "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M");
    assert.equal(answeredOther({ ...row, exchanges: [{ ...row.exchanges[0], otherModel: undefined }] }), "");
    assert.equal(answeredOther(null), "");
    const listed = cardState({ exchange: 0, model: "cc/claude-fable-5-2[1m]", at: 1_000 }, null, { row, known: true, now: 60_000 });
    assert.equal(listed.other, "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M");
    assert.equal(cardFacts(listed), "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M · 15 · 7s");
    const asked = askedState({ exchange: 0, model: "cc/claude-fable-5-2[1m]", status: "done", report: "FOUND IT", tokens: 15, ms: 7_000 }, { running: false, listed: false, row });
    assert.equal(cardFacts(asked), "answered by Claude Opus 5.5, not Claude Fable 5.2 · 1M · 15 · 7s");
    const plain = cardState({ exchange: 0, model: "cc/claude-fable-5-2[1m]", at: 1_000 }, null, { row: { ...row, exchanges: [{ ...row.exchanges[0], otherModel: undefined }] }, known: true, now: 60_000 });
    assert.deepEqual([plain.other, cardFacts(plain)], [undefined, "Claude Fable 5.2 · 1M · 15 · 7s"]);
  });

  // (fails before: yes — a launch said the model it ran on, and nothing of what had answered there before)
  test("a launch's answer says what its model's last turns there were answered by, where that was another model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-other-model-calib-"));
    const file = join(dir, "token-calib.json");
    try {
      initTokenCalib({ file, uncalibrated: (id) => id === "cc" });
      const at = { upstream: "cc", model: "claude-fable-5-2[1m]", name: "Claude Code" };
      const { door } = scripted(() => ({ report: "FOUND IT" }), { modelFacts: () => ({ problem: null, limit: null, price: null, at, seen: null }) });
      const launch = async (/** @type {string} */ id) => String((await door.subagents.run({ id, input: { description: "Scan", prompt: "SCAN", run_in_background: true }, emit: () => {}, signal: null })).text);
      assert.ok(!(await launch("a1")).includes("answered by"), "nothing counted there yet");
      observeCountedModel("cc", "claude-fable-5-2[1m]", [{ model: "claude-fable-5-2", input: 10, output: 46, cacheRead: 24000 }]);
      assert.ok(!(await launch("a2")).includes("answered by"), "counted under its own name");
      // Two turns running named another: `observeCountedModel` takes a name over once two turns say it.
      for (let i = 0; i < 2; i++) observeCountedModel("cc", "claude-fable-5-2[1m]", [{ model: "claude-opus-5-5", input: 10, output: 46, cacheRead: 24000 }]);
      const said = await launch("a3");
      assert.ok(said.includes(` in the background. Its last turns there were answered by claude-opus-5-5, not claude-fable-5-2[1m]: expect claude-opus-5-5's work.`), said);
      await door.inbox.owed();
      door.close();
    } finally {
      disposeTokenCalib(file);
      await removeDirs(dir);
    }
  });
});
