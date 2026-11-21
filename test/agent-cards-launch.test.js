// @ts-check
// HarnessV4_Tasks E15 step 2, "as whom": a launch that names a saved agent by its tag runs as that card. The registry
// reads the card — what it sees, its model, its level, that a developer's answer stays with them — each field the
// launch names itself winning; the card's name and paragraph enter the sub-agent's instructions for both engines,
// inside the frame of an agent asked by its name; its marks carry the question and, at its end, the answer whole with
// its figures; and `/subagent as=<tag>` is the same door for any client. Since step 4 every launch runs as a card; since
// OA1 there is one kind of agent: these are the agents asked by their tag, the ones in a place are
// test/agent-workers.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { PROMPT, PROMPT_VERSION, systemPromptFor } from "../src/app/agent/prompt.js";
import { SUBAGENT_OFF } from "../src/app/agent/tools.js";
import { loopSystem } from "../src/app/agent/system.js";
import { workerWords } from "../src/app/agent-worker.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";
import { createAgentCardStore, SHIPPED_CARDS } from "../src/services/agent-cards.js";

const root = tmpdir();

/**
 * A registry whose front door is a scripted host, over the real card store: each launch is served the way a turn serves
 * one — attach, finish before the reply. Marks recorded between turns land in `marks`.
 * What a done exchange hands memory's learner lands in `learned`.
 * @param {{ cards?: ReturnType<typeof createAgentCardStore>, agentOf?: (model: string) => string | null, max?: number }} [o]
 */
function scripted({ cards = createAgentCardStore({ dataDir: null }), agentOf = () => null, max = 4 } = {}) {
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const marks = [];
  /** @type {any[]} */
  const views = [];
  /** @type {any[]} */
  const learned = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    // (the owner's word of 11-05: a model's limit, on its row, is the only one)
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m-sub", n: max }] } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "m-sub" }], view: "none" }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async (_chain, strategy, o) => {
        views.push({ strategy, ...o });
        return { text: "User: fix the parser\nAssistant: Fixed it.", turns: 1 };
      },
      brief: async () => null,
      modelProblem: (name) => (name === "bad" ? "no route matches it" : null),
      modelFacts: (name) => (name === "bad" ? { problem: "no route matches it", limit: null } : { problem: null, limit: null, at: { upstream: "u", model: name } }),
      agentOf,
      reported: (o) => learned.push(o),
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
      const report = `Fail, and name the limit. (${n})`;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 1200, tokensOut: 40, spentUsd: 0.0123456789, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, cards, posts, marks, views, learned };
}
/** @param {any} r @returns {string} */
const refusal = (r) => String(r.error || "");
const ASK = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: "should a fifth launch queue or fail?" };

