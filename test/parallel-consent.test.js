// @ts-check
// Parallelize tasks is the person's consent (the owner's of 11-09: "turning that on is considered to be a consent"):
// on in Settings › Experimental, where tasks of the agent's graph can run at once — truly independent, none needing
// another's work, a file shared or not, each in its own worktree — the agent starts them on sub-agents itself, and no
// card asks the person first. Off, the agent suggests them on the side-by-side card (the owner's of 11-10), and the
// person accepts or ignores it; no sub-agent that changes files starts without their yes on a card, which answers
// itself in 60 seconds, and every agent that decides on sub-agents is told so (the owner's of 11-14).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { agentContext, CODER_PARALLEL_OFF_TEXT, CODER_PARALLEL_TEXT, PARALLEL_BLOCK } from "../src/app/agent-context.js";
import { LAUNCH_BLOCK } from "../src/app/agent-launch.js";
import { GRAPH_TOOL, LAUNCH_TOOL, contextState, contextUpdate, openedWith } from "../src/adapters/agents/context.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";
import { PARALLEL_DESC } from "../src/ui/harness/settings/experimental.js";
import { PROMPT, systemPromptFor } from "../src/app/agent/prompt.js";
import { loopSystem } from "../src/app/agent/system.js";

const T0 = Date.UTC(2026, 10, 9, 9, 0);
/** @type {import("../src/core/task-graph.js").Crew} */
const AGENT = "agent";
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** api and ui ready and apart; docs needs api. */
const ADD = {
  action: "add",
  goal: "Ship the card",
  tasks: [
    { id: "api", name: "The route", writes: ["src/http/a.js"], check: ["node -e 0"], steps: ["Write the route"] },
    { id: "ui", name: "The card", writes: ["src/ui/card.js"], check: ["node -e 0"], steps: ["Draw the card"] },
    { id: "docs", name: "The docs", needs: ["api"], writes: ["docs/GUIDE.md"], steps: ["Say it"] },
  ],
};
/**
 * The answer with the switch off, the loop's and a coding agent's alike (the owner's of 11-10): suggest them on a card,
 * which answers itself in 60 seconds, a builder for one held the same way; else do them yourself (the owner's of 11-14).
 */
const OFF = "The graph lets api and ui run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, suggest them to the person: {\"action\":\"parallel\",\"ids\":[\"api\",\"ui\"]} puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way. If not, do them yourself, in order.";
const OFF_CODER = OFF;

describe("the tasks answer", () => {
  // (fails before: yes — the owner's of 11-09: on, the answer offered the set as off did, for the person's card)
  // (fails before: yes — the owner's of 11-10: off, the answer told the agent to start them on sub-agents itself)
  // (fails before: yes — the owner's of 11-14: off, the answer said nothing of the card's 60 seconds, nor of a builder
  // the agent launches for one, nor what to do where they should not run at once)
  test("on, it says to run them at once now — by: sub-agent, or a coding agent's agent tool —; off, to suggest them on a card", () => {
    const on = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, parallel: true }));
    assert.ok(on.text.endsWith("\nThe graph lets api and ui run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, Parallelize tasks is on, so run them at once now: change them to by: sub-agent with goal, steps and acceptance — Filament starts each; if not, go on."), on.text);
    const coder = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, solo: true, parallel: true }));
    assert.ok(coder.text.endsWith("\nThe graph lets api and ui run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, Parallelize tasks is on, so run them at once now: give them to Filament's agent tool, one each, on your own model — name it in model, and the task in task, so the work you planned stays yours and its box shows who works on it; if not, go on."), coder.text);
    assert.ok(ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT })).text.endsWith(`\n${OFF}`));
    assert.ok(ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, solo: true })).text.endsWith(`\n${OFF_CODER}`));
    assert.ok(ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, parallel: false })).text.endsWith(`\n${OFF}`), "off said outright: the same");
  });

  test("a planning turn hears nothing of starting them, on or off; a lead's tasks are its workers'", () => {
    assert.equal(ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, parallel: true, planning: true })).text.includes("side by side"), false);
    const BRIEF = { goal: "Done", steps: ["Do it"], acceptance: "it passes" };
    const led = /** @type {any} */ ([{ tag: "builder", role: "builder" }]);
    const lead = tg.applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "a", name: "A", by: "builder", writes: ["a.js"], ...BRIEF }, { id: "b", name: "B", by: "builder", writes: ["b.js"], ...BRIEF }] }, { at: T0, crew: led, parallel: true });
    if (lead.ok) assert.equal(lead.text.includes("side by side"), false, lead.text);
  });
});

