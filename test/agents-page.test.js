// @ts-check
// Library › Agents and teams (HarnessV4_Tasks E15 steps 2 and 4; proposal_ux §4.15, phase 7; team_v2_plan §10 O5; U13,
// "Agents, one thing"; HarnessV4_OneAgent_Plan OA1, one kind of agent): one page — the Teams, as pods
// (teams-page.test.js); the Agents, yours first, each saying the teams that seat it, with their New agent…; those On
// their own — and New agent… and New team… at its head. Each card's face opens it to its whole: how it thinks, what it may do, its model, what it sees, what
// asking it or a job does, who uses it, Make a copy and Delete; its foot holds its one tick, "Your agent may use it"
// (step 3) — none on Helper and Scout, which your agent can always use: the ticks are the list of whom a chat's main
// agent may ask or give a job by itself, written whole. Beside them, How you use them: in a chat, never from here. Yours
// carry Edit, Make a copy and Delete, the shipped ones Edit and Make a copy; the editor, where a copy needs a tag of its
// own and a refusal comes in the server's words; Delete asked first on the sheet. Its reads and writes go through the
// admin routes, here a thin stand-in over the real card store. The editor's Listed under and May do, an agent's words
// left out, a model checked as it is picked. The teams and Models for agents are teams-page.test.js's.
// Then where the page is reached: Settings keeps a link to it, apart from Coding agents. DOM-free: the fake `h`, a
// stand-in model picker and sheet (helpers/agents-page.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryOf } from "../src/ui/harness/lib/router.js";
import { LIBRARY_HITS, SECTIONS, libraryHits } from "../src/ui/harness/settings/page.js";
import { seesWords, leadingTags, addressed, listed, usedByWords, cardIcon, cardTone, toolsOffWords, agentsCount, isBuildTeam, BUILD_TEAM, COPY_HOLDS, RUNS_HINT, TOOL_WORDS } from "../src/ui/harness/lib/agent-cards.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { AGENT_CARDS_FILE, CARD_LIMITS, SHIPPED_CARDS, shippedCard } from "../src/services/agent-cards.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { all, every, one, btn, field, type, settle, openAgents as open } from "./helpers/agents-page.js";
import "./helpers/teams-on-page.js";

/** An agent's card — or, for a shipped team's lead, its seat in its pod. @param {any} n @param {string} tag */
const cardOf = (n, tag) => all(n, (x) => x.attrs?.["data-tag"] === tag)[0];
/** A card's face: the press that opens and folds it. @param {any} n @param {string} tag */
const faceOf = (n, tag) => one(cardOf(n, tag), "lib-card-face");
/** A card's foot: its tick, or that your agent can always use it, and its Edit. @param {any} n @param {string} tag */
const footOf = (n, tag) => one(cardOf(n, tag), "lib-card-bar");
/** The chips on a card's face. @param {any} n @param {string} tag */
const chipsOf = (n, tag) => every(faceOf(n, tag), "lib-chip").map((c) => textOf(c));
/** A card opened to its whole, where it is folded. @param {any} n @param {string} tag */
const openCard = (n, tag) => {
  if (!one(cardOf(n, tag), "lib-card-detail")) faceOf(n, tag).dispatch("click");
  return cardOf(n, tag);
};
/** The facts of a card's whole, opened. @param {any} n @param {string} tag */
const factsOf = (n, tag) => every(one(openCard(n, tag), "tset-detail"), "aset-fact").map((f) => textOf(f));
/** The tags of the cards under a node. @param {any} n */
const tagsIn = (n) => every(n, "lib-card").map((c) => c.attrs["data-tag"]).filter(Boolean);

