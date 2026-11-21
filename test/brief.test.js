// @ts-check
// team_v2_plan §10 O1, the mock of 10-19, on the fake DOM: a team's Brief (views/brief.js) — the one sheet a team starts
// from, On the side or In charge, which opens on nothing running and starts the team at Send alone — the Teams tab's
// home (views/teams-home.js), and their words (lib/brief.js).
// (fails before: yes — no Brief and no home: a team started from a fire card on the Team tab, or Lead with this team)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openBrief } from "../src/ui/harness/views/brief.js";
import { createTeamsHome } from "../src/ui/harness/views/teams-home.js";
import { HOW_PREF, NARROW, OPTIONS_PREF, PICKS_PREF, WAYS, defaultsLine, fitOf, groupsOf, keepPicks, leadFrom, memberLook, narrowed, optionsHolds, optionsWhy, ownModels, picksOf, readsLines, tokWords, usualWay, workersFrom } from "../src/ui/harness/lib/brief.js";
// d-side's exports (11-12) are read through the modules' namespaces, so the file loads on the code before them and
// each of its tests fails on its own there.
import * as briefWords from "../src/ui/harness/lib/brief.js";
import * as teamWords from "../src/ui/harness/lib/team.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamRow } from "../src/core/roster.js";
import { teamStore } from "./helpers/team.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => /** @type {any} */ (buttonsOf(n).find((b) => textOf(b) === words));
/** The node under `n` its aria-label names. @param {any} n @param {string} label */
const labelled = (n, label) => all(n, (x) => x.attrs?.["aria-label"] === label)[0];
/** The switch under `n` its label names. @param {any} n @param {string} label */
const switchOf = (n, label) => all(n, (x) => x.attrs?.role === "switch" && x.attrs["aria-label"] === label)[0];
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