describe("the lines ahead of a message", () => {
  // (fails before: yes — the /plan's line asked for the tasks parallelized "once they approve the plan", on sub-agents
  // nobody had said would start by themselves)
  test("/plan on: the tasks that wait on no other go to sub-agents, and start at once when the person approves", () => {
    const on = tg.planAskLine({ side: true });
    assert.ok(on.includes("\n- Parallelize tasks is on, which is their consent: give each task only the needs it truly waits on and the files it writes, and put the ones that wait on no other on sub-agents (by: sub-agent), so they start at once when the person approves the plan — a coding agent then gives each to Filament's agent tool.\n"), on);
    assert.doesNotMatch(tg.planAskLine(), /Parallelize tasks/);
  });

  test("the line ahead of each message stays for what was sent with it, every reader but the model leaving it out", () => {
    assert.equal(typeof tg.SIDE_BY_SIDE_LINE, "string");
    assert.match(tg.SIDE_BY_SIDE_LINE, /^\[Filament: Parallelize tasks is on/);
  });
});

describe("the system prompt's words", () => {
  // (fails before: yes — no words said the switch was the person's consent)
  // (fails before: yes — g3b, the owner's of 11-09: tasks that shared a file were said to stay in order, though each
  // sub-agent works in its own worktree and the second to land merges)
  // (fails before: yes — the owner's of 11-09, D5: a chat whose sub-agents work in its folder was told they work each in
  // its own worktree; one fixed sentence says both, so the prompt is the same bytes whatever the folder mode)
  test("the loop's line: their consent; truly independent tasks started on sub-agents now, unasked, sharing a file or not — in order where they work in the chat's folder; the rest in order", () => {
    assert.equal(tg.PARALLEL_CONSENT, "- Parallelize tasks is on: the person turned it on, and that is their consent. When tasks of your graph can run at once — truly independent: none needs another's work — give them to sub-agents yourself, now, without asking: by: sub-agent, each with its goal, steps and acceptance, and Filament starts them side by side. Each works in its own worktree, so they may share a file — unless the chat's sub-agents work in its folder: then tasks that share a file stay in order. Tasks that need each other stay in order.");
  });

  // (fails before: yes — k2: the line was written, and no prompt carried it)
  test("the loop's prompt: the main agent's graph section carries it, after its sub-agents' line — never a lead's, a sub-agent's or a worker's; off, the tools section's hold line in its place", () => {
    const base = { root: "R", delegateRead: false, graph: true };
    const on = systemPromptFor({ ...base, parallel: true });
    const off = systemPromptFor(base);
    assert.equal(
      on,
      off.replace(`${PROMPT.agentRecipes}\n${PROMPT.parallelOff}\n`, `${PROMPT.agentRecipes}\n`).replace(`${PROMPT.graphSubagents}\n`, `${PROMPT.graphSubagents}\n${tg.PARALLEL_CONSENT}\n`),
      "one line, in the graph's section, after its sub-agents' line; the hold line goes",
    );
    assert.equal(systemPromptFor({ ...base, parallel: false }), off, "off said outright: the same bytes");
    assert.equal(systemPromptFor({ ...base, supervise: true, parallel: true }).includes(`${tg.PARALLEL_CONSENT}\n${PROMPT.graphLooks}`), true, "before the line on reading along");
    const lead = { name: "Architect", persona: "" };
    for (const [why, o] of /** @type {[string, any][]} */ ([["a lead", { lead }], ["a sub-agent", { subagent: true }], ["a worker", { subagent: true, worker: { team: "T" } }], ["no graph", { graph: false }], ["no tools", { noTools: true }]]))
      assert.equal(systemPromptFor({ ...base, ...o, parallel: true }).includes(tg.PARALLEL_CONSENT), false, why);
  });

  // (fails before: yes — the owner's of 11-14: off, nothing told the loop's agent that the person's yes on a card starts
  // a sub-agent that changes files, nor that a lone piece it would only wait on is its own)
  test("off, the main agent's tools section says the hold after the three ways sub-agents pay, graph or none — never a lead's, a sub-agent's, a worker's or an agent with no agent tool; the lone piece is said on or off", () => {
    assert.equal(
      PROMPT.parallelOff,
      "Parallelize tasks is off: the person has not agreed to sub-agents that change files working beside you. What you can do yourself, do yourself, one piece after another. A builder pays only where two or more independent pieces run at once while you do another or check their work. When that pays, launch them in one reply: Filament holds each and asks the person on a card, which starts them on their Accept, or by itself after 60 seconds, and tells you which. Until then, do none of their work. A task you give by: sub-agent is held the same way. Only the card is their yes: \"go ahead\" or an approved plan is a yes to the work, not to who does it. On One at a time the work is yours for this turn: launch no builder for it again, one by one either, and start no other agent on it through a shell command. A reviewer only reads and is never held.",
    );
    const base = { root: "R", delegateRead: false };
    for (const graph of [true, false]) assert.ok(systemPromptFor({ ...base, graph }).includes(`${PROMPT.agentRecipes}\n${PROMPT.parallelOff}\n`), `graph: ${graph}`);
    assert.equal(systemPromptFor({ ...base, graph: true, parallel: true }).includes(PROMPT.parallelOff), false, "on: the consent line in its place");
    const lead = { name: "Architect", persona: "" };
    for (const [why, o] of /** @type {[string, any][]} */ ([["a lead", { lead }], ["a sub-agent", { subagent: true }], ["a worker", { subagent: true, worker: { team: "T" } }], ["no agent tool", { toolsOff: ["agent"] }], ["no tools", { noTools: true }]]))
      assert.equal(systemPromptFor({ ...base, graph: true, ...o }).includes(PROMPT.parallelOff), false, why);
    const lone = "A lone piece you would only wait on, do yourself.";
    for (const [name, words] of /** @type {[string, string][]} */ ([["agent", PROMPT.agent], ["coderAgentModel", PROMPT.coderAgentModel], ["coderAgentModelHeld", PROMPT.coderAgentModelHeld]])) assert.ok(words.endsWith(` ${lone}`), name);
    assert.ok(systemPromptFor({ ...base, graph: true, parallel: true }).includes(`would need this whole conversation to do it. ${lone}`), "on too");
    assert.match(PROMPT.agentRecipes, /launch three builders in one reply, [^.]*; each works in its own copy of the project, and while Parallelize tasks is off they are held on the person's card\./);
  });

  // (fails before: yes — k2: Settings › Experimental's switch reached no prompt)
  test("loopSystem reads the switch from the config — the main agent's, never a sub-agent's or a lead's", () => {
    const cfg = (/** @type {boolean} */ on) => ({ agentLoop: {}, experimental: { parallelizeTasks: on } });
    const of = (/** @type {any} */ o) => loopSystem({ doc: null, root: "R", graph: true, ...o }).prompt;
    assert.ok(of({ cfg: cfg(true) }).includes(tg.PARALLEL_CONSENT));
    assert.equal(of({ cfg: cfg(true) }).includes(PROMPT.parallelOff), false, "on: no hold line");
    assert.equal(of({ cfg: cfg(false) }), of({ cfg: { agentLoop: {} } }), "off, or never set: the same bytes");
    assert.ok(of({ cfg: cfg(false) }).includes(PROMPT.parallelOff), "off: the hold line");
    assert.equal(of({ cfg: cfg(true), host: { readOnly: false, team: null, task: null } }).includes(tg.PARALLEL_CONSENT), false, "a sub-agent");
    assert.equal(of({ cfg: cfg(false), host: { readOnly: false, team: null, task: null } }).includes(PROMPT.parallelOff), false, "a sub-agent, off");
    assert.equal(of({ cfg: cfg(true), lead: { name: "Architect", persona: "" } }).includes(tg.PARALLEL_CONSENT), false, "a lead");
    assert.equal(of({ cfg: cfg(false), lead: { name: "Architect", persona: "" } }).includes(PROMPT.parallelOff), false, "a lead, off");
  });

  // (fails before: yes — a coding agent's context said nothing of the switch)
  test("a coding agent: a standing block beside the graph's while on — Filament's agent tool with task —, its off words in its place when it goes off", () => {
    const body = () => ({ messages: [{ role: "user", content: "hi" }] });
    const launch = { asks: [] };
    const on = agentContext({ format: "anthropic", body: body(), graph: true, launch, parallel: true });
    const block = on.standing.find((b) => b.id === PARALLEL_BLOCK);
    assert.ok(block, JSON.stringify(on.standing.map((b) => b.id)));
    assert.equal(block.text, `<filament-context kind="parallel">\n${CODER_PARALLEL_TEXT}\n</filament-context>`);
    assert.equal(block.tool, GRAPH_TOOL, "it stands where the session has the task graph");
    assert.deepEqual(on.standing.map((b) => b.id).slice(-3), [GRAPH_TOOL, PARALLEL_BLOCK, LAUNCH_BLOCK], "beside the graph's");
    // (fails before: yes — the owner's of 11-09, D5: a coding agent whose chat's sub-agents work in its folder was told
    // they work each in its own worktree; one fixed sentence says both, as the loop's line does)
    assert.match(CODER_PARALLEL_TEXT, /^Parallelize tasks is on: the person turned it on, and that is their consent\. When tasks of your graph can run at once — truly independent: none needs another's work — start them on sub-agents yourself, now, without asking: Filament's agent tool, one call each, on your own model — name it in model, and the task in task\. Each works in its own worktree, so they may share a file — unless the chat's sub-agents work in its folder: then tasks that share a file stay in order\. Tasks that need each other stay in order\.$/);
    // On with no graph, no agent tool, or a team's lead: none.
    for (const o of [{ parallel: true, graph: false, launch }, { parallel: true, graph: true, launch: null }, { parallel: true, graph: true, launch: null, lead: true }, { parallel: false, graph: true, launch: null }, { parallel: false, graph: true, launch, lead: true }])
      assert.equal(agentContext({ format: "anthropic", body: body(), ...o }).standing.some((b) => b.id === PARALLEL_BLOCK), false, JSON.stringify(o));
    // (fails before: yes — the owner's of 11-14: off, a coding agent's context said nothing of the person's card)
    // Turned off mid-session: the next prompt says the block again whole, in its off words.
    const state = contextState();
    openedWith(state, on.standing);
    const off = agentContext({ format: "anthropic", body: body(), graph: true, launch, parallel: false });
    const update = contextUpdate(state, off.standing);
    assert.deepEqual([update?.added, update?.removed], [[PARALLEL_BLOCK], []]);
    assert.ok(update?.text.includes(`<filament-context kind="parallel">\n${CODER_PARALLEL_OFF_TEXT}\n</filament-context>`), update?.text);
    // Its graph gone while on: the consent goes, in its own words.
    const graphless = contextUpdate(state, agentContext({ format: "anthropic", body: body(), graph: false, launch, parallel: true }).standing);
    assert.ok(graphless?.removed.includes(PARALLEL_BLOCK) && graphless.text.includes("Parallelize tasks' consent is gone from this session: start no sub-agent on your graph's tasks unasked."), graphless?.text);
  });

  test("a coding agent: off, a standing block wherever the session has Filament's agent tool, graph or none — the hold on the person's card —, its own gone words when the tool goes", () => {
    const body = () => ({ messages: [{ role: "user", content: "hi" }] });
    const launch = { asks: [] };
    assert.equal(
      CODER_PARALLEL_OFF_TEXT,
      "Parallelize tasks is off: the person has not agreed to sub-agents that change files working beside you. What you can do yourself, do yourself, one piece after another. A builder pays only where two or more independent pieces run at once while you do another or check their work. When that pays, launch them in one reply: Filament holds each and asks the person on a card, which starts them on their Accept, or by itself after 60 seconds, and tells you which. Until then, do none of their work. A launch that names a task of your graph is held the same way. Only the card is their yes: \"go ahead\" or an approved plan is a yes to the work, not to who does it. On One at a time the work is yours for this turn: launch no builder for it again, one by one either, and start no other agent on it through a shell command or your client's own tools. A reviewer only reads and is never held.",
    );
    for (const graph of [true, false]) {
      const off = agentContext({ format: "anthropic", body: body(), graph, launch });
      const block = off.standing.find((b) => b.id === PARALLEL_BLOCK);
      assert.ok(block, `graph: ${graph}: ${JSON.stringify(off.standing.map((b) => b.id))}`);
      assert.equal(block.text, `<filament-context kind="parallel">\n${CODER_PARALLEL_OFF_TEXT}\n</filament-context>`);
      assert.equal(block.tool, LAUNCH_TOOL, "it stands where the session has Filament's agent tool");
      assert.deepEqual(off.standing.map((b) => b.id).slice(-2), [PARALLEL_BLOCK, LAUNCH_BLOCK], "ahead of the agent tool's words");
      assert.deepEqual(agentContext({ format: "anthropic", body: body(), graph, launch, parallel: false }).standing, off.standing, "off said outright: the same");
    }
    // Turned on mid-session: the next prompt says the consent whole in its place.
    const state = contextState();
    openedWith(state, agentContext({ format: "anthropic", body: body(), graph: true, launch }).standing);
    const on = contextUpdate(state, agentContext({ format: "anthropic", body: body(), graph: true, launch, parallel: true }).standing);
    assert.deepEqual([on?.added, on?.removed], [[PARALLEL_BLOCK], []]);
    assert.ok(on?.text.includes(CODER_PARALLEL_TEXT), on?.text);
    // The agent tool gone: the hold goes with it, in its own words.
    const toolless = contextUpdate(state, agentContext({ format: "anthropic", body: body(), graph: true, launch: null }).standing);
    assert.ok(toolless?.removed.includes(PARALLEL_BLOCK) && toolless.text.includes("Filament no longer holds sub-agents that change files on a card in this session."), toolless?.text);
  });
});

/**
 * A runner over one session's graph, the switch as `on` says — none given where `given` is false —, and the launches it made.
 * @param {{ on: boolean }} s @param {{ given?: boolean }} [o]
 */
function rig(s, { given = true } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: { graph: ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT })).graph } }]]);
  const registry = {
    launch: () => ({ ok: true, id: "sa_1", done: new Promise(() => {}), tree: Promise.resolve(true) }),
    room: () => ({ max: 4, running: 0, cwd: "/p", worktree: true }),
    turnOpen: () => false,
    /** @param {string} _c @param {() => void} go */
    afterTurn: (_c, go) => go(),
    notice: () => {},
    tell: () => {},
    slots: () => 4,
    stop: () => ({ ok: true }),
    guard: () => {},
    resumable: () => null,
    forkPays: () => false,
  };
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {any} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
    newestTurnN: () => 2,
  };
  let t = T0;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => AGENT, log: () => {}, now: () => t++, ...(given ? { parallel: () => s.on } : {}) });
  return { runner, g: () => chains.get("c1").meta.graph };
}