/** What asking an agent does, as its whole says it, by its level (OA1). */
const ASKED = (/** @type {string} */ does) => `it answers, ${does}; its answer comes to you, and stays with you until you send it on; one your agent asks reports to your agent`;
const ASKED_EDIT = ASKED("or does the work in its own copy of the project, and what it changes waits there for you to apply");
const ASKED_READ = "it answers, and changes nothing; its answer comes to you, and stays with you until you send it on; one your agent asks reports to your agent";
const SECURITY = { tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You read a change as someone who wants to break it." };
/** What a card that names no model runs on, in its whole. */
const NO_MODEL = "Same as the main agent, unless this chat sets its own — as a team's worker, its team's models first";

describe("Library › Agents and teams", () => {
  // (fails before: yes — phase 7: the page was Settings › Agents; team_v2_plan §10 O5: it opened on four ways; the
  // owner's 10-20: two tabs, Teams and Agents, the leads of the teams that ship as chips, Catch me up a tile — U13-D4:
  // one page)
  // (OA1, fails before: yes — Advisors and Doers, two lists of one kind of thing)
  // (fails before: yes — the owner's word of 11-05: Models for agents stood beside them, a model's limit set there)
  // (fails before: yes — the owner's of 11-09, "a lot of space is wasted": how you use them stood open in a column
  // beside the Teams and the Agents, cut off at the window's edge)
  test("one page, one column: the Teams and the Agents; How to use them at its head opens how you use them in a chat and the coding agents' own, closed until it is pressed; New agent… and New team… beside it", async () => {
    const p = await open({ saved: [SECURITY] });
    assert.deepEqual(p.calls.map(([m, path]) => `${m} ${path}`).sort(), ["GET /agents", "GET /models?all=1", "GET /teams"], "each asked once: the catalogue only draws it again");
    const page = () => one(p.body, "lib-ag");
    assert.deepEqual(page().kids.map((/** @type {any} */ k) => k.attrs.class), ["lib-ag-bar", "lib-sec aset-groups", "lib-sec aset-agents"], "one column: nothing beside them");
    assert.deepEqual(buttonsOf(one(page(), "lib-ag-bar")).map(textOf), ["How to use them", "New agent…", "New team…"]);
    assert.equal(all(page(), (x) => x.attrs?.role === "tab").length, 0, "no tabs");
    // How to use them: closed until it is pressed; pressed, its guide stands over the Teams.
    const how = () => /** @type {any} */ (btn(one(p.body, "lib-ag-bar"), "How to use them"));
    assert.equal(how().attrs["aria-expanded"], "false");
    assert.equal(one(p.body, "lib-guide"), undefined, "closed at first");
    how().dispatch("click");
    assert.equal(how().attrs["aria-expanded"], "true");
    const uses = one(p.body, "lib-guide");
    assert.equal(page().kids[1], uses, "between the head and the Teams");
    assert.equal(how().attrs["aria-controls"], uses.attrs.id);
    // How you use them: in a chat, never from here — words, each way where it is done.
    assert.equal(textOf(one(uses, "lib-panel-h")), "How you use them — in a chat");
    const lines = every(uses, "lib-where-line");
    assert.deepEqual(lines.map((l) => textOf(l.kids[0])), ["Ask", "Start one beside you", "Put a team in charge", "Send a team on the side", "Pick its model", "Your agent by itself", "Coding agents' own"]);
    assert.equal(textOf(lines[0]), "Ask| |— start a message with |@product is this worth it?| and the answer is yours alone. Name it later in a message to your agent, and the answer goes to your agent too. The line over the box says who gets it, and on which model, before you send.");
    assert.equal(textOf(lines[2]), "Put a team in charge| |— Agents › Start… › a team › In charge, or |/team builders|. It runs your chat until Back to your agent.");
    assert.equal(textOf(lines[5]), "Your agent by itself| |— only what you let it use: Builder and Reviewer always; BugHunters to start with. A team it sends works on the side, its result waiting for you unless the team says otherwise. Ticks here count in every chat; a chat can change its own on its Agents tab.");
    // The coding agents' own: shown when they run, never kept here — the guide's last word.
    assert.equal(textOf(one(uses, "lib-own")), "Coding agents' own| — Claude Code starts sub-agents of its own: general-purpose, Explore, Plan. They show in a chat's Agents tab tagged |Claude Code's own|, with Stop; Filament keeps none of them and cannot change them.");
    assert.deepEqual(buttonsOf(uses).map((b) => b.attrs["aria-label"]), ["Close how to use them"], "nothing in it is pressed but its ×");
    // Its × closes it, the keys back on How to use them; pressed again, it closes too.
    /** @type {any} */ (buttonsOf(uses)[0]).dispatch("click");
    assert.deepEqual([one(p.body, "lib-guide"), how().attrs["aria-expanded"], how().focused], [undefined, "false", true]);
    how().dispatch("click");
    how().dispatch("click");
    assert.equal(one(p.body, "lib-guide"), undefined);
    assert.deepEqual(p.writes(), [], "nothing of it is written");
    // Agents: yours first, then those that ship — every one, each at its level, and their New agent…; the leads of the
    // teams that ship live in their pods (U13-D3, OA-D4).
    const agents = p.part("Agents");
    assert.equal(textOf(one(agents, "lib-sec-h")), "Agents|5|any of them can be asked, lead a team or work in one");
    // (fails before: yes — the design pass of 10-24 drew a Second opinion and a Crew apart; the owner's word of 10-24: "I liked the previous design better where everything was just an Agent and Teams just
    // referenced those agents into their desk") One grid, every card the same: yours, then the shipped ones; a card a
    // team seats says so on its chip ("in 4 teams", below).
    // ("Teams, improved and kept" of 11-03: four ship beside the Leads)
    assert.deepEqual(tagsIn(agents), ["security", "product", "enduser", "builder", "reviewer"]);
    assert.deepEqual(tagsIn(one(agents, "lib-grid")), tagsIn(agents), "one grid, no groups");
    // (fails before: yes — the owner's of 11-09: a dashed New agent… ended them, beside the head's) One of them is yours:
    // New agent… is the head's alone.
    assert.equal(one(agents, "lib-new"), undefined);
    const main = page();
    for (const tag of ["buildlead", "huntlead"]) assert.ok(String(cardOf(main, tag)?.attrs.class).startsWith("lib-seat"), `${tag}: its seat in its pod, no card of its own`);
    // (the plan's p6) The four build teams' Leads are gone: no card, no row of theirs.
    for (const tag of ["tenx", "methodical", "architect", "oneshot"]) assert.equal(cardOf(main, tag), undefined, `${tag}: Builders does its work, no card of its own`);
    // (the plan's p6) The Verifier's Lead is gone with its team, into BugHunters: no card, no seat of its own.
    assert.equal(cardOf(main, "verifylead"), undefined, "verifylead: part of BugHunters now, no card of its own");
    assert.equal(textOf(faceOf(p.body, "security")), "Security|@security|yours|What an attacker would try first|Reads only|Sees what it is asked");
    assert.equal(textOf(footOf(p.body, "security")), "Your agent may use it|Edit");
    // (fails before: yes — OA1: PM read only, as every lead did; Product edits in its own copy as PM did)
    assert.equal(textOf(faceOf(p.body, "product")), "Product|@product|Is it worth building, its smallest version, and where it lives on the page|Changes files|Sees what it is asked");
    assert.deepEqual(["builder", "reviewer", "enduser"].map((t) => chipsOf(p.body, t)), [
      ["Changes files", "in Builders", "Sees what it is asked"],
      ["Reads only", "in 2 teams", "Sees what it is asked"],
      ["Runs in its own copy", "Sees what it is asked"],
    ]);
    assert.equal(every(faceOf(p.body, "reviewer"), "lib-chip")[1].attrs.title, "One card, a worker in Builders and BugHunters: a change to it is a change in each");
    assert.equal(every(faceOf(p.body, "reviewer"), "lib-chip")[2].attrs.title, "Your question alone");
    // Builder and Reviewer: your agent can always use them — in grey, nothing to tick.
    assert.deepEqual(["builder", "reviewer", "product"].map((t) => textOf(footOf(p.body, t))), ["Your agent can always use it|Edit", "Your agent can always use it|Edit", "Your agent may use it|Edit"]);
    // (fails before: yes — the owner's word of 11-05: On their own held Explainer and Watcher, which started by
    // themselves) Catch me up is a ready start in a chat, not an agent.
    assert.equal(textOf(p.body).includes("On their own"), false);
    assert.equal(textOf(p.body).includes("Catch me up"), false);
    // Each card wears its agent's tone; yours its place's, or its source's.
    assert.ok(String(one(faceOf(p.body, "product"), "lib-tile").attrs.class).includes("is-pink"));
    assert.ok(String(one(cardOf(p.body, "security"), "lib-tile").attrs.class).includes("is-blue"), "one tone for any agent of yours");
    assert.deepEqual([cardTone({ tag: "x", from: "product" }), cardTone({ tag: "y" })], ["pink", "blue"]);
  });

  // (fails before: yes — U13-D4: New agent… and New team… stood by the tabs, one on each)
  test("New agent… and New team… stand at the page's head — beside its title where it has one —; New agent… opens the editor in a sheet over the page, which stays behind it; a start opens the page on the teams; nothing is written", async () => {
    const head = fakeH("span", {});
    const p = await open({ acts: head });
    assert.deepEqual(buttonsOf(head).map(textOf), ["How to use them", "New agent…", "New team…"]);
    assert.equal(one(p.body, "lib-ag-bar"), undefined, "no bar of its own");
    /** @type {any} */ (btn(head, "New agent…")).dispatch("click");
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "New agent");
    assert.equal(one(ed, "aset-place-line"), undefined, "no list to choose: one kind of agent (OA1)");
    // (fails before: yes — the owner's 10-21, "it could have been a popup": the editor took the page's place)
    assert.deepEqual([head.kids.length, !!p.part("Agents")], [3, true], "the page and its head stay behind the editor's sheet");
    /** @type {any} */ (btn(ed, "Cancel")).dispatch("click");
    assert.ok(/** @type {any} */ (btn(head, "New agent…")).focused);
    /** @type {any} */ (btn(head, "New team…")).dispatch("click");
    assert.equal(textOf(one(p.editor(), "zc-dialog-title")), "New team");
    /** @type {any} */ (btn(p.editor(), "Cancel")).dispatch("click");
    assert.ok(/** @type {any} */ (btn(head, "New team…")).focused);
    // How to use them, in the head: its guide opens over the page's Teams.
    /** @type {any} */ (btn(head, "How to use them")).dispatch("click");
    assert.deepEqual([btn(head, "How to use them")?.attrs["aria-expanded"], one(p.body, "lib-ag").kids[0]?.attrs.class], ["true", "lib-panel lib-guide"]);
    assert.deepEqual(p.writes(), [], "nothing is written to Filament");
    // Opened on the teams (where Settings search's rows for the teams land).
    assert.deepEqual((await open({ start: "groups" })).groups().scrolledIntoView, { block: "start" });
  });

  // (fails before: yes — U13-D3: the leads of the teams that ship were chips on the Agents tab, apart from their pods)
  test("a lead that heads a team that ships lives in its pod: its seat carries its card — its words, its models and what it sees set in place, or a copy — and a search for its card lands on its seat", async () => {
    const p = await open();
    // Builders (the plan's p6): one pod, its lead's seat where a search for its card lands, as every shipped team's.
    const seat = p.seat("builders", "buildlead");
    assert.equal(seat.attrs["data-tag"], "buildlead", "where a search for its card lands");
    assert.equal(p.seat("bughunters", "huntlead").attrs["data-tag"], "huntlead", "a pod of its own: on its seat");
    assert.equal(p.seat("builders", "scout").attrs["data-tag"], undefined, "a crew member has its card on the page: a search lands there");
    seat.dispatch("click");
    const card = one(p.table("builders"), "lib-seat-card");
    assert.ok(textOf(card).startsWith("Builders|@buildlead|Here|it leads: plans the work, hands the pieces to its workers, checks what comes back — and can do any of it itself|Runs on|your chat's model|Good for|Builds it with its workers: planned, run in parallel where it can, each claim checked|Thinks|You lead a team that builds"), textOf(card));
    assert.deepEqual(buttonsOf(one(card, "lib-seat-acts")).map(textOf), ["Edit its card", "Make a copy"]);
    /** @type {any} */ (btn(card, "Edit its card")).dispatch("click");
    assert.equal(textOf(one(p.editor(), "zc-dialog-title")), "Edit Builders");
    /** @type {any} */ (btn(p.editor(), "Cancel")).dispatch("click");
    assert.ok(/** @type {any} */ (btn(one(p.table("builders"), "lib-seat-card"), "Edit its card")).focused, "back on its seat's card");
    assert.deepEqual(p.writes(), []);
  });

  // (fails before: yes — phase 7: the leads folded after six; team_v2_plan §10 O5: a lead was made by New agent alone;
  // OA1: an agent in charge of a team stood apart, after those asked for a view)
  test("every agent shown, one in charge of a team where it stood; the Agents' New agent… opens the editor; a card opened stays in sight", async () => {
    const p = await open({ teams: [{ name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words." }] }] });
    const agents = () => p.part("Agents");
    assert.deepEqual(tagsIn(agents()).slice(0, 2), ["product", "enduser"], "Product in charge of Docs stands where it stood");
    assert.deepEqual(chipsOf(p.body, "product"), ["Changes files", "leads Docs", "Sees what it is asked"], "its card says the team it leads");
    /** @type {any} */ (btn(agents(), "New agent…")).dispatch("click");
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "New agent");
    /** @type {any} */ (btn(ed, "Cancel")).dispatch("click");
    assert.ok(/** @type {any} */ (btn(agents(), "New agent…")).focused, "Cancel gives the keys back to it");
    assert.deepEqual(p.writes(), []);
    // (fails before: yes — the owner's of 11-09: a dashed tile among the cards) None of them yours: New agent… ends
    // them, a line under the grid; one of yours, and the head's New agent… takes the keys back from a new agent's editor.
    assert.equal(textOf(one(agents(), "lib-new-row")), "New agent…|None of these is yours yet: make one, or Edit one that ships.");
    assert.equal(buttonsOf(one(agents(), "lib-grid")).filter((b) => textOf(b) === "New agent…").length, 0, "not a tile among the cards");
    const r = await open({ saved: [SECURITY], start: "new" });
    assert.equal(one(r.part("Agents"), "lib-new-row"), undefined);
    /** @type {any} */ (btn(r.editor(), "Cancel")).dispatch("click");
    assert.ok(/** @type {any} */ (btn(one(r.body, "lib-ag-bar"), "New agent…")).focused);
    // A card opened stays in sight, however far down a new card of yours pushes it.
    const q = await open({ saved: [SECURITY] });
    openCard(q.body, "reviewer");
    /** @type {any} */ (btn(openCard(q.body, "product"), "Make a copy")).dispatch("click");
    const copy = q.editor();
    type(field(copy, "Tag"), "pm-two");
    type(field(copy, "How it thinks"), "Another view.");
    /** @type {any} */ (btn(copy, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(tagsIn(q.part("Agents")).slice(0, 3), ["pm-two", "security", "product"], "a copy of Product is yours: first among yours");
    assert.ok(one(cardOf(q.body, "reviewer"), "lib-card-detail"), "the card opened is still open");
  });

  // (fails before: yes — there was no Agents page; phase 7: the face opens the card; U13: what asking it or a job does;
  // OA1: one way to ask any agent, at its level)
  test("a card's face opens it to its whole: how it thinks, what it may do, its model, what it sees, what asking it does, who uses it; Make a copy and Delete are there", async () => {
    const p = await open({ saved: [{ ...SECURITY, model: "grok-4.6", sees: { view: "folded", running: false, changes: "uncommitted" } }, { from: "product", tag: "pm2" }] });
    assert.equal(one(cardOf(p.body, "product"), "tset-detail"), undefined, "closed at first");
    assert.equal(faceOf(p.body, "product").attrs["aria-expanded"], "false");
    assert.equal(btn(cardOf(p.body, "product"), "Make a copy"), undefined, "Make a copy is in its whole");
    faceOf(p.body, "product").dispatch("click");
    const pm = cardOf(p.body, "product");
    assert.equal(faceOf(p.body, "product").attrs["aria-expanded"], "true");
    assert.ok(pm.classList.contains("is-open"), "it spans its row");
    const facts = every(one(pm, "tset-detail"), "aset-fact").map((f) => textOf(f));
    assert.ok(facts[0].startsWith("Thinks|You think as the product's owner and its designer."), facts[0]);
    assert.equal(facts[1], "May do|Edits in its own copy, you apply| — one ask may lower it, never raise it");
    assert.equal(facts[2], `Model|${NO_MODEL}`);
    // (fails before: yes — the owner's words of 10-19: a lead that saw the session gave the main agent's view back)
    assert.equal(facts[3], "Sees|Your question alone");
    assert.equal(facts[4], `Asked|${ASKED_EDIT}`);
    assert.equal(facts.length, 5, "no team has it for a lead or a member, and no start launches it");
    assert.deepEqual(buttonsOf(one(pm, "lib-card-more")).map(textOf), ["Make a copy"], "a shipped card has no Delete");
    // (fails before: yes — step 4) Reviewer's whole: what it may do, that it sees its question alone, what asking it
    // does and who uses it — every team that ships, and three starts ("Teams, improved and kept" of 11-03).
    assert.deepEqual(factsOf(p.body, "reviewer"), [
      `Thinks|${SHIPPED_CARDS.reviewer.thinks}`,
      "May do|Read only: it changes nothing| — one ask may lower it, never raise it",
      `Model|${NO_MODEL}| — a different model family from your agent's gives a more independent view`,
      "Sees|Your question alone",
      `Asked|${ASKED_READ}`,
      "Used by|Builders, BugHunters: each adds its own line · /subagent start=ask · /subagent start=review · /subagent start=catchup",
    ]);
    const builder = factsOf(p.body, "builder");
    assert.deepEqual([builder[0], builder[1], builder.at(-1)], [`Thinks|${SHIPPED_CARDS.builder.thinks}`, "May do|Edits in its own copy, you apply| — one ask may lower it, never raise it", "Used by|Builders: it adds its own line · /subagent start=job"]);
    // Yours: the model it names, what it sees, and what it was copied from.
    const mine = factsOf(p.body, "security");
    assert.equal(mine[2], "Model|Grok 4.6", "named as the model picker names it");
    assert.equal(mine[3], "Sees|This session folded, and the uncommitted change");
    assert.deepEqual(chipsOf(p.body, "security"), ["Reads only", "Sees the chat folded + a patch", "Grok 4.6"]);
    assert.deepEqual(buttonsOf(one(cardOf(p.body, "security"), "lib-card-more")).map(textOf), ["Make a copy", "Delete"]);
    assert.equal(textOf(one(openCard(p.body, "pm2"), "tset-from")), "A copy of Product");
    // Folding it again.
    faceOf(p.body, "product").dispatch("click");
    assert.equal(one(cardOf(p.body, "product"), "tset-detail"), undefined);
  });

  // (fails before: yes — there was no Agents page)
  test("Make a copy: the copy needs a tag of its own, Save says why it waits, and the copy lands among yours", async () => {
    const p = await open();
    /** @type {any} */ (btn(openCard(p.body, "product"), "Make a copy")).dispatch("click");
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "A copy of Product");
    assert.equal(textOf(one(ed, "zc-dialog-desc")), "From Product: it needs a tag of its own. Saving starts nothing.", "its line under the title");
    const save = /** @type {any} */ (btn(ed, "Save"));
    assert.ok("disabled" in save.attrs);
    assert.equal(textOf(one(ed, "tset-why")), "A copy of Product needs a tag of its own: what you will type after @");
    assert.equal(field(ed, "Name").value, "Product", "the copy starts as the card it copies");
    assert.ok(field(ed, "Tag").focused, "the editor opens on the one thing a copy must have");
    type(field(ed, "Tag"), "product");
    assert.equal(textOf(one(ed, "tset-why")), "@product is taken by Product");
    type(field(ed, "Tag"), "9lives");
    assert.equal(textOf(one(ed, "tset-why")), "A tag is 2 to 24 letters, digits and dashes, and starts with a letter");
    type(field(ed, "Tag"), "@Strict-PM");
    assert.equal(textOf(one(ed, "tset-why")), "", "a tag is taken with or without its @, in any case");
    assert.ok(!("disabled" in save.attrs));
    type(field(ed, "How it thinks"), "You say no unless the case is made.");
    save.dispatch("click");
    await settle();
    const [method, path, sent] = p.writes()[0];
    assert.equal(`${method} ${path}`, "POST /agents");
    assert.deepEqual(sent, {
      from: "product", tag: "strict-pm", name: "Product", goodFor: "Is it worth building, its smallest version, and where it lives on the page", thinks: "You say no unless the case is made.",
      may: "edit", models: [], sees: { view: "none", running: false, changes: null }, mayRun: [], toolsOff: [],
    });
    assert.equal(p.editor(), undefined, "back on the page");
    const made = cardOf(p.body, "strict-pm");
    assert.equal(tagsIn(p.part("Agents"))[0], "strict-pm", "yours lead the agents");
    assert.deepEqual(buttonsOf(one(made, "lib-card-bar")).map(textOf), ["Edit"]);
    assert.ok(/** @type {any} */ (btn(made, "Edit")).focused, "focus lands on the agent the save made");
    assert.deepEqual(p.toasts.at(-1), ["Product is saved: start a message with @strict-pm to ask it, or tick “Your agent may use it” for your agent to use it", undefined]);
    assert.equal(p.changed(), 1);
  });

  // (fails before: yes — there was no Agents page)
  test("New agent: a tag, a name, what it is good for and how it thinks; its model and what it sees are the editor's to set", async () => {
    const p = await open({ start: "new" });
    const ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "New agent", "`start: new` opens on a new agent's editor");
    assert.equal(textOf(one(ed, "tset-why")), "An agent needs a tag: what you type after @");
    type(field(ed, "Tag"), "security");
    assert.equal(textOf(one(ed, "tset-why")), "An agent needs a name and what it is good for");
    type(field(ed, "Name"), "Security");
    type(field(ed, "Good for"), "What an attacker would try first");
    // (fails before: yes — U13-D1: a lead needed its paragraph before it could be saved)
    assert.equal(textOf(one(ed, "tset-why")), "", "no paragraph is asked for: with none, Filament's own words frame its view");
    type(field(ed, "How it thinks"), "x".repeat(CARD_LIMITS.thinks + 1));
    assert.ok(one(ed, "tset-count").classList.contains("is-over"), "the count says the paragraph is too long");
    type(field(ed, "How it thinks"), "You read a change as someone who wants to break it.");
    assert.equal(textOf(one(ed, "tset-count")), `51 / ${CARD_LIMITS.thinks.toLocaleString("en-US")}`);
    // The model: the chip's pick; what it sees: the view, the running turn, a change.
    const chip = p.chipIn(p.editor());
    assert.deepEqual(chip.models, [{ id: "glm-5.3" }, { id: "grok-4.6" }]);
    chip.o.onChange("grok-4.6");
    const view = field(ed, "What it sees of the session");
    assert.deepEqual(view.kids.map((/** @type {any} */ k) => k.attrs.value), ["none", "folded", "window"], "every view a card may hold, the live copy apart");
    assert.equal(view.value, "none", "a new advisor starts apart, as the shipped ones do");
    // (fails before: yes — there was no context window) The window holds the running turn: its box asks nothing.
    view.value = "window";
    view.dispatch("change");
    const running = field(ed, "And the turn running now");
    assert.deepEqual([running.checked, running.disabled, running.title], [false, true, "The context window has the turn running now in it"]);
    view.value = "folded";
    view.dispatch("change");
    assert.deepEqual([running.checked, running.disabled], [false, false], "a new agent sees no running turn until you say so");
    const change = field(ed, "And a change, as a patch");
    change.value = "uncommitted";
    change.dispatch("change");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[0], ["POST", "/agents", {
      tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You read a change as someone who wants to break it.",
      may: "read", models: ["grok-4.6"], sees: { view: "folded", running: false, changes: "uncommitted" }, mayRun: [], toolsOff: [],
    }]);
    assert.deepEqual(p.store.find("security")?.sees, { view: "folded", running: false, changes: "uncommitted" });
    // (fails before: yes — the owner's 10-19 list: a card named one model) A second model is its fallback; taken
    // out, none is left: the chat's list.
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const again = p.editor();
    assert.deepEqual(every(again, "tset-model-row").map((r) => textOf(one(r, "tset-model-n"))), ["first", "then"], "its model first, then a row to add one");
    p.chipIn(again).o.onChange("glm-5.3");
    assert.deepEqual(every(again, "tset-model-row").map((r) => r.attrs["data-model"] || "add"), ["grok-4.6", "glm-5.3", "add"]);
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[1], ["PUT", "/agents/security", { models: ["grok-4.6", "glm-5.3"] }]);
    assert.ok(textOf(faceOf(p.body, "security")).endsWith(`${prettyModel("grok-4.6")}, then 1 more`), textOf(faceOf(p.body, "security")));
    assert.ok(factsOf(p.body, "security").some((f) => f.startsWith(`Model|${prettyModel("grok-4.6")}, then ${prettyModel("glm-5.3")}| — the next takes over`)), factsOf(p.body, "security").join("\n"));
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const third = p.editor();
    /** @type {any} */ (buttonsOf(third).find((b) => b.attrs["aria-label"] === `Take ${prettyModel("grok-4.6")} out`)).dispatch("click");
    /** @type {any} */ (buttonsOf(third).find((b) => b.attrs["aria-label"] === `Take ${prettyModel("glm-5.3")} out`)).dispatch("click");
    /** @type {any} */ (btn(third, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[2], ["PUT", "/agents/security", { models: [] }]);
  });

  // (fails before: yes — the owner's word of 11-05: a card's rows named its models alone, and an edit or a copy that sent
  // its models without their efforts left none)
  test("a card's models each say how hard it thinks on them; a model added keeps the others' efforts, and Make a copy keeps them", async () => {
    const p = await open({ saved: [{ ...SECURITY, models: ["grok-4.6", "glm-5.3"], efforts: { "grok-4.6": "high" } }] });
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const ed = p.editor();
    assert.deepEqual(every(ed, "ec").map((c) => [c.attrs["aria-label"], c.querySelector(".ec-words").textContent]), [
      [`How hard it thinks on ${prettyModel("grok-4.6")}`, "High"],
      [`How hard it thinks on ${prettyModel("glm-5.3")}`, "The main agent's"],
    ]);
    p.chipIn(ed).o.onChange("kimi-k2");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1), ["PUT", "/agents/security", { models: ["grok-4.6", "glm-5.3", "kimi-k2"], efforts: { "grok-4.6": "high" } }]);
    assert.deepEqual(p.store.find("security")?.efforts, { "grok-4.6": "high" });
    /** @type {any} */ (btn(openCard(p.body, "security"), "Make a copy")).dispatch("click");
    type(field(p.editor(), "Tag"), "security-two");
    /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
    await settle();
    const [method, path, sent] = p.writes().at(-1) || [];
    assert.deepEqual([method, path, sent.from, sent.efforts], ["POST", "/agents", "security", { "grok-4.6": "high" }]);
    assert.deepEqual(p.store.find("security-two")?.efforts, { "grok-4.6": "high" });
  });

  // (fails before: yes — there was no Agents page)
  test("Edit: the tag stays, only what changed is sent, and Cancel and Escape leave the agent as it was", async () => {
    const p = await open({ saved: [SECURITY] });
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    let ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "Edit Security");
    assert.equal(field(ed, "Tag"), undefined, "an agent's tag does not change: answers already in your chats name it");
    assert.ok(textOf(ed).includes("@security"));
    assert.equal(textOf(one(ed, "tset-why")), "Nothing has changed yet");
    assert.ok(field(ed, "Name").focused);
    type(field(ed, "Good for"), "Where a change could be abused");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes(), [["PUT", "/agents/security", { goodFor: "Where a change could be abused" }]]);
    assert.ok(textOf(cardOf(p.body, "security")).includes("Where a change could be abused"));
    assert.ok(/** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).focused, "focus is back on what opened the editor");
    // Cancel, and Escape in a field, write nothing. Cancel asks nothing; Escape with a change asks before it throws the
    // change away (fails before: yes — the owner's 10-21: the editor was no sheet, and Escape asked nothing).
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Sec");
    /** @type {any} */ (btn(ed, "Cancel")).dispatch("click");
    assert.deepEqual([p.editor(), p.sheets.length], [undefined, 0], "Cancel closes it at once");
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Sec");
    field(ed, "Name").dispatch("keydown", { key: "Escape" });
    await settle();
    assert.deepEqual(p.sheets.at(-1), { title: "Discard the changes?", description: "What you changed here is not saved.", confirmLabel: "Discard", destructive: true });
    assert.equal(p.editor(), undefined, "discarded on the person's word");
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    p.dismiss();
    assert.deepEqual([p.editor(), p.sheets.length], [undefined, 1], "nothing changed: Esc closes it without asking");
    assert.equal(p.writes().length, 1);
    assert.equal(p.store.find("security")?.name, "Security");
    // Ctrl+Enter saves from a field.
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Name"), "Sec");
    field(ed, "Name").dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settle();
    assert.deepEqual(p.writes()[1], ["PUT", "/agents/security", { name: "Sec" }]);
  });

  // (fails before: yes — there was no Agents page)
  test("a refusal is said in the server's words at the editor's foot, and Save can be pressed again", async () => {
    let refuse = true;
    const p = await open({ saved: [SECURITY], refuse: (method) => (refuse && method === "PUT" ? { status: 400, error: "An agent's name is at most 40 characters." } : null) });
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Name"), "Security review");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(textOf(one(ed, "tset-error")), "An agent's name is at most 40 characters.");
    assert.ok(p.editor(), "the editor stays, with what was typed");
    assert.equal(field(ed, "Name").value, "Security review");
    assert.ok(!("disabled" in /** @type {any} */ (btn(ed, "Save")).attrs));
    assert.equal(p.changed(), 0);
    refuse = false;
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(p.store.find("security")?.name, "Security review");
  });

  // (fails before: yes — there was no Agents page)
  test("Delete asks first on the sheet, from the card's whole: a no changes nothing, a yes removes the agent and says its answers stay", async () => {
    const no = await open({ saved: [SECURITY], confirm: false });
    /** @type {any} */ (btn(openCard(no.body, "security"), "Delete")).dispatch("click");
    await settle();
    assert.equal(no.sheets[0].title, "Delete Security (@security)?");
    assert.equal(no.sheets[0].description, "Answers it already gave stay in their chats under its name. This cannot be undone.");
    assert.equal(no.sheets[0].destructive, true);
    assert.deepEqual(no.writes(), []);
    assert.ok(cardOf(no.body, "security"));
    const yes = await open({ saved: [SECURITY] });
    /** @type {any} */ (btn(openCard(yes.body, "security"), "Delete")).dispatch("click");
    await settle();
    assert.deepEqual(yes.writes(), [["DELETE", "/agents/security", undefined]]);
    assert.equal(cardOf(yes.body, "security"), undefined);
    assert.deepEqual(yes.toasts.at(-1), ["Security is deleted", undefined]);
    assert.ok(faceOf(yes.body, "product").focused, "focus goes to the card that stood after it");
    assert.equal(yes.changed(), 1);
    // A shipped agent has no Delete to press, and the server would refuse one.
    assert.equal(btn(openCard(yes.body, "product"), "Delete"), undefined);
  });

  /** A card's tick, in its foot. @param {any} n @param {string} tag */
  const tickOf = (n, tag) => all(footOf(n, tag), (x) => x.tag === "input" && x.attrs?.type === "checkbox")[0];
  /** Tick or untick it as a person does. @param {any} n @param {string} tag @param {boolean} on */
  const tick = async (n, tag, on) => {
    const t = tickOf(n, tag);
    t.checked = on;
    t.dispatch("change");
    await settle();
  };

  // (fails before: yes — HarnessV4_Tasks E15 step 3, AG-44: a card had no tick; U13-D9: it was in the card's whole, as
  // "The main agent may ask it" on a lead and "may call it" on a worker)
  test("each card's foot carries one tick, “Your agent may use it”: a tick writes the list whole, says what it means, and keeps the keys", async () => {
    const p = await open({ saved: [SECURITY], ask: ["product"] });
    assert.deepEqual(["product", "enduser", "security"].map((t) => [tickOf(p.body, t).checked, tickOf(p.body, t).attrs["aria-label"]]), [[true, "Your agent may use Product"], [false, "Your agent may use End user"], [false, "Your agent may use Security"]]);
    assert.equal(tickOf(p.body, "builder"), undefined, "Builder is your agent's in every chat: no tick");
    assert.equal(textOf(one(footOf(p.body, "product"), "lib-tick")), "Your agent may use it", "the same words on every card");
    await tick(p.body, "security", true);
    assert.deepEqual(p.writes(), [["PUT", "/subagents/ask", { tags: ["product", "security"] }]]);
    assert.deepEqual([tickOf(p.body, "security").checked, tickOf(p.body, "security").focused], [true, true], "the list is drawn again, and the keys stay on the tick");
    assert.deepEqual(p.toasts.at(-1), ["Your agent may use Security, in every chat that chose no list of its own", undefined]);
    assert.equal(p.changed(), 1);
    await tick(p.body, "product", false);
    assert.deepEqual(p.writes().at(-1), ["PUT", "/subagents/ask", { tags: ["security"] }]);
    assert.deepEqual(p.toasts.at(-1), ["Your agent no longer uses Product by itself", undefined]);
    assert.deepEqual(["product", "security"].map((t) => tickOf(p.body, t).checked), [false, true]);
  });

  // (fails before: yes — step 3)
  test("a refused tick is said in the server's words and the tick goes back; a tag whose agent is gone is never written; a deleted agent leaves the list", async () => {
    const no = await open({ ask: ["product"], refuse: (method, path) => (method === "PUT" && path === "/subagents/ask" ? { status: 400, error: "the config could not be saved" } : null) });
    await tick(no.body, "enduser", true);
    assert.deepEqual(no.toasts.at(-1), ["the config could not be saved", "err"]);
    assert.deepEqual([tickOf(no.body, "enduser").checked, tickOf(no.body, "product").checked, no.changed()], [false, true, 0], "the page shows the list as it is");
    // A list that names an agent nobody holds any more: a tick writes the list without it.
    const stale = await open({ ask: ["product", "ghost"] });
    await tick(stale.body, "enduser", true);
    assert.deepEqual(stale.writes(), [["PUT", "/subagents/ask", { tags: ["product", "enduser"] }]]);
    // A deleted agent: the answer carries the list after it.
    const del = await open({ saved: [SECURITY], ask: ["security", "product"] });
    /** @type {any} */ (btn(openCard(del.body, "security"), "Delete")).dispatch("click");
    await settle();
    await tick(del.body, "enduser", true);
    assert.deepEqual(del.writes().at(-1), ["PUT", "/subagents/ask", { tags: ["product", "enduser"] }]);
  });

  /** The editor's three levels of "May do". @param {any} ed */
  const levelsOf = (ed) => all(ed, (x) => x.tag === "input" && x.attrs?.type === "radio");

  // (fails before: yes — step 4: an agent was a lead; U13-D1: Kind had two choices, a lead only read and needed its
  // paragraph; OA1: Listed under, Advisors or Doers, and an advisor asked for its view read only)
  test("New agent: no kind and no list to choose; May do has three levels, the only limit, whoever asks it; its words may be left out, and it sees what it is asked until you choose", async () => {
    const p = await open({ start: "new" });
    const ed = p.editor();
    assert.equal(all(ed, (x) => x.tag === "button" && x.attrs?.role === "radio").length, 0, "no Kind");
    assert.deepEqual([one(ed, "aset-place-line"), btn(ed, "move to Doers"), btn(ed, "move to Advisors")], [undefined, undefined, undefined], "no list to choose");
    const levels = one(ed, "aset-levels");
    assert.ok(!("hidden" in levels.attrs));
    assert.deepEqual(every(levels, "aset-check").map(textOf), ["Read only: it changes nothing", "Runs in its own copy, nothing kept", "Edits in its own copy, you apply"]);
    assert.deepEqual(levelsOf(ed).map((r) => [r.attrs.value, r.checked]), [["read", true], ["copy", false], ["edit", false]]);
    assert.ok(every(ed, "ed-part-foot").some((x) => textOf(x) === "Whoever asks it, alone or in a team. One ask may lower it, never raise it."));
    type(field(ed, "Tag"), "translator");
    type(field(ed, "Name"), "Translator");
    type(field(ed, "Good for"), "Puts strings into German");
    assert.equal(textOf(one(ed, "tset-why")), "", "no paragraph is asked for");
    const holds = every(ed, "tset-hint").find((x) => textOf(x) === COPY_HOLDS);
    assert.ok("hidden" in holds.attrs, "what a copy holds is said once a level runs in one");
    assert.deepEqual([field(ed, "What it sees of the session").value, field(ed, "And the turn running now").checked], ["none", false], "untouched, it sees what it is asked (the owner's words of 10-19)");
    const copy = levelsOf(ed)[1];
    copy.checked = true;
    copy.dispatch("change");
    assert.deepEqual(levelsOf(ed).map((r) => r.checked), [false, true, false]);
    assert.ok(!("hidden" in holds.attrs));
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[0], ["POST", "/agents", {
      tag: "translator", name: "Translator", goodFor: "Puts strings into German", thinks: "",
      may: "copy", models: [], sees: { view: "none", running: false, changes: null }, mayRun: [], toolsOff: [],
    }], "no kind is sent");
    assert.deepEqual(p.toasts.at(-1), ["Translator is saved: start a message with @translator to ask it, or tick “Your agent may use it” for your agent to use it", undefined]);
    assert.deepEqual(chipsOf(p.body, "translator"), ["Runs in its own copy", "Sees what it is asked"]);
    assert.equal(tagsIn(p.part("Agents"))[0], "translator", "yours lead the agents");
    await tick(p.body, "translator", true);
    assert.deepEqual(p.toasts.at(-1), ["Your agent may use Translator, in every chat that chose no list of its own", undefined]);
    const facts = factsOf(p.body, "translator");
    assert.deepEqual([facts[0], facts[1], facts[4], facts.length], ["Thinks|No words of its own: it works as the main agent would, on the one task it is given", "May do|Runs in its own copy, nothing kept| — one ask may lower it, never raise it", `Asked|${ASKED("or does the work in its own copy of the project, and nothing it changes there is kept")}`, 5], "nobody uses it yet");
    // Edited, it opens on its level; nothing changed, nothing is sent.
    /** @type {any} */ (btn(cardOf(p.body, "translator"), "Edit")).dispatch("click");
    const again = p.editor();
    assert.deepEqual(levelsOf(again).map((r) => r.checked), [false, true, false], "the editor opens on the card as it is");
    assert.equal(textOf(one(again, "tset-why")), "Nothing has changed yet");
    assert.equal("kind" in /** @type {any} */ (p.store.find("translator")), false);
  });

  // (fails before: yes — HarnessV4_Tasks decision 21, AG-267: what a card runs without asking could be set nowhere)
  test("Runs without asking: an agent in its own copy lists its commands, one a line; one that only reads has none, and the whole card says them", async () => {
    const p = await open({ start: "new" });
    const ed = p.editor();
    const box = one(ed, "aset-runs-box");
    assert.ok("hidden" in box.attrs, "one that only reads runs nothing of its own");
    type(field(ed, "Tag"), "runner");
    type(field(ed, "Name"), "Checker");
    type(field(ed, "Good for"), "Runs the tests");
    const edits = levelsOf(ed)[2];
    edits.checked = true;
    edits.dispatch("change");
    assert.ok(!("hidden" in box.attrs), "one that works in its own copy may");
    assert.equal(textOf(box), `Runs without asking|${RUNS_HINT}`);
    type(field(ed, "Runs without asking"), "  npm test \n\nnode --test test/money.test.js\nnpm test");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[0][2].mayRun, ["npm test", "node --test test/money.test.js"], "trimmed, blank lines dropped, each once");
    const facts = () => factsOf(p.body, "runner");
    assert.equal(facts()[2], "Runs without asking|npm test|node --test test/money.test.js| — in its own copy only", "after what it may do");
    // An edit sends the list only when it changed; lowered to read only, the list goes with the level.
    /** @type {any} */ (btn(cardOf(p.body, "runner"), "Edit")).dispatch("click");
    let again = p.editor();
    assert.equal(field(again, "Runs without asking").value, "npm test\nnode --test test/money.test.js", "the editor opens on the card as it is");
    type(field(again, "Name"), "Checker two");
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1), ["PUT", "/agents/runner", { name: "Checker two" }]);
    /** @type {any} */ (btn(cardOf(p.body, "runner"), "Edit")).dispatch("click");
    again = p.editor();
    type(field(again, "Runs without asking"), "npm test");
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1), ["PUT", "/agents/runner", { mayRun: ["npm test"] }]);
    /** @type {any} */ (btn(cardOf(p.body, "runner"), "Edit")).dispatch("click");
    again = p.editor();
    const reads = levelsOf(again)[0];
    reads.checked = true;
    reads.dispatch("change");
    assert.ok("hidden" in one(again, "aset-runs-box").attrs);
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1), ["PUT", "/agents/runner", { may: "read", mayRun: [] }]);
    assert.equal(facts().some((f) => f.startsWith("Runs without asking|")), false, "one that only reads says no commands");
  });

  // (fails before: yes — AG-267) A refusal of a command comes back in the server's words, and what was typed stays.
  test("a command the server refuses is said at the editor's foot, and the box keeps what was typed", async () => {
    const WHY = "`npm install left-pad` installs packages, and a worker's worktree uses your folder's installed ones: leave it out — what the task needs installed, the developer installs.";
    const p = await open({ saved: [{ tag: "runner", name: "Checker", goodFor: "Runs the tests", may: "edit" }], refuse: (method, _path, body) => (method === "PUT" && body?.mayRun?.some((/** @type {string} */ c) => c.includes("install")) ? { status: 400, error: WHY } : null) });
    /** @type {any} */ (btn(cardOf(p.body, "runner"), "Edit")).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Runs without asking"), "npm test\nnpm install left-pad");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(textOf(one(ed, "tset-error")), WHY);
    assert.equal(field(ed, "Runs without asking").value, "npm test\nnpm install left-pad");
    assert.deepEqual(p.store.find("runner")?.mayRun, []);
  });

  // (fails before: yes — step 4, AG-80: nothing on the page said that Builder and Reviewer are the main agent's in every
  // session, or that your copy of one takes its place)
  test("Builder and Reviewer carry no tick: your agent can always use them; a copy of Reviewer says whose place it takes where it is ticked", async () => {
    const p = await open({ ask: ["product"] });
    for (const tag of ["builder", "reviewer"]) {
      assert.equal(tickOf(p.body, tag), undefined, tag);
      assert.equal(textOf(one(footOf(p.body, tag), "lib-always")), "Your agent can always use it", tag);
    }
    assert.deepEqual(["enduser"].map((t) => [tickOf(p.body, t).checked, tickOf(p.body, t).attrs["aria-label"]]), [[false, "Your agent may use End user"]]);
    await tick(p.body, "enduser", true);
    assert.deepEqual(p.writes(), [["PUT", "/subagents/ask", { tags: ["product", "enduser"] }]], "advisors and doers are one list");
    /** @type {any} */ (btn(openCard(p.body, "reviewer"), "Make a copy")).dispatch("click");
    const ed = p.editor();
    assert.deepEqual([levelsOf(ed).map((r) => r.checked), field(ed, "What it sees of the session").value], [[true, false, false], "none"], "the copy starts as the card it copies");
    type(field(ed, "Tag"), "reviewer-fast");
    type(field(ed, "Name"), "Reviewer, fast");
    p.chipIn(p.editor()).o.onChange("glm-5.3");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes().at(-1), ["POST", "/agents", {
      from: "reviewer", tag: "reviewer-fast", name: "Reviewer, fast", goodFor: SHIPPED_CARDS.reviewer.goodFor, thinks: SHIPPED_CARDS.reviewer.thinks,
      may: "read", models: ["glm-5.3"], sees: { view: "none", running: false, changes: null }, mayRun: [], toolsOff: [],
    }]);
    assert.equal(textOf(one(openCard(p.body, "reviewer-fast"), "aset-place")), "A copy of Reviewer: where your agent may use it, it takes Reviewer's place");
    await tick(p.body, "reviewer-fast", true);
    assert.deepEqual(p.toasts.at(-1), ["Your agent may use Reviewer, fast, in every chat that chose no list of its own: there it takes Reviewer's place", undefined]);
    assert.equal(one(cardOf(p.body, "reviewer-fast"), "tset-from"), undefined, "said once, in its whole");
  });

  // (fails before: yes — step 4, cases 19 and 20: a model that cannot run an agent was found out at the launch alone)
  test("a model is checked as it is picked: why an agent cannot run on it stands under it before Save, the save is taken, and the card says it", async () => {
    const WHY = 'no route matches model "nowhere-9". Add one on the Routes page.';
    const p = await open({ saved: [SECURITY], problems: { "nowhere-9": WHY } });
    assert.equal(one(cardOf(p.body, "security"), "aset-problem"), undefined);
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const ed = p.editor();
    const chip = p.chipIn(p.editor());
    chip.o.onChange("grok-4.6");
    await settle();
    assert.equal(textOf(one(ed, "aset-problem")), "", "a model that runs says nothing");
    chip.o.onChange("nowhere-9");
    await settle();
    assert.deepEqual(p.calls.at(-1), ["GET", "/subagents/model-problem?model=nowhere-9", undefined]);
    assert.equal(textOf(one(ed, "aset-problem")), `An agent cannot run on “${prettyModel("nowhere-9")}” now: ${WHY}| — it can still be saved; its card says this until the model can run one.`);
    assert.ok(!("disabled" in /** @type {any} */ (btn(ed, "Save")).attrs), "it may run tomorrow: the save is not refused");
    /** @type {any} */ (buttonsOf(ed).find((b) => b.attrs["aria-label"] === `Take ${prettyModel("nowhere-9")} out`)).dispatch("click");
    assert.equal(one(ed, "aset-problem"), undefined, "the session's model is checked where it is set");
    p.chipIn(ed).o.onChange("nowhere-9");
    await settle();
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal(textOf(one(cardOf(p.body, "security"), "aset-problem")), `Security cannot run on “${prettyModel("nowhere-9")}” now: ${WHY}`, "on the card, without opening it");
    // Opened again on such a card, the editor says it at once; a model of the list that runs is its fallback: the
    // card says the one it runs on meanwhile, and no longer that it cannot run.
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    await settle();
    assert.ok(textOf(one(p.editor(), "aset-problem")).startsWith("An agent cannot run on"));
    p.chipIn(p.editor()).o.onChange("grok-4.6");
    await settle();
    assert.ok(textOf(one(p.editor(), "aset-problem")).endsWith("— it can still be saved; the next on the list runs meanwhile."), "the next on the list is said");
    /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
    await settle();
    assert.equal(one(cardOf(p.body, "security"), "aset-problem"), undefined);
    assert.equal(textOf(one(cardOf(p.body, "security"), "lib-card-fallback")), `${prettyModel("nowhere-9")} cannot run now (${WHY}): Security runs on ${prettyModel("grok-4.6")} meanwhile`);
    assert.ok(textOf(faceOf(p.body, "security")).endsWith(`${prettyModel("grok-4.6")} for now`));
    // A check that cannot be made says so, and holds nothing up.
    const q = await open({ saved: [SECURITY], refuse: (method, path) => (path.startsWith("/subagents/model-problem") ? { status: 0, error: "Filament is not answering" } : null) });
    /** @type {any} */ (btn(cardOf(q.body, "security"), "Edit")).dispatch("click");
    q.chipIn(q.editor()).o.onChange("grok-4.6");
    await settle();
    assert.equal(textOf(one(q.editor(), "aset-problem")), "Whether an agent can run on “Grok 4.6” could not be checked: Filament is not answering");
    assert.ok(!("disabled" in /** @type {any} */ (btn(q.editor(), "Save")).attrs));
  });

  /** The parts of a shipped agent's editor marked "changed", each by the name its Put back says. @param {any} ed */
  const changedIn = (ed) => every(ed, "ed-mine").filter((s) => !("hidden" in s.attrs)).map((s) => String(buttonsOf(s)[0].attrs["aria-label"]).replace(/^Put back /, ""));
  /** Press a radio or switch as a person does. @param {any} x @param {boolean} on */
  const press = (x, on) => {
    x.checked = on;
    x.dispatch("change");
  };

  // (HarnessV4_ShippedAgents_Plan SA4, fails before: yes — a shipped card's Edit set its models and what it sees alone;
  // the rest was a copy's to change — the owner's 10-23: "i mean everything")
  test("a shipped agent's Edit opens every part of it, its tag fixed: what you change is marked, with Put back; its card says “changed by you”, and Put back as it ships, asked first, gives it back whole", async () => {
    const p = await open();
    /** @type {any} */ (btn(cardOf(p.body, "reviewer"), "Edit")).dispatch("click");
    let ed = p.editor();
    assert.equal(textOf(one(ed, "zc-dialog-title")), "Edit Reviewer");
    assert.equal(textOf(one(ed, "zc-dialog-desc")), "@reviewer ships with Filament: every part of it is yours to change, and Put back gives Filament's again");
    assert.equal(field(ed, "Tag"), undefined, "its tag stays: chats, teams and flows name it");
    assert.deepEqual([field(ed, "Name").value, field(ed, "Good for").value, field(ed, "How it thinks").value], ["Reviewer", SHIPPED_CARDS.reviewer.goodFor, SHIPPED_CARDS.reviewer.thinks]);
    assert.ok(field(ed, "Name").focused);
    assert.deepEqual([changedIn(ed), textOf(one(ed, "tset-why"))], [[], "Nothing has changed yet"], "as it ships, nothing is marked");
    assert.ok("disabled" in /** @type {any} */ (btn(ed, "Put back all")).attrs, "nothing to put back");
    // (case 8) Raised to its own copy while its words still say it changes nothing: the editor asks.
    press(levelsOf(ed)[1], true);
    assert.deepEqual(changedIn(ed), ["May do"]);
    assert.equal(textOf(one(ed, "aset-raised")), "How it thinks was written for an agent that changes nothing: change its words too?");
    type(field(ed, "How it thinks"), `${SHIPPED_CARDS.reviewer.thinks} Run it before you judge it.`);
    assert.ok("hidden" in one(ed, "aset-raised").attrs, "its words changed too: asked no more");
    assert.deepEqual(changedIn(ed), ["How it thinks", "May do"]);
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[0], ["PUT", "/agents/reviewer", { thinks: `${SHIPPED_CARDS.reviewer.thinks} Run it before you judge it.`, may: "copy" }]);
    assert.deepEqual(p.toasts.at(-1), ["Reviewer is saved", undefined]);
    assert.ok(/** @type {any} */ (btn(cardOf(p.body, "reviewer"), "Edit")).focused, "the keys are back on Edit");
    const mark = one(faceOf(p.body, "reviewer"), "lib-mark");
    assert.deepEqual([textOf(mark), mark.attrs.title], ["changed by you", "It ships with Filament; you changed how it thinks and what it may do"]);
    assert.equal(chipsOf(p.body, "reviewer")[0], "Runs in its own copy");
    const facts = factsOf(p.body, "reviewer");
    assert.ok(facts[0].endsWith("| — changed by you"), facts[0]);
    assert.equal(facts[1], "May do|Runs in its own copy, nothing kept| — one ask may lower it, never raise it| — changed by you");
    assert.ok(!facts.some((f) => f.startsWith("Sees|") && f.includes("changed by you")), "what it sees is as it ships");
    assert.deepEqual(buttonsOf(one(cardOf(p.body, "reviewer"), "lib-card-more")).map(textOf), ["Make a copy", "Put back as it ships"], "no Delete: Put back is the way back");
    // (case 9) One part put back in the editor: its mark goes; Save sends it as put back.
    /** @type {any} */ (btn(cardOf(p.body, "reviewer"), "Edit")).dispatch("click");
    ed = p.editor();
    assert.deepEqual(changedIn(ed), ["How it thinks", "May do"]);
    assert.ok(textOf(ed).includes("What you changed of it — how it thinks and what it may do — put back"));
    /** @type {any} */ (buttonsOf(ed).find((b) => b.attrs["aria-label"] === "Put back May do")).dispatch("click");
    assert.deepEqual([levelsOf(ed).map((r) => r.checked), changedIn(ed)], [[true, false, false], ["How it thinks"]]);
    assert.ok(levelsOf(ed)[0].focused, "the keys go to the part put back");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[1], ["PUT", "/agents/reviewer", { may: null }]);
    assert.deepEqual([p.store.find("reviewer")?.may, p.store.find("reviewer")?.set], ["read", ["thinks"]]);
    // (case 10) Put back as it ships, from its whole: asked first, then nothing of it is left yours.
    /** @type {any} */ (btn(openCard(p.body, "reviewer"), "Put back as it ships")).dispatch("click");
    await settle();
    assert.deepEqual(p.sheets.at(-1), { title: "Put back Reviewer as it ships?", description: "What you changed of it goes: how it thinks. This cannot be undone.", confirmLabel: "Put back", destructive: true });
    assert.deepEqual(p.writes()[2], ["PUT", "/agents/reviewer", { reset: true }]);
    assert.deepEqual([p.store.find("reviewer")?.thinks, p.store.find("reviewer")?.set, p.toasts.at(-1)], [SHIPPED_CARDS.reviewer.thinks, [], ["Reviewer is as it ships", undefined]]);
    assert.equal(one(faceOf(p.body, "reviewer"), "lib-mark"), undefined);
    assert.ok(faceOf(p.body, "reviewer").focused, "the keys stay on the card");
    assert.deepEqual(buttonsOf(one(cardOf(p.body, "reviewer"), "lib-card-more")).map(textOf), ["Make a copy"]);
  });

  // (SA2, SA4, fails before: yes — an agent had no tools of its own: what it had was its level's and the chat's)
  test("Its tools: six switches on every agent, each on until switched off; what is off is sent and its card says so; a read-only agent's shell and browser say what its level leaves them", async () => {
    const p = await open({ saved: [SECURITY] });
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const ed = p.editor();
    const names = ["Shell", "The browser", "Web", "Your connectors", "Visuals and artifacts", "The Space"];
    assert.deepEqual(names.map((n) => field(ed, n)?.checked), [true, true, true, true, true, true]);
    const tools = all(ed, (x) => x.tag === "section" && x.attrs?.["aria-label"] === "Its tools")[0];
    const lines = () => every(tools, "ed-row-sub").map(textOf).slice(0, 2);
    assert.deepEqual(lines(), [TOOL_WORDS.shell.read, TOOL_WORDS.browser.read], "it only reads: its shell runs only the commands that read (SA-D10)");
    assert.equal(textOf(one(tools, "ed-part-foot")), "A switch takes a tool away, never gives one: where a chat switches one off, it is off there too. Writing files is its level's — May do. On Claude Code, Codex and Cursor these reach the tools Filament hands them; their own tools follow its level.");
    press(levelsOf(ed)[2], true);
    assert.deepEqual(lines(), [TOOL_WORDS.shell.line, TOOL_WORDS.browser.line]);
    press(levelsOf(ed)[0], true);
    press(field(ed, "Web"), false);
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[0], ["PUT", "/agents/security", { toolsOff: ["web"] }]);
    assert.deepEqual(chipsOf(p.body, "security"), ["Reads only", "Sees what it is asked", "Web off"]);
    assert.ok(factsOf(p.body, "security").includes("Goes without|Web| — switched off on its card"), factsOf(p.body, "security").join("\n"));
    // Two more off: sent in the server's order, and the chip counts them.
    /** @type {any} */ (btn(cardOf(p.body, "security"), "Edit")).dispatch("click");
    const again = p.editor();
    assert.equal(field(again, "Web").checked, false, "the editor opens on the card as it is");
    press(field(again, "The Space"), false);
    press(field(again, "Shell"), false);
    /** @type {any} */ (btn(again, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[1], ["PUT", "/agents/security", { toolsOff: ["shell", "web", "space"] }]);
    assert.equal(chipsOf(p.body, "security").at(-1), "3 tools off");
    assert.deepEqual([toolsOffWords(["shell", "web"]), toolsOffWords([])], ["Shell and Web off", ""]);
    // A shipped agent's tools are set in place too, marked, with Put back.
    /** @type {any} */ (btn(cardOf(p.body, "builder"), "Edit")).dispatch("click");
    const b = p.editor();
    press(field(b, "Your connectors"), false);
    assert.deepEqual(changedIn(b), ["Its tools"]);
    /** @type {any} */ (btn(b, "Save")).dispatch("click");
    await settle();
    assert.deepEqual([p.writes()[2], p.store.find("builder")?.set], [["PUT", "/agents/builder", { toolsOff: ["mcp"] }], ["toolsOff"]]);
  });

  // (SA-D3, fails before: yes — nothing told you that Filament's words for a part you changed had moved since)
  test("Filament's later words for a part you changed: its card and its editor say so, Show gives Filament's words, Take Filament's puts them back; Put back all asks first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-agents-page-"));
    try {
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: {}, shipped: { product: { thinks: "Mine.", name: "Boss", was: { thinks: "000000000000" } } } }));
      const p = await open({ dataDir: dir, confirm: false });
      assert.equal(textOf(one(openCard(p.body, "product"), "lib-card-moved")), "Filament's words for how it thinks changed since you changed it: Edit shows Filament's");
      /** @type {any} */ (btn(cardOf(p.body, "product"), "Edit")).dispatch("click");
      const ed = p.editor();
      assert.deepEqual(changedIn(ed), ["Name", "How it thinks"]);
      const shown = every(ed, "ed-moved").filter((l) => !("hidden" in l.attrs));
      assert.equal(shown.length, 1, "only the part whose shipped words moved: its name was kept without a hash");
      const line = shown[0];
      assert.equal(textOf(one(line, "ed-moved-line")), "Filament's words for this changed since you changed it — |Show| · |Take Filament's");
      const was = one(line, "ed-moved-was");
      assert.ok("hidden" in was.attrs);
      /** @type {any} */ (btn(line, "Show")).dispatch("click");
      assert.deepEqual(["hidden" in was.attrs, textOf(was), !!btn(line, "Hide")], [false, SHIPPED_CARDS.product.thinks, true]);
      // Put back all asks first: a no keeps everything, and the editor stays.
      /** @type {any} */ (btn(ed, "Put back all")).dispatch("click");
      await settle();
      assert.deepEqual(p.sheets.at(-1), { title: "Put back Boss as it ships?", description: "What you changed of it goes: its name and how it thinks. This cannot be undone.", confirmLabel: "Put back", destructive: true });
      assert.deepEqual([p.writes(), !!p.editor()], [[], true]);
      /** @type {any} */ (btn(line, "Take Filament's")).dispatch("click");
      assert.equal(field(ed, "How it thinks").value, SHIPPED_CARDS.product.thinks);
      assert.deepEqual([changedIn(ed), "hidden" in line.attrs], [["Name"], true]);
      /** @type {any} */ (btn(ed, "Save")).dispatch("click");
      await settle();
      assert.deepEqual(p.writes()[0], ["PUT", "/agents/product", { thinks: null }]);
      assert.deepEqual([p.store.find("product")?.set, p.store.find("product")?.moved], [["name"], undefined]);
      assert.equal(one(openCard(p.body, "product"), "lib-card-moved"), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — there was no Agents page)
  test("a list that cannot be read says so, with Try again", async () => {
    const p = await open({ failRead: true });
    assert.equal(textOf(one(p.body, "set-error")), "The agents could not be read: Filament is not answering");
    p.heal();
    /** @type {any} */ (btn(p.body, "Try again")).dispatch("click");
    await settle();
    assert.ok(cardOf(p.body, "product"));
  });

  // (fails before: yes — Settings had no Agents section; phase 7: it was the page itself; the owner's word of 10-23
  // took its link and Abilities' off Settings' list: the left bar's Library holds them; the owner's word of 10-26 took
  // MCP servers too, Library › Plugins & Connectors now)
  test("Settings lists neither Agents and teams, Skills nor MCP servers — the Library holds them, and the search still finds them; Teams is no entry of its own", () => {
    const ids = SECTIONS.map((s) => s.id);
    assert.equal(ids.includes("saved-agents"), false);
    assert.equal(ids.includes("skills"), false);
    assert.equal(ids.includes("mcp-servers"), false);
    assert.deepEqual(LIBRARY_HITS.map((s) => [s.id, s.group, s.label]), [["saved-agents", "Library", "Agents and teams"], ["skills", "Library", "Skills"], ["mcp-servers", "Library", "Connectors"]]);
    assert.deepEqual(LIBRARY_HITS.map((s) => libraryOf(s.id)?.page), ["agents", "skills", "connectors"], "a result opens the Library there");
    const page = readFileSync("src/ui/harness/settings/page.js", "utf8");
    assert.match(page, /sections: \[\.\.\.SECTIONS, \.\.\.libraryHits\(state\.config\)\],/);
    // While Settings › Experimental's Teams switch is off the search finds the page as Agents.
    assert.deepEqual([libraryHits({}), libraryHits({ experimental: { teams: true } })].map((x) => x[0].label), ["Agents", "Agents and teams"]);
    assert.doesNotMatch(page, /is-library|settings-item-go|drawMoved/);
    assert.equal(SECTIONS[ids.indexOf("agents")].label, "Coding agents");
    // (fails before: yes — step 6: Teams stood beside Agents, a second place for who works on a session)
    assert.equal(ids.includes("teams"), false);
    assert.equal(SECTIONS.some((s) => s.label === "Teams"), false);
  });

  // (fails before: yes — phase 7: a worker was made by New agent and then Kind; U13-D4: by New worker…; OA1: by the
  // Doers' own New agent…)
  test("the Agents' New agent… opens the editor; an agent saved stands first among the agents, with no kind", async () => {
    const p = await open();
    /** @type {any} */ (btn(p.part("Agents"), "New agent…")).dispatch("click");
    const ed = p.editor();
    type(field(ed, "Tag"), "linter");
    type(field(ed, "Name"), "Linter");
    type(field(ed, "Good for"), "Runs the linter and says what it found");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.equal("kind" in p.writes()[0][2], false);
    assert.deepEqual(tagsIn(p.part("Agents")).slice(0, 3), ["linter", "product", "enduser"]);
  });
});


