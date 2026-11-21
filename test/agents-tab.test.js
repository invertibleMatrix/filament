// @ts-check
// The Agents tab (HarnessV4_Tasks U13-D5, W2): the Sub Agents and Team tabs as one — the team in charge of the chat on
// top with its crew under it, each team on the side as a row by what it needs of you, the Teams row at the list's foot,
// a team's row opening its pane (its board or card alone), and one badge for everyone working for the chat.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryBrain } from "../src/memory-brain.js";
import { SIDE_ROWS_MOST, sideChatsUnder } from "../src/ui/harness/lib/labels.js";
import { localDay } from "../src/services/daily-usage.js";
import { TEAM_CHARGE, TEAM_HOME, agentsBadge, isTeamItem, mineAtWork, selfTeamItem, sideGroups, sideTeamItem, teamItems, withTeams } from "../src/ui/harness/lib/side.js";
import { leadingTeam } from "../src/ui/harness/lib/team.js";
import { createSideView, LIST_LINE, NO_THREADS } from "../src/ui/harness/views/side.js";
import { createBesideView } from "../src/ui/harness/views/beside.js";
import { createViews } from "../src/ui/harness/views/host.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { agentRow, menuRows, NOW, sideIO, sideSeams } from "./helpers/side-view.js";
import { modelSelects, teamIO } from "./helpers/team-view.js";
import "./helpers/teams-on-page.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => byClass(n, cls)[0];
/** The list's rows in order: each one's id, or a part's title. @param {any} el */
const listOf = (el) => all(one(el, "sd-groups"), (x) => !!x.attrs?.["data-id"] || String(x.attrs?.class || "").includes("sd-group ")).map((x) => x.attrs["data-id"] || `# ${textOf(one(x, "sd-group-title"))} ${textOf(one(x, "sd-group-n"))}`);

/** Builders as a session's settings name it, in charge. */
const ENGINE = { mode: "team", team: "builders", teams: [{ key: "builders", name: "Builders", lead: { tag: "buildlead", name: "Builders" }, members: [{ tag: "builder", name: "Builder", may: "edit" }, { tag: "reviewer", name: "Reviewer", may: "read" }] }] };
/** A worker of the team in charge: at work, or asking you when `asking` is set. @param {string} id @param {Record<string, any>} [over] */
const crewRow = (id, over = {}) => agentRow(id, { card: { tag: "builder", name: "Builder", kind: "worker" }, may: "edit", status: "running", startedAt: NOW - 60_000, team: { key: "builders", team: "builders", role: "builder" }, exchanges: [{ description: `Task ${id}`, startedAt: NOW - 60_000, endedAt: null }], ...over });
/** A team on the side of this chat, as its store lists it (lib/beside.js). @param {Record<string, any>} [o] @returns {any} */
const besideRow = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the parser", firedBy: "you", at: NOW - 5 * 60_000, model: "m-1", title: "",
  state: "working", workers: { running: 2, waiting: 1, total: 3 }, verify: false, notify: false, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});
/** A Hunter on a side team's board. @param {string} id @param {Record<string, any>} [over] */
const hunter = (id, over = {}) => agentRow(id, { card: { tag: "hunter", name: "Hunter", kind: "worker" }, status: "running", team: { key: "bug-hunter", role: "hunter" }, exchanges: [{ description: `Hunt ${id}`, startedAt: NOW - 60_000, endedAt: null }], ...over });
/** The teams' facts as the host gathers them. @param {Record<string, any>} [o] @returns {any} */
const facts = (o = {}) => ({ leading: null, live: false, paused: false, rows: [], beside: [], self: null, boards: () => [], now: NOW, ...o });