describe("the runner", () => {
  // (fails before: yes — the owner's of 11-09: on, a turn's end still drew the card asking the person; the owner's of
  // 11-10: the card is the agent's suggestion, refused while the switch is on)
  test("on, the agent's suggestion is refused and no card is drawn; a card suggested before the switch went on stands, and its Accept still starts them", () => {
    const s = { on: true };
    const r = rig(s);
    const refused = r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT });
    assert.equal(refused.ok, false);
    assert.match(/** @type {any} */ (refused).error, /^Parallelize tasks is on — the person's consent: no card asks them/);
    assert.deepEqual([r.runner.offered("c1"), "offer" in r.g()], [null, false], "no card");
    s.on = false;
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    assert.deepEqual(card?.ids, ["api", "ui"], "off: the agent's card");
    s.on = true;
    assert.deepEqual(r.runner.offered("c1")?.ids, ["api", "ui"], "suggested before: it stands");
    ok(r.runner.sideRun("c1", [{ id: "api", model: "m", folder: "copy" }, { id: "ui", model: "m", folder: "copy" }], { starts: "now", card: card.at }));
    assert.equal(r.runner.offered("c1"), null);
  });

  test("on, its tasks calls say to run them at once now; off, to suggest them", () => {
    const s = { on: true };
    const r = rig(s);
    const said = ok(r.runner.apply("c1", { action: "add", tasks: [{ id: "more", name: "More", writes: ["src/more.js"], steps: ["Write it"] }] }, { crew: AGENT }));
    assert.match(said.text, /\nThe graph lets api, ui and more run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on, so run them at once now/);
    s.on = false;
    const off = ok(r.runner.apply("c1", { action: "add", tasks: [{ id: "last", name: "Last", writes: ["src/last.js"], steps: ["Write it"] }] }, { crew: AGENT }));
    assert.match(off.text, /\nThe graph lets api, ui, more and last run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, suggest them to the person/);
  });

  test("with no switch given, it is off: the agent's suggestion puts the card", () => {
    const r = rig({ on: false }, { given: false });
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    assert.deepEqual(r.runner.offered("c1")?.ids, ["api", "ui"]);
  });
});

