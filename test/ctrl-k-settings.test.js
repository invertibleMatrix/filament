// @ts-check
// The design pass of 10-24, UX7 (vault HarnessV4_DesignPass_Plan §4e): the box's `/` draws its commands in groups —
// Everyday, Make room with its six each saying how it differs, then the catalogue's own groups — every command once and
// typed as before; and Ctrl+K reads a setting in what is typed ("line 70", "ask", "max", "1m", "sonnet", "mem off",
// "may hunter") as a row that changes it for this chat, saying where it stands and what the change does, or a line
// saying why not. Pure parts here; the wiring in app.js and the composer is pinned by its words.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settingIntents, settingRows, settingExamples, NOT_STARTED } from "../src/ui/harness/lib/setting-intents.js";
import { settingsPart } from "../src/ui/harness/command-center.js";
import { commandRows, typedOf } from "../src/ui/harness/composer/slash.js";
import { commandCatalog } from "../src/app/commands/registry.js";
import { chatCommandOf } from "../src/app/commands/recognize.js";
import { createEffortControl } from "../src/ui/harness/composer/effort.js";
import { stubDocument } from "./helpers/dom-stub.js";

/** A started chat on Claude Opus 5.5, as app.js `settingFacts` reads one. @param {Record<string, any>} [o] @returns {import("../src/ui/harness/lib/setting-intents.js").SettingFacts} */
const facts = (o = {}) => ({
  chat: true,
  client: false,
  line: { percent: 85, window: 200_000 },
  permission: "edit",
  effort: { levels: ["low", "medium", "high", "xhigh", "max"], now: "high", auto: true },
  window: { options: [200_000, 1_000_000], now: 200_000, standard: 200_000 },
  model: "Claude Opus 5.5",
  modelId: "anthropic/claude-opus-5-5",
  families: [
    { id: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "zai/glm-5.3", name: "GLM 5.3" },
    { id: "minimax/minimax-m2", name: "MiniMax M2" },
  ],
  memory: { on: true, source: "default" },
  may: { tags: ["pm"], cards: [{ tag: "pm", name: "PM" }, { tag: "hunter", name: "Hunter" }, { tag: "helper", name: "Helper" }] },
  mayOff: "",
  ...o,
});
/** The labels of what the words make. @param {string} q @param {any} [f] */
const labels = (q, f = facts()) => settingRows(q, f).rows.map((r) => r.label);
/** @param {string} q @param {any} [f] */
const why = (q, f = facts()) => settingRows(q, f).why;