describe("the Agents tab's teams as rows", () => {
  // (fails before: yes — U13-D5: the team in charge was the Teams tab's alone; the Sub Agents tab listed its workers
  // among your agents with no word of whose they were)
  test("the team in charge: its lead and members in a line, its state, and its crew under it — the agents it stands for leave the list", () => {
    const leading = leadingTeam(ENGINE);
    const rows = [crewRow("w1"), crewRow("w2", { progress: { asking: { kind: "question", question: "Which file?" } } }), agentRow("a1", { status: "running" })];
    const [t] = teamItems(facts({ leading, live: true, rows }));
    assert.deepEqual([t.id, t.way, t.group, t.tag, t.name, t.task, t.fact, t.tone], [TEAM_CHARGE, "charge", "lead", "in charge", "Builders", "Builders answers your messages; Builder, Reviewer under it", "waits for your answer", "asks"],
      "a worker of its asks you: the team waits on your answer");
    assert.deepEqual(t.crew.map((c) => [c.id, c.name, c.fact, c.tone, c.thread]), [["w2", "Builder 2", "asks you", "asks", true], ["w1", "Builder 1", "thinking", "works", true]],
      "the one asking first; each a thread of this chat's");
    assert.deepEqual(t.crewIds, ["w1", "w2"]);
    const [quiet] = teamItems(facts({ leading, rows: [] }));
    assert.deepEqual([quiet.fact, quiet.tone, quiet.crew], ["ready for your next message", "ok", []]);
    const [working] = teamItems(facts({ leading, live: true }));
    assert.deepEqual([working.fact, working.tone], ["working", "works"]);
    const [cannot] = teamItems(facts({ leading: leadingTeam({ ...ENGINE, problem: "its lead's model is signed out" }) }));
    assert.deepEqual([cannot.task, cannot.tone], ["It cannot lead now: its lead's model is signed out", "warn"]);
    const groups = withTeams(sideGroups(rows, []), teamItems(facts({ leading, live: true, rows })), (r) => String(r.id));
    assert.deepEqual(groups.map((g) => [g.id, g.title, g.items.map((x) => x.id), g.rows.map((r) => r.id)]), [["lead", "In charge of this chat", [TEAM_CHARGE], []], ["works", "Working", [], ["a1"]]],
      "its crew is under its row, not a second time in Needs you or Working");
  });

  // (fails before: yes — U13-D5: a team on the side was a card under the Team tab, out of the list of who works for the chat)
  test("a team on the side: a row in the part its state puts it, what it was asked, how it is in a few words; its crew only while it works", () => {
    const boards = (/** @type {string} */ tid) => (tid === "t1" ? [hunter("h1"), hunter("h2")] : []);
    const words = (/** @type {any} */ r) => { const [x] = teamItems(facts({ beside: [r], boards })); return [x.id, x.group, x.tag, x.task, x.fact, x.tone, x.crew.length]; };
    assert.deepEqual(words(besideRow()), [sideTeamItem("t1"), "works", "on the side", "find bugs in the parser", "2 at work · 1 waits for a slot", "works", 2]);
    assert.deepEqual(words(besideRow({ workers: { running: 0, waiting: 0, total: 0 } }))[4], "its lead works on it");
    assert.deepEqual(words(besideRow({ state: "asking" })).slice(1, 6), ["needs", "on the side", "find bugs in the parser", "its lead asks you", "asks"]);
    const done = { state: "done", workers: { running: 0, waiting: 0, total: 3 }, result: { n: 1, text: "Found: parse.js:3", more: false, at: NOW } };
    assert.deepEqual(words(besideRow({ ...done, findings: { counts: { found: 5, plausible: 2 } } })).slice(1, 7), ["done", "on the side", "find bugs in the parser", "5 found · 2 more unsure · waits for you", "ok", 0],
      "an ended team has no crew lines: its card says what it found");
    assert.equal(words(besideRow({ ...done, notified: { n: 1, at: NOW, how: "sent" } }))[4], "its result is in · sent to your agent");
    assert.deepEqual(words(besideRow({ state: "stopped", cut: true })).slice(4, 6), ["stopped when Filament did: Resume… goes on", "warn"]);
    assert.equal(words(besideRow({ state: "stopped" }))[4], "stopped before it finished");
    const [x] = teamItems(facts({ beside: [besideRow()], boards }));
    assert.deepEqual(x.crew.map((c) => [c.name, c.thread]), [["Hunter 1", false], ["Hunter 2", false]], "a crew line of a team on the side opens its team's board");
    assert.deepEqual(x.crewIds, [], "its agents are no rows of this chat's list");
  });

  // (fails before: yes — U13-D5: a team's own chat said nothing of itself in its agents' tab)
  test("in a team's own chat, that team alone, its workers under it", () => {
    const rows = [hunter("h1"), agentRow("a1")];
    const items = teamItems(facts({ self: besideRow({ state: "asking" }), beside: [besideRow({ id: "t2" })], rows, leading: leadingTeam(ENGINE) }));
    assert.deepEqual(items.map((x) => [x.id, x.way, x.tag, x.group, x.crewIds]), [[selfTeamItem("t1"), "self", "this team", "needs", ["h1"]]]);
    assert.equal(isTeamItem(items[0].id) && isTeamItem(TEAM_HOME) && !isTeamItem("a1"), true);
  });

  // (fails before: yes — U13-D5: two tabs, two badges: the Sub Agents tab's count of your agents, the Team tab's of its crew)
  test("one badge: your agents at work, a team's crew or its lead, the teams on the side — orange while any asks you; else the answers not yet opened", () => {
    const none = { works: 0, asks: 0 };
    assert.equal(agentsBadge(null, null, [], none), null);
    assert.deepEqual(agentsBadge({ text: "2", dot: "works", words: "2 new answers" }, null, [], none), { text: "2", dot: "works", words: "2 new answers" }, "nobody at work: the answers you have not opened");
    assert.deepEqual(agentsBadge(null, null, [], { works: 2, asks: 1 }), { text: "2", dot: "asks", words: "an agent asks you · 1 working" });
    assert.deepEqual(agentsBadge(null, { text: "3", dot: "works", words: "3 at work" }, [besideRow(), besideRow({ id: "t2", state: "asking" }), besideRow({ id: "t3", state: "done" })], { works: 1, asks: 0 }),
      { text: "6", dot: "asks", words: "1 working · 3 at work · 1 team on the side at work · 1 on the side asks you" });
    assert.deepEqual(agentsBadge(null, { dot: "works", words: "the lead works" }, [], none), { text: "1", dot: "works", words: "the lead works" }, "a lead at work with no crew counts one");
    const asking = { progress: { asking: { kind: "question", question: "Which?" } } };
    assert.deepEqual(mineAtWork([
      agentRow("a1", { status: "running" }),
      agentRow("a2", { status: "running", origin: "agent" }),
      agentRow("a3", { status: "running", origin: "self" }),
      agentRow("a4", { status: "running", origin: "self", ...asking }),
      agentRow("a5", { status: "running", ...asking }),
      crewRow("w1"),
      agentRow("a6"),
    ]), { works: 3, asks: 2 }, "yours at work, and one that started by itself only while it asks you; none of your agent's own, nor a team's crew");
  });
});

