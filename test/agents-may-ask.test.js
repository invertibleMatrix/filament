// @ts-check
// HarnessV4_Tasks E15 step 3, part one: the session's main agent asks the saved agents its session names (V4-D288).
// Its agent tool lists them — one frozen tool per list — and its instructions say when to ask, only where agents are
// named. A named agent is asked as its card says and told who asks; its answer comes back framed as advice, with the
// session's count (V4-D284, V4-D289). Any other word is refused in words (AG-50), as is a launch past the limit, which
// says whose the running ones are (AG-49). A team's lead asks on its own tool, in the background (AG-52). The developer
// overrules an answer in their own words: the agent reads whose
// answer they stand over, and the session keeps it (L-27, AG-47).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { AGENT_TOOL, SUBAGENT_OFF, TEAM_AGENT_TOOL, agentToolFor, coderAgentToolFor, leadToolSetFor, loopToolArgs, teamAgentToolFor, toolSetFor } from "../src/app/agent/tools.js";
import { checkBrief, createTeamTools, isAsk } from "../src/app/agent/team-tools.js";
import { askablesOf, createAgentCardStore } from "../src/services/agent-cards.js";
import { askLine, isAskLine, withoutAskLine } from "../src/core/messages.js";
import { foldedTranscript, messagesTranscript, turnTranscript } from "../src/app/sessions/compaction.js";
import { recallTurn } from "../src/app/sessions/recall.js";
import { renderTurn } from "../src/app/sessions/shapes.js";
import { Archive } from "../src/services/memory/archive.js";
import { KNOBS, globalLayer, resolveSettings, valueProblems } from "../src/services/session-settings.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { OWN_CARDS, saveOwnCards } from "./helpers/flow-cards.js";
import { SHIPPED_MEMBERS as TAGS } from "../src/core/roster.js";
import { MEMBERS } from "./helpers/roster.js";
import { whoTag } from "../src/ui/harness/lib/side.js";

const root = tmpdir();
/** @type {import("../src/app/agent/tools.js").Askable[]} */
const ASKS = [
  { tag: "pm", name: "PM", goodFor: "Scope, priority and what to leave out.", may: "edit", from: null },
  { tag: "designer", name: "Designer", goodFor: "How it reads and feels", may: "read", from: null },
];
const ADVICE = "Weigh it, and say in your reply what you decided. It does not stand in for the developer's yes; they see this answer as a card and may overrule it.";
const ASKED_BY_AGENT = "[Filament: the session's main agent asks you this by itself, in the middle of its work. The developer sees your answer as a card, and may overrule it.]";
const QUESTION = "Past the limit of four: queue the fifth launch, or refuse it?";
const ANSWER = "Refuse it, and name the limit.\n\nA launch that waits unseen reads as a hang.";
/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));