describe("Ctrl+K reads a setting in what is typed", () => {
  // (fails before: yes — the command center searched actions, chats and files only; nothing typed changed a setting)
  test("the words each setting is typed by, a model's name only where nothing else is read", () => {
    const kinds = (/** @type {string} */ q) => settingIntents(q).map((i) => i.kind);
    assert.deepEqual(kinds("line 70"), ["line", "compact"]);
    assert.deepEqual(kinds("compaction line 70%"), ["line", "compact"]);
    assert.deepEqual(kinds("autocompact 400k"), ["line"]);
    assert.deepEqual(kinds("70%"), ["line"]);
    assert.deepEqual(kinds("compact now"), ["compact"]);
    assert.deepEqual(kinds("1m"), ["window"]);
    assert.deepEqual(kinds("window"), ["window"]);
    assert.deepEqual(kinds("ask"), ["permission"]);
    assert.deepEqual(kinds("full access"), ["permission"]);
    assert.deepEqual(kinds("auto"), ["effort"], "a bare auto is Reasoning's Auto, never Full access");
    assert.deepEqual(settingIntents("permission auto"), [{ kind: "permission", id: "auto" }]);
    assert.deepEqual(kinds("max"), ["effort"], "max is Reasoning, not MiniMax");
    assert.deepEqual(kinds("model max"), ["model"]);
    assert.deepEqual(kinds("mem off"), ["memory"]);
    assert.deepEqual(settingIntents("may not @hunter"), [{ kind: "may", word: "hunter", off: true }]);
    assert.deepEqual(settingIntents("sonnet"), [{ kind: "model", words: "sonnet", said: false }]);
    assert.deepEqual(settingIntents("  "), []);
    assert.deepEqual(settingIntents("go"), [], "two letters guess no model");
  });

  test("the compaction line: its row says where it stands and what it becomes; Compact now… opens the card", () => {
    const { rows } = settingRows("line 70", facts());
    assert.deepEqual(rows.map((r) => [r.label, r.now, r.effect]), [
      ["Compaction line → 70%", "now 85% · 170K → 140K", "It makes room as it nears 140K tokens"],
      ["Compact now…", "opens its card first", ""],
    ]);
    assert.deepEqual(rows[0].change, { write: { patch: { context: { compaction: { thresholdPercent: 70 } } } } });
    assert.deepEqual(rows[1].change, { summon: true });
    // (fails before: yes — the owner's rules of 10-31: a line set low carried a target under it, which no compaction aims for now)
    assert.deepEqual(settingRows("line 30", facts()).rows[0].change, { write: { patch: { context: { compaction: { thresholdPercent: 30 } } } } });
    assert.equal(labels("line 400k")[0], "Compaction line → 95%", "tokens past the band: the band's top");
    assert.equal(labels("line 5")[0], "Compaction line → 15%", "under the band: its bottom");
    assert.deepEqual(labels("line"), ["Compaction line → 50%", "Compaction line → 70%", "Compaction line → 95%", "Compact now…"], "the stops other than the one in force");
    assert.deepEqual(why("line 85"), ["The line is at 85% already"]);
    assert.match(why("line soon")[0], /^A line is a share of the window, 15% to 95%/);
    assert.equal(settingRows("line 70", facts({ line: { percent: 85, window: null } })).rows[0].now, "now 85%", "no window: the share alone");
    assert.deepEqual(settingRows("line 70", facts({ client: true })), { rows: [], why: ["Another app compacts this chat by itself: its line is its own"] });
  });

  test("the window, the permission and the reasoning, as their own controls offer them", () => {
    const win = settingRows("1m", facts()).rows;
    assert.deepEqual(win.map((r) => [r.label, r.now]), [["Window → 1M", "now 200K"]]);
    assert.deepEqual(win[0].change, { tune: "window", value: 1_000_000 });
    assert.deepEqual(why("2m"), ["Claude Opus 5.5 offers 200K or 1M"]);
    assert.deepEqual(why("window 200k"), ["The window is 200K already"]);
    assert.deepEqual(why("1m", facts({ window: null })), ["Claude Opus 5.5 has one window"]);

    const ask = settingRows("ask", facts()).rows;
    assert.deepEqual(ask.map((r) => [r.label, r.now]), [["Permission → Ask before changes", "now Edit automatically"]]);
    assert.deepEqual(ask[0].change, { write: { patch: { loop: { permissions: "ask" } } } });
    assert.match(ask[0].effect, /^Asks before every edit/);
    assert.deepEqual(labels("permission auto"), ["Permission → Full access"]);
    assert.deepEqual(labels("permission"), ["Permission → Read-only", "Permission → Ask before changes", "Permission → Full access"]);
    assert.deepEqual(why("edit"), ["Permission is Edit automatically already"]);

    const max = settingRows("max", facts()).rows;
    assert.deepEqual(max.map((r) => [r.label, r.now, r.effect]), [["Reasoning → Max", "now High", "It thinks harder from the next request: slower, and more tokens"]]);
    assert.deepEqual(max[0].change, { tune: "effort", value: "max" });
    assert.deepEqual(settingRows("auto", facts()).rows[0].change, { tune: "effort", value: null });
    assert.equal(settingRows("low", facts()).rows[0].effect, "It thinks less from the next request: quicker, and fewer tokens");
    assert.deepEqual(why("minimal"), ["Claude Opus 5.5 thinks at Auto, Low, Medium, High, Extra high, Max"]);
    assert.deepEqual(why("high"), ["Reasoning is High already"]);
    assert.deepEqual(labels("reasoning"), ["Reasoning → Auto", "Reasoning → Low", "Reasoning → Medium", "Reasoning → Extra high", "Reasoning → Max"]);
    assert.deepEqual(why("max", facts({ effort: null })), ["Claude Opus 5.5 has no reasoning levels"]);
  });

  test("a model by its name, memory and whom the agent may use", () => {
    const son = settingRows("sonnet", facts()).rows;
    assert.deepEqual(son.map((r) => [r.label, r.now]), [["Model → Claude Sonnet 5.5", "now Claude Opus 5.5"]]);
    assert.deepEqual(son[0].change, { family: "anthropic/claude-sonnet-5-5" });
    assert.deepEqual(labels("claude"), ["Model → Claude Sonnet 5.5"], "the model in force is not offered");
    assert.deepEqual(labels("model max"), ["Model → MiniMax M2"]);
    assert.deepEqual(settingRows("zzz", facts()), { rows: [], why: [] }, "a word that names nothing is no setting: silent");
    assert.deepEqual(why("model zzz"), ["No model is named “zzz”"]);

    const off = settingRows("mem off", facts()).rows[0];
    assert.deepEqual([off.label, off.now, off.change], ["Memory for this chat → off", "now on", { write: { patch: { "memory.enabled": false } } }]);
    const offHere = facts({ memory: { on: false, source: "session" } });
    assert.deepEqual(settingRows("mem on", offHere).rows[0].change, { write: { unset: ["memory.enabled"] } }, "this chat's own off goes");
    assert.deepEqual(settingRows("mem on", facts({ memory: { on: false, source: "project" } })).rows[0].change, { write: { patch: { "memory.enabled": true } } }, "a project's off is beaten by this chat's own on");
    assert.deepEqual(why("mem on", facts({ memory: { on: false, source: "global" } })), ["Memory is off everywhere: the console's switch decides"]);
    assert.deepEqual(why("mem on"), ["Memory is on for this chat already"]);

    const may = settingRows("may hunter", facts()).rows[0];
    assert.deepEqual([may.label, may.now, may.effect, may.change], ["Your agent may use Hunter", "now PM", "It may ask @hunter by itself in this chat", { may: ["pm", "hunter"] }]);
    assert.deepEqual(settingRows("may not pm", facts()).rows[0].change, { may: [] });
    assert.equal(settingRows("may not pm", facts()).rows[0].label, "Your agent may no longer use PM");
    assert.deepEqual(why("may pm"), ["Your agent may use PM already"]);
    assert.deepEqual(why("may not hunter"), ["Hunter is not on its list"]);
    // (fails before: yes — the review of 11-03: its example named PM and Hunter, cards that do not ship)
    assert.deepEqual(why("may zed"), ["No agent is named “zed”: may product, may enduser"]);
    assert.deepEqual(why("may hunter", facts({ mayOff: "Nobody is asked while OpenCode writes this chat's turns" })), ["Nobody is asked while OpenCode writes this chat's turns"]);
  });

  // (fails before: yes — "graph on", "task graph off" and "tasks on" made a row that wrote engine.taskGraph, and Also
  // type offered "graph on"; the owner's words of 10-29: the task graph is always on, and nobody can turn it off)
  test("the task graph has no switch: no words turn it on or off, and Also type offers none", () => {
    for (const q of ["graph on", "graph off", "task graph off", "tasks on"]) {
      assert.ok(!settingIntents(q).some((i) => i.kind !== "model"), `“${q}” reads no setting`);
      assert.deepEqual(settingRows(q, facts()), { rows: [], why: [] }, `“${q}” changes nothing`);
    }
    assert.ok(!settingExamples(facts()).some((e) => /graph|tasks/.test(e.code) || /graph/i.test(e.words)), "no example turns it on or off");
  });

  test("a chat not started: a setting said is told why, a word guessed as a model is not", () => {
    const none = { chat: false };
    assert.deepEqual(settingRows("line 70", none), { rows: [], why: [NOT_STARTED] });
    assert.deepEqual(settingRows("model glm", none), { rows: [], why: [NOT_STARTED] });
    assert.deepEqual(settingRows("sonnet", none), { rows: [], why: [] });
    assert.deepEqual(settingExamples(none), []);
  });

  test("Also type: each example is a press that types words this chat takes", () => {
    const f = facts();
    const ex = settingExamples(f);
    assert.deepEqual(ex.map((e) => e.code), ["line 70", "1m", "ask", "max", "sonnet", "mem off", "may hunter"]);
    for (const e of ex) assert.ok(settingRows(e.code, f).rows.length > 0, `“${e.code}” makes a row`);
    // The loop is always on (the owner's of 11-09): no chat runs on the model alone, so Permission is always one.
    assert.deepEqual(settingExamples(facts({ window: null, effort: null, client: true, may: null })).map((e) => e.code), ["ask", "sonnet", "mem off"]);
  });

  test("the command center's Settings part: in All and Settings only, its examples where nothing else answered", () => {
    const f = facts();
    assert.deepEqual(settingsPart("line 70", "actions", f, 0), { rows: [], why: [], examples: [] });
    assert.equal(settingsPart("line 70", "all", f, 3).rows.length, 2);
    assert.deepEqual(settingsPart("", "all", f, 5).examples, [], "the palette at rest is as it was");
    assert.equal(settingsPart("", "settings", f, 0).examples.length, 7, "the Settings scope shows what to type");
    assert.equal(settingsPart("zzz", "all", f, 0).examples.length, 7, "nothing answered: what else to type");
    assert.deepEqual(settingsPart("zzz", "all", f, 1).examples, [], "an action answered");
    assert.deepEqual(settingsPart("", "settings", { chat: false }, 0).why, [NOT_STARTED]);
    assert.deepEqual(settingsPart("x", "all", null, 0), { rows: [], why: [], examples: [] }, "no facts: no part");
  });

  test("the wiring: the scope, the rows under This chat, the facts and the run in the app, the composer's own paths", () => {
    const cc = readFileSync("src/ui/harness/command-center.js", "utf8");
    assert.match(cc, /\{ id: "actions", label: "Actions" \},\n {2}\{ id: "settings", label: "Settings" \},\n {2}\{ id: "tasks", label: WORDS\.chats \},/);
    assert.match(cc, /rows = \[\.\.\.actions, \.\.\.setRows, \.\.\.taskRows, \.\.\.changeRows, \.\.\.fileRows\];/);
    assert.match(cc, /\.\.\.section\("This chat", setRows\),/);
    // (fails before: yes — seen live) Settings with nothing typed said "No related results" over its examples.
    assert.match(cc, /rows\.length \|\| set\.why\.length \|\| \(set\.examples\.length && !raw\) \? null : h\("div", \{ class: "cc-empty" \}, "No related results"\),/);
    // (fails before: yes — seen live) A chat with no turn yet drew its lifted greeting through the / panel.
    assert.match(readFileSync("src/ui/harness/aqua.css", "utf8"), /\.slash-panel \{[^}]*\n {2}z-index: 10;\n\}/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // A view-only device's page reads none (remote-view-ui.test.js).
    assert.match(app, /const commandCenter = createCommandCenter\(\{\n[^\n]*\n {2}settings: \(\) => \(viewOnlyPage\(\) \? null : settingFacts\(\)\),\n {2}onSetting: \(row\) => \{ void runSetting\(row\); \},/);
    assert.match(app, /if \("write" in c\) done = await writeSessionSettings\(chat, c\.write\);\n {2}else if \("tune" in c\) done = composer\.tune\(c\.tune, c\.value\);\n {2}else if \("family" in c\) done = composer\.pickFamilyById\(c\.family\);/);
    assert.match(app, /may: may \? \{ tags: \[\.\.\.may\.tags\], cards: may\.cards\.filter\(\(c\) => !c\.partOf\)/);
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    // A view-only device's page picks nothing (remote-view-ui.test.js).
    assert.match(composer, /pickFamilyById\(id\) \{\n\s+if \(viewOnly\) return false;\n\s+const f = families\.find\(\(x\) => String\(x\.id\) === id\);\n\s+if \(f\) pickFamily\(f\);/);
    assert.match(composer, /tune\(key, value\) \{ return viewOnly \? false : effort\.pick\(key, value\); \},/);
  });
});

describe("the tune popover's choice made from Ctrl+K", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => doc.restore());
  const opus = /** @type {any} */ ({
    id: "anthropic/claude-opus-5-5", upstream: "anthropic", kind: "model", members: [{ id: "claude-opus-5-5", effort: null, speed: null, thinking: null, window: null }],
    effort: { via: "setting", levels: ["low", "medium", "high", "xhigh", "max"], default: "high" }, speed: null, thinking: null,
    window: { via: "setting", options: [200_000, 1_000_000], standard: 200_000 },
  });

  test("a level and a window go the popover's way; one the model has not is refused", () => {
    /** @type {any[]} */
    const tuned = [];
    const c = createEffortControl({ onTune: (want, changed) => tuned.push([changed, want.effort, want.window]) });
    c.setFamily(opus, { effort: "high", speed: "standard", thinking: "off", window: 0 });
    assert.equal(c.pick("effort", "max"), true);
    assert.equal(c.pick("effort", null), true, "Auto, where the setting carries the level");
    assert.equal(c.pick("window", 1_000_000), true);
    assert.equal(c.pick("window", 200_000), true, "the standard window is no window of its own");
    assert.deepEqual(tuned, [["effort", "max", 0], ["effort", null, 0], ["window", null, 1_000_000], ["window", null, 0]]);
    assert.equal(c.pick("effort", "minimal"), false);
    assert.equal(c.pick("window", 2_000_000), false);
    c.setFamily(null, null);
    assert.equal(c.pick("effort", "max"), false, "no model: nothing to tune");
    assert.equal(tuned.length, 4);
  });
});

describe("the / list in groups", () => {
  const cat = commandCatalog({ experimental: { teams: true } });
  const every = cat.groups.flatMap((g) => g.commands.map((c) => c.command));

  // (fails before: yes — every command sat under one head, Commands, in the catalogue's order)
  test("Everyday first, Make room next, then the catalogue's groups; every command once, typed as before", () => {
    const rows = commandRows(cat, "");
    assert.equal(rows.length, every.length);
    assert.deepEqual([...rows.map((r) => r.label)].sort(), [...every].sort(), "each command once");
    const sections = [...new Set(rows.map((r) => r.section))];
    assert.deepEqual(sections.slice(0, 2), ["Everyday", "Make room"]);
    assert.deepEqual(sections.slice(2), [...new Set(cat.groups.map((g) => g.title))].filter((t) => rows.some((r) => r.section === t)), "the rest under their own groups' names, in order");
    assert.deepEqual(rows.filter((r) => r.section === "Everyday").map((r) => r.label), ["/btw <question>", "/steer-fork <message>", "/subagent <task>", "/status", "/cost", "/help", "/flow <words>", "/plan <words>", "/craft <words>", "/team <name>", "/settings"]);
    assert.deepEqual(commandRows(commandCatalog({}), "").filter((r) => r.section === "Everyday").map((r) => r.label), ["/btw <question>", "/steer-fork <message>", "/subagent <task>", "/status", "/cost", "/help", "/flow <words>", "/plan <words>", "/craft <words>", "/settings"], "Settings › Experimental's Teams switch off, as it ships: no /team");
    assert.deepEqual(rows.filter((r) => r.section === "Make room").map((r) => r.label), ["/compaction", "/compact", "/autofit", "/autocompact"], "(fails before: yes — the owner's rules of 10-31: /trim now and /compact were two, /compact a coding agent's alone; /compact is Compact now in any chat Filament runs)");
    for (const r of rows) assert.equal(r.insert, typedOf(r.label), `${r.label} typed as before`);
  });

  test("the four that make room each say how it differs; the others keep their summaries", () => {
    const rows = commandRows(cat, "");
    const room = rows.filter((r) => r.section === "Make room");
    assert.equal(new Set(room.map((r) => r.detail)).size, 4);
    assert.match(String(room[0].detail), /^Asks first/);
    assert.match(String(room.find((r) => r.label === "/autocompact")?.detail), /^Makes no room now/);
    const status = rows.find((r) => r.label === "/status");
    assert.equal(status?.detail, cat.groups[0].commands[0].summary);
  });

  test("typing keeps each group's matches in the same order; no command is /trim", () => {
    const rows = commandRows(cat, "compact");
    assert.deepEqual([...new Set(rows.map((r) => r.section))], ["Make room", ...new Set(cat.groups.map((g) => g.title))].filter((s) => rows.some((r) => r.section === s)));
    assert.ok(rows.every((r) => `${r.label} ${r.detail || ""}`.toLowerCase().includes("compact")), rows.map((r) => r.label).join(" "));
    assert.deepEqual(commandRows(cat, "trim").filter((r) => /^\/trim/.test(r.label)), [], "the owner's rules of 10-31: no /trim");
  });

  // (fails before: yes — the owner's word of 10-27: "user writing slash command and view showing up as suggestion feels
  // like some visual thing": the command was /view, its group "The context view")
  test("no command chooses how finished turns are sent: /turns, /view and /transcript are the model's words, and none is offered", () => {
    assert.equal(cat.groups.find((g) => g.id === "view"), undefined, "no Earlier turns group");
    assert.ok(!every.some((c) => /^\/(turns|view|transcript)\b/.test(c)), "none is listed: " + every.join(" "));
    const memory = /** @type {any} */ ({ cfg: () => ({ commands: { prefix: "@mem" } }), isOpen: () => true });
    for (const typed of ["/turns keep 2", "/view use fold", "/transcript on", "/turns"]) assert.equal(chatCommandOf(typed, { memory, situated: true }), null, typed);
  });
});
