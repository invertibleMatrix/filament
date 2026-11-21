// @ts-check
// HarnessV3-AtHome P2 step 2 (AH-O2), HarnessV4_Tasks E15 step 6: teams as data. A team is a saved group of cards — the
// lead card in charge, and the worker cards it hands work to, each with the team's own line for that member. Two ship
// with Filament (the plan's p6: Builders, whose lead leads one way, and BugHunters, which finds bugs and checks
// claims); your own are
// saved in teams.json in the data folder, version 2. What a team is handed out with is read from its cards as they
// stand. Every refusal is said in words, with the status the admin API answers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED_MEMBERS, isShippedRoster } from "../src/core/roster.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { SHIPPED_TEAMS, TEAMS_FILE, TEAM_LIMITS, teamKey } from "../src/services/teams.js";
import { teamStore } from "./helpers/team.js";

const folder = () => mkdtempSync(join(tmpdir(), "filament-teams-"));
/** @param {() => any} fn @param {number} status @param {RegExp} words */
const refuses = (fn, status, words) =>
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.equal(e.status, status, e.message);
    assert.match(e.message, words);
    return true;
  });
/** A team of yours as a save names it: Product in charge of a builder and a reviewer. */
const MINE = { name: "Mine", lead: "product", members: [{ tag: "builder", line: "Touch only the files named." }, { tag: "reviewer" }] };

// (fails before: yes — teams did not exist)
describe("the shipped teams", () => {
  // (fails before: yes — HarnessV4_Tasks E15 step 6: a team held a persona and four fixed roles of its own, no card)
  test("two, in order, each a lead card in charge and its members with the team's line for each; read-only copies", () => {
    const store = teamStore();
    // (fails before: yes — the plan's p6: four teams built, 10x Engineer, Methodical, Architect and One-Shot, each led by
    // a Lead of its own; one team builds, Builders, its lead leading one way)
    assert.deepEqual(Object.keys(SHIPPED_TEAMS), ["builders", "bughunters"]);
    assert.deepEqual(store.list().map((t) => [t.key, t.name, t.lead, t.shipped]), [
      ["builders", "Builders", { tag: "buildlead", name: "Builders" }, true],
      // (fails before: yes — team_v2_plan §5.6: the two that find and check, each one member its lead launches as often as it needs)
      // (the plan's p6: one team finds and checks, BugHunters, a Hunter's seat and a Checker's)
      ["bughunters", "BugHunters", { tag: "huntlead", name: "BugHunters" }, true],
    ]);
    assert.deepEqual(store.list().filter((t) => t.readOnly).map((t) => [t.key, t.members.map((m) => [m.tag, m.may])]), [["bughunters", [["hunter", "read"], ["checker", "read"]]]]);
    for (const t of store.list().filter((x) => !x.readOnly)) {
      const lead = SHIPPED_CARDS[/** @type {keyof typeof SHIPPED_CARDS} */ (t.lead.tag)];
      // (fails before: yes — OA-D4: a team's head was a lead anyone could ask; it is its team's own Lead, part of it)
      assert.deepEqual([/** @type {any} */ (lead).partOf, t.persona, t.line], [t.key, lead.thinks, lead.goodFor], `${t.key}: its Lead's words are its card's, and the card is part of it`);
      assert.ok(t.persona.length > 100 && t.persona.length < 1500, `${t.key}'s lead's words are two paragraphs`);
      assert.ok(isShippedRoster(t.members), `${t.key}: the four members every shipped team has`);
      // Reviewer seated as the Scout, Builder, Builder seated as the Tester, Reviewer ("Teams, improved and kept" of 11-03).
      assert.deepEqual(t.members.map((m) => [m.tag, m.card ?? null, m.name]), [["scout", "reviewer", "Scout"], ["builder", null, "Builder"], ["tester", "builder", "Tester"], ["reviewer", null, "Reviewer"]], `${t.key}: its seats`);
      for (const m of t.members) {
        const tag = m.card ?? m.tag;
        const card = SHIPPED_CARDS[/** @type {keyof typeof SHIPPED_CARDS} */ (tag)];
        assert.deepEqual([m.goodFor, m.may, m.place, m.model], [card.goodFor, /** @type {any} */ (card).may, tag, null], `${t.key}.${m.tag}: read from its card`);
        assert.ok(m.line.length > 20, `${t.key} adds words for ${m.tag}`);
      }
      assert.equal(teamKey(t.name), t.key, "a shipped team's key is its name's");
    }
    assert.deepEqual(store.find("builders")?.members.map((m) => [m.tag, m.may]), [["scout", "read"], ["builder", "edit"], ["tester", "edit"], ["reviewer", "read"]]);
    const copy = /** @type {any} */ (store.find("builders"));
    copy.persona = "changed";
    copy.members[1].line = "changed";
    copy.members.pop();
    assert.notEqual(store.find("builders")?.persona, "changed", "what the store hands out never changes the team");
    assert.deepEqual([store.find("builders")?.members.length, store.find("builders")?.members[1].line === "changed"], [4, false], "nor its members");
  });

  test("a name finds its team: the key, else the name without case", () => {
    const store = teamStore();
    assert.equal(store.find("builders")?.key, "builders");
    assert.equal(store.find("BugHunters")?.key, "bughunters");
    assert.equal(store.find("BUGHUNTERS")?.key, "bughunters");
    assert.equal(store.find("  builders ")?.key, "builders");
    assert.equal(store.find("nobody"), null);
    assert.equal(store.find("methodical"), null, "a team Filament does not ship is no team");
    assert.deepEqual([store.find("Bug Hunter"), store.find("verifier")], [null, null], "nor one BugHunters took in: an old key is never converted");
    assert.equal(store.find(""), null);
    assert.equal(store.find("off"), null, "a word /team reads as its own names no team");
  });

  test("a team's key: its name lower-cased, each run of other characters one dash; never a word /team reads as its own", () => {
    assert.equal(teamKey("My Strict Team"), "my-strict-team");
    assert.equal(teamKey("  Fast & Loose!  "), "fast-loose");
    assert.equal(teamKey("off"), null);
    assert.equal(teamKey("Help"), null);
    assert.equal(teamKey("list"), null);
    // (fails before: yes — validate and autonomous were /team's words for how a team's orders went out; a team may be
    // keyed by either now)
    assert.equal(teamKey("Validate"), "validate");
    assert.equal(teamKey("autonomous"), "autonomous");
    assert.equal(teamKey("!!!"), null);
    assert.equal(teamKey(""), null);
    assert.equal(teamKey("x".repeat(41)), null, "40 characters at most");
  });
});