/** A fake teams part as the host hands the Agents tab: its rows, its pane, whether the Teams row shows. @param {() => any[]} items */
function teamsPart(items) {
  /** @type {any[][]} */
  const calls = [];
  const el = fakeH("div", { class: "tv-fake" }, "the team's pane");
  return { calls, part: { el, items, paint: (/** @type {any} */ c, /** @type {string} */ id) => { calls.push(["paint", c.id, id]); }, home: () => true } };
}

describe("the Agents tab: the list and the pane", () => {
  /** @param {Record<string, any>} [over] */
  function viewOf(over = {}) {
    const t = teamsPart(over.items || (() => []));
    const io = sideIO({ teams: t.part, onPane: (/** @type {string} */ id) => { t.calls.push(["pane", id]); }, ...over });
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    return { io, view, chat, t, ...s, el: view.el };
  }

  // (fails before: yes — U13-D5: the list had no head, no team in it, and nothing led to the teams)
  test("the list's head says who it is; nobody yet, Start… and the Teams row", () => {
    const { view, chat, el } = viewOf();
    view.paint(chat);
    assert.deepEqual([textOf(one(el, "sd-list-title")), textOf(one(el, "sd-list-line"))], ["Everyone working for this chat", LIST_LINE]);
    assert.equal(LIST_LINE, "The agents you or your agent asked, the teams in charge or on the side, and those on their own.");
    assert.deepEqual([textOf(one(el, "sd-none")), listOf(el)], [NO_THREADS, [TEAM_HOME]]);
    assert.equal(textOf(one(el, "sd-teams-row")), "Teams|Put one in charge of this chat, or send one on the side");
  });

  // (fails before: yes — U13-D5; the order in its part: the owner's 10-24, a team on the side stood at its head)
  test("the team in charge on top, its crew a line each; a team on the side among your agents by when it began; the Teams row last", () => {
    const leading = leadingTeam(ENGINE);
    const rows = [crewRow("w1"), agentRow("a1", { status: "running" }), agentRow("a2")];
    const items = () => teamItems(facts({ leading, live: true, rows, beside: [besideRow()], boards: () => [hunter("h1")] }));
    const { view, chat, el, t, threads } = viewOf({ rows: () => rows, items });
    view.paint(chat);
    assert.deepEqual(listOf(el), ["# In charge of this chat 1", TEAM_CHARGE, "w1", "# Working 2", "a1", sideTeamItem("t1"), "h1", "# Done 1", "a2", TEAM_HOME],
      "a1 began a minute ago, the team five: a1 first");
    const charge = one(el, "sd-team-row");
    assert.deepEqual([charge.attrs.class, textOf(one(charge, "sd-row-tag")), one(charge, "sd-row-tag").attrs.class, textOf(one(charge, "sd-row-task")), textOf(one(charge, "sd-row-fact-words"))],
      ["sd-row sd-team-row is-charge", "in charge", "sd-row-tag is-charge", "Builders answers your messages; Builder, Reviewer under it", "working"]);
    assert.equal(one(charge, "sd-av").attrs.class, "sd-av is-team t-orange", "its lead's face in its team's colour");
    const crew = byClass(el, "sd-crew-row");
    assert.deepEqual(crew.map((c) => [c.attrs["data-id"], textOf(one(c, "sd-crew-name")), c.attrs.title]), [["w1", "Builder 1", "Builder 1: its thread"], ["h1", "Hunter 1", "Hunter 1: its team's board"]]);
    // Its row opens its pane: the host's team part, mounted once and painted on that row.
    charge.dispatch("click");
    assert.deepEqual(t.calls.filter((c) => c[0] === "paint"), [["paint", "chat-1", TEAM_CHARGE]]);
    assert.deepEqual([one(el, "sd-team").kids[0], one(el, "sd-team").classList.contains("hidden"), t.calls.filter((c) => c[0] === "pane").at(-1)], [t.part.el, false, ["pane", TEAM_CHARGE]]);
    assert.equal(textOf(one(el, "sd-threads-words")), "Builders", "the narrow bar names the open row");
    // A side team's Hunter opens its team's pane; the team in charge's Builder its own thread.
    byClass(el, "sd-crew-row")[1].dispatch("click");
    assert.deepEqual(t.calls.filter((c) => c[0] === "paint").at(-1), ["paint", "chat-1", sideTeamItem("t1")]);
    byClass(el, "sd-crew-row")[0].dispatch("click");
    assert.deepEqual([one(el, "sd-team").classList.contains("hidden"), threads.at(-1)?.o.id, t.calls.filter((c) => c[0] === "pane").at(-1)], [true, "w1", ["pane", "w1"]]);
    one(el, "sd-teams-row").dispatch("click");
    assert.deepEqual(t.calls.filter((c) => c[0] === "paint").at(-1), ["paint", "chat-1", TEAM_HOME]);
    assert.equal(t.calls.filter((c) => c[0] === "paint").length, 3, "painted once a press, not on each pulse");
  });

  // (fails before: yes — the owner's 10-24: "the sorting order of the agents … is not right, i ran an agent few hours
  // ago … hard to find even though that was the last agent i ran": nine older teams stood at the head of Done, and
  // only the agents folded under Earlier, so the newest agent was the tenth row)
  test("Done is newest first, agents, teams and flows together; Earlier folds the oldest of them, teams too", () => {
    const H = 3_600_000;
    const done = { state: "done", workers: { running: 0, waiting: 0, total: 3 }, result: { n: 1, text: "Found it.", more: false, at: NOW } };
    const beside = Array.from({ length: 9 }, (_, i) => besideRow({ id: `t${i + 1}`, ...done, at: NOW - (6 + i) * H }));
    const ran = (/** @type {number} */ ago) => [{ description: "asked", startedAt: NOW - ago, endedAt: NOW - ago + 60_000, spentUsd: 0.02, delivery: "held" }];
    const rows = [agentRow("old", { startedAt: NOW - 30 * H, exchanges: ran(30 * H) }), agentRow("designer", { startedAt: NOW - 3 * H, exchanges: ran(3 * H) }), agentRow("asked-again", { startedAt: NOW - 40 * H, exchanges: [...ran(40 * H), ...ran(6.5 * H)] })];
    const items = () => teamItems(facts({ beside, rows }));
    const { view, chat, el, menus } = viewOf({ rows: () => rows, items });
    view.paint(chat);
    const side = (/** @type {number[]} */ ...n) => n.map((i) => sideTeamItem(`t${i}`));
    assert.deepEqual(listOf(el), ["# Done 12", "designer", ...side(1), "asked-again", ...side(2, 3, 4), TEAM_HOME],
      "the agent run last on top; one asked again by its newest question; six shown, the oldest six — teams and an agent — under Earlier");
    assert.equal(textOf(one(el, "sd-earlier")), "Earlier · 6");
    one(el, "sd-earlier").dispatch("click");
    assert.deepEqual(listOf(el).slice(7), [...side(5, 6, 7, 8, 9), "old", TEAM_HOME]);
    one(el, "sd-threads").dispatch("click");
    assert.deepEqual(menuRows(menus.at(-1)).slice(1, 4).map((r) => r[1]), ["Done", "Builder: asked", "Bug Hunter: find bugs in the parser"], "narrow, the bar's menu in the same order");
    // The groups' order alone, with a flow: by when it started, else when it was drawn.
    const groups = withTeams(sideGroups(rows, []), [{ ...teamItems(facts({ beside: [beside[0]] }))[0] }, { id: "team:flow:f1", way: "flow", group: "done", key: "", name: "Flow", tag: "flow", task: "a flow", fact: "", tone: "ok", at: NOW - 2 * H, crew: [], crewIds: [] }], (r) => String(r.id));
    assert.deepEqual(groups[0].entries.map((e) => ("item" in e ? e.item.id : e.row.id)), ["team:flow:f1", "designer", sideTeamItem("t1"), "asked-again", "old"]);
  });

  // (fails before: yes — U13-D5: the narrow bar's menu listed your agents alone)
  test("narrow, the bar's menu lists the teams' rows with your agents, and the Teams row", () => {
    const items = () => teamItems(facts({ beside: [besideRow({ state: "asking" })] }));
    const { view, chat, el, menus } = viewOf({ rows: () => [agentRow("a1")], items });
    view.paint(chat);
    one(el, "sd-threads").dispatch("click");
    const rows = menuRows(menus.at(-1));
    assert.deepEqual(rows.slice(0, 3), [["item", "Start…"], ["label", "Needs you"], ["radio", "Bug Hunter: find bugs in the parser", false]]);
    assert.deepEqual(rows.at(-1), ["radio", "Teams", false]);
    assert.equal(menus.at(-1).items.find((/** @type {any} */ i) => i.label === "Bug Hunter: find bugs in the parser").desc, "on the side · its lead asks you");
  });
});

