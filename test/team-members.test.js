// @ts-check
// The owner's "Teams, improved and kept" (11-03), its second piece. Each member of a team runs on a model and at an
// effort of its own, where the team names them: a lead's launch that names none takes them — its model before the team's
// models and its card's, its effort before the Brief's pick for the crew — and the lead's line on its workers' models
// names it. A team seats one card more than once, each seat under a name of its own ("Option B"): the name's slug is the
// member's id — what its lead, its tools and the task graph name it by — and the worker runs as the card, with its own
// line and model; where a card sits twice, each member's own line stands in for the card's shared "good for" in the
// lead's words. A team with no names hands out what it did before, byte for byte (fixtures/teams-unnamed.json: written
// from the code before this piece).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rosterWords } from "../src/app/agent/roster-words.js";
import { leadToolsOf } from "../src/app/agent/tools.js";
import { leadLines } from "../src/app/agent/prompt.js";
import { SHIPPED_CARDS, teamClashes } from "../src/services/agent-cards.js";
import { teamRow } from "../src/core/roster.js";
import { worded } from "../src/core/failure.js";
import { memberLook } from "../src/ui/harness/lib/brief.js";
import { frameOf } from "../src/ui/harness/lib/boards.js";
import * as teamLib from "../src/ui/harness/lib/team.js";
import { agentName } from "../src/ui/harness/panes/changes-data.js";
import { BRIEF, asV79Tools, asV80Envelope, asV85Shell, asV81Envelope, asV93Tools, asV98Tools, asV99Tools, asV100Tools, asV101Tools, asV102Tools, asV103Tools, asV104Tools, asV109Tools, leadOf, teamStore, watched, asV111Tools, asV120Tools } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** @param {() => any} fn @param {number} status @param {RegExp} words */
const refuses = (fn, status, words) =>
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.equal(e.status, status, e.message);
    assert.match(e.message, words);
    return true;
  });
/** A sha-256 of a value as JSON, as the fixture keeps the lead's tools. @param {unknown} v */
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** Each model at the level asked, its name unchanged: the effort a launch wanted is what it runs at. */
const EFFORTS = { effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted) => ({ level: wanted, wire: model, levels: ["low", "medium", "high", "xhigh", "max"], spelled: false }) };
/** A lead's call to its team's tools, for a team the store handed out. @param {ReturnType<typeof leadOf>} l @param {any} team @param {any} input */
const callFor = (l, team, input) => ({ ...l.call(input), team });

