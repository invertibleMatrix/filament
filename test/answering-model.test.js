// @ts-check
// Whether the model that answered a turn is the one its chat names (core/answering-model.js): the comparer's cases,
// the model a turn's counted tokens name, and what each layer makes of a mismatch without an agent — the note's words,
// the turn's facts, the footer's segment, what token-calib keeps of a model's counted name.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const core = () => import("../src/core/answering-model.js");

test("answeredAs: the same model under its marks — an effort suffix, a window mark, a date, a route's prefix", async () => {
  const { answeredAs } = await core();
  /** @type {[string, string][]} */
  const same = [
    ["claude-fable-5-2[1m]", "claude-fable-5-2"],
    ["claude-fable-5-2[1m]-xhigh", "claude-fable-5-2"],
    ["claude-fable-5-2-max", "claude-fable-5-2[1m]"],
    ["claude-opus-5-5", "claude-opus-5-5-20261001"],
    ["claude-opus-5-5-20261001", "claude-opus-5-5"],
    ["claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022"],
    ["gpt-4o", "gpt-4o-2024-08-06"],
    ["claude-opus-5.5", "claude-opus-5-5"],
    ["Claude-Opus-5-5", "claude-opus-5-5"],
    ["anthropic/claude-opus-5-5", "claude-opus-5-5"],
    ["claude-opus-5-5", "us.anthropic.claude-opus-5-5-20261001-v1:0"],
    ["claude-opus-5-5", "claude-opus-5-5@20261001"],
    ["gpt-5.5-codex-high", "gpt-5.5-codex"],
    ["gpt-5.5-fast", "gpt-5.5"],
    ["claude-opus-5-thinking-high", "claude-opus-5"],
    ["opus-5-5", "claude-opus-5-5"],
    ["claude-sonnet-5", "claude-sonnet-5"],
  ];
  for (const [chosen, answered] of same) assert.equal(answeredAs(chosen, answered), "same", `${chosen} answered by ${answered}`);
});

test("answeredAs: a bare alias is any model of its family, and no model of another", async () => {
  const { answeredAs } = await core();
  assert.equal(answeredAs("opus", "claude-opus-5-5"), "same");
  assert.equal(answeredAs("opus[1m]", "claude-opus-5-5"), "same");
  assert.equal(answeredAs("opus[1m]-max", "claude-opus-4-8-20260301"), "same");
  assert.equal(answeredAs("sonnet", "claude-sonnet-5"), "same");
  assert.equal(answeredAs("haiku", "claude-haiku-4-5-20251001"), "same");
  assert.equal(answeredAs("claude/haiku", "claude-haiku-5"), "same", "a route's prefix is not the model's name");
  assert.equal(answeredAs("opus", "claude-sonnet-5"), "different");
  assert.equal(answeredAs("opus[1m]", "claude-fable-5-2"), "different");
  assert.equal(answeredAs("sonnet", "claude-opus-5-5"), "different");
  assert.equal(answeredAs("haiku", "claude-sonnet-5"), "different");
  assert.equal(answeredAs("fable[1m]", "claude-opus-5-5"), "different");
  // An agent that names its current model by an alias (ACP's model option), against the full name asked for.
  assert.equal(answeredAs("claude-opus-5-5", "opus[1m]"), "same");
  assert.equal(answeredAs("claude-fable-5-2[1m]", "opus"), "different");
});

test("answeredAs: another model is said — the incident's pair among them", async () => {
  const { answeredAs } = await core();
  /** @type {[string, string][]} */
  const different = [
    ["claude-fable-5-2[1m]-xhigh", "claude-opus-5-5"],
    ["claude-fable-5-2[1m]", "claude-opus-5-5"],
    ["claude-fable-5-2", "claude-opus-5-5-20261001"],
    ["claude-opus-5-5", "claude-sonnet-5-5"],
    ["claude-sonnet-5", "claude-haiku-5"],
    ["gpt-5.5-codex", "gpt-6-astra"],
    ["composer-2", "gpt-5.5"],
    ["gemini-3-pro", "claude-opus-5-5"],
    ["claude-opus-5-5", "claude-opus-4-8"],
  ];
  for (const [chosen, answered] of different) assert.equal(answeredAs(chosen, answered), "different", `${chosen} answered by ${answered}`);
});

