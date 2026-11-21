// @ts-check
// Library › Agents and teams, its Teams and its right column (HarnessV4_Tasks E15 steps 6 and 8, E23-D6 and D7, AG-175;
// proposal_ux §4.15 and N2, phase 7; team_v2_plan §10 O5; the owner's pods of 10-20; U13, one page). Teams: every team
// a chat can be run by, as a card in one grid — those that look and check, then those that build, its badge saying
// which —, yours first in each; a card says what the team is for, whether your agent may start it (its tick), its crew a
// row of chips, its lead first with the crown, each member with how many teams seat its card and what this team asks of
// it in its tooltip, says quietly what its lead and crew run on, and its command; a seat opens its card under the crew — what its work does to the
// files, the model it runs on, its card's words and acts, and on a team of yours Make a copy for this team —; pointing
// at a seat lights the same card in every pod; yours with Edit, Duplicate and Delete, the shipped ones with Edit and
// Duplicate; New team… at the page's head. The editor: a name, a lead and a crew picked from any agent's card, a line
// under each member; its foot says why Save waits, or a refusal in the server's words. A save reads the cards again,
// since who uses a card follows. Models for agents: how the list is read in a sentence, the list in order — each row's
// place a number —, what comes before it, and How many at once — the chat's one number, every model's number, the
// list's first —, each written at once. Its reads and writes
// go through the admin routes, here a thin stand-in over the real card and team stores (helpers/agents-page.js). Then
// where the teams are reached: the address that brings them into sight, and New team. DOM-free: the fake `h`, a
// stand-in model picker and sheet.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { libraryOf } from "../src/ui/harness/lib/router.js";
import { TEAM_LIMITS } from "../src/services/teams.js";
import { agentTeamsOf } from "../src/services/session-settings.js";
import { teamRoutes } from "../src/http/admin/teams.js";
import { createRouter } from "../src/http/router.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { teamAddressed } from "../src/ui/harness/lib/agent-cards.js";
import { usualWay } from "../src/ui/harness/lib/brief.js";
import { textOf, buttonsOf, fakeH } from "./helpers/fake-dom.js";
import { modelSelects } from "./helpers/team-view.js";
import { teamStore } from "./helpers/team.js";
import { all, every, one, btn, field, type, pick, settle, openAgents as open } from "./helpers/agents-page.js";
import "./helpers/teams-on-page.js";

