// @ts-check
// A team in charge, visible (team_v2_plan §10 O4, the mock of 10-19; U13 W3): the band at the top of the chat —
// "<team> is running this chat · its workers are on the Agents tab" and Back to your agent, greyed with its reason while a
// switch must wait — what Back to your agent costs, once, in words, the gold frame round the team in charge and its
// lead, and the page's wiring.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChargeBand } from "../src/ui/harness/conversation/in-charge.js";
import { createTeamView } from "../src/ui/harness/views/team.js";
import { backCostWords } from "../src/ui/harness/lib/brief.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamIO } from "./helpers/team-view.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);

// Builders, the one shipped team that builds (the plan's p6).
const TEAMS = [
  { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, lead: { tag: "buildlead", name: "Builders" },
    members: [{ tag: "builder", name: "Builder", may: "edit", place: "builder" }, { tag: "tester", name: "Tester", may: "edit", place: "tester" }] },
];
/** A chat Builders leads — or, with `team: null`, your agent's. @param {{ team?: string | null, problem?: string }} [o] */
const chatOf = ({ team = "builders", problem } = {}) => ({
  chainId: "c1",
  turns: [],
  live: null,
  view: { settings: { engine: /** @type {any} */ ({ mode: team ? "team" : "model", team, teams: TEAMS, ...(problem ? { problem } : {}) }), effective: { engine: {} }, flat: {}, usage: { usd: 0.5 } } },
});

