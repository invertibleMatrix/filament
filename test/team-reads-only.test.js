// @ts-check
// A team that changes no file, in charge of a chat (tm-ro; seen 11-11 with BugHunters leading a chat on Edit
// automatically): the server holds each turn it leads to reading whatever the chat's permission mode says, and the
// composer's mode chip said "Edit automatically" all the while — a permission the chat did not have. The page is told
// which teams change no file by the settings answer's teams (core/roster.js `teamRow`: `readOnly`); one helper reads
// it of the team in charge (lib/team.js `readingTeam`), and the mode chip, its menu and Overview's What it may do say
// the mode in force — live, as the chat is handed over and handed back, painted with the band (app.js `paintDock`).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The new exports are read through the module's namespace, so the file loads on the code before them and each test
// fails on its own there.
import * as team from "../src/ui/harness/lib/team.js";
import { MODES, createModeSwitch } from "../src/ui/harness/composer/mode.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { mayWidget } from "../src/ui/harness/widgets/overview-setup.js";
import { featureTile } from "../src/ui/harness/widgets/frame.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { teamRow } from "../src/core/roster.js";
import { teamStore } from "./helpers/team.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";

/** The teams as a chat's settings answer lists them (app/sessions/service.js `engineOf`): the shipped two. */
const TEAMS = teamStore().list().map(teamRow);
/**
 * A chat's `engine`, as its settings answer says it: `key` in charge — null: your agent answers.
 * @param {string | null} key @param {{ problem?: string }} [o]
 */
const engineOf = (key, o = {}) => ({ mode: key ? "team" : "agent", team: key, teams: TEAMS, problem: o.problem || null });
/** A chat's settings on a mode of its own, `key` in charge. @param {string} mode @param {string | null} key */
const settingsOf = (mode, key) => ({
  effective: { loop: { permissions: mode }, model: { name: "m-1" } },
  flat: { "loop.permissions": mode, "model.name": "m-1" },
  sources: { "loop.permissions": "session" },
  engine: engineOf(key),
});

/** What the chip and its menu say while BugHunters is in charge of a chat on `mode`. @param {string} mode */
const HELD = (mode) => `BugHunters changes no file: while it is in charge this chat only reads, whatever its mode (${mode}). Back to your agent gives the chat its mode back.`;
const READ_ONLY = /** @type {typeof MODES[number]} */ (MODES.find((m) => m.id === "read-only"));
const EDIT = /** @type {typeof MODES[number]} */ (MODES.find((m) => m.id === "edit"));

/** A mode switch on the recording `h`, its menus and its picks kept. */
const switchOf = () => {
  /** @type {any[][]} */
  const menus = [];
  /** @type {string[]} */
  const picks = [];
  const sw = /** @type {any} */ (createModeSwitch({ onChange: (id) => picks.push(id) }, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }) }));
  const chip = /** @type {any} */ (sw.el);
  /** The chip's face: its words, its glyph, its tone, the mode it wears, whether it is red, its tip. */
  const face = () => ({ words: textOf(chip.querySelector(".mode-label")), icon: chip.querySelector(".mode-ic").attrs.html, tone: chip.style["--tone"], mode: chip.attrs["data-mode"], warn: chip.classList.contains("warn"), tip: chip.title });
  /** The menu, opened: its rows as they read. */
  const open = () => {
    chip.dispatch("click");
    return (menus.at(-1) || []).map((i) => (i.type === "node" ? { node: textOf(i.node), cls: i.node.attrs.class } : i.type === "radio" ? { radio: i.label, checked: i.checked, ...(i.disabled ? { disabled: true } : {}) } : { [i.type || "item"]: i.label || "" }));
  };
  return { sw, chip, menus, picks, face, open };
};

