// @ts-check
// HarnessV4_Tasks E15 step 4, workers in the list: everything launched runs as a card. Two workers ship beside the
// leads — Builder and Reviewer ("Teams, improved and kept" of 11-03) — each with what it may do: read only, run in its
// own copy with nothing kept, or edit. A card is asked by its tag (it answers whoever asked) or launched as a worker (it
// reports as a sub-agent does); a call may lower what its card may do, never raise it; and a copy of Builder or Reviewer
// a session names takes that card's place for the session's agent (AG-79, AG-80). The level in the middle runs in a git
// worktree that goes with its report, and refuses where no copy can be made (AG-85).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry, SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { createTeamTools } from "../src/app/agent/team-tools.js";
import { TOOL_TEXT } from "../src/app/agent/prompt.js";
import { AGENT_TOOL, agentToolFor, coderAgentToolFor, launchKinds, teamAgentToolFor, workerFor } from "../src/app/agent/tools.js";
import * as agentCards from "../src/services/agent-cards.js";
import { CARD_MAY, OWN_WORKERS, SHIPPED_CARDS, askablesOf, createAgentCardStore, mayLower } from "../src/services/agent-cards.js";
import { TASK_REF_PREFIX } from "../src/adapters/git/worktree.js";
import { disposeBackgroundShells, peekShellExits, runningShellsOf, startCommandShell, tellShellExits } from "../src/adapters/tools/hands.js";
import { copyState } from "./helpers/copies.js";