test("answeredAs: it never cries wolf — no name, the agent's own choice, or two names that may be one model say nothing", async () => {
  const { answeredAs } = await core();
  /** @type {[unknown, unknown][]} */
  const unknown = [
    ["default", "claude-opus-5-5"],
    ["Default", "claude-opus-5-5"],
    ["auto", "gpt-5.5"],
    ["", "claude-opus-5-5"],
    [null, "claude-opus-5-5"],
    [undefined, "claude-opus-5-5"],
    ["default[1m]", "claude-opus-5-5"],
    ["claude-opus-5-5", ""],
    ["claude-opus-5-5", null],
    ["claude-opus-5-5", undefined],
    ["claude-opus-5-5", "<synthetic>"],
    ["claude-opus-5-5", "default"],
    ["claude-opus-5-5", "auto"],
    // An alias a person's own settings may point at any model, and a word that is no family's.
    ["opus", "glm-5.3"],
    ["opusplan", "claude-sonnet-5"],
    ["best", "claude-opus-5-5"],
    ["gpt5", "gpt-5"],
    // One name the other's beginning: a version alias, or a model named after another.
    ["claude-opus-5", "claude-opus-5-5"],
    ["claude-opus-4-0", "claude-opus-4-20250514"],
    ["gpt-5.5", "gpt-5.5-codex"],
    // A name with no version in it and no family's word: an alias a gateway may point at any model.
    ["fake-a", "claude-sonnet-5"],
    ["prod-large", "claude-opus-5-5"],
    ["claude-opus-5-5", "prod-large"],
    // The agent's own pick, under its own name for it (Cursor's `auto-smart`), is answered by whatever it picks.
    ["auto-smart", "claude-opus-5-5"],
    ["auto-smart", "grok-4.6"],
    ["claude-opus-5-5", "auto-smart"],
  ];
  for (const [chosen, answered] of unknown) assert.equal(answeredAs(chosen, answered), "unknown", `${chosen} answered by ${answered}`);
});

test("answeredAs: where the agent itself said it is not on the model asked for, two names are two models unless they are one", async () => {
  const { answeredAs } = await core();
  const sure = { sure: true };
  /** @type {[string, string][]} */
  const different = [
    ["best", "claude-opus-5-5"],
    ["performance-tier", "lite-tier"],
    ["nonexistent-model", "claude-sonnet-5"],
    ["claude-opus-5", "claude-opus-5-5"],
    ["opus", "glm-5.3"],
    // Its own pick is a name to say where it fell back to it.
    ["gpt-9", "auto-smart"],
    ["claude-fable-5-2[1m]", "claude-opus-5-5"],
  ];
  for (const [chosen, answered] of different) assert.equal(answeredAs(chosen, answered, sure), "different", `${chosen} answered by ${answered}`);
  assert.equal(answeredAs("claude-fable-5-2[1m]-xhigh", "claude-fable-5-2", sure), "same");
  assert.equal(answeredAs("opus[1m]", "claude-opus-5-5", sure), "same");
  // Nothing to name on a side, or a chat that names no model: nothing is said, whatever the agent said.
  /** @type {[unknown, unknown][]} */
  const unknown = [["default", "claude-opus-5-5"], ["auto", "gpt-5.5"], ["auto-smart", "grok-4.6"], ["", "gpt-5.5"], ["gpt-9", ""], ["gpt-9", null], ["gpt-9", "default"], ["gpt-9", "<synthetic>"]];
  for (const [chosen, answered] of unknown) assert.equal(answeredAs(chosen, answered, sure), "unknown", `${chosen} answered by ${answered}`);
});

