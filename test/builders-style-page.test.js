// @ts-check
// The plan's p6 and the owner's of 11-04, the page: the four shipped teams that built are one team, Builders, whose
// lead leads one way — on the start board's team menu and the Agents tab's Who, one row, which starts Builders; the who
// button, the band, the Team view and Now saying "Builders"; the Brief naming the team alone and sending it; and the
// Library's Teams part drawing Builders as one pod, its editor setting its check. Nowhere a list of ways to lead.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStartBoard } from "../src/ui/harness/conversation/start-board.js";
import { createSideView } from "../src/ui/harness/views/side.js";
import { openBrief } from "../src/ui/harness/views/brief.js";
import { nowRows } from "../src/ui/harness/lib/now.js";
import * as team from "../src/ui/harness/lib/team.js";
import * as libTeams from "../src/ui/harness/library/teams.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { poolChips } from "./helpers/team-view.js";
import { agentRow, menuRow, menuRows, NOW, sideIO, sideSeams } from "./helpers/side-view.js";
import { all, every, one, btn, field, type, pick, settle, openAgents } from "./helpers/agents-page.js";
import "./helpers/teams-on-page.js";

/** The words the page drew for a list of ways a lead could lead: none of them stands anywhere. */
const OLD_WAYS = /10x Engineer|Methodical|Architect|One-Shot|leads four ways|in the style you pick|How its lead leads/;
/** The crew every shipped team that builds seats. */
const FOUR = [
  { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", card: "builder", name: "Tester", may: "edit", place: "builder" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
/** Builders as a team row (core/roster.js `teamRow`), as it ships. */
const BUILDERS = { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, check: null, readOnly: false, models: [], most: null, leadModel: null, lead: { tag: "buildlead", name: "Builders" }, members: FOUR };
const HUNTER = { key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs, never fixes them", shipped: true, check: null, readOnly: true, models: [], most: null, leadModel: null, lead: { tag: "huntlead", name: "Bug Hunter" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", may: "read", place: "reviewer" }] };
const DOCS = { key: "docs", name: "Docs", line: "Plain words", shipped: false, check: null, lead: { tag: "product", name: "Product" }, members: [FOUR[1]] };

/** Promises settled. */
const settled = () => new Promise((r) => setImmediate(r));