// (fails before: yes — a team's member was its card's tag and its team's line, nothing more: a save refused a model, an
// effort or a name, and a card twice)
describe("a member's own model and effort", () => {
  test("a save takes them, checked as a card's model and a launch's effort are; the team hands them out as the member's own; a shipped team's members take them too", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-team-members-"));
    try {
      const store = teamStore({ dataDir: dir });
      const t = store.create({ name: "Mine", lead: "product", members: [{ tag: "reviewer", name: "Scout", model: "agent/m-scout", effort: "LOW" }, { tag: "builder", line: "Small changes.", model: null, effort: "" }] });
      assert.deepEqual(t.members.map((m) => [m.tag, m.own ?? null]), [["scout", { model: "m-scout", effort: "low" }], ["builder", null]]);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, "teams.json"), "utf8")).teams.mine.members, [{ tag: "reviewer", name: "Scout", line: "", model: "m-scout", effort: "low" }, { tag: "builder", line: "Small changes." }], "kept only where named");
      assert.deepEqual(teamStore({ dataDir: dir }).find("mine")?.members[0].own, { model: "m-scout", effort: "low" }, "read back as saved");
      const scout = { tag: "reviewer", name: "Scout" };
      refuses(() => store.create({ name: "Bad", lead: "product", members: [{ ...scout, model: "two\nlines" }] }), 400, /^The model the team runs Scout on is a model's name on one line, or null for none of its own\.$/);
      refuses(() => store.create({ name: "Bad", lead: "product", members: [{ ...scout, model: 7 }] }), 400, /^The model the team runs Scout on/);
      refuses(() => store.create({ name: "Bad", lead: "product", members: [{ ...scout, effort: "turbo" }] }), 400, /^The effort Scout runs at is one of model, low, medium, high, xhigh, max, or null for none of its own\.$/);
      refuses(() => store.create({ name: "Bad", lead: "product", members: [{ ...scout, colour: "red" }] }), 400, /^unknown field `members\.colour`: a worker has a tag, a name, a line, a model and an effort$/);
      // A shipped team, set in place: its members with a model of their own — each saved as its card and its seat's name.
      // (the plan's p6) Builders, the shipped team that builds.
      const ships = /** @type {any} */ (store.find("builders")).members.map((/** @type {any} */ m) => ({ tag: m.card ?? m.tag, ...(m.card ? { name: m.name } : {}), line: m.line }));
      const set = store.update("builders", { members: ships.map((/** @type {any} */ m) => (m.tag === "builder" && !m.name ? { ...m, model: "m-strong", effort: "xhigh" } : m)) });
      assert.deepEqual(set.members.find((m) => m.tag === "builder")?.own, { model: "m-strong", effort: "xhigh" });
      assert.deepEqual([set.set, teamStore({ dataDir: dir }).find("builders")?.members[1].own], [["members"], { model: "m-strong", effort: "xhigh" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — a worker whose lead named no model ran on its team's models or its card's, at the Brief's effort)
  test("a launch that names none runs on the member's model — before the team's models and its card's — at its effort, before the Brief's pick; what the launch names wins; the lead's line names it", async () => {
    const store = teamStore();
    const team = store.create({ name: "Crew", lead: "product", members: [{ tag: "reviewer", name: "Scout" }, { tag: "builder", model: "m-builder", effort: "low" }], models: ["m-crew"] });
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 8 }] }, engine: { teamEffort: "max" }, extra: EFFORTS });
    const l = leadOf(w.registry, w.dir);
    const rows = await w.registry.teamRows(team, "c1");
    assert.deepEqual(rows?.map((r) => r.model), ["m-crew"]);
    const launch = async (/** @type {any} */ input) => {
      const r = await l.tools.agent(callFor(l, team, input));
      assert.equal(r.ok, true, r.text);
      return /** @type {any} */ (w.registry.get(String(r.agentId)));
    };
    const built = await launch(BRIEF);
    assert.deepEqual([built.model, built.effort], ["m-builder", "low"], "the member's own, over the team's models and the Brief's effort");
    const scout = await launch({ ...BRIEF, role: "scout", description: "Map it" });
    assert.deepEqual([scout.model, scout.effort], ["m-crew", "max"], "a member with none: the team's models, the Brief's pick");
    const named = await launch({ ...BRIEF, description: "Fix the lexer", model: "m-named", effort: "high" });
    assert.deepEqual([named.model, named.effort], ["m-named", "high"], "what the launch names wins");
    assert.equal((await w.run(1)).body.model, "agent/m-builder");
    // The lead's line on its workers' models: the member's own, the others on the team's.
    const models = w.registry.modelsOf("c1", team.members, "m-lead", undefined, rows);
    assert.deepEqual(models.members, [{ tag: "scout", model: null }, { tag: "builder", model: "m-builder" }]);
    assert.ok(leadLines({ members: team.members, models }).includes("- Your workers' models: `scout` on m-crew; `builder` on m-builder. "), leadLines({ members: team.members, models }));
    // With no models of the team's, a member with none takes its card's, else the pool.
    assert.deepEqual(w.registry.modelsOf("c1", team.members, "m-lead").members, [{ tag: "scout", model: null }, { tag: "builder", model: "m-builder" }]);
  });
});