const root = tmpdir();
/** @type {string[]} */
const made = [];
after(async () => {
  await disposeBackgroundShells();
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {any} r @returns {string} */
const refusal = (r) => String(r.error || "");
/** A store with three cards of the developer's: a copy of Reviewer on a model of its own, a worker that edits, and one that runs in a copy. */
const stocked = () => {
  const cards = createAgentCardStore({ dataDir: null });
  cards.create({ from: "reviewer", tag: "reviewer-fast", name: "Reviewer, fast", model: "m-fast" });
  cards.create({ tag: "translator", name: "Translator", goodFor: "Puts strings into German", thinks: "You translate, and keep every placeholder.", may: "edit" });
  cards.create({ tag: "runner", name: "Runner", goodFor: "Runs a flaky test many times", may: "copy" });
  return cards;
};

// ---------------------------------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the list held leads only: a helper, an explorer and a team's four roles were words in code)
describe("the workers that ship, and the cards a developer makes", () => {
  // (fails before: yes — OA1: a card had a kind, lead or worker, and a lead's level was no field: it read)
  test("every agent that ships has its level, and no kind; Builder and Reviewer each have words of their own", () => {
    assert.equal("CARD_KINDS" in agentCards, false, "one kind of agent");
    assert.deepEqual([...CARD_MAY], ["read", "copy", "edit"], "least first");
    assert.deepEqual([...OWN_WORKERS], ["builder", "reviewer"], "the two the session's agent always has");
    /** @type {[string, any][]} */
    const shipped = Object.entries(SHIPPED_CARDS);
    for (const [tag, c] of shipped) assert.ok(!("kind" in c), tag);
    assert.deepEqual([SHIPPED_CARDS.builder.thinks !== "", SHIPPED_CARDS.reviewer.thinks !== ""], [true, true]);
    const cards = createAgentCardStore({ dataDir: null });
    for (const c of cards.list()) assert.ok(CARD_MAY.includes(c.may), c.tag);
    assert.deepEqual(cards.list().filter((c) => c.may === "edit").map((c) => c.tag), ["product", "builder"]);
    assert.deepEqual(cards.list().filter((c) => c.sees.view !== "none").map((c) => [c.tag, c.sees.view]), [], "a shipped agent sees its task alone unless its launch hands it more");
  });

  // (fails before: yes — the owner's word of 10-31: helpers handed the conversation took on the main agent's view; the
  // tool offered five cuts of it and said nothing of why a launch should leave it out)
  test("the launch tool offers nothing, folded, the context window and a live copy, and says why nothing is the default", () => {
    const context = /** @type {any} */ (AGENT_TOOL.input_schema.properties).context;
    assert.deepEqual(context.enum, ["none", "folded", "window", "fork"]);
    assert.match(context.description, /Left out: none — the task alone, the default and almost always right: a sub-agent handed your conversation takes on your view of it, while one handed only its task answers apart from you/);
  });

  test("a call may run a card at its own level or a lower one", () => {
    const table = CARD_MAY.map((card) => CARD_MAY.map((call) => mayLower(card, call)));
    assert.deepEqual(table, [[true, false, false], [true, true, false], [true, true, true]]);
    assert.equal(mayLower("edit", "all"), false, "a word that is no level");
  });

  test("an agent of yours may have no words and any level (U13-D1); a copy remembers what it was copied from", () => {
    const cards = stocked();
    const runner = cards.find("runner");
    // A new agent sees nothing of the session unless its card says so, whatever its level (the owner's words of 10-19; OA1).
    assert.deepEqual([runner?.may, runner?.thinks, runner?.sees.view, runner?.from ?? null], ["copy", "", "none", null]);
    const fast = cards.find("reviewer-fast");
    assert.deepEqual([fast?.may, fast?.thinks, fast?.model, fast?.from], ["read", SHIPPED_CARDS.reviewer.thinks, "m-fast", "reviewer"]);
    assert.equal(cards.create({ tag: "judge", name: "Judge", goodFor: "x" }).thinks, "", "an agent with no words of its own");
    assert.equal(cards.create({ tag: "judge2", name: "Judge", goodFor: "x", thinks: "You judge.", may: "edit" }).may, "edit");
    assert.throws(() => cards.create({ tag: "odd", name: "Odd", goodFor: "x", may: "all" }), /may must be one of read, copy, edit/);
    assert.throws(() => cards.update("translator", { may: "read", mayRun: ["npm test"] }), /only reads, so it runs no commands of its own/, "an edit is checked as a whole card");
  });
});

// ---------------------------------------------------------------------------------------------------
// Who the session's agent launches
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the agent's tool had two fixed kinds; a session could name leads to ask, and no worker; OA1:
// leads to ask and workers to launch, in two lists)
describe("what a session's agent launches by a word of its tool", () => {
  const cards = stocked();
  const asks = askablesOf(["reviewer-fast", "translator", "product"], (tag) => cards.find(tag));

  test("Builder and Reviewer always; a copy of either the session names stands in its place; then, in one list, the agents it names", () => {
    assert.deepEqual(launchKinds([]), { own: [{ base: "builder", tag: "builder", name: "Builder", may: "edit" }, { base: "reviewer", tag: "reviewer", name: "Reviewer", may: "read" }], named: [] });
    const kinds = launchKinds(asks);
    assert.deepEqual(kinds.own, [{ base: "builder", tag: "builder", name: "Builder", may: "edit" }, { base: "reviewer", tag: "reviewer-fast", name: "Reviewer, fast", may: "read" }]);
    assert.deepEqual(kinds.named.map((a) => a.tag), ["translator", "product"]);
    // Only Builder's and Reviewer's places are launched by the word; every other agent is asked by its tag.
    assert.deepEqual(["", "builder", "reviewer", "REVIEWER-FAST", "translator", "product", "enduser", "explore"].map((w) => workerFor(asks, w)), ["builder", "builder", "reviewer-fast", "reviewer-fast", null, null, null, null]);
    assert.equal(workerFor([], "reviewer"), "reviewer");
  });

  // (fails before: yes — the bug round of 10-23: a copy of a copy of Helper held Helper's place for teams, not for the
  // agent tool; and Catch me up asked the shipped Helper, not the copy the session names)
  test("a copy of a copy of Builder holds Builder's place; a start asks whoever holds its card's place", () => {
    const store = createAgentCardStore({ dataDir: null });
    store.create({ from: "builder", tag: "builder-2", name: "Builder, mine" });
    store.create({ from: "builder-2", tag: "builder-3", name: "Builder, mine again" });
    const asks = askablesOf(["builder-3"], (tag) => store.find(tag));
    assert.deepEqual([asks[0].from, asks[0].root], ["builder-2", "builder"]);
    assert.equal(launchKinds(asks).own[0].tag, "builder-3");
    assert.equal(workerFor(asks, "builder"), "builder-3");
    const direct = askablesOf(["builder-2"], (tag) => store.find(tag));
    assert.equal("root" in direct[0], false, "a copy of Builder itself says only where it comes from");
    const registry = createSubagentRegistry({ config: () => ({ agentLoop: {} }), log: () => {}, events: { publish: () => {} }, runs: null, context: /** @type {any} */ ({ card: (/** @type {string} */ tag) => store.find(tag), cards: () => store.list(), settings: () => ({ subagents: { ask: ["builder-3"] } }) }) });
    assert.deepEqual([registry.inPlaceOf("c1", "builder"), registry.inPlaceOf("c1", "reviewer")], ["builder-3", "reviewer"]);
  });

  test("the tool lists them: its kind field takes the tags, its text lists every agent named, each with its level", () => {
    const tool = agentToolFor(asks);
    assert.deepEqual(tool.input_schema.properties.subagent_type.enum, ["builder", "reviewer-fast", "translator", "product"]);
    assert.equal(
      tool.description,
      `${TOOL_TEXT.agent}\n\n${TOOL_TEXT.agentAsk} \`translator\` (Translator): Puts strings into German (edits in its own copy). \`product\` (Product): ${SHIPPED_CARDS.product.goodFor.replace(/[.\s]+$/, "")} (edits in its own copy).`,
    );
    assert.match(tool.input_schema.properties.subagent_type.description, /^builder \(the default\): your tools under this session's permission mode\. reviewer-fast: read-only; it searches and reads, never changes anything\. Or a saved agent's tag, to ask it as its card says\.$/);
    assert.deepEqual(AGENT_TOOL.input_schema.properties.subagent_type.enum, ["builder", "reviewer"]);
    // (fails before: yes — the field said a copy "may run anything": the session's permission mode holds there too, as
    // for every sub-agent, since a copy keeps the project's files apart, not the machine)
    const inCopy = agentToolFor([{ tag: "builder-dry", name: "Builder, dry", goodFor: "Tries a thing and keeps nothing", may: "copy", from: "builder" }]);
    assert.match(inCopy.input_schema.properties.subagent_type.description, /^builder-dry \(the default\): your tools in its own copy of the project, under this session's permission mode; nothing it changes there is kept\. reviewer: read-only/);
    // A team's lead sends its crew by role, and asks any other agent the session names (OA1); a tag of its crew is that
    // member, listed once.
    assert.deepEqual(teamAgentToolFor(asks).input_schema.properties.role.enum, ["scout", "builder", "tester", "reviewer", "translator", "product"]);
    const builder = askablesOf(["builder", "product"], (tag) => cards.find(tag));
    assert.deepEqual(teamAgentToolFor(builder).input_schema.properties.role.enum, ["scout", "builder", "tester", "reviewer", "product"]);
    assert.equal(teamAgentToolFor(askablesOf(["builder"], (tag) => cards.find(tag))).input_schema.properties.role.enum.length, 4, "nobody but its crew: the tool itself");
  });

  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA1: with a shipped agent's level set in place, the tool said
  // Helper edits while its launch only read)
  test("Builder made read-only in place: the agent tool says so — the loop's and a coding agent's — and asks nobody more; as it ships, the tool is the same bytes", () => {
    const store = createAgentCardStore({ dataDir: null });
    store.update("builder", { may: "read" });
    const registry = createSubagentRegistry({ config: () => ({ agentLoop: {} }), log: () => {}, events: { publish: () => {} }, runs: null, context: /** @type {any} */ ({ card: (/** @type {string} */ tag) => store.find(tag), cards: () => store.list(), settings: () => ({ subagents: { ask: [] } }) }) });
    const places = registry.places("c1");
    assert.deepEqual([registry.asks("c1"), places.map((p) => [p.tag, p.may])], [[], [["builder", "read"]]], "a place, not an agent the session names");
    const tool = agentToolFor([], places);
    assert.match(tool.input_schema.properties.subagent_type.description, /^builder \(the default\): read-only; it searches and reads, never changes anything\. reviewer: read-only/);
    assert.deepEqual([tool.input_schema.properties.subagent_type.enum, tool.description], [["builder", "reviewer"], TOOL_TEXT.agent], "nobody else listed");
    assert.equal(agentToolFor([], places), tool, "the same place, the same tool");
    const offer = registry.offer("c1");
    assert.deepEqual(offer.places?.map((p) => p.tag), ["builder"]);
    assert.match(/** @type {any} */ (coderAgentToolFor(offer)).input_schema.properties.subagent_type.description, /^builder \(the default\): read-only/);
    store.update("builder", { may: null });
    assert.deepEqual([registry.places("c1"), "places" in registry.offer("c1"), agentToolFor([], registry.places("c1"))], [[], false, AGENT_TOOL], "put back: the tool itself");
  });
});

// ---------------------------------------------------------------------------------------------------
// The registry: every launch runs as a card
// ---------------------------------------------------------------------------------------------------

/**
 * A registry whose front door is a scripted host, over a card store: each launch is served the way a turn serves one.
 * @param {{ cards?: ReturnType<typeof createAgentCardStore>, ask?: string[] }} [o]  `ask`: the session's `subagents.ask`
 */
function scripted({ cards = stocked(), ask = [] } = {}) {
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const marks = [];
  /** @type {any[]} */
  const learned = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none", ask, worktree: false }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser\nAssistant: Fixed it.", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      reported: (o) => learned.push(o),
      mark: (chainId, m) => {
        marks.push({ chainId, ...m });
        return { ...m, afterTurn: 1 };
      },
    },
    call: async ({ body, headers = {} }) => {
      posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = `REPORT ${n}`;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, cards, posts, marks, learned };
}
const TASK = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: "where does the parser live?" };
/** What an agent the session's agent asks by its tag is told ahead of its task (PROMPT.cardAskedByAgent). */
const BY_ITSELF = "[Filament: the session's main agent asks you this by itself, in the middle of its work. The developer sees your answer as a card, and may overrule it.]\n\n";
/** The agent's own launch. @param {Record<string, any>} more */
const BY_AGENT = (more) => ({ ...TASK, origin: /** @type {const} */ ("agent"), ...more });

// (fails before: yes — a launch had a type, "general-purpose" or "explore", and a card only where a lead was asked)
describe("a launch runs as a card", () => {
  test("nothing named is Builder; reviewer is Reviewer: the row and the host name the card, and what it may do says how it runs", async () => {
    const { registry, posts } = scripted();
    const plain = registry.launch({ ...TASK });
    const look = registry.launch({ ...TASK, worker: "reviewer" });
    assert.deepEqual([plain.ok, look.ok], [true, true], refusal(plain) + refusal(look));
    const [h, s] = [registry.hostOf(/** @type {any} */ (plain).id), registry.hostOf(/** @type {any} */ (look).id)];
    assert.deepEqual([h?.card, h?.may, h?.readOnly], [{ tag: "builder", name: "Builder", thinks: SHIPPED_CARDS.builder.thinks, asked: false }, "edit", false]);
    assert.deepEqual([s?.card.tag, s?.may, s?.readOnly], ["reviewer", "read", false], "Reviewer's own words say it changes nothing: the read-only line is not said twice");
    await Promise.all([/** @type {any} */ (plain).done, /** @type {any} */ (look).done]);
    assert.deepEqual(registry.list("c1").map((sa) => [sa.card, sa.may, sa.asked, sa.aside]).reverse(), [
      [{ tag: "builder", name: "Builder" }, "edit", false, false],
      [{ tag: "reviewer", name: "Reviewer" }, "read", false, false],
    ]);
    assert.deepEqual(posts.map((p) => p.headers["x-filament-permissions"] ?? null).sort(), [null, "read-only"], "one that reads runs read-only whatever the session's mode; Builder follows the session's");
  });

  test("a call lowers what a card may do, and never raises it", async () => {
    const { registry, posts } = scripted();
    const held = registry.launch({ ...TASK, may: "read" });
    assert.equal(held.ok, true, refusal(held));
    const host = registry.hostOf(/** @type {any} */ (held).id);
    assert.deepEqual([host?.card.tag, host?.may, host?.readOnly], ["builder", "read", true], "Builder's words do not say it: the read-only line does");
    const product = registry.launch({ ...TASK, worker: "product", may: "read" });
    assert.deepEqual([registry.hostOf(/** @type {any} */ (product).id)?.readOnly, registry.get(/** @type {any} */ (product).id)?.may], [true, "read"], "a card the call lowered: its words do not say it only reads");
    await Promise.all([/** @type {any} */ (held).done, /** @type {any} */ (product).done]);
    assert.deepEqual(posts.map((p) => p.headers["x-filament-permissions"]), ["read-only", "read-only"]);
    assert.equal(refusal(registry.launch({ ...TASK, worker: "reviewer", may: "edit" })), "Reviewer only reads, as its card says");
    assert.equal(refusal(registry.launch({ ...TASK, worker: "runner", may: "edit" })), "Runner runs in its own copy of the project and keeps nothing, as its card says");
    assert.equal(refusal(registry.launch({ ...TASK, worker: "reviewer", may: "write" })), "may must be one of read, copy, edit");
  });

  test("the session's agent launches Builder and Reviewer — a copy of Reviewer in Reviewer's place — and asks the agents its session names; the developer launches any", async () => {
    const { registry } = scripted({ ask: ["reviewer-fast", "translator", "product"] });
    const viaScout = registry.launch(BY_AGENT({ worker: "reviewer", background: true }));
    assert.equal(viaScout.ok, true, refusal(viaScout));
    const sa = registry.get(/** @type {any} */ (viaScout).id);
    assert.deepEqual([sa?.card.tag, sa?.model, sa?.may, sa?.asked], ["reviewer-fast", "m-fast", "read", false], "the card the developer copied from Reviewer does Reviewer's work, on its own model (AG-80)");
    // Any other agent the session names is asked by its tag, at its card's level (OA1).
    const named = registry.launch(BY_AGENT({ as: "translator", background: true }));
    assert.deepEqual(["card", "model", "may", "asked"].map((k) => /** @type {any} */ (registry.get(/** @type {any} */ (named).id))?.[k]), [{ tag: "translator", name: "Translator" }, "m-sub", "edit", true], refusal(named));
    assert.equal(refusal(registry.launch(BY_AGENT({ worker: "translator" }))), "`translator` is asked by its tag (`as`), not launched in Builder's or Reviewer's place", "the agent's tool does it so");
    assert.equal(
      refusal(registry.launch(BY_AGENT({ worker: "enduser" }))),
      "`enduser` is not one you may ask. This session's agent may ask: `translator` (Translator), `product` (Product) — or launch a builder or a reviewer-fast sub-agent.",
    );
    assert.equal(refusal(registry.launch(BY_AGENT({ worker: "product" }))), "`product` is asked by its tag (`as`), not launched in Builder's or Reviewer's place");
    // The developer's own launch names any worker card, whatever the session names for its agent.
    const theirs = registry.launch({ ...TASK, worker: "enduser" });
    assert.equal(registry.get(/** @type {any} */ (theirs).id)?.card.tag, "enduser", refusal(theirs));
    assert.equal(refusal(registry.launch({ ...TASK, worker: "ghost" })), "there is no worker `ghost` — Library › Agents and teams lists them");
    await Promise.all([viaScout, named, theirs].map((r) => /** @type {any} */ (r).done));
  });

  // (OA1: a tag the session names asks that agent — the agent's tool once launched one it called a worker as a sub-agent)
  test("the agent's tool: a named agent's tag asks it, at its card's level — its answer the call's answer", async () => {
    const { registry, posts } = scripted({ ask: ["translator", "product"] });
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
    const res = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "German", prompt: "translate the strings", subagent_type: "Translator" }, emit: () => {}, signal: null });
    const sa = registry.list("c1")[0];
    assert.deepEqual([sa.card.tag, sa.asked, sa.may, sa.origin], ["translator", true, "edit", "agent"]);
    assert.match(res.text, /REPORT 1/, res.text);
    assert.match(res.note, new RegExp(`^agent: asked Translator`), res.note);
    assert.equal(posts[0].body.messages[0].content.at(-1).text, `${BY_ITSELF}translate the strings`, "it is told its task, and who asks");
    door.close();
  });

  test("asked by its tag, an agent answers whoever asked: the developer's stays with them, its marks carry the question, and memory does not learn it", async () => {
    const { registry, marks, learned } = scripted();
    const r = registry.launch({ ...TASK, as: "@Reviewer" });
    assert.equal(r.ok, true, refusal(r));
    await /** @type {any} */ (r).done;
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([sa?.card.tag, sa?.asked, sa?.aside, sa?.may, sa?.exchanges[0].delivery], ["reviewer", true, true, "read", "held"]);
    assert.deepEqual(marks.map((m) => [m.event, m.card, m.asked, m.question, m.answer ?? null]), [
      ["dispatch", { tag: "reviewer", name: "Reviewer" }, true, TASK.prompt, null],
      ["arrival", { tag: "reviewer", name: "Reviewer" }, true, TASK.prompt, "REPORT 1"],
    ]);
    // (OA1: there is no worker apart from a lead — an answer of an agent asked by its tag stays with whoever asked, V4-D296)
    assert.deepEqual(learned, [], "its answer is held by whoever asked: no side door into memory");
    assert.equal(refusal(registry.launch({ ...TASK, as: "reviewer", start: "ask" })), "a launch names a start or an agent, not both: Reviewer's card says what it sees and may do");
  });
});