// (fails before: yes — the menu drew Builders as a row per style under "Builders: one crew, its lead in the style you
// pick", each holding engine.teamStyle beside the team)
describe("the start board's team menu and who button", () => {
  /** A draft-start answer, its `who` as the server gives it (draft-start.js `startAnatomy`). @param {Record<string, any>} [who] */
  const answer = (who = {}) => ({
    cwd: "H:/proj", projectId: null, preset: null, presetWhy: null,
    flat: { "context.strategy": "plain", "loop.tools": null }, sources: {},
    engine: { kind: "loop", model: "brain-model" },
    window: { tokens: 200000, source: "price card" }, line: { percent: 85, tokens: 170000 },
    parts: [{ id: "prompt", tokens: 3000 }, { id: "message", tokens: 12 }], loopFixed: 3000,
    instructions: { files: [], missing: [], sessionChars: 0 },
    skills: { on: [], list: [], triggered: [], problems: [] },
    tools: { offered: ["read", "agent"], off: [], memory: 0, recall: false, mcp: [] },
    memory: { global: true, autopilot: true, on: true, ready: true, briefing: 0, recall: 0, tools: 0, knows: { memories: 0, dossier: 0 } },
    who: { teams: [HUNTER, DOCS, BUILDERS], asked: false, team: null, off: null, problem: null, ...who },
  });
  /** The board on the fake DOM, a host that records and holds what is set. @param {Record<string, any>} [held] */
  const boardWith = (held = {}) => {
    /** @type {any[]} */
    const calls = [];
    /** @type {any[][]} */
    const menus = [];
    const io = {
      held: () => held,
      set: (/** @type {string} */ path, /** @type {any} */ value) => { calls.push(["set", path, value]); held[path] = value; },
      unset: (/** @type {string} */ path) => { calls.push(["unset", path]); delete held[path]; },
      permission: () => "edit", setPermission: () => {}, models: () => [{ id: "brain-model" }], mainModel: () => "brain-model", agentName: () => "",
      agents: () => ({ cards: [], asks: [] }), manageMcp: () => {}, chat: () => ({}), presets: () => ({}), choosePreset: () => {}, reset: () => {}, saveAs: () => {},
    };
    const modelSelect = () => ({ el: fakeH("span", {}), set() {}, setModels() {} });
    const board = createStartBoard(/** @type {any} */ (io), { h: /** @type {any} */ (fakeH), modelSelect: /** @type {any} */ (modelSelect), poolChip: /** @type {any} */ (poolChips().make), menu: /** @type {any} */ ((/** @type {any[]} */ items) => menus.push(items)) });
    const el = /** @type {any} */ (board.el);
    const whoTeam = () => buttonsOf(el.querySelector(".nt-who-seg"))[1];
    return { board, calls, menus, el, whoTeam };
  };

  test("Builders is one row under They build; picked, it holds Builders alone; another team holds that team", () => {
    const { board, calls, menus, whoTeam } = boardWith();
    board.paint(answer());
    whoTeam().dispatch("click");
    const items = menus[0];
    assert.deepEqual(items.map((/** @type {any} */ i) => (i.type === "check" ? [i.label, i.desc ?? ""] : i.type === "label" ? i.label : i.type)), [
      "They build", ["Builders", "Builders leads Scout, Builder, Tester, Reviewer"],
      "separator", "They look and check", ["Bug Hunter", "Bug Hunter leads Hunter"],
      "separator", "Yours", ["Docs", "Product leads Builder"],
    ]);
    items.find((/** @type {any} */ i) => i.label === "Builders").onClick();
    assert.deepEqual(calls.splice(0), [["set", "engine.mode", "team"], ["set", "engine.team", "builders"]]);
    board.paint(answer({ asked: true, team: "builders" }));
    whoTeam().dispatch("click");
    assert.deepEqual(menus[1].filter((/** @type {any} */ i) => i.type === "check" && i.checked).map((/** @type {any} */ i) => i.label), ["Builders"]);
    menus[1].find((/** @type {any} */ i) => i.label === "Docs").onClick();
    assert.deepEqual(calls.splice(0), [["set", "engine.mode", "team"], ["set", "engine.team", "docs"]]);
  });

  test("the who button says the team, and the line under it who runs it; ↺ and the agent itself put back the two it holds", () => {
    const held = { "engine.mode": "team", "engine.team": "builders" };
    const { board, calls, el, whoTeam } = boardWith(held);
    board.paint(answer({ asked: true, team: "builders" }));
    assert.equal(textOf(whoTeam()), "Builders team");
    assert.equal(textOf(el.querySelector(".nt-who-by")), "Run by Builders, with Scout, Builder, Tester, Reviewer");
    assert.equal(whoTeam().attrs.title, "Builders leads Scout, Builder, Tester, Reviewer");
    buttonsOf(el.querySelector(".nt-who-mark"))[0].dispatch("click");
    assert.deepEqual(calls.splice(0), [["unset", "engine.mode"], ["unset", "engine.team"]]);
    Object.assign(held, { "engine.mode": "team", "engine.team": "builders" });
    board.paint(answer({ asked: true, team: "builders" }));
    buttonsOf(el.querySelector(".nt-who-seg"))[0].dispatch("click");
    assert.deepEqual(calls.splice(0), [["unset", "engine.team"], ["set", "engine.mode", "model"]]);
    assert.doesNotMatch(textOf(el), OLD_WAYS);
  });
});

// (fails before: yes — the Who drew Builders as a row per style under a label of its own, and its Brief opened on a style)
describe("the Agents tab's Who", () => {
  test("Builders is one row among the teams; picked, the box names it, and its Brief opens on the team alone", () => {
    /** @type {any[]} */
    const briefs = [];
    const io = sideIO({ teamsList: () => [HUNTER, BUILDERS], brief: (/** @type {any} */ f) => briefs.push(f) });
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    view.paint(chat);
    const el = /** @type {any} */ (view.el);
    const name = () => textOf(all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("sd-agent-name"))[0]);
    all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("sd-agent"))[0].dispatch("click");
    assert.deepEqual(menuRows(s.menus[0]).slice(-3), [["label", "Teams: a lead and its workers"], ["radio", "Bug Hunter", false], ["radio", "Builders", false]]);
    menuRow(s.menus[0], "Builders").onClick();
    assert.deepEqual([name(), chat.side.draft.team, "style" in chat.side.draft], ["Builders", "builders", false]);
    const box = all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("sd-task"))[0];
    box.value = "add the logbook";
    box.dispatch("input");
    buttonsOf(all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("sd-how"))[0])[1].dispatch("click");
    assert.deepEqual(briefs, [{ team: "builders", way: "charge", ask: "add the logbook" }]);
  });
});