describe("a team in charge, visible", () => {
  // (fails before: yes — the header said nothing of who leads; U13 W3: a small gold capsule in the header said it)
  test("the band: hidden while your agent leads; who runs the chat, its workers on the Agents tab, Back to your agent through the sheet", () => {
    /** @type {any[][]} */
    const calls = [];
    let wait = /** @type {string | null} */ (null);
    const io = { open: () => calls.push(["open"]), back: () => calls.push(["back"]), wait: () => wait };
    const c = createChargeBand(io, { h: fakeH });
    c.paint(chatOf({ team: null }));
    assert.equal(c.el.classList.contains("hidden"), true, "your agent leads: nothing");
    c.paint(null);
    assert.equal(c.el.classList.contains("hidden"), true, "no chat: nothing");
    c.paint(chatOf());
    assert.deepEqual([c.el.classList.contains("hidden"), c.el.attrs.role, c.el.attrs["aria-label"], textOf(c.el)],
      [false, "region", "Who runs this chat", "Builders is running this chat|·|its workers are on the Agents tab|Back to your agent"]);
    // (fails before: yes — the rework of 11-11: the band and its tip said crew of the agents the page calls workers)
    assert.equal(/** @type {any} */ (btn(c.el, "its workers are on the Agents tab")).attrs.title, "The team in charge on the Agents tab: its lead, its workers at work, its plan");
    const face = one(c.el, "ich-face");
    assert.deepEqual([face.attrs.class, one(face, "pf-crown").attrs.html], ["pf s24 t-orange ich-face", ICONS.crown], "its team's portrait in its team's look, crowned");
    assert.equal(one(c.el, "ich-who").attrs.title, "Builders answers your messages, Builder, Tester under it");
    /** @type {any} */ (btn(c.el, "its workers are on the Agents tab")).dispatch("click");
    /** @type {any} */ (btn(c.el, "Back to your agent")).dispatch("click");
    assert.deepEqual(calls, [["open"], ["back"]], "the Agents tab; the switch's sheet (the host's)");
    // A switch must wait: Back to your agent stands, greyed, its reason on its tip — a press does nothing.
    const back = /** @type {any} */ (btn(c.el, "Back to your agent"));
    wait = "A turn is running: switch once it ends";
    c.paint(chatOf());
    assert.deepEqual([back.attrs.disabled, back.attrs["aria-disabled"], back.attrs.title], ["", "true", "A turn is running: switch once it ends"]);
    back.dispatch("click");
    assert.equal(calls.filter((x) => x[0] === "back").length, 1);
    wait = null;
    c.paint(chatOf());
    assert.deepEqual(["disabled" in back.attrs, back.attrs["aria-disabled"], back.attrs.title], [false, "false", "Your own agent answers from your next message; the whole conversation stays"]);
    // A team that cannot lead now says why, in orange.
    c.paint(chatOf({ problem: "this session switched the agent tool off" }));
    assert.deepEqual([c.el.classList.contains("is-problem"), textOf(one(c.el, "ich-who")), one(c.el, "ich-who").attrs.title],
      [true, "Builders cannot run this chat now", "This session switched the agent tool off: its turns go to the model meanwhile"]);
    // A key no team holds (the plan's p6: Builders does Architect's work) is said as it is, with the server's words.
    const gone = "engine.team names `architect`, which is no team — Builders does Architect's work: pick Builders (/team lists them)";
    c.paint(chatOf({ team: "architect", problem: gone }));
    assert.deepEqual([textOf(one(c.el, "ich-who")), one(c.el, "ich-who").attrs.title], ["architect cannot run this chat now", `E${gone.slice(1)}: its turns go to the model meanwhile`]);
    // (fails before: yes — found by the Bug Hunter, 10-19) A team's own chat keeps its team: no Back to your agent there.
    let own = true;
    const t = createChargeBand({ ...io, own: () => own }, { h: fakeH });
    t.paint(chatOf());
    assert.deepEqual([t.el.classList.contains("hidden"), one(t.el, "ich-back").classList.contains("hidden")], [false, true]);
    own = false;
    t.paint(chatOf());
    assert.equal(one(t.el, "ich-back").classList.contains("hidden"), false);
  });

  // (fails before: yes — the owner's of 11-01: buttons blinking under a resting pointer, clicks lost — the band's face
  // was made anew at every view of the chat)
  test("the band's face stays through the chat's paints, and changes with the team that leads", () => {
    const io = { open: () => {}, back: () => {}, wait: () => null };
    const c = createChargeBand(io, { h: fakeH });
    c.paint(chatOf());
    const face = one(c.el, "ich-face");
    const glyph = face.kids[0];
    c.paint(chatOf());
    c.paint(chatOf());
    assert.equal(one(c.el, "ich-face").kids[0], glyph, "the glyph that stood");
    c.paint(chatOf({ team: "gone" }));
    assert.notEqual(one(c.el, "ich-face").kids[0], glyph, "another team's face");
  });

  // (fails before: yes — the cost of going back was said only on the switch's sheet)
  test("what Back to your agent costs, in words: its size, its price where known", () => {
    assert.deepEqual([backCostWords(null), backCostWords({ tokens: 0, usd: 1 })], [null, null], "unknown: nothing said");
    assert.equal(backCostWords({ tokens: 91_400, usd: 0.5129 }), "≈91k tokens cached again, once (≈$0.51)");
    assert.equal(backCostWords({ tokens: 91_400, usd: null }), "≈91k tokens cached again, once", "no price card: the size alone");
    assert.equal(backCostWords({ tokens: 800, usd: 0.0007 }), "≈800 tokens cached again, once (under $0.01)");
    assert.equal(backCostWords({ tokens: 1_250_000, usd: 4 }), "≈1.3M tokens cached again, once (≈$4.00)");
  });

  // (fails before: yes — the head, the lead and Back to your agent stood apart, Back to your agent among the switches)
  test("the Teams tab: the team and its lead in one gold frame — the crowned portrait, In charge of this chat, Back to your agent with its cost at the foot", () => {
    const io = teamIO({ backCost: () => ({ tokens: 91_400, usd: 0.5129 }) });
    const view = createTeamView(io, { h: fakeH, place, drawIn: fakeDrawIn, later: () => {} });
    view.paint(chatOf());
    const frame = one(view.el, "tv-charge");
    assert.ok(frame, "the frame");
    assert.deepEqual(frame.kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["tv-head", "ag-card", "tv-follow", "tv-back"], "its head, its lead, how the lead follows its workers, Back to your agent");
    assert.equal(view.el.kids[0], frame, "first on the tab");
    const tile = one(frame, "pf");
    assert.deepEqual([tile.attrs.class.split(" ").includes("ring-gold"), one(tile, "pf-crown").attrs.html], [true, ICONS.crown]);
    assert.equal(textOf(one(frame, "tv-title")), "Builders|In charge of this chat");
    assert.equal(textOf(one(frame, "tv-back")), "Back to your agent|≈91k tokens cached again, once (≈$0.51)");
    assert.deepEqual([btn(one(frame, "tv-head"), "Back to your agent"), btn(one(frame, "tv-follow"), "Back to your agent")], [undefined, undefined], "not in the head, nor among the switches");
    /** @type {any} */ (btn(one(frame, "tv-back"), "Back to your agent")).dispatch("click");
    assert.deepEqual(io.calls.at(-1), ["back"]);
    // The cost not known yet: the button alone.
    const quiet = createTeamView(teamIO({ backCost: () => null }), { h: fakeH, place, drawIn: fakeDrawIn, later: () => {} });
    quiet.paint(chatOf());
    assert.equal(textOf(one(quiet.el, "tv-back")), "Back to your agent");
  });

  // (fails before: yes — nothing mounted it, and the box said "Message the lead" whoever led)
  test("the page's wiring: the band first in the chat's frame, painted with the dock; the box names the team's lead; the tab's cost from the switch's figures", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /const chargeBand = createChargeBand\(\{\n\s+open: \(\) => views\.show\("team"\),\n\s+back: \(\) => confirmSwitch\(sessionChat\(\)\),\n\s+wait: \(chat\) => switchWait\(chat, subagentStore\.rows\(\)\),\n\s+own: \(\) => !!besideStore\.main\(\),\n\}\);\nshell\.convFrame\.prepend\(chargeBand\.el\);\n/);
    assert.match(app, /composer\.setTeam\(\{ lead: !!team && !team\.problem, name: team\?\.name \|\| "" \}\);/);
    // (fails before: yes — the 9 plausible of 10-19: Back to your agent greyed only at the next repaint of something
    // else) Painted as a turn starts, at each drawn frame of its run, and as it ends.
    assert.match(app, /function nowIn\(chat\) \{\n[\s\S]{0,400}?chargeBand\.paint\(chat\);\n(?:\s+(?:\/\/[^\n]*|paintBrowserLine\(\);)\n)*\}/);
    assert.equal(app.match(/chat\.live = live;\n(?:\s+(?:\/\/[^\n]*|live\.chat = chat;)\n)*\s+transcript\.startLive\(live\);\n(?:.*\n){0,2}?\s+nowIn\(chat\);/g)?.length, 2, "both ways a turn starts");
    assert.match(app, /const held = c \? windowFace\(c\.view, composer\.live\(\)\)\.tokens : 0;\n\s+if \(!\(held > 0\)\) return null;\n\s+const cost = rebuildCost\(held, /, "as the switch's sheet counts it");
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /: lead \? `Tell \$\{theLead\(\)\}`\n/);
    const css = readFileSync("src/ui/harness/views/teams.css", "utf8");
    assert.match(css, /\.ich-band \{ flex: none; [^}]*border-bottom: 1px solid color-mix\(in oklab, var\(--color-sys-yellow\) 30%, transparent\);/, "the theme's gold, light or dark");
    assert.match(css, /\.ich-band\.hidden, \.conv-frame\.side-team > \.ich-band \{ display: none; \}/, "it gives way to the pane of the team in charge");
  });

  // (fails before: yes — the sheet kept a second half that handed the chat to a team, with a title, a row and a button
  // of its own, which no caller reached: a team takes a chat from its Brief, `handOver`)
  test("the sheet that confirms a switch gives the chat back, and that alone: every caller asks for that, and it has no words for a team", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.deepEqual((app.match(/\bconfirmSwitch\([^\n]*/g) || []).map((line) => line.replace(/\)[,;]?$/, ")").replace(/ \{$/, "")).sort(),
      ["confirmSwitch(chat)", "confirmSwitch(sessionChat())", "confirmSwitch(sessionChat())", "confirmSwitch(sessionChat())"]);
    const sheet = app.slice(app.indexOf("function confirmSwitch("), app.indexOf("// The widgets (HarnessV3 Step 4 D8)"));
    assert.ok(sheet.length > 200 && sheet.length < 3000, "the sheet's source, found");
    assert.doesNotMatch(sheet, /\bteam(\.| \?)|, team\b/, "no team handed to it");
    assert.match(sheet, /title: "Back to your agent\?",/);
    for (const gone of ["Hand this session to", "Hand it over", "team leads from your next message", "Team workers run on"]) assert.equal(app.includes(gone), false, gone);
  });
});