describe("Builders (the design pass of 10-24, UX6; the plan's p6)", () => {
  // (fails before: yes — the Library and the menus drew the four teams that build as four teams; the plan's p6: they
  // are one team, Builders)
  test("the team that builds is Builders where it ships; the crew wear their seats' glyphs", () => {
    assert.equal(BUILD_TEAM, "builders");
    assert.ok(Object.hasOwn(SHIPPED_TEAMS, BUILD_TEAM), "it ships");
    assert.deepEqual([isBuildTeam({ key: "builders", shipped: true }), isBuildTeam({ key: "builders", shipped: false }), isBuildTeam({ key: "methodical", shipped: true }), isBuildTeam({ key: "bughunters", shipped: true }), isBuildTeam(null)], [true, false, false, false, false]);
    assert.deepEqual([cardIcon({ tag: "buildlead" }), cardTone({ tag: "buildlead" }), cardIcon({ tag: "tenx" }), cardTone({ tag: "architect" })], ["wrench", "orange", "bot", "blue"], "its Lead's look; a gone Lead's tag wears an agent's");
    // The Crew wear their cards' glyphs: every seat — a Scout, a Hunter, a Checker — sits on Reviewer or Builder
    // ("Teams, improved and kept" of 11-03).
    assert.deepEqual([cardIcon({ tag: "reviewer" }), cardIcon({ tag: "builder" }), cardTone({ tag: "reviewer" }), cardTone({ tag: "builder" })], ["eye", "hammer", "indigo", "orange"]);
  });

  // (fails before: yes — the left bar said 26: each shipped team's own Lead counted twice, as a card and in its team)
  test("the left bar's count: each agent once and each team once", () => {
    const shipped = Object.keys(SHIPPED_CARDS).map((tag) => shippedCard(tag));
    const teams = Object.keys(SHIPPED_TEAMS).map((key) => ({ key }));
    // (the plan's p6) Two teams ship, each with its own Lead: Builders, BugHunters.
    assert.equal(shipped.length + teams.length, 8, "what it counted");
    assert.equal(agentsCount({ shipped, saved: [] }, { shipped: teams, saved: [] }), 6);
    assert.equal(agentsCount({ shipped, saved: [SECURITY] }, { shipped: teams, saved: [{ key: "docs" }] }), 8, "yours too");
    assert.deepEqual([agentsCount({ shipped, saved: [] }, null), agentsCount(null, { shipped: teams })], [4, null], "the teams unread: the agents alone; the agents unread: no count");
  });

  // (case 6) A shipped card you changed stays where it stood, marked, its Put back in its whole.
  test("a shipped card you changed stands where it stood, its card marked", async () => {
    const p = await open();
    /** @type {any} */ (btn(cardOf(p.body, "reviewer"), "Edit")).dispatch("click");
    type(field(p.editor(), "Name"), "Doubter");
    /** @type {any} */ (btn(p.editor(), "Save")).dispatch("click");
    await settle();
    const agents = p.part("Agents");
    assert.deepEqual(tagsIn(agents).slice(0, 4), ["product", "enduser", "builder", "reviewer"]);
    assert.equal(textOf(faceOf(agents, "reviewer")).split("|").slice(0, 3).join("|"), "Doubter|@reviewer|changed by you");
    assert.ok(btn(openCard(p.body, "reviewer"), "Put back as it ships"));
  });
});