describe("a team that changes no file, in charge: the page says the chat only reads (tm-ro)", () => {
  // (fails before: yes — `team.readingTeam is not a function`: nothing on the page read a team's `readOnly` of the team in
  // charge; lib/team.js `teamOf` drops it)
  test("the page is told by the settings answer's teams, and one helper says whether the team in charge changes no file", () => {
    assert.deepEqual(TEAMS.map((t) => [t.key, t.readOnly]).sort(), [["bughunters", true], ["builders", false]], "each team's row says whether it changes no file");
    // What carries it: the chat's settings answer lists the teams as rows (a guard: both stood before).
    assert.match(readFileSync("src/app/sessions/service.js", "utf8"), /\n {6}teams: \(teams\?\.list\(\) \|\| \[\]\)\.map\(teamRow\),\n/);
    assert.match(readFileSync("src/core/roster.js", "utf8"), /\n {2}readOnly: t\.readOnly === true,\n/);
    const hunters = team.readingTeam(engineOf("bughunters"));
    assert.deepEqual(hunters, team.leadingTeam(engineOf("bughunters")), "BugHunters in charge: the team, as the band names it");
    assert.equal(hunters?.name, "BugHunters");
    assert.equal(team.readingTeam(engineOf("builders")), null, "a team that writes holds nothing");
    assert.equal(team.readingTeam(engineOf(null)), null, "your agent answers");
    assert.equal(team.readingTeam({ ...engineOf("bughunters"), mode: "agent" }), null, "handed back: the team's key may stay, the mode says who answers");
    assert.equal(team.readingTeam(engineOf("bughunters", { problem: "this session switched the agent tool off" })), null, "a team that cannot lead: its turns go to the model, under the chat's own mode");
    assert.equal(team.readingTeam({ mode: "team", team: "gone", teams: TEAMS }), null, "a key no team has");
    assert.equal(team.readingTeam({ mode: "team", team: "bughunters" }), null, "no list read yet: nothing is claimed");
    assert.deepEqual([team.readingTeam(null), team.readingTeam(undefined)], [null, null], "no settings read yet");
  });

  // (fails before: yes — `team.readsOnlyWords is not a function`)
  test("the words: why the chat only reads, naming the team and the chat's own mode; in a team's own chat with no Back to your agent; and the fact in a few words", () => {
    assert.equal(team.readsOnlyWords("BugHunters", "Edit automatically"), HELD("Edit automatically"));
    assert.equal(team.readsOnlyWords("BugHunters", "Full access", true), "BugHunters changes no file: its own chat only reads, whatever its mode (Full access).");
    assert.equal(team.readsOnlyLine("BugHunters"), "only reads while BugHunters is in charge");
  });

  // (fails before: yes — `sw.setReading is not a function`: the chip knew the chat's mode alone)
  test("the mode chip reads Read-only, in read-only's glyph and tone, and its tip says why; its menu says so at its head and still sets the chat's own mode", () => {
    const { sw, face, open } = switchOf();
    sw.set("edit");
    sw.setNote("this session");
    const own = face();
    assert.deepEqual(own, { words: "Edit automatically", icon: ICONS[EDIT.icon], tone: EDIT.tone, mode: "edit", warn: false, tip: `Edit automatically: ${EDIT.desc} (this session)` });
    const ownMenu = open();
    sw.setReading({ name: "BugHunters" });
    assert.deepEqual(face(), { words: "Read-only", icon: ICONS[READ_ONLY.icon], tone: READ_ONLY.tone, mode: "read-only", warn: false, tip: HELD("Edit automatically") }, "the mode in force, and why");
    assert.equal(sw.mode(), "edit", "the chat's own mode stands: a send and a create call read it");
    // The menu: one quiet line at its head, the same sentence; then every row it had, the chat's own mode ticked.
    const menu = open();
    assert.deepEqual(menu[0], { label: "What the agent may do" });
    assert.deepEqual(menu[1], { node: HELD("Edit automatically"), cls: "model-inforce" }, "the quiet line, in the look of the line that says where a mode comes from");
    assert.deepEqual([...menu.slice(0, 1), ...menu.slice(2)], ownMenu, "nothing else moved: no row gone, none disabled");
    assert.deepEqual(menu.filter((r) => "radio" in r), MODES.map((m) => ({ radio: m.label, checked: m.id === "edit" })), "the chosen mode keeps its tick");
  });

  // (fails before: yes — `sw.setReading is not a function`)
  test("a pick under it is the chat's own: the chip stays Read-only, never red, and its tip names the mode picked; handed back, the chip is the chat's again", () => {
    const { sw, menus, face, open, picks } = switchOf();
    sw.set("edit");
    sw.setReading({ name: "BugHunters" });
    sw.setLive(true);
    open();
    menus.at(-1)?.find((i) => i.label === "Full access")?.onClick();
    assert.deepEqual(picks, ["auto"], "written as the chat's mode");
    assert.equal(sw.mode(), "auto");
    assert.deepEqual(face(), { words: "Read-only", icon: ICONS[READ_ONLY.icon], tone: READ_ONLY.tone, mode: "read-only", warn: false, tip: HELD("Full access") }, "a turn runs under Full access, held to reading: no red");
    assert.deepEqual(open().filter((r) => "radio" in r).find((r) => r.checked), { radio: "Full access", checked: true }, "the chosen mode keeps its tick");
    // The shortcut that steps through the modes steps the chat's own too.
    sw.cycle();
    assert.deepEqual([sw.mode(), face().words, face().tip], ["read-only", "Read-only", HELD("Read-only")]);
    sw.set("auto");
    // Back to your agent: the chat has its mode back, red while its turn runs.
    sw.setReading(null);
    const auto = /** @type {typeof MODES[number]} */ (MODES.find((m) => m.id === "auto"));
    assert.deepEqual(face(), { words: "Full access", icon: ICONS[auto.icon], tone: auto.tone, mode: "auto", warn: true, tip: `Full access: ${auto.desc}` });
    assert.equal(open().some((r) => "node" in r), false, "no line at the menu's head");
    // A team's own chat has no agent to hand it back to.
    sw.setReading({ name: "BugHunters", own: true });
    assert.equal(face().tip, "BugHunters changes no file: its own chat only reads, whatever its mode (Full access).");
    assert.deepEqual(open()[1], { node: "BugHunters changes no file: its own chat only reads, whatever its mode (Full access).", cls: "model-inforce" });
  });

  describe("on the page", () => {
    const g = /** @type {any} */ (globalThis);
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
      g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    });
    after(() => {
      delete g.localStorage;
      doc.restore();
    });

    // (fails before: yes — the chip read "Edit automatically" with BugHunters in charge: `paintDock` told the composer who
    // answers and nothing of what its team may do)
    test("live: painted with the band, the chip turns to Read-only as BugHunters takes the chat over and back as it is handed back; Builders in charge, or no team, leaves it as it is", () => {
      const host = /** @type {any} */ (doc.document.createElement("div"));
      /** @type {any} */
      const chat = { id: "c1", chainId: "s1", turns: [], live: null, view: { settings: settingsOf("edit", null) } };
      const composer = createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => chat });
      /** The main chat's id, where the chat shown is a team's own. @type {string | null} */
      let main = null;
      const fns = lift(["paintDock"], {
        chatOf: () => chat,
        state: { currentId: "c1" },
        leadingTeam: team.leadingTeam,
        readingTeam: team.readingTeam,
        composer,
        besideStore: { main: () => main },
        subagentStore: { rows: () => [] },
        views: { view: "chat" },
      });
      const chip = host.querySelector(".mode-chip");
      /** The chat's settings land, as the page's listener to its view takes them: the composer's faces, then the dock. @param {string} mode @param {string | null} key */
      const lands = (mode, key) => {
        chat.view = { settings: settingsOf(mode, key) };
        composer.setSessionView(chat.view, true);
        fns.paintDock();
        return [chip.querySelector(".mode-label").textContent, chip.getAttribute("data-mode"), chip.title];
      };
      const own = lands("edit", null);
      assert.deepEqual(own, ["Edit automatically", "edit", `Edit automatically: ${EDIT.desc} (this session)`]);
      const label = chip.querySelector(".mode-label");
      assert.deepEqual(lands("edit", "bughunters"), ["Read-only", "read-only", HELD("Edit automatically")], "/team bughunters, or its Brief's Send in charge");
      assert.equal(chip.querySelector(".mode-label"), label, "drawn in place: the element under a resting pointer stands");
      assert.equal(composer.permissionMode(), "edit", "the chat's own mode is what the composer still answers");
      assert.deepEqual(lands("ask", "bughunters"), ["Read-only", "read-only", HELD("Ask before changes")], "the chat's mode changed under it");
      assert.deepEqual(lands("edit", "builders"), own, "Builders writes: the chip is the chat's");
      assert.deepEqual(lands("edit", "bughunters").slice(0, 2), ["Read-only", "read-only"]);
      assert.deepEqual(lands("edit", null), own, "Back to your agent, or /team off");
      // A team's own chat, beside its main chat: no Back to your agent to name.
      main = "s0";
      assert.equal(lands("edit", "bughunters")[2], "BugHunters changes no file: its own chat only reads, whatever its mode (Edit automatically).");
      // The wiring (a guard): the chat's view lands on the composer's faces and the dock at once, and a chat shown paints both.
      const app = readFileSync("src/ui/harness/app.js", "utf8");
      assert.match(app, /onSessionView\(chat, \(\) => \{ if \(chatOf\(state\.currentId\) === chat\) \{ composer\.setSessionView\(chat\.view, !!chat\.chainId\);[^\n]*\bpaintDock\(\);/);
      assert.match(app, /\n {2}composer\.setSessionView\(chat\.view \|\| null, !!chat\.chainId\);\n(?:.*\n){1,6}? {2}paintDock\(\);\n/);
    });
  });

  // (fails before: yes — the tile said "Edit automatically" with no word of the team: its quiet line was empty)
  test("Overview's What it may do says the chat's mode with the fact beside it: under its title, and in what its press is called", () => {
    /** @param {string | null} key */
    const tileOf = (key) => {
      const view = { settings: settingsOf("edit", key) };
      /** @type {any} */
      const ctx = { view: () => view, live: () => ({ streaming: false }), write: () => {}, openSetup: () => {}, accounts: { session: () => null } };
      const spec = mayWidget(ctx);
      const tile = /** @type {any} */ (featureTile(spec, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn }, { size: "M" }).el);
      return { state: spec.state(), sub: textOf(tile.querySelector(".ov-tile-sub")), press: tile.querySelector(".ov-tile-open").attrs["aria-label"], row: textOf(tile.querySelector(".ov-set")) };
    };
    assert.deepEqual(tileOf("bughunters"), {
      state: "Edit automatically · only reads while BugHunters is in charge",
      sub: "only reads while BugHunters is in charge",
      press: "What it may do: Edit automatically · only reads while BugHunters is in charge — change it",
      row: "Permission|Edit automatically|this chat",
    });
    const plain = { state: "Edit automatically", sub: "", press: "What it may do: Edit automatically — change it", row: "Permission|Edit automatically|this chat" };
    assert.deepEqual(tileOf("builders"), plain, "a team that writes: as it was");
    assert.deepEqual(tileOf(null), plain, "your agent: as it was");
  });

  // (fails before: yes — the guide said the chip shows the chat's mode, and of a team that changes no file only that it
  // reads)
  test("the guide says it where it describes the chip and where it describes a team that changes no file", () => {
    const guide = readFileSync("docs/GUIDE.md", "utf8").replace(/\s+/g, " ");
    for (const said of [
      "While a team that changes no file is in charge of the chat (BugHunters), the chip reads *Read-only* whatever the chat's mode",
      "its menu says the same in a line at its head and still sets the chat's own mode — the one your agent has again after **Back to your agent**",
      "Overview's *What it may do* says *only reads while BugHunters is in charge* under its title",
      "whatever this chat's permission mode says, until **Back to your agent**: the chip beside the model reads *Read-only* meanwhile",
    ]) assert.ok(guide.includes(said), `the guide says: ${said}`);
  });
});