/** A team of the developer's own: Product in charge of Builder, with a line of its own, and Reviewer by its card alone. */
const DOCS = { name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words, short sentences." }, { tag: "reviewer" }] };
/** A worker of the developer's own that works in its own copy, on a model of its own. */
const TRANSLATOR = { tag: "translator", name: "Translator", may: "copy", goodFor: "Turns a page into another language", thinks: "You translate what you are given.", model: "grok-4.6" };
/** A copy of Reviewer under another name. */
const PROOF = { from: "reviewer", tag: "proofreader", name: "Proofreader" };

/** The two models of the stand-in's catalogue, as the page says a model. */
const [GLM, GROK] = ["glm-5.3", "grok-4.6"].map(prettyModel);

/** The option values a select offers. @param {any} sel */
const options = (sel) => all(sel, (x) => x.tag === "option").map((o) => o.attrs.value);
/** The editor's rows of members, by tag. @param {any} ed  the editor's sheet */
const memberRows = (ed) => every(one(ed, "aset-members"), "tset-erole").map((r) => r.attrs["data-member"]);
/** The page's teams', lists' and numbers' writes. @param {{ calls: [string, string, any][] }} p */
const teamWrites = (p) => p.calls.filter(([m, path]) => m !== "GET" && (path.startsWith("/teams") || ["/subagents/pool", "/subagents/most", "/subagents/teams"].includes(path)));
/** The keys of the teams the Teams section shows: each pod's. @param {any} p */
const shownTeams = (p) => all(p.groups(), (x) => x.attrs?.["data-key"]).map((t) => t.attrs["data-key"]);
/** A team's acts, at its pod's foot, after its /team. @param {any} p @param {string} key */
const actsOf = (p, key) => buttonsOf(one(one(p.team(key), "lib-sq-foot") || p.team(key), "lib-acts")).map(textOf);
/** New team…, at the page's head. @param {any} p */
const newTeam = (p) => /** @type {any} */ (btn(one(p.body, "lib-ag-bar"), "New team…"));
/** The agents' tiles, by tag, as the page shows them: one list (OA1). @param {any} p */
const agentTags = (p) => tagsOf(one(p.body, "aset-agents"));
/** The tags of the cards under a node. @param {any} n */
const tagsOf = (n) => every(n, "lib-card").map((c) => c.attrs["data-tag"]);
/** The chips on a card's face. @param {any} p @param {string} tag */
const chipsOf = (p, tag) => every(one(all(p.body, (x) => x.attrs?.["data-tag"] === tag && x.tag === "article")[0], "lib-card-face"), "lib-chip").map((c) => textOf(c));
/** Every agent's card a lead or a crew may be picked from, in the page's order: the shipped ones, then yours — never a team's own Lead (OA-D4). */
const PICKABLE = ["product", "enduser", "builder", "reviewer"];
/** A pod's tick: whether your agent may start the team. @param {any} p @param {string} key */
const podTick = (p, key) => all(one(p.team(key), "lib-pod-h") || p.team(key), (x) => x.tag === "input" && x.attrs?.type === "checkbox")[0];
/** A node by its accessible name. @param {any} n @param {string} name */
const named = (n, name) => all(n, (x) => x.attrs?.["aria-label"] === name)[0];
/**
 * The real teams route's answer to a call, over a team store and the config's saved list of the teams your agent may
 * start by itself, beside that list as fire and status read it once the call is answered.
 * @param {any} teams @param {unknown} saved @param {string} method @param {string} path @param {any} [body]
 */
const routeAnswer = async (teams, saved, method, path, body = {}) => {
  const agentLoop = { subagents: { teams: saved } };
  const row = createRouter(teamRoutes({ config: { get: () => ({ agentLoop }) }, teams, ops: { record() {} }, events: { publish() {} } }))(method, path);
  const got = { status: 0, body: /** @type {any} */ (null) };
  const res = { writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { body: JSON.parse(String(b)) }) };
  await row?.handler({ res, params: row.params, json: async () => body }, {});
  return { ...got, fired: agentTeamsOf(agentLoop, (k) => teams.find(k)?.key ?? null) };
};
describe("Library › Teams", () => {
  // (fails before: yes — step 6: the teams stood on a page of their own; phase 7: they ended Settings › Agents, each a
  // long card; team_v2_plan §10 O5: a list in the right column, then squads above the agents; the owner's 10-20: pods)
  // (fails before: yes — the owner's of 11-09, "a lot of space is wasted": a pod a row, under a heading for its kind,
  // its crew at an almost empty table)
  test("the Teams: every team a card in one grid, no heading for its kind — its badge says it —, those that look first, yours first in each; its glyph, name, badge and tick; its crew a row of chips, the lead first with the crown, each member's words in its tooltip, or one kind stacked as many as needed; what it runs on, quiet, and its command at its foot — yours with Edit, Duplicate and Delete, those that ship with Edit and Duplicate", async () => {
    const p = await open({ teams: [DOCS] });
    const g = p.groups();
    assert.equal(one(p.body, "lib-ag").kids[1], g, "the page's first part, after its bar");
    assert.equal(textOf(one(g, "lib-sec-h")), "Teams|3|a lead and its workers");
    assert.deepEqual([every(g, "th-group").length, every(g, "th-group-label").length], [0, 0], "no heading for a kind of team");
    assert.deepEqual(g.kids.map((/** @type {any} */ k) => k.attrs.class), ["lib-sec-h", "lib-pod-grid", "lib-note-row"], "one grid of them all");
    assert.equal(textOf(one(g, "lib-note-row")), "Press a lead or a worker for its card. One card can sit in several teams: a change to it is a change in each.");
    assert.deepEqual(shownTeams(p), ["bughunters", "docs", "builders"], "every team: those that look, then those that build, yours first in each");
    assert.equal(one(g, "lib-sq-new"), undefined, "New team… stands at the page's head");
    const docs = p.team("docs");
    assert.equal(docs.attrs["aria-label"], "Docs team");
    // (fails before: yes — the owner's of 11-09: a card stretched beside a taller one left a gap over what it runs on)
    // Five parts, each always there, for a row's cards to line up part by part; its body its crew, nothing set apart
    // from the defaults: no chips.
    assert.deepEqual(docs.kids.map((/** @type {any} */ k) => k.attrs.class), ["lib-pod-h", "lib-pod-line", "lib-pod-body", "lib-pod-runs", "th-sq-foot lib-sq-foot"]);
    assert.deepEqual(one(docs, "lib-pod-body").kids.map((/** @type {any} */ k) => k.attrs.class), ["lib-crew"], "nothing set apart from the defaults: no chips");
    assert.equal(textOf(one(docs, "lib-pod-h")), "Docs|yours|Changes files|Your agent may use it");
    // Its glyph: its lead's look, without the crown — the crew's first chip wears that.
    const glyphOf = one(docs, "lib-pod-h").kids[0];
    assert.deepEqual([String(glyphOf.attrs.class).includes("t-purple"), one(glyphOf, "pf-crown")], [true, undefined]);
    // (fails before: yes — U13 revised: a pod said nothing of what it runs on, or of who starts it)
    // (fails before: yes — the rework of 11-11: the grey line said the whole chain, of a crew) The shortest true rule, of
    // its workers; the chain whole is the line's tip.
    assert.equal(textOf(one(docs, "lib-pod-runs")), "Lead: the chat's model · Workers: each one's own, else the lead's");
    assert.equal(one(docs, "lib-pod-runs").attrs.title, "Its lead runs on the team's models where it names any, else its card's, else the chat's model — in charge, always the chat's model. Its workers run on the team's models where it names any, else each worker's card's, else the chat's list, else its lead's model.");
    assert.equal(textOf(one(docs, "lib-pod-line")), "Is it worth building, its smallest version, and where it lives on the page");
    // Its crew: the lead first, with the crown; each member with what this team asks of it and the teams that seat its
    // card in its tooltip — Reviewer in every team that ships, as the Scout, the Hunter and the Checker too.
    // (fails before: yes — the owner's of 11-09: a count on a chip's glyph read as that many of the member)
    assert.deepEqual(every(one(docs, "lib-crew"), "lib-seat").map((s) => [s.attrs["data-seat"], textOf(s)]), [["product", "Product"], ["builder", "Builder"], ["reviewer", "Reviewer"]]);
    assert.equal(every(p.groups(), "pf-num").length, 0, "no count on any chip");
    const lead = p.seat("docs", "product");
    assert.ok(one(lead, "pf-crown"), "the lead wears the crown");
    assert.deepEqual([lead.attrs["aria-label"], lead.attrs.title], ["Product, its lead", "It leads: plans the work, hands out the pieces, checks what comes back"]);
    assert.equal(p.seat("docs", "reviewer").attrs.title, "One card, seated in 3 teams: Docs, Builders and BugHunters");
    assert.equal(one(lead, "pf-ic").attrs.html, ICONS.users);
    assert.ok(String(one(lead, "pf").attrs.class).includes("t-purple"), "a team of yours wears the teams' purple");
    assert.equal(p.seat("docs", "builder").attrs.title, "Plain words, short sentences.\nOne card, seated in 2 teams: Docs and Builders");
    // Its foot: its command, which copies (below); its acts.
    assert.equal(textOf(one(docs, "lib-sq-foot")), "/team docs|Edit|Duplicate|Delete");
    assert.deepEqual(actsOf(p, "docs"), ["Edit", "Duplicate", "Delete"]);
    assert.equal(/** @type {any} */ (btn(docs, "Delete")).attrs["aria-label"], "Delete the Docs team");
    // (fails before: yes — the design pass of 10-24, UX6: the four shipped teams that build, four pods of one crew; the
    // owner's of 11-04: Builders' pod drew a row per way its lead could lead) Builders' pod: a pod as any team's — its
    // line, its one table, the command that starts it.
    const build = p.team("builders");
    assert.deepEqual([build.attrs["aria-label"], textOf(one(build, "lib-pod-h")), "data-build" in build.attrs], ["Builders team", "Builders|Changes files|Your agent may use it", false]);
    assert.deepEqual(build.kids.map((/** @type {any} */ k) => k.attrs.class), ["lib-pod-h", "lib-pod-line", "lib-pod-body", "lib-pod-runs", "th-sq-foot lib-sq-foot"]);
    assert.deepEqual(every(build, "lib-pod-line").map((l) => textOf(l)), ["Builds it with its workers: planned, run in parallel where it can, each claim checked"]);
    assert.deepEqual([every(build, "lib-style").length, every(build, "lib-styles").length], [0, 0]);
    assert.deepEqual(actsOf(p, "builders"), ["Edit", "Duplicate"], "a team that ships: how it runs is yours, never its Delete");
    // Its lead in its team's look; its four workers after it, in a row.
    const buildLead = p.seat("builders", "buildlead");
    assert.equal(one(buildLead, "pf-ic").attrs.html, ICONS.wrench);
    assert.ok(String(one(buildLead, "pf").attrs.class).includes("t-orange"), "its lead wears its team's tone");
    const table = p.table("builders");
    assert.equal(every(one(table, "lib-crew"), "lib-seat").length, 5, "its lead and its four workers");
    assert.equal(one(table, "lib-table"), undefined, "no table, no empty floor");
    assert.equal(textOf(one(table, "lib-sq-foot")), "/team builders|Edit|Duplicate");
    // A team that changes no file says so: BugHunters seats its Hunter and its Checker, each with what it asks of them.
    const hunt = p.team("bughunters");
    assert.deepEqual(every(one(hunt, "lib-crew"), "lib-seat").map((s) => s.attrs["data-seat"]), ["huntlead", "hunter", "checker"]);
    assert.equal(textOf(one(hunt, "th-tag")), "Reads only");
    assert.ok(String(hunt.attrs.class).includes("is-look") && String(p.team("builders").attrs.class).includes("is-build"), "each group's colour");
    // A team of one kind of worker: stacked, as many as the job needs; one that changes no file says so.
    const q = await open({ teams: [{ name: "Spotters", lead: "product", members: [{ tag: "reviewer", line: "Spot the bugs." }] }] });
    const spot = q.team("spotters");
    assert.deepEqual(every(one(spot, "lib-crew"), "lib-seat").map((s) => s.attrs.class), ["lib-seat is-lead", "lib-seat is-many"]);
    assert.equal(every(one(q.seat("spotters", "reviewer"), "lib-stack"), "pf").length, 3);
    assert.equal(q.seat("spotters", "reviewer").attrs.title, "Spot the bugs.\nOne card, seated in 3 teams: Spotters, Builders and BugHunters");
    assert.equal(textOf(one(spot, "th-mul")), "× as many as needed");
    assert.equal(every(spot, "pf-num").length, 0, "no count on its stack either");
    assert.equal(textOf(one(spot, "th-tag")), "Reads only");
  });

  // (fails before: yes — the owner's of 11-09: a team's /team was words in its foot, nothing to press or reach by keys)
  test("a team's /team at its foot is a button: pressed, the command is copied for a chat's message box and a toast says so, the way through a chat's Agents tab in its tooltip; a copy refused says why", async () => {
    const p = await open({ teams: [DOCS] });
    const start = one(p.team("builders"), "lib-pod-start");
    assert.deepEqual([start.tag, start.attrs.type, textOf(start)], ["button", "button", "/team builders"]);
    assert.equal(start.attrs.title, "Copy /team builders. Or send it from a chat: Agents › Start… › Builders › On the side or In charge");
    start.dispatch("click");
    await settle();
    assert.deepEqual(p.copied, ["/team builders"]);
    assert.deepEqual(p.toasts.at(-1), ["Copied /team builders — paste it in a chat to put the team in charge", undefined]);
    assert.deepEqual(teamWrites(p), [], "nothing is written: a team starts in a chat");
    // A team of yours: its own key.
    one(p.team("docs"), "lib-pod-start").dispatch("click");
    await settle();
    assert.deepEqual(p.copied, ["/team builders", "/team docs"]);
    // The clipboard refuses: the toast says so, and what to do instead — never the browser's own words. (d-side, 11-12:
    // what BugHunters' foot holds is `@bughunters`, below; this pin moved with it from `/team bughunters`.)
    const q = await open({ copyRefused: "Failed to execute 'writeText' on 'Clipboard': Document is not focused." });
    one(q.team("bughunters"), "lib-pod-start").dispatch("click");
    await settle();
    assert.deepEqual([q.copied, q.toasts.at(-1)], [[], ["@bughunters was not copied: type it in a chat's message box instead", "err"]]);
    one(q.team("builders"), "lib-pod-start").dispatch("click");
    await settle();
    assert.deepEqual([q.copied, q.toasts.at(-1)], [[], ["/team builders was not copied: type it in a chat's message box instead", "err"]]);
  });

  // (fails before: yes — d-side, 11-12: every team's foot copied `/team <key>` "to put the team in charge", BugHunters'
  // too — the one way in that sent a team that changes no file in charge by default, where every other opens its Brief
  // on the side)
  test("a team's foot follows its usual way: one that looks and checks copies @<key>, which opens its Brief on the side — its toast and its tooltip say so —, one that builds /team <key>, as before; what is copied is what a chat's box reads as the team's", async () => {
    const p = await open({ teams: [DOCS, { name: "Spotters", lead: "product", members: [{ tag: "reviewer", line: "Spot the bugs." }] }] });
    /** A team's foot: what it shows, its tooltip, and — pressed — what it copies and its toast. @param {string} key */
    const foot = async (key) => {
      const start = one(p.team(key), "lib-pod-start");
      start.dispatch("click");
      await settle();
      return { tag: start.tag, shows: textOf(start), code: all(start, (x) => x.tag === "code").map((c) => textOf(c)), title: start.attrs.title, copied: p.copied.at(-1), toast: p.toasts.at(-1) };
    };
    assert.deepEqual(await foot("bughunters"), {
      tag: "button", shows: "@bughunters", code: ["@bughunters"],
      title: "Copy @bughunters: in a chat's message box, Enter opens its Brief, on the side. Or send it from a chat: Agents › Start… › BugHunters › On the side or In charge",
      copied: "@bughunters", toast: ["Copied @bughunters — paste it in a chat to brief the team on the side", undefined],
    });
    // A team of yours whose workers all read: the same rule, the Brief's own (lib/brief.js `usualWay`).
    assert.deepEqual(await foot("spotters"), {
      tag: "button", shows: "@spotters", code: ["@spotters"],
      title: "Copy @spotters: in a chat's message box, Enter opens its Brief, on the side. Or send it from a chat: Agents › Start… › Spotters › On the side or In charge",
      copied: "@spotters", toast: ["Copied @spotters — paste it in a chat to brief the team on the side", undefined],
    });
    // Those that build: the command that puts them in charge, as before.
    assert.deepEqual(await foot("builders"), {
      tag: "button", shows: "/team builders", code: ["/team builders"],
      title: "Copy /team builders. Or send it from a chat: Agents › Start… › Builders › On the side or In charge",
      copied: "/team builders", toast: ["Copied /team builders — paste it in a chat to put the team in charge", undefined],
    });
    assert.deepEqual([(await foot("docs")).copied, p.toasts.at(-1)], ["/team docs", ["Copied /team docs — paste it in a chat to put the team in charge", undefined]]);
    assert.deepEqual(teamWrites(p), [], "nothing is written: a team starts in a chat");
    // What the words promise: a chat's box reads the pasted `@<key>` as the team's draft, Enter opens its Brief with no
    // way named (app.js), and a Brief opened so stands on the team's usual way — the side.
    const rows = teamStore().list();
    const hunt = rows.find((t) => t.key === "bughunters");
    assert.deepEqual([teamAddressed("@bughunters", rows)?.team.key, teamAddressed("@bughunters", rows)?.ask, teamAddressed("@bughunters find the leak", rows)?.ask], ["bughunters", "", "find the leak"]);
    assert.deepEqual([usualWay(/** @type {any} */ (hunt)), usualWay(/** @type {any} */ (rows.find((t) => t.key === "builders")))], ["side", "charge"]);
    assert.match(readFileSync("src/ui/harness/app.js", "utf8"), /\n {2}onBrief: \(team, ask, typed\) => openBriefNow\(team \? \{ team, \.\.\.\(ask \? \{ ask \} : \{\}\) \} : \{\}, typed \|\| ""\),\n/, "no way named: the Brief's own default");
    assert.match(readFileSync("src/ui/harness/views/brief.js", "utf8"), /\n {4}way: [^\n]*\(fill\.way \|\| \(first \? usualWay\(first\) : "side"\)\),\n/);
  });

  // (fails before: yes — step 6: an opened team read as a persona and four roles; the owner's 10-20: a worker shared by
  // the teams looked like each team's own)
  test("a seat pressed opens its card under the table: what this team asks of it, what it does and runs on here, whom else it sits with, its card's words and acts; pointing at a seat lights the same card in every pod", async () => {
    const p = await open({ saved: [TRANSLATOR, PROOF], teams: [{ name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words." }, { tag: "translator" }, { tag: "proofreader" }] }] });
    assert.equal(one(p.team("docs"), "lib-seat-card"), undefined, "closed at first");
    assert.equal(p.seat("docs", "builder").attrs["aria-expanded"], "false");
    p.seat("docs", "builder").dispatch("click");
    assert.ok(String(p.team("docs").attrs.class).includes("is-open"), "the pod is given room");
    assert.equal(p.seat("docs", "builder").attrs["aria-expanded"], "true");
    const card = one(p.team("docs"), "lib-seat-card");
    assert.equal(card.attrs["aria-label"], "Builder in the Docs team");
    assert.equal(textOf(card), [
      "Builder", "@builder",
      "Here", "Plain words.",
      "Does", "changes files · your chat's list, else its lead's model",
      "Good for", "Builds and fixes in its own copy, and writes and runs the tests that prove it",
      "One card in 2 teams — Docs and Builders: a change to it is a change in each.",
      "Edit its card", "Make a copy", "Make a copy for this team",
    ].join("|"));
    // Each member: what its work does, the model it runs on; a copy of Reviewer wears the eye. One card open at a time.
    p.seat("docs", "translator").dispatch("click");
    assert.equal(every(p.groups(), "lib-seat-card").length, 1);
    assert.ok(textOf(one(p.team("docs"), "lib-seat-card")).includes(`Here|Nothing beyond the words on its card|Does|works in its own copy, nothing kept · ${GROK}`));
    p.seat("docs", "proofreader").dispatch("click");
    assert.ok(textOf(one(p.team("docs"), "lib-seat-card")).includes("Does|changes nothing · your chat's list, else its lead's model"));
    assert.deepEqual(every(one(p.team("docs"), "lib-crew"), "lib-seat").slice(1).map((s) => [s.attrs["data-seat"], one(s, "pf-ic").attrs.html]), [
      ["builder", ICONS.hammer], ["translator", ICONS.hammer], ["proofreader", ICONS.eye],
    ], "a copy of Reviewer wears the eye");
    // Its lead: what it does here, and what it runs on beside a chat.
    p.seat("docs", "product").dispatch("click");
    assert.equal(textOf(one(p.team("docs"), "lib-seat-card")), "Product|@product|Here|it leads: plans the work, hands the pieces to its workers, checks what comes back — and can do any of it itself|Runs on|your chat's model|Good for|Is it worth building, its smallest version, and where it lives on the page|Edit its card|Make a copy|Make a copy for this team");
    // Folded: the seat's card goes, the keys back on its seat.
    /** @type {any} */ (named(one(p.team("docs"), "lib-seat-card"), "Fold Product's card")).dispatch("click");
    assert.equal(one(p.team("docs"), "lib-seat-card"), undefined);
    assert.ok(p.seat("docs", "product").focused);
    // Pointing at a seat lights the same card in every pod; leaving it, none; the keys do the same.
    const lit = () => every(p.groups(), "is-same").map((s) => s.attrs["data-seat"]);
    p.seat("docs", "builder").dispatch("mouseenter");
    assert.deepEqual(lit(), ["builder", "builder", "tester"], "Docs's, and Builders' table — Builder there as the Tester too");
    p.seat("docs", "builder").dispatch("mouseleave");
    assert.deepEqual(lit(), []);
    p.seat("builders", "scout").dispatch("focus");
    assert.deepEqual(lit(), ["hunter", "checker", "scout", "reviewer"], "Reviewer, wherever it sits: as the Hunter, the Checker, the Scout and itself");
    assert.deepEqual(teamWrites(p), [], "nothing of it is written");
    // No model named for the members: each runs on its chat's.
    const q = await open({ teams: [DOCS] });
    q.seat("docs", "builder").dispatch("click");
    assert.ok(textOf(one(q.team("docs"), "lib-seat-card")).includes("Does|changes files · your chat's list, else its lead's model"));
  });

  // (fails before: yes — the owner's 10-20 review: a change to a shared worker for one team was a change in every team)
  test("Make a copy for this team, on a team of yours: the copy is saved and seated in the card's place, its line kept, the other teams keeping the card; a team that ships has no such act, and a plain copy lands among the agents", async () => {
    const p = await open({ teams: [DOCS] });
    p.seat("docs", "builder").dispatch("click");
    /** @type {any} */ (btn(one(p.team("docs"), "lib-seat-card"), "Make a copy for this team")).dispatch("click");
    let ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "A copy of Builder");
    type(field(ed, "Tag"), "docs-builder");
    type(field(ed, "Name"), "Docs builder");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    const w = p.writes();
    assert.deepEqual(w.map(([m, path]) => `${m} ${path}`), ["POST /agents", "PUT /teams/docs"]);
    assert.deepEqual(w[1][2], { members: [{ tag: "docs-builder", line: "Plain words, short sentences." }, { tag: "reviewer" }] });
    assert.deepEqual(p.toasts.at(-1), ["Docs builder is saved, and sits in the Docs team in Builder's place", undefined]);
    assert.equal(p.seat("docs", "builder"), undefined);
    assert.equal(p.seat("docs", "docs-builder").attrs["aria-expanded"], "true", "its seat's card open");
    assert.ok(/** @type {any} */ (btn(one(p.team("docs"), "lib-seat-card"), "Edit its card")).focused);
    assert.ok(p.seat("builders", "builder"), "the other teams keep the card");
    assert.equal(p.changed(), 2, "the card and the team");
    // A team that ships: its seats' cards have no such act. A plain Make a copy lands among the agents, yours first.
    p.seat("builders", "builder").dispatch("click");
    assert.deepEqual(buttonsOf(one(p.table("builders"), "lib-seat-acts")).map(textOf), ["Edit its card", "Make a copy"]);
    /** @type {any} */ (btn(one(p.table("builders"), "lib-seat-acts"), "Make a copy")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Tag"), "builder-two");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    const made = all(p.body, (x) => x.attrs?.["data-tag"] === "builder-two")[0];
    assert.deepEqual([made.attrs.class.includes("lib-card"), tagsOf(p.part("Agents"))[0]], [true, "builder-two"]);
    assert.ok(/** @type {any} */ (btn(made, "Edit")).focused);
    assert.ok(p.seat("builders", "builder"), "a plain copy seats nothing");
    // The team refuses: the copy is kept, and the toast says why the team did not seat it.
    const q = await open({ teams: [DOCS], refuse: (m, path) => (m === "PUT" && path === "/teams/docs" ? { status: 409, error: "The Docs team leads a running session." } : null) });
    q.seat("docs", "builder").dispatch("click");
    /** @type {any} */ (btn(one(q.team("docs"), "lib-seat-card"), "Make a copy for this team")).dispatch("click");
    type(field(q.editor(), "Tag"), "docs-builder");
    /** @type {any} */ (btn(q.editor(), "Save")).dispatch("click");
    await settle();
    assert.deepEqual(q.toasts.at(-1), ["Builder is saved, but the Docs team could not seat it: The Docs team leads a running session.", "err"]);
    assert.ok(q.seat("docs", "builder"), "the team as it was");
    assert.ok(q.store.find("docs-builder"), "the copy kept");
  });

  // (fails before: yes — the review of 11-03: on a card seated twice, the copy took every seat of it, though its act said
  // "in its place")
  test("Make a copy for this team, on one seat of a card the team seats twice: that seat alone takes the copy, its name, line and model kept; the other keeps the card; the lead's seat the same", async () => {
    const PAIR = { name: "Review pair", lead: "product", members: [{ tag: "reviewer", name: "Fact Checker", line: "Check each claim.", model: "grok-4.6" }, { tag: "reviewer", name: "Spotter", line: "Spot the bugs." }] };
    const p = await open({ teams: [PAIR] });
    p.seat("review-pair", "spotter").dispatch("click");
    /** @type {any} */ (btn(one(p.team("review-pair"), "lib-seat-card"), "Make a copy for this team")).dispatch("click");
    type(field(p.editor(), "Tag"), "my-spotter");
    type(field(p.editor(), "Name"), "My spotter");
    /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
    await settle();
    const w = p.writes();
    assert.deepEqual(w.map(([m, path]) => `${m} ${path}`), ["POST /agents", "PUT /teams/review-pair"]);
    assert.deepEqual(w[1][2], { members: [{ tag: "reviewer", name: "Fact Checker", line: "Check each claim.", model: "grok-4.6" }, { tag: "my-spotter", name: "Spotter", line: "Spot the bugs." }] });
    assert.equal(p.seat("review-pair", "spotter").attrs["aria-expanded"], "true", "the seat keeps its id, and its card stays open");
    assert.ok(p.seat("review-pair", "fact-checker"), "the other seat as it was");
    // Its lead's seat: the lead alone.
    p.seat("review-pair", "product").dispatch("click");
    /** @type {any} */ (btn(one(p.team("review-pair"), "lib-seat-card"), "Make a copy for this team")).dispatch("click");
    type(field(p.editor(), "Tag"), "my-product");
    type(field(p.editor(), "Name"), "My Product");
    /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1)?.[2], { lead: "my-product" });
  });

  // (fails before: yes — step 6: a team was made of a persona typed by hand; PM could not be put in charge of anything)
  // (U13-D1, fails before: yes — a lead was picked from the lead cards alone, a member from the workers alone)
  test("New team: a name, a lead and a crew from any agent's card; Save waits saying why, then sends the team, lists it and reads the cards again", async () => {
    const p = await open({ saved: [TRANSLATOR] });
    newTeam(p).dispatch("click");
    const ed = p.editor();
    assert.equal(p.body.kids.length, 1, "the editor takes the page's place");
    assert.equal(textOf(one(ed, "zc-dialog-title")), "New team");
    const save = /** @type {any} */ (btn(ed, "Save"));
    const why = () => textOf(one(ed, "tset-why"));
    assert.deepEqual(["disabled" in save.attrs, why()], [true, "A team needs a name"]);
    assert.equal(field(ed, "Name").focused, true, "it opens on its name");
    type(field(ed, "Name"), "Docs");
    assert.equal(why(), "A team needs a lead: the agent in charge");
    // Any agent's card may lead, yours or one that ships; a team's own Lead is not offered (OA-D4).
    assert.deepEqual(options(field(ed, "Lead")), ["", ...PICKABLE, "translator"]);
    pick(field(ed, "Lead"), "product");
    assert.equal(textOf(one(ed, "aset-lead-line")), "Is it worth building, its smallest version, and where it lives on the page", "the lead's good-for line says who was picked");
    assert.equal(why(), "A team needs at least one worker");
    // Any agent's card may sit in its crew — one seated is offered again (the owner's "Teams, improved and kept", 11-03:
    // a second seat of it takes a name).
    assert.deepEqual(options(field(ed, "Add a worker")), ["", ...PICKABLE, "translator"]);
    pick(field(ed, "Add a worker"), "builder");
    pick(field(ed, "Add a worker"), "translator");
    assert.deepEqual(memberRows(p.editor()), ["builder", "translator"]);
    assert.deepEqual(options(field(ed, "Add a worker")), ["", ...PICKABLE, "translator"], "a member is offered again");
    assert.equal(field(ed, "What this team asks of Translator").focused, true, "focus goes to the line of the member just added");
    assert.deepEqual(every(one(ed, "aset-members"), "tset-erole-does").map(textOf), ["changes files · your chat's list, else its lead's model", `works in its own copy, nothing kept · ${GROK}`]);
    assert.deepEqual(["disabled" in save.attrs, why()], [false, ""]);
    type(field(ed, "What this team asks of Builder"), "  Plain words.  ");
    save.dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [["POST", "/teams", { name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words." }, { tag: "translator" }] }]], "a member the team asks nothing more of goes without a line");
    assert.deepEqual(p.toasts, [["The Docs team is saved: /team docs hands a session to it", undefined]]);
    assert.equal(p.changed(), 1, "the open session reads its settings again");
    assert.equal(p.calls.filter(([m, path]) => m === "GET" && path === "/agents").length, 2, "who uses a card follows: the cards are read again");
    assert.equal(p.editor(), undefined);
    assert.deepEqual(every(one(p.team("docs"), "lib-crew"), "lib-seat").map((x) => x.attrs["data-seat"]), ["product", "builder", "translator"]);
    assert.ok(p.team("docs").scrolledIntoView, "the team a save made is brought into sight");
    assert.equal(/** @type {any} */ (btn(p.team("docs"), "Edit")).focused, true);
    // Product now leads a team: it stands where it stood, one agent among the others, and its card says which (OA1).
    assert.deepEqual(agentTags(p).slice(0, 3), ["translator", "product", "enduser"]);
    assert.deepEqual([chipsOf(p, "builder"), chipsOf(p, "product")], [["Changes files", "in 2 teams", "Sees what it is asked"], ["Changes files", "leads Docs", "Sees what it is asked"]]);
  });

  // (fails before: yes — step 6: a Duplicate copied a persona and four roles' words)
  test("Duplicate opens the editor filled from the team under a free name; nothing is saved until Save, which sends what the editor holds with its source", async () => {
    const p = await open({ teams: [{ ...DOCS, name: "Builders copy" }] });
    /** @type {any} */ (btn(p.team("builders"), "Duplicate")).dispatch("click");
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "Duplicate Builders");
    assert.equal(field(ed, "Name").value, "Builders copy 2", "the first name no team has");
    assert.equal(field(ed, "Lead").value, "buildlead");
    assert.equal(options(field(ed, "Lead")).includes(""), false, "a lead is picked already: no empty choice");
    assert.equal(field(ed, "Style"), undefined, "no way of leading to pick");
    // Its rows by card: the Scout a Reviewer, the Tester a Builder.
    assert.deepEqual(memberRows(p.editor()), ["reviewer", "builder", "builder", "reviewer"]);
    assert.deepEqual(all(ed, (x) => x.attrs?.["aria-label"] === "This team's name for Reviewer").map((x) => x.value), ["Scout", ""]);
    assert.equal(all(ed, (x) => x.attrs?.["aria-label"] === "What this team asks of Reviewer").at(-1).value, "Check the change against its acceptance check: what it claims, what the diff shows with file and line, and what is missing.");
    assert.deepEqual(teamWrites(p), [], "nothing is saved until Save");
    // Take a member out, change the lead.
    /** @type {any} */ (named(ed, "Take Tester out of the team")).dispatch("click");
    assert.deepEqual(memberRows(p.editor()), ["reviewer", "builder", "reviewer"]);
    assert.equal(field(ed, "Add a worker").focused, true, "focus goes to where a member is added");
    assert.deepEqual(options(field(ed, "Add a worker")), ["", ...PICKABLE], "every card, those seated among them");
    pick(field(ed, "Lead"), "reviewer");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    const [[method, path, body]] = teamWrites(p);
    // Each seat sent as its card, under the team's name for it where it gives one.
    assert.deepEqual([method, path, body.from, body.name, body.lead, "style" in body, body.check, body.members.map((/** @type {any} */ m) => [m.tag, m.name ?? null])], ["POST", "/teams", "builders", "Builders copy 2", "reviewer", false, null, [["reviewer", "Scout"], ["builder", null], ["reviewer", null]]]);
    assert.equal(textOf(one(p.team("builders-copy-2"), "lib-pod-chips")), "Duplicated from Builders", "said in chips: it is no default");
  });

  // (fails before: yes — the owner's word of 11-05: a team's lists named models alone, and an edit or a Duplicate that
  // sent a list without its efforts left none)
  test("a team's lead's and crew's rows each say how hard they think; a model added keeps the others' efforts, and a Duplicate keeps them all", async () => {
    const p = await open({ teams: [{ ...DOCS, models: ["grok-4.6"], efforts: { "grok-4.6": "low" }, leadModels: ["glm-5.3"], leadEfforts: { "glm-5.3": "max" } }] });
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    let ed = p.editor();
    const words = (/** @type {string} */ cls) => every(one(ed, cls), "ec").map((c) => c.querySelector(".ec-words").textContent);
    assert.deepEqual([words("tset-lead-model"), words("tset-crew-model")], [["Max"], ["Low"]]);
    p.chipIn(one(ed, "tset-crew-model")).o.onChange("kimi-k2");
    assert.deepEqual(words("tset-crew-model"), ["Low", "Its lead's"], "a crew's row with none thinks as its lead");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p).at(-1), ["PUT", "/teams/docs", { models: ["grok-4.6", "kimi-k2"], efforts: { "grok-4.6": "low" } }]);
    const docs = p.teams.find("docs");
    assert.deepEqual([docs?.efforts, docs?.leadEfforts], [{ "grok-4.6": "low" }, { "glm-5.3": "max" }]);
    /** @type {any} */ (btn(p.team("docs"), "Duplicate")).dispatch("click");
    ed = p.editor();
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    const [method, path, body] = teamWrites(p).at(-1) || [];
    assert.deepEqual([method, path, body.efforts, body.leadEfforts], ["POST", "/teams", { "grok-4.6": "low" }, { "glm-5.3": "max" }]);
    const copy = p.teams.list().find((t) => t.name === "Docs copy");
    assert.deepEqual([copy?.efforts, copy?.leadEfforts], [{ "grok-4.6": "low" }, { "glm-5.3": "max" }]);
  });

  // (fails before: yes — step 6: an edit sent a persona and roles)
  test("Edit sends only what changed and keeps the key; Save waits for a change; a refusal shows in the foot in the server's words and the editor stays", async () => {
    const p = await open({ teams: [DOCS, { name: "Ops", lead: "builder", members: [{ tag: "reviewer" }] }] });
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    let ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "Edit Docs");
    assert.ok(textOf(ed).includes("Its command, |/team docs|, stays when the name changes"));
    const save = () => /** @type {any} */ (btn(ed, "Save"));
    assert.deepEqual(["disabled" in save().attrs, textOf(one(ed, "tset-why"))], [true, "Nothing has changed yet"]);
    type(field(ed, "What this team asks of Builder"), "Plain words, short sentences.   ");
    assert.equal(textOf(one(ed, "tset-why")), "Nothing has changed yet", "spaces alone are no change: a save trims them");
    type(field(ed, "Name"), "Ops");
    save().dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [["PUT", "/teams/docs", { name: "Ops" }]]);
    assert.equal(textOf(one(ed, "tset-error")), "A team called `Ops` already exists — pick another name.");
    assert.ok(p.editor(), "the editor stays, with what was typed");
    assert.equal(field(ed, "Name").value, "Ops");
    type(field(ed, "Name"), "Docs and words");
    type(field(ed, "What this team asks of Reviewer"), "Read it aloud.");
    save().dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p)[1], ["PUT", "/teams/docs", { name: "Docs and words", members: [{ tag: "builder", line: "Plain words, short sentences." }, { tag: "reviewer", line: "Read it aloud." }] }]);
    assert.deepEqual(p.toasts.at(-1), ["The Docs and words team is saved", undefined]);
    assert.equal(textOf(one(p.team("docs"), "lib-team-name")), "Docs and words|yours", "its key stays");
    assert.equal(/** @type {any} */ (btn(p.team("docs"), "Edit")).focused, true, "focus is back on what opened the editor");
    // A change of lead alone sends the lead alone.
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    ed = p.editor();
    pick(field(ed, "Lead"), "enduser");
    save().dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p)[2], ["PUT", "/teams/docs", { lead: "enduser" }]);
    assert.equal(every(one(p.team("docs"), "lib-crew"), "lib-seat")[0].attrs["data-seat"], "enduser", "at the head of its table");
  });

  /** The parts of a shipped team's editor marked "changed", each by the name its Put back says. @param {any} ed */
  const changedIn = (ed) => every(ed, "ed-mine").filter((s) => !("hidden" in s.attrs)).map((s) => String(buttonsOf(s)[0].attrs["aria-label"]).replace(/^Put back /, ""));

  // (HarnessV4_ShippedAgents_Plan SA3, SA4, fails before: yes — a team that ships kept its name, its lead and its crew:
  // "Duplicate it to change who is in it")
  test("Edit on a team that ships: every part of it in place, its name, lead and crew too; what you change is marked with Put back, its pod says “changed by you”, and Put back all, asked first, gives it back whole", async () => {
    const p = await open({});
    // The crew as a save sends it: each seat by its card, under the team's name for it where it gives one.
    const crew = /** @type {any} */ (p.teams.find("builders")).members.map((/** @type {any} */ x) => ({ tag: x.card ?? x.tag, ...(x.card ? { name: x.name } : {}), ...(x.line ? { line: x.line } : {}) }));
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    let ed = p.editor();
    assert.ok(textOf(one(ed, "zc-dialog-desc")).endsWith("It ships with Filament: every part of it is yours to change, and Put back gives Filament's again."), textOf(one(ed, "zc-dialog-desc")));
    assert.deepEqual(every(ed, "ed-part").map((s) => s.attrs["aria-label"]), [undefined, "Workers", "How it runs", "Your agent", undefined], "every part, and As it ships at its end");
    assert.deepEqual([field(ed, "Name").value, field(ed, "Lead").value, memberRows(ed)], ["Builders", "buildlead", ["reviewer", "builder", "builder", "reviewer"]]);
    assert.ok(field(ed, "Name").focused);
    assert.deepEqual(changedIn(ed), [], "as it ships, nothing is marked");
    assert.ok("disabled" in /** @type {any} */ (btn(ed, "Put back all")).attrs);
    pick(field(ed, "Lead"), "product");
    assert.ok(options(field(ed, "Add a worker")).includes("enduser"));
    pick(field(ed, "Add a worker"), "enduser");
    assert.deepEqual(changedIn(ed), ["Lead", "Workers"]);
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p)[0], ["PUT", "/teams/builders", { lead: "product", members: [...crew, { tag: "enduser" }] }]);
    const mark = one(one(p.team("builders"), "lib-team-name"), "lib-mark");
    assert.deepEqual([textOf(mark), mark.attrs.title], ["changed by you", "It ships with Filament; you changed its lead and its workers"]);
    assert.equal(every(one(p.table("builders"), "lib-crew"), "lib-seat")[0].attrs["data-seat"], "product", "at the head of its table");
    // (case 20) One part put back: the lead it ships with is offered again — another team's own Lead is not —, its
    // mark goes, and Save sends it as put back.
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    ed = p.editor();
    assert.deepEqual(changedIn(ed), ["Lead", "Workers"]);
    assert.ok(options(field(ed, "Lead")).includes("buildlead") && !options(field(ed, "Lead")).includes("huntlead"), options(field(ed, "Lead")).join(" "));
    /** @type {any} */ (buttonsOf(ed).find((b) => b.attrs["aria-label"] === "Put back Lead")).dispatch("click");
    assert.deepEqual([field(ed, "Lead").value, changedIn(ed), field(ed, "Lead").focused], ["buildlead", ["Workers"], true]);
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p)[1], ["PUT", "/teams/builders", { lead: null }]);
    assert.deepEqual([/** @type {any} */ (p.teams.find("builders")).lead.tag, /** @type {any} */ (p.teams.find("builders")).set], ["buildlead", ["members"]]);
    // Put back all, asked first: nothing of it is left yours.
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    /** @type {any} */ (btn(p.editor(), "Put back all")).dispatch("click");
    await settle();
    assert.deepEqual(p.sheets.at(-1), { title: "Put back the Builders team as it ships?", description: "What you changed of it goes: its workers. This cannot be undone.", confirmLabel: "Put back", destructive: true });
    assert.deepEqual(teamWrites(p)[2], ["PUT", "/teams/builders", { reset: true }]);
    assert.deepEqual([p.editor(), /** @type {any} */ (p.teams.find("builders")).set, p.toasts.at(-1)], [undefined, [], ["The Builders team is as it ships", undefined]], "the editor closed on it");
    assert.equal(one(one(p.team("builders"), "lib-team-name"), "lib-mark"), undefined);
  });

  // (fails before: yes — a team that ships had Duplicate alone: its models were fixed in the code)
  test("Edit on a team that ships sets how it runs too: its models, its lead's and its switches; Save sends those alone", async () => {
    const p = await open({});
    /** @type {any} */ (btn(p.team("bughunters"), "Edit")).dispatch("click");
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "Edit BugHunters");
    // BugHunters checks a result first, and its own is checked by none: its editor has no such switch.
    assert.deepEqual(all(all(ed, (x) => x.tag === "section" && x.attrs?.["aria-label"] === "Your agent")[0], (x) => x.attrs?.role === "switch").map((x) => x.attrs["aria-label"]), ["Your agent may use it", "Give your agent the result when it finishes"]);
    assert.equal(named(ed, "Have BugHunters check it first"), undefined);
    // Its workers on GLM 5.3 Flash, its lead on Opus: picked where the team stands.
    p.chipIn(one(ed, "tset-crew-model")).o.onChange("GLM 5.3 Flash");
    p.chipIn(one(ed, "tset-lead-model")).o.onChange("Claude Opus 5.5");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [["PUT", "/teams/bughunters", { models: ["GLM 5.3 Flash"], leadModels: ["Claude Opus 5.5"] }]]);
    assert.equal(textOf(one(p.team("bughunters"), "lib-team-name")), "BugHunters|changed by you", "its card says it was set");
    assert.deepEqual(actsOf(p, "bughunters"), ["Edit", "Duplicate"]);
    assert.equal(one(p.team("bughunters"), "lib-pod-chips"), undefined, "its models are its grey line's");
    assert.equal(textOf(one(p.team("bughunters"), "lib-pod-runs")), `Lead: ${prettyModel("Claude Opus 5.5")} on the side — set by you · Workers: ${prettyModel("GLM 5.3 Flash")} — set by you`);
    p.seat("bughunters", "huntlead").dispatch("click");
    assert.ok(textOf(one(p.team("bughunters"), "lib-seat-card")).includes(`Runs on|${prettyModel("Claude Opus 5.5")} · read-only: it changes no file`));
  });

  // (fails before: yes — U13-D15 of 10-20: whether your agent may use a team was its pod's tick alone, each part of
  // the editor a paragraph of hints, and what runs where none is picked said in words only)
  test("how a team runs, in its editor: what runs where none is picked on its pickers, a backup after a pick; read-only apart; Your agent may use it, written once the team is saved, its two follow-ons under it", async () => {
    const p = await open({});
    newTeam(p).dispatch("click");
    const ed = p.editor();
    const blank = (/** @type {string} */ cls) => p.chipIn(one(ed, cls)).o.blank;
    // (the review of 11-05: none picked runs as the server reads it — a lead on its card's, a crew on each member's card's
    // first, its lead's model last —, unless the chat sets its own on its Agents tab)
    assert.deepEqual([blank("tset-lead-model"), blank("tset-crew-model")], ["Its card's models, else the main agent's — unless this chat sets its own", "Each worker's card's, else this chat's list, else its lead's model — unless this chat sets its own"]);
    // (fails before: yes — the owner's 10-21, "this still look so bad. it could have been a popup": the editor took the
    // page, a column of switches and paragraphs) A sheet of parts, each a group of rows: a short label, a quiet line.
    assert.deepEqual([p.title(), !!p.part("Agents")], ["New team", true], "a sheet over the page, which stays behind it");
    assert.deepEqual(every(ed, "ed-part-title").map(textOf), ["Workers", "How it runs", "Your agent"]);
    // (the plan's p6) Its check with how it runs; (fails before: yes — the owner's word of 11-05) no crew at once, nor
    // in one run: each model's limit, set on its row under its provider, holds.
    assert.deepEqual(every(ed, "ed-row-label").map(textOf), ["Name", "Lead", "Lead runs on", "Workers run on", "Check", "Read-only on the side", "May use it", "Gets the result when it finishes", "BugHunters checks it first"]);
    const agentPart = all(ed, (x) => x.tag === "section" && x.attrs?.["aria-label"] === "Your agent")[0];
    assert.deepEqual(all(agentPart, (x) => x.attrs?.role === "switch").map((x) => x.attrs["aria-label"]), ["Your agent may use it", "Give your agent the result when it finishes", "Have BugHunters check it first"], "the two follow-ons with the one they follow");
    assert.deepEqual(all(ed, (x) => x.attrs?.role === "switch").map((x) => x.attrs["aria-checked"]), ["false", "false", "false", "false"]);
    type(field(ed, "Name"), "Docs");
    pick(field(ed, "Lead"), "product");
    pick(field(ed, "Add a worker"), "builder");
    p.chipIn(one(ed, "tset-crew-model")).o.onChange("glm-5.3");
    assert.equal(blank("tset-crew-model"), "Add a backup", "after a pick, the next is a backup");
    /** @type {any} */ (named(ed, "Your agent may use it")).dispatch("click");
    /** @type {any} */ (named(ed, "Give your agent the result when it finishes")).dispatch("click");
    assert.equal(named(ed, "Your agent may use it").attrs["aria-checked"], "true", "a switch turns in place");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [
      ["POST", "/teams", { name: "Docs", lead: "product", members: [{ tag: "builder" }], models: ["glm-5.3"], fired: { notify: true, verify: false } }],
      ["PUT", "/subagents/teams", { teams: ["bughunters", "docs"] }],
    ], "the team first: its key is the save's");
    assert.equal(podTick(p, "docs").checked, true, "its pod's tick says so");
    // Its tick alone changed: Save writes the list, no team.
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    const again = p.editor();
    assert.equal(textOf(one(again, "tset-why")), "Nothing has changed yet");
    /** @type {any} */ (named(again, "Your agent may use it")).dispatch("click");
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p).slice(2), [["PUT", "/subagents/teams", { teams: ["bughunters"] }]]);
    assert.deepEqual([podTick(p, "docs").checked, p.toasts.at(-1)], [false, ["The Docs team is saved", undefined]]);
  });

  // (fails before: yes — step 6: a team had four roles, no more and no fewer)
  test("the crew: up to the limit, a card seated again offered; the note says when the team is full", async () => {
    const more = Array.from({ length: 8 }, (_, i) => ({ tag: `w${i + 1}x`, name: `Worker ${i + 1}`, may: "read", goodFor: "Reads", thinks: "" }));
    const p = await open({ saved: more });
    newTeam(p).dispatch("click");
    const ed = p.editor();
    const add = field(ed, "Add a worker");
    assert.equal(options(add).length, 13, "four shipped agents, eight of yours and the empty choice");
    for (let i = 0; i < TEAM_LIMITS.members; i++) pick(add, options(add)[i + 1]);
    assert.equal(memberRows(p.editor()).length, 12);
    assert.deepEqual(["hidden" in add.attrs, textOf(add.attrs && all(ed, (x) => x.tag === "p" && textOf(x).startsWith("A team has up to"))[0])], [true, "A team has up to 12 workers."]);
    // One taken out: a member may be added again — any card, the eleven seated among them.
    /** @type {any} */ (named(ed, "Take Product out of the team")).dispatch("click");
    assert.deepEqual(["hidden" in add.attrs, options(add).length], [false, 13]);
  });

  // (fails before: yes — the owner's "Teams, improved and kept", 11-03: a member was its card and a line, each card once)
  test("a member's name, model and effort: a card added twice puts the keys on its name; Save sends each seat's name, line, model and effort, only where it has one", async () => {
    const p = await open({});
    newTeam(p).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Name"), "Review pair");
    pick(field(ed, "Lead"), "product");
    pick(field(ed, "Add a worker"), "reviewer");
    pick(field(ed, "Add a worker"), "reviewer");
    const names = all(ed, (x) => x.attrs?.["aria-label"] === "This team's name for Reviewer");
    assert.equal(names.length, 2, "a name field on each seat");
    assert.equal(names[1].focused, true, "the second seat of a card: the keys on its name");
    type(names[0], "Fact Checker");
    type(names[1], "Spotter");
    const lines = all(ed, (x) => x.attrs?.["aria-label"] === "What this team asks of Reviewer");
    type(lines[0], "Check each claim.");
    // Each seat's model, on the picker the agent's editor uses — one model; its effort, in a Brief's words.
    const seats = every(one(ed, "aset-members"), "tset-member-model");
    assert.equal(seats.length, 2);
    p.chipIn(seats[0]).o.onChange("grok-4.6");
    // (fails before: yes — the owner's of 11-06, never a list of names: a seat's effort was a <select>; now the agents'
    // chip, as the lead's and the crew's rows have it)
    const efforts = all(ed, (x) => x.attrs?.["aria-label"] === "How hard Reviewer thinks in this team");
    assert.deepEqual([efforts.map((c) => String(c.attrs.class)), efforts.map((c) => one(c, "ec-words").textContent)], [["ec", "ec"], ["The Brief's, else the chat's", "The Brief's, else the chat's"]]);
    efforts[1].dispatch("click");
    const radios = (p.menus.at(-1) || []).filter((x) => x.type === "radio");
    assert.deepEqual(radios.map((x) => x.label), ["The default: The Brief's, else the chat's", "The model's own", "Low", "Medium", "High", "Extra high", "Max"]);
    radios.find((x) => x.label === "Low").onClick();
    assert.deepEqual(every(one(ed, "aset-members"), "tset-erole-does").map(textOf), [`changes nothing · ${GROK}`, "changes nothing · your chat's list, else its lead's model"], "a seat's own model in its head");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [["POST", "/teams", { name: "Review pair", lead: "product", members: [{ tag: "reviewer", name: "Fact Checker", line: "Check each claim.", model: "grok-4.6" }, { tag: "reviewer", name: "Spotter", effort: "low" }] }]]);
    // Its pod: a seat each, by its id, wearing its card's portrait; each opens its own card.
    assert.deepEqual(every(one(p.team("review-pair"), "lib-crew"), "lib-seat").map((x) => x.attrs["data-seat"]), ["product", "fact-checker", "spotter"]);
    p.seat("review-pair", "fact-checker").dispatch("click");
    assert.ok(textOf(one(p.team("review-pair"), "lib-seat-card")).includes(`changes nothing · ${GROK}`), textOf(one(p.team("review-pair"), "lib-seat-card")));
    // Edit opens on the seats as saved.
    /** @type {any} */ (btn(p.team("review-pair"), "Edit")).dispatch("click");
    assert.deepEqual(all(p.editor(), (x) => x.attrs?.["aria-label"] === "This team's name for Reviewer").map((x) => x.value), ["Fact Checker", "Spotter"]);
    assert.deepEqual(all(p.editor(), (x) => x.attrs?.["aria-label"] === "How hard Reviewer thinks in this team").map((x) => one(x, "ec-words").textContent), ["The Brief's, else the chat's", "Low"]);
  });

  // (fails before: yes — step 6: Delete said nothing of the lead's and the members' cards, which now outlive their team)
  test("Delete asks first on the sheet, saying what stays; Cancel keeps it; after a delete focus goes to New team and the cards are read again", async () => {
    const keep = await open({ teams: [DOCS], confirm: false });
    /** @type {any} */ (btn(keep.team("docs"), "Delete")).dispatch("click");
    await settle();
    assert.deepEqual(keep.sheets, [{
      title: "Delete the Docs team?",
      description: "Sessions it leads keep its name, and are told on their next turn that no team answers to it. Its lead's and its workers' cards stay. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    }]);
    assert.deepEqual(teamWrites(keep), []);
    assert.ok(keep.team("docs"));
    const p = await open({ teams: [DOCS] });
    p.seat("docs", "builder").dispatch("click");
    /** @type {any} */ (btn(one(p.team("docs"), "lib-sq-foot"), "Delete")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p), [["DELETE", "/teams/docs", undefined]]);
    assert.deepEqual([p.team("docs"), p.toasts, p.changed()], [undefined, [["The Docs team is deleted", undefined]], 1]);
    assert.equal(newTeam(p).focused, true);
    assert.equal(p.calls.filter(([m, path]) => m === "GET" && path === "/agents").length, 2, "Product leads nothing now: the cards are read again");
    assert.deepEqual(agentTags(p).slice(0, 2), ["product", "enduser"], "and stands where it stood");
    // A team made under a deleted one's name opens with no seat's card open.
    newTeam(p).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Name"), "Docs");
    pick(field(ed, "Lead"), "product");
    pick(field(ed, "Add a worker"), "reviewer");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(one(p.team("docs"), "lib-seat-card"), undefined);
  });

  // (fails before: yes — the drive of 11-02: a team the file keeps but cannot use stayed on the page after its Delete,
  // and why it cannot be used was cut at the row's end with no way to read the rest)
  test("a team kept but not usable shows why in full on pointing, and its Delete takes its row away", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "teams-held-"));
    try {
      writeFileSync(join(dataDir, "teams.json"), JSON.stringify({ version: 2, teams: { "old-crew": { name: "Old crew", lead: "no-such-card", members: [{ tag: "no-such-card", line: "" }] } } }));
      const p = await open({ dataDir });
      const row = one(p.body, "lib-held-row");
      const why = one(row, "lib-held-why");
      assert.equal(textOf(one(row, "lib-held-name")), "Old crew");
      assert.equal(why.attrs.title, textOf(why), "the reason whole, where the row cuts it");
      /** @type {any} */ (btn(row, "Delete")).dispatch("click");
      await settle();
      assert.deepEqual(teamWrites(p), [["DELETE", "/teams/old-crew", undefined]]);
      assert.equal(one(p.body, "lib-held"), undefined, "its row is gone");
      assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "teams.json"), "utf8")).teams, {});
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the review of 11-03: a team held named the card to seat in a gone one's place, but its row had
  // Delete alone)
  test("a team kept but not usable is put right in its Edit: the editor opens on it as saved, says which card a gone one's place takes, and its Save makes it a team again", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "teams-held-"));
    try {
      writeFileSync(join(dataDir, "teams.json"), JSON.stringify({ version: 2, teams: { "old-crew": { name: "Old crew", lead: "pm", members: [{ tag: "scout", line: "Map it first." }, { tag: "builder", line: "" }], most: 2 } } }));
      const p = await open({ dataDir });
      const row = one(p.body, "lib-held-row");
      // No word of bringing the agent back: a card tagged scout is refused, the name a shipped crew's seat has.
      assert.equal(textOf(one(one(p.body, "lib-held"), "lib-note-row")), "Kept as you saved it, not usable now for the reason on its row: put that right in its Edit and it is usable again, or delete it.");
      /** @type {any} */ (btn(row, "Edit")).dispatch("click");
      const ed = p.editor();
      const why = () => textOf(one(ed, "tset-why"));
      assert.equal(textOf(one(ed, "zc-dialog-title")), "Edit Old crew");
      assert.deepEqual([field(ed, "Name").value, field(ed, "Lead").value, memberRows(ed), field(ed, "Up to this many of its crew at once")], ["Old crew", "", ["scout", "builder"], undefined], "its old most is read as nothing");
      assert.equal(textOf(one(ed, "aset-lead-line")), "PM is now part of Product: make Product the lead in its place");
      assert.equal(why(), "PM is now part of Product: make Product the lead in its place");
      pick(field(ed, "Lead"), "product");
      assert.deepEqual([textOf(one(ed, "tset-gone")), why()], ["Scout is now part of Reviewer: seat Reviewer in its place", "Scout is now part of Reviewer: seat Reviewer in its place"]);
      pick(field(ed, "A card in place of @scout"), "reviewer");
      assert.deepEqual([memberRows(p.editor()), one(p.editor(), "tset-gone")], [["reviewer", "builder"], undefined]);
      assert.equal(field(ed, "What this team asks of Reviewer").value, "Map it first.", "the seat keeps its line");
      type(field(ed, "This team's name for Reviewer"), "Scout");
      assert.equal(why(), "");
      /** @type {any} */ (btn(ed, "Save")).dispatch("click");
      await settle();
      // (the plan's p6) Its check with it: none — and no most, nor a total in one run (the owner's word of 11-05).
      assert.deepEqual(teamWrites(p), [["PUT", "/teams/old-crew", { name: "Old crew", lead: "product", members: [{ tag: "reviewer", name: "Scout", line: "Map it first." }, { tag: "builder" }], models: [], leadModels: [], readOnly: false, fired: { notify: false, verify: false }, check: null }]]);
      assert.deepEqual([p.editor(), one(p.body, "lib-held"), p.toasts.at(-1)], [undefined, undefined, ["The Old crew team is saved, and can be used again", undefined]]);
      assert.deepEqual(every(one(p.team("old-crew"), "lib-crew"), "lib-seat").map((x) => x.attrs["data-seat"]), ["product", "scout", "builder"]);
      assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "teams.json"), "utf8")).teams["old-crew"].lead, "product");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: Duplicate offered the name of a team kept but not usable, which Save refused)
  test("Duplicate's free name passes over a team kept but not usable", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "teams-held-"));
    try {
      writeFileSync(join(dataDir, "teams.json"), JSON.stringify({ version: 2, teams: { "builders-copy": { name: "Builders copy", lead: "no-such-card", members: [{ tag: "no-such-card", line: "" }] } } }));
      const p = await open({ dataDir });
      /** @type {any} */ (btn(p.team("builders"), "Duplicate")).dispatch("click");
      assert.equal(field(p.editor(), "Name").value, "Builders copy 2");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the bug hunt of 11-02: the free name was checked against a held team's name word for word, so a
  // team held under the key "Architect copy" makes, or under a name that keys the same in other words, left it free, and
  // Save was refused)
  test("Duplicate's free name passes over a key a team kept but not usable holds — its own key, or its name's", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "teams-held-"));
    try {
      writeFileSync(join(dataDir, "teams.json"), JSON.stringify({ version: 2, teams: {
        // Under the key, by another name: the shipped Builders holds the name, so it is held.
        "builders-copy": { name: "Builders", lead: "product", members: [{ tag: "builder", line: "" }] },
        // A name keyed "builders-copy-2": a card it names is gone.
        old: { name: "Builders: copy 2", lead: "no-such-card", members: [{ tag: "no-such-card", line: "" }] },
      } }));
      const p = await open({ dataDir });
      assert.deepEqual(p.teams.held().map((h) => h.key), ["builders-copy", "old"]);
      /** @type {any} */ (btn(p.team("builders"), "Duplicate")).dispatch("click");
      assert.equal(field(p.editor(), "Name").value, "Builders copy 3");
      /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
      await settle();
      assert.deepEqual([teamWrites(p).map(([m, path, b]) => [m, path, b.name]), p.toasts.at(-1)?.[1]], [[["POST", "/teams", "Builders copy 3"]], undefined], "the store takes it");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // (fails before: no — a guard: a write the server refuses outside the editor says so, the list as it was)
  test("a Delete the server refuses is an error toast, the list as it was", async () => {
    const p = await open({ teams: [DOCS], refuse: (m) => (m === "DELETE" ? { status: 409, error: "The Docs team leads a running session." } : null) });
    /** @type {any} */ (btn(p.team("docs"), "Delete")).dispatch("click");
    await settle();
    assert.deepEqual(p.toasts, [["The Docs team leads a running session.", "err"]]);
    assert.ok(p.team("docs"));
    assert.equal(p.changed(), 0);
  });

  // (fails before: no — a guard: the editor counts a line against the limit a save checks, and cuts nothing)
  test("the editor counts a member's line against its limit from where it is near, says when it is past it, and cuts nothing", async () => {
    const p = await open({ teams: [DOCS] });
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    const ed = p.editor();
    const line = field(ed, "What this team asks of Builder");
    const count = () => every(one(ed, "aset-members"), "tset-count")[0];
    assert.equal(textOf(count()), "", "far from the limit: no count");
    type(line, "x".repeat(TEAM_LIMITS.line * 0.9));
    assert.deepEqual([textOf(count()), count().classList.contains("is-near"), count().classList.contains("is-over")], ["1,800 / 2,000", true, false]);
    type(line, "x".repeat(TEAM_LIMITS.line + 1));
    assert.deepEqual([textOf(count()), count().classList.contains("is-near"), count().classList.contains("is-over")], ["2,001 / 2,000", false, true]);
    assert.equal(line.value.length, TEAM_LIMITS.line + 1, "nothing is cut");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(textOf(one(ed, "tset-error")), "The team's line for Builder is longer than 2,000 characters (2,001).", "the save's refusal, in the server's words");
  });

  // (fails before: partly — a guard: the editor's keys, and the way back; the sheet, its ask before a change is thrown
  // away and the page left where it stood behind it are the owner's 10-21)
  test("the editor's keys: Ctrl or ⌘ Enter saves, Esc goes back — asking first where something changed; Cancel goes back too, the page where it stood behind the sheet", async () => {
    const p = await open({ teams: [DOCS], confirm: false });
    p.body.scrollTop = 420;
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    assert.equal(p.body.scrollTop, 420, "the page stays where it stood behind the sheet");
    let ed = p.editor();
    field(ed, "Name").dispatch("keydown", { key: "Escape" });
    assert.deepEqual([p.editor(), p.sheets.length], [undefined, 0], "nothing changed: no question");
    assert.equal(p.body.scrollTop, 420, "back where the page stood");
    assert.equal(/** @type {any} */ (btn(p.team("docs"), "Edit")).focused, true);
    // A change, then Esc: asked first; kept, the sheet stays with what was typed.
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Docs X");
    p.dismiss();
    await settle();
    assert.deepEqual([p.sheets.at(-1)?.title, p.editor() === ed, field(ed, "Name").value], ["Discard the changes?", true, "Docs X"], "kept on the person's word");
    /** @type {any} */ (btn(ed, "Cancel")).dispatch("click");
    assert.equal(p.editor(), undefined, "Cancel does not ask");
    for (const back of ["Cancel"]) {
      /** @type {any} */ (btn(p.team("docs"), "Duplicate")).dispatch("click");
      /** @type {any} */ (btn(p.editor(), back)).dispatch("click");
      assert.equal(p.editor(), undefined, back);
      assert.equal(/** @type {any} */ (btn(p.team("docs"), "Duplicate")).focused, true, back);
    }
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Docs two");
    field(ed, "What this team asks of Builder").dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settle();
    assert.deepEqual(teamWrites(p), [["PUT", "/teams/docs", { name: "Docs two" }]]);
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Docs three");
    field(ed, "Name").dispatch("keydown", { key: "Enter", metaKey: true });
    await settle();
    assert.equal(teamWrites(p).length, 2);
    field(p.editor() || p.body, "Name")?.dispatch("keydown", { key: "Enter" });
    assert.equal(teamWrites(p).length, 2, "Enter alone saves nothing");
  });

  // (fails before: no — a guard: while a save is in flight Save is disabled, and a second Save sends nothing more)
  test("while a save is in flight Save is disabled, and a second Save by click or keys sends nothing more", async () => {
    /** @type {(() => void) | null} */
    let release = null;
    const p = await open({ teams: [DOCS], hold: (m, path) => (m === "PUT" && path === "/teams/docs" ? new Promise((r) => { release = () => r(); }) : null) });
    /** @type {any} */ (btn(p.team("docs"), "Edit")).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Name"), "Docs two");
    const save = /** @type {any} */ (btn(ed, "Save"));
    save.dispatch("click");
    await settle();
    assert.equal("disabled" in save.attrs, true);
    save.dispatch("click");
    field(ed, "Name").dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settle();
    assert.equal(teamWrites(p).length, 1);
    /** @type {any} */ (release)();
    await settle();
    assert.equal(p.editor(), undefined);
  });

  // (fails before: yes — step 6: the teams' read was a page's of its own; here it failing must leave the cards standing)
  test("teams that cannot be read say so in their section, with Try again, while the cards stand; opened from New team the page starts in the editor; its address shows every team", async () => {
    const p = await open({ failTeams: true });
    assert.ok(all(p.body, (x) => x.attrs?.["data-tag"] === "product")[0], "the cards are drawn");
    assert.equal(textOf(one(p.groups(), "set-error")), "The teams could not be read: Filament is not answering");
    assert.equal(newTeam(p), undefined);
    assert.deepEqual(agentTags(p).filter((t) => ["buildlead", "huntlead", "verifylead"].includes(t)), [], "unread, a team's own Lead is still in no list: it is its team's (OA-D4)");
    p.heal();
    /** @type {any} */ (btn(p.groups(), "Try again")).dispatch("click");
    await settle();
    assert.ok(p.team("builders"));
    const q = await open({ start: "new-team" });
    assert.equal(textOf(one(q.editor(), "zc-dialog-title")), "New team");
    /** @type {any} */ (btn(q.editor(), "Cancel")).dispatch("click");
    assert.equal(newTeam(q).focused, true, "Cancel is back on the page, focus on New team");
    // The teams' address brings them into sight, each shown.
    const g = await open({ start: "groups" });
    assert.deepEqual(g.groups().scrolledIntoView, { block: "start" });
    assert.deepEqual(shownTeams(g), ["bughunters", "builders"]);
    assert.equal((await open()).groups().scrolledIntoView, undefined);
  });
});

