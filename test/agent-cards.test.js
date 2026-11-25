// @ts-check
// HarnessV4_Tasks E15 step 2: saved agents as data. Five leads ship with Filament, read-only; your own are saved in
// agents.json in the data folder, version 1. A card is a tag, a name, the line that says what it is good for, the
// paragraph that says how it thinks, what it may do, a model and what it sees — one kind of agent (OA1). Every refusal is said in words, with the status the
// admin API answers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CARDS_FILE, CARD_LIMITS, CARD_TOOLS, SHIPPED_CARDS, askablesOf, cardTag, createAgentCardStore, placesOf, teamClashes } from "../src/services/agent-cards.js";
import { CARD_TOOL_NAMES, cardOffTools, cardRefusals, launchKinds } from "../src/app/agent/tools.js";
import { findingsFormat } from "../src/core/beside.js";

const folder = () => mkdtempSync(join(tmpdir(), "filament-agents-"));
/** @param {() => any} fn @param {number} status @param {RegExp} words */
const refuses = (fn, status, words) =>
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.equal(e.status, status, e.message);
    assert.match(e.message, words);
    return true;
  });
const SECURITY = { tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You think as someone who wants to break in." };

// (fails before: yes — saved agents did not exist)
describe("the shipped agents", () => {
  // (fails before: yes — HarnessV4_OneAgent_Plan OA1: leads and workers were two kinds, a lead read only, and a team's
  // head was a lead anyone could ask)
  // (fails before: yes — "Teams, improved and kept" of 11-03: twenty cards shipped, Product's, Builder's and Reviewer's
  // work spread over nine more; then the four build teams' Leads were one, Builders')
  // (fails before: yes — the plan's p6: Bug Hunter and Verifier were two teams, each with a Lead of its own; they are one,
  // BugHunters, led by its own)
  // (fails before: yes — the owner's word of 11-05: Explainer and Watcher shipped, starting by themselves)
  test("four agents and the two teams' own Leads, in order, each with its line, its paragraph and its level; each starts apart, and none by itself", () => {
    const store = createAgentCardStore({ dataDir: null });
    assert.deepEqual(Object.keys(SHIPPED_CARDS), ["product", "enduser", "buildlead", "huntlead", "builder", "reviewer"]);
    assert.equal(store.list().some((c) => "kind" in c), false, "no card has a kind");
    assert.deepEqual(store.list().map((c) => [c.tag, c.name, c.may, c.partOf, c.shipped]), [
      // OA1's levels: reads only — Reviewer; runs in its own copy — End user; edits in its own copy — Product, Builder.
      ["product", "Product", "edit", null, true],
      // (fails before: yes — HarnessV4_ShippedAgents_Plan SA5, Q1: End user read only, so it could describe your app
      // but never use it)
      ["enduser", "End user", "copy", null, true],
      // (fails before: yes — HarnessV4_Tasks E15 step 6, AG-168: a team's lead was a text of the team's, no card to ask;
      // OA-D4: each is now part of its team; the plan's p6: the four build teams' Leads are Builders')
      ["buildlead", "Builders", "read", "builders", true],
      // (fails before: yes — team_v2_plan §5.6: the Bug Hunter's and the Verifier's leads)
      // (fails before: yes — the plan's p6: the two were one team's, BugHunters')
      ["huntlead", "BugHunters", "read", "bughunters", true],
      ["builder", "Builder", "edit", null, true],
      ["reviewer", "Reviewer", "read", null, true],
    ]);
    assert.equal(store.list().some((c) => "starts" in c), false, "every card starts when it is asked, and only then");
    for (const c of store.list()) {
      assert.ok(c.goodFor.length > 20 && c.goodFor.length <= CARD_LIMITS.goodFor && !/[\r\n]/.test(c.goodFor), `${c.tag}'s line`);
      assert.equal(cardTag(c.tag), c.tag);
      assert.equal(c.model, null, `${c.tag}: no model of its own (AG-11)`);
      // (the plan's p6: BugHunters' Lead says what the Bug Hunter's and the Verifier's said, each under 1,200 characters,
      // so its words are under the two's — and a hunt's range and its Hunters' findings merged in code, a few hundred more;
      // the owner's of 11-04: Builders' Lead carries a second paragraph, how it leads, in the owner's words)
      assert.ok(c.thinks.length > 300 && c.thinks.length < ({ huntlead: 2800, buildlead: 1400 }[c.tag] ?? 1200), `${c.tag}'s paragraph`);
      // (fails before: yes — the owner's words of 10-19: a second opinion that saw the session "would actually be the same
      // as of the main agent"; and of 10-31: a worker handed the session takes on its bias, one handed nothing answers apart)
      assert.deepEqual(c.sees, { view: "none", running: false, changes: null }, `${c.tag} sees none`);
    }
    assert.ok(SHIPPED_CARDS.huntlead.thinks.endsWith(`\n\n${findingsFormat()}`), "BugHunters' Lead ends with the one findings list, for a hunt and a check alike");
  });

  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA1: a shipped agent's name was a copy's to change)
  test("a shipped agent keeps its tag and is never deleted, and a copy the caller changes changes nothing", () => {
    const store = createAgentCardStore({ dataDir: null });
    refuses(() => store.update("product", { tag: "boss" }), 400, /^An agent's tag does not change \(`@product`\): make a copy under the new tag\.$/);
    refuses(() => store.update("product", { tag: null }), 400, /^An agent's tag does not change \(`@product`\)\.$/);
    refuses(() => store.remove("product"), 403, /`@product` is a shipped agent: it cannot be deleted\./);
    const pm = /** @type {any} */ (store.find("product"));
    pm.name = "changed";
    pm.sees.view = "window";
    assert.deepEqual([store.find("product")?.name, store.find("product")?.sees.view], ["Product", "none"]);
  });
});

// (fails before: yes — saved agents did not exist)
describe("a tag", () => {
  test("2 to 24 letters, digits and dashes, starting with a letter: never a file's path; read with or without the @, in any case", () => {
    assert.deepEqual(["pm", "@PM", " End-User2 ", "ab"].map(cardTag), ["pm", "pm", "end-user2", "ab"]);
    assert.deepEqual(["", "a", "2fast", "-x", "src/app.js", "notes.md", "a b", "x".repeat(25), "pm!", null, undefined].map(cardTag), Array(11).fill(null));
  });

  test("a save refuses a tag that is none, one of Filament's own commands, and one that is taken — each in words", () => {
    const store = createAgentCardStore({ dataDir: null });
    refuses(() => store.create({ ...SECURITY, tag: undefined }), 400, /^An agent needs a tag: what you type after @/);
    refuses(() => store.create({ ...SECURITY, tag: "src/app.js" }), 400, /`src\/app\.js` cannot be a tag: a tag is 2 to 24 letters/);
    refuses(() => store.create({ ...SECURITY, tag: "mem" }), 400, /`@mem` is a command of Filament's own; give the agent another tag\./);
    refuses(() => store.create({ ...SECURITY, tag: "Product" }), 400, /`@product` is taken by Product \(shipped\) — pick another tag\./);
    store.create(SECURITY);
    refuses(() => store.create({ ...SECURITY, name: "Other" }), 400, /`@security` is taken by Security — pick another tag\./);
  });
});

// (fails before: yes — saved agents did not exist)
describe("your agents", () => {
  test("a new agent is saved to the data folder, version 1, and read back by a new store; the file holds nothing the store adds itself", () => {
    const dir = folder();
    try {
      let t = 1000;
      const store = createAgentCardStore({ dataDir: dir, now: () => t++ });
      const made = store.create({ ...SECURITY, tag: "@Security", model: " zai/glm-5.3 ", sees: { view: "folded", changes: "turn" } });
      assert.deepEqual(made, {
        tag: "security",
        name: "Security",
        partOf: null,
        goodFor: SECURITY.goodFor,
        thinks: SECURITY.thinks,
        may: "read",
        models: ["zai/glm-5.3"],
        model: "zai/glm-5.3",
        // (the owner's word of 11-05: how hard it thinks on each model, where one says; none written where none does)
        efforts: {},
        sees: { view: "folded", running: false, changes: "turn" },
        mayRun: [],
        toolsOff: [],
        shipped: false,
        from: null,
        createdAt: 1000,
        updatedAt: 1000,
      });
      const onDisk = JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"));
      assert.deepEqual(Object.keys(onDisk), ["version", "agents"]);
      assert.equal(onDisk.version, 1);
      assert.deepEqual(Object.keys(onDisk.agents), ["security"]);
      assert.deepEqual(Object.keys(onDisk.agents.security).sort(), ["createdAt", "from", "goodFor", "may", "mayRun", "model", "models", "name", "sees", "thinks", "updatedAt"]);
      assert.deepEqual(readdirSync(dir), [AGENT_CARDS_FILE], "no temporary file is left");
      const again = createAgentCardStore({ dataDir: dir });
      assert.deepEqual(again.find("security"), made);
      assert.deepEqual(again.list().map((c) => c.tag), [...Object.keys(SHIPPED_CARDS), "security"], "the shipped ones first, then yours");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a copy takes the source's fields under a tag of its own, with what the save says on top; it needs that tag", () => {
    const store = createAgentCardStore({ dataDir: null, now: () => 5 });
    refuses(() => store.create({ from: "product" }), 400, /^A copy of Product needs a tag of its own: what you will type after @\.$/);
    refuses(() => store.create({ from: "nobody", tag: "x1" }), 404, /There is no agent `nobody` to copy\./);
    const mine = store.create({ from: "@product", tag: "pm2", name: "My PM", model: "codex/gpt-5.6-luna" });
    assert.deepEqual([mine.tag, mine.name, mine.goodFor, mine.thinks, mine.model, mine.sees, mine.shipped, mine.from], ["pm2", "My PM", SHIPPED_CARDS.product.goodFor, SHIPPED_CARDS.product.thinks, "codex/gpt-5.6-luna", { view: "none", running: false, changes: null }, false, "product"]);
    assert.equal(store.find("product")?.model, null, "the source is as it was");
  });

  test("an edit changes the fields it names and keeps the tag; a delete removes it; an unknown one is not there", () => {
    const dir = folder();
    try {
      let t = 10;
      const store = createAgentCardStore({ dataDir: dir, now: () => t++ });
      store.create(SECURITY);
      const edited = store.update("security", { goodFor: "Where it leaks", model: null, sees: { view: "none" } });
      assert.deepEqual([edited.tag, edited.name, edited.goodFor, edited.model, edited.sees, edited.createdAt, edited.updatedAt], ["security", "Security", "Where it leaks", null, { view: "none", running: false, changes: null }, 10, 11]);
      assert.equal(store.update("security", { tag: "security" }).tag, "security", "naming its own tag changes nothing");
      refuses(() => store.update("security", { tag: "sec" }), 400, /An agent's tag does not change \(`@security`\): make a copy under the new tag, and delete this one\./);
      refuses(() => store.update("nobody", { name: "x" }), 404, /There is no agent `@nobody`\./);
      assert.equal(store.remove("security").tag, "security");
      assert.equal(store.find("security"), null);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8")), { version: 1, agents: {} });
      refuses(() => store.remove("security"), 404, /There is no agent `@security`\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("what a save refuses, in words: a missing or overlong field, two lines where one goes, a view that is none, an unknown field — `kind` among them (OA1)", () => {
    const store = createAgentCardStore({ dataDir: null });
    refuses(() => store.create({ ...SECURITY, name: " " }), 400, /An agent needs a name: up to 40 characters, on one line\./);
    refuses(() => store.create({ ...SECURITY, name: "x".repeat(41) }), 400, /An agent's name is up to 40 characters \(this one has 41\)\./);
    refuses(() => store.create({ ...SECURITY, goodFor: "one\ntwo" }), 400, /An agent's "good for" line is one line, up to 160 characters\./);
    refuses(() => store.create({ ...SECURITY, goodFor: undefined }), 400, /An agent needs a "good for" line: what to ask it, in up to 160 characters\./);
    refuses(() => store.create({ ...SECURITY, thinks: "x".repeat(4001) }), 400, /How an agent thinks is up to 4,000 characters \(this has 4,001\)\./);
    refuses(() => store.create({ ...SECURITY, kind: "lead" }), 400, /^unknown field `kind`: an agent has a tag, a name, goodFor, thinks, may, models, sees, mayRun and toolsOff$/);
    refuses(() => store.create({ ...SECURITY, model: "a\nb" }), 400, /model must be a model's name on one line, or null for the session's own\./);
    refuses(() => store.create({ ...SECURITY, sees: { view: "fork" } }), 400, /sees\.view must be one of none, folded, window\./);
    refuses(() => store.create({ ...SECURITY, sees: { view: "moderate" } }), 400, /sees\.view must be one of none, folded, window\./);
    refuses(() => store.create({ ...SECURITY, sees: { view: "folded", changes: "all" } }), 400, /sees\.changes must be one of turn, uncommitted, or null\./);
    refuses(() => store.create({ ...SECURITY, sees: { view: "folded", depth: 2 } }), 400, /unknown field `sees\.depth`/);
    refuses(() => store.create({ ...SECURITY, tools: ["bash"] }), 400, /unknown field `tools`: an agent has a tag, a name, goodFor, thinks, may, models, sees, mayRun and toolsOff/);
    refuses(() => store.create({ ...SECURITY, toolsOff: ["bash", "web"] }), 400, /^`bash` is not among the tools an agent goes without: shell, browser, web, mcp, visuals, space\.$/);
    refuses(() => store.create({ ...SECURITY, toolsOff: "web" }), 400, /^toolsOff must be a list of the tools an agent goes without/);
    assert.deepEqual(store.list().filter((c) => !c.shipped), [], "nothing was saved by a refused save");
  });

  // (fails before: yes — an advisor needed words and read only, and a card a team used kept its kind; OA1: one kind)
  test("a card is one kind of agent (OA1): without words or with, reading only or changing files, a copy keeping its source's level; it starts apart", () => {
    const store = createAgentCardStore({ dataDir: null, usedBy: (tag) => (tag === "fixer" ? "Fixer leads the Night team" : null) });
    const plain = store.create({ ...SECURITY, tag: "plain", thinks: "" });
    assert.deepEqual([plain.thinks, plain.may, plain.sees, plain.partOf], ["", "read", { view: "none", running: false, changes: null }, null]);
    const fixer = store.create({ ...SECURITY, tag: "fixer", name: "Fixer", may: "edit" });
    assert.equal(fixer.may, "edit");
    const copy = store.create({ tag: "pm-copy", from: "product" });
    assert.deepEqual([copy.may, copy.partOf], ["edit", null], "a copy keeps its source's level");
    const lead = store.create({ tag: "lead2", from: "buildlead", name: "My builder lead" });
    assert.equal(lead.partOf, null, "a copy of a team's own Lead is yours, part of no team");
    // (the owner's word of 11-05: no agent starts by itself)
    refuses(() => store.create({ ...SECURITY, tag: "watch2", starts: "running" }), 400, /^unknown field `starts`/);
  });

  // (fails before: yes — HarnessV4_OneAgent_Plan OA1 case 8: an agent could take a team's name)
  test("an agent never takes a team's name: a save or a rename that would is refused in words, in any case; its own name kept is no clash", () => {
    const store = createAgentCardStore({ dataDir: null, teamNamed: (name) => (name.trim().toLowerCase() === "builders" ? "Builders" : null) });
    refuses(() => store.create({ ...SECURITY, tag: "meth", name: "builders" }), 400, /^A team is called Builders: an agent and a team never share a name — pick another\.$/);
    refuses(() => store.create({ tag: "meth2", from: "buildlead" }), 400, /^A team is called Builders/);
    store.create(SECURITY);
    refuses(() => store.update("security", { name: "Builders" }), 400, /^A team is called Builders/);
    assert.equal(store.update("security", { name: "Security" }).name, "Security");
    assert.deepEqual(store.list().filter((c) => !c.shipped).map((c) => c.tag), ["security"], "nothing was saved by a refused save");
  });

  test("a save the disk refuses changes nothing in the store", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      // A folder where the file goes: the rename cannot land.
      mkdirSync(join(dir, AGENT_CARDS_FILE));
      assert.throws(() => store.create(SECURITY));
      assert.equal(store.find("security"), null);
      assert.deepEqual(readdirSync(dir), [AGENT_CARDS_FILE], "the temporary file is gone");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — a card named one model or none, and a shipped card's could not be set: the owner's 10-19 list,
// "assign each specialized agent a model as a priority list")
describe("an agent's models, first choice first, and a shipped agent's set in place", () => {
  test("a card names its models as a list: trimmed, `agent/` dropped, none twice, six at most; `model` is the first, and one model is a list of one", () => {
    const store = createAgentCardStore({ dataDir: null });
    const made = store.create({ ...SECURITY, models: [" zai/glm-5.3 ", "agent/kimi/kimi-k3", "ZAI/GLM-5.3", ""] });
    assert.deepEqual([made.models, made.model], [["zai/glm-5.3", "kimi/kimi-k3"], "zai/glm-5.3"]);
    assert.deepEqual(store.update("security", { model: "m-1" }).models, ["m-1"], "one model is a list of one");
    const none = store.update("security", { models: [] });
    assert.deepEqual([none.models, none.model], [[], null], "none: the session's Seats");
    refuses(() => store.update("security", { model: "a", models: ["b"] }), 400, /Give an agent's models \(first choice first\) or one model, not both\./);
    refuses(() => store.update("security", { models: ["a", "b", "c", "d", "e", "f", "g"] }), 400, /An agent names up to 6 models, first choice first \(this has 7\)\./);
    refuses(() => store.update("security", { models: "m-1" }), 400, /models must be a list of model names, first choice first/);
    refuses(() => store.update("security", { models: ["a\nb"] }), 400, /Each of an agent's models is a model's name, on one line\./);
    assert.deepEqual(store.create({ from: "security", tag: "sec2", models: ["x", "y"] }).models, ["x", "y"]);
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a card's models were
  // names alone)
  test("a card's models may each say how hard it thinks on it: kept beside them, written and read back, copied, given anew with them; one that is no effort is refused", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      const made = store.create({ ...SECURITY, models: [{ model: " agent/zai/glm-5.3 ", effort: "high" }, "kimi/kimi-k3", { model: "m-3" }] });
      assert.deepEqual([made.models, made.model, made.efforts], [["zai/glm-5.3", "kimi/kimi-k3", "m-3"], "zai/glm-5.3", { "zai/glm-5.3": "high" }]);
      const onDisk = JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"));
      assert.deepEqual([onDisk.agents.security.models, onDisk.agents.security.efforts], [["zai/glm-5.3", "kimi/kimi-k3", "m-3"], { "zai/glm-5.3": "high" }]);
      assert.deepEqual(createAgentCardStore({ dataDir: dir }).find("security")?.efforts, { "zai/glm-5.3": "high" }, "read back");
      assert.deepEqual(store.create({ from: "security", tag: "sec2" }).efforts, { "zai/glm-5.3": "high" }, "a copy takes them");
      assert.deepEqual(store.update("security", { models: ["zai/glm-5.3"] }).efforts, {}, "models given anew: their efforts with them");
      assert.ok(!("efforts" in JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8")).agents.security), "none: none written");
      refuses(() => store.update("security", { models: [{ model: "a", effort: "huge" }] }), 400, /^Each model's effort is one of model, low, medium, high, xhigh, max/);
      refuses(() => store.update("security", { models: [{ name: "a" }] }), 400, /models must be a list of model names, first choice first/);
      // (fails before: yes — the review of 11-05: a level that is no effort was dropped in silence when given as efforts)
      refuses(() => store.update("security", { efforts: { "zai/glm-5.3": "huge" } }), 400, /^Each model's effort is one of model, low, medium, high, xhigh, max/);
      const pm = store.update("product", { models: [{ model: "m-1", effort: "low" }] });
      assert.deepEqual([pm.efforts, pm.set], [{ "m-1": "low" }, ["models", "efforts"]]);
      assert.deepEqual(createAgentCardStore({ dataDir: dir }).find("product")?.efforts, { "m-1": "low" }, "a shipped card's, read back");
      // (fails before: yes — the review of 11-05: a file's level that is no effort set its whole card aside, and a
      // shipped card's whole efforts, where a save refuses it alone)
      const file = join(dir, AGENT_CARDS_FILE);
      const raw = JSON.parse(readFileSync(file, "utf8"));
      Object.assign(raw.agents.security, { models: ["zai/glm-5.3", "kimi/kimi-k3"], efforts: { "zai/glm-5.3": "huge", "kimi/kimi-k3": "low" } });
      Object.assign(raw.shipped.product, { models: ["m-1", "m-2"], efforts: { "m-1": "low", "m-2": "huge" } });
      writeFileSync(file, JSON.stringify(raw));
      const read = createAgentCardStore({ dataDir: dir });
      assert.deepEqual([read.find("security")?.efforts, read.find("product")?.efforts], [{ "kimi/kimi-k3": "low" }, { "m-1": "low" }], "that one alone dropped");
      const back = store.update("product", { models: null });
      assert.deepEqual([back.models, back.efforts, back.set], [[], {}, []], "put back as it ships, its efforts with its models");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shipped agent's models and what it sees are set on it, kept in the file beside yours, read back, and put back as it ships", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      const pm = store.update("product", { models: ["m-1", "m-2"] });
      assert.deepEqual([pm.shipped, pm.name, pm.models, pm.model, pm.set], [true, "Product", ["m-1", "m-2"], "m-1", ["models"]]);
      const seen = store.update("product", { sees: { view: "window" } });
      assert.deepEqual([seen.models, seen.sees, seen.set], [["m-1", "m-2"], { view: "window", running: false, changes: null }, ["models", "sees"]], "each part is kept apart");
      assert.deepEqual(store.find("reviewer")?.set, [], "another shipped card is as it ships");
      const onDisk = JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"));
      assert.deepEqual(Object.keys(onDisk.shipped.product), ["models", "sees", "was"]);
      assert.deepEqual([onDisk.agents, onDisk.shipped.product.models, onDisk.shipped.product.sees, Object.keys(onDisk.shipped.product.was)], [{}, ["m-1", "m-2"], { view: "window", running: false, changes: null }, ["models", "sees"]]);
      const again = createAgentCardStore({ dataDir: dir });
      assert.deepEqual(again.find("product"), store.find("product"), "read back as it was set");
      assert.deepEqual(again.create({ from: "product", tag: "pm2" }).models, ["m-1", "m-2"], "a copy takes the card as it stands");
      refuses(() => store.update("product", { name: "Boss", models: [], sees: { view: "fork" } }), 400, /sees\.view must be one of/);
      assert.deepEqual([store.find("product")?.models, store.find("product")?.name], [["m-1", "m-2"], "Product"], "a refused edit changes nothing");
      const back = store.update("product", { sees: null });
      assert.deepEqual([back.sees, back.set], [{ view: "none", running: false, changes: null }, ["models"]], "sees: null puts what it sees back as it ships");
      assert.deepEqual(store.update("product", { sees: { view: "none" } }).set, ["models"], "set to what it ships with, it is as it ships");
      const plain = store.update("product", { models: [] });
      assert.deepEqual([plain.models, plain.model, plain.set], [[], null, []]);
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"))), ["version", "agents"], "nothing of its own left: the file says nothing of it");
      refuses(() => store.remove("product"), 403, /`@product` is a shipped agent: it cannot be deleted\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a card from before the list — one model — is read as a list of one; a shipped set in the file that a save would refuse is skipped and named", () => {
    const dir = folder();
    try {
      const old = { name: "Security", kind: "lead", goodFor: "What an attacker would try first", thinks: "You think as an attacker.", model: "m-old", sees: { view: "folded", running: true, changes: null } };
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: { security: old }, shipped: { product: { models: ["m-1"] }, reviewer: { models: "m-2" }, nobody: { models: ["m-3"] } } }));
      /** @type {string[]} */
      const said = [];
      const store = createAgentCardStore({ dataDir: dir, log: (level, msg) => said.push(`${level}: ${msg}`) });
      assert.deepEqual([store.find("security")?.models, store.find("security")?.model], [["m-old"], "m-old"]);
      assert.deepEqual([store.find("product")?.models, store.find("reviewer")?.models], [["m-1"], []]);
      assert.deepEqual(said, ["warn: agents: 2 agents in agents.json could not be read and were skipped: reviewer (set in place: models), nobody (set in place)"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — HarnessV4_ShippedAgents_Plan SA1, the owner's words of 10-23: "the ability to edit the pre
// existing templates that come with the harness, change their permissions and tools they have access to. i mean
// everything"; a shipped agent's every field but its models and what it sees was a copy's to change)
describe("a shipped agent, yours to change in place (SA1)", () => {
  test("every field but its tag is set on it, in order, each with what it ships as; read back by a new store; a copy starts from it as it stands", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      const words = "You use the app as a user would: start it in your copy, open it in the browser and go through the task.";
      const eu = store.update("enduser", { may: "edit", thinks: words, goodFor: "Goes through the app as a user would", mayRun: ["npm start"], name: "End User" });
      assert.deepEqual([eu.tag, eu.shipped, eu.name, eu.may, eu.thinks, eu.mayRun], ["enduser", true, "End User", "edit", words, ["npm start"]]);
      assert.deepEqual(eu.set, ["name", "goodFor", "thinks", "may", "mayRun"], "in the card's own order");
      assert.deepEqual(eu.ships, { name: "End user", goodFor: SHIPPED_CARDS.enduser.goodFor, thinks: SHIPPED_CARDS.enduser.thinks, may: "copy", mayRun: [] });
      assert.equal(eu.moved, undefined, "nothing Filament moved since");
      assert.deepEqual(createAgentCardStore({ dataDir: dir }).find("enduser"), eu, "read back as it was set");
      const copy = store.create({ from: "enduser", tag: "eu2" });
      assert.deepEqual([copy.name, copy.may, copy.thinks, copy.mayRun, copy.from, "set" in copy], ["End User", "edit", words, ["npm start"], "enduser", false], "the copy is as the card stands, and yours whole");
      // (the owner's word of 11-05: when it starts by itself is no field of a card's any more)
      refuses(() => store.update("reviewer", { starts: "never" }), 400, /^unknown field `starts`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a field given null is put back, reset puts back all, a field set to what it ships with is as it ships; with nothing left the file says nothing of it", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      store.update("reviewer", { name: "Finder", may: "copy", models: ["m-1"] });
      assert.deepEqual(store.update("reviewer", { name: null }).set, ["may", "models"], "one field put back");
      assert.deepEqual(store.update("reviewer", { model: null }).set, ["may"], "model: null puts its models back");
      assert.deepEqual(store.update("reviewer", { may: "read" }).set, [], "set to what it ships with: as it ships");
      store.update("reviewer", { name: "Finder", thinks: "Short." });
      const back = store.update("reviewer", { reset: true });
      assert.deepEqual([back.name, back.thinks, back.set, back.ships], ["Reviewer", SHIPPED_CARDS.reviewer.thinks, [], undefined]);
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"))), ["version", "agents"], "nothing of its own left");
      assert.deepEqual(store.update("reviewer", { reset: true, name: "Finder" }).set, ["name"], "reset first, then the fields given");
      refuses(() => store.update("reviewer", { reset: "yes" }), 400, /^reset is true, or left out/);
      refuses(() => store.update("reviewer", { kind: null }), 400, /^unknown field `kind`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("checked as yours are: its name never a team's, its level fitting its commands; a refused save changes nothing", () => {
    const store = createAgentCardStore({ dataDir: null, teamNamed: (name) => (["methodical", "bughunters"].includes(name.trim().toLowerCase()) ? name.trim() : null) });
    refuses(() => store.update("enduser", { name: "Methodical" }), 400, /^A team is called Methodical: an agent and a team never share a name — pick another\.$/);
    assert.equal(store.update("huntlead", { name: "BugHunters", thinks: "Hunt." }).name, "BugHunters", "the name it ships with is no clash");
    refuses(() => store.update("reviewer", { mayRun: ["npm test"] }), 400, /^Reviewer only reads, so it runs no commands of its own/);
    assert.deepEqual([store.find("enduser")?.name, store.find("reviewer")?.set], ["End user", []]);
  });

  // (SA-D3: your words stay when Filament ships new ones, and the card says so)
  test("a field whose words Filament changed since you set it is told (`moved`); setting your own words again, or putting it back, ends that", () => {
    const dir = folder();
    try {
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: {}, shipped: { product: { thinks: "Mine.", name: "Boss", was: { thinks: "000000000000" } } } }));
      const store = createAgentCardStore({ dataDir: dir });
      const pm = store.find("product");
      assert.deepEqual([pm?.thinks, pm?.set, pm?.moved, pm?.ships?.thinks], ["Mine.", ["name", "thinks"], ["thinks"], SHIPPED_CARDS.product.thinks], "yours kept; Filament's words for it moved; a field read without its hash is not said to");
      assert.deepEqual(store.update("product", { thinks: "Mine.", name: "Boss" }).moved, ["thinks"], "the same words saved again: still told");
      assert.equal(store.update("product", { thinks: "Mine, again." }).moved, undefined, "words of your own set beside Filament's new ones");
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: {}, shipped: { product: { thinks: "Mine.", was: { thinks: "000000000000" } } } }));
      assert.deepEqual(createAgentCardStore({ dataDir: dir }).update("product", { thinks: null }).set, [], "Take Filament's: the field put back");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (case 18)
  // (the owner's word of 11-05: Explainer and Watcher went, and a start set in place with them)
  test("a field of a shipped agent in the file that a save would refuse is skipped and named, the rest kept; commands its level does not fit are put back; the two that went, and a start, are let go unsaid", () => {
    const dir = folder();
    try {
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: {}, shipped: { enduser: { name: "End User", may: "all", thinks: 7 }, watcher: { may: "copy" }, explainer: { starts: "report" }, reviewer: { colour: "red", name: "Finder", starts: "running", mayRun: ["npm test"] } } }));
      /** @type {string[]} */
      const said = [];
      const store = createAgentCardStore({ dataDir: dir, log: (level, msg) => said.push(`${level}: ${msg}`) });
      assert.deepEqual([store.find("enduser")?.name, store.find("enduser")?.may, store.find("enduser")?.set], ["End User", "copy", ["name"]]);
      assert.deepEqual([store.find("watcher"), store.find("explainer")], [null, null]);
      assert.deepEqual([store.find("reviewer")?.set, store.find("reviewer")?.mayRun], [["name"], []]);
      assert.deepEqual(said, ["warn: agents: 2 agents in agents.json could not be read and were skipped: enduser (set in place: may, thinks), reviewer (set in place: colour, mayRun)"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shipped agent's name you set meets the teams' as yours does", () => {
    const teams = [{ key: "methodical", name: "Methodical" }];
    assert.deepEqual(teamClashes([{ tag: "enduser", name: "Methodical", shipped: true, set: ["name"] }, { tag: "product", name: "Product", shipped: true, set: [] }], teams), ["Methodical (@enduser) has the name of the team Methodical: an agent and a team never share a name — rename one on Library › Agents and teams"]);
  });

  // (Builder and Reviewer hold the agent tool's own two places: the tool's words say each one's level as it stands)
  test("Builder or Reviewer whose level is set on it holds its place as it stands, unless the session names it or a copy in its place", () => {
    const store = createAgentCardStore({ dataDir: null });
    const find = (/** @type {string} */ t) => store.find(t);
    assert.deepEqual(placesOf([], find), [], "both as they ship");
    store.update("builder", { may: "read" });
    store.update("reviewer", { name: "Finder" });
    assert.deepEqual(placesOf([], find), [{ tag: "builder", name: "Builder", goodFor: SHIPPED_CARDS.builder.goodFor, may: "read", from: null }], "Reviewer's name alone moves none of the tool's words");
    store.create({ from: "builder", tag: "mybuilder" });
    assert.deepEqual(placesOf(askablesOf(["mybuilder"], find), find), [], "a copy the session names holds the place");
    assert.deepEqual(placesOf(askablesOf(["builder"], find), find), [], "named, it is the session's");
    const kinds = launchKinds([], placesOf([], find));
    assert.deepEqual(kinds.own.map((o) => [o.tag, o.may]), [["builder", "read"], ["reviewer", "read"]]);
    assert.deepEqual(launchKinds(askablesOf(["builder"], find)).own[0].may, "read", "a session naming it: as it stands");
    assert.deepEqual(kinds.named, [], "asked by nobody");
  });
});

// (fails before: yes — HarnessV4_ShippedAgents_Plan SA2, the owner's words of 10-23: "change their permissions and tools
// they have access to"; no agent had a tool list of its own)
describe("the tools an agent goes without (SA2)", () => {
  test("any agent's, in their order, each once; kept in the file only where it goes without one; a copy takes them; a shipped agent's set in place and put back", () => {
    const dir = folder();
    try {
      const store = createAgentCardStore({ dataDir: dir });
      assert.deepEqual([...CARD_TOOLS], ["shell", "browser", "web", "mcp", "visuals", "space"]);
      assert.deepEqual(store.create({ ...SECURITY, toolsOff: ["space", "web", "web"] }).toolsOff, ["web", "space"]);
      store.create({ ...SECURITY, tag: "plain" });
      const onDisk = JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"));
      assert.deepEqual([onDisk.agents.security.toolsOff, "toolsOff" in onDisk.agents.plain], [["web", "space"], false]);
      assert.deepEqual(createAgentCardStore({ dataDir: dir }).find("security")?.toolsOff, ["web", "space"], "read back");
      assert.deepEqual(store.create({ from: "security", tag: "sec2" }).toolsOff, ["web", "space"]);
      const eu = store.update("enduser", { toolsOff: ["web"] });
      assert.deepEqual([eu.toolsOff, eu.set, eu.ships?.toolsOff], [["web"], ["toolsOff"], []]);
      assert.deepEqual(store.update("enduser", { toolsOff: null }).toolsOff, [], "put back: every tool");
      assert.deepEqual(store.find("product")?.toolsOff, [], "as it ships: none off");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the loop's tools each switch takes away; a fork, which keeps the main agent's tools, has them refused in words", () => {
    assert.deepEqual(Object.keys(CARD_TOOL_NAMES), [...CARD_TOOLS], "a list for every switch");
    assert.deepEqual(cardOffTools(["shell", "visuals"]), ["bash", "bash_background", "bash_output", "bash_kill", "powershell", "run_check", "show_visual", "visual_guide", "artifact"]);
    assert.deepEqual([cardOffTools(["mcp"]), cardOffTools(null)], [[], []], "the MCP servers are no names: the turn leaves them out");
    const refused = cardRefusals({ name: "End user", toolsOff: ["web", "mcp"] }, [{ name: "read" }, { name: "mcp__docs__search" }, { name: "web_fetch" }]);
    assert.deepEqual(Object.keys(refused), ["web_fetch", "web_search", "mcp__docs__search"]);
    assert.equal(refused.web_fetch, "Not run: End user goes without this tool — the developer switched it off on its card. Carry on without it.");
    assert.deepEqual(cardRefusals({ name: "x", toolsOff: [] }, [{ name: "bash" }]), {});
  });
});

// (fails before: yes — saved agents did not exist)
describe("the file, read at start", () => {
  /** @param {string} text */
  const startWith = (text) => {
    const dir = folder();
    writeFileSync(join(dir, AGENT_CARDS_FILE), text);
    /** @type {string[]} */
    const said = [];
    const store = createAgentCardStore({ dataDir: dir, log: (level, msg) => said.push(`${level}: ${msg}`) });
    return { dir, store, said };
  };

  // (r-itself, 11-12: a file of another version was started empty over the same way, and written over at the next save;
  // it is set aside under its version's name before anything is — test/store-files.test.js)
  test("a broken file, or one that names no version, starts with no saved agents and says so; it is not written over until a save. One of another build's version is set aside whole, never written over", () => {
    for (const [text, why] of /** @type {const} */ ([["{ nope", /could not be read \(/], [JSON.stringify({ agents: {} }), /it is not a version 1 agents file/]])) {
      const { dir, store, said } = startWith(text);
      try {
        assert.deepEqual(store.list().map((c) => c.tag), Object.keys(SHIPPED_CARDS));
        assert.equal(said.length, 1);
        assert.match(said[0], /^warn: agents: agents\.json could not be read/);
        assert.match(said[0], why);
        assert.equal(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8"), text);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const text = JSON.stringify({ version: 2, agents: {} });
    const { dir, store, said } = startWith(text);
    try {
      assert.deepEqual(store.list().map((c) => c.tag), Object.keys(SHIPPED_CARDS));
      assert.equal(said.length, 1);
      const aside = /^warn: agents: agents\.json is version 2, which this Filament does not read \(it reads version 1\): another build of Filament saved it\. It is kept beside it as (agents\.json\.v2\.\d{8}T\d{6}Z), with nothing saved over it, and this build starts with no saved agents\./.exec(said[0])?.[1];
      assert.ok(aside, said[0]);
      assert.equal(readFileSync(join(dir, String(aside)), "utf8"), text);
      assert.equal(existsSync(join(dir, AGENT_CARDS_FILE)), false, "nothing in place to save over");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an agent in it that a save would refuse is kept as saved, unused, and named; the rest are read, a `kind` from before not read (OA1 case 11)", () => {
    const good = { name: "Security", kind: "lead", goodFor: "What an attacker would try first", thinks: "You think as an attacker.", model: null, sees: { view: "folded", running: true, changes: null } };
    const { dir, store, said } = startWith(JSON.stringify({ version: 1, agents: { security: good, product: good, "Bad Tag": good, oldkind: { ...good, kind: "boss" }, noview: { ...good, sees: {} } } }));
    try {
      assert.deepEqual(store.list().filter((c) => !c.shipped).map((c) => c.tag), ["security", "oldkind"]);
      assert.equal("kind" in /** @type {any} */ (store.find("oldkind")), false, "its kind is not read");
      assert.equal(store.find("product")?.shipped, true, "a shipped agent's tag is the shipped agent's");
      // (the review of 11-03: kept as saved, not skipped — roster-shrink.test.js)
      assert.deepEqual(said, ["warn: agents: 3 agents of yours in agents.json cannot be used now, kept as saved until you delete them or make them again — Library › Agents says why: product, Bad Tag, noview"]);
      assert.deepEqual(store.held().map((h) => h.tag), ["product", "Bad Tag", "noview"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the owner's word of 10-31 took the views Digests, Folded newest 2 whole and Whole away, and an
  // agent saved with one was skipped whole, its words and models with it)
  test("an agent saved with a view Filament no longer offers sees nothing of the session, and keeps the rest of its card", () => {
    const old = { name: "Security", goodFor: "What an attacker would try first", thinks: "You think as an attacker.", models: ["m-1"], sees: { view: "moderate", running: true, changes: "turn" } };
    const { dir, store, said } = startWith(JSON.stringify({ version: 1, agents: { security: old, auditor: { ...old, sees: { view: "session", running: false, changes: null } } } }));
    try {
      const c = store.find("security");
      assert.deepEqual([c?.thinks, c?.models, c?.sees], [old.thinks, ["m-1"], { view: "none", running: true, changes: "turn" }]);
      assert.deepEqual(store.find("auditor")?.sees, { view: "none", running: false, changes: null });
      assert.deepEqual(said, [], "nothing skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — Hunter's of 10-31: the read of a shipped card set in place took no such view, so its whole Sees
  // was skipped, the turn running now and the change with it, and the card went back to its shipped Sees)
  test("a shipped agent set in place with a view Filament no longer offers sees nothing of the session, and keeps the rest of what it sees", () => {
    const { dir, store, said } = startWith(JSON.stringify({ version: 1, agents: {}, shipped: { reviewer: { sees: { view: "moderate", running: true, changes: "turn" } } } }));
    try {
      assert.deepEqual(store.find("reviewer")?.sees, { view: "none", running: true, changes: "turn" });
      assert.deepEqual(said, [], "nothing skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no file: no saved agents, nothing said, and none is made until a save", () => {
    const dir = folder();
    try {
      /** @type {string[]} */
      const said = [];
      const store = createAgentCardStore({ dataDir: dir, log: (_l, m) => said.push(m) });
      assert.equal(store.list().length, 6);
      assert.deepEqual([said, existsSync(join(dir, AGENT_CARDS_FILE))], [[], false]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — the bug round of 10-23: an agents file written by hand was read before the teams, and a name or a
// tag it shared with a team went unsaid)
test("an agents file that meets the teams is said, with what to rename; nothing of it is dropped", () => {
  const lines = teamClashes(
    [
      { tag: "mine", name: "Hunters" },
      { tag: "ok", name: "Fine" },
      { tag: "buildlead", name: "Builders", shipped: true, partOf: "builders" },
    ],
    [
      { key: "mine", name: "Mine" },
      { key: "hunters", name: "Hunters" },
      { key: "builders", name: "Builders" },
    ],
  );
  assert.deepEqual(lines, [
    "Hunters (@mine) has the name of the team Hunters: an agent and a team never share a name — rename one on Library › Agents and teams",
    "@mine (Hunters) is the key of the team Mine: @ names either — give the agent another tag on Library › Agents and teams",
  ]);
});
