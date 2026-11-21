// @ts-check
// Settings › Experimental's Teams switch on the page (src/ui/lib/teams-on.js; the owner's of 11-17: "Put the Teams
// behind experimental switch and keep the switch off by default … the switch will turn of every trace of team feature
// we have in filament"): off, as it ships, nothing offers a team and the Library's page is Agents; a team already at
// work still shows, stops and sends its result. On, all of it is back. The page's other tests run with it on
// (helpers/teams-on-page.js); the server's side is teams-switch.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { openAgents, btn, every, one, all } from "./helpers/agents-page.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";
import { state } from "../src/ui/harness/state.js";
import { cardActions } from "../src/ui/harness/lib/beside.js";
import { createSlashPanel } from "../src/ui/harness/composer/slash.js";
import { FLOW_HOME } from "../src/ui/harness/lib/flow.js";
import { SECTIONS, TEAM_KNOBS } from "../src/ui/lib/settings/knobs.js";
import { KNOBS } from "../src/services/session-settings.js";
import { createSideView, LIST_LINE, LIST_LINE_ALONE } from "../src/ui/harness/views/side.js";
import { createWatchAll, WATCH_EMPTY, WATCH_EMPTY_ALONE } from "../src/ui/harness/views/side-watch.js";
import { createBesideView } from "../src/ui/harness/views/beside.js";
import { TEAM_HOME } from "../src/ui/harness/lib/side.js";
import { toolFamilies } from "../src/ui/harness/widgets/overview-setup.js";
import { secondLookWords } from "../src/ui/harness/settings/permissions.js";
import { readHits, thingHits } from "../src/ui/harness/settings/search.js";

/**
 * `fn` run with the switch as given, the page's configuration put back after.
 * @template T @param {boolean} on @param {() => T | Promise<T>} fn @returns {Promise<T>}
 */
const withTeams = async (on, fn) => {
  const config = state.config;
  state.config = { ...(config || {}), experimental: { ...(config?.experimental || {}), teams: on } };
  try {
    return await fn();
  } finally {
    state.config = config;
  }
};
const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("a team's card", () => {
  // (fails before: yes — Verify, then send… sent BugHunters and Resume… started a team again, the switch off or on)
  test("Verify and Resume… only while teams are on; Stop and Send to your agent… stay for a team already at work", () => {
    const done = /** @type {any} */ ({ state: "done", result: { text: "x" }, main: "c1", notified: false, checked: false });
    const pick = (/** @type {any} */ a) => [a.stop, a.notify, a.verify, a.resume];
    assert.deepEqual(pick(cardActions(done, true)), [false, true, true, false]);
    assert.deepEqual(pick(cardActions(done, false)), [false, true, false, false]);
    assert.deepEqual(pick(cardActions(done)), [false, true, true, false], "a caller that says nothing of the switch: on");
    const stopped = /** @type {any} */ ({ state: "stopped", main: "c1" });
    assert.deepEqual([cardActions(stopped, true).resume, cardActions(stopped, false).resume], [true, false]);
    const working = /** @type {any} */ ({ state: "working", main: "c1" });
    assert.deepEqual([cardActions(working, false).stop, cardActions(working, false).switches], [true, true]);
    // Every caller hands the switch in.
    for (const f of ["src/ui/harness/conversation/beside-marks.js", "src/ui/harness/panes/team-result.js", "src/ui/harness/views/beside.js"]) {
      const src = read(f);
      assert.equal((src.match(/cardActions\(r\)/g) || []).length, 0, `${f}: every call says the switch`);
      assert.ok(src.includes("cardActions(r, teamsOn(state.config))"), f);
    }
  });
});