// ---------------------------------------------------------------------------------------------------
// The tool and the instructions
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — there was one agent tool: no list of whom to ask, and no kind beside the tool's own two)
describe("the agent tool of a session that names agents", () => {
  // (fails before: yes — OA1 case 4: the list said nothing of what each may do, and a worker's tag was listed apart)
  test("lists each with its line and its level, takes their tags as kinds, and is one frozen tool per list", () => {
    assert.equal(agentToolFor([]), AGENT_TOOL, "nobody named: the tool itself, byte for byte");
    const tool = agentToolFor(ASKS);
    assert.equal(agentToolFor(ASKS.map((a) => ({ ...a }))), tool, "the same list sends the same tool");
    assert.ok(Object.isFrozen(tool));
    assert.equal(tool.name, "agent");
    assert.equal(tool.description, `${TOOL_TEXT.agent}\n\n${TOOL_TEXT.agentAsk} \`pm\` (PM): Scope, priority and what to leave out (edits in its own copy). \`designer\` (Designer): How it reads and feels (reads only).`);
    assert.deepEqual(tool.input_schema.properties.subagent_type.enum, ["builder", "reviewer", "pm", "designer"]);
    assert.match(tool.input_schema.properties.subagent_type.description, / Or a saved agent's tag, to ask it as its card says\.$/);
    assert.deepEqual(AGENT_TOOL.input_schema.properties.subagent_type.enum, ["builder", "reviewer"], "the tool itself is untouched");
    assert.notEqual(agentToolFor([ASKS[0]]), tool, "another list is another tool");
    assert.notEqual(agentToolFor([ASKS[1], ASKS[0]]), tool, "and so is another order");
  });

  test("the session's set carries it in the agent tool's place; a session that switched the tool off carries neither", () => {
    const set = toolSetFor({ delegateRead: false, asks: ASKS });
    assert.equal(set, toolSetFor({ delegateRead: false, asks: [...ASKS] }), "one frozen set per list");
    assert.equal(set.find((t) => t.name === "agent"), agentToolFor(ASKS));
    const plain = toolSetFor({ delegateRead: false });
    assert.equal(plain.find((t) => t.name === "agent"), AGENT_TOOL);
    assert.deepEqual(set.map((t) => t.name), plain.map((t) => t.name), "nothing else moves");
    assert.equal(toolSetFor({ delegateRead: false, disabled: ["agent"], asks: ASKS }).some((t) => t.name === "agent"), false);
    assert.equal(loopToolArgs({ asks: ASKS }).find((t) => t.name === "agent"), agentToolFor(ASKS));
    assert.equal(loopToolArgs({}).find((t) => t.name === "agent"), AGENT_TOOL);
  });

  test("a team's lead: its roles and the tags in one field, and a question needs no steps and no acceptance check", () => {
    assert.equal(teamAgentToolFor([]), TEAM_AGENT_TOOL);
    const tool = teamAgentToolFor(ASKS);
    assert.equal(teamAgentToolFor([...ASKS]), tool);
    assert.equal(tool.description, `${TOOL_TEXT.teamAgent}\n\n${TOOL_TEXT.teamAgentAsk} \`pm\` (PM): Scope, priority and what to leave out (edits in its own copy). \`designer\` (Designer): How it reads and feels (reads only).`);
    assert.deepEqual(tool.input_schema.properties.role.enum, ["scout", "builder", "tester", "reviewer", "pm", "designer"]);
    assert.deepEqual(tool.input_schema.required, ["role", "description", "goal"]);
    assert.deepEqual(TEAM_AGENT_TOOL.input_schema.required, ["role", "description", "goal", "steps", "acceptance"], "with nobody named a brief is required whole");
    assert.equal(leadToolSetFor({ delegateRead: false, asks: ASKS }).find((t) => t.name === "agent"), tool);
    assert.equal(loopToolArgs({ lead: true, asks: ASKS }).find((t) => t.name === "agent"), tool);
    assert.notEqual(tool, agentToolFor(ASKS), "the loop's and the lead's are two tools");
  });
});

// (fails before: yes — the instructions said nothing of asking, of the count, or of when not to split work)
describe("the instructions", () => {
  const base = { root: "R", delegateRead: false };
  test("say when to ask only where agents are named, the agent tool is on, and the run is the session's own agent", () => {
    assert.equal(PROMPT_VERSION, 129);
    const named = systemPromptFor({ ...base, asks: true });
    // (the owner's of 11-14: while Parallelize tasks is off, the line on the person's card stands between them)
    assert.ok(named.includes(`${PROMPT.agent}\n${PROMPT.agentRecipes}\n${PROMPT.parallelOff}\n${PROMPT.agentAsk}`), "what an answer is worth: after the agent tool's own line, its three recipes and the hold");
    assert.ok(systemPromptFor({ ...base, asks: true, parallel: true }).includes(`${PROMPT.agent}\n${PROMPT.agentRecipes}\n${PROMPT.agentAsk}`), "on: right after the three recipes");
    for (const words of [PROMPT.agentAsk, PROMPT.askFirst]) {
      assert.ok(!systemPromptFor(base).includes(words), "nobody named: not a word of it");
      assert.ok(!systemPromptFor({ ...base, asks: true, toolsOff: ["agent"] }).includes(words), "no tool, no line");
      assert.ok(!systemPromptFor({ ...base, asks: true, toolsOff: SUBAGENT_OFF, subagent: true, readOnly: true }).includes(words), "a sub-agent asks nobody");
    }
    const lead = systemPromptFor({ ...base, asks: true, lead: { name: "Architect", persona: "" } });
    assert.ok(lead.includes(`${PROMPT.teamAgent}\n${PROMPT.agentAsk}`), "a team's lead reads it after its own agent line");
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 4, L-85: the agent was told what a sub-agent is, never when one pays)
  test("the main agent is told three ways sub-agents pay — a map, a second read, three tries — in words alone, and nobody else is", () => {
    const words = PROMPT.agentRecipes;
    assert.ok(systemPromptFor(base).includes(`${PROMPT.agent}\n${words}\n`), "right after the agent tool's line, asked agents or none");
    assert.ok(!systemPromptFor({ ...base, toolsOff: ["agent"] }).includes(words), "no tool, no recipe");
    assert.ok(!systemPromptFor({ ...base, lead: { name: "Architect", persona: "" } }).includes(words), "a team's lead plans by its own words");
    assert.ok(!systemPromptFor({ ...base, toolsOff: SUBAGENT_OFF, subagent: true }).includes(words), "a sub-agent launches none");
    assert.match(words, /^Three ways these sub-agents pay\. Map before a wide change: when reading the code yourself would put tens of thousands of tokens of files into this conversation, launch reviewers in one reply/);
    assert.match(words, /for a search or a few files, read here\./, "step 0's Run A: a map pays for a big read, not for a search");
    assert.match(words, /A second read of what you changed: once your edits are written, launch a reviewer, which only reads, with changes: "running"/);
    assert.match(words, /Three tries at a bug that resisted your fix, in a git repository: launch three builders in one reply, each told a different way to try and to report the real output of the test that shows the bug; each works in its own copy of the project, and while Parallelize tasks is off they are held on the person's card\./);
    assert.match(words, /Apply the one whose report shows that test passing — its agent_id with apply_changes: true — and run the test here yourself before you call it fixed\.$/, "the check that picks is the test: no judge is built (L-90)");
    assert.ok(!/famil|another model|different model|stronger model|cheaper model/i.test(words), "no advice about model families (AG-78)");
    // Every word it names is one the tool takes: the two kinds, the field, the value, the way to apply.
    const tool = JSON.stringify(AGENT_TOOL);
    for (const word of ["builder", "reviewer", "changes", "running", "apply_changes", "agent_id"]) assert.ok(tool.includes(word), word);
  });

  // (fails before: yes — found by E15 step 3's live drive: the rule stood among the tools' lines, and on a real model
  // the agent weighed two ways, picked one and changed the files without a thought of the agents it may ask: AG-73)
  test("when to ask is a rule of how the agent works: it stands right after the rule on an unclear request, for the agent and for a team's lead", () => {
    const named = systemPromptFor({ ...base, asks: true });
    assert.ok(named.includes(`${PROMPT.ambiguity}\n- ${PROMPT.askFirst}\n\n${PROMPT.headTools}`), "the last rule under How you work");
    assert.ok(named.indexOf(PROMPT.askFirst) < named.indexOf(PROMPT.agent), "before any tool's line");
    const lead = systemPromptFor({ ...base, asks: true, lead: { name: "Architect", persona: "" } });
    assert.ok(lead.includes(`${PROMPT.ambiguity}\n- ${PROMPT.askFirst}\n`), "a team's lead reads it under its own rules");
    assert.match(PROMPT.askFirst, /^The developer named saved agents for you to consult; the agent tool lists them\./);
    assert.match(PROMPT.askFirst, /When you are choosing between ways that could both be right and the files cannot tell you which/);
    assert.match(PROMPT.askFirst, /ask the agent whose line fits before you pick, whether you will then decide yourself or put the choice to the developer\. Not for what you can check by reading\.$/);
  });

  test("say what an answer is worth, that the developer may overrule it, the count on every result, and when not to split", () => {
    // (fails before: yes — OA1: an agent asked "gives its view and changes nothing")
    assert.match(PROMPT.agentAsk, /^A saved agent you ask sees of this session only what its card says — by default nothing, so that its view is its own — and does what its card's level allows, as the agent tool names it: it reads only, runs things in its own copy and keeps nothing, or edits in its own copy, where what it changed waits to be applied\./);
    assert.match(PROMPT.agentAsk, /It prepares a decision; it does not stand in for the developer's yes/);
    assert.match(PROMPT.agentAsk, /may overrule it: their words then reach you as a message and stand over the advice\.$/);
    assert.match(PROMPT.agent, /Do not split what is quicker done here: a change inside one file, a small fix, or a job whose sub-agent would need this whole conversation to do it\./);
    // (fails before: yes — the owner's word of 11-05: Filament caps nothing of its own, so no limit of a session's to warn of)
    assert.doesNotMatch(PROMPT.agent, /only so many|Past the limit/);
    // (fails before: yes — the owner's of 11-14: nothing said a lone piece the agent would only wait on is its own)
    assert.match(PROMPT.agent, /a job whose sub-agent would need this whole conversation to do it\. A lone piece you would only wait on, do yourself\.$/);
  });
});

// (fails before: yes — no such setting: nothing named whom a session's agent may ask)
describe("who may be asked is a list of tags", () => {
  test("the session's knob: a list of non-empty strings, empty by default, the operator's list as the default and a session's own in its place", () => {
    assert.deepEqual([KNOBS["subagents.ask"].type, KNOBS["subagents.ask"].default], ["list", []]);
    assert.deepEqual(valueProblems("subagents.ask", ["pm", "designer"]), []);
    assert.equal(valueProblems("subagents.ask", ["pm", " "]).length, 1);
    assert.equal(valueProblems("subagents.ask", ["pm", 3]).length, 1);
    const cfg = /** @type {any} */ ({ agentLoop: { subagents: { ask: ["pm", "designer"] } } });
    const global = globalLayer(cfg);
    assert.deepEqual(resolveSettings({ global }).effective.subagents.ask, ["pm", "designer"]);
    assert.deepEqual(resolveSettings({ global, session: { subagents: { ask: ["skeptic"] } } }).effective.subagents.ask, ["skeptic"], "a session's list replaces the default, whole");
    assert.deepEqual(resolveSettings({ global, session: { subagents: { ask: [] } } }).effective.subagents.ask, [], "and may name nobody");
    assert.deepEqual(resolveSettings({ global: globalLayer(/** @type {any} */ ({ agentLoop: {} })) }).effective.subagents.ask, []);
  });

  test("the cards a list names: those that exist, each once, in the list's order; and no card may take a word the tool launches by", () => {
    const cards = createAgentCardStore({ dataDir: null });
    saveOwnCards(cards);
    const find = (/** @type {string} */ tag) => cards.find(tag);
    assert.deepEqual(askablesOf(["@Designer", "ghost", "pm", "designer", "", 7], find).map((a) => a.tag), ["designer", "pm"], "a deleted card's tag is left out (AG-53)");
    assert.deepEqual(askablesOf(["pm", "reviewer"], find).map((a) => [a.tag, a.may, a.from, "kind" in a]), [["pm", "edit", null, false], ["reviewer", "read", null, false]], "each with what it may do, and no kind");
    // (fails before: yes — OA-D4: a team's head could be named for the agent to ask by itself)
    assert.deepEqual(askablesOf(["tenx", "pm", "huntlead"], find).map((a) => a.tag), ["pm"], "a team's own Lead is its team's: never on a list");
    assert.deepEqual(askablesOf(null, find), []);
    // What the main agent launches by itself are cards now: their tags are taken as any shipped card's.
    for (const [word, name] of [["builder", "Builder"], ["reviewer", "Reviewer"]])
      assert.throws(() => cards.create({ tag: word, name: "X", goodFor: "x", thinks: "You think." }), { message: `\`@${word}\` is taken by ${name} (shipped) — pick another tag.` }, word);
  });
});

// ---------------------------------------------------------------------------------------------------
// The registry: the agent's own tool
// ---------------------------------------------------------------------------------------------------

/**
 * A registry whose front door is a scripted host, over the real card store. `ask`: the session's `subagents.ask`; `max`:
 * the limit set on its agents' model, m-sub, across your chats; `serve`: a launch's answer, which may wait; `kept`: the
 * names a chat keeps, as its meta keeps them across a restart.
 * @param {{ ask?: string[], max?: number, serve?: ((o: { id: string, body: any, n: number }) => Promise<string> | string) | null, kept?: Map<string, string[]> | null }} [o]
 */
function scripted({ ask = ["pm", "designer"], max = 4, serve = null, kept = null } = {}) {
  const cards = createAgentCardStore({ dataDir: null });
  // The person's own cards asked here, beside the ones that ship (helpers/flow-cards.js).
  saveOwnCards(cards);
  // These read how an agent asked is shown the session: as they ship the leads see nothing, so these are set to see it.
  for (const tag of ["pm", "designer", "skeptic"]) cards.update(tag, { sees: { view: "folded", running: true } });
  /** @type {any[]} */ const posts = [];
  /** @type {any[]} */ const marks = [];
  /** @type {any[]} */ const published = [];
  /** @type {any[]} */ const views = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m-sub", n: max }] } } }),
    log: () => {},
    events: { publish: (topic, e) => published.push({ topic, e }) },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      cards: () => cards.list(),
      settings: () => ({ subagents: { pool: [{ model: "m-sub" }], view: "none", ask }, loop: { permissions: "edit" } }),
      modelFacts: (name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async (_chain, strategy, o) => {
        views.push({ strategy, ...o });
        return { text: "User: fix the parser\nAssistant: Fixed it.", turns: 1 };
      },
      brief: async () => null,
      modelProblem: () => null,
      agentOf: () => null,
      // A team of the person's own whose name holds an agent's (Engineer).
      teamNames: () => ["10x Engineer"],
      ...(kept ? { keepHeard: (/** @type {string} */ c, /** @type {string[]} */ t) => void kept.set(c, t), heardKept: (/** @type {string} */ c) => kept.get(c) || [] } : {}),
      mark: (chainId, m) => {
        const stored = { ...m, afterTurn: 7 };
        marks.push({ chainId, ...stored });
        return stored;
      },
    },
    call: async ({ body, headers = {} }) => {
      posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = serve ? await serve({ id, body, n }) : ANSWER;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 1200, tokensOut: 40, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts, marks, published, views };
}
/** A turn's door, as the loop opens it. @param {ReturnType<typeof scripted>["registry"]} registry @param {any} [over] */
const openDoor = (registry, over = {}) => registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, ...over });
/** The agent's call on its tool. @param {any} door @param {string} id @param {any} input @param {(e: any) => void} [emit] */
const call = (door, id, input, emit = () => {}) => door.subagents.run({ id, input, emit, signal: null });
const idIn = (/** @type {any} */ text) => String(/sa_[0-9a-f]{8}/.exec(String(text))?.[0] || "");
/** A launch's answer waits where its question says SLOW. @param {{ promise: Promise<any> }} gate */
const slowBy = (gate) => async (/** @type {{ body: any }} */ { body }) => {
  if (/SLOW/.test(textOf(body.messages.at(-1)))) await gate.promise;
  return ANSWER;
};

// (fails before: yes — any word in subagent_type that was not "explore" launched a general-purpose sub-agent)
describe("the agent asks a saved agent its session names", () => {
  test("it is asked as its card says and told who asks; the answer is the call's result, framed as advice, with the count", async () => {
    const { registry, posts, views, marks } = scripted();
    /** @type {any[]} */
    const emitted = [];
    const door = openDoor(registry);
    const res = await call(door, "toolu_1", { run_in_background: false, description: "Queue or refuse", prompt: QUESTION, subagent_type: "@PM", context: "full" }, (e) => emitted.push(e));
    const sa = registry.list("c1")[0];
    // (fails before: yes — OA1: PM asked read only, whatever its card said)
    assert.deepEqual([sa.card, sa.asked, sa.may, sa.origin, sa.aside, sa.background, sa.model], [{ tag: "pm", name: "PM" }, true, "edit", "agent", false, false, "m-sub"]);
    assert.equal(sa.view, "folded", "what it sees is its card's: the call's context does not apply (AG-51)");
    assert.deepEqual(views.map((v) => v.strategy), ["fold"]);
    assert.equal(posts[0].headers["x-filament-permissions"], "edit", "it works at its card's level, under the session's mode");
    const blocks = posts[0].body.messages[0].content.map((/** @type {any} */ b) => b.text);
    assert.equal(blocks.at(-1), `${ASKED_BY_AGENT}\n\n${QUESTION}`, "it is told who asks, ahead of the question whole");
    assert.equal(res.ok, true);
    assert.equal(res.text, `${ANSWER}\n\n[Filament: PM (${sa.id}) answered. ${ADVICE} To ask it more in the same thread, call agent with agent_id "${sa.id}". 0 running.]`);
    assert.match(res.note, /^agent: asked PM, a saved agent \(sa_[0-9a-f]{8}, m-sub, folded view\)/);
    assert.deepEqual(emitted.find((e) => e.type === "subagent-start")?.card, { tag: "pm", name: "PM" }, "the turn's row knows whose answer it shows");
    assert.deepEqual(marks, [], "the turn's own row is its card: the session keeps no mark of its own for it");
    door.close();
  });

  test("the tool's own two kinds are Builder and Reviewer, launched as their cards say, their context applied; no kind is Builder", async () => {
    const { registry } = scripted();
    const door = openDoor(registry);
    await call(door, "toolu_1", { run_in_background: false, description: "Look", prompt: "list the folder", subagent_type: "reviewer", context: "folded" });
    await call(door, "toolu_2", { run_in_background: false, description: "Do", prompt: "fix it", worktree: false });
    assert.deepEqual(registry.list("c1").map((s) => [s.card.tag, s.asked, s.may, s.view]).sort(), [["builder", false, "edit", "none"], ["reviewer", false, "read", "folded"]]);
    door.close();
  });

  test("a word that is neither a kind nor an agent the session names is refused in words that list whom it may ask, and nothing starts (AG-50)", async () => {
    const { registry, posts } = scripted({ ask: ["pm", "designer", "ghost"] });
    assert.deepEqual(registry.asks("c1").map((a) => a.tag), ["pm", "designer"], "a tag whose card is gone is not offered");
    const door = openDoor(registry);
    const listed = "This session's agent may ask: `pm` (PM), `designer` (Designer) — or launch a builder or a reviewer sub-agent.";
    await assert.rejects(call(door, "toolu_1", { run_in_background: false, description: "x", prompt: QUESTION, subagent_type: "skeptic" }), { message: `\`skeptic\` is not one you may ask. ${listed}` });
    await assert.rejects(call(door, "toolu_2", { run_in_background: false, description: "x", prompt: QUESTION, subagent_type: "Explorer" }), { message: `\`Explorer\` is not one you may ask. ${listed}` });
    await assert.rejects(call(door, "toolu_3", { run_in_background: false, description: "x", prompt: QUESTION, subagent_type: "ghost" }), { message: `\`ghost\` is not one you may ask. ${listed}` });
    assert.deepEqual([registry.list("c1").length, posts.length], [0, 0], "a question never turns into a job that changes files");
    door.close();
    const none = scripted({ ask: [] });
    const other = openDoor(none.registry);
    await assert.rejects(call(other, "toolu_1", { description: "x", prompt: QUESTION, subagent_type: "pm" }), {
      message: "`pm` names nothing you can launch: the developer named no saved agent this session's agent may ask. You can launch a builder or a reviewer sub-agent.",
    });
    // The developer asks whom they like: the list is the agent's alone.
    const theirs = none.registry.launch({ origin: "owner", chainId: "c1", prompt: QUESTION, as: "pm" });
    assert.equal(theirs.ok, true, JSON.stringify(theirs));
    await /** @type {any} */ (theirs).done;
    other.close();
  });

  test("asked in the background, the answer arrives as a message that says whose view it is and what it is worth", async () => {
    const gate = deferred();
    const { registry } = scripted({ serve: slowBy(gate) });
    const door = openDoor(registry);
    const res = await call(door, "toolu_1", { description: "Queue or refuse", prompt: `SLOW ${QUESTION}`, subagent_type: "pm", run_in_background: true });
    const id = idIn(res.text);
    assert.equal(
      res.text,
      `Asked PM (${id}) in the background. Keep working: its answer arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait — never sleep or poll. To talk to it again later, call agent with agent_id "${id}". 1 running.`,
    );
    gate.resolve();
    await until(() => registry.get(id)?.status === "done", "PM to answer");
    const due = door.inbox.take();
    assert.equal(due.length, 1);
    assert.equal(
      due[0].text,
      `[Filament: PM (${id}), one of the developer's saved agents, whom you asked, finished. You asked:\nSLOW ${QUESTION}\n\nPM's answer:\n${ANSWER}\n\n${ADVICE} To ask it more in the same context, call agent with agent_id "${id}".]`,
    );
    door.close();
  });

  test("a follow-up continues its thread: it is told what happened in the session since its last look, and the result says whose it is", async () => {
    const { registry, posts, views } = scripted();
    const door = openDoor(registry);
    await call(door, "toolu_1", { run_in_background: false, description: "Queue or refuse", prompt: QUESTION, subagent_type: "pm" });
    const id = registry.list("c1")[0].id;
    const res = await call(door, "toolu_2", { run_in_background: false, agent_id: id, description: "And the sixth", prompt: "And a sixth, while the fifth is refused?" });
    assert.equal(views.length, 2, "it looks at the session again");
    assert.equal(views[1].strategy, "fold");
    assert.equal(textOf(posts[1].body.messages.at(-1)).split("\n").at(-1), "And a sixth, while the fifth is refused?");
    assert.ok(res.text.endsWith(`[Filament: PM (${id}) answered. ${ADVICE} To ask it more in the same thread, call agent with agent_id "${id}". 0 running.]`), res.text);
    door.close();
  });
});

// (fails before: yes — the owner's list of 10-19, "the main agent spawns these when asked in plain words": a saved agent
// the session did not name could not be asked, however plainly the developer's message asked for it)
describe("the agent asks a saved agent the developer's message names in plain words", () => {
  test("the tool takes it by name or tag in one field of its own, the same bytes in every session", () => {
    const field = { type: "string", description: TOOL_TEXT.agentSaved };
    assert.deepEqual(AGENT_TOOL.input_schema.properties.saved_agent, field);
    assert.equal(agentToolFor(ASKS).input_schema.properties.saved_agent, AGENT_TOOL.input_schema.properties.saved_agent, "a session that names agents carries the same field");
    assert.equal(coderAgentToolFor({ asks: [] }).input_schema.properties.saved_agent, AGENT_TOOL.input_schema.properties.saved_agent, "and so does a coding agent's tool");
    assert.deepEqual(AGENT_TOOL.input_schema.properties.subagent_type.enum, ["builder", "reviewer"], "the kinds stay the tool's own");
  });

  test("the message's names are kept for its session: a new message replaces them, a note adds its own, and a name no card holds is never among them", () => {
    const { registry } = scripted({ ask: [] });
    assert.deepEqual(registry.heard("c1", "Get the Skeptic's view on this, then send a Reviewer over the parser"), ["reviewer", "skeptic"], "in the cards' order: the shipped ones, then yours");
    assert.deepEqual(registry.heard("c1", "and the end-user's take", { add: true }), ["enduser"]);
    assert.deepEqual(registry.heard("c1", "Ask the explainer and the watcher what they saw"), [], "Explainer and Watcher ship no more (the owner's word of 11-05)");
    assert.deepEqual(registry.heard("c1", "see `skeptic.md` and src/skeptic/ — quite skeptical of it"), [], "a file, a path and another word are not its name");
    // (fails before: yes — the Verifier's finding of 10-22: a team's name named the agent inside it)
    assert.deepEqual(registry.heard("c1", "Spawn the Bug Hunter team, then a 10x Engineer's pass"), [], "Hunter in Bug Hunter, Engineer in the person's team 10x Engineer: not named there");
    assert.deepEqual(registry.heard("c1", "Have the Bug Hunters look, and send an Engineer over the parser"), ["engineer"], "named on its own, it is named");
  });

  // (fails before: yes — the bug round of 10-23: the names lived in Filament's memory alone, so a turn a restart cut,
  // which goes on by itself, could no longer ask the agent its person named)
  test("the message's names are kept on its chat: after a restart its agent may still ask the one it named", async () => {
    /** @type {Map<string, string[]>} */
    const kept = new Map();
    scripted({ ask: [], kept }).registry.heard("c1", "Ask the skeptic about it");
    assert.deepEqual(kept.get("c1"), ["skeptic"]);
    const again = scripted({ ask: [], kept });
    const door = openDoor(again.registry);
    await call(door, "toolu_1", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "skeptic" });
    assert.deepEqual(again.registry.list("c1").map((s) => s.card.tag), ["skeptic"]);
    door.close();
  });

  // (fails before: yes — OA1: a lead named gave its view and a worker named did a job, two ways for one kind of agent)
  test("an agent the message names runs as its card says, by its name or its tag — the Skeptic asked, the Engineer sent — the session naming neither", async () => {
    const { registry, posts } = scripted({ ask: [] });
    const door = openDoor(registry);
    registry.heard("c1", "Ask the skeptic whether we queue it, and send an Engineer over the parser");
    const asked = await call(door, "toolu_1", { run_in_background: false, description: "Queue or refuse", prompt: QUESTION, saved_agent: "Skeptic" });
    const sent = await call(door, "toolu_2", { run_in_background: false, description: "Fix", prompt: "Fix the bugs in src/parser.js", saved_agent: "@engineer", worktree: false });
    const [lead, worker] = registry.list("c1").sort((a, b) => (a.card.tag < b.card.tag ? 1 : -1));
    assert.deepEqual([lead.card, lead.asked, lead.view], [{ tag: "skeptic", name: "Skeptic" }, true, "folded"], "asked by its name, as its card says");
    assert.deepEqual([worker.card.tag, worker.asked, worker.may], ["engineer", true, "edit"], "sent by its tag, as its card says");
    assert.match(asked.note, /^agent: asked Skeptic, a saved agent/);
    assert.match(sent.note, /^agent: asked Engineer, a saved agent \(sa_[0-9a-f]{8}, m-sub/);
    assert.equal(posts.length, 2);
    door.close();
  });

  test("one the message does not name and one nobody made — Explainer among them, which ships no more — are refused in words, and nothing starts", async () => {
    const { registry, posts } = scripted({ ask: ["designer"] });
    const door = openDoor(registry);
    registry.heard("c1", "Ask the skeptic about it");
    await assert.rejects(call(door, "toolu_1", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "pm" }), {
      message: "the developer's newest message does not name PM: use it where their message asks for it by its name — or they let you use it on your own, on Library › Agents",
    });
    await assert.rejects(call(door, "toolu_2", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "Ghost" }), {
      message: "there is no saved agent “Ghost” — the developer's agents are on Library › Agents; give its name or tag as their message says it",
    });
    await assert.rejects(call(door, "toolu_3", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "explainer" }), { message: "there is no saved agent “explainer” — the developer's agents are on Library › Agents; give its name or tag as their message says it" });
    registry.heard("c1", "thanks, carry on");
    await assert.rejects(call(door, "toolu_4", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "skeptic" }), /newest message does not name Skeptic/, "the next message replaced the names");
    assert.deepEqual([registry.list("c1").length, posts.length], [0, 0]);
    await call(door, "toolu_5", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "Designer" });
    assert.deepEqual(registry.list("c1").map((s) => s.card.tag), ["designer"], "one the session names is there to ask either way");
    door.close();
  });

  // (fails before: yes — U13 revised: a job your agent sent on a card you named said "main agent" on its row, as any other)
  test("one it sent on a card the message named says so; one the session's list holds does not", async () => {
    const { registry } = scripted({ ask: ["designer"] });
    const door = openDoor(registry);
    registry.heard("c1", "Send a Reviewer over the parser, and ask the designer");
    await call(door, "toolu_1", { run_in_background: false, description: "Hunt", prompt: "Hunt bugs in src/parser.js", saved_agent: "@reviewer" });
    await call(door, "toolu_2", { run_in_background: false, description: "x", prompt: QUESTION, saved_agent: "Designer" });
    const rows = registry.list("c1");
    assert.deepEqual(Object.fromEntries(rows.map((s) => [s.card.tag, s.heard === true])), { reviewer: true, designer: false });
    assert.deepEqual(rows.map((s) => whoTag(/** @type {any} */ (s))).sort(), ["your agent", "your agent — you named it"]);
    door.close();
  });
});