// ---------------------------------------------------------------------------------------------------
// The level in the middle: its own copy, nothing kept
// ---------------------------------------------------------------------------------------------------

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with one committed file. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-copy-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/**
 * A registry over a real folder whose host "runs" by writing a file into the folder it works in — the worktree
 * `hostOf` names, else the folder its request names — and `during` whatever else its run does there.
 * @param {string} dir @param {((id: string, cwd: string) => void) | null} [during]
 */
const working = (dir, during = null) => {
  const cards = stocked();
  /** @type {{ cwd: string, texts: string[] }[]} */
  const posts = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: ["runner"] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      posts.push({ cwd, texts: body.messages.at(-1).content.map((/** @type {any} */ b) => b.text) });
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      writeFileSync(join(cwd, `ran${n}.txt`), "by the runner\n");
      during?.(id, cwd);
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: `RAN ${n}`, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: `RAN ${n}` }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: `RAN ${n}` }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts };
};

// (fails before: yes — OA1 case 1: PM asked by its tag read only, whatever it was asked; "PM can write its own files in
// form of notes or even mocks", the owner's words)
describe("an agent asked by its tag that edits in its own copy (OA1)", () => {
  test("@product write a PRD: Product writes in its own git worktree, the developer's folder stays as it was, and the file waits there for Apply", async () => {
    const dir = repo();
    const { registry, posts } = working(dir);
    const r = registry.launch({ origin: "owner", chainId: "c1", prompt: "write a one-page PRD in docs/prd.md", as: "product" });
    assert.equal(r.ok, true, refusal(r));
    const o = await /** @type {any} */ (r).done;
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([o.ok, sa?.asked, sa?.may, sa?.shares ?? null], [true, true, "edit", null]);
    assert.notEqual(posts[0].cwd, dir, "it worked in a copy of the project");
    assert.equal(existsSync(join(dir, "ran1.txt")), false, "nothing in the developer's folder yet");
    assert.deepEqual(sa?.work?.files.map((/** @type {any} */ f) => f.path ?? f), ["ran1.txt"], "the file waits in its worktree");
    const a = await registry.apply(/** @type {any} */ (r).id, "c1", "owner");
    assert.equal(a.ok, true, String(/** @type {any} */ (a).error || ""));
    assert.equal(readFileSync(join(dir, "ran1.txt"), "utf8"), "by the runner\n", "applied: it is in the developer's folder");
  });
});