describe("a team on the side, alone in its row's pane", () => {
  const place = (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k);
  /** @param {any[]} rows */
  const make = (rows) => {
    const io = { rows: () => rows, brief: () => {}, set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {}, now: () => NOW };
    return createBesideView(/** @type {any} */ (io), { h: fakeH, place, drawIn: fakeDrawIn });
  };
  const DONE = { state: "done", workers: { running: 0, waiting: 0, total: 3 }, result: { n: 1, text: "Found: parse.js:3 reads a field of null.", more: false, at: NOW }, notified: { n: 1, at: NOW, how: "sent" } };

  // (fails before: yes — U13-D5: the section painted every team, under its head, always)
  test("its card whole, with no section head, even one that folds to a row in the list of all; gone, a line that says so", () => {
    const v = make([besideRow({ ...DONE }), besideRow({ id: "t2", ...DONE, team: { key: "verifier", name: "Verifier" } })]);
    v.paint({ chainId: "c1" });
    assert.deepEqual([byClass(v.el, "bes-row").length, byClass(v.el, "bes-card").length], [2, 0], "the section: each sent result folds to a row");
    v.paint({ chainId: "c1" }, "t1");
    assert.deepEqual([byClass(v.el, "bes-card").map((c) => c.attrs["data-beside"]), byClass(v.el, "bes-row").length, one(v.el, "bes-head"), one(v.el, "bes-grid").classList.contains("is-one")],
      [["t1"], 0, undefined, true]);
    v.paint({ chainId: "c1" }, "t9");
    assert.equal(textOf(v.el), "This team is no longer on the side of this chat.");
  });
});