// (fails before: yes — a launch's result named no count, and the limit's refusal named a setting the agent cannot change)
describe("the count and the limit", () => {
  test("every launch's result ends with how many run and how many more may start — the turn's own foreground launches left out (AG-48)", async () => {
    const gate = deferred();
    const { registry } = scripted({ serve: slowBy(gate) });
    const door = openDoor(registry);
    const bg = await call(door, "toolu_0", { description: "Scan", prompt: "SLOW scan the folder", run_in_background: true });
    const scan = idIn(bg.text);
    assert.ok(bg.text.startsWith(`Launched sub-agent ${scan} ("Scan") in the background.`) && bg.text.endsWith(" 1 running."), bg.text);
    // Two more in one reply, in the foreground: the reply's results are read only once both answered.
    const slow = call(door, "toolu_1", { run_in_background: false, description: "Feel", prompt: `SLOW ${QUESTION}`, subagent_type: "designer" });
    const fast = await call(door, "toolu_2", { run_in_background: false, description: "Scope", prompt: QUESTION, subagent_type: "pm" });
    assert.equal(registry.list("c1").filter((s) => s.status === "running").length, 2, "the scan and the Designer still run");
    assert.ok(fast.text.endsWith(" 1 running.]"), fast.text);
    gate.resolve();
    assert.ok((await slow).text.endsWith(" 0 running.]") || (await slow).text.endsWith(" 1 running.]"));
    await until(() => registry.get(scan)?.status === "done", "the scan to report");
    const plain = await call(door, "toolu_3", { run_in_background: false, description: "Look", prompt: "list the folder", subagent_type: "reviewer" });
    assert.ok(plain.text.endsWith(`[Filament: sub-agent ${idIn(plain.text)} — to ask it more in the same context, call agent with agent_id "${idIn(plain.text)}". 0 running.]`), plain.text);
    door.close();
  });

  test("past the limit a launch is refused, never queued: the limit, how many run, whose they are, and to wait (V4-D284, AG-49)", async () => {
    const gate = deferred();
    const { registry } = scripted({ max: 2, serve: slowBy(gate) });
    const door = openDoor(registry);
    await call(door, "toolu_1", { description: "One", prompt: "SLOW one", run_in_background: true });
    const second = await call(door, "toolu_2", { description: "Two", prompt: `SLOW ${QUESTION}`, subagent_type: "pm", run_in_background: true });
    assert.ok(second.text.endsWith(" 2 running."), second.text);
    const full = "The limit is 2 at once, and 2 are running. Wait for one to report.";
    await assert.rejects(call(door, "toolu_3", { run_in_background: false, description: "Three", prompt: "three" }), { message: full });
    await assert.rejects(call(door, "toolu_4", { run_in_background: false, description: "Three", prompt: QUESTION, subagent_type: "designer" }), { message: full });
    assert.equal(registry.list("c1").length, 2, "nothing waits unseen");
    // The developer reads the same refusal in their own words.
    assert.deepEqual(registry.launch({ origin: "owner", chainId: "c1", prompt: QUESTION, as: "skeptic" }), { ok: false, error: "The limit is 2 at once, and 2 are running. Wait for one to finish." });
    gate.resolve();
    await until(() => registry.list("c1").every((s) => s.status === "done"), "both to end");
    door.close();
  });

  test("when a running one is the developer's own, the refusal says so: its answer never comes to the agent", async () => {
    const gate = deferred();
    const { registry } = scripted({ max: 2, serve: slowBy(gate) });
    const theirs = registry.launch({ origin: "owner", chainId: "c1", prompt: `SLOW ${QUESTION}`, as: "skeptic" });
    assert.equal(theirs.ok, true, JSON.stringify(theirs));
    const door = openDoor(registry);
    const mine = await call(door, "toolu_1", { description: "One", prompt: "SLOW one", run_in_background: true });
    assert.ok(mine.text.endsWith(" 2 running."), "the developer's own takes a place too");
    await assert.rejects(call(door, "toolu_2", { run_in_background: false, description: "Two", prompt: QUESTION, subagent_type: "pm" }), { message: "The limit is 2 at once, and 2 are running, 1 of them the developer's own. Wait for one to finish." });
    gate.resolve();
    await until(() => registry.list("c1").every((s) => s.status === "done"), "both to end");
    door.close();
  });
});