// (fails before: yes — a sub-agent either only read, or its changes waited to be applied: nothing could run a thing
// that writes and leave the developer's folder, and their repository, as they were)
describe("a card that runs in its own copy and keeps nothing", () => {
  test("it works in a worktree and is told what a copy is; at its end its copy is given back, its refs are gone and nothing waits; a follow-up gets a fresh copy, and is told", async () => {
    const dir = repo();
    const { registry, posts } = working(dir);
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const first = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "run it", prompt: "run the flaky test twenty times", subagent_type: "runner" }, emit: () => {}, signal: null });
      const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
      const sa = registry.get(id);
      assert.deepEqual([sa?.card.tag, sa?.may, sa?.work, sa?.shares], ["runner", "copy", null, null]);
      assert.notEqual(posts[0].cwd, dir, "it ran somewhere else");
      assert.deepEqual(posts[0].texts, [SUBAGENT_NOTES.copy, `${BY_ITSELF}run the flaky test twenty times`]);
      assert.match(SUBAGENT_NOTES.copy, /the copy is removed when you report, and nothing you changed in it is kept/);
      assert.equal(copyState(posts[0].cwd), "free", "the copy is given back with its report, free for the next taker");
      assert.equal(existsSync(join(dir, "ran1.txt")), false, "the developer's folder is as it was");
      assert.equal(git(dir, "for-each-ref", `${TASK_REF_PREFIX}${id}`), "", "no ref of its is left in the repository");
      assert.equal(git(dir, "status", "--porcelain"), "");
      assert.match(first.text, /^RAN 1\n\nIt ran in its own copy of the project, given back now: nothing it changed there is in your folder, or kept\./);
      const none = await door.subagents.run({ id: "toolu_2", input: { agent_id: id, apply_changes: true }, emit: () => {}, signal: null });
      assert.match(none.text, new RegExp(`sub-agent ${id} ran in its own copy of the project, and nothing it changed there was kept`));
      const again = await door.subagents.run({ id: "toolu_3", input: { run_in_background: false, description: "again", agent_id: id, prompt: "and ten more" }, emit: () => {}, signal: null });
      assert.match(again.text, /^RAN 2/);
      assert.deepEqual(posts[1].texts.slice(-2), [SUBAGENT_NOTES.copyAgain, "and ten more"]);
      assert.notEqual(posts[1].cwd, dir);
      assert.deepEqual([existsSync(join(posts[1].cwd, "ran1.txt")), copyState(posts[1].cwd)], [false, "free"], "the fresh copy held nothing of the first, and is given back too");
    } finally {
      door.close();
    }
  });

  // (fails before: yes — the bug hunt of 11-08: its copy went back free with a command it started still running in it,
  // for the next taker to reset and work in under it)
  test("a command it started in the background that still runs in its copy as its run ends is stopped as the copy goes back, and the session's agent is told", async () => {
    const dir = repo();
    /** @type {string[]} */
    const started = [];
    const { registry, posts } = working(dir, (id, cwd) => started.push(startCommandShell(`node -e "setInterval(()=>{},1000)"`, cwd, { session: "c1", agent: `subagent:${id}` }, { onEnd: () => {} }).id));
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const main = { session: "c1", agent: null };
    try {
      const first = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "serve it", prompt: "start the server", subagent_type: "runner" }, emit: () => {}, signal: null });
      const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
      assert.equal(started.length, 1);
      assert.equal(copyState(posts[0].cwd), "free", "its copy went back");
      assert.equal(runningShellsOf("c1").some((s) => s.id === started[0]), false, "its command no longer runs there");
      const told = peekShellExits(main).find((x) => x.id === started[0]);
      assert.match(String(told?.text), new RegExp(`^\\[Filament: background command ${started[0]} \\(\`node -e .+\`\\), started by sub-agent ${id}, was stopped after \\d+ s: its run was over, and its copy of the project went back for the next one to use\\.\\]$`), String(told?.text));
    } finally {
      tellShellExits(main, started);
      door.close();
    }
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 6: a team's workers were four roles, none of which runs in a copy)
  test("as a member of a team it is launched by its tag, works in its own copy, and its lead has nothing of its to apply", async () => {
    const dir = repo();
    const { registry, posts } = working(dir);
    const runner = { tag: "runner", name: "Runner", goodFor: "Runs a flaky test many times", may: /** @type {"copy"} */ ("copy"), place: null, line: "Twenty runs, never fewer.", model: null };
    const team = { key: "ops", name: "Ops", members: [runner] };
    const door = registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, emit: () => {}, lead: true, round: () => 1 });
    const tools = createTeamTools({ registry });
    const of = (/** @type {any} */ input, callId = "toolu_1") => ({ chainId: "c1", lead: { runId: "lead-1", callId }, cwd: dir, mode: /** @type {"edit"} */ ("edit"), model: "m", thinking: null, team, input });
    try {
      const res = await tools.agent(of({ role: "runner", description: "Run it", goal: "The flaky test ran twenty times", steps: ["Run it twenty times"], acceptance: "twenty results are counted" }));
      assert.equal(res.ok, true, res.text);
      const id = String(res.agentId);
      assert.ok(res.text.startsWith(`Launched runner ${id} ("Run it") in the background. `) && res.text.includes(` or to ask it more once it reports, call worker with agent_id "${id}". `), `nothing of its is applied: it is asked more\n${res.text}`);
      const sa = registry.get(id);
      assert.deepEqual([sa?.card.tag, sa?.may, sa?.team], ["runner", "copy", { key: "ops", name: "Ops", role: "runner", place: null }], "its row: its team, its tag, and no shipped worker's place");
      await until(() => registry.get(id)?.status === "done");
      assert.notEqual(posts[0].cwd, dir, "it ran somewhere else");
      assert.equal(posts[0].texts[0], SUBAGENT_NOTES.copy, "told what a copy is, ahead of its brief");
      assert.deepEqual([copyState(posts[0].cwd), existsSync(join(dir, "ran1.txt")), git(dir, "status", "--porcelain")], ["free", false, ""], "the copy is given back with its report, and the folder is as it was");
      const apply = await tools.worker(of({ agent_id: id, apply_changes: true }, "toolu_2"));
      assert.equal(apply.ok, false);
      assert.match(apply.text, new RegExp(`${id} ran in its own copy of the project, and nothing it changed there was kept`));
    } finally {
      door.close();
    }
  });

  test("where no copy can be made it ends with the reason and what to do — never in the session's folder; only the developer sends it there, and then it edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-nocopy-"));
    made.push(dir);
    const { registry, posts } = working(dir);
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const res = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "run it", prompt: "run the test", subagent_type: "runner" }, emit: () => {}, signal: null });
      assert.match(res.text, /Runner runs in its own copy of the project, and this folder has none to give: .+\. A Reviewer can still read here; only the developer can let Runner work in the session's folder/);
      assert.deepEqual([posts.length, existsSync(join(dir, "ran1.txt"))], [0, false], "nothing ran");
      const sa = registry.list("c1")[0];
      assert.deepEqual([sa.status, sa.may, sa.shares], ["failed", "copy", null], "a copy shares no folder: its row never says it did");
    } finally {
      door.close();
    }
    const theirs = registry.launch({ origin: "owner", chainId: "c1", prompt: "run the test", worker: "runner" });
    const o = await /** @type {any} */ (theirs).done;
    assert.match(o.error, /^Runner runs in its own copy of the project, and this folder has none to give: .+\. Launch it read only, or let it work in the session's folder$/);
    const inFolder = registry.launch({ origin: "owner", chainId: "c1", prompt: "run the test", worker: "runner", worktree: false });
    assert.equal(inFolder.ok, true, refusal(inFolder));
    await /** @type {any} */ (inFolder).done;
    assert.deepEqual([registry.get(/** @type {any} */ (inFolder).id)?.may, posts.at(-1)?.cwd, readFileSync(join(dir, "ran1.txt"), "utf8")], ["edit", dir, "by the runner\n"], "their word raised it: it edits, in their folder");
    assert.equal(refusal(registry.launch({ origin: "agent", chainId: "c1", prompt: "x", as: "runner", worktree: false, background: true })), "", "an agent's launch has no such word");
    const stillCopy = registry.list("c1")[0];
    assert.equal(stillCopy.may, "copy", "from an agent, worktree off does not raise it");
    await until(() => registry.list("c1")[0].status !== "running");
  });
});

/** Polls until `ok` holds. @param {() => boolean} ok */
async function until(ok) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), "timed out waiting");
}