// (fails before: yes — a team's line was cut from a persona of its own; it is its lead card's "good for" now, read as
// the card stands)
test("each team has one line that says how it works: its lead card's \"good for\", read as the card stands and never written to the file", () => {
  const dir = folder();
  try {
    const store = teamStore({ dataDir: dir });
    assert.deepEqual(store.list().map((t) => [t.key, t.line]), [
      ["builders", "Builds it with its workers: planned, run in parallel where it can, each claim checked"],
      ["bughunters", "Finds bugs and checks claims, fixing nothing: each finding checked against the code"],
    ]);
    store.cards.create({ tag: "careful", name: "Careful One", goodFor: "Read twice, write once", thinks: "You lead carefully." });
    const made = store.create({ name: "Careful", lead: "careful", members: [{ tag: "builder" }] });
    assert.deepEqual([made.line, made.persona, made.lead], ["Read twice, write once", "You lead carefully.", { tag: "careful", name: "Careful One" }]);
    store.cards.update("careful", { goodFor: "Ship small things", name: "Very Careful" });
    assert.deepEqual([store.find("careful")?.line, store.find("careful")?.lead.name], ["Ship small things", "Very Careful"], "the card's change reaches the team");
    assert.equal(store.update("careful", { lead: "product" }).line, SHIPPED_CARDS.product.goodFor, "another lead, another line");
    assert.equal(teamStore({ dataDir: dir }).find("careful")?.line, SHIPPED_CARDS.product.goodFor, "read back from the file, made again");
    const disk = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8"));
    assert.deepEqual(Object.keys(disk.teams.careful).sort(), ["createdAt", "from", "lead", "members", "name", "updatedAt"], "the file holds the tags and the team's own lines alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — teams did not exist)
describe("your teams", () => {
  // (fails before: yes — HarnessV4_Tasks E15 step 6: the file was version 1, a persona and roles)
  test("a saved team round-trips through teams.json, version 2, and the next store reads it back", () => {
    const dir = folder();
    try {
      let t = 1000;
      const store = teamStore({ dataDir: dir, now: () => t });
      const made = store.create({ name: "My Strict Team", lead: "@Product", members: [{ tag: "Builder", line: "  Touch only the files named. " }, { tag: "@reviewer" }] });
      assert.deepEqual(made, {
        key: "my-strict-team",
        name: "My Strict Team",
        line: SHIPPED_CARDS.product.goodFor,
        lead: { tag: "product", name: "Product" },
        persona: SHIPPED_CARDS.product.thinks,
        members: [
          { tag: "builder", name: "Builder", goodFor: SHIPPED_CARDS.builder.goodFor, may: "edit", place: "builder", line: "Touch only the files named.", model: null },
          { tag: "reviewer", name: "Reviewer", goodFor: SHIPPED_CARDS.reviewer.goodFor, may: "read", place: "reviewer", line: "", model: null },
        ],
        models: [],
        efforts: {},
        leadModels: [],
        leadEfforts: {},
        leadModel: null,
        readOnly: false,
        fired: { notify: false, verify: false },
        // (the plan's p6: its check — none named)
        check: null,
        shipped: false,
        from: null,
        createdAt: 1000,
        updatedAt: 1000,
      });
      const disk = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8"));
      assert.equal(disk.version, 2);
      assert.deepEqual(disk.teams, { "my-strict-team": { name: "My Strict Team", lead: "product", members: [{ tag: "builder", line: "Touch only the files named." }, { tag: "reviewer", line: "" }], from: null, createdAt: 1000, updatedAt: 1000 } }, "the file holds your teams alone, as tags and lines");
      t = 2000;
      const edited = store.update("my-strict-team", { name: "Strict", lead: "enduser" });
      assert.equal(edited.key, "my-strict-team", "the key stays: sessions name a team by it");
      assert.deepEqual([edited.name, edited.lead.tag, edited.createdAt, edited.updatedAt], ["Strict", "enduser", 1000, 2000]);
      assert.deepEqual(edited.members.map((m) => [m.tag, m.line]), [["builder", "Touch only the files named."], ["reviewer", ""]], "members left out stay as they were");
      const again = teamStore({ dataDir: dir });
      assert.deepEqual(again.find("my-strict-team"), edited);
      // (fails before: yes — team_v2_plan TV2-D8: a team named no models of its own) Its workers' models, in order: kept
      // in the file only where it names them, read back the same.
      t = 3000;
      const named = store.update("my-strict-team", { models: ["GLM 5.3 Flash", " kimi-k3 "] });
      assert.deepEqual(named.models, ["GLM 5.3 Flash", "kimi-k3"]);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams["my-strict-team"].models, ["GLM 5.3 Flash", "kimi-k3"]);
      assert.deepEqual(teamStore({ dataDir: dir }).find("my-strict-team"), named);
      const cleared = store.update("my-strict-team", { models: [] });
      assert.deepEqual(cleared.models, []);
      const disk2 = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams["my-strict-team"];
      assert.equal("models" in disk2, false, "none named: nothing kept");
      assert.deepEqual(store.find("builders")?.models, [], "the teams that ship name no model: a model one person has, another may not");
      assert.deepEqual(again.list().map((x) => x.key), ["builders", "bughunters", "my-strict-team"]);
      assert.equal(again.find("strict")?.key, "my-strict-team", "found by its new name");
      assert.deepEqual(again.update("my-strict-team", { members: [{ tag: "reviewer", name: "Scout", line: "Look first." }] }).members.map((m) => [m.tag, m.line]), [["scout", "Look first."]], "members given replace the team's");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a member is a card of yours too: its name, what it may do, its model and its place — the shipped card it was copied from", () => {
    const store = teamStore();
    store.cards.create({ from: "builder", tag: "translator", name: "Translator", goodFor: "Puts the docs into another language", model: "zai/glm-5.3" });
    store.cards.create({ from: "reviewer", tag: "proof", name: "Proofreader" });
    store.cards.create({ tag: "runner", name: "Runner", may: "copy", goodFor: "Runs things in its own copy" });
    const docs = store.create({ name: "Docs", lead: "product", members: [{ tag: "translator" }, { tag: "proof" }, { tag: "runner" }] });
    assert.deepEqual(docs.members.map((m) => [m.tag, m.name, m.may, m.place, m.model]), [
      ["translator", "Translator", "edit", "builder", "zai/glm-5.3"],
      ["proof", "Proofreader", "read", "reviewer", null],
      ["runner", "Runner", "copy", null, null],
    ]);
    assert.equal(isShippedRoster(docs.members), false, "its lead reads words written from these cards");
    assert.deepEqual(SHIPPED_MEMBERS, ["scout", "builder", "tester", "reviewer"]);
  });

  test("Duplicate: a shipped or saved team's lead and members under a new name; with no name, the source's name and copy", () => {
    const store = teamStore();
    const arch = /** @type {any} */ (store.find("builders"));
    const dup = store.create({ from: "Builders" });
    assert.deepEqual([dup.key, dup.name, dup.from, dup.lead, dup.persona, dup.members], ["builders-copy", "Builders copy", "builders", arch.lead, arch.persona, arch.members]);
    assert.equal(store.create({ from: "builders" }).name, "Builders copy 2");
    const own = store.create({ from: "builders", name: "Boundaries", lead: "product" });
    assert.deepEqual([own.lead.tag, own.members], ["product", arch.members], "what the body says wins; the rest is the source's");
    assert.equal(store.create({ from: "boundaries", name: "Boundaries Two" }).from, "boundaries", "a saved team duplicates too");
    refuses(() => store.create({ from: "nobody" }), 404, /^There is no team called `nobody` to duplicate/);
  });

  // (fails before: yes — a Duplicate of a team whose name was as long as a name may be never ended: each name it tried
  // was cut back to the source's, which is taken)
  test("Duplicate of a team whose name is as long as a name may be: the source's name is cut to make room, never the copy", () => {
    const store = teamStore();
    const long = `${"A".repeat(36)} Ops`;
    store.create({ ...MINE, name: long });
    const dup = store.create({ from: long });
    assert.deepEqual([dup.name, dup.name.length, dup.key], [`${"A".repeat(35)} copy`, 40, `${"a".repeat(35)}-copy`]);
    assert.equal(store.create({ from: long }).name, `${"A".repeat(33)} copy 2`);
    const spaced = `${"B".repeat(34)} ${"C".repeat(5)}`;
    store.create({ ...MINE, name: spaced });
    assert.equal(store.create({ from: spaced }).name, `${"B".repeat(34)} copy`, "a cut that ends in a space leaves no double space");
  });

  test("a team you saved is yours to delete; a shipped one is not, and neither is a team nobody made", () => {
    const store = teamStore();
    store.create(MINE);
    assert.equal(store.remove("mine").key, "mine");
    assert.equal(store.find("mine"), null);
    refuses(() => store.remove("mine"), 404, /^There is no team `mine`/);
    refuses(() => store.remove("builders"), 403, /^`builders` is a shipped team: it cannot be deleted/);
    refuses(() => store.update("nobody", { lead: "product" }), 404, /^There is no team `nobody`/);
  });

  // (fails before: yes — a team that ships was read-only whole, its models fixed in the code: Opus for the Bug Hunter's
  // lead, GLM 5.3 Flash for its hunters, with no way to change them but a Duplicate)
  test("a team that ships: how it runs is yours to set and kept apart, set back to what ships it is dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-teams-tuned-"));
    try {
      const store = teamStore({ dataDir: dir });
      const ships = store.find("bughunters");
      assert.deepEqual([ships?.models, ships?.leadModel, ships?.readOnly, ships?.tuned], [[], null, true, false], "it ships naming no model");
      const set = store.update("bughunters", { models: ["GLM 5.3 Flash"], leadModel: "Claude Opus 5.5" });
      assert.deepEqual([set.name, set.lead.tag, set.models, set.leadModel, set.readOnly, set.tuned], ["BugHunters", "huntlead", ["GLM 5.3 Flash"], "Claude Opus 5.5", true, true]);
      const disk = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8"));
      assert.deepEqual([disk.version, disk.teams, disk.shipped], [2, {}, { bughunters: { models: ["GLM 5.3 Flash"], leadModels: ["Claude Opus 5.5"] } }], "kept apart, only what you set");
      const again = teamStore({ dataDir: dir }).find("bughunters");
      assert.deepEqual([again?.models, again?.leadModel, again?.tuned], [["GLM 5.3 Flash"], "Claude Opus 5.5", true], "the next store reads it back");
      assert.equal(store.list().find((t) => t.key === "bughunters")?.leadModel, "Claude Opus 5.5", "the list hands it out as set");
      refuses(() => store.update("bughunters", { name: "Hunters", members: [] }), 400, /^A team needs at least one worker\./);
      assert.equal(store.find("bughunters")?.name, "BugHunters", "a refused save changes nothing");
      refuses(() => store.update("bughunters", { models: "GLM" }), 400, /^models must be a list/);
      refuses(() => store.remove("bughunters"), 403, /cannot be deleted/);
      // Set back to what ships, each field goes from the file; the last, the entry with it.
      const half = store.update("bughunters", { readOnly: true });
      assert.deepEqual(JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).shipped, { bughunters: { models: ["GLM 5.3 Flash"], leadModels: ["Claude Opus 5.5"] } }, "a field equal to what ships is not kept");
      assert.deepEqual(["most" in half, "total" in half], [false, false], "a team caps nothing of its own");
      const back = store.update("bughunters", { models: [], leadModel: null });
      assert.deepEqual([back.models, back.leadModel, back.tuned], [[], null, false]);
      assert.equal("shipped" in JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")), false, "nothing set: nothing kept");
      // A Duplicate takes what you set.
      store.update("bughunters", { leadModel: "Kimi K3" });
      assert.equal(store.create({ from: "bughunters" }).leadModel, "Kimi K3");
      // A file whose entry a save would refuse: that entry skipped, the rest read.
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: {}, shipped: { builders: { leadModel: "Kimi K3" }, bughunters: { models: "nope" }, nobody: { most: 2 } } }));
      /** @type {string[]} */
      const warned = [];
      const read = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => warned.push(m) });
      assert.deepEqual([read.find("builders")?.leadModel, read.find("bughunters")?.models], ["Kimi K3", []]);
      assert.match(warned.join("\n"), /2 teams in teams\.json could not be read and were skipped: shipped bughunters \(models\), shipped nobody/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a team's models were
  // names alone)
  test("a team's model may say how hard its agent thinks on it: kept as its list's efforts, read back, put back with its models; a word that is no effort refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-teams-efforts-"));
    try {
      const store = teamStore({ dataDir: dir });
      const made = store.create({ ...MINE, models: [{ model: " GLM 5.3 Flash ", effort: "low" }, "Kimi K3"], leadModels: [{ model: "Claude Opus 5.5", effort: "high" }, { model: "Kimi K3" }] });
      assert.deepEqual([made.models, made.efforts, made.leadModels, made.leadEfforts, made.leadModel], [["GLM 5.3 Flash", "Kimi K3"], { "GLM 5.3 Flash": "low" }, ["Claude Opus 5.5", "Kimi K3"], { "Claude Opus 5.5": "high" }, "Claude Opus 5.5"]);
      const disk = () => JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8"));
      const kept = disk().teams.mine;
      assert.deepEqual([kept.models, kept.efforts, kept.leadModels, kept.leadEfforts], [["GLM 5.3 Flash", "Kimi K3"], { "GLM 5.3 Flash": "low" }, ["Claude Opus 5.5", "Kimi K3"], { "Claude Opus 5.5": "high" }], "the file keeps names, and each one's effort beside them");
      assert.deepEqual(teamStore({ dataDir: dir }).find("mine"), made, "read back");
      // Its models given anew as names: each thinks as the main agent does, its lead's left as they were.
      const plain = store.update("mine", { models: ["Kimi K3"] });
      assert.deepEqual([plain.models, plain.efforts, plain.leadEfforts], [["Kimi K3"], {}, { "Claude Opus 5.5": "high" }]);
      assert.equal("efforts" in disk().teams.mine, false, "none: nothing kept");
      assert.deepEqual(store.update("mine", { leadModel: "Kimi K3" }).leadEfforts, {}, "one model for its lead: its effort the main agent's");
      refuses(() => store.update("mine", { models: [{ model: "Kimi K3", effort: "huge" }] }), 400, /^Each model's effort is one of model, low, medium, high, xhigh, max: how hard the agent thinks on it — or left out, the main agent's\.$/);
      refuses(() => store.update("mine", { leadModels: [{ model: "Kimi K3", effort: "huge" }] }), 400, /^Each model's effort is one of /);
      refuses(() => store.update("mine", { models: [{ model: "Kimi K3", seats: 2 }] }), 400, /^Each of a team's models is a model's name/);
      // (fails before: yes — the review of 11-05: a level that is no effort was dropped in silence when given as efforts)
      refuses(() => store.update("mine", { efforts: { "Kimi K3": "huge" } }), 400, /^Each model's effort is one of /);
      // A team that ships: set apart as any field is; put back with its models.
      const set = store.update("bughunters", { models: [{ model: "GLM 5.3 Flash", effort: "xhigh" }], leadModels: [{ model: "Claude Opus 5.5", effort: "low" }] });
      assert.deepEqual([set.efforts, set.leadEfforts, set.set], [{ "GLM 5.3 Flash": "xhigh" }, { "Claude Opus 5.5": "low" }, ["models", "efforts", "leadModels", "leadEfforts"]]);
      assert.deepEqual(disk().shipped.bughunters, { models: ["GLM 5.3 Flash"], efforts: { "GLM 5.3 Flash": "xhigh" }, leadModels: ["Claude Opus 5.5"], leadEfforts: { "Claude Opus 5.5": "low" } });
      assert.deepEqual(teamStore({ dataDir: dir }).find("bughunters"), store.find("bughunters"), "read back as it was set");
      // (fails before: yes — the review of 11-05: a file's level that is no effort held its whole team, and a shipped
      // team's whole efforts, where a save refuses it alone)
      const raw = disk();
      Object.assign(raw.teams.mine, { models: ["GLM 5.3 Flash", "Kimi K3"], efforts: { "GLM 5.3 Flash": "low", "Kimi K3": "huge" } });
      Object.assign(raw.shipped.bughunters, { models: ["GLM 5.3 Flash", "Kimi K3"], efforts: { "GLM 5.3 Flash": "xhigh", "Kimi K3": "huge" } });
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify(raw));
      const read = teamStore({ dataDir: dir });
      assert.deepEqual([read.find("mine")?.efforts, read.find("bughunters")?.efforts], [{ "GLM 5.3 Flash": "low" }, { "GLM 5.3 Flash": "xhigh" }], "that one alone dropped");
      const back = store.update("bughunters", { models: null, leadModel: null });
      assert.deepEqual([back.models, back.efforts, back.leadModels, back.leadEfforts, back.tuned], [[], {}, [], {}, false]);
      assert.equal("shipped" in disk(), false, "nothing set: nothing kept");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA3, the owner's words of 10-23: "i mean everything"; a shipped
  // team's name, lead and members were a Duplicate's to change)
  test("a team that ships is yours in place: its name, lead and members, each with what it ships as; put back by null, all by reset; read back; its key stays", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-teams-shipped-"));
    try {
      const store = teamStore({ dataDir: dir });
      const crew = [{ tag: "reviewer", name: "Hunter", line: "Hunt your slice; file, line and code for each." }, { tag: "reviewer", name: "Scout", line: "Map the slice first." }];
      const t = store.update("bughunters", { name: "Hunters", lead: "builder", members: crew });
      assert.deepEqual([t.key, t.name, t.lead.tag, t.members.map((m) => [m.tag, m.line]), t.set, t.tuned], ["bughunters", "Hunters", "builder", [["hunter", crew[0].line], ["scout", crew[1].line]], ["name", "lead", "members"], true]);
      assert.deepEqual([t.ships?.name, t.ships?.lead, t.ships?.members?.map((m) => [m.tag, m.name]), t.moved], ["BugHunters", { tag: "huntlead", name: "BugHunters" }, [["reviewer", "Hunter"], ["reviewer", "Checker"]], undefined]);
      assert.equal(store.find("hunters")?.key, "bughunters", "found by its new name, its key kept");
      assert.equal(store.find("bughunters")?.name, "Hunters");
      const disk = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).shipped.bughunters;
      assert.deepEqual([disk.name, disk.lead, Object.keys(disk.was)], ["Hunters", "builder", ["name", "lead", "members"]]);
      assert.deepEqual(teamStore({ dataDir: dir }).find("bughunters"), store.find("bughunters"), "read back as it was set");
      // (case 14) A crew's member is whoever its card is: the team's usedBy says so.
      assert.deepEqual(store.usedBy("reviewer").filter((u) => u.key === "bughunters").map((u) => u.as), ["member"]);
      const one = store.update("bughunters", { lead: null });
      assert.deepEqual([one.lead.tag, one.set], ["huntlead", ["name", "members"]], "one put back");
      const all = store.update("bughunters", { reset: true });
      assert.deepEqual([all.name, all.lead.tag, all.members.map((m) => m.tag), all.set, all.tuned], ["BugHunters", "huntlead", ["hunter", "checker"], [], false]);
      assert.equal("shipped" in JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")), false, "nothing of its own left");
      refuses(() => store.update("bughunters", { reset: "yes" }), 400, /^reset is true, or left out/);
      refuses(() => store.update("bughunters", { colour: null }), 400, /^unknown field `colour`/);
      refuses(() => store.update("bughunters", { name: "Builders" }), 400, /^A team called `Builders` already exists \(shipped\)/);
      refuses(() => store.update("bughunters", { members: [{ tag: "buildlead" }] }), 400, /is the `builders` team's own Lead/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shipped team's words that Filament changed since you set them are told; your own set again end that; a bad field in the file is skipped and named", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-teams-moved-"));
    try {
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: {}, shipped: { bughunters: { members: [{ tag: "reviewer", name: "Checker", line: "Mine." }], name: "Checkers", lead: "nobody-here", was: { members: "000000000000" } } } }));
      /** @type {string[]} */
      const warned = [];
      const store = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => warned.push(m) });
      const v = store.find("bughunters");
      assert.deepEqual([v?.name, v?.lead.tag, v?.members[0].line, v?.set, v?.moved], ["Checkers", "huntlead", "Mine.", ["name", "members"], ["members"]]);
      assert.match(warned.join("\n"), /shipped bughunters \(lead\)/);
      assert.equal(store.update("bughunters", { members: [{ tag: "reviewer", name: "Checker", line: "Mine, again." }] }).moved, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 6, cases 15, 17 to 19: a save checked a persona and four role names)
  test("what a save refuses, in words", () => {
    const store = teamStore();
    store.create(MINE);
    refuses(() => store.create({ ...MINE, name: undefined }), 400, /^A team needs a name/);
    refuses(() => store.create({ ...MINE, name: "   " }), 400, /^A team needs a name/);
    refuses(() => store.create({ ...MINE, name: "two\nlines" }), 400, /^A team's name is one line/);
    refuses(() => store.create({ ...MINE, name: "x".repeat(41) }), 400, /^A team's name is up to 40 characters \(this one has 41\)/);
    refuses(() => store.create({ ...MINE, name: "Off" }), 400, /`off` is a word \/team reads as its own/);
    refuses(() => store.create({ ...MINE, name: "***" }), 400, /^A team's name needs a letter or a digit/);
    refuses(() => store.create({ ...MINE, name: "builders" }), 400, /^A team called `Builders` already exists \(shipped\)/);
    refuses(() => store.create({ ...MINE, name: "MINE" }), 400, /^A team called `Mine` already exists/);
    const NEW = { ...MINE, name: "New" };
    refuses(() => store.create({ name: "New", members: MINE.members }), 400, /^A team needs a lead: the tag of the card in charge\.$/);
    refuses(() => store.create({ ...NEW, lead: " " }), 400, /^A team needs a lead/);
    refuses(() => store.create({ ...NEW, lead: "nobody" }), 400, /^There is no agent `@nobody` to lead the team — Library › Agents and teams lists them\.$/);
    refuses(() => store.create({ name: "New", lead: "product" }), 400, /^A team needs at least one worker\.$/);
    refuses(() => store.create({ ...NEW, members: [] }), 400, /^A team needs at least one worker\.$/);
    refuses(() => store.create({ ...NEW, members: { builder: "x" } }), 400, /^members must be a list: each an agent's tag and the team's own line for it\.$/);
    refuses(() => store.create({ ...NEW, members: ["builder"] }), 400, /^members must be a list/);
    refuses(() => store.create({ ...NEW, members: [{ line: "x" }] }), 400, /^Each worker needs a tag: the agent it is\.$/);
    refuses(() => store.create({ ...NEW, members: [{ tag: "nobody" }] }), 400, /^There is no agent `@nobody` to be a worker/);
    // (the owner's "Teams, improved and kept", 11-03: a card sits twice only under a name for each seat, team-members.test.js)
    refuses(() => store.create({ ...NEW, members: [{ tag: "builder" }, { tag: "@Builder" }] }), 400, /^Builder is already one of its workers: name each to seat it twice, or its lead launches as many of one worker as the work needs\.$/);
    refuses(() => store.create({ ...NEW, members: [{ tag: "builder", line: 3 }] }), 400, /^The team's line for Builder must be text\.$/);
    refuses(() => store.create({ ...NEW, members: [{ tag: "builder", line: "x".repeat(2001) }] }), 400, /^The team's line for Builder is longer than 2,000 characters \(2,001\)\.$/);
    refuses(() => store.create({ ...NEW, members: [{ tag: "builder", colour: "red" }] }), 400, /^unknown field `members\.colour`: a worker has a tag, a name, a line, a model and an effort$/);
    // (the plan's p6: and the characters of its check)
    // (fails before: yes — the owner's word of 11-05: a team had a most at once, up to 32, and a total for one run, up
    // to 200) A team caps nothing of its own: each model's limit, set on its row under its provider, holds.
    assert.deepEqual(TEAM_LIMITS, { name: 40, line: 2000, members: 12, models: 6, check: 400 });
    // A team's models (team_v2_plan TV2-D8).
    const store2 = teamStore();
    const base = { name: "Models", lead: "product", members: [{ tag: "builder" }] };
    assert.throws(() => store2.create({ ...base, models: "glm" }), /models must be a list of up to 6 model names/);
    assert.throws(() => store2.create({ ...base, models: ["a", "b", "c", "d", "e", "f", "g"] }), /up to 6 models for its workers \(this one names 7\)/);
    assert.throws(() => store2.create({ ...base, models: ["glm", "GLM"] }), /`GLM` is named twice/);
    assert.throws(() => store2.create({ ...base, models: [""] }), /Each of a team's models is a model's name/);
    assert.throws(() => store2.create({ ...base, most: 3 }), /^Error: unknown field `most`/);
    assert.throws(() => store2.create({ ...base, total: 30 }), /^Error: unknown field `total`/);
    for (let n = 1; n <= 13; n++) store.cards.create({ from: "builder", tag: `hand${n}`, name: `Hand ${n}` });
    const hands = Array.from({ length: 13 }, (_, n) => ({ tag: `hand${n + 1}` }));
    refuses(() => store.create({ ...NEW, members: hands }), 400, /^A team has up to 12 workers \(this one names 13\): its lead launches as many of one worker as the work needs\.$/);
    assert.equal(store.create({ name: "Twelve", lead: "product", members: hands.slice(0, 12) }).members.length, 12);
    refuses(() => store.create({ ...NEW, colour: "red" }), 400, /^unknown field `colour`: a team has a name, a lead, members, the models its workers run on, its lead's models, readOnly, what a main agent's fire does \(fired\) and its check$/);
    refuses(() => store.create({ ...NEW, persona: "You lead." }), 400, /^unknown field `persona`/);
    refuses(() => store.update("mine", { from: "builders" }), 400, /unknown field `from`/);
    refuses(() => store.update("mine", { name: "Builders" }), 400, /^A team called `Builders` already exists \(shipped\)/);
    refuses(() => store.update("mine", { members: [] }), 400, /^A team needs at least one worker/);
    assert.equal(store.update("mine", { name: "MINE" }).name, "MINE", "a team may take its own name in another case");
    assert.deepEqual(store.list().map((t) => t.key), ["builders", "bughunters", "mine", "twelve"], "nothing refused was saved");
  });

  // (fails before: yes — found building step 6: a member's tag is what a task's `by` names, and three words there are
  // the graph's own)
  test("a card tagged with a word the task graph keeps for the agent's own tasks is no member", () => {
    const store = teamStore();
    store.cards.create({ from: "reviewer", tag: "explorer", name: "Explorer" });
    refuses(() => store.create({ name: "New", lead: "product", members: [{ tag: "explorer" }] }), 400, /^`@explorer` is a word the task graph keeps for an agent's own tasks \(you, sub-agent, explorer\): copy Explorer under another tag to make it a worker\.$/);
  });

  // (fails before: yes — HarnessV4_Tasks E15 step 6, cases 13, 15 and 17: nothing knew which team used a card)
  test("a card a team uses: the store says which teams, and the card cannot go until the team lets it; its level stays its own to change", () => {
    const store = teamStore();
    store.cards.create({ from: "builder", tag: "translator", name: "Translator" });
    store.cards.create({ from: "product", tag: "boss", name: "Boss" });
    store.create({ name: "Docs", lead: "boss", members: [{ tag: "translator", line: "Keep to the docs folder." }, { tag: "builder" }] });
    assert.deepEqual(store.usedBy("translator"), [{ key: "docs", name: "Docs", as: "member", line: "Keep to the docs folder." }]);
    assert.deepEqual(store.usedBy("@Boss"), [{ key: "docs", name: "Docs", as: "lead", line: "" }]);
    assert.deepEqual(store.usedBy("buildlead"), [{ key: "builders", name: "Builders", as: "lead", line: "" }]);
    assert.deepEqual(store.usedBy("builder").map((u) => [u.key, u.as]), [["builders", "member"], ["docs", "member"]]);
    assert.deepEqual([store.usedBy("helper"), store.usedBy("nobody")], [[], []]);
    assert.equal(store.holds("boss"), "Boss leads the Docs team: pick another lead for it first");
    assert.equal(store.holds("translator"), "Translator works in the Docs team: take it out of the team first");
    assert.equal(store.holds("helper"), null);
    refuses(() => store.cards.remove("boss"), 400, /^Boss leads the Docs team: pick another lead for it first\.$/);
    refuses(() => store.cards.remove("translator"), 400, /^Translator works in the Docs team: take it out of the team first\.$/);
    // One kind of agent (OA1): a card a team uses changes its level as any card does.
    assert.equal(store.cards.update("translator", { may: "read" }).may, "read");
    store.update("docs", { lead: "product", members: [{ tag: "builder" }] });
    assert.equal(store.cards.remove("boss").tag, "boss", "let go, it goes");
    assert.equal(store.cards.remove("translator").tag, "translator");
  });

  // (fails before: yes — HarnessV4_OneAgent_Plan OA1 case 8: a team and an agent could share a name, and a name in a
  // message could mean either)
  test("a team and an agent never share a name: a team named after an agent, or renamed so, is refused in words; an agent named after a team too; a team's own Lead is its team's name already", () => {
    const store = teamStore();
    refuses(() => store.create({ ...MINE, name: "reviewer" }), 400, /^An agent is called Reviewer \(`@reviewer`\): a team and an agent never share a name — pick another\.$/);
    store.create(MINE);
    refuses(() => store.update("mine", { name: "Builder" }), 400, /^An agent is called Builder \(`@builder`\)/);
    refuses(() => store.cards.create({ tag: "mine2", name: "MINE", goodFor: "Mine again", thinks: "" }), 400, /^A team is called Mine: an agent and a team never share a name — pick another\.$/);
    refuses(() => store.cards.create({ from: "buildlead", tag: "meth2" }), 400, /^A team is called Builders/);
    assert.equal(store.find("builders")?.lead.name, "Builders", "the Builders team and its own Lead share the name: the card is part of it");
    assert.deepEqual(store.list().filter((t) => !t.shipped).map((t) => t.name), ["Mine"], "nothing was saved by a refused save");
  });

  // (fails before: yes — the bug round of 10-23: a team's own Lead joined another team's crew through a save, and an
  // agent's tag could be a team's key, which `@` names as well)
  test("a team's own Lead is in no other team's crew; an agent's tag and a team's key never meet — a team keyed as its own lead's tag aside", () => {
    const store = teamStore();
    refuses(() => store.create({ ...MINE, members: [{ tag: "huntlead" }] }), 400, /is the `bughunters` team's own Lead: it runs only when that team does — copy it under another tag to make it a worker\.$/);
    store.create(MINE);
    refuses(() => store.cards.create({ tag: "mine", name: "Mine Agent", goodFor: "Mine", thinks: "" }), 400, /^`@mine` is the Mine team's: an agent's tag and a team's key never meet, since @ names either — pick another tag\.$/);
    store.cards.create({ tag: "solo", name: "Solo Agent", goodFor: "Alone", thinks: "" });
    refuses(() => store.create({ ...MINE, name: "Solo" }), 400, /^`@solo` is Solo Agent's tag: a team's key and an agent's tag never meet, since @ names either — pick another name\.$/);
    refuses(() => store.update("mine", { name: "Solo" }), 400, /^`@solo` is Solo Agent's tag/);
    assert.equal(store.create({ name: "Solo", lead: "solo", members: [{ tag: "builder" }] }).key, "solo", "a team keyed as its own lead's tag, as the shipped ones are");
  });

  test("a file it cannot read starts empty and is reported, never thrown over; a team a save would refuse is skipped and reported", () => {
    const dir = folder();
    try {
      /** @type {string[]} */
      const said = [];
      const log = (/** @type {string} */ level, /** @type {string} */ msg) => said.push(`${level} ${msg}`);
      writeFileSync(join(dir, TEAMS_FILE), "{ not json");
      assert.deepEqual(teamStore({ dataDir: dir, log }).list().length, 2);
      assert.match(said.join("\n"), /^warn teams: teams\.json could not be read \(.+\); starting with no saved teams$/m);
      said.length = 0;
      // (fails before: yes — the install keeps no team from before a team was made of cards: a version 1 file is not read)
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 1, teams: { old: { name: "Old", persona: "You lead.", roles: {} } } }));
      assert.deepEqual(teamStore({ dataDir: dir, log }).list().length, 2);
      // (r-itself, 11-12: it said "it is not a version 2 teams file" and the next save wrote over the file; another
      // build's file is set aside under its version's name first — test/store-files.test.js)
      assert.match(said.join("\n"), /^warn teams: teams\.json is version 1, which this Filament does not read \(it reads version 2\): another build of Filament saved it\. It is kept beside it as teams\.json\.v1\.\d{8}T\d{6}Z, with nothing saved over it, and this build starts with no saved teams\./);
      assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(TEAMS_FILE)).map((f) => f.replace(/\d{8}T\d{6}Z/, "<when>")), ["teams.json.v1.<when>"]);
      said.length = 0;
      const good = { name: "Good", lead: "product", members: [{ tag: "builder", line: "" }], from: "builders", createdAt: 1, updatedAt: 1 };
      // Each team skipped breaks one rule alone.
      const teams = {
        good,
        builders: { ...good, name: "Arch Two" }, // a key a shipped team holds
        "Bad Key": { ...good, name: "Bad" }, // no key
        leaderless: { name: "Leaderless", members: good.members }, // no lead
        gone: { ...good, name: "Gone", lead: "left" }, // a lead card that is gone (case 20)
        empty: { ...good, name: "Empty", members: [] }, // no member
        lost: { ...good, name: "Lost", members: [{ tag: "left", line: "" }] }, // a member card that is gone
        offish: { ...good, name: "Off" }, // a name /team reads as its own
        again: { ...good, name: "GOOD" }, // a name another team holds
      };
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams }));
      const store = teamStore({ dataDir: dir, log });
      assert.deepEqual(store.list().filter((t) => !t.shipped).map((t) => t.key), ["good"]);
      assert.deepEqual([store.find("good")?.from, store.find("good")?.createdAt], ["builders", 1], "a Duplicate's source is read back");
      assert.match(said.join("\n"), /^warn teams: 8 teams of yours in teams\.json cannot be used now, kept as saved until they can or you delete them — the Teams page says why: builders, Bad Key, leaderless, gone, empty, lost, offish, again$/m);
      assert.equal(existsSync(join(dir, TEAMS_FILE)), true, "the file is left as it was until the next save");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — found 11-02: a team of yours naming a card that is gone was skipped as it was read, and the next
  // save of any team wrote the file without it, gone for good)
  test("a team of yours that cannot be read now is kept in the file as it was through every save, listed with why, its key held, and deleted on your word", () => {
    const dir = folder();
    try {
      const lost = { name: "Lost", lead: "product", members: [{ tag: "left", line: "Keep it." }], createdAt: 1, updatedAt: 1 };
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { lost } }));
      const store = teamStore({ dataDir: dir, log: () => {} });
      store.create(MINE);
      const read = () => JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams;
      assert.deepEqual(read().lost, lost, "kept as it was");
      assert.ok(read().mine, "beside the team saved");
      assert.deepEqual(store.held(), [{ key: "lost", name: "Lost", why: "There is no agent `@left` to be a worker — Library › Agents and teams lists them." }]);
      assert.deepEqual(store.list().filter((t) => !t.shipped).map((t) => t.key), ["mine"], "never used as a team");
      refuses(() => store.create({ ...MINE, name: "Lost" }), 400, /^A team called `Lost` is kept in teams\.json but cannot be used now \(There is no agent `@left`/);
      refuses(() => store.update("mine", { name: "Lost" }), 400, /^A team called `Lost` is kept in teams\.json/);
      assert.equal(store.remove("lost").key, "lost");
      assert.deepEqual([store.held(), read().lost], [[], undefined], "gone on your word");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: a team held was decided once, as the file was read: the card it names made
  // again, it stayed held until a restart — for good, for a plugin's agent, whose cards come after the teams are read)
  test("a team held comes back once the card it names is there, with no restart, and is saved as yours from then on", () => {
    const dir = folder();
    try {
      const lost = { name: "Lost", lead: "product", members: [{ tag: "left", line: "Keep it." }], createdAt: 1, updatedAt: 1 };
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { lost } }));
      const store = teamStore({ dataDir: dir, log: () => {} });
      assert.equal(store.find("lost"), null);
      store.cards.create({ tag: "left", name: "Left", goodFor: "What is left", thinks: "You see what is left." });
      assert.deepEqual(store.held(), [], "no longer held");
      assert.deepEqual([store.find("lost")?.members.map((m) => [m.tag, m.line]), store.list().some((t) => t.key === "lost")], [[["left", "Keep it."]], true]);
      store.update("lost", { name: "Found" });
      assert.deepEqual(JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams.lost.name, "Found", "saved as yours");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: one of yours under a key a shipped team holds was refused its Delete, 403,
  // its row and its name kept for good)
  test("a team held under a shipped team's key is deleted on your word, and the shipped team stays", () => {
    const dir = folder();
    try {
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { builders: { name: "My Crew", lead: "product", members: [{ tag: "builder", line: "" }] } } }));
      const store = teamStore({ dataDir: dir, log: () => {} });
      assert.deepEqual(store.held().map((h) => [h.key, h.name]), [["builders", "My Crew"]]);
      assert.deepEqual(store.remove("builders"), { key: "builders", name: "My Crew" });
      assert.deepEqual([store.held(), JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams], [[], {}]);
      assert.equal(store.find("builders")?.shipped, true, "the shipped team stays");
      assert.equal(store.create({ ...MINE, name: "My Crew" }).name, "My Crew", "its name free again");
      refuses(() => store.remove("builders"), 403, /^`builders` is a shipped team: it cannot be deleted\.$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: an agent could take a held team's name or key, and once the team came
  // back the two shared it — OA1)
  test("a team held keeps its name and key from a new agent as from a new team", () => {
    const dir = folder();
    try {
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { lost: { name: "Lost", lead: "product", members: [{ tag: "left", line: "" }] } } }));
      const store = teamStore({ dataDir: dir, log: () => {} });
      const card = { goodFor: "Anything", thinks: "You do anything." };
      refuses(() => store.cards.create({ ...card, tag: "other", name: "Lost" }), 400, /^A team is called Lost: an agent and a team never share a name/);
      refuses(() => store.cards.create({ ...card, tag: "lost", name: "Someone" }), 400, /^`@lost` is the Lost team's: an agent's tag and a team's key never meet/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: a card a team held names was used by no team and could be deleted, so the
  // card the team was waiting for came back to a team that still could not be used)
  test("a card a team held names is used by it, and cannot go until that team is deleted", () => {
    const dir = folder();
    try {
      const lost = { name: "Lost", lead: "boss", members: [{ tag: "left", line: "" }, { tag: "translator", line: "Keep to the docs folder." }] };
      writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { lost } }));
      const store = teamStore({ dataDir: dir, log: () => {} });
      store.cards.create({ from: "product", tag: "boss", name: "Boss" });
      store.cards.create({ from: "builder", tag: "translator", name: "Translator" });
      assert.deepEqual(store.held().map((h) => h.key), ["lost"], "still held: @left is gone");
      assert.deepEqual(store.usedBy("@Boss"), [{ key: "lost", name: "Lost", as: "lead", line: "" }]);
      assert.deepEqual(store.usedBy("translator"), [{ key: "lost", name: "Lost", as: "member", line: "Keep to the docs folder." }]);
      assert.equal(store.holds("boss"), "Boss leads the Lost team, kept but not usable now: edit or delete that team first");
      refuses(() => store.cards.remove("translator"), 400, /^Translator works in the Lost team, kept but not usable now: edit or delete that team first\.$/);
      store.remove("lost");
      assert.deepEqual([store.usedBy("translator"), store.holds("boss")], [[], null]);
      assert.deepEqual([store.cards.remove("translator").tag, store.cards.remove("boss").tag], ["translator", "boss"], "let go, they go");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a save the disk refuses changes nothing: the store stays as its file has it, and no temp file is left behind", () => {
    const dir = folder();
    try {
      mkdirSync(join(dir, TEAMS_FILE)); // a folder where the file goes: every rename onto it fails
      const store = teamStore({ dataDir: dir });
      assert.throws(() => store.create(MINE));
      assert.equal(store.find("mine"), null, "the file never had it, so neither does the store");
      assert.deepEqual(readdirSync(dir), [TEAMS_FILE], "the temp file went with the failed save");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