// ---------------------------------------------------------------------------------------------------
// A team's lead
// ---------------------------------------------------------------------------------------------------

const TEAM = { key: "architect", name: "Architect", members: MEMBERS };
const BRIEF = { role: "builder", description: "Fix the parser", goal: "parse() accepts an empty file", steps: ["Return [] for an empty input"], acceptance: "the parser's tests pass" };
const ASK_PM = { role: "pm", description: "Queue or refuse", goal: QUESTION };

// (fails before: yes — a role that was no worker's was refused: a lead had no way to ask anyone but the developer)
describe("a team's lead asks on its own tool", () => {
  test("a role that is no worker's is a question, and its goal is all it needs", () => {
    assert.equal(isAsk("agent", ASK_PM, TAGS), true);
    assert.equal(isAsk("agent", BRIEF, TAGS), false, "a worker's launch is no question");
    assert.deepEqual([isAsk("worker", ASK_PM, TAGS), isAsk("agent", {}, TAGS), isAsk("agent", { role: " " }, TAGS), isAsk("agent", { role: 3 }, TAGS)], [false, false, false, false]);
    assert.equal(checkBrief(ASK_PM, MEMBERS), null);
    assert.equal(checkBrief({ role: "pm", description: "Queue or refuse" }, MEMBERS), "goal is required: your question to the agent you ask, whole");
  });

  test("it asks in the background, the answer a message like a worker's report; one the session does not name is refused with the roles it may launch (AG-52)", async () => {
    const gate = deferred();
    const { registry, posts } = scripted({ serve: slowBy(gate) });
    /** @type {any[]} */
    const events = [];
    const door = registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: root, mode: null, model: "m-lead", thinking: null, fork: null, emit: (e) => events.push(e), lead: true, round: () => 2 });
    const tools = createTeamTools({ registry });
    const of = (/** @type {any} */ input, callId = "toolu_1") => ({ chainId: "c1", lead: { runId: "lead-1", callId }, cwd: root, mode: null, model: "m-lead", thinking: null, team: TEAM, input });
    const res = await tools.agent(of({ ...ASK_PM, goal: `SLOW ${QUESTION}` }));
    assert.equal(res.ok, true, res.text);
    const id = String(res.agentId);
    assert.equal(res.text, `Asked PM (${id}) in the background. Keep working: its answer arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait. 1 running.`);
    assert.equal(res.note, `agent: asked PM, a saved agent (${id}, m-sub, folded view) for team Architect in the background`);
    const sa = registry.get(id);
    assert.deepEqual([sa?.card?.tag, sa?.team, sa?.may, sa?.background, sa?.origin], ["pm", null, "edit", true, "agent"], "an agent asked is no worker of the team: it runs at its card's level");
    await until(() => posts.length === 1, "PM's request to go out");
    assert.equal(posts[0].body.messages[0].content.at(-1).text, `${ASKED_BY_AGENT}\n\nSLOW ${QUESTION}`);
    const no = await tools.agent(of({ role: "skeptic", description: "Risk", goal: "What breaks?" }, "toolu_2"));
    assert.deepEqual([no.ok, no.text], [false, "Not launched: `skeptic` is not one you may ask. This session's agent may ask: `pm` (PM), `designer` (Designer) — or launch a worker in a role (scout, builder, tester, reviewer)."]);
    // (fails before: no — found writing this: the tool ended a refusal that was a sentence already with a second period)
    assert.ok(!no.text.endsWith(".."));
    // (fails before: yes — step 6: the refusal named four roles whoever the team's members were)
    const mine = await tools.agent({ ...of({ role: "skeptic", description: "Risk", goal: "What breaks?" }, "toolu_3"), team: { key: "docs", name: "Docs", members: [MEMBERS[1], MEMBERS[3]] } });
    assert.deepEqual([mine.ok, mine.text], [false, "Not launched: `skeptic` is not one you may ask. This session's agent may ask: `pm` (PM), `designer` (Designer) — or launch one of your team's workers (builder, reviewer)."]);
    gate.resolve();
    await until(() => registry.get(id)?.status === "done", "PM to answer");
    const due = door.inbox.take();
    assert.equal(due.length, 1);
    assert.equal(due[0].text, `[Filament: PM (${id}), one of the developer's saved agents, whom you asked, finished. You asked:\nSLOW ${QUESTION}\n\nPM's answer:\n${ANSWER}\n\n${ADVICE}]`, "a lead follows up by asking anew: no agent_id line");
    door.close();
  });
});