describe("Library › Agents", () => {
  // (fails before: yes — the page was Agents and teams, with New team…, the Teams part and a team's ways to use them)
  test("off: no New team…, no Teams part, no team's way in How to use them, and a start at the teams opens none; on: each is back", async () => {
    await withTeams(false, async () => {
      const p = await openAgents({ start: "groups" });
      assert.equal(btn(p.body, "New team…"), undefined);
      assert.equal(p.groups(), undefined, "no Teams part");
      assert.ok(btn(p.body, "New agent…"), "New agent… stays");
      const head = textOf(p.part("Agents"));
      assert.match(head, /any of them can be asked/);
      assert.doesNotMatch(head, /lead a team/);
      btn(p.body, "How to use them").dispatch("click");
      const ways = every(p.body, "lib-where-row").map((r) => textOf(r));
      assert.equal(ways.length, 5, "Ask, Start one beside you, Pick its model, Your agent by itself, Coding agents' own");
      assert.ok(ways.every((w) => !/team/i.test(w)), ways.join("\n"));
      assert.ok(ways.some((w) => w.includes("Your agent by itself")));
      // An open card's Used by: its quick starts, none of the teams it sits in.
      one(all(p.body, (x) => x.attrs?.["data-tag"] === "reviewer")[0], "lib-card-face").dispatch("click");
      const facts = every(one(all(p.body, (x) => x.attrs?.["data-tag"] === "reviewer")[0], "tset-detail"), "aset-fact").map((x) => textOf(x));
      assert.equal(facts.at(-1), "Used by|/subagent start=ask · /subagent start=review · /subagent start=catchup");
    });
    await withTeams(true, async () => {
      const p = await openAgents();
      assert.ok(btn(p.body, "New team…"));
      assert.ok(p.groups(), "the Teams part");
      assert.match(textOf(p.part("Agents")), /any of them can be asked, lead a team or work in one/);
      btn(p.body, "How to use them").dispatch("click");
      assert.equal(every(p.body, "lib-where-row").length, 7);
    });
  });
});

describe("the message box's @ list", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — its head said teams while the switch was off)
  test("its head names teams only while the switch is on", async () => {
    const panel = createSlashPanel({ onInsert: () => {}, onBrief: () => {}, getCards: () => [/** @type {any} */ ({ tag: "pm", name: "PM", goodFor: "" })], getTeams: () => [] });
    const head = async () => {
      await panel.open("@", "", { agents: true });
      await new Promise((r) => setTimeout(r, 10));
      return panel.el.querySelector(".slash-head-title")?.textContent;
    };
    assert.equal(await withTeams(true, head), "Agents, teams, chats and files", "as main has it, a team listed or not");
    assert.equal(await withTeams(false, head), "Agents, chats and files");
    panel.close();
    // The composer's teams are the app's `sendable`, none while the switch is off (harness-side.test.js pins it).
    assert.match(read("src/ui/harness/composer/composer.js"), /getTeams: briefable,/);
  });
});