describe("a saved agent's words on the page", () => {
  // (fails before: yes — the page had no words for what a card sees)
  test("what a card sees, in a line", () => {
    assert.equal(seesWords({ view: "folded", running: true, changes: null }), "This session folded, and the turn running now");
    assert.equal(seesWords({ view: "none", running: false, changes: null }), "Your question alone");
    assert.equal(seesWords({ view: "none", running: true, changes: "turn" }), "Your question alone, and the turn running now and the last turn's change");
    assert.equal(seesWords({ view: "window", running: true, changes: "uncommitted" }), "The main agent's context window, the turn running now in it, and the uncommitted change");
    assert.equal(seesWords({ view: "folded", running: false, changes: null }), "This session folded");
    assert.equal(seesWords(null), "Your question alone");
    assert.equal(seesWords({ view: "moderate", running: false, changes: null }), "Your question alone", "a view no longer offered reads as none");
  });

  // (fails before: yes — step 4, case 15: a card did not say who uses it)
  test("who uses a card, in a line: its teams, which of them add a line of their own, and the starts that launch it", () => {
    const teams = (/** @type {boolean[]} */ ...words) => words.map((w, i) => ({ name: ["Methodical", "Architect", "One-Shot"][i], words: w }));
    assert.equal(usedByWords({ teams: teams(true, true, true), starts: [] }), "Methodical, Architect, One-Shot: each adds its own line");
    assert.equal(usedByWords({ teams: teams(true, false, true), starts: [] }), "Methodical, Architect, One-Shot: Methodical and One-Shot add their own line");
    assert.equal(usedByWords({ teams: teams(false, true), starts: [] }), "Methodical, Architect: Architect adds its own line");
    assert.equal(usedByWords({ teams: teams(false, false), starts: [{ id: "review" }] }), "Methodical, Architect · /subagent start=review");
    assert.equal(usedByWords({ teams: teams(true), starts: [] }), "Methodical: it adds its own line");
    assert.deepEqual([usedByWords({ teams: [], starts: [] }), usedByWords(null), usedByWords(undefined)], ["", "", ""]);
    // (fails before: yes — step 6: a card that leads a team read as a member of it)
    const lead = (/** @type {string} */ name) => ({ key: name.toLowerCase(), name, as: "lead", words: false });
    assert.equal(usedByWords({ teams: [lead("Docs")], starts: [] }), "leads the Docs team");
    assert.equal(usedByWords({ teams: [lead("Docs"), lead("Ops"), ...teams(true)], starts: [{ id: "ask" }] }), "leads the Docs and Ops teams · Methodical: it adds its own line · /subagent start=ask");
  });

  // (fails before: yes — a draft was never read for whom it is for)
  test("the tags a draft starts with, and whom it is for", () => {
    assert.deepEqual(leadingTags("@pm should a fifth launch queue or fail?"), { words: ["pm"], question: "should a fifth launch queue or fail?" });
    assert.deepEqual(leadingTags("  @PM @designer, @enduser: is the card clear?"), { words: ["PM", "designer", "enduser"], question: "is the card clear?" });
    assert.deepEqual(leadingTags("@pm @pm twice"), { words: ["pm"], question: "twice" }, "each once");
    assert.deepEqual(leadingTags("@pm"), { words: ["pm"], question: "" });
    assert.deepEqual(leadingTags("ask @pm about it"), { words: [], question: "ask @pm about it" }, "a tag later in a message is the message's own text");
    assert.deepEqual(leadingTags("@src/app.js is slow"), { words: [], question: "@src/app.js is slow" }, "a path has a slash");
    assert.deepEqual(leadingTags("@package.json has a typo"), { words: [], question: "@package.json has a typo" }, "a file's name has a dot");
    assert.deepEqual(leadingTags("@pm\nsecond line"), { words: ["pm"], question: "second line" });
    const cards = /** @type {any[]} */ ([{ tag: "pm", name: "PM" }, { tag: "designer", name: "Designer" }]);
    assert.deepEqual(addressed("@pm @Designer go", cards).to.map((c) => c.name), ["PM", "Designer"]);
    assert.deepEqual(addressed("@pm @Designer go", cards).question, "go");
    // One word that names no agent, and the message is not the agents': the page asks before it goes anywhere.
    assert.deepEqual(addressed("@pm @pn go", cards), { to: [], unknown: ["pn"], question: "go", changes: null });
    assert.deepEqual(addressed("@Makefile is broken", cards), { to: [], unknown: ["Makefile"], question: "is broken", changes: null });
    assert.deepEqual(addressed("plain words", cards), { to: [], unknown: [], question: "plain words", changes: null });
    // (fails before: yes — step 4, AG-81: a range was the question's own words)
    assert.deepEqual(addressed("@pm since:v1.2 what broke?", cards), { to: [cards[0]], unknown: [], question: "what broke?", changes: "since:v1.2" });
    assert.deepEqual(addressed("@pn since:v1.2 what broke?", cards), { to: [], unknown: ["pn"], question: "since:v1.2 what broke?", changes: null }, "a draft that is not the agents' keeps its words");
    assert.equal(listed(["PM"]), "PM");
    assert.equal(listed(["PM", "Designer"]), "PM and Designer");
    assert.equal(listed(["PM", "Designer", "End user"]), "PM, Designer and End user");
  });
});