// (fails before: yes — a launch had no `as`: it ran as a plain sub-agent, with no card's words)
describe("a launch as a saved agent", () => {
  test("the card says what it sees, its level, and that the developer's answer stays with them; the row and the host name it", async () => {
    const { registry, marks, views } = scripted();
    const r = registry.launch({ ...ASK, as: "@Product" });
    assert.equal(r.ok, true, refusal(r));
    const id = /** @type {any} */ (r).id;
    const host = registry.hostOf(id);
    // (fails before: yes — OA1 case 1: Product, asked, read only whatever its card said)
    assert.deepEqual([host?.card, host?.readOnly, host?.may], [{ tag: "product", name: "Product", thinks: SHIPPED_CARDS.product.thinks, asked: true }, false, "edit"], "the host reads who it answers as, the card's paragraph, and its level: it edits");
    await /** @type {any} */ (r).done;
    const sa = registry.get(id);
    // (fails before: yes — the owner's words of 10-19: Product saw the session folded and the running turn, and gave the main agent's view back)
    assert.deepEqual([sa?.card, sa?.asked, sa?.may, sa?.view, sa?.running, sa?.model, sa?.aside], [{ tag: "product", name: "Product" }, true, "edit", "none", false, "m-sub", true]);
    assert.deepEqual(views.map((v) => v.strategy), [], "it is shown nothing of the session: it starts apart");
    assert.equal(sa?.exchanges.at(-1)?.delivery, "held", "its answer waits with the developer");
    // Its marks carry what the chat's card shows once the registry forgot it (AG-19).
    assert.deepEqual(marks.map((m) => [m.event, m.card, m.asked, m.question]), [
      ["dispatch", { tag: "product", name: "Product" }, true, ASK.prompt],
      ["arrival", { tag: "product", name: "Product" }, true, ASK.prompt],
    ]);
    const arrival = marks[1];
    assert.deepEqual([arrival.answer, arrival.model, arrival.tokensIn, arrival.tokensOut, arrival.spentUsd, arrival.delivery], ["Fail, and name the limit. (1)", "m-sub", 1200, 40, 0.012346, "held"]);
  });

  test("what the launch names itself wins over the card: another view, no running turn, a model, the answer sent on", async () => {
    const { registry, views } = scripted();
    const r = registry.launch({ ...ASK, as: "reviewer", view: "folded", running: false, model: "m-other", deliver: true });
    assert.equal(r.ok, true, refusal(r));
    await /** @type {any} */ (r).done;
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([sa?.card?.tag, sa?.view, sa?.running, sa?.model, sa?.aside, sa?.may], ["reviewer", "folded", false, "m-other", false, "read"]);
    assert.deepEqual(views.map((v) => v.strategy), ["fold"]);
  });

  test("a card of yours with a model and a view of its own: the launch runs on them; a coding agent's model makes it that agent's turn", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You think as an attacker.", model: "claude/haiku", sees: { view: "none", changes: "turn" } });
    const { registry } = scripted({ cards, agentOf: (m) => (m.startsWith("claude/") ? "claude" : null) });
    const r = registry.launch({ ...ASK, as: "security" });
    assert.equal(r.ok, true, refusal(r));
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([sa?.model, sa?.engine, sa?.view, sa?.running, sa?.changes, sa?.card], ["claude/haiku", "acp", "none", false, "turn", { tag: "security", name: "Security" }]);
    await /** @type {any} */ (r).done;
  });

  test("a card changed or deleted while its launch runs: the running one keeps the name and the words it started with", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You think as an attacker." });
    const { registry } = scripted({ cards });
    const r = registry.launch({ ...ASK, as: "security" });
    const id = /** @type {any} */ (r).id;
    cards.update("security", { name: "Sec", thinks: "Changed." });
    assert.deepEqual(registry.hostOf(id)?.card, { tag: "security", name: "Security", thinks: "You think as an attacker.", asked: true });
    cards.remove("security");
    await /** @type {any} */ (r).done;
    assert.equal(registry.get(id)?.card?.name, "Security", "its row keeps the name it ran under");
    assert.match(refusal(registry.launch({ ...ASK, as: "security" })), /^there is no agent `@security` — Library › Agents lists them$/);
  });

  test("refused in words: a tag nobody has, a start beside it, a level above its card's, a team's own Lead, a live copy with nothing to copy, and the session's limit", async () => {
    const { registry } = scripted({ max: 1 });
    assert.match(refusal(registry.launch({ ...ASK, as: "pn" })), /^there is no agent `@pn` — Library › Agents lists them$/);
    assert.match(refusal(registry.launch({ ...ASK, as: "product", start: "job" })), /^a launch names a start or an agent, not both: Product's card says what it sees and may do$/);
    assert.equal(refusal(registry.launch({ ...ASK, as: "reviewer", may: "edit" })), "Reviewer only reads, as its card says");
    assert.equal(refusal(registry.launch({ ...ASK, as: "product", may: "all" })), "may must be one of read, copy, edit");
    // (fails before: yes — OA-D4: a team's head was asked by its tag, alone)
    assert.equal(refusal(registry.launch({ ...ASK, as: "buildlead" })), "Builders is part of the `builders` team, as its Lead: it runs only when that team does — start the team, or ask another agent");
    assert.equal(refusal(registry.launch({ ...ASK, as: "huntlead" })), "BugHunters is part of the `bughunters` team, as its Lead: it runs only when that team does — start the team, or ask another agent");
    // (the plan's p6: the Verifier's Lead is gone with its team, into BugHunters)
    assert.equal(refusal(registry.launch({ ...ASK, as: "verifylead" })), "there is no agent `@verifylead` — Library › Agents lists them");
    // (fails before: yes — the Verifier's finding of 10-22: the API launched a team's own Lead in a worker's place)
    assert.equal(refusal(registry.launch({ ...ASK, worker: "buildlead" })), "Builders is part of the `builders` team, as its Lead: it runs only when that team does — start the team, or ask another agent");
    // (fails before: yes — an agent asked for its view could never be a live copy: one kind of agent, OA1, may)
    assert.match(refusal(registry.launch({ ...ASK, as: "product", view: "fork" })), /^the main agent's turn has sent no request yet, so there is nothing to fork|^a fork copies the main agent's newest request/);
    assert.match(refusal(registry.launch({ ...ASK, as: "product", model: "bad" })), /cannot run on "bad": no route/);
    const one = registry.launch({ ...ASK, as: "product" });
    assert.equal(one.ok, true);
    assert.equal(refusal(registry.launch({ ...ASK, as: "enduser" })), "The limit is 1 at once, and 1 is running. Wait for one to finish.", "a second past the limit of one is refused, naming the count");
    await /** @type {any} */ (one).done;
  });

  // (fails before: yes — a launch that named no agent had no card: its row, its host and its marks named none)
  test("a launch that asks nobody runs as a worker's card: its row, its host and its marks name it, none is asked, and its report goes to the main agent", async () => {
    const { registry, marks } = scripted();
    const r = registry.launch({ ...ASK, worker: "reviewer" });
    assert.deepEqual(registry.hostOf(/** @type {any} */ (r).id)?.card, { tag: "reviewer", name: "Reviewer", thinks: SHIPPED_CARDS.reviewer.thinks, asked: false });
    await /** @type {any} */ (r).done;
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([sa?.card, sa?.asked, sa?.may, sa?.aside, sa?.view, sa?.running], [{ tag: "reviewer", name: "Reviewer" }, false, "read", false, "none", false]);
    assert.deepEqual(marks.map((m) => [m.event, m.card, "asked" in m, "question" in m, "answer" in m]), [["dispatch", { tag: "reviewer", name: "Reviewer" }, false, false, false], ["arrival", { tag: "reviewer", name: "Reviewer" }, false, false, false]]);
  });

  // (fails before: yes — found by E15 step 2's live drive: a lead's kept answer was learned as the project's facts,
  // its guesses among them, and the main agent and later leads read them though nobody had sent them: V4-D296)
  test("an agent asked by its tag: its answer never goes to memory's learner — kept, asked again or sent on; a plain sub-agent's report does", async () => {
    const { registry, learned } = scripted();
    const kept = registry.launch({ ...ASK, as: "product" });
    await /** @type {any} */ (kept).done;
    const again = registry.followUp(/** @type {any} */ (kept).id, { chainId: "c1", prompt: "and a sixth?" });
    assert.equal(again.ok, true, refusal(again));
    await /** @type {any} */ (again).done;
    const sent = registry.launch({ ...ASK, as: "reviewer", deliver: true });
    await /** @type {any} */ (sent).done;
    assert.deepEqual(registry.list("c1").map((sa) => [sa.card?.tag, sa.status, sa.exchanges.length]), [["reviewer", "done", 1], ["product", "done", 2]], "three answers ended done");
    assert.equal(learned.length, 0, "none of them reached memory");
    const plain = registry.launch({ ...ASK, worker: "reviewer" });
    await /** @type {any} */ (plain).done;
    assert.deepEqual(learned.map((o) => [o.agentId, o.task, o.report]), [[/** @type {any} */ (plain).id, ASK.prompt, "Fail, and name the limit. (4)"]], "a sub-agent's report is what it found: memory reads it");
  });
});