describe("Flows", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — a saved flow with a team box was offered, and its Start refused)
  test("off: a saved flow with a team box is no start, and a pick of one is let go; the line names agents alone; on: it is offered", async () => {
    const views = await import("../src/ui/harness/views/flow.js");
    let on = false;
    const SAVED = [
      { key: "plan", name: "Plan", shipped: false, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "plan" }] }] },
      { key: "plan-check-build-hunt", name: "Plan, check, build, hunt", shipped: true, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "plan" }] }, { boxes: [{ kind: "team", agent: "bughunters", words: "hunt" }] }] },
    ];
    /** @type {any[]} */
    const calls = [];
    const routes = new Proxy({}, { get: (_, name) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true, flow: { id: "fl-1" } }); } });
    const p = views.createFlowPane(/** @type {any} */ ({
      rows: () => [], cards: () => [{ tag: "pm", name: "PM" }], teams: () => [], press: (/** @type {any} */ fn) => fn(routes),
      saved: () => SAVED, loadSaved: () => {}, created: () => {}, teamsOn: () => on,
    }), /** @type {any} */ ({ card: () => doc.document.createElement("div") }));
    const el = /** @type {any} */ (p.el);
    doc.document.body.append(el);
    const chat = { chainId: "c1" };
    const names = () => el.querySelectorAll('[role="radio"]').map((/** @type {any} */ r) => String(r.textContent));
    try {
      on = true;
      p.paint(chat, FLOW_HOME);
      assert.equal(names().length, 3, "Nothing and both flows");
      assert.ok(names().some((n) => n.includes("Plan, check, build, hunt")));
      assert.match(String(el.querySelector(".bes-line")?.textContent), /^Your agents and teams in steps/);
      // Picked while on, then the switch goes off: the pick is let go.
      el.querySelectorAll('[role="radio"]')[2].dispatch("click");
      on = false;
      p.paint(chat, FLOW_HOME);
      assert.equal(names().length, 2, "Nothing and Plan");
      assert.ok(!names().some((n) => n.includes("hunt")));
      assert.equal(el.querySelectorAll('[role="radio"]')[0].getAttribute("aria-checked"), "true", "back on Nothing");
      assert.match(String(el.querySelector(".bes-line")?.textContent), /^Your agents in steps/);
      const goal = el.querySelector("textarea");
      goal.value = "plan it";
      goal.dispatch("input");
      el.querySelectorAll("button").find((/** @type {any} */ b) => /New flow$/.test(b.textContent)).dispatch("click");
      await new Promise((r) => setImmediate(r));
      assert.deepEqual([calls.at(-1)[0], calls.at(-1)[1].saved, calls.at(-1)[1].flow?.goal], ["create", undefined, "plan it"], "from Nothing: no saved flow it no longer offers");
      // On, a pick stays as main keeps it, the list read again without it.
      on = true;
      SAVED.push({ key: "mine", name: "Mine", shipped: false, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "mine" }] }] });
      p.paint(chat, FLOW_HOME);
      el.querySelectorAll('[role="radio"]').find((/** @type {any} */ r) => String(r.textContent).includes("Mine")).dispatch("click");
      SAVED.pop();
      p.paint(chat, FLOW_HOME);
      goal.value = "mine again";
      goal.dispatch("input");
      el.querySelectorAll("button").find((/** @type {any} */ b) => /New flow$/.test(b.textContent)).dispatch("click");
      await new Promise((r) => setImmediate(r));
      assert.equal(calls.at(-1)[1].saved, "mine", "on: the pick kept");
    } finally {
      el.remove();
    }
  });
});

describe("a chat's settings editor (Who runs this chat, the console's)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — engine.mode's team, engine.team and the teams your agent may send stood in Who runs this chat)
  test("no knob of teams while the switch is off; each a chat's setting; Who runs this chat hands to no team", async () => {
    const { sectionCard } = await import("../src/ui/lib/settings/editor.js");
    for (const p of TEAM_KNOBS) assert.ok(Object.hasOwn(KNOBS, p), `${p} is a chat's setting`);
    const knob = { type: "bool", live: false, phase: 5, doc: "x" };
    const knobs = Object.fromEntries(["engine.mode", "engine.team", "engine.supervise", "engine.agentTeams.verifyFirst", "subagents.teams", "subagents.worktree"].map((p) => [p, knob]));
    const agents = /** @type {any} */ (SECTIONS.find((s) => s.id === "agents"));
    const labels = (/** @type {boolean} */ teams) => /** @type {any} */ (sectionCard(agents, { knobs }, /** @type {any} */ ({}), {}, { teams })).querySelectorAll("li code").map((/** @type {any} */ c) => c.textContent);
    assert.deepEqual(labels(false), ["supervise", "worktree"]);
    assert.deepEqual(labels(true), ["mode", "team", "supervise", "agentTeams.verifyFirst", "teams", "worktree"]);
    const sheet = read("src/ui/harness/setup-sheet.js");
    assert.ok(sheet.includes("{ filamentRuns: true, parts, teams: teamsOn(state.config) }"));
    assert.ok(sheet.includes('id === "who" && !teamsOn(state.config) ? WHO_LINE_ALONE : spec.line'));
    assert.ok(read("src/ui/pages/memory.js").includes("settingsEditor({ doc, cb, filamentRuns: !!doc.native, teams: teamsOn(state.config) })"));
  });
});