// (fails before: yes — the review of 11-03: a card of yours under a tag a card that ships took was shown nowhere, and
// the next save of any card took it out of agents.json)
describe("your agents that cannot be used now", () => {
  const keptPart = (/** @type {any} */ p) => all(p.body, (x) => x.attrs?.["aria-label"] === "Your agents that cannot be used now")[0];
  test("each with why; Make a copy opens the editor on what it holds under a tag of its own; Delete asks first and leaves the card that ships", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-agents-kept-"));
    try {
      const mine = { name: "My product", goodFor: "Says what to build first", thinks: "You weigh it.", may: "read" };
      writeFileSync(join(dir, AGENT_CARDS_FILE), JSON.stringify({ version: 1, agents: { product: mine } }));
      const p = await open({ dataDir: dir });
      assert.deepEqual(every(keptPart(p), "lib-held-row").map((r) => textOf(r)), ["My product (@product)|Product ships under `@product` now: make your card again under another tag|Make a copy|Delete"]);
      /** @type {any} */ (btn(keptPart(p), "Make a copy")).dispatch("click");
      const ed = p.editor();
      assert.deepEqual([field(ed, "Tag").value, field(ed, "Name").value, field(ed, "Good for").value, field(ed, "How it thinks").value], ["", "My product", "Says what to build first", "You weigh it."]);
      type(field(ed, "Tag"), "my-product");
      /** @type {any} */ (btn(ed, "Save")).dispatch("click");
      await settle();
      const [method, path, sent] = p.writes()[0];
      assert.deepEqual([method, path, sent.tag, sent.name, "from" in sent], ["POST", "/agents", "my-product", "My product", false], "made from what it holds, never a copy of the card that ships");
      assert.ok(cardOf(p.body, "my-product"), "among your agents");
      /** @type {any} */ (btn(keptPart(p), "Delete")).dispatch("click");
      await settle();
      assert.equal(p.sheets.at(-1)?.title, "Delete My product (@product)?");
      assert.deepEqual(p.writes().at(-1), ["DELETE", "/agents/product", undefined]);
      assert.equal(keptPart(p), undefined);
      assert.deepEqual([p.store.find("product")?.shipped, JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8")).agents.product], [true, undefined]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