// (fails before: yes — a team seated a card once, by its tag; the second was refused as "already a member")
describe("one card twice, each seat under a name (Option B)", () => {
  const PAIR = {
    name: "Review pair",
    lead: "product",
    members: [
      { tag: "reviewer", name: "Fact Checker", line: "Check each claim in the report against the code.", model: "m-check" },
      { tag: "reviewer", name: "Spotter", line: "Read the diff for bugs the tests miss." },
      { tag: "builder", line: "Small changes." },
    ],
  };

  test("a save takes a name for each seat, its slug the member's id; the team hands each out by its id, its card, its name, its line; refusals in words", () => {
    const store = teamStore();
    const t = store.create(PAIR);
    assert.deepEqual(
      t.members.map((m) => [m.tag, m.card ?? null, m.name, m.may, m.place, m.line, m.own ?? null]),
      [
        ["fact-checker", "reviewer", "Fact Checker", "read", "reviewer", PAIR.members[0].line, { model: "m-check" }],
        ["spotter", "reviewer", "Spotter", "read", "reviewer", PAIR.members[1].line, null],
        ["builder", null, "Builder", "edit", "builder", "Small changes.", null],
      ],
    );
    const base = { name: "Bad", lead: "product" };
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer" }, { tag: "reviewer" }] }), 400, /^Reviewer is already one of its workers: name each to seat it twice, or its lead launches as many of one worker as the work needs\.$/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "Spotter" }, { tag: "builder", name: "spotter!" }] }), 400, /^Two workers are named `spotter`: each worker's name is its own\.$/);
    // A name never takes another agent's tag: the shipped Builder's and Product's among them.
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "Builder" }] }), 400, /^`builder` is Builder's tag: a worker's name never takes another agent's — name it something else\.$/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "Product" }] }), 400, /^`product` is Product's tag/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "Explorer" }] }), 400, /^`explorer` is a word the task graph keeps \(you, sub-agent, explorer, command\): name the worker something else\.$/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "Command" }] }), 400, /^`command` is a word the task graph keeps/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "7 eyes" }] }), 400, /^`7 eyes` cannot name a worker: its lead names it `7-eyes`, which must be 2 to 24 letters/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "two\nlines" }] }), 400, /^A worker's name is one line, up to 40 characters/);
    refuses(() => store.create({ ...base, members: [{ tag: "reviewer", name: "x".repeat(41) }] }), 400, /^A worker's name is up to 40 characters/);
    // Its own card's tag is its own: a seat named so is that card's.
    // (the review of 11-03: a seat the team names hands out its card, whatever its id — `card` says the seat has a name)
    assert.deepEqual(store.create({ name: "Own", lead: "product", members: [{ tag: "reviewer", name: "REVIEWER" }] }).members.map((m) => [m.tag, m.card ?? null, m.name]), [["reviewer", "reviewer", "REVIEWER"]]);
    // (fails before: yes — nothing kept a card from taking the tag a team's member answers to)
    refuses(() => store.cards.create({ from: "reviewer", tag: "spotter", name: "My Spotter" }), 400, /^`spotter` is what the Review pair team calls one of its workers: an agent's tag and a worker's name never meet/);
    assert.deepEqual(teamClashes([{ tag: "spotter", name: "Spotter card" }], store.list()), ["@spotter (Spotter card) is what the team Review pair calls one of its workers: its lead names either so — rename that worker on Library › Agents and teams"]);
    // The card both seats run as is used by the team, once.
    assert.deepEqual(store.usedBy("reviewer").filter((u) => u.key === "review-pair"), [{ key: "review-pair", name: "Review pair", as: "member", line: PAIR.members[0].line }]);
  });

  // (fails before: yes — the lead's role named a card's tag, and a launch ran the card that tag named)
  test("the lead launches each seat by its id: each runs as the card, with its own line and its own model; the lead's words and tools name each by its id and its own line", async () => {
    const store = teamStore();
    const team = store.create(PAIR);
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 8 }] } });
    const l = leadOf(w.registry, w.dir);
    const tools = leadToolsOf(team.members);
    assert.deepEqual(/** @type {any} */ (tools.agent.input_schema.properties).role.enum, ["fact-checker", "spotter", "builder"]);
    const launched = [];
    for (const role of ["fact-checker", "spotter"]) {
      const r = await l.tools.agent(callFor(l, team, { ...BRIEF, role, description: `Read it as ${role}` }));
      assert.equal(r.ok, true, r.text);
      assert.match(r.text, new RegExp(`^Launched ${role} sa_[0-9a-f]{8} `));
      launched.push(/** @type {any} */ (w.registry.get(String(r.agentId))));
    }
    assert.deepEqual(
      launched.map((sa) => [sa.team.role, sa.card.tag, sa.may, sa.model, sa.team.place]),
      [
        ["fact-checker", "reviewer", "read", "m-check", "reviewer"],
        ["spotter", "reviewer", "read", "m-pool", "reviewer"],
      ],
    );
    // What each worker's turn reads of its team: the member it is and the team's own line for it.
    const runs = [await w.run(1), await w.run(2)];
    for (const r of runs) r.attach();
    await Promise.all(launched.map((sa) => until(() => w.registry.get(sa.id)?.runId, "its run to attach")));
    assert.deepEqual(
      launched.map((sa) => w.registry.hostOf(sa.id)?.team).map((t) => [t?.role, t?.words]),
      [
        ["fact-checker", PAIR.members[0].line],
        ["spotter", PAIR.members[1].line],
      ],
    );
    for (const r of runs) r.finish({ status: "done", report: "READ." });
    await Promise.all(launched.map((sa) => w.registry.settled(sa.id)));
    // The lead's words: each seat of the card by its own line, the card's shared "good for" nowhere for them.
    const words = rosterWords(team.members);
    assert.ok(words.roles.includes("  - `fact-checker` (Fact Checker): Check each claim in the report against the code. It changes nothing."), words.roles);
    assert.ok(words.roles.includes("  - `spotter` (Spotter): Read the diff for bugs the tests miss. It changes nothing."), words.roles);
    assert.ok(words.roles.includes("  - `builder` (Builder): Builds and fixes in its own copy, and writes and runs the tests that prove it. It changes files."), "a card once keeps its card's line");
    assert.ok(words.roleField.includes("`spotter` (Spotter): Read the diff for bugs the tests miss."), words.roleField);
    assert.equal(rosterWords(store.update("review-pair", { members: PAIR.members.map((m, i) => (i === 1 ? { ...m, line: "Another line." } : m)) }).members).roles.includes("`spotter` (Spotter): Another line."), true, "words kept per line: another line, other words");
  });

  // (fails before: n/a — pins that a team with no names is as it was: written from the code before this piece)
  // The roster shrink of 11-03 moved this pin: every shipped team names its seats now — a Scout and a Tester, a Hunter,
  // a Checker — and Copies seated Scout and Tester, which are gone; Mine, Builder and Reviewer unnamed, is the fixture's
  // one team with no names, weighed with those two cards' good-for as they shipped when the fixture was written, and its
  // tasks tool's found_by naming a Hunter, as it did then. Letters (11-04) moved its tools' hash: the lead's envelope
  // tool writes and answers them — with that tool as it was before, the hash is the one written before this piece. The
  // lsp tool (prompt version 80) is weighed out of the lead's own, as every figure of version 79 is, and the envelope's
  // letters inside a chat (version 81) out of its words, as every figure of version 80 is — and a sub-agent's wait for a
  // letter's reply (version 82) before them, as every figure of version 81 is — and bash's and powershell's timeout as
  // version 85 had them, before a command past it went on in the background (version 86) — and plan_review's words as
  // version 91 had them, before a lead's go was a field of its answer (version 92, the memory plan's a2). The owner's tool
  // plan of 11-08 (version 94) took the em dashes out of the words and tools a lead shares with a coding agent, and
  // rewrote show_visual's, artifact's and space's: all of them as version 93 had them first (asV93Tools, OWN_V93) — and
  // before that the lead's tasks tool and bash's command as version 98 had them, before the loop's tool texts were said
  // where they are used (version 99, asV98Tools) — and before that its worker tool as version 99 had it, before an apply
  // that overlaps the folder's edits sent the change back with overlap (version 100, asV99Tools) — and before that its
  // envelope as version 100 had it, before what is still open took dismiss (version 101, asV100Tools) — and before that its
  // tasks tool as version 101 had it, before writes became a forecast (version 102, asV101Tools) — and before that its
  // tasks tool as version 102 had it, before the graph's words were given their freedom (version 103, asV102Tools). Its
  // lead's words, which asV93Tools alone weighs, as version 120 had them first, before a team's agents were its workers
  // in them (version 121, asV120Tools); its tools take that from asV111Tools.
  test("a team with no names hands out the members, the lead's words and the lead's tools it did before, byte for byte", () => {
    const before = JSON.parse(readFileSync(new URL("./fixtures/teams-unnamed.json", import.meta.url), "utf8"));
    const store = teamStore();
    store.cards.create({ from: "builder", tag: "translator", name: "Translator", goodFor: "Turns one language's code into another's" });
    store.create({ name: "Mine", lead: "product", members: [{ tag: "builder", line: "Touch only the files named." }, { tag: "reviewer" }] });
    refuses(() => store.create({ name: "Copies", lead: "product", members: [{ tag: "translator", line: "Keep the tests green." }, { tag: "scout" }, { tag: "tester", line: "Run them all." }] }), 400, /^Scout is now part of Reviewer: seat Reviewer in its place$/);
    const teams = store.list();
    // (the plan's p6) The fixture's four build teams are one now, Builders, where they stood; its Bug Hunter and Verifier
    // are one, BugHunters, where they stood.
    const BUILD = ["10x-engineer", "methodical", "architect", "one-shot"];
    const HUNT = ["bug-hunter", "verifier"];
    assert.deepEqual(teams.map((t) => t.key), Object.keys(before).filter((k) => k !== "copies").flatMap((k) => (k === BUILD[0] ? ["builders"] : k === HUNT[0] ? ["bughunters"] : BUILD.includes(k) || HUNT.includes(k) ? [] : [k])));
    for (const t of teams.filter((x) => x.key !== "mine")) assert.ok(t.members.some((m) => m.card), `${t.key} names its seats`);
    /**
     * Builder's and Reviewer's good-for, found_by's first words, what a worker's model and effort left out run on (the
     * owner's of 11-05, versions 87 to 89), and the account a worker's model named alone runs on first (the review of
     * f39fac749, version 90), and the tasks tool's find (the owner's plan mode of 11-06, version 91): now, then.
     */
    const then = [
      ["a line each; find — words, and id to look in one task: the lines of the tasks' own words and of what is kept behind them that hold every word, each saying where it is.", "a line each."],
      [" find: the one task to look in (leave it out for all).", ""],
      ['"words":{"type":"string","description":"find: what to look for — each line found holds every word."},', ""],
      ['"read","find","merge"', '"read","merge"'],
      ["your own account where you run on a coding agent's that serves it, else the first of them in the developer's order that can run it now", "the first of them, in the developer's order, that can run it now"],
      ["Answer it with go: true to let it start, or with your corrections and no go.", "Answer go to let it start, or your corrections."],
      [`,"allow":{"type":"boolean","description":"With answer, to a worker's call that waits: true runs it. Left out, the call is not run, and the worker reads your answer."},"go":{"type":"boolean","description":"With answer, to a worker's plan: true lets it change files and run commands. Left out, your answer is its corrections, and it sends its plan again."}`, ""],
      ["With ask — and allow or go where they fit, nothing else — to a running worker that waits: to its call, what to do; to its question to you, your answer; to its plan, your words on it.", "With ask, and nothing else, to a running worker that waits: to its call, yes to run it or what to do instead, which refuses it; to its question to you, your answer; to its plan, go to let it start, or your corrections."],
      [SHIPPED_CARDS.builder.goodFor, "Makes one change, and only that"],
      [SHIPPED_CARDS.reviewer.goodFor, "Reads a change: what holds, what breaks, what is missing"],
      ["A bug hunt the developer fired", "A Hunter the developer fired"],
      ["Left out: the one its team names, else the one set for that model in the list it runs from, else the main agent's effort.", "Left out: the developer's choice for this session, max unless they set another."],
      ["Left out: the one its team names, else the one set for that model in the list it runs from, else your own effort.", "Left out: the developer's choice for this session, max unless they set another."],
      ["its member's own where its team names one, else its team's models for its workers, else this chat's for its kind, else its card's, else your workers' list, which is your own model where none is set — as your instructions name them; of that one list, the first that can run and has room", "its member's card's model where it names one, else the first free seat of your workers' list, as your instructions name it"],
    ];
    const asThen = (/** @type {string} */ s) => then.reduce((x, [now, was]) => x.split(now).join(was), s);
    /**
     * show_visual's, artifact's and space's words as version 93 had them, before the owner's tool plan of 11-08 (version
     * 94) rewrote them; only this pin weighs them among a lead's own tools: each tool's text and the fields it rewrote, whole.
     * @type {Readonly<Record<string, { text: string, fields: Record<string, string> }>>}
     */
    const OWN_V93 = Object.freeze({
      show_visual: {
        text: "Draw a picture in the developer's chat: an SVG drawing or an HTML fragment, shown inside your answer in a closed frame at the chat's width, its height following what you draw. Draw when a picture says it better than words — how parts connect, how numbers compare, what a screen could look like, something to try — not for what a sentence, a list or a table says as well. Read visual_guide first. The basics: send a fragment, never a whole page (no <!DOCTYPE>, <html>, <head> or <body>); give an SVG viewBox and width=\"100%\"; take every color from the names the guide lists, so it reads in light and dark; scripts and fonts load only from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh and Google Fonts, and nothing else is reachable; no position: fixed, no 100vh, no inner scrolling. The developer sees it; you are told only that it was shown.",
        fields: {
          code: "An SVG drawing (<svg …>…</svg>), or an HTML fragment — what would go inside <body> — with its <style> first and its <script> last.",
        },
      },
      artifact: {
        text: "Make a page the developer keeps: an artifact lives outside the chat, in their Artifacts list, under an address of its own on this machine (http://<name>.art.localhost:<port>/), with every version kept. Make one for something they will use again — a tracker, a calculator, a report, a small tool — not for a picture inside your answer (show_visual draws that). Its type: a page (you write the HTML), a doc (you write Markdown; Filament draws a document), slides (you write Markdown; Filament draws a deck), a dashboard (you write tiles and the tables they read; Filament draws numbers, charts and tables), a design (you write screens in HTML; Filament lays them on a canvas at a phone's, a tablet's or a desktop's size) or an app (you write the page, with the commands it reads and the buttons it runs, which run in a project's Space once the developer keeps it there). Actions: \"guide\" gives Filament's rules for a type; read it before your first publish of that type in a session ({\"action\":\"guide\",\"type\":\"page\"}). \"publish\" makes a new artifact, or the next version of one, whole: {\"action\":\"publish\",\"title\":\"Expense tracker\",\"description\":\"What I spend, by category and month\",\"icon\":\"money\",\"html\":\"<!doctype html>…\"}; files beside the page go in \"files\"; a page that is a folder in the project goes by \"folder\" instead of \"html\"; a doc or slides go by \"markdown\" ({\"action\":\"publish\",\"type\":\"doc\",\"title\":\"Release notes\",\"markdown\":\"# Release notes…\"}); a dashboard by \"tiles\" and \"tables\", a design by \"screens\" and \"style\", as their guides say; give \"id\" to publish the next version of one. \"read\" gives one whole — its page and files: {\"action\":\"read\",\"id\":\"expense-tracker-k3f9\"}. \"list\" gives each one's title, name and address. \"read_db\" reads what a page keeps in filament.db: its collections ({\"action\":\"read_db\",\"id\":\"expense-tracker-k3f9\"}), or one's records with \"collection\":\"expenses\". \"write_db\" changes one collection, all or nothing: {\"action\":\"write_db\",\"id\":\"expense-tracker-k3f9\",\"collection\":\"expenses\",\"set\":[{\"amount\":12,\"category\":\"food\"}],\"update\":[{\"id\":\"r1\",\"amount\":30}],\"delete\":[\"r2\"]}. To change an artifact, read it, then publish it whole with its id: a publish over a version this session has not read is refused and hands you the newest to build on. The developer sees each publish in the chat and can open it; you are told only that it was published.",
        fields: {
          type: "guide: the type whose rules to give. publish: what a new artifact is — page (the default; you write the HTML), doc or slides (you write Markdown), dashboard (you write tiles and tables), design (you write screens), app (you write the page, with sources and actions for a project's Space). A next version keeps its type.",
          html: "publish, a page or an app: the page — a whole HTML document, or what goes inside its <body>.",
          folder: "publish, a page or an app: a folder in the project whose index.html is the page, published with every file beside it — in place of html and files.",
          tiles: "publish, a dashboard: its tiles in their order, each with kind (number, bar, line, table, status) and title, and what it reads — its guide says how.",
          sources: "publish, a dashboard or an app for a project's Space: what it reads by itself once the developer keeps it, each by its name — a command or a connection's tool, and how its answer reads; its guide says how.",
          actions: "publish, a dashboard or an app for a project's Space: buttons on its sources' rows, each by its name — a command or a connection's tool the developer runs from Filament's own sheet; its guide says how.",
        },
      },
      space: {
        text: "This project's Space, shared by the person and every chat in the project: a board of tasks (Planned, Doing, Waits for you, Done) and What happened, the logbook the chats write in, where Filament notes what each finished. Read it before you start on something the board may hold, and when a sync from the Space asks you to. \"read\": the board and the logbook's newest lines, {\"action\":\"read\"}. \"add\" a task: {\"action\":\"add\",\"title\":\"Fix the login redirect\",\"line\":\"what it is\"}. \"take\" one, yours in Doing: {\"action\":\"take\",\"id\":\"t3\"}. \"move\" one, with where it stands: {\"action\":\"move\",\"id\":\"t3\",\"to\":\"done\",\"line\":\"merged in 4f2c1a\"}. \"log\" what you did, found or decided, that the other chats and the person need — not every step: {\"action\":\"log\",\"text\":\"The API now returns 404 for a missing user.\",\"task\":\"t3\"}. More in the guide ({\"action\":\"guide\"}, or with \"topic\"): \"needs\", what waits for the person; \"dashboard\", the dashboards, their rows and buttons; \"app\", an app's state, actions and runs; \"lanes\", where each chat works and what it changed; \"draft\", what would go out, for the person to send; \"routine\", work an agent does by itself at a time; \"repro\", what you found reproducing a report; \"board\", the five above in full. Their fields go in \"with\": {\"action\":\"routine\",\"with\":{…}}.",
        fields: {},
      },
    });
    /** A lead's own tools with those three as version 93 had them; each of them is there, and each word it rewinds moved. @param {readonly any[]} set */
    const ownAsV93 = (set) => {
      assert.deepEqual(set.filter((t) => OWN_V93[t.name]).map((t) => t.name), Object.keys(OWN_V93));
      return set.map((t) => {
        const was = OWN_V93[t.name];
        if (!was) return t;
        assert.notEqual(t.description, was.text, `${t.name}'s text moved`);
        const properties = { ...t.input_schema.properties };
        for (const [k, then] of Object.entries(was.fields)) {
          assert.notEqual(properties[k].description, then, `${t.name}'s ${k} moved`);
          properties[k] = { ...properties[k], description: then };
        }
        return { ...t, description: was.text, input_schema: { ...t.input_schema, properties } };
      });
    };
    const t = /** @type {any} */ (store.find("mine"));
    const tools = leadToolsOf(t.members);
    assert.equal(asThen(JSON.stringify(t.members)), JSON.stringify(before.mine.members), "mine: its members");
    assert.deepEqual(JSON.parse(asThen(JSON.stringify(asV93Tools(asV120Tools(rosterWords(t.members)))))), before.mine.words, "mine: its lead's words");
    const v93 = asV93Tools(asV98Tools(asV99Tools(asV100Tools(asV101Tools(asV102Tools(asV103Tools(asV104Tools(asV109Tools(asV111Tools({ agent: tools.agent, worker: tools.worker, workerReads: tools.workerReads, workerReadsOwn: tools.workerReadsOwn, tasks: tools.tasks, own: tools.own, readsOwn: tools.readsOwn }))))))))));
    const weighed = asThen(JSON.stringify({ ...v93, own: asV80Envelope(asV81Envelope(asV79Tools(asV85Shell(ownAsV93(v93.own))))), readsOwn: asV80Envelope(asV81Envelope(asV79Tools(asV85Shell(ownAsV93(v93.readsOwn))))) }));
    assert.equal(createHash("sha256").update(weighed).digest("hex"), before.mine.tools, "mine: its lead's tools");
  });
});