describe("the host: the teams on the Agents tab", () => {
  /** @param {() => any[]} rows @param {any} [beside] */
  function hostOf(rows, beside) {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    /** @type {any[]} */
    const shown = [];
    const views = createViews({
      frame, slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH, api: async () => null, openAgent: () => {}, openRunLog: () => {},
      onShow: (chat) => { shown.push([chat.id, chat.viewTab]); },
      loadRun: () => Promise.resolve(), later: () => {},
      team: teamIO({ rows, ...(beside ? { beside } : {}) }),
      side: /** @type {any} */ (sideIO({ rows })),
      sideSeams: sideSeams().seams,
      place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
      modelSelect: modelSelects().make,
    });
    return { frame, slot, views, shown };
  }
  /** The row of the Agents tab that is open. @param {any} frame */
  const openRow = (frame) => all(frame, (x) => x.attrs?.["aria-current"] === "true" && !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"]);
  /** A session chat with its settings' engine. @param {any} engine */
  const chatOf = (engine) => /** @type {any} */ ({ id: "chat-1", chainId: "c1", sessionId: "s1", turns: [], viewTab: "chat", view: { settings: { effective: {}, engine } } });

  // (fails before: yes — U13-D5: Show the teams opened the Team tab)
  test("Show the teams opens the Agents tab on the team in charge, with the dock under it; with none in charge, on the Teams row", () => {
    const { frame, views } = hostOf(() => []);
    const c = chatOf(ENGINE);
    views.setChat(c);
    views.show("team");
    assert.deepEqual([views.view, c.viewTab, openRow(frame), frame.classList.contains("view-side"), frame.classList.contains("side-team")], ["team", "side", [TEAM_CHARGE], true, true]);
    const d = chatOf({ mode: "agent" });
    views.setChat(d);
    views.show("team");
    assert.deepEqual([views.view, openRow(frame), frame.classList.contains("side-team")], ["side", [TEAM_HOME], false], "the Teams row: what a team is, and each one");
  });

  // (fails before: yes — U13-D5)
  test("a team on the side's row: its pane holds its board or card alone; the badge counts it", () => {
    let rows = [besideRow({ main: "", state: "done", workers: { running: 0, waiting: 0, total: 3 }, result: { n: 1, text: "Found it.", more: false, at: NOW } })];
    const beside = { rows: () => rows, brief: () => {}, set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {}, now: () => NOW };
    const { frame, slot, views } = hostOf(() => [], beside);
    const c = chatOf({ mode: "agent" });
    views.setChat(c);
    views.side.open(sideTeamItem("t1"));
    views.show("side");
    const pane = one(frame, "sd-team");
    assert.deepEqual([byClass(pane, "bes-card").map((x) => x.attrs["data-beside"]), one(pane, "bes-head"), one(pane, "th-teams")], [["t1"], undefined, undefined], "its card alone: no section head, no Teams home");
    assert.equal(frame.classList.contains("side-team"), false, "a team on the side is no team you talk to: no dock");
    rows = [besideRow({ main: "" })];
    views.draw();
    const tab = all(slot, (x) => x.attrs?.["data-view"] === "side")[0];
    assert.equal(tab.attrs["aria-label"], "Agents, 1 team on the side at work");
  });
});

describe("the sidebar: a team on the side under its chat's row", () => {
  // (fails before: yes — U13-D5: a team's chat was in no list of the sidebar; the sessions list said nothing of the
  // chat it works for)
  test("a team chat's row names its team and the chat it works for; a chat of yours has no such field", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-sidechats-"));
    const archive = new Archive({ file: join(dir, "a.db") });
    try {
      /** @type {any} */
      const brain = new MemoryBrain(/** @type {any} */ ({ archive, getConfig: () => ({}) }));
      const main = archive.chainForKey("main", { cwd: "H:\\p", client: "harness" });
      const team = archive.chainForKey("team", { cwd: "H:\\p", client: "harness", kind: "team" });
      archive.link(team.id, main.id, "beside");
      archive.mergeMeta(team.id, { beside: { team: "bug-hunter", name: "Bug Hunter", ask: "find bugs" } });
      const loose = archive.chainForKey("loose", { cwd: "H:\\p", client: "harness", kind: "team" });
      const rows = brain.sessions("", { limit: 20, kinds: ["team"] });
      assert.deepEqual(rows.find((r) => r.id === team.id).beside, { main: main.id, name: "Bug Hunter" });
      assert.equal(rows.find((r) => r.id === loose.id).beside, null, "a team chat with no word of where it works");
      assert.equal(Object.hasOwn(brain.sessions("", { limit: 20 }).find((r) => r.id === main.id), "beside"), false);
      brain.stop();
    } finally {
      archive.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — U13-D5)
  test("under each chat: its teams at work or asking first, then the newest; one that ended stays the day it ran; three at most", () => {
    const today = localDay();
    const row = (/** @type {string} */ id, /** @type {string} */ main, /** @type {string} */ name, when = today) => ({ id, kind: "team", when, beside: { main, name } });
    const marks = { running: new Set(["t2"]), paused: new Set(["t3"]), errored: new Set(["t4"]) };
    const under = sideChatsUnder([row("t1", "c1", "Verifier"), row("t2", "c1", "Bug Hunter"), row("t3", "c1", "Architect"), row("t4", "c1", "Methodical"), row("t5", "c2", "Bug Hunter", "2020-01-01"), row("t6", "c2", "Verifier", "2020-01-01"), { id: "t7", kind: "team", beside: null }], { ...marks, running: new Set(["t2", "t6"]) });
    assert.deepEqual((under.get("c1") || []).map((x) => [x.s.id, x.name, x.state, x.words]), [["t2", "Bug Hunter", "works", "working"], ["t3", "Architect", "asks", "asks you"], ["t1", "Verifier", "done", "done"]],
      `${SIDE_ROWS_MOST} at most: the stopped one of today gives way`);
    assert.deepEqual((under.get("c2") || []).map((x) => [x.s.id, x.state]), [["t6", "works"]], "an old one stays while it works");
    assert.equal(SIDE_ROWS_MOST, 3);
    const stopped = sideChatsUnder([row("t4", "c3", "Methodical")], marks).get("c3");
    assert.deepEqual(stopped?.map((x) => [x.state, x.words]), [["stopped", "stopped"]]);
    // (fails before: yes — a team whose lead a restart cut off, or the person stopped, said done)
    const cut = sideChatsUnder([row("t8", "c4", "Bug Hunter")], { ...marks, stopped: new Set(["t8"]) }).get("c4");
    assert.deepEqual(cut?.map((x) => [x.state, x.words]), [["stopped", "stopped"]]);
  });

  // (fails before: yes — U13-D5; the sidebar draws with the page's own document, so its wiring is read from its source)
  test("the sidebar reads the team chats beside its list and draws each chat's under its row, in every layout", () => {
    const src = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.match(src, /q \|\| showArchived \? null : api\("\/memory\/sessions\?limit=100&kind=team"\)\.catch\(\(\) => null\),/);
    // One whose lead asks you stands in Now instead (the Designer's of 10-27: one chat, one place).
    // Its threads follow (thread-ui.test.js), each a chat's rows of its own.
    assert.match(src, /const rowsOf = \(s, o = \{\}\) => \[\n\s*sessionRow\(s, o\),\n\s*\.\.\.\(under\.get\(String\(s\.id\)\) \|\| \[\]\)\.filter\(\(x\) => !now\.stands\(String\(x\.s\.id\)\)\)\.map\(sideRow\),\n\s*\.\.\.\(threadsUnder\.get\(String\(s\.id\)\) \|\| \[\]\)\.flatMap\(\(t\) => rowsOf\(t, o\)\),\n\s*\];/);
    assert.equal((src.match(/\.flatMap\(\(s\) => rowsOf\(s/g) || []).length, 4, "pinned and the timeline, in both layouts");
    assert.match(src, /h\("span", \{ class: "sess-title" \}, `↳ \$\{x\.name\}`\), h\("span", \{ class: "row-side" \}, "side"\)/);
    // Its handlers are its draw's, which the sidebar drawn again in place carries (the owner's of 11-01).
    assert.match(src, /if \(chat\) cb\.onSelectChat\(chat\.id\); else cb\.onOpen\(s\);\n\s*\},\n\s*onkeydown: [^]*?\n\s*\},\n\s*h\("span", \{ class: "row-lead" \}, lead\)/, "pressed, the team's own chat opens");
  });
});