describe("the Agents tab", () => {
  // (fails before: yes — Fable's review of n2: an address, the dock's "who asks", a turn's order row or a pane left on the
  // Teams row opened the teams' home while off, and the tab's words named teams)
  test("off: a pane aimed at the Teams row is the new thread's, and the tab's words name no team; on: as main has them", async () => {
    /** @type {string[]} */
    const painted = [];
    const teams = { el: fakeH("div", {}), items: () => [], paint: (/** @type {any} */ _c, /** @type {string} */ id) => { painted.push(id); }, home: () => true };
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (sideIO({ teams })), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    await withTeams(false, () => {
      view.aim(chat, TEAM_HOME);
      view.paint(chat);
      assert.deepEqual([painted, view.pane(chat)], [[], ""]);
      assert.equal(textOf(one(view.el, "sd-list-line")), LIST_LINE_ALONE);
      assert.equal(textOf(one(view.el, "sd-lead")), "Ask an agent. Your agent keeps working, and hears nothing unless you send it.");
    });
    await withTeams(true, () => {
      view.aim(chat, TEAM_HOME);
      view.paint(chat);
      assert.deepEqual([painted, view.pane(chat)], [[TEAM_HOME], TEAM_HOME]);
      assert.equal(textOf(one(view.el, "sd-list-line")), LIST_LINE);
    });
    // In Tiles too, where no thread's pane is painted: the switch turned off with the pane left on the Teams row.
    await withTeams(true, () => {
      btn(view.el, "Tiles").dispatch("click");
      assert.equal(view.pane(chat), TEAM_HOME);
    });
    await withTeams(false, () => { view.paint(chat); assert.equal(view.pane(chat), ""); });
    // The teams on the side: Send a team… only while on; a team at work still shows.
    const beside = createBesideView(/** @type {any} */ ({ rows: () => [{ id: "t1", team: "bughunters", name: "BugHunters", state: "working", main: "c1", task: "hunt" }], brief: () => {}, set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {}, now: () => 0 }), { h: fakeH, place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn });
    const sendHidden = () => !!btn(beside.el, "Send a team…")?.classList.contains("hidden");
    await withTeams(false, () => { beside.paint({ chainId: "c1" }); assert.equal(sendHidden(), true); assert.ok(textOf(beside.el).includes("1 at work")); });
    await withTeams(true, () => { beside.paint({ chainId: "c1" }); assert.equal(sendHidden(), false); });
    // Tiles with no agent at work names no team's.
    const w = createWatchAll({ open: () => {} }, { h: fakeH, drawIn: (p, k) => p.replaceChildren(...k) });
    const empty = () => textOf(one(w.el, "sw-empty"));
    await withTeams(false, () => { w.paint([], [], 0); assert.equal(empty(), WATCH_EMPTY_ALONE); });
    await withTeams(true, () => { w.paint([], [], 0); assert.equal(empty(), WATCH_EMPTY); });
    const host = read("src/ui/harness/views/host.js");
    assert.ok(host.includes(': leadingTeam(c?.view?.settings?.engine) ? TEAM_CHARGE : teamsOn(state.config) ? TEAM_HOME : "";'), "a way into the teams aims at the new thread while off");
    assert.ok(host.includes("if (!teamsOn(state.config) && !o.team.beside?.main?.() && !leadingTeam(chat?.view?.settings?.engine)) {\n        if (!chat?.chainId) return;\n        side.aim(chat, String(id));"), "the dock's who asks opens the agent's own thread while off, but where a team's pane stands");
  });
});