describe("Library › your agent's teams", () => {
  // (fails before: yes — U13-D9: whether your agent may start a team by itself was set nowhere on the page)
  test("each pod's tick, “Your agent may use it”: BugHunters to start with, those that change files not; a tick writes the list whole, says what it means and keeps the keys; a gone team is never written; a refusal is said and the tick goes back", async () => {
    const p = await open({ teams: [DOCS] });
    assert.deepEqual(["bughunters", "docs", "builders"].map((k) => podTick(p, k).checked), [true, false, false]);
    assert.equal(podTick(p, "builders").attrs["aria-label"], "Your agent may use the Builders team");
    podTick(p, "builders").checked = true;
    podTick(p, "builders").dispatch("change");
    await settle();
    assert.deepEqual(teamWrites(p), [["PUT", "/subagents/teams", { teams: ["bughunters", "builders"] }]]);
    assert.deepEqual(p.toasts.at(-1), ["Your agent may send the Builders team by itself, in every chat that chose no list of its own", undefined]);
    assert.deepEqual([podTick(p, "builders").checked, podTick(p, "builders").focused, p.changed()], [true, true, 1], "drawn again, the keys on the tick");
    podTick(p, "bughunters").checked = false;
    podTick(p, "bughunters").dispatch("change");
    await settle();
    assert.deepEqual(teamWrites(p).at(-1), ["PUT", "/subagents/teams", { teams: ["builders"] }]);
    assert.deepEqual(p.toasts.at(-1), ["Your agent no longer sends the BugHunters team by itself", undefined]);
    // A key that names no team any more — those Filament no longer ships among them — is left out of the write.
    const stale = await open({ agentTeams: ["bughunters", "gone", "architect", "verifier"] });
    podTick(stale, "builders").checked = true;
    podTick(stale, "builders").dispatch("change");
    await settle();
    assert.deepEqual(teamWrites(stale), [["PUT", "/subagents/teams", { teams: ["bughunters", "builders"] }]]);
    // A refusal: said in the server's words, the tick as the list stands.
    const no = await open({ refuse: (m, path) => (m === "PUT" && path === "/subagents/teams" ? { status: 400, error: "the config could not be saved" } : null) });
    podTick(no, "bughunters").checked = false;
    podTick(no, "bughunters").dispatch("change");
    await settle();
    assert.deepEqual([no.toasts.at(-1), podTick(no, "bughunters").checked, no.changed()], [["the config could not be saved", "err"], true, 0]);
  });

  // (fails before: yes — the bug hunt of 11-02: a saved list naming only teams since deleted ticked no team on the page,
  // while fire and status read it as the default, Bug Hunter and the Verifier)
  test("the ticks are the teams in force: a saved list naming only teams that are gone ticks the default ones, as fire and status read it", async () => {
    const teams = teamStore();
    /** The list the real route answers for a saved one, beside the one fire and status read from it. @param {unknown} saved */
    const read = async (saved) => {
      const got = await routeAnswer(teams, saved, "GET", "/teams");
      assert.equal(got.status, 200);
      return [got.body.agentTeams, got.fired];
    };
    assert.deepEqual(await read(["gone", "left-too"]), [["bughunters"], ["bughunters"]]);
    assert.deepEqual(await read(["bug-hunter", "verifier"]), [["bughunters"], ["bughunters"]], "the keys BugHunters took in are gone teams too: never converted");
    assert.deepEqual(await read(["builders", "gone"]), [["builders"], ["builders"]], "a team gone is dropped beside one that is not");
    assert.deepEqual(await read([]), [[], []], "an empty list stays none");
    const [shown] = await read(["gone"]);
    const p = await open({ agentTeams: shown });
    assert.deepEqual(["bughunters", "builders"].map((k) => podTick(p, k).checked), [true, false]);
  });

  /** Each pod's tick, by key. @param {any} p @param {string[]} keys */
  const ticks = (p, keys) => keys.map((k) => podTick(p, k).checked);

  // (fails before: yes — the bug hunt of 11-02, sa_f1e49988: a delete's answer carried no list, so the page kept its
  // ticks — the one team ticked gone, Bug Hunter and the Verifier unticked — while fire and status read the default
  // again, until the page was read anew)
  test("a delete that leaves the list naming no team ticks the default ones at once, as fire and status read it", async () => {
    const p = await open({ teams: [DOCS] });
    for (const [key, on] of /** @type {[string, boolean][]} */ ([["docs", true], ["bughunters", false]])) {
      podTick(p, key).checked = on;
      podTick(p, key).dispatch("change");
      await settle();
    }
    assert.deepEqual(teamWrites(p).at(-1), ["PUT", "/subagents/teams", { teams: ["docs"] }]);
    assert.deepEqual(ticks(p, ["bughunters", "docs"]), [false, true]);
    /** @type {any} */ (btn(one(p.team("docs"), "lib-sq-foot"), "Delete")).dispatch("click");
    await settle();
    assert.equal(p.team("docs"), undefined);
    assert.equal(p.calls.filter(([m, path]) => m === "GET" && path === "/teams").length, 1, "the page is not read anew: the delete's answer says it");
    assert.deepEqual(ticks(p, ["bughunters", "builders"]), [true, false]);
    // The route's answer: the teams in force once the team is gone.
    const teams = teamStore();
    teams.create(DOCS);
    const got = await routeAnswer(teams, ["docs"], "DELETE", "/teams/docs");
    assert.equal(got.status, 200);
    assert.deepEqual([got.body.agentTeams, got.fired], [["bughunters"], ["bughunters"]]);
  });

  // (fails before: yes — the same hunt: a save's answer carried no list, so a team made or renamed under a name the
  // saved list still holds — the one a fire then starts — stayed unticked, and the default ones ticked)
  test("a team made, or renamed, under a name the saved list holds is ticked at once and the default ones not; its name put back unticks it", async () => {
    // Made: the list names a team since deleted, and a new team takes its name.
    const p = await open({ agentTeams: ["docs"] });
    assert.deepEqual(ticks(p, ["bughunters", "builders"]), [true, false]);
    newTeam(p).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Name"), "Docs");
    pick(field(ed, "Lead"), "product");
    pick(field(ed, "Add a worker"), "reviewer");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(p).map(([m, path]) => [m, path]), [["POST", "/teams"]], "the list is not written");
    assert.deepEqual(ticks(p, ["bughunters", "builders", "docs"]), [false, false, true]);
    // Renamed: a team of yours takes the name, its key kept.
    const q = await open({ teams: [{ ...DOCS, name: "Notes" }], agentTeams: ["docs"] });
    assert.deepEqual(ticks(q, ["bughunters", "notes"]), [true, false]);
    /** @type {any} */ (btn(q.team("notes"), "Edit")).dispatch("click");
    type(field(q.editor(), "Name"), "Docs");
    /** @type {any} */ (btn(q.editor(), "Save")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(q), [["PUT", "/teams/notes", { name: "Docs" }]]);
    assert.deepEqual(ticks(q, ["bughunters", "notes"]), [false, true]);
    // A team that ships takes it, then Put back all gives its name back: the list names no team, the default ones again.
    const s = await open({ agentTeams: ["docs"] });
    /** @type {any} */ (btn(s.team("builders"), "Edit")).dispatch("click");
    type(field(s.editor(), "Name"), "Docs");
    /** @type {any} */ (btn(s.editor(), "Save")).dispatch("click");
    await settle();
    assert.deepEqual(ticks(s, ["bughunters", "builders"]), [false, true]);
    /** @type {any} */ (btn(s.team("builders"), "Edit")).dispatch("click");
    /** @type {any} */ (btn(s.editor(), "Put back all")).dispatch("click");
    await settle();
    assert.deepEqual(teamWrites(s).map(([m, path, b]) => [m, path, b]), [["PUT", "/teams/builders", { name: "Docs" }], ["PUT", "/teams/builders", { reset: true }]]);
    assert.deepEqual(ticks(s, ["bughunters", "builders"]), [true, false]);
    // The route's answers: the teams in force after each write.
    const teams = teamStore();
    const made = await routeAnswer(teams, ["docs"], "POST", "/teams", DOCS);
    assert.deepEqual([made.status, made.body.agentTeams, made.fired], [200, ["docs"], ["docs"]]);
    const renamed = await routeAnswer(teams, ["gone"], "PUT", "/teams/docs", { name: "Gone" });
    assert.deepEqual([renamed.status, renamed.body.agentTeams, renamed.fired], [200, ["docs"], ["docs"]]);
    const back = await routeAnswer(teams, ["gone"], "PUT", "/teams/docs", { name: "Docs" });
    assert.deepEqual([back.status, back.body.agentTeams, back.fired], [200, ["bughunters"], ["bughunters"]]);
  });
});