describe("the switch's words and the page", () => {
  // (fails before: yes — Settings said the agent plans in parallel; nothing said it starts them itself, nor the prompt)
  // (fails before: yes — the review of 11-09: Settings, the schema and the parameters' page still kept tasks that write
  // one file apart, against the prompt's consent line)
  // (fails before: yes — the owner's of 11-14: off, Settings said nothing starts until Accept, nothing of the 60 seconds
  // nor of One at a time)
  test("Settings says turning it on is consent, independent is needing none of another's work, they may share a file, no card asks, off a card that answers itself in 60 seconds, and each chat's prompt is written anew once", () => {
    assert.equal(PARALLEL_DESC, "Turning this on is your consent: in every chat, where tasks of your agent's plan can run at once — truly independent, none needing another's work — your agent starts them on sub-agents itself, with no card asking you first. Off, it asks you on a card first: they start on your Accept, or after 60 seconds if you say nothing; One at a time keeps the work with your agent. Each works in its own worktree, so they may share a file — unless sub-agents work in the chat's folder (Session folder): then tasks that share a file run one after another. Switching it writes each chat's prompt anew once, at its next message.");
    const leaf = /** @type {any} */ (CONFIG_SCHEMA).experimental.parallelizeTasks;
    const words = String(leaf.effect);
    assert.match(words, /^On, in every chat, it is your consent: /);
    for (const said of ["truly independent: none needs another's work", "Each works in its own worktree, so they may share a file, the second to land merging at its apply — unless sub-agents work in the chat's folder (Agent loop › Where they edit: Session folder), where tasks that share a file run one after another; tasks that need each other stay in order.", "no card asks you first", "each chat's prompt is written anew once, at its next message", "Off, it asks you on a card first: where tasks can run at once your agent suggests them on one, and a sub-agent that changes files it launches is held on one; they start on your Accept, or after 60 seconds if you say nothing; Ignore, or One at a time, keeps the work with your agent. A reviewer, which only reads, is never held."]) assert.ok(words.includes(said), `${said} in ${words}`);
    assert.doesNotMatch(words, /writes a file another writes|share a file, stay in order/);
    const doc = readFileSync(new URL("../docs/PARAMETERS.md", import.meta.url), "utf8");
    assert.ok(doc.includes(`| \`experimental.parallelizeTasks\` | boolean | \`false\` | Parallelize tasks. | ${words} |`), "the parameters' page says it the same");
  });

  // (fails before: yes — the page sent `side` with every message, so each carried a line the prompt now says once)
  // (fails before: yes — the review of 11-09: the page sent it with a /plan, the session's only word of it there)
  test("the page sends no word of it, a /plan's neither: the session reads the switch, and the prompt says the rest", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.doesNotMatch(app, /\n {6}side: /);
    assert.doesNotMatch(readFileSync(new URL("../src/ui/harness/lib/api.js", import.meta.url), "utf8"), /\{ side: true \}/);
  });
});