// The crew every team that builds ships with: Reviewer seated as the Scout, Builder seated as the Tester.
const FOUR = [
  { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", card: "builder", name: "Tester", may: "edit", place: "builder" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
// As a person set them: the Bug Hunter names models of its own, the others none. BugHunters (the plan's p6) checks the
// others' results: a Hunter and a Checker, both Reviewer's seats.
const HUNTER = { key: "bug-hunter", name: "Bug Hunter", line: "Many hunters at once, each finding shown in the code", shipped: true, readOnly: true, leadModel: "Claude Opus 5.5", models: ["GLM 5.3 Flash"], most: null, lead: { tag: "bug-hunter", name: "Bug Hunter" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", may: "read", place: "reviewer" }] };
const BUGHUNTERS = { key: "bughunters", name: "BugHunters", line: "Finds bugs and checks claims, fixing nothing: each finding checked against the code", shipped: true, readOnly: true, leadModel: null, models: [], most: null, lead: { tag: "huntlead", name: "BugHunters" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", may: "read", place: "reviewer" }, { tag: "checker", card: "reviewer", name: "Checker", may: "read", place: "reviewer" }] };
// The one shipped team that builds (the plan's p6).
const BUILDERS = { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, readOnly: false, leadModel: null, models: [], most: null, check: null, lead: { tag: "buildlead", name: "Builders" }, members: FOUR };
// A team of the person's own whose one worker only reads, as the store saves it: it looks and checks, and nothing
// holds it to reading — in charge its lead has its own hands, under the chat's mode.
const READERS = teamRow(teamStore().create({ name: "Readers", lead: "product", members: [{ tag: "reviewer" }] }));
/** In charge, as any team's Brief said it before d-side, and as a team that is not held to reading still says it. */
const CHARGE = {
  line: "Its lead takes your agent's place in this chat and answers your messages from now on.",
  short: "The team's lead takes your agent's place in this chat. You talk to the lead from now on.",
  orders: "its launches, its messages to its workers and its applies — your messages reach its lead at its next step",
  note: "It brings changes into your folder; it commits nothing.",
};
/** In charge of a chat, a team that changes no file: what its Brief says before Send. @param {string} name */
const chargeReads = (name) => {
  const line = `Its lead takes your agent's place in this chat, and the chat only reads while it is in charge, whatever its mode: ${name} changes no file.`;
  return { line, short: line, orders: "its launches and its messages to its workers — your messages reach its lead at its next step", note: "It changes no file: its lead and its workers only read here." };
};
/** What a lead would read, as `GET …/beside/reads` answers it. */
const FACTS = { tokens: 84_000, turns: 3, form: "plain", cut: false, running: { rounds: 4 }, waiting: false, compactions: 1, window: 200_000, lead: "m-1" };
/** The catalogue's families and the coding agents' accounts, as the page holds them. */
const FAMS = [{ id: "m-1", upstream: "u1", kind: "model", members: [{ id: "m-1" }] }];
const ACCOUNTS = [{ upstream: "claude-code", account: null }];

describe("the Brief's words", () => {
  test("token counts, the narrowing presses, the two groups and each member's look", () => {
    assert.deepEqual([tokWords(900), tokWords(84_000), tokWords(1_200_000), tokWords(12_000_000)], ["≈900", "≈84k", "≈1.2M", "≈12M"]);
    // (fails before: yes — found by the Bug Hunter, 10-19: 999,500 read "≈1000k")
    assert.deepEqual([tokWords(999_499), tokWords(999_500), tokWords(1_000_000)], ["≈999k", "≈1M", "≈1M"]);
    const since = NARROW.find((n) => n.id === "since")?.words;
    assert.equal(narrowed("find bugs", "since"), `find bugs ${since}`);
    assert.equal(narrowed(narrowed("find bugs", "since"), "since"), "find bugs", "a second press takes it out");
    assert.equal(narrowed("", "since"), since);
    assert.equal(narrowed("find bugs", "nope"), "find bugs");
    const g = groupsOf([HUNTER, BUILDERS, BUGHUNTERS, { ...BUILDERS, key: "ro", readOnly: true }]);
    assert.deepEqual([g.look.map((t) => t.key), g.build.map((t) => t.key)], [["bug-hunter", "bughunters", "ro"], ["builders"]], "a team set read-only looks and checks, whatever its members may");
    assert.deepEqual([usualWay(HUNTER), usualWay(BUILDERS)], ["side", "charge"]);
    // ("Teams, improved and kept" of 11-03: the Hunter and the Checker are Reviewer's seats, and wear its eye; the Scout too)
    assert.deepEqual([memberLook(HUNTER.members[0]), memberLook(BUGHUNTERS.members[1]), memberLook(FOUR[1]), memberLook(FOUR[0]), memberLook({ tag: "mine", may: "read", place: null })],
      [{ icon: "eye", tone: "blue" }, { icon: "eye", tone: "blue" }, { icon: "hammer", tone: "orange" }, { icon: "eye", tone: "blue" }, { icon: "search", tone: "cyan" }]);
  });

  test("what a lead reads and how it fits its window; where each model comes from", () => {
    assert.deepEqual(readsLines(FACTS), {
      head: "This whole chat",
      fig: "3 turns · ≈84k tokens",
      running: "with the turn running now — round 4, up to this moment",
      rest: "1 compaction, as they stand · no question waiting for you",
    });
    assert.equal(readsLines({ ...FACTS, turns: 1, running: null, compactions: 0, waiting: true, form: "compact", cut: true }).rest,
      "no compaction · the question waiting for you · condensed the way this chat's compaction condenses it, to fit · its oldest part left out to fit");
    assert.deepEqual(fitOf(FACTS), { share: 0.42, tone: "tight", words: "Fits: ≈84k of its lead's 200k window. The chat may take half at most; the rest is room for its workers' reports." });
    assert.equal(fitOf({ ...FACTS, tokens: 20_000 }).words.startsWith("Fits easily: ≈20k of its lead's 200k window."), true);
    assert.equal(leadFrom({ pick: "m-2", team: HUNTER, on: null }), "for this run");
    assert.equal(leadFrom({ pick: "", team: HUNTER, on: null }), "the team's");
    assert.equal(leadFrom({ pick: "", team: HUNTER, on: { lead: "m-1", workers: null, from: "seats", fell: [{ name: "Claude Opus 5.5", why: "", as: "lead" }] } }), "this chat's model", "the team's could not run");
    assert.equal(leadFrom({ pick: "", team: BUILDERS, on: null }), "this chat's model");
    // (fails before: yes — the owner's 10-19 list) A model of its lead's list passed for the next is still the team's.
    assert.equal(leadFrom({ pick: "", team: HUNTER, on: { lead: "m-3", workers: null, from: "seats", fell: [{ name: "Claude Opus 5.5", why: "", as: "lead", next: "m-3" }] } }), "the team's");
    // (fails before: yes — tm-a: the words beside the picker said the rule, "each member's card's, else this chat's
    // list", under a picker that shows the model) Beside the picker, whose list its model is of; the rule whole — each
    // worker's card's first — is the picker's tip.
    assert.deepEqual(workersFrom(null, ["m-2", "m-3"]), { first: "m-2", words: "this chat's list", tip: "each worker's card's, else this chat's list", cards: true });
    // (fails before: yes — the owner's 10-27: the chip showed the list's first as though it were the one model)
    assert.deepEqual(workersFrom({ lead: null, workers: ["m-2", "m-3"], from: "team", fell: [] }), { first: "m-2", words: `first of the team's models · then ${prettyModel("m-3")}`, tip: `first of the team's models · then ${prettyModel("m-3")}`, cards: false });
    assert.deepEqual(workersFrom({ lead: null, workers: ["m-4"], from: "chat", fell: [] }), { first: "m-4", words: "this chat's list", tip: "each worker's card's, else this chat's list", cards: true });
    // (fails before: yes — the owner's plan of 11-05: a chat's own rows for a team)
    assert.deepEqual(workersFrom({ lead: null, workers: ["m-4", "m-2"], from: "here", fell: [] }), { first: "m-4", words: `first of this chat's models for the team · then ${prettyModel("m-2")}`, tip: `first of this chat's models for the team · then ${prettyModel("m-2")}`, cards: false });
    assert.equal(leadFrom({ pick: "", team: HUNTER, on: { lead: "m-4", leadFrom: "here", workers: null, from: "seats", fell: [] } }), "this chat's for the team");
    const project = `first of this project's list · then ${prettyModel("m-2")}, ${prettyModel("m-3")}`;
    assert.deepEqual(workersFrom({ lead: null, workers: ["m-4", "m-2", "m-3"], from: "project", fell: [] }), { first: "m-4", words: project, tip: `each worker's card's, else ${project}`, cards: true });
    assert.deepEqual(workersFrom({ lead: null, workers: null, from: "seats", fell: [] }, ["m-2", "m-3"]), { first: "m-2", words: `first of this chat's list · then ${prettyModel("m-3")}`, tip: `each worker's card's, else first of this chat's list · then ${prettyModel("m-3")}`, cards: true });
    assert.deepEqual(workersFrom({ lead: null, workers: ["m-3"], from: "picked", fell: [] }), { first: "m-3", words: "for this run: this model alone, none after it", tip: "for this run: this model alone, none after it", cards: false });
  });

  // (fails before: yes — the rework of 11-11: the page said one model for a team's workers, of those too that never run
  // on it) The workers the page knows a model of their own for: a seat the team names one for, over any pick and any
  // list; a card's first where each worker's card comes before the list.
  test("the workers with a model of their own: a seat's, whatever comes after; a card's, where cards come before the list", () => {
    const members = [{ name: "Hunter", model: "m-c" }, { name: "Checker", model: "m-c", own: { model: "m-o", effort: "low" } }, { name: "Scout", model: null, own: { effort: "high" } }];
    assert.deepEqual(ownModels(members, true), [{ name: "Hunter", model: "m-c", whose: "card" }, { name: "Checker", model: "m-o", whose: "team" }]);
    assert.deepEqual(ownModels(members, false), [{ name: "Checker", model: "m-o", whose: "team" }], "a list that comes before the cards: the seat's own alone");
    assert.deepEqual([ownModels([], true), ownModels(BUILDERS.members, true)], [[], []]);
  });

  // (fails before: yes — tm-a: a Brief showed about ten choices at once, each with a default nobody said as an outcome)
  test("the defaults in one line, as outcomes: what its lead reads, where its result goes with each switch, what runs; in charge, that its lead answers this chat", () => {
    const runs = `lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}`;
    const side = { way: /** @type {const} */ ("side"), reads: /** @type {const} */ ("chat"), verify: false, notify: false, lead: "m-1", workers: "m-2" };
    assert.equal(defaultsLine(side), `Its lead reads this whole chat · its result comes to you · ${runs}`);
    assert.equal(defaultsLine({ ...side, verify: true }), `Its lead reads this whole chat · its result comes to you, checked by BugHunters first · ${runs}`);
    assert.equal(defaultsLine({ ...side, notify: true }), `Its lead reads this whole chat · its result comes to you, then to your agent · ${runs}`);
    assert.equal(defaultsLine({ ...side, verify: true, notify: true }), `Its lead reads this whole chat · its result comes to you, checked by BugHunters first, then to your agent · ${runs}`);
    assert.equal(defaultsLine({ ...side, reads: "words" }), `Its lead reads only what you write here · its result comes to you · ${runs}`);
    assert.equal(defaultsLine({ ...side, reads: "words", verify: true, notify: true }), `Its lead reads only what you write here · its result comes to you, checked by BugHunters first, then to your agent · ${runs}`);
    assert.equal(defaultsLine({ ...side, cut: true }), `Its lead reads this chat, its oldest part left out · its result comes to you · ${runs}`);
    assert.equal(defaultsLine({ ...side, reads: "words", cut: true }), `Its lead reads only what you write here · its result comes to you · ${runs}`, "a fresh start reads none of the chat: nothing of it is left out");
    assert.equal(defaultsLine({ ...side, lead: "", workers: "" }), "Its lead reads this whole chat · its result comes to you", "a model not known yet is not said");
    assert.equal(defaultsLine({ ...side, workers: "" }), `Its lead reads this whole chat · its result comes to you · lead on ${prettyModel("m-1")}`);
    // In charge: no reading to choose and no result to send on — its lead answers this chat.
    assert.equal(defaultsLine({ ...side, way: "charge" }), `Its lead answers this chat · ${runs}`);
    assert.equal(defaultsLine({ ...side, way: "charge", reads: "words", verify: true, notify: true, cut: true }), `Its lead answers this chat · ${runs}`, "the side's choices say nothing in charge");
    assert.equal(defaultsLine({ ...side, way: "charge", lead: "", workers: "" }), "Its lead answers this chat");
    // (fails before: yes — the rework of 11-11) Workers with a model of their own are not said to run on the list's.
    assert.equal(defaultsLine({ ...side, own: "some" }), `Its lead reads this whole chat · its result comes to you · lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}, or their own`);
    assert.equal(defaultsLine({ ...side, own: "all" }), `Its lead reads this whole chat · its result comes to you · lead on ${prettyModel("m-1")} · workers on their own models`);
    assert.equal(defaultsLine({ ...side, way: "charge", workers: "", own: "all" }), `Its lead answers this chat · lead on ${prettyModel("m-1")} · workers on their own models`);
  });

  // (fails before: yes — tm-a: nothing was folded, so nothing said what a fold held or why it stood open)
  test("what Options hold, by the way and for a hunt; and why they open by themselves: a model that cannot run, a chat that does not fit its lead's window whole", () => {
    assert.equal(optionsHolds("side", false), "what its lead reads, what happens when it's done, the models");
    assert.equal(optionsHolds("side", true), "what to hunt in, what its lead reads, what happens when it's done, the models");
    assert.equal(optionsHolds("charge", false), "what its lead reads, its orders, the models, what changes in this chat");
    assert.equal(optionsHolds("charge", true), "what its lead reads, its orders, the models, what changes in this chat", "a range is a hunt's on the side");
    const none = { way: /** @type {const} */ ("side"), reads: /** @type {const} */ ("chat"), on: { lead: "m-1", workers: ["m-2"], from: /** @type {const} */ ("team"), fell: [] }, facts: FACTS };
    assert.deepEqual(optionsWhy(none), []);
    assert.deepEqual(optionsWhy({ ...none, on: null, facts: null }), [], "nothing read yet: nothing to say");
    const opus = { name: "Claude Opus 5.5", why: "signed out", as: /** @type {const} */ ("lead") };
    assert.deepEqual(optionsWhy({ ...none, on: { ...none.on, fell: [opus] } }), ["Claude Opus 5.5 cannot run now: see The team"]);
    assert.deepEqual(optionsWhy({ ...none, way: "charge", on: { ...none.on, fell: [opus, { name: "Kimi K3", why: "", as: "workers" }] } }), ["2 models cannot run now: see The team"]);
    assert.deepEqual(optionsWhy({ ...none, facts: { ...FACTS, cut: true } }), ["This chat does not fit its lead's window whole: see What its lead reads"]);
    assert.deepEqual(optionsWhy({ ...none, on: { ...none.on, fell: [opus] }, facts: { ...FACTS, cut: true } }), ["Claude Opus 5.5 cannot run now: see The team", "This chat does not fit its lead's window whole: see What its lead reads"]);
    // Tight but whole (the meter's orange) fits: nothing cannot stand. A fresh start, and in charge, read no record.
    assert.equal(fitOf(FACTS).tone, "tight");
    assert.deepEqual([optionsWhy({ ...none, reads: "words", facts: { ...FACTS, cut: true } }), optionsWhy({ ...none, way: "charge", facts: { ...FACTS, cut: true } })], [[], []]);
  });

  // (fails before: yes — d-side, 11-12: `briefWords.chargeWords is not a function`. In charge said one line of every
  // team, and under Options that a team that changes no file applies changes and brings them into your folder)
  test("In charge, in a team's words: one the server holds to reading says the chat only reads while it is in charge, and that it applies nothing; a team that builds, and one of yours whose workers all read, say what In charge always said", () => {
    assert.deepEqual(briefWords.chargeWords(BUGHUNTERS), chargeReads("BugHunters"));
    assert.deepEqual(briefWords.chargeWords(HUNTER), chargeReads("Bug Hunter"), "by its row's readOnly, whoever ships it");
    assert.deepEqual(briefWords.chargeWords(BUILDERS), CHARGE);
    // A team of yours whose workers all read goes on the side by default, as BugHunters does, and is not held: the
    // server keys on `readOnly`, and so do the words.
    assert.deepEqual([READERS.key, READERS.readOnly, READERS.members.map((m) => m.may), usualWay(READERS)], ["readers", false, ["read"], "side"]);
    assert.deepEqual(briefWords.chargeWords(READERS), CHARGE);
    assert.deepEqual([briefWords.chargeWords(null), briefWords.chargeWords(undefined)], [CHARGE, CHARGE], "no team picked yet");
    // The two ways' own words stand as they were: any other team's card says them.
    assert.deepEqual([WAYS.charge.line, WAYS.charge.short], [CHARGE.line, CHARGE.short]);
    // The sentence is kept once, with the chip's (lib/team.js): the Brief ends its own line with it.
    assert.equal(chargeReads("BugHunters").line, teamWords.readsOnlyAhead("BugHunters", "Its lead takes your agent's place in this chat"));
    // Never the default: the Brief opens on the side for each team that changes no file, held or not.
    assert.deepEqual([BUGHUNTERS, HUNTER, READERS, BUILDERS].map(usualWay), ["side", "side", "side", "charge"]);
  });
});

/**
 * A Brief on the fake DOM, over a chat and a host that record what it asks: its model pickers and menus as stand-ins,
 * and a store that holds `kept` as the team's last picks.
 * @param {{ fill?: any, chat?: any, seats?: string[], models?: string[], kept?: string, runsOn?: (team: string, pick: any) => any, teams?: any[],
 *   facts?: any, prefs?: Record<string, string> }} [o]  `facts`: what its lead would read; `prefs`: what the store holds besides the last picks
 */
const briefWith = (o = {}) => {
  const rec = { fired: /** @type {any[]} */ ([]), handed: /** @type {any[]} */ ([]), asked: /** @type {any[]} */ ([]), reads: /** @type {any[]} */ ([]), menus: /** @type {any[][]} */ ([]), stops: 0, opened: 0, closed: 0 };
  /** @type {Map<string, string>} */
  const kept = new Map([...(o.kept ? [[PICKS_PREF, o.kept]] : []), ...Object.entries(o.prefs || {})].map(([k, v]) => /** @type {[string, string]} */ ([k, v])));
  /** @type {any[]} */
  const pickers = [];
  /** A model picker: its chip, what it was given, the model it shows. @param {any} cb */
  const picker = (cb) => {
    const p = { el: fakeH("button", { class: "model-chip" }), cb, shown: "", note: /** @type {string | null} */ (null), given: /** @type {Record<string, any>} */ ({}),
      /** @param {string} n */ set(n) { p.shown = n; },
      /** @param {any} v */ setModels(v) { p.given.models = v; },
      /** @param {any} v */ setFamilies(v) { p.given.families = v; },
      /** @param {any} v */ setAccounts(v) { p.given.accounts = v; },
      /** @param {string | null} n */ setNote(n) { p.note = n; },
      setLocked() {}, open() {}, name: () => p.shown, family: () => null };
    pickers.push(p);
    return p;
  };
  /** @param {any[]} items */
  const menu = (items) => (rec.menus.push(items), { el: fakeH("div", {}), close() {} });
  /** The picker its label names. @param {string} label */
  const pickerOf = (label) => pickers.find((p) => p.el.attrs["aria-label"] === label);
  let chat = { title: "opus55", model: "m-1", live: false, round: null, paused: false, workersAtWork: false, tokens: 84_000, compactions: 1, turns: 3, cost: { tokens: 84_000, usd: 0.25 }, ...o.chat };
  let fireOk = true;
  /** @type {"now" | "after" | false} */
  let hand = "now";
  const io = {
    teams: () => o.teams ?? [HUNTER, BUGHUNTERS, BUILDERS],
    chat: () => /** @type {any} */ (chat),
    models: () => o.models ?? ["m-1", "m-2"],
    families: () => FAMS,
    accounts: () => ACCOUNTS,
    seats: () => o.seats ?? ["m-2"],
    reads: async (/** @type {string} */ team, /** @type {string} */ model) => (rec.reads.push([team, model]), o.facts ?? FACTS),
    preview: async () => "<main-chat>the record</main-chat>",
    runsOn: async (/** @type {string} */ team, /** @type {any} */ pick) => (rec.asked.push([team, pick]), o.runsOn ? o.runsOn(team, pick) : { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }),
    fire: async (/** @type {any} */ b) => (rec.fired.push(b), fireOk),
    handOver: async (/** @type {any} */ x) => (rec.handed.push(x), hand),
    stopTurn: () => { rec.stops++; },
  };
  const sheet = (/** @type {any} */ s) => ({ el: fakeH("div", { class: "sheet" }, s.head, s.body, s.foot), close: () => { rec.closed++; s.onClose?.(); } });
  const b = openBrief(/** @type {any} */ (io), o.fill || {}, { h: fakeH, place, sheet, modelSelect: /** @type {any} */ (picker), menu: /** @type {any} */ (menu),
    store: { get: (k) => kept.get(k) ?? null, set: (k, v) => { kept.set(k, v); } } });
  return {
    b, rec, kept, pickerOf,
    /** A model picked in a picker, as the person picks one. @param {string} label @param {string} name */
    pick: (label, name) => pickerOf(label).cb.onChange(name),
    /** The model a picker shows. @param {string} label */
    shown: (label) => pickerOf(label)?.shown,
    chat: (/** @type {any} */ c) => { chat = { ...chat, ...c }; },
    refuse: () => { fireOk = false; },
    allow: () => { fireOk = true; },
    /** @param {"now" | "after" | false} v */
    hand: (v) => { hand = v; },
  };
};
/** The Brief's Send. @param {any} b */
const sendOf = (b) => all(b.el, (x) => x.attrs?.class === "br-send")[0];
/** Type into the Brief's box. @param {any} b @param {string} words */
const type = (b, words) => all(b.el, (x) => x.tag === "textarea")[0].dispatch("input", { target: { value: words } });

describe("a team's Brief", () => {
  test("it opens on the team's usual way and starts nothing; Send waits for words, then starts its lead on the side with what was picked; a refusal keeps it open", async () => {
    const { b, rec, refuse, allow, pick } = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    assert.equal(textOf(one(b.el, "br-title")), "Brief the Bug Hunter");
    assert.equal(textOf(one(b.el, "br-line")), "Many hunters at once, each finding shown in the code. Nothing runs until you press Send.");
    assert.deepEqual([b.state().way, one(b.el, "is-side").attrs["aria-checked"], one(b.el, "is-charge").attrs["aria-checked"]], ["side", "true", "false"]);
    assert.deepEqual([rec.fired, rec.handed, rec.reads], [[], [], [["bug-hunter", ""]]], "opening reads what its lead would read, and starts nothing");
    // What its lead reads, before Send.
    assert.equal(textOf(one(b.el, "br-rd-fig")), "opus55 · 3 turns · ≈84k tokens");
    assert.equal(textOf(one(b.el, "is-live")), "with the turn running now — round 4, up to this moment");
    assert.equal(textOf(one(b.el, "br-fit-words")), fitOf(FACTS).words);
    assert.equal(textOf(one(b.el, "br-to")), "To: Bug Hunter's lead");
    // Send waits for words.
    assert.deepEqual(["disabled" in sendOf(b).attrs, sendOf(b).attrs.title], [true, "Say what it is to do"]);
    type(b, "find bugs in the last 5 phases");
    assert.deepEqual(["disabled" in sendOf(b).attrs, textOf(sendOf(b))], [false, "Send"]);
    btn(b.el, "since my last message").dispatch("click");
    assert.equal(b.state().ask, `find bugs in the last 5 phases ${NARROW[0].words}`);
    btn(b.el, "since my last message").dispatch("click");
    assert.equal(b.state().ask, "find bugs in the last 5 phases", "a second press takes it out");
    // (fails before: yes — the owner's word of 11-05: the Brief stepped how many ran at once, and how many in all) No number
    // of the Brief's own: as many as the lead needs, each model's limit holding.
    assert.deepEqual([one(b.el, "br-step-n"), labelled(b.el, "More at once"), labelled(b.el, "How many workers its lead launches in all this run"), one(b.el, "br-room")], [undefined, undefined, undefined, undefined]);
    assert.equal(all(one(b.el, "br-party"), (x) => String(x.attrs?.class).includes("s28")).length, 1, "a team of one kind: its one");
    assert.equal(textOf(one(one(b.el, "br-party"), "br-mul")), "× as many as needed");
    assert.equal(textOf(all(one(b.el, "br-workers"), (x) => x.attrs?.class === "br-note")[0]), "The lead decides how many it needs; a model at its limit, set on its row under its provider, passes one to the next.");
    // When it's done: both off, until switched on.
    assert.match(textOf(one(b.el, "br-then")), /Its result comes to you\|always/);
    assert.match(textOf(all(b.el, (x) => x.attrs?.class === "br-note")[0]), /^Off: the result waits for you on the Agents tab/);
    switchOf(b.el, "Check it with BugHunters first").dispatch("click");
    switchOf(b.el, "Hand its result to your agent").dispatch("click");
    assert.equal(textOf(all(b.el, (x) => x.attrs?.class === "br-note")[0]), "Your agent gets BugHunters' check of the result by itself when it is done: into its running turn, else a turn of its own.");
    // A refusal: the host said why; the Brief stays as it was.
    refuse();
    sendOf(b).dispatch("click");
    await settle();
    assert.deepEqual(rec.fired, [{ team: "bug-hunter", ask: "find bugs in the last 5 phases", model: null, workers: null, effort: null, workersEffort: null, verify: true, notify: true, of: null, reads: "chat" }]);
    assert.deepEqual([rec.closed, b.state().sending, "disabled" in sendOf(b).attrs], [0, false, false], "kept, to try again");
    // (fails before: yes — found by the Bug Hunter, 10-19: picking the Verifier turned its switch off for good) Nothing
    // checks BugHunters' own result, and the switch is as it was for the team picked after it.
    const sel = /** @type {any} */ (all(b.el, (x) => x.attrs?.["aria-label"] === "Change team")[0]);
    sel.value = "bughunters";
    sel.dispatch("change", { target: sel });
    assert.equal(switchOf(b.el, "Check it with BugHunters first"), undefined);
    assert.equal(textOf(all(b.el, (x) => x.attrs?.class === "br-note")[0]), "Your agent gets its result by itself when it is done: into its running turn, else a turn of its own.");
    sel.value = "bug-hunter";
    sel.dispatch("change", { target: sel });
    assert.equal(textOf(all(b.el, (x) => x.attrs?.class === "br-note")[0]), "Your agent gets BugHunters' check of the result by itself when it is done: into its running turn, else a turn of its own.");
    // Its workers picked for this run: asked again what it runs on, sent with it.
    pick("Its workers run on", "m-1");
    await settle();
    assert.deepEqual(rec.asked.at(-1), ["bug-hunter", { model: "", workers: "m-1" }]);
    allow();
    sendOf(b).dispatch("click");
    await settle();
    assert.deepEqual([rec.fired[1].workers, rec.closed], ["m-1", 1], "started: the Brief closes");
  });

  // (fails before: yes — a model the team named that could not run was passed over in silence: its lead took the chat's)
  test("the squad says what its lead and workers run on and where each comes from, before Send; each model it names that cannot run, with why; BugHunters' hint", async () => {
    const { b, rec, pick, shown, pickerOf } = briefWith({
      fill: { team: "bug-hunter" },
      runsOn: (team) => (team === "bug-hunter"
        ? { lead: "m-1", workers: null, from: "seats", fell: [{ name: "Claude Opus 5.5", why: "signed out", as: "lead" }] }
        : { lead: "m-1", workers: null, from: "seats", fell: [] }),
    });
    await settle();
    assert.deepEqual(rec.asked[0], ["bug-hunter", { model: "", workers: "" }], "asked for the team as picked");
    assert.deepEqual([shown("Its lead runs on"), shown("Its workers run on")], ["m-1", "m-2"], "each picker shows what it runs on unpicked");
    // (fails before: yes — tm-a: the rule stood beside a picker that shows the model) Whose list it is beside the
    // picker; the rule whole in the picker's tip.
    assert.deepEqual(all(b.el, (x) => x.attrs?.class === "br-from").map(textOf), ["this chat's model", "this chat's list"]);
    assert.deepEqual([pickerOf("Its lead runs on").note, pickerOf("Its workers run on").note], ["this chat's model", "each worker's card's, else this chat's list"]);
    assert.deepEqual(all(one(b.el, "br-fell"), (x) => String(x.attrs?.class).includes("is-warn")).map(textOf), ["Claude Opus 5.5 cannot run now (signed out): its lead runs on this chat's model"]);
    assert.equal(textOf(one(b.el, "br-tag")), "Read-only · changes no file");
    // BugHunters: nothing checks its own result; a hint where its Checker runs on the default, never a lock.
    labelled(b.el, "Change team").dispatch("change", { target: { value: "bughunters" } });
    await settle();
    assert.deepEqual([b.state().team, b.state().way, switchOf(b.el, "Check it with BugHunters first")], ["bughunters", "side", undefined]);
    assert.ok(switchOf(b.el, "Hand its result to your agent"), "Hand its result to your agent stays");
    assert.equal(textOf(one(b.el, "is-hint")), "Checks are only as good as the model that makes them: a strong one is usual for the Checker — give it its own on Library › Agents and teams.");
    pick("Its workers run on", "m-2");
    await settle();
    assert.equal(one(b.el, "is-hint"), undefined, "a model picked: the hint has said its piece");
    // With no list of this chat's, the workers run on each worker's card's, else on its lead's model, and the Brief says so.
    const bare = briefWith({ fill: { team: "bughunters" }, seats: [], runsOn: () => ({ lead: "m-1", workers: null, from: "seats", fell: [] }) });
    await settle();
    assert.deepEqual([bare.shown("Its workers run on"), all(bare.b.el, (x) => x.attrs?.class === "br-from").map(textOf)[1], bare.pickerOf("Its workers run on").note],
      ["m-1", "its lead's model", "each worker's card's, else its lead's model"]);
  });

  // (fails before: yes — the owner's 10-27: unpicked, the workers' chip showed the list's first like a pick, and a pick
  // dropped the rest of the list unsaid)
  test("unpicked, each picker shows what runs dimmed; a workers' pick says it runs alone, and Use the list puts the list back", async () => {
    const { b, rec, pick, pickerOf } = briefWith({ fill: { team: "bug-hunter" }, runsOn: (_t, p) => (p.workers
      ? { lead: "m-1", workers: [p.workers], from: "picked", fell: [] }
      : { lead: "m-1", workers: ["m-2", "m-3"], from: "chat", fell: [] }) });
    await settle();
    const lead = pickerOf("Its lead runs on");
    const crew = pickerOf("Its workers run on");
    const from = () => all(b.el, (x) => x.attrs?.class === "br-from").map(textOf)[1];
    const row = () => all(b.el, (x) => x.attrs?.class === "br-model-row")[1];
    assert.deepEqual([lead.el.classList.contains("is-default"), crew.el.classList.contains("is-default"), crew.shown], [true, true, "m-2"]);
    assert.equal(from(), `first of this chat's list · then ${prettyModel("m-3")}`);
    assert.equal(btn(row(), "Use the list"), undefined, "nothing picked: nothing to put back");
    pick("Its workers run on", "m-3");
    await settle();
    assert.deepEqual([crew.el.classList.contains("is-default"), crew.shown, from()], [false, "m-3", "for this run: this model alone, none after it"]);
    btn(row(), "Use the list").dispatch("click");
    await settle();
    assert.deepEqual([b.state().workers, crew.el.classList.contains("is-default"), crew.shown, rec.asked.at(-1)], ["", true, "m-2", ["bug-hunter", { model: "", workers: "" }]]);
    assert.equal(from(), `first of this chat's list · then ${prettyModel("m-3")}`, "the list is back, not the defaults' first");
    pick("Its lead runs on", "m-2");
    assert.equal(lead.el.classList.contains("is-default"), false, "a lead picked is no default");
  });

  test("In charge: what changes in this chat, what it costs once, its orders; while your agent works Send hands over after the turn, and Stop the turn stops it; a question waiting holds Send", async () => {
    const { b, rec, hand } = briefWith({ fill: { team: "builders" }, chat: { live: true, round: 4 } });
    await settle();
    assert.equal(b.state().way, "charge", "a team that changes files opens In charge");
    assert.deepEqual(rec.reads, [], "In charge reads the chat as the lead will: nothing to ask the server");
    assert.equal(textOf(one(one(b.el, "br-changes"), "br-sec-label")), "What changes in this chat");
    assert.equal(all(b.el, (x) => String(x.attrs?.class).startsWith("br-lane ") || x.attrs?.class === "br-lane").length, 3);
    assert.equal(textOf(one(b.el, "br-rd-fig")), "3 turns · 1 compaction · ≈84k tokens");
    assert.equal(textOf(one(one(b.el, "br-cost"), "br-cost-head")), "Costs once: ≈84k tokens · ≈$0.25");
    assert.equal(textOf(one(one(b.el, "br-folder"), "br-cost-head")), "Your folder stays yours");
    assert.deepEqual([textOf(one(b.el, "br-chip-model")), all(b.el, (x) => x.attrs?.class === "br-from").map(textOf)[0]], [prettyModel("m-1"), "this chat's model and effort — change them in the box"]);
    assert.equal(labelled(b.el, "Its lead runs on"), undefined, "no pick for the lead: it runs on this chat's model");
    assert.equal(textOf(one(b.el, "br-tag")), "Changes files");
    // Its orders go out at once: a line that says so, with nothing to switch.
    const orders = one(b.el, "br-then");
    // (fails before: yes — tm-a: the sections counted 1, 2, 3 where one stands open)
    assert.ok(all(b.el, (x) => x.attrs?.class === "br-sec-head").map(textOf).includes("Its orders to its workers"));
    assert.deepEqual(all(orders, (x) => x.attrs?.class === "br-stp-text").map(textOf), ["They go out at once|its launches, its messages to its workers and its applies — your messages reach its lead at its next step"]);
    assert.equal(all(orders, (x) => x.attrs?.role === "switch").length, 0);
    // Your agent works: Send keeps the words and hands over when the turn ends.
    assert.match(textOf(one(b.el, "br-wait")), /^Your agent is working \(round 4\)\.\| Send keeps your words/);
    btn(b.el, "Stop the turn").dispatch("click");
    assert.equal(rec.stops, 1);
    type(b, "Build the logbook: newest first, one line each");
    assert.equal(textOf(sendOf(b)), "Send — hand over after this turn");
    hand("after");
    sendOf(b).dispatch("click");
    await settle();
    assert.deepEqual(rec.handed, [{ team: "builders", words: "Build the logbook: newest first, one line each", workers: null, workersEffort: null }]);
    assert.equal(rec.closed, 1);
    assert.deepEqual(rec.fired, []);
    // A question waits in the chat: answered first.
    const held = briefWith({ fill: { team: "builders" }, chat: { paused: true } });
    await settle();
    type(held.b, "Build it");
    assert.deepEqual(["disabled" in sendOf(held.b).attrs, textOf(one(held.b.el, "br-why"))], [true, "A question waits for your answer in this chat: answer it first"]);
    sendOf(held.b).dispatch("click");
    await settle();
    assert.deepEqual(held.rec.handed, []);
    // (fails before: yes — found by the Bug Hunter, 10-19) The bar says it too, first, whatever else runs: no promise of
    // a hand-over Send would refuse.
    assert.equal(textOf(one(held.b.el, "br-wait")), "A question waits for your answer in this chat.| Answer it first — then Send hands over.");
    assert.equal(one(held.b.el, "br-wait").classList.contains("hidden"), false);
    const both = briefWith({ fill: { team: "builders" }, chat: { paused: true, workersAtWork: true } });
    await settle();
    assert.match(textOf(one(both.b.el, "br-wait")), /^A question waits for your answer in this chat\./);
    // Its workers still at work, no turn: no Stop the turn.
    const busy = briefWith({ fill: { team: "builders" }, chat: { workersAtWork: true } });
    await settle();
    assert.match(textOf(one(busy.b.el, "br-wait")), /^Its workers are still at work\./);
    assert.equal(btn(busy.b.el, "Stop the turn"), undefined);
  });

  // (fails before: yes — d-side, 11-12: with In charge picked for BugHunters its card said "…and answers your messages
  // from now on", nothing of reading, and Options that its applies go out at once and "It brings changes into your
  // folder; it commits nothing." — the server holds every turn it leads to reading, whatever the chat's mode)
  test("In charge picked for a team that changes no file says before Send that the chat only reads: its way card's line, painted again as the team changes, and Options' two lines; a team that builds, and one of yours whose workers all read, keep In charge's own words", async () => {
    // As Overview's Put in charge… opens it: on In charge, the words the person pressed.
    const { b, rec } = briefWith({ teams: [BUGHUNTERS, BUILDERS, READERS], fill: { team: "bughunters", way: "charge" } });
    await settle();
    /** A way's card says: its name, and its line. @param {"side" | "charge"} id */
    const card = (id) => [textOf(one(one(b.el, `is-${id}`), "br-way-name")), textOf(one(one(b.el, `is-${id}`), "br-way-line"))];
    /** Options' Its orders to its workers, and the note under them. */
    const orders = () => [all(one(b.el, "br-then"), (x) => x.attrs?.class === "br-stp-text").map(textOf), textOf(all(b.el, (x) => x.attrs?.class === "br-note")[0])];
    /** @param {string} key */
    const team = async (key) => {
      labelled(b.el, "Change team").dispatch("change", { target: { value: key } });
      await settle();
    };
    const SIDE = ["On the side", WAYS.side.line];
    const reads = chargeReads("BugHunters");
    assert.deepEqual([b.state().way, card("side"), card("charge")], ["charge", SIDE, ["In charge", reads.line]]);
    assert.deepEqual(orders(), [[`They go out at once|${reads.orders}`], reads.note]);
    // The rest of In charge is true of it as of any team, and stays: who answers, what it costs, the way back.
    assert.equal(textOf(one(b.el, "br-defaults")), `Its lead answers this chat · lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}`);
    assert.equal(textOf(one(b.el, "br-foot-line")), "From your message on, the BugHunters' lead answers in this chat. Back to your agent is on the band at its top.");
    assert.equal(one(b.el, "br-folder"), undefined, "no folder note: it brings no change");
    // A team that builds: In charge, its usual way, in the words it always had.
    await team("builders");
    assert.deepEqual([b.state().way, card("side"), card("charge")], ["charge", SIDE, ["In charge", CHARGE.line]]);
    assert.deepEqual(orders(), [[`They go out at once|${CHARGE.orders}`], CHARGE.note]);
    // A team of yours whose workers all read is on the side by default, and picked In charge is not held: the plain words.
    await team("readers");
    assert.deepEqual([b.state().way, card("charge")], ["side", ["In charge", CHARGE.line]]);
    one(b.el, "is-charge").dispatch("click");
    assert.deepEqual([b.state().way, orders()], ["charge", [[`They go out at once|${CHARGE.orders}`], CHARGE.note]]);
    // Back to BugHunters: on the side, as every team that changes no file opens — and its In charge card says what
    // picking it would mean, before the press.
    await team("bughunters");
    assert.deepEqual([b.state().way, card("side"), card("charge")], ["side", SIDE, ["In charge", reads.line]]);
    one(b.el, "is-charge").dispatch("click");
    assert.deepEqual([b.state().way, orders()], ["charge", [[`They go out at once|${reads.orders}`], reads.note]]);
    // Send still hands the chat over: the words changed, no press did.
    type(b, "hunt the parser");
    sendOf(b).dispatch("click");
    await settle();
    assert.deepEqual([rec.handed, rec.fired], [[{ team: "bughunters", words: "hunt the parser", workers: null, workersEffort: null }], []]);
  });

  test("Verify, then send… opens BugHunters' Brief filled: on the side alone, its words in the box, the result it checks sent with it, its check handed to your agent unless turned off; Ctrl+Enter sends", async () => {
    const ask = "Check what the Builders team found against the code as it is now.";
    const { b, rec } = briefWith({ fill: { team: "bughunters", ask, of: "t2" } });
    await settle();
    assert.deepEqual([b.state().way, all(b.el, (x) => x.tag === "textarea")[0].value], ["side", ask]);
    const charge = one(b.el, "is-charge");
    assert.deepEqual(["disabled" in charge.attrs, charge.attrs.title], [true, "A check goes on the side: it reads one result"]);
    charge.dispatch("click");
    assert.equal(b.state().way, "side");
    // (fails before: yes — U13 W3: the check waited for you, and Send to your agent… was a second press) Its check goes on.
    assert.deepEqual([switchOf(b.el, "Hand its result to your agent").attrs["aria-checked"], all(b.el, (x) => x.attrs?.class === "br-hint").map(textOf).includes("— its check goes to your agent unless you turn it off")], ["true", true]);
    all(b.el, (x) => x.tag === "textarea")[0].dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settle();
    assert.deepEqual(rec.fired, [{ team: "bughunters", ask, model: null, workers: null, effort: null, workersEffort: null, verify: false, notify: true, of: "t2", reads: "chat" }]);
  });

  test("Preview… shows the record its lead reads, whole, in place; Back returns", async () => {
    const { b } = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    btn(b.el, "Preview…").dispatch("click");
    await settle();
    assert.equal(textOf(one(b.el, "br-preview-text")), "<main-chat>the record</main-chat>");
    btn(b.el, "Back").dispatch("click");
    assert.deepEqual([one(b.el, "br-preview-text"), textOf(one(b.el, "br-rd-fig"))], [undefined, "opus55 · 3 turns · ≈84k tokens"]);
  });

  // (fails before: yes — the review of 11-05: its lead runs at the effort its model's row says where the Brief picks none,
  // and the chip said the main agent's)
  test("its lead's model whose row says how hard it thinks: the chip and the menu's default say that, over the main agent's", async () => {
    const { b, rec } = briefWith({ fill: { team: "bug-hunter" }, chat: { agentEffort: "low" }, runsOn: () => ({ lead: "m-1", leadEffort: "high", workers: ["m-2"], from: "team", fell: [] }) });
    await settle();
    assert.equal(textOf(one(labelled(b.el, "How hard its lead thinks"), "br-effort-words")), "High");
    labelled(b.el, "How hard its lead thinks").dispatch("click");
    const def = rec.menus[0].find((/** @type {any} */ i) => i.type === "radio" && i.checked);
    assert.deepEqual([def.label, def.desc], ["The default: High", "What its model's row says"]);
  });

  // (fails before: yes — the owner's 10-21, "the model dropdown … can't see providers and effort level etc etc": two
  // plain lists of every model's name, and no effort at all)
  test("its lead and its workers are picked in the chat's own model picker, given the catalogue whole, and how hard each thinks beside it; both go with Send — in charge, its workers' alone", async () => {
    const { b, rec, pick, shown, pickerOf } = briefWith({ fill: { team: "bug-hunter" }, chat: { agentEffort: "high" } });
    await settle();
    const lead = pickerOf("Its lead runs on");
    assert.deepEqual([lead.given.models, lead.given.families, lead.given.accounts], [["m-1", "m-2"], FAMS, ACCOUNTS], "by provider, each with its price and levels, a plan's room on its tab");
    assert.deepEqual(pickerOf("Its workers run on").given.families, FAMS);
    assert.deepEqual([shown("Its lead runs on"), shown("Its workers run on"), lead.cb.blank, pickerOf("Its workers run on").cb.blank], ["m-1", "m-2", "This chat's model", "Each worker's card's"]);
    const words = (/** @type {string} */ label) => textOf(one(labelled(b.el, label), "br-effort-words"));
    // (fails before: yes — the review of 11-05: its lead's said "as your settings say", and its workers' "this chat's
    // effort for agents", where its lead runs at the main agent's and its workers at their lead's)
    // (fails before: yes — the review of 11-05: its workers' named a level, where they run as their lead does, as its
    // model takes it — and in charge its lead's pick, hidden, stood there)
    assert.deepEqual([words("How hard its lead thinks"), words("How hard its workers think")], ["High", "As its lead"], "its lead: the main agent's; its workers: their lead's");
    const radios = (/** @type {any[]} */ items) => items.filter((i) => i.type === "radio").map((i) => [i.label, !!i.checked]);
    labelled(b.el, "How hard its lead thinks").dispatch("click");
    assert.deepEqual(radios(rec.menus[0]), [["The default: High", true], ["Low", false], ["Medium", false], ["High", false], ["Extra high", false], ["Max", false]]);
    rec.menus[0].find((i) => i.label === "Extra high").onClick();
    labelled(b.el, "How hard its workers think").dispatch("click");
    assert.deepEqual(radios(rec.menus[1]), [["The default: as its lead", true], ["The model's own", false], ["Low", false], ["Medium", false], ["High", false], ["Extra high", false], ["Max", false]]);
    rec.menus[1].find((i) => i.label === "Max").onClick();
    assert.deepEqual([words("How hard its lead thinks"), words("How hard its workers think")], ["Extra high", "Max"]);
    pick("Its lead runs on", "m-2");
    await settle();
    assert.deepEqual([b.state().model, rec.asked.at(-1)], ["m-2", ["bug-hunter", { model: "m-2", workers: "" }]]);
    lead.cb.onUseDefault();
    assert.equal(b.state().model, "", "Use the default: the team's");
    pick("Its lead runs on", "m-2");
    type(b, "find bugs");
    sendOf(b).dispatch("click");
    await settle();
    assert.deepEqual([rec.fired[0].model, rec.fired[0].effort, rec.fired[0].workersEffort], ["m-2", "xhigh", "max"]);
    // In charge: its lead is this chat's, model and effort; how hard its workers think goes with the hand-over.
    const c = briefWith({ fill: { team: "builders" } });
    await settle();
    assert.equal(labelled(c.b.el, "How hard its lead thinks"), undefined);
    labelled(c.b.el, "How hard its workers think").dispatch("click");
    c.rec.menus[0].find((/** @type {any} */ i) => i.label === "The model's own").onClick();
    type(c.b, "Build it");
    sendOf(c.b).dispatch("click");
    await settle();
    assert.equal(c.rec.handed[0].workersEffort, "model");
  });

  // (fails before: yes — the owner's yes of 10-21: every Brief opened on the team's own models, so a run on the strongest
  // ones was picked again each time)
  test("it opens on the team's last run in this browser and says so, the team's own one press away; Send keeps what it ran on, and a run that picked nothing forgets it", async () => {
    const last = keepPicks(null, "bug-hunter", { model: "m-2", workers: "m-1", effort: "high", workersEffort: "max" });
    const { b, kept, shown } = briefWith({ fill: { team: "bug-hunter" }, kept: last });
    await settle();
    const picks = () => [b.state().model, b.state().workers, b.state().effort, b.state().workersEffort];
    assert.deepEqual(picks(), ["m-2", "m-1", "high", "max"]);
    assert.deepEqual([shown("Its lead runs on"), shown("Its workers run on")], ["m-2", "m-1"]);
    assert.equal(textOf(one(b.el, "br-last")), "As you ran it last time.|Use the team's");
    btn(b.el, "Use the team's").dispatch("click");
    await settle();
    assert.deepEqual([...picks(), one(b.el, "br-last").classList.contains("hidden")], ["", "", "", "", true]);
    type(b, "find bugs");
    sendOf(b).dispatch("click");
    await settle();
    assert.equal(picksOf(kept.get(PICKS_PREF) ?? null, "bug-hunter"), null, "run on the team's own: the next Brief opens on it too");
    // A run that picked: kept, as it ran.
    const two = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    two.pick("Its workers run on", "m-2");
    labelled(two.b.el, "How hard its workers think").dispatch("click");
    two.rec.menus[0].find((/** @type {any} */ i) => i.label === "Extra high").onClick();
    type(two.b, "find bugs");
    sendOf(two.b).dispatch("click");
    await settle();
    assert.deepEqual(picksOf(two.kept.get(PICKS_PREF) ?? null, "bug-hunter"), { model: "", workers: "m-2", effort: "", workersEffort: "xhigh" });
    // The team changed in the head: its own last picks; a model no longer listed is left out; a check carries its own.
    const many = keepPicks(last, "bughunters", { model: "m-9", workers: "m-1", effort: "", workersEffort: "" });
    const three = briefWith({ fill: { team: "bug-hunter" }, kept: many });
    await settle();
    const sel = /** @type {any} */ (labelled(three.b.el, "Change team"));
    sel.dispatch("change", { target: { value: "bughunters" } });
    assert.deepEqual([three.b.state().model, three.b.state().workers], ["", "m-1"], "m-9 is listed no more");
    const check = briefWith({ fill: { team: "bug-hunter", ask: "check it", of: "t2" }, kept: last });
    await settle();
    assert.deepEqual([check.b.state().model, check.b.state().workers, one(check.b.el, "br-last").classList.contains("hidden")], ["", "", true]);
  });

  // (fails before: yes — the review of 11-03: a seat the team names wore the generic glyph here, and a member's own
  // model, which wins over a pick here, was said nowhere)
  test("a named seat wears its card's glyph, and a member's own model and effort are said under its crew: they win over a pick here", async () => {
    const store = teamStore();
    const row = { ...teamRow(store.create({ name: "Hunt pair", lead: "product", members: [{ tag: "reviewer", name: "Hunter A", model: "m-a", effort: "low" }, { tag: "reviewer", name: "Hunter B" }] })), readOnly: true };
    const { b } = briefWith({ teams: [row], fill: { team: "hunt-pair" } });
    await settle();
    const party = one(b.el, "br-party");
    assert.deepEqual(all(party, (x) => String(x.attrs?.class).startsWith("pf ")).map((x) => String(x.attrs.class).split(" ")[2]), ["t-blue", "t-blue"], "each seat its card's: the Reviewer's");
    assert.deepEqual(all(party, (x) => x.attrs?.class === "br-mem-name").map(textOf), ["Hunter A", "Hunter B"]);
    assert.equal(textOf(one(b.el, "br-own")), `Hunter A on ${prettyModel("m-a")} at low: the team's own for it, over any pick here.`);
    assert.equal(one(briefWith({ fill: { team: "builders" } }).b.el, "br-own"), undefined, "none of its own: nothing said");
  });
});

describe("the Brief is one box and Send: the rest is under Options", () => {
  /** Whether `n` stands under `root`. @param {any} root @param {any} n */
  const within = (root, n) => !!n && all(root, (x) => x === n).length === 1;
  /** The Options fold: its head, the reasons at its head, its body, and whether it stands open. @param {any} b */
  const optsOf = (b) => {
    const head = one(b.el, "br-opts-head");
    const body = one(b.el, "br-opts");
    return { head, body, why: one(b.el, "br-opts-why"), open: () => [head.attrs["aria-expanded"], body.classList.contains("hidden")] };
  };
  const OPEN = ["true", false];
  const SHUT = ["false", true];
  /** The words of each section's head, in the page's order. @param {any} b */
  const heads = (b) => all(b.el, (x) => x.attrs?.class === "br-sec-head").map(textOf);

  // (fails before: yes — tm-a: the way, the box, what to hunt in, what its lead reads, when it's done and the squad all
  // stood open at once, numbered 1 2 3)
  test("on the side what stands open is the way, What it is to do with its chips and the defaults in a line; Options is folded and holds every other part, each numbered by nothing", async () => {
    const { b } = briefWith({ fill: { team: "bughunters" } });
    await settle();
    const body = one(b.el, "br-body");
    assert.deepEqual(body.kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["br-q", "br-ways", "br-sec", "br-defaults", "br-wait", "br-opts-fold"]);
    const ask = body.kids[2];
    assert.deepEqual(ask.kids.map((/** @type {any} */ k) => k.attrs.class), ["br-sec-head", "br-ask-box"], "the box and its chips: no range under it");
    assert.equal(textOf(one(ask, "br-narrow")).split("|")[0], "Or narrow it:");
    assert.deepEqual(heads(b), ["What it is to do|— your words, to its lead", "What its lead reads|— in this order, before it starts|This whole chat|Only what you write here", "When it's done|— both off unless you turn them on"]);
    assert.deepEqual(all(b.el, (x) => x.attrs?.class === "br-num"), [], "one section stands open: nothing to count");
    assert.equal(textOf(one(b.el, "br-defaults")), `Its lead reads this whole chat · its result comes to you · lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}`);
    assert.equal(body.kids[4].classList.contains("hidden"), true, "nothing waits on the side");
    // Options: folded, saying what it holds; each other part under it, and none of them outside it.
    const o = optsOf(b);
    assert.deepEqual([o.head.tag, o.head.attrs.type, o.open(), textOf(o.head), textOf(o.why)], ["button", "button", SHUT, "Options|— what to hunt in, what its lead reads, what happens when it's done, the models", ""]);
    assert.deepEqual(body.kids[5].kids.map((/** @type {any} */ k) => k.attrs.class), ["br-opts-top", "br-opts hidden"]);
    for (const cls of ["br-range", "br-reads", "br-fit", "br-then", "br-squad", "br-last", "br-lead", "br-workers", "br-fell"]) assert.ok(within(o.body, one(b.el, cls)), `${cls} is under Options`);
    for (const label of ["What to hunt in", "What its lead reads", "Hand its result to your agent", "Its lead runs on", "How hard its lead thinks", "Its workers run on", "How hard its workers think"])
      assert.ok(within(o.body, labelled(b.el, label)), `${label} is under Options`);
    assert.ok(within(o.body, btn(b.el, "Preview…")), "Preview… is under Options");
    assert.equal(textOf(one(o.body, "br-cap")), "The team");
    // The order they have: what to hunt in, what its lead reads, when it's done, the team.
    assert.deepEqual(o.body.kids.map((/** @type {any} */ k) => k.attrs.class), ["br-grid", "br-notes"]);
    assert.deepEqual(o.body.kids[0].kids.map((/** @type {any} */ c) => c.kids.map((/** @type {any} */ k) => k.attrs.class)), [["br-range", "br-sec", "br-sec"], ["br-squad"]]);
    assert.deepEqual(o.body.kids[1].kids, [], "a team that changes no file, on the side: no note");
  });

  // (fails before: yes — tm-a: in charge, What changes in this chat stood over the box and the two notes beside it)
  test("in charge the same stands open, its line saying its lead answers this chat; Options holds what its lead reads, its orders, the team, and the three notes of in charge", async () => {
    const { b } = briefWith({ fill: { team: "builders" } });
    await settle();
    const body = one(b.el, "br-body");
    assert.deepEqual(body.kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["br-q", "br-ways", "br-sec", "br-defaults", "br-wait", "br-opts-fold"]);
    assert.deepEqual(heads(b), ["What it is to do|— your first message, to its lead", "What its lead reads|— before it answers", "Its orders to its workers"]);
    assert.equal(textOf(one(b.el, "br-defaults")), `Its lead answers this chat · lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}`);
    const o = optsOf(b);
    assert.deepEqual([o.open(), textOf(o.head)], [SHUT, "Options|— what its lead reads, its orders, the models, what changes in this chat"]);
    for (const cls of ["br-reads", "br-then", "br-squad", "br-changes", "br-cost", "br-folder"]) assert.ok(within(o.body, one(b.el, cls)), `${cls} is under Options`);
    assert.deepEqual(o.body.kids[1].kids.map((/** @type {any} */ k) => k.attrs.class), ["br-changes", "br-cost", "br-folder"], "What changes in this chat, Costs once, Your folder stays yours");
    assert.equal(one(b.el, "br-range").classList.contains("hidden"), true, "a range is a hunt's, on the side");
  });

  // (fails before: yes — tm-a: no line said the defaults; each choice showed only in its own section)
  test("the line under the box follows each choice: what its lead reads, each switch, a model picked, the way", async () => {
    const { b, pick } = briefWith({ fill: { team: "bug-hunter" }, runsOn: (_t, p) => ({ lead: p.model || "m-1", workers: [p.workers || "m-2"], from: p.workers ? "picked" : "team", fell: [] }) });
    await settle();
    const line = () => textOf(one(b.el, "br-defaults"));
    const runs = `lead on ${prettyModel("m-1")} · workers on ${prettyModel("m-2")}`;
    assert.equal(line(), `Its lead reads this whole chat · its result comes to you · ${runs}`);
    switchOf(b.el, "Check it with BugHunters first").dispatch("click");
    assert.equal(line(), `Its lead reads this whole chat · its result comes to you, checked by BugHunters first · ${runs}`);
    switchOf(b.el, "Hand its result to your agent").dispatch("click");
    assert.equal(line(), `Its lead reads this whole chat · its result comes to you, checked by BugHunters first, then to your agent · ${runs}`);
    all(b.el, (x) => x.attrs?.class?.startsWith?.("br-seg-btn") && textOf(x) === "Only what you write here")[0].dispatch("click");
    assert.equal(line(), `Its lead reads only what you write here · its result comes to you, checked by BugHunters first, then to your agent · ${runs}`);
    pick("Its workers run on", "m-1");
    pick("Its lead runs on", "m-2");
    await settle();
    assert.equal(line(), `Its lead reads only what you write here · its result comes to you, checked by BugHunters first, then to your agent · lead on ${prettyModel("m-2")} · workers on ${prettyModel("m-1")}`);
    // BugHunters' own result is checked by none: its line says no check, whatever the switch stood at.
    labelled(b.el, "Change team").dispatch("change", { target: { value: "bughunters" } });
    await settle();
    assert.equal(line(), `Its lead reads only what you write here · its result comes to you, then to your agent · ${runs}`);
    one(b.el, "is-charge").dispatch("click");
    await settle();
    assert.equal(line(), `Its lead answers this chat · ${runs}`, "in charge its lead is this chat's model");
  });

  // (fails before: yes — the rework of 11-11: the line and the picker said this chat's list's model of workers whose
  // card, or whose seat, names another; the card's came first only in words, "each member's card's, else…")
  test("workers with a model of their own are said with it: the line says theirs, a note names each whose card comes before the list, until a model is picked", async () => {
    const [hunter, checker] = BUGHUNTERS.members;
    const chat = () => ({ lead: "m-1", workers: ["m-2"], from: "chat", fell: [] });
    const some = briefWith({ fill: { team: "bughunters" }, teams: [{ ...BUGHUNTERS, members: [{ ...hunter, model: "GLM 5.3 Flash" }, checker] }], runsOn: (_t, p) => (p.workers ? { lead: "m-1", workers: [p.workers], from: "picked", fell: [] } : chat()) });
    await settle();
    const line = (/** @type {any} */ b) => textOf(one(b.el, "br-defaults")).split(" · ").at(-1);
    assert.equal(line(some.b), `workers on ${prettyModel("m-2")}, or their own`);
    assert.equal(textOf(one(some.b.el, "br-carded")), `Hunter on ${prettyModel("GLM 5.3 Flash")}: its card's, unless you pick one here.`);
    assert.ok(all(one(some.b.el, "br-workers"), (x) => x === one(some.b.el, "br-carded")).length, "under Its workers");
    // A pick here comes before a card's: the note goes, and the line says the pick alone.
    some.pick("Its workers run on", "m-1");
    await settle();
    assert.deepEqual([one(some.b.el, "br-carded"), line(some.b)], [undefined, `workers on ${prettyModel("m-1")}`]);
    // Each with its own: no worker runs on the list. A seat's own stands over a pick too.
    const each = briefWith({ fill: { team: "bughunters" }, teams: [{ ...BUGHUNTERS, members: [{ ...hunter, model: "GLM 5.3 Flash" }, { ...checker, model: "GLM 5.3 Flash", own: { model: "Claude Opus 5.5" } }] }], runsOn: (_t, p) => (p.workers ? { lead: "m-1", workers: [p.workers], from: "picked", fell: [] } : chat()) });
    await settle();
    assert.equal(line(each.b), "workers on their own models");
    assert.equal(textOf(one(each.b.el, "br-carded")), `Hunter on ${prettyModel("GLM 5.3 Flash")}: its card's, unless you pick one here.`, "the Checker's is the team's own for it, said in its own note");
    each.pick("Its workers run on", "m-1");
    await settle();
    assert.equal(line(each.b), `workers on ${prettyModel("m-1")}, or their own`);
    // The team's models come before a card's: no card's model is said.
    const team = briefWith({ fill: { team: "bughunters" }, teams: [{ ...BUGHUNTERS, models: ["m-2"], members: [{ ...hunter, model: "GLM 5.3 Flash" }, checker] }] });
    await settle();
    assert.deepEqual([one(team.b.el, "br-carded"), line(team.b)], [undefined, `workers on ${prettyModel("m-2")}`]);
  });

  // (fails before: yes — tm-a: nothing folded, nothing kept)
  test("Options opens and folds at its head, kept for the person: the next Brief opens as it was left", async () => {
    const { b, kept } = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    const o = optsOf(b);
    assert.deepEqual([o.open(), kept.get(OPTIONS_PREF)], [SHUT, undefined]);
    o.head.dispatch("click");
    assert.deepEqual([o.open(), kept.get(OPTIONS_PREF)], [OPEN, "1"]);
    const next = briefWith({ fill: { team: "builders" }, prefs: { [OPTIONS_PREF]: "1" } });
    await settle();
    assert.deepEqual(optsOf(next.b).open(), OPEN, "another team's, another way's: as the person left it");
    o.head.dispatch("click");
    assert.deepEqual([o.open(), kept.get(OPTIONS_PREF)], [SHUT, "0"]);
    assert.deepEqual(optsOf(briefWith({ fill: { team: "bug-hunter" }, prefs: { [OPTIONS_PREF]: "0" } }).b).open(), SHUT);
  });

  // (fails before: yes — tm-a: a model that cannot run was said in the squad, which a fold would hide until Send's refusal)
  test("Options opens by itself, and says why at its head, where a default cannot stand: a model the team names cannot run; folded by the person it stays folded, its reason still at its head", async () => {
    const { b, kept } = briefWith({
      fill: { team: "bug-hunter" },
      runsOn: (team) => (team === "bug-hunter"
        ? { lead: "m-1", workers: null, from: "seats", fell: [{ name: "Claude Opus 5.5", why: "signed out", as: "lead" }] }
        : { lead: "m-1", workers: null, from: "seats", fell: [] }),
    });
    const o = optsOf(b);
    assert.deepEqual([o.open(), textOf(o.why)], [SHUT, ""], "before the server says what runs: as the person keeps it");
    await settle();
    assert.deepEqual([o.open(), textOf(o.why), o.why.attrs.role], [OPEN, "Claude Opus 5.5 cannot run now: see The team", "status"]);
    assert.equal(kept.get(OPTIONS_PREF), undefined, "opened by itself: nothing the person chose is kept");
    assert.deepEqual(all(one(o.body, "br-fell"), (x) => String(x.attrs?.class).includes("is-warn")).map(textOf), ["Claude Opus 5.5 cannot run now (signed out): its lead runs on this chat's model"], "the part it names says it whole");
    // The person folds it: it stays folded through a paint, the reason at its head.
    o.head.dispatch("click");
    b.paint();
    assert.deepEqual([o.open(), textOf(o.why)], [SHUT, "Claude Opus 5.5 cannot run now: see The team"]);
    // A team whose models all run: no reason; back to the one whose model cannot, it opens again.
    labelled(b.el, "Change team").dispatch("change", { target: { value: "bughunters" } });
    await settle();
    assert.deepEqual([o.open(), textOf(o.why)], [SHUT, ""]);
    labelled(b.el, "Change team").dispatch("change", { target: { value: "bug-hunter" } });
    await settle();
    assert.deepEqual([o.open(), textOf(o.why)], [OPEN, "Claude Opus 5.5 cannot run now: see The team"]);
    // Open, it stays open as its reason goes: the part the person works in does not fold under them.
    labelled(b.el, "Change team").dispatch("change", { target: { value: "bughunters" } });
    await settle();
    assert.deepEqual([o.open(), textOf(o.why)], [OPEN, ""]);
  });

  // (fails before: yes — tm-a: a chat cut to fit said so in What its lead reads alone)
  test("a chat that does not fit its lead's window whole opens Options with that reason, and the line says its oldest part is left out; a fresh start reads none of it", async () => {
    const { b } = briefWith({ fill: { team: "bug-hunter" }, facts: { ...FACTS, tokens: 130_000, cut: true } });
    await settle();
    const o = optsOf(b);
    assert.deepEqual([o.open(), textOf(o.why)], [OPEN, "This chat does not fit its lead's window whole: see What its lead reads"]);
    assert.ok(textOf(one(b.el, "br-defaults")).startsWith("Its lead reads this chat, its oldest part left out · its result comes to you"));
    all(b.el, (x) => x.attrs?.class?.startsWith?.("br-seg-btn") && textOf(x) === "Only what you write here")[0].dispatch("click");
    assert.deepEqual([textOf(o.why), textOf(one(b.el, "br-defaults")).split(" · ")[0]], ["", "Its lead reads only what you write here"]);
    // Tight but whole — the meter's orange, as the fixture is — is no reason.
    const tight = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    assert.deepEqual([fitOf(FACTS).tone, optsOf(tight.b).open()], ["tight", SHUT]);
  });

  // Folding changed nothing a choice does: written against the Brief as it stood with every part open, where it passes too.
  test("with nothing touched but the words, Send posts the same body: on the side, a hunt, a check, in charge, and a team's last picks", async () => {
    const side = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    type(side.b, "find bugs");
    sendOf(side.b).dispatch("click");
    await settle();
    assert.deepEqual([side.rec.fired, side.rec.handed], [[{ team: "bug-hunter", ask: "find bugs", model: null, workers: null, effort: null, workersEffort: null, verify: false, notify: false, of: null, reads: "chat" }], []]);
    // A hunt with no range named sends none: what is uncommitted and what this chat changed.
    const hunt = briefWith({ fill: { team: "bughunters" } });
    await settle();
    type(hunt.b, "hunt the parser");
    sendOf(hunt.b).dispatch("click");
    await settle();
    assert.deepEqual(hunt.rec.fired, [{ team: "bughunters", ask: "hunt the parser", model: null, workers: null, effort: null, workersEffort: null, verify: false, notify: false, of: null, reads: "chat" }]);
    const check = briefWith({ fill: { team: "bughunters", ask: "Check it.", of: "t2" } });
    await settle();
    sendOf(check.b).dispatch("click");
    await settle();
    assert.deepEqual(check.rec.fired, [{ team: "bughunters", ask: "Check it.", model: null, workers: null, effort: null, workersEffort: null, verify: false, notify: true, of: "t2", reads: "chat" }]);
    const charge = briefWith({ fill: { team: "builders" } });
    await settle();
    type(charge.b, "Build it");
    sendOf(charge.b).dispatch("click");
    await settle();
    assert.deepEqual([charge.rec.handed, charge.rec.fired], [[{ team: "builders", words: "Build it", workers: null, workersEffort: null }], []]);
    const last = briefWith({ fill: { team: "bug-hunter" }, kept: keepPicks(null, "bug-hunter", { model: "m-2", workers: "m-1", effort: "high", workersEffort: "max" }) });
    await settle();
    type(last.b, "find bugs");
    sendOf(last.b).dispatch("click");
    await settle();
    assert.deepEqual(last.rec.fired, [{ team: "bug-hunter", ask: "find bugs", model: "m-2", workers: "m-1", effort: "high", workersEffort: "max", verify: false, notify: false, of: null, reads: "chat" }]);
  });

  // (fails before: yes — tm-a: Send's tip said "Start its lead: it reads this chat" of a lead that reads only the words)
  test("Send's words say send, and its tip what its lead reads", async () => {
    const { b } = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    type(b, "find bugs");
    assert.equal(sendOf(b).attrs.title, "Send it: its lead reads this chat and goes to work beside it");
    all(b.el, (x) => x.attrs?.class?.startsWith?.("br-seg-btn") && textOf(x) === "Only what you write here")[0].dispatch("click");
    assert.equal(sendOf(b).attrs.title, "Send it: its lead reads your words alone and goes to work beside this chat");
  });
});

describe("what a Brief keeps of a team's last run", () => {
  test("each team's picks under its key; nothing picked, nothing kept; a broken preference reads as none", () => {
    const one = keepPicks(null, "bug-hunter", { model: " m-2 ", workers: "", effort: "max", workersEffort: "" });
    assert.deepEqual(picksOf(one, "bug-hunter"), { model: "m-2", workers: "", effort: "max", workersEffort: "" });
    // (fails before: yes — the owner's word of 11-05) An older pick's count is read as nothing: no number goes with a run.
    assert.deepEqual(picksOf(JSON.stringify({ x: { model: "m", most: 4 } }), "x"), { model: "m", workers: "", effort: "", workersEffort: "" });
    const two = keepPicks(one, "verifier", { model: "", workers: "m-1", effort: "", workersEffort: "high" });
    assert.deepEqual([picksOf(two, "bug-hunter")?.model, picksOf(two, "verifier")?.workersEffort], ["m-2", "high"]);
    assert.equal(picksOf(keepPicks(two, "bug-hunter", { model: "", workers: "", effort: "", workersEffort: "" }), "bug-hunter"), null);
    assert.deepEqual([picksOf("not json", "bug-hunter"), picksOf(null, "x"), picksOf(JSON.stringify({ x: { most: 0 } }), "x")], [null, null, null]);
    assert.equal(picksOf(keepPicks("[1]", "x", { model: "m", workers: "", effort: "", workersEffort: "" }), "x")?.model, "m", "a preference that is no map starts again");
  });
});

describe("the Teams tab's home", () => {
  /** @param {{ armed?: any, seats?: string[], teams?: any[], model?: string, kept?: Map<string, string> }} [o]  `kept`: what the store holds */
  const homeWith = (o = {}) => {
    const rec = { briefs: /** @type {any[]} */ ([]), newTeam: 0, library: 0, disarm: 0 };
    let armed = o.armed || null;
    /** @type {Map<string, string>} */
    const kept = o.kept || new Map();
    const io = {
      teams: () => o.teams ?? [HUNTER, BUGHUNTERS, BUILDERS],
      model: () => o.model ?? "m-1",
      seats: () => o.seats ?? ["m-2"],
      brief: (/** @type {any} */ fill) => { rec.briefs.push(fill); },
      newTeam: () => { rec.newTeam++; },
      library: () => { rec.library++; },
      armed: () => armed,
      disarm: () => { rec.disarm++; armed = null; },
    };
    const home = createTeamsHome(io, { h: fakeH, place, drawIn: fakeDrawIn, store: { get: (k) => kept.get(k) ?? null, set: (k, v) => { kept.set(k, v); } } });
    const chat = { chainId: "c1" };
    home.paint(chat);
    return { home, rec, chat, kept };
  };
  /** The classes of a node's children, each its first. @param {any} n */
  const kidsOf = (n) => n.kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]);
  /** The words of a way's diagram head. @param {any} n */
  const wayNames = (n) => all(n, (x) => String(x.attrs?.class).startsWith("th-way ")).map((x) => textOf(one(x, "th-way-name")));

  // (fails before: yes — tm-a: the two diagrams stood first, under the head, and Your teams came after the lesson)
  test("what a team is, then the teams first — the squads in two groups, each saying what its lead and workers run on — then How teams work, folded, and three rules; Brief… opens the Brief and starts nothing", () => {
    const { home, rec } = homeWith();
    assert.equal(textOf(one(home.top, "th-sub")), "A team is a |lead| | who plans and checks, and |workers| who do the pieces — as many at once as the job needs.");
    assert.equal(textOf(one(home.top, "th-who")), `This chat is answered by |your agent| · ${prettyModel("m-1")}`);
    assert.deepEqual([kidsOf(home.top), kidsOf(home.roster)], [["th-head"], ["th-sec", "th-group", "th-group", "th-how", "th-rules"]], "the head; then the teams, How teams work folded under them, the three rules");
    assert.deepEqual([wayNames(home.top), wayNames(home.roster)], [[], []], "the lesson is folded");
    assert.deepEqual(all(home.roster, (x) => x.attrs?.class === "th-group-label").map((x) => textOf(x).split("|")[0]), ["They look and check", "They build"]);
    const squads = all(home.roster, (x) => x.attrs?.["data-team"]);
    assert.deepEqual(squads.map((x) => x.attrs["data-team"]), ["bug-hunter", "bughunters", "builders"]);
    assert.equal(textOf(one(squads[0], "th-on")), `Lead: |${prettyModel("Claude Opus 5.5")} on the side|Hunters: |GLM 5.3 Flash| · the team's`);
    // (fails before: yes — the design pass of 10-24, UX6: each shipped team that builds a squad of its own, the same
    // crew drawn again in each; the owner's of 11-04: Builders drew a row per way its lead could lead) Builders: one
    // squad, its crew once, what it runs on once, its Brief….
    const build = squads[2];
    assert.equal(build.attrs["aria-label"], "Builders team");
    assert.deepEqual([all(home.roster, (x) => x.attrs?.class === "th-style").length, one(home.roster, "th-build")], [0, undefined], "no row per way of leading");
    // (fails before: yes — tm-a: "Lead: this chat's model", "its card's on the side, else this chat's model" and "each
    // card's, else …" said the rule where the page knows the model) A model said as a model, whose it is after it, the
    // rule whole in the line's tip.
    assert.equal(textOf(one(build, "th-on")), `Lead: |${prettyModel("m-1")}| · this chat's|Workers: |${prettyModel("m-2")}| · this chat's list`);
    assert.deepEqual(one(build, "th-on").kids.map((/** @type {any} */ k) => k.attrs.title), ["In charge, its lead runs on this chat's model", "Each worker runs on its card's models where its card names any, else on this chat's list"]);
    // On the side with no model of the team's for its lead, its lead's card may name one, which the page does not
    // hold: the model it knows, and the card's say after it.
    assert.equal(textOf(one(squads[1], "th-on")), `Lead: |${prettyModel("m-1")}| · this chat's, unless its card names one|Workers: |${prettyModel("m-2")}| · this chat's list`);
    assert.deepEqual(one(squads[1], "th-on").kids.map((/** @type {any} */ k) => k.attrs.title), ["On the side, its lead runs on its card's models where its card names any, else on this chat's model", "Each worker runs on its card's models where its card names any, else on this chat's list"]);
    assert.deepEqual(one(squads[0], "th-on").kids.map((/** @type {any} */ k) => k.attrs.title), ["On the side, its lead runs on the team's models, first choice first; in charge, on this chat's model", "Its workers run on the team's models, first choice first"]);
    assert.equal(textOf(all(squads[0], (x) => x.attrs?.class === "th-mul")[0]), "× as many as needed");
    assert.deepEqual(all(build, (x) => x.attrs?.class === "th-mem").map(textOf), ["Scout", "Builder", "Tester", "Reviewer"]);
    assert.deepEqual([textOf(one(squads[0], "th-tag")), textOf(one(build, "th-tag"))], ["Read-only", "Changes files"]);
    assert.equal(btn(squads[0], "Brief…").attrs.title, "Open the Bug Hunter's Brief: say what it is to do — nothing runs until you press Send");
    assert.equal(all(home.roster, (x) => x.attrs?.class === "th-rules")[0].kids.length, 3);
    btn(squads[0], "Brief…").dispatch("click");
    btn(build, "Brief…").dispatch("click");
    btn(home.roster, "New team…").dispatch("click");
    btn(home.roster, "Edit in Library").dispatch("click");
    assert.deepEqual([rec.briefs, rec.newTeam, rec.library], [[{ team: "bug-hunter", way: "side" }, { team: "builders", way: "charge" }], 1, 1]);
  });

  // (fails before: yes — the rework of 11-11: a squad's line named this chat's list's model for workers that never run
  // on it, the ones the team names a model for and those whose card names one) What the page holds of a worker's own
  // model, it says: a seat's own before all, a card's before this chat's list and after the team's models.
  test("a squad says a worker's own model where it has one: its seat's, or its card's where the team names no models; the rest on the list, said first", () => {
    const [hunter, checker] = BUGHUNTERS.members;
    /** A squad's line of BugHunters with these members and models. @param {any[]} members @param {any} [more] */
    const line = (members, more = {}) => one(homeWith({ teams: [{ ...BUGHUNTERS, ...more, members }] }).home.roster, "th-on");
    const list = `${prettyModel("m-2")}| · this chat's list`;
    assert.equal(textOf(line([hunter, { ...checker, own: { model: "Claude Opus 5.5" } }]).kids[1]), `Workers: |${list}| — |Checker on ${prettyModel("Claude Opus 5.5")}`);
    assert.equal(textOf(line([{ ...hunter, model: "GLM 5.3 Flash" }, checker]).kids[1]), `Workers: |${list}| — |Hunter on ${prettyModel("GLM 5.3 Flash")}`);
    assert.equal(textOf(line([{ ...hunter, model: "GLM 5.3 Flash" }, { ...checker, own: { model: "Claude Opus 5.5" } }]).kids[1]), `Workers: |Hunter on ${prettyModel("GLM 5.3 Flash")}, Checker on ${prettyModel("Claude Opus 5.5")}`);
    // The team's models come before a card's, and a seat's own before the team's.
    assert.equal(textOf(line([{ ...hunter, model: "GLM 5.3 Flash" }, checker], { models: ["Kimi K2"] }).kids[1]), "Workers: |Kimi K2| · the team's");
    const both = line([hunter, { ...checker, model: "GLM 5.3 Flash", own: { model: "Claude Opus 5.5" } }], { models: ["Kimi K2"] }).kids[1];
    assert.equal(textOf(both), `Workers: |Kimi K2| · the team's| — |Checker on ${prettyModel("Claude Opus 5.5")}`);
    assert.equal(both.attrs.title, "Its workers run on the team's models, first choice first; a worker the team names a model for runs on that one");
    // One kind of worker: its model, and whose.
    assert.equal(textOf(line([{ ...hunter, model: "GLM 5.3 Flash" }]).kids[1]), `Hunters: |${prettyModel("GLM 5.3 Flash")}| · its card's`);
    assert.equal(textOf(line([{ ...hunter, model: "GLM 5.3 Flash", own: { model: "Claude Opus 5.5" } }]).kids[1]), `Hunters: |${prettyModel("Claude Opus 5.5")}| · the team's for it`);
  });

  // (fails before: yes — the review of 11-03: a seat the team names wore the generic glyph in its squad)
  test("a squad's named seats wear their card's glyph, each under its seat's name", () => {
    const row = { ...teamRow(teamStore().create({ name: "Hunt pair", lead: "product", members: [{ tag: "reviewer", name: "Hunter A" }, { tag: "reviewer", name: "Hunter B" }] })), readOnly: true };
    const { home } = homeWith({ teams: [row] });
    const squad = all(home.roster, (x) => x.attrs?.["data-team"] === "hunt-pair")[0];
    const seats = all(squad, (x) => x.attrs?.class === "th-mem");
    assert.deepEqual(seats.map(textOf), ["Hunter A", "Hunter B"]);
    assert.deepEqual(seats.map((s) => String(one(s, "pf")?.attrs.class).split(" ")[2]), ["t-blue", "t-blue"]);
  });

  // (fails before: yes — tm-a: the two ways stood open until a team was sent from this browser, then folded to a line of
  // other words, open again for one visit only)
  test("How teams work is one fold, shut to begin with, its line saying the two ways; pressed it shows the two diagrams under it, and how it was left is kept for the person: another chat, the next visit", () => {
    const { home, chat, kept } = homeWith();
    const how = () => one(home.roster, "th-how");
    assert.deepEqual([how().tag, how().attrs.type, how().attrs["aria-expanded"]], ["button", "button", "false"]);
    assert.equal(textOf(how()), "How teams work|On the side|Your agent keeps working. The team works next to it, in a chat of its own.|In charge|The team's lead takes your agent's place in this chat. You talk to the lead from now on.");
    assert.deepEqual(all(how(), (x) => String(x.attrs?.class).startsWith("th-how-way ")).map((x) => x.attrs.class), ["th-how-way is-side", "th-how-way is-charge"]);
    assert.equal(kept.get(HOW_PREF), undefined);
    how().dispatch("click");
    assert.deepEqual([how().attrs["aria-expanded"], kept.get(HOW_PREF)], ["true", "1"]);
    assert.deepEqual(kidsOf(home.roster), ["th-sec", "th-group", "th-group", "th-how", "th-ways", "th-rules"], "the two diagrams under their line, over the rules");
    assert.deepEqual(wayNames(home.roster), ["On the side|Start here", "In charge|For big jobs"]);
    // (fails before: yes — the plan's p6: In charge pictured the Methodical team) In charge pictures Builders' lead, in
    // its team's look.
    const charge = all(home.roster, (x) => x.attrs?.class === "th-way is-charge")[0];
    assert.match(textOf(charge), /You and the lead\|it plans, hands out the work, checks it/);
    assert.ok(all(charge, (x) => String(x.attrs?.class || "").startsWith("pf s32 t-orange")).length, "the lead in Builders' look");
    assert.equal(all(home.roster, (x) => x.attrs?.class === "th-rules")[0].kids.length, 3, "the rules stand either way");
    // Kept for the person, not for a chat: another chat shows it open, and so does the page opened again.
    home.paint({ chainId: "c2" });
    assert.equal(how().attrs["aria-expanded"], "true");
    const again = homeWith({ kept });
    assert.deepEqual([one(again.home.roster, "th-how").attrs["aria-expanded"], wayNames(again.home.roster).length], ["true", 2]);
    how().dispatch("click");
    assert.deepEqual([how().attrs["aria-expanded"], kept.get(HOW_PREF), kidsOf(home.roster), wayNames(home.roster)], ["false", "0", ["th-sec", "th-group", "th-group", "th-how", "th-rules"], []]);
    assert.equal(one(homeWith({ kept }).home.roster, "th-how").attrs["aria-expanded"], "false");
    assert.equal(chat.chainId, "c1");
  });

  test("with no list of this chat's a squad's workers run on its lead's model, said as that model; a hand-over waiting says so with Cancel; a pulse that changes nothing keeps it", () => {
    const { home, rec, chat } = homeWith({ seats: [] });
    const build = all(home.roster, (x) => x.attrs?.["data-team"] === "builders")[0];
    // (fails before: yes — tm-a: "each card's, else its lead's model" where the page knows its lead's model)
    assert.equal(textOf(one(build, "th-on")), `Lead: |${prettyModel("m-1")}| · this chat's|Workers: |${prettyModel("m-1")}| · its lead's`);
    assert.equal(one(build, "th-on").kids[1].attrs.title, "Each worker runs on its card's models where its card names any, else on its lead's model");
    // A team that names its lead's model and none for its workers: they run on that one.
    const lone = homeWith({ seats: [], teams: [{ ...HUNTER, models: [] }] });
    assert.equal(textOf(one(lone.home.roster, "th-on")), `Lead: |${prettyModel("Claude Opus 5.5")} on the side|Hunters: |${prettyModel("Claude Opus 5.5")}| · its lead's`);
    // A chat whose model is not known yet: the rule's own words, no model made up.
    const blank = homeWith({ seats: [], model: "" });
    assert.equal(textOf(one(all(blank.home.roster, (x) => x.attrs?.["data-team"] === "builders")[0], "th-on")), "Lead: |this chat's model|Workers: |its lead's model");
    assert.equal(textOf(one(all(blank.home.roster, (x) => x.attrs?.["data-team"] === "bughunters")[0], "th-on")), "Lead: |this chat's model|, unless its card names one|Workers: |its lead's model");
    assert.equal(textOf(one(blank.home.top, "th-who")), "This chat is answered by |your agent|");
    const keptTop = [...home.top.kids];
    const keptRoster = [...home.roster.kids];
    home.paint(chat);
    assert.deepEqual([home.top.kids, home.roster.kids], [keptTop, keptRoster], "nothing changed: drawn once");
    const armed = homeWith({ armed: { team: "builders", name: "Builders" } });
    assert.equal(textOf(one(armed.home.top, "th-armed")), "The Builders' lead takes over this chat| when the turn running now ends, with this chat open in this window — your words go to it as its first message.|Cancel");
    btn(one(armed.home.top, "th-armed"), "Cancel").dispatch("click");
    armed.home.paint(armed.chat);
    assert.deepEqual([armed.rec.disarm, one(armed.home.top, "th-armed")], [1, undefined]);
    assert.deepEqual(rec.briefs, []);
  });
});

describe("what its lead reads: the whole chat, or a fresh start", () => {
  // (fails before: yes — the owner's ask of 10-19, "what if i wanted a fresh bug hunter without any history")
  test("Only what you write here: the record's rows give way to one, the chips that narrow against this chat go, and Send says so", async () => {
    const { b, rec } = briefWith({ fill: { team: "bug-hunter" } });
    await settle();
    const seg = (/** @type {string} */ name) => all(b.el, (x) => x.attrs?.class?.startsWith?.("br-seg-btn") && textOf(x) === name)[0];
    assert.deepEqual([seg("This whole chat").attrs["aria-checked"], seg("Only what you write here").attrs["aria-checked"]], ["true", "false"], "the whole chat, as before");
    const fits = () => all(b.el, (x) => String(x.attrs?.class || "").split(" ").includes("br-fit")).length;
    assert.equal(fits(), 1, "its fit bar");
    seg("Only what you write here").dispatch("click");
    assert.deepEqual([seg("This whole chat").attrs["aria-checked"], seg("Only what you write here").attrs["aria-checked"]], ["false", "true"]);
    assert.deepEqual(all(one(b.el, "br-reads"), (x) => x.attrs?.class === "br-rd").map((x) => textOf(all(x, (y) => y.tag === "b")[0])), ["Only your words above"]);
    assert.equal(fits(), 0, "no fit bar: it reads nothing of this chat");
    assert.equal(one(b.el, "br-narrow").classList.contains("hidden"), true, "no chip that narrows against this chat");
    type(b, "hunt the lexer");
    sendOf(b).dispatch("click");
    await settle();
    assert.equal(rec.fired[0].reads, "words");
    // In charge, its lead takes this chat as it is: no such choice.
    const charge = briefWith({ fill: { team: "bug-hunter", way: "charge" } }).b;
    await settle();
    assert.equal(all(charge.el, (x) => x.attrs?.class === "br-seg").length, 0);
  });
});

describe("the hand-over, on the page", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  // (fails before: yes — found by the Bug Hunter, 10-19: words were sent only to the chat still on screen once the
  // settings write was done, the send's answer was never read, and the toast said the team led either way)
  test("its words are the lead's first message, or wait in its chat's box for Send: never lost, never said sent", () => {
    const now = app.slice(app.indexOf("async function handOverNow("), app.indexOf("function confirmSwitch("));
    assert.match(now, /const shown = chatOf\(state\.currentId\) === chat;\n\s+if \(shown\) views\.show\("chat"\);\n\s+const sent = shown \? await sendMessage\(o\.words, \[\], "normal", \{ boxed: true \}\) : false;\n\s+if \(sent === false \|\| sent === "queue"\) \{\n\s+saveDraft\(chat, o\.words\);\n\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setDraft\(o\.words\);\n\s+toast\(`The \$\{possessive\(o\.name\)\} lead leads \$\{shown \? "this" : "that"\} chat now — your words wait in its box: Send gives them to it`\);\n\s+return true;\n\s+\}/);
  });
  // (fails before: yes — found by the Bug Hunter, 10-19: a hand-over waiting for a chat that was deleted stayed for
  // good, kept across reloads, its timer ticking every two seconds)
  test("a waiting hand-over goes with its chat: deleted here at once, deleted elsewhere once a look finds it gone", () => {
    assert.match(app, /onDeleted: \(id\) => \{ if \(handOvers\.has\(id\)\) disarmHandOver\(id\); leaveDeleted\(id\); chatDeleted\(id\); \},/);
    const look = app.slice(app.indexOf("function lookAtHandOvers() {"), app.indexOf("const armHandOvers = "));
    assert.match(look, /if \(Date\.now\(\) - \(handOverAsked\.get\(chain\) \|\| 0\) < HANDOVER_ASK_MS\) continue;[\s\S]*void api\(`\/sessions\/\$\{encodeURIComponent\(chain\)\}\/settings`\)\.catch\(\(e\) => \{\n\s+if \(\/404\/\.test\(errText\(e\)\) && handOvers\.has\(chain\)\) disarmHandOver\(chain\);/);
    const sidebar = readFileSync("src/ui/harness/sidebar.js", "utf8");
    assert.match(sidebar, /await api\(`\/memory\/sessions\/\$\{encodeURIComponent\(s\.id\)\}\/delete`, \{ method: "POST" \}\);\n\s+cb\.onDeleted\?\.\(String\(s\.id\)\);/);
  });
  // (fails before: yes — a waiting hand-over the person cancelled, or whose write was refused once its turn had ended,
  // took their words with it: its Brief had closed, and the box was cleared as it was set to wait)
  test("a waiting hand-over that does not go gives its words back to its chat's box — cancelled, or refused as it fired — and the toast that sets it waiting says what it waits for", () => {
    const back = app.slice(app.indexOf("function handOverWordsBack("), app.indexOf("function disarmHandOver("));
    assert.match(back, /const shown = String\(chatOf\(state\.currentId\)\?\.chainId \|\| ""\) === chain;\n\s+const had = shown \? composer\.draft\(\) : draftFor\(\{ chainId: chain \}\);\n\s+const draft = had && !had\.startsWith\(words\) \? `\$\{words\}\\n\\n\$\{had\}` : had \|\| words;\n\s+saveDraft\(\{ chainId: chain \}, draft\);\n\s+if \(shown\) composer\.setDraft\(draft\);/, "what the box holds stays, after them");
    const disarm = app.slice(app.indexOf("function disarmHandOver("), app.indexOf("const handOverAsked = "));
    assert.match(disarm, /if \(had && said\) \{\n\s+handOverWordsBack\(chain, had\.words\);\n\s+toast\(off\n\s+\? `[^`]*`\n\s+: `The \$\{had\.name\} does not take over: your agent keeps this chat, and your words are back in its box`\);\n\s+\}/, "Cancel");
    const look = app.slice(app.indexOf("function lookAtHandOvers() {"), app.indexOf("const armHandOvers = "));
    assert.match(look, /disarmHandOver\(chain\);\n\s+void handOverNow\(chat, o\)\.then\(\(went\) => \{ if \(!went\) handOverWordsBack\(chain, o\.words\); \}\);/, "its write refused");
    assert.match(app, /toast\(`The \$\{possessive\(name\)\} lead takes over when this turn ends, with this chat open in this window — your words go to it first`\);/);
  });
});

// (fails before: yes — each switch was made anew at each paint, and the rows of the model pickers and the effort chips
// were made anew around them: a control taken out of the page loses the focus, so a key pressed on one left the focus
// nowhere)
describe("the Brief's controls stay in the page as it paints", () => {
  /** The elements from `root` down to `target`, each holding the next. @param {any} root @param {any} target @returns {any[] | null} */
  const pathTo = (root, target) => {
    if (root === target) return [root];
    for (const k of root?.kids || []) {
      const p = pathTo(k, target);
      if (p) return [root, ...p];
    }
    return null;
  };
  const LABELS = ["Check it with BugHunters first", "Hand its result to your agent", "Its lead runs on", "How hard its lead thinks", "Its workers run on", "How hard its workers think"];

  test("its switches, its lead's and its workers' model and effort: each the same element, held by the same elements, after each press repaints the Brief", async () => {
    const w = briefWith({ fill: { team: "builders", way: "side" } });
    await settle();
    const held = LABELS.map((l) => {
      const p = pathTo(w.b.el, labelled(w.b.el, l));
      assert.ok(p, `${l} is in the Brief`);
      return /** @type {any[]} */ (p);
    });
    /** Each control where it was, and the focus where a press put it. @param {string} why */
    const kept = (why) => {
      held.forEach((p, i) => assert.deepEqual(pathTo(w.b.el, p.at(-1))?.map((n, j) => n === p[j]), p.map(() => true), `${LABELS[i]}, after ${why}`));
    };
    // Each press as a key on the control with the focus makes it: the control's click, then the Brief's paint.
    /** @param {string} label */
    const press = async (label) => {
      const el = labelled(w.b.el, label);
      el.focus();
      el.dispatch("click");
      await settle();
      assert.ok(el.focused && pathTo(w.b.el, el), `${label} keeps the focus`);
    };
    await press("Check it with BugHunters first");
    assert.equal(labelled(w.b.el, "Check it with BugHunters first").attrs["aria-checked"], "true", "it says it is on");
    kept("the check's switch");
    await press("Hand its result to your agent");
    assert.equal(labelled(w.b.el, "Hand its result to your agent").attrs["aria-checked"], "true");
    kept("the hand-over's switch");
    w.pick("Its lead runs on", "m-2");
    await settle();
    kept("a model picked for its lead");
    w.pick("Its workers run on", "m-2");
    await settle();
    kept("a model picked for its workers");
    await press("Check it with BugHunters first");
    assert.equal(labelled(w.b.el, "Check it with BugHunters first").attrs["aria-checked"], "false", "and off again");
    kept("the check's switch, off");
  });
});

describe("the Brief's sheet is as wide as what stands in it", () => {
  // (fails before: yes — seen in a real page: with Options folded the sheet stood 1130px wide around one box, the room
  // of the two columns Options holds)
  test("one box wide while Options is folded, the two columns' width once it stands open", () => {
    const css = readFileSync("src/ui/harness/views/teams.css", "utf8");
    assert.match(css, /\n\.zc-sheet\.brief-sheet \{ width: min\(820px, calc\(100vw - 32px\)\);/);
    assert.match(css, /\n\.zc-sheet\.brief-sheet:has\(\.br-opts-fold\.is-open\) \{ width: min\(1130px, calc\(100vw - 32px\)\); \}\n/);
  });
});