// (fails before: yes — the team in charge carried the style the answer named, and the page said "Builders · Methodical")
describe("who leads", () => {
  test("leadingTeam is the team the answer names, a style it carries left alone; a gone team key is its key and the server's words", () => {
    const engine = { mode: "team", team: "builders", style: "methodical", teams: [BUILDERS], problem: null };
    const t = /** @type {any} */ (team.leadingTeam(engine));
    assert.deepEqual([t.key, t.name, "style" in t], ["builders", "Builders", false]);
    const gone = "engine.team names `architect`, which is no team — Builders does Architect's work: pick Builders (/team lists them)";
    const old = /** @type {any} */ (team.leadingTeam({ mode: "team", team: "architect", teams: [BUILDERS], problem: gone }));
    assert.deepEqual([old.name, old.problem], ["architect", gone]);
  });

  test("Now's lead row says the team its workers name; the left bar hands Now no team of its own", () => {
    const run = { id: "r1", kind: "agent-turn", status: "running", startedAt: NOW - 120_000, endedAt: null, parentId: null, events: 40, meta: { chain: "a", model: "m-1" } };
    const worker = agentRow("w1", { origin: "agent", status: "running", team: { name: "Builders", role: "builder" }, exchanges: [{ description: "build it", startedAt: NOW - 10_000 }] });
    const facts = { title: "Fix the rail", project: "filament", when: NOW, unread: false };
    const g = nowRows({ runs: [run], folds: new Map(), threads: new Map([["a", [worker]]]), chats: (c) => (c === "a" ? facts : null), unread: new Set(), holders: new Map(), now: NOW });
    assert.deepEqual([g.works[0].fact.split(" · ")[0], g.works[0].team], ["Builders leads", "Builders"]);
    const bar = readFileSync("src/ui/harness/sidebar.js", "utf8");
    assert.doesNotMatch(bar, /leadingTeam|teamTitle/);
  });
});

// (fails before: yes — the Brief of Builders offered its styles to pick, named the one picked in its head and sent it)
describe("the Brief of Builders", () => {
  /** A Brief over a chat, recording its fire and hand-over. @param {Record<string, any>} [fill] */
  const briefWith = (fill = {}) => {
    const rec = { fired: /** @type {any[]} */ ([]), handed: /** @type {any[]} */ ([]) };
    const picker = () => ({ el: fakeH("button", {}), set() {}, setModels() {}, setFamilies() {}, setAccounts() {}, setNote() {}, setLocked() {}, open() {} });
    const io = {
      teams: () => [HUNTER, BUILDERS],
      chat: () => ({ title: "opus55", model: "m-1", live: false, round: null, paused: false, workersAtWork: false, tokens: 1000, compactions: 0, turns: 2, cost: null }),
      models: () => ["m-1"], seats: () => ["m-1"], reads: async () => null, preview: async () => "", runsOn: async () => null, slots: async () => null, setSlot: async () => null,
      fire: async (/** @type {any} */ b) => (rec.fired.push(b), true), handOver: async (/** @type {any} */ o) => (rec.handed.push(o), /** @type {const} */ ("now")), stopTurn: () => {},
    };
    const sheet = (/** @type {any} */ s) => ({ el: fakeH("div", {}, s.head, s.body, s.foot), close: () => {} });
    const b = openBrief(/** @type {any} */ (io), fill, { h: fakeH, place: (p, k) => p.replaceChildren(...k), sheet, modelSelect: /** @type {any} */ (picker), menu: /** @type {any} */ (() => ({ el: fakeH("div", {}), close() {} })), store: { get: () => null, set: () => {} } });
    const write = (/** @type {string} */ words) => {
      const ask = all(b.el, (x) => x.attrs?.["aria-label"] === "What it is to do")[0];
      ask.value = words;
      ask.dispatch("input", { target: ask });
    };
    const send = () => all(b.el, (x) => String(x.attrs?.class || "") === "br-send")[0];
    return { b, rec, write, send };
  };

  test("its head names the team; nothing to pick of how its lead leads; a hand-over and a fire send the team alone", async () => {
    const { b, rec, write, send } = briefWith({ team: "builders", style: "architect" });
    await settled();
    assert.equal(textOf(all(b.el, (x) => x.attrs?.class === "br-title")[0]), "Brief the Builders");
    assert.equal(all(b.el, (x) => x.attrs?.["aria-label"] === "How its lead leads").length, 0);
    assert.doesNotMatch(textOf(b.el), OLD_WAYS);
    write("Build the logbook");
    send().dispatch("click");
    await settled();
    assert.deepEqual(rec.handed.map((h) => [h.team, "style" in h]), [["builders", false]]);
    const side = briefWith({ team: "builders", way: "side" });
    await settled();
    side.write("Build it");
    side.send().dispatch("click");
    await settled();
    assert.deepEqual(side.rec.fired.map((f) => [f.team, "style" in f]), [["builders", false]]);
  });
});