describe("where the teams are reached", () => {
  // (fails before: yes — step 6: Settings had a Teams entry beside Agents; phase 7: Agents was a Settings page)
  test("Settings has no Teams entry, nor Agents and teams (the owner's word of 10-23), and the old addresses lead to the Library — settings/teams with the teams in sight", () => {
    // Models went in the owner's settings cleanup of 11-09.
    assert.deepEqual(SECTIONS.filter((s) => s.group === "Models and agents").map((s) => s.id), ["providers", "agents"]);
    assert.equal(SECTIONS.some((s) => s.id === "teams"), false);
    assert.deepEqual([libraryOf("saved-agents"), libraryOf("teams"), libraryOf("skills"), libraryOf("memory")], [{ page: "agents", start: null }, { page: "agents", start: "groups" }, { page: "skills", start: null }, null]);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /\n {2}const moved = route\.kind === "settings" \? libraryOf\(route\.section\) : null;\n {2}if \(moved\) \{\n {4}if \(moved\.start && !agentsStart\) agentsStart = moved\.start;\n {4}location\.replace\(routeFor\("library", \{ page: moved\.page \}\)\);\n/);
    const page = readFileSync("src/ui/harness/settings/page.js", "utf8");
    assert.doesNotMatch(page, /renderTeams|renderSavedAgents|renderAbilities/);
    const console = readFileSync("src/ui/pages/settings.js", "utf8");
    assert.match(console, /h\("a", \{ href: "\/ui\/harness\.html#\/library\/agents" \}, "Library › Agents and teams"\)/, "the console's team prompts point to where teams are made");
  });

  // (fails before: yes — step 6: New team opened a Teams page; phase 7: it opened Settings › Agents)
  test("the page's wiring: New team opens Library › Agents and teams on a new team's editor, once; a change reads the open session's settings again", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // The teams to hand a chat to, on the Team tab and Who runs this chat (proposal_ux R4, team_v2_plan TV2-D1): New team there.
    assert.match(app, /\n {4}newTeam: \(\) => \{ agentsStart = "new-team"; location\.hash = routeFor\("library", \{ page: "agents" \}\); \},\n/);
    assert.match(app, /\n {6}onChanged: \(\) => \{ const c = chatOf\(state\.currentId\); if \(c\) refreshSessionDoc\(c\); \},\n {6}start: route\.page === "agents" \? takeAgentsStart\(\) : null,\n/);
    assert.match(app, /\nconst takeAgentsStart = \(\) => \{\n {2}const s = agentsStart;\n {2}agentsStart = null;\n {2}return s;\n\};\n/, "the start is taken once: the next visit opens on the list");
  });

  // (fails before: yes — found on the live page: Enter on "The whole team" drew the lists again and the focus fell
  // back to the page; the same on an agent's card, and on its tick)
  test("the page is drawn again with the keyboard's place kept: a card opened by the keyboard keeps the focus on its face", () => {
    const agents = readFileSync("src/ui/harness/library/agents.js", "utf8");
    assert.match(agents, /\n {4}keepingFocus\(body, \(\) => body\.replaceChildren\(m\("div", \{ class: "lib-ag" \},\n/);
    assert.equal(agents.split("body.replaceChildren(m(\"div\", { class: \"lib-ag\" }").length, 2, "the one place the page is drawn");
  });
});