// The owner asked whether such a team should be allowed in charge at all (d-side, 11-12): it stays possible, it is
// never the default, and where a person picks it the page says what it means before the send. The rule and the one
// sentence are here; each place that says it is pinned where that place is (brief, teams-page, live-work,
// new-task-board, harness-side).
describe("a team that changes no file, before it is put in charge: one rule and one sentence (d-side)", () => {
  /** A team of the person's own whose one worker only reads, as its row reaches the page. */
  const READERS = teamRow(teamStore().create({ name: "Readers", lead: "product", members: [{ tag: "reviewer" }] }));

  // (fails before: yes — `team.readsOnly is not a function`: `readingTeam` read `readOnly` of the team in charge alone,
  // and nothing asked it of a team a person is about to put in charge)
  test("the rule: a team's row says whether the server holds it to reading — its `readOnly`, never what its workers may do — and the team in charge is found by the same rule", () => {
    assert.deepEqual([...TEAMS, READERS].map((t) => [t.key, team.readsOnly(t)]).sort(), [["bughunters", true], ["builders", false], ["readers", false]]);
    assert.deepEqual([READERS.readOnly, READERS.members.map((m) => m.may)], [false, ["read"]], "its workers all read, and nothing holds its lead: in charge it has its own hands, under the chat's mode");
    assert.deepEqual([team.readsOnly(null), team.readsOnly(undefined), team.readsOnly({ key: "x" }), team.readsOnly({ key: "x", readOnly: "yes" })], [false, false, false, false]);
    // What the server holds by (a guard: it stood before): the team's `readOnly`, as the page's rule reads it.
    assert.match(readFileSync("src/app/agent/turn.js", "utf8"), /header: leadTeam\?\.readOnly \? "read-only" : inboundHeaders\["x-filament-permissions"\]/);
    assert.match(readFileSync("src/ui/harness/lib/team.js", "utf8"), /\.some\(\(\/\*\* @type \{any\} \*\/ x\) => x\.key === team\.key && readsOnly\(x\)\) \? team : null;/, "one rule: `readingTeam` reads it");
    assert.equal(team.readingTeam({ mode: "team", team: "readers", teams: [...TEAMS, READERS] }), null, "Readers in charge: the chip stays the chat's");
  });

  // (fails before: yes — `team.readsOnlyAhead is not a function`: the fact was said once the team led — the chip, its
  // menu, Overview — and nowhere before the hand-over)
  test("the sentence: what In charge means for it, said before the send — alone, or ending the sentence that says who answers", () => {
    assert.equal(team.readsOnlyAhead("BugHunters"), "The chat only reads while it is in charge, whatever its mode: BugHunters changes no file.");
    assert.equal(team.readsOnlyAhead("BugHunters", "Its lead takes your agent's place in this chat"),
      "Its lead takes your agent's place in this chat, and the chat only reads while it is in charge, whatever its mode: BugHunters changes no file.");
    // Kept once: every place that says it reads it from lib/team.js, none writes it again.
    for (const file of ["src/ui/harness/lib/brief.js", "src/ui/harness/views/brief.js", "src/ui/harness/widgets/hand.js", "src/ui/harness/conversation/start-board.js", "src/ui/harness/views/side.js", "src/ui/harness/library/teams.js"])
      assert.doesNotMatch(readFileSync(file, "utf8"), /only reads while it is in charge/, `${file} holds no copy of the words`);
    for (const [file, reads] of /** @type {const} */ ([["src/ui/harness/lib/brief.js", "readsOnlyAhead"], ["src/ui/harness/widgets/hand.js", "readsOnlyAhead"], ["src/ui/harness/conversation/start-board.js", "readsOnlyAhead"], ["src/ui/harness/views/brief.js", "chargeWords"], ["src/ui/harness/views/side.js", "chargeWords"]]))
      assert.ok(readFileSync(file, "utf8").includes(`${reads}(`), `${file} reads ${reads}`);
  });

  // (fails before: yes — the guide said the Library card's foot holds `/team builders` of every team, that the Brief
  // picks a team's usual way and nothing of what In charge means for one that changes no file)
  test("the guide says it: the Library card's foot by the team's usual way, and what In charge says of such a team before Send, in the Brief and at its other doors", () => {
    const guide = readFileSync("docs/GUIDE.md", "utf8").replace(/\s+/g, " ");
    for (const said of [
      "`/team builders` for a team that builds, which puts it in charge, and `@bughunters` for one that looks and checks, which opens its Brief on the side",
      "A team that changes no file is never sent in charge unless you pick it",
      "*…and the chat only reads while it is in charge, whatever its mode: BugHunters changes no file.*",
      "*It changes no file: its lead and its workers only read here.*",
      "says the same before the press",
    ]) assert.ok(guide.includes(said), `the guide says: ${said}`);
  });
});