// The review of 11-03, on this piece: what read a named seat or a member's own model past the store and the launch.
describe("a named seat and a member's own model, wherever they are read", () => {
  const HUNT = { name: "Hunt pair", lead: "product", members: [{ tag: "reviewer", name: "Hunter A", line: "Hunt the parser.", model: "m-a", effort: "low" }, { tag: "reviewer", name: "Hunter B", line: "" }] };

  // (fails before: yes — the page's rows kept a member's id, name, level and place alone: a seat named "Hunter A" wore the
  // generic glyph in the Brief, Teams home and the boards, and the Brief knew nothing of its own model)
  test("the rows the Brief and Teams home read keep a named seat's card and its own model and effort; its glyph is its card's, on a worker's board too, named as its seat", () => {
    const store = teamStore();
    const row = teamRow(store.create(HUNT));
    assert.deepEqual(
      row.members.map((m) => [m.tag, m.card ?? null, m.name, m.own ?? null]),
      [
        ["hunter-a", "reviewer", "Hunter A", { model: "m-a", effort: "low" }],
        ["hunter-b", "reviewer", "Hunter B", null],
      ],
    );
    const eye = memberLook({ tag: "reviewer", may: "read", place: "reviewer" });
    assert.deepEqual(row.members.map((m) => memberLook(m)), [eye, eye], "each seat wears its card's glyph");
    assert.deepEqual(teamRow(store.create({ name: "Plain", lead: "product", members: [{ tag: "reviewer" }] })).members[0], { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" }, "a team with no names: its rows as they were");
    assert.deepEqual(teamRow(/** @type {any} */ (store.find("builders"))).members[0], { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" }, "a shipped team's Scout: Reviewer, seated under that name");
    const frame = frameOf({ id: "sa_1", status: "running", startedAt: 0, model: "m-a", description: "Hunt it", may: "read", team: { key: "hunt-pair", name: "Hunt pair", role: "hunter-a", place: "reviewer", seat: "Hunter A" }, card: { tag: "reviewer", name: "Reviewer" }, waiting: null, progress: { round: 1, tool: null, words: "", context: null, asking: null }, exchanges: [{ startedAt: 0 }] }, 1, 1000);
    assert.deepEqual([frame.look, frame.name], [eye, "Hunter A"]);
  });

  // (fails before: yes — a worker kept its member's id alone: every surface named it by the slug or its card, and the words
  // after a provider failure sent a new one to the team's models or its card's, and blamed its card for the team's model)
  test("a named seat's worker keeps its seat's name and the team's model and effort for it: named so wherever it shows, and the words after a provider failure say the team's model", async () => {
    const store = teamStore();
    const team = store.create(HUNT);
    const w = watched({ sub: { pool: [{ model: "m-pool", seats: 8 }] } });
    const l = leadOf(w.registry, w.dir);
    const launch = async (/** @type {string} */ role, /** @type {number} */ n) => {
      const r = await l.tools.agent(callFor(l, team, { ...BRIEF, role, description: `Hunt as ${role}` }));
      assert.equal(r.ok, true, r.text);
      const run = await w.run(n);
      run.attach();
      await until(() => w.registry.get(String(r.agentId))?.runId === run.runId, "its run to attach");
      return { id: String(r.agentId), run };
    };
    const a = await launch("hunter-a", 1);
    const row = /** @type {any} */ (w.registry.get(a.id));
    assert.deepEqual([row.team.role, row.team.seat, row.card.name, row.model], ["hunter-a", "Hunter A", "Reviewer", "m-a"]);
    assert.deepEqual([w.registry.hostOf(a.id)?.team?.model, w.registry.hostOf(a.id)?.team?.effort], ["m-a", "low"]);
    assert.deepEqual([teamLib.whoOf(row).word, agentName(a.id, row).name, teamLib.workerCalled(row)], ["Hunter A", "Hunter A", "Hunter A"]);
    // (fails before: yes — the roster shrink of 11-03: its launch's event named its card alone, so the lead's order row
    // read "Reviewer" until the list stamped it)
    const started = l.timeline.find((/** @type {any} */ e) => e.type === "subagent-start" && e.agentId === a.id);
    assert.deepEqual([started?.role, started?.seat, started?.card], ["hunter-a", "Hunter A", { tag: "reviewer", name: "Reviewer" }]);
    // A rate on its provider: a new one would run on the team's model for it.
    const rate = worded({ what: "round 2's model call", where: "m-a at zai", said: "Rate limit reached", code: null, status: 429, tries: 3, began: 0, at: 2_000, streamed: { thinking: 0, text: 0 }, kept: "1 finished round is kept", next: null, cause: { kind: "rate", provider: "zai", resets: null } });
    a.run.finish({ status: "failed", report: "", error: "round 2's model call failed", failure: rate });
    await w.registry.settled(a.id);
    const [told] = l.door.inbox.take();
    assert.match(told.text, /launch its brief again as a new hunter-a, which runs on the model its team names for it, m-a;/, told.text);
    // A model its provider refuses this account: the team's choice for the seat is what the developer changes.
    const b = await launch("hunter-a", 2);
    const refused = worded({ what: "round 1's model call", where: "m-a at zai", said: "no access to the model", code: null, status: 403, tries: 1, began: 0, at: 2_000, streamed: { thinking: 0, text: 0 }, kept: "", next: null, cause: { kind: "model", provider: "zai", resets: null } });
    b.run.finish({ status: "failed", report: "", error: "round 1's model call failed", failure: refused });
    await w.registry.settled(b.id);
    const [blamed] = l.door.inbox.take();
    assert.match(blamed.text, /Tell the developer: the Hunt pair team's hunter-a needs a model zai serves this account in place of m-a\.\]$/, blamed.text);
    l.door.close();
  });

  // (fails before: yes — a card seated twice read each seat's own line, and a seat with none said nothing of what it does)
  test("a card seated twice, a seat with no line of its own: the lead reads its card's good-for there", () => {
    const words = rosterWords(teamStore().create(HUNT).members);
    assert.ok(words.roles.includes("  - `hunter-a` (Hunter A): Hunt the parser. It changes nothing."), words.roles);
    assert.match(words.roles, /\n {2}- `hunter-b` \(Hunter B\): [^.]+\. It changes nothing\./, "the Reviewer card's own line");
  });

  // (fails before: yes — a team of yours held, its card gone, kept no new card from its seat's name: it came back with
  // two answering to one word)
  test("a held team's seat name keeps a new card from that tag, as a team in use's does", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-team-held-"));
    try {
      writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: { held: { name: "Held", lead: "gone-lead", members: [{ tag: "reviewer", name: "Spotter", line: "" }] } } }));
      const store = teamStore({ dataDir: dir });
      assert.deepEqual(store.held().map((h) => h.key), ["held"]);
      assert.equal(store.memberNamed("spotter"), "Held");
      refuses(() => store.cards.create({ from: "reviewer", tag: "spotter", name: "My Spotter" }), 400, /^`spotter` is what the Held team calls one of its workers/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
