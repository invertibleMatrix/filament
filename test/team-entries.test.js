// @ts-check
// The ways into a team from the message box (team_v2_plan §10 O5): where a tag would address an agent, the @ list
// offers the teams too, under "Send a team" — a pick takes the typed tag away and opens the team's Brief, and nothing
// is sent; the box's + menu has Send a team…, which opens the Brief on the usual team. The Brief's Send starts a team.
// A chat not yet begun offers neither: the Start picks who runs it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSlashPanel } from "../src/ui/harness/composer/slash.js";
import { stubDocument } from "./helpers/dom-stub.js";
import "./helpers/teams-on-page.js";

const TEAMS = [
  { key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs" },
  { key: "methodical", name: "Methodical", line: "A plan first" },
];
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("a team from the message box", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — the @ list offered agents, files, chats and abilities, and no team)
  test("the @ list where a tag would address an agent: the teams under Send a team, a pick opens the Brief and sends nothing", async () => {
    /** @type {any[][]} */
    const calls = [];
    const panel = createSlashPanel({
      onInsert: (text) => calls.push(["insert", text]),
      onBrief: (team) => calls.push(["brief", team]),
      getCards: () => [/** @type {any} */ ({ tag: "pm", name: "PM", goodFor: "Is it worth building" })],
      getTeams: () => TEAMS,
    });
    await panel.open("@", "", { agents: true });
    await settle();
    const rows = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"));
    const sections = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent);
    assert.deepEqual(sections.slice(0, 2), ["Agents", "Send a team"]);
    assert.deepEqual(rows.slice(0, 3).map((r) => r.textContent), ["PM@pmIs it worth building", "Bug Hunter@bug-hunterOpens its Brief — Send starts it", "Methodical@methodicalOpens its Brief — Send starts it"]);
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "Agents, teams, chats and files");
    rows[2].dispatch("click");
    assert.deepEqual(calls, [["insert", ""], ["brief", "methodical"]], "the typed tag goes; the Brief opens on the team");
    assert.equal(panel.isOpen(), false);
    // Typing narrows them, by name or key.
    await panel.open("@", "bug", { agents: true });
    await settle();
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-row")).map((r) => r.textContent).filter((t) => t.includes("Opens its Brief")), ["Bug Hunter@bug-hunterOpens its Brief — Send starts it"]);
    // Inside a message, where a tag addresses no agent, no team is offered.
    await panel.open("@", "", { agents: false });
    await settle();
    assert.equal(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-row")).some((r) => r.textContent.includes("Opens its Brief")), false);
    panel.close();
  });

  test("the page's wiring: the + menu's Send a team…, the composer hands the teams on only where a Brief can open, the app opens the Brief", () => {
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /\.\.\.\(cb\.onBrief && \(cb\.canBrief\?\.\(\) \?\? true\) \? \[\{ label: "Send a team…", icon: "users", tone: "var\(--color-sys-yellow\)", desc: "Opens its Brief — on the side or in charge; nothing starts until its Send", onClick: \(\) => cb\.onBrief\?\.\(null\) \}\] : \[\]\),/);
    assert.match(composer, /const briefable = \(\) => \(cb\.onBrief && \(cb\.canBrief\?\.\(\) \?\? true\) && cb\.teams\?\.\(\)\) \|\| \[\];/);
    assert.match(composer, /getTeams: briefable,\n\s+onBrief: \(team\) => cb\.onBrief\?\.\(team\),/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /onBrief: \(team, ask, typed\) => openBriefNow\(team \? \{ team, \.\.\.\(ask \? \{ ask \} : \{\}\) \} : \{\}, typed \|\| ""\),\n {2}canBrief: \(\) => !unbriefable\(sessionChat\(\)\),/);
    // (fails before: yes — found by the Bug Hunter, 10-19) A team's own chat briefs no team: its main chat does.
    // Settings › Experimental's Teams switch off: no Brief opens, saying where to turn them on.
    assert.match(app, /function unbriefable\(chat\) \{\n {2}if \(!teamsOn\(state\.config\)\) return TEAMS_OFF;\n {2}if \(!chat\?\.chainId\) return "A team works with a chat: send this chat's first message, then brief a team";\n {2}if \(besideStore\.main\(\) \|\| besideStore\.knownChat\(String\(chat\.chainId\)\)\) return "This is a team's own chat: brief a team from its main chat";\n {2}return null;\n\}/);
    assert.match(app, /function openBriefNow\(fill = \{\}, typed = ""\) \{\n {2}const chat = sessionChat\(\);\n {2}const why = unbriefable\(chat\);/);
  });
});