// ---------------------------------------------------------------------------------------------------
// The developer overrules an answer
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — an answer the agent asked for could be answered only by a message that named nothing)
describe("the developer overrules an answer", () => {
  test("the agent reads whose answer their words stand over, and to which question; into a running turn it joins what the turn reads next, and the session keeps it", async () => {
    const { registry, marks, published } = scripted();
    const door = openDoor(registry);
    await call(door, "toolu_1", { run_in_background: false, description: "Queue or refuse", prompt: QUESTION, subagent_type: "pm" });
    const id = registry.list("c1")[0].id;
    const frames = registry.overruleFrames("c1", [{ agentId: id, exchange: 0 }, { agentId: id, exchange: 0 }, { agentId: "" }]);
    assert.equal(frames.length, 1, "an answer once; a name of nothing is no answer");
    assert.deepEqual([frames[0].kind, frames[0].from, frames[0].exchange, frames[0].description], ["overrule", id, 0, "PM"]);
    assert.equal(
      frames[0].text,
      `[Filament: the developer overrules PM's answer to your question:\n${QUESTION}\n(PM answered: Refuse it, and name the limit.)\nTheir own words reach you with this, as their message, and stand over PM's advice.]`,
    );
    assert.deepEqual(door.inbox.take(), [], "composing the words queues nothing");
    assert.equal(registry.overrule("c1", [{ agentId: id, exchange: 0 }], "Queue it.\nThe fifth one matters to me."), 1);
    const due = door.inbox.take();
    assert.deepEqual(due.map((d) => [d.kind, d.text]), [["overrule", frames[0].text]]);
    assert.deepEqual(marks.map((m) => [m.event, m.agentId, m.exchange, m.description, m.words]), [["overruled", id, 0, "PM", "Queue it."]], "the card reads the words' first line from the session");
    assert.ok(published.some((p) => p.topic === "subagents" && p.e.type === "subagent-mark" && p.e.mark.event === "overruled"), "an open page hears it");
    door.close();
  });

  test("an agent the registry no longer holds: the page's name and question stand in; another session's agent is nobody's to overrule; with no turn the words wait for the next", async () => {
    const { registry, marks } = scripted();
    const frames = registry.overruleFrames("c1", [{ agentId: "sa_0badc0de", exchange: 1, name: "Designer", question: "Refuse in a toast, or in the row?" }]);
    assert.equal(frames[0].text, "[Filament: the developer overrules Designer's answer to your question:\nRefuse in a toast, or in the row?\nTheir own words reach you with this, as their message, and stand over Designer's advice.]");
    assert.equal(registry.overruleFrames("c1", [{ agentId: "sa_0badc0de" }])[0].text, "[Filament: the developer overrules a saved agent's answer.\nTheir own words reach you with this, as their message, and stand over a saved agent's advice.]");
    const elsewhere = registry.launch({ origin: "owner", chainId: "c2", prompt: QUESTION, as: "pm" });
    await /** @type {any} */ (elsewhere).done;
    assert.deepEqual(registry.overruleFrames("c1", [{ agentId: /** @type {any} */ (elsewhere).id, exchange: 0 }]), []);
    assert.deepEqual(registry.overruleFrames("c1", null), []);
    assert.equal(registry.overruleFrames("c1", Array.from({ length: 12 }, (_, i) => ({ agentId: `sa_${String(i).padStart(8, "0")}` }))).length, 8, "a message overrules eight answers at most");
    // No turn runs: the words' frame waits for the turn that reads the session next.
    marks.length = 0;
    assert.equal(registry.overrule("c1", [{ agentId: "sa_0badc0de", exchange: 1, name: "Designer" }], "In the row."), 1);
    const door = openDoor(registry, { runId: "turn-2" });
    assert.deepEqual(door.inbox.take().map((d) => d.kind), ["overrule"]);
    assert.deepEqual(marks.map((m) => [m.event, m.words]), [["overruled", "In the row."]]);
    door.close();
  });
});