test("mainCounted: the counted model that read the most is the one the turn's context ran on, ties by what it wrote", async () => {
  const { mainCounted } = await core();
  const helper = { model: "claude-haiku-5", input: 300, output: 900, cacheRead: 0, cacheWrite: 0 };
  const main = { model: "claude-opus-5-5", input: 10, output: 46, cacheRead: 24000, cacheWrite: 471 };
  assert.equal(mainCounted([helper, main])?.model, "claude-opus-5-5");
  assert.equal(mainCounted([main, helper])?.model, "claude-opus-5-5");
  assert.equal(mainCounted([{ model: "a", input: 5, output: 1 }, { model: "b", input: 5, output: 2 }])?.model, "b");
  assert.equal(mainCounted([{ input: 9 }, { model: "", input: 9 }]), null, "a row that names no model is none");
  assert.equal(mainCounted([]), null);
  assert.equal(mainCounted(null), null);
  assert.equal(mainCounted(undefined), null);
});

test("the note's kind: both models named, what it means and the one thing to do — always said", async () => {
  const { NOTE_KINDS, renderHints, renderRecord } = await import("../src/core/notes.js");
  assert.ok(NOTE_KINDS["other-model"], "the kind is there");
  const ctx = { agentName: "Claude Code", firstTurn: false };
  const plain = /** @type {any} */ ({ kind: "other-model", chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5" });
  assert.equal(renderRecord(plain), "acp: answered by claude-opus-5-5, not claude-fable-5-2[1m], the model asked for");
  assert.deepEqual(renderHints(plain, ctx), [{
    mustSay: true,
    text: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names: Claude Code answered on its own model, most likely because this account is not offered that one. To get the model you choose, pick one Claude Code lists for this account in the model menu.",
  }]);
  const refused = { ...plain, why: "not-offered" };
  assert.equal(renderRecord(refused), "acp: answered by claude-opus-5-5, not claude-fable-5-2[1m], the model asked for (not offered)");
  assert.deepEqual(renderHints(refused, ctx), [{
    mustSay: true,
    text: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names: Claude Code does not offer that model on this account and kept its own. To get the model you choose, pick one Claude Code lists for this account in the model menu.",
  }]);
  const moved = { ...plain, why: "rerouted" };
  assert.equal(renderHints(moved, { agentName: "Codex", firstTurn: true })[0].text, "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names: Codex sent the turn to another model. To get the model you choose, pick one Codex lists for this account in the model menu.");
});

test("a turn's facts keep the model that answered, and the mismatch with its words on the turn that said it", async () => {
  const { foldTurnFacts } = await import("../src/core/turn-facts.js");
  const rec = (/** @type {any} */ acp, /** @type {any} */ over = {}) => ({ id: "r1", ts: "2026-11-11T10:00:00.000Z", durationMs: 1000, status: "ok", model: "cc/claude-fable-5-2[1m]", upstreamModel: "claude-fable-5-2[1m]", upstream: "Claude Code", tokens: { input: 1, output: 1 }, acp, ...over });
  const other = { chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5", said: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m]." };
  const f = foldTurnFacts(null, rec({ sessionId: "s", agentModel: "claude-opus-5-5", otherModel: other }), { own: true });
  assert.equal(f.model, "claude-fable-5-2[1m]", "the model asked for stays the turn's");
  assert.equal(f.agentModel, "claude-opus-5-5");
  assert.deepEqual(f.otherModel, other);
  const quiet = foldTurnFacts(null, rec({ sessionId: "s", agentModel: "claude-opus-5-5", otherModel: { chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5" } }), { own: true });
  assert.deepEqual(quiet.otherModel, { chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5" }, "a later mismatching turn keeps the pair, without the words");
  const same = foldTurnFacts(null, rec({ sessionId: "s", agentModel: "claude-fable-5-2" }), { own: true });
  assert.equal(same.agentModel, "claude-fable-5-2");
  assert.equal("otherModel" in same, false, "a turn answered by its model carries no mismatch");
  // The turn's newest own request is the one that says: a retry that answered on the model asked for clears it.
  const retried = foldTurnFacts(f, rec({ sessionId: "s", agentModel: "claude-fable-5-2" }, { id: "r2", ts: "2026-11-11T10:00:05.000Z" }), { own: true });
  assert.equal(retried.agentModel, "claude-fable-5-2");
  assert.equal("otherModel" in retried, false);
  const none = foldTurnFacts(null, rec(undefined, { model: "gpt-5.5", upstreamModel: "gpt-5.5" }), { own: true });
  assert.equal("agentModel" in none, false, "a model Filament calls names no agent's model");
});

test("the footer names the model that answered, in the warning tone, with the chosen one beside it", async () => {
  const { factsLine, footerFacts, shimLineOf } = await import("../src/ui/harness/lib/labels.js");
  const facts = { model: "claude-fable-5-2[1m]", upstream: "Claude Code", agentModel: "claude-opus-5-5", otherModel: { chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5", said: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names." } };
  const segments = factsLine(facts);
  const model = segments.find((s) => s.id === "model");
  assert.deepEqual(model, {
    id: "model",
    text: "answered by Claude Opus 5.5 · chosen Claude Fable 5.2 · 1M",
    title: "this reply came from claude-opus-5-5 on Claude Code, not claude-fable-5-2[1m], the model this chat names",
    tone: "warn",
  });
  assert.deepEqual(footerFacts(segments).warn.map((s) => s.id), ["model"], "shown whether or not the pointer is on the turn");
  assert.deepEqual(footerFacts(segments).meta, [], "and once");
  // The models its tokens were counted on stay said beside it.
  const counted = factsLine({ ...facts, models: [{ model: "claude-opus-5-5", output: 40 }, { model: "claude-haiku-5", output: 9 }] }).find((s) => s.id === "model");
  assert.equal(counted?.text, "answered by Claude Opus 5.5 +1 · chosen Claude Fable 5.2 · 1M");
  assert.match(String(counted?.title), /^this reply came from claude-opus-5-5 on Claude Code, not claude-fable-5-2\[1m\], the model this chat names — its agent counted the turn's tokens on 2 models: /);
  // A turn answered by its model reads as it did.
  assert.deepEqual(factsLine({ model: "m1", upstream: "u1", agentModel: "m1" }).map((s) => [s.text, s.title, s.tone]), [["M1", "answered by m1 on u1", ""]]);
  // The words under the turn: the turn that said it, once.
  assert.deepEqual(shimLineOf({ facts }), { kind: "note", text: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names.", warn: true });
  assert.equal(shimLineOf({ facts: { ...facts, otherModel: { chosen: "a", answered: "b" } } }), null, "a later mismatching turn keeps its footer alone");
  assert.deepEqual(shimLineOf({ command: true, facts }), { kind: "command" });
});

test("token-calib says the model a coding agent's turns at a name were counted under", async () => {
  const calib = await import("../src/services/token-calib.js");
  assert.equal(typeof calib.countedAs, "function");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filament-counted-as-"));
  const file = path.join(dir, "token-calib.json");
  try {
    calib.initTokenCalib({ file, uncalibrated: (id) => id === "cc" });
    assert.equal(calib.countedAs("cc", "claude-fable-5-2[1m]"), null, "nothing counted there yet");
    calib.observeCountedModel("cc", "claude-fable-5-2[1m]", [{ model: "claude-haiku-5", input: 300, output: 60 }, { model: "Claude-Opus-5-5", input: 10, output: 46, cacheRead: 24000 }]);
    assert.equal(calib.countedAs("cc", "claude-fable-5-2[1m]"), "claude-opus-5-5", "the one that read the most");
    assert.equal(calib.countedAs("cc", "claude-sonnet-5"), null);
    assert.equal(calib.countedAs("api", "claude-fable-5-2[1m]"), null, "a model Filament calls is counted under its own name");
  } finally {
    calib.disposeTokenCalib(file);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
