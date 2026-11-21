// @ts-check
// "Teams, improved and kept" (11-03), the roster's shrink: four agents ship beside the six Leads and the two that start
// by themselves — Product (PM and Designer in one), End user, Builder (Helper, Builder, Engineer and Tester in one) and
// Reviewer (Scout, Reviewer, Hunter, Checker and Skeptic in one). The main agent's own two kinds are builder and
// reviewer. Every shipped team's crew sits on those cards, a card seated twice under seat names. What a person kept that
// names a card Filament does not ship falls back as it is, never translated, and says in words which card does its work.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWN_WORKERS, SHIPPED_CARDS, createAgentCardStore } from "../src/services/agent-cards.js";
import { AGENT_TOOL, launchKinds, workerFor } from "../src/app/agent/tools.js";
import { SHIPPED_ROSTER_WORDS, rosterWords } from "../src/app/agent/roster-words.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { isShippedRoster, reviewerOf, builderOf, scoutOf, workerOf } from "../src/core/roster.js";
import { createSavedFlows } from "../src/services/saved-flows.js";
import { checkFlow, flowOf } from "../src/core/flow.js";
import { SUBAGENT_STARTS } from "../src/services/subagent-starts.js";
import { BRIEF, leadOf, teamStore, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const GONE = ["pm", "designer", "engineer", "skeptic", "helper", "scout", "tester", "hunter", "checker"];

// (fails before: yes — twenty cards shipped: five to think with, the six Leads, seven that did a session's work, two that start by themselves)
describe("the cards that ship", () => {
  // (fails before: yes — the owner's word of 11-05: Explainer and Watcher shipped, starting by themselves)
  test("Product, End user, the teams' Leads, Builder and Reviewer; the nine folded into them are gone, and the two that started by themselves", () => {
    // The plan's p6: the four build teams' Leads are one, Builders'; the Bug Hunter's and the Verifier's are one, BugHunters'.
    assert.deepEqual(Object.keys(SHIPPED_CARDS), ["product", "enduser", "buildlead", "huntlead", "builder", "reviewer"]);
    const store = createAgentCardStore({ dataDir: null });
    assert.deepEqual(
      ["product", "enduser", "builder", "reviewer"].map((t) => [t, store.find(t)?.name, store.find(t)?.may, store.find(t)?.model]),
      [
        ["product", "Product", "edit", null],
        ["enduser", "End user", "copy", null],
        ["builder", "Builder", "edit", null],
        ["reviewer", "Reviewer", "read", null],
      ],
      "Product edits in its own copy as PM and Designer did; Builder edits as Helper, Engineer and Tester did; Reviewer reads as Scout, Hunter, Checker and Skeptic did — none names a model of its own",
    );
    for (const t of [...GONE, "explainer", "watcher"]) assert.equal(store.find(t), null, `${t} ships no more`);
    // The words of each merged card cover the work of those it took in.
    const thinks = (/** @type {string} */ t) => String(store.find(t)?.thinks);
    for (const w of ["where a thing is", "review a change", "hunt bugs", "check claims", "Confirmed, Plausible or Dismissed", "second look"]) assert.ok(thinks("reviewer").includes(w), `Reviewer: ${w}`);
    for (const w of ["a feature, a fix, or the tests for one", "A test must be able to fail", "Never call tested what you did not run"]) assert.ok(thinks("builder").includes(w), `Builder: ${w}`);
    for (const w of ["smallest version worth having", "what they see first"]) assert.ok(thinks("product").includes(w), `Product: ${w}`);
  });
});

// (fails before: yes — the main agent's own two were helper and scout)
describe("the main agent's own two kinds", () => {
  test("builder, the default, and reviewer, which reads: the agent tool's kinds, the task graph's workers and the quick starts", () => {
    assert.deepEqual([...OWN_WORKERS], ["builder", "reviewer"]);
    const kind = /** @type {any} */ (AGENT_TOOL.input_schema.properties).subagent_type;
    assert.deepEqual(kind.enum, ["builder", "reviewer"]);
    assert.equal(kind.description, "builder (the default): your tools under this session's permission mode. reviewer: read-only; it searches and reads, never changes anything.");
    assert.deepEqual(launchKinds().own.map((o) => [o.tag, o.name, o.may]), [["builder", "Builder", "edit"], ["reviewer", "Reviewer", "read"]]);
    assert.deepEqual([workerFor([], ""), workerFor([], "reviewer"), workerFor([], "builder"), workerFor([], "scout"), workerFor([], "helper")], ["builder", "reviewer", "builder", null, null]);
    assert.deepEqual(Object.values(SUBAGENT_STARTS).map((s) => [s.id, s.worker, s.may]), [["ask", "reviewer", "read"], ["job", "builder", "edit"], ["review", "reviewer", "read"], ["catchup", "reviewer", "read"]]);
  });
});

// (fails before: yes — every shipped team's crew named Scout and Tester, the Bug Hunter's Hunter and the Verifier's Checker)
describe("a shipped team's crew on seats", () => {
  test("Reviewer seated as the Scout, Builder, Builder seated as the Tester, Reviewer: each by its id, its card and its own line; the lead reads the words written for the four", () => {
    const store = teamStore();
    // The plan's p6: the team that builds is one, Builders.
    for (const key of ["builders"]) {
      const t = /** @type {any} */ (store.find(key));
      assert.deepEqual(t.members.map((/** @type {any} */ m) => [m.tag, m.card ?? null, m.name, m.may, m.place]), [
        ["scout", "reviewer", "Scout", "read", "reviewer"],
        ["builder", null, "Builder", "edit", "builder"],
        ["tester", "builder", "Tester", "edit", "builder"],
        ["reviewer", null, "Reviewer", "read", "reviewer"],
      ], key);
      assert.equal(isShippedRoster(t.members), true, `${key}: the four that ship`);
      assert.equal(rosterWords(t.members), SHIPPED_ROSTER_WORDS);
      assert.deepEqual([reviewerOf(t.members)?.tag, builderOf(t.members)?.tag, scoutOf(t.members)?.tag], ["reviewer", "builder", "scout"], `${key}: the Reviewer reviews, the Scout explores, though both sit on Reviewer`);
      assert.deepEqual(workerOf(t, "scout"), { key, name: t.name, role: "scout", card: "reviewer", seat: "Scout", place: "reviewer", words: t.members[0].line });
    }
    // The plan's p6: the Bug Hunter's Hunter and the Verifier's Checker are BugHunters' two seats; the two teams are gone.
    assert.deepEqual(/** @type {any} */ (store.find("bughunters")).members.map((/** @type {any} */ m) => [m.tag, m.card, m.name, m.may]), [["hunter", "reviewer", "Hunter", "read"], ["checker", "reviewer", "Checker", "read"]]);
    assert.deepEqual([store.find("bug-hunter"), store.find("verifier")], [null, null]);
    // Its own cards, by tag, ones the default crew has not: another team of four is no shipped crew.
    const mine = store.create({ name: "Mine", lead: "builder", members: [{ tag: "reviewer", name: "Scout" }, { tag: "builder" }, { tag: "reviewer", name: "Tester" }, { tag: "reviewer", name: "Last" }] });
    assert.equal(isShippedRoster(mine.members), false, "a seat on another card is another crew");
  });

  test("its lead launches each seat as its card, with the team's own line for that seat", async () => {
    const store = teamStore();
    const team = /** @type {any} */ (store.find("builders"));
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 8 }] } });
    const l = leadOf(w.registry, w.dir);
    /** @type {any[]} */
    const launched = [];
    for (const role of ["scout", "builder", "tester", "reviewer"]) {
      const input = role === "builder" || role === "tester" ? { ...BRIEF, role, description: `Do it as ${role}` } : { ...BRIEF, role, description: `Read it as ${role}` };
      const r = await l.tools.agent({ ...l.call(input), team });
      assert.equal(r.ok, true, r.text);
      launched.push(w.registry.get(String(r.agentId)));
    }
    assert.deepEqual(launched.map((sa) => [sa.team.role, sa.card.tag, sa.may]), [["scout", "reviewer", "read"], ["builder", "builder", "edit"], ["tester", "builder", "edit"], ["reviewer", "reviewer", "read"]]);
    const runs = [await w.run(1), await w.run(2), await w.run(3), await w.run(4)];
    for (const r of runs) r.attach();
    await Promise.all(launched.map((sa) => until(() => w.registry.get(sa.id)?.runId, "its run to attach")));
    assert.deepEqual(launched.map((sa) => w.registry.hostOf(sa.id)?.team?.words), team.members.map((/** @type {any} */ m) => m.line), "each seat with its own line");
    for (const r of runs) r.finish({ status: "done", report: "Done." });
    await Promise.all(launched.map((sa) => w.registry.settled(sa.id)));
  });
});