// (fails before: yes — the line is kept in the developer's message, and every reader of that message read it out as
// their words: a lead's view of the session opened each turn with "User: [Filament: the developer named saved agents for you to consult…", a
// one-line stub was the line and none of the words, a search for "designer" found every turn: AG-74)
describe("the line that names whom the agent may ask is the turn's own model's alone", () => {
  const LINE = askLine(["pm", "designer"]);
  const WORDS = "Reports lose their tail. Fix it.";
  const user = { role: "user", content: [{ type: "text", text: LINE }, { type: "text", text: WORDS }] };
  const final = { role: "assistant", content: [{ type: "text", text: "Fixed." }] };
  const t = /** @type {any} */ ({ n: 1, user, work: [], final, meta: {} });

  test("a reader of the session is shown the message without it — a view, a summary's transcript, a stub, a turn recalled — and the model's own conversation keeps it", () => {
    assert.deepEqual(withoutAskLine(user), { role: "user", content: [user.content[1]] });
    const plain = { role: "user", content: "say hello" };
    assert.equal(withoutAskLine(plain), plain);
    assert.equal(withoutAskLine(final), final);
    // A turn's fold joins the message's blocks into one text: the line is its first line, and the words stay.
    const folded = renderTurn(t, "fold").messages[0];
    assert.deepEqual(folded.content, [{ type: "text", text: `${LINE}\n${WORDS}` }], "the model's own copy of an older turn keeps it");
    assert.ok(!isAskLine(folded.content[0].text), "a text that goes on after the line is not the line");
    assert.deepEqual(withoutAskLine(folded).content, [{ type: "text", text: WORDS }]);
    assert.equal(messagesTranscript([folded, final]), `User: ${WORDS}\nAssistant: Fixed.`);
    assert.equal(turnTranscript(t), `## Turn 1\nUser: ${WORDS}\nAssistant: Fixed.`);
    assert.ok(foldedTranscript(t).startsWith(`## Turn 1\nUser: ${WORDS}\n`), foldedTranscript(t));
    assert.equal(messagesTranscript([user, final]), `User: ${WORDS}\nAssistant: Fixed.`);
    assert.deepEqual(renderTurn(t, "raw").messages[0], user, "the turn's own model reads the message as it was sent");
    const recalled = recallTurn({ turnBodies: () => [{ ...t, endedAt: 1 }] }, "c", 1);
    assert.ok(recalled?.text.startsWith(`## Turn 1\nUser: ${WORDS}\n`), recalled?.text);
  });

  test("the archive's readers: a search across sessions and one inside a session find the words and not the line, and a session as text opens with the words", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-askline-"));
    const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
    try {
      const c = a.chainForKey("h:askline", { cwd: "C:\\proj", client: "test", model: "m" });
      const { turnId } = a.beginTurn(c.id, { userMessage: user });
      a.finishTurn(turnId, { finalMessage: final });
      assert.deepEqual(a.grep(c.id, { text: "named saved agents for you to consult" }).matches, []);
      assert.deepEqual(a.grep(c.id, { text: "lose their tail" }).matches.map((/** @type {any} */ m) => m.turn), [1]);
      assert.deepEqual(a.searchInputs("designer"), []);
      assert.deepEqual(a.searchInputs("tail").map((/** @type {any} */ r) => r.n), [1]);
      const text = String(a.render(c.id, { view: "chat" })?.text);
      assert.ok(text.includes(`User: ${WORDS}`) && !text.includes("[Filament: the developer named saved agents"), text);
    } finally {
      a.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app
// ---------------------------------------------------------------------------------------------------

describe("through the app", () => {
  /** @type {string} */ let folder;
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  let gate = deferred();
  /** Who a request answers as: a saved agent's name; null for the main agent's. @param {any} c */
  const asWhom = (c) => (/You answer as ([^.]+)\./.exec(JSON.stringify(c.body?.system ?? "")) || [])[1] || null;
  /** The results a request's newest message answers, by call. @param {any} c @returns {Record<string, string>} */
  const resultsIn = (c) =>
    Object.fromEntries(
      (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : [])
        .filter((/** @type {any} */ b) => b?.type === "tool_result")
        .map((/** @type {any} */ b) => [b.tool_use_id, typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x.text || "").join("")]),
    );
  /** The text blocks of a request's newest message. @param {any} c @returns {string[]} */
  const wordsIn = (c) => {
    const m = c.body?.messages?.at(-1);
    return typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text);
  };
  const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
  /** @param {any} [settings] */
  const newSession = async (settings) => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", ...(settings ? { settings } : {}) } });
    assert.equal(s.status, 200, await s.clone().text());
    return String((await s.json()).id);
  };
  /** @param {string} id @param {any} body */
  const send = async (id, body) => {
    const r = await shim.api(at(id, "/turns"), { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const transcript = async (/** @type {string} */ id) => (await shim.api(at(id, "/transcript"))).json();

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-mayask-"));
    writeFileSync(join(folder, "notes.txt"), "hello\n");
    up = await fakeUpstream(async (call) => {
      const model = String(call.body?.model || "");
      const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 50, output_tokens: 7 } });
      const who = asWhom(call);
      if (who) return blocks([{ type: "text", text: `Refuse it, and name the limit.\n\n${who} SAYS a launch must not wait unseen.` }]);
      const results = resultsIn(call);
      const last = wordsIn(call).join("\n");
      if (results.toolu_ask) return blocks([{ type: "text", text: "I asked PM and will refuse the fifth launch." }]);
      if (results.toolu_hold) {
        await gate.promise;
        return blocks([{ type: "text", text: "Read the notes." }, { type: "tool_use", id: "toolu_after", name: "read", input: { path: "notes.txt" } }], "tool_use");
      }
      if (results.toolu_after) return blocks([{ type: "text", text: "MAIN DONE" }]);
      if (results.toolu_cmd) return blocks([{ type: "text", text: "CMD ANSWERED" }]);
      if (/run the command/.test(last)) return blocks([{ type: "tool_use", id: "toolu_cmd", name: "bash", input: { command: "echo one > one.txt" } }], "tool_use");
      if (/decide the fifth launch/.test(last)) return blocks([{ type: "text", text: "A decision the developer sees: asking PM." }, { type: "tool_use", id: "toolu_ask", name: "agent", input: { run_in_background: false, description: "Queue or refuse", prompt: QUESTION, subagent_type: "pm" } }], "tool_use");
      if (results.toolu_saved) return blocks([{ type: "text", text: "SAVED ANSWERED" }]);
      if (/Skeptic's view|the same one again/.test(last)) return blocks([{ type: "tool_use", id: "toolu_saved", name: "agent", input: { run_in_background: false, description: "Its view", prompt: QUESTION, saved_agent: "Skeptic" } }], "tool_use");
      if (/work then hold/.test(last)) return blocks([{ type: "tool_use", id: "toolu_hold", name: "read", input: { path: "notes.txt" } }], "tool_use");
      return blocks([{ type: "text", text: "MAIN HEARD" }]);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    // The person's own cards asked here, beside the ones that ship (helpers/flow-cards.js).
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
    // What PM and the Skeptic are shown of the session is read here: as they ship they see nothing, so they are set to see it.
    for (const tag of ["pm", "skeptic"]) {
      const set = await shim.api(`/api/agents/${tag}`, { method: "PUT", body: { sees: { view: "folded", running: true } } });
      assert.equal(set.status, 200, await set.clone().text());
    }
  });
  after(async () => {
    gate.resolve();
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, folder]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  /** The main agent's requests since a mark. @param {number} mark */
  const mainSince = (mark) => up.received.slice(mark).filter((/** @type {any} */ c) => !asWhom(c) && Array.isArray(c.body?.tools) && c.body.tools.length);
  const agentTool = (/** @type {any} */ c) => c.body.tools.find((/** @type {any} */ t) => t.name === "agent");

  // (fails before: yes — found by E15 step 3's live drive: with the rule in its instructions alone a real model asked
  // a saved agent in 1 turn of 8 that held an open choice, and in 10 of 13 with this line on the message: AG-74)
  test("whom the agent may ask is named with the developer's message, first of Filament's blocks — only where the turn's agent holds the tool, never on a command or an answer", async () => {
    const LINE = "[Filament: the developer named saved agents for you to consult: pm, designer. Before you settle a choice between ways that could both be right, in a plan or in the files, ask one first.]";
    assert.equal(askLine(["pm", "designer"]), LINE);
    assert.ok(isAskLine(LINE) && isAskLine(`\n ${LINE}`) && !isAskLine("[Filament: sub-agent sa_1 reported]") && !isAskLine("ask pm"));
    const turn = async (/** @type {string} */ id, /** @type {string} */ content) => {
      const mark = up.received.length;
      const r = await shim.api(at(id, "/turns"), { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      return { head: [r.headers.get("x-filament-deliveries"), r.headers.get("x-filament-asking")], words: mainSince(mark)[0] ? wordsIn(mainSince(mark)[0]) : null };
    };
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", autoTitle: true, settings: { subagents: { ask: ["pm", "designer"] } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const named = String((await made.json()).id);
    const first = await turn(named, "Reports lose their tail. Fix it.");
    assert.deepEqual(first, { head: ["1", "1"], words: [LINE, "Reports lose their tail. Fix it."] });
    const second = await turn(named, "And the header row?");
    assert.deepEqual(second.words, [LINE, "And the header row?"], "every message of the developer's, not the first alone");
    const tr = await transcript(named);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [t.deliveries, t.asking, t.user.content.length]), [[1, 1, 2], [1, 1, 2]], "kept with the message, and counted apart from a sub-agent's");
    assert.equal(tr.title, "Reports lose their tail. Fix it.", "the session is named by the developer's words");
    // (fails before: yes — a saved agent asked from the page read the line as the developer's words, once a turn; the
    // turn recalled opened with it)
    const markView = up.received.length;
    const asked = await shim.api(at(named, "/subagents"), { method: "POST", body: { as: "pm", prompt: "Is that plan right?" } });
    assert.equal(asked.status, 200, await asked.clone().text());
    const pm = await until(() => up.received.slice(markView).find(asWhom) || null, "PM's request");
    const view = JSON.stringify(pm.body.messages);
    assert.ok(view.includes("Reports lose their tail. Fix it.") && view.includes("And the header row?") && !view.includes("[Filament: the developer named saved agents"), view);
    const recalled = await (await shim.api(at(named, "/recall"), { method: "POST", body: { turn: 2 } })).json();
    assert.ok(String(recalled.text).startsWith("## Turn 2\nUser: And the header row?\n"), recalled.text);
    // A command is Filament's own turn: nothing rides it.
    const cmd = await shim.api(at(named, "/turns"), { method: "POST", body: { content: "/settings", stream: false } });
    assert.deepEqual([cmd.status, cmd.headers.get("x-filament-asking")], [200, null]);
    // Nobody named, and the agent tool switched off: the message is the developer's alone.
    assert.deepEqual(await turn(await newSession(), "say hello"), { head: [null, null], words: ["say hello"] });
    assert.deepEqual(await turn(await newSession({ subagents: { ask: ["pm"] }, loop: { tools: { agent: false } } }), "say hello"), { head: [null, null], words: ["say hello"] });
    // A card deleted since it was named is left out; with none left there is no line.
    const copy = await shim.api("/api/agents", { method: "POST", body: { from: "pm", tag: "gone", name: "Gone" } });
    assert.equal(copy.status, 200, await copy.clone().text());
    const mixed = await newSession({ subagents: { ask: ["gone"] } });
    assert.deepEqual((await turn(mixed, "one")).words, [askLine(["gone"]), "one"]);
    assert.equal((await shim.api("/api/agents/gone", { method: "DELETE" })).status, 200);
    assert.deepEqual(await turn(mixed, "two"), { head: [null, null], words: ["two"] });
  });

  // (fails before: yes — HarnessV4_Tasks U12-D7: the launch route took no effort, so a thread from the Sub Agents tab
  // could not name how hard its agent thinks)
  test("the launch route takes an effort, refused in words where it names no level", async () => {
    const id = await newSession();
    const bad = await shim.api(at(id, "/subagents"), { method: "POST", body: { as: "pm", prompt: "Is that plan right?", effort: "loud" } });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, "effort must be one of model, low, medium, high, xhigh, max"]);
    const asked = await shim.api(at(id, "/subagents"), { method: "POST", body: { as: "pm", prompt: "Is that plan right?", effort: "high" } });
    assert.equal(asked.status, 200, await asked.clone().text());
    await until(async () => (await (await shim.api(at(id, "/subagents"))).json()).subagents.every((/** @type {any} */ s) => s.status !== "running") || null, "PM to answer");
  });

  // (fails before: yes — the route did not exist, and no request's tool named a saved agent)
  test("a tick on a card is the default for every chat that has not chosen: the list is kept, and the next turn's tool and instructions carry it", async () => {
    const before = await (await shim.api("/api/agents")).json();
    assert.deepEqual(before.ask, []);
    const bad = await shim.api("/api/subagents/ask", { method: "PUT", body: { tags: ["pm", "nobody"] } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /nobody/);
    const put = await shim.api("/api/subagents/ask", { method: "PUT", body: { tags: ["@PM", "designer", "pm"] } });
    assert.equal(put.status, 200, await put.clone().text());
    assert.deepEqual((await put.json()).ask, ["pm", "designer"]);
    assert.deepEqual((await (await shim.api("/api/agents")).json()).ask, ["pm", "designer"]);
    try {
      const id = await newSession();
      const mark = up.received.length;
      await send(id, { content: "say hello" });
      const req = mainSince(mark)[0];
      assert.deepEqual(agentTool(req).input_schema.properties.subagent_type.enum, ["builder", "reviewer", "pm", "designer"]);
      assert.ok(agentTool(req).description.includes("`pm` (PM): ") && agentTool(req).description.includes("`designer` (Designer): "));
      assert.ok(JSON.stringify(req.body.system).includes("The developer named saved agents for you to consult"));
      // A chat that chose its own list: that list, whole, in the default's place.
      const own = await newSession({ subagents: { ask: ["skeptic"] } });
      const mark2 = up.received.length;
      await send(own, { content: "say hello" });
      assert.deepEqual(agentTool(mainSince(mark2)[0]).input_schema.properties.subagent_type.enum, ["builder", "reviewer", "skeptic"]);
    } finally {
      const clear = await shim.api("/api/subagents/ask", { method: "PUT", body: { tags: [] } });
      assert.equal(clear.status, 200);
    }
    const id = await newSession();
    const mark = up.received.length;
    await send(id, { content: "say hello" });
    const req = mainSince(mark)[0];
    assert.deepEqual(agentTool(req).input_schema.properties.subagent_type.enum, ["builder", "reviewer"], "nobody named: the tool as it was");
    assert.ok(!JSON.stringify(req.body.system).includes("The developer named saved agents"));
  });

  // (fails before: yes — the model's call with a tag started a writing sub-agent with the question as its task)
  test("the agent asks PM in its turn: PM answers as itself, the call's result is its answer framed as advice, and the turn's events name whose card it is", async () => {
    const id = await newSession({ subagents: { ask: ["pm"] } });
    const mark = up.received.length;
    const out = await send(id, { content: "decide the fifth launch" });
    assert.match(JSON.stringify(out), /I asked PM and will refuse the fifth launch\./);
    const pm = up.received.slice(mark).filter(asWhom);
    assert.deepEqual(pm.map(asWhom), ["PM"]);
    assert.ok(wordsIn(pm[0]).at(-1)?.endsWith(`${ASKED_BY_AGENT}\n\n${QUESTION}`), "PM is told who asks");
    assert.ok(JSON.stringify(pm[0].body.messages).includes("decide the fifth launch"), "and shown the turn that asks, as its card says");
    // (fails before: yes — the turn that asks was shown with the line that names PM as the developer's first words)
    assert.ok(!JSON.stringify(pm[0].body.messages).includes("[Filament: the developer named saved agents"), "without the line that named it to the main agent");
    const back = mainSince(mark).map(resultsIn).find((r) => r.toolu_ask)?.toolu_ask || "";
    const sid = idIn(back);
    assert.equal(back, `Refuse it, and name the limit.\n\nPM SAYS a launch must not wait unseen.\n\n[Filament: PM (${sid}) answered. ${ADVICE} To ask it more in the same thread, call agent with agent_id "${sid}". 0 running.]`);
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    assert.deepEqual(subagents.map((/** @type {any} */ s) => [s.id, s.card?.tag, s.origin, s.status]), [[sid, "pm", "agent", "done"]]);
    const tr = await transcript(id);
    const rid = String(tr.turns.at(-1).requestIds.at(-1));
    const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(rid)}/events?since=0`)).json();
    assert.deepEqual(events.find((/** @type {any} */ e) => e.type === "subagent-start")?.card, { tag: "pm", name: "PM" }, "the turn's row knows whose answer it shows");
  });

  // (fails before: yes — the owner's list of 10-19, "the main agent spawns these when asked in plain words": a saved
  // agent the session did not name could not be asked, however plainly the message asked for it)
  test("a saved agent the developer's message names in plain words is asked, the session naming none; their next message that does not name it leaves it unasked", async () => {
    const id = await newSession();
    const mark = up.received.length;
    await send(id, { content: "Get the Skeptic's view on the fifth launch" });
    assert.deepEqual(up.received.slice(mark).filter(asWhom).map(asWhom), ["Skeptic"]);
    const back = mainSince(mark).map(resultsIn).find((r) => r.toolu_saved)?.toolu_saved || "";
    assert.match(back, /^Refuse it, and name the limit\.\n\nSkeptic SAYS a launch must not wait unseen\./);
    const mark2 = up.received.length;
    await send(id, { content: "And the same one again" });
    assert.deepEqual(up.received.slice(mark2).filter(asWhom), [], "nobody is asked");
    assert.match(mainSince(mark2).map(resultsIn).find((r) => r.toolu_saved)?.toolu_saved || "", /the developer's newest message does not name Skeptic/);
  });

  // (fails before: yes — a turn's body took no `overrules`: the words went as a bare message)
  test("an overrule with the next message: the agent reads the frame ahead of the words, the bubble says whose answer, and the card reads it after a reload", async () => {
    const id = await newSession({ subagents: { ask: ["pm"] } });
    await send(id, { content: "decide the fifth launch" });
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    const sid = subagents[0].id;
    const mark = up.received.length;
    await send(id, { content: "Queue it. The fifth one matters to me.", overrules: [{ agentId: sid, exchange: 0, name: "PM", question: QUESTION }] });
    const words = wordsIn(mainSince(mark)[0]);
    assert.deepEqual(words, [
      askLine(["pm"]),
      `[Filament: the developer overrules PM's answer to your question:\n${QUESTION}\n(PM answered: Refuse it, and name the limit.)\nTheir own words reach you with this, as their message, and stand over PM's advice.]`,
      "Queue it. The fifth one matters to me.",
    ]);
    const tr = await transcript(id);
    assert.deepEqual(tr.subagentOverruled[`${sid}:0`]?.words, "Queue it. The fifth one matters to me.");
    assert.deepEqual(tr.turns.at(-1).overrules, [{ agentId: sid, exchange: 0, name: "PM" }]);
    assert.deepEqual([tr.turns.at(-1).deliveries, tr.turns.at(-1).asking, tr.turns.at(-1).user.content.length], [2, 1, 3], "the page draws the typed words alone: the first two blocks are Filament's");
    // A slash command overrules nothing.
    const cmd = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "/settings", stream: false, overrules: [{ agentId: sid, exchange: 0 }] } });
    assert.equal(cmd.status, 200, await cmd.clone().text());
    assert.equal(Object.keys((await transcript(id)).subagentOverruled).length, 1);
  });

  // (fails before: yes — a note into a running turn took no `overrules`)
  test("an overrule sent into a running turn: the frame joins what the turn reads next, with the note", async () => {
    const id = await newSession({ subagents: { ask: ["pm"] } });
    await send(id, { content: "decide the fifth launch" });
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    const sid = subagents[0].id;
    gate = deferred();
    const mark = up.received.length;
    const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
    try {
      await until(() => mainSince(mark).some((/** @type {any} */ c) => resultsIn(c).toolu_hold), "the turn's second round to be in flight");
      const { runs } = await (await shim.api("/api/runs?limit=50")).json();
      const live = runs.find((/** @type {any} */ r) => r.status === "running" && r.kind !== "subagent");
      assert.ok(live, JSON.stringify(runs.map((/** @type {any} */ r) => [r.id, r.kind, r.status])));
      const steer = await shim.api(`/api/runs/${encodeURIComponent(live.id)}/steer`, { method: "POST", body: { kind: "note", text: "Queue it instead.", from: "harness", overrules: [{ agentId: sid, exchange: 0 }] } });
      assert.equal(steer.status, 200, await steer.clone().text());
      const took = await steer.json();
      assert.equal(took.overruled, 1);
      // (fails before: yes — the note's record did not say whose answer, so a reloaded page drew its bubble bare)
      assert.deepEqual(took.message.overrules, [{ agentId: sid, exchange: 0, name: "PM" }], "the note's own record names the answer");
      const logged = (await (await shim.api(`/api/runs/${encodeURIComponent(live.id)}/events?since=0`)).json()).events.find((/** @type {any} */ e) => e.type === "steer" && e.id === took.message.id);
      assert.deepEqual(logged?.overrules, [{ agentId: sid, exchange: 0, name: "PM" }], "and so does the run's log, which a reload reads");
      // A list that names no agent overrules nothing: the note goes as it is.
      const bare = await shim.api(`/api/runs/${encodeURIComponent(live.id)}/steer`, { method: "POST", body: { kind: "note", text: "And hurry.", from: "harness", overrules: [{ exchange: 0, name: "PM" }] } });
      const plain = await bare.json();
      assert.deepEqual([bare.status, plain.overruled, plain.message.overrules], [200, undefined, undefined]);
    } finally {
      gate.resolve();
    }
    assert.equal((await turn).status, 200);
    const next = mainSince(mark).find((/** @type {any} */ c) => resultsIn(c).toolu_after);
    const read = wordsIn(next).join("\n");
    assert.ok(read.includes("[Filament: the developer overrules PM's answer to your question:"), read);
    assert.ok(read.includes("Queue it instead."), read);
    assert.equal((await transcript(id)).subagentOverruled[`${sid}:0`]?.words, "Queue it instead.");
  });

  // (fails before: yes — a turn's body took no `overrules`, so the answer to a waiting permission overruled nothing)
  test("an overrule sent as the answer to a waiting permission: the answer is the developer's words alone, and the resumed turn reads whose answer they overrule beside the call's result", async () => {
    const id = await newSession({ subagents: { ask: ["pm"] } });
    await send(id, { content: "decide the fifth launch" });
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    const sid = subagents[0].id;
    const asked = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "run the command", stream: false } });
    assert.equal(asked.status, 200, await asked.clone().text());
    assert.equal((await shim.record(asked.headers.get("x-filament-request-id"))).agent.status, "paused", "Edit mode asks before a command that writes");
    const mark = up.received.length;
    const answered = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "no: PM is wrong, queue it", stream: false, overrules: [{ agentId: sid, exchange: 0, name: "PM", question: QUESTION }] } });
    assert.equal(answered.status, 200, await answered.clone().text());
    assert.equal(answered.headers.get("x-filament-deliveries"), null, "nothing rides ahead of the answer: it stays an answer");
    const next = mainSince(mark)[0];
    assert.deepEqual(Object.keys(resultsIn(next)), ["toolu_cmd"], "the round that reads the declined call's result");
    assert.ok(resultsIn(next).toolu_cmd.includes("no: PM is wrong, queue it"), resultsIn(next).toolu_cmd);
    assert.deepEqual(wordsIn(next), [
      `[Filament: the developer overrules PM's answer to your question:\n${QUESTION}\n(PM answered: Refuse it, and name the limit.)\nTheir own words reach you with this, as their message, and stand over PM's advice.]`,
    ]);
    assert.ok(!existsSync(join(folder, "one.txt")), "the no declined the call");
    const tr = await transcript(id);
    assert.equal(tr.subagentOverruled[`${sid}:0`]?.words, "no: PM is wrong, queue it");
    assert.deepEqual(tr.turns.at(-1).overrules, [{ agentId: sid, exchange: 0, name: "PM" }], "the answer's bubble says whose answer");
  });
});