// (fails before: yes — HarnessV4_OneAgent_Plan OA1: an advisor asked by its tag read only whatever its card said, a
// launch named "ask" or "job", and a doer asked for its view read only too)
describe("one kind of agent (OA1)", () => {
  test("Product asked by its tag works at its card's level: it may edit in its own copy, answers as itself, is told nothing of reading only, and memory learns nothing of it", async () => {
    const { registry, learned } = scripted();
    const r = registry.launch({ ...ASK, as: "product" });
    assert.equal(r.ok, true, refusal(r));
    const id = /** @type {any} */ (r).id;
    const host = registry.hostOf(id);
    assert.deepEqual([host?.card?.asked, host?.readOnly, host?.may], [true, false, "edit"]);
    const system = loopSystem({ cfg: { agentLoop: {} }, doc: null, root: "R", off: SUBAGENT_OFF, host }).prompt;
    assert.ok(system.includes(`You answer as Product. ${PROMPT.cardAsked}`) && !system.includes(PROMPT.subagentReadOnly) && system.includes(PROMPT.cardAnswer), "the frame of an agent asked by its name, and no word of reading only");
    for (const part of [/where you are asked a question, answer it/, /where you are given work, do it, within what you may do/]) assert.match(PROMPT.cardAsked, part);
    assert.match(PROMPT.cardAnswer, /where you changed files, which ones, with their paths/);
    await /** @type {any} */ (r).done;
    assert.deepEqual([registry.get(id)?.asked, registry.get(id)?.may], [true, "edit"]);
    assert.equal(learned.length, 0, "an agent asked by its tag is not learned from");
  });

  test("a launch may lower an agent's level for one run, never raise it: Builder asked to read only is told so; the Reviewer reads only by its card, whose own words say so", async () => {
    const { registry } = scripted();
    const r = registry.launch({ ...ASK, as: "builder", may: "read" });
    assert.equal(r.ok, true, refusal(r));
    const host = registry.hostOf(/** @type {any} */ (r).id);
    assert.deepEqual([host?.may, host?.readOnly], ["read", true]);
    const system = loopSystem({ cfg: { agentLoop: {} }, doc: null, root: "R", off: SUBAGENT_OFF, host }).prompt;
    assert.ok(system.includes(`You answer as Builder. ${PROMPT.cardAsked}`) && system.includes(PROMPT.subagentReadOnly), "lowered, it is told it reads only");
    await /** @type {any} */ (r).done;
    assert.equal(refusal(registry.launch({ ...ASK, as: "reviewer", may: "edit" })), "Reviewer only reads, as its card says");
    const reviewer = registry.launch({ ...ASK, as: "reviewer" });
    assert.deepEqual([registry.hostOf(/** @type {any} */ (reviewer).id)?.may, registry.hostOf(/** @type {any} */ (reviewer).id)?.readOnly], ["read", false], "its own words say it changes nothing: the line is not said twice");
    await /** @type {any} */ (reviewer).done;
  });
});