// (fails before: yes — a team naming Scout was held with "There is no agent `@scout` to be a member")
describe("a team of yours that names a card Filament does not ship", () => {
  test("is held, kept as saved, and says which card does that card's work", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: {
        mine: { name: "Mine", lead: "builder", members: [{ tag: "scout", line: "Map it." }, { tag: "builder", line: "" }] },
        led: { name: "Led", lead: "pm", members: [{ tag: "builder", line: "" }] },
      } }));
      const store = teamStore({ dataDir: dir });
      assert.deepEqual(store.held(), [
        { key: "mine", name: "Mine", why: "Scout is now part of Reviewer: seat Reviewer in its place" },
        { key: "led", name: "Led", why: "PM is now part of Product: make Product the lead in its place" },
      ]);
      // A save that names one is refused in the same words.
      assert.throws(() => store.create({ name: "New", lead: "builder", members: [{ tag: "tester" }] }), { status: 400, message: "Tester is now part of Builder: seat Builder in its place" });
      assert.deepEqual([store.find("mine"), store.find("led")], [null, null], "held: no team to run");
      // Rule 2: nothing reads `pm` as Product — a card of yours under that tag brings the team back as it was saved.
      store.cards.create({ tag: "pm", name: "My PM", goodFor: "Says what to build first and what to leave out" });
      assert.deepEqual([store.find("led")?.lead.tag, store.held().map((h) => h.key)], ["pm", ["mine"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the review of 11-03: a team held told the person to seat Reviewer in Scout's place, and its
  // update answered 404: it could only be deleted)
  test("is edited where it is held: its editor's view gives each gone card's words, and a save checked as any save is makes it a team again", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      const file = join(dir, "teams.json");
      writeFileSync(file, JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "pm", members: [{ tag: "scout", line: "Map it." }, { tag: "builder", line: "" }], models: ["glm-5.3"], createdAt: 7, updatedAt: 7 } } }));
      const store = teamStore({ dataDir: dir });
      const v = /** @type {any} */ (store.heldTeam("mine"));
      assert.deepEqual([v.name, v.lead, v.leadGone, v.members, v.models], [
        "Mine",
        "pm",
        "PM is now part of Product: make Product the lead in its place",
        [{ tag: "scout", line: "Map it.", gone: "Scout is now part of Reviewer: seat Reviewer in its place" }, { tag: "builder", line: "" }],
        ["glm-5.3"],
      ]);
      // What it still names wrong is refused in the same words; nothing is translated.
      assert.throws(() => store.update("mine", { lead: "product" }), { status: 400, message: "Scout is now part of Reviewer: seat Reviewer in its place" });
      const t = store.update("mine", { lead: "product", members: [{ tag: "reviewer", name: "Scout", line: "Map it." }, { tag: "builder", line: "" }] });
      assert.deepEqual([t.key, t.name, t.lead.tag, t.members.map((m) => [m.tag, m.card ?? null]), t.models, t.createdAt], ["mine", "Mine", "product", [["scout", "reviewer"], ["builder", null]], ["glm-5.3"], 7]);
      assert.deepEqual([store.held(), store.heldTeam("mine")], [[], null]);
      const disk = JSON.parse(readFileSync(file, "utf8")).teams.mine;
      assert.deepEqual([disk.lead, disk.members], ["product", [{ tag: "reviewer", name: "Scout", line: "Map it." }, { tag: "builder", line: "" }]]);
      assert.equal(teamStore({ dataDir: dir }).find("mine")?.lead.tag, "product", "read back as a team of yours");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shipped card set in place under a tag Filament does not ship is skipped, and the cards that ship stand as they ship", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      writeFileSync(join(dir, "agents.json"), JSON.stringify({ version: 1, agents: {}, shipped: { scout: { model: "m-cheap" }, reviewer: { models: ["m-strong"] } } }));
      /** @type {string[]} */
      const logs = [];
      const store = createAgentCardStore({ dataDir: dir, log: (_l, m) => logs.push(m) });
      assert.equal(store.find("scout"), null);
      assert.deepEqual(store.find("reviewer")?.models, ["m-strong"], "a card that ships keeps what was set on it");
      assert.ok(logs.some((m) => m.includes("scout (set in place)")), logs.join("\n"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: no — a guard: a team that ships, set in place before the shrink to name Checker in its crew or PM at
  // its head, is read as it ships in those fields, each named in the log; nothing reads the old tag as the new card)
  test("a team that ships, set in place naming a card Filament does not ship, takes what ships in that field, and the log names it", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: {}, shipped: {
        bughunters: { members: [{ tag: "checker", line: "Mine." }], was: { members: "000000000000" } },
        builders: { lead: "pm", name: "My Builders", was: { lead: "000000000000", name: "000000000000" } },
      } }));
      /** @type {string[]} */
      const logs = [];
      const store = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => logs.push(m) });
      const v = /** @type {any} */ (store.find("bughunters"));
      const a = /** @type {any} */ (store.find("builders"));
      assert.deepEqual([v.members.map((/** @type {any} */ m) => [m.tag, m.card]), v.set, a.lead.tag, a.name, a.set], [[["hunter", "reviewer"], ["checker", "reviewer"]], [], "buildlead", "My Builders", ["name"]]);
      assert.match(logs.join("\n"), /could not be read and were skipped: shipped bughunters \(members\), shipped builders \(lead\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — the review of 11-03: a card of yours under a tag a card that ships took, or one a save would
// refuse, was skipped as it was read, and the next save of any card wrote agents.json without it, gone for good)
describe("a card of yours that cannot be used now", () => {
  test("is kept as saved through every save, listed with why and what it holds, given way to by a card saved under its tag, deleted on your word", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      const mine = { name: "My product", goodFor: "Says what to build first", thinks: "You weigh it.", may: "read", createdAt: 5, updatedAt: 5 };
      const odd = { name: "Odd", goodFor: "Anything", may: "all" };
      writeFileSync(join(dir, "agents.json"), JSON.stringify({ version: 1, agents: { product: mine, odd } }));
      /** @type {string[]} */
      const logs = [];
      const store = createAgentCardStore({ dataDir: dir, log: (_l, m) => logs.push(m) });
      assert.deepEqual(store.held().map((h) => [h.tag, h.name, h.why]), [
        ["product", "My product", "Product ships under `@product` now: make your card again under another tag"],
        ["odd", "Odd", "may must be one of read, copy, edit: read only, run in its own copy with nothing kept, or edit in its own copy"],
      ]);
      assert.match(logs.join("\n"), /2 agents of yours in agents\.json cannot be used now, kept as saved/);
      // Rule 2: nothing reads it as the card that ships.
      assert.equal(store.find("product")?.name, "Product");
      const c = store.held()[0].card;
      assert.deepEqual([c.name, c.goodFor, c.thinks, c.may, c.models, c.mayRun], ["My product", "Says what to build first", "You weigh it.", "read", [], []], "what it holds, as an editor opens it to make it again");
      const file = () => JSON.parse(readFileSync(join(dir, "agents.json"), "utf8")).agents;
      store.create({ tag: "notes", name: "Notes", goodFor: "Takes notes" });
      assert.deepEqual([file().product, file().odd], [mine, odd], "a save of another card writes each back as it was saved");
      store.create({ tag: "my-product", name: "My product", goodFor: "Says what to build first" });
      assert.deepEqual(store.held().map((h) => h.tag), ["product", "odd"], "made again under a tag of its own: the kept one stays until you delete it");
      // A card saved under a kept one's tag takes its place.
      store.create({ tag: "odd", name: "Odd", goodFor: "Anything" });
      assert.deepEqual([store.held().map((h) => h.tag), file().odd.may], [["product"], "read"]);
      assert.deepEqual(store.remove("product"), { tag: "product", name: "My product", kept: true });
      assert.deepEqual([store.held(), "product" in file(), store.find("product")?.shipped], [[], false, true], "gone on your word; the card that ships stays");
      assert.throws(() => store.remove("product"), { status: 403 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — a saved flow's box for PM drew and started as one; once PM was gone, its words said only that no
// agent was called "pm")
describe("a saved flow that names a card Filament does not ship", () => {
  test("loads as it was kept; its draft cannot start, and the box says it needs the card that does that card's work", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      mkdirSync(dir, { recursive: true });
      const steps = [{ why: "First", boxes: [{ id: "plan", kind: "agent", agent: "pm", words: "Plan it", needs: [] }] }, { why: "Then", boxes: [{ id: "check", kind: "agent", agent: "reviewer", words: "Check it", needs: ["plan"] }] }];
      writeFileSync(join(dir, "flows-saved.json"), JSON.stringify({ version: 1, flows: { old: { name: "Old", steps, at: 1 } } }));
      const saved = createSavedFlows({ dataDir: dir });
      const kept = /** @type {any} */ (saved.find("old"));
      assert.deepEqual(kept.steps[0].boxes.map((/** @type {any} */ b) => b.agent), ["pm"], "kept as it was saved");
      const cards = createAgentCardStore({ dataDir: null }).list().filter((c) => !c.partOf).map((c) => ({ tag: c.tag, name: c.name }));
      const roster = { cards, teams: [] };
      const flow = flowOf({ title: kept.name, goal: "Ship it", steps: kept.steps }, roster, { id: "f1", chainId: "c1", at: 1 });
      assert.equal(flow.steps[0].boxes[0].agent, "pm", "no card read in its place");
      assert.equal(checkFlow(flow, roster), 'the box for "pm" needs a card — PM is now part of Product: pick Product for this box');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — a sub-agent kept from the Scout card went on as Scout after a restart, with no word that the card was gone)
describe("a sub-agent kept from a card Filament does not ship", () => {
  test("loads after a restart, its thread readable; a follow-up or a Retry says the card is gone and which takes its place; a launch as it says so too", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-roster-shrink-"));
    try {
      /** @type {any[]} */
      const kept = [];
      /** @param {any} [context] */
      const registryOf = (context = {}) => {
        /** @type {ReturnType<typeof createSubagentRegistry>} */
        const registry = createSubagentRegistry({
          config: () => ({ agentLoop: {} }),
          log: () => {},
          events: { publish: () => {} },
          runs: null,
          now: Date.now,
          context: {
            settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
            session: () => ({ cwd: root, model: "m", projectId: "p1" }),
            view: async () => ({ text: "", turns: 1 }),
            brief: async () => null,
            modelProblem: () => null,
            mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
            saveThread: (/** @type {string} */ _c, /** @type {any} */ t) => void kept.push(structuredClone(t)),
            ...context,
          },
          call: async ({ body, headers = {} }) => {
            const id = headers["x-filament-subagent"];
            registry.attach(id, "run-1");
            registry.finish(id, { status: "done", error: null, report: "Found it in parse.js.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Found it in parse.js." }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: ["run-1"] });
            return { ok: true, status: 200, json: { content: [{ type: "text", text: "Found it in parse.js." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: "run-1", upstream: "m", retryAfter: null, shouldRetry: null };
          },
        });
        return registry;
      };
      const first = registryOf();
      const r = /** @type {any} */ (first.launch({ origin: "owner", chainId: "c1", prompt: "where do we parse dates?", description: "Find the parser", worker: "reviewer", may: "read", background: true }));
      assert.ok(r.ok, JSON.stringify(r));
      await r.done;
      // As a Filament that shipped Scout kept it.
      const thread = { ...structuredClone(kept.at(-1)), card: { tag: "scout", name: "Scout", thinks: "You are a scout: you find and read, and change nothing.", may: "read" } };
      const again = registryOf({ loadThreads: () => [thread] });
      const row = again.list("c1").find((s) => s.id === r.id);
      assert.deepEqual([row?.card.tag, row?.card.name, row?.status], ["scout", "Scout", "done"], "it loads as it was kept");
      assert.equal(again.detail(r.id)?.exchanges[0].report, "Found it in parse.js.", "its thread reads as it was");
      const words = `sub-agent ${r.id} ran as Scout, which is gone — Scout is now part of Reviewer: launch Reviewer to go on with its work; its thread stays to read`;
      assert.deepEqual(again.followUp(r.id, { prompt: "and where do we format them?", chainId: "c1" }), { ok: false, error: words });
      assert.deepEqual(again.followUp(r.id, { prompt: "", chainId: "c1", again: true }), { ok: false, error: words }, "a Retry too");
      assert.deepEqual(again.launch({ origin: "owner", chainId: "c1", prompt: "where?", description: "Find it", as: "scout" }), { ok: false, error: "there is no agent `@scout` — Scout is now part of Reviewer: launch Reviewer in its place" });
      assert.equal(again.get(r.id)?.status, "done", "nothing ran");
      // (fails before: yes — the review of ee5d1c212: a kept Explainer or Watcher thread went on from its saved words)
      const retired = { ...structuredClone(kept.at(-1)), card: { tag: "explainer", name: "Explainer", thinks: "You explain the report.", may: "read" } };
      const later = registryOf({ loadThreads: () => [retired] });
      assert.deepEqual(later.followUp(r.id, { prompt: "and why?", chainId: "c1" }), { ok: false, error: `sub-agent ${r.id} ran as Explainer, which is gone — Explainer ships no more; its thread stays to read` });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