describe("Library: Builders and its check", () => {
  const CHECK_DOES = "One command that proves a worker's change sound — every worker that changes files may run it without asking, and Filament runs it when that worker reports.";

  // (fails before: yes — Builders' pod drew a row per style under "Its lead leads four ways", each with its /team and
  // Make it its own)
  test("Builders is one pod among the teams that build: its table, its /team, and no list of ways to lead", async () => {
    const p = await openAgents({});
    const pods = all(p.groups(), (x) => x.attrs?.["data-key"] === "builders");
    assert.equal(pods.length, 1);
    const pod = pods[0];
    assert.equal(every(p.groups(), "lib-pod").filter((x) => textOf(one(x, "lib-team-name")).startsWith("Builders")).length, 1, "one Builders pod");
    assert.deepEqual([every(pod, "lib-styles").length, every(pod, "lib-style").length, "data-build" in pod.attrs, String(pod.attrs.class).includes("lib-build")], [0, 0, false, false]);
    assert.doesNotMatch(textOf(pod), OLD_WAYS);
    assert.deepEqual(all(pod, (x) => x.tag === "code").map((c) => textOf(c)).filter((t) => t.startsWith("/team")), ["/team builders"], "its command once");
    assert.deepEqual(all(one(pod, "lib-pod-start"), (x) => x.tag === "code").map((c) => textOf(c)), ["/team builders"], "in its foot");
    assert.match(textOf(one(pod, "lib-pod-start")), /\/team builders$/);
    assert.deepEqual(every(pod, "lib-seat").map((s) => s.attrs["data-seat"]), ["buildlead", "scout", "builder", "tester", "reviewer"]);
  });

  test("Builders' editor: no style to pick, its check one line with what it does under it; Save sends it; emptied, it goes", async () => {
    const p = await openAgents({});
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    let ed = p.editor();
    assert.equal(field(ed, "Style"), undefined);
    assert.doesNotMatch(textOf(ed), OLD_WAYS);
    const check = field(ed, "Check");
    assert.equal(textOf(all(ed, (x) => x.attrs?.class === "ed-row" || x.attrs?.class === "ed-row is-wide").find((r) => textOf(r).startsWith("Check|"))), `Check|${CHECK_DOES}`);
    assert.equal(libTeams.CHECK_DOES, CHECK_DOES);
    type(check, "  npm test  ");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    const writes = () => p.calls.filter(([m, path]) => m === "PUT" && path === "/teams/builders").map(([, , b]) => b);
    assert.deepEqual(writes(), [{ check: "npm test" }]);
    assert.deepEqual(every(p.team("builders"), "lib-pod-chip").map((c) => textOf(c)), ["Its check: npm test"]);
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    ed = p.editor();
    type(field(ed, "Check"), "");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(writes()[1], { check: null });
  });

  test("a new team: no style to pick; a check longer than the read's limit holds Save, saying why; it sends the check only where it names one", async () => {
    const p = await openAgents({});
    /** @type {any} */ (btn(one(p.body, "lib-ag-bar"), "New team…")).dispatch("click");
    const ed = p.editor();
    assert.equal(field(ed, "Style"), undefined);
    type(field(ed, "Name"), "Docs");
    pick(field(ed, "Lead"), "product");
    pick(field(ed, "Add a worker"), "builder");
    type(field(ed, "Check"), "x".repeat(401));
    assert.equal(textOf(one(ed, "tset-why")), "A check is one command line, up to 400 characters");
    assert.ok("disabled" in /** @type {any} */ (btn(ed, "Save")).attrs);
    type(field(ed, "Check"), "npm test");
    /** @type {any} */ (btn(ed, "Save")).dispatch("click");
    await settle();
    assert.deepEqual(p.calls.filter(([m, path]) => m === "POST" && path === "/teams").map(([, , b]) => b), [{ name: "Docs", lead: "product", members: [{ tag: "builder" }], check: "npm test" }]);
    assert.deepEqual(every(p.team("docs"), "lib-pod-chip").map((c) => textOf(c)), ["Its check: npm test"]);
  });
});