// (fails before: yes — the prompt had no card: a saved agent would have read a plain sub-agent's instructions)
describe("a saved agent's instructions", () => {
  const card = { tag: "product", name: "Product", thinks: SHIPPED_CARDS.product.thinks, asked: true };
  const reviewer = { tag: "reviewer", name: "Reviewer", thinks: SHIPPED_CARDS.reviewer.thinks, asked: false };
  const base = { root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, readOnly: true };

  test("Filament's loop: who it answers as, the frame of an agent asked by its name, the card's paragraph, and the answer line in place of the report line", () => {
    assert.equal(PROMPT_VERSION, 129);
    const s = systemPromptFor({ ...base, card });
    const head = s.split("\n\n")[0].split("\n");
    assert.deepEqual(head, [PROMPT.subagentRole, PROMPT.subagentReadOnly, `You answer as Product. ${PROMPT.cardAsked}`, SHIPPED_CARDS.product.thinks, "Working folder: R"]);
    assert.ok(s.includes(PROMPT.cardAnswer) && !s.includes(PROMPT.subagentReport), "it ends with an answer, not a report");
    for (const part of [/verdict or your result in one line/, /Point at your evidence/, /Where you see a reason to disagree/, /within what you may do/]) assert.match(PROMPT.cardAsked, part);
    assert.doesNotMatch(PROMPT.cardAsked, /change nothing/, "no rule has an agent asked by its name only read (OA1)");
  });

  test("without a card the sub-agent's prompt is version 18's, byte for byte", () => {
    const plain = systemPromptFor(base);
    assert.equal(plain, systemPromptFor({ ...base, card: null }));
    assert.ok(!plain.includes("You answer as") && !plain.includes(PROMPT.cardAsked) && !plain.includes(PROMPT.cardAnswer));
    assert.equal(plain.split("\n\n")[0], [PROMPT.subagentRole, PROMPT.subagentReadOnly, "Working folder: R"].join("\n"));
    assert.ok(plain.includes(PROMPT.subagentReport));
  });

  test("the loop's system prompt takes the card from the host", () => {
    const withCard = loopSystem({ cfg: { agentLoop: {} }, doc: null, root: "R", off: SUBAGENT_OFF, host: { readOnly: true, team: null, task: null, card } });
    assert.ok(withCard.prompt.includes(`You answer as Product. ${PROMPT.cardAsked}\n${SHIPPED_CARDS.product.thinks}`));
    const without = loopSystem({ cfg: { agentLoop: {} }, doc: null, root: "R", off: SUBAGENT_OFF, host: { readOnly: false, team: null, task: null, card: reviewer } });
    assert.ok(!without.prompt.includes("You answer as"));
  });

  test("a coding agent's: the same words in Filament's instructions for its session, and its answer line", () => {
    const w = workerWords({ id: "sa_1", readOnly: true, asks: false, team: null, task: null, card });
    const lines = w.split("\n");
    assert.deepEqual(lines.slice(1, 6), ["These are Filament's instructions for this session, not background.", PROMPT.subagentRole, PROMPT.subagentReadOnly, `You answer as Product. ${PROMPT.cardAsked}`, SHIPPED_CARDS.product.thinks]);
    assert.ok(w.includes(PROMPT.cardAnswer) && !w.includes(PROMPT.subagentReport));
    const plain = workerWords({ id: "sa_1", readOnly: false, asks: false, team: null, task: null, card: reviewer });
    assert.ok(!plain.includes("You answer as") && plain.includes(PROMPT.subagentReport), "a worker's are a sub-agent's: it reports");
    assert.deepEqual(plain.split("\n").slice(2, 4), [PROMPT.subagentRole, SHIPPED_CARDS.reviewer.thinks], "after its role, its card's own words");
  });
});

// (fails before: yes — `as=` was no option: it was read as the task's first word)
describe("/subagent as=<tag>", () => {
  test("is read as an option before the task, beside the others", () => {
    const c = /** @type {any} */ (parseSubagentCommand("/subagent as=product model=m-x should a fifth launch queue or fail?"));
    assert.deepEqual([c.action, c.as, c.model, c.prompt], ["launch", "product", "m-x", "should a fifth launch queue or fail?"]);
    const plain = /** @type {any} */ (parseSubagentCommand("/subagent as soon as the tests pass, tell me"));
    assert.deepEqual([plain.action, plain.as, plain.prompt], ["launch", null, "as soon as the tests pass, tell me"], "a bare word is the task's");
  });
});