describe("Overview, the session editor and the words", () => {
  // (fails before: yes — Overview's What it may do drew a Teams beside chip while off)
  test("What it may do: no team tool's family while off; a chip switches its own family by its name", () => {
    const web = { fetch: true, search: true, browser: false };
    const labels = (/** @type {boolean} */ teams) => toolFamilies(null, web, teams).map((x) => x.label);
    assert.ok(labels(true).includes("Teams beside"));
    assert.deepEqual(labels(false), labels(true).filter((l) => l !== "Teams beside"));
    const ov = read("src/ui/harness/widgets/overview-setup.js");
    assert.ok(ov.includes("familyPatch(/** @type {typeof TOOL_GROUPS[number]} */ (TOOL_GROUPS.find((g) => g.label === f.label)), !f.on, tools)"));
    assert.ok(ov.includes("browser: flat(ctx, \"plugins.browser\") === true }, ctx.team?.on?.() !== false);"), "the widget hands the switch in");
  });

  test("the session editor's tool switches name no team tool while off", async () => {
    const doc = stubDocument();
    try {
      const { knobRow } = await import("../src/ui/lib/settings/editor.js");
      const k = /** @type {any} */ ({ type: "json", live: true, phase: 1, doc: "x", options: ["team", "flow"] });
      const names = (/** @type {boolean} */ teams) => /** @type {any} */ (knobRow("loop.tools", k, { flat: {}, sources: {} }, /** @type {any} */ ({}), { mode: "session", flat: {}, sources: {}, own: "session", teams })).querySelectorAll(".tool-switch").map((/** @type {any} */ l) => String(l.textContent));
      assert.ok(names(true).includes("team"));
      assert.deepEqual(names(false), names(true).filter((n) => n !== "team"));
      // Through a section card, as Who runs this chat and the console draw it.
      const { sectionCard } = await import("../src/ui/lib/settings/editor.js");
      const loop = /** @type {any} */ (SECTIONS.find((s) => s.id === "loop"));
      const card = (/** @type {boolean} */ teams) => /** @type {any} */ (sectionCard(loop, { knobs: { "loop.tools": k }, flat: {}, sources: {} }, /** @type {any} */ ({}), {}, { teams })).querySelectorAll(".tool-switch").map((/** @type {any} */ l) => String(l.textContent));
      assert.deepEqual([card(true).includes("team"), card(false).includes("team")], [true, false]);
    } finally {
      doc.restore();
    }
  });

  test("Run as a flow, the second look, the search: the words as the switch has them; a team's own card found only while on", async () => {
    const doc = stubDocument();
    try {
      const { flowOfferEl } = await import("../src/ui/harness/conversation/turn.js");
      const turn = /** @type {any} */ ({ userText: "plan, then build, then hunt", flowOffer: true, status: "done" });
      const title = () => /** @type {any} */ (flowOfferEl(turn, () => {}))?.querySelector("button")?.getAttribute("title");
      assert.match(String(await withTeams(true, title)), /a flow of your agents and teams over/);
      assert.match(String(await withTeams(false, title)), /a flow of your agents over/);
    } finally {
      doc.restore();
    }
    assert.match(secondLookWords({ experimental: { teams: true } }), /its card in Library › Agents and teams names/);
    assert.match(secondLookWords({}), /its card in Library › Agents names/);
    const lead = { tag: "huntlead", name: "BugHunters' lead", partOf: "bughunters", shipped: true };
    const hits = (/** @type {boolean} */ teams) => thingHits({ saved: { shipped: [lead, { tag: "reviewer", name: "Reviewer", shipped: true }], saved: [] }, state: { config: { experimental: { teams } } } }).map((x) => x.label);
    assert.deepEqual([hits(true), hits(false)], [["BugHunters' lead", "Reviewer"], ["Reviewer"]]);
    // Its settings' read failed: the switch is the page's own, so on stays on.
    const call = async (/** @type {string} */ p) => {
      if (p === "/state") throw new Error("down");
      return p === "/agents" ? { shipped: [lead], saved: [] } : null;
    };
    const found = async () => (await readHits(call, [], {})).hits.filter((x) => x.label === "BugHunters' lead").map((x) => x.where);
    assert.deepEqual([await withTeams(true, found), await withTeams(false, found)], [["Library › Agents and teams"], []]);
    // The flow sheet's words, the console's Agent loop line, and a hand-over the switch took off.
    const sheet = read("src/ui/harness/views/flow-sheet.js");
    assert.equal((sheet.match(/teamsOn\(state\.config\) \? "(One of your agents, one of your teams|Pick who this box is: one of your agents or teams)/g) || []).length, 2, "the flow sheet's words follow the switch, not the teams' read");
    assert.ok(read("src/ui/pages/settings.js").includes('${teamsOn(c) ? "the agents and teams" : "the agents"} your agent may use (${agentsPage(c)})'));
    assert.match(read("src/ui/harness/app.js"), /toast\(off\n\s*\? `The \$\{had\.name\} does not take over: teams are off in Settings › Experimental \(Teams\)/);
  });
});

describe("the app's wiring", () => {
  // (fails before: yes — nothing heard the switch move: the page drew teams until a reload)
  test("the switch read from the configuration as the page takes it, and each place drawn again once it moves", () => {
    const app = read("src/ui/harness/app.js");
    assert.equal((app.match(/(?<!\.)teamsSwitched\(\);/g) || []).length, 2, "where the configuration is taken: the state's read and the catalogue's");
    const at = app.indexOf("function teamsSwitched() {");
    assert.ok(at > 0);
    const fn = app.slice(at, app.indexOf("\n}\n", at));
    assert.match(fn, /teamsHeard = true;\n\s*if \(!on\) for \(const chain of \[\.\.\.handOvers\.keys\(\)\]\) disarmHandOver\(chain, true, true\);\n\s*if \(on === teamsWere\) return;/, "off, a hand-over is taken off whether or not the switch moved: one restored across a reload too");
    assert.match(app, /function lookAtHandOvers\(\) \{\n {2}if \(!teamsHeard\) return;/, "none goes before the configuration lands");
    assert.match(fn, /sidebar\.teamsSwitched\(\);/);
    assert.match(fn, /views\.drawTeam\(\);\n\s*views\.side\.paint\(\);\n\s*transcript\.startChanged\(\);/);
    assert.match(fn, /if \(booted && route\.kind === "library" && route\.page === "agents"\) applyRoute\(route\);/, "the Library's page drawn again where it shows");
    assert.match(app, /let teamsWere = false;/, "the page starts as the switch ships");
    // The Agents tab's Teams row and its tip; Settings › Shortcuts' Show the teams.
    const host = read("src/ui/harness/views/host.js");
    assert.match(host, /tip: id === "side" \? \(\) => \(teamsOn\(state\.config\) \? t\.tip : SIDE_TIP_ALONE\) : t\.tip,/);
    assert.match(host, /\.filter\(\(r\) => !isFlowTeam\(r\) && \(teamsOn\(state\.config\) \|\| r\.state === "working" \|\| r\.state === "asking"\)\)/, "a team at work or asking still shows");
    assert.match(read("src/ui/harness/settings/shortcuts.js"), /if \(s\.id === "view-team" && !teamsOn\(state\.config\)\) return false;/);
  });

  test("the page's switch reads as the server's: off unless set on", async () => {
    const page = await import("../src/ui/lib/teams-on.js");
    const server = await import("../src/core/teams-on.js");
    for (const cfg of [undefined, null, {}, { experimental: {} }, { experimental: { teams: false } }, { experimental: { teams: true } }, { experimental: { teams: "yes" } }])
      assert.equal(page.teamsOn(cfg), server.teamsOn(cfg), JSON.stringify(cfg));
    assert.equal(page.TEAMS_OFF, server.TEAMS_OFF);
    assert.deepEqual([page.agentsLabel({}), page.agentsLabel({ experimental: { teams: true } })], ["Agents", "Agents and teams"]);
    assert.deepEqual([page.agentsPage({}), page.agentsPage({ experimental: { teams: true } })], [server.agentsPage({}), server.agentsPage({ experimental: { teams: true } })]);
  });
});
